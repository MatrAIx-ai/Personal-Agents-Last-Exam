'use strict';
// Business tests T01 to T20 of the approved plan (section 4, "Acceptance plan").
// A test name starts with its plan ID and its workflow. A letter after the ID marks one more test for that ID.
// PKG tests check the package itself. No test reads a file outside the package.
// In a copy of the package alone exactly two tests are skipped: T19i and T20. They need the real runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {builtinModules} = require('node:module');
const {spawnSync} = require('node:child_process');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const {createSender} = require('../infra/sender.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const SEED = require('../examples/task-data/seed.json');

const ROOT = path.resolve(__dirname, '..');
const eventSchema = compile(require('../schemas/events.schema.json'), path.join(ROOT, 'schemas'));
const wireSchema = compile(require('../schemas/router-message.schema.json'), path.join(ROOT, 'schemas'));
const READS = ['employment.get', 'calendar.list', 'pay_statements.list', 'pay_statements.get', 'settings.get', 'changes.list', 'inquiries.list', 'leave.balances',
  'leave.list', 'leave.preview', 'benefits.windows', 'benefits.get', 'notifications.list', 'preferences.get'];
const WRITES = ['deposit.update', 'withholding.update', 'retirement.set', 'changes.cancel', 'inquiries.open', 'inquiries.withdraw', 'leave.request', 'leave.cancel',
  'benefits.elect', 'benefits.submit', 'preferences.update'];
const EVENTS = ['payroll.run_posted', 'calendar.changed', 'deposit.updated', 'inquiry.answered', 'leave.decided', 'leave.adjusted', 'enrollment.opened'];
// The 12 App errors of section 2, in the order of the table. When two fit one call, the first one wins.
const ERRORS = ['not_found', 'invalid_state', 'invalid_timezone', 'invalid_window', 'window_closed', 'too_late', 'invalid_split', 'over_limit', 'already_open',
  'conflict', 'insufficient_balance', 'incomplete'];

// The small seed of examples/task-data, read at its clock: Thursday 19 November 2026. The cut-off of the run of 20 November has passed.
const NOW = '2026-11-19T12:00:00-05:00';
const ACCOUNT = 'payleaf-kai', OWNER = 'person-kai', MANAGER = 'person-okoro';
// The same seed without the open inquiry inq-0006 and the pending leave request lv-0044, so the Agent's own writes get these IDs, as in the plan's examples.
const BASE = (() => {
  const seed = structuredClone(SEED);
  seed.inquiries = seed.inquiries.filter(q => q.id !== 'inq-0006');
  seed.leave_requests = seed.leave_requests.filter(r => r.id !== 'lv-0044');
  return seed;
})();
// BASE where the 2026 set also gives the spending account a yearly amount (by default 1,040.00, which is 40.00 on each of 26 pays),
// and with `vision` the vision plan for the employee. W4 needs it: "The person has medical, dental and spending-account choices in 2026."
const benefitLine = (plan_id, option_id, text, amount) => ({kind: 'benefit', plan_id, option_id, text, due: amount, amount});
const MEDICAL_LINE = benefitLine('medical', 'med-ppo-ee', 'Medical: PPO, employee only', 120);
const RETIREMENT_LINE = {kind: 'retirement', plan_id: null, option_id: null, text: 'Retirement savings at 5 percent', due: 160, amount: 160};
function covered({vision = false, yearly = 1040, perPay = 40, periods = 26} = {}) {
  const seed = structuredClone(BASE), set = seed.election_sets[0], chosen = {fsa: {yearly_amount: yearly}, ...(vision ? {vision: {option_id: 'vis-ee'}} : {})};
  seed.employer.rules.pay_periods_per_year = periods;
  for (const list of [set.choices, set.history[0].choices, seed.windows[0].saved]) for (const row of list) if (chosen[row.plan_id]) row.choice = chosen[row.plan_id];
  const yearlyText = yearly.toLocaleString('en-US', {minimumFractionDigits: 2});
  const lines = [MEDICAL_LINE, ...(vision ? [benefitLine('vision', 'vis-ee', 'Vision: Employee only', 3.75)] : []),
    benefitLine('fsa', null, 'Health care spending account: ' + yearlyText + ' a year', perPay), RETIREMENT_LINE];
  const net = 320000 - 64000 - lines.reduce((total, line) => total + Math.round(line.amount * 100), 0);
  for (const statement of seed.statements) {
    Object.assign(statement, {deductions: lines.map((line, i) => ({line_id: 'd' + (i + 1), ...line})), net_pay: net / 100});
    statement.deposits[1].amount = (net - 30000) / 100;
  }
  // The old notifications tell the old net pay, so this seed holds none.
  seed.notifications = [];
  return seed;
}

// An instant in New York from November 2026 to January 2027, where the UTC offset is -05:00.
const ny = (day, time = '09:00:00') => day + 'T' + time + '-05:00';
const pick = (object, ...keys) => keys.map(key => object[key]);
const edit = (value, change) => { const next = structuredClone(value); change(next); return next; };
const start = (options = {}) => fixture({seed: BASE, now: NOW, ...options});
const SCHEMA = 'Input schema';
// A refused call or event gives the error code of the plan and leaves the data as it was. `text` is a part of the message of the rule that refuses it.
// SCHEMA stands for a call that breaks its input schema: Core answers `invalid_arguments` before the App runs.
// The data includes the activity rows, and each commit writes one (T20c), so an unchanged log also means that Core's version did not move.
function unchanged(f, fn, code, label = code, text = '') {
  const before = f.data, version = commits(before);
  assert.throws(fn, error => {
    assert.equal(error.message.startsWith(SCHEMA) ? SCHEMA : error.code, code, label + ': ' + error.message);
    assert.ok(error.message.includes(text), label + ': ' + error.message);
    return true;
  }, label);
  assert.deepEqual(f.data, before, label);
  assert.equal(commits(f.data), version, label);
}
const commits = data => data.activity.filter(row => !row.effect).length;

// The events of payroll, the manager and the benefits team.
const event = (event_id, at, name, payload) => ({event_id, at, operation: 'payleaf.' + name, payload});
const SALARY = {line_id: 'e1', kind: 'salary', text: 'Regular pay', amount: 3200};
const TAXES = [{line_id: 't1', text: 'Federal income tax', amount: 412}, {line_id: 't2', text: 'Social security and Medicare', amount: 228}];
// The run of one pay calendar entry, posted at 06:00 on `day`. Its statement ID follows the entry ID: pd-2026-25 writes ps-2026-25.
const run = (entry, day, {earnings = [SALARY], taxes = TAXES, more = [], time = '06:00:00'} = {}) => event('ev-run-' + entry.slice(3), ny(day, time), 'payroll.run_posted',
  {entry_id: entry, statement_id: 'ps-' + entry.slice(3), earnings: [...earnings, ...more], taxes});
const calendarChanged = (at, entry, change, id = 'ev-cal-' + entry) => event(id, at, 'calendar.changed', {entry_id: entry, ...change});
// A new entry, every 14 days after the last one of the seed: the period is the Monday to Sunday that ends five days before the Friday pay date.
const added = (at, entry, period_start, period_end, pay_date, cutoff_day, more = {}) =>
  calendarChanged(at, entry, {period_start, period_end, pay_date, cutoff_at: ny(cutoff_day, '17:00:00'), ...more}, 'ev-add-' + entry);
const ENTRY_27 = ['pd-2026-27', '2026-12-14', '2026-12-27', '2026-12-31', '2026-12-29'];
const ENTRY_2027 = ['pd-2027-01', '2026-12-28', '2027-01-10', '2027-01-15', '2027-01-12'];
const depositUpdated = (at, deposit_id, state, more = {}) => event('ev-dep-' + deposit_id + '-' + state, at, 'deposit.updated', {deposit_id, state, ...more});
const answered = (at, inquiry_id, outcome, more = {}) => event('ev-ans-' + inquiry_id, at, 'inquiry.answered', {inquiry_id, outcome, answered_by: 'Payroll', ...more});
const decided = (at, leave_request_id, decision, id = 'ev-dec-' + leave_request_id) => event(id, at, 'leave.decided', {leave_request_id, decision, decided_by: MANAGER});
const adjusted = (at, entry_id, leave_type_id, hours, reason = 'correction') => event('ev-' + entry_id, at, 'leave.adjusted', {entry_id, leave_type_id, hours, reason});
const opened = (at, window_id, plan_year, opens_at, closes_at, plan_ids) => event('ev-' + window_id, at, 'enrollment.opened', {window_id, plan_year, opens_at, closes_at, plan_ids});

// The examples of the plan, one on each line of a helper file. `dev/check-plan-examples.cjs` compares them with the plan, byte for byte.
const verbatim = file => fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => line.replace(/,$/, ''));
const PLAN_EVENTS = verbatim('proposal-events.json'), PLAN_WIRE = verbatim('proposal-wire-message.json')[0];
const PLAN = Object.fromEntries(PLAN_EVENTS.map(line => JSON.parse(line)).map(e => [e.event_id, e]));

// Bank accounts and deposit setups.
const SAVINGS = {label: 'Joint savings', kind: 'savings', last4: '4410'}, CHECKING = {label: 'Everyday checking', kind: 'checking', last4: '7731'};
const NEW_CHECKING = {label: 'New checking', kind: 'checking', last4: '5520'}, TRAVEL = {label: 'Travel fund', kind: 'savings', last4: '9020'};
const OLD_SETUP = [{...SAVINGS, amount: 300}, {...CHECKING, remainder: true}], NEW_SETUP = [{...SAVINGS, amount: 300}, {...NEW_CHECKING, remainder: true}];
const FORM = {filing_status: 'single', multiple_jobs: false, dependents_amount: 0, other_income: 0, deductions: 0, extra_withholding: 0};
// The three planned runs of the seed, as a change shows the run it applies to.
const RUN_24 = {entry_id: 'pd-2026-24', pay_date: '2026-11-20', cutoff_at: '2026-11-17T17:00:00-05:00'};
const RUN_25 = {entry_id: 'pd-2026-25', pay_date: '2026-12-04', cutoff_at: '2026-12-01T17:00:00-05:00'};
const RUN_26 = {entry_id: 'pd-2026-26', pay_date: '2026-12-18', cutoff_at: '2026-12-15T17:00:00-05:00'};
const deposits = statement => statement.deposits.map(d => [d.account.last4, d.amount, d.state]);
const statementOf = (f, id) => f.call('pay_statements.get', {id}).statement;
const changeOf = (f, id) => f.call('changes.list').items.find(change => change.id === id);
const vacation = f => f.call('leave.balances').items.find(row => row.leave_type_id === 'vacation');
const requestOf = (f, id) => f.call('leave.list').items.find(request => request.id === id);
const windowOf = (f, id = 'win-2027') => f.call('benefits.get', {id}).window;
const flags = f => f.call('employment.get').flags;

