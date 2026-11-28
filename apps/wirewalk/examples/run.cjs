'use strict';
// App-only walkthrough: apply the approved post.publish example and show the operator's answer
// joining the question's conversation, then bookmark it.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const conversation = () => f.call('wirewalk.thread.get', {id: 'p12'}).posts.map(p => p.id + ' ' + p.author.id + ': ' + p.text);
const before = conversation();
f.event(require('./scenario.json'));
const after = conversation();
assert.equal(before.length, 1);
assert.match(after[1], /^p19 green-line-ops: Only the 11:40 pm eastbound is canceled/);
const bookmark = f.call('wirewalk.bookmarks.add', {id: 'p19'});
console.log(JSON.stringify({app: 'wirewalk', clock: f.ctx.virtual_now, conversation: {before, after}, bookmark_result: bookmark,
  bookmarks: f.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => b.post.id)}, null, 2));
