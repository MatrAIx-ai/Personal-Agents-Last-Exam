'use strict';
// Business tests T01 to T21 of the approved plan (section 4, "Acceptance plan").
// A test name starts with its plan ID and its workflow. A letter after the ID marks one more test for that ID.
// PKG tests check the package itself. No test reads a file outside the package.
// In a copy of the package alone exactly three tests are skipped: T19i, T20 and T21e. They need the real runtime.
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
const READS = ['account.get', 'account.close_preview', 'transactions.list', 'transactions.get', 'statements.list', 'statements.get', 'payments.list', 'disputes.list',
  'disputes.get', 'offers.list', 'offers.get', 'rewards.get', 'notifications.list', 'preferences.get'];
const WRITES = ['payments.schedule', 'payments.cancel', 'autopay.set', 'disputes.open', 'disputes.withdraw', 'offers.accept', 'offers.decline', 'rewards.redeem',
  'rewards.transfer', 'account.close', 'preferences.update'];
const EVENTS = ['transaction.posted', 'transaction.dropped', 'statement.issued', 'payment.returned', 'dispute.updated', 'offer.issued', 'points.adjusted'];
// The 14 App errors of section 2, in the order of the table. When two fit one call, the first one wins.
const ERRORS = ['not_found', 'invalid_state', 'invalid_timezone', 'invalid_window', 'no_statement', 'nothing_due', 'over_balance', 'not_disputable', 'over_net',
  'already_disputed', 'too_late', 'insufficient_points', 'below_minimum', 'invalid_increment'];
const REASONS = ['not_received', 'not_as_described', 'credit_not_processed', 'duplicate_charge', 'wrong_amount', 'not_recognized', 'cancelled_recurring', 'other'];

// The small seed of examples/task-data, read at its clock: Monday 9 November 2026 at 06:00, before the plan's first example event.
const NOW = '2026-11-09T06:00:00-05:00';
const ACCOUNT = 'brindle-riley', OWNER = 'person-riley', BANK = 'Checking ending 4410';
// An instant in New York from November 2026 to March 2027, where the UTC offset is -05:00.
const ny = (day, time = '09:00:00') => day + 'T' + time + '-05:00';
const pick = (object, ...keys) => keys.map(key => object[key]);
const edit = (value, change) => { const next = structuredClone(value); change(next); return next; };
const start = (options = {}) => fixture({seed: SEED, now: NOW, ...options});
const SCHEMA = 'Input schema', EVENT_SCHEMA = 'Event schema';
// A refused call or event gives the error code of the plan and leaves the data as it was. `text` is a part of the message of the rule that refuses it.
// SCHEMA stands for a call that breaks its input schema: Core answers `invalid_arguments` before the App runs. EVENT_SCHEMA is the same for an event.
// The data includes the activity rows, and each commit writes one (T20c), so an unchanged log also means that Core's version did not move.
function unchanged(f, fn, code, label = code, text = '') {
  const before = f.data, version = commits(before);
  assert.throws(fn, error => {
    const got = error.message.startsWith(SCHEMA) ? SCHEMA : error.message.startsWith(EVENT_SCHEMA) ? EVENT_SCHEMA : error.code;
    assert.equal(got, code, label + ': ' + error.message);
    assert.ok(error.message.includes(text), label + ': ' + error.message);
    return true;
  }, label);
  assert.deepEqual(f.data, before, label);
  assert.equal(commits(f.data), version, label);
}
const commits = data => data.activity.filter(row => !row.effect).length;

// The events of the issuer and the merchants.
const event = (event_id, at, name, payload) => ({event_id, at, operation: 'brindle.' + name, payload});
const posted = (id, at, kind, amount, more = {}) => event('ev-' + id, at, 'transaction.posted', {transaction_id: id, kind, state: 'posted', amount, ...more});
const buy = (id, at, merchant, amount, more = {}) => posted(id, at, 'purchase', amount, {merchant, ...more});
const hold = (id, at, merchant, amount) => event('ev-' + id + '-hold', at, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'pending', amount, merchant});
const refund = (id, at, purchase, amount, merchant) => posted(id, at, 'refund', amount, {merchant, relates_to: purchase});
const updated = (event_id, at, dispute_id, status, more = {}) => event(event_id, at, 'dispute.updated', {dispute_id, status, ...more});
const returned = (event_id, at, payment_id) => event(event_id, at, 'payment.returned', {payment_id, reason: 'The bank account did not have enough money.'});
const points = (entry_id, at, value, more = {}) => event('ev-' + entry_id, at, 'points.adjusted', {entry_id, points: value, reason: 'earned', ...more});
const statement = (statement_id, issued, closing, due, balance, minimum) => event('ev-' + statement_id, issued, 'statement.issued',
  {statement_id, closing_at: closing, statement_balance: balance, minimum_due: minimum, due_at: due});

// The examples of the plan, one on each line of a helper file. `dev/check-plan-examples.cjs` compares them with the plan, byte for byte.
const verbatim = file => fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => line.replace(/,$/, ''));
const PLAN_EVENTS = verbatim('proposal-events.json'), PLAN_WIRE = verbatim('proposal-wire-message.json')[0];
const PLAN = Object.fromEntries(PLAN_EVENTS.map(line => JSON.parse(line)).map(e => [e.event_id, e]));

// The main path of the plan, step by step. `walk` returns what each step returned, up to the step `last`.
function walk(f, steps, last) {
  const seen = {};
  for (const [name, step] of Object.entries(steps)) {
    seen[name] = step(f);
    if (name === last) break;
  }
  return seen;
}
const GYM_NOTE = 'The gym promised to refund the whole month.';
const DISPUTE = {id: 'txn-0412', amount: 40, reason: 'credit_not_processed', note: GYM_NOTE};
const PAY_IN_FULL = {id: ACCOUNT, amount_type: 'statement_balance', pay_on: '2026-12-20', source: BANK};
// The gym refunds 20.00 of 60.00, the cardholder disputes the rest, the November statement of 1,240.00 is issued, a purchase of 210.00 and a hotel hold
// of 300.00 follow, and the statement is paid in full on 20 December and returned on 22 December.
const MAIN = {
  refund: f => f.event(PLAN['ev-br-301']),
  drop: f => f.event(PLAN['ev-br-302']),
  dispute: f => { f.advance(ny('2026-11-13', '20:00:00')); return f.call('disputes.open', DISPUTE); },
  credit: f => f.event(PLAN['ev-br-330']),
  statement: f => f.event(PLAN['ev-br-310']),
  purchase: f => f.event(buy('txn-0460', ny('2026-12-02', '03:00:00'), 'Fernhill Hardware', 210)),
  hold: f => f.event(hold('txn-0461', ny('2026-12-02', '03:30:00'), 'Harborview Hotel', 300)),
  points: f => f.event(PLAN['ev-br-350']),
  offer: f => f.event(PLAN['ev-br-340']),
  pay: f => { f.advance(ny('2026-12-10', '19:00:00')); return f.call('payments.schedule', PAY_IN_FULL); },
  paid: f => f.advance(ny('2026-12-20', '08:00:00')),
  returned: f => f.event(PLAN['ev-br-320'])
};
const main = (f, last) => walk(f, MAIN, last);
const account = f => f.call('account.get');
const tx = (f, id) => f.call('transactions.get', {id});
const recovery = (f, id) => tx(f, id).recovery;
const paymentOf = (f, id) => f.call('payments.list').items.find(p => p.id === id);
const offerOf = (f, id) => f.call('offers.get', {id}).offer;
const disputeOf = (f, id) => f.call('disputes.get', {id}).dispute;

// The offers of the plan's W4: three in one group, issued after the annual fee, and a bonus with no group.
const OFFER_AT = ny('2026-12-03', '15:20:00'), ACCEPT_BY = ny('2026-12-10', '23:59:59'), GROUP = 'retention-2026-12';
const offer = (offer_id, at, kind, fields, terms, group = GROUP) => event('ev-' + offer_id, at, 'offer.issued',
  {offer_id, kind, ...(group ? {group} : {}), accept_by: ACCEPT_BY, terms, ...fields});
const GROUP_OFFERS = [PLAN['ev-br-340'],
  offer('off-0022', OFFER_AT, 'statement_credit', {credit_amount: 150}, 'A statement credit of 150.00 after you accept. The credit posts within 30 days.'),
  offer('off-0023', OFFER_AT, 'product_change', {product_id: 'prd-everyday'}, 'Change to Brindle Everyday, a card with no annual fee.')];
const BONUS = offer('off-0024', ny('2026-12-03', '15:25:00'), 'bonus_points', {points: 5000}, '5,000 bonus points after you accept.', null);
const ANNUAL_FEE = posted('txn-0455', ny('2026-12-01', '03:00:00'), 'fee', 550, {fee_type: 'annual', note: 'Annual fee for the year from December 2026.'});
// The second fixture of W1 and W4: on Saturday 5 December, with the annual fee of 550.00 posted on 1 December and 12,000 points.
function feeWorld(f = start()) {
  main(f, 'statement');
  f.event(ANNUAL_FEE);
  walk(f, {purchase: MAIN.purchase, hold: MAIN.hold});
  for (const e of [...GROUP_OFFERS, BONUS]) f.event(e);
  f.advance(ny('2026-12-05', '10:00:00'));
  return f;
}
// The task seed with no statement and no payment, on the product with no annual fee.
function bare() {
  const seed = structuredClone(SEED), gone = new Set([...seed.statements, ...seed.payments].map(x => x.id));
  seed.statements = [];
  seed.payments = [];
  for (const n of seed.notifications) if (gone.has(n.object_id)) gone.add(n.id);
  seed.notifications = seed.notifications.filter(n => !gone.has(n.id));
  seed.activity = seed.activity.filter(row => !gone.has(row.object_id));
  seed.account.product_id = 'prd-everyday';
  return seed;
}

// Each of the 14 reads, for every object of the data.
function everyRead(f) {
  const data = f.data, results = [], read = (name, args = {}) => results.push([name, f.call(name, args)]);
  for (const name of ['account.get', 'account.close_preview', 'transactions.list', 'statements.list', 'payments.list', 'disputes.list', 'offers.list', 'rewards.get',
    'notifications.list', 'preferences.get']) read(name);
  for (const t of data.transactions) read('transactions.get', {id: t.id});
  for (const s of data.statements) read('statements.get', {id: s.id});
  for (const d of data.disputes) { read('disputes.get', {id: d.id}); read('disputes.list', {id: d.transaction_id}); }
  for (const o of data.offers) read('offers.get', {id: o.id});
  for (const state of ['scheduled', 'posted', 'skipped', 'cancelled', 'returned']) read('payments.list', {state});
  read('transactions.list', {start: '2026-11-01', end: '2026-11-30', kind: 'purchase', state: 'posted', merchant: 'Ironworks Gym'});
  read('notifications.list', {start: '2026-11-09'});
  return results;
}

test('T01 [W1] account: with a statement of 1,240.00, a purchase of 210.00 since and a hotel hold of 300.00, the balance is 1,450.00, pending_total 300.00 and available_credit 6,250.00', () => {
  const f = start();
  assert.deepEqual(pick(account(f), 'balance', 'pending_total', 'available_credit', 'points_balance', 'flags'), [1300, 150, 6550, 12000, []]);
  main(f, 'hold');
  const a = account(f);
  assert.deepEqual(pick(a, 'balance', 'pending_total', 'available_credit', 'points_balance', 'flags', 'now'), [1450, 300, 6250, 12000, [], ny('2026-12-02', '03:30:00')]);
  assert.deepEqual(a.latest_statement, {id: 'stm-2026-11', closing_at: '2026-11-30T23:59:59-05:00', due_at: '2026-12-26T17:00:00-05:00', statement_balance: 1240,
    minimum_due: 35, paid_toward: 0, minimum_left: 35, balance_left: 1240, due_passed: false});
  // What each choice of payments.schedule would pay now.
  assert.deepEqual(a.payment_options, {minimum_due: 35, statement_balance: 1240, current_balance: 1450});
  // The four rule values of the issuer, so the Agent knows each limit before it writes.
  assert.deepEqual(a.issuer.rules, {dispute_window_days: 60, fee_refund_days: 30, redeem_cents_per_point: 1, min_redeem_points: 1000});
  assert.deepEqual([a.account_id, a.owner_person_id, a.account.state, a.account.credit_limit, a.account.autopay], [ACCOUNT, OWNER, 'open', 8000, {mode: 'off', source: BANK}]);
  assert.deepEqual([a.product.id, a.product.name, a.product.annual_fee, a.product.partners.map(p => pick(p, 'id', 'ratio', 'min_points', 'step'))],
    ['prd-reserve', 'Brindle Reserve', 550, [['skyway', 1, 1000, 1000], ['larch', 2, 1000, 1000], ['meridian', 1, 2000, 500]]]);
  assert.deepEqual(a.products.map(p => [p.id, p.annual_fee]), [['prd-reserve', 550], ['prd-everyday', null]]);
});

test('T01b [W1] account: missing data is explicit (no statement, a product with no fee, a purchase with nothing related), and only posted transactions count', () => {
  const f = fixture({seed: bare(), now: NOW}), a = account(f);
  assert.deepEqual([a.latest_statement, a.payment_options.minimum_due, a.payment_options.statement_balance, a.flags], [null, null, null, []]);
  assert.equal(a.payment_options.current_balance, a.balance);
  assert.deepEqual([a.product.id, a.product.annual_fee, a.product.partners, f.call('rewards.get').partners], ['prd-everyday', null, [], []]);
  assert.equal(f.call('account.close_preview').fee_refund, null);
  assert.deepEqual(pick(tx(f, 'txn-0413'), 'related', 'disputes', 'recovery'), [[], [], {amount: 120.35, refunded_final: 0, temporary_credit: 0, net_charge: 120.35}]);
  // No statement means no past_due, even long after.
  f.advance(ny('2027-03-01'));
  assert.deepEqual(account(f).flags, []);
  // A pending refund, fee or credit is shown and counts in no sum. Only a pending purchase counts in pending_total.
  const g = start(), before = account(g);
  g.event(event('ev-pending-refund', ny('2026-11-09', '07:00:00'), 'transaction.posted', {transaction_id: 'txn-0432', kind: 'refund', state: 'pending', amount: 20,
    merchant: 'Ironworks Gym', relates_to: 'txn-0412'}));
  g.event(event('ev-pending-fee', ny('2026-11-09', '07:05:00'), 'transaction.posted', {transaction_id: 'txn-0433', kind: 'fee', state: 'pending', amount: 29, fee_type: 'other'}));
  assert.deepEqual(pick(account(g), 'balance', 'pending_total', 'available_credit'), pick(before, 'balance', 'pending_total', 'available_credit'));
  assert.deepEqual(recovery(g, 'txn-0412'), {amount: 60, refunded_final: 0, temporary_credit: 0, net_charge: 60});
  assert.deepEqual(g.call('transactions.list', {state: 'pending'}).items.map(t => t.id), ['txn-0440', 'txn-0432', 'txn-0433']);
});

test('T02 [W1] transactions: the list filters a window of transaction days (both ends included), kind, state and merchant, and sorts by transaction time', () => {
  const f = start(), ids = args => f.call('transactions.list', args).items.map(t => t.id);
  assert.deepEqual(ids({start: '2026-11-07', end: '2026-11-08'}), ['txn-0416', 'txn-0417', 'txn-0418', 'txn-0419', 'txn-0440']);
  assert.deepEqual(ids({start: '2026-11-08', end: '2026-11-08'}), ['txn-0418', 'txn-0419', 'txn-0440']);
  assert.deepEqual([ids({kind: 'refund'}), ids({kind: 'provisional_credit'}), ids({state: 'pending'})], [['txn-0385'], ['txn-0380'], ['txn-0440']]);
  // The merchant matches exactly, ignoring case.
  assert.deepEqual(ids({merchant: 'ironworks GYM'}), ['txn-0371', 'txn-0378', 'txn-0387', 'txn-0412']);
  assert.deepEqual(ids({merchant: 'Ironworks'}), []);
  assert.deepEqual(ids({start: '2026-11-01', kind: 'purchase', state: 'posted', merchant: 'Streamlet TV'}), ['txn-0415']);
  const all = f.call('transactions.list').items;
  assert.equal(all.length, SEED.transactions.length);
  assert.ok(all.every((t, i) => i === 0 || Date.parse(all[i - 1].transaction_at) <= Date.parse(t.transaction_at)));
  unchanged(f, () => f.call('transactions.list', {start: '2026-11-08', end: '2026-11-07'}), 'invalid_window');
  unchanged(f, () => f.call('transactions.list', {start: '2026-02-30'}), 'invalid_arguments', 'not a real day');
  // transactions.get gives the record, what relates to it, its disputes and the recovery summary.
  main(f, 'credit');
  // A purchase made on 1 November that posts on 16 November is listed on its transaction day.
  f.event(buy('txn-0430', ny('2026-11-16', '09:00:00'), 'Corner Slice', 18.5, {transaction_at: ny('2026-11-01', '19:30:00')}));
  assert.deepEqual([ids({start: '2026-11-01', end: '2026-11-01'}), ids({start: '2026-11-16', end: '2026-11-16'})], [['txn-0430'], ['txn-0450']]);
  const gym = tx(f, 'txn-0412');
  assert.deepEqual([gym.transaction.flags, gym.related.map(t => [t.id, t.kind, t.amount]), gym.disputes.map(d => pick(d, 'id', 'state', 'amount', 'outstanding'))],
    [['disputed', 'temporary_credit'], [['txn-0431', 'refund', 20], ['txn-0450', 'provisional_credit', 40]], [['dsp-0009', 'open', 40, 40]]]);
  assert.deepEqual(gym.recovery, {amount: 60, refunded_final: 20, temporary_credit: 40, net_charge: 40});
  const credit = tx(f, 'txn-0450');
  assert.deepEqual([credit.related.map(t => t.id), credit.recovery, credit.disputes, pick(credit.transaction, 'relates_to', 'dispute_id', 'merchant')],
    [['txn-0412'], null, [], ['txn-0412', 'dsp-0009', 'Ironworks Gym']]);
  unchanged(f, () => tx(f, 'txn-9999'), 'not_found', 'an unknown transaction');
});

test('T02b [W1] transactions: a posting event for a pending transaction changes only its amount and note, and a drop takes it out of pending_total', () => {
  const f = start();
  f.event(posted('txn-0440', ny('2026-11-10', '03:00:00'), 'purchase', 48.2, {merchant: 'Another Name', note: 'Final amount after the pump stopped.'}));
  const t = tx(f, 'txn-0440').transaction;
  assert.deepEqual(pick(t, 'state', 'kind', 'merchant', 'amount', 'pending_amount', 'note', 'transaction_at', 'posted_at'),
    ['posted', 'purchase', 'Northgate Fuel', 48.2, 150, 'Final amount after the pump stopped.', ny('2026-11-08', '17:42:00'), ny('2026-11-10', '03:00:00')]);
  assert.deepEqual(t.history.map(row => [row.action, row.amount]), [['transaction.pending', 150], ['transaction.posted', 48.2]]);
  assert.deepEqual(pick(account(f), 'balance', 'pending_total'), [1348.2, 0]);
  const g = start();
  g.event(PLAN['ev-br-302']);
  assert.deepEqual(pick(tx(g, 'txn-0440').transaction, 'state', 'dropped_at', 'drop_reason'), ['dropped', PLAN['ev-br-302'].at, 'The hold was released by the merchant.']);
  assert.deepEqual(pick(account(g), 'balance', 'pending_total', 'available_credit'), [1300, 0, 6700]);
});

