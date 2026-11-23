'use strict';
const { fixture } = require('./harness.cjs');
const { baseSeed } = require('./seeds.cjs');
const NOW = '2026-12-04T11:30:00-05:00';
const checkout = (extra = {}) => ({ address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 200, ...extra });

function placed({ seed = baseSeed(), items = [['mi-1', ['op-1']], ['mi-1', ['op-2']]], when, now = NOW } = {}) {
  const f = fixture({ seed, now });
  for (const [item_id, option_ids] of items) f.call('plateway.cart.add_item', { item_id, option_ids, quantity: 1 });
  const args = checkout(when ? { when } : {});
  const p = f.call('plateway.checkout.preview', args);
  if (p.status !== 'ok') throw new Error('preview failed: ' + p.status);
  const out = f.call('plateway.orders.place', { ...args, token: p.token });
  if (out.status !== 'committed') throw new Error('place failed: ' + out.status);
  f.orderId = out.order_id;
  return f;
}
let n = 0;
const ev = (operation, at, payload) => ({ event_id: 'ev-' + (++n), at, operation, payload });
const order = (f, id = f.orderId) => f.call('plateway.orders.get', { order_id: id }).order;
const stored = (f, id = f.orderId) => f.data().orders.find(o => o.id === id);
const kinds = f => f.data().notices.map(x => x.kind);
module.exports = { placed, ev, order, stored, kinds, checkout, NOW };
