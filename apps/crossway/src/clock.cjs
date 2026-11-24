'use strict';
// Authority time. Crossway's toll authority keeps US Eastern time (America/New_York
// rules: daylight time from 02:00 on the second Sunday of March to 02:00 on the
// first Sunday of November). The rules are computed here, without a time-zone
// database or the host's TZ, so results are the same on every machine.
const {fail} = require('./domain-utils.cjs');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ms(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) fail('invalid_time', 'Invalid timestamp.');
  return t;
}

function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

// UTC offset of authority time at an instant, in minutes.
function offsetMinutes(t) {
  const y = new Date(t).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);
  return t >= start && t < end ? -240 : -300;
}

function formatOffset(m) {
  const a = Math.abs(m);
  return (m < 0 ? '-' : '+') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
}

// An instant written in authority time, e.g. 2026-11-10T00:00:00-05:00.
function stamp(t) {
  const off = offsetMinutes(t);
  return new Date(t + off * MINUTE).toISOString().slice(0, 19) + formatOffset(off);
}

// Authority calendar date of an instant.
function localDate(t) {
  return new Date(t + offsetMinutes(t) * MINUTE).toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

// Instant of 00:00 authority time on a date. Midnight never falls inside a
// daylight-time change (those happen at 02:00), so one probe is enough.
function midnight(date) {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base)) fail('invalid_time', 'Invalid date.');
  return base - offsetMinutes(base + 5 * HOUR) * MINUTE;
}

// 'YYYY-MM' helpers for monthly statements.
function monthOf(date) {
  return date.slice(0, 7);
}

function nextMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

module.exports = {MINUTE, HOUR, DAY, ms, offsetMinutes, stamp, localDate, addDays, daysBetween, midnight, monthOf, nextMonth, validDate};