// The main paths of the plan, step by step. `walk` returns what each step returned, up to the step `last`.
function walk(f, steps, last) {
  const seen = {};
  for (const [name, step] of Object.entries(steps)) {
    seen[name] = step(f);
    if (name === last) break;
  }
  return seen;
}
// W2: a new account after the cut-off of 4 December, a question to payroll, and the retirement percentage from 18 December.
const REIMBURSEMENT = {line_id: 'e2', kind: 'reimbursement', text: 'Travel reimbursement', amount: 412.5, inquiry_id: 'inq-0006'};
const PAY_PATH = {
  run20Nov: f => f.event(PLAN['ev-pl-401']),
  newAccount: f => { f.advance(ny('2026-12-02')); return f.call('deposit.update', {id: ACCOUNT, accounts: NEW_SETUP}); },
  run4Dec: f => f.event(run('pd-2026-25', '2026-12-04')),
  inquiry: f => { f.advance(ny('2026-12-04', '10:00:00')); return f.call('inquiries.open', {id: 'ps-2026-25', amount: 412.5, note: 'My travel reimbursement of 412.50 is missing.'}); },
  retirement: f => { f.advance(ny('2026-12-10')); return f.call('retirement.set', {id: ACCOUNT, percent: 8}); },
  answer: f => f.event(PLAN['ev-pl-420']),
  run18Dec: f => f.event(run('pd-2026-26', '2026-12-18', {more: [REIMBURSEMENT]}))
};
// W3: vacation from Monday 21 to Friday 25 December, with 25 December a company holiday.
const WINTER = {id: 'vacation', start: '2026-12-21', end: '2026-12-25', hours_per_day: 8};
const LEAVE_PATH = {
  run20Nov: f => f.event(PLAN['ev-pl-401']),
  preview: f => { f.advance(ny('2026-12-02')); return f.call('leave.preview', WINTER); },
  request: f => f.call('leave.request', WINTER),
  approval: f => f.event(PLAN['ev-pl-430']),
  taken: f => f.advance(ny('2026-12-26', '00:00:00'))
};
// W4: the window of 2027 opens on 30 November and closes on 11 December. The runs that follow reach the first pay date of 2027.
const ENROLL_PATH = {
  run20Nov: f => f.event(PLAN['ev-pl-401']),
  opened: f => f.event(PLAN['ev-pl-440']),
  medical: f => { f.advance(ny('2026-12-03')); return f.call('benefits.elect', {id: 'win-2027', plan_id: 'medical', option_id: 'med-hdhp-ee'}); },
  spending: f => f.call('benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 2600}),
  submit: f => f.call('benefits.submit', {id: 'win-2027'}),
  run4Dec: f => f.event(run('pd-2026-25', '2026-12-04')),
  closed: f => f.advance(ny('2026-12-12')),
  runs: f => yearEnd(f)
};
// The runs of 18 and 31 December and of 15 January 2027, after the window has closed.
function yearEnd(f) {
  f.event(added(ny('2026-12-12', '10:00:00'), ...ENTRY_27, {reason: 'The pay date before the New Year holiday.'}));
  f.event(added(ny('2026-12-12', '10:05:00'), ...ENTRY_2027));
  for (const [entry, day] of [['pd-2026-26', '2026-12-18'], ['pd-2026-27', '2026-12-31'], ['pd-2027-01', '2027-01-15']]) f.event(run(entry, day));
}
const enroll = (f, last) => walk(f, ENROLL_PATH, last);
const deductions = statement => statement.deductions.map(d => [d.plan_id || d.kind, d.amount]);

// Each of the 14 reads, for every object of the data.
function everyRead(f) {
  const data = f.data, results = [], read = (name, args = {}) => results.push([name, f.call(name, args)]);
  for (const name of ['employment.get', 'calendar.list', 'pay_statements.list', 'settings.get', 'changes.list', 'inquiries.list', 'leave.balances', 'leave.list',
    'benefits.windows', 'notifications.list', 'preferences.get']) read(name);
  for (const statement of data.statements) { read('pay_statements.get', {id: statement.id}); read('inquiries.list', {id: statement.id}); }
  for (const window of data.windows) read('benefits.get', {id: window.id});
  for (const type of data.leave_types) {
    read('leave.list', {id: type.id});
    // One request that is allowed and one that breaks rules: preview runs every check and writes nothing.
    read('leave.preview', {id: type.id, start: '2027-01-04', end: '2027-01-05', hours_per_day: 4});
    read('leave.preview', {id: type.id, start: '2026-11-20', end: '2027-02-20', hours_per_day: 8});
  }
  return results;
}

test('T01 [W1] calendar: the next pay date is Friday 4 December, with its cut-off on Tuesday 1 December at 17:00', () => {
  const f = start(), list = args => f.call('calendar.list', args).items;
  const all = list();
  assert.deepEqual(all.map(e => pick(e, 'id', 'pay_date', 'state', 'statement_id', 'cutoff_passed')), [
    ['pd-2026-22', '2026-10-23', 'paid', 'ps-2026-22', true], ['pd-2026-23', '2026-11-06', 'paid', 'ps-2026-23', true],
    ['pd-2026-24', '2026-11-20', 'planned', null, true], ['pd-2026-25', '2026-12-04', 'planned', null, false], ['pd-2026-26', '2026-12-18', 'planned', null, false]]);
  assert.equal(f.call('calendar.list').now, NOW);
  // The run of 20 November posts. The first planned entry is then the pay date of Friday 4 December.
  f.event(PLAN['ev-pl-401']);
  const next = list().find(e => e.state === 'planned');
  assert.deepEqual(pick(next, 'id', 'period_start', 'period_end', 'pay_date', 'cutoff_at', 'cutoff_passed'),
    ['pd-2026-25', '2026-11-16', '2026-11-29', '2026-12-04', '2026-12-01T17:00:00-05:00', false]);
  assert.deepEqual([new Date(Date.UTC(2026, 11, 4)).getUTCDay(), new Date(Date.UTC(2026, 11, 1)).getUTCDay()], [5, 2]);
  assert.deepEqual(pick(list().find(e => e.id === 'pd-2026-24'), 'state', 'statement_id'), ['paid', 'ps-2026-24']);
  // `start` and `end` are pay dates, both included.
  assert.deepEqual([list({start: '2026-12-04', end: '2026-12-04'}), list({start: '2026-12-05'}), list({end: '2026-10-23'})].map(items => items.map(e => e.id)),
    [['pd-2026-25'], ['pd-2026-26'], ['pd-2026-22']]);
  // `cutoff_passed` follows the clock.
  f.advance(ny('2026-12-01', '16:59:59'));
  assert.equal(list({start: '2026-12-04', end: '2026-12-04'})[0].cutoff_passed, false);
  f.advance(ny('2026-12-01', '17:00:00'));
  assert.equal(list({start: '2026-12-04', end: '2026-12-04'})[0].cutoff_passed, true);
  // Control: a window that ends before it starts.
  unchanged(f, () => f.call('calendar.list', {start: '2026-12-10', end: '2026-12-01'}), 'invalid_window');
});

test('T01b [W1] employment: the account, the five rule values of the employer, the company holidays and the flags', () => {
  const f = start(), read = f.call('employment.get');
  assert.deepEqual(pick(read, 'account_id', 'now'), [ACCOUNT, NOW]);
  assert.deepEqual(read.employer.rules, {leave_notice_days: 14, sick_backdate_days: 7, inquiry_window_days: 60, max_retirement_percent: 50, pay_periods_per_year: 26});
  assert.deepEqual([read.employer.timezone, read.employer.holidays.length, read.employer.holidays.includes('2026-12-25')], ['America/New_York', 11, true]);
  assert.deepEqual(pick(read.employment, 'name', 'pay_type'), ['Kai Moreno', 'salary']);
  assert.deepEqual(read.employment.manager, {person_id: MANAGER, name: 'Adaeze Okoro', job_title: 'Operations Manager'});
  // The personal time of 16.0 hours is above its cap of 0, so it is expiring on 31 December. No change is waiting yet.
  assert.deepEqual(read.flags, ['leave_expiring']);
});

test('T02 [W1] statements: earnings 3,200.00, taxes 640.00, medical 120.00 and retirement 5 percent read deductions 280.00 and net pay 2,280.00, paid as 300.00 and 1,980.00', () => {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  const statement = statementOf(f, 'ps-2026-24');
  assert.deepEqual(statement.earnings, [{...SALARY, inquiry_id: null}]);
  assert.deepEqual(statement.taxes, TAXES);
  assert.deepEqual(statement.deductions, [{line_id: 'd1', ...MEDICAL_LINE}, {line_id: 'd2', ...RETIREMENT_LINE}]);
  assert.deepEqual(pick(statement, 'earnings_total', 'taxes_total', 'deductions_total', 'net_pay', 'flags'), [3200, 640, 280, 2280, []]);
  // A setup of 300.00 fixed to savings and the remainder to checking.
  assert.deepEqual(statement.settings_used.deposit.accounts, OLD_SETUP);
  assert.deepEqual(deposits(statement), [['4410', 300, 'sent'], ['7731', 1980, 'sent']]);
  assert.deepEqual(pick(statement, 'entry_id', 'pay_date', 'period_start', 'period_end', 'posted_at', 'event_id', 'last_inquiry_day'),
    ['pd-2026-24', '2026-11-20', '2026-11-02', '2026-11-15', '2026-11-20T06:00:00-05:00', 'ev-pl-401', '2027-01-19']);
  // The settings it used: the locked withholding change chg-0006, retirement at 5 percent and the 2026 election set.
  assert.deepEqual(pick(statement.settings_used, 'retirement', 'election_set_id', 'change_ids'), [{percent: 5}, 'els-0001', ['chg-0006']]);
  assert.equal(statement.settings_used.withholding.extra_withholding, 25);
  // The two statements of the seed read the same amounts.
  for (const id of ['ps-2026-22', 'ps-2026-23']) assert.deepEqual(pick(statementOf(f, id), 'deductions_total', 'net_pay'), [280, 2280], id);
  // The list has one row for each statement, by pay date, with the totals. `start` and `end` are pay dates, both included.
  const rows = args => f.call('pay_statements.list', args).items;
  assert.deepEqual(rows().map(row => pick(row, 'id', 'net_pay', 'deductions_total')), [['ps-2026-22', 2280, 280], ['ps-2026-23', 2280, 280], ['ps-2026-24', 2280, 280]]);
  assert.deepEqual(rows()[2], {id: 'ps-2026-24', entry_id: 'pd-2026-24', pay_date: '2026-11-20', period_start: '2026-11-02', period_end: '2026-11-15',
    posted_at: '2026-11-20T06:00:00-05:00', earnings_total: 3200, taxes_total: 640, deductions_total: 280, net_pay: 2280, flags: []});
  assert.deepEqual(rows({start: '2026-11-06', end: '2026-11-20'}).map(row => row.id), ['ps-2026-23', 'ps-2026-24']);
  // Controls: an unknown statement, and a window that ends before it starts.
  unchanged(f, () => f.call('pay_statements.get', {id: 'ps-2026-99'}), 'not_found');
  unchanged(f, () => f.call('pay_statements.list', {start: '2026-12-01', end: '2026-11-01'}), 'invalid_window');
});

test('T03 [W1] settings and changes: each setting shows the value in use and any change that is waiting or locked, and the pay date that a change made now applies to', () => {
  const f = start(), {settings, next_change_applies_to, now} = f.call('settings.get');
  assert.equal(now, NOW);
  assert.deepEqual(settings.deposit, {in_use: {accounts: OLD_SETUP}, waiting: null, locked: null});
  assert.deepEqual(settings.retirement, {in_use: {percent: 5}, waiting: null, locked: null});
  // chg-0006 was made on 16 November, before the cut-off of 17 November, so it is locked for the run of 20 November.
  assert.deepEqual([settings.withholding.in_use, settings.withholding.waiting], [FORM, null]);
  assert.deepEqual(pick(settings.withholding.locked, 'id', 'state', 'applies_to'), ['chg-0006', 'locked', RUN_24]);
  assert.deepEqual(next_change_applies_to, RUN_25);
  // The list of changes, by the time they were made, with the state read now.
  const list = args => f.call('changes.list', args).items.map(change => [change.id, change.state]);
  assert.deepEqual(list(), [['chg-0004', 'applied'], ['chg-0005', 'cancelled'], ['chg-0006', 'locked']]);
  const cancelled = changeOf(f, 'chg-0005');
  assert.deepEqual(pick(cancelled, 'setting', 'applies_to', 'cancelled_at', 'request_id'), ['deposit', null, '2026-11-15T09:30:00-05:00', 'req-kai-chg-0005']);
  assert.deepEqual(changeOf(f, 'chg-0004').applies_to, {entry_id: 'pd-2026-22', pay_date: '2026-10-23', cutoff_at: '2026-10-20T17:00:00-04:00'});
  // A new change waits for the run of 4 December, and the account reads change_waiting.
  const made = f.call('retirement.set', {id: ACCOUNT, percent: 6});
  assert.deepEqual(made, {id: 'chg-0007', state: 'waiting', applies_to: RUN_25});
  assert.deepEqual(pick(f.call('settings.get').settings.retirement.waiting, 'id', 'value', 'state', 'made_at'), ['chg-0007', {percent: 6}, 'waiting', NOW]);
  assert.ok(f.call('employment.get').flags.includes('change_waiting'));
  // Filters: the setting, the state read now, and the day the change was made (both days included).
  assert.deepEqual([list({setting: 'retirement'}), list({state: 'waiting'}), list({start: '2026-11-16', end: '2026-11-19'}), list({end: '2026-10-31'})],
    [[['chg-0004', 'applied'], ['chg-0007', 'waiting']], [['chg-0007', 'waiting']], [['chg-0006', 'locked'], ['chg-0007', 'waiting']], [['chg-0004', 'applied']]]);
  unchanged(f, () => f.call('changes.list', {start: '2026-11-20', end: '2026-11-19'}), 'invalid_window');
});

test('T04 [W1] leave, benefits, inquiry, notification and preference reads', () => {
  const f = fixture({seed: SEED, now: NOW});
  // Vacation: 78.0 carried over and 23 accruals of 4.0, minus 88.0 taken, is 82.0, and the 32.0 hours of lv-0044 are pending.
  const rows = f.call('leave.balances').items;
  assert.deepEqual(rows.map(row => pick(row, 'leave_type_id', 'balance', 'pending_hours', 'approved_hours', 'available', 'expiring', 'carryover_cap', 'next_carryover_date')), [
    ['vacation', 82, 32, 0, 50, 0, 80, '2026-12-31'], ['personal', 16, 0, 0, 16, 16, 0, '2026-12-31'], ['sick', 66.5, 0, 0, 66.5, 0, null, null]]);
  assert.deepEqual([rows[0].entries.length, rows[0].entries[0].reason, rows[2].needs_notice], [24, 'carryover', false]);
  const leave = args => f.call('leave.list', args).items.map(request => [request.id, request.state]);
  assert.deepEqual(leave(), [['lv-0038', 'taken'], ['lv-0039', 'cancelled'], ['lv-0040', 'taken'], ['lv-0041', 'taken'], ['lv-0042', 'taken'], ['lv-0043', 'taken'], ['lv-0044', 'pending']]);
  // A request is in the window when its range overlaps it.
  assert.deepEqual([leave({id: 'sick'}), leave({state: 'pending'}), leave({start: '2026-07-10', end: '2026-08-24'}), leave({start: '2026-12-25'})],
    [[['lv-0043', 'taken']], [['lv-0044', 'pending']], [['lv-0040', 'taken'], ['lv-0041', 'taken']], [['lv-0044', 'pending']]]);
  const request = f.call('leave.list', {state: 'pending'}).items[0];
  assert.deepEqual(pick(request, 'days', 'hours', 'hours_per_day', 'flags'), [['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24'], 32, 8, []]);
  assert.ok(!('stored_state' in request));

  // Benefits: the 2026 window is closed and its set is final.
  assert.deepEqual(f.call('benefits.windows').items, [{id: 'win-2026', plan_year: 2026, state: 'closed', opens_at: '2025-11-17T00:00:00-05:00',
    closes_at: '2025-12-05T23:59:59-05:00', plan_ids: ['medical', 'dental', 'vision', 'fsa'], set_id: 'els-0001', set_state: 'final'}]);
  const window = windowOf(f, 'win-2026');
  assert.deepEqual([window.state, window.set.state, window.set.choices.map(row => row.plan_id), window.saves.length], ['closed', 'final', ['medical', 'dental', 'vision', 'fsa'], 4]);
  assert.deepEqual(window.plans.map(plan => [plan.id, plan.kind, plan.rolls_over, plan.yearly_max]),
    [['medical', 'options', true, null], ['dental', 'options', true, null], ['vision', 'options', true, null], ['fsa', 'yearly_amount', false, 3200]]);

  // Inquiries: one answered on a line, and one open on the whole statement of 6 November.
  const inquiries = args => f.call('inquiries.list', args).items.map(q => [q.id, q.statement_id, q.line_id, q.state]);
  assert.deepEqual(inquiries(), [['inq-0005', 'ps-2026-22', 't1', 'answered'], ['inq-0006', 'ps-2026-23', null, 'open']]);
  assert.deepEqual([inquiries({id: 'ps-2026-23'}), inquiries({state: 'answered'}), inquiries({id: 'ps-2026-22', state: 'open'})],
    [[['inq-0006', 'ps-2026-23', null, 'open']], [['inq-0005', 'ps-2026-22', 't1', 'answered']], []]);
  assert.deepEqual(pick(f.call('inquiries.list', {state: 'answered'}).items[0].answer, 'outcome', 'correction_amount', 'answered_by'), ['no_change', null, 'Payroll']);

  // Notifications: the list shows whether a notification has a wire message, and not the message. The window is the day it was written.
  const notes = args => f.call('notifications.list', args).items.map(n => n.id);
  assert.deepEqual([notes(), notes({start: '2026-10-29', end: '2026-11-06'}), notes({start: '2026-11-07'})], [['ntf-0069', 'ntf-0070', 'ntf-0071'], ['ntf-0070', 'ntf-0071'], []]);
  const {email, ...row} = SEED.notifications[0];
  assert.deepEqual(f.call('notifications.list').items[0], {...row, email_stored: true});
  assert.deepEqual(f.call('preferences.get'), {preferences: {timezone: 'America/New_York', email_notices: true}, now: NOW});

  // Controls: unknown IDs, and a window that ends before it starts. `not_found` is the earlier error of the table.
  for (const [name, args] of [['leave.list', {id: 'holiday'}], ['inquiries.list', {id: 'ps-2026-99'}], ['benefits.get', {id: 'win-2099'}], ['leave.preview', {...WINTER, id: 'holiday'}]]) {
    unchanged(f, () => f.call(name, args), 'not_found', name);
  }
  for (const name of ['leave.list', 'notifications.list']) unchanged(f, () => f.call(name, {start: '2026-12-02', end: '2026-12-01'}), 'invalid_window', name);
  unchanged(f, () => f.call('leave.list', {id: 'holiday', start: '2026-12-02', end: '2026-12-01'}), 'not_found', 'leave.list with both errors');
});

test('T04b [W1] reads: every read returns now with the UTC offset of the employer and leaves the business data byte-identical, leave.preview included', () => {
  const f = fixture({seed: SEED, now: NOW});
  walk(f, {run: s => s.event(PLAN['ev-pl-401']), open: s => s.event(PLAN['ev-pl-440'])});
  f.advance(ny('2026-12-02', '10:30:00'));
  f.call('deposit.update', {id: ACCOUNT, accounts: NEW_SETUP});
  const before = JSON.stringify(f.data), results = everyRead(f);
  assert.equal(JSON.stringify(f.data), before);
  assert.deepEqual([...new Set(results.map(([name]) => name))].sort(), [...READS].sort());
  for (const [name, result] of results) assert.equal(result.now, ny('2026-12-02', '10:30:00'), name);
  // A preview that breaks rules lists them, and it writes nothing.
  const failing = results.filter(([name, result]) => name === 'leave.preview' && !result.allowed);
  assert.ok(failing.length === 3 && failing.every(([, result]) => result.failures.length > 0));
  // The clock is shown in the time zone of the employer, whatever the time zone of the supplied instant.
  f.advance('2026-12-25T17:00:00Z');
  assert.equal(f.call('preferences.get').now, ny('2026-12-25', '12:00:00'));
});

test('T05 [W2] split: fixed amounts first, then each percentage of what is left after them (rounded down to the cent), then the remainder', () => {
  const f = start();
  const setup = [{...SAVINGS, amount: 300}, {...TRAVEL, percent: 33.3}, {...CHECKING, remainder: true}];
  assert.deepEqual(f.call('deposit.update', {id: ACCOUNT, accounts: setup}), {id: 'chg-0007', state: 'waiting', applies_to: RUN_25});
  assert.deepEqual(changeOf(f, 'chg-0007').value, {accounts: setup});
  // The run of 20 November still uses the old setup. The run of 4 December has taxes of 640.01, so net pay is 2,279.99.
  f.event(PLAN['ev-pl-401']);
  f.event(run('pd-2026-25', '2026-12-04', {taxes: [TAXES[0], {...TAXES[1], amount: 228.01}]}));
  const s = statementOf(f, 'ps-2026-25');
  // 33.3 percent of the 1,979.99 left after the fixed amount is 659.33667, rounded down to 659.33. The remainder takes the rest.
  assert.deepEqual([s.net_pay, deposits(s), s.flags], [2279.99, [['4410', 300, 'sent'], ['9020', 659.33, 'sent'], ['7731', 1320.66, 'sent']], []]);
  assert.deepEqual(deposits(statementOf(f, 'ps-2026-24')), [['4410', 300, 'sent'], ['7731', 1980, 'sent']]);
  // Percentages of 100 in total leave nothing for the remainder, and no deposit is written for an amount of zero.
  f.call('deposit.update', {id: ACCOUNT, accounts: [{...TRAVEL, percent: 60}, {...SAVINGS, percent: 40}, {...CHECKING, remainder: true}]});
  f.event(run('pd-2026-26', '2026-12-18'));
  assert.deepEqual(deposits(statementOf(f, 'ps-2026-26')), [['9020', 1368, 'sent'], ['4410', 912, 'sent']]);
  // One account for the remainder alone is a setup too.
  assert.equal(f.call('deposit.update', {id: ACCOUNT, accounts: [{...CHECKING, remainder: true}]}).state, 'waiting');
});

test('T05b [W2] split: a setup with no account for the remainder, two of them, four accounts or percentages above 100 returns invalid_split', () => {
  const f = start(), update = accounts => () => f.call('deposit.update', {id: ACCOUNT, accounts});
  const ONE_REMAINDER = 'exactly one account that takes the remainder';
  // Control of the plan: a setup with no account for the remainder.
  unchanged(f, update([{...SAVINGS, amount: 300}, {...CHECKING, percent: 50}]), 'invalid_split', 'no remainder', ONE_REMAINDER);
  unchanged(f, update([{...SAVINGS, remainder: true}, {...CHECKING, remainder: true}]), 'invalid_split', 'two remainders', ONE_REMAINDER);
  unchanged(f, update([{...SAVINGS, amount: 300}, {...TRAVEL, amount: 50}, {...NEW_CHECKING, percent: 10}, {...CHECKING, remainder: true}]), 'invalid_split',
    'four accounts', 'at most three accounts');
  unchanged(f, update([{...SAVINGS, percent: 60}, {...TRAVEL, percent: 40.1}, {...CHECKING, remainder: true}]), 'invalid_split', 'above 100', 'above 100 in total');
  // `not_found` is the earlier error of the table. A third decimal is refused before any App error, and the input schema refuses zero amounts.
  unchanged(f, () => f.call('deposit.update', {id: 'payleaf-other', accounts: [{...SAVINGS, amount: 300}]}), 'not_found', 'another account and no remainder');
  unchanged(f, () => f.call('deposit.update', {id: 'payleaf-other', accounts: [{...SAVINGS, amount: 300.001}]}), 'invalid_arguments', 'a third decimal');
  unchanged(f, update([{...SAVINGS, percent: 33.33}, {...CHECKING, remainder: true}]), 'invalid_arguments', 'a percentage with two decimals');
  for (const [label, account] of [['amount 0', {...SAVINGS, amount: 0}], ['percent 0', {...SAVINGS, percent: 0}], ['five digits', {...SAVINGS, last4: '44100', amount: 1}],
    ['amount and percent', {...SAVINGS, amount: 1, percent: 1}]]) unchanged(f, update([account, {...CHECKING, remainder: true}]), SCHEMA, label);
});

test('T06 [W2] cut-off: a new account on Wednesday 2 December waits for 18 December, so 4 December still pays the old accounts and 18 December pays the new ones', () => {
  const f = start(), {newAccount} = walk(f, PAY_PATH, 'newAccount');
  // The cut-off of 4 December was Tuesday 1 December at 17:00, so the change applies to the next run.
  assert.deepEqual(newAccount, {id: 'chg-0007', state: 'waiting', applies_to: RUN_26});
  const {settings, next_change_applies_to} = f.call('settings.get');
  assert.deepEqual([settings.deposit.waiting.id, settings.deposit.waiting.applies_to.pay_date, next_change_applies_to.pay_date], ['chg-0007', '2026-12-18', '2026-12-18']);
  assert.deepEqual(settings.deposit.in_use, {accounts: OLD_SETUP});
  PAY_PATH.run4Dec(f);
  assert.deepEqual(deposits(statementOf(f, 'ps-2026-25')), [['4410', 300, 'sent'], ['7731', 1980, 'sent']]);
  assert.deepEqual([changeOf(f, 'chg-0007').state, statementOf(f, 'ps-2026-25').settings_used.change_ids], ['waiting', []]);
  for (const step of ['inquiry', 'retirement', 'answer', 'run18Dec']) PAY_PATH[step](f);
  const s = statementOf(f, 'ps-2026-26');
  assert.deepEqual(deposits(s), [['4410', 300, 'sent'], ['5520', 2296.5, 'sent']]);
  assert.deepEqual([changeOf(f, 'chg-0007').state, s.settings_used.change_ids], ['applied', ['chg-0007', 'chg-0008']]);
  assert.deepEqual(f.call('settings.get').settings.deposit, {in_use: {accounts: NEW_SETUP}, waiting: null, locked: null});
});

test('T06b [W2] cut-off: a change made on 30 November reaches 4 December, and changes.cancel after the cut-off returns too_late', () => {
  // The seed's withholding change chg-0006 was locked by the cut-off of 17 November.
  const f = start();
  unchanged(f, () => f.call('changes.cancel', {id: 'chg-0006'}), 'too_late', 'cancel the locked change of the seed');
  f.event(PLAN['ev-pl-401']);
  f.advance(ny('2026-11-30', '10:00:00'));
  const early = f.call('retirement.set', {id: ACCOUNT, percent: 6});
  assert.deepEqual(early, {id: 'chg-0007', state: 'waiting', applies_to: RUN_25});
  // A change made one second before the cut-off reaches 4 December. A change made at the cut-off does not.
  const g = start();
  g.advance(ny('2026-12-01', '16:59:59'));
  assert.deepEqual(g.call('withholding.update', {id: ACCOUNT, form: FORM}).applies_to, RUN_25);
  g.advance(ny('2026-12-01', '17:00:00'));
  assert.deepEqual(g.call('withholding.update', {id: ACCOUNT, form: FORM}).applies_to, RUN_26);
  // The clock reaches the cut-off: the change reads locked, with no App event.
  f.advance(ny('2026-12-01', '17:00:00'));
  assert.deepEqual([changeOf(f, 'chg-0007').state, f.call('settings.get').settings.retirement.locked.id], ['locked', 'chg-0007']);
  unchanged(f, () => f.call('changes.cancel', {id: 'chg-0007'}), 'too_late', 'cancel after the cut-off', 'The change is locked');
  f.event(run('pd-2026-25', '2026-12-04'));
  const s = statementOf(f, 'ps-2026-25');
  assert.deepEqual([deductions(s), s.settings_used.retirement, s.settings_used.change_ids], [[['medical', 120], ['retirement', 192]], {percent: 6}, ['chg-0007']]);
  assert.equal(changeOf(f, 'chg-0007').state, 'applied');
  // A stored state does not change again, so an applied change cannot be cancelled.
  unchanged(f, () => f.call('changes.cancel', {id: 'chg-0007'}), 'invalid_state', 'cancel an applied change');
  unchanged(f, () => f.call('changes.cancel', {id: 'chg-9999'}), 'not_found');
});

test('T06c [W2] cut-off: a newer change for the same run replaces the older one, and cancelling it before the cut-off brings the older one back', () => {
  const f = start();
  const first = f.call('retirement.set', {id: ACCOUNT, percent: 6}).id;
  f.advance(ny('2026-11-20', '08:00:00'));
  const second = f.call('retirement.set', {id: ACCOUNT, percent: 7}).id;
  assert.deepEqual([changeOf(f, first).state, changeOf(f, second).state], ['replaced', 'waiting']);
  unchanged(f, () => f.call('changes.cancel', {id: first}), 'invalid_state', 'cancel a replaced change');
  assert.deepEqual(f.call('changes.cancel', {id: second}), {id: second});
  assert.deepEqual([changeOf(f, first).state, changeOf(f, second).state, f.call('settings.get').settings.retirement.waiting.id], ['waiting', 'cancelled', first]);
  unchanged(f, () => f.call('changes.cancel', {id: second}), 'invalid_state', 'cancel a cancelled change');
  // A third change replaces the first again. At the run, the latest one is applied and the earlier ones are stored as replaced.
  f.advance(ny('2026-11-21'));
  const third = f.call('retirement.set', {id: ACCOUNT, percent: 9}).id;
  // A change made after the cut-off of 17 November does not replace the locked change chg-0006 of the run of 20 November.
  const form = f.call('withholding.update', {id: ACCOUNT, form: {...FORM, extra_withholding: 40}});
  assert.deepEqual([form.applies_to, changeOf(f, 'chg-0006').state], [RUN_25, 'locked']);
  f.event(run('pd-2026-24', '2026-11-21', {time: '10:00:00'}));
  assert.deepEqual([changeOf(f, 'chg-0006').state, changeOf(f, form.id).state], ['applied', 'waiting']);
  f.event(run('pd-2026-25', '2026-12-04'));
  assert.deepEqual([first, second, third, form.id].map(id => changeOf(f, id).state), ['replaced', 'cancelled', 'applied', 'applied']);
  const s = statementOf(f, 'ps-2026-25');
  assert.deepEqual([s.settings_used.change_ids, s.settings_used.retirement, s.settings_used.withholding.extra_withholding], [[form.id, third], {percent: 9}, 40]);
  // The run stores the states, so they stay as they are when the clock moves on.
  f.advance(ny('2027-01-04'));
  assert.deepEqual([first, second, third].map(id => changeOf(f, id).state), ['replaced', 'cancelled', 'applied']);
  assert.deepEqual(pick(f.data.changes.find(change => change.id === first), 'stored_state', 'entry_id'), ['replaced', 'pd-2026-25']);
});

test('T06d [W2] cut-off: a change made while no run is planned waits with no pay date, until calendar.changed adds a run', () => {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  f.event(run('pd-2026-25', '2026-12-04'));
  f.event(run('pd-2026-26', '2026-12-18'));
  f.advance(ny('2026-12-18', '10:00:00'));
  assert.equal(f.call('settings.get').next_change_applies_to, null);
  const change = f.call('retirement.set', {id: ACCOUNT, percent: 6});
  assert.deepEqual(change, {id: 'chg-0007', state: 'waiting', applies_to: null});
  assert.deepEqual(pick(f.call('settings.get').settings.retirement.waiting, 'state', 'applies_to'), ['waiting', null]);
  // The waiting change applies to the run that the new calendar gives, from the next read.
  f.event(added(ny('2026-12-18', '11:00:00'), ...ENTRY_27));
  const RUN_27 = {entry_id: 'pd-2026-27', pay_date: '2026-12-31', cutoff_at: '2026-12-29T17:00:00-05:00'};
  assert.deepEqual(pick(changeOf(f, 'chg-0007'), 'state', 'applies_to'), ['waiting', RUN_27]);
  f.event(run('pd-2026-27', '2026-12-31'));
  assert.deepEqual([changeOf(f, 'chg-0007').state, statementOf(f, 'ps-2026-27').settings_used.retirement], ['applied', {percent: 6}]);
});

test('T07 [W2] pay run: the run of 20 November makes its entry paid, writes its statement, applies its changes, adds the leave hours and updates the settings', () => {
  const f = start(), before = f.data;
  f.event(PLAN['ev-pl-401']);
  const data = f.data, entry = data.calendar.find(e => e.id === 'pd-2026-24');
  assert.deepEqual(pick(entry, 'state', 'statement_id'), ['paid', 'ps-2026-24']);
  assert.deepEqual(entry.history, [{at: '2026-11-20T06:00:00-05:00', action: 'paid', event_id: 'ev-pl-401', from: null, to: null, reason: null}]);
  assert.equal(data.statements.length, before.statements.length + 1);
  assert.deepEqual(pick(data.changes.find(change => change.id === 'chg-0006'), 'stored_state', 'entry_id'), ['applied', 'pd-2026-24']);
  assert.deepEqual(data.settings, {...before.settings, withholding: {...FORM, extra_withholding: 25}});
  // One leave entry for each leave type that earns hours: 4.0 of vacation and 1.5 of sick leave. Personal time earns none.
  assert.deepEqual(data.leave_entries.slice(before.leave_entries.length), [
    {id: 'le-r0147', leave_type_id: 'vacation', at: '2026-11-20T06:00:00-05:00', hours: 4, reason: 'accrual', note: null, statement_id: 'ps-2026-24', event_id: 'ev-pl-401'},
    {id: 'le-r0148', leave_type_id: 'sick', at: '2026-11-20T06:00:00-05:00', hours: 1.5, reason: 'accrual', note: null, statement_id: 'ps-2026-24', event_id: 'ev-pl-401'}]);
  assert.deepEqual(f.call('leave.balances').items.map(row => [row.leave_type_id, row.balance]), [['vacation', 86], ['personal', 16], ['sick', 68]]);
  // The deposits get the next deposit IDs. Net pay is earnings minus taxes minus deductions.
  assert.deepEqual(statementOf(f, 'ps-2026-24').deposits.map(d => [d.id, d.amount, d.history]), [
    ['dep-0190', 300, [{at: '2026-11-20T06:00:00-05:00', state: 'sent', reason: null, event_id: 'ev-pl-401'}]],
    ['dep-0191', 1980, [{at: '2026-11-20T06:00:00-05:00', state: 'sent', reason: null, event_id: 'ev-pl-401'}]]]);
});

test('T07b [W2] pay run: retirement is rounded half up on the salary lines only, and a reimbursement line is paid in full', () => {
  const f = start();
  // 5 percent of a salary of 3,200.10 is 160.005, rounded half up to 160.01. The bonus and the reimbursement are not salary.
  f.event(run('pd-2026-24', '2026-11-20', {earnings: [{...SALARY, amount: 3200.1}, {line_id: 'e2', kind: 'bonus', text: 'Year-end bonus', amount: 500},
    {line_id: 'e3', kind: 'reimbursement', text: 'Parking', amount: 12.34}]}));
  const s = statementOf(f, 'ps-2026-24');
  assert.deepEqual(deductions(s), [['medical', 120], ['retirement', 160.01]]);
  // 3,712.44 earned, minus 640.00 of taxes, minus 280.01 of deductions.
  assert.deepEqual(pick(s, 'earnings_total', 'deductions_total', 'net_pay'), [3712.44, 280.01, 2792.43]);
  assert.deepEqual(deposits(s), [['4410', 300, 'sent'], ['7731', 2492.43, 'sent']]);
});

test('T07c [W2] pay run: pay after taxes that does not cover a deduction takes it in part and skips the later ones (deductions_cut), and net pay below the fixed amounts fills them in order (short_deposit)', () => {
  const f = start();
  // After taxes of 3,100.00 only 100.00 is left: medical takes it, and retirement is not taken. Net pay is zero, so there is no deposit.
  f.event(run('pd-2026-24', '2026-11-20', {taxes: [{...TAXES[0], amount: 3100}]}));
  const cut = statementOf(f, 'ps-2026-24');
  assert.deepEqual(cut.deductions.map(d => [d.line_id, d.kind, d.due, d.amount]), [['d1', 'benefit', 120, 100], ['d2', 'retirement', 160, 0]]);
  assert.deepEqual([cut.net_pay, cut.deposits, cut.flags], [0, [], ['short_deposit', 'deductions_cut']]);
  // After taxes of 2,670.00 net pay is 250.00, which fills only a part of the 300.00 fixed to savings. Nothing is left for checking.
  f.event(run('pd-2026-25', '2026-12-04', {taxes: [{...TAXES[0], amount: 2670}]}));
  const short = statementOf(f, 'ps-2026-25');
  assert.deepEqual([short.net_pay, deposits(short), short.flags], [250, [['4410', 250, 'sent']], ['short_deposit']]);
  // Two fixed amounts are filled in order: 2,000.00, then the 280.00 that is left of the second one.
  f.call('deposit.update', {id: ACCOUNT, accounts: [{...TRAVEL, amount: 2000}, {...SAVINGS, amount: 500}, {...CHECKING, remainder: true}]});
  f.event(run('pd-2026-26', '2026-12-18'));
  const filled = statementOf(f, 'ps-2026-26');
  assert.deepEqual([filled.net_pay, deposits(filled), filled.flags], [2280, [['9020', 2000, 'sent'], ['4410', 280, 'sent']], ['short_deposit']]);
  assert.match(f.data.notifications[f.data.notifications.length - 1].text, /The fixed deposit amounts were not paid in full/);
});

test('T07d [W2] pay run: a yearly amount costs that amount over pay_periods_per_year, rounded up to the cent, and never more than what is left of it', () => {
  // Three pay periods a year: 100.00 is 33.34 on each pay. The seed's two statements of 2026 took 66.68, so 33.32 is left.
  const f = fixture({seed: covered({yearly: 100, perPay: 33.34, periods: 3}), now: NOW});
  f.event(PLAN['ev-pl-401']);
  assert.deepEqual(deductions(statementOf(f, 'ps-2026-24')), [['medical', 120], ['fsa', 33.32], ['retirement', 160]]);
  assert.equal(statementOf(f, 'ps-2026-24').deductions[1].text, 'Health care spending account: 100.00 a year');
  // Nothing is left for the next run, so it has no line for the spending account.
  f.event(run('pd-2026-25', '2026-12-04'));
  assert.deepEqual(deductions(statementOf(f, 'ps-2026-25')), [['medical', 120], ['retirement', 160]]);
  // 1,000.00 over 26 pay periods is 38.4615, rounded up to 38.47 on the first pay of 2027.
  const g = fixture({seed: covered(), now: NOW});
  enroll(g, 'spending');
  g.call('benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 1000});
  for (const step of ['submit', 'run4Dec', 'closed', 'runs']) ENROLL_PATH[step](g);
  assert.deepEqual(deductions(statementOf(g, 'ps-2027-01')), [['medical', 95], ['fsa', 38.47], ['retirement', 160]]);
});

test('T08 [W2] withholding and retirement: retirement.set to 8 on 10 December gives the run of 18 December deductions of 376.00', () => {
  const f = start(), {retirement} = walk(f, PAY_PATH, 'retirement');
  assert.deepEqual(retirement, {id: 'chg-0008', state: 'waiting', applies_to: RUN_26});
  for (const step of ['answer', 'run18Dec']) PAY_PATH[step](f);
  const s = statementOf(f, 'ps-2026-26');
  // Medical 120.00 and 8 percent of the salary of 3,200.00, which is 256.00.
  assert.deepEqual([deductions(s), s.deductions_total, s.settings_used.retirement], [[['medical', 120], ['retirement', 256]], 376, {percent: 8}]);
  assert.equal(s.deductions[1].text, 'Retirement savings at 8 percent');
  // The run of 4 December, before the change, still took 5 percent.
  assert.equal(statementOf(f, 'ps-2026-25').deductions_total, 280);
});

test('T08b [W2] withholding and retirement: the withholding form is stored and shown, Payleaf computes no tax, and the retirement percentage has its limits', () => {
  const f = start(), form = {filing_status: 'married_jointly', multiple_jobs: true, dependents_amount: 2000, other_income: 150.5, deductions: 0, extra_withholding: 30};
  const change = f.call('withholding.update', {id: ACCOUNT, form});
  assert.deepEqual(change, {id: 'chg-0007', state: 'waiting', applies_to: RUN_25});
  assert.deepEqual(f.call('settings.get').settings.withholding.waiting.value, form);
  f.event(PLAN['ev-pl-401']);
  f.event(run('pd-2026-25', '2026-12-04'));
  const s = statementOf(f, 'ps-2026-25');
  // The taxes are the ones of the event. The new form is only recorded as used.
  assert.deepEqual([s.taxes, s.settings_used.withholding, s.settings_used.change_ids], [TAXES, form, ['chg-0007']]);
  assert.deepEqual(f.call('settings.get').settings.withholding.in_use, form);
  // 0 stops saving, so the run has no retirement line. 50 is the maximum of the employer.
  assert.equal(f.call('retirement.set', {id: ACCOUNT, percent: 50}).state, 'waiting');
  assert.equal(f.call('retirement.set', {id: ACCOUNT, percent: 0}).state, 'waiting');
  f.event(run('pd-2026-26', '2026-12-18'));
  assert.deepEqual(deductions(statementOf(f, 'ps-2026-26')), [['medical', 120]]);
  // Controls. `not_found` is the earlier error of the table.
  const set = (id, percent) => () => f.call('retirement.set', {id, percent});
  unchanged(f, set(ACCOUNT, 50.5), 'over_limit', 'above the maximum', 'above the plan maximum of 50 percent');
  unchanged(f, set('payleaf-other', 60), 'not_found', 'another account and above the maximum');
  unchanged(f, set(ACCOUNT, 5.55), 'invalid_arguments', 'two decimals');
  for (const percent of [-1, 101]) unchanged(f, set(ACCOUNT, percent), SCHEMA, 'percent ' + percent);
  unchanged(f, () => f.call('withholding.update', {id: ACCOUNT, form: {...form, extra_withholding: 30.001}}), 'invalid_arguments', 'a third decimal');
  unchanged(f, () => f.call('withholding.update', {id: 'payleaf-other', form}), 'not_found', 'another account');
  unchanged(f, () => f.call('withholding.update', {id: ACCOUNT, form: {...form, filing_status: 'unknown'}}), SCHEMA, 'filing status');
});

test('T09 [W2] calendar events: a pay date moves until its run posts, a cut-off moves only before it passes, an entry is added, and a waiting change follows the new calendar', () => {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  const waiting = f.call('retirement.set', {id: ACCOUNT, percent: 6}).id;
  // ev-pl-402: the pay date of 4 December moves to Monday 7 December. The cut-off stays.
  f.event(PLAN['ev-pl-402']);
  const moved = f.call('calendar.list', {start: '2026-12-01', end: '2026-12-10'}).items[0];
  assert.deepEqual(pick(moved, 'id', 'pay_date', 'cutoff_at'), ['pd-2026-25', '2026-12-07', '2026-12-01T17:00:00-05:00']);
  assert.deepEqual(moved.history, [{at: '2026-11-23T10:15:00-05:00', action: 'moved', event_id: 'ev-pl-402', from: {pay_date: '2026-12-04', cutoff_at: RUN_25.cutoff_at},
    to: {pay_date: '2026-12-07', cutoff_at: RUN_25.cutoff_at}, reason: 'The bank holiday schedule.'}]);
  assert.deepEqual(changeOf(f, waiting).applies_to, {...RUN_25, pay_date: '2026-12-07'});
  // The cut-off has not passed, so it can move. It moves to Wednesday 2 December at 17:00.
  f.event(calendarChanged(ny('2026-11-24'), 'pd-2026-25', {cutoff_at: ny('2026-12-02', '17:00:00')}));
  f.advance(ny('2026-12-02', '10:00:00'));
  // A change made on 2 December now reaches the run of 7 December.
  assert.deepEqual(f.call('deposit.update', {id: ACCOUNT, accounts: NEW_SETUP}).applies_to, {entry_id: 'pd-2026-25', pay_date: '2026-12-07', cutoff_at: ny('2026-12-02', '17:00:00')});
  f.event(added(ny('2026-12-02', '11:00:00'), ...ENTRY_27, {reason: 'The pay date before the New Year holiday.'}));
  const entry = f.call('calendar.list', {start: '2026-12-31'}).items[0];
  assert.deepEqual(pick(entry, 'id', 'period_start', 'period_end', 'pay_date', 'cutoff_at', 'state', 'statement_id'),
    ['pd-2026-27', '2026-12-14', '2026-12-27', '2026-12-31', '2026-12-29T17:00:00-05:00', 'planned', null]);
  assert.deepEqual(entry.history[0], {at: ny('2026-12-02', '11:00:00'), action: 'added', event_id: 'ev-add-pd-2026-27', from: null,
    to: {pay_date: '2026-12-31', cutoff_at: '2026-12-29T17:00:00-05:00'}, reason: 'The pay date before the New Year holiday.'});
  // The pay date can still move after the cut-off has passed, while the run has not posted.
  f.advance(ny('2026-12-03'));
  f.event(calendarChanged(ny('2026-12-03'), 'pd-2026-25', {pay_date: '2026-12-08'}, 'ev-cal-pd-2026-25-again'));
  f.event(run('pd-2026-25', '2026-12-08'));
  const s = statementOf(f, 'ps-2026-25');
  assert.deepEqual([s.pay_date, s.settings_used.change_ids, deposits(s)], ['2026-12-08', ['chg-0008', waiting], [['4410', 300, 'sent'], ['5520', 1948, 'sent']]]);
});

test('T09b [W2] deposit events: a sent deposit is returned and then reissued, and the account reads deposit_returned in between', () => {
  const f = start(), state = id => f.call('pay_statements.get', {id: 'ps-2026-24'}).statement.deposits.find(d => d.id === id);
  f.event(PLAN['ev-pl-401']);
  assert.ok(!flags(f).includes('deposit_returned'));
  // ev-pl-410: the deposit to checking of 20 November is returned.
  f.event(PLAN['ev-pl-410']);
  assert.deepEqual(pick(state('dep-0191'), 'state', 'amount', 'reissued_to'), ['returned', 1980, null]);
  assert.ok(flags(f).includes('deposit_returned'));
  f.event(depositUpdated(ny('2026-12-09'), 'dep-0191', 'reissued', {reason: 'Sent to the new account.', reissued_to: {...NEW_CHECKING, kind: 'account'}}));
  assert.deepEqual(pick(state('dep-0191'), 'state', 'reissued_to'), ['reissued', {kind: 'account', label: 'New checking', last4: '5520'}]);
  assert.deepEqual(state('dep-0191').history.map(row => [row.state, row.event_id, row.reason]), [['sent', 'ev-pl-401', null],
    ['returned', 'ev-pl-410', 'The receiving account is closed.'], ['reissued', 'ev-dep-dep-0191-reissued', 'Sent to the new account.']]);
  assert.ok(!flags(f).includes('deposit_returned'));
  // A returned deposit can also be reissued as a check, with no account digits.
  f.event(depositUpdated(ny('2026-12-10'), 'dep-0190', 'returned'));
  f.event(depositUpdated(ny('2026-12-11'), 'dep-0190', 'reissued', {reissued_to: {kind: 'check', label: 'Paper check'}}));
  assert.deepEqual(state('dep-0190').reissued_to, {kind: 'check', label: 'Paper check', last4: null});
  // The statement itself does not change: its amounts and net pay stay.
  assert.deepEqual(pick(statementOf(f, 'ps-2026-24'), 'net_pay', 'deductions_total'), [2280, 280]);
});

test('T10 [W2] inquiries: a missing reimbursement of 412.50 on the statement of 4 December is asked once, answered as corrected, and paid on 18 December, for net pay of 2,596.50', () => {
  const f = start(), {inquiry} = walk(f, PAY_PATH, 'inquiry');
  assert.deepEqual(inquiry, {id: 'inq-0006'});
  const asked = f.call('inquiries.list', {id: 'ps-2026-25'}).items;
  assert.deepEqual(asked.map(q => pick(q, 'id', 'line_id', 'amount', 'state', 'opened_at', 'answer')), [['inq-0006', null, 412.5, 'open', ny('2026-12-04', '10:00:00'), null]]);
  // Control: a second inquiry on the same line, here the whole statement.
  unchanged(f, () => f.call('inquiries.open', {id: 'ps-2026-25', amount: 412.5, note: 'Again.'}), 'already_open', 'the whole statement again');
  for (const step of ['retirement', 'answer']) PAY_PATH[step](f);
  assert.deepEqual(pick(f.call('inquiries.list', {id: 'ps-2026-25'}).items[0], 'state', 'answer'), ['answered', {outcome: 'corrected', correction_amount: 412.5,
    answered_by: 'Payroll', note: 'The reimbursement will be on your next pay statement.', answered_at: '2026-12-10T14:00:00-05:00', event_id: 'ev-pl-420'}]);
  // The answer changes no statement. The money arrives on the next one, as a line that names the inquiry.
  assert.deepEqual(pick(statementOf(f, 'ps-2026-25'), 'net_pay', 'earnings_total'), [2280, 3200]);
  PAY_PATH.run18Dec(f);
  const s = statementOf(f, 'ps-2026-26');
  assert.deepEqual(s.earnings[1], REIMBURSEMENT);
  assert.deepEqual([s.earnings_total, s.taxes_total, s.deductions_total, s.net_pay, Math.round((s.net_pay - 412.5) * 100) / 100], [3612.5, 640, 376, 2596.5, 2184]);
});

test('T10b [W2] inquiries: a line has one open inquiry, a withdrawn one is asked again, and an inquiry 61 days after a pay date returns too_late', () => {
  const f = start(), ask = (id, line_id, note = 'Please check.') => () => f.call('inquiries.open', {id, ...(line_id ? {line_id} : {}), amount: 12.5, note});
  // The statement of 6 November. A line of it and the whole statement are two lines, so each can have an open inquiry.
  assert.deepEqual([ask('ps-2026-23', 't1')(), ask('ps-2026-23')()], [{id: 'inq-0006'}, {id: 'inq-0007'}]);
  unchanged(f, ask('ps-2026-23', 't1'), 'already_open', 'the same line', 'This statement line already has an open inquiry');
  // An inquiry is not edited: it is withdrawn, and asked again.
  assert.deepEqual(f.call('inquiries.withdraw', {id: 'inq-0006'}), {id: 'inq-0006'});
  assert.deepEqual(pick(f.call('inquiries.list', {state: 'withdrawn'}).items[0], 'id', 'withdrawn_at'), ['inq-0006', NOW]);
  unchanged(f, () => f.call('inquiries.withdraw', {id: 'inq-0006'}), 'invalid_state', 'withdraw a withdrawn inquiry');
  unchanged(f, () => f.call('inquiries.withdraw', {id: 'inq-0005'}), 'invalid_state', 'withdraw an answered inquiry');
  unchanged(f, () => f.call('inquiries.withdraw', {id: 'inq-9999'}), 'not_found');
  assert.deepEqual(ask('ps-2026-23', 't1', 'Please check the federal tax.')(), {id: 'inq-0008'});
  // A deduction line can be asked about too.
  assert.deepEqual(ask('ps-2026-22', 'd2')(), {id: 'inq-0009'});
  // The window is 60 days: the pay date of 6 November gives the last day 5 January. 6 January is day 61.
  f.advance(ny('2027-01-05', '23:59:59'));
  assert.deepEqual(ask('ps-2026-23', 'e1')(), {id: 'inq-0010'});
  f.advance(ny('2027-01-06', '00:00:00'));
  unchanged(f, ask('ps-2026-23', 't2'), 'too_late', 'day 61', 'The last day was 2027-01-05');
  // When two errors fit, the first one of the table wins: an unknown line before too_late, and too_late before already_open.
  unchanged(f, ask('ps-2026-23', 'x9'), 'not_found', 'an unknown line that is too late');
  unchanged(f, ask('ps-2026-23'), 'too_late', 'an open line that is too late');
  unchanged(f, ask('ps-2026-99'), 'not_found', 'an unknown statement');
  unchanged(f, () => f.call('inquiries.open', {id: 'ps-2026-23', amount: 1.005, note: 'x'}), 'invalid_arguments', 'a third decimal');
  unchanged(f, () => f.call('inquiries.open', {id: 'ps-2026-23', amount: 0, note: 'x'}), SCHEMA, 'amount 0');
});

test('T10c [W2] preferences: the time zone of notification text and email_notices', () => {
  const f = start();
  assert.deepEqual(f.call('preferences.update', {timezone: 'America/Los_Angeles'}), {id: ACCOUNT});
  assert.deepEqual(f.call('preferences.get').preferences, {timezone: 'America/Los_Angeles', email_notices: true});
  // The cut-off of Tuesday 1 December at 17:00 in New York is 14:00 in Los Angeles.
  f.event(PLAN['ev-pl-401']);
  f.event(PLAN['ev-pl-402']);
  assert.match(f.data.notifications[f.data.notifications.length - 1].text, /still accepted until Tuesday 1 December at 14:00\./);
  // The clock of every read stays in the time zone of the employer.
  assert.equal(f.call('preferences.get').now, '2026-11-23T10:15:00-05:00');
  f.call('preferences.update', {email_notices: false});
  assert.deepEqual(f.call('preferences.get').preferences, {timezone: 'America/Los_Angeles', email_notices: false});
  for (const timezone of ['Mars/Olympus', '+05:00', 'EST5EDT/x']) unchanged(f, () => f.call('preferences.update', {timezone}), 'invalid_timezone', timezone);
  unchanged(f, () => f.call('preferences.update', {}), 'invalid_arguments', 'no field');
});

const WINTER_DAYS = ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24'];
test('T11 [W3] preview and request: 21 to 25 December, with 25 December a holiday, is 4 working days and 32.0 hours, and the request leaves 54.0 hours available', () => {
  const f = start(), {preview} = walk(f, LEAVE_PATH, 'preview');
  // With 86.0 hours of vacation, a cap of 80 and a carryover date of 31 December, 6.0 hours are expiring.
  assert.deepEqual(pick(vacation(f), 'balance', 'carryover_cap', 'carryover_date', 'next_carryover_date', 'expiring', 'available'), [86, 80, '12-31', '2026-12-31', 6, 86]);
  assert.deepEqual(preview, {leave_type_id: 'vacation', start: '2026-12-21', end: '2026-12-25', hours_per_day: 8, days: WINTER_DAYS, working_days: 4, hours: 32,
    available_before: 86, available_after: 54, allowed: true, failures: [], now: ny('2026-12-02')});
  // Control: 96 hours with 86 available. Twelve working days from 4 to 19 January at 8.0 hours each.
  const january = {id: 'vacation', start: '2027-01-04', end: '2027-01-19', hours_per_day: 8};
  assert.deepEqual(pick(f.call('leave.preview', january), 'working_days', 'hours', 'allowed'), [12, 96, false]);
  unchanged(f, () => f.call('leave.request', january), 'insufficient_balance', '96 hours', 'The request needs 96.0 hours, and 86.0 hours of Vacation are available.');
  // Control: vacation that starts in 5 days, with 14 days of notice.
  unchanged(f, () => f.call('leave.request', {...WINTER, start: '2026-12-07', end: '2026-12-07'}), 'too_late', 'vacation in 5 days',
    'Vacation needs 14 days of notice. The first day must be 2026-12-16 or later.');
  assert.deepEqual(LEAVE_PATH.request(f), {id: 'lv-0044', state: 'pending', hours: 32});
  assert.deepEqual(pick(vacation(f), 'balance', 'pending_hours', 'approved_hours', 'available'), [86, 32, 0, 54]);
  assert.deepEqual(pick(requestOf(f, 'lv-0044'), 'leave_type_id', 'state', 'days', 'hours', 'hours_per_day', 'requested_at', 'note', 'flags'),
    ['vacation', 'pending', WINTER_DAYS, 32, 8, ny('2026-12-02'), null, []]);
  LEAVE_PATH.approval(f);
  // Control: days that overlap the approved request.
  unchanged(f, () => f.call('leave.request', {...WINTER, start: '2026-12-24', end: '2026-12-28'}), 'conflict', 'overlap', 'another pending, approved or taken request');
  // A note is kept, and half days are allowed.
  assert.equal(f.call('leave.request', {id: 'vacation', start: '2026-12-28', end: '2026-12-28', hours_per_day: 4.5, note: 'Half day.'}).hours, 4.5);
  assert.equal(requestOf(f, 'lv-0045').note, 'Half day.');
});

test('T11b [W3] preview and request: preview lists every rule that a request breaks, and the request returns the first one of the table', () => {
  const f = start();
  walk(f, LEAVE_PATH, 'request');
  const codes = args => f.call('leave.preview', args).failures.map(failure => failure.code);
  const refused = (args, code, label, text) => unchanged(f, () => f.call('leave.request', args), code, label, text);
  // 7 to 31 December: too soon, it overlaps lv-0044, and its 18 working days need 144.0 hours.
  const late = {id: 'vacation', start: '2026-12-07', end: '2026-12-31', hours_per_day: 8};
  assert.deepEqual(pick(f.call('leave.preview', late), 'working_days', 'hours', 'available_after', 'allowed'), [18, 144, -90, false]);
  assert.deepEqual(codes(late), ['too_late', 'conflict', 'insufficient_balance']);
  refused(late, 'too_late', 'too soon, overlapping and too long');
  // 14 days of notice: on 2 December the first day can be 16 December, and not 15 December.
  const oneDay = day => ({id: 'vacation', start: day, end: day, hours_per_day: 8});
  assert.deepEqual([codes(oneDay('2026-12-16')), codes(oneDay('2026-12-15'))], [[], ['too_late']]);
  // It overlaps lv-0044 and needs 112.0 hours: conflict comes before insufficient_balance.
  const overlap = {id: 'vacation', start: '2026-12-21', end: '2027-01-08', hours_per_day: 8};
  assert.deepEqual(codes(overlap), ['conflict', 'insufficient_balance']);
  refused(overlap, 'conflict', 'overlapping and too long');
  // A day that does not exist is refused the same way by preview, request and a list filter.
  for (const day of ['2026-11-31', '2027-02-29']) {
    unchanged(f, () => f.call('leave.preview', {id: 'sick', start: day, end: day, hours_per_day: 8}), 'invalid_arguments', 'preview of ' + day, 'not a real calendar date');
    refused({id: 'sick', start: day, end: day, hours_per_day: 8}, 'invalid_arguments', 'request of ' + day, 'not a real calendar date');
    unchanged(f, () => f.call('leave.list', {end: day}), 'invalid_arguments', 'list to ' + day, 'not a real calendar date');
  }
  // invalid_window: the last day before the first day, more than 30 days, or no working day. It comes before too_late and insufficient_balance.
  assert.deepEqual(codes({id: 'vacation', start: '2026-12-08', end: '2026-12-07', hours_per_day: 8}), ['invalid_window', 'too_late']);
  refused({id: 'vacation', start: '2026-12-08', end: '2026-12-07', hours_per_day: 8}, 'invalid_window', 'backwards and too soon', 'The last day is before the first day.');
  refused({id: 'vacation', start: '2027-01-04', end: '2027-02-03', hours_per_day: 1}, 'invalid_window', '31 days', 'A request covers at most 30 calendar days.');
  refused({id: 'vacation', start: '2026-12-26', end: '2026-12-27', hours_per_day: 8}, 'invalid_window', 'a weekend', 'The range has no working day.');
  refused({id: 'sick', start: '2026-12-25', end: '2026-12-25', hours_per_day: 8}, 'invalid_window', 'a company holiday', 'The range has no working day.');
  // 30 calendar days are allowed: sick leave from 26 November to 25 December, with 19 working days at 2.0 hours, apart from the days of lv-0044.
  assert.deepEqual(pick(f.call('leave.preview', {id: 'sick', start: '2026-11-26', end: '2026-12-25', hours_per_day: 2}), 'working_days', 'hours'), [19, 38]);
  assert.deepEqual(codes({id: 'sick', start: '2026-11-26', end: '2026-12-25', hours_per_day: 2}), ['conflict']);
  assert.deepEqual(codes({id: 'sick', start: '2026-11-26', end: '2026-12-20', hours_per_day: 2}), []);
  // Unknown leave type, the App's decimal check and the input schema.
  for (const name of ['leave.preview', 'leave.request']) unchanged(f, () => f.call(name, {...WINTER, id: 'holiday'}), 'not_found', name);
  refused({...WINTER, start: '2027-01-04', end: '2027-01-04', hours_per_day: 4.25}, 'invalid_arguments', 'two decimals');
  for (const hours_per_day of [0, 8.5]) refused({...WINTER, start: '2027-01-04', end: '2027-01-04', hours_per_day}, SCHEMA, 'hours ' + hours_per_day);
});

test('T12 [W3] decisions and cancelling: approve, deny, cancel while pending, cancel approved leave before its first day, and the states that cannot be cancelled', () => {
  const f = start();
  walk(f, LEAVE_PATH, 'approval');
  assert.deepEqual(pick(requestOf(f, 'lv-0044'), 'state', 'decided_at', 'decided_by', 'decision_note'), ['approved', '2026-12-03T11:30:00-05:00', MANAGER, 'Enjoy the break.']);
  assert.deepEqual(pick(vacation(f), 'pending_hours', 'approved_hours', 'available'), [0, 32, 54]);
  // A pending request is cancelled with its reason, and its hours are free again. A request is not edited: it is cancelled and asked again.
  const trip = {id: 'vacation', start: '2027-01-04', end: '2027-01-05', hours_per_day: 8};
  assert.equal(f.call('leave.request', trip).id, 'lv-0045');
  assert.equal(vacation(f).available, 38);
  assert.deepEqual(f.call('leave.cancel', {id: 'lv-0045', reason: 'The trip moved.'}), {id: 'lv-0045'});
  assert.deepEqual(pick(requestOf(f, 'lv-0045'), 'state', 'cancelled_at', 'cancel_reason'), ['cancelled', '2026-12-03T11:30:00-05:00', 'The trip moved.']);
  assert.equal(vacation(f).available, 54);
  assert.equal(f.call('leave.request', {...trip, end: '2027-01-06'}).id, 'lv-0046');
  // A denial frees the hours.
  f.event(decided(ny('2026-12-03', '14:00:00'), 'lv-0046', 'deny'));
  assert.deepEqual([requestOf(f, 'lv-0046').state, vacation(f).available], ['denied', 54]);
  // Denied, cancelled and taken requests cannot be cancelled. lv-0040 of the seed was taken in July.
  for (const id of ['lv-0046', 'lv-0045', 'lv-0040']) unchanged(f, () => f.call('leave.cancel', {id}), 'invalid_state', id);
  unchanged(f, () => f.call('leave.cancel', {id: 'lv-9999'}), 'not_found');
  // Approved leave can be cancelled until the end of the day before its first day. The decision stays on the request.
  f.advance(ny('2026-12-20', '23:59:59'));
  const g = fixture({seed: f.data, now: f.ctx.virtual_now});
  assert.deepEqual(g.call('leave.cancel', {id: 'lv-0044'}), {id: 'lv-0044'});
  assert.deepEqual([pick(requestOf(g, 'lv-0044'), 'state', 'decided_by'), vacation(g).available], [['cancelled', MANAGER], 86]);
  // From its first day it returns too_late, and once it is taken it returns invalid_state.
  f.advance(ny('2026-12-21', '00:00:00'));
  unchanged(f, () => f.call('leave.cancel', {id: 'lv-0044'}), 'too_late', 'on the first day', 'Approved leave can be cancelled only before its first day.');
  f.advance(ny('2026-12-26', '00:00:00'));
  unchanged(f, () => f.call('leave.cancel', {id: 'lv-0044'}), 'invalid_state', 'taken', 'The leave request is taken.');
});

test('T13 [W3] time-driven states: approved leave reads taken after 25 December, with no App event, and the balance is 54.0; a pending vacation request reads lapsed on its first day', () => {
  const f = start();
  walk(f, LEAVE_PATH, 'approval');
  f.advance(ny('2026-12-25', '23:59:59'));
  assert.equal(requestOf(f, 'lv-0044').state, 'approved');
  const before = f.data;
  LEAVE_PATH.taken(f);
  assert.deepEqual(f.data, before);
  assert.deepEqual(pick(requestOf(f, 'lv-0044'), 'state', 'flags'), ['taken', []]);
  assert.deepEqual(pick(vacation(f), 'balance', 'approved_hours', 'available'), [54, 0, 54]);
  assert.deepEqual(f.call('leave.list', {state: 'taken', start: '2026-12-01'}).items.map(r => r.id), ['lv-0044']);

  // A pending request that needs notice reads lapsing within the notice period, and lapsed on its first day. Its hours are free again.
  const g = start();
  walk(g, LEAVE_PATH, 'request');
  g.advance(ny('2026-12-07', '23:59:59'));
  assert.deepEqual(pick(requestOf(g, 'lv-0044'), 'state', 'flags'), ['pending', []]);
  g.advance(ny('2026-12-08', '00:00:00'));
  assert.deepEqual(pick(requestOf(g, 'lv-0044'), 'state', 'flags'), ['pending', ['lapsing']]);
  g.advance(ny('2026-12-20', '23:59:59'));
  assert.equal(vacation(g).available, 54);
  const pending = g.data;
  g.advance(ny('2026-12-21', '00:00:00'));
  assert.deepEqual(g.data, pending);
  assert.deepEqual(pick(requestOf(g, 'lv-0044'), 'state', 'flags'), ['lapsed', []]);
  assert.deepEqual(pick(vacation(g), 'pending_hours', 'available'), [0, 86]);
  // Its days are free: a sick day on 22 December is no conflict.
  assert.equal(g.call('leave.request', {id: 'sick', start: '2026-12-22', end: '2026-12-22', hours_per_day: 8}).state, 'pending');
  unchanged(g, () => g.call('leave.cancel', {id: 'lv-0044'}), 'invalid_state', 'lapsed', 'The leave request is lapsed.');
});

test('T14 [W3] sick leave: a request for today is accepted, it may start 7 days ago, and it stays pending until the manager decides', () => {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  f.advance(ny('2026-12-02'));
  assert.deepEqual(f.call('leave.request', {id: 'sick', start: '2026-12-02', end: '2026-12-02', hours_per_day: 8}), {id: 'lv-0044', state: 'pending', hours: 8});
  // Sick leave may start on or after the day that is 7 days before today: 25 November, and not 24 November.
  assert.equal(f.call('leave.preview', {id: 'sick', start: '2026-11-25', end: '2026-11-25', hours_per_day: 8}).allowed, true);
  unchanged(f, () => f.call('leave.request', {id: 'sick', start: '2026-11-24', end: '2026-11-24', hours_per_day: 8}), 'invalid_window', '8 days ago',
    'Sick leave can start at most 7 days ago, on 2026-11-25 or later.');
  // Sick leave needs no notice, so it does not lapse. The manager approves it two days later, and it reads taken at once.
  f.advance(ny('2026-12-04'));
  assert.deepEqual(pick(requestOf(f, 'lv-0044'), 'state', 'flags'), ['pending', []]);
  f.event(decided(ny('2026-12-04', '10:00:00'), 'lv-0044', 'approve'));
  assert.equal(requestOf(f, 'lv-0044').state, 'taken');
  const sick = f.call('leave.balances').items.find(row => row.leave_type_id === 'sick');
  assert.deepEqual(pick(sick, 'balance', 'available', 'carryover_cap', 'expiring', 'next_carryover_date'), [60, 60, null, 0, null]);
});

test('T14b [W3] carryover: expiring is the balance minus the hours held on or before 31 December minus the cap, and the forfeit arrives as leave.adjusted', () => {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  f.advance(ny('2026-12-02'));
  assert.equal(vacation(f).expiring, 6);
  // Hours held in January do not lower what expires on 31 December. A day on 28 December does, and so does the carryover date itself.
  f.call('leave.request', {id: 'vacation', start: '2027-01-04', end: '2027-01-05', hours_per_day: 8});
  assert.deepEqual(pick(vacation(f), 'available', 'expiring'), [70, 6]);
  f.call('leave.request', {id: 'vacation', start: '2026-12-28', end: '2026-12-28', hours_per_day: 4});
  assert.deepEqual(pick(vacation(f), 'available', 'expiring'), [66, 2]);
  f.call('leave.request', {id: 'vacation', start: '2026-12-31', end: '2026-12-31', hours_per_day: 1});
  assert.deepEqual(pick(vacation(f), 'available', 'expiring'), [65, 1]);
  // It is never below zero.
  f.call('leave.request', {id: 'vacation', start: '2026-12-29', end: '2026-12-29', hours_per_day: 8});
  assert.equal(vacation(f).expiring, 0);
  // Personal time has a cap of 0, so all of its 16.0 hours expire, and the account reads leave_expiring.
  assert.equal(f.call('leave.balances').items.find(row => row.leave_type_id === 'personal').expiring, 16);
  assert.ok(flags(f).includes('leave_expiring'));
  // The forfeit is the employer's act. ev-pl-431 takes 6.0 hours on 1 January, and the next carryover date is 31 December 2027.
  f.event(PLAN['ev-pl-431']);
  const row = vacation(f);
  assert.deepEqual(pick(row, 'balance', 'next_carryover_date'), [80, '2027-12-31']);
  assert.deepEqual(row.entries[row.entries.length - 1], {id: 'le-0310', leave_type_id: 'vacation', at: '2027-01-01T00:05:00-05:00', hours: -6, reason: 'forfeited',
    note: 'Hours above the carryover cap.', statement_id: null, event_id: 'ev-pl-431'});
  // A grant adds hours.
  f.event(adjusted(ny('2027-01-01', '00:10:00'), 'le-0311', 'personal', 24, 'grant'));
  assert.equal(f.call('leave.balances').items.find(r => r.leave_type_id === 'personal').balance, 40);
});

test('T15 [W4] window states: enrollment.opened for 2027 reads upcoming, then open from 30 November, then closed at 23:59:59 on 11 December, by the clock alone', () => {
  const f = fixture({seed: covered(), now: NOW}), state = () => windowOf(f).state;
  walk(f, ENROLL_PATH, 'opened');
  assert.deepEqual(pick(windowOf(f), 'id', 'plan_year', 'state', 'opens_at', 'closes_at', 'event_id', 'set'),
    ['win-2027', 2027, 'upcoming', '2026-11-30T00:00:00-05:00', '2026-12-11T23:59:59-05:00', 'ev-pl-440', null]);
  assert.deepEqual(windowOf(f).plans.map(plan => plan.id), ['medical', 'dental', 'fsa']);
  // Before the opening time a choice and a submission return window_closed.
  unchanged(f, () => f.call('benefits.elect', {id: 'win-2027', plan_id: 'medical', option_id: 'med-hdhp-ee'}), 'window_closed', 'elect before opening');
  unchanged(f, () => f.call('benefits.submit', {id: 'win-2027'}), 'window_closed', 'submit before opening');
  const times = [['2026-11-29', '23:59:59', 'upcoming'], ['2026-11-30', '00:00:00', 'open'], ['2026-12-11', '23:59:58', 'open'], ['2026-12-11', '23:59:59', 'closed']];
  const rows = [];
  for (const [day, time, expected] of times) {
    const before = f.data;
    f.advance(ny(day, time));
    assert.deepEqual(f.data, before);
    assert.equal(state(), expected, day + ' ' + time);
    rows.push(f.call('benefits.windows').items.map(row => [row.id, row.state, row.set_state]));
    if (expected === 'open') assert.deepEqual(pick(f.call('benefits.elect', {id: 'win-2027', plan_id: 'dental', option_id: 'den-plus-ee'}), 'id'), ['win-2027']);
  }
  assert.deepEqual(rows[3], [['win-2026', 'closed', 'final'], ['win-2027', 'closed', 'defaulted']]);
  unchanged(f, () => f.call('benefits.elect', {id: 'win-2027', plan_id: 'dental', option_id: 'den-plus-ee'}), 'window_closed', 'elect at the closing time');
});

test('T16 [W4] choices: the saved choices start as the medical and dental choices of 2026, and on 3 December the medical option at 95.00 and 2,600.00 for the spending account are saved', () => {
  const f = fixture({seed: covered(), now: NOW}), {medical, spending} = enroll(f, 'spending');
  const plans = () => windowOf(f).plans.map(plan => [plan.id, plan.saved, plan.in_force]);
  assert.deepEqual([medical, spending], [{id: 'win-2027'}, {id: 'win-2027'}]);
  assert.deepEqual(plans(), [['medical', {option_id: 'med-hdhp-ee'}, {option_id: 'med-ppo-ee'}], ['dental', {option_id: 'den-basic-ee'}, {option_id: 'den-basic-ee'}],
    ['fsa', {yearly_amount: 2600}, {yearly_amount: 1040}]]);
  assert.equal(windowOf(f).plans[0].options.find(o => o.id === 'med-hdhp-ee').per_pay_cost, 95);
  assert.deepEqual(windowOf(f).saves.map(save => [save.plan_id, save.choice, save.saved_at]), [['medical', {option_id: 'med-hdhp-ee'}, ny('2026-12-03')],
    ['fsa', {yearly_amount: 2600}, ny('2026-12-03')]]);
  // Before any save the plans that roll over start with the choice in force, and the spending account starts empty.
  const g = fixture({seed: covered(), now: NOW});
  enroll(g, 'opened');
  assert.deepEqual(windowOf(g).plans.map(plan => [plan.id, plan.saved]), [['medical', {option_id: 'med-ppo-ee'}], ['dental', {option_id: 'den-basic-ee'}], ['fsa', null]]);
  // The latest save of a plan counts. No coverage is a choice too. A save changes nothing in force.
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'dental', option_id: 'den-plus-fam'});
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'dental', no_coverage: true});
  assert.deepEqual(plans()[1], ['dental', {no_coverage: true}, {option_id: 'den-basic-ee'}]);
  // The maximum itself is allowed. Control: a yearly amount of 3,500.00 with a maximum of 3,200.00.
  const elect = (more, plan_id = 'fsa', id = 'win-2027') => () => f.call('benefits.elect', {id, plan_id, ...more});
  elect({yearly_amount: 3200})();
  unchanged(f, elect({yearly_amount: 3500}), 'over_limit', '3,500.00', 'The yearly amount is above the plan maximum of 3,200.00.');
  elect({yearly_amount: 2600})();
  // Unknown IDs: the window, a plan that is not in the window, and an option that the plan does not have.
  unchanged(f, elect({no_coverage: true}, 'fsa', 'win-2099'), 'not_found', 'unknown window');
  unchanged(f, elect({option_id: 'vis-ee'}, 'vision'), 'not_found', 'vision is not in the window', 'The enrollment window has no plan with this ID.');
  unchanged(f, elect({option_id: 'den-plus-ee'}, 'medical'), 'not_found', 'an option of another plan', 'The plan has no option with this ID.');
  // A choice that does not fit the kind of the plan, and choices that break the input schema.
  unchanged(f, elect({yearly_amount: 100}, 'medical'), 'invalid_arguments', 'a yearly amount for medical');
  unchanged(f, elect({option_id: 'med-ppo-ee'}), 'invalid_arguments', 'an option for the spending account');
  unchanged(f, elect({yearly_amount: 100.001}), 'invalid_arguments', 'a third decimal');
  for (const [label, more] of [['an option and no coverage', {option_id: 'med-ppo-ee', no_coverage: true}], ['no choice', {}], ['zero', {yearly_amount: 0}]]) {
    unchanged(f, elect(more, 'medical'), SCHEMA, label);
  }
  // Control: a choice on 12 December, after the closing time. When two errors fit, the first one of the table wins.
  f.advance(ny('2026-12-12'));
  unchanged(f, elect({option_id: 'med-ppo-ee'}, 'medical'), 'window_closed', 'a choice on 12 December');
  unchanged(f, elect({option_id: 'den-plus-ee'}, 'medical'), 'not_found', 'an unknown option after the closing time');
  unchanged(f, elect({yearly_amount: 3500}), 'window_closed', 'above the maximum after the closing time');
});

