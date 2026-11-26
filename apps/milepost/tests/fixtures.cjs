'use strict';
// The full fixtures in fixtures/students/<id>/: generated without drift, loadable, counted as declared,
// different between the two students, and honest about where the catalog comes from.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {fixture} = require('./harness.cjs');
const model = require('../src/model.cjs');
const {ms, shift} = require('../src/time.cjs');
const {brokenRules} = require('../src/checker.cjs');
const {run, profiles, FILES} = require('../scripts/build-fixtures.cjs');
const catalog = require('../fixtures/catalog/courses.json');

const root = path.resolve(__dirname, '..');
const bundle = id => Object.fromEntries(FILES.map(f => [f, require(path.join(root, 'fixtures/students', id, f))]));
const PROFILES = profiles();

test('full fixtures: the generator reproduces every committed bundle byte for byte', () => {
  assert.deepEqual(run({check: true}), []);
  assert.deepEqual(PROFILES.map(p => p.id), ['daniel', 'maya']);
});

test('full fixtures: catalog of 3 courses, 16 units, 60 skills and 6 assessments, each unit and skill citing its book section', () => {
  const units = catalog.courses.flatMap(c => c.units), skills = units.flatMap(u => u.skills);
  assert.deepEqual([catalog.courses.length, units.length, skills.length, catalog.assessments.length], [3, 16, 60, 6]);
  for (const c of catalog.courses) assert.ok(catalog.references[c.reference], 'Course cites a declared reference: ' + c.id);
  for (const u of units) assert.match(u.see, /^Chapter \d+$/);
  for (const s of skills) assert.match(s.see, /^\d+\.\d+$/);
  assert.equal(new Set(skills.map(s => s.title)).size, 60, 'Skill names are unique');
  for (const r of Object.values(catalog.references)) {
    assert.equal(r.license, 'CC BY-NC-SA 4.0', 'Recorded license matches openstax.org (checked 2026-11-21)');
    assert.match(r.uri, /^https:\/\/openstax\.org\/details\/books\//);
    assert.ok(r.authors.length > 0);
  }
  // The skill graph crosses courses once: Mendel's crosses need the probability rules.
  assert.deepEqual(skills.find(s => s.id === 'bio-12-1').prerequisites, ['bio-10-2', 'sta-3-3']);
});

for (const profile of PROFILES) {
  test(`full fixtures (${profile.id}): loads at its time with its binding; counts, provenance and reads agree`, () => {
    const b = bundle(profile.id), seed = b['seed.json'];
    const f = fixture({seed, now: profile.now, binding: b['binding.json']});
    assert.deepEqual(['courses', 'units', 'skills', 'mastery', 'assessments'].map(k => seed[k].length), [3, 16, 60, 60, 6]);
    assert.equal(b['dataset.json'].expected_counts.records, model.records(seed).length);
    assert.equal(b['dataset.json'].expected_counts.assets, 0);
    assert.deepEqual(b['dataset.json'].record_source_ids, b['dataset.json'].sources.map(s => s.source_id));
    assert.ok(b['dataset.json'].sources.every(s => s.kind === 'synthetic' && s.usage === 'permitted' && s.license === 'MIT'));
    assert.equal(b['dataset.json'].sources.find(s => s.source_id === 'history').generation.seed, profile.seed);
    assert.deepEqual(b['catalog.json'].assets, []);
    assert.deepEqual(b['binding.json'].objects.milepost, model.objects(seed));
    // Reads on the loaded student.
    assert.equal(f.call('milepost.mastery.get').skills.length, 60);
    assert.equal(f.call('milepost.courses.list').courses.length, 3);
    const upcoming = seed.assessments.filter(a => ms(a.date) > ms(profile.now));
    assert.deepEqual(upcoming.map(a => a.id).sort(), ['alg-quiz-factoring', 'bio-exam-cells', 'sta-exam-probability']);
    for (const a of upcoming) assert.equal(f.call('milepost.plan.project', {assessment_id: a.id}).skills.length, a.targets.length);
  });

  test(`full fixtures (${profile.id}): history follows the profile; results are the rule's level within the declared noise`, () => {
    const seed = bundle(profile.id)['seed.json'];
    // Past assessments have one result each, posted two days and two hours after the assessment.
    const past = seed.assessments.filter(a => ms(shift(a.date, 2 * 1440 + 120)) <= ms(profile.now));
    assert.deepEqual(seed.results.map(r => r.assessment_id).sort(), past.map(a => a.id).sort());
    for (const r of seed.results) {
      const a = seed.assessments.find(x => x.id === r.assessment_id);
      assert.equal(r.posted_at, shift(a.date, 2 * 1440 + 120));
      // Earlier results reset the skills they measured, so compare with the rule replayed up to this result.
      const before = model.learnerModel({...seed, results: seed.results.filter(x => ms(x.posted_at) < ms(r.posted_at))});
      for (const l of r.levels) assert.ok(Math.abs(l.level - before.levelAt(l.skill_id, a.date)) <= 0.05 + 0.005, `${r.id} ${l.skill_id}`);
    }
    // Every practised session would pass the study-rule checker as a planned block: the history keeps the
    // student's own rest days, available hours, block lengths and daily cap.
    assert.ok(seed.practice.length > 0 && seed.practice.every(s => s.source === 'platform'));
    const asBlocks = seed.practice.map(s => ({id: s.id, skill_id: s.skill_id, start: shift(s.ended_at, -s.minutes), minutes: s.minutes,
      created_at: profile.history_start, updated_at: profile.history_start, done: false}));
    assert.deepEqual(brokenRules({...seed, plan: asBlocks}, shift(profile.history_start, -1)), []);
    const blocks = seed.plan;
    assert.ok(blocks.length > 0);
    assert.ok(blocks.every(bl => ms(bl.start) >= ms(`${profile.planned_week_start}T00:00:00${profile.now.slice(-6)}`)), 'The plan covers the planned week only');
    for (const bl of blocks.filter(x => x.done)) assert.ok(seed.practice.some(s => s.block_id === bl.id && s.minutes === bl.minutes));
  });
}

test('full fixtures: the two students differ in mastery, practice history and study rules', () => {
  const [a, b] = PROFILES.map(p => bundle(p.id)['seed.json']);
  assert.notDeepEqual(a.preferences, b.preferences);
  assert.notDeepEqual(a.practice.map(s => [s.skill_id, s.ended_at]), b.practice.map(s => [s.skill_id, s.ended_at]));
  const differ = a.mastery.filter((m, i) => m.level !== b.mastery[i].level).length;
  assert.ok(differ >= 50, `Most starting levels differ (${differ} of 60)`);
  assert.notDeepEqual(a.evaluator.learner_params, b.evaluator.learner_params);
});
