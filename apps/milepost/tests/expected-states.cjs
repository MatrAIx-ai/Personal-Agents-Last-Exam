'use strict';
// Expected states E1-E6 from the approved proposal (section 2, "Learner rule v1 and expected states").
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');
const model = require('../src/model.cjs');
const {checkPlan} = require('../src/checker.cjs');
const {round3} = require('../src/learner.cjs');

const F = 'alg-factoring', X = 'alg-expand';
const at = (day, time) => `2027-03-0${day}T${time}:00-05:00`;
const levels = (f, ids) => Object.fromEntries(f.call('milepost.mastery.get', ids ? {skill_ids: ids} : {}).skills.map(s => [s.skill_id, s.level]));
const projected = (f, id) => Object.fromEntries(f.call('milepost.plan.project', {assessment_id: id}).skills.map(s => [s.skill_id, s.projected_level]));
const state = (f, skill) => model.learnerModel(f.data).stateAt(skill, f.now);
const twoBlocks = f => {
  assert.equal(f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 40}).id, 'blk-1');
  assert.equal(f.call('milepost.plan.add_block', {skill_id: F, start: at(4, '19:00'), minutes: 40}).id, 'blk-2');
};

test('E1: with no practice, levels only fade and reads change nothing', () => {
  const f = fixture(), before = f.data;
  assert.deepEqual(levels(f), {[X]: 0.783, [F]: 0.373});
  f.advance(at(4, '09:00'));
  assert.equal(levels(f, [F])[F], 0.336);
  assert.deepEqual(f.data, before);
});

test('E2: projection for quiz-3, then two blocks, then a refused overlapping block', () => {
  const f = fixture();
  const empty = f.call('milepost.plan.project', {assessment_id: 'quiz-3'});
  assert.deepEqual(empty.skills, [{skill_id: F, projected_level: 0.324, target: 0.6, reaches_target: false}, {skill_id: X, projected_level: 0.751, target: 0.7, reaches_target: true}]);
  twoBlocks(f);
  assert.equal(projected(f, 'quiz-3')[F], 0.643);
  const blocks = f.call('milepost.plan.list').blocks;
  refused(f, () => f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:20'), minutes: 30}), 'overlap');
  assert.deepEqual(f.call('milepost.plan.list').blocks, blocks);
});

test('E3: a completed session for blk-1 raises mastery and marks the block done', () => {
  const f = fixture();
  twoBlocks(f);
  f.event({event_id: 'ev-e3', at: at(2, '19:40'), operation: 'milepost.practice.completed', payload: {skill_id: F, minutes: 40, block_id: 'blk-1'}});
  const s = state(f, F);
  assert.equal(round3(s.m), 0.535);
  assert.equal(round3(s.S), 4.971);
  assert.equal(s.t0, at(2, '19:40'));
  assert.equal(s.last_practised_at, at(2, '19:40'));
  assert.equal(levels(f, [F])[F], 0.535);
  assert.equal(f.call('milepost.plan.list').blocks.find(b => b.id === 'blk-1').status, 'done');
});

test('E4: removing reported practice after a later result keeps the result and restores stability', () => {
  const f = fixture();
  f.advance(at(3, '21:00'));
  const report = f.call('milepost.practice.record', {skill_id: F, minutes: 30, ended_at: at(3, '20:00')}).id;
  let s = state(f, F);
  assert.deepEqual([round3(s.m), round3(s.S)], [0.479, 5.017]);
  f.event({event_id: 'ev-e4', at: at(4, '10:00'), operation: 'milepost.assessment.result_posted', payload: {assessment_id: 'check-1', results: [{skill_id: F, level: 0.5}]}});
  s = state(f, F);
  assert.deepEqual([s.m, s.t0], [0.5, at(4, '10:00')]);
  assert.equal(projected(f, 'quiz-3')[F], 0.490);
  f.call('milepost.practice.remove', {id: report});
  s = state(f, F);
  assert.deepEqual([s.m, s.t0, round3(s.S)], [0.5, at(4, '10:00'), 3]);
  assert.equal(projected(f, 'quiz-3')[F], 0.483);
  assert.equal(f.call('milepost.assessments.list').assessments.find(a => a.id === 'check-1').status, 'assessed');
});

test('E5: an added assessment is accepted; a move of an unknown assessment is refused', () => {
  const f = fixture();
  f.event({event_id: 'ev-e5a', at: at(1, '12:00'), operation: 'milepost.assessment.added',
    payload: {assessment_id: 'quiz-4', date: '2027-03-08T10:00:00-05:00', targets: [{skill_id: X, level: 0.75}]}});
  assert.ok(f.call('milepost.assessments.list').assessments.some(a => a.id === 'quiz-4'));
  assert.deepEqual(Object.keys(projected(f, 'quiz-4')), [X]);
  refused(f, () => f.event({event_id: 'ev-e5b', at: at(1, '12:05'), operation: 'milepost.assessment.moved',
    payload: {assessment_id: 'quiz-9', date: '2027-03-09T10:00:00-05:00'}}), 'unknown_reference');
  assert.equal(f.now, at(1, '12:00'));
});

test('E6: a lower daily cap changes the study rules but not the plan; the checker reports both blocks', () => {
  const f = fixture();
  twoBlocks(f);
  const plan = f.call('milepost.plan.list').blocks;
  assert.deepEqual(checkPlan(f.snapshot()).broken_rules, []);
  f.event({event_id: 'ev-e6', at: at(1, '12:00'), operation: 'milepost.preferences.changed', payload: {rule: 'daily_cap_minutes', value: 30}});
  assert.equal(f.call('milepost.preferences.get').preferences.daily_cap_minutes, 30);
  assert.deepEqual(f.call('milepost.plan.list').blocks, plan);
  const broken = checkPlan(f.snapshot()).broken_rules;
  assert.deepEqual(broken.map(r => [r.rule, r.block_ids]), [['daily_cap_minutes', ['blk-1', 'blk-2']]]);
});
