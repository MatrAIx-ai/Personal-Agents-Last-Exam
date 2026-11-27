'use strict';
// Explicit calendar arithmetic. Business dates are plain local dates in the desk's business
// calendar time zone; instants are RFC 3339 strings with an offset. Nothing here reads the host clock.
const DAY = 86400000;
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12

function validDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= daysInMonth(+m[1], +m[2]);
}
const dayNumber = value => Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)) / DAY;
const addDays = (value, n) => new Date((dayNumber(value) + n) * DAY).toISOString().slice(0, 10);
const weekday = value => new Date(dayNumber(value) * DAY).getUTCDay(); // 0 Sunday … 6 Saturday

function validTimeZone(zone) {
  try { new Intl.DateTimeFormat('en-US', {timeZone:zone}); return true; } catch { return false; }
}

// The calendar date of an instant in an IANA zone.
const formatters = new Map();
function localDate(instant, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'}));
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(Date.parse(instant))).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

// Business days are Monday to Friday, except the calendar's holidays.
const isBusinessDay = (value, calendar) => ![0, 6].includes(weekday(value)) && !calendar.holidays.some(h => h.date === value);

// The date N business days after `from`. `from` itself is never counted, whatever day it is:
// a registration on Monday 22 February plus 10 business days is Monday 8 March.
function addBusinessDays(from, n, calendar) {
  let day = from, left = n;
  while (left > 0) { day = addDays(day, 1); if (isBusinessDay(day, calendar)) left--; }
  return day;
}

// Shift an RFC 3339 time by whole minutes, keeping its offset spelling.
function shiftMinutes(iso, minutes) {
  const [, offset] = iso.match(/(Z|[+-]\d{2}:\d{2})$/i);
  const offsetMinutes = /^z$/i.test(offset) ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)));
  const local = new Date(Date.parse(iso) + (minutes + offsetMinutes) * 60000).toISOString().slice(0, 19);
  return local + (/^z$/i.test(offset) ? 'Z' : offset);
}

module.exports = {DAY, validDate, addDays, weekday, validTimeZone, localDate, isBusinessDay, addBusinessDays, shiftMinutes};
