#!/usr/bin/env node
'use strict';
// Loads the evaluation dataset into a real App instance with env.load_seed, reads it back with the Agent's MCP read tools,
// and checks that what the tools return matches data/evaluation/coverage.json. Then it does the same for a seed "as of" 19 November 2026.
// Usage: node tests/evaluation.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {records} = require('../src/model.cjs');
const time = require('../src/time.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'payleaf.', ZONE = 'America/New_York', FIRST = '2025-01-01', LAST = '2026-12-31';
const AS_OF = '2026-11-19T12:00:00-05:00';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const dayOf = value => time.localDay(Date.parse(value), ZONE);
const distinct = values => [...new Set(values)].sort();

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
const kindOf = (coverage, kind) => coverage.actual.kinds.find(k => k.kind === kind);

async function connect(runtime, prepared, clients) {
  const {Client} = require(path.join(runtime, 'client.cjs'));
  const open = async role => {
    const client = new Client(prepared.app, role, 'payleaf-evaluation', path.join(prepared.root, 'state'), 'payleaf-evaluation-integration', {registry: prepared.registry});
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
    const after = (await t.infra.call('env.snapshot')).snapshot;
    return {loaded, after};
  };
  return t;
}

// The full-window seed: load it, then compare every count of the coverage report with what the read tools return.
async function fullWindow(t, report) {
  const seed = read('data/evaluation/seed.json'), clock = read('data/evaluation/clock.json').initial_time, coverage = read('data/evaluation/coverage.json');
  const dataset = read('data/evaluation/dataset.json');
  const {loaded, after} = await t.load('evaluation-seed', seed, clock, dataset);
  check('env.load_seed loads the evaluation seed at its clock ' + clock + ' with its synthetic provenance bundle', loaded.status === 'ready', loaded);
  equal('The loaded record count is the count of coverage.json and of data/evaluation/dataset.json', [loaded.loaded, coverage.app_records.count, dataset.expected_counts.records],
    [records(seed).length, records(seed).length, records(seed).length]);
  equal('The runtime quality check passes for dataset payleaf-evaluation-2025-2026, and its only source is synthetic',
    [loaded.quality.automated_pass, loaded.quality.dataset_id, after.resources.bundle.dataset.sources.map(s => s.kind)], [true, 'payleaf-evaluation-2025-2026', ['synthetic']]);
  equal('The snapshot holds the seed byte for byte, at the clock of the seed', [JSON.stringify(after.data) === JSON.stringify(seed), after.virtual_now], [true, clock]);

  const employment = await t.get('employment.get');
  const statements = (await t.get('pay_statements.list', {start: FIRST, end: LAST})).items;
  const kind = name => kindOf(coverage, name);
  equal('pay_statements.list over 2025 to 2026 returns every statement, and their posted days are the pay_statements dates of the report',
    [statements.length, distinct(statements.map(s => dayOf(s.posted_at))).length, distinct(statements.map(s => dayOf(s.posted_at)))[0], distinct(statements.map(s => dayOf(s.posted_at))).pop()],
    [kind('pay_statements').records, kind('pay_statements').distinct_dates, kind('pay_statements').earliest, kind('pay_statements').latest]);
  const months = distinct(statements.map(s => s.pay_date.slice(0, 7)));
  equal('Every month of 2025 and 2026 has a pay statement', months.length, 24);
  const full = [];
  for (const row of statements) full.push((await t.get('pay_statements.get', {id: row.id})).statement);
  const deposits = full.flatMap(s => s.deposits);
  equal('pay_statements.get reads every statement, and the deposit updates match the report', deposits.filter(d => d.state !== 'sent').map(d => d.history.length - 1).reduce((a, b) => a + b, 0),
    kind('deposit_updates').records);

  const calendar = (await t.get('calendar.list', {start: FIRST, end: LAST})).items, future = (await t.get('calendar.list', {start: '2027-01-01'})).items;
  const futureRows = coverage.scheduled.future_rows.filter(x => x.kind === 'pay_calendar').map(x => x.id);
  equal('calendar.list: the 52 pay dates of the window are paid, and the 2027 pay dates are planned scheduled rows, as the report lists them',
    [calendar.length, calendar.every(e => e.state === 'paid'), future.map(e => e.id), future.every(e => e.state === 'planned')], [52, true, futureRows, true]);

  const changes = (await t.get('changes.list')).items, inquiries = (await t.get('inquiries.list')).items, leave = (await t.get('leave.list')).items;
  equal('changes.list returns the setting_changes and setting_cancellations of the report',
    [changes.length, distinct(changes.map(x => dayOf(x.made_at))).length, changes.filter(x => x.cancelled_at).length],
    [kind('setting_changes').records, kind('setting_changes').distinct_dates, kind('setting_cancellations').records]);
  equal('inquiries.list returns the pay_inquiries, inquiry_answers and inquiry_withdrawals of the report',
    [inquiries.length, inquiries.filter(x => x.answer).length, inquiries.filter(x => x.state === 'withdrawn').length],
    [kind('pay_inquiries').records, kind('inquiry_answers').records, kind('inquiry_withdrawals').records]);
  equal('leave.list returns the leave_requests, leave_decisions and leave_cancellations of the report',
    [leave.length, distinct(leave.map(x => dayOf(x.requested_at))).length, leave.filter(x => x.decided_at).length, leave.filter(x => x.cancelled_at).length],
    [kind('leave_requests').records, kind('leave_requests').distinct_dates, kind('leave_decisions').records, kind('leave_cancellations').records]);
  const notifications = (await t.get('notifications.list', {start: FIRST, end: LAST})).items;
  equal('notifications.list over 2025 to 2026 returns the notifications of the report', [notifications.length, distinct(notifications.map(x => dayOf(x.at))).length],
    [kind('notifications').records, kind('notifications').distinct_dates]);
  const windows = (await t.get('benefits.windows')).items, sets = [];
  for (const w of windows) sets.push((await t.get('benefits.get', {id: w.id})).window);
  equal('benefits.windows and benefits.get: two windows, both closed, each with a final set, and the saved choices of the report',
    [windows.map(w => [w.id, w.state]), sets.map(w => w.set && w.set.state), sets.reduce((n, w) => n + w.saves.length, 0)],
    [[['win-2026', 'closed'], ['win-2027', 'closed']], ['final', 'final'], kind('benefit_choices').records]);
  const {settings} = await t.get('settings.get');
  equal('settings.get at the clock: 8 percent is locked for the first pay date of 2027, and the new withholding form waits for the second one',
    [settings.retirement.locked && [settings.retirement.locked.value.percent, settings.retirement.locked.applies_to.entry_id], settings.withholding.waiting && settings.withholding.waiting.applies_to.entry_id],
    [[8, 'pd-2027-01'], 'pd-2027-02']);
  const balances = (await t.get('leave.balances')).items;
  const pick = s => ({id: s.id, pay_date: s.pay_date, posted_at: s.posted_at, earnings: s.earnings.map(l => [l.text, l.amount]), deductions: s.deductions.map(d => [d.text, d.amount]),
    net_pay: s.net_pay, deposits: s.deposits.map(d => [d.account.label, d.amount, d.state])});
  report.full_window = {seed: 'data/evaluation/seed.json', virtual_now: clock, loaded: loaded.loaded, quality: {automated_pass: loaded.quality.automated_pass, dataset_id: loaded.quality.dataset_id},
    counts: {pay_statements: statements.length, calendar_in_window: calendar.length, calendar_2027: future.length, setting_changes: changes.length, inquiries: inquiries.length,
      leave_requests: leave.length, notifications: notifications.length, windows: windows.length},
    samples: {employment: {name: employment.employment.name, job_title: employment.employment.job_title, annual_salary: employment.employment.annual_salary, flags: employment.flags},
      first_statement_2025: pick(full[0]), bonus_statement_2025: pick(full.find(s => s.id === 'ps-2025-06')), last_statement_2026: pick(full[full.length - 1]),
      returned_deposit: full.flatMap(s => s.deposits).find(d => d.state === 'reissued'),
      inquiries: inquiries.slice(-2).map(q => ({id: q.id, statement_id: q.statement_id, amount: q.amount, note: q.note, state: q.state, answer: q.answer && q.answer.note})),
      leave_requests: leave.slice(-3).map(r => ({id: r.id, type: r.leave_type_id, start: r.start, end: r.end, hours: r.hours, state: r.state})),
      leave_balances: balances.map(b => ({type: b.leave_type_id, balance: b.balance, available: b.available, expiring: b.expiring})),
      notifications: notifications.slice(-2).map(n => ({at: n.at, kind: n.kind, title: n.title}))}};
}

// A seed as of a time: the read tools show only records from before it, and later pay dates are still planned.
async function asOf(t, report) {
  const {select} = require('../dev/select-evaluation-seed.cjs');
  const seed = select(AS_OF), dataset = {...read('data/evaluation/dataset.json'), expected_counts: {records: records(seed).length, assets: 0}};
  const {loaded, after} = await t.load('evaluation-as-of', seed, AS_OF, dataset);
  check('env.load_seed loads the seed as of ' + AS_OF + ' with that time as virtual_now', loaded.status === 'ready' && after.virtual_now === AS_OF, loaded);
  const statements = (await t.get('pay_statements.list')).items, notifications = (await t.get('notifications.list')).items, leave = (await t.get('leave.list')).items;
  const latest = list => list.map(Date.parse).reduce((a, b) => Math.max(a, b), 0);
  check('As of ' + AS_OF + ', no statement, notification or leave request read through MCP is dated after that time',
    latest([...statements.map(s => s.posted_at), ...notifications.map(n => n.at), ...leave.map(r => r.requested_at)]) <= Date.parse(AS_OF));
  const calendar = (await t.get('calendar.list', {start: '2026-11-16', end: LAST})).items;
  equal('As of ' + AS_OF + ', the pay dates of 20 November, 4 December and 18 December are planned rows with no statement',
    calendar.map(e => [e.id, e.state]), [['pd-2026-24', 'planned'], ['pd-2026-25', 'planned'], ['pd-2026-26', 'planned']]);
  const inquiry = (await t.get('inquiries.list', {id: 'ps-2026-25'}).catch(error => ({error: error.message})));
  check('As of ' + AS_OF + ', the statement of 4 December does not exist yet, so inquiries.list on it fails', !!inquiry.error, inquiry);
  report.as_of = {time: AS_OF, loaded: loaded.loaded, pay_statements: statements.length, notifications: notifications.length, leave_requests: leave.length,
    planned_pay_dates_in_2026: calendar.length};
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  const skip = reason => { console.log('SKIP: ' + reason); process.exitCode = SKIPPED; };
  if (!root) return skip('the evaluation data check needs the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
  const runtime = path.resolve(root);
  if (!fs.existsSync(path.join(runtime, 'prepare.cjs')) || !fs.existsSync(path.join(runtime, 'client.cjs'))) return skip('no public runtime at ' + runtime + '.');
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const report = {schema: 'payleaf.evaluation-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: read('app.json').version,
    node: process.version, coverage_report: 'data/evaluation/coverage.json', checks, passed: false};
  try {
    const t = await connect(runtime, prepared, clients);
    await fullWindow(t, report);
    await asOf(t, report);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Payleaf evaluation data checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Payleaf evaluation data checks passed.');
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
