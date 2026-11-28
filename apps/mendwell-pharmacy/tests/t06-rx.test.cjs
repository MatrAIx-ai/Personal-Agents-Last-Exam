'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e6-' + (++n), at: f.ctx.virtual_now, operation, payload });
const received = extra => ({ rx_id: 'rx-9', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-11-30', ...extra });
const seed = fn => { const s = structuredClone(minimal); if (fn) fn(s); return s; };
const rxOf = (f, id) => f.call(P + 'rx.get', { rx_id: id }).prescription;

test('T06 rx.received: a new prescription with its fills, valid until 23:59 on the written date + 365; bad events rejected', () => {
  const f = fixture({ seed: seed() });
  assert.equal(ev(f, 'rx.received', received()).status, 'committed');
  const rx = rxOf(f, 'rx-9');
  assert.deepEqual([rx.fills_remaining, rx.fills_authorized, rx.expires_at, rx.state, rx.prescriber.prescriber_id], [3, 3, '2027-11-30T23:59:00-05:00', 'active', 'dr-2']);
  assert.equal(ev(f, 'rx.received', received()).status, 'invalid_event');
  for (const bad of [{ rx_id: 'rx-10', patient_id: 'p-9' }, { rx_id: 'rx-11', prescriber_id: 'dr-9' }, { rx_id: 'rx-12', drug_id: 'd-none' }, { rx_id: 'rx-13', written_on: '2026-02-31' }]) assert.equal(ev(f, 'rx.received', received(bad)).status, 'invalid_event', JSON.stringify(bad));
  assert.equal(f.data().prescriptions.length, 2);
});

test('T03 no fills → no_fills_remaining; expired → rx_expired; renewal approved → new Rx, old one rx_superseded, new fill works', () => {
  const f = fixture({ seed: seed(s => { s.prescriptions[0].fills_remaining = 0; }) });
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'no_fills_remaining');
  const rn = f.call(P + 'renewals.create', { rx_id: 'rx-1', note: 'Please renew' }).renewal;
  assert.deepEqual(rn, { renewal_id: 'rn-1', rx_id: 'rx-1', state: 'pending', new_rx_id: null });
  assert.deepEqual(rxOf(f, 'rx-1').renewals, [{ renewal_id: 'rn-1', state: 'pending' }]);
  const from = f.data().notices.length;
  ev(f, 'renewal.replied', { renewal_id: 'rn-1', decision: 'approved', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } });
  const old = rxOf(f, 'rx-1'), next = rxOf(f, 'rx-10');
  assert.deepEqual([old.state, old.superseded_by], ['superseded', 'rx-10']);
  assert.deepEqual([next.patient_id, next.prescriber.prescriber_id, next.drug.drug_id, next.fills_remaining], ['p-4', 'dr-2', 'd-atorvastatin-40', 5]);
  assert.deepEqual(f.data().notices.slice(from).map(x => [x.kind, x.recipient_id, x.subject.type, x.subject.id]), [['notice.renewal_reply', 'p-2', 'renewal', 'rn-1'], ['notice.renewal_reply', 'p-4', 'renewal', 'rn-1']]);
  assert.match(f.data().notices[from].body, /approved renewal rn-1 of prescription rx-1 .*the new prescription rx-10 replaces it\.$/);
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'rx_superseded');
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-10', store_id: 'st-1', quantity: 30 }).fill.state, 'requested');
  assert.equal(f.call(P + 'renewals.create', { rx_id: 'rx-1' }).status, 'invalid_state');
  const exp = fixture({ seed: seed(s => { Object.assign(s.prescriptions[0], { written_on: '2025-11-29', received_at: '2025-11-29T09:00:00-05:00' }); }) });
  assert.equal(exp.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'rx_expired');
  assert.equal(rxOf(exp, 'rx-1').state, 'expired');
  assert.equal(exp.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal.state, 'pending');
});

test('T04 renewal eligibility, denial, duplicates, withdrawal and late replies', () => {
  const f = fixture({ seed: seed() });
  assert.equal(f.call(P + 'renewals.create', { rx_id: 'rx-1' }).status, 'invalid_state');
  const g = fixture({ seed: seed(s => { s.prescriptions[0].fills_remaining = 0; }) });
  const rn = g.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal;
  assert.equal(g.call(P + 'renewals.create', { rx_id: 'rx-1' }).status, 'duplicate_request');
  const from = g.data().notices.length;
  ev(g, 'renewal.replied', { renewal_id: rn.renewal_id, decision: 'denied' });
  assert.deepEqual(rxOf(g, 'rx-1').renewals, [{ renewal_id: 'rn-1', state: 'denied' }]);
  assert.equal(rxOf(g, 'rx-1').state, 'active');
  assert.deepEqual(g.data().notices.slice(from).map(x => x.kind), ['notice.renewal_reply', 'notice.renewal_reply']);
  const second = g.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal;
  assert.equal(second.renewal_id, 'rn-2');
  assert.equal(g.call(P + 'renewals.withdraw', { renewal_id: 'rn-2' }).renewal.state, 'withdrawn');
  assert.equal(g.call(P + 'renewals.withdraw', { renewal_id: 'rn-2' }).status, 'request_not_pending');
  const late = ev(g, 'renewal.replied', { renewal_id: 'rn-2', decision: 'approved', rx: { rx_id: 'rx-20', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } });
  assert.equal(late.status, 'committed');
  assert.equal(g.data().prescriptions.some(r => r.rx_id === 'rx-20'), false);
  assert.equal(ev(g, 'renewal.replied', { renewal_id: 'rn-99', decision: 'denied' }).status, 'invalid_event');
  const h = fixture({ seed: seed(s => { s.prescriptions[0].fills_remaining = 0; }) });
  h.call(P + 'renewals.create', { rx_id: 'rx-1' });
  assert.equal(ev(h, 'renewal.replied', { renewal_id: 'rn-1', decision: 'approved', rx: { rx_id: 'rx-1', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } }).status, 'invalid_event');
  assert.equal(h.data().renewals[0].state, 'pending');
  assert.equal(ev(h, 'renewal.replied', { renewal_id: 'rn-1', decision: 'approved', rx: { rx_id: 'rx-21', quantity: 30, fills_authorized: 5, written_on: '2026-02-30' } }).status, 'invalid_event');
});

