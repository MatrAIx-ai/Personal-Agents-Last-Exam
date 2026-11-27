#!/usr/bin/env node
'use strict';
// Loads the delivery dataset into a real App instance with env.load_seed, reads it back with the Agent's MCP read tools,
// and checks that what the tools return matches data/evaluation/coverage.json. Then it does the same for a seed "as of" 1 June 2026.
// Usage: node tests/evaluation.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {records} = require('../src/model.cjs');
const time = require('../src/time.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'benchline.', ZONE = 'America/New_York';
const AS_OF = '2026-06-01T00:00:00-04:00';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const dayOf = value => time.localDay(Date.parse(value), ZONE);
const distinct = values => [...new Set(values)].sort();
const MONTHS = [];
for (let year = 2025; year <= 2026; year++) for (let month = 1; month <= 12; month++) MONTHS.push(year + '-' + String(month).padStart(2, '0'));
const lastDay = month => time.addDays(time.addDays(month + '-28', 5).slice(0, 7) + '-01', -1);

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--runtime', '--report'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node tests/evaluation.integration.cjs --runtime DIR [--report FILE]');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const checks = [];
function check(name, condition, got) {
  checks.push({name, status: condition ? 'passed' : 'failed'});
  if (!condition) throw new Error(name + (got === undefined ? '' : '\n  got: ' + JSON.stringify(got)));
}
const equal = (name, actual, expected) => check(name, util.isDeepStrictEqual(actual, expected), {expected, actual});

async function connect(runtime, prepared, clients) {
  const {Client} = require(path.join(runtime, 'client.cjs'));
  const open = async role => {
    const client = new Client(prepared.app, role, 'benchline-evaluation', path.join(prepared.root, 'state'), 'benchline-evaluation-integration', {registry: prepared.registry});
    clients.push(client);
    await client.initialize();
    return client;
  };
  const t = {infra: await open('infra'), agent: await open('agent')};
  t.get = async (name, args = {}) => {
    const result = await t.agent.call(APP + name, args);
    if (result.status !== 'ok') throw new Error(name + ' failed: ' + JSON.stringify(result));
    return result;
  };
  t.load = async (label, data, virtualNow, dataset) => {
    const before = await t.infra.call('env.snapshot'), bundle = {dataset, catalog: read('contribution/assets.catalog.json'), blobs: {}};
    const loaded = await t.infra.call('env.load_seed', {expected_version: before.version, request_id: label, data, binding: read('fixtures/binding.json'),
      policies: read('fixtures/policies.json'), bundle, virtual_now: virtualNow});
    return {loaded, after: (await t.infra.call('env.snapshot')).snapshot};
  };
  return t;
}

// The jobs of each month, read with month windows, as a task reads a long history.
async function jobsByMonth(t) {
  const out = {};
  for (const month of MONTHS) out[month] = (await t.get('jobs.list', {start: month + '-01', end: lastDay(month)})).items;
  return out;
}

