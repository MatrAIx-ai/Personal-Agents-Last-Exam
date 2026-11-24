'use strict';
// Collection credentials: passes, collector grants and the rules that end them. A pass is a
// synthetic business record bound to parcel, holder, point, pickup epoch and expiry. It is
// reproducible from the ledger and is not a platform authentication token.
const crypto = require('node:crypto');
const c = require('./common.cjs');

function passCode(data, s, holder, passId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.createHash('sha256').update([s.id, s.pickup.epoch, holder, passId].join('|')).digest();
  const code = [...bytes.subarray(0, 8)].map(b => alphabet[b % alphabet.length]).join('');
  return code.slice(0, 4) + '-' + code.slice(4);
}
function issuePass(data, s, at, holder, expiresAt, grantId = null) {
  const id = c.nextId(data.passes, 'PASS');
  const pass = {id, shipment_id: s.id, holder_person_id: holder, grant_id: grantId, point_id: s.pickup.point_id,
    pickup_epoch: s.pickup.epoch, code: passCode(data, s, holder, id), issued_at: at, expires_at: expiresAt, status: 'active', ended_at: null, end_reason: null};
  data.passes.push(pass);
  return pass;
}
function endPass(pass, at, status, reason) {
  pass.status = status;
  pass.ended_at = at;
  pass.end_reason = reason;
}
// Ending a grant always ends the pass issued under it.
function endGrant(data, grant, at, status, reason) {
  grant.status = status;
  grant.ended_at = at;
  grant.end_reason = reason;
  grant.history.push({at, action: status});
  for (const pass of data.passes) {
    if (pass.grant_id === grant.id && pass.status === 'active') endPass(pass, at, status === 'consumed' ? 'consumed' : 'invalidated', reason);
  }
}
// Leaving a pickup arrangement (plan change, relocation, return or handoff) ends its readiness
// and every credential issued for it in one step. `consumed` is the pass used for a handoff.
function endPickup(data, s, at, reason, {consumed = null} = {}) {
  for (const grant of data.grants) {
    if (grant.shipment_id !== s.id || grant.status !== 'active') continue;
    const used = Boolean(consumed) && consumed.grant_id === grant.id;
    endGrant(data, grant, at, used ? 'consumed' : 'invalidated', used ? 'collected' : reason);
  }
  for (const pass of data.passes) {
    if (pass.shipment_id !== s.id || pass.status !== 'active') continue;
    endPass(pass, at, pass === consumed ? 'consumed' : 'invalidated', pass === consumed ? 'collected' : reason);
  }
  s.pickup = null;
}

module.exports = {issuePass, endPass, endGrant, endPickup};
