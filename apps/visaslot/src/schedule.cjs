'use strict';
// Slot inventory and appointment records. Slots are identified by consulate and start instant;
// a slot's version increases each time its status changes.
const c = require('./common.cjs');

const consulate = (data, id) => c.find(data.consulates, id, 'Consulate');
const slotAt = (data, consulateId, at) => data.slots.find(s => s.consulate_id === consulateId && c.sameInstant(s.slot_at, at)) || null;
const openView = s => ({consulate_id:s.consulate_id, slot_at:s.slot_at, version:s.version});
const bySlot = (a, b) => c.ms(a.slot_at) - c.ms(b.slot_at) || a.consulate_id.localeCompare(b.consulate_id);

function setSlot(slot, status, appointmentId = null) {
  slot.status = status;
  slot.appointment_id = appointmentId;
  slot.version++;
}

// The open slot an agent asked for, checked in this order: it exists, has not started, is still
// open (slot_unavailable), and has the version the agent read (stale_version).
function claimable(ctx, data, consulateId, at, version) {
  consulate(data, consulateId);
  const slot = slotAt(data, consulateId, at);
  if (!slot) c.fail('not_found', 'Consulate ' + consulateId + ' has no slot at ' + at + '.');
  if (c.ms(slot.slot_at) <= c.ms(ctx.virtual_now)) c.fail('slot_unavailable', 'The slot at ' + slot.slot_at + ' has already started.');
  if (slot.status !== 'open') c.fail('slot_unavailable', 'The slot at ' + slot.slot_at + ' is no longer available. Search again.');
  if (slot.version !== version) c.fail('stale_version', 'The slot at ' + slot.slot_at + ' changed since it was read (version ' + slot.version + '). Search again.');
  return slot;
}

// Appointment IDs follow the first slot's local date (appt-0331); a repeat date adds -2, -3, ...
function appointmentId(data, consulateRecord, at) {
  const base = 'appt-' + c.localDate(consulateRecord.timezone, at).slice(5).replace('-', '');
  const ids = new Set(data.appointments.map(a => a.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(base + '-' + n)) n++;
  return base + '-' + n;
}

function record(ctx, appointment, status, action) {
  if (c.ms(ctx.virtual_now) < c.ms(appointment.updated_at)) c.fail('invalid_time', 'The run clock must not precede the last appointment update.');
  appointment.status = status;
  appointment.history.push({at:ctx.virtual_now, status, slot_at:appointment.slot_at, action});
  appointment.updated_at = ctx.virtual_now;
  appointment.version++;
  c.log(ctx, 'visaslot.' + action, {record_id:appointment.id, consulate_id:appointment.consulate_id});
}

// A booked appointment the agent may still change: before its slot starts, at the version read.
function changeable(ctx, data, id, version) {
  const a = c.find(data.appointments, id, 'Appointment');
  if (a.status !== 'booked') c.fail('invalid_state', 'Appointment ' + id + ' is ' + a.status + '; only a booked appointment can change.');
  if (c.ms(ctx.virtual_now) >= c.ms(a.slot_at)) c.fail('invalid_state', 'Appointment ' + id + ' started at ' + a.slot_at + '.');
  if (a.version !== version) c.fail('stale_version', 'Appointment ' + id + ' changed since it was read (version ' + a.version + ').');
  return a;
}

// The appointment as the scheduling tools return it: the file is summarized by its version.
function view(a) {
  const {file, file_history, ...rest} = c.copy(a);
  return {...rest, file_version:file ? file.version : null};
}

module.exports = {view, consulate, slotAt, openView, bySlot, setSlot, claimable, appointmentId, record, changeable};
