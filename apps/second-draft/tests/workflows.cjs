'use strict';
// Every agent tool: success and error cases. Refusals leave data and clock unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');
const {history, binding, at} = require('./seeds.cjs');
const {checkAssignment} = require('../src/checker.cjs');

const A = 'hist-essay-2';
const withHistory = () => { const seed = history(); return fixture({seed, binding: binding(seed)}); };
const save = (f, paragraphs, time = at('03-08', '10:00'), id = 'ev-save') =>
  f.event({event_id: id, at: time, operation: 'second-draft.version.saved', payload: {assignment_id: A, paragraphs}});
const P2 = 'Books became cheaper after 1450, and more people could read them. Many historians say literacy rose, but it is hard to know how fast.';

test('workflow 1: assignments, policies, drafts and messages, with history; unknown IDs say where valid IDs are listed', () => {
  const f = withHistory();
  const list = f.call('second-draft.assignments.list').assignments;
  assert.deepEqual(list.map(a => [a.id, a.status, a.latest_version_id, a.due_day]),
    [['hist-essay-2', 'open', 'v1', 'Fri'], ['hist-essay-1', 'graded', 'h1-v1', 'Fri'], ['comp-reflection-1', 'open', null, 'Mon']]);
  assert.deepEqual(list[1].grade.levels.map(l => l.level), [2, 3, 3]);
  assert.deepEqual(f.call('second-draft.assignments.list', {course_id: 'comp-101'}).assignments.map(a => a.id), ['comp-reflection-1']);
  assert.deepEqual(f.call('second-draft.comments.list', {assignment_id: 'hist-essay-1', status: 'resolved'}).comments[0].replies.map(r => r.author), ['student']);
  assert.equal(f.call('second-draft.drafts.get', {assignment_id: 'comp-reflection-1'}).draft, null);
  assert.deepEqual(f.call('second-draft.messages.list', {course_id: 'hist-210'}).messages.map(m => m.id), ['msg-h1']);
  assert.equal(f.call('second-draft.preferences.get').time_zone, 'America/New_York');
  for (const [name, args, lister] of [['second-draft.assignments.list', {course_id: 'chem-1'}, 'policies.get'], ['second-draft.drafts.list', {assignment_id: 'nope'}, 'assignments.list'],
    ['second-draft.drafts.get', {assignment_id: A, version_id: 'h1-v1'}, 'drafts.list'], ['second-draft.checklist.get', {assignment_id: 'nope'}, 'assignments.list']]) {
    assert.throws(() => f.call(name, args), e => e.code === 'not_found' && e.message.includes(lister));
  }
});

test('workflow 2: checklists replace earlier ones; references must belong to the assignment; replies and questions', () => {
  const f = withHistory();
  refused(f, () => f.call('second-draft.checklist.save', {assignment_id: A, items: [{text: 'x', comment_ids: ['h1-c1']}]}), 'unknown_reference');
  refused(f, () => f.call('second-draft.checklist.save', {assignment_id: A, items: [{text: 'x', criterion_ids: ['reflection']}]}), 'unknown_reference');
  const first = f.call('second-draft.checklist.save', {assignment_id: A, items: [{text: 'Thesis first', comment_ids: ['c1']}]}).id;
  const second = f.call('second-draft.checklist.save', {assignment_id: A, items: [{text: 'Comma splice', comment_ids: ['c3'], done: true}, {text: 'Evidence'}]}).id;
  assert.equal(first, second);
  assert.deepEqual(f.call('second-draft.checklist.get', {assignment_id: A}).checklist.items,
    [{text: 'Comma splice', comment_ids: ['c3'], criterion_ids: [], done: true}, {text: 'Evidence', comment_ids: [], criterion_ids: [], done: false}]);
  const reply = f.call('second-draft.comments.reply', {comment_id: 'c2', text: 'Jun will add the Eisenstein figure from the reader.'}).id;
  assert.deepEqual(f.call('second-draft.comments.list', {assignment_id: A}).comments.find(c => c.id === 'c2').replies.map(r => [r.id, r.author]), [[reply, 'agent']]);
  refused(f, () => f.call('second-draft.comments.reply', {comment_id: 'c9', text: 'x'}), 'not_found');
  const msg = f.call('second-draft.messages.send', {course_id: 'hist-210', text: 'May the thesis come at the end of the first paragraph?', in_reply_to: 'msg-h1'}).id;
  assert.deepEqual(f.call('second-draft.messages.list', {course_id: 'hist-210'}).messages.map(m => [m.id, m.author, m.in_reply_to]), [['msg-h1', 'instructor', null], [msg, 'agent', 'msg-h1']]);
  refused(f, () => f.call('second-draft.messages.send', {course_id: 'comp-101', text: 'x', in_reply_to: 'msg-h1'}), 'not_found');
  const actions = checkAssignment(f.snapshot(), {assignment_id: A}).actions.map(a => [a.action, a.allowed]);
  assert.deepEqual(actions, [['plan', true], ['plan', true], ['reply', true], ['ask_instructor', true]]);
});

