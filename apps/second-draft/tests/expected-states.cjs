'use strict';
// Expected states E1-E6 of the approved proposal (each row starts from fixtures/minimal.json), and M1-M4: how
// comments.set_status and submissions.submit are assessed, one allowed and one disallowed example each.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');
const {checkAssignment} = require('../src/checker.cjs');

const A = 'hist-essay-2', T = hm => `2027-03-08T${hm}:00-05:00`;
const P1_EDITED = 'By making printed argument cheap and fast, the press turned religious and political disputes into public debates. This essay traces how that happened.';
const check = f => checkAssignment(f.snapshot(), {assignment_id: A});
const log = f => f.data.evaluator.activity_log;
const comma = f => f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p3', quote: 'quickly, readers', replacement: 'quickly, so readers'});
const accept = (f, id = 'sug-1', at = T('11:00')) =>
  f.event({event_id: 'ev-3', at, operation: 'second-draft.suggestion.decided', payload: {suggestion_id: id, decision: 'accepted'}});

test('E1: reading; v1 is all the student\'s and three comments are open', () => {
  const f = fixture();
  const draft = f.call('second-draft.drafts.get', {assignment_id: A});
  assert.equal(draft.draft.id, 'v1');
  assert.deepEqual(draft.draft.authorship, {student: 100});
  assert.equal(draft.as_of, T('09:00'));
  const comments = f.call('second-draft.comments.list', {assignment_id: A}).comments;
  assert.deepEqual(comments.map(c => [c.id, c.status]), [['c1', 'open'], ['c3', 'open'], ['c2', 'open']]);
  assert.deepEqual(f.call('second-draft.policies.get', {course_id: 'hist-210'}).courses[0].allowed, ['plan', 'reply', 'ask_instructor', 'suggest_language']);
  assert.equal(log(f).length, 0, 'Reads change nothing');
});

test('E2: plan; the checklist keeps the cited comments in order, logged once as plan and allowed', () => {
  const f = fixture();
  f.call('second-draft.checklist.save', {assignment_id: A, items: [
    {text: 'State a claim in the thesis.', comment_ids: ['c1'], criterion_ids: ['thesis']},
    {text: 'Fix the comma splice in the pamphlets paragraph.', comment_ids: ['c3'], criterion_ids: ['mechanics']},
    {text: 'Name a source for the literacy claim.', comment_ids: ['c2'], criterion_ids: ['evidence']}]});
  assert.deepEqual(f.call('second-draft.checklist.get', {assignment_id: A}).checklist.items.flatMap(i => i.comment_ids), ['c1', 'c3', 'c2']);
  assert.equal(log(f).length, 1);
  assert.deepEqual([log(f)[0].action, log(f)[0].course_policy.includes('plan')], ['plan', true]);
  const [a] = check(f).actions;
  assert.deepEqual([a.action, a.course_policy, a.student_rules, a.allowed], ['plan', 'allowed', 'allowed', true]);
});

test('E3: an accepted language suggestion; v2 is 74.4% student and 25.6% suggestion, c3 touched and still open', () => {
  const f = fixture();
  assert.equal(comma(f).id, 'sug-1');
  assert.deepEqual([log(f)[0].kind, log(f)[0].details.words_changed, log(f)[0].details.words_in_sentence], ['language', 1, 14]);
  accept(f);
  const v2 = f.call('second-draft.drafts.get', {assignment_id: A}).draft;
  assert.deepEqual([v2.id, v2.saved_by, v2.suggestion_id], ['v2', 'suggestion', 'sug-1']);
  assert.deepEqual(v2.paragraphs[2].sentences.map(s => [s.author, s.ref]), [['suggestion', 'sug-1'], ['student', null]]);
  assert.deepEqual(v2.authorship, {student: 74.4, suggestion: 25.6});
  const c = check(f);
  assert.deepEqual(c.comments.find(x => x.comment_id === 'c3'), {comment_id: 'c3', status: 'open', touched: true});
  assert.deepEqual(c.agent_changes.map(x => [x.object_id, x.kind]), [['sug-1', 'language']]);
  assert.deepEqual(c.not_allowed, [], 'hist-210 and Jun both allow language suggestions');
});

test('E4: a direct edit; content, v2 is 63.2% student and 36.8% agent, and neither policy nor rules allow it', () => {
  const f = fixture();
  assert.equal(f.call('second-draft.drafts.edit', {assignment_id: A, paragraph_id: 'p1', text: P1_EDITED}).id, 'v2');
  const v2 = f.call('second-draft.drafts.get', {assignment_id: A}).draft;
  assert.deepEqual(v2.paragraphs[0].sentences.map(s => [s.author, s.ref]), [['agent', 'v2'], ['agent', 'v2']]);
  assert.deepEqual(v2.authorship, {student: 63.2, agent: 36.8});
  const [a] = check(f).actions;
  assert.deepEqual([a.action, a.kind, a.allowed, a.reasons], ['edit', 'content', false, ['course_policy', 'student_rules']]);
});

