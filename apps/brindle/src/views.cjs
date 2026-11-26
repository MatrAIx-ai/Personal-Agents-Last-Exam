'use strict';
const c = require('./common.cjs');
const {ms, cents, money, sum, time, copy} = c;
// Everything here is computed from stored records and the supplied clock when it is read. Nothing is stored.
const CHARGES = new Set(['purchase', 'fee', 'interest', 'reversal']);
const CREDITS = new Set(['refund', 'credit', 'provisional_credit']);
const ENDED = new Set(['resolved_for_me', 'resolved_for_merchant', 'closed_matched']);

// Related records, grouped once per read: transactions by the purchase they relate to and by dispute, and disputes by purchase.
function groups(data) {
  const related = new Map(), byDispute = new Map(), disputes = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const tx of data.transactions) {
    if (tx.relates_to) add(related, tx.relates_to, tx);
    if (tx.dispute_id) add(byDispute, tx.dispute_id, tx);
  }
  for (const d of data.disputes) add(disputes, d.transaction_id, d);
  return {related, byDispute, disputes};
}
const posted = tx => tx.state === 'posted';

// Payments. Stored `cancelled` and `returned` win. Otherwise a payment reads `posted` from `posts_at`, or `skipped` when autopay had nothing left.
function statementOf(data, id) { return id === null ? null : data.statements.find(s => s.id === id) || null; }
function postedAmounts(data) {
  const out = new Map(), order = [...data.payments].sort((a, b) => ms(a.posts_at) - ms(b.posts_at) || c.compare(a.id, b.id));
  for (const p of order) {
    if (p.stored_state === 'cancelled') continue;
    if (!p.autopay) { out.set(p.id, cents(p.scheduled_amount)); continue; }
    // What other payments paid toward the same statement before the start of this payment's day.
    const statement = statementOf(data, p.statement_id), at = ms(p.posts_at), from = statement ? ms(statement.closing_at) : -Infinity;
    const other = sum(order.filter(q => q !== p && out.has(q.id) && ms(q.posts_at) > from && ms(q.posts_at) < at &&
      !(q.stored_state === 'returned' && ms(q.returned_at) < at)).map(q => out.get(q.id)));
    out.set(p.id, Math.max(0, cents(p.scheduled_amount) - other));
  }
  return out;
}
function paymentState(p, amounts, now) {
  if (p.stored_state === 'cancelled' || p.stored_state === 'returned') return p.stored_state;
  if (now < ms(p.posts_at)) return 'scheduled';
  return p.autopay && amounts.get(p.id) === 0 ? 'skipped' : 'posted';
}
function paymentView(p, amounts, now) {
  const {stored_state, ...rest} = p, state = paymentState(p, amounts, now);
  return {...copy(rest), state, posted_amount: state === 'scheduled' || state === 'cancelled' ? null : money(amounts.get(p.id))};
}
// Payments that count at `at`: posted by then, and not returned by then.
function countedPayments(data, amounts, at) {
  return data.payments.filter(p => p.stored_state !== 'cancelled' && ms(p.posts_at) <= at && amounts.get(p.id) > 0 &&
    !(p.stored_state === 'returned' && ms(p.returned_at) <= at));
}

// The balance in cents. With `at`, only what had posted by then counts, and returns that happened by then.
function balance(data, now, at = now, amounts = postedAmounts(data)) {
  let total = 0;
  for (const tx of data.transactions) {
    if (!posted(tx) || ms(tx.posted_at) > at) continue;
    if (CHARGES.has(tx.kind)) total += cents(tx.amount); else if (CREDITS.has(tx.kind)) total -= cents(tx.amount);
  }
  return total - sum(countedPayments(data, amounts, at).map(p => amounts.get(p.id)));
}
const pendingTotal = data => sum(data.transactions.filter(tx => tx.state === 'pending' && tx.kind === 'purchase').map(tx => cents(tx.amount)));

