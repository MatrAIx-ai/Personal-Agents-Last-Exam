'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');
const T = require('../src/tokens.cjs');

const P = 'larkfield-health.';
const T0 = '2026-11-18T12:00:00-05:00', ENDS = '2027-05-14T23:59:00-04:00', CLOSING = '2027-04-30T23:59:00-04:00';
let n = 0;
const ev = (f, operation, payload, at = f.ctx.virtual_now) => f.event({ event_id: 'e9-' + (++n), at, operation, payload });
const ok = (f, token, by = 'm-1') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const tick = f => assert.equal(ok(f, 'tok-7c1e').status, 'committed');
const actOn = (s, member = 'm-2') => S.granted(s, member, 'act');
const CLAIM = { target_type: 'claim', target_id: 'cl-3', statement: 'The provider was listed as in network.' };
const PA = { target_type: 'pa', target_id: 'pa-3', statement: 'The surgery cannot wait.' };
const preview = (f, args) => f.call(P + 'appeals.file.preview', args);
const fileConfirm = (f, args, token) => f.call(P + 'appeals.file.confirm', { ...args, token });
function file(f, args) { const pv = preview(f, args); assert.equal(pv.status, 'ok', JSON.stringify(pv)); ok(f, pv.preview.token); const out = fileConfirm(f, args, pv.preview.token); assert.equal(out.status, 'committed', JSON.stringify(out)); return out.appeal; }
function withdraw(f, id) { const pv = f.call(P + 'appeals.withdraw.preview', { appeal_id: id }); assert.equal(pv.status, 'ok', JSON.stringify(pv)); ok(f, pv.preview.token); const out = f.call(P + 'appeals.withdraw.confirm', { appeal_id: id, token: pv.preview.token }); assert.equal(out.status, 'committed', JSON.stringify(out)); return out.appeal; }
const decide = (f, id, payload) => ev(f, 'appeal.decided', { appeal_id: id, ...payload });
const ap = (f, id) => f.data().appeals.find(a => a.appeal_id === id);
const eobs = (f, id) => f.data().eobs.filter(e => e.claim_id === id).sort((a, b) => a.version - b.version);
const acc = (f, m, y = 2026) => f.data().accumulators.find(a => a.member_id === m && a.plan_year === y);
const ctxAt = now => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now, binding: structuredClone(binding) });
const added = (before, f) => f.data().notices.slice(before.notices.length).map(x => [x.kind, x.recipient_id, x.subject.id, x.at]);
function reopen(f) {
  const data = JSON.parse(JSON.stringify(f.data()));
  for (const later of [f.ctx.virtual_now, new Date(Date.parse(f.ctx.virtual_now) + 400 * 86400000).toISOString()]) assert.doesNotThrow(() => plugin.validateSeed(ctxAt(later), data), later);
  return fixture({ seed: { ...data, approvals: [] }, now: f.ctx.virtual_now });
}

test('T09 filing a claim appeal: preview changes, then an appeal under review on EOB v1\'s denied lines, due 23:59 sixty days later, with the received notice', () => {
  const f = fixture({ seed: S.deniedClaim() });
  const pv = preview(f, CLAIM);
  assert.deepEqual([pv.preview.required_confirmer, pv.preview.changes], ['m-1', { target_type: 'claim', target_id: 'cl-3', lines: ['ln-1', 'ln-2'], expedited: false, due_rule: 'claim_60_days', due_at_if_filed_now: '2027-01-17T23:59:00-05:00', window_ends_at: ENDS }]);
  assert.match(pv.preview.token, /^tok-file-claim-cl-3-[0-9a-f]{32}$/);
  ok(f, pv.preview.token);
  const before = f.data();
  const a = fileConfirm(f, CLAIM, pv.preview.token).appeal;
  assert.deepEqual(a, { appeal_id: 'ap-1', appeal_version: 0, member_id: 'm-1', target: { type: 'claim', id: 'cl-3' }, lines: ['ln-1', 'ln-2'], expedited: false, filed_at: T0, due_at: '2027-01-17T23:59:00-05:00', overdue: false, overdue_at: null,
    status: 'under_review', statements: [{ at: T0, by: 'm-1', text: CLAIM.statement }], info_requests: [], decided_at: null, outcome: null, withdrawn_at: null, approvals: [] });
  assert.deepEqual([ap(f, 'ap-1').filed_seq, f.data().issued.file, f.data().issued.ap], ['1', '1', '1']);
  assert.deepEqual(added(before, f), [['notice.appeal_received', 'm-1', 'ap-1', T0]]);
  assert.equal(f.data().notices.at(-1).body, 'Appeal ap-1 of claim cl-3 for member m-1 was received; a decision is due by 2027-01-17 at 23:59 Eastern Time.');
  assert.deepEqual(f.call(P + 'claims.get', { claim_id: 'cl-3' }).claim.appeal_ids, ['ap-1']);
  assert.equal(f.data().claims.find(c => c.claim_id === 'cl-3').claim_version, 1);
  reopen(f);
});

test('T10 filing a PA appeal: due 23:59 thirty days later, or 72 hours later when expedited with the urgency attestation', () => {
  const f = fixture({ seed: actOn(S.deniedPa()) });
  assert.deepEqual(preview(f, PA).preview.changes, { target_type: 'pa', target_id: 'pa-3', lines: null, expedited: false, due_rule: 'pa_30_days', due_at_if_filed_now: '2026-12-18T23:59:00-05:00', window_ends_at: '2027-05-09T23:59:00-04:00' });
  const fast = { ...PA, expedited: true, urgency_attested: true };
  assert.deepEqual(preview(f, fast).preview.changes, { target_type: 'pa', target_id: 'pa-3', lines: null, expedited: true, due_rule: 'pa_72_hours', due_at_if_filed_now: '2026-11-21T12:00:00-05:00', window_ends_at: '2027-05-09T23:59:00-04:00' });
  const a = file(f, fast);
  assert.deepEqual([a.member_id, a.lines, a.expedited, a.due_at, a.target], ['m-2', null, true, '2026-11-21T12:00:00-05:00', { type: 'pa', id: 'pa-3' }]);
  assert.deepEqual(f.data().notices.map(x => [x.kind, x.recipient_id, x.body]), ['m-1', 'm-2'].map(r => ['notice.appeal_received', r, 'Expedited appeal ap-1 of prior authorization pa-3 for member m-2 was received; a decision is due by 2026-11-21 at 12:00 Eastern Time.']));
  const more = f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'The surgeon\'s letter is attached.' }).appeal;
  assert.deepEqual([a.statements.map(x => [x.by, x.text]), more.statements.map(x => x.by)], [[['m-1', PA.statement]], ['m-1', 'm-1']]);
  reopen(f);
  const g = fixture({ seed: actOn(S.deniedPa()) });
  assert.equal(file(g, PA).due_at, '2026-12-18T23:59:00-05:00');
});

