'use strict';
// Applies examples/scenario.json to the package fixture, without a host, and prints what changed.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const event = require('./scenario.json');
const f = fixture();
const before = f.data;
f.event(event);
const after = f.data;
assert.notDeepEqual(after, before);
// Only the pay calendar entry that the event names is printed, with the statement and the notification that the event wrote.
const entry = data => data.calendar.find(row => row.id === event.payload.entry_id);
const statement = after.statements.find(row => row.id === event.payload.statement_id);
const notification = after.notifications.find(row => row.event_id === event.event_id);
assert.ok(entry(after) && statement && notification);
console.log(JSON.stringify({app: 'payleaf', event, before: {entry: entry(before)}, after: {entry: entry(after), statement, settings: after.settings, notification}}, null, 2));
