#!/usr/bin/env node
'use strict';
// Real MCP checks for what the public verifier does not exercise. One Infra and one Agent process talk to the App over stdio.
// Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {records} = require('../src/model.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'brindle.', RUN = 'brindle-mcp', ACCOUNT = 'brindle-riley';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const READS = ['account.get', 'account.close_preview', 'transactions.list', 'transactions.get', 'statements.list', 'statements.get', 'payments.list', 'disputes.list',
  'disputes.get', 'offers.list', 'offers.get', 'rewards.get', 'notifications.list', 'preferences.get'];
const WRITES = ['payments.schedule', 'payments.cancel', 'autopay.set', 'disputes.open', 'disputes.withdraw', 'offers.accept', 'offers.decline', 'rewards.redeem',
  'rewards.transfer', 'account.close', 'preferences.update'];
const ADMIN = ['env.apply_event', 'env.reset', 'env.advance_time', 'env.load_seed', 'env.snapshot', 'env.event_status', 'env.validate_bundle'];
// An instant of late 2026 in the issuer's time zone: at('12-01 02:00').
const at = text => '2026-' + text.slice(0, 5) + 'T' + text.slice(6) + ':00-05:00';
const START = at('11-09 06:00');
const SOURCE = 'Checking ending 4410';
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const PLAN = read('tests/proposal-events.json'), WIRE = read('tests/proposal-wire-message.json')[0];
const planEvent = id => structuredClone(PLAN.find(e => e.event_id === id));
const names = list => list.map(name => APP + name).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const EFFECTS = ['autopay.scheduled', 'temporary_credit.posted', 'reversal.posted', 'notification.written'];

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
    const client = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'brindle-mcp-integration', {registry: prepared.registry});
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
  // An event of the plan keeps its own event_id. Other events get ev-mcp-<n>.
  t.apply = async event => {
    const args = {expected_version: t.version, event};
    const result = await t.infra.call('env.apply_event', args);
    committed(event.operation, result);
    t.events.push({args, result, event_id: event.event_id});
    return t.events[t.events.length - 1];
  };
  t.plan = id => t.apply(planEvent(id));
  t.event = (kind, when, payload) => t.apply({event_id: 'ev-mcp-' + (++t.seq), at: when, operation: APP + kind, payload});
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
const account = t => t.get('account.get');
const paymentOf = async (t, id) => (await t.get('payments.list')).items.find(p => p.id === id);

// All 14 reads, with an object ID or a time window where the read takes one.
const readCalls = () => [['account.get', {}], ['account.close_preview', {}], ['transactions.list', {start: '2026-11-01', end: '2026-11-30'}],
  ['transactions.get', {id: 'txn-0412'}], ['statements.list', {start: '2026-08-01', end: '2026-12-31'}], ['statements.get', {id: 'stm-2026-10'}],
  ['payments.list', {start: '2026-09-01', end: '2026-12-31'}], ['disputes.list', {id: 'txn-0412'}], ['disputes.get', {id: 'dsp-0007'}], ['offers.list', {}],
  ['offers.get', {id: 'off-0020'}], ['rewards.get', {}], ['notifications.list', {start: '2026-10-01', end: '2026-12-31'}], ['preferences.get', {}]];

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
  for (const [name, args] of readCalls()) {
    const result = await t.read(name, args);
    check(name + ' reads now as ' + START + ', with the -05:00 offset of the issuer', result.status === 'ok' && result.now === START, result);
  }
  const a = await account(t);
  equal('W1: at the loaded time account.get reads the balance 1,300.00, the pending 150.00, 12,000 points and autopay off',
    [a.balance, a.pending_total, a.points_balance, a.account.autopay.mode, a.latest_statement.id], [1300, 150, 12000, 'off', 'stm-2026-10']);
}

