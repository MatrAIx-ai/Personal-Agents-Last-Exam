'use strict';
const PROJECTION = Symbol('projection');
const STEP = Symbol('step');
const PREFIXES = ['ir', 'eob', 'ap', 'gr', 'cf', 'n'];
const COUNTER = /^(0|[1-9][0-9]{0,14})$/;
const VERSION_MAX = Number.MAX_SAFE_INTEGER;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clone = value => structuredClone(value);
const textLength = text => [...text].length;
const byId = (list, key, id) => list.find(r => r[key] === id) || null;
const sortBy = key => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
const money = cents => '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');

function taken(data) {
  return new Set([
    ...data.info_requests.map(r => r.info_request_id), ...data.eobs.map(e => e.eob_id), ...data.appeals.map(a => a.appeal_id),
    ...data.grants.map(g => g.grant_id), ...data.approvals.map(a => a.approval_id), ...data.notices.map(n => n.notice_id),
  ]);
}

function advance(data, key) {
  if (!data.issued) data.issued = {};
  const current = data.issued[key] ?? '0';
  if (!COUNTER.test(current)) fail('invalid_state', 'Counter ' + key + ' is not a decimal string.');
  const next = (BigInt(current) + 1n).toString();
  data.issued[key] = next;
  return next;
}

function nextId(data, prefix) {
  if (!PREFIXES.includes(prefix)) fail('invalid_state', 'Unknown ID prefix ' + prefix + '.');
  const used = taken(data);
  for (;;) {
    const id = prefix + '-' + advance(data, prefix);
    if (!used.has(id)) return id;
  }
}

const nextSeq = data => advance(data, 'seq');
const nextPost = data => advance(data, 'post');
const nextFile = data => advance(data, 'file');
const compareSeq = (a, b) => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };

const newStep = data => { data[STEP] = new Set(); };
function bump(data, record, key, field) {
  if (!data[STEP]) data[STEP] = new Set();
  const tag = field + ':' + record[key];
  if (data[STEP].has(tag)) return;
  if (record[field] >= VERSION_MAX) {
    if (!data[PROJECTION]) fail('invalid_state', 'Record ' + record[key] + ' has reached its version limit.');
    return;
  }
  data[STEP].add(tag);
  record[field]++;
}

module.exports = { PROJECTION, PREFIXES, COUNTER, VERSION_MAX, fail, clone, textLength, byId, sortBy, money, nextId, nextSeq, nextPost, nextFile, compareSeq, newStep, bump };
