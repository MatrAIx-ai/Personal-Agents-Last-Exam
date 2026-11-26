#!/usr/bin/env node
'use strict';
// Loads the full-window evaluation dataset (datasets/full-window) into the public reference
// runtime and reads it back through the App's MCP tools, so that the coverage report counts
// data an Agent can actually reach:
//   - Infra env.load_seed with the dataset clock as virtual_now, and the size of that request
//     against Core's 2 MiB limit for one MCP message;
//   - every place's forecast issuances through rainshadow.forecast.issuances, month by month
//     against datasets/full-window/coverage.json, and a daily air-quality read for a smoke week;
//   - every alert thread through rainshadow.alerts.list, with its messages and states; the
//     account's watches, notices (month by month) and saved places; the newest observations;
//   - one write on the loaded data, and reset back to the loaded data and clock.
//
//   node tests/dataset.integration.cjs --runtime DIR [--report FILE]
//
// DIR is the `runtime` directory of a public PALE checkout. Nothing else outside this package is read.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..'), dir = path.join(appDir, 'datasets/full-window');
const { localDate, isoAt, localToInstant } = require('../src/util.cjs');

function options() {
  const out = { runtime: process.env.PALE_RUNTIME_ROOT };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--runtime', '--report'].includes(key) || !value) return null;
    out[key.slice(2)] = value;
  }
  return out.runtime ? out : null;
}
function runtimeAt(dirName) {
  const root = path.resolve(dirName);
  try { const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); return pkg.name === '@pale/app-runtime' ? { root, version: pkg.version } : null; } catch { return null; }
}
const opts = options(), runtime = opts && runtimeAt(opts.runtime);
if (!runtime) {
  console.error('Usage: node tests/dataset.integration.cjs --runtime DIR [--report FILE]\nDIR must be the runtime directory of a public PALE checkout (package @pale/app-runtime).');
  process.exit(2);
}
const { prepare } = require(path.join(runtime.root, 'prepare.cjs')), { Client } = require(path.join(runtime.root, 'client.cjs'));
const A = 'rainshadow.', TZ = 'America/Denver', LIMIT = 2 * 1024 * 1024;
const monthOf = value => localDate(Date.parse(value), TZ).slice(0, 7);
const tally = list => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[x] = (o[x] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));

