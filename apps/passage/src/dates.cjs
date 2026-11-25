'use strict';
// Explicit calendar arithmetic on plain dates (YYYY-MM-DD) and RFC 3339 instants.
// Nothing here reads the host clock.
const DAY = 86400000;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12

function validDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= daysInMonth(+m[1], +m[2]);
}
const dayNumber = value => Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)) / DAY;
const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
const addDays = (value, n) => new Date((dayNumber(value) + n) * DAY).toISOString().slice(0, 10);
const weekday = value => new Date(dayNumber(value) * DAY).getUTCDay(); // 0 Sunday .. 6 Saturday

// Add calendar months to a date, clamping the day to the end of a shorter month (Feb 29 + 12 months = Feb 28).
function addMonths(value, months) {
  const index = +value.slice(0, 4) * 12 + (+value.slice(5, 7) - 1) + months, year = Math.floor(index / 12), month = index % 12 + 1;
  return pad(year, 4) + '-' + pad(month) + '-' + pad(Math.min(+value.slice(8, 10), daysInMonth(year, month)));
}

function validTimeZone(zone) {
  try { new Intl.DateTimeFormat('en-US', {timeZone:zone}); return true; } catch { return false; }
}

// The calendar date of an instant in an IANA zone (the office's "today").
const formatters = new Map();
function localDate(instant, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'}));
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(Date.parse(instant))).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

module.exports = {DAY, validDate, daysBetween, addDays, weekday, addMonths, validTimeZone, localDate};
