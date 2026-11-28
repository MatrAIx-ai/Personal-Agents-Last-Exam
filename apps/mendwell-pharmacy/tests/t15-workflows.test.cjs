'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e15-' + (++n), at: f.ctx.virtual_now, operation, payload });
const ok = (f, token, by = 'p-2') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const rxOf = (f, id) => f.data().prescriptions.find(x => x.rx_id === id);
const get = (f, id) => f.call(P + 'fills.get', { fill_id: id }).fill;
const money = f => JSON.stringify([f.data().authorizations, f.data().charges, f.data().claims.map(c => c.reversed_at), f.data().prescriptions.map(r => r.fills_remaining)]);
const request = (f, store = 'st-1') => f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: store, quantity: 30 }).fill.fill_id;
const seed = edit => { const s = structuredClone(minimal); s.cards.push({ card_id: 'card-4', owner_id: 'p-4', label: 'Pension card', last4: '6610', exp_month: 5, exp_year: 2029, status: 'active' }); if (edit) edit(s); return s; };
const pa = s => { s.plans.find(x => x.plan_id === 'plan-b').rules['d-atorvastatin-40'].prior_auth_required = true; };

function w1(revokeFirst) {
  const f = fixture({ seed: seed() });
  const id = request(f);
  ev(f, 'grant.changed', { grant_id: 'g-30', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'pickup', fill_id: null, expires_at: '2026-12-31T23:00:00-05:00', status: 'active' });
  f.call(P + 'fills.set_collector', { fill_id: id, collector_id: 'p-2' });
  f.setNow('2026-12-02T10:00:00-05:00');
  const fill = get(f, id);
  assert.deepEqual([fill.state, fill.hold, fill.amount_due_cents > 0, fill.authorization, fill.collector_id], ['ready', null, true, null, 'p-2']);
  if (revokeFirst) ev(f, 'grant.changed', { grant_id: 'g-30', status: 'revoked' });
  const before = money(f);
  ev(f, 'fill.collection_attempted', { fill_id: id, collector_id: 'p-2', card_id: 'card-3' });
  return { f, id, before };
}

test('W1 main: an elderly parent\'s pickup grant; her caregiver collects at an open store with her own valid card → collected, her card charged once, fills −1', () => {
  const { f, id } = w1(false);
  assert.deepEqual([stored(f, id).state, rxOf(f, 'rx-1').fills_remaining], ['collected', 4]);
  assert.deepEqual(f.data().charges.map(c => [c.payer_id, c.card_id, c.method, c.amount_cents]), [['p-2', 'card-3', 'counter', 1200]]);
});

test('W1 control: grant.changed revokes first → refusal collector_not_authorized; collector cleared; status and finances unchanged', () => {
  const { f, id, before } = w1(true);
  assert.deepEqual([stored(f, id).refusals.map(r => r.reason), stored(f, id).collector, stored(f, id).state, money(f)], [['collector_not_authorized'], null, 'ready', before]);
});

test('W2 main: an Rx with 0 fills → no_fills_remaining; renewal approved → new Rx, old superseded. Control: a reply after renewals.withdraw is a committed no-op with no new Rx', () => {
  const f = fixture({ seed: seed(s => { s.prescriptions[0].fills_remaining = 0; }) });
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'no_fills_remaining');
  const rn = f.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal;
  ev(f, 'renewal.replied', { renewal_id: rn.renewal_id, decision: 'approved', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } });
  assert.deepEqual([rxOf(f, 'rx-1').state, rxOf(f, 'rx-1').superseded_by, rxOf(f, 'rx-10').fills_remaining], ['superseded', 'rx-10', 5]);
  const g = fixture({ seed: seed(s => { s.prescriptions[0].fills_remaining = 0; }) });
  const second = g.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal;
  g.call(P + 'renewals.withdraw', { renewal_id: second.renewal_id });
  const before = JSON.stringify(g.data());
  assert.equal(ev(g, 'renewal.replied', { renewal_id: second.renewal_id, decision: 'approved', rx: { rx_id: 'rx-11', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } }).status, 'committed');
  assert.equal(JSON.stringify(g.data()), before);
  assert.equal(rxOf(g, 'rx-11'), undefined);
});

