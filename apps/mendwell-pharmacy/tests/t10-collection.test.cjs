'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, householdSeed, rx, ready, claim } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e10-' + (++n), at: f.ctx.virtual_now, operation, payload });
const ok = (f, token, by = 'p-2') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const collect = (f, fill_id, collector_id, card_id) => ev(f, 'fill.collection_attempted', { fill_id, collector_id, ...(card_id ? { card_id } : {}) });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const rxOf = (f, id) => f.data().prescriptions.find(x => x.rx_id === id);
const get = (f, id) => f.call(P + 'fills.get', { fill_id: id }).fill;
const since = (f, from, id) => f.data().notices.slice(from).filter(x => id === undefined || x.subject.id === id).map(x => x.kind + ':' + x.recipient_id + '@' + x.at);
const money = f => JSON.stringify([f.data().authorizations, f.data().charges, f.data().prescriptions.map(r => [r.rx_id, r.fills_remaining])]);
const refusals = (f, id) => stored(f, id).refusals.map(r => [r.reason, r.collector_id, r.at]);
const card = (card_id, owner_id, extra = {}) => ({ card_id, owner_id, label: 'Card ' + card_id, last4: '700' + card_id.slice(-1), exp_month: 8, exp_year: 2028, status: 'active', ...extra });
const NOW = '2026-11-30T09:00:00-05:00';

function seed(edit = () => {}) {
  const s = baseSeed();
  s.cards.push(card('card-4', 'p-4'), card('card-5', 'p-2', { status: 'declined' }), card('card-6', 'p-2', { exp_month: 11, exp_year: 2026 }), card('card-7', 'p-4', { status: 'declined' }));
  s.plans.find(x => x.plan_id === 'plan-a').rules['d-amoxicillin-250-5'].copay_cents = 0;
  s.prescriptions.push(rx('rx-9', { patient_id: 'p-2', drug_id: 'd-amoxicillin-250-5', quantity: 100, prescriber_id: 'dr-1' }));
  s.fills.push(ready('f-9', 'rx-9', '2026-11-29T09:00:00-05:00', { due: 0 }));
  s.fills.find(x => x.fill_id === 'f-9').quantity = 100;
  s.claims.push(claim('cl-9', 'f-9', '2026-11-29T16:00:00.000Z', 'paid', { copay_cents: 0 }));
  s.issued.f = 9;
  edit(s);
  return s;
}

function prepay(f, fill_id, card_id) {
  const pv = f.call(P + 'fills.prepay.preview', { fill_id, card_id }).preview;
  ok(f, pv.token);
  return f.call(P + 'fills.prepay.confirm', { fill_id, card_id, token: pv.token });
}

test('Collection check order: held, not ready, closed, collector, payment; each failure appends one refusal and its notices and changes no status or finances', () => {
  const f = fixture({ seed: seed() });
  const v = stored(f, 'f-5').fill_version, before = money(f);
  ev(f, 'fill.hold_placed', { fill_id: 'f-5', note: 'Interaction flag: confirm with the prescriber' });
  f.setNow('2026-11-30T22:00:00-05:00');
  let from = f.data().notices.length;
  assert.equal(collect(f, 'f-5', 'p-9').status, 'committed');
  assert.deepEqual(since(f, from, 'f-5'), ['notice.refused:p-2@2026-11-30T22:00:00-05:00', 'notice.refused:p-4@2026-11-30T22:00:00-05:00']);
  ev(f, 'fill.hold_released', { fill_id: 'f-5', note: 'Prescriber confirmed the dose' });
  collect(f, 'f-1', 'p-4', 'card-4');
  collect(f, 'f-5', 'p-9');
  f.setNow('2026-12-01T09:00:00-05:00');
  from = f.data().notices.length;
  collect(f, 'f-5', 'p-9');
  const entry = f.data().notices[from];
  assert.deepEqual({ ...entry, notice_id: null, body: null }, { notice_id: null, kind: 'notice.refused', recipient_id: 'p-2', audience: 'full', subject: { type: 'fill', id: 'f-5' }, at: '2026-12-01T09:00:00-05:00', title: 'Collection refused', body: null, fields: { fill_id: 'f-5', store_id: 'st-1', state: 'ready', amount_due_cents: 1200, reason: 'collector_not_authorized' } });
  assert.match(entry.body, /^Collection of fill f-5 of atorvastatin .* was refused: the collector is not authorized for this fill\.$/);
  for (const c of [undefined, 'card-3', 'card-7', 'card-99']) collect(f, 'f-5', 'p-4', c);
  const t1 = '2026-11-30T22:00:00-05:00', t2 = '2026-12-01T09:00:00-05:00';
  assert.deepEqual(refusals(f, 'f-5'), [['on_hold', 'p-9', t1], ['store_closed', 'p-9', t1], ['collector_not_authorized', 'p-9', t2], ...Array(4).fill(['payment_failed', 'p-4', t2])]);
  assert.deepEqual(refusals(f, 'f-1'), [['not_ready', 'p-4', t1]]);
  assert.deepEqual([stored(f, 'f-5').state, stored(f, 'f-5').fill_version, money(f)], ['ready', v + 2, before]);
  assert.deepEqual(get(f, 'f-5').refusals.map(r => r.reason), refusals(f, 'f-5').map(r => r[0]));
});