test('T17 [W4] submission: the set is submitted, reads final after the window closes, and from the first pay date of 2027 the spending account costs 100.00 for each pay', () => {
  const f = fixture({seed: covered(), now: NOW});
  enroll(f, 'medical');
  // Control: a submission before any choice is saved for the spending account.
  unchanged(f, () => f.call('benefits.submit', {id: 'win-2027'}), 'incomplete', 'no choice for the spending account', 'No choice is saved for: fsa.');
  const {submit} = walk(f, {spending: ENROLL_PATH.spending, submit: ENROLL_PATH.submit});
  assert.deepEqual(submit, {id: 'els-0002', state: 'submitted'});
  const CHOICES = [{plan_id: 'medical', choice: {option_id: 'med-hdhp-ee'}}, {plan_id: 'dental', choice: {option_id: 'den-basic-ee'}}, {plan_id: 'fsa', choice: {yearly_amount: 2600}}];
  assert.deepEqual(pick(windowOf(f).set, 'id', 'state', 'submitted_at', 'choices'), ['els-0002', 'submitted', ny('2026-12-03'), CHOICES]);
  assert.ok(!flags(f).includes('enrollment_open') && !flags(f).includes('will_default'));
  for (const step of ['run4Dec', 'closed']) ENROLL_PATH[step](f);
  assert.deepEqual(pick(windowOf(f).set, 'id', 'state', 'choices'), ['els-0002', 'final', CHOICES]);
  unchanged(f, () => f.call('benefits.submit', {id: 'win-2027'}), 'window_closed', 'submit after the closing time');
  ENROLL_PATH.runs(f);
  // 31 December is still in plan year 2026. 15 January is the first pay date of 2027: 95.00 for medical and 2,600.00 over 26 pay periods.
  assert.deepEqual(deductions(statementOf(f, 'ps-2026-27')), [['medical', 120], ['fsa', 40], ['retirement', 160]]);
  const first = statementOf(f, 'ps-2027-01');
  assert.deepEqual([deductions(first), first.settings_used.election_set_id, first.net_pay], [[['medical', 95], ['fsa', 100], ['retirement', 160]], 'els-0002', 2205]);
  assert.equal(first.deductions[1].text, 'Health care spending account: 2,600.00 a year');
});

