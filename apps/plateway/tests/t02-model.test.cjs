'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder, week } = require('./seeds.cjs');
const { totals } = require('../src/pricing.cjs');
const { isOpen, toIso, ms } = require('../src/time.cjs');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');

const ctx = { app_id: 'plateway', virtual_now: '2026-12-04T11:30:00-05:00', binding };
const rejects = (mutate, label) => {
  const seed = baseSeed(); seed.orders.push(deliveredOrder()); mutate(seed);
  assert.throws(() => plugin.validateSeed(ctx, seed), e => e.code === 'invalid_seed', label);
};

test('T02 a valid seed with a delivered order passes the schema and the model rules', () => {
  const seed = baseSeed(); seed.orders.push(deliveredOrder());
  assert.doesNotThrow(() => fixture({ seed }));
});

test('T02 invalid seeds are rejected as invalid_seed', () => {
  rejects(s => { s.addresses[0].zone_id = 'z-404'; }, 'unknown zone');
  rejects(s => { s.dishes[0].restaurant_id = 'r-404'; }, 'unknown restaurant');
  rejects(s => { s.cart = { restaurant_id: 'r-1', lines: [{ id: 'ol-90', item_id: 'mi-1', option_ids: ['op-404'], quantity: 1, label: null }] }; }, 'unknown option');
  rejects(s => { s.cart = { restaurant_id: 'r-1', lines: [{ id: 'ol-90', item_id: 'mi-1', option_ids: ['op-1'], quantity: 1, label: null }, { id: 'ol-91', item_id: 'mi-3', option_ids: [], quantity: 1, label: null }] }; }, 'cart from two restaurants');
  rejects(s => { s.orders[0].card_id = 'c-404'; }, 'unknown card');
  rejects(s => { s.orders[0].address_id = 'a-404'; }, 'unknown address');
  rejects(s => { s.orders[0].charge.amount_cents += 1; }, 'charge differs from recomputed total');
  rejects(s => { s.orders[0].refunds.push({ id: 'rf-1', amount_cents: 1958, reason: 'line_reported', line_id: null, at: '2026-12-03T19:00:00-05:00' }); }, 'refunds above the charge');
  rejects(s => { s.orders[0].placed_at = '2026-12-03T19:00:00-05:00'; }, 'placed after delivery');
  rejects(s => { s.account_id = 'plateway-other'; }, 'no binding row');
  rejects(s => { s.dishes.push({ ...s.dishes[1], id: 'mi-2' }); }, 'duplicate dish id');
});

test('T02 the seed schema rejects an allergen outside the nine and a missing seed_id', () => {
  const allergen = baseSeed(); allergen.dishes[1].allergens.contains = ['mustard'];
  assert.throws(() => fixture({ seed: allergen }), /seed schema/);
  const unnamed = baseSeed(); delete unnamed.seed_id;
  assert.throws(() => fixture({ seed: unnamed }), /seed schema/);
});

test('T02 totals follow the fee and tax rules, rounded half up', () => {
  const t = totals([{ subtotal_cents: 607 }, { subtotal_cents: 607 }], 299, 200);
  assert.deepEqual(t, { subtotal_cents: 1214, tax_cents: 98, service_cents: 146, small_order_cents: 0, delivery_cents: 299, tip_cents: 200, total_cents: 1957 });
  assert.equal(totals([{ subtotal_cents: 1199 }], 0, 0).small_order_cents, 249);
  assert.equal(totals([{ subtotal_cents: 1200 }], 0, 0).small_order_cents, 0);
  assert.equal(totals([{ subtotal_cents: 1213 }], 0, 0).service_cents, 146);
  assert.equal(totals([{ subtotal_cents: 1212 }], 0, 0).service_cents, 145);
});

test('T02 isOpen uses local wall time, including spans past midnight and DST days', () => {
  const zone = 'America/New_York';
  const late = { hours: week([['17:00', '01:00']]) };
  assert.equal(isOpen(late, ms('2026-12-05T00:30:00-05:00'), zone), true);
  assert.equal(isOpen(late, ms('2026-12-05T01:00:00-05:00'), zone), false);
  assert.equal(isOpen(late, ms('2026-12-04T16:59:00-05:00'), zone), false);
  const day = { hours: week([['03:00', '22:00']]) };
  assert.equal(isOpen(day, ms('2026-03-08T03:30:00-04:00'), zone), true);
  assert.equal(isOpen(day, ms('2026-03-08T01:30:00-05:00'), zone), false);
  const night = { hours: week([['01:00', '02:00']]) };
  assert.equal(isOpen(night, ms('2026-11-01T01:30:00-04:00'), zone), true);
  assert.equal(isOpen(night, ms('2026-11-01T01:30:00-05:00'), zone), true);
  assert.equal(toIso(ms('2026-11-01T01:30:00-05:00'), zone), '2026-11-01T01:30:00-05:00');
  assert.equal(toIso(ms('2026-11-01T01:30:00-04:00'), zone), '2026-11-01T01:30:00-04:00');
  const closedMonday = { hours: { ...week([['11:00', '21:00']]), mon: [] } };
  assert.equal(isOpen(closedMonday, ms('2026-12-07T12:00:00-05:00'), zone), false);
});
