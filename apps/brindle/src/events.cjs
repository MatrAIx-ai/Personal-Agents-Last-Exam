'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const rules = require('./rules.cjs');
const notices = require('./notices.cjs');
const {ms, cents, money, time} = c;
const A = c.APP + '.';
// What the issuer and the merchants do arrives here. Their acts are applied as given: only the plan's listed rules are checked.
const bad = message => c.fail('invalid_event', message);
const fresh = (data, id) => { if (c.allIds(data).includes(id)) bad('The ID ' + id + ' already exists.'); };
const positive = value => { if (!c.twoDecimals(value) || value <= 0) bad('An amount is zero or less, or it has more than two decimals.'); };
const decimal = value => { if (!c.twoDecimals(value)) bad('An amount has more than two decimals.'); };
const mark = (t, list, action, extra = {}) => list.push({at: t.at, action, actor: t.actor, ref: t.ref, ...extra});
function newTx(t, p, extra) {
  return {id: p.transaction_id, kind: p.kind, state: p.state, amount: p.amount, pending_amount: null, merchant: p.merchant ?? null, note: p.note ?? null,
    transaction_at: p.transaction_at ?? t.at, added_at: t.at, posted_at: p.state === 'posted' ? t.at : null, dropped_at: null, drop_reason: null,
    relates_to: p.relates_to ?? null, dispute_id: p.dispute_id ?? null, offer_id: p.offer_id ?? null, fee_type: p.fee_type ?? null, points_entry_id: null,
    event_id: t.ref, request_id: null, history: [], ...extra};
}