test('T17b [W4] submission: a submitted set is changed and submitted again until the window closes, and a choice saved but not submitted again is dropped', () => {
  const f = fixture({seed: covered(), now: NOW});
  enroll(f, 'submit');
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'dental', option_id: 'den-plus-ee'});
  assert.deepEqual(f.call('benefits.submit', {id: 'win-2027'}), {id: 'els-0002', state: 'submitted'});
  // A later save, never submitted.
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'medical', option_id: 'med-ppo-es'});
  assert.deepEqual(windowOf(f).plans[0].saved, {option_id: 'med-ppo-es'});
  f.advance(ny('2026-12-11', '23:59:59'));
  const set = windowOf(f).set;
  assert.deepEqual([set.state, set.choices.map(row => row.choice), set.history.length], ['final', [{option_id: 'med-hdhp-ee'}, {option_id: 'den-plus-ee'}, {yearly_amount: 2600}], 2]);
  assert.deepEqual(f.data.election_sets.map(s => s.id), ['els-0001', 'els-0002']);
  unchanged(f, () => f.call('benefits.submit', {id: 'win-2099'}), 'not_found');
  // After the closing time, window_closed comes before incomplete.
  const g = fixture({seed: covered(), now: NOW});
  enroll(g, 'medical');
  g.advance(ny('2026-12-12'));
  unchanged(g, () => g.call('benefits.submit', {id: 'win-2027'}), 'window_closed', 'incomplete and closed');
});

