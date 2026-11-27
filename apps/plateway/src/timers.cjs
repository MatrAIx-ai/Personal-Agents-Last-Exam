'use strict';
const { ms, isOpen, toIso, MINUTE } = require('./time.cjs');
const { cancelFull, removeLine, ACCEPT_LIMIT_MINUTES } = require('./orders.cjs');

const orderNumber = id => Number(id.replace(/^\D+-/, '')) || 0;
function dueTimers(data, now) {
  const limit = ms(now), due = [];
  for (const order of data.orders) {
    if (order.status === 'scheduled' && ms(order.release_at) <= limit) due.push({ kind: 'release', order, at: order.release_at });
    if (order.status === 'submitted' && order.accept_by && ms(order.accept_by) <= limit) due.push({ kind: 'accept_limit', order, at: order.accept_by });
  }
  return due.sort((a, b) => ms(a.at) - ms(b.at) || orderNumber(a.order.id) - orderNumber(b.order.id) || (a.order.id < b.order.id ? -1 : a.order.id > b.order.id ? 1 : 0));
}

function release(data, order, at) {
  const restaurant = data.restaurants.find(r => r.id === order.restaurant_id);
  if (restaurant.paused || !isOpen(restaurant, ms(at), data.time_zone)) return cancelFull(data, order, at, 'closed_at_release');
  const dishes = new Map(data.dishes.map(d => [d.id, d]));
  const live = order.lines.filter(l => !l.removed);
  const unavailable = live.filter(l => !dishes.get(l.item_id).available);
  if (unavailable.length === live.length) return cancelFull(data, order, at, 'unavailable_at_release');
  for (const line of unavailable) removeLine(data, order, line, at, 'release');
  order.status = 'submitted';
  order.submitted_at = at;
  order.accept_by = toIso(ms(at) + ACCEPT_LIMIT_MINUTES * MINUTE, data.time_zone);
  order.timeline.push({ at, status: 'submitted', note: 'Released to the restaurant' });
}

function applyDueTimers(data, now) {
  const applied = [];
  for (let next = dueTimers(data, now)[0]; next; next = dueTimers(data, now)[0]) {
    if (next.kind === 'release') release(data, next.order, next.at);
    else cancelFull(data, next.order, next.at, 'not_accepted');
    applied.push({ kind: next.kind, order_id: next.order.id, at: next.at });
  }
  return applied;
}
module.exports = { dueTimers, applyDueTimers };
