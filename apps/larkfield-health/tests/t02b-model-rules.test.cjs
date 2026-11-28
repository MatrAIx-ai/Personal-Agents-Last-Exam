'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const S = require('./seeds.cjs');

const ctx = now => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now ?? '2026-11-18T12:00:00-05:00', binding: structuredClone(require('../fixtures/binding.json')) });
const R = (s, pattern, now) => assert.throws(() => plugin.validateSeed(ctx(now), s), e => e.code === 'invalid_seed' && pattern.test(e.message), String(pattern));
const L = (s, now) => assert.doesNotThrow(() => plugin.validateSeed(ctx(now), s));
const E = S.edit;
const C = (s, id) => s.claims.find(c => c.claim_id === id), V = (s, claim, v = 1) => s.eobs.find(e => e.claim_id === claim && e.version === v);
const P = (s, id) => s.pas.find(p => p.pa_id === id), A = (s, id) => s.appeals.find(a => a.appeal_id === id);
const cov = (s, m, y) => s.coverage.find(c => c.member_id === m && c.plan_year === y), acc = (s, m, y) => s.accumulators.find(a => a.member_id === m && a.plan_year === y);

test('T02b binding, plan and members: each rule on its own', () => {
  R(E(S.base(), s => { s.providers.push({ ...s.providers[0] }); }), /Duplicate provider pv-1/);
  R(E(S.base(), s => { s.account_id = 'larkfield-x'; }), /not bound in this run/);
  R(E(S.base(), s => { s.owner_person_id = 'm-2'; }), /not the bound account holder/);
  R(E(S.base(), s => { s.plan.years = {}; }), /The plan has no plan year/);
  R(E(S.base(), s => { s.plan.years['26'] = s.plan.years['2026']; }), /not a year from 2000 to 2199/);
  R(E(S.base(), s => { s.plan.years['2026'].deductible.individual_cents = 400000; }), /individual deductible above the family deductible/);
  R(E(S.base(), s => { s.plan.years['2026'].oop_max.individual_cents = 900000; }), /individual out-of-pocket maximum above the family maximum/);
  R(E(S.base(), s => { s.plan.years['2026'].deductible.family_cents = 900000; }), /deductible above its out-of-pocket maximum/);
  R(E(S.base(), s => { s.members = s.members.filter(m => m.member_id !== 'm-1'); }), /account holder is not a member/);
  R(E(S.base(), s => { s.members[0].birth_date = '1984-02-30'; }), /invalid birth date/);
  R(E(S.base(), s => { s.members[2].guardian_ids = ['m-3']; }), /their own guardian/);
  R(E(S.base(), s => { Object.assign(s.members[1], { is_minor: true, guardian_ids: ['m-1'] }); }), /Guardian m-2 of m-3 is a minor/);
  R(E(S.base(), s => { s.members[1].enrolled_years = []; }), /enrolled in no plan year/);
  R(E(S.base(), s => { s.members[1].enrolled_years = [2025, 2026]; }), /Coverage of m-2 for 2027 is for a year the member is not enrolled in/);
  R(E(S.received(), s => { s.members[1].enrolled_years = [2025, 2027]; s.coverage = s.coverage.filter(c => !(c.member_id === 'm-2' && c.plan_year === 2026)); s.accumulators = s.accumulators.filter(a => !(a.member_id === 'm-2' && a.plan_year === 2026)); }), /falls outside the member's enrolment/);
  L(E(S.base(), s => { Object.assign(s.members[2], { is_minor: true }); }));
  L(S.base(), '2201-01-01T00:00:00-05:00');
  L(S.base(), '2200-06-01T00:00:00-04:00');
});

test('T02b requests and claim states: each rule on its own', () => {
  R(E(S.pendingCob(), s => { s.info_requests[0].plan_year = 2025; }), /plan year differs from its line's service year/);
  R(E(S.pendingCob(), s => { s.info_requests[0].status = 'answered'; }), /answered without a valid answer and time/);
  R(E(S.pendingCob(), s => { Object.assign(s.info_requests[0], { status: 'answered', answer: 'none', answered_at: s.info_requests[0].expires_at }); }), /answered outside its open period/);
  R(E(S.pendingCob(), s => { s.info_requests[0].status = 'expired'; Object.assign(cov(s, 'm-2', 2026), { status: 'none', version: 1, attested_at: '2026-11-17T10:00:00-05:00' }); }), /expired although coverage was attested before its expiry/);
  R(E(S.received(), s => { C(s, 'cl-2').processed_at = '2026-11-17T12:00:00-05:00'; }), /is received but already has requests, an EOB or a processing time/);
  R(E(S.pendingCob(), s => { Object.assign(C(s, 'cl-4'), { status: 'processed', processed_at: C(s, 'cl-4').review_at }); }), /is processed with an open request or without a processing time/);
});

test('T02b EOB lines and versions: each rule on its own', () => {
  R(E(S.base(), s => { V(s, 'cl-1').lines[0].not_allowed_cents = 2999; }), /not-allowed amount does not match/);
  R(E(S.base(), s => { V(s, 'cl-1').lines[0].reason = 'out_of_network'; }), /is paid with a denial reason/);
  R(E(S.base(), s => { Object.assign(V(s, 'cl-1').lines[0], { member_cost_cents: 2400, plan_paid_cents: 15600 }); }), /member cost is not copay plus deductible plus coinsurance/);
  R(E(S.base(), s => { V(s, 'cl-1').lines[0].plan_paid_cents = 15000; }), /plan payment is not the allowed amount less the member cost/);
  R(E(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 100000 }]), s => { Object.assign(V(s, 'cl-l1').lines[0], { copay_cents: 100, deductible_cents: 99900 }); }), /deductible line carries a copay/);
  R(E(S.full(), s => { V(s, 'cl-5').posting_seq = V(s, 'cl-3').posting_seq; }), /repeats posting_seq/);
  R(E(S.base(), s => { V(s, 'cl-1').posting_seq = '2'; }), /posting_seq above the issued counter/);
  R(E(S.base(), s => { V(s, 'cl-1').ledger_before['2025'] = V(s, 'cl-1').ledger_before['2026']; }), /ledger snapshot does not cover exactly the plan years/);
  R(E(S.paUsed(), s => { V(s, 'cl-5').lines[0].pa_id = null; }), /PA units without a PA/);
  R(E(S.paUsed(), s => { V(s, 'cl-5').lines[0].pa_units = 2; }), /PA units differ from the line's units/);
  R(E(S.paUsed(), s => { P(s, 'pa-1').approved.valid_from = '2026-11-13'; }), /names a PA that does not cover it/);
  R(E(S.base(), s => { s.eobs = []; s.issued.post = '0'; }), /processed without an EOB/);
  R(E(S.overturned(), s => { V(s, 'cl-3', 2).version = 3; }), /EOB versions are not contiguous from 1/);
  R(E(S.base(), s => { V(s, 'cl-1').reason = 'appeal'; }), /is version 1 but not an initial EOB/);
  R(E(S.base(), s => { V(s, 'cl-1').issued_at = '2026-11-15T23:00:00-05:00'; }), /was not issued when its claim was processed/);
  R(E(S.overturned(), s => { V(s, 'cl-3', 2).appeal_id = null; }), /later version without its appeal/);
  R(E(S.overturned(), s => { A(s, 'ap-1').target.id = 'cl-1'; }), /names an appeal that did not overturn claim cl-3/);
  R(E(S.overturned(), s => { V(s, 'cl-3', 2).issued_at = '2026-11-18T10:30:00-05:00'; }), /was not issued when its appeal was decided/);
  R(E(S.overturned(), s => { const v2 = V(s, 'cl-3', 2); v2.lines[0] = S.denied('ln-1', 'missing_information', 180000); v2.postings[0] = { ...v2.postings[0], deductible_cents: 0, oop_cents: 5000 }; }), /was not a denied line repriced as covered without a PA/);
  const instant = '2026-11-15T23:59:00-05:00';
  const same = S.overturned(undefined, instant, S.openAppeal(undefined, undefined, undefined, { filed_at: instant }));
  L(same);
  R(E(structuredClone(same), s => { const [a, b] = [V(s, 'cl-3', 1), V(s, 'cl-3', 2)]; [a.posting_seq, b.posting_seq] = [b.posting_seq, a.posting_seq]; }), /posted before its predecessor/);
});

