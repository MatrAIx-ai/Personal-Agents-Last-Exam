'use strict';
const {fail, fold, ms} = require('./util.cjs');
const d = require('./derive.cjs');
const APP = 'ribbonwell';
const PREFIX = {item: 'itm', claim: 'clm', exchange: 'exc', notification: 'ntf'};
function allIds(data) {
  return new Set([...data.members.map(m => m.member_id), ...data.groups.map(g => g.group_id), ...data.lists.map(l => l.list_id), ...data.items.map(i => i.item_id),
    ...data.claims.map(c => c.claim_id), ...data.exchanges.map(x => x.exchange_id), ...data.notifications.map(n => n.notification_id)]);
}
// Records created during a run get <prefix>-r<n>, counted per kind in commit order; an ID already in use is skipped.
function nextId(data, kind) {
  const ids = allIds(data);
  let id;
  do { data.counters[kind] += 1; id = PREFIX[kind] + '-r' + data.counters[kind]; } while (ids.has(id));
  return id;
}
function record(ctx, data, actor, action, fields = {}) {
  data.activity.push({seq: data.activity.length + 1, at: ctx.virtual_now, actor, action, object_id: null, list_id: null, exchange_id: null,
    request_id: null, event_id: null, replaced: null, unreleased_claims: null, ...fields});
}
function notify(ctx, data, kind, text, refs = {}) {
  data.notifications.push({notification_id: nextId(data, 'notification'), kind, at: ctx.virtual_now, actor_member_id: null, list_id: null, item_id: null, claim_id: null, exchange_id: null, text, ...refs});
}
const listedNameTaken = (data, listId, name, exceptItemId = null) =>
  data.items.some(i => i.list_id === listId && i.status === 'listed' && i.item_id !== exceptItemId && fold(i.name) === fold(name));
const exchangeNameTaken = (data, groupId, name, exceptId = null) =>
  data.exchanges.some(x => x.group_id === groupId && x.exchange_id !== exceptId && fold(x.name) === fold(name));
const quantityOk = q => Number.isInteger(q) && q >= 1 && q <= 20;
// Exclusion pairs are stored once each, smaller ID first. Returns null when a pair is invalid.
function cleanExclusions(group, pairs) {
  const seen = new Set(), out = [];
  for (const [a, b] of pairs) {
    if (a === b || !group.member_ids.includes(a) || !group.member_ids.includes(b)) return null;
    const key = d.pairKey(a, b);
    if (!seen.has(key)) { seen.add(key); out.push(a < b ? [a, b] : [b, a]); }
  }
  return out;
}
// A material change (name, variant, price_cents, store) or a removal is recorded on every unreleased claim.
function markClaims(data, itemId, fields) {
  const touched = [];
  for (const c of data.claims) if (c.item_id === itemId && d.isUnreleased(c)) { c.changed_fields = [...new Set([...c.changed_fields, ...fields])]; touched.push(c); }
  return touched;
}
function unmarkRemoved(data, itemId) { for (const c of data.claims) if (c.item_id === itemId) c.changed_fields = c.changed_fields.filter(f => f !== 'removed'); }
function applyItemPatch(item, patch) {
  const replaced = {}, material = [];
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(item[key]) === JSON.stringify(value)) continue;
    replaced[key] = item[key]; item[key] = value;
    if (d.MATERIAL.includes(key)) material.push(key);
  }
  return {replaced, material};
}
const windowOk = (joinBy, exchangeDate) => ms(joinBy) < ms(exchangeDate);
module.exports = {APP, fail, allIds, nextId, record, notify, listedNameTaken, exchangeNameTaken, quantityOk, cleanExclusions, markClaims, unmarkRemoved, applyItemPatch, windowOk};