test('workflow 2: comparing versions shows changed, added and removed paragraphs', () => {
  const f = withHistory();
  save(f, [{paragraph_id: 'p1', text: 'A new opening.'}, {paragraph_id: 'p2', text: P2}, {paragraph_id: 'p4', text: 'A new ending.'}]);
  const d = f.call('second-draft.drafts.diff', {assignment_id: A, from_version_id: 'v1', to_version_id: 'v2'});
  assert.deepEqual(d.paragraphs.map(p => [p.paragraph_id, p.change]), [['p1', 'changed'], ['p2', 'unchanged'], ['p4', 'added'], ['p3', 'removed']]);
  assert.deepEqual(f.call('second-draft.drafts.list', {assignment_id: A}).versions.map(v => [v.id, v.number, v.paragraph_ids.join()]), [['v1', 1, 'p1,p2,p3'], ['v2', 2, 'p1,p2,p4']]);
  refused(f, () => f.call('second-draft.drafts.diff', {assignment_id: A, from_version_id: 'v1', to_version_id: 'h1-v1'}), 'not_found');
});

test('workflow 3: suggestions need a unique quote; a later version can make one stale, which cannot be decided', () => {
  const f = withHistory();
  refused(f, () => f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p2', quote: 'it', replacement: 'that'}), 'invalid_quote');
  refused(f, () => f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p2', quote: 'Gutenberg', replacement: 'x'}), 'invalid_quote');
  refused(f, () => f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p2', quote: 'how fast', replacement: 'how fast'}), 'invalid_arguments');
  refused(f, () => f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p9', quote: 'x', replacement: 'y'}), 'not_found');
  refused(f, () => f.call('second-draft.suggestions.create', {assignment_id: 'comp-reflection-1', paragraph_id: 'p1', quote: 'x', replacement: 'y'}), 'invalid_state');
  const id = f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p2', quote: 'how fast', replacement: 'how quickly'}).id;
  const content = f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p1', quote: 'This essay will talk about some of those changes and why they matter.',
    replacement: 'Its cheap pamphlets turned local quarrels into Europe-wide arguments.'}).id;
  const status = () => Object.fromEntries(f.call('second-draft.drafts.get', {assignment_id: A}).suggestions.map(s => [s.id, [s.kind, s.status]]));
  assert.deepEqual(status(), {[id]: ['language', 'pending'], [content]: ['content', 'pending']});
  save(f, [{paragraph_id: 'p1', text: 'The printing press changed Europe in many ways. This essay will talk about some of those changes and why they matter.'},
    {paragraph_id: 'p2', text: 'Books became cheaper after 1450. Many historians say literacy rose, but nobody counted readers.'},
    {paragraph_id: 'p3', text: 'Pamphlets spread news quickly, readers in different cities could argue about the same events. This helped people share ideas.'}]);
  assert.deepEqual(status()[id], ['language', 'stale']);
  refused(f, () => f.event({event_id: 'ev-d', at: at('03-08', '10:30'), operation: 'second-draft.suggestion.decided', payload: {suggestion_id: id, decision: 'accepted'}}), 'invalid_state');
  f.event({event_id: 'ev-r', at: at('03-08', '10:31'), operation: 'second-draft.suggestion.decided', payload: {suggestion_id: content, decision: 'rejected'}});
  assert.deepEqual(status()[content], ['content', 'rejected']);
  const c = checkAssignment(f.snapshot(), {assignment_id: A});
  assert.deepEqual(c.actions.map(a => [a.action, a.allowed, a.reasons]), [['suggest_language', true, []], ['suggest_content', false, ['course_policy', 'student_rules']]]);
});

test('workflow 3: direct edits keep unchanged sentences\' authors; marking comments; unchanged text is refused', () => {
  const f = withHistory();
  refused(f, () => f.call('second-draft.drafts.edit', {assignment_id: A, paragraph_id: 'p2', text: P2}), 'invalid_arguments');
  refused(f, () => f.call('second-draft.drafts.edit', {assignment_id: A, paragraph_id: 'p7', text: 'x.'}), 'not_found');
  const v = f.call('second-draft.drafts.edit', {assignment_id: A, paragraph_id: 'p2', text: 'Books became cheaper after 1450, and more people could read them. Eisenstein argues that literacy rose quickly. Many historians say literacy rose, but it is hard to know how fast.'}).id;
  const p2 = f.call('second-draft.drafts.get', {assignment_id: A, version_id: v}).draft.paragraphs[1];
  assert.deepEqual(p2.sentences.map(s => s.author), ['student', 'agent', 'student']);
  assert.equal(checkAssignment(f.snapshot(), {assignment_id: A}).agent_changes[0].kind, 'content', 'An added sentence is content');
  f.call('second-draft.comments.set_status', {comment_id: 'c2', status: 'addressed'});
  refused(f, () => f.call('second-draft.comments.set_status', {comment_id: 'c2', status: 'addressed'}), 'invalid_state');
  f.call('second-draft.comments.set_status', {comment_id: 'c2', status: 'open'});
  refused(f, () => f.call('second-draft.comments.set_status', {comment_id: 'h1-c1', status: 'open'}), 'invalid_state');
});

test('workflow 4: submissions name a version of their own assignment, and resubmission names a newer one', () => {
  const f = withHistory();
  refused(f, () => f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'h1-v1'}), 'not_found');
  refused(f, () => f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'v7'}), 'not_found');
  f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'v1'});
  save(f, [{paragraph_id: 'p1', text: 'A revised opening.'}], at('03-08', '11:00'));
  f.call('second-draft.submissions.submit', {assignment_id: A, version_id: 'v2'});
  const a = f.call('second-draft.assignments.list').assignments.find(x => x.id === A);
  assert.deepEqual([a.status, a.submissions.map(s => s.version_id)], ['submitted', ['v1', 'v2']]);
  assert.throws(() => f.call('second-draft.nothing.here'), e => e.code === 'unknown_tool' || /Known tool/.test(e.message));
});

