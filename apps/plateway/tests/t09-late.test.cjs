'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placed, ev, order, stored } = require('./flows.cjs');

test('T09 acceptance of a cancelled order commits and leaves it cancelled', () => {
  const f = placed();
  f.event(ev('order.rejected', '2026-12-04T11:35:00-05:00', { order_id: 'o-1' }));
  assert.equal(f.event(ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-1' })).status, 'committed');
  assert.equal(order(f).status, 'cancelled');
});

test('T09 timers due by a late event are applied before it', () => {
  const f = placed();
  f.event(ev('order.accepted', '2026-12-04T11:55:00-05:00', { order_id: 'o-1' }));
  const o = stored(f);
  assert.deepEqual([o.status, o.cancellation.reason, o.cancellation.at], ['cancelled', 'not_accepted', '2026-12-04T11:50:00-05:00']);
});

test('T09 events naming an unknown order, restaurant, dish or line are invalid_event and change nothing', () => {
  const f = placed();
  const before = JSON.stringify(f.data());
  for (const e of [
    ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-404' }),
    ev('restaurant.status_changed', '2026-12-04T11:40:00-05:00', { restaurant_id: 'r-404', status: 'paused' }),
    ev('menu_item.price_changed', '2026-12-04T11:40:00-05:00', { item_id: 'mi-404', price_cents: 1 }),
    ev('order.item_unavailable', '2026-12-04T11:40:00-05:00', { order_id: 'o-1', line_id: 'ol-404' }),
  ]) assert.equal(f.event(e).status, 'invalid_event', e.operation);
  assert.equal(JSON.stringify(f.data()), before);
});

test('T09 catalog events change search, cart and later previews but not placed orders', () => {
  const f = placed();
  f.event(ev('menu_item.price_changed', '2026-12-04T11:40:00-05:00', { item_id: 'mi-1', price_cents: 999 }));
  f.event(ev('restaurant.status_changed', '2026-12-04T11:41:00-05:00', { restaurant_id: 'r-1', status: 'paused' }));
  const o = order(f);
  assert.deepEqual([o.lines[0].unit_price_cents, o.status, o.total_cents], [607, 'submitted', 1957]);
  assert.equal(f.call('plateway.menu_items.get', { item_id: 'mi-1' }).item.price_cents, 999);
  assert.equal(f.call('plateway.restaurants.search', { address_id: 'a-1' }).restaurants[0].status, 'paused');
});
