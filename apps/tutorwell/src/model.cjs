'use strict';
// Record consistency, object IDs and the evaluator-only activity log for one student's data.
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {ms, local} = require('./time.cjs');
const r = require('./rules.cjs');

const COLLECTIONS = ['settings', 'services', 'skills', 'tutors', 'slots', 'accommodations', 'appointments', 'reports', 'followups'];
const invalid = message => fail('invalid_seed', message);

function records(data) {
  return COLLECTIONS.flatMap(name => data[name]);
}
// Core's object list: one ID per record (Core counts records and objects alike when it checks a bundle).
function objects(data) {
  return records(data).map(x => x.id);
}
function nextId(data, prefix) {
  const ids = new Set(objects(data));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

function validateSeed(ctx, data) {
  references(ctx, data);
  local(ctx.virtual_now, data.student.time_zone); // an unsupported time zone fails here
  const now = ms(ctx.virtual_now), past = at => ms(at) <= now;
  const seen = new Set();
  for (const id of objects(data)) {
    if (seen.has(id)) invalid('Every object ID must be unique.');
    seen.add(id);
  }
  const map = name => new Map(data[name].map(x => [x.id, x]));
  const services = map('services'), skills = map('skills'), tutors = map('tutors'), slots = map('slots');
  const appointments = map('appointments'), reports = map('reports');
  for (const s of data.settings) if (!past(s.at)) invalid('A settings entry cannot be dated after the run\'s virtual time.');
  const settled = (at, what) => { if (!r.settingsAt(data, at)) invalid(what + ' needs centre settings in force at its time.'); };
  settled(ctx.virtual_now, 'The run');
  for (const k of data.skills) if (!services.has(k.service_id)) invalid('A skill refers to an unknown service.');
  const people = new Set(ctx.binding.people.map(p => p.person_id));
  for (const t of data.tutors) {
    if (!services.has(t.service_id)) invalid('A tutor refers to an unknown service.');
    if (!people.has(t.person_id)) invalid('Every tutor must be a person in the supplied binding.');
    if (t.skill_ids.some(id => skills.get(id)?.service_id !== t.service_id)) invalid('A tutor covers only known skills of their own service.');
  }
  const byTutor = new Map();
  for (const s of data.slots) {
    const t = tutors.get(s.tutor_id);
    if (!t) invalid('A slot refers to an unknown tutor.');
    if (!t.modes.includes(s.mode)) invalid('A slot\'s mode must be one of its tutor\'s modes.');
    if (s.withdrawn_at !== null && (!past(s.withdrawn_at) || ms(s.withdrawn_at) >= ms(s.start))) invalid('A slot is withdrawn before it starts and not after the run\'s virtual time.');
    if (s.withdrawn_at === null) byTutor.set(s.tutor_id, [...(byTutor.get(s.tutor_id) || []), s]);
  }
  for (const list of byTutor.values()) {
    const sorted = [...list].sort((a, b) => ms(a.start) - ms(b.start));
    for (let i = 1; i < sorted.length; i++) if (ms(sorted[i].start) < ms(sorted[i - 1].start) + sorted[i - 1].minutes * 60000) invalid('A tutor\'s slots must not overlap.');
  }
  const accommodation = new Set(data.accommodations.map(a => a.id));
  if (accommodation.size !== data.accommodations.length) invalid('Accommodation IDs must be unique.');
  const active = new Set();
  for (const a of data.appointments) {
    const s = slots.get(a.slot_id);
    if (!s) invalid('An appointment refers to an unknown slot.');
    const service = services.get(tutors.get(s.tutor_id).service_id);
    if (a.intake.skill_ids.some(id => !skills.has(id))) invalid('An intake names only known skills.');
    if (a.intake.work_type === 'take_home_exam') invalid('The centre does not tutor take-home exams.');
    if (service.requires_draft && a.intake.draft_ref === null) invalid('A writing-centre intake needs a draft reference.');
    if (!past(a.booked_at) || ms(a.booked_at) >= ms(s.start)) invalid('An appointment is booked before its start and not after the run\'s virtual time.');
    settled(a.booked_at, 'A booking');
    if (a.status === 'booked') {
      if (a.cancelled_at !== null) invalid('A booked appointment has no cancellation time.');
      if (active.has(s.id)) invalid('A slot holds at most one booked appointment.');
      active.add(s.id);
      if (s.withdrawn_at !== null) invalid('A withdrawn slot holds no booked appointment.');
      if (a.outcome) {
        if (ms(a.outcome.recorded_at) < ms(s.start) || !past(a.outcome.recorded_at)) invalid('An outcome is recorded only after the session starts and not after the run\'s virtual time.');
        settled(a.outcome.recorded_at, 'An outcome');
      }
    } else {
      if (a.outcome !== null) invalid('Only a booked appointment has an outcome.');
      if (a.cancelled_at === null || !past(a.cancelled_at) || ms(a.cancelled_at) < ms(a.booked_at) || ms(a.cancelled_at) >= ms(s.start)) {
        invalid('A cancellation is dated after the booking, before the start and not after the run\'s virtual time.');
      }
      settled(a.cancelled_at, 'A cancellation');
      if (a.status === 'cancelled_by_centre') { if (s.withdrawn_at === null || ms(s.withdrawn_at) !== ms(a.cancelled_at)) invalid('A centre cancellation is dated at its slot\'s withdrawal.'); }
      else if ((ms(a.cancelled_at) > r.cutoff(data, a, a.cancelled_at)) !== (a.status === 'late_cancel')) {
        invalid('A cancellation after the cutoff in force then is late_cancel; one at or before it is cancelled.');
      }
    }
  }
  const reported = new Set();
  for (const p of data.reports) {
    const a = appointments.get(p.appointment_id);
    if (!a || a.outcome?.outcome !== 'completed') invalid('A report belongs to a completed appointment.');
    if (reported.has(a.id)) invalid('An appointment has at most one report.');
    reported.add(a.id);
    if (ms(p.posted_at) < ms(a.outcome.recorded_at) || !past(p.posted_at)) invalid('A report is posted after the attendance is recorded and not after the run\'s virtual time.');
    if (p.covered_skill_ids.some(id => !skills.has(id)) || (p.next_focus !== null && !skills.has(p.next_focus))) invalid('A report names only known skills.');
  }
  for (const f of data.followups) {
    const p = reports.get(f.report_id);
    if (!p) invalid('A follow-up belongs to a known report.');
    if ((f.status === 'done') !== (f.done_at !== null) || (f.done_at === null) !== (f.done_by === null)) invalid('A follow-up is done exactly when it has a done time and who marked it.');
    if (f.done_at !== null && (ms(f.done_at) < ms(p.posted_at) || !past(f.done_at))) invalid('A follow-up is done after its report and not after the run\'s virtual time.');
  }
  for (const e of data.evaluator.activity_log) if (!past(e.at)) invalid('An activity-log entry cannot be after the run\'s virtual time.');
}

// Every committed agent write, with the consents in force at that moment; returned only by env.snapshot.
function logEntry(ctx, data, operation, args, entry) {
  data.evaluator.activity_log.push({seq: data.evaluator.activity_log.length + 1, at: ctx.virtual_now, operation, request_id: args.request_id,
    expected_version: copy(args.expected_version), object_id: entry.object_id, appointment_id: entry.appointment_id ?? null,
    consents: data.accommodations.map(a => ({accommodation_id: a.id, consent_to_share: a.consent_to_share})), details: copy(entry.details || {})});
  log(ctx, operation, {object_id: entry.object_id});
}

module.exports = {COLLECTIONS, records, objects, nextId, validateSeed, logEntry, references: () => []};