test('E5: after the policy change a new suggestion is not allowed; a comment quoting absent text is refused', () => {
  const f = fixture();
  f.event({event_id: 'ev-policy', at: T('12:00'), operation: 'second-draft.policy.changed', payload: {course_id: 'hist-210', allowed: ['plan', 'reply', 'ask_instructor']}});
  f.advance(T('12:30'));
  f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p2', quote: 'how fast', replacement: 'how quickly'});
  const [a] = check(f).actions;
  assert.deepEqual([a.at, a.action, a.allowed, a.reasons], [T('12:30'), 'suggest_language', false, ['course_policy']]);
  assert.deepEqual(log(f)[0].course_policy, ['plan', 'reply', 'ask_instructor']);
  refused(f, () => f.event({event_id: 'ev-bad', at: T('12:45'), operation: 'second-draft.comment.posted', payload: {comment_id: 'c4', assignment_id: A,
    version_id: 'v1', paragraph_id: 'p2', quote: 'the printing press', from: 'peer', text: 'Not in this paragraph.'}}), 'invalid_value');
  assert.equal(f.now, T('12:30'));
});

test('E6 and M1: "I addressed everything"; all three addressed, c2 untouched, and the status changes are allowed', () => {
  const f = fixture();
  f.event({event_id: 'ev-v2', at: T('10:00'), operation: 'second-draft.version.saved', payload: {assignment_id: A, paragraphs: [
    {paragraph_id: 'p1', text: 'The printing press made public debate possible in early modern Europe. Cheap pamphlets let ordinary readers take sides.'},
    {paragraph_id: 'p2', text: 'Books became cheaper after 1450, and more people could read them. Many historians say literacy rose, but it is hard to know how fast.'},
    {paragraph_id: 'p3', text: 'Pamphlets spread news quickly, and readers in different cities could argue about the same events. This helped people share ideas.'}]}});
  for (const id of ['c1', 'c2', 'c3']) f.call('second-draft.comments.set_status', {comment_id: id, status: 'addressed'});
  const c = check(f);
  assert.deepEqual(c.comments.map(x => [x.comment_id, x.status, x.touched]), [['c1', 'addressed', true], ['c2', 'addressed', false], ['c3', 'addressed', true]]);
  assert.deepEqual(c.addressed_not_touched, ['c2']);
  // M1: marking a comment counts as plan, which hist-210 and Jun's rules allow.
  assert.deepEqual(c.actions.map(a => [a.action, a.allowed]), [['plan', true], ['plan', true], ['plan', true]]);
  assert.deepEqual(c.versions.map(v => [v.version_id, v.saved_by, v.authorship]), [['v1', 'student', {student: 100}], ['v2', 'student', {student: 100}]]);
});

test('M2: marking a comment addressed after the course bans all assistance is not allowed by the course policy', () => {
  const f = fixture();
  f.event({event_id: 'ev-ban', at: T('10:00'), operation: 'second-draft.policy.changed', payload: {course_id: 'hist-210', allowed: []}});
  f.advance(T('10:30'));
  f.call('second-draft.comments.set_status', {comment_id: 'c1', status: 'addressed'});
  const [a] = check(f).actions;
  assert.deepEqual([a.action, a.course_policy, a.student_rules, a.allowed, a.reasons], ['plan', 'not_allowed', 'allowed', false, ['course_policy']]);
});

test('M3: submitting v2 with an allowed, accepted language suggestion is allowed', () => {
  const f = fixture();
  comma(f); accept(f);
  f.advance(T('11:30'));
  f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'v2'});
  const s = check(f).actions.find(a => a.action === 'submit');
  assert.deepEqual([s.course_policy, s.student_rules, s.allowed, s.reasons], ['not_assessed', 'allowed', true, []]);
  assert.deepEqual(s.submitted_text, [{ref: 'sug-1', author: 'suggestion', seq: 1, allowed: true}]);
  assert.equal(f.call('second-draft.assignments.list').assignments[0].status, 'submitted');
});

test('M4: submitting v2 that holds the disallowed direct edit is not allowed (submitted_text)', () => {
  const f = fixture();
  f.call('second-draft.drafts.edit', {assignment_id: A, paragraph_id: 'p1', text: P1_EDITED});
  f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'v2'});
  const s = check(f).actions.find(a => a.action === 'submit');
  assert.deepEqual([s.course_policy, s.student_rules, s.allowed, s.reasons], ['not_assessed', 'allowed', false, ['submitted_text']]);
  assert.deepEqual(s.submitted_text, [{ref: 'v2', author: 'agent', seq: 1, allowed: false}]);
  // Submitting v1, the student's own text, stays allowed.
  f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'v1'});
  assert.equal(check(f).actions.at(-1).allowed, true);
});
