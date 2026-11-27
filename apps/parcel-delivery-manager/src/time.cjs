'use strict';
// Calendar helpers. Service days (delivery_date, hold_until) are calendar days in the
// carrier's time zone; pickup-point hours use each point's own zone. No wall-clock time.
const DAY = 86400000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}));
  }
  return formatters.get(timeZone);
}
function parts(at, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return {year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: WEEKDAYS.indexOf(p.weekday)};
}
const pad = n => String(n).padStart(2, '0');
function validZone(timeZone) {
  try { formatter(timeZone); return true; } catch { return false; }
}
function validDay(day) {
  const at = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day;
}
function localDate(at, timeZone) {
  const p = parts(at, timeZone);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day);
}
function localClock(at, timeZone) {
  const p = parts(at, timeZone);
  return {weekday: p.weekday, time: pad(p.hour) + ':' + pad(p.minute)};
}
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
// Local wall time minus UTC at this instant.
function offset(at, timeZone) {
  const p = parts(at, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}
// Instant at which a calendar day starts in the zone (second pass settles DST transitions).
function startOfDay(day, timeZone) {
  const guess = Date.parse(day + 'T00:00:00Z');
  return guess - offset(guess - offset(guess, timeZone), timeZone);
}
module.exports = {validZone, validDay, localDate, localClock, addDays, startOfDay};