test('T13 a timer due by the attempt is applied first and committed with the refusal; at exactly the return deadline the fill is returned and the attempt is not_ready', () => {
  const f = fixture({ seed: seed(), now: '2026-12-06T13:00:00-05:00' });
  const from = f.data().notices.length;
  collect(f, 'f-5', 'p-9');
  assert.equal(stored(f, 'f-5').warned_at, '2026-12-06T12:00:00-05:00');
  assert.deepEqual(since(f, from, 'f-5'), ['notice.return_warning:p-2@2026-12-06T12:00:00-05:00', 'notice.return_warning:p-4@2026-12-06T12:00:00-05:00', 'notice.refused:p-2@2026-12-06T13:00:00-05:00', 'notice.refused:p-4@2026-12-06T13:00:00-05:00']);
  const g = fixture({ seed: seed(), now: '2026-12-09T12:00:00-05:00' });
  const start = g.data().notices.length;
  collect(g, 'f-5', 'p-4', 'card-4');
  assert.deepEqual([stored(g, 'f-5').state, refusals(g, 'f-5')], ['returned_to_stock', [['not_ready', 'p-4', '2026-12-09T12:00:00-05:00']]]);
  assert.deepEqual(since(g, start, 'f-5'), ['notice.return_warning:p-2@2026-12-06T12:00:00-05:00', 'notice.return_warning:p-4@2026-12-06T12:00:00-05:00', 'notice.returned:p-2@2026-12-09T12:00:00-05:00', 'notice.returned:p-4@2026-12-09T12:00:00-05:00', 'notice.refused:p-2@2026-12-09T12:00:00-05:00', 'notice.refused:p-4@2026-12-09T12:00:00-05:00']);
  assert.deepEqual(g.data().charges.length, 1);
});

test('T19 a live authorization is captured and the counter card ignored, an unknown one too; success uses one fill and one capture and sends no notice', () => {
  for (const counter of ['card-4', 'card-99']) {
    const f = fixture({ seed: seed() });
    prepay(f, 'f-5', 'card-3');
    const from = f.data().notices.length;
    assert.equal(collect(f, 'f-5', 'p-4', counter).status, 'committed');
    const s = stored(f, 'f-5');
    assert.deepEqual([s.state, s.closed_at, s.charge_id, s.warning_due_at, s.return_due_at, s.timeline.at(-1)], ['collected', NOW, 'ch-2', null, null, { state: 'collected', at: NOW }]);
    assert.deepEqual(f.data().charges.at(-1), { charge_id: 'ch-2', fill_id: 'f-5', payer_id: 'p-2', card_id: 'card-3', method: 'capture', amount_cents: 1200, at: NOW });
    assert.deepEqual(f.data().authorizations, [{ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'captured', at: NOW, ended_at: NOW }]);
    assert.deepEqual([f.data().charges.length, rxOf(f, 'rx-5').fills_remaining, since(f, from)], [2, 4, []]);
    assert.deepEqual([get(f, 'f-5').charge.method, get(f, 'f-5').authorization.state], ['capture', 'captured']);
  }
});