test('T11 the filing checks run in order: authority, not_appealable, duplicate_request, appeal_window_closed, expedite_not_allowed; previews give the same errors and no token', () => {
  const both = (f, args) => { const p = preview(f, args); const c = fileConfirm(f, args, 'tok-file-claim-cl-3-' + 'a'.repeat(32)); return [p.status, p.preview, c.status]; };
  const err = (f, args, code) => assert.deepEqual(both(f, args).slice(0, 2), [code, undefined], JSON.stringify(args) + ' ' + code);
  const f = fixture({ seed: S.openAppeal(undefined, undefined, actOn(S.received([S.line('ln-1', 1, 'svc-office-visit', '2026-11-16', 21000)], S.deniedClaim()))) });
  err(f, { ...CLAIM, target_id: 'cl-1' }, 'not_appealable');
  err(f, { ...CLAIM, target_id: 'cl-2' }, 'not_appealable');
  err(f, CLAIM, 'duplicate_request');
  f.setNow(ENDS);
  err(f, CLAIM, 'duplicate_request');
  err(f, { ...CLAIM, expedited: true }, 'duplicate_request');
  const v = fixture({ seed: S.granted(S.deniedPa(), 'm-2', 'view'), now: '2027-05-10T09:00:00-04:00' });
  err(v, { ...PA, expedited: true }, 'not_authorized');
  const g = fixture({ seed: S.deniedClaim() });
  err(g, { ...CLAIM, expedited: true }, 'expedite_not_allowed');
  err(g, { ...CLAIM, expedited: true, urgency_attested: true }, 'expedite_not_allowed');
  const h = fixture({ seed: actOn(S.deniedPa()) });
  err(h, { ...PA, expedited: true }, 'expedite_not_allowed');
  err(h, { ...PA, expedited: true, urgency_attested: false }, 'expedite_not_allowed');
  assert.equal(preview(h, { ...PA, urgency_attested: true }).preview.changes.due_rule, 'pa_30_days');
  h.setNow('2027-05-09T23:58:59.999-04:00');
  assert.equal(preview(h, PA).status, 'ok');
  h.setNow('2027-05-09T23:59:00-04:00');
  err(h, PA, 'appeal_window_closed');
  err(h, { ...PA, expedited: true }, 'appeal_window_closed');
  const p = fixture({ seed: actOn(S.paPending()) });
  err(p, { ...PA, target_id: 'pa-2' }, 'not_appealable');
  assert.deepEqual(both(p, { ...PA, target_id: 'pa-9' }).slice(0, 1), ['not_found']);
  assert.deepEqual(preview(g, { ...CLAIM, statement: 'x'.repeat(2001) }), { status: 'invalid_arguments', message: 'The statement is longer than 2,000 characters.' });
  assert.equal(preview(g, { ...CLAIM, statement: '😀'.repeat(2000) }).status, 'ok');
  const second = S.deniedClaim();
  S.claim(second, { claim_id: 'cl-8', member_id: 'm-1', provider_id: 'pv-5', received_at: '2026-11-13T11:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-12', 21000)] });
  const e8 = S.process(second, 'cl-8', [S.denied('ln-1', 'out_of_network', 21000)]);
  S.window(second, 'claim', 'cl-8', e8.issued_at);
  const two = fixture({ seed: S.openAppeal(undefined, undefined, S.finalize(second)) });
  assert.deepEqual([preview(two, { ...CLAIM, target_id: 'cl-8' }).status, preview(two, { ...CLAIM, target_id: 'cl-8' }).preview.changes.window_ends_at], ['ok', '2027-05-15T23:59:00-04:00']);
  two.setNow('2027-05-15T09:00:00-04:00');
  assert.equal(preview(two, { ...CLAIM, target_id: 'cl-8' }).status, 'ok');
  assert.deepEqual(preview(g, { ...CLAIM, target_id: 'cl-1' }), { status: 'not_appealable', message: 'Claim cl-1 has no denial that can be appealed.' });
  assert.deepEqual(preview(f, CLAIM), { status: 'duplicate_request', message: 'Claim cl-3 already has an open appeal.' });
  assert.deepEqual(preview(h, PA), { status: 'appeal_window_closed', message: 'The appeal window for pa-3 closed at 2027-05-09T23:59:00-04:00.' });
  assert.deepEqual(preview(g, { ...CLAIM, expedited: true }), { status: 'expedite_not_allowed', message: 'Only a PA appeal with an urgency attestation can be expedited.' });
});

