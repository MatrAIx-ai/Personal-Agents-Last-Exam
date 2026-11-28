'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const app = require('../app.json');
const binding = require('../fixtures/binding.json');

const P = 'larkfield-health.';
const T0 = '2026-11-18T12:00:00-05:00';
const helpers = S.edit(structuredClone(binding), b => b.people.push({ person_id: 'p-7', name: 'Outside Helper' }));
let n = 0;
const ev = (f, operation, payload, at = f.ctx.virtual_now) => f.event({ event_id: 'e18-' + (++n), at, operation, payload });
const ok = (f, token, by) => ev(f, 'user.confirmed', { token, confirmed_by: by || f.data().owner_person_id });
const tick = f => assert.equal(ok(f, 'tok-7c1e').status, 'committed');
function settle(f, op, args) { const pv = f.call(P + op + '.preview', args); assert.equal(pv.status, 'ok', op + ' ' + JSON.stringify(pv)); ok(f, pv.preview.token); const out = f.call(P + op + '.confirm', { ...args, token: pv.preview.token }); assert.equal(out.status, 'committed', op + ' ' + JSON.stringify(out)); return out; }
const receive = (f, claim_id, member_id, lines, provider_id = 'pv-1') => ev(f, 'claim.received', { claim_id, member_id, provider_id, lines: lines.map(({ position, ...l }) => l) });
function holder(seed, person, b = binding) {
  const s = structuredClone(seed), bb = structuredClone(b);
  s.account_id = 'larkfield-' + person; s.owner_person_id = person;
  bb.accounts = [{ app_id: 'larkfield-health', account_id: s.account_id, owner_person_id: person }];
  return { seed: s, binding: bb };
}
const ctxAt = (now, b) => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now, binding: structuredClone(b) });
const reopen = f => { const data = JSON.parse(JSON.stringify(f.data())); for (const later of [f.ctx.virtual_now, new Date(Date.parse(f.ctx.virtual_now) + 400 * 86400000).toISOString()]) plugin.validateSeed(ctxAt(later, f.ctx.binding), data); };
const withGrant = (scope, o = {}) => S.edit(S.full(), s => Object.assign(s.grants[0], { scope, ...o }));

function matrix() {
  const s = S.full();
  S.claim(s, { claim_id: 'cl-6', member_id: 'm-3', provider_id: 'pv-5', received_at: '2026-11-13T11:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-12', 21000)] });
  S.window(s, 'claim', 'cl-6', S.process(s, 'cl-6', [S.denied('ln-1', 'out_of_network', 21000)]).issued_at);
  s.pas.push({ ...structuredClone(s.pas.find(p => p.pa_id === 'pa-2')), pa_id: 'pa-4', member_id: 'm-1' });
  S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', S.openAppeal({ type: 'claim', id: 'cl-6' }, 'under_review', S.finalize(s)));
  return S.granted(S.granted(s, 'm-1', 'view', null, 'm-2'), 'm-3', 'view', null, 'm-1');
}
const onMatrix = (scope, o = {}) => S.edit(matrix(), s => Object.assign(s.grants[0], { scope, ...o }));
const ON = { 'm-1': { claim: 'cl-3', line: 'ln-1', appeal: 'ap-1', pa: 'pa-4', grant: 'gr-h2', grantee: 'm-3' }, 'm-2': { claim: 'cl-4', line: 'ln-1', pa: 'pa-3', appeal: 'ap-3', grant: 'gr-h1', grantee: 'm-3' },
  'm-3': { claim: 'cl-5', line: 'ln-1', pa: 'pa-2', appeal: 'ap-2', grant: 'gr-h3', grantee: 'm-2' } };