test('T03 [W1] reads: the other reads, each returns now with the issuer\'s UTC offset, and the business data stays byte-identical after every read', () => {
  const f = start();
  main(f, 'offer');
  f.event(BONUS);
  walk(f, {pay: MAIN.pay, paid: MAIN.paid, returned: MAIN.returned});
  // Each read of the harness also checks that the data did not change. This repeats it over the whole set.
  const before = JSON.stringify(f.data), results = everyRead(f);
  assert.equal(JSON.stringify(f.data), before);
  assert.ok(results.length > 60 && results.every(([, out]) => out.now === PLAN['ev-br-320'].at), 'now on every read');
  // Each statement of the seed was paid in full, and the November one has nothing paid after the return.
  assert.deepEqual(f.call('statements.list').items.map(s => [s.id, s.statement_balance, s.paid_toward]),
    [...SEED.statements.map(s => [s.id, s.statement_balance, s.statement_balance]), ['stm-2026-11', 1240, 0]]);
  assert.deepEqual(f.call('statements.list', {start: '2026-10-31', end: '2026-11-30'}).items.map(s => s.id), ['stm-2026-10', 'stm-2026-11']);
  const november = f.call('statements.get', {id: 'stm-2026-11'}).statement;
  assert.deepEqual([november.payments.map(p => [p.id, p.state]), november.transaction_ids.includes('txn-0412'), november.transaction_ids.includes('txn-0460')],
    [[['pay-0061', 'returned']], true, false]);
  assert.deepEqual(f.call('payments.list', {state: 'posted'}).items.map(p => p.id), ['pay-0058', 'pay-0059', 'pay-0060']);
  assert.deepEqual(f.call('payments.list', {start: '2026-12-01'}).items.map(p => [p.id, p.state, p.posted_amount]), [['pay-0061', 'returned', 1240]]);
  assert.deepEqual([f.call('disputes.list', {id: 'txn-0412'}).items.map(d => d.id), f.call('disputes.list', {state: 'withdrawn'}).items.map(d => d.id)],
    [['dsp-0009'], ['dsp-0008']]);
  assert.deepEqual(pick(disputeOf(f, 'dsp-0009'), 'transaction_id', 'merchant', 'purchase_amount', 'amount', 'outstanding', 'state'), ['txn-0412', 'Ironworks Gym', 60, 40, 40, 'open']);
  assert.deepEqual([f.call('offers.list', {state: 'expired'}).items.map(o => o.id), f.call('offers.list', {state: 'declined'}).items.map(o => o.id),
    f.call('offers.list', {kind: 'bonus_points'}).items.map(o => o.id)], [['off-0019', 'off-0021', 'off-0024'], ['off-0020'], ['off-0024']]);
  const rewards = f.call('rewards.get');
  assert.deepEqual([rewards.balance, rewards.entries.map(e => e.id), rewards.partners.length], [13240, ['pts-0207', 'pts-0183', 'pts-0182', 'pts-0181', 'pts-0180'], 3]);
  assert.deepEqual(f.call('notifications.list', {start: '2026-12-01', end: '2026-12-03'}).items.map(n => n.kind), ['statement.issued', 'points.adjusted', 'offer.issued', 'offer.issued']);
  assert.deepEqual(f.call('preferences.get').preferences, {timezone: 'America/New_York', email_notices: true});
  for (const [name, id] of [['statements.get', 'stm-2099-01'], ['disputes.get', 'dsp-9999'], ['offers.get', 'off-9999'], ['disputes.list', 'txn-9999']]) {
    unchanged(f, () => f.call(name, {id}), 'not_found', name);
  }
  for (const [name, args] of [['statements.list', {start: '2026-12-02', end: '2026-12-01'}], ['payments.list', {start: '2026-12-02', end: '2026-12-01'}],
    ['notifications.list', {start: '2026-12-02', end: '2026-12-01'}]]) unchanged(f, () => f.call(name, args), 'invalid_window', name);
  // In summer the offset is -04:00. At Core's default clock of 1970 every read works.
  for (const [clock, shown] of [['2026-07-01T16:00:00Z', '2026-07-01T12:00:00-04:00'], ['1970-01-01T00:00:00Z', '1969-12-31T19:00:00-05:00']]) {
    const g = fixture({seed: SEED, now: clock});
    assert.ok(everyRead(g).every(([, out]) => out.now === shown), clock);
  }
});

test('T04 [W1] close preview: on 5 December, with the annual fee of 550.00 posted on 1 December, it reads a fee refund of 550.00 until 31 December and 12,000 points lost', () => {
  const f = feeWorld();
  assert.ok(account(f).flags.includes('fee_refund_open'));
  f.call('offers.accept', {id: 'off-0024'});
  f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 100, pay_on: '2026-12-20', source: BANK});
  const before = JSON.stringify(f.data), preview = f.call('account.close_preview');
  assert.equal(JSON.stringify(f.data), before);
  assert.deepEqual(pick(preview, 'already_closed', 'points_lost', 'fee_refund'), [false, 12000, {fee_id: 'txn-0455', amount: 550, until: '2026-12-31'}]);
  assert.deepEqual(preview.offers_ending.map(o => [o.id, o.state]), [['off-0021', 'available'], ['off-0022', 'available'], ['off-0023', 'available']]);
  assert.deepEqual(preview.bonus_not_arrived.map(o => [o.id, o.kind, o.state]), [['off-0024', 'bonus_points', 'enrolled']]);
  assert.deepEqual(preview.stays_open, {balance: 2000, scheduled_payments: ['pay-0061'], open_disputes: ['dsp-0009'], pending_transactions: ['txn-0461'], credits_owed: []});
  // The bonus points arrive, so they are no longer at risk. The last day of the refund is 31 December: from 1 January it reads null.
  f.event(points('pts-0208', ny('2026-12-06', '04:00:00'), 5000, {reason: 'bonus', offer_id: 'off-0024'}));
  assert.deepEqual(pick(f.call('account.close_preview'), 'points_lost', 'bonus_not_arrived'), [17000, []]);
  f.advance(ny('2026-12-31', '23:59:59'));
  assert.equal(f.call('account.close_preview').fee_refund.until, '2026-12-31');
  f.advance(ny('2027-01-01', '00:00:00'));
  assert.deepEqual([f.call('account.close_preview').fee_refund, account(f).flags.includes('fee_refund_open')], [null, false]);
});

test('T05 [W2] schedule: on 10 December a payment of the statement balance for 20 December is scheduled for 1,240.00, and a payment for today posts at once', () => {
  const f = start(), {pay} = main(f, 'pay');
  assert.deepEqual(pay, {id: 'pay-0061', state: 'scheduled', scheduled_amount: 1240, pay_on: '2026-12-20', posts_at: ny('2026-12-20', '00:00:00')});
  assert.deepEqual(pick(paymentOf(f, 'pay-0061'), 'amount_type', 'statement_id', 'source', 'autopay', 'posted_amount'), ['statement_balance', 'stm-2026-11', BANK, false, null]);
  const call = args => () => f.call('payments.schedule', {id: ACCOUNT, source: BANK, ...args});
  unchanged(f, call({amount_type: 'fixed', amount: 10, pay_on: '2026-12-09'}), 'invalid_window', 'a payment for yesterday', 'before today, 2026-12-10');
  // 1,240.00 is scheduled, so 2,000.00 more is above 1,450.00. A payment of exactly what is left of the balance is allowed.
  unchanged(f, call({amount_type: 'fixed', amount: 2000, pay_on: '2026-12-11'}), 'over_balance', 'a payment above the balance', 'above the current balance of 1,450.00');
  unchanged(f, call({amount_type: 'fixed', amount: 210.01, pay_on: '2026-12-11'}), 'over_balance', 'one cent above');
  unchanged(f, call({amount_type: 'fixed', pay_on: '2026-12-11'}), SCHEMA, 'a fixed payment with no amount');
  unchanged(f, call({amount_type: 'minimum_due', amount: 35, pay_on: '2026-12-11'}), SCHEMA, 'an amount for the minimum due');
  unchanged(f, call({amount_type: 'fixed', amount: 0, pay_on: '2026-12-11'}), SCHEMA, 'an amount of zero');
  unchanged(f, call({amount_type: 'fixed', amount: 10.005, pay_on: '2026-12-11'}), 'invalid_arguments', 'three decimals');
  unchanged(f, call({amount_type: 'fixed', amount: 10, pay_on: '2026-02-30'}), 'invalid_arguments', 'not a real day');
  // A payment for today posts at once: posts_at is the moment it was scheduled, the later of that and the start of its day.
  const today = f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 210, pay_on: '2026-12-10', source: 'Savings ending 7731'});
  assert.deepEqual(pick(today, 'state', 'posts_at'), ['posted', ny('2026-12-10', '19:00:00')]);
  assert.deepEqual(pick(account(f), 'balance', 'latest_statement'), [1240, {...account(f).latest_statement, paid_toward: 210}]);
  // The statement balance less what was paid toward it, and the current balance.
  assert.deepEqual(account(f).payment_options, {minimum_due: 0, statement_balance: 1030, current_balance: 1240});
  unchanged(f, call({amount_type: 'minimum_due', pay_on: '2026-12-11'}), 'nothing_due', 'the minimum is paid');
  // On a seed with no statement the minimum due and the statement balance return no_statement. The current balance can be paid.
  const g = fixture({seed: bare(), now: NOW});
  for (const amount_type of ['minimum_due', 'statement_balance']) {
    unchanged(g, () => g.call('payments.schedule', {id: ACCOUNT, amount_type, pay_on: '2026-11-10', source: BANK}), 'no_statement', amount_type);
  }
  assert.equal(g.call('payments.schedule', {id: ACCOUNT, amount_type: 'current_balance', pay_on: '2026-11-10', source: BANK}).scheduled_amount, account(g).balance);
  unchanged(g, () => g.call('payments.schedule', {id: 'brindle-other', amount_type: 'fixed', amount: 5, pay_on: '2026-11-10', source: BANK}), 'not_found', 'another account');
});

test('T05b [W2] schedule: after the statement is paid in full the statement balance returns nothing_due, and a zero or credit balance returns nothing_due for the current balance', () => {
  const f = start();
  main(f, 'paid');
  assert.deepEqual(pick(account(f).latest_statement, 'paid_toward', 'balance_left', 'minimum_left'), [1240, 0, 0]);
  for (const amount_type of ['statement_balance', 'minimum_due']) {
    unchanged(f, () => f.call('payments.schedule', {id: ACCOUNT, amount_type, pay_on: '2026-12-21', source: BANK}), 'nothing_due', amount_type);
  }
  // A credit of 1,500.00 takes the balance to -1,290.00.
  f.event(posted('txn-0470', ny('2026-12-20', '09:00:00'), 'credit', 1500, {note: 'Goodwill credit'}));
  assert.deepEqual(pick(account(f), 'balance', 'flags'), [-1290, ['credit_balance']]);
  assert.equal(account(f).payment_options.current_balance, 0);
  unchanged(f, () => f.call('payments.schedule', {id: ACCOUNT, amount_type: 'current_balance', pay_on: '2026-12-21', source: BANK}), 'nothing_due', 'a credit balance');
  // A seed balance of exactly zero.
  const g = start();
  g.event(posted('txn-0471', ny('2026-11-09', '07:00:00'), 'credit', 1300));
  unchanged(g, () => g.call('payments.schedule', {id: ACCOUNT, amount_type: 'current_balance', pay_on: '2026-11-09', source: BANK}), 'nothing_due', 'a zero balance');
});

test('T06 [W2] cancel: on 19 December the payment of 20 December is cancelled, on its day it returns too_late, and a cancelled or returned payment returns invalid_state', () => {
  const f = start();
  main(f, 'pay');
  f.advance(ny('2026-12-19', '21:00:00'));
  assert.deepEqual(f.call('payments.cancel', {id: 'pay-0061'}), {id: 'pay-0061', state: 'cancelled'});
  assert.deepEqual(pick(paymentOf(f, 'pay-0061'), 'state', 'cancelled_at', 'posted_amount'), ['cancelled', ny('2026-12-19', '21:00:00'), null]);
  unchanged(f, () => f.call('payments.cancel', {id: 'pay-0061'}), 'invalid_state', 'cancelled');
  f.advance(ny('2026-12-20', '08:00:00'));
  assert.deepEqual([paymentOf(f, 'pay-0061').state, account(f).balance], ['cancelled', 1450]);
  const g = start();
  main(g, 'paid');
  unchanged(g, () => g.call('payments.cancel', {id: 'pay-0061'}), 'too_late', 'on the payment\'s day', 'posted');
  g.event(PLAN['ev-br-320']);
  unchanged(g, () => g.call('payments.cancel', {id: 'pay-0061'}), 'invalid_state', 'returned');
  unchanged(g, () => g.call('payments.cancel', {id: 'pay-9999'}), 'not_found', 'an unknown payment');
  // At 00:00 on its day the payment has already posted.
  const h = start();
  main(h, 'pay');
  h.advance(ny('2026-12-19', '23:59:59'));
  const before = h.data;
  h.advance(ny('2026-12-20', '00:00:00'));
  unchanged(h, () => h.call('payments.cancel', {id: 'pay-0061'}), 'too_late', 'at the start of the day');
  assert.deepEqual(h.data, before);
});

test('T06b [W2] cancel: cancelling an autopay payment stops that one payment only, the autopay setting stays, and no new payment is scheduled for the statement', () => {
  const f = start();
  f.call('autopay.set', {id: ACCOUNT, mode: 'statement_balance'});
  main(f, 'statement');
  assert.deepEqual(pick(paymentOf(f, 'pay-0061'), 'autopay', 'state', 'scheduled_amount', 'pay_on', 'statement_id'), [true, 'scheduled', 1240, '2026-12-26', 'stm-2026-11']);
  f.advance(ny('2026-12-10'));
  f.call('payments.cancel', {id: 'pay-0061'});
  f.advance(ny('2026-12-27'));
  assert.deepEqual([account(f).account.autopay, f.data.payments.length, paymentOf(f, 'pay-0061').state, account(f).flags],
    [{mode: 'statement_balance', source: BANK}, SEED.payments.length + 1, 'cancelled', ['past_due']]);
  // A skipped autopay payment returns too_late.
  const g = start();
  g.call('autopay.set', {id: ACCOUNT, mode: 'minimum_due'});
  main(g, 'statement');
  g.advance(ny('2026-12-10'));
  g.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 50, pay_on: '2026-12-10', source: BANK});
  g.advance(ny('2026-12-26'));
  assert.equal(paymentOf(g, 'pay-0061').state, 'skipped');
  unchanged(g, () => g.call('payments.cancel', {id: 'pay-0061'}), 'too_late', 'skipped', 'skipped');
});

// The December statement: balance 210.00, minimum 35.00, due on 26 January.
const DECEMBER = statement('stm-2026-12', ny('2027-01-01', '02:00:00'), ny('2026-12-31', '23:59:59'), ny('2027-01-26', '17:00:00'), 210, 35);
// The main path to 20 December, with autopay on the minimum due from 20 December, and the December statement.
function autopayWorld(source) {
  const f = start();
  main(f, 'paid');
  f.call('autopay.set', {id: ACCOUNT, mode: 'minimum_due', ...(source ? {source} : {})});
  f.event(DECEMBER);
  return f;
}
const manual = (f, amount, day, pay_on = day) => { f.advance(ny(day, '08:00:00')); return f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount, pay_on, source: BANK}).id; };

test('T07 [W2] autopay: on the minimum due, the next statement schedules 35.00 for 26 January, and a manual payment of 100.00 on 10 January makes it skipped', () => {
  const f = autopayWorld('Savings ending 7731');
  assert.deepEqual(pick(paymentOf(f, 'pay-0062'), 'autopay', 'amount_type', 'statement_id', 'scheduled_amount', 'pay_on', 'posts_at', 'state', 'source'),
    [true, 'minimum_due', 'stm-2026-12', 35, '2027-01-26', ny('2027-01-26', '00:00:00'), 'scheduled', 'Savings ending 7731']);
  assert.equal(f.call('statements.get', {id: 'stm-2026-12'}).statement.autopay_payment_id, 'pay-0062');
  // Autopay payments are not in the over_balance total: 210.00 can be scheduled by hand while 35.00 waits.
  const check = start();
  walk(check, {...MAIN, returned: () => null});
  check.call('autopay.set', {id: ACCOUNT, mode: 'minimum_due'});
  check.event(DECEMBER);
  check.advance(ny('2027-01-02'));
  assert.equal(check.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 210, pay_on: '2027-01-20', source: BANK}).scheduled_amount, 210);
  manual(f, 100, '2027-01-10');
  f.advance(ny('2027-01-25', '23:59:59'));
  assert.equal(paymentOf(f, 'pay-0062').state, 'scheduled');
  f.advance(ny('2027-01-26', '00:00:00'));
  assert.deepEqual(pick(paymentOf(f, 'pay-0062'), 'state', 'posted_amount'), ['skipped', 0]);
  assert.deepEqual([account(f).balance, account(f).latest_statement.paid_toward], [110, 100]);
  f.advance(ny('2027-01-26', '17:00:00'));
  assert.deepEqual(account(f).flags, ['statement_unpaid']);
  // autopay.set with no source keeps the stored label.
  f.call('autopay.set', {id: ACCOUNT, mode: 'statement_balance'});
  assert.deepEqual(account(f).account.autopay, {mode: 'statement_balance', source: 'Savings ending 7731'});
});

test('T07b [W2] autopay: a manual payment returned after the autopay day restores the debt and does not raise the autopay amount', () => {
  // A manual payment of 20.00 on 10 January makes the autopay payment 15.00. One of 100.00 makes it skipped.
  for (const [amount, state, autopaid] of [[20, 'posted', 15], [100, 'skipped', 0]]) {
    const f = autopayWorld(), early = manual(f, amount, '2027-01-10');
    f.advance(ny('2027-01-26', '12:00:00'));
    assert.deepEqual(pick(paymentOf(f, 'pay-0062'), 'state', 'posted_amount'), [state, autopaid], 'before the return of ' + amount);
    assert.deepEqual([account(f).balance, account(f).latest_statement.paid_toward], [210 - amount - autopaid, amount + autopaid]);
    f.event(returned('ev-return-' + amount, ny('2027-01-27', '09:30:00'), early));
    assert.deepEqual(pick(paymentOf(f, early), 'state', 'posted_amount'), ['returned', amount]);
    assert.deepEqual(pick(paymentOf(f, 'pay-0062'), 'state', 'posted_amount'), [state, autopaid], 'after the return of ' + amount);
    assert.deepEqual([account(f).balance, account(f).latest_statement.paid_toward], [210 - autopaid, autopaid]);
    assert.deepEqual(account(f).flags, ['past_due', 'payment_returned']);
  }
  // A return before the autopay day counts: the manual payment is gone by then, so autopay pays the full 35.00.
  const g = autopayWorld(), early = manual(g, 100, '2027-01-10');
  g.event(returned('ev-return-early', ny('2027-01-12', '09:30:00'), early));
  g.advance(ny('2027-01-26', '12:00:00'));
  assert.deepEqual(pick(paymentOf(g, 'pay-0062'), 'state', 'posted_amount'), ['posted', 35]);
  assert.equal(account(g).balance, 175);
});

