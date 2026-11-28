'use strict';
const ZONE = 'America/New_York';
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const formatter = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const ms = iso => Date.parse(iso);

function localParts(t) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const second = Math.floor((((t % MINUTE) + MINUTE) % MINUTE) / 1000);
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second, weekday: WEEKDAYS[p.weekday], date: p.year + '-' + p.month + '-' + p.day };
}

function offsetMinutes(t) {
  const p = localParts(t);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(t / 1000) * 1000) / MINUTE);
}

const pad = n => String(n).padStart(2, '0');

function toIso(t) {
  const p = localParts(t), off = offsetMinutes(t), sign = off < 0 ? '-' : '+', a = Math.abs(off);
  const milli = ((t % 1000) + 1000) % 1000;
  return p.date + 'T' + pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second) + (milli ? '.' + String(milli).padStart(3, '0') : '') + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}

const localDate = t => localParts(t).date;

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const u = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return u.getUTCFullYear() + '-' + pad(u.getUTCMonth() + 1) + '-' + pad(u.getUTCDate());
}

const weekdayOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

function wallKey(t) {
  const p = localParts(t);
  return p.date + 'T' + pad(p.hour) + ':' + pad(p.minute);
}

function fromLocal(date, hhmm, occurrence = 'first') {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const target = date + 'T' + hhmm;
  const matches = [-4, -5].map(h => naive - h * HOUR).filter(t => wallKey(t) === target).sort((a, b) => a - b);
  if (matches.length) return occurrence === 'second' ? matches[matches.length - 1] : matches[0];
  let lo = naive + 4 * HOUR, hi = naive + 5 * HOUR;
  while (hi - lo > MINUTE) { const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE; if (wallKey(mid) >= target) hi = mid; else lo = mid; }
  return hi;
}

function intervalsOn(store, date) {
  const day = weekdayOf(date), out = [];
  for (const span of store.hours) {
    if (span.day !== day) continue;
    const open = fromLocal(date, span.open, 'first');
    const close = fromLocal(span.close <= span.open ? addDays(date, 1) : date, span.close, 'second');
    if (close > open) out.push([open, close]);
  }
  return out;
}

function isOpen(store, t) {
  const today = localDate(t);
  return [addDays(today, -1), today].some(date => intervalsOn(store, date).some(([open, close]) => open <= t && t < close));
}

function nextOpening(store, t) {
  const today = localDate(t);
  let best = null;
  for (let i = 0; i <= 14; i++) for (const [open] of intervalsOn(store, addDays(today, i))) if (open > t && (best === null || open < best)) best = open;
  return best;
}

const validDate = date => { if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return false; const [y, m, d] = date.split('-').map(Number), u = new Date(Date.UTC(y, m - 1, d)); return y >= 1900 && y <= 2201 && u.getUTCFullYear() === y && u.getUTCMonth() === m - 1 && u.getUTCDate() === d; };
const rxExpiry = writtenOn => fromLocal(addDays(writtenOn, 365), '23:59', 'first');
const startOfDay = date => fromLocal(date, '00:00', 'first');

const CLOCK_MIN = Date.parse('2000-01-01T00:00:00-05:00'), CLOCK_MAX = Date.parse('2199-12-31T23:59:59.999-05:00');
const clockInRange = iso => { const t = Date.parse(iso); return Number.isFinite(t) && t >= CLOCK_MIN && t <= CLOCK_MAX; };

module.exports = { CLOCK_MIN, CLOCK_MAX, clockInRange, ZONE, MINUTE, HOUR, DAY, ms, toIso, validDate, localParts, localDate, addDays, weekdayOf, fromLocal, intervalsOn, isOpen, nextOpening, rxExpiry, startOfDay };
