'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');
const { placed } = require('./flows.cjs');

const delivered = now => { const seed = baseSeed(); seed.orders.push(deliveredOrder()); return fixture({ seed, now: now || '2026-12-04T11:30:00-05:00' }); };
const rate = (f, args) => f.call('plateway.orders.rate', { order_id: 'o-21', ...args });

test('T13 a delivered order can be rated once', () => {
  const f = delivered();
  assert.equal(rate(f, { stars: 5, text: 'Hot and on time' }).status, 'committed');
  assert.deepEqual(f.call('plateway.orders.get', { order_id: 'o-21' }).order.rating, { stars: 5, text: 'Hot and on time', at: '2026-12-04T11:30:00-05:00' });
  assert.equal(rate(f, { stars: 4 }).status, 'duplicate_request');
  assert.equal(f.data().notices.length, 0);
});

test('T13 undelivered orders, the 30-day window and text limits', () => {
  assert.equal(rate(placed(), { order_id: 'o-1', stars: 3 }).status, 'invalid_state');
  assert.equal(rate(delivered('2027-01-02T18:41:00-05:00'), { stars: 3 }).status, 'committed');
  assert.equal(rate(delivered('2027-01-02T18:41:01-05:00'), { stars: 3 }).status, 'window_closed');
  assert.equal(rate(delivered(), { stars: 0 }).status, 'invalid_arguments');
  assert.equal(rate(delivered(), { stars: 4, text: 'é'.repeat(500) }).status, 'committed');
  assert.equal(rate(delivered(), { stars: 4, text: 'x'.repeat(501) }).status, 'invalid_arguments');
});
