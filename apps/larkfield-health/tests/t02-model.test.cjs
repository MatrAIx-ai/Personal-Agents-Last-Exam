'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const S = require('./seeds.cjs');
const { ms, dayDeadline, planYear, endOfDay } = require('../src/time.cjs');

const ctx = (now = '2026-11-18T12:00:00-05:00') => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now, binding: structuredClone(require('../fixtures/binding.json')) });
const loads = (s, now) => assert.doesNotThrow(() => plugin.validateSeed(ctx(now), s));
const rejects = (s, pattern, now) => assert.throws(() => plugin.validateSeed(ctx(now), s), e => e.code === 'invalid_seed' && pattern.test(e.message), String(pattern));
const find = (list, key, id) => list.find(r => r[key] === id);
const claimOf = (s, id) => find(s.claims, 'claim_id', id);
const eobOf = (s, claim, version = 1) => s.eobs.find(e => e.claim_id === claim && e.version === version);
const paOf = (s, id) => find(s.pas, 'pa_id', id);

test('T02 day deadlines end at 23:59 local across both DST changes and the year end', () => {
  assert.equal(dayDeadline('2026-03-07T12:00:00-05:00', 1), ms('2026-03-08T23:59:00-04:00'));
  assert.equal(dayDeadline('2026-10-31T12:00:00-04:00', 1), ms('2026-11-01T23:59:00-05:00'));
  assert.equal(dayDeadline('2026-12-30T23:30:00-05:00', 3), ms('2027-01-02T23:59:00-05:00'));
  assert.equal(dayDeadline('2026-03-08T01:30:00-05:00', 0), ms('2026-03-08T23:59:00-04:00'));
  assert.deepEqual([planYear('2025-12-31'), planYear('2026-01-01'), planYear('2027-06-30')], [2025, 2026, 2027]);
  assert.equal(endOfDay('2027-02-28'), ms('2027-02-28T23:59:00-05:00'));
});

test('T02 every seed builder loads, alone and combined', () => {
  for (const s of [S.base(), S.deniedClaim(), S.openAppeal(), S.overturned(), S.paApproved(), S.paUsed(), S.paPending(), S.paPending('info_requested'), S.deniedPa(), S.pendingCob(), S.pendingCob('m-2', 2026, undefined, true), S.received(), S.granted(), S.full(), S.overturned(undefined, undefined, S.full())]) loads(s);
});

test('T02 references, binding and plan structure', () => {
  rejects(S.edit(S.full(), s => { claimOf(s, 'cl-2').member_id = 'm-9'; }), /unknown member m-9/);
  rejects(S.edit(S.full(), s => { claimOf(s, 'cl-2').provider_id = 'pv-9'; }), /unknown provider pv-9/);
  rejects(S.edit(S.full(), s => { claimOf(s, 'cl-2').lines[0].service_id = 'svc-x'; }), /unknown service svc-x/);
  rejects(S.edit(S.base(), s => { s.services[0].fee_cents = null; }), /has no fee/);
  rejects(S.edit(S.base(), s => { s.members.push({ ...s.members[1], member_id: 'm-9' }); }), /not in the run binding/);
  rejects(S.edit(S.base(), s => { s.plan.years['2026'].copays.dental = 100; }), /unknown category dental/);
  rejects(S.edit(S.base(), s => { s.plan.pa_services.push('svc-x'); }), /PA list names an unknown service/);
  rejects(S.edit(S.base(), s => { s.issued.zz = '1'; }), /Unknown counter zz/);
  rejects(S.edit(S.base(), s => { s.members[2].guardian_ids = []; }), /has no guardian/);
  rejects(S.edit(S.base(), s => { s.members[1].guardian_ids = ['m-1']; }), /Adult member m-2 has guardians/);
  rejects(S.edit(S.base(), s => { s.members[0].enrolled_years.push(2030); }), /does not cover/);
});

test('T02 coverage records: one per enrolled member year, attestation matching status', () => {
  rejects(S.edit(S.base(), s => { s.coverage.pop(); }), /no coverage record/);
  rejects(S.edit(S.base(), s => { s.coverage.push(structuredClone(s.coverage[0])); }), /recorded twice/);
  rejects(S.edit(S.base(), s => { s.coverage[0].status = 'none'; }), /attestation time that does not match/);
});

