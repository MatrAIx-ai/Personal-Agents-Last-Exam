'use strict';
const { fail } = require('./util.cjs');
const { restaurantOf, addressOf, servesZone } = require('./catalog.cjs');
const { priceLine } = require('./cart.cjs');
const { totals, lineTax } = require('./pricing.cjs');
const { deliveryPlan } = require('./schedule.cjs');
const { localParts, ms, toIso } = require('./time.cjs');
const { token } = require('./tokens.cjs');

function cardExpired(data, card, now) {
  const [year, month] = localParts(ms(now), data.time_zone).date.split('-').map(Number);
  return card.exp_year < year || (card.exp_year === year && card.exp_month < month);
}
function cardOf(data, id) {
  return data.cards.find(c => c.id === id) || fail('not_found', 'Card ' + id + ' does not exist.');
}

function checkoutChanges(ctx, data, args) {
  if (!data.cart.lines.length) fail('cart_empty', 'The cart is empty.');
  const restaurant = restaurantOf(data, data.cart.restaurant_id);
  const priced = data.cart.lines.map(line => {
    const p = priceLine(data, line);
    if (!p.available) fail('item_unavailable', p.name + ' is unavailable.');
    return p;
  });
  const address = addressOf(data, args.address_id);
  if (!servesZone(restaurant, address.zone_id)) fail('outside_delivery_area', restaurant.name + ' does not deliver to ' + address.label + '.');
  const plan = deliveryPlan(data, restaurant, address, args.when, ctx.virtual_now);
  const card = cardOf(data, args.card_id);
  if (cardExpired(data, card, ctx.virtual_now)) fail('payment_failed', 'The card has expired.');
  const lines = priced.map(p => ({ id: p.id, item_id: p.item_id, name: p.name, options: p.options, quantity: p.quantity, label: p.label,
    unit_price_cents: p.unit_price_cents, subtotal_cents: p.subtotal_cents, tax_cents: lineTax(p.subtotal_cents) }));
  const t = totals(lines, restaurant.delivery_fee_cents, args.tip_cents);
  const changes = {
    restaurant_id: restaurant.id,
    lines: lines.map(l => ({ id: l.id, item_id: l.item_id, option_ids: l.options.map(o => o.id), label: l.label, quantity: l.quantity,
      unit_price_cents: l.unit_price_cents, subtotal_cents: l.subtotal_cents, tax_cents: l.tax_cents })),
    fees: { delivery_cents: t.delivery_cents, service_cents: t.service_cents, small_order_cents: t.small_order_cents },
    tax_cents: t.tax_cents, tip_cents: t.tip_cents, total_cents: t.total_cents, card_id: card.id, address_id: address.id,
    when: plan.mode === 'asap' ? { mode: 'asap', estimate_minutes: plan.estimate_minutes } : { mode: 'scheduled', delivery_at: plan.delivery_at, release_at: plan.release_at },
  };
  return { restaurant, address, card, plan, lines, totals: t, changes };
}

function tokenArgs(data, args) {
  if (args.when.mode !== 'scheduled') return args;
  return { ...args, when: { mode: 'scheduled', delivery_at: toIso(ms(args.when.delivery_at), data.time_zone) } };
}
function preview(ctx, data, args) {
  const c = checkoutChanges(ctx, data, args);
  return {
    restaurant_id: c.restaurant.id, lines: c.lines,
    fees: { delivery_cents: c.totals.delivery_cents, service_cents: c.totals.service_cents, small_order_cents: c.totals.small_order_cents },
    subtotal_cents: c.totals.subtotal_cents, tax_cents: c.totals.tax_cents, tip_cents: c.totals.tip_cents, total_cents: c.totals.total_cents,
    mode: c.plan.mode, estimate_minutes: c.plan.estimate_minutes, estimated_delivery_at: c.plan.estimated_delivery_at,
    delivery_at: c.plan.delivery_at, release_at: c.plan.release_at,
    token: token(ctx, data, 'checkout', tokenArgs(data, args), c.changes),
  };
}
module.exports = { preview, checkoutChanges, cardOf, cardExpired, tokenArgs };