test('T09 an overturn reprices the named lines at the current accumulators in line order, posts the difference and copies the rest; the payload order does not matter', () => {
  const lines = [S.line('ln-1', 1, 'svc-knee-mri', '2026-11-11', 180000), S.line('ln-2', 2, 'svc-physical-therapy', '2026-11-10', 15000), S.line('ln-3', 3, 'svc-lab-panel', '2026-11-09', 9000, { emergency: true })];
  const s = S.edit(S.paApproved(), x => { x.pas[0].member_id = 'm-1'; });
  const priced = { 'ln-1': S.denied('ln-1', 'out_of_network', 180000), 'ln-2': S.denied('ln-2', 'out_of_network', 15000), 'ln-3': S.paid('ln-3', 9000, { ded: 9000 }, 9000) };
  S.claim(s, { claim_id: 'cl-3', member_id: 'm-1', provider_id: 'pv-5', received_at: '2026-11-12T11:00:00-05:00', lines });
  const e = S.process(s, 'cl-3', lines.map(l => priced[l.line_id]));
  S.window(s, 'claim', 'cl-3', e.issued_at);
  const live = fixture({ seed: S.finalize(structuredClone(s)) });
  assert.deepEqual(preview(live, CLAIM).preview.changes.lines, ['ln-1', 'ln-2']);
  assert.deepEqual(file(live, CLAIM).lines, ['ln-1', 'ln-2']);
  const f = fixture({ seed: S.openAppeal(undefined, undefined, S.finalize(s)) });
  assert.deepEqual(ap(f, 'ap-1').lines, ['ln-1', 'ln-2']);
  const before = f.data(), v1 = structuredClone(eobs(f, 'cl-3')[0]);
  assert.equal(decide(f, 'ap-1', { outcome: 'overturned', lines: ['ln-2', 'ln-1'] }).status, 'committed');
  const [first, v2] = eobs(f, 'cl-3');
  assert.deepEqual(first, v1);
  assert.deepEqual([v2.version, v2.reason, v2.appeal_id, v2.issued_at, v2.posting_seq], [2, 'appeal', 'ap-1', T0, '3']);
  assert.deepEqual(v2.ledger_before, { 2026: { member: { deductible_cents: 9000, oop_cents: 11500 }, family: { deductible_cents: 9000, oop_cents: 11500 } } });
  assert.deepEqual(v2.lines.map(l => [l.line_id, l.status, l.copay_cents, l.deductible_cents, l.coinsurance_cents, l.pa_id, l.pa_units]), [['ln-1', 'paid', 0, 141000, 1800, null, 0], ['ln-2', 'paid', 3500, 0, 0, null, 0], ['ln-3', 'paid', 0, 9000, 0, null, 0]]);
  assert.deepEqual(v2.lines[2], v1.lines[2]);
  assert.deepEqual(v2.postings, [{ member_id: 'm-1', plan_year: 2026, deductible_cents: 150000, oop_cents: 155300 }]);
  assert.deepEqual(acc(f, 'm-1'), { member_id: 'm-1', plan_year: 2026, deductible_cents: 150000, oop_cents: 157800 });
  assert.equal(f.data().claims.find(c => c.claim_id === 'cl-3').claim_version, before.claims.find(c => c.claim_id === 'cl-3').claim_version + 1);
  assert.deepEqual([f.data().pas[0].units_used, f.data().pas[0].pa_version], [0, before.pas[0].pa_version]);
  assert.deepEqual([ap(f, 'ap-1').status, ap(f, 'ap-1').outcome, ap(f, 'ap-1').decided_at, ap(f, 'ap-1').appeal_version], ['overturned', { lines: ['ln-1', 'ln-2'], units: null, valid_until: null }, T0, 1]);
  assert.deepEqual(added(before, f), [['notice.eob_available', 'm-1', 'cl-3', T0], ['notice.appeal_decision', 'm-1', 'ap-1', T0]]);
  assert.equal(f.data().notices.at(-1).body, 'Appeal ap-1 of claim cl-3 for member m-1 was overturned for lines ln-1, ln-2; a new explanation of benefits was issued.');
  const view = f.call(P + 'claims.get', { claim_id: 'cl-3' }).claim;
  assert.deepEqual([view.eobs.map(x => x.version), view.lines.map(l => l.outcome.status)], [[1, 2], ['paid', 'paid', 'paid']]);
  const reversed = S.edit(f.data(), x => { x.eobs.reverse(); x.approvals = []; });
  assert.deepEqual(fixture({ seed: reversed }).call(P + 'claims.get', { claim_id: 'cl-3' }).claim.eobs.map(x => x.version), [1, 2]);
  reopen(f);
});

test('T09 when an overturn meets the family deductible, the other members\' accumulators and EOBs stay unchanged; 100¢ left over two 100¢ lines is 100/0 then 0/20', () => {
  const s = S.ledger([{ member: 'm-2', year: 2026, deductible_cents: 150000 }, { member: 'm-3', year: 2026, deductible_cents: 149900 }]);
  const f = fixture({ seed: S.openAppeal(undefined, undefined, S.deniedClaim([S.line('ln-1', 1, 'svc-knee-mri', '2026-11-11', 100), S.line('ln-2', 2, 'svc-knee-mri', '2026-11-11', 100)], s)) });
  const others = f.data().eobs.filter(e => e.claim_id !== 'cl-3'), accs = ['m-2', 'm-3'].map(m => acc(f, m));
  decide(f, 'ap-1', { outcome: 'overturned', lines: ['ln-2', 'ln-1'] });
  const v2 = eobs(f, 'cl-3')[1];
  assert.deepEqual(v2.lines.map(l => [l.deductible_cents, l.coinsurance_cents, l.member_cost_cents]), [[100, 0, 100], [0, 20, 20]]);
  assert.deepEqual(v2.ledger_before[2026].family, { deductible_cents: 299900, oop_cents: 302400 });
  assert.deepEqual([f.data().eobs.filter(e => e.claim_id !== 'cl-3'), ['m-2', 'm-3'].map(m => acc(f, m)), acc(f, 'm-1')], [others, accs, { member_id: 'm-1', plan_year: 2026, deductible_cents: 100, oop_cents: 2620 }]);
  reopen(f);
});

test('T10 a PA overturn approves from the decision\'s local date with its units and valid_until, or expires at once keeping them; processed claims are untouched; no PA decision notice', () => {
  const s = S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', actOn(S.deniedPa()));
  S.claim(s, { claim_id: 'cl-6', member_id: 'm-2', provider_id: 'pv-4', received_at: '2026-11-12T09:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-arthroscopy', '2026-11-11', 800000)] });
  Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' });
  S.process(s, 'cl-6', [S.denied('ln-1', 'prior_auth_missing', 800000)]);
  S.window(s, 'claim', 'cl-6', '2026-11-15T23:59:00-05:00');
  const seed = S.finalize(s);
  const f = fixture({ seed });
  f.setNow('2026-11-20T09:30:00-05:00');
  const before = f.data();
  decide(f, 'ap-1', { outcome: 'overturned', units: 2, valid_until: '2027-01-31' });
  const pa = f.data().pas[0];
  assert.deepEqual([pa.status, pa.approved, pa.decided_at, pa.expired_at, pa.denial_notice_at, pa.approved_after_post, pa.pa_version], ['approved', { units: 2, valid_from: '2026-11-20', valid_until: '2027-01-31' }, '2026-11-20T09:30:00-05:00', null, '2026-11-10T10:00:00-05:00', '2', 2]);
  assert.deepEqual(ap(f, 'ap-1').outcome, { lines: null, units: 2, valid_until: '2027-01-31' });
  assert.deepEqual(added(before, f).map(x => x[0]), ['notice.appeal_decision', 'notice.appeal_decision']);
  assert.equal(f.data().notices.at(-1).body, 'Appeal ap-1 of prior authorization pa-3 for member m-2 was overturned: 2 units, valid until 2027-01-31.');
  assert.deepEqual(f.data().eobs.filter(e => e.claim_id === 'cl-6'), before.eobs.filter(e => e.claim_id === 'cl-6'));
  reopen(f);
  const g = fixture({ seed });
  g.setNow('2026-11-20T09:30:00-05:00');
  decide(g, 'ap-1', { outcome: 'overturned', units: 3, valid_until: '2026-11-19' });
  const x = g.data().pas[0];
  assert.deepEqual([x.status, x.approved, x.decided_at, x.expired_at], ['expired', { units: 3, valid_from: '2026-11-20', valid_until: '2026-11-19' }, '2026-11-20T09:30:00-05:00', '2026-11-20T09:30:00-05:00']);
  reopen(g);
  const h = fixture({ seed });
  h.setNow('2026-11-20T09:30:00-05:00');
  decide(h, 'ap-1', { outcome: 'overturned', units: 1, valid_until: '2026-11-20' });
  assert.equal(h.data().pas[0].status, 'approved');
  h.setNow('2026-11-21T09:00:00-05:00');
  tick(h);
  assert.deepEqual([h.data().pas[0].status, h.data().pas[0].expired_at], ['expired', '2026-11-20T23:59:00-05:00']);
  reopen(h);
});

