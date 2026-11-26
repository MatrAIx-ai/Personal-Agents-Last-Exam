'use strict';
// Every Infra event: each example in examples/events/ applies to the minimal seed (after its stated precondition),
// and each refusal changes neither data nor the clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {fixture, refused} = require('./harness.cjs');
const {checkAssignment} = require('../src/checker.cjs');

const A = 'hist-essay-2', T = hm => `2027-03-08T${hm}:00-05:00`;
const example = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/events', name + '.json'), 'utf8'));
const ev = (operation, payload, at = T('15:00'), event_id = 'ev-x') => ({event_id, at, operation: 'second-draft.' + operation, payload});
const comments = f => Object.fromEntries(f.call('second-draft.comments.list', {assignment_id: A}).comments.map(c => [c.id, c.status]));

test('examples/events holds one valid event of each type in app.json', () => {
  const types = fs.readdirSync(path.join(__dirname, '../examples/events')).map(n => example(n.replace('.json', '')).operation).sort();
  assert.deepEqual(types, [...require('../app.json').event_types].sort());
});

test('version.saved: kept paragraphs keep unchanged sentences\' authors, new ones are added, omitted ones removed', () => {
  const f = fixture();
  f.call('second-draft.drafts.edit', {assignment_id: A, paragraph_id: 'p3', text: 'Pamphlets spread news quickly. Readers in different cities could argue about the same events. This helped people share ideas.'});
  const e = example('version-saved');
  e.payload.paragraphs[2].text = 'Pamphlets spread news quickly. Readers in different cities could argue about the same events. This helped people share ideas.';
  f.event(e);
  const v3 = f.call('second-draft.drafts.get', {assignment_id: A}).draft;
  assert.deepEqual([v3.id, v3.number, v3.saved_by, v3.paragraphs.map(p => p.id).join()], ['v3', 3, 'student', 'p1,p2,p3,p4']);
  assert.deepEqual(v3.paragraphs[2].sentences.map(s => s.author), ['agent', 'agent', 'student'], 'The agent\'s sentences survive an unchanged save');
  assert.deepEqual(v3.paragraphs[0].sentences.map(s => s.author), ['student', 'student']);
  refused(f, () => f.event(ev('version.saved', {assignment_id: 'nope', paragraphs: [{paragraph_id: 'p1', text: 'x.'}]})), 'unknown_reference');
  refused(f, () => f.event(ev('version.saved', {assignment_id: A, paragraphs: [{paragraph_id: 'p1', text: 'x.'}, {paragraph_id: 'p1', text: 'y.'}]})), 'invalid_value');
});

test('suggestion.decided: the proposal\'s example accepts sug-1; a decided suggestion cannot be decided again', () => {
  const f = fixture();
  f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p3', quote: 'quickly, readers', replacement: 'quickly, so readers'});
  f.event(example('suggestion-decided'));
  const s = f.call('second-draft.drafts.get', {assignment_id: A}).suggestions[0];
  assert.deepEqual([s.status, s.result_version_id, s.decided_at], ['accepted', 'v2', T('11:00')]);
  refused(f, () => f.event(ev('suggestion.decided', {suggestion_id: 'sug-1', decision: 'rejected'})), 'invalid_state');
  refused(f, () => f.event(ev('suggestion.decided', {suggestion_id: 'sug-9', decision: 'accepted'})), 'unknown_reference');
});

test('comment.posted: a new anchored comment; duplicate IDs, wrong anchors and unknown criteria are refused', () => {
  const f = fixture();
  f.event(example('comment-posted'));
  assert.equal(comments(f).c4, 'open');
  const base = example('comment-posted').payload;
  refused(f, () => f.event(ev('comment.posted', base)), 'duplicate_id');
  refused(f, () => f.event(ev('comment.posted', {...base, comment_id: 'c5', version_id: 'v9'})), 'unknown_reference');
  refused(f, () => f.event(ev('comment.posted', {...base, comment_id: 'c5', paragraph_id: 'p9'})), 'unknown_reference');
  refused(f, () => f.event(ev('comment.posted', {...base, comment_id: 'c5', quote: 'o'})), 'invalid_value');
  refused(f, () => f.event(ev('comment.posted', {...base, comment_id: 'c5', criterion_id: 'style'})), 'unknown_reference');
});

test('comment.resolved: the commenter resolves and reopens; the agent cannot change a resolved comment', () => {
  const f = fixture();
  f.event(example('comment-resolved'));
  assert.equal(comments(f).c3, 'resolved');
  refused(f, () => f.call('second-draft.comments.set_status', {comment_id: 'c3', status: 'addressed'}), 'invalid_state');
  refused(f, () => f.event(ev('comment.resolved', {comment_id: 'c3', status: 'resolved'})), 'invalid_value');
  f.event(ev('comment.resolved', {comment_id: 'c3', status: 'open'}));
  assert.equal(comments(f).c3, 'open');
  refused(f, () => f.event(ev('comment.resolved', {comment_id: 'c8', status: 'resolved'}, T('15:30'))), 'unknown_reference');
});

test('policy.changed: the history grows and actions are judged by the policy in force when they happen', () => {
  const f = fixture();
  f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p2', quote: 'how fast', replacement: 'how quickly'});
  f.event(example('policy-changed'));
  f.advance(T('12:10'));
  f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p3', quote: 'quickly, readers', replacement: 'quickly, so readers'});
  const p = f.call('second-draft.policies.get', {course_id: 'hist-210'}).courses[0];
  assert.deepEqual([p.allowed, p.history.length], [['plan', 'reply', 'ask_instructor'], 2]);
  assert.deepEqual(checkAssignment(f.snapshot(), {assignment_id: A}).actions.map(a => a.allowed), [true, false], 'Before the change fine, after it not');
  refused(f, () => f.event(ev('policy.changed', {course_id: 'chem-1', allowed: []})), 'unknown_reference');
});

test('assignment.graded: needs a submission, its own criteria within range, once', () => {
  const f = fixture();
  refused(f, () => f.event(example('assignment-graded')), 'invalid_state');
  f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'v1'});
  const base = example('assignment-graded');
  refused(f, () => f.event({...base, payload: {assignment_id: A, levels: [{criterion_id: 'style', level: 2}]}}), 'unknown_reference');
  refused(f, () => f.event({...base, payload: {assignment_id: A, levels: [{criterion_id: 'thesis', level: 5}]}}), 'invalid_value');
  f.event(base);
  const a = f.call('second-draft.assignments.list').assignments[0];
  assert.deepEqual([a.status, a.grade.levels.map(l => l.level)], ['graded', [3, 2, 4]]);
  refused(f, () => f.event({...base, at: '2027-03-16T12:00:00-04:00'}), 'invalid_state');
});

test('message.received: the instructor replies in the course thread; duplicates and other threads are refused', () => {
  const f = fixture();
  f.call('second-draft.messages.send', {course_id: 'hist-210', text: 'May the thesis come at the end of the first paragraph?'});
  f.event(example('message-received'));
  assert.deepEqual(f.call('second-draft.messages.list').messages.map(m => [m.id, m.author, m.in_reply_to]), [['msg-1', 'agent', null], ['msg-i1', 'instructor', 'msg-1']]);
  const base = example('message-received').payload;
  refused(f, () => f.event(ev('message.received', base)), 'duplicate_id');
  refused(f, () => f.event(ev('message.received', {...base, message_id: 'msg-i2', course_id: 'comp-101'})), 'unknown_reference');
  refused(f, () => f.event(ev('message.received', {...base, message_id: 'msg-i2', in_reply_to: 'msg-404'})), 'unknown_reference');
});