async function main() {
  const bytes = fs.readFileSync(path.join(dir, 'seed.json')), seed = JSON.parse(bytes);
  const clock = JSON.parse(fs.readFileSync(path.join(dir, 'clock.json'), 'utf8')).initial_time;
  const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8')), coverage = JSON.parse(fs.readFileSync(path.join(dir, 'coverage.json'), 'utf8'));
  const prepared = prepare(appDir), clients = [], checks = [], started = Date.now();
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const client = async role => { const c = new Client(prepared.app, role, 'dataset', path.join(prepared.root, 'state'), 'rainshadow-dataset', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
  try {
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    equal('coverage.json counts this seed.json (same SHA-256 and size)', [coverage.dataset.files['seed.json'].sha256, coverage.dataset.files['seed.json'].bytes], [sha, bytes.length]);
    const infra = await client('infra'), agent = await client('agent');
    const snap = async () => infra.call('env.snapshot');
    const version = async () => (await snap()).version;
    const read = async (name, args = {}) => { const r = await agent.call(A + name, args); assert.equal(r.status, 'ok', name + ' ' + JSON.stringify(r).slice(0, 300)); return r; };
    const all = async (name, args, key) => { const out = []; let cursor; do { const r = await read(name, { ...args, limit: 100, ...(cursor ? { cursor } : {}) }); out.push(...r[key]); cursor = r.next_cursor; } while (cursor); return out; };

    // Load through Infra, with the dataset's own clock.
    const args = { expected_version: await version(), data: seed, virtual_now: clock, request_id: 'full-window' };
    const requestBytes = Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'env.load_seed', arguments: args } }));
    check('the env.load_seed request (' + requestBytes + ' bytes) fits in one MCP message (' + LIMIT + ' bytes)', requestBytes < LIMIT);
    const loaded = await infra.call('env.load_seed', args);
    equal('Infra loads the dataset with its clock: every record', [loaded.status, loaded.loaded], ['ready', dataset.expected_counts.records]);
    const after = (await snap()).snapshot;
    equal('the loaded data and clock are the baseline', [after.virtual_now, after.initial_virtual_now, JSON.stringify(after.data) === JSON.stringify(seed)], [clock, clock, true]);

    // Every place's issuances, month by month.
    // places.list holds the saved places; every place is found by searching the two regions.
    const saved = (await read('places.list')).places, places = [], issuances = [];
    for (const query of ['Quillmere County', 'Saltgrass Coast']) for (const p of (await read('places.search', { query, limit: 50 })).places) if (!places.some(x => x.id === p.id)) places.push(p);
    equal('the two regions hold the six places', places.length, seed.places.length);
    for (const p of places) issuances.push(...await all('forecast.issuances', { id: p.id }, 'issuances'));
    equal('rainshadow.forecast.issuances returns every issuance of every place', issuances.length, seed.issuances.length);
    const byMonth = kind => coverage.monthly.map(m => [m.month, issuances.filter(i => i.kind === kind && monthOf(i.issued_at) === m.month).length]);
    equal('month by month, the weather and air-quality issuances the coverage report counts', [byMonth('weather'), byMonth('air_quality')], [coverage.monthly.map(m => [m.month, m.weather_issuances]), coverage.monthly.map(m => [m.month, m.air_quality_issuances])]);
    const first = issuances.filter(i => i.issued_at.slice(0, 10) <= '2025-01-31').length, last = issuances.filter(i => i.issued_at.startsWith('2026-12-31')).length;
    check('issuances at both ends of the window (January 2025: ' + first + '; 31 December 2026: ' + last + ')', first > 0 && last > 0);
    // A past issuance is read by its ID: the outlook issued on Monday 15 September 2025, during the smoke.
    const outlook = issuances.find(i => i.id === 'aq-marrow-20250915-10'), smoke = (await read('forecast.daily', { id: 'pl-marrowby', issuance_id: outlook.id, start: '2025-09-17T00:00:00-07:00', end: '2025-09-21T00:00:00-07:00' })).rows;
    check('the Marrowby outlook of 15 September 2025 reads back and forecasts unhealthy smoke for the 17th to the 20th', smoke.length === 4 && smoke.some(d => d.aqi > 100));

    // Every alert thread, through the places it covers.
    const threads = new Map();
    for (const p of places) for (const a of (await read('alerts.list', { id: p.id, start: '2024-12-01T00:00:00-07:00', end: '2027-02-01T00:00:00-07:00', include_closed: true })).alerts) threads.set(a.id, a);
    equal('rainshadow.alerts.list returns every alert thread, with every message and its state at the clock', [threads.size, [...threads.values()].reduce((n, a) => n + a.message_count, 0), tally([...threads.values()].map(a => a.status))],
      [seed.alerts.length, seed.alerts.reduce((n, a) => n + a.messages.length, 0), coverage.states_at_clock.alerts]);
    const acked = seed.acknowledgements[0], alert = (await read('alerts.get', { id: acked.alert_id })).alert;
    check('an acknowledged alert (' + acked.alert_id + ') reads back with its acknowledgement', alert.acknowledgements.some(a => a.message_id === acked.message_id && a.acknowledged_at === acked.acknowledged_at));

    // The account's own records.
    const watches = (await read('watches.list', { include_closed: true })).watches;
    equal('every watch is listed, with its state at the clock', [watches.length, tally(watches.map(w => w.status))], [seed.watches.length, coverage.states_at_clock.watches]);
    const notices = await all('notices.list', {}, 'notices');
    equal('month by month, the notices the coverage report counts', coverage.monthly.map(m => [m.month, notices.filter(n => monthOf(n.created_at) === m.month).length]), coverage.monthly.map(m => [m.month, m.notices]));
    equal('the saved places at the clock', saved.map(p => p.label).sort(), coverage.states_at_clock.saved_places.slice().sort());
    const newest = await read('conditions.get', { id: 'pl-cinderhorn-pass' });
    check('the newest observation at Cinderhorn Pass is the last day\'s', newest.observation && newest.observation.observed_at.startsWith('2026-12-31'));

    // One write on the loaded data under the sandbox profile, then reset to the loaded baseline.
    const open = watches.find(w => w.status !== 'cancelled' && Date.parse(w.end) > Date.parse(clock));
    check('a watch for New Year\'s Day is still open at the clock', !!open && open.label.includes('New Year'));
    check('reset to the sandbox profile keeps the loaded data and clock', (await infra.call('env.reset', { expected_version: await version(), profile: 'sandbox' })).status === 'ready' && (await snap()).snapshot.virtual_now === clock);
    const before = await version(), moved = await agent.call(A + 'watches.update', { id: open.id, patch: { label: 'Drive up after the storm' }, request_id: 'dataset-write', expected_version: before });
    const written = await snap();
    check('the account holder renames it through MCP: committed, one revision later, stored', moved.status === 'committed' && written.version.revision === before.revision + 1 && written.snapshot.data.watches.find(w => w.id === open.id).label === 'Drive up after the storm');
    check('reset returns to the loaded dataset and clock', (await infra.call('env.reset', { expected_version: await version() })).status === 'ready' && JSON.stringify((await snap()).snapshot.data) === JSON.stringify(seed) && (await snap()).snapshot.virtual_now === clock);

    const report = {
      schema: 'rainshadow.dataset-integration.v1', app_version: require('../app.json').version, runtime_version: runtime.version, node: process.version,
      dataset: { dataset_id: dataset.dataset_id, version: dataset.version, seed_sha256: sha, seed_bytes: bytes.length, records: loaded.loaded, clock },
      load_request_bytes: requestBytes, mcp_message_limit_bytes: LIMIT, issuances: issuances.length, alert_threads: threads.size, notices: notices.length, checks: checks.length, passed: true, duration_ms: Date.now() - started, names: checks,
    };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' dataset checks for rainshadow ' + report.app_version + ' on runtime ' + report.runtime_version + ': ' + loaded.loaded + ' records loaded with clock ' + clock + ' (' + requestBytes + ' byte request) (' + report.duration_ms + ' ms).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
