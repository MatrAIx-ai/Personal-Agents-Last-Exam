'use strict';
const { fail, clone } = require('./util.cjs');
const { ms, isOpen } = require('./time.cjs');

const find = (list, id, what) => list.find(x => x.id === id) || fail('not_found', what + ' ' + id + ' does not exist.');
const restaurantOf = (data, id) => find(data.restaurants, id, 'Restaurant');
const dishOf = (data, id) => find(data.dishes, id, 'Dish');
const addressOf = (data, id) => find(data.addresses, id, 'Address');
const zoneEntry = (restaurant, zoneId) => restaurant.zones.find(z => z.zone_id === zoneId) || null;
const servesZone = (restaurant, zoneId) => zoneEntry(restaurant, zoneId) !== null;
const estimateMinutes = (restaurant, zoneId) => restaurant.prep_minutes + zoneEntry(restaurant, zoneId).travel_minutes;

function restaurantStatus(data, restaurant, now) {
  if (restaurant.paused) return 'paused';
  return isOpen(restaurant, ms(now), data.time_zone) ? 'open' : 'closed';
}
const allergens = a => ({ contains: [...a.contains], may_contain: [...a.may_contain] });
const optionView = o => ({ id: o.id, name: o.name, price_delta_cents: o.price_delta_cents, allergens: allergens(o.allergens) });
const groupView = g => ({ id: g.id, name: g.name, required: g.required, min: g.min, max: g.max, options: g.options.map(optionView) });
const menuEntry = d => ({ id: d.id, name: d.name, description: d.description, price_cents: d.price_cents, available: d.available, allergens: allergens(d.allergens), has_options: d.option_groups.length > 0 });

function summary(data, r, zoneId, now) {
  return { id: r.id, name: r.name, cuisines: [...r.cuisines], status: restaurantStatus(data, r, now), pause_reason: r.paused ? r.pause_reason : null,
    delivery_fee_cents: r.delivery_fee_cents, estimate_minutes: estimateMinutes(r, zoneId), rating: clone(r.rating) };
}

function search(ctx, data, args) {
  const address = addressOf(data, args.address_id);
  const text = args.text ? args.text.toLowerCase() : null;
  const matches = r => !text || r.name.toLowerCase().includes(text) || r.cuisines.some(c => c.toLowerCase().includes(text)) ||
    data.dishes.some(d => d.restaurant_id === r.id && d.name.toLowerCase().includes(text));
  const restaurants = data.restaurants
    .filter(r => servesZone(r, address.zone_id))
    .filter(r => !args.cuisine || r.cuisines.some(c => c.toLowerCase() === args.cuisine.toLowerCase()))
    .filter(matches)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(r => summary(data, r, address.zone_id, ctx.virtual_now));
  return { restaurants };
}

function getRestaurant(ctx, data, args) {
  const r = restaurantOf(data, args.restaurant_id);
  return {
    restaurant: { id: r.id, name: r.name, cuisines: [...r.cuisines], hours: clone(r.hours), status: restaurantStatus(data, r, ctx.virtual_now),
      pause_reason: r.paused ? r.pause_reason : null, delivery_fee_cents: r.delivery_fee_cents, prep_minutes: r.prep_minutes,
      zones: clone(r.zones), rating: clone(r.rating) },
    menu: data.dishes.filter(d => d.restaurant_id === r.id).map(menuEntry),
  };
}

function getItem(ctx, data, args) {
  const d = dishOf(data, args.item_id);
  return { item: { id: d.id, restaurant_id: d.restaurant_id, name: d.name, description: d.description, price_cents: d.price_cents,
    available: d.available, allergens: allergens(d.allergens), option_groups: d.option_groups.map(groupView) } };
}
module.exports = { search, getRestaurant, getItem, restaurantOf, dishOf, addressOf, servesZone, zoneEntry, estimateMinutes, restaurantStatus };
