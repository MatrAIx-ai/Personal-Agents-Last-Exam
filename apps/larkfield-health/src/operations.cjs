'use strict';
const { fail, byId, sortBy, newStep } = require('./util.cjs');
const { localParts, runInRange } = require('./time.cjs');
const { relation } = require('./authority.cjs');
const { guard } = require('./guards.cjs');
const { applyDueTimers, project, EFFECTS } = require('./timers.cjs');
const { approvalsFor, subjectsMatch } = require('./approvals.cjs');
const V = require('./views.cjs');
const claims = require('./claims.cjs');
const coverage = require('./coverage.cjs');
const pa = require('./pa.cjs');
const appeals = require('./appeals.cjs');
const grants = require('./grants.cjs');

const PREFIX = 'larkfield-health.';
const TOOLS = require('../tools.json');
const KNOWN = new Set(TOOLS.map(t => t.name));
const READ_ONLY = new Set(TOOLS.filter(t => t.read_only).map(t => t.name.slice(PREFIX.length)));
const POWERS = ['self', 'guardian', 'view', 'act'];
const CATEGORIES = ['office', 'specialist', 'imaging', 'therapy', 'emergency', 'lab', 'surgery', 'pharmacy'];

const rel = (data, g, memberId) => relation(data, g.actor, memberId, g.now);
const approvalsOf = (data, g) => subjects => approvalsFor(data, g.actor, g.now, subjectsMatch(subjects));

function membersList(ctx, data, args, g) {
  const rows = [];
  for (const m of [...data.members].sort(sortBy('member_id'))) {
    const r = rel(data, g, m.member_id), powers = new Set();
    if (r.self) powers.add('self');
    if (r.guardian) powers.add('guardian');
    if (r.grant) { powers.add('view'); if (r.grant.scope === 'act') powers.add('act'); }
    if (powers.size) rows.push({ member_id: m.member_id, name: m.name, relation: m.relation, is_minor: m.is_minor, enrolled_years: [...m.enrolled_years].sort((a, b) => a - b), powers: POWERS.filter(p => powers.has(p)) });
  }
  return { members: rows };
}

function grantsList(ctx, data, args, g) {
  const only = g.memberId;
  const visible = data.grants.filter(x => {
    if (only !== null && x.member_id !== only) return false;
    const r = rel(data, g, x.member_id);
    return r.full || (r.view && x.grantee_id === g.actor);
  }).sort(sortBy('grant_id'));
  const ofMember = p => only === null || (p.kind === 'pair' ? p.id === only : byId(data.grants, 'grant_id', p.id)?.member_id === only);
  const approvals = approvalsFor(data, g.actor, g.now, p => (p.kind === 'pair' || p.kind === 'grant') && ofMember(p));
  return { grants: visible.map(x => V.grantView(x, g.now)), approvals };
}

function planGet(ctx, data, args, g) {
  const year = args.plan_year === undefined ? localParts(g.now).year : args.plan_year;
  const p = Object.hasOwn(data.plan.years, String(year)) ? data.plan.years[String(year)] : null;
  if (!p) fail('not_found', 'The plan has no plan year ' + year + '.');
  const enrolled = data.members.filter(m => m.enrolled_years.includes(year)).sort(sortBy('member_id'));
  const visible = enrolled.filter(m => rel(data, g, m.member_id).view);
  const accOf = id => data.accumulators.find(a => a.member_id === id && a.plan_year === year);
  const members = visible.map(m => {
    const a = accOf(m.member_id), c = data.coverage.find(x => x.member_id === m.member_id && x.plan_year === year);
    return { member_id: m.member_id, deductible_cents: a.deductible_cents, oop_cents: a.oop_cents, other_coverage: { status: c.status, version: c.version, attested_at: c.attested_at },
      approvals: approvalsOf(data, g)([['coverage', m.member_id + ':' + year]]) };
  });
  const family = visible.length === enrolled.length
    ? enrolled.reduce((f, m) => ({ deductible_cents: f.deductible_cents + accOf(m.member_id).deductible_cents, oop_cents: f.oop_cents + accOf(m.member_id).oop_cents }), { deductible_cents: 0, oop_cents: 0 })
    : null;
  const plan = {
    plan_id: data.plan.plan_id, name: data.plan.name, plan_year: year, deductible: { ...p.deductible }, oop_max: { ...p.oop_max }, coinsurance_pct: p.coinsurance_pct,
    copays: CATEGORIES.filter(c => Object.hasOwn(p.copays, c)).map(c => ({ category: c, copay_cents: p.copays[c] })), pa_services: [...data.plan.pa_services].sort(),
    network: { in_network_only: true, emergency_out_of_network: 'in_network_cost_sharing' }, emergency: { pa_required: false, cost_sharing: 'service_category_in_network' },
  };
  return { plan, members, family };
}

