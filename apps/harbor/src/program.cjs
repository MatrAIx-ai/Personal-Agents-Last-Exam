'use strict';
// Program rules shared by tools, events and seed validation: categories over time, award
// prices, certificate eligibility and points expiry after inactivity.
const {createHash} = require('node:crypto');
const c = require('./common.cjs');
const d = require('./dates.cjs');

const WARNING_DAYS = 60;

// Category in effect at an instant: the latest change whose effective_at has passed, else the base category.
function categoryAt(hotel, at) {
  let category = hotel.category;
  for (const change of hotel.category_changes) if (c.ms(change.effective_at) <= c.ms(at)) category = change.category;
  return category;
}
const upcomingChange = (hotel, at) => hotel.category_changes.find(change => c.ms(change.effective_at) > c.ms(at)) || null;

function chartRow(data, category) {
  const row = data.award_chart.find(r => r.category === category);
  if (!row) c.fail('invalid_state', 'The award chart has no row for category ' + category + '.');
  return row;
}

// Whole-stay prices at one category.
function quote(data, hotel, category, nights) {
  const row = chartRow(data, category);
  return {points:{points:nights * row.points_per_night},
    points_cash:row.points_cash ? {points:nights * row.points_cash.points, cash_cents:nights * row.points_cash.cash_cents} : null,
    cash:{cash_cents:nights * hotel.cash_rate_cents}};
}

// Validated stay: real dates, check_out after check_in, at most 30 nights.
function stay(checkIn, checkOut) {
  if (!d.validDate(checkIn) || !d.validDate(checkOut)) c.fail('invalid_arguments', 'Check-in and check-out must be real calendar dates.');
  const nights = d.nightsBetween(checkIn, checkOut);
  if (nights < 1) c.fail('invalid_arguments', 'Check-out must be after check-in.');
  if (nights > 30) c.fail('invalid_arguments', 'A stay is at most 30 nights.');
  return nights;
}
const blackoutNights = (hotel, checkIn, nights) => d.stayDates(checkIn, nights).filter(day => hotel.blackout_dates.includes(day));

// First certificate rule a stay breaks, or null. Rules are checked in this order.
function certificateRule(cert, {nights, category, checkIn}) {
  if (cert.status !== 'active') return 'status';
  if (nights !== 1) return 'one_night';
  if (category > cert.category_cap) return 'category_cap';
  if (checkIn > cert.expires_on) return 'expires_on';
  return null;
}
const RULE_TEXT = {status:'the certificate is not active', one_night:'a certificate pays for exactly 1 night',
  category_cap:'the hotel category is above the certificate cap', expires_on:'check-in is after the certificate\'s last check-in date'};
const ruleMessage = (cert, rule) => 'Certificate ' + cert.id + ' cannot be used (rule ' + rule + '): ' + RULE_TEXT[rule] + '.';

// A cancelled certificate stay gives the certificate back only while it can still be used.
const certificateAfterCancel = (cert, today) => today <= cert.expires_on ? 'active' : 'expired';

// Points expire inactivity_months calendar months after the last activity, at the same wall time and offset.
const expiresAt = data => d.addMonths(data.last_activity_at, data.inactivity_months);
const warningOpensAt = data => d.shift(expiresAt(data), -WARNING_DAYS * d.DAY);

const confirmation = (accountId, reservationId) => 'HH' + createHash('sha256').update(accountId + ':' + reservationId).digest('hex').slice(0, 8).toUpperCase();

module.exports = {WARNING_DAYS, categoryAt, upcomingChange, chartRow, quote, stay, blackoutNights, certificateRule, ruleMessage,
  certificateAfterCancel, expiresAt, warningOpensAt, confirmation};