// The latest statement: the latest closing time, then the later issue time, then the later one in the list.
function ordered(data) {
  return data.statements.map((s, i) => ({s, i})).sort((a, b) => ms(a.s.closing_at) - ms(b.s.closing_at) || ms(a.s.issued_at) - ms(b.s.issued_at) || a.i - b.i).map(x => x.s);
}
const latestStatement = data => { const list = ordered(data); return list.length ? list[list.length - 1] : null; };
// The cycle of a statement: after the closing of the one before, up to its own closing. Payments toward it come after its closing,
// up to the next closing when it is not the latest.
function bounds(data, statement) {
  const list = ordered(data), i = list.indexOf(statement);
  return {previous: i > 0 ? ms(list[i - 1].closing_at) : -Infinity, closing: ms(statement.closing_at), next: i < list.length - 1 ? ms(list[i + 1].closing_at) : Infinity};
}
function paidToward(data, statement, now, amounts = postedAmounts(data)) {
  const {closing, next} = bounds(data, statement);
  return sum(countedPayments(data, amounts, now).filter(p => ms(p.posts_at) > closing && ms(p.posts_at) <= next).map(p => amounts.get(p.id)));
}
function bill(data, now, amounts = postedAmounts(data)) {
  const s = latestStatement(data);
  if (!s) return null;
  const paid = paidToward(data, s, now, amounts);
  return {statement: s, paid, minimumLeft: Math.max(0, cents(s.minimum_due) - paid), balanceLeft: Math.max(0, cents(s.statement_balance) - paid), duePassed: now >= ms(s.due_at)};
}
function statementRow(data, s, now, amounts) {
  return {...copy(s), paid_toward: money(paidToward(data, s, now, amounts)), due_passed: now >= ms(s.due_at)};
}
function statementView(data, s, now) {
  const amounts = postedAmounts(data), {previous, closing, next} = bounds(data, s);
  const payments = data.payments.filter(p => p.statement_id === s.id || ms(p.posts_at) > closing && ms(p.posts_at) <= next)
    .sort(c.byTime('posts_at')).map(p => paymentView(p, amounts, now));
  const ids = data.transactions.filter(tx => posted(tx) && ms(tx.posted_at) > previous && ms(tx.posted_at) <= closing).sort(c.byTime('posted_at')).map(tx => tx.id);
  return {...statementRow(data, s, now, amounts), payments, transaction_ids: ids};
}

// Disputes and the recovery summary of a purchase, in cents.
function outstanding(g, d) {
  const rows = (g.byDispute.get(d.id) || []).filter(posted);
  return Math.max(0, sum(rows.filter(tx => tx.kind === 'provisional_credit').map(tx => cents(tx.amount))) - sum(rows.filter(tx => tx.kind === 'reversal').map(tx => cents(tx.amount))));
}
function recovery(g, purchase) {
  const refunds = sum((g.related.get(purchase.id) || []).filter(tx => tx.kind === 'refund' && posted(tx)).map(tx => cents(tx.amount)));
  let final = refunds, temporary = 0;
  for (const d of g.disputes.get(purchase.id) || []) {
    if (d.state === 'resolved_for_me') final += outstanding(g, d); else temporary += outstanding(g, d);
  }
  return {amount: cents(purchase.amount), refunded_final: final, temporary_credit: temporary, net_charge: cents(purchase.amount) - final};
}
function purchaseFlags(g, tx) {
  if (tx.kind !== 'purchase') return [];
  const r = recovery(g, tx), flags = [];
  if ((g.disputes.get(tx.id) || []).some(d => d.state === 'open')) flags.push('disputed');
  if (r.temporary_credit > 0) flags.push('temporary_credit');
  if (r.refunded_final + r.temporary_credit > r.amount) flags.push('double_credited');
  return flags;
}
const moneyRecovery = r => ({amount: money(r.amount), refunded_final: money(r.refunded_final), temporary_credit: money(r.temporary_credit), net_charge: money(r.net_charge)});
const txRow = (g, tx) => ({id: tx.id, kind: tx.kind, state: tx.state, amount: tx.amount, merchant: tx.merchant, transaction_at: tx.transaction_at, posted_at: tx.posted_at,
  relates_to: tx.relates_to, dispute_id: tx.dispute_id, flags: purchaseFlags(g, tx)});
function disputeView(data, g, d) {
  const purchase = data.transactions.find(tx => tx.id === d.transaction_id);
  return {...copy(d), merchant: purchase.merchant, purchase_amount: purchase.amount, outstanding: money(outstanding(g, d))};
}

// Offers. Only a stored `available` offer reads `expired`, once the clock reaches its `accept_by`.
function offerState(o, now) {
  return o.stored_state === 'available' && now >= ms(o.accept_by) ? 'expired' : o.stored_state;
}
const deadlineOf = (data, o) => time.limitEnd(c.dayOf(data, o.enrolled_at), o.spend_days, c.zone(data));
// An accepted spending offer: purchases posted from the acceptance to the deadline, minus the refunds of those purchases that posted by the deadline.
function spend(data, o, now) {
  if (o.kind !== 'spend_credit' || o.stored_state !== 'enrolled') return null;
  const from = ms(o.enrolled_at), deadline = deadlineOf(data, o);
  const counted = data.transactions.filter(tx => tx.kind === 'purchase' && posted(tx) && ms(tx.posted_at) >= from && ms(tx.posted_at) < deadline);
  const ids = new Set(counted.map(tx => tx.id));
  const refunds = data.transactions.filter(tx => tx.kind === 'refund' && posted(tx) && ids.has(tx.relates_to) && ms(tx.posted_at) < deadline);
  const progress = sum(counted.map(tx => cents(tx.amount))) - sum(refunds.map(tx => cents(tx.amount))), met = progress >= cents(o.spend_target);
  const condition = met ? 'met' : now >= deadline || c.closed(data) ? 'missed' : 'open';
  return {target: o.spend_target, progress: money(progress), deadline: time.iso(deadline, c.zone(data)), condition};
}
const paidBy = (data, o) => [...data.transactions.filter(tx => tx.offer_id === o.id), ...data.points_entries.filter(e => e.offer_id === o.id)].map(x => x.id);
function offerView(data, o, now) {
  const {stored_state, ...rest} = o, s = spend(data, o, now);
  const flags = s && s.condition === 'met' ? ['condition_met'] : s && s.condition === 'missed' ? ['condition_missed'] : [];
  return {...copy(rest), state: offerState(o, now), spend: s, flags, paid_by: paidBy(data, o)};
}
const offerBrief = (o, now) => ({id: o.id, kind: o.kind, state: offerState(o, now), terms: o.terms});

