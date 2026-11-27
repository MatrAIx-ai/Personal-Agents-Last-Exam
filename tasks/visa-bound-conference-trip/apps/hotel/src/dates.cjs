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
  if (typeof zone !== 'string' || !zone.includes('/')) return false;
  try { new Intl.DateTimeFormat('en-US', {timeZone:zone}); return true; } catch { return false; }
}

const formatters = new Map();
function wall(zone, utcMs) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {timeZone:zone, hourCycle:'h23', year:'numeric', month:'2-digit',
      day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}));
  }
  const p = Object.fromEntries(formatters.get(zone).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return {date:p.year + '-' + p.month + '-' + p.day, time:p.hour + ':' + p.minute + ':' + p.second,
    asUtc:Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)};
}
// UTC offset of a zone at an instant, in minutes (whole seconds are dropped).
const offsetMinutes = (zone, utcMs) => Math.round((wall(zone, Math.floor(utcMs / 1000) * 1000).asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);

// The calendar date of an instant in an IANA zone (the hotel's "today").
const localDate = (instant, zone) => wall(zone, Date.parse(instant)).date;

// An instant spelled in the zone's own offset, for example 2027-04-23T15:00:00+02:00.
function inZone(utcMs, zone) {
  const off = offsetMinutes(zone, utcMs), w = wall(zone, utcMs), a = Math.abs(off);
  return w.date + 'T' + w.time + (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}

// Local wall-clock date and HH:MM in a zone to an instant. Times that fall in a spring-forward
// gap resolve to the later offset; this never happens at a 15:00 check-in in Europe.
function zonedTime(date, hhmm, zone) {
  const target = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +hhmm.slice(0, 2), +hhmm.slice(3, 5));
  let utc = target - offsetMinutes(zone, target) * 60000;
  utc = target - offsetMinutes(zone, utc) * 60000;
  return inZone(utc, zone);
}

// Shift an RFC 3339 time by whole seconds, keeping its fractional seconds and offset spelling.
function shift(iso, deltaMs) {
  if (!Number.isInteger(deltaMs / 1000)) throw new Error('shift takes whole seconds');
  const [, fraction = '', offset] = iso.match(/(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i);
  const minutes = /^z$/i.test(offset) ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)));
  const whole = Date.parse(iso.slice(0, iso.length - fraction.length - offset.length) + offset);
  return new Date(whole + deltaMs + minutes * 60000).toISOString().slice(0, 19) + fraction + offset;
}

module.exports = {DAY, validDate, nightsBetween, addDays, stayDates, validTimeZone, localDate, inZone, zonedTime, shift};
