'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('../tests/harness.cjs');

const app = createHarness();
const before = app.call('questshelf.poll.list', { status: 'open' }).polls.find(p => p.poll_id === 'poll-friday-coop');
const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenario.json'), 'utf8'));
app.applyEvent(ev);
const after = app.call('questshelf.poll.list', { status: 'open' }).polls.find(p => p.poll_id === 'poll-friday-coop');

console.log(JSON.stringify({
  app: 'questshelf',
  poll_id: 'poll-friday-coop',
  votes_before: before.votes.length,
  votes_after: after.votes.length,
  latest_vote: after.votes[after.votes.length - 1],
}, null, 2));
