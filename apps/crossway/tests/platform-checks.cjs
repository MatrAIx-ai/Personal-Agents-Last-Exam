#!/usr/bin/env node
'use strict';
// Checks that need the real public runtime: separate Agent and Infra MCP
// connections, Core versions, idempotency, policy profiles, Core's
// env.advance_time and reset.
// Run from a full checkout: node apps/crossway/tests/platform-checks.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));

// SHA-256 over canonical JSON of this instance's business state (platform fields excluded).
const {hash, sha, loadSeed, seedFiles} = require('./platform-lib.cjs');
const MAIL = object_id => ({app_id: 'mail', account_id: 'mail-dani', object_id});
const GATED = {
  'account.topup.confirm': {preview_id: 'pv-0001'},
  'notices.pay.confirm': {preview_id: 'pv-0001'},
  'disputes.confirm': {preview_id: 'pv-0001'},
  'account.replenish.set': {enabled: true, card_id: 'card-dani-visa'},
  'vehicles.end': {vehicle_id: 'v-0002', end_date: '2026-09-28'},
  'vehicles.update': {vehicle_id: 'v-0002', label: 'Sold'},
  'disputes.withdraw': {dispute_id: 'dp-0002'},
};

async function main() {
  const prepared = prepare(path.join(root, 'apps/crossway'));
  const stateDir = path.join(prepared.root, 'state'), clients = [], results = [];
  const open = async (role, run = 'platform') => {
    const c = new Client(prepared.app, role, run, stateDir, 'crossway-platform-checks', {registry: prepared.registry});
    clients.push(c); await c.initialize(); return c;
  };
  const ok = (name, condition) => { assert.ok(condition, name); results.push(name); };
  // Writes through one Agent connection, threading Core's version.
  const writer = (agent, start) => {
    let v = start, n = 0;
    const w = async (name, args) => {
      const out = await agent.call('crossway.' + name, {expected_version: v, request_id: name + '-' + (++n), ...args});
      assert.equal(out.status, 'committed', name + ': ' + JSON.stringify(out));
      v = out.version; return out;
    };
    w.version = () => v;
    w.set = value => { v = value; };
    return w;
  };
  try {
    const infra = await open('infra');
    let snap = await infra.call('env.snapshot');
    ok('reset into the full profile', (await infra.call('env.reset', {expected_version: snap.version, profile: 'full'})).status === 'ready');
    const agent = await open('agent');
    const loaded = (await infra.call('env.snapshot')).snapshot, baseline = hash(loaded);

    // Anchor: the sold-car reference run, through MCP with Core versions.
    const write = writer(agent, (await infra.call('env.snapshot')).version);
    for (const id of ['n-0017', 'n-0018']) {
      const p = (await write('disputes.preview', {notice_id: id, reason: 'sold_or_not_in_possession', transfer_date: '2026-09-28', evidence: [MAIL('m-11133')]})).preview;
      await write('disputes.confirm', {preview_id: p.id});
    }
    const preview = (await write('notices.pay.preview', {notice_ids: ['n-0014'], card_id: 'card-dani-visa'})).preview;
    const confirmArgs = {expected_version: write.version(), request_id: 'confirm-once', preview_id: preview.id};
    const confirmed = await agent.call('crossway.notices.pay.confirm', confirmArgs);
    ok('reference payment commits', confirmed.status === 'committed' && confirmed.notices[0].state === 'paid');
    const retry = await agent.call('crossway.notices.pay.confirm', confirmArgs);
    ok('a retried confirm returns the same receipt', retry.duplicate === true && retry.receipt.id === confirmed.receipt.id);
    ok('a reused request ID with other arguments is idempotency_conflict',
      (await agent.call('crossway.notices.pay.confirm', {...confirmArgs, preview_id: 'pv-0099'})).status === 'idempotency_conflict');
    ok('a stale version is refused', (await agent.call('crossway.vehicles.end', {expected_version: write.version(), request_id: 'stale', vehicle_id: 'v-0002', end_date: '2026-09-28'})).status === 'stale_version');
    const fresh = await agent.call('crossway.notices.pay.confirm', {expected_version: confirmed.version, request_id: 'confirm-again', preview_id: preview.id});
    ok('a new request on a used preview is preview_used', fresh.status === 'preview_used');
    write.set(confirmed.version);
    await write('vehicles.end', {vehicle_id: 'v-0002', end_date: '2026-09-28'});
    const after = await infra.call('env.snapshot'), d = after.snapshot.data;
    ok('the run left two disputes, a payment and three Mail notices',
      d.notices.filter(n => n.state === 'disputed').length === 2 && d.notices.find(n => n.id === 'n-0014').state === 'paid' && d.outgoing.length === 3);
    ok('Core audit recorded reads and the rejected calls', after.snapshot.audit.some(a => a.decision === 'deny') && after.snapshot.audit.some(a => a.tool === 'crossway.notices.pay.preview'));

    // Browse profile: every gated write is refused with the state hash unchanged; previews still work.
    await infra.call('env.reset', {expected_version: after.version, profile: 'browse'});
    const b = await infra.call('env.snapshot');
    for (const [name, args] of Object.entries(GATED)) {
      const denied = await agent.call('crossway.' + name, {expected_version: b.version, request_id: 'deny-' + name, ...args});
      assert.equal(denied.status, 'permission_denied', name);
    }
    ok('browse profile refuses all seven gated writes', true);
    ok('refused calls leave the state hash unchanged', hash((await infra.call('env.snapshot')).snapshot) === baseline);
    ok('browse profile still allows a payment preview',
      (await agent.call('crossway.notices.pay.preview', {expected_version: b.version, request_id: 'browse-preview', notice_ids: ['n-0016']})).status === 'committed');

    // Clock: Agent reads do not move time; one env.advance_time jump and several steps give the same records.
    const end = '2027-01-15T09:00:00-05:00';
    const clockRun = async (run, stops, touchEach) => {
      const i = await open('infra', run), a = await open('agent', run);
      let s = await i.call('env.snapshot');
      await i.call('env.reset', {expected_version: s.version, profile: 'full'});
      let k = 0;
      for (const t of [...stops, end]) {
        s = await i.call('env.snapshot');
        const adv = await i.call('env.advance_time', {expected_version: s.version, virtual_now: t, request_id: run + '-' + (++k)});
        assert.equal(adv.status, 'committed');
        if (touchEach || t === end) {
          const v = (await i.call('env.snapshot')).version;
          assert.equal((await a.call('crossway.account.replenish.set', {expected_version: v, request_id: run + '-touch-' + k, enabled: true})).status, 'committed');
        }
      }
      return {infra: i, agent: a, snapshot: (await i.call('env.snapshot')).snapshot};
    };
    const idle = await (async () => {
      const i = await open('infra', 'clock-idle'), a = await open('agent', 'clock-idle');
      let s = await i.call('env.snapshot');
      await i.call('env.reset', {expected_version: s.version, profile: 'full'});
      s = await i.call('env.snapshot');
      await i.call('env.advance_time', {expected_version: s.version, virtual_now: end, request_id: 'idle'});
      const before = await i.call('env.snapshot');
      const seen = (await a.call('crossway.notices.get', {notice_id: 'n-0017'})).notice;
      const after2 = await i.call('env.snapshot');
      return {seen, unchangedByRead: hash(before.snapshot) === hash(after2.snapshot) && before.snapshot.virtual_now === after2.snapshot.virtual_now && before.version.revision === after2.version.revision,
        storedState: before.snapshot.data.notices.find(n => n.id === 'n-0017').state};
    })();
    ok('a read after env.advance_time shows the escalation without storing it',
      idle.seen.state === 'collections' && idle.storedState === 'issued' && idle.unchangedByRead);
    const jump = await clockRun('clock-jump', [], false);
    const steps = await clockRun('clock-steps', ['2026-11-03T00:00:00-05:00', '2026-11-10T00:00:00-05:00', '2026-12-01T00:00:00-05:00', '2026-12-31T12:00:00-05:00'], true);
    const n17 = jump.snapshot.data.notices.find(n => n.id === 'n-0017');
    ok('one advance commits issued -> escalated -> collections, each at its own deadline',
      JSON.stringify(n17.history.slice(1).map(h => [h.action, h.at])) === JSON.stringify([['escalated', '2026-11-10T00:00:00-05:00'], ['sent_to_collections', '2026-12-10T00:00:00-05:00']]));
    ok('single-jump and stepwise env.advance_time give the same state hash', hash(jump.snapshot) === hash(steps.snapshot));

    // (c) Reset: 20 cycles per seed, audit exported first, each restoring the loaded hash with no outgoing notice left.
    const cycles = async (run, card, loadedHash) => {
      const exported = [];
      for (let i = 0; i < 20; i++) {
        snap = await infra.call('env.snapshot');
        const changed = await agent.call('crossway.account.topup.preview', {expected_version: snap.version, request_id: run + '-cycle-' + i, amount_cents: 2000 + i, card_id: card});
        assert.equal(changed.status, 'committed');
        const confirmedCycle = await agent.call('crossway.account.topup.confirm', {expected_version: changed.version, request_id: run + '-cycle-confirm-' + i, preview_id: changed.preview.id});
        assert.equal(confirmedCycle.status, 'committed');
        const dirty = await infra.call('env.snapshot');
        assert.notEqual(hash(dirty.snapshot), loadedHash);
        assert.equal(dirty.snapshot.data.outgoing.length, 1);
        exported.push(dirty.snapshot.audit.length);
        assert.equal((await infra.call('env.reset', {expected_version: dirty.version})).status, 'ready');
        const clean = (await infra.call('env.snapshot')).snapshot;
        assert.equal(hash(clean), loadedHash, run + ' reset cycle ' + i);
        assert.equal(clean.data.outgoing.length, 0);
        assert.ok(!clean.audit.some(a => a.tool.startsWith('crossway.')), 'reset clears the business audit');
      }
      return exported.every(n => n > 0);
    };
    await infra.call('env.reset', {expected_version: (await infra.call('env.snapshot')).version, profile: 'full'});
    ok('dani: 20 reset cycles restore the loaded state hash, audit exported before each', await cycles('dani', 'card-dani-visa', baseline));
    const seedHashes = {dani: baseline};
    for (const [id, card] of [['marisol', 'card-marisol-visa'], ['theo', 'card-theo-amex']]) {
      const {snapshot: loadedSeed} = await loadSeed(infra, id, 'full');
      seedHashes[id] = hash(loadedSeed.snapshot);
      ok(`${id}: env.load_seed loads the seed with its own provenance; its hash is the seed file's`, seedHashes[id] === sha(seedFiles(id).data));
      ok(`${id}: 20 reset cycles restore the loaded state hash, audit exported before each`, await cycles(id, card, seedHashes[id]));
    }
    console.log(JSON.stringify({app: 'crossway', baseline_sha256: baseline, seed_sha256: seedHashes, passed: results}, null, 2));
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
