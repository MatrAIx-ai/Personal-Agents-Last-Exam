'use strict';
// Seed validation, the evaluator-only boundary, the reviewer renderer, the plan checker and package contracts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {fixture, refused, MINIMAL} = require('./harness.cjs');
const plugin = require('../plugin.cjs');
const view = require('../gui/src/view.js');
const {checkPlan} = require('../src/checker.cjs');
const tools = require('../tools.json');

const F = 'alg-factoring', X = 'alg-expand';
const at = (day, time) => `2027-03-0${day}T${time}:00-05:00`;
const ctx = fixture().ctx;
const seed = mutate => { const d = structuredClone(MINIMAL); mutate(d); return d; };
const rejects = (name, mutate, pattern) => test('seed rejected: ' + name, () => assert.throws(() => plugin.validateSeed(ctx, seed(mutate)), pattern));

rejects('unbound account', d => { d.account_id = 'unbound-account'; }, /binding/);
rejects('duplicate object ID', d => { d.assessments[1].id = 'quiz-3'; }, /unique/);
rejects('unit with an unknown course', d => { d.units[0].course_id = 'course-x'; }, /unknown course/);
rejects('prerequisite cycle', d => { d.skills[0].prerequisites = [F]; }, /cycle/);
rejects('missing mastery record', d => { d.mastery.pop(); }, /mastery record/);
rejects('stability outside the student bounds', d => { d.mastery[0].stability_days = 90; }, /stability/);
rejects('result before its assessment', d => { d.results.push({id: 'res-1', assessment_id: 'check-1', posted_at: at(1, '08:00'), levels: [{skill_id: F, level: 0.5}]}); }, /before its assessment/);
rejects('history in the future', d => { d.practice.push({id: 'ses-1', skill_id: F, minutes: 30, ended_at: at(1, '10:00'), source: 'student_report', block_id: null, recorded_at: at(1, '10:00')}); }, /future/);
rejects('overlapping sessions', d => {
  d.practice.push({id: 'ses-1', skill_id: F, minutes: 30, ended_at: '2027-02-28T10:00:00-05:00', source: 'student_report', block_id: null, recorded_at: '2027-02-28T10:00:00-05:00'},
    {id: 'ses-2', skill_id: X, minutes: 30, ended_at: '2027-02-28T10:20:00-05:00', source: 'student_report', block_id: null, recorded_at: '2027-02-28T10:20:00-05:00'});
}, /overlap/);
rejects('done flag without a completed session', d => { d.plan.push({id: 'blk-1', skill_id: F, start: at(2, '19:00'), minutes: 40, created_at: at(1, '08:00'), updated_at: at(1, '08:00'), done: true}); }, /done exactly/);

test('the evaluator-only boundary: planted markers never reach tool results, errors or pages', () => {
  const marker = 'MARKER-EVAL-ONLY-42';
  const data = seed(d => {
    d.evaluator.learner_params.retention_base = 0.913579;
    d.evaluator.activity_log.push({seq: 1, at: at(1, '08:00'), operation: 'milepost.plan.add_block', request_id: marker,
      expected_version: {epoch: 1, revision: 0}, object_id: marker, details: {note: marker}});
  });
  const f = fixture({seed: data});
  f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 40});
  const outputs = [];
  for (const t of tools.filter(t => t.read_only)) outputs.push(f.call(t.name, t.name.endsWith('project') ? {assessment_id: 'quiz-3'} : {}));
  for (const [name, args] of [['milepost.plan.project', {assessment_id: marker}], ['milepost.practice.remove', {id: marker}], ['milepost.plan.remove_block', {id: marker}]]) {
    try { f.call(name, args); } catch (e) { outputs.push({code: e.code, message: e.message}); }
  }
  const page = view.render(Object.fromEntries(Object.entries(view.READS).map(([k, [name, args]]) => [k, f.call(name, args)])));
  const text = JSON.stringify(outputs) + page;
  for (const secret of [marker, '0.913579', 'learner_params', 'activity_log', 'stability', 'retention_base']) assert.ok(!text.includes(secret), 'Leaked: ' + secret);
});

test('the reviewer renderer shows exactly the tool results in four views and escapes untrusted text', () => {
  const f = fixture({seed: seed(d => { d.skills[1].title = '<script>alert(1)</script>'; })});
  f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 40});
  f.advance(at(2, '21:00'));
  f.call('milepost.practice.record', {skill_id: X, minutes: 30, ended_at: at(2, '20:30')});
  const model = Object.fromEntries(Object.entries(view.READS).map(([k, [name, args]]) => [k, f.call(name, args)]));
  const html = view.render(model);
  assert.deepEqual(view.VIEWS, ['overview', 'skills', 'plan', 'practice']);
  for (const v of view.VIEWS) assert.ok(html.includes('data-view="' + v + '"'));
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
  for (const b of model.plan.blocks) assert.ok(html.includes(b.id) && html.includes(b.status));
  for (const s of model.practice.sessions) assert.ok(html.includes(s.id) && html.includes(s.source));
  for (const s of model.mastery.skills) assert.ok(html.includes(s.level.toFixed(3)));
});

