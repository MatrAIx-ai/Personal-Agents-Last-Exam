'use strict';
// Agent tools. Slot availability elsewhere (other applicants, consulate changes) and the
// appointment check arrive as Infra events (see events.cjs).
const c = require('./common.cjs');
const r = require('./rules.cjs');
const s = require('./schedule.cjs');

function competence(data, args) {
  r.checkStays(args.trip.stays, message => c.fail('invalid_arguments', message));
  const result = r.competence(args.trip.stays);
  return {...result, consulates:c.copy(data.consulates.filter(x => x.country === result.main_country))};
}

function slots(ctx, data, args) {
  const consulate = s.consulate(data, args.consulate_id);
  if (!c.validDate(args.from) || !c.validDate(args.to) || args.to < args.from) c.fail('invalid_arguments', 'from and to must be real dates with from on or before to.');
  const open = data.slots.filter(x => x.consulate_id === consulate.id && x.status === 'open' && c.ms(x.slot_at) > c.ms(ctx.virtual_now))
    .filter(x => { const day = c.localDate(consulate.timezone, x.slot_at); return day >= args.from && day <= args.to; })
    .sort(s.bySlot).map(s.openView);
  return {consulate:c.copy(consulate), from:args.from, to:args.to, as_of:ctx.virtual_now, slots:open};
}

function book(ctx, data, args) {
  const slot = s.claimable(ctx, data, args.consulate_id, args.slot_at, args.slot_version);
  const consulate = s.consulate(data, slot.consulate_id), id = s.appointmentId(data, consulate, slot.slot_at);
  const a = {id, consulate_id:consulate.id, country:consulate.country, slot_at:slot.slot_at, status:'booked', version:1,
    created_at:ctx.virtual_now, updated_at:ctx.virtual_now,
    history:[{at:ctx.virtual_now, status:'booked', slot_at:slot.slot_at, action:'booked'}],
    cancellation:null, file:null, file_history:[], check:null};
  s.setSlot(slot, 'booked', id);
  data.appointments.push(a);
  c.log(ctx, 'visaslot.booked', {record_id:id, consulate_id:consulate.id});
  return {appointment:s.view(a)};
}

function release(data, a) {
  const slot = s.slotAt(data, a.consulate_id, a.slot_at);
  s.setSlot(slot, 'open');
  return s.openView(slot);
}

function reschedule(ctx, data, args) {
  const a = s.changeable(ctx, data, args.appointment_id, args.appointment_version);
  if (c.sameInstant(args.slot_at, a.slot_at)) c.fail('invalid_arguments', 'The appointment already holds that slot.');
  const slot = s.claimable(ctx, data, a.consulate_id, args.slot_at, args.slot_version);
  const released = release(data, a);
  s.setSlot(slot, 'booked', a.id);
  a.slot_at = slot.slot_at;
  s.record(ctx, a, 'booked', 'rescheduled');
  return {appointment:s.view(a), released_slot:released};
}

function cancel(ctx, data, args) {
  const a = s.changeable(ctx, data, args.appointment_id, args.appointment_version);
  const released = release(data, a);
  a.cancellation = {by:'applicant', at:ctx.virtual_now, reason:null};
  s.record(ctx, a, 'cancelled', 'cancelled');
  return {appointment:s.view(a), released_slot:released};
}

function submitFile(ctx, data, args) {
  const a = c.find(data.appointments, args.appointment_id, 'Appointment');
  if (a.status === 'held') c.fail('invalid_state', 'Appointment ' + a.id + ' was held at ' + a.check.held_at + '; its file is locked.');
  if (a.status !== 'booked') c.fail('invalid_state', 'Appointment ' + a.id + ' is ' + a.status + '; a file goes on a booked appointment.');
  if (c.ms(ctx.virtual_now) >= c.ms(a.slot_at)) c.fail('invalid_state', 'Appointment ' + a.id + ' started at ' + a.slot_at + '; the file can no longer be replaced.');
  const consulate = s.consulate(data, a.consulate_id);
  r.checkDocuments(args.documents, message => c.fail('invalid_arguments', message));
  r.checkDated(args.documents, c.localDate(consulate.timezone, ctx.virtual_now));
  const previous = a.file;
  if (previous) a.file_history.push({version:previous.version, submitted_at:previous.submitted_at, documents:previous.documents, replaced_at:ctx.virtual_now});
  a.file = {version:previous ? previous.version + 1 : 1, submitted_at:ctx.virtual_now, documents:c.copy(args.documents), locked_at:null};
  a.updated_at = ctx.virtual_now;
  c.log(ctx, 'visaslot.file_submitted', {record_id:a.id, file_version:a.file.version});
  return {appointment_id:a.id, file:c.copy(a.file), replaced_version:previous ? previous.version : null, missing_if_held_now:r.evaluate(data, a)};
}

function getFile(data, args) {
  const a = c.find(data.appointments, args.appointment_id, 'Appointment');
  return {appointment_id:a.id, appointment_status:a.status, file:c.copy(a.file), history:c.copy(a.file_history),
    missing_if_held_now:a.status === 'booked' ? r.evaluate(data, a) : null, check:c.copy(a.check)};
}

function checklist(data, args) {
  const list = data.checklists.find(x => x.category === args.category);
  if (!list) c.fail('not_found', 'No checklist for category ' + args.category + '. Categories: ' + data.checklists.map(x => x.category).join(', ') + '.');
  return {category:list.category, title:list.title, items:c.copy(list.items), rules:[...r.RULES]};
}

function handleTool(ctx, data, name, args) {
  if (name === 'visaslot.competence') return {data, result:competence(data, args)};
  if (name === 'visaslot.slots') return {data, result:slots(ctx, data, args)};
  if (name === 'visaslot.appointments') {
    if (args.id !== undefined) {
      const one = s.view(c.find(data.appointments, args.id, 'Appointment'));
      return {data, result:{items:[one], item:one}};
    }
    return {data, result:{items:[...data.appointments].sort((a, b) => s.bySlot(a, b) || a.id.localeCompare(b.id)).map(s.view)}};
  }
  if (name === 'visaslot.checklist') return {data, result:checklist(data, args)};
  if (name === 'visaslot.file.get') return {data, result:getFile(data, args)};
  if (name === 'visaslot.book') return {data, result:book(ctx, data, args)};
  if (name === 'visaslot.reschedule') return {data, result:reschedule(ctx, data, args)};
  if (name === 'visaslot.cancel') return {data, result:cancel(ctx, data, args)};
  if (name === 'visaslot.file.submit') return {data, result:submitFile(ctx, data, args)};
  c.fail('unknown_tool', 'Unknown visaslot operation.');
}

module.exports = {handleTool};
