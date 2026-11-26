#!/usr/bin/env node
'use strict';
// Builds the full fixtures from the hand-written catalog (fixtures/catalog/courses.json) and student profiles
// (fixtures/profiles/*.json) with a fixed seeded PRNG and learner rule v1. Each student becomes one load bundle,
// fixtures/students/<id>/: seed.json, binding.json, dataset.json (provenance and expected counts) and catalog.json
// (an empty asset catalog). Every seed must pass the seed schema and validateSeed at the profile's `now`.
// Run `node scripts/build-fixtures.cjs`; `--check` reports drift and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const model = require('../src/model.cjs');
const learner = require('../src/learner.cjs');
const {local, shift, ms} = require('../src/time.cjs');
const {compile} = require('../tests/schema-validator.cjs');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/catalog/courses.json'), 'utf8'));
const schema = name => compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8')), path.join(root, 'schemas'));
const seedValid = schema('seed.schema.json'), datasetValid = schema('dataset.schema.json'), catalogValid = schema('asset-catalog.schema.json');
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).version;
const FILES = ['seed.json', 'binding.json', 'dataset.json', 'catalog.json'];
const ASSESSMENTS_CREATED = '2027-01-25T12:00:00-05:00';

function mulberry32(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fail = message => { throw new Error(message); };

function catalogRecords() {
  const courses = [], units = [], skills = [];
  for (const c of catalog.courses) {
    courses.push({id: c.id, title: c.title});
    c.units.forEach((u, i) => {
      units.push({id: u.id, course_id: c.id, title: u.title, position: i + 1});
      for (const s of u.skills) skills.push({id: s.id, unit_id: u.id, title: s.title, prerequisites: [...s.prerequisites]});
    });
  }
  return {courses, units, skills};
}

// Local wall time on `date` (YYYY-MM-DD) at `time` (HH:MM), written with the profile's fixed UTC offset.
// The generator refuses dates where that offset is wrong for the student's time zone (no DST inside history).
function at(profile, date, time, offset) {
  const iso = `${date}T${time}:00${offset}`;
  const l = local(iso, profile.student.time_zone);
  if (l.date !== date || l.minutes !== Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) fail(`Offset ${offset} is wrong for ${date} in ${profile.student.time_zone}`);
  return iso;
}

function build(profile) {
  const rng = mulberry32(profile.seed);
  const {courses, units, skills} = catalogRecords();
  const byId = new Map(skills.map(s => [s.id, s]));
  const courseOf = new Map(skills.map(s => [s.id, units.find(u => u.id === s.unit_id).course_id]));
  const depthMemo = new Map();
  const depth = id => {
    if (!depthMemo.has(id)) depthMemo.set(id, byId.get(id).prerequisites.length ? 1 + Math.max(...byId.get(id).prerequisites.map(depth)) : 0);
    return depthMemo.get(id);
  };
  const offset = profile.history_start.slice(-6), start = profile.history_start;

  // Baseline at the start of the history.
  const mastery = skills.map(s => {
    const base = s.id in profile.overrides ? profile.overrides[s.id]
      : profile.strength[courseOf.get(s.id)] - 0.03 * depth(s.id) + (rng() * 0.1 - 0.05);
    const daysBefore = 2 + Math.floor(rng() * 18);
    return {skill_id: s.id, level: round(clamp(base, 0.05, 0.95), 2), stability_days: round(6 + rng() * 14, 1),
      as_of: start, last_practised_at: shift(start, -daysBefore * 1440)};
  });

  // Practice history from the habits; the last week also has a plan whose blocks are done or missed.
  const practice = [], plan = [];
  const rotations = profile.habits.map(h => {
    const list = skills.filter(s => h.focus.includes(s.unit_id)).map(s => s.id);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return {list, next: 0};
  });
  const minutesIn = ([a, b]) => a + 5 * Math.floor(rng() * ((b - a) / 5 + 1));
  const planCreated = at(profile, shift(`${profile.planned_week_start}T12:00:00${offset}`, -1440).slice(0, 10), '20:00', offset);
  let n = 0, b = 0;
  for (let day = profile.history_start.slice(0, 10); ms(`${day}T00:00:00${offset}`) < ms(profile.now); day = shift(`${day}T12:00:00${offset}`, 1440).slice(0, 10)) {
    const weekday = local(`${day}T12:00:00${offset}`, profile.student.time_zone).weekday;
    const planned = day >= profile.planned_week_start;
    profile.habits.forEach((h, k) => {
      if (!h.days.includes(weekday)) return;
      const begin = at(profile, day, h.start, offset);
      if (ms(begin) < ms(profile.history_start)) return;  // the history starts at the baseline's as_of
      const rot = rotations[k], skill = rot.list[rot.next++ % rot.list.length];
      const attended = rng() < h.attendance;
      const minutes = planned ? h.minutes[0] + 5 * Math.round((h.minutes[1] - h.minutes[0]) / 10) : minutesIn(h.minutes);
      let block = null;
      if (planned) {
        block = {id: `blk-h${++b}`, skill_id: skill, start: begin, minutes, created_at: planCreated, updated_at: planCreated, done: false};
        plan.push(block);
      }
      if (attended) {
        const ended = shift(begin, minutes);
        if (ms(ended) > ms(profile.now)) return;
        practice.push({id: `ses-h${++n}`, skill_id: skill, minutes, ended_at: ended, source: 'platform', block_id: block ? block.id : null, recorded_at: ended});
        if (block) Object.assign(block, {done: true, updated_at: ended});
      }
    });
  }

  const assessments = catalog.assessments.map(a => ({id: a.id, title: a.title, date: a.date,
    targets: Object.entries(a.targets).map(([skill_id, level]) => ({skill_id, level})), created_at: ASSESSMENTS_CREATED, updated_at: ASSESSMENTS_CREATED}));

  const data = {account_id: profile.account_id, owner_person_id: profile.person_id, student: profile.student, courses, units, skills,
    mastery, assessments, results: [], practice, plan, preferences: profile.preferences,
    evaluator: {learner_params: profile.learner_params, activity_log: []}};

  // Results of past assessments: the level under learner rule v1 at the assessment, with seeded noise,
  // posted two days and two hours later; earlier results are part of the history used for later ones.
  const past = assessments.filter(a => ms(shift(a.date, 2 * 1440 + 120)) <= ms(profile.now)).sort((x, y) => ms(x.date) - ms(y.date));
  for (const a of past) {
    const levels = model.learnerModel(data);
    data.results.push({id: `res-h${data.results.length + 1}`, assessment_id: a.id, posted_at: shift(a.date, 2 * 1440 + 120),
      levels: a.targets.map(t => ({skill_id: t.skill_id, level: round(clamp(levels.levelAt(t.skill_id, a.date) + (rng() * 0.1 - 0.05), 0, 1), 2)}))});
  }

  const binding = {people: [{person_id: profile.person_id, name: profile.student.display_name}],
    accounts: [{app_id: 'milepost', account_id: profile.account_id, owner_person_id: profile.person_id}],
    objects: {milepost: model.objects(data)}};
  if (!seedValid(data)) fail(`${profile.id}: generated seed does not match the seed schema`);
  model.validateSeed({app_id: 'milepost', binding, virtual_now: profile.now}, data);
  // The runtime rejects records whose bodies repeat (id excluded); refuse them here first.
  const bodies = model.records(data).map(r => JSON.stringify({...r, id: undefined}));
  if (new Set(bodies).size !== bodies.length) fail(`${profile.id}: duplicate record bodies`);
  return {data, binding, dataset: dataset(profile, data), catalog: assetCatalog(profile)};
}

function references() {
  return Object.values(catalog.references).map(r => `${r.title} (${r.authors.join(', ')}; ${r.publisher}, ${r.published.slice(0, 4)}; ${r.license}; ${r.uri})`).join('; ');
}

function dataset(profile, data) {
  const manual = {method: 'manual', tool: 'Milepost fixture authoring', tool_version: APP_VERSION, seed: null, parameters: {}};
  const counts = Object.fromEntries(['courses', 'units', 'skills', 'assessments', 'results', 'practice', 'plan'].map(k => [k, data[k].length]));
  return {
    schema_version: 'pale.dataset.v1',
    dataset_id: `milepost-student-${profile.id}`,
    version: APP_VERSION,
    description: `Synthetic student ${profile.student.display_name} (invented; no real person or school) for Milepost Tasks: ` +
      `${counts.courses} courses, ${counts.skills} skills, ${counts.assessments} assessments, four weeks of practice history and a planned week. ` +
      `Load with env.load_seed at virtual_now ${profile.now}, with this binding.json and the package's fixtures/policies.json.`,
    record_source_ids: ['catalog', 'profile', 'history'],
    sources: [
      {source_id: 'catalog', kind: 'synthetic',
        description: 'Courses, units, skills, prerequisites, assessments and targets written by hand for Milepost (fixtures/catalog/courses.json). ' +
          'Topic choice and order follow the tables of contents of three OpenStax textbooks, cited per unit and skill in that file: ' + references() + '. ' +
          'Names are Milepost\'s own wording; no text, figures or exercises from the books are included.',
        uri: null, license: 'MIT', usage: 'permitted', collection: null, generation: manual},
      {source_id: 'profile', kind: 'synthetic',
        description: `Hand-written student profile fixtures/profiles/${profile.id}.json: name, time zone, study preferences, weekly habits, starting strengths and learner parameters. Invented.`,
        uri: null, license: 'MIT', usage: 'permitted', collection: null, generation: manual},
      {source_id: 'history', kind: 'synthetic',
        description: 'Starting mastery, practice sessions, the planned week and the results of past assessments, simulated from the profile with a seeded PRNG (mulberry32) and the learner rule.',
        uri: null, license: 'MIT', usage: 'permitted', collection: null,
        generation: {method: 'seeded simulation', tool: 'apps/milepost/scripts/build-fixtures.cjs', tool_version: APP_VERSION, seed: profile.seed,
          parameters: {learner_rule: learner.VERSION, history_start: profile.history_start, now: profile.now, planned_week_start: profile.planned_week_start,
            depth_penalty: 0.03, baseline_noise: 0.05, result_noise: 0.05, stability_days: [6, 20]}}}
    ],
    transformations: [
      'Catalog and profile written by hand; the generator expands them into one seed and checks it against the seed schema and validateSeed.',
      'Results are the learner rule\'s level at each past assessment plus seeded noise of at most 0.05, posted two days and two hours later.'
    ],
    expected_counts: {records: model.records(data).length, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace human review of realism, variation and reuse permissions.'}
  };
}

function assetCatalog(profile) {
  return {schema_version: 'pale.asset-catalog.v1', catalog_id: `milepost-student-${profile.id}-assets`, app_id: 'milepost', dataset_ref: 'dataset.json', assets: [], extensions: []};
}

function profiles() {
  return fs.readdirSync(path.join(root, 'fixtures/profiles')).filter(f => f.endsWith('.json')).sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(root, 'fixtures/profiles', file), 'utf8')));
}

