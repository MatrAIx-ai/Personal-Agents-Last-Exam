#!/usr/bin/env node
'use strict';
// Checks that need the real public runtime: separate Agent and Infra MCP
// connections, Core versions, idempotency, policy profiles, the clock and reset.
// Run from a full checkout: node apps/stoopside/tests/platform-checks.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const VIS = require('../src/visibility.cjs');

// SHA-256 over canonical JSON. snapshot.data is this instance's business state
// (app, account and run records); Core's version, receipts and audit are platform-owned.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const sha = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const hash = snapshot => sha(snapshot.data);
const recordHash = snapshot => sha(VIS.record(snapshot.data));

const EV04 = require('../examples/scenario.json');
const GATED = ['stoopside.posts.publish', 'stoopside.events.confirm_change', 'stoopside.rsvps.confirm', 'stoopside.members.export'];

async function main() {
  const prepared = prepare(path.join(root, 'apps/stoopside'));
  const stateDir = path.join(prepared.root, 'state'), clients = [], results = [];
  const open = async (role, run = 'platform') => {
    const c = new Client(prepared.app, role, run, stateDir, 'stoopside-platform-checks', {registry: prepared.registry});
    clients.push(c); await c.initialize(); return c;
  };
  const ok = (name, condition) => { assert.ok(condition, name); results.push(name); };
  try {
    const infra = await open('infra');
    let snap = await infra.call('env.snapshot');
    ok('reset into the full profile', (await infra.call('env.reset', {expected_version: snap.version, profile: 'full'})).status === 'ready');
    const agent = await open('agent');
    const loaded = (await infra.call('env.snapshot')).snapshot, baseline = hash(loaded), baselineRecord = recordHash(loaded);
    ok('the loaded state has no outgoing notice', loaded.data.notices.length === 0);

    // Anchor: the venue-move reference run, through MCP with Core versions.
    let v = (await infra.call('env.snapshot')).version, n = 0;
    const initialVersion = v;
    const write = async (name, args) => {
      const out = await agent.call('stoopside.' + name, {expected_version: v, request_id: name + '-' + (++n), ...args});
      assert.equal(out.status, 'committed', name + ': ' + JSON.stringify(out));
      v = out.version; return out;
    };
    const preview = (await write('events.preview_change', {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}, notify: 'guests'})).preview;
    const confirmArgs = {expected_version: v, request_id: 'confirm-once', preview_id: preview.id};
    const confirmed = await agent.call('stoopside.events.confirm_change', confirmArgs);
    ok('the venue change commits and notifies the guests only', confirmed.status === 'committed' && confirmed.receipt.recipient_count === 10 && confirmed.receipt.notify === 'guests');
    v = confirmed.version;
    const retry = await agent.call('stoopside.events.confirm_change', confirmArgs);
    ok('a retried confirm returns the original receipt', retry.duplicate === true && JSON.stringify(retry.receipt) === JSON.stringify(confirmed.receipt));
    ok('the same request_id with other arguments is idempotency_conflict',
      (await agent.call('stoopside.events.confirm_change', {...confirmArgs, preview_id: 'pv-9999'})).status === 'idempotency_conflict');
    ok('a stale version is refused', (await agent.call('stoopside.signups.release', {expected_version: initialVersion,
      request_id: 'stale', sheet_id: 's-0022', slot_id: 'carpool-1'})).status === 'stale_version');
    ok('a new request on a consumed preview is preview_consumed',
      (await agent.call('stoopside.events.confirm_change', {expected_version: v, request_id: 'confirm-again', preview_id: preview.id})).status === 'preview_consumed');
    await write('signups.release', {sheet_id: 's-0022', slot_id: 'carpool-1'});
    await write('signups.swap_answer', {swap_id: 'sw-0005', answer: 'accept'});
    const after = await infra.call('env.snapshot');
    const s22 = after.snapshot.data.sheets.find(s => s.id === 's-0022');
    ok('the run left the move, the slot change, the accepted swap and one receipt',
      after.snapshot.data.events.find(e => e.id === 'e-0140').venue === 'Linden Park pavilion' &&
      JSON.stringify(s22.slots.filter(x => x.claims.includes('m-001')).map(x => x.id)) === '["snacks"]' &&
      after.snapshot.data.notices.length === 1);
    ok('Core audit recorded reads and the rejected calls', after.snapshot.audit.some(a => a.decision === 'deny'));

    // (c) The browse profile refuses the four gated tools with the state hash unchanged.
    await infra.call('env.reset', {expected_version: after.version, profile: 'browse'});
    const b = await infra.call('env.snapshot');
    const listed = (await agent.request('tools/list')).result.tools.map(t => t.name);
    ok('browse lists 21 tools and none of the gated four', listed.length === 21 && GATED.every(x => !listed.includes(x)));
    for (const name of GATED) {
      const args = name === 'stoopside.members.export' ? {group_id: 'g-block'} : {expected_version: b.version, request_id: 'deny-' + name, preview_id: 'pv-0001'};
      ok('browse refuses ' + name, (await agent.call(name, args)).status === 'permission_denied');
    }
    const browsePreview = await agent.call('stoopside.posts.preview', {expected_version: b.version, request_id: 'browse-preview', group_id: 'g-block', kind: 'post', audience: 'group', text: 'Hi'});
    ok('browse still allows previews', browsePreview.status === 'committed');
    await infra.call('env.reset', {expected_version: browsePreview.version, profile: 'browse'});
    const denied = await agent.call('stoopside.rsvps.confirm', {expected_version: (await infra.call('env.snapshot')).version, request_id: 'deny-again', preview_id: 'pv-0001'});
    ok('a refused call leaves the state hash unchanged', denied.status === 'permission_denied' && hash((await infra.call('env.snapshot')).snapshot) === baseline);

    // Reviewer check through real Core: one env.advance_time jump across several
    // deadlines and small steps give the same committed chain.
    const chain = async (run, targets) => {
      const i = await open('infra', run), a = await open('agent', run);
      let s = await i.call('env.snapshot');
      await i.call('env.reset', {expected_version: s.version, profile: 'full'});
      s = await i.call('env.snapshot');
      const applied = await i.call('env.apply_event', {expected_version: s.version, event: EV04});
      assert.equal(applied.status, 'committed');
      let version = applied.version;
      for (const [k, t] of targets.entries()) {
        const moved = await i.call('env.advance_time', {expected_version: version, request_id: run + '-clock-' + k, virtual_now: t});
        assert.equal(moved.status, 'committed');
        version = moved.version;
        assert.equal((await a.call('stoopside.events.get', {event_id: 'e-0117'})).status, 'ok');   // reads commit nothing
      }
      const w = await a.call('stoopside.profile.update', {expected_version: version, request_id: run + '-write', bio: 'Back from the cabin.'});
      assert.equal(w.status, 'committed');
      return (await i.call('env.snapshot')).snapshot;
    };
    const steps = [];
    for (let t = Date.parse('2027-03-05T20:00:00-05:00'); t < Date.parse('2027-03-08T09:00:00-05:00'); t += 7 * 3600000) steps.push(new Date(t).toISOString());
    const one = await chain('jump', ['2027-03-08T09:00:00-05:00']), many = await chain('steps', [...steps, '2027-03-08T09:00:00-05:00']);
    const offers = s => s.data.deliveries.filter(d => d.reason === 'waitlist_offer').map(d => [d.recipient_member_id, d.at]);
    ok('one clock jump and small steps commit byte-identical business data', hash(one) === hash(many));
    ok('each offer is stamped at the previous expiry', JSON.stringify(offers(one)) ===
      JSON.stringify([['m-001', '2027-03-05T18:20:00-05:00'], ['m-020', '2027-03-06T18:20:00-05:00'], ['m-031', '2027-03-07T18:20:00-05:00']]));

    // (d) Reset: 20 cycles, each after a write that leaves a notice, restore the
    // loaded hash (and the visibility record derived from it) with no outgoing notice left.
    await infra.call('env.reset', {expected_version: (await infra.call('env.snapshot')).version, profile: 'full'});
    for (let i = 0; i < 20; i++) {
      snap = await infra.call('env.snapshot');
      const p = await agent.call('stoopside.rsvps.preview', {expected_version: snap.version, request_id: 'cycle-p-' + i, event_id: 'e-0121', answer: 'yes', guests: 0, children: i % 3});
      assert.equal(p.status, 'committed');
      const c = await agent.call('stoopside.rsvps.confirm', {expected_version: p.version, request_id: 'cycle-c-' + i, preview_id: p.preview.id});
      assert.equal(c.status, 'committed');
      const dirty = await infra.call('env.snapshot');
      assert.notEqual(hash(dirty.snapshot), baseline);
      assert.equal(dirty.snapshot.data.notices.length, 1);
      assert.equal((await infra.call('env.reset', {expected_version: dirty.version})).status, 'ready');
      const clean = (await infra.call('env.snapshot')).snapshot;
      assert.equal(hash(clean), baseline, 'reset cycle ' + i);
      assert.equal(recordHash(clean), baselineRecord, 'visibility record, reset cycle ' + i);
      assert.equal(clean.data.notices.length, 0);
      assert.deepEqual(clean.audit.map(a => a.tool), ['env.reset']);   // reset clears the audit; only its own row remains
    }
    ok('20 reset cycles restore the loaded state hash and visibility record with no notice left', true);
    console.log(JSON.stringify({app: 'stoopside', baseline_sha256: baseline, visibility_record_sha256: baselineRecord, passed: results}, null, 2));
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
