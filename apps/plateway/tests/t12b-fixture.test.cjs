'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { check, load } = require('../dev/check-fixture.cjs');
const { placed } = require('./flows.cjs');

test('T-fixture the representative fixture passes every content check', () => {
  const { seed, options } = load();
  assert.deepEqual(check(seed, options), []);
});

test('T-fixture the checker catches a real brand, an early date and a wrong total', () => {
  const { seed, options } = load();
  const brand = structuredClone(seed); brand.restaurants[0].name = 'Chipotle Express';
  assert.ok(check(brand, options).includes('no real brands'));
  const early = structuredClone(seed); early.orders[0].rating = { ...(early.orders[0].rating || { stars: 4, text: null }), at: '2025-12-31T12:00:00-05:00' };
  assert.ok(check(early, options).includes('every date on or after 2026-01-01'));
  const network = structuredClone(seed); network.cards[0].brand = 'Visa';
  assert.ok(check(network, options).includes('no real brands'));
  const offset = structuredClone(seed); offset.orders[6].placed_at = offset.orders[6].placed_at.replace('-05:00', '-04:00');
  assert.ok(check(offset, options).includes('every time written with the zone offset in force'));
  assert.ok(check(seed, { ...options, scenario: { ...options.scenario, at: '2026-12-05T03:00:00-05:00' } }).includes('the scenario pauses a restaurant while it is open, at or after the seed clock'));
  const plain = structuredClone(seed); plain.restaurants.forEach(r => { r.hours = { ...r.hours, mon: [['09:00', '17:00']] }; });
  assert.ok(check(plain, options).includes('a restaurant closed on exactly one weekday'));
  const wrong = structuredClone(seed); wrong.orders[0].total_cents += 1;
  assert.ok(check(wrong, options).some(p => p === 'order ' + wrong.orders[0].id + ' total recomputes'));
});

test('T-fixture the default seed supports browse, checkout and continues every ID sequence', () => {
  const f = fixture();
  const { seed } = load();
  const open = f.call('plateway.restaurants.search', { address_id: 'a-1' }).restaurants.filter(r => r.status === 'open');
  assert.ok(open.length >= 3);
  const before = { orders: seed.orders.length, notices: seed.notices.length };
  f.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-2'], quantity: 1 });
  const args = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 300 };
  const p = f.call('plateway.checkout.preview', args);
  assert.equal(p.status, 'ok');
  const out = f.call('plateway.orders.place', { ...args, token: p.token });
  assert.equal(out.order_id, 'o-' + (before.orders + 1));
  assert.equal(f.data().notices.at(-1).id, 'n-' + (before.notices + 1));
  assert.equal(f.call('plateway.checkout.preview', { ...args, card_id: 'c-3' }).status, 'cart_empty');
});

test('T-fixture the scheduled order releases at its release time and the in-progress order can be delivered', () => {
  const { seed } = load();
  const scheduled = seed.orders.find(o => o.status === 'scheduled');
  const active = seed.orders.find(o => o.status === 'preparing');
  const f = fixture();
  f.setNow(scheduled.release_at);
  assert.equal(f.call('plateway.orders.get', { order_id: scheduled.id }).order.status, 'submitted');
  f.event({ event_id: 'fx-1', at: scheduled.release_at, operation: 'order.picked_up', payload: { order_id: active.id } });
  f.event({ event_id: 'fx-2', at: scheduled.release_at, operation: 'order.delivered', payload: { order_id: active.id } });
  assert.equal(f.call('plateway.orders.get', { order_id: active.id }).order.status, 'delivered');
});

test('T16 a seed whose timer is already due at its clock loads; reads project it and the first write commits it at its due time', () => {
  const f = placed();
  const seed = structuredClone(f.data());
  const g = fixture({ seed, now: '2026-12-04T12:10:00-05:00' });
  assert.equal(g.call('plateway.orders.get', { order_id: 'o-1' }).order.status, 'cancelled');
  assert.equal(g.data().orders[0].status, 'submitted');
  g.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  assert.equal(g.data().orders[0].status, 'cancelled');
  assert.equal(g.data().orders[0].cancellation.at, '2026-12-04T11:50:00-05:00');
});
