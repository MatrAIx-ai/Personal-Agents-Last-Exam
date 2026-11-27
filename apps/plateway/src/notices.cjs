'use strict';
const { nextId, textLength } = require('./util.cjs');
const { ms, localParts } = require('./time.cjs');
const TITLE_LIMIT = 200;
const BODY_LIMIT = 20000;
const TITLES = {
  'notice.order_placed': 'Order placed', 'notice.order_accepted': 'Order accepted', 'notice.order_delayed': 'Order delayed',
  'notice.order_delivered': 'Order delivered', 'notice.item_refunded': 'Item refunded', 'notice.order_cancelled': 'Order cancelled',
};
const money = cents => '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
const clock = (data, iso) => { const m = localParts(ms(iso), data.time_zone).minutes; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const day = (data, iso) => new Intl.DateTimeFormat('en-US', { timeZone: data.time_zone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(ms(iso)));
const restaurantName = (data, order) => (data.restaurants.find(r => r.id === order.restaurant_id) || { name: order.restaurant_id }).name;

function receipt(order) {
  const lines = order.lines.map(l => l.quantity + ' × ' + l.name + (l.options.length ? ' (' + l.options.map(o => o.name).join(', ') + ')' : '') +
    (l.label ? ' — ' + l.label : '') + ' ' + money(l.subtotal_cents) + (l.removed ? ' [removed]' : ''));
  const fees = ['Subtotal ' + money(order.subtotal_cents), 'Delivery fee ' + money(order.fees.delivery_cents), 'Service fee ' + money(order.fees.service_cents)];
  if (order.fees.small_order_cents) fees.push('Small-order fee ' + money(order.fees.small_order_cents));
  fees.push('Tax ' + money(order.tax_cents), 'Tip ' + money(order.tip_cents), 'Total charged ' + money(order.total_cents));
  return ['Receipt', ...lines, ...fees].join('\n');
}

function body(data, kind, order, at, extra) {
  const from = 'Order ' + order.id + ' from ' + restaurantName(data, order);
  if (kind === 'notice.order_placed') {
    const when = order.mode === 'asap' ? 'as soon as possible (estimated ' + clock(data, order.estimated_delivery_at) + ')' : 'on ' + day(data, order.delivery_at) + ' at ' + clock(data, order.delivery_at);
    const head = from + ' was placed at ' + clock(data, at) + ' for delivery ' + when + '.';
    const full = head + '\n\n' + receipt(order);
    return full.length <= BODY_LIMIT && textLength(full) <= BODY_LIMIT ? full : head + ' Total charged: ' + money(order.total_cents) + '. The itemized receipt is available through plateway.orders.get.';
  }
  if (kind === 'notice.order_accepted') return from + ' was accepted at ' + clock(data, at) + '. Estimated delivery: ' + clock(data, order.estimated_delivery_at) + '.';
  if (kind === 'notice.order_delayed') return from + ' is delayed. New estimated delivery: ' + clock(data, order.estimated_delivery_at) + '.';
  if (kind === 'notice.order_delivered') return from + ' was delivered at ' + clock(data, at) + '. Total charged: ' + money(order.total_cents) + '.';
  if (kind === 'notice.item_refunded') return extra.amount_cents ? from + ': ' + extra.line_name + ' was refunded ' + money(extra.amount_cents) + ' to the card on file.' : from + ': ' + extra.line_name + ' was ' + extra.action + '; no refund was due.';
  return from + ' was cancelled. Refunded ' + money(extra.amount_cents) + ' to the card on file; kept ' + money(extra.kept_cents) + '.';
}

function appendNotice(data, kind, order, at, extra = {}) {
  const zero = kind === 'notice.item_refunded' && extra.amount_cents === 0;
  const title = zero ? (extra.action === 'removed' ? 'Item removed' : 'Item reported') : TITLES[kind];
  const notice = { id: nextId(data, 'n'), kind, order_id: order.id, line_id: extra.line_id ?? null, at, title, body: body(data, kind, order, at, extra) };
  data.notices.push(notice);
  return notice;
}
module.exports = { appendNotice, money, TITLE_LIMIT, BODY_LIMIT };
