'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, withCollected } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e7-' + (++n), at: f.ctx.virtual_now, operation, payload });
const hold = (f, id, note = 'Interaction flag: confirm with the prescriber') => ev(f, 'fill.hold_placed', { fill_id: id, note });
const release = (f, id, note = 'Prescriber confirmed the dose') => ev(f, 'fill.hold_released', { fill_id: id, note });
const get = (f, id) => f.call(P + 'fills.get', { fill_id: id }).fill;
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const since = (f, from) => f.data().notices.slice(from).map(x => x.kind + ':' + x.recipient_id);
const base = (collected = false) => { const s = structuredClone(minimal); if (collected) withCollected(s, 'rx-1', '2026-11-10T15:00:00-05:00'); return s; };

test('T14 a hold during review pauses it; release resumes it with the remaining time; notices held then released', () => {
  const f = fixture({ seed: base() });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T10:00:00-05:00');
  const from = f.data().notices.length;
  hold(f, id);
  assert.deepEqual([stored(f, id).review_due_at, stored(f, id).hold.remaining], [null, { review_ms: 3600000 }]);
  assert.equal(get(f, id).hold.note, 'Interaction flag: confirm with the prescriber');
  f.setNow('2026-11-30T15:00:00-05:00');
  assert.equal(get(f, id).state, 'requested');
  release(f, id);
  assert.equal(stored(f, id).review_due_at, '2026-11-30T16:00:00-05:00');
  assert.deepEqual(since(f, from), ['notice.held:p-2', 'notice.held:p-4', 'notice.released:p-2', 'notice.released:p-4']);
  f.setNow('2026-11-30T16:00:00-05:00');
  assert.equal(get(f, id).state, 'ready');
  assert.deepEqual(stored(f, id).notes.map(x => x.text), ['Interaction flag: confirm with the prescriber', 'Prescriber confirmed the dose']);
});

test('T14 a ready fill: warning and return pause with their remainders and resume; a hold after the warning keeps only the return', () => {
  const s = baseSeed();
  const f = fixture({ seed: s, now: '2026-12-01T12:00:00-05:00' });
  hold(f, 'f-5');
  assert.deepEqual(stored(f, 'f-5').hold.remaining, { warning_ms: 5 * 86400000, return_ms: 8 * 86400000 });
  f.setNow('2026-12-20T12:00:00-05:00');
  assert.equal(get(f, 'f-5').state, 'ready');
  release(f, 'f-5');
  assert.deepEqual([stored(f, 'f-5').warning_due_at, stored(f, 'f-5').return_due_at], ['2026-12-25T12:00:00-05:00', '2026-12-28T12:00:00-05:00']);
  const g = fixture({ seed: baseSeed(), now: '2026-12-07T12:00:00-05:00' });
  hold(g, 'f-5');
  assert.deepEqual(stored(g, 'f-5').hold.remaining, { return_ms: 2 * 86400000 });
  assert.equal(stored(g, 'f-5').warned_at, '2026-12-06T12:00:00-05:00');
});

test('T14 a decision stored during the hold applies at release only if still pending; later decisions are ignored', () => {
  const s = baseSeed();
  const f = fixture({ seed: s });
  hold(f, 'f-4');
  ev(f, 'plan.decided', { plan_request_id: 'pr-1', decision: 'approved' });
  ev(f, 'plan.decided', { plan_request_id: 'pr-1', decision: 'denied' });
  assert.deepEqual([stored(f, 'f-4').state, stored(f, 'f-4').hold.stored_decision.decision], ['pending_plan_decision', 'approved']);
  const from = f.data().notices.length;
  release(f, 'f-4');
  const fill = get(f, 'f-4');
  assert.deepEqual([fill.plan_request.state, fill.claim.waived, fill.claim.attempt], ['approved', ['refill_too_soon'], 2]);
  assert.deepEqual(since(f, from).map(k => k.split(':')[0]), ['notice.released', 'notice.released', 'notice.plan_decision', 'notice.plan_decision', 'notice.fill_ready', 'notice.fill_ready']);
});

