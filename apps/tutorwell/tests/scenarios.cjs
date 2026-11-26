'use strict';
// The four reference scenarios in the App-only harness: bundles rebuild byte for byte; every reference and valid
// alternative passes; every control fails exactly the checks it names; neither member's reference passes the other
// member; every event type appears in some setup; the scripted baseline gets the results scenario.json records.
const test = require('node:test');
const assert = require('node:assert/strict');
const {run, scenarios} = require('../scripts/build-scenarios.cjs');
const {load, playLocal} = require('../examples/scenarios/local.cjs');
const {baseline} = require('../examples/scenarios/baseline.cjs');
const {grade} = require('../examples/scenarios/grade.cjs');

const failed = r => r.grade.checks.filter(c => !c.pass).map(c => c.name);

test('scenario bundles match their scenario.json and fixtures', () => {
  assert.deepEqual(run({check: true}), []);
  assert.equal(scenarios().length, 4);
  assert.deepEqual([...new Set(scenarios().flatMap(s => s.workflows))].sort(), [1, 2, 3, 4]);
});

for (const s of scenarios()) {
  test(`${s.id}: references and alternatives pass, controls fail where they should, and the members disagree`, () => {
    for (const variant of ['base', 'twin']) {
      const runs = s.runs[variant];
      const reference = playLocal(s.id, variant, runs.reference);
      assert.ok(reference.grade.pass, `${variant} reference: ${JSON.stringify(reference.grade.checks.filter(c => !c.pass))}`);
      assert.equal(reference.refused, 0, `${variant} reference: no refused call`);
      runs.alternatives.forEach((calls, i) => {
        const r = playLocal(s.id, variant, calls);
        assert.ok(r.grade.pass, `${variant} alternative ${i + 1}: ${JSON.stringify(r.grade.checks.filter(c => !c.pass))}`);
      });
      for (const c of runs.controls) assert.deepEqual(failed(playLocal(s.id, variant, c.calls)), c.fails, `${variant} control: ${c.name}`);
    }
    assert.equal(playLocal(s.id, 'twin', s.runs.base.reference).grade.pass, false, 'The base reference fails the twin');
    assert.equal(playLocal(s.id, 'base', s.runs.twin.reference).grade.pass, false, 'The twin reference fails the base');
  });
}

test('every event type is used by some scenario setup', () => {
  const used = new Set(scenarios().flatMap(s => [...s.setup, ...(s.twin.setup || [])]).filter(x => x.event).map(x => x.event.operation));
  assert.deepEqual([...used].sort(), [...require('../app.json').event_types].sort());
});

test('the scripted baseline, using only Agent tools, gets the recorded results', async () => {
  for (const s of scenarios()) for (const variant of ['base', 'twin']) {
    const {f} = load(s.id, variant);
    await baseline((name, args) => f.call(name, args), s);
    const g = grade(f.snapshot(), s, variant);
    assert.equal(g.pass, s.baseline[variant], `${s.id}/${variant}: ${JSON.stringify(g.checks.filter(c => !c.pass))}`);
  }
});