test('T18 [W4] default: with nothing submitted the set reads defaulted after the closing time, the medical and dental choices of 2026 are kept, and the spending account has no coverage', () => {
  const f = fixture({seed: covered(), now: NOW});
  enroll(f, 'opened');
  // While the window is open and nothing is submitted, the account reads enrollment_open and will_default.
  f.advance(ny('2026-12-01'));
  assert.deepEqual(flags(f).filter(flag => flag === 'enrollment_open' || flag === 'will_default'), ['enrollment_open', 'will_default']);
  ENROLL_PATH.run4Dec(f);
  ENROLL_PATH.closed(f);
  assert.deepEqual(windowOf(f).set, {id: null, state: 'defaulted', submitted_at: null, request_id: null, history: [], choices: [
    {plan_id: 'medical', choice: {option_id: 'med-ppo-ee'}}, {plan_id: 'dental', choice: {option_id: 'den-basic-ee'}}, {plan_id: 'fsa', choice: {no_coverage: true}}]});
  assert.ok(!flags(f).includes('enrollment_open') && !flags(f).includes('will_default'));
  assert.deepEqual(f.data.election_sets.map(set => set.id), ['els-0001']);
  ENROLL_PATH.runs(f);
  const first = statementOf(f, 'ps-2027-01');
  assert.deepEqual([deductions(first), first.settings_used.election_set_id], [[['medical', 120], ['retirement', 160]], null]);
  // In BASE the spending account had no coverage in 2026, so nothing is lost: the account reads enrollment_open and not will_default.
  const g = start();
  enroll(g, 'opened');
  g.advance(ny('2026-12-01'));
  assert.deepEqual(flags(g).filter(flag => flag === 'enrollment_open' || flag === 'will_default'), ['enrollment_open']);
  // will_default counts only the plans of the window (a choice of the build). Here the spending account is not in it.
  const h = fixture({seed: covered(), now: NOW});
  h.event(opened(ny('2026-11-23', '09:00:00'), 'win-2027', 2027, ny('2026-11-30', '00:00:00'), ny('2026-12-11', '23:59:59'), ['medical', 'dental']));
  h.advance(ny('2026-12-01'));
  assert.deepEqual(flags(h).filter(flag => flag === 'enrollment_open' || flag === 'will_default'), ['enrollment_open']);
});

test('T18b [W4] default: a plan outside the window, and every plan of a plan year with no window, takes the same default', () => {
  // Vision is not in the window of 2027. It rolls over, so its 2026 choice of 3.75 for each pay stays in force, submitted or not.
  for (const last of ['opened', 'submit']) {
    const f = fixture({seed: covered({vision: true}), now: NOW});
    enroll(f, last);
    if (last === 'opened') { ENROLL_PATH.run4Dec(f); ENROLL_PATH.closed(f); ENROLL_PATH.runs(f); } else for (const step of ['run4Dec', 'closed', 'runs']) ENROLL_PATH[step](f);
    const expected = last === 'opened' ? [['medical', 120], ['vision', 3.75], ['retirement', 160]] : [['medical', 95], ['vision', 3.75], ['fsa', 100], ['retirement', 160]];
    assert.deepEqual(deductions(statementOf(f, 'ps-2027-01')), expected, last);
  }
  // No enrollment.opened for 2027: the plans that roll over keep their 2026 choice, and the spending account has no coverage.
  const g = fixture({seed: covered({vision: true}), now: NOW});
  g.event(PLAN['ev-pl-401']);
  g.event(run('pd-2026-25', '2026-12-04'));
  g.advance(ny('2026-12-12'));
  yearEnd(g);
  assert.deepEqual(deductions(statementOf(g, 'ps-2027-01')), [['medical', 120], ['vision', 3.75], ['retirement', 160]]);
});

// A state with records of every kind, read on Wednesday 2 December. pd-2026-24 is paid, the cut-off of pd-2026-25 has passed and that of pd-2026-26 has not.
// inq-0006 is withdrawn. lv-0044 is approved sick leave, lv-0045 is pending vacation and lv-0046 is cancelled. dep-0191 is returned, and dep-0189 is reissued.
function eventState() {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  f.event(PLAN['ev-pl-440']);
  f.call('inquiries.open', {id: 'ps-2026-24', amount: 10, note: 'Please check.'});
  f.call('inquiries.withdraw', {id: 'inq-0006'});
  f.call('leave.request', {id: 'sick', start: '2026-11-23', end: '2026-11-23', hours_per_day: 8});
  f.event(decided(ny('2026-11-23', '10:00:00'), 'lv-0044', 'approve'));
  f.call('leave.request', WINTER);
  f.call('leave.request', {id: 'vacation', start: '2026-12-28', end: '2026-12-28', hours_per_day: 8});
  f.call('leave.cancel', {id: 'lv-0046'});
  f.event(depositUpdated(ny('2026-11-24'), 'dep-0191', 'returned'));
  f.event(depositUpdated(ny('2026-11-24', '10:00:00'), 'dep-0189', 'returned'));
  f.event(depositUpdated(ny('2026-11-24', '11:00:00'), 'dep-0189', 'reissued', {reissued_to: {kind: 'check', label: 'Paper check'}}));
  f.advance(ny('2026-12-02'));
  return f;
}

test('T19 [All] invalid events: each event of the plan\'s list is rejected with invalid_event, and the data does not change', () => {
  const f = eventState(), T = ny('2026-12-02', '10:00:00');
  const posted = (entry, change) => edit(run(entry, '2026-12-02', {time: '10:00:00'}), e => change && change(e.payload));
  const move = (entry, change) => calendarChanged(T, entry, change, 'ev-cal-bad');
  const add = (entry, cutoff_at, pay_date = '2026-12-31') => calendarChanged(T, entry, {period_start: '2026-12-14', period_end: '2026-12-27', pay_date, cutoff_at}, 'ev-add-bad');
  const window = (window_id, plan_year, opens_at, closes_at, plan_ids = ['medical']) => opened(T, window_id, plan_year, opens_at, closes_at, plan_ids);
  const EXISTS = 'already exists', ORDER = 'A deposit moves only from sent to returned, and from returned to reissued.', NOT_PENDING = 'The leave request is not pending.';
  // [the case of the plan, the event, a part of the message of the rule that rejects it]
  const cases = [
    ['an object ID that exists: a statement', posted('pd-2026-25', p => { p.statement_id = 'ps-2026-23'; }), 'The ID ps-2026-23 ' + EXISTS],
    ['an object ID that exists: a deposit, as a statement ID', posted('pd-2026-25', p => { p.statement_id = 'dep-0190'; }), 'The ID dep-0190 ' + EXISTS],
    ['an object ID that exists: a statement, as a new pay calendar entry', add('ps-2026-22', ny('2026-12-29', '17:00:00')), 'The ID ps-2026-22 ' + EXISTS],
    ['an object ID that exists: a leave entry', adjusted(T, 'le-0301', 'vacation', 4, 'grant'), 'The ID le-0301 ' + EXISTS],
    ['an object ID that exists: a leave request, as a leave entry', adjusted(T, 'lv-0044', 'vacation', 4, 'grant'), 'The ID lv-0044 ' + EXISTS],
    ['an object ID that exists: a window', window('win-2026', 2028, ny('2027-11-01'), ny('2027-11-20')), 'The ID win-2026 ' + EXISTS],
    ['an object ID that exists: an election set, as a window', window('els-0001', 2028, ny('2027-11-01'), ny('2027-11-20')), 'The ID els-0001 ' + EXISTS],
    ['an unknown pay calendar entry in a run', posted('pd-2099-01'), 'names a pay calendar entry that does not exist'],
    ['an unknown pay calendar entry in a calendar change that does not add it', move('pd-2099-01', {pay_date: '2026-12-31'}), 'To add one, give its pay period, pay date and cut-off'],
    ['an unknown deposit', depositUpdated(T, 'dep-9999', 'returned'), 'names a deposit that does not exist'],
    ['an unknown inquiry', answered(T, 'inq-9999', 'no_change'), 'names an inquiry that does not exist'],
    ['an unknown inquiry on an earnings line', posted('pd-2026-25', p => { p.earnings.push({...REIMBURSEMENT, inquiry_id: 'inq-9999'}); }), 'An earnings line names an inquiry that does not exist'],
    ['an unknown leave request', decided(T, 'lv-9999', 'approve'), 'names a leave request that does not exist'],
    ['an unknown leave type', adjusted(T, 'le-0400', 'holiday', 8, 'grant'), 'names a leave type that does not exist'],
    ['an unknown plan', window('win-2028', 2028, ny('2027-11-01'), ny('2027-11-20'), ['medical', 'gym']), 'A window names no plan, a plan twice or an unknown plan'],
    ['a pay run for an entry that is already paid', posted('pd-2026-24', p => { p.statement_id = 'ps-2026-24b'; }), 'The run of this pay calendar entry is already posted.'],
    ['a pay run whose cut-off has not passed', posted('pd-2026-26'), 'The cut-off of this run has not passed.'],
    ['a pay run with no earnings line', posted('pd-2026-25', p => { p.earnings = []; }), 'A pay run has no earnings line.'],
    ['a pay run with taxes above its earnings', posted('pd-2026-25', p => { p.taxes = [{...TAXES[0], amount: 3200.01}]; }), 'The taxes of a pay run are above its earnings.'],
    ['a calendar change to a paid entry', move('pd-2026-24', {pay_date: '2026-11-21'}), 'The run of this entry is posted. A paid entry does not change.'],
    ['a calendar change that moves a cut-off that has passed', move('pd-2026-25', {cutoff_at: ny('2026-12-03', '17:00:00')}), 'The cut-off of this entry has passed. It cannot move.'],
    ['a calendar change that puts a cut-off before the time of the event', move('pd-2026-26', {cutoff_at: ny('2026-12-02', '09:59:59')}),
      'A cut-off must be later than the time of the event.'],
    ['a calendar change that puts a cut-off at the time of the event', move('pd-2026-26', {cutoff_at: T}), 'A cut-off must be later than the time of the event.'],
    ['a new entry with a cut-off before the time of the event', add('pd-2026-27', ny('2026-12-01', '17:00:00')), 'A cut-off must be later than the time of the event.'],
    ['a new entry with a cut-off at the time of the event', add('pd-2026-27', T), 'A cut-off must be later than the time of the event.'],
    ['a calendar change that puts a cut-off after the pay date', move('pd-2026-26', {cutoff_at: ny('2026-12-19', '00:00:00')}), 'A cut-off cannot be after its pay date.'],
    ['a calendar change that moves a pay date before its cut-off', move('pd-2026-26', {pay_date: '2026-12-14'}), 'A cut-off cannot be after its pay date.'],
    ['a new entry with a cut-off after its pay date', add('pd-2026-27', ny('2027-01-01', '09:00:00')), 'A cut-off cannot be after its pay date.'],
    ['a deposit update from sent to reissued', depositUpdated(T, 'dep-0190', 'reissued', {reissued_to: {kind: 'check', label: 'Paper check'}}), ORDER],
    ['a deposit update from sent to sent', depositUpdated(T, 'dep-0190', 'sent'), ORDER],
    ['a deposit update from returned to returned', depositUpdated(T, 'dep-0191', 'returned'), ORDER],
    ['a deposit update from reissued to returned', depositUpdated(T, 'dep-0189', 'returned'), ORDER],
    ['an answer to an answered inquiry', answered(T, 'inq-0005', 'no_change'), 'The inquiry is not open.'],
    ['an answer to a withdrawn inquiry', answered(T, 'inq-0006', 'corrected', {correction_amount: 10}), 'The inquiry is not open.'],
    ['a decision on an approved request', decided(T, 'lv-0044', 'deny'), NOT_PENDING],
    ['a decision on a taken request of the seed', decided(T, 'lv-0040', 'approve'), NOT_PENDING],
    ['a decision on a cancelled request', decided(T, 'lv-0046', 'approve'), NOT_PENDING],
    ['a leave correction that takes available below zero', adjusted(T, 'le-0400', 'personal', -16.5), 'The adjustment would take the available hours below zero.'],
    ['a vacation correction below what pending requests hold', adjusted(T, 'le-0400', 'vacation', -60), 'The adjustment would take the available hours below zero.'],
    ['a window that closes before it opens', window('win-2028', 2028, ny('2027-11-20'), ny('2027-11-01')), 'The window closes before it opens.'],
    ['a window that closes when it opens', window('win-2028', 2028, ny('2027-11-20'), ny('2027-11-20')), 'The window closes before it opens.'],
    ['a window that does not close before its plan year starts', window('win-2028', 2028, ny('2027-11-20'), '2028-01-01T00:00:00-05:00'),
      'The window does not close before its plan year starts.'],
    ['a window for a plan year that has a window', window('win-2027b', 2027, ny('2026-12-05'), ny('2026-12-20')), 'The plan year already has an enrollment window or an election set.'],
    ['a window for the plan year 2026', window('win-2026b', 2026, ny('2025-11-01'), ny('2025-11-20')), 'The plan year already has an enrollment window or an election set.']
  ];
  assert.equal(cases.length, 44);
  for (const [label, e, text] of cases) unchanged(f, () => f.event(e), 'invalid_event', label, text);
  // Core rejects an event dated before the App's current time. tests/mcp.integration.cjs checks it on the real host.
  unchanged(f, () => f.event(depositUpdated(ny('2026-12-01'), 'dep-0190', 'returned')), 'invalid_event', 'an event before the clock', 'cannot move backwards');
  // The same events with the fault removed are applied.
  for (const e of [adjusted(T, 'le-0400', 'personal', -16), posted('pd-2026-25'), window('win-2028', 2028, ny('2027-11-20'), '2027-12-31T23:59:59-05:00')]) f.event(e);
});

test('T19b [All] invalid events: a pay run in a plan year whose window has not closed, and a decision that arrives after a request lapsed', () => {
  // The run of 1 January 2027, with its cut-off on 24 November, while the window of 2027 is upcoming.
  const f = start();
  walk(f, ENROLL_PATH, 'opened');
  f.event(added(ny('2026-11-23', '09:30:00'), 'pd-2027-00', '2026-12-14', '2026-12-27', '2027-01-01', '2026-11-24'));
  const early = edit(run('pd-2027-00', '2026-11-25'), e => { e.payload.statement_id = 'ps-2027-00'; });
  unchanged(f, () => f.event(early), 'invalid_event', 'the window of 2027 is not closed', 'The enrollment window of the plan year of this pay date has not closed.');
  // ev-pl-430, the manager's approval of lv-0044, arrives on 21 December, after the request lapsed.
  const g = start();
  walk(g, LEAVE_PATH, 'request');
  const late = edit(PLAN['ev-pl-430'], e => { e.at = ny('2026-12-21', '08:00:00'); });
  unchanged(g, () => g.event(late), 'invalid_event', 'a decision after the lapse', 'A request that lapsed takes no decision.');
  g.event(edit(late, e => { e.at = ny('2026-12-20', '23:59:59'); }));
  assert.equal(requestOf(g, 'lv-0044').state, 'approved');
});

test('T19c [All] invalid events: each event check that the package adds to the plan\'s list is rejected with invalid_event, and the data does not change', () => {
  const f = eventState(), T = ny('2026-12-02', '10:00:00');
  const posted = (entry, change) => edit(run(entry, '2026-12-02', {time: '10:00:00'}), e => change && change(e.payload));
  const move = (entry, change) => calendarChanged(T, entry, change, 'ev-cal-bad');
  const LINE_IDS = 'A pay run uses one line ID twice.', AMOUNT = 'An amount is zero or less, or it has more than two decimals.';
  const REISSUE = 'A reissued deposit names the account or the check it went to. A returned one names none.', CORRECTION = 'A corrected answer gives the correction amount.';
  const cases = [
    ['runs post in the order of their cut-offs', run('pd-2026-26', '2026-12-16'), 'An earlier run is not posted yet.'],
    ['a pay run that uses one line ID twice', posted('pd-2026-25', p => { p.taxes[1].line_id = 'e1'; }), LINE_IDS],
    ['a pay run line with the ID of a deduction line', posted('pd-2026-25', p => { p.taxes[1].line_id = 'd1'; }), 'A line ID of the pay run is also the ID of a deduction line.'],
    ['a pay run line of zero', posted('pd-2026-25', p => { p.taxes[1].amount = 0; }), AMOUNT],
    ['a pay run line below zero', posted('pd-2026-25', p => { p.earnings[0].amount = -1; }), AMOUNT],
    ['a pay run line with three decimals', posted('pd-2026-25', p => { p.earnings[0].amount = 3200.001; }), AMOUNT],
    ['a calendar change to the pay period of an entry', move('pd-2026-26', {period_end: '2026-12-14'}), 'The pay period of an entry does not change.'],
    ['a calendar change that changes nothing', move('pd-2026-26', {pay_date: '2026-12-18', cutoff_at: RUN_26.cutoff_at}), 'The event changes nothing'],
    ['a new entry whose period ends before it starts', calendarChanged(T, 'pd-2026-27', {period_start: '2026-12-27', period_end: '2026-12-14', pay_date: '2026-12-31',
      cutoff_at: ny('2026-12-29', '17:00:00')}), 'A pay period ends before it starts.'],
    ['a pay date that is not a real date', move('pd-2026-26', {pay_date: '2026-02-30'}), 'A date is not a real calendar date.'],
    ['a reissued deposit that names no account or check', depositUpdated(T, 'dep-0191', 'reissued'), REISSUE],
    ['a returned deposit that names an account', depositUpdated(T, 'dep-0190', 'returned', {reissued_to: {kind: 'check', label: 'Paper check'}}), REISSUE],
    ['a deposit reissued to an account with no digits', depositUpdated(T, 'dep-0191', 'reissued', {reissued_to: {kind: 'account', label: 'New checking'}}),
      'An account has its last four digits, and a check has none.'],
    ['a deposit reissued as a check with digits', depositUpdated(T, 'dep-0191', 'reissued', {reissued_to: {kind: 'check', label: 'Paper check', last4: '1234'}}),
      'An account has its last four digits, and a check has none.'],
    ['a leave adjustment of zero hours', adjusted(T, 'le-0400', 'vacation', 0, 'grant'), 'A leave adjustment has zero hours, or more than one decimal.'],
    ['a leave adjustment with two decimals', adjusted(T, 'le-0400', 'vacation', 1.25, 'grant'), 'A leave adjustment has zero hours, or more than one decimal.'],
    ['a window with no plan', opened(T, 'win-2028', 2028, ny('2027-11-01'), ny('2027-11-20'), []), 'A window names no plan, a plan twice or an unknown plan.'],
    ['a window that names a plan twice', opened(T, 'win-2028', 2028, ny('2027-11-01'), ny('2027-11-20'), ['fsa', 'fsa']), 'A window names no plan, a plan twice or an unknown plan.']
  ];
  // An answer to an open inquiry: the amount is given only for a correction, and it is above zero with two decimals at most.
  f.call('inquiries.open', {id: 'ps-2026-24', amount: 10, note: 'Please check again.'});
  for (const [label, change, text] of [['a corrected answer with no amount', {}, CORRECTION], ['a no_change answer with an amount', {outcome: 'no_change', correction_amount: 5}, CORRECTION],
    ['a correction of zero', {correction_amount: 0}, AMOUNT], ['a correction with three decimals', {correction_amount: 4.125}, AMOUNT]]) {
    cases.push([label, answered(T, 'inq-0007', 'corrected', change), text]);
  }
  assert.equal(cases.length, 22);
  for (const [label, e, text] of cases) unchanged(f, () => f.event(e), 'invalid_event', label, text);
  // A plan year with a stored election set and no window takes no window: a seed with a set for 2028 from the history.
  const seed = edit(f.data, s => { s.election_sets.push({...structuredClone(s.election_sets[0]), id: 'els-0090', window_id: null, plan_year: 2028}); });
  const g = fixture({seed, now: f.ctx.virtual_now});
  unchanged(g, () => g.event(opened(T, 'win-2028', 2028, ny('2027-11-01'), ny('2027-11-20'), ['medical'])), 'invalid_event', 'a plan year with a stored set',
    'The plan year already has an enrollment window or an election set.');
  // Events cannot use the reason accrual: only a posted run earns hours. The event schema refuses it before the App runs.
  assert.equal(eventSchema(adjusted(T, 'le-0400', 'vacation', 4, 'accrual')), false);
  assert.equal(eventSchema(adjusted(T, 'le-0400', 'vacation', 4, 'grant')), true);
});

// The rich state of the seed-rule tests, read on 12 December: every kind of record and every stored state of a change, an inquiry, a leave request and a deposit.
function seedState() {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  f.advance(ny('2026-11-20', '08:00:00'));
  f.call('retirement.set', {id: ACCOUNT, percent: 6});
  f.call('retirement.set', {id: ACCOUNT, percent: 7});
  f.call('deposit.update', {id: ACCOUNT, accounts: NEW_SETUP});
  f.call('changes.cancel', {id: 'chg-0009'});
  f.call('inquiries.open', {id: 'ps-2026-24', line_id: 't1', amount: 412, note: 'Please check the tax.'});
  f.call('inquiries.open', {id: 'ps-2026-24', amount: 10, note: 'Please check.'});
  f.call('inquiries.withdraw', {id: 'inq-0007'});
  f.event(PLAN['ev-pl-440']);
  f.event(PLAN['ev-pl-402']);
  f.call('leave.request', WINTER);
  f.call('leave.request', {id: 'sick', start: '2026-11-23', end: '2026-11-23', hours_per_day: 8});
  f.advance(ny('2026-12-02'));
  f.call('deposit.update', {id: ACCOUNT, accounts: NEW_SETUP});
  f.event(PLAN['ev-pl-430']);
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'medical', option_id: 'med-hdhp-ee'});
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 2600});
  f.call('benefits.submit', {id: 'win-2027'});
  f.event(run('pd-2026-25', '2026-12-07'));
  f.event(PLAN['ev-pl-410']);
  f.event(PLAN['ev-pl-420']);
  f.advance(ny('2026-12-12'));
  return f;
}

