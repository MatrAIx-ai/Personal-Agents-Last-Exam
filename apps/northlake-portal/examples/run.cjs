'use strict';
// Standalone event example: applies examples/scenario.json to the fixture with the App-only harness, then the schedule.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
const thread = f.data.threads.find(t => t.thread_id === 'thr-billing-0928');
assert.equal(thread.messages[thread.messages.length - 1].read, false);
const schedule = require('./schedule.json');
for (const event of schedule) f.event(event);
console.log(JSON.stringify({app:'northlake-portal', applied:1 + schedule.length, before:{threads:before.threads.length, unread:before.threads.flatMap(t => t.messages).filter(m => !m.read).length},
  after:{threads:f.data.threads.length, unread:f.data.threads.flatMap(t => t.messages).filter(m => !m.read).length, statements:f.data.statements.map(s => s.statement_id), claims:f.data.claims.map(c => [c.claim_id, c.status])}}, null, 2));
