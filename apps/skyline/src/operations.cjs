'use strict';
// Agent tools. Inventory changes elsewhere (seats sold, schedule changes) arrive as Infra events (see events.cjs).
const crypto = require('node:crypto');
const c = require('./common.cjs');
const inv = require('./inventory.cjs');
const ledger = require('./ledger.cjs');
const notices = require('./notices.cjs');

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function locator(data, bookingId) {
  const used = new Set(data.bookings.map(b => b.locator));
  for (let salt = 0; ; salt++) {
    const bytes = crypto.createHash('sha256').update(JSON.stringify([data.account_id, bookingId, salt])).digest();
    const code = [...bytes.subarray(0, 6)].map(x => LETTERS[x % LETTERS.length]).join('');
    if (!used.has(code)) return code;
  }
}

const seatKey = s => s.flight_id + '|' + s.passenger_id;
// Seat lists are kept in segment order, then passenger order.
const ordered = (booking, seats) => booking.segments.flatMap(f => booking.passenger_ids.map(p => seats.find(s => s.flight_id === f && s.passenger_id === p)));

function seatRequests(requests, flightIds, passengerIds) {
  const keys = new Set();
  for (const r of requests) {
    if (!flightIds.includes(r.flight_id) || !passengerIds.includes(r.passenger_id)) c.fail('invalid_arguments', 'A seat request names a flight or passenger outside this booking.');
    if (keys.has(seatKey(r))) c.fail('invalid_arguments', 'At most one seat per passenger per segment.');
    keys.add(seatKey(r));
  }
}

function trip(data, b) {
  return {...c.copy(b), flights:b.segments.map(id => inv.segmentView(inv.flight(data, id), b.cabin))};
}