test('T19d [All] seed rules: validateSeed rejects each seed of the plan\'s list, and each seed that breaks a rule that the package adds, with invalid_seed', () => {
  const f = seedState(), base = f.data, ctx = f.ctx;
  plugin.validateSeed(ctx, base);
  assert.deepEqual([base.changes.map(c => c.stored_state), base.inquiries.map(q => q.state), base.leave_requests.slice(-2).map(r => r.stored_state)],
    [['applied', 'cancelled', 'applied', 'replaced', 'applied', 'cancelled', null], ['answered', 'answered', 'withdrawn'], ['approved', 'pending']]);
  const by = (list, id) => list.find(x => x.id === id);
  const statement = (s, id) => by(s.statements, id), change = (s, id) => by(s.changes, id), request = (s, id) => by(s.leave_requests, id);
  const window = s => by(s.windows, 'win-2027'), set = s => by(s.election_sets, 'els-0002'), deposit = (s, id) => s.statements.flatMap(x => x.deposits).find(d => d.id === id);
  const SPLIT = 'A deposit setup has', DECIMALS = 'An amount has more than two decimals', TENTHS = 'A number of hours or a percentage has more than one decimal';
  const PAID = 'A paid entry has its statement, and a planned entry has none', REQUEST_DAYS = 'A leave request has no working day, or its days do not follow from its range';
  // [the rule, the change that breaks it, a part of the message of the rule]
  const rules = [
    // The plan's list.
    ['duplicate IDs', s => { change(s, 'chg-0009').id = 'chg-0007'; }, 'The ID chg-0007 is used twice'],
    ['a reference to a statement that does not exist', s => { by(s.inquiries, 'inq-0007').statement_id = 'ps-nope'; }, 'An inquiry names a statement or a line that does not exist'],
    ['a reference to a statement line that does not exist', s => { by(s.inquiries, 'inq-0007').line_id = 'x9'; }, 'An inquiry names a statement or a line that does not exist'],
    ['a reference to a pay calendar entry that does not exist', s => { statement(s, 'ps-2026-22').entry_id = 'pd-nope'; }, PAID],
    ['a reference to a leave type that does not exist', s => { by(s.leave_entries, 'le-0301').leave_type_id = 'holiday'; }, 'A leave entry names a leave type or a statement that does not exist'],
    ['a reference to a statement that does not exist, from a leave entry', s => { by(s.leave_entries, 'le-r0147').statement_id = 'ps-nope'; },
      'A leave entry names a leave type or a statement that does not exist'],
    ['a reference to a leave type that does not exist, from a request', s => { request(s, 'lv-0045').leave_type_id = 'holiday'; }, 'A leave request names a leave type that does not exist'],
    ['a reference to an election set that does not exist', s => { statement(s, 'ps-2026-24').settings_used.election_set_id = 'els-nope'; }, 'A statement names an election set that does not exist'],
    ['a reference to a change that does not exist', s => { statement(s, 'ps-2026-25').settings_used.change_ids.push('chg-nope'); }, 'A statement names a change that it did not apply'],
    ['a reference to an inquiry that does not exist', s => { statement(s, 'ps-2026-24').earnings[0].inquiry_id = 'inq-nope'; }, 'An earnings line names an inquiry that does not exist'],
    ['a reference to a plan that does not exist, from a deduction', s => { statement(s, 'ps-2026-24').deductions[0].plan_id = 'gym'; }, 'A deduction names a plan or an option that does not fit it'],
    ['a reference to a plan that does not exist, from a window', s => { window(s).plan_ids.push('gym'); }, 'An enrollment window names no plan, a plan twice or an unknown plan'],
    ['a reference to a plan that does not exist, from a choice', s => { set(s).choices[0].plan_id = 'gym'; }, 'A choice names a plan that does not exist'],
    ['a reference to a run that does not exist, from a replaced change', s => { change(s, 'chg-0007').entry_id = 'pd-nope'; }, 'A change is applied or replaced only for a paid run'],
    ['a reference to an object that does not exist, from a notification', s => { s.notifications[3].object_id = 'nothing'; }, 'A notification names an object that does not exist'],
    ['a reference to an object that does not exist, from an activity row', s => { s.activity[0].object_id = 'nothing'; }, 'An activity row names an object that does not exist'],
    ['a timestamp without a UTC offset', s => { change(s, 'chg-0007').made_at = '2026-11-20T08:00:00'; }, 'A timestamp has no UTC offset'],
    ['a timestamp without a UTC offset, in a statement', s => { statement(s, 'ps-2026-25').posted_at = '2026-12-07 06:00'; }, 'A timestamp has no UTC offset'],
    ['an account that the binding does not declare', s => { s.account_id = 'payleaf-nobody'; }, 'Account and owner must exist in the supplied binding'],
    ['an owner that the binding does not declare', s => { s.owner_person_id = 'person-nobody'; }, 'Account and owner must exist in the supplied binding'],
    ['a cut-off after its pay date', s => { by(s.calendar, 'pd-2026-26').cutoff_at = ny('2026-12-19', '00:00:00'); }, 'A cut-off is after its pay date'],
    ['a paid entry with no statement', s => { by(s.calendar, 'pd-2026-26').state = 'paid'; }, PAID],
    ['a planned entry with a statement', s => { by(s.calendar, 'pd-2026-25').state = 'planned'; }, PAID],
    ['a statement whose net pay does not follow from its lines', s => { statement(s, 'ps-2026-24').net_pay = 2281; }, 'The net pay of a statement does not follow from its lines'],
    ['a statement whose deposits do not follow from its setup', s => { const st = statement(s, 'ps-2026-24'); st.deposits[0].amount = 301; st.deposits[1].amount = 1979; },
      'The deposits of a statement do not follow from its net pay and its deposit setup'],
    ['a statement with a deposit for an account that its setup does not have', s => { statement(s, 'ps-2026-24').deposits[1].account.last4 = '0000'; },
      'The deposits of a statement do not follow from its net pay and its deposit setup'],
    ['a setup with no account for the remainder', s => { s.settings.deposit.accounts[1] = {...CHECKING, percent: 50}; }, SPLIT + ' exactly one account that takes the remainder'],
    ['a setup with four accounts, in a change', s => { change(s, 'chg-0010').value.accounts.unshift({...TRAVEL, amount: 1}, {...TRAVEL, amount: 2}); }, SPLIT + ' at most three accounts'],
    ['a setup with percentages above 100, in a statement', s => { statement(s, 'ps-2026-22').settings_used.deposit.accounts = [{...SAVINGS, percent: 60}, {...TRAVEL, percent: 50},
      {...CHECKING, remainder: true}]; }, 'The percentages of a deposit setup are above 100 in total'],
    ['two open inquiries on one statement line', s => { s.inquiries.push({...structuredClone(by(s.inquiries, 'inq-0007')), id: 'inq-0090', state: 'open', withdrawn_at: null},
      {...structuredClone(by(s.inquiries, 'inq-0007')), id: 'inq-0091', state: 'open', withdrawn_at: null}); }, 'One statement line has two open inquiries'],
    ['two leave requests that overlap while approved', s => { s.leave_requests.push({...structuredClone(request(s, 'lv-0044')), id: 'lv-0090'}); },
      'Two leave requests that are pending, approved or taken share the day 2026-12-21'],
    ['a pending sick request that overlaps a taken one', s => { s.leave_requests.push({...structuredClone(request(s, 'lv-0045')), id: 'lv-0090',
      start: '2026-10-09', end: '2026-10-09', days: ['2026-10-09']}); }, 'share the day 2026-10-09'],
    ['a leave request with no working day', s => { Object.assign(request(s, 'lv-0045'), {start: '2026-11-28', end: '2026-11-29', days: [], hours: 0}); }, REQUEST_DAYS],
    ['a window that closes before it opens', s => { window(s).closes_at = ny('2026-11-29', '00:00:00'); }, 'An enrollment window closes before it opens, or after its plan year starts'],
    ['a window that closes after its plan year starts', s => { window(s).closes_at = '2027-01-01T00:00:00-05:00'; }, 'An enrollment window closes before it opens, or after its plan year starts'],
    ['two windows for one plan year', s => { s.windows.push({...structuredClone(window(s)), id: 'win-2027b', saved: [], set_id: null}); }, 'One plan year has two enrollment windows'],
    ['two sets in force for one plan year', s => { s.election_sets.push({...structuredClone(s.election_sets[0]), id: 'els-0090', window_id: null}); }, 'One plan year has two election sets'],
    // Rules that the package adds: units, one ID space, the times of a run, the settings, the stored states, the leave days and the choices.
    ['one ID space: a notification with the ID of a statement', s => { s.notifications[0].id = 'ps-2026-22'; }, 'The ID ps-2026-22 is used twice'],
    ['one ID space: a leave entry with the ID of a deposit', s => { by(s.leave_entries, 'le-0301').id = 'dep-0190'; }, 'The ID dep-0190 is used twice'],
    ['one ID space: a window with the ID of a plan', s => { window(s).id = 'medical'; }, 'The ID medical is used twice'],
    ['a statement posted before the cut-off of its run', s => { statement(s, 'ps-2026-25').posted_at = ny('2026-12-01', '16:59:59'); },
      'A statement is posted before the cut-off of its run, or after the current time'],
    ['a statement posted after the clock', s => { statement(s, 'ps-2026-25').posted_at = ny('2026-12-12', '09:00:01'); },
      'A statement is posted before the cut-off of its run, or after the current time'],
    ['a statement and its entry that do not agree', s => { statement(s, 'ps-2026-24').pay_date = '2026-11-21'; }, 'A statement and its pay calendar entry do not agree'],
    ['a statement with no earnings line', s => { statement(s, 'ps-2026-22').earnings = []; }, 'A statement has no earnings line'],
    ['a statement that uses one line ID twice', s => { statement(s, 'ps-2026-22').taxes[1].line_id = 't1'; }, 'A statement uses one line ID twice'],
    ['a statement with taxes above its earnings', s => { statement(s, 'ps-2026-22').taxes[0].amount = 5000; }, 'The taxes of a statement are above its earnings'],
    ['a deduction that takes more than is due', s => { statement(s, 'ps-2026-22').deductions[0].amount = 130; }, 'A deduction takes more than is due'],
    ['settings that are not what the last run used', s => { s.settings.retirement = {percent: 9}; }, 'The settings are not the values that the last posted run used'],
    ['a change made before a posted cut-off that the run did not store', s => { change(s, 'chg-0010').made_at = ny('2026-11-10'); },
      'A change made before the cut-off of a posted run was not stored by that run'],
    ['two applied changes of one setting for one run', s => { change(s, 'chg-0007').stored_state = 'applied'; }, 'Each posted run applies the latest change of a setting'],
    ['a cancelled change with no cancel time', s => { change(s, 'chg-0009').cancelled_at = null; }, 'The state of a change does not fit its cancel time'],
    ['a change value that does not fit its setting', s => { change(s, 'chg-0007').value = {accounts: []}; }, 'The value of a change does not fit its setting'],
    ['a withdrawn inquiry with no withdrawal time', s => { by(s.inquiries, 'inq-0007').withdrawn_at = null; }, 'The state of an inquiry does not fit its fields'],
    ['a corrected answer with no amount', s => { by(s.inquiries, 'inq-0006').answer.correction_amount = null; }, 'A corrected answer has a correction amount'],
    ['an approved request with no decision time', s => { request(s, 'lv-0044').decided_at = null; }, 'The state of a leave request does not fit its fields'],
    ['a request whose days do not follow from its range', s => { request(s, 'lv-0044').days.pop(); }, REQUEST_DAYS],
    ['a request whose hours do not follow from its days', s => { request(s, 'lv-0045').hours = 7; }, 'The hours of a leave request do not follow from its days'],
    ['a carryover cap with no carryover date', s => { by(s.leave_types, 'sick').carryover_cap = 40; }, 'A carryover cap needs a real carryover date'],
    ['a leave entry of zero hours', s => { by(s.leave_entries, 'le-0301').hours = 0; }, 'A leave entry has zero hours'],
    ['a saved choice for a plan that is not in its window', s => { window(s).saved[0].plan_id = 'vision'; }, 'A saved choice names a plan that is not in its window'],
    ['a choice saved before its window opened', s => { window(s).saved[0].saved_at = ny('2026-11-29'); }, 'A choice was saved while its window was not open'],
    ['a window and its set that do not agree', s => { window(s).set_id = null; }, 'An enrollment window and its election set do not agree'],
    ['a set with no window for a plan year that has one', s => { set(s).window_id = null; window(s).set_id = null; }, 'An election set with no window is for a plan year that has a window'],
    ['a set with no choice for a plan of its window', s => { set(s).choices.pop(); }, 'An election set does not have a choice for each plan of its window'],
    ['a set submitted after its window closed', s => { set(s).submitted_at = ny('2026-12-12'); }, 'An election set was submitted while its window was not open'],
    ['a set whose last history row is not its choices', s => { set(s).history[0].choices = []; }, 'The last history row of an election set is not its submitted choices'],
    ['a choice that does not fit its plan', s => { set(s).choices[0].choice = {option_id: 'den-plus-ee'}; }, 'A choice does not fit its plan'],
    ['a yearly amount above the maximum of its plan', s => { set(s).choices[2].choice = {yearly_amount: 3300}; }, 'A yearly amount is above the maximum of its plan'],
    ['a deposit history that does not follow the order', s => { deposit(s, 'dep-0191').history.pop(); }, 'The history of a deposit does not follow the order sent, returned, reissued'],
    ['a returned deposit that names where it was reissued', s => { deposit(s, 'dep-0191').reissued_to = {kind: 'check', label: 'Paper check', last4: null}; },
      'A reissued deposit names the account or the check it went to'],
    ['a plan with options and a yearly maximum', s => { by(s.plans, 'medical').yearly_max = 1000; }, 'A plan with options has at least one option and no yearly maximum'],
    ['one option ID in two plans', s => { by(s.plans, 'dental').options[2].id = 'med-ppo-ee'; }, 'The option med-ppo-ee is used twice'],
    ['an unknown time zone', s => { s.preferences.timezone = 'Mars/Olympus'; }, 'A time zone is unknown'],
    ['a holiday that is not a real date', s => { s.employer.holidays.push('2026-02-30'); }, 'A date is not a real calendar date'],
    ['a pay period that ends before it starts', s => { by(s.calendar, 'pd-2026-26').period_end = '2026-11-29'; }, 'A pay period ends before it starts'],
    ['activity rows that are not in order', s => { s.activity[1].seq = s.activity[0].seq; }, 'The activity rows are not in order'],
    // Units: two decimals for money, one decimal for hours and percentages.
    ['three decimals in an earnings line', s => { statement(s, 'ps-2026-22').earnings[0].amount = 3200.001; }, DECIMALS],
    ['three decimals in an option cost', s => { by(s.plans, 'medical').options[0].per_pay_cost = 120.001; }, DECIMALS],
    ['three decimals in an inquiry', s => { by(s.inquiries, 'inq-0007').amount = 10.005; }, DECIMALS],
    ['three decimals in a fixed deposit amount', s => { s.settings.deposit.accounts[0].amount = 300.001; }, DECIMALS],
    ['three decimals in the salary', s => { s.employment.annual_salary = 83200.001; }, DECIMALS],
    ['two decimals in leave hours', s => { by(s.leave_entries, 'le-0301').hours = 78.25; }, TENTHS],
    ['two decimals in a retirement percentage', s => { change(s, 'chg-0010').value = {percent: 5.55}; change(s, 'chg-0010').setting = 'retirement'; }, TENTHS],
    ['two decimals in the maximum retirement percentage', s => { s.employer.rules.max_retirement_percent = 50.55; }, TENTHS]
  ];
  assert.equal(rules.length, 84);
  for (const [rule, change, text] of rules) {
    assert.throws(() => plugin.validateSeed(ctx, edit(base, change)), error => {
      assert.deepEqual([error.code, error.message.includes(text)], ['invalid_seed', true], rule + ': ' + error.message);
      return true;
    }, rule);
  }
  // Valid history. The overlap rule uses the states read at the clock: a pending vacation request for 23 November reads lapsed, so it holds no day,
  // and the pending sick day lv-0045 on 23 November is no overlap. The same request as sick leave does not lapse, so it overlaps.
  const twin = type => edit(base, s => s.leave_requests.push({...structuredClone(request(s, 'lv-0045')), id: 'lv-0090', leave_type_id: type}));
  plugin.validateSeed(ctx, twin('vacation'));
  assert.throws(() => plugin.validateSeed(ctx, twin('sick')), /share the day 2026-11-23/);
  // A seed can hold history that the App would refuse now: sick leave that starts 13 days before it was asked for. A run can post at its cut-off.
  plugin.validateSeed(ctx, edit(base, s => { Object.assign(request(s, 'lv-0045'), {start: '2026-11-10', end: '2026-11-10', days: ['2026-11-10']}); }));
  plugin.validateSeed(ctx, edit(base, s => { statement(s, 'ps-2026-25').posted_at = ny('2026-12-01', '17:00:00'); }));
});

test('T19e [All] seed rules never make a valid write or event fail: a fixed walk of writes, events and clock moves commits each valid step', () => {
  // A fixed pseudo-random walk, the same on every run. Each write is valid by its arguments. It commits, or the App refuses it with an error of the table.
  // A seed rule that a valid write breaks would show as invalid_seed. Each event is built to be valid, so it must commit.
  let state = 20261123;
  const random = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const choose = list => list[Math.floor(random() * list.length)], between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const f = fixture({seed: covered(), now: NOW, logging: false}), counts = {writes: 0, refused: 0, events: 0, moves: 0}, codes = new Set();
  const hour = 3600000, at = instant => new Date(instant - 5 * hour).toISOString().slice(0, 19) + '-05:00';
  const dayOf = instant => at(instant).slice(0, 10), plusDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 24 * hour).toISOString().slice(0, 10);
  let made = 0;
  for (let step = 0; step < 400; step++) {
    const data = f.data, now = Date.parse(f.ctx.virtual_now), today = dayOf(now), roll = random();
    if (roll < 0.15 && now < Date.parse('2027-03-01T00:00:00-05:00')) {
      f.advance(at(now + between(1, 72) * hour));
      plugin.validateSeed(f.ctx, f.data);
      counts.moves++;
      continue;
    }
    if (roll < 0.6) {
      const statement = choose(data.statements), window = data.windows[data.windows.length - 1], planId = choose(window.plan_ids), plan = data.plans.find(p => p.id === planId);
      const first = plusDays(today, between(-7, 40)), line = choose([...statement.earnings, ...statement.taxes, ...statement.deductions]).line_id;
      const writes = [
        ['deposit.update', {id: ACCOUNT, accounts: choose([NEW_SETUP, OLD_SETUP, [{...TRAVEL, percent: between(1, 90)}, {...CHECKING, remainder: true}]])}],
        ['withholding.update', {id: ACCOUNT, form: {...FORM, extra_withholding: between(0, 50)}}],
        ['retirement.set', {id: ACCOUNT, percent: between(0, 60)}],
        ['changes.cancel', {id: choose(data.changes).id}],
        ['inquiries.open', {id: statement.id, ...(random() < 0.5 ? {line_id: line} : {}), amount: between(1, 500), note: 'Please check.'}],
        ['inquiries.withdraw', {id: choose(data.inquiries).id}],
        ['leave.request', {id: choose(data.leave_types).id, start: first, end: plusDays(first, between(0, 6)), hours_per_day: choose([8, 4, 2.5])}],
        ['leave.cancel', {id: choose(data.leave_requests).id}],
        ['benefits.elect', {id: window.id, plan_id: plan.id, ...(plan.kind === 'options' ? {option_id: choose(plan.options).id} : {yearly_amount: between(100, 3500)})}],
        ['benefits.submit', {id: window.id}],
        ['preferences.update', {email_notices: random() < 0.5}]
      ];
      const [name, args] = choose(writes);
      try {
        f.call(name, args);
        counts.writes++;
      } catch (error) {
        assert.ok(ERRORS.includes(error.code), name + ' ' + JSON.stringify(args) + ': ' + error.code + ' ' + error.message);
        codes.add(error.code);
        counts.refused++;
      }
      continue;
    }
    // A valid event at the current time.
    const ref = 'ev-walk-' + (++made), when = at(now), planned = data.calendar.filter(e => e.state === 'planned').sort((a, b) => Date.parse(a.cutoff_at) - Date.parse(b.cutoff_at));
    const states = new Map(f.call('leave.list').items.map(r => [r.id, r.state])), sent = data.statements.flatMap(s => s.deposits).filter(d => d.state !== 'reissued');
    const yearOf = entry => Number(entry.pay_date.slice(0, 4)), closed = year => data.windows.every(w => w.plan_year !== year || Date.parse(w.closes_at) <= now);
    const lastPay = data.calendar.map(e => e.pay_date).sort().pop(), pay = plusDays(lastPay, 14);
    const candidates = [
      planned[0] && Date.parse(planned[0].cutoff_at) <= now && closed(yearOf(planned[0])) &&
        event(ref, when, 'payroll.run_posted', {entry_id: planned[0].id, statement_id: 'ps-walk-' + made, earnings: [SALARY], taxes: TAXES}),
      Date.parse(ny(plusDays(pay, -3), '17:00:00')) > now && event(ref, when, 'calendar.changed', {entry_id: 'pd-walk-' + made, period_start: plusDays(pay, -18),
        period_end: plusDays(pay, -5), pay_date: pay, cutoff_at: ny(plusDays(pay, -3), '17:00:00')}),
      sent.length > 0 && (d => event(ref, when, 'deposit.updated', d.state === 'sent' ? {deposit_id: d.id, state: 'returned'}
        : {deposit_id: d.id, state: 'reissued', reissued_to: {kind: 'check', label: 'Paper check'}}))(choose(sent)),
      data.inquiries.some(q => q.state === 'open') && event(ref, when, 'inquiry.answered', {inquiry_id: choose(data.inquiries.filter(q => q.state === 'open')).id,
        outcome: 'no_change', answered_by: 'Payroll'}),
      [...states.values()].includes('pending') && event(ref, when, 'leave.decided', {leave_request_id: choose([...states].filter(([, s]) => s === 'pending'))[0],
        decision: choose(['approve', 'deny']), decided_by: MANAGER}),
      event(ref, when, 'leave.adjusted', {entry_id: 'le-walk-' + made, leave_type_id: choose(data.leave_types).id, hours: choose([2, 4.5, 8]), reason: 'grant'}),
      !data.windows.some(w => w.plan_year === 2027) && now < Date.parse(ny('2026-12-20')) && event(ref, when, 'enrollment.opened', {window_id: 'win-walk', plan_year: 2027,
        opens_at: at(now + hour), closes_at: at(now + between(2, 9) * 24 * hour), plan_ids: ['medical', 'dental', 'fsa']})
    ].filter(Boolean);
    f.event(choose(candidates));
    counts.events++;
  }
  // The walk commits many writes and events, and the App refuses some writes for the rules of the table.
  assert.ok(counts.writes >= 80 && counts.events >= 150 && counts.moves >= 50 && counts.refused >= 50, JSON.stringify(counts));
  assert.ok(codes.size >= 5, [...codes].join(', '));
  assert.ok(f.data.statements.length >= 8, 'runs posted: ' + f.data.statements.length);
});

