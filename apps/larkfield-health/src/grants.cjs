'use strict';
const { fail, byId, bump, nextId } = require('./util.cjs');
const { ms, toIso } = require('./time.cjs');
const { makeToken, businessArgs, grantSubject, pairSubject, pairVersion } = require('./tokens.cjs');
const { confirmFlow } = require('./confirm.cjs');
const { grantState } = require('./views.cjs');

const invalid = message => fail('invalid_event', message);
const instant = v => (v === null || v === undefined ? null : toIso(ms(v)));
const sameInstant = (a, b) => instant(a) === instant(b);
const live = (g, t) => grantState(g, t) === 'active';
const liveOf = (data, memberId, granteeId, t) => data.grants.find(g => g.member_id === memberId && g.grantee_id === granteeId && live(g, t)) || null;
const shape = (g, t) => ({ scope: g.scope, expires_at: g.expires_at, state: grantState(g, t) });
const change = (data, g) => bump(data, g, 'grant_id', 'grant_version');

function plan(data, args, g) {
  if (args.action === 'revoke') {
    const gr = g.grant;
    return { kind: 'grant', id: gr.grant_id, grant: gr, version: gr.grant_version, subject: grantSubject(gr), changes: { grant_id: gr.grant_id, before: shape(gr, g.now), after: { ...shape(gr, g.now), state: 'revoked' } } };
  }
  const expires = instant(args.expires_at), after = { scope: args.scope, expires_at: expires, state: 'active' };
  const existing = liveOf(data, args.member_id, args.grantee_id, g.now);
  if (existing) return { kind: 'grant', id: existing.grant_id, grant: existing, expires, version: existing.grant_version, subject: grantSubject(existing), changes: { grant_id: existing.grant_id, before: shape(existing, g.now), after } };
  return { kind: 'pair', id: args.member_id, grant: null, expires, version: pairVersion(data, args.member_id, args.grantee_id), subject: pairSubject(data, args.member_id, args.grantee_id), changes: { grant_id: null, before: null, after } };
}

function check(args, g, p) {
  if (args.action === 'revoke') {
    if (!live(p.grant, g.now)) fail('invalid_state', 'Grant ' + p.grant.grant_id + ' has already ended (' + grantState(p.grant, g.now) + ').');
  } else {
    if (p.expires !== null && ms(p.expires) <= g.now) fail('invalid_state', 'The expiry ' + args.expires_at + ' is not after the current time.');
    if (p.grant && p.grant.scope === args.scope && sameInstant(p.grant.expires_at, p.expires)) fail('invalid_state', 'Grant ' + p.grant.grant_id + ' already gives this access with this expiry.');
  }
}

const tokenOf = (ctx, data, g, args, p) => makeToken({ ctx, data, actor: g.actor, action: args.action, kind: p.kind, id: p.id, subject: p.subject, args: businessArgs(args.action, args), targetVersion: p.version });

function changePreview(ctx, data, args, g) {
  const p = plan(data, args, g);
  check(args, g, p);
  return { preview: { token: tokenOf(ctx, data, g, args, p), required_confirmer: g.actor, changes: p.changes } };
}

function revoke(data, gr, at) {
  Object.assign(gr, { status: 'revoked', revoked_at: at });
  change(data, gr);
}

function update(data, gr, scope, expires) {
  Object.assign(gr, { scope, expires_at: expires });
  change(data, gr);
}

function changeConfirm(ctx, data, args, g) {
  let p = null, out = null;
  confirmFlow({
    data, now: g.now, at: g.at, token: args.token, confirmer: g.actor,
    currentToken: () => { p = plan(data, args, g); return tokenOf(ctx, data, g, args, p); },
    checkState: () => check(args, g, p),
    commit: () => {
      if (args.action === 'revoke') { revoke(data, p.grant, g.at); out = p.grant; return; }
      if (p.grant) { update(data, p.grant, args.scope, p.expires); out = p.grant; return; }
      out = { grant_id: nextId(data, 'gr'), grant_version: 0, member_id: args.member_id, grantor_id: g.actor, grantee_id: args.grantee_id, scope: args.scope, created_at: g.at, expires_at: p.expires, status: 'active', revoked_at: null };
      data.grants.push(out);
    },
  });
  return out;
}

function grantChanged(data, p, ctx) {
  const at = ctx.virtual_now, t = ms(at), stored = byId(data.grants, 'grant_id', p.grant_id);
  if (p.status === 'revoked') {
    for (const k of ['member_id', 'grantor_id', 'grantee_id', 'scope']) if (p[k] !== undefined && p[k] !== stored[k]) invalid('Grant ' + stored.grant_id + ' has ' + k + ' ' + stored[k] + '; a revocation cannot change it.');
    if (p.expires_at !== undefined && !sameInstant(instant(p.expires_at), stored.expires_at)) invalid('A revocation of grant ' + stored.grant_id + ' cannot change its expiry.');
    if (live(stored, t)) revoke(data, stored, at);
    return data;
  }
  const member = byId(data.members, 'member_id', p.member_id);
  if (p.grantee_id === p.member_id) invalid('A member cannot be their own grantee.');
  if (member.is_minor ? !member.guardian_ids.includes(p.grantor_id) : p.grantor_id !== p.member_id) invalid('Grantor ' + p.grantor_id + ' may not grant access to ' + p.member_id + '.');
  const expires = instant(p.expires_at);
  if (expires !== null && ms(expires) <= t) invalid('The expiry ' + p.expires_at + ' is not after the event time.');
  if (stored) {
    for (const k of ['member_id', 'grantor_id', 'grantee_id']) if (p[k] !== stored[k]) invalid('Grant ' + stored.grant_id + ' has ' + k + ' ' + stored[k] + '; an event cannot change it.');
    if (!live(stored, t)) invalid('Grant ' + stored.grant_id + ' has ended (' + grantState(stored, t) + ') and is never reactivated; grant again with a new grant_id.');
    if (stored.scope !== p.scope || !sameInstant(stored.expires_at, expires)) update(data, stored, p.scope, expires);
    return data;
  }
  const twin = liveOf(data, p.member_id, p.grantee_id, t);
  if (twin) invalid('Grant ' + twin.grant_id + ' is already live for ' + p.member_id + ' and ' + p.grantee_id + '; update it instead.');
  data.grants.push({ grant_id: p.grant_id, grant_version: 0, member_id: p.member_id, grantor_id: p.grantor_id, grantee_id: p.grantee_id, scope: p.scope, created_at: at, expires_at: expires, status: 'active', revoked_at: null });
  return data;
}

module.exports = { changePreview, changeConfirm, grantChanged, liveOf };
