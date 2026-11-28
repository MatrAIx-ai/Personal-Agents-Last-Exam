'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const S = require('./seeds.cjs');
const { toIso, endOfDay } = require('../src/time.cjs');

const ctx = now => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now ?? '2026-11-18T12:00:00-05:00', binding: structuredClone(require('../fixtures/binding.json')) });
const R = (s, pattern, now) => assert.throws(() => plugin.validateSeed(ctx(now), s), e => e.code === 'invalid_seed' && pattern.test(e.message), String(pattern));
const L = (s, now) => assert.doesNotThrow(() => plugin.validateSeed(ctx(now), s));
const E = S.edit;
const C = (s, id) => s.claims.find(c => c.claim_id === id), V = (s, claim, v = 1) => s.eobs.find(e => e.claim_id === claim && e.version === v);
const P = (s, id) => s.pas.find(p => p.pa_id === id), A = (s, id) => s.appeals.find(a => a.appeal_id === id);
const acc = (s, m, y) => s.accumulators.find(a => a.member_id === m && a.plan_year === y);
const text = n => 'x'.repeat(n);
const yr = s => s.plan.years['2026'];
const R2 = ([s, now], pattern) => R(s, pattern, now), L2 = ([s, now]) => L(s, now);
const repost = s => {
  for (const e of s.eobs) {
    const c = C(s, e.claim_id), year = l => Number(c.lines.find(x => x.line_id === l.line_id).service_date.slice(0, 4));
    e.postings = e.postings.map(p => { const mine = e.lines.filter(l => year(l) === p.plan_year); return { ...p, deductible_cents: mine.reduce((t, l) => t + l.deductible_cents, 0), oop_cents: mine.reduce((t, l) => t + l.member_cost_cents, 0) }; });
  }
  return S.finalize(s);
};

test('T02c plan years and limits: every clause and boundary', () => {
  R(E(S.base(), s => { s.plan.years.abcd = yr(s); }), /not a year from 2000 to 2199/);
  R(E(S.base(), s => { s.plan.years['1999'] = yr(s); }), /not a year from 2000 to 2199/);
  R(E(S.base(), s => { s.plan.years['2200'] = yr(s); }), /not a year from 2000 to 2199/);
  L(E(S.base(), s => { s.plan.years['2000'] = yr(s); s.plan.years['2199'] = yr(s); }));
  L(E(S.base(), s => { yr(s).deductible = { individual_cents: 300000, family_cents: 300000 }; }));
  L(E(S.base(), s => { yr(s).oop_max = { individual_cents: 800000, family_cents: 800000 }; }));
  R(E(S.base(), s => { yr(s).deductible = { individual_cents: 450000, family_cents: 450000 }; }), /deductible above its out-of-pocket maximum/);
  L(E(S.base(), s => { yr(s).deductible = { individual_cents: 400000, family_cents: 400000 }; }));
  L(E(S.base(), s => { yr(s).deductible = { individual_cents: 150000, family_cents: 800000 }; }));
});

test('T02c requests and claim states: every clause and boundary', () => {
  const answered = o => E(S.pendingCob(), s => { Object.assign(s.info_requests[0], { status: 'answered', answer: 'none', answered_at: '2026-11-17T10:00:00-05:00', ...o }); });
  R(answered({ answer: 'accident' }), /answered without a valid answer and time/);
  R(answered({ answered_at: null }), /answered without a valid answer and time/);
  R(answered({ answered_at: '2026-11-16T23:00:00-05:00' }), /answered outside its open period/);
  R(E(S.received(), s => { s.eobs.push({ ...structuredClone(V(s, 'cl-1')), eob_id: 'eob-9', claim_id: 'cl-2', posting_seq: '9' }); }), /is received but already has requests, an EOB or a processing time/);
  R(E(S.received(), s => { s.info_requests.push({ info_request_id: 'ir-1', request_version: 0, type: 'other_coverage', claim_id: 'cl-2', line_id: 'ln-1', plan_year: 2026, opened_at: C(s, 'cl-2').review_at, expires_at: S.due(C(s, 'cl-2').review_at, 45), status: 'open', answer: null, answered_at: null }); s.issued.ir = '1'; }), /is received but already has requests, an EOB or a processing time/);
  R(E(S.pendingCob(), s => { s.eobs.push({ ...structuredClone(V(s, 'cl-1')), eob_id: 'eob-9', claim_id: 'cl-4', posting_seq: '9' }); }), /pending information without an open request, or with an EOB/);
  R(E(S.pendingCob(), s => { C(s, 'cl-4').processed_at = C(s, 'cl-4').review_at; }), /pending information without an open request, or with an EOB/);
  L(E(S.received(), s => { C(s, 'cl-2').lines[0].service_date = '2026-11-17'; }));
});

test('T02c EOB lines: every clause', () => {
  const den = fn => E(S.deniedClaim(), s => fn(V(s, 'cl-3').lines[0]));
  R(den(l => { l.allowed_cents = 100; }), /denied with a missing reason, an amount or PA use/);
  R(den(l => { l.pa_id = 'pa-1'; }), /denied with a missing reason, an amount or PA use/);
  R(den(l => { l.pa_units = 1; }), /denied with a missing reason, an amount or PA use/);
  const cop = fn => E(S.base(), s => fn(V(s, 'cl-1').lines[0]));
  R(cop(l => { Object.assign(l, { copay_cents: 2400, deductible_cents: 100 }); }), /copay line carries a deductible/);
  R(cop(l => { Object.assign(l, { copay_cents: 2400, coinsurance_cents: 100 }); }), /copay line carries a deductible/);
  R(cop(l => { Object.assign(l, { copay_cents: 2600, member_cost_cents: 2600, plan_paid_cents: 15400 }); }), /copay line carries a deductible, coinsurance or more than its copay/);
  const ded = fn => E(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 100000 }]), s => fn(V(s, 'cl-l1').lines[0]));
  R(ded(l => { Object.assign(l, { deductible_cents: 100001, coinsurance_cents: 0, member_cost_cents: 100001, plan_paid_cents: -1 }); }), /plan payment|deductible line carries/);
  R(ded(l => { Object.assign(l, { deductible_cents: 50000, coinsurance_cents: 10001, member_cost_cents: 60001, plan_paid_cents: 39999 }); }), /deductible line carries a copay or more than its deductible and coinsurance allow/);
  R(repost(ded(l => { Object.assign(l, { deductible_cents: 50000, coinsurance_cents: 10000, member_cost_cents: 60000, plan_paid_cents: 40000 }); })), /amounts differ from the plan's pricing/);
  const part = coins => { const s = S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 100000 }]); S.claim(s, { claim_id: 'cl-p', member_id: 'm-1', provider_id: 'pv-2', received_at: '2026-03-01T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-knee-mri', '2026-02-27', 100000)] }); S.process(s, 'cl-p', [S.paid('ln-1', 100000, { ded: 50000, coins }, 100000)]); return S.finalize(s); };
  L(part(10000));
  R(part(10001), /deductible line carries a copay or more than its deductible and coinsurance allow/);
});