test('T02 claims: review time, line positions, receipt order and counters', () => {
  rejects(S.edit(S.full(), s => { claimOf(s, 'cl-2').review_at = '2026-11-20T23:00:00-05:00'; }), /review time is not 23:59/);
  rejects(S.edit(S.deniedClaim(), s => { const c = claimOf(s, 'cl-3'); c.lines[0].position = 2; c.lines[1].position = 1; }), /not at position/);
  rejects(S.edit(S.full(), s => { claimOf(s, 'cl-2').received_seq = '1'; }), /repeats received_seq/);
  rejects(S.edit(S.full(), s => { claimOf(s, 'cl-2').received_seq = '9'; }), /received_seq above the issued counter/);
  rejects(S.edit(S.full(), s => { claimOf(s, 'cl-2').received_seq = '0'; }), /Claim receipt sequence .* is dated before/);
  rejects(S.edit(S.received(), s => { claimOf(s, 'cl-2').lines[0].service_date = '2026-11-18'; }), /dated after receipt/);
  rejects(S.edit(S.received(), s => { claimOf(s, 'cl-2').lines[0].service_date = '2026-02-30'; }), /invalid service date/);
  rejects(S.edit(S.received(), s => { claimOf(s, 'cl-2').lines[0].service_id = 'svc-adalimumab-40'; }), /pharmacy service/);
  rejects(S.edit(S.received(), s => { claimOf(s, 'cl-2').lines.push({ ...claimOf(s, 'cl-2').lines[0], position: 2 }); }), /repeats line ln-1/);
});

test('T02 information requests: exactly the requests the review opens', () => {
  rejects(S.edit(S.pendingCob(), s => { s.info_requests[0].status = 'expired'; }), /pending information without an open request/);
  rejects(S.edit(S.pendingCob(), s => { s.info_requests.push({ ...s.info_requests[0], info_request_id: 'ir-2', type: 'accident' }); s.issued.ir = '2'; }), /other than those its review opens/);
  rejects(S.edit(S.pendingCob('m-2', 2026, undefined, true), s => { s.info_requests.pop(); }), /other than those its review opens/);
  rejects(S.edit(S.pendingCob('m-2', 2026, undefined, true), s => { s.info_requests.push({ ...s.info_requests[1], info_request_id: 'ir-3' }); s.issued.ir = '3'; }), /repeats a request of its type/);
  rejects(S.edit(S.pendingCob(), s => { Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-11-01T10:00:00-05:00' }); }), /still open although coverage/);
  rejects(S.edit(S.pendingCob(), s => { s.info_requests[0].expires_at = '2026-12-30T23:59:00-05:00'; }), /expiry is not 23:59 local 45 days/);
  rejects(S.edit(S.pendingCob(), s => { s.info_requests[0].opened_at = '2026-11-15T23:59:00-05:00'; }), /not opened at its claim's review/);
  rejects(S.edit(S.pendingCob(), s => { s.info_requests[0].answer = 'none'; }), /carries an answer while open/);
  rejects(S.edit(S.pendingCob(), s => { s.info_requests[0].line_id = 'ln-7'; }), /unknown line ln-7/);
});

test('T02 an attestation at exactly review_at counts as unknown at the review', () => {
  const s = S.pendingCob();
  Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: claimOf(s, 'cl-4').review_at });
  Object.assign(s.info_requests[0], { status: 'answered', answer: 'none', answered_at: claimOf(s, 'cl-4').review_at, request_version: 1 });
  Object.assign(claimOf(s, 'cl-4'), { status: 'processed', processed_at: claimOf(s, 'cl-4').review_at });
  S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: 'cl-4', version: 1, issued_at: claimOf(s, 'cl-4').review_at, reason: 'initial', appeal_id: null, lines: [S.paid('ln-1', 18000, { copay: 2500 }, 21000)] });
  S.finalize(s);
  loads(s);
  rejects(S.edit(structuredClone(s), x => { x.info_requests[0].answer = 'other_secondary'; }), /answer differs from the attestation/);
  rejects(S.edit(structuredClone(s), x => { claimOf(x, 'cl-4').processed_at = '2026-11-17T09:00:00-05:00'; eobOf(x, 'cl-4').issued_at = '2026-11-17T09:00:00-05:00'; }), /processed at .* not when its review or its last request closed/);
});

