'use strict';
// Fare card: the fare engine (transfers, weekly cap, monthly pass, reduced fare, negative-balance allowance),
// the ledger with pending loads, autoreload, passes, reduced-fare applications and lost-card replacement.
const {fail, MIN, at, stamp, localDate, nextId, money, weekStart, instantOf, addDays, zone} = require('./common.cjs');
const {FARES, LIMITS} = require('./catalog.cjs');

const COUNTED = ['load_settled', 'fare', 'pass_purchase', 'pass_refund', 'replacement_fee'];
const card = (data, id) => {
  const c = data.cards.find(x => x.card_id === id);
  if (!c) fail('card_not_found', 'Card does not exist.');
  return c;
};
const live = (data, id) => {
  const c = card(data, id);
  if (c.status === 'blocked') fail('card_blocked', `Card ${c.card_id} is blocked` + (c.replaced_by ? `; its replacement is ${c.replaced_by}.` : '.'));
  return c;
};
// The card and the cards it replaced (fares, cap progress and transfers follow the lineage).
function lineage(data, c) {
  const out = [c.card_id];
  for (let x = c; x.replaces; x = data.cards.find(y => y.card_id === x.replaces)) out.push(x.replaces);
  return out;
}
// Where an event naming a replaced card goes: the active card at the end of its replacement chain.
function current(data, id) {
  let c = card(data, id);
  for (let i = 0; c.replaced_by && i < 50; i++) c = data.cards.find(x => x.card_id === c.replaced_by);
  return c;
}
const reducedAt = (c, t) => !!(c.reduced && Date.parse(c.reduced.approved_at) <= t && t < Date.parse(c.reduced.expires_at));
const fare = (mode, reduced) => (reduced ? Math.round(FARES[mode] * FARES.reduced_factor) : FARES[mode]);
const cap = reduced => (reduced ? Math.round(FARES.weekly_cap * FARES.reduced_factor) : FARES.weekly_cap);
const month = (data, t) => localDate(data, t).slice(0, 7);
const monthStart = (data, m) => instantOf(m + '-01', '00:00', zone(data));
function passStatus(data, p, now) {
  if (p.status === 'cancelled') return 'cancelled';
  const t = Date.parse(now), start = monthStart(data, p.month), next = monthStart(data, addDays(p.month + '-28', 7).slice(0, 7));
  return t < start ? 'scheduled' : t < next ? 'active' : 'expired';
}
const balanceOf = (data, c) => c.carried_in_cents - c.carried_out_cents +
  data.ledger.filter(e => e.card_id === c.card_id && COUNTED.includes(e.kind)).reduce((s, e) => s + e.amount_cents, 0);

// The charge for one boarding at time t, given the taps already accepted (no state change).
function price(data, c, {mode, t}, taps) {
  const ids = lineage(data, c), reduced = reducedAt(c, t), base = fare(mode, reduced);
  const pass = data.passes.find(p => ids.includes(p.card_id) && p.status !== 'cancelled' && p.month === month(data, t));
  if (pass) return {charge: 0, base, basis: 'pass', pass_id: pass.pass_id, reduced, fare_origin: true, transfer_of: null};
  const mine = taps.filter(x => ids.includes(x.card_id) && x.result === 'accepted' && Date.parse(x.at) <= t);
  // A transfer: within 120 min of the most recent paid boarding that started a fare, once per such boarding
  // ($0.00 boardings under a pass or a reached cap start no transfer).
  const origin = [...mine].reverse().find(x => x.fare_origin && x.charged_cents > 0);
  let amount = base, transfer_of = null;
  if (origin && t - Date.parse(origin.at) <= FARES.transfer_window_min * MIN && !mine.some(x => x.transfer_of === origin.tap_id)) {
    amount = Math.max(0, base - fare(origin.mode, reduced)); transfer_of = origin.tap_id;
  }
  const week = weekStart(data, t), paid = mine.filter(x => Date.parse(x.at) >= week).reduce((s, x) => s + x.charged_cents, 0);
  const left = Math.max(0, cap(reduced) - paid), charge = Math.min(amount, left);
  return {charge, base, basis: charge < amount ? 'cap' : transfer_of ? 'transfer' : reduced ? 'reduced' : 'fare', pass_id: null, reduced,
    fare_origin: !transfer_of, transfer_of, cap_paid_before: paid, cap_cents: cap(reduced)};
}
// Fare of an itinerary's rides for a card, simulated in order at their departure times.
function quote(data, cardId, rides) {
  // Without a card: full fares with the transfer rule, as on a new card with no history.
  const c = cardId ? card(data, cardId) : {card_id: '~quote', replaces: null, reduced: null}, taps = cardId ? [...data.taps] : [], out = [];
  for (const [i, r] of rides.entries()) {
    const p = price(data, c, {mode: r.mode, t: Date.parse(r.departure)}, taps);
    taps.push({tap_id: '~quote-' + i, card_id: c.card_id, at: r.departure, mode: r.mode, result: 'accepted', charged_cents: p.charge, fare_origin: p.fare_origin, transfer_of: p.transfer_of});
    out.push({trip_id: r.trip_id, cents: p.charge, basis: p.basis});
  }
  return {card_id: cardId || null, total_cents: out.reduce((s, r) => s + r.cents, 0), rides: out};
}