test('T02c PA use on lines: every clause and boundary', () => {
  R(E(S.paUsed(), s => { V(s, 'cl-5').lines[0] = { ...S.denied('ln-1', 'prior_auth_missing', 15000), pa_id: 'pa-1', pa_units: 1 }; }), /uses a PA although it is an emergency or not PA-listed|denied with a missing reason/);
  R(E(S.paUsed(), s => { s.plan.pa_services = s.plan.pa_services.filter(x => x !== 'svc-physical-therapy'); }), /uses a PA although it is an emergency or not PA-listed/);
  R(E(S.paUsed(), s => { P(s, 'pa-1').member_id = 'm-2'; }), /names a PA that does not cover it/);
  R(E(S.paUsed(), s => { P(s, 'pa-1').service_id = 'svc-knee-mri'; }), /names a PA that does not cover it/);
  R(E(S.paUsed(), s => { P(s, 'pa-1').approved.valid_until = '2026-11-11'; }), /names a PA that does not cover it/);
  L(E(S.paUsed(), s => { P(s, 'pa-1').approved.valid_from = '2026-11-12'; }));
  L(E(S.paUsed(), s => { P(s, 'pa-1').approved.valid_until = '2026-11-12'; P(s, 'pa-1').status = 'expired'; P(s, 'pa-1').expired_at = toIso(endOfDay('2026-11-12')); }));
  R(E(S.paUsed(), s => { Object.assign(P(s, 'pa-1'), { status: 'pending', approved: null, approved_after_post: null, decided_at: null }); }), /names a PA that does not cover it/);
});

test('T02c v1 outcomes and later versions: every clause', () => {
  R(E(S.base(), s => { Object.assign(s.coverage.find(c => c.member_id === 'm-1' && c.plan_year === 2026), { status: 'other_primary' }); }), /outcome does not follow its requests, network and PA rules/);
  R(E(S.deniedClaim(), s => { V(s, 'cl-3').lines[0].reason = 'missing_information'; }), /outcome does not follow its requests, network and PA rules/);
  R(E(S.overturned(), s => { V(s, 'cl-3', 2).reason = 'initial'; }), /later version without its appeal/);
  R(E(S.overturned(), s => { A(s, 'ap-1').status = 'upheld'; }), /names an appeal that did not overturn claim cl-3/);
  R(E(S.overturned(), s => { A(s, 'ap-1').target = { type: 'pa', id: 'pa-x' }; }), /names an appeal that did not overturn claim cl-3/);
  R(E(S.overturned(), s => { A(s, 'ap-1').outcome = null; }), /changes lines other than those its appeal overturned/);
  R(E(S.overturned(), s => { A(s, 'ap-1').outcome.lines = null; }), /changes lines other than those its appeal overturned/);
  R(E(S.overturned(['ln-1']), s => { const v2 = V(s, 'cl-3', 2); v2.lines[0] = { ...v2.lines[0], pa_id: 'pa-1', pa_units: 1 }; }), /uses a PA although|was not a denied line repriced/);
  R(E(S.overturned(), s => { A(s, 'ap-1').outcome.lines = ['ln-1', 'ln-2']; const v1 = V(s, 'cl-3'); v1.lines[1] = S.paid('ln-2', 30000, { copay: 5000 }, 32000); }), /outcome does not follow|was not a denied line|postings are not/);
});

test('T02c accumulators and family limits: every clause and boundary', () => {
  R(E(S.base(), s => { acc(s, 'm-1', 2026).deductible_cents = 1; }), /does not equal the sum of its current EOB postings/);
  L(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 150000 }]));
  R(E(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 150000 }]), s => { yr(s).oop_max.individual_cents = 151000; yr(s).deductible.individual_cents = 150000; }), /outside the plan's individual limits/);
  L(E(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 150000 }]), s => { yr(s).oop_max.individual_cents = 152500; }));
  L(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 150000 }, { member: 'm-2', year: 2026, deductible_cents: 150000 }]));
  R(E(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 140000 }, { member: 'm-2', year: 2026, deductible_cents: 140000 }]), s => { yr(s).oop_max.family_cents = 280000; yr(s).oop_max.individual_cents = 280000; yr(s).deductible.family_cents = 280000; }), /Family accumulators for 2026 are outside the plan's family limits/);
  L(E(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 140000 }, { member: 'm-2', year: 2026, deductible_cents: 137500 }]), s => { yr(s).oop_max.family_cents = 280000; yr(s).oop_max.individual_cents = 280000; yr(s).deductible.family_cents = 280000; }));
});

