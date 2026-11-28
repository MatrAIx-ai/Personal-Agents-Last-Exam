'use strict';
const crypto = require('node:crypto');
const { ms, toIso } = require('./time.cjs');

const ACTIONS = ['grant', 'revoke', 'prepay', 'cash', 'cancel'];
const KINDS = ['fill', 'grant', 'patient'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const APPROVAL_MS = 30 * 60000;

const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
};

const INSTANTS = new Set(['expires_at']);
function businessArgs(args, keys) {
  const out = {};
  for (const k of keys) {
    const v = args[k] === undefined ? null : args[k];
    out[k] = v !== null && INSTANTS.has(k) ? toIso(ms(v)) : v;
  }
  return out;
}

function fillIdentity(data, f) {
  const rx = data.prescriptions.find(r => r.rx_id === f.rx_id);
  return { id: f.fill_id, patient: rx.patient_id, rx: { id: rx.rx_id, drug: rx.drug_id, prescriber: rx.prescriber_id, written_on: rx.written_on, quantity: rx.quantity, fills_authorized: rx.fills_authorized, received_at: rx.received_at }, requested_at: f.requested_at };
}

const UNVERSIONED = new Set(['collector', 'refusals']);

function fillFacts(data, f) {
  const claim = f.claim_id === null ? null : data.claims.find(c => c.claim_id === f.claim_id);
  const auth = f.authorization_id === null ? null : data.authorizations.find(a => a.authorization_id === f.authorization_id);
  const pr = f.plan_request_id === null ? null : data.plan_requests.find(r => r.plan_request_id === f.plan_request_id);
  const fill = Object.fromEntries(Object.entries(f).filter(([k]) => !UNVERSIONED.has(k)));
  return { ...fillIdentity(data, f), fill, claim: claim || null, authorization: auth || null, plan_request: pr || null };
}

function makeToken({ ctx, data, actor, action, kind, subject, args, targetVersion, changes }) {
  const material = { actor, action, args, run_id: ctx.run_id, seed_id: data.seed_id, subject, target_version: targetVersion, changes };
  const hex = crypto.createHash('sha256').update(canonical(material)).digest('hex').slice(0, 32);
  return 'tok-' + action + '-' + kind + '-' + subject.id + '-' + hex;
}

function parseToken(token) {
  if (typeof token !== 'string' || !token.startsWith('tok-')) return null;
  const parts = token.slice(4).split('-');
  if (parts.length < 4) return null;
  const action = parts[0], kind = parts[1], hex = parts[parts.length - 1], id = parts.slice(2, -1).join('-');
  if (!ACTIONS.includes(action) || !KINDS.includes(kind) || !/^[0-9a-f]{32}$/.test(hex) || !ID.test(id)) return null;
  return { action, kind, id };
}

const approvalState = (a, now) => (a.used_at !== null ? 'used' : now >= ms(a.confirmed_at) + APPROVAL_MS ? 'expired' : 'active');
const approvalView = (a, now) => ({ token: a.token, confirmed_at: a.confirmed_at, expires_at: toIso(ms(a.confirmed_at) + APPROVAL_MS), state: approvalState(a, now) });

function findApproval(data, token, confirmer, now) {
  const all = data.approvals.filter(a => a.token === token);
  if (!all.length) return { error: 'confirmation_required' };
  const usable = all.filter(a => a.confirmed_by === confirmer && approvalState(a, now) === 'active').sort((a, b) => ms(a.confirmed_at) - ms(b.confirmed_at) || (a.approval_id < b.approval_id ? -1 : 1));
  if (!usable.length) return { error: 'confirmation_invalid' };
  return { approval: usable[0] };
}

module.exports = { canonical, businessArgs, fillIdentity, fillFacts, makeToken, parseToken, findApproval, approvalState, approvalView, APPROVAL_MS, ACTIONS, KINDS };
