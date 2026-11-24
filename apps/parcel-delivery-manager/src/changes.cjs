'use strict';
// Delivery-change eligibility shared by options, preview and submit, so a preview and the
// submission that follows it are judged by exactly the same rules at the committed clock.
const crypto = require('node:crypto');
const c = require('./common.cjs');
const t = require('./time.cjs');
const {fail, ms, now, TERMINAL} = c;
const HOUR = 3600000;

const KINDS = {
  reschedule: {modes: ['home'], required: ['delivery_date'], optional: [], permitted: p => p.allow_reschedule},
  address: {modes: ['home'], required: ['address_id'], optional: ['delivery_date'], permitted: p => p.allow_address_change},
  hold: {modes: ['home', 'hold'], required: ['hold_until'], optional: [], permitted: p => p.allow_hold},
  redirect: {modes: ['home', 'hold', 'pickup'], required: ['point_id'], optional: [], permitted: p => p.allow_pickup_redirect},
  // Returning to home delivery reverses a redirect or ends a hold early.
  home_delivery: {modes: ['pickup', 'hold'], required: ['address_id'], optional: ['delivery_date'],
    permitted: (p, s) => (s.plan.mode === 'pickup' ? p.allow_pickup_redirect : p.allow_hold)}
};
const MESSAGES = {
  parcel_closed: 'This parcel has already been delivered, collected or returned.',
  return_started: 'This parcel is being returned to the sender and can no longer be changed.',
  change_pending: 'Another change for this parcel is still waiting for the carrier. Cancel it or wait for the decision.',
  out_for_delivery: 'The parcel is out for delivery and can no longer be changed.',
  cutoff_passed: 'The change cutoff for this delivery has passed.',
  deadline_passed: 'The deadline for acting on this parcel has passed.',
  not_applicable: 'This kind of change does not apply to the parcel\'s current delivery plan.',
  not_permitted: 'The parcel\'s delivery policy does not permit this kind of change.',
  date_out_of_range: 'The requested date is outside the allowed range for this parcel.',
  no_change: 'The request matches the current delivery plan.',
  unknown_address: 'That address is not one of the recipient\'s saved addresses.',
  address_not_verified: 'That address has not been verified for delivery.',
  restricted_destination: 'The carrier does not deliver this parcel to that address.',
  unknown_point: 'That pickup point does not exist.',
  point_not_eligible: 'That pickup point cannot accept this parcel.',
  point_closed: 'That pickup point is currently closed.',
  stale_confirmation: 'The parcel changed after the preview, or the confirmation does not match this request. Preview again.',
  too_late: 'The carrier has already decided this change, or it was already withdrawn.'
};

// The instant after which the recipient can no longer act on the parcel, or null.
function cutoffAt(data, s) {
  if (s.status === 'at_pickup') return ms(s.pickup.deadline);
  if (s.status === 'attempt_failed') return ms(s.attempt.action_deadline);
  if (s.status !== 'in_transit') return null;
  const day = s.plan.mode === 'home' ? s.plan.delivery_date : s.plan.mode === 'hold' ? s.plan.hold_until : null;
  return day ? t.startOfDay(day, data.carrier.time_zone) - c.policyOf(data, s).change_cutoff_hours * HOUR : null;
}
function gate(ctx, data, s) {
  if (TERMINAL.includes(s.status)) return 'parcel_closed';
  if (s.status === 'returning') return 'return_started';
  if (s.pending_change_id) return 'change_pending';
  if (s.status === 'out_for_delivery') return 'out_for_delivery';
  const cutoff = cutoffAt(data, s);
  if (cutoff !== null && now(ctx) >= cutoff) return s.status === 'in_transit' ? 'cutoff_passed' : 'deadline_passed';
  return null;
}
function kindGate(ctx, data, s, kind) {
  const spec = KINDS[kind];
  return gate(ctx, data, s) ?? (!spec.modes.includes(s.plan.mode) ? 'not_applicable' : !spec.permitted(c.policyOf(data, s), s) ? 'not_permitted' : null);
}
function windows(ctx, data, s) {
  const policy = c.policyOf(data, s), today = t.localDate(now(ctx), data.carrier.time_zone);
  const planned = s.plan.delivery_date ?? s.estimated_delivery ?? today, base = planned > today ? planned : today;
  // A delivery can be moved later than currently planned, never earlier.
  return {today, earliest: t.addDays(today, 1), earliestReschedule: t.addDays(base, 1), latestDelivery: t.addDays(base, policy.max_reschedule_days), latestHold: t.addDays(today, policy.max_hold_days)};
}
const within = (day, earliest, latest) => day >= earliest && day <= latest;

function addressReason(data, s, id) {
  const a = data.addresses.find(x => x.id === id && x.person_id === s.recipient_person_id);
  return !a ? 'unknown_address' : !a.verified ? 'address_not_verified' : a.delivery_restricted ? 'restricted_destination' : null;
}
function pointReason(data, s, id, {allowCurrent = false} = {}) {
  const p = data.pickup_points.find(x => x.id === id);
  if (!p) return 'unknown_point';
  if (!p.accepts_redirects || !c.policyOf(data, s).allowed_point_kinds.includes(p.kind)) return 'point_not_eligible';
  if (p.status !== 'open') return 'point_closed';
  return !allowCurrent && s.plan.mode === 'pickup' && s.plan.point_id === id ? 'no_change' : null;
}
const eligibleAddresses = (data, s, {excludeCurrent}) => data.addresses
  .filter(a => !addressReason(data, s, a.id) && !(excludeCurrent && a.id === s.plan.address_id)).map(a => a.id);