async function discovery(t) {
  const listed = (await t.agent.request('tools/list')).result.tools;
  equal('The Agent connection lists exactly the 25 operations of the plan', listed.map(tool => tool.name).sort(), names([...READS, ...WRITES]));
  equal('14 of them are read tools', listed.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(READS));
  equal('11 of them are write tools', listed.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(WRITES));
  check('The Agent connection lists no env.* operation', listed.every(tool => !tool.name.startsWith('env.')));
  const before = await t.snapshot(), tried = [...ADMIN, 'env.apply_event'];
  for (const name of tried) {
    const result = await t.agent.call(name, {});
    check('The Agent calling ' + name + ' gets permission_denied', result.status === 'permission_denied', result);
  }
  const after = await t.snapshot();
  equal('The denied calls changed no business data and no version', [after.data, after.epoch, after.revision], [t.seed, before.epoch, before.revision]);
  equal('Each denied call has one deny row in the audit, with the Agent as the actor. The repeated env.apply_event counts as a second row',
    after.audit.slice(before.audit.length).map(row => [row.tool, row.actor, row.decision, row.reason]), tried.map(name => [name, 'agent', 'deny', 'permission_denied']));
}

async function failedCalls(t) {
  const before = await t.snapshot(), from = t.refusals.length;
  const cases = [
    ['a fixed payment of 2,000.00 against the balance of 1,300.00 returns over_balance', 'payments.schedule',
      {id: ACCOUNT, amount_type: 'fixed', amount: 2000, pay_on: '2026-11-20', source: SOURCE}, 'over_balance'],
    ['a dispute of 70.00 on the gym charge of 60.00 returns over_net', 'disputes.open', {id: 'txn-0412', amount: 70, reason: 'credit_not_processed', note: 'Too much.'}, 'over_net'],
    ['a dispute on the pending hold txn-0440 returns not_disputable', 'disputes.open', {id: 'txn-0440', amount: 20, reason: 'wrong_amount', note: 'Hold.'}, 'not_disputable'],
    ['an amount with three decimals returns the App\'s own invalid_arguments', 'payments.schedule',
      {id: ACCOUNT, amount_type: 'fixed', amount: 10.005, pay_on: '2026-11-20', source: SOURCE}, 'invalid_arguments'],
    ['a fixed payment with no amount breaks the input schema, so Core returns invalid_arguments', 'payments.schedule',
      {id: ACCOUNT, amount_type: 'fixed', pay_on: '2026-11-20', source: SOURCE}, 'invalid_arguments']];
  for (const [label, name, args, status] of cases) {
    const result = await t.refused(name, args);
    check('A failed call: ' + label, result.status === status && result.applied === false, result);
  }
  const after = await t.snapshot();
  check('A failed call changes nothing: after three App errors and two argument errors the business data is byte-identical', same(after.data, before.data));
  equal('A failed call changes nothing: the version and the notifications are the same', [after.epoch, after.revision, after.data.notifications],
    [before.epoch, before.revision, before.data.notifications]);
  equal('The audit has one deny row for each failed call', after.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason]),
    t.refusals.slice(from).map(call => [APP + call.name, 'deny', call.result.status]));
}

async function refund(t) {
  t.refund = await t.plan('ev-br-301');
  const tx = (await t.get('transactions.get', {id: 'txn-0412'})), state = await t.snapshot(), notice = state.data.notifications[state.data.notifications.length - 1];
  equal('W3: ev-br-301 posts the partial refund of 20.00, so the gym charge reads refunded_final 20.00 and net_charge 40.00, and ntf-0057 is written',
    [tx.recovery, notice.id, notice.title], [{amount: 60, refunded_final: 20, temporary_credit: 0, net_charge: 40}, 'ntf-0057', 'A refund of 20.00 from Ironworks Gym has posted']);
  const before = await t.snapshot();
  equal('Replay: an identical event_id returns the stored receipt with duplicate true', await t.infra.call('env.apply_event', t.refund.args), {...t.refund.result, duplicate: true});
  const now = await t.snapshot();
  check('Replay: the repeated event writes no second refund, no notification and no audit row',
    same(now.data, before.data) && now.audit.length === before.audit.length && now.revision === before.revision);
  const changed = structuredClone(t.refund.args);
  changed.event.payload.amount = 25;
  const result = await t.infra.call('env.apply_event', changed);
  check('Replay: the same event_id with other content returns idempotency_conflict', result.status === 'idempotency_conflict' && result.applied === false, result);
}

