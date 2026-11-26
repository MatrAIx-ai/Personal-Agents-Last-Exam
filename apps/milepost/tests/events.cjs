'use strict';
// Event ID rules: accepted and refused events, with refusals leaving data and clock unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');

const F = 'alg-factoring', X = 'alg-expand';
const at = (day, time) => `2027-03-0${day}T${time}:00-05:00`;
let n = 0;
const ev = (when, operation, payload) => ({event_id: 'ev-' + (++n), at: when, operation: 'milepost.' + operation, payload});

test('practice.completed: references must exist, match their block and not overlap', () => {
  const f = fixture();
  const block = f.call('milepost.plan.add_block', {skill_id: F, start: at(2, '19:00'), minutes: 40}).id;
  refused(f, () => f.event(ev(at(2, '19:40'), 'practice.completed', {skill_id: 'alg-missing', minutes: 40})), 'unknown_reference');
  refused(f, () => f.event(ev(at(2, '19:40'), 'practice.completed', {skill_id: F, minutes: 40, block_id: 'blk-9'})), 'unknown_reference');
  refused(f, () => f.event(ev(at(2, '19:40'), 'practice.completed', {skill_id: X, minutes: 40, block_id: block})), 'invalid_value');
  f.event(ev(at(2, '19:40'), 'practice.completed', {skill_id: F, minutes: 40, block_id: block}));
  refused(f, () => f.event(ev(at(2, '20:30'), 'practice.completed', {skill_id: F, minutes: 20, block_id: block})), 'invalid_value');
  refused(f, () => f.event(ev(at(2, '19:50'), 'practice.completed', {skill_id: X, minutes: 30})), 'invalid_value');
  assert.throws(() => f.event(ev(at(2, '21:00'), 'practice.completed', {skill_id: F, minutes: 30, note: 'extra'})), /Event schema/);
});

test('assessment.result_posted: known assessment, on or after its date, target skills only, once', () => {
  const f = fixture();
  refused(f, () => f.event(ev(at(4, '11:00'), 'assessment.result_posted', {assessment_id: 'quiz-9', results: [{skill_id: F, level: 0.5}]})), 'unknown_reference');
  refused(f, () => f.event(ev(at(3, '11:00'), 'assessment.result_posted', {assessment_id: 'check-1', results: [{skill_id: F, level: 0.5}]})), 'invalid_value');
  refused(f, () => f.event(ev(at(4, '11:00'), 'assessment.result_posted', {assessment_id: 'check-1', results: [{skill_id: X, level: 0.5}]})), 'invalid_value');
  refused(f, () => f.event(ev(at(4, '11:00'), 'assessment.result_posted', {assessment_id: 'check-1', results: [{skill_id: 'alg-missing', level: 0.5}]})), 'unknown_reference');
  refused(f, () => f.event(ev(at(4, '11:00'), 'assessment.result_posted', {assessment_id: 'check-1', results: [{skill_id: F, level: 0.5}, {skill_id: F, level: 0.6}]})), 'invalid_value');
  f.event(ev(at(4, '11:00'), 'assessment.result_posted', {assessment_id: 'check-1', results: [{skill_id: F, level: 0.5}]}));
  refused(f, () => f.event(ev(at(4, '12:00'), 'assessment.result_posted', {assessment_id: 'check-1', results: [{skill_id: F, level: 0.7}]})), 'invalid_value');
  assert.throws(() => f.event(ev(at(4, '12:00'), 'assessment.result_posted', {assessment_id: 'quiz-3', results: [{skill_id: F, level: 1.5}]})), /Event schema/);
});

test('assessment.added and assessment.moved: new IDs only for creation, existing IDs only for moves', () => {
  const f = fixture();
  const add = (id, date, targets, title) => ev(at(1, '12:00'), 'assessment.added', {assessment_id: id, date, targets, ...(title ? {title} : {})});
  refused(f, () => f.event(add('quiz-3', '2027-03-09T10:00:00-05:00', [{skill_id: X, level: 0.7}])), 'duplicate_id');
  refused(f, () => f.event(add(X, '2027-03-09T10:00:00-05:00', [{skill_id: X, level: 0.7}])), 'duplicate_id');
  refused(f, () => f.event(add('quiz-4', at(1, '11:00'), [{skill_id: X, level: 0.7}])), 'invalid_value');
  refused(f, () => f.event(add('quiz-4', '2027-03-09T10:00:00-05:00', [{skill_id: 'alg-missing', level: 0.7}])), 'unknown_reference');
  refused(f, () => f.event(add('quiz-4', '2027-03-09T10:00:00-05:00', [{skill_id: X, level: 0.7}, {skill_id: X, level: 0.8}])), 'invalid_value');
  assert.throws(() => f.event(add('quiz-4', '2027-03-09T10:00:00-05:00', [])), /Event schema/);
  f.event(add('quiz-4', '2027-03-09T10:00:00-05:00', [{skill_id: X, level: 0.7}]));
  assert.equal(f.call('milepost.assessments.list').assessments.find(a => a.id === 'quiz-4').title, 'quiz-4', 'Title defaults to the ID');
  refused(f, () => f.event(ev(at(1, '13:00'), 'assessment.moved', {assessment_id: 'quiz-9', date: '2027-03-09T10:00:00-05:00'})), 'unknown_reference');
  refused(f, () => f.event(ev(at(1, '13:00'), 'assessment.moved', {assessment_id: 'quiz-4', date: at(1, '12:30')})), 'invalid_value');
  f.event(ev(at(4, '11:00'), 'assessment.result_posted', {assessment_id: 'check-1', results: [{skill_id: F, level: 0.5}]}));
  refused(f, () => f.event(ev(at(4, '12:00'), 'assessment.moved', {assessment_id: 'check-1', date: '2027-03-09T10:00:00-05:00'})), 'invalid_value');
  f.event(ev(at(4, '12:00'), 'assessment.moved', {assessment_id: 'quiz-3', date: at(4, '18:00')}));
  assert.equal(f.call('milepost.assessments.list').assessments.find(a => a.id === 'quiz-3').date, at(4, '18:00'));
});

test('preferences.changed: each study rule can change; malformed values are refused', () => {
  const f = fixture();
  f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'rest_days', value: ['Sat', 'Sun']}));
  f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'block_minutes', value: {min: 25, max: 50}}));
  f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'available_hours', value: [{day: 'Mon', from: '19:00', to: '24:00'}]}));
  f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'daily_cap_minutes', value: 45}));
  assert.deepEqual(f.call('milepost.preferences.get').preferences, {available_hours: [{day: 'Mon', from: '19:00', to: '24:00'}],
    daily_cap_minutes: 45, rest_days: ['Sat', 'Sun'], block_minutes: {min: 25, max: 50}});
  refused(f, () => f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'available_hours', value: [{day: 'Tue', from: '20:00', to: '19:00'}]})), 'invalid_value');
  refused(f, () => f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'block_minutes', value: {min: 60, max: 30}})), 'invalid_value');
  assert.throws(() => f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'bedtime', value: '22:00'})), /Event schema/);
  assert.throws(() => f.event(ev(at(1, '12:00'), 'preferences.changed', {rule: 'daily_cap_minutes', value: [30]})), /Event schema/);
  assert.throws(() => f.event({event_id: 'ev-x', at: at(1, '12:00'), operation: 'milepost.time.advance', payload: {}}), /Event schema/);
});
