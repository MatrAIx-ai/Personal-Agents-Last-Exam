'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placed, ev, order, kinds } = require('./flows.cjs');

const previewCancel = f => f.call('plateway.orders.cancel.preview', { order_id: f.orderId });
const confirm = (f, token) => f.call('plateway.orders.cancel.confirm', { order_id: f.orderId, token });
const cancel = f => confirm(f, previewCancel(f).token);

test('T10 cancelling a scheduled or submitted order refunds in full', () => {
  const s = placed({ when: { mode: 'scheduled', delivery_at: '2026-12-04T13:00:00-05:00' } });
  const p = previewCancel(s);
  assert.deepEqual([p.status, p.stage, p.refund_cents, p.kept_cents], ['ok', 'scheduled', 1957, 0]);
  assert.equal(cancel(s).status, 'committed');
  assert.deepEqual([order(s).status, order(s).cancellation.reason, order(s).refunded_cents], ['cancelled', 'account_holder', 1957]);
  const f = placed();
  assert.equal(cancel(f).status, 'committed');
  assert.deepEqual(kinds(f), ['notice.order_placed', 'notice.order_cancelled']);
});

test('T10 cancelling while preparing refunds only the delivery fee and tip as charged', () => {
  const f = placed();
  f.event(ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-1' }));
  const p = previewCancel(f);
  assert.deepEqual([p.stage, p.refund_cents, p.kept_cents], ['preparing', 499, 1458]);
  assert.equal(confirm(f, p.token).status, 'committed');
  const o = order(f);
  assert.deepEqual([o.status, o.refunded_cents, o.cancellation.kept_cents], ['cancelled', 499, 1458]);
});

test('T10 after a line refund, a preparing cancellation keeps charge - prior refunds - this refund', () => {
  const f = placed({ items: [['mi-1', ['op-1']], ['mi-2', []]] });
  f.event(ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.item_unavailable', '2026-12-04T11:45:00-05:00', { order_id: 'o-1', line_id: 'ol-1' }));
  const charge = order(f).charge.amount_cents;
  const p = previewCancel(f);
  assert.deepEqual([p.prior_refunds_cents, p.refund_cents, p.kept_cents], [656, 499, charge - 656 - 499]);
  confirm(f, p.token);
  const o = order(f);
  assert.equal(o.refunds.reduce((s, r) => s + r.amount_cents, 0) + o.cancellation.kept_cents, charge);
});

test('T10 picked_up, delivered and cancelled orders cannot be cancelled', () => {
  const f = placed();
  f.event(ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.picked_up', '2026-12-04T11:50:00-05:00', { order_id: 'o-1' }));
  assert.equal(previewCancel(f).status, 'invalid_state');
  f.event(ev('order.delivered', '2026-12-04T12:00:00-05:00', { order_id: 'o-1' }));
  assert.equal(previewCancel(f).status, 'invalid_state');
  const g = placed();
  cancel(g);
  assert.equal(previewCancel(g).status, 'invalid_state');
  assert.equal(confirm(g, 'a'.repeat(64)).status, 'invalid_state');
  assert.equal(g.call('plateway.orders.cancel.preview', { order_id: 'o-404' }).status, 'not_found');
});
