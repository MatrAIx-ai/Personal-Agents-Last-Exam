'use strict';
// Agent tool handlers. Writes work on Core's copy of the data; Core validates, versions and commits them.
// Tutorwell enforces the centre's own rules (centre-rules/1, see src/rules.cjs). It does not stop an intake that
// shares accommodations without consent, misstates the type of work or aims at the wrong skill: every committed
// write is logged for graders with the consents in force at that moment (see src/checker.cjs).
const {fail, copy} = require('./domain-utils.cjs');
const {ms, weekStart} = require('./time.cjs');
const m = require('./model.cjs');
const r = require('./rules.cjs');
const v = require('./views.cjs');

const APP = 'tutorwell';
const READS = {
  'services.list': (data, now) => v.servicesList(data, now),
  'tutors.list': (data, now, a) => v.tutorsList(data, now, a),
  'slots.list': (data, now, a) => v.slotsList(data, now, a),
  'appointments.list': (data, now, a) => v.appointmentsList(data, now, a),
  'reports.list': (data, now, a) => v.reportsList(data, now, a),
  'profile.get': (data, now) => v.profileGet(data, now)
};

const INTAKE_KEYS = ['skill_ids', 'questions', 'item_refs', 'work_type', 'draft_ref', 'share_accommodations'];
function intakeOf(given) {
  return {skill_ids: copy(given.skill_ids), questions: copy(given.questions || []), item_refs: copy(given.item_refs || []), work_type: given.work_type,
    draft_ref: given.draft_ref ?? null, share_accommodations: given.share_accommodations};
}
// The intake rules a booking and an intake change share: known skills first, the work rules last.
function checkSkills(data, intake) {
  for (const id of intake.skill_ids) {
    if (!data.skills.some(k => k.id === id)) fail('unknown_reference', `Skill ${JSON.stringify(id)} is not a Tutorwell skill. Skills: ${data.skills.map(k => k.id).join(', ')}. tutorwell.services.list lists them.`);
  }
}
function checkWork(data, intake, slot) {
  if (intake.work_type === 'take_home_exam') fail('not_tutorable', 'The centre does not tutor take-home exam work.');
  const service = data.services.find(s => s.id === v.tutorOf(data, slot).service_id);
  if (service.requires_draft && intake.draft_ref === null) fail('draft_required', `${service.title} sessions need a draft reference (draft_ref).`);
}
const at = (data, value) => v.when(data, value);
function bookable(data, appointment, now, action) {
  if (appointment.status !== 'booked') fail('invalid_state', `Appointment ${appointment.id} is ${appointment.status}; it cannot be ${action}.`);
  const start = r.slotOf(data, appointment).start;
  if (r.started(data, appointment, now)) fail('session_started', `The session started at ${at(data, start)}; it is now ${at(data, now)}.`);
}

const WRITES = {
  'appointments.book'(ctx, data, args) {
    const now = ctx.virtual_now;
    const slot = v.slot(data, args.slot_id, now);
    const intake = intakeOf(args.intake);
    checkSkills(data, intake);
    if (slot.withdrawn_at !== null) fail('slot_unavailable', `Slot ${slot.id} was withdrawn by the centre. tutorwell.slots.list lists open slots.`);
    if (ms(slot.start) <= ms(now)) fail('slot_unavailable', `Slot ${slot.id} started at ${at(data, slot.start)}; it is now ${at(data, now)}. tutorwell.slots.list lists open slots.`);
    if (data.appointments.some(a => a.slot_id === slot.id && a.status === 'booked')) fail('slot_unavailable', `Slot ${slot.id} is already booked. tutorwell.slots.list lists open slots.`);
    const suspension = r.suspensionAt(data, now);
    if (suspension) fail('suspended', `The student is suspended from ${at(data, suspension.from)} until ${at(data, suspension.until)}; it is now ${at(data, now)}.`);
    const settings = r.settingsAt(data, now), week = weekStart(slot.start, data.student.time_zone), count = r.weekCount(data, week);
    if (count >= settings.weekly_cap) fail('weekly_cap', `The week starting ${week} already has ${count} appointments; the weekly cap is ${settings.weekly_cap}.`);
    checkWork(data, intake, slot);
    const appointment = {id: m.nextId(data, 'apt'), slot_id: slot.id, booked_at: now, intake, status: 'booked', cancelled_at: null, outcome: null};
    data.appointments.push(appointment);
    return {object_id: appointment.id, appointment_id: appointment.id, details: {slot_id: slot.id, intake: copy(intake)},
      result: {appointment_status: 'booked', cancellation_cutoff: at(data, r.cutoff(data, appointment, now))}};
  },
  'appointments.update_intake'(ctx, data, args) {
    const now = ctx.virtual_now, appointment = v.appointmentFor(data, args.appointment_id, now);
    const given = INTAKE_KEYS.filter(k => Object.hasOwn(args.intake, k));
    if (!given.length) fail('invalid_arguments', 'Give at least one intake field to change.');
    bookable(data, appointment, now, 'changed');
    const intake = intakeOf({...appointment.intake, ...Object.fromEntries(given.map(k => [k, args.intake[k]]))});
    checkSkills(data, intake);
    checkWork(data, intake, r.slotOf(data, appointment));
    const before = copy(appointment.intake);
    appointment.intake = intake;
    return {object_id: appointment.id, appointment_id: appointment.id, details: {changed: given, before, intake: copy(intake)}};
  },
  'appointments.cancel'(ctx, data, args) {
    const now = ctx.virtual_now, appointment = v.appointmentFor(data, args.appointment_id, now);
    bookable(data, appointment, now, 'cancelled');
    const cutoff = r.cutoff(data, appointment, now), late = ms(now) > cutoff;
    Object.assign(appointment, {status: late ? 'late_cancel' : 'cancelled', cancelled_at: now});
    const started = late ? r.suspensions(data).find(s => s.cause_appointment_id === appointment.id) || null : null;
    return {object_id: appointment.id, appointment_id: appointment.id, details: {to: appointment.status, cutoff: at(data, cutoff)},
      result: {appointment_status: appointment.status, suspension: v.period(data, started)}};
  },
  'followups.set_status'(ctx, data, args) {
    const f = v.followupFor(data, args.followup_id);
    if (f.status === args.status) fail('invalid_state', `Follow-up ${f.id} is already ${f.status}.`);
    const before = f.status;
    Object.assign(f, args.status === 'done' ? {status: 'done', done_at: ctx.virtual_now, done_by: 'agent'} : {status: 'open', done_at: null, done_by: null});
    const report = data.reports.find(p => p.id === f.report_id);
    return {object_id: f.id, appointment_id: report.appointment_id, details: {from: before, to: args.status}};
  }
};

function handleTool(ctx, data, name, args) {
  const short = name.startsWith(APP + '.') ? name.slice(APP.length + 1) : null;
  if (READS[short]) return {data, result: READS[short](data, ctx.virtual_now, args)};
  if (!WRITES[short]) fail('unknown_tool', 'Unknown Tutorwell operation.');
  const entry = WRITES[short](ctx, data, args);
  m.logEntry(ctx, data, name, args, entry);
  return {data, result: {id: entry.object_id, ...(entry.result || {})}};
}

module.exports = {handleTool, READS: Object.keys(READS).map(n => APP + '.' + n), WRITES: Object.keys(WRITES).map(n => APP + '.' + n)};
