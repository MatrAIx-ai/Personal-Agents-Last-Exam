'use strict';
// Explicit calendar arithmetic. Stay dates are plain local dates at the hotel; instants are
// RFC 3339 strings with an offset. Nothing here reads the host clock.
const DAY = 86400000;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12

function validDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= daysInMonth(+m[1], +m[2]);
}
const dayNumber = value => Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)) / DAY;
const nightsBetween = (checkIn, checkOut) => dayNumber(checkOut) - dayNumber(checkIn);
const addDays = (value, n) => new Date((dayNumber(value) + n) * DAY).toISOString().slice(0, 10);
const stayDates = (checkIn, nights) => Array.from({length:nights}, (_, i) => addDays(checkIn, i));

function validTimeZone(zone) {
  try { new Intl.DateTimeFormat('en-US', {timeZone:zone}); return true; } catch { return false; }
}

// The calendar date of an instant in an IANA zone (the hotel's "today").
const formatters = new Map();
function localDate(instant, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'}));
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(Date.parse(instant))).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

// Add calendar months to an RFC 3339 time, keeping its wall-clock time, fractional seconds and
// offset spelling, and clamping the day to the end of a shorter month (Jan 31 + 1 month = Feb 28/29).
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/i;
function addMonths(iso, months) {
  const m = STAMP.exec(iso);
  if (!m || !Number.isInteger(months)) throw new Error('addMonths takes an RFC 3339 time and whole months');
  const index = +m[1] * 12 + (+m[2] - 1) + months, year = Math.floor(index / 12), month = index % 12 + 1;
  return pad(year, 4) + '-' + pad(month) + '-' + pad(Math.min(+m[3], daysInMonth(year, month))) + 'T' + m[4] + m[5];
}

// Shift an RFC 3339 time by whole seconds, keeping its fractional seconds and offset spelling.
function shift(iso, deltaMs) {
  if (!Number.isInteger(deltaMs / 1000)) throw new Error('shift takes whole seconds');
  const [, fraction = '', offset] = iso.match(/(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i);
  const minutes = /^z$/i.test(offset) ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)));
  const whole = Date.parse(iso.slice(0, iso.length - fraction.length - offset.length) + offset);
  return new Date(whole + deltaMs + minutes * 60000).toISOString().slice(0, 19) + fraction + offset;
}

module.exports = {DAY, validDate, nightsBetween, addDays, stayDates, validTimeZone, localDate, addMonths, shift};
