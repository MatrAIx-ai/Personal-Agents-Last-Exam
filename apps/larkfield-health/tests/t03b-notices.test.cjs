'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const N = require('../src/notices.cjs');
const { bump } = require('../src/util.cjs');
const binding = require('../fixtures/binding.json');

const AT = '2026-12-02T09:00:00-05:00';
const helpers = S.edit(structuredClone(binding), b => b.people.push({ person_id: 'p-7', name: 'Outside Helper' }, { person_id: 'p-8', name: 'Second Helper' }));
const grant = (id, member, grantor, grantee, scope, created_at, expires_at = null, revoked_at = null) => ({ grant_id: id, grant_version: 0, member_id: member, grantor_id: grantor, grantee_id: grantee, scope, created_at, expires_at, status: revoked_at ? 'revoked' : 'active', revoked_at });
const rows = list => list.map(n => [n.notice_id, n.recipient_id]);
const one = (list, recipients) => { assert.deepEqual(list.map(n => n.recipient_id), recipients); const { notice_id, recipient_id, ...rest } = list[0]; for (const n of list) { const { notice_id: a, recipient_id: b, ...r } = n; assert.deepEqual(r, rest); } return rest; };

test('T03b recipients at the instant: the member, a minor\'s guardians and view or act holders in force, one entry per person', () => {
  const s = S.full();
  s.grants.push(
    grant('gr-h2', 'm-3', 'm-2', 'm-1', 'act', '2026-01-01T00:00:00-05:00'),
    grant('gr-h3', 'm-3', 'm-1', 'p-7', 'view', '2026-01-01T00:00:00-05:00', AT),
    grant('gr-h4', 'm-3', 'm-1', 'p-8', 'act', '2026-01-01T00:00:00-05:00', null, '2026-11-10T09:00:00-05:00'),
    grant('gr-h5', 'm-2', 'm-2', 'p-8', 'act', '2026-12-02T09:00:00.001-05:00'),
    grant('gr-h6', 'm-1', 'm-1', 'p-7', 'act', '2026-01-01T00:00:00-05:00', '2026-02-01T00:00:00-05:00'),
    grant('gr-h7', 'm-1', 'm-1', 'p-8', 'view', '2026-11-01T00:00:00-04:00'));
  assert.deepEqual(N.recipients(s, 'm-3', '2026-12-02T08:59:59.999-05:00'), ['m-1', 'm-2', 'm-3', 'p-7']);
  assert.deepEqual(N.recipients(s, 'm-3', AT), ['m-1', 'm-2', 'm-3']);
  assert.deepEqual(N.recipients(s, 'm-2', AT), ['m-1', 'm-2']);
  assert.deepEqual(N.recipients(s, 'm-2', '2026-12-02T09:00:00.001-05:00'), ['m-1', 'm-2', 'p-8']);
  assert.deepEqual(N.recipients(s, 'm-1', AT), ['m-1', 'p-8']);
  assert.deepEqual(N.recipients(s, 'm-1', '2026-10-31T23:59:59-04:00'), ['m-1']);
  const added = N.decisionOverdue(s, 'pa', s.pas.find(p => p.pa_id === 'pa-2'), '2026-12-02T08:00:00-05:00');
  assert.deepEqual(rows(added), [['n-1', 'm-1'], ['n-2', 'm-2'], ['n-3', 'm-3'], ['n-4', 'p-7']]);
  assert.deepEqual(s.notices, added);
  assert.equal(s.issued.n, '4');
});

test('T03b notice IDs come from the counter and skip taken IDs; the instant is stored in Eastern Time; every entry has its own fields', () => {
  const s = S.full();
  s.notices.push({ notice_id: 'n-2', kind: 'notice.decision_overdue', recipient_id: 'm-1', subject: { type: 'pa', id: 'pa-2' }, member_id: 'm-3', at: '2026-11-17T09:00:00-05:00', title: 'Decision overdue', body: 'Old.', fields: { due_at: '2026-12-01T23:59:00-05:00' } });
  const added = N.decisionOverdue(s, 'pa', s.pas.find(p => p.pa_id === 'pa-2'), '2026-12-02T14:00:00Z');
  assert.deepEqual(added.map(n => [n.notice_id, n.at]), [['n-1', AT], ['n-3', AT], ['n-4', AT]]);
  added[0].fields.due_at = 'x';
  added[0].subject.id = 'y';
  assert.deepEqual([added[1].fields.due_at, added[1].subject.id], ['2026-12-01T23:59:00-05:00', 'pa-2']);
});

