'use strict';
const { fail, textLength, PREFIXES } = require('./util.cjs');
const { ms, toIso, rxExpiry, validDate, HOUR, startOfDay, localDate, fromLocal } = require('./time.cjs');
const cardEnd = c => fromLocal((c.exp_month === 12 ? c.exp_year + 1 : c.exp_year) + '-' + String(c.exp_month === 12 ? 1 : c.exp_month + 1).padStart(2, '0') + '-01', '00:00', 'first');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const date = (d, label) => { if (d !== null && !validDate(d)) invalid(label + ' is not a calendar date: ' + d + '.'); };
const invalid = message => fail('invalid_seed', message);

const TERMINAL = new Set(['collected', 'returned_to_stock', 'cancelled']);
const NEXT = {
  requested: ['ready', 'waiting_stock', 'claim_rejected', 'cancelled'],
  waiting_stock: ['ready', 'cancelled'],
  claim_rejected: ['ready', 'waiting_stock', 'claim_rejected', 'pending_plan_decision', 'cancelled'],
  pending_plan_decision: ['ready', 'waiting_stock', 'claim_rejected', 'cancelled'],
  ready: ['collected', 'returned_to_stock', 'cancelled'],
  collected: [], returned_to_stock: [], cancelled: [],
};
const REACH = {};
for (const from of Object.keys(NEXT)) {
  const seen = new Set(), stack = [...NEXT[from]];
  while (stack.length) { const s = stack.pop(); if (seen.has(s)) continue; seen.add(s); stack.push(...NEXT[s]); }
  REACH[from] = seen;
}
const reachable = (from, to) => REACH[from].has(to);

function unique(list, key, label) {
  const seen = new Set();
  for (const r of list) { if (seen.has(r[key])) invalid('Duplicate ' + label + ' ID ' + r[key] + '.'); seen.add(r[key]); }
  return new Map(list.map(r => [r[key], r]));
}

function need(map, id, what, owner) {
  const r = map.get(id);
  if (!r) invalid(owner + ' names an unknown ' + what + ' ' + id + '.');
  return r;
}

const nonNull = (v, label) => { if (v === null || v === undefined) invalid(label + ' is required in this state.'); };
const isNull = (v, label) => { if (v !== null && v !== undefined) invalid(label + ' must be empty in this state.'); };

function checkBinding(ctx, data) {
  const owner = (ctx.binding?.accounts || []).find(a => a.app_id === ctx.app_id && a.account_id === data.account_id);
  if (!owner) invalid('The seed account ' + data.account_id + ' is not bound in this run.');
  if (owner.owner_person_id !== data.owner_person_id) invalid('The seed owner ' + data.owner_person_id + ' is not the bound account holder.');
  const bound = new Set((ctx.binding.people || []).map(p => p.person_id));
  for (const p of data.people) if (!bound.has(p.person_id)) invalid('Person ' + p.person_id + ' is not in the run binding.');
}

function checkPeople(data, idx) {
  const self = data.people.filter(p => p.relation === 'self');
  if (self.length !== 1 || self[0].person_id !== data.owner_person_id) invalid('Exactly one person, the account holder, has relation self.');
  for (const p of data.people) {
    date(p.birth_date, 'Birth date of ' + p.person_id);
    if (p.plan_id !== null) {
      const plan = need(idx.plans, p.plan_id, 'plan', 'Person ' + p.person_id);
      for (const d of data.drugs) if (!own(plan.rules, d.drug_id)) invalid('Plan ' + p.plan_id + ' has no rule for ' + d.drug_id + '.');
    }
    if (p.is_minor && p.guardian_ids.length === 0) invalid('Minor ' + p.person_id + ' has no guardian.');
    if (!p.is_minor && p.guardian_ids.length) invalid('Adult ' + p.person_id + ' cannot have guardians.');
    for (const g of p.guardian_ids) {
      const guardian = need(idx.people, g, 'guardian', 'Person ' + p.person_id);
      if (guardian.is_minor || g === p.person_id) invalid('Guardian ' + g + ' of ' + p.person_id + ' must be another adult.');
    }
  }
}

function checkCatalog(data, idx) {
  for (const d of data.drugs) for (const f of d.facts) {
    if (!f.source) invalid('A clinical fact of ' + d.drug_id + ' has no source.');
    for (const k of ['publisher', 'set_id', 'section']) if (f.source[k].trim() === '') invalid('A clinical fact source of ' + d.drug_id + ' has a blank ' + k + '.');
    let url = null;
    try { url = new URL(f.source.url); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || !url.hostname) invalid('A clinical fact source of ' + d.drug_id + ' has no valid https URL.');
    if (textLength(f.text) > 500) invalid('A clinical fact of ' + d.drug_id + ' is over 500 characters.');
  }
  for (const plan of data.plans) for (const [drugId, rule] of Object.entries(plan.rules)) {
    need(idx.drugs, drugId, 'drug', 'Plan ' + plan.plan_id);
    if (rule.max_quantity !== null && !idx.drugs.get(drugId).quantities.some(q => q <= rule.max_quantity)) invalid('Plan ' + plan.plan_id + ' allows no quantity of ' + drugId + '.');
  }
  for (const [drugId, prices] of Object.entries(data.cash_prices)) {
    const drug = need(idx.drugs, drugId, 'drug', 'Cash prices');
    for (const q of Object.keys(prices)) if (!/^[1-9][0-9]{0,3}$/.test(q) || !drug.quantities.includes(Number(q))) invalid('Cash price of ' + drugId + ' names a quantity it does not come in: ' + q + '.');
  }
  for (const d of data.drugs) for (const q of d.quantities) if (!own(data.cash_prices, d.drug_id) || !own(data.cash_prices[d.drug_id], String(q))) invalid('Drug ' + d.drug_id + ' has no cash price for quantity ' + q + '.');
  for (const s of data.stores) {
    if (s.hours.length === 0) invalid('Store ' + s.store_id + ' has no opening hours.');
    for (const drugId of Object.keys(s.stock)) need(idx.drugs, drugId, 'drug', 'Store ' + s.store_id);
  }
  for (const c of data.cards) need(idx.people, c.owner_id, 'person', 'Card ' + c.card_id);
  for (const k of Object.keys(data.issued)) if (!PREFIXES.includes(k)) invalid('Unknown ID counter ' + k + '.');
}