test('T02c PA records: every clause and boundary', () => {
  L(E(S.paPending(), s => { P(s, 'pa-2').requested.valid_until = '2026-12-01'; }));
  R(E(S.paPending(), s => { P(s, 'pa-2').overdue_at = P(s, 'pa-2').due_at; }), /overdue flag and time disagree/);
  R(E(S.paPending(), s => { Object.assign(P(s, 'pa-2'), { overdue: true, overdue_at: '2026-12-02T10:00:00-05:00' }); }), /overdue flag and time disagree/);
  const late = at => E(S.deniedPa(), s => { Object.assign(P(s, 'pa-3'), { decided_at: at, denial_notice_at: at }); s.windows[0].notice_at = at; s.windows[0].ends_at = S.due(at, 180); s.windows[0].closing.due_at = S.due(at, 166); });
  R(late(S.deniedPa().pas[0].due_at), /decided at or after its due time without becoming overdue first/);
  L(E(late('2026-11-17T10:00:00-05:00'), s => { Object.assign(P(s, 'pa-3'), { overdue: true, overdue_at: P(s, 'pa-3').due_at }); }));
  L(E(late(S.deniedPa().pas[0].due_at), s => { Object.assign(P(s, 'pa-3'), { overdue: true, overdue_at: P(s, 'pa-3').due_at }); }));
  L(E(S.deniedPa(), s => { const t = P(s, 'pa-3').submitted_at; Object.assign(P(s, 'pa-3'), { decided_at: t, denial_notice_at: t }); s.windows[0].notice_at = t; s.windows[0].ends_at = S.due(t, 180); s.windows[0].closing.due_at = S.due(t, 166); }));
  R(E(S.paApproved(), s => { P(s, 'pa-1').approved_after_post = 'x'; }), /approval posting mark is above the issued counter/);
  L(E(S.paApproved(), s => { P(s, 'pa-1').approved = { units: 12, valid_from: '2026-11-05', valid_until: '2026-11-05' }; Object.assign(P(s, 'pa-1'), { status: 'expired', expired_at: toIso(endOfDay('2026-11-05')) }); }));
  const units = (approved, used) => E(S.paUsed(), s => { const l = V(s, 'cl-5').lines[0], cl = C(s, 'cl-5').lines[0]; cl.units = 2; cl.billed_cents = 30000; Object.assign(l, S.paid('ln-1', 30000, { copay: 3500 }, 30000, { id: 'pa-1', units: 2 })); P(s, 'pa-1').approved.units = approved; P(s, 'pa-1').units_used = used; });
  R(units(1, 2), /units used differ from its paid lines or exceed the approved units/);
  L(units(2, 2));
  const info = t => E(S.paPending('info_requested'), s => { P(s, 'pa-2').info_requests[0].text = t; });
  L(info(text(1))); L(info(text(2000))); R(info(text(2001)), /with a text outside 1 to 2,000/);
  R(E(S.paPending('info_requested'), s => { P(s, 'pa-2').info_requests[0].at = '2026-11-16T08:00:00-05:00'; }), /information request before submission/);
  L(E(S.paPending('info_requested'), s => { P(s, 'pa-2').info_requests[0].at = P(s, 'pa-2').submitted_at; }));
  const reason = t => E(S.paPending(), s => { P(s, 'pa-2').expedite = { requested_at: '2026-11-17T09:00:00-05:00', reason: t, status: 'open', decided_at: null }; });
  L(reason(text(1))); L(reason(text(2000))); R(reason(text(2001)), /expedite reason is outside/);
  const exp = o => E(S.paPending(), s => { P(s, 'pa-2').expedite = { requested_at: '2026-11-17T09:00:00-05:00', reason: null, status: 'denied', decided_at: '2026-11-17T10:00:00-05:00', ...o }; });
  R(exp({ requested_at: '2026-11-16T08:00:00-05:00' }), /expedite record is inconsistent/);
  R(exp({ decided_at: '2026-11-17T08:00:00-05:00' }), /expedite record is inconsistent/);
  L(exp({ requested_at: '2026-11-16T09:00:00-05:00', decided_at: '2026-11-16T09:00:00-05:00' }));
});

test('T02c covered submissions: every clause and boundary', () => {
  const sub = o => ({ pa_id: 'pa-9', provider_id: 'pv-3', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31', at: '2026-11-10T09:00:00-05:00', ...o });
  const with1 = (...subs) => E(S.paApproved(), s => { P(s, 'pa-1').covered_submissions.push(...subs); });
  R(with1(sub(), sub()), /repeats a PA ID/);
  R(with1(sub({ at: '2026-11-05T09:00:00-05:00' })), /is not inside its approval/);
  L(with1(sub({ at: '2026-11-05T10:00:00-05:00' })));
  R(with1(sub({ valid_until: '2027-03-01' })), /is not inside its approval/);
  R(with1(sub({ valid_from: '2027-01-01', valid_until: '2026-12-31' })), /is not inside its approval/);
  L(with1(sub({ valid_from: '2026-11-05', valid_until: '2027-02-28' })));
  R(with1(sub({ valid_from: '2026-02-30', valid_until: '2027-02-28' })), /is not inside its approval|has an invalid date/);
  R(E(S.paPending(), s => { P(s, 'pa-2').covered_submissions.push(sub()); }), /is not inside its approval/);
  R(E(S.paApproved(undefined, { valid_from: '2026-11-05', valid_until: '2026-11-17' }), s => { P(s, 'pa-1').covered_submissions.push(sub({ valid_from: '2026-11-10', valid_until: '2026-11-17', at: toIso(endOfDay('2026-11-17')) })); }), /came after the approval ended/);
});

test('T02c appeals: every clause and boundary', () => {
  const w = S.deniedClaim().windows[0];
  R(S.openAppeal(undefined, undefined, undefined, { filed_at: w.ends_at }), /filed outside its target's appeal window/, '2027-06-01T12:00:00-04:00');
  R(E(S.openAppeal(), s => { A(s, 'ap-1').lines = null; }), /claim appeal that is expedited or names no lines/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').lines = []; }), /claim appeal that is expedited or names no lines/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').overdue_at = A(s, 'ap-1').due_at; }), /overdue flag and time disagree/);
  const st = t => E(S.openAppeal(), s => { A(s, 'ap-1').statements[0].text = t; });
  L(st(text(1))); L(st(text(2000))); R(st(text(2001)), /statement or request text outside 1 to 2,000/);
  L(E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { status: 'info_requested', info_requests: [{ at: A(s, 'ap-1').filed_at, text: 'Referral' }] }); }));
  L(E(S.openAppeal(), s => { const a = A(s, 'ap-1'), t = a.due_at; Object.assign(a, { status: 'upheld', decided_at: t, overdue: true, overdue_at: t }); }), '2027-01-17T12:00:00-05:00');
  const pao = fn => { const s = S.openAppeal({ type: 'pa', id: 'pa-3' }); const at = '2026-11-17T15:00:00-05:00';
    Object.assign(A(s, 'ap-1'), { status: 'overturned', decided_at: at, outcome: { lines: null, units: 1, valid_until: '2026-12-20' }, appeal_version: 1 });
    Object.assign(P(s, 'pa-3'), { status: 'approved', approved: { units: 1, valid_from: '2026-11-17', valid_until: '2026-12-20' }, decided_at: at, pa_version: 2 });
    S.finalize(s); fn(s); return s; };
  L(pao(() => {}));
  R(pao(s => { A(s, 'ap-1').outcome.lines = ['ln-1']; }), /outcome does not fit its target/);
  R(pao(s => { A(s, 'ap-1').outcome.units = null; }), /outcome does not fit its target/);
  R(pao(s => { A(s, 'ap-1').outcome.valid_until = null; }), /outcome does not fit its target/);
  R(pao(s => { A(s, 'ap-1').outcome.valid_until = '2026-12-32'; P(s, 'pa-3').approved.valid_until = '2026-12-32'; }), /outcome does not fit its target|invalid approved date/);
  R(pao(s => { P(s, 'pa-3').approved.valid_until = '2026-12-21'; }), /overturn is not reflected in PA pa-3/);
  R(pao(s => { P(s, 'pa-3').approved.valid_from = '2026-11-18'; }), /overturn is not reflected in PA pa-3/);
  R(pao(s => { P(s, 'pa-3').decided_at = '2026-11-17T16:00:00-05:00'; }), /overturn is not reflected in PA pa-3|approval posting mark/);
  R(E(S.openAppeal(), s => { s.windows.push({ target: { type: 'pa', id: 'pa-x' }, notice_at: s.windows[0].notice_at, ends_at: s.windows[0].ends_at, closing: { ...s.windows[0].closing } }); }), /does not belong to a denial notice of its target/);
});

