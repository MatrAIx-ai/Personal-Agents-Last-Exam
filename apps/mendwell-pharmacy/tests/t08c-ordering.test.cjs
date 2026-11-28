'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, householdSeed, asActor, withCollected, rx } = require('./seeds.cjs');
const { confirmFlow } = require('../src/confirm.cjs');
const { makeToken } = require('../src/tokens.cjs');
const minimal = require('./unit-seed.json');
const binding = require('../fixtures/binding.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'ea-' + (++n), at: f.ctx.virtual_now, operation, payload });
const poke = f => ev(f, 'store.restocked', { store_id: 'st-1', drug_id: 'd-amoxicillin-250-5' });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const p1 = () => fixture(asActor(householdSeed(), binding, 'p-1'));
const kindsFor = (f, from, person) => f.data().notices.slice(from).filter(x => x.recipient_id === person).map(x => x.kind);

test('T08c confirm flow: approval before freshness before state before payment; approval used only on success', () => {
  const calls = [];
  const data = { approvals: [{ approval_id: 'ap-1', token: 'tok-a', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-11-30T08:50:00-05:00', used_at: null }] };
  const run = (over = {}) => { calls.length = 0; try { return confirmFlow({ data, now: Date.parse('2026-11-30T09:00:00-05:00'), at: '2026-11-30T09:00:00-05:00', token: 'tok-a', confirmer: 'p-2', authorize: () => { calls.push('auth'); if (over.auth) throw Object.assign(new Error('a'), { code: 'not_authorized' }); }, currentToken: () => { calls.push('fresh'); return over.current ?? 'tok-a'; }, checkState: () => { calls.push('state'); if (over.state) throw Object.assign(new Error('s'), { code: over.state }); }, pay: () => { calls.push('pay'); if (over.pay) throw Object.assign(new Error('p'), { code: over.pay }); }, commit: () => { calls.push('commit'); return 'ok'; }, ...over.args }); } catch (e) { return { code: e.code }; } };
  assert.equal(run({ auth: true, args: { token: 'tok-none' } }).code, 'not_authorized');
  assert.deepEqual(calls, ['auth']);
  assert.equal(run({ args: { token: 'tok-none' } }).code, 'confirmation_required');
  assert.deepEqual(calls, ['auth']);
  assert.equal(run({ args: { confirmer: 'p-1' } }).code, 'confirmation_invalid');
  assert.equal(run({ current: 'tok-b' }).code, 'stale_preview');
  assert.deepEqual(calls, ['auth', 'fresh']);
  assert.equal(run({ state: 'invalid_state' }).code, 'invalid_state');
  assert.equal(run({ pay: 'payment_failed' }).code, 'payment_failed');
  assert.deepEqual(calls, ['auth', 'fresh', 'state', 'pay']);
  assert.equal(data.approvals[0].used_at, null);
  assert.equal(run().result, 'ok');
  assert.equal(data.approvals[0].used_at, '2026-11-30T09:00:00-05:00');
  assert.equal(run().code, 'confirmation_invalid');
});

test('T08c pickup-only holders never receive held, claim_rejected, plan_decision or renewal_reply', () => {
  const s = householdSeed();
  s.grants.push({ grant_id: 'g-6', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-3', scope: 'pickup', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-01T09:00:00-05:00', revoked_at: null });
  s.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-8', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null });
  s.issued.g = 6; s.issued.rn = 1;
  s.prescriptions.find(r => r.rx_id === 'rx-8').fills_remaining = 0;
  const f = fixture({ seed: s });
  const from = f.data().notices.length;
  ev(f, 'fill.hold_placed', { fill_id: 'f-1', note: 'x' });
  ev(f, 'plan.decided', { plan_request_id: 'pr-1', decision: 'denied' });
  ev(f, 'renewal.replied', { renewal_id: 'rn-1', decision: 'denied' });
  f.setNow('2026-11-30T12:00:00-05:00');
  poke(f);
  const mothers = new Set(['f-1', 'f-2', 'f-3', 'f-4', 'f-5', 'f-6', 'f-7', 'f-8', 'rn-1']);
  assert.deepEqual(f.data().notices.slice(from).filter(x => x.recipient_id === 'p-3' && mothers.has(x.subject.id)).map(x => x.kind), []);
  assert.ok(kindsFor(f, from, 'p-2').includes('notice.held') && kindsFor(f, from, 'p-2').includes('notice.plan_decision') && kindsFor(f, from, 'p-2').includes('notice.renewal_reply'));
});

test('T08c household.list omits pickup-only grantors; grant windows end exactly at expires_at; a grant created after a due timer gets none of its notices', () => {
  assert.deepEqual(p1().call(P + 'household.list', {}).people.map(x => x.person_id), ['p-1', 'p-3']);
  const s = householdSeed();
  s.grants.find(g => g.grant_id === 'g-1').expires_at = '2026-11-30T10:30:00-05:00';
  const f = fixture({ seed: s });
  f.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(f.call(P + 'fills.get', { fill_id: 'f-1' }).status, 'not_authorized');
  const before = f.data().notices.length;
  poke(f);
  assert.ok(!f.data().notices.slice(before).some(x => x.subject.id === 'f-1' && x.recipient_id === 'p-2'));
  const late = householdSeed();
  late.grants = late.grants.filter(x => x.grant_id !== 'g-1');
  const g = fixture({ seed: late });
  const b2 = g.data().notices.length;
  g.event({ event_id: 'e08c-late-grant', at: '2026-11-30T10:45:00-05:00', operation: 'grant.changed', payload: { grant_id: 'g-9', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'active' } });
  const f1 = g.data().notices.slice(b2).filter(x => x.subject.id === 'f-1');
  assert.ok(f1.length > 0 && f1.every(x => x.at === '2026-11-30T10:30:00-05:00'));
  assert.ok(!f1.some(x => x.recipient_id === 'p-2'));
});

test('T08c ties: warning and return at exactly their due instant; a request at exactly 23:59 expiry → rx_expired', () => {
  const f = fixture({ seed: baseSeed(), now: '2026-12-06T12:00:00-05:00' });
  poke(f);
  assert.equal(stored(f, 'f-5').warned_at, '2026-12-06T12:00:00-05:00');
  f.setNow('2026-12-09T12:00:00-05:00');
  poke(f);
  assert.equal(stored(f, 'f-5').state, 'returned_to_stock');
  const s = structuredClone(minimal);
  Object.assign(s.prescriptions[0], { written_on: '2025-11-30', received_at: '2025-11-30T09:00:00-05:00' });
  const e = fixture({ seed: s, now: '2026-11-30T23:58:59-05:00' });
  e.setNow('2026-11-30T23:59:00-05:00');
  assert.equal(e.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'rx_expired');
});

test('T08c release, warning and store change each bump fill_version once', () => {
  const f = fixture({ seed: baseSeed() });
  ev(f, 'fill.hold_placed', { fill_id: 'f-1', note: 'x' });
  const v = stored(f, 'f-1').fill_version;
  ev(f, 'fill.hold_released', { fill_id: 'f-1', note: 'y' });
  assert.equal(stored(f, 'f-1').fill_version, v + 1);
  const w = stored(f, 'f-5').fill_version;
  f.setNow('2026-12-06T12:00:00-05:00');
  poke(f);
  assert.equal(stored(f, 'f-5').fill_version, w + 1);
  const s = stored(f, 'f-3').fill_version;
  f.call(P + 'fills.change_store', { fill_id: 'f-3', store_id: 'st-2' });
  assert.equal(stored(f, 'f-3').fill_version, s + 1);
});

test('T08c eligibility counts only the same drug; supersession leaves a ready fill; plan requests refuse quantity_limit', () => {
  const s = structuredClone(minimal);
  s.prescriptions.push(rx('rx-2', { drug_id: 'd-amoxicillin-250-5', quantity: 100 }));
  s.plans[1].rules['d-amoxicillin-250-5'] = { covered: true, max_quantity: null, prior_auth_required: false, refill_days: 7, copay_cents: 500 };
  withCollected(s, 'rx-2', '2026-11-29T15:00:00-05:00');
  const f = fixture({ seed: s });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(f.call(P + 'fills.get', { fill_id: id }).fill.claim.result, 'paid');
  const b = baseSeed();
  b.renewals.push({ renewal_id: 'rn-5', rx_id: 'rx-5', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null });
  b.issued.rn = 5;
  const g = fixture({ seed: b });
  assert.equal(ev(g, 'renewal.replied', { renewal_id: 'rn-5', decision: 'approved', rx: { rx_id: 'rx-55', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } }).status, 'committed');
  assert.equal(g.data().prescriptions.find(r => r.rx_id === 'rx-5').state, 'superseded');
  assert.equal(stored(g, 'f-5').state, 'ready');
  const q = fixture({ seed: structuredClone(minimal) });
  const qid = q.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 90 }).fill.fill_id;
  q.setNow('2026-11-30T11:00:00-05:00');
  poke(q);
  assert.equal(q.call(P + 'plan_requests.create', { fill_id: qid }).status, 'invalid_state');
  assert.equal(q.call(P + 'fills.change_quantity', { fill_id: qid, quantity: 90 }).status, 'invalid_state');
  assert.equal(q.data().claims.filter(c => c.fill_id === qid).length, 1);
});

test('T08c the cash token digests the actor and the seed ID; a store change keeps the review due time', () => {
  const f = fixture({ seed: baseSeed() });
  const ctx = f.ctx, data = f.data();
  const parts = { ctx, data, actor: 'p-2', action: 'cash', kind: 'fill', subject: { id: 'f-3' }, args: { fill_id: 'f-3' }, targetVersion: 0, changes: {} };
  assert.notEqual(makeToken(parts), makeToken({ ...parts, actor: 'p-1' }));
  assert.notEqual(makeToken(parts), makeToken({ ...parts, data: { ...data, seed_id: 'other' } }));
  const g = fixture({ seed: structuredClone(minimal) });
  const id = g.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  g.setNow('2026-11-30T10:00:00-05:00');
  const moved = g.call(P + 'fills.change_store', { fill_id: id, store_id: 'st-2' });
  assert.equal(moved.fill.review_due_at, '2026-11-30T11:00:00-05:00');
});

test('T08c unheld due times may not sit further ahead than their timers allow', () => {
  const a = baseSeed();
  a.fills.find(x => x.fill_id === 'f-1').review_due_at = '2026-12-20T10:30:00-05:00';
  assert.throws(() => fixture({ seed: a }), e => e.code === 'invalid_seed' && /more than 16 days ahead/.test(e.message));
  const b = baseSeed();
  Object.assign(b.fills.find(x => x.fill_id === 'f-5'), { warning_due_at: '2026-12-16T12:00:00-05:00', return_due_at: '2026-12-19T12:00:00-05:00' });
  assert.throws(() => fixture({ seed: b }), e => e.code === 'invalid_seed' && /more than 168 hours ahead/.test(e.message));
});

test('T08c action instants are stored in the seed zone', () => {
  const f = fixture({ seed: baseSeed(), now: '2026-11-30T14:10:00.123Z' });
  ev(f, 'fill.hold_placed', { fill_id: 'f-1', note: 'x' });
  assert.equal(stored(f, 'f-1').hold.placed_at, '2026-11-30T09:10:00.123-05:00');
  const r = f.call(P + 'fills.request', { rx_id: 'rx-5', store_id: 'st-1', quantity: 30 });
  assert.equal(r.status, 'duplicate_request');
});

test('T08c pickup-only grantees get no claim_rejected; a UTC write stores seed-zone instants; unchanged requested quantity refused; due release steps twice', () => {
  const s = baseSeed();
  s.grants.push({ grant_id: 'g-6', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-3', scope: 'pickup', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-01T09:00:00-05:00', revoked_at: null });
  s.issued.g = 6;
  const f = fixture({ seed: s, now: '2026-11-30T14:10:00.123Z' });
  const out = f.call(P + 'fills.request', { rx_id: 'rx-6', store_id: 'st-1', quantity: 30 });
  assert.equal(stored(f, out.fill.fill_id).requested_at, '2026-11-30T09:10:00.123-05:00');
  assert.equal(f.call(P + 'fills.change_quantity', { fill_id: out.fill.fill_id, quantity: 30 }).status, 'invalid_state');
  f.setNow('2026-11-30T12:00:00-05:00');
  const from = f.data().notices.length;
  poke(f);
  const rejected = f.data().notices.slice(from).filter(x => x.kind === 'notice.claim_rejected' && x.subject.id === out.fill.fill_id);
  assert.deepEqual(rejected.map(x => x.recipient_id), ['p-2', 'p-4']);
  const h = baseSeed();
  h.fills.find(x => x.fill_id === 'f-3').resubmission_due_at = '2026-12-05T00:00:00-05:00';
  const g = fixture({ seed: h });
  ev(g, 'fill.hold_placed', { fill_id: 'f-3', note: 'x' });
  g.setNow('2026-12-06T09:00:00-05:00');
  const v = stored(g, 'f-3').fill_version;
  ev(g, 'fill.hold_released', { fill_id: 'f-3', note: 'y' });
  assert.equal(stored(g, 'f-3').fill_version, v + 2);
});

test('T08c the return bound, an Rx received before it was written, and the clock range at load', () => {
  const r = baseSeed();
  Object.assign(r.fills.find(x => x.fill_id === 'f-5'), { warning_due_at: null, warned_at: '2026-11-29T12:00:00-05:00', ready_at: '2026-11-22T12:00:00-05:00', return_due_at: '2026-12-11T12:00:00-05:00' });
  r.fills.find(x => x.fill_id === 'f-5').timeline = [{ state: 'requested', at: '2026-11-22T10:00:00-05:00' }, { state: 'ready', at: '2026-11-22T12:00:00-05:00' }];
  r.fills.find(x => x.fill_id === 'f-5').requested_at = '2026-11-22T10:00:00-05:00';
  r.claims.find(c => c.claim_id === 'cl-4').at = '2026-11-22T12:00:00-05:00';
  assert.throws(() => fixture({ seed: r }), e => e.code === 'invalid_seed' && /return is due more than 240 hours ahead/.test(e.message));
  const w = baseSeed();
  w.prescriptions[0].received_at = '2026-05-31T09:00:00-04:00';
  assert.throws(() => fixture({ seed: w }), e => e.code === 'invalid_seed' && /received before it was written/.test(e.message));
  const out = fixture({ seed: baseSeed(), now: '2200-01-02T09:00:00-05:00' });
  assert.equal(out.call(P + 'fills.list', {}).status, 'invalid_state');
});
