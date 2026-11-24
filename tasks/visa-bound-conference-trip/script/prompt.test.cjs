'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./prompt.cjs');
const {HINT} = require('./user-model.cjs');

test('the system prompt states the setup, and only hinted runs carry the hint', () => {
  assert.match(p.SYSTEM_PROMPT, /You only run when Mingyu sends you a message/);
  assert.match(p.SYSTEM_PROMPT, /Every session continues this conversation/);
  assert.ok(!p.systemPrompt().includes(HINT));
  assert.ok(p.systemPrompt({hinted:true}).endsWith(HINT));
});

test('scripted turns carry their weekday and local time, and session 2b is assembled', () => {
  const turns = p.scriptedTurns({asked_arrival_date:true});
  assert.deepEqual(turns.map(t => t.text.split('\n')[0]),
    ['[Monday 2027-02-08, 20:30]', '[Wednesday 2027-02-10, 09:12]', '[Wednesday 2027-02-10, 21:00]', '[Tuesday 2027-03-16, 21:05]']);
  assert.match(turns[2].text, /Mingyu: Keeping the 19th\. And for anything the trip needs/);
});
