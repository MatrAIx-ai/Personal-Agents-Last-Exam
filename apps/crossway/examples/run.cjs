'use strict';
// Applies the example scenario event (a plate read of the Honda Fit Dani sold on
// 2026-09-28 but never removed from the account) to the fixture. It prints the
// notice billed to Dani, the escalation that fell due before the event, and the
// Mail messages both store for a host-side Messaging caller.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
const after = f.data;
assert.notDeepEqual(after, before);
const n = after.notices.at(-1);
assert.deepEqual([n.plate, n.vehicle_id, n.state], ['HKR4471', 'v-0002', 'issued']);
console.log(JSON.stringify({app: 'crossway', toll: after.tolls.at(-1), notice: {id: n.id, state: n.state, amount_cents: n.toll_cents, due_date: n.due_date},
  outgoing: after.outgoing.map(o => o.message)}, null, 2));
