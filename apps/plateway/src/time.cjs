'use strict';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MINUTE = 60000;
const formatters = new Map();
const ms = iso => Date.parse(iso);

function formatter(zone) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return formatters.get(zone);
}

function localParts(instant, zone) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    weekday: parts.weekday.slice(0, 3).toLowerCase(),
    minutes: hour * 60 + Number(parts.minute),
    seconds: Number(parts.second),
    wall: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second)),
  };
}

const pad = n => String(n).padStart(2, '0');
function toIso(instant, zone) {
  const local = localParts(instant, zone);
  const offset = Math.round((local.wall - Math.floor(instant / 1000) * 1000) / MINUTE);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const millis = ((instant % 1000) + 1000) % 1000;
  return local.date + 'T' + pad(Math.floor(local.minutes / 60)) + ':' + pad(local.minutes % 60) + ':' + pad(local.seconds) +
    (millis ? '.' + String(millis).padStart(3, '0') : '') + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

const toMinutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const previousDay = day => DAYS[(DAYS.indexOf(day) + 6) % 7];

function isOpen(restaurant, instant, zone) {
  const { weekday, minutes } = localParts(instant, zone);
  for (const [start, end] of restaurant.hours[weekday] || []) {
    const s = toMinutes(start), e = toMinutes(end);
    if (e > s ? minutes >= s && minutes < e : minutes >= s) return true;
  }
  for (const [start, end] of restaurant.hours[previousDay(weekday)] || []) {
    const s = toMinutes(start), e = toMinutes(end);
    if (e <= s && minutes < e) return true;
  }
  return false;
}

const addMinutes = (iso, minutes, zone) => toIso(ms(iso) + minutes * MINUTE, zone);
module.exports = { ms, toIso, localParts, isOpen, addMinutes, MINUTE, DAYS };
