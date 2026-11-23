'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder, week } = require('./seeds.cjs');
const { placed, ev, order, stored, checkout } = require('./flows.cjs');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');

const ctx = { app_id: 'plateway', virtual_now: '2026-12-04T11:30:00-05:00', binding };
const rejected = (seed, label) => assert.throws(() => plugin.validateSeed(ctx, seed), e => e.code === 'invalid_seed', label);
const withOrder = mutate => { const s = baseSeed(); const o = deliveredOrder(); mutate(o, s); s.orders.push(o); return s; };

test('Edge seeds must carry the timestamps their order status depends on', () => {
  rejected(withOrder(o => { o.delivered_at = null; }), 'delivered without delivered_at');
  rejected(withOrder(o => { Object.assign(o, { status: 'submitted', delivered_at: null, accept_by: null }); }), 'submitted without accept_by');
  rejected(withOrder(o => { Object.assign(o, { status: 'submitted', delivered_at: null, accept_by: '2026-12-03T21:00:00-05:00' }); }), 'accept_by not submitted + 20 min');
  rejected(withOrder(o => { Object.assign(o, { status: 'scheduled', mode: 'scheduled', delivered_at: null, submitted_at: null, accept_by: null, release_at: null, delivery_at: '2026-12-05T12:00:00-05:00' }); }), 'scheduled without release_at');
  rejected(withOrder(o => { Object.assign(o, { status: 'cancelled', delivered_at: null }); }), 'cancelled without cancellation');
  rejected(withOrder(o => { o.cancellation = { at: '2026-12-03T19:00:00-05:00', reason: 'rejected', refunded_cents: 0, kept_cents: 1957 }; }), 'delivered with a cancellation');
  rejected(withOrder(o => { o.delivered_at = '2026-12-03T17:00:00-05:00'; }), 'delivered before placement');
});

test('Edge seeded refunds must match their lines', () => {
  rejected(withOrder(o => { o.refunds.push({ id: 'rf-1', amount_cents: 656, reason: 'line_reported', line_id: 'ol-1', at: '2026-12-03T19:00:00-05:00' }); }), 'reported refund without a report');
  rejected(withOrder(o => { o.lines[0].report = { kind: 'missing', at: '2026-12-03T19:00:00-05:00' }; }), 'report without its refund');
  rejected(withOrder(o => { o.refunds.push({ id: 'rf-1', amount_cents: 656, reason: 'line_unavailable', line_id: 'ol-1', at: '2026-12-03T18:10:00-05:00' }); }), 'unavailable refund for a live line');
  rejected(withOrder(o => { o.refunds.push({ id: 'rf-1', amount_cents: 656, reason: 'line_reported', line_id: 'ol-404', at: '2026-12-03T19:00:00-05:00' }); }), 'refund for an unknown line');
});

test('Edge seeded carts, option IDs, time zones, clocks and text limits are validated', () => {
  const cart = baseSeed(); cart.cart = { restaurant_id: 'r-1', lines: [{ id: 'ol-9', item_id: 'mi-1', option_ids: [], quantity: 1, label: null }] };
  rejected(cart, 'cart line missing a required option');
  const dupe = baseSeed(); dupe.dishes[0].option_groups[1].options[0].id = 'op-1';
  rejected(dupe, 'duplicate option ID in a dish');
  const zone = baseSeed(); zone.time_zone = 'Mars/Phobos';
  rejected(zone, 'unknown time zone');
  rejected(withOrder(o => { o.lines[0].label = 'x'.repeat(41); }), 'seeded label over 40 characters');
  rejected(withOrder(o => { o.rating = { stars: 4, text: 'x'.repeat(501), at: '2026-12-03T20:00:00-05:00' }; }), 'seeded rating text over 500 characters');
});

test('Edge the checkout token covers line IDs and a normalised delivery time', () => {
  const f = fixture({ seed: baseSeed(), now: '2026-12-04T11:30:00-05:00' });
  f.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1 });
  f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  const p = f.call('plateway.checkout.preview', checkout());
  f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  f.call('plateway.cart.remove_item', { line_id: 'ol-2' });
  assert.equal(f.call('plateway.orders.place', { ...checkout(), token: p.token }).status, 'stale_preview');
  const g = fixture({ seed: baseSeed(), now: '2026-12-04T11:30:00-05:00' });
  g.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  const when = { mode: 'scheduled', delivery_at: '2026-12-04T18:00:00Z' };
  const q = g.call('plateway.checkout.preview', checkout({ when }));
  assert.equal(q.delivery_at, '2026-12-04T13:00:00-05:00');
  assert.equal(g.call('plateway.orders.place', { ...checkout({ when: { mode: 'scheduled', delivery_at: q.delivery_at } }), token: q.token }).status, 'committed');
});

test('Edge line IDs are never reused after removal', () => {
  const f = fixture({ seed: baseSeed(), now: '2026-12-04T11:30:00-05:00' });
  assert.equal(f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 }).line_id, 'ol-1');
  f.call('plateway.cart.remove_item', { line_id: 'ol-1' });
  assert.equal(f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 }).line_id, 'ol-2');
});