const eligiblePoints = (data, s) => data.pickup_points.filter(p => !pointReason(data, s, p.id)).map(p => p.id);

function target(ctx, data, s, input) {
  const plan = s.plan, w = windows(ctx, data, s);
  const home = (address_id, delivery_date) => ({mode: 'home', address_id, point_id: null, delivery_date, hold_until: null});
  const dateReason = (day, earliest = w.earliest) => (day === undefined || within(day, earliest, w.latestDelivery) ? null : 'date_out_of_range');
  switch (input.kind) {
    case 'reschedule':
      return {reason: input.delivery_date === plan.delivery_date ? 'no_change' : dateReason(input.delivery_date, w.earliestReschedule), target: home(plan.address_id, input.delivery_date)};
    case 'address':
      return {reason: addressReason(data, s, input.address_id) ?? (input.address_id === plan.address_id ? 'no_change' : null) ?? dateReason(input.delivery_date),
        target: home(input.address_id, input.delivery_date ?? plan.delivery_date)};
    case 'hold':
      return {reason: !within(input.hold_until, w.earliest, w.latestHold) ? 'date_out_of_range' : input.hold_until === plan.hold_until ? 'no_change' : null,
        target: {mode: 'hold', address_id: plan.address_id, point_id: null, delivery_date: null, hold_until: input.hold_until}};
    case 'redirect':
      return {reason: pointReason(data, s, input.point_id), target: {mode: 'pickup', address_id: null, point_id: input.point_id, delivery_date: null, hold_until: null}};
    case 'home_delivery':
      return {reason: addressReason(data, s, input.address_id) ?? dateReason(input.delivery_date), target: home(input.address_id, input.delivery_date ?? null)};
  }
}

function describe(data, plan) {
  if (plan.mode === 'pickup') {
    const p = c.pointOf(data, plan.point_id);
    return 'Send the parcel to pickup point ' + p.name + ' (' + p.address_text + ')';
  }
  const a = c.byId(data.addresses, plan.address_id, 'Address'), where = a.label + ' (' + a.line1 + ', ' + a.city + ')';
  if (plan.mode === 'hold') return 'Hold the parcel until ' + plan.hold_until + ', then deliver to ' + where;
  return 'Deliver to ' + where + (plan.delivery_date ? ' on ' + plan.delivery_date : ' on the next available delivery day');
}
// Bound to the parcel revision that was previewed, so any later parcel change makes it stale.
function confirmation(s, kind, proposed) {
  return 'cf-' + crypto.createHash('sha256').update(JSON.stringify([s.id, s.updated_at, s.plan.revision, s.status, s.pickup_epoch, kind, proposed])).digest('hex').slice(0, 24);
}

function evaluate(ctx, data, s, input) {
  const spec = KINDS[input.kind];
  const fields = Object.keys(input).filter(k => k !== 'kind');
  if (spec.required.some(k => !(k in input)) || fields.some(k => ![...spec.required, ...spec.optional].includes(k))) {
    fail('invalid_arguments', 'A ' + input.kind + ' change takes ' + [...spec.required, ...spec.optional.map(k => k + ' (optional)')].join(', ') + '.');
  }
  for (const k of ['delivery_date', 'hold_until']) if (k in input && !t.validDay(input[k])) fail('invalid_arguments', k + ' is not a calendar date.');
  let reason = kindGate(ctx, data, s, input.kind), proposed = null;
  if (!reason) ({reason, target: proposed} = target(ctx, data, s, input));
  if (reason) return {allowed: false, reason, summary: MESSAGES[reason], confirmation: null, target: null};
  return {allowed: true, reason: null, target: proposed, confirmation: confirmation(s, input.kind, proposed),
    summary: describe(data, proposed) + '. This is a request: the delivery plan changes only after the carrier applies it.'};
}

function options(ctx, data, s) {
  const w = windows(ctx, data, s), cutoff = cutoffAt(data, s), policy = c.policyOf(data, s);
  const kind = name => { const reason = kindGate(ctx, data, s, name); return {allowed: !reason, reason}; };
  const reschedule = kind('reschedule'), address = kind('address'), hold = kind('hold'), redirect = kind('redirect'), home = kind('home_delivery');
  const delegationReason = TERMINAL.includes(s.status) ? 'parcel_closed' : s.status === 'returning' ? 'return_started' : !policy.allow_delegation ? 'not_permitted'
    : s.status !== 'at_pickup' ? 'not_ready' : now(ctx) >= ms(s.pickup.deadline) ? 'deadline_passed' : null;
  return {
    shipment_id: s.id, plan_revision: s.plan.revision, cutoff_at: cutoff === null ? null : c.iso(cutoff),
    reschedule: {...reschedule, earliest_date: reschedule.allowed ? w.earliestReschedule : null, latest_date: reschedule.allowed ? w.latestDelivery : null},
    address: {...address, address_ids: address.allowed ? eligibleAddresses(data, s, {excludeCurrent: true}) : []},
    hold: {...hold, latest_date: hold.allowed ? w.latestHold : null},
    redirect: {...redirect, point_ids: redirect.allowed ? eligiblePoints(data, s) : []},
    home_delivery: {...home, address_ids: home.allowed ? eligibleAddresses(data, s, {excludeCurrent: false}) : []},
    delegation: {allowed: !delegationReason, reason: delegationReason}
  };
}

module.exports = {KINDS, MESSAGES, cutoffAt, evaluate, options, describe, addressReason, pointReason};
