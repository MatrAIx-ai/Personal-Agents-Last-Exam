'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const { BRANDS, coded, expectedPricing } = require('../dev/check-fixture.cjs');
const { play } = require('./walkthrough.cjs');
const { authored, HISTORY } = require('../dev/generate-history.cjs');

const SEED = require('../fixtures/minimal.json');
const CLOCK = require('../fixtures/clock.json').initial_time;
const BINDING = require('../fixtures/binding.json');
const STEPS = require('../examples/walkthrough.json');
const SPEC = require('./spec-events.json').envelopes;
const P = 'larkfield-health.';
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(__dirname, '..', 'schemas'));
const open = () => fixture({ seed: structuredClone(SEED), now: CLOCK });
const find = (list, key, id) => list.find(r => r[key] === id);
const paid = (line_id, allowed, copay, ded, coins, billed, pa = null) => ({ line_id, status: 'paid', reason: null, allowed_cents: allowed, copay_cents: copay, deductible_cents: ded, coinsurance_cents: coins, member_cost_cents: copay + ded + coins, plan_paid_cents: allowed - copay - ded - coins, not_allowed_cents: billed - allowed, pa_id: pa, pa_units: pa ? 1 : 0 });

test('Fixture the unit seed of the business tests still passes the seed schema and validateSeed at the unit clock', () => {
  const unit = require('./unit-seed.json');
  assert.ok(seedValid(unit));
  plugin.validateSeed({ app_id: 'larkfield-health', virtual_now: CLOCK, binding: BINDING }, unit);
  assert.equal(CLOCK, '2026-11-18T12:00:00-05:00');
  assert.deepEqual(fixture().data(), unit);
  assert.notEqual(unit.seed_id, SEED.seed_id);
});

