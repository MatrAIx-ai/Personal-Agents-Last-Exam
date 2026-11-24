'use strict';
const {fail, references: ownerReferences} = require('./domain-utils.cjs');
const {validZone} = require('./time.cjs');
const {sameFlight} = require('./common.cjs');

const unique = (list, key, what) => {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item[key])) fail('invalid_seed', 'Duplicate ' + what + ' ID ' + item[key] + '.');
    seen.add(item[key]);
  }
  return seen;
};
const notAfter = (value, now, what) => {
  if (value && Date.parse(value) > Date.parse(now)) fail('invalid_seed', what + ' is dated after the current virtual time.');
};
const inBinding = (ctx, id) => ctx.binding.people.some(p => p.person_id === id);
function tripRef(ctx, r) {
  if (!ctx.binding.accounts.some(a => a.app_id === r.app_id && a.account_id === r.account_id) ||
      !(ctx.binding.objects[r.app_id] || []).includes(r.object_id)) fail('invalid_seed', 'Cross-App trip reference is not in the task binding.');
}

// Called by Core at load, after each write and during each event (with ctx.virtual_now set to the event time).
function validateSeed(ctx, data) {
  ownerReferences(ctx, data);
  const now = ctx.virtual_now;
  if (!validZone(data.settings.time_zone)) fail('invalid_seed', 'Unknown account time zone.');
  const zones = unique(data.zones, 'zone_id', 'zone');
  for (const z of data.zones) if (!validZone(z.time_zone)) fail('invalid_seed', 'Unknown zone time zone.');
  const places = unique(data.places, 'place_id', 'place');
  for (const p of data.places) {
    if (!validZone(p.time_zone) || (p.zone_id !== null && !zones.has(p.zone_id))) fail('invalid_seed', 'Place ' + p.place_id + ' refers to an unknown zone or time zone.');
    if ((p.kind === 'airport_terminal') !== !!p.airport_code) fail('invalid_seed', 'Only airport terminals have an airport code.');
  }
  for (const t of data.travel) if (!zones.has(t.from_zone) || !zones.has(t.to_zone)) fail('invalid_seed', 'Travel time refers to an unknown zone.');
  for (const s of data.supply) if (!zones.has(s.zone_id)) fail('invalid_seed', 'Supply refers to an unknown zone.');
  unique(data.market, 'zone_id', 'market zone');
  for (const m of data.market) { if (!zones.has(m.zone_id)) fail('invalid_seed', 'Market refers to an unknown zone.'); notAfter(m.updated_at, now, 'Market update'); }
  data.flights.forEach((f, i) => {
    if (data.flights.findIndex(x => sameFlight(x, f)) !== i) fail('invalid_seed', 'Duplicate flight ' + f.carrier + f.number + ' on ' + f.local_date + '.');
    const arrival = data.places.find(p => p.place_id === f.arrival_place_id);
    if (!arrival || arrival.kind !== 'airport_terminal') fail('invalid_seed', 'A flight arrives at an airport terminal.');
    notAfter(f.landed_at, now, 'Landing');
    for (const h of f.history) notAfter(h.at, now, 'Flight history');
  });
  const methods = unique(data.payment_methods, 'payment_method_id', 'payment method');
  const bookings = unique(data.bookings, 'booking_id', 'booking');
  for (const b of data.bookings) {
    if (!places.has(b.pickup_place_id) || !places.has(b.dropoff_place_id)) fail('invalid_seed', 'Booking ' + b.booking_id + ' refers to an unknown place.');
    if (!methods.has(b.payment_method_id)) fail('invalid_seed', 'Booking ' + b.booking_id + ' refers to an unknown payment method.');
    if (!inBinding(ctx, b.rider_person_id)) fail('invalid_seed', 'Booking ' + b.booking_id + ' has a rider outside the binding.');
    if ((b.status === 'needs_attention') !== (b.attention !== null)) fail('invalid_seed', 'Only a booking in needs_attention carries an attention reason.');
    if (b.flight_tracking && !data.flights.some(f => sameFlight(f, b.flight))) fail('invalid_seed', 'Booking ' + b.booking_id + ' tracks an unknown flight.');
    if (b.external_trip_ref) tripRef(ctx, b.external_trip_ref);
    notAfter(b.created_at, now, 'Booking ' + b.booking_id);
    for (const h of b.history) notAfter(h.at, now, 'Booking history');
  }
  unique(data.ledger, 'entry_id', 'ledger entry');
  for (const e of data.ledger) {
    if (!bookings.has(e.booking_id) || !e.entry_id.startsWith('le-' + e.booking_id + '-')) fail('invalid_seed', 'Ledger entry ' + e.entry_id + ' does not belong to a booking.');
    notAfter(e.created_at, now, 'Ledger entry'); notAfter(e.updated_at, now, 'Ledger entry');
  }
  for (const b of data.bookings) {
    const holds = data.ledger.filter(e => e.booking_id === b.booking_id && e.type === 'hold');
    if (b.status === 'completed' && !holds.some(h => h.status === 'captured')) fail('invalid_seed', 'Completed booking ' + b.booking_id + ' has no captured hold.');
    if (['cancelled', 'rider_no_show', 'lapsed', 'completed'].includes(b.status) && holds.some(h => h.status === 'authorized')) fail('invalid_seed', 'Final booking ' + b.booking_id + ' still holds an authorization.');
  }
  unique(data.shares, 'share_id', 'share');
  for (const s of data.shares) {
    if (!bookings.has(s.booking_id) || !inBinding(ctx, s.person_id)) fail('invalid_seed', 'Share ' + s.share_id + ' refers to an unknown booking or person.');
    notAfter(s.created_at, now, 'Share');
  }
  unique(data.support_cases, 'case_id', 'support case');
  for (const c of data.support_cases) {
    if (!bookings.has(c.booking_id)) fail('invalid_seed', 'Case ' + c.case_id + ' refers to an unknown booking.');
    notAfter(c.created_at, now, 'Support case'); notAfter(c.resolved_at, now, 'Support resolution');
  }
  unique(data.notifications, 'notification_id', 'notification');
  for (const n of data.notifications) {
    if (!bookings.has(n.booking_id) || !inBinding(ctx, n.recipient_person_id)) fail('invalid_seed', 'Notification ' + n.notification_id + ' refers to an unknown booking or person.');
    notAfter(n.created_at, now, 'Notification');
    if (n.outcome) notAfter(n.outcome.recorded_at, now, 'Delivery outcome');
  }
  for (const e of data.ignored_events) notAfter(e.at, now, 'Ignored event');
}

module.exports = {
  validateSeed,
  // Business records the account owns or the task loaded, and their IDs (the same set, as Core expects).
  records: data => [...data.places, ...data.bookings, ...data.ledger, ...data.shares, ...data.support_cases, ...data.notifications],
  objects: data => [...data.places.map(p => p.place_id), ...data.bookings.map(b => b.booking_id), ...data.ledger.map(e => e.entry_id),
    ...data.shares.map(s => s.share_id), ...data.support_cases.map(c => c.case_id), ...data.notifications.map(n => n.notification_id)],
  references: data => data.bookings.filter(b => b.external_trip_ref).map(b => b.external_trip_ref)
};