test('T02c an open appeal\'s status follows its latest request and statement: under review needs a later or same-instant statement after filing, info_requested a request no earlier than every statement', () => {
  const FILED = '2026-11-17T09:00:00-05:00', at = h => toIso(Date.parse(FILED) + h * 3600000);
  const appeal = (status, requests, statements) => E(S.openAppeal(), s => { const a = A(s, 'ap-1'); Object.assign(a, { status, info_requests: requests.map(h => ({ at: at(h), text: 'Referral' })), statements: [a.statements[0], ...statements.map(h => ({ at: at(h), by: 'm-1', text: 'Letter.' }))] }); });
  const UNDER = /under review although its latest information request came after its latest statement/, WAITING = /waiting for information it never requested, or a statement came after its latest request/;
  L(appeal('under_review', [], []));
  L(appeal('under_review', [], [0, 2]));
  L(appeal('under_review', [1], [1]));
  L(appeal('under_review', [1], [2]));
  L(appeal('under_review', [1, 3], [2, 4]));
  L(appeal('under_review', [1, 3], [4, 2]));
  R(appeal('under_review', [1], []), UNDER);
  R(appeal('under_review', [0], []), UNDER);
  R(appeal('under_review', [2], [1]), UNDER);
  R(appeal('under_review', [1, 3], [2]), UNDER);
  R(appeal('under_review', [3, 1], [2]), UNDER);
  L(appeal('info_requested', [0], []));
  L(appeal('info_requested', [1], []));
  L(appeal('info_requested', [2], [2]));
  L(appeal('info_requested', [1, 3], [2]));
  L(appeal('info_requested', [3, 1], [2]));
  R(appeal('info_requested', [], []), WAITING);
  R(appeal('info_requested', [1], [2]), WAITING);
  R(appeal('info_requested', [1, 3], [2, 4]), WAITING);
  R(appeal('info_requested', [1, 3], [4, 2]), WAITING);
  for (const status of ['upheld', 'withdrawn']) L(E(appeal(status, [2], [1]), s => Object.assign(A(s, 'ap-1'), status === 'upheld' ? { decided_at: at(3) } : { withdrawn_at: at(3) })));
  const GAP = /has an information request recorded while an earlier one was still unanswered/;
  R(appeal('under_review', [1, 3], [4]), GAP);
  R(appeal('info_requested', [1, 3], []), GAP);
  R(appeal('info_requested', [1, 3], [0]), GAP);
  R(appeal('under_review', [1, 3, 5], [2, 6]), GAP);
  R(appeal('info_requested', [1, 2, 3], [2]), GAP);
  L(appeal('info_requested', [1, 2, 3], [2, 2]));
  L(appeal('info_requested', [1, 1], [1]));
  R(appeal('info_requested', [1, 1], []), GAP);
  L(appeal('under_review', [1, 1], [1, 1]));
  R(appeal('under_review', [1, 1], [1]), UNDER);
  L(appeal('info_requested', [1, 3], [1]));
  L(appeal('info_requested', [1, 3], [3]));
  L(appeal('under_review', [1, 3], [3, 3]));
  R(appeal('under_review', [1, 3], [3]), UNDER);
  L(appeal('info_requested', [5, 1, 3], [4, 2]));
  R(appeal('info_requested', [5, 1, 3], [2]), GAP);
  const ended = (requests, statements) => E(appeal('upheld', requests, statements), s => Object.assign(A(s, 'ap-1'), { decided_at: at(6) }));
  R(ended([1, 3], []), GAP);
  L(ended([1, 3], [2]));
});

test('T02c a covered submission sits under the first PA in the plan\'s order that was approved before its intake, still in force, covering its dates with enough units left', () => {
  const NOW = '2026-11-18T12:00:00-05:00';
  const sub = (o = {}) => ({ pa_id: 'pa-7', provider_id: 'pv-3', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-31', at: NOW, ...o });
  const two = (first = {}, second = {}, base = S.paApproved()) => S.finalize(E(base, s => { s.pas.push({ ...structuredClone(P(s, 'pa-1')), pa_id: 'pa-9', units_used: 0, ...second }); Object.assign(P(s, 'pa-1'), first); }));
  const under = (seed, id, o) => E(seed, s => { const p = P(s, id); p.covered_submissions.push(sub(o)); p.pa_version++; });
  const WRONG = /covered submission pa-7 belongs under pa-1, which comes first in the plan's order and was approved before the intake with enough units left/;
  L(under(two(), 'pa-1'));
  R(under(two(), 'pa-9'), WRONG);
  const decided = at => ({ submitted_at: '2026-11-10T09:00:00-05:00', due_at: S.due('2026-11-10T09:00:00-05:00', 15), decided_at: at });
  L(under(two(decided(NOW)), 'pa-9'));
  R(under(two(decided('2026-11-18T11:59:59-05:00')), 'pa-9'), WRONG);
  L(under(two({ approved: { units: 1, valid_from: '2026-11-05', valid_until: '2027-02-28' } }), 'pa-9'));
  R(under(two({ approved: { units: 2, valid_from: '2026-11-05', valid_until: '2027-02-28' } }), 'pa-9'), WRONG);
  const used = () => S.paUsed(S.paApproved(3));
  R(under(two({}, { approved: { units: 12, valid_from: '2026-11-05', valid_until: '2027-02-28' } }, used()), 'pa-9', { units: 2 }), WRONG);
  L(under(two({}, { approved: { units: 12, valid_from: '2026-11-05', valid_until: '2027-02-28' } }, used()), 'pa-9', { units: 3 }));
  const ended = o => under(two({ status: 'expired', approved: { units: 12, valid_from: '2026-11-05', valid_until: '2026-11-17' }, expired_at: '2026-11-17T23:59:00-05:00' }), 'pa-9', { valid_from: '2026-11-10', valid_until: '2026-11-15', ...o });
  L(ended());
  L(ended({ at: '2026-11-17T23:59:00-05:00' }));
  R(ended({ at: '2026-11-17T23:58:00-05:00' }), WRONG);
  const wider = { approved: { units: 12, valid_from: '2026-11-01', valid_until: '2027-03-31' } };
  L(under(two({}, wider), 'pa-9', { valid_from: '2026-11-02' }));
  L(under(two({}, wider), 'pa-9', { valid_until: '2027-03-10' }));
  R(under(two({}, wider), 'pa-9', { valid_from: '2026-11-05', valid_until: '2027-02-28' }), WRONG);
  L(under(two({ service_id: 'svc-arthroscopy', provider_id: 'pv-4' }), 'pa-9'));
  L(under(two({ member_id: 'm-2' }), 'pa-9'));
  L(under(S.finalize(E(S.paPending(undefined, two({}, { pa_id: 'pa-9' })), s => Object.assign(P(s, 'pa-2'), { pa_id: 'pa-0', service_id: 'svc-physical-therapy', provider_id: 'pv-3' }))), 'pa-1'));
  const spentLater = () => {
    const s = S.paUsed(S.paApproved(2));
    S.claim(s, { claim_id: 'cl-8', member_id: 'm-3', provider_id: 'pv-3', received_at: '2026-11-14T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-13', 15000)] });
    S.process(s, 'cl-8', [S.paid('ln-1', 15000, { copay: 3500 }, 15000, { id: 'pa-1', units: 1 })]);
    P(s, 'pa-1').units_used = 2;
    return two({}, { approved: { units: 12, valid_from: '2026-11-05', valid_until: '2027-02-28' } }, S.finalize(s));
  };
  const BETWEEN = '2026-11-17T12:00:00-05:00', POSTED = '2026-11-17T23:59:00-05:00';
  assert.deepEqual([V(spentLater(), 'cl-5').issued_at, V(spentLater(), 'cl-8').issued_at, P(spentLater(), 'pa-1').units_used], ['2026-11-16T23:59:00-05:00', POSTED, 2]);
  L(under(spentLater(), 'pa-1', { at: BETWEEN, units: 1 }));
  R(under(spentLater(), 'pa-9', { at: BETWEEN, units: 1 }), WRONG);
  L(under(spentLater(), 'pa-9', { at: BETWEEN, units: 2 }));
  L(under(spentLater(), 'pa-9', { at: POSTED, units: 1 }));
});

