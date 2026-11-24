'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./prompt.cjs');
const {HINT} = require('./user-model.cjs');

test('the system prompt states the setup, and only hinted runs carry the hint', () => {
  assert.match(p.SYSTEM_PROMPT, /You only run when Daniel sends you a message/);
  assert.match(p.SYSTEM_PROMPT, /only way to reach him between sessions/);
  assert.ok(!p.systemPrompt().includes(HINT));
  assert.ok(p.systemPrompt({hinted:true}).endsWith(HINT));
});

test('scripted turns carry their weekday and local time', () => {
  assert.deepEqual(p.scriptedTurns().map(t => t.text.split('\n')[0]),
    ['[Tuesday 2027-08-24, 21:00]', '[Sunday 2027-09-12, 10:30]', '[Sunday 2027-10-03, 11:00]']);
  assert.match(p.scriptedTurns()[0].text, /\n\nDaniel: Okay, Japan\./);
});
