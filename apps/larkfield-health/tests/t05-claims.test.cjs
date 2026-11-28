'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const { HANDLERS } = require('../src/events.cjs');
const { compile } = require('./schema-validator.cjs');
const { bump } = require('../src/util.cjs');
const T = require('../src/tokens.cjs');
const N = require('../src/notices.cjs');
const binding = require('../fixtures/binding.json');

const P = 'larkfield-health.';
const T0 = '2026-11-18T12:00:00-05:00', REVIEW = '2026-11-21T23:59:00-05:00', AFTER = '2026-11-22T09:00:00-05:00', EXPIRY = '2027-01-05T23:59:00-05:00';
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(__dirname, '..', 'schemas'));
let n = 0;
const ev = (f, operation, payload, at = f.ctx.virtual_now) => f.event({ event_id: 'e5-' + (++n), at, operation, payload });
const ok = (f, token, by = 'm-1') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const tick = f => assert.equal(ok(f, 'tok-7c1e').status, 'committed');
const ln = (id, pos, svc, date, billed, extra) => S.line(id, pos, svc, date, billed, extra);
const receive = (f, claim_id, member_id, lines, provider_id = 'pv-1') => ev(f, 'claim.received', { claim_id, member_id, provider_id, lines: lines.map(({ position, ...l }) => l) });
const attest = (s, member, year, status = 'none', at = '2026-02-01T10:00:00-05:00') => { Object.assign(s.coverage.find(c => c.member_id === member && c.plan_year === year), { status, version: 1, attested_at: at }); return s; };
const actOn = (s = S.base(), member = 'm-2') => S.granted(s, member, 'act');
const claimOf = (f, id) => f.data().claims.find(c => c.claim_id === id);
const reqs = (f, id) => f.data().info_requests.filter(r => r.claim_id === id);
const eobsOf = (f, id) => f.data().eobs.filter(e => e.claim_id === id);
const OPS = { cob: 'coverage.cob', info: 'claims.info' };
const preview = (f, kind, args) => f.call(P + OPS[kind] + '.preview', args);
const confirm = (f, kind, args, token) => f.call(P + OPS[kind] + '.confirm', { ...args, token });
function approve(f, kind, args) { const pv = preview(f, kind, args); assert.equal(pv.status, 'ok', JSON.stringify(pv)); assert.equal(ok(f, pv.preview.token).status, 'committed'); return pv; }
const settle = (f, kind, args) => { const pv = approve(f, kind, args); const out = confirm(f, kind, args, pv.preview.token); assert.equal(out.status, 'committed', JSON.stringify(out)); return out; };
const ctxAt = (now, b = binding) => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now, binding: structuredClone(b) });
function reopen(f, b = binding) {
  const data = JSON.parse(JSON.stringify(f.data()));
  for (const later of [f.ctx.virtual_now, new Date(Date.parse(f.ctx.virtual_now) + 400 * 86400000).toISOString()]) assert.doesNotThrow(() => plugin.validateSeed(ctxAt(later, b), data), later);
  const seed = { ...data, approvals: [] };
  const again = fixture({ seed, now: f.ctx.virtual_now, binding: b });
  assert.deepEqual(again.data().eobs, data.eobs);
  return again;
}
const parts = l => [l.line_id, l.status, l.reason, l.copay_cents, l.deductible_cents, l.coinsurance_cents, l.plan_paid_cents, l.pa_id];
const rows = list => list.map(x => [x.notice_id, x.kind, x.recipient_id, x.subject.id, x.at]);
const added = (before, f) => f.data().notices.slice(before.notices.length);

test('T05 claim.received is reviewed at 23:59 three days later: a copay EOB posts to the out-of-pocket total only, commits once and reopens', () => {
  const f = fixture({ seed: S.base() });
  assert.equal(receive(f, 'cl-7', 'm-1', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000)]).status, 'committed');
  assert.deepEqual([claimOf(f, 'cl-7').review_at, claimOf(f, 'cl-7').status], [REVIEW, 'received']);
  f.setNow('2026-11-21T23:58:59.999-05:00');
  assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-7' }).claim.status, 'received');
  f.setNow(REVIEW);
  const seen = f.call(P + 'claims.get', { claim_id: 'cl-7' }).claim;
  assert.deepEqual([seen.status, seen.eobs.length, claimOf(f, 'cl-7').status], ['processed', 1, 'received']);
  f.setNow(AFTER);
  const before = f.data();
  tick(f);
  const c = claimOf(f, 'cl-7'), [e] = eobsOf(f, 'cl-7');
  assert.deepEqual([c.status, c.processed_at, c.claim_version], ['processed', REVIEW, 1]);
  assert.deepEqual([e.eob_id, e.version, e.issued_at, e.posting_seq, e.reason, e.appeal_id], ['eob-2', 1, REVIEW, '2', 'initial', null]);
  assert.deepEqual(e.ledger_before, { 2026: { member: { deductible_cents: 0, oop_cents: 2500 }, family: { deductible_cents: 0, oop_cents: 2500 } } });
  assert.deepEqual(e.lines.map(parts), [['ln-1', 'paid', null, 2500, 0, 0, 15500, null]]);
  assert.deepEqual(e.postings, [{ member_id: 'm-1', plan_year: 2026, deductible_cents: 0, oop_cents: 2500 }]);
  assert.deepEqual(f.data().accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026), { member_id: 'm-1', plan_year: 2026, deductible_cents: 0, oop_cents: 5000 });
  const notes = added(before, f);
  assert.deepEqual(rows(notes), [['n-1', 'notice.eob_available', 'm-1', 'cl-7', REVIEW]]);
  assert.deepEqual(notes[0].fields, { claim_id: 'cl-7', eob_version: 1, member_cost_cents: 2500, plan_paid_cents: 15500 });
  assert.deepEqual(seen.eobs, f.call(P + 'claims.get', { claim_id: 'cl-7' }).claim.eobs);
  tick(f);
  assert.deepEqual([eobsOf(f, 'cl-7').length, f.data().notices.length, f.data().windows.length], [1, 1, 0]);
  reopen(f);
});

test('T05 an out-of-network emergency MRI is priced with the imaging copay, not the emergency one, with no PA and no units', () => {
  const s = S.base();
  s.plan.years['2026'].copays.imaging = 10000;
  const f = fixture({ seed: s });
  receive(f, 'cl-7', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 180000, { emergency: true })], 'pv-5');
  f.setNow(AFTER);
  tick(f);
  assert.deepEqual(eobsOf(f, 'cl-7')[0].lines.map(l => [...parts(l), l.pa_units, l.not_allowed_cents]), [['ln-1', 'paid', null, 10000, 0, 0, 140000, null, 0, 30000]]);
  receive(f, 'cl-8', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-21', 180000)], 'pv-5');
  f.setNow('2026-11-26T09:00:00-05:00');
  tick(f);
  assert.deepEqual(eobsOf(f, 'cl-8')[0].lines.map(parts), [['ln-1', 'denied', 'out_of_network', 0, 0, 0, 0, null]]);
  assert.deepEqual(f.data().windows.map(w => [w.target.id, w.notice_at, w.ends_at, w.closing.due_at]), [['cl-8', '2026-11-25T23:59:00-05:00', '2027-05-24T23:59:00-04:00', '2027-05-10T23:59:00-04:00']]);
  assert.deepEqual(f.data().notices.filter(x => x.subject.id === 'cl-8').map(x => x.kind), ['notice.eob_available', 'notice.claim_denied']);
  reopen(f);
});