test('Fixture the household, plan and providers are the ones the README describes', () => {
  assert.deepEqual(SEED.members.map(m => [m.member_id, m.name, m.relation, m.birth_date, m.is_minor, m.guardian_ids, m.enrolled_years]), [
    ['m-1', 'Jordan Hale', 'self', '1984-03-12', false, [], [2025, 2026, 2027]],
    ['m-2', 'Casey Hale', 'spouse', '1986-09-02', false, [], [2025, 2026, 2027]],
    ['m-3', 'Riley Hale', 'child', '2015-05-20', true, ['m-1', 'm-2'], [2025, 2026, 2027]],
  ]);
  assert.deepEqual(SEED.providers.map(p => [p.provider_id, p.name, p.kind, p.in_network]), [
    ['pv-1', 'Quarrowby Family Medicine', 'prescriber', true], ['pv-2', 'Kestrel Valley Orthopedics', 'clinic', true], ['pv-3', 'Fernhollow Physical Therapy', 'therapy', true],
    ['pv-4', 'Wrenmoor Community Hospital', 'hospital', true], ['pv-5', 'Quillmont Imaging Center', 'imaging', false], ['pv-6', 'Cindervale Medical Center', 'hospital', false],
  ]);
  assert.deepEqual([SEED.seed_id, SEED.plan.plan_id, SEED.plan.name], ['larkfield-household-1', 'plan-epo', 'Larkfield EPO Plan']);
  assert.deepEqual(SEED.services.map(x => [x.service_id, x.description, x.category, x.fee_cents]), [
    ['svc-office-visit', 'Primary care office visit', 'office', 18000], ['svc-phone-consult', 'Nurse phone consultation', 'office', 2200], ['svc-specialist-visit', 'Specialist office visit', 'specialist', 30000],
    ['svc-knee-mri', 'MRI of the knee', 'imaging', 150000], ['svc-xray', 'X-ray, two views', 'imaging', 11963], ['svc-ultrasound', 'Abdominal ultrasound', 'imaging', 42000],
    ['svc-physical-therapy', 'Physical therapy session', 'therapy', 15000], ['svc-lab-panel', 'Basic metabolic lab panel', 'lab', 9138], ['svc-lipid-panel', 'Cholesterol lab panel', 'lab', 6488],
    ['svc-strep-test', 'Rapid strep test', 'lab', 3412], ['svc-er-visit', 'Emergency department visit', 'emergency', 220000], ['svc-wound-repair', 'Simple wound repair', 'surgery', 38000],
    ['svc-arthroscopy', 'Knee arthroscopy', 'surgery', 800000], ['svc-semaglutide-1', 'Semaglutide 1 mg weekly pen, four-week supply', 'pharmacy', 99800],
  ]);
  assert.deepEqual(Object.entries(SEED.plan.years).map(([y, p]) => [y, p.deductible.individual_cents, p.deductible.family_cents, p.oop_max.individual_cents, p.oop_max.family_cents, p.coinsurance_pct, p.copays]), [
    ['2025', 125000, 250000, 350000, 700000, 20, { office: 2500, specialist: 4500, therapy: 3000, emergency: 20000 }],
    ['2026', 150000, 300000, 400000, 800000, 20, { office: 2500, specialist: 5000, therapy: 3500, emergency: 25000 }],
    ['2027', 160000, 320000, 420000, 840000, 20, { office: 3000, specialist: 5000, therapy: 3500, emergency: 27500 }],
  ]);
  assert.deepEqual(SEED.plan.pa_services, ['svc-physical-therapy', 'svc-arthroscopy', 'svc-semaglutide-1']);
  assert.deepEqual(SEED.claims.filter(c => !HISTORY.test(c.claim_id)).map(c => [c.claim_id, c.member_id, c.status]), [
    ['cl-1', 'm-1', 'processed'], ['cl-2', 'm-3', 'processed'], ['cl-3', 'm-1', 'processed'], ['cl-4', 'm-2', 'processed'], ['cl-5', 'm-1', 'processed'], ['cl-6', 'm-2', 'processed'], ['cl-8', 'm-1', 'processed'], ['cl-9', 'm-2', 'processed'],
    ['cl-10', 'm-3', 'processed'], ['cl-11', 'm-3', 'processed'], ['cl-12', 'm-2', 'processed'], ['cl-13', 'm-1', 'pending_info'], ['cl-14', 'm-3', 'processed'], ['cl-15', 'm-3', 'received'], ['cl-16', 'm-3', 'received'], ['cl-17', 'm-1', 'received'],
  ]);
  assert.deepEqual(SEED.pas.map(p => [p.pa_id, p.member_id, p.service_id, p.status, p.units_used]), [['pa-1', 'm-2', 'svc-semaglutide-1', 'denied', 0], ['pa-2', 'm-2', 'svc-physical-therapy', 'expired', 8], ['pa-3', 'm-3', 'svc-physical-therapy', 'expired', 5], ['pa-5', 'm-2', 'svc-arthroscopy', 'pending', 0]]);
  assert.deepEqual(SEED.appeals.map(a => [a.appeal_id, a.target.id, a.status, a.lines, a.statements[0].by]), [['ap-1', 'cl-3', 'upheld', ['ln-1'], 'm-1'], ['ap-2', 'cl-8', 'overturned', ['ln-1', 'ln-2'], 'm-2'], ['ap-3', 'cl-14', 'under_review', ['ln-2'], 'm-1']]);
  assert.deepEqual(SEED.grants.map(g => [g.grant_id, g.member_id, g.grantee_id, g.scope, g.expires_at, g.status]), [['gr-h1', 'm-1', 'm-2', 'act', '2027-01-01T00:00:00-05:00', 'active'], ['gr-h2', 'm-2', 'm-1', 'view', null, 'revoked'], ['gr-1', 'm-2', 'm-1', 'view', '2026-04-01T00:00:00-04:00', 'active']]);
  const cl1 = find(SEED.eobs, 'claim_id', 'cl-1');
  assert.deepEqual([cl1.lines, cl1.postings], [[paid('ln-1', 220000, 20000, 0, 0, 268500), paid('ln-2', 9138, 0, 9138, 0, 11800)], [{ member_id: 'm-1', plan_year: 2025, deductible_cents: 0, oop_cents: 20000 }, { member_id: 'm-1', plan_year: 2026, deductible_cents: 9138, oop_cents: 9138 }]]);
});

