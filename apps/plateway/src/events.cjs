'use strict';
const { fail } = require('./util.cjs');
const { ms, toIso } = require('./time.cjs');
const { applyDueTimers } = require('./timers.cjs');
const { appendNotice } = require('./notices.cjs');
const { cancelFull, removeLine, notBeforeHistory } = require('./orders.cjs');

const known = (list, id, what) => list.find(x => x.id === id) || fail('invalid_event', 'Unknown ' + what + ' ' + id + '.');
function step(order, at, status, note) {
  order.status = status;
  order.timeline.push({ at, status, note });
}
const ORDER_EVENTS = {
  'order.accepted': (data, order, event) => {
    if (order.status !== 'submitted') return;
    step(order, event.at, 'preparing', 'Accepted by the restaurant');
    appendNotice(data, 'notice.order_accepted', order, event.at);
  },
  'order.rejected': (data, order, event) => {
    if (order.status !== 'submitted') return;
    order.timeline.push({ at: event.at, status: null, note: 'Rejected by the restaurant' + (event.payload.reason ? ': ' + event.payload.reason : '') });
    cancelFull(data, order, event.at, 'rejected');
  },
  'order.picked_up': (data, order, event) => {
    if (order.status !== 'preparing') return;
    step(order, event.at, 'picked_up', 'Picked up by the courier');
  },
  'order.delayed': (data, order, event) => {
    if (order.status !== 'preparing' && order.status !== 'picked_up') return;
    order.estimated_delivery_at = toIso(ms(event.payload.estimated_delivery), data.time_zone);
    order.timeline.push({ at: event.at, status: null, note: 'Delayed; new estimate ' + order.estimated_delivery_at });
    appendNotice(data, 'notice.order_delayed', order, event.at);
  },
  'order.item_unavailable': (data, order, event) => {
    if (order.status !== 'submitted' && order.status !== 'preparing') return;
    const line = order.lines.find(l => l.id === event.payload.line_id);
    if (line.removed) return;
    const live = order.lines.filter(l => !l.removed);
    if (live.length === 1) {
      Object.assign(line, { removed: true, removed_reason: 'unavailable', removed_at: event.at });
      cancelFull(data, order, event.at, 'last_line_unavailable');
    }
    else removeLine(data, order, line, event.at, 'unavailable');
  },
  'order.delivered': (data, order, event) => {
    if (order.status !== 'picked_up') return;
    step(order, event.at, 'delivered', 'Delivered');
    order.delivered_at = event.at;
    appendNotice(data, 'notice.order_delivered', order, event.at);
  },
};

function applyEvent(ctx, data, event) {
  const p = event.payload;
  if (event.operation === 'restaurant.status_changed') known(data.restaurants, p.restaurant_id, 'restaurant');
  else if (event.operation.startsWith('menu_item.')) known(data.dishes, p.item_id, 'dish');
  else if (ORDER_EVENTS[event.operation]) {
    const order = known(data.orders, p.order_id, 'order');
    if (event.operation === 'order.item_unavailable') known(order.lines, p.line_id, 'line');
    notBeforeHistory(order, event.at, 'invalid_event');
  }
  else fail('invalid_event', 'Unsupported operation.');
  applyDueTimers(data, event.at);
  if (event.operation === 'restaurant.status_changed') {
    const restaurant = data.restaurants.find(r => r.id === p.restaurant_id);
    restaurant.paused = p.status === 'paused';
    restaurant.pause_reason = restaurant.paused ? p.reason || null : null;
  } else if (event.operation === 'menu_item.availability_changed') {
    data.dishes.find(d => d.id === p.item_id).available = p.available;
  } else if (event.operation === 'menu_item.price_changed') {
    data.dishes.find(d => d.id === p.item_id).price_cents = p.price_cents;
  } else {
    ORDER_EVENTS[event.operation](data, data.orders.find(o => o.id === p.order_id), event);
  }
  return data;
}
module.exports = { applyEvent };
