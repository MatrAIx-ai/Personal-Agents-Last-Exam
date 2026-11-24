'use strict';
const assert = require('node:assert/strict');
const {fixture, preview, approve, execute} = require('../tests/support.cjs');
const f = fixture(), p = preview(f);
approve(f, p);
const receipt = execute(f, p);
assert.equal(f.data.accounts[0].balance_cents, 410000);
assert.equal(f.data.accounts[2].balance_cents, 310000);
console.log(JSON.stringify({example: 'App-only transfer; trusted decision supplied by the test harness', receipt,
  balances: f.data.accounts.map(({id, balance_cents}) => ({id, balance_cents}))}, null, 2));
