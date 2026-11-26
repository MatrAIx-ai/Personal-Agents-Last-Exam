'use strict';
const c = require('./common.cjs');
const rules = require('./rules.cjs');
const notices = require('./notices.cjs');
const {ms, time} = c;
const A = c.APP + '.';
// What the insurer, the shop and the lender do arrives here. Their amounts are applied as given: only the structure is checked.
const bad = message => c.fail('invalid_event', message);
function claimFor(data, id) {
  const claim = data.claims.find(k => k.id === id) || bad('The event names a claim that does not exist.');
  if (claim.state !== 'open') bad('The claim is withdrawn or closed. It takes no more events.');
  return claim;
}
const fresh = (data, id) => { if (c.allIds(data).includes(id)) bad('The ID ' + id + ' already exists.'); };
const amounts = (...values) => { if (values.some(v => v !== undefined && !c.twoDecimals(v))) bad('An amount has more than two decimals.'); };
const defaultEnd = (t, data, days) => time.iso(time.limitEnd(t.now, days, c.zone(data)), c.zone(data));
// The decision that a determination or a changed dispute gives to one line.
function decisionOf(t, given, source, sourceId) {
  amounts(given.amount);
  if (given.status === 'approved' ? !(given.amount > 0) : given.amount !== undefined || given.reason === undefined) bad('An approved line needs an amount above zero. A denied line needs a reason and no amount.');
  return {status: given.status, amount: given.status === 'approved' ? given.amount : null, reason: given.reason ?? null, decided_at: t.at, source, source_id: sourceId};
}
const handlers = {
  'request.issued'(t, data, p) {
    const claim = claimFor(data, p.claim_id);
    fresh(data, p.info_request_id);
    if (!p.asks.length) bad('An information request has no asks.');
    const request = {id: p.info_request_id, issued_at: t.at, due_at: p.due_at || defaultEnd(t, data, data.insurer.rules.request_response_days),
      issued_by: p.issued_by, state: 'open', asks: p.asks.map(ask => ({key: ask.key, text: ask.text, answer: null}))};
    claim.requests.push(request);
    c.record(t, data, claim, 'request.issued', request.id);
    return {claim, request};
  },
  'estimate.submitted'(t, data, p) {
    const claim = claimFor(data, p.claim_id), taken = new Set(c.linesOf(claim).map(row => row.line.id));
    fresh(data, p.estimate_id);
    if (claim.path === 'total_loss') bad('The claim is on the total_loss path. It takes no more estimates.');
    if (!p.lines.length) bad('An estimate has no lines.');
    for (const line of p.lines) {
      amounts(line.amount);
      if (taken.has(line.line_id) || !(line.amount > 0)) bad(taken.has(line.line_id) ? 'The line ' + line.line_id + ' already exists in this claim.' : 'A line amount is zero or less.');
      taken.add(line.line_id);
    }
    claim.estimates.push({id: p.estimate_id, kind: p.kind, source: p.source, shop_name: p.shop_name ?? null, submitted_at: t.at,
      lines: p.lines.map(line => ({id: line.line_id, text: line.text, amount: line.amount, decisions: []}))});
    c.record(t, data, claim, 'estimate.submitted', p.estimate_id);
    return {claim};
  },
  'determination.issued'(t, data, p) {
    const claim = claimFor(data, p.claim_id), ids = p.lines.map(line => line.line_id);
    fresh(data, p.determination_id);
    if (claim.path === 'total_loss') bad('The claim is on the total_loss path. It takes no more determinations.');
    if (!ids.length || new Set(ids).size !== ids.length) bad('A determination names each of its lines once, and at least one line.');
    const rows = p.lines.map(given => ({given, line: (c.findLine(claim, given.line_id) || bad('The determination names a line that the claim does not have.')).line}));
    claim.determinations.push({id: p.determination_id, issued_at: t.at, issued_by: p.issued_by, note: p.note ?? null, line_ids: ids});
    c.record(t, data, claim, 'determination.issued', p.determination_id);
    for (const {given, line} of rows) {
      line.decisions.push(decisionOf(t, given, 'determination', p.determination_id));
      // A newer determination on a line voids the open dispute on its older decision.
      for (const dispute of claim.disputes) if (dispute.line_id === line.id && dispute.state === 'open') { dispute.state = 'void'; c.record(t, data, claim, 'dispute.void', dispute.id, true); }
    }
    return {claim};
  },
  'dispute.decided'(t, data, p) {
    const claim = data.claims.find(k => k.disputes.some(d => d.id === p.dispute_id)) || bad('The event names a dispute that does not exist.');
    const dispute = claim.disputes.find(d => d.id === p.dispute_id);
    claimFor(data, claim.id);
    if (dispute.state !== 'open') bad('The dispute is not open.');
    if ((p.decision === 'changed') !== (p.line !== undefined)) bad('A changed decision gives the new decision of the line. An upheld decision gives none.');
    Object.assign(dispute, {state: p.decision, decided_at: t.at, decided_by: p.decided_by, note: p.note ?? null});
    if (p.decision === 'changed') c.findLine(claim, dispute.line_id).line.decisions.push(decisionOf(t, p.line, 'dispute', dispute.id));
    c.record(t, data, claim, 'dispute.decided', dispute.id);
    return {claim, dispute};
  },
  'offer.issued'(t, data, p) {
    const claim = claimFor(data, p.claim_id), vehicle = c.vehicleOf(c.policyOf(data, claim), claim.subject_id);
    fresh(data, p.offer_id);
    amounts(p.valuation, p.lienholder_payoff);
    if (!vehicle) bad('An offer is on a claim that is not an auto claim.');
    if (claim.offers.some(o => o.state === 'accepted')) bad('The claim already has an accepted offer.');
    if (!(p.valuation > 0) || p.lienholder_payoff < 0) bad('A valuation is above zero, and a payoff is not below zero.');
    if ((p.lienholder_payoff !== undefined) !== (vehicle.lienholder !== null)) bad('An offer has a payoff only when the vehicle has a lienholder.');
    const offer = {id: p.offer_id, issued_at: t.at, valuation: p.valuation, lienholder_payoff: p.lienholder_payoff ?? null,
      respond_by: p.respond_by || defaultEnd(t, data, data.insurer.rules.offer_response_days), issued_by: p.issued_by, basis: p.basis ?? null,
      state: 'open', answered_at: null, reason: null, evidence_ids: []};
    c.record(t, data, claim, 'offer.issued', offer.id);
    // A new offer supersedes an earlier one only if that one is still open now.
    for (const earlier of claim.offers) if (c.offerState(claim, earlier, t.now) === 'open') { earlier.state = 'superseded'; c.record(t, data, claim, 'offer.superseded', earlier.id, true); }
    if (!claim.offers.length) {
      claim.path = 'total_loss';
      c.record(t, data, claim, 'claim.total_loss', claim.id, true);
      for (const dispute of claim.disputes) if (dispute.state === 'open') { dispute.state = 'void'; c.record(t, data, claim, 'dispute.void', dispute.id, true); }
    }
    claim.offers.push(offer);
    return {claim, offer};
  },
  'payment.issued'(t, data, p) {
    const claim = claimFor(data, p.claim_id), named = p.payee !== undefined;
    fresh(data, p.payment_id);
    amounts(p.amount);
    if (!(p.amount > 0)) bad('A payment has an amount of zero or less.');
    if (named && (!['policyholder', 'shop', 'lienholder'].includes(p.payee.kind) || p.payee.kind === 'shop' && p.payee.name === undefined)) bad('A payment goes to the policyholder, a named shop or the lienholder.');
    if (p.kind === 'settlement' && (!named || p.payee.kind === 'shop')) bad('A settlement payment names its payee, the lienholder or the policyholder.');
    if (p.kind === 'settlement' && claim.path === 'repair') bad('A settlement payment is on a claim on the repair path.');
    if (p.kind === 'repair' && claim.path === 'total_loss') bad('A repair payment is on a claim on the total_loss path.');
    // A repair payment that names no payee goes to the direction on file. With no direction on file it goes to the policyholder.
    const direction = p.kind === 'repair' ? c.copy(claim.payee) : null;
    const payee = named ? {kind: p.payee.kind, name: p.payee.name ?? null} : direction ? {kind: direction.kind, name: direction.name ?? null} : {kind: 'policyholder', name: null};
    const payment = {id: p.payment_id, kind: p.kind, amount: p.amount, payee, direction_on_file: direction, payee_named: named,
      reference: p.reference ?? null, issued_at: t.at, state: 'issued'};
    claim.payments.push(payment);
    c.record(t, data, claim, 'payment.issued', payment.id);
    return {claim, payment};
  },
  'repair.completed'(t, data, p) {
    const claim = claimFor(data, p.claim_id);
    amounts(p.final_invoice_total);
    if (claim.path === 'total_loss') bad('The claim is on the total_loss path. It has no repair to complete.');
    if (claim.repair_completed_at !== null) bad('The repair is already reported complete.');
    Object.assign(claim, {repair_completed_at: t.at, repair_reported_by: p.reported_by, final_invoice_total: p.final_invoice_total ?? null});
    c.record(t, data, claim, 'repair.completed', claim.id);
    return {claim};
  },
  'claim.closed'(t, data, p) {
    const claim = claimFor(data, p.claim_id);
    Object.assign(claim, {state: 'closed', outcome: p.outcome, closed_at: t.at});
    c.record(t, data, claim, 'claim.closed', claim.id);
    c.endClaim(t, data, claim, 'claim_closed');
    return {claim};
  }
};
function applyEvent(ctx, data, event) {
  const kind = event.operation.startsWith(A) ? event.operation.slice(A.length) : '';
  if (!handlers[kind]) bad('Unsupported operation.');
  const t = {ctx, at: event.at, now: ms(event.at), actor: 'event', ref: event.event_id};
  const {claim, ...details} = handlers[kind](t, data, event.payload);
  notices.write(t, data, claim, kind, {payload: event.payload, ...details});
  // The same rules as a seed. A failure rejects the event and leaves the state unchanged.
  rules.validate(ctx, data, 'invalid_event');
  return data;
}
module.exports = {applyEvent};