test('T07c [W2] autopay: a same-day payment changes nothing, turning autopay on later schedules nothing, a zero amount schedules nothing, and a new setting leaves a scheduled payment', () => {
  // A manual payment that posts at the start of the same day is not before it, so autopay still pays 35.00.
  const f = autopayWorld();
  manual(f, 20, '2027-01-20', '2027-01-26');
  f.advance(ny('2027-01-26', '12:00:00'));
  assert.deepEqual(pick(paymentOf(f, 'pay-0062'), 'state', 'posted_amount'), ['posted', 35]);
  assert.equal(account(f).balance, 155);
  // Autopay turned on after the statement schedules nothing for it.
  const g = start();
  main(g, 'paid');
  g.event(DECEMBER);
  g.call('autopay.set', {id: ACCOUNT, mode: 'statement_balance'});
  assert.deepEqual([g.data.payments.length, g.call('statements.get', {id: 'stm-2026-12'}).statement.autopay_payment_id], [SEED.payments.length + 1, null]);
  // A statement of 0.00 schedules no autopay payment.
  const h = start();
  main(h, 'paid');
  h.call('autopay.set', {id: ACCOUNT, mode: 'statement_balance'});
  h.event(statement('stm-2026-12', ny('2027-01-01', '02:00:00'), ny('2026-12-31', '23:59:59'), ny('2027-01-26', '17:00:00'), 0, 0));
  assert.equal(h.data.payments.length, SEED.payments.length + 1);
  // Turning autopay off leaves the scheduled payment, which posts on its day.
  const k = autopayWorld();
  k.call('autopay.set', {id: ACCOUNT, mode: 'off'});
  k.advance(ny('2027-01-26', '12:00:00'));
  assert.deepEqual(pick(paymentOf(k, 'pay-0062'), 'state', 'posted_amount'), ['posted', 35]);
  unchanged(k, () => k.call('autopay.set', {id: 'brindle-other', mode: 'off'}), 'not_found', 'another account');
});

test('T08 [W2] the bill: after env.advance_time to 20 December the payment is posted, the balance is 210.00 and the statement is paid in full; a return brings back 1,450.00', () => {
  const f = start();
  main(f, 'pay');
  const october = () => f.call('statements.get', {id: 'stm-2026-10'}).statement.paid_toward;
  const paidBefore = october();
  const before = f.data;
  f.advance(ny('2026-12-20', '08:00:00'));
  assert.deepEqual(f.data, before);
  assert.deepEqual(pick(paymentOf(f, 'pay-0061'), 'state', 'posted_amount'), ['posted', 1240]);
  assert.deepEqual(pick(account(f), 'balance', 'flags'), [210, []]);
  assert.deepEqual(pick(account(f).latest_statement, 'paid_toward', 'balance_left', 'minimum_left'), [1240, 0, 0]);
  // paid_toward of an older statement stops at the next closing.
  assert.deepEqual([october(), paidBefore], [649.19, 649.19]);
  f.event(PLAN['ev-br-320']);
  assert.deepEqual(pick(paymentOf(f, 'pay-0061'), 'state', 'returned_at', 'return_reason'), ['returned', PLAN['ev-br-320'].at, 'The bank account did not have enough money.']);
  assert.deepEqual(pick(account(f), 'balance', 'flags'), [1450, ['payment_returned']]);
  assert.equal(account(f).latest_statement.paid_toward, 0);
  f.advance(ny('2026-12-26', '17:00:00'));
  assert.deepEqual(account(f).flags, ['past_due', 'payment_returned']);
});

test('T08b [W2] the bill: with nothing paid the account reads past_due when the due time passes, and statement_unpaid when only the minimum is paid', () => {
  const f = start(), g = start();
  main(f, 'offer');
  main(g, 'offer');
  g.advance(ny('2026-12-10'));
  g.call('payments.schedule', {id: ACCOUNT, amount_type: 'minimum_due', pay_on: '2026-12-10', source: BANK});
  for (const [time, flagsF, flagsG] of [[ny('2026-12-26', '16:59:59'), [], []], [ny('2026-12-26', '17:00:00'), ['past_due'], ['statement_unpaid']]]) {
    const before = [f.data, g.data];
    f.advance(time);
    g.advance(time);
    assert.deepEqual([f.data, g.data], before);
    assert.deepEqual([account(f).flags, account(g).flags, account(f).latest_statement.due_passed], [flagsF, flagsG, flagsF.length > 0], time);
  }
  // A balance of zero or below reads neither flag, even with nothing paid.
  f.event(posted('txn-0470', ny('2026-12-27'), 'credit', 1450));
  assert.deepEqual([account(f).balance, account(f).flags], [0, []]);
});

test('T09 [W2] preferences: an unknown time zone returns invalid_timezone, the zone sets the days of notification text, and email_notices off stores no email', () => {
  const f = start();
  unchanged(f, () => f.call('preferences.update', {timezone: 'Mars/Olympus'}), 'invalid_timezone', 'an unknown zone');
  unchanged(f, () => f.call('preferences.update', {timezone: '+05:00'}), 'invalid_timezone', 'a bare offset');
  unchanged(f, () => f.call('preferences.update', {}), SCHEMA, 'no field');
  assert.deepEqual(f.call('preferences.update', {timezone: 'Asia/Tokyo', email_notices: false}), {id: ACCOUNT});
  assert.deepEqual(f.call('preferences.get').preferences, {timezone: 'Asia/Tokyo', email_notices: false});
  main(f, 'statement');
  const n = f.data.notifications[f.data.notifications.length - 1];
  // 30 November 23:59:59 in New York is 1 December in Tokyo, and 26 December 17:00 is 27 December 07:00.
  assert.deepEqual([n.title, n.email], ['Your statement is ready: 1,240.00 is due on 27 December', null]);
  assert.match(n.text, /closed on 1 December\. .* Pay by 27 December at 07:00\./);
  // The issuer's time zone still sets the days of the rules and of the reads.
  assert.equal(account(f).now, PLAN['ev-br-310'].at);
  f.call('preferences.update', {email_notices: true});
  assert.deepEqual(f.call('preferences.get').preferences, {timezone: 'Asia/Tokyo', email_notices: true});
});

test('T10 [W3] refunds: the gym purchase of 60.00 posted on 2 November and a refund of 20.00 on 9 November read refunded_final 20.00 and net_charge 40.00', () => {
  const f = start();
  assert.deepEqual(pick(tx(f, 'txn-0412').transaction, 'amount', 'posted_at', 'merchant'), [60, ny('2026-11-02', '06:00:00'), 'Ironworks Gym']);
  assert.deepEqual(recovery(f, 'txn-0412'), {amount: 60, refunded_final: 0, temporary_credit: 0, net_charge: 60});
  main(f, 'refund');
  assert.deepEqual(recovery(f, 'txn-0412'), {amount: 60, refunded_final: 20, temporary_credit: 0, net_charge: 40});
  assert.deepEqual(pick(tx(f, 'txn-0431').transaction, 'kind', 'relates_to', 'note', 'posted_at'), ['refund', 'txn-0412', 'Partial refund', PLAN['ev-br-301'].at]);
  assert.deepEqual([account(f).balance, tx(f, 'txn-0412').transaction.flags], [1280, []]);
  // A credit that relates to a purchase is shown with it, and the summary counts only the merchant's refunds.
  f.event(posted('txn-0432', ny('2026-11-09', '07:00:00'), 'credit', 5, {relates_to: 'txn-0412', note: 'Goodwill credit'}));
  assert.deepEqual([tx(f, 'txn-0412').related.map(t => t.id), recovery(f, 'txn-0412').refunded_final], [['txn-0431', 'txn-0432'], 20]);
});

test('T11 [W3] disputes.open: 40.00 on 13 November is open; 50.00 is over_net, the hotel hold is not_disputable, a second dispute is already_disputed, 61 days later is too_late', () => {
  const f = start();
  main(f, 'drop');
  f.advance(ny('2026-11-13', '20:00:00'));
  f.event(hold('txn-0441', ny('2026-11-13', '20:00:00'), 'Harborview Hotel', 300));
  f.event(posted('txn-0442', ny('2026-11-13', '20:00:00'), 'fee', 29, {fee_type: 'other', note: 'Returned payment fee'}));
  const open = (args, label) => () => f.call('disputes.open', {reason: 'other', note: 'Please check.', ...args});
  unchanged(f, open({id: 'txn-0412', amount: 50}), 'over_net', '50.00 when net_charge is 40.00', 'net charge of 40.00');
  unchanged(f, open({id: 'txn-0441', amount: 40}), 'not_disputable', 'the pending hotel hold', 'pending purchase');
  unchanged(f, open({id: 'txn-0442', amount: 10}), 'not_disputable', 'a fee', 'posted fee');
  unchanged(f, open({id: 'txn-0431', amount: 10}), 'not_disputable', 'a refund');
  unchanged(f, open({id: 'txn-0384', amount: 10}), 'not_disputable', 'a purchase refunded in full', 'refunded in full');
  unchanged(f, open({id: 'txn-0412', amount: 40, reason: 'fraud'}), SCHEMA, 'a reason that is not one of the eight');
  unchanged(f, open({id: 'txn-0412', amount: 40.001}), 'invalid_arguments', 'three decimals');
  unchanged(f, open({id: 'txn-9999', amount: 40}), 'not_found', 'an unknown purchase');
  assert.deepEqual(f.call('disputes.open', DISPUTE), {id: 'dsp-0009', state: 'open'});
  assert.deepEqual(pick(disputeOf(f, 'dsp-0009'), 'transaction_id', 'amount', 'reason', 'note', 'opened_at', 'state'),
    ['txn-0412', 40, 'credit_not_processed', GYM_NOTE, ny('2026-11-13', '20:00:00'), 'open']);
  assert.deepEqual(tx(f, 'txn-0412').transaction.flags, ['disputed']);
  unchanged(f, open({id: 'txn-0412', amount: 40}), 'already_disputed', 'a second dispute while the first is open', 'open dispute');
  // The first error of the table when two fit.
  unchanged(f, open({id: 'txn-0412', amount: 50}), 'over_net', 'over_net before already_disputed');
  unchanged(f, open({id: 'txn-0441', amount: 400}), 'not_disputable', 'not_disputable before over_net');
  // A purchase that the issuer ended a dispute on: dsp-0007 on txn-0377 was resolved for the account holder, and the purchase is now fully credited.
  unchanged(f, open({id: 'txn-0377', amount: 10}), 'not_disputable', 'a purchase whose resolved dispute credited it in full');
  // The window counts from the posting time: txn-0413 posted on 4 November, so 3 January is the last day and 4 January is 61 days later.
  const g = start();
  g.advance(ny('2027-01-03', '23:59:59'));
  assert.equal(g.call('disputes.open', {id: 'txn-0413', amount: 20, reason: 'wrong_amount', note: 'Charged twice for one item.'}).state, 'open');
  const h = start();
  h.advance(ny('2027-01-04', '00:00:00'));
  unchanged(h, () => h.call('disputes.open', {id: 'txn-0413', amount: 20, reason: 'wrong_amount', note: 'Charged twice.'}), 'too_late', '61 days after it posted', 'The last day was 2027-01-03');
  unchanged(h, () => h.call('disputes.open', {id: 'txn-0413', amount: 200, reason: 'wrong_amount', note: 'Charged twice.'}), 'over_net', 'over_net before too_late');
  // A purchase made in September and posted on 20 November is open to a dispute until 19 January.
  h.event(buy('txn-0443', ny('2027-01-04', '01:00:00'), 'Skyway Air', 320, {transaction_at: ny('2026-09-01', '12:00:00')}));
  const k = fixture({seed: h.data, now: ny('2027-03-05')});
  assert.equal(k.call('disputes.open', {id: 'txn-0443', amount: 320, reason: 'not_received', note: 'The flight was cancelled.'}).state, 'open');
});

test('T11b [W3] disputes.open: a purchase whose dispute the issuer ended returns already_disputed', () => {
  for (const status of ['resolved_for_merchant', 'closed_matched']) {
    const f = start();
    f.advance(ny('2026-11-10', '20:00:00'));
    f.call('disputes.open', {id: 'txn-0413', amount: 50, reason: 'wrong_amount', note: 'Charged for two items, I bought one.'});
    f.event(updated('ev-end', ny('2026-11-12', '10:00:00'), 'dsp-0009', status));
    unchanged(f, () => f.call('disputes.open', {id: 'txn-0413', amount: 10, reason: 'other', note: 'Again.'}), 'already_disputed', status, 'ended a dispute');
    f.advance(ny('2027-01-10'));
    unchanged(f, () => f.call('disputes.open', {id: 'txn-0413', amount: 10, reason: 'other', note: 'Again.'}), 'already_disputed', 'already_disputed before too_late');
  }
});

test('T12 [W3] disputes.withdraw: after the temporary credit the dispute is withdrawn, temporary_credit stays 40.00 until a reversal posts, and the purchase can be disputed again', () => {
  const f = start();
  main(f, 'credit');
  f.advance(ny('2026-11-17', '19:00:00'));
  assert.deepEqual(f.call('disputes.withdraw', {id: 'dsp-0009', note: 'The gym will refund me directly.'}), {id: 'dsp-0009', state: 'withdrawn'});
  assert.deepEqual(pick(disputeOf(f, 'dsp-0009'), 'state', 'withdrawn_at', 'ended_at', 'outstanding'), ['withdrawn', ny('2026-11-17', '19:00:00'), null, 40]);
  assert.deepEqual(disputeOf(f, 'dsp-0009').history.map(row => [row.status, row.actor]), [['open', 'agent'], ['open', 'event'], ['withdrawn', 'agent']]);
  assert.deepEqual([recovery(f, 'txn-0412'), tx(f, 'txn-0412').transaction.flags], [{amount: 60, refunded_final: 20, temporary_credit: 40, net_charge: 40}, ['temporary_credit']]);
  unchanged(f, () => f.call('disputes.withdraw', {id: 'dsp-0009'}), 'invalid_state', 'withdrawn', 'Only an open dispute');
  unchanged(f, () => f.call('disputes.withdraw', {id: 'dsp-0007'}), 'invalid_state', 'resolved_for_me');
  unchanged(f, () => f.call('disputes.withdraw', {id: 'dsp-9999'}), 'not_found', 'an unknown dispute');
  // The issuer takes the credit back with transaction.posted. The reversal names its dispute, and the App sets relates_to to the dispute's purchase.
  f.event(posted('txn-0452', ny('2026-11-20', '04:00:00'), 'reversal', 40, {dispute_id: 'dsp-0009', note: 'Temporary credit taken back after the withdrawal.'}));
  assert.deepEqual(pick(tx(f, 'txn-0452').transaction, 'relates_to', 'dispute_id', 'merchant'), ['txn-0412', 'dsp-0009', 'Ironworks Gym']);
  assert.deepEqual([recovery(f, 'txn-0412'), tx(f, 'txn-0412').transaction.flags, disputeOf(f, 'dsp-0009').outstanding],
    [{amount: 60, refunded_final: 20, temporary_credit: 0, net_charge: 40}, [], 0]);
  // A purchase can be disputed again after a withdrawal.
  assert.deepEqual(f.call('disputes.open', DISPUTE), {id: 'dsp-0010', state: 'open'});
  // The seed's dsp-0008 was withdrawn too, but its purchase was refunded in full.
  assert.equal(disputeOf(f, 'dsp-0008').state, 'withdrawn');
});

test('T13 [W3] temporary credits: 40.00 reads temporary, a merchant refund of 40.00 reads double_credited, and closed_matched with a reversal of 40.00 clears it', () => {
  const f = start();
  main(f, 'credit');
  assert.deepEqual([recovery(f, 'txn-0412'), tx(f, 'txn-0412').transaction.flags], [{amount: 60, refunded_final: 20, temporary_credit: 40, net_charge: 40}, ['disputed', 'temporary_credit']]);
  assert.deepEqual(pick(tx(f, 'txn-0450').transaction, 'kind', 'amount', 'relates_to', 'dispute_id', 'merchant'), ['provisional_credit', 40, 'txn-0412', 'dsp-0009', 'Ironworks Gym']);
  assert.equal(account(f).balance, 1240);
  f.event(refund('txn-0451', ny('2026-11-18', '04:00:00'), 'txn-0412', 40, 'Ironworks Gym'));
  assert.deepEqual([recovery(f, 'txn-0412'), tx(f, 'txn-0412').transaction.flags],
    [{amount: 60, refunded_final: 60, temporary_credit: 40, net_charge: 0}, ['disputed', 'temporary_credit', 'double_credited']]);
  assert.equal(account(f).balance, 1200);
  f.event(updated('ev-matched', ny('2026-11-19', '10:00:00'), 'dsp-0009', 'closed_matched', {reversal: {transaction_id: 'txn-0452', amount: 40}, note: 'The merchant refunded you.'}));
  assert.deepEqual([recovery(f, 'txn-0412'), tx(f, 'txn-0412').transaction.flags], [{amount: 60, refunded_final: 60, temporary_credit: 0, net_charge: 0}, []]);
  assert.deepEqual(pick(disputeOf(f, 'dsp-0009'), 'state', 'ended_at'), ['closed_matched', ny('2026-11-19', '10:00:00')]);
  assert.deepEqual(disputeOf(f, 'dsp-0009').history[2], {at: ny('2026-11-19', '10:00:00'), status: 'closed_matched', note: 'The merchant refunded you.', actor: 'event',
    ref: 'ev-matched', credit_id: null, reversal_id: 'txn-0452'});
  assert.equal(account(f).balance, 1240);
  // Resolved for the account holder: the temporary credit stays and is final. Resolved for the merchant: the issuer takes it back.
  const paths = [['resolved_for_me', {}, {amount: 60, refunded_final: 60, temporary_credit: 0, net_charge: 0}, 1240],
    ['resolved_for_merchant', {reversal: {transaction_id: 'txn-0452', amount: 40}}, {amount: 60, refunded_final: 20, temporary_credit: 0, net_charge: 40}, 1280]];
  for (const [status, more, summary, balance] of paths) {
    const g = start();
    main(g, 'credit');
    g.event(updated('ev-end', ny('2026-11-25', '10:00:00'), 'dsp-0009', status, more));
    assert.deepEqual([recovery(g, 'txn-0412'), tx(g, 'txn-0412').transaction.flags, account(g).balance, disputeOf(g, 'dsp-0009').state], [summary, [], balance, status], status);
  }
});