test('T19f [All] notifications: one for each applied event and none for the account holder\'s own writes or for a change of time', () => {
  const f = start(), seeded = SEED.notifications.map(n => n.id);
  const list = args => f.call('notifications.list', args).items.map(n => n.id);
  // The account holder's writes and the clock write no notification.
  f.call('deposit.update', {id: ACCOUNT, accounts: NEW_SETUP});
  f.call('changes.cancel', {id: 'chg-0007'});
  f.call('inquiries.open', {id: 'ps-2026-23', amount: 412.5, note: 'My travel reimbursement of 412.50 is missing.'});
  f.call('preferences.update', {timezone: 'America/New_York'});
  f.advance(ny('2026-11-19', '18:00:00'));
  assert.deepEqual(f.data.notifications.map(n => n.id), seeded);
  const events = [PLAN['ev-pl-401'], PLAN['ev-pl-440'], PLAN['ev-pl-402']];
  for (const e of events) f.event(e);
  f.advance(ny('2026-12-02'));
  f.call('leave.request', WINTER);
  events.push(PLAN['ev-pl-430'], PLAN['ev-pl-410'], PLAN['ev-pl-420'], PLAN['ev-pl-431']);
  for (const e of events.slice(3)) f.event(e);
  f.advance(ny('2027-01-10'));
  const written = f.data.notifications.slice(seeded.length);
  assert.deepEqual(written.map(n => pick(n, 'id', 'kind', 'event_id', 'object_type', 'object_id', 'at')), [
    ['ntf-0072', 'payroll.run_posted', 'ev-pl-401', 'pay_statement', 'ps-2026-24', '2026-11-20T06:00:00-05:00'],
    ['ntf-0073', 'enrollment.opened', 'ev-pl-440', 'enrollment_window', 'win-2027', '2026-11-23T09:00:00-05:00'],
    ['ntf-0074', 'calendar.changed', 'ev-pl-402', 'pay_date', 'pd-2026-25', '2026-11-23T10:15:00-05:00'],
    ['ntf-0075', 'leave.decided', 'ev-pl-430', 'leave_request', 'lv-0044', '2026-12-03T11:30:00-05:00'],
    ['ntf-0076', 'deposit.updated', 'ev-pl-410', 'deposit', 'dep-0191', '2026-12-08T09:00:00-05:00'],
    ['ntf-0077', 'inquiry.answered', 'ev-pl-420', 'inquiry', 'inq-0006', '2026-12-10T14:00:00-05:00'],
    ['ntf-0078', 'leave.adjusted', 'ev-pl-431', 'leave_balance', 'vacation', '2027-01-01T00:05:00-05:00']]);
  assert.deepEqual(written.map(n => n.title), ['Your pay for 20 November is posted: 2,280.00 net pay', 'Benefits enrollment for 2027 opens on 30 November',
    'Your next pay date moved from 4 December to 7 December', 'Leave approved: Vacation, 21 to 25 December', 'A deposit of 1,980.00 was returned',
    'Payroll answered your question on pay statement ps-2026-23', 'Your leave balance for Vacation went down by 6.0 hours']);
  assert.match(written[0].text, /Earnings 3,200\.00, taxes 640\.00, deductions 280\.00, net pay 2,280\.00\. Deposits: 300\.00 to Joint savings ending in 4410 and 1,980\.00 to Everyday checking ending in 7731\./);
  assert.match(written[3].text, /^Adaeze Okoro approved your leave request lv-0044: Vacation, 21 to 25 December, 4 working days, 32\.0 hours\. Note: Enjoy the break\.$/);
  // The list shows each notification from the moment it is written, by its day.
  assert.deepEqual([list({start: '2026-11-23', end: '2026-11-23'}), list({start: '2027-01-01'})], [['ntf-0073', 'ntf-0074'], ['ntf-0078']]);
  // A rejected event writes no notification.
  unchanged(f, () => f.event(answered(ny('2027-01-10'), 'inq-0006', 'no_change')), 'invalid_event');
  assert.equal(f.data.notifications.length, seeded.length + 7);
});

test('T19g [All] notifications: the wire message for Mail is stored only while email_notices is on, and it passes Mail\'s wire schema', () => {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  f.call('preferences.update', {email_notices: false});
  f.event(PLAN['ev-pl-440']);
  f.call('preferences.update', {email_notices: true});
  f.event(PLAN['ev-pl-402']);
  const [on, off, again] = f.data.notifications.slice(-3);
  assert.deepEqual([on.email !== null, off.email, again.email !== null], [true, null, true]);
  assert.deepEqual(f.call('notifications.list', {start: '2026-11-20'}).items.map(n => n.email_stored), [true, false, true]);
  for (const n of [on, again]) {
    assert.ok(wireSchema(n.email), n.kind);
    assert.deepEqual([n.email.id, n.email.time, n.email.source, n.email.data.recipient, n.email.data.source_object, n.email.data.content],
      [n.id, n.at, 'urn:pale:app:payleaf:account:' + ACCOUNT, {kind: 'person_ref', id: OWNER},
        {app_id: 'payleaf', account_id: ACCOUNT, object_type: n.object_type, object_id: n.object_id}, {title: n.title, body: {format: 'text/plain', text: n.text}, asset_ids: []}], n.kind);
    assert.deepEqual(pick(n.email, 'specversion', 'type', 'datacontenttype', 'dataschema'), ['1.0', 'org.pale.mail.notification.v1', 'application/json', 'urn:pale:email-payload:1']);
    assert.deepEqual(pick(n.email.data, 'channel', 'extensions'), ['channel.email', []]);
  }
  assert.deepEqual([on.email.data.subscription_ref, again.email.data.subscription_ref], [ACCOUNT + ':pay', ACCOUNT + ':pay-calendar']);
  // Two broken variants fail the schema, so the check is not empty.
  assert.ok(!wireSchema({...on.email, type: 'org.pale.mail.other'}));
  assert.ok(!wireSchema({...on.email, data: {...on.email.data, recipient: {kind: 'email', id: OWNER}}}));
});

test('T19h [All] the seven example events of the plan apply to the small seed in time order, and the wire message of ev-pl-402 is the plan\'s example', () => {
  const f = fixture({seed: SEED, now: NOW}), examples = PLAN_EVENTS.map(line => JSON.parse(line)), ordered = [...examples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  assert.deepEqual(require('./proposal-events.json'), examples);
  assert.deepEqual(examples.map(e => e.operation), EVENTS.map(name => 'payleaf.' + name));
  assert.deepEqual(ordered.map(e => e.event_id), ['ev-pl-401', 'ev-pl-440', 'ev-pl-402', 'ev-pl-430', 'ev-pl-410', 'ev-pl-420', 'ev-pl-431']);
  for (const e of ordered) f.event(e);
  assert.deepEqual(f.data.notifications.slice(-7).map(n => [n.event_id, 'payleaf.' + n.kind]), ordered.map(e => [e.event_id, e.operation]));
  // What each example did.
  assert.deepEqual(pick(statementOf(f, 'ps-2026-24'), 'deductions_total', 'net_pay'), [280, 2280]);
  assert.deepEqual(pick(f.call('calendar.list', {start: '2026-12-01', end: '2026-12-10'}).items[0], 'id', 'pay_date'), ['pd-2026-25', '2026-12-07']);
  assert.equal(statementOf(f, 'ps-2026-24').deposits[1].state, 'returned');
  const inquiry = f.call('inquiries.list', {id: 'ps-2026-23'}).items[0];
  assert.deepEqual([inquiry.id, inquiry.state, inquiry.answer.outcome, inquiry.answer.correction_amount], ['inq-0006', 'answered', 'corrected', 412.5]);
  // On 1 January lv-0044 is taken: 86.0 minus 32.0 minus the 6.0 hours forfeited is 48.0.
  assert.equal(requestOf(f, 'lv-0044').state, 'taken');
  assert.deepEqual(pick(vacation(f), 'balance', 'available'), [48, 48]);
  assert.equal(windowOf(f).state, 'closed');
  // The notification of ev-pl-402 has the plan's example as its wire message, byte for byte once parsed.
  const notice = f.data.notifications.find(n => n.event_id === 'ev-pl-402'), example = JSON.parse(PLAN_WIRE);
  assert.deepEqual(notice.email, example);
  assert.deepEqual([notice.id, notice.title, notice.text], [example.id, example.data.content.title, example.data.content.body.text]);
  assert.ok(wireSchema(example));
});

// A script that needs the real runtime. Without PALE_RUNTIME_ROOT the test is skipped. With it the script runs:
// exit code 0 is a pass, exit code 77 is a skip with the reason that the script printed, and anything else is a failure.
function withRuntime(script) {
  const runtime = process.env.PALE_RUNTIME_ROOT;
  const skip = !runtime ? 'Set PALE_RUNTIME_ROOT to the runtime folder of a PALE checkout to run ' + script + '.'
    : !fs.existsSync(path.join(ROOT, script)) ? script + ' is not in this copy of the package.' : false;
  return [{skip}, t => {
    const result = spawnSync(process.execPath, [script, '--runtime', path.resolve(runtime)], {cwd: ROOT, encoding: 'utf8', timeout: 300000});
    const reason = /^SKIP:? (.+)$/m.exec(result.stdout || '');
    if (result.status === 77) return t.skip(reason ? reason[1] : script + ' exited 77.');
    assert.equal(result.status, 0, script + ' failed:\n' + result.stdout + result.stderr);
  }];
}

test('T19i [All] Mail delivery: tests/mail.integration.cjs passes on the real runtime (a received message, an identical retry, no grant, and Payleaf without Mail)',
  ...withRuntime('tests/mail.integration.cjs'));

// The Mail sender with fake connections: plain objects with `call`. The fake router remembers each identity, like the real one:
// the same message again is a duplicate, and another message under a known identity is a conflict. `answers` replaces its next answers.
function senderWorld(snapshot, answers = []) {
  const w = {snapshot, answers, reads: [], published: []}, known = new Map();
  w.infra = {call: async name => {
    assert.equal(name, 'env.snapshot', 'The sender only reads Payleaf.');
    w.reads.push(name);
    return w.snapshot ? {status: 'ok', snapshot: structuredClone(w.snapshot)} : {status: 'permission_denied'};
  }};
  w.router = {call: async (name, {request_id, message}) => {
    assert.equal(name, 'router.publish');
    w.published.push({request_id, message});
    const answer = w.answers.shift(), first = known.get(request_id);
    if (answer instanceof Error) throw answer;
    if (answer) return answer;
    if (first) return JSON.stringify(first.message) === JSON.stringify(message) ? {...first.receipt, duplicate: true} : {status: 'rejected', code: 'idempotency_conflict'};
    known.set(request_id, {message, receipt: {status: 'committed', event_id: 'mail-' + (known.size + 1)}});
    return known.get(request_id).receipt;
  }};
  w.sender = firstEpoch => createSender({infra: w.infra, router: w.router, firstEpoch});
  return w;
}
// One lifecycle of the App as `env.snapshot` shows it: its epoch, the loaded seed and the current data.
const lifecycle = (epoch, seed, data) => ({epoch, initial_data: seed, data});
const delivered = (id, request_id, n) => ({notification_id: id, request_id, status: 'committed', code: null, event_id: 'mail-' + n, duplicate: false});
const undelivered = (id, {status, code}) => ({notification_id: id, request_id: id, status, code, event_id: null, duplicate: false});

test('T19j [All] Mail sender: a notification is delivered once, under its ID in the first lifecycle and as <id>.e<epoch> after a reset', async () => {
  const f = start(), g = start();
  f.event(PLAN['ev-pl-401']);
  const w = senderWorld(lifecycle(2, BASE, f.data)), sender = w.sender(), first = f.data.notifications[f.data.notifications.length - 1];
  // The three notifications of the seed are history, so only ntf-0072 is sent.
  assert.deepEqual(await sender.publishPending(), {epoch: 2, firstEpoch: 2, lifecycle: 'first', results: [delivered('ntf-0072', 'ntf-0072', 1)], stopped: false});
  assert.deepEqual(w.published, [{request_id: 'ntf-0072', message: first.email}]);
  assert.deepEqual((await sender.publishPending()).results, []);
  f.event(PLAN['ev-pl-440']);
  w.snapshot = lifecycle(2, BASE, f.data);
  assert.deepEqual((await sender.publishPending()).results, [delivered('ntf-0073', 'ntf-0073', 2)]);
  // After `env.reset` the App has a new epoch, and its next notification is ntf-0072 again, with other content.
  g.event(PLAN['ev-pl-440']);
  w.snapshot = lifecycle(3, BASE, g.data);
  const renewed = g.data.notifications[g.data.notifications.length - 1], identity = 'ntf-0072.e3';
  assert.deepEqual(await sender.publishPending(), {epoch: 3, firstEpoch: 2, lifecycle: 'later', results: [delivered('ntf-0072', identity, 3)], stopped: false});
  assert.deepEqual(w.published[2], {request_id: identity, message: {...renewed.email, id: identity}});
  assert.ok(wireSchema(w.published[2].message) && renewed.email.id === 'ntf-0072' && renewed.title !== first.title);
  assert.deepEqual([(await sender.publishPending()).results, w.published.length, w.reads], [[], 3, Array(5).fill('env.snapshot')]);
});

test('T19k [All] Mail sender: what the loaded seed held is never sent, a notification with no wire message is skipped, and a refusal for lack of a route is final', async () => {
  const f = start();
  f.call('preferences.update', {email_notices: false});
  f.event(PLAN['ev-pl-401']);
  f.call('preferences.update', {email_notices: true});
  f.event(PLAN['ev-pl-440']);
  f.event(PLAN['ev-pl-402']);
  assert.deepEqual(f.data.notifications.slice(-3).map(n => [n.id, n.email !== null]), [['ntf-0072', false], ['ntf-0073', true], ['ntf-0074', true]]);
  for (const code of ['recipient_not_authorized', 'recipient_unavailable', 'ambiguous_recipient', 'unsupported_recipient']) {
    const w = senderWorld(lifecycle(2, BASE, f.data), [{status: 'rejected', code}]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results], [false, [undelivered('ntf-0073', {status: 'rejected', code}), delivered('ntf-0074', 'ntf-0074', 1)]], code);
    assert.deepEqual([(await sender.publishPending()).results, w.published.map(p => p.request_id)], [[], ['ntf-0073', 'ntf-0074']], code);
  }
  // A second seed that holds ntf-0072 to ntf-0074 as history: only what comes after them is new.
  const g = fixture({seed: f.data, now: f.ctx.virtual_now});
  g.event(depositUpdated(ny('2026-11-24'), 'dep-0191', 'returned'));
  const w = senderWorld(lifecycle(3, f.data, g.data)), out = await w.sender(2).publishPending();
  assert.deepEqual(out.results.map(row => row.request_id), ['ntf-0075.e3']);
});

test('T19l [All] Mail sender: every other answer stops the sender, nothing more is published, and the next call tries that notification again', async () => {
  const f = start();
  f.event(PLAN['ev-pl-401']);
  f.event(PLAN['ev-pl-440']);
  const answers = [
    ['idempotency_conflict', {status: 'rejected', code: 'idempotency_conflict'}],
    ['an identity that the router refuses', {status: 'rejected', code: 'source_identity_mismatch'}],
    ['a contract that the router refuses', {status: 'rejected', code: 'incompatible_contract'}],
    ['an unexpected status', {status: 'permission_denied', code: 'operation_unavailable'}],
    ['a refusal with stop_run', {status: 'rejected', code: 'receiver_rejected', stop_run: true}],
    ['a refusal for lack of a route with stop_run', {status: 'rejected', code: 'recipient_unavailable', stop_run: true}],
    ['unknown', {status: 'unknown', code: 'receiver_unconfirmed', stop_run: true}],
    ['halted', {status: 'halted', code: 'run_halted'}],
    ['a router that throws', new Error('The router does not answer.'), {status: 'unknown', code: 'router_unreachable'}],
    ['a router that returns no receipt', 'no receipt', {status: 'unknown', code: 'router_unreachable'}]
  ];
  for (const [label, answer, shown = answer] of answers) {
    const w = senderWorld(lifecycle(2, BASE, f.data), [answer]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results, w.published.length], [true, [undelivered('ntf-0072', shown)], 1], label);
    const again = await sender.publishPending();
    assert.deepEqual([again.stopped, again.results], [false, [delivered('ntf-0072', 'ntf-0072', 1), delivered('ntf-0073', 'ntf-0073', 2)]], label);
  }
  // It throws when it cannot read Payleaf, and it publishes nothing.
  const w = senderWorld(null);
  await assert.rejects(w.sender().publishPending(), /env\.snapshot returned permission_denied/);
  assert.deepEqual([w.reads, w.published], [['env.snapshot'], []]);
});

test('T19m [All] Mail sender: after a reset a second sender publishes as <id>.e<epoch> only when it gets the first epoch, so Infra keeps one sender for the run', async () => {
  const f = start(), g = start();
  f.event(PLAN['ev-pl-401']);
  g.event(PLAN['ev-pl-440']);
  const w = senderWorld(lifecycle(2, BASE, f.data)), first = await w.sender().publishPending();
  const read = out => [out.firstEpoch, out.lifecycle, out.stopped, out.results.map(row => [row.request_id, row.status, row.code])];
  assert.deepEqual(read(first), [2, 'first', false, [['ntf-0072', 'committed', null]]]);
  w.snapshot = lifecycle(3, BASE, g.data);
  // A new sender that does not know the first epoch reuses the plain ID. The router knows it with other content, so the sender stops.
  assert.deepEqual(read(await w.sender().publishPending()), [3, 'first', true, [['ntf-0072', 'rejected', 'idempotency_conflict']]]);
  assert.deepEqual(read(await w.sender(first.firstEpoch).publishPending()), [2, 'later', false, [['ntf-0072.e3', 'committed', null]]]);
});

test('T20 [All] Core contracts: tests/mcp.integration.cjs passes on the real runtime (task seed and clock, env.advance_time, replay, idempotency_conflict, stale_version, permission_denied, reset)',
  ...withRuntime('tests/mcp.integration.cjs'));

test('T20b [All] platform clock: with advance() and no App code a change reads locked, a window closed, a set final or defaulted, leave taken or lapsed, and the inquiry window ends', () => {
  const f = fixture({seed: covered(), now: NOW});
  walk(f, {run: s => s.event(PLAN['ev-pl-401']), open: s => s.event(PLAN['ev-pl-440'])});
  f.advance(ny('2026-11-30', '12:00:00'));
  const change = f.call('retirement.set', {id: ACCOUNT, percent: 6}).id;
  f.call('leave.request', WINTER);
  f.call('leave.request', {id: 'vacation', start: '2026-12-28', end: '2026-12-28', hours_per_day: 8});
  f.event(decided(ny('2026-11-30', '13:00:00'), 'lv-0045', 'approve'));
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 2600});
  f.call('benefits.submit', {id: 'win-2027'});
  // A second run with nothing submitted.
  const g = fixture({seed: covered(), now: NOW});
  walk(g, {run: s => s.event(PLAN['ev-pl-401']), open: s => s.event(PLAN['ev-pl-440'])});
  const read = () => [changeOf(f, change).state, windowOf(f).state, windowOf(f).set.state, requestOf(f, 'lv-0044').state, requestOf(f, 'lv-0045').state,
    (windowOf(g).set || {state: null}).state];
  assert.deepEqual(read(), ['waiting', 'open', 'submitted', 'pending', 'approved', null]);
  const steps = [
    [ny('2026-12-01', '17:00:00'), ['locked', 'open', 'submitted', 'pending', 'approved', null]],
    [ny('2026-12-11', '23:59:58'), ['locked', 'open', 'submitted', 'pending', 'approved', null]],
    [ny('2026-12-11', '23:59:59'), ['locked', 'closed', 'final', 'pending', 'approved', 'defaulted']],
    [ny('2026-12-21', '00:00:00'), ['locked', 'closed', 'final', 'lapsed', 'approved', 'defaulted']],
    [ny('2026-12-29', '00:00:00'), ['locked', 'closed', 'final', 'lapsed', 'taken', 'defaulted']]
  ];
  for (const [time, states] of steps) {
    const before = [f.data, g.data];
    f.advance(time);
    g.advance(time);
    assert.deepEqual([f.data, g.data], before, time);
    assert.deepEqual(read(), states, time);
  }
  // The inquiry window of the statement of 23 October ends with 22 December, 60 days later, also by the clock alone.
  const h = fixture({seed: BASE, now: ny('2026-12-22', '23:59:59')}), ask = () => h.call('inquiries.open', {id: 'ps-2026-22', amount: 5, note: 'Please check.'});
  assert.equal(statementOf(h, 'ps-2026-22').last_inquiry_day, '2026-12-22');
  const before = h.data;
  h.advance(ny('2026-12-23', '00:00:00'));
  assert.deepEqual(h.data, before);
  unchanged(h, ask, 'too_late', 'the day after the last day');
  assert.equal(fixture({seed: BASE, now: ny('2026-12-22', '23:59:59')}).call('inquiries.open', {id: 'ps-2026-22', amount: 5, note: 'Please check.'}).id, 'inq-0006');
});