test('T02 EOB structure, line arithmetic and postings', () => {
  rejects(S.edit(S.deniedClaim(), s => { const e = eobOf(s, 'cl-3'); e.lines = [e.lines[0], structuredClone(e.lines[0])]; }), /exactly once/);
  rejects(S.edit(S.base(), s => { const l = eobOf(s, 'cl-1').lines[0]; l.copay_cents = 2000; l.coinsurance_cents = 500; }), /copay line carries/);
  rejects(S.edit(S.base(), s => { eobOf(s, 'cl-1').postings[0].oop_cents = 3000; s.accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026).oop_cents = 3000; }), /postings are not the sums/);
  rejects(S.edit(S.base(), s => { s.accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026).oop_cents = 3000; }), /does not equal the sum of its current EOB postings/);
  rejects(S.edit(S.base(), s => { const l = eobOf(s, 'cl-1').lines[0]; l.plan_paid_cents -= 100; l.not_allowed_cents += 100; }), /not-allowed amount does not match the billed and allowed amounts/);
  rejects(S.edit(S.base(), s => { eobOf(s, 'cl-1').lines[0].allowed_cents = 21000; }), /allowed amount is not the lesser of billed and fee times units/);
  rejects(S.edit(S.deniedClaim(), s => { eobOf(s, 'cl-3').lines[0].reason = null; }), /denied with a missing reason/);
  rejects(S.edit(S.deniedClaim(), s => { eobOf(s, 'cl-3').lines[0].reason = 'prior_auth_missing'; }), /outcome does not follow/);
  rejects(S.edit(S.full(), s => { eobOf(s, 'cl-3').ledger_before['2026'].family.oop_cents = 0; }), /ledger before posting does not equal the running ledger/);
  rejects(S.edit(S.full(), s => { eobOf(s, 'cl-1').posting_seq = '2'; eobOf(s, 'cl-3').posting_seq = '1'; }), /ledger before posting/);
  rejects(S.edit(S.full(), s => { eobOf(s, 'cl-3').posting_seq = '3'; eobOf(s, 'cl-5').posting_seq = '2'; }), /EOB posting sequence 3 is dated before sequence 2/);
});

test('T02 later EOB versions: copied lines verbatim, only the overturned lines change, the ledger advances by the difference', () => {
  const s = S.overturned(undefined, undefined, S.full());
  loads(s);
  const v2 = eobOf(s, 'cl-3', 2);
  assert.deepEqual(v2.ledger_before['2026'].member, { deductible_cents: 0, oop_cents: 2500 });
  assert.deepEqual(s.accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026), { member_id: 'm-1', plan_year: 2026, deductible_cents: 150000, oop_cents: 157500 });
  loads(S.overturned(['ln-1'], undefined, S.full()));
  rejects(S.edit(S.overturned(undefined, undefined, S.full()), x => { const v2 = eobOf(x, 'cl-3', 2); v2.lines[1] = structuredClone(eobOf(x, 'cl-3', 1).lines[1]); Object.assign(v2.postings[0], { deductible_cents: v2.lines.reduce((t, l) => t + l.deductible_cents, 0), oop_cents: v2.lines.reduce((t, l) => t + l.member_cost_cents, 0) }); S.finalize(x); }), /changes lines other than those its appeal overturned/);
  rejects(S.edit(S.overturned(undefined, undefined, S.full()), x => { find(x.appeals, 'appeal_id', 'ap-1').outcome.lines = ['ln-1']; }), /changes lines other than/);
  rejects(S.edit(S.overturned(undefined, undefined, S.full()), x => { x.eobs = x.eobs.filter(e => !(e.claim_id === 'cl-3' && e.version === 2)); }), /Overturned appeal ap-1 does not have exactly one EOB version/);
  rejects(S.edit(S.overturned(undefined, undefined, S.full()), x => { eobOf(x, 'cl-3', 2).lines[0].pa_id = 'pa-1'; eobOf(x, 'cl-3', 2).lines[0].pa_units = 1; }), /uses a PA although it is an emergency or not PA-listed/);
});

