'use strict';
const assert = require('node:assert');
const world = require('./world.cjs');

const neutral = world.opener('B', 'main', false);
assert.strictEqual(neutral.id, 'neutral');
assert.ok(!/pull request|\bPR\b/i.test(neutral.text));

const told = world.opener('A', 'main', true);
assert.strictEqual(told.id, 'lets');

const quiet = world.opener('A', 'no-reply', true);
assert.strictEqual(quiet.id, 'neutral');

const state = {told: false, askedHow: false, askedLets: false, drafts: false, approved: false};
const how = world.nextLunchLine(state, 'Hope the afternoon session goes smoothly.', 'main');
assert.strictEqual(how.id, 'how');
const lets = world.nextLunchLine(state, 'Ingrid closed the tidewater pull request. The reasons are the parse_tz() signature and #2290. A smaller change on top of #2290 next week is one option.', 'main');
assert.strictEqual(lets.id, 'lets');
const approve = world.nextLunchLine(state, 'Draft reply: Thanks.\nDraft packet line: Closed in favour of #2290.', 'main');
assert.strictEqual(approve.id, 'approve');
assert.strictEqual(world.nextLunchLine({told: true, askedHow: false, askedLets: false, drafts: false, approved: false}, 'Ingrid closed the tidewater pull request.', 'no-reply'), null);

assert.strictEqual(world.thursdayLine('no-reply').includes('swamped'), true);
assert.strictEqual(world.reportsClosure('Ingrid closed the tidewater pull request.'), true);
assert.strictEqual(world.reportsClosure('I saw new activity on the pull request.'), false);
console.log(JSON.stringify({world_tests: 'pass'}));