test('T09 overturn payloads: a line outside the appeal, a PA-shaped overturn of a claim and a claim-shaped overturn of a PA are invalid_event; a decided appeal ignores any payload', () => {
  const f = fixture({ seed: S.openAppeal() });
  const before = f.data();
  assert.deepEqual(decide(f, 'ap-1', { outcome: 'overturned', lines: ['ln-1', 'ln-9'] }), { status: 'invalid_event', message: 'Line ln-9 is not one of the lines of appeal ap-1.' });
  assert.deepEqual(decide(f, 'ap-1', { outcome: 'overturned', units: 1, valid_until: '2027-01-31' }), { status: 'invalid_event', message: 'Appeal ap-1 is on a claim; an overturn names the lines it reprices.' });
  assert.deepEqual(f.data(), before);
  decide(f, 'ap-1', { outcome: 'overturned', lines: ['ln-1'] });
  const done = f.data();
  for (const payload of [{ outcome: 'overturned', lines: ['ln-9'] }, { outcome: 'upheld' }, { outcome: 'overturned', units: 1, valid_until: '2026-02-30' }]) {
    assert.equal(decide(f, 'ap-1', payload).status, 'committed');
    assert.deepEqual([f.data().appeals, f.data().eobs, f.data().notices], [done.appeals, done.eobs, done.notices]);
  }
  const g = fixture({ seed: S.openAppeal({ type: 'pa', id: 'pa-3' }) });
  assert.deepEqual(decide(g, 'ap-1', { outcome: 'overturned', lines: ['ln-1'] }), { status: 'invalid_event', message: 'Appeal ap-1 is on a PA; an overturn gives units and valid_until.' });
  assert.deepEqual(decide(g, 'ap-1', { outcome: 'overturned', units: 1, valid_until: '2027-02-30' }), { status: 'invalid_event', message: 'The approval of PA pa-3 has an invalid date 2027-02-30.' });
});

test('T11 a paid claim, an upheld appeal and a partial overturn with a denied line left are not_appealable; a withdrawn appeal can be refiled in the original window', () => {
  const f = fixture({ seed: S.openAppeal() });
  decide(f, 'ap-1', { outcome: 'upheld' });
  assert.equal(preview(f, CLAIM).status, 'not_appealable');
  assert.equal(f.data().notices.at(-1).body, 'Appeal ap-1 of claim cl-3 for member m-1 was upheld; the denial stands.');
  const g = fixture({ seed: S.openAppeal() });
  decide(g, 'ap-1', { outcome: 'overturned', lines: ['ln-2'] });
  assert.deepEqual([eobs(g, 'cl-3')[1].lines.map(l => l.status), preview(g, CLAIM).status], [['denied', 'paid'], 'not_appealable']);
  const all = fixture({ seed: S.openAppeal() });
  decide(all, 'ap-1', { outcome: 'overturned', lines: ['ln-1', 'ln-2'] });
  assert.equal(preview(all, CLAIM).status, 'not_appealable');
  const h = fixture({ seed: S.openAppeal() });
  withdraw(h, 'ap-1');
  h.setNow('2027-05-14T23:58:00-04:00');
  const again = file(h, CLAIM);
  assert.deepEqual([again.appeal_id, ap(h, 'ap-2').filed_seq, again.due_at, h.data().windows.length], ['ap-2', '2', '2027-07-13T23:59:00-04:00', 1]);
  assert.equal(preview(h, CLAIM).status, 'duplicate_request');
  reopen(h);
});

test('T13 the statement length is checked last: previews after the filing checks, filing confirms after authority, approval, freshness and the filing checks, statements after the open-state check', () => {
  const LONG = 'x'.repeat(2001), TOO_LONG = { status: 'invalid_arguments', message: 'The statement is longer than 2,000 characters.' };
  const long = { ...CLAIM, statement: LONG };
  const opened = fixture({ seed: S.openAppeal() });
  const late = fixture({ seed: S.deniedClaim(), now: ENDS });
  const g = fixture({ seed: S.deniedClaim() });
  assert.deepEqual([preview(g, { ...long, target_id: 'cl-1' }).status, preview(opened, long).status, preview(late, long).status, preview(g, { ...long, expedited: true }).status, preview(g, long)],
    ['not_appealable', 'duplicate_request', 'appeal_window_closed', 'expedite_not_allowed', TOO_LONG]);
  assert.equal(preview(fixture({ seed: S.granted(S.deniedPa(), 'm-2', 'view') }), { ...PA, statement: LONG }).status, 'not_authorized');
  const forLong = (f, args) => { const d = f.data(), c = d.claims.find(x => x.claim_id === args.target_id); return T.makeToken({ ctx: f.ctx, data: d, actor: 'm-1', action: 'file', kind: 'claim', id: c.claim_id, subject: T.claimSubject(d, c), args: T.businessArgs('file', args), targetVersion: c.claim_version }); };
  const attempt = (f, args, token, by) => {
    if (by) ok(f, token, by);
    const before = f.data(), out = fileConfirm(f, args, token);
    assert.deepEqual([f.data().appeals, f.data().approvals.map(a => a.used_at)], [before.appeals, before.approvals.map(() => null)]);
    return out.status;
  };
  assert.equal(attempt(fixture({ seed: S.granted(S.deniedPa(), 'm-2', 'view') }), { ...PA, statement: LONG }, 'tok-x'), 'not_authorized');
  assert.equal(attempt(g, long, forLong(g, long)), 'confirmation_required');
  assert.equal(attempt(fixture({ seed: S.deniedClaim() }), long, forLong(g, long), 'm-2'), 'confirmation_invalid');
  const fresh = fixture({ seed: S.deniedClaim() });
  assert.equal(attempt(fresh, long, preview(fresh, CLAIM).preview.token, 'm-1'), 'stale_preview');
  const crafted = (seed, now) => { const f = fixture({ seed, now }); return attempt(f, long, forLong(f, long), 'm-1'); };
  assert.deepEqual([crafted(S.openAppeal()), crafted(S.deniedClaim(), ENDS), crafted(S.deniedClaim())], ['duplicate_request', 'appeal_window_closed', 'invalid_arguments']);
  assert.equal(attempt(fixture({ seed: S.deniedClaim() }), { ...long, expedited: true }, forLong(g, { ...long, expedited: true }), 'm-1'), 'expedite_not_allowed');
  const w = fixture({ seed: S.deniedClaim() });
  assert.deepEqual(fileConfirm(w, long, (() => { const t = forLong(w, long); ok(w, t); return t; })()), TOO_LONG);
  const statementOn = (seed, args) => { const f = fixture({ seed }), before = f.data(), out = f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: LONG, ...args }); assert.deepEqual(f.data(), before); return out.status; };
  assert.deepEqual([statementOn(S.overturned()), statementOn(S.edit(S.openAppeal(), x => Object.assign(x.appeals[0], { status: 'withdrawn', withdrawn_at: '2026-11-17T10:00:00-05:00', appeal_version: 1 }))), statementOn(S.openAppeal()), statementOn(S.openAppeal(), { appeal_id: 'ap-9' })],
    ['invalid_state', 'invalid_state', 'invalid_arguments', 'not_found']);
  assert.equal(statementOn(S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', S.granted(S.deniedPa(), 'm-2', 'view'))), 'not_authorized');
});

