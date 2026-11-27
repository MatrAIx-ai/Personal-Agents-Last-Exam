'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {ms, render} = require('./time.cjs');

const MIN = 60e3;

function find(list, key, value, code, message) {
  const item = list.find(x => x[key] === value);
  if (!item) fail(code, message);
  return item;
}
const place = (data, id) => find(data.places, 'place_id', id, 'place_not_found', 'Place does not exist in this run.');
const booking = (data, id) => find(data.bookings, 'booking_id', id, 'booking_not_found', 'Booking does not exist in this account.');
const paymentMethod = (data, id) => find(data.payment_methods, 'payment_method_id', id, 'payment_method_not_found', 'Payment method does not exist in this account.');

// Next number after the highest one used with a prefix: `bk-<n>` per account, `le-bk-7-<n>` per booking.
function nextNumber(ids, prefix) {
  const re = new RegExp('^' + prefix.replace(/[-.]/g, '\\$&') + '(\\d+)$');
  return ids.reduce((m, id) => { const r = re.exec(id || ''); return r ? Math.max(m, +r[1]) : m; }, 0) + 1;
}
const nextBookingId = data => 'bk-' + nextNumber(data.bookings.map(b => b.booking_id), 'bk-');
const nextEntryId = (data, bookingId) => 'le-' + bookingId + '-' + nextNumber(data.ledger.map(e => e.entry_id), 'le-' + bookingId + '-');
const nextShareId = (data, bookingId) => 'sh-' + bookingId + '-' + nextNumber(data.shares.map(s => s.share_id), 'sh-' + bookingId + '-');
const nextCaseId = (data, bookingId) => 'cs-' + bookingId + '-' + nextNumber(data.support_cases.map(c => c.case_id), 'cs-' + bookingId + '-');

const dollars = cents => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);
const zoneOf = (data, p) => p.time_zone || data.settings.time_zone;
// Render an instant in a place's zone (or the account zone).
const at = (data, value, p) => render(value, p ? zoneOf(data, p) : data.settings.time_zone);
const stamp = (ctx, data) => render(ctx.virtual_now, data.settings.time_zone);
const plus = (value, minutes) => ms(value) + minutes * MIN;

const person = (ctx, id) => ctx.binding.people.find(p => p.person_id === id) || null;
const personName = (ctx, id) => person(ctx, id)?.name || id;
// A person has a Mail channel when the run binding gives them a Mail account.
const mailAccount = (ctx, personId) => ctx.binding.accounts.find(a => a.app_id === 'mail' && a.owner_person_id === personId) || null;

const sameFlight = (a, b) => !!a && !!b && a.carrier === b.carrier && a.number === b.number && a.local_date === b.local_date;
const flightLabel = f => f.carrier + f.number;
function flight(data, key, code = 'invalid_flight') {
  const f = data.flights.find(x => sameFlight(x, key));
  if (!f) fail(code, 'Flight ' + flightLabel(key) + ' on ' + key.local_date + ' is not known to this run.');
  return f;
}

module.exports = {fail, copy, log, MIN, find, place, booking, paymentMethod, nextBookingId, nextEntryId, nextShareId, nextCaseId,
  dollars, zoneOf, at, stamp, plus, person, personName, mailAccount, sameFlight, flightLabel, flight};
