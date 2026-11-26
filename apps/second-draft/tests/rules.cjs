'use strict';
// second-draft-edit-kind/1 at its boundaries, authorship bookkeeping, and seed validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../src/edit-kind.cjs');
const plugin = require('../plugin.cjs');
const {history, binding} = require('./seeds.cjs');

test('sentences split at . ? ! followed by a space or the end; other text stays one sentence', () => {
  assert.deepEqual(k.sentences('Is it? Yes! No.  Trailing words'), ['Is it?', 'Yes!', 'No.', 'Trailing words']);
  assert.deepEqual(k.sentences('Version 2.0 came out.'), ['Version 2.0 came out.'], 'A dot inside a number is not a boundary');
  assert.deepEqual(k.sentences('   '), []);
});

test('language means one changed sentence, none added or removed, and at most 30% of its words', () => {
  const ten = 'a b c d e f g h i j.';
  assert.deepEqual(k.editKind(ten, 'x y z d e f g h i j.'), {kind: 'language', words_changed: 3, words_in_sentence: 10}, '3 of 10 is exactly 30%');
  assert.equal(k.editKind(ten, 'x y z w e f g h i j.').kind, 'content', '4 of 10 is over 30%');
  assert.equal(k.editKind('One two three. Four five six.', 'One two four. Four five seven.').kind, 'content', 'Two changed sentences');
  assert.equal(k.editKind('One two three.', 'One two three. Four.').kind, 'content', 'An added sentence');
  assert.equal(k.editKind('One two three. Four.', 'One two three.').kind, 'content', 'A removed sentence');
  assert.equal(k.editKind('Word.', 'Word.').kind, 'content', 'No changed sentence is not a language change');
  assert.equal(k.distance(['a', 'b', 'c'], ['a', 'c', 'd']), 2);
});

test('authorship: unchanged sentences keep their authors when sentences are inserted, moved or removed', () => {
  const old = [{text: 'A one.', author: 'student', ref: null}, {text: 'B two.', author: 'suggestion', ref: 'sug-1'}, {text: 'C three.', author: 'student', ref: null}];
  assert.deepEqual(k.reauthor(old, 'A one. New text. B two. C three.', 'agent', 'v5').map(s => s.author), ['student', 'agent', 'suggestion', 'student']);
  assert.deepEqual(k.reauthor(old, 'C three. A one.', 'student', null).map(s => [s.text, s.author]), [['C three.', 'student'], ['A one.', 'student']]);
  assert.deepEqual(k.reauthor(old, 'A one. B too. C three.', 'student', null).map(s => [s.author, s.ref]), [['student', null], ['student', null], ['student', null]]);
  assert.deepEqual(k.shares([{sentences: [{text: 'ab', author: 'student'}, {text: 'c', author: 'agent'}]}]), {student: 66.7, agent: 33.3});
  assert.equal(k.occurrences('aaa', 'aa'), 2, 'Overlapping occurrences count');
});

test('validateSeed refuses inconsistent records', () => {
  const now = '2027-03-08T09:00:00-05:00';
  const cases = [
    ['duplicate IDs', d => { d.comments[1].id = 'c1'; }],
    ['a comment quote that is not unique', d => { d.comments[0].quote = 'e'; }],
    ['a version gap', d => { d.versions[0].number = 2; }],
    ['a future version', d => { d.versions[0].saved_at = '2027-03-09T09:00:00-05:00'; }],
    ['a course without a policy in force', d => { d.policies[1].at = '2027-03-09T09:00:00-05:00'; }],
    ['a grade without a submission', d => { d.submissions = []; }],
    ['a grade above the criterion range', d => { d.grades[0].levels[0].level = 9; }],
    ['an agent sentence without its edit', d => { d.versions[0].paragraphs[0].sentences[0] = {text: d.versions[0].paragraphs[0].sentences[0].text, author: 'agent', ref: 'v42'}; }],
    ['two sentences stored as one', d => { const p = d.versions[0].paragraphs[0]; p.sentences = [{text: p.sentences.map(s => s.text).join(' '), author: 'student', ref: null}]; }],
    ['a reply before its comment', d => { d.comments.find(c => c.id === 'h1-c1').replies[0].at = '2027-02-01T09:00:00-05:00'; }],
    ['a message replying to another course', d => { d.messages.push({id: 'msg-x', course_id: 'comp-101', author: 'instructor', in_reply_to: 'msg-h1', text: 'x', at: now}); }]
  ];
  for (const [name, change] of cases) {
    const d = history(); change(d);
    assert.throws(() => plugin.validateSeed({app_id: 'second-draft', virtual_now: now, binding: binding(d)}, d), e => e.code === 'invalid_seed', name);
  }
  const d = history();
  d.assignments[0].due_at = '2027-06-01T09:00:00-04:00';
  assert.doesNotThrow(() => plugin.validateSeed({app_id: 'second-draft', virtual_now: now, binding: binding(d)}, d), 'Due dates may be later');
});