function checkPrescriptions(data, idx) {
  for (const rx of data.prescriptions) {
    const patient = need(idx.people, rx.patient_id, 'patient', 'Prescription ' + rx.rx_id);
    need(idx.prescribers, rx.prescriber_id, 'prescriber', 'Prescription ' + rx.rx_id);
    need(idx.drugs, rx.drug_id, 'drug', 'Prescription ' + rx.rx_id);
    date(rx.written_on, 'Prescription ' + rx.rx_id + ' written_on');
    if (rx.written_on > localDate(ms(rx.received_at))) invalid('Prescription ' + rx.rx_id + ' was received before it was written.');
    if (data.fills.some(f => f.rx_id === rx.rx_id && !TERMINAL.has(f.state)) && rx.fills_remaining < 1) invalid('Prescription ' + rx.rx_id + ' has an active fill but no fills remaining.');
    if (rx.fills_remaining > rx.fills_authorized) invalid('Prescription ' + rx.rx_id + ' has more fills remaining than authorized.');
    const collected = data.fills.filter(f => f.rx_id === rx.rx_id && f.state === 'collected').length;
    if (rx.fills_remaining > rx.fills_authorized - collected) invalid('Prescription ' + rx.rx_id + ' fills remaining do not account for its collected fills.');
    if (rx.state === 'superseded') {
      nonNull(rx.superseded_by, 'Prescription ' + rx.rx_id + ' superseded_by'); nonNull(rx.superseded_at, 'Prescription ' + rx.rx_id + ' superseded_at');
      const next = need(idx.rx, rx.superseded_by, 'prescription', 'Prescription ' + rx.rx_id);
      if (next.patient_id !== rx.patient_id || next.drug_id !== rx.drug_id || next.prescriber_id !== rx.prescriber_id || next.rx_id === rx.rx_id) invalid('Prescription ' + rx.rx_id + ' is superseded by an unrelated prescription.');
    } else { isNull(rx.superseded_by, 'Prescription ' + rx.rx_id + ' superseded_by'); isNull(rx.superseded_at, 'Prescription ' + rx.rx_id + ' superseded_at'); }
  }
}

function checkClaims(data, idx) {
  const byFill = new Map();
  for (const c of data.claims) {
    need(idx.fills, c.fill_id, 'fill', 'Claim ' + c.claim_id);
    if (!byFill.has(c.fill_id)) byFill.set(c.fill_id, []);
    byFill.get(c.fill_id).push(c);
    date(c.eligible_on, 'Claim ' + c.claim_id + ' eligible_on');
    if (c.result === 'paid') { isNull(c.reason, 'Paid claim ' + c.claim_id + ' reason'); nonNull(c.copay_cents, 'Paid claim ' + c.claim_id + ' copay'); isNull(c.eligible_on, 'Paid claim ' + c.claim_id + ' eligible_on'); }
    else {
      nonNull(c.reason, 'Rejected claim ' + c.claim_id + ' reason'); isNull(c.copay_cents, 'Rejected claim ' + c.claim_id + ' copay'); isNull(c.reversed_at, 'Rejected claim ' + c.claim_id + ' reversal');
      if ((c.reason === 'refill_too_soon') !== (c.eligible_on !== null)) invalid('Claim ' + c.claim_id + ' has an eligible date only when rejected refill_too_soon.');
    }
  }
  for (const [fillId, list] of byFill) {
    const attempts = list.map(c => c.attempt).sort((a, b) => a - b);
    if (attempts.some((a, i) => a !== i + 1)) invalid('Claims of fill ' + fillId + ' are not numbered 1, 2, … by attempt.');
    const ordered = [...list].sort((a, b) => a.attempt - b.attempt);
    if (ordered.slice(0, -1).some(c => c.result !== 'rejected')) invalid('Fill ' + fillId + ' has a paid claim before its latest attempt; a paid claim ends adjudication.');
    if (ordered.some((c, i) => i > 0 && ms(c.at) < ms(ordered[i - 1].at))) invalid('Claims of fill ' + fillId + ' are dated out of attempt order.');
  }
  return byFill;
}

