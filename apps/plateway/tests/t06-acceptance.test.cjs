'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placed, ev, order, stored, kinds } = require('./flows.cjs');

test('T06 order.rejected cancels with a full refund and one notice', () => {
  const f = placed();
  f.event(ev('order.rejected', '2026-12-04T11:35:00-05:00', { order_id: 'o-1', reason: 'Too busy' }));
  const o = order(f);
  assert.deepEqual([o.status, o.cancellation.reason, o.refunded_cents, o.cancellation.kept_cents], ['cancelled', 'rejected', 1957, 0]);
  assert.deepEqual(kinds(f), ['notice.order_placed', 'notice.order_cancelled']);
});

test('T06 no acceptance within 20 minutes cancels with a full refund dated at the limit', () => {
  const f = placed();
  f.setNow('2026-12-04T11:51:00-05:00');
  assert.deepEqual([order(f).status, order(f).cancellation.reason], ['cancelled', 'not_accepted']);
  assert.equal(stored(f).status, 'submitted');
  f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  const o = stored(f);
  assert.deepEqual([o.status, o.cancellation.at, o.refunds.length, o.refunds[0].amount_cents], ['cancelled', '2026-12-04T11:50:00-05:00', 1, 1957]);
  const cancelled = f.data().notices.filter(n => n.kind === 'notice.order_cancelled');
  assert.deepEqual(cancelled.map(n => n.at), ['2026-12-04T11:50:00-05:00']);
});

test('T06 acceptance at 19 minutes is in time; at exactly 20 minutes the limit applies first', () => {
  const early = placed();
  early.event(ev('order.accepted', '2026-12-04T11:49:00-05:00', { order_id: 'o-1' }));
  assert.equal(order(early).status, 'preparing');
  const exact = placed();
  assert.equal(exact.event(ev('order.accepted', '2026-12-04T11:50:00-05:00', { order_id: 'o-1' })).status, 'committed');
  assert.deepEqual([order(exact).status, order(exact).cancellation.reason], ['cancelled', 'not_accepted']);
  assert.deepEqual(kinds(exact), ['notice.order_placed', 'notice.order_cancelled']);
});
