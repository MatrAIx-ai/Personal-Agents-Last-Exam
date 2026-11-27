'use strict';
// Infra-applied events. Tasks choose content and timing; Curbline defines each event's effect.
// Core exposes the event's `at` as ctx.virtual_now while this runs and rejects backwards time.
//
// Targeting (approved design plus the 2026-11-23 review):
// - `booking_id`: an unknown booking, or one already final, commits as a no-op with a reason;
//   a non-final booking in the wrong state is rejected `invalid_transition`.
// - `selector`: matches only bookings for which the event is a valid next step. No match commits as a
//   no-op with a reason; several matches apply to the earliest-created one, or are rejected
//   `ambiguous_selector` when the event says `on_multiple: "reject"`.
const {fail, copy, log, MIN, booking: getBooking, sameFlight, flight: getFlight, flightLabel} = require('./common.cjs');
const {render, ms} = require('./time.cjs');
const {FEES} = require('./catalog.cjs');
const fare = require('./fare.cjs');
const B = require('./bookings.cjs');
const {notify} = require('./notify.cjs');

const INFRA = 'infra';
const number = id => +id.replace(/^bk-/, '') || 0;
const notLater = (value, at, what) => { if (ms(value) > ms(at)) fail('invalid_event', what + ' is later than the event time.'); };

function ignore(ctx, data, event, reason, target, b = null) {
  const at = render(ctx.virtual_now, b ? B.tz(data, b) : data.settings.time_zone);
  data.ignored_events.push({event_id: event.event_id, at, operation: event.operation, reason, target: copy(target)});
  if (b) B.history(b, {at, actor: INFRA, action: 'event_ignored', details: {operation: event.operation, ignored_reason: reason}, event_id: event.event_id});
  return null;
}

function matches(b, selector) {
  if (selector.flight) return !!b.flight && b.flight_tracking && sameFlight(b.flight, selector.flight);
  return b.rider_person_id === selector.rider_person_id && ms(b.pickup_at) >= ms(selector.pickup_from) && ms(b.pickup_at) <= ms(selector.pickup_to);
}

// The booking an event acts on, or null for a committed no-op.
function target(ctx, data, event, validFrom) {
  const p = event.payload;
  if (p.booking_id) {
    const b = data.bookings.find(x => x.booking_id === p.booking_id);
    if (!b) return ignore(ctx, data, event, 'booking_not_found', {booking_id: p.booking_id});
    if (B.isFinal(b)) return ignore(ctx, data, event, 'booking_' + b.status, {booking_id: b.booking_id}, b);
    B.expect(b, validFrom);
    return b;
  }
  const candidates = data.bookings.filter(b => matches(b, p.selector));
  const applicable = candidates.filter(b => validFrom.includes(b.status)).sort((a, b) => number(a.booking_id) - number(b.booking_id));
  if (!applicable.length) {
    return ignore(ctx, data, event, 'selector_no_match', {selector: p.selector, matched: candidates.map(b => ({booking_id: b.booking_id, status: b.status}))});
  }
  if (applicable.length > 1 && p.on_multiple === 'reject') fail('ambiguous_selector', 'The selector matches ' + applicable.length + ' bookings.');
  return applicable[0];
}

const stamp = (ctx, data, b) => render(ctx.virtual_now, B.tz(data, b));
const entry = (ctx, data, b, action, details = {}, event) => ({at: stamp(ctx, data, b), actor: INFRA, action, details, event_id: event.event_id});

// ---- dispatch and trip ----
function driverAssigned(ctx, data, event) {
  const b = target(ctx, data, event, ['scheduled']);
  if (!b) return;
  const p = event.payload;
  Object.assign(b, {driver: copy(p.driver), vehicle: copy(p.vehicle), eta: render(p.eta, B.tz(data, b))});
  B.transition(b, 'driver_assigned', entry(ctx, data, b, 'driver_assigned', {driver_id: p.driver.driver_id, vehicle_id: p.vehicle.vehicle_id}, event));
  notify(ctx, data, b, 'driver_assigned');
  notify(ctx, data, b, 'share_update', {status: 'driver_assigned'});
}

function etaUpdated(ctx, data, event) {
  const b = target(ctx, data, event, ['driver_assigned']);
  if (!b) return;
  b.eta = render(event.payload.eta, B.tz(data, b));
  b.revision++;
  B.history(b, entry(ctx, data, b, 'eta_updated', {eta: b.eta}, event));
}

