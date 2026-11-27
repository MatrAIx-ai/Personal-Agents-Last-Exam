'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {render, instantOf, addDays, parts} = require('./time.cjs');

function find(list, key, value, code, message) {
  const item = list.find(x => x[key] === value);
  if (!item) fail(code, message);
  return item;
}
const premise = (data, id) => find(data.premises, 'premise_id', id, 'premise_not_found', 'Premise does not exist.');
const area = (data, id) => find(data.areas, 'area_id', id, 'invalid_seed', 'Unknown area.');
const zoneOf = (data, premiseId) => area(data, premise(data, premiseId).area_id).time_zone;
const localDate = (instant, zone) => render(typeof instant === 'number' ? instant : Date.parse(instant), zone).slice(0, 10);
const dayOfWeek = date => parts(Date.parse(date + 'T12:00:00Z'), 'UTC').weekday; // 1 = Monday … 7 = Sunday
const isBusinessDay = (data, date) => dayOfWeek(date) <= 5 && !data.holidays.includes(date);
function addBusinessDays(data, date, n) {
  let d = date, left = n;
  while (left > 0) { d = addDays(d, 1); if (isBusinessDay(data, d)) left--; }
  return d;
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
const daysInMonth = date => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate();

// Next sequential ID: one more than the highest number used for that prefix (never reused).
function nextId(list, key, prefix) {
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
  const top = list.reduce((m, x) => { const r = re.exec(x[key] || ''); return r ? Math.max(m, +r[1]) : m; }, 0);
  return prefix + '-' + (top + 1);
}
// Trigger key (type, source_id, source_version, recipient); the readable ID derives from it and is the Messaging request_id.
const triggerKey = (type, source, recipient) => [type, source.id, source.version ?? 0, recipient].join('|');
const notificationId = key => {
  const [, id, version, recipient] = key.split('|');
  return ['n', id, version, recipient.replace(/^person-/, '')].join('-');
};
// Calendar dates (and the date part of date-times) must exist: the schema pattern accepts 2027-02-30.
function checkDates(value, code) {
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})(T|$)/.exec(value);
    const t = m && Date.parse(m[1] + 'T00:00:00Z');
    if (m && (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== m[1])) fail(code, 'No such date: ' + m[1] + '.');
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) checkDates(v, code);
}
const money = cents => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);
const stamp = (ctx, data) => render(Date.parse(ctx.virtual_now), data.preferences.time_zone);

module.exports = {fail, copy, log, find, premise, area, zoneOf, localDate, dayOfWeek, isBusinessDay, addBusinessDays, daysBetween,
  daysInMonth, nextId, checkDates, triggerKey, notificationId, money, stamp, render, instantOf, addDays};
