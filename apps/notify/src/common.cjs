'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const ms = value => Date.parse(value);

function find(list, id, label) {
  const item = list.find(r => r.id === id);
  if (!item) fail('not_found', label + ' does not exist in this account.');
  return item;
}

// Reminder and feed IDs share one namespace so a reference is never ambiguous.
function nextId(data, prefix) {
  const ids = new Set([...data.reminders, ...data.feed].map(r => r.id));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// Every record (and the device) keeps an append-only history ending at updated_at.
function stamp(ctx, record, action, details = {}) {
  if (!Number.isFinite(ms(ctx.virtual_now)) || ms(ctx.virtual_now) < ms(record.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
  record.history.push({at:ctx.virtual_now, action});
  log(ctx, 'notify.' + action, {record_id:record.id || 'device', ...details});
}

// Shift an RFC 3339 time by deltaMs and keep its original UTC offset spelling.
function shift(iso, deltaMs) {
  const offset = iso.match(/(Z|[+-]\d{2}:\d{2})$/)[1];
  const minutes = offset === 'Z' ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)));
  const local = new Date(ms(iso) + deltaMs + minutes * 60000).toISOString().slice(0, 19);
  return local + offset;
}

module.exports = {fail, copy, log, ms, find, nextId, stamp, shift};
