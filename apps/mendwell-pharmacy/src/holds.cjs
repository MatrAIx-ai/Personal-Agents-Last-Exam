'use strict';
const { bump, byId, newStep } = require('./util.cjs');
const { ms, toIso } = require('./time.cjs');
const { notifyFill } = require('./notices.cjs');
const { applyDecision } = require('./requests.cjs');
const L = require('./lifecycle.cjs');

function holdPlaced(data, payload, ctx) {
  const at = ctx.virtual_now, t = ms(at), f = byId(data.fills, 'fill_id', payload.fill_id);
  if (f.hold !== null || L.TERMINAL.has(f.state)) return data;
  const remaining = {};
  if (f.state === 'requested') { remaining.review_ms = ms(f.review_due_at) - t; f.review_due_at = null; }
  if (f.state === 'ready') {
    if (f.warning_due_at !== null) { remaining.warning_ms = ms(f.warning_due_at) - t; f.warning_due_at = null; }
    remaining.return_ms = ms(f.return_due_at) - t;
    f.return_due_at = null;
  }
  f.hold = { note: payload.note, placed_at: at, remaining, stored_decision: null };
  f.notes.push({ at, text: payload.note });
  bump(data, f);
  notifyFill(data, 'notice.held', f, at, { note: payload.note });
  return data;
}

function holdReleased(data, payload, ctx) {
  const at = ctx.virtual_now, t = ms(at), f = byId(data.fills, 'fill_id', payload.fill_id);
  if (f.hold === null || L.TERMINAL.has(f.state)) return data;
  const { remaining, stored_decision: stored } = f.hold;
  if (remaining.review_ms !== undefined) f.review_due_at = toIso(t + remaining.review_ms);
  if (remaining.warning_ms !== undefined) f.warning_due_at = toIso(t + remaining.warning_ms);
  if (remaining.return_ms !== undefined) f.return_due_at = toIso(t + remaining.return_ms);
  f.hold = null;
  f.notes.push({ at, text: payload.note });
  bump(data, f);
  notifyFill(data, 'notice.released', f, at, { note: payload.note });
  if (stored && f.state === 'pending_plan_decision') {
    const pr = byId(data.plan_requests, 'plan_request_id', stored.plan_request_id);
    if (pr.state === 'pending' && f.plan_request_id === pr.plan_request_id && f.claim_id === pr.claim_id) applyDecision(data, pr, f, stored.decision, at);
  }
  if (f.state === 'claim_rejected' && f.resubmission_due_at !== null && ms(f.resubmission_due_at) <= t) {
    const claim = L.claimOf(data, f);
    if (claim && claim.reason === 'refill_too_soon' && !f.cash) { newStep(data); L.resubmit(data, f, at); }
    else f.resubmission_due_at = null;
  }
  if (f.state === 'waiting_stock' && L.hasStock(data, f)) L.becomeReady(data, f, at);
  return data;
}

function storeRestocked(data, payload, ctx) {
  const at = ctx.virtual_now, store = byId(data.stores, 'store_id', payload.store_id);
  store.stock[payload.drug_id] = true;
  const waiting = data.fills.filter(f => f.state === 'waiting_stock' && f.hold === null && f.store_id === store.store_id && L.rxOf(data, f).drug_id === payload.drug_id).sort((a, b) => (a.fill_id < b.fill_id ? -1 : 1));
  for (const f of waiting) L.becomeReady(data, f, at);
  return data;
}

module.exports = { holdPlaced, holdReleased, storeRestocked };
