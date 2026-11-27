'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');
const minimal = require('../fixtures/minimal.json');

const ctx = { app_id: 'plateway', virtual_now: '2026-12-04T11:30:00-05:00', binding };
const rejected = (seed, label) => assert.throws(() => plugin.validateSeed(ctx, seed), e => e.code === 'invalid_seed', label);
const withOrder = mutate => { const s = baseSeed(); const o = deliveredOrder(); mutate(o, s); s.orders.push(o); return s; };

test('Consistency an order cannot change before its recorded submission even with a sparse timeline', () => {
  const seed = structuredClone(minimal);
  Object.assign(seed.orders.find(o => o.id === 'o-12'), { status: 'submitted', submitted_at: '2026-12-04T18:15:00-05:00', accept_by: '2026-12-04T18:35:00-05:00' });
  const f = fixture({ seed, now: '2026-12-04T18:10:00-05:00' });
  assert.equal(f.call('plateway.orders.cancel.preview', { order_id: 'o-12' }).status, 'invalid_state');
  assert.equal(f.event({ event_id: 'c-1', at: '2026-12-04T18:11:00-05:00', operation: 'order.accepted', payload: { order_id: 'o-12' } }).status, 'invalid_event');
});

test('Consistency seeded reports need a delivered order, release reasons need a scheduled order, ratings follow delivery', () => {
  rejected(withOrder(o => {
    Object.assign(o, { status: 'preparing', delivered_at: null });
    o.lines[0].report = { kind: 'missing', at: '2026-12-03T18:30:00-05:00' };
    o.refunds.push({ id: 'rf-1', amount_cents: 656, reason: 'line_reported', line_id: 'ol-1', at: '2026-12-03T18:30:00-05:00' });
  }), 'reported line on an undelivered order');
  rejected(withOrder(o => {
    Object.assign(o, { status: 'cancelled', delivered_at: null, cancellation: { at: '2026-12-03T18:05:00-05:00', reason: 'closed_at_release', refunded_cents: 1957, kept_cents: 0 } });
    o.refunds.push({ id: 'rf-1', amount_cents: 1957, reason: 'cancelled', line_id: null, at: '2026-12-03T18:05:00-05:00' });
  }), 'release reason on an ASAP order');
  rejected(withOrder(o => { o.rating = { stars: 4, text: null, at: '2026-12-03T18:30:00-05:00' }; }), 'rating before delivery');
});

test('Consistency at the ID limit reads still show due timers; only writes are refused, and nothing changes', () => {
  const seed = structuredClone(minimal); seed.issued = { n: 999999999 };
  const f = fixture({ seed, now: '2026-12-04T18:36:00-05:00' });
  assert.equal(f.call('plateway.account.get', {}).status, 'ok');
  assert.equal(f.call('plateway.orders.get', { order_id: 'o-12' }).order.status, 'cancelled');
  const before = structuredClone(f.data());
  assert.equal(f.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1 }).status, 'invalid_state');
  assert.deepEqual(f.data(), before);
});

test('Consistency a holder cancellation works on a sparse-timeline seed and records the stage it was made in', () => {
  for (const timeline of [[{ at: '2026-12-04T11:12:00-05:00', status: 'submitted', note: 'Order placed' }], []]) {
    const seed = structuredClone(minimal);
    seed.orders.find(o => o.id === 'o-11').timeline = timeline;
    const f = fixture({ seed, now: '2026-12-04T11:40:00-05:00' });
    const preview = f.call('plateway.orders.cancel.preview', { order_id: 'o-11' });
    assert.equal(preview.refund_cents, 549);
    assert.equal(f.call('plateway.orders.cancel.confirm', { order_id: 'o-11', token: preview.token }).status, 'committed');
    const stored = f.data().orders.find(o => o.id === 'o-11');
    assert.deepEqual([stored.status, stored.cancellation.stage, stored.cancellation.refunded_cents], ['cancelled', 'preparing', 549]);
  }
});

test('Consistency a seeded cancellation stage, when given, decides the holder refund rule', () => {
  const seed = (stage, amount) => {
    const s = baseSeed(); const o = deliveredOrder();
    Object.assign(o, { status: 'cancelled', delivered_at: null, refunds: [{ id: 'rf-1', amount_cents: amount, reason: 'cancelled', line_id: null, at: '2026-12-03T18:05:00-05:00' }],
      cancellation: { at: '2026-12-03T18:05:00-05:00', reason: 'account_holder', stage, refunded_cents: amount, kept_cents: 1957 - amount } });
    o.timeline = [o.timeline[0]];
    s.orders.push(o); return s;
  };
  plugin.validateSeed(ctx, seed('preparing', 499));
  plugin.validateSeed(ctx, seed('submitted', 1957));
  rejected(seed('submitted', 499), 'stage says submitted, refund says preparing');
});

test('Consistency a seeded cancellation stage must fit its reason and cannot follow a recorded pickup', () => {
  const seed = (reason, stage, extraTimeline) => {
    const s = baseSeed(); const o = deliveredOrder();
    const amount = reason === 'account_holder' && stage === 'preparing' ? 499 : 1957;
    Object.assign(o, { status: 'cancelled', delivered_at: null, refunds: [{ id: 'rf-1', amount_cents: amount, reason: 'cancelled', line_id: null, at: '2026-12-03T18:30:00-05:00' }],
      cancellation: { at: '2026-12-03T18:30:00-05:00', reason, ...(stage ? { stage } : {}), refunded_cents: amount, kept_cents: 1957 - amount } });
    o.timeline = [o.timeline[0], ...(extraTimeline || []), { at: '2026-12-03T18:30:00-05:00', status: 'cancelled', note: 'Cancelled' }];
    s.orders.push(o); return s;
  };
  plugin.validateSeed(ctx, seed('rejected', 'submitted'));
  rejected(seed('rejected', 'picked_up'), 'restaurant rejection after pickup');
  rejected(seed('rejected', 'preparing'), 'restaurant rejection while preparing');
  rejected(seed('account_holder', 'preparing', [{ at: '2026-12-03T18:20:00-05:00', status: 'picked_up', note: 'Picked up' }]), 'cancellation after a recorded pickup');
  plugin.validateSeed(ctx, seed('account_holder', 'preparing'));
  plugin.validateSeed(ctx, seed('last_line_unavailable', 'preparing'));
});

test('Consistency an active order cannot carry a recorded pickup or delivery, and unknown timeline statuses leave the stage open', () => {
  const live = structuredClone(minimal);
  live.orders.find(o => o.id === 'o-11').timeline.push({ at: '2026-12-04T11:20:00-05:00', status: 'picked_up', note: 'Picked up' });
  rejected(live, 'preparing order with a recorded pickup');
  const s = baseSeed(); const o = deliveredOrder();
  Object.assign(o, { status: 'cancelled', delivered_at: null, refunds: [{ id: 'rf-1', amount_cents: 1957, reason: 'cancelled', line_id: null, at: '2026-12-03T18:05:00-05:00' }],
    cancellation: { at: '2026-12-03T18:05:00-05:00', reason: 'account_holder', refunded_cents: 1957, kept_cents: 0 } });
  o.timeline = [{ at: '2026-12-03T18:00:00-05:00', status: 'placed', note: 'Order placed' }, { at: '2026-12-03T18:05:00-05:00', status: 'cancelled', note: 'Cancelled' }];
  s.orders.push(o);
  plugin.validateSeed(ctx, s);
});
