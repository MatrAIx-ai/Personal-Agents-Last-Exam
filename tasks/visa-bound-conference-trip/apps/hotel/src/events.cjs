'use strict';
// Infra-applied events, scheduled by the task. Each handler observes the event's own `at` as
// ctx.virtual_now. The App never schedules itself. Every applied event is logged in
// data.events_applied; an event ID that is already there is a no-op (Core also deduplicates).
const c = require('./common.cjs');
const d = require('./dates.cjs');

// Expire every pending rate-switch offer (at one hotel, or at all hotels when hotel_id is null)
// whose window has closed. The reservation stays on its refundable rate.
function expireOffers(ctx, data, payload) {
  if (payload.hotel_id !== null) c.find(data.hotels, payload.hotel_id, 'Hotel');
  const affected = [];
  for (const r of data.reservations) {
    const offer = r.rate_switch;
    if (offer?.status !== 'pending' || (payload.hotel_id !== null && r.hotel_id !== payload.hotel_id)) continue;
    if (c.ms(offer.expires_at) > c.ms(ctx.virtual_now)) continue;
    offer.status = 'expired';
    offer.resolved_at = ctx.virtual_now;
    r.status = 'confirmed';
    c.stamp(ctx, r, 'rate_switch_expired');
    affected.push(r.id);
  }
  return affected;
}

// A new nightly price for one plan, for bookings and offers made from now on. Existing
// reservations and pending offers keep the price they were given.
function changeRate(ctx, data, payload) {
  const hotel = c.find(data.hotels, payload.hotel_id, 'Hotel'), rate = hotel.rates[payload.plan];
  if (rate.nightly_cents === payload.nightly_cents) c.fail('invalid_event', 'That is already the current price.');
  rate.nightly_cents = payload.nightly_cents;
  c.stamp(ctx, hotel, 'rate_changed_' + payload.plan);
  return [hotel.id];
}

// Nights that can no longer be booked in either plan. Existing reservations are kept.
function sellOut(ctx, data, payload) {
  const hotel = c.find(data.hotels, payload.hotel_id, 'Hotel');
  if (!payload.nights.every(d.validDate)) c.fail('invalid_event', 'Nights must be real calendar dates.');
  const added = payload.nights.filter(n => !hotel.sold_out_nights.includes(n));
  if (!added.length) c.fail('invalid_event', 'Those nights are already sold out.');
  hotel.sold_out_nights = [...hotel.sold_out_nights, ...added].sort();
  c.stamp(ctx, hotel, 'sold_out', {nights:added.length});
  return [hotel.id];
}

const HANDLERS = {
  'roomline.rate_switch.expire':expireOffers,
  'roomline.rate.change':changeRate,
  'roomline.availability.sell_out':sellOut
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) c.fail('invalid_event', 'Unsupported operation.');
  if (data.events_applied.some(e => e.event_id === event.event_id)) {
    c.log(ctx, 'roomline.event_replayed', {event_id:event.event_id});
    return data;
  }
  const affected = handler(ctx, data, event.payload);
  data.events_applied.push({event_id:event.event_id, at:ctx.virtual_now, operation:event.operation, affected_ids:affected});
  c.log(ctx, 'roomline.event_applied', {event_id:event.event_id, affected:affected.length});
  return data;
}

module.exports = {applyEvent};