test('T02 PAs: units, intervals, expiry and the approval posting mark', () => {
  rejects(S.edit(S.paUsed(), s => { eobOf(s, 'cl-5').lines[0].pa_id = null; eobOf(s, 'cl-5').lines[0].pa_units = 0; paOf(s, 'pa-1').units_used = 0; }), /paid PA-listed line without a PA/);
  rejects(S.edit(S.paUsed(), s => { claimOf(s, 'cl-5').lines[0].emergency = true; }), /uses a PA although it is an emergency/);
  rejects(S.edit(S.paUsed(), s => { paOf(s, 'pa-1').units_used = 13; }), /units used differ/);
  rejects(S.edit(S.paApproved(), s => { paOf(s, 'pa-1').approved.valid_from = '2027-03-01'; }), /inverted approved interval/);
  rejects(S.edit(S.paApproved(), s => { Object.assign(paOf(s, 'pa-1'), { status: 'expired', expired_at: '2026-11-10T10:00:00-05:00' }); }), /expired at neither/);
  rejects(S.edit(S.paUsed(), s => { paOf(s, 'pa-1').approved_after_post = '1'; }), /approval posting mark does not match/);
  rejects(S.edit(S.paApproved(), s => { paOf(s, 'pa-1').approved_after_post = null; }), /posting mark does not match its approved terms/);
  rejects(S.edit(S.paPending(), s => { paOf(s, 'pa-2').due_at = '2026-12-02T23:59:00-05:00'; }), /decision due time/);
  rejects(S.edit(S.paPending(), s => { paOf(s, 'pa-2').status = 'info_requested'; }), /waiting for information it never requested/);
  rejects(S.edit(S.deniedPa(), s => { paOf(s, 'pa-3').denial_notice_at = '2026-11-10T11:00:00-05:00'; }), /denial notice is not dated at its decision/);
  const expired = S.edit(S.paApproved(), s => { Object.assign(paOf(s, 'pa-1'), { status: 'expired', approved: { units: 12, valid_from: '2026-11-05', valid_until: '2026-11-04' }, expired_at: '2026-11-05T10:00:00-05:00' }); });
  loads(expired);
});

test('T02 appeals: windows, chains on one target and same-instant refiling', () => {
  rejects(S.edit(S.openAppeal(), s => { s.windows = []; }), /has no appeal window/);
  rejects(S.edit(S.openAppeal(), s => { s.windows[0].closing.due_at = s.windows[0].ends_at; }), /closing notice is not due 14 days/);
  rejects(S.edit(S.openAppeal(), s => { s.appeals[0].lines = ['ln-1']; }), /not the denied lines/);
  rejects(S.edit(S.openAppeal(), s => { s.appeals[0].due_at = s.appeals[0].filed_at; }), /not due 60 days/);
  rejects(S.edit(S.openAppeal(), s => { s.appeals[0].statements = []; }), /no filing statement/);
  rejects(S.openAppeal(undefined, 'under_review', S.openAppeal(), { filed_at: '2026-11-17T10:00:00-05:00' }), /was filed while ap-1 was open/);
  rejects(S.edit(S.openAppeal(), s => { Object.assign(s.appeals[0], { status: 'overturned', decided_at: '2026-11-18T10:00:00-05:00', outcome: { lines: ['ln-1'], units: null, valid_until: null } }); }), /exactly one EOB version/);
  const withdrawn = S.edit(S.openAppeal(), s => { Object.assign(s.appeals[0], { status: 'withdrawn', withdrawn_at: '2026-11-17T10:00:00-05:00', appeal_version: 1 }); });
  loads(S.openAppeal(undefined, 'under_review', withdrawn, { filed_at: '2026-11-17T11:00:00-05:00' }));
  const instant = '2026-11-17T09:00:00-05:00';
  const chain = S.openAppeal(undefined, 'under_review', S.edit(S.openAppeal(), s => { Object.assign(s.appeals[0], { status: 'withdrawn', withdrawn_at: instant, appeal_version: 1 }); }), { filed_at: instant });
  loads(chain);
  loads(S.edit(structuredClone(chain), s => { s.appeals.reverse(); }));
  rejects(S.edit(structuredClone(chain), s => { s.appeals[0].filed_seq = '2'; s.appeals[1].filed_seq = '1'; }), /was filed while/);
});

