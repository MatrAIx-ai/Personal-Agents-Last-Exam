'use strict';
const { fail, textLength } = require('./util.cjs');
const { totals } = require('./pricing.cjs');
const { ms } = require('./time.cjs');
const APP = 'plateway';
const ACCEPT_LIMIT_MS = 20 * 60000;
const LINE_REASON = { line_reported: 'report', line_unavailable: 'unavailable', line_removed_at_release: 'release' };

const invalid = message => fail('invalid_seed', message);
function unique(items, what) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) invalid('Duplicate ' + what + ' ID ' + item.id + '.');
    seen.add(item.id);
  }
  return new Map(items.map(i => [i.id, i]));
}
function checkOptions(dish, optionIds, where) {
  const known = new Set(dish.option_groups.flatMap(g => g.options.map(o => o.id)));
  for (const id of optionIds) if (!known.has(id)) invalid(where + ' names option ' + id + ' not on dish ' + dish.id + '.');
}

function checkZone(zone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { invalid('Unknown time zone ' + zone + '.'); }
}
function checkStatusFields(o) {
  const need = (field, what) => { if (o[field] === null) invalid('Order ' + o.id + ' is ' + o.status + ' but has no ' + what + '.'); };
  const none = (field, what) => { if (o[field] !== null) invalid('Order ' + o.id + ' is ' + o.status + ' but has ' + what + '.'); };
  if (o.mode === 'scheduled') {
    need('delivery_at', 'delivery time'); need('release_at', 'release time');
    if (!(ms(o.placed_at) < ms(o.release_at) && ms(o.release_at) < ms(o.delivery_at))) invalid('Order ' + o.id + ' must be placed before its release time, and released before its delivery time.');
  } else {
    none('delivery_at', 'a scheduled delivery time'); none('release_at', 'a release time');
    if (o.status === 'scheduled') invalid('Order ' + o.id + ' is scheduled but not in scheduled mode.');
  }
  if (o.status === 'scheduled') { none('submitted_at', 'a submission time'); none('accept_by', 'an acceptance limit'); }
  else if (o.status !== 'cancelled' || o.submitted_at !== null) {
    need('submitted_at', 'submission time');
    need('accept_by', 'acceptance limit');
    if (ms(o.accept_by) - ms(o.submitted_at) !== ACCEPT_LIMIT_MS) invalid('Order ' + o.id + ' acceptance limit is not 20 minutes after submission.');
  }
  need('estimated_delivery_at', 'estimated delivery time');
  if (o.status === 'delivered') need('delivered_at', 'delivery time'); else none('delivered_at', 'a delivery time');
  if (o.status === 'cancelled') need('cancellation', 'cancellation'); else none('cancellation', 'a cancellation');
  if (o.rating && o.status !== 'delivered') invalid('Order ' + o.id + ' is rated but not delivered.');
  if (LATER[o.status] && o.timeline.some(t => LATER[o.status].includes(t.status))) invalid('Order ' + o.id + ' is ' + o.status + ' but its timeline records a later status.');
  if (o.rating && o.delivered_at && ms(o.rating.at) < ms(o.delivered_at)) invalid('Order ' + o.id + ' is rated before its delivery.');
  const order = [o.placed_at, o.submitted_at, o.delivered_at].filter(Boolean).map(ms);
  if (order.some((t, i) => i && t < order[i - 1])) invalid('Order ' + o.id + ' times are out of order.');
}
function checkRefundLines(o) {
  const lines = new Map(o.lines.map(l => [l.id, l]));
  const refundedLines = new Set();
  let prior = 0;
  for (const r of o.refunds) {
    if (r.line_id === null) {
      if (r.reason !== 'cancelled') invalid('Refund ' + r.id + ' needs a line.');
      if (o.status !== 'cancelled' || r.amount_cents !== o.cancellation.refunded_cents || r !== o.refunds[o.refunds.length - 1]) invalid('Refund ' + r.id + ' does not match the cancellation.');
      prior += r.amount_cents;
      continue;
    }
    const line = lines.get(r.line_id);
    if (!line || r.reason === 'cancelled') invalid('Refund ' + r.id + ' names an unknown line.');
    if (refundedLines.has(line.id)) invalid('Line ' + line.id + ' is refunded twice.');
    refundedLines.add(line.id);
    const expected = LINE_REASON[r.reason];
    const ok = expected === 'report' ? line.report !== null && !line.removed : line.removed && line.removed_reason === expected;
    const amount = Math.min(line.subtotal_cents + line.tax_cents, o.charge.amount_cents - prior);
    if (!ok || r.amount_cents !== amount) invalid('Refund ' + r.id + ' does not match line ' + line.id + '.');
    prior += r.amount_cents;
  }
  for (const line of o.lines) {
    const refundable = line.subtotal_cents + line.tax_cents > 0 && o.refunds.reduce((s, r) => s + r.amount_cents, 0) < o.charge.amount_cents;
    if ((line.report || line.removed) && !refundedLines.has(line.id) && o.status !== 'cancelled' && refundable) invalid('Line ' + line.id + ' has no matching refund.');
    if (line.report && line.removed) invalid('Line ' + line.id + ' cannot be both removed and reported.');
    if (line.report && o.status !== 'delivered') invalid('Line ' + line.id + ' is reported on an order that was not delivered.');
  }
}
const RELEASE_REASONS = ['closed_at_release', 'unavailable_at_release'];
const ORDER_STATUSES = ['scheduled', 'submitted', 'preparing', 'picked_up', 'delivered'];
const LATER = { scheduled: ['submitted', 'preparing', 'picked_up', 'delivered'], submitted: ['picked_up', 'delivered'], preparing: ['picked_up', 'delivered'], picked_up: ['delivered'] };
const STAGES_BY_REASON = {
  account_holder: ['scheduled', 'submitted', 'preparing'], rejected: ['submitted'], not_accepted: ['submitted'],
  closed_at_release: ['scheduled'], unavailable_at_release: ['scheduled'], last_line_unavailable: ['submitted', 'preparing'],
};
function checkCancellation(o) {
  if (o.status !== 'cancelled') return;
  const c = o.cancellation;
  const lineRefunds = o.refunds.filter(r => r.line_id !== null).reduce((s, r) => s + r.amount_cents, 0);
  const cancelRefunds = o.refunds.filter(r => r.line_id === null).reduce((s, r) => s + r.amount_cents, 0);
  const remaining = o.charge.amount_cents - lineRefunds;
  const end = o.timeline.findIndex(t => t.status === 'cancelled');
  const stage = o.timeline.slice(0, end < 0 ? o.timeline.length : end).map(t => t.status).filter(s => ORDER_STATUSES.includes(s)).pop();
  if (RELEASE_REASONS.includes(c.reason) && o.mode !== 'scheduled') invalid('Order ' + o.id + ' was not scheduled, so it cannot be cancelled at release.');
  if (stage === 'picked_up' || stage === 'delivered') invalid('Order ' + o.id + ' is cancelled after it was ' + stage.replace('_', ' ') + '.');
  if (c.stage && !STAGES_BY_REASON[c.reason].includes(c.stage)) invalid('Order ' + o.id + ' cannot be cancelled for ' + c.reason + ' while ' + c.stage + '.');
  const known = c.stage || stage;
  const partial = Math.min(o.fees.delivery_cents + o.tip_cents, remaining);
  const holder = known === 'preparing' ? [partial] : known === 'scheduled' || known === 'submitted' ? [remaining] : known ? [] : [remaining, partial];
  const allowed = c.reason === 'account_holder' ? holder : [remaining];
  if (!allowed.includes(c.refunded_cents) || cancelRefunds !== c.refunded_cents || c.kept_cents !== remaining - c.refunded_cents) invalid('Order ' + o.id + ' cancellation does not match its refunds.');
}
const overLimit = (text, limit) => text !== null && text !== undefined && textLength(text) > limit;

