#!/usr/bin/env node
'use strict';
// Loads the delivery dataset into a real App instance with env.load_seed, reads it back with the Agent's MCP read tools,
// and checks that what the tools return matches data/evaluation/coverage.json. Then it does the same for a seed "as of" 1 June 2026.
// Usage: node tests/evaluation.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {records} = require('../src/model.cjs');
const time = require('../src/time.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'brindle.', ZONE = 'America/New_York', FIRST = '2025-01-01', LAST = '2026-12-31';
const AS_OF = '2026-06-01T00:00:00-04:00';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const dayOf = value => time.localDay(Date.parse(value), ZONE);
const distinct = values => [...new Set(values)].sort();
const tally = list => list.reduce((out, key) => ({...out, [key]: (out[key] || 0) + 1}), {});
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
    const client = new Client(prepared.app, role, 'brindle-evaluation', path.join(prepared.root, 'state'), 'brindle-evaluation-integration', {registry: prepared.registry});
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
  const dataset = read('data/evaluation/dataset.json'), kind = name => coverage.actual.kinds.find(k => k.kind === name);
  const {loaded, after} = await t.load('evaluation-seed', seed, clock, dataset);
  check('env.load_seed loads the delivery seed at its clock ' + clock + ' with its synthetic provenance bundle', loaded.status === 'ready', loaded);
  equal('The loaded record count is the count of coverage.json and of data/evaluation/dataset.json', [loaded.loaded, coverage.app_records.count, dataset.expected_counts.records],
    [records(seed).length, records(seed).length, records(seed).length]);
  equal('The runtime quality check passes for dataset brindle-evaluation-2025-2026, and its only source is synthetic',
    [loaded.quality.automated_pass, loaded.quality.dataset_id, after.resources.bundle.dataset.sources.map(s => s.kind)], [true, 'brindle-evaluation-2025-2026', ['synthetic']]);
  equal('The snapshot holds the seed byte for byte, at the clock of the seed', [JSON.stringify(after.data) === JSON.stringify(seed), after.virtual_now], [true, clock]);

  const months = [];
  for (const month of MONTHS) months.push((await t.get('transactions.list', {start: month + '-01', end: lastDay(month)})).items);
  equal('transactions.list for each month of 2025 and 2026 returns the transactions count of that month in coverage.json',
    months.map(list => list.length), coverage.actual.monthly.map(m => m.by_kind.transactions));
  const inWindow = months.flat();
  equal('The transaction dates read through MCP are the transactions dates of the report', [inWindow.length, distinct(inWindow.map(x => dayOf(x.transaction_at))).length],
    [kind('transactions').records, kind('transactions').distinct_dates]);
  const opening = (await t.get('transactions.list', {end: '2024-12-31'})).items;
  equal('The opening month of December 2024 holds the excluded transactions of the report', opening.length,
    coverage.actual.exclusions.filter(x => x.kind === 'transactions').length);

  const statements = (await t.get('statements.list', {start: FIRST, end: LAST})).items, allStatements = (await t.get('statements.list')).items;
  equal('statements.list over 2025 to 2026 returns 24 statements, one closing in each month, plus the opening statement of December 2024',
    [statements.length, distinct(statements.map(s => s.closing_at.slice(0, 7))).length, kind('statements').records, allStatements.length], [24, 24, 24, 25]);
  const payments = (await t.get('payments.list', {start: FIRST, end: LAST})).items, future = (await t.get('payments.list', {start: '2027-01-01'})).items;
  const all = [...payments, ...future], moved = all.filter(p => p.state === 'posted' || p.state === 'returned'), intended = coverage.scheduled.kinds.find(k => k.kind === 'payment_intended_days');
  const REQUESTS = ['payments.schedule', 'autopay.scheduled', 'payments.cancel'], requests = all.flatMap(p => p.history.filter(h => REQUESTS.includes(h.action)).map(h => dayOf(h.at)));
  equal('payments.list over 2025 to 2026 returns 30 payments, with one skipped, one returned and one cancelled payment',
    [payments.length, tally(payments.map(p => p.state))], [30, {posted: 27, skipped: 1, returned: 1, cancelled: 1}]);
  equal('The payments that moved money, their returns and their requests read through MCP are the payment families of the report',
    [moved.length, distinct(moved.map(p => dayOf(p.posts_at))).length, all.filter(p => p.state === 'returned').length, requests.length, distinct(requests).length],
    [kind('payment_postings').records, kind('payment_postings').distinct_dates, kind('payment_returns').records, kind('payment_requests').records, kind('payment_requests').distinct_dates]);
  equal('The cancelled, skipped and still scheduled payments are the intended days that the report lists apart, and they are not counted',
    all.filter(p => !moved.includes(p)).map(p => [p.id, p.state, p.pay_on]).sort(), intended.listed.map(x => [x.id, x.state, x.value]).sort());
  equal('The autopay payment of the December 2026 statement is the one scheduled payment after the clock, as the report lists it',
    future.map(p => [p.id, p.state, p.autopay, p.pay_on]), intended.after_clock.map(x => [x.id, 'scheduled', true, x.value]));
  const disputes = (await t.get('disputes.list')).items;
  equal('disputes.list returns the 8 disputes of the report, in every state', [disputes.length, kind('disputes').records, tally(disputes.map(d => d.state))],
    [8, 8, {resolved_for_me: 3, withdrawn: 2, closed_matched: 1, resolved_for_merchant: 1, open: 1}]);
  const offers = (await t.get('offers.list')).items;
  equal('offers.list returns the 16 offers of the report, in every state', [offers.length, kind('offers').records, tally(offers.map(o => o.state))],
    [16, 16, {enrolled: 6, unavailable: 3, expired: 2, declined: 2, available: 3}]);
  const rewards = await t.get('rewards.get');
  equal('rewards.get returns every points entry, and its balance is their sum', [rewards.entries.length, rewards.balance],
    [seed.points_entries.length, seed.points_entries.reduce((n, e) => n + e.points, 0)]);
  equal('The points entries in the window are the points_entries rows of the report', rewards.entries.filter(e => dayOf(e.at) >= FIRST).length, kind('points_entries').records);
  const notifications = (await t.get('notifications.list', {start: FIRST, end: LAST})).items;
  equal('notifications.list over 2025 to 2026 returns the notifications of the report', [notifications.length, distinct(notifications.map(n => dayOf(n.at))).length],
    [kind('notifications').records, kind('notifications').distinct_dates]);
  const account = await t.get('account.get');
  equal('account.get at the clock: the annual fee of 2 December 2026 is still refundable, three retention offers are available and one dispute is open',
    [account.flags, offers.filter(o => o.state === 'available').map(o => o.group), disputes.filter(d => d.state === 'open').length, account.latest_statement.id],
    [['fee_refund_open'], ['retention-2026-12', 'retention-2026-12', 'retention-2026-12'], 1, 'stm-2026-12']);
  const preview = await t.get('account.close_preview');
  check('account.close_preview at the clock refunds the fee of 550.00 until 1 January 2027', preview.fee_refund && preview.fee_refund.amount === 550 && preview.fee_refund.until === '2027-01-01', preview.fee_refund);

  const gym = disputes.find(d => d.reason === 'credit_not_processed'), purchase = await t.get('transactions.get', {id: gym.transaction_id});
  equal('transactions.get on the gym fee shows the whole story: two refunds, the temporary credit and its reversal, and nothing left to recover',
    [purchase.related.map(x => [x.kind, x.amount]), purchase.recovery], [[['refund', 20], ['provisional_credit', 40], ['refund', 40], ['reversal', 40]],
      {amount: 60, refunded_final: 60, temporary_credit: 0, net_charge: 0}]);
  const returned = payments.find(p => p.state === 'returned'), statement = (await t.get('statements.get', {id: returned.statement_id})).statement;
  check('statements.get on the statement of the returned payment lists the returned autopay payment and the payment from the new bank', statement.payments.some(p => p.id === returned.id) &&
    statement.payments.some(p => p.state === 'posted' && p.source !== returned.source), statement.payments);
  report.full_window = {seed: 'data/evaluation/seed.json', virtual_now: clock, loaded: loaded.loaded, quality: {automated_pass: loaded.quality.automated_pass, dataset_id: loaded.quality.dataset_id},
    counts: {transactions_in_window: inWindow.length, transactions_december_2024: opening.length, statements: allStatements.length, payments_in_window: payments.length,
      payments_after_clock: future.length, disputes: disputes.length, offers: offers.length, points_entries: rewards.entries.length, notifications_in_window: notifications.length},
    samples: {account: {balance: account.balance, pending_total: account.pending_total, available_credit: account.available_credit, points_balance: account.points_balance,
      flags: account.flags, latest_statement: account.latest_statement},
    gym_dispute: {dispute: {id: gym.id, reason: gym.reason, state: gym.state, amount: gym.amount, note: gym.note}, related: purchase.related.map(x => ({id: x.id, kind: x.kind, amount: x.amount,
      posted_at: x.posted_at})), recovery: purchase.recovery},
    returned_payment: {id: returned.id, source: returned.source, pay_on: returned.pay_on, returned_at: returned.returned_at, return_reason: returned.return_reason},
    statements: statements.slice(-3).map(s => ({id: s.id, closing_at: s.closing_at, due_at: s.due_at, statement_balance: s.statement_balance, minimum_due: s.minimum_due, paid_toward: s.paid_toward})),
    offers: offers.filter(o => o.state === 'available').map(o => ({id: o.id, kind: o.kind, terms: o.terms, accept_by: o.accept_by})),
    notifications: notifications.slice(-3).map(n => ({at: n.at, kind: n.kind, title: n.title}))}};
}