test('T10 a request withdrawn then decided → ignored; a decision during a hold, a withdrawal, then release → no effect', () => {
  const one = fixture({ seed: baseSeed() });
  one.call(P + 'plan_requests.withdraw', { plan_request_id: 'pr-1' });
  assert.equal(one.call(P + 'plan_requests.withdraw', { plan_request_id: 'pr-1' }).status, 'request_not_pending');
  assert.equal(ev(one, 'plan.decided', { plan_request_id: 'pr-1', decision: 'approved' }).status, 'committed');
  assert.deepEqual([get(one, 'f-4').state, get(one, 'f-4').claim.attempt, get(one, 'f-4').plan_request.state], ['claim_rejected', 1, 'withdrawn']);
  const two = fixture({ seed: baseSeed() });
  hold(two, 'f-4');
  ev(two, 'plan.decided', { plan_request_id: 'pr-1', decision: 'approved' });
  two.call(P + 'plan_requests.withdraw', { plan_request_id: 'pr-1' });
  assert.equal(stored(two, 'f-4').hold.stored_decision, null);
  release(two, 'f-4');
  assert.deepEqual([get(two, 'f-4').state, get(two, 'f-4').claim.attempt, get(two, 'f-4').claim.waived], ['claim_rejected', 1, []]);
});

test('T14 a resubmission due during the hold runs once at release if the fill still qualifies; a not-yet-due one stays scheduled', () => {
  const s = baseSeed();
  s.fills.find(x => x.fill_id === 'f-3').resubmission_due_at = '2026-12-05T00:00:00-05:00';
  const f = fixture({ seed: s });
  hold(f, 'f-3');
  f.setNow('2026-12-04T09:00:00-05:00');
  release(f, 'f-3');
  assert.equal(stored(f, 'f-3').resubmission_due_at, '2026-12-05T00:00:00-05:00');
  assert.equal(f.data().claims.filter(c => c.fill_id === 'f-3').length, 1);
  const g = fixture({ seed: structuredClone(s) });
  hold(g, 'f-3');
  g.setNow('2026-12-06T09:00:00-05:00');
  assert.equal(get(g, 'f-3').claim.attempt, 1);
  release(g, 'f-3');
  assert.deepEqual([stored(g, 'f-3').resubmission_due_at, g.data().claims.filter(c => c.fill_id === 'f-3').length, stored(g, 'f-3').state], [null, 2, 'claim_rejected']);
});

test('T14 fills.wait on a held fill schedules as usual and an already-due resubmission waits for release', () => {
  const s = base(true);
  const f = fixture({ seed: s });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-12-06T09:00:00-05:00');
  assert.equal(get(f, id).claim.reason, 'refill_too_soon');
  hold(f, id);
  const w = f.call(P + 'fills.wait', { fill_id: id });
  assert.deepEqual([w.fill.state, w.fill.resubmission_due_at], ['claim_rejected', '2026-12-06T09:00:00-05:00']);
  f.setNow('2026-12-06T10:00:00-05:00');
  release(f, id);
  assert.equal(get(f, id).state, 'ready');
});

test('T14 while held: quantity, store and cash preview → on_hold (on_hold before request_pending); a pre-hold cash token is stale while held and after release', () => {
  const s = baseSeed();
  const f = fixture({ seed: s });
  const p = f.call(P + 'fills.choose_cash.preview', { fill_id: 'f-3' });
  hold(f, 'f-3'); hold(f, 'f-4');
  assert.equal(f.call(P + 'fills.change_quantity', { fill_id: 'f-3', quantity: 30 }).status, 'on_hold');
  assert.equal(f.call(P + 'fills.change_quantity', { fill_id: 'f-4', quantity: 30 }).status, 'on_hold');
  assert.equal(f.call(P + 'fills.change_store', { fill_id: 'f-3', store_id: 'st-2' }).status, 'on_hold');
  assert.equal(f.call(P + 'fills.choose_cash.preview', { fill_id: 'f-3' }).status, 'on_hold');
  assert.equal(f.call(P + 'fills.choose_cash.confirm', { fill_id: 'f-3', token: p.preview.token }).status, 'stale_preview');
  release(f, 'f-3');
  assert.equal(f.call(P + 'fills.choose_cash.confirm', { fill_id: 'f-3', token: p.preview.token }).status, 'stale_preview');
  assert.ok(f.call(P + 'fills.choose_cash.preview', { fill_id: 'f-3' }).preview.token !== p.preview.token);
  assert.equal(f.call(P + 'plan_requests.create', { fill_id: 'f-3' }).plan_request.state, 'pending');
});