test('T19 a failed capture after the card\'s expiry month: payment_failed, the authorization stays live, no counter charge, and again the same', () => {
  const f = fixture({ seed: seed(), now: '2026-11-30T23:40:00-05:00' });
  assert.equal(prepay(f, 'f-5', 'card-6').status, 'committed');
  f.setNow('2026-12-01T10:00:00-05:00');
  const before = money(f);
  collect(f, 'f-5', 'p-4', 'card-4');
  collect(f, 'f-5', 'p-4', 'card-4');
  assert.deepEqual(refusals(f, 'f-5').map(r => r[0]), ['payment_failed', 'payment_failed']);
  assert.deepEqual([money(f), stored(f, 'f-5').state, f.data().authorizations[0].state], [before, 'ready', 'live']);
});

test('T19 counter payment: the collector\'s own valid card is charged once; zero due collects without payment and ignores the card; one fill is used only once', () => {
  const f = fixture({ seed: seed() });
  collect(f, 'f-5', 'p-4', 'card-4');
  assert.deepEqual(f.data().charges.at(-1), { charge_id: 'ch-2', fill_id: 'f-5', payer_id: 'p-4', card_id: 'card-4', method: 'counter', amount_cents: 1200, at: NOW });
  assert.deepEqual([f.data().authorizations, rxOf(f, 'rx-5').fills_remaining], [[], 4]);
  collect(f, 'f-9', 'p-2', 'card-99');
  assert.deepEqual([stored(f, 'f-9').state, stored(f, 'f-9').charge_id, f.data().charges.length, rxOf(f, 'rx-9').fills_remaining], ['collected', null, 2, 4]);
  collect(f, 'f-9', 'p-2', 'card-3');
  collect(f, 'f-5', 'p-4', 'card-4');
  assert.deepEqual([refusals(f, 'f-9').map(r => r[0]), refusals(f, 'f-5').map(r => r[0]), rxOf(f, 'rx-9').fills_remaining, rxOf(f, 'rx-5').fills_remaining, f.data().charges.length], [['not_ready'], ['not_ready'], 4, 4, 2]);
});

function caregiver(edit) {
  const s = structuredClone(minimal);
  s.cards.push(card('card-4', 'p-4'));
  const f = fixture({ seed: s });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  ev(f, 'grant.changed', { grant_id: 'g-3', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'pickup', fill_id: id, expires_at: null, status: 'active' });
  assert.equal(f.call(P + 'fills.set_collector', { fill_id: id, collector_id: 'p-2' }).fill.collector_id, 'p-2');
  f.setNow('2026-11-30T17:30:00-05:00');
  if (edit) edit(f, id);
  return { f, id };
}

test('T15 W1 the caregiver collects her parent\'s fill under a pickup grant with her own card: collected, charged once, fills −1', () => {
  const { f, id } = caregiver();
  assert.equal(get(f, id).state, 'ready');
  collect(f, id, 'p-2', 'card-3');
  assert.deepEqual([stored(f, id).state, rxOf(f, 'rx-1').fills_remaining], ['collected', 4]);
  assert.deepEqual(f.data().charges, [{ charge_id: 'ch-1', fill_id: id, payer_id: 'p-2', card_id: 'card-3', method: 'counter', amount_cents: 1200, at: '2026-11-30T17:30:00-05:00' }]);
});

test('T18 W1 a revocation by grant.changed first: collector cleared, refusal collector_not_authorized, status and finances unchanged', () => {
  const { f, id } = caregiver(g => ev(g, 'grant.changed', { grant_id: 'g-3', status: 'revoked' }));
  assert.equal(stored(f, id).collector, null);
  const before = money(f), from = f.data().notices.length;
  collect(f, id, 'p-2', 'card-3');
  assert.deepEqual([refusals(f, id), stored(f, id).state, money(f)], [[['collector_not_authorized', 'p-2', '2026-11-30T17:30:00-05:00']], 'ready', before]);
  assert.deepEqual(since(f, from), ['notice.refused:p-2@2026-11-30T17:30:00-05:00', 'notice.refused:p-4@2026-11-30T17:30:00-05:00']);
});

