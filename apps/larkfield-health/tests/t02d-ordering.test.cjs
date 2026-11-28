'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const S = require('./seeds.cjs');
const { toIso, endOfDay } = require('../src/time.cjs');
const { compile } = require('./schema-validator.cjs');

const ctx = now => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now ?? '2026-11-18T12:00:00-05:00', binding: structuredClone(require('../fixtures/binding.json')) });
const R = (s, pattern, now) => assert.throws(() => plugin.validateSeed(ctx(now), s), e => e.code === 'invalid_seed' && pattern.test(e.message), String(pattern));
const L = (s, now) => assert.doesNotThrow(() => plugin.validateSeed(ctx(now), s));
const E = S.edit;
const C = (s, id) => s.claims.find(c => c.claim_id === id), V = (s, claim, v = 1) => s.eobs.find(e => e.claim_id === claim && e.version === v);
const P = (s, id) => s.pas.find(p => p.pa_id === id), A = (s, id) => s.appeals.find(a => a.appeal_id === id);
const next = s => 'eob-' + (Number(s.issued.eob) + 1);
const v1 = (s, id, at, lines) => { Object.assign(C(s, id), { status: 'processed', processed_at: at }); return S.post(s, { eob_id: next(s), claim_id: id, version: 1, issued_at: at, reason: 'initial', appeal_id: null, lines }); };

test('T02d plan.get accepts any integer year; the handler decides not_found', () => {
  const tool = require('../tools.json').find(t => t.name === 'larkfield-health.plan.get');
  const valid = compile(tool.inputSchema, path.resolve(__dirname, '..'));
  assert.ok(valid({ plan_year: 2200 }));
  assert.ok(valid({ plan_year: 1999 }));
  assert.ok(!valid({ plan_year: '2026' }));
});

test('T02d one instant: an attestation completes one claim and an accident answer the other, in either claim order', () => {
  const build = () => {
    const s = S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), true, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b', received_at: '2026-11-13T10:00:00-05:00' });
    const t = '2026-11-18T10:00:00-05:00';
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: r.type === 'accident' ? 'not_accident' : 'none', answered_at: t, request_version: 1 });
    v1(s, 'cl-b', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    v1(s, 'cl-a', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    return S.finalize(s);
  };
  L(build());
});

test('T02d a PA denied at the end of 2199 can be overturned into an immediate expiry in 2200', () => {
  const s = S.deniedPa();
  const p = P(s, 'pa-3');
  Object.assign(p, { submitted_at: '2199-12-20T09:00:00-05:00', requested: { units: 1, valid_from: '2199-12-21', valid_until: '2199-12-31' }, due_at: S.due('2199-12-20T09:00:00-05:00', 15), decided_at: '2199-12-31T10:00:00-05:00', denial_notice_at: '2199-12-31T10:00:00-05:00' });
  Object.assign(s.windows[0], { notice_at: p.denial_notice_at, ends_at: S.due(p.denial_notice_at, 180), closing: { due_at: S.due(p.denial_notice_at, 166), done: false, notice_at: null } });
  const ap = S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', s, { filed_at: '2200-01-02T09:00:00-05:00' });
  const at = '2200-01-03T10:00:00-05:00';
  Object.assign(A(ap, 'ap-1'), { status: 'overturned', decided_at: at, outcome: { lines: null, units: 1, valid_until: '2199-12-31' }, appeal_version: 1 });
  Object.assign(P(ap, 'pa-3'), { status: 'expired', approved: { units: 1, valid_from: '2200-01-03', valid_until: '2199-12-31' }, decided_at: at, expired_at: at, pa_version: 2 });
  L(S.finalize(ap), '2200-01-04T12:00:00-05:00');
});