test('T05 a review opens one request per unknown-coverage line and per accident flag, in line order, with one notice per request and recipient', () => {
  const f = fixture({ seed: S.granted() });
  receive(f, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-15', 21000), ln('ln-2', 2, 'svc-knee-mri', '2026-11-10', 180000, { possible_accident: true })]);
  f.setNow(AFTER);
  const before = f.data();
  tick(f);
  assert.deepEqual(reqs(f, 'cl-7').map(r => [r.info_request_id, r.type, r.line_id, r.plan_year, r.opened_at, r.expires_at, r.status]), [
    ['ir-1', 'other_coverage', 'ln-2', 2026, REVIEW, EXPIRY, 'open'], ['ir-2', 'accident', 'ln-2', 2026, REVIEW, EXPIRY, 'open'], ['ir-3', 'other_coverage', 'ln-1', 2026, REVIEW, EXPIRY, 'open']]);
  assert.deepEqual([claimOf(f, 'cl-7').status, claimOf(f, 'cl-7').claim_version, eobsOf(f, 'cl-7').length], ['pending_info', 1, 0]);
  const notes = added(before, f);
  assert.deepEqual(rows(notes), [['n-1', 'notice.info_requested', 'm-1', 'ir-1', REVIEW], ['n-2', 'notice.info_requested', 'm-2', 'ir-1', REVIEW], ['n-3', 'notice.info_requested', 'm-1', 'ir-2', REVIEW],
    ['n-4', 'notice.info_requested', 'm-2', 'ir-2', REVIEW], ['n-5', 'notice.info_requested', 'm-1', 'ir-3', REVIEW], ['n-6', 'notice.info_requested', 'm-2', 'ir-3', REVIEW]]);
  assert.deepEqual(notes[2].fields, { claim_id: 'cl-7', line_id: 'ln-2', type: 'accident', expires_at: EXPIRY });
  reopen(f);
});

test('T05 two same-day reviews of one member run in claim-ID string order, which decides who takes the deductible; committed, reopened and reloaded', () => {
  const f = fixture({ seed: S.base(), now: '2026-11-18T10:00:00-05:00' });
  receive(f, 'cl-9', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 100000)]);
  f.setNow('2026-11-18T11:00:00-05:00');
  receive(f, 'cl-10', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 100000)]);
  f.setNow(AFTER);
  tick(f);
  const e10 = eobsOf(f, 'cl-10')[0], e9 = eobsOf(f, 'cl-9')[0];
  assert.deepEqual([claimOf(f, 'cl-9').received_seq, claimOf(f, 'cl-10').received_seq, e10.posting_seq, e9.posting_seq], ['2', '3', '2', '3']);
  assert.deepEqual([parts(e10.lines[0]), parts(e9.lines[0])], [['ln-1', 'paid', null, 0, 100000, 0, 0, null], ['ln-1', 'paid', null, 0, 50000, 10000, 40000, null]]);
  assert.deepEqual(e9.ledger_before[2026].member, { deductible_cents: 100000, oop_cents: 102500 });
  reopen(f);
});

test('T05 one attestation completes two claims received at one instant in receipt order: the first received takes the PA\'s last unit; receipt numbers compare as numbers', () => {
  const s = S.paApproved(1);
  S.claim(s, { claim_id: 'cl-9', member_id: 'm-3', provider_id: 'pv-3', received_at: T0, lines: [ln('ln-1', 1, 'svc-physical-therapy', '2026-11-17', 15000)] });
  S.finalize(s);
  s.claims.find(c => c.claim_id === 'cl-9').received_seq = '9';
  s.issued.seq = '9';
  const f = fixture({ seed: s });
  receive(f, 'cl-10', 'm-3', [ln('ln-1', 1, 'svc-physical-therapy', '2026-11-17', 15000)], 'pv-3');
  assert.deepEqual([claimOf(f, 'cl-10').received_seq, f.data().issued.seq], ['10', '10']);
  f.setNow(AFTER);
  tick(f);
  assert.deepEqual(f.data().info_requests.map(r => [r.info_request_id, r.claim_id]), [['ir-1', 'cl-10'], ['ir-2', 'cl-9']]);
  const args = { member_id: 'm-3', plan_year: 2026, answer: 'none' };
  assert.deepEqual(preview(f, 'cob', args).preview.changes, { resolves: ['ir-2', 'ir-1'], completes: ['cl-9', 'cl-10'] });
  const out = settle(f, 'cob', args);
  assert.deepEqual(out.coverage, { member_id: 'm-3', plan_year: 2026, status: 'none', version: 1, attested_at: AFTER });
  assert.deepEqual(out.claims.map(c => [c.claim_id, c.status, c.lines[0].outcome.status, c.lines[0].outcome.pa_id]), [['cl-9', 'processed', 'paid', 'pa-1'], ['cl-10', 'processed', 'denied', null]]);
  assert.deepEqual([eobsOf(f, 'cl-9')[0].posting_seq, eobsOf(f, 'cl-10')[0].posting_seq, eobsOf(f, 'cl-10')[0].lines[0].reason], ['2', '3', 'prior_auth_missing']);
  assert.deepEqual([f.data().pas[0].units_used, f.data().pas[0].pa_version], [1, 2]);
  assert.deepEqual(reopen(f).data().issued.seq, '10');
});

