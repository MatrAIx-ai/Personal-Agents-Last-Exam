'use strict';
// Trusted carrier/scenario events applied by Infra through env.apply_event. Only these
// events move a parcel physically, decide a change, or complete a handoff. An event that
// does not match the current plan revision, pickup epoch or status is rejected whole.
const crypto = require('node:crypto');
const c = require('./common.cjs');
const ch = require('./changes.cjs');
const t = require('./time.cjs');
const v = require('./views.cjs');
const {fail, TERMINAL, log, ms} = c;
const HOUR = 3600000;
const reject = message => fail('invalid_event', message);

function currentPlan(s, revision) {
  if (revision !== s.plan.revision) reject('Event refers to a superseded delivery plan.');
}
// Recipient plus anyone currently authorized to collect.
const audience = (data, s) => [s.recipient_person_id, ...data.grants.filter(g => g.shipment_id === s.id && g.status === 'active').map(g => g.collector_person_id)];
const label = s => s.contents_label + ' from ' + s.sender_label;

// Leaving a pickup arrangement ends its readiness and every credential issued for it.
function endPickup(data, s, at, reason, {consumed = null} = {}) {
  for (const p of data.passes) {
    if (p.shipment_id !== s.id || p.status !== 'active') continue;
    p.status = p === consumed ? 'consumed' : 'invalidated';
    p.ended_at = at;
    p.end_reason = p === consumed ? 'collected' : reason;
  }
  for (const g of data.grants) {
    if (g.shipment_id !== s.id || g.status !== 'active') continue;
    g.status = consumed && consumed.grant_id === g.id ? 'consumed' : 'invalidated';
    g.ended_at = at;
    g.end_reason = g.status === 'consumed' ? 'collected' : reason;
    g.history.push({at, action: g.status});
  }
  s.pickup = null;
}
// A pending request cannot outlive the plan revision it was based on.
function supersedePending(data, s, at, reason) {
  const change = data.changes.find(x => x.id === s.pending_change_id);
  if (!change) return;
  change.status = 'rejected';
  change.decided_at = at;
  change.reason = reason;
  c.touch(change, at, 'rejected');
  s.pending_change_id = null;
}
// Synthetic business credential, reproducible from the ledger; not an authentication token.
function passCode(data, s, holder, passId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.createHash('sha256').update([data.account_id, s.id, s.pickup_epoch, holder, passId].join('|')).digest();
  const code = [...bytes.subarray(0, 8)].map(b => alphabet[b % alphabet.length]).join('');
  return code.slice(0, 4) + '-' + code.slice(4);
}
function issuePass(data, s, at, holder, expiresAt, grantId = null) {
  const id = c.nextId(data.passes, 'PASS');
  const pass = {id, account_id: data.account_id, shipment_id: s.id, holder_person_id: holder, grant_id: grantId, point_id: s.pickup.point_id,
    pickup_epoch: s.pickup.epoch, code: passCode(data, s, holder, id), issued_at: at, expires_at: expiresAt, status: 'active', ended_at: null, end_reason: null};
  data.passes.push(pass);
  return pass;
}

