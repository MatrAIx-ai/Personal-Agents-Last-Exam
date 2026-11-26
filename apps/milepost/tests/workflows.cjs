'use strict';
// The four workflows through the Agent tools: success, refusals and the evaluator-only activity log.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');

const F = 'alg-factoring', X = 'alg-expand';
const at = (day, time) => `2027-03-0${day}T${time}:00-05:00`;
const log = f => f.data.evaluator.activity_log;

test('workflow 1: catalog, skills, mastery, assessments and preferences are readable and unknown IDs return not_found', () => {
  const f = fixture(), before = f.data;
  const courses = f.call('milepost.courses.list');
  assert.equal(courses.as_of, f.now);
  assert.deepEqual(courses.courses[0].units[0].skill_ids, [X, F]);
  assert.deepEqual(f.call('milepost.skills.list', {course_id: 'course-algebra'}).skills.find(s => s.id === F).prerequisites, [X]);
  refused(f, () => f.call('milepost.skills.list', {course_id: 'course-chemistry'}), 'not_found');
  refused(f, () => f.call('milepost.mastery.get', {skill_ids: ['alg-missing']}), 'not_found');
  refused(f, () => f.call('milepost.practice.list', {skill_id: 'alg-missing'}), 'not_found');
  const a = f.call('milepost.assessments.list').assessments;
  assert.deepEqual(a.map(x => [x.id, x.status, x.result]), [['check-1', 'scheduled', null], ['quiz-3', 'scheduled', null]]);
  const p = f.call('milepost.preferences.get');
  assert.equal(p.time_zone, 'America/New_York');
  assert.equal(p.preferences.daily_cap_minutes, 90);
  assert.throws(() => f.call('milepost.mastery.get', {role: 'infra'}), /Input schema/);
  assert.deepEqual(f.data, before);
  assert.equal(log(f).length, 0, 'Reads are not logged');
});

test('workflow 2: blocks can be added, changed and removed; past, overlapping and unknown-skill blocks are refused', () => {
  const f = fixture();
  refused(f, () => f.call('milepost.plan.add_block', {skill_id: F, start: at(1, '08:00'), minutes: 30}), 'past_block');
  refused(f, () => f.call('milepost.plan.add_block', {skill_id: 'alg-missing', start: at(2, '19:00'), minutes: 30}), 'not_found');
  assert.throws(() => f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 300}), /Input schema/);
  const one = f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 40}).id;
  const two = f.call('milepost.plan.add_block', {skill_id: X, start: at(3, '19:00'), minutes: 30}).id;
  assert.deepEqual([one, two], ['blk-1', 'blk-2']);
  refused(f, () => f.call('milepost.plan.update_block', {id: two, patch: {start: at(2, '19:30')}}), 'overlap');
  refused(f, () => f.call('milepost.plan.update_block', {id: two, patch: {start: at(1, '08:30')}}), 'past_block');
  refused(f, () => f.call('milepost.plan.update_block', {id: two, patch: {}}), 'invalid_arguments');
  refused(f, () => f.call('milepost.plan.update_block', {id: 'blk-9', patch: {minutes: 20}}), 'not_found');
  f.call('milepost.plan.update_block', {id: two, patch: {start: at(3, '20:00'), minutes: 45}});
  const blocks = f.call('milepost.plan.list').blocks;
  assert.deepEqual(blocks.map(b => [b.id, b.start, b.end, b.status]), [[one, at(2, '19:00'), at(2, '19:40'), 'planned'], [two, at(3, '20:00'), at(3, '20:45'), 'planned']]);
  f.call('milepost.plan.remove_block', {id: two});
  refused(f, () => f.call('milepost.plan.remove_block', {id: two}), 'not_found');
  assert.deepEqual(f.call('milepost.plan.list').blocks.map(b => b.id), [one]);
  assert.deepEqual(log(f).map(e => [e.seq, e.operation, e.object_id]), [[1, 'milepost.plan.add_block', one], [2, 'milepost.plan.add_block', two],
    [3, 'milepost.plan.update_block', two], [4, 'milepost.plan.remove_block', two]], 'One log entry per committed write; refusals add none');
  assert.ok(log(f).every(e => /^local-\d+$/.test(e.request_id) && e.expected_version.epoch === 1));
});

