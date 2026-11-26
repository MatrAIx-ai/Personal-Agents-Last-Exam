#!/usr/bin/env node
'use strict';
// Loads the full-window evaluation dataset (datasets/full-window) into the public reference
// runtime and reads it back through the App's MCP tools, so that the coverage report counts
// data an Agent can actually reach:
//   - Infra env.load_seed with the dataset clock as virtual_now, and the size of that request
//     against Core's 2 MiB limit for one MCP message;
//   - every month of 2025-01..2026-12 through belltower.items.list (new items and all
//     revisions received in the month), compared with datasets/full-window/coverage.json;
//   - both ends of the window, a corrected item with its revisions and the copies that name it,
//     read marks, clippings, follow rules, notifications, sources and preferences;
//   - one write on the loaded data, and reset back to the loaded data and clock.
//
//   node tests/dataset.integration.cjs --runtime DIR [--report FILE]
//
// DIR is the `runtime` directory of a public PALE checkout. Nothing else outside this package is read.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..'), dir = path.join(appDir, 'datasets/full-window');
const { localToInstant, isoAt, addDays } = require('../src/util.cjs');

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
const A = 'belltower.', TZ = 'America/Chicago', LIMIT = 2 * 1024 * 1024;
const local = (date, hhmm = '00:00') => isoAt(localToInstant(date, hhmm, TZ), TZ);
const tally = list => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[x] = (o[x] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));

async function main() {
  const bytes = fs.readFileSync(path.join(dir, 'seed.json')), seed = JSON.parse(bytes);
  const clock = JSON.parse(fs.readFileSync(path.join(dir, 'clock.json'), 'utf8')).initial_time;
  const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8')), coverage = JSON.parse(fs.readFileSync(path.join(dir, 'coverage.json'), 'utf8'));
  const prepared = prepare(appDir), clients = [], checks = [], started = Date.now(), monthly = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const client = async role => { const c = new Client(prepared.app, role, 'dataset', path.join(prepared.root, 'state'), 'belltower-dataset', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
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

    // Every month of the window, through the Agent's read tool, against the coverage report.
    for (const m of coverage.monthly) {
      const first = m.month + '-01', next = addDays(first, 32).slice(0, 8) + '01';
      const items = await all('items.list', { start: local(first), end: local(next) }, 'items');
      monthly.push({ month: m.month, items: items.length, new_items: items.filter(i => i.matched_revisions.includes(1)).length, revisions: items.reduce((n, i) => n + i.matched_revisions.length, 0) });
    }
    equal('belltower.items.list returns, month by month, the new items and revisions the coverage report counts', monthly.map(m => [m.month, m.new_items, m.revisions]),
      coverage.monthly.map(m => [m.month, m.publications, m.publications + m.updates + m.corrections + m.retractions]));
    const first = await all('items.list', { start: local('2025-01-01'), end: local('2025-01-02') }, 'items'), last = await all('items.list', { start: local('2026-12-31'), end: local('2027-01-01') }, 'items');
    check('the first and the last day of the window have items, received before the clock', first.length > 0 && last.length > 0 && last.every(i => i.received_at <= clock));
    check('nothing was received after the clock', (await read('items.list', { start: clock })).items.length === 0);

    // A corrected item: every revision, and the copies and reports that name it.
    const corrected = seed.items.find(i => i.revisions.some(r => r.type === 'correction') && seed.items.some(c => c.revisions.some(r => r.based_on && r.based_on.item_id === i.id)));
    const item = (await read('items.get', { id: corrected.id })).item, earlier = (await read('items.get', { id: corrected.id, revision: 1 })).item;
    check('a corrected item (' + corrected.id + ') reads back with every revision, its earlier text and the items that name it',
      item.status === 'corrected' && item.revisions.length === corrected.revisions.length && earlier.body === corrected.revisions[0].body && item.referenced_by.length === seed.items.filter(c => c.revisions.some(r => r.based_on && r.based_on.item_id === corrected.id)).length);
    const statuses = tally((await all('items.list', {}, 'items')).map(i => i.status));
    equal('every item is listed, with the statuses the coverage report gives', statuses, coverage.states_at_clock.items_by_status);
    const sources = (await read('sources.list')).sources;
    equal('each source has the items the coverage report gives', Object.fromEntries(sources.map(s => [s.id, s.items]).sort(([a], [b]) => (a < b ? -1 : 1))), coverage.states_at_clock.items_by_source);

    // The account's own records.
    const marks = await all('reading.list', {}, 'marks');
    equal('every read mark is listed', marks.length, seed.read_marks.length);
    const clippings = (await read('clippings.list')).clippings, follows = (await read('follows.list')).follows;
    equal('the clippings and follow rules at the clock', [clippings.length, follows.length], [seed.clippings.length, seed.follows.length]);
    const notes = await all('notifications.list', {}, 'notifications');
    equal('every notification is listed, by state at the clock', [notes.length, tally(notes.map(n => n.state))], [seed.notifications.length, coverage.states_at_clock.notifications]);
    const prefs = (await read('preferences.get')).preferences;
    equal('the preferences are the dataset\'s', [prefs.timezone, prefs.digest_time, prefs.corrections, prefs.email_notices], [TZ, seed.preferences.digest_time, seed.preferences.corrections, seed.preferences.email_notices]);

    // One write on the loaded data under the sandbox profile, then reset to the loaded baseline.
    const unread = seed.items.find(i => !seed.read_marks.some(m => m.item_id === i.id) && i.revisions.at(-1).received_at.startsWith('2026-12'));
    check('reset to the sandbox profile keeps the loaded data and clock', (await infra.call('env.reset', { expected_version: await version(), profile: 'sandbox' })).status === 'ready' && (await snap()).snapshot.virtual_now === clock);
    const before = await version(), marked = await agent.call(A + 'reading.mark', { id: unread.id, request_id: 'dataset-write', expected_version: before });
    const written = await snap();
    check('Dana marks a December 2026 item as read through MCP: committed, one revision later, stored', marked.status === 'committed' && written.version.revision === before.revision + 1 && written.snapshot.data.read_marks.some(m => m.item_id === unread.id && m.read_at === clock));
    check('reset returns to the loaded dataset and clock', (await infra.call('env.reset', { expected_version: await version() })).status === 'ready' && JSON.stringify((await snap()).snapshot.data) === JSON.stringify(seed) && (await snap()).snapshot.virtual_now === clock);

    const report = {
      schema: 'belltower.dataset-integration.v1', app_version: require('../app.json').version, runtime_version: runtime.version, node: process.version,
      dataset: { dataset_id: dataset.dataset_id, version: dataset.version, seed_sha256: sha, seed_bytes: bytes.length, records: loaded.loaded, clock },
      load_request_bytes: requestBytes, mcp_message_limit_bytes: LIMIT, monthly, checks: checks.length, passed: true, duration_ms: Date.now() - started, names: checks,
    };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' dataset checks for belltower ' + report.app_version + ' on runtime ' + report.runtime_version + ': ' + loaded.loaded + ' records loaded with clock ' + clock + ' (' + requestBytes + ' byte request), ' + monthly.length + ' months read back (' + report.duration_ms + ' ms).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