function driverArrived(ctx, data, event) {
  const b = target(ctx, data, event, ['driver_assigned']);
  if (!b) return;
  const p = event.payload;
  notLater(p.arrived_at, ctx.virtual_now, 'arrived_at');
  Object.assign(b, {arrived_at: render(p.arrived_at, B.tz(data, b)), pickup_point: p.pickup_point ?? null});
  B.transition(b, 'driver_arrived', entry(ctx, data, b, 'driver_arrived', {arrived_at: b.arrived_at}, event));
  const end = B.freeWaitEnd(data, b);
  notify(ctx, data, b, 'driver_arrived', {free_wait_end: end});
  notify(ctx, data, b, 'share_update', {status: 'driver_arrived'});
}

function driverCancelled(ctx, data, event) {
  const b = target(ctx, data, event, ['driver_assigned', 'driver_arrived']);
  if (!b) return;
  const p = event.payload, driver = b.driver?.driver_id || null;
  Object.assign(b, {driver: null, vehicle: null, eta: null, arrived_at: null, pickup_point: null});
  if (p.reassign) {
    B.transition(b, 'scheduled', entry(ctx, data, b, 'driver_cancelled', {driver_id: driver, reason: p.reason, reassign: true}, event));
    notify(ctx, data, b, 'booking_changed', {reason: 'Your driver cancelled; a replacement driver is being found.'});
  } else {
    b.attention = {reason: 'driver_cancelled', proposed_pickup_at: null, since: stamp(ctx, data, b)};
    B.transition(b, 'needs_attention', entry(ctx, data, b, 'driver_cancelled', {driver_id: driver, reason: p.reason, reassign: false}, event));
    notify(ctx, data, b, 'needs_attention');
  }
}

function tripStarted(ctx, data, event) {
  const b = target(ctx, data, event, ['driver_arrived']);
  if (!b) return;
  const p = event.payload;
  notLater(p.started_at, ctx.virtual_now, 'started_at');
  b.started_at = render(p.started_at, B.tz(data, b));
  b.wait_fee_cents = B.waitFee(data, b, p.started_at);
  B.transition(b, 'on_trip', entry(ctx, data, b, 'trip_started', {started_at: b.started_at, wait_fee_cents: b.wait_fee_cents}, event));
}

function endShares(data, b, at) {
  for (const s of data.shares) if (s.booking_id === b.booking_id && s.status === 'active') { s.status = 'expired'; s.ended_at = at; }
}

function tripCompleted(ctx, data, event) {
  const b = target(ctx, data, event, ['on_trip']);
  if (!b) return;
  const p = event.payload, zone = B.tz(data, b);
  notLater(p.completed_at, ctx.virtual_now, 'completed_at');
  if (ms(p.completed_at) < ms(b.started_at)) fail('invalid_event', 'The trip cannot end before it started.');
  const at = render(p.completed_at, zone);
  b.completed_at = at;
  b.trip = {distance_km: p.distance_km, duration_min: p.duration_min, tolls_cents: p.tolls_cents};
  const hold = B.holdOf(data, b);
  if (hold) { hold.status = 'captured'; hold.updated_at = at; }
  B.charge(data, b, 'wait_fee', b.wait_fee_cents, at);
  B.charge(data, b, 'toll', p.tolls_cents, at);
  B.transition(b, 'completed', entry(ctx, data, b, 'trip_completed', {completed_at: at, ...b.trip}, event));
  notify(ctx, data, b, 'share_update', {status: 'completed'});
  endShares(data, b, at);
  const lines = [{label: 'Fare', amount_cents: b.fare.fare_cents}];
  if (b.wait_fee_cents) lines.push({label: 'Wait fee', amount_cents: b.wait_fee_cents});
  if (p.tolls_cents) lines.push({label: 'Tolls', amount_cents: p.tolls_cents});
  notify(ctx, data, b, 'receipt', {lines, total_cents: lines.reduce((s, l) => s + l.amount_cents, 0)});
}

function riderNoShow(ctx, data, event) {
  const b = target(ctx, data, event, ['driver_arrived']);
  if (!b) return;
  const p = event.payload, zone = B.tz(data, b);
  notLater(p.at, ctx.virtual_now, 'at');
  const f = B.trackedFlight(data, b);
  if (f && !f.landed_at) fail('flight_not_landed', 'The tracked flight has not landed.');
  const end = B.freeWaitEnd(data, b);
  if (ms(p.at) < end) fail('no_show_too_early', 'The free wait ends at ' + render(end, zone) + '.');
  const at = render(p.at, zone), wait = B.waitFee(data, b, p.at);
  B.releaseHold(data, b, at);
  B.charge(data, b, 'no_show_fee', FEES.no_show_cents, at);
  B.charge(data, b, 'wait_fee', wait, at);
  b.wait_fee_cents = wait;
  B.transition(b, 'rider_no_show', entry(ctx, data, b, 'rider_no_show', {at, wait_fee_cents: wait}, event));
  endShares(data, b, at);
  const lines = [{label: 'No-show fee', amount_cents: FEES.no_show_cents}];
  if (wait) lines.push({label: 'Wait fee', amount_cents: wait});
  notify(ctx, data, b, 'receipt', {lines, total_cents: FEES.no_show_cents + wait});
}

