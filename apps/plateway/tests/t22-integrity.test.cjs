'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');

const ctx = { app_id: 'plateway', virtual_now: '2026-12-04T11:30:00-05:00', binding };
const rejected = (seed, label) => assert.throws(() => plugin.validateSeed(ctx, seed), e => e.code === 'invalid_seed', label);
const withOrder = mutate => { const s = baseSeed(); const o = deliveredOrder(); mutate(o, s); s.orders.push(o); return s; };

test('Integrity seeded refunds must equal what the App would have refunded', () => {
  rejected(withOrder(o => { o.refunds.push({ id: 'rf-1', amount_cents: 1957, reason: 'cancelled', line_id: null, at: '2026-12-03T19:00:00-05:00' }); }), 'cancellation refund on a delivered order');
  rejected(withOrder(o => { o.lines[0].report = { kind: 'missing', at: '2026-12-03T19:00:00-05:00' }; o.refunds.push({ id: 'rf-1', amount_cents: 1, reason: 'line_reported', line_id: 'ol-1', at: '2026-12-03T19:00:00-05:00' }); }), 'partial line refund');
  plugin.validateSeed(ctx, withOrder(o => { o.lines[0].report = { kind: 'missing', at: '2026-12-03T19:00:00-05:00' }; o.refunds.push({ id: 'rf-1', amount_cents: 656, reason: 'line_reported', line_id: 'ol-1', at: '2026-12-03T19:00:00-05:00' }); }));
  rejected(withOrder(o => {
    Object.assign(o, { status: 'cancelled', delivered_at: null, cancellation: { at: '2026-12-03T18:05:00-05:00', reason: 'rejected', refunded_cents: 1957, kept_cents: 0 } });
    o.refunds.push({ id: 'rf-1', amount_cents: 1900, reason: 'cancelled', line_id: null, at: '2026-12-03T18:05:00-05:00' });
  }), 'cancellation refund different from the cancellation record');
});

test('Integrity a report or rating cannot come before the recorded delivery', () => {
  const seed = baseSeed(); seed.orders.push(deliveredOrder());
  const f = fixture({ seed, now: '2026-12-03T18:30:00-05:00' });
  assert.equal(f.call('plateway.orders.report_issue', { order_id: 'o-21', lines: [{ line_id: 'ol-1', kind: 'missing' }] }).status, 'invalid_state');
  assert.equal(f.call('plateway.orders.rate', { order_id: 'o-21', stars: 4 }).status, 'invalid_state');
  assert.deepEqual(f.data().orders[0].refunds, []);
});

test('Integrity seeded counters stay within supported ranges and every order has an estimate', () => {
  rejected(withOrder(o => { o.id = 'o-9007199254740992'; }), 'order counter too large');
  rejected(withOrder(o => { o.lines[0].id = 'ol-1000000000'; }), 'line counter too large');
  rejected(withOrder(o => { o.estimated_delivery_at = null; }), 'missing estimate');
  plugin.validateSeed(ctx, withOrder(o => { o.id = 'o-999999999'; }));
});