async function delivered(t) {
  const seed = read('data/evaluation/seed.json'), clock = read('data/evaluation/clock.json').initial_time, dataset = read('data/evaluation/dataset.json');
  const coverage = read('data/evaluation/coverage.json');
  const {loaded, after} = await t.load('evaluation-seed', seed, clock, dataset);
  equal('env.load_seed loads the delivered seed with its dataset bundle: ready, with the record count of dataset.json and the coverage report',
    [loaded.status, loaded.loaded, records(seed).length, dataset.expected_counts.records, coverage.app_records.count], ['ready', records(seed).length, records(seed).length, records(seed).length, records(seed).length]);
  check('The snapshot holds the delivered seed byte for byte, at the clock of clock.json', JSON.stringify(after.data) === JSON.stringify(seed) && after.virtual_now === clock);
  const months = await jobsByMonth(t), all = Object.values(months).flat();
  const kind = name => coverage.actual.kinds.find(k => k.kind === name);
  equal('jobs.list in month windows returns every job of the seed once, as the coverage report counts them', [all.length, new Set(all.map(j => j.id)).size], [kind('jobs').records, kind('jobs').records]);
  equal('The jobs of each month match the job column of the monthly coverage table', MONTHS.map(m => months[m].length), coverage.actual.monthly.map(m => m.by_kind.jobs));
  equal('The distinct submission days that the Agent reads match the coverage report', distinct(all.map(j => dayOf(j.submitted_at))).length, kind('jobs').distinct_dates);
  const u = (await t.get('usage.summary')).usage;
  equal('usage.summary reads the current period Q4 2026 with its allocation', [u.period.period_id, u.allocation_hours], [seed.allocation.period_id, seed.allocation.allocation_hours]);
  const versions = (await t.get('protocols.list')).items, tables = (await t.get('tables.list')).items, configs = (await t.get('configs.list')).items;
  equal('protocols.list, tables.list and configs.list return every version, table version and config of the seed', [versions.length, tables.length, configs.length],
    [seed.protocols.length, seed.tables.length, seed.configs.length]);
  equal('The protocol versions read in all six states', distinct(versions.map(p => p.state)), ['declined', 'expired', 'proposed', 'signed', 'superseded', 'withdrawn']);
  const frozen = tables.find(x => x.state === 'frozen'), got = (await t.get('tables.get', {id: frozen.id})).table;
  check('A frozen table reads its manifest and its CSV rows', got.manifest && got.manifest.content_hash.startsWith('sha256:') && got.csv.split('\n').length === got.manifest.rows.length + 2, got.id);
  const results = (await t.get('results.list', {start: '2026-10-01', end: '2026-12-31'})).items;
  check('results.list reads the results of the last quarter (' + results.length + ')', results.length > 100 && results.every(r => r.completed_at >= '2026-10'));
  const notices = (await t.get('notifications.list')).items;
  equal('notifications.list returns the released notifications that the coverage report counts', notices.length, kind('notifications').records);
  const compare = (await t.get('results.compare', {ids: [results[0].id, results[1].id]}));
  check('results.compare reads two results of the dataset', typeof compare.comparable === 'boolean', compare);
}

async function asOf(t) {
  const {select} = require('../dev/select-evaluation-seed.cjs');
  const seed = select(AS_OF), dataset = {...read('data/evaluation/dataset.json'), expected_counts: {records: records(seed).length, assets: 0}};
  const {loaded, after} = await t.load('as-of-seed', seed, AS_OF, dataset);
  equal('A seed as of ' + AS_OF + ' loads with that virtual_now', [loaded.status, loaded.loaded, after.virtual_now], ['ready', records(seed).length, AS_OF]);
  const months = await jobsByMonth(t), all = Object.values(months).flat();
  check('Every job that the Agent reads was submitted before the as-of time (' + all.length + ' jobs)', all.length > 800 && all.every(j => Date.parse(j.submitted_at) < Date.parse(AS_OF)));
  equal('The months after the as-of time have no jobs', MONTHS.filter(m => m >= '2026-06').map(m => months[m].length), MONTHS.filter(m => m >= '2026-06').map(() => 0));
  const u = (await t.get('usage.summary')).usage;
  equal('The current period of the as-of seed is the quarter that contains the time', u.period.period_id, 'alloc-2026-q2');
  check('No read returns a result that ended after the as-of time', (await t.get('results.list')).items.every(r => Date.parse(r.completed_at) <= Date.parse(AS_OF)));
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  const skip = reason => { console.log('SKIP: ' + reason); process.exitCode = SKIPPED; };
  if (!root) return skip('loading the dataset needs the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
  const runtime = path.resolve(root);
  if (!fs.existsSync(path.join(runtime, 'prepare.cjs')) || !fs.existsSync(path.join(runtime, 'client.cjs'))) return skip('no public runtime at ' + runtime + '.');
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const report = {schema: 'benchline.evaluation-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: read('app.json').version,
    node: process.version, checks, passed: false};
  try {
    const t = await connect(runtime, prepared, clients);
    await delivered(t);
    await asOf(t);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Benchline evaluation data checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Benchline evaluation data checks passed.');
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
