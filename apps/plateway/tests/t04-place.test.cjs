'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');

const NOW = '2026-12-04T11:30:00-05:00';
function ready(seed = baseSeed()) {
  const f = fixture({ seed, now: NOW });
  f.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1, label: 'For Sam' });
  f.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-2'], quantity: 1 });
  return f;
}
const checkout = (extra = {}) => ({ address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 200, ...extra });
const place = (f, extra = {}) => {
  const p = f.call('plateway.checkout.preview', checkout(extra));
  return f.call('plateway.orders.place', { ...checkout(extra), token: p.token });
};

test('T04 placing with a matching token submits the order, charges the previewed total once and empties the cart', () => {
  const f = ready();
  const out = place(f);
  assert.equal(out.status, 'committed');
  assert.equal(out.order_id, 'o-1');
  const order = f.call('plateway.orders.get', { order_id: 'o-1' }).order;
  assert.deepEqual([order.status, order.charge.amount_cents, order.total_cents, order.refunds.length], ['submitted', 1957, 1957, 0]);
  assert.equal(order.lines[0].label, 'For Sam');
  assert.equal(order.accept_by, '2026-12-04T11:50:00-05:00');
  assert.equal(order.estimated_delivery_at, '2026-12-04T12:05:00-05:00');
  assert.deepEqual(f.call('plateway.cart.get', {}).lines, []);
  assert.deepEqual(f.call('plateway.orders.list', {}).orders.map(o => o.id), ['o-1']);
  const notices = f.data().notices;
  assert.deepEqual(notices.map(n => [n.kind, n.order_id]), [['notice.order_placed', 'o-1']]);
  assert.match(notices[0].body, /For Sam/);
  assert.match(notices[0].body, /\$19\.57/);
});

test('T04 a scheduled order is placed as scheduled with its release time', () => {
  const f = ready();
  const out = place(f, { when: { mode: 'scheduled', delivery_at: '2026-12-04T13:00:00-05:00' } });
  const order = f.call('plateway.orders.get', { order_id: out.order_id }).order;
  assert.deepEqual([order.status, order.release_at, order.delivery_at, order.accept_by], ['scheduled', '2026-12-04T12:25:00-05:00', '2026-12-04T13:00:00-05:00', null]);
});

test('T04 a declining card previews, then placement fails with payment_failed, no order, cart kept', () => {
  const f = ready();
  const p = f.call('plateway.checkout.preview', checkout({ card_id: 'c-2' }));
  assert.equal(p.status, 'ok');
  assert.equal(f.call('plateway.orders.place', { ...checkout({ card_id: 'c-2' }), token: p.token }).status, 'payment_failed');
  assert.deepEqual(f.data().orders, []);
  assert.equal(f.call('plateway.cart.get', {}).lines.length, 2);
});

test('T04 a price change between preview and placement returns stale_preview; an availability change returns item_unavailable', () => {
  const f = ready();
  const p = f.call('plateway.checkout.preview', checkout());
  f.event({ event_id: 'ev-p', at: '2026-12-04T11:31:00-05:00', operation: 'menu_item.price_changed', payload: { item_id: 'mi-1', price_cents: 650 } });
  assert.equal(f.call('plateway.orders.place', { ...checkout(), token: p.token }).status, 'stale_preview');
  assert.deepEqual(f.data().orders, []);
  assert.ok(f.call('plateway.cart.get', {}).lines.length > 0);
  const g = ready();
  const q = g.call('plateway.checkout.preview', checkout());
  g.event({ event_id: 'ev-u', at: '2026-12-04T11:31:00-05:00', operation: 'menu_item.availability_changed', payload: { item_id: 'mi-1', available: false } });
  assert.equal(g.call('plateway.orders.place', { ...checkout(), token: q.token }).status, 'item_unavailable');
  assert.equal(g.call('plateway.orders.place', { ...checkout(), token: 'f'.repeat(64) }).status, 'item_unavailable');
});

test('T04 a token for other arguments is stale', () => {
  const f = ready();
  const p = f.call('plateway.checkout.preview', checkout());
  assert.equal(f.call('plateway.orders.place', { ...checkout({ tip_cents: 500 }), token: p.token }).status, 'stale_preview');
});

test('T04 the next order after seeded o-21 is o-22; list is newest first with filters', () => {
  const seed = baseSeed(); seed.orders.push(deliveredOrder());
  const f = ready(seed);
  assert.equal(place(f).order_id, 'o-22');
  assert.deepEqual(f.call('plateway.orders.list', {}).orders.map(o => o.id), ['o-22', 'o-21']);
  assert.deepEqual(f.call('plateway.orders.list', { status: 'delivered' }).orders.map(o => o.id), ['o-21']);
  assert.deepEqual(f.call('plateway.orders.list', { from: '2026-12-04T00:00:00-05:00' }).orders.map(o => o.id), ['o-22']);
  assert.deepEqual(f.call('plateway.orders.list', { restaurant_id: 'r-2' }).orders, []);
  assert.equal(f.call('plateway.orders.get', { order_id: 'o-404' }).status, 'not_found');
});
