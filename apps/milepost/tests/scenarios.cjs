'use strict';
// The four reference scenarios in examples/scenarios: bundles without drift, reference runs and valid alternatives
// pass, controls fail exactly the checks they name, the twins change only what they declare, no run passes both
// members (with the proof each twin states), and the scripted baseline scores as recorded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const {fixture} = require('./harness.cjs');
const model = require('../src/model.cjs');
const {checkPlan} = require('../src/checker.cjs');
const {ms} = require('../src/time.cjs');
const {run, scenarios, FILES} = require('../scripts/build-scenarios.cjs');
const {grade} = require('../examples/scenarios/grade.cjs');
const {planFor, recordMissed} = require('../examples/scenarios/baseline.cjs');
const {minMinutes, windows} = require('../examples/scenarios/bound.cjs');

const DIR = path.join(__dirname, '../examples/scenarios');
const SPECS = scenarios();
const bundle = (spec, variant) => Object.fromEntries(FILES.map(f => [f, JSON.parse(fs.readFileSync(path.join(DIR, spec.id, variant, f), 'utf8'))]));

// Infra's part: load the bundle at load_at, then apply the setup events and clock moves in order.
function start(spec, variant) {
  const b = bundle(spec, variant);
  const f = fixture({seed: b['seed.json'], now: spec.load_at, binding: b['binding.json']});
  for (const step of spec.setup) step.event ? f.event(step.event) : f.advance(step.advance_to);
  assert.equal(f.now, spec.ask_at);
  return f;
}
function play(f, calls) {
  let refused = 0;
  for (const [name, args] of calls) {
    try { f.call(name, args); } catch (e) { if (!e.code) throw e; refused++; }
  }
  return refused;
}
const failed = result => result.checks.filter(c => !c.pass).map(c => c.name);
function outcome(spec, variant, calls) {
  const f = start(spec, variant), refused = play(f, calls);
  return {result: grade(f.snapshot(), spec, variant), refused, f};
}

test('scenarios: four, covering the four workflows and all five event types; bundles match their scenario.json', () => {
  assert.deepEqual(SPECS.map(s => s.id), ['s1-cells-exam', 's2-four-blocks', 's3-exam-moved', 's4-checkin-result']);
  assert.deepEqual([...new Set(SPECS.flatMap(s => s.workflows))].sort(), [1, 2, 3, 4]);
  const events = new Set(SPECS.flatMap(s => s.setup.filter(x => x.event).map(x => x.event.operation)));
  assert.equal(events.size, 5);
  assert.deepEqual(run({check: true}), []);
  assert.deepEqual([...new Set(SPECS.map(s => s.student))].sort(), ['daniel', 'maya']);
});

for (const spec of SPECS) {
  for (const variant of ['base', 'twin']) {
    const runs = spec.runs[variant];
    test(`${spec.id} (${variant}): the reference and valid alternatives pass; each control fails exactly its checks`, () => {
      for (const [label, calls] of [['reference', runs.reference], ...runs.alternatives.map((c, i) => [`alternative ${i + 1}`, c])]) {
        const {result, refused} = outcome(spec, variant, calls);
        assert.deepEqual([failed(result), refused], [[], 0], `${label}: ${JSON.stringify(result.checks.filter(c => !c.pass))}`);
      }
      for (const control of runs.controls) {
        const {result, refused} = outcome(spec, variant, control.calls);
        assert.deepEqual(failed(result), control.fails, control.name);
        assert.equal(refused, control.expect_refused || 0, control.name + ': refused calls');
      }
    });
  }

  test(`${spec.id}: the twin changes only what it declares; neither reference passes the other member`, () => {
    const base = bundle(spec, 'base')['seed.json'], twin = bundle(spec, 'twin')['seed.json'];
    const touched = new Set([...Object.keys(spec.twin.changes.add || {}), ...Object.keys(spec.twin.changes.update || {})]);
    for (const key of Object.keys(base)) if (!touched.has(key)) assert.deepEqual(twin[key], base[key], key);
    assert.ok([...touched].every(k => ['practice', 'plan'].includes(k)), 'Twins change history only (practice and the blocks it completes)');
    assert.equal(outcome(spec, 'twin', spec.runs.base.reference).result.pass, false, 'Base reference in the twin');
    assert.equal(outcome(spec, 'base', spec.runs.twin.reference).result.pass, false, 'Twin reference in the base');
  });

  test(`${spec.id}: the scripted baseline scores as recorded (base ${spec.baseline.base}, twin ${spec.baseline.twin})`, async () => {
    for (const variant of ['base', 'twin']) {
      const f = start(spec, variant), call = (n, a) => f.call(n, a);
      if (spec.assessment_id) await planFor(call, spec.assessment_id);
      else await recordMissed(call, '2027-03-02T00:00:00-05:00', '2027-03-06T00:00:00-05:00');
      assert.equal(grade(f.snapshot(), spec, variant).pass, spec.baseline[variant], variant);
    }
  });
}