function book(ctx, data, args) {
  const pax = args.passenger_ids.length;
  for (const id of args.passenger_ids) c.find(data.passengers, id, 'Passenger');
  const found = inv.reproduce(data, ctx.virtual_now, args.option_id);
  if (!found) c.fail('stale_version', 'This option is not available at the current inventory. Search again.');
  if (found.pax !== pax) c.fail('invalid_arguments', 'The option was priced for ' + found.pax + ' passenger(s).');
  const {path, cabin, option} = found;
  if (path.some(f => f.cabins[cabin].saver_seats < pax)) c.fail('stale_version', 'Saver seats are no longer available.');
  if (data.balance < option.total.points) c.fail('insufficient_points', 'The option needs ' + option.total.points + ' points.');
  ledger.requireLabel(data, args.payment_label);

  const requests = args.seats || [];
  seatRequests(requests, path.map(f => f.id), args.passenger_ids);
  const seats = [];
  for (const f of path) {
    const map = f.cabins[cabin];
    for (const r of requests.filter(r => r.flight_id === f.id)) { inv.take(map, r.seat); seats.push(c.copy(r)); }
    const rest = args.passenger_ids.filter(p => !requests.some(r => r.flight_id === f.id && r.passenger_id === p));
    const free = inv.freeSeats(map);
    if (free.length < rest.length) c.fail('seat_unavailable', 'Not enough free seats on ' + f.id + '.');
    rest.forEach((p, i) => { inv.take(map, free[i]); seats.push({flight_id:f.id, passenger_id:p, seat:free[i]}); });
    map.saver_seats -= pax;
    inv.clampSaver(map);
  }

  const id = c.nextId(data, 'booking');
  const b = {id, locator:locator(data, id), status:'ticketed', cabin, passenger_ids:[...args.passenger_ids], segments:path.map(f => f.id),
    saver_flight_ids:path.map(f => f.id), seats:[], points:option.total.points, partner_fee_cents:option.total.partner_fee_cents,
    taxes_cents:option.total.taxes_cents, payment_label:args.payment_label, charge_ids:[], change:null,
    created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  b.seats = ordered(b, seats);
  ledger.post(ctx, data, 'redeem', -b.points, {booking_id:id});
  const amount = b.partner_fee_cents + b.taxes_cents;
  if (amount > 0) b.charge_ids.push(ledger.charge(ctx, data, b.payment_label, amount, 'Award partner fee and taxes, booking ' + b.locator, {booking_id:id}));
  data.bookings.push(b);
  data.inventory_revision++;
  c.stamp(ctx, b, 'ticketed', {segments:b.segments.length, pax});
  notices.confirmed(ctx, data, b, path);
  return {id, locator:b.locator, points:b.points, charge_id:b.charge_ids[0] ?? null, amount_cents:amount, seats:c.copy(b.seats)};
}

const outcome = (b, action, extra = {}) => ({id:b.id, action, booking_status:b.status, seats:c.copy(b.seats), changed:[], reassigned:[], refund:null, ...extra});

function ticketed(b) {
  if (b.status !== 'ticketed') c.fail('invalid_state', 'Only a ticketed booking can change.');
}

function changeSeats(ctx, data, b, args) {
  ticketed(b);
  const requests = args.seats || [];
  if (!requests.length) c.fail('invalid_arguments', 'Give the seats to change.');
  seatRequests(requests, b.segments, b.passenger_ids);
  for (const id of new Set(requests.map(r => r.flight_id))) {
    if (c.ms(inv.flight(data, id).departs_at) <= c.ms(ctx.virtual_now)) c.fail('invalid_state', 'Flight ' + id + ' has already departed.');
  }
  const changed = [];
  for (const r of requests) inv.release(inv.flight(data, r.flight_id).cabins[b.cabin], b.seats.find(s => seatKey(s) === seatKey(r)).seat);
  for (const r of requests) {
    const current = b.seats.find(s => seatKey(s) === seatKey(r));
    inv.take(inv.flight(data, r.flight_id).cabins[b.cabin], r.seat);
    changed.push({flight_id:r.flight_id, passenger_id:r.passenger_id, from:current.seat, seat:r.seat});
    current.seat = r.seat;
  }
  data.inventory_revision++;
  c.stamp(ctx, b, 'seats_changed', {seats:changed.length});
  return outcome(b, 'change_seats', {changed});
}

function acceptAlternative(ctx, data, b, args) {
  ticketed(b);
  const ch = b.change;
  if (!ch || ch.status === 'accepted') c.fail('invalid_state', 'This booking has no open schedule change.');
  if (ch.status === 'expired' || c.ms(ctx.virtual_now) >= c.ms(ch.deadline)) c.fail('alternative_expired', 'The free alternative expired at ' + ch.deadline + '.');
  if (args.alternative_id === undefined) c.fail('invalid_arguments', 'Give alternative_id.');
  const alt = ch.alternatives.find(a => a.id === args.alternative_id);
  if (!alt) c.fail('invalid_arguments', 'That alternative is not offered for this booking.');
  const fresh = alt.flight_ids.map(id => inv.flight(data, id));
  if (fresh.some(f => c.ms(f.departs_at) <= c.ms(ctx.virtual_now))) c.fail('invalid_state', 'An alternative flight has already departed.');
  const start = b.segments.indexOf(ch.replaces[0]);
  const segments = [...b.segments.slice(0, start), ...alt.flight_ids, ...b.segments.slice(start + ch.replaces.length)];
  if (!inv.legal(data, segments.map(id => inv.flight(data, id)))) c.fail('invalid_state', 'The alternative no longer connects legally.');

  const pax = b.passenger_ids.length;
  const seatsOn = id => b.seats.filter(s => s.flight_id === id);
  // Two passengers sat together if they had an adjacent pair on every replaced segment.
  const together = pax === 2 && ch.replaces.every(id => { const [a, z] = seatsOn(id); return inv.isPair(inv.flight(data, id).cabins[b.cabin], a.seat, z.seat); });
  const seats = b.seats.filter(s => !ch.replaces.includes(s.flight_id) || alt.flight_ids.includes(s.flight_id));
  for (const id of ch.replaces.filter(id => !alt.flight_ids.includes(id))) {
    const map = inv.flight(data, id).cabins[b.cabin];
    for (const s of seatsOn(id)) inv.release(map, s.seat);
    if (b.saver_flight_ids.includes(id)) { map.saver_seats += pax; b.saver_flight_ids = b.saver_flight_ids.filter(x => x !== id); }
  }
  const changed = [], reassigned = [];
  for (const f of fresh.filter(f => !b.segments.includes(f.id))) {
    const map = f.cabins[b.cabin];
    let chosen = together ? inv.freePairs(map)[0] : null;
    if (!chosen) {
      const free = inv.freeSeats(map);
      if (free.length < pax) c.fail('seat_unavailable', 'Not enough free seats on ' + f.id + '.');
      chosen = free.slice(0, pax);
    }
    const assigned = b.passenger_ids.map((p, i) => ({flight_id:f.id, passenger_id:p, seat:chosen[i]}));
    for (const s of assigned) { inv.take(map, s.seat); changed.push({...s, from:null}); seats.push(s); }
    inv.clampSaver(map);
    if (together && !inv.isPair(map, chosen[0], chosen[1])) reassigned.push({flight_id:f.id, reason:'adjacent_pair_unavailable', seats:c.copy(assigned)});
  }
  b.segments = segments;
  b.seats = ordered(b, seats);
  ch.status = 'accepted';
  ch.accepted_alternative_id = alt.id;
  data.inventory_revision++;
  c.stamp(ctx, b, 'alternative_accepted', {change_id:ch.change_id, reassigned:reassigned.length});
  return outcome(b, 'accept_alternative', {changed:changed.map(({flight_id, passenger_id, from, seat}) => ({flight_id, passenger_id, from, seat})), reassigned});
}

function cancel(ctx, data, b) {
  ticketed(b);
  if (c.ms(inv.flight(data, b.segments[0]).departs_at) <= c.ms(ctx.virtual_now)) c.fail('invalid_state', 'The trip has already started.');
  // An open schedule change (before its deadline) waives the partner booking fee.
  const waived = b.change !== null && b.change.status === 'open' && c.ms(ctx.virtual_now) < c.ms(b.change.deadline);
  ledger.post(ctx, data, 'refund', b.points, {booking_id:b.id});
  const fee = waived ? b.partner_fee_cents : 0, amount = b.taxes_cents + fee;
  const chargeId = amount > 0 ? ledger.charge(ctx, data, b.payment_label, -amount, 'Award refund, booking ' + b.locator, {booking_id:b.id}) : null;
  if (chargeId) b.charge_ids.push(chargeId);
  for (const id of b.segments) {
    const map = inv.flight(data, id).cabins[b.cabin];
    for (const s of b.seats.filter(s => s.flight_id === id)) inv.release(map, s.seat);
    if (b.saver_flight_ids.includes(id)) map.saver_seats += b.passenger_ids.length;
  }
  b.saver_flight_ids = [];
  b.status = 'cancelled';
  data.inventory_revision++;
  c.stamp(ctx, b, 'cancelled', {fee_waived:waived});
  return outcome(b, 'cancel', {refund:{points:b.points, taxes_cents:b.taxes_cents, partner_fee_cents:fee,
    fee_kept_cents:b.partner_fee_cents - fee, charge_id:chargeId}});
}

function handleTool(ctx, data, name, args) {
  if (name === 'skyline.balance') {
    return {data, result:{member_number:data.member_number, balance:data.balance, ledger:c.copy(data.ledger),
      passengers:c.copy(data.passengers), payment_labels:[...data.payment_labels], charges:c.copy(data.charges)}};
  }
  if (name === 'skyline.search') {
    return {data, result:{inventory_revision:data.inventory_revision, options:inv.search(data, ctx.virtual_now, args)}};
  }
  if (name === 'skyline.trips') {
    if (args.id !== undefined) {
      const one = trip(data, c.find(data.bookings, args.id, 'Booking'));
      return {data, result:{trips:[one], trip:one}};
    }
    const trips = data.bookings.filter(b => !args.status || b.status === args.status).map(b => trip(data, b))
      .sort((a, b) => c.ms(a.flights[0].departs_at) - c.ms(b.flights[0].departs_at) || a.id.localeCompare(b.id));
    return {data, result:{trips}};
  }
  if (name === 'skyline.notices.list') return {data, result:{notices:c.copy(data.notices)}};
  if (name === 'skyline.notices.outbound') return {data, result:{message:notices.outbound(data, c.find(data.notices, args.id, 'Notice'))}};
  if (name === 'skyline.book') return {data, result:book(ctx, data, args)};
  if (name === 'skyline.manage') {
    const b = c.find(data.bookings, args.booking_id, 'Booking');
    if (args.action === 'change_seats') return {data, result:changeSeats(ctx, data, b, args)};
    if (args.action === 'accept_alternative') return {data, result:acceptAlternative(ctx, data, b, args)};
    if (args.action === 'cancel') return {data, result:cancel(ctx, data, b)};
    c.fail('invalid_arguments', 'Unknown manage action.');
  }
  c.fail('unknown_tool', 'Unknown skyline operation.');
}

module.exports = {handleTool};
