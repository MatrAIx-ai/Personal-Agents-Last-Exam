'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const ms = value => Date.parse(value);

function find(list, id, label) {
  const item = list.find(r => r.id === id);
  if (!item) fail('not_found', label + ' does not exist in this account.');
  return item;
}

function nextId(list, prefix) {
  const ids = new Set(list.map(r => r.id));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// Request numbers continue after the highest one on file; the signature shares the number.
const numberOf = id => Number(id.slice(id.indexOf('-') + 1));
function nextRequestNumber(data) {
  return data.requests.reduce((max, r) => Math.max(max, numberOf(r.id)), 0) + 1;
}
const requestId = n => 'req-' + String(n).padStart(4, '0');
const signatureIdFor = reqId => 'sig-' + reqId.slice(4);

// Every request keeps an append-only history ending at updated_at.
function stamp(ctx, record, action, details = {}) {
  if (!Number.isFinite(ms(ctx.virtual_now)) || ms(ctx.virtual_now) < ms(record.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
  record.history.push({at:ctx.virtual_now, action});
  log(ctx, 'passage.' + action, {record_id:record.id, ...details});
}

module.exports = {fail, copy, log, ms, find, nextId, numberOf, nextRequestNumber, requestId, signatureIdFor, stamp};