test('T02d same-instant posting order: a later EOB version is an action, and equal object IDs order by timer kind', () => {
  const at = '2026-11-20T23:59:00-05:00', now = '2026-11-21T12:00:00-05:00';
  const both = reviewFirst => {
    let s = S.openAppeal();
    const add = () => { S.claim(s, { claim_id: 'cl-2', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-17T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-16', 21000)] }); v1(s, 'cl-2', at, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]); };
    if (reviewFirst) add();
    s = S.overturned(undefined, at, s);
    if (!reviewFirst) add();
    return S.finalize(s);
  };
  L(both(true), now);
  R(both(false), /was posted by a timer at .* after an action at that instant; timers run first/, now);
  const tie = reviewFirst => {
    const s = S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-z' });
    s.info_requests[0].info_request_id = 'ir-1';
    const t = s.info_requests[0].expires_at;
    Object.assign(s.info_requests[0], { status: 'expired', request_version: 1 });
    const review = () => { S.claim(s, { claim_id: 'ir-1', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-12-28T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-12-27', 21000)] }); v1(s, 'ir-1', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]); };
    const expiry = () => { const e = v1(s, 'cl-z', t, [S.denied('ln-1', 'missing_information', 21000)]); S.window(s, 'claim', 'cl-z', e.issued_at); };
    if (reviewFirst) { review(); expiry(); } else { expiry(); review(); }
    return S.finalize(s);
  };
  L(tie(true), '2027-01-01T12:00:00-05:00');
  R(tie(false), /same-instant timers run in object ID string order/, '2027-01-01T12:00:00-05:00');
});

test('T02d an overturned PA keeps its original chronology; a covered pharmacy submission needs a pharmacy or prescriber', () => {
  const pao = fn => { const s = S.openAppeal({ type: 'pa', id: 'pa-3' }); const at = '2026-11-17T15:00:00-05:00';
    Object.assign(A(s, 'ap-1'), { status: 'overturned', decided_at: at, outcome: { lines: null, units: 1, valid_until: '2026-12-20' }, appeal_version: 1 });
    Object.assign(P(s, 'pa-3'), { status: 'approved', approved: { units: 1, valid_from: '2026-11-17', valid_until: '2026-12-20' }, decided_at: at, pa_version: 2 });
    S.finalize(s); fn(s); return s; };
  L(pao(() => {}));
  R(pao(s => { Object.assign(P(s, 'pa-3'), { overdue: true, overdue_at: P(s, 'pa-3').due_at }); }), /became overdue after its decision/);
  R(pao(s => { P(s, 'pa-3').submitted_at = '2026-11-11T09:00:00-05:00'; P(s, 'pa-3').due_at = S.due('2026-11-11T09:00:00-05:00', 15); }), /was decided before it was submitted/);
  const pharmacy = provider => E(S.base(), s => {
    s.pas.push({ pa_id: 'pa-8', pa_version: 1, member_id: 'm-1', provider_id: 'pv-1', service_id: 'svc-adalimumab-40', status: 'approved', submitted_at: '2026-11-02T09:00:00-05:00', requested: { units: 4, valid_from: '2026-11-05', valid_until: '2027-02-28' },
      approved: { units: 4, valid_from: '2026-11-05', valid_until: '2027-02-28' }, approved_after_post: '0', units_used: 0, info_requests: [], expedite: null, due_at: S.due('2026-11-02T09:00:00-05:00', 15), overdue: false, overdue_at: null,
      decided_at: '2026-11-05T10:00:00-05:00', expired_at: null, denial_notice_at: null, covered_submissions: [{ pa_id: 'pa-9', provider_id: provider, units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31', at: '2026-11-10T09:00:00-05:00' }] });
  });
  L(pharmacy('pv-1'));
  R(pharmacy('pv-4'), /covered submission pa-9 comes from a provider that is not a pharmacy or prescriber/);
});

test('T02d the ledger after a 100 cent deductible v1 and an overturn adding 20 cents of coinsurance opens at 100 and 120', () => {
  const build = () => {
    const s = S.base();
    Object.assign(s.plan.years['2026'].deductible, { individual_cents: 100, family_cents: 300 });
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-01-15T10:00:00-05:00' });
    S.claim(s, { claim_id: 'cl-d', member_id: 'm-2', provider_id: 'pv-2', received_at: '2026-11-12T12:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-lab-panel', '2026-11-11', 100), S.line('ln-2', 2, 'svc-arthroscopy', '2026-11-11', 100)] });
    const e = v1(s, 'cl-d', C(s, 'cl-d').review_at, [S.paid('ln-1', 100, { ded: 100 }, 100), S.denied('ln-2', 'prior_auth_missing', 100)]);
    S.window(s, 'claim', 'cl-d', e.issued_at);
    const ap = S.openAppeal({ type: 'claim', id: 'cl-d' }, 'under_review', S.finalize(s));
    A(ap, 'ap-1').statements[0].by = 'm-2';
    const at = '2026-11-18T10:00:00-05:00';
    Object.assign(A(ap, 'ap-1'), { status: 'overturned', decided_at: at, outcome: { lines: ['ln-2'], units: null, valid_until: null }, appeal_version: 1 });
    S.post(ap, { eob_id: next(ap), claim_id: 'cl-d', version: 2, issued_at: at, reason: 'appeal', appeal_id: 'ap-1', lines: [structuredClone(V(ap, 'cl-d').lines[0]), S.paid('ln-2', 100, { coins: 20 }, 100)] });
    S.claim(ap, { claim_id: 'cl-n', member_id: 'm-2', provider_id: 'pv-1', received_at: '2026-11-19T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-18', 21000)] });
    v1(ap, 'cl-n', C(ap, 'cl-n').review_at, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    return S.finalize(ap);
  };
  const s = build();
  L(s, '2026-11-25T12:00:00-05:00');
  assert.deepEqual(V(s, 'cl-n').ledger_before['2026'].member, { deductible_cents: 100, oop_cents: 120 });
  R(E(build(), x => { V(x, 'cl-n').ledger_before['2026'].member.deductible_cents = 200; }), /ledger before posting does not equal the running ledger/, '2026-11-25T12:00:00-05:00');
});

test('T02d every pending timer kind bounds the seed: one millisecond before its cutoff loads, at the cutoff does not', () => {
  const grantAt = (seed, t) => E(structuredClone(seed), s => { S.granted(s); s.grants[s.grants.length - 1].created_at = t; });
  const cases = [
    ['validity_end', S.paApproved(undefined, { valid_from: '2026-11-05', valid_until: '2026-11-17' }), toIso(endOfDay('2026-11-17')), '2026-11-18T12:00:00-05:00'],
    ['pa_due', S.paPending(), S.paPending().pas[0].due_at, '2026-12-02T12:00:00-05:00'],
    ['appeal_due', S.openAppeal(), S.openAppeal().appeals[0].due_at, '2027-01-17T12:00:00-05:00'],
  ];
  for (const [kind, seed, cutoff, now] of cases) {
    const before = toIso(Date.parse(cutoff) - 1);
    assert.doesNotThrow(() => plugin.validateSeed(ctx(now), grantAt(seed, before)), kind + ' before');
    assert.throws(() => plugin.validateSeed(ctx(now), grantAt(seed, cutoff)), e => e.code === 'invalid_seed' && /not before its earliest pending timer/.test(e.message), kind + ' at');
  }
});

test('T02d attestations of two plan years at one instant complete a year-boundary claim and a single-year claim', () => {
  const s = S.base();
  const T = '2026-01-20T10:00:00-05:00';
  S.claim(s, { claim_id: 'cl-A', member_id: 'm-2', provider_id: 'pv-1', received_at: '2026-01-05T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2025-12-31', 21000), S.line('ln-2', 2, 'svc-office-visit', '2026-01-02', 21000)] });
  S.claim(s, { claim_id: 'cl-B', member_id: 'm-2', provider_id: 'pv-1', received_at: '2026-01-06T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2025-12-30', 21000)] });
  let n = 0;
  const req = (claim, line, year) => ({ info_request_id: 'ir-' + (++n), request_version: 1, type: 'other_coverage', claim_id: claim, line_id: line, plan_year: year, opened_at: C(s, claim).review_at, expires_at: S.due(C(s, claim).review_at, 45), status: 'answered', answer: 'none', answered_at: T });
  s.info_requests.push(req('cl-A', 'ln-1', 2025), req('cl-A', 'ln-2', 2026), req('cl-B', 'ln-1', 2025));
  s.issued.ir = String(n);
  for (const y of [2025, 2026]) Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === y), { status: 'none', version: 1, attested_at: T });
  v1(s, 'cl-B', T, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
  v1(s, 'cl-A', T, [S.paid('ln-1', 18000, { copay: 2500 }, 21000), S.paid('ln-2', 18000, { copay: 2500 }, 21000)]);
  L(S.finalize(s));
});

test('T02d boundaries: overdue at day 15 when the expedite is approved then, expiry keys, received_seq ties, an expiry-issued v1 beside a PA approval, the 2200 and 2201 clocks', () => {
  const at = (ed, od, now) => E(S.paPending(), s => { const p = P(s, 'pa-2'), due = Math.min(Date.parse(p.due_at), Date.parse('2026-11-17T09:00:00-05:00') + 72 * 3600000);
    Object.assign(p, { expedite: { requested_at: '2026-11-17T09:00:00-05:00', reason: null, status: 'approved', decided_at: ed }, due_at: toIso(due), overdue: true, overdue_at: od }); });
  const d15 = S.paPending().pas[0].due_at, dayAfter = toIso(Date.parse(d15) + 24 * 3600000);
  L(at(d15, d15), '2026-12-03T12:00:00-05:00');
  R(at(dayAfter, dayAfter), /overdue flag and time disagree/, '2026-12-03T12:00:00-05:00');
  R(at('2026-11-18T10:00:00-05:00', '2026-11-18T10:00:00-05:00'), /overdue flag and time disagree/, '2026-11-18T12:00:00-05:00');
  const keys = reviewFirst => {
    const s = S.pendingCob('m-2', 2026, S.base(), true, { claim_id: 'cl-z' });
    const t = s.info_requests[0].expires_at;
    for (const r of s.info_requests) Object.assign(r, { status: 'expired', request_version: 1 });
    const review = () => { S.claim(s, { claim_id: 'ir-15', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-12-28T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-12-27', 21000)] }); v1(s, 'ir-15', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]); };
    const expiry = () => { const e = v1(s, 'cl-z', t, [S.denied('ln-1', 'missing_information', 21000)]); S.window(s, 'claim', 'cl-z', e.issued_at); };
    if (reviewFirst) { review(); expiry(); } else { expiry(); review(); }
    return S.finalize(s);
  };
  L(keys(true), '2027-01-01T12:00:00-05:00');
  R(keys(false), /posted cl-z before ir-15; same-instant timers run in object ID string order/, '2027-01-01T12:00:00-05:00');
  const tie = order => {
    const s = S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b' });
    const t = '2026-11-18T10:00:00-05:00';
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    for (const id of order) v1(s, id, t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    return S.finalize(s);
  };
  L(tie(['cl-a', 'cl-b']));
  R(tie(['cl-b', 'cl-a']), /One attestation completed cl-b before cl-a/);
  const beside = mark => {
    const s = S.paApproved(undefined, undefined, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-z' }));
    const t = s.info_requests[0].expires_at;
    Object.assign(s.info_requests[0], { status: 'expired', request_version: 1 });
    const e = v1(s, 'cl-z', t, [S.denied('ln-1', 'missing_information', 21000)]);
    S.window(s, 'claim', 'cl-z', e.issued_at);
    Object.assign(P(s, 'pa-1'), { decided_at: t, submitted_at: '2026-12-20T09:00:00-05:00', due_at: S.due('2026-12-20T09:00:00-05:00', 15) });
    S.finalize(s);
    P(s, 'pa-1').approved_after_post = mark;
    return s;
  };
  L(beside('2'), '2027-01-01T12:00:00-05:00');
  R(beside('1'), /approval posting mark does not match/, '2027-01-01T12:00:00-05:00');
  const { fixture } = require('./harness.cjs');
  const f = fixture({ seed: S.base(), now: '2200-12-31T23:59:59.999-05:00' });
  assert.equal(f.call('larkfield-health.claims.get', { claim_id: 'cl-1' }).status, 'ok');
  f.setNow('2201-01-01T00:00:00-05:00');
  assert.equal(f.call('larkfield-health.claims.get', { claim_id: 'cl-1' }).status, 'invalid_state');
  const late = f.event({ event_id: 'z-1', at: '2201-01-01T00:00:00-05:00', operation: 'pa.withdrawn', payload: { pa_id: 'pa-9' } });
  assert.deepEqual([late.status, /outside the supported range/.test(late.message)], ['invalid_event', true]);
});

test('T02d coverage inputs take any integer year; PA requested and covered dates may run into 2200', () => {
  const tools = require('../tools.json');
  for (const name of ['coverage.cob.preview', 'coverage.cob.confirm']) {
    const valid = compile(tools.find(t => t.name === 'larkfield-health.' + name).inputSchema, path.resolve(__dirname, '..'));
    const args = { member_id: 'm-1', plan_year: 2200, answer: 'none', ...(name.endsWith('confirm') ? { request_id: 'r-1', expected_version: { epoch: 1, revision: 0 }, token: 'tok-7c1e' } : {}) };
    assert.ok(valid(args), name);
  }
  L(E(S.paPending(), s => { Object.assign(P(s, 'pa-2'), { submitted_at: '2199-12-31T09:00:00-05:00', requested: { units: 1, valid_from: '2199-12-31', valid_until: '2200-01-31' }, due_at: S.due('2199-12-31T09:00:00-05:00', 15) }); }), '2199-12-31T12:00:00-05:00');
  L(E(S.paApproved(undefined, { valid_from: '2026-11-05', valid_until: '2200-02-28' }), s => { P(s, 'pa-1').covered_submissions.push({ pa_id: 'pa-9', provider_id: 'pv-3', units: 1, valid_from: '2199-12-28', valid_until: '2200-01-15', at: '2026-11-10T09:00:00-05:00' }); }));
});

test('T02d one attestation posts its claims together: no PA approval and no other EOB between them', () => {
  const batch = between => {
    const s = S.paApproved(2, undefined, S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b' }));
    const t = '2026-11-18T10:00:00-05:00';
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    v1(s, 'cl-a', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    v1(s, 'cl-b', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    S.finalize(s);
    if (between === 'pa') { P(s, 'pa-1').decided_at = t; P(s, 'pa-1').approved_after_post = V(s, 'cl-a').posting_seq; }
    return s;
  };
  L(batch(null));
  R(batch('pa'), /PA pa-1 was approved inside the batch of one attestation/);
  const withV2 = order => {
    const t = '2026-11-18T10:00:00-05:00';
    let s = S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.openAppeal(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b' });
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    const a = () => v1(s, 'cl-a', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]), b = () => v1(s, 'cl-b', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    if (order === 'inside') { a(); s = S.overturned(undefined, t, s); b(); } else { a(); b(); s = S.overturned(undefined, t, s); }
    return S.finalize(s);
  };
  L(withV2('after'));
  const middle = () => {
    let s = S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-A' });
    s = S.pendingCob('m-2', 2026, s, true, { claim_id: 'cl-D', received_at: '2026-11-13T10:00:00-05:00' });
    s = S.pendingCob('m-2', 2026, s, false, { claim_id: 'cl-B', received_at: '2026-11-13T11:00:00-05:00' });
    const t = '2026-11-18T10:00:00-05:00';
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: r.type === 'accident' ? 'not_accident' : 'none', answered_at: t, request_version: 1 });
    for (const id of ['cl-A', 'cl-D', 'cl-B']) v1(s, id, t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    return S.finalize(s);
  };
  L(middle());
});

test('T02d an expedite approved at or after its accelerated due makes the PA overdue, withdrawn or not; the overturn builder composes', () => {
  const late = (status, overdue) => E(S.paPending(), s => { const p = P(s, 'pa-2'), ed = '2026-11-21T10:00:00-05:00';
    Object.assign(p, { status, pa_version: 2, expedite: { requested_at: '2026-11-17T09:00:00-05:00', reason: null, status: 'approved', decided_at: ed }, due_at: toIso(Date.parse('2026-11-17T09:00:00-05:00') + 72 * 3600000), overdue, overdue_at: overdue ? ed : null }); });
  R(late('withdrawn', false), /expedite approved at or after its accelerated due time without becoming overdue/, '2026-11-22T12:00:00-05:00');
  L(late('withdrawn', true), '2026-11-22T12:00:00-05:00');
  R(late('pending', false), /expedite approved at or after its accelerated due time without becoming overdue/, '2026-11-22T12:00:00-05:00');
  const exact = E(S.paPending(), s => { const p = P(s, 'pa-2'), due = toIso(Date.parse('2026-11-17T09:00:00-05:00') + 72 * 3600000);
    Object.assign(p, { expedite: { requested_at: '2026-11-17T09:00:00-05:00', reason: null, status: 'approved', decided_at: due }, due_at: due, overdue: false, overdue_at: null }); });
  R(exact, /expedite approved at or after its accelerated due time without becoming overdue/, '2026-11-21T12:00:00-05:00');
  const composed = S.overturned(undefined, undefined, S.openAppeal(undefined, 'under_review', S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', S.deniedClaim(undefined, S.deniedPa()))));
  L(composed);
  assert.deepEqual([A(composed, 'ap-1').status, A(composed, 'ap-2').status, V(composed, 'cl-3', 2).appeal_id], ['under_review', 'overturned', 'ap-2']);
});

test('T02d single rules not yet pinned elsewhere', () => {
  R(E(S.pendingCob(), s => { s.info_requests[0].answered_at = '2026-11-17T10:00:00-05:00'; }), /carries an answer while open/);
  R(E(S.base(), s => { V(s, 'cl-1').appeal_id = 'ap-1'; }), /is version 1 but not an initial EOB/);
  R(E((() => { const s = S.openAppeal({ type: 'pa', id: 'pa-3' }); const at = '2026-11-17T15:00:00-05:00';
    Object.assign(A(s, 'ap-1'), { status: 'overturned', decided_at: at, outcome: { lines: null, units: 1, valid_until: '2026-12-20' }, appeal_version: 1 });
    Object.assign(P(s, 'pa-3'), { status: 'approved', approved: { units: 1, valid_from: '2026-11-17', valid_until: '2026-12-20' }, decided_at: at, pa_version: 2 }); return S.finalize(s); })(), s => { P(s, 'pa-3').decided_at = '2026-11-09T10:00:00-05:00'; }), /PA pa-3 was decided before it was submitted/);
  const closingAfter = S.edit(S.overturned(), s => { s.windows[0].closing.done = true; });
  L(closingAfter, '2027-05-01T12:00:00-04:00');
  R(S.edit(S.overturned(), s => { s.windows[0].closing.done = true; s.windows[0].closing.notice_at = s.windows[0].closing.due_at; }), /closing notice does not match whether the target was appealable/, '2027-05-01T12:00:00-04:00');
  R(E(S.openAppeal(), s => { s.issued.file = '0'; }), /filing sequence repeats or is above the issued counter/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').status = 'withdrawn'; }), /decision or withdrawal time does not match its status/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').statements[0].at = '2026-11-17T10:00:00-05:00'; }), /has no filing statement/);
  R(S.openAppeal(undefined, 'under_review', E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { status: 'withdrawn', withdrawn_at: '2026-11-17T09:30:00-05:00', appeal_version: 1 }); }), { filed_at: '2026-11-17T09:15:00-05:00' }), /was filed while ap-1 was open or decided/);
});

test('T02d closing checks: pending steps after the due time, partial overturns, a PA approved right after a batch, copay bound, 2200 overturns, PA intake at the 2199 boundary', () => {
  R(E(S.paPending(), s => { Object.assign(P(s, 'pa-2'), { status: 'withdrawn', pa_version: 2, expedite: { requested_at: '2026-12-02T09:00:00-05:00', reason: null, status: 'denied', decided_at: '2026-12-02T10:00:00-05:00' } }); }), /records a step only a pending PA takes at or after its due time without becoming overdue/, '2026-12-03T12:00:00-05:00');
  L(E(S.paPending(), s => { Object.assign(P(s, 'pa-2'), { status: 'withdrawn', pa_version: 2, overdue: true, overdue_at: P(s, 'pa-2').due_at, expedite: { requested_at: '2026-12-02T09:00:00-05:00', reason: null, status: 'denied', decided_at: '2026-12-02T10:00:00-05:00' } }); }), '2026-12-03T12:00:00-05:00');
  L(E(S.overturned(['ln-1']), s => { s.windows[0].closing.done = true; }), '2027-05-01T12:00:00-04:00');
  const batchThenPa = () => {
    const s = S.paApproved(2, undefined, S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b' }));
    const t = '2026-11-18T10:00:00-05:00';
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    v1(s, 'cl-a', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    v1(s, 'cl-b', t, [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    S.finalize(s);
    Object.assign(P(s, 'pa-1'), { decided_at: t, submitted_at: '2026-11-10T09:00:00-05:00', due_at: S.due('2026-11-10T09:00:00-05:00', 15), approved_after_post: V(s, 'cl-b').posting_seq });
    return s;
  };
  L(batchThenPa());
  R(E(S.base(), s => { Object.assign(V(s, 'cl-1').lines[0], { copay_cents: 2501, member_cost_cents: 2501, plan_paid_cents: 15499 }); s.eobs[0].postings[0].oop_cents = 2501; s.accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026).oop_cents = 2501; }), /copay line carries a deductible, coinsurance or more than its copay/);
  const s = S.openAppeal({ type: 'pa', id: 'pa-3' }); const at = '2026-11-17T15:00:00-05:00';
  Object.assign(A(s, 'ap-1'), { status: 'overturned', decided_at: at, outcome: { lines: null, units: 1, valid_until: '2200-03-31' }, appeal_version: 1 });
  Object.assign(P(s, 'pa-3'), { status: 'approved', approved: { units: 1, valid_from: '2026-11-17', valid_until: '2200-03-31' }, decided_at: at, pa_version: 2 });
  L(S.finalize(s));
  const pa = at => ({ event_id: 'pa-x', at, operation: 'pa.submitted', payload: { pa_id: 'pa-x', member_id: 'm-1', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 1, valid_from: '2199-12-31', valid_until: '2200-01-31' } });
  const run = at => { const c = { ...ctx(at), role: 'infra' }; try { plugin.applyEvent(c, S.base(), pa(at), { 'pa.submitted': d => d }); return 'committed'; } catch (e) { return e.code + ':' + e.message; } };
  assert.equal(run('2199-12-31T23:59:59.999-05:00'), 'committed');
  assert.match(run('2200-01-01T00:00:00-05:00'), /^invalid_event:New claims and PAs are accepted only until 2199-12-31/);
});

test('T02d an overturn composed after the deductible is used takes caller-priced lines', () => {
  const s = S.overturned(['ln-1', 'ln-2'], undefined, S.openAppeal(undefined, undefined, S.deniedClaim(undefined, S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 150000 }]))), { 'ln-1': S.paid('ln-1', 150000, { coins: 30000 }, 180000) });
  L(s);
  assert.deepEqual(s.accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026), { member_id: 'm-1', plan_year: 2026, deductible_cents: 150000, oop_cents: 187500 });
});