function checkFill(f, data, idx, claimsByFill) {
  const label = 'Fill ' + f.fill_id;
  const rx = need(idx.rx, f.rx_id, 'prescription', label);
  need(idx.stores, f.store_id, 'store', label);
  if (!idx.drugs.get(rx.drug_id).quantities.includes(f.quantity)) invalid(label + ' has a quantity the drug does not come in.');
  const tl = f.timeline.length ? f.timeline : [{ state: 'requested', at: f.requested_at }];
  if (ms(tl[0].at) < ms(f.requested_at) || (tl[0].state === 'requested' ? ms(tl[0].at) !== ms(f.requested_at) : !reachable('requested', tl[0].state))) invalid(label + ' timeline must start at or after its request.');
  const expiry = rxExpiry(rx.written_on);
  if (ms(f.requested_at) >= expiry) invalid(label + ' was requested after its prescription expired.');
  if (ms(f.requested_at) < ms(rx.received_at)) invalid(label + ' was requested before its prescription was received.');
  if (f.ready_at !== null && ms(f.ready_at) < ms(f.requested_at) + 2 * HOUR) invalid(label + ' became ready less than 2 hours after its request; review comes first.');
  for (let i = 1; i < tl.length; i++) {
    if (!reachable(tl[i - 1].state, tl[i].state)) invalid(label + ' timeline moves from ' + tl[i - 1].state + ' to ' + tl[i].state + ', which no transition reaches.');
    if (ms(tl[i].at) < ms(tl[i - 1].at)) invalid(label + ' timeline goes back in time.');
  }
  const last = tl[tl.length - 1].state;
  if (last !== f.state && !reachable(last, f.state)) invalid(label + ' state ' + f.state + ' is not reachable from its last timeline entry ' + last + '.');
  const claims = claimsByFill.get(f.fill_id) || [];
  const claim = f.claim_id === null ? null : need(idx.claims, f.claim_id, 'claim', label);
  if (claim && claim.fill_id !== f.fill_id) invalid(label + ' points at another fill\'s claim.');
  if (claim && claims.some(c => c.attempt > claim.attempt)) invalid(label + ' does not point at its latest claim.');
  if (!claim && claims.length) invalid(label + ' has claims but no current claim.');
  const terminal = TERMINAL.has(f.state), held = f.hold !== null, made = f.ready_at !== null;
  if (held && terminal) invalid(label + ' is finished and cannot be held.');
  if (f.cash) { if (!claim || claim.result !== 'rejected') invalid(label + ' pays cash only after a rejected claim.'); }
  const funded = f.cash !== null || (claim && claim.result === 'paid');
  const remaining = held ? f.hold.remaining : {};
  const expect = (cond, field, value) => { if (cond) nonNull(value, label + ' ' + field); else isNull(value, label + ' ' + field); };
  expect(f.state === 'requested' && !held, 'review_due_at', f.review_due_at);
  if (f.review_due_at !== null && ms(f.review_due_at) < ms(f.requested_at) + 2 * HOUR) invalid(label + ' review is due less than 2 hours after its request.');
  if (held && f.state === 'requested' && remaining.review_ms === undefined) invalid(label + ' is held during review without its remaining review time.');
  if (held && ms(f.hold.placed_at) < ms(f.requested_at)) invalid(label + ' was held before it was requested.');
  if (held) for (const [k, v] of Object.entries(remaining)) if (v < 1) invalid(label + ' is held with no ' + k.replace('_ms', '') + ' time left; a due timer runs before a hold can pause it.');
  if (held && ((remaining.review_ms ?? 0) > 16 * 24 * HOUR || (remaining.warning_ms ?? 0) > 168 * HOUR || (remaining.return_ms ?? 0) > 240 * HOUR)) invalid(label + ' is held with more time left than the timer allows.');
  if (held && f.warned_at !== null && ms(f.warned_at) > ms(f.hold.placed_at)) invalid(label + ' was warned while held.');
  if (held && remaining.review_ms !== undefined && ms(f.hold.placed_at) + remaining.review_ms < ms(f.requested_at) + 2 * HOUR) invalid(label + ' held review would complete less than 2 hours after its request.');
  if (held && f.state === 'ready') {
    if (ms(f.hold.placed_at) < ms(f.ready_at)) invalid(label + ' was held as ready before it became ready.');
    if (remaining.warning_ms !== undefined && ms(f.hold.placed_at) + remaining.warning_ms < ms(f.ready_at) + 168 * HOUR) invalid(label + ' held pickup warning would come less than 168 hours after ready.');
    if (remaining.return_ms !== undefined && ms(f.hold.placed_at) + remaining.return_ms < ms(f.ready_at) + 240 * HOUR) invalid(label + ' held return would come less than 240 hours after ready.');
  }
  if (held && f.state !== 'requested' && remaining.review_ms !== undefined) invalid(label + ' keeps a review remainder outside review.');
  const readyTimers = f.state === 'ready' && !held;
  expect(readyTimers, 'return_due_at', f.return_due_at);
  if (readyTimers && f.warned_at === null) nonNull(f.warning_due_at, label + ' warning_due_at'); else isNull(f.warning_due_at, label + ' warning_due_at');
  if (held && f.state === 'ready' && (remaining.return_ms === undefined || (f.warned_at === null) !== (remaining.warning_ms !== undefined))) invalid(label + ' is held while ready without the right remaining warning and return times.');
  if (held && f.state !== 'ready' && (remaining.warning_ms !== undefined || remaining.return_ms !== undefined)) invalid(label + ' keeps pickup remainders while not ready.');
  if (f.warned_at !== null && !['ready', 'collected', 'returned_to_stock', 'cancelled'].includes(f.state)) invalid(label + ' was warned before it was ready.');
  if (f.resubmission_due_at !== null && (f.state !== 'claim_rejected' || !claim || claim.reason !== 'refill_too_soon' || f.cash)) invalid(label + ' schedules a resubmission outside a refill_too_soon rejection.');
  if (f.resubmission_due_at !== null && ms(f.resubmission_due_at) < ms(claim.at)) invalid(label + ' resubmission is due before the rejection it answers.');
  if (f.resubmission_due_at !== null && claim.eligible_on !== null && ms(f.resubmission_due_at) < startOfDay(claim.eligible_on)) invalid(label + ' resubmission is due before 00:00 local on its eligible date.');
  if (f.warned_at !== null && f.closed_at !== null && ms(f.warned_at) > ms(f.closed_at)) invalid(label + ' was warned after it was closed.');
  if (!terminal) {
    const pending = [['review', f.review_due_at], ['warning', f.warning_due_at], ['return', f.return_due_at], ...(held ? [] : [['resubmission', f.resubmission_due_at]])].filter(([, at]) => at !== null).map(([kind, at]) => [kind, ms(at), at]);
    if (!made) pending.push(['prescription expiry', expiry, toIso(expiry)]);
    const own = list => list.filter(r => r.fill_id === f.fill_id);
    const recorded = [...tl.map(e => e.at), f.ready_at, f.warned_at, ...f.refusals.map(r => r.at), ...f.notes.map(n => n.at), f.collector?.set_at, f.hold?.placed_at,
      ...own(data.authorizations).flatMap(a => [a.at, a.ended_at]), ...own(data.charges).map(c => c.at), ...own(data.claims).flatMap(c => [c.at, c.reversed_at]),
      ...own(data.plan_requests).flatMap(r => [r.created_at, r.closed_at]), ...data.notices.filter(x => x.subject.type === 'fill' && x.subject.id === f.fill_id).map(x => x.at)].filter(at => at !== null && at !== undefined);
    for (const [kind, due, shown] of pending) for (const at of recorded) if (ms(at) >= due) invalid(label + ' records ' + at + ' at or after its pending ' + kind + ' due ' + shown + ', which would have applied first.');
  }
  if (made && ms(f.ready_at) >= expiry) invalid(label + ' became ready after its prescription expired.');
  if (!made && !terminal && tl.some(e => ms(e.at) >= expiry)) invalid(label + ' has history after its prescription expired, which would have cancelled it.');
  if (f.warning_due_at !== null && ms(f.warning_due_at) < ms(f.ready_at) + 168 * HOUR) invalid(label + ' pickup warning is due less than 168 hours after ready.');
  if (f.return_due_at !== null && ms(f.return_due_at) < ms(f.ready_at) + 240 * HOUR) invalid(label + ' return is due less than 240 hours after ready.');
  if (f.state === 'waiting_stock' && !held && idx.stores.get(f.store_id).stock[rx.drug_id] === true) invalid(label + ' waits for stock at a store that has it.');
  expect(TERMINAL.has(f.state), 'closed_at', f.closed_at);
  if (f.closed_at !== null && (ms(f.closed_at) < ms(tl[tl.length - 1].at) && tl[tl.length - 1].state !== f.state || ms(f.closed_at) < ms(f.requested_at))) invalid(label + ' closed before its history.');
  if (f.cancellation && ms(f.cancellation.at) !== ms(f.closed_at)) invalid(label + ' cancellation time differs from its closing time.');
  if (f.closed_at !== null && made && ms(f.closed_at) < ms(f.ready_at)) invalid(label + ' closed before it became ready.');
  if (f.closed_at !== null && tl[tl.length - 1].state === f.state && ms(tl[tl.length - 1].at) !== ms(f.closed_at)) invalid(label + ' closing time differs from its ' + f.state + ' timeline entry.');
  if (f.state === 'returned_to_stock' && ms(f.closed_at) < ms(f.ready_at) + 240 * HOUR) invalid(label + ' returned to stock less than 240 hours after ready.');
  if (f.warned_at !== null && (!made || ms(f.warned_at) < ms(f.ready_at) + 168 * HOUR)) invalid(label + ' was warned less than 168 hours after ready.');
  if (f.state === 'returned_to_stock' && f.warned_at === null) invalid(label + ' was returned to stock without its pickup warning.');
  if (f.warned_at !== null) {
    const earliestReturn = ms(f.warned_at) + 72 * HOUR;
    if ((f.return_due_at !== null && ms(f.return_due_at) < earliestReturn) || (held && remaining.return_ms !== undefined && ms(f.hold.placed_at) + remaining.return_ms < earliestReturn) || (f.state === 'returned_to_stock' && ms(f.closed_at) < earliestReturn)) invalid(label + ' returns less than 72 hours after its pickup warning.');
  }
  const patientPlan = idx.people.get(rx.patient_id).plan_id;
  for (const c of claims) {
    if (patientPlan === null && !(c.result === 'rejected' && c.reason === 'not_covered')) invalid('Claim ' + c.claim_id + ' is not a not_covered rejection although the patient has no plan.');
    if (c.result === 'paid' && c.copay_cents !== idx.plans.get(patientPlan).rules[rx.drug_id].copay_cents) invalid('Claim ' + c.claim_id + ' copay differs from the plan rule.');
  }
  if (f.cash && f.cash.price_cents !== data.cash_prices[rx.drug_id][String(f.quantity)]) invalid(label + ' cash price differs from the price table.');
  if (['requested'].includes(f.state)) { isNull(f.claim_id, label + ' claim'); isNull(f.amount_due_cents, label + ' amount due'); }
  if (['waiting_stock'].includes(f.state)) { if (!funded) invalid(label + ' waits for stock without a paid claim or cash.'); isNull(f.amount_due_cents, label + ' amount due'); }
  if (['claim_rejected', 'pending_plan_decision'].includes(f.state)) { if (!claim || claim.result !== 'rejected' || f.cash) invalid(label + ' is ' + f.state + ' without a rejected claim.'); isNull(f.amount_due_cents, label + ' amount due'); }
  if (['ready', 'collected'].includes(f.state) || (made && terminal)) {
    if (!made || !funded) invalid(label + ' is made without a ready time and a paid claim or cash.');
    nonNull(f.amount_due_cents, label + ' amount due');
    const due = f.cash ? f.cash.price_cents : claim.copay_cents;
    if (f.amount_due_cents !== due) invalid(label + ' amount due differs from its ' + (f.cash ? 'cash price' : 'paid claim') + '.');
  }
  if (['ready', 'collected'].includes(f.state) && !made) invalid(label + ' has no ready time.');
  if (['requested', 'waiting_stock', 'claim_rejected', 'pending_plan_decision'].includes(f.state) && made) invalid(label + ' has a ready time but is not made.');
  if (f.cancellation && (f.cancellation.stage === 'ready') !== made) invalid(label + ' was cancelled from ' + f.cancellation.stage + ', which does not match whether it was made.');
  if (f.cancellation) {
    const before = tl.filter(e => e.state !== 'cancelled');
    const lastBefore = before.length ? before[before.length - 1].state : 'requested';
    if (lastBefore !== f.cancellation.stage && !reachable(lastBefore, f.cancellation.stage)) invalid(label + ' was cancelled from ' + f.cancellation.stage + ', which its history does not reach.');
  }
  if (f.warning_due_at !== null && f.return_due_at !== null && ms(f.return_due_at) - ms(f.warning_due_at) !== 72 * HOUR) invalid(label + ' pickup warning and return are not 72 hours apart.');
  if (held && remaining.warning_ms !== undefined && remaining.return_ms !== undefined && remaining.return_ms - remaining.warning_ms !== 72 * HOUR) invalid(label + ' held pickup warning and return are not 72 hours apart.');
  for (const pr of data.plan_requests.filter(r => r.fill_id === f.fill_id && r.state === 'approved')) {
    const addressed = need(idx.claims, pr.claim_id, 'claim', 'Plan request ' + pr.plan_request_id);
    if (!f.waived.includes(pr.reason) || !claims.some(c => c.attempt > addressed.attempt)) invalid('Approved plan request ' + pr.plan_request_id + ' left no waiver and no later claim attempt on ' + f.fill_id + '.');
    const next = claims.find(c => c.attempt === addressed.attempt + 1);
    if (!next || ms(next.at) !== ms(pr.closed_at)) invalid('Approved plan request ' + pr.plan_request_id + ' was not resubmitted at its approval.');
  }
  if (f.waived.length) for (const reason of f.waived) if (!data.plan_requests.some(pr => pr.fill_id === f.fill_id && pr.reason === reason && pr.state === 'approved')) invalid(label + ' waives ' + reason + ' without an approved plan request.');
  if (!made && ['collected', 'returned_to_stock'].includes(f.state)) invalid(label + ' finished as ' + f.state + ' without being made.');
  expect(f.state === 'cancelled', 'cancellation', f.cancellation);
  if (f.cancellation && f.cancellation.stage !== null && TERMINAL.has(f.cancellation.stage)) invalid(label + ' was cancelled from a finished state.');
  if (f.cancellation && f.cancellation.reason !== 'agent' && made) invalid(label + ' was made, so expiry or supersession cannot cancel it.');
  for (const c of claims) if (ms(c.at) < ms(f.requested_at) + 2 * HOUR) invalid('Claim ' + c.claim_id + ' is dated before its fill\'s review could finish.');
  if (claim) {
    const rule = patientPlan === null ? null : idx.plans.get(patientPlan).rules[rx.drug_id];
    const stat = !rule || !rule.covered ? 'not_covered' : rule.max_quantity !== null && f.quantity > rule.max_quantity ? 'quantity_limit' : rule.prior_auth_required && !f.waived.includes('prior_auth_required') ? 'prior_auth_required' : null;
    const STATIC = ['not_covered', 'quantity_limit', 'prior_auth_required'];
    if (claim.result === 'paid' ? stat !== null : STATIC.includes(claim.reason) ? claim.reason !== stat : stat !== null) invalid('Claim ' + claim.claim_id + ' is ' + claim.result + (claim.reason ? ' ' + claim.reason : '') + ', which the plan rule for this fill does not give' + (stat ? ' (' + stat + ')' : '') + '.');
    if (made && ms(claim.at) > ms(f.ready_at)) invalid(label + ' became ready before the claim decision that funds it.');
    if (claim.result === 'rejected' && f.waived.includes(claim.reason)) invalid('Claim ' + claim.claim_id + ' is rejected for ' + claim.reason + ', which an approved plan request had already waived.');
  }
  const paidReversible = claim && claim.result === 'paid' && !f.cash;
  if (claim && claim.reversed_at !== null && f.closed_at !== null && ms(claim.reversed_at) !== ms(f.closed_at)) invalid('Claim ' + claim.claim_id + ' was reversed at a different time from when it closed.');
  if (['returned_to_stock', 'cancelled'].includes(f.state)) { if (paidReversible && claim.reversed_at === null) invalid(label + ' finished without reversing its paid claim.'); }
  else if (claim && claim.reversed_at !== null) invalid(label + ' has a reversed claim while ' + f.state + '.');
  if (!terminal && rx.state === 'superseded' && !made) invalid(label + ' is unmade on a superseded prescription; supersession would have cancelled it.');
  if (made && rx.superseded_at !== null && ms(f.ready_at) > ms(rx.superseded_at)) invalid(label + ' became ready after its prescription was superseded, which would have cancelled it.');
  if (f.plan_request_id !== null) {
    const pr = need(idx.planRequests, f.plan_request_id, 'plan request', label);
    if (pr.fill_id !== f.fill_id) invalid(label + ' points at another fill\'s plan request.');
  }
  if ((f.state === 'pending_plan_decision') !== (f.plan_request_id !== null && idx.planRequests.get(f.plan_request_id).state === 'pending')) invalid(label + ' is pending a plan decision exactly when its plan request is pending.');
  if (held && f.hold.stored_decision) {
    if (f.state !== 'pending_plan_decision' || f.hold.stored_decision.plan_request_id !== f.plan_request_id) invalid(label + ' stores a decision for a request it is not waiting on.');
    const pr0 = idx.planRequests.get(f.plan_request_id);
    if (ms(f.hold.stored_decision.at) < ms(f.hold.placed_at) || (pr0 && ms(f.hold.stored_decision.at) < ms(pr0.created_at))) invalid(label + ' stores a decision dated before its hold or its plan request.');
  }
  if (f.collector) {
    need(idx.people, f.collector.person_id, 'collector', label);
    const patient = idx.people.get(rx.patient_id);
    if (f.collector.via_grant_id !== null) {
      const g = need(idx.grants, f.collector.via_grant_id, 'grant', label);
      if (g.scope !== 'pickup' || g.grantee_id !== f.collector.person_id || g.patient_id !== rx.patient_id || (g.fill_id !== null && g.fill_id !== f.fill_id) || g.status !== 'active') invalid(label + ' names a collector through a grant that does not cover them for this fill.');
      if (!grantInForce(g, ms(f.collector.set_at))) invalid(label + ' names a collector through a grant that was not in force when the collector was set.');
    } else if (f.collector.person_id !== rx.patient_id && !(patient.is_minor && patient.guardian_ids.includes(f.collector.person_id))) invalid(label + ' names a collector who is neither the patient nor a guardian and has no pickup grant.');
  }
  if (f.authorization_id !== null) {
    const au = need(idx.authorizations, f.authorization_id, 'authorization', label);
    if (au.fill_id !== f.fill_id) invalid(label + ' points at another fill\'s authorization.');
  }
  for (const a of data.authorizations.filter(a => a.fill_id === f.fill_id)) {
    if (a.amount_cents !== f.amount_due_cents || !made || a.amount_cents < 1) invalid('Authorization ' + a.authorization_id + ' does not match the positive amount due of a made fill.');
    if (a.state === 'live' && f.state !== 'ready') invalid('Authorization ' + a.authorization_id + ' is live on a fill that is ' + f.state + '.');
    if (a.state === 'captured' && f.state !== 'collected') invalid('Authorization ' + a.authorization_id + ' is captured on a fill that is ' + f.state + '.');
    if (a.state === 'live' && f.authorization_id !== a.authorization_id) invalid('Live authorization ' + a.authorization_id + ' is not the fill\'s current one.');
    if ((a.state === 'live') !== (a.ended_at === null)) invalid('Authorization ' + a.authorization_id + ' has an end time exactly when it is captured or voided.');
    if (made && ms(a.at) < ms(f.ready_at)) invalid('Authorization ' + a.authorization_id + ' was made before the fill was ready.');
    if (ms(a.at) >= cardEnd(idx.cards.get(a.card_id))) invalid('Authorization ' + a.authorization_id + ' was made on a card that had expired.');
    if (held && ms(a.at) > ms(f.hold.placed_at)) invalid('Authorization ' + a.authorization_id + ' was made while the fill was on hold.');
    if (a.ended_at !== null && ms(a.ended_at) < ms(a.at)) invalid('Authorization ' + a.authorization_id + ' ended before it was made.');
    if (a.ended_at !== null && (f.closed_at === null || ms(a.ended_at) !== ms(f.closed_at))) invalid('Authorization ' + a.authorization_id + ' was captured or voided other than when the fill closed.');
    if (a.state === 'voided' && !['returned_to_stock', 'cancelled'].includes(f.state)) invalid('Authorization ' + a.authorization_id + ' is voided on a fill that is ' + f.state + '.');
  }
  if (data.authorizations.filter(a => a.fill_id === f.fill_id && a.state === 'live').length > 1) invalid(label + ' has two live authorizations.');
  const auths = data.authorizations.filter(a => a.fill_id === f.fill_id);
  if (auths.length > 1) invalid(label + ' has more than one authorization; a fill is prepaid at most once.');
  if (auths.length === 1 && f.authorization_id !== auths[0].authorization_id) invalid(label + ' does not reference its authorization ' + auths[0].authorization_id + '.');
  if (['returned_to_stock', 'cancelled'].includes(f.state) && data.authorizations.some(a => a.fill_id === f.fill_id && a.state === 'live')) invalid(label + ' finished with a live authorization.');
  const charges = data.charges.filter(c => c.fill_id === f.fill_id);
  if (f.state === 'collected') {
    if (f.amount_due_cents > 0) {
      if (charges.length !== 1 || f.charge_id !== charges[0].charge_id) invalid(label + ' was collected with a positive amount due but not exactly one charge.');
      const ch = charges[0];
      if (ch.amount_cents !== f.amount_due_cents) invalid('Charge ' + ch.charge_id + ' differs from the amount due.');
      if (ms(ch.at) !== ms(f.closed_at)) invalid('Charge ' + ch.charge_id + ' was not made at collection.');
      if (ms(ch.at) >= cardEnd(idx.cards.get(ch.card_id))) invalid('Charge ' + ch.charge_id + ' was made on a card that had expired.');
      const captured = data.authorizations.filter(a => a.fill_id === f.fill_id && a.state === 'captured');
      if (idx.cards.get(ch.card_id).owner_id !== ch.payer_id) invalid('Charge ' + ch.charge_id + ' is not on the payer\'s own card.');
      if (ch.method === 'capture') {
        if (captured.length !== 1 || captured[0].card_id !== ch.card_id || f.authorization_id !== captured[0].authorization_id) invalid('Charge ' + ch.charge_id + ' captures no authorization on its card.');
      } else if (captured.length) invalid('Counter charge ' + ch.charge_id + ' sits beside a captured authorization.');
    } else if (charges.length || f.charge_id !== null) invalid(label + ' was collected at $0 and cannot carry a charge.');
  } else if (charges.length || f.charge_id !== null) invalid(label + ' has a charge while ' + f.state + '.');
}