// Core refuses an event dated before the clock. The App refuses the events of the plan's list.
async function refusedEvents(t) {
  const cases = [['an event dated before the clock', 'transaction.posted', at('11-09 06:00'), {transaction_id: 'txn-0470', kind: 'purchase', state: 'posted', amount: 12, merchant: 'Corner Cafe'}],
    ['a drop of a posted transaction', 'transaction.dropped', at('11-09 07:00'), {transaction_id: 'txn-0412', reason: 'Released.'}],
    ['a temporary credit sent with transaction.posted', 'transaction.posted', at('11-09 07:00'),
      {transaction_id: 'txn-0471', kind: 'provisional_credit', state: 'posted', amount: 10, relates_to: 'txn-0412'}],
    ['a return of a payment that is not posted', 'payment.returned', at('11-09 07:00'), {payment_id: 'pay-0099', reason: 'Unknown.'}]];
  for (const [label, kind, when, payload] of cases) {
    const before = await t.snapshot(), event_id = 'ev-mcp-' + (++t.seq);
    const result = await t.infra.call('env.apply_event', {expected_version: t.version, event: {event_id, at: when, operation: APP + kind, payload}});
    const now = await t.snapshot();
    check('Refused event: ' + label + ' returns invalid_event', result.status === 'invalid_event' && result.applied === false, result);
    check('Refused event: after ' + label + ' the business data and the notifications are byte-identical', same(now.data, before.data));
    equal('Refused event: after ' + label + ' the version and the clock are the same', [now.epoch, now.revision, now.virtual_now], [before.epoch, before.revision, before.virtual_now]);
    equal('Refused event: after ' + label + ' the audit has one deny row', now.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason, row.input.event_id, row.state_changed]),
      [['env.apply_event', 'deny', 'invalid_event', event_id, false]]);
  }
}

// txn-0381 posted on 13 September. With a window of 60 days, its last day to dispute is 12 November.
async function windowCloses(t) {
  await t.plan('ev-br-302');
  const a = await account(t), tx = (await t.get('transactions.get', {id: 'txn-0440'})).transaction;
  equal('W1: ev-br-302 drops the pending hold, so pending_total reads 0.00', [tx.state, a.pending_total], ['dropped', 0]);
  await t.tick(at('11-13 00:00'));
  const result = await t.refused('disputes.open', {id: 'txn-0381', amount: 30, reason: 'not_as_described', note: 'The item was broken.'});
  check('Time alone: at the start of 13 November the dispute window of txn-0381 has closed, so disputes.open returns too_late (the same call commits at the loaded time, see the reset)',
    result.status === 'too_late' && result.applied === false, result);
}

async function dispute(t) {
  await t.tick(at('11-13 20:00'));
  t.dispute = await t.write('disputes.open', {id: 'txn-0412', amount: 40, reason: 'credit_not_processed', note: 'The gym promised to refund the whole month.'});
  equal('W3: disputes.open of 40.00 on 13 November makes dsp-0009, which reads open', [t.dispute.result.id, (await t.get('disputes.get', {id: 'dsp-0009'})).dispute.state],
    ['dsp-0009', 'open']);
  const before = await t.snapshot();
  let result = await t.agent.call(APP + 'disputes.open', t.dispute.args);
  equal('Replay: the same request_id with the same input returns the stored receipt with duplicate true', result, {...t.dispute.result, duplicate: true});
  let now = await t.snapshot();
  equal('Replay: it opens no second dispute, writes no audit row and keeps the version',
    [now.data.disputes.length, now.audit.length, now.revision], [before.data.disputes.length, before.audit.length, before.revision]);
  result = await t.agent.call(APP + 'disputes.open', {...t.dispute.args, note: 'Other words for the same request_id.'});
  check('Replay: the same request_id with changed input returns idempotency_conflict', result.status === 'idempotency_conflict' && result.applied === false, result);
  result = await t.agent.call(APP + 'preferences.update', {email_notices: true, expected_version: t.dispute.args.expected_version, request_id: 'mcp-stale'});
  check('Replay: a write with a stale expected_version returns stale_version and names the current version', result.status === 'stale_version' && same(result.current_version, t.version), result);
  now = await t.snapshot();
  check('Replay: the conflict and the stale write changed no business data', same(now.data, before.data) && now.revision === before.revision);
  equal('Replay: the conflict and the stale write each have one deny row in the audit', now.audit.slice(before.audit.length).map(row => [row.input.request_id, row.decision, row.reason]),
    [[t.dispute.request_id, 'deny', 'idempotency_conflict'], ['mcp-stale', 'deny', 'stale_version']]);
}

