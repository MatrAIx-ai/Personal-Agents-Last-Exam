'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write.
const {references:bound} = require('./domain-utils.cjs');
const {fail, ms, validTimeZone, localIn} = require('./common.cjs');
const inv = require('./inventory.cjs');

const bad = message => fail('invalid_seed', message);
function unique(values, label) {
  if (new Set(values).size !== values.length) bad('Duplicate ' + label + '.');
}

function timeline(record, label) {
  if (ms(record.created_at) > ms(record.updated_at)) bad(label + ' timestamps are reversed.');
  let previous = ms(record.created_at);
  for (const entry of record.history) {
    const at = ms(entry.at);
    if (!Number.isFinite(at) || at < previous || at > ms(record.updated_at)) bad('Invalid history timeline for ' + label + '.');
    previous = at;
  }
  if (!record.history.length || previous !== ms(record.updated_at)) bad(label + ' history must include the last update.');
}

// A Waypoint sender must be bound and owned by this member.
function sameMember(ctx, data, accountId) {
  const a = ctx.binding.accounts.find(x => x.app_id === 'waypoint' && x.account_id === accountId);
  return !!a && a.owner_person_id === data.owner_person_id;
}

function cabinMap(map, label) {
  unique(map.seats, 'seat in ' + label);
  if (!map.taken.every(s => map.seats.includes(s))) bad('Taken seat outside the cabin on ' + label + '.');
  for (const [a, b] of map.adjacent_pairs) if (a === b || !map.seats.includes(a) || !map.seats.includes(b)) bad('Invalid adjacent pair on ' + label + '.');
  if (map.saver_seats > inv.freeSeats(map).length) bad('Saver seats exceed free seats on ' + label + '.');
}