test('T02 grants, approvals, notices and run-issued counters', () => {
  rejects(S.granted(S.granted()), /overlap on the pair/);
  loads(S.edit(S.granted(S.base(), 'm-2', 'view', '2026-08-01T09:00:00-04:00'), s => { S.granted(s, 'm-2', 'act'); s.grants[1].created_at = '2026-08-01T09:00:00-04:00'; }));
  rejects(S.edit(S.granted(), s => { s.grants[0].grantee_id = 'm-2'; }), /their own records/);
  rejects(S.edit(S.granted(), s => { s.grants[0].grantor_id = 'm-1'; }), /grantor may not grant/);
  rejects(S.edit(S.granted(S.base(), 'm-3'), s => { s.grants[0].grantor_id = 'm-3'; }), /grantor may not grant/);
  rejects(S.edit(S.granted(), s => { s.grants[0].status = 'revoked'; }), /revocation time does not match/);
  rejects(S.edit(S.base(), s => { s.approvals.push({ approval_id: 'cf-1', token: 'tok-7c1e', subject: null, confirmed_by: 'm-1', confirmed_at: '2026-11-18T10:00:00-05:00', used_at: '2026-11-18T10:30:00-05:00' }); s.issued.cf = '1'; }), /used outside its 30 minutes/);
  rejects(S.edit(S.base(), s => { s.approvals.push({ approval_id: 'cf-2', token: 'tok-7c1e', subject: null, confirmed_by: 'm-1', confirmed_at: '2026-11-18T10:00:00-05:00', used_at: null }); s.issued.cf = '1'; }), /cf-2 is above the issued cf counter/);
  rejects(S.edit(S.pendingCob(), s => { s.info_requests[0].info_request_id = 'ir-2'; }), /ir-2 is above the issued ir counter/);
  rejects(S.edit(S.base(), s => { s.notices.push({ notice_id: 'n-1', kind: 'notice.eob_available', recipient_id: 'p-9', subject: { type: 'claim', id: 'cl-1' }, member_id: 'm-1', at: '2026-11-15T23:59:00-05:00', title: 'EOB', body: 'EOB ready', fields: {} }); s.issued.n = '1'; }), /recipient p-9/);
});

test('T02 key order, same-instant overturn, posting marks, covered units, grant order, filing sequences, policy outcomes', () => {
  const reordered = S.edit(S.full(), s => { for (const e of s.eobs) { for (const y of Object.keys(e.ledger_before)) { const { member, family } = e.ledger_before[y]; e.ledger_before[y] = { family, member }; } e.postings = e.postings.map(({ oop_cents, deductible_cents, plan_year, member_id }) => ({ oop_cents, deductible_cents, plan_year, member_id })); } });
  loads(reordered);
  rejects(S.edit(reordered, s => { eobOf(s, 'cl-3').ledger_before['2026'].family.oop_cents += 1; }), /ledger before posting/);
  loads(S.overturned(['ln-1', 'ln-2'], '2026-11-17T09:00:00-05:00', S.openAppeal()));
  rejects(S.edit(S.paUsed(), s => { paOf(s, 'pa-1').decided_at = '2026-11-17T10:00:00-05:00'; }), /approval posting mark does not match/);
  const atReview = mark => S.edit(S.paApproved(), s => { Object.assign(paOf(s, 'pa-1'), { decided_at: claimOf(s, 'cl-1').review_at, approved_after_post: mark }); });
  rejects(atReview('0'), /approval posting mark does not match/);
  loads(atReview('1'));
  rejects(S.edit(S.paApproved(3), s => { paOf(s, 'pa-1').covered_submissions.push({ pa_id: 'pa-9', provider_id: 'pv-3', units: 4, valid_from: '2026-12-01', valid_until: '2026-12-31', at: '2026-11-10T09:00:00-05:00' }); }), /more units than remained/);
  loads(S.edit(S.paApproved(3), s => { paOf(s, 'pa-1').covered_submissions.push({ pa_id: 'pa-9', provider_id: 'pv-3', units: 3, valid_from: '2026-12-01', valid_until: '2026-12-31', at: '2026-11-10T09:00:00-05:00' }); }));
  const t = '2026-08-01T09:00:00-04:00';
  const regrant = S.edit(S.granted(S.granted()), s => { Object.assign(s.grants[0], { created_at: t, status: 'revoked', revoked_at: t }); s.grants[1].created_at = t; });
  loads(regrant);
  loads(S.edit(structuredClone(regrant), s => { s.grants.reverse(); }));
  rejects(S.edit(S.openAppeal(undefined, 'under_review', S.edit(S.openAppeal(), s => { Object.assign(s.appeals[0], { status: 'withdrawn', withdrawn_at: '2026-11-17T09:00:00-05:00', appeal_version: 1 }); }), { filed_at: '2026-11-17T09:00:00-05:00' }), s => { s.appeals[1].filed_seq = s.appeals[0].filed_seq; }), /filing sequence repeats/);
  rejects(S.edit(S.base(), s => { const e = eobOf(s, 'cl-1'); e.lines = [S.denied('ln-1', 'out_of_network', 21000)]; e.postings[0].oop_cents = 0; s.accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026).oop_cents = 0; }), /outcome does not follow/);
});

