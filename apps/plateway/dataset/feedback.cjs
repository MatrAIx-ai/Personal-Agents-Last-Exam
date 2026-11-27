'use strict';
const { ms, localParts, MINUTE } = require('../src/time.cjs');

const RATINGS = [
  [5, 'Hot and on time.', ['on_time', 'hot']], [5, 'Exactly as ordered.', 'as_ordered'], [4, 'Good, a little late.', 'a_little_late'], [4, 'Tasty; packaging could be better.'], [5, null], [4, null], [5, null],
  [5, 'Driver was friendly and quick.', 'quick'], [4, 'Generous portions.'], [5, 'Our usual, still great.', 'usual'], [4, 'Spice level was spot on.', 'spice'], [3, 'Took longer than the estimate.', 'late'],
  [5, 'Just right for a quiet evening.', 'evening'], [4, null], [5, 'The kids loved it.', 'household'], [3, null], [4, 'Good value for the price.'], [5, 'Arrived earlier than the estimate.', 'early'],
  [4, 'Fresh and well packed.'], [3, 'Fine, but the sides were cold.', 'sides'], [5, 'Really enjoyed it.'], [4, 'A bit salty, otherwise great.'], [5, 'Still warm when it arrived.', 'hot'],
  [4, 'Packed neatly, nothing spilled.'], [2, 'Arrived lukewarm and a bit soggy.', 'hot'], [5, 'Quick lunch, no fuss.', 'quick_lunch'], [4, 'Good, but smaller than last time.', 'repeat_dish'],
];
const LOW = [[2, 'One item never arrived.', 'missing'], [3, 'Refund was quick, but an item was missing.', 'missing_refunded'], [2, 'Wrong dish in the bag.', 'wrong'], [3, 'The rest was good.'], [1, null]];

const HOT = {
  'mi-1': 'Pad Thai', 'mi-2': 'Green Curry', 'mi-3': 'Tom Yum Soup', 'mi-7': 'Dan Dan Noodles', 'mi-8': 'Beef Noodle Soup', 'mi-9': 'Pork and Chive Dumplings',
  'mi-10': 'Scallion Pancake', 'mi-11': 'Kung Pao Chicken', 'mi-12': 'Garlic Bok Choy', 'mi-13': 'Chicken Shawarma Plate', 'mi-14': 'Falafel Wrap', 'mi-15': 'Lamb Kofta',
  'mi-19': 'Carnitas Tacos', 'mi-20': 'Chicken Burrito', 'mi-21': 'Veggie Quesadilla', 'mi-23': 'Elote', 'mi-26': 'Breakfast Sandwich', 'mi-30': 'Latte',
  'mi-31': 'Butter Chicken', 'mi-32': 'Chana Masala', 'mi-33': 'Garlic Naan', 'mi-34': 'Vegetable Samosas', 'mi-35': 'Lamb Biryani',
};
const HOT_SIDES = { 'mi-9': 'Pork and Chive Dumplings', 'mi-10': 'Scallion Pancake', 'mi-12': 'Garlic Bok Choy', 'mi-23': 'Elote', 'mi-33': 'Garlic Naan', 'mi-34': 'Vegetable Samosas' };
const claimsOf = entry => [].concat(entry[2] || []);

const CLAIMS = {
  hot: c => c.hot,
  on_time: c => !c.delayed && c.lateness <= 5,
  early: c => !c.delayed && c.lateness <= -2,
  quick: c => !c.delayed && c.lateness <= 0,
  quick_lunch: c => c.office && c.lunch && !c.delayed && c.lateness <= 0,
  a_little_late: c => c.lateness > 5 && c.lateness <= 25,
  late: c => c.lateness > 5,
  as_ordered: c => !c.changed,
  usual: c => c.earlier >= 3,
  repeat_dish: c => c.repeat,
  spice: c => c.spice,
  household: c => c.home && c.household,
  evening: c => c.evening,
  sides: c => c.hotSide && c.live > 1,
  missing: c => c.reported.includes('missing'),
  missing_refunded: c => c.reported.includes('missing') && c.refunded,
  wrong: c => c.reported.includes('wrong'),
};

