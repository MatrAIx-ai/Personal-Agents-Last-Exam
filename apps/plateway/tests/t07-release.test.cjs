'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placed, ev, order, stored, kinds } = require('./flows.cjs');
const { baseSeed } = require('./seeds.cjs');

const scheduled = (opts = {}) => placed({ when: { mode: 'scheduled', delivery_at: '2026-12-04T13:00:00-05:00' }, ...opts });
const tick = (f, at) => f.event(ev('menu_item.price_changed', at, { item_id: 'mi-3', price_cents: 1100 }));

test('T07 a scheduled order is released at its release time to an open restaurant', () => {
  const f = scheduled();
  tick(f, '2026-12-04T12:25:00-05:00');
  const o = order(f);
  assert.deepEqual([o.status, o.submitted_at, o.accept_by], ['submitted', '2026-12-04T12:25:00-05:00', '2026-12-04T12:45:00-05:00']);
});

test('T07 reads after the release time show the release without storing it', () => {
  const f = scheduled();
  f.setNow('2026-12-04T12:26:00-05:00');
  assert.equal(order(f).status, 'submitted');
  assert.equal(f.call('plateway.orders.list', {}).orders[0].status, 'submitted');
  assert.equal(stored(f).status, 'scheduled');
});

test('T07 a paused restaurant at release cancels with a full refund', () => {
  const f = scheduled();
  f.event(ev('restaurant.status_changed', '2026-12-04T12:00:00-05:00', { restaurant_id: 'r-1', status: 'paused' }));
  tick(f, '2026-12-04T12:30:00-05:00');
  const o = order(f);
  assert.deepEqual([o.status, o.cancellation.reason, o.refunded_cents, o.cancellation.at], ['cancelled', 'closed_at_release', 1957, '2026-12-04T12:25:00-05:00']);
});

test('T07 a closed restaurant at release cancels with a full refund', () => {
  const seed = baseSeed();
  seed.restaurants[0].hours.fri = [['11:00', '12:00']];
  const f = scheduled({ seed, when: { mode: 'scheduled', delivery_at: '2026-12-04T12:30:00-05:00' } });
  assert.equal(stored(f).release_at, '2026-12-04T11:55:00-05:00');
  f.event(ev('restaurant.status_changed', '2026-12-04T11:58:00-05:00', { restaurant_id: 'r-1', status: 'open' }));
  assert.equal(order(f).status, 'submitted');
  const g = scheduled({ seed, when: { mode: 'scheduled', delivery_at: '2026-12-04T12:30:00-05:00' } });
  const data = g.data(); data.restaurants[0].hours.fri = [['11:00', '11:50']];
  const h = require('./harness.cjs').fixture({ seed: data, now: '2026-12-04T11:31:00-05:00' });
  h.orderId = 'o-1';
  tick(h, '2026-12-04T11:56:00-05:00');
  assert.deepEqual([order(h).status, order(h).cancellation.reason], ['cancelled', 'closed_at_release']);
});

test('T07 an unavailable line at release is removed and refunded; all lines unavailable cancels', () => {
  const f = scheduled({ items: [['mi-1', ['op-1']], ['mi-2', []]] });
  f.event(ev('menu_item.availability_changed', '2026-12-04T12:10:00-05:00', { item_id: 'mi-1', available: false }));
  tick(f, '2026-12-04T12:25:00-05:00');
  const o = order(f);
  assert.equal(o.status, 'submitted');
  assert.deepEqual(o.lines.map(l => [l.id, l.removed, l.removed_reason]), [['ol-1', true, 'release'], ['ol-2', false, null]]);
  assert.deepEqual(o.refunds.map(r => [r.amount_cents, r.reason, r.line_id]), [[656, 'line_removed_at_release', 'ol-1']]);
  assert.deepEqual(kinds(f), ['notice.order_placed', 'notice.item_refunded']);
  const g = scheduled();
  g.event(ev('menu_item.availability_changed', '2026-12-04T12:10:00-05:00', { item_id: 'mi-1', available: false }));
  tick(g, '2026-12-04T12:25:00-05:00');
  assert.deepEqual([order(g).status, order(g).cancellation.reason, order(g).refunded_cents], ['cancelled', 'unavailable_at_release', 1957]);
});

test('T07 one event after both the release and its 20-minute limit cancels once with one refund equal to the charge', () => {
  const f = scheduled();
  tick(f, '2026-12-04T12:50:00-05:00');
  const o = stored(f);
  assert.deepEqual([o.status, o.cancellation.reason, o.cancellation.at, o.refunds.length, o.refunds[0].amount_cents],
    ['cancelled', 'not_accepted', '2026-12-04T12:45:00-05:00', 1, 1957]);
  assert.deepEqual(kinds(f), ['notice.order_placed', 'notice.order_cancelled']);
});
