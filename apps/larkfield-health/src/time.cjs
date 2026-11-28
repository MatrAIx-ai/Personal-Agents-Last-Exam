'use strict';
const ZONE = 'America/New_York';
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const formatter = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const ms = iso => Date.parse(iso);
const pad = n => String(n).padStart(2, '0');

function localParts(t) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const second = Math.floor((((t % MINUTE) + MINUTE) % MINUTE) / 1000);
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second, date: p.year + '-' + p.month + '-' + p.day };
}

function offsetMinutes(t) {
  const p = localParts(t);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(t / 1000) * 1000) / MINUTE);
}

function toIso(t) {
  const p = localParts(t), off = offsetMinutes(t), sign = off < 0 ? '-' : '+', a = Math.abs(off);
  const milli = ((t % 1000) + 1000) % 1000;
  return p.date + 'T' + pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second) + (milli ? '.' + String(milli).padStart(3, '0') : '') + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}

const localDate = t => localParts(t).date;
const planYear = date => Number(date.slice(0, 4));

function validDate(date, min = 2000, max = 2199) {
  if (typeof date !== 'string' || !DATE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number), u = new Date(Date.UTC(y, m - 1, d));
  return y >= min && y <= max && u.getUTCFullYear() === y && u.getUTCMonth() === m - 1 && u.getUTCDate() === d;
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const u = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return u.getUTCFullYear() + '-' + pad(u.getUTCMonth() + 1) + '-' + pad(u.getUTCDate());
}

function wallKey(t) {
  const p = localParts(t);
  return p.date + 'T' + pad(p.hour) + ':' + pad(p.minute);
}

function fromLocal(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm), target = date + 'T' + hhmm;
  const matches = [-4, -5].map(h => naive - h * HOUR).filter(t => wallKey(t) === target).sort((a, b) => a - b);
  if (matches.length) return matches[0];
  let lo = naive + 4 * HOUR, hi = naive + 5 * HOUR;
  while (hi - lo > MINUTE) { const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE; if (wallKey(mid) >= target) hi = mid; else lo = mid; }
  return hi;
}

const endOfDay = date => fromLocal(date, '23:59');
const dayDeadline = (startIso, n) => endOfDay(addDays(localDate(ms(startIso)), n));
const hoursAfter = (startIso, h) => ms(startIso) + h * HOUR;

const CLOCK_MIN = Date.parse('2000-01-01T00:00:00-05:00'), CLOCK_MAX = Date.parse('2199-12-31T23:59:59.999-05:00');
const clockInRange = iso => { const t = Date.parse(iso); return Number.isFinite(t) && t >= CLOCK_MIN && t <= CLOCK_MAX; };
const RUN_MAX = Date.parse('2200-12-31T23:59:59.999-05:00');
const runInRange = iso => { const t = Date.parse(iso); return Number.isFinite(t) && t >= CLOCK_MIN && t <= RUN_MAX; };

module.exports = { ZONE, MINUTE, HOUR, DAY, CLOCK_MIN, CLOCK_MAX, RUN_MAX, clockInRange, runInRange, ms, toIso, localParts, localDate, planYear, validDate, addDays, fromLocal, endOfDay, dayDeadline, hoursAfter };