test('workflow 2: projections count only planned blocks that end by the assessment; missed and late blocks do not count', () => {
  const f = fixture();
  const base = f.call('milepost.plan.project', {assessment_id: 'quiz-3'}).skills[0].projected_level;
  f.call('milepost.plan.add_block', {skill_id: F, start: at(5, '12:00'), minutes: 40});
  assert.equal(f.call('milepost.plan.project', {assessment_id: 'quiz-3'}).skills[0].projected_level, base, 'A block after the assessment does not count');
  f.call('milepost.plan.add_block', {skill_id: F, start: at(1, '18:00'), minutes: 40});
  const withBlock = f.call('milepost.plan.project', {assessment_id: 'quiz-3'}).skills[0].projected_level;
  assert.ok(withBlock > base);
  f.advance(at(2, '09:00'));
  assert.equal(f.call('milepost.plan.list').blocks.find(b => b.start === at(1, '18:00')).status, 'missed');
  assert.equal(f.call('milepost.plan.project', {assessment_id: 'quiz-3'}).skills[0].projected_level, base, 'A missed block changes nothing');
  refused(f, () => f.call('milepost.plan.update_block', {id: 'blk-2', patch: {minutes: 30}}), 'invalid_state');
  refused(f, () => f.call('milepost.plan.remove_block', {id: 'blk-2'}), 'invalid_state');
  refused(f, () => f.call('milepost.plan.project', {assessment_id: 'quiz-9'}), 'not_found');
  f.advance(at(5, '10:00'));
  refused(f, () => f.call('milepost.plan.project', {assessment_id: 'quiz-3'}), 'invalid_state');
});

test('workflow 3: reported practice is recorded with its source; future, overlapping and platform-session changes are refused', () => {
  const f = fixture();
  f.advance(at(2, '21:00'));
  refused(f, () => f.call('milepost.practice.record', {skill_id: F, minutes: 30, ended_at: at(2, '22:00')}), 'invalid_time');
  refused(f, () => f.call('milepost.practice.record', {skill_id: 'alg-missing', minutes: 30, ended_at: at(2, '20:00')}), 'not_found');
  refused(f, () => f.call('milepost.practice.record', {skill_id: F, minutes: 30, ended_at: '2027-02-27T09:10:00-05:00'}), 'invalid_time');
  const id = f.call('milepost.practice.record', {skill_id: F, minutes: 30, ended_at: at(2, '20:00')}).id;
  refused(f, () => f.call('milepost.practice.record', {skill_id: X, minutes: 20, ended_at: at(2, '19:45')}), 'overlap');
  const sessions = f.call('milepost.practice.list').sessions;
  assert.deepEqual(sessions, [{id, skill_id: F, minutes: 30, started_at: at(2, '19:30'), ended_at: at(2, '20:00'), day: 'Tue', source: 'student_report', block_id: null}]);
  f.event({event_id: 'ev-w3', at: at(2, '21:30'), operation: 'milepost.practice.completed', payload: {skill_id: X, minutes: 25}});
  const platform = f.call('milepost.practice.list', {skill_id: X}).sessions[0];
  assert.equal(platform.source, 'platform');
  refused(f, () => f.call('milepost.practice.remove', {id: platform.id}), 'not_removable');
  refused(f, () => f.call('milepost.practice.remove', {id: 'ses-99'}), 'not_found');
  f.call('milepost.practice.remove', {id});
  assert.deepEqual(f.call('milepost.practice.list').sessions.map(s => s.id), [platform.id]);
  assert.deepEqual(log(f).map(e => e.operation), ['milepost.practice.record', 'milepost.practice.remove']);
});

