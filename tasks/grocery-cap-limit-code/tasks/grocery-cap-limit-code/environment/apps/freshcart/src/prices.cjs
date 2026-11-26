'use strict';
const { fail } = require('./domain-utils.cjs');

function itemById(data, id) {
  const item = data.catalog.find(row => row.id === id);
  if (!item) fail('invalid_arguments', 'Unknown catalog item.');
  return item;
}

function subtotal(data, lines) {
  let cents = 0;
  for (const line of lines) {
    if (!line || typeof line.item_id !== 'string' || !Number.isInteger(line.qty) || line.qty < 1) {
      fail('invalid_arguments', 'Each line needs an item and a positive quantity.');
    }
    cents += itemById(data, line.item_id).unit_cents * line.qty;
  }
  return cents;
}

function withDelivery(data, goods) {
  return goods + data.delivery_cents;
}

function pricedLines(data, lines) {
  return lines.map(line => {
    const item = itemById(data, line.item_id);
    return {
      item_id: item.id,
      name: item.name,
      role: item.role,
      qty: line.qty,
      unit_cents: item.unit_cents,
      line_cents: item.unit_cents * line.qty
    };
  });
}

module.exports = { itemById, subtotal, withDelivery, pricedLines };
