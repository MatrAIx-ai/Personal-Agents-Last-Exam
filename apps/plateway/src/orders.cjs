'use strict';
const { fail, clone, nextId } = require('./util.cjs');
const { ms, toIso, MINUTE } = require('./time.cjs');
const { checkoutChanges, tokenArgs } = require('./checkout.cjs');
const { token } = require('./tokens.cjs');
const { appendNotice } = require('./notices.cjs');
const ACCEPT_LIMIT_MINUTES = 20;

const orderOf = (data, id) => data.orders.find(o => o.id === id) || fail('not_found', 'Order ' + id + ' does not exist.');
const refunded = order => order.refunds.reduce((s, r) => s + r.amount_cents, 0);
const restaurantName = (data, order) => (data.restaurants.find(r => r.id === order.restaurant_id) || { name: order.restaurant_id }).name;

const VIEW_FIELDS = ['id', 'restaurant_id', 'address_id', 'card_id', 'status', 'mode', 'placed_at', 'delivery_at', 'release_at', 'submitted_at',
  'accept_by', 'estimated_delivery_at', 'delivered_at', 'lines', 'fees', 'subtotal_cents', 'tax_cents', 'tip_cents', 'total_cents', 'charge',
  'refunds', 'timeline', 'cancellation', 'rating'];
function view(data, order) {
  const picked = Object.fromEntries(VIEW_FIELDS.map(k => [k, clone(order[k])]));
  return { ...picked, restaurant_name: restaurantName(data, order), refunded_cents: refunded(order) };
}
function summary(data, order) {
  return { id: order.id, restaurant_id: order.restaurant_id, restaurant_name: restaurantName(data, order), status: order.status,
    placed_at: order.placed_at, delivery_at: order.delivery_at, estimated_delivery_at: order.estimated_delivery_at, delivered_at: order.delivered_at,
    total_cents: order.total_cents, refunded_cents: refunded(order), line_count: order.lines.filter(l => !l.removed).length, rated: order.rating !== null };
}

function place(ctx, data, args) {
  const c = checkoutChanges(ctx, data, args);
  if (token(ctx, data, 'checkout', tokenArgs(data, args), c.changes) !== args.token) fail('stale_preview', 'The order changed since the preview; preview again.');
  if (c.card.behavior === 'decline') fail('payment_failed', 'The card was declined.');
  const now = ctx.virtual_now, zone = data.time_zone;
  const asap = c.plan.mode === 'asap';
  const order = {
    id: nextId(data, 'o'), restaurant_id: c.restaurant.id, address_id: c.address.id, card_id: c.card.id,
    status: asap ? 'submitted' : 'scheduled', mode: c.plan.mode, placed_at: now,
    delivery_at: c.plan.delivery_at, release_at: c.plan.release_at,
    submitted_at: asap ? now : null, accept_by: asap ? toIso(ms(now) + ACCEPT_LIMIT_MINUTES * MINUTE, zone) : null,
    estimated_delivery_at: c.plan.estimated_delivery_at, delivered_at: null,
    lines: c.lines.map(l => ({ ...l, removed: false, removed_reason: null, removed_at: null, report: null })),
    fees: { delivery_cents: c.totals.delivery_cents, service_cents: c.totals.service_cents, small_order_cents: c.totals.small_order_cents },
    subtotal_cents: c.totals.subtotal_cents, tax_cents: c.totals.tax_cents, tip_cents: c.totals.tip_cents, total_cents: c.totals.total_cents,
    charge: { card_id: c.card.id, amount_cents: c.totals.total_cents, at: now },
    refunds: [], timeline: [{ at: now, status: asap ? 'submitted' : 'scheduled', note: 'Order placed' }],
    cancellation: null, rating: null,
  };
  data.orders.push(order);
  data.cart = { restaurant_id: null, lines: [] };
  appendNotice(data, 'notice.order_placed', order, now);
  return { order_id: order.id, order: view(data, order) };
}