const grantInForce = (g, now) => g.status === 'active' && ms(g.created_at) <= now && (g.expires_at === null || now < ms(g.expires_at));

function checkGrants(data, idx) {
  const windows = new Map();
  for (const g of data.grants) {
    const patient = need(idx.people, g.patient_id, 'patient', 'Grant ' + g.grant_id);
    need(idx.people, g.grantee_id, 'grantee', 'Grant ' + g.grant_id);
    need(idx.people, g.grantor_id, 'grantor', 'Grant ' + g.grant_id);
    if (g.grantor_id !== g.patient_id && !(patient.is_minor && patient.guardian_ids.includes(g.grantor_id))) invalid('Grant ' + g.grant_id + ' is given by someone who is neither the patient nor a guardian of a minor patient.');
    if (g.grantee_id === g.patient_id) invalid('Grant ' + g.grant_id + ' names the patient as grantee.');
    if (g.fill_id !== null) {
      if (g.scope !== 'pickup') invalid('Grant ' + g.grant_id + ' names a fill but is not a pickup grant.');
      const fill = need(idx.fills, g.fill_id, 'fill', 'Grant ' + g.grant_id);
      if (idx.rx.get(fill.rx_id).patient_id !== g.patient_id) invalid('Grant ' + g.grant_id + ' names another patient\'s fill.');
      if (ms(g.created_at) < ms(fill.requested_at)) invalid('Grant ' + g.grant_id + ' names fill ' + g.fill_id + ' before that fill was requested.');
    }
    if ((g.status === 'revoked') !== (g.revoked_at !== null)) invalid('Grant ' + g.grant_id + ' has a revocation time exactly when revoked.');
    if (g.expires_at !== null && ms(g.expires_at) <= ms(g.created_at)) invalid('Grant ' + g.grant_id + ' expires before it starts.');
    if (g.status === 'active') {
      const key = [g.patient_id, g.grantee_id, g.scope, g.fill_id].join('|');
      const start = ms(g.created_at), end = g.expires_at === null ? Infinity : ms(g.expires_at);
      for (const [s0, e0, other] of windows.get(key) || []) if (start < e0 && s0 < end) invalid('Grant ' + g.grant_id + ' duplicates an active grant (' + other + ') with the same patient, grantee, scope and fill for an overlapping time.');
      if (!windows.has(key)) windows.set(key, []);
      windows.get(key).push([start, end, g.grant_id]);
    }
  }
}

