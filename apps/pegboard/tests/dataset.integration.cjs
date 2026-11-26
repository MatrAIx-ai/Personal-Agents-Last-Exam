#!/usr/bin/env node
'use strict';
// Loads the full-window evaluation dataset (datasets/full-window) into the public reference
// runtime and reads it back through the App's MCP tools, so that the coverage report counts
// data an Agent can actually reach:
//   - Infra env.load_seed with the dataset clock as virtual_now, and the size of that request
//     against Core's 2 MiB limit for one MCP message;
//   - every month of 2025-01..2026-12 through pegboard.shifts.list (all shifts and Noor's),
//     compared with datasets/full-window/coverage.json;
//   - both ends of the window, the future posted weeks, the handoff, time-off and notification
//     lists, weekly hours, availability, preferences and the team;
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
const A = 'pegboard.', TZ = 'America/Los_Angeles', LIMIT = 2 * 1024 * 1024;
const local = (date, hhmm = '00:00') => isoAt(localToInstant(date, hhmm, TZ), TZ);
const tally = list => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[x] = (o[x] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));

async function main() {
  const bytes = fs.readFileSync(path.join(dir, 'seed.json')), seed = JSON.parse(bytes);
  const clock = JSON.parse(fs.readFileSync(path.join(dir, 'clock.json'), 'utf8')).initial_time;
  const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8')), coverage = JSON.parse(fs.readFileSync(path.join(dir, 'coverage.json'), 'utf8'));
  const prepared = prepare(appDir), clients = [], checks = [], started = Date.now(), monthly = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const client = async role => { const c = new Client(prepared.app, role, 'dataset', path.join(prepared.root, 'state'), 'pegboard-dataset', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
  try {
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    equal('coverage.json counts this seed.json (same SHA-256 and size)', [coverage.dataset.files['seed.json'].sha256, coverage.dataset.files['seed.json'].bytes], [sha, bytes.length]);
    const infra = await client('infra'), agent = await client('agent');
    const snap = async () => infra.call('env.snapshot');
    const version = async () => (await snap()).version;
    const read = async (name, args = {}) => { const r = await agent.call(A + name, args); assert.equal(r.status, 'ok', name + ' ' + JSON.stringify(r).slice(0, 300)); return r; };
    const all = async (name, args, key, limit) => { const out = []; let cursor; do { const r = await read(name, { ...args, limit, ...(cursor ? { cursor } : {}) }); out.push(...r[key]); cursor = r.next_cursor; } while (cursor); return out; };

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
      const shifts = await all('shifts.list', { start: local(first), end: local(next) }, 'shifts', 200);
      const mine = await all('shifts.list', { start: local(first), end: local(next), mine: true }, 'shifts', 200);
      monthly.push({ month: m.month, shifts: shifts.length, dates: new Set(shifts.map(s => s.start.slice(0, 10))).size, account_shifts: mine.length });
    }
    equal('pegboard.shifts.list returns, month by month, the shifts the coverage report counts', monthly.map(m => [m.month, m.shifts, m.account_shifts]), coverage.monthly.map(m => [m.month, m.shifts_worked, m.account_shifts_worked]));
    check('shifts are on every open day of the window', monthly.reduce((n, m) => n + m.dates, 0) === coverage.families.shifts_worked.distinct_dates);
    const firstDay = await all('shifts.list', { start: local('2025-01-01'), end: local('2025-01-03') }, 'shifts', 200), lastDay = await all('shifts.list', { start: local('2026-12-31'), end: local('2027-01-01') }, 'shifts', 200);
    check('the first open day of the window (2025-01-02) has its shifts; New Year\'s Day has none', firstDay.length > 0 && firstDay.every(s => s.start.startsWith('2025-01-02')));
    check('the last day of the window has its shifts, all started before the clock', lastDay.length > 0 && lastDay.every(s => s.start < clock));

    // Future posted weeks: listed, and later than the clock.
    const future = await all('shifts.list', { start: local('2027-01-01'), end: local('2027-02-01'), include_cancelled: true }, 'shifts', 200);
    equal('the posted future weeks are readable and match the coverage report', [future.length, new Set(future.map(s => s.start.slice(0, 10))).size, future.filter(s => s.is_mine).length], [coverage.future_posted_shifts.shifts, coverage.future_posted_shifts.distinct_dates, coverage.future_posted_shifts.account_shifts]);

    // Handoffs, time off, notifications: totals and states at the clock.
    const handoffs = await all('handoffs.list', { include_closed: true }, 'handoffs', 100);
    equal('every handoff is listed, with the states the coverage report gives at the clock', [handoffs.length, tally(handoffs.map(h => h.state))], [seed.handoffs.length, coverage.states_at_clock.handoffs]);
    const oldest = handoffs.at(-1), detail = (await read('handoffs.get', { id: oldest.id })).handoff;
    check('the oldest handoff (' + oldest.id + ', ' + oldest.created_at.slice(0, 10) + ') reads back with its history', detail.created_at.startsWith('2025-01') && detail.history.length === seed.handoffs.find(h => h.id === oldest.id).history.length);
    const timeOff = (await read('time_off.list', { include_closed: true })).time_off;
    equal('every time-off entry is listed, with its state at the clock', [timeOff.length, tally(timeOff.map(t => t.state))], [seed.time_off.length, coverage.states_at_clock.time_off]);
    const notes = await all('notifications.list', {}, 'notifications', 100);
    equal('every notification is listed, by kind', [notes.length, tally(notes.map(n => n.kind))], [seed.notifications.length, coverage.states_at_clock.notifications_by_kind]);
    const early = await all('notifications.list', { since: local('2025-01-01') }, 'notifications', 100);
    check('notifications from before the window are there but outside it', notes.length - early.length === coverage.families.notifications.excluded.before_window);

    // Hours at both ends, the account's settings and the team.
    const hours2025 = (await read('hours.summary', { start: local('2025-01-06'), end: local('2025-02-03') })).weeks, hours2026 = (await read('hours.summary', { start: local('2026-12-07'), end: local('2027-01-04') })).weeks;
    check('weekly hours read for January 2025 and December 2026', hours2025.length === 4 && hours2026.length === 4 && [...hours2025, ...hours2026].every(w => w.scheduled_hours > 0 && w.posted_at !== null));
    const team = (await read('team.list')).people, prefs = (await read('preferences.get')).preferences, blocks = (await read('availability.get')).blocks;
    equal('the team, preferences and availability are the dataset\'s', [team.length, prefs.timezone, prefs.email_notices, blocks.length], [seed.people.length, TZ, seed.preferences.email_notices, seed.availability.length]);

    // One write on the loaded data under the sandbox profile, then reset to the loaded baseline.
    const ask = handoffs.find(h => h.state === 'awaiting_me');
    check('a coworker request waits for Noor at the clock', !!ask);
    check('reset to the sandbox profile keeps the loaded data and clock', (await infra.call('env.reset', { expected_version: await version(), profile: 'sandbox' })).status === 'ready' && (await snap()).snapshot.virtual_now === clock);
    const before = await version(), answer = await agent.call(A + 'handoffs.respond', { id: ask.id, answer: 'decline', message: 'Sorry, I am away that week.', request_id: 'dataset-write', expected_version: before });
    const written = (await snap());
    check('Noor answers it through MCP: committed, one revision later, stored with its history row', answer.status === 'committed' && written.version.revision === before.revision + 1 && written.snapshot.data.handoffs.find(h => h.id === ask.id).history.at(-1).action === 'declined');
    check('reset returns to the loaded dataset and clock', (await infra.call('env.reset', { expected_version: await version() })).status === 'ready' && JSON.stringify((await snap()).snapshot.data) === JSON.stringify(seed) && (await snap()).snapshot.virtual_now === clock);

    const report = {
      schema: 'pegboard.dataset-integration.v1', app_version: require('../app.json').version, runtime_version: runtime.version, node: process.version,
      dataset: { dataset_id: dataset.dataset_id, version: dataset.version, seed_sha256: sha, seed_bytes: bytes.length, records: loaded.loaded, clock },
      load_request_bytes: requestBytes, mcp_message_limit_bytes: LIMIT, monthly, checks: checks.length, passed: true, duration_ms: Date.now() - started, names: checks,
    };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' dataset checks for pegboard ' + report.app_version + ' on runtime ' + report.runtime_version + ': ' + loaded.loaded + ' records loaded with clock ' + clock + ' (' + requestBytes + ' byte request), ' + monthly.length + ' months read back (' + report.duration_ms + ' ms).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
