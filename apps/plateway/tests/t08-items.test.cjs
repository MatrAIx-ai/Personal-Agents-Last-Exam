'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placed, ev, order, kinds } = require('./flows.cjs');

const twoDishes = () => placed({ items: [['mi-1', ['op-1']], ['mi-2', []]] });
const unavailable = (f, at, line_id) => f.event(ev('order.item_unavailable', at, { order_id: f.orderId, line_id }));

test('T08 a line lost on a submitted or preparing order is removed and refunded its subtotal and tax; fees and tip stay', () => {
  const f = twoDishes();
  unavailable(f, '2026-12-04T11:35:00-05:00', 'ol-1');
  let o = order(f);
  assert.equal(o.status, 'submitted');
  assert.deepEqual(o.refunds.map(r => [r.amount_cents, r.reason, r.line_id]), [[656, 'line_unavailable', 'ol-1']]);
  assert.deepEqual(kinds(f), ['notice.order_placed', 'notice.item_refunded']);
  const g = twoDishes();
  g.event(ev('order.accepted', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  unavailable(g, '2026-12-04T11:40:00-05:00', 'ol-2');
  o = order(g);
  assert.deepEqual([o.status, o.refunded_cents], ['preparing', 1350]);
});

test('T08 losing the last remaining line cancels with a full refund of what remains', () => {
  const f = twoDishes();
  const charge = order(f).charge.amount_cents;
  unavailable(f, '2026-12-04T11:35:00-05:00', 'ol-1');
  unavailable(f, '2026-12-04T11:36:00-05:00', 'ol-2');
  const o = order(f);
  assert.deepEqual([o.status, o.cancellation.reason, o.refunded_cents, o.cancellation.kept_cents], ['cancelled', 'last_line_unavailable', charge, 0]);
  assert.equal(o.cancellation.refunded_cents, charge - 656);
});

test('T08 the event repeated for a removed line commits with no second refund', () => {
  const f = twoDishes();
  unavailable(f, '2026-12-04T11:35:00-05:00', 'ol-1');
  assert.equal(unavailable(f, '2026-12-04T11:36:00-05:00', 'ol-1').status, 'committed');
  assert.equal(order(f).refunds.length, 1);
});

test('T08 mixed refunds never exceed the charge and kept = charge - refunds', () => {
  const f = placed({ items: [['mi-1', ['op-1']], ['mi-1', ['op-2']], ['mi-2', []]], when: { mode: 'scheduled', delivery_at: '2026-12-04T13:00:00-05:00' } });
  f.event(ev('menu_item.availability_changed', '2026-12-04T12:10:00-05:00', { item_id: 'mi-2', available: false }));
  f.event(ev('order.accepted', '2026-12-04T12:30:00-05:00', { order_id: 'o-1' }));
  unavailable(f, '2026-12-04T12:35:00-05:00', 'ol-1');
  f.event(ev('order.rejected', '2026-12-04T12:36:00-05:00', { order_id: 'o-1' }));
  let o = order(f);
  assert.equal(o.status, 'preparing');
  unavailable(f, '2026-12-04T12:40:00-05:00', 'ol-2');
  o = order(f);
  const total = o.refunds.reduce((s, r) => s + r.amount_cents, 0);
  assert.equal(o.status, 'cancelled');
  assert.equal(total, o.charge.amount_cents);
  assert.equal(o.cancellation.kept_cents, o.charge.amount_cents - total);
});