test('T03b eob_available: subject claim, fields claim_id, eob_version, member_cost_cents, plan_paid_cents', () => {
  const s = S.full(), c = s.claims.find(x => x.claim_id === 'cl-1');
  const got = one(N.eobAvailable(s, c, s.eobs.find(e => e.claim_id === 'cl-1'), AT), ['m-1']);
  assert.deepEqual(got, { kind: 'notice.eob_available', subject: { type: 'claim', id: 'cl-1' }, member_id: 'm-1', at: AT, title: 'Explanation of benefits available',
    body: 'Explanation of benefits version 1 for claim cl-1 (member m-1) is available: member cost $25.00, plan paid $155.00.', fields: { claim_id: 'cl-1', eob_version: 1, member_cost_cents: 2500, plan_paid_cents: 15500 } });
  const two = S.overturned(['ln-2']), v2 = two.eobs.find(e => e.claim_id === 'cl-3' && e.version === 2);
  assert.deepEqual(one(N.eobAvailable(two, two.claims.find(x => x.claim_id === 'cl-3'), v2, AT), ['m-1']).fields, { claim_id: 'cl-3', eob_version: 2, member_cost_cents: 5000, plan_paid_cents: 25000 });
});

test('T03b info_requested: subject the request, fields claim_id, line_id, type, expires_at, for each request type', () => {
  const s = S.granted(S.pendingCob('m-2', 2026, S.base(), true));
  const [cob, acc] = s.info_requests;
  const a = one(N.infoRequested(s, cob, AT), ['m-1', 'm-2']);
  assert.deepEqual(a, { kind: 'notice.info_requested', subject: { type: 'info_request', id: 'ir-1' }, member_id: 'm-2', at: AT, title: 'Information requested',
    body: 'Claim cl-4 for member m-2 needs an answer on whether the member has other coverage for plan year 2026 (line ln-1). Answer before 23:59 Eastern Time on 2026-12-31; an unanswered request can lead to a denial for missing information.',
    fields: { claim_id: 'cl-4', line_id: 'ln-1', type: 'other_coverage', expires_at: '2026-12-31T23:59:00-05:00' } });
  const b = one(N.infoRequested(s, acc, AT), ['m-1', 'm-2']);
  assert.deepEqual([b.subject, b.body, b.fields], [{ type: 'info_request', id: 'ir-2' },
    'Claim cl-4 for member m-2 needs an answer on whether the service on line ln-1 resulted from an accident. Answer before 23:59 Eastern Time on 2026-12-31; an unanswered request can lead to a denial for missing information.',
    { claim_id: 'cl-4', line_id: 'ln-1', type: 'accident', expires_at: '2026-12-31T23:59:00-05:00' }]);
});

test('T03b claim_denied: subject claim, fields claim_id, denied_lines, window_ends_at', () => {
  const s = S.full(), c = s.claims.find(x => x.claim_id === 'cl-3'), v1 = s.eobs.find(e => e.claim_id === 'cl-3');
  s.windows.unshift({ target: { type: 'claim', id: 'cl-1' }, notice_at: AT, ends_at: '2027-06-01T23:59:00-04:00', closing: { due_at: AT, done: false, notice_at: null } }, { target: { type: 'pa', id: 'cl-3' }, notice_at: AT, ends_at: '2027-06-02T23:59:00-04:00', closing: { due_at: AT, done: false, notice_at: null } });
  v1.lines[0] = { ...S.paid('ln-1', 150000, { ded: 150000 }, 180000) };
  v1.lines[1] = S.denied('ln-2', 'prior_auth_missing', 32000);
  const got = one(N.claimDenied(s, c, v1, '2026-11-15T23:59:00-05:00'), ['m-1']);
  assert.deepEqual(got, { kind: 'notice.claim_denied', subject: { type: 'claim', id: 'cl-3' }, member_id: 'm-1', at: '2026-11-15T23:59:00-05:00', title: 'Claim denied',
    body: 'Claim cl-3 for member m-1 has denied lines: ln-2 (no prior authorization). An appeal can be filed before 23:59 Eastern Time on 2027-05-14.', fields: { claim_id: 'cl-3', denied_lines: ['ln-2'], window_ends_at: '2027-05-14T23:59:00-04:00' } });
  const t = S.full(), w = t.eobs.find(e => e.claim_id === 'cl-3');
  w.lines = [S.denied('ln-1', 'out_of_network', 1), S.denied('ln-2', 'other_party_liable', 1), S.denied('ln-3', 'missing_information', 1)];
  assert.match(one(N.claimDenied(t, t.claims.find(x => x.claim_id === 'cl-3'), w, AT), ['m-1']).body, /denied lines: ln-1 \(out of network\), ln-2 \(another party is liable\), ln-3 \(information was not provided\)\. /);
});