function checkRequests(data, idx) {
  const pendingByRx = new Set();
  for (const pr of data.plan_requests) {
    need(idx.fills, pr.fill_id, 'fill', 'Plan request ' + pr.plan_request_id);
    const claim = need(idx.claims, pr.claim_id, 'claim', 'Plan request ' + pr.plan_request_id);
    if (claim.fill_id !== pr.fill_id || claim.result !== 'rejected' || claim.reason !== pr.reason) invalid('Plan request ' + pr.plan_request_id + ' does not address a rejection of its fill.');
    if (ms(pr.created_at) < ms(claim.at)) invalid('Plan request ' + pr.plan_request_id + ' was made before the rejection it addresses.');
    if (!['refill_too_soon', 'prior_auth_required'].includes(pr.reason)) invalid('Plan request ' + pr.plan_request_id + ' addresses a reason the plan does not review.');
    if (['approved', 'denied'].includes(pr.state) !== (pr.decision !== null) || (pr.decision !== null && pr.decision !== pr.state)) invalid('Plan request ' + pr.plan_request_id + ' decision does not match its state.');
    if ((pr.state === 'pending') !== (pr.closed_at === null)) invalid('Plan request ' + pr.plan_request_id + ' is closed exactly when not pending.');
    if (pr.state === 'pending' && idx.fills.get(pr.fill_id).plan_request_id !== pr.plan_request_id) invalid('Pending plan request ' + pr.plan_request_id + ' is not its fill\'s current request.');
    if (pr.state === 'pending' && idx.fills.get(pr.fill_id).claim_id !== pr.claim_id) invalid('Pending plan request ' + pr.plan_request_id + ' does not address the fill\'s latest claim.');
  }
  for (const rn of data.renewals) {
    need(idx.rx, rn.rx_id, 'prescription', 'Renewal ' + rn.renewal_id);
    if ((rn.state === 'pending') !== (rn.closed_at === null)) invalid('Renewal ' + rn.renewal_id + ' is closed exactly when not pending.');
    if (rn.state === 'approved') {
      const next = need(idx.rx, rn.new_rx_id, 'prescription', 'Renewal ' + rn.renewal_id);
      if (idx.rx.get(rn.rx_id).superseded_by !== next.rx_id) invalid('Approved renewal ' + rn.renewal_id + ' does not supersede its prescription.');
    } else isNull(rn.new_rx_id, 'Renewal ' + rn.renewal_id + ' new prescription');
    if (rn.state === 'pending') {
      if (pendingByRx.has(rn.rx_id)) invalid('Prescription ' + rn.rx_id + ' has two pending renewals.');
      if (idx.rx.get(rn.rx_id).state === 'superseded') invalid('Renewal ' + rn.renewal_id + ' is pending on a superseded prescription.');
      pendingByRx.add(rn.rx_id);
    }
  }
}

