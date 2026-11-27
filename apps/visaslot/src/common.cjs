'use strict';
// Shared helpers: lookups, explicit calendar arithmetic and consulate-local time. Nothing here
// reads the host clock; "now" is always ctx.virtual_now.
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const DAY = 86400000;
const ms = value => Date.parse(value);
const sameInstant = (a, b) => ms(a) === ms(b);

function find(list, id, label) {
  const item = list.find(r => r.id === id);
  if (!item) fail('not_found', label + ' ' + id + ' does not exist in this account.');
  return item;
}

// Calendar dates (YYYY-MM-DD) compared as strings once validated.
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
function validDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= daysInMonth(+m[1], +m[2]);
}
const dayNumber = value => Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)) / DAY;
const addDays = (value, n) => new Date((dayNumber(value) + n) * DAY).toISOString().slice(0, 10);
const nightsBetween = (from, to) => dayNumber(to) - dayNumber(from);
// The nights of a stay: from its first date up to the day before its last date.
const nights = (from, to) => Array.from({length:Math.max(0, nightsBetween(from, to))}, (_, i) => addDays(from, i));

// Consulate-local time: every slot carries the UTC offset of the consulate's zone at that instant.
const zoneFormats = new Map();
function validTimeZone(zone) {
  try { new Intl.DateTimeFormat('en-US', {timeZone:zone}); return true; } catch { return false; }
}
function zoneOffset(zone, instant) {
  if (!zoneFormats.has(zone)) zoneFormats.set(zone, new Intl.DateTimeFormat('en-US', {timeZone:zone, timeZoneName:'longOffset'}));
  const name = zoneFormats.get(zone).formatToParts(new Date(instant)).find(p => p.type === 'timeZoneName').value;
  const m = name.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
function writtenOffset(iso) {
  const m = String(iso).match(/(Z|[+-]\d{2}:\d{2})$/i);
  if (!m) return NaN;
  return /^z$/i.test(m[1]) ? 0 : (m[1][0] === '-' ? -1 : 1) * (Number(m[1].slice(1, 3)) * 60 + Number(m[1].slice(4)));
}
const localIn = (zone, iso) => Number.isFinite(ms(iso)) && writtenOffset(iso) === zoneOffset(zone, ms(iso));
const localDate = (zone, iso) => new Date(ms(iso) + zoneOffset(zone, ms(iso)) * 60000).toISOString().slice(0, 10);

module.exports = {fail, copy, log, DAY, ms, sameInstant, find, validDate, addDays, nightsBetween, nights,
  validTimeZone, localIn, localDate};