// Why no run passes both members of each pair.
function withoutPractice(spec, variant) {
  const snap = start(spec, variant).snapshot();
  const bare = {virtual_now: snap.virtual_now, data: {...snap.data, plan: snap.data.plan.filter(b => model.blockStatus(b, snap.virtual_now) !== 'planned')}};
  return {snap, skills: checkPlan(bare, {assessment_id: spec.assessment_id}).assessment.skills};
}

for (const id of ['s1-cells-exam', 's4-checkin-result']) {
  test(`${id} twin proof: a skill short without practice in the base reaches its target without practice in the twin`, () => {
    const spec = SPECS.find(s => s.id === id);
    const base = withoutPractice(spec, 'base').skills, twin = withoutPractice(spec, 'twin').skills;
    const decisive = base.filter(s => !s.reaches_target && twin.find(t => t.skill_id === s.skill_id).reaches_target).map(s => s.skill_id);
    assert.ok(decisive.length > 0);
    // Base needs a block on it (all targets, and only practice raises a level); the twin forbids one.
    assert.ok(spec.success.base.includes('all_targets_reached') && spec.success.twin.includes('no_unneeded_practice'));
    // The passing plans agree: every base one practises the decisive skill, no twin one does.
    for (const variant of ['base', 'twin']) for (const calls of [spec.runs[variant].reference, ...spec.runs[variant].alternatives]) {
      const f = start(spec, variant);
      play(f, calls);
      const practised = new Set(f.snapshot().data.plan.filter(b => model.blockStatus(b, f.now) === 'planned').map(b => b.skill_id));
      for (const s of decisive) assert.equal(practised.has(s), variant === 'base', `${variant} passing plan and ${s}`);
    }
  });
}

test('s2-four-blocks twin proof: two new reports are required in the base and none in the twin', () => {
  const spec = SPECS.find(s => s.id === 's2-four-blocks');
  assert.deepEqual([spec.success.base[0].reports_exactly, spec.success.twin[0].reports_exactly], [['blk-s2-2', 'blk-s2-4'], []]);
  // In the twin the blocks are done by sessions an hour after the planned times, so the App does not refuse reports
  // at the planned times: only reading the record avoids double counting.
  const twin = start(spec, 'twin').snapshot().data;
  for (const id of ['blk-s2-2', 'blk-s2-4']) {
    const b = twin.plan.find(x => x.id === id), s = twin.practice.find(x => x.block_id === id);
    assert.ok(b.done && ms(model.sessionInterval(s).start) >= ms(model.blockInterval(b).end));
  }
});

test('s3-exam-moved twin proof: the base cannot reach every short target in the minutes left; the twin must practise each', () => {
  const spec = SPECS.find(s => s.id === 's3-exam-moved');
  const base = withoutPractice(spec, 'base'), twin = withoutPractice(spec, 'twin');
  const shortBase = base.skills.filter(s => !s.reaches_target).map(s => s.skill_id);
  const shortTwin = new Set(twin.skills.filter(s => !s.reaches_target).map(s => s.skill_id));
  assert.deepEqual(shortBase, ['bio-4-3', 'bio-5-1', 'bio-5-2', 'bio-5-3']);
  assert.ok(shortBase.every(s => shortTwin.has(s)), 'Every skill short in the base is short in the twin');
  // Minutes the rules leave before the exam, and the earliest start and latest end of a session.
  const data = base.snap.data, exam = data.assessments.find(a => a.id === spec.assessment_id).date;
  const left = windows(data, base.snap.virtual_now, exam);
  const capacity = left.reduce((t, w) => t + w.minutes, 0);
  assert.equal(capacity, spec.bound.capacity_minutes);
  assert.equal(ms(left[0].first), ms(spec.bound.first_session));
  assert.equal(ms(left[left.length - 1].last), ms(spec.bound.last_session_end));
  // Optimistic minutes per short skill: level at the first possible session, target raised by the least forgetting.
  const p = data.evaluator.learner_params, L = model.learnerModel(data);
  const keep = Math.pow(p.retention_base, ((ms(exam) - ms(spec.bound.last_session_end)) / 86400000) / p.max_stability_days);
  const needs = shortBase.map(id => {
    const target = data.assessments.find(a => a.id === spec.assessment_id).targets.find(t => t.skill_id === id).level;
    return minMinutes(L.levelAt(id, spec.bound.first_session), target / keep, p.learning_rate, data.preferences.block_minutes.min, data.preferences.block_minutes.max);
  });
  const total = needs.reduce((t, n) => t + n, 0);
  assert.ok(total > capacity, `bound ${total} minutes against ${capacity}`);
  assert.deepEqual(needs, [50, 74, 66, 49]);
  // Sanity: the reference needs 90 minutes for bio-4-3, at least what the bound allows.
  assert.ok(needs[0] <= 90);
});

