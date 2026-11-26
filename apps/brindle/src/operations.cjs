'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const {ms, cents, money, time, fail, copy, sum} = c;
const A = c.APP + '.';

const decimals = (...values) => { if (values.some(v => v !== undefined && !c.twoDecimals(v))) fail('invalid_arguments', 'An amount has at most two decimals.'); };
// `start` and `end` of a list are calendar days in the issuer's time zone, both included.
function window(args) {
  if (args.start !== undefined && args.end !== undefined && args.end < args.start) fail('invalid_window', 'The window ends before it starts.');
  return day => (args.start === undefined || day >= args.start) && (args.end === undefined || day <= args.end);
}
const account = (data, id) => { if (id !== data.account_id) fail('not_found', 'No account has this ID. Use the account ID of this Brindle account.'); };
const open = data => { if (c.closed(data)) fail('invalid_state', 'The account is closed.'); };
const txOf = (data, id) => c.find(data.transactions, id, 'transaction');
const paymentOf = (data, id) => c.find(data.payments, id, 'payment');
const disputeOf = (data, id) => c.find(data.disputes, id, 'dispute');
const offerOf = (data, id) => c.find(data.offers, id, 'offer');
const lastDay = (data, end) => time.addDays(time.localDay(end, c.zone(data)), -1);

// The fee refund rule of a closing or of a change to a product with no annual fee. It is recorded once for a fee.
function recordFeeRefund(t, data, cause) {
  const due = views.feeRefund(data, t.now);
  if (!due) return null;
  data.account.fee_refunds.push({fee_id: due.fee.id, amount: due.fee.amount, cause, recorded_at: t.at, request_id: t.ref});
  return {fee_id: due.fee.id, amount: due.fee.amount};
}
const mark = (t, list, action) => list.push({at: t.at, action, actor: t.actor, ref: t.ref});
function offerCheck(data, o, now) {
  const state = views.offerState(o, now);
  if (c.closed(data)) fail('invalid_state', 'The account is closed. Its offers have ended.');
  if (state === 'enrolled' || state === 'declined' || state === 'unavailable') fail('invalid_state', 'The offer is ' + state + '. Only an available offer can be accepted or declined.');
  if (state === 'expired') fail('too_late', 'The offer ended at ' + o.accept_by + '.');
}
function newEntry(t, data, points, reason, extra = {}) {
  const entry = {id: c.nextId(c.allIds(data), 'pts-a'), at: t.at, points, reason, note: null, offer_id: null, transaction_id: null, transfer: null,
    event_id: null, request_id: t.ref, history: [], ...extra};
  data.points_entries.push(entry);
  return entry;
}

