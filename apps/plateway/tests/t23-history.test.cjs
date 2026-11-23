'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');

const ctx = { app_id: 'plateway', virtual_now: '2026-12-04T11:30:00-05:00', binding };
const rejected = (seed, label) => assert.throws(() => plugin.validateSeed(ctx, seed), e => e.code === 'invalid_seed', label);
const cancelledOrder = (cancellation, refunds, stage) => {
  const s = baseSeed(); const o = deliveredOrder();
  Object.assign(o, { status: 'cancelled', delivered_at: null, cancellation, refunds });
  const middle = stage === 'preparing' ? [{ at: '2026-12-03T18:02:00-05:00', status: 'preparing', note: 'Accepted by the restaurant' }] : [];
  o.timeline = [o.timeline[0], ...middle, { at: cancellation.at, status: 'cancelled', note: 'Cancelled: ' + cancellation.reason }];
  s.orders.push(o); return s;
};
const refund = amount => ({ id: 'rf-1', amount_cents: amount, reason: 'cancelled', line_id: null, at: '2026-12-03T18:05:00-05:00' });
const cancel = (reason, refunded, kept) => ({ at: '2026-12-03T18:05:00-05:00', reason, refunded_cents: refunded, kept_cents: kept });

test('History a seeded cancellation must match its refund record and the refund rule for its reason', () => {
  plugin.validateSeed(ctx, cancelledOrder(cancel('rejected', 1957, 0), [refund(1957)]));
  plugin.validateSeed(ctx, cancelledOrder(cancel('account_holder', 499, 1458), [refund(499)], 'preparing'));
  plugin.validateSeed(ctx, cancelledOrder(cancel('account_holder', 1957, 0), [refund(1957)]));
  rejected(cancelledOrder(cancel('account_holder', 499, 1458), [refund(499)]), 'partial refund for a cancellation while submitted');
  rejected(cancelledOrder(cancel('account_holder', 1957, 0), [refund(1957)], 'preparing'), 'full refund for a cancellation while preparing');
  rejected(cancelledOrder(cancel('rejected', 1957, 0), []), 'refund summary without a refund record');
  rejected(cancelledOrder(cancel('rejected', 1, 1956), [refund(1)]), 'rejection with a partial refund');
  rejected(cancelledOrder(cancel('rejected', 1957, 500), [refund(1957)]), 'kept amount does not match');
  rejected(cancelledOrder(cancel('account_holder', 700, 1257), [refund(700)], 'preparing'), 'holder cancellation amount matches no stage');
});

test('History an order cannot be changed at a time before its recorded history', () => {
  const f = fixture({ now: '2026-12-03T11:30:00-05:00' });
  assert.equal(f.call('plateway.orders.cancel.preview', { order_id: 'o-11' }).status, 'invalid_state');
  const before = structuredClone(f.data());
  assert.equal(f.event({ event_id: 'h-1', at: '2026-12-03T11:40:00-05:00', operation: 'order.accepted', payload: { order_id: 'o-11' } }).status, 'invalid_event');
  assert.deepEqual(f.data(), before);
  assert.equal(f.call('plateway.orders.rate', { order_id: 'o-10', stars: 4 }).status, 'committed');
});

test('History an account that has used every ID gets a clear refusal and nothing changes', () => {
  const seed = baseSeed(); const o = deliveredOrder(); o.id = 'o-999999999'; seed.orders.push(o);
  const f = fixture({ seed, now: '2026-12-04T11:30:00-05:00' });
  f.call('plateway.cart.add_item', { item_id: 'mi-2', option_ids: [], quantity: 1 });
  const args = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 0 };
  const before = structuredClone(f.data());
  const out = f.call('plateway.orders.place', { ...args, token: f.call('plateway.checkout.preview', args).token });
  assert.equal(out.status, 'invalid_state');
  assert.match(out.message, /no further/);
  assert.deepEqual(f.data(), before);
});
