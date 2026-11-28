'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const app = require('../app.json');
const binding = require('../fixtures/binding.json');
const { GUARDS, EVENT_TARGETS } = require('../src/guards.cjs');
const { OPS } = require('../src/operations.cjs');
const { HANDLERS } = require('../src/events.cjs');
const T = require('../src/tokens.cjs');
const { canAct } = require('../src/approvals.cjs');

const P = 'larkfield-health.';
const root = path.resolve(__dirname, '..');
const inputs = new Map(tools.map(t => [t.name.slice(P.length), compile(t.inputSchema, root)]));
const writes = new Set(tools.filter(t => !t.read_only).map(t => t.name.slice(P.length)));
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
const stateSeed = compile(require('../schemas/state.schema.json').properties.initial_data, path.join(root, 'schemas'));
const storedSubject = compile(require('../schemas/seed.schema.json').properties.approvals.items.properties.subject, root);
const HEX = 'a'.repeat(32);
const NOW = '2026-11-18T12:00:00-05:00';

function holder(seed, person) {
  const s = structuredClone(seed), b = structuredClone(binding);
  s.account_id = 'larkfield-' + person; s.owner_person_id = person;
  b.accounts = [{ app_id: 'larkfield-health', account_id: s.account_id, owner_person_id: person }];
  return { seed: s, binding: b };
}
const as = (person, seed = S.full(), now) => fixture({ ...holder(seed, person), now });
const withGrant = (scope, expires = null, grantee = 'm-1') => S.edit(S.full(), s => Object.assign(s.grants[0], { scope, expires_at: expires, grantee_id: grantee }));

function reach(f, op, args) {
  const full = writes.has(op) ? { request_id: 'r-' + op, expected_version: { epoch: 1, revision: 0 }, ...args } : args;
  assert.ok(inputs.get(op)(full), 'input schema ' + op + ' ' + JSON.stringify(args));
  try { plugin.handleTool(f.ctx, f.data(), P + op, full, { ...OPS, [op]: () => ({}) }); return 'reached'; } catch (e) { if (!e.code) throw e; return e.code; }
}

const ON = { 'm-1': { claim: 'cl-3', appeal: 'ap-1', grantee: 'm-2' }, 'm-2': { claim: 'cl-4', pa: 'pa-3', grant: 'gr-h1', grantee: 'm-3' }, 'm-3': { claim: 'cl-5', pa: 'pa-2', grantee: 'm-2' } };
function cases(member, data) {
  const o = ON[member], tok = { token: 'tok-x' };
  const cob = { member_id: member, plan_year: 2026, answer: 'none' }, info = { claim_id: o.claim, line_id: 'ln-1', answer: 'not_accident' };
  const file = { target_type: 'claim', target_id: o.claim, statement: 'Please review.' }, grant = { action: 'grant', member_id: member, grantee_id: o.grantee, scope: 'view' };
  const out = [
    ['grants.list', { member_id: member }, 'view'], ['claims.list', { member_id: member }, 'view'], ['pa.list', { member_id: member }, 'view'], ['appeals.list', { member_id: member }, 'view'],
    ['claims.get', { claim_id: o.claim }, 'view'], ['coverage.cob.preview', cob, 'act'], ['coverage.cob.confirm', { ...cob, ...tok }, 'act'],
    ['claims.info.preview', info, 'act'], ['claims.info.confirm', { ...info, ...tok }, 'act'], ['appeals.file.preview', file, 'act'], ['appeals.file.confirm', { ...file, ...tok }, 'act'],
    ['grants.change.preview', grant, 'full'], ['grants.change.confirm', { ...grant, ...tok }, 'full'],
  ];
  if (o.pa) out.push(['pa.get', { pa_id: o.pa }, 'view'], ['pa.request_expedite', { pa_id: o.pa }, 'act'], ['appeals.file.preview', { ...file, target_type: 'pa', target_id: o.pa }, 'act']);
  if (o.appeal) out.push(['appeals.get', { appeal_id: o.appeal }, 'view'], ['appeals.withdraw.preview', { appeal_id: o.appeal }, 'act'], ['appeals.withdraw.confirm', { appeal_id: o.appeal, ...tok }, 'act'], ['appeals.add_statement', { appeal_id: o.appeal, statement: 'More.' }, 'act']);
  if (o.grant && data.grants.some(g => g.grant_id === o.grant)) out.push(['grants.change.preview', { action: 'revoke', grant_id: o.grant }, 'full'], ['grants.change.confirm', { action: 'revoke', grant_id: o.grant, ...tok }, 'full']);
  return out;
}
const LEVEL = { none: 0, view: 1, act: 2, full: 3 };
function expectLevels(f, levels) {
  for (const [member, level] of Object.entries(levels)) for (const [op, args, power] of cases(member, f.data())) {
    assert.equal(reach(f, op, args), LEVEL[level] >= LEVEL[power] ? 'reached' : 'not_authorized', member + ' ' + level + ' ' + op + ' ' + JSON.stringify(args));
  }
}

test('T03 the guard table covers all 21 tools and the target table all 11 events', () => {
  assert.deepEqual(Object.keys(GUARDS).map(k => P + k).sort(), tools.map(t => t.name).sort());
  assert.deepEqual(Object.keys(EVENT_TARGETS).sort(), [...app.event_types].sort());
});

test('T03 relations: an adult self and a guardian have every power, a view grant reads, an act grant also acts, an expired or missing grant gives nothing', () => {
  expectLevels(as('m-1'), { 'm-1': 'full', 'm-2': 'view', 'm-3': 'full' });
  expectLevels(as('m-1', withGrant('act')), { 'm-2': 'act' });
  expectLevels(as('m-1', withGrant('view', '2026-11-01T00:00:00-04:00')), { 'm-2': 'none' });
  expectLevels(as('m-1', withGrant('act', '2026-11-18T12:00:00-05:00')), { 'm-2': 'none' });
  expectLevels(as('m-1', withGrant('act', '2026-11-18T12:00:00.001-05:00')), { 'm-2': 'act' });
  expectLevels(as('m-1', S.edit(S.full(), s => { s.grants = []; })), { 'm-2': 'none' });
});

test('T03 an alternate adult account holder acts for themself and their minor and sees nothing of another adult without a grant', () => {
  const f = as('m-2', S.edit(S.full(), s => { s.grants = []; }));
  expectLevels(f, { 'm-1': 'none', 'm-2': 'full', 'm-3': 'full' });
  assert.deepEqual(f.call(P + 'members.list').members.map(m => [m.member_id, m.powers]), [['m-2', ['self']], ['m-3', ['guardian']]]);
  assert.deepEqual(f.call(P + 'claims.list').claims.map(c => c.claim_id), ['cl-2', 'cl-4', 'cl-5']);
});

test('T03 a bound minor has no power over their own records, reads another member under view and acts under act; their guardian succeeds', () => {
  const act = as('m-3', withGrant('act', null, 'm-3'));
  expectLevels(act, { 'm-1': 'none', 'm-2': 'act', 'm-3': 'none' });
  assert.deepEqual(act.call(P + 'members.list').members, [{ member_id: 'm-2', name: 'Casey Hale', relation: 'spouse', is_minor: false, enrolled_years: [2025, 2026, 2027], powers: ['view', 'act'] }]);
  assert.deepEqual(act.call(P + 'claims.list').claims.map(c => c.claim_id), ['cl-2', 'cl-4']);
  assert.equal(act.call(P + 'claims.get', { claim_id: 'cl-5' }).status, 'not_authorized');
  assert.equal(reach(act, 'appeals.file.preview', { target_type: 'claim', target_id: 'cl-5', statement: 'Mine.' }), 'not_authorized');
  assert.equal(reach(act, 'appeals.file.preview', { target_type: 'pa', target_id: 'pa-3', statement: 'For Casey.' }), 'reached');
  const view = as('m-3', withGrant('view', null, 'm-3'));
  expectLevels(view, { 'm-2': 'view', 'm-3': 'none' });
  assert.equal(view.call(P + 'claims.get', { claim_id: 'cl-4' }).claim.member_id, 'm-2');
  assert.deepEqual(as('m-3', S.edit(S.full(), s => { s.grants = []; })).call(P + 'members.list').members, []);
  assert.equal(reach(as('m-1'), 'appeals.file.preview', { target_type: 'claim', target_id: 'cl-5', statement: 'For Riley.' }), 'reached');
});

test('T03 members.list: self, guardian, view and act powers; a guardian who also holds a grant on the minor is listed once with every power', () => {
  const s = S.granted(S.edit(S.full(), x => Object.assign(x.grants[0], { scope: 'act' })), 'm-3', 'act');
  s.grants[1].grantor_id = 'm-2';
  const rows = as('m-1', s).call(P + 'members.list').members;
  assert.deepEqual(rows.map(m => [m.member_id, m.relation, m.is_minor, m.powers]), [['m-1', 'self', false, ['self']], ['m-2', 'spouse', false, ['view', 'act']], ['m-3', 'child', true, ['guardian', 'view', 'act']]]);
  const reordered = S.edit(S.full(), x => { x.members[0].enrolled_years = [2027, 2025, 2026]; });
  assert.deepEqual(as('m-1', reordered).call(P + 'members.list').members[0].enrolled_years, [2025, 2026, 2027]);
});