async function temporaryCredit(t) {
  t.credit = await t.plan('ev-br-330');
  const state = await t.snapshot(), notice = state.data.notifications.find(n => n.id === 'ntf-0058');
  equal('ev-br-330 writes ntf-0058, and its stored wire message equals the example message of the approved plan, field for field', notice && notice.email, WIRE);
  equal('The event wrote one activity row for itself and effect rows for the temporary credit and the notification',
    state.data.activity.filter(a => a.event_id === 'ev-br-330').map(a => [a.action, a.object_id, a.effect]),
    [['dispute.updated', 'dsp-0009', false], ['temporary_credit.posted', 'txn-0450', true], ['notification.written', 'ntf-0058', true]]);
  const tx = await t.get('transactions.get', {id: 'txn-0412'});
  equal('W3: the gym charge reads refunded_final 20.00, temporary_credit 40.00 and net_charge 40.00', tx.recovery, {amount: 60, refunded_final: 20, temporary_credit: 40, net_charge: 40});
}

async function statement(t) {
  await t.plan('ev-br-310');
  await t.event('transaction.posted', at('12-02 03:00'), {transaction_id: 'txn-0460', kind: 'purchase', state: 'posted', amount: 210, merchant: 'Fernhill Hardware'});
  await t.event('transaction.posted', at('12-02 03:30'), {transaction_id: 'txn-0461', kind: 'purchase', state: 'pending', amount: 300, merchant: 'Quayside Hotel'});
  const a = await account(t);
  equal('W1: after the November statement, a purchase of 210.00 and a hotel hold of 300.00, account.get reads balance 1,450.00, pending 300.00, available 6,250.00 and 0.00 paid toward 1,240.00',
    [a.balance, a.pending_total, a.available_credit, a.latest_statement], [1450, 300, 6250, {id: 'stm-2026-11', closing_at: '2026-11-30T23:59:59-05:00',
      due_at: '2026-12-26T17:00:00-05:00', statement_balance: 1240, minimum_due: 35, paid_toward: 0, minimum_left: 35, balance_left: 1240, due_passed: false}]);
  await t.plan('ev-br-350');
  await t.plan('ev-br-340');
  equal('ev-br-350 adds 1,240 points and ev-br-340 adds the spending offer off-0021, which reads available',
    [(await t.get('rewards.get')).balance, (await t.get('offers.get', {id: 'off-0021'})).offer.state], [13240, 'available']);
}

async function payment(t) {
  await t.tick(at('12-10 19:00'));
  t.payment = await t.write('payments.schedule', {id: ACCOUNT, amount_type: 'statement_balance', pay_on: '2026-12-20', source: SOURCE});
  equal('W2: payments.schedule on 10 December for the statement balance on 20 December makes pay-0061, scheduled for 1,240.00',
    [t.payment.result.id, t.payment.result.state, t.payment.result.scheduled_amount], ['pay-0061', 'scheduled', 1240]);
  const before = await t.snapshot();
  const result = await t.agent.call(APP + 'payments.schedule', t.payment.args), now = await t.snapshot();
  equal('Replay: the repeated payments.schedule returns the stored receipt with duplicate true', result, {...t.payment.result, duplicate: true});
  equal('Replay: it schedules no second payment and keeps the version and the audit',
    [now.data.payments.length, now.data.payments.filter(p => p.id === 'pay-0061').length, now.revision, now.audit.length],
    [before.data.payments.length, 1, before.revision, before.audit.length]);
}

async function offerExpires(t) {
  await t.tick(at('12-11 00:00'));
  equal('Time alone: after accept_by of 10 December at 23:59:59, off-0021 reads expired', (await t.get('offers.get', {id: 'off-0021'})).offer.state, 'expired');
  const result = await t.refused('offers.accept', {id: 'off-0021'});
  check('W4 control: offers.accept on the expired offer returns too_late', result.status === 'too_late', result);
}

