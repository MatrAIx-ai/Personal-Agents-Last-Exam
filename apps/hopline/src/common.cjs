'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {render, instantOf, addDays, parts} = require('./time.cjs');

const MIN = 60e3, DAY = 86400e3;
function find(list, key, value, code, message) {
  const item = list.find(x => x[key] === value);
  if (!item) fail(code, message);
  return item;
}
const zone = data => data.settings.time_zone;
const localDate = (data, t) => render(typeof t === 'number' ? t : Date.parse(t), zone(data)).slice(0, 10);
const stamp = (ctx, data) => render(Date.parse(ctx.virtual_now), zone(data));
const at = (data, t) => render(t, zone(data));
const weekday = date => parts(Date.parse(date + 'T12:00:00Z'), 'UTC').weekday; // 1 = Monday ... 7 = Sunday
const hhmm = (data, t) => render(t, zone(data)).slice(11, 16);

// Next sequential ID for a prefix: one more than the highest number used (never reused).
function nextId(list, key, prefix) {
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\~]/g, '\\$&') + '-(\\d+)$');
  const top = list.reduce((m, x) => { const r = re.exec(x[key] || ''); return r ? Math.max(m, +r[1]) : m; }, 0);
  return prefix + '-' + (top + 1);
}
// Trigger key (subscription_id, source_id, source_version, recipient); the readable ID derives from it
// and is the Messaging request_id, e.g. n-sub3-fac-el12-1-dana.
const triggerKey = (subscriptionId, source, recipient) => [subscriptionId, source.id, source.version ?? 0, recipient].join('|');
const notificationId = key => {
  const [sub, id, version, recipient] = key.split('|');
  // Messaging request IDs allow [A-Za-z0-9_.:-]; replacement-card IDs contain '~', written as '.' here.
  return ['n', sub.replace(/-/g, ''), id.replace(/~/g, '.'), version, recipient.replace(/^person-/, '')].join('-');
};
const money = cents => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);
// "Mon Dec 7, 06:40 EST" in the network's zone.
function human(data, t) {
  const d = new Date(typeof t === 'number' ? t : Date.parse(t));
  const f = new Intl.DateTimeFormat('en-US', {timeZone: zone(data), weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'});
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.timeZoneName}`;
}
// Calendar dates (and the date part of date-times) must exist: the schema pattern accepts 2026-02-30.
function checkDates(value, code) {
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})(T|$)/.exec(value), t = m && Date.parse(m[1] + 'T00:00:00Z');
    if (m && (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== m[1])) fail(code, 'No such date: ' + m[1] + '.');
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) checkDates(v, code);
}
// Monday 00:00 local of the week containing t.
function weekStart(data, t) {
  const date = localDate(data, t);
  return instantOf(addDays(date, 1 - weekday(date)), '00:00', zone(data));
}

module.exports = {fail, copy, log, MIN, DAY, find, zone, localDate, stamp, at, weekday, hhmm, nextId, triggerKey, notificationId,
  money, human, checkDates, weekStart, render, instantOf, addDays, parts};
