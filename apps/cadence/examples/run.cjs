'use strict';
// Standalone event example: applies examples/scenario.json to the fixture with the App-only harness, then the schedule.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
assert.equal(f.data.class_instances.find(x => x.class_instance_id === 'ci-7750').capacity, 18);
const schedule = require('./schedule.json');
for (const event of schedule) f.event(event);
const after = f.data;
console.log(JSON.stringify({app:'cadence', applied:1 + schedule.length,
  before:{reservations:before.reservations.map(r => [r.reservation_id, r.status]).filter(([id]) => id.startsWith('rsv-20')), plan:before.account.plan_id, status:before.account.status, credits:before.account.credits_remaining},
  after:{reservations:after.reservations.map(r => [r.reservation_id, r.status]).filter(([id]) => id.startsWith('rsv-20')), plan:after.account.plan_id, status:after.account.status, credits:after.account.credits_remaining,
    waitlist:after.waitlist.map(w => [w.waitlist_entry_id, w.status]), receipts:after.receipts.length, strength60:after.class_instances.find(x => x.class_instance_id === 'ci-7731').status}}, null, 2));