test('Fixture the independent repricing accepts a PA approved at the same instant as the last answer, in either order, by the approval mark', () => {
  const S = require('./seeds.cjs');
  const run = paFirst => {
    const s = S.base();
    S.claim(s, { claim_id: 'cl-pt', member_id: 'm-1', provider_id: 'pv-3', received_at: '2026-11-17T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-16', 16500, { possible_accident: true })] });
    s.pas.push({ pa_id: 'pa-9', pa_version: 0, member_id: 'm-1', provider_id: 'pv-3', service_id: 'svc-physical-therapy', status: 'pending', submitted_at: '2026-11-16T09:00:00-05:00', requested: { units: 4, valid_from: '2026-11-01', valid_until: '2026-12-31' },
      approved: null, approved_after_post: null, units_used: 0, info_requests: [], expedite: null, due_at: S.due('2026-11-16T09:00:00-05:00', 15), overdue: false, overdue_at: null, decided_at: null, expired_at: null, denial_notice_at: null, covered_submissions: [] });
    const f = fixture({ seed: S.finalize(s), now: '2026-11-21T09:00:00-05:00' });
    const args = { claim_id: 'cl-pt', line_id: 'ln-1', answer: 'not_accident' }, at = '2026-11-21T10:00:00-05:00';
    const token = f.call(P + 'claims.info.preview', args).preview.token;
    assert.equal(f.event({ event_id: 'ok', at: '2026-11-21T09:45:00-05:00', operation: 'user.confirmed', payload: { token, confirmed_by: 'm-1' } }).status, 'committed');
    const decide = () => assert.equal(f.event({ event_id: 'decide', at, operation: 'pa.decided', payload: { pa_id: 'pa-9', decision: 'approved', units: 4, valid_from: '2026-11-01', valid_until: '2026-12-31' } }).status, 'committed');
    const answer = () => { f.setNow(at); assert.equal(f.call(P + 'claims.info.confirm', { ...args, token }).status, 'committed'); };
    if (paFirst) { decide(); answer(); } else { answer(); decide(); }
    const d = f.data(), e = d.eobs.find(x => x.claim_id === 'cl-pt'), pa = d.pas.find(p => p.pa_id === 'pa-9');
    assert.deepEqual([e.issued_at, pa.decided_at], [at, at]);
    assert.deepEqual(expectedPricing(d), []);
    return [e.lines[0].status, e.lines[0].pa_id, e.lines[0].reason, pa.units_used, BigInt(pa.approved_after_post) < BigInt(e.posting_seq)];
  };
  assert.deepEqual(run(true), ['paid', 'pa-9', null, 1, true]);
  assert.deepEqual(run(false), ['denied', null, 'prior_auth_missing', 0, false]);
  const d = structuredClone(SEED), pa = d.pas.find(p => p.pa_id === 'pa-2');
  pa.approved_after_post = '0';
  assert.ok(expectedPricing(d).some(p => p.startsWith('PA pa-2 approval mark disagrees with its decision time')));
});

test('Fixture the eleven example events and the Agent expedite request apply in order, each with its complete effect and notices, and ev-6 yields the wire example', () => {
  assert.deepEqual(require('../examples/scenario.json'), SPEC[0]);
  assert.deepEqual(STEPS.filter(s => s.tool), [{ tool: { at: '2026-12-03T11:30:00-05:00', name: 'larkfield-health.pa.request_expedite', arguments: { pa_id: 'pa-4', reason: 'Riley\'s orthopedist wants therapy for the injured knee to start this week.' } } }]);
  assert.deepEqual(STEPS.map(s => (s.event ? s.event.event_id : 'expedite')), ['ev-1', 'ev-2', 'ev-3', 'ev-4', 'expedite', 'ev-5', 'ev-6', 'ev-7', 'ev-8', 'ev-9', 'ev-10', 'ev-11']);
  assert.equal(play(open(), SEED).wire, 'e2-n-17');
});

