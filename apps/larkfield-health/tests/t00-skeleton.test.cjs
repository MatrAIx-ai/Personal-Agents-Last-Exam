'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const { fixture } = require('./harness.cjs');
const tools = require('../tools.json');

const root = path.resolve(__dirname, '..');
const eventValid = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
const outputOf = name => compile(tools.find(t => t.name === 'larkfield-health.' + name).outputSchema, root);
const env = (operation, payload) => ({ event_id: 'ev-x', at: '2026-12-01T09:00:00-05:00', operation, payload });

test('T00 the package declares 21 tools (9 reads, 5 previews, 7 writes) and 11 events', () => {
  assert.equal(tools.length, 21);
  assert.equal(tools.filter(t => t.read_only).length, 14);
  assert.deepEqual(require('../app.json').event_types.length, 11);
});

test('T00 the spec example envelopes and variant payloads validate verbatim', () => {
  const spec = require('./spec-events.json');
  assert.deepEqual(spec.envelopes.map(e => e.event_id), ['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5', 'ev-6', 'ev-7', 'ev-8', 'ev-9', 'ev-10', 'ev-11']);
  for (const e of spec.envelopes) assert.ok(eventValid(e), e.event_id);
  for (const v of spec.variants) { const base = spec.envelopes.find(e => e.operation === v.operation); assert.ok(eventValid({ ...base, payload: v.payload }), v.operation + ' ' + JSON.stringify(v.payload)); }
  assert.deepEqual(require('../examples/scenario.json'), spec.envelopes[0]);
});