const COUNTER = /^(o|ol|rf|n)-([0-9]+)$/;
const MAX_COUNTER = 999999999;
function checkCounters(ids) {
  for (const id of ids) { const m = COUNTER.exec(id); if (m && Number(m[2]) > MAX_COUNTER) invalid('ID ' + id + ' is beyond the supported counter range.'); }
}

function validateSeed(ctx, data) {
  const accounts = ctx.binding?.accounts || [];
  if (!accounts.some(a => a.app_id === APP && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id)) {
    invalid('The seed account and owner must match an account row in the run binding.');
  }
  if (data.holder.person_id !== data.owner_person_id) invalid('The account holder must be the bound owner.');
  checkZone(data.time_zone);
  const zones = unique(data.zones, 'zone');
  const restaurants = unique(data.restaurants, 'restaurant');
  const dishes = unique(data.dishes, 'dish');
  unique(data.addresses, 'address');
  unique(data.cards, 'card');
  unique(data.orders, 'order');
  unique(data.notices, 'notice');
  unique(data.orders.flatMap(o => o.lines).concat(data.cart.lines), 'line');
  unique(data.orders.flatMap(o => o.refunds), 'refund');
  checkCounters([...data.orders.map(o => o.id), ...data.orders.flatMap(o => o.lines.map(l => l.id)), ...data.cart.lines.map(l => l.id), ...data.orders.flatMap(o => o.refunds.map(r => r.id)), ...data.notices.map(n => n.id)]);
  const addresses = new Map(data.addresses.map(a => [a.id, a]));
  const cards = new Map(data.cards.map(c => [c.id, c]));
  for (const a of data.addresses) if (!zones.has(a.zone_id)) invalid('Address ' + a.id + ' names an unknown zone.');
  for (const r of data.restaurants) for (const z of r.zones) if (!zones.has(z.zone_id)) invalid('Restaurant ' + r.id + ' names an unknown zone.');
  for (const d of data.dishes) {
    if (!restaurants.has(d.restaurant_id)) invalid('Dish ' + d.id + ' names an unknown restaurant.');
    for (const g of d.option_groups) if (g.min > g.max || (g.required && g.min < 1) || g.min > g.options.length) invalid('Option group ' + g.id + ' has inconsistent limits.');
    const groupIds = d.option_groups.map(g => g.id), optionIds = d.option_groups.flatMap(g => g.options.map(x => x.id));
    if (new Set(groupIds).size !== groupIds.length || new Set(optionIds).size !== optionIds.length) invalid('Dish ' + d.id + ' repeats an option or group ID.');
  }
  if (data.cart.lines.length) {
    if (!restaurants.has(data.cart.restaurant_id)) invalid('The cart names an unknown restaurant.');
    for (const line of data.cart.lines) {
      const dish = dishes.get(line.item_id);
      if (!dish) invalid('Cart line ' + line.id + ' names an unknown dish.');
      if (dish.restaurant_id !== data.cart.restaurant_id) invalid('Cart lines must come from one restaurant.');
      checkOptions(dish, line.option_ids, 'Cart line ' + line.id);
      try { require('./cart.cjs').selectOptions(dish, line.option_ids); } catch (e) { invalid('Cart line ' + line.id + ' has an invalid option selection.'); }
      if (overLimit(line.label, 40)) invalid('Cart line ' + line.id + ' label is over 40 characters.');
    }
  } else if (data.cart.restaurant_id !== null) invalid('An empty cart has no restaurant.');
  for (const o of data.orders) {
    if (!restaurants.has(o.restaurant_id)) invalid('Order ' + o.id + ' names an unknown restaurant.');
    if (!addresses.has(o.address_id)) invalid('Order ' + o.id + ' names an unknown address.');
    if (!cards.has(o.card_id) || o.charge.card_id !== o.card_id) invalid('Order ' + o.id + ' names an unknown card.');
    for (const line of o.lines) {
      const dish = dishes.get(line.item_id);
      if (!dish || dish.restaurant_id !== o.restaurant_id) invalid('Order line ' + line.id + ' names an unknown dish.');
      checkOptions(dish, line.options.map(x => x.id), 'Order line ' + line.id);
      if (overLimit(line.label, 40)) invalid('Order line ' + line.id + ' label is over 40 characters.');
      const unit = line.unit_price_cents;
      if (line.subtotal_cents !== unit * line.quantity) invalid('Order line ' + line.id + ' subtotal does not recompute.');
    }
    const t = totals(o.lines, o.fees.delivery_cents, o.tip_cents);
    const booked = { subtotal_cents: o.subtotal_cents, tax_cents: o.tax_cents, service_cents: o.fees.service_cents,
      small_order_cents: o.fees.small_order_cents, delivery_cents: o.fees.delivery_cents, tip_cents: o.tip_cents, total_cents: o.total_cents };
    if (JSON.stringify(t) !== JSON.stringify(booked) || o.charge.amount_cents !== o.total_cents) invalid('Order ' + o.id + ' charge does not equal its recomputed total.');
    for (const line of o.lines) if (line.tax_cents !== totals([line], 0, 0).tax_cents) invalid('Order line ' + line.id + ' tax does not recompute.');
    if (o.refunds.reduce((s, r) => s + r.amount_cents, 0) > o.charge.amount_cents) invalid('Order ' + o.id + ' refunds exceed its charge.');
    checkStatusFields(o);
    checkRefundLines(o);
    checkCancellation(o);
    if (o.rating && overLimit(o.rating.text, 500)) invalid('Order ' + o.id + ' rating text is over 500 characters.');
  }
  const orderIds = new Set(data.orders.map(o => o.id));
  for (const n of data.notices) {
    if (!orderIds.has(n.order_id)) invalid('Notice ' + n.id + ' names an unknown order.');
    if (overLimit(n.title, 200) || overLimit(n.body, 20000)) invalid('Notice ' + n.id + ' is over the message limits.');
  }
}
const records = data => [...data.restaurants, ...data.dishes, ...data.orders];
const objects = data => records(data).map(r => r.id);
const references = () => [];
module.exports = { validateSeed, records, objects, references };