test('T05 claims.info: a line with only an other-coverage request is info_not_requested; a token restated for another line is stale_preview and stays unused; its own line commits', () => {
  const f = fixture({ seed: actOn() });
  receive(f, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-10', 21000, { possible_accident: true }), ln('ln-2', 2, 'svc-office-visit', '2026-11-11', 21000), ln('ln-3', 3, 'svc-office-visit', '2026-11-12', 21000, { possible_accident: true })]);
  f.setNow(AFTER);
  tick(f);
  const a = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' };
  assert.deepEqual(preview(f, 'info', { ...a, line_id: 'ln-2' }), { status: 'info_not_requested', message: 'Line ln-2 of claim cl-7 has no open accident question.' });
  assert.equal(preview(f, 'info', { ...a, line_id: 'ln-9' }).status, 'not_found');
  assert.equal(preview(f, 'info', { ...a, claim_id: 'cl-9' }).status, 'not_found');
  const pv = approve(f, 'info', a);
  assert.deepEqual(pv.preview.changes, { info_request_id: 'ir-2', claim_id: 'cl-7', line_id: 'ln-1', completes: null });
  assert.match(pv.preview.token, /^tok-info-request-ir-2-[0-9a-f]{32}$/);
  for (const line_id of ['ln-2', 'ln-3']) assert.equal(confirm(f, 'info', { ...a, line_id }, pv.preview.token).status, 'stale_preview', line_id);
  assert.equal(confirm(f, 'info', { ...a, answer: 'accident' }, pv.preview.token).status, 'stale_preview');
  assert.equal(f.data().approvals.find(x => x.token === pv.preview.token).used_at, null);
  const out = confirm(f, 'info', a, pv.preview.token);
  assert.equal(out.status, 'committed');
  assert.deepEqual(out.claim.info_requests.map(r => [r.info_request_id, r.status, r.answer, r.request_version]), [['ir-1', 'open', null, 0], ['ir-2', 'answered', 'not_accident', 1], ['ir-3', 'open', null, 0], ['ir-4', 'open', null, 0], ['ir-5', 'open', null, 0]]);
  assert.deepEqual([out.claim.status, out.claim.claim_version, f.data().approvals.find(x => x.token === pv.preview.token).used_at], ['pending_info', 2, AFTER]);
  assert.deepEqual(out.claim.approvals.map(x => x.state), ['used']);
  assert.equal(confirm(f, 'info', a, pv.preview.token).status, 'confirmation_invalid');
  reopen(f);
});

test('T05 confirm order for both confirms: approval missing, from another person or reused, then freshness, then state', () => {
  const f = fixture({ seed: S.pendingCob('m-2', 2026, actOn(), true) });
  const cob = { member_id: 'm-2', plan_year: 2026, answer: 'none' }, info = { claim_id: 'cl-4', line_id: 'ln-1', answer: 'accident' };
  for (const [kind, args] of [['cob', cob], ['info', info]]) {
    const pv = preview(f, kind, args);
    assert.equal(confirm(f, kind, args, pv.preview.token).status, 'confirmation_required');
    ok(f, pv.preview.token, 'm-2');
    assert.equal(confirm(f, kind, args, pv.preview.token).status, 'confirmation_invalid');
    f.advance(1);
  }
  assert.equal(confirm(f, 'cob', cob, 'tok-cob-coverage-m-2:2026-' + 'a'.repeat(32)).status, 'confirmation_required');
  const g = fixture({ seed: S.pendingCob('m-2', 2026, actOn(), true) });
  const pv = approve(g, 'cob', cob);
  receive(g, 'cl-8', 'm-1', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000)]);
  assert.equal(confirm(g, 'cob', { ...cob, answer: 'other_secondary' }, pv.preview.token).status, 'stale_preview');
  assert.equal(confirm(g, 'cob', cob, pv.preview.token).status, 'committed');
  assert.deepEqual(preview(g, 'cob', { ...cob, plan_year: 2028 }), { status: 'not_found', message: 'The plan has no plan year 2028.' });
  assert.deepEqual(preview(g, 'cob', { ...cob, plan_year: 2026 }), { status: 'info_not_requested', message: 'No other-coverage question is open for member m-2 in plan year 2026.' });
  const v = fixture({ seed: S.pendingCob('m-2', 2026, S.granted()) });
  assert.equal(preview(v, 'cob', cob).status, 'not_authorized');
  assert.equal(preview(v, 'info', { ...info, line_id: 'ln-1' }).status, 'not_authorized');
});

test('T05 an attestation answers requests by receipt, then by request ID as a string', () => {
  const f = fixture({ seed: S.edit(actOn(), x => { x.issued.ir = '8'; }) });
  receive(f, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-15', 21000), ln('ln-2', 2, 'svc-office-visit', '2026-11-16', 21000)]);
  f.setNow(AFTER);
  tick(f);
  assert.deepEqual(reqs(f, 'cl-7').map(r => [r.info_request_id, r.line_id]), [['ir-9', 'ln-1'], ['ir-10', 'ln-2']]);
  assert.deepEqual(preview(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' }).preview.changes, { resolves: ['ir-10', 'ir-9'], completes: ['cl-7'] });
});

test('T05 two approved cob tokens for one member and year: the first attestation stales the second, which stays unused', () => {
  const f = fixture({ seed: S.pendingCob('m-2', 2026, actOn()) });
  const a = approve(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' }), b = approve(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'other_secondary' });
  assert.notEqual(a.preview.token, b.preview.token);
  assert.equal(confirm(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' }, a.preview.token).status, 'committed');
  assert.equal(confirm(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'other_secondary' }, b.preview.token).status, 'stale_preview');
  assert.deepEqual(f.data().approvals.map(x => x.used_at), [T0, null]);
});

test('T05 a maximum-length coverage subject: preview, approval, reopen, plan.get shows it, confirm commits', () => {
  const long = 'm' + 'x'.repeat(79);
  const swap = o => JSON.parse(JSON.stringify(o).split('"m-2"').join('"' + long + '"'));
  const b = swap(binding), s = swap(S.pendingCob('m-2', 2026, actOn()));
  const f = fixture({ seed: s, binding: b });
  const args = { member_id: long, plan_year: 2026, answer: 'none' };
  const pv = approve(f, 'cob', args);
  assert.equal(pv.preview.token.length, 135);
  assert.deepEqual(f.data().approvals[0].subject, { action: 'cob', kind: 'coverage', id: long + ':2026' });
  const data = JSON.parse(JSON.stringify(f.data()));
  plugin.validateSeed(ctxAt(T0, b), data);
  assert.ok(seedValid(data));
  assert.deepEqual(f.call(P + 'plan.get', { plan_year: 2026 }).members.find(m => m.member_id === long).approvals.map(x => [x.token, x.state]), [[pv.preview.token, 'active']]);
  assert.equal(confirm(f, 'cob', args, pv.preview.token).status, 'committed');
  assert.deepEqual(f.call(P + 'plan.get', { plan_year: 2026 }).members.find(m => m.member_id === long).other_coverage, { status: 'none', version: 1, attested_at: T0 });
  reopen(f, b);
});

test('T05 after a same-seed reset, an accident request recreated with the same IDs and times for another member makes the old token stale_preview, unused, the request unanswered', () => {
  const s = attest(S.base(), 'm-3', 2026);
  const lines = [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 180000, { possible_accident: true })];
  const a = fixture({ seed: s });
  receive(a, 'cl-7', 'm-3', lines);
  a.setNow(AFTER);
  const args = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' };
  const token = preview(a, 'info', args).preview.token;
  const b = fixture({ seed: s });
  receive(b, 'cl-7', 'm-1', lines);
  b.setNow(AFTER);
  assert.equal(preview(b, 'info', args).preview.token.slice(0, 22), token.slice(0, 22));
  assert.notEqual(preview(b, 'info', args).preview.token, token);
  ok(b, token);
  assert.equal(confirm(b, 'info', args, token).status, 'stale_preview');
  assert.deepEqual([b.data().approvals[0].used_at, reqs(b, 'cl-7')[0].status, reqs(b, 'cl-7')[0].info_request_id], [null, 'open', 'ir-1']);
});

test('T05 claim intake refuses duplicate claim or line IDs, a service date after receipt or outside the plan, an unenrolled year, a pharmacy line and an impossible date', () => {
  const s = S.edit(S.base(), x => {
    x.members.find(m => m.member_id === 'm-3').enrolled_years = [2026, 2027];
    x.coverage = x.coverage.filter(c => !(c.member_id === 'm-3' && c.plan_year === 2025));
    x.accumulators = x.accumulators.filter(c => !(c.member_id === 'm-3' && c.plan_year === 2025));
  });
  const f = fixture({ seed: s });
  const before = f.data();
  const office = (id, date) => ln(id, 1, 'svc-office-visit', date, 21000);
  for (const [id, member, lines, why] of [['cl-1', 'm-1', [office('ln-1', '2026-11-17')], 'Claim cl-1 already exists.'], ['cl-7', 'm-1', [office('ln-1', '2026-11-17'), office('ln-1', '2026-11-16')], 'Claim cl-7 repeats line ln-1.'],
    ['cl-7', 'm-1', [office('ln-2', '2026-11-19')], 'Line ln-2 is dated after the claim was received.'], ['cl-7', 'm-1', [office('ln-3', '2024-12-31')], 'Line ln-3 falls in plan year 2024, which the plan does not cover.'],
    ['cl-7', 'm-3', [office('ln-1', '2025-12-31')], 'Member m-3 is not enrolled in plan year 2025.'], ['cl-7', 'm-1', [ln('ln-4', 1, 'svc-adalimumab-40', '2026-11-17', 300000)], 'Pharmacy claims belong to the pharmacy; line ln-4 names a pharmacy service.'],
    ['cl-7', 'm-1', [office('ln-5', '2026-02-30')], 'Line ln-5 has an invalid service date 2026-02-30.']]) {
    assert.deepEqual(receive(f, id, member, lines), { status: 'invalid_event', message: why });
  }
  assert.deepEqual(f.data(), before);
  assert.equal(receive(f, 'cl-7', 'm-3', [office('ln-1', '2026-01-01')]).status, 'committed');
  assert.equal(receive(f, 'cl-8', 'm-1', [office('ln-1', '2026-11-18')]).status, 'committed');
});

test('T05 a request opened after a cob preview is answered by the original token, which stays fresh', () => {
  const f = fixture({ seed: S.pendingCob('m-2', 2026, actOn()) });
  const args = { member_id: 'm-2', plan_year: 2026, answer: 'none' };
  const pv = preview(f, 'cob', args);
  assert.deepEqual(pv.preview.changes, { resolves: ['ir-1'], completes: ['cl-4'] });
  receive(f, 'cl-8', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000)]);
  f.setNow(AFTER);
  ok(f, pv.preview.token);
  assert.equal(reqs(f, 'cl-8')[0].info_request_id, 'ir-2');
  const out = confirm(f, 'cob', args, pv.preview.token);
  assert.equal(out.status, 'committed');
  assert.deepEqual(out.claims.map(c => [c.claim_id, c.status, c.info_requests[0].answer]), [['cl-4', 'processed', 'none'], ['cl-8', 'processed', 'none']]);
  reopen(f);
});

test('T05 T03: one attestation answers the member\'s open requests of that year; other_primary denies their lines; the other year stays open; no open request is info_not_requested', () => {
  const f = fixture({ seed: actOn() });
  receive(f, 'cl-a', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000)]);
  receive(f, 'cl-b', 'm-2', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-16', 180000), ln('ln-2', 2, 'svc-lab-panel', '2026-11-16', 9000)]);
  receive(f, 'cl-c', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2025-12-20', 21000)]);
  f.setNow(AFTER);
  tick(f);
  assert.deepEqual(f.data().claims.filter(c => c.member_id === 'm-2').map(c => c.status), ['pending_info', 'pending_info', 'pending_info']);
  assert.deepEqual(preview(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'other_primary' }).preview.changes, { resolves: ['ir-1', 'ir-2', 'ir-3'], completes: ['cl-a', 'cl-b'] });
  const before = f.data();
  const out = settle(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'other_primary' });
  assert.deepEqual(out.claims.map(c => [c.claim_id, c.status, c.lines.map(l => l.outcome.reason)]), [['cl-a', 'processed', ['other_party_liable']], ['cl-b', 'processed', ['other_party_liable', 'other_party_liable']]]);
  assert.deepEqual([claimOf(f, 'cl-c').status, reqs(f, 'cl-c')[0].status], ['pending_info', 'open']);
  assert.deepEqual(rows(added(before, f)).map(r => [r[1], r[2], r[3]]), [['notice.eob_available', 'm-1', 'cl-a'], ['notice.eob_available', 'm-2', 'cl-a'], ['notice.claim_denied', 'm-1', 'cl-a'], ['notice.claim_denied', 'm-2', 'cl-a'],
    ['notice.eob_available', 'm-1', 'cl-b'], ['notice.eob_available', 'm-2', 'cl-b'], ['notice.claim_denied', 'm-1', 'cl-b'], ['notice.claim_denied', 'm-2', 'cl-b']]);
  assert.deepEqual(f.data().windows.map(w => [w.target.id, w.notice_at]), [['cl-a', AFTER], ['cl-b', AFTER]]);
  for (const year of [2026, 2027]) { const p = preview(f, 'cob', { member_id: 'm-2', plan_year: year, answer: 'none' }); assert.deepEqual([p.status, p.preview], ['info_not_requested', undefined]); }
  const last = settle(f, 'cob', { member_id: 'm-2', plan_year: 2025, answer: 'none' });
  assert.deepEqual(last.claims.map(c => [c.claim_id, c.status, c.lines[0].outcome.status]), [['cl-c', 'processed', 'paid']]);
  reopen(f);
});

