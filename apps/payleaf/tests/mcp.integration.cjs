#!/usr/bin/env node
'use strict';
// Real MCP checks for what the public verifier does not exercise. One Infra and one Agent process talk to the App over stdio.
// Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {records} = require('../src/model.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'payleaf.', RUN = 'payleaf-mcp', ACCOUNT = 'payleaf-kai';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const READS = ['employment.get', 'calendar.list', 'pay_statements.list', 'pay_statements.get', 'settings.get', 'changes.list', 'inquiries.list', 'leave.balances',
  'leave.list', 'leave.preview', 'benefits.windows', 'benefits.get', 'notifications.list', 'preferences.get'];
const WRITES = ['deposit.update', 'withholding.update', 'retirement.set', 'changes.cancel', 'inquiries.open', 'inquiries.withdraw', 'leave.request', 'leave.cancel',
  'benefits.elect', 'benefits.submit', 'preferences.update'];
const ADMIN = ['env.apply_event', 'env.reset', 'env.advance_time', 'env.load_seed', 'env.snapshot', 'env.event_status', 'env.validate_bundle'];
// An instant of late 2026 in the employer's time zone: at('12-04 06:00').
const at = text => '2026-' + text.slice(0, 5) + 'T' + text.slice(6) + ':00-05:00';
const START = at('11-19 14:00'), CLOSED = '2026-12-12T00:00:00-05:00', NEW_YEAR = '2027-01-01T06:00:00-05:00';
const SAVINGS = {label: 'Joint savings', kind: 'savings', last4: '4410', amount: 300};
const NEW_CHECKING = {label: 'New checking', kind: 'checking', last4: '2208', remainder: true};
const FORM = {filing_status: 'single', multiple_jobs: false, dependents_amount: 0, other_income: 0, deductions: 0, extra_withholding: 40};
const TAXES = [{line_id: 't1', text: 'Federal income tax', amount: 412}, {line_id: 't2', text: 'Social security and Medicare', amount: 228}];
const payRun = (entry_id, statement_id, extra = []) => ({entry_id, statement_id, earnings: [{line_id: 'e1', kind: 'salary', text: 'Regular pay', amount: 3200}, ...extra], taxes: TAXES});
const WINDOW = {window_id: 'win-2027', plan_year: 2027, opens_at: at('11-30 00:00'), closes_at: '2026-12-11T23:59:59-05:00', plan_ids: ['medical', 'dental', 'fsa']};
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const names = list => list.map(name => APP + name).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--runtime', '--report'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const checks = [];
function check(name, condition, got) {
  checks.push({name, status: condition ? 'passed' : 'failed'});
  if (!condition) throw new Error(name + (got === undefined ? '' : '\n  got: ' + JSON.stringify(got)));
}
function equal(name, actual, expected) {
  check(name, util.isDeepStrictEqual(actual, expected), {expected, actual});
}

// The connections of one run, with the version that the last committed call returned.
async function connect(runtime, prepared, clients) {
  const {Client} = require(path.join(runtime, 'client.cjs'));
  const open = async (role, run = RUN) => {
    const client = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'payleaf-mcp-integration', {registry: prepared.registry});
    clients.push(client);
    await client.initialize();
    return client;
  };
  const t = {infra: await open('infra'), agent: await open('agent'), peer: await open('infra', 'other-run'), version: null, seq: 0, writes: [], events: [], refusals: [], advances: [],
    copy: path.join(prepared.root, 'apps', prepared.app)};
  t.snapshot = async (client = t.infra) => (await client.call('env.snapshot')).snapshot;
  t.read = (name, args = {}) => t.agent.call(APP + name, args);
  t.get = async (name, args = {}) => {
    const result = await t.read(name, args);
    if (result.status !== 'ok') throw new Error(name + ' failed: ' + JSON.stringify(result));
    return result;
  };
  const committed = (label, result) => {
    if (result.status !== 'committed') throw new Error(label + ' was not committed: ' + JSON.stringify(result));
    t.version = result.version;
  };
  // An Agent write with the current version. `write` needs a commit, and `attempt` returns what the App or Core answered.
  t.attempt = async (name, args) => {
    const full = {...args, expected_version: t.version, request_id: 'mcp-w' + (++t.seq)};
    return {name, args: full, request_id: full.request_id, result: await t.agent.call(APP + name, full)};
  };
  t.refused = async (name, args) => {
    const call = await t.attempt(name, args);
    t.refusals.push(call);
    return call.result;
  };
  t.write = async (name, args) => {
    const call = await t.attempt(name, args);
    committed(name, call.result);
    t.writes.push(call);
    return call;
  };
  t.event = async (kind, when, payload) => {
    const args = {expected_version: t.version, event: {event_id: 'ev-mcp-' + (++t.seq), at: when, operation: APP + kind, payload}};
    const result = await t.infra.call('env.apply_event', args);
    committed(kind, result);
    t.events.push({args, result, event_id: args.event.event_id});
    return t.events[t.events.length - 1];
  };
  t.advance = async when => {
    const args = {expected_version: t.version, virtual_now: when, request_id: 'clock-' + (++t.seq)};
    const result = await t.infra.call('env.advance_time', args);
    committed('env.advance_time', result);
    t.advances.push({args, result});
    return t.advances[t.advances.length - 1];
  };
  // Infra moves the clock with no App event. No App code runs, so the business data must stay byte-identical.
  t.tick = async when => {
    const before = await t.snapshot(), move = await t.advance(when), after = await t.snapshot();
    check('Time alone: in epoch ' + before.epoch + ', env.advance_time to ' + when + ' moves the clock, runs no App code and leaves the business data byte-identical',
      after.virtual_now === when && same(after.data, before.data), {before: before.virtual_now, after: after.virtual_now});
    return move;
  };
  return t;
}
const changeOf = async (t, id) => (await t.get('changes.list')).items.find(change => change.id === id);
const leaveOf = async (t, id) => (await t.get('leave.list')).items.find(request => request.id === id);
const balanceOf = async (t, type) => (await t.get('leave.balances')).items.find(row => row.leave_type_id === type);
const windowOf = async t => (await t.get('benefits.get', {id: 'win-2027'})).window;
const statementOf = async (t, id) => (await t.get('pay_statements.get', {id})).statement;
const inquiryOf = async (t, statement, id) => (await t.get('inquiries.list', {id: statement})).items.find(inquiry => inquiry.id === id);

