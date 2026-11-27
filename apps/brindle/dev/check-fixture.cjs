'use strict';
// The consistency script of the plan. For a seed and a time it works out, with its own code, every statement balance, recovery summary,
// points balance, payment state and posted amount, offer state and spending condition, and every account and purchase flag. Then it
// compares each one with what the App's reads return at that time.
// Run `node dev/check-fixture.cjs` (the package fixture and the task seed, each at its clock), `node dev/check-fixture.cjs FILE TIME`,
// or `node dev/check-fixture.cjs --evaluation` (the delivered seed and the 24 month-start seeds). Exits 1 on a problem.
const fs = require('node:fs');
const path = require('node:path');
const {compile} = require('../tests/schema-validator.cjs');
const plugin = require('../plugin.cjs');
const APP = require('../app.json').app_id;
const binding = require('../fixtures/binding.json');
const seedSchema = compile(require('../schemas/seed.schema.json'), path.resolve(__dirname, '../schemas'));
const FIXTURE = path.resolve(__dirname, '../fixtures/minimal.json'), TASK_SEED = path.resolve(__dirname, '../examples/task-data/seed.json');
const ms = Date.parse, cents = amount => Math.round(amount * 100), total = values => values.reduce((a, b) => a + b, 0);
const text = value => (value / 100).toFixed(2);
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// The plan's counts for the package fixture (section 4, "Synthetic data and assets"). `skipped` is read at the clock.
const PLAN = {rules: 4, products: 2, partners: [3, 0], statements: 13, transactions: 180, pending: 12, refunds: 9, annual_fees: 2, credits: 6,
  provisional_credits: 3, reversals: 2, payments: 16, autopay: 3, returned: 2, cancelled: 1, skipped: 1, disputes: 5, offers: 7, points_entries: 30, notifications: 24};
function counts(data, now) {
  const tx = kind => data.transactions.filter(x => x.kind === kind).length, amounts = paymentAmounts(data), at = ms(now);
  return {rules: Object.keys(data.issuer.rules).length, products: data.products.length, partners: data.products.map(p => p.partners.length),
    statements: data.statements.length, transactions: data.transactions.length, pending: data.transactions.filter(x => x.state === 'pending').length,
    refunds: tx('refund'), annual_fees: data.transactions.filter(x => x.fee_type === 'annual').length, credits: tx('credit'),
    provisional_credits: tx('provisional_credit'), reversals: tx('reversal'), payments: data.payments.length, autopay: data.payments.filter(p => p.autopay).length,
    returned: data.payments.filter(p => p.stored_state === 'returned').length, cancelled: data.payments.filter(p => p.stored_state === 'cancelled').length,
    skipped: data.payments.filter(p => paymentState(p, amounts, at) === 'skipped').length, disputes: data.disputes.length, offers: data.offers.length,
    points_entries: data.points_entries.length, notifications: data.notifications.length};
}

