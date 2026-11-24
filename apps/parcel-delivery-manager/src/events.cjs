'use strict';
// Trusted carrier/scenario events applied by Infra through env.apply_event. Events that do
// not match the current plan revision, pickup epoch or status are rejected without changes.
const c = require('./common.cjs');
const {fail, TERMINAL, log} = c;

function currentPlan(s, revision) {
  if (revision !== s.plan.revision) fail('invalid_event', 'Event refers to a superseded delivery plan.');
}

const HANDLERS = {
  'parcel.transit_update'(ctx, data, event) {
    const p = event.payload, s = c.shipmentOf(data, p.shipment_id);
    currentPlan(s, p.plan_revision);
    if (!['in_transit', 'out_for_delivery'].includes(s.status)) fail('invalid_event', 'Parcel is not moving toward its destination.');
    if (p.status === 'out_for_delivery' && s.plan.mode !== 'home') fail('invalid_event', 'Only home deliveries go out for delivery.');
    s.status = p.status;
    s.estimated_delivery = p.estimated_delivery;
    c.timeline(s, event.at, p.status, p.status === 'out_for_delivery' ? 'Out for delivery.' : 'In transit' + (p.estimated_delivery ? '; estimated delivery ' + p.estimated_delivery + '.' : '.'), 'transit_update');
  }
};
const PLANNED = ['parcel.change_resolved', 'parcel.delivery_failed', 'parcel.delivered', 'parcel.pickup_ready', 'parcel.point_status',
  'parcel.carrier_relocated', 'parcel.collected', 'parcel.deadline_reached', 'parcel.return_completed'];

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail(PLANNED.includes(event.operation) ? 'not_implemented' : 'invalid_event', 'Unsupported event operation.');
  const shipment = event.payload.shipment_id && data.shipments.find(s => s.id === event.payload.shipment_id);
  if (shipment && TERMINAL.includes(shipment.status)) fail('invalid_event', 'Parcel already reached a terminal outcome.');
  handler(ctx, data, event);
  log(ctx, c.APP + '.event_prepared', {event_id: event.event_id, operation: event.operation, shipment_id: event.payload.shipment_id ?? null});
  return data;
}

module.exports = {applyEvent};
