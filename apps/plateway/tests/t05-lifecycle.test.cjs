'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placed, ev, order, kinds } = require('./flows.cjs');

test('T05 accepted → delayed → picked_up → delivered, with one notice for each except pickup', () => {
  const f = placed();
  assert.equal(f.event(ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-1' })).status, 'committed');
  assert.equal(order(f).status, 'preparing');
  f.event(ev('order.delayed', '2026-12-04T12:00:00-05:00', { order_id: 'o-1', estimated_delivery: '2026-12-04T12:20:00-05:00' }));
  assert.equal(order(f).estimated_delivery_at, '2026-12-04T12:20:00-05:00');
  f.event(ev('order.picked_up', '2026-12-04T12:05:00-05:00', { order_id: 'o-1' }));
  assert.equal(order(f).status, 'picked_up');
  f.event(ev('order.delivered', '2026-12-04T12:18:00-05:00', { order_id: 'o-1' }));
  assert.deepEqual([order(f).status, order(f).delivered_at], ['delivered', '2026-12-04T12:18:00-05:00']);
  assert.deepEqual(kinds(f), ['notice.order_placed', 'notice.order_accepted', 'notice.order_delayed', 'notice.order_delivered']);
  f.event(ev('order.delivered', '2026-12-04T12:19:00-05:00', { order_id: 'o-1' }));
  assert.equal(kinds(f).length, 4);
});

test('T05 status events in the wrong state commit and change nothing', () => {
  const f = placed();
  assert.equal(f.event(ev('order.picked_up', '2026-12-04T11:35:00-05:00', { order_id: 'o-1' })).status, 'committed');
  assert.equal(order(f).status, 'submitted');
  f.event(ev('order.delivered', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  assert.equal(order(f).status, 'submitted');
  assert.deepEqual(kinds(f), ['notice.order_placed']);
});