function accidentClaim(seed = actOn()) {
  const f = fixture({ seed });
  receive(f, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-10', 180000, { possible_accident: true }), ln('ln-2', 2, 'svc-office-visit', '2026-11-15', 21000)]);
  f.setNow(AFTER);
  tick(f);
  return f;
}

test('T05 T04: other coverage answered leaves the claim pending; the accident expiry, committed by the next write, denies only that line missing_information, once', () => {
  const f = accidentClaim();
  assert.deepEqual(reqs(f, 'cl-7').map(r => [r.info_request_id, r.type, r.line_id]), [['ir-1', 'other_coverage', 'ln-1'], ['ir-2', 'accident', 'ln-1'], ['ir-3', 'other_coverage', 'ln-2']]);
  assert.deepEqual(preview(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' }).preview.changes, { resolves: ['ir-1', 'ir-3'], completes: [] });
  settle(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' });
  assert.equal(claimOf(f, 'cl-7').status, 'pending_info');
  assert.deepEqual(preview(f, 'info', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'accident' }).preview.changes, { info_request_id: 'ir-2', claim_id: 'cl-7', line_id: 'ln-1', completes: 'cl-7' });
  f.setNow('2027-01-05T23:58:59.999-05:00');
  assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-7' }).claim.status, 'pending_info');
  f.setNow('2027-01-06T09:00:00-05:00');
  const read = f.call(P + 'claims.get', { claim_id: 'cl-7' }).claim;
  assert.deepEqual([read.status, read.lines.map(l => l.outcome.reason), claimOf(f, 'cl-7').status], ['processed', ['missing_information', null], 'pending_info']);
  const before = f.data();
  tick(f);
  const [e] = eobsOf(f, 'cl-7');
  assert.deepEqual([e.issued_at, e.lines.map(l => [l.status, l.reason]), reqs(f, 'cl-7')[1].status, reqs(f, 'cl-7')[1].request_version], [EXPIRY, [['denied', 'missing_information'], ['paid', null]], 'expired', 1]);
  assert.deepEqual(rows(added(before, f)).map(r => [r[1], r[2], r[4]]), [['notice.eob_available', 'm-1', EXPIRY], ['notice.eob_available', 'm-2', EXPIRY], ['notice.claim_denied', 'm-1', EXPIRY], ['notice.claim_denied', 'm-2', EXPIRY]]);
  tick(f);
  assert.equal(eobsOf(f, 'cl-7').length, 1);
  assert.equal(preview(f, 'info', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'accident' }).status, 'info_not_requested');
  reopen(f);
});

test('T05 work_related keeps other_party_liable when the claim\'s other requests later expire, and other_primary keeps it when the accident request expires', () => {
  const f = accidentClaim();
  settle(f, 'info', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'work_related' });
  assert.deepEqual(preview(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' }).preview.changes, { resolves: ['ir-1', 'ir-3'], completes: ['cl-7'] });
  f.setNow('2027-01-06T09:00:00-05:00');
  tick(f);
  assert.deepEqual(eobsOf(f, 'cl-7')[0].lines.map(l => [l.line_id, l.reason]), [['ln-1', 'other_party_liable'], ['ln-2', 'missing_information']]);
  assert.deepEqual(reqs(f, 'cl-7').map(r => r.status), ['expired', 'answered', 'expired']);
  reopen(f);
  const g = accidentClaim();
  settle(g, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'other_primary' });
  g.setNow('2027-01-06T09:00:00-05:00');
  tick(g);
  assert.deepEqual(eobsOf(g, 'cl-7')[0].lines.map(l => [l.line_id, l.reason]), [['ln-1', 'other_party_liable'], ['ln-2', 'other_party_liable']]);
  reopen(g);
});

test('T05 a standing other_primary coverage denies its year\'s lines with no request, its accident flag opening none', () => {
  const f = fixture({ seed: attest(actOn(), 'm-2', 2026, 'other_primary') });
  receive(f, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000, { possible_accident: true }), ln('ln-2', 2, 'svc-office-visit', '2025-12-30', 21000)]);
  f.setNow(AFTER);
  tick(f);
  assert.deepEqual(reqs(f, 'cl-7').map(r => [r.type, r.line_id, r.plan_year]), [['other_coverage', 'ln-2', 2025]]);
  settle(f, 'cob', { member_id: 'm-2', plan_year: 2025, answer: 'none' });
  assert.deepEqual(eobsOf(f, 'cl-7')[0].lines.map(l => [l.line_id, l.status, l.reason]), [['ln-1', 'denied', 'other_party_liable'], ['ln-2', 'paid', null]]);
  const g = fixture({ seed: attest(actOn(), 'm-2', 2026, 'other_primary') });
  receive(g, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000, { possible_accident: true })]);
  g.setNow(AFTER);
  tick(g);
  assert.deepEqual([reqs(g, 'cl-7'), eobsOf(g, 'cl-7')[0].issued_at, eobsOf(g, 'cl-7')[0].lines[0].reason], [[], REVIEW, 'other_party_liable']);
  reopen(g);
});

