'use strict';
const c = require('./common.cjs');
const {ms, cents, money, sum, time} = c;
// Everything here is computed from stored records and the supplied clock when it is read. Nothing is stored.

// The standing decision of a line and whether it can still be disputed.
function standingView(data, claim, line, now) {
  const last = c.standing(line);
  if (!last) return {status: 'pending', approved_amount: null, reason: null, decided_at: null, dispute_by: null, disputable: false};
  const days = data.insurer.rules.dispute_window_days, decided = ms(last.decided_at);
  const partial = last.status === 'denied' || cents(last.amount) < cents(line.amount);
  return {status: last.status, approved_amount: last.amount, reason: last.reason, decided_at: last.decided_at,
    dispute_by: time.lastDay(decided, days, c.zone(data)),
    disputable: claim.state === 'open' && claim.path === 'repair' && partial && !alreadyDisputed(claim, line) && now < time.limitEnd(decided, days, c.zone(data))};
}
// A decision can be disputed once. A decision that a dispute produced cannot be disputed again.
function alreadyDisputed(claim, line) {
  const index = line.decisions.length - 1;
  return line.decisions[index].source === 'dispute' ||
    claim.disputes.some(d => d.line_id === line.id && d.decision_index === index && d.state !== 'void');
}
function standingOffer(claim) {
  return claim.offers.find(offer => offer.state === 'accepted') || claim.offers[claim.offers.length - 1] || null;
}
const paid = (claim, kind, payee) => sum(claim.payments.filter(p => p.kind === kind && (!payee || p.payee.kind === payee)).map(p => cents(p.amount)));
// What the insurer owes for an approved amount: the amount minus the deductible, never below zero and never above the limit.
function owed(coverage, approved) {
  const beforeLimit = Math.max(0, approved - cents(coverage.deductible)), limit = coverage.limit === null ? Infinity : cents(coverage.limit);
  return {owes: Math.min(beforeLimit, limit), overLimit: Math.max(0, beforeLimit - limit)};
}
function summary(data, claim, now) {
  const policy = c.policyOf(data, claim), coverage = c.coverageOf(policy, claim.coverage), repairPaid = paid(claim, 'repair');
  if (claim.path === 'repair') {
    let approved = 0, notApproved = 0;
    for (const {line} of c.linesOf(claim)) {
      const last = c.standing(line), amount = last && last.status === 'approved' ? cents(last.amount) : 0;
      approved += amount;
      notApproved += Math.max(0, cents(line.amount) - amount);
    }
    const {owes, overLimit} = owed(coverage, approved);
    return {approved_total: money(approved), insurer_owes: money(owes), over_limit: money(overLimit), paid: money(repairPaid),
      still_due: money(Math.max(0, owes - repairPaid)), overpaid: money(Math.max(0, repairPaid - owes)),
      my_share: money(Math.min(cents(coverage.deductible), approved)), not_approved_total: money(notApproved), settlement: null};
  }
  const offer = standingOffer(claim), accepted = offer.state === 'accepted', lien = offer.lienholder_payoff !== null;
  const net = Math.max(0, cents(offer.valuation) - cents(coverage.deductible));
  const toLien = lien ? Math.min(net, cents(offer.lienholder_payoff)) : 0, toMe = net - toLien;
  const paidLien = paid(claim, 'settlement', 'lienholder'), paidMe = paid(claim, 'settlement', 'policyholder');
  return {approved_total: null, insurer_owes: null, over_limit: null, paid: money(repairPaid), still_due: null,
    overpaid: money(accepted ? Math.max(0, paidLien + paidMe - net) : paidLien + paidMe), my_share: null, not_approved_total: null,
    settlement: {offer_id: offer.id, offer_state: c.offerState(claim, offer, now), valuation: offer.valuation, lienholder_payoff: offer.lienholder_payoff,
      net: money(net), to_lienholder: money(toLien), to_me: money(toMe), shortfall: lien ? money(Math.max(0, cents(offer.lienholder_payoff) - net)) : null,
      paid_to_lienholder: money(paidLien), paid_to_me: money(paidMe),
      still_due_to_lienholder: money(accepted ? Math.max(0, toLien - paidLien) : 0), still_due_to_me: money(accepted ? Math.max(0, toMe - paidMe) : 0)}};
}
// The rental benefit stops at the start of the earliest of these days. Returns a day number, or Infinity.
function rentalStop(data, claim) {
  const day = value => time.dayNumber(time.localDay(ms(value), c.zone(data))), stops = [];
  if (claim.offers.length) stops.push(day(claim.offers[0].issued_at) + data.insurer.rules.rental_grace_days);
  for (const value of [claim.repair_completed_at, claim.withdrawn_at, claim.closed_at]) if (value) stops.push(day(value));
  return stops.length ? Math.min(...stops) : Infinity;
}
// Each rental period with its days. The policy's longest number of days is used in order of start.
function rentals(data, claim, now) {
  const benefit = c.policyOf(data, claim).rental_benefit, stop = rentalStop(data, claim), out = new Map();
  const day = value => time.dayNumber(time.localDay(value, c.zone(data)));
  let used = 0;
  for (const rental of [...claim.rentals].sort((a, b) => ms(a.start_at) - ms(b.start_at))) {
    const first = day(ms(rental.start_at)), end = rental.state === 'ended' ? day(ms(rental.end_at)) : day(now);
    const days = Math.max(0, end - first), covered = Math.max(0, Math.min(days, stop - first, benefit.max_days - used));
    used += covered;
    const rate = cents(rental.daily_rate), cap = cents(benefit.daily_cap);
    out.set(rental.id, {rental_days: days, covered_days: covered, uncovered_days: days - covered,
      my_cost: money((days - covered) * rate + covered * Math.max(0, rate - cap))});
  }
  return out;
}
function flags(data, claim, now, money_, rentalRows) {
  const list = [], lines = c.linesOf(claim).map(row => c.standing(row.line)), repair = claim.path === 'repair';
  const direction = payment => payment.direction_on_file || {kind: 'policyholder'};
  const last = claim.offers[claim.offers.length - 1], offer = standingOffer(claim);
  if (claim.state === 'open' && claim.requests.some(r => r.state === 'open' && now >= ms(r.due_at))) list.push('request_overdue');
  if (lines.some(d => !d)) list.push('lines_pending');
  if (lines.some(d => d && d.status === 'denied')) list.push('lines_denied');
  if (repair && money_.approved_total > 0 && money_.insurer_owes === 0) list.push('under_deductible');
  if (money_.overpaid > 0) list.push('overpaid');
  if (claim.payments.some(p => p.kind === 'repair' && (p.payee.kind !== direction(p).kind || p.payee.kind === 'shop' && p.payee.name !== direction(p).name))) list.push('payee_mismatch');
  if (last && c.offerState(claim, last, now) === 'expired') list.push('offer_expired');
  if (offer && money_.settlement && money_.settlement.shortfall > 0) list.push('below_payoff');
  if ([...rentalRows.values()].some(r => r.uncovered_days > 0)) list.push('rental_uncovered');
  return list;
}
function estimateView(data, claim, estimate, now) {
  return {...c.copy(estimate), lines: estimate.lines.map(line => ({...c.copy(line), standing: standingView(data, claim, line, now)})), claim_id: claim.id};
}
function claimView(data, claim, now) {
  const policy = c.policyOf(data, claim), coverage = c.coverageOf(policy, claim.coverage), vehicle = c.vehicleOf(policy, claim.subject_id);
  const money_ = summary(data, claim, now), rentalRows = rentals(data, claim, now), stop = rentalStop(data, claim);
  return {...c.copy(claim),
    requests: claim.requests.map(r => ({...c.copy(r), overdue: claim.state === 'open' && r.state === 'open' && now >= ms(r.due_at)})),
    estimates: claim.estimates.map(e => estimateView(data, claim, e, now)),
    offers: claim.offers.map(o => ({...c.copy(o), state: c.offerState(claim, o, now)})),
    rentals: claim.rentals.map(r => ({...c.copy(r), ...rentalRows.get(r.id)})),
    deductible: coverage.deductible, limit: coverage.limit, lienholder: vehicle ? c.copy(vehicle.lienholder) : null,
    rental_stops_on: claim.rentals.length && Number.isFinite(stop) ? time.dayString(stop) : null,
    summary: money_, flags: flags(data, claim, now, money_, rentalRows)};
}
function claimRow(data, claim, now) {
  const money_ = summary(data, claim, now);
  return {id: claim.id, policy_id: claim.policy_id, coverage: claim.coverage, subject_id: claim.subject_id, loss_at: claim.loss_at, filed_at: claim.filed_at,
    state: claim.state, path: claim.path, outcome: claim.outcome, flags: flags(data, claim, now, money_, rentals(data, claim, now))};
}
const policyView = (policy, now) => ({...c.copy(policy), in_force: now >= ms(policy.term.start) && now < ms(policy.term.end)});
module.exports = {standingView, alreadyDisputed, standingOffer, owed, summary, rentals, claimView, claimRow, estimateView, policyView};
