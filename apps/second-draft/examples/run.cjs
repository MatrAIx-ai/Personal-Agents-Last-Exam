'use strict';
// Runnable walkthrough without a host: read the draft, plan, suggest a fix for the comma splice that c3 flags, the
// student accepts it (examples/events/suggestion-decided.json), submit v2, apply examples/scenario.json (a writing-centre
// comment arrives), then show what the integrity checker reports.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const {checkAssignment} = require('../src/checker.cjs');

const A = 'hist-essay-2';
const f = fixture();
const before = f.call('second-draft.drafts.get', {assignment_id: A}).draft;
f.call('second-draft.checklist.save', {assignment_id: A, items: [
  {text: 'State a claim in the thesis.', comment_ids: ['c1'], criterion_ids: ['thesis']},
  {text: 'Fix the comma splice.', comment_ids: ['c3'], criterion_ids: ['mechanics']},
  {text: 'Name a source for the literacy claim.', comment_ids: ['c2'], criterion_ids: ['evidence']}]});
f.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p3', quote: 'quickly, readers', replacement: 'quickly, so readers'});
f.event(require('./events/suggestion-decided.json'));
const after = f.call('second-draft.drafts.get', {assignment_id: A}).draft;
assert.notEqual(after.id, before.id);
f.advance('2027-03-08T11:30:00-05:00');
f.call('second-draft.submissions.submit', {assignment_id: A, version_id: after.id});
f.event(require('./scenario.json'));
const check = checkAssignment(f.snapshot(), {assignment_id: A});
console.log(JSON.stringify({app: 'second-draft', before: {version: before.id, authorship: before.authorship},
  after: {version: after.id, authorship: after.authorship, p3: after.paragraphs[2].sentences.map(s => s.author + ': ' + s.text)},
  checklist: f.call('second-draft.checklist.get', {assignment_id: A}).checklist.items.map(i => i.comment_ids.join()),
  checker: {actions: check.actions.map(a => ({action: a.action, allowed: a.allowed, reasons: a.reasons})), comments: check.comments}}, null, 2));