test('T03 lists filter by member: unknown member not_found, a hidden member not_authorized, no filter shows only visible members', () => {
  const f = as('m-1', S.edit(S.full(), s => { s.grants = []; }));
  assert.deepEqual(f.call(P + 'claims.list').claims.map(c => c.claim_id), ['cl-1', 'cl-3', 'cl-5']);
  assert.deepEqual(f.call(P + 'claims.list', { member_id: 'm-3' }).claims.map(c => c.claim_id), ['cl-5']);
  assert.deepEqual(f.call(P + 'claims.list', { status: 'processed', member_id: 'm-1' }).claims.map(c => c.claim_id), ['cl-1', 'cl-3']);
  for (const op of ['claims.list', 'pa.list', 'appeals.list', 'grants.list']) {
    assert.equal(f.call(P + op, { member_id: 'm-9' }).status, 'not_found', op);
    assert.equal(f.call(P + op, { member_id: 'm-2' }).status, 'not_authorized', op);
  }
  const g = as('m-1');
  assert.deepEqual(g.call(P + 'claims.list', { member_id: 'm-2' }).claims.map(c => c.claim_id), ['cl-2', 'cl-4']);
  assert.deepEqual(g.call(P + 'claims.list', { status: 'pending_info' }).claims.map(c => c.claim_id), ['cl-4']);
});

