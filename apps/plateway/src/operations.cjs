'use strict';
const { fail, clone, PROJECTION } = require('./util.cjs');
const catalog = require('./catalog.cjs');
const cart = require('./cart.cjs');
const checkout = require('./checkout.cjs');
const orders = require('./orders.cjs');
const { applyDueTimers } = require('./timers.cjs');
const after = require('./after.cjs');
function maskCard(card) {
  return { id: card.id, brand: card.brand, masked_number: '•••• ' + card.last4, exp_month: card.exp_month, exp_year: card.exp_year };
}
function accountGet(ctx, data) {
  return {
    holder: clone(data.holder),
    addresses: data.addresses.map(a => ({ id: a.id, label: a.label, line1: a.line1, zone_id: a.zone_id })),
    cards: data.cards.map(maskCard),
    now: ctx.virtual_now,
    time_zone: data.time_zone,
  };
}
const READS = {
  'plateway.account.get': accountGet,
  'plateway.restaurants.search': catalog.search,
  'plateway.restaurants.get': catalog.getRestaurant,
  'plateway.menu_items.get': catalog.getItem,
  'plateway.cart.get': (ctx, data) => cart.view(data),
  'plateway.checkout.preview': checkout.preview,
  'plateway.orders.list': orders.list,
  'plateway.orders.get': orders.get,
  'plateway.orders.cancel.preview': orders.cancelPreview,
};
const WRITES = {
  'plateway.cart.add_item': cart.addItem,
  'plateway.cart.update_item': cart.updateItem,
  'plateway.cart.remove_item': cart.removeItem,
  'plateway.orders.place': orders.place,
  'plateway.orders.cancel.confirm': orders.cancelConfirm,
  'plateway.orders.report_issue': after.reportIssue,
  'plateway.orders.rate': after.rate,
};
function handleTool(ctx, data, name, args) {
  const read = READS[name];
  if (read) {
    const projected = clone(data);
    projected[PROJECTION] = true;
    applyDueTimers(projected, ctx.virtual_now);
    return { data, result: read(ctx, projected, args) };
  }
  const write = WRITES[name];
  if (write) {
    applyDueTimers(data, ctx.virtual_now);
    return { data, result: write(ctx, data, args) };
  }
  fail('unknown_tool', 'Unknown Plateway operation.');
}
module.exports = { handleTool };
