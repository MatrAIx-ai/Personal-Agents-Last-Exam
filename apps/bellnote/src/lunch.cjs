'use strict';
// W4: lunch balances, the cafeteria's charges, menus with allergen tags, top-ups and settings.
const c = require('./common.cjs');
const {notify, money} = require('./notify.cjs');

const accountOf = (data, childId) => data.lunch_accounts.find(a => a.child_id === childId) || null;
// restricted_item and over_daily_limit are derived on every read and never stored.
function transactionViews(data, acct) {
  const kid = c.child(data, acct.child_id), zone = c.tz(data), spent = new Map();
  return data.lunch_transactions.filter(t => t.lunch_account_id === acct.id).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map(t => {
      const day = c.time.localDate(t.at, zone);
      // The day's spending is its purchases net of same-day meal refunds (a refund credited to the
      // balance, not a top-up returned to its card); it never goes below zero.
      let over = false;
      if (t.kind === 'purchase') {
        const total = (spent.get(day) || 0) - t.amount_cents;
        spent.set(day, total);
        over = acct.daily_limit_cents !== null && total > acct.daily_limit_cents;
      } else if (t.kind === 'refund' && !t.payment_id && t.amount_cents > 0) {
        spent.set(day, Math.max(0, (spent.get(day) || 0) - t.amount_cents));
      }
      return {...c.copy(t), local_date: day, restricted_item: t.allergens.some(a => kid.meal_restrictions.includes(a)), over_daily_limit: over};
    });
}
function accountGet(ctx, data, args) {
  const acct = c.find(data.lunch_accounts, args.id, 'Lunch account'), kid = c.child(data, acct.child_id);
  const {start, end} = c.windowOf(ctx, data, args, 14, 0);
  const transactions = transactionViews(data, acct).filter(t => t.local_date >= start && t.local_date <= end);
  return {account: {...c.copy(acct), meal_restrictions: c.copy(kid.meal_restrictions), below_threshold: acct.balance_cents < acct.low_balance_threshold_cents},
    start, end, transactions};
}
function menu(ctx, data, args) {
  const {start, end} = c.windowOf(ctx, data, args, 0, 6);
  const schools = args.id ? [c.school(data, args.id)] : data.schools.filter(s => data.children.some(k => k.school_id === s.id));
  const days = [];
  for (const s of schools) {
    const kids = data.children.filter(k => k.school_id === s.id);
    for (const date of c.time.eachDate(start, end)) {
      if (!c.dayInfo(data, s, date).school_day) continue;
      const m = data.menu_days.find(x => x.school_id === s.id && x.date === date);
      days.push({school_id: s.id, date, menu_published: !!m,
        items: m ? m.items.map(i => ({...c.copy(i), excluded_for: kids.filter(k => i.allergens.some(a => k.meal_restrictions.includes(a))).map(k => k.id)})) : []});
    }
  }
  return {start, end, days};
}
function topup(ctx, data, args) {
  const acct = c.find(data.lunch_accounts, args.id, 'Lunch account');
  c.requireRight(data, acct.child_id, 'can_pay');
  const p = c.policy(data, c.schoolOf(data, acct.child_id));
  if (args.amount_cents < p.topup_min_cents || args.amount_cents > p.topup_max_cents) {
    c.fail('amount_out_of_range', 'A top-up must be between ' + money(p.topup_min_cents) + ' and ' + money(p.topup_max_cents) + '.');
  }
  const m = c.chargeableMethod(ctx, data, args.payment_method_id);
  const payment = {id: c.nextId(data.payments, 'pay'), kind: 'lunch_topup', child_id: acct.child_id, amount_cents: args.amount_cents,
    payment_method_id: m.id, object_type: 'lunch_transaction', object_id: null, status: 'paid', paid_at: ctx.virtual_now,
    refunded_at: null, refund_reason: null, request_id: args.request_id};
  const tx = {id: c.nextId(data.lunch_transactions, 'tx'), lunch_account_id: acct.id, child_id: acct.child_id, kind: 'topup',
    amount_cents: args.amount_cents, item: null, allergens: [], at: ctx.virtual_now, payment_id: payment.id, note: null,
    request_id: args.request_id, event_id: null};
  payment.object_id = tx.id;
  data.payments.push(payment); data.lunch_transactions.push(tx);
  acct.balance_cents += args.amount_cents;
  if (acct.balance_cents >= acct.low_balance_threshold_cents) acct.low_balance_notified = false;
  c.activity(ctx, data, {actor: 'agent', action: 'lunch.topup', child_id: acct.child_id, object_id: acct.id, request_id: args.request_id});
  return {id: acct.id, transaction_id: tx.id, payment: c.copy(payment), balance_cents: acct.balance_cents};
}
function settings(ctx, data, args) {
  const acct = c.find(data.lunch_accounts, args.id, 'Lunch account');
  c.requireRight(data, acct.child_id, 'can_pay');
  const has = k => Object.hasOwn(args, k);
  if (!has('low_balance_threshold_cents') && !has('daily_limit_cents')) c.fail('invalid_arguments', 'Give a threshold, a daily limit or both.');
  if (has('low_balance_threshold_cents') && args.low_balance_threshold_cents < 0) c.fail('invalid_arguments', 'The threshold cannot be negative.');
  if (has('daily_limit_cents') && args.daily_limit_cents !== null && args.daily_limit_cents < 0) c.fail('invalid_arguments', 'The daily limit cannot be negative.');
  if (has('low_balance_threshold_cents')) acct.low_balance_threshold_cents = args.low_balance_threshold_cents;
  if (has('daily_limit_cents')) acct.daily_limit_cents = args.daily_limit_cents;
  // A guardian who sets the threshold already knows where the balance stands: the next notice
  // waits for the next crossing.
  acct.low_balance_notified = acct.balance_cents < acct.low_balance_threshold_cents;
  c.activity(ctx, data, {actor: 'agent', action: 'lunch.settings_update', child_id: acct.child_id, object_id: acct.id, request_id: args.request_id});
  return {id: acct.id, low_balance_threshold_cents: acct.low_balance_threshold_cents, daily_limit_cents: acct.daily_limit_cents};
}

