'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const ms = value => Date.parse(value);

function nextId(list, prefix) {
  const ids = new Set(list.map(r => r.id));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// Every record with a history keeps an append-only list ending at updated_at.
function stamp(ctx, record, action, details = {}) {
  if (!Number.isFinite(ms(ctx.virtual_now)) || ms(ctx.virtual_now) < ms(record.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
  record.history.push({at:ctx.virtual_now, action});
  log(ctx, 'confdesk.' + action, details);
}

const thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const money = (cents, currency) => currency + ' ' + thousands(Math.floor(cents / 100)) + '.' + String(cents % 100).padStart(2, '0');

module.exports = {fail, copy, log, ms, nextId, stamp, money};
