'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const ms = value => Date.parse(value);

function find(list, id, label) {
  const item = list.find(r => r.id === id);
  if (!item) fail('not_found', label + ' does not exist in this account.');
  return item;
}

// Booking, notice, ledger and charge IDs share one namespace so a reference is never ambiguous.
const allIds = data => new Set([...data.bookings, ...data.notices, ...data.ledger, ...data.charges].map(r => r.id));
function nextId(data, prefix) {
  const ids = allIds(data);
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// Every booking and notice keeps an append-only history ending at updated_at.
function stamp(ctx, record, action, details = {}) {
  if (!Number.isFinite(ms(ctx.virtual_now)) || ms(ctx.virtual_now) < ms(record.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
  record.history.push({at:ctx.virtual_now, action});
  log(ctx, 'skyline.' + action, {record_id:record.id, ...details});
}

// Local times: every flight time carries the UTC offset of its airport's zone at that instant.
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
const minutes = (from, to) => (ms(to) - ms(from)) / 60000;

module.exports = {fail, copy, log, ms, find, allIds, nextId, stamp, validTimeZone, localIn, localDate, minutes};
