#!/usr/bin/env node
'use strict';
// Builds the full fixtures fixtures/students/<id>/{seed,binding,dataset,catalog}.json from the shared centre
// (fixtures/centre.json) and the hand-written profiles (fixtures/profiles/<id>.json). The centre's weekly timetable
// becomes the open slots of the two weeks in `slot_window`; each past appointment adds the slot it used, which must
// be one of its tutor's timetable times. Besides the seed schema and validateSeed at the profile's `now`, the
// builder refuses a history the centre's own rules would not have produced: a booking over the weekly cap or during
// a suspension, a tutor or report outside the tutor's skills, or a follow-up done by anyone but the student.
// Run `node scripts/build-fixtures.cjs`; `--check` rebuilds in memory, compares byte for byte and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const model = require('../src/model.cjs');
const r = require('../src/rules.cjs');
const {ms, local, zoned, weekStart} = require('../src/time.cjs');
const {compile} = require('../tests/schema-validator.cjs');

const schema = name => compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8')), path.join(root, 'schemas'));
const seedValid = schema('seed.schema.json'), datasetValid = schema('dataset.schema.json');
const CENTRE = path.join(root, 'fixtures/centre.json'), PROFILES = path.join(root, 'fixtures/profiles'), STUDENTS = path.join(root, 'fixtures/students');
const FILES = ['seed.json', 'binding.json', 'dataset.json', 'catalog.json'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = message => { throw new Error(message); };
const centre = () => read(CENTRE);
const profiles = () => fs.readdirSync(PROFILES).filter(f => f.endsWith('.json')).sort().map(f => read(path.join(PROFILES, f)));

// The instant of a local wall time in the zone, written with its offset (tries both offsets the zone can have).
function at(date, time, zone) {
  for (const offset of ['-05:00', '-04:00', '+00:00']) {
    const iso = `${date}T${time}:00${offset}`;
    if (zoned(iso, zone) === iso) return iso;
  }
  return fail(`${date} ${time} does not exist in ${zone}`);
}
const slotId = (tutorId, iso, zone) => {
  const l = local(iso, zone), hm = String(Math.floor(l.minutes / 60)).padStart(2, '0') + String(l.minutes % 60).padStart(2, '0');
  return `${tutorId.replace(/^t-/, '')}-${l.date.slice(5).replace('-', '')}-${hm}`;
};
function* dates(from, to) {
  for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 86400000) yield new Date(t).toISOString().slice(0, 10);
}
const weekdayOf = date => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(date + 'T12:00:00Z').getUTCDay()];

