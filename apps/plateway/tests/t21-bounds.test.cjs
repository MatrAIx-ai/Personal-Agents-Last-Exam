'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');
const { placed, ev, order, stored } = require('./flows.cjs');
const plugin = require('../plugin.cjs');
const { compile } = require('./schema-validator.cjs');
const binding = require('../fixtures/binding.json');

const ctx = { app_id: 'plateway', virtual_now: '2026-12-04T11:30:00-05:00', binding };
const rejected = (seed, label) => assert.throws(() => plugin.validateSeed(ctx, seed), e => e.code === 'invalid_seed', label);
const freeDish = seed => { seed.dishes.push({ ...seed.dishes.find(d => d.id === 'mi-2'), id: 'mi-0', name: 'Water cup', price_cents: 0, allergens: { contains: [], may_contain: [] }, option_groups: [] }); return seed; };

test('Bounds a $0 line can be removed by an event, removed at release and reported, with no refund and a notice saying none was due', () => {
  const titles = f => f.data().notices.filter(n => n.kind === 'notice.item_refunded').map(n => n.title);
  const f = placed({ seed: freeDish(baseSeed()), items: [['mi-1', ['op-1']], ['mi-0', []]] });
  f.event(ev('order.accepted', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  assert.equal(f.event(ev('order.item_unavailable', '2026-12-04T11:40:00-05:00', { order_id: 'o-1', line_id: 'ol-2' })).status, 'committed');
  assert.deepEqual([order(f).lines[1].removed, order(f).refunds.length], [true, 0]);
  assert.deepEqual(f.data().notices.filter(n => n.kind === 'notice.item_refunded').map(n => [n.line_id, n.body]), [['ol-2', 'Order o-1 from Basil Row: Water cup was removed; no refund was due.']]);
  assert.ok(stored(f).timeline.some(t => t.note === 'Line ol-2 removed; no refund due'));
  assert.equal(f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 }).status, 'committed');
  assert.deepEqual(titles(f), ['Item removed']);

  const g = placed({ seed: freeDish(baseSeed()), items: [['mi-1', ['op-1']], ['mi-0', []]], when: { mode: 'scheduled', delivery_at: '2026-12-04T14:00:00-05:00' } });
  g.event(ev('menu_item.availability_changed', '2026-12-04T11:45:00-05:00', { item_id: 'mi-0', available: false }));
  g.setNow('2026-12-04T13:30:00-05:00');
  assert.equal(g.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 }).status, 'committed');
  assert.deepEqual([stored(g).status, stored(g).lines[1].removed, stored(g).refunds.length], ['submitted', true, 0]);
  assert.deepEqual(g.data().notices.filter(n => n.kind === 'notice.item_refunded').map(n => [n.line_id, n.at]), [['ol-2', '2026-12-04T13:25:00-05:00']]);

  const seed = freeDish(baseSeed());
  const o = deliveredOrder();
  o.lines.push({ ...o.lines[0], id: 'ol-3', item_id: 'mi-0', name: 'Water cup', options: [], unit_price_cents: 0, subtotal_cents: 0, tax_cents: 0 });
  seed.orders.push(o);
  const h = fixture({ seed, now: '2026-12-04T11:30:00-05:00' });
  assert.equal(h.call('plateway.orders.report_issue', { order_id: 'o-21', lines: [{ line_id: 'ol-3', kind: 'missing' }] }).status, 'committed');
  assert.deepEqual([h.data().orders[0].lines[2].report.kind, h.data().orders[0].refunds.length], ['missing', 0]);
  assert.deepEqual(h.data().notices.map(n => [n.title, n.body]), [['Item reported', 'Order o-21 from Basil Row: Water cup was reported missing; no refund was due.']]);
  assert.ok(h.data().orders[0].timeline.some(t => t.note === 'Line ol-3 reported missing; no refund due'));
  assert.equal(h.call('plateway.orders.rate', { order_id: 'o-21', stars: 4 }).status, 'committed');
});

