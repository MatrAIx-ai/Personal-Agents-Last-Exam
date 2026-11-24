'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const ms = value => Date.parse(value);

function find(list, id, label) {
  const item = list.find(r => r.id === id);
  if (!item) fail('not_found', label + ' does not exist in this account.');
  return item;
}

// Hotels, reservations and charges share one ID namespace so a reference is never ambiguous.
const recordIds = data => [...data.hotels, ...data.reservations, ...data.charges].map(r => r.id);
function nextId(data, prefix) {
  const ids = new Set(recordIds(data));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// Every hotel and reservation keeps an append-only history ending at updated_at.
function stamp(ctx, record, action, details = {}) {
  if (!Number.isFinite(ms(ctx.virtual_now)) || ms(ctx.virtual_now) < ms(record.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
  record.history.push({at:ctx.virtual_now, action});
  log(ctx, 'roomline.' + action, {record_id:record.id, ...details});
}

const eur = cents => 'EUR ' + (cents < 0 ? '-' : '') + Math.floor(Math.abs(cents) / 100) + '.' + String(Math.abs(cents) % 100).padStart(2, '0');

module.exports = {fail, copy, log, ms, find, recordIds, nextId, stamp, eur};