// ---- events ----------------------------------------------------------------------------------
function charged(ctx, data, event, row) {
  const p = event.payload;
  if (c.idTaken(data, p.transaction_id)) c.fail('invalid_event', 'Object ID ' + p.transaction_id + ' already exists.');
  const kid = data.children.find(k => k.id === p.child_id), acct = kid && accountOf(data, kid.id);
  if (!kid || !acct) c.fail('invalid_event', 'Unknown child or lunch account.');
  const allergens = p.allergens || [];
  if (p.kind === 'purchase' && !(p.amount_cents < 0 && p.item)) c.fail('invalid_event', 'A purchase has a negative amount and an item.');
  if (p.kind === 'adjustment' && p.amount_cents === 0) c.fail('invalid_event', 'An adjustment changes the balance.');
  let payment = null;
  if (p.kind === 'refund') {
    if (p.payment_id) {
      payment = data.payments.find(x => x.id === p.payment_id);
      if (!payment || payment.kind !== 'lunch_topup' || payment.child_id !== kid.id || payment.status !== 'paid') c.fail('invalid_event', 'The refund names no paid top-up for this child.');
      if (p.amount_cents !== -payment.amount_cents) c.fail('invalid_event', 'A top-up refund returns exactly the top-up to its payment method.');
    } else if (!(p.amount_cents > 0)) c.fail('invalid_event', 'A meal refund credits the balance.');
  }
  const limit = c.policy(data, c.school(data, kid.school_id)).meal_debt_limit_cents, balance = acct.balance_cents + p.amount_cents;
  if (p.amount_cents < 0 && balance < -limit) c.fail('invalid_event', 'The charge would take the balance past the debt limit of ' + money(limit) + '.');
  const tx = {id: p.transaction_id, lunch_account_id: acct.id, child_id: kid.id, kind: p.kind, amount_cents: p.amount_cents,
    item: p.item || null, allergens: c.copy(allergens), at: ctx.virtual_now, payment_id: p.payment_id || null, note: p.note || null,
    request_id: null, event_id: event.event_id};
  data.lunch_transactions.push(tx);
  acct.balance_cents = balance;
  row.child_id = kid.id; row.object_id = tx.id;
  if (payment) { payment.status = 'refunded'; payment.refunded_at = ctx.virtual_now; payment.refund_reason = 'cafeteria_refund'; }
  if (p.kind === 'refund') {
    notify(ctx, data, {kind: 'lunch.refund', child_id: kid.id, object_type: 'lunch_transaction', object_id: tx.id, event_id: event.event_id, cause_seq: row.seq,
      title: 'Lunch refund for ' + kid.display_name + ': ' + money(Math.abs(p.amount_cents)),
      body: payment ? 'The cafeteria office refunded the ' + money(payment.amount_cents) + ' top-up of ' + c.time.longDate(c.time.localDate(payment.paid_at, c.tz(data))) + ' to its payment method. ' + kid.display_name + "'s balance is now " + money(balance) + '.'
        : 'The cafeteria credited ' + money(p.amount_cents) + ' to ' + kid.display_name + "'s lunch account" + (p.item ? ' for ' + p.item : '') + '. Balance: ' + money(balance) + '.'});
  }
  if (balance < acct.low_balance_threshold_cents && !acct.low_balance_notified) {
    acct.low_balance_notified = true;
    notify(ctx, data, {kind: 'lunch.low_balance', child_id: kid.id, object_type: 'lunch_account', object_id: acct.id, event_id: event.event_id, cause_seq: row.seq,
      title: kid.display_name + "'s lunch balance is " + money(balance),
      body: kid.display_name + "'s lunch balance fell to " + money(balance) + ', under your threshold of ' + money(acct.low_balance_threshold_cents) + '.'});
  } else if (balance >= acct.low_balance_threshold_cents) acct.low_balance_notified = false;
}
module.exports = {accountGet, menu, topup, settings, charged, transactionViews, accountOf};
