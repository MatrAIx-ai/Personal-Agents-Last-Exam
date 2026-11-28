'use strict';
const {fail, copy, ms, sum, references} = require('./domain-utils.cjs');
const time = require('./time.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;

const zone = data => data.project.timezone;
const dayOf = (data, value) => time.localDay(ms(value), zone(data));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byTime = key => (a, b) => ms(a[key]) - ms(b[key]) || compare(a.id, b.id);
// GPU-hours are numbers with at most two decimals outside the App and integer hundredths inside it.
const hundredths = value => Math.round(value * 100);
const hours = value => value / 100;
const twoDecimals = value => Number.isFinite(value) && Math.round(value * 100) / 100 === value;
// Text for hundredths: "1,240" or "92.5".
const hoursText = value => (value / 100).toLocaleString('en-US', {maximumFractionDigits: 2});
const find = (list, id, label) => list.find(x => x.id === id) || fail('not_found', 'No ' + label + ' has the ID ' + id + '.');
const person = (data, id) => data.people.find(p => p.person_id === id) || null;
const nameOf = (data, id) => (person(data, id) || {name: id}).name;
const isOwner = (data, id) => id === data.owner_person_id;

// Records of the lab and of the account. People, partitions, the allocation, notifications and activity rows belong to the setup or to these records.
const RECORDS = ['configs', 'protocols', 'run_plans', 'jobs', 'tables', 'allocation_changes'];
function allIds(data) {
  const ids = [];
  for (const key of RECORDS) ids.push(...data[key].map(x => x.id));
  ids.push(...data.notifications.map(x => x.id), ...data.partitions.map(x => x.id), ...data.people.map(x => x.person_id),
    data.allocation.period_id, ...data.past_periods.map(x => x.period_id));
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
const mark = (t, list, action, extra = {}) => list.push({at: t.at, action, actor: t.actor, ref: t.ref, ...extra});
module.exports = {APP, fail, copy, ms, sum, references, time, log, zone, dayOf, compare, byTime, hundredths, hours, twoDecimals, hoursText,
  find, person, nameOf, isOwner, RECORDS, allIds, nextId, record, mark};
