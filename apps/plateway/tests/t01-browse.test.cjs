'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed } = require('./seeds.cjs');

const open = () => fixture({ seed: baseSeed(), now: '2026-12-04T11:30:00-05:00' });
const ids = list => list.map(r => r.id);

test('T01 restaurants.search returns only restaurants serving the address zone, with status, estimate, fees and rating', () => {
  const f = open();
  const home = f.call('plateway.restaurants.search', { address_id: 'a-1' });
  assert.equal(home.status, 'ok');
  assert.deepEqual(ids(home.restaurants), ['r-1', 'r-2']);
  const basil = home.restaurants[0];
  assert.deepEqual([basil.status, basil.estimate_minutes, basil.delivery_fee_cents, basil.rating.average], ['open', 35, 299, 4.6]);
  assert.equal(home.restaurants[1].status, 'closed');
  assert.deepEqual(ids(f.call('plateway.restaurants.search', { address_id: 'a-2' }).restaurants), ['r-1']);
  assert.equal(f.call('plateway.restaurants.search', { address_id: 'a-2' }).restaurants[0].estimate_minutes, 45);
  assert.deepEqual(f.call('plateway.restaurants.search', { address_id: 'a-9' }).restaurants, []);
  assert.deepEqual(ids(f.call('plateway.restaurants.search', { address_id: 'a-1', text: 'NOODLE' }).restaurants), ['r-2']);
  assert.deepEqual(ids(f.call('plateway.restaurants.search', { address_id: 'a-1', text: 'curry' }).restaurants), ['r-1']);
  assert.deepEqual(ids(f.call('plateway.restaurants.search', { address_id: 'a-1', cuisine: 'thai' }).restaurants), ['r-1']);
  assert.equal(f.call('plateway.restaurants.search', { address_id: 'a-404' }).status, 'not_found');
});

test('T01 a paused restaurant reports paused with its reason, regardless of hours', () => {
  const f = open();
  f.event({ event_id: 'ev-1', at: '2026-12-04T11:35:00-05:00', operation: 'restaurant.status_changed', payload: { restaurant_id: 'r-1', status: 'paused', reason: 'Kitchen closed for repairs' } });
  const r = f.call('plateway.restaurants.search', { address_id: 'a-1' }).restaurants[0];
  assert.deepEqual([r.status, r.pause_reason], ['paused', 'Kitchen closed for repairs']);
  f.event({ event_id: 'ev-2', at: '2026-12-04T11:40:00-05:00', operation: 'restaurant.status_changed', payload: { restaurant_id: 'r-1', status: 'open' } });
  assert.equal(f.call('plateway.restaurants.get', { restaurant_id: 'r-1' }).restaurant.status, 'open');
});

test('T01 restaurants.get lists hours, status, fees and the menu with prices, availability and declared allergens', () => {
  const out = open().call('plateway.restaurants.get', { restaurant_id: 'r-1' });
  assert.equal(out.restaurant.hours.fri[0][0], '11:00');
  assert.deepEqual([out.restaurant.status, out.restaurant.delivery_fee_cents, out.restaurant.prep_minutes], ['open', 299, 20]);
  assert.deepEqual(out.menu.map(d => [d.id, d.price_cents, d.available]), [['mi-1', 607, true], ['mi-2', 1250, true]]);
  assert.deepEqual(out.menu[0].allergens, { contains: ['egg', 'peanuts', 'soybeans'], may_contain: [] });
  assert.deepEqual(out.menu[1].allergens, { contains: [], may_contain: ['tree nuts'] });
  assert.equal(out.menu[0].has_options, true);
  assert.equal(open().call('plateway.restaurants.get', { restaurant_id: 'r-404' }).status, 'not_found');
});

test('T01 menu_items.get returns the description, option groups, price changes and option allergens', () => {
  const out = open().call('plateway.menu_items.get', { item_id: 'mi-1' });
  assert.equal(out.item.description, 'Rice noodles, egg, tofu, peanuts, bean sprouts.');
  assert.deepEqual(out.item.option_groups.map(g => [g.id, g.required, g.min, g.max]), [['og-1', true, 1, 1], ['og-2', false, 0, 2]]);
  const shrimp = out.item.option_groups[1].options[0];
  assert.deepEqual([shrimp.id, shrimp.price_delta_cents, shrimp.allergens.contains], ['op-3', 300, ['crustacean shellfish']]);
  assert.deepEqual(out.item.option_groups[0].options[0].allergens, { contains: [], may_contain: [] });
  assert.deepEqual(open().call('plateway.menu_items.get', { item_id: 'mi-2' }).item.option_groups, []);
  assert.equal(open().call('plateway.menu_items.get', { item_id: 'mi-404' }).status, 'not_found');
});