test('the plan checker reports each broken study rule and whether targets are reached, without changing its input', () => {
  const f = fixture();
  f.call('milepost.plan.add_block', {skill_id: F, start: '2027-03-07T19:00:00-05:00', minutes: 40});  // Sunday, a rest day
  f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '15:00'), minutes: 40});              // outside 18:00-22:00
  f.call('milepost.plan.add_block', {skill_id: X, start: at(3, '18:00'), minutes: 10});              // shorter than 20
  f.call('milepost.plan.add_block', {skill_id: F, start: at(4, '18:00'), minutes: 60});
  f.call('milepost.plan.add_block', {skill_id: F, start: at(4, '19:00'), minutes: 40});              // 100 > 90 minutes that day
  const snapshot = f.snapshot(), before = JSON.stringify(snapshot);
  const out = checkPlan(snapshot, {assessment_id: 'quiz-3'});
  assert.equal(JSON.stringify(snapshot), before);
  assert.deepEqual(out.broken_rules.map(r => [r.rule, r.block_ids]), [['rest_days', ['blk-1']], ['available_hours', ['blk-1', 'blk-2']],
    ['block_minutes', ['blk-3']], ['daily_cap_minutes', ['blk-4', 'blk-5']]]);
  assert.deepEqual(out.assessment.skills.map(s => [s.skill_id, s.reaches_target]), [[F, true], [X, true]]);
  assert.equal(out.rule_version, 'milepost-learner/1');
  assert.ok(!('broken_rules' in f.call('milepost.plan.project', {assessment_id: 'quiz-3'})), 'Agents never see the rule check');
});

test('package contracts: generated files are current and declarations agree', () => {
  assert.deepEqual(require('../scripts/build-contracts.cjs').build({check: true}), []);
  const app = require('../app.json'), contribution = require('../contribution/contribution.json'), events = require('../schemas/events.schema.json');
  assert.deepEqual([...new Set(events.oneOf.map(e => e.properties.operation.const))], app.event_types);
  assert.deepEqual(contribution.events.accepts.map(e => e.type), app.event_types);
  assert.deepEqual(contribution.interfaces.find(i => i.interface_id === 'agent-mcp').operations.map(o => o.name), tools.map(t => t.name));
  const policies = require('../fixtures/policies.json');
  for (const p of Object.values(policies)) assert.ok(p.allow.every(n => tools.some(t => t.name === n)));
  assert.ok(!policies.scenario.allow.includes('milepost.practice.record') && policies.sandbox.allow.length === tools.length);
  assert.equal(path.basename(require.resolve('../plugin.cjs')), 'plugin.cjs');
});

test('every example event is valid and applies in its documented context', () => {
  const dir = path.join(__dirname, '../examples/events'), fs = require('node:fs');
  const events = Object.fromEntries(fs.readdirSync(dir).map(n => [n, require(path.join(dir, n))]));
  assert.deepEqual(Object.keys(events).sort(), ['assessment-added.json', 'assessment-moved.json', 'assessment-result-posted.json', 'practice-completed.json', 'preferences-changed.json']);
  assert.deepEqual(require('../examples/scenario.json'), events['assessment-added.json']);
  for (const name of ['assessment-added.json', 'assessment-moved.json', 'assessment-result-posted.json', 'preferences-changed.json']) fixture().event(events[name]);
  const f = fixture();
  f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 40});
  f.event(events['practice-completed.json']);
});

test('optional diagnostics cannot change business results', () => {
  const run = f => {
    f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 40});
    f.event({event_id: 'ev-d', at: at(2, '19:40'), operation: 'milepost.practice.completed', payload: {skill_id: F, minutes: 40, block_id: 'blk-1'}});
    return f.data;
  };
  const on = fixture(), off = fixture({logging: false}), broken = fixture();
  broken.ctx.log = () => { throw new Error('logger offline'); };
  const expected = run(off);
  assert.deepEqual(run(on), expected);
  assert.deepEqual(run(broken), expected);
  assert.ok(on.logs.length >= 2);
  refused(on, () => on.call('milepost.plan.remove_block', {id: 'blk-1'}), 'invalid_state');
});