function validateSeed(ctx, data) {
  bound(ctx, data);
  const people = new Set(ctx.binding.people.map(p => p.person_id));
  if (data.mail_account_id !== null && !ctx.binding.accounts.some(a => a.app_id === 'mail' && a.account_id === data.mail_account_id &&
      a.owner_person_id === data.owner_person_id)) bad('The Mail account must be bound to the member.');
  unique(data.passengers.map(p => p.id), 'passenger ID');
  if (data.passengers.some(p => !people.has(p.person_id))) bad('Passengers must be bound people.');

  unique(data.airports.map(a => a.code), 'airport');
  if (data.airports.some(a => !validTimeZone(a.timezone))) bad('Airport time zone is not a valid IANA zone.');
  const airport = code => data.airports.find(a => a.code === code) || bad('Unknown airport ' + code + '.');
  if (data.rules.min_connection_minutes > data.rules.max_connection_minutes) bad('Connection limits are reversed.');
  unique(data.award_chart.map(r => [r.origin, r.dest, r.cabin, r.operating_carrier ?? ''].join('|')), 'award chart row');
  for (const r of data.award_chart) { airport(r.origin); airport(r.dest); if (r.origin === r.dest) bad('Award chart row has one airport.'); }

  unique(data.flights.map(f => f.id), 'flight ID');
  const flights = new Map(data.flights.map(f => [f.id, f]));
  for (const f of data.flights) {
    if (f.origin === f.dest) bad('Flight ' + f.id + ' has one airport.');
    if (!localIn(airport(f.origin).timezone, f.departs_at) || !localIn(airport(f.dest).timezone, f.arrives_at)) bad('Flight ' + f.id + ' times must use local airport offsets.');
    if (ms(f.arrives_at) <= ms(f.departs_at)) bad('Flight ' + f.id + ' arrives before it departs.');
    if (!Object.keys(f.cabins).length) bad('Flight ' + f.id + ' has no cabin.');
    for (const [name, map] of Object.entries(f.cabins)) cabinMap(map, f.id + ' ' + name);
  }

  // Record IDs share one namespace.
  unique([...data.bookings, ...data.notices, ...data.ledger, ...data.charges].map(r => r.id), 'record ID');
  const bookings = new Map(data.bookings.map(b => [b.id, b]));

  // Ledger: time order and a running sum that never goes negative and ends at the balance.
  let balance = 0, last = -Infinity;
  data.ledger.forEach((e, i) => {
    if (ms(e.at) < last) bad('Ledger entries must be in time order.');
    last = ms(e.at);
    if (e.balance_after !== balance + e.points || e.balance_after < 0) bad('Ledger running balance is inconsistent at ' + e.id + '.');
    balance = e.balance_after;
    const b = e.ref?.booking_id === undefined ? null : bookings.get(e.ref.booking_id);
    const ok = {
      opening:i === 0 && e.ref === null && e.points >= 0,
      transfer_in:e.points > 0 && e.ref?.app_id === 'waypoint' && sameMember(ctx, data, e.ref.account_id),
      redeem:!!b && e.points === -b.points,
      refund:!!b && b.status === 'cancelled' && e.points === b.points
    }[e.kind];
    if (!ok) bad('Ledger entry ' + e.id + ' does not match its kind.');
  });
  if (balance !== data.balance) bad('The balance must equal the last ledger balance.');

  unique(data.payment_labels, 'payment label');
  for (const ch of data.charges) {
    if (!data.payment_labels.includes(ch.label)) bad('Charge ' + ch.id + ' uses an unknown payment label.');
    if (ch.amount_cents === 0) bad('Charge ' + ch.id + ' has no amount.');
    if (ch.ref && !bookings.has(ch.ref.booking_id)) bad('Charge ' + ch.id + ' refers to an unknown booking.');
  }

  unique(data.bookings.map(b => b.locator), 'locator');
  const occupied = new Set();
  for (const b of data.bookings) {
    timeline(b, b.id);
    if (!b.passenger_ids.every(p => data.passengers.some(x => x.id === p))) bad('Booking ' + b.id + ' names an unknown passenger.');
    const legs = b.segments.map(id => flights.get(id) || bad('Booking ' + b.id + ' names an unknown flight.'));
    if (legs.some(f => !f.cabins[b.cabin])) bad('Booking ' + b.id + ' cabin is missing on a flight.');
    if (legs.slice(1).some((f, i) => legs[i].dest !== f.origin)) bad('Booking ' + b.id + ' segments do not connect.');
    if (!b.saver_flight_ids.every(id => b.segments.includes(id)) || (b.status === 'cancelled' && b.saver_flight_ids.length)) bad('Booking ' + b.id + ' saver inventory is inconsistent.');
    if (b.saver_reductions.some(r => !b.segments.includes(r.flight_id) || b.saver_flight_ids.includes(r.flight_id))
      || new Set(b.saver_reductions.map(r => r.flight_id)).size !== b.saver_reductions.length
      || (b.status === 'cancelled' && b.saver_reductions.length)) bad('Booking ' + b.id + ' saver reductions are inconsistent.');
    if (!data.payment_labels.includes(b.payment_label)) bad('Booking ' + b.id + ' uses an unknown payment label.');
    // Exactly one seat per passenger per segment, in that order.
    const expected = b.segments.flatMap(f => b.passenger_ids.map(p => f + '|' + p));
    if (JSON.stringify(b.seats.map(s => s.flight_id + '|' + s.passenger_id)) !== JSON.stringify(expected)) bad('Booking ' + b.id + ' needs one seat per passenger per segment.');
    for (const s of b.seats) {
      const map = flights.get(s.flight_id).cabins[b.cabin];
      if (!map.seats.includes(s.seat)) bad('Booking ' + b.id + ' seat ' + s.seat + ' is not in the cabin.');
      if (b.status === 'ticketed') {
        const key = s.flight_id + '|' + s.seat;
        if (!map.taken.includes(s.seat) || occupied.has(key)) bad('Booking ' + b.id + ' seat ' + s.seat + ' is not held for it.');
        occupied.add(key);
      }
    }
    // Points and money match the ledger and charges.
    const redeems = data.ledger.filter(e => e.kind === 'redeem' && e.ref.booking_id === b.id);
    const refunds = data.ledger.filter(e => e.kind === 'refund' && e.ref.booking_id === b.id);
    if (redeems.length !== 1 || refunds.length !== (b.status === 'cancelled' ? 1 : 0)) bad('Booking ' + b.id + ' points do not match the ledger.');
    const charges = data.charges.filter(ch => ch.ref?.booking_id === b.id);
    if (JSON.stringify(charges.map(ch => ch.id).sort()) !== JSON.stringify([...b.charge_ids].sort())) bad('Booking ' + b.id + ' charges do not match.');
    const paid = charges.filter(ch => ch.amount_cents > 0), back = charges.filter(ch => ch.amount_cents < 0);
    const total = b.partner_fee_cents + b.taxes_cents;
    if (paid.length !== (total > 0 ? 1 : 0) || (paid[0] && paid[0].amount_cents !== total) || paid.some(ch => ch.label !== b.payment_label)) bad('Booking ' + b.id + ' charge is inconsistent.');
    if (b.status === 'ticketed' ? back.length : back.length > 1 || back.some(ch => ch.label !== b.payment_label ||
        ![b.taxes_cents, total].includes(-ch.amount_cents))) bad('Booking ' + b.id + ' refund is inconsistent.');
    if (b.status === 'cancelled' && b.taxes_cents > 0 && !back.length) bad('Booking ' + b.id + ' taxes were not refunded.');
    const ch = b.change;
    if (ch) {
      unique(ch.alternatives.map(a => a.id), 'alternative ID');
      if (ch.alternatives.some(a => a.flight_ids.some(id => !flights.has(id)))) bad('Booking ' + b.id + ' alternative names an unknown flight.');
      if ((ch.status === 'accepted') !== (ch.accepted_alternative_id !== null) ||
          (ch.accepted_alternative_id !== null && !ch.alternatives.some(a => a.id === ch.accepted_alternative_id))) bad('Booking ' + b.id + ' change status is inconsistent.');
      if (ch.status !== 'accepted') {
        const start = b.segments.indexOf(ch.replaces[0]);
        if (start < 0 || JSON.stringify(b.segments.slice(start, start + ch.replaces.length)) !== JSON.stringify(ch.replaces) ||
            !ch.replaces.includes(ch.flight_id)) bad('Booking ' + b.id + ' change must replace booked segments around the changed flight.');
      }
    }
  }
  for (const n of data.notices) {
    timeline(n, n.id);
    if (n.ref && !bookings.has(n.ref.booking_id)) bad('Notice ' + n.id + ' refers to an unknown booking.');
  }
}

// Transfer provenance names Waypoint objects, but history may predate a Waypoint fixture,
// so it is not declared as a live cross-App reference.
module.exports = {validateSeed, records:data => [...data.bookings, ...data.notices],
  objects:data => [...data.bookings, ...data.notices].map(r => r.id), references:() => [], assetReferences:() => []};
