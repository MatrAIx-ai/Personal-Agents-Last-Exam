'use strict';
// Applies examples/scenario.json to the fixture and prints the observable change.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.call('shipments.get', {id: 'S001'}).shipment;
f.event(require('./scenario.json'));
const after = f.call('shipments.get', {id: 'S001'}).shipment;
assert.notDeepEqual(after, before);
console.log(JSON.stringify({app: 'parcel-delivery-manager', before: before.timeline.at(-1), after: after.timeline.at(-1), status: after.status}, null, 2));
