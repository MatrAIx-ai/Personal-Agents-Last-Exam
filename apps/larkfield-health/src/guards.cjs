'use strict';
const { fail, byId } = require('./util.cjs');
const { ms, toIso } = require('./time.cjs');
const { actorId, relation, deny } = require('./authority.cjs');

const filter = power => ({ subject: 'member?', key: 'member_id', power });
const record = (subject, key, power) => ({ subject, key, power });
const GUARDS = {
  'members.list': { subject: null },
  'grants.list': filter('view'),
  'plan.get': { subject: null },
  'claims.list': filter('view'),
  'claims.get': record('claim', 'claim_id', 'view'),
  'pa.list': filter('view'),
  'pa.get': record('pa', 'pa_id', 'view'),
  'appeals.list': filter('view'),
  'appeals.get': record('appeal', 'appeal_id', 'view'),
  'grants.change.preview': { subject: 'grant-change', power: 'full' },
  'grants.change.confirm': { subject: 'grant-change', power: 'full' },
  'coverage.cob.preview': { subject: 'member-year', power: 'act' },
  'coverage.cob.confirm': { subject: 'member-year', power: 'act' },
  'claims.info.preview': { subject: 'claim-line', key: 'claim_id', power: 'act' },
  'claims.info.confirm': { subject: 'claim-line', key: 'claim_id', power: 'act' },
  'appeals.file.preview': { subject: 'target', power: 'act' },
  'appeals.file.confirm': { subject: 'target', power: 'act' },
  'appeals.withdraw.preview': record('appeal', 'appeal_id', 'act'),
  'appeals.withdraw.confirm': record('appeal', 'appeal_id', 'act'),
  'pa.request_expedite': record('pa', 'pa_id', 'act'),
  'appeals.add_statement': record('appeal', 'appeal_id', 'act'),
};

const person = (d, id, ctx) => (ctx.binding?.people || []).find(p => p.person_id === id) || null;
const member = (d, id) => byId(d.members, 'member_id', id);
const LOOKUP = {
  member, grantor: member, provider: (d, id) => byId(d.providers, 'provider_id', id), service: (d, id) => byId(d.services, 'service_id', id),
  claim: (d, id) => byId(d.claims, 'claim_id', id), pa: (d, id) => byId(d.pas, 'pa_id', id), appeal: (d, id) => byId(d.appeals, 'appeal_id', id),
  grant: (d, id) => byId(d.grants, 'grant_id', id), grantee: person, confirmer: person,
};

const EVENT_TARGETS = {
  'claim.received': p => [['member', p.member_id], ['provider', p.provider_id], ...p.lines.map(l => ['service', l.service_id])],
  'pa.submitted': p => [['member', p.member_id], ['provider', p.provider_id], ['service', p.service_id]],
  'pa.info_requested': p => [['pa', p.pa_id]],
  'pa.info_provided': p => [['pa', p.pa_id]],
  'pa.decided': p => [['pa', p.pa_id]],
  'pa.withdrawn': p => [['pa', p.pa_id]],
  'pa.expedite_decided': p => [['pa', p.pa_id]],
  'appeal.info_requested': p => [['appeal', p.appeal_id]],
  'appeal.decided': p => [['appeal', p.appeal_id]],
  'grant.changed': p => (p.status === 'revoked'
    ? [['grant', p.grant_id], ['member?', p.member_id], ['grantor?', p.grantor_id], ['grantee?', p.grantee_id]]
    : [['member', p.member_id], ['grantor', p.grantor_id], ['grantee', p.grantee_id]]),
  'user.confirmed': p => [['confirmer', p.confirmed_by]],
};

function eventTargets(data, event, ctx) {
  for (const [kind, id] of EVENT_TARGETS[event.operation](event.payload)) {
    const optional = kind.endsWith('?'), k = optional ? kind.slice(0, -1) : kind;
    if (optional && id === undefined) continue;
    if (!LOOKUP[k](data, id, ctx)) fail('invalid_event', 'The event names an unknown ' + k + ' ' + id + '.');
  }
}

const missing = (what, id) => fail('not_found', 'No ' + what + ' ' + id + '.');
const DENIED = { view: 'view this member\'s records', act: 'act on this member\'s plan records', full: 'change this member\'s access grants' };

function grantChange(ctx, data, args) {
  const grantBranch = args.action === 'grant';
  const mixed = grantBranch
    ? args.grant_id !== undefined || args.member_id === undefined || args.grantee_id === undefined || args.scope === undefined
    : ['member_id', 'grantee_id', 'scope', 'expires_at'].some(k => args[k] !== undefined) || args.grant_id === undefined;
  if (mixed) fail('invalid_arguments', 'Use action grant with member_id, grantee_id, scope and an optional expires_at, or action revoke with grant_id only.');
  if (!grantBranch) {
    const grant = LOOKUP.grant(data, args.grant_id);
    if (!grant) missing('grant', args.grant_id);
    return { grant, memberId: grant.member_id };
  }
  if (args.grantee_id === args.member_id) fail('invalid_arguments', 'A member cannot be their own grantee.');
  if (!LOOKUP.member(data, args.member_id)) missing('member', args.member_id);
  if (!person(data, args.grantee_id, ctx)) missing('person', args.grantee_id);
  return { grant: null, memberId: args.member_id };
}

function resolve(ctx, data, spec, args) {
  if (spec.subject === 'grant-change') return grantChange(ctx, data, args);
  if (spec.subject === 'member-year') {
    if (!LOOKUP.member(data, args.member_id)) missing('member', args.member_id);
    if (!Object.hasOwn(data.plan.years, String(args.plan_year))) fail('not_found', 'The plan has no plan year ' + args.plan_year + '.');
    return { memberId: args.member_id };
  }
  if (spec.subject === 'target') {
    const target = LOOKUP[args.target_type](data, args.target_id);
    if (!target) missing(args.target_type === 'pa' ? 'PA' : 'claim', args.target_id);
    return { target, memberId: target.member_id };
  }
  const id = args[spec.key];
  if (spec.subject === 'member?' && id === undefined) return { memberId: null };
  const kind = spec.subject === 'member?' ? 'member' : spec.subject === 'claim-line' ? 'claim' : spec.subject;
  const found = LOOKUP[kind](data, id);
  if (!found) missing(kind === 'pa' ? 'PA' : kind, id);
  return { [kind]: found, memberId: found.member_id };
}

function guard(ctx, data, op, args) {
  const spec = GUARDS[op], now = ms(ctx.virtual_now);
  const g = { actor: actorId(ctx, data), now, at: toIso(now), memberId: null, rel: null };
  if (spec.subject === null) return g;
  Object.assign(g, resolve(ctx, data, spec, args));
  if (g.memberId === null) return g;
  g.rel = relation(data, g.actor, g.memberId, now);
  if (spec.subject === 'claim-line') {
    if (!g.rel.view) deny(DENIED.view);
    g.line = byId(g.claim.lines, 'line_id', args.line_id);
    if (!g.line) missing('line', args.line_id + ' on claim ' + g.claim.claim_id);
  }
  if (!g.rel[spec.power]) deny(DENIED[spec.power]);
  return g;
}

module.exports = { GUARDS, EVENT_TARGETS, LOOKUP, guard, eventTargets };
