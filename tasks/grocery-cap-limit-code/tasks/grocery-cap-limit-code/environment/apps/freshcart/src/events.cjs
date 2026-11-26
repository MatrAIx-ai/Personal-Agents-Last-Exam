'use strict';
const { fail, copy } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');

function applyEvent(ctx, data, event) {
  if (event.operation === 'freshcart.substitution.offer') {
    const payload = event.payload;
    if (data.substitutions.some(row => row.id === payload.id)) return data;
    const order = data.orders.find(row => row.id === payload.order_id && row.status === 'confirmed');
    if (!order) {
      data.substitutions.push({ id: payload.id, order_id: payload.order_id, status: 'unmatched', offers: payload.offers, unavailable_item_id: payload.unavailable_item_id, offered_at: event.at, chosen_offer_id: null, delta_cents: 0 });
      return data;
    }
    if (!order.lines.some(line => line.item_id === payload.unavailable_item_id)) {
      fail('invalid_event', 'The confirmed order does not contain the unavailable item.');
    }
    data.substitutions.push({
      id: payload.id,
      order_id: payload.order_id,
      status: 'open',
      unavailable_item_id: payload.unavailable_item_id,
      offers: copy(payload.offers),
      offered_at: event.at,
      chosen_offer_id: null,
      delta_cents: 0
    });
    log(ctx, 'freshcart.substitution.offer', { id: payload.id });
    return data;
  }
  if (event.operation === 'freshcart.checkout.decide') {
    const payload = event.payload;
    const attempt = data.checkout_attempts.find(row => row.id === payload.attempt_id);
    if (!attempt) fail('invalid_event', 'Checkout attempt is missing.');
    if (attempt.outcome === 'approved' || attempt.outcome === 'declined') return data;
    attempt.outcome = payload.decision === 'approved' ? 'approved' : 'declined';
    attempt.decline_code = payload.decline_code || null;
    attempt.authorization_id = payload.authorization_id || null;
    if (payload.decision !== 'approved') {
      const sub = data.substitutions.find(row => row.attempt_id === attempt.id);
      if (sub) sub.status = 'card_declined';
      return data;
    }
    if (attempt.adjustment) {
      const order = data.orders.find(row => row.id === attempt.order_id);
      const sub = data.substitutions.find(row => row.id === attempt.substitution_id);
      if (!order || !sub) fail('invalid_event', 'Adjustment is missing its order.');
      const offer = sub.offers.find(row => row.id === sub.chosen_offer_id);
      const line = order.lines.find(row => row.item_id === sub.unavailable_item_id);
      if (!line || !offer) fail('invalid_event', 'Adjustment line is missing.');
      const previous = line.line_cents;
      line.item_id = offer.item_id;
      line.name = offer.label;
      line.unit_cents = line.unit_cents + Math.round(offer.delta_cents / line.qty);
      line.line_cents = previous + offer.delta_cents;
      order.subtotal_cents += offer.delta_cents;
      order.total_cents += offer.delta_cents;
      order.adjustments.push({ cents: offer.delta_cents, at: event.at, authorization_key: attempt.authorization_key });
      sub.status = 'accepted';
      return data;
    }
    data.orders.push({
      id: attempt.order_id,
      status: 'confirmed',
      lines: copy(attempt.lines),
      confirmed_lines: copy(attempt.lines),
      payment_method_id: attempt.payment_method_id,
      card_id: 'card-4417',
      subtotal_cents: attempt.subtotal_cents,
      delivery_cents: attempt.delivery_cents,
      confirmed_total_cents: attempt.total_cents,
      total_cents: attempt.total_cents,
      confirmed_at: event.at,
      slot: 'saturday-08-10',
      delivery_date: '2026-11-21',
      authorization_key: attempt.authorization_key,
      adjustments: []
    });
    log(ctx, 'freshcart.checkout.decide', { order_id: attempt.order_id, decision: payload.decision });
    return data;
  }
  fail('invalid_event', 'Unsupported operation.');
}

module.exports = { applyEvent };