test('T14 [W4] offers: three offers in one group; accepting the 150.00 credit enrolls it and makes the other two unavailable, and the credit then posts naming the offer', () => {
  const f = feeWorld();
  assert.deepEqual(f.call('offers.list', {state: 'available'}).items.map(o => [o.id, o.kind, o.group]),
    [['off-0021', 'spend_credit', GROUP], ['off-0022', 'statement_credit', GROUP], ['off-0023', 'product_change', GROUP], ['off-0024', 'bonus_points', null]]);
  assert.deepEqual(f.call('offers.accept', {id: 'off-0022'}), {id: 'off-0022', state: 'enrolled', unavailable: ['off-0021', 'off-0023'], product_id: 'prd-reserve', fee_refund: null});
  assert.deepEqual(['off-0021', 'off-0022', 'off-0023', 'off-0024'].map(id => offerOf(f, id).state), ['unavailable', 'enrolled', 'unavailable', 'available']);
  assert.deepEqual(pick(offerOf(f, 'off-0021'), 'unavailable_at', 'unavailable_cause'), [ny('2026-12-05', '10:00:00'), 'group']);
  unchanged(f, () => f.call('offers.accept', {id: 'off-0021'}), 'invalid_state', 'the second offer after the first is enrolled', 'unavailable');
  unchanged(f, () => f.call('offers.decline', {id: 'off-0022'}), 'invalid_state', 'an enrolled offer');
  unchanged(f, () => f.call('offers.accept', {id: 'off-9999'}), 'not_found', 'an unknown offer');
  // After accept_by: too_late. A declined offer is invalid_state.
  f.advance(ny('2026-12-10', '23:59:59'));
  unchanged(f, () => f.call('offers.accept', {id: 'off-0024'}), 'too_late', 'after accept_by', 'The offer ended at ' + ACCEPT_BY);
  unchanged(f, () => f.call('offers.decline', {id: 'off-0024'}), 'too_late', 'declining after accept_by');
  unchanged(f, () => f.call('offers.accept', {id: 'off-0019'}), 'too_late', 'the expired offer of the seed');
  unchanged(f, () => f.call('offers.accept', {id: 'off-0020'}), 'invalid_state', 'the declined offer of the seed', 'declined');
  // The issuer pays the credit later, as a transaction that names the offer.
  f.event(posted('txn-0462', ny('2026-12-15', '04:00:00'), 'credit', 150, {offer_id: 'off-0022', note: 'Retention offer credit'}));
  assert.deepEqual([offerOf(f, 'off-0022').paid_by, tx(f, 'txn-0462').offer.id, account(f).balance], [['txn-0462'], 'off-0022', 1850]);
  // On another run, declining the third offer changes no other offer.
  const g = feeWorld();
  assert.deepEqual(g.call('offers.decline', {id: 'off-0023'}), {id: 'off-0023', state: 'declined'});
  assert.deepEqual(['off-0021', 'off-0022', 'off-0023'].map(id => offerOf(g, id).state), ['available', 'available', 'declined']);
  unchanged(g, () => g.call('offers.accept', {id: 'off-0023'}), 'invalid_state', 'a declined offer');
  // An offer with no group changes no other offer.
  assert.deepEqual(g.call('offers.accept', {id: 'off-0024'}).unavailable, []);
});

test('T15 [W4] spending offer: progress counts the purchases posted from acceptance to the deadline, less their refunds by the deadline; open, met and missed', () => {
  const f = start();
  f.event(PLAN['ev-br-340']);
  f.advance(ny('2026-12-05', '10:00:00'));
  f.call('offers.accept', {id: 'off-0021'});
  const spend = () => { const o = offerOf(f, 'off-0021'); return [o.spend.progress, o.spend.condition, o.flags]; };
  assert.deepEqual(offerOf(f, 'off-0021').spend, {target: 3000, progress: 0, deadline: '2027-03-06T00:00:00-05:00', condition: 'open'});
  f.event(buy('txn-0470', ny('2026-12-10', '03:00:00'), 'Skyway Air', 2000));
  f.event(buy('txn-0471', ny('2026-12-20', '03:00:00'), 'Harborview Hotel', 1200));
  assert.deepEqual(spend(), [3200, 'met', ['condition_met']]);
  // A refund of a purchase from before the acceptance changes nothing. A refund of a counted purchase before the deadline counts.
  f.event(refund('txn-0472', ny('2026-12-21', '03:00:00'), 'txn-0414', 50, 'Fernhill Hardware'));
  assert.deepEqual(spend(), [3200, 'met', ['condition_met']]);
  f.event(refund('txn-0473', ny('2027-01-05', '03:00:00'), 'txn-0471', 300, 'Harborview Hotel'));
  assert.deepEqual(spend(), [2900, 'open', []]);
  f.event(buy('txn-0474', ny('2027-03-05', '23:00:00'), 'Greenway Market', 100));
  assert.deepEqual(spend(), [3000, 'met', ['condition_met']]);
  f.advance('2027-03-06T00:00:00-05:00');
  assert.deepEqual(spend(), [3000, 'met', ['condition_met']]);
  // After the deadline, a refund and a purchase change nothing.
  f.event(refund('txn-0475', ny('2027-03-10', '03:00:00'), 'txn-0474', 100, 'Greenway Market'));
  f.event(buy('txn-0476', ny('2027-03-10', '04:00:00'), 'Greenway Market', 500));
  assert.deepEqual(spend(), [3000, 'met', ['condition_met']]);
  // Another run: 2,000.00 only. It is open on the last day and missed at the deadline, by the clock alone.
  const g = start();
  g.event(PLAN['ev-br-340']);
  g.advance(ny('2026-12-05', '10:00:00'));
  g.call('offers.accept', {id: 'off-0021'});
  g.event(buy('txn-0470', ny('2026-12-10', '03:00:00'), 'Skyway Air', 2000));
  g.advance(ny('2027-03-05', '23:59:59'));
  assert.deepEqual(offerOf(g, 'off-0021').spend.condition, 'open');
  // The close preview names the offer that a closing would end.
  assert.deepEqual(g.call('account.close_preview').offers_ending.map(o => [o.id, o.state]), [['off-0021', 'enrolled']]);
  const h = fixture({seed: g.data, now: g.ctx.virtual_now});
  g.advance('2027-03-06T00:00:00-05:00');
  assert.deepEqual([offerOf(g, 'off-0021').spend.condition, offerOf(g, 'off-0021').flags], ['missed', ['condition_missed']]);
  // On a closed account a condition that would read open reads missed.
  h.call('account.close', {id: ACCOUNT});
  assert.deepEqual([offerOf(h, 'off-0021').spend.condition, offerOf(h, 'off-0021').flags], ['missed', ['condition_missed']]);
});

test('T16 [W4] product change: accepting the change to the product with no fee moves the account at once and records the fee refund of 550.00; a later closing records nothing more', () => {
  const f = feeWorld();
  assert.deepEqual(f.call('offers.accept', {id: 'off-0023'}), {id: 'off-0023', state: 'enrolled', unavailable: ['off-0021', 'off-0022'], product_id: 'prd-everyday',
    fee_refund: {fee_id: 'txn-0455', amount: 550}});
  const a = account(f);
  assert.deepEqual([a.product.id, a.product.annual_fee, a.product.partners, a.flags.includes('fee_refund_open')], ['prd-everyday', null, [], false]);
  const accepted = f.data.activity.find(row => row.action === 'offers.accept').request_id;
  assert.deepEqual(a.account.fee_refunds, [{fee_id: 'txn-0455', amount: 550, cause: 'product_change', recorded_at: ny('2026-12-05', '10:00:00'), request_id: accepted}]);
  assert.deepEqual(f.data.account.history.map(row => pick(row, 'action', 'from', 'to')), [['product.changed', 'prd-reserve', 'prd-everyday']]);
  assert.deepEqual([f.call('rewards.get').partners, f.call('account.close_preview').fee_refund], [[], null]);
  unchanged(f, () => f.call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1000, member_name: 'Riley Hart'}), 'not_found', 'a partner of the old product');
  // The points stay and can still be redeemed.
  assert.equal(f.call('rewards.redeem', {id: ACCOUNT, points: 1000}).points_left, 11000);
  // The issuer posts the refund itself, as a credit that relates to the fee.
  f.event(posted('txn-0463', ny('2026-12-08', '04:00:00'), 'credit', 550, {relates_to: 'txn-0455', note: 'Annual fee refund'}));
  assert.deepEqual(tx(f, 'txn-0455').related.map(t => [t.id, t.kind]), [['txn-0463', 'credit']]);
  assert.equal(f.call('account.close', {id: ACCOUNT}).fee_refund, null);
  assert.equal(f.data.account.fee_refunds.length, 1);
});

test('T17 [W4] points: 10,000 points redeemed at 1 cent each give a credit of 100.00 and leave 2,000, and a transfer of 2,000 with a step of 1,000 leaves 0', () => {
  const f = start(), redeem = points => () => f.call('rewards.redeem', {id: ACCOUNT, points});
  const transfer = (partner_id, points, more = {}) => () => f.call('rewards.transfer', {id: ACCOUNT, partner_id, points, member_name: 'Riley Hart', ...more});
  unchanged(f, redeem(500), 'below_minimum', 'a redemption of 500 under a minimum of 1,000', 'at least 1,000 points');
  unchanged(f, redeem(13000), 'insufficient_points', 'a redemption of 13,000 with 12,000', 'The points balance is 12,000.');
  unchanged(f, transfer('skyway', 1500), 'invalid_increment', 'a transfer of 1,500 with a step of 1,000', 'steps of 1,000 points');
  unchanged(f, transfer('meridian', 1500), 'below_minimum', 'a transfer under the partner\'s smallest amount', 'at least 2,000 points');
  unchanged(f, transfer('skyway', 700), 'below_minimum', 'below_minimum before invalid_increment');
  unchanged(f, transfer('orbit', 1000), 'not_found', 'an unknown partner', 'no transfer partner');
  unchanged(f, () => f.call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1000}), SCHEMA, 'no member name');
  unchanged(f, () => f.call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1000, member_name: ''}), SCHEMA, 'an empty member name');
  unchanged(f, redeem(0), SCHEMA, 'zero points');
  unchanged(f, () => f.call('rewards.redeem', {id: 'brindle-other', points: 1000}), 'not_found', 'another account');
  assert.deepEqual(f.call('rewards.redeem', {id: ACCOUNT, points: 10000}), {id: 'pts-a0001', points_left: 2000, credit_id: 'txn-a0001', credit_amount: 100});
  assert.deepEqual(pick(tx(f, 'txn-a0001').transaction, 'kind', 'state', 'amount', 'points_entry_id', 'note'), ['credit', 'posted', 100, 'pts-a0001', 'Points redeemed as a statement credit']);
  assert.deepEqual([account(f).balance, f.call('rewards.get').entries[0]], [1200, {...f.call('rewards.get').entries[0], points: -10000, reason: 'redeemed', transaction_id: 'txn-a0001'}]);
  assert.deepEqual(f.call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 2000, member_name: 'Riley Hart'}), {id: 'pts-a0002', points_left: 0, partner_points: 2000});
  assert.deepEqual(f.call('rewards.get').entries[0].transfer, {partner_id: 'skyway', partner_name: 'Skyway Miles', member_name: 'Riley Hart', partner_points: 2000});
  unchanged(f, redeem(500), 'insufficient_points', 'insufficient_points before below_minimum');
  unchanged(f, transfer('skyway', 700), 'insufficient_points', 'insufficient_points before below_minimum, for a transfer');
  // Larch gives 2 partner points for one point.
  const g = start();
  assert.equal(g.call('rewards.transfer', {id: ACCOUNT, partner_id: 'larch', points: 3000, member_name: 'Riley Hart'}).partner_points, 6000);
  assert.equal(g.call('rewards.transfer', {id: ACCOUNT, partner_id: 'meridian', points: 2500, member_name: 'Riley Hart'}).points_left, 6500);
});

test('T17b [W4] points: a redemption credit and a partner\'s points round down', () => {
  const seed = edit(SEED, s => {
    s.issuer.rules.redeem_cents_per_point = 0.5;
    Object.assign(s.products[0].partners[2], {ratio: 1.5, min_points: 1000, step: 1});
  });
  const f = fixture({seed, now: NOW});
  // 1,001 points at half a cent are 5.005, so the credit is 5.00. 1,001 points at 1.5 are 1,501.5, so the partner gets 1,501.
  assert.equal(f.call('rewards.redeem', {id: ACCOUNT, points: 1001}).credit_amount, 5);
  assert.equal(f.call('rewards.transfer', {id: ACCOUNT, partner_id: 'meridian', points: 1001, member_name: 'Riley Hart'}).partner_points, 1501);
});

test('T18 [W4] closing: on 5 December the account closes, one entry forfeits 12,000 points, the fee refund of 550.00 is recorded, and payments and disputes go on', () => {
  const f = feeWorld();
  f.event(offer('off-0025', ny('2026-12-05', '10:00:00'), 'statement_credit', {credit_amount: 25}, 'A statement credit of 25.00 after you accept.', null));
  f.call('offers.accept', {id: 'off-0025'});
  f.call('autopay.set', {id: ACCOUNT, mode: 'statement_balance'});
  f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 100, pay_on: '2026-12-20', source: BANK});
  assert.deepEqual(f.call('account.close_preview').stays_open.credits_owed, ['off-0025']);
  assert.deepEqual(f.call('account.close', {id: ACCOUNT}), {id: ACCOUNT, state: 'closed', points_forfeited: 12000, fee_refund: {fee_id: 'txn-0455', amount: 550}});
  const a = account(f);
  assert.deepEqual([a.account.state, a.account.closed_at, a.account.autopay, a.points_balance, a.flags], ['closed', ny('2026-12-05', '10:00:00'), {mode: 'off', source: BANK}, 0, []]);
  const closing = f.data.activity.find(row => row.action === 'account.close').request_id;
  assert.deepEqual(a.account.fee_refunds, [{fee_id: 'txn-0455', amount: 550, cause: 'closing', recorded_at: ny('2026-12-05', '10:00:00'), request_id: closing}]);
  const forfeit = f.call('rewards.get').entries[0];
  assert.deepEqual(pick(forfeit, 'id', 'points', 'reason'), ['pts-a0001', -12000, 'forfeited']);
  assert.deepEqual(['off-0021', 'off-0022', 'off-0023', 'off-0024', 'off-0025'].map(id => [offerOf(f, id).state, offerOf(f, id).unavailable_cause]),
    [['unavailable', 'closing'], ['unavailable', 'closing'], ['unavailable', 'closing'], ['unavailable', 'closing'], ['enrolled', null]]);
  assert.equal(paymentOf(f, 'pay-0061').state, 'scheduled');
  assert.deepEqual(pick(f.call('account.close_preview'), 'already_closed', 'points_lost', 'fee_refund'), [true, 0, null]);
  // Every write of W4 and autopay.set return invalid_state, before any other error.
  for (const [name, args] of [['offers.accept', {id: 'off-0021'}], ['offers.decline', {id: 'off-0019'}], ['rewards.redeem', {id: ACCOUNT, points: 99000}],
    ['rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1500, member_name: 'Riley Hart'}], ['account.close', {id: ACCOUNT}], ['autopay.set', {id: ACCOUNT, mode: 'minimum_due'}]]) {
    unchanged(f, () => f.call(name, args), 'invalid_state', name, 'closed');
  }
  // Payments and disputes go on, and a credit that the issuer owes posts.
  assert.equal(f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 50, pay_on: '2026-12-06', source: BANK}).state, 'scheduled');
  assert.equal(f.call('payments.cancel', {id: 'pay-0061'}).state, 'cancelled');
  assert.equal(f.call('disputes.open', {id: 'txn-0460', amount: 210, reason: 'not_as_described', note: 'The saw was broken.'}).state, 'open');
  f.event(posted('txn-0464', ny('2026-12-09', '04:00:00'), 'credit', 25, {offer_id: 'off-0025'}));
  f.event(updated('ev-after-close', ny('2026-12-09', '05:00:00'), 'dsp-0010', 'open', {provisional_credit: {transaction_id: 'txn-0465', amount: 210}}));
  assert.equal(recovery(f, 'txn-0460').temporary_credit, 210);
  f.event(statement('stm-2026-12', ny('2027-01-01', '02:00:00'), ny('2026-12-31', '23:59:59'), ny('2027-01-26', '17:00:00'), 1500, 35));
  assert.equal(f.call('statements.get', {id: 'stm-2026-12'}).statement.autopay_payment_id, null);
  // A closed account takes no points, so bonus points that have not arrived are lost.
  unchanged(f, () => f.event(points('pts-0208', ny('2027-01-02', '04:00:00'), 5000, {reason: 'bonus', offer_id: 'off-0024'})), 'invalid_event', 'points added', 'takes no points');
});

test('T18b [W4] closing: a closing on 2 January, 32 days after the fee posted, records no fee refund; a closing with 0 points writes no points entry', () => {
  const f = feeWorld();
  f.advance(ny('2027-01-02', '10:00:00'));
  assert.deepEqual(pick(f.call('account.close', {id: ACCOUNT}), 'points_forfeited', 'fee_refund'), [12000, null]);
  assert.deepEqual(f.data.account.fee_refunds, []);
  // 31 December is the last day.
  const g = feeWorld();
  g.advance(ny('2026-12-31', '23:59:59'));
  assert.equal(g.call('account.close', {id: ACCOUNT}).fee_refund.amount, 550);
  const h = start();
  h.call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 12000, member_name: 'Riley Hart'});
  const entries = h.data.points_entries.length;
  assert.equal(h.call('account.close', {id: ACCOUNT}).points_forfeited, 0);
  assert.equal(h.data.points_entries.length, entries);
});

// The state of the event tests, on 22 December: an open dispute with a temporary credit, a pending and a dropped hold, a scheduled, a posted, a returned
// and a cancelled payment, an enrolled offer in a group, and the ended and withdrawn disputes of the seed.
function eventState() {
  const f = start();
  main(f, 'drop');
  walk(f, {dispute: MAIN.dispute, credit: MAIN.credit, statement: MAIN.statement, points: MAIN.points});
  for (const e of GROUP_OFFERS) f.event(e);
  f.advance(ny('2026-12-05'));
  f.call('offers.accept', {id: 'off-0022'});
  walk(f, {pay: MAIN.pay, paid: MAIN.paid, returned: MAIN.returned});
  f.advance(ny('2026-12-22', '10:00:00'));
  f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 100, pay_on: '2026-12-30', source: BANK});
  f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 10, pay_on: '2026-12-22', source: BANK});
  f.call('payments.cancel', {id: f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 5, pay_on: '2026-12-31', source: BANK}).id});
  f.event(hold('txn-0441', ny('2026-12-22', '11:00:00'), 'Harborview Hotel', 300));
  f.advance(ny('2026-12-22', '12:00:00'));
  return f;
}