test('T02b accumulators and limits: each rule on its own', () => {
  R(E(S.base(), s => { s.accumulators.push({ member_id: 'm-1', plan_year: 2024, deductible_cents: 0, oop_cents: 0 }); }), /Accumulator of m-1 for 2024 is for a year the member is not enrolled in/);
  R(E(S.base(), s => { s.accumulators.push({ ...s.accumulators[0] }); }), /is recorded twice/);
  R(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 100000 }, { member: 'm-1', year: 2026, deductible_cents: 100000 }]), /outside the plan's individual limits/);
  R(E(S.base(), s => { s.accumulators.pop(); }), /has no accumulator for/);
  R(S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 140000 }, { member: 'm-2', year: 2026, deductible_cents: 140000 }, { member: 'm-3', year: 2026, deductible_cents: 140000 }]), /Family accumulators for 2026 are outside the plan's family limits/);
});

function paOverturned() {
  const s = S.openAppeal({ type: 'pa', id: 'pa-3' });
  const at = '2026-11-17T15:00:00-05:00';
  Object.assign(A(s, 'ap-1'), { status: 'overturned', decided_at: at, outcome: { lines: null, units: 1, valid_until: '2026-12-20' }, appeal_version: 1 });
  Object.assign(P(s, 'pa-3'), { status: 'approved', approved: { units: 1, valid_from: '2026-11-17', valid_until: '2026-12-20' }, decided_at: at, pa_version: 2 });
  return S.finalize(s);
}

