'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, withCollected, requested } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e8-' + (++n), at: f.ctx.virtual_now, operation, payload });
const poke = f => ev(f, 'store.restocked', { store_id: 'st-1', drug_id: 'd-amoxicillin-250-5' });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const since = (f, from) => f.data().notices.slice(from);

function prepaid() {
  const s = baseSeed();
  s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null });
  s.fills.find(f => f.fill_id === 'f-5').authorization_id = 'au-1';
  s.issued.au = 1;
  return s;
}

test('T13 warning at 168 h and return at 240 h of unheld time, each committed by the next write and dated at its due time', () => {
  const f = fixture({ seed: prepaid() });
  f.setNow('2026-12-06T11:59:59-05:00');
  poke(f);
  assert.equal(stored(f, 'f-5').warned_at, null);
  f.setNow('2026-12-08T09:00:00-05:00');
  const before = f.data();
  assert.equal(f.call(P + 'fills.get', { fill_id: 'f-5' }).fill.warning_at, '2026-12-06T12:00:00-05:00');
  assert.deepEqual(f.data(), before);
  const from = f.data().notices.length;
  poke(f);
  assert.deepEqual([stored(f, 'f-5').warned_at, stored(f, 'f-5').warning_due_at, stored(f, 'f-5').state], ['2026-12-06T12:00:00-05:00', null, 'ready']);
  assert.deepEqual(since(f, from).filter(x => x.subject.id === 'f-5').map(x => [x.kind, x.recipient_id, x.at]), [['notice.return_warning', 'p-2', '2026-12-06T12:00:00-05:00'], ['notice.return_warning', 'p-4', '2026-12-06T12:00:00-05:00']]);
  f.setNow('2026-12-10T09:00:00-05:00');
  const r = f.data().notices.length;
  poke(f);
  const d = f.data(), fill = stored(f, 'f-5');
  assert.deepEqual([fill.state, fill.closed_at, d.claims.find(c => c.claim_id === 'cl-4').reversed_at, d.authorizations[0].state, d.authorizations[0].ended_at], ['returned_to_stock', '2026-12-09T12:00:00-05:00', '2026-12-09T12:00:00-05:00', 'voided', '2026-12-09T12:00:00-05:00']);
  assert.equal(d.prescriptions.find(x => x.rx_id === 'rx-5').fills_remaining, 5);
  assert.deepEqual(since(f, r).filter(x => x.subject.id === 'f-5' || x.subject.type === 'notice').map(x => [x.kind, x.recipient_id, x.audience]), [['notice.returned', 'p-2', 'full'], ['notice.returned', 'p-4', 'full'], ['notice.payment_voided', 'p-4', 'full'], ['notice.payment_voided', 'p-2', 'card_owner']]);
  const view = f.call(P + 'fills.get', { fill_id: 'f-5' }).fill;
  assert.deepEqual([view.return_at, view.warning_at, view.authorization.state, view.claim.reversed_at], ['2026-12-09T12:00:00-05:00', '2026-12-06T12:00:00-05:00', 'voided', '2026-12-09T12:00:00-05:00']);
});

test('T13 a cash-funded ready fill returns with its rejected claim kept and nothing reversed', () => {
  const s = baseSeed();
  const c = s.fills.find(x => x.fill_id === 'f-3');
  Object.assign(c, { state: 'ready', cash: { price_cents: 2400 }, amount_due_cents: 2400, ready_at: '2026-11-28T13:00:00-05:00', warning_due_at: '2026-12-05T13:00:00-05:00', return_due_at: '2026-12-08T13:00:00-05:00' });
  c.timeline.push({ state: 'ready', at: '2026-11-28T13:00:00-05:00' });
  const f = fixture({ seed: s, now: '2026-12-09T09:00:00-05:00' });
  poke(f);
  const d = f.data();
  assert.deepEqual([stored(f, 'f-3').state, d.claims.find(x => x.claim_id === 'cl-2').reversed_at, d.claims.find(x => x.claim_id === 'cl-2').result], ['returned_to_stock', null, 'rejected']);
  assert.ok(!/claim was reversed/.test(d.notices.find(x => x.kind === 'notice.returned' && x.subject.id === 'f-3').body));
});