test('The counter checks authority, not the collector record: the patient collects though the caregiver is named; a guardian collects for a minor; a made fill is collected after its Rx expired', () => {
  const { f, id } = caregiver();
  collect(f, id, 'p-4', 'card-4');
  assert.deepEqual([stored(f, id).state, f.data().charges[0].payer_id], ['collected', 'p-4']);
  const h = fixture({ seed: householdSeed(), now: '2026-11-30T10:30:00-05:00' });
  collect(h, 'f-41', 'p-1', 'card-1');
  assert.deepEqual([stored(h, 'f-41').state, h.data().charges.at(-1).payer_id, h.data().charges.at(-1).amount_cents], ['collected', 'p-1', 500]);
  const e = fixture({ seed: seed(s => Object.assign(s.prescriptions.find(r => r.rx_id === 'rx-5'), { written_on: '2025-11-29', received_at: '2025-11-29T10:00:00-05:00' })) });
  assert.equal(e.call(P + 'rx.get', { rx_id: 'rx-5' }).prescription.state, 'expired');
  collect(e, 'f-5', 'p-4', 'card-4');
  assert.equal(stored(e, 'f-5').state, 'collected');
});

test('T01 rx.received → request → reviewed after 2 hours → ready → collected; fills −1 once', () => {
  const f = fixture();
  ev(f, 'rx.received', { rx_id: 'rx-9', patient_id: 'p-2', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-11-30' });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-9', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T10:59:59-05:00');
  assert.equal(get(f, id).state, 'requested');
  f.setNow('2026-11-30T11:00:00-05:00');
  assert.deepEqual([get(f, id).state, get(f, id).amount_due_cents], ['ready', 1000]);
  f.setNow('2026-11-30T11:30:00-05:00');
  collect(f, id, 'p-2', 'card-3');
  collect(f, id, 'p-2', 'card-3');
  assert.deepEqual([stored(f, id).state, rxOf(f, 'rx-9').fills_remaining, f.data().charges.length, refusals(f, id).map(r => r[0])], ['collected', 2, 1, ['not_ready']]);
  assert.deepEqual(stored(f, id).timeline.map(t => [t.state, t.at]), [['requested', NOW], ['ready', '2026-11-30T11:00:00-05:00'], ['collected', '2026-11-30T11:30:00-05:00']]);
});

test('T03 no fills → renewal approved → the new prescription\'s fill is collected', () => {
  const s = structuredClone(minimal);
  s.prescriptions[0].fills_remaining = 0;
  s.cards.push(card('card-4', 'p-4'));
  const f = fixture({ seed: s });
  const rn = f.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal;
  ev(f, 'renewal.replied', { renewal_id: rn.renewal_id, decision: 'approved', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } });
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'rx_superseded');
  const id = f.call(P + 'fills.request', { rx_id: 'rx-10', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T12:00:00-05:00');
  collect(f, id, 'p-4', 'card-4');
  assert.deepEqual([stored(f, id).state, rxOf(f, 'rx-10').fills_remaining, rxOf(f, 'rx-1').fills_remaining, f.data().charges[0].amount_cents], ['collected', 4, 0, 1200]);
});

test('T07 prior authorization denied → cash → collected at the cash price', () => {
  const s = structuredClone(minimal);
  s.plans.find(x => x.plan_id === 'plan-b').rules['d-atorvastatin-40'].prior_auth_required = true;
  s.cards.push(card('card-4', 'p-4'));
  const f = fixture({ seed: s });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(get(f, id).claim.reason, 'prior_auth_required');
  const pr = f.call(P + 'plan_requests.create', { fill_id: id }).plan_request;
  ev(f, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: 'denied' });
  const pv = f.call(P + 'fills.choose_cash.preview', { fill_id: id }).preview;
  assert.equal(f.call(P + 'fills.choose_cash.confirm', { fill_id: id, token: pv.token }).fill.amount_due_cents, 2400);
  collect(f, id, 'p-4', 'card-4');
  assert.deepEqual([stored(f, id).state, f.data().charges[0].amount_cents, f.data().charges[0].method, get(f, id).claim.result, rxOf(f, 'rx-1').fills_remaining], ['collected', 2400, 'counter', 'rejected', 4]);
});
