'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const ms = value => Date.parse(value);

function find(list, id, label) {
  const item = list.find(r => r.id === id);
  if (!item) fail('not_found', label + ' does not exist in this account.');
  return item;
}

// Hotels, certificates, reservations and notices share one ID namespace so a reference is
// never ambiguous. Ledger entries and charges have their own lists.
function nextId(list, prefix) {
  const ids = new Set(list.map(r => r.id));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}
const recordIds = data => [...data.hotels, ...data.certificates, ...data.reservations, ...data.notices];

// Every record keeps an append-only history ending at updated_at.
function stamp(ctx, record, action, details = {}) {
  if (!Number.isFinite(ms(ctx.virtual_now)) || ms(ctx.virtual_now) < ms(record.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
  record.history.push({at:ctx.virtual_now, action});
  log(ctx, 'harbor.' + action, {record_id:record.id, ...details});
}

const thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const usd = cents => 'USD ' + (cents < 0 ? '-' : '') + thousands(Math.floor(Math.abs(cents) / 100)) + '.' + String(Math.abs(cents) % 100).padStart(2, '0');

module.exports = {fail, copy, log, ms, find, nextId, recordIds, stamp, thousands, usd};