test('T20c [All] records: one activity row for each committed write, each applied event and each effect, and none for a refused call, a read or a change of time', () => {
  const f = start(), expected = [], applied = [], EFFECT = true;
  const rows = (actor, ref, list) => list.forEach(([action, object_id, effect = false]) => expected.push({seq: expected.length + 1, at: f.ctx.virtual_now,
    actor, action, object_id, request_id: actor === 'agent' ? ref : null, event_id: actor === 'event' ? ref : null, effect}));
  // Each step names the rows that it must write: its own row first, then one row for each effect.
  const write = (name, args, ...list) => {
    const request_id = 'rq-' + (expected.length + 1);
    f.call(name, {...args, request_id});
    rows('agent', request_id, list);
  };
  const apply = (e, ...list) => { f.event(e); applied.push(e.event_id); rows('event', e.event_id, list); };
  write('retirement.set', {id: ACCOUNT, percent: 6}, ['retirement.set', 'chg-0007']);
  write('retirement.set', {id: ACCOUNT, percent: 7}, ['retirement.set', 'chg-0008']);
  write('withholding.update', {id: ACCOUNT, form: {...FORM, extra_withholding: 10}}, ['withholding.update', 'chg-0009']);
  write('deposit.update', {id: ACCOUNT, accounts: NEW_SETUP}, ['deposit.update', 'chg-0010']);
  write('changes.cancel', {id: 'chg-0010'}, ['changes.cancel', 'chg-0010']);
  write('inquiries.open', {id: 'ps-2026-23', line_id: 't1', amount: 412, note: 'Please check the tax.'}, ['inquiries.open', 'inq-0006']);
  write('inquiries.withdraw', {id: 'inq-0006'}, ['inquiries.withdraw', 'inq-0006']);
  write('inquiries.open', {id: 'ps-2026-23', amount: 412.5, note: 'My travel reimbursement of 412.50 is missing.'}, ['inquiries.open', 'inq-0007']);
  write('preferences.update', {email_notices: true}, ['preferences.update', ACCOUNT]);
  apply(PLAN['ev-pl-401'], ['payroll.run_posted', 'pd-2026-24'], ['statement.written', 'ps-2026-24', EFFECT], ['change.applied', 'chg-0006', EFFECT],
    ['leave.earned', 'le-r0147', EFFECT], ['leave.earned', 'le-r0148', EFFECT], ['notification.written', 'ntf-0072', EFFECT]);
  apply(PLAN['ev-pl-440'], ['enrollment.opened', 'win-2027'], ['notification.written', 'ntf-0073', EFFECT]);
  apply(PLAN['ev-pl-402'], ['calendar.changed', 'pd-2026-25'], ['notification.written', 'ntf-0074', EFFECT]);
  write('leave.request', WINTER, ['leave.request', 'lv-0044']);
  write('leave.request', {id: 'vacation', start: '2027-01-04', end: '2027-01-05', hours_per_day: 8}, ['leave.request', 'lv-0045']);
  write('leave.cancel', {id: 'lv-0045'}, ['leave.cancel', 'lv-0045']);
  apply(PLAN['ev-pl-430'], ['leave.decided', 'lv-0044'], ['notification.written', 'ntf-0075', EFFECT]);
  write('benefits.elect', {id: 'win-2027', plan_id: 'medical', option_id: 'med-hdhp-ee'}, ['benefits.elect', 'win-2027']);
  write('benefits.elect', {id: 'win-2027', plan_id: 'fsa', no_coverage: true}, ['benefits.elect', 'win-2027']);
  write('benefits.submit', {id: 'win-2027'}, ['benefits.submit', 'els-0002']);
  // The run of 7 December applies the withholding change and the latest retirement change, and stores the earlier one as replaced.
  apply(run('pd-2026-25', '2026-12-07'), ['payroll.run_posted', 'pd-2026-25'], ['statement.written', 'ps-2026-25', EFFECT],
    ['change.applied', 'chg-0009', EFFECT], ['change.replaced', 'chg-0007', EFFECT], ['change.applied', 'chg-0008', EFFECT],
    ['leave.earned', 'le-r0149', EFFECT], ['leave.earned', 'le-r0150', EFFECT], ['notification.written', 'ntf-0076', EFFECT]);
  apply(PLAN['ev-pl-410'], ['deposit.updated', 'dep-0191'], ['notification.written', 'ntf-0077', EFFECT]);
  apply(answered(ny('2026-12-09'), 'inq-0007', 'corrected', {correction_amount: 412.5}), ['inquiry.answered', 'inq-0007'], ['notification.written', 'ntf-0078', EFFECT]);
  // A refused write, a rejected event, every read and a change of time write no row.
  unchanged(f, () => f.call('changes.cancel', {id: 'chg-0010'}), 'invalid_state');
  unchanged(f, () => f.event(answered(ny('2026-12-09'), 'inq-0007', 'no_change')), 'invalid_event');
  everyRead(f);
  f.advance(ny('2026-12-31'));
  apply(PLAN['ev-pl-431'], ['leave.adjusted', 'le-0310'], ['notification.written', 'ntf-0079', EFFECT]);

  assert.deepEqual(f.data.activity, expected);
  const actions = actor => [...new Set(expected.filter(row => row.actor === actor && !row.effect).map(row => row.action))].sort();
  assert.deepEqual([actions('agent'), actions('event')], [[...WRITES].sort(), [...EVENTS].sort()]);
  assert.deepEqual([...new Set(expected.filter(row => row.effect).map(row => row.action))].sort(),
    ['change.applied', 'change.replaced', 'leave.earned', 'notification.written', 'statement.written']);
  // One notification for each applied event, with its event_id, and none for the 20 writes of the 11 kinds.
  assert.deepEqual(f.data.notifications.slice(SEED.notifications.length).map(n => n.event_id), applied);
  // A setting change keeps its own history: the write that made it and the run that stored it.
  assert.deepEqual(f.data.changes.find(c => c.id === 'chg-0007').history, [{at: NOW, action: 'retirement.set', actor: 'agent', ref: 'rq-1'},
    {at: '2026-12-07T06:00:00-05:00', action: 'change.replaced', actor: 'event', ref: 'ev-run-2026-25'}]);
  const submit = expected.find(row => row.action === 'benefits.submit');
  assert.deepEqual(f.data.election_sets.find(s => s.id === 'els-0002').history.map(row => [row.at, row.request_id]), [[submit.at, submit.request_id]]);
});

test('T20d [All] the error table: each of the 12 App errors, and the first one of the table when two fit one call', () => {
  const f = start();
  walk(f, {run: s => s.event(PLAN['ev-pl-401']), open: s => s.event(PLAN['ev-pl-440'])});
  f.advance(ny('2026-11-30', '10:00:00'));
  f.call('retirement.set', {id: ACCOUNT, percent: 6});
  f.call('leave.request', WINTER);
  f.call('inquiries.open', {id: 'ps-2026-24', amount: 10, note: 'Please check.'});
  f.call('benefits.elect', {id: 'win-2027', plan_id: 'medical', option_id: 'med-hdhp-ee'});
  // On 2 December: chg-0007 is locked, lv-0044 is pending, inq-0006 is open, win-2027 is open, and the spending account has no saved choice.
  f.advance(ny('2026-12-02'));
  const call = (name, args) => () => f.call(name, args);
  const vacation = (start, end) => call('leave.request', {id: 'vacation', start, end, hours_per_day: 8});
  // [the call, the error, the other error of the table that also fits, or null]
  const cases = [
    [call('pay_statements.get', {id: 'ps-2099-01'}), 'not_found', null],
    [call('changes.cancel', {id: 'chg-0005'}), 'invalid_state', null],
    [call('preferences.update', {timezone: 'Mars/Olympus'}), 'invalid_timezone', null],
    [call('calendar.list', {start: '2026-12-10', end: '2026-12-01'}), 'invalid_window', null],
    [call('benefits.elect', {id: 'win-2026', plan_id: 'medical', option_id: 'med-ppo-ee'}), 'window_closed', null],
    [call('changes.cancel', {id: 'chg-0007'}), 'too_late', null],
    [call('deposit.update', {id: ACCOUNT, accounts: [{...SAVINGS, amount: 300}]}), 'invalid_split', null],
    [call('retirement.set', {id: ACCOUNT, percent: 60}), 'over_limit', null],
    [call('inquiries.open', {id: 'ps-2026-24', amount: 10, note: 'Again.'}), 'already_open', null],
    [call('leave.request', {id: 'sick', start: '2026-12-21', end: '2026-12-21', hours_per_day: 8}), 'conflict', null],
    [vacation('2027-01-04', '2027-01-19'), 'insufficient_balance', null],
    [call('benefits.submit', {id: 'win-2027'}), 'incomplete', null],
    // Two errors fit.
    [call('leave.list', {id: 'holiday', start: '2026-12-10', end: '2026-12-01'}), 'not_found', 'invalid_window'],
    [call('benefits.elect', {id: 'win-2026', plan_id: 'medical', option_id: 'med-none'}), 'not_found', 'window_closed'],
    [call('deposit.update', {id: 'payleaf-other', accounts: [{...SAVINGS, amount: 300}]}), 'not_found', 'invalid_split'],
    [call('retirement.set', {id: 'payleaf-other', percent: 60}), 'not_found', 'over_limit'],
    [call('leave.cancel', {id: 'lv-0040'}), 'invalid_state', 'too_late'],
    [vacation('2026-12-08', '2026-12-07'), 'invalid_window', 'too_late'],
    [call('leave.request', {id: 'sick', start: '2026-11-24', end: '2026-12-21', hours_per_day: 1}), 'invalid_window', 'conflict'],
    [call('benefits.elect', {id: 'win-2026', plan_id: 'fsa', yearly_amount: 3500}), 'window_closed', 'over_limit'],
    [vacation('2026-12-15', '2026-12-21'), 'too_late', 'conflict'],
    [vacation('2026-12-07', '2026-12-18'), 'too_late', 'insufficient_balance'],
    [vacation('2026-12-21', '2027-01-08'), 'conflict', 'insufficient_balance']
  ];
  for (const [fn, code, other] of cases) unchanged(f, fn, code, code + (other ? ' before ' + other : ''));
  assert.deepEqual([...new Set(cases.map(([, code]) => code))], ERRORS);
  // The pairs where preview can show both errors: it lists every rule that fails, in the order of the table.
  const failures = (start, end) => f.call('leave.preview', {id: 'vacation', start, end, hours_per_day: 8}).failures.map(x => x.code);
  assert.deepEqual([failures('2026-12-08', '2026-12-07'), failures('2026-12-15', '2026-12-21'), failures('2026-12-07', '2026-12-18'), failures('2026-12-21', '2027-01-08')],
    [['invalid_window', 'too_late'], ['too_late', 'conflict'], ['too_late', 'insufficient_balance'], ['conflict', 'insufficient_balance']]);
});

test('PKG diagnostics on, off and broken give the same data', () => {
  const on = start(), off = start({logging: false}), broken = start();
  broken.ctx.log = () => { throw new Error('logger offline'); };
  for (const f of [on, off, broken]) walk(f, PAY_PATH);
  assert.deepEqual(on.data, off.data);
  assert.deepEqual(broken.data, off.data);
  assert.ok(on.logs.length);
  assert.equal(off.logs.length, 0);
});

// The code of the App and of its sender, and the files that run with the business tests, each with the host modules that it needs.
// Not in these lists: tests/mcp.integration.cjs and tests/mail.integration.cjs load the runtime from the path they are given, and dev/ reads the plan.
const sources = dir => fs.readdirSync(path.join(ROOT, dir)).filter(file => file.endsWith('.cjs')).map(file => dir + '/' + file);
const APP_CODE = [...sources('src'), ...sources('infra'), 'plugin.cjs'];
const TEST_CODE = {'tests/business.test.cjs': ['fs', 'child_process'], 'tests/schema-validator.cjs': ['fs'], 'tests/harness.cjs': [], 'examples/run.cjs': []};
const HOST_MODULE = /^(?:node:)?(fs|child_process|net|http|https|os)$/;
// Every module that a file loads. A target that is not a plain string cannot be checked, so it fails.
function loads(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(!/\b(require|import)\s*\((?!\s*['"][^'"]+['"]\s*\))/.test(text), file + ' loads a module that a plain string does not name');
  return {text, targets: [...text.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g)].map(match => match[1])};
}

test('PKG the text of src, infra and plugin.cjs has no host clock, timer or random source, no process, fetch, performance or crypto, and no require of a Node module', () => {
  // `Date(` with no `new` gives the host time as text. `new Date(value)`, `Date.UTC` and `Date.parse` read no clock.
  const banned = [/Date\.now\s*\(/, /new\s+Date\s*\(\s*\)/, /(?<!new\s+)\bDate\s*\(/, /Math\.random/, /\b(fetch|process|performance|setTimeout|setInterval|crypto)\b/];
  assert.ok(APP_CODE.includes('src/operations.cjs') && APP_CODE.includes('src/time.cjs') && APP_CODE.includes('infra/sender.cjs') && APP_CODE.includes('plugin.cjs'));
  for (const file of APP_CODE) {
    const {text, targets} = loads(file);
    for (const pattern of banned) assert.ok(!pattern.test(text), file + ' matches ' + pattern);
    for (const target of targets) assert.ok(!HOST_MODULE.test(target) && target.startsWith('.'), file + ' requires ' + target);
  }
  const found = text => banned.some(pattern => pattern.test(text));
  for (const text of ['Date.now()', 'new Date()', 'x = Date()', 'Math.random()', 'fetch(url)', 'process.env', 'performance.now()', 'setTimeout(f, 1)', 'setInterval(f, 1)', 'crypto.randomUUID()']) assert.ok(found(text), text);
  for (const text of ['new Date(instant)', 'Date.UTC(2026, 11, 2)', 'Date.parse(value)', 'processed', 'refetch']) assert.ok(!found(text), text);
});

test('PKG no require in src, infra, plugin.cjs, tests/business.test.cjs, tests/harness.cjs, tests/schema-validator.cjs or examples/run.cjs leaves the package, and the last four load only the host modules that they need', () => {
  for (const file of [...APP_CODE, ...Object.keys(TEST_CODE)]) {
    for (const target of loads(file).targets) {
      const builtin = target.startsWith('node:') || builtinModules.includes(target), host = HOST_MODULE.exec(target);
      const inside = target.startsWith('.') && path.resolve(ROOT, path.dirname(file), target).startsWith(ROOT + path.sep);
      assert.ok(builtin || inside, file + ' requires ' + target);
      assert.ok(!host || (TEST_CODE[file] || []).includes(host[1]), file + ' requires ' + target);
    }
  }
});

test('PKG contribution.json declares one publish entry for channel.email, no receiver and no required App, so Mail is optional and send-only', () => {
  const {messaging, dependencies} = require('../contribution/contribution.json');
  assert.deepEqual(messaging.publishes.map(entry => pick(entry, 'channel', 'schema_id', 'event_type', 'payload_schema_id', 'schema_ref')),
    [['channel.email', 'urn:pale:email-message:2', 'org.pale.mail.notification.v1', 'urn:pale:email-payload:1', 'schemas/router-message.schema.json']]);
  assert.deepEqual([messaging.receives, dependencies.required_apps, require('../app.json').dependencies], [[], [], []]);
});

test('PKG tools.json has exactly the 14 read and 11 write operations of the plan, and app.json declares the seven events', () => {
  const names = readOnly => tools.filter(tool => tool.read_only === readOnly).map(tool => tool.name).sort();
  const full = list => list.map(name => 'payleaf.' + name).sort();
  assert.deepEqual([names(true), names(false), tools.length], [full(READS), full(WRITES), 25]);
  assert.deepEqual([...require('../app.json').event_types].sort(), full(EVENTS));
  // Every write takes Core's `request_id` and `expected_version` and returns an `id`. Every read returns `now`.
  for (const tool of tools) {
    const needs = tool.read_only ? [] : ['request_id', 'expected_version'], gives = tool.read_only ? 'now' : 'id';
    assert.ok(needs.every(key => tool.inputSchema.required.includes(key)) && tool.outputSchema.required.includes(gives), tool.name);
  }
});

// The evaluation dataset of data/evaluation/: two years of synthetic history, apart from the small fixtures above.
const EVALUATION = path.join(ROOT, 'data/evaluation');
const evaluation = file => JSON.parse(fs.readFileSync(path.join(EVALUATION, file), 'utf8'));
const script = (...args) => spawnSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8', timeout: 50000});
const {records} = require('../src/model.cjs');
const crypto = require('node:crypto');

test('DATA the evaluation seed passes the App\'s own seed checks at its clock, and its record count and synthetic provenance match its dataset.json', () => {
  const seed = evaluation('seed.json'), clock = evaluation('clock.json').initial_time, dataset = evaluation('dataset.json');
  const f = fixture({seed, now: clock, logging: false});
  assert.ok(compile(require('../schemas/dataset.schema.json'), path.join(ROOT, 'schemas'))(dataset), 'Dataset schema');
  assert.deepEqual([records(seed).length, dataset.expected_counts.records], [165, 165]);
  assert.deepEqual(dataset.sources.map(s => [s.source_id, s.kind, s.generation.seed]), [['evaluation-generator', 'synthetic', 20250101]]);
  assert.deepEqual(dataset.record_source_ids, ['evaluation-generator']);
  assert.ok(require('../contribution/dataset.json').sources.some(s => s.source_id === 'evaluation-generator' && s.kind === 'synthetic'));
  const statements = f.call('pay_statements.list', {start: '2025-01-01', end: '2026-12-31'}).items;
  assert.deepEqual([statements.length, statements[0].pay_date, statements[51].pay_date], [52, '2025-01-03', '2026-12-18']);
  assert.deepEqual(f.call('calendar.list', {start: '2027-01-01'}).items.map(e => [e.id, e.state]),
    [['pd-2027-01', 'planned'], ['pd-2027-02', 'planned'], ['pd-2027-03', 'planned'], ['pd-2027-04', 'planned']]);
});

test('DATA the generator, the coverage report and the consistency script all pass on the committed evaluation files', () => {
  for (const args of [['dev/generate-evaluation-data.cjs', '--check'], ['dev/coverage.cjs', '--check'],
    ['dev/check-fixture.cjs', 'data/evaluation/seed.json', evaluation('clock.json').initial_time]]) {
    const result = script(...args);
    assert.equal(result.status, 0, args.join(' ') + '\n' + result.stdout + result.stderr);
  }
  const manifest = evaluation('manifest.json');
  for (const name of ['seed.json', 'clock.json', 'dataset.json']) {
    const text = fs.readFileSync(path.join(EVALUATION, name));
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), manifest.files[name].sha256, name);
  }
});

test('DATA a seed as of a time holds only the history before it, with each record in its state at that time, and the App accepts it at that time', () => {
  const {select} = require('../dev/select-evaluation-seed.cjs');
  const {ACTUAL} = require('../dev/coverage.cjs');
  const full = evaluation('seed.json');
  // Every timestamp of a value, at any depth, with its key. Only the due times of a schedule may be later than the seed's time.
  const stamps = (value, key = '', out = []) => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) out.push([key, value]);
    else if (value && typeof value === 'object') for (const [inner, item] of Object.entries(value)) stamps(item, Array.isArray(value) ? key : inner, out);
    return out;
  };
  const after = (seed, asOf) => stamps(seed).filter(([key, value]) => !['cutoff_at', 'opens_at', 'closes_at'].includes(key) && Date.parse(value) > Date.parse(asOf));
  assert.ok(after(full, '2026-11-19T12:00:00-05:00').length > 0, 'control: the full seed has timestamps after 19 November');
  for (const asOf of ['2025-01-01T00:00:00-05:00', '2025-07-15T12:00:00-04:00', '2026-01-01T00:05:00-05:00', '2026-11-19T12:00:00-05:00']) {
    const seed = select(asOf), f = fixture({seed, now: asOf, logging: false});
    assert.deepEqual(after(seed, asOf), [], asOf + ': a timestamp after the time of the seed');
    // Nothing is lost either: each actual row of the full seed up to that time is in the selected seed, with the same date.
    for (const kind of ACTUAL) {
      assert.deepEqual(kind.rows(seed), kind.rows(full).filter(([, value]) => Date.parse(value) <= Date.parse(asOf)), asOf + ': ' + kind.kind);
    }
    assert.deepEqual(seed.statements.map(s => s.id), full.statements.filter(s => Date.parse(s.posted_at) <= Date.parse(asOf)).map(s => s.id), asOf);
    assert.ok(records(seed).every(record => records(full).some(x => x.id === record.id)), asOf + ': record IDs are kept');
    assert.equal(f.call('pay_statements.list').items.length, seed.statements.length);
  }
  const mid = select('2026-11-19T12:00:00-05:00');
  // The pay date of 20 November has not posted yet, and the trip of 28 to 31 December is approved but not taken.
  assert.deepEqual([mid.calendar.find(e => e.id === 'pd-2026-24').state, mid.leave_requests.find(r => r.start === '2026-12-28').stored_state], ['planned', 'approved']);
  assert.deepEqual([mid.employment.annual_salary, select('2025-01-01T00:00:00-05:00').employment.annual_salary], [83200, 78000]);
  assert.deepEqual(select(evaluation('clock.json').initial_time), full);
  assert.throws(() => select('2027-01-02T00:00:00-05:00'), /not inside/);
});

test('DATA coverage: every month of 2025 and 2026 has actual records, the only exclusion is the election set of November 2024, and scheduled rows are counted apart', () => {
  const coverage = evaluation('coverage.json');
  assert.deepEqual([coverage.timezone, coverage.window, coverage.clock], ['America/New_York', {first: '2025-01-01', last: '2026-12-31'}, evaluation('clock.json').initial_time]);
  assert.deepEqual(coverage.actual.gaps.months_without_actual_records, []);
  assert.ok(coverage.actual.monthly.every(m => m.records > 0 && m.by_kind.pay_statements >= 2), 'two pay statements or more in every month');
  assert.deepEqual(coverage.actual.exclusions.map(x => [x.kind, x.id, x.reason]), [['election_sets', 'els-0001', 'before 2025-01-01']]);
  assert.deepEqual([coverage.actual.global.distinct_dates, coverage.actual.global.earliest, coverage.actual.global.latest], [138, '2025-01-01', '2026-12-29']);
  assert.deepEqual([coverage.provenance.real, coverage.provenance.mixed, coverage.provenance.synthetic], [0, 0, coverage.actual.counted_rows]);
  const scheduled = Object.fromEntries(coverage.scheduled.kinds.map(k => [k.kind, k]));
  assert.deepEqual([scheduled.pay_calendar.rows, scheduled.pay_calendar.after_clock], [56, 4]);
  assert.ok(!coverage.actual.kinds.some(k => k.kind in scheduled), 'no kind is in both groups');
  assert.ok(coverage.scheduled.future_rows.every(x => x.value.slice(0, 4) === '2027'), 'every future row is in 2027');
});

test('DATA load and query: tests/evaluation.integration.cjs loads the evaluation seed with env.load_seed on the real runtime and reads the counts of the coverage report through MCP',
  ...withRuntime('tests/evaluation.integration.cjs'));
