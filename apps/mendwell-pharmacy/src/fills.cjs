'use strict';
const { fail, nextId, bump, byId, newStep } = require('./util.cjs');
const { ms, toIso, HOUR, isOpen, nextOpening, rxExpiry, startOfDay } = require('./time.cjs');
const L = require('./lifecycle.cjs');

function reviewDue(store, now) {
  if (isOpen(store, now)) return now + 2 * HOUR;
  const opening = nextOpening(store, now);
  if (opening === null) fail('invalid_state', 'Store ' + store.store_id + ' has no opening in the next 14 days.');
  return opening + 2 * HOUR;
}

function request(data, args, g) {
  const rx = g.rx, drug = byId(data.drugs, 'drug_id', rx.drug_id);
  if (rx.state === 'superseded') fail('rx_superseded', 'Prescription ' + rx.rx_id + ' was replaced by ' + rx.superseded_by + '.');
  if (g.now >= rxExpiry(rx.written_on)) fail('rx_expired', 'Prescription ' + rx.rx_id + ' expired at ' + toIso(rxExpiry(rx.written_on)) + '.');
  if (rx.fills_remaining < 1) fail('no_fills_remaining', 'Prescription ' + rx.rx_id + ' has no fills remaining.');
  const active = data.fills.find(f => f.rx_id === rx.rx_id && !L.TERMINAL.has(f.state));
  if (active) fail('duplicate_request', 'Prescription ' + rx.rx_id + ' already has active fill ' + active.fill_id + '.');
  if (!drug.quantities.includes(args.quantity)) fail('quantity_not_allowed', drug.generic_name + ' ' + drug.strength + ' comes in quantities ' + drug.quantities.join(', ') + '.');
  const f = {
    fill_id: nextId(data, 'f'), fill_version: 0, rx_id: rx.rx_id, store_id: g.store.store_id, quantity: args.quantity, state: 'requested', requested_at: g.at,
    review_due_at: toIso(reviewDue(g.store, g.now)), resubmission_due_at: null, ready_at: null, warning_due_at: null, return_due_at: null, warned_at: null, hold: null,
    amount_due_cents: null, claim_id: null, waived: [], cash: null, authorization_id: null, charge_id: null, collector: null, plan_request_id: null, notes: [],
    timeline: [{ state: 'requested', at: g.at }], refusals: [], cancellation: null, closed_at: null,
  };
  data.fills.push(f);
  return f;
}

const heldActive = f => f.hold !== null && !L.TERMINAL.has(f.state);

function changeQuantity(data, args, g) {
  const f = g.fill, drug = byId(data.drugs, 'drug_id', g.rx.drug_id), claim = L.claimOf(data, f);
  if (heldActive(f)) fail('on_hold', 'Fill ' + f.fill_id + ' is on hold.');
  if (f.state === 'pending_plan_decision') fail('request_pending', 'A plan request is pending for fill ' + f.fill_id + '.');
  const resubmits = f.state === 'claim_rejected' && claim && claim.reason === 'quantity_limit' && !f.cash;
  if (f.state !== 'requested' && !resubmits) fail('invalid_state', 'The quantity can change only while requested or after a quantity_limit rejection; fill ' + f.fill_id + ' is ' + f.state + '.');
  if (!drug.quantities.includes(args.quantity)) fail('quantity_not_allowed', drug.generic_name + ' ' + drug.strength + ' comes in quantities ' + drug.quantities.join(', ') + '.');
  if (f.quantity === args.quantity) fail('invalid_state', 'Fill ' + f.fill_id + ' already has quantity ' + args.quantity + '.');
  f.quantity = args.quantity;
  bump(data, f);
  if (resubmits) L.resubmit(data, f, g.at);
  return f;
}

function changeStore(data, args, g) {
  const f = g.fill;
  if (heldActive(f)) fail('on_hold', 'Fill ' + f.fill_id + ' is on hold.');
  if (f.state === 'ready' || L.TERMINAL.has(f.state)) fail('invalid_state', 'Fill ' + f.fill_id + ' is ' + f.state + '; its store can no longer change.');
  const store = byId(data.stores, 'store_id', args.store_id);
  if (!store) fail('not_found', 'No store ' + args.store_id + '.');
  if (store.store_id === f.store_id) fail('invalid_state', 'Fill ' + f.fill_id + ' is already at store ' + store.store_id + '.');
  if (f.state === 'waiting_stock' && store.stock[g.rx.drug_id] !== true) fail('store_unavailable', 'Store ' + store.store_id + ' has no stock of ' + g.rx.drug_id + '.');
  f.store_id = store.store_id;
  bump(data, f);
  if (f.state === 'waiting_stock') L.becomeReady(data, f, g.at);
  return f;
}

function wait(data, args, g) {
  const f = g.fill, claim = L.claimOf(data, f);
  if (f.state !== 'claim_rejected' || !claim || claim.reason !== 'refill_too_soon' || f.cash) fail('invalid_state', 'Waiting applies only to a claim rejected as refill_too_soon; fill ' + f.fill_id + ' is ' + f.state + '.');
  if (f.resubmission_due_at !== null) fail('invalid_state', 'Fill ' + f.fill_id + ' already has a resubmission scheduled for ' + f.resubmission_due_at + '.');
  const due = Math.max(startOfDay(claim.eligible_on), g.now);
  f.resubmission_due_at = toIso(due);
  bump(data, f);
  if (due <= g.now && f.hold === null) { newStep(data); L.resubmit(data, f, g.at); }
  return f;
}

module.exports = { request, changeQuantity, changeStore, wait, reviewDue };
