'use strict';
// Runtime checks through real MCP processes (needs the public PALE checkout):
//   node apps/homegrid/tests/runtime.integration.cjs
// A repeated request_id returns the original order; a write with a version taken before an event is stale_version;
// env.advance_time moves the clock without running App code (a held notice then reads as pending, and a
// due order reads as effective); two resets give byte-identical data and virtual time, equal to the baseline.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) { console.log('SKIP: no PALE runtime checkout'); process.exit(0); } root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homegrid-runtime-')), clients = [];
  try {
    fs.cpSync(pkg, path.join(dir, 'pkg/homegrid'), {recursive: true});
    const registry = path.join(dir, 'pkg/registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'homegrid', version: '1.0.0', path: 'homegrid'}],
      initial_time: require('../fixtures/clock.json').initial_time}));
    const infra = new Client('homegrid', 'infra', 'rt', dir, 'homegrid-infra', {registry}); clients.push(infra); await infra.initialize();
    const agent = new Client('homegrid', 'agent', 'rt', dir, 'homegrid-agent', {registry}); clients.push(agent); await agent.initialize();
    const snap = async () => (await infra.call('env.snapshot'));
    const report = {};

    // Repeated request_id: the original receipt, one set of orders.
    let s = await snap();
    const preview = await agent.call('homegrid.orders.preview', {type: 'transfer', from_premise_id: 'pr-maple-22', to_premise_id: 'pr-linden-14',
      stop_date: '2027-01-15', start_date: '2027-01-15'});
    assert.equal(preview.status, 'ok');
    assert.equal(JSON.stringify((await snap()).version), JSON.stringify(s.version), 'a preview changes nothing');
    const first = await agent.call('homegrid.orders.create', {order_token: preview.order_token, request_id: 'move-1', expected_version: s.version});
    assert.equal(first.status, 'committed');
    const again = await agent.call('homegrid.orders.create', {order_token: preview.order_token, request_id: 'move-1', expected_version: s.version});
    assert.equal(again.duplicate, true);
    assert.deepEqual(again.order_ids, first.order_ids);
    assert.equal((await snap()).snapshot.data.orders.length, 6);
    report.repeated_request_id = 'duplicate, the original 6 orders';

    // A version read before an event is stale after it.
    const before = (await snap()).version;
    const applied = await infra.call('env.apply_event', {expected_version: before, event: require('../examples/scenario.json')});
    assert.equal(applied.status, 'committed');
    const stale = await agent.call('homegrid.notifications.acknowledge', {notification_id: 'n-tr-1-0-sam', request_id: 'ack-1', expected_version: before});
    assert.equal(stale.status, 'stale_version');
    report.stale_version_after_event = stale.status;

    // env.advance_time runs no App code; derived statuses read correctly afterwards.
    s = await snap();
    await infra.call('env.apply_event', {expected_version: s.version, event: {event_id: 'ev-out-1', at: '2027-01-13T23:30:00-05:00', operation: 'grid.outage_updated',
      payload: {outage_id: 'out-1', service: 'electricity', status: 'started', premise_ids: ['pr-maple-22'], etr: '2027-01-14T03:00:00-05:00'}}});
    assert.equal((await agent.call('homegrid.notifications.list', {status: 'held_quiet_hours'})).notifications.length, 1);
    s = await snap();
    const dataBefore = JSON.stringify(s.snapshot.data);
    const adv = await infra.call('env.advance_time', {expected_version: s.version, request_id: 'to-0700', virtual_now: '2027-01-16T07:00:00-05:00'});
    assert.equal(adv.status, 'committed');
    assert.equal(JSON.stringify((await snap()).snapshot.data), dataBefore, 'clock advance does not change business data');
    assert.ok((await agent.call('homegrid.notifications.list', {status: 'pending_delivery'})).notifications.some(n => n.source.id === 'out-1'));
    const orders = (await agent.call('homegrid.orders.list', {premise_id: 'pr-linden-14'})).orders;
    assert.equal(orders.find(o => o.service_type === 'water').status, 'effective');
    report.advance_time = 'no data change; held notice reads pending_delivery; the Jan 15 start reads effective';

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
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Homegrid runtime checks.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