function cases(member, data) {
  const o = ON[member], tok = { token: 'tok-x' };
  const cob = { member_id: member, plan_year: 2026, answer: 'none' }, info = { claim_id: o.claim, line_id: o.line, answer: 'not_accident' }, file = { target_type: 'claim', target_id: o.claim, statement: 'Please review.' };
  const grant = { action: 'grant', member_id: member, grantee_id: o.grantee, scope: 'view' };
  const out = [['grants.list', { member_id: member }, 'view'], ['claims.list', { member_id: member }, 'view'], ['pa.list', { member_id: member }, 'view'], ['appeals.list', { member_id: member }, 'view'], ['claims.get', { claim_id: o.claim }, 'view'],
    ['coverage.cob.preview', cob, 'act'], ['coverage.cob.confirm', { ...cob, ...tok }, 'act'], ['claims.info.preview', info, 'act'], ['claims.info.confirm', { ...info, ...tok }, 'act'],
    ['appeals.file.preview', file, 'act'], ['appeals.file.confirm', { ...file, ...tok }, 'act'], ['grants.change.preview', grant, 'full'], ['grants.change.confirm', { ...grant, ...tok }, 'full']];
  if (o.pa) out.push(['pa.get', { pa_id: o.pa }, 'view'], ['pa.request_expedite', { pa_id: o.pa }, 'act'], ['appeals.file.preview', { ...file, target_type: 'pa', target_id: o.pa }, 'act']);
  if (o.appeal) out.push(['appeals.get', { appeal_id: o.appeal }, 'view'], ['appeals.withdraw.preview', { appeal_id: o.appeal }, 'act'], ['appeals.withdraw.confirm', { appeal_id: o.appeal, ...tok }, 'act'], ['appeals.add_statement', { appeal_id: o.appeal, statement: 'More.' }, 'act']);
  if (o.grant && data.grants.some(g => g.grant_id === o.grant)) out.push(['grants.change.preview', { action: 'revoke', grant_id: o.grant }, 'full'], ['grants.change.confirm', { action: 'revoke', grant_id: o.grant, ...tok }, 'full']);
  return out;
}
const LEVEL = { none: 0, view: 1, act: 2, full: 3 };

