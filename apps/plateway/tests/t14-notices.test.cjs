'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');
const { placed, ev, order, kinds } = require('./flows.cjs');
const { textLength } = require('../src/util.cjs');
const seedSchema = require('../schemas/seed.schema.json');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const seedValid = compile(seedSchema, path.join(__dirname, '..', 'schemas'));

const withinLimits = f => {
  for (const n of f.data().notices) {
    assert.ok(textLength(n.title) <= 200, n.id + ' title');
    assert.ok(textLength(n.body) <= 20000, n.id + ' body');
  }
};

test('T14 repeated and late events write no second notice; pickup writes none', () => {
  const f = placed();
  f.event(ev('order.accepted', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.accepted', '2026-12-04T11:37:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.delayed', '2026-12-04T11:50:00-05:00', { order_id: 'o-1', estimated_delivery: '2026-12-04T12:30:00-05:00' }));
  f.event(ev('order.picked_up', '2026-12-04T12:00:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.picked_up', '2026-12-04T12:01:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.delivered', '2026-12-04T12:20:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.delivered', '2026-12-04T12:21:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.rejected', '2026-12-04T12:22:00-05:00', { order_id: 'o-1', reason: 'Too busy' }));
  assert.deepEqual(f.data().notices.map(n => [n.id, n.kind, n.at]), [
    ['n-1', 'notice.order_placed', '2026-12-04T11:30:00-05:00'],
    ['n-2', 'notice.order_accepted', '2026-12-04T11:36:00-05:00'],
    ['n-3', 'notice.order_delayed', '2026-12-04T11:50:00-05:00'],
    ['n-4', 'notice.order_delivered', '2026-12-04T12:20:00-05:00'],
  ]);
  assert.ok(f.data().notices.every(n => n.order_id === 'o-1' && n.line_id === null));
  withinLimits(f);
});

test('T14 a refunded line gets one notice; the last line cancels with one cancellation notice carrying its refund', () => {
  const f = placed({ items: [['mi-1', ['op-1']], ['mi-1', ['op-2']], ['mi-2', []]] });
  f.event(ev('order.accepted', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.item_unavailable', '2026-12-04T11:40:00-05:00', { order_id: 'o-1', line_id: 'ol-3' }));
  f.event(ev('order.item_unavailable', '2026-12-04T11:41:00-05:00', { order_id: 'o-1', line_id: 'ol-3' }));
  f.event(ev('order.item_unavailable', '2026-12-04T11:42:00-05:00', { order_id: 'o-1', line_id: 'ol-1' }));
  const before = order(f);
  f.event(ev('order.item_unavailable', '2026-12-04T11:43:00-05:00', { order_id: 'o-1', line_id: 'ol-2' }));
  const o = order(f);
  assert.deepEqual(f.data().notices.map(n => [n.kind, n.line_id]), [
    ['notice.order_placed', null], ['notice.order_accepted', null],
    ['notice.item_refunded', 'ol-3'], ['notice.item_refunded', 'ol-1'], ['notice.order_cancelled', null],
  ]);
  const cancelled = f.data().notices.at(-1);
  const refund = o.refunded_cents - before.refunded_cents;
  assert.match(cancelled.body, new RegExp('Refunded \\$' + Math.floor(refund / 100) + '\\.' + String(refund % 100).padStart(2, '0')));
  assert.equal(o.refunded_cents, o.charge.amount_cents);
  withinLimits(f);
});

test('T14 a timer notice is dated at its due time and written only when a write commits the timer', () => {
  const f = placed();
  f.setNow('2026-12-04T11:55:00-05:00');
  assert.equal(order(f).status, 'cancelled');
  assert.deepEqual(kinds(f), ['notice.order_placed']);
  f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  assert.deepEqual(f.data().notices.map(n => [n.kind, n.at]), [
    ['notice.order_placed', '2026-12-04T11:30:00-05:00'], ['notice.order_cancelled', '2026-12-04T11:50:00-05:00'],
  ]);
  f.event(ev('order.rejected', '2026-12-04T11:56:00-05:00', { order_id: 'o-1', reason: 'Too busy' }));
  assert.equal(kinds(f).length, 2);
});

test('T14 the placed notice carries the itemized receipt', () => {
  const f = placed();
  const body = f.data().notices[0].body;
  for (const text of ['Order o-1 from Basil Row', 'Receipt', 'Pad Thai', 'Subtotal', 'Delivery fee', 'Service fee', 'Tax', 'Tip', 'Total charged ' + '$' + (order(f).total_cents / 100).toFixed(2)]) assert.ok(body.includes(text), text);
  withinLimits(f);
});

test('T14 a receipt over 20,000 characters falls back to the order ID, the total and a pointer to orders.get', () => {
  const seed = baseSeed();
  const groups = Array.from({ length: 10 }, (_, g) => ({
    id: 'og-x' + g, name: 'Extras ' + g, required: false, min: 0, max: 10,
    options: Array.from({ length: 10 }, (_, i) => ({ id: 'op-x' + g + '-' + i, name: 'x'.repeat(74) + ' ' + g + '-' + i, price_delta_cents: 0, allergens: { contains: [], may_contain: [] } })),
  }));
  seed.dishes.push({ ...seed.dishes.find(d => d.id === 'mi-2'), id: 'mi-x', name: 'Everything noodles', option_groups: groups });
  const all = groups.flatMap(g => g.options.map(o => o.id));
  const f = placed({ seed, items: [['mi-x', all], ['mi-x', all], ['mi-x', all]] });
  const notice = f.data().notices[0];
  assert.ok(!notice.body.includes('Receipt'));
  assert.ok(notice.body.includes('o-1'));
  assert.ok(notice.body.includes('$' + (order(f).total_cents / 100).toFixed(2)));
  assert.ok(notice.body.includes('plateway.orders.get'));
  withinLimits(f);
});

test('T14 seeded notices are history: kept unchanged, never renumbered, and new notices continue the sequence', () => {
  const seed = baseSeed();
  seed.orders.push(deliveredOrder());
  const old = [
    { id: 'n-7', kind: 'notice.order_placed', order_id: 'o-21', line_id: null, at: '2026-12-03T17:41:00-05:00', title: 'Order placed', body: 'Order o-21 from Basil Row was placed.' },
    { id: 'n-8', kind: 'notice.order_delivered', order_id: 'o-21', line_id: null, at: '2026-12-03T18:41:00-05:00', title: 'Order delivered', body: 'Order o-21 from Basil Row was delivered.' },
  ];
  seed.notices = structuredClone(old);
  const f = placed({ seed });
  assert.deepEqual(f.data().notices.slice(0, 2), old);
  assert.deepEqual(f.data().notices.slice(2).map(n => [n.id, n.order_id]), [['n-9', 'o-22']]);
});

test('T14 notice IDs leave room for an epoch-prefixed Mail message ID of at most 100 characters', () => {
  const seed = baseSeed();
  seed.orders.push(deliveredOrder());
  seed.notices = [{ id: 'n-' + '1'.repeat(80), kind: 'notice.order_delivered', order_id: 'o-21', line_id: null, at: '2026-12-03T18:41:00-05:00', title: 'Order delivered', body: 'Delivered.' }];
  assert.equal(seedValid(seed), false);
  seed.notices[0].id = 'n-' + '1'.repeat(70);
  assert.equal(seedValid(seed), true);
});