const HANDLERS = {
  'parcel.change_resolved'(ctx, data, event, s) {
    const p = event.payload, at = event.at, change = data.changes.find(x => x.id === p.change_id && x.shipment_id === s.id);
    if (!change) reject('Change request does not exist for this parcel.');
    if (change.status !== 'pending') reject('Change request is already ' + change.status + '; a late decision cannot alter it.');
    if (p.base_plan_revision !== change.base_plan_revision) reject('Decision refers to a different plan revision than the request.');
    if (p.decision === 'rejected') {
      if (!p.reason) reject('A rejected decision must give a reason.');
      supersedePending(data, s, at, p.reason);
      c.timeline(s, at, 'change_rejected', 'Carrier declined the change: ' + p.reason + ' The delivery plan is unchanged.');
      c.notify(ctx, data, {shipment_id: s.id, at, type: 'change_rejected', audience: [s.recipient_person_id],
        message: 'The carrier declined your change for ' + label(s) + ': ' + p.reason + ' The delivery plan is unchanged.'});
      return;
    }
    currentPlan(s, change.base_plan_revision);
    // Re-check the destination at decision time; the carrier must reject instead of applying.
    const target = change.target;
    const blocked = target.mode === 'pickup' ? ch.pointReason(data, s, target.point_id, {allowCurrent: true}) : ch.addressReason(data, s, target.address_id);
    if (blocked) reject('The requested destination is no longer eligible (' + blocked + '); send a rejected decision instead.');
    const people = audience(data, s);
    if (s.plan.mode === 'pickup') endPickup(data, s, at, 'plan_changed');
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
    c.notify(ctx, data, {shipment_id: s.id, at, type: 'change_applied', audience: people, message: 'Delivery plan updated for ' + label(s) + ': ' + summary + '.'});
  },

  'parcel.transit_update'(ctx, data, event, s) {
    const p = event.payload;
    currentPlan(s, p.plan_revision);
    if (!['in_transit', 'out_for_delivery'].includes(s.status)) reject('Parcel is not moving toward its destination.');
    if (p.status === 'out_for_delivery' && s.plan.mode !== 'home') reject('Only home deliveries go out for delivery.');
    s.status = p.status;
    s.estimated_delivery = p.estimated_delivery;
    c.timeline(s, event.at, p.status, p.status === 'out_for_delivery' ? 'Out for delivery.' : 'In transit' + (p.estimated_delivery ? '; estimated delivery ' + p.estimated_delivery + '.' : '.'), 'transit_update');
  },

  'parcel.delivery_failed'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'home' || !['in_transit', 'out_for_delivery'].includes(s.status)) reject('Only a parcel on its way to a home address can have a failed delivery.');
    const deadline = c.iso(ms(at) + c.policyOf(data, s).failure_action_hours * HOUR);
    s.status = 'attempt_failed';
    s.attempt = {at, reason: p.reason, action_deadline: deadline};
    c.timeline(s, at, 'delivery_failed', 'Delivery attempt failed: ' + p.reason + ' Choose a new delivery option by ' + deadline + '.');
    c.notify(ctx, data, {shipment_id: s.id, at, type: 'delivery_failed', audience: [s.recipient_person_id],
      message: 'Delivery of ' + label(s) + ' failed: ' + p.reason + ' Choose redelivery, a hold or a pickup point by ' + deadline + '.'});
  },

  'parcel.delivered'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'home' || !['in_transit', 'out_for_delivery'].includes(s.status)) reject('Only a parcel on its way to a home address can be delivered.');
    supersedePending(data, s, at, 'The parcel was delivered before the carrier decided this request.');
    s.status = 'delivered';
    s.completed_at = at;
    c.timeline(s, at, 'delivered', 'Delivered to ' + c.byId(data.addresses, s.plan.address_id, 'Address').label + '.');
    c.notify(ctx, data, {shipment_id: s.id, at, type: 'delivered', audience: [s.recipient_person_id], message: label(s) + ' was delivered.'});
  },

  // Arrival at the planned point starts a new pickup epoch and its deadline exactly once.
  'parcel.pickup_ready'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'pickup' || s.plan.point_id !== p.point_id) reject('Parcel is not planned for that pickup point.');
    if (s.status === 'at_pickup') reject('Parcel is already ready at this point; a repeated arrival cannot extend its deadline.');
    if (s.status !== 'in_transit') reject('Parcel is not on its way to a pickup point.');
    const point = c.pointOf(data, p.point_id);
    if (point.status !== 'open') reject('A closed pickup point cannot receive parcels.');
    const deadline = c.iso(ms(at) + c.policyOf(data, s).pickup_window_hours * HOUR);
    s.pickup_epoch += 1;
    s.pickup = {point_id: point.id, epoch: s.pickup_epoch, ready_at: at, deadline};
    s.status = 'at_pickup';
    issuePass(data, s, at, s.recipient_person_id, deadline);
    c.timeline(s, at, 'pickup_ready', 'Ready for pickup at ' + point.name + ' until ' + deadline + '.');
    c.notify(ctx, data, {shipment_id: s.id, at, type: 'pickup_ready', audience: [s.recipient_person_id],
      message: label(s) + ' is ready at ' + point.name + ' until ' + deadline + '.'});
  },

  // A closure blocks collection but never moves the pickup deadline.
  'parcel.point_status'(ctx, data, event) {
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
      c.notify(ctx, data, {shipment_id: s.id, at, type: closed ? 'point_closed' : 'point_reopened', audience: audience(data, s),
        message: point.name + (closed ? ' is closed' + (p.note ? ': ' + p.note : '.') + (s.pickup ? ' The pickup deadline ' + s.pickup.deadline + ' is unchanged.' : '')
          : ' has reopened.' + (s.pickup ? ' The pickup deadline is still ' + s.pickup.deadline + '.' : ''))});
    }
  },

  // The carrier moves the parcel to another point: old readiness and credentials end now,
  // and nothing can be collected until it actually arrives at the new point.
  'parcel.carrier_relocated'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    currentPlan(s, p.plan_revision);
    if (s.plan.mode !== 'pickup' || !['in_transit', 'at_pickup'].includes(s.status)) reject('Only a parcel bound for or waiting at a pickup point can be relocated.');
    if (p.to_point_id === s.plan.point_id) reject('Parcel is already planned for that pickup point.');
    const to = c.pointOf(data, p.to_point_id);
    if (to.status !== 'open') reject('A closed pickup point cannot receive parcels.');
    const people = audience(data, s);
    supersedePending(data, s, at, 'The carrier moved the parcel to another pickup point before deciding this request.');
    endPickup(data, s, at, 'relocated');
    s.plan = {revision: s.plan.revision + 1, mode: 'pickup', address_id: null, point_id: to.id, delivery_date: null, hold_until: null};
    s.status = 'in_transit';
    c.timeline(s, at, 'relocated', 'Carrier is moving the parcel to ' + to.name + ': ' + p.reason + ' Earlier pickup passes are no longer valid.');
    c.notify(ctx, data, {shipment_id: s.id, at, type: 'relocated', audience: people,
      message: label(s) + ' is being moved to ' + to.name + ': ' + p.reason + ' Earlier pickup passes are no longer valid; wait for the new ready notice.'});
  },

  // Physical handoff. Every check must pass or nothing changes: a failed attempt never
  // consumes a pass, and the first valid handoff closes the parcel for all later ones.
  'parcel.collected'(ctx, data, event, s) {
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
      if (!grant || !c.liveGrant({virtual_now: at}, s, grant)) reject('The collection authorization is no longer valid.');
    }
    const people = audience(data, s), collector = c.personName(ctx, p.collector_person_id) ?? 'the authorized collector';
    supersedePending(data, s, at, 'The parcel was collected before the carrier decided this request.');
    endPickup(data, s, at, 'collected_by_another_pass', {consumed: pass});
    s.status = 'collected';
    s.completed_at = at;
    c.timeline(s, at, 'collected', 'Collected at ' + point.name + ' by ' + collector + '.');
    c.notify(ctx, data, {shipment_id: s.id, at, type: 'collected', audience: people, message: label(s) + ' was collected at ' + point.name + ' by ' + collector + '.'});
  },

  'parcel.deadline_reached'(ctx, data, event, s) {
    const p = event.payload, at = event.at;
    if (p.deadline !== 'hold_end') fail('not_implemented', 'Pickup and failed-delivery deadlines are not implemented yet.');
    if (s.plan.mode !== 'hold' || s.status !== 'in_transit') reject('Parcel is not on hold.');
    if (ms(at) < t.startOfDay(s.plan.hold_until, data.carrier.time_zone)) reject('The hold has not ended yet.');
    // Ending a hold only allows delivery to resume; it never delivers the parcel.
    supersedePending(data, s, at, 'The hold ended before the carrier decided this request.');
    s.plan = {revision: s.plan.revision + 1, mode: 'home', address_id: s.plan.address_id, point_id: null, delivery_date: null, hold_until: null};
    s.estimated_delivery = null;
    c.timeline(s, at, 'hold_ended', 'Hold ended; delivery to ' + c.byId(data.addresses, s.plan.address_id, 'Address').label + ' will be scheduled.');
    c.notify(ctx, data, {shipment_id: s.id, at, type: 'hold_ended', audience: [s.recipient_person_id], message: 'The hold on ' + label(s) + ' has ended. Delivery will be scheduled.'});
  }
};
const PLANNED = ['parcel.return_completed'];

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail(PLANNED.includes(event.operation) ? 'not_implemented' : 'invalid_event', 'Unsupported event operation.');
  let shipment;
  if ('shipment_id' in event.payload) {
    shipment = data.shipments.find(s => s.id === event.payload.shipment_id);
    if (!shipment) reject('Parcel does not exist.');
    if (TERMINAL.includes(shipment.status)) reject('Parcel already reached a terminal outcome.');
    if (shipment.status === 'returning') reject('Parcel is being returned; only return completion can advance it.');
    if (ms(event.at) < ms(shipment.updated_at)) reject('Event precedes the last update of this parcel.');
  }
  handler(ctx, data, event, shipment);
  log(ctx, c.APP + '.event_prepared', {event_id: event.event_id, operation: event.operation, shipment_id: event.payload.shipment_id ?? null});
  return data;
}

module.exports = {applyEvent};
