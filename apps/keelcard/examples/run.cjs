'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('../tests/harness.cjs');
const f = fixture();
const before = f.data.authorizations.length;
f.event(require('./scenario.json'));
assert.ok(f.data.authorizations.length > before);
const added = f.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:fc-scenario-1:1');
assert.equal(added.decision, 'approved');
assert.equal(added.status, 'pending');
console.log(JSON.stringify({
  app: 'keelcard',
  authorizations: f.data.authorizations.length,
  added: added.authorization_id,
  hold_cents: added.hold_cents,
  balance_cents: f.data.funding.balance_cents
}));
