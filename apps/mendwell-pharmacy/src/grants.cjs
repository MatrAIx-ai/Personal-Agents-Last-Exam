'use strict';
const { fail, bump, byId, nextId } = require('./util.cjs');
const { ms, toIso, CLOCK_MAX } = require('./time.cjs');
const { makeToken, businessArgs, fillIdentity } = require('./tokens.cjs');
const { confirmFlow } = require('./confirm.cjs');
const { collectorVia } = require('./authority.cjs');
const { grantView, grantState } = require('./views.cjs');
const L = require('./lifecycle.cjs');

const ARGS = ['action', 'patient_id', 'grantee_id', 'scope', 'fill_id', 'expires_at', 'grant_id'];
const instant = v => (v === null || v === undefined ? null : toIso(ms(v)));
const sameInstant = (a, b) => (a === null || b === null ? a === b : ms(a) === ms(b));
const patientOfFill = (data, fillId) => byId(data.prescriptions, 'rx_id', byId(data.fills, 'fill_id', fillId).rx_id).patient_id;
const shape = (g, now) => ({ scope: g.scope, fill_id: g.fill_id, expires_at: g.expires_at, state: grantState(g, now) });
const fillOf = (data, id) => (id === null || id === undefined ? null : fillIdentity(data, byId(data.fills, 'fill_id', id)));
const grantSubject = (data, g) => ({ id: g.grant_id, patient: g.patient_id, grantor: g.grantor_id, grantee: g.grantee_id, scope: g.scope, fill: fillOf(data, g.fill_id), created: g.created_at, expiry: g.expires_at });
const tooLate = v => v !== null && v !== undefined && ms(v) > CLOCK_MAX;
const notAfter = (v, t) => v !== null && v !== undefined && ms(v) <= t;
const live = (g, now) => grantState(g, now) === 'active';

function identity(data, patientId, granteeId, scope, fillId, now) {
  return data.grants.find(x => x.patient_id === patientId && x.grantee_id === granteeId && x.scope === scope && x.fill_id === fillId && live(x, now)) || null;
}

function plan(data, args, g) {
  if (args.action === 'revoke') {
    const gr = g.grant;
    return { kind: 'grant', grant: gr, version: gr.grant_version, subject: grantSubject(data, gr), changes: { grant_id: gr.grant_id, before: shape(gr, g.now), after: { ...shape(gr, g.now), state: 'revoked' } } };
  }
  const fillId = args.fill_id ?? null, expires = instant(args.expires_at);
  const existing = identity(data, args.patient_id, args.grantee_id, args.scope, fillId, g.now);
  const after = { scope: args.scope, fill_id: fillId, expires_at: expires, state: 'active' };
  if (existing) return { kind: 'grant', grant: existing, expires, version: existing.grant_version, subject: grantSubject(data, existing), changes: { grant_id: existing.grant_id, before: shape(existing, g.now), after } };
  const patient = byId(data.people, 'person_id', args.patient_id);
  return { kind: 'patient', grant: null, expires, version: patient.grant_set_version, subject: { id: patient.person_id, fill: fillOf(data, fillId) }, changes: { grant_id: null, before: null, after } };
}

function check(data, args, g, p) {
  if (args.action === 'revoke') {
    const state = grantState(p.grant, g.now);
    if (state !== 'active') fail('invalid_state', 'Grant ' + p.grant.grant_id + ' has already ended (' + state + ').');
    return;
  }
  if (args.fill_id !== undefined && args.fill_id !== null && patientOfFill(data, args.fill_id) !== args.patient_id) fail('invalid_state', 'Fill ' + args.fill_id + ' belongs to another patient.');
  if (tooLate(args.expires_at)) fail('invalid_state', 'The expiry ' + args.expires_at + ' is after the last supported time, 2199-12-31 23:59:59.999 America/New_York.');
  if (notAfter(args.expires_at, g.now)) fail('invalid_state', 'The expiry ' + args.expires_at + ' is not after the current time.');
  if (p.grant && sameInstant(p.grant.expires_at, p.expires)) fail('invalid_state', 'Grant ' + p.grant.grant_id + ' already gives this access with this expiry.');
}

const tokenOf = (ctx, data, g, args, p) => makeToken({ ctx, data, actor: g.actor, action: args.action, kind: p.kind, subject: p.subject, args: businessArgs(args, ARGS), targetVersion: p.version, changes: p.changes });

function changePreview(ctx, data, args, g) {
  const p = plan(data, args, g);
  check(data, args, g, p);
  return { preview: { token: tokenOf(ctx, data, g, args, p), required_confirmer: g.actor, changes: p.changes } };
}

function clearCollectors(data, grantId) {
  for (const f of data.fills) if (f.collector && f.collector.via_grant_id === grantId) f.collector = null;
}

function bumpSet(data, patientId) {
  bump(data, byId(data.people, 'person_id', patientId), 'person_id', 'grant_set_version');
}

function revoke(data, gr, at) {
  gr.status = 'revoked';
  gr.revoked_at = at;
  bump(data, gr, 'grant_id', 'grant_version');
  bumpSet(data, gr.patient_id);
  clearCollectors(data, gr.grant_id);
}

