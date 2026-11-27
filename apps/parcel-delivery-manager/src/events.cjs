'use strict';
// Trusted carrier/scenario events applied by Infra through env.apply_event. Only these
// events move a parcel physically, decide a change, complete a handoff or start a return.
// An event that does not match the current plan revision, pickup epoch or status is
// rejected whole, so a late or repeated event can never overwrite newer state.
const c = require('./common.cjs');
const ch = require('./changes.cjs');
const cr = require('./credentials.cjs');
const t = require('./time.cjs');
const v = require('./views.cjs');
const {fail, TERMINAL, log, ms} = c;
const HOUR = 3600000;
const reject = message => fail('invalid_event', message);

function currentPlan(s, revision) {
  if (revision !== s.plan.revision) reject('Event refers to a superseded delivery plan.');
}
// Recipient-facing description. Collectors are never sent the sender, addresses or plan.
const label = s => s.contents_label + ' from ' + s.sender_label;
const toRecipient = (ctx, data, s, at, type, message) => c.notify(ctx, data, {shipment_id: s.id, at, type, audience: [s.recipient_person_id], message});
const liveCollectors = (ctx, data, s) => data.grants.filter(g => g.shipment_id === s.id && c.liveGrant(ctx, s, g)).map(g => g.collector_person_id);

// A pending request cannot outlive the plan revision it was based on. The stored reason
// starts with a stable code, for example `return_started: ...`.
function closePending(data, s, at, code, sentence) {
  const change = data.changes.find(x => x.id === s.pending_change_id);
  if (!change) return;
  change.status = 'rejected';
  change.decided_at = at;
  change.reason = code + ': ' + sentence;
  c.touch(change, at, 'rejected');
  s.pending_change_id = null;
}
// Expiry starts return processing; it never fabricates the physical return itself.
function startReturn(ctx, data, s, at, reason) {
  closePending(data, s, at, 'return_started', 'The parcel entered return processing before the carrier decided this request.');
  cr.endPickup(data, s, at, 'return_started');
  s.attempt = null;
  s.status = 'returning';
  s.return_info = {started_at: at, reason, completed_at: null};
  c.timeline(s, at, 'return_started', 'Return to sender started: ' + reason + ' The parcel can no longer be changed or collected.');
  toRecipient(ctx, data, s, at, 'return_started', label(s) + ' is being returned to the sender: ' + reason + ' It can no longer be changed or collected.');
}

const DEADLINES = {
  // Ending a hold only allows delivery to resume; it never delivers the parcel.
  hold_end(ctx, data, s, at) {
    if (s.plan.mode !== 'hold' || s.status !== 'in_transit') reject('Parcel is not on hold.');
    if (ms(at) < t.startOfDay(s.plan.hold_until, data.carrier.time_zone)) reject('The hold has not ended yet.');
    closePending(data, s, at, 'hold_ended', 'The hold ended before the carrier decided this request.');
    s.plan = {revision: s.plan.revision + 1, mode: 'home', address_id: s.plan.address_id, point_id: null, delivery_date: null, hold_until: null};
    s.estimated_delivery = null;
    c.timeline(s, at, 'hold_ended', 'Hold ended; delivery to ' + c.byId(data.addresses, s.plan.address_id, 'Address').label + ' will be scheduled.');
    toRecipient(ctx, data, s, at, 'hold_ended', 'The hold on ' + label(s) + ' has ended. Delivery will be scheduled.');
  },
  pickup(ctx, data, s, at) {
    if (s.status !== 'at_pickup') reject('Parcel is not waiting at a pickup point.');
    if (ms(at) < ms(s.pickup.deadline)) reject('The pickup deadline has not been reached yet.');
    startReturn(ctx, data, s, at, 'It was not collected from ' + c.pointOf(data, s.pickup.point_id).name + ' by the pickup deadline ' + s.pickup.deadline + '.');
  },
  failure_action(ctx, data, s, at) {
    if (s.status !== 'attempt_failed') reject('Parcel has no failed delivery waiting for action.');
    if (ms(at) < ms(s.attempt.action_deadline)) reject('The action deadline has not been reached yet.');
    startReturn(ctx, data, s, at, 'No delivery option was chosen by ' + s.attempt.action_deadline + ' after the failed delivery attempt (' + s.attempt.reason + ').');
  }
};