test('T00 every event variant validates', () => {
  const ok = [
    env('claim.received', require('../examples/scenario.json').payload),
    env('pa.submitted', { pa_id: 'pa-4', member_id: 'm-3', provider_id: 'pv-2', service_id: 'svc-physical-therapy', units: 12, valid_from: '2026-12-01', valid_until: '2027-02-28' }),
    env('pa.info_requested', { pa_id: 'pa-4', request: 'Notes from the last two visits' }),
    env('pa.info_provided', { pa_id: 'pa-4' }),
    env('pa.expedite_decided', { pa_id: 'pa-4', decision: 'approved' }),
    env('pa.decided', { pa_id: 'pa-4', decision: 'approved', units: 12, valid_from: '2026-12-01', valid_until: '2027-02-28' }),
    env('pa.decided', { pa_id: 'pa-4', decision: 'denied' }),
    env('pa.withdrawn', { pa_id: 'pa-5' }),
    env('appeal.info_requested', { appeal_id: 'ap-3', request: 'A letter from the treating provider' }),
    env('appeal.decided', { appeal_id: 'ap-3', outcome: 'overturned', lines: ['ln-2'] }),
    env('appeal.decided', { appeal_id: 'ap-3', outcome: 'overturned', units: 12, valid_until: '2027-02-28' }),
    env('appeal.decided', { appeal_id: 'ap-3', outcome: 'upheld' }),
    env('grant.changed', { grant_id: 'gr-2', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', expires_at: null, status: 'active' }),
    env('grant.changed', { grant_id: 'gr-2', status: 'revoked' }),
    env('user.confirmed', { token: 'tok-7c1e', confirmed_by: 'm-1' }),
  ];
  for (const e of ok) assert.ok(eventValid(e), e.operation + ' ' + JSON.stringify(e.payload));
  assert.ok(!eventValid(env('claim.received', { claim_id: 'cl-8', member_id: 'm-1', provider_id: 'pv-1', lines: [] })), 'empty lines');
  assert.ok(!eventValid(env('grant.changed', { grant_id: 'gr-2', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', status: 'active' })), 'omitted expires_at');
});

test('T00 a real read and a mutating scenario event', () => {
  const f = fixture();
  const read = f.call('larkfield-health.claims.get', { claim_id: 'cl-1' }).claim;
  assert.deepEqual([read.status, read.eobs.length, read.eobs[0].totals.member_cost_cents, read.lines[0].outcome.copay_cents], ['processed', 1, 2500, 2500]);
  assert.equal(f.event(require('../examples/scenario.json')).status, 'committed');
  const claim = f.call('larkfield-health.claims.get', { claim_id: 'cl-7' }).claim;
  assert.deepEqual([claim.member_id, claim.review_at, claim.lines[0].position], ['m-3', '2026-12-04T23:59:00-05:00', 1]);
  assert.ok(outputOf('claims.get')({ status: 'ok', app_id: 'larkfield-health', version: { epoch: 1, revision: 0 }, claim }));
});

const inputOf = name => compile(tools.find(t => t.name === 'larkfield-health.' + name).inputSchema, root);
const ENVELOPE = { status: 'ok', app_id: 'larkfield-health', version: { epoch: 1, revision: 4 } };
const provider = { provider_id: 'pv-3', name: 'Fernhollow Physical Therapy', kind: 'therapy', in_network: true };
const service = { service_id: 'svc-physical-therapy', description: 'Physical therapy session', category: 'therapy' };
const pa = over => ({ pa_id: 'pa-4', pa_version: 0, member_id: 'm-3', provider, service, status: 'pending', submitted_at: '2026-12-01T09:00:00-05:00',
  requested: { units: 12, valid_from: '2026-12-01', valid_until: '2027-02-28' }, approved: null, units_used: 0, info_requests: [], expedite: null, due_at: '2026-12-15T23:59:00-05:00',
  overdue: false, overdue_at: null, decided_at: null, expired_at: null, denial_notice_at: null, appeal_window: null, covered_submissions: [], appeal_ids: [], approvals: [], ...over });
const appeal = over => ({ appeal_id: 'ap-3', appeal_version: 0, member_id: 'm-2', target: { type: 'claim', id: 'cl-2' }, lines: ['ln-2'], expedited: false, filed_at: '2026-11-20T10:00:00-05:00',
  due_at: '2027-01-19T23:59:00-05:00', overdue: false, overdue_at: null, status: 'under_review', statements: [{ at: '2026-11-20T10:00:00-05:00', by: 'm-1', text: 'The visit was in network.' }],
  info_requests: [], decided_at: null, outcome: null, withdrawn_at: null, approvals: [], ...over });

test('T00 output schemas accept the Contracts examples and reject what they exclude', () => {
  const paGet = outputOf('pa.get'), appealsGet = outputOf('appeals.get'), statement = outputOf('appeals.add_statement'), grants = outputOf('grants.change.confirm');
  assert.ok(paGet({ ...ENVELOPE, pa: pa({}) }), 'a pending PA');
  assert.ok(paGet({ ...ENVELOPE, pa: pa({ status: 'expired', approved: { units: 12, valid_from: '2026-12-01', valid_until: '2026-11-30' }, decided_at: '2026-11-25T10:00:00-05:00', expired_at: '2026-12-01T00:00:00-05:00' }) }), 'an expired PA with an inverted interval');
  assert.ok(appealsGet({ ...ENVELOPE, appeal: appeal({}) }), 'an appeal with no outcome');
  assert.ok(appealsGet({ ...ENVELOPE, appeal: appeal({ target: { type: 'pa', id: 'pa-2' }, lines: null, status: 'overturned', decided_at: '2026-12-02T10:00:00-05:00', outcome: { lines: null, units: 12, valid_until: '2027-02-28' } }) }), 'an overturned PA appeal');
  assert.ok(statement({ ...ENVELOPE, appeal: appeal({}), duplicate: true }), 'a replayed write');
  assert.ok(!statement({ ...ENVELOPE, appeal: appeal({}), duplicate: false }), 'duplicate is only ever true');
  assert.ok(!paGet({ ...ENVELOPE, pa: pa({ approved: undefined }) }), 'approved is required, null when absent');
  const grant = { grant_id: 'gr-2', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', created_at: '2026-11-18T12:00:00-05:00', expires_at: null, revoked_at: null, state: 'active' };
  assert.ok(grants({ ...ENVELOPE, grant }), 'a grant without expiry');
  assert.ok(!grants({ ...ENVELOPE, grant: { ...grant, state: 'pending' } }), 'unknown grant state');
});

test('T00 input schemas: optional flags may be omitted, unknown arguments are refused', () => {
  const file = inputOf('appeals.file.preview'), change = inputOf('grants.change.preview'), cob = inputOf('coverage.cob.confirm');
  assert.ok(file({ target_type: 'claim', target_id: 'cl-2', statement: 'The visit was in network.' }));
  assert.ok(file({ target_type: 'pa', target_id: 'pa-2', statement: 'Pain is worsening.', expedited: true, urgency_attested: true }));
  assert.ok(!file({ target_type: 'claim', target_id: 'cl-2', statement: '' }), 'empty statement');
  assert.ok(change({ action: 'revoke', grant_id: 'gr-2' }));
  assert.ok(change({ action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'view', expires_at: null }));
  assert.ok(!change({ action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'edit' }), 'unknown scope');
  assert.ok(cob({ request_id: 'r-1', expected_version: { epoch: 1, revision: 4 }, member_id: 'm-2', plan_year: 2026, answer: 'none', token: 'tok-7c1e' }));
  assert.ok(!cob({ request_id: 'r-1', expected_version: { epoch: 1, revision: 4 }, member_id: 'm-2', plan_year: 2026, answer: 'unknown', token: 'tok-7c1e' }), 'unknown is not an answer');
});

test('T00 every tool has a valid input and result pair; version needs both parts; appeal outcomes keep their shape', () => {
  const W = { request_id: 'r-9', expected_version: { epoch: 1, revision: 4 } };
  const claim = fixture().call('larkfield-health.claims.get', { claim_id: 'cl-1' }).claim;
  const grant = { grant_id: 'gr-2', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', created_at: '2026-11-18T12:00:00-05:00', expires_at: null, revoked_at: null, state: 'active' };
  const side = { scope: 'act', expires_at: null, state: 'active' };
  const preview = changes => ({ preview: { token: 'tok-file-claim-cl-2-0123456789abcdef0123456789abcdef', required_confirmer: 'm-1', changes } });
  const limits = { individual_cents: 150000, family_cents: 300000 };
  const plan = { plan_id: 'plan-epo', name: 'Larkfield EPO Plan', plan_year: 2026, deductible: limits, oop_max: { individual_cents: 400000, family_cents: 800000 }, coinsurance_pct: 20, copays: [{ category: 'office', copay_cents: 2500 }], pa_services: ['svc-physical-therapy'],
    network: { in_network_only: true, emergency_out_of_network: 'in_network_cost_sharing' }, emergency: { pa_required: false, cost_sharing: 'service_category_in_network' } };
  const cases = {
    'members.list': [{}, { members: [{ member_id: 'm-1', name: 'Jordan Hale', relation: 'self', is_minor: false, enrolled_years: [2026], powers: ['self'] }] }],
    'grants.list': [{ member_id: 'm-2' }, { grants: [grant], approvals: [] }],
    'plan.get': [{ plan_year: 2026 }, { plan, members: [{ member_id: 'm-1', deductible_cents: 0, oop_cents: 2500, other_coverage: { status: 'none', version: 1, attested_at: '2026-01-15T10:00:00-05:00' }, approvals: [] }], family: null }],
    'claims.list': [{ status: 'processed' }, { claims: [claim] }],
    'claims.get': [{ claim_id: 'cl-1' }, { claim }],
    'pa.list': [{ member_id: 'm-3' }, { pas: [pa({})] }],
    'pa.get': [{ pa_id: 'pa-4' }, { pa: pa({}) }],
    'appeals.list': [{ status: 'under_review' }, { appeals: [appeal({})] }],
    'appeals.get': [{ appeal_id: 'ap-3' }, { appeal: appeal({}) }],
    'grants.change.preview': [{ action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'act' }, preview({ grant_id: null, before: null, after: side })],
    'coverage.cob.preview': [{ member_id: 'm-2', plan_year: 2026, answer: 'none' }, preview({ resolves: ['ir-1'], completes: ['cl-4'] })],
    'claims.info.preview': [{ claim_id: 'cl-4', line_id: 'ln-1', answer: 'not_accident' }, preview({ info_request_id: 'ir-2', claim_id: 'cl-4', line_id: 'ln-1', completes: null })],
    'appeals.file.preview': [{ target_type: 'claim', target_id: 'cl-2', statement: 'In network.' }, preview({ target_type: 'claim', target_id: 'cl-2', lines: ['ln-2'], expedited: false, due_rule: 'claim_60_days', due_at_if_filed_now: '2027-01-17T23:59:00-05:00', window_ends_at: '2027-05-14T23:59:00-04:00' })],
    'appeals.withdraw.preview': [{ appeal_id: 'ap-3' }, preview({ appeal_id: 'ap-3', window_ends_at: '2027-05-14T23:59:00-04:00' })],
    'grants.change.confirm': [{ ...W, action: 'revoke', grant_id: 'gr-2', token: 'tok-revoke-grant-gr-2-0123456789abcdef0123456789abcdef' }, { grant: { ...grant, state: 'revoked', revoked_at: '2026-11-18T12:30:00-05:00' } }],
    'coverage.cob.confirm': [{ ...W, member_id: 'm-2', plan_year: 2026, answer: 'none', token: 'tok-cob-coverage-m-2:2026-0123456789abcdef0123456789abcdef' }, { coverage: { member_id: 'm-2', plan_year: 2026, status: 'none', version: 1, attested_at: '2026-11-18T12:30:00-05:00' }, claims: [claim] }],
    'claims.info.confirm': [{ ...W, claim_id: 'cl-4', line_id: 'ln-1', answer: 'accident', token: 'tok-info-request-ir-2-0123456789abcdef0123456789abcdef' }, { claim }],
    'pa.request_expedite': [{ ...W, pa_id: 'pa-4', reason: 'Pain is worsening.' }, { pa: pa({ expedite: { requested_at: '2026-12-02T09:00:00-05:00', reason: 'Pain is worsening.', status: 'open', decided_at: null } }) }],
    'appeals.file.confirm': [{ ...W, target_type: 'claim', target_id: 'cl-2', statement: 'In network.', token: 'tok-file-claim-cl-2-0123456789abcdef0123456789abcdef' }, { appeal: appeal({}) }],
    'appeals.add_statement': [{ ...W, appeal_id: 'ap-3', statement: 'The referral is attached.' }, { appeal: appeal({}) }],
    'appeals.withdraw.confirm': [{ ...W, appeal_id: 'ap-3', token: 'tok-withdraw-appeal-ap-3-0123456789abcdef0123456789abcdef' }, { appeal: appeal({ status: 'withdrawn', withdrawn_at: '2026-11-21T10:00:00-05:00' }) }],
  };
  assert.deepEqual(Object.keys(cases).sort(), tools.map(t => t.name.slice('larkfield-health.'.length)).sort());
  for (const [name, [args, result]] of Object.entries(cases)) {
    assert.ok(inputOf(name)(args), 'input ' + name);
    assert.ok(outputOf(name)({ ...ENVELOPE, ...result }), 'output ' + name);
  }
  for (const t of tools.filter(x => !x.read_only)) {
    const name = t.name.slice('larkfield-health.'.length), result = { ...ENVELOPE, ...cases[name][1] };
    assert.ok(outputOf(name)({ ...result, duplicate: true }), 'duplicate true on ' + name);
    assert.ok(!outputOf(name)({ ...result, duplicate: false }), 'duplicate false on ' + name);
  }
  assert.ok(!outputOf('claims.get')({ ...ENVELOPE, version: {}, claim }), 'version {}');
  assert.ok(!outputOf('claims.get')({ ...ENVELOPE, version: { epoch: 1 }, claim }), 'version without revision');
  assert.ok(!outputOf('appeals.get')({ ...ENVELOPE, appeal: appeal({ status: 'overturned', decided_at: '2026-12-02T10:00:00-05:00', outcome: { lines: null, units: 12, valid_until: '2027-02-28' } }) }), 'a claim appeal with a PA outcome');
  assert.ok(!outputOf('appeals.get')({ ...ENVELOPE, appeal: appeal({ target: { type: 'pa', id: 'pa-2' }, lines: null, status: 'overturned', decided_at: '2026-12-02T10:00:00-05:00', outcome: { lines: ['ln-2'], units: null, valid_until: null } }) }), 'a PA appeal with a claim outcome');
  assert.ok(!outputOf('appeals.get')({ ...ENVELOPE, appeal: appeal({ target: { type: 'pa', id: 'pa-2' } }) }), 'a PA appeal naming lines');
  assert.ok(!outputOf('appeals.get')({ ...ENVELOPE, appeal: appeal({ status: 'overturned', decided_at: '2026-12-02T10:00:00-05:00', outcome: { lines: ['ln-2'], units: 12, valid_until: '2027-02-28' } }) }), 'mixed outcome');
  assert.ok(!outputOf('appeals.get')({ ...ENVELOPE, appeal: appeal({ status: 'overturned', decided_at: '2026-12-02T10:00:00-05:00', outcome: { lines: [], units: null, valid_until: null } }) }), 'empty overturned lines');
});

test('T00 claims.get and claims.list are filtered by member authority', () => {
  const S = require('./seeds.cjs');
  const f = fixture({ seed: S.received() });
  assert.equal(f.call('larkfield-health.claims.get', { claim_id: 'cl-2' }).status, 'not_authorized');
  assert.equal(f.call('larkfield-health.claims.get', { claim_id: 'cl-9' }).status, 'not_found');
  assert.deepEqual(f.call('larkfield-health.claims.list', {}).claims.map(c => c.claim_id), ['cl-1']);
  assert.equal(f.call('larkfield-health.claims.list', { member_id: 'm-2' }).status, 'not_authorized');
  const g = fixture({ seed: S.granted(S.received()) });
  assert.equal(g.call('larkfield-health.claims.get', { claim_id: 'cl-2' }).claim.member_id, 'm-2');
  assert.deepEqual(g.call('larkfield-health.claims.list', {}).claims.map(c => c.claim_id), ['cl-1', 'cl-2']);
  assert.deepEqual(g.call('larkfield-health.claims.list', { member_id: 'm-2', status: 'received' }).claims.map(c => c.claim_id), ['cl-2']);
  assert.deepEqual(g.call('larkfield-health.claims.list', { status: 'processed' }).claims.map(c => c.claim_id), ['cl-1']);
});

test('T00 year-end intake: new claims and PAs are accepted until 2199-12-31; later events still pass the clock guard', () => {
  const S = require('./seeds.cjs');
  const seed = S.edit(S.base(), s => {
    s.plan.years['2199'] = structuredClone(s.plan.years['2026']);
    for (const m of s.members) { m.enrolled_years.push(2199); s.coverage.push({ member_id: m.member_id, plan_year: 2199, status: 'unknown', version: 0, attested_at: null }); s.accumulators.push({ member_id: m.member_id, plan_year: 2199, deductible_cents: 0, oop_cents: 0 }); }
  });
  const intake = (id, at) => ({ event_id: id, at, operation: 'claim.received', payload: { claim_id: 'cl-' + id, member_id: 'm-1', provider_id: 'pv-1', lines: [{ line_id: 'ln-1', service_id: 'svc-office-visit', service_date: '2199-12-30', units: 1, billed_cents: 21000, emergency: false, possible_accident: false }] } });
  const f = fixture({ seed, now: '2199-12-31T09:00:00-05:00' });
  assert.equal(f.event(intake('y1', '2199-12-31T09:00:00-05:00')).status, 'committed');
  assert.equal(f.call('larkfield-health.claims.get', { claim_id: 'cl-y1' }).claim.review_at, '2200-01-03T23:59:00-05:00');
  const late = f.event(intake('y2', '2200-01-01T09:00:00-05:00'));
  assert.deepEqual([late.status, /accepted only until 2199-12-31/.test(late.message)], ['invalid_event', true]);
  const other = f.event({ event_id: 'y3', at: '2200-01-02T09:00:00-05:00', operation: 'pa.withdrawn', payload: { pa_id: 'pa-9' } });
  assert.equal(other.status, 'invalid_event');
  assert.doesNotMatch(other.message, /outside the supported range|accepted only until/);
});