function update(data, gr, expires) {
  gr.expires_at = expires;
  bump(data, gr, 'grant_id', 'grant_version');
  bumpSet(data, gr.patient_id);
}

function create(data, fields, at) {
  const gr = { grant_id: fields.grant_id, grant_version: 0, patient_id: fields.patient_id, grantor_id: fields.grantor_id, grantee_id: fields.grantee_id, scope: fields.scope, fill_id: fields.fill_id, expires_at: fields.expires_at, status: 'active', created_at: at, revoked_at: null };
  data.grants.push(gr);
  bumpSet(data, gr.patient_id);
  return gr;
}

function changeConfirm(ctx, data, args, g) {
  let p = null;
  const { result } = confirmFlow({
    data, now: g.now, at: g.at, token: args.token, confirmer: g.actor,
    currentToken: () => { p = plan(data, args, g); return tokenOf(ctx, data, g, args, p); },
    checkState: () => check(data, args, g, p),
    commit: () => {
      if (args.action === 'revoke') { revoke(data, p.grant, g.at); return p.grant; }
      if (p.grant) { update(data, p.grant, p.expires); return p.grant; }
      return create(data, { grant_id: nextId(data, 'g'), patient_id: args.patient_id, grantor_id: g.actor, grantee_id: args.grantee_id, scope: args.scope, fill_id: args.fill_id ?? null, expires_at: p.expires }, g.at);
    },
  });
  return { grant: grantView(result, g.now) };
}

const invalid = message => fail('invalid_event', message);

function grantChanged(data, payload, ctx) {
  const at = ctx.virtual_now, t = ms(at), stored = byId(data.grants, 'grant_id', payload.grant_id);
  if (stored) {
    for (const k of ['patient_id', 'grantor_id', 'grantee_id', 'scope', 'fill_id']) if (payload[k] !== undefined && payload[k] !== stored[k]) invalid('Grant ' + stored.grant_id + ' has ' + k + ' ' + stored[k] + '; an event can change only its expiry or revoke it.');
    if (payload.status === 'revoked' && payload.expires_at !== undefined && !sameInstant(payload.expires_at, stored.expires_at)) invalid('A revocation of grant ' + stored.grant_id + ' cannot change its expiry.');
    if (payload.status === 'revoked') { if (live(stored, t)) revoke(data, stored, at); return data; }
    if (!live(stored, t)) invalid('Grant ' + stored.grant_id + ' has ended (' + grantState(stored, t) + ') and is never reactivated; grant again with a new grant_id.');
    if (tooLate(payload.expires_at)) invalid('The expiry ' + payload.expires_at + ' is after the last supported time.');
    if (notAfter(payload.expires_at, t)) invalid('The expiry ' + payload.expires_at + ' is not after the event time.');
    const expires = instant(payload.expires_at);
    if (!sameInstant(stored.expires_at, expires)) update(data, stored, expires);
    return data;
  }
  if (payload.status === 'revoked') invalid('The event revokes an unknown grant ' + payload.grant_id + '.');
  const patient = byId(data.people, 'person_id', payload.patient_id);
  if (payload.grantor_id !== patient.person_id && !(patient.is_minor && patient.guardian_ids.includes(payload.grantor_id))) invalid('Grantor ' + payload.grantor_id + ' is neither patient ' + patient.person_id + ' nor a guardian of that minor.');
  if (payload.grantee_id === patient.person_id) invalid('A patient cannot be their own grantee.');
  if (payload.fill_id !== null && payload.scope !== 'pickup') invalid('Only a pickup grant can be limited to one fill.');
  if (payload.fill_id !== null && patientOfFill(data, payload.fill_id) !== patient.person_id) invalid('Fill ' + payload.fill_id + ' belongs to another patient.');
  if (tooLate(payload.expires_at)) invalid('The expiry ' + payload.expires_at + ' is after the last supported time.');
  if (notAfter(payload.expires_at, t)) invalid('The expiry ' + payload.expires_at + ' is not after the event time.');
  const expires = instant(payload.expires_at);
  const twin = identity(data, patient.person_id, payload.grantee_id, payload.scope, payload.fill_id, t);
  if (twin) invalid('Grant ' + twin.grant_id + ' already gives the same access; update it instead.');
  create(data, { ...payload, expires_at: expires }, at);
  return data;
}

function setCollector(data, args, g) {
  const f = g.fill;
  if (args.collector_id !== null) {
    if (!byId(data.people, 'person_id', args.collector_id)) fail('not_found', 'No person ' + args.collector_id + '.');
    if (L.TERMINAL.has(f.state)) fail('invalid_state', 'Fill ' + f.fill_id + ' is ' + f.state + '.');
    const via = collectorVia(data, f, args.collector_id, g.now);
    if (!via) fail('not_authorized', args.collector_id + ' is not the patient or a guardian and holds no current pickup grant covering fill ' + f.fill_id + '.');
    f.collector = { person_id: args.collector_id, via_grant_id: via.via_grant_id, set_at: g.at };
    return f;
  }
  if (L.TERMINAL.has(f.state)) fail('invalid_state', 'Fill ' + f.fill_id + ' is ' + f.state + '.');
  f.collector = null;
  return f;
}

module.exports = { changePreview, changeConfirm, grantChanged, setCollector, clearCollectors };
