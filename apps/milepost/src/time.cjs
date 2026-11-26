'use strict';
// Time helpers. Instants are compared as instants; local dates and weekdays use the student's IANA time zone.
const {fail} = require('./domain-utils.cjs');
const ms = iso => Date.parse(iso);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    try {
      formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}));
    } catch {
      fail('invalid_seed', 'The student time zone is not supported by this Node.js build.');
    }
  }
  return formatters.get(timeZone);
}

// {date:'YYYY-MM-DD', weekday:'Mon'..'Sun', minutes: minutes after local midnight}
function local(iso, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms(iso))).map(p => [p.type, p.value]));
  return {date: parts.year + '-' + parts.month + '-' + parts.day, weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)};
}

// Shift an ISO instant by whole minutes, keeping its written UTC offset.
function shift(iso, minutes) {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const offset = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const wall = new Date(ms(iso) + (minutes + offset) * 60000).toISOString().slice(0, 19);
  return wall + (m ? m[0] : 'Z');
}

const clock = value => {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const overlaps = (a, b) => ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);

module.exports = {ms, DAYS, local, shift, clock, overlaps};
