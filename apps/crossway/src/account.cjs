'use strict';
// Balance movements: the ledger, toll debits, auto-replenish, suspension and
// violation notices created by tolls. Callers have already settled time effects.
const R = require('./rules.cjs');
const C = require('./clock.cjs');
const {nextId} = require('./ids.cjs');
const {notify, money} = require('./notices.cjs');
const {history, shortDate, localTime} = require('./settle.cjs');

function ledger(data, at, kind, amount, ref_id) {
  data.balance_cents += amount;
  const row = {id: nextId(data.ledger, 'lg'), at, kind, amount_cents: amount, balance_cents: data.balance_cents, ref_id};
  data.ledger.push(row);
  return row;
}

function receipt(data, fields) {
  const r = {id: nextId(data.receipts, 'rc'), card_id: null, amount_cents: 0, notice_ids: [], dispute_id: null,
    status: 'approved', failure_code: null, ...fields};
  data.receipts.push(r);
  return r;
}

// One auto-replenish attempt on the rule's card. Two consecutive failures suspend the account.
function replenish(data, at, now) {
  const rule = data.replenish, c = R.card(data, rule.card_id), problem = R.cardProblem(c, now);
  if (!problem) {
    const r = receipt(data, {kind: 'replenish', created_at: at, card_id: c.id, amount_cents: rule.amount_cents});
    ledger(data, at, 'replenish', rule.amount_cents, r.id);
    rule.consecutive_failures = 0;
    notify(data, {at, kind: 'receipt', object_type: 'receipt', object_id: r.id,
      title: `Auto-replenish: ${money(rule.amount_cents)} charged to ${R.cardLabel(c)}`,
      fields: [['Receipt', r.id], ['Card', `${R.cardLabel(c)}, cardholder ${c.holder_name}`], ['Amount', money(rule.amount_cents)],
        ['New balance', money(data.balance_cents)]]});
    return true;
  }
  const r = receipt(data, {kind: 'replenish', created_at: at, card_id: c.id, amount_cents: rule.amount_cents, status: 'failed', failure_code: problem});
  rule.consecutive_failures += 1;
  notify(data, {at, kind: 'replenish_failed', object_type: 'receipt', object_id: r.id,
    title: `Auto-replenish failed: ${R.cardLabel(c)} was ${problem === 'card_expired' ? 'expired' : 'declined'}`,
    fields: [['Card', `${R.cardLabel(c)}, cardholder ${c.holder_name}`], ['Amount', money(rule.amount_cents)],
      ['Balance', money(data.balance_cents)], ['Consecutive failures', rule.consecutive_failures],
      ['Next step', 'Two failed attempts in a row, or a balance below zero, suspend the account until a top-up succeeds.']]});
  return false;
}

function suspend(data, at, why) {
  data.suspended_at = at;
  notify(data, {at, kind: 'account_suspended', object_type: 'account', object_id: data.account_id,
    title: 'Your Crossway account is suspended',
    fields: [['Account', data.account_id], ['Reason', why], ['Balance', money(data.balance_cents)],
      ['Effect', 'Every toll is billed by violation notice at the mail rate until a top-up succeeds.']]});
}

// A transponder read on a usable account debits the balance at the account rate.
function debitToll(data, toll, at, now) {
  const before = data.balance_cents, rule = data.replenish;
  toll.ledger_id = ledger(data, at, 'toll', -toll.amount_cents, toll.id).id;
  if (data.balance_cents < rule.threshold_cents && rule.enabled) replenish(data, at, now);
  if (rule.consecutive_failures >= 2) suspend(data, at, 'Two auto-replenish attempts in a row failed.');
  else if (data.balance_cents < 0) suspend(data, at, 'The balance fell below zero.');
  else if (before >= rule.threshold_cents && data.balance_cents < rule.threshold_cents) {
    notify(data, {at, kind: 'balance_low', object_type: 'account', object_id: data.account_id,
      title: `Crossway balance is low: ${money(data.balance_cents)}`,
      fields: [['Account', data.account_id], ['Balance', money(data.balance_cents)], ['Low-balance threshold', money(rule.threshold_cents)],
        ['Auto-replenish', rule.enabled ? `on, ${money(rule.amount_cents)} from card ${rule.card_id}` : 'off']]});
  }
}

// A plate-only read, or any read while suspended, becomes a violation notice at the mail rate.
function issueNotice(data, toll, v, at) {
  const pol = R.policy(data), issue = C.localDate(C.ms(at));
  const n = {id: nextId(data.notices, 'n'), toll_id: toll.id, vehicle_id: v ? v.id : null, plate: toll.plate_seen,
    plaza_id: toll.plaza_id, toll_at: toll.at, class_charged: toll.class_charged, issued_at: at, issue_date: issue,
    toll_cents: toll.amount_cents, late_fee_cents: 0, state: 'issued', due_date: C.addDays(issue, pol.notice_due_days),
    escalated_at: null, collections_at: null, paid_at: null, payment_receipt_id: null, dispute_id: null, history: []};
  history(n, at, 'issued', {due_date: n.due_date});
  data.notices.push(n);
  toll.notice_id = n.id;
  const p = R.plaza(data, toll.plaza_id);
  notify(data, {at, kind: 'notice_issued', object_type: 'notice', object_id: n.id,
    title: `Toll notice ${n.id}: ${money(n.toll_cents)} due by ${shortDate(n.due_date)} for plate ${n.plate}`,
    fields: [['Notice', n.id], ['Plate', n.plate], ['Toll', `${p.name} plaza, ${localTime(toll.at)}`],
      ['Vehicle class charged', toll.class_charged], ['Amount due', money(n.toll_cents)], ['Due date', n.due_date],
      ['Dispute window closes', R.disputeWindowCloses(data, n)],
      ['Late fee if unpaid', `${money(pol.late_fee_cents)}, then collections ${pol.escalated_due_days} days later`]]});
  return n;
}

module.exports = {ledger, receipt, replenish, suspend, debitToll, issueNotice};
