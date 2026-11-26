'use strict';
// Scenario events applied by Infra with env.apply_event. Core sets ctx.virtual_now to event.at and rolls back both
// data and clock when a handler refuses an event. A missing reference is unknown_reference, a reused ID
// duplicate_id, a bad value invalid_value, and a slot or appointment in the wrong state invalid_state.
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {ms} = require('./time.cjs');
const m = require('./model.cjs');
const r = require('./rules.cjs');

const ref = (list, id, what) => list.find(x => x.id === id) || fail('unknown_reference', what + ' ' + JSON.stringify(id) + ' does not exist.');
const bad = message => fail('invalid_value', message);
const isNew = (data, id) => { if (m.objects(data).includes(id)) fail('duplicate_id', 'An object with ID ' + JSON.stringify(id) + ' already exists.'); };
const skill = (data, id) => ref(data.skills, id, 'Skill');

const HANDLERS = {
  'tutorwell.slot.released'(data, at, p) {
    isNew(data, p.slot_id);
    const t = ref(data.tutors, p.tutor_id, 'Tutor');
    if (ms(p.start) <= ms(at)) bad('A released slot must start after the event.');
    if (!t.modes.includes(p.mode)) bad('The tutor does not offer the mode ' + p.mode + '.');
    const end = ms(p.start) + p.minutes * 60000;
    if (data.slots.some(s => s.tutor_id === t.id && s.withdrawn_at === null && ms(s.start) < end && ms(p.start) < ms(s.start) + s.minutes * 60000)) {
      bad('The slot overlaps another slot of the same tutor.');
    }
    data.slots.push({id: p.slot_id, tutor_id: t.id, start: p.start, minutes: p.minutes, mode: p.mode, withdrawn_at: null});
    return p.slot_id;
  },
  'tutorwell.slot.withdrawn'(data, at, p) {
    const s = ref(data.slots, p.slot_id, 'Slot');
    if (s.withdrawn_at !== null) fail('invalid_state', 'The slot is already withdrawn.');
    if (ms(at) >= ms(s.start)) fail('invalid_state', 'A slot that has started cannot be withdrawn.');
    s.withdrawn_at = at;
    // A booked appointment on it is cancelled by the centre and does not count against the student.
    for (const a of data.appointments) if (a.slot_id === s.id && a.status === 'booked') Object.assign(a, {status: 'cancelled_by_centre', cancelled_at: at});
    return s.id;
  },
  'tutorwell.appointment.attended'(data, at, p) {
    const a = ref(data.appointments, p.appointment_id, 'Appointment');
    if (a.status !== 'booked') fail('invalid_state', 'The appointment is ' + a.status + '; it has no session to attend.');
    if (!r.started(data, a, at)) fail('invalid_state', 'Attendance is recorded only after the session starts.');
    if (a.outcome) fail('invalid_state', 'The outcome is already recorded as ' + a.outcome.outcome + '; it is final.');
    a.outcome = {outcome: p.outcome, recorded_at: at};
    return a.id;
  },
  'tutorwell.report.posted'(data, at, p) {
    const a = ref(data.appointments, p.appointment_id, 'Appointment');
    if (a.outcome?.outcome !== 'completed') fail('invalid_state', 'Only a completed appointment can receive a report.');
    if (data.reports.some(x => x.appointment_id === a.id)) fail('invalid_state', 'This appointment already has a report.');
    for (const id of p.covered_skill_ids) skill(data, id);
    if (p.next_focus !== undefined) skill(data, p.next_focus);
    const ids = p.followups.map(f => f.followup_id);
    for (const id of ids) isNew(data, id);
    if (new Set(ids).size !== ids.length) fail('duplicate_id', 'Follow-up IDs must be unique.');
    for (const f of p.followups) if (f.due_at !== undefined && ms(f.due_at) <= ms(at)) bad('A follow-up is due after its report.');
    const report = {id: m.nextId(data, 'rep'), appointment_id: a.id, posted_at: at, covered_skill_ids: copy(p.covered_skill_ids), next_focus: p.next_focus ?? null};
    data.reports.push(report);
    for (const f of p.followups) {
      data.followups.push({id: f.followup_id, report_id: report.id, kind: f.kind, item_refs: copy(f.item_refs), minutes: f.minutes, due_at: f.due_at ?? null,
        status: 'open', done_at: null, done_by: null});
    }
    return report.id;
  },
  'tutorwell.rules.changed'(data, at, p) {
    const [low, high] = r.RANGES[p.setting];
    if (p.value < low || p.value > high) bad(`${p.setting} must be between ${low} and ${high}.`);
    const current = r.settingsAt(data, at);
    if (current[p.setting] === p.value) bad(`${p.setting} is already ${p.value}.`);
    // A result is judged by the settings in force when it is recorded. A change dated at the very time of a recorded
    // cancellation or attendance would re-judge it, so it must come later.
    const same = data.appointments.find(a => (a.status === 'cancelled' || a.status === 'late_cancel') && ms(a.cancelled_at) === ms(at) || a.outcome && ms(a.outcome.recorded_at) === ms(at));
    if (same) bad(`Appointment ${same.id} has a result recorded at this time; date the settings change later.`);
    const entry = {id: m.nextId(data, 'set'), at, ...current, [p.setting]: p.value};
    data.settings.push(entry);
    return entry.id;
  }
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported Tutorwell event.');
  const target = handler(data, event.at, event.payload);
  log(ctx, event.operation, {event_id: event.event_id, object_id: target});
  return data;
}

module.exports = {applyEvent, EVENTS: Object.keys(HANDLERS)};
