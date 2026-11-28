'use strict';
const { nextId, bump, byId } = require('./util.cjs');
const { ms, isOpen } = require('./time.cjs');
const { collectorVia } = require('./authority.cjs');
const { cardUsable, liveAuthorization } = require('./payment.cjs');
const { notifyFill } = require('./notices.cjs');
const L = require('./lifecycle.cjs');

function refuse(data, f, reason, collectorId, at) {
  f.refusals.push({ refusal_id: nextId(data, 'rf'), reason, collector_id: collectorId, at });
  notifyFill(data, 'notice.refused', f, at, { reason });
  return data;
}

function payment(data, f, payload, t) {
  if (!(f.amount_due_cents > 0)) return { ok: true, charge: null };
  const auth = liveAuthorization(data, f);
  if (auth) {
    const card = byId(data.cards, 'card_id', auth.card_id);
    if (!cardUsable(card, t)) return { ok: false };
    return { ok: true, auth, charge: { payer_id: card.owner_id, card_id: card.card_id, method: 'capture' } };
  }
  const card = payload.card_id === undefined ? null : byId(data.cards, 'card_id', payload.card_id);
  if (!card || card.owner_id !== payload.collector_id || !cardUsable(card, t)) return { ok: false };
  return { ok: true, charge: { payer_id: card.owner_id, card_id: card.card_id, method: 'counter' } };
}

function collectionAttempted(data, payload, ctx) {
  const at = ctx.virtual_now, t = ms(at), f = byId(data.fills, 'fill_id', payload.fill_id), who = payload.collector_id;
  if (f.hold !== null && !L.TERMINAL.has(f.state)) return refuse(data, f, 'on_hold', who, at);
  if (f.state !== 'ready') return refuse(data, f, 'not_ready', who, at);
  if (!isOpen(byId(data.stores, 'store_id', f.store_id), t)) return refuse(data, f, 'store_closed', who, at);
  if (!collectorVia(data, f, who, t)) return refuse(data, f, 'collector_not_authorized', who, at);
  const paid = payment(data, f, payload, t);
  if (!paid.ok) return refuse(data, f, 'payment_failed', who, at);
  if (paid.auth) { paid.auth.state = 'captured'; paid.auth.ended_at = at; }
  if (paid.charge) {
    const charge = { charge_id: nextId(data, 'ch'), fill_id: f.fill_id, ...paid.charge, amount_cents: f.amount_due_cents, at };
    data.charges.push(charge);
    f.charge_id = charge.charge_id;
  }
  L.rxOf(data, f).fills_remaining -= 1;
  Object.assign(f, { warning_due_at: null, return_due_at: null, closed_at: at });
  bump(data, f);
  L.enter(data, f, 'collected', at);
  return data;
}

module.exports = { collectionAttempted };
