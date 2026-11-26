'use strict';
// Runnable walkthrough without a host: plan two blocks, project quiz-3, then apply examples/scenario.json
// (a new assessment) and project it. Prints the Agent-visible results before and after.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

const f = fixture();
const before = f.call('milepost.assessments.list');
f.call('milepost.plan.add_block', {skill_id: 'alg-factoring', start: '2027-03-02T19:00:00-05:00', minutes: 40});
f.call('milepost.plan.add_block', {skill_id: 'alg-factoring', start: '2027-03-04T19:00:00-05:00', minutes: 40});
const quiz3 = f.call('milepost.plan.project', {assessment_id: 'quiz-3'});
f.event(require('./scenario.json'));
const after = f.call('milepost.assessments.list');
assert.notDeepEqual(after, before);
const quiz4 = f.call('milepost.plan.project', {assessment_id: 'quiz-4'});
console.log(JSON.stringify({app: 'milepost', plan: f.call('milepost.plan.list').blocks, projection_quiz_3: quiz3.skills,
  assessments_before: before.assessments.map(a => a.id), assessments_after: after.assessments.map(a => a.id), projection_quiz_4: quiz4.skills}, null, 2));
