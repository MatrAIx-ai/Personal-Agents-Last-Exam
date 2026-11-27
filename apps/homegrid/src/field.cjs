'use strict';
const {fail, premise: getPremise, zoneOf, localDate, addBusinessDays, dayOfWeek, addDays, nextId, stamp, instantOf, money} = require('./common.cjs');
const {SLOTS, DEFAULT_CAPACITY, POLICY, FEES, PLANS} = require('./catalog.cjs');
const {charge} = require('./billing.cjs');
const {notify} = require('./notify.cjs');

const OPEN = ['booked', 'technician_en_route', 'arrived'];
const slotsOn = (data, date) => (data.holidays.includes(date) ? [] : dayOfWeek(date) <= 5 ? SLOTS.weekday : dayOfWeek(date) === 6 ? SLOTS.saturday : []);
const capacity = (data, areaId, date, slot) => (data.capacity.find(c => c.area_id === areaId && c.date === date && c.slot === slot) || {capacity: DEFAULT_CAPACITY}).capacity;
const booked = (data, areaId, date, slot, except) => data.appointments.filter(a => a !== except && OPEN.includes(a.status) && a.date === date && a.slot === slot &&
  getPremise(data, data.orders.find(o => o.order_id === a.order_id).premise_id).area_id === areaId).length;
// The technician lead time counts from the order's creation (for a new order, from now). A window that has
// already started cannot be booked.
const earliestDate = (data, p, now, order) => addBusinessDays(data, localDate(order ? order.created_at : now, zoneOf(data, p.premise_id)), POLICY.technician_lead_business_days);
const windowStart = (data, premiseId, date, slot) => instantOf(date, slot.slice(0, 2) + ':00', zoneOf(data, premiseId));

function freeSlots(data, p, from, to, now, except, order) {
  const out = [], first = earliestDate(data, p, now, order);
  for (let d = from < first ? first : from; d <= to; d = addDays(d, 1)) {
    for (const slot of slotsOn(data, d)) {
      if (windowStart(data, p.premise_id, d, slot) <= Date.parse(now)) continue;
      out.push({date: d, slot, free: Math.max(0, capacity(data, p.area_id, d, slot) - booked(data, p.area_id, d, slot, except))});
    }
  }
  return out;
}
function earliestWindow(data, p, now, order) {
  const first = earliestDate(data, p, now, order), from = [first, localDate(now, zoneOf(data, p.premise_id))].sort().pop();
  return freeSlots(data, p, from, addDays(from, 30), now, null, order).find(s => s.free > 0) || null;
}
// A provider-missed installation at a premise whose internet is not yet active makes hotspot loans free.
const missedInstall = (data, premiseId) => data.appointments.some(a => a.status === 'missed_by_provider' &&
  data.orders.find(o => o.order_id === a.order_id && o.premise_id === premiseId && o.status === 'scheduled'));

function checkWindow(data, p, date, slot, now, except, order) {
  if (!slotsOn(data, date).includes(slot)) fail('invalid_date', 'No installation window then.');
  const first = earliestDate(data, p, now, order);
  if (date < first) fail('lead_time_not_met', 'The earliest window is on ' + first + '.');
  if (windowStart(data, p.premise_id, date, slot) <= Date.parse(now)) fail('invalid_date', 'That window has already started.');
  if (capacity(data, p.area_id, date, slot) - booked(data, p.area_id, date, slot, except) <= 0) fail('window_full', 'That window is full.');
}
function getAppointment(data, id) {
  const a = data.appointments.find(x => x.appointment_id === id);
  if (!a) fail('appointment_not_found', 'Appointment does not exist.');
  if (a.status !== 'booked') fail('appointment_closed', 'The appointment can no longer be changed.');
  return a;
}
// Changes inside 24 h of the window cost $25.00, charged to the next bill for each late change.
function lateFee(ctx, data, a, what) {
  const o = data.orders.find(x => x.order_id === a.order_id);
  if (Date.parse(ctx.virtual_now) < windowStart(data, o.premise_id, a.date, a.slot) - POLICY.free_change_hours * 3600e3) return 0;
  charge(data, o.premise_id, 'late_reschedule', `Late ${what} of ${a.appointment_id}`, FEES.late_reschedule, stamp(ctx, data), a.appointment_id);
  return FEES.late_reschedule;
}