// A seed as of a time: the read tools show only records from before it.
async function asOf(t, report) {
  const {select} = require('../dev/select-evaluation-seed.cjs');
  const seed = select(AS_OF), dataset = {...read('data/evaluation/dataset.json'), expected_counts: {records: records(seed).length, assets: 0}};
  const {loaded, after} = await t.load('evaluation-as-of', seed, AS_OF, dataset);
  check('env.load_seed loads the seed as of ' + AS_OF + ' with that time as virtual_now', loaded.status === 'ready' && after.virtual_now === AS_OF, loaded);
  const transactions = (await t.get('transactions.list')).items, statements = (await t.get('statements.list')).items, notifications = (await t.get('notifications.list')).items;
  const latest = list => list.map(Date.parse).reduce((a, b) => Math.max(a, b), 0);
  check('As of ' + AS_OF + ', no transaction, statement or notification read through MCP is dated after that time',
    latest([...transactions.map(x => x.transaction_at), ...statements.map(s => s.issued_at), ...notifications.map(n => n.at)]) <= Date.parse(AS_OF));
  equal('As of ' + AS_OF + ', the latest statement is stm-2026-05 and autopay pays only the minimum after the car repair',
    [statements.length, statements[statements.length - 1].id, (await t.get('account.get')).account.autopay.mode], [18, 'stm-2026-05', 'minimum_due']);
  const missing = await t.get('offers.get', {id: 'off-0014'}).catch(error => ({error: error.message}));
  check('As of ' + AS_OF + ', the retention offers of December 2026 do not exist yet, so offers.get on one returns not_found', /not_found/.test(JSON.stringify(missing)), missing);
  report.as_of = {time: AS_OF, loaded: loaded.loaded, transactions: transactions.length, statements: statements.length, notifications: notifications.length};
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  const skip = reason => { console.log('SKIP: ' + reason); process.exitCode = SKIPPED; };
  if (!root) return skip('the evaluation data check needs the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
  const runtime = path.resolve(root);
  if (!fs.existsSync(path.join(runtime, 'prepare.cjs')) || !fs.existsSync(path.join(runtime, 'client.cjs'))) return skip('no public runtime at ' + runtime + '.');
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const report = {schema: 'brindle.evaluation-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: read('app.json').version,
    node: process.version, coverage_report: 'data/evaluation/coverage.json', checks, passed: false};
  try {
    const t = await connect(runtime, prepared, clients);
    await fullWindow(t, report);
    await asOf(t, report);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Brindle delivery dataset checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Brindle delivery dataset checks passed.');
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