function checkLog(data, idx) {
  for (const a of data.approvals) {
    need(idx.people, a.confirmed_by, 'person', 'Approval ' + a.approval_id);
    if (a.used_at !== null && ms(a.used_at) < ms(a.confirmed_at)) invalid('Approval ' + a.approval_id + ' was used before it was confirmed.');
  }
  for (const n of data.notices) {
    need(idx.people, n.recipient_id, 'recipient', 'Notice ' + n.notice_id);
    if (n.subject.type === 'fill') need(idx.fills, n.subject.id, 'fill', 'Notice ' + n.notice_id);
    if (n.subject.type === 'renewal') need(idx.renewals, n.subject.id, 'renewal', 'Notice ' + n.notice_id);
    if (textLength(n.title) > 200 || n.title.length > 200 || textLength(n.body) > 20000 || n.body.length > 20000) invalid('Notice ' + n.notice_id + ' is over the message limits.');
  }
}

function recordedInstants(data) {
  const out = [];
  const add = (v, where) => { if (v !== null && v !== undefined) out.push([v, where]); };
  for (const r of data.prescriptions) { add(r.received_at, 'Prescription ' + r.rx_id); add(r.superseded_at, 'Prescription ' + r.rx_id); }
  for (const f of data.fills) {
    const w = 'Fill ' + f.fill_id;
    add(f.requested_at, w); add(f.ready_at, w); add(f.warned_at, w); add(f.closed_at, w);
    for (const e of f.timeline) add(e.at, w);
    for (const r of f.refusals) add(r.at, w);
    for (const n of f.notes) add(n.at, w);
    if (f.hold) { add(f.hold.placed_at, w); add(f.hold.stored_decision?.at, w); }
    if (f.collector) add(f.collector.set_at, w);
  }
  for (const c of data.claims) { add(c.at, 'Claim ' + c.claim_id); add(c.reversed_at, 'Claim ' + c.claim_id); }
  for (const a of data.authorizations) { add(a.at, 'Authorization ' + a.authorization_id); add(a.ended_at, 'Authorization ' + a.authorization_id); }
  for (const c of data.charges) add(c.at, 'Charge ' + c.charge_id);
  for (const g of data.grants) { add(g.created_at, 'Grant ' + g.grant_id); add(g.revoked_at, 'Grant ' + g.grant_id); }
  for (const r of data.plan_requests) { add(r.created_at, 'Plan request ' + r.plan_request_id); add(r.closed_at, 'Plan request ' + r.plan_request_id); }
  for (const r of data.renewals) { add(r.created_at, 'Renewal ' + r.renewal_id); add(r.closed_at, 'Renewal ' + r.renewal_id); }
  for (const a of data.approvals) { add(a.confirmed_at, 'Approval ' + a.approval_id); add(a.used_at, 'Approval ' + a.approval_id); }
  for (const n of data.notices) add(n.at, 'Notice ' + n.notice_id);
  return out;
}