test('T03 grants.list: the member or guardian sees every grant of that member, a grantee only the grants naming them, and nothing once their grant ended', () => {
  const s = S.granted(S.granted(S.full(), 'm-3', 'view', null, 'm-2'), 'm-2', 'view', null, 'm-3');
  s.grants.push({ grant_id: 'gr-h0', grant_version: 2, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', created_at: '2026-02-01T09:00:00-05:00', expires_at: '2026-03-01T09:00:00-05:00', status: 'active', revoked_at: null });
  const f = as('m-1', s);
  const listed = f.call(P + 'grants.list');
  assert.deepEqual(listed.grants.map(g => [g.grant_id, g.member_id, g.grantee_id, g.state]), [['gr-h0', 'm-2', 'm-1', 'expired'], ['gr-h1', 'm-2', 'm-1', 'active'], ['gr-h2', 'm-3', 'm-2', 'active']]);
  assert.deepEqual(listed.grants[1], { grant_id: 'gr-h1', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'view', created_at: '2026-06-01T09:00:00-04:00', expires_at: null, revoked_at: null, state: 'active' });
  assert.deepEqual(f.call(P + 'grants.list', { member_id: 'm-3' }).grants.map(g => g.grant_id), ['gr-h2']);
  const m2 = as('m-2', s).call(P + 'grants.list').grants.map(g => g.grant_id);
  assert.deepEqual(m2, ['gr-h0', 'gr-h1', 'gr-h2', 'gr-h3']);
  const ended = S.edit(structuredClone(s), x => { x.grants.find(g => g.grant_id === 'gr-h1').expires_at = '2026-11-01T00:00:00-04:00'; });
  const e = as('m-1', ended);
  assert.deepEqual(e.call(P + 'grants.list').grants.map(g => g.grant_id), ['gr-h2']);
  assert.equal(e.call(P + 'grants.list', { member_id: 'm-2' }).status, 'not_authorized');
  const revoked = S.edit(structuredClone(s), x => Object.assign(x.grants.find(g => g.grant_id === 'gr-h1'), { status: 'revoked', revoked_at: '2026-11-10T09:00:00-05:00' }));
  const r = as('m-1', revoked).call(P + 'grants.list', { member_id: 'm-3' });
  assert.deepEqual(r.grants.map(g => g.grant_id), ['gr-h2']);
  assert.deepEqual(as('m-2', revoked).call(P + 'grants.list', { member_id: 'm-2' }).grants.map(g => [g.grant_id, g.state, g.revoked_at]), [['gr-h0', 'expired', null], ['gr-h1', 'revoked', '2026-11-10T09:00:00-05:00'], ['gr-h3', 'active', null]]);
});

test('T03 an unknown ID is not_found before authority, for every tool that names a record', () => {
  const f = as('m-3', S.edit(S.full(), s => { s.grants = []; }));
  const tok = { token: 'tok-x' };
  const unknown = [
    ['claims.get', { claim_id: 'cl-9' }], ['pa.get', { pa_id: 'pa-9' }], ['appeals.get', { appeal_id: 'ap-9' }],
    ['coverage.cob.preview', { member_id: 'm-9', plan_year: 2026, answer: 'none' }], ['coverage.cob.confirm', { member_id: 'm-9', plan_year: 2026, answer: 'none', ...tok }],
    ['claims.info.preview', { claim_id: 'cl-9', line_id: 'ln-1', answer: 'accident' }],
    ['appeals.file.preview', { target_type: 'claim', target_id: 'pa-3', statement: 'x' }], ['appeals.file.preview', { target_type: 'pa', target_id: 'cl-3', statement: 'x' }],
    ['appeals.file.confirm', { target_type: 'pa', target_id: 'pa-9', statement: 'x', ...tok }],
    ['appeals.withdraw.preview', { appeal_id: 'ap-9' }], ['appeals.withdraw.confirm', { appeal_id: 'ap-9', ...tok }], ['appeals.add_statement', { appeal_id: 'ap-9', statement: 'x' }],
    ['pa.request_expedite', { pa_id: 'pa-9' }],
    ['grants.change.preview', { action: 'grant', member_id: 'm-9', grantee_id: 'm-1', scope: 'view' }], ['grants.change.preview', { action: 'grant', member_id: 'm-2', grantee_id: 'p-9', scope: 'act' }],
    ['grants.change.preview', { action: 'revoke', grant_id: 'gr-9' }], ['grants.change.confirm', { action: 'revoke', grant_id: 'gr-9', ...tok }],
  ];
  for (const [op, args] of unknown) assert.equal(reach(f, op, args), 'not_found', op + ' ' + JSON.stringify(args));
  for (const op of ['claims.info.preview', 'claims.info.confirm']) for (const line_id of ['ln-1', 'ln-9']) assert.equal(reach(f, op, { claim_id: 'cl-4', line_id, answer: 'accident', ...(op.endsWith('confirm') ? tok : {}) }), 'not_authorized', op + ' ' + line_id);
  const own = as('m-1');
  for (const op of ['claims.info.preview', 'claims.info.confirm']) assert.equal(reach(own, op, { claim_id: 'cl-3', line_id: 'ln-9', answer: 'accident', ...(op.endsWith('confirm') ? tok : {}) }), 'not_found', op);
  const viewer = as('m-1');
  for (const op of ['claims.info.preview', 'claims.info.confirm']) {
    const args = line_id => ({ claim_id: 'cl-4', line_id, answer: 'accident', ...(op.endsWith('confirm') ? tok : {}) });
    assert.equal(reach(viewer, op, args('ln-9')), 'not_found', op);
    assert.equal(reach(viewer, op, args('ln-1')), 'not_authorized', op);
  }
  assert.deepEqual(viewer.call(P + 'claims.info.preview', { claim_id: 'cl-4', line_id: 'ln-1', answer: 'accident' }), { status: 'not_authorized', message: 'The account holder is not authorized to act on this member\'s plan records.' });
  assert.deepEqual(f.call(P + 'claims.info.preview', { claim_id: 'cl-4', line_id: 'ln-9', answer: 'accident' }), { status: 'not_authorized', message: 'The account holder is not authorized to view this member\'s records.' });
  assert.match(own.call(P + 'claims.info.preview', { claim_id: 'cl-3', line_id: 'ln-9', answer: 'accident' }).message, /^No line ln-9 on claim cl-3\.$/);
  for (const op of ['coverage.cob.preview', 'coverage.cob.confirm']) {
    const args = { member_id: 'm-2', plan_year: 2031, answer: 'none', ...(op.endsWith('confirm') ? tok : {}) };
    assert.equal(reach(f, op, args), 'not_found', op);
    assert.equal(reach(f, op, { ...args, plan_year: 2026 }), 'not_authorized', op);
  }
  assert.match(f.call(P + 'appeals.file.preview', { target_type: 'pa', target_id: 'cl-3', statement: 'x' }).message, /No PA cl-3/);
});

test('T03 grants.change arguments: mixed branches and a grant to the member themself are invalid_arguments before any lookup', () => {
  const f = as('m-3', S.edit(S.full(), s => { s.grants = []; }));
  const bad = [
    { action: 'grant', member_id: 'm-9', grantee_id: 'm-1', scope: 'view', grant_id: 'gr-h1' }, { action: 'grant', grantee_id: 'm-1', scope: 'view' }, { action: 'grant', member_id: 'm-9', scope: 'view' },
    { action: 'grant', member_id: 'm-9', grantee_id: 'm-1' }, { action: 'grant', member_id: 'm-9', grantee_id: 'm-9', scope: 'act' }, { action: 'revoke' },
    { action: 'revoke', grant_id: 'gr-9', member_id: 'm-2' }, { action: 'revoke', grant_id: 'gr-9', grantee_id: 'm-1' }, { action: 'revoke', grant_id: 'gr-9', scope: 'view' }, { action: 'revoke', grant_id: 'gr-9', expires_at: null },
  ];
  for (const args of bad) for (const op of ['grants.change.preview', 'grants.change.confirm']) assert.equal(reach(f, op, op.endsWith('confirm') ? { ...args, token: 'tok-x' } : args), 'invalid_arguments', JSON.stringify(args));
  const m1 = as('m-1');
  assert.equal(reach(m1, 'grants.change.preview', { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'act', expires_at: null }), 'reached');
  assert.equal(reach(m1, 'grants.change.preview', { action: 'grant', member_id: 'm-2', grantee_id: 'm-3', scope: 'act' }), 'not_authorized');
});

test('T03 a tool without a handler answers not available only after its guard', () => {
  const f = as('m-1');
  const without = op => { const h = { ...OPS }; delete h[op]; return h; };
  const call = (op, args) => { try { plugin.handleTool(f.ctx, f.data(), P + op, writes.has(op) ? { request_id: 'r', expected_version: { epoch: 1, revision: 0 }, ...args } : args, without(op)); return 'reached'; } catch (e) { return e.code + ':' + e.message; } };
  assert.equal(call('pa.get', { pa_id: 'pa-2' }), 'invalid_state:Operation pa.get is not available yet.');
  assert.equal(call('pa.get', { pa_id: 'pa-9' }), 'not_found:No PA pa-9.');
  assert.equal(call('pa.request_expedite', { pa_id: 'pa-3' }).split(':')[0], 'not_authorized');
  assert.equal(call('pa.request_expedite', { pa_id: 'pa-2' }), 'invalid_state:Operation pa.request_expedite is not available yet.');
  assert.deepEqual(f.call(P + 'appeals.get', { appeal_id: 'ap-9' }), { status: 'not_found', message: 'No appeal ap-9.' });
  assert.equal(Object.keys(OPS).length, 21);
});

const env = (operation, payload, at = NOW) => ({ event_id: 'e-' + operation + '-' + JSON.stringify(payload).length, at, operation, payload });

test('T03 every event resolves its targets: an unknown member, provider, service, PA, appeal, grant on revoke, grantor, grantee or confirming person is invalid_event', () => {
  const s = S.full(), ctx = { app_id: 'larkfield-health', run_id: 'unit', role: 'infra', virtual_now: NOW, binding: structuredClone(binding) };
  const run = e => { try { plugin.applyEvent(ctx, structuredClone(s), e, Object.fromEntries(app.event_types.map(k => [k, d => d]))); return 'reached'; } catch (x) { return x.code + ':' + x.message; } };
  const claim = { claim_id: 'cl-8', member_id: 'm-1', provider_id: 'pv-1', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-17', 100)].map(({ position, ...l }) => l) };
  const sub = { pa_id: 'pa-8', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31' };
  const active = { grant_id: 'gr-8', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-3', scope: 'view', expires_at: null, status: 'active' };
  const known = [env('claim.received', claim), env('pa.submitted', sub), env('pa.info_requested', { pa_id: 'pa-2', request: 'Notes' }), env('pa.info_provided', { pa_id: 'pa-2' }),
    env('pa.decided', { pa_id: 'pa-2', decision: 'denied' }), env('pa.withdrawn', { pa_id: 'pa-2' }), env('pa.expedite_decided', { pa_id: 'pa-2', decision: 'approved' }),
    env('appeal.info_requested', { appeal_id: 'ap-1', request: 'A letter' }), env('appeal.decided', { appeal_id: 'ap-1', outcome: 'upheld' }), env('grant.changed', active),
    env('grant.changed', { grant_id: 'gr-h1', status: 'revoked' }), env('grant.changed', { grant_id: 'gr-h1', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', status: 'revoked' }),
    env('user.confirmed', { token: 'tok-7c1e', confirmed_by: 'm-3' })];
  for (const e of known) assert.equal(run(e), 'reached', e.operation + ' ' + JSON.stringify(e.payload));
  const unknown = [
    [env('claim.received', { ...claim, member_id: 'm-9' }), 'member m-9'], [env('claim.received', { ...claim, provider_id: 'pv-9' }), 'provider pv-9'],
    [env('claim.received', { ...claim, lines: [claim.lines[0], { ...claim.lines[0], line_id: 'ln-2', service_id: 'svc-x' }] }), 'service svc-x'],
    [env('pa.submitted', { ...sub, member_id: 'm-9' }), 'member m-9'], [env('pa.submitted', { ...sub, provider_id: 'pv-9' }), 'provider pv-9'], [env('pa.submitted', { ...sub, service_id: 'svc-x' }), 'service svc-x'],
    [env('pa.info_requested', { pa_id: 'pa-9', request: 'Notes' }), 'pa pa-9'], [env('pa.info_provided', { pa_id: 'pa-9' }), 'pa pa-9'], [env('pa.decided', { pa_id: 'pa-9', decision: 'denied' }), 'pa pa-9'],
    [env('pa.withdrawn', { pa_id: 'pa-9' }), 'pa pa-9'], [env('pa.expedite_decided', { pa_id: 'pa-9', decision: 'denied' }), 'pa pa-9'],
    [env('appeal.info_requested', { appeal_id: 'ap-9', request: 'A letter' }), 'appeal ap-9'], [env('appeal.decided', { appeal_id: 'ap-9', outcome: 'upheld' }), 'appeal ap-9'],
    [env('grant.changed', { ...active, member_id: 'm-9' }), 'member m-9'], [env('grant.changed', { ...active, grantor_id: 'p-9' }), 'grantor p-9'], [env('grant.changed', { ...active, grantee_id: 'p-9' }), 'grantee p-9'],
    [env('grant.changed', { grant_id: 'gr-9', status: 'revoked' }), 'grant gr-9'], [env('grant.changed', { grant_id: 'gr-h1', member_id: 'm-9', status: 'revoked' }), 'member m-9'],
    [env('grant.changed', { grant_id: 'gr-h1', grantor_id: 'p-9', status: 'revoked' }), 'grantor p-9'], [env('grant.changed', { grant_id: 'gr-h1', grantee_id: 'p-9', status: 'revoked' }), 'grantee p-9'],
    [env('user.confirmed', { token: 'tok-7c1e', confirmed_by: 'p-9' }), 'confirmer p-9'],
  ];
  for (const [e, what] of unknown) assert.equal(run(e), 'invalid_event:The event names an unknown ' + what + '.', e.operation + ' ' + JSON.stringify(e.payload));
  const outsider = S.edit(structuredClone(binding), b => b.people.push({ person_id: 'p-7', name: 'Outside Helper' }));
  const c2 = { ...ctx, binding: outsider };
  assert.doesNotThrow(() => plugin.applyEvent(c2, structuredClone(s), env('user.confirmed', { token: 'tok-7c1e', confirmed_by: 'p-7' })));
  const f = fixture({ seed: S.full() });
  const noHandler = { ...HANDLERS };
  delete noHandler['grant.changed'];
  assert.throws(() => plugin.applyEvent(ctx, structuredClone(s), env('grant.changed', { grant_id: 'gr-h1', status: 'revoked' }), noHandler), e => e.code === 'invalid_event' && e.message === 'Event grant.changed is not available yet.');
  assert.deepEqual(Object.keys(HANDLERS).sort(), [...app.event_types].sort());
});

const tokenOf = (over = {}) => T.makeToken({ ctx: { run_id: 'run-a' }, data: { seed_id: 'seed-a' }, actor: 'm-1', action: 'file', kind: 'claim', id: 'cl-3', subject: { claim: { claim_id: 'cl-3', claim_version: 1 } }, args: T.businessArgs('file', { target_type: 'claim', target_id: 'cl-3', statement: 'Review.' }), targetVersion: 1, ...over });

test('T03 tokens: grammar, digest over actor, action, arguments, run, seed, subject and target version only', () => {
  const t = tokenOf();
  assert.match(t, /^tok-file-claim-cl-3-[0-9a-f]{32}$/);
  assert.deepEqual(T.parseToken(t), { action: 'file', kind: 'claim', id: 'cl-3' });
  for (const over of [{ actor: 'm-2' }, { action: 'withdraw' }, { ctx: { run_id: 'run-b' } }, { data: { seed_id: 'seed-b' } }, { subject: { claim: { claim_id: 'cl-3', claim_version: 2 } } }, { targetVersion: 2 },
    { args: T.businessArgs('file', { target_type: 'claim', target_id: 'cl-3', statement: 'Review!' }) }]) assert.notEqual(tokenOf(over).slice(-32), t.slice(-32), JSON.stringify(over));
  assert.equal(tokenOf({ id: 'other' }).slice(-32), t.slice(-32));
  assert.equal(tokenOf({ subject: { claim: { claim_version: 1, claim_id: 'cl-3' } } }), t);
  assert.equal(tokenOf({ targetVersion: '1' }), t);
  assert.equal(T.canonical({ b: 1, a: [undefined, 2], c: { y: null, x: 'q' } }), '{"a":[null,2],"b":1,"c":{"x":"q","y":null}}');
});

test('T03 business arguments: filing flags default to false, so omitted and explicit false give one token; the grant branch defaults its expiry; instants normalise; absent equals null', () => {
  const base = { target_type: 'pa', target_id: 'pa-3', statement: 'Urgent.' };
  const omitted = T.businessArgs('file', { ...base, request_id: 'r', expected_version: { epoch: 1, revision: 0 }, token: 'tok-x' });
  assert.deepEqual(omitted, { ...base, expedited: false, urgency_attested: false });
  assert.deepEqual(T.businessArgs('file', { ...base, expedited: false, urgency_attested: false }), omitted);
  assert.equal(tokenOf({ args: omitted }), tokenOf({ args: T.businessArgs('file', { ...base, expedited: false, urgency_attested: false }) }));
  assert.notEqual(tokenOf({ args: omitted }), tokenOf({ args: T.businessArgs('file', { ...base, expedited: true }) }));
  assert.notEqual(tokenOf({ args: omitted }), tokenOf({ args: T.businessArgs('file', { ...base, urgency_attested: true }) }));
  assert.deepEqual(T.businessArgs('grant', { action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'view' }), { action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'view', expires_at: null, grant_id: null });
  assert.deepEqual(T.businessArgs('grant', { action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'view', expires_at: '2026-12-31T17:00:00Z' }).expires_at, '2026-12-31T12:00:00-05:00');
  assert.deepEqual(T.businessArgs('revoke', { action: 'revoke', grant_id: 'gr-1' }), { action: 'revoke', member_id: null, grantee_id: null, scope: null, expires_at: null, grant_id: 'gr-1' });
  assert.deepEqual(T.businessArgs('cob', { member_id: 'm-2', plan_year: 2026, answer: 'none', token: 'tok-x' }), { member_id: 'm-2', plan_year: 2026, answer: 'none' });
  assert.deepEqual(T.businessArgs('info', { claim_id: 'cl-4', line_id: 'ln-1', answer: 'accident' }), { claim_id: 'cl-4', line_id: 'ln-1', answer: 'accident' });
  assert.deepEqual(T.businessArgs('withdraw', { appeal_id: 'ap-1', request_id: 'r' }), { appeal_id: 'ap-1' });
});

test('T03 the token parser returns a subject exactly when the stored approval schema accepts it', () => {
  const m80 = 'm' + 'x'.repeat(79);
  assert.equal(m80.length, 80);
  const ids = ['m-1', 'm-1:2026', '-x', '_x', 'x', 'a.b_c:d', m80, m80 + 'x', m80 + ':2026', m80 + 'x:2026', 'm-1:26', 'm-1:20266', 'a:2026:2027', ':2026', 'm-1:2o26', 'cl--3'];
  let accepted = 0;
  for (const action of [...T.ACTIONS, 'pay']) for (const kind of [...T.KINDS, 'fill']) for (const id of ids) {
    const token = 'tok-' + action + '-' + kind + '-' + id + '-' + HEX, parsed = T.parseToken(token), naive = { action, kind, id };
    assert.equal(parsed !== null, storedSubject(naive), token);
    if (parsed) { assert.deepEqual(parsed, naive, token); accepted++; }
  }
  assert.ok(accepted > 100);
  assert.equal(T.parseToken('tok-file-claim--x-' + HEX), null);
  assert.equal(T.parseToken('tok-info-coverage-m-1:2026-' + HEX), null);
  assert.equal(T.parseToken('tok-cob-claim-cl-3-' + HEX), null);
  assert.equal(T.parseToken('tok-cob-coverage-m-1-' + HEX), null);
  for (const bad of ['tok-7c1e', 'tok-file-claim-' + HEX, 'tok-file-claim-cl-3-' + 'A'.repeat(32), 'tok-file-claim-cl-3-' + 'a'.repeat(31), 'tok-file-claim-cl-3-' + 'a'.repeat(33), 'xtok-file-claim-cl-3-' + HEX, null, 7]) assert.equal(T.parseToken(bad), null, String(bad));
  const cov = 'tok-cob-coverage-' + m80 + ':2026-' + HEX;
  assert.equal(cov.length, 135);
  assert.deepEqual(T.parseToken(cov), { action: 'cob', kind: 'coverage', id: m80 + ':2026' });
  assert.deepEqual(T.coverageKey(m80 + ':2026'), { member_id: m80, plan_year: 2026 });
  assert.deepEqual(T.coverageKey('a:b:2027'), { member_id: 'a:b', plan_year: 2027 });
});

test('T03 a maximum-length coverage subject round-trips through user.confirmed and reopens', () => {
  const m80 = 'm' + 'x'.repeat(79);
  const token = T.makeToken({ ctx: { run_id: 'unit' }, data: { seed_id: 's' }, actor: 'm-1', action: 'cob', kind: 'coverage', id: m80 + ':2026', subject: {}, args: {}, targetVersion: 0 });
  const f = fixture({ seed: S.base() });
  assert.equal(f.event(env('user.confirmed', { token, confirmed_by: 'm-1' })).status, 'committed');
  assert.deepEqual(f.data().approvals[0].subject, { action: 'cob', kind: 'coverage', id: m80 + ':2026' });
  assert.ok(seedValid(f.data()));
});

test('T03 user.confirmed stores an approval cf-N with its parsed subject, or none for an opaque token; the state commits and reopens, and a seed carrying it is refused', () => {
  const f = fixture({ seed: S.base() });
  const parsed = 'tok-withdraw-appeal-ap-1-' + HEX;
  for (const token of ['tok-7c1e', 'tok-file-claim--x-' + HEX, 'tok-info-coverage-m-1:2026-' + HEX, parsed]) assert.equal(f.event(env('user.confirmed', { token, confirmed_by: 'm-1' })).status, 'committed', token);
  f.setNow('2026-11-18T12:10:00-05:00');
  assert.equal(f.event(env('user.confirmed', { token: 'tok-7c1e', confirmed_by: 'm-2' }, '2026-11-18T17:10:00Z')).status, 'committed');
  const data = f.data();
  assert.deepEqual(data.approvals.map(a => [a.approval_id, a.token.slice(0, 26), a.subject, a.confirmed_by, a.confirmed_at, a.used_at]), [
    ['cf-1', 'tok-7c1e', null, 'm-1', NOW, null], ['cf-2', 'tok-file-claim--x-' + HEX.slice(0, 8), null, 'm-1', NOW, null], ['cf-3', 'tok-info-coverage-m-1:2026', null, 'm-1', NOW, null],
    ['cf-4', 'tok-withdraw-appeal-ap-1-a', { action: 'withdraw', kind: 'appeal', id: 'ap-1' }, 'm-1', NOW, null], ['cf-5', 'tok-7c1e', null, 'm-2', '2026-11-18T12:10:00-05:00', null]]);
  assert.equal(data.issued.cf, '5');
  const ctx = later => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: later, binding: structuredClone(binding) });
  for (const later of ['2026-11-18T12:10:00-05:00', '2027-12-23T12:00:00-05:00']) assert.doesNotThrow(() => plugin.validateSeed(ctx(later), structuredClone(data)));
  assert.ok(seedValid(data));
  assert.ok(!stateSeed(data));
  assert.ok(stateSeed({ ...structuredClone(data), approvals: [] }));
  assert.ok(stateSeed(S.base()));
  const again = fixture({ seed: { ...structuredClone(data), approvals: [] } });
  assert.equal(again.event(env('user.confirmed', { token: 'tok-7c1e', confirmed_by: 'm-1' })).status, 'committed');
  assert.equal(again.data().approvals[0].approval_id, 'cf-6');
  const d2 = S.edit(S.base(), x => { x.approvals.push({ ...data.approvals[0], approval_id: 'cf-2' }); });
  const ictx = { ...f.ctx, role: 'infra', virtual_now: '2026-11-18T12:10:00-05:00' }, ok = { token: 'tok-7c1e', confirmed_by: 'm-1' };
  const out = plugin.applyEvent(ictx, d2, env('user.confirmed', ok));
  assert.deepEqual([out.approvals.map(a => a.approval_id), out.issued.cf], [['cf-2', 'cf-1'], '1']);
  assert.deepEqual([plugin.applyEvent(ictx, out, env('user.confirmed', ok)).approvals[2].approval_id, out.issued.cf], ['cf-3', '3']);
});

test('T03 approvals: none for the token is confirmation_required; wrong person, expired or used is confirmation_invalid; the earliest usable one wins', () => {
  const data = { approvals: [] }, now = Date.parse('2026-11-30T09:00:00-05:00');
  const add = (id, by, at, used = null) => data.approvals.push({ approval_id: id, token: 'tok-x', subject: null, confirmed_by: by, confirmed_at: at, used_at: used });
  assert.deepEqual(T.findApproval(data, 'tok-x', 'm-1', now), { error: 'confirmation_required' });
  add('cf-1', 'm-2', '2026-11-30T08:50:00-05:00');
  assert.deepEqual(T.findApproval(data, 'tok-x', 'm-1', now), { error: 'confirmation_invalid' });
  add('cf-2', 'm-1', '2026-11-30T08:30:00-05:00');
  assert.deepEqual(T.findApproval(data, 'tok-x', 'm-1', now), { error: 'confirmation_invalid' });
  assert.deepEqual(T.findApproval(data, 'tok-x', 'm-1', now - 1).approval.approval_id, 'cf-2');
  add('cf-3', 'm-1', '2026-11-30T08:45:00-05:00', '2026-11-30T08:46:00-05:00');
  assert.deepEqual(T.findApproval(data, 'tok-x', 'm-1', now), { error: 'confirmation_invalid' });
  add('cf-5', 'm-1', '2026-11-30T08:40:00-05:00'); add('cf-4', 'm-1', '2026-11-30T08:40:00-05:00'); add('cf-6', 'm-1', '2026-11-30T08:35:00-05:00');
  assert.equal(T.findApproval(data, 'tok-x', 'm-1', now).approval.approval_id, 'cf-6');
  data.approvals[5].used_at = '2026-11-30T08:36:00-05:00';
  assert.equal(T.findApproval(data, 'tok-x', 'm-1', now).approval.approval_id, 'cf-5');
  assert.deepEqual(T.findApproval(data, 'tok-y', 'm-1', now), { error: 'confirmation_required' });
  assert.deepEqual(['2026-11-30T08:29:59.999-05:00', '2026-11-30T08:30:00-05:00', '2026-11-30T08:31:00-05:00'].map(c => T.approvalState({ confirmed_at: '2026-11-30T08:00:00-05:00', used_at: null }, Date.parse(c))), ['active', 'expired', 'expired']);
  assert.deepEqual(T.approvalView({ token: 'tok-x', confirmed_at: '2026-11-30T08:00:00-05:00', used_at: '2026-11-30T08:01:00-05:00' }, now), { token: 'tok-x', confirmed_at: '2026-11-30T08:00:00-05:00', expires_at: '2026-11-30T08:30:00-05:00', state: 'used' });
});

test('T03 confirms check authority, then the approval, then freshness, then state, and only a commit uses the approval', () => {
  const now = Date.parse('2026-11-30T09:00:00-05:00'), at = '2026-11-30T09:00:00-05:00';
  const fresh = () => ({ approvals: [{ approval_id: 'cf-1', token: 'tok-x', subject: null, confirmed_by: 'm-1', confirmed_at: '2026-11-30T08:50:00-05:00', used_at: null }] });
  const steps = [];
  const flow = (data, over = {}) => { try { return { ok: require('../src/confirm.cjs').confirmFlow({ data, now, at, token: 'tok-x', confirmer: 'm-1', authorize: () => steps.push('authority'), currentToken: () => { steps.push('fresh'); return 'tok-x'; }, checkState: () => steps.push('state'), commit: () => { steps.push('commit'); return 'done'; }, ...over }) }; } catch (e) { return e.code; } };
  const boom = code => () => { throw Object.assign(new Error(code), { code }); };
  let d = fresh();
  assert.equal(flow(d, { authorize: boom('not_authorized'), token: 'tok-none' }), 'not_authorized');
  assert.equal(flow({ approvals: [] }, { currentToken: () => 'tok-other' }), 'confirmation_required');
  assert.equal(flow(d, { confirmer: 'm-2', currentToken: () => 'tok-other' }), 'confirmation_invalid');
  assert.equal(flow(d, { now: now + 30 * 60000, currentToken: () => 'tok-other' }), 'confirmation_invalid');
  assert.equal(flow(d, { currentToken: () => 'tok-other', checkState: boom('invalid_state') }), 'stale_preview');
  assert.equal(flow(d, { checkState: boom('invalid_state') }), 'invalid_state');
  assert.equal(d.approvals[0].used_at, null);
  steps.length = 0;
  const ok = flow(d);
  assert.deepEqual([ok.ok.result, ok.ok.approval.approval_id, d.approvals[0].used_at, steps], ['done', 'cf-1', at, ['authority', 'fresh', 'state', 'commit']]);
  assert.equal(flow(d), 'confirmation_invalid');
  d = fresh();
  assert.equal(flow(d, { authorize: undefined }).ok.result, 'done');
  d = fresh();
  assert.equal(flow(d, { commit: boom('invalid_state') }), 'invalid_state');
  assert.equal(d.approvals[0].used_at, null);
});

test('T03 approvals shown: the actor\'s own, on the record they name, only while the actor could perform that action now', () => {
  const tokens = ['tok-info-request-ir-1-' + HEX, 'tok-file-claim-cl-4-' + HEX, 'tok-withdraw-claim-cl-4-' + HEX, 'tok-cob-coverage-m-2:2026-' + HEX, 'tok-cob-coverage-m-2:2025-' + HEX, 'tok-grant-pair-m-2-' + HEX,
    'tok-revoke-grant-gr-h1-' + HEX, 'tok-grant-grant-gr-h1-' + HEX, 'tok-revoke-pair-m-2-' + HEX, 'tok-grant-pair-m-3-' + HEX, 'tok-grant-pair-m-9-' + HEX, 'tok-file-pa-pa-3-' + HEX, 'tok-withdraw-appeal-ap-1-' + HEX];
  const confirmed = (seed, person = 'm-1') => {
    const f = as(person, seed);
    for (const [i, token] of tokens.entries()) { f.setNow('2026-11-18T12:' + String(i).padStart(2, '0') + ':00-05:00'); f.event({ event_id: 'c-' + i, at: f.ctx.virtual_now, operation: 'user.confirmed', payload: { token, confirmed_by: i === 1 ? 'm-2' : person } }); }
    f.setNow('2026-11-18T12:20:00-05:00');
    return f;
  };
  const view = confirmed(S.full());
  assert.deepEqual(view.call(P + 'claims.get', { claim_id: 'cl-4' }).claim.approvals, []);
  assert.deepEqual(view.call(P + 'plan.get', { plan_year: 2026 }).members.find(m => m.member_id === 'm-2').approvals, []);
  assert.deepEqual(view.call(P + 'grants.list').approvals.map(a => a.token), [tokens[9]]);
  const act = confirmed(withGrant('act'));
  const claim = act.call(P + 'claims.get', { claim_id: 'cl-4' }).claim;
  assert.deepEqual(claim.approvals.map(a => a.token), [tokens[0]]);
  assert.deepEqual(claim.info_requests[0].approvals, [{ token: tokens[0], confirmed_at: NOW, expires_at: '2026-11-18T12:30:00-05:00', state: 'active' }]);
  assert.deepEqual(act.call(P + 'claims.list', { member_id: 'm-2' }).claims.map(c => c.approvals.length), [0, 1]);
  assert.deepEqual(act.call(P + 'plan.get', { plan_year: 2026 }).members.find(m => m.member_id === 'm-2').approvals.map(a => a.token), [tokens[3]]);
  assert.deepEqual(act.call(P + 'plan.get', { plan_year: 2025 }).members.find(m => m.member_id === 'm-2').approvals.map(a => [a.token, a.state]), [[tokens[4], 'active']]);
  assert.deepEqual(act.call(P + 'grants.list').approvals.map(a => a.token), [tokens[9]]);
  act.setNow('2026-11-18T12:34:00-05:00');
  assert.deepEqual(act.call(P + 'plan.get', { plan_year: 2025 }).members.find(m => m.member_id === 'm-2').approvals.map(a => a.state), ['expired']);
  const owner = confirmed(S.full(), 'm-2');
  const g = owner.call(P + 'grants.list');
  assert.deepEqual(g.approvals.map(a => a.token), [tokens[5], tokens[6], tokens[7], tokens[9]]);
  assert.deepEqual(owner.call(P + 'grants.list', { member_id: 'm-3' }).approvals.map(a => a.token), [tokens[9]]);
  assert.deepEqual(owner.call(P + 'grants.list', { member_id: 'm-2' }).approvals.map(a => a.token), [tokens[5], tokens[6], tokens[7]]);
  assert.deepEqual(owner.call(P + 'claims.get', { claim_id: 'cl-4' }).claim.approvals.map(a => a.token), [tokens[0], tokens[1]]);
  const data = owner.data(), t = Date.parse(NOW), parse = T.parseToken;
  assert.deepEqual(['tok-file-pa-pa-3-', 'tok-withdraw-appeal-ap-1-', 'tok-file-pa-pa-9-', 'tok-withdraw-appeal-ap-9-', 'tok-info-request-ir-9-', 'tok-file-claim-cl-9-', 'tok-revoke-grant-gr-9-', 'tok-cob-coverage-m-2:2031-', 'tok-cob-coverage-m-9:2026-'].map(x => canAct(data, 'm-2', parse(x + HEX), t)), [true, false, false, false, false, false, false, false, false]);
  assert.deepEqual(['tok-withdraw-appeal-ap-1-', 'tok-file-claim-cl-3-', 'tok-grant-pair-m-1-', 'tok-revoke-grant-gr-h1-'].map(x => canAct(data, 'm-1', parse(x + HEX), t)), [true, true, true, false]);
  assert.equal(canAct(data, 'm-1', parse('tok-grant-pair-m-2-' + HEX), t), false);
});

test('T03 plan.get: benefits of the year, member rows the actor may view, family totals only when every enrolled member is visible', () => {
  const four = S.edit(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 40000 }, { member: 'm-2', year: 2026, deductible_cents: 30000 }]), s => {
    s.members.push({ member_id: 'm-4', name: 'Morgan Hale', relation: 'other', birth_date: '1958-04-02', is_minor: false, guardian_ids: [], enrolled_years: [2027] });
    s.coverage.push({ member_id: 'm-4', plan_year: 2027, status: 'unknown', version: 0, attested_at: null });
    s.accumulators.push({ member_id: 'm-4', plan_year: 2027, deductible_cents: 0, oop_cents: 0 });
    s.plan.years['2025'].copays = { therapy: 3000, office: 2000 };
  });
  const people = S.edit(structuredClone(binding), b => b.people.push({ person_id: 'm-4', name: 'Morgan Hale' }));
  const f = fixture({ seed: S.granted(structuredClone(four)), binding: people });
  const y26 = f.call(P + 'plan.get');
  assert.deepEqual(y26.plan, { plan_id: 'plan-epo', name: 'Larkfield EPO Plan', plan_year: 2026, deductible: { individual_cents: 150000, family_cents: 300000 }, oop_max: { individual_cents: 400000, family_cents: 800000 }, coinsurance_pct: 20,
    copays: [{ category: 'office', copay_cents: 2500 }, { category: 'specialist', copay_cents: 5000 }, { category: 'therapy', copay_cents: 3500 }, { category: 'emergency', copay_cents: 25000 }],
    pa_services: ['svc-adalimumab-40', 'svc-arthroscopy', 'svc-physical-therapy'], network: { in_network_only: true, emergency_out_of_network: 'in_network_cost_sharing' }, emergency: { pa_required: false, cost_sharing: 'service_category_in_network' } });
  assert.deepEqual(y26.members.map(m => [m.member_id, m.deductible_cents, m.oop_cents, m.other_coverage.status, m.other_coverage.version]), [['m-1', 40000, 42500, 'none', 1], ['m-2', 30000, 30000, 'none', 1], ['m-3', 0, 0, 'unknown', 0]]);
  assert.deepEqual(y26.members[0].other_coverage, { status: 'none', version: 1, attested_at: '2026-01-15T10:00:00-05:00' });
  assert.deepEqual(y26.family, { deductible_cents: 70000, oop_cents: 72500 });
  assert.deepEqual(f.call(P + 'plan.get', { plan_year: 2025 }).plan.copays, [{ category: 'office', copay_cents: 2000 }, { category: 'therapy', copay_cents: 3000 }]);
  const y27 = f.call(P + 'plan.get', { plan_year: 2027 });
  assert.deepEqual([y27.plan.plan_year, y27.members.map(m => m.member_id), y27.family], [2027, ['m-1', 'm-2', 'm-3'], null]);
  for (const year of [2024, 2028, 1999, 2200]) assert.equal(f.call(P + 'plan.get', { plan_year: year }).status, 'not_found', String(year));
  assert.deepEqual(f.call(P + 'plan.get', { plan_year: 2028 }), { status: 'not_found', message: 'The plan has no plan year 2028.' });
  const hidden = fixture({ seed: structuredClone(four), binding: people });
  const h = hidden.call(P + 'plan.get', { plan_year: 2026 });
  assert.deepEqual([h.members.map(m => m.member_id), h.family], [['m-1', 'm-3'], null]);
  f.setNow('2027-01-01T00:00:00-05:00');
  assert.equal(f.call(P + 'plan.get').plan.plan_year, 2027);
  f.setNow('2026-12-31T23:59:59.999-05:00');
  assert.equal(f.call(P + 'plan.get').plan.plan_year, 2026);
  f.setNow('2028-01-01T00:00:00-05:00');
  assert.equal(f.call(P + 'plan.get').status, 'not_found');
  const m4 = fixture({ ...holder(structuredClone(four), 'm-4'), binding: S.edit(structuredClone(people), b => { b.accounts = [{ app_id: 'larkfield-health', account_id: 'larkfield-m-4', owner_person_id: 'm-4' }]; }) });
  assert.deepEqual([m4.call(P + 'plan.get', { plan_year: 2026 }).members, m4.call(P + 'plan.get', { plan_year: 2026 }).family], [[], null]);
  assert.deepEqual(m4.call(P + 'plan.get', { plan_year: 2027 }).members.map(m => m.member_id), ['m-4']);
  const t = Date.parse(NOW);
  assert.deepEqual(['m-4:2026', 'm-4:2027', 'm-1:2027'].map(id => canAct(four, 'm-4', T.parseToken('tok-cob-coverage-' + id + '-' + HEX), t)), [false, true, false]);
});

test('T03 a pair version is the exact sum of grant versions plus one each, across a create and expire cycle at high versions', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const s = S.full();
  assert.equal(T.pairVersion(s, 'm-2', 'm-1'), '1');
  assert.equal(T.pairVersion(s, 'm-2', 'm-3'), '0');
  assert.equal(T.pairVersion(s, 'm-1', 'm-2'), '0');
  s.grants[0].expires_at = '2026-10-01T00:00:00-04:00';
  s.grants[0].grant_version = max - 1;
  s.grants.push({ ...s.grants[0], grant_id: 'gr-h0', grant_version: max, created_at: '2026-01-01T00:00:00-05:00', expires_at: '2026-02-01T00:00:00-05:00' });
  assert.equal(T.pairVersion(s, 'm-2', 'm-1'), '18014398509481983');
  assert.notEqual(String((max - 1 + 1) + (max + 1)), T.pairVersion(s, 'm-2', 'm-1'));
  s.grants.push({ ...s.grants[0], grant_id: 'gr-1', grant_version: 0, created_at: '2026-11-01T00:00:00-04:00', expires_at: null });
  assert.equal(T.pairVersion(s, 'm-2', 'm-1'), '18014398509481984');
  assert.deepEqual(T.pairSubject(s, 'm-2', 'm-1').grants.map(g => g.grant_id), ['gr-1', 'gr-h0', 'gr-h1']);
  assert.ok(plugin.validateSeed({ app_id: 'larkfield-health', binding, virtual_now: NOW }, s) === undefined);
});

test('T03 token subjects bind the target record and the immutable records it hangs off, and nothing else', () => {
  const s = S.full(), mk = (kind, subject) => T.makeToken({ ctx: { run_id: 'u' }, data: s, actor: 'm-1', action: 'x', kind, id: 'i', subject, args: {}, targetVersion: 0 });
  const differ = (kind, build, edits) => {
    const before = mk(kind, build(s));
    for (const [label, fn] of edits) { const c = structuredClone(s); fn(c); assert.notEqual(mk(kind, build(c)), before, kind + ' ' + label); }
  };
  const same = (kind, build, fn) => { const c = structuredClone(s); fn(c); assert.equal(mk(kind, build(c)), mk(kind, build(s)), kind); };
  const req = d => T.requestSubject(d, d.info_requests[0]);
  differ('request', req, [['request', d => { d.info_requests[0].expires_at = '2027-01-05T23:59:00-05:00'; }], ['member', d => { d.claims.find(c => c.claim_id === 'cl-4').member_id = 'm-3'; }],
    ['provider', d => { d.claims.find(c => c.claim_id === 'cl-4').provider_id = 'pv-2'; }], ['receipt', d => { d.claims.find(c => c.claim_id === 'cl-4').received_at = '2026-11-13T09:01:00-05:00'; }],
    ['billed', d => { d.claims.find(c => c.claim_id === 'cl-4').lines[0].billed_cents = 21001; }], ['flag', d => { d.claims.find(c => c.claim_id === 'cl-4').lines[0].possible_accident = true; }]]);
  same('request', req, d => { d.claims.find(c => c.claim_id === 'cl-4').claim_version = 9; d.grants = []; d.claims.find(c => c.claim_id === 'cl-2').lines[0].billed_cents = 1; });
  const cov = d => T.coverageSubject(d, d.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026));
  differ('coverage', cov, [['status', d => { Object.assign(d.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', attested_at: NOW }); }], ['member', d => { d.members[1].birth_date = '1986-09-03'; }]]);
  same('coverage', cov, d => { d.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2025).status = 'none'; });
  const claim = d => T.claimSubject(d, d.claims.find(c => c.claim_id === 'cl-3'));
  differ('claim', claim, [['claim', d => { d.claims.find(c => c.claim_id === 'cl-3').lines[1].service_id = 'svc-office-visit'; }], ['eob', d => { d.eobs.find(e => e.claim_id === 'cl-3').lines[0].reason = 'prior_auth_missing'; }]]);
  same('claim', claim, d => { d.eobs.find(e => e.claim_id === 'cl-1').issued_at = NOW; });
  assert.equal(T.claimSubject(s, s.claims.find(c => c.claim_id === 'cl-2')).eob, null);
  const two = S.overturned(), cur = T.claimSubject(two, two.claims.find(c => c.claim_id === 'cl-3')).eob;
  assert.deepEqual([cur.version, cur.reason], [2, 'appeal']);
  const pa = d => T.paSubject(d.pas.find(p => p.pa_id === 'pa-3'));
  differ('pa', pa, [['requested', d => { d.pas.find(p => p.pa_id === 'pa-3').requested.units = 2; }]]);
  const appeal = d => T.appealSubject(d, d.appeals[0]);
  differ('appeal', appeal, [['statement', d => { d.appeals[0].statements[0].text = 'Other.'; }], ['claim line', d => { d.claims.find(c => c.claim_id === 'cl-3').lines[0].service_id = 'svc-lab-panel'; }],
    ['v1', d => { d.eobs.find(e => e.claim_id === 'cl-3').lines[0].reason = 'prior_auth_missing'; }], ['notice', d => { d.windows[0].notice_at = '2026-11-15T23:58:00-05:00'; }],
    ['provider', d => { d.claims.find(c => c.claim_id === 'cl-3').provider_id = 'pv-6'; }]]);
  same('appeal', appeal, d => { d.claims.find(c => c.claim_id === 'cl-3').claim_version = 5; d.windows[0].closing.done = true; d.pas[0].units_used = 3; });
  const crowded = structuredClone(s);
  crowded.windows.unshift({ ...structuredClone(s.windows[0]), target: { type: 'claim', id: 'cl-1' } }, { ...structuredClone(s.windows[1]), target: { type: 'pa', id: 'cl-3' } });
  const noticeOf = d => T.appealSubject(d, d.appeals[0]).target.notice_at;
  assert.equal(noticeOf(crowded), s.windows[0].notice_at);
  crowded.windows[0].notice_at = crowded.windows[1].notice_at = '2026-11-14T23:59:00-05:00';
  assert.equal(noticeOf(crowded), s.windows[0].notice_at);
  const onPa = S.openAppeal({ type: 'pa', id: 'pa-3' }), pAppeal = d => T.appealSubject(d, d.appeals[0]);
  const facts = pAppeal(onPa).target;
  assert.deepEqual(facts, { type: 'pa', pa_id: 'pa-3', member_id: 'm-2', provider_id: 'pv-4', service_id: 'svc-arthroscopy', submitted_at: '2026-11-01T09:00:00-05:00', requested: { units: 1, valid_from: '2026-11-20', valid_until: '2026-12-20' }, denial_notice_at: '2026-11-10T10:00:00-05:00' });
  const before = T.makeToken({ ctx: { run_id: 'u' }, data: onPa, actor: 'm-1', action: 'withdraw', kind: 'appeal', id: 'ap-1', subject: pAppeal(onPa), args: {}, targetVersion: 0 });
  for (const fn of [d => { d.pas[0].requested.valid_until = '2026-12-21'; }, d => { d.pas[0].submitted_at = '2026-11-01T09:00:01-05:00'; }, d => { d.pas[0].service_id = 'svc-physical-therapy'; }]) {
    const c = structuredClone(onPa); fn(c);
    assert.notEqual(T.makeToken({ ctx: { run_id: 'u' }, data: c, actor: 'm-1', action: 'withdraw', kind: 'appeal', id: 'ap-1', subject: pAppeal(c), args: {}, targetVersion: 0 }), before);
  }
  const pair = d => T.pairSubject(d, 'm-2', 'm-1');
  differ('pair', pair, [['expiry', d => { d.grants[0].expires_at = '2027-01-01T00:00:00-05:00'; }], ['member', d => { d.members[1].name = 'Casey J. Hale'; }]]);
  same('pair', pair, d => { d.grants.push({ ...d.grants[0], grant_id: 'gr-h9', grantee_id: 'm-3' }); });
  const grant = d => T.grantSubject(d.grants[0]);
  differ('grant', grant, [['scope', d => { d.grants[0].scope = 'act'; }]]);
});

const TM = require('../src/timers.cjs');
const { pendingTimers } = require('../src/model.cjs');
const { PROJECTION, bump, VERSION_MAX } = require('../src/util.cjs');
const N = require('../src/notices.cjs');
const DUE = '2026-12-01T23:59:00-05:00', AFTER = '2026-12-02T09:00:00-05:00';
const seen = [];
const overdue = (data, pa, at) => { seen.push(data[PROJECTION] === true); pa.overdue = true; pa.overdue_at = at; bump(data, pa, 'pa_id', 'pa_version'); N.decisionOverdue(data, 'pa', pa, at); };
const peek = (ctx, d, args, g) => ({ pa: structuredClone(g.pa), flagged: d[PROJECTION] === true, notices: structuredClone(d.notices) });

test('T03 timers: the six kinds match the stored timers and run by due time, object ID string, kind and target type', () => {
  for (const s of [S.full(), S.overturned(), S.openAppeal({ type: 'pa', id: 'pa-3' }, 'info_requested'), S.pendingCob('m-2', 2026, S.base(), true)]) {
    assert.deepEqual(TM.pending(s).map(x => [x.kind, x.id, x.t]).sort(), pendingTimers(s).sort());
  }
  const at = '2026-12-01T10:00:00-05:00';
  const d = {
    claims: [{ claim_id: 'cl-9', status: 'received', review_at: DUE }, { claim_id: 'cl-10', status: 'received', review_at: DUE }, { claim_id: 'cl-8', status: 'processed', review_at: at }, { claim_id: 'cl-7', status: 'pending_info', review_at: at }],
    info_requests: [{ info_request_id: 'cl-10', status: 'open', expires_at: DUE }, { info_request_id: 'ir-1', status: 'answered', expires_at: at }, { info_request_id: 'ir-2', status: 'expired', expires_at: at }],
    pas: [{ pa_id: 'pa-1', status: 'approved', approved: { valid_until: '2026-12-01' }, overdue: false, due_at: at }, { pa_id: 'pa-2', status: 'pending', overdue: false, due_at: at }, { pa_id: 'pa-5', status: 'info_requested', overdue: false, due_at: at },
      { pa_id: 'pa-3', status: 'info_requested', overdue: true, due_at: at }, { pa_id: 'pa-4', status: 'denied', overdue: false, due_at: at }, { pa_id: 'pa-6', status: 'expired', approved: { valid_until: '2026-11-01' }, overdue: false, due_at: at }],
    appeals: [{ appeal_id: 'cl-10', status: 'info_requested', overdue: false, due_at: DUE }, { appeal_id: 'ap-4', status: 'under_review', overdue: false, due_at: at }, { appeal_id: 'ap-2', status: 'upheld', overdue: false, due_at: at }, { appeal_id: 'ap-3', status: 'under_review', overdue: true, due_at: at }],
    windows: [{ target: { type: 'pa', id: 'x' }, closing: { done: false, due_at: DUE } }, { target: { type: 'claim', id: 'x' }, closing: { done: false, due_at: DUE } }, { target: { type: 'claim', id: 'y' }, closing: { done: true, due_at: at } }],
  };
  const list = now => TM.dueTimers(d, now).map(x => [x.kind, x.id, x.type]);
  assert.deepEqual(list(DUE), [['appeal_due', 'ap-4', ''], ['pa_due', 'pa-2', ''], ['pa_due', 'pa-5', ''], ['review', 'cl-10', ''], ['request_expiry', 'cl-10', ''], ['appeal_due', 'cl-10', ''], ['review', 'cl-9', ''], ['validity_end', 'pa-1', ''], ['window_closing', 'x', 'claim'], ['window_closing', 'x', 'pa']]);
  assert.deepEqual(list('2026-12-01T23:58:59.999-05:00'), [['appeal_due', 'ap-4', ''], ['pa_due', 'pa-2', ''], ['pa_due', 'pa-5', '']]);
  d.windows.reverse(); d.claims.reverse();
  assert.deepEqual(list(DUE), [['appeal_due', 'ap-4', ''], ['pa_due', 'pa-2', ''], ['pa_due', 'pa-5', ''], ['review', 'cl-10', ''], ['request_expiry', 'cl-10', ''], ['appeal_due', 'cl-10', ''], ['review', 'cl-9', ''], ['validity_end', 'pa-1', ''], ['window_closing', 'x', 'claim'], ['window_closing', 'x', 'pa']]);
  assert.deepEqual(TM.KINDS, ['review', 'request_expiry', 'validity_end', 'pa_due', 'appeal_due', 'window_closing']);
});

test('T03 timers: reads project due timers on a marked copy dated at the due time and store nothing; projected IDs equal the committed ones', () => {
  const f = fixture({ seed: S.paPending(), now: AFTER, effects: { pa_due: overdue } });
  const before = f.data();
  seen.length = 0;
  const data = f.data();
  const read = plugin.handleTool(f.ctx, data, P + 'pa.get', { pa_id: 'pa-2' }, { ...OPS, 'pa.get': peek }, { pa_due: overdue });
  assert.equal(read.data, data);
  assert.deepEqual(data, before);
  assert.deepEqual([read.result.flagged, read.result.pa.overdue, read.result.pa.overdue_at, read.result.pa.pa_version, seen], [true, true, DUE, 1, [true]]);
  assert.deepEqual(read.result.notices.map(n => [n.notice_id, n.kind, n.recipient_id, n.at]), [['n-1', 'notice.decision_overdue', 'm-1', DUE], ['n-2', 'notice.decision_overdue', 'm-2', DUE], ['n-3', 'notice.decision_overdue', 'm-3', DUE]]);
  assert.equal(f.call(P + 'members.list').status, 'ok');
  assert.deepEqual(f.data(), before);
  assert.equal(f.event({ event_id: 'c-1', at: AFTER, operation: 'user.confirmed', payload: { token: 'tok-7c1e', confirmed_by: 'm-1' } }).status, 'committed');
  const after = f.data();
  assert.deepEqual(after.notices, read.result.notices);
  assert.deepEqual([after.pas[0].overdue_at, after.pas[0].pa_version, after.approvals[0].approval_id, after.approvals[0].confirmed_at, seen], [DUE, 1, 'cf-1', AFTER, [true, true, false]]);
  assert.equal(f.event({ event_id: 'c-2', at: AFTER, operation: 'user.confirmed', payload: { token: 'tok-7c1e', confirmed_by: 'm-1' } }).status, 'committed');
  assert.deepEqual([f.data().notices.length, seen.length], [3, 3]);
});

test('T03 timers: a failing write or event stores nothing, though its handler saw the timers applied; the next successful call commits them once', () => {
  const f = fixture({ seed: S.paPending(), now: AFTER, effects: { pa_due: overdue } });
  const before = f.data();
  assert.equal(f.event({ event_id: 'c-1', at: AFTER, operation: 'user.confirmed', payload: { token: 'tok-7c1e', confirmed_by: 'p-9' } }).status, 'invalid_event');
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-2', reason: 'x'.repeat(2001) }).status, 'invalid_arguments');
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-9' }).status, 'not_found');
  let saw = null;
  const failing = { ...OPS, 'pa.request_expedite': (ctx, d, args, g) => { saw = [g.pa.overdue, d.notices.length, d[PROJECTION] === true]; throw Object.assign(new Error('refused'), { code: 'invalid_state' }); } };
  assert.throws(() => plugin.handleTool(f.ctx, f.data(), P + 'pa.request_expedite', { request_id: 'r', expected_version: { epoch: 1, revision: 0 }, pa_id: 'pa-2' }, failing, { pa_due: overdue }), e => e.code === 'invalid_state');
  assert.deepEqual(saw, [true, 3, false]);
  assert.deepEqual(f.data(), before);
  assert.equal(f.event({ event_id: 'c-2', at: AFTER, operation: 'user.confirmed', payload: { token: 'tok-7c1e', confirmed_by: 'm-1' } }).status, 'committed');
  assert.deepEqual([f.data().notices.length, f.data().pas[0].overdue, f.data().approvals.length], [3, true, 1]);
});

test('T03 timers: a due timer whose effect is not built yet refuses reads and writes with invalid_state and events with invalid_event', () => {
  const f = fixture({ seed: S.openAppeal(), now: '2027-01-16T23:58:59.999-05:00', effects: { ...TM.EFFECTS, appeal_due: undefined } });
  assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-1' }).status, 'ok');
  f.setNow('2027-01-16T23:59:00-05:00');
  const msg = /^A appeal_due timer is due at 2027-01-16T23:59:00-05:00, and that timer is not available yet\.$/;
  const read = f.call(P + 'claims.get', { claim_id: 'cl-1' });
  assert.equal(read.status, 'invalid_state');
  assert.match(read.message, msg);
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-9' }).status, 'invalid_state');
  const e = f.event({ event_id: 'c-1', at: '2027-01-17T09:00:00-05:00', operation: 'user.confirmed', payload: { token: 'tok-7c1e', confirmed_by: 'm-1' } });
  assert.equal(e.status, 'invalid_event');
  assert.match(e.message, msg);
});

test('T03 timers: an effect must complete its timer; timers it makes due run in the same call, each a step of its own', () => {
  const now = '2026-11-21T09:00:00-05:00';
  const stuck = S.received();
  assert.throws(() => TM.applyDueTimers(stuck, now, { effects: { review: () => {} } }), e => e.code === 'invalid_state' && /^A review timer due at 2026-11-20T23:59:00-05:00 did not complete\.$/.test(e.message));
  assert.throws(() => TM.applyDueTimers(S.received(), now, { effects: { review: () => {} }, code: 'invalid_event' }), e => e.code === 'invalid_event');
  const d = S.received();
  S.claim(d, { claim_id: 'cl-6', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-18T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000)] });
  const effects = {
    review: (data, c, at) => { c.status = 'pending_info'; bump(data, c, 'claim_id', 'claim_version'); data.info_requests.push({ info_request_id: 'ir-9', claim_id: c.claim_id, status: 'open', expires_at: at }); },
    request_expiry: (data, r) => { r.status = 'expired'; bump(data, data.claims.find(c => c.claim_id === r.claim_id), 'claim_id', 'claim_version'); },
  };
  assert.deepEqual(TM.applyDueTimers(d, now, { effects }), [{ kind: 'review', id: 'cl-2', at: '2026-11-20T23:59:00-05:00' }, { kind: 'request_expiry', id: 'ir-9', at: '2026-11-20T23:59:00-05:00' }]);
  assert.equal(d.claims.find(c => c.claim_id === 'cl-2').claim_version, 2);
  assert.deepEqual(TM.applyDueTimers(d, now, { effects }), []);
  assert.deepEqual(TM.applyDueTimers(S.received(), '2026-11-20T23:58:00-05:00', { effects }), []);
});

test('T03 timers: a projected read never fails at a version limit where the committing write is refused', () => {
  const s = S.edit(S.paPending(), x => { x.pas[0].pa_version = VERSION_MAX; });
  const f = fixture({ seed: s, now: AFTER, effects: { pa_due: overdue } });
  const read = plugin.handleTool(f.ctx, f.data(), P + 'pa.get', { pa_id: 'pa-2' }, { ...OPS, 'pa.get': peek }, { pa_due: overdue });
  assert.deepEqual([read.result.pa.overdue, read.result.pa.pa_version], [true, VERSION_MAX]);
  const e = f.event({ event_id: 'c-1', at: AFTER, operation: 'user.confirmed', payload: { token: 'tok-7c1e', confirmed_by: 'm-1' } });
  assert.deepEqual([e.status, e.message], ['invalid_state', 'Record pa-2 has reached its version limit.']);
});

test('T03 an unknown tool is refused before anything else', () => {
  const f = as('m-1');
  assert.throws(() => plugin.handleTool(f.ctx, f.data(), P + 'claims.delete', {}), e => e.code === 'unknown_tool' && e.message === 'Unknown tool larkfield-health.claims.delete.');
});

test('T03 a claim view carries only its own EOBs, requests in ID order, window and appeals', () => {
  const s = S.pendingCob('m-2', 2026, S.full(), true, { claim_id: 'cl-6', received_at: '2026-11-13T10:00:00-05:00' });
  s.info_requests.find(r => r.info_request_id === 'ir-3').info_request_id = 'ir-10';
  s.issued.ir = '10';
  const f = as('m-1', s);
  const view = id => f.call(P + 'claims.get', { claim_id: id }).claim;
  const c1 = view('cl-1'), c3 = view('cl-3'), c6 = view('cl-6');
  assert.deepEqual([c1.eobs.map(e => e.eob_id), c1.appeal_window, c1.appeal_ids, c1.info_requests], [['eob-1'], null, [], []]);
  assert.deepEqual([c3.eobs.map(e => e.eob_id), c3.appeal_window, c3.appeal_ids], [['eob-2'], { notice_at: '2026-11-15T23:59:00-05:00', ends_at: '2027-05-14T23:59:00-04:00', closing_notice_at: null }, ['ap-1']]);
  assert.deepEqual(c6.info_requests.map(r => [r.info_request_id, r.type]), [['ir-10', 'accident'], ['ir-2', 'other_coverage']]);
  assert.deepEqual(view('cl-4').info_requests.map(r => r.info_request_id), ['ir-1']);
});