test('T02b PAs: each rule on its own', () => {
  R(E(S.paPending(), s => { Object.assign(P(s, 'pa-2'), { service_id: 'svc-adalimumab-40' }); }), /pharmacy PA from a provider that is not a pharmacy or prescriber/);
  R(E(S.paPending(), s => { P(s, 'pa-2').requested.valid_from = '2026-02-30'; }), /invalid requested date/);
  R(E(S.paPending(), s => { P(s, 'pa-2').requested.valid_from = '2027-01-01'; }), /inverted requested interval/);
  R(E(S.paPending(), s => { P(s, 'pa-2').overdue = true; }), /overdue flag and time disagree/);
  R(E(S.deniedPa(), s => { const t = '2026-11-17T10:00:00-05:00'; Object.assign(P(s, 'pa-3'), { decided_at: t, denial_notice_at: t }); s.windows[0].notice_at = t; }), /decided at or after its due time without becoming overdue first/);
  R(E(S.paPending(), s => { P(s, 'pa-2').decided_at = '2026-11-17T10:00:00-05:00'; }), /decision time does not match its status/);
  R(E(S.deniedPa(), s => { Object.assign(P(s, 'pa-3'), { decided_at: '2026-10-01T10:00:00-04:00', denial_notice_at: '2026-10-01T10:00:00-04:00' }); }), /was decided before it was submitted/);
  R(E(S.deniedPa(), s => { Object.assign(P(s, 'pa-3'), { overdue: true, overdue_at: P(s, 'pa-3').due_at }); }), /became overdue after its decision/);
  R(E(S.paPending(), s => { P(s, 'pa-2').approved = { units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31' }; }), /approved terms do not match its status/);
  R(E(S.paApproved(), s => { P(s, 'pa-1').approved_after_post = '5'; }), /approval posting mark is above the issued counter/);
  R(E(S.paApproved(), s => { P(s, 'pa-1').expired_at = '2026-11-10T10:00:00-05:00'; }), /expiry time does not match its status/);
  R(E(S.paApproved(), s => { P(s, 'pa-1').approved.valid_until = '2027-02-30'; }), /invalid approved date/);
  R(E(S.paPending(), s => { P(s, 'pa-2').units_used = 1; }), /units used without approval/);
  R(E(S.paPending(), s => { P(s, 'pa-2').denial_notice_at = '2026-11-17T10:00:00-05:00'; }), /denial notice time does not match its status/);
  R(E(S.deniedPa(), s => { P(s, 'pa-3').denial_notice_at = '2026-11-10T11:00:00-05:00'; s.windows[0].notice_at = '2026-11-10T11:00:00-05:00'; }), /denial notice is not dated at its decision/);
  R(E(S.paPending('info_requested'), s => { P(s, 'pa-2').info_requests[0].text = ''; }), /information request before submission or with a text outside/);
  R(E(S.paPending(), s => { P(s, 'pa-2').expedite = { requested_at: '2026-11-17T09:00:00-05:00', reason: '', status: 'open', decided_at: null }; }), /expedite reason is outside/);
  R(E(S.paPending(), s => { P(s, 'pa-2').expedite = { requested_at: '2026-11-17T09:00:00-05:00', reason: null, status: 'open', decided_at: '2026-11-17T10:00:00-05:00' }; }), /expedite record is inconsistent/);
  const sub = o => ({ pa_id: 'pa-9', provider_id: 'pv-3', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31', at: '2026-11-10T09:00:00-05:00', ...o });
  R(E(S.paApproved(), s => { P(s, 'pa-1').covered_submissions.push(sub({ pa_id: 'pa-1' })); }), /repeats a PA ID/);
  R(E(S.paApproved(), s => { P(s, 'pa-1').covered_submissions.push(sub({ valid_from: '2026-10-01' })); }), /is not inside its approval/);
  R(E(S.paApproved(), s => { P(s, 'pa-1').covered_submissions.push(sub({ valid_from: '2026-11-10', valid_until: '2026-11-31' })); }), /has an invalid date or came after the approval ended/);
  L(paOverturned());
  R(E(paOverturned(), s => { P(s, 'pa-3').approved.units = 2; }), /overturn is not reflected in PA pa-3/);
});

test('T02b appeals and windows: each rule on its own', () => {
  R(E(S.openAppeal(), s => { A(s, 'ap-1').member_id = 'm-2'; }), /member differs from its target's member/);
  R(S.openAppeal(undefined, undefined, undefined, { filed_at: '2026-11-15T23:00:00-05:00' }), /filed outside its target's appeal window/);
  R(S.openAppeal(undefined, undefined, undefined, { expedited: true }), /claim appeal that is expedited or names no lines/);
  R(E(S.openAppeal({ type: 'pa', id: 'pa-3' }), s => { A(s, 'ap-1').lines = ['ln-1']; }), /PA appeal that names lines/);
  R(E(S.openAppeal({ type: 'pa', id: 'pa-3' }), s => { A(s, 'ap-1').due_at = S.due(A(s, 'ap-1').filed_at, 31); }), /due time does not follow its filing/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').overdue = true; }), /overdue flag and time disagree/);
  R(E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { status: 'withdrawn', withdrawn_at: A(s, 'ap-1').due_at }); }), /ended at or after its due time without becoming overdue first/);
  R(E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { status: 'withdrawn', withdrawn_at: '2026-11-17T10:00:00-05:00' }); A(s, 'ap-1').statements.push({ at: '2026-11-17T11:00:00-05:00', by: 'm-1', text: 'More' }); }), /records a statement or request after it ended/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').statements[0].text = ''; }), /statement or request text outside 1 to 2,000/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').status = 'upheld'; }), /decision or withdrawal time does not match its status/);
  R(E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { status: 'upheld', decided_at: '2026-11-17T10:00:00-05:00', outcome: { lines: ['ln-1'], units: null, valid_until: null } }); }), /outcome does not match its status/);
  R(E(S.openAppeal(), s => { Object.assign(A(s, 'ap-1'), { status: 'upheld', decided_at: '2026-11-17T10:00:00-05:00', overdue: true, overdue_at: A(s, 'ap-1').due_at }); }), /became overdue after it ended/);
  R(E(S.overturned(), s => { A(s, 'ap-1').outcome.units = 3; }), /outcome does not fit its target/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').statements.push({ at: '2026-11-17T08:00:00-05:00', by: 'm-1', text: 'Earlier' }); }), /statement before filing/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').statements[0].by = 'p-9'; }), /statement is by an unknown person p-9/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').info_requests.push({ at: '2026-11-17T08:00:00-05:00', text: 'Referral' }); }), /information request before filing/);
  R(E(S.openAppeal(), s => { A(s, 'ap-1').status = 'info_requested'; }), /waiting for information it never requested/);
  R(E(S.deniedClaim(), s => { s.windows.push(structuredClone(s.windows[0])); }), /is recorded twice/);
  R(E(S.deniedClaim(), s => { s.windows[0].notice_at = '2026-11-15T23:00:00-05:00'; }), /does not belong to a denial notice of its target/);
  R(E(S.deniedClaim(), s => { s.windows[0].ends_at = S.due(s.windows[0].notice_at, 181); }), /does not end 180 days after its notice/);
  R(E(S.deniedClaim(), s => { s.windows[0].closing.notice_at = s.windows[0].closing.due_at; }), /records a closing notice off its due time or while not done/);
  R(E(S.deniedClaim(), s => { s.windows[0].closing.done = true; }), /closing notice does not match whether the target was appealable/);
});