test('T03b pa_decision: subject pa, fields pa_id, status, units, valid_from, valid_until, null when denied; the spec example body verbatim', () => {
  const s = S.paApproved(12, { valid_from: '2026-12-01', valid_until: '2027-02-28' });
  const pa = Object.assign(s.pas[0], { pa_id: 'pa-4' });
  const got = one(N.paDecision(s, pa, '2026-12-04T10:00:00-05:00'), ['m-1', 'm-2', 'm-3']);
  assert.deepEqual(got, { kind: 'notice.pa_decision', subject: { type: 'pa', id: 'pa-4' }, member_id: 'm-3', at: '2026-12-04T10:00:00-05:00', title: 'Prior authorization decision',
    body: 'Prior authorization pa-4 for member m-3 was approved: 12 units, valid 2026-12-01 to 2027-02-28.', fields: { pa_id: 'pa-4', status: 'approved', units: 12, valid_from: '2026-12-01', valid_until: '2027-02-28' } });
  Object.assign(pa, { status: 'expired', approved: { units: 1, valid_from: '2026-12-05', valid_until: '2026-12-01' } });
  const late = one(N.paDecision(s, pa, AT), ['m-1', 'm-2', 'm-3']);
  assert.deepEqual([late.body, late.fields], ['Prior authorization pa-4 for member m-3 was approved: 1 unit, valid 2026-12-05 to 2026-12-01. That validity has already ended.', { pa_id: 'pa-4', status: 'expired', units: 1, valid_from: '2026-12-05', valid_until: '2026-12-01' }]);
  const d = S.deniedPa(), p3 = d.pas[0];
  d.windows.unshift({ target: { type: 'pa', id: 'pa-1' }, notice_at: AT, ends_at: '2027-06-01T23:59:00-04:00', closing: { due_at: AT, done: false, notice_at: null } }, { target: { type: 'claim', id: 'pa-3' }, notice_at: AT, ends_at: '2027-06-02T23:59:00-04:00', closing: { due_at: AT, done: false, notice_at: null } });
  const denied = one(N.paDecision(d, p3, p3.decided_at), ['m-2']);
  assert.deepEqual([denied.subject, denied.member_id, denied.body, denied.fields], [{ type: 'pa', id: 'pa-3' }, 'm-2', 'Prior authorization pa-3 for member m-2 was denied. An appeal can be filed before 23:59 Eastern Time on 2027-05-09.', { pa_id: 'pa-3', status: 'denied', units: null, valid_from: null, valid_until: null }]);
  d.windows = [];
  assert.equal(one(N.paDecision(d, p3, p3.decided_at), ['m-2']).body, 'Prior authorization pa-3 for member m-2 was denied.');
});

