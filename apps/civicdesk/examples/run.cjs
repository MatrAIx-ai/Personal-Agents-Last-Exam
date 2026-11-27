'use strict';
// Standalone event example: applies examples/scenario.json to the fixture with the App-only harness, then the schedule.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
assert.equal(f.data.dockets.find(d => d.docket_id === 'OOLS-2026-0017').corrections.length, before.dockets.find(d => d.docket_id === 'OOLS-2026-0017').corrections.length + 1);
const schedule = require('./schedule.json');
for (const event of schedule) f.event(event);
const after = f.data, target = after.dockets.find(d => d.docket_id === 'OCDD-2026-0031');
console.log(JSON.stringify({app:'civicdesk', applied:1 + schedule.length,
  before:{target_closes:before.dockets.find(d => d.docket_id === 'OCDD-2026-0031').closes_at, comments:before.comments.map(c => [c.comment_id, c.status])},
  after:{target_closes:target.closes_at, target_extended_from:target.extended_from, target_corrections:target.corrections.length, comments:after.comments.map(c => [c.comment_id, c.status, c.notices.length])}}, null, 2));