test('T19 [All] invalid events: each event of the plan\'s list is rejected with invalid_event, and the data does not change', () => {
  const f = eventState(), T = ny('2026-12-22', '12:00:00');
  const post = (id, kind, amount, more = {}) => posted(id, T, kind, amount, more), EXISTS = 'already exists';
  assert.deepEqual([paymentOf(f, 'pay-0061').state, paymentOf(f, 'pay-0062').state, paymentOf(f, 'pay-0063').state, paymentOf(f, 'pay-0064').state, disputeOf(f, 'dsp-0009').state,
    tx(f, 'txn-0440').transaction.state, tx(f, 'txn-0441').transaction.state], ['returned', 'scheduled', 'posted', 'cancelled', 'open', 'dropped', 'pending']);
  // [the case of the plan, the event, a part of the message of the rule that rejects it]
  const cases = [
    ['a duplicate ID: a posted transaction', post('txn-0412', 'purchase', 10, {merchant: 'Ironworks Gym'}), 'The ID txn-0412 ' + EXISTS],
    ['a duplicate ID: a pending transaction posted again as pending', hold('txn-0441', T, 'Harborview Hotel', 300), 'The ID txn-0441 ' + EXISTS],
    ['a duplicate ID: a dispute ID as a transaction', post('dsp-0007', 'interest', 10), 'The ID dsp-0007 ' + EXISTS],
    ['a duplicate ID: a statement', statement('stm-2026-10', T, ny('2026-12-21'), ny('2027-01-20'), 10, 10), 'The ID stm-2026-10 ' + EXISTS],
    ['a duplicate ID: an offer', offer('off-0019', T, 'bonus_points', {points: 100}, 'Bonus.', 'g-new'), 'The ID off-0019 ' + EXISTS],
    ['a duplicate ID: a points entry', points('pts-0180', T, 100), 'The ID pts-0180 ' + EXISTS],
    ['a duplicate ID: a notification as a points entry', points('ntf-0056', T, 100), 'The ID ntf-0056 ' + EXISTS],
    ['a duplicate ID: a temporary credit', updated('ev-bad', T, 'dsp-0009', 'open', {provisional_credit: {transaction_id: 'txn-0413', amount: 5}}), 'The ID txn-0413 ' + EXISTS],
    ['an unknown reference: a refund for an unknown purchase', post('txn-0480', 'refund', 10, {relates_to: 'txn-9999'}), 'txn-9999, which does not exist'],
    ['an unknown reference: a credit for an unknown offer', post('txn-0480', 'credit', 10, {offer_id: 'off-9999'}), 'off-9999, which does not exist'],
    ['an unknown reference: a reversal for an unknown dispute', post('txn-0480', 'reversal', 10, {dispute_id: 'dsp-9999'}), 'dsp-9999, which does not exist'],
    ['an unknown reference: a drop', event('ev-bad', T, 'transaction.dropped', {transaction_id: 'txn-9999'}), 'a transaction that does not exist'],
    ['an unknown reference: a return', returned('ev-bad', T, 'pay-9999'), 'a payment that does not exist'],
    ['an unknown reference: a dispute update', updated('ev-bad', T, 'dsp-9999', 'open'), 'a dispute that does not exist'],
    ['an unknown reference: a product change to an unknown product', offer('off-0030', T, 'product_change', {product_id: 'prd-gold'}, 'Change.', 'g-new'), 'a product that does not exist'],
    ['an unknown reference: points for an unknown offer', points('pts-0300', T, 100, {offer_id: 'off-9999'}), 'an offer that does not exist'],
    ['a posted transaction of 0.00', post('txn-0480', 'purchase', 0, {merchant: 'Corner Slice'}), 'zero or less'],
    ['a posted transaction below zero', post('txn-0480', 'interest', -5), 'zero or less'],
    ['a pending transaction posted at 0.00', post('txn-0441', 'purchase', 0), 'zero or less'],
    ['a temporary credit of 0.00 in a dispute update', updated('ev-bad', T, 'dsp-0009', 'open', {provisional_credit: {transaction_id: 'txn-0480', amount: 0}}), 'zero or less'],
    ['a temporary credit sent with transaction.posted', post('txn-0480', 'provisional_credit', 40, {relates_to: 'txn-0412'}), 'only with dispute.updated'],
    ['a reversal sent with transaction.posted for an open dispute', post('txn-0480', 'reversal', 40, {dispute_id: 'dsp-0009'}), 'arrives with dispute.updated'],
    ['a drop of a posted transaction', event('ev-bad', T, 'transaction.dropped', {transaction_id: 'txn-0412'}), 'This one is posted.'],
    ['a drop of a dropped transaction', event('ev-bad', T, 'transaction.dropped', {transaction_id: 'txn-0440'}), 'This one is dropped.'],
    ['a return of a scheduled payment', returned('ev-bad', T, 'pay-0062'), 'This one is scheduled.'],
    ['a return of a returned payment', returned('ev-bad', T, 'pay-0061'), 'This one is returned.'],
    ['a return of a cancelled payment', returned('ev-bad', T, 'pay-0064'), 'This one is cancelled.'],
    ['an update to a resolved dispute', updated('ev-bad', T, 'dsp-0007', 'open'), 'The dispute is resolved_for_me.'],
    ['an update to a withdrawn dispute', updated('ev-bad', T, 'dsp-0008', 'resolved_for_me'), 'The dispute is withdrawn.'],
    ['an offer into a group that already has an enrolled offer', offer('off-0030', T, 'bonus_points', {points: 100}, 'Bonus.'), 'already has an enrolled offer']
  ];
  assert.equal(cases.length, 30);
  for (const [label, e, text] of cases) unchanged(f, () => f.event(e), 'invalid_event', label, text);
  // An offer to a closed account, and points added to a closed account.
  const g = start();
  g.call('account.close', {id: ACCOUNT});
  unchanged(g, () => g.event(offer('off-0030', ny('2026-11-10'), 'statement_credit', {credit_amount: 20}, 'Credit.', null)), 'invalid_event', 'an offer to a closed account', 'takes no offers');
  unchanged(g, () => g.event(points('pts-0300', ny('2026-11-10'), 100)), 'invalid_event', 'points added to a closed account', 'takes no points');
  // Core rejects an event dated before the App's current time. tests/mcp.integration.cjs checks it on the real host.
  unchanged(f, () => f.event(points('pts-0300', ny('2026-12-21'), 100)), 'invalid_event', 'an event before the clock', 'cannot move backwards');
  // The same events with the fault removed are applied: a posting event for a pending transaction reuses its ID, and a reversal arrives for an ended dispute.
  for (const e of [posted('txn-0441', T, 'purchase', 280), post('txn-0480', 'reversal', 40, {dispute_id: 'dsp-0008'}), returned('ev-ok', T, 'pay-0063'),
    offer('off-0030', T, 'bonus_points', {points: 100}, 'Bonus.', 'g-new'), updated('ev-ok-2', T, 'dsp-0009', 'resolved_for_me')]) f.event(e);
});
test('T19b [All] invalid events: each structure check that the package adds is rejected, with invalid_event or by the event schema, and the data does not change', () => {
  const f = eventState(), T = ny('2026-12-22', '12:00:00'), post = (id, kind, amount, more = {}) => posted(id, T, kind, amount, more);
  const cases = [
    ['three decimals in a posted amount', post('txn-0480', 'purchase', 10.005, {merchant: 'Corner Slice'}), 'invalid_event', 'more than two decimals'],
    ['three decimals in a statement balance', statement('stm-2026-12', T, ny('2026-12-21'), ny('2027-01-20'), 10.001, 10), 'invalid_event', 'more than two decimals'],
    ['three decimals in a minimum due', statement('stm-2026-12', T, ny('2026-12-21'), ny('2027-01-20'), 10, 0.001), 'invalid_event', 'more than two decimals'],
    ['an offer credit of 0.00', offer('off-0030', T, 'statement_credit', {credit_amount: 0}, 'Credit.', null), 'invalid_event', 'zero or less'],
    ['an offer spending target below zero', offer('off-0030', T, 'spend_credit', {credit_amount: 10, spend_target: -1, spend_days: 30}, 'Spend.', null), 'invalid_event', 'zero or less'],
    ['one ID for the temporary credit and the reversal', updated('ev-bad', T, 'dsp-0009', 'open', {provisional_credit: {transaction_id: 'txn-0480', amount: 5},
      reversal: {transaction_id: 'txn-0480', amount: 5}}), 'invalid_event', 'use one ID'],
    // The seed rules run after every event.
    ['points taken below zero', points('pts-0300', T, -20000, {reason: 'adjustment'}), 'invalid_event', 'below zero'],
    ['a statement due before its closing time', statement('stm-2026-12', T, ny('2026-12-21'), ny('2026-12-20'), 10, 10), 'invalid_event', 'due before its closing time'],
    ['a refund for a fee', post('txn-0480', 'refund', 10, {relates_to: 'txn-0431'}), 'invalid_event', 'relates to no purchase'],
    ['a refund for nothing', post('txn-0480', 'refund', 10), 'invalid_event', 'relates to no purchase'],
    ['a points entry of 0', points('pts-0300', T, 0), 'invalid_event', 'zero points'],
    // The event schema.
    ['a fee with no fee type', post('txn-0480', 'fee', 10), EVENT_SCHEMA, ''],
    ['a reversal with relates_to', post('txn-0480', 'reversal', 10, {dispute_id: 'dsp-0008', relates_to: 'txn-0384'}), EVENT_SCHEMA, ''],
    ['a reversal with no dispute', post('txn-0480', 'reversal', 10), EVENT_SCHEMA, ''],
    ['an offer on a purchase', post('txn-0480', 'purchase', 10, {offer_id: 'off-0022'}), EVENT_SCHEMA, ''],
    ['a spending offer with no target', offer('off-0030', T, 'spend_credit', {credit_amount: 10, spend_days: 30}, 'Spend.', null), EVENT_SCHEMA, ''],
    ['points with an App reason', points('pts-0300', T, 100, {reason: 'redeemed'}), EVENT_SCHEMA, ''],
    ['a time with no UTC offset', {...points('pts-0300', T, 100), at: '2026-12-22T12:00:00'}, EVENT_SCHEMA, ''],
    ['a time in the year 3000', {...points('pts-0300', T, 100), at: '3000-01-01T00:00:00-05:00'}, EVENT_SCHEMA, '']
  ];
  for (const [label, e, code, text] of cases) unchanged(f, () => f.event(e), code, label, text);
  assert.ok(eventSchema(points('pts-0300', '2999-12-31T00:00:00-05:00', 100)) && !eventSchema(points('pts-0300', '1969-12-31T00:00:00-05:00', 100)));
});

// The rich state of the seed-rule tests: every kind of record and every stored state of a payment, a dispute, an offer and a points entry.
function seedState() {
  const f = start();
  f.call('autopay.set', {id: ACCOUNT, mode: 'statement_balance'});
  main(f, 'refund');
  f.event(posted('txn-0440', ny('2026-11-10', '03:00:00'), 'purchase', 48.2));
  f.event(hold('txn-0441', ny('2026-11-10', '18:00:00'), 'Harborview Hotel', 300));
  f.event(event('ev-drop-0441', ny('2026-11-11', '03:00:00'), 'transaction.dropped', {transaction_id: 'txn-0441', reason: 'Released.'}));
  walk(f, {dispute: MAIN.dispute, credit: MAIN.credit});
  f.call('disputes.open', {id: 'txn-0413', amount: 120.35, reason: 'not_as_described', note: 'The order was wrong.'});
  f.event(updated('ev-credit-0010', ny('2026-11-16', '09:00:00'), 'dsp-0010', 'open', {provisional_credit: {transaction_id: 'txn-0451', amount: 120.35}}));
  f.event(updated('ev-end-0010', ny('2026-11-20', '10:00:00'), 'dsp-0010', 'resolved_for_merchant', {reversal: {transaction_id: 'txn-0452', amount: 120.35}}));
  f.event(PLAN['ev-br-310']);
  f.event(ANNUAL_FEE);
  for (const e of [PLAN['ev-br-350'], ...GROUP_OFFERS]) f.event(e);
  f.event(offer('off-0024', ny('2026-12-03', '15:25:00'), 'product_change', {product_id: 'prd-everyday'}, 'Change to Brindle Everyday.', null));
  f.advance(ny('2026-12-05', '10:00:00'));
  f.call('offers.accept', {id: 'off-0022'});
  f.call('rewards.redeem', {id: ACCOUNT, points: 1000});
  f.call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1000, member_name: 'Riley Hart'});
  f.call('offers.accept', {id: 'off-0024'});
  f.call('payments.cancel', {id: f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 100, pay_on: '2026-12-06', source: BANK}).id});
  const returnedId = f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 200, pay_on: '2026-12-05', source: BANK}).id;
  f.event(returned('ev-return', ny('2026-12-06', '09:00:00'), returnedId));
  f.event(posted('txn-0462', ny('2026-12-07', '04:00:00'), 'credit', 150, {offer_id: 'off-0022'}));
  f.event(points('pts-0208', ny('2026-12-07', '05:00:00'), 500, {reason: 'bonus'}));
  f.advance(ny('2026-12-08'));
  return f;
}