test('T03b appeal_received, appeal_info_requested and appeal_decision: subject appeal, fields appeal_id, target, status, due_at', () => {
  const s = S.full(), a = s.appeals[0];
  const fields = { appeal_id: 'ap-1', target: { type: 'claim', id: 'cl-3' }, status: 'under_review', due_at: '2027-01-16T23:59:00-05:00' };
  const got = one(N.appealNotice(s, 'notice.appeal_received', a, '2026-11-17T09:00:00-05:00'), ['m-1']);
  assert.deepEqual(got, { kind: 'notice.appeal_received', subject: { type: 'appeal', id: 'ap-1' }, member_id: 'm-1', at: '2026-11-17T09:00:00-05:00', title: 'Appeal received',
    body: 'Appeal ap-1 of claim cl-3 for member m-1 was received; a decision is due by 2027-01-16 at 23:59 Eastern Time.', fields });
  const info = S.openAppeal(undefined, 'info_requested'), ai = info.appeals[0];
  const r = one(N.appealNotice(info, 'notice.appeal_info_requested', ai, ai.info_requests[0].at), ['m-1']);
  assert.deepEqual([r.title, r.body, r.fields], ['Appeal information requested', 'The plan asked for more information on appeal ap-1 of claim cl-3 for member m-1: "A copy of the referral". The decision is still due by 2027-01-16 at 23:59 Eastern Time.', { ...fields, status: 'info_requested' }]);
  const over = S.overturned(['ln-2']), ao = over.appeals[0];
  const d = one(N.appealNotice(over, 'notice.appeal_decision', ao, ao.decided_at), ['m-1']);
  assert.deepEqual([d.title, d.body, d.fields], ['Appeal decision', 'Appeal ap-1 of claim cl-3 for member m-1 was overturned for line ln-2; a new explanation of benefits was issued.', { ...fields, status: 'overturned' }]);
  ao.outcome.lines = ['ln-1', 'ln-2'];
  assert.match(one(N.appealNotice(over, 'notice.appeal_decision', ao, ao.decided_at), ['m-1']).body, /overturned for lines ln-1, ln-2;/);
  Object.assign(a, { status: 'upheld', decided_at: AT });
  assert.equal(one(N.appealNotice(s, 'notice.appeal_decision', a, AT), ['m-1']).body, 'Appeal ap-1 of claim cl-3 for member m-1 was upheld; the denial stands.');
  const pa = S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', undefined, { expedited: true }), ap = pa.appeals[0];
  const x = one(N.appealNotice(pa, 'notice.appeal_received', ap, ap.filed_at), ['m-2']);
  assert.deepEqual([x.member_id, x.body, x.fields], ['m-2', 'Expedited appeal ap-1 of prior authorization pa-3 for member m-2 was received; a decision is due by 2026-11-20 at 09:00 Eastern Time.', { appeal_id: 'ap-1', target: { type: 'pa', id: 'pa-3' }, status: 'under_review', due_at: '2026-11-20T09:00:00-05:00' }]);
  Object.assign(ap, { status: 'overturned', decided_at: AT, outcome: { lines: null, units: 2, valid_until: '2027-01-31' } });
  assert.equal(one(N.appealNotice(pa, 'notice.appeal_decision', ap, AT), ['m-2']).body, 'Expedited appeal ap-1 of prior authorization pa-3 for member m-2 was overturned: 2 units, valid until 2027-01-31.');
});

test('T03b appeal_window_closing: subject the claim or PA, fields target and window_ends_at', () => {
  const s = S.full();
  const c = one(N.windowClosing(s, s.windows[0], s.windows[0].closing.due_at), ['m-1']);
  assert.deepEqual(c, { kind: 'notice.appeal_window_closing', subject: { type: 'claim', id: 'cl-3' }, member_id: 'm-1', at: '2027-04-30T23:59:00-04:00', title: 'Appeal window closing',
    body: 'The appeal window for claim cl-3 (member m-1) closes on 2027-05-14 at 23:59 Eastern Time.', fields: { target: { type: 'claim', id: 'cl-3' }, window_ends_at: '2027-05-14T23:59:00-04:00' } });
  const p = one(N.windowClosing(s, s.windows[1], s.windows[1].closing.due_at), ['m-1', 'm-2']);
  assert.deepEqual([p.subject, p.member_id, p.body, p.fields], [{ type: 'pa', id: 'pa-3' }, 'm-2', 'The appeal window for prior authorization pa-3 (member m-2) closes on 2027-05-09 at 23:59 Eastern Time.', { target: { type: 'pa', id: 'pa-3' }, window_ends_at: '2027-05-09T23:59:00-04:00' }]);
});