test('T02b grants, approvals and same-instant review order: each rule on its own', () => {
  R(E(S.granted(), s => { s.grants[0].grantee_id = 'p-9'; }), /grantee p-9 is not in the run binding/);
  R(E(S.granted(), s => { s.grants[0].expires_at = s.grants[0].created_at; }), /expires before it was created/);
  R(E(S.granted(), s => { Object.assign(s.grants[0], { status: 'revoked', revoked_at: '2026-05-01T09:00:00-04:00' }); }), /was revoked outside its term/);
  R(E(S.base(), s => { s.approvals.push({ approval_id: 'cf-1', token: 'tok-7c1e', subject: null, confirmed_by: 'p-9', confirmed_at: '2026-11-18T10:00:00-05:00', used_at: null }); s.issued.cf = '1'; }), /confirmed by an unknown person p-9/);
  const twin = first => {
    const s = S.base();
    for (const id of first === 'cl-10' ? ['cl-10', 'cl-9'] : ['cl-9', 'cl-10']) {
      S.claim(s, { claim_id: id, member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-12T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-lab-panel', '2026-11-10', 9000)] });
      S.process(s, id, [S.paid('ln-1', 9000, { ded: 9000 }, 9000)]);
    }
    return S.finalize(s);
  };
  L(twin('cl-10'));
  R(twin('cl-9'), /posted cl-9 before cl-10; same-instant timers run in object ID string order/);
});
