'use strict';
const {fail, copy, ms, cents, money, twoDecimals, sum, references} = require('./domain-utils.cjs');
const time = require('./time.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;

const zone = data => data.issuer.timezone;
const today = (data, now) => time.localDay(now, zone(data));
const dayOf = (data, value) => time.localDay(ms(value), zone(data));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byTime = key => (a, b) => ms(a[key]) - ms(b[key]) || compare(a.id, b.id);
// Text for cents: "1,240.00".
const amountText = value => (value / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pointsText = value => value.toLocaleString('en-US');
const find = (list, id, label) => list.find(x => x.id === id) || fail('not_found', 'No ' + label + ' has this ID.');
const productOf = data => data.products.find(p => p.id === data.account.product_id);
const closed = data => data.account.state === 'closed';

const RECORDS = ['statements', 'transactions', 'payments', 'disputes', 'offers', 'points_entries'];
function allIds(data) {
  const ids = [];
  for (const key of RECORDS) ids.push(...data[key].map(x => x.id));
  ids.push(...data.notifications.map(x => x.id), ...data.products.map(x => x.id));
  return ids;
}
// IDs made by the App: a prefix and the next number after the highest one in use.
function nextId(ids, prefix, width = 4) {
  const taken = new Set(ids);
  let next = 1;
  for (const id of taken) {
    if (id.startsWith(prefix) && /^\d{1,12}$/.test(id.slice(prefix.length))) next = Math.max(next, Number(id.slice(prefix.length)) + 1);
  }
  while (taken.has(prefix + String(next).padStart(width, '0'))) next++;
  return prefix + String(next).padStart(width, '0');
}
// One activity row for a write, an event or one of their effects. `history` is the list of the object that keeps one more row.
function record(t, data, action, objectId, effect = false, history = null, extra = {}) {
  data.activity.push({seq: data.activity.length ? data.activity[data.activity.length - 1].seq + 1 : 1, at: t.at, actor: t.actor,
    action, object_id: objectId, request_id: t.actor === 'agent' ? t.ref : null, event_id: t.actor === 'event' ? t.ref : null, effect});
  if (history) history.push({at: t.at, action, actor: t.actor, ref: t.ref, ...extra});
  log(t.ctx, APP + '.' + action, {object_id: objectId});
}
module.exports = {APP, fail, copy, ms, cents, money, twoDecimals, sum, references, time, log, zone, today, dayOf, compare, byTime, amountText, pointsText,
  find, productOf, closed, RECORDS, allIds, nextId, record};