test('W3 main: prior_auth_required → plan request denied → cash confirm, store in stock → ready with notice.fill_ready. Control: a decision for a withdrawn request changes nothing', () => {
  const f = fixture({ seed: seed(pa) });
  const id = request(f);
  f.setNow('2026-11-30T11:30:00-05:00');
  const pr = f.call(P + 'plan_requests.create', { fill_id: id }).plan_request;
  ev(f, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: 'denied' });
  const pv = f.call(P + 'fills.choose_cash.preview', { fill_id: id }).preview;
  const from = f.data().notices.length;
  assert.deepEqual([f.call(P + 'fills.choose_cash.confirm', { fill_id: id, token: pv.token }).fill.state, f.data().notices.slice(from).map(x => x.kind)], ['ready', ['notice.fill_ready', 'notice.fill_ready']]);
  const g = fixture({ seed: seed(pa) });
  const gid = request(g);
  g.setNow('2026-11-30T11:30:00-05:00');
  const req = g.call(P + 'plan_requests.create', { fill_id: gid }).plan_request;
  g.call(P + 'plan_requests.withdraw', { plan_request_id: req.plan_request_id });
  const before = JSON.stringify(g.data());
  assert.equal(ev(g, 'plan.decided', { plan_request_id: req.plan_request_id, decision: 'approved' }).status, 'committed');
  assert.equal(JSON.stringify(g.data()), before);
});

test('W4 main: a hold during review → no ready, timers paused; release → the stored decision applies while still relevant. Control: a collection while held → on_hold, not replayed after release', () => {
  const f = fixture({ seed: seed() });
  const id = request(f);
  f.setNow('2026-11-30T10:00:00-05:00');
  ev(f, 'fill.hold_placed', { fill_id: id, note: 'Interaction flag: confirm with the prescriber' });
  f.setNow('2026-11-30T15:00:00-05:00');
  assert.deepEqual([get(f, id).state, get(f, id).review_due_at, stored(f, id).hold.remaining], ['requested', null, { review_ms: 3600000 }]);
  ev(f, 'fill.collection_attempted', { fill_id: id, collector_id: 'p-4', card_id: 'card-4' });
  ev(f, 'fill.hold_released', { fill_id: id, note: 'Prescriber confirmed the dose' });
  f.setNow('2026-11-30T16:00:00-05:00');
  assert.equal(get(f, id).state, 'ready');
  ev(f, 'user.confirmed', { token: 'tok-7c1e', confirmed_by: 'p-2' });
  assert.deepEqual([stored(f, id).state, stored(f, id).refusals.map(r => r.reason), f.data().charges.length], ['ready', ['on_hold'], 0]);
  const g = fixture({ seed: seed(pa) });
  const gid = request(g);
  g.setNow('2026-11-30T11:30:00-05:00');
  const pr = g.call(P + 'plan_requests.create', { fill_id: gid }).plan_request;
  ev(g, 'fill.hold_placed', { fill_id: gid, note: 'Interaction flag' });
  ev(g, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: 'approved' });
  assert.equal(get(g, gid).state, 'pending_plan_decision');
  g.setNow('2026-11-30T12:00:00-05:00');
  ev(g, 'fill.hold_released', { fill_id: gid, note: 'Cleared' });
  assert.deepEqual([get(g, gid).state, g.data().plan_requests[0].state], ['ready', 'approved']);
});

test('W5 main: a prepaid ready fill → fills.cancel.confirm → cancelled, claim reversed, authorization voided. Control: a fresh prepay with a consumed approval → confirmation_invalid; a new cancel preview → invalid_state; a pre-cancellation token → stale_preview', () => {
  const f = fixture({ seed: seed() });
  const id = request(f);
  f.setNow('2026-11-30T12:00:00-05:00');
  const pp = f.call(P + 'fills.prepay.preview', { fill_id: id, card_id: 'card-3' }).preview;
  ok(f, pp.token);
  f.call(P + 'fills.prepay.confirm', { fill_id: id, card_id: 'card-3', token: pp.token });
  assert.equal(f.call(P + 'fills.prepay.confirm', { fill_id: id, card_id: 'card-3', token: pp.token }).status, 'confirmation_invalid');
  assert.equal(f.data().authorizations.length, 1);
  const cv = f.call(P + 'fills.cancel.preview', { fill_id: id }).preview;
  assert.equal(f.call(P + 'fills.cancel.confirm', { fill_id: id, token: cv.token }).fill.state, 'cancelled');
  const claim = f.data().claims.find(c => c.fill_id === id);
  assert.deepEqual([claim.reversed_at, f.data().authorizations[0].state, rxOf(f, 'rx-1').fills_remaining], ['2026-11-30T12:00:00-05:00', 'voided', 5]);
  assert.equal(f.call(P + 'fills.cancel.preview', { fill_id: id }).status, 'invalid_state');
  assert.equal(f.call(P + 'fills.cancel.confirm', { fill_id: id, token: cv.token }).status, 'stale_preview');
  assert.equal(f.call(P + 'fills.prepay.preview', { fill_id: id, card_id: 'card-3' }).status, 'invalid_state');
});
