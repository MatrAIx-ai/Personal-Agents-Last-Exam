'use strict';
// Read-only projections. A delegate sees only collection details for a parcel they are
// currently authorized to collect; reads never write state or materialize expiry.
const c = require('./common.cjs');
const {copy, ms, now} = c;

function deadlines(ctx, s) {
  const at = now(ctx), out = [];
  if (s.pickup && s.status === 'at_pickup') out.push({kind: 'pickup', at: s.pickup.deadline});
  if (s.attempt && s.status === 'attempt_failed') out.push({kind: 'failure_action', at: s.attempt.action_deadline});
  if (s.plan.mode === 'hold' && !c.TERMINAL.includes(s.status) && s.status !== 'returning') out.push({kind: 'hold_end', at: s.plan.hold_until + 'T00:00:00Z'});
  return out.map(d => ({...d, passed: at >= ms(d.at)}));
}

function summary(ctx, data, s, access) {
  const recipient = access === 'recipient';
  return {
    id: s.id, access, tracking_number: recipient ? s.tracking_number : null, sender_label: recipient ? s.sender_label : null,
    contents_label: s.contents_label, status: s.status, plan_mode: recipient ? s.plan.mode : null, updated_at: s.updated_at,
    pickup_deadline: s.pickup?.deadline ?? null, deadline_passed: deadlines(ctx, s).some(d => d.passed),
    has_pending_change: recipient && Boolean(s.pending_change_id)
  };
}

function shipmentView(ctx, data, s, access) {
  if (access === 'delegate') {
    return {
      id: s.id, access, tracking_number: null, recipient_person_id: null, sender_label: null, contents_label: s.contents_label,
      policy_id: null, status: s.status, estimated_delivery: null, plan: null, pending_change: null, pickup: copy(s.pickup),
      attempt: null, return_info: null, completed_at: null, deadlines: deadlines(ctx, s).filter(d => d.kind === 'pickup'),
      timeline: [], created_at: s.created_at, updated_at: s.updated_at
    };
  }
  return {
    id: s.id, access, tracking_number: s.tracking_number, recipient_person_id: s.recipient_person_id, sender_label: s.sender_label,
    contents_label: s.contents_label, policy_id: s.policy_id, status: s.status, estimated_delivery: s.estimated_delivery,
    plan: copy(s.plan), pending_change: copy(data.changes.find(x => x.id === s.pending_change_id) ?? null),
    pickup: copy(s.pickup), attempt: copy(s.attempt), return_info: copy(s.return_info), completed_at: s.completed_at,
    deadlines: deadlines(ctx, s), timeline: copy(s.timeline), created_at: s.created_at, updated_at: s.updated_at
  };
}

// Opening hours are evaluated in the point's own time zone at the committed virtual time.
function localClock(at, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
    .formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return {weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), time: parts.hour + ':' + parts.minute};
}
function openAt(point, at) {
  if (point.status !== 'open') return false;
  const local = localClock(at, point.time_zone);
  return point.hours.some(h => h.weekday === local.weekday && h.opens <= local.time && local.time < h.closes);
}
function pointView(ctx, p) {
  const {updated_at, ...view} = copy(p);
  return {...view, open_now: openAt(p, now(ctx))};
}

module.exports = {deadlines, summary, shipmentView, pointView, openAt, localClock};
