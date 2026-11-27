'use strict';
// Runtime checks through real MCP processes (needs the public PALE checkout):
//   node apps/curbline/tests/runtime.integration.cjs
// A repeated request_id returns the original booking with one hold; a write with a version taken before
// an event is stale_version; env.advance_time runs no App code (a needs_attention booking then reads as
// lapsed while the snapshot is unchanged); two resets give byte-identical business data and virtual time.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) { console.log('SKIP: no PALE runtime checkout'); process.exit(0); } root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {airportRide, flightStatus} = require('./helpers.cjs');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curbline-runtime-')), clients = [];
  try {
    fs.cpSync(pkg, path.join(dir, 'pkg/curbline'), {recursive: true});
    const registry = path.join(dir, 'pkg/registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'curbline', version: '1.0.0', path: 'curbline'}], initial_time: '2026-12-03T19:00:00-05:00'}));
    const infra = new Client('curbline', 'infra', 'rt', dir, 'curbline-infra', {registry}); clients.push(infra); await infra.initialize();
    const agent = new Client('curbline', 'agent', 'rt', dir, 'curbline-agent', {registry}); clients.push(agent); await agent.initialize();
    const snap = async () => (await infra.call('env.snapshot'));
    const report = {};

    // Repeated request_id: the original booking and one hold.
    let s = await snap();
    const q = (await agent.call('curbline.rides.quote', airportRide())).quote;
    const args = {quote_token: q.quote_token, payment_method_id: 'pm-work', request_id: 'book-pa218', expected_version: s.version};
    const first = await agent.call('curbline.bookings.create', args);
    assert.equal(first.status, 'committed', JSON.stringify(first));
    const again = await agent.call('curbline.bookings.create', args);
    assert.equal(again.duplicate, true);
    assert.equal(again.booking_id, first.booking_id);
    const data = (await snap()).snapshot.data;
    assert.equal(data.bookings.length, 7);
    assert.equal(data.ledger.filter(e => e.booking_id === 'bk-7' && e.type === 'hold').length, 1);
    report.repeated_request_id = 'duplicate: bk-7 once, one hold';

    // A version read before an event is stale after it.
    const before = (await snap()).version;
    const applied = await infra.call('env.apply_event', {expected_version: before, event: flightStatus('2026-12-03T19:40:00-05:00', 'delayed', '2026-12-04T07:30:00-05:00')});
    assert.equal(applied.status, 'committed', JSON.stringify(applied));
    const stale = await agent.call('curbline.bookings.confirm_adjustment', {booking_id: 'bk-7', request_id: 'confirm-1', expected_version: before});
    assert.equal(stale.status, 'stale_version');
    report.stale_version_after_event = stale.status;

    // env.advance_time runs no App code; the lapse is derived on reads.
    s = await snap();
    const dataBefore = JSON.stringify(s.snapshot.data);
    const adv = await infra.call('env.advance_time', {expected_version: s.version, request_id: 'to-0750', virtual_now: '2026-12-04T07:50:00-05:00'});
    assert.equal(adv.status, 'committed', JSON.stringify(adv));
    assert.equal(JSON.stringify((await snap()).snapshot.data), dataBefore, 'clock advance does not change business data');
    const read = await agent.call('curbline.bookings.get', {booking_id: 'bk-7'});
    assert.equal(read.booking.status, 'lapsed');
    assert.equal((await snap()).snapshot.data.bookings.find(b => b.booking_id === 'bk-7').status, 'needs_attention');
    report.advance_time = 'no data change; bk-7 reads lapsed, snapshot keeps needs_attention until the next commit';

    // Two resets are byte-identical and equal the loaded baseline.
    s = await snap();
    const baseline = {data: JSON.stringify(s.snapshot.initial_data), time: s.snapshot.initial_virtual_now};
    assert.equal((await infra.call('env.reset', {expected_version: s.version})).status, 'ready');
    const a = await snap();
    assert.equal((await infra.call('env.reset', {expected_version: a.version})).status, 'ready');
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
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Curbline runtime checks.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