test('T11 previewed and approved one minute before the filing cutoff, a confirm exactly at the cutoff is appeal_window_closed with the approval unused', () => {
  const f = fixture({ seed: S.deniedClaim(), now: '2027-05-14T23:58:00-04:00' });
  const pv = preview(f, CLAIM);
  assert.equal(pv.status, 'ok');
  ok(f, pv.preview.token);
  f.setNow(ENDS);
  const before = f.data();
  assert.deepEqual(fileConfirm(f, CLAIM, pv.preview.token), { status: 'appeal_window_closed', message: 'The appeal window for cl-3 closed at ' + ENDS + '.' });
  assert.deepEqual([f.data().appeals, f.data().approvals.map(a => [a.confirmed_at, a.used_at])], [before.appeals, [['2027-05-14T23:58:00-04:00', null]]]);
});

test('T12 information requested, a statement returns it to review; statements under review are recorded; terminal appeals refuse statements; the due date never moves', () => {
  const f = fixture({ seed: S.openAppeal() });
  f.setNow('2026-11-19T09:00:00-05:00');
  const before = f.data();
  ev(f, 'appeal.info_requested', { appeal_id: 'ap-1', request: 'A letter from the treating provider' });
  assert.deepEqual([ap(f, 'ap-1').status, ap(f, 'ap-1').info_requests, ap(f, 'ap-1').due_at, ap(f, 'ap-1').appeal_version], ['info_requested', [{ at: '2026-11-19T09:00:00-05:00', text: 'A letter from the treating provider' }], '2027-01-16T23:59:00-05:00', 1]);
  assert.deepEqual(added(before, f), [['notice.appeal_info_requested', 'm-1', 'ap-1', '2026-11-19T09:00:00-05:00']]);
  const mid = f.data();
  for (const p of [{ appeal_id: 'ap-1', request: 'Again' }, { appeal_id: 'ap-1', request: 'x'.repeat(3000) }]) { assert.equal(ev(f, 'appeal.info_requested', p).status, 'committed'); assert.deepEqual(f.data(), mid); }
  const st = f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'Letter attached.' });
  assert.deepEqual([st.status, st.appeal.status, st.appeal.statements.at(-1), st.appeal.appeal_version, st.appeal.due_at], ['committed', 'under_review', { at: '2026-11-19T09:00:00-05:00', by: 'm-1', text: 'Letter attached.' }, 2, '2027-01-16T23:59:00-05:00']);
  const more = f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'One more note.' });
  assert.deepEqual([more.appeal.status, more.appeal.statements.length, more.appeal.appeal_version], ['under_review', 3, 3]);
  assert.equal(f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'y'.repeat(2001) }).status, 'invalid_arguments');
  assert.deepEqual(ev(f, 'appeal.info_requested', { appeal_id: 'ap-1', request: 'z'.repeat(2001) }), { status: 'invalid_event', message: 'The information request is longer than 2,000 characters.' });
  assert.equal(ev(f, 'appeal.info_requested', { appeal_id: 'ap-1', request: '😀'.repeat(2000) }).status, 'committed');
  assert.equal(f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'Back to review.' }).appeal.status, 'under_review');
  decide(f, 'ap-1', { outcome: 'upheld' });
  assert.deepEqual(f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'Late.' }), { status: 'invalid_state', message: 'Appeal ap-1 is upheld; it can no longer take statements.' });
  const done = f.data();
  ev(f, 'appeal.info_requested', { appeal_id: 'ap-1', request: 'Too late' });
  assert.deepEqual(f.data(), done);
  reopen(f);
});