test('T19d [All] seed rules: validateSeed rejects each seed of the plan\'s list, and each seed that breaks a rule that the package adds, with invalid_seed', () => {
  const f = seedState(), base = f.data, ctx = f.ctx;
  plugin.validateSeed(ctx, base);
  assert.deepEqual([base.payments.map(p => p.stored_state).sort(), base.disputes.map(d => d.state), base.transactions.filter(t => t.state === 'dropped').length,
    base.offers.map(o => o.stored_state), base.points_entries.map(e => e.reason).slice(-4), base.account.fee_refunds.length],
  [['cancelled', 'returned', 'scheduled', 'scheduled', 'scheduled', 'scheduled'], ['resolved_for_me', 'withdrawn', 'open', 'resolved_for_merchant'], 1,
    ['available', 'declined', 'unavailable', 'enrolled', 'unavailable', 'enrolled'], ['earned', 'redeemed', 'transferred', 'bonus'], 1]);
  const by = (list, id) => list.find(x => x.id === id);
  const t = (s, id) => by(s.transactions, id), pay = (s, id) => by(s.payments, id), dsp = (s, id) => by(s.disputes, id), off = (s, id) => by(s.offers, id);
  const stm = (s, id) => by(s.statements, id), entry = (s, reason) => s.points_entries.find(e => e.reason === reason);
  const autopay = s => s.payments.find(p => p.autopay), cancelledPay = s => s.payments.find(p => p.stored_state === 'cancelled');
  const returnedPay = s => s.payments.find(p => p.stored_state === 'returned');
  const DECIMALS = 'more than two decimals', TX_STATE = 'does not fit its posting and drop times', PAY_STATE = 'does not fit its cancel and return times';
  const OFFER_STATE = 'The state of an offer does not fit its fields', DISPUTE_STATE = 'does not fit its withdrawal and end times';
  // [the rule, the change that breaks it, a part of the message of the rule]
  const rules = [
    // The plan's list.
    ['duplicate IDs: two transactions', s => { t(s, 'txn-0413').id = 'txn-0412'; }, 'The ID txn-0412 is used twice'],
    ['duplicate IDs: a product and a statement', s => { s.products[0].id = 'stm-2026-10'; }, 'is used twice'],
    ['duplicate IDs: a notification and a payment', s => { s.notifications[0].id = 'pay-0058'; }, 'The ID pay-0058 is used twice'],
    ['a reference to an unknown product', s => { s.account.product_id = 'prd-gold'; }, 'names a product that does not exist'],
    ['a reference to an unknown transaction', s => { t(s, 'txn-0431').relates_to = 'txn-9999'; }, 'relates to a transaction that does not exist'],
    ['a reference to an unknown dispute', s => { t(s, 'txn-0450').dispute_id = 'dsp-9999'; }, 'names a dispute that does not exist'],
    ['a reference to an unknown offer from a credit', s => { t(s, 'txn-0462').offer_id = 'off-9999'; }, 'Only a credit names an offer, and the offer must exist'],
    ['a reference to an unknown offer from a points entry', s => { entry(s, 'bonus').offer_id = 'off-9999'; }, 'A points entry names an offer that does not exist'],
    ['a reference to an unknown statement', s => { pay(s, 'pay-0060').statement_id = 'stm-2099-01'; }, 'A payment names a statement that does not exist'],
    ['a reference to an unknown product from an offer', s => { off(s, 'off-0023').product_id = 'prd-gold'; }, 'An offer names a product that does not exist'],
    ['a reference to an unknown partner', s => { entry(s, 'transferred').transfer.partner_id = 'orbit'; }, 'A transfer names a partner that does not exist'],
    ['a reference to an unknown fee', s => { s.account.fee_refunds[0].fee_id = 'txn-9999'; }, 'A fee refund names a fee that is not an annual fee'],
    ['a reference to an unknown object from a notification', s => { s.notifications[3].object_id = 'nothing'; }, 'A notification names an object that does not exist'],
    ['a reference to an unknown object from an activity row', s => { s.activity[0].object_id = 'nothing'; }, 'An activity row names an object that does not exist'],
    ['a reference to an unknown transaction from a dispute history row', s => { dsp(s, 'dsp-0009').history[1].credit_id = 'txn-9999'; }, 'A dispute history row names a transaction'],
    ['a timestamp without a UTC offset', s => { t(s, 'txn-0412').posted_at = '2026-11-02T06:00:00'; }, 'A timestamp has no UTC offset'],
    ['a timestamp without a UTC offset in a history row', s => { dsp(s, 'dsp-0009').history[0].at = '2026-11-13T20:00:00'; }, 'A timestamp has no UTC offset'],
    ['an account that the binding does not declare', s => { s.account_id = 'brindle-other'; }, 'Account and owner must exist in the supplied binding'],
    ['an owner that the binding does not declare', s => { s.owner_person_id = 'person-other'; }, 'Account and owner must exist in the supplied binding'],
    ['a refund that relates to no purchase', s => { t(s, 'txn-0431').relates_to = 'txn-0455'; }, 'A refund, temporary credit or reversal relates to no purchase'],
    ['a refund that relates to nothing', s => { t(s, 'txn-0431').relates_to = null; }, 'A refund, temporary credit or reversal relates to no purchase'],
    ['a temporary credit that relates to no purchase', s => { t(s, 'txn-0450').relates_to = null; }, 'relates to no purchase'],
    ['a reversal that relates to no purchase', s => { t(s, 'txn-0452').relates_to = 'txn-0431'; }, 'relates to no purchase'],
    ['a temporary credit that names no dispute', s => { t(s, 'txn-0450').dispute_id = null; }, 'A temporary credit or reversal names its dispute'],
    ['a reversal that names no dispute', s => { t(s, 'txn-0452').dispute_id = null; }, 'A temporary credit or reversal names its dispute'],
    ['two open disputes on one purchase', s => { dsp(s, 'dsp-0010').transaction_id = 'txn-0412'; Object.assign(dsp(s, 'dsp-0010'), {state: 'open', ended_at: null});
      dsp(s, 'dsp-0010').history.pop(); t(s, 'txn-0451').relates_to = 'txn-0412'; t(s, 'txn-0452').relates_to = 'txn-0412'; }, 'A purchase has two open disputes'],
    ['a dispute opened after the issuer ended an earlier one', s => { s.disputes.push({...structuredClone(dsp(s, 'dsp-0008')), id: 'dsp-0011', transaction_id: 'txn-0413',
      opened_at: ny('2026-12-01')}); s.disputes[s.disputes.length - 1].history[0].at = ny('2026-12-01'); }, 'after the issuer ended an earlier one'],
    ['a dispute on a transaction that is not a posted purchase: a refund', s => { dsp(s, 'dsp-0008').transaction_id = 'txn-0431'; }, 'A dispute is on a transaction that is not a posted purchase'],
    ['a dispute on a pending purchase', s => { s.disputes.push({...structuredClone(dsp(s, 'dsp-0008')), id: 'dsp-0011', transaction_id: 'txn-0441'}); },
      'A dispute is on a transaction that is not a posted purchase'],
    ['two enrolled offers in one group', s => { Object.assign(off(s, 'off-0021'), {stored_state: 'enrolled', enrolled_at: ny('2026-12-05'), unavailable_at: null, unavailable_cause: null}); },
      'Two offers of one group are enrolled'],
    ['a points balance below zero', s => { entry(s, 'redeemed').points = -20000; }, 'The points balance is below zero'],
    ['a payment with an amount of zero', s => { pay(s, 'pay-0060').scheduled_amount = 0; }, 'A payment has an amount of zero or less'],
    ['a payment with an amount below zero', s => { pay(s, 'pay-0060').scheduled_amount = -5; }, 'A payment has an amount of zero or less'],
    ['a statement due before its closing time', s => { stm(s, 'stm-2026-10').due_at = ny('2026-10-31', '12:00:00'); }, 'A statement is due before its closing time'],
    // Units.
    ['three decimals in a transaction amount', s => { t(s, 'txn-0412').amount = 60.001; }, DECIMALS],
    ['three decimals in a held amount', s => { t(s, 'txn-0440').pending_amount = 150.001; }, DECIMALS],
    ['three decimals in a statement', s => { stm(s, 'stm-2026-10').minimum_due = 35.001; }, DECIMALS],
    ['three decimals in a payment', s => { pay(s, 'pay-0060').scheduled_amount = 709.201; }, DECIMALS],
    ['three decimals in a dispute', s => { dsp(s, 'dsp-0009').amount = 40.001; }, DECIMALS],
    ['three decimals in an offer', s => { off(s, 'off-0022').credit_amount = 150.001; }, DECIMALS],
    ['three decimals in the credit limit', s => { s.account.credit_limit = 8000.001; }, DECIMALS],
    ['three decimals in the annual fee', s => { s.products[0].annual_fee = 550.001; }, DECIMALS],
    ['three decimals in a partner ratio', s => { s.products[0].partners[0].ratio = 1.001; }, DECIMALS],
    ['three decimals in the redemption rate', s => { s.issuer.rules.redeem_cents_per_point = 1.001; }, DECIMALS],
    ['three decimals in a fee refund', s => { s.account.fee_refunds[0].amount = 550.001; }, DECIMALS],
    ['an unknown issuer time zone', s => { s.issuer.timezone = 'Mars/Olympus'; }, 'A time zone is unknown'],
    ['an unknown preference time zone', s => { s.preferences.timezone = '+05:00'; }, 'A time zone is unknown'],
    // The structure rules that the package adds.
    ['a product that names one partner twice', s => { s.products[0].partners[1].id = 'skyway'; }, 'names one transfer partner ID twice'],
    ['a closed account with no closing time', s => { s.account.state = 'closed'; s.account.autopay.mode = 'off'; }, 'A closed account has its closing time and autopay off'],
    ['a closed account with autopay on', s => { s.account.state = 'closed'; s.account.closed_at = ny('2026-12-07'); }, 'A closed account has its closing time and autopay off'],
    ['an open account with a closing time', s => { s.account.closed_at = ny('2026-12-07'); }, 'A closed account has its closing time and autopay off'],
    ['a posted transaction with no posting time', s => { t(s, 'txn-0412').posted_at = null; }, TX_STATE],
    ['a pending transaction with a posting time', s => { t(s, 'txn-0441').state = 'pending'; t(s, 'txn-0441').dropped_at = null; t(s, 'txn-0441').posted_at = ny('2026-11-11'); }, TX_STATE],
    ['a dropped transaction with no drop time', s => { t(s, 'txn-0441').dropped_at = null; }, TX_STATE],
    ['a pending transaction with a drop time', s => { t(s, 'txn-0441').state = 'pending'; }, TX_STATE],
    ['a held amount on a transaction that has not posted', s => { t(s, 'txn-0441').pending_amount = 300; }, 'Only a posted transaction keeps a held amount'],
    ['a fee with no fee type', s => { t(s, 'txn-0455').fee_type = null; }, 'A fee has its fee type'],
    ['a fee type on a purchase', s => { t(s, 'txn-0412').fee_type = 'other'; }, 'A fee has its fee type'],
    ['an offer named by a purchase', s => { t(s, 'txn-0412').offer_id = 'off-0022'; }, 'Only a credit names an offer'],
    ['a dispute named by a purchase', s => { t(s, 'txn-0413').dispute_id = 'dsp-0010'; }, 'A temporary credit or reversal names its dispute, and other transactions name none'],
    ['a temporary credit that names a dispute of another purchase', s => { t(s, 'txn-0450').dispute_id = 'dsp-0010'; }, 'or one of another purchase'],
    ['a redemption credit with no entry that names it back', s => { entry(s, 'redeemed').transaction_id = null; }, 'A credit names a points entry that does not name it back'],
    ['a redemption entry with no credit that names it back', s => { t(s, 'txn-a0001').points_entry_id = null; }, 'A points entry names a credit that does not name it back'],
    ['a payment day that is not a calendar date', s => { pay(s, 'pay-0060').pay_on = '2026-11-31'; }, 'A payment day is not a real calendar date'],
    ['a statement that names a manual payment as its autopay payment', s => { stm(s, 'stm-2026-10').autopay_payment_id = 'pay-0060'; }, 'does not name it back'],
    ['an autopay payment that its statement does not name', s => { stm(s, autopay(s).statement_id).autopay_payment_id = null; }, 'An autopay payment names its statement'],
    ['an autopay payment with no statement', s => { autopay(s).statement_id = null; }, 'names an autopay payment that does not name it back'],
    ['a cancelled payment with no cancel time', s => { cancelledPay(s).cancelled_at = null; }, PAY_STATE],
    ['a scheduled payment with a return time', s => { autopay(s).returned_at = ny('2026-12-07'); }, PAY_STATE],
    ['a payment cancelled after the start of its day', s => { cancelledPay(s).cancelled_at = ny('2026-12-06', '01:00:00'); }, 'cancelled after the start of its day'],
    ['a payment returned before it posted', s => { returnedPay(s).returned_at = ny('2026-12-05', '09:00:00'); }, 'returned before it posted'],
    ['a dispute whose state is not the last status of its history', s => { dsp(s, 'dsp-0009').state = 'resolved_for_me'; dsp(s, 'dsp-0009').ended_at = ny('2026-12-01'); },
      'not the last status of its history'],
    ['a withdrawn dispute with no withdrawal time', s => { dsp(s, 'dsp-0008').withdrawn_at = null; }, DISPUTE_STATE],
    ['an ended dispute with no end time', s => { dsp(s, 'dsp-0010').ended_at = null; }, DISPUTE_STATE],
    ['an offer without the fields of its kind', s => { off(s, 'off-0022').credit_amount = null; }, 'An offer does not have the fields of its kind'],
    ['an offer with a field of another kind', s => { off(s, 'off-0022').points = 100; }, 'An offer does not have the fields of its kind'],
    ['an enrolled offer with no enrolment time', s => { off(s, 'off-0022').enrolled_at = null; }, OFFER_STATE],
    ['an unavailable offer with no cause', s => { off(s, 'off-0021').unavailable_cause = null; }, OFFER_STATE],
    ['a declined offer with no decline time', s => { off(s, 'off-0020').declined_at = null; }, OFFER_STATE],
    ['a points entry of 0', s => { entry(s, 'bonus').points = 0; }, 'A points entry has zero points'],
    ['a forfeited entry that adds points', s => { entry(s, 'transferred').points = 1000; }, 'takes points off'],
    ['a transferred entry with no transfer', s => { entry(s, 'transferred').transfer = null; }, 'A transferred entry has its transfer'],
    ['a transfer on an earned entry', s => { entry(s, 'earned').transfer = structuredClone(entry(s, 'transferred').transfer); }, 'A transferred entry has its transfer'],
    ['a fee refund for a fee that is not annual', s => { t(s, 'txn-0455').fee_type = 'other'; }, 'not an annual fee'],
    ['two fee refunds for one fee', s => { s.account.fee_refunds.push(structuredClone(s.account.fee_refunds[0])); }, 'or one fee twice'],
    ['activity rows that are not in order', s => { s.activity[1].seq = s.activity[0].seq; }, 'The activity rows are not in order']
  ];
  assert.equal(rules.length, 86);
  for (const [rule, change, text] of rules) {
    assert.throws(() => plugin.validateSeed(ctx, edit(base, change)), error => {
      assert.deepEqual([error.code, error.message.includes(text)], ['invalid_seed', true], rule + ': ' + error.message);
      return true;
    }, rule);
  }
  // Valid history: a seed may hold a dispute opened after its window, a reversal larger than its credit, and a credit limit of 0.00.
  plugin.validateSeed(ctx, edit(base, s => { dsp(s, 'dsp-0009').opened_at = ny('2027-03-01'); }));
  plugin.validateSeed(ctx, edit(base, s => { t(s, 'txn-0452').amount = 500; }));
  plugin.validateSeed(ctx, edit(base, s => { s.account.credit_limit = 0; }));
  // Stored times need years 1970 to 2999: the seed schema refuses others.
  for (const year of ['1969', '3000']) assert.throws(() => fixture({seed: edit(SEED, s => { s.transactions[0].posted_at = year + '-01-01T00:00:00-05:00'; }), now: NOW}), /Seed schema/, year);
  fixture({seed: edit(SEED, s => { s.transactions[0].posted_at = '2999-01-01T00:00:00-05:00'; }), now: NOW});
});