function book(ctx, data, orderId, date, slot) {
  const o = data.orders.find(x => x.order_id === orderId);
  if (!o || o.status !== 'scheduled') fail('order_not_found', 'No open order with that ID.');
  if (o.needs !== 'technician') fail('no_appointment_needed', 'This order needs no installation appointment.');
  if (data.appointments.some(a => a.order_id === orderId && OPEN.includes(a.status))) fail('appointment_closed', 'The order already has an open appointment.');
  const p = getPremise(data, o.premise_id);
  checkWindow(data, p, date, slot, ctx.virtual_now, null, o);
  const a = {appointment_id: nextId(data.appointments, 'appointment_id', 'ap-' + orderId), order_id: orderId, date, slot, status: 'booked',
    history: [{at: stamp(ctx, data), action: 'booked'}]};
  data.appointments.push(a);
  const s = data.services.find(x => x.premise_id === o.premise_id && x.service_type === o.service_type);
  if (s && s.status === 'install_failed') s.status = 'pending_start';
  notify(ctx, data, {type: 'appointment', source: {kind: 'appointment', id: a.appointment_id, version: 1}, premiseId: o.premise_id, title: 'Installation booked',
    body: `A technician will come to ${p.address} on ${date}, ${slot.replace('-', ':00-')}:00.`});
  return {appointment_id: a.appointment_id};
}
function reschedule(ctx, data, id, date, slot) {
  const a = getAppointment(data, id), o = data.orders.find(x => x.order_id === a.order_id), p = getPremise(data, o.premise_id);
  checkWindow(data, p, date, slot, ctx.virtual_now, a, o);
  const fee = lateFee(ctx, data, a, 'reschedule');
  a.date = date; a.slot = slot; a.history.push({at: stamp(ctx, data), action: `rescheduled to ${date} ${slot}` + (fee ? ' (fee)' : '')});
  notify(ctx, data, {type: 'appointment', source: {kind: 'appointment', id: a.appointment_id, version: a.history.length}, premiseId: o.premise_id, title: 'Installation rescheduled',
    body: `Your installation at ${p.address} is now on ${date}, ${slot.replace('-', ':00-')}:00.` + (fee ? ` A ${money(fee)} late-change fee will appear on your next bill.` : '')});
  return {appointment_id: a.appointment_id, fee_cents: fee};
}
function cancel(ctx, data, id) {
  const a = getAppointment(data, id), o = data.orders.find(x => x.order_id === a.order_id);
  const fee = lateFee(ctx, data, a, 'cancellation');
  a.status = 'cancelled'; a.history.push({at: stamp(ctx, data), action: 'cancelled' + (fee ? ' (fee)' : '')});
  notify(ctx, data, {type: 'appointment', source: {kind: 'appointment', id: a.appointment_id, version: a.history.length}, premiseId: o.premise_id, title: 'Installation cancelled',
    body: `The installation at ${getPremise(data, o.premise_id).address} is cancelled; the order stays open.` + (fee ? ` A ${money(fee)} late-change fee applies.` : '')});
  return {appointment_id: a.appointment_id, fee_cents: fee};
}

function activeOutage(data, premiseId, type) {
  return data.outages.find(o => o.service_type === type && o.premise_ids.includes(premiseId) && o.versions[o.versions.length - 1].status !== 'restored') || null;
}
function runTest(ctx, data, serviceId) {
  const s = data.services.find(x => x.service_id === serviceId);
  if (!s || s.service_type !== 'internet') fail('service_not_at_premise', 'No internet service with that ID.');
  const outage = activeOutage(data, s.premise_id, 'internet'), plan = PLANS.find(p => p.plan_id === s.plan_id);
  const gateway = data.equipment.find(e => e.kind === 'gateway' && e.premise_id === s.premise_id && e.status !== 'returned');
  const failed = (reason, outage_id = null) => ({result: 'fail', speed_mbps: null, reason, outage_id});
  let result = {result: 'pass', speed_mbps: plan.speed_mbps, reason: null, outage_id: null};
  if (s.status !== 'active') result = failed(gateway && ['ordered', 'shipped'].includes(gateway.status) ? 'equipment_not_delivered' : 'not_activated');
  else if (outage) result = failed('outage', outage.outage_id);
  s.last_test = {at: stamp(ctx, data), ...result};
  return {test: s.last_test};
}
function scheduleReturn(ctx, data, id, method) {
  const e = data.equipment.find(x => x.equipment_id === id);
  if (!e) fail('equipment_not_found', 'Equipment does not exist.');
  if (e.status === 'returned') fail('already_returned', 'Already returned.');
  e.return_method = method;
  return {equipment_id: e.equipment_id, return_due: e.return_due};
}
function report(ctx, data, premiseId, type, note) {
  getPremise(data, premiseId);
  if (!data.services.some(s => s.premise_id === premiseId && s.service_type === type && ['active', 'pending_stop'].includes(s.status))) fail('service_not_at_premise', 'No active service of that type here.');
  const outage = activeOutage(data, premiseId, type);
  const open = data.reports.find(r => r.premise_id === premiseId && r.service_type === type &&
    (r.outage_id ? data.outages.find(o => o.outage_id === r.outage_id).versions.at(-1).status !== 'restored' : Date.parse(ctx.virtual_now) - Date.parse(r.created_at) < 24 * 3600e3));
  if (open) fail('report_already_open', 'An outage report is already open here.');
  const r = {report_id: nextId(data.reports, 'report_id', 'rp'), premise_id: premiseId, service_type: type, outage_id: outage ? outage.outage_id : null,
    status: outage ? 'linked' : 'investigating', created_at: stamp(ctx, data), note: note || ''};
  data.reports.push(r);
  return {report_id: r.report_id, report_status: r.status, outage_id: r.outage_id};
}

module.exports = {freeSlots, earliestWindow, missedInstall, book, reschedule, cancel, runTest, scheduleReturn, report, activeOutage, windowStart, OPEN};