async function paymentPosts(t) {
  equal('Before its day the payment reads scheduled, with no posted amount', [(await paymentOf(t, 'pay-0061')).state, (await paymentOf(t, 'pay-0061')).posted_amount], ['scheduled', null]);
  await t.tick(at('12-20 08:00'));
  const p = await paymentOf(t, 'pay-0061'), a = await account(t);
  equal('Time alone: on 20 December pay-0061 reads posted with 1,240.00, the balance reads 210.00 and the statement is paid in full',
    [p.state, p.posted_amount, a.balance, a.latest_statement.paid_toward, a.latest_statement.balance_left], ['posted', 1240, 210, 1240, 0]);
  await t.plan('ev-br-320');
  const back = await account(t);
  equal('W2: ev-br-320 returns the payment, so it reads returned, the balance is 1,450.00 again and the account reads payment_returned',
    [(await paymentOf(t, 'pay-0061')).state, back.balance, back.latest_statement.paid_toward, back.flags], ['returned', 1450, 0, ['payment_returned']]);
}

async function evaluatorRecords(t) {
  const before = await t.snapshot(), reads = readCalls();
  for (const [name, args] of reads) await t.get(name, args);
  const now = await t.snapshot(), rows = now.audit.slice(before.audit.length), row = name => rows.find(r => r.tool === APP + name);
  check('The business data in env.snapshot is byte-identical before and after all 14 reads', same(now.data, before.data) && now.revision === before.revision);
  equal('Each of the 14 reads has one allow row in the audit, with no state change', rows.map(r => [r.tool, r.actor, r.decision, r.state_changed]),
    reads.map(([name]) => [APP + name, 'agent', 'allow', false]));
  equal('The audit row of a read carries input.id', [row('transactions.get').input, row('statements.get').input, row('disputes.list').input, row('offers.get').input],
    [{id: 'txn-0412'}, {id: 'stm-2026-10'}, {id: 'txn-0412'}, {id: 'off-0020'}]);
  equal('The audit row of a windowed read carries input.start and input.end', [row('transactions.list').input, row('payments.list').input, row('notifications.list').input],
    [{start: '2026-11-01', end: '2026-11-30'}, {start: '2026-09-01', end: '2026-12-31'}, {start: '2026-10-01', end: '2026-12-31'}]);
  const rowOf = call => now.audit.find(r => r.input.request_id === call.request_id);
  const shown = call => [rowOf(call).tool, rowOf(call).decision, rowOf(call).input, rowOf(call).result];
  equal('The audit row of a write carries input.id, the request_id, the observed version and the ID of the object it wrote', [shown(t.dispute), shown(t.payment)], [
    [APP + 'disputes.open', 'allow', {id: 'txn-0412', request_id: t.dispute.request_id, expected_version: t.dispute.args.expected_version}, {status: 'committed', object_id: 'dsp-0009'}],
    [APP + 'payments.schedule', 'allow', {id: ACCOUNT, request_id: t.payment.request_id, expected_version: t.payment.args.expected_version}, {status: 'committed', object_id: 'pay-0061'}]]);
  equal('The audit row of each applied event carries its event_id', now.audit.filter(r => r.tool === 'env.apply_event' && r.decision === 'allow').map(r => r.input.event_id),
    t.events.map(e => e.event_id));
  equal('The join scope: the snapshot gives run_id, app_id, epoch and revision next to the activity rows',
    [now.run_id, now.app_id, Number.isInteger(now.epoch), Number.isInteger(now.revision), {epoch: now.epoch, revision: now.revision}, Array.isArray(now.data.activity)],
    [RUN, 'brindle', true, true, t.version, true]);

  // The rows and notifications that the seed already held are history. Only what this run added is counted.
  const added = now.data.activity.slice(t.seed.activity.length), main = added.filter(a => !a.effect);
  check('Every added activity row has seq, virtual time, actor, action, object ID and the request_id or event_id behind it', added.every(a => Number.isInteger(a.seq) &&
    typeof a.at === 'string' && typeof a.object_id === 'string' && (a.actor === 'agent' ? a.request_id && !a.event_id : a.actor === 'event' && a.event_id && !a.request_id)));
  check('Event effect rows are marked effect true, and the rows of writes and events are marked effect false',
    added.every(a => a.effect === EFFECTS.includes(a.action)) && added.some(a => a.effect));
  check('Every committed write has one activity row with its request_id (' + t.writes.length + ' writes)',
    t.writes.every(w => main.filter(a => a.request_id === w.request_id && a.actor === 'agent' && a.action === w.name).length === 1));
  check('Every applied event has one activity row with its event_id (' + t.events.length + ' events)',
    t.events.every(e => main.filter(a => a.event_id === e.event_id && a.actor === 'event').length === 1));
  equal('There is no other activity row, apart from the rows of effects', main.length, t.writes.length + t.events.length);
  // The drop and the two purchase postings write no notification.
  const quiet = ['ev-br-302', ...t.events.filter(e => e.args.event.payload.kind === 'purchase').map(e => e.event_id)];
  equal('Each applied event wrote one notification, except the drop and the purchase postings, and no write or clock move wrote one',
    now.data.notifications.slice(t.seed.notifications.length).map(n => n.event_id), t.events.map(e => e.event_id).filter(id => !quiet.includes(id)));
  check('Each notification has one effect row', now.data.notifications.slice(t.seed.notifications.length).every(n =>
    added.filter(a => a.event_id === n.event_id && a.action === 'notification.written' && a.object_id === n.id && a.effect).length === 1));
  check('A refused call has a deny row in the audit and no activity row (' + t.refusals.length + ' refusals)', t.refusals.every(call =>
    now.audit.filter(r => r.input.request_id === call.request_id && r.decision === 'deny' && r.reason === call.result.status).length === 1 &&
    !now.data.activity.some(a => a.request_id === call.request_id)));
  equal('The audit has one row for each env.advance_time that is not a replay',
    now.audit.filter(r => r.tool === 'env.advance_time' && r.decision === 'allow').map(r => r.clock.to), t.advances.map(move => move.args.virtual_now));
}