test('T13 withdrawal with confirmation from either open state; later decisions have no effect; a terminal appeal refuses withdrawal and an old withdrawal token after a decision is stale_preview', () => {
  for (const status of ['under_review', 'info_requested']) {
    const f = fixture({ seed: S.openAppeal(undefined, status) });
    const pv = f.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-1' });
    assert.deepEqual(pv.preview.changes, { appeal_id: 'ap-1', window_ends_at: ENDS });
    assert.match(pv.preview.token, /^tok-withdraw-appeal-ap-1-[0-9a-f]{32}$/);
    const before = f.data();
    const a = withdraw(f, 'ap-1');
    assert.deepEqual([a.status, a.withdrawn_at, a.decided_at, f.data().notices.length, a.appeal_version - before.appeals[0].appeal_version], ['withdrawn', T0, null, before.notices.length, 1]);
    const done = f.data();
    decide(f, 'ap-1', { outcome: 'overturned', lines: ['ln-1'] });
    assert.deepEqual([f.data().appeals, f.data().eobs], [done.appeals, done.eobs]);
    assert.deepEqual(f.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-1' }), { status: 'invalid_state', message: 'Appeal ap-1 is withdrawn; it can no longer be withdrawn.' });
    reopen(f);
  }
  const g = fixture({ seed: S.openAppeal() });
  const pv = g.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-1' });
  ok(g, pv.preview.token);
  decide(g, 'ap-1', { outcome: 'upheld' });
  assert.equal(g.call(P + 'appeals.withdraw.confirm', { appeal_id: 'ap-1', token: pv.preview.token }).status, 'stale_preview');
  assert.equal(g.data().approvals[0].used_at, null);
  assert.equal(g.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-1' }).status, 'invalid_state');
  decide(g, 'ap-1', { outcome: 'overturned', lines: ['ln-1'] });
  assert.equal(ap(g, 'ap-1').status, 'upheld');
});

test('T14 an appeal due date passes: overdue once with its notice, no automatic decision; a terminal appeal never becomes overdue', () => {
  const f = fixture({ seed: S.granted(S.openAppeal({ type: 'pa', id: 'pa-3' })) });
  f.setNow('2026-12-17T23:58:59.999-05:00');
  assert.equal(f.call(P + 'appeals.get', { appeal_id: 'ap-1' }).appeal.overdue, false);
  f.setNow('2026-12-18T09:00:00-05:00');
  const seen = f.call(P + 'appeals.get', { appeal_id: 'ap-1' }).appeal;
  assert.deepEqual([seen.overdue, seen.overdue_at, seen.status, ap(f, 'ap-1').overdue], [true, '2026-12-17T23:59:00-05:00', 'under_review', false]);
  const before = f.data();
  tick(f);
  assert.deepEqual([ap(f, 'ap-1').overdue_at, ap(f, 'ap-1').appeal_version, added(before, f)], ['2026-12-17T23:59:00-05:00', 1, [['notice.decision_overdue', 'm-1', 'ap-1', '2026-12-17T23:59:00-05:00'], ['notice.decision_overdue', 'm-2', 'ap-1', '2026-12-17T23:59:00-05:00']]]);
  f.setNow('2026-12-20T09:00:00-05:00');
  tick(f);
  decide(f, 'ap-1', { outcome: 'upheld' });
  assert.deepEqual([ap(f, 'ap-1').status, ap(f, 'ap-1').overdue_at, f.data().notices.filter(x => x.kind === 'notice.decision_overdue').length], ['upheld', '2026-12-17T23:59:00-05:00', 2]);
  reopen(f);
  const g = fixture({ seed: S.openAppeal() });
  withdraw(g, 'ap-1');
  g.setNow('2027-01-20T09:00:00-05:00');
  tick(g);
  assert.deepEqual([ap(g, 'ap-1').overdue, g.data().notices.filter(x => x.kind === 'notice.decision_overdue').length], [false, 0]);
  reopen(g);
});

test('T14 a timer and an action on the same record in one call each count as a step: the version moves twice', () => {
  const f = fixture({ seed: S.openAppeal() });
  f.setNow('2027-01-17T09:00:00-05:00');
  decide(f, 'ap-1', { outcome: 'upheld' });
  assert.deepEqual([ap(f, 'ap-1').overdue_at, ap(f, 'ap-1').status, ap(f, 'ap-1').appeal_version], ['2027-01-16T23:59:00-05:00', 'upheld', 2]);
  const g = fixture({ seed: S.openAppeal() });
  g.setNow('2027-01-17T09:00:00-05:00');
  assert.equal(g.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'Still waiting.' }).appeal.appeal_version, 2);
  const late = fixture({ seed: S.openAppeal() });
  late.setNow('2201-01-01T00:00:00-05:00');
  assert.deepEqual(decide(late, 'ap-1', { outcome: 'upheld' }), { status: 'invalid_event', message: 'The App clock 2201-01-01T00:00:00-05:00 is outside the supported range 2000-01-01 to 2200-12-31.' });
  assert.deepEqual(late.call(P + 'claims.get', { claim_id: 'cl-1' }), { status: 'invalid_state', message: 'The App clock 2201-01-01T00:00:00-05:00 is outside the supported range 2000-01-01 to 2200-12-31.' });
});

test('T14 the closing timer writes its notice 14 days before the end iff the target is still appealable, open appeal or not, and is done either way', () => {
  const at = (s, cut) => { const f = fixture({ seed: s }); if (cut) cut(f); f.setNow('2027-05-01T09:00:00-04:00'); tick(f); return f; };
  const closing = f => f.data().windows.find(w => w.target.id === 'cl-3').closing;
  const notes = f => f.data().notices.filter(x => x.kind === 'notice.appeal_window_closing').map(x => [x.recipient_id, x.at, x.body]);
  const body = 'The appeal window for claim cl-3 (member m-1) closes on 2027-05-14 at 23:59 Eastern Time.';
  const plain = at(S.deniedClaim());
  assert.deepEqual([closing(plain), notes(plain)], [{ due_at: CLOSING, done: true, notice_at: CLOSING }, [['m-1', CLOSING, body]]]);
  const open = at(S.openAppeal());
  assert.deepEqual([closing(open).notice_at, notes(open).length], [CLOSING, 1]);
  for (const when of ['2027-04-30T23:58:00-04:00', CLOSING, '2027-04-30T23:59:30-04:00']) {
    const f = at(S.openAppeal(), g => { g.setNow(when); withdraw(g, 'ap-1'); });
    assert.deepEqual([closing(f).notice_at, notes(f).length, ap(f, 'ap-1').status], [CLOSING, 1, 'withdrawn'], when);
    reopen(f);
  }
  for (const payload of [{ outcome: 'upheld' }, { outcome: 'overturned', lines: ['ln-1'] }]) {
    const f = at(S.openAppeal(), g => decide(g, 'ap-1', payload));
    assert.deepEqual([closing(f), notes(f)], [{ due_at: CLOSING, done: true, notice_at: null }, []]);
    assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-3' }).claim.appeal_window.closing_notice_at, null);
    reopen(f);
  }
  const pa = at(S.deniedPa());
  assert.deepEqual(pa.data().windows[0].closing, { due_at: '2027-04-25T23:59:00-04:00', done: true, notice_at: '2027-04-25T23:59:00-04:00' });
  assert.deepEqual(pa.data().notices.map(x => [x.kind, x.subject, x.fields]), [['notice.appeal_window_closing', { type: 'pa', id: 'pa-3' }, { target: { type: 'pa', id: 'pa-3' }, window_ends_at: '2027-05-09T23:59:00-04:00' }]]);
  const decided = at(S.openAppeal({ type: 'pa', id: 'pa-3' }), g => { g.setNow('2026-11-20T09:00:00-05:00'); decide(g, 'ap-1', { outcome: 'upheld' }); });
  assert.deepEqual([decided.data().windows[0].closing.notice_at, decided.data().notices.filter(x => x.kind === 'notice.appeal_window_closing')], [null, []]);
  const f = fixture({ seed: S.deniedClaim(), now: '2027-04-30T23:58:59.999-04:00' });
  assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-3' }).claim.appeal_window.closing_notice_at, null);
  f.setNow(CLOSING);
  assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-3' }).claim.appeal_window.closing_notice_at, CLOSING);
});