test('bound: minMinutes is exact on small cases and never above what a real session achieves', () => {
  assert.equal(minMinutes(0.5, 0.5, 0.5, 25, 50), 0);
  // One block of d minutes at λ = 0.5 lifts 0.4 to 1 − 0.6·(1 − d/120); 0.6 needs d = 40.
  assert.equal(minMinutes(0.4, 0.6, 0.5, 25, 50), 40);
  assert.equal(minMinutes(0.4, 0.99, 0.5, 25, 50) > 100, true);
  assert.equal(minMinutes(0.4, 1, 0.5, 25, 50), Infinity);
  // A real 45-minute session never does better than the bound's assumption for 45 minutes.
  const spec = SPECS.find(s => s.id === 's3-exam-moved'), f = start(spec, 'base');
  for (const b of f.snapshot().data.plan.filter(x => model.blockStatus(x, f.now) === 'planned')) f.call('milepost.plan.remove_block', {id: b.id});
  const data = f.snapshot().data, lambda = data.evaluator.learner_params.learning_rate;
  const before = model.learnerModel(data).levelAt('bio-5-3', '2027-03-05T18:30:00-05:00');
  f.call('milepost.plan.add_block', {skill_id: 'bio-5-3', start: '2027-03-05T18:30:00-05:00', minutes: 45});
  const projected = checkPlan(f.snapshot(), {assessment_id: 'bio-exam-cells'}).assessment.skills.find(s => s.skill_id === 'bio-5-3').level;
  assert.ok(projected <= 1 - (1 - before) * (1 - lambda * 45 / 60), `${projected} against the bound`);
  assert.ok(projected > before, 'The session does help');
});

test('scenarios: the grader runs from the command line on a snapshot file', () => {
  const spec = SPECS[0], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'milepost-scenario-'));
  const save = (name, calls) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(outcome(spec, 'base', calls).f.snapshot())); return file; };
  const reference = save('reference.json', spec.runs.base.reference), nothing = save('nothing.json', []);
  const script = path.join(DIR, 'grade.cjs');
  const ok = spawnSync(process.execPath, [script, reference, spec.id, 'base'], {encoding: 'utf8'});
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).pass, true);
  assert.equal(spawnSync(process.execPath, [script, nothing, spec.id, 'base'], {encoding: 'utf8'}).status, 1);
  assert.equal(spawnSync(process.execPath, [script, reference, spec.id], {encoding: 'utf8'}).status, 2);
  fs.rmSync(dir, {recursive: true, force: true});
});

// Found by an agent trial (Codex with gpt-6.2-astra, s4 run 1): the final plan projected alg-7-4 at 0.649535,
// shown as 0.65 against a target of 0.65. The projection now says whether each target is reached on the exact level.
test('plan.project: a level that rounds up to its target is reported as not reached', () => {
  const spec = SPECS.find(s => s.id === 's4-checkin-result'), f = start(spec, 'base');
  play(f, [['milepost.plan.remove_block', {id: 'blk-s4-5'}], ['milepost.plan.remove_block', {id: 'blk-s4-6'}], ['milepost.plan.remove_block', {id: 'blk-s4-7'}],
    ['milepost.plan.remove_block', {id: 'blk-s4-10'}], ['milepost.plan.update_block', {id: 'blk-s4-8', patch: {minutes: 80}}],
    ['milepost.plan.update_block', {id: 'blk-s4-9', patch: {minutes: 80}}], ['milepost.plan.update_block', {id: 'blk-s4-11', patch: {minutes: 80}}],
    ['milepost.plan.add_block', {skill_id: 'alg-7-5', start: '2027-03-10T06:30:00-05:00', minutes: 30}],
    ['milepost.plan.add_block', {skill_id: 'alg-7-4', start: '2027-03-10T07:00:00-05:00', minutes: 30}]]);
  const s = f.call('milepost.plan.project', {assessment_id: 'alg-quiz-factoring'}).skills.find(x => x.skill_id === 'alg-7-4');
  assert.deepEqual([s.projected_level, s.target, s.reaches_target], [0.65, 0.65, false]);
  const checker = checkPlan(f.snapshot(), {assessment_id: 'alg-quiz-factoring'}).assessment.skills.find(x => x.skill_id === 'alg-7-4');
  assert.equal(checker.reaches_target, s.reaches_target, 'The Agent sees what the grader decides');
  assert.equal(grade(f.snapshot(), spec, 'base').checks.find(c => c.name === 'all_targets_reached').pass, false);
});