// ---- flights and market ----
function attention(ctx, data, b, reason, proposed, event, info) {
  const zone = B.tz(data, b), proposedText = proposed === null ? null : render(proposed, zone);
  if (b.status === 'needs_attention' && b.attention.reason === reason && b.attention.proposed_pickup_at === proposedText) {
    B.history(b, entry(ctx, data, b, 'flight_status_noted', {status: info.flight.status}, event));
    return;
  }
  b.attention = {reason, proposed_pickup_at: proposedText, since: stamp(ctx, data, b)};
  if (b.status === 'needs_attention') { b.revision++; B.history(b, entry(ctx, data, b, 'attention_updated', copy(b.attention), event)); }
  else B.transition(b, 'needs_attention', entry(ctx, data, b, 'needs_attention', copy(b.attention), event));
  notify(ctx, data, b, 'needs_attention', info);
}

function flightStatusChanged(ctx, data, event) {
  const p = event.payload, f = getFlight(data, p.flight, 'invalid_event');
  const arrival = data.places.find(x => x.place_id === p.arrival_place_id);
  if (!arrival || arrival.kind !== 'airport_terminal') fail('invalid_event', 'arrival_place_id must be an airport terminal.');
  if (p.status === 'landed') notLater(p.landed_at || ctx.virtual_now, ctx.virtual_now, 'landed_at');
  Object.assign(f, {status: p.status, scheduled_arrival: p.scheduled_arrival, estimated_arrival: p.estimated_arrival ?? f.estimated_arrival,
    arrival_place_id: p.arrival_place_id, source_ref: p.source_ref ?? f.source_ref,
    landed_at: p.status === 'landed' ? render(p.landed_at || ctx.virtual_now, arrival.time_zone) : f.landed_at});
  f.history.push({at: render(ctx.virtual_now, arrival.time_zone), status: f.status, estimated_arrival: f.estimated_arrival,
    arrival_place_id: f.arrival_place_id, event_id: event.event_id});
  const info = {flight: {...copy(f), arrival_code: arrival.airport_code}, limit_min: data.settings.auto_shift_max_min};
  const tracked = data.bookings.filter(b => B.isActive(b) && b.flight_tracking && sameFlight(b.flight, f)).sort((a, b) => number(a.booking_id) - number(b.booking_id));
  for (const b of tracked) {
    if (p.status === 'landed') { B.history(b, entry(ctx, data, b, 'flight_landed', {landed_at: f.landed_at}, event)); continue; }
    if (!(b.status === 'scheduled' || (b.status === 'needs_attention' && b.attention.reason !== 'driver_cancelled'))) {
      B.history(b, entry(ctx, data, b, 'flight_status_noted', {status: f.status}, event));
      continue;
    }
    const pickup = data.places.find(x => x.place_id === b.pickup_place_id);
    if (p.status === 'cancelled') { attention(ctx, data, b, 'flight_cancelled', null, event, info); continue; }
    if (pickup.airport_code !== arrival.airport_code) { attention(ctx, data, b, 'airport_changed', null, event, info); continue; }
    if (!f.estimated_arrival) { B.history(b, entry(ctx, data, b, 'flight_status_noted', {status: f.status}, event)); continue; }
    const proposed = ms(f.estimated_arrival) + b.pickup_buffer_min * MIN;
    if (Math.abs(proposed - ms(b.anchor_pickup_at)) > data.settings.auto_shift_max_min * MIN) { attention(ctx, data, b, 'large_shift', proposed, event, info); continue; }
    if (fare.supply(data, pickup.zone_id, fare.band(proposed, pickup.time_zone), b.option) <= 0) { attention(ctx, data, b, 'no_vehicle_after_shift', proposed, event, info); continue; }
    if (proposed === ms(b.pickup_at) && b.status === 'scheduled') { B.history(b, entry(ctx, data, b, 'flight_status_noted', {status: f.status}, event)); continue; }
    const previous = b.pickup_at;
    b.pickup_at = render(proposed, pickup.time_zone);
    b.attention = null;
    if (b.status === 'scheduled') { b.revision++; B.history(b, {...entry(ctx, data, b, 'pickup_shifted', {previous_pickup_at: previous, pickup_at: b.pickup_at}, event), from: 'scheduled', to: 'scheduled'}); }
    else B.transition(b, 'scheduled', entry(ctx, data, b, 'pickup_shifted', {previous_pickup_at: previous, pickup_at: b.pickup_at}, event));
    const eta = render(f.estimated_arrival, pickup.time_zone).slice(11, 16);
    notify(ctx, data, b, 'booking_changed', {reason: `Flight ${flightLabel(f)} now arrives at ${eta}.`});
    notify(ctx, data, b, 'pickup_details');
  }
}