// All 14 reads, with an object ID or a time window where the read takes one.
const readCalls = (statement, window) => [['employment.get', {}], ['calendar.list', {start: '2026-11-16', end: '2026-12-31'}],
  ['pay_statements.list', {start: '2026-10-01', end: '2026-12-31'}], ['pay_statements.get', {id: statement}], ['settings.get', {}],
  ['changes.list', {start: '2026-10-01', end: '2026-12-31'}], ['inquiries.list', {id: statement}], ['leave.balances', {}],
  ['leave.list', {id: 'vacation', start: '2026-12-01', end: '2026-12-31'}], ['leave.preview', {id: 'vacation', start: '2027-01-11', end: '2027-01-12', hours_per_day: 8}],
  ['benefits.windows', {}], ['benefits.get', {id: window}], ['notifications.list', {start: '2026-10-01', end: '2027-01-31'}], ['preferences.get', {}]];

async function loadTaskSeed(t) {
  t.peerBefore = await t.snapshot(t.peer);
  const fresh = await t.infra.call('env.snapshot');
  const moved = await t.infra.call('env.advance_time', {expected_version: fresh.version, virtual_now: '2027-01-05T09:00:00-05:00', request_id: 'before-load'});
  check('Before the load, the clock of the fresh instance stands at 5 January 2027', moved.status === 'committed' && moved.advanced === true, moved);
  t.seed = read('examples/task-data/seed.json');
  const policies = {...read('examples/task-data/policies.json'), scenario: {allow: read('tools.json').map(tool => tool.name), constraints: {}}};
  const loaded = await t.infra.call('env.load_seed', {expected_version: moved.version, request_id: 'task-seed', data: t.seed,
    binding: read('examples/task-data/binding.json'), policies, virtual_now: START});
  check('env.load_seed loads the task seed with its binding, its policies and its own virtual_now', loaded.status === 'ready' && loaded.loaded === records(t.seed).length, loaded);
  t.version = loaded.version;
  const state = await t.snapshot(), packageClock = JSON.parse(fs.readFileSync(path.join(t.copy, 'fixtures/clock.json'), 'utf8')).initial_time;
  equal('The snapshot holds the loaded seed', state.data, t.seed);
  equal('The clock is the virtual_now of the seed: not the time that the instance had before, and not the package clock',
    [state.virtual_now, state.initial_virtual_now, Date.parse(START) === Date.parse(packageClock)], [START, START, false]);
  for (const [name, args] of readCalls('ps-2026-23', 'win-2026')) {
    const result = await t.read(name, args);
    check(name + ' reads now as ' + START + ', with the -05:00 offset of the employer', result.status === 'ok' && result.now === START, result);
  }
}

async function discovery(t) {
  const listed = (await t.agent.request('tools/list')).result.tools;
  equal('The Agent connection lists exactly the 25 tools of the plan', listed.map(tool => tool.name).sort(), names([...READS, ...WRITES]));
  equal('14 of them are read tools', listed.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(READS));
  equal('11 of them are write tools', listed.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(WRITES));
  check('The Agent connection lists no env.* operation', listed.every(tool => !tool.name.startsWith('env.')));
  const before = await t.snapshot();
  for (const name of ADMIN) {
    const result = await t.agent.call(name, {});
    check('The Agent calling ' + name + ' gets permission_denied', result.status === 'permission_denied', result);
  }
  const after = await t.snapshot();
  equal('The denied calls changed no business data and no version', [after.data, after.epoch, after.revision], [t.seed, before.epoch, before.revision]);
  equal('Each denied call has one deny row in the audit, with the Agent as the actor', after.audit.slice(before.audit.length).map(row => [row.tool, row.actor, row.decision, row.reason]),
    ADMIN.map(name => [name, 'agent', 'deny', 'permission_denied']));
}

