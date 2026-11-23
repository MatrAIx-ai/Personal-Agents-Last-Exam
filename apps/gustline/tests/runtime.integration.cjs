'use strict';
// Runtime checks through real MCP processes (needs the public PALE checkout):
//   node apps/gustline/tests/runtime.integration.cjs
// A repeated request_id is a duplicate; a write with a version taken before an event is stale_version;
// two resets give byte-identical business data and virtual time, equal to the loaded baseline;
// env.advance_time moves the clock without running App code (a held notice then reads as pending).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) { console.log('SKIP: no PALE runtime checkout'); process.exit(0); } root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {issuance} = require('./helpers.cjs');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gustline-runtime-')), clients = [];
  try {
    fs.cpSync(pkg, path.join(dir, 'pkg/gustline'), {recursive: true});
    const registry = path.join(dir, 'pkg/registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'gustline', version: '1.0.0', path: 'gustline'}], initial_time: '2027-10-08T09:30:00-07:00'}));
    const infra = new Client('gustline', 'infra', 'rt', dir, 'gustline-infra', {registry}); clients.push(infra); await infra.initialize();
    const agent = new Client('gustline', 'agent', 'rt', dir, 'gustline-agent', {registry}); clients.push(agent); await agent.initialize();
    const snap = async () => (await infra.call('env.snapshot'));
    const report = {};

    // Repeated request_id.
    let s = await snap();
    const first = await agent.call('gustline.saved_places.add', {place_id: 'pl-dunes', label: 'Dunes', request_id: 'add-dunes', expected_version: s.version});
    assert.equal(first.status, 'committed');
    const again = await agent.call('gustline.saved_places.add', {place_id: 'pl-dunes', label: 'Dunes', request_id: 'add-dunes', expected_version: s.version});
    assert.equal(again.duplicate, true);
    assert.equal((await snap()).snapshot.data.saved_places.length, 3);
    report.repeated_request_id = 'duplicate, one saved place';

    // A version read before an event is stale after it.
    const before = (await snap()).version;
    const applied = await infra.call('env.apply_event', {expected_version: before, event: require('../examples/scenario.json')});
    assert.equal(applied.status, 'committed');
    const stale = await agent.call('gustline.rules.pause', {rule_id: 'rule-1', request_id: 'pause-1', expected_version: before});
    assert.equal(stale.status, 'stale_version');
    report.stale_version_after_event = stale.status;

    // env.advance_time runs no App code; derived release makes a held notice read as pending.
    s = await snap();
    await infra.call('env.apply_event', {expected_version: s.version, event: {event_id: 'ev-fc-2310', at: '2027-10-08T23:10:00-07:00',
      operation: 'weather.forecast_issued', payload: issuance({id: 'fc-2310', issued: '2027-10-08T23:00:00-07:00', gust: t => (t === Date.parse('2027-10-09T17:00:00-07:00') ? 62 : 20)})}});
    const heldBefore = (await agent.call('gustline.notifications.list', {status: 'held_quiet_hours'})).notifications.length;
    s = await snap();
    const dataBefore = JSON.stringify(s.snapshot.data);
    const adv = await infra.call('env.advance_time', {expected_version: s.version, request_id: 'to-0700', virtual_now: '2027-10-09T07:00:00-07:00'});
    assert.equal(adv.status, 'committed');
    assert.equal(JSON.stringify((await snap()).snapshot.data), dataBefore, 'clock advance does not change business data');
    const pending = (await agent.call('gustline.notifications.list', {status: 'pending_delivery'})).notifications;
    assert.equal(heldBefore, 1);
    assert.ok(pending.some(n => n.rule_id === 'rule-2'));
    report.advance_time = 'no data change; held notice now reads pending_delivery';

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
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Gustline runtime checks.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