function earliestPending(data) {
  let best = null;
  const consider = (t, kind, label) => { if (best === null || t < best.t) best = { t, kind, label }; };
  for (const f of data.fills) {
    const label = 'fill ' + f.fill_id, held = f.hold !== null;
    if (f.collector && f.collector.via_grant_id !== null) {
      const g = data.grants.find(x => x.grant_id === f.collector.via_grant_id);
      if (g && g.expires_at !== null) consider(ms(g.expires_at), 'collector grant expiry', label);
    }
    if (TERMINAL.has(f.state)) continue;
    const rx = data.prescriptions.find(r => r.rx_id === f.rx_id);
    if (f.ready_at === null && rx) consider(rxExpiry(rx.written_on), 'prescription expiry', label);
    if (held) continue;
    for (const [kind, at] of [['review', f.review_due_at], ['resubmission', f.resubmission_due_at], ['warning', f.warning_due_at], ['return', f.return_due_at]]) if (at !== null) consider(ms(at), kind, label);
  }
  return best;
}

function validateSeed(ctx, data) {
  checkBinding(ctx, data);
  if (ctx.virtual_now) {
    const now = ms(ctx.virtual_now);
    for (const [at, where] of recordedInstants(data)) if (ms(at) > now) invalid(where + ' records ' + at + ', after the App\'s current time ' + ctx.virtual_now + '.');
    for (const f of data.fills) {
      if (f.review_due_at !== null && ms(f.review_due_at) > now + 16 * 24 * HOUR) invalid('Fill ' + f.fill_id + ' review is due more than 16 days ahead.');
      if (f.warning_due_at !== null && ms(f.warning_due_at) > now + 168 * HOUR) invalid('Fill ' + f.fill_id + ' pickup warning is due more than 168 hours ahead.');
      if (f.return_due_at !== null && ms(f.return_due_at) > now + 240 * HOUR) invalid('Fill ' + f.fill_id + ' return is due more than 240 hours ahead.');
    }
  }
  const idx = {
    people: unique(data.people, 'person_id', 'person'), prescribers: unique(data.prescribers, 'prescriber_id', 'prescriber'), drugs: unique(data.drugs, 'drug_id', 'drug'),
    plans: unique(data.plans, 'plan_id', 'plan'), stores: unique(data.stores, 'store_id', 'store'), cards: unique(data.cards, 'card_id', 'card'),
    rx: unique(data.prescriptions, 'rx_id', 'prescription'), fills: unique(data.fills, 'fill_id', 'fill'), claims: unique(data.claims, 'claim_id', 'claim'),
    authorizations: unique(data.authorizations, 'authorization_id', 'authorization'), charges: unique(data.charges, 'charge_id', 'charge'), grants: unique(data.grants, 'grant_id', 'grant'),
    planRequests: unique(data.plan_requests, 'plan_request_id', 'plan request'), renewals: unique(data.renewals, 'renewal_id', 'renewal'),
  };
  unique(data.approvals, 'approval_id', 'approval'); unique(data.notices, 'notice_id', 'notice');
  unique(data.fills.flatMap(f => f.refusals), 'refusal_id', 'refusal');
  checkPeople(data, idx);
  checkCatalog(data, idx);
  checkPrescriptions(data, idx);
  const claimsByFill = checkClaims(data, idx);
  for (const a of data.authorizations) { need(idx.fills, a.fill_id, 'fill', 'Authorization ' + a.authorization_id); need(idx.cards, a.card_id, 'card', 'Authorization ' + a.authorization_id); }
  for (const c of data.charges) { need(idx.fills, c.fill_id, 'fill', 'Charge ' + c.charge_id); need(idx.people, c.payer_id, 'payer', 'Charge ' + c.charge_id); need(idx.cards, c.card_id, 'card', 'Charge ' + c.charge_id); }
  for (const f of data.fills) checkFill(f, data, idx, claimsByFill);
  const active = new Map();
  for (const f of data.fills) if (!TERMINAL.has(f.state)) { if (active.has(f.rx_id)) invalid('Prescription ' + f.rx_id + ' has two active fills.'); active.set(f.rx_id, f.fill_id); }
  const span = f => [ms(f.requested_at), f.closed_at === null ? Infinity : ms(f.closed_at)];
  for (const a of data.fills) for (const b of data.fills) if (a.fill_id < b.fill_id && a.rx_id === b.rx_id) { const [s1, e1] = span(a), [s2, e2] = span(b); if (s1 < e2 && s2 < e1) invalid('Fills ' + a.fill_id + ' and ' + b.fill_id + ' of ' + a.rx_id + ' were open at the same time; a second request would have been refused.'); }
  checkGrants(data, idx);
  checkRequests(data, idx);
  checkLog(data, idx);
  for (const c of data.claims) if (c.reversed_at !== null && ms(c.reversed_at) < ms(c.at)) invalid('Claim ' + c.claim_id + ' was reversed before it was made.');
  for (const r of data.plan_requests) if (r.closed_at !== null && ms(r.closed_at) < ms(r.created_at)) invalid('Plan request ' + r.plan_request_id + ' closed before it was made.');
  for (const r of data.renewals) if (r.closed_at !== null && ms(r.closed_at) < ms(r.created_at)) invalid('Renewal ' + r.renewal_id + ' closed before it was made.');
  for (const g of data.grants) if (g.revoked_at !== null && ms(g.revoked_at) < ms(g.created_at)) invalid('Grant ' + g.grant_id + ' was revoked before it was created.');
  const earliest = earliestPending(data);
  if (earliest) for (const [at, where] of recordedInstants(data)) if (ms(at) >= earliest.t) invalid(where + ' records ' + at + ' at or after the earliest pending timer (' + earliest.kind + ' of ' + earliest.label + ', due ' + toIso(earliest.t) + '), which would have applied first.');
}

const KEYS = [['people', 'person_id'], ['prescribers', 'prescriber_id'], ['drugs', 'drug_id'], ['plans', 'plan_id'], ['stores', 'store_id'], ['cards', 'card_id'], ['prescriptions', 'rx_id'], ['fills', 'fill_id'], ['grants', 'grant_id']];
const records = data => KEYS.flatMap(([list]) => data[list]);
const objects = data => KEYS.flatMap(([list, key]) => data[list].map(r => r[key]));
const references = () => [];
module.exports = { validateSeed, records, objects, references, TERMINAL, NEXT, reachable, grantInForce };