test('T05 an answer at the request\'s expiry instant is too late: a fresh preview is info_not_requested and a token approved five minutes before is stale_preview, unused', () => {
  const f = fixture({ seed: S.base() });
  receive(f, 'cl-7', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 180000, { possible_accident: true })]);
  f.setNow(AFTER);
  tick(f);
  const args = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' };
  f.setNow('2027-01-05T23:54:00-05:00');
  const pv = approve(f, 'info', args);
  const before = f.data();
  for (const at of [EXPIRY, '2027-01-06T00:00:00-05:00']) {
    f.setNow(at);
    assert.equal(preview(f, 'info', args).status, 'info_not_requested');
    assert.equal(confirm(f, 'info', args, pv.preview.token).status, 'stale_preview');
    assert.deepEqual(f.data(), before);
  }
  tick(f);
  assert.deepEqual([eobsOf(f, 'cl-7')[0].lines[0].reason, f.data().approvals.find(a => a.token === pv.preview.token).used_at], ['missing_information', null]);
});

test('T05 an approved cob token after all of the year\'s requests expired is info_not_requested; after some expired it answers the open ones', () => {
  const all = fixture({ seed: S.pendingCob('m-2', 2026, actOn()), now: '2026-12-31T23:54:00-05:00' });
  const args = { member_id: 'm-2', plan_year: 2026, answer: 'none' };
  const a = approve(all, 'cob', args);
  all.setNow('2027-01-01T00:00:00-05:00');
  assert.equal(confirm(all, 'cob', args, a.preview.token).status, 'info_not_requested');
  assert.equal(all.data().approvals[0].used_at, null);
  const some = fixture({ seed: S.pendingCob('m-2', 2026, actOn()), now: T0 });
  receive(some, 'cl-8', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000)]);
  some.setNow(AFTER);
  tick(some);
  some.setNow('2026-12-31T23:54:00-05:00');
  const b = approve(some, 'cob', args);
  assert.deepEqual(b.preview.changes.resolves, ['ir-1', 'ir-2']);
  some.setNow('2027-01-01T00:00:00-05:00');
  const out = confirm(some, 'cob', args, b.preview.token);
  assert.deepEqual([out.status, out.claims.map(c => c.claim_id)], ['committed', ['cl-8']]);
  assert.deepEqual([eobsOf(some, 'cl-4')[0].issued_at, eobsOf(some, 'cl-4')[0].lines[0].reason, eobsOf(some, 'cl-8')[0].lines[0].status], ['2026-12-31T23:59:00-05:00', 'missing_information', 'paid']);
  reopen(some);
});

test('T05 cob then info on the same claim, both previewed and approved first, both commit', () => {
  const f = accidentClaim();
  const cob = { member_id: 'm-2', plan_year: 2026, answer: 'none' }, info = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'accident' };
  const a = approve(f, 'cob', cob), b = approve(f, 'info', info);
  assert.equal(confirm(f, 'cob', cob, a.preview.token).status, 'committed');
  const out = confirm(f, 'info', info, b.preview.token);
  assert.deepEqual([out.status, out.claim.status, out.claim.lines.map(l => l.outcome.status)], ['committed', 'processed', ['paid', 'paid']]);
  reopen(f);
});

test('T05 a preview on a projected request, then user.confirmed commits the review, and the same token confirms', () => {
  const f = fixture({ seed: S.base() });
  receive(f, 'cl-7', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 180000, { possible_accident: true })]);
  f.setNow(AFTER);
  const args = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'accident' };
  const pv = preview(f, 'info', args);
  assert.equal(f.data().info_requests.length, 0);
  assert.match(pv.preview.token, /^tok-info-request-ir-1-/);
  ok(f, pv.preview.token);
  assert.deepEqual(reqs(f, 'cl-7').map(r => r.info_request_id), ['ir-1']);
  const out = confirm(f, 'info', args, pv.preview.token);
  assert.deepEqual([out.status, out.claim.status], ['committed', 'processed']);
  reopen(f);
});

test('T05 a seed loaded after its review cutoff reads as reviewed and is caught up once by the first write, with the grants in force at the due time', () => {
  const s = attest(S.granted(S.received(), 'm-2', 'view', '2026-11-21T08:00:00-05:00'), 'm-2', 2026);
  const b = S.edit(structuredClone(binding), x => { x.accounts = [{ app_id: 'larkfield-health', account_id: 'larkfield-m-2', owner_person_id: 'm-2' }]; });
  Object.assign(s, { account_id: 'larkfield-m-2', owner_person_id: 'm-2' });
  const f = fixture({ seed: s, binding: b, now: '2026-11-25T09:00:00-05:00' });
  const read = f.call(P + 'claims.get', { claim_id: 'cl-2' }).claim;
  assert.deepEqual([read.status, read.eobs[0].issued_at, claimOf(f, 'cl-2').status], ['processed', '2026-11-20T23:59:00-05:00', 'received']);
  assert.equal(ok(f, 'tok-7c1e', 'm-2').status, 'committed');
  assert.deepEqual(rows(f.data().notices), [['n-1', 'notice.eob_available', 'm-1', 'cl-2', '2026-11-20T23:59:00-05:00'], ['n-2', 'notice.eob_available', 'm-2', 'cl-2', '2026-11-20T23:59:00-05:00']]);
  assert.equal(ok(f, 'tok-7c1e', 'm-2').status, 'committed');
  assert.deepEqual([eobsOf(f, 'cl-2').length, f.data().notices.length], [1, 2]);
  reopen(f, b);
});