function claimsList(ctx, data, args, g) {
  const visible = data.claims.filter(c => (g.memberId === null || c.member_id === g.memberId) && (args.status === undefined || c.status === args.status) && rel(data, g, c.member_id).view);
  return { claims: [...visible].sort(sortBy('claim_id')).map(c => V.claimView(data, c, approvalsOf(data, g))) };
}

const claimsGet = (ctx, data, args, g) => ({ claim: V.claimView(data, g.claim, approvalsOf(data, g)) });

function cobConfirm(ctx, data, args, g) {
  const out = coverage.cobConfirm(ctx, data, args, g);
  return { coverage: out.coverage, claims: out.claims.map(c => V.claimView(data, c, approvalsOf(data, g))) };
}

const infoConfirm = (ctx, data, args, g) => ({ claim: V.claimView(data, claims.infoConfirm(ctx, data, args, g), approvalsOf(data, g)) });

function paList(ctx, data, args, g) {
  const visible = data.pas.filter(p => (g.memberId === null || p.member_id === g.memberId) && (args.status === undefined || p.status === args.status) && rel(data, g, p.member_id).view);
  return { pas: [...visible].sort(sortBy('pa_id')).map(p => V.paView(data, p, approvalsOf(data, g))) };
}

const paGet = (ctx, data, args, g) => ({ pa: V.paView(data, g.pa, approvalsOf(data, g)) });
const requestExpedite = (ctx, data, args, g) => ({ pa: V.paView(data, pa.requestExpedite(ctx, data, args, g), approvalsOf(data, g)) });

function appealsList(ctx, data, args, g) {
  const visible = data.appeals.filter(a => (g.memberId === null || a.member_id === g.memberId) && (args.status === undefined || a.status === args.status) && rel(data, g, a.member_id).view);
  return { appeals: [...visible].sort(sortBy('appeal_id')).map(a => V.appealView(a, approvalsOf(data, g))) };
}

const appealOut = fn => (ctx, data, args, g) => ({ appeal: V.appealView(fn(ctx, data, args, g), approvalsOf(data, g)) });

const OPS = {
  'members.list': membersList, 'grants.list': grantsList, 'plan.get': planGet, 'claims.list': claimsList, 'claims.get': claimsGet,
  'coverage.cob.preview': coverage.cobPreview, 'coverage.cob.confirm': cobConfirm, 'claims.info.preview': claims.infoPreview, 'claims.info.confirm': infoConfirm,
  'pa.list': paList, 'pa.get': paGet, 'pa.request_expedite': requestExpedite,
  'appeals.list': appealsList, 'appeals.get': appealOut((ctx, data, args, g) => g.appeal), 'appeals.file.preview': appeals.filePreview, 'appeals.file.confirm': appealOut(appeals.fileConfirm),
  'appeals.withdraw.preview': appeals.withdrawPreview, 'appeals.withdraw.confirm': appealOut(appeals.withdrawConfirm), 'appeals.add_statement': appealOut(appeals.addStatement),
  'grants.change.preview': grants.changePreview, 'grants.change.confirm': (ctx, data, args, g) => ({ grant: V.grantView(grants.changeConfirm(ctx, data, args, g), g.now) }),
};

const missingHandler = op => fail('invalid_state', 'Operation ' + op + ' is not available yet.');

function handleTool(ctx, data, name, args, handlers = OPS, effects = EFFECTS) {
  if (!KNOWN.has(name)) fail('unknown_tool', 'Unknown tool ' + name + '.');
  if (!runInRange(ctx.virtual_now)) fail('invalid_state', 'The App clock ' + ctx.virtual_now + ' is outside the supported range 2000-01-01 to 2200-12-31.');
  const op = name.slice(PREFIX.length), fn = handlers[op];
  if (READ_ONLY.has(op)) {
    const projected = project(data, ctx.virtual_now, effects);
    const g = guard(ctx, projected, op, args);
    if (!fn) missingHandler(op);
    return { data, result: fn(ctx, projected, args, g) };
  }
  applyDueTimers(data, ctx.virtual_now, { effects });
  const g = guard(ctx, data, op, args);
  if (!fn) missingHandler(op);
  newStep(data);
  return { data, result: fn(ctx, data, args, g) };
}

module.exports = { handleTool, OPS, PREFIX };