const handlers = {
  'transaction.posted'(t, data, p) {
    const existing = data.transactions.find(x => x.id === p.transaction_id);
    // A posting event for a pending transaction reuses its ID. It changes only the amount and the note.
    if (existing) {
      if (existing.state !== 'pending' || p.state !== 'posted') bad('The ID ' + p.transaction_id + ' already exists.');
      positive(p.amount);
      Object.assign(existing, {state: 'posted', posted_at: t.at, pending_amount: existing.amount, amount: p.amount, note: p.note ?? existing.note});
      mark(t, existing.history, 'transaction.posted', {amount: p.amount});
      c.record(t, data, 'transaction.posted', existing.id);
      return {object: existing.id, tx: existing, notify: existing.kind !== 'purchase'};
    }
    fresh(data, p.transaction_id);
    positive(p.amount);
    for (const [key, list] of [['relates_to', data.transactions], ['offer_id', data.offers], ['dispute_id', data.disputes]]) {
      if (p[key] !== undefined && !list.some(x => x.id === p[key])) bad('The event names ' + p[key] + ', which does not exist.');
    }
    if (p.kind === 'provisional_credit') bad('A temporary credit arrives only with dispute.updated.');
    let relates = {};
    if (p.kind === 'reversal') {
      const dispute = data.disputes.find(d => d.id === p.dispute_id);
      if (dispute.state === 'open') bad('A reversal for an open dispute arrives with dispute.updated.');
      relates = {relates_to: dispute.transaction_id, merchant: p.merchant ?? data.transactions.find(x => x.id === dispute.transaction_id).merchant};
    }
    const tx = newTx(t, p, relates);
    if (tx.state === 'posted') mark(t, tx.history, 'transaction.posted', {amount: tx.amount}); else mark(t, tx.history, 'transaction.pending', {amount: tx.amount});
    data.transactions.push(tx);
    c.record(t, data, 'transaction.posted', tx.id);
    return {object: tx.id, tx, notify: tx.kind !== 'purchase'};
  },
  'transaction.dropped'(t, data, p) {
    const tx = data.transactions.find(x => x.id === p.transaction_id) || bad('The event names a transaction that does not exist.');
    if (tx.state !== 'pending') bad('Only a pending transaction can be dropped. This one is ' + tx.state + '.');
    Object.assign(tx, {state: 'dropped', dropped_at: t.at, drop_reason: p.reason ?? null});
    mark(t, tx.history, 'transaction.dropped', {amount: null});
    c.record(t, data, 'transaction.dropped', tx.id);
    return {object: tx.id, notify: false};
  },
  'statement.issued'(t, data, p) {
    fresh(data, p.statement_id);
    decimal(p.statement_balance);
    decimal(p.minimum_due);
    const statement = {id: p.statement_id, closing_at: p.closing_at, issued_at: t.at, due_at: p.due_at, statement_balance: p.statement_balance,
      minimum_due: p.minimum_due, event_id: t.ref, autopay_payment_id: null};
    data.statements.push(statement);
    c.record(t, data, 'statement.issued', statement.id);
    // The Autopay rule: one payment for the day of the due time, for the minimum due or the statement balance of this statement.
    const mode = data.account.autopay.mode, amount = mode === 'minimum_due' ? cents(p.minimum_due) : mode === 'statement_balance' ? cents(p.statement_balance) : 0;
    let payment = null;
    if (amount > 0) {
      const day = c.dayOf(data, p.due_at), zone = c.zone(data);
      payment = {id: c.nextId(c.allIds(data), 'pay-'), source: data.account.autopay.source, amount_type: mode, statement_id: statement.id, scheduled_amount: money(amount),
        autopay: true, pay_on: day, posts_at: time.iso(Math.max(time.startOfDay(day, zone), t.now), zone), scheduled_at: t.at, stored_state: 'scheduled',
        cancelled_at: null, returned_at: null, return_reason: null, request_id: null, event_id: t.ref, history: []};
      data.payments.push(payment);
      statement.autopay_payment_id = payment.id;
      c.record(t, data, 'autopay.scheduled', payment.id, true, payment.history);
    }
    return {object: statement.id, statement, payment, notify: true};
  },
  'payment.returned'(t, data, p) {
    const payment = data.payments.find(x => x.id === p.payment_id) || bad('The event names a payment that does not exist.');
    const amounts = views.postedAmounts(data);
    if (views.paymentState(payment, amounts, t.now) !== 'posted') bad('Only a posted payment can be returned. This one is ' + views.paymentState(payment, amounts, t.now) + '.');
    Object.assign(payment, {stored_state: 'returned', returned_at: t.at, return_reason: p.reason ?? null});
    c.record(t, data, 'payment.returned', payment.id, false, payment.history);
    return {object: payment.id, payment, amount: amounts.get(payment.id), notify: true};
  },
  'dispute.updated'(t, data, p) {
    const dispute = data.disputes.find(d => d.id === p.dispute_id) || bad('The event names a dispute that does not exist.');
    if (dispute.state !== 'open') bad('The dispute is ' + dispute.state + '. Only an open dispute takes an update.');
    const moves = [['provisional_credit', p.provisional_credit], ['reversal', p.reversal]].filter(([, move]) => move);
    for (const [, move] of moves) { fresh(data, move.transaction_id); positive(move.amount); }
    if (moves.length === 2 && p.provisional_credit.transaction_id === p.reversal.transaction_id) bad('The temporary credit and the reversal use one ID.');
    const purchase = data.transactions.find(x => x.id === dispute.transaction_id), made = {};
    c.record(t, data, 'dispute.updated', dispute.id);
    for (const [kind, move] of moves) {
      const tx = newTx(t, {transaction_id: move.transaction_id, kind, state: 'posted', amount: move.amount, merchant: purchase.merchant, relates_to: purchase.id,
        dispute_id: dispute.id, note: kind === 'reversal' ? 'Temporary credit taken back' : 'Temporary credit during a dispute'}, {});
      mark(t, tx.history, 'transaction.posted', {amount: tx.amount});
      data.transactions.push(tx);
      made[kind] = tx;
      c.record(t, data, kind === 'reversal' ? 'reversal.posted' : 'temporary_credit.posted', tx.id, true);
    }
    dispute.state = p.status;
    if (views.ENDED.has(p.status)) dispute.ended_at = t.at;
    dispute.history.push({at: t.at, status: p.status, note: p.note ?? null, actor: 'event', ref: t.ref,
      credit_id: made.provisional_credit ? made.provisional_credit.id : null, reversal_id: made.reversal ? made.reversal.id : null});
    return {object: dispute.id, dispute, credit: made.provisional_credit || null, reversal: made.reversal || null, note: p.note ?? null, notify: true};
  },
  'offer.issued'(t, data, p) {
    fresh(data, p.offer_id);
    if (p.product_id !== undefined && !data.products.some(x => x.id === p.product_id)) bad('The offer names a product that does not exist.');
    if (c.closed(data)) bad('The account is closed. It takes no offers.');
    if (p.group !== undefined && data.offers.some(o => o.group === p.group && o.stored_state === 'enrolled')) bad('The group ' + p.group + ' already has an enrolled offer.');
    for (const value of [p.credit_amount, p.spend_target]) if (value !== undefined) positive(value);
    const offer = {id: p.offer_id, kind: p.kind, group: p.group ?? null, terms: p.terms, accept_by: p.accept_by, issued_at: t.at, event_id: t.ref,
      credit_amount: p.credit_amount ?? null, spend_target: p.spend_target ?? null, spend_days: p.spend_days ?? null, points: p.points ?? null, product_id: p.product_id ?? null,
      stored_state: 'available', enrolled_at: null, declined_at: null, unavailable_at: null, unavailable_cause: null, request_id: null, history: []};
    mark(t, offer.history, 'offer.issued');
    data.offers.push(offer);
    c.record(t, data, 'offer.issued', offer.id);
    return {object: offer.id, offer, notify: true};
  },
  'points.adjusted'(t, data, p) {
    fresh(data, p.entry_id);
    if (p.offer_id !== undefined && !data.offers.some(o => o.id === p.offer_id)) bad('The entry names an offer that does not exist.');
    if (p.points > 0 && c.closed(data)) bad('The account is closed. It takes no points.');
    const entry = {id: p.entry_id, at: t.at, points: p.points, reason: p.reason, note: p.note ?? null, offer_id: p.offer_id ?? null, transaction_id: null, transfer: null,
      event_id: t.ref, request_id: null, history: []};
    mark(t, entry.history, 'points.adjusted');
    data.points_entries.push(entry);
    c.record(t, data, 'points.adjusted', entry.id);
    return {object: entry.id, entry, notify: true};
  }
};
function applyEvent(ctx, data, event) {
  const kind = event.operation.startsWith(A) ? event.operation.slice(A.length) : '';
  if (!handlers[kind]) bad('Unsupported operation.');
  const t = {ctx, at: event.at, now: ms(event.at), actor: 'event', ref: event.event_id};
  const {object, notify, ...details} = handlers[kind](t, data, event.payload);
  if (notify) notices.write(t, data, kind, object, details);
  // The same rules as a seed. A failure rejects the event and leaves the state unchanged.
  rules.validate(ctx, data, 'invalid_event');
  return data;
}
module.exports = {applyEvent};
