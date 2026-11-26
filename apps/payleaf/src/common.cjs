'use strict';
const {fail, copy, ms, cents, money, twoDecimals, tenths, fromTenths, oneDecimal, sum, references} = require('./domain-utils.cjs');
const time = require('./time.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;

const zone = data => data.employer.timezone;
const today = (data, now) => time.localDay(now, zone(data));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Text for cents and tenths of an hour: "2,280.00" and "32.0".
const amountText = value => (value / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const hoursText = value => (value / 10).toFixed(1);
// A working day is Monday to Friday and not a company holiday.
const workingDay = (data, day) => time.weekday(day) >= 1 && time.weekday(day) <= 5 && !data.employer.holidays.includes(day);
function workingDays(data, start, end) {
  const out = [];
  for (let n = time.dayNumber(start); n <= time.dayNumber(end); n++) if (workingDay(data, time.dayString(n))) out.push(time.dayString(n));
  return out;
}
// Calendar order: cut-off, then pay date, then ID. Runs post in this order.
const calendarOrder = (a, b) => ms(a.cutoff_at) - ms(b.cutoff_at) || compare(a.pay_date, b.pay_date) || compare(a.id, b.id);
const planned = data => data.calendar.filter(e => e.state === 'planned').sort(calendarOrder);
// The run that a change made at this instant applies to: the planned run with the earliest cut-off after it.
const targetOf = (data, instant) => planned(data).find(e => ms(e.cutoff_at) > instant) || null;
const targetView = entry => entry ? {entry_id: entry.id, pay_date: entry.pay_date, cutoff_at: entry.cutoff_at} : null;

const find = (list, id, label) => list.find(x => x.id === id) || fail('not_found', 'No ' + label + ' has this ID.');
const statementOf = (data, id) => find(data.statements, id, 'pay statement');
const leaveTypeOf = (data, id) => find(data.leave_types, id, 'leave type');
const planOf = (data, id) => data.plans.find(p => p.id === id) || null;
// Every line of a statement: earnings, taxes and deductions.
const linesOf = statement => [...statement.earnings, ...statement.taxes, ...statement.deductions];
const depositsOf = data => data.statements.flatMap(s => s.deposits.map(deposit => ({statement: s, deposit})));

function allIds(data) {
  const ids = [];
  for (const list of [data.calendar, data.statements, data.changes, data.inquiries, data.leave_types, data.leave_entries, data.leave_requests,
    data.plans, data.windows, data.election_sets, data.notifications]) ids.push(...list.map(x => x.id));
  ids.push(...depositsOf(data).map(row => row.deposit.id));
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
function record(t, data, action, objectId, effect = false, history = null) {
  data.activity.push({seq: data.activity.length ? data.activity[data.activity.length - 1].seq + 1 : 1, at: t.at, actor: t.actor,
    action, object_id: objectId, request_id: t.actor === 'agent' ? t.ref : null, event_id: t.actor === 'event' ? t.ref : null, effect});
  if (history) history.push({at: t.at, action, actor: t.actor, ref: t.ref});
  log(t.ctx, APP + '.' + action, {object_id: objectId});
}
module.exports = {APP, fail, copy, ms, cents, money, twoDecimals, tenths, fromTenths, oneDecimal, sum, references, time, log, zone, today, compare, amountText, hoursText,
  workingDay, workingDays, calendarOrder, planned, targetOf, targetView, find, statementOf, leaveTypeOf, planOf, linesOf, depositsOf, allIds, nextId, record};
