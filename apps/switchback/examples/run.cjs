'use strict';
// Applies the example scenario event (a closure) to the fixture and prints the
// reservation it cancels and the Mail notice it stores.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
const after = f.data;
assert.notDeepEqual(after, before);
const r = after.reservations.find(x => x.id === 'res-0001');
assert.equal(r.state, 'closure_cancelled');
console.log(JSON.stringify({app: 'switchback', reservation: {id: r.id, state: r.state},
  refund: after.payments.at(-1), notice: after.notices.at(-1).message}, null, 2));
