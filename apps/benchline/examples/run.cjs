'use strict';
// Applies examples/scenario.json to the package fixture, without a host, and prints what changed.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const event = require('./scenario.json');
const f = fixture();
const before = f.data;
const read = () => ({usage: f.call('usage.summary').usage, held: f.call('jobs.list', {state: 'held'}).items.map(j => [j.id, j.hold_reason])});
const was = read();
f.event(event);
const after = f.data;
assert.notDeepEqual(after, before);
const notification = after.notifications.find(n => n.event_id === event.event_id);
assert.ok(notification);
console.log(JSON.stringify({app: 'benchline', event, before: {allocation: before.allocation, usage: was.usage, held: was.held},
  after: {allocation: after.allocation, ...read(), notification}}, null, 2));