test('Edge generated times keep milliseconds so the acceptance limit is exact', () => {
  const f = placed({ now: '2026-12-04T11:30:00.900-05:00' });
  assert.equal(stored(f).accept_by, '2026-12-04T11:50:00.900-05:00');
  f.event(ev('order.accepted', '2026-12-04T11:50:00.500-05:00', { order_id: 'o-1' }));
  assert.equal(order(f).status, 'preparing');
});

test('Edge the 7-day horizon uses local wall time across DST changes', () => {
  const mk = now => { const f = fixture({ seed: baseSeed(), now }); f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 }); return f; };
  const pv = (f, delivery_at) => f.call('plateway.checkout.preview', checkout({ when: { mode: 'scheduled', delivery_at } })).status;
  assert.equal(pv(mk('2026-10-28T12:30:00-04:00'), '2026-11-04T12:30:00-05:00'), 'ok');
  assert.equal(pv(mk('2026-03-05T12:30:00-05:00'), '2026-03-12T12:30:00-04:00'), 'ok');
  assert.equal(pv(mk('2026-03-05T12:30:00-05:00'), '2026-03-12T13:30:00-04:00'), 'delivery_time_unavailable');
});

test('Edge an overnight restaurant at 00:30 is open for browse, ASAP and release; a release equal to now is rejected', () => {
  const seed = baseSeed();
  seed.restaurants[1].hours = { ...week([]), fri: [['17:00', '01:00']] };
  const f = fixture({ seed, now: '2026-12-05T00:30:00-05:00' });
  assert.equal(f.call('plateway.restaurants.search', { address_id: 'a-1', cuisine: 'noodles' }).restaurants[0].status, 'open');
  f.call('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1 });
  assert.equal(f.call('plateway.checkout.preview', checkout()).status, 'ok');
  const g = fixture({ seed, now: '2026-12-04T23:40:00-05:00' });
  g.call('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1 });
  assert.equal(g.call('plateway.checkout.preview', checkout({ when: { mode: 'scheduled', delivery_at: '2026-12-05T00:45:00-05:00' } })).release_at, '2026-12-05T00:10:00-05:00');
  const h = fixture({ seed: baseSeed(), now: '2026-12-04T11:30:00-05:00' });
  h.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  const slow = baseSeed(); slow.restaurants[0].prep_minutes = 30;
  const s = fixture({ seed: slow, now: '2026-12-04T11:30:00-05:00' });
  s.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  assert.equal(s.call('plateway.checkout.preview', checkout({ when: { mode: 'scheduled', delivery_at: '2026-12-04T12:15:00-05:00' } })).status, 'delivery_time_unavailable');
});

test('Edge cuisine case, unknown list filter, card checked last, cart capacity, last line marked removed', () => {
  const seed = baseSeed(); seed.restaurants[0].cuisines = ['Thai'];
  const f = fixture({ seed, now: '2026-12-04T11:30:00-05:00' });
  assert.equal(f.call('plateway.restaurants.search', { address_id: 'a-1', cuisine: 'thai' }).restaurants.length, 1);
  assert.equal(f.call('plateway.orders.list', { restaurant_id: 'r-404' }).status, 'not_found');
  f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  assert.equal(f.call('plateway.checkout.preview', checkout({ address_id: 'a-9', card_id: 'c-404' })).status, 'outside_delivery_area');
  const big = fixture({ seed: baseSeed(), now: '2026-12-04T11:30:00-05:00' });
  for (let i = 0; i < 50; i++) big.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  assert.equal(big.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 }).status, 'invalid_arguments');
  const one = placed({ items: [['mi-2', []]] });
  one.event(ev('order.item_unavailable', '2026-12-04T11:35:00-05:00', { order_id: 'o-1', line_id: 'ol-1' }));
  assert.deepEqual([order(one).status, order(one).lines[0].removed, order(one).refunds.length], ['cancelled', true, 1]);
});

test('Edge refunds are capped and never show a $0.00 refund; a report after a line refund stays within the charge', () => {
  const f = placed({ items: [['mi-1', ['op-1']], ['mi-1', ['op-2']], ['mi-2', []]] });
  f.event(ev('order.accepted', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.item_unavailable', '2026-12-04T11:40:00-05:00', { order_id: 'o-1', line_id: 'ol-3' }));
  f.event(ev('order.picked_up', '2026-12-04T11:50:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.delivered', '2026-12-04T12:05:00-05:00', { order_id: 'o-1' }));
  f.call('plateway.orders.report_issue', { order_id: 'o-1', lines: [{ line_id: 'ol-1', kind: 'missing' }, { line_id: 'ol-2', kind: 'wrong' }] });
  const o = order(f);
  assert.ok(o.refunded_cents <= o.charge.amount_cents);
  assert.equal(o.refunded_cents, 1350 + 656 + 656);
  assert.equal(f.data().notices.filter(n => n.body.includes('$0.00')).length, 0);
});

test('Edge a 500-character emoji rating is accepted and 501 is rejected', () => {
  const mk = () => { const s = baseSeed(); s.orders.push(deliveredOrder()); return fixture({ seed: s, now: '2026-12-04T11:30:00-05:00' }); };
  assert.equal(mk().call('plateway.orders.rate', { order_id: 'o-21', stars: 5, text: '🍜'.repeat(500) }).status, 'committed');
  assert.equal(mk().call('plateway.orders.rate', { order_id: 'o-21', stars: 5, text: '🍜'.repeat(501) }).status, 'invalid_arguments');
});