test('reads never show the evaluator-only log, and grader judgments (touched, conflicts) are not agent-visible', () => {
  const seed = history(), marker = 'MARKER-EVALUATOR-ONLY-77';
  seed.evaluator.activity_log.push({seq: 1, at: at('03-07', '12:00'), operation: 'second-draft.checklist.save', request_id: marker, expected_version: {epoch: 1, revision: 0},
    object_id: marker, assignment_id: A, course_id: 'hist-210', action: 'plan', kind: null, course_policy: ['plan'], student_rules: ['plan'], details: {note: marker}});
  const f = fixture({seed, binding: binding(seed)});
  const tools = require('../tools.json').filter(t => t.read_only);
  const args = {'second-draft.drafts.list': {assignment_id: A}, 'second-draft.drafts.get': {assignment_id: A}, 'second-draft.comments.list': {assignment_id: A},
    'second-draft.checklist.get': {assignment_id: A}, 'second-draft.drafts.diff': {assignment_id: A, from_version_id: 'v1', to_version_id: 'v1'}};
  const text = tools.map(t => JSON.stringify(f.call(t.name, args[t.name] || {}))).join('\n');
  for (const hidden of [marker, 'activity_log', 'touched', 'course_policy', 'student_rules', 'not_allowed']) assert.ok(!text.includes(hidden), hidden + ' leaked into a read');
});

test('unknown IDs: the refusal names the valid ones, so the caller can retry without guessing', () => {
  const f = withHistory();
  const message = (name, args) => { try { f.call(name, args); } catch (e) { assert.equal(e.code, 'not_found'); return e.message; } assert.fail('Expected not_found'); };
  assert.match(message('second-draft.assignments.list', {course_id: 'BUS101'}), /Courses: comp-101 \(Composition 101\), hist-210 \(History 210: Early Modern Europe\)\./);
  assert.match(message('second-draft.drafts.get', {assignment_id: 'bus-essay'}), /Assignments: hist-essay-2 \(.+\), hist-essay-1 \(.+\), comp-reflection-1 \(Reflection 1\)\./);
  assert.match(message('second-draft.comments.set_status', {comment_id: 'c123', status: 'addressed'}), /Open comments: hist-essay-2: c1, c2, c3\./);
  assert.match(message('second-draft.drafts.get', {assignment_id: A, version_id: 'v9'}), /Its versions: v1\./);
  assert.match(message('second-draft.messages.send', {course_id: 'hist-210', text: 'x', in_reply_to: 'msg-9'}), /Its messages: msg-h1\./);
});
