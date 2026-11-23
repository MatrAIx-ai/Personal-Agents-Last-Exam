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
// The fixture is large. So only the claim that the event names is printed, with the notification that the event wrote.
const claim = data => data.claims.find(row => row.id === event.payload.claim_id);
const notification = after.notifications.find(row => row.event_id === event.event_id);
assert.ok(claim(after) && notification);
console.log(JSON.stringify({app: 'alderbrook', event, before: {claim: claim(before)}, after: {claim: claim(after), notification}}, null, 2));