const reads = {
  'account.get'(data, args, now) {
    const amounts = views.postedAmounts(data), total = views.balance(data, now, now, amounts), pending = views.pendingTotal(data), b = views.bill(data, now, amounts);
    const {history, ...stored} = data.account;
    return {account_id: data.account_id, owner_person_id: data.owner_person_id, issuer: copy(data.issuer), product: copy(c.productOf(data)), products: copy(data.products),
      account: copy(stored), balance: money(total), pending_total: money(pending), available_credit: money(cents(data.account.credit_limit) - total - pending),
      latest_statement: b ? {id: b.statement.id, closing_at: b.statement.closing_at, due_at: b.statement.due_at, statement_balance: b.statement.statement_balance,
        minimum_due: b.statement.minimum_due, paid_toward: money(b.paid), minimum_left: money(b.minimumLeft), balance_left: money(b.balanceLeft), due_passed: b.duePassed} : null,
      payment_options: {minimum_due: b ? money(b.minimumLeft) : null, statement_balance: b ? money(b.balanceLeft) : null, current_balance: money(Math.max(0, total))},
      points_balance: views.pointsBalance(data), flags: views.accountFlags(data, now, amounts)};
  },
  'account.close_preview': (data, args, now) => views.closePreview(data, now),
  'transactions.list'(data, args) {
    const inside = window(args), g = views.groups(data), merchant = args.merchant === undefined ? null : args.merchant.toLowerCase();
    return {items: data.transactions.filter(tx => inside(c.dayOf(data, tx.transaction_at)) && (args.kind === undefined || tx.kind === args.kind) &&
      (args.state === undefined || tx.state === args.state) && (merchant === null || (tx.merchant || '').toLowerCase() === merchant))
      .sort(c.byTime('transaction_at')).map(tx => views.txRow(g, tx))};
  },
  'transactions.get'(data, args, now) {
    const tx = txOf(data, args.id), g = views.groups(data), purchase = tx.kind === 'purchase';
    const related = data.transactions.filter(x => x.relates_to === tx.id || x.id === tx.relates_to).sort(c.byTime('transaction_at')).map(x => views.txRow(g, x));
    const offer = tx.offer_id ? data.offers.find(o => o.id === tx.offer_id) : null;
    return {transaction: {...copy(tx), flags: views.purchaseFlags(g, tx)}, related,
      disputes: purchase ? (g.disputes.get(tx.id) || []).slice().sort(c.byTime('opened_at')).map(d => views.disputeView(data, g, d)) : [],
      recovery: purchase ? views.moneyRecovery(views.recovery(g, tx)) : null, offer: offer ? views.offerView(data, offer, now) : null};
  },
  'statements.list'(data, args, now) {
    const inside = window(args), amounts = views.postedAmounts(data);
    return {items: views.ordered(data).filter(s => inside(c.dayOf(data, s.closing_at))).map(s => views.statementRow(data, s, now, amounts))};
  },
  'statements.get': (data, args, now) => ({statement: views.statementView(data, c.find(data.statements, args.id, 'statement'), now)}),
  'payments.list'(data, args, now) {
    const inside = window(args), amounts = views.postedAmounts(data);
    return {items: data.payments.filter(p => inside(p.pay_on) && (args.state === undefined || views.paymentState(p, amounts, now) === args.state))
      .sort(c.byTime('posts_at')).map(p => views.paymentView(p, amounts, now))};
  },
  'disputes.list'(data, args) {
    if (args.id !== undefined) txOf(data, args.id);
    const g = views.groups(data);
    return {items: data.disputes.filter(d => (args.id === undefined || d.transaction_id === args.id) && (args.state === undefined || d.state === args.state))
      .sort(c.byTime('opened_at')).map(d => views.disputeView(data, g, d))};
  },
  'disputes.get': (data, args) => ({dispute: views.disputeView(data, views.groups(data), disputeOf(data, args.id))}),
  'offers.list': (data, args, now) => ({items: data.offers.filter(o => (args.state === undefined || views.offerState(o, now) === args.state) &&
    (args.kind === undefined || o.kind === args.kind)).sort(c.byTime('issued_at')).map(o => views.offerView(data, o, now))}),
  'offers.get': (data, args, now) => ({offer: views.offerView(data, offerOf(data, args.id), now)}),
  'rewards.get': data => ({balance: views.pointsBalance(data), entries: data.points_entries.slice().sort((a, b) => ms(b.at) - ms(a.at) || c.compare(b.id, a.id)).map(copy),
    partners: copy(c.productOf(data).partners)}),
  'notifications.list'(data, args) {
    const inside = window(args);
    return {items: data.notifications.filter(n => inside(c.dayOf(data, n.at))).sort(c.byTime('at')).map(n => ({id: n.id, at: n.at, kind: n.kind, event_id: n.event_id,
      object_type: n.object_type, object_id: n.object_id, title: n.title, text: n.text, email_stored: n.email !== null}))};
  },
  'preferences.get': data => ({preferences: copy(data.preferences)})
};