const HANDLERS = {
  'carrier.change_resolved'(ctx, data, event, s) {
    const p = event.payload, at = event.at, change = data.changes.find(x => x.id === p.change_id && x.shipment_id === s.id);
    if (!change) reject('Change request does not exist for this parcel.');
    if (change.status !== 'pending') reject('Change request is already ' + change.status + '; a late decision cannot alter it.');
    if (p.base_plan_revision !== change.base_plan_revision) reject('Decision refers to a different plan revision than the request.');
    if (p.decision === 'rejected') {
      if (!p.reason) reject('A rejected decision must give a reason.');
      change.status = 'rejected';
      change.decided_at = at;
      change.reason = p.reason;
      c.touch(change, at, 'rejected');
      s.pending_change_id = null;
      c.timeline(s, at, 'change_rejected', 'Carrier declined the change: ' + p.reason + ' The delivery plan is unchanged.');
      toRecipient(ctx, data, s, at, 'change_rejected', 'The carrier declined your change for ' + label(s) + ': ' + p.reason + ' The delivery plan is unchanged.');
      return;
    }
    currentPlan(s, change.base_plan_revision);
    // Re-check the destination at decision time; the carrier must reject instead of applying.
    const target = change.target;
    const blocked = target.mode === 'pickup' ? ch.pointReason(data, s, target.point_id, {allowCurrent: true}) : ch.addressReason(data, s, target.address_id);
    if (blocked) reject('The requested destination is no longer eligible (' + blocked + '); send a rejected decision instead.');
    if (s.plan.mode === 'pickup') cr.endPickup(data, s, at, 'plan_changed');
    s.plan = {revision: s.plan.revision + 1, ...target};
    s.status = 'in_transit';
    s.attempt = null;
    s.estimated_delivery = target.mode === 'home' ? target.delivery_date : null;
    s.pending_change_id = null;
    change.status = 'applied';
    change.decided_at = at;
    c.touch(change, at, 'applied');
    const summary = ch.describe(data, s.plan);
    c.timeline(s, at, 'change_applied', 'Carrier applied the change: ' + summary + '.');
    toRecipient(ctx, data, s, at, 'change_applied', 'Delivery plan updated for ' + label(s) + ': ' + summary + '.');
  },

  'carrier.transit_update'(ctx, data, event, s) {
    const p = event.payload;
    currentPlan(s, p.plan_revision);
    if (!['in_transit', 'out_for_delivery'].includes(s.status)) reject('Parcel is not moving toward its destination.');
    if (p.status === 'out_for_delivery' && s.plan.mode !== 'home') reject('Only home deliveries go out for delivery.');
    s.status = p.status;
    s.estimated_delivery = p.estimated_delivery;
    c.timeline(s, event.at, p.status, p.status === 'out_for_delivery' ? 'Out for delivery.' : 'In transit' + (p.estimated_delivery ? '; estimated delivery ' + p.estimated_delivery + '.' : '.'), 'transit_update');
  },

  'carrier.delivery_failed'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'home' || !['in_transit', 'out_for_delivery'].includes(s.status)) reject('Only a parcel on its way to a home address can have a failed delivery.');
    const deadline = c.iso(ms(at) + c.policyOf(data, s).failure_action_hours * HOUR);
    s.status = 'attempt_failed';
    s.attempt = {at, reason: p.reason, action_deadline: deadline};
    c.timeline(s, at, 'delivery_failed', 'Delivery attempt failed: ' + p.reason + ' Choose a new delivery option by ' + deadline + ', or the parcel will be returned.');
    toRecipient(ctx, data, s, at, 'delivery_failed', 'Delivery of ' + label(s) + ' failed: ' + p.reason + ' Choose redelivery, a hold or a pickup point by ' + deadline + ', or the parcel will be returned.');
  },

  'carrier.delivered'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'home' || !['in_transit', 'out_for_delivery'].includes(s.status)) reject('Only a parcel on its way to a home address can be delivered.');
    closePending(data, s, at, 'delivered', 'The parcel was delivered before the carrier decided this request.');
    s.status = 'delivered';
    s.completed_at = at;
    c.timeline(s, at, 'delivered', 'Delivered to ' + c.byId(data.addresses, s.plan.address_id, 'Address').label + '.');
    toRecipient(ctx, data, s, at, 'delivered', label(s) + ' was delivered.');
  },

  // Arrival at the planned point starts the next pickup epoch and its deadline exactly once.
  'carrier.pickup_ready'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'pickup' || s.plan.point_id !== p.point_id) reject('Parcel is not planned for that pickup point.');
    if (s.status === 'at_pickup') reject('Parcel is already ready at this point; a repeated arrival cannot extend its deadline.');
    if (s.status !== 'in_transit') reject('Parcel is not on its way to a pickup point.');
    if (p.pickup_epoch !== s.pickup_epoch + 1) reject('This arrival must start pickup epoch ' + (s.pickup_epoch + 1) + '.');
    const point = c.pointOf(data, p.point_id);
    if (point.status !== 'open') reject('A closed pickup point cannot receive parcels.');
    const deadline = c.iso(ms(at) + c.policyOf(data, s).pickup_window_hours * HOUR);
    s.pickup_epoch = p.pickup_epoch;
    s.pickup = {point_id: point.id, epoch: p.pickup_epoch, ready_at: at, deadline};
    s.status = 'at_pickup';
    // The recipient's own entitlement; no self-delegation grant is involved.
    cr.issuePass(data, s, at, s.recipient_person_id, deadline);
    c.timeline(s, at, 'pickup_ready', 'Ready for pickup at ' + point.name + ' until ' + deadline + '.');
    toRecipient(ctx, data, s, at, 'pickup_ready', label(s) + ' is ready at ' + point.name + ' until ' + deadline + '.');
  },

  // A closure blocks collection but never moves the pickup deadline.
  'carrier.point_status'(ctx, data, event) {
    const p = event.payload, at = event.at, point = c.pointOf(data, p.point_id);
    if (point.status === p.status && point.status_note === p.note) reject('Pickup point status is unchanged.');
    if (ms(at) < ms(point.updated_at)) reject('Event precedes the last update of this pickup point.');
    const changed = point.status !== p.status;
    point.status = p.status;
    point.status_note = p.note;
    point.updated_at = at;
    if (!changed) return;
    for (const s of data.shipments) {
      if (s.plan.mode !== 'pickup' || s.plan.point_id !== point.id || TERMINAL.includes(s.status) || s.status === 'returning') continue;
      const closed = p.status === 'closed';
      const deadline = s.pickup ? ' The pickup deadline ' + s.pickup.deadline + ' is unchanged.' : '';
      // Sent to the recipient and to collectors with a current authorization; names only the point.
      c.notify(ctx, data, {shipment_id: s.id, at, type: closed ? 'point_closed' : 'point_reopened', audience: [s.recipient_person_id, ...liveCollectors(ctx, data, s)],
        message: point.name + (closed ? ' is closed' + (p.note ? ': ' + p.note : '.') : ' has reopened.') + deadline});
    }
  },

  // The carrier moves the parcel to another point: old readiness and credentials end now,
  // and nothing can be collected until it actually arrives at the new point.
  'carrier.relocated'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'pickup' || !['in_transit', 'at_pickup'].includes(s.status)) reject('Only a parcel bound for or waiting at a pickup point can be relocated.');
    if (p.to_point_id === s.plan.point_id) reject('Parcel is already planned for that pickup point.');
    const to = c.pointOf(data, p.to_point_id);
    if (to.status !== 'open') reject('A closed pickup point cannot receive parcels.');
    closePending(data, s, at, 'relocated', 'The carrier moved the parcel to another pickup point before deciding this request.');
    cr.endPickup(data, s, at, 'relocated');
    s.plan = {revision: s.plan.revision + 1, mode: 'pickup', address_id: null, point_id: to.id, delivery_date: null, hold_until: null};
    s.status = 'in_transit';
    c.timeline(s, at, 'relocated', 'Carrier is moving the parcel to ' + to.name + ': ' + p.reason + ' Earlier pickup passes and authorizations are no longer valid.');
    toRecipient(ctx, data, s, at, 'relocated', label(s) + ' is being moved to ' + to.name + ': ' + p.reason +
      ' Earlier pickup passes and authorizations are no longer valid; wait for the new ready notice.');
  },

  // Physical handoff. Every check must pass or nothing changes: a failed attempt never
  // consumes a pass, and the first valid handoff closes the parcel for all later ones.
  'carrier.collected'(ctx, data, event, s) {
    const p = event.payload, at = event.at, when = ms(at);
    if (s.status !== 'at_pickup') reject('Parcel is not ready for collection.');
    if (s.pickup.point_id !== p.point_id || s.pickup.epoch !== p.pickup_epoch) reject('Collection does not match the current pickup point and arrival.');
    const point = c.pointOf(data, p.point_id);
    if (!v.openAt(point, when)) reject('The pickup point is closed at this time.');
    if (when >= ms(s.pickup.deadline)) reject('The pickup deadline has passed.');
    const pass = data.passes.find(x => x.shipment_id === s.id && x.holder_person_id === p.collector_person_id && x.status === 'active');
    if (!pass || pass.code !== p.pass_code || pass.pickup_epoch !== s.pickup.epoch || pass.point_id !== s.pickup.point_id) reject('No valid collection pass was presented.');
    if (when >= ms(pass.expires_at)) reject('The collection pass has expired.');
    if (pass.grant_id) {
      const grant = data.grants.find(g => g.id === pass.grant_id);
      if (!grant || !c.liveGrant(ctx, s, grant)) reject('The collection authorization is no longer valid.');
    }
    const collector = c.personName(ctx, p.collector_person_id) ?? 'the authorized collector';
    closePending(data, s, at, 'collected', 'The parcel was collected before the carrier decided this request.');
    cr.endPickup(data, s, at, 'collected_with_another_pass', {consumed: pass});
    s.status = 'collected';
    s.completed_at = at;
    c.timeline(s, at, 'collected', 'Collected at ' + point.name + ' by ' + collector + '.');
    toRecipient(ctx, data, s, at, 'collected', label(s) + ' was collected at ' + point.name + ' by ' + collector + '.');
  },

  'carrier.deadline_reached'(ctx, data, event, s) {
    DEADLINES[event.payload.deadline](ctx, data, s, event.at);
  },

  // Only this trusted event completes the physical return.
  'carrier.return_completed'(ctx, data, event, s) {
    const at = event.at;
    if (s.status !== 'returning') reject('Parcel is not being returned.');
    s.status = 'returned';
    s.return_info.completed_at = at;
    s.completed_at = at;
    c.timeline(s, at, 'returned', 'Returned to the sender.');
    toRecipient(ctx, data, s, at, 'returned', label(s) + ' was returned to the sender.');
  }
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) reject('Unsupported event operation.');
  let shipment;
  if ('shipment_id' in event.payload) {
    shipment = data.shipments.find(s => s.id === event.payload.shipment_id);
    if (!shipment) reject('Parcel does not exist.');
    if (TERMINAL.includes(shipment.status)) reject('Parcel already reached a terminal outcome.');
    if (shipment.status === 'returning' && event.operation !== 'carrier.return_completed') reject('Parcel is being returned; only return completion can advance it.');
    if (ms(event.at) < ms(shipment.updated_at)) reject('Event precedes the last update of this parcel.');
  }
  handler(ctx, data, event, shipment);
  log(ctx, c.APP + '.event_prepared', {event_id: event.event_id, operation: event.operation, shipment_id: event.payload.shipment_id ?? null});
  return data;
}

module.exports = {applyEvent};
