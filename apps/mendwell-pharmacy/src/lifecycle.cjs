'use strict';
const { nextId, bump, byId } = require('./util.cjs');
const { ms, toIso, HOUR } = require('./time.cjs');
const { adjudicate } = require('./plans.cjs');
const { notifyFill } = require('./notices.cjs');

const TERMINAL = new Set(['collected', 'returned_to_stock', 'cancelled']);
const UNMADE = new Set(['requested', 'waiting_stock', 'claim_rejected', 'pending_plan_decision']);
const rxOf = (data, f) => byId(data.prescriptions, 'rx_id', f.rx_id);
const claimOf = (data, f) => (f.claim_id === null ? null : byId(data.claims, 'claim_id', f.claim_id));
const hasStock = (data, f) => byId(data.stores, 'store_id', f.store_id).stock[rxOf(data, f).drug_id] === true;

function enter(data, f, state, at) {
  f.state = state;
  f.timeline.push({ state, at });
  bump(data, f);
}

function attempt(data, f, at) {
  const outcome = adjudicate(data, f, at);
  const claim = { claim_id: nextId(data, 'cl'), fill_id: f.fill_id, attempt: data.claims.filter(c => c.fill_id === f.fill_id).length + 1, at, ...outcome, reversed_at: null };
  data.claims.push(claim);
  f.claim_id = claim.claim_id;
  bump(data, f);
  return claim;
}

function becomeReady(data, f, at) {
  const claim = claimOf(data, f);
  f.amount_due_cents = f.cash ? f.cash.price_cents : claim.copay_cents;
  f.ready_at = at;
  f.warned_at = null;
  f.warning_due_at = toIso(ms(at) + 168 * HOUR);
  f.return_due_at = toIso(ms(at) + 240 * HOUR);
  enter(data, f, 'ready', at);
  notifyFill(data, 'notice.fill_ready', f, at);
}

function fundedOutcome(data, f, at) {
  if (hasStock(data, f)) becomeReady(data, f, at);
  else enter(data, f, 'waiting_stock', at);
}

function settle(data, f, claim, at) {
  if (claim.result === 'paid') return fundedOutcome(data, f, at);
  enter(data, f, 'claim_rejected', at);
  notifyFill(data, 'notice.claim_rejected', f, at, { reason: claim.reason, eligible_on: claim.eligible_on });
}

function review(data, f, at) {
  f.review_due_at = null;
  settle(data, f, attempt(data, f, at), at);
}

function resubmit(data, f, at) {
  f.resubmission_due_at = null;
  settle(data, f, attempt(data, f, at), at);
}

function voidLive(data, f, at) {
  const auth = f.authorization_id === null ? null : byId(data.authorizations, 'authorization_id', f.authorization_id);
  if (!auth || auth.state !== 'live') return null;
  auth.state = 'voided';
  auth.ended_at = at;
  bump(data, f);
  return auth;
}

function reversePaid(data, f, at) {
  const claim = claimOf(data, f);
  if (claim && claim.result === 'paid' && !f.cash && claim.reversed_at === null) { claim.reversed_at = at; return true; }
  return false;
}

function notifyVoid(data, f, auth, at) {
  const card = byId(data.cards, 'card_id', auth.card_id);
  notifyFill(data, 'notice.payment_voided', f, at, { card_owner: card.owner_id, card_last4: card.last4, amount_cents: auth.amount_cents });
}

function clearTimers(f) {
  Object.assign(f, { review_due_at: null, resubmission_due_at: null, warning_due_at: null, return_due_at: null, hold: null });
}

function cancel(data, f, at, reason) {
  const stage = f.state;
  reversePaid(data, f, at);
  const voided = voidLive(data, f, at);
  if (f.plan_request_id !== null) {
    const pr = byId(data.plan_requests, 'plan_request_id', f.plan_request_id);
    if (pr.state === 'pending') { pr.state = 'withdrawn'; pr.closed_at = at; }
  }
  clearTimers(f);
  f.cancellation = { reason, stage, at };
  f.closed_at = at;
  enter(data, f, 'cancelled', at);
  if (voided) notifyVoid(data, f, voided, at);
}

function returnToStock(data, f, at) {
  const reversed = reversePaid(data, f, at);
  const voided = voidLive(data, f, at);
  clearTimers(f);
  f.closed_at = at;
  enter(data, f, 'returned_to_stock', at);
  notifyFill(data, 'notice.returned', f, at, { reversed });
  if (voided) notifyVoid(data, f, voided, at);
}

function warn(data, f, at) {
  f.warned_at = at;
  f.warning_due_at = null;
  bump(data, f);
  notifyFill(data, 'notice.return_warning', f, at);
}

module.exports = { TERMINAL, UNMADE, rxOf, claimOf, hasStock, enter, attempt, becomeReady, fundedOutcome, settle, review, resubmit, cancel, returnToStock, warn, voidLive, reversePaid, notifyVoid };