test('T19e [All] seed rules never make a valid write or event fail: a fixed walk of writes, events and clock moves commits each valid step', () => {
  // A fixed pseudo-random walk, the same on every run. Each write is valid by its arguments. It commits, or the App refuses it with an error of the table.
  // A seed rule that a valid write breaks would show as invalid_seed. Each event is built to be valid, so it must commit.
  let state = 20261109;
  const random = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const choose = list => list[Math.floor(random() * list.length)], between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const f = fixture({seed: SEED, now: NOW, logging: false}), counts = {writes: 0, refused: 0, events: 0, moves: 0}, codes = new Set();
  const hour = 3600000, at = instant => new Date(instant - 5 * hour).toISOString().slice(0, 19) + '-05:00';
  const dayOf = instant => at(instant).slice(0, 10), plusDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 24 * hour).toISOString().slice(0, 10);
  let made = 0;
  for (let step = 0; step < 400; step++) {
    const data = f.data, now = Date.parse(f.ctx.virtual_now), today = dayOf(now), roll = random(), open = data.account.state === 'open';
    const purchases = data.transactions.filter(t => t.kind === 'purchase');
    if (step === 330) f.call('account.close', {id: ACCOUNT});
    if (roll < 0.15 && now < Date.parse(ny('2027-03-01'))) {
      f.advance(at(now + between(1, 72) * hour));
      plugin.validateSeed(f.ctx, f.data);
      counts.moves++;
      continue;
    }
    if (roll < 0.55) {
      const writes = [
        ['payments.schedule', {id: ACCOUNT, amount_type: choose(['minimum_due', 'statement_balance', 'current_balance']), pay_on: plusDays(today, between(-1, 20)), source: BANK}],
        ['payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: between(1, 400), pay_on: plusDays(today, between(-1, 20)), source: BANK}],
        ['payments.cancel', {id: choose(data.payments).id}],
        ['autopay.set', {id: ACCOUNT, mode: choose(['off', 'minimum_due', 'statement_balance'])}],
        ['disputes.open', {id: choose(purchases).id, amount: between(1, 80), reason: choose(REASONS), note: 'Please check this charge.'}],
        ['disputes.withdraw', {id: choose(data.disputes).id}],
        ['offers.accept', {id: choose(data.offers).id}],
        ['offers.decline', {id: choose(data.offers).id}],
        ['rewards.redeem', {id: ACCOUNT, points: choose([500, 1000, 2500])}],
        ['rewards.transfer', {id: ACCOUNT, partner_id: choose(['skyway', 'larch', 'meridian']), points: choose([700, 1000, 1500, 2000]), member_name: 'Riley Hart'}],
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
    const id = 'walk-' + (++made), when = at(now), pending = data.transactions.filter(t => t.state === 'pending');
    const postedPayments = f.call('payments.list', {state: 'posted'}).items, openDisputes = data.disputes.filter(d => d.state === 'open');
    const credited = data.disputes.filter(d => d.state !== 'open' && data.transactions.some(t => t.dispute_id === d.id && t.kind === 'provisional_credit'));
    const enrolledGroups = new Set(data.offers.filter(o => o.stored_state === 'enrolled').map(o => o.group));
    const balance = f.call('rewards.get').balance, owed = f.call('account.get').balance, group = choose(['g-1', 'g-2', null]);
    const candidates = [
      buy('txn-' + id, when, choose(['Greenway Market', 'Corner Slice', 'Skyway Air']), between(5, 300)),
      hold('txn-' + id, when, 'Northgate Fuel', 150),
      pending.length > 0 && posted(choose(pending).id, when, 'purchase', between(20, 160), {note: 'Final amount.'}),
      pending.length > 0 && event('ev-' + id, when, 'transaction.dropped', {transaction_id: choose(pending).id}),
      refund('txn-' + id, when, choose(purchases.filter(t => t.state === 'posted')).id, between(1, 30), 'Greenway Market'),
      (kind => kind === 'fee' ? posted('txn-' + id, when, 'fee', 29, {fee_type: choose(['annual', 'other'])}) : posted('txn-' + id, when, kind, between(1, 40)))(choose(['fee', 'interest', 'credit'])),
      statement('stm-' + id, when, at(now - 1000), at(now + 20 * 24 * hour), owed, Math.max(0, Math.min(35, owed))),
      postedPayments.length > 0 && returned('ev-' + id, when, choose(postedPayments).id),
      openDisputes.length > 0 && (d => updated('ev-' + id, when, d.id, choose(['open', 'resolved_for_me', 'resolved_for_merchant', 'closed_matched']),
        random() < 0.6 ? {provisional_credit: {transaction_id: 'txn-' + id, amount: d.amount}} : {}))(choose(openDisputes)),
      credited.length > 0 && posted('txn-' + id, when, 'reversal', between(1, 20), {dispute_id: choose(credited).id}),
      open && !enrolledGroups.has(group) && (kind => offer('off-' + id, when, kind, {accept_by: at(now + 5 * 24 * hour), ...(kind === 'bonus_points' ? {points: 1000} : {credit_amount: 25})},
        'Walk offer.', group))(choose(['statement_credit', 'bonus_points'])),
      open && points('pts-' + id, when, between(1, 900)),
      balance >= 100 && points('pts-' + id, when, -between(1, 100), {reason: 'adjustment'})
    ].filter(Boolean);
    f.event(choose(candidates));
    counts.events++;
  }
  // The walk commits many writes and events, and the App refuses some writes for the rules of the table.
  assert.ok(counts.writes >= 50 && counts.events >= 150 && counts.moves >= 40 && counts.refused >= 40, JSON.stringify(counts));
  assert.ok(codes.size >= 8, [...codes].join(', '));
  assert.ok(f.data.statements.length >= 10, 'statements: ' + f.data.statements.length);
});

test('T19f [All] notifications: one for each applied event, none for a drop or a purchase posting, and none for the account holder\'s own writes or a change of time', () => {
  const f = start(), seeded = SEED.notifications.map(n => n.id);
  main(f, 'returned');
  f.advance(ny('2026-12-23'));
  const written = f.data.notifications.slice(seeded.length);
  assert.deepEqual(written.map(n => pick(n, 'id', 'kind', 'event_id', 'object_type', 'object_id', 'at')), [
    ['ntf-0057', 'transaction.posted', 'ev-br-301', 'transaction', 'txn-0431', PLAN['ev-br-301'].at],
    ['ntf-0058', 'dispute.updated', 'ev-br-330', 'dispute', 'dsp-0009', PLAN['ev-br-330'].at],
    ['ntf-0059', 'statement.issued', 'ev-br-310', 'statement', 'stm-2026-11', PLAN['ev-br-310'].at],
    ['ntf-0060', 'points.adjusted', 'ev-br-350', 'points_entry', 'pts-0207', PLAN['ev-br-350'].at],
    ['ntf-0061', 'offer.issued', 'ev-br-340', 'offer', 'off-0021', PLAN['ev-br-340'].at],
    ['ntf-0062', 'payment.returned', 'ev-br-320', 'payment', 'pay-0061', PLAN['ev-br-320'].at]]);
  assert.deepEqual(written.map(n => n.title), ['A refund of 20.00 from Ironworks Gym has posted', 'We added a temporary credit of 40.00 while we review your dispute',
    'Your statement is ready: 1,240.00 is due on 26 December', '1,240 points were added', 'You have a new offer', 'Your payment of 1,240.00 was returned']);
  assert.equal(written[2].text, 'Your statement stm-2026-11 closed on 30 November. The statement balance is 1,240.00, and the minimum due is 35.00. Pay by 26 December at 17:00. Autopay is off for this statement.');
  // The list shows each notification from the moment it is written, by its day.
  assert.deepEqual(f.call('notifications.list', {start: '2026-12-02', end: '2026-12-03'}).items.map(n => n.id), ['ntf-0060', 'ntf-0061']);
  // The other kinds of transaction, and the end of a dispute. A day of another year shows its year.
  const g = start();
  g.call('preferences.update', {email_notices: false});
  g.call('autopay.set', {id: ACCOUNT, mode: 'minimum_due'});
  main(g, 'credit');
  g.event(ANNUAL_FEE);
  g.event(posted('txn-0456', ny('2026-12-01', '04:00:00'), 'fee', 29, {fee_type: 'other'}));
  g.event(posted('txn-0457', ny('2026-12-01', '04:10:00'), 'interest', 12.5));
  g.event(posted('txn-0458', ny('2026-12-01', '04:20:00'), 'credit', 25));
  g.event(updated('ev-mine', ny('2027-01-05', '10:00:00'), 'dsp-0009', 'resolved_for_merchant'));
  g.event(posted('txn-0459', ny('2027-01-05', '11:00:00'), 'reversal', 40, {dispute_id: 'dsp-0009'}));
  g.event(refund('txn-0466', ny('2027-01-06', '04:00:00'), 'txn-0412', 40, 'Ironworks Gym'));
  g.event(points('pts-0209', ny('2027-01-07', '04:00:00'), -200, {reason: 'adjustment'}));
  g.event(hold('txn-0468', ny('2027-01-07', '04:30:00'), 'Northgate Fuel', 150));
  g.event(event('ev-drop', ny('2027-01-07', '05:00:00'), 'transaction.dropped', {transaction_id: 'txn-0468'}));
  g.event(buy('txn-0467', ny('2027-01-07', '06:00:00'), 'Corner Slice', 20));
  g.event(statement('stm-2026-12', ny('2027-01-08', '02:00:00'), ny('2026-12-31', '23:59:59'), ny('2027-01-26', '17:00:00'), 600, 35));
  const later = g.data.notifications.slice(seeded.length + 2);
  assert.deepEqual(later.map(n => n.title), ['Your annual fee of 550.00 has posted', 'A fee of 29.00 has posted', 'Interest of 12.50 has posted', 'A credit of 25.00 has posted',
    'Your dispute was resolved in the merchant\'s favor', 'We took back the temporary credit of 40.00', 'A refund of 40.00 from Ironworks Gym has posted', '200 points were taken off', 'Your statement is ready: 600.00 is due on 26 January']);
  assert.match(later[0].text, /If you close the account by 31 December, the fee is refunded\./);
  assert.match(later[4].text, /about the charge of 60\.00 from Ironworks Gym on 2 November 2026\..*resolved in the merchant's favor/);
  assert.match(later[5].text, /took back 40\.00 of the temporary credit for your dispute dsp-0009\. It is for the charge of 60\.00 from Ironworks Gym on 2 November 2026\./);
  assert.match(later[6].text, /It is for the charge of 60\.00 from Ironworks Gym on 2 November 2026\./);
  assert.match(later[8].text, /Autopay will pay 35\.00 on 26 January, less any payment you make toward this statement before that day\./);
  // The four ends of a dispute have their own titles.
  for (const [status, title] of [['resolved_for_me', 'Your dispute was resolved in your favor'], ['closed_matched', 'Your dispute was closed because the merchant refunded you'],
    ['open', 'We have an update on your dispute']]) {
    const h = start();
    main(h, 'credit');
    h.event(updated('ev-end', ny('2026-11-20'), 'dsp-0009', status, {note: 'We asked the merchant for a receipt.'}));
    assert.equal(h.data.notifications[h.data.notifications.length - 1].title, title, status);
  }
  // A rejected event writes no notification.
  unchanged(g, () => g.event(updated('ev-bad', ny('2027-01-09'), 'dsp-0009', 'open')), 'invalid_event');
  assert.equal(g.data.notifications.length, seeded.length + 2 + later.length);
});

test('T19n [All] notifications: a pending refund writes a notice that says it is pending, and its posting writes one more', () => {
  const f = start();
  f.event(event('ev-txn-0433', ny('2026-11-10', '04:00:00'), 'transaction.posted', {transaction_id: 'txn-0433', kind: 'refund', state: 'pending', amount: 15, merchant: 'Parcelbox Online', relates_to: 'txn-0418'}));
  f.event(posted('txn-0433', ny('2026-11-11', '04:00:00'), 'refund', 15));
  const [pending, done] = f.data.notifications.slice(-2);
  assert.equal(pending.title, 'A pending refund of 15.00 was added');
  assert.match(pending.text, /It does not count in your balance until it posts\./);
  assert.equal(done.title, 'A refund of 15.00 from Parcelbox Online has posted');
});

test('T19g [All] notifications: the wire message for Mail is stored only while email_notices is on, and it passes Mail\'s wire schema', () => {
  const f = start();
  f.event(PLAN['ev-br-301']);
  f.call('preferences.update', {email_notices: false});
  f.event(PLAN['ev-br-310']);
  f.call('preferences.update', {email_notices: true});
  f.event(PLAN['ev-br-340']);
  const [on, off, again] = f.data.notifications.slice(-3);
  assert.deepEqual([on.email !== null, off.email, again.email !== null], [true, null, true]);
  assert.deepEqual(f.call('notifications.list', {start: '2026-11-09'}).items.map(n => n.email_stored), [true, false, true]);
  for (const n of [on, again]) {
    assert.ok(wireSchema(n.email), n.kind);
    assert.deepEqual([n.email.id, n.email.time, n.email.source, n.email.data.recipient, n.email.data.source_object, n.email.data.content],
      [n.id, n.at, 'urn:pale:app:brindle:account:' + ACCOUNT, {kind: 'person_ref', id: OWNER},
        {app_id: 'brindle', account_id: ACCOUNT, object_type: n.object_type, object_id: n.object_id}, {title: n.title, body: {format: 'text/plain', text: n.text}, asset_ids: []}], n.kind);
    assert.deepEqual(pick(n.email, 'specversion', 'type', 'datacontenttype', 'dataschema'), ['1.0', 'org.pale.mail.notification.v1', 'application/json', 'urn:pale:email-payload:1']);
    assert.deepEqual(pick(n.email.data, 'channel', 'extensions'), ['channel.email', []]);
  }
  assert.deepEqual([on.email.data.subscription_ref, again.email.data.subscription_ref], [ACCOUNT + ':transaction-updates', ACCOUNT + ':offer-updates']);
  // Two broken variants fail the schema, so the check is not empty.
  assert.ok(!wireSchema({...on.email, type: 'org.pale.mail.other'}));
  assert.ok(!wireSchema({...on.email, data: {...on.email.data, recipient: {kind: 'email', id: OWNER}}}));
  // The six topics.
  const g = start();
  main(g, 'returned');
  assert.deepEqual(g.data.notifications.slice(SEED.notifications.length).map(n => n.email.data.subscription_ref.split(':')[1]),
    ['transaction-updates', 'dispute-updates', 'statement-updates', 'points-updates', 'offer-updates', 'payment-updates']);
});

test('T19h [All] the seven example events of the plan apply to the task seed in time order, and the wire message of ntf-0058 is the plan\'s example', () => {
  const f = start(), examples = PLAN_EVENTS.map(line => JSON.parse(line)), ordered = [...examples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  assert.deepEqual(require('./proposal-events.json'), examples);
  assert.deepEqual(examples.map(e => e.operation), EVENTS.map(name => 'brindle.' + name));
  assert.deepEqual(ordered.map(e => e.event_id), ['ev-br-301', 'ev-br-302', 'ev-br-330', 'ev-br-310', 'ev-br-350', 'ev-br-340', 'ev-br-320']);
  // The account holder's dispute on 13 November and payment on 10 December come between them.
  for (const e of ordered) {
    if (e.event_id === 'ev-br-330') MAIN.dispute(f);
    if (e.event_id === 'ev-br-320') { MAIN.pay(f); MAIN.paid(f); }
    f.event(e);
  }
  assert.deepEqual(f.data.notifications.slice(-6).map(n => [n.event_id, 'brindle.' + n.kind]), ordered.filter(e => e.event_id !== 'ev-br-302').map(e => [e.event_id, e.operation]));
  assert.deepEqual([tx(f, 'txn-0440').transaction.state, recovery(f, 'txn-0412'), f.call('rewards.get').balance, offerOf(f, 'off-0021').state, paymentOf(f, 'pay-0061').state],
    ['dropped', {amount: 60, refunded_final: 20, temporary_credit: 40, net_charge: 40}, 13240, 'expired', 'returned']);
  const notice = f.data.notifications.find(n => n.id === 'ntf-0058'), example = JSON.parse(PLAN_WIRE);
  assert.deepEqual(notice.email, example);
  assert.equal(JSON.stringify(notice.email), PLAN_WIRE);
  assert.deepEqual([notice.event_id, notice.title, notice.text], ['ev-br-330', example.data.content.title, example.data.content.body.text]);
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

test('T19i [All] Mail delivery: tests/mail.integration.cjs passes on the real runtime (a received message, an identical retry, no grant, and Brindle without Mail)',
  ...withRuntime('tests/mail.integration.cjs'));

// The Mail sender with fake connections: plain objects with `call`. The fake router remembers each identity, like the real one:
// the same message again is a duplicate, and another message under a known identity is a conflict. `answers` replaces its next answers.
function senderWorld(snapshot, answers = []) {
  const w = {snapshot, answers, reads: [], published: []}, known = new Map();
  w.infra = {call: async name => {
    assert.equal(name, 'env.snapshot', 'The sender only reads Brindle.');
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
  f.event(PLAN['ev-br-301']);
  const w = senderWorld(lifecycle(2, SEED, f.data)), sender = w.sender(), first = f.data.notifications[f.data.notifications.length - 1];
  // The notifications of the seed are history, so only ntf-0057 is sent.
  assert.deepEqual(await sender.publishPending(), {epoch: 2, firstEpoch: 2, lifecycle: 'first', results: [delivered('ntf-0057', 'ntf-0057', 1)], stopped: false});
  assert.deepEqual(w.published, [{request_id: 'ntf-0057', message: first.email}]);
  assert.deepEqual((await sender.publishPending()).results, []);
  f.event(PLAN['ev-br-310']);
  w.snapshot = lifecycle(2, SEED, f.data);
  assert.deepEqual((await sender.publishPending()).results, [delivered('ntf-0058', 'ntf-0058', 2)]);
  // After `env.reset` the App has a new epoch, and its next notification is ntf-0057 again, with other content.
  g.event(PLAN['ev-br-310']);
  w.snapshot = lifecycle(3, SEED, g.data);
  const renewed = g.data.notifications[g.data.notifications.length - 1], identity = 'ntf-0057.e3';
  assert.deepEqual(await sender.publishPending(), {epoch: 3, firstEpoch: 2, lifecycle: 'later', results: [delivered('ntf-0057', identity, 3)], stopped: false});
  assert.deepEqual(w.published[2], {request_id: identity, message: {...renewed.email, id: identity}});
  assert.ok(wireSchema(w.published[2].message) && renewed.email.id === 'ntf-0057' && renewed.title !== first.title);
  assert.deepEqual([(await sender.publishPending()).results, w.published.length, w.reads], [[], 3, Array(5).fill('env.snapshot')]);
});

test('T19k [All] Mail sender: what the loaded seed held is never sent, a notification with no wire message is skipped, and a refusal for lack of a route is final', async () => {
  const f = start();
  f.call('preferences.update', {email_notices: false});
  f.event(PLAN['ev-br-301']);
  f.call('preferences.update', {email_notices: true});
  f.event(PLAN['ev-br-310']);
  f.event(PLAN['ev-br-350']);
  assert.deepEqual(f.data.notifications.slice(-3).map(n => [n.id, n.email !== null]), [['ntf-0057', false], ['ntf-0058', true], ['ntf-0059', true]]);
  for (const code of ['recipient_not_authorized', 'recipient_unavailable', 'ambiguous_recipient', 'unsupported_recipient']) {
    const w = senderWorld(lifecycle(2, SEED, f.data), [{status: 'rejected', code}]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results], [false, [undelivered('ntf-0058', {status: 'rejected', code}), delivered('ntf-0059', 'ntf-0059', 1)]], code);
    assert.deepEqual([(await sender.publishPending()).results, w.published.map(p => p.request_id)], [[], ['ntf-0058', 'ntf-0059']], code);
  }
  // A second seed that holds ntf-0057 to ntf-0059 as history: only what comes after them is new.
  const g = fixture({seed: f.data, now: f.ctx.virtual_now});
  g.event(PLAN['ev-br-340']);
  const w = senderWorld(lifecycle(3, f.data, g.data)), out = await w.sender(2).publishPending();
  assert.deepEqual(out.results.map(row => row.request_id), ['ntf-0060.e3']);
});

test('T19l [All] Mail sender: every other answer stops the sender, nothing more is published, and the next call tries that notification again', async () => {
  const f = start();
  f.event(PLAN['ev-br-301']);
  f.event(PLAN['ev-br-310']);
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
    const w = senderWorld(lifecycle(2, SEED, f.data), [answer]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results, w.published.length], [true, [undelivered('ntf-0057', shown)], 1], label);
    const again = await sender.publishPending();
    assert.deepEqual([again.stopped, again.results], [false, [delivered('ntf-0057', 'ntf-0057', 1), delivered('ntf-0058', 'ntf-0058', 2)]], label);
  }
  // It throws when it cannot read Brindle, and it publishes nothing.
  const w = senderWorld(null);
  await assert.rejects(w.sender().publishPending(), /env\.snapshot returned permission_denied/);
  assert.deepEqual([w.reads, w.published], [['env.snapshot'], []]);
});

test('T19m [All] Mail sender: after a reset a second sender publishes as <id>.e<epoch> only when it gets the first epoch, so Infra keeps one sender for the run', async () => {
  const f = start(), g = start();
  f.event(PLAN['ev-br-301']);
  g.event(PLAN['ev-br-310']);
  const w = senderWorld(lifecycle(2, SEED, f.data)), first = await w.sender().publishPending();
  const read = out => [out.firstEpoch, out.lifecycle, out.stopped, out.results.map(row => [row.request_id, row.status, row.code])];
  assert.deepEqual(read(first), [2, 'first', false, [['ntf-0057', 'committed', null]]]);
  w.snapshot = lifecycle(3, SEED, g.data);
  // A new sender that does not know the first epoch reuses the plain ID. The router knows it with other content, so the sender stops.
  assert.deepEqual(read(await w.sender().publishPending()), [3, 'first', true, [['ntf-0057', 'rejected', 'idempotency_conflict']]]);
  assert.deepEqual(read(await w.sender(first.firstEpoch).publishPending()), [2, 'later', false, [['ntf-0057.e3', 'committed', null]]]);
});

test('T20 [All] Core contracts: tests/mcp.integration.cjs passes on the real runtime (task seed and clock, env.advance_time, replay, idempotency_conflict, stale_version, permission_denied, reset)',
  ...withRuntime('tests/mcp.integration.cjs'));

test('T20b [All] platform clock: with advance() and no App code a payment reads posted, an offer expired, a due time passed, an autopay payment skipped and a dispute window closed', () => {
  const f = start();
  main(f, 'statement');
  for (const e of GROUP_OFFERS) f.event(e);
  f.advance(ny('2026-12-10', '19:00:00'));
  f.call('payments.schedule', PAY_IN_FULL);
  const g = autopayWorld();
  manual(g, 100, '2027-01-10');
  const read = () => [paymentOf(f, 'pay-0061').state, offerOf(f, 'off-0022').state, account(f).latest_statement.due_passed, paymentOf(g, 'pay-0062').state];
  const steps = [
    [ny('2026-12-10', '23:59:58'), ['scheduled', 'available', false, 'scheduled']],
    [ny('2026-12-10', '23:59:59'), ['scheduled', 'expired', false, 'scheduled']],
    [ny('2026-12-20', '00:00:00'), ['posted', 'expired', false, 'scheduled']],
    [ny('2026-12-26', '17:00:00'), ['posted', 'expired', true, 'scheduled']],
    [ny('2027-01-26', '00:00:00'), ['posted', 'expired', true, 'skipped']]
  ];
  for (const [time, states] of steps) {
    const before = [f.data, g.data];
    f.advance(time);
    if (Date.parse(time) > Date.parse(g.ctx.virtual_now)) g.advance(time);
    assert.deepEqual([f.data, g.data], before, time);
    assert.deepEqual(read(), states, time);
  }
  // The dispute window of txn-0413, posted on 4 November, closes with 3 January, by the clock alone.
  const h = fixture({seed: SEED, now: ny('2027-01-03', '23:59:59')}), ask = () => h.call('disputes.open', {id: 'txn-0413', amount: 5, reason: 'other', note: 'Please check.'});
  const before = h.data;
  h.advance(ny('2027-01-04', '00:00:00'));
  assert.deepEqual(h.data, before);
  unchanged(h, ask, 'too_late', 'the day after the last day');
});

test('T20c [All] records: one activity row for each committed write, each applied event and each effect, and none for a refused call, a read or a change of time', () => {
  const f = start(), expected = [], applied = [], EFFECT = true, first = SEED.activity[SEED.activity.length - 1].seq + 1;
  const rows = (actor, ref, list) => list.forEach(([action, object_id, effect = false]) => expected.push({seq: first + expected.length, at: f.ctx.virtual_now,
    actor, action, object_id, request_id: actor === 'agent' ? ref : null, event_id: actor === 'event' ? ref : null, effect}));
  // Each step names the rows that it must write: its own row first, then one row for each effect.
  const write = (name, args, ...list) => {
    const request_id = 'rq-' + (expected.length + 1);
    f.call(name, {...args, request_id});
    rows('agent', request_id, list);
  };
  const apply = (e, ...list) => { f.event(e); applied.push(e.event_id); rows('event', e.event_id, list); };
  write('preferences.update', {email_notices: true}, ['preferences.update', ACCOUNT]);
  write('autopay.set', {id: ACCOUNT, mode: 'minimum_due'}, ['autopay.set', ACCOUNT]);
  apply(PLAN['ev-br-301'], ['transaction.posted', 'txn-0431'], ['notification.written', 'ntf-0057', EFFECT]);
  apply(PLAN['ev-br-302'], ['transaction.dropped', 'txn-0440']);
  f.advance(ny('2026-11-13', '20:00:00'));
  write('disputes.open', DISPUTE, ['disputes.open', 'dsp-0009']);
  apply(PLAN['ev-br-330'], ['dispute.updated', 'dsp-0009'], ['temporary_credit.posted', 'txn-0450', EFFECT], ['notification.written', 'ntf-0058', EFFECT]);
  apply(buy('txn-0460', ny('2026-11-20', '03:00:00'), 'Fernhill Hardware', 210), ['transaction.posted', 'txn-0460']);
  write('disputes.open', {id: 'txn-0460', amount: 30, reason: 'wrong_amount', note: 'Charged 30.00 too much.'}, ['disputes.open', 'dsp-0010']);
  write('disputes.withdraw', {id: 'dsp-0010'}, ['disputes.withdraw', 'dsp-0010']);
  apply(updated('ev-matched', ny('2026-11-25', '10:00:00'), 'dsp-0009', 'closed_matched', {reversal: {transaction_id: 'txn-0452', amount: 40}}),
    ['dispute.updated', 'dsp-0009'], ['reversal.posted', 'txn-0452', EFFECT], ['notification.written', 'ntf-0059', EFFECT]);
  apply(PLAN['ev-br-310'], ['statement.issued', 'stm-2026-11'], ['autopay.scheduled', 'pay-0061', EFFECT], ['notification.written', 'ntf-0060', EFFECT]);
  apply(PLAN['ev-br-350'], ['points.adjusted', 'pts-0207'], ['notification.written', 'ntf-0061', EFFECT]);
  apply(PLAN['ev-br-340'], ['offer.issued', 'off-0021'], ['notification.written', 'ntf-0062', EFFECT]);
  apply(BONUS, ['offer.issued', 'off-0024'], ['notification.written', 'ntf-0063', EFFECT]);
  f.advance(ny('2026-12-05', '10:00:00'));
  write('offers.accept', {id: 'off-0024'}, ['offers.accept', 'off-0024']);
  write('offers.decline', {id: 'off-0021'}, ['offers.decline', 'off-0021']);
  write('rewards.redeem', {id: ACCOUNT, points: 1000}, ['rewards.redeem', 'pts-a0001']);
  write('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1000, member_name: 'Riley Hart'}, ['rewards.transfer', 'pts-a0002']);
  write('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 100, pay_on: '2026-12-05', source: BANK}, ['payments.schedule', 'pay-0062']);
  write('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 50, pay_on: '2026-12-20', source: BANK}, ['payments.schedule', 'pay-0063']);
  write('payments.cancel', {id: 'pay-0063'}, ['payments.cancel', 'pay-0063']);
  apply(returned('ev-return', ny('2026-12-06', '09:00:00'), 'pay-0062'), ['payment.returned', 'pay-0062'], ['notification.written', 'ntf-0064', EFFECT]);
  // A refused write, a rejected event, every read and a change of time write no row.
  unchanged(f, () => f.call('payments.cancel', {id: 'pay-0063'}), 'invalid_state');
  unchanged(f, () => f.event(returned('ev-return-2', ny('2026-12-06', '09:00:00'), 'pay-0062')), 'invalid_event');
  everyRead(f);
  f.advance(ny('2026-12-07'));
  write('account.close', {id: ACCOUNT}, ['account.close', ACCOUNT]);

  assert.deepEqual(f.data.activity.slice(SEED.activity.length), expected);
  const actions = actor => [...new Set(expected.filter(row => row.actor === actor && !row.effect).map(row => row.action))].sort();
  assert.deepEqual([actions('agent'), actions('event')], [[...WRITES].sort(), [...EVENTS].sort()]);
  assert.deepEqual([...new Set(expected.filter(row => row.effect).map(row => row.action))].sort(),
    ['autopay.scheduled', 'notification.written', 'reversal.posted', 'temporary_credit.posted']);
  // Each write has exactly one row, and it is not an effect. Each effect row follows its event and carries effect: true.
  for (const request_id of new Set(expected.filter(row => row.request_id).map(row => row.request_id))) {
    assert.deepEqual(f.data.activity.filter(row => row.request_id === request_id).map(row => row.effect), [false], request_id);
  }
  assert.ok(f.data.activity.filter(row => row.effect).every(row => row.actor === 'event' && row.request_id === null));
  // One notification for each applied event, except the drop, with its event_id, and none for the 16 writes of the 11 kinds.
  assert.deepEqual(f.data.notifications.slice(SEED.notifications.length).map(n => n.event_id), applied.filter(id => !['ev-br-302', 'ev-txn-0460'].includes(id)));
  // The effects of a write are in the records it changes: a payment keeps its own history.
  assert.deepEqual(f.data.payments.find(p => p.id === 'pay-0062').history.map(row => [row.action, row.actor, row.ref]),
    [['payments.schedule', 'agent', expected.find(row => row.object_id === 'pay-0062').request_id], ['payment.returned', 'event', 'ev-return']]);
  assert.deepEqual(f.data.points_entries.find(e => e.reason === 'forfeited').history.map(row => [row.action, row.ref]), [['account.close', expected[expected.length - 1].request_id]]);
});

test('T20d [All] the error table: each of the 14 App errors, and the first one of the table when two fit one call', () => {
  const f = start();
  main(f, 'refund');
  f.advance(ny('2026-11-13', '20:00:00'));
  f.call('disputes.open', DISPUTE);
  f.call('disputes.open', {id: 'txn-0383', amount: 42, reason: 'wrong_amount', note: 'The pizza was charged at the wrong price.'});
  walk(f, {credit: MAIN.credit, statement: MAIN.statement, purchase: MAIN.purchase, hold: MAIN.hold, points: MAIN.points});
  for (const e of [...GROUP_OFFERS, BONUS]) f.event(e);
  f.advance(ny('2026-12-05'));
  f.call('offers.accept', {id: 'off-0022'});
  f.advance(ny('2026-12-10', '19:00:00'));
  f.call('payments.schedule', PAY_IN_FULL);
  f.call('payments.cancel', {id: f.call('payments.schedule', {id: ACCOUNT, amount_type: 'fixed', amount: 10, pay_on: '2026-12-21', source: BANK}).id});
  f.call('payments.schedule', {id: ACCOUNT, amount_type: 'minimum_due', pay_on: '2026-12-10', source: BANK});
  // On 11 December: pay-0061 is scheduled, pay-0062 cancelled, pay-0063 posted (the minimum), the bonus offer expired, and the balance is 1,415.00.
  f.advance(ny('2026-12-11'));
  assert.deepEqual([paymentOf(f, 'pay-0062').state, paymentOf(f, 'pay-0063').state, offerOf(f, 'off-0024').state, account(f).balance], ['cancelled', 'posted', 'expired', 1415]);
  const bare1 = fixture({seed: bare(), now: NOW}), closed = start(), drained = start();
  closed.call('account.close', {id: ACCOUNT});
  closed.advance(ny('2027-01-02'));
  drained.call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 12000, member_name: 'Riley Hart'});
  const call = (name, args, w = f) => [w, () => w.call(name, args)];
  const pay = (args, w = f) => call('payments.schedule', {id: ACCOUNT, source: BANK, ...args}, w);
  const open = (id, amount, w = f) => call('disputes.open', {id, amount, reason: 'other', note: 'Please check.'}, w);
  // [the world and the call, the error, the other error of the table that also fits, or null]
  const cases = [
    [call('transactions.get', {id: 'txn-9999'}), 'not_found', null],
    [call('payments.cancel', {id: 'pay-0062'}), 'invalid_state', null],
    [call('preferences.update', {timezone: 'Mars/Olympus'}), 'invalid_timezone', null],
    [call('transactions.list', {start: '2026-12-10', end: '2026-12-01'}), 'invalid_window', null],
    [pay({amount_type: 'minimum_due', pay_on: '2026-12-11'}, bare1), 'no_statement', null],
    [pay({amount_type: 'minimum_due', pay_on: '2026-12-11'}), 'nothing_due', null],
    [pay({amount_type: 'fixed', amount: 2000, pay_on: '2026-12-11'}), 'over_balance', null],
    [open('txn-0461', 100), 'not_disputable', null],
    [open('txn-0460', 250), 'over_net', null],
    [open('txn-0412', 10), 'already_disputed', null],
    [call('offers.accept', {id: 'off-0024'}), 'too_late', null],
    [call('rewards.redeem', {id: ACCOUNT, points: 20000}), 'insufficient_points', null],
    [call('rewards.redeem', {id: ACCOUNT, points: 500}), 'below_minimum', null],
    [call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1500, member_name: 'Riley Hart'}), 'invalid_increment', null],
    // Two errors fit.
    [pay({id: 'brindle-other', amount_type: 'fixed', amount: 5000, pay_on: '2026-12-01'}), 'not_found', 'invalid_window'],
    [call('rewards.transfer', {id: ACCOUNT, partner_id: 'orbit', points: 1000, member_name: 'Riley Hart'}, closed), 'not_found', 'invalid_state'],
    [call('rewards.redeem', {id: 'brindle-other', points: 99000}, closed), 'not_found', 'invalid_state'],
    [call('offers.accept', {id: 'off-0019'}, closed), 'invalid_state', 'too_late'],
    [call('rewards.redeem', {id: ACCOUNT, points: 99000}, closed), 'invalid_state', 'insufficient_points'],
    [call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 1500, member_name: 'Riley Hart'}, closed), 'invalid_state', 'invalid_increment'],
    [pay({amount_type: 'minimum_due', pay_on: '2026-11-08'}, bare1), 'invalid_window', 'no_statement'],
    [pay({amount_type: 'fixed', amount: 2000, pay_on: '2026-12-10'}), 'invalid_window', 'over_balance'],
    [open('txn-0461', 400), 'not_disputable', 'over_net'],
    [open('txn-0384', 10), 'not_disputable', 'too_late'],
    [open('txn-0412', 50), 'over_net', 'already_disputed'],
    [open('txn-0383', 50), 'over_net', 'already_disputed and too_late'],
    [open('txn-0383', 10), 'already_disputed', 'too_late'],
    [call('rewards.redeem', {id: ACCOUNT, points: 500}, drained), 'insufficient_points', 'below_minimum'],
    [call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 700, member_name: 'Riley Hart'}, drained), 'insufficient_points', 'below_minimum and invalid_increment'],
    [call('rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 700, member_name: 'Riley Hart'}), 'below_minimum', 'invalid_increment']
  ];
  for (const [[w, fn], code, other] of cases) unchanged(w, fn, code, code + (other ? ' before ' + other : ''));
  assert.deepEqual([...new Set(cases.map(([, code]) => code))], ERRORS);
});

test('PKG diagnostics on, off and broken give the same data', () => {
  const on = start(), off = start({logging: false}), broken = start();
  broken.ctx.log = () => { throw new Error('logger offline'); };
  for (const f of [on, off, broken]) main(f);
  assert.deepEqual(on.data, off.data);
  assert.deepEqual(broken.data, off.data);
  assert.ok(on.logs.length);
  assert.equal(off.logs.length, 0);
});

// T21: the delivery dataset in data/evaluation/ (plan section 4). The month-start seeds come from one replay pass. The three --check
// scripts run in child processes while that pass runs, so the block stays well under the time limit of the file.
{
  const {spawn} = require('node:child_process');
  const ROOT21 = path.resolve(__dirname, '..');
  const plugin21 = require('../plugin.cjs');
  const seedValid21 = require('../tests/schema-validator.cjs').compile(require('../schemas/seed.schema.json'), path.join(ROOT21, 'schemas'));
  const generator = require('../dev/generate-dataset.cjs');
  const {problems, RULES} = require('../dev/check-evaluation.cjs');
  const {select, later} = require('../dev/select-evaluation-seed.cjs');
  const {consistency} = require('../dev/check-fixture.cjs');
  const evaluation = file => JSON.parse(fs.readFileSync(path.join(ROOT21, 'data/evaluation', file), 'utf8'));
  const ctx21 = at => Object.freeze({app_id: 'brindle', role: 'agent', virtual_now: at, binding: require('../fixtures/binding.json')});
  const CHECKS = [['dev/generate-dataset.cjs', '--check'], ['dev/coverage.cjs', '--check'], ['dev/select-evaluation-seed.cjs', '--check']];
  let running = null;
  const checks = () => running || (running = Promise.all(CHECKS.map(args => new Promise(resolve => {
    const child = spawn(process.execPath, args, {cwd: ROOT21});
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve({args: args.join(' '), code, out}));
  }))));
  let pass = null;
  const onePass = () => pass || (pass = generator.generate({keepAt: generator.MONTH_STARTS}));

  test('T21 [Data] the seeds at the 24 month starts, from one replay pass, pass validateSeed at their time, the consistency script and the story rules', () => {
    checks();
    const {seed, manifest, snapshots} = onePass();
    assert.equal(JSON.stringify(seed) + '\n', fs.readFileSync(path.join(ROOT21, 'data/evaluation/seed.json'), 'utf8'), 'the pass gives the delivered seed');
    assert.equal(generator.MONTH_STARTS.length, 24);
    for (const at of generator.MONTH_STARTS) {
      const data = snapshots[at];
      assert.ok(seedValid21(data), at + ': seed schema');
      plugin21.validateSeed(ctx21(at), data);
      assert.deepEqual(consistency(data, at), [], at + ': consistency script');
      assert.deepEqual(problems(data, manifest, at), [], at + ': story rules');
    }
    assert.deepEqual(problems(seed, manifest), [], 'story rules at the clock');
    const window = seed.statements.filter(s => s.closing_at >= '2025');
    assert.deepEqual([window.length, seed.statements.length, seed.disputes.length, seed.offers.length, new Set(seed.disputes.map(d => d.state)).size],
      [24, 25, 8, 16, 5]);
    assert.deepEqual(seed.transactions.filter(x => x.fee_type === 'annual').map(x => x.posted_at.slice(0, 10)), ['2025-12-02', '2026-12-02']);
  });

  test('T21b [Data] the generator, the coverage report and the selector pass --check on the committed files', async () => {
    for (const r of await checks()) assert.equal(r.code, 0, r.args + '\n' + r.out);
    const manifest = evaluation('manifest.json'), crypto = require('node:crypto');
    const declared = require('../contribution/dataset.json').sources.find(s => s.source_id === 'evaluation-generator').generation.parameters.files;
    for (const name of ['seed.json', 'clock.json', 'dataset.json']) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT21, 'data/evaluation', name))).digest('hex');
      assert.deepEqual([manifest.files[name].sha256, declared.find(f => f.name === 'data/evaluation/' + name).sha256], [sha, sha], name);
    }
  });

  test('T21c [Data] the selector refuses a seed with a later timestamp and a time outside the window, and allows only the due times of a schedule', () => {
    const {seed, snapshots} = onePass(), at = generator.MONTH_STARTS[17], mid = snapshots[at];
    assert.ok(later(seed, at).length > 0, 'control: the delivered seed has timestamps after ' + at);
    assert.deepEqual(later(mid, at), [], 'the month-start seed has no later timestamp');
    const due = mid.statements.filter(s => Date.parse(s.due_at) > Date.parse(at)).map(s => s.id);
    assert.equal(due.length, 1, 'control: the latest statement is due after ' + at);
    const planted = structuredClone(mid);
    planted.notifications[planted.notifications.length - 1].at = '2026-06-02T09:00:00-04:00';
    planted.transactions[0].history.push({at: '2026-06-03T04:00:00-04:00', action: 'transaction.posted', actor: 'event', ref: 'ev-later', amount: 1});
    assert.deepEqual(later(planted, at).map(x => x.path), ['transactions[0].history[' + (planted.transactions[0].history.length - 1) + '].at',
      'notifications[' + (planted.notifications.length - 1) + '].at']);
    for (const outside of ['2027-01-01T00:00:00-05:00', '2024-12-01T00:00:00-05:00']) assert.throws(() => select(outside), /not inside/, outside);
    for (const bad of ['2026-06-01T00:00:00', '2026-06-01', undefined]) assert.throws(() => select(bad), /UTC offset/, String(bad));
  });

  test('T21d [Data] a contradiction planted for each of the 14 story rules is caught by problems()', () => {
    const {seed, manifest} = onePass();
    const story = template => manifest.stories.find(s => s.template === template);
    const tx = (data, id) => data.transactions.find(x => x.id === id);
    const local = (value, hhmm) => value.slice(0, 11) + hhmm + value.slice(16);
    const plants = {
      story: (data, m) => { const s = m.stories.find(x => x.template === 'groceries'); return s.records.pop(); },
      merchant: data => { const x = tx(data, story('coffee').records[0]); x.transaction_at = local(x.transaction_at, '23:40'); return x.id; },
      posting: data => { const x = tx(data, story('fuel').records[0]); x.pending_amount = null; return x.id; },
      refund: data => { const x = tx(data, story('online_return').records[1]); x.amount = Math.round((x.amount + 10) * 100) / 100; return x.id; },
      dispute: data => { const d = data.disputes[0]; d.reason = 'other'; return d.id; },
      offer: data => { const o = data.offers.find(x => x.kind === 'spend_credit'); o.terms = o.terms.replace('3,000.00', '2,000.00'); return o.id; },
      fees: data => { const x = data.transactions.find(y => y.fee_type === 'annual'); x.posted_at = '2025-12-05T03:30:00-05:00'; return x.id; },
      statement: data => { const s = data.statements[5]; s.statement_balance = Math.round((s.statement_balance + 1) * 100) / 100; return s.id; },
      interest: data => { const x = data.transactions.find(y => y.kind === 'interest'); x.amount = Math.round((x.amount + 0.5) * 100) / 100; return x.id; },
      payments: data => { const p = data.payments.find(y => y.autopay); p.source = 'Savings ending 9999'; return p.id; },
      points: data => { const e = data.points_entries.find(y => y.reason === 'earned'); e.points += 1; return e.id; },
      times: data => { const row = data.activity.find(r => r.actor === 'agent'); row.at = local(row.at, '03:15'); return row.object_id; },
      names: data => { const x = tx(data, story('groceries').records[0]); x.merchant = 'Real Mart Inc'; return x.id; },
      notifications: data => { const n = data.notifications.find(y => y.kind === 'offer.issued'); n.text = n.text.replace(/Accept or decline it by [^.]*\./, 'Accept it soon.'); return n.id; }
    };
    assert.deepEqual(Object.keys(plants), RULES);
    for (const rule of RULES) {
      const data = structuredClone(seed), m = structuredClone(manifest), id = plants[rule](data, m), rows = problems(data, m);
      assert.ok(rows.some(r => r.rule === rule && r.record_id === id), rule + ': no row for ' + id + ' in ' + JSON.stringify(rows.slice(0, 3)));
    }
  });

  test('T21f [Data] the coverage report counts a payment only for its acts: a cancelled or skipped payment adds no posting, and its intended day is listed apart', () => {
    const coverage = require('../dev/coverage.cjs'), r = coverage.report(), seed = evaluation('seed.json'), clock = evaluation('clock.json').initial_time;
    const counted = kind => coverage.count(seed, clock).counted.filter(x => x.kind === kind).map(x => [x.day, x.id]);
    const postings = counted('payment_postings');
    assert.ok(postings.some(([day, id]) => day === '2025-10-27' && id === 'pay-0013'), 'control: the payment that posted on 27 October 2025 counts');
    assert.ok(!postings.some(([, id]) => id === 'pay-0014' || id === 'pay-0007'), 'the cancelled pay-0014 and the skipped pay-0007 add no posting');
    assert.ok(!r.actual.dates['2025-10-27'].includes('pay-0014'), 'the cancelled payment does not count on its pay_on');
    assert.deepEqual(counted('payment_requests').filter(([, id]) => id.startsWith('pay-0014 ')), [['2025-10-24', 'pay-0014 payments.schedule'], ['2025-10-24', 'pay-0014 payments.cancel']]);
    assert.deepEqual(r.scheduled.kinds.find(k => k.kind === 'payment_intended_days').listed,
      [{id: 'pay-0007', value: '2025-07-22', state: 'skipped'}, {id: 'pay-0014', value: '2025-10-27', state: 'cancelled'}, {id: 'pay-0031', value: '2027-01-22', state: 'scheduled'}]);
    assert.ok(!r.actual.kinds.some(k => k.date_field.startsWith('payments[].pay_on')), 'no counted family uses pay_on');
    const planted = structuredClone(seed), p = planted.payments.find(x => x.id === 'pay-0013');
    Object.assign(p, {stored_state: 'cancelled', cancelled_at: '2025-10-26T09:00:00-04:00'});
    assert.ok(!coverage.count(planted, clock).counted.some(x => x.kind === 'payment_postings' && x.id === 'pay-0013'), 'a payment marked cancelled stops counting');
  });

  test('T21e [Data] load and query: tests/evaluation.integration.cjs loads the delivery seed with env.load_seed on the real runtime and reads the counts of the coverage report through MCP',
    ...withRuntime('tests/evaluation.integration.cjs'));
}

