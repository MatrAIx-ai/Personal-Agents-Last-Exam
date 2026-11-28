'use strict';
const PROJECTION = Symbol('projection');
const RESERVED = Symbol('reserved');
const MAX_ID = 999999999;
const PREFIXES = ['f', 'cl', 'pr', 'rn', 'g', 'ap', 'au', 'ch', 'rf', 'n'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clone = value => structuredClone(value);
const textLength = text => [...text].length;

function allIds(data) {
  return [
    ...data.fills.map(f => f.fill_id), ...data.fills.flatMap(f => f.refusals.map(r => r.refusal_id)),
    ...data.claims.map(c => c.claim_id), ...data.plan_requests.map(r => r.plan_request_id), ...data.renewals.map(r => r.renewal_id),
    ...data.grants.map(g => g.grant_id), ...data.approvals.map(a => a.approval_id), ...data.authorizations.map(a => a.authorization_id),
    ...data.charges.map(c => c.charge_id), ...data.notices.map(n => n.notice_id),
  ];
}

function nextId(data, prefix) {
  if (!PREFIXES.includes(prefix)) fail('invalid_state', 'Unknown ID prefix ' + prefix + '.');
  const taken = new Set(allIds(data));
  if (!data.issued) data.issued = {};
  let next = (data.issued[prefix] || 0) + 1;
  while (taken.has(prefix + '-' + next)) next++;
  if (next > MAX_ID) {
    if (!data[PROJECTION]) fail('invalid_state', 'This account has issued every ' + prefix + ' ID it can; no further records can be created.');
    if (!data[RESERVED]) data[RESERVED] = new Set();
    let k = 1;
    while (taken.has(prefix + '-projected-' + k) || data[RESERVED].has(prefix + '-projected-' + k)) k++;
    data[RESERVED].add(prefix + '-projected-' + k);
    return prefix + '-projected-' + k;
  }
  data.issued[prefix] = next;
  return prefix + '-' + next;
}

const STEP = Symbol('step');
const VERSION_MAX = Number.MAX_SAFE_INTEGER;
const newStep = data => { data[STEP] = new Set(); };
function bump(data, record, key = 'fill_id', field = 'fill_version') {
  if (!data[STEP]) data[STEP] = new Set();
  const tag = key + ':' + record[key];
  if (data[STEP].has(tag)) return;
  if (record[field] >= VERSION_MAX) {
    if (!data[PROJECTION]) fail('invalid_state', 'Record ' + record[key] + ' has reached its version limit; no further changes can be recorded.');
    return;
  }
  data[STEP].add(tag);
  record[field]++;
}
const byId = (list, key, id) => list.find(r => r[key] === id) || null;
const sortBy = key => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
const money = cents => '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');

module.exports = { fail, clone, textLength, nextId, allIds, PROJECTION, PREFIXES, MAX_ID, VERSION_MAX, newStep, bump, byId, sortBy, money };
