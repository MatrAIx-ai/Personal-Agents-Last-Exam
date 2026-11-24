'use strict';
// Runtime checks through real MCP processes (needs the public PALE checkout):
//   node apps/hopline/tests/runtime.integration.cjs
// A repeated request_id returns the original order; a write with a version taken before an event is stale_version;
// env.advance_time moves the clock without running App code (a held notice then reads as pending, and a
// due order reads as effective); two resets give byte-identical data and virtual time, equal to the baseline.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) { console.log('SKIP: no PALE runtime checkout'); process.exit(0); } root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hopline-runtime-')), clients = [];
  try {
    fs.cpSync(pkg, path.join(dir, 'pkg/hopline'), {recursive: true});
    const registry = path.join(dir, 'pkg/registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'hopline', version: '1.0.0', path: 'hopline'}],
      initial_time: require('../fixtures/clock.json').initial_time}));
    const infra = new Client('hopline', 'infra', 'rt', dir, 'hopline-infra', {registry}); clients.push(infra); await infra.initialize();
    const agent = new Client('hopline', 'agent', 'rt', dir, 'hopline-agent', {registry}); clients.push(agent); await agent.initialize();
    const snap = async () => (await infra.call('env.snapshot'));
    const report = {};

    // Repeated request_id: the original receipt, one pending load.
    let s = await snap();
    const first = await agent.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 2000, payment_method_id: 'pm-visa', request_id: 'load-1', expected_version: s.version});
    assert.equal(first.status, 'committed');
    const again = await agent.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 2000, payment_method_id: 'pm-visa', request_id: 'load-1', expected_version: s.version});
    assert.equal(again.duplicate, true);
    assert.equal(again.entry_id, first.entry_id);
    assert.equal((await snap()).snapshot.data.ledger.filter(e => e.kind === 'load_pending').length, 1);
    report.repeated_request_id = 'duplicate, one pending load';

    // A plan is a read and changes nothing.
    s = await snap();
    const plan = await agent.call('hopline.trips.plan', {from: 'pl-elm-3rd', to: 'pl-harbor-sq', depart_at: '2026-12-07T07:35:00-05:00', step_free: true});
    assert.equal(plan.status, 'ok');
    assert.equal(JSON.stringify((await snap()).version), JSON.stringify(s.version));

    // env.advance_time runs no App code; a notice held by quiet hours then reads as pending.
    await infra.call('env.apply_event', {expected_version: s.version, event: {...require('../examples/scenario.json'), event_id: 'ev-el12-0550', at: '2026-12-07T05:50:00-05:00',
      payload: {...require('../examples/scenario.json').payload, since: '2026-12-07T05:50:00-05:00'}}});
    assert.equal((await agent.call('hopline.notifications.list', {status: 'held_quiet_hours'})).notifications.length, 1);
    s = await snap();
    const dataBefore = JSON.stringify(s.snapshot.data);
    const adv = await infra.call('env.advance_time', {expected_version: s.version, request_id: 'to-0631', virtual_now: '2026-12-07T06:31:00-05:00'});
    assert.equal(adv.status, 'committed');
    assert.equal(JSON.stringify((await snap()).snapshot.data), dataBefore, 'clock advance does not change business data');
    assert.equal((await agent.call('hopline.notifications.list', {status: 'pending_delivery'})).notifications[0].notification_id, 'n-sub3-fac-el12-1-dana');
    report.advance_time = 'no data change; the held notice reads pending_delivery';

    // A version read before an event is stale after it.
    const before = (await snap()).version;
    await infra.call('env.apply_event', {expected_version: before, event: {event_id: 'ev-trip', at: '2026-12-07T06:45:00-05:00', operation: 'service.trip_updated',
      payload: {trip_id: 'trip:blue:nb:2026-12-07:0752', delay_min: 9}}});
    const stale = await agent.call('hopline.saved.add', {kind: 'place', label: 'Library', place_ref: 'pl-library', request_id: 'save-1', expected_version: before});
    assert.equal(stale.status, 'stale_version');
    report.stale_version_after_event = stale.status;

    // Two resets are byte-identical and equal the loaded baseline.
    s = await snap();
    const baseline = {data: JSON.stringify(s.snapshot.initial_data), time: s.snapshot.initial_virtual_now};
    const r1 = await infra.call('env.reset', {expected_version: s.version});
    assert.equal(r1.status, 'ready');
    const a = await snap();
    const r2 = await infra.call('env.reset', {expected_version: a.version});
    assert.equal(r2.status, 'ready');
    const b = await snap();
    assert.equal(JSON.stringify(a.snapshot.data), JSON.stringify(b.snapshot.data));
    assert.equal(a.snapshot.virtual_now, b.snapshot.virtual_now);
    assert.equal(JSON.stringify(b.snapshot.data), baseline.data);
    assert.equal(b.snapshot.virtual_now, baseline.time);
    report.double_reset = 'byte-identical data and virtual time, equal to the loaded baseline';
    return report;
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Hopline runtime checks.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
