#!/usr/bin/env node
'use strict';
// Builds the full fixtures fixtures/students/<id>/{seed,binding,dataset,catalog}.json from the hand-written profiles in
// fixtures/profiles/<id>.json: essays as paragraphs, comments anchored by paragraph and quote, past submissions,
// grades and course threads. Every sentence of a seeded version is the student's. Versions get account-wide IDs
// v1, v2, ... in the order they were saved. Each bundle must pass the seed schema and validateSeed at the profile's
// `now`. Run `node scripts/build-fixtures.cjs`; `--check` rebuilds in memory, compares byte for byte and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const model = require('../src/model.cjs');
const k = require('../src/edit-kind.cjs');
const {compile} = require('../tests/schema-validator.cjs');

const schema = name => compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8')), path.join(root, 'schemas'));
const seedValid = schema('seed.schema.json'), datasetValid = schema('dataset.schema.json');
const PROFILES = path.join(root, 'fixtures/profiles'), STUDENTS = path.join(root, 'fixtures/students');
const FILES = ['seed.json', 'binding.json', 'dataset.json', 'catalog.json'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = message => { throw new Error(message); };
const profiles = () => fs.readdirSync(PROFILES).filter(f => f.endsWith('.json')).sort().map(f => read(path.join(PROFILES, f)));
const words = text => text.split(/\s+/).filter(Boolean).length;

function build(p) {
  const seed = {account_id: p.account_id, owner_person_id: p.person_id, student: p.student, assistant_rules: p.assistant_rules,
    courses: [], policies: [], assignments: [], versions: [], comments: [], suggestions: [], checklists: [], messages: [], submissions: [], grades: [],
    evaluator: {activity_log: []}};
  for (const c of p.courses) {
    seed.courses.push({id: c.id, title: c.title, instructor_name: c.instructor_name});
    for (const entry of c.policy) seed.policies.push({id: 'pol-' + (seed.policies.length + 1), course_id: c.id, at: entry.at, allowed: entry.allowed});
  }
  // Account-wide version IDs in saving order.
  const saved = p.assignments.flatMap(a => a.versions.map((v, i) => ({a, v, number: i + 1}))).sort((x, y) => Date.parse(x.v.saved_at) - Date.parse(y.v.saved_at));
  const versionId = new Map(saved.map((s, i) => [s.a.id + '#' + s.number, 'v' + (i + 1)]));
  let reply = 0;
  for (const a of p.assignments) {
    seed.assignments.push({id: a.id, course_id: a.course_id, title: a.title, prompt: a.prompt, due_at: a.due_at, criteria: a.criteria});
    for (const c of a.comments) {
      const at = c.updated_at || c.posted_at;
      seed.comments.push({id: c.id, assignment_id: a.id, version_id: versionId.get(a.id + '#' + c.version), paragraph_id: c.paragraph, quote: c.quote,
        from: c.from, criterion_id: c.criterion, text: c.text, posted_at: c.posted_at, status: c.status, updated_at: at,
        replies: (c.replies || []).map(r => ({id: p.id[0] + '-r' + (++reply), author: r.author, text: r.text, at: r.at}))});
    }
    for (const s of a.submissions) seed.submissions.push({id: 'sub-' + (seed.submissions.length + 1), assignment_id: a.id, version_id: versionId.get(a.id + '#' + s.version), at: s.at, by: s.by});
    if (a.grade) seed.grades.push({id: 'grade-' + (seed.grades.length + 1), assignment_id: a.id, at: a.grade.at,
      levels: Object.entries(a.grade.levels).map(([criterion_id, level]) => ({criterion_id, level}))});
  }
  for (const s of saved) {
    seed.versions.push({id: versionId.get(s.a.id + '#' + s.number), assignment_id: s.a.id, number: s.number, saved_at: s.v.saved_at, saved_by: 'student',
      suggestion_id: null, paragraphs: s.v.paragraphs.map(([id, text]) => ({id, sentences: k.sentences(text).map(t => ({text: t, author: 'student', ref: null}))}))});
  }
  seed.comments.sort((x, y) => Date.parse(x.posted_at) - Date.parse(y.posted_at) || (x.id < y.id ? -1 : 1));
  seed.messages = p.messages.map(m => ({id: m.id, course_id: m.course_id, author: m.author, in_reply_to: m.in_reply_to, text: m.text, at: m.at}));

  const binding = {people: [{person_id: p.person_id, name: p.student.display_name},
    ...p.courses.map(c => ({person_id: c.instructor_person_id, name: c.instructor_name.replace(/^(Dr\.|Prof\.) /, '')}))],
  accounts: [{app_id: 'second-draft', account_id: p.account_id, owner_person_id: p.person_id}], objects: {'second-draft': model.objects(seed)}};
  if (!seedValid(seed)) fail(`${p.id}: seed does not match the seed schema`);
  model.validateSeed({app_id: 'second-draft', binding, virtual_now: p.now}, seed);

  const current = p.assignments.filter(a => !a.grade && !a.submissions.length);
  const essay = current.map(a => ({id: a.id, words: words(a.versions.at(-1).paragraphs.map(x => x[1]).join(' ')), paragraphs: a.versions.at(-1).paragraphs.length, comments: a.comments.length}));
  const dataset = {
    schema_version: 'pale.dataset.v1', dataset_id: `second-draft-${p.id}`, version: '1.0.0',
    description: `Full fixture: one synthetic student (${p.student.display_name}) with two courses whose AI policies differ, two graded past essays with their comments, and one current essay with anchored comments from the instructor, a peer and the writing centre. Load with env.load_seed at virtual_now ${p.now} with this binding.json.`,
    record_source_ids: ['authored'],
    sources: [{source_id: 'authored', kind: 'synthetic',
      description: `Hand-written synthetic student, courses, AI policies, essays, comments, grades and course threads (fixtures/profiles/${p.id}.json); recurring problems are planted across the graded essays. No external collection, no real people, courses or schools, and no third-party text.`,
      uri: null, license: 'MIT', usage: 'permitted', collection: null,
      generation: {method: 'manual', tool: 'apps/second-draft/scripts/build-fixtures.cjs', tool_version: '1.0.0', seed: null, parameters: {profile: p.id}}}],
    transformations: ['Paragraphs split into sentences under second-draft-edit-kind/1, every seeded sentence authored by the student; versions numbered v1, v2, ... in saving order; policy entries, replies, submissions and grades given sequential IDs.'],
    expected_counts: {records: model.records(seed).length, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace the author\'s check of every record and human review of realism and variation.'}
  };
  if (!datasetValid(dataset)) fail(`${p.id}: dataset.json does not match the dataset schema`);
  const catalog = {schema_version: 'pale.asset-catalog.v1', catalog_id: `second-draft-${p.id}-assets`, app_id: 'second-draft', dataset_ref: 'dataset.json', assets: [], extensions: []};
  return {files: {'seed.json': seed, 'binding.json': binding, 'dataset.json': dataset, 'catalog.json': catalog}, essay};
}

function run({check = false} = {}) {
  const drift = [], report = {};
  for (const p of profiles()) {
    const {files, essay} = build(p), dir = path.join(STUDENTS, p.id);
    report[p.id] = essay;
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

module.exports = {build, run, profiles, FILES};
if (require.main === module) {
  const check = process.argv.includes('--check'), {drift, report} = run({check});
  if (drift.length) { console.error('Generated fixture drift: ' + drift.join(', ')); process.exit(1); }
  console.log((check ? 'Fixtures match their profiles. ' : 'Wrote fixtures/students/<id>/. ') + JSON.stringify(report));
}
