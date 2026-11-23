'use strict';
const { fail } = require('./util.cjs');
const { ms, toIso, isOpen, localParts, MINUTE } = require('./time.cjs');
const { restaurantStatus, estimateMinutes } = require('./catalog.cjs');
const MIN_LEAD = 45;
const MAX_WALL_LEAD = 7 * 24 * 60 * MINUTE;
const BOUNDARY = 15;

function deliveryPlan(data, restaurant, address, when, now) {
  const estimate = estimateMinutes(restaurant, address.zone_id);
  if (when.mode === 'asap') {
    if (restaurantStatus(data, restaurant, now) !== 'open') fail('restaurant_closed', restaurant.name + ' is not taking orders now.');
    return { mode: 'asap', estimate_minutes: estimate, estimated_delivery_at: toIso(ms(now) + estimate * MINUTE, data.time_zone), delivery_at: null, release_at: null };
  }
  const delivery = ms(when.delivery_at), current = ms(now);
  const local = localParts(delivery, data.time_zone);
  const lead = (delivery - current) / MINUTE;
  const wallLead = local.wall - localParts(current, data.time_zone).wall;
  const release = delivery - estimate * MINUTE;
  const unavailable = () => fail('delivery_time_unavailable', 'That delivery time is not available.');
  if (!Number.isFinite(delivery) || local.seconds !== 0 || delivery % 1000 !== 0 || local.minutes % BOUNDARY !== 0) unavailable();
  if (lead < MIN_LEAD || wallLead > MAX_WALL_LEAD) unavailable();
  if (release <= current || !isOpen(restaurant, release, data.time_zone)) unavailable();
  const deliveryIso = toIso(delivery, data.time_zone);
  return { mode: 'scheduled', estimate_minutes: estimate, estimated_delivery_at: deliveryIso, delivery_at: deliveryIso, release_at: toIso(release, data.time_zone) };
}
module.exports = { deliveryPlan };
