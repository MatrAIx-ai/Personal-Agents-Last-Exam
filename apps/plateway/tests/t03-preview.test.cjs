'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed } = require('./seeds.cjs');

const NOW = '2026-12-04T11:30:00-05:00';
function withCart(lines, mutate = s => s) {
  const seed = mutate(baseSeed());
  const f = fixture({ seed, now: NOW });
  for (const [item_id, option_ids, quantity = 1] of lines) f.call('plateway.cart.add_item', { item_id, option_ids, quantity });
  return f;
}
const twoPadThai = () => withCart([['mi-1', ['op-1']], ['mi-1', ['op-2']]]);
const asap = { mode: 'asap' };
const at = iso => ({ mode: 'scheduled', delivery_at: iso });
const preview = (f, args) => f.call('plateway.checkout.preview', { address_id: 'a-1', card_id: 'c-1', when: asap, tip_cents: 200, ...args });

test('T03 preview totals: lines, fees, 8% tax per line, 12% service fee, tip and total, rounded half up', () => {
  const out = preview(twoPadThai(), {});
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.lines.map(l => [l.subtotal_cents, l.tax_cents]), [[607, 49], [607, 49]]);
  assert.deepEqual(out.fees, { delivery_cents: 299, service_cents: 146, small_order_cents: 0 });
  assert.deepEqual([out.subtotal_cents, out.tax_cents, out.tip_cents, out.total_cents], [1214, 98, 200, 1957]);
  assert.deepEqual([out.mode, out.estimate_minutes, out.estimated_delivery_at, out.release_at], ['asap', 35, '2026-12-04T12:05:00-05:00', null]);
  assert.match(out.token, /^[0-9a-f]{64}$/);
});

test('T03 the small-order fee applies just below $12.00 and not at $12.00', () => {
  const below = withCart([['mi-2', []]], s => { s.dishes[1].price_cents = 1199; return s; });
  assert.equal(preview(below, {}).fees.small_order_cents, 249);
  const at12 = withCart([['mi-2', []]], s => { s.dishes[1].price_cents = 1200; return s; });
  assert.equal(preview(at12, {}).fees.small_order_cents, 0);
});

test('T03 checks run in order and return no token', () => {
  const empty = fixture({ seed: baseSeed(), now: NOW });
  assert.equal(preview(empty, {}).status, 'cart_empty');
  const f = twoPadThai();
  f.event({ event_id: 'ev-u', at: '2026-12-04T11:31:00-05:00', operation: 'menu_item.availability_changed', payload: { item_id: 'mi-1', available: false } });
  const unavailable = preview(f, { address_id: 'a-9' });
  assert.deepEqual([unavailable.status, unavailable.token], ['item_unavailable', undefined]);
  assert.equal(preview(twoPadThai(), { address_id: 'a-9' }).status, 'outside_delivery_area');
  assert.equal(preview(withCart([['mi-3', []]]), {}).status, 'restaurant_closed');
  const paused = twoPadThai();
  paused.event({ event_id: 'ev-s', at: '2026-12-04T11:31:00-05:00', operation: 'restaurant.status_changed', payload: { restaurant_id: 'r-1', status: 'paused' } });
  assert.equal(preview(paused, {}).status, 'restaurant_closed');
  assert.equal(preview(twoPadThai(), { card_id: 'c-3' }).status, 'payment_failed');
  assert.equal(preview(twoPadThai(), { card_id: 'c-2' }).status, 'ok');
});

test('T03 scheduled delivery: 15-minute boundary, 45 minutes through 7 days, release after now and within hours', () => {
  const ok = preview(twoPadThai(), { when: at('2026-12-04T12:15:00-05:00') });
  assert.deepEqual([ok.status, ok.mode, ok.delivery_at, ok.release_at], ['ok', 'scheduled', '2026-12-04T12:15:00-05:00', '2026-12-04T11:40:00-05:00']);
  const later = twoPadThai();
  later.setNow('2026-12-04T12:30:00-05:00');
  assert.equal(preview(later, { when: at('2026-12-11T12:30:00-05:00') }).status, 'ok');
  assert.equal(preview(later, { when: at('2026-12-11T12:45:00-05:00') }).status, 'delivery_time_unavailable');
  for (const iso of ['2026-12-04T12:00:00-05:00', '2026-12-04T12:20:00-05:00', '2026-12-11T11:45:00-05:00', '2026-12-05T10:45:00-05:00']) {
    const out = preview(twoPadThai(), { when: at(iso) });
    assert.deepEqual([out.status, out.token], ['delivery_time_unavailable', undefined], iso);
  }
  const slow = withCart([['mi-1', ['op-1']]], s => { s.restaurants[0].prep_minutes = 45; return s; });
  assert.equal(preview(slow, { when: at('2026-12-04T12:15:00-05:00') }).status, 'delivery_time_unavailable');
  const paused = twoPadThai();
  paused.event({ event_id: 'ev-s', at: '2026-12-04T11:31:00-05:00', operation: 'restaurant.status_changed', payload: { restaurant_id: 'r-1', status: 'paused' } });
  assert.equal(preview(paused, { when: at('2026-12-04T13:00:00-05:00') }).status, 'ok');
});

test('T03 the token is stable for the same inputs, ignores an ASAP clock move and changes with the business changes', () => {
  const f = twoPadThai();
  const first = preview(f, {}).token;
  assert.equal(preview(f, {}).token, first);
  f.advance(5);
  assert.equal(preview(f, {}).token, first);
  assert.notEqual(preview(f, { tip_cents: 300 }).token, first);
  f.event({ event_id: 'ev-p', at: '2026-12-04T11:36:00-05:00', operation: 'menu_item.price_changed', payload: { item_id: 'mi-1', price_cents: 650 } });
  assert.notEqual(preview(f, {}).token, first);
});
