'use strict';
// Small shared helpers: errors, time arithmetic on the environment clock, generated IDs,
// the activity log and item history. No business rule lives here.

const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const copy = value => JSON.parse(JSON.stringify(value));
const ms = ts => Date.parse(ts);
const GB = 1e9;
const BATCH_LIMIT = 50;

// Add milliseconds to a timestamp and keep its UTC offset spelling (or Z).
function shift(ts, delta) {
  const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(ts);
  const offsetMin = !m || m[1] === 'Z' ? 0 : (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]));
  const local = new Date(ms(ts) + delta + offsetMin * 60000).toISOString().slice(0, 19);
  return local + (m ? m[1] : 'Z');
}
const addDays = (ts, days) => shift(ts, days * 86400000);

// Offset (ms) of an IANA time zone at an instant, through Node's built-in Intl.
const formatters = new Map();
function zoneOffset(instant, zone) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}));
  }
  const p = Object.fromEntries(formatters.get(zone).formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(instant / 1000) * 1000;
}
// The instant at which a local calendar day starts in a zone (handles daylight-saving changes).
function localDayStart(date, zone) {
  const [y, mo, d] = date.split('-').map(Number), guess = Date.UTC(y, mo - 1, d);
  let t = guess - zoneOffset(guess, zone);
  const second = guess - zoneOffset(t, zone);
  if (second !== t) t = second;
  return t;
}
function localDate(ts, zone) {
  const t = ms(ts), local = new Date(t + zoneOffset(t, zone));
  return local.toISOString().slice(0, 10);
}
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function nextDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
// A window bound is a date-time with an offset, or a local date in the account's zone.
// `start` of a date is that day's first instant; `end` of a date includes that whole day.
function windowBounds(start, end, zone) {
  const lo = start === undefined ? -Infinity : isDate(start) ? localDayStart(start, zone) : ms(start);
  const hi = end === undefined ? Infinity : isDate(end) ? localDayStart(nextDate(end), zone) : ms(end);
  if (lo > hi || (isDate(start) && isDate(end) && end < start)) fail('invalid_window', 'The window ends before it starts.');
  return {lo, hi};
}

// Generated IDs: a fixed prefix plus the next number not used by any existing ID of that prefix.
function nextId(ids, prefix) {
  let max = 0;
  const re = new RegExp('^' + prefix + '(\\d+)$');
  for (const id of ids) { const m = re.exec(id); if (m) max = Math.max(max, Number(m[1])); }
  return prefix + String(max + 1).padStart(4, '0');
}

// One activity row; returns its sequence number so effect rows can point at their cause.
function activity(ctx, data, row) {
  const seq = (data.activity.length ? data.activity[data.activity.length - 1].seq : 0) + 1;
  data.activity.push({seq, at: ctx.virtual_now, actor: row.actor, action: row.action, object_ids: row.object_ids || [],
    request_id: row.request_id ?? null, event_id: row.event_id ?? null, warnings: row.warnings || [],
    ...(row.cause_seq ? {cause_seq: row.cause_seq} : {}), ...(row.details ? {details: row.details} : {})});
  return seq;
}
function history(ctx, item, action, {request_id = null, event_id = null, changes} = {}) {
  item.history.push({at: ctx.virtual_now, action, actor: event_id ? 'event' : 'agent', request_id, event_id, ...(changes ? {changes} : {})});
}
const byId = list => new Map(list.map(x => [x.id, x]));
const person = (data, id) => data.people.find(p => p.person_id === id) || null;
const nameOf = (data, id) => person(data, id)?.display_name || id;

module.exports = {fail, copy, ms, GB, BATCH_LIMIT, shift, addDays, zoneOffset, localDayStart, localDate, isDate, nextDate, windowBounds,
  nextId, activity, history, byId, person, nameOf};
