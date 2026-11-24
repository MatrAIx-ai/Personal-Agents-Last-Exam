'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const ms = value => Date.parse(value);

function find(list, id, label) {
  const item = list.find(r => r.id === id);
  if (!item) fail('not_found', label + ' does not exist in this account.');
  return item;
}

// Ledger entries, transfers and bonuses share one ID namespace so a reference is never ambiguous.
function nextId(data, prefix) {
  const ids = new Set([...data.ledger, ...data.transfers, ...data.bonuses].map(r => r.id));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// Every record keeps an append-only history ending at updated_at.
function stamp(ctx, record, action, details = {}) {
  if (!Number.isFinite(ms(ctx.virtual_now)) || ms(ctx.virtual_now) < ms(record.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
  record.history.push({at:ctx.virtual_now, action});
  log(ctx, 'waypoint.' + action, {record_id:record.id, ...details});
}

// Append one ledger entry and move the balance with it. The balance can never go negative.
function post(ctx, data, entry) {
  const last = data.ledger[data.ledger.length - 1];
  if (last && ms(ctx.virtual_now) < ms(last.at)) fail('invalid_time', 'The ledger cannot go back in time.');
  const balance = data.balance + entry.points;
  if (balance < 0) fail('insufficient_points', 'The balance does not cover ' + (-entry.points) + ' points.');
  const row = {id:entry.id || nextId(data, 'ledger'), at:ctx.virtual_now, kind:entry.kind, points:entry.points,
    balance_after:balance, description:entry.description || '', ref:entry.ref ?? null};
  data.ledger.push(row);
  data.balance = balance;
  log(ctx, 'waypoint.ledger_posted', {record_id:row.id, kind:row.kind});
  return row;
}

// Minutes after an RFC 3339 time, keeping its UTC offset spelling.
function addMinutes(iso, minutes) {
  if (!minutes) return iso;
  const [, offset] = iso.match(/(Z|[+-]\d{2}:\d{2})$/i);
  const offsetMinutes = /^z$/i.test(offset) ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)));
  const local = new Date(ms(iso) + (minutes + offsetMinutes) * 60000).toISOString().slice(0, 19);
  return local + (/^z$/i.test(offset) ? 'Z' : offset);
}

module.exports = {fail, copy, log, ms, find, nextId, stamp, post, addMinutes};