async function payRecords(t) {
  const calendar = (await t.get('calendar.list', {start: '2026-11-16', end: '2026-12-31'})).items;
  equal('W1: on 19 November calendar.list shows the cut-off of 20 November as passed, and Friday 4 December with its cut-off on Tuesday 1 December at 17:00',
    calendar.map(e => [e.id, e.pay_date, e.cutoff_at, e.state, e.cutoff_passed]), [['pd-2026-24', '2026-11-20', at('11-17 17:00'), 'planned', true],
      ['pd-2026-25', '2026-12-04', at('12-01 17:00'), 'planned', false], ['pd-2026-26', '2026-12-18', at('12-15 17:00'), 'planned', false]]);
  const statement = await statementOf(t, 'ps-2026-23');
  equal('W1: the statement of 6 November reads earnings 3,200.00, taxes 640.00, deductions 280.00 and net pay 2,280.00, with 300.00 to savings and 1,980.00 to checking',
    [statement.earnings_total, statement.taxes_total, statement.deductions_total, statement.net_pay, statement.deposits.map(d => [d.amount, d.account.last4])],
    [3200, 640, 280, 2280, [[300, '4410'], [1980, '7731']]]);
  const {settings, next_change_applies_to} = await t.get('settings.get');
  equal('W1: settings.get shows the withholding change of 16 November locked for 20 November, and a change made now would first apply to 4 December',
    [settings.withholding.locked.id, settings.withholding.locked.applies_to.entry_id, settings.withholding.waiting, next_change_applies_to],
    ['chg-0006', 'pd-2026-24', null, {entry_id: 'pd-2026-25', pay_date: '2026-12-04', cutoff_at: at('12-01 17:00')}]);
  const before = await t.snapshot();
  const unknown = await t.read('pay_statements.get', {id: 'ps-2099-01'}), reversed = await t.read('calendar.list', {start: '2026-12-31', end: '2026-12-01'});
  const after = await t.snapshot();
  equal('W1 control: an unknown statement returns not_found, and a window that ends before it starts returns invalid_window', [unknown.status, reversed.status], ['not_found', 'invalid_window']);
  check('W1 control: both refused reads leave the business data and the version as they were', same(after.data, before.data) && after.revision === before.revision);
  equal('W1 control: each refused read has one deny row in the audit', after.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason]),
    [[APP + 'pay_statements.get', 'deny', 'not_found'], [APP + 'calendar.list', 'deny', 'invalid_window']]);
}

async function earlyLeave(t) {
  const result = await t.refused('leave.request', {id: 'vacation', start: '2026-11-24', end: '2026-11-24', hours_per_day: 8});
  check('W3 control: vacation that starts in 5 days, with 14 days of notice, returns too_late', result.status === 'too_late' && result.applied === false, result);
  const preview = await t.get('leave.preview', {id: 'vacation', start: '2026-12-07', end: '2026-12-08', hours_per_day: 8}), before = await balanceOf(t, 'vacation');
  t.lapsing = await t.write('leave.request', {id: 'vacation', start: '2026-12-07', end: '2026-12-08', hours_per_day: 8, note: 'Two days off before the holidays.'});
  const after = await balanceOf(t, 'vacation');
  equal('W3: leave.preview for 7 and 8 December reads 2 working days and 16.0 hours, and leave.request makes it pending and holds the 16 hours',
    [preview.working_days, preview.hours, preview.allowed, t.lapsing.result.state, t.lapsing.result.hours, before.available - after.available], [2, 16, true, 'pending', 16, 16]);
}

async function failedCalls(t) {
  const before = await t.snapshot(), from = t.refusals.length;
  let result = await t.refused('deposit.update', {id: ACCOUNT, accounts: [SAVINGS]});
  check('A failed call: a deposit setup with no account for the remainder returns invalid_split', result.status === 'invalid_split' && result.applied === false, result);
  result = await t.refused('retirement.set', {id: ACCOUNT, percent: 60});
  check('A failed call: a retirement percentage of 60 with a maximum of 50 returns over_limit', result.status === 'over_limit' && result.applied === false, result);
  result = await t.refused('leave.request', {id: 'sick', start: '2026-11-19', end: '2026-11-19', hours_per_day: 9});
  check('A failed call: 9 hours for one day breaks the input schema, so Core returns invalid_arguments before any App error', result.status === 'invalid_arguments' && result.applied === false, result);
  const after = await t.snapshot();
  check('A failed call changes nothing: after two App errors and one Core error the business data is byte-identical', same(after.data, before.data));
  equal('A failed call changes nothing: the version and the notifications are the same', [after.epoch, after.revision, after.data.notifications],
    [before.epoch, before.revision, before.data.notifications]);
  equal('The audit has one deny row for each failed call', after.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason]),
    t.refusals.slice(from).map(call => [APP + call.name, 'deny', call.result.status]));
}

