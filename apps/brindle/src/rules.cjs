'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const {ms, time} = c;
// A stored time is a full timestamp with a UTC offset. The wire message of a notification follows Mail's schema instead.
const TIME_KEY = /^at$|_at$|^accept_by$/, WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const noOffset = value => Object.entries(value).some(([key, item]) => typeof item === 'string' ? TIME_KEY.test(key) && !WITH_OFFSET.test(item)
  : item !== null && typeof item === 'object' && key !== 'email' && noOffset(item));
const OWN_KIND = {provisional_credit: true, reversal: true};
const APP_REASONS = new Set(['redeemed', 'transferred', 'forfeited']);

// The rules that a seed must keep. Core runs them on every loaded seed, and the App runs them after every event.
function validate(ctx, data, code = 'invalid_seed') {
  const bad = message => c.fail(code, message);

  const amounts = (...values) => { if (values.some(v => v !== null && v !== undefined && !c.twoDecimals(v))) bad('An amount or a rate has more than two decimals.'); };
  if (!time.validZone(c.zone(data)) || !time.validZone(data.preferences.timezone)) bad('A time zone is unknown.');
  if (noOffset(data)) bad('A timestamp has no UTC offset.');
  const ids = new Set();
  const take = id => { if (ids.has(id)) bad('The ID ' + id + ' is used twice.'); ids.add(id); };
  const rules = data.issuer.rules;
  amounts(rules.redeem_cents_per_point, data.account.credit_limit);

  // The issuer's products and their transfer partners.
  for (const product of data.products) {
    take(product.id);
    amounts(product.annual_fee, ...product.partners.map(p => p.ratio));
    if (new Set(product.partners.map(p => p.id)).size !== product.partners.length) bad('A product names one transfer partner ID twice.');
  }
  const partners = new Set(data.products.flatMap(p => p.partners.map(x => x.id)));
  const account = data.account;
  if (!data.products.some(p => p.id === account.product_id)) bad('The account names a product that does not exist.');
  if (account.state === 'closed' ? account.closed_at === null || account.autopay.mode !== 'off' : account.closed_at !== null) bad('A closed account has its closing time and autopay off. An open account has no closing time.');

  for (const key of c.RECORDS) for (const row of data[key]) take(row.id);
  for (const n of data.notifications) take(n.id);
  const tx = new Map(data.transactions.map(x => [x.id, x])), disputes = new Map(data.disputes.map(d => [d.id, d]));
  const payments = new Map(data.payments.map(p => [p.id, p])), statements = new Map(data.statements.map(s => [s.id, s]));
  const offers = new Map(data.offers.map(o => [o.id, o])), entries = new Map(data.points_entries.map(e => [e.id, e]));

  // Statements.
  for (const s of data.statements) {
    amounts(s.statement_balance, s.minimum_due);
    if (ms(s.due_at) < ms(s.closing_at)) bad('A statement is due before its closing time.');
    const p = s.autopay_payment_id === null ? null : payments.get(s.autopay_payment_id);
    if (s.autopay_payment_id !== null && (!p || !p.autopay || p.statement_id !== s.id)) bad('A statement names an autopay payment that does not name it back.');
  }

  // Transactions.
  for (const t of data.transactions) {
    amounts(t.amount, t.pending_amount);
    if (t.state === 'posted' ? t.posted_at === null || t.dropped_at !== null : t.posted_at !== null || (t.state === 'dropped') !== (t.dropped_at !== null)) bad('The state of a transaction does not fit its posting and drop times.');
    if (t.pending_amount !== null && t.state !== 'posted') bad('Only a posted transaction keeps a held amount.');
    if ((t.kind === 'fee') !== (t.fee_type !== null)) bad('A fee has its fee type, and other transactions have none.');
    if (t.offer_id !== null && (t.kind !== 'credit' || !offers.has(t.offer_id))) bad('Only a credit names an offer, and the offer must exist.');
    const related = t.relates_to === null ? null : tx.get(t.relates_to);
    if (t.relates_to !== null && !related) bad('A transaction relates to a transaction that does not exist.');
    if ((t.kind === 'refund' || OWN_KIND[t.kind]) && (!related || related.kind !== 'purchase')) bad('A refund, temporary credit or reversal relates to no purchase.');
    if (Boolean(OWN_KIND[t.kind]) !== (t.dispute_id !== null)) bad('A temporary credit or reversal names its dispute, and other transactions name none.');
    if (t.dispute_id !== null) {
      const d = disputes.get(t.dispute_id);
      if (!d || d.transaction_id !== t.relates_to) bad('A temporary credit or reversal names a dispute that does not exist, or one of another purchase.');
    }
    if (t.points_entry_id !== null) {
      const e = entries.get(t.points_entry_id);
      if (t.kind !== 'credit' || !e || e.transaction_id !== t.id) bad('A credit names a points entry that does not name it back.');
    }
  }

  // Payments.
  for (const p of data.payments) {
    amounts(p.scheduled_amount);
    if (!(p.scheduled_amount > 0)) bad('A payment has an amount of zero or less.');
    if (!time.validDay(p.pay_on)) bad('A payment day is not a real calendar date.');
    if (p.statement_id !== null && !statements.has(p.statement_id)) bad('A payment names a statement that does not exist.');
    if (p.autopay && (p.statement_id === null || statements.get(p.statement_id).autopay_payment_id !== p.id)) bad('An autopay payment names its statement, and the statement names it back.');
    if ((p.stored_state === 'cancelled') !== (p.cancelled_at !== null) || (p.stored_state === 'returned') !== (p.returned_at !== null)) bad('The state of a payment does not fit its cancel and return times.');
    if (p.cancelled_at !== null && ms(p.cancelled_at) >= ms(p.posts_at)) bad('A payment is cancelled after the start of its day.');
    if (p.returned_at !== null && ms(p.returned_at) < ms(p.posts_at)) bad('A payment is returned before it posted.');
  }

  // Disputes.
  const byPurchase = new Map();
  for (const d of data.disputes) {
    amounts(d.amount);
    const purchase = tx.get(d.transaction_id);
    if (!purchase || purchase.kind !== 'purchase' || purchase.state !== 'posted') bad('A dispute is on a transaction that is not a posted purchase.');
    const last = d.history[d.history.length - 1];
    if (!last || last.status !== d.state) bad('The state of a dispute is not the last status of its history.');
    if ((d.state === 'withdrawn') !== (d.withdrawn_at !== null) || views.ENDED.has(d.state) !== (d.ended_at !== null)) bad('The state of a dispute does not fit its withdrawal and end times.');
    for (const row of d.history) if (row.credit_id !== null && !tx.has(row.credit_id) || row.reversal_id !== null && !tx.has(row.reversal_id)) bad('A dispute history row names a transaction that does not exist.');
    if (!byPurchase.has(d.transaction_id)) byPurchase.set(d.transaction_id, []);
    byPurchase.get(d.transaction_id).push(d);
  }
  for (const list of byPurchase.values()) {
    if (list.filter(d => d.state === 'open').length > 1) bad('A purchase has two open disputes.');
    const ended = list.filter(d => views.ENDED.has(d.state));
    if (list.some(d => ended.some(e => e !== d && ms(d.opened_at) >= ms(e.ended_at)))) bad('A dispute was opened on a purchase after the issuer ended an earlier one.');
  }

  // Offers.
  const groups = new Set();
  const FIELDS = {statement_credit: ['credit_amount'], spend_credit: ['credit_amount', 'spend_target', 'spend_days'], bonus_points: ['points'], product_change: ['product_id']};
  for (const o of data.offers) {
    amounts(o.credit_amount, o.spend_target);
    const needs = FIELDS[o.kind];
    if (['credit_amount', 'spend_target', 'spend_days', 'points', 'product_id'].some(key => needs.includes(key) !== (o[key] !== null))) bad('An offer does not have the fields of its kind.');
    if (o.product_id !== null && !data.products.some(p => p.id === o.product_id)) bad('An offer names a product that does not exist.');
    if ((o.stored_state === 'enrolled') !== (o.enrolled_at !== null) || (o.stored_state === 'declined') !== (o.declined_at !== null) ||
      (o.stored_state === 'unavailable') !== (o.unavailable_at !== null && o.unavailable_cause !== null)) bad('The state of an offer does not fit its fields.');
    if (o.stored_state === 'enrolled' && o.group !== null) {
      if (groups.has(o.group)) bad('Two offers of one group are enrolled.');
      groups.add(o.group);
    }
  }

  // Points entries.
  for (const e of data.points_entries) {
    if (e.points === 0) bad('A points entry has zero points.');
    if (APP_REASONS.has(e.reason) && e.points > 0) bad('A redeemed, transferred or forfeited entry takes points off.');
    if ((e.reason === 'transferred') !== (e.transfer !== null)) bad('A transferred entry has its transfer, and other entries have none.');
    if (e.transfer && !partners.has(e.transfer.partner_id)) bad('A transfer names a partner that does not exist.');
    if (e.offer_id !== null && !offers.has(e.offer_id)) bad('A points entry names an offer that does not exist.');
    if (e.transaction_id !== null && (e.reason !== 'redeemed' || !tx.has(e.transaction_id) || tx.get(e.transaction_id).points_entry_id !== e.id)) bad('A points entry names a credit that does not name it back.');
  }
  if (views.pointsBalance(data) < 0) bad('The points balance is below zero.');

  // The account's fee refunds.
  const refunded = new Set();
  for (const r of account.fee_refunds) {
    amounts(r.amount);
    const fee = tx.get(r.fee_id);
    if (!fee || fee.kind !== 'fee' || fee.fee_type !== 'annual' || refunded.has(r.fee_id)) bad('A fee refund names a fee that is not an annual fee, or one fee twice.');
    refunded.add(r.fee_id);
  }

  for (const n of data.notifications) if (!ids.has(n.object_id)) bad('A notification names an object that does not exist.');
  data.activity.forEach((row, index) => {
    if (index && row.seq <= data.activity[index - 1].seq) bad('The activity rows are not in order.');
    if (row.object_id !== data.account_id && !ids.has(row.object_id)) bad('An activity row names an object that does not exist.');
  });

}
module.exports = {validate};
