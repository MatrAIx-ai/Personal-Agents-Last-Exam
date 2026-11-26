'use strict';
const { fail, copy } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');
const { subtotal, withDelivery, pricedLines } = require('./prices.cjs');

function nextId(data, prefix) {
  data.next_serial += 1;
  return prefix + '-' + data.next_serial;
}

function publicOrder(order) {
  const view = copy(order);
  delete view.authorization_request;
  return view;
}

function publicAttempt(attempt) {
  const view = copy(attempt);
  delete view.authorization_request;
  return view;
}

function handleTool(ctx, data, name, args) {
  log(ctx, name + '.started', {});
  if (name === 'freshcart.catalog.list') {
    const query = String(args.query || '').toLowerCase();
    const items = data.catalog.filter(item => !query || (item.name + ' ' + item.role).toLowerCase().includes(query));
    return { data, result: { items: copy(items) } };
  }
  if (name === 'freshcart.list.get') return { data, result: { items: copy(data.shared_list), list_total_cents: data.list_total_cents } };
  if (name === 'freshcart.cart.get') return { data, result: { lines: copy(data.cart) } };
  if (name === 'freshcart.preview') {
    const listGoods = subtotal(data, data.shared_list);
    const cartGoods = subtotal(data, data.cart);
    return { data, result: {
      list_subtotal_cents: listGoods,
      cart_subtotal_cents: cartGoods,
      delivery_cents: data.delivery_cents,
      list_total_cents: withDelivery(data, listGoods),
      cart_total_cents: withDelivery(data, cartGoods),
      list_lines: pricedLines(data, data.shared_list),
      cart_lines: pricedLines(data, data.cart)
    } };
  }
  if (name === 'freshcart.payments.list') {
    const payment_methods = data.payment_methods.map(row => ({
      id: row.id, brand: row.brand, last_four: row.last_four, kind: row.kind, label: row.label, card_id: row.card_id
    }));
    return { data, result: { payment_methods } };
  }
  if (name === 'freshcart.orders.list') return { data, result: { orders: data.orders.map(publicOrder) } };
  if (name === 'freshcart.orders.get') {
    const order = data.orders.find(row => row.id === args.id);
    if (!order) fail('not_found', 'Order does not exist.');
    return { data, result: { order: publicOrder(order) } };
  }
  if (name === 'freshcart.substitutions.list') return { data, result: { substitutions: copy(data.substitutions) } };
  if (name === 'freshcart.checkout.attempts') return { data, result: { attempts: data.checkout_attempts.map(publicAttempt) } };

  if (name === 'freshcart.cart.set') {
    const lines = args.lines.map(line => ({ item_id: line.item_id, qty: line.qty }));
    subtotal(data, lines);
    data.cart = lines;
    log(ctx, 'freshcart.cart.set', { line_count: lines.length });
    return { data, result: { line_count: lines.length } };
  }
  if (name === 'freshcart.payments.select') {
    const method = data.payment_methods.find(row => row.id === args.payment_method_id);
    if (!method) fail('not_found', 'Payment method is not saved on this account.');
    for (const row of data.payment_selections) {
      if (!row.used) row.abandoned = true;
    }
    const selection_id = nextId(data, 'sel');
    data.payment_selections.push({
      id: selection_id,
      at: ctx.virtual_now,
      payment_method_id: method.id,
      brand: method.brand,
      last_four: method.last_four,
      kind: method.kind,
      used: false,
      abandoned: false
    });
    data.selected_payment_method_id = method.id;
    return { data, result: { selection_id, payment_method_id: method.id, last_four: method.last_four } };
  }
  if (name === 'freshcart.checkout.place') {
    if (!data.cart.length) fail('invalid_state', 'The cart is empty.');
    const method = data.payment_methods.find(row => row.id === data.selected_payment_method_id);
    if (!method) fail('invalid_state', 'Select a saved payment method before checkout.');
    const goods = subtotal(data, data.cart);
    const total = withDelivery(data, goods);
    const orderId = args.order_id || nextId(data, 'fc-order');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(orderId)) fail('invalid_arguments', 'Order id is not a valid token.');
    if (data.orders.some(row => row.id === orderId) || data.checkout_attempts.some(row => row.order_id === orderId && row.outcome === 'approved')) {
      fail('invalid_state', 'That order id is already used.');
    }
    const prior = data.checkout_attempts.filter(row => row.order_id === orderId).length + 1;
    const attemptId = nextId(data, 'att');
    const selection = [...data.payment_selections].reverse().find(row => row.payment_method_id === method.id && !row.used);
    if (selection) selection.used = true;
    const lines = pricedLines(data, data.cart);
    const attempt = {
      id: attemptId,
      at: ctx.virtual_now,
      order_id: orderId,
      payment_method_id: method.id,
      brand: method.brand,
      last_four: method.last_four,
      kind: method.kind,
      subtotal_cents: goods,
      delivery_cents: data.delivery_cents,
      total_cents: total,
      lines,
      outcome: 'pending',
      authorization_key: null,
      decline_code: null,
      abandoned: false
    };
    if (method.kind === 'keelcard') {
      const authorization_key = 'freshcart:' + data.account_id + ':' + orderId + ':' + prior;
      attempt.outcome = 'awaiting_authorization';
      attempt.authorization_key = authorization_key;
      attempt.authorization_request = {
        event_id: 'fcauth-' + attemptId,
        authorization_key,
        amount_cents: total,
        currency: 'USD',
        card: { card_id: method.card_id },
        merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' },
        merchant_ref: { app_id: 'freshcart', account_id: data.account_id, object_type: 'order', object_id: orderId }
      };
    } else {
      attempt.outcome = 'approved';
      data.orders.push({
        id: orderId,
        status: 'confirmed',
        lines,
        confirmed_lines: copy(lines),
        payment_method_id: method.id,
        card_id: null,
        subtotal_cents: goods,
        delivery_cents: data.delivery_cents,
        confirmed_total_cents: total,
        total_cents: total,
        confirmed_at: ctx.virtual_now,
        slot: 'saturday-08-10',
        delivery_date: '2026-11-21',
        authorization_key: null,
        adjustments: []
      });
    }
    data.checkout_attempts.push(attempt);
    return { data, result: {
      attempt_id: attemptId,
      order_id: orderId,
      total_cents: total,
      outcome: attempt.outcome,
      authorization_key: attempt.authorization_key,
      payment_method_id: method.id
    } };
  }
  if (name === 'freshcart.substitutions.respond') {
    const sub = data.substitutions.find(row => row.id === args.substitution_id);
    if (!sub || sub.status !== 'open') fail('invalid_state', 'That substitution is not open.');
    const offer = sub.offers.find(row => row.id === args.offer_id);
    if (!offer) fail('not_found', 'That offer is not on the substitution.');
    const order = data.orders.find(row => row.id === sub.order_id && row.status === 'confirmed');
    if (!order) fail('invalid_state', 'The order for this substitution is not confirmed.');
    sub.chosen_offer_id = offer.id;
    sub.delta_cents = offer.delta_cents;
    if (offer.delta_cents === 0) {
      sub.status = 'accepted';
      replaceLine(order, sub.unavailable_item_id, offer);
      return { data, result: { substitution_id: sub.id, substitution_status: sub.status, delta_cents: 0, outcome: 'accepted' } };
    }
    const prior = data.checkout_attempts.filter(row => row.order_id === order.id).length + 1;
    const attemptId = nextId(data, 'att');
    const authorization_key = 'freshcart:' + data.account_id + ':' + order.id + ':' + prior;
    sub.status = 'awaiting_authorization';
    sub.attempt_id = attemptId;
    data.checkout_attempts.push({
      id: attemptId,
      at: ctx.virtual_now,
      order_id: order.id,
      payment_method_id: order.payment_method_id,
      brand: 'keelcard',
      last_four: '4417',
      kind: 'keelcard',
      subtotal_cents: offer.delta_cents,
      delivery_cents: 0,
      total_cents: offer.delta_cents,
      lines: [],
      outcome: 'awaiting_authorization',
      authorization_key,
      decline_code: null,
      abandoned: false,
      adjustment: true,
      substitution_id: sub.id,
      authorization_request: {
        event_id: 'fcauth-' + attemptId,
        authorization_key,
        amount_cents: offer.delta_cents,
        currency: 'USD',
        card: { card_id: order.card_id },
        merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' },
        merchant_ref: { app_id: 'freshcart', account_id: data.account_id, object_type: 'order', object_id: order.id }
      }
    });
    return { data, result: { substitution_id: sub.id, substitution_status: sub.status, delta_cents: offer.delta_cents, outcome: 'awaiting_authorization', attempt_id: attemptId, authorization_key } };
  }
  fail('unknown_tool', 'Unknown business operation.');
}

function replaceLine(order, itemId, offer) {
  const line = order.lines.find(row => row.item_id === itemId);
  if (!line) return;
  const previous = line.line_cents;
  line.item_id = offer.item_id;
  line.name = offer.label;
  line.unit_cents = line.unit_cents + Math.round(offer.delta_cents / line.qty);
  line.line_cents = previous + offer.delta_cents;
  order.subtotal_cents += offer.delta_cents;
  order.total_cents += offer.delta_cents;
}

module.exports = { handleTool };