async function writeReplays(t) {
  const before = await t.snapshot();
  let result = await t.agent.call(APP + 'leave.request', t.lapsing.args);
  equal('Replay: the same request_id with the same input returns the stored receipt with duplicate true', result, {...t.lapsing.result, duplicate: true});
  let now = await t.snapshot();
  equal('Replay: it makes no second leave request, writes no audit row and keeps the version',
    [now.data.leave_requests.length, now.audit.length, now.revision], [before.data.leave_requests.length, before.audit.length, before.revision]);
  result = await t.agent.call(APP + 'leave.request', {...t.lapsing.args, note: 'Other words for the same request_id.'});
  check('Replay: the same request_id with changed input returns idempotency_conflict', result.status === 'idempotency_conflict' && result.applied === false, result);
  result = await t.agent.call(APP + 'leave.request', {id: 'sick', start: '2026-11-19', end: '2026-11-19', hours_per_day: 4, expected_version: t.lapsing.args.expected_version, request_id: 'mcp-stale'});
  check('Replay: a write with a stale expected_version returns stale_version and names the current version', result.status === 'stale_version' && same(result.current_version, t.version), result);
  now = await t.snapshot();
  check('Replay: the conflict and the stale write changed no business data', same(now.data, before.data) && now.revision === before.revision);
  equal('Replay: the conflict and the stale write each have one deny row in the audit', now.audit.slice(before.audit.length).map(row => [row.input.request_id, row.decision, row.reason]),
    [[t.lapsing.request_id, 'deny', 'idempotency_conflict'], ['mcp-stale', 'deny', 'stale_version']]);
}

async function firstRun(t) {
  t.posted = await t.event('payroll.run_posted', at('11-20 06:00'), payRun('pd-2026-24', 'ps-2026-24'));
  const statement = await statementOf(t, 'ps-2026-24');
  equal('W2: payroll.run_posted on 20 November writes ps-2026-24 with net pay 2,280.00 and applies the locked withholding change',
    [statement.net_pay, statement.settings_used.change_ids, statement.settings_used.withholding.extra_withholding, (await changeOf(t, 'chg-0006')).state], [2280, ['chg-0006'], 25, 'applied']);
  const before = await t.snapshot();
  equal('The run wrote one activity row for the event and one for each effect: the statement, the change applied, two leave accruals and the notification',
    before.data.activity.filter(a => a.event_id === t.posted.event_id).map(a => [a.action, a.effect]),
    [['payroll.run_posted', false], ['statement.written', true], ['change.applied', true], ['leave.earned', true], ['leave.earned', true], ['notification.written', true]]);
  equal('Replay: an identical event_id returns the stored receipt with duplicate true', await t.infra.call('env.apply_event', t.posted.args), {...t.posted.result, duplicate: true});
  const now = await t.snapshot();
  check('Replay: the repeated event writes no second statement, no notification and no audit row',
    same(now.data, before.data) && now.audit.length === before.audit.length && now.revision === before.revision);
  const changed = structuredClone(t.posted.args);
  changed.event.payload.taxes[0].amount = 400;
  const result = await t.infra.call('env.apply_event', changed);
  check('Replay: the same event_id with other content returns idempotency_conflict', result.status === 'idempotency_conflict' && result.applied === false, result);
}