test('Fixture the walkthrough runner refuses a missing step, steps out of order and a step back in time', () => {
  assert.throws(() => play(open(), SEED, STEPS.filter(s => !(s.event && s.event.event_id === 'ev-7'))), /the walkthrough steps, in order/);
  const swapped = [...STEPS];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  assert.throws(() => play(open(), SEED, swapped), /the walkthrough steps, in order/);
  assert.throws(() => play(open(), SEED, STEPS.map(s => (s.tool ? { tool: { ...s.tool, at: '2026-12-03T09:30:00-05:00' } } : s))), /the walkthrough's Agent step is the authored expedite request/);
  const late = open();
  late.setNow('2026-12-02T00:00:00-05:00');
  assert.throws(() => play(late, SEED), /ev-1 does not move the clock backward/);
  assert.throws(() => play(open(), SEED, STEPS.map(s => (s.tool ? { tool: { ...s.tool, arguments: { ...s.tool.arguments, reason: s.tool.arguments.reason + ' Crestor, S93.401A.' } } } : s))), /the walkthrough's Agent step is the authored expedite request/);
});

test('Fixture at the clock the account holder sees only what the grants allow, can still answer the open accident questions, and new records continue the task-timeline counters', () => {
  const f = open();
  assert.deepEqual(f.call(P + 'members.list', {}).members.map(m => [m.member_id, m.powers]), [['m-1', ['self']], ['m-3', ['guardian']]]);
  assert.equal(f.call(P + 'claims.list', { member_id: 'm-2' }).status, 'not_authorized');
  assert.equal(f.call(P + 'pa.get', { pa_id: 'pa-5' }).status, 'not_authorized');
  assert.equal(f.call(P + 'plan.get', { plan_year: 2026 }).family, null);
  assert.deepEqual(f.call(P + 'claims.list', { status: 'pending_info' }).claims.map(c => [c.claim_id, c.info_requests.map(r => [r.info_request_id, r.status, r.expires_at])]), [['cl-13', [['ir-11', 'open', '2026-11-29T23:59:00-05:00'], ['ir-12', 'open', '2026-11-29T23:59:00-05:00']]]]);
  const answer = (line, at) => {
    f.setNow(at);
    const args = { claim_id: 'cl-13', line_id: line, answer: 'not_accident' };
    const token = f.call(P + 'claims.info.preview', args).preview.token;
    assert.equal(f.event({ event_id: 'confirm-' + line, at, operation: 'user.confirmed', payload: { token, confirmed_by: 'm-1' } }).status, 'committed');
    return f.call(P + 'claims.info.confirm', { ...args, token });
  };
  assert.equal(answer('ln-1', '2026-11-18T19:00:00-05:00').claim.status, 'pending_info');
  const done = answer('ln-2', '2026-11-18T19:05:00-05:00').claim;
  assert.deepEqual([done.status, done.eobs.map(e => [e.eob_id, e.lines.map(l => [l.line_id, l.status, l.copay_cents, l.coinsurance_cents])])], ['processed', [['eob-14', [['ln-1', 'paid', 5000, 0], ['ln-2', 'paid', 0, 2393]]]]]);
  assert.deepEqual(f.data().notices.slice(SEED.notices.length).map(n => [n.notice_id, n.kind, n.subject.id, n.recipient_id]), [['n-1', 'notice.eob_available', 'cl-13', 'm-1'], ['n-2', 'notice.eob_available', 'cl-13', 'm-2']]);
  assert.deepEqual(f.data().approvals.map(a => a.approval_id), ['cf-1', 'cf-2']);
  f.setNow('2026-11-18T19:10:00-05:00');
  const args = { action: 'grant', member_id: 'm-1', grantee_id: 'm-3', scope: 'view', expires_at: '2026-12-01T00:00:00-05:00' };
  const token = f.call(P + 'grants.change.preview', args).preview.token;
  f.event({ event_id: 'confirm-grant', at: '2026-11-18T19:10:00-05:00', operation: 'user.confirmed', payload: { token, confirmed_by: 'm-1' } });
  assert.equal(f.call(P + 'grants.change.confirm', { ...args, token }).grant.grant_id, 'gr-3');
  for (const s of STEPS) {
    const out = s.event ? f.event(s.event) : (f.setNow(s.tool.at), f.call(s.tool.name, s.tool.arguments));
    assert.equal(out.status, 'committed', (s.event ? s.event.event_id : 'expedite') + ' after an Agent grant: ' + JSON.stringify(out));
  }
  assert.deepEqual(f.data().grants.filter(g => !HISTORY.test(g.grant_id)).map(g => [g.grant_id, g.member_id, g.grantee_id, g.scope]), [['gr-1', 'm-2', 'm-1', 'view'], ['gr-3', 'm-1', 'm-3', 'view'], ['gr-2', 'm-2', 'm-1', 'act']]);
});

test('Fixture the business tests\' own seed and builders carry no deny-listed names and no billing or diagnosis codes', () => {
  const S = require('./seeds.cjs');
  const texts = value => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(texts) : value && typeof value === 'object' ? Object.values(value).flatMap(texts) : []);
  const all = [require('./unit-seed.json'), S.household(), S.full()].flatMap(texts);
  assert.ok(all.length > 200);
  assert.deepEqual(all.filter(t => BRANDS.test(t)), []);
  assert.deepEqual(all.filter(t => !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(t) && coded(t)), []);
  for (const seed of [require('./unit-seed.json'), S.household(), S.full()]) assert.deepEqual(seed.providers.map(p => [p.provider_id, p.name]), SEED.providers.map(p => [p.provider_id, p.name]));
});