function run({check = false} = {}) {
  const drift = [], students = path.join(root, 'fixtures/students'), expected = new Set(['README.md']);
  for (const profile of profiles()) {
    const built = build(profile), values = {'seed.json': built.data, 'binding.json': built.binding, 'dataset.json': built.dataset, 'catalog.json': built.catalog};
    if (!datasetValid(built.dataset)) fail(`${profile.id}: dataset.json does not match the dataset schema`);
    if (!catalogValid(built.catalog)) fail(`${profile.id}: catalog.json does not match the asset catalog schema`);
    expected.add(profile.id);
    if (!check) fs.mkdirSync(path.join(students, profile.id), {recursive: true});
    for (const name of FILES) {
      const target = path.join(students, profile.id, name), text = JSON.stringify(values[name], null, 2) + '\n';
      if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(`fixtures/students/${profile.id}/${name}`); }
      else fs.writeFileSync(target, text);
    }
    if (check && fs.existsSync(path.join(students, profile.id))) {
      for (const extra of fs.readdirSync(path.join(students, profile.id)).filter(f => !FILES.includes(f))) drift.push(`fixtures/students/${profile.id}/${extra} (not generated)`);
    }
  }
  if (check && fs.existsSync(students)) for (const extra of fs.readdirSync(students).filter(f => !expected.has(f))) drift.push(`fixtures/students/${extra} (not generated)`);
  return drift;
}

module.exports = {build, run, profiles, FILES};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = run({check});
  if (drift.length) { console.error('Generated fixture drift: ' + drift.join(', ')); process.exit(1); }
  console.log(check ? 'Full fixtures match their catalog and profiles.' : 'Wrote fixtures/students/<id>/ for every profile.');
}