// The code of the App and of its sender, and the files that run with the business tests, each with the host modules that it needs.
// Not in these lists: tests/mcp.integration.cjs and tests/mail.integration.cjs load the runtime from the path they are given, and dev/ reads the plan.
const sources = dir => fs.readdirSync(path.join(ROOT, dir)).filter(file => file.endsWith('.cjs')).map(file => dir + '/' + file);
const APP_CODE = [...sources('src'), ...sources('infra'), 'plugin.cjs'];
const TEST_CODE = {'tests/business.test.cjs': ['fs', 'child_process', 'crypto'], 'tests/schema-validator.cjs': ['fs'], 'tests/harness.cjs': [], 'examples/run.cjs': []};
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
  const full = list => list.map(name => 'brindle.' + name).sort();
  assert.deepEqual([names(true), names(false), tools.length], [full(READS), full(WRITES), 25]);
  assert.deepEqual([...require('../app.json').event_types].sort(), full(EVENTS));
  // Every write takes Core's `request_id` and `expected_version` and returns an `id`. Every read returns `now`.
  for (const tool of tools) {
    const needs = tool.read_only ? [] : ['request_id', 'expected_version'], gives = tool.read_only ? 'now' : 'id';
    assert.ok(needs.every(key => tool.inputSchema.required.includes(key)) && tool.outputSchema.required.includes(gives), tool.name);
  }
  // The target object is always `id`, and a window is always `start` and `end`.
  for (const tool of tools) for (const key of Object.keys(tool.inputSchema.properties)) assert.ok(!/(_id|^from|^to|^date)$/.test(key) || key === 'request_id' || key === 'partner_id', tool.name + ' ' + key);
});