function context(seed, order, ratedAt) {
  const rest = seed.restaurants.find(r => r.id === order.restaurant_id);
  const address = seed.addresses.find(a => a.id === order.address_id);
  const travel = rest.zones.find(z => z.zone_id === address.zone_id).travel_minutes;
  const promised = order.mode === 'scheduled' ? ms(order.delivery_at) : ms(order.placed_at) + (rest.prep_minutes + travel) * MINUTE;
  const before = (o, t) => o.id !== order.id && o.restaurant_id === order.restaurant_id && o.delivered_at && ms(o.delivered_at) < t;
  const items = new Set(order.lines.map(l => l.item_id));
  const dishes = new Map(seed.dishes.map(d => [d.id, d]));
  const delivered = localParts(ms(order.delivered_at), seed.time_zone).minutes;
  return {
    lateness: (ms(order.delivered_at) - promised) / MINUTE,
    delayed: order.timeline.some(t => t.note.startsWith('Delayed')),
    office: address.label === 'Office',
    home: address.label === 'Home',
    lunch: localParts(ms(order.placed_at), seed.time_zone).minutes < 15 * 60,
    evening: delivered >= 17 * 60,
    changed: order.lines.some(l => l.removed || l.report),
    earlier: seed.orders.filter(o => before(o, ms(ratedAt))).length,
    repeat: seed.orders.some(o => before(o, ms(order.placed_at)) && o.lines.some(l => items.has(l.item_id))),
    spice: order.lines.some(l => l.options.some(x => dishes.get(l.item_id).option_groups.some(g => /spice/i.test(g.name) && g.options.some(o => o.id === x.id)))),
    household: order.lines.some(l => ['For Sam', 'For Alex'].includes(l.label)),
    hot: order.lines.some(l => !l.removed && HOT[l.item_id]),
    hotSide: order.lines.some(l => !l.removed && HOT_SIDES[l.item_id]),
    live: order.lines.filter(l => !l.removed).length,
    reported: order.lines.filter(l => l.report).map(l => l.report.kind),
    refunded: order.refunds.some(r => r.reason === 'line_reported' && r.amount_cents > 0),
  };
}

const MAX_REPEAT = 4, MAX_NEGATIVE = 3;
const cap = stars => stars <= 2 ? MAX_NEGATIVE : MAX_REPEAT;
function uses(seed) {
  const counts = new Map();
  for (const o of seed.orders) if (o.rating && o.rating.text) counts.set(o.rating.text, (counts.get(o.rating.text) || 0) + 1);
  return counts;
}

function eligible(seed, order, ratedAt) {
  const c = context(seed, order, ratedAt), used = uses(seed);
  return (c.reported.length ? LOW : RATINGS).filter(entry => claimsOf(entry).every(k => CLAIMS[k](c)) && (entry[1] === null || (used.get(entry[1]) || 0) < cap(entry[0])));
}

function repeated(seed) {
  const all = [...RATINGS, ...LOW];
  return [...uses(seed)].filter(([text, n]) => n > cap(all.find(e => e[1] === text)[0])).map(([text, n]) => text + ' (' + n + ')');
}

function holds(seed, order) {
  if (!order.rating) return true;
  const c = context(seed, order, order.rating.at);
  const entry = (c.reported.length ? LOW : RATINGS).find(([stars, text]) => stars === order.rating.stars && text === order.rating.text);
  return !!entry && claimsOf(entry).every(k => CLAIMS[k](c));
}

module.exports = { RATINGS, LOW, CLAIMS, HOT, HOT_SIDES, claimsOf, MAX_REPEAT, MAX_NEGATIVE, context, eligible, holds, repeated };
