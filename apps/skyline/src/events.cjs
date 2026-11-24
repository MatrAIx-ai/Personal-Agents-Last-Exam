'use strict';
// Infra-applied events. Each handler observes the event's own `at` as ctx.virtual_now.
// The App never schedules itself: Infra sells seats, changes schedules and expires
// alternatives at their times, and Messaging delivers loyalty credits.
const c = require('./common.cjs');
const inv = require('./inventory.cjs');
const ledger = require('./ledger.cjs');
const notices = require('./notices.cjs');

// Loyalty credit (urn:pale:loyalty-credit:1): points move only between accounts of the same member.
function receive(ctx, data, event) {
  const {recipient_account_id, message} = event.payload;
  const credit = message.data, source = credit.source_object, content = credit.content;
  if (recipient_account_id !== data.account_id || credit.recipient.app_id !== 'skyline' || credit.recipient.id !== data.account_id) {
    c.fail('invalid_event', 'Wrong receiving account.');
  }
  const sender = ctx.binding.accounts.find(a => a.app_id === 'waypoint' && a.account_id === source.account_id);
  if (!sender) c.fail('permission_denied', 'The sending Waypoint account is not bound to this run.');
  if (content.kind !== 'partner_transfer') c.fail('invalid_event', 'Skyline accepts only partner transfers.');
  if (sender.owner_person_id !== data.owner_person_id || content.member_person_id !== data.owner_person_id ||
      (content.member_number !== null && content.member_number !== data.member_number)) {
    c.fail('permission_denied', 'Points can move only between accounts of the same member.');
  }
  if (c.allIds(data).has(event.event_id)) c.fail('already_exists', 'Delivered record already exists.');
  ledger.post(ctx, data, 'transfer_in', content.points, {app_id:'waypoint', account_id:source.account_id, object_type:source.object_type,
    object_id:source.object_id, message_id:message.id, sent_at:message.time ?? null}, event.event_id);
  return data;
}

function sold(ctx, data, event) {
  const {flight_id, cabin, seats} = event.payload;
  const map = inv.flight(data, flight_id).cabins[cabin];
  if (!map) c.fail('invalid_event', 'This flight has no ' + cabin + ' cabin.');
  map.saver_seats = seats === 'all' ? 0 : Math.max(0, map.saver_seats - seats);
  data.inventory_revision++;
  c.log(ctx, 'skyline.inventory_sold', {record_id:flight_id, saver_seats:map.saver_seats});
  return data;
}

// Path checks for offered alternatives: consecutive airports and legal connections.
function checkAlternatives(ctx, data, alternatives) {
  if (new Set(alternatives.map(a => a.id)).size !== alternatives.length) c.fail('invalid_event', 'Duplicate alternative ID.');
  const ends = new Set();
  for (const a of alternatives) {
    const flights = a.flight_ids.map(id => data.flights.find(f => f.id === id));
    if (flights.some(f => !f)) c.fail('invalid_event', 'An alternative names an unknown flight.');
    if (flights.some(f => c.ms(f.departs_at) <= c.ms(ctx.virtual_now))) c.fail('invalid_event', 'An alternative flight has already departed.');
    if (!inv.legal(data, flights)) c.fail('invalid_event', 'An alternative is not a legal path.');
    ends.add(flights[0].origin + '-' + flights.at(-1).dest);
  }
  if (ends.size > 1) c.fail('invalid_event', 'All alternatives must connect the same two airports.');
  return alternatives.length ? [...ends][0].split('-') : null;
}

// The booked segments an alternative replaces: the shortest run of segments around the changed
// flight that starts and ends at the alternatives' endpoints.
function replacedRange(data, booking, flightId, ends) {
  const k = booking.segments.indexOf(flightId);
  if (!ends) return [flightId];
  const flights = booking.segments.map(id => inv.flight(data, id));
  let i = k, j = k;
  while (i >= 0 && flights[i].origin !== ends[0]) i--;
  while (j < flights.length && flights[j].dest !== ends[1]) j++;
  if (i < 0 || j >= flights.length) c.fail('invalid_event', 'The alternatives do not fit booking ' + booking.id + '.');
  return booking.segments.slice(i, j + 1);
}

function scheduleChanged(ctx, data, event) {
  const p = event.payload;
  const f = inv.flight(data, p.flight_id);
  if (data.bookings.some(b => b.change?.change_id === p.change_id)) c.fail('already_exists', 'This schedule change ID was already used.');
  if (!c.localIn(inv.airport(data, f.origin).timezone, p.departs_at) || !c.localIn(inv.airport(data, f.dest).timezone, p.arrives_at) ||
      c.ms(p.arrives_at) <= c.ms(p.departs_at)) c.fail('invalid_event', 'New times must be local airport times and arrive after departure.');
  if (c.ms(p.deadline) <= c.ms(ctx.virtual_now)) c.fail('invalid_event', 'The deadline must be after the change.');
  const shift = Math.max(Math.abs(c.minutes(f.departs_at, p.departs_at)), Math.abs(c.minutes(f.arrives_at, p.arrives_at)));
  f.departs_at = p.departs_at;
  f.arrives_at = p.arrives_at;
  data.inventory_revision++;
  c.log(ctx, 'skyline.flight_retimed', {record_id:f.id, minutes:shift});
  const ends = checkAlternatives(ctx, data, p.alternatives);
  const flightOf = id => inv.flight(data, id);
  for (const b of data.bookings.filter(b => b.status === 'ticketed' && b.segments.includes(f.id))) {
    const reason = !inv.legal(data, b.segments.map(flightOf)) ? 'illegal_connection' : shift >= 60 ? 'time_change' : null;
    if (!reason) continue;
    const replaces = replacedRange(data, b, f.id, ends);
    const start = b.segments.indexOf(replaces[0]);
    for (const a of p.alternatives) {
      const path = [...b.segments.slice(0, start), ...a.flight_ids, ...b.segments.slice(start + replaces.length)].map(flightOf);
      if (a.flight_ids.some(id => !flightOf(id).cabins[b.cabin]) || !inv.legal(data, path)) {
        c.fail('invalid_event', 'Alternative ' + a.id + ' does not work for booking ' + b.id + '.');
      }
    }
    b.change = {change_id:p.change_id, reason, flight_id:f.id, replaces, alternatives:c.copy(p.alternatives), deadline:p.deadline,
      status:'open', accepted_alternative_id:null};
    c.stamp(ctx, b, 'schedule_change', {change_id:p.change_id, reason});
    notices.scheduleChange(ctx, data, b, f, flightOf);
  }
  return data;
}

function alternativeExpired(ctx, data, event) {
  const affected = data.bookings.filter(b => b.change?.change_id === event.payload.change_id);
  if (!affected.length) c.fail('not_found', 'No booking has this schedule change.');
  if (c.ms(ctx.virtual_now) < c.ms(affected[0].change.deadline)) c.fail('not_due', 'The alternative is open until ' + affected[0].change.deadline + '.');
  for (const b of affected.filter(b => b.change.status === 'open')) {
    b.change.status = 'expired';
    c.stamp(ctx, b, 'alternative_expired', {change_id:b.change.change_id});
  }
  return data;
}

function applyEvent(ctx, data, event) {
  const op = event.operation;
  if (op === 'skyline.receive') return receive(ctx, data, event);
  if (op === 'skyline.inventory.sold') return sold(ctx, data, event);
  if (op === 'skyline.schedule.changed') return scheduleChanged(ctx, data, event);
  if (op === 'skyline.alternative.expired') return alternativeExpired(ctx, data, event);
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
