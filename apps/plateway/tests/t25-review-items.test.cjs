'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, deliveredOrder } = require('./seeds.cjs');

test('Review item 1: orders placed at the same instant list in a defined order whatever their ID shape', () => {
  const s = baseSeed();
  for (const id of ['o-9', 'o-10', 'o-010', 'order-b', 'order-a']) {
    const o = deliveredOrder({ id });
    o.lines.forEach((l, i) => { l.id = id + '-l' + i; });
    s.orders.push(o);
  }
  const f = fixture({ seed: s });
  const ids = f.call('plateway.orders.list', {}).orders.map(o => o.id).filter(id => ['o-9', 'o-10', 'o-010', 'order-b', 'order-a'].includes(id));
  assert.deepEqual(ids, ['o-10', 'o-010', 'o-9', 'order-b', 'order-a']);
});

test('Review item 2: a 41-character label is refused by the App although the schema allows 80 UTF-16 units', () => {
  const f = fixture();
  const ok = f.call('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1, label: 'x'.repeat(40) });
  assert.equal(ok.status, 'committed');
  const long = f.call('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1, label: 'x'.repeat(41) });
  assert.equal(long.status, 'invalid_arguments');
  const astral = f.call('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1, label: '\u{1F600}'.repeat(40) });
  assert.equal(astral.status, 'committed');
});
