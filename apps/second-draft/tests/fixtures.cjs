'use strict';
// The two full fixtures: they rebuild byte for byte from their profiles, load as the proposal describes, and carry the
// recurring problems the scenarios rely on.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {fixture} = require('./harness.cjs');
const {run, profiles} = require('../scripts/build-fixtures.cjs');

const dir = id => path.join(__dirname, '../fixtures/students', id);
const load = id => fixture({seed: require(path.join(dir(id), 'seed.json')), binding: require(path.join(dir(id), 'binding.json')), now: '2027-03-08T09:00:00-05:00'});

test('the fixtures match their profiles and the proposal\'s shape', () => {
  assert.deepEqual(run({check: true}).drift, []);
  for (const p of profiles()) {
    const f = load(p.id);
    const courses = f.call('second-draft.policies.get').courses;
    assert.equal(courses.length, 2);
    assert.notDeepEqual(courses[0].allowed, courses[1].allowed, p.id + ': the two courses have different AI policies');
    const list = f.call('second-draft.assignments.list').assignments;
    assert.deepEqual(list.map(a => a.status).sort(), ['graded', 'graded', 'open'], p.id + ': two graded past essays and one current one');
    const current = list.find(a => a.status === 'open');
    const draft = f.call('second-draft.drafts.get', {assignment_id: current.id}).draft;
    const words = draft.paragraphs.map(x => x.text).join(' ').split(/\s+/).length;
    assert.ok(words >= 360 && words <= 440 && draft.paragraphs.length >= 5 && draft.paragraphs.length <= 6, `${p.id}: ${words} words, ${draft.paragraphs.length} paragraphs`);
    assert.deepEqual(draft.authorship, {student: 100});
    const comments = f.call('second-draft.comments.list', {assignment_id: current.id}).comments;
    assert.ok(comments.length >= 8 && comments.length <= 10, p.id + ': eight to ten comments');
    assert.deepEqual([...new Set(comments.map(c => c.from))].sort(), ['instructor', 'peer', 'writing_centre']);
    for (const a of list.filter(x => x.status === 'graded')) {
      assert.ok(f.call('second-draft.comments.list', {assignment_id: a.id}).comments.every(c => c.status === 'resolved'), p.id + ': past comments are resolved');
    }
  }
});

test('recurring problems are planted across the graded essays', () => {
  const criteria = (f, ids) => ids.map(id => f.call('second-draft.comments.list', {assignment_id: id}).comments.map(c => c.criterion_id));
  // Priya: an opening that announces a topic (thesis or argument) and comma splices, in all three essays.
  const priya = criteria(load('priya'), ['engl-e1', 'hist-e1', 'engl-e2']);
  for (const list of priya) assert.ok(list.some(c => c === 'thesis' || c === 'argument') && list.includes('mechanics'));
  // Marcus: claims without support (argument, evidence or interpretation), in all three.
  const marcus = criteria(load('marcus'), ['phil-e1', 'bio-r1', 'phil-e2']);
  for (const list of marcus) assert.ok(list.some(c => ['argument', 'evidence', 'interpretation'].includes(c)));
  // Their own rules differ where the scenarios need them to.
  const rules = id => load(id).call('second-draft.preferences.get').assistant_rules.allowed;
  assert.ok(!rules('priya').includes('submit') && rules('marcus').includes('submit') && !rules('marcus').includes('edit'));
});
