'use strict';
const crypto = require('node:crypto');
const { byId, sortBy } = require('./util.cjs');
const { ms, toIso } = require('./time.cjs');

const ACTIONS = ['grant', 'revoke', 'cob', 'info', 'file', 'withdraw'];
const KINDS = ['pair', 'grant', 'coverage', 'request', 'claim', 'pa', 'appeal'];
const ACTS_ON = { pair: ['grant'], grant: ['grant', 'revoke'], coverage: ['cob'], request: ['info'], claim: ['file'], pa: ['file'], appeal: ['withdraw'] };
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const COVERAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}:[0-9]{4}$/;
const HEX = /^[0-9a-f]{32}$/;
const APPROVAL_MS = 30 * 60000;

const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
};

const GRANT_ARGS = ['action', 'member_id', 'grantee_id', 'scope', 'expires_at', 'grant_id'];
const ARGS = {
  grant: GRANT_ARGS, revoke: GRANT_ARGS, cob: ['member_id', 'plan_year', 'answer'], info: ['claim_id', 'line_id', 'answer'],
  file: ['target_type', 'target_id', 'statement', 'expedited', 'urgency_attested'], withdraw: ['appeal_id'],
};
const DEFAULTS = { grant: { expires_at: null }, file: { expedited: false, urgency_attested: false } };
const INSTANTS = new Set(['expires_at']);

function businessArgs(action, args) {
  const out = {}, defaults = DEFAULTS[action] || {};
  for (const k of ARGS[action]) {
    const v = args[k] === undefined ? (Object.hasOwn(defaults, k) ? defaults[k] : null) : args[k];
    out[k] = v !== null && INSTANTS.has(k) ? toIso(ms(v)) : v;
  }
  return out;
}

function parseToken(token) {
  if (typeof token !== 'string' || !token.startsWith('tok-')) return null;
  const parts = token.slice(4).split('-');
  if (parts.length < 4) return null;
  const action = parts[0], kind = parts[1], hex = parts[parts.length - 1], id = parts.slice(2, -1).join('-');
  if (!HEX.test(hex)) return null;
  if (action === 'cob' || kind === 'coverage') return action === 'cob' && kind === 'coverage' && COVERAGE_ID.test(id) ? { action, kind, id } : null;
  if (!ACTIONS.includes(action) || !KINDS.includes(kind) || !ID.test(id)) return null;
  return { action, kind, id };
}

function coverageKey(id) {
  const at = id.lastIndexOf(':');
  return { member_id: id.slice(0, at), plan_year: Number(id.slice(at + 1)) };
}

const digest = material => crypto.createHash('sha256').update(canonical(material)).digest('hex').slice(0, 32);

function makeToken({ ctx, data, actor, action, kind, id, subject, args, targetVersion }) {
  const material = { actor, action, args, run_id: ctx.run_id, seed_id: data.seed_id, subject, target_version: String(targetVersion) };
  return 'tok-' + action + '-' + kind + '-' + id + '-' + digest(material);
}

const memberOf = (data, id) => byId(data.members, 'member_id', id);
const pairGrants = (data, memberId, granteeId) => data.grants.filter(g => g.member_id === memberId && g.grantee_id === granteeId).sort(sortBy('grant_id'));
const pairVersion = (data, memberId, granteeId) => pairGrants(data, memberId, granteeId).reduce((sum, g) => sum + BigInt(g.grant_version) + 1n, 0n).toString();

const pairSubject = (data, memberId, granteeId) => ({ member: memberOf(data, memberId), grantee_id: granteeId, grants: pairGrants(data, memberId, granteeId) });
const grantSubject = g => ({ grant: g });
const coverageSubject = (data, cov) => ({ coverage: cov, member: memberOf(data, cov.member_id) });

function requestSubject(data, r) {
  const c = byId(data.claims, 'claim_id', r.claim_id);
  return { request: r, claim: { claim_id: c.claim_id, member_id: c.member_id, provider_id: c.provider_id, received_at: c.received_at }, line: byId(c.lines, 'line_id', r.line_id) };
}

const eobsOf = (data, claimId) => data.eobs.filter(e => e.claim_id === claimId).sort((a, b) => a.version - b.version);

function claimSubject(data, c) {
  const list = eobsOf(data, c.claim_id);
  return { claim: c, eob: list.length ? list[list.length - 1] : null };
}

const paSubject = p => ({ pa: p });

function targetFacts(data, target) {
  const w = data.windows.find(x => x.target.type === target.type && x.target.id === target.id) || null;
  if (target.type === 'claim') {
    const c = byId(data.claims, 'claim_id', target.id);
    return { type: 'claim', claim_id: c.claim_id, member_id: c.member_id, provider_id: c.provider_id, received_at: c.received_at, lines: c.lines, eob: eobsOf(data, c.claim_id).find(e => e.version === 1) || null, notice_at: w ? w.notice_at : null };
  }
  const p = byId(data.pas, 'pa_id', target.id);
  return { type: 'pa', pa_id: p.pa_id, member_id: p.member_id, provider_id: p.provider_id, service_id: p.service_id, submitted_at: p.submitted_at, requested: p.requested, denial_notice_at: p.denial_notice_at };
}

const appealSubject = (data, a) => ({ appeal: a, target: targetFacts(data, a.target) });

const approvalState = (a, now) => (a.used_at !== null ? 'used' : now >= ms(a.confirmed_at) + APPROVAL_MS ? 'expired' : 'active');
const approvalView = (a, now) => ({ token: a.token, confirmed_at: a.confirmed_at, expires_at: toIso(ms(a.confirmed_at) + APPROVAL_MS), state: approvalState(a, now) });

function findApproval(data, token, confirmer, now) {
  const all = data.approvals.filter(a => a.token === token);
  if (!all.length) return { error: 'confirmation_required' };
  const usable = all.filter(a => a.confirmed_by === confirmer && approvalState(a, now) === 'active').sort((a, b) => ms(a.confirmed_at) - ms(b.confirmed_at));
  if (!usable.length) return { error: 'confirmation_invalid' };
  return { approval: usable[0] };
}

module.exports = {
  ACTIONS, KINDS, ACTS_ON, APPROVAL_MS, canonical, businessArgs, parseToken, coverageKey, makeToken,
  pairGrants, pairVersion, pairSubject, grantSubject, coverageSubject, requestSubject, claimSubject, paSubject, appealSubject,
  approvalState, approvalView, findApproval,
};
