'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');
const { placed } = require('./flows.cjs');

const delivered = (now = '2026-12-04T11:30:00-05:00', order = deliveredOrder()) => {
  const seed = baseSeed(); seed.orders.push(order);
  return fixture({ seed, now });
};
const report = (f, lines, order_id = 'o-21') => f.call('plateway.orders.report_issue', { order_id, lines });
const get = f => f.call('plateway.orders.get', { order_id: 'o-21' }).order;

test('T12 reporting a delivered line refunds its subtotal and tax once, with a notice', () => {
  const f = delivered();
  assert.equal(report(f, [{ line_id: 'ol-1', kind: 'missing' }]).status, 'committed');
  const o = get(f);
  assert.deepEqual(o.refunds.map(r => [r.amount_cents, r.reason, r.line_id]), [[656, 'line_reported', 'ol-1']]);
  assert.deepEqual(o.lines[0].report.kind, 'missing');
  assert.deepEqual(f.data().notices.map(n => [n.kind, n.line_id]), [['notice.item_refunded', 'ol-1']]);
  assert.equal(report(f, [{ line_id: 'ol-1', kind: 'wrong' }]).status, 'duplicate_request');
  assert.equal(report(f, [{ line_id: 'ol-2', kind: 'wrong' }, { line_id: 'ol-1', kind: 'missing' }]).status, 'duplicate_request');
  assert.equal(get(f).refunds.length, 1);
});

test('T12 reporting both lines refunds exactly their subtotals and taxes; totals never exceed the charge', () => {
  const f = delivered();
  report(f, [{ line_id: 'ol-1', kind: 'missing' }, { line_id: 'ol-2', kind: 'wrong' }]);
  const o = get(f);
  assert.equal(o.refunded_cents, 1312);
  assert.ok(o.refunded_cents <= o.charge.amount_cents);
});

test('T12 the same line twice, unknown and removed lines, and an undelivered order are rejected with no refund', () => {
  const f = delivered();
  assert.equal(report(f, [{ line_id: 'ol-1', kind: 'missing' }, { line_id: 'ol-1', kind: 'wrong' }]).status, 'invalid_arguments');
  assert.equal(report(f, [{ line_id: 'ol-404', kind: 'missing' }]).status, 'not_found');
  assert.equal(report(f, []).status, 'invalid_arguments');
  const removed = deliveredOrder();
  removed.lines[1] = { ...removed.lines[1], removed: true, removed_reason: 'unavailable', removed_at: '2026-12-03T18:10:00-05:00' };
  removed.refunds.push({ id: 'rf-1', amount_cents: 656, reason: 'line_unavailable', line_id: 'ol-2', at: '2026-12-03T18:10:00-05:00' });
  assert.equal(report(delivered(undefined, removed), [{ line_id: 'ol-2', kind: 'missing' }]).status, 'invalid_state');
  const g = placed();
  assert.equal(report(g, [{ line_id: 'ol-1', kind: 'missing' }], 'o-1').status, 'invalid_state');
  assert.deepEqual(get(f).refunds, []);
});

test('T12 the 48-hour window includes its last instant', () => {
  assert.equal(report(delivered('2026-12-05T18:41:00-05:00'), [{ line_id: 'ol-1', kind: 'missing' }]).status, 'committed');
  assert.equal(report(delivered('2026-12-05T18:41:01-05:00'), [{ line_id: 'ol-1', kind: 'missing' }]).status, 'window_closed');
});