test('T14 committed no-ops: hold on a held or finished fill, release of an unheld fill; unknown fill → invalid_event; held Rx expiry still cancels', () => {
  const s = baseSeed();
  const f = fixture({ seed: s });
  hold(f, 'f-1');
  const v = stored(f, 'f-1').fill_version, notes = f.data().notices.length;
  assert.equal(hold(f, 'f-1', 'Second flag').status, 'committed');
  assert.equal(hold(f, 'f-6').status, 'committed');
  assert.equal(release(f, 'f-2').status, 'committed');
  assert.deepEqual([stored(f, 'f-1').fill_version, stored(f, 'f-1').hold.note, f.data().notices.length, stored(f, 'f-6').hold], [v, 'Interaction flag: confirm with the prescriber', notes, null]);
  assert.equal(hold(f, 'f-99').status, 'invalid_event');
  release(f, 'f-1'); hold(f, 'f-1', 'Third flag');
  assert.equal(stored(f, 'f-1').hold.note, 'Third flag');
  const e = baseSeed();
  e.prescriptions.find(r => r.rx_id === 'rx-1').written_on = '2025-12-01';
  e.prescriptions.find(r => r.rx_id === 'rx-1').received_at = '2025-12-01T09:00:00-05:00';
  const g = fixture({ seed: e });
  hold(g, 'f-1');
  g.setNow('2026-12-02T09:00:00-05:00');
  assert.deepEqual([get(g, 'f-1').state, get(g, 'f-1').cancellation.reason, get(g, 'f-1').cancellation.at], ['cancelled', 'rx_expired', '2026-12-01T23:59:00-05:00']);
});

test('T11 restock: availability is always set; waiting fills there become ready; a held waiting fill is rechecked at release; cash-funded keeps its rejected claim', () => {
  const s = baseSeed();
  const f = fixture({ seed: s });
  const from = f.data().notices.length;
  ev(f, 'store.restocked', { store_id: 'st-1', drug_id: 'd-amoxicillin-250-5' });
  assert.equal(f.data().notices.length, from);
  hold(f, 'f-2');
  ev(f, 'store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' });
  assert.deepEqual([stored(f, 'f-2').state, f.data().stores.find(x => x.store_id === 'st-2').stock['d-atorvastatin-40']], ['waiting_stock', true]);
  const at = f.data().notices.length;
  release(f, 'f-2');
  assert.deepEqual([get(f, 'f-2').state, get(f, 'f-2').amount_due_cents], ['ready', 1200]);
  assert.deepEqual(since(f, at).map(k => k.split(':')[0]), ['notice.released', 'notice.released', 'notice.fill_ready', 'notice.fill_ready']);
  const c = baseSeed();
  const cash = c.fills.find(x => x.fill_id === 'f-3');
  Object.assign(cash, { state: 'waiting_stock', store_id: 'st-2', cash: { price_cents: 2400 } });
  cash.timeline.push({ state: 'waiting_stock', at: '2026-11-28T13:00:00-05:00' });
  const g = fixture({ seed: c });
  const b = g.data().notices.length;
  ev(g, 'store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' });
  assert.deepEqual([get(g, 'f-3').state, get(g, 'f-3').amount_due_cents, get(g, 'f-3').claim.result, get(g, 'f-2').state], ['ready', 2400, 'rejected', 'ready']);
  assert.deepEqual(since(g, b).map(k => k.split(':')[0]), ['notice.fill_ready', 'notice.fill_ready', 'notice.fill_ready', 'notice.fill_ready']);
  assert.equal(ev(g, 'store.restocked', { store_id: 'st-9', drug_id: 'd-atorvastatin-40' }).status, 'invalid_event');
  assert.equal(ev(g, 'store.restocked', { store_id: 'st-1', drug_id: 'd-none' }).status, 'invalid_event');
});
