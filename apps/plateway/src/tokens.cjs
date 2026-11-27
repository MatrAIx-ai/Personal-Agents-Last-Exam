'use strict';
const crypto = require('node:crypto');
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
};
const BOOKKEEPING = new Set(['token', 'request_id', 'expected_version']);
function token(ctx, data, action, args, changes) {
  const business = Object.fromEntries(Object.entries(args).filter(([k]) => !BOOKKEEPING.has(k)));
  const material = { actor: data.owner_person_id, action, args: business, run_id: ctx.run_id, seed_id: data.seed_id, changes };
  return crypto.createHash('sha256').update(canonical(material)).digest('hex');
}
module.exports = { token, canonical };