const entry = (data, c, fields) => {
  const e = {entry_id: nextId(data.ledger, 'entry_id', 'le-' + c.card_id), card_id: c.card_id, original_card_id: c.card_id, kind: fields.kind, amount_cents: fields.amount_cents,
    at: fields.at, settled_at: null, payment_method_id: fields.payment_method_id || null, source: fields.source || null, tap_id: fields.tap_id || null,
    pass_id: fields.pass_id || null, note: fields.note || null};
  data.ledger.push(e);
  return e;
};
const method = (data, id) => {
  const m = data.rider.payment_methods.find(x => x.payment_method_id === id);
  if (!m) fail('payment_method_not_found', 'Payment method is not on the account.');
  return m;
};

// ---- Agent writes ----
function addValue(ctx, data, {card_id, amount_cents, payment_method_id}) {
  const c = live(data, card_id);
  if (!Number.isInteger(amount_cents) || amount_cents < 100 || amount_cents > 50000) fail('invalid_amount', 'Loads are $1.00 to $500.00 in integer cents.');
  method(data, payment_method_id);
  const e = entry(data, c, {kind: 'load_pending', amount_cents, at: stamp(ctx, data), payment_method_id, source: 'manual'});
  return {entry_id: e.entry_id, spendable_cents: c.balance_cents, pending_cents: pendingOf(data, c)};
}
const pendingOf = (data, c) => data.ledger.filter(e => e.card_id === c.card_id && e.kind === 'load_pending').reduce((s, e) => s + e.amount_cents, 0);
// Without a rule (omitted or null), autoreload is turned off.
function setAutoreload(ctx, data, {card_id, rule = null}) {
  const c = live(data, card_id);
  if (rule) {
    if (rule.threshold_cents === undefined || rule.amount_cents === undefined || !rule.payment_method_id) fail('invalid_amount', 'A rule needs threshold_cents, amount_cents and payment_method_id.');
    method(data, rule.payment_method_id);
    if (rule.amount_cents < 500 || rule.amount_cents > 50000 || rule.threshold_cents < 0 || rule.threshold_cents > 10000) fail('invalid_amount', 'Autoreload amount $5.00-$500.00, threshold $0.00-$100.00.');
  }
  c.autoreload = rule ? {threshold_cents: rule.threshold_cents, amount_cents: rule.amount_cents, payment_method_id: rule.payment_method_id} : null;
  return {card_id: c.card_id, autoreload: c.autoreload};
}
function purchasePass(ctx, data, {card_id, product, start_month}) {
  const c = live(data, card_id), now = Date.parse(ctx.virtual_now);
  if (product !== 'monthly') fail('invalid_amount', 'Unknown product.');
  if (start_month < month(data, now)) fail('invalid_window', 'A pass starts this month or later.');
  if (monthStart(data, start_month) > now + 62 * 86400e3) fail('invalid_window', 'A pass can be bought at most two months ahead.');
  if (data.passes.some(p => lineage(data, c).includes(p.card_id) && p.month === start_month && p.status !== 'cancelled')) fail('pass_overlaps', 'The card already has a pass for that month.');
  if (c.balance_cents < FARES.monthly_pass) fail('insufficient_balance', `A pass costs ${money(FARES.monthly_pass)}; the settled balance is ${money(c.balance_cents)}.`);
  const pass = {pass_id: nextId(data.passes, 'pass_id', 'ps-' + c.card_id), card_id: c.card_id, product, month: start_month, price_cents: FARES.monthly_pass,
    status: 'purchased', purchased_at: stamp(ctx, data), cancelled_at: null};
  data.passes.push(pass);
  entry(data, c, {kind: 'pass_purchase', amount_cents: -FARES.monthly_pass, at: pass.purchased_at, pass_id: pass.pass_id});
  c.balance_cents -= FARES.monthly_pass;
  return {pass_id: pass.pass_id, balance_cents: c.balance_cents};
}
function cancelPass(ctx, data, {pass_id}) {
  const p = data.passes.find(x => x.pass_id === pass_id && x.status !== 'cancelled');
  if (!p) fail('pass_not_found', 'No such pass.');
  const c = live(data, p.card_id);
  if (passStatus(data, p, ctx.virtual_now) !== 'scheduled') fail('pass_started', 'The pass has started; it can no longer be cancelled.');
  p.status = 'cancelled'; p.cancelled_at = stamp(ctx, data);
  entry(data, c, {kind: 'pass_refund', amount_cents: p.price_cents, at: p.cancelled_at, pass_id: p.pass_id});
  c.balance_cents += p.price_cents;
  return {pass_id: p.pass_id, refund_cents: p.price_cents, balance_cents: c.balance_cents};
}
// Blocks the card at once and issues a virtual replacement <root>~r<n> carrying everything over.
function reportLost(ctx, data, {card_id}) {
  const c = live(data, card_id), now = stamp(ctx, data);
  const root = lineage(data, c).pop(), n = data.cards.filter(x => x.card_id.startsWith(root + '~r')).length + 1;
  const r = {card_id: `${root}~r${n}`, holder_name: c.holder_name, label: c.label, status: 'active', balance_cents: c.balance_cents, carried_in_cents: c.balance_cents,
    carried_out_cents: 0, replaces: c.card_id, replaced_by: null, fee_owed_cents: c.fee_owed_cents, autoreload: c.autoreload, reduced: c.reduced,
    created_at: now, blocked_at: null};
  c.carried_out_cents += c.balance_cents; c.balance_cents = 0; c.status = 'blocked'; c.blocked_at = now; c.replaced_by = r.card_id; c.fee_owed_cents = 0;
  data.cards.push(r);
  for (const e of data.ledger.filter(x => x.card_id === c.card_id && x.kind === 'load_pending')) e.card_id = r.card_id;   // same ledger IDs
  for (const p of data.passes.filter(x => x.card_id === c.card_id)) p.card_id = r.card_id;
  for (const a of data.applications.filter(x => x.card_id === c.card_id && x.status === 'submitted')) a.card_id = r.card_id;
  for (const s of data.subscriptions.filter(x => x.target.kind === 'card' && x.target.id === c.card_id)) {
    s.target.id = r.card_id; s.revision++; s.history.push({revision: s.revision, at: now, action: 'retargeted to replacement ' + r.card_id, changes: {target: {kind: 'card', id: r.card_id}}});
  }
  let fee = 0;
  if (r.balance_cents >= FARES.replacement_fee) {
    entry(data, r, {kind: 'replacement_fee', amount_cents: -FARES.replacement_fee, at: now, note: 'Replacement for ' + c.card_id});
    r.balance_cents -= FARES.replacement_fee; fee = FARES.replacement_fee;
  } else r.fee_owed_cents += FARES.replacement_fee;
  return {card_id: c.card_id, replacement_card_id: r.card_id, fee_cents: fee, fee_owed_cents: r.fee_owed_cents, balance_cents: r.balance_cents};
}
function applyReduced(ctx, data, {card_id, program}) {
  const c = live(data, card_id);
  if (data.applications.some(a => a.card_id === c.card_id && a.status === 'submitted')) fail('application_pending', 'An application is already pending for this card.');
  if (reducedAt(c, Date.parse(ctx.virtual_now))) fail('not_eligible_program', `The card already has an approved ${c.reduced.program} reduced fare until ${c.reduced.expires_at}.`);
  const a = {application_id: nextId(data.applications, 'application_id', 'ap-' + c.card_id), card_id: c.card_id, program, status: 'submitted',
    submitted_at: stamp(ctx, data), decided_at: null, expires_at: null, history: []};
  data.applications.push(a);
  return {application_id: a.application_id, application_status: a.status};
}