test('T09 a filing, its withdrawal and a refiling at one instant load in either seed array order, ordered by filed_seq', () => {
  const f = fixture({ seed: S.deniedClaim() });
  file(f, CLAIM);
  withdraw(f, 'ap-1');
  file(f, CLAIM);
  assert.deepEqual(f.data().appeals.map(a => [a.appeal_id, a.filed_at, a.filed_seq, a.status, a.withdrawn_at]), [['ap-1', T0, '1', 'withdrawn', T0], ['ap-2', T0, '2', 'under_review', null]]);
  const data = { ...f.data(), approvals: [] };
  for (const order of [data.appeals, [...data.appeals].reverse()]) plugin.validateSeed(ctxAt(T0), { ...data, appeals: order });
  decide(f, 'ap-2', { outcome: 'overturned', lines: ['ln-1'] });
  assert.equal(eobs(f, 'cl-3')[1].issued_at, T0);
  reopen(f);
});

test('T17 filing and withdrawal confirms: a missing or invalid approval answers before a stale token; preview at T, approval at T+10 min, confirm at T+20 min commits across midnight and for an expedited PA appeal', () => {
  const f = fixture({ seed: S.deniedClaim() });
  const pv = preview(f, CLAIM);
  assert.equal(fileConfirm(f, { ...CLAIM, statement: 'Changed.' }, pv.preview.token).status, 'confirmation_required');
  ok(f, pv.preview.token, 'm-2');
  assert.equal(fileConfirm(f, { ...CLAIM, statement: 'Changed.' }, pv.preview.token).status, 'confirmation_invalid');
  ok(f, pv.preview.token);
  assert.equal(fileConfirm(f, { ...CLAIM, statement: 'Changed.' }, pv.preview.token).status, 'stale_preview');
  const night = fixture({ seed: S.deniedClaim(), now: '2026-11-18T23:55:00-05:00' });
  const t = preview(night, CLAIM).preview.token;
  night.setNow('2026-11-19T00:05:00-05:00');
  ok(night, t);
  night.setNow('2026-11-19T00:15:00-05:00');
  const out = fileConfirm(night, CLAIM, t);
  assert.deepEqual([out.status, out.appeal.due_at], ['committed', '2027-01-18T23:59:00-05:00']);
  const fast = fixture({ seed: actOn(S.deniedPa()) });
  const args = { ...PA, expedited: true, urgency_attested: true };
  const ft = preview(fast, args).preview.token;
  fast.advance(10);
  ok(fast, ft);
  fast.advance(10);
  const done = fileConfirm(fast, args, ft);
  assert.deepEqual([done.status, done.appeal.filed_at, done.appeal.due_at], ['committed', '2026-11-18T12:20:00-05:00', '2026-11-21T12:20:00-05:00']);
  const w = fixture({ seed: S.openAppeal() });
  const wt = w.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-1' }).preview.token;
  assert.equal(w.call(P + 'appeals.withdraw.confirm', { appeal_id: 'ap-1', token: wt }).status, 'confirmation_required');
  w.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'New evidence.' });
  ok(w, wt);
  assert.equal(w.call(P + 'appeals.withdraw.confirm', { appeal_id: 'ap-1', token: wt }).status, 'stale_preview');
});

