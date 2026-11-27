'use strict';
// Read-only projections. A delegate sees only collection details for a parcel they are
// currently authorized to collect; reads never write state or materialize expiry.
const c = require('./common.cjs');
const t = require('./time.cjs');
const {copy, ms, now} = c;

function deadlines(ctx, data, s) {
  const at = now(ctx), out = [];
  if (s.pickup && s.status === 'at_pickup') out.push({kind: 'pickup', at: s.pickup.deadline});
  if (s.attempt && s.status === 'attempt_failed') out.push({kind: 'failure_action', at: s.attempt.action_deadline});
  if (s.plan.mode === 'hold' && !c.TERMINAL.includes(s.status) && s.status !== 'returning') out.push({kind: 'hold_end', at: c.iso(t.startOfDay(s.plan.hold_until, data.carrier.time_zone))});
  return out.map(d => ({...d, passed: at >= ms(d.at)}));
}

function summary(ctx, data, s, access) {
  const recipient = access === 'recipient';
  return {
    id: s.id, access, tracking_number: recipient ? s.tracking_number : null, sender_label: recipient ? s.sender_label : null,
    contents_label: s.contents_label, status: s.status, plan_mode: recipient ? s.plan.mode : null, updated_at: s.updated_at,
    pickup_deadline: s.pickup?.deadline ?? null, deadline_passed: deadlines(ctx, data, s).some(d => d.passed),
    has_pending_change: recipient && Boolean(s.pending_change_id)
  };
}

function shipmentView(ctx, data, s, access) {
  if (access === 'delegate') {
    return {
      id: s.id, access, tracking_number: null, recipient_person_id: null, sender_label: null, contents_label: s.contents_label,
      policy_id: null, status: s.status, estimated_delivery: null, plan: null, pending_change: null, pickup: copy(s.pickup),
      point: s.pickup ? pointView(ctx, c.pointOf(data, s.pickup.point_id)) : null,
      attempt: null, return_info: null, completed_at: null, deadlines: deadlines(ctx, data, s).filter(d => d.kind === 'pickup'),
      timeline: [], created_at: s.created_at, updated_at: s.updated_at
    };
  }
  return {
    id: s.id, access, tracking_number: s.tracking_number, recipient_person_id: s.recipient_person_id, sender_label: s.sender_label,
    contents_label: s.contents_label, policy_id: s.policy_id, status: s.status, estimated_delivery: s.estimated_delivery,
    plan: copy(s.plan), pending_change: copy(data.changes.find(x => x.id === s.pending_change_id) ?? null),
    pickup: copy(s.pickup), point: s.plan.mode === 'pickup' ? pointView(ctx, c.pointOf(data, s.plan.point_id)) : null, attempt: copy(s.attempt), return_info: copy(s.return_info), completed_at: s.completed_at,
    deadlines: deadlines(ctx, data, s), timeline: copy(s.timeline), created_at: s.created_at, updated_at: s.updated_at
  };
}

// Opening hours are evaluated in the point's own time zone at the given instant.
function openAt(point, at) {
  if (point.status !== 'open') return false;
  const local = t.localClock(at, point.time_zone);
  return point.hours.some(h => h.weekday === local.weekday && h.opens <= local.time && local.time < h.closes);
}
function pointView(ctx, p) {
  const {updated_at, ...view} = copy(p);
  return {...view, open_now: openAt(p, now(ctx))};
}

// A collector sees their own authorization without the recipient's other grant history.
function grantView(ctx, data, g, access) {
  const s = data.shipments.find(x => x.id === g.shipment_id);
  return {id: g.id, shipment_id: g.shipment_id, collector_person_id: g.collector_person_id, collector_name: c.personName(ctx, g.collector_person_id),
    point_id: g.point_id, pickup_epoch: g.pickup_epoch, created_at: g.created_at, expires_at: g.expires_at, status: g.status,
    valid_now: c.liveGrant(ctx, s, g), ended_at: g.ended_at, end_reason: g.end_reason, replaces_grant_id: access === 'recipient' ? g.replaces_grant_id : null};
}

module.exports = {deadlines, summary, shipmentView, pointView, openAt, grantView};