// ---- Events ----
function tap(ctx, data, p) {
  if (data.taps.some(x => x.tap_id === p.tap_id)) fail('invalid_event', 'Tap ID already recorded.');
  const c = card(data, p.card_id), now = stamp(ctx, data), t = Date.parse(ctx.virtual_now);
  const rec = {tap_id: p.tap_id, card_id: c.card_id, at: now, stop_id: p.stop_id, route_id: p.route_id, mode: p.mode, result: 'accepted', reason: null,
    charged_cents: 0, base_cents: null, basis: null, fare_origin: false, transfer_of: null, pass_id: null, entry_id: null, autoreload_entry_id: null};
  if (c.status === 'blocked') { rec.result = 'declined'; rec.reason = 'card_blocked'; data.taps.push(rec); return {rec, card: c}; }
  const q = price(data, c, {mode: p.mode, t}, data.taps);
  Object.assign(rec, {base_cents: q.base, basis: q.basis, fare_origin: q.fare_origin, transfer_of: q.transfer_of, pass_id: q.pass_id});
  // A charged tap may take the balance down to minus the card's current rail fare; $0.00 taps are always accepted.
  if (q.charge > 0 && c.balance_cents - q.charge < -fare('rail', q.reduced)) {
    Object.assign(rec, {result: 'declined', reason: 'insufficient_balance', fare_origin: false, transfer_of: null});
    data.taps.push(rec); return {rec, card: c};
  }
  rec.charged_cents = q.charge;
  const e = entry(data, c, {kind: 'fare', amount_cents: -q.charge, at: now, tap_id: p.tap_id, note: `${p.mode} at ${p.stop_id} (${q.basis})`});
  rec.entry_id = e.entry_id; c.balance_cents -= q.charge;
  // Autoreload is checked only here: at most one pending autoreload load at a time.
  if (q.charge > 0 && c.autoreload && c.balance_cents < c.autoreload.threshold_cents &&
      !data.ledger.some(x => x.card_id === c.card_id && x.kind === 'load_pending' && x.source === 'autoreload')) {
    const load = entry(data, c, {kind: 'load_pending', amount_cents: c.autoreload.amount_cents, at: now, payment_method_id: c.autoreload.payment_method_id, source: 'autoreload'});
    rec.autoreload_entry_id = load.entry_id;
  }
  data.taps.push(rec);
  return {rec, card: c};
}
function settle(ctx, data, e, outcome) {
  const c = card(data, e.card_id), now = stamp(ctx, data);
  const fails = data.rider.payment_methods.find(m => m.payment_method_id === e.payment_method_id)?.fails;
  const result = fails ? 'failed' : outcome;
  e.settled_at = now;
  if (result === 'failed') { e.kind = 'load_failed'; return {entry: e, card: c, result}; }
  e.kind = 'load_settled'; c.balance_cents += e.amount_cents;
  // A replacement fee still owed is taken from the next settled load.
  if (c.fee_owed_cents > 0) {
    const take = Math.min(c.fee_owed_cents, e.amount_cents);
    entry(data, c, {kind: 'replacement_fee', amount_cents: -take, at: now, note: 'Owed replacement fee taken from ' + e.entry_id});
    c.balance_cents -= take; c.fee_owed_cents -= take;
  }
  return {entry: e, card: c, result};
}
function decide(ctx, data, c, p) {
  const a = data.applications.find(x => x.card_id === c.card_id && x.status === 'submitted');
  if (!a) fail('application_not_pending', 'No application is pending for this card.');
  const now = stamp(ctx, data);
  if (p.program && p.program !== a.program) fail('invalid_event', 'The decision names another program.');
  a.status = p.decision; a.decided_at = now; a.expires_at = p.decision === 'approved' ? p.expires_at : null;
  if (p.decision === 'approved') {
    if (!p.expires_at || Date.parse(p.expires_at) <= Date.parse(ctx.virtual_now)) fail('invalid_event', 'An approval needs a future expires_at.');
    c.reduced = {program: a.program, approved_at: now, expires_at: p.expires_at};
  }
  return a;
}