// Points.
const pointsBalance = data => sum(data.points_entries.map(e => e.points));

// The annual fee that a closing or a product change now would refund: the latest posted annual fee, within `fee_refund_days`, refunded once.
function feeRefund(data, now) {
  const fees = data.transactions.filter(tx => tx.kind === 'fee' && tx.fee_type === 'annual' && posted(tx)).sort(c.byTime('posted_at'));
  const fee = fees[fees.length - 1];
  if (!fee) return null;
  const end = time.limitEnd(c.dayOf(data, fee.posted_at), data.issuer.rules.fee_refund_days, c.zone(data));
  if (now >= end || data.account.fee_refunds.some(r => r.fee_id === fee.id)) return null;
  return {fee, end};
}
function accountFlags(data, now, amounts = postedAmounts(data)) {
  const flags = [], b = bill(data, now, amounts), total = balance(data, now, now, amounts);
  if (b && b.duePassed && total > 0) {
    if (b.paid < cents(b.statement.minimum_due)) flags.push('past_due');
    else if (b.paid < cents(b.statement.statement_balance)) flags.push('statement_unpaid');
  }
  if (b && data.payments.some(p => p.stored_state === 'returned' && ms(p.posts_at) > ms(b.statement.closing_at))) flags.push('payment_returned');
  if (total < 0) flags.push('credit_balance');
  if (!c.closed(data) && feeRefund(data, now)) flags.push('fee_refund_open');
  return flags;
}
// What `account.close` would do now. Writes nothing.
function closePreview(data, now) {
  const empty = {balance: money(balance(data, now)), scheduled_payments: [], open_disputes: [], pending_transactions: [], credits_owed: []};
  if (c.closed(data)) return {already_closed: true, points_lost: 0, fee_refund: null, offers_ending: [], bonus_not_arrived: [], stays_open: empty};
  const amounts = postedAmounts(data), refund = feeRefund(data, now), points = Math.max(0, pointsBalance(data));
  const enrolled = data.offers.filter(o => o.stored_state === 'enrolled'), notPaid = o => !paidBy(data, o).length;
  const missedOnClose = o => { const s = spend(data, o, now); return s && s.condition === 'open'; };
  return {already_closed: false, points_lost: points,
    fee_refund: refund ? {fee_id: refund.fee.id, amount: refund.fee.amount, until: time.addDays(time.localDay(refund.end, c.zone(data)), -1)} : null,
    offers_ending: data.offers.filter(o => offerState(o, now) === 'available' || o.stored_state === 'enrolled' && missedOnClose(o)).map(o => offerBrief(o, now)),
    bonus_not_arrived: enrolled.filter(o => o.kind === 'bonus_points' && notPaid(o)).map(o => offerBrief(o, now)),
    stays_open: {balance: money(balance(data, now, now, amounts)), scheduled_payments: data.payments.filter(p => paymentState(p, amounts, now) === 'scheduled').map(p => p.id),
      open_disputes: data.disputes.filter(d => d.state === 'open').map(d => d.id),
      pending_transactions: data.transactions.filter(tx => tx.state === 'pending').map(tx => tx.id),
      credits_owed: enrolled.filter(o => notPaid(o) && (o.kind === 'statement_credit' || o.kind === 'spend_credit' && spend(data, o, now).condition === 'met')).map(o => o.id)}};
}
module.exports = {CHARGES, CREDITS, ENDED, groups, posted, postedAmounts, paymentState, paymentView, balance, pendingTotal, ordered, latestStatement, paidToward, bill,
  statementRow, statementView, outstanding, recovery, moneyRecovery, purchaseFlags, txRow, disputeView, offerState, spend, offerView, offerBrief, paidBy, pointsBalance,
  feeRefund, accountFlags, closePreview};