function supersedable() {
  const s = baseSeed();
  for (const r of s.prescriptions) if (['rx-1', 'rx-2', 'rx-3', 'rx-4'].includes(r.rx_id)) s.renewals.push({ renewal_id: 'rn-' + r.rx_id.slice(3), rx_id: r.rx_id, state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null });
  s.issued.rn = 4;
  const f3 = s.fills.find(f => f.fill_id === 'f-3');
  f3.resubmission_due_at = '2026-12-05T00:00:00-05:00';
  return s;
}
const approve = (f, id, newId) => ev(f, 'renewal.replied', { renewal_id: id, decision: 'approved', rx: { rx_id: newId, quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } });

test('T06 supersession cancels unmade fills: requested, rejected with a scheduled resubmission, pending a decision, paid waiting for stock', () => {
  const f = fixture({ seed: supersedable() });
  for (const [rn, rx] of [['rn-1', 'rx-31'], ['rn-2', 'rx-32'], ['rn-3', 'rx-33'], ['rn-4', 'rx-34']]) assert.equal(approve(f, rn, rx).status, 'committed');
  const d = f.data(), F = id => d.fills.find(x => x.fill_id === id), C = id => d.claims.find(c => c.claim_id === id);
  for (const id of ['f-1', 'f-2', 'f-3', 'f-4']) {
    assert.equal(F(id).state, 'cancelled', id);
    assert.equal(F(id).cancellation.reason, 'rx_superseded', id);
    assert.deepEqual([F(id).review_due_at, F(id).resubmission_due_at, F(id).hold], [null, null, null]);
  }
  assert.deepEqual([F('f-1').cancellation.stage, F('f-2').cancellation.stage, F('f-3').cancellation.stage, F('f-4').cancellation.stage], ['requested', 'waiting_stock', 'claim_rejected', 'pending_plan_decision']);
  assert.equal(C('cl-1').reversed_at, '2026-11-30T09:00:00-05:00');
  assert.equal(C('cl-2').reversed_at, null);
  assert.equal(d.plan_requests[0].state, 'withdrawn');
  assert.equal(ev(f, 'plan.decided', { plan_request_id: 'pr-1', decision: 'approved' }).status, 'committed');
  assert.equal(f.data().fills.find(x => x.fill_id === 'f-4').state, 'cancelled');
  assert.equal(f.data().prescriptions.find(r => r.rx_id === 'rx-2').fills_remaining, 5);
  assert.deepEqual(f.data().notices.filter(x => x.subject.type === 'fill').map(x => x.kind), []);
});

test('T06 expiry cancels unmade fills at 23:59 local, a paid waiting claim reversed once, a cash-funded one not; made fills stay', () => {
  const s = baseSeed();
  for (const r of s.prescriptions) Object.assign(r, { written_on: '2025-12-01', received_at: '2025-12-01T09:00:00-05:00' });
  const cash = s.fills.find(f => f.fill_id === 'f-3');
  Object.assign(cash, { state: 'waiting_stock', store_id: 'st-2', cash: { price_cents: 2400 } });
  cash.timeline.push({ state: 'waiting_stock', at: '2026-11-28T13:00:00-05:00' });
  const f = fixture({ seed: s });
  f.setNow('2026-12-01T23:58:59-05:00');
  assert.equal(f.call(P + 'fills.get', { fill_id: 'f-2' }).fill.state, 'waiting_stock');
  f.setNow('2026-12-01T23:59:00-05:00');
  ev(f, 'store.restocked', { store_id: 'st-1', drug_id: 'd-amoxicillin-250-5' });
  const d = f.data(), F = id => d.fills.find(x => x.fill_id === id);
  assert.deepEqual(['f-1', 'f-2', 'f-3', 'f-4'].map(id => [F(id).state, F(id).cancellation && F(id).cancellation.reason, F(id).closed_at]), [['cancelled', 'rx_expired', '2026-12-01T23:59:00-05:00'], ['cancelled', 'rx_expired', '2026-12-01T23:59:00-05:00'], ['cancelled', 'rx_expired', '2026-12-01T23:59:00-05:00'], ['cancelled', 'rx_expired', '2026-12-01T23:59:00-05:00']]);
  assert.equal(d.claims.find(c => c.claim_id === 'cl-1').reversed_at, '2026-12-01T23:59:00-05:00');
  assert.equal(d.claims.find(c => c.claim_id === 'cl-2').reversed_at, null);
  assert.equal(F('f-5').state, 'ready');
  assert.equal(f.call(P + 'rx.get', { rx_id: 'rx-5' }).prescription.state, 'expired');
});
