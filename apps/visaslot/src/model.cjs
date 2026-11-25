'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write.
const {references:bound} = require('./domain-utils.cjs');
const c = require('./common.cjs');
const r = require('./rules.cjs');

const bad = message => c.fail('invalid_seed', message);
const unique = (values, label) => { if (new Set(values).size !== values.length) bad('Duplicate ' + label + '.'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function consulates(data) {
  unique(data.consulates.map(x => x.id), 'consulate ID');
  for (const x of data.consulates) if (!c.validTimeZone(x.timezone)) bad('Consulate ' + x.id + ' time zone is not a valid IANA zone.');
}

function slots(data, byId) {
  unique(data.slots.map(s => s.consulate_id + '|' + c.ms(s.slot_at)), 'slot');
  for (const s of data.slots) {
    const consulate = byId.get(s.consulate_id);
    if (!consulate) bad('A slot names an unknown consulate ' + s.consulate_id + '.');
    if (!c.localIn(consulate.timezone, s.slot_at)) bad('Slot ' + s.slot_at + ' must use the local UTC offset of ' + s.consulate_id + '.');
    if ((s.status === 'booked') !== (s.appointment_id !== null)) bad('Only a booked slot names an appointment.');
  }
}

// A file and its earlier versions: versions 1..n, each replaced when the next was submitted, all
// before the appointment started, with consistent document facts.
function files(a) {
  const all = [...a.file_history, ...(a.file ? [a.file] : [])];
  all.forEach((f, i) => {
    if (f.version !== i + 1) bad('Appointment ' + a.id + ' file versions must run 1..n.');
    if (c.ms(f.submitted_at) < c.ms(a.created_at) || c.ms(f.submitted_at) >= c.ms(a.slot_at) || c.ms(f.submitted_at) > c.ms(a.updated_at)) bad('Appointment ' + a.id + ' file ' + f.version + ' was submitted outside the appointment\'s lifetime.');
    if (i < a.file_history.length && f.replaced_at !== all[i + 1].submitted_at) bad('Appointment ' + a.id + ' file ' + f.version + ' must be replaced when the next file is submitted.');
    // The dated-after-submission rule is an admission check on agent submissions; a Task may seed a
    // pre-registered file as it stands (for example with a letter dated after the appointment).
    r.checkDocuments(f.documents, message => bad('Appointment ' + a.id + ' file ' + f.version + ': ' + message));
  });
  if (a.file && (a.file.locked_at !== null) !== (a.status === 'held')) bad('Appointment ' + a.id + ' file is locked exactly when the appointment is held.');
}

function appointment(data, a, byId) {
  const consulate = byId.get(a.consulate_id);
  if (!consulate) bad('Appointment ' + a.id + ' names an unknown consulate.');
  if (a.country !== consulate.country) bad('Appointment ' + a.id + ' country must be its consulate\'s country.');
  const h = a.history, last = h.at(-1);
  if (h[0].action !== 'booked' || h[0].status !== 'booked' || h[0].at !== a.created_at) bad('Appointment ' + a.id + ' history must start with its booking.');
  let previous = -Infinity;
  for (const [i, e] of h.entries()) {
    if (c.ms(e.at) < previous) bad('Appointment ' + a.id + ' history must be in time order.');
    previous = c.ms(e.at);
    const expected = {booked:'booked', rescheduled:'booked', cancelled:'cancelled', cancelled_by_consulate:'cancelled', held:'held'}[e.action];
    if (e.status !== expected || (i > 0 && e.action === 'booked')) bad('Appointment ' + a.id + ' history action and status disagree.');
    if (i < h.length - 1 && e.status !== 'booked') bad('Appointment ' + a.id + ' cannot change after it is cancelled or held.');
    if (e.status === 'booked' && c.ms(e.at) >= c.ms(e.slot_at)) bad('Appointment ' + a.id + ' must be booked before its slot starts.');
    if (e.status === 'held' && c.ms(e.at) < c.ms(e.slot_at)) bad('Appointment ' + a.id + ' cannot be held before its slot starts.');
    if (e.status === 'cancelled' && c.ms(e.at) >= c.ms(e.slot_at)) bad('Appointment ' + a.id + ' must be cancelled before its slot starts.');
    if (i > 0 && e.action !== 'rescheduled' && !c.sameInstant(e.slot_at, h[i - 1].slot_at)) bad('Appointment ' + a.id + ' only a reschedule changes the slot.');
  }
  if (last.status !== a.status || last.slot_at !== a.slot_at) bad('Appointment ' + a.id + ' status and slot must match its last history entry.');
  if (c.ms(a.updated_at) < c.ms(last.at)) bad('Appointment ' + a.id + ' updated_at is older than its history.');
  if (a.version < h.length) bad('Appointment ' + a.id + ' version must count every history step.');
  const by = {cancelled:'applicant', cancelled_by_consulate:'consulate'}[last.action];
  if (by ? !a.cancellation || a.cancellation.by !== by || a.cancellation.at !== last.at : a.cancellation !== null) bad('Appointment ' + a.id + ' cancellation does not match its history.');
  files(a);
  if (a.status === 'held') {
    const missing = r.evaluate(data, a);
    if (!a.check || !same(a.check, {appointment_id:a.id, held_at:last.at, result:missing.length ? 'refused' : 'complete', missing}) ||
        (a.file && a.file.locked_at !== last.at)) bad('Appointment ' + a.id + ' check must be the rules applied to its file when it was held.');
  } else if (a.check !== null) bad('Only a held appointment has a check.');
  const slot = data.slots.find(s => s.appointment_id === a.id);
  if (a.status === 'cancelled' ? slot : !slot || slot.consulate_id !== a.consulate_id || slot.slot_at !== a.slot_at) bad('Appointment ' + a.id + ' and its slot disagree.');
}

function checks(data) {
  unique(data.checks.map(x => x.event_id), 'held event ID');
  const held = data.appointments.filter(a => a.status === 'held');
  for (const x of data.checks) {
    if (x.appointment_id === null) {
      if (x.result !== 'no_appointment' || x.missing.length) bad('A held event without an appointment records no_appointment and nothing missing.');
      if (!data.consulates.some(k => k.id === x.consulate_id) || c.ms(x.held_at) < c.ms(x.slot_at)) bad('Held event ' + x.event_id + ' is inconsistent.');
      continue;
    }
    const a = held.find(y => y.id === x.appointment_id);
    if (!a || a.consulate_id !== x.consulate_id || a.slot_at !== x.slot_at ||
        !same(a.check, {appointment_id:a.id, held_at:x.held_at, result:x.result, missing:x.missing})) bad('Held event ' + x.event_id + ' does not match its appointment.');
  }
  for (const a of held) if (data.checks.filter(x => x.appointment_id === a.id).length !== 1) bad('Held appointment ' + a.id + ' needs exactly one held event.');
}

function validateSeed(ctx, data) {
  bound(ctx, data);
  if (!/[A-Za-z]/.test(data.passport_name)) bad('The passport name must contain letters.');
  consulates(data);
  const byId = new Map(data.consulates.map(x => [x.id, x]));
  slots(data, byId);
  unique(data.appointments.map(a => a.id), 'appointment ID');
  for (const a of data.appointments) appointment(data, a, byId);
  for (const s of data.slots.filter(s => s.status === 'booked')) {
    if (!data.appointments.some(a => a.id === s.appointment_id && a.status !== 'cancelled')) bad('A booked slot must belong to a booked or held appointment.');
  }
  checks(data);
  unique(data.checklists.map(x => x.category), 'checklist category');
  for (const list of data.checklists) unique(list.items.map(i => i.item), 'checklist item in ' + list.category);
}

const records = data => [...data.consulates, ...data.appointments];
// Document sources are opaque provenance for grading; VisaSlot never reads those Apps.
module.exports = {validateSeed, records, objects:data => records(data).map(x => x.id), references:() => [], assetReferences:() => []};
