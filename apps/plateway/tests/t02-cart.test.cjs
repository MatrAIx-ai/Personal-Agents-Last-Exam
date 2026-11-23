'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');

const make = () => fixture({ seed: baseSeed(), now: '2026-12-04T11:30:00-05:00' });
const add = (f, args) => f.call('plateway.cart.add_item', { quantity: 1, option_ids: [], ...args });

test('T02 add_item with valid options creates a line priced from the current menu', () => {
  const f = make();
  const out = add(f, { item_id: 'mi-1', option_ids: ['op-1', 'op-3'], quantity: 2 });
  assert.equal(out.status, 'committed');
  assert.equal(out.line_id, 'ol-1');
  const cart = f.call('plateway.cart.get', {});
  assert.equal(cart.restaurant_id, 'r-1');
  assert.deepEqual(cart.lines.map(l => [l.id, l.unit_price_cents, l.quantity, l.subtotal_cents]), [['ol-1', 907, 2, 1814]]);
  assert.equal(cart.subtotal_cents, 1814);
});

test('T02 option, availability and restaurant checks', () => {
  const f = make();
  assert.equal(add(f, { item_id: 'mi-1' }).status, 'invalid_option');
  assert.equal(add(f, { item_id: 'mi-1', option_ids: ['op-1', 'op-2'] }).status, 'invalid_option');
  assert.equal(add(f, { item_id: 'mi-1', option_ids: ['op-1', 'op-404'] }).status, 'invalid_option');
  assert.equal(add(f, { item_id: 'mi-2', option_ids: ['op-1'] }).status, 'invalid_option');
  f.event({ event_id: 'ev-a', at: '2026-12-04T11:31:00-05:00', operation: 'menu_item.availability_changed', payload: { item_id: 'mi-2', available: false } });
  assert.equal(add(f, { item_id: 'mi-2' }).status, 'item_unavailable');
  assert.equal(add(f, { item_id: 'mi-1', option_ids: ['op-2'] }).status, 'committed');
  assert.equal(add(f, { item_id: 'mi-3' }).status, 'different_restaurant');
  assert.equal(add(f, { item_id: 'mi-404' }).status, 'not_found');
  assert.equal(f.call('plateway.cart.get', {}).lines.length, 1);
});

test('T02 update_item changes quantity and options; remove_item empties the cart', () => {
  const f = make();
  add(f, { item_id: 'mi-1', option_ids: ['op-1'] });
  assert.equal(f.call('plateway.cart.update_item', { line_id: 'ol-1', quantity: 3, option_ids: ['op-2', 'op-4'] }).status, 'committed');
  const line = f.call('plateway.cart.get', {}).lines[0];
  assert.deepEqual([line.quantity, line.unit_price_cents, line.options.map(o => o.id)], [3, 807, ['op-2', 'op-4']]);
  assert.equal(f.call('plateway.cart.update_item', { line_id: 'ol-1', quantity: 11 }).status, 'invalid_arguments');
  assert.equal(f.call('plateway.cart.update_item', { line_id: 'ol-1', option_ids: [] }).status, 'invalid_option');
  assert.equal(f.call('plateway.cart.update_item', { line_id: 'ol-404', quantity: 2 }).status, 'not_found');
  assert.equal(f.call('plateway.cart.remove_item', { line_id: 'ol-1' }).status, 'committed');
  assert.deepEqual(f.call('plateway.cart.get', {}), { ...f.call('plateway.cart.get', {}), restaurant_id: null, lines: [], subtotal_cents: 0 });
  assert.equal(add(f, { item_id: 'mi-3' }).status, 'committed');
});

test('T02 a label of up to 40 characters is kept and changes no price, option or allergen', () => {
  const f = make();
  const forty = '🍜'.repeat(40);
  assert.equal(add(f, { item_id: 'mi-1', option_ids: ['op-1'], label: forty }).status, 'committed');
  assert.equal(add(f, { item_id: 'mi-1', option_ids: ['op-1'], label: 'x'.repeat(41) }).status, 'invalid_arguments');
  const [labelled] = f.call('plateway.cart.get', {}).lines;
  assert.equal(labelled.label, forty);
  assert.equal(labelled.unit_price_cents, 607);
  assert.deepEqual(f.call('plateway.menu_items.get', { item_id: 'mi-1' }).item.allergens.contains, ['egg', 'peanuts', 'soybeans']);
});

test('T02 new line IDs continue after the highest seeded line ID', () => {
  const seed = baseSeed(); seed.orders.push(deliveredOrder());
  const f = fixture({ seed, now: '2026-12-04T11:30:00-05:00' });
  assert.equal(add(f, { item_id: 'mi-2' }).line_id, 'ol-3');
});

test('T02 a price change shows in the cart', () => {
  const f = make();
  add(f, { item_id: 'mi-2' });
  f.event({ event_id: 'ev-p', at: '2026-12-04T11:40:00-05:00', operation: 'menu_item.price_changed', payload: { item_id: 'mi-2', price_cents: 1350 } });
  assert.equal(f.call('plateway.cart.get', {}).lines[0].unit_price_cents, 1350);
});
