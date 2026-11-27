'use strict';
const { fail, textLength, nextId } = require('./util.cjs');
const { dishOf } = require('./catalog.cjs');
const LABEL_LIMIT = 40;
const CART_LIMIT = 50;

function selectOptions(dish, optionIds) {
  const byId = new Map(dish.option_groups.flatMap(g => g.options.map(o => [o.id, { group: g, option: o }])));
  for (const id of optionIds) if (!byId.has(id)) fail('invalid_option', 'Option ' + id + ' is not offered for ' + dish.name + '.');
  for (const g of dish.option_groups) {
    const chosen = optionIds.filter(id => byId.get(id).group === g).length;
    if (chosen < g.min || chosen > g.max || (g.required && chosen === 0)) {
      fail('invalid_option', g.name + ' needs between ' + g.min + ' and ' + g.max + ' selections.');
    }
  }
  return dish.option_groups.flatMap(g => g.options.filter(o => optionIds.includes(o.id)));
}
function checkLabel(label) {
  if (label !== undefined && label !== null && textLength(label) > LABEL_LIMIT) {
    fail('invalid_arguments', 'A label has at most ' + LABEL_LIMIT + ' characters.');
  }
}
function priceLine(data, line) {
  const dish = dishOf(data, line.item_id);
  const options = selectOptions(dish, line.option_ids);
  const unit = dish.price_cents + options.reduce((s, o) => s + o.price_delta_cents, 0);
  return {
    id: line.id, item_id: dish.id, name: dish.name,
    options: options.map(o => ({ id: o.id, name: o.name, price_delta_cents: o.price_delta_cents })),
    quantity: line.quantity, label: line.label ?? null, unit_price_cents: unit, subtotal_cents: unit * line.quantity, available: dish.available,
  };
}
function view(data) {
  const lines = data.cart.lines.map(l => priceLine(data, l));
  return { restaurant_id: data.cart.restaurant_id, lines, subtotal_cents: lines.reduce((s, l) => s + l.subtotal_cents, 0) };
}
function findLine(data, lineId) {
  return data.cart.lines.find(l => l.id === lineId) || fail('not_found', 'Cart line ' + lineId + ' does not exist.');
}

function addItem(ctx, data, args) {
  const dish = dishOf(data, args.item_id);
  if (data.cart.restaurant_id && data.cart.restaurant_id !== dish.restaurant_id) {
    fail('different_restaurant', 'The cart holds dishes from another restaurant.');
  }
  if (!dish.available) fail('item_unavailable', dish.name + ' is unavailable.');
  selectOptions(dish, args.option_ids);
  checkLabel(args.label);
  if (data.cart.lines.length >= CART_LIMIT) fail('invalid_arguments', 'The cart holds at most ' + CART_LIMIT + ' lines.');
  const line = { id: nextId(data, 'ol'), item_id: dish.id, option_ids: [...args.option_ids], quantity: args.quantity, label: args.label ?? null };
  data.cart.restaurant_id = dish.restaurant_id;
  data.cart.lines.push(line);
  return { line_id: line.id, cart: view(data) };
}
function updateItem(ctx, data, args) {
  const line = findLine(data, args.line_id);
  if (args.option_ids === undefined && args.quantity === undefined && args.label === undefined) {
    fail('invalid_arguments', 'Change at least one of quantity, options or label.');
  }
  const dish = dishOf(data, line.item_id);
  if (args.option_ids !== undefined) { selectOptions(dish, args.option_ids); line.option_ids = [...args.option_ids]; }
  if (args.quantity !== undefined) line.quantity = args.quantity;
  if (args.label !== undefined) { checkLabel(args.label); line.label = args.label; }
  return { cart: view(data) };
}
function removeItem(ctx, data, args) {
  findLine(data, args.line_id);
  data.cart.lines = data.cart.lines.filter(l => l.id !== args.line_id);
  if (!data.cart.lines.length) data.cart.restaurant_id = null;
  return { cart: view(data) };
}
module.exports = { addItem, updateItem, removeItem, view, priceLine, selectOptions };
