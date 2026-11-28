'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, householdSeed } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e20-' + (++n), at: f.ctx.virtual_now, operation, payload });
const ok = (f, token, by = 'p-2') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const preview = (f, args) => f.call(P + 'grants.change.preview', args);
const confirm = (f, args, token) => f.call(P + 'grants.change.confirm', { ...args, token });
const commit = (f, args, by = 'p-2') => { const pv = preview(f, args).preview; ok(f, pv.token, by); return confirm(f, args, pv.token); };
const person = (f, id) => f.data().people.find(p => p.person_id === id);
const grant = (f, id) => f.data().grants.find(g => g.grant_id === id);
const fillOf = (f, id) => f.data().fills.find(x => x.fill_id === id);
const changed = o => ({ grant_id: 'g-2', patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-1', scope: 'view', fill_id: null, expires_at: null, status: 'active', ...o });
const PICKUP = { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'pickup' };
const NOW = '2026-11-30T09:00:00-05:00';

test('T20 a grant needs the grantor\'s confirmation: required, wrong person, then the right one commits once', () => {
  const f = fixture();
  const notices = f.data().notices.length;
  const pv = preview(f, PICKUP).preview;
  assert.match(pv.token, /^tok-grant-patient-p-2-[0-9a-f]{32}$/);
  assert.deepEqual([pv.required_confirmer, pv.changes], ['p-2', { grant_id: null, before: null, after: { scope: 'pickup', fill_id: null, expires_at: null, state: 'active' } }]);
  assert.equal(confirm(f, PICKUP, pv.token).status, 'confirmation_required');
  ok(f, pv.token, 'p-1');
  assert.equal(confirm(f, PICKUP, pv.token).status, 'confirmation_invalid');
  ok(f, pv.token);
  const out = confirm(f, PICKUP, pv.token);
  assert.equal(out.status, 'committed');
  assert.deepEqual(out.grant, { grant_id: 'g-2', grant_version: 0, patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: null, state: 'active' });
  assert.deepEqual([grant(f, 'g-2').created_at, person(f, 'p-2').grant_set_version], [NOW, 1]);
  assert.deepEqual(f.data().approvals.map(a => [a.approval_id, a.confirmed_by, a.used_at]), [['ap-1', 'p-1', null], ['ap-2', 'p-2', NOW]]);
  assert.deepEqual(f.data().approvals[1].subject, { action: 'grant', kind: 'patient', id: 'p-2' });
  assert.equal(confirm(f, PICKUP, pv.token).status, 'confirmation_invalid');
  assert.deepEqual(f.call(P + 'grants.list', { patient_id: 'p-2' }).approvals.map(a => [a.token, a.state]), [[pv.token, 'used']]);
  assert.equal(f.data().notices.length, notices);
});

test('T20 an approval is usable for less than 30 minutes; after it expires a fresh one commits and only that one is used', () => {
  for (const [at, expected] of [['2026-11-30T09:29:59.999-05:00', 'committed'], ['2026-11-30T09:30:00-05:00', 'confirmation_invalid']]) {
    const f = fixture();
    const pv = preview(f, PICKUP).preview;
    ok(f, pv.token);
    f.setNow(at);
    assert.equal(confirm(f, PICKUP, pv.token).status, expected, at);
  }
  const f = fixture();
  const pv = preview(f, PICKUP).preview;
  ok(f, pv.token);
  f.setNow('2026-11-30T09:45:00-05:00');
  assert.equal(confirm(f, PICKUP, pv.token).status, 'confirmation_invalid');
  ok(f, pv.token);
  f.setNow('2026-11-30T10:14:59-05:00');
  assert.equal(confirm(f, PICKUP, pv.token).status, 'committed');
  assert.deepEqual(f.data().approvals.map(a => [a.confirmed_at, a.used_at]), [[NOW, null], ['2026-11-30T09:45:00-05:00', '2026-11-30T10:14:59-05:00']]);
});

test('T20 changed arguments or target → stale_preview and the approval stays unused; unrelated writes and the approval event keep the token', () => {
  const f = fixture();
  const args = { ...PICKUP, expires_at: '2026-12-31T12:00:00-05:00' };
  const pv = preview(f, args).preview;
  ok(f, pv.token);
  assert.equal(confirm(f, { ...args, scope: 'view' }, pv.token).status, 'stale_preview');
  assert.equal(confirm(f, { ...args, expires_at: '2026-12-31T12:00:01-05:00' }, pv.token).status, 'stale_preview');
  assert.equal(f.data().approvals[0].used_at, null);
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'committed');
  const out = confirm(f, { ...args, expires_at: '2026-12-31T17:00:00Z' }, pv.token);
  assert.deepEqual([out.status, out.grant.expires_at], ['committed', '2026-12-31T12:00:00-05:00']);
  const g = fixture();
  const first = preview(g, PICKUP).preview;
  ok(g, first.token);
  ev(g, 'grant.changed', changed({ grant_id: 'g-9', grantee_id: 'p-4' }));
  assert.equal(confirm(g, PICKUP, first.token).status, 'stale_preview');
  const again = preview(g, PICKUP).preview;
  assert.notEqual(again.token, first.token);
  ok(g, again.token);
  assert.equal(confirm(g, PICKUP, again.token).grant.grant_id, 'g-2');
});

test('T20 confirm order: authority, then the approval, then freshness, then state', () => {
  const f = fixture();
  const foreign = { action: 'grant', patient_id: 'p-1', grantee_id: 'p-4', scope: 'view' };
  assert.equal(preview(f, foreign).status, 'not_authorized');
  const made = 'tok-grant-patient-p-1-' + '0'.repeat(32);
  ok(f, made);
  assert.equal(confirm(f, foreign, made).status, 'not_authorized');
  const args = { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view', expires_at: '2026-11-30T09:40:00-05:00' };
  const other = 'tok-grant-patient-p-2-' + '1'.repeat(32);
  assert.equal(confirm(f, args, other).status, 'confirmation_required');
  const pv = preview(f, args).preview;
  f.setNow('2026-11-30T09:20:00-05:00');
  ok(f, pv.token);
  ok(f, other);
  f.setNow('2026-11-30T09:45:00-05:00');
  assert.equal(confirm(f, args, other).status, 'stale_preview');
  assert.equal(confirm(f, args, pv.token).status, 'invalid_state');
  const g = fixture();
  ev(g, 'grant.changed', changed({ expires_at: '2026-11-30T10:00:00-05:00' }));
  const revoke = { action: 'revoke', grant_id: 'g-2' };
  const rv = preview(g, revoke).preview;
  assert.deepEqual(rv.changes, { grant_id: 'g-2', before: { scope: 'view', fill_id: null, expires_at: '2026-11-30T10:00:00-05:00', state: 'active' }, after: { scope: 'view', fill_id: null, expires_at: '2026-11-30T10:00:00-05:00', state: 'revoked' } });
  g.setNow('2026-11-30T09:50:00-05:00');
  ok(g, rv.token);
  g.setNow('2026-11-30T10:05:00-05:00');
  assert.equal(confirm(g, revoke, rv.token).status, 'stale_preview');
  assert.equal(preview(g, revoke).status, 'invalid_state');
});

test('T20 approvals shown: unparsable tokens are stored with no subject; a first grant is listed for a patient with no grants; nothing for subjects the actor cannot act on', () => {
  const f = fixture();
  ok(f, 'tok-7c1e');
  assert.deepEqual(f.data().approvals[0], { approval_id: 'ap-1', token: 'tok-7c1e', subject: null, confirmed_by: 'p-2', confirmed_at: NOW, used_at: null });
  const minor = { action: 'grant', patient_id: 'p-3', grantee_id: 'p-4', scope: 'pickup' };
  const pv = preview(f, minor).preview;
  ok(f, pv.token);
  ok(f, 'tok-revoke-grant-g-1-' + 'a'.repeat(32));
  ok(f, 'tok-grant-patient-p-1-' + 'b'.repeat(32));
  ok(f, 'tok-prepay-fill-f-77-' + 'c'.repeat(32));
  const listed = f.call(P + 'grants.list', { patient_id: 'p-3' });
  assert.deepEqual([listed.grants, listed.approvals], [[], [{ token: pv.token, confirmed_at: NOW, expires_at: '2026-11-30T09:30:00-05:00', state: 'active' }]]);
  assert.deepEqual(f.call(P + 'grants.list', {}).approvals.map(a => a.token), [pv.token]);
  assert.deepEqual(f.call(P + 'grants.list', {}).grants.map(g => g.grant_id), ['g-1']);
  const other = fixture({ seed: baseSeed() });
  ok(other, 'tok-prepay-fill-f-5-' + 'd'.repeat(32), 'p-1');
  assert.deepEqual(other.call(P + 'fills.get', { fill_id: 'f-5' }).fill.approvals, []);
});

test('T20 a subject ID with _, . and : round-trips through the token, user.confirmed and the listing', () => {
  const s = structuredClone(minimal);
  s.people.push({ person_id: 'kid_1.a:b', name: 'Noa Rivera', relation: 'child', birth_date: '2016-04-02', is_minor: true, guardian_ids: ['p-2'], plan_id: null, grant_set_version: 0 });
  const binding = structuredClone(require('../fixtures/binding.json'));
  binding.people.push({ person_id: 'kid_1.a:b', name: 'Noa Rivera' });
  const f = fixture({ seed: s, binding });
  const args = { action: 'grant', patient_id: 'kid_1.a:b', grantee_id: 'p-1', scope: 'view' };
  const pv = preview(f, args).preview;
  assert.match(pv.token, /^tok-grant-patient-kid_1\.a:b-[0-9a-f]{32}$/);
  ok(f, pv.token);
  assert.deepEqual(f.data().approvals[0].subject, { action: 'grant', kind: 'patient', id: 'kid_1.a:b' });
  assert.deepEqual(f.call(P + 'grants.list', { patient_id: 'kid_1.a:b' }).approvals.map(a => a.state), ['active']);
  assert.equal(confirm(f, args, pv.token).grant.grantor_id, 'p-2');
});

test('T18 an unrelated adult cannot grant; a guardian grants for a minor; argument and target checks', () => {
  const f = fixture();
  assert.equal(preview(f, { action: 'grant', patient_id: 'p-1', grantee_id: 'p-2', scope: 'pickup' }).status, 'not_authorized');
  assert.equal(preview(f, { action: 'grant', patient_id: 'p-4', grantee_id: 'p-1', scope: 'pickup' }).status, 'not_authorized');
  assert.equal(preview(f, { action: 'revoke', grant_id: 'g-1' }).status, 'not_authorized');
  const minor = { action: 'grant', patient_id: 'p-3', grantee_id: 'p-4', scope: 'pickup', expires_at: '2026-12-15T18:00:00-05:00' };
  assert.deepEqual(commit(f, minor).grant, { grant_id: 'g-2', grant_version: 0, patient_id: 'p-3', grantor_id: 'p-2', grantee_id: 'p-4', scope: 'pickup', fill_id: null, expires_at: '2026-12-15T18:00:00-05:00', state: 'active' });
  assert.deepEqual(f.data().people.map(p => p.grant_set_version), [0, 0, 1, 1]);
  const fid = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  const cases = [
    [{ ...PICKUP, grantee_id: 'p-2' }, 'invalid_arguments'],
    [{ ...PICKUP, scope: 'view', fill_id: fid }, 'invalid_arguments'],
    [{ action: 'revoke', grant_id: 'g-1', patient_id: 'p-4' }, 'invalid_arguments'],
    [{ action: 'grant', grant_id: 'g-1', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view' }, 'invalid_arguments'],
    [{ ...PICKUP, grantee_id: 'p-9' }, 'not_found'],
    [{ ...PICKUP, fill_id: 'f-99' }, 'not_found'],
    [{ ...PICKUP, patient_id: 'p-9' }, 'not_found'],
    [{ action: 'revoke', grant_id: 'g-99' }, 'not_found'],
    [{ ...PICKUP, fill_id: fid }, 'invalid_state'],
    [{ ...PICKUP, expires_at: NOW }, 'invalid_state'],
    [{ ...PICKUP, expires_at: '2026-11-30T08:00:00-05:00' }, 'invalid_state'],
  ];
  for (const [args, code] of cases) assert.equal(preview(f, args).status, code, JSON.stringify(args));
  const made = 'tok-grant-patient-p-2-' + '2'.repeat(32);
  ok(f, made);
  for (const [args, code] of cases) assert.equal(confirm(f, args, made).status, code === 'invalid_state' ? 'stale_preview' : code, 'confirm ' + JSON.stringify(args));
});

test('grants.change: a grant on an identity with a live grant updates its expiry; revoke needs a live grant; ended grants are granted again', () => {
  const f = fixture();
  assert.equal(commit(f, PICKUP).grant.grant_id, 'g-2');
  const upd = { ...PICKUP, expires_at: '2026-12-20T12:00:00-05:00' };
  const pv = preview(f, upd).preview;
  assert.match(pv.token, /^tok-grant-grant-g-2-[0-9a-f]{32}$/);
  assert.deepEqual(pv.changes, { grant_id: 'g-2', before: { scope: 'pickup', fill_id: null, expires_at: null, state: 'active' }, after: { scope: 'pickup', fill_id: null, expires_at: '2026-12-20T12:00:00-05:00', state: 'active' } });
  ok(f, pv.token);
  assert.deepEqual([confirm(f, upd, pv.token).grant.grant_version, f.data().grants.length, person(f, 'p-2').grant_set_version], [1, 2, 2]);
  assert.equal(preview(f, upd).status, 'invalid_state');
  const revoke = { action: 'revoke', grant_id: 'g-2' };
  assert.deepEqual(preview(f, revoke).preview.changes.after, { scope: 'pickup', fill_id: null, expires_at: '2026-12-20T12:00:00-05:00', state: 'revoked' });
  const out = commit(f, revoke);
  assert.deepEqual([out.grant.state, out.grant.grant_version, grant(f, 'g-2').revoked_at, person(f, 'p-2').grant_set_version], ['revoked', 2, NOW, 3]);
  assert.equal(preview(f, revoke).status, 'invalid_state');
  assert.equal(commit(f, upd).grant.grant_id, 'g-3');
  f.setNow('2026-12-21T09:00:00-05:00');
  assert.equal(preview(f, { action: 'revoke', grant_id: 'g-3' }).status, 'invalid_state');
  assert.equal(commit(f, { ...upd, expires_at: '2027-01-20T12:00:00-05:00' }).grant.grant_id, 'g-4');
});

test('grant.changed: create with its own ID (never reissued), update, revoke, no-ops and every refusal', () => {
  const f = fixture();
  const fid = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  ev(f, 'grant.changed', changed());
  assert.deepEqual([grant(f, 'g-2').grant_version, grant(f, 'g-2').created_at, person(f, 'p-2').grant_set_version], [0, NOW, 1]);
  assert.equal(commit(f, { action: 'grant', patient_id: 'p-2', grantee_id: 'p-4', scope: 'view' }).grant.grant_id, 'g-3');
  ev(f, 'grant.changed', changed({ expires_at: '2026-12-10T09:00:00-05:00' }));
  assert.deepEqual([grant(f, 'g-2').grant_version, grant(f, 'g-2').expires_at, person(f, 'p-2').grant_set_version], [1, '2026-12-10T09:00:00-05:00', 3]);
  ev(f, 'grant.changed', changed({ expires_at: '2026-12-10T14:00:00Z' }));
  assert.deepEqual([grant(f, 'g-2').grant_version, person(f, 'p-2').grant_set_version], [1, 3]);
  const refusals = [
    changed({ grantee_id: 'p-4', expires_at: '2026-12-10T09:00:00-05:00' }),
    changed({ patient_id: 'p-3', grantor_id: 'p-2' }),
    changed({ scope: 'refill' }),
    changed({ expires_at: NOW }),
    { grant_id: 'g-50', status: 'revoked' },
    changed({ grant_id: 'g-51', grantor_id: 'p-1' }),
    changed({ grant_id: 'g-52', grantee_id: 'p-2' }),
    changed({ grant_id: 'g-53', patient_id: 'p-4', grantor_id: 'p-4', fill_id: fid }),
    changed({ grant_id: 'g-54', scope: 'pickup', fill_id: fid }),
    changed({ grant_id: 'g-55', expires_at: '2026-12-01T09:00:00-05:00' }),
    changed({ grant_id: 'g-56', expires_at: '2026-11-30T08:59:00-05:00' }),
    { grant_id: 'g-2', status: 'revoked', expires_at: null },
    { grant_id: 'g-2', status: 'revoked', grantee_id: 'p-4' },
    changed({ grant_id: 'g-57', patient_id: 'p-9' }),
    changed({ grant_id: 'g-58', fill_id: 'f-99', scope: 'pickup' }),
  ];
  for (const payload of refusals) {
    const before = JSON.stringify(f.data());
    assert.equal(ev(f, 'grant.changed', payload).status, 'invalid_event', JSON.stringify(payload));
    assert.equal(JSON.stringify(f.data()), before);
  }
  assert.equal(ev(f, 'grant.changed', { grant_id: 'g-2', status: 'revoked', patient_id: 'p-2', expires_at: '2026-12-10T09:00:00-05:00' }).status, 'committed');
  assert.deepEqual([grant(f, 'g-2').status, grant(f, 'g-2').revoked_at, grant(f, 'g-2').grant_version, person(f, 'p-2').grant_set_version], ['revoked', NOW, 2, 4]);
  assert.equal(ev(f, 'grant.changed', { grant_id: 'g-2', status: 'revoked' }).status, 'committed');
  assert.deepEqual([grant(f, 'g-2').grant_version, person(f, 'p-2').grant_set_version], [2, 4]);
  assert.equal(ev(f, 'grant.changed', changed()).status, 'invalid_event');
  assert.equal(ev(f, 'grant.changed', changed({ grant_id: 'g-60', patient_id: 'p-3', grantor_id: 'p-1', grantee_id: 'p-4', scope: 'pickup' })).status, 'committed');
  assert.deepEqual([grant(f, 'g-60').grantor_id, person(f, 'p-3').grant_set_version], ['p-1', 1]);
  f.setNow('2026-12-11T09:00:00-05:00');
  assert.equal(ev(f, 'grant.changed', changed({ grant_id: 'g-3', grantee_id: 'p-4', expires_at: '2026-12-30T09:00:00-05:00' })).status, 'committed');
  assert.equal(ev(f, 'grant.changed', changed({ grant_id: 'g-61', grantee_id: 'p-4' })).status, 'invalid_event');
  assert.equal(commit(f, { action: 'grant', patient_id: 'p-2', grantee_id: 'p-3', scope: 'view' }).grant.grant_id, 'g-4');
});

test('fills.set_collector: who may be named, the fill-specific grant is recorded, and the record clears when that grant ends', () => {
  const f = fixture();
  const fid = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  ev(f, 'grant.changed', changed({ grant_id: 'g-7', patient_id: 'p-4', grantor_id: 'p-4', scope: 'pickup', expires_at: '2026-12-05T12:00:00-05:00' }));
  ev(f, 'grant.changed', changed({ grant_id: 'g-8', patient_id: 'p-4', grantor_id: 'p-4', scope: 'pickup', fill_id: fid, expires_at: '2026-12-02T12:00:00-05:00' }));
  const set = id => f.call(P + 'fills.set_collector', { fill_id: fid, collector_id: id });
  const v = fillOf(f, fid).fill_version;
  assert.equal(set('p-1').fill.collector_id, 'p-1');
  assert.deepEqual([fillOf(f, fid).collector, fillOf(f, fid).fill_version], [{ person_id: 'p-1', via_grant_id: 'g-8', set_at: NOW }, v]);
  assert.deepEqual(['p-9', 'p-3', 'p-2'].map(id => set(id).status), ['not_found', 'not_authorized', 'not_authorized']);
  assert.deepEqual(set('p-4').fill.collector_id, 'p-4');
  assert.equal(fillOf(f, fid).collector.via_grant_id, null);
  assert.equal(set(null).fill.collector_id, null);
  set('p-1');
  f.setNow('2026-12-02T12:00:00-05:00');
  const projected = f.call(P + 'fills.get', { fill_id: fid }).fill;
  assert.deepEqual([projected.collector_id, fillOf(f, fid).collector.person_id], [null, 'p-1']);
  ok(f, 'tok-7c1e');
  assert.deepEqual([fillOf(f, fid).collector, fillOf(f, fid).fill_version], [null, projected.fill_version]);
  assert.equal(set('p-1').fill.collector_id, 'p-1');
  assert.equal(fillOf(f, fid).collector.via_grant_id, 'g-7');
  ev(f, 'grant.changed', { grant_id: 'g-7', status: 'revoked' });
  assert.equal(fillOf(f, fid).collector, null);
  ev(f, 'rx.received', { rx_id: 'rx-9', patient_id: 'p-3', prescriber_id: 'dr-1', drug_id: 'd-amoxicillin-250-5', quantity: 100, fills_authorized: 2, written_on: '2026-12-01' });
  const kid = f.call(P + 'fills.request', { rx_id: 'rx-9', store_id: 'st-1', quantity: 100 }).fill.fill_id;
  commit(f, { action: 'grant', patient_id: 'p-3', grantee_id: 'p-4', scope: 'pickup' });
  assert.equal(f.call(P + 'fills.set_collector', { fill_id: kid, collector_id: 'p-4' }).fill.collector_id, 'p-4');
  const gid = fillOf(f, kid).collector.via_grant_id;
  commit(f, { action: 'revoke', grant_id: gid });
  assert.equal(fillOf(f, kid).collector, null);
  assert.equal(f.call(P + 'fills.set_collector', { fill_id: kid, collector_id: 'p-1' }).fill.collector_id, 'p-1');
  const done = fixture({ seed: baseSeed() });
  assert.deepEqual([done.call(P + 'fills.set_collector', { fill_id: 'f-6', collector_id: 'p-4' }).status, done.call(P + 'fills.set_collector', { fill_id: 'f-6', collector_id: null }).status], ['invalid_state', 'invalid_state']);
  const viewer = fixture({ seed: householdSeed() });
  assert.equal(viewer.call(P + 'fills.set_collector', { fill_id: 'f-31', collector_id: 'p-1' }).status, 'not_authorized');
});