test('T03b decision_overdue: subject the PA or appeal, fields due_at', () => {
  const s = S.full();
  const p = one(N.decisionOverdue(s, 'pa', s.pas.find(x => x.pa_id === 'pa-2'), '2026-12-01T23:59:00-05:00'), ['m-1', 'm-2', 'm-3']);
  assert.deepEqual(p, { kind: 'notice.decision_overdue', subject: { type: 'pa', id: 'pa-2' }, member_id: 'm-3', at: '2026-12-01T23:59:00-05:00', title: 'Decision overdue',
    body: 'The decision on prior authorization pa-2 for member m-3 was due by 2026-12-01 at 23:59 Eastern Time and is overdue.', fields: { due_at: '2026-12-01T23:59:00-05:00' } });
  const a = one(N.decisionOverdue(s, 'appeal', s.appeals[0], '2027-01-16T23:59:00-05:00'), ['m-1']);
  assert.deepEqual([a.subject, a.member_id, a.body, a.fields], [{ type: 'appeal', id: 'ap-1' }, 'm-1', 'The decision on appeal ap-1 for member m-1 was due by 2027-01-16 at 23:59 Eastern Time and is overdue.', { due_at: '2027-01-16T23:59:00-05:00' }]);
});

test('T03b a timer notice goes to the grants in force at its due time: a grant expiring before the commit still receives it, one expired before the due time does not', () => {
  const s = S.paPending();
  s.grants.push(grant('gr-h1', 'm-3', 'm-1', 'p-7', 'view', '2026-06-01T09:00:00-04:00', '2026-12-02T08:00:00-05:00'), grant('gr-h2', 'm-3', 'm-1', 'p-8', 'act', '2026-06-01T09:00:00-04:00', '2026-12-01T23:59:00-05:00'),
    grant('gr-h3', 'm-3', 'm-2', 'm-1', 'act', '2026-06-01T09:00:00-04:00'));
  const overdue = (data, pa, at) => { pa.overdue = true; pa.overdue_at = at; bump(data, pa, 'pa_id', 'pa_version'); N.decisionOverdue(data, 'pa', pa, at); };
  const f = fixture({ seed: S.finalize(s), now: AT, binding: helpers, effects: { pa_due: overdue } });
  assert.equal(f.event({ event_id: 'c-1', at: AT, operation: 'user.confirmed', payload: { token: 'tok-7c1e', confirmed_by: 'm-1' } }).status, 'committed');
  assert.deepEqual(f.data().notices.map(n => [n.notice_id, n.recipient_id, n.at]), [['n-1', 'm-1', '2026-12-01T23:59:00-05:00'], ['n-2', 'm-2', '2026-12-01T23:59:00-05:00'], ['n-3', 'm-3', '2026-12-01T23:59:00-05:00'], ['n-4', 'p-7', '2026-12-01T23:59:00-05:00']]);
});

test('T03b titles stay within 200 characters and bodies within 20,000 code points and UTF-16 units', () => {
  for (const t of Object.values(N.TITLES)) assert.ok(t.length > 0 && t.length <= 200);
  assert.equal(Object.keys(N.TITLES).length, 9);
  assert.deepEqual(Object.keys(N.TITLES).sort(), require('../schemas/seed.schema.json').properties.notices.items.properties.kind.enum.slice().sort());
  const s = S.full();
  const exact = 'x'.repeat(20000), long = 'x'.repeat(20001), astral = '😀'.repeat(10001);
  const [a] = N.notify(s, 'notice.decision_overdue', { type: 'pa', id: 'pa-3' }, 'm-1', AT, exact, {});
  const [b] = N.notify(s, 'notice.decision_overdue', { type: 'pa', id: 'pa-3' }, 'm-1', AT, long, {});
  const [c] = N.notify(s, 'notice.decision_overdue', { type: 'pa', id: 'pa-3' }, 'm-1', AT, astral, {});
  assert.equal(a.body, exact);
  assert.deepEqual([b.body.length, b.body.endsWith('x…')], [20000, true]);
  assert.ok(c.body.length <= 20000 && [...c.body].length <= 20000 && c.body.endsWith('😀…'));
  assert.equal(c.body.length, 19999);
  const [d] = N.notify(s, 'notice.decision_overdue', { type: 'pa', id: 'pa-3' }, 'm-1', AT, 'y'.repeat(19998) + '😀', {});
  assert.equal(d.body, 'y'.repeat(19998) + '😀');
  const [e] = N.notify(s, 'notice.decision_overdue', { type: 'pa', id: 'pa-3' }, 'm-1', AT, 'y'.repeat(19999) + '😀', {});
  assert.equal(e.body, 'y'.repeat(19999) + '…');
});