test('T02c grants and approvals: every clause and boundary', () => {
  R(E(S.granted(undefined, 'm-2', 'view', '2026-12-01T09:00:00-05:00'), s => { Object.assign(s.grants[0], { status: 'revoked', revoked_at: '2026-12-01T09:00:00-05:00' }); }), /was revoked outside its term|after the App's current time/);
  L(E(S.granted(), s => { Object.assign(s.grants[0], { status: 'revoked', revoked_at: s.grants[0].created_at }); }));
  const ap = o => E(S.base(), s => { s.approvals.push({ approval_id: 'cf-1', token: 'tok-7c1e', subject: null, confirmed_by: 'm-1', confirmed_at: '2026-11-18T10:00:00-05:00', used_at: null, ...o }); s.issued.cf = '1'; });
  R(ap({ used_at: '2026-11-18T09:59:00-05:00' }), /used outside its 30 minutes/);
  L(ap({ used_at: '2026-11-18T10:00:00-05:00' }));
  L(ap({ used_at: '2026-11-18T10:29:59.999-05:00' }));
});

test('T02c remaining clauses and boundaries', () => {
  R(E(S.overturned(), s => { A(s, 'ap-1').target.type = 'pa'; }), /names an appeal that did not overturn claim cl-3/);
  const mixed = () => {
    const s = S.base();
    S.claim(s, { claim_id: 'cl-6', member_id: 'm-1', provider_id: 'pv-3', received_at: '2026-11-12T12:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-11', 15000), S.line('ln-2', 2, 'svc-office-visit', '2026-11-11', 21000)] });
    const e = S.process(s, 'cl-6', [S.denied('ln-1', 'prior_auth_missing', 15000), S.paid('ln-2', 18000, { copay: 2500 }, 21000)]);
    S.window(s, 'claim', 'cl-6', e.issued_at);
    return S.finalize(s);
  };
  L(mixed());
  const decided = '2026-11-18T10:00:00-05:00';
  const ap = S.openAppeal({ type: 'claim', id: 'cl-6' }, 'under_review', mixed());
  Object.assign(A(ap, 'ap-1'), { status: 'overturned', decided_at: decided, outcome: { lines: ['ln-1', 'ln-2'], units: null, valid_until: null }, appeal_version: 1 });
  S.post(ap, { eob_id: 'eob-' + (Number(ap.issued.eob) + 1), claim_id: 'cl-6', version: 2, issued_at: decided, reason: 'appeal', appeal_id: 'ap-1', lines: [S.paid('ln-1', 15000, { copay: 3500 }, 15000), S.paid('ln-2', 18000, { copay: 2000 }, 21000)] });
  R(S.finalize(ap), /line ln-2 was not a denied line repriced as covered without a PA/);
  R(E(S.paUsed(), s => { P(s, 'pa-1').units_used = 0; }), /units used differ from its paid lines or exceed the approved units/);
  const sub = o => ({ pa_id: 'pa-9', provider_id: 'pv-3', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31', at: '2026-11-10T09:00:00-05:00', ...o });
  R(E(S.paApproved(), s => { P(s, 'pa-1').covered_submissions.push(sub({ valid_from: '2026-11-31', valid_until: '2026-12-01' })); }), /has an invalid date or came after the approval ended/);
  L(E(S.paApproved(), s => { P(s, 'pa-1').covered_submissions.push(sub({ valid_from: '2026-12-01', valid_until: '2026-12-01' })); }));
  R(E(S.base(), s => { s.appeals.push({ appeal_id: 'ap-1', appeal_version: 0, member_id: 'm-1', target: { type: 'claim', id: 'cl-1' }, lines: ['ln-1'], expedited: false, filed_at: '2026-11-17T09:00:00-05:00', filed_seq: '1', due_at: S.due('2026-11-17T09:00:00-05:00', 60), overdue: false, overdue_at: null, status: 'under_review', statements: [{ at: '2026-11-17T09:00:00-05:00', by: 'm-1', text: 'Please review.' }], info_requests: [], decided_at: null, outcome: null, withdrawn_at: null }); s.issued.ap = '1'; s.issued.file = '1'; }), /filed outside its target's appeal window/);
  const cut = toIso(endOfDay('2026-11-05'));
  L(E(S.paApproved(), s => { Object.assign(P(s, 'pa-1'), { status: 'expired', approved: { units: 12, valid_from: '2026-11-06', valid_until: '2026-11-05' }, decided_at: cut, expired_at: cut }); }));
  R(E(S.granted(undefined, 'm-2', 'view', '2026-11-10T09:00:00-05:00'), s => { Object.assign(s.grants[0], { status: 'revoked', revoked_at: '2026-11-10T09:00:00-05:00' }); }), /was revoked outside its term/);
});

test('T02c expedite approved after the PA was already overdue, and the overdue times each order allows', () => {
  const at = (expediteDecided, overdueAt, now) => [E(S.paPending(), s => { const p = P(s, 'pa-2'), due = Math.min(Date.parse(p.due_at), Date.parse('2026-11-17T09:00:00-05:00') + 72 * 3600000);
    Object.assign(p, { expedite: { requested_at: '2026-11-17T09:00:00-05:00', reason: null, status: 'approved', decided_at: expediteDecided }, due_at: toIso(due), overdue: true, overdue_at: overdueAt }); }), now];
  const d15 = S.paPending().pas[0].due_at;
  L2(at('2026-12-02T10:00:00-05:00', d15, '2026-12-03T12:00:00-05:00'));
  R2(at('2026-12-02T10:00:00-05:00', '2026-11-20T09:00:00-05:00', '2026-12-03T12:00:00-05:00'), /overdue flag and time disagree/);
  L2(at('2026-11-19T10:00:00-05:00', '2026-11-20T09:00:00-05:00', '2026-11-21T12:00:00-05:00'));
  L2(at('2026-11-21T10:00:00-05:00', '2026-11-21T10:00:00-05:00', '2026-11-22T12:00:00-05:00'));
  R2(at('2026-11-21T10:00:00-05:00', '2026-11-20T09:00:00-05:00', '2026-11-22T12:00:00-05:00'), /overdue flag and time disagree/);
});

test('T02c terminal PA history, PA approval before use, same-instant posting order across spellings, expiries and one attestation', () => {
  R(E(S.paApproved(), s => { P(s, 'pa-1').info_requests.push({ at: '2026-11-06T10:00:00-05:00', text: 'Late' }); }), /records an information or expedite step after its decision/);
  R(E(S.paApproved(), s => { P(s, 'pa-1').expedite = { requested_at: '2026-11-06T10:00:00-05:00', reason: null, status: 'open', decided_at: null }; }), /records an information or expedite step after its decision/);
  L(E(S.paApproved(), s => { P(s, 'pa-1').info_requests.push({ at: P(s, 'pa-1').decided_at, text: 'Same instant' }); }));
  R(S.finalize(E(S.paUsed(), s => { P(s, 'pa-1').decided_at = '2026-11-17T10:00:00-05:00'; })), /names a PA approved after it posted/);
  const twin = (first, spell) => {
    const s = S.base();
    for (const id of first === 'cl-10' ? ['cl-10', 'cl-9'] : ['cl-9', 'cl-10']) {
      S.claim(s, { claim_id: id, member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-12T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-lab-panel', '2026-11-10', 9000)] });
      S.process(s, id, [S.paid('ln-1', 9000, { ded: 9000 }, 9000)]);
    }
    S.finalize(s);
    if (spell) for (const e of s.eobs) if (e.claim_id === 'cl-10') { e.issued_at = '2026-11-16T04:59:00Z'; C(s, 'cl-10').processed_at = e.issued_at; C(s, 'cl-10').review_at = e.issued_at; }
    return s;
  };
  L(twin('cl-10', true));
  R(twin('cl-9', true), /posted cl-9 before cl-10; same-instant timers run in object ID string order/);
  const expiries = order => {
    const s = S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b' });
    const ids = ['ir-9', 'ir-10'];
    s.info_requests.forEach((r, i) => { r.info_request_id = ids[i]; Object.assign(r, { status: 'expired', request_version: 1 }); });
    s.issued.ir = '10';
    for (const id of order) { const c = C(s, id); Object.assign(c, { status: 'processed', processed_at: s.info_requests.find(r => r.claim_id === id).expires_at }); const e = S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: id, version: 1, issued_at: c.processed_at, reason: 'initial', appeal_id: null, lines: [S.denied('ln-1', 'missing_information', 21000)] }); S.window(s, 'claim', id, e.issued_at); }
    return [S.finalize(s), '2027-01-01T12:00:00-05:00'];
  };
  L2(expiries(['cl-b', 'cl-a']));
  R2(expiries(['cl-a', 'cl-b']), /posted cl-a before cl-b; same-instant timers run in object ID string order/);
  const attest = order => {
    const s = S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b', received_at: '2026-11-13T10:00:00-05:00' });
    const t = '2026-11-18T10:00:00-05:00';
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    for (const id of order) { Object.assign(C(s, id), { status: 'processed', processed_at: t }); S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: id, version: 1, issued_at: t, reason: 'initial', appeal_id: null, lines: [S.paid('ln-1', 18000, { copay: 2500 }, 21000)] }); }
    return S.finalize(s);
  };
  L(attest(['cl-a', 'cl-b']));
  R(attest(['cl-b', 'cl-a']), /One attestation completed cl-b before cl-a/);
});