// Card view at the virtual time.
function view(data, c, now) {
  const t = Date.parse(now), reduced = reducedAt(c, t), week = weekStart(data, t), ids = lineage(data, c);
  const paid = data.taps.filter(x => ids.includes(x.card_id) && x.result === 'accepted' && Date.parse(x.at) >= week).reduce((s, x) => s + x.charged_cents, 0);
  const app = [...data.applications].reverse().find(a => a.card_id === c.card_id);
  return {...JSON.parse(JSON.stringify(c)), spendable_cents: c.balance_cents, pending_cents: pendingOf(data, c),
    pending_loads: data.ledger.filter(e => e.card_id === c.card_id && e.kind === 'load_pending').map(e => ({entry_id: e.entry_id, amount_cents: e.amount_cents, at: e.at, source: e.source})),
    passes: data.passes.filter(p => p.card_id === c.card_id).map(p => ({...p, status: passStatus(data, p, now)})),
    reduced_fare: c.reduced ? {...c.reduced, status: reduced ? 'active' : t < Date.parse(c.reduced.approved_at) ? 'pending' : 'expired'} : null,
    application: app ? {...app, status: app.status === 'approved' && c.reduced && t >= Date.parse(c.reduced.expires_at) ? 'expired' : app.status} : null,
    weekly_cap: {week_start: at(data, week), paid_cents: paid, cap_cents: cap(reduced), remaining_cents: Math.max(0, cap(reduced) - paid)},
    fares: {rail: fare('rail', reduced), bus: fare('bus', reduced)}};
}

module.exports = {card, live, lineage, current, price, quote, balanceOf, passStatus, reducedAt, fare, addValue, setAutoreload, purchasePass, cancelPass,
  reportLost, applyReduced, tap, settle, decide, view, pendingOf, COUNTED, LIMITS};