test('T05 IDs and versions at the seeded limits: preview, approval and confirm commit, and the next values stay valid', () => {
  const s = S.pendingCob('m-2', 2026, actOn());
  const top = '100000000000000', high = Number.MAX_SAFE_INTEGER - 2 ** 40;
  for (const k of ['ir', 'eob', 'cf', 'n', 'post', 'seq']) s.issued[k] = top;
  s.claims.find(c => c.claim_id === 'cl-4').claim_version = high;
  s.info_requests[0].request_version = high;
  s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026).version = high;
  const f = fixture({ seed: s });
  const out = settle(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' });
  assert.deepEqual([out.coverage.version, out.claims[0].claim_version, out.claims[0].info_requests[0].request_version], [high + 1, high + 1, high + 1]);
  const d = f.data();
  assert.deepEqual([d.approvals[0].approval_id, d.eobs.at(-1).eob_id, d.eobs.at(-1).posting_seq, d.notices[0].notice_id], ['cf-100000000000001', 'eob-100000000000001', '100000000000001', 'n-100000000000001']);
  reopen(f);
});

test('T05 a cob confirm at exactly review_at, after user.confirmed and with no clock advance, commits after the review opened the requests and reloads', () => {
  const f = fixture({ seed: actOn() });
  receive(f, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000)]);
  f.setNow(REVIEW);
  const args = { member_id: 'm-2', plan_year: 2026, answer: 'none' };
  const pv = preview(f, 'cob', args);
  assert.deepEqual(pv.preview.changes, { resolves: ['ir-1'], completes: ['cl-7'] });
  ok(f, pv.preview.token);
  assert.deepEqual([reqs(f, 'cl-7')[0].opened_at, claimOf(f, 'cl-7').status], [REVIEW, 'pending_info']);
  const out = confirm(f, 'cob', args, pv.preview.token);
  assert.deepEqual([out.status, out.coverage.attested_at, out.claims[0].status, eobsOf(f, 'cl-7')[0].issued_at], ['committed', REVIEW, 'processed', REVIEW]);
  reopen(f);
});

test('T05 several calls at one instant with no clock advance: an accident confirm and a cob confirm completing different claims, in either order, both load', () => {
  const start = () => {
    const f = fixture({ seed: actOn() });
    receive(f, 'cl-a', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 100000, { possible_accident: true })]);
    receive(f, 'cl-b', 'm-2', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 300000)]);
    f.setNow(AFTER);
    tick(f);
    return f;
  };
  const info = { claim_id: 'cl-a', line_id: 'ln-1', answer: 'not_accident' }, cob = { member_id: 'm-2', plan_year: 2026, answer: 'none' };
  const results = [];
  for (const order of [['info', 'cob'], ['cob', 'info']]) {
    const f = start();
    const tokens = { info: approve(f, 'info', info).preview.token, cob: approve(f, 'cob', cob).preview.token };
    for (const kind of order) assert.equal(confirm(f, kind, kind === 'info' ? info : cob, tokens[kind]).status, 'committed', kind);
    const first = eobsOf(f, order[0] === 'info' ? 'cl-a' : 'cl-b')[0], second = eobsOf(f, order[1] === 'info' ? 'cl-a' : 'cl-b')[0];
    assert.deepEqual([first.issued_at, second.issued_at, first.posting_seq, second.posting_seq], [AFTER, AFTER, '2', '3']);
    results.push(eobsOf(f, 'cl-b')[0].ledger_before[2026].family.deductible_cents);
    reopen(f);
  }
  assert.deepEqual(results, [100000, 0]);
});

test('T05 a PA approval at a review instant comes after the review: the claim is denied prior_auth_missing and the approval mark follows its posting; both load', () => {
  const s = attest(S.paPending(), 'm-3', 2026);
  S.claim(s, { claim_id: 'cl-7', member_id: 'm-3', provider_id: 'pv-4', received_at: T0, lines: [ln('ln-1', 1, 'svc-arthroscopy', '2026-11-17', 800000)] });
  S.finalize(s);
  const approveNow = (data, payload, ctx) => {
    const pa = data.pas.find(p => p.pa_id === payload.pa_id);
    Object.assign(pa, { status: 'approved', approved: { units: payload.units, valid_from: payload.valid_from, valid_until: payload.valid_until }, approved_after_post: data.issued.post ?? '0', decided_at: ctx.virtual_now });
    bump(data, pa, 'pa_id', 'pa_version');
    N.paDecision(data, pa, ctx.virtual_now);
    return data;
  };
  const run = at => {
    const env = { event_id: 'pa-at-' + at, at, operation: 'pa.decided', payload: { pa_id: 'pa-2', decision: 'approved', units: 1, valid_from: '2026-11-01', valid_until: '2026-12-31' } };
    const out = plugin.applyEvent({ ...ctxAt(at), role: 'infra' }, structuredClone(s), env, { ...HANDLERS, 'pa.decided': approveNow });
    plugin.validateSeed(ctxAt(at), out);
    assert.ok(seedValid(out));
    return out;
  };
  const same = run(REVIEW), early = run('2026-11-21T23:58:00-05:00');
  const v1 = same.eobs.find(e => e.claim_id === 'cl-7');
  assert.deepEqual([v1.issued_at, v1.posting_seq, v1.lines[0].reason, same.pas[0].approved_after_post, same.pas[0].units_used], [REVIEW, '2', 'prior_auth_missing', '2', 0]);
  assert.deepEqual(same.notices.map(x => x.kind), ['notice.eob_available', 'notice.eob_available', 'notice.eob_available', 'notice.claim_denied', 'notice.claim_denied', 'notice.claim_denied', 'notice.pa_decision', 'notice.pa_decision', 'notice.pa_decision']);
  const g = fixture({ seed: early, now: '2026-11-21T23:58:00-05:00' });
  g.setNow(AFTER);
  tick(g);
  assert.deepEqual([eobsOf(g, 'cl-7')[0].lines[0].pa_id, g.data().pas[0].units_used, g.data().pas[0].approved_after_post], ['pa-2', 1, '1']);
  reopen(g);
});

test('T05 an open other-coverage request beside an attestation of its year is invalid_seed', () => {
  const s = attest(S.pendingCob('m-2', 2026), 'm-2', 2026, 'none', '2026-11-17T10:00:00-05:00');
  assert.throws(() => plugin.validateSeed(ctxAt(T0), s), e => e.code === 'invalid_seed' && /still open although coverage for 2026 was attested/.test(e.message));
});

