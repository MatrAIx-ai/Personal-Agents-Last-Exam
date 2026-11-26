'use strict';
// Time helpers. Instants are compared as instants and durations are exact (a day is 24 hours); local dates,
// weekdays, weeks (Monday to Sunday) and the written UTC offset use the student's IANA time zone.
const {fail} = require('./domain-utils.cjs');
const ms = iso => Date.parse(iso);
const HOUR = 3600000, DAY = 24 * HOUR;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    try {
      formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}));
    } catch {
      fail('invalid_seed', 'The student time zone is not supported by this Node.js build.');
    }
  }
  return formatters.get(timeZone);
}
function parts(instant, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  return {year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute),
    second: Number(p.second), weekday: p.weekday};
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const dateOf = p => p.year + '-' + pad(p.month) + '-' + pad(p.day);

// {date:'YYYY-MM-DD', weekday:'Mon'..'Sun', minutes: minutes after local midnight}
function local(iso, timeZone) {
  const p = parts(ms(iso), timeZone);
  return {date: dateOf(p), weekday: p.weekday, minutes: p.hour * 60 + p.minute};
}
// The instant written in the student's time zone with its UTC offset, to the second: 2027-03-08T09:00:00-05:00.
function zoned(value, timeZone) {
  const instant = Math.floor((typeof value === 'number' ? value : ms(value)) / 1000) * 1000, p = parts(instant, timeZone);
  const offset = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant) / 60000);
  const sign = offset < 0 ? '-' : '+', abs = Math.abs(offset);
  return dateOf(p) + 'T' + pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second) + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}
// The local date of the Monday that starts the instant's week.
function weekStart(iso, timeZone) {
  const p = parts(ms(iso), timeZone), back = DAYS.indexOf(p.weekday);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) - back * DAY);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
const plus = (iso, minutes) => ms(iso) + minutes * 60000;

module.exports = {ms, HOUR, DAY, DAYS, local, zoned, weekStart, plus};
