'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e12-' + (++n), at: f.ctx.virtual_now, operation, payload });
const ok = (f, token, by = 'p-2') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const preview = (f, id) => f.call(P + 'fills.cancel.preview', { fill_id: id });
const confirm = (f, id, token) => f.call(P + 'fills.cancel.confirm', { fill_id: id, token });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const expiry = (f, rxId) => f.call(P + 'rx.get', { rx_id: rxId }).prescription.expires_at;
const remaining = f => JSON.stringify(f.data().prescriptions.map(r => [r.rx_id, r.fills_remaining]));
const NOW = '2026-11-30T09:00:00-05:00';
const hold = (f, id) => ev(f, 'fill.hold_placed', { fill_id: id, note: 'Interaction flag: confirm with the prescriber' });

function cancelled(f, id, stage) {
  const s = stored(f, id);
  assert.deepEqual([s.state, s.cancellation, s.closed_at, s.review_due_at, s.resubmission_due_at, s.warning_due_at, s.return_due_at, s.hold], ['cancelled', { reason: 'agent', stage, at: f.ctx.virtual_now }, f.ctx.virtual_now, null, null, null, null, null]);
}

test('T12 cancel from each non-terminal state lists exactly what exists, commits it, records the stage and leaves fills remaining unchanged', () => {
  const f = fixture({ seed: baseSeed() });
  assert.equal(f.call(P + 'fills.wait', { fill_id: 'f-3' }).status, 'committed');
  const rx = id => stored(f, id).rx_id;
  const expected = {
    'f-1': ['requested', { claim_reversal: null, authorization_void: null, plan_request_withdrawal: null, cancelled_timers: [{ kind: 'expiry', due_at: expiry(f, rx('f-1')) }, { kind: 'review', due_at: '2026-11-30T10:30:00-05:00' }] }],
    'f-2': ['waiting_stock', { claim_reversal: { claim_id: 'cl-1' }, authorization_void: null, plan_request_withdrawal: null, cancelled_timers: [{ kind: 'expiry', due_at: expiry(f, rx('f-2')) }] }],
    'f-3': ['claim_rejected', { claim_reversal: null, authorization_void: null, plan_request_withdrawal: null, cancelled_timers: [{ kind: 'expiry', due_at: expiry(f, rx('f-3')) }, { kind: 'resubmission', due_at: '2026-12-05T00:00:00-05:00' }] }],
    'f-4': ['pending_plan_decision', { claim_reversal: null, authorization_void: null, plan_request_withdrawal: { plan_request_id: 'pr-1' }, cancelled_timers: [{ kind: 'expiry', due_at: expiry(f, rx('f-4')) }] }],
    'f-5': ['ready', { claim_reversal: { claim_id: 'cl-4' }, authorization_void: null, plan_request_withdrawal: null, cancelled_timers: [{ kind: 'warning', due_at: '2026-12-06T12:00:00-05:00' }, { kind: 'return', due_at: '2026-12-09T12:00:00-05:00' }] }],
  };
  const fills = remaining(f), from = f.data().notices.length;
  for (const [id, [stage, changes]] of Object.entries(expected)) {
    const pv = preview(f, id).preview;
    assert.match(pv.token, new RegExp('^tok-cancel-fill-' + id + '-[0-9a-f]{32}$'));
    assert.deepEqual(pv.changes, changes, id);
    assert.equal(confirm(f, id, pv.token).fill.state, 'cancelled');
    cancelled(f, id, stage);
  }
  const d = f.data();
  assert.deepEqual(d.claims.filter(c => ['cl-1', 'cl-4'].includes(c.claim_id)).map(c => c.reversed_at), [NOW, NOW]);
  assert.deepEqual(d.claims.find(c => c.claim_id === 'cl-2').reversed_at, null);
  assert.deepEqual([d.plan_requests[0].state, d.plan_requests[0].closed_at], ['withdrawn', NOW]);
  assert.deepEqual([remaining(f), f.data().notices.slice(from).filter(x => x.at === NOW)], [fills, []]);
});

test('T12 a prepaid fill: the live authorization is voided with notice.payment_voided; a held fill lists its remainders', () => {
  const f = fixture({ seed: baseSeed() });
  const pp = f.call(P + 'fills.prepay.preview', { fill_id: 'f-5', card_id: 'card-3' }).preview;
  ok(f, pp.token);
  f.call(P + 'fills.prepay.confirm', { fill_id: 'f-5', card_id: 'card-3', token: pp.token });
  const pv = preview(f, 'f-5').preview;
  assert.deepEqual(pv.changes.authorization_void, { authorization_id: 'au-1', amount_cents: 1200 });
  const from = f.data().notices.length;
  confirm(f, 'f-5', pv.token);
  assert.deepEqual([f.data().authorizations[0].state, f.data().authorizations[0].ended_at], ['voided', NOW]);
  assert.deepEqual(f.data().notices.slice(from).map(x => [x.kind, x.recipient_id, x.audience]), [['notice.payment_voided', 'p-4', 'full'], ['notice.payment_voided', 'p-2', 'card_owner']]);
  const g = fixture({ seed: baseSeed(), now: '2026-11-30T09:30:00-05:00' });
  hold(g, 'f-1');
  hold(g, 'f-5');
  assert.deepEqual(preview(g, 'f-1').preview.changes.cancelled_timers, [{ kind: 'expiry', due_at: expiry(g, 'rx-1') }, { kind: 'review', remaining_ms: 3600000 }]);
  assert.deepEqual(preview(g, 'f-5').preview.changes.cancelled_timers, [{ kind: 'warning', remaining_ms: 6 * 86400000 + 2.5 * 3600000 }, { kind: 'return', remaining_ms: 9 * 86400000 + 2.5 * 3600000 }]);
  const pv1 = preview(g, 'f-1').preview;
  confirm(g, 'f-1', pv1.token);
  cancelled(g, 'f-1', 'requested');
});

