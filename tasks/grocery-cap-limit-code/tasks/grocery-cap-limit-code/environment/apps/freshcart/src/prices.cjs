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

function replaceUnavailable(order, itemId, offer) {
  const lines = order.lines.filter(row => row.item_id === itemId);
  if (!lines.length) return false;
  const qty = lines.reduce((sum, row) => sum + row.qty, 0) || 1;
  let remaining = offer.delta_cents;
  lines.forEach((line, index) => {
    const share = index === lines.length - 1 ? remaining : Math.round(offer.delta_cents * line.qty / qty);
    remaining -= share;
    line.item_id = offer.item_id;
    line.name = offer.label;
    line.unit_cents += line.qty ? Math.round(share / line.qty) : 0;
    line.line_cents += share;
  });
  order.subtotal_cents += offer.delta_cents;
  order.total_cents += offer.delta_cents;
  return true;
}

module.exports = { itemById, subtotal, withDelivery, pricedLines, replaceUnavailable };
