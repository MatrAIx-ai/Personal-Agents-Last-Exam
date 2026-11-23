'use strict';
const crypto = require('node:crypto');
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

function find(list, key, value, code, message) {
  const item = list.find(x => x[key] === value);
  if (!item) fail(code, message);
  return item;
}
const place = (data, id) => find(data.places, 'place_id', id, 'place_not_found', 'Place does not exist in this run.');
const zone = (data, id) => find(data.zones, 'zone_id', id, 'invalid_seed', 'Unknown forecast zone.');
const rule = (data, id) => find(data.rules, 'rule_id', id, 'rule_not_found', 'Rule does not exist in this account.');
const savedPlace = (data, id) => find(data.saved_places, 'saved_place_id', id, 'saved_place_not_found', 'Saved place does not exist.');

// Next sequential ID with a prefix: one more than the highest number ever used, counting IDs that other
// records still refer to, so a removed record's ID is never handed out again.
function nextId(list, key, prefix, referenced = []) {
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  const top = [...list.map(x => x[key]), ...referenced].reduce((m, id) => { const r = re.exec(id || ''); return r ? Math.max(m, +r[1]) : m; }, 0);
  return prefix + '-' + (top + 1);
}

// Stable ID derived from a trigger key: identical after a reset, so Messaging deduplicates republishing.
const notificationId = key => 'ntf-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

// Effective notification status at a virtual time: a quiet-hour hold reads as pending from release_at on.
function effectiveStatus(n, now) {
  if (n.status === 'held_quiet_hours' && n.release_at && Date.parse(now) >= Date.parse(n.release_at)) return 'pending_delivery';
  return n.status;
}

module.exports = {fail, copy, log, find, place, zone, rule, savedPlace, nextId, notificationId, effectiveStatus};