function rng(k) { let x = (k * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

test('T05 random calls at one instant with no clock advance: receipts, answers, attestations and approvals in any order all commit and every state loads', () => {
  const svc = ['svc-office-visit', 'svc-specialist-visit', 'svc-knee-mri', 'svc-lab-panel', 'svc-physical-therapy', 'svc-er-visit'];
  let committed = 0, cobs = 0, infos = 0, expiredBeside = 0;
  for (let k = 1; k <= 60; k++) {
    const r = rng(k), pick = list => list[Math.floor(r() * list.length)];
    const s = S.paApproved(pick([1, 2, 12]), { valid_from: '2025-12-01', valid_until: '2027-02-28' }, actOn());
    for (const m of ['m-2', 'm-3']) for (const y of [2025, 2026]) if (r() < 0.3) attest(s, m, y, pick(['none', 'other_secondary', 'other_primary']));
    const f = fixture({ seed: s });
    let c = 0;
    const claim = () => receive(f, 'cl-f' + (++c), pick(['m-1', 'm-2', 'm-3']), Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ln('ln-' + (i + 1), i + 1, pick(svc), pick(['2025-12-30', '2026-11-16', '2026-11-17']), pick([0, 9000, 21000, 180000]), { possible_accident: r() < 0.4, emergency: r() < 0.15 })), pick(['pv-1', 'pv-3', 'pv-5']));
    for (let i = 0; i < 2 + Math.floor(r() * 4); i++) { if (r() < 0.5) f.setNow('2026-11-19T10:00:00-05:00'); assert.equal(claim().status, 'committed'); }
    f.setNow(pick([REVIEW, AFTER, '2027-01-05T23:59:00-05:00', '2027-01-06T09:00:00-05:00']));
    const listed = f.call(P + 'claims.list').claims;
    const actions = [];
    if (listed.some(cl => cl.info_requests.some(q => q.status === 'expired')) && listed.some(cl => cl.info_requests.some(q => q.status === 'open'))) expiredBeside++;
    for (const cl of listed) for (const q of cl.info_requests) if (q.status === 'open' && q.type === 'accident') actions.push(['info', { claim_id: cl.claim_id, line_id: q.line_id, answer: pick(['not_accident', 'accident', 'work_related']) }]);
    const pairs = new Set(listed.flatMap(cl => cl.info_requests.filter(q => q.status === 'open' && q.type === 'other_coverage').map(q => cl.member_id + '|' + q.plan_year)));
    for (const key of pairs) { const [member_id, year] = key.split('|'); actions.push(['cob', { member_id, plan_year: Number(year), answer: pick(['none', 'other_secondary', 'other_primary']) }]); }
    actions.push(['claim'], ['tick']);
    const order = actions.map(a => [r(), a]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    const early = r() < 0.5, tokens = new Map();
    if (early) for (const a of order) if (a.length === 2) tokens.set(a, approve(f, a[0], a[1]).preview.token);
    for (const a of order) {
      if (a[0] === 'claim') { assert.equal(claim().status, 'committed'); continue; }
      if (a[0] === 'tick') { tick(f); continue; }
      const token = tokens.get(a) || approve(f, a[0], a[1]).preview.token;
      const out = confirm(f, a[0], a[1], token);
      assert.equal(out.status, 'committed', k + ' ' + JSON.stringify(a) + ' ' + out.message);
      committed++; if (a[0] === 'cob') cobs++; else infos++;
    }
    reopen(f);
  }
  assert.ok(committed > 80 && cobs > 20 && infos > 20 && expiredBeside > 5, JSON.stringify({ committed, cobs, infos, expiredBeside }));
});

test('T05 T14 local part: a token previewed on a projected request, approved after its expiry, commits the review, the expiry and the EOB once at their due times, and is then stale_preview', () => {
  const f = fixture({ seed: S.base() });
  receive(f, 'cl-7', 'm-1', [ln('ln-1', 1, 'svc-knee-mri', '2026-11-17', 180000, { possible_accident: true })]);
  f.setNow(AFTER);
  const args = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' };
  const pv = preview(f, 'info', args);
  assert.equal(pv.status, 'ok');
  f.setNow('2027-01-06T09:00:00-05:00');
  assert.deepEqual(f.call(P + 'claims.get', { claim_id: 'cl-7' }).claim.lines[0].outcome.reason, 'missing_information');
  assert.equal(claimOf(f, 'cl-7').status, 'received');
  ok(f, pv.preview.token);
  assert.deepEqual([reqs(f, 'cl-7')[0].opened_at, reqs(f, 'cl-7')[0].status, eobsOf(f, 'cl-7')[0].issued_at], [REVIEW, 'expired', EXPIRY]);
  assert.deepEqual(rows(f.data().notices).map(r => [r[1], r[4]]), [['notice.info_requested', REVIEW], ['notice.eob_available', EXPIRY], ['notice.claim_denied', EXPIRY]]);
  const before = f.data();
  assert.equal(confirm(f, 'info', args, pv.preview.token).status, 'stale_preview');
  assert.deepEqual(f.data(), before);
  reopen(f);
});

test('T05 claims.info.confirm requires the accident request to be open after freshness: an approval matching a closed request\'s digest is info_not_requested and stores nothing', () => {
  const f = fixture({ seed: actOn() });
  receive(f, 'cl-7', 'm-2', [ln('ln-1', 1, 'svc-office-visit', '2026-11-17', 21000, { possible_accident: true })]);
  f.setNow(AFTER);
  tick(f);
  settle(f, 'info', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'work_related' });
  const args = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' }, data = f.data(), r = data.info_requests.find(x => x.type === 'accident');
  const token = T.makeToken({ ctx: f.ctx, data, actor: 'm-1', action: 'info', kind: 'request', id: r.info_request_id, subject: T.requestSubject(data, r), args: T.businessArgs('info', args), targetVersion: r.request_version });
  assert.equal(preview(f, 'info', args).status, 'info_not_requested');
  ok(f, token);
  const before = f.data();
  assert.deepEqual(confirm(f, 'info', args, token), { status: 'info_not_requested', message: 'Line ln-1 of claim cl-7 has no open accident question.' });
  assert.deepEqual(f.data(), before);
  settle(f, 'cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' });
  assert.deepEqual(eobsOf(f, 'cl-7')[0].lines.map(l => l.reason), ['other_party_liable']);
});

test('T05 coverage.cob: an unknown plan year is not_found from preview and confirm; a year the member is not enrolled in is info_not_requested; a confirm restating another known year is stale_preview', () => {
  const s = S.edit(S.pendingCob('m-3', 2026), x => {
    x.members.find(m => m.member_id === 'm-3').enrolled_years = [2026, 2027];
    x.coverage = x.coverage.filter(c => !(c.member_id === 'm-3' && c.plan_year === 2025));
    x.accumulators = x.accumulators.filter(c => !(c.member_id === 'm-3' && c.plan_year === 2025));
  });
  const f = fixture({ seed: s });
  const args = { member_id: 'm-3', plan_year: 2026, answer: 'none' };
  assert.deepEqual(preview(f, 'cob', { ...args, plan_year: 2025 }), { status: 'info_not_requested', message: 'No other-coverage question is open for member m-3 in plan year 2025.' });
  assert.deepEqual(preview(f, 'cob', { ...args, plan_year: 2024 }), { status: 'not_found', message: 'The plan has no plan year 2024.' });
  assert.equal(preview(f, 'cob', { ...args, member_id: 'm-9' }).status, 'not_found');
  const pv = approve(f, 'cob', args);
  const before = f.data();
  for (const plan_year of [2025, 2027]) assert.equal(confirm(f, 'cob', { ...args, plan_year }, pv.preview.token).status, 'stale_preview', String(plan_year));
  assert.deepEqual(confirm(f, 'cob', { ...args, plan_year: 2024 }, pv.preview.token), { status: 'not_found', message: 'The plan has no plan year 2024.' });
  assert.deepEqual(f.data(), before);
  assert.equal(confirm(f, 'cob', args, pv.preview.token).status, 'committed');
});

test('T05 a claim received after its PA expired, with the service date inside validity, is paid under that PA and its units are committed', () => {
  const s = attest(S.paApproved(2, { valid_from: '2026-11-01', valid_until: '2026-11-10' }), 'm-3', 2026);
  Object.assign(s.pas[0], { status: 'expired', expired_at: '2026-11-10T23:59:00-05:00' });
  const f = fixture({ seed: S.finalize(s) });
  receive(f, 'cl-7', 'm-3', [ln('ln-1', 1, 'svc-physical-therapy', '2026-11-09', 15000), ln('ln-2', 2, 'svc-physical-therapy', '2026-11-11', 15000)], 'pv-3');
  f.setNow(AFTER);
  tick(f);
  const e = eobsOf(f, 'cl-7')[0], pa = f.data().pas[0];
  assert.deepEqual(e.lines.map(l => [l.line_id, l.status, l.reason, l.pa_id, l.pa_units]), [['ln-1', 'paid', null, 'pa-1', 1], ['ln-2', 'denied', 'prior_auth_missing', null, 0]]);
  assert.deepEqual([pa.status, pa.units_used, pa.pa_version], ['expired', 1, 2]);
  reopen(f);
});

