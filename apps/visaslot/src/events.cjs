'use strict';
// Infra-applied events. Each handler observes the event's own `at` as ctx.virtual_now.
// The App never schedules itself: Infra releases and takes slots for other applicants,
// cancels on the consulate's behalf and holds the appointment at its time.
const c = require('./common.cjs');
const r = require('./rules.cjs');
const s = require('./schedule.cjs');

const future = (ctx, at) => c.ms(at) > c.ms(ctx.virtual_now);

function released(ctx, data, {consulate_id, slot_at}) {
  const consulate = s.consulate(data, consulate_id), slot = s.slotAt(data, consulate_id, slot_at);
  if (!future(ctx, slot_at)) c.fail('invalid_event', 'Only a future slot can be released.');
  if (!slot) {
    if (!c.localIn(consulate.timezone, slot_at)) c.fail('invalid_event', 'A new slot must be written with the consulate\'s local UTC offset.');
    data.slots.push({consulate_id, slot_at, status:'open', version:1, appointment_id:null});
    data.slots.sort(s.bySlot);
  } else if (['taken', 'closed'].includes(slot.status)) s.setSlot(slot, 'open');
  else c.fail('invalid_event', 'The slot at ' + slot.slot_at + ' is ' + slot.status + ', not taken or closed.');
  c.log(ctx, 'visaslot.slot_released', {record_id:consulate_id});
  return data;
}

function taken(ctx, data, {consulate_id, slot_at}) {
  s.consulate(data, consulate_id);
  const slot = s.slotAt(data, consulate_id, slot_at);
  if (!slot) c.fail('not_found', 'Consulate ' + consulate_id + ' has no slot at ' + slot_at + '.');
  if (!future(ctx, slot.slot_at)) c.fail('invalid_event', 'Only a future slot can be taken.');
  if (slot.status !== 'open') c.fail('invalid_event', 'The slot at ' + slot.slot_at + ' is ' + slot.status + ', not open.');
  s.setSlot(slot, 'taken');
  c.log(ctx, 'visaslot.slot_taken', {record_id:consulate_id});
  return data;
}

function cancelledByConsulate(ctx, data, {consulate_id, slot_at, reason}) {
  s.consulate(data, consulate_id);
  const a = data.appointments.find(x => x.consulate_id === consulate_id && x.status === 'booked' && c.sameInstant(x.slot_at, slot_at));
  if (!a) c.fail('not_found', 'No booked appointment at ' + consulate_id + ' for ' + slot_at + '.');
  if (!future(ctx, a.slot_at)) c.fail('invalid_event', 'The appointment has already started; hold it instead.');
  s.setSlot(s.slotAt(data, consulate_id, a.slot_at), 'closed');
  a.cancellation = {by:'consulate', at:ctx.virtual_now, reason:reason ?? null};
  s.record(ctx, a, 'cancelled', 'cancelled_by_consulate');
  return data;
}

// The appointment check. It names the consulate and slot, matches the appointment booked there,
// applies the rules at the event time, locks the file and records the result. A replayed event ID
// leaves everything as the original application recorded it.
function held(ctx, data, event) {
  const {consulate_id, slot_at} = event.payload;
  s.consulate(data, consulate_id);
  const prior = data.checks.find(x => x.event_id === event.event_id);
  if (prior) {
    if (prior.consulate_id !== consulate_id || !c.sameInstant(prior.slot_at, slot_at)) c.fail('already_exists', 'Event ' + event.event_id + ' already held another slot.');
    c.log(ctx, 'visaslot.held_replay', {record_id:prior.appointment_id || consulate_id});
    return data;
  }
  if (c.ms(ctx.virtual_now) < c.ms(slot_at)) c.fail('not_due', 'The appointment at ' + slot_at + ' has not started.');
  const inSlot = data.appointments.filter(x => x.consulate_id === consulate_id && c.sameInstant(x.slot_at, slot_at));
  if (inSlot.some(x => x.status === 'held')) c.fail('already_exists', 'The appointment in that slot was already held.');
  const a = inSlot.find(x => x.status === 'booked');
  if (!a) {
    data.checks.push({event_id:event.event_id, consulate_id, slot_at, held_at:ctx.virtual_now, appointment_id:null, result:'no_appointment', missing:[]});
    c.log(ctx, 'visaslot.held_no_appointment', {record_id:consulate_id});
    return data;
  }
  const missing = r.evaluate(data, a), result = missing.length ? 'refused' : 'complete';
  if (a.file) a.file.locked_at = ctx.virtual_now;
  a.check = {appointment_id:a.id, held_at:ctx.virtual_now, result, missing};
  s.record(ctx, a, 'held', 'held');
  data.checks.push({event_id:event.event_id, consulate_id, slot_at:a.slot_at, held_at:ctx.virtual_now, appointment_id:a.id, result, missing:c.copy(missing)});
  return data;
}

function applyEvent(ctx, data, event) {
  const op = event.operation;
  if (op === 'visaslot.slot.released') return released(ctx, data, event.payload);
  if (op === 'visaslot.slot.taken') return taken(ctx, data, event.payload);
  if (op === 'visaslot.appointment.cancelled_by_consulate') return cancelledByConsulate(ctx, data, event.payload);
  if (op === 'visaslot.appointment.held') return held(ctx, data, event);
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