test('T17 after a same-seed reset, filing and withdrawal tokens are stale_preview when the recreated target or appeal differs, the approval unused and nothing changed', () => {
  const tryToken = (seedA, seedB, op, args) => {
    const a = fixture({ seed: seedA }), token = a.call(P + op + '.preview', args).preview.token;
    const b = fixture({ seed: seedB });
    ok(b, token);
    const before = b.data();
    assert.equal(b.call(P + op + '.confirm', { ...args, token }).status, 'stale_preview', op + ' ' + JSON.stringify(args));
    assert.deepEqual(b.data().appeals, before.appeals);
    assert.equal(b.data().approvals[0].used_at, null);
  };
  const deniedPa = units => S.edit(actOn(S.deniedPa()), x => { x.pas[0].requested.units = units; });
  tryToken(deniedPa(1), deniedPa(2), 'appeals.file', PA);
  const lines = svc => [S.line('ln-1', 1, svc, '2026-11-11', 180000), S.line('ln-2', 2, 'svc-specialist-visit', '2026-11-11', 32000)];
  tryToken(S.deniedClaim(), S.deniedClaim(lines('svc-lab-panel')), 'appeals.file', CLAIM);
  const alone = liable => S.finalize(S.edit(S.deniedClaim(), x => {
    x.claims = x.claims.filter(c => c.claim_id !== 'cl-1'); x.eobs = x.eobs.filter(e => e.claim_id !== 'cl-1');
    if (liable) { Object.assign(x.coverage.find(c => c.member_id === 'm-1' && c.plan_year === 2026), { status: 'other_primary' }); for (const l of x.eobs[0].lines) l.reason = 'other_party_liable'; }
  }));
  tryToken(alone(false), alone(true), 'appeals.file', CLAIM);
  tryToken(S.openAppeal(undefined, undefined, alone(false)), S.openAppeal(undefined, undefined, alone(true)), 'appeals.withdraw', { appeal_id: 'ap-1' });
  tryToken(S.openAppeal(), S.openAppeal(undefined, undefined, S.deniedClaim(lines('svc-lab-panel'))), 'appeals.withdraw', { appeal_id: 'ap-1' });
  tryToken(S.openAppeal(), S.openAppeal(undefined, undefined, undefined, { statements: [{ at: '2026-11-17T09:00:00-05:00', by: 'm-1', text: 'Another statement.' }] }), 'appeals.withdraw', { appeal_id: 'ap-1' });
  const later = S.finalize(S.edit(S.deniedClaim(), x => {
    const c = x.claims.find(y => y.claim_id === 'cl-3'), review = S.due('2026-11-13T11:00:00-05:00', 3);
    Object.assign(c, { received_at: '2026-11-13T11:00:00-05:00', review_at: review, processed_at: review });
    x.eobs.find(e => e.claim_id === 'cl-3').issued_at = review;
    Object.assign(x.windows[0], { notice_at: review, ends_at: S.due(review, 180), closing: { due_at: S.due(review, 166), done: false, notice_at: null } });
  }));
  const notice = S.openAppeal(undefined, undefined, later);
  tryToken(S.openAppeal(), notice, 'appeals.withdraw', { appeal_id: 'ap-1' });
  tryToken(S.openAppeal(), S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', S.granted(S.deniedPa(), 'm-2', 'act')), 'appeals.withdraw', { appeal_id: 'ap-1' });
  const twoClaims = () => {
    const x = S.deniedClaim();
    S.claim(x, { claim_id: 'cl-8', member_id: 'm-1', provider_id: 'pv-5', received_at: '2026-11-12T11:00:00-05:00', lines: lines('svc-knee-mri') });
    S.window(x, 'claim', 'cl-8', S.process(x, 'cl-8', lines('svc-knee-mri').map(l => S.denied(l.line_id, 'out_of_network', l.billed_cents))).issued_at);
    return S.finalize(x);
  };
  const onFirst = S.openAppeal(undefined, undefined, twoClaims()), onSecond = S.openAppeal({ type: 'claim', id: 'cl-8' }, 'under_review', twoClaims());
  assert.deepEqual([onFirst.appeals.map(a => [a.appeal_id, a.target.id, a.lines, a.filed_at]), onSecond.appeals.map(a => [a.appeal_id, a.target.id, a.lines, a.filed_at])], [[['ap-1', 'cl-3', ['ln-1', 'ln-2'], '2026-11-17T09:00:00-05:00']], [['ap-1', 'cl-8', ['ln-1', 'ln-2'], '2026-11-17T09:00:00-05:00']]]);
  tryToken(onFirst, onSecond, 'appeals.withdraw', { appeal_id: 'ap-1' });
});

test('T09 appeals.list and appeals.get show only members the actor may view, filter by member and status, and list the actor\'s withdrawal approvals', () => {
  const s = S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', S.openAppeal(undefined, undefined, S.deniedClaim(undefined, S.deniedPa())), { appeal_id: 'ap-2' });
  const f = fixture({ seed: s });
  assert.deepEqual(f.call(P + 'appeals.list').appeals.map(a => a.appeal_id), ['ap-1']);
  assert.equal(f.call(P + 'appeals.get', { appeal_id: 'ap-2' }).status, 'not_authorized');
  assert.equal(f.call(P + 'appeals.list', { member_id: 'm-2' }).status, 'not_authorized');
  const g = fixture({ seed: S.granted(structuredClone(s)) });
  assert.deepEqual(g.call(P + 'appeals.list').appeals.map(a => a.appeal_id), ['ap-1', 'ap-2']);
  assert.deepEqual(g.call(P + 'appeals.list', { member_id: 'm-2' }).appeals.map(a => a.appeal_id), ['ap-2']);
  assert.deepEqual(g.call(P + 'appeals.list', { status: 'withdrawn' }).appeals, []);
  const token = 'tok-withdraw-appeal-ap-1-' + 'a'.repeat(32);
  ok(g, token);
  assert.deepEqual(g.call(P + 'appeals.get', { appeal_id: 'ap-1' }).appeal.approvals.map(a => a.token), [token]);
  assert.deepEqual(g.call(P + 'appeals.get', { appeal_id: 'ap-2' }).appeal.approvals, []);
  withdraw(g, 'ap-1');
  assert.deepEqual(g.call(P + 'appeals.list', { status: 'withdrawn' }).appeals.map(a => [a.appeal_id, a.status, a.withdrawn_at]), [['ap-1', 'withdrawn', T0]]);
  assert.equal(g.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-2' }).status, 'not_authorized');
});

test('T09 a hidden member\'s appeal and window timers run for everyone without blocking or revealing anything to a caller who cannot see that member', () => {
  const f = fixture({ seed: S.openAppeal({ type: 'pa', id: 'pa-3' }) });
  f.setNow('2027-04-26T09:00:00-04:00');
  const read = f.call(P + 'claims.list');
  assert.deepEqual([read.status, read.claims.map(c => c.claim_id), f.call(P + 'appeals.list').appeals], ['ok', ['cl-1'], []]);
  tick(f);
  assert.deepEqual([f.data().appeals[0].overdue, f.data().windows[0].closing.done, f.data().notices.map(x => [x.kind, x.recipient_id])], [true, true, [['notice.decision_overdue', 'm-2'], ['notice.appeal_window_closing', 'm-2']]]);
  assert.equal(JSON.stringify(f.call(P + 'members.list')).includes('pa-3'), false);
  reopen(f);
});

function rng(k) { let x = (k * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

test('T09 random appeal calls at one instant, sometimes a due or closing time, commit in any order and every state loads', () => {
  const tally = { filed: 0, decided: 0, withdrawn: 0, v2: 0, events: 0 };
  for (let k = 1; k <= 60; k++) {
    const r = rng(k), pick = list => list[Math.floor(r() * list.length)];
    const s = S.openAppeal({ type: 'pa', id: 'pa-3' }, pick(['under_review', 'info_requested']), actOn(S.deniedClaim(undefined, S.deniedPa())), { appeal_id: 'ap-1', filed_at: '2026-11-16T09:00:00-05:00' });
    const f = fixture({ seed: s });
    f.setNow(pick([T0, '2026-12-16T23:59:00-05:00', '2027-04-25T23:59:00-04:00', '2027-04-30T23:59:00-04:00', '2027-05-09T23:58:00-04:00']));
    const actions = ['file-claim', 'file-pa', 'withdraw', 'withdraw', 'decide', 'decide', 'info', 'statement', 'tick', 'file-claim', 'decide'].map(a => [r(), a]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    for (const kind of actions) {
      const open = f.call(P + 'appeals.list').appeals.filter(a => a.status === 'under_review' || a.status === 'info_requested');
      const a = open.length ? pick(open) : null;
      let out = { status: 'committed' };
      if (kind === 'file-claim' || kind === 'file-pa') {
        const args = kind === 'file-claim' ? CLAIM : { ...PA, expedited: r() < 0.5, urgency_attested: true };
        const pv = preview(f, args);
        if (pv.status !== 'ok') { assert.ok(['not_appealable', 'duplicate_request', 'appeal_window_closed'].includes(pv.status), pv.status); continue; }
        ok(f, pv.preview.token);
        out = fileConfirm(f, args, pv.preview.token);
        tally.filed++;
      }
      if (kind === 'withdraw' && a) { withdraw(f, a.appeal_id); tally.withdrawn++; continue; }
      if (kind === 'decide' && a) {
        const payload = r() < 0.3 ? { outcome: 'upheld' } : a.target.type === 'claim' ? { outcome: 'overturned', lines: a.lines.filter(() => r() < 0.7).concat(a.lines[0]).filter((x, i, l) => l.indexOf(x) === i) } : { outcome: 'overturned', units: 1, valid_until: pick(['2026-11-01', '2027-06-30']) };
        out = decide(f, a.appeal_id, payload);
        tally.decided++;
      }
      if (kind === 'info' && a) out = ev(f, 'appeal.info_requested', { appeal_id: a.appeal_id, request: 'More records' });
      if (kind === 'statement' && a) out = f.call(P + 'appeals.add_statement', { appeal_id: a.appeal_id, statement: 'More.' });
      if (kind === 'tick') tick(f);
      assert.equal(out.status, 'committed', k + ' ' + kind + ' ' + out.message);
      tally.events++;
    }
    tally.v2 += f.data().eobs.filter(e => e.version === 2).length;
    reopen(f);
  }
  assert.ok(tally.filed > 30 && tally.decided > 40 && tally.withdrawn > 20 && tally.v2 > 10, JSON.stringify(tally));
});