const writes = {
  'payments.schedule'(t, data, args) {
    decimals(args.amount);
    account(data, args.id);
    if (args.pay_on < c.today(data, t.now)) fail('invalid_window', 'The payment day is before today, ' + c.today(data, t.now) + '.');
    const amounts = views.postedAmounts(data), b = views.bill(data, t.now, amounts), total = views.balance(data, t.now, t.now, amounts);
    const forStatement = args.amount_type === 'minimum_due' || args.amount_type === 'statement_balance';
    if (forStatement && !b) fail('no_statement', 'The account has no statement yet. Pay a fixed amount or the current balance.');
    const amount = {fixed: () => cents(args.amount), minimum_due: () => b.minimumLeft, statement_balance: () => b.balanceLeft, current_balance: () => total}[args.amount_type]();
    if (amount <= 0) fail('nothing_due', args.amount_type === 'current_balance' ? 'The current balance is zero or below.' : 'The ' + args.amount_type.replace('_', ' ') + ' of the latest statement is already paid.');
    const scheduled = sum(data.payments.filter(p => !p.autopay && views.paymentState(p, amounts, t.now) === 'scheduled').map(p => cents(p.scheduled_amount)));
    if (scheduled + amount > total) fail('over_balance', 'Scheduled payments of ' + c.amountText(scheduled + amount) + ' would be above the current balance of ' + c.amountText(total) + '.');
    const payment = {id: c.nextId(c.allIds(data), 'pay-'), source: args.source, amount_type: args.amount_type, statement_id: forStatement ? b.statement.id : null,
      scheduled_amount: money(amount), autopay: false, pay_on: args.pay_on, posts_at: time.iso(Math.max(time.startOfDay(args.pay_on, c.zone(data)), t.now), c.zone(data)),
      scheduled_at: t.at, stored_state: 'scheduled', cancelled_at: null, returned_at: null, return_reason: null, request_id: t.ref, event_id: null, history: []};
    data.payments.push(payment);
    c.record(t, data, 'payments.schedule', payment.id, false, payment.history);
    return {id: payment.id, state: views.paymentState(payment, views.postedAmounts(data), t.now), scheduled_amount: payment.scheduled_amount, pay_on: payment.pay_on, posts_at: payment.posts_at};
  },
  'payments.cancel'(t, data, args) {
    const payment = paymentOf(data, args.id), state = views.paymentState(payment, views.postedAmounts(data), t.now);
    if (state === 'cancelled' || state === 'returned') fail('invalid_state', 'The payment is ' + state + '.');
    if (state === 'posted' || state === 'skipped') fail('too_late', 'The payment day has started, so the payment is ' + state + '.');
    Object.assign(payment, {stored_state: 'cancelled', cancelled_at: t.at});
    c.record(t, data, 'payments.cancel', payment.id, false, payment.history);
    return {id: payment.id, state: 'cancelled'};
  },
  'autopay.set'(t, data, args) {
    account(data, args.id);
    open(data);
    const before = data.account.autopay.mode;
    data.account.autopay = {mode: args.mode, source: args.source ?? data.account.autopay.source};
    c.record(t, data, 'autopay.set', data.account_id, false, data.account.history, {from: before, to: args.mode});
    return {id: data.account_id, ...copy(data.account.autopay)};
  },
  'disputes.open'(t, data, args) {
    decimals(args.amount);
    const purchase = txOf(data, args.id), g = views.groups(data);
    if (purchase.kind !== 'purchase' || purchase.state !== 'posted') fail('not_disputable', 'Only a posted purchase can be disputed. This transaction is a ' + purchase.state + ' ' + purchase.kind + '.');
    const r = views.recovery(g, purchase);
    if (r.net_charge <= 0) fail('not_disputable', 'The purchase is already refunded in full.');
    if (cents(args.amount) > r.net_charge) fail('over_net', 'The amount is above the net charge of ' + c.amountText(r.net_charge) + '.');
    const list = g.disputes.get(purchase.id) || [];
    if (list.some(d => d.state === 'open')) fail('already_disputed', 'The purchase has an open dispute.');
    if (list.some(d => views.ENDED.has(d.state))) fail('already_disputed', 'The issuer has ended a dispute on this purchase.');
    const end = time.limitEnd(c.dayOf(data, purchase.posted_at), data.issuer.rules.dispute_window_days, c.zone(data));
    if (t.now >= end) fail('too_late', 'A purchase can be disputed until ' + data.issuer.rules.dispute_window_days + ' days after it posted. The last day was ' + lastDay(data, end) + '.');
    const dispute = {id: c.nextId(c.allIds(data), 'dsp-'), transaction_id: purchase.id, amount: args.amount, reason: args.reason, note: args.note, opened_at: t.at,
      request_id: t.ref, state: 'open', withdrawn_at: null, ended_at: null,
      history: [{at: t.at, status: 'open', note: args.note, actor: 'agent', ref: t.ref, credit_id: null, reversal_id: null}]};
    data.disputes.push(dispute);
    c.record(t, data, 'disputes.open', dispute.id);
    return {id: dispute.id, state: 'open'};
  },
  'disputes.withdraw'(t, data, args) {
    const dispute = disputeOf(data, args.id);
    if (dispute.state !== 'open') fail('invalid_state', 'The dispute is ' + dispute.state + '. Only an open dispute can be withdrawn.');
    Object.assign(dispute, {state: 'withdrawn', withdrawn_at: t.at});
    dispute.history.push({at: t.at, status: 'withdrawn', note: args.note ?? null, actor: 'agent', ref: t.ref, credit_id: null, reversal_id: null});
    c.record(t, data, 'disputes.withdraw', dispute.id);
    return {id: dispute.id, state: 'withdrawn'};
  },
  'offers.accept'(t, data, args) {
    const offer = offerOf(data, args.id);
    offerCheck(data, offer, t.now);
    Object.assign(offer, {stored_state: 'enrolled', enrolled_at: t.at, request_id: t.ref});
    mark(t, offer.history, 'offers.accept');
    const ended = offer.group === null ? [] : data.offers.filter(o => o !== offer && o.group === offer.group && views.offerState(o, t.now) === 'available');
    for (const o of ended) {
      Object.assign(o, {stored_state: 'unavailable', unavailable_at: t.at, unavailable_cause: 'group'});
      mark(t, o.history, 'unavailable');
    }
    let refund = null;
    if (offer.kind === 'product_change') {
      const before = data.account.product_id;
      data.account.product_id = offer.product_id;
      data.account.history.push({at: t.at, action: 'product.changed', actor: t.actor, ref: t.ref, from: before, to: offer.product_id});
      if (c.productOf(data).annual_fee === null) refund = recordFeeRefund(t, data, 'product_change');
    }
    c.record(t, data, 'offers.accept', offer.id);
    return {id: offer.id, state: 'enrolled', unavailable: ended.map(o => o.id), product_id: data.account.product_id, fee_refund: refund};
  },
  'offers.decline'(t, data, args) {
    const offer = offerOf(data, args.id);
    offerCheck(data, offer, t.now);
    Object.assign(offer, {stored_state: 'declined', declined_at: t.at, request_id: t.ref});
    c.record(t, data, 'offers.decline', offer.id, false, offer.history);
    return {id: offer.id, state: 'declined'};
  },
  'rewards.redeem'(t, data, args) {
    account(data, args.id);
    open(data);
    const balance = views.pointsBalance(data), rules = data.issuer.rules;
    if (args.points > balance) fail('insufficient_points', 'The points balance is ' + c.pointsText(balance) + '.');
    if (args.points < rules.min_redeem_points) fail('below_minimum', 'A redemption is at least ' + c.pointsText(rules.min_redeem_points) + ' points.');
    // Rounded down to the cent, so the issuer never pays more than the rate.
    const credit = Math.floor(args.points * Math.round(rules.redeem_cents_per_point * 100) / 100);
    if (credit < 1) fail('below_minimum', 'These points are worth less than one cent.');
    const entry = newEntry(t, data, -args.points, 'redeemed');
    const tx = {id: c.nextId(c.allIds(data), 'txn-a'), kind: 'credit', state: 'posted', amount: money(credit), pending_amount: null, merchant: null,
      note: 'Points redeemed as a statement credit', transaction_at: t.at, added_at: t.at, posted_at: t.at, dropped_at: null, drop_reason: null, relates_to: null,
      dispute_id: null, offer_id: null, fee_type: null, points_entry_id: entry.id, event_id: null, request_id: t.ref, history: []};
    entry.transaction_id = tx.id;
    data.transactions.push(tx);
    mark(t, tx.history, 'rewards.redeem');
    tx.history[0].amount = tx.amount;
    c.record(t, data, 'rewards.redeem', entry.id, false, entry.history);
    return {id: entry.id, points_left: views.pointsBalance(data), credit_id: tx.id, credit_amount: tx.amount};
  },
  'rewards.transfer'(t, data, args) {
    account(data, args.id);
    const partner = c.productOf(data).partners.find(p => p.id === args.partner_id) || fail('not_found', 'The product of this account has no transfer partner with this ID.');
    open(data);
    const balance = views.pointsBalance(data);
    if (args.points > balance) fail('insufficient_points', 'The points balance is ' + c.pointsText(balance) + '.');
    if (args.points < partner.min_points) fail('below_minimum', 'A transfer to ' + partner.name + ' is at least ' + c.pointsText(partner.min_points) + ' points.');
    if (args.points % partner.step !== 0) fail('invalid_increment', 'A transfer to ' + partner.name + ' is a whole number of steps of ' + c.pointsText(partner.step) + ' points.');
    const received = Math.floor(args.points * Math.round(partner.ratio * 100) / 100);
    const entry = newEntry(t, data, -args.points, 'transferred', {transfer: {partner_id: partner.id, partner_name: partner.name, member_name: args.member_name, partner_points: received}});
    c.record(t, data, 'rewards.transfer', entry.id, false, entry.history);
    return {id: entry.id, points_left: views.pointsBalance(data), partner_points: received};
  },
  'account.close'(t, data, args) {
    account(data, args.id);
    open(data);
    const points = views.pointsBalance(data);
    if (points > 0) mark(t, newEntry(t, data, -points, 'forfeited', {note: 'Points lost when the account closed'}).history, 'account.close');
    for (const o of data.offers.filter(x => views.offerState(x, t.now) === 'available')) {
      Object.assign(o, {stored_state: 'unavailable', unavailable_at: t.at, unavailable_cause: 'closing'});
      mark(t, o.history, 'unavailable');
    }
    const refund = recordFeeRefund(t, data, 'closing');
    Object.assign(data.account, {state: 'closed', closed_at: t.at, autopay: {mode: 'off', source: data.account.autopay.source}});
    c.record(t, data, 'account.close', data.account_id, false, data.account.history, {from: 'open', to: 'closed'});
    return {id: data.account_id, state: 'closed', points_forfeited: Math.max(0, points), fee_refund: refund};
  },
  'preferences.update'(t, data, args) {
    if (args.timezone === undefined && args.email_notices === undefined) fail('invalid_arguments', 'Give the time zone or email_notices.');
    if (args.timezone !== undefined && !time.validZone(args.timezone)) fail('invalid_timezone', 'The time zone is unknown. Use an IANA name such as America/New_York.');
    Object.assign(data.preferences, {timezone: args.timezone ?? data.preferences.timezone, email_notices: args.email_notices ?? data.preferences.email_notices});
    c.record(t, data, 'preferences.update', data.account_id);
    return {id: data.account_id};
  }
};
function handleTool(ctx, data, name, args) {
  const short = name.startsWith(A) ? name.slice(A.length) : '', now = ms(ctx.virtual_now);
  if ([args.start, args.end, args.pay_on].some(day => day !== undefined && !time.validDay(day))) fail('invalid_arguments', 'A day is not a real calendar date. Use YYYY-MM-DD.');
  if (reads[short]) return {data, result: {...reads[short](data, args, now), now: time.iso(now, c.zone(data))}};
  if (!writes[short]) fail('unknown_tool', 'Unknown Brindle operation.');
  const result = writes[short]({ctx, at: ctx.virtual_now, now, actor: 'agent', ref: args.request_id}, data, args);
  return {data, result};
}
module.exports = {handleTool};
