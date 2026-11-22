#!/usr/bin/env node
'use strict';
// Checks that need the real public runtime: separate Agent and Infra MCP
// connections, Core versions, idempotency, policy profiles and reset.
// Run from a full checkout: node apps/switchback/tests/platform-checks.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));

// SHA-256 over canonical JSON of this instance's business state (platform fields excluded).
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = snapshot => crypto.createHash('sha256').update(canonical(snapshot.data)).digest('hex');

async function main() {
  const prepared = prepare(path.join(root, 'apps/switchback'));
  const stateDir = path.join(prepared.root, 'state'), clients = [], results = [];
  const open = async (role, run = 'platform') => {
    const c = new Client(prepared.app, role, run, stateDir, 'switchback-platform-checks', {registry: prepared.registry});
    clients.push(c); await c.initialize(); return c;
  };
  const ok = (name, condition) => { assert.ok(condition, name); results.push(name); };
  try {
    const infra = await open('infra');
    // Start from the full profile so the anchor run can book.
    let snap = await infra.call('env.snapshot');
    ok('reset into the full profile', (await infra.call('env.reset', {expected_version: snap.version, profile: 'full'})).status === 'ready');
    const agent = await open('agent');
    const loaded = (await infra.call('env.snapshot')).snapshot, baseline = hash(loaded);

    // Anchor: the lake-weekend reference run, through MCP with Core versions.
    let v = (await infra.call('env.snapshot')).version, n = 0;
    const write = async (name, args) => {
      const out = await agent.call('switchback.' + name, {expected_version: v, request_id: name + '-' + (++n), ...args});
      assert.equal(out.status, 'committed', name + ': ' + JSON.stringify(out));
      v = out.version; return out;
    };
    const e = (await write('equipment.save', {label: 'New trailer', kind: 'trailer', length_ft: 26, make_default: true})).equipment;
    const found = await agent.call('switchback.sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27', electric_min_amps: 30, min_vehicle_ft: e.length_ft, available_only: true});
    const hold = (await write('cart.hold', {site_id: found.sites[0].id, arrival: '2027-06-25', departure: '2027-06-27'})).hold;
    const preview = (await write('reservations.preview', {hold_id: hold.id, card_id: 'card-dana-visa'})).preview;
    const confirmArgs = {expected_version: v, request_id: 'confirm-once', preview_id: preview.id};
    const confirmed = await agent.call('switchback.reservations.confirm', confirmArgs);
    ok('reference booking commits', confirmed.status === 'committed' && confirmed.reservation.state === 'confirmed');
    const retry = await agent.call('switchback.reservations.confirm', confirmArgs);
    ok('a retried confirm returns the same receipt', retry.duplicate === true && retry.receipt.id === confirmed.receipt.id);
    ok('a stale version is refused', (await agent.call('switchback.cart.hold', {expected_version: v, request_id: 'stale', site_id: 'cf-B10', arrival: '2027-07-10', departure: '2027-07-11'})).status === 'stale_version');
    const fresh = await agent.call('switchback.reservations.confirm', {expected_version: confirmed.version, request_id: 'confirm-again', preview_id: preview.id});
    ok('a new request on a consumed preview is preview_consumed', fresh.status === 'preview_consumed');
    const after = await infra.call('env.snapshot');
    ok('the run left a reservation, a charge and a notice', after.snapshot.data.reservations.length === 4 && after.snapshot.data.notices.length === 1);
    ok('Core audit recorded reads and the rejected calls', after.snapshot.audit.length > 0);

    // (g) early: the browse profile refuses confirms with state unchanged.
    await infra.call('env.reset', {expected_version: after.version, profile: 'browse'});
    const b = await infra.call('env.snapshot');
    const denied = await agent.call('switchback.wallet.set_default', {expected_version: b.version, request_id: 'deny', card_id: 'card-dana-visa'});
    ok('browse profile refuses wallet.set_default', denied.status === 'permission_denied');
    ok('a refused call leaves the state hash unchanged', hash((await infra.call('env.snapshot')).snapshot) === baseline);

    // (c) Reset: 20 cycles, each after a write, restore the loaded hash with no outgoing notice left.
    await infra.call('env.reset', {expected_version: (await infra.call('env.snapshot')).version, profile: 'full'});
    for (let i = 0; i < 20; i++) {
      snap = await infra.call('env.snapshot');
      const changed = await agent.call('switchback.companions.save', {expected_version: snap.version, request_id: 'cycle-' + i, display_name: 'Guest ' + i});
      assert.equal(changed.status, 'committed');
      const dirty = await infra.call('env.snapshot');
      assert.notEqual(hash(dirty.snapshot), baseline);
      assert.equal((await infra.call('env.reset', {expected_version: dirty.version})).status, 'ready');
      const clean = (await infra.call('env.snapshot')).snapshot;
      assert.equal(hash(clean), baseline, 'reset cycle ' + i);
      assert.equal(clean.data.notices.length, 0);
    }
    ok('20 reset cycles restore the loaded state hash', true);
    console.log(JSON.stringify({app: 'switchback', baseline_sha256: baseline, passed: results}, null, 2));
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