function batch(order, { late = false, extra = null, appeal = false, same = false } = {}) {
  const s = attest(actOn(), 'm-1', 2026);
  if (extra === 'g') attest(s, 'm-2', 2025);
  const t = '2026-11-18T10:00:00-05:00', received = { 'cl-a': '2026-11-13T09:00:00-05:00', 'cl-d': late ? '2026-11-13T12:00:00-05:00' : '2026-11-13T10:00:00-05:00', 'cl-b': same ? '2026-11-13T09:00:00-05:00' : '2026-11-13T11:00:00-05:00',
    'cl-e': '2026-11-13T08:00:00-05:00', 'cl-x': '2026-11-13T09:30:00-05:00', 'cl-g': '2026-11-13T09:40:00-05:00', 'cl-h': '2026-11-13T09:50:00-05:00', 'cl-m': '2026-11-13T09:45:00-05:00' };
  const ids = ['cl-a', 'cl-b', 'cl-d', ...(extra ? ['cl-' + extra] : []), ...(appeal ? ['cl-x'] : [])];
  const date = id => (id === 'cl-g' || id === 'cl-h' ? '2025-12-30' : '2026-11-12');
  let ir = 0;
  for (const id of ids) {
    const member = id === 'cl-e' ? 'm-1' : id === 'cl-m' ? 'm-3' : 'm-2';
    const c = S.claim(s, { claim_id: id, member_id: member, provider_id: id === 'cl-x' ? 'pv-5' : 'pv-1', received_at: received[id], lines: [ln('ln-1', 1, 'svc-office-visit', date(id), 21000, { possible_accident: ['cl-d', 'cl-e', 'cl-g'].includes(id) })] });
    Object.assign(c, { status: 'processed', processed_at: t });
    const types = id === 'cl-e' || id === 'cl-g' ? ['accident'] : id === 'cl-d' ? ['other_coverage', 'accident'] : ['other_coverage'];
    for (const type of types) s.info_requests.push({ info_request_id: 'ir-' + (++ir), request_version: 1, type, claim_id: id, line_id: 'ln-1', plan_year: Number(date(id).slice(0, 4)), opened_at: c.review_at, expires_at: S.due(c.review_at, 45), status: 'answered', answer: type === 'accident' ? 'not_accident' : 'none', answered_at: t });
  }
  s.issued.ir = String(ir);
  for (const y of extra === 'h' ? [2025, 2026] : [2026]) Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === y), { status: 'none', version: 1, attested_at: t });
  if (extra === 'm') Object.assign(s.coverage.find(c => c.member_id === 'm-3' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: t });
  for (const id of order) {
    if (id === 'v2') {
      const a = s.appeals[0];
      Object.assign(a, { status: 'overturned', decided_at: t, outcome: { lines: ['ln-1'], units: null, valid_until: null }, appeal_version: 1 });
      S.post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: 'cl-x', version: 2, issued_at: t, reason: 'appeal', appeal_id: a.appeal_id, lines: [S.paid('ln-1', 18000, { copay: 2500 }, 21000)] });
      continue;
    }
    S.process(s, id, [id === 'cl-x' ? S.denied('ln-1', 'out_of_network', 21000) : S.paid('ln-1', 18000, { copay: 2500 }, 21000)], t);
    if (id === 'cl-x') { S.window(s, 'claim', 'cl-x', t); S.finalize(s); S.openAppeal({ type: 'claim', id: 'cl-x' }, 'under_review', s, { filed_at: t }); }
  }
  return S.finalize(s);
}

test('T05 one attestation\'s batch: only claims it completed, in received order, may post between its first and last completion', () => {
  const load = s => plugin.validateSeed(ctxAt(T0), s), refuse = (s, re) => assert.throws(() => load(s), e => e.code === 'invalid_seed' && re.test(e.message), String(re));
  load(batch(['cl-a', 'cl-d', 'cl-b']));
  load(batch(['cl-a', 'cl-b', 'cl-d']));
  load(batch(['cl-a', 'cl-b', 'cl-d'], { late: true }));
  refuse(batch(['cl-a', 'cl-d', 'cl-b'], { late: true }), /One attestation completed cl-d before cl-b at 2026-11-18T10:00:00-05:00/);
  refuse(batch(['cl-b', 'cl-a', 'cl-d']), /One attestation completed cl-b before cl-a/);
  load(batch(['cl-e', 'cl-a', 'cl-d', 'cl-b'], { extra: 'e' }));
  load(batch(['cl-a', 'cl-d', 'cl-b', 'cl-e'], { extra: 'e' }));
  refuse(batch(['cl-a', 'cl-e', 'cl-b', 'cl-d'], { extra: 'e' }), /EOB eob-3 was posted inside the batch of the attestation of m-2 for 2026 at 2026-11-18T10:00:00-05:00, but that attestation did not complete its claim\./);
  refuse(batch(['cl-a', 'cl-m', 'cl-b', 'cl-d'], { extra: 'm' }), /EOB eob-3 was posted inside the batch of the attestation of m-2 for 2026 at 2026-11-18T10:00:00-05:00, but that attestation did not complete its claim\./);
  load(batch(['cl-m', 'cl-a', 'cl-d', 'cl-b'], { extra: 'm' }));
  load(batch(['cl-a', 'cl-d', 'cl-b', 'cl-m'], { extra: 'm' }));
  for (const extra of ['g', 'h']) {
    refuse(batch(['cl-a', 'cl-' + extra, 'cl-b', 'cl-d'], { extra }), /EOB eob-3 was posted inside the batch of the attestation of m-2 for 2026/);
    load(batch(['cl-' + extra, 'cl-a', 'cl-d', 'cl-b'], { extra }));
    load(batch(['cl-a', 'cl-d', 'cl-b', 'cl-' + extra], { extra }));
  }
  load(batch(['cl-a', 'cl-b', 'cl-d'], { same: true }));
  refuse(batch(['cl-b', 'cl-a', 'cl-d'], { same: true }), /One attestation completed cl-b before cl-a/);
  load(batch(['cl-a', 'cl-x', 'cl-b', 'cl-d', 'v2'], { appeal: true }));
  refuse(batch(['cl-a', 'cl-x', 'v2', 'cl-b', 'cl-d'], { appeal: true }), /EOB eob-4 was posted inside the batch of the attestation of m-2 for 2026/);
});

test('T05 a seeded overturned claim reads with its EOBs as v1 then v2 and each line\'s outcome from v2', () => {
  const f = fixture({ seed: S.overturned(['ln-2']) });
  const c = f.call(P + 'claims.get', { claim_id: 'cl-3' }).claim;
  assert.deepEqual([c.eobs.map(e => [e.version, e.reason]), c.lines.map(l => [l.line_id, l.outcome.status, l.outcome.reason])], [[[1, 'initial'], [2, 'appeal']], [['ln-1', 'denied', 'out_of_network'], ['ln-2', 'paid', null]]]);
  assert.deepEqual(f.call(P + 'claims.list', { member_id: 'm-1' }).claims.find(x => x.claim_id === 'cl-3').eobs.map(e => e.version), [1, 2]);
});
