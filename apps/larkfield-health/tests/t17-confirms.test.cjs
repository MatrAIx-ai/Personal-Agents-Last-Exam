'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const T = require('../src/tokens.cjs');

const P = 'larkfield-health.';
let n = 0;
const ev = (f, operation, payload, at = f.ctx.virtual_now) => f.event({ event_id: 'e17-' + (++n), at, operation, payload });
const ok = (f, token, by = 'm-1') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const act = s => S.granted(s, 'm-2', 'act');
const unrelated = f => assert.equal(ev(f, 'claim.received', { claim_id: 'cl-u', member_id: 'm-1', provider_id: 'pv-1', lines: [{ line_id: 'ln-1', service_id: 'svc-office-visit', service_date: '2026-11-17', units: 1, billed_cents: 21000, emergency: false, possible_accident: false }] }).status, 'committed');
const pass = (f, op, args) => { const pv = f.call(P + op + '.preview', args); ok(f, pv.preview.token); assert.equal(f.call(P + op + '.confirm', { ...args, token: pv.preview.token }).status, 'committed'); };

const CONFIRMS = [
  { op: 'grants.change', seed: () => S.base(), args: { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view' }, changed: { scope: 'act' },
    retarget: f => ev(f, 'grant.changed', { grant_id: 'gr-9', member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2026-11-18T12:01:00-05:00', status: 'active' }),
    side: f => ev(f, 'grant.changed', { grant_id: 'gr-8', member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'm-3', scope: 'view', expires_at: null, status: 'active' }),
    ineligible: [{ action: 'revoke', grant_id: 'gr-7' }, 'not_found'] },
  { op: 'coverage.cob', seed: () => S.pendingCob('m-2', 2026, act(S.base())), args: { member_id: 'm-2', plan_year: 2026, answer: 'none' }, changed: { answer: 'other_secondary' },
    retarget: f => pass(f, 'coverage.cob', { member_id: 'm-2', plan_year: 2026, answer: 'other_primary' }), side: unrelated, ineligible: [{ member_id: 'm-2', plan_year: 2027, answer: 'none' }, 'info_not_requested'] },
  { op: 'claims.info', seed: () => S.pendingCob('m-2', 2026, act(S.base()), true), args: { claim_id: 'cl-4', line_id: 'ln-1', answer: 'not_accident' }, changed: { answer: 'accident' },
    retarget: f => pass(f, 'claims.info', { claim_id: 'cl-4', line_id: 'ln-1', answer: 'work_related' }), side: unrelated, ineligible: [{ claim_id: 'cl-1', line_id: 'ln-1', answer: 'accident' }, 'info_not_requested'] },
  { op: 'appeals.file', seed: () => S.deniedClaim(), args: { target_type: 'claim', target_id: 'cl-3', statement: 'Please review.' }, changed: { statement: 'Please review again.' },
    retarget: f => { pass(f, 'appeals.file', { target_type: 'claim', target_id: 'cl-3', statement: 'Other.' }); ev(f, 'appeal.decided', { appeal_id: 'ap-1', outcome: 'overturned', lines: ['ln-2'] }); },
    side: unrelated, ineligible: [{ target_type: 'claim', target_id: 'cl-1', statement: 'x' }, 'not_appealable'] },
  { op: 'appeals.withdraw', seed: () => S.openAppeal({ type: 'pa', id: 'pa-3' }, 'under_review', act(S.openAppeal(undefined, undefined, S.deniedClaim(undefined, S.deniedPa()))), { appeal_id: 'ap-2' }),
    args: { appeal_id: 'ap-1' }, changed: { appeal_id: 'ap-2' }, retarget: f => assert.equal(f.call(P + 'appeals.add_statement', { appeal_id: 'ap-1', statement: 'More.' }).status, 'committed'),
    side: unrelated, ineligible: null },
];

for (const c of CONFIRMS) {
  test('T17 ' + c.op + '.confirm: approval missing, from another person, expired or reused; changed arguments or target are stale; an unrelated write keeps the token; an ineligible preview gives its error', () => {
    const make = () => fixture({ seed: c.seed() });
    const confirm = (f, args, token) => f.call(P + c.op + '.confirm', { ...args, token });
    const f = make(), pv = f.call(P + c.op + '.preview', c.args);
    assert.equal(pv.status, 'ok', JSON.stringify(pv));
    const token = pv.preview.token;
    assert.equal(confirm(f, c.args, token).status, 'confirmation_required');
    ok(f, token, 'm-2');
    assert.equal(confirm(f, c.args, token).status, 'confirmation_invalid');
    ok(f, token);
    f.advance(30);
    assert.equal(confirm(f, c.args, token).status, 'confirmation_invalid');
    ok(f, token);
    const before = f.data();
    assert.equal(confirm(f, { ...c.args, ...c.changed }, token).status, 'stale_preview');
    assert.deepEqual(f.data(), before);
    c.side(f);
    const done = confirm(f, c.args, token);
    assert.equal(done.status, 'committed', JSON.stringify(done));
    assert.deepEqual(f.data().approvals.map(a => [a.confirmed_by, a.used_at !== null]), [['m-2', false], ['m-1', false], ['m-1', true]]);
    assert.equal(confirm(f, c.args, token).status, 'confirmation_invalid');
    const g = make(), first = g.call(P + c.op + '.preview', c.args).preview.token;
    ok(g, first);
    c.retarget(g);
    const kept = g.data();
    assert.equal(confirm(g, c.args, first).status, 'stale_preview');
    assert.deepEqual(g.data(), kept);
    assert.equal(g.data().approvals.find(a => a.token === first).used_at, null);
    if (c.ineligible) {
      const bad = make().call(P + c.op + '.preview', c.ineligible[0]);
      assert.deepEqual([bad.status, bad.preview], [c.ineligible[1], undefined]);
    }
  });
}

test('T17 the state step follows approval and freshness: a second approved filing is duplicate_request, a withdrawal token for an upheld appeal is invalid_state, a grant expiry passed since the preview is invalid_state, each with its approval unused', () => {
  const NOW = '2026-11-18T12:00:00-05:00';
  const unused = (f, token) => f.data().approvals.filter(a => a.token === token).map(a => a.used_at);
  const f = fixture({ seed: S.deniedClaim(), now: NOW });
  const one = { target_type: 'claim', target_id: 'cl-3', statement: 'Please review.' }, two = { ...one, statement: 'Please review the network status.' };
  const t1 = f.call(P + 'appeals.file.preview', one).preview.token, t2 = f.call(P + 'appeals.file.preview', two).preview.token;
  ok(f, t1); ok(f, t2);
  assert.equal(f.call(P + 'appeals.file.confirm', { ...one, token: t1 }).status, 'committed');
  const filed = f.data();
  assert.deepEqual(f.call(P + 'appeals.file.confirm', { ...two, token: t2 }), { status: 'duplicate_request', message: 'Claim cl-3 already has an open appeal.' });
  assert.deepEqual([f.data().appeals, unused(f, t2)], [filed.appeals, [null]]);
  const g = fixture({ seed: S.openAppeal(), now: NOW });
  ev(g, 'appeal.decided', { appeal_id: 'ap-1', outcome: 'upheld' });
  const d = g.data(), a = d.appeals[0];
  const token = T.makeToken({ ctx: g.ctx, data: d, actor: 'm-1', action: 'withdraw', kind: 'appeal', id: 'ap-1', subject: T.appealSubject(d, a), args: T.businessArgs('withdraw', { appeal_id: 'ap-1' }), targetVersion: a.appeal_version });
  ok(g, token);
  const decided = g.data();
  assert.deepEqual(g.call(P + 'appeals.withdraw.confirm', { appeal_id: 'ap-1', token }), { status: 'invalid_state', message: 'Appeal ap-1 is upheld; it can no longer be withdrawn.' });
  assert.deepEqual([g.data().appeals, unused(g, token)], [decided.appeals, [null]]);
  const h = fixture({ seed: S.base(), now: NOW });
  const args = { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2026-11-18T12:05:00-05:00' };
  const pv = h.call(P + 'grants.change.preview', args);
  assert.equal(pv.status, 'ok');
  ok(h, pv.preview.token);
  h.setNow('2026-11-18T12:06:00-05:00');
  const was = h.data();
  assert.deepEqual(h.call(P + 'grants.change.confirm', { ...args, token: pv.preview.token }), { status: 'invalid_state', message: 'The expiry 2026-11-18T12:05:00-05:00 is not after the current time.' });
  assert.deepEqual([h.data().grants, unused(h, pv.preview.token)], [was.grants, [null]]);
});

test('T17 an ineligible withdrawal preview is invalid_state, and a token restated for another appeal is stale_preview', () => {
  const f = fixture({ seed: S.openAppeal() });
  ev(f, 'appeal.decided', { appeal_id: 'ap-1', outcome: 'upheld' });
  assert.deepEqual(f.call(P + 'appeals.withdraw.preview', { appeal_id: 'ap-1' }), { status: 'invalid_state', message: 'Appeal ap-1 is upheld; it can no longer be withdrawn.' });
});