test('T02c the ledger advances by the difference after a v1 that posted, an attestation at an older request expiry, a suppressed closing timer', () => {
  const later = '2026-11-25T12:00:00-05:00';
  const mixed = () => {
    const s = S.base();
    S.claim(s, { claim_id: 'cl-6', member_id: 'm-1', provider_id: 'pv-3', received_at: '2026-11-12T12:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-11', 15000), S.line('ln-2', 2, 'svc-office-visit', '2026-11-11', 21000)] });
    const e = S.process(s, 'cl-6', [S.denied('ln-1', 'prior_auth_missing', 15000), S.paid('ln-2', 18000, { copay: 2500 }, 21000)]);
    S.window(s, 'claim', 'cl-6', e.issued_at);
    const ap = S.openAppeal({ type: 'claim', id: 'cl-6' }, 'under_review', S.finalize(s));
    const decided = '2026-11-18T10:00:00-05:00';
    Object.assign(A(ap, 'ap-1'), { status: 'overturned', decided_at: decided, outcome: { lines: ['ln-1'], units: null, valid_until: null }, appeal_version: 1 });
    S.post(ap, { eob_id: 'eob-' + (Number(ap.issued.eob) + 1), claim_id: 'cl-6', version: 2, issued_at: decided, reason: 'appeal', appeal_id: 'ap-1', lines: [S.paid('ln-1', 15000, { copay: 3500 }, 15000), structuredClone(V(ap, 'cl-6').lines[1])] });
    S.claim(ap, { claim_id: 'cl-8', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-19T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-18', 21000)] });
    S.process(ap, 'cl-8', [S.paid('ln-1', 18000, { copay: 2500 }, 21000)]);
    return S.finalize(ap);
  };
  const s = mixed();
  L(s, later);
  assert.deepEqual(V(s, 'cl-8').ledger_before['2026'].member, { deductible_cents: 0, oop_cents: 8500 });
  R(E(mixed(), x => { V(x, 'cl-8').ledger_before['2026'].member.oop_cents = 11000; }), /ledger before posting does not equal the running ledger/, later);
  const crossing = () => {
    const x = S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b', received_at: '2026-11-17T09:00:00-05:00', service_date: '2026-11-16' });
    const [old, young] = x.info_requests, t = old.expires_at;
    Object.assign(old, { status: 'expired', request_version: 1 });
    Object.assign(young, { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    Object.assign(x.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    Object.assign(C(x, 'cl-a'), { status: 'processed', processed_at: t });
    const e = S.post(x, { eob_id: 'eob-' + (Number(x.issued.eob) + 1), claim_id: 'cl-a', version: 1, issued_at: t, reason: 'initial', appeal_id: null, lines: [S.denied('ln-1', 'missing_information', 21000)] });
    S.window(x, 'claim', 'cl-a', e.issued_at);
    Object.assign(C(x, 'cl-b'), { status: 'processed', processed_at: t });
    S.post(x, { eob_id: 'eob-' + (Number(x.issued.eob) + 1), claim_id: 'cl-b', version: 1, issued_at: t, reason: 'initial', appeal_id: null, lines: [S.paid('ln-1', 18000, { copay: 2500 }, 21000)] });
    return S.finalize(x);
  };
  L(crossing(), '2027-01-01T12:00:00-05:00');
  const upheld = S.edit(S.openAppeal(), x => { Object.assign(A(x, 'ap-1'), { status: 'upheld', decided_at: '2026-11-17T10:00:00-05:00', appeal_version: 1 }); x.windows[0].closing.done = true; });
  R(upheld, /records window of cl-3 closing at .*, after the App's current time/);
});

test('T02c timers before actions at one instant, a used PA with a missing or malformed mark, same-instant receipts in one attestation', () => {
  const equal = order => {
    const s = S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a', received_at: '2026-11-12T10:00:00-05:00', service_date: '2026-11-10' });
    const t = C(s, 'cl-a').review_at;
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    Object.assign(s.info_requests[0], { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    Object.assign(C(s, 'cl-a'), { status: 'processed', processed_at: t });
    S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: 'cl-a', version: 1, issued_at: t, reason: 'initial', appeal_id: null, lines: [S.paid('ln-1', 18000, { copay: 2500 }, 21000)] });
    if (order === 'action first') s.eobs.reverse();
    return S.finalize(s);
  };
  L(equal('timer first'));
  R(equal('action first'), /was posted by a timer at .* after an action at that instant; timers run first/);
  R(E(S.paUsed(), s => { P(s, 'pa-1').approved_after_post = null; }), /names a PA approved after it posted/);
  R(E(S.paUsed(), s => { P(s, 'pa-1').approved_after_post = 'x'; }), /names a PA approved after it posted/);
  const same = () => {
    const s = S.pendingCob('m-2', 2026, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a' }), false, { claim_id: 'cl-b' });
    const t = '2026-11-18T10:00:00-05:00';
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    for (const r of s.info_requests) Object.assign(r, { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    for (const id of ['cl-a', 'cl-b']) { Object.assign(C(s, id), { status: 'processed', processed_at: t }); S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: id, version: 1, issued_at: t, reason: 'initial', appeal_id: null, lines: [S.paid('ln-1', 18000, { copay: 2500 }, 21000)] }); }
    return S.finalize(s);
  };
  L(same());
});

test('T02c the spec gr-2 beside a local gr-1, a minor account holder, an approval and an attestation at review_at in either order', () => {
  L(E(S.base(), s => { s.grants.push({ grant_id: 'gr-2', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', created_at: '2026-11-18T10:00:00-05:00', expires_at: null, status: 'active', revoked_at: null }); }));
  L(E(S.base(), s => { s.grants.push({ grant_id: 'gr-2', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', created_at: '2026-11-18T10:00:00-05:00', expires_at: null, status: 'active', revoked_at: null }, { grant_id: 'gr-1', grant_version: 0, member_id: 'm-3', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'view', created_at: '2026-11-18T11:00:00-05:00', expires_at: null, status: 'active', revoked_at: null }); s.issued.gr = '1'; }));
  const minorCtx = { ...ctx(), binding: { ...ctx().binding, accounts: [{ app_id: 'larkfield-health', account_id: 'larkfield-m-3', owner_person_id: 'm-3' }] } };
  assert.doesNotThrow(() => plugin.validateSeed(minorCtx, E(S.base(), s => { s.account_id = 'larkfield-m-3'; s.owner_person_id = 'm-3'; })));
  const atReview = mark => {
    const s = S.paApproved(undefined, undefined, S.pendingCob('m-2', 2026, S.base(), false, { claim_id: 'cl-a', received_at: '2026-11-12T10:00:00-05:00', service_date: '2026-11-10' }));
    const t = C(s, 'cl-a').review_at;
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
    Object.assign(s.info_requests[0], { status: 'answered', answer: 'none', answered_at: t, request_version: 1 });
    Object.assign(C(s, 'cl-a'), { status: 'processed', processed_at: t });
    S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: 'cl-a', version: 1, issued_at: t, reason: 'initial', appeal_id: null, lines: [S.paid('ln-1', 18000, { copay: 2500 }, 21000)] });
    P(s, 'pa-1').decided_at = t;
    S.finalize(s);
    P(s, 'pa-1').approved_after_post = mark;
    return s;
  };
  L(atReview('1'));
  L(atReview('2'));
  R(atReview('0'), /approval posting mark does not match/);
});

test('T02c request outcomes, emergencies, standing coverage, closing notices, 72 hours, code points', () => {
  const answeredAt = '2026-11-18T10:00:00-05:00';
  const accident = (answer, line) => {
    const s = S.pendingCob('m-2', 2026, S.base(), true);
    Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: answeredAt });
    s.info_requests[0] = { ...s.info_requests[0], status: 'answered', answer: 'none', answered_at: answeredAt, request_version: 1 };
    s.info_requests[1] = { ...s.info_requests[1], status: 'answered', answer, answered_at: answeredAt, request_version: 1 };
    Object.assign(C(s, 'cl-4'), { status: 'processed', processed_at: answeredAt });
    const e = S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: 'cl-4', version: 1, issued_at: answeredAt, reason: 'initial', appeal_id: null, lines: [line] });
    if (line.status === 'denied') S.window(s, 'claim', 'cl-4', e.issued_at);
    return S.finalize(s);
  };
  L(accident('work_related', S.denied('ln-1', 'other_party_liable', 21000)));
  R(accident('work_related', S.denied('ln-1', 'missing_information', 21000)), /outcome does not follow its requests, network and PA rules/);
  L(accident('not_accident', S.paid('ln-1', 18000, { copay: 2500 }, 21000)));
  const er = (service, provider, emergency, line) => {
    const s = S.base();
    S.claim(s, { claim_id: 'cl-e', member_id: 'm-1', provider_id: provider, received_at: '2026-11-12T12:00:00-05:00', lines: [S.line('ln-1', 1, service, '2026-11-11', 250000, { emergency })] });
    const e = S.process(s, 'cl-e', [line]);
    if (line.status === 'denied') S.window(s, 'claim', 'cl-e', e.issued_at);
    return S.finalize(s);
  };
  L(er('svc-er-visit', 'pv-5', true, S.paid('ln-1', 220000, { copay: 25000 }, 250000)));
  R(er('svc-er-visit', 'pv-5', false, S.paid('ln-1', 220000, { copay: 25000 }, 250000)), /outcome does not follow its requests, network and PA rules/);
  L(er('svc-physical-therapy', 'pv-3', true, S.paid('ln-1', 15000, { copay: 3500 }, 250000)));
  R(er('svc-physical-therapy', 'pv-3', false, S.paid('ln-1', 15000, { copay: 3500 }, 250000)), /paid PA-listed line without a PA/);
  const standing = () => { const s = S.base(); Object.assign(s.coverage.find(c => c.member_id === 'm-1' && c.plan_year === 2026), { status: 'other_primary' });
    S.claim(s, { claim_id: 'cl-s', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-13T12:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-12', 21000)] });
    const e = S.process(s, 'cl-s', [S.denied('ln-1', 'other_party_liable', 21000)]); S.window(s, 'claim', 'cl-s', e.issued_at); s.eobs[0].lines[0] = S.denied('ln-1', 'other_party_liable', 21000); s.eobs[0].postings[0].oop_cents = 0; S.window(s, 'claim', 'cl-1', s.eobs[0].issued_at); return S.finalize(s); };
  L(standing());
  R(E(standing(), s => { C(s, 'cl-s').lines[0].possible_accident = true; s.info_requests.push({ info_request_id: 'ir-1', request_version: 1, type: 'accident', claim_id: 'cl-s', line_id: 'ln-1', plan_year: 2026, opened_at: C(s, 'cl-s').review_at, expires_at: S.due(C(s, 'cl-s').review_at, 45), status: 'answered', answer: 'not_accident', answered_at: C(s, 'cl-s').review_at }); s.issued.ir = '1'; }), /Claim cl-s carries requests other than those its review opens/);
  const after = '2027-05-01T12:00:00-04:00';
  const closing = (seed, notice) => E(seed, s => { const w = s.windows[0]; w.closing.done = true; w.closing.notice_at = notice ? w.closing.due_at : null; });
  L(closing(S.deniedPa(), true), after);
  R(closing(S.deniedPa(), false), /closing notice does not match whether the target was appealable/, after);
  const decidedAppeal = at => E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { status: 'upheld', decided_at: at ?? '2026-11-17T10:00:00-05:00', appeal_version: 1 }); });
  L(closing(decidedAppeal(), false), after);
  R(closing(decidedAppeal(), true), /closing notice does not match whether the target was appealable/, after);
  const atClosing = S.deniedClaim().windows[0].closing.due_at;
  L(closing(E(decidedAppeal(atClosing), s => { Object.assign(A(s, 'ap-1'), { overdue: true, overdue_at: A(s, 'ap-1').due_at }); }), true), after);
  const fastDue = h => E(S.paPending(), s => { const p = P(s, 'pa-2'); Object.assign(p, { expedite: { requested_at: '2026-11-17T09:00:00-05:00', reason: null, status: 'approved', decided_at: '2026-11-17T10:00:00-05:00' }, due_at: toIso(Date.parse('2026-11-17T09:00:00-05:00') + h * 3600000) }); });
  L(fastDue(72));
  R(fastDue(71), /decision due time is not 15 days after submission, or the earlier expedited time/);
  const fastAppeal = h => E(S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', undefined, { expedited: true }), s => { A(s, 'ap-1').due_at = toIso(Date.parse(A(s, 'ap-1').filed_at) + h * 3600000); });
  L(fastAppeal(72));
  R(fastAppeal(71), /due time does not follow its filing/);
  const astral = n => E(S.openAppeal(), s => { A(s, 'ap-1').statements[0].text = '\u{1F600}'.repeat(n); });
  L(astral(2000));
  R(astral(2001), /statement or request text outside 1 to 2,000/);
  R(E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { overdue: true, overdue_at: '2026-11-17T10:00:00-05:00' }); }), /overdue flag and time disagree/);
});

test('T02c a same-instant timer posting uses units before a covered submission; a re-priced line never names a PA', () => {
  const covered = units => E(S.paUsed(), s => { const p = P(s, 'pa-1'); p.approved.units = units; p.covered_submissions.push({ pa_id: 'pa-9', provider_id: 'pv-3', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31', at: V(s, 'cl-5').issued_at }); });
  R(covered(1), /asks for more units than remained/);
  L(covered(2));
  const ap = S.openAppeal({ type: 'claim', id: 'cl-6' }, 'under_review', S.finalize(E(S.base(), x => {
    x.pas.push({ pa_id: 'pa-7', pa_version: 1, member_id: 'm-1', provider_id: 'pv-3', service_id: 'svc-physical-therapy', status: 'approved', submitted_at: '2026-11-02T09:00:00-05:00', requested: { units: 2, valid_from: '2026-11-01', valid_until: '2026-12-31' },
      approved: { units: 2, valid_from: '2026-11-01', valid_until: '2026-12-31' }, approved_after_post: '0', units_used: 0, info_requests: [], expedite: null, due_at: S.due('2026-11-02T09:00:00-05:00', 15), overdue: false, overdue_at: null, decided_at: '2026-11-05T10:00:00-05:00', expired_at: null, denial_notice_at: null, covered_submissions: [] });
    S.claim(x, { claim_id: 'cl-6', member_id: 'm-1', provider_id: 'pv-4', received_at: '2026-11-12T12:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-11', 15000)] });
    Object.assign(x.coverage.find(c => c.member_id === 'm-1' && c.plan_year === 2026), { status: 'other_primary' });
    x.eobs[0].lines[0] = S.denied('ln-1', 'other_party_liable', 21000); x.eobs[0].postings[0].oop_cents = 0; S.window(x, 'claim', 'cl-1', x.eobs[0].issued_at);
    const v = S.process(x, 'cl-6', [S.denied('ln-1', 'other_party_liable', 15000)]);
    S.window(x, 'claim', 'cl-6', v.issued_at);
  })));
  const decided = '2026-11-18T10:00:00-05:00';
  Object.assign(A(ap, 'ap-1'), { status: 'overturned', decided_at: decided, outcome: { lines: ['ln-1'], units: null, valid_until: null }, appeal_version: 1 });
  S.post(ap, { eob_id: 'eob-' + (Number(ap.issued.eob) + 1), claim_id: 'cl-6', version: 2, issued_at: decided, reason: 'appeal', appeal_id: 'ap-1', lines: [S.paid('ln-1', 15000, { copay: 3500 }, 15000, { id: 'pa-7', units: 1 })] });
  P(ap, 'pa-7').units_used = 1;
  R(S.finalize(ap), /line ln-1 was not a denied line repriced as covered without a PA/);
});
