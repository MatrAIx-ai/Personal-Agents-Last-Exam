#!/usr/bin/env node
'use strict';
// Loads every evaluation seed into a real App instance with env.load_seed and reads it back with the Agent's MCP read tools.
// It checks that what the tools return matches data/evaluation/coverage.json: counts, dates and monthly totals.
// Usage: node tests/evaluation.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util'), crypto = require('node:crypto');
const records = require('../dev/evaluation-records.cjs');
const time = require('../src/time.cjs');

const DIR = path.resolve(__dirname, '..'), DATA = path.join(DIR, 'data/evaluation'), APP = 'alderbrook.', RUN = 'alderbrook-evaluation';
const SKIPPED = 77;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const checks = [];
function check(name, condition, got) {
  checks.push({name, status: condition ? 'passed' : 'failed'});
  if (!condition) throw new Error(name + (got === undefined ? '' : '\n  got: ' + JSON.stringify(got).slice(0, 2000)));
}
const equal = (name, actual, expected) => check(name, util.isDeepStrictEqual(actual, expected), {expected, actual});
function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--runtime', '--report'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node tests/evaluation.integration.cjs --runtime DIR [--report FILE]');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
// The first and the last instant of a month in the counting zone, as a window for the list tools. A window includes both ends.
function month(text) {
  const [y, m] = text.split('-').map(Number), next = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
  const start = time.startOfDay(text + '-01', records.ZONE), end = time.startOfDay(next, records.ZONE) - 1000;
  return {start: time.iso(start, records.ZONE), end: time.iso(end, records.ZONE)};
}
const counted = (rows, clock) => rows.filter(r => r.day && r.day >= records.WINDOW.start && r.day <= records.WINDOW.end && Date.parse(r.at) < Date.parse(clock));