test('T13 a cash token previewed on projected state confirms when its confirm is the write that commits the timers', () => {
  const s = structuredClone(minimal);
  withCollected(s, 'rx-1', '2026-11-10T15:00:00-05:00');
  const f = fixture({ seed: s });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T12:00:00-05:00');
  assert.equal(stored(f, id).state, 'requested');
  const p = f.call(P + 'fills.choose_cash.preview', { fill_id: id });
  assert.equal(stored(f, id).state, 'requested');
  const c = f.call(P + 'fills.choose_cash.confirm', { fill_id: id, token: p.preview.token });
  assert.deepEqual([c.status, c.fill.state, c.fill.timeline.map(x => x.state)], ['committed', 'ready', ['requested', 'claim_rejected', 'ready']]);
});

test('T13 a review due exactly at the Rx 23:59 expiry → expiry first; equal due times apply in fill-ID string order; a made fill stays collectable', () => {
  const s = baseSeed();
  s.prescriptions.push({ ...s.prescriptions[0], rx_id: 'rx-9', written_on: '2025-11-30', received_at: '2025-11-30T09:00:00-05:00' });
  s.fills.push(requested('f-9', 'rx-9', '2026-11-30T07:59:00-05:00'));
  s.fills.find(x => x.fill_id === 'f-9').review_due_at = '2026-11-30T23:59:00-05:00';
  s.prescriptions.push({ ...s.prescriptions[0], rx_id: 'rx-10' }, { ...s.prescriptions[0], rx_id: 'rx-11' }, { ...s.prescriptions[0], rx_id: 'rx-90' }, { ...s.prescriptions[0], rx_id: 'rx-100' });
  s.fills.push(requested('f-10', 'rx-10', '2026-11-30T08:00:00-05:00'), requested('f-11', 'rx-11', '2026-11-30T08:00:00-05:00', 'st-2'), requested('f-90', 'rx-90', '2026-11-30T08:10:00-05:00'), requested('f-100', 'rx-100', '2026-11-30T08:10:00-05:00'));
  s.issued.f = 100;
  const f = fixture({ seed: s });
  f.setNow('2026-12-01T09:00:00-05:00');
  poke(f);
  assert.deepEqual([stored(f, 'f-9').state, stored(f, 'f-9').cancellation.reason, stored(f, 'f-9').claim_id], ['cancelled', 'rx_expired', null]);
  const order = f.data().claims.filter(c => ['f-10', 'f-11', 'f-1', 'f-90', 'f-100'].includes(c.fill_id)).map(c => c.fill_id);
  assert.deepEqual(order, ['f-10', 'f-11', 'f-100', 'f-90', 'f-1']);
  assert.equal(stored(f, 'f-5').state, 'ready');
});

test('T13 a seed whose earliest timer is already due cascades review → ready → warning, each dated at its own due time', () => {
  const s = structuredClone(minimal);
  s.fills.push(requested('f-1', 'rx-1', '2026-11-20T09:00:00-05:00'));
  s.issued.f = 1;
  const f = fixture({ seed: s, now: '2026-11-30T09:00:00-05:00' });
  poke(f);
  const fill = stored(f, 'f-1');
  assert.deepEqual([fill.state, fill.ready_at, fill.warned_at, fill.return_due_at], ['ready', '2026-11-20T11:00:00-05:00', '2026-11-27T11:00:00-05:00', '2026-11-30T11:00:00-05:00']);
  assert.deepEqual(f.data().notices.map(x => [x.kind, x.at]).filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i), [['notice.fill_ready', '2026-11-20T11:00:00-05:00'], ['notice.return_warning', '2026-11-27T11:00:00-05:00']]);
});

test('T13 a failed call after catch-up stores nothing: data, notices and version stay as they were', () => {
  const f = fixture({ seed: prepaid() });
  f.setNow('2026-12-10T09:00:00-05:00');
  const before = f.data();
  assert.equal(f.call(P + 'fills.wait', { fill_id: 'f-5' }).status, 'invalid_state');
  assert.equal(f.call(P + 'fills.change_store', { fill_id: 'f-99', store_id: 'st-1' }).status, 'not_found');
  assert.equal(ev(f, 'fill.hold_placed', { fill_id: 'f-99', note: 'x' }).status, 'invalid_event');
  assert.deepEqual(f.data(), before);
});
