'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const { compile } = require('./schema-validator.cjs');
const binding = require('../fixtures/binding.json');

const P = 'larkfield-health.';
const T0 = '2026-11-18T12:00:00-05:00', D15 = '2026-12-03T23:59:00-05:00';
const eventValid = compile(require('../schemas/events.schema.json'), path.join(__dirname, '..', 'schemas'));
let n = 0;
const ev = (f, operation, payload, at = f.ctx.virtual_now) => f.event({ event_id: 'e6-' + (++n), at, operation, payload });
const tick = f => assert.equal(ev(f, 'user.confirmed', { token: 'tok-7c1e', confirmed_by: 'm-1' }).status, 'committed');
const submit = (f, pa_id, over = {}) => ev(f, 'pa.submitted', { pa_id, member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 4, valid_from: '2026-12-01', valid_until: '2027-01-31', ...over });
const decide = (f, pa_id, over = {}) => ev(f, 'pa.decided', { pa_id, decision: 'approved', units: 4, valid_from: '2026-12-01', valid_until: '2027-01-31', ...over });
const paOf = (f, id) => f.data().pas.find(p => p.pa_id === id);
const get = (f, id) => f.call(P + 'pa.get', { pa_id: id });
const noticesOf = (f, id) => f.data().notices.filter(x => x.subject.id === id);
const at = (date, hhmm = '10:00') => date + 'T' + hhmm + ':00-05:00';
const ctxAt = now => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now, binding: structuredClone(binding) });
const ln = (id, pos, svc, date, billed, extra) => S.line(id, pos, svc, date, billed, extra);
const receive = (f, claim_id, member_id, lines, provider_id = 'pv-3') => ev(f, 'claim.received', { claim_id, member_id, provider_id, lines: lines.map(({ position, ...l }) => l) });
const attest = (s, member, year) => { Object.assign(s.coverage.find(c => c.member_id === member && c.plan_year === year), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' }); return s; };
function reopen(f) {
  const data = JSON.parse(JSON.stringify(f.data()));
  for (const later of [f.ctx.virtual_now, new Date(Date.parse(f.ctx.virtual_now) + 400 * 86400000).toISOString()]) assert.doesNotThrow(() => plugin.validateSeed(ctxAt(later), data), later);
  return fixture({ seed: { ...data, approvals: [] }, now: f.ctx.virtual_now });
}
const steady = (f, id, op, payload) => {
  const before = f.data(), out = ev(f, op, payload);
  assert.equal(out.status, 'committed', op);
  assert.deepEqual([paOf(f, id), f.data().notices], [before.pas.find(p => p.pa_id === id), before.notices], op + ' ' + JSON.stringify(payload));
};

test('T06 pa.submitted opens a pending PA due 23:59 on day 15; information requested and provided keep the due date; approval notifies; validity end expires it', () => {
  const f = fixture({ seed: S.base() });
  assert.equal(submit(f, 'pa-7').status, 'committed');
  const pending = get(f, 'pa-7').pa;
  assert.deepEqual(pending, { pa_id: 'pa-7', pa_version: 0, member_id: 'm-3', provider: { provider_id: 'pv-3', name: 'Fernhollow Physical Therapy', kind: 'therapy', in_network: true }, service: { service_id: 'svc-physical-therapy', description: 'Physical therapy session', category: 'therapy' },
    status: 'pending', submitted_at: T0, requested: { units: 4, valid_from: '2026-12-01', valid_until: '2027-01-31' }, approved: null, units_used: 0, info_requests: [], expedite: null, due_at: D15, overdue: false, overdue_at: null,
    decided_at: null, expired_at: null, denial_notice_at: null, appeal_window: null, covered_submissions: [], appeal_ids: [], approvals: [] });
  f.setNow(at('2026-11-19'));
  ev(f, 'pa.info_requested', { pa_id: 'pa-7', request: 'Notes from the last two visits' });
  assert.deepEqual([paOf(f, 'pa-7').status, paOf(f, 'pa-7').info_requests, paOf(f, 'pa-7').due_at, paOf(f, 'pa-7').pa_version], ['info_requested', [{ at: at('2026-11-19'), text: 'Notes from the last two visits' }], D15, 1]);
  f.setNow(at('2026-11-20'));
  ev(f, 'pa.info_provided', { pa_id: 'pa-7' });
  assert.deepEqual([paOf(f, 'pa-7').status, paOf(f, 'pa-7').due_at, paOf(f, 'pa-7').pa_version], ['pending', D15, 2]);
  f.setNow(at('2026-11-21'));
  decide(f, 'pa-7');
  const p = paOf(f, 'pa-7');
  assert.deepEqual([p.status, p.approved, p.approved_after_post, p.decided_at, p.expired_at, p.pa_version], ['approved', { units: 4, valid_from: '2026-12-01', valid_until: '2027-01-31' }, '1', at('2026-11-21'), null, 3]);
  assert.deepEqual(noticesOf(f, 'pa-7').map(x => [x.kind, x.recipient_id, x.at, x.body]), ['m-1', 'm-2', 'm-3'].map(r => ['notice.pa_decision', r, at('2026-11-21'), 'Prior authorization pa-7 for member m-3 was approved: 4 units, valid 2026-12-01 to 2027-01-31.']));
  assert.deepEqual(noticesOf(f, 'pa-7')[0].fields, { pa_id: 'pa-7', status: 'approved', units: 4, valid_from: '2026-12-01', valid_until: '2027-01-31' });
  f.setNow('2027-01-31T23:58:59.999-05:00');
  assert.equal(get(f, 'pa-7').pa.status, 'approved');
  f.setNow('2027-02-01T09:00:00-05:00');
  assert.deepEqual([get(f, 'pa-7').pa.status, get(f, 'pa-7').pa.expired_at, paOf(f, 'pa-7').status], ['expired', '2027-01-31T23:59:00-05:00', 'approved']);
  const notes = f.data().notices.length;
  tick(f);
  assert.deepEqual([paOf(f, 'pa-7').status, paOf(f, 'pa-7').expired_at, paOf(f, 'pa-7').pa_version, f.data().notices.length], ['expired', '2027-01-31T23:59:00-05:00', 4, notes]);
  reopen(f);
});

test('T06 a PA denied straight from info_requested opens its appeal window and says until when', () => {
  const f = fixture({ seed: S.granted(S.base(), 'm-2', 'view') });
  submit(f, 'pa-8', { member_id: 'm-2', provider_id: 'pv-4', service_id: 'svc-arthroscopy', units: 1 });
  ev(f, 'pa.info_requested', { pa_id: 'pa-8', request: 'Imaging report' });
  f.setNow(at('2026-11-20'));
  ev(f, 'pa.decided', { pa_id: 'pa-8', decision: 'denied' });
  const p = get(f, 'pa-8').pa;
  assert.deepEqual([p.status, p.decided_at, p.denial_notice_at, p.approved, p.appeal_window], ['denied', at('2026-11-20'), at('2026-11-20'), null, { notice_at: at('2026-11-20'), ends_at: '2027-05-19T23:59:00-04:00', closing_notice_at: null }]);
  assert.deepEqual(f.data().windows.map(w => [w.target, w.closing.due_at]), [[{ type: 'pa', id: 'pa-8' }, '2027-05-05T23:59:00-04:00']]);
  assert.deepEqual(noticesOf(f, 'pa-8').map(x => [x.recipient_id, x.body, x.fields.status, x.fields.units]), ['m-1', 'm-2'].map(r => [r, 'Prior authorization pa-8 for member m-2 was denied. An appeal can be filed before 23:59 Eastern Time on 2027-05-19.', 'denied', null]));
  reopen(f);
});

test('T06 the spec example events, with an Agent expedite between ev-4 and ev-5, end with ev-6\'s notice body verbatim', () => {
  const spec = require('./spec-events.json').envelopes;
  const f = fixture({ seed: S.base(), now: '2026-12-01T09:00:00-05:00' });
  for (const e of spec.slice(1, 4)) assert.equal(f.event(e).status, 'committed', e.event_id);
  f.setNow('2026-12-03T12:00:00-05:00');
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-4' }).pa.expedite.reason, null);
  for (const e of spec.slice(4, 6)) assert.equal(f.event(e).status, 'committed', e.event_id);
  const p = get(f, 'pa-4').pa;
  assert.deepEqual([p.status, p.due_at, p.overdue, p.expedite, p.info_requests], ['approved', '2026-12-06T12:00:00-05:00', false, { requested_at: '2026-12-03T12:00:00-05:00', reason: null, status: 'approved', decided_at: '2026-12-03T15:00:00-05:00' }, [{ at: '2026-12-02T10:00:00-05:00', text: 'Notes from the last two visits' }]]);
  assert.deepEqual(f.data().notices.map(x => [x.notice_id, x.kind, x.recipient_id, x.at, x.body]), ['m-1', 'm-2', 'm-3'].map((r, i) => ['n-' + (i + 1), 'notice.pa_decision', r, '2026-12-04T10:00:00-05:00', 'Prior authorization pa-4 for member m-3 was approved: 12 units, valid 2026-12-01 to 2027-02-28.']));
  reopen(f);
});

test('T07 expedite: recorded once; a second is duplicate_request; a decided PA is expedite_not_allowed; the reason is limited to 2,000 characters', () => {
  const f = fixture({ seed: S.base() });
  submit(f, 'pa-7');
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-7', reason: 'y'.repeat(2001) }).status, 'invalid_arguments');
  const out = f.call(P + 'pa.request_expedite', { pa_id: 'pa-7', reason: '😀'.repeat(2000) });
  assert.deepEqual([out.status, out.pa.expedite.status, out.pa.expedite.requested_at, out.pa.pa_version], ['committed', 'open', T0, 1]);
  assert.deepEqual(f.call(P + 'pa.request_expedite', { pa_id: 'pa-7' }), { status: 'duplicate_request', message: 'PA pa-7 already has an expedite request.' });
  ev(f, 'pa.info_requested', { pa_id: 'pa-7', request: 'More' });
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-7' }).status, 'duplicate_request');
  submit(f, 'pa-8');
  ev(f, 'pa.info_requested', { pa_id: 'pa-8', request: 'More' });
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-8' }).status, 'committed');
  decide(f, 'pa-7');
  assert.deepEqual(f.call(P + 'pa.request_expedite', { pa_id: 'pa-7' }), { status: 'expedite_not_allowed', message: 'PA pa-7 is approved; only a pending PA can be expedited.' });
  submit(f, 'pa-9', { units: 5 });
  ev(f, 'pa.withdrawn', { pa_id: 'pa-9' });
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-9' }).status, 'expedite_not_allowed');
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-1' }).status, 'not_found');
  const v = fixture({ seed: S.granted(S.base(), 'm-2', 'view') });
  submit(v, 'pa-7', { member_id: 'm-2' });
  assert.equal(v.call(P + 'pa.request_expedite', { pa_id: 'pa-7' }).status, 'not_authorized');
  reopen(f);
});

test('T07 an approved expedite moves the due time to 72 hours after the request only when earlier; a past one makes the PA overdue at once, once', () => {
  const run = (requested, decided, decision = 'approved') => {
    const f = fixture({ seed: S.base() });
    submit(f, 'pa-7');
    f.setNow(requested);
    f.call(P + 'pa.request_expedite', { pa_id: 'pa-7' });
    f.setNow(decided);
    assert.equal(ev(f, 'pa.expedite_decided', { pa_id: 'pa-7', decision }).status, 'committed');
    return f;
  };
  const day13 = run(at('2026-12-01'), at('2026-12-02'));
  assert.deepEqual([paOf(day13, 'pa-7').due_at, paOf(day13, 'pa-7').overdue, paOf(day13, 'pa-7').expedite.status, noticesOf(day13, 'pa-7')], [D15, false, 'approved', []]);
  reopen(day13);
  const day1 = run(at('2026-11-19'), at('2026-11-23'));
  const p = paOf(day1, 'pa-7');
  assert.deepEqual([p.due_at, p.overdue, p.overdue_at, p.pa_version], [at('2026-11-22'), true, at('2026-11-23'), 2]);
  assert.deepEqual(noticesOf(day1, 'pa-7').map(x => [x.kind, x.recipient_id, x.at, x.fields]), ['m-1', 'm-2', 'm-3'].map(r => ['notice.decision_overdue', r, at('2026-11-23'), { due_at: at('2026-11-22') }]));
  day1.setNow(at('2026-12-10'));
  tick(day1);
  assert.equal(noticesOf(day1, 'pa-7').length, 3);
  reopen(day1);
  const exact = run(at('2026-11-19'), at('2026-11-22'));
  assert.deepEqual([paOf(exact, 'pa-7').due_at, paOf(exact, 'pa-7').overdue_at], [at('2026-11-22'), at('2026-11-22')]);
  reopen(exact);
  const ahead = run(at('2026-11-28'), at('2026-11-29'));
  assert.deepEqual([paOf(ahead, 'pa-7').due_at, paOf(ahead, 'pa-7').overdue], [at('2026-12-01'), false]);
  ahead.setNow(at('2026-12-01', '10:30'));
  tick(ahead);
  assert.deepEqual([paOf(ahead, 'pa-7').overdue_at, noticesOf(ahead, 'pa-7').map(x => x.at)], [at('2026-12-01'), [at('2026-12-01'), at('2026-12-01'), at('2026-12-01')]]);
  reopen(ahead);
  const denied = run(at('2026-11-19'), at('2026-11-23'), 'denied');
  assert.deepEqual([paOf(denied, 'pa-7').due_at, paOf(denied, 'pa-7').overdue, paOf(denied, 'pa-7').expedite], [D15, false, { requested_at: at('2026-11-19'), reason: null, status: 'denied', decided_at: at('2026-11-23') }]);
  steady(denied, 'pa-7', 'pa.expedite_decided', { pa_id: 'pa-7', decision: 'approved' });
  reopen(denied);
  const late = run(at('2026-11-19'), '2026-12-05T10:00:00-05:00');
  assert.deepEqual([paOf(late, 'pa-7').overdue_at, paOf(late, 'pa-7').due_at, noticesOf(late, 'pa-7').map(x => x.at)], [D15, at('2026-11-22'), [D15, D15, D15]]);
  reopen(late);
});

test('T07 the pa_due timer flags a pending PA overdue once at its due time; reads project it; a PA decided before its due date never becomes overdue', () => {
  const f = fixture({ seed: S.base() });
  submit(f, 'pa-7');
  submit(f, 'pa-8');
  f.setNow(at('2026-11-25'));
  decide(f, 'pa-8');
  f.setNow('2026-12-03T23:58:59.999-05:00');
  assert.equal(get(f, 'pa-7').pa.overdue, false);
  f.setNow(at('2026-12-04'));
  assert.deepEqual([get(f, 'pa-7').pa.overdue, get(f, 'pa-7').pa.overdue_at, paOf(f, 'pa-7').overdue], [true, D15, false]);
  tick(f);
  assert.deepEqual([paOf(f, 'pa-7').overdue_at, paOf(f, 'pa-7').pa_version, noticesOf(f, 'pa-7').map(x => [x.kind, x.at, x.body])], [D15, 1, ['m-1', 'm-2', 'm-3'].map(() => ['notice.decision_overdue', D15, 'The decision on prior authorization pa-7 for member m-3 was due by 2026-12-03 at 23:59 Eastern Time and is overdue.'])]);
  f.setNow(at('2026-12-20'));
  tick(f);
  assert.deepEqual([noticesOf(f, 'pa-7').length, paOf(f, 'pa-8').overdue], [3, false]);
  decide(f, 'pa-7');
  assert.deepEqual([paOf(f, 'pa-7').status, paOf(f, 'pa-7').overdue, paOf(f, 'pa-7').overdue_at], ['approved', true, D15]);
  reopen(f);
});

test('T08 a decision after withdrawal is a committed no-op that still moves the clock; info events in the wrong state are committed no-ops', () => {
  const f = fixture({ seed: S.base() });
  submit(f, 'pa-7');
  submit(f, 'pa-8');
  ev(f, 'pa.info_requested', { pa_id: 'pa-8', request: 'More' });
  f.setNow(at('2026-11-20'));
  assert.equal(ev(f, 'pa.withdrawn', { pa_id: 'pa-7' }).status, 'committed');
  assert.deepEqual([paOf(f, 'pa-7').status, paOf(f, 'pa-7').pa_version], ['withdrawn', 1]);
  ev(f, 'pa.withdrawn', { pa_id: 'pa-8' });
  assert.equal(paOf(f, 'pa-8').status, 'withdrawn');
  f.setNow(at('2026-11-21'));
  steady(f, 'pa-7', 'pa.decided', { pa_id: 'pa-7', decision: 'approved', units: 1, valid_from: '2026-12-31', valid_until: '2026-12-01' });
  steady(f, 'pa-7', 'pa.decided', { pa_id: 'pa-7', decision: 'approved', units: 1, valid_from: '2026-02-30', valid_until: '2026-12-01' });
  steady(f, 'pa-7', 'pa.decided', { pa_id: 'pa-7', decision: 'denied' });
  steady(f, 'pa-7', 'pa.withdrawn', { pa_id: 'pa-7' });
  steady(f, 'pa-7', 'pa.info_requested', { pa_id: 'pa-7', request: 'x'.repeat(3000) });
  steady(f, 'pa-7', 'pa.info_provided', { pa_id: 'pa-7' });
  steady(f, 'pa-7', 'pa.expedite_decided', { pa_id: 'pa-7', decision: 'approved' });
  assert.equal(f.ctx.virtual_now, at('2026-11-21'));
  submit(f, 'pa-9');
  steady(f, 'pa-9', 'pa.info_provided', { pa_id: 'pa-9' });
  steady(f, 'pa-9', 'pa.expedite_decided', { pa_id: 'pa-9', decision: 'approved' });
  ev(f, 'pa.info_requested', { pa_id: 'pa-9', request: 'Visit notes' });
  steady(f, 'pa-9', 'pa.info_requested', { pa_id: 'pa-9', request: 'Again' });
  decide(f, 'pa-9');
  steady(f, 'pa-9', 'pa.info_provided', { pa_id: 'pa-9' });
  steady(f, 'pa-9', 'pa.withdrawn', { pa_id: 'pa-9' });
  steady(f, 'pa-9', 'pa.decided', { pa_id: 'pa-9', decision: 'denied' });
  const malformed = { event_id: 'm-1', at: at('2026-11-21'), operation: 'pa.decided', payload: { pa_id: 'pa-7', decision: 'approved', units: 1 } };
  assert.ok(!eventValid(malformed));
  reopen(f);
});

test('T08 a submission an approved PA fully covers adds a covered submission, no PA, units or notice; the covering PA is the earliest-ending, then the lower ID', () => {
  const s = S.paApproved(12, { valid_from: '2026-11-05', valid_until: '2027-02-28' });
  s.pas.push({ ...structuredClone(s.pas[0]), pa_id: 'pa-0', approved: { units: 12, valid_from: '2026-11-01', valid_until: '2027-02-28' }, requested: { units: 12, valid_from: '2026-11-01', valid_until: '2027-02-28' } });
  s.pas.push({ ...structuredClone(s.pas[0]), pa_id: 'pa-5', approved: { units: 2, valid_from: '2026-11-01', valid_until: '2027-03-31' }, requested: { units: 2, valid_from: '2026-11-01', valid_until: '2027-03-31' } });
  s.pas.push({ ...structuredClone(s.pas[0]), pa_id: 'pa-6', approved: { units: 1, valid_from: '2026-11-01', valid_until: '2027-01-31' }, requested: { units: 1, valid_from: '2026-11-01', valid_until: '2027-01-31' } });
  const f = fixture({ seed: S.finalize(s) });
  const before = f.data();
  assert.equal(submit(f, 'pa-7', { units: 12, valid_from: '2026-12-01', valid_until: '2027-01-31' }).status, 'committed');
  assert.deepEqual([f.data().pas.length, paOf(f, 'pa-0').covered_submissions, paOf(f, 'pa-0').pa_version, paOf(f, 'pa-1').covered_submissions, f.data().notices], [4, [{ pa_id: 'pa-7', provider_id: 'pv-3', units: 12, valid_from: '2026-12-01', valid_until: '2027-01-31', at: T0 }], 2, [], before.notices]);
  assert.deepEqual(get(f, 'pa-0').pa.covered_submissions, [{ pa_id: 'pa-7', provider_id: 'pv-3', units: 12, valid_from: '2026-12-01', valid_until: '2027-01-31', at: T0 }]);
  assert.equal(paOf(f, 'pa-0').units_used, 0);
  for (const id of ['pa-7', 'pa-1']) assert.deepEqual(submit(f, id), { status: 'invalid_event', message: 'PA ' + id + ' already exists.' });
  submit(f, 'pa-8', { units: 2, valid_from: '2027-03-01', valid_until: '2027-03-31' });
  assert.equal(paOf(f, 'pa-5').covered_submissions[0].pa_id, 'pa-8');
  for (const [id, over] of [['pa-9', { units: 13 }], ['pa-10', { valid_until: '2027-04-01' }], ['pa-11', { valid_from: '2026-10-31' }], ['pa-12', { member_id: 'm-2' }], ['pa-13', { service_id: 'svc-arthroscopy' }]]) {
    submit(f, id, over);
    assert.equal(paOf(f, id).status, 'pending', id);
  }
  submit(f, 'pa-16', { units: 1, valid_from: '2026-12-01', valid_until: '2027-01-31' });
  assert.equal(paOf(f, 'pa-6').covered_submissions[0].pa_id, 'pa-16');
  submit(f, 'pa-14', { units: 12, valid_from: '2026-11-05', valid_until: '2027-02-28' });
  assert.equal(paOf(f, 'pa-0').covered_submissions.at(-1).pa_id, 'pa-14');
  reopen(f);
  const g = fixture({ seed: S.finalize(S.edit(S.paApproved(), x => { x.pas.unshift({ ...structuredClone(x.pas[0]), pa_id: 'pa-2' }); })) });
  submit(g, 'pa-7', { units: 1 });
  assert.deepEqual([g.data().pas.map(p => [p.pa_id, p.covered_submissions.length])], [[['pa-2', 0], ['pa-1', 1]]]);
  const x = fixture({ seed: S.paApproved(), now: '2027-03-01T09:00:00-05:00' });
  submit(x, 'pa-7', { valid_from: '2027-03-02', valid_until: '2027-03-03' });
  assert.equal(paOf(x, 'pa-7').status, 'pending');
  reopen(x);
});

test('T08 approvals: a cutoff already passed expires at once keeping its values; an inverted interval only then; invalid dates and inverted submissions are invalid_event', () => {
  const f = fixture({ seed: S.base() });
  submit(f, 'pa-7', { valid_from: '2026-11-01', valid_until: '2026-11-10' });
  ev(f, 'pa.info_requested', { pa_id: 'pa-7', request: 'More' });
  decide(f, 'pa-7', { units: 3, valid_from: '2026-11-01', valid_until: '2026-11-18' });
  assert.deepEqual([paOf(f, 'pa-7').status, paOf(f, 'pa-7').expired_at], ['approved', null]);
  submit(f, 'pa-8');
  decide(f, 'pa-8', { units: 3, valid_from: '2026-11-01', valid_until: '2026-11-17' });
  const p8 = paOf(f, 'pa-8');
  assert.deepEqual([p8.status, p8.approved, p8.decided_at, p8.expired_at], ['expired', { units: 3, valid_from: '2026-11-01', valid_until: '2026-11-17' }, T0, T0]);
  assert.deepEqual(noticesOf(f, 'pa-8').map(x => [x.body, x.fields.status]), ['m-1', 'm-2', 'm-3'].map(() => ['Prior authorization pa-8 for member m-3 was approved: 3 units, valid 2026-11-01 to 2026-11-17. That validity has already ended.', 'expired']));
  submit(f, 'pa-9');
  decide(f, 'pa-9', { units: 2, valid_from: '2026-11-17', valid_until: '2026-11-10' });
  assert.deepEqual([paOf(f, 'pa-9').status, paOf(f, 'pa-9').approved, paOf(f, 'pa-9').decided_at, paOf(f, 'pa-9').expired_at], ['expired', { units: 2, valid_from: '2026-11-17', valid_until: '2026-11-10' }, T0, T0]);
  submit(f, 'pa-10');
  const before = f.data();
  for (const [payload, why] of [[{ valid_from: '2026-12-31', valid_until: '2026-12-01' }, 'The approval of PA pa-10 is valid from 2026-12-31, after its end 2026-12-01.'], [{ valid_from: '2026-02-30' }, 'The approval of PA pa-10 has an invalid date 2026-02-30.'], [{ valid_until: '2201-01-01' }, 'The approval of PA pa-10 has an invalid date 2201-01-01.']]) {
    assert.deepEqual(decide(f, 'pa-10', payload), { status: 'invalid_event', message: why });
  }
  for (const [over, why] of [[{ valid_from: '2026-12-02', valid_until: '2026-12-01' }, 'PA pa-11 is valid from 2026-12-02, after its end 2026-12-01.'], [{ valid_until: '2026-13-01' }, 'PA pa-11 has an invalid date 2026-13-01.'], [{ valid_from: '1999-12-31' }, 'PA pa-11 has an invalid date 1999-12-31.']]) {
    assert.deepEqual(submit(f, 'pa-11', over), { status: 'invalid_event', message: why });
  }
  assert.deepEqual(f.data(), before);
  decide(f, 'pa-10', { valid_from: '2200-01-01', valid_until: '2200-12-31' });
  assert.equal(paOf(f, 'pa-10').status, 'approved');
  submit(f, 'pa-11', { valid_from: '2000-01-01', valid_until: '2000-01-01', units: 9 });
  submit(f, 'pa-12', { valid_from: '2026-12-05', valid_until: '2026-12-05', units: 9 });
  decide(f, 'pa-12', { valid_from: '2026-12-05', valid_until: '2026-12-05' });
  assert.deepEqual([paOf(f, 'pa-11').status, paOf(f, 'pa-12').status, paOf(f, 'pa-12').approved.valid_from], ['pending', 'approved', '2026-12-05']);
  reopen(f);
});

test('T08 approved_after_post is the posting counter at the approval, "0" before any posting', () => {
  const f = fixture({ seed: S.household(), now: T0 });
  submit(f, 'pa-7');
  decide(f, 'pa-7');
  assert.equal(paOf(f, 'pa-7').approved_after_post, '0');
  reopen(f);
});

test('T06 pharmacy PAs from a pharmacy or prescriber are recorded and shown; from any other provider, and pharmacy claim lines, are invalid_event', () => {
  const s = S.edit(S.base(), x => { x.providers.push({ provider_id: 'pv-7', name: 'Tamblewick Pharmacy', kind: 'pharmacy', in_network: true }); });
  const f = fixture({ seed: s, binding: S.edit(structuredClone(binding), b => { b.objects['larkfield-health'].push('pv-7'); }) });
  for (const [id, provider] of [['pa-7', 'pv-1'], ['pa-8', 'pv-7']]) {
    assert.equal(submit(f, id, { provider_id: provider, service_id: 'svc-adalimumab-40', units: 6 }).status, 'committed');
    assert.deepEqual([get(f, id).pa.service.category, get(f, id).pa.provider.kind], ['pharmacy', provider === 'pv-1' ? 'prescriber' : 'pharmacy']);
  }
  assert.deepEqual(submit(f, 'pa-9', { provider_id: 'pv-2', service_id: 'svc-adalimumab-40' }), { status: 'invalid_event', message: 'A pharmacy PA must come from a pharmacy or a prescriber; pv-2 is a imaging.' });
  assert.equal(receive(f, 'cl-7', 'm-3', [ln('ln-1', 1, 'svc-adalimumab-40', '2026-11-17', 300000)], 'pv-7').status, 'invalid_event');
  decide(f, 'pa-8', { units: 6, valid_from: '2026-11-01', valid_until: '2026-12-31' });
  submit(f, 'pa-10', { provider_id: 'pv-7', service_id: 'svc-adalimumab-40', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-20' });
  assert.equal(paOf(f, 'pa-8').covered_submissions[0].pa_id, 'pa-10');
});

test('T06 information requests and expedites from info_requested; withdrawal and direct approval from it; request texts up to 2,000 characters', () => {
  const f = fixture({ seed: S.base() });
  for (const id of ['pa-7', 'pa-8', 'pa-9']) { submit(f, id); ev(f, 'pa.info_requested', { pa_id: id, request: 'Notes' }); }
  assert.equal(f.call(P + 'pa.request_expedite', { pa_id: 'pa-7' }).status, 'committed');
  ev(f, 'pa.withdrawn', { pa_id: 'pa-8' });
  decide(f, 'pa-9');
  assert.deepEqual(['pa-7', 'pa-8', 'pa-9'].map(id => paOf(f, id).status), ['info_requested', 'withdrawn', 'approved']);
  submit(f, 'pa-10', { units: 5 });
  assert.deepEqual(ev(f, 'pa.info_requested', { pa_id: 'pa-10', request: 'x'.repeat(2001) }), { status: 'invalid_event', message: 'The information request is longer than 2,000 characters.' });
  assert.equal(ev(f, 'pa.info_requested', { pa_id: 'pa-10', request: '😀'.repeat(2000) }).status, 'committed');
  reopen(f);
});

test('T05 through the lifecycle: an approved PA pays a claim in its validity and uses units; after it expired a line dated inside still pays; without a PA the line is prior_auth_missing', () => {
  const f = fixture({ seed: attest(S.household(), 'm-3', 2026), now: '2026-11-01T09:00:00-05:00' });
  submit(f, 'pa-7', { valid_from: '2026-11-01', valid_until: '2026-11-10', units: 2 });
  f.setNow('2026-11-02T09:00:00-05:00');
  decide(f, 'pa-7', { valid_from: '2026-11-01', valid_until: '2026-11-10', units: 2 });
  f.setNow('2026-11-03T09:00:00-05:00');
  receive(f, 'cl-7', 'm-3', [ln('ln-1', 1, 'svc-physical-therapy', '2026-11-02', 15000)]);
  f.setNow('2026-11-12T09:00:00-05:00');
  receive(f, 'cl-8', 'm-3', [ln('ln-1', 1, 'svc-physical-therapy', '2026-11-09', 15000), ln('ln-2', 2, 'svc-physical-therapy', '2026-11-11', 15000)]);
  f.setNow('2026-11-17T09:00:00-05:00');
  tick(f);
  const line = (c, l) => f.data().eobs.find(e => e.claim_id === c).lines.find(x => x.line_id === l);
  assert.deepEqual([line('cl-7', 'ln-1').pa_id, line('cl-8', 'ln-1').pa_id, line('cl-8', 'ln-2').reason, paOf(f, 'pa-7').status, paOf(f, 'pa-7').units_used], ['pa-7', 'pa-7', 'prior_auth_missing', 'expired', 2]);
  assert.equal(get(f, 'pa-7').pa.units_used, 2);
  reopen(f);
});

test('T06 a PA decision and the last accident answer at one instant load in both orders, each with its own EOB and PA mark', () => {
  const T = '2026-11-22T09:00:00-05:00';
  const start = () => {
    const f = fixture({ seed: attest(S.base(), 'm-3', 2026) });
    submit(f, 'pa-7', { valid_from: '2026-11-01', valid_until: '2026-12-31' });
    receive(f, 'cl-7', 'm-3', [ln('ln-1', 1, 'svc-physical-therapy', '2026-11-17', 15000, { possible_accident: true })]);
    f.setNow(T);
    tick(f);
    return f;
  };
  const args = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' };
  const answer = f => { const pv = f.call(P + 'claims.info.preview', args); tick(f); ev(f, 'user.confirmed', { token: pv.preview.token, confirmed_by: 'm-1' }); assert.equal(f.call(P + 'claims.info.confirm', { ...args, token: pv.preview.token }).status, 'committed'); };
  const first = start();
  decide(first, 'pa-7', { valid_from: '2026-11-01', valid_until: '2026-12-31' });
  answer(first);
  const second = start();
  answer(second);
  decide(second, 'pa-7', { valid_from: '2026-11-01', valid_until: '2026-12-31' });
  const facts = f => { const e = f.data().eobs.find(x => x.claim_id === 'cl-7'); return [e.issued_at, e.posting_seq, e.lines[0].reason, e.lines[0].pa_id, paOf(f, 'pa-7').approved_after_post, paOf(f, 'pa-7').units_used, f.data().issued.post]; };
  assert.deepEqual([facts(first), facts(second)], [[T, '2', null, 'pa-7', '1', 1, '2'], [T, '2', 'prior_auth_missing', null, '2', 0, '2']]);
  assert.deepEqual(second.data().windows.map(w => w.target.id), ['cl-7']);
  reopen(first);
  reopen(second);
});

test('T06 pa.list filters by member and status and shows only members the actor may view; pa.get on a hidden member is not_authorized', () => {
  const f = fixture({ seed: S.base() });
  submit(f, 'pa-7');
  submit(f, 'pa-8', { member_id: 'm-2' });
  submit(f, 'pa-10');
  decide(f, 'pa-10');
  assert.deepEqual(f.call(P + 'pa.list').pas.map(p => p.pa_id), ['pa-10', 'pa-7']);
  assert.deepEqual(f.call(P + 'pa.list', { status: 'pending' }).pas.map(p => p.pa_id), ['pa-7']);
  assert.deepEqual(f.call(P + 'pa.list', { member_id: 'm-3', status: 'approved' }).pas.map(p => p.pa_id), ['pa-10']);
  assert.deepEqual(f.call(P + 'pa.list', { member_id: 'm-1' }).pas, []);
  assert.equal(f.call(P + 'pa.list', { member_id: 'm-2' }).status, 'not_authorized');
  assert.equal(get(f, 'pa-8').status, 'not_authorized');
  f.setNow('2027-02-01T09:00:00-05:00');
  assert.deepEqual(f.call(P + 'pa.list', { status: 'expired' }).pas.map(p => p.pa_id), ['pa-10']);
  assert.deepEqual(f.call(P + 'pa.list', { status: 'pending' }).pas.map(p => [p.pa_id, p.overdue]), [['pa-7', true]]);
});

test('T06 a PA view lists its appeals and the actor\'s filing approvals', () => {
  const s = S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', S.deniedPa(S.paPending()));
  const f = fixture({ seed: S.granted(s, 'm-2', 'act') });
  assert.deepEqual(get(f, 'pa-2').pa.appeal_ids, []);
  const token = 'tok-file-pa-pa-3-' + 'a'.repeat(32);
  ev(f, 'user.confirmed', { token, confirmed_by: 'm-1' });
  const p = get(f, 'pa-3').pa;
  assert.deepEqual([p.appeal_ids, p.approvals.map(a => a.token), p.appeal_window.notice_at], [['ap-1'], [token], '2026-11-10T10:00:00-05:00']);
});

function rng(k) { let x = (k * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

test('T06 random PA, expedite and claim calls at one instant, sometimes a due time, commit in any order and every state loads', () => {
  const tallies = { events: 0, expedites: 0, covered: 0, overdue: 0, paid: 0 };
  for (let k = 1; k <= 60; k++) {
    const r = rng(k), pick = list => list[Math.floor(r() * list.length)];
    const f = fixture({ seed: S.granted(attest(attest(S.base(), 'm-3', 2026), 'm-2', 2026), 'm-2', 'act') });
    const member = () => pick(['m-2', 'm-3']), service = () => pick(['svc-physical-therapy', 'svc-arthroscopy']);
    const range = () => pick([['2026-11-01', '2026-11-21'], ['2026-11-10', '2026-12-31'], ['2026-11-15', '2027-01-31']]);
    let p = 0, c = 0;
    const newPa = () => { const [from, until] = range(); return ev(f, 'pa.submitted', { pa_id: 'pa-r' + (++p), member_id: member(), provider_id: 'pv-3', service_id: service(), units: 1 + Math.floor(r() * 3), valid_from: from, valid_until: until }); };
    const claim = () => receive(f, 'cl-r' + (++c), member(), [ln('ln-1', 1, service(), pick(['2026-11-16', '2026-11-17']), 15000, { possible_accident: r() < 0.3 })]);
    for (let i = 0; i < 3; i++) assert.equal(newPa().status, 'committed');
    for (const x of f.data().pas) if (x.status === 'pending' && r() < 0.4) decide(f, x.pa_id, { units: x.requested.units, valid_from: x.requested.valid_from, valid_until: x.requested.valid_until });
    for (const x of f.data().pas) if (x.status === 'pending' && r() < 0.5) f.call(P + 'pa.request_expedite', { pa_id: x.pa_id });
    for (let i = 0; i < 2; i++) assert.equal(claim().status, 'committed');
    f.setNow(pick(['2026-11-21T23:59:00-05:00', D15, '2026-11-21T23:59:00-05:00', '2026-12-31T23:59:00-05:00', '2026-11-19T09:00:00-05:00']));
    const actions = [];
    for (const x of f.call(P + 'pa.list').pas) {
      if (x.status === 'pending' || x.status === 'info_requested') actions.push(['decide', x], ['info', x], ['provided', x], ['withdraw', x], ['expedite', x], ['xdecide', x]);
      else actions.push(['late', x]);
    }
    actions.push(['submit'], ['submit'], ['claim'], ['tick']);
    for (const cl of f.call(P + 'claims.list').claims) for (const q of cl.info_requests) if (q.status === 'open') actions.push(['answer', cl.claim_id, q.line_id]);
    for (const [kind, x, line] of actions.map(a => [r(), a]).sort((a, b) => a[0] - b[0]).map(a => a[1])) {
      let out = { status: 'committed' };
      if (kind === 'decide') out = r() < 0.5 ? decide(f, x.pa_id, { units: x.requested.units, valid_from: x.requested.valid_from, valid_until: x.requested.valid_until }) : ev(f, 'pa.decided', { pa_id: x.pa_id, decision: 'denied' });
      if (kind === 'info') out = ev(f, 'pa.info_requested', { pa_id: x.pa_id, request: 'Visit notes' });
      if (kind === 'provided') out = ev(f, 'pa.info_provided', { pa_id: x.pa_id });
      if (kind === 'withdraw' && r() < 0.3) out = ev(f, 'pa.withdrawn', { pa_id: x.pa_id });
      if (kind === 'xdecide') out = ev(f, 'pa.expedite_decided', { pa_id: x.pa_id, decision: pick(['approved', 'denied']) });
      if (kind === 'late') out = decide(f, x.pa_id);
      if (kind === 'submit') out = newPa();
      if (kind === 'claim') out = claim();
      if (kind === 'tick') tick(f);
      if (kind === 'expedite') { const e = f.call(P + 'pa.request_expedite', { pa_id: x.pa_id }); assert.ok(['committed', 'duplicate_request', 'expedite_not_allowed'].includes(e.status), JSON.stringify(e)); if (e.status === 'committed') tallies.expedites++; continue; }
      if (kind === 'answer') {
        const args = { claim_id: x, line_id: line, answer: 'not_accident' }, pv = f.call(P + 'claims.info.preview', args);
        if (pv.status !== 'ok') continue;
        ev(f, 'user.confirmed', { token: pv.preview.token, confirmed_by: 'm-1' });
        out = f.call(P + 'claims.info.confirm', { ...args, token: pv.preview.token });
      }
      assert.equal(out.status, 'committed', k + ' ' + kind + ' ' + (x && x.pa_id) + ' ' + out.message);
      tallies.events++;
    }
    const d = f.data();
    tallies.covered += d.pas.reduce((t, x) => t + x.covered_submissions.length, 0);
    tallies.overdue += d.pas.filter(x => x.overdue).length;
    tallies.paid += d.eobs.flatMap(e => e.lines).filter(l => l.pa_id !== null).length;
    reopen(f);
  }
  assert.ok(tallies.events > 600 && tallies.expedites > 10 && tallies.covered > 5 && tallies.overdue > 10 && tallies.paid > 5, JSON.stringify(tallies));
});
