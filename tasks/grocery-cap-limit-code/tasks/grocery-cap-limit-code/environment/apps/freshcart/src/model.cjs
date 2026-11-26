'use strict';
const { fail, references } = require('./domain-utils.cjs');
const { subtotal, withDelivery } = require('./prices.cjs');

function lineSum(lines) {
  return lines.reduce((sum, line) => sum + line.line_cents, 0);
}

function unique(rows, label) {
  const ids = rows.map(row => row.id);
  if (new Set(ids).size !== ids.length) fail('invalid_seed', 'Duplicate ' + label + ' id.');
}

function validateSeed(ctx, data) {
  references(ctx, data);
  if (!Number.isInteger(data.delivery_cents) || data.delivery_cents < 0) fail('invalid_seed', 'Delivery must be whole cents.');
  if (data.tax_cents !== 0) fail('invalid_seed', 'This fixture has no tax.');
  if (!/^\d{5}$/.test(data.billing_zip)) fail('invalid_seed', 'Billing ZIP must be five digits.');
  if (!Number.isInteger(data.card_limit_cents) || data.card_limit_cents < 0) fail('invalid_seed', 'Card limit must be whole cents.');
  unique(data.catalog, 'catalog');
  unique(data.payment_methods, 'payment method');
  unique(data.orders, 'order');
  unique(data.checkout_attempts, 'checkout attempt');
  unique(data.payment_selections, 'payment selection');
  unique(data.substitutions, 'substitution');
  const ids = new Set(data.catalog.map(item => item.id));
  for (const item of data.catalog) {
    if (!Number.isInteger(item.unit_cents) || item.unit_cents < 0) fail('invalid_seed', 'Prices are whole cents.');
  }
  for (const line of [...data.shared_list, ...data.cart]) {
    if (!ids.has(line.item_id) || !Number.isInteger(line.qty) || line.qty < 1) fail('invalid_seed', 'List line is not in the catalog.');
  }
  for (const order of data.orders) {
    if (Date.parse(order.confirmed_at) > Date.parse(ctx.virtual_now)) fail('invalid_seed', 'An order is dated after the clock.');
    const goods = lineSum(order.lines);
    if (order.subtotal_cents !== goods) fail('invalid_seed', 'Order subtotal does not match its lines.');
    if (order.total_cents !== goods + order.delivery_cents) fail('invalid_seed', 'Order total does not match its lines.');
    if (!Number.isInteger(order.confirmed_total_cents) || order.confirmed_total_cents < 0) fail('invalid_seed', 'Order confirmation total is missing.');
  }
  if (data.shared_list.length) {
    const expected = withDelivery(data, subtotal(data, data.shared_list));
    if (data.list_total_cents !== expected) fail('invalid_seed', 'List total does not match the catalog.');
  }
}

function records(data) {
  return [...data.catalog, ...data.payment_methods, ...data.orders];
}

module.exports = {
  validateSeed,
  records,
  objects: data => records(data).map(row => row.id),
  references: () => [],
  assetReferences: () => []
};