async function run(runtime, prepared, clients) {
  const {Client} = require(path.join(runtime, 'client.cjs'));
  const open = async role => {
    const client = new Client(prepared.app, role, RUN, path.join(prepared.root, 'state'), 'alderbrook-evaluation-load', {registry: prepared.registry});
    clients.push(client);
    await client.initialize();
    return client;
  };
  const infra = await open('infra'), agent = await open('agent');
  const manifest = read(path.join(DATA, 'manifest.json')), coverageText = fs.readFileSync(path.join(DATA, 'coverage.json')), coverage = JSON.parse(coverageText);
  const policies = read(path.join(DIR, 'fixtures/policies.json')), windows = coverage.monthly.map(m => [m.month, month(m.month)]);
  const allRows = [], perAccount = [], monthly = Object.fromEntries(windows.map(([m]) => [m, {claims_filed: 0, payments: 0}])), samples = {};
  const call = async (name, args = {}) => {
    const result = await agent.call(APP + name, args);
    if (result.status !== 'ok') throw new Error(name + ' failed: ' + JSON.stringify(result));
    return result;
  };
  for (const [index, entry] of manifest.accounts.entries()) {
    const seed = read(path.join(DATA, entry.seed)), binding = read(path.join(DATA, entry.binding));
    const before = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {expected_version: before.version, request_id: 'evaluation-' + (index + 1), data: seed, binding, policies, virtual_now: entry.virtual_now});
    check(entry.account_id + ': env.load_seed loads the seed with its binding and clock', loaded.status === 'ready' && loaded.loaded === seed.policies.length + seed.claims.length, loaded);
    const snapshot = (await infra.call('env.snapshot')).snapshot;
    check(entry.account_id + ': the snapshot holds the seed byte for byte, at the seed clock', JSON.stringify(snapshot.data) === JSON.stringify(seed) && snapshot.virtual_now === entry.virtual_now);
    const listed = (await call('policies.list')).items, claims = (await call('claims.list')).items;
    equal(entry.account_id + ': policies.list and claims.list return every policy term and claim', [listed.length, claims.map(c => [c.id, c.filed_at])],
      [seed.policies.length, [...seed.claims].sort((a, b) => Date.parse(a.filed_at) - Date.parse(b.filed_at) || a.id.localeCompare(b.id)).map(c => [c.id, c.filed_at])]);
    const views = [];
    for (const row of claims) views.push((await call('claims.get', {id: row.id})).claim);
    const rows = records.lifecycle(entry.account_id, views), counts = counted(rows, entry.virtual_now);
    allRows.push(...rows);
    const expected = coverage.per_account.find(a => a.account_id === entry.account_id);
    const days = [...new Set(counts.map(r => r.day))].sort();
    equal(entry.account_id + ': the lifecycle steps read through claims.get match the coverage report', {claims: views.length, lifecycle_steps: rows.length, counted_steps: counts.length, distinct_dates: days.length},
      {claims: expected.claims, lifecycle_steps: expected.lifecycle_steps, counted_steps: expected.counted_steps, distinct_dates: expected.distinct_dates});
    const payments = (await call('payments.list')).items, notifications = (await call('notifications.list')).items;
    equal(entry.account_id + ': payments.list and notifications.list return every record of the seed', [payments.length, notifications.length],
      [seed.claims.reduce((s, c) => s + c.payments.length, 0), seed.notifications.length]);
    for (const [name, w] of windows) {
      monthly[name].claims_filed += (await call('claims.list', w)).items.length;
      monthly[name].payments += (await call('payments.list', w)).items.length;
    }
    perAccount.push({account_id: entry.account_id, seed_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(DATA, entry.seed))).digest('hex'),
      loaded: loaded.loaded, policies: listed.length, claims: views.length, payments: payments.length, notifications: notifications.length, counted_steps: counts.length, distinct_dates: days.length});
    for (const view of views) {
      const key = view.path === 'total_loss' ? 'total_loss' : view.disputes.length ? 'disputed_repair' : view.coverage === 'personal_property' ? 'renters' : view.state === 'open' ? 'open_at_clock' : null;
      if (key && !samples[key]) {
        samples[key] = {account_id: entry.account_id, claim_id: view.id, coverage: view.coverage, policy_id: view.policy_id, description: view.description, state: view.state,
          path: view.path, outcome: view.outcome, filed_at: view.filed_at, flags: view.flags, summary: view.summary,
          steps: records.lifecycle(entry.account_id, [view]).sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).map(r => r.at.slice(0, 16) + ' ' + r.kind)};
      }
    }
  }
  const global = [...new Set(counted(allRows, manifest.virtual_now).map(r => r.day))].sort();
  equal('Every account: the distinct dates read through MCP are the dates of the coverage report', global, coverage.dates.map(d => d.day));
  equal('Every month: claims.list and payments.list with a monthly window give the monthly counts of the coverage report',
    windows.map(([m]) => [m, monthly[m].claims_filed, monthly[m].payments]), coverage.monthly.map(m => [m.month, m.by_kind.claim_filed, m.by_kind.payment_issued]));
  return {coverage_sha256: crypto.createHash('sha256').update(coverageText).digest('hex'), accounts: perAccount.length, claims: perAccount.reduce((s, a) => s + a.claims, 0),
    distinct_dates: global.length, earliest: global[0], latest: global[global.length - 1], monthly: windows.map(([m]) => ({month: m, ...monthly[m]})), per_account: perAccount, representative: samples};
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  if (!root) {
    console.log('SKIP: the evaluation load needs the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
    process.exitCode = SKIPPED;
    return;
  }
  const runtime = path.resolve(root), prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const report = {schema: 'alderbrook.evaluation-load.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: read(path.join(DIR, 'app.json')).version,
    node: process.version, scope: 'Every seed in apps/alderbrook/data/evaluation/, loaded with env.load_seed and read with the Agent read tools over stdio MCP.', checks, passed: false};
  try {
    Object.assign(report, await run(runtime, prepared, clients));
    report.passed = true;
    console.log('PASS: ' + checks.length + ' evaluation load checks: ' + report.accounts + ' accounts, ' + report.claims + ' claims, ' + report.distinct_dates + ' distinct dates.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    prepared.cleanup();
  }
  if (opts.report) {
    fs.mkdirSync(path.dirname(path.resolve(opts.report)), {recursive: true});
    fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error('FAIL: ' + error.message); process.exitCode = 1; });
