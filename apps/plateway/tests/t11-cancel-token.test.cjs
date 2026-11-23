'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placed, ev, order } = require('./flows.cjs');

test('T11 a cancel token from the submitted stage is stale after acceptance', () => {
  const f = placed();
  const p = f.call('plateway.orders.cancel.preview', { order_id: 'o-1' });
  f.event(ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-1' }));
  assert.equal(f.call('plateway.orders.cancel.confirm', { order_id: 'o-1', token: p.token }).status, 'stale_preview');
  assert.equal(order(f).status, 'preparing');
});

test('T11 a cancel token is stale after a line refund changes the amounts', () => {
  const f = placed({ items: [['mi-1', ['op-1']], ['mi-2', []]] });
  f.event(ev('order.accepted', '2026-12-04T11:40:00-05:00', { order_id: 'o-1' }));
  const p = f.call('plateway.orders.cancel.preview', { order_id: 'o-1' });
  f.event(ev('order.item_unavailable', '2026-12-04T11:45:00-05:00', { order_id: 'o-1', line_id: 'ol-1' }));
  assert.equal(f.call('plateway.orders.cancel.confirm', { order_id: 'o-1', token: p.token }).status, 'stale_preview');
});
