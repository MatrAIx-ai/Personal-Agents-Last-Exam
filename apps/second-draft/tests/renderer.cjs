'use strict';
// The reviewer renderer shows what the read tools return, escapes all text, and shows no evaluator-only record.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');
const view = require('../gui/src/view.js');

test('the four views follow the read tools after a suggestion, a comment and a checklist', async () => {
  const f = fixture();
  f.call('second-draft.suggestions.create', {assignment_id: 'hist-essay-2', paragraph_id: 'p3', quote: 'quickly, readers', replacement: 'quickly, so readers'});
  f.event({event_id: 'ev-3', at: '2027-03-08T11:00:00-05:00', operation: 'second-draft.suggestion.decided', payload: {suggestion_id: 'sug-1', decision: 'accepted'}});
  f.event({event_id: 'ev-c', at: '2027-03-08T11:05:00-05:00', operation: 'second-draft.comment.posted', payload: {comment_id: 'c4', assignment_id: 'hist-essay-2',
    version_id: 'v2', paragraph_id: 'p2', quote: 'how fast', from: 'peer', text: 'Use <b>numbers</b> & a source.'}});
  f.call('second-draft.checklist.save', {assignment_id: 'hist-essay-2', items: [{text: 'Thesis', comment_ids: ['c1'], criterion_ids: ['thesis']}]});
  const model = await view.collect((name, args) => f.call(name, args));
  const html = view.render(model);
  assert.deepEqual([...html.matchAll(/data-view="([a-z]+)"/g)].map(x => x[1]), view.VIEWS);
  const latest = f.call('second-draft.drafts.get', {assignment_id: 'hist-essay-2'}).draft;
  assert.ok(html.includes('version v2 (suggestion'), 'The latest version is shown');
  assert.ok(html.includes('suggestion 25.6%') && html.includes('student 74.4%'));
  for (const p of latest.paragraphs) for (const s of p.sentences) assert.ok(html.includes(view.escape(s.text)), 'Every sentence is shown');
  assert.equal((html.match(/data-author="suggestion"/g) || []).length, 1);
  assert.ok(html.includes('Use &lt;b&gt;numbers&lt;/b&gt; &amp; a source.') && !html.includes('<b>numbers'), 'Comment text is escaped');
  assert.ok(html.includes('<td>v1</td><td>1</td>') && html.includes('<td>v2</td><td>2</td>'), 'Both versions are in the history');
  assert.ok(html.includes('<td>Thesis</td><td>c1</td>'));
  for (const hidden of ['activity_log', 'touched', 'not_allowed', 'course_policy']) assert.ok(!html.includes(hidden));
});