// Calendar days in the issuer's time zone.
const formats = new Map();
function dayOf(instant, zone) {
  if (!formats.has(zone)) formats.set(zone, new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}));
  const p = Object.fromEntries(formats.get(zone).formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day;
}
const addDays = (day, days) => new Date(ms(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
// The first instant of a day: the earliest instant whose local day is that day. No zone is more than 15 hours from UTC.
function startOf(day, zone) {
  let low = ms(day + 'T00:00:00Z') - 54000000, high = low + 108000000;
  while (high - low > 1000) { const mid = Math.floor((low + high) / 2000) * 1000; if (dayOf(mid, zone) < day) low = mid; else high = mid; }
  return high;
}
// A limit of N days from a moment ends at the end of the calendar day N days after the day of that moment.
const limitEnd = (data, moment, days) => startOf(addDays(dayOf(ms(moment), data.issuer.timezone), days + 1), data.issuer.timezone);

// Payments. A manual payment posts its scheduled amount. An autopay payment posts its scheduled amount minus what the other payments
// paid toward its statement before its posting time, never below zero.
function paymentAmounts(data) {
  const memo = new Map(), statements = new Map(data.statements.map(s => [s.id, s]));
  const live = data.payments.filter(p => p.stored_state !== 'cancelled');
  function amount(p) {
    if (memo.has(p.id)) return memo.get(p.id);
    let value = cents(p.scheduled_amount);
    if (p.autopay) {
      const s = statements.get(p.statement_id), from = s ? ms(s.closing_at) : -Infinity, at = ms(p.posts_at);
      const before = live.filter(q => q !== p && ms(q.posts_at) > from && ms(q.posts_at) < at && !(q.returned_at && ms(q.returned_at) < at));
      value = Math.max(0, value - total(before.map(amount)));
    }
    memo.set(p.id, value);
    return value;
  }
  return new Map(live.map(p => [p.id, amount(p)]));
}
function paymentState(p, amounts, now) {
  if (p.stored_state === 'cancelled' || p.stored_state === 'returned') return p.stored_state;
  if (now < ms(p.posts_at)) return 'scheduled';
  return p.autopay && amounts.get(p.id) === 0 ? 'skipped' : 'posted';
}
// The payments that count at a moment: posted by then with an amount, and not returned by then.
const counted = (data, amounts, at) => data.payments.filter(p => amounts.has(p.id) && ms(p.posts_at) <= at && amounts.get(p.id) > 0 && !(p.returned_at && ms(p.returned_at) <= at));

// The balance at a moment, in cents: what had posted by then, and the payments that counted then.
const PLUS = ['purchase', 'fee', 'interest', 'reversal'], MINUS = ['refund', 'credit', 'provisional_credit'];
function balanceAt(data, amounts, at) {
  let value = 0;
  for (const tx of data.transactions) {
    if (tx.state !== 'posted' || ms(tx.posted_at) > at) continue;
    if (PLUS.includes(tx.kind)) value += cents(tx.amount);
    if (MINUS.includes(tx.kind)) value -= cents(tx.amount);
  }
  return value - total(counted(data, amounts, at).map(p => amounts.get(p.id)));
}
// Statements in order: closing time, then issue time, then their place in the list.
const inOrder = data => data.statements.map((s, i) => [s, i]).sort(([a, i], [b, j]) => ms(a.closing_at) - ms(b.closing_at) || ms(a.issued_at) - ms(b.issued_at) || i - j).map(([s]) => s);
// Paid toward a statement: payments that posted after its closing (up to the next closing for an older statement) and count now.
function paidToward(data, amounts, s, now) {
  const list = inOrder(data), later = list[list.indexOf(s) + 1], end = later ? ms(later.closing_at) : Infinity;
  return total(counted(data, amounts, now).filter(p => ms(p.posts_at) > ms(s.closing_at) && ms(p.posts_at) <= end).map(p => amounts.get(p.id)));
}

// The recovery summary of a purchase, from the transactions that relate to it and its disputes.
function recovery(data, purchase) {
  const posted = data.transactions.filter(tx => tx.state === 'posted');
  const left = d => Math.max(0, total(posted.filter(tx => tx.dispute_id === d.id && tx.kind === 'provisional_credit').map(tx => cents(tx.amount))) -
    total(posted.filter(tx => tx.dispute_id === d.id && tx.kind === 'reversal').map(tx => cents(tx.amount))));
  const disputes = data.disputes.filter(d => d.transaction_id === purchase.id);
  const refunded = total(posted.filter(tx => tx.kind === 'refund' && tx.relates_to === purchase.id).map(tx => cents(tx.amount))) +
    total(disputes.filter(d => d.state === 'resolved_for_me').map(left));
  const temporary = total(disputes.filter(d => d.state !== 'resolved_for_me').map(left)), amount = cents(purchase.amount);
  const flags = [...(disputes.some(d => d.state === 'open') ? ['disputed'] : []), ...(temporary > 0 ? ['temporary_credit'] : []),
    ...(refunded + temporary > amount ? ['double_credited'] : [])];
  return {summary: {amount, refunded_final: refunded, temporary_credit: temporary, net_charge: amount - refunded}, flags};
}

// An offer: only a stored `available` offer reads `expired` from its accept_by. An enrolled spending offer counts the purchases posted
// from the acceptance to the deadline, minus the refunds of those purchases that posted before the deadline.
const offerState = (o, now) => o.stored_state === 'available' && now >= ms(o.accept_by) ? 'expired' : o.stored_state;
function spending(data, o, now) {
  if (o.kind !== 'spend_credit' || o.stored_state !== 'enrolled') return null;
  const from = ms(o.enrolled_at), deadline = limitEnd(data, o.enrolled_at, o.spend_days);
  const bought = data.transactions.filter(tx => tx.kind === 'purchase' && tx.state === 'posted' && ms(tx.posted_at) >= from && ms(tx.posted_at) < deadline);
  const ids = new Set(bought.map(tx => tx.id));
  const back = data.transactions.filter(tx => tx.kind === 'refund' && tx.state === 'posted' && ids.has(tx.relates_to) && ms(tx.posted_at) < deadline);
  const progress = total(bought.map(tx => cents(tx.amount))) - total(back.map(tx => cents(tx.amount)));
  const condition = progress >= cents(o.spend_target) ? 'met' : now >= deadline || data.account.state === 'closed' ? 'missed' : 'open';
  return {progress, deadline, condition};
}

// The annual fee that a closing now would refund: the latest posted annual fee, inside fee_refund_days of its posting, not yet recorded.
function feeRefund(data, now) {
  const fees = data.transactions.filter(tx => tx.kind === 'fee' && tx.fee_type === 'annual' && tx.state === 'posted');
  const fee = fees.reduce((a, b) => !a || ms(b.posted_at) > ms(a.posted_at) || ms(b.posted_at) === ms(a.posted_at) && b.id > a.id ? b : a, null);
  if (!fee || data.account.fee_refunds.some(r => r.fee_id === fee.id)) return null;
  const end = limitEnd(data, fee.posted_at, data.issuer.rules.fee_refund_days);
  return now < end ? {fee_id: fee.id, amount: fee.amount, until: addDays(dayOf(end, data.issuer.timezone), -1)} : null;
}
function accountFlags(data, amounts, now) {
  const list = inOrder(data), latest = list[list.length - 1], balance = balanceAt(data, amounts, now), flags = [];
  if (latest && now >= ms(latest.due_at) && balance > 0) {
    const paid = paidToward(data, amounts, latest, now);
    if (paid < cents(latest.minimum_due)) flags.push('past_due');
    else if (paid < cents(latest.statement_balance)) flags.push('statement_unpaid');
  }
  if (latest && data.payments.some(p => p.stored_state === 'returned' && ms(p.posts_at) > ms(latest.closing_at))) flags.push('payment_returned');
  if (balance < 0) flags.push('credit_balance');
  if (data.account.state === 'open' && feeRefund(data, now)) flags.push('fee_refund_open');
  return flags;
}

// The checks. Each adds a problem string when the App's answer differs from the one worked out here.
function consistency(seed, time) {
  const problems = [], now = ms(time), say = (label, message) => problems.push(label + ': ' + message);
  if (!Number.isFinite(now)) return ['The time ' + time + ' is not a timestamp.'];
  if (!seedSchema(seed)) return ['The seed does not match schemas/seed.schema.json.'];
  const ctx = Object.freeze({app_id: APP, role: 'agent', virtual_now: time, binding: structuredClone(binding)});
  try { plugin.validateSeed(ctx, structuredClone(seed)); } catch (error) { return ['The App refuses the seed: ' + error.message]; }
  const data = structuredClone(seed), read = (name, args = {}) => plugin.handleTool(ctx, data, APP + '.' + name, args).result;
  const amounts = paymentAmounts(data);

  // Statements: the balance at the closing follows from the records, and the App reads the same paid_toward.
  const statements = new Map(read('statements.list').items.map(s => [s.id, s]));
  for (const s of data.statements) {
    const balance = balanceAt(data, amounts, ms(s.closing_at)), paid = paidToward(data, amounts, s, now), shown = statements.get(s.id);
    if (cents(s.statement_balance) !== balance) say(s.id, 'the statement balance is ' + text(cents(s.statement_balance)) + ', but the records give ' + text(balance) + ' at the closing.');
    if (!shown || cents(shown.paid_toward) !== paid) say(s.id, 'the App reads paid_toward ' + (shown && shown.paid_toward) + ', but the payments give ' + text(paid) + '.');
  }

  // Payments: the read state and the posted amount.
  const payments = new Map(read('payments.list').items.map(p => [p.id, p]));
  for (const p of data.payments) {
    const state = paymentState(p, amounts, now), amount = state === 'scheduled' || state === 'cancelled' ? null : amounts.get(p.id) / 100, shown = payments.get(p.id);
    if (!shown || shown.state !== state || shown.posted_amount !== amount) say(p.id, 'the App reads ' + (shown && shown.state + ' ' + shown.posted_amount) + ', but the records give ' + state + ' ' + amount + '.');
  }

  // Purchases: the recovery summary and the flags, in the list and in the transaction.
  const rows = new Map(read('transactions.list').items.map(tx => [tx.id, tx]));
  for (const tx of data.transactions) {
    const expected = tx.kind === 'purchase' ? recovery(data, tx) : {summary: null, flags: []}, row = rows.get(tx.id);
    if (!row || !sameSet(row.flags, expected.flags)) say(tx.id, 'transactions.list reads the flags ' + JSON.stringify(row && row.flags) + ', but the records give ' + JSON.stringify(expected.flags) + '.');
    if (tx.kind !== 'purchase') continue;
    const view = read('transactions.get', {id: tx.id}), want = Object.fromEntries(Object.entries(expected.summary).map(([k, v]) => [k, v / 100]));
    if (JSON.stringify(view.recovery) !== JSON.stringify(want)) say(tx.id, 'the App reads the recovery summary ' + JSON.stringify(view.recovery) + ', but the records give ' + JSON.stringify(want) + '.');
    if (!sameSet(view.transaction.flags, expected.flags)) say(tx.id, 'transactions.get reads the flags ' + JSON.stringify(view.transaction.flags) + ', but the records give ' + JSON.stringify(expected.flags) + '.');
  }

  // Offers: the read state, and the progress, deadline and condition of an enrolled spending offer.
  const offers = new Map(read('offers.list').items.map(o => [o.id, o]));
  for (const o of data.offers) {
    const shown = offers.get(o.id), state = offerState(o, now), spend = spending(data, o, now);
    const flags = spend && spend.condition === 'met' ? ['condition_met'] : spend && spend.condition === 'missed' ? ['condition_missed'] : [];
    if (!shown || shown.state !== state) { say(o.id, 'the App reads the state ' + (shown && shown.state) + ', but the records give ' + state + '.'); continue; }
    const got = shown.spend && {progress: cents(shown.spend.progress), deadline: ms(shown.spend.deadline), condition: shown.spend.condition};
    if (JSON.stringify(got) !== JSON.stringify(spend) || !sameSet(shown.flags, flags)) say(o.id, 'the App reads the spending ' + JSON.stringify(shown.spend) + ' and the flags ' +
      JSON.stringify(shown.flags) + ', but the records give ' + JSON.stringify(spend && {...spend, progress: text(spend.progress), deadline: new Date(spend.deadline).toISOString()}) + '.');
  }

  // Points: the balance is the sum of the entries.
  const points = total(data.points_entries.map(e => e.points)), rewards = read('rewards.get');
  if (rewards.balance !== points) say('points', 'the App reads a balance of ' + rewards.balance + ', but the entries give ' + points + '.');

  // The account: balance, pending total, available credit, the bill, the points and the flags, and what a closing would do now.
  const account = read('account.get'), balance = balanceAt(data, amounts, now), pending = total(data.transactions.filter(tx => tx.state === 'pending' && tx.kind === 'purchase').map(tx => cents(tx.amount)));
  const list = inOrder(data), latest = list[list.length - 1] || null, paid = latest ? paidToward(data, amounts, latest, now) : 0;
  const expected = {balance: balance / 100, pending_total: pending / 100, available_credit: (cents(data.account.credit_limit) - balance - pending) / 100, points_balance: points,
    latest_statement: latest && {id: latest.id, paid_toward: paid / 100, minimum_left: Math.max(0, cents(latest.minimum_due) - paid) / 100,
      balance_left: Math.max(0, cents(latest.statement_balance) - paid) / 100}, flags: accountFlags(data, amounts, now).sort()};
  const got = {balance: account.balance, pending_total: account.pending_total, available_credit: account.available_credit, points_balance: account.points_balance,
    latest_statement: account.latest_statement && {id: account.latest_statement.id, paid_toward: account.latest_statement.paid_toward,
      minimum_left: account.latest_statement.minimum_left, balance_left: account.latest_statement.balance_left}, flags: [...account.flags].sort()};
  if (JSON.stringify(got) !== JSON.stringify(expected)) say(data.account_id, 'account.get reads ' + JSON.stringify(got) + ', but the records give ' + JSON.stringify(expected) + '.');
  const preview = read('account.close_preview'), closed = data.account.state === 'closed';
  const wanted = {points_lost: closed ? 0 : Math.max(0, points), fee_refund: closed ? null : feeRefund(data, now)};
  const shownPreview = {points_lost: preview.points_lost, fee_refund: preview.fee_refund};
  if (JSON.stringify(shownPreview) !== JSON.stringify(wanted)) say(data.account_id, 'account.close_preview reads ' + JSON.stringify(shownPreview) + ', but the records give ' + JSON.stringify(wanted) + '.');
  return problems;
}

// The package fixture also has the plan's counts and stays under 1 MB.
function planProblems(data, time) {
  const made = counts(data, time);
  const problems = Object.entries(PLAN).filter(([name, value]) => JSON.stringify(made[name]) !== JSON.stringify(value))
    .map(([name, value]) => 'counts: ' + name.replace(/_/g, ' ') + ' is ' + JSON.stringify(made[name]) + ', not ' + JSON.stringify(value) + '.');
  if (fs.statSync(FIXTURE).size >= 1048576) problems.push('size: the fixture is 1 MB or larger.');
  const declared = require('../contribution/dataset.json').expected_counts.records, held = plugin.records(data).length;
  if (declared !== held) problems.push('dataset: contribution/dataset.json declares ' + declared + ' records, and the fixture holds ' + held + '.');
  return problems;
}
function report(label, time, problems) {
  console.log((problems.length ? 'FAIL  ' : 'ok    ') + label + ' at ' + time + (problems.length ? '' : ': consistent') + problems.map(p => '\n      ' + p).join(''));
  return problems.length;
}
function evaluation() {
  let generator, checker;
  try {
    generator = require('./generate-dataset.cjs');
    checker = require('./check-evaluation.cjs');
  } catch (error) {
    console.error('The evaluation check needs dev/generate-dataset.cjs and dev/check-evaluation.cjs, and they cannot be loaded: ' + error.message);
    return 1;
  }
  const {seed, manifest, snapshots} = generator.generate({keepAt: generator.MONTH_STARTS});
  let failed = report('data/evaluation seed', generator.CLOCK, consistency(seed, generator.CLOCK));
  const rows = checker.problems(seed, manifest);
  failed += report('data/evaluation story rules', generator.CLOCK, rows.map(r => r.story_id + ' ' + r.record_id + ' ' + r.rule + ': ' + r.detail));
  for (const at of generator.MONTH_STARTS) failed += report('month-start seed', at, snapshots[at] ? consistency(snapshots[at], at) : ['generate() kept no seed for this time.']);
  return failed;
}
function main(argv) {
  if (argv.includes('--evaluation')) return evaluation();
  if (argv.length) {
    const [file, time] = argv;
    if (!file || !time) { console.error('Usage: node dev/check-fixture.cjs [FILE TIME | --evaluation]'); return 1; }
    return report(file, time, consistency(JSON.parse(fs.readFileSync(file, 'utf8')), time));
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), clock = require('../fixtures/clock.json').initial_time, task = require('./build-task-seed.cjs').CLOCK;
  return report('fixtures/minimal.json', clock, [...consistency(fixture, clock), ...planProblems(fixture, clock)]) +
    report('examples/task-data/seed.json', task, consistency(JSON.parse(fs.readFileSync(TASK_SEED, 'utf8')), task));
}
if (require.main === module) process.exitCode = main(process.argv.slice(2)) ? 1 : 0;
module.exports = {consistency, counts, PLAN};