test('Bounds seeded orders keep mode, status and placement, release and delivery times consistent', () => {
  const scheduled = o => Object.assign(o, { status: 'scheduled', mode: 'scheduled', placed_at: '2026-12-03T20:05:00-05:00', delivery_at: '2026-12-04T19:00:00-05:00', release_at: '2026-12-04T18:15:00-05:00', submitted_at: null, accept_by: null, delivered_at: null, estimated_delivery_at: '2026-12-04T19:00:00-05:00', timeline: [{ at: '2026-12-03T20:05:00-05:00', status: 'scheduled', note: 'Order placed' }] });
  const seed = mutate => { const s = baseSeed(); const o = scheduled(deliveredOrder()); o.charge.at = o.placed_at; mutate(o); s.orders.push(o); return s; };
  plugin.validateSeed(ctx, seed(() => {}));
  rejected(seed(o => { o.release_at = '2026-12-03T19:59:00-05:00'; }), 'release before placement');
  rejected(seed(o => { o.release_at = '2026-12-04T19:15:00-05:00'; }), 'release after delivery');
  rejected(seed(o => { o.mode = 'asap'; o.delivery_at = null; o.release_at = null; }), 'scheduled status with asap mode');
  const asap = baseSeed(); const d = deliveredOrder(); d.release_at = '2026-12-03T17:00:00-05:00'; asap.orders.push(d);
  rejected(asap, 'asap order with a release time');
});

test('Bounds the placed notice falls back when its receipt exceeds 20,000 UTF-16 units even under 20,000 code points', () => {
  const seed = baseSeed();
  const groups = Array.from({ length: 10 }, (_, g) => ({
    id: 'og-e' + g, name: 'Toppings ' + g, required: false, min: 0, max: 10,
    options: Array.from({ length: 10 }, (_, i) => ({ id: 'op-e' + g + '-' + i, name: '🍜'.repeat(38) + g + i, price_delta_cents: 0, allergens: { contains: [], may_contain: [] } })),
  }));
  seed.dishes.push({ ...seed.dishes.find(d => d.id === 'mi-2'), id: 'mi-e', name: 'Bowl', option_groups: groups });
  const all = groups.flatMap(g => g.options.map(o => o.id));
  const f = placed({ seed, items: [['mi-e', all], ['mi-e', all], ['mi-e', all]] });
  const body = f.data().notices[0].body;
  assert.ok(!body.includes('Receipt'));
  assert.ok(body.length <= 20000);
});

test('Bounds event payloads fit the state: long rejection reasons are kept and prices stay within the seed cap', () => {
  const f = placed();
  const reason = 'r'.repeat(200);
  assert.equal(f.event(ev('order.rejected', '2026-12-04T11:35:00-05:00', { order_id: 'o-1', reason })).status, 'committed');
  assert.ok(stored(f).timeline.some(t => t.note.endsWith(reason)));
  const eventValid = compile(require('../schemas/events.schema.json'), path.join(__dirname, '..', 'schemas'));
  const price = n => ({ event_id: 'p', at: '2026-12-04T12:00:00-05:00', operation: 'menu_item.price_changed', payload: { item_id: 'mi-1', price_cents: n } });
  assert.equal(eventValid(price(1000000)), true);
  assert.equal(eventValid(price(1000001)), false);
});

test('Bounds the App sets no date floor: a 1970 registry clock loads and 2025 history is accepted', () => {
  plugin.validateSeed({ ...ctx, virtual_now: '1970-01-01T00:00:00Z' }, baseSeed());
  const o = deliveredOrder();
  const shift = iso => iso && iso.replace('2026-12-03', '2025-06-03').replace('-05:00', '-04:00');
  for (const k of ['placed_at', 'submitted_at', 'accept_by', 'estimated_delivery_at', 'delivered_at']) o[k] = shift(o[k]);
  o.charge.at = shift(o.charge.at); o.timeline.forEach(t => { t.at = shift(t.at); });
  const seed = baseSeed(); seed.orders.push(o);
  const f = fixture({ seed, now: '2026-12-04T11:30:00-05:00' });
  assert.equal(f.call('plateway.orders.get', { order_id: 'o-21' }).order.placed_at, '2025-06-03T18:00:00-04:00');
  f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  assert.equal(f.call('plateway.orders.place', { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 0, token: f.call('plateway.checkout.preview', { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 0 }).token }).status, 'committed');
});

test('Bounds the scheduled placed notice names the local delivery day and time', () => {
  const f = placed({ items: [['mi-2', []]], when: { mode: 'scheduled', delivery_at: '2026-12-05T19:00:00-05:00' } });
  assert.match(f.data().notices[0].body, /for delivery on Saturday, December 5 at 19:00\./);
});
