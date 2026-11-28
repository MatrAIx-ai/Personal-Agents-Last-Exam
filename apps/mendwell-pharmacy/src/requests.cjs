'use strict';
const { fail, nextId, bump, byId } = require('./util.cjs');
const { rxExpiry } = require('./time.cjs');
const { notifyFill } = require('./notices.cjs');
const L = require('./lifecycle.cjs');

function createPlanRequest(data, args, g) {
  const f = g.fill, claim = L.claimOf(data, f);
  if (f.state === 'pending_plan_decision') fail('request_pending', 'A plan request is already pending for fill ' + f.fill_id + '.');
  if (f.state !== 'claim_rejected' || !claim || !['refill_too_soon', 'prior_auth_required'].includes(claim.reason)) fail('invalid_state', 'A plan request applies only to a claim rejected as refill_too_soon or prior_auth_required; fill ' + f.fill_id + ' is ' + f.state + (claim && claim.reason ? ' (' + claim.reason + ')' : '') + '.');
  const pr = { plan_request_id: nextId(data, 'pr'), fill_id: f.fill_id, claim_id: claim.claim_id, reason: claim.reason, state: 'pending', decision: null, note: args.note ?? null, created_at: g.at, closed_at: null };
  data.plan_requests.push(pr);
  f.plan_request_id = pr.plan_request_id;
  f.resubmission_due_at = null;
  L.enter(data, f, 'pending_plan_decision', g.at);
  return pr;
}

function withdrawPlanRequest(data, args, g) {
  const pr = g.plan_request, f = g.fill;
  if (L.TERMINAL.has(f.state)) fail('invalid_state', 'Fill ' + f.fill_id + ' is ' + f.state + '.');
  if (pr.state !== 'pending') fail('request_not_pending', 'Plan request ' + pr.plan_request_id + ' is ' + pr.state + '.');
  pr.state = 'withdrawn';
  pr.closed_at = g.at;
  if (f.hold) f.hold.stored_decision = null;
  L.enter(data, f, 'claim_rejected', g.at);
  return pr;
}

function applyDecision(data, pr, f, decision, at) {
  pr.state = decision;
  pr.decision = decision;
  pr.closed_at = at;
  bump(data, f);
  if (decision === 'approved' && !f.waived.includes(pr.reason)) f.waived.push(pr.reason);
  if (decision === 'denied') L.enter(data, f, 'claim_rejected', at);
  notifyFill(data, 'notice.plan_decision', f, at, { decision, reason: pr.reason, plan_request_id: pr.plan_request_id });
  if (decision === 'approved') L.settle(data, f, L.attempt(data, f, at), at);
}

function planDecided(data, payload, ctx) {
  const pr = byId(data.plan_requests, 'plan_request_id', payload.plan_request_id);
  const f = byId(data.fills, 'fill_id', pr.fill_id);
  if (pr.state !== 'pending' || f.state !== 'pending_plan_decision' || f.claim_id !== pr.claim_id) return data;
  if (f.hold) {
    if (f.hold.stored_decision === null) { f.hold.stored_decision = { plan_request_id: pr.plan_request_id, decision: payload.decision, at: ctx.virtual_now }; bump(data, f); }
    return data;
  }
  applyDecision(data, pr, f, payload.decision, ctx.virtual_now);
  return data;
}

function createRenewal(data, args, g) {
  const rx = g.rx;
  if (rx.state === 'superseded') fail('invalid_state', 'Prescription ' + rx.rx_id + ' was already replaced by ' + rx.superseded_by + '.');
  const pending = data.renewals.find(r => r.rx_id === rx.rx_id && r.state === 'pending');
  if (pending) fail('duplicate_request', 'Renewal ' + pending.renewal_id + ' is already pending for prescription ' + rx.rx_id + '.');
  if (rx.fills_remaining >= 1 && g.now < rxExpiry(rx.written_on)) fail('invalid_state', 'Prescription ' + rx.rx_id + ' still has fills remaining and has not expired.');
  const rn = { renewal_id: nextId(data, 'rn'), rx_id: rx.rx_id, state: 'pending', new_rx_id: null, note: args.note ?? null, created_at: g.at, closed_at: null };
  data.renewals.push(rn);
  return rn;
}

function withdrawRenewal(data, args, g) {
  const rn = g.renewal;
  if (rn.state !== 'pending') fail('request_not_pending', 'Renewal ' + rn.renewal_id + ' is ' + rn.state + '.');
  rn.state = 'withdrawn';
  rn.closed_at = g.at;
  return rn;
}

module.exports = { createPlanRequest, withdrawPlanRequest, planDecided, applyDecision, createRenewal, withdrawRenewal };
