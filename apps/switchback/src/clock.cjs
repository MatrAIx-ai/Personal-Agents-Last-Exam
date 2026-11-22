'use strict';
// Facility-time helpers. Every facility uses one fixed UTC offset, so local
// dates and times convert to instants without a time-zone database.
const {fail} = require('./domain-utils.cjs');

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function ms(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) fail('invalid_time', 'Invalid timestamp.');
  return t;
}

// Instant of a facility-local date and HH:MM.
function at(date, time, offset) {
  return ms(`${date}T${time}:00${offset}`);
}

function iso(t) {
  return new Date(t).toISOString().replace('.000Z', 'Z');
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Facility-local calendar date of an instant.
function localDate(t, offset) {
  const sign = offset[0] === '-' ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  return new Date(t + sign * (h * 60 + m) * MINUTE).toISOString().slice(0, 10);
}

// Night dates from arrival up to, not including, departure.
function nights(arrival, departure) {
  if (!(arrival < departure)) fail('invalid_dates', 'Departure must be after arrival.');
  const out = [];
  for (let d = arrival; d < departure; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 14) fail('stay_too_long', 'A stay is at most 14 nights.');
  }
  return out;
}

module.exports = {DAY, MINUTE, ms, at, iso, addDays, localDate, nights};
