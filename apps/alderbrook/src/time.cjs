'use strict';
// Calendar days in an IANA time zone, through Node's built-in Intl. The only clock is the virtual time that Core supplies.
const DAY_MS = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const formatters = new Map();
function formatter(zone) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}));
  }
  return formatters.get(zone);
}
// An IANA name such as America/New_York or UTC. A bare offset such as +05:00 is not a name, whatever the Node version accepts.
function validZone(zone) {
  if (typeof zone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
  try { formatter(zone); return true; } catch { return false; }
}
function parts(instant, zone) {
  const out = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return out;
}
function offset(instant, zone) {
  const p = parts(instant, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}
const pad = (value, size = 2) => String(value).padStart(size, '0');
const dayNumber = day => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;
const dayString = number => new Date(number * DAY_MS).toISOString().slice(0, 10);
// The calendar day of an instant, as YYYY-MM-DD in the zone.
function localDay(instant, zone) {
  const p = parts(instant, zone);
  return pad(p.year, 4) + '-' + pad(p.month) + '-' + pad(p.day);
}
const starts = new Map();
// The first instant of a calendar day. Where the clocks change at midnight a day has no 00:00, or it has two,
// so the instant is searched: no zone is more than 15 hours from UTC.
function startOfDay(day, zone) {
  const key = zone + ' ' + day;
  if (starts.has(key)) return starts.get(key);
  const utc = dayNumber(day) * DAY_MS;
  let before = utc - 15 * 3600000, from = utc + 15 * 3600000;
  while (from - before > 1) {
    const middle = Math.floor((before + from) / 2);
    if (localDay(middle, zone) < day) before = middle; else from = middle;
  }
  starts.set(key, from);
  return from;
}
// An instant as an ISO string with the UTC offset of the zone.
function iso(instant, zone) {
  const p = parts(instant, zone), shift = offset(instant, zone), minutes = Math.abs(shift) / 60000;
  // An old offset with seconds has no ISO form, so that instant is written in UTC.
  if (!Number.isInteger(minutes)) return new Date(instant).toISOString();
  const fraction = instant % 1000 ? '.' + pad(((instant % 1000) + 1000) % 1000, 3) : '';
  return pad(p.year, 4) + '-' + pad(p.month) + '-' + pad(p.day) + 'T' + pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second) + fraction +
    (shift < 0 ? '-' : '+') + pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
}
// A limit of N days after a moment ends at the end of the calendar day that is N days after the day of that moment.
const lastDay = (instant, days, zone) => dayString(dayNumber(localDay(instant, zone)) + days);
const limitEnd = (instant, days, zone) => startOfDay(dayString(dayNumber(localDay(instant, zone)) + days + 1), zone);
// Plain text for notifications, for example "12 December 2026, 17:00".
function describe(instant, zone) {
  const p = parts(instant, zone);
  return p.day + ' ' + MONTHS[p.month - 1] + ' ' + p.year + ', ' + pad(p.hour) + ':' + pad(p.minute);
}
module.exports = {DAY_MS, validZone, localDay, dayNumber, dayString, startOfDay, iso, lastDay, limitEnd, describe};
