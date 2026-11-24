'use strict';
// Shared App-owned helpers: lookups, access decisions and append-only business history.
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;
const TERMINAL = ['delivered', 'collected', 'returned'];

const ms = value => Date.parse(value);
const now = ctx => {
  const at = ms(ctx.virtual_now);
  if (!Number.isFinite(at)) fail('invalid_time', 'The run clock is not a valid time.');
  return at;
};
const iso = value => new Date(value).toISOString();
const name = tool => tool.slice(APP.length + 1);

function byId(list, id, label) {
  const item = list.find(x => x.id === id);
  if (!item) fail('not_found', label + ' does not exist.');
  return item;
}
const shipmentOf = (data, id) => byId(data.shipments, id, 'Parcel');
const pointOf = (data, id) => byId(data.pickup_points, id, 'Pickup point');
const policyOf = (data, shipment) => byId(data.policies, shipment.policy_id, 'Policy profile');
const personName = (ctx, personId) => ctx.binding.people.find(p => p.person_id === personId)?.name ?? null;

// A grant authorizes its collector only while it is active and unexpired, for the
// parcel's current pickup epoch and point. Status alone is not enough: time can pass
// the expiry before any event materializes it.
function liveGrant(ctx, shipment, grant) {
  return grant.status === 'active' && shipment.status === 'at_pickup' && shipment.pickup &&
    grant.pickup_epoch === shipment.pickup.epoch && grant.point_id === shipment.pickup.point_id &&
    now(ctx) < ms(grant.expires_at);
}

// 'recipient', 'delegate' or null. Unknown and unauthorized parcels are reported identically
// so tracking numbers or IDs alone reveal nothing.
function accessTo(ctx, data, shipment) {
  const person = data.owner_person_id;
  if (shipment.recipient_person_id === person) return 'recipient';
  const delegated = data.grants.some(g => g.shipment_id === shipment.id && g.collector_person_id === person && liveGrant(ctx, shipment, g));
  return delegated ? 'delegate' : null;
}
function visibleShipment(ctx, data, id, {recipientOnly = false} = {}) {
  const shipment = data.shipments.find(s => s.id === id);
  const access = shipment && accessTo(ctx, data, shipment);
  if (!access || (recipientOnly && access !== 'recipient')) fail('not_found', 'Parcel does not exist in this account.');
  return {shipment, access};
}

function nextId(list, prefix) {
  const used = new Set(list.map(x => x.id));
  let n = list.length + 1;
  while (used.has(prefix + String(n).padStart(3, '0'))) n++;
  return prefix + String(n).padStart(3, '0');
}

function touch(record, at, action) {
  if (ms(at) < ms(record.updated_at)) fail('invalid_time', 'The run clock must not precede the last record update.');
  record.updated_at = at;
  record.history.push({at, action});
}
function timeline(shipment, at, kind, summary, action = kind) {
  touch(shipment, at, action);
  shipment.timeline.push({at, kind, summary});
}
function notify(ctx, data, {shipment_id = null, at, type, audience, message}) {
  const notice = {id: nextId(data.notices, 'N'), account_id: data.account_id, shipment_id, at, type, audience: [...new Set(audience)], message};
  data.notices.push(notice);
  log(ctx, APP + '.notice', {notice_id: notice.id, shipment_id, type});
  return notice;
}

module.exports = {APP, TERMINAL, fail, copy, references, log, ms, now, iso, name, byId, shipmentOf, pointOf, policyOf,
  personName, liveGrant, accessTo, visibleShipment, nextId, touch, timeline, notify};