test('T02 seed-wide cutoff: nothing recorded after now, nor at or after the earliest pending timer', () => {
  rejects(S.edit(S.granted(), s => { s.grants[0].created_at = '2026-11-19T09:00:00-05:00'; }), /after the App's current time/);
  const later = '2026-11-25T12:00:00-05:00';
  loads(S.received(), later);
  rejects(S.edit(S.received(), s => { S.granted(s); s.grants[0].created_at = '2026-11-22T09:00:00-05:00'; }), /not before its earliest pending timer/, later);
  rejects(S.edit(S.received(), s => { S.granted(s); s.grants[0].created_at = claimOf(s, 'cl-2').review_at; }), /not before its earliest pending timer/, later);
  rejects(S.edit(S.received(), s => { Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-11-21T09:00:00-05:00' }); }), /not before its earliest pending timer/, later);
});

test('T02 counters at the envelope limit commit, the post-write state validates and the next value has 15 digits', () => {
  const { fixture } = require('./harness.cjs');
  const top = '100000000000000';
  const seed = S.edit(S.base(), s => { claimOf(s, 'cl-1').received_seq = top; eobOf(s, 'cl-1').posting_seq = top; s.issued = { seq: top, post: top, eob: '1' }; });
  const f = fixture({ seed });
  assert.equal(f.event(require('../examples/scenario.json')).status, 'committed');
  const after = f.data();
  assert.equal(claimOf(after, 'cl-7').received_seq, '100000000000001');
  assert.equal(after.issued.seq, '100000000000001');
  loads(after, '2026-12-01T09:00:00-05:00');
  rejects(S.edit(structuredClone(after), s => { claimOf(s, 'cl-7').received_seq = '1000000000000001'; s.issued.seq = '1000000000000001'; }), /Counter seq is not a decimal string/, '2026-12-01T09:00:00-05:00');
});

test('T02 time helpers: 72 hours across DST, the clock bounds and millisecond instants', () => {
  const { hoursAfter, clockInRange, runInRange, toIso, CLOCK_MAX, RUN_MAX } = require('../src/time.cjs');
  assert.equal(toIso(hoursAfter('2026-03-06T12:00:00-05:00', 72)), '2026-03-09T13:00:00-04:00');
  assert.equal(toIso(hoursAfter('2026-10-30T12:00:00-04:00', 72)), '2026-11-02T11:00:00-05:00');
  assert.equal(toIso(Date.parse('2026-11-18T12:00:00.123-05:00')), '2026-11-18T12:00:00.123-05:00');
  assert.deepEqual([clockInRange('2000-01-01T00:00:00-05:00'), clockInRange('1999-12-31T23:59:59.999-05:00'), clockInRange('2199-12-31T23:59:59.999-05:00'), clockInRange('2200-01-01T00:00:00-05:00')], [true, false, true, false]);
  assert.deepEqual([runInRange('2200-12-31T23:59:59.999-05:00'), runInRange('2201-01-01T00:00:00-05:00')], [true, false]);
  assert.ok(RUN_MAX > CLOCK_MAX);
});