test('T12 T08 a cash-funded fill keeps its rejected claim and nothing is reversed; a not_covered fill cancels', () => {
  const f = fixture({ seed: baseSeed() });
  const cash = f.call(P + 'fills.choose_cash.preview', { fill_id: 'f-3' }).preview;
  assert.equal(f.call(P + 'fills.choose_cash.confirm', { fill_id: 'f-3', token: cash.token }).fill.state, 'ready');
  const pv = preview(f, 'f-3').preview;
  assert.equal(pv.changes.claim_reversal, null);
  confirm(f, 'f-3', pv.token);
  const claim = f.data().claims.find(c => c.claim_id === 'cl-2');
  assert.deepEqual([stored(f, 'f-3').state, claim.result, claim.reversed_at], ['cancelled', 'rejected', null]);
  const s = structuredClone(minimal);
  s.plans.find(x => x.plan_id === 'plan-b').rules['d-atorvastatin-40'].covered = false;
  const g = fixture({ seed: s });
  const id = g.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  g.setNow('2026-11-30T11:00:00-05:00');
  const t = preview(g, id).preview;
  assert.equal(confirm(g, id, t.token).fill.cancellation.stage, 'claim_rejected');
  assert.equal(g.data().claims[0].reason, 'not_covered');
});

test('T22 terminal fills stay readable; a new cancel preview → invalid_state; a pre-terminal token → stale_preview; writes without a confirmation → invalid_state', () => {
  const f = fixture({ seed: baseSeed() });
  const pv = preview(f, 'f-1').preview;
  confirm(f, 'f-1', pv.token);
  assert.equal(confirm(f, 'f-1', pv.token).status, 'stale_preview');
  for (const id of ['f-1', 'f-6', 'f-7', 'f-8']) {
    assert.equal(f.call(P + 'fills.get', { fill_id: id }).status, 'ok', id);
    assert.equal(preview(f, id).status, 'invalid_state', id);
  }
  assert.deepEqual([f.call(P + 'fills.wait', { fill_id: 'f-1' }).status, f.call(P + 'fills.change_store', { fill_id: 'f-1', store_id: 'st-2' }).status, f.call(P + 'fills.set_collector', { fill_id: 'f-1', collector_id: 'p-4' }).status], ['invalid_state', 'invalid_state', 'invalid_state']);
  const before = f.data().fills.find(x => x.fill_id === 'f-5');
  const t5 = preview(f, 'f-5').preview.token;
  ev(f, 'fill.collection_attempted', { fill_id: 'f-5', collector_id: 'p-4' });
  assert.equal(stored(f, 'f-5').state, 'ready');
  assert.equal(stored(f, 'f-5').fill_version, before.fill_version);
  assert.equal(confirm(f, 'f-5', t5).fill.state, 'cancelled');
});

function held(at) {
  const f = fixture();
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow(at);
  hold(f, id);
  return { f, id, pv: preview(f, id).preview };
}

test('T12 the same fill, ID and version held after different elapsed review times gives different tokens; a recreated fill with another review deadline → stale_preview', () => {
  const a = held('2026-11-30T09:30:00-05:00'), b = held('2026-11-30T10:00:00-05:00');
  assert.deepEqual([a.id, stored(a.f, a.id).fill_version], [b.id, stored(b.f, b.id).fill_version]);
  assert.notEqual(a.pv.token, b.pv.token);
  assert.deepEqual([a.pv.changes.cancelled_timers[1], b.pv.changes.cancelled_timers[1]], [{ kind: 'review', remaining_ms: 5400000 }, { kind: 'review', remaining_ms: 3600000 }]);
  const first = fixture();
  const id = first.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  const old = preview(first, id).preview.token;
  const again = fixture({ now: '2026-11-30T09:30:00-05:00' });
  assert.equal(again.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id, id);
  assert.equal(stored(again, id).fill_version, stored(first, id).fill_version);
  assert.equal(confirm(again, id, old).status, 'stale_preview');
  assert.equal(stored(again, id).state, 'requested');
});

test('T22 a held prior_auth_required cancel token, then a reset and a plan request back to the same version → stale_preview, the plan request stays pending', () => {
  const s = structuredClone(minimal);
  s.plans.find(x => x.plan_id === 'plan-b').rules['d-atorvastatin-40'].prior_auth_required = true;
  const f = fixture({ seed: s });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T11:30:00-05:00');
  hold(f, id);
  const token = preview(f, id).preview.token, version = stored(f, id).fill_version;
  const g = fixture({ seed: s });
  g.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 });
  g.setNow('2026-11-30T11:30:00-05:00');
  const pr = g.call(P + 'plan_requests.create', { fill_id: id }).plan_request;
  assert.equal(stored(g, id).fill_version, version);
  assert.equal(confirm(g, id, token).status, 'stale_preview');
  assert.equal(g.data().plan_requests.find(x => x.plan_request_id === pr.plan_request_id).state, 'pending');
});

test('T12 a cancel preview, then the named collector\'s grant expires, then the confirm commits', () => {
  const f = fixture();
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  ev(f, 'grant.changed', { grant_id: 'g-5', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: '2026-12-01T12:00:00-05:00', status: 'active' });
  f.setNow('2026-11-30T11:30:00-05:00');
  f.call(P + 'fills.set_collector', { fill_id: id, collector_id: 'p-1' });
  const pv = preview(f, id).preview;
  f.setNow('2026-12-01T12:30:00-05:00');
  assert.equal(f.call(P + 'fills.get', { fill_id: id }).fill.collector_id, null);
  assert.equal(confirm(f, id, pv.token).fill.state, 'cancelled');
});