async function enrollment(t) {
  await t.event('enrollment.opened', at('11-23 09:00'), WINDOW);
  const win = await windowOf(t);
  equal('W4: enrollment.opened adds the 2027 window. It reads upcoming, and the saved choices start as the medical and dental choices of 2026, with nothing for the spending account',
    [win.state, win.plans.map(p => [p.id, p.rolls_over, p.saved])], ['upcoming', [['medical', true, {option_id: 'med-ppo-ee'}], ['dental', true, {option_id: 'den-basic-ee'}], ['fsa', false, null]]]);
  const result = await t.refused('benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 2600});
  check('W4 control: a choice before the opening time returns window_closed', result.status === 'window_closed', result);
}

async function cutoff(t) {
  const opening = await t.tick(at('11-30 10:00')), before = await t.snapshot();
  equal('Replay: a replayed env.advance_time returns the stored receipt with duplicate true', await t.infra.call('env.advance_time', opening.args), {...opening.result, duplicate: true});
  const now = await t.snapshot();
  equal('Replay: the replayed env.advance_time adds no audit row and moves nothing', [now.audit.length, now.virtual_now, now.revision], [before.audit.length, at('11-30 10:00'), before.revision]);
  const win = await windowOf(t), flags = (await t.get('employment.get')).flags;
  equal('Time alone: on 30 November the window reads open, and the account reads enrollment_open', [win.state, flags.includes('enrollment_open')], ['open', true]);
  t.withholding = await t.write('withholding.update', {id: ACCOUNT, form: FORM});
  equal('W2 control: withholding.update on 30 November, before the cut-off, is waiting for the run of 4 December',
    [t.withholding.result.state, t.withholding.result.applies_to], ['waiting', {entry_id: 'pd-2026-25', pay_date: '2026-12-04', cutoff_at: at('12-01 17:00')}]);
  await t.tick(at('12-01 17:00'));
  equal('Time alone: when the clock reaches the cut-off of 1 December at 17:00, the change reads locked', (await changeOf(t, t.withholding.result.id)).state, 'locked');
  const result = await t.refused('changes.cancel', {id: t.withholding.result.id});
  check('W2 control: changes.cancel on the locked change returns too_late', result.status === 'too_late', result);
}

async function newAccount(t) {
  await t.tick(at('12-02 09:00'));
  t.deposit = await t.write('deposit.update', {id: ACCOUNT, accounts: [SAVINGS, NEW_CHECKING]});
  const {settings, next_change_applies_to} = await t.get('settings.get');
  equal('W2: deposit.update on Wednesday 2 December, after the cut-off, is waiting, and settings.get shows 18 December as the first pay date it applies to',
    [t.deposit.result.state, settings.deposit.waiting.id, settings.deposit.waiting.applies_to.pay_date, next_change_applies_to.pay_date], ['waiting', t.deposit.result.id, '2026-12-18', '2026-12-18']);
  t.sick = await t.write('leave.request', {id: 'sick', start: '2026-12-02', end: '2026-12-02', hours_per_day: 8});
  equal('W3 control: sick leave for today is accepted and reads pending', [t.sick.result.state, (await leaveOf(t, t.sick.result.id)).state], ['pending', 'pending']);
}

async function decisionAndElections(t) {
  await t.event('leave.decided', at('12-03 11:30'), {leave_request_id: 'lv-0044', decision: 'approve', decided_by: 'person-okoro', note: 'Enjoy the break.'});
  equal('W3: leave.decided with approve makes the pending vacation of 21 to 25 December approved', (await leaveOf(t, 'lv-0044')).state, 'approved');
  await t.tick(at('12-03 12:00'));
  let result = await t.refused('benefits.submit', {id: 'win-2027'});
  check('W4 control: benefits.submit before a choice is saved for the spending account returns incomplete', result.status === 'incomplete', result);
  await t.write('benefits.elect', {id: 'win-2027', plan_id: 'medical', option_id: 'med-hdhp-ee'});
  result = await t.refused('benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 3500});
  check('W4 control: a yearly amount of 3,500.00 with a maximum of 3,200.00 returns over_limit', result.status === 'over_limit', result);
  await t.write('benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 2600});
  t.set = await t.write('benefits.submit', {id: 'win-2027'});
  const win = await windowOf(t);
  equal('W4: on 3 December the medical option of 95.00 and 2,600.00 a year for the spending account are saved, and benefits.submit makes the set submitted',
    [t.set.result.state, win.set.state, win.set.choices], ['submitted', 'submitted', [{plan_id: 'medical', choice: {option_id: 'med-hdhp-ee'}},
      {plan_id: 'dental', choice: {option_id: 'den-basic-ee'}}, {plan_id: 'fsa', choice: {yearly_amount: 2600}}]]);
}

async function secondRun(t) {
  await t.event('payroll.run_posted', at('12-04 06:00'), payRun('pd-2026-25', 'ps-2026-25'));
  const statement = await statementOf(t, 'ps-2026-25');
  equal('W2: the run of 4 December still pays the old accounts and applies the withholding change of 30 November. The deposit change still waits',
    [statement.deposits.map(d => [d.amount, d.account.last4]), statement.settings_used.change_ids, (await changeOf(t, t.deposit.result.id)).state],
    [[[300, '4410'], [1980, '7731']], [t.withholding.result.id], 'waiting']);
  await t.tick(at('12-04 09:00'));
  t.inquiry = await t.write('inquiries.open', {id: 'ps-2026-25', amount: 412.5, note: 'My travel reimbursement of 412.50 is missing from this statement.'});
  const result = await t.refused('inquiries.open', {id: 'ps-2026-25', amount: 412.5, note: 'A second question on the whole statement.'});
  equal('W2: inquiries.open on the statement of 4 December for a missing reimbursement of 412.50 is open, and a second inquiry on the same line returns already_open',
    [(await inquiryOf(t, 'ps-2026-25', t.inquiry.result.id)).state, result.status], ['open', 'already_open']);
}

async function lapse(t) {
  const before = await balanceOf(t, 'vacation');
  await t.tick(at('12-07 09:00'));
  const after = await balanceOf(t, 'vacation');
  equal('Time alone: the vacation request still pending on its first day reads lapsed, and its 16 hours are available again',
    [(await leaveOf(t, t.lapsing.result.id)).state, after.available - before.available, after.pending_hours], ['lapsed', 16, 0]);
}

async function retirementAndAnswer(t) {
  await t.tick(at('12-10 09:00'));
  t.retirement = await t.write('retirement.set', {id: ACCOUNT, percent: 8});
  await t.event('inquiry.answered', at('12-10 14:00'), {inquiry_id: t.inquiry.result.id, outcome: 'corrected', correction_amount: 412.5, answered_by: 'Payroll',
    note: 'The reimbursement will be on your next pay statement.'});
  const inquiry = await inquiryOf(t, 'ps-2026-25', t.inquiry.result.id);
  equal('W2: retirement.set to 8 on 10 December waits for the run of 18 December, and inquiry.answered with corrected makes the inquiry answered',
    [t.retirement.result.state, t.retirement.result.applies_to.pay_date, inquiry.state, inquiry.answer.outcome, inquiry.answer.correction_amount], ['waiting', '2026-12-18', 'answered', 'corrected', 412.5]);
}

async function windowCloses(t) {
  await t.tick(CLOSED);
  const win = await windowOf(t);
  equal('Time alone: after the closing time the window reads closed and the submitted set reads final', [win.state, win.set.id, win.set.state], ['closed', t.set.result.id, 'final']);
  const result = await t.refused('benefits.elect', {id: 'win-2027', plan_id: 'dental', option_id: 'den-plus-ee'});
  check('W4 control: a choice on 12 December, after the closing time, returns window_closed', result.status === 'window_closed', result);
  await t.tick(at('12-15 17:00'));
  equal('Time alone: at the cut-off of 15 December at 17:00 the deposit change and the retirement change read locked',
    [(await changeOf(t, t.deposit.result.id)).state, (await changeOf(t, t.retirement.result.id)).state], ['locked', 'locked']);
}

async function thirdRun(t) {
  await t.event('calendar.changed', at('12-16 09:00'), {entry_id: 'pd-2027-01', period_start: '2026-12-14', period_end: '2026-12-27', pay_date: '2027-01-01',
    cutoff_at: at('12-29 17:00'), reason: 'The first pay date of 2027.'});
  await t.event('payroll.run_posted', at('12-18 06:00'), payRun('pd-2026-26', 'ps-2026-26',
    [{line_id: 'e2', kind: 'reimbursement', text: 'Travel reimbursement', amount: 412.5, inquiry_id: t.inquiry.result.id}]));
  const statement = await statementOf(t, 'ps-2026-26');
  equal('W2: the run of 18 December pays the new account, takes deductions of 376.00 with retirement at 8 percent and carries the reimbursement of 412.50 that names the inquiry. Net pay is 2,596.50',
    [statement.deductions_total, statement.earnings.find(line => line.line_id === 'e2').inquiry_id, statement.net_pay, statement.deposits.map(d => [d.amount, d.account.last4])],
    [376, t.inquiry.result.id, 2596.5, [[300, '4410'], [2296.5, '2208']]]);
  equal('W2: the run applied the deposit change and the retirement change', [statement.settings_used.change_ids, (await changeOf(t, t.deposit.result.id)).state,
    (await changeOf(t, t.retirement.result.id)).state], [[t.deposit.result.id, t.retirement.result.id], 'applied', 'applied']);
}

async function leaveTaken(t) {
  const before = await balanceOf(t, 'vacation');
  await t.tick(at('12-26 09:00'));
  const after = await balanceOf(t, 'vacation');
  equal('Time alone: after 25 December the approved vacation reads taken, and its 32 hours leave the balance, while the available hours stay the same',
    [(await leaveOf(t, 'lv-0044')).state, before.balance - after.balance, after.available - before.available], ['taken', 32, 0]);
}

async function newYear(t) {
  await t.event('payroll.run_posted', NEW_YEAR, payRun('pd-2027-01', 'ps-2027-01'));
  const statement = await statementOf(t, 'ps-2027-01');
  equal('W4: from the first pay date of 2027 the final set is in force: medical 95.00 and the spending account 100.00 for each pay, which is 2,600.00 over 26 pay periods',
    statement.deductions.map(d => [d.plan_id, d.amount]), [['medical', 95], ['fsa', 100], [null, 256]]);
}

// Core refuses an event dated before the clock. The App refuses an event of the plan's list, here a decision on a request that lapsed.
async function refusedEvents(t) {
  const forfeit = {entry_id: 'le-9001', leave_type_id: 'personal', hours: -16, reason: 'forfeited', note: 'Hours above the carryover cap.'};
  const cases = [['an event dated before the clock', 'leave.adjusted', '2027-01-01T00:05:00-05:00', forfeit],
    ['a decision on a request that lapsed', 'leave.decided', '2027-01-01T08:00:00-05:00', {leave_request_id: t.lapsing.result.id, decision: 'approve', decided_by: 'person-okoro'}]];
  for (const [label, kind, when, payload] of cases) {
    const before = await t.snapshot(), event_id = 'ev-mcp-' + (++t.seq);
    const result = await t.infra.call('env.apply_event', {expected_version: t.version, event: {event_id, at: when, operation: APP + kind, payload}});
    const now = await t.snapshot();
    check('Refused event: ' + label + ' returns invalid_event', result.status === 'invalid_event' && result.applied === false, result);
    check('Refused event: after ' + label + ' the business data and the notifications are byte-identical', same(now.data, before.data));
    equal('Refused event: after ' + label + ' the version and the clock are the same', [now.epoch, now.revision, now.virtual_now], [before.epoch, before.revision, NEW_YEAR]);
    equal('Refused event: after ' + label + ' the audit has one deny row', now.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason, row.input.event_id, row.state_changed]),
      [['env.apply_event', 'deny', 'invalid_event', event_id, false]]);
  }
  await t.event('leave.adjusted', '2027-01-01T08:00:00-05:00', forfeit);
  equal('The same forfeit is applied when its time is not before the clock', (await balanceOf(t, 'personal')).balance, 0);
}

async function evaluatorRecords(t) {
  const before = await t.snapshot(), reads = readCalls('ps-2026-25', 'win-2027');
  for (const [name, args] of reads) await t.get(name, args);
  const now = await t.snapshot(), rows = now.audit.slice(before.audit.length), row = name => rows.find(r => r.tool === APP + name);
  check('The business data in env.snapshot is byte-identical before and after all 14 reads, leave.preview included', same(now.data, before.data) && now.revision === before.revision);
  equal('Each of the 14 reads has one allow row in the audit, with no state change', rows.map(r => [r.tool, r.actor, r.decision, r.state_changed]),
    reads.map(([name]) => [APP + name, 'agent', 'allow', false]));
  equal('The audit row of a read carries input.id', [row('pay_statements.get').input, row('inquiries.list').input, row('benefits.get').input],
    [{id: 'ps-2026-25'}, {id: 'ps-2026-25'}, {id: 'win-2027'}]);
  equal('The audit row of a windowed read carries input.start and input.end, and leave.preview carries the leave type as input.id',
    [row('calendar.list').input, row('notifications.list').input, row('leave.preview').input],
    [{start: '2026-11-16', end: '2026-12-31'}, {start: '2026-10-01', end: '2027-01-31'}, {id: 'vacation', start: '2027-01-11', end: '2027-01-12'}]);
  const rowOf = call => now.audit.find(r => r.input.request_id === call.request_id);
  const shown = call => [rowOf(call).tool, rowOf(call).decision, rowOf(call).input, rowOf(call).result];
  equal('The audit row of a write carries input.id, the request_id, the observed version and the ID of the object it wrote: the leave request carries its first and last day too',
    [shown(t.lapsing), shown(t.inquiry), shown(t.deposit)], [
      [APP + 'leave.request', 'allow', {id: 'vacation', request_id: t.lapsing.request_id, expected_version: t.lapsing.args.expected_version, start: '2026-12-07', end: '2026-12-08'},
        {status: 'committed', object_id: t.lapsing.result.id}],
      [APP + 'inquiries.open', 'allow', {id: 'ps-2026-25', request_id: t.inquiry.request_id, expected_version: t.inquiry.args.expected_version}, {status: 'committed', object_id: t.inquiry.result.id}],
      [APP + 'deposit.update', 'allow', {id: ACCOUNT, request_id: t.deposit.request_id, expected_version: t.deposit.args.expected_version}, {status: 'committed', object_id: t.deposit.result.id}]]);
  equal('The audit row of each applied event carries its event_id', now.audit.filter(r => r.tool === 'env.apply_event' && r.decision === 'allow').map(r => r.input.event_id),
    t.events.map(e => e.event_id));

  // The rows and notifications that the seed already held are history. Only what this run added is counted.
  const added = now.data.activity.slice(t.seed.activity.length), main = added.filter(a => !a.effect);
  check('Every committed write has one activity row with its request_id (' + t.writes.length + ' writes)',
    t.writes.every(w => main.filter(a => a.request_id === w.request_id && a.actor === 'agent' && a.action === w.name).length === 1));
  check('Every applied event has one activity row with its event_id (' + t.events.length + ' events)',
    t.events.every(e => main.filter(a => a.event_id === e.event_id && a.actor === 'event').length === 1));
  equal('There is no other activity row, apart from the rows of effects', main.length, t.writes.length + t.events.length);
  equal('Each applied event wrote one notification, and no write or clock move wrote one', now.data.notifications.slice(t.seed.notifications.length).map(n => n.event_id),
    t.events.map(e => e.event_id));
  check('Each applied event has one effect row for its notification', t.events.every(e => added.filter(a => a.event_id === e.event_id && a.action === 'notification.written' && a.effect).length === 1));
  check('A refused call has a deny row in the audit and no activity row (' + t.refusals.length + ' refusals)', t.refusals.every(call =>
    now.audit.filter(r => r.input.request_id === call.request_id && r.decision === 'deny' && r.reason === call.result.status).length === 1 &&
    !now.data.activity.some(a => a.request_id === call.request_id)));
  equal('The audit has one row for each env.advance_time that is not a replay',
    now.audit.filter(r => r.tool === 'env.advance_time' && r.decision === 'allow').map(r => r.clock.to), t.advances.map(move => move.args.virtual_now));
}

async function reset(t) {
  const result = await t.infra.call('env.reset', {expected_version: t.version}), before = t.version;
  check('env.reset returns ready for this App instance only', result.status === 'ready' && result.reset_scope === 'payleaf', result);
  const now = await t.snapshot();
  t.version = result.version;
  equal('Reset restores the loaded seed', now.data, t.seed);
  equal('Reset restores the time loaded with the seed', [now.virtual_now, (await t.get('preferences.get')).now], [START, START]);
  equal('Reset clears the audit and the receipts: only the row of the reset itself is left', [now.audit.map(r => r.tool), Object.keys(now.receipts)], [['env.reset'], []]);
  equal('Reset advances the epoch', [now.epoch, now.revision], [before.epoch + 1, 0]);
}

// After the reset nothing is submitted in the 2027 window, so the clock alone makes the set defaulted.
async function defaulted(t) {
  await t.event('enrollment.opened', at('11-23 09:00'), WINDOW);
  await t.tick(at('12-03 12:00'));
  let win = await windowOf(t);
  equal('W4: in the new lifecycle the window reads open and no set is submitted', [win.state, win.set, (await t.get('employment.get')).flags.includes('enrollment_open')], ['open', null, true]);
  await t.tick(CLOSED);
  win = await windowOf(t);
  equal('Time alone: after the closing time with nothing submitted the set reads defaulted. Medical and dental keep the 2026 choice, and the spending account has no coverage',
    [win.state, win.set.id, win.set.state, win.set.choices], ['closed', null, 'defaulted', [{plan_id: 'medical', choice: {option_id: 'med-ppo-ee'}},
      {plan_id: 'dental', choice: {option_id: 'den-basic-ee'}}, {plan_id: 'fsa', choice: {no_coverage: true}}]]);
}

async function secondSeed(t) {
  const loaded = await t.infra.call('env.load_seed', {expected_version: t.version, request_id: 'second-seed', data: t.seed, virtual_now: '2026-11-20T16:30:00Z'});
  check('A second seed with another virtual_now is loaded in the same run', loaded.status === 'ready', loaded);
  t.version = loaded.version;
  equal('A start time spelled in UTC is read with the -05:00 offset of the employer', (await t.get('preferences.get')).now, at('11-20 11:30'));
  await t.tick(at('11-21 09:00'));
  const result = await t.infra.call('env.reset', {expected_version: t.version}), now = await t.snapshot();
  equal('Reset goes back to the virtual_now of the seed loaded last, not to the first seed or the package clock',
    [result.status, now.virtual_now, (await t.get('preferences.get')).now, same(now.data, t.seed)], ['ready', '2026-11-20T16:30:00Z', at('11-20 11:30'), true]);
}

async function otherRun(t) {
  const now = await t.snapshot(t.peer), clock = JSON.parse(fs.readFileSync(path.join(t.copy, 'fixtures/clock.json'), 'utf8')).initial_time;
  const fixture = JSON.parse(fs.readFileSync(path.join(t.copy, read('app.json').fixtures.seed), 'utf8'));
  check('The second run other-run is not affected: its whole state is byte-identical', same(now, t.peerBefore));
  equal('The second run still holds the package fixture at the package clock, at its first version, with an empty audit',
    [same(now.data, fixture), now.virtual_now, now.epoch, now.revision, now.audit], [true, clock, 1, 0, []]);
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  const skip = reason => { console.log('SKIP: ' + reason); process.exitCode = SKIPPED; };
  if (!root) return skip('the real MCP checks need the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
  const runtime = path.resolve(root);
  if (!fs.existsSync(path.join(runtime, 'prepare.cjs')) || !fs.existsSync(path.join(runtime, 'client.cjs'))) return skip('no public runtime at ' + runtime + '.');
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const report = {schema: 'payleaf.mcp-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version,
    app_version: read('app.json').version, node: process.version, checks, passed: false};
  try {
    const t = await connect(runtime, prepared, clients);
    // The parts run in the order of the virtual time: 19 November 2026 to 1 January 2027, then the reset and a second seed.
    const parts = [loadTaskSeed, discovery, payRecords, earlyLeave, failedCalls, writeReplays, firstRun, enrollment, cutoff, newAccount, decisionAndElections, secondRun, lapse,
      retirementAndAnswer, windowCloses, thirdRun, leaveTaken, newYear, refusedEvents, evaluatorRecords, reset, defaulted, secondSeed, otherRun];
    for (const part of parts) await part(t);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Payleaf real MCP checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Payleaf real MCP checks passed.');
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
