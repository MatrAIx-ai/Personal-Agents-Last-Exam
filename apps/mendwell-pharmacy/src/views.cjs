'use strict';
const { byId, sortBy } = require('./util.cjs');
const { ms, toIso, rxExpiry } = require('./time.cjs');
const { relation, fillAccess, inForceAt } = require('./authority.cjs');
const { parseToken, approvalView } = require('./tokens.cjs');

function canAct(data, actor, parsed, now) {
  if (!parsed) return false;
  if (parsed.kind === 'fill') {
    const f = byId(data.fills, 'fill_id', parsed.id);
    if (!f) return false;
    const rel = relation(data, actor, byId(data.prescriptions, 'rx_id', f.rx_id).patient_id, now);
    if (parsed.action === 'prepay') return fillAccess(rel, f.fill_id) !== null;
    return (parsed.action === 'cash' || parsed.action === 'cancel') && rel.refill;
  }
  if (parsed.kind === 'grant') {
    const g = byId(data.grants, 'grant_id', parsed.id);
    return Boolean(g) && (parsed.action === 'revoke' || parsed.action === 'grant') && relation(data, actor, g.patient_id, now).full;
  }
  return parsed.action === 'grant' && Boolean(byId(data.people, 'person_id', parsed.id)) && relation(data, actor, parsed.id, now).full;
}

function approvalsFor(data, actor, now, match) {
  return data.approvals
    .filter(a => a.confirmed_by === actor)
    .map(a => ({ a, parsed: parseToken(a.token) }))
    .filter(({ a, parsed }) => parsed && match(parsed) && canAct(data, actor, parsed, now))
    .sort((x, y) => ms(x.a.confirmed_at) - ms(y.a.confirmed_at) || (x.a.approval_id < y.a.approval_id ? -1 : 1))
    .map(({ a }) => approvalView(a, now));
}

function warningAt(f) { return f.warning_due_at !== null ? f.warning_due_at : f.warned_at; }
function returnAt(f) { return f.return_due_at !== null ? f.return_due_at : f.state === 'returned_to_stock' ? f.closed_at : null; }

function fillView(data, f, access, actor, now) {
  const fillApprovals = approvalsFor(data, actor, now, p => p.kind === 'fill' && p.id === f.fill_id);
  if (access === 'logistics') {
    const auth = f.authorization_id === null ? null : byId(data.authorizations, 'authorization_id', f.authorization_id);
    const own = auth && byId(data.cards, 'card_id', auth.card_id).owner_id === actor ? { card_last4: byId(data.cards, 'card_id', auth.card_id).last4, amount_cents: auth.amount_cents, state: auth.state } : null;
    return { view: 'logistics', fill_id: f.fill_id, store_id: f.store_id, state: f.state, amount_due_cents: f.amount_due_cents, ready_at: f.ready_at, return_at: returnAt(f), own_authorization: own, approvals: fillApprovals };
  }
  const rx = byId(data.prescriptions, 'rx_id', f.rx_id);
  const claim = f.claim_id === null ? null : byId(data.claims, 'claim_id', f.claim_id);
  const auth = f.authorization_id === null ? null : byId(data.authorizations, 'authorization_id', f.authorization_id);
  const pr = f.plan_request_id === null ? null : byId(data.plan_requests, 'plan_request_id', f.plan_request_id);
  const charge = f.charge_id === null ? null : byId(data.charges, 'charge_id', f.charge_id);
  return {
    view: 'full', fill_id: f.fill_id, fill_version: f.fill_version, patient_id: rx.patient_id, rx_id: f.rx_id, drug_id: rx.drug_id, quantity: f.quantity, store_id: f.store_id, state: f.state,
    amount_due_cents: f.amount_due_cents,
    claim: claim && { claim_id: claim.claim_id, attempt: claim.attempt, result: claim.result, reason: claim.reason, eligible_on: claim.eligible_on, waived: [...f.waived], reversed_at: claim.reversed_at },
    cash: f.cash && { price_cents: f.cash.price_cents },
    authorization: auth && { authorization_id: auth.authorization_id, card_last4: byId(data.cards, 'card_id', auth.card_id).last4, amount_cents: auth.amount_cents, state: auth.state },
    collector_id: f.collector ? f.collector.person_id : null,
    hold: f.hold && { note: f.hold.note, placed_at: f.hold.placed_at },
    notes: f.notes.map(n => ({ at: n.at, text: n.text })),
    plan_request: pr && { plan_request_id: pr.plan_request_id, reason: pr.reason, state: pr.state },
    review_due_at: f.review_due_at, resubmission_due_at: f.resubmission_due_at, ready_at: f.ready_at, warning_at: warningAt(f), return_at: returnAt(f),
    timeline: f.timeline.map(e => ({ state: e.state, at: e.at })),
    refusals: f.refusals.map(r => ({ reason: r.reason, at: r.at })),
    cancellation: f.cancellation && { reason: f.cancellation.reason, stage: f.cancellation.stage, at: f.cancellation.at },
    charge: charge && { charge_id: charge.charge_id, amount_cents: charge.amount_cents, payer_id: charge.payer_id, method: charge.method, at: charge.at },
    approvals: fillApprovals,
  };
}

function rxView(data, rx, now, withFacts) {
  const drug = byId(data.drugs, 'drug_id', rx.drug_id), prescriber = byId(data.prescribers, 'prescriber_id', rx.prescriber_id);
  const expiry = rxExpiry(rx.written_on);
  const view = {
    rx_id: rx.rx_id, patient_id: rx.patient_id, prescriber: { prescriber_id: prescriber.prescriber_id, name: prescriber.name },
    drug: { drug_id: drug.drug_id, generic_name: drug.generic_name, strength: drug.strength, form: drug.form }, quantity: rx.quantity,
    fills_authorized: rx.fills_authorized, fills_remaining: rx.fills_remaining, written_on: rx.written_on, expires_at: toIso(expiry),
    state: rx.state === 'superseded' ? 'superseded' : now >= expiry ? 'expired' : 'active', superseded_by: rx.superseded_by,
    renewals: data.renewals.filter(r => r.rx_id === rx.rx_id).sort(sortBy('renewal_id')).map(r => ({ renewal_id: r.renewal_id, state: r.state })),
    fill_ids: data.fills.filter(f => f.rx_id === rx.rx_id).map(f => f.fill_id).sort(),
  };
  if (withFacts) view.facts = drug.facts.map(f => ({ text: f.text, source: { ...f.source } }));
  return view;
}

function grantState(g, now) {
  if (g.status === 'revoked') return 'revoked';
  return inForceAt(g, now) ? 'active' : 'expired';
}

const grantView = (g, now) => ({ grant_id: g.grant_id, grant_version: g.grant_version, patient_id: g.patient_id, grantor_id: g.grantor_id, grantee_id: g.grantee_id, scope: g.scope, fill_id: g.fill_id, expires_at: g.expires_at, state: grantState(g, now) });
const planRequestView = pr => ({ plan_request_id: pr.plan_request_id, fill_id: pr.fill_id, claim_id: pr.claim_id, reason: pr.reason, state: pr.state, decision: pr.decision });
const renewalView = r => ({ renewal_id: r.renewal_id, rx_id: r.rx_id, state: r.state, new_rx_id: r.new_rx_id });

module.exports = { fillView, rxView, grantView, grantState, planRequestView, renewalView, approvalsFor, canAct };