test('T18 every newly eligible matrix cell has its exact outcome: a guardian withdraws the minor\'s appeal with an approval, members act on their own PA, appeal and grants, and a bound minor cannot', () => {
  const as = who => fixture(holder(matrix(), who));
  const used = f => f.data().approvals.map(a => [a.confirmed_by, a.used_at]);
  for (const guardian of ['m-1', 'm-2']) {
    const f = as(guardian);
    assert.deepEqual([f.call(P + 'appeals.get', { appeal_id: 'ap-2' }).appeal.member_id, f.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-2' }).preview.required_confirmer, f.call(P + 'appeals.withdraw.confirm', { appeal_id: 'ap-2', token: 'tok-x' }).status],
      ['m-3', guardian, 'confirmation_required']);
    const st = f.call(P + 'appeals.add_statement', { appeal_id: 'ap-2', statement: 'Letter from the clinic.' });
    assert.deepEqual([st.status, st.appeal.statements.at(-1)], ['committed', { at: T0, by: guardian, text: 'Letter from the clinic.' }]);
    const out = settle(f, 'appeals.withdraw', { appeal_id: 'ap-2' });
    assert.deepEqual([out.appeal.status, out.appeal.withdrawn_at, used(f)], ['withdrawn', T0, [[guardian, T0]]]);
    reopen(f);
  }
  const one = as('m-1');
  assert.deepEqual([one.call(P + 'pa.request_expedite', { pa_id: 'pa-4' }).status, settle(one, 'grants.change', { action: 'revoke', grant_id: 'gr-h2' }).grant.state, settle(one, 'grants.change', { action: 'revoke', grant_id: 'gr-h3' }).grant.state], ['committed', 'revoked', 'revoked']);
  reopen(one);
  const two = as('m-2');
  assert.deepEqual([settle(two, 'appeals.withdraw', { appeal_id: 'ap-3' }).appeal.status, two.call(P + 'appeals.get', { appeal_id: 'ap-1' }).status, two.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-1' }).status, two.call(P + 'pa.request_expedite', { pa_id: 'pa-4' }).status],
    ['withdrawn', 'ok', 'not_authorized', 'not_authorized']);
  reopen(two);
  const minor = as('m-3'), before = minor.data();
  assert.deepEqual([minor.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-2' }).status, minor.call(P + 'appeals.add_statement', { appeal_id: 'ap-2', statement: 'Mine.' }).status], ['not_authorized', 'not_authorized']);
  assert.deepEqual(minor.data(), before);
});

test('T18 denial matrix: all 21 tools under every relation with the real handlers; denied calls store nothing, allowed calls are never not_authorized', () => {
  const scenarios = [
    ['m-1', matrix(), { 'm-1': 'full', 'm-2': 'view', 'm-3': 'full' }], ['m-1', onMatrix('act'), { 'm-2': 'act' }], ['m-1', onMatrix('act', { expires_at: '2026-11-01T00:00:00-04:00' }), { 'm-2': 'none' }],
    ['m-1', onMatrix('act', { status: 'revoked', revoked_at: '2026-11-01T00:00:00-04:00' }), { 'm-2': 'none' }], ['m-1', S.edit(matrix(), s => { s.grants = []; }), { 'm-2': 'none' }],
    ['m-2', S.edit(matrix(), s => { s.grants = []; }), { 'm-1': 'none', 'm-2': 'full', 'm-3': 'full' }], ['m-2', matrix(), { 'm-1': 'view', 'm-2': 'full', 'm-3': 'full' }],
    ['m-3', onMatrix('act', { grantee_id: 'm-3' }), { 'm-1': 'none', 'm-2': 'act', 'm-3': 'none' }], ['m-3', onMatrix('view', { grantee_id: 'm-3' }), { 'm-2': 'view' }],
  ];
  const seen = new Set();
  for (const [who, seed, levels] of scenarios) for (const [member, level] of Object.entries(levels)) for (const [op, args, power] of cases(member, seed)) {
    const f = fixture(holder(seed, who)), before = f.data(), out = f.call(P + op, args);
    seen.add(op);
    if (LEVEL[level] >= LEVEL[power]) assert.notEqual(out.status, 'not_authorized', who + ' ' + member + ' ' + op);
    else { assert.equal(out.status, 'not_authorized', who + ' ' + member + ' ' + op); assert.deepEqual(f.data(), before); }
    assert.notEqual(out.status, 'invalid_seed', who + ' ' + op + ' ' + out.message);
  }
  for (const who of ['m-1', 'm-2', 'm-3']) { const f = fixture(holder(S.full(), who)); assert.equal(f.call(P + 'members.list').status, 'ok'); assert.notEqual(f.call(P + 'plan.get').status, 'not_authorized'); seen.add('members.list'); seen.add('plan.get'); }
  assert.deepEqual([...seen].sort(), tools.map(t => t.name.slice(P.length)).sort());
});

test('T18 unknown-target matrix: every event naming an unknown member, provider, service, PA, appeal, grant, grantor, grantee or confirmer is invalid_event and stores nothing', () => {
  const claim = { claim_id: 'cl-8', member_id: 'm-1', provider_id: 'pv-1', lines: [{ line_id: 'ln-1', service_id: 'svc-office-visit', service_date: '2026-11-17', units: 1, billed_cents: 100, emergency: false, possible_accident: false }] };
  const sub = { pa_id: 'pa-8', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31' };
  const act = { grant_id: 'gr-8', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-3', scope: 'view', expires_at: null, status: 'active' };
  const rows = [
    ['claim.received', { ...claim, member_id: 'm-9' }, 'member m-9'], ['claim.received', { ...claim, provider_id: 'pv-9' }, 'provider pv-9'], ['claim.received', { ...claim, lines: [{ ...claim.lines[0], service_id: 'svc-x' }] }, 'service svc-x'],
    ['pa.submitted', { ...sub, member_id: 'm-9' }, 'member m-9'], ['pa.submitted', { ...sub, provider_id: 'pv-9' }, 'provider pv-9'], ['pa.submitted', { ...sub, service_id: 'svc-x' }, 'service svc-x'],
    ['pa.info_requested', { pa_id: 'pa-9', request: 'Notes' }, 'pa pa-9'], ['pa.info_provided', { pa_id: 'pa-9' }, 'pa pa-9'], ['pa.decided', { pa_id: 'pa-9', decision: 'denied' }, 'pa pa-9'], ['pa.withdrawn', { pa_id: 'pa-9' }, 'pa pa-9'],
    ['pa.expedite_decided', { pa_id: 'pa-9', decision: 'approved' }, 'pa pa-9'], ['appeal.info_requested', { appeal_id: 'ap-9', request: 'A letter' }, 'appeal ap-9'], ['appeal.decided', { appeal_id: 'ap-9', outcome: 'upheld' }, 'appeal ap-9'],
    ['grant.changed', { ...act, member_id: 'm-9' }, 'member m-9'], ['grant.changed', { ...act, grantor_id: 'p-9' }, 'grantor p-9'], ['grant.changed', { ...act, grantee_id: 'p-9' }, 'grantee p-9'], ['grant.changed', { grant_id: 'gr-9', status: 'revoked' }, 'grant gr-9'],
    ['user.confirmed', { token: 'tok-7c1e', confirmed_by: 'p-9' }, 'confirmer p-9'],
  ];
  const f = fixture({ seed: S.full() }), before = f.data(), ops = new Set();
  for (const [op, payload, what] of rows) { assert.deepEqual(ev(f, op, payload), { status: 'invalid_event', message: 'The event names an unknown ' + what + '.' }, op); ops.add(op); }
  assert.deepEqual([f.data(), [...ops].sort()], [before, [...app.event_types].sort()]);
});

test('T18 notice matrix, timer rows: a viewer whose grant expires between the due time and the commit receives the entry; one expired before the due time does not', () => {
  const rows = [
    ['notice.info_requested', () => S.received(), 'm-2', '2026-11-20T23:59:00-05:00'],
    ['notice.eob_available', () => S.edit(S.received(), s => { Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' }); }), 'm-2', '2026-11-20T23:59:00-05:00'],
    ['notice.decision_overdue', () => S.paPending(), 'm-3', '2026-12-01T23:59:00-05:00'],
    ['notice.decision_overdue', () => S.openAppeal({ type: 'pa', id: 'pa-3' }), 'm-2', '2026-12-17T23:59:00-05:00'],
    ['notice.appeal_window_closing', () => S.deniedPa(), 'm-2', '2027-04-25T23:59:00-04:00'],
    ['notice.info_requested', () => S.edit(S.received([S.line('ln-1', 1, 'svc-office-visit', '2026-11-16', 21000, { possible_accident: true })]), s => { Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' }); }), 'm-2', '2026-11-20T23:59:00-05:00'],
  ];
  for (const [kind, seed, member, due] of rows) for (const [expires, gets] of [[new Date(Date.parse(due) + 3600000).toISOString(), true], [new Date(Date.parse(due) - 1).toISOString(), false]]) {
    const f = fixture({ seed: S.granted(seed(), member, 'view', expires, 'p-7'), binding: helpers });
    f.setNow(new Date(Date.parse(due) + 7200000).toISOString());
    tick(f);
    const mine = f.data().notices.filter(x => x.kind === kind && x.at === due && x.recipient_id === 'p-7');
    assert.equal(mine.length > 0, gets, kind + ' ' + due + ' ' + expires);
    assert.equal(f.data().notices.filter(x => x.recipient_id === 'p-7').every(x => Date.parse(x.at) < Date.parse(expires)), true);
    reopen(f);
  }
});

test('T18 notice matrix, action rows: each transition writes its notices once, to the member, guardians and viewers in force, in the plan\'s order; other transitions write none', () => {
  const s = S.granted(S.granted(S.base(), 'm-2', 'act'), 'm-2', 'view', '2026-11-18T12:05:00-05:00', 'p-7');
  const f = fixture({ seed: s, binding: helpers });
  const step = (label, fn, want) => { const before = f.data().notices.length; fn(); const got = f.data().notices.slice(before).map(x => [x.kind, x.recipient_id]); assert.deepEqual(got, want, label); };
  const both = kind => [[kind, 'm-1'], [kind, 'm-2']];
  f.setNow('2026-11-18T12:10:00-05:00');
  step('grant change', () => ev(f, 'grant.changed', { grant_id: 'gr-5', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-3', scope: 'view', expires_at: null, status: 'active' }), []);
  step('grant revocation', () => ev(f, 'grant.changed', { grant_id: 'gr-5', status: 'revoked' }), []);
  step('pa submitted', () => ev(f, 'pa.submitted', { pa_id: 'pa-7', member_id: 'm-2', provider_id: 'pv-4', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-11-01', valid_until: '2026-12-31' }), []);
  step('pa info', () => { ev(f, 'pa.info_requested', { pa_id: 'pa-7', request: 'Notes' }); ev(f, 'pa.info_provided', { pa_id: 'pa-7' }); }, []);
  step('expedite request and denial', () => { f.call(P + 'pa.request_expedite', { pa_id: 'pa-7' }); ev(f, 'pa.expedite_decided', { pa_id: 'pa-7', decision: 'denied' }); }, []);
  step('pa approved', () => ev(f, 'pa.decided', { pa_id: 'pa-7', decision: 'approved', units: 2, valid_from: '2026-11-01', valid_until: '2026-12-31' }), both('notice.pa_decision'));
  step('covered submission', () => ev(f, 'pa.submitted', { pa_id: 'pa-8', member_id: 'm-2', provider_id: 'pv-4', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-11-15', valid_until: '2026-12-15' }), []);
  ev(f, 'pa.submitted', { pa_id: 'pa-9', member_id: 'm-2', provider_id: 'pv-4', service_id: 'svc-knee-mri', units: 1, valid_from: '2026-11-01', valid_until: '2026-12-31' });
  f.setNow('2026-11-19T10:00:00-05:00');
  f.call(P + 'pa.request_expedite', { pa_id: 'pa-9' });
  step('pa denied', () => ev(f, 'pa.decided', { pa_id: 'pa-9', decision: 'denied' }), both('notice.pa_decision'));
  ev(f, 'pa.submitted', { pa_id: 'pa-10', member_id: 'm-2', provider_id: 'pv-4', service_id: 'svc-lab-panel', units: 1, valid_from: '2026-11-01', valid_until: '2026-12-31' });
  f.call(P + 'pa.request_expedite', { pa_id: 'pa-10' });
  f.setNow('2026-11-23T10:00:00-05:00');
  step('expedite making the PA overdue', () => ev(f, 'pa.expedite_decided', { pa_id: 'pa-10', decision: 'approved' }), both('notice.decision_overdue'));
  receive(f, 'cl-7', 'm-2', [S.line('ln-1', 1, 'svc-office-visit', '2026-11-20', 21000, { possible_accident: true })], 'pv-5');
  f.setNow('2026-11-27T09:00:00-05:00');
  step('review opening requests', () => tick(f), [...both('notice.info_requested'), ...both('notice.info_requested')]);
  step('attestation completing nothing', () => settle(f, 'coverage.cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' }), []);
  step('accident answer completing the claim', () => settle(f, 'claims.info', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' }), [...both('notice.eob_available'), ...both('notice.claim_denied')]);
  step('claim appeal filed', () => settle(f, 'appeals.file', { target_type: 'claim', target_id: 'cl-7', statement: 'In network.' }), both('notice.appeal_received'));
  step('appeal information requested', () => ev(f, 'appeal.info_requested', { appeal_id: 'ap-1', request: 'A letter' }), both('notice.appeal_info_requested'));
  step('statement', () => f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'Attached.' }), []);
  step('claim overturn', () => ev(f, 'appeal.decided', { appeal_id: 'ap-1', outcome: 'overturned', lines: ['ln-1'] }), [...both('notice.eob_available'), ...both('notice.appeal_decision')]);
  step('pa appeal filed', () => settle(f, 'appeals.file', { target_type: 'pa', target_id: 'pa-9', statement: 'Urgent.' }), both('notice.appeal_received'));
  step('withdrawal', () => settle(f, 'appeals.withdraw', { appeal_id: 'ap-2' }), []);
  step('refiling', () => settle(f, 'appeals.file', { target_type: 'pa', target_id: 'pa-9', statement: 'Again.' }), both('notice.appeal_received'));
  step('pa overturn', () => ev(f, 'appeal.decided', { appeal_id: 'ap-3', outcome: 'overturned', units: 1, valid_until: '2026-12-31' }), both('notice.appeal_decision'));
  f.setNow('2027-01-01T09:00:00-05:00');
  step('validity end', () => tick(f), []);
  assert.deepEqual(f.data().pas.filter(p => ['pa-7', 'pa-9'].includes(p.pa_id)).map(p => p.status), ['expired', 'expired']);
  assert.equal(f.data().notices.some(x => x.recipient_id === 'p-7'), false);
  reopen(f);
});

test('T18 W1 access: the spouse\'s act grant arrives by grant.changed and the subscriber files on the spouse\'s denied claim; without it the spouse is hidden, and a revocation before the confirm stops it', () => {
  const s = S.base();
  Object.assign(s.coverage.find(y => y.member_id === 'm-2' && y.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-01-15T10:00:00-05:00' });
  S.claim(s, { claim_id: 'cl-3', member_id: 'm-2', provider_id: 'pv-5', received_at: '2026-11-12T11:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-11', 21000)] });
  const e = S.process(s, 'cl-3', [S.denied('ln-1', 'out_of_network', 21000)]);
  S.window(s, 'claim', 'cl-3', e.issued_at);
  const seed = S.finalize(s);
  const f = fixture({ seed });
  assert.deepEqual([f.call(P + 'members.list').members.map(m => m.member_id), f.call(P + 'claims.get', { claim_id: 'cl-3' }).status], [['m-1', 'm-3'], 'not_authorized']);
  ev(f, 'grant.changed', { grant_id: 'gr-2', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', expires_at: null, status: 'active' });
  const file = { target_type: 'claim', target_id: 'cl-3', statement: 'The provider was listed as in network.' };
  const a = settle(f, 'appeals.file', file).appeal;
  assert.deepEqual([a.member_id, a.status, f.call(P + 'members.list').members.find(m => m.member_id === 'm-2').powers], ['m-2', 'under_review', ['view', 'act']]);
  const g = fixture({ seed });
  ev(g, 'grant.changed', { grant_id: 'gr-2', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', expires_at: null, status: 'active' });
  const pv = g.call(P + 'appeals.file.preview', file);
  ok(g, pv.preview.token);
  ev(g, 'grant.changed', { grant_id: 'gr-2', status: 'revoked' });
  assert.deepEqual([g.call(P + 'appeals.file.confirm', { ...file, token: pv.preview.token }).status, g.data().appeals], ['not_authorized', []]);
  reopen(f);
});

test('T18 W2 claims: both requests answered process the claim with EOB v1 and accumulators; with only other coverage answered, 45 days deny only the accident line', () => {
  const start = () => {
    const f = fixture({ seed: S.granted(S.base(), 'm-2', 'act') });
    receive(f, 'cl-7', 'm-2', [S.line('ln-1', 1, 'svc-knee-mri', '2026-11-10', 100000, { possible_accident: true }), S.line('ln-2', 2, 'svc-office-visit', '2026-11-11', 21000)], 'pv-2');
    f.setNow('2026-11-22T09:00:00-05:00');
    tick(f);
    settle(f, 'coverage.cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' });
    return f;
  };
  const f = start();
  settle(f, 'claims.info', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'accident' });
  const c = f.call(P + 'claims.get', { claim_id: 'cl-7' }).claim;
  assert.deepEqual([c.status, c.eobs.length, c.lines.map(l => [l.outcome.status, l.outcome.deductible_cents, l.outcome.copay_cents])], ['processed', 1, [['paid', 100000, 0], ['paid', 0, 2500]]]);
  assert.deepEqual(f.data().accumulators.find(a => a.member_id === 'm-2' && a.plan_year === 2026), { member_id: 'm-2', plan_year: 2026, deductible_cents: 100000, oop_cents: 102500 });
  reopen(f);
  const g = start();
  g.setNow('2027-01-06T09:00:00-05:00');
  tick(g);
  assert.deepEqual(g.call(P + 'claims.get', { claim_id: 'cl-7' }).claim.lines.map(l => [l.outcome.status, l.outcome.reason]), [['denied', 'missing_information'], ['paid', null]]);
  reopen(g);
});

test('T18 W3 PAs: submitted, information requested and provided, approved; a later claim in validity is paid and uses units; a decision after withdrawal changes nothing but the event commits with its due timers', () => {
  const f = fixture({ seed: S.edit(S.base(), s => { Object.assign(s.coverage.find(c => c.member_id === 'm-3' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' }); }) });
  ev(f, 'pa.submitted', { pa_id: 'pa-7', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 4, valid_from: '2026-11-18', valid_until: '2027-01-31' });
  ev(f, 'pa.info_requested', { pa_id: 'pa-7', request: 'Visit notes' });
  ev(f, 'pa.info_provided', { pa_id: 'pa-7' });
  ev(f, 'pa.decided', { pa_id: 'pa-7', decision: 'approved', units: 4, valid_from: '2026-11-18', valid_until: '2027-01-31' });
  receive(f, 'cl-7', 'm-3', [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-18', 30000, { units: 2 })], 'pv-3');
  ev(f, 'pa.submitted', { pa_id: 'pa-8', member_id: 'm-3', provider_id: 'pv-4', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31' });
  ev(f, 'pa.withdrawn', { pa_id: 'pa-8' });
  f.setNow('2026-11-22T09:00:00-05:00');
  const before = f.data();
  assert.equal(ev(f, 'pa.decided', { pa_id: 'pa-8', decision: 'approved', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31' }).status, 'committed');
  const p8 = f.data().pas.find(p => p.pa_id === 'pa-8');
  assert.deepEqual([p8, f.data().eobs.length - before.eobs.length, f.data().eobs.at(-1).lines[0].pa_id, f.data().pas.find(p => p.pa_id === 'pa-7').units_used], [before.pas.find(p => p.pa_id === 'pa-8'), 1, 'pa-7', 2]);
  reopen(f);
});

test('T18 W4 appeals: a denied claim appealed on day 30, due 60 days later, overturned with the difference posted; a filing on day 181 is closed and a filing after upheld is not appealable', () => {
  const f = fixture({ seed: S.deniedClaim(), now: '2026-12-15T10:00:00-05:00' });
  const file = { target_type: 'claim', target_id: 'cl-3', statement: 'The provider was listed as in network.' };
  const a = settle(f, 'appeals.file', file).appeal;
  assert.equal(a.due_at, '2027-02-13T23:59:00-05:00');
  f.setNow('2027-01-20T09:00:00-05:00');
  ev(f, 'appeal.decided', { appeal_id: a.appeal_id, outcome: 'overturned', lines: ['ln-2'] });
  const c = f.call(P + 'claims.get', { claim_id: 'cl-3' }).claim;
  assert.deepEqual([c.eobs.map(e => e.version), c.lines.map(l => l.outcome.status), f.data().accumulators.find(x => x.member_id === 'm-1' && x.plan_year === 2026).oop_cents], [[1, 2], ['denied', 'paid'], 7500]);
  reopen(f);
  const late = fixture({ seed: S.deniedClaim(), now: '2027-05-15T09:00:00-04:00' });
  assert.equal(late.call(P + 'appeals.file.preview', file).status, 'appeal_window_closed');
  const upheld = fixture({ seed: S.openAppeal() });
  ev(upheld, 'appeal.decided', { appeal_id: 'ap-1', outcome: 'upheld' });
  assert.equal(upheld.call(P + 'appeals.file.preview', file).status, 'not_appealable');
});

function rng(k) { let x = (k * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const ALLOWED = new Set(['ok', 'committed', 'not_authorized', 'not_found', 'invalid_state', 'info_not_requested', 'not_appealable', 'duplicate_request', 'appeal_window_closed', 'expedite_not_allowed', 'stale_preview', 'confirmation_invalid', 'confirmation_required', 'invalid_event', 'invalid_arguments']);

test('T18 random workflows across every tool and event, with clock jumps to exact due times and calls at one instant, never write a state the seed validator refuses', () => {
  const tally = {};
  for (let k = 1; k <= 40; k++) {
    const r = rng(k), pick = list => list[Math.floor(r() * list.length)];
    const f = fixture({ seed: S.granted(withGrant('act'), 'm-2', 'view', null, 'p-7'), binding: helpers });
    let c = 0, p = 0, g = 0;
    for (let step = 0; step < 45; step++) {
      const d = f.data(), kind = pick(['claim', 'claim', 'time', 'time', 'tick', 'cob', 'info', 'pa', 'pa-event', 'expedite', 'file', 'withdraw', 'decide', 'appeal-event', 'statement', 'grant-event', 'grant-tool', 'read']);
      let out = { status: 'committed' };
      if (kind === 'claim') out = receive(f, 'cl-r' + (++c), pick(['m-1', 'm-2', 'm-3']), [S.line('ln-1', 1, pick(['svc-office-visit', 'svc-knee-mri', 'svc-physical-therapy', 'svc-lab-panel']), '2026-11-17', pick([9000, 21000, 180000]), { possible_accident: r() < 0.4, emergency: r() < 0.1 })], pick(['pv-1', 'pv-3', 'pv-5']));
      if (kind === 'time') {
        const due = require('../src/timers.cjs').pending(d).map(x => x.t).filter(t => t > Date.parse(f.ctx.virtual_now)).sort((a, b) => a - b)[0];
        f.setNow(new Date(due && r() < 0.6 ? due + pick([0, 0, 1, -1]) : Date.parse(f.ctx.virtual_now) + pick([0, 3600000, 86400000 * 4, 86400000 * 20])).toISOString());
        if (Date.parse(f.ctx.virtual_now) < Date.parse(d.claims[0].received_at)) f.setNow(T0);
        continue;
      }
      if (kind === 'tick') out = ok(f, 'tok-7c1e');
      if (kind === 'cob' || kind === 'info') {
        const open = d.info_requests.filter(x => x.status === 'open' && x.type === (kind === 'cob' ? 'other_coverage' : 'accident'));
        if (!open.length) continue;
        const q = pick(open), cl = d.claims.find(x => x.claim_id === q.claim_id);
        const args = kind === 'cob' ? { member_id: cl.member_id, plan_year: q.plan_year, answer: pick(['none', 'other_secondary', 'other_primary']) } : { claim_id: q.claim_id, line_id: q.line_id, answer: pick(['not_accident', 'accident', 'work_related']) };
        const op = kind === 'cob' ? 'coverage.cob' : 'claims.info', pv = f.call(P + op + '.preview', args);
        if (pv.status !== 'ok') { out = pv; } else { ok(f, pv.preview.token); out = f.call(P + op + '.confirm', { ...args, token: pv.preview.token }); }
      }
      if (kind === 'pa') out = ev(f, 'pa.submitted', { pa_id: 'pa-r' + (++p), member_id: pick(['m-1', 'm-2', 'm-3']), provider_id: 'pv-3', service_id: pick(['svc-physical-therapy', 'svc-arthroscopy']), units: 1 + Math.floor(r() * 3), valid_from: '2026-11-01', valid_until: pick(['2026-12-31', '2027-03-31']) });
      if (kind === 'pa-event' && d.pas.length) {
        const x = pick(d.pas), op = pick(['pa.decided', 'pa.decided', 'pa.info_requested', 'pa.info_provided', 'pa.withdrawn', 'pa.expedite_decided']);
        const payload = op === 'pa.decided' ? (r() < 0.6 ? { pa_id: x.pa_id, decision: 'approved', units: x.requested.units, valid_from: x.requested.valid_from, valid_until: x.requested.valid_until } : { pa_id: x.pa_id, decision: 'denied' }) : op === 'pa.info_requested' ? { pa_id: x.pa_id, request: 'Notes' } : op === 'pa.expedite_decided' ? { pa_id: x.pa_id, decision: pick(['approved', 'denied']) } : { pa_id: x.pa_id };
        out = ev(f, op, payload);
      }
      if (kind === 'expedite' && d.pas.length) out = f.call(P + 'pa.request_expedite', { pa_id: pick(d.pas).pa_id });
      if (kind === 'file') {
        const denied = [...d.claims.filter(x => x.status === 'processed').map(x => ['claim', x.claim_id]), ...d.pas.filter(x => x.status === 'denied').map(x => ['pa', x.pa_id])];
        if (!denied.length) continue;
        const [type, id] = pick(denied), args = { target_type: type, target_id: id, statement: 'Please review.', expedited: type === 'pa' && r() < 0.5, urgency_attested: true };
        const pv = f.call(P + 'appeals.file.preview', args);
        if (pv.status !== 'ok') out = pv; else { ok(f, pv.preview.token); out = f.call(P + 'appeals.file.confirm', { ...args, token: pv.preview.token }); }
      }
      const openAppeals = d.appeals.filter(a => a.status === 'under_review' || a.status === 'info_requested');
      if (kind === 'withdraw' && openAppeals.length) { const a = pick(openAppeals), pv = f.call(P + 'appeals.withdraw.preview', { appeal_id: a.appeal_id }); if (pv.status === 'ok') { ok(f, pv.preview.token); out = f.call(P + 'appeals.withdraw.confirm', { appeal_id: a.appeal_id, token: pv.preview.token }); } else out = pv; }
      if (kind === 'decide' && d.appeals.length) {
        const a = pick(d.appeals);
        out = ev(f, 'appeal.decided', r() < 0.3 ? { appeal_id: a.appeal_id, outcome: 'upheld' } : a.target.type === 'claim' ? { appeal_id: a.appeal_id, outcome: 'overturned', lines: [a.lines[0]] } : { appeal_id: a.appeal_id, outcome: 'overturned', units: 2, valid_until: pick(['2026-11-01', '2027-06-30']) });
      }
      if (kind === 'appeal-event' && d.appeals.length) out = ev(f, 'appeal.info_requested', { appeal_id: pick(d.appeals).appeal_id, request: 'More' });
      if (kind === 'statement' && d.appeals.length) out = f.call(P + 'appeals.add_statement', { appeal_id: pick(d.appeals).appeal_id, statement: 'Note.' });
      if (kind === 'grant-event') {
        const [member, grantor] = pick([['m-2', 'm-2'], ['m-1', 'm-1'], ['m-3', 'm-1']]), grantee = pick(['p-7', 'm-1', 'm-2', 'm-3'].filter(x => x !== member));
        const live = d.grants.find(x => x.member_id === member && x.grantee_id === grantee && x.status === 'active');
        out = live && r() < 0.5 ? ev(f, 'grant.changed', r() < 0.5 ? { grant_id: live.grant_id, status: 'revoked' } : { grant_id: live.grant_id, member_id: member, grantor_id: grantor, grantee_id: grantee, scope: pick(['view', 'act']), expires_at: null, status: 'active' })
          : ev(f, 'grant.changed', { grant_id: 'gr-r' + (++g), member_id: member, grantor_id: grantor, grantee_id: grantee, scope: pick(['view', 'act']), expires_at: r() < 0.5 ? null : new Date(Date.parse(f.ctx.virtual_now) + pick([60000, 86400000 * 3])).toISOString(), status: 'active' });
      }
      if (kind === 'grant-tool') {
        const args = r() < 0.7 || !d.grants.length ? { action: 'grant', member_id: pick(['m-1', 'm-3']), grantee_id: pick(['m-2', 'p-7']), scope: pick(['view', 'act']), expires_at: r() < 0.5 ? null : new Date(Date.parse(f.ctx.virtual_now) + 86400000).toISOString() } : { action: 'revoke', grant_id: pick(d.grants).grant_id };
        const pv = f.call(P + 'grants.change.preview', args);
        if (pv.status !== 'ok') out = pv; else { ok(f, pv.preview.token); out = f.call(P + 'grants.change.confirm', { ...args, token: pv.preview.token }); }
      }
      if (kind === 'read') { for (const op of ['members.list', 'grants.list', 'plan.get', 'claims.list', 'pa.list', 'appeals.list']) { const x = f.call(P + op); assert.ok(x.status === 'ok' || x.status === 'not_found', op + ' ' + x.status + ' ' + x.message); } continue; }
      assert.ok(ALLOWED.has(out.status), k + ' ' + step + ' ' + kind + ' ' + out.status + ' ' + out.message);
      tally[kind + ':' + out.status] = (tally[kind + ':' + out.status] || 0) + 1;
    }
    reopen(f);
  }
  for (const key of ['claim:committed', 'cob:committed', 'info:committed', 'file:committed', 'decide:committed', 'grant-event:committed', 'grant-tool:committed', 'withdraw:committed']) assert.ok(tally[key] > 3, key + ' ' + JSON.stringify(tally));
});
