'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');

test('T00 account.get returns the holder, zoned addresses, masked cards and the App time', () => {
  const f = fixture();
  const out = f.call('plateway.account.get', {});
  assert.equal(out.status, 'ok');
  assert.equal(out.now, f.ctx.virtual_now);
  assert.equal(out.holder.person_id, 'p-1');
  assert.ok(out.addresses.length >= 1 && out.addresses.every(a => typeof a.zone_id === 'string'));
  assert.ok(out.cards.length >= 1 && out.cards.every(c => /^•••• \d{4}$/.test(c.masked_number)));
  assert.ok(out.cards.every(c => !('number' in c)));
});

test('T00 an unknown operation is rejected', () => {
  const f = fixture();
  assert.equal(f.callRaw('plateway.nothing.here', {}).status, 'unknown_tool');
});