async function clockReplay(t) {
  const last = t.advances[t.advances.length - 1], before = await t.snapshot();
  equal('Replay: a replayed env.advance_time returns the stored receipt with duplicate true', await t.infra.call('env.advance_time', last.args), {...last.result, duplicate: true});
  const now = await t.snapshot();
  equal('Replay: the replayed env.advance_time adds no audit row and moves nothing', [now.audit.length, now.virtual_now, now.revision], [before.audit.length, before.virtual_now, before.revision]);
}

async function reset(t) {
  const result = await t.infra.call('env.reset', {expected_version: t.version}), before = t.version;
  check('env.reset returns ready for this App instance only', result.status === 'ready' && result.reset_scope === 'brindle', result);
  const now = await t.snapshot();
  t.version = result.version;
  equal('Reset restores the loaded seed', now.data, t.seed);
  equal('Reset restores the time loaded with the seed', [now.virtual_now, (await t.get('preferences.get')).now], [START, START]);
  equal('Reset clears the audit and the receipts: only the row of the reset itself is left', [now.audit.map(r => r.tool), Object.keys(now.receipts)], [['env.reset'], []]);
  equal('Reset advances the epoch', [now.epoch, now.revision], [before.epoch + 1, 0]);
  const opened = await t.write('disputes.open', {id: 'txn-0381', amount: 30, reason: 'not_as_described', note: 'The item was broken.'});
  equal('Back at the loaded time of 9 November, the dispute of txn-0381 that was too_late on 12 November commits as open',
    [opened.result.state, (await t.get('disputes.get', {id: opened.result.id})).dispute.transaction_id], ['open', 'txn-0381']);
}

async function secondSeed(t) {
  const loaded = await t.infra.call('env.load_seed', {expected_version: t.version, request_id: 'second-seed', data: t.seed, virtual_now: '2026-11-20T16:30:00Z'});
  check('A second seed with another virtual_now is loaded in the same run', loaded.status === 'ready', loaded);
  t.version = loaded.version;
  equal('A start time spelled in UTC is read with the -05:00 offset of the issuer', (await t.get('preferences.get')).now, at('11-20 11:30'));
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
  const report = {schema: 'brindle.mcp-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version,
    app_version: read('app.json').version, node: process.version, checks, passed: false};
  try {
    const t = await connect(runtime, prepared, clients);
    // The parts run in the order of the virtual time: 9 November to 22 December 2026, then the reset and a second seed.
    const parts = [loadTaskSeed, discovery, failedCalls, refund, refusedEvents, windowCloses, dispute, temporaryCredit, statement, payment, offerExpires, paymentPosts,
      evaluatorRecords, clockReplay, reset, secondSeed, otherRun];
    for (const part of parts) await part(t);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Brindle real MCP checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Brindle real MCP checks passed.');
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
