'use strict';
// The worked task example in examples/task-data: reference run, a valid alternative, controls and the twin.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const {fixture, MINIMAL} = require('./harness.cjs');
const {grade} = require('../examples/task-data/grade.cjs');

const BASE = require('../examples/task-data/friday-quiz.seed.json');
const TWIN = require('../examples/task-data/friday-quiz.twin.seed.json');
const at = (day, time) => `2027-03-0${day}T${time}:00-05:00`;
function run(seed, blocks) {
  const f = fixture({seed});
  for (const [skill_id, start, minutes] of blocks) f.call('milepost.plan.add_block', {skill_id, start, minutes});
  return f.snapshot();
}
const F = 'alg-factoring', X = 'alg-expand';
const REFERENCE = [[F, at(2, '19:00'), 40], [F, at(4, '19:00'), 40]];
const failed = result => result.checks.filter(c => !c.pass).map(c => c.name);

test('task example: the base seed is the package example student; the twin changes only factoring history', () => {
  assert.deepEqual(BASE, MINIMAL);
  const extra = TWIN.practice.filter(s => !BASE.practice.some(b => b.id === s.id));
  assert.deepEqual(extra.map(s => [s.skill_id, s.minutes]), [[F, 45], [F, 45]]);
  assert.deepEqual({...TWIN, practice: []}, {...BASE, practice: []});
});

test('task example (base): the reference run and a valid alternative pass; no-action, over-planning, rule-breaking and unneeded practice fail', () => {
  assert.equal(grade(run(BASE, REFERENCE), 'base').pass, true);
  assert.equal(grade(run(BASE, [[F, at(2, '18:00'), 50], [F, at(4, '18:00'), 50]]), 'base').pass, true);
  assert.deepEqual(failed(grade(run(BASE, []), 'base')), ['every quiz-3 target is reached in the projection']);
  assert.deepEqual(failed(grade(run(BASE, [[F, at(1, '18:00'), 40], [F, at(2, '18:00'), 40], [F, at(3, '18:00'), 40], [F, at(4, '18:00'), 40]]), 'base')), ['planned minutes stay within 120']);
  assert.deepEqual(failed(grade(run(BASE, [[F, at(2, '15:00'), 40], [F, at(4, '19:00'), 40]]), 'base')), ['no study rule is broken']);
  assert.deepEqual(failed(grade(run(BASE, [...REFERENCE, [X, at(3, '19:00'), 30]]), 'base')), ['no practice is planned for a skill that already reaches its target']);
});

test('task example (twin): planning nothing passes; the base reference plan fails, so no plan passes both', () => {
  assert.equal(grade(run(TWIN, []), 'twin').pass, true);
  assert.equal(grade(run(TWIN, REFERENCE), 'twin').pass, false);
  assert.equal(grade(run(BASE, []), 'base').pass, false, 'The twin answer fails the base task');
});

test('task example: the grader also runs from the command line on a snapshot file', () => {
  const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'milepost-grade-')), 'snapshot.json');
  fs.writeFileSync(file, JSON.stringify(run(BASE, REFERENCE)));
  const script = path.join(__dirname, '../examples/task-data/grade.cjs');
  const ok = spawnSync(process.execPath, [script, file, 'base'], {encoding: 'utf8'});
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).pass, true);
  assert.equal(spawnSync(process.execPath, [script, file, 'twin'], {encoding: 'utf8'}).status, 1);
  fs.rmSync(path.dirname(file), {recursive: true, force: true});
});