test('workflow 3: a block that passes without practice is missed; a late completion event marks it done', () => {
  const f = fixture();
  const id = f.call('milepost.plan.add_block', {skill_id: F, start: at(1, '18:00'), minutes: 30}).id;
  f.advance(at(1, '18:30'));
  assert.equal(f.call('milepost.plan.list').blocks[0].status, 'missed');
  f.event({event_id: 'ev-late', at: at(1, '19:00'), operation: 'milepost.practice.completed', payload: {skill_id: F, minutes: 30, block_id: id}});
  assert.equal(f.call('milepost.plan.list').blocks[0].status, 'done');
});

test('workflow 4: a posted result sets the measured level; a moved assessment changes the projection date', () => {
  const f = fixture();
  f.event({event_id: 'ev-r', at: at(4, '10:30'), operation: 'milepost.assessment.result_posted', payload: {assessment_id: 'check-1', results: [{skill_id: F, level: 0.62}]}});
  const m = f.call('milepost.mastery.get', {skill_ids: [F]}).skills[0];
  assert.deepEqual([m.level, m.last_practised_at], [0.62, '2027-02-27T09:00:00-05:00'], 'A result sets the level but is not practice');
  const result = f.call('milepost.assessments.list').assessments.find(a => a.id === 'check-1');
  assert.deepEqual([result.status, result.result], ['assessed', {posted_at: at(4, '10:30'), levels: [{skill_id: F, level: 0.62}]}]);
  const before = f.call('milepost.plan.project', {assessment_id: 'quiz-3'});
  f.event({event_id: 'ev-m', at: at(4, '11:00'), operation: 'milepost.assessment.moved', payload: {assessment_id: 'quiz-3', date: '2027-03-08T10:00:00-05:00'}});
  const after = f.call('milepost.plan.project', {assessment_id: 'quiz-3'});
  assert.equal(after.date, '2027-03-08T10:00:00-05:00');
  assert.ok(after.skills[0].projected_level < before.skills[0].projected_level, 'A later date with no plan means more forgetting');
});

test('agent affordances: refusals name the read tool with the valid IDs and the current time; reads give local weekdays', () => {
  const f = fixture();
  const message = (fn, code) => { try { fn(); } catch (e) { assert.equal(e.code, code); return e.message; } assert.fail('Expected ' + code); };
  assert.match(message(() => f.call('milepost.plan.project', {assessment_id: 'cells_exam'}), 'not_found'), /milepost\.assessments\.list lists the valid IDs/);
  assert.match(message(() => f.call('milepost.plan.add_block', {skill_id: 'placeholder_skill_id', start: at(2, '19:00'), minutes: 30}), 'not_found'), /milepost\.skills\.list lists the valid IDs/);
  assert.match(message(() => f.call('milepost.skills.list', {course_id: 'Biology'}), 'not_found'), /milepost\.courses\.list lists the valid IDs/);
  assert.match(message(() => f.call('milepost.plan.remove_block', {id: 'blk-9'}), 'not_found'), /milepost\.plan\.list lists the valid IDs/);
  assert.match(message(() => f.call('milepost.plan.add_block', {skill_id: F, start: '2027-02-28T19:00:00-05:00', minutes: 30}), 'past_block'), /It is now 2027-03-01T09:00:00-05:00, Mon\./);
  assert.match(message(() => f.call('milepost.practice.record', {skill_id: F, minutes: 30, ended_at: at(2, '20:00')}), 'invalid_time'), /It is now 2027-03-01T09:00:00-05:00, Mon\./);
  assert.deepEqual(f.call('milepost.assessments.list').assessments.map(a => [a.id, a.day]), [['check-1', 'Thu'], ['quiz-3', 'Fri']]);
  f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 30});
  assert.deepEqual(f.call('milepost.plan.list').blocks.map(b => b.day), ['Tue']);
});