function list(ctx, data, args) {
  if (args.restaurant_id && !data.restaurants.some(r => r.id === args.restaurant_id)) fail('not_found', 'Restaurant ' + args.restaurant_id + ' does not exist.');
  const inRange = o => (!args.from || ms(o.placed_at) >= ms(args.from)) && (!args.to || ms(o.placed_at) <= ms(args.to));
  const orders = data.orders
    .filter(o => (!args.status || o.status === args.status) && (!args.restaurant_id || o.restaurant_id === args.restaurant_id) && inRange(o))
    .sort((a, b) => ms(b.placed_at) - ms(a.placed_at) || Number(b.id.slice(2)) - Number(a.id.slice(2)))
    .map(o => summary(data, o));
  return { orders };
}
const get = (ctx, data, args) => ({ order: view(data, orderOf(data, args.order_id)) });
function addRefund(data, order, amount, reason, lineId, at) {
  if (amount <= 0) return null;
  const refund = { id: nextId(data, 'rf'), amount_cents: amount, reason, line_id: lineId, at };
  order.refunds.push(refund);
  return refund;
}
function cancelOrder(data, order, at, reason, amount) {
  const stage = order.status;
  addRefund(data, order, amount, 'cancelled', null, at);
  order.status = 'cancelled';
  order.cancellation = { at, reason, stage, refunded_cents: amount, kept_cents: order.charge.amount_cents - refunded(order) };
  order.timeline.push({ at, status: 'cancelled', note: 'Cancelled: ' + reason });
  appendNotice(data, 'notice.order_cancelled', order, at, { amount_cents: amount, kept_cents: order.cancellation.kept_cents });
}
function cancelFull(data, order, at, reason) {
  cancelOrder(data, order, at, reason, order.charge.amount_cents - refunded(order));
}
const CANCELLABLE = ['scheduled', 'submitted', 'preparing'];
function cancelChanges(data, orderId) {
  const order = orderOf(data, orderId);
  if (!CANCELLABLE.includes(order.status)) fail('invalid_state', 'A ' + order.status + ' order cannot be cancelled.');
  const prior = refunded(order), remaining = order.charge.amount_cents - prior;
  const refund = order.status === 'preparing' ? Math.min(order.fees.delivery_cents + order.tip_cents, remaining) : remaining;
  return { order, changes: { order_id: order.id, charge_cents: order.charge.amount_cents, stage: order.status, prior_refunds_cents: prior,
    refund_cents: refund, kept_cents: remaining - refund, refund_card_id: order.charge.card_id } };
}
function historyEnd(order) {
  const times = [order.placed_at, order.submitted_at, order.charge.at, order.delivered_at, order.cancellation && order.cancellation.at, order.rating && order.rating.at,
    ...order.timeline.map(t => t.at), ...order.refunds.map(r => r.at), ...order.lines.flatMap(l => [l.removed_at, l.report && l.report.at])].filter(Boolean);
  return Math.max(...times.map(ms));
}
function notBeforeHistory(order, now, code = 'invalid_state') {
  if (ms(now) < historyEnd(order)) fail(code, 'Order ' + order.id + ' has recorded history after this time.');
}
function cancelPreview(ctx, data, args) {
  notBeforeHistory(orderOf(data, args.order_id), ctx.virtual_now);
  const { changes } = cancelChanges(data, args.order_id);
  return { order_id: changes.order_id, stage: changes.stage, charge_cents: changes.charge_cents, prior_refunds_cents: changes.prior_refunds_cents,
    refund_cents: changes.refund_cents, kept_cents: changes.kept_cents, refund_card_id: changes.refund_card_id,
    token: token(ctx, data, 'cancel', args, changes) };
}
function cancelConfirm(ctx, data, args) {
  notBeforeHistory(orderOf(data, args.order_id), ctx.virtual_now);
  const { order, changes } = cancelChanges(data, args.order_id);
  if (token(ctx, data, 'cancel', args, changes) !== args.token) fail('stale_preview', 'The order changed since the preview; preview again.');
  cancelOrder(data, order, ctx.virtual_now, 'account_holder', changes.refund_cents);
  return { order_id: order.id, order: view(data, order) };
}
function removeLine(data, order, line, at, why) {
  line.removed = true;
  line.removed_reason = why === 'release' ? 'release' : 'unavailable';
  line.removed_at = at;
  const amount = Math.min(line.subtotal_cents + line.tax_cents, order.charge.amount_cents - refunded(order));
  addRefund(data, order, amount, why === 'release' ? 'line_removed_at_release' : 'line_unavailable', line.id, at);
  order.timeline.push({ at, status: null, note: 'Line ' + line.id + ' removed' + (amount ? ' and refunded' : '; no refund due') });
  appendNotice(data, 'notice.item_refunded', order, at, { line_id: line.id, line_name: line.name, amount_cents: amount, action: 'removed' });
}
module.exports = { place, list, get, orderOf, refunded, view, addRefund, cancelFull, cancelOrder, removeLine, cancelPreview, cancelConfirm, ACCEPT_LIMIT_MINUTES, notBeforeHistory };
