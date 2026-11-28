'use strict';
const { fail, byId } = require('./util.cjs');
const { ms } = require('./time.cjs');

function actorId(ctx, data) {
  const account = (ctx.binding?.accounts || []).find(a => a.app_id === ctx.app_id && a.account_id === data.account_id);
  if (!account) fail('not_authorized', 'No bound account holder.');
  return account.owner_person_id;
}

const inForceAt = (g, t) => ms(g.created_at) <= t && (g.expires_at === null || t < ms(g.expires_at)) && (g.status === 'active' || (g.revoked_at !== null && t < ms(g.revoked_at)));

function relation(data, person, patientId, t) {
  const patient = byId(data.people, 'person_id', patientId);
  const self = person === patientId;
  const guardian = Boolean(patient && patient.is_minor && patient.guardian_ids.includes(person));
  const grants = data.grants.filter(g => g.patient_id === patientId && g.grantee_id === person && inForceAt(g, t));
  const viewGrant = grants.some(g => g.scope === 'view' || g.scope === 'refill');
  const refillGrant = grants.some(g => g.scope === 'refill');
  const full = self || guardian;
  return {
    self, guardian, full,
    view: full || viewGrant,
    refill: full || refillGrant,
    pickupAll: grants.some(g => g.scope === 'pickup' && g.fill_id === null),
    pickupFills: new Set(grants.filter(g => g.scope === 'pickup' && g.fill_id !== null).map(g => g.fill_id)),
    grants,
  };
}

function fillAccess(rel, fillId) {
  if (rel.view) return 'full';
  if (rel.pickupAll || rel.pickupFills.has(fillId)) return 'logistics';
  return null;
}

const deny = what => fail('not_authorized', 'The account holder is not authorized to ' + what + '.');

const pickupInForce = (g, t) => g.scope === 'pickup' && g.status === 'active' && ms(g.created_at) <= t && (g.expires_at === null || t < ms(g.expires_at));

function collectorVia(data, f, personId, t) {
  const patientId = byId(data.prescriptions, 'rx_id', f.rx_id).patient_id, patient = byId(data.people, 'person_id', patientId);
  if (personId === patientId || (patient.is_minor && patient.guardian_ids.includes(personId))) return { via_grant_id: null };
  const covering = data.grants.filter(g => g.patient_id === patientId && g.grantee_id === personId && pickupInForce(g, t) && (g.fill_id === null || g.fill_id === f.fill_id));
  const specific = covering.filter(g => g.fill_id !== null).sort((a, b) => (a.grant_id < b.grant_id ? -1 : 1));
  const wide = covering.filter(g => g.fill_id === null).sort((a, b) => (a.grant_id < b.grant_id ? -1 : 1));
  const chosen = specific[0] || wide[0];
  return chosen ? { via_grant_id: chosen.grant_id } : null;
}

module.exports = { actorId, inForceAt, relation, fillAccess, deny, collectorVia };