function build(p, c = centre()) {
  const zone = p.student.time_zone, tutors = new Map(c.tutors.map(t => [t.id, t]));
  const seed = {account_id: p.account_id, owner_person_id: p.person_id, student: p.student, settings: c.settings, services: c.services, skills: c.skills,
    tutors: c.tutors.map(t => ({id: t.id, person_id: t.person_id, name: t.name, service_id: t.service_id, skill_ids: t.skill_ids, modes: t.modes})),
    slots: [], accommodations: p.accommodations, appointments: [], reports: [], followups: [], evaluator: {activity_log: []}};
  const slots = new Map();
  for (const date of dates(c.slot_window.from, c.slot_window.to)) {
    for (const t of c.tutors) for (const e of t.timetable.filter(x => x.weekday === weekdayOf(date))) {
      const start = at(date, e.time, zone), id = slotId(t.id, start, zone);
      slots.set(id, {id, tutor_id: t.id, start, minutes: c.slot_minutes, mode: e.mode, withdrawn_at: null});
    }
  }
  for (const a of p.appointments) {
    const t = tutors.get(a.tutor) || fail(`${p.id}/${a.id}: unknown tutor ${a.tutor}`), l = local(a.start, zone);
    const hm = String(Math.floor(l.minutes / 60)).padStart(2, '0') + ':' + String(l.minutes % 60).padStart(2, '0');
    if (!t.timetable.some(e => e.weekday === l.weekday && e.time === hm && e.mode === a.mode)) fail(`${p.id}/${a.id}: ${t.name} has no ${a.mode} slot on ${l.weekday} at ${hm}`);
    const id = slotId(t.id, a.start, zone), slot = slots.get(id) || {id, tutor_id: t.id, start: a.start, minutes: c.slot_minutes, mode: a.mode, withdrawn_at: null};
    if (a.status === 'cancelled_by_centre') slot.withdrawn_at = a.cancelled_at;
    slots.set(id, slot);
    if (a.intake.skill_ids.some(k => !t.skill_ids.includes(k))) fail(`${p.id}/${a.id}: ${t.name} does not cover every intake skill`);
    seed.appointments.push({id: a.id, slot_id: id, booked_at: a.booked_at, intake: a.intake, status: a.status, cancelled_at: a.cancelled_at, outcome: a.outcome});
    if (!a.report) continue;
    const rep = a.report, service = t.service_id;
    if (rep.covered_skill_ids.some(k => !t.skill_ids.includes(k))) fail(`${p.id}/${rep.id}: the report covers a skill ${t.name} does not teach`);
    if (rep.next_focus !== null && c.skills.find(k => k.id === rep.next_focus)?.service_id !== service) fail(`${p.id}/${rep.id}: the next focus is not a skill of this service`);
    seed.reports.push({id: rep.id, appointment_id: a.id, posted_at: rep.posted_at, covered_skill_ids: rep.covered_skill_ids, next_focus: rep.next_focus});
    for (const f of rep.followups) {
      if (f.status === 'done' && f.done_by !== 'student') fail(`${p.id}/${f.id}: a seeded follow-up can be done only by the student`);
      if (f.due_at !== null && ms(f.due_at) <= ms(rep.posted_at)) fail(`${p.id}/${f.id}: the due date is not after the report`);
      seed.followups.push({id: f.id, report_id: rep.id, kind: f.kind, item_refs: f.item_refs, minutes: f.minutes, due_at: f.due_at, status: f.status, done_at: f.done_at, done_by: f.done_by});
    }
  }
  seed.slots = [...slots.values()].sort((x, y) => ms(x.start) - ms(y.start) || (x.id < y.id ? -1 : 1));

  // The history must be one the centre's rules allow: bookings within the weekly cap and outside suspensions.
  const bookedAt = (b, t) => ms(b.booked_at) < t && (b.cancelled_at === null || ms(b.cancelled_at) > t);
  const startOf = a => seed.slots.find(s => s.id === a.slot_id).start;
  for (const a of seed.appointments) {
    const t = ms(a.booked_at), week = weekStart(startOf(a), zone), cap = r.settingsAt(seed, a.booked_at).weekly_cap;
    const count = seed.appointments.filter(b => b !== a && bookedAt(b, t) && weekStart(startOf(b), zone) === week).length;
    if (count >= cap) fail(`${p.id}/${a.id}: booked when the week of ${week} already had ${count} appointments`);
    if (r.suspensions(seed).some(s => ms(s.from) <= t && t < s.until)) fail(`${p.id}/${a.id}: booked while the student was suspended`);
  }
  if (seed.appointments.some((a, i) => i > 0 && ms(a.booked_at) < ms(seed.appointments[i - 1].booked_at))) fail(`${p.id}: appointment IDs follow the booking order`);

  const binding = {people: [{person_id: p.person_id, name: p.student.display_name}, ...c.tutors.map(t => ({person_id: t.person_id, name: t.name}))],
    accounts: [{app_id: 'tutorwell', account_id: p.account_id, owner_person_id: p.person_id}], objects: {tutorwell: model.objects(seed)}};
  if (!seedValid(seed)) fail(`${p.id}: seed does not match the seed schema`);
  model.validateSeed({app_id: 'tutorwell', binding, virtual_now: p.now}, seed);

  const count = (list, key) => list.reduce((m, x) => ({...m, [x[key]]: (m[x[key]] || 0) + 1}), {});
  const summary = {appointments: seed.appointments.length, by_status: count(seed.appointments.map(a => ({s: r.statusOf(seed, a, p.now)})), 's'),
    reports: seed.reports.length, followups: count(seed.followups, 'status'), open_slots: seed.slots.filter(s => ms(s.start) > ms(p.now) && s.withdrawn_at === null).length,
    suspensions: r.suspensions(seed).map(s => ({from: zoned(s.from, zone), until: zoned(s.until, zone), cause: s.cause_appointment_id})),
    records: model.records(seed).length};
  const dataset = {
    schema_version: 'pale.dataset.v1', dataset_id: `tutorwell-${p.id}`, version: '1.0.0',
    description: `Full fixture: one synthetic student (${p.student.display_name}) at a university tutoring and writing centre with six tutors across math and statistics tutoring and the writing centre, a term of ${seed.appointments.length} appointments (completed sessions with their reports and follow-ups, cancellations in time and late, a no-show and a slot the centre withdrew), two weeks of open slots and accommodations with their consents. Load with env.load_seed at virtual_now ${p.now} with this binding.json.`,
    record_source_ids: ['authored', 'milepost-skills'],
    sources: [
      {source_id: 'authored', kind: 'synthetic',
        description: `Hand-written synthetic centre, tutors, timetable, student, accommodations, appointments, intakes, reports and follow-ups (fixtures/centre.json and fixtures/profiles/${p.id}.json). The centre settings and intake fields follow the common pattern of public university tutoring and writing-centre policies, in my own words. The student, the tutors, the centre and its school are fictional. No external collection and no third-party text.`,
        uri: null, license: 'MIT', usage: 'permitted', collection: null,
        generation: {method: 'manual', tool: 'apps/tutorwell/scripts/build-fixtures.cjs', tool_version: '1.0.0', seed: null, parameters: {profile: p.id}}},
      {source_id: 'milepost-skills', kind: 'synthetic',
        description: 'The 40 Algebra 1 and Introductory Statistics skill IDs and titles are those of Milepost\'s course catalog (apps/milepost/fixtures/catalog/courses.json, PR #70, same author, MIT), so a task can load both Apps for the same student. Milepost wrote those titles in its own words after the section structure of two OpenStax textbooks; no textbook text is reproduced here.',
        uri: null, license: 'MIT', usage: 'permitted', collection: null,
        generation: {method: 'manual', tool: 'fixtures/centre.json', tool_version: '1.0.0', seed: null, parameters: {milepost_catalog_commit: '5636409'}}}
    ],
    transformations: ['The centre timetable expanded into 50-minute slots for the two weeks of slot_window, with past slots added for the history; slot IDs are the tutor, the local date and the local start time (ana-0304-0800).', 'Times written in America/New_York with their UTC offset.'],
    expected_counts: {records: model.records(seed).length, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace the author\'s check of every record and human review of realism and variation.'}
  };
  if (!datasetValid(dataset)) fail(`${p.id}: dataset.json does not match the dataset schema`);
  const catalog = {schema_version: 'pale.asset-catalog.v1', catalog_id: `tutorwell-${p.id}-assets`, app_id: 'tutorwell', dataset_ref: 'dataset.json', assets: [], extensions: []};
  return {files: {'seed.json': seed, 'binding.json': binding, 'dataset.json': dataset, 'catalog.json': catalog}, summary};
}

function run({check = false} = {}) {
  const drift = [], report = {}, c = centre();
  for (const p of profiles()) {
    const {files, summary} = build(p, c), dir = path.join(STUDENTS, p.id);
    report[p.id] = summary;
    if (!check) fs.mkdirSync(dir, {recursive: true});
    for (const name of FILES) {
      const target = path.join(dir, name), text = JSON.stringify(files[name], null, 2) + '\n';
      if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(`fixtures/students/${p.id}/${name}`); }
      else fs.writeFileSync(target, text);
    }
    if (check && fs.existsSync(dir)) for (const extra of fs.readdirSync(dir).filter(f => !FILES.includes(f))) drift.push(`fixtures/students/${p.id}/${extra} (not generated)`);
  }
  return {drift, report};
}

module.exports = {build, run, profiles, centre, FILES, at};
if (require.main === module) {
  const check = process.argv.includes('--check'), {drift, report} = run({check});
  if (drift.length) { console.error('Generated fixture drift: ' + drift.join(', ')); process.exit(1); }
  console.log((check ? 'Fixtures match their profiles. ' : 'Wrote fixtures/students/<id>/. ') + JSON.stringify(report, null, 1));
}
