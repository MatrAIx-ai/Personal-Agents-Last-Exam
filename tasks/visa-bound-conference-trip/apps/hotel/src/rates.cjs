'use strict';
// Rate plans and their rules. Prices are integer euro cents. A stay is a list of local dates
// (the nights) at the hotel; arrival is the check-in date at the hotel's check-in time.
const crypto = require('node:crypto');
const c = require('./common.cjs');
const d = require('./dates.cjs');

const PLANS = ['refundable', 'non_refundable'];
const MAX_NIGHTS = 30;
const SWITCH_WINDOW_MS = 30 * 60000; // a rate-switch offer is open for 30 minutes

function stay(checkIn, checkOut) {
  if (!d.validDate(checkIn) || !d.validDate(checkOut)) c.fail('invalid_arguments', 'Dates must be real calendar dates (YYYY-MM-DD).');
  const nights = d.nightsBetween(checkIn, checkOut);
  if (nights < 1) c.fail('invalid_arguments', 'Check-out must be after check-in.');
  if (nights > MAX_NIGHTS) c.fail('invalid_arguments', 'A stay can have at most ' + MAX_NIGHTS + ' nights.');
  return nights;
}

const arrival = (hotel, checkIn) => d.zonedTime(checkIn, hotel.check_in_time, hotel.timezone);
function freeCancellationUntil(hotel, checkIn) {
  return d.inZone(c.ms(arrival(hotel, checkIn)) - hotel.rates.refundable.free_cancellation_hours * 3600000, hotel.timezone);
}

const planLabel = (hotel, plan) => plan === 'refundable'
  ? 'Free cancellation until ' + hotel.rates.refundable.free_cancellation_hours + ' h before arrival'
  : 'Non-refundable';

function terms(hotel, plan, checkIn, nightly) {
  if (plan === 'non_refundable') return 'Charged in full at booking. Not refundable and not changeable.';
  return 'Charged in full at booking. Full refund if cancelled by ' + freeCancellationUntil(hotel, checkIn) +
    '; after that the first night (' + c.eur(nightly) + ') is kept. No refund after arrival.';
}

const nightsIn = (list, checkIn, nights) => d.stayDates(checkIn, nights).filter(n => list.includes(n));

function quote(hotel, checkIn, nights) {
  const soldOut = nightsIn(hotel.sold_out_nights, checkIn, nights);
  return PLANS.map(plan => {
    const nightly = hotel.rates[plan].nightly_cents;
    return {plan, label:planLabel(hotel, plan), nightly_cents:nightly, total_cents:nightly * nights, available:!soldOut.length,
      free_cancellation_until:plan === 'refundable' ? freeCancellationUntil(hotel, checkIn) : null,
      terms:terms(hotel, plan, checkIn, nightly)};
  });
}

// Cancellation outcome at an instant. Free cancellation is inclusive of its deadline.
function cancellation(hotel, r, now) {
  if (c.ms(now) >= c.ms(arrival(hotel, r.check_in))) c.fail('invalid_state', 'Cancellation closes at arrival (' + arrival(hotel, r.check_in) + ').');
  if (r.plan === 'non_refundable') return {rule:'non_refundable', refund_cents:0, fee_cents:r.paid_cents};
  if (c.ms(now) <= c.ms(r.free_cancellation_until)) return {rule:'free', refund_cents:r.paid_cents, fee_cents:0};
  return {rule:'late', refund_cents:r.paid_cents - r.nightly_cents, fee_cents:r.nightly_cents};
}

function confirmation(accountId, id) {
  return 'RL' + crypto.createHash('sha256').update(accountId + ':' + id).digest('hex').slice(0, 8).toUpperCase();
}

function switchMessage(hotel, offer) {
  return 'High demand on ' + offer.high_demand_nights.join(', ') + '. ' + hotel.name + ' can book this stay only at its Non-refundable rate: ' +
    c.eur(offer.proposed_nightly_cents) + ' per night, ' + c.eur(offer.proposed_total_cents) + ' in total, charged in full and not refundable. ' +
    'To book it, call roomline.rate_switch.confirm by ' + offer.expires_at + '. ' +
    'If you decline or do not respond, nothing is booked and nothing is charged.';
}

module.exports = {PLANS, MAX_NIGHTS, SWITCH_WINDOW_MS, stay, arrival, freeCancellationUntil, planLabel, quote, nightsIn,
  cancellation, confirmation, switchMessage};