function marketUpdated(ctx, data, event) {
  const p = event.payload;
  if (!data.zones.some(z => z.zone_id === p.zone_id)) fail('invalid_event', 'Unknown zone.');
  let m = data.market.find(x => x.zone_id === p.zone_id);
  if (!m) { m = {zone_id: p.zone_id, multiplier: 1, revision: 0, updated_at: null, supply: {}}; data.market.push(m); }
  if (p.multiplier !== undefined) m.multiplier = p.multiplier;
  for (const [option, bands] of Object.entries(p.supply || {})) m.supply[option] = {...(m.supply[option] || {}), ...bands};
  m.revision++;
  m.updated_at = render(ctx.virtual_now, data.settings.time_zone);
}

// ---- support and payments ----
function supportResolved(ctx, data, event) {
  const p = event.payload, c = data.support_cases.find(x => x.case_id === p.case_id);
  if (!c) return ignore(ctx, data, event, 'case_not_found', {case_id: p.case_id});
  if (c.status !== 'submitted') fail('invalid_transition', 'The case is already ' + c.status + '.');
  const b = getBooking(data, c.booking_id), at = stamp(ctx, data, b);
  if (p.outcome === 'resolved_adjusted') {
    if (!Number.isInteger(p.adjustment_cents) || p.adjustment_cents >= 0) fail('invalid_event', 'An adjustment is a negative amount in cents.');
    const refund = B.entry(data, b, {type: 'refund', kind: 'adjustment', amount_cents: -p.adjustment_cents, status: 'refund_pending', at, case_id: c.case_id});
    c.refund_entry_id = refund.entry_id;
    c.adjustment_cents = p.adjustment_cents;
  }
  Object.assign(c, {status: p.outcome, resolved_at: at, resolution_note: p.note ?? null});
  B.history(b, entry(ctx, data, b, 'support_resolved', {case_id: c.case_id, outcome: c.status, refund_entry_id: c.refund_entry_id}, event));
}

function refundSettled(ctx, data, event) {
  const p = event.payload, e = data.ledger.find(x => x.entry_id === p.ledger_entry_id);
  if (!e) return ignore(ctx, data, event, 'ledger_entry_not_found', {ledger_entry_id: p.ledger_entry_id});
  if (e.type !== 'refund' || e.status !== 'refund_pending') fail('refund_not_pending', 'That ledger entry is not a pending refund.');
  notLater(p.settled_at, ctx.virtual_now, 'settled_at');
  const b = getBooking(data, e.booking_id);
  e.status = 'refunded';
  e.updated_at = render(p.settled_at, B.tz(data, b));
  B.history(b, entry(ctx, data, b, 'refund_settled', {entry_id: e.entry_id}, event));
  notify(ctx, data, b, 'refund_settled', {amount_cents: e.amount_cents});
}

// Generated by Infra from the Messaging result for one notification.
function deliveryRecorded(ctx, data, event) {
  const p = event.payload, n = data.notifications.find(x => x.notification_id === p.notification_id);
  if (!n) fail('notification_not_found', 'Notification does not exist.');
  if (n.status !== 'pending_delivery') fail('notification_not_pending', 'Notification is not waiting for delivery.');
  const stop = p.stop_run === true;
  n.outcome = {status: p.status, code: p.code, stop_run: stop, router_event_id: p.router_event_id, recorded_at: render(ctx.virtual_now, data.settings.time_zone)};
  if (p.status === 'committed') n.status = 'delivered';
  else if (p.status === 'rejected' && !stop && p.code !== 'idempotency_conflict') n.status = 'delivery_failed';
  // halting, unknown and idempotency_conflict outcomes stay pending for reconciliation
}

const HANDLERS = {
  'dispatch.driver_assigned': driverAssigned, 'dispatch.eta_updated': etaUpdated, 'dispatch.driver_arrived': driverArrived,
  'dispatch.driver_cancelled': driverCancelled, 'trip.started': tripStarted, 'trip.completed': tripCompleted,
  'trip.rider_no_show': riderNoShow, 'flight.status_changed': flightStatusChanged, 'market.updated': marketUpdated,
  'support.resolved': supportResolved, 'payment.refund_settled': refundSettled, 'notification.delivery_recorded': deliveryRecorded
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  B.settle(data, ctx.virtual_now);
  handler(ctx, data, event);
  B.flagOverlaps(data, render(ctx.virtual_now, data.settings.time_zone), INFRA);
  log(ctx, 'curbline.event_applied', {operation: event.operation, event_id: event.event_id});
  return data;
}

module.exports = {applyEvent, HANDLERS};
