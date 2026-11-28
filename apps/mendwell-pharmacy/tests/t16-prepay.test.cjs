'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, householdSeed, asActor, rx, ready, requested, claim } = require('./seeds.cjs');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e16-' + (++n), at: f.ctx.virtual_now, operation, payload });
const ok = (f, token, by = 'p-2') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const preview = (f, fill_id, card_id = 'card-3') => f.call(P + 'fills.prepay.preview', { fill_id, card_id });
const confirm = (f, fill_id, token, card_id = 'card-3') => f.call(P + 'fills.prepay.confirm', { fill_id, card_id, token });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const get = (f, id) => f.call(P + 'fills.get', { fill_id: id }).fill;
const NOW = '2026-11-30T09:00:00-05:00';
const card = (card_id, owner_id, extra = {}) => ({ card_id, owner_id, label: 'Card ' + card_id, last4: '900' + card_id.slice(-1), exp_month: 8, exp_year: 2028, status: 'active', ...extra });

function seed() {
  const s = baseSeed();
  s.cards.push(card('card-4', 'p-4'), card('card-5', 'p-2', { status: 'declined' }), card('card-6', 'p-2', { exp_month: 11, exp_year: 2026 }));
  s.plans.find(x => x.plan_id === 'plan-a').rules['d-amoxicillin-250-5'].copay_cents = 0;
  s.prescriptions.push(rx('rx-9', { patient_id: 'p-2', drug_id: 'd-amoxicillin-250-5', quantity: 100, prescriber_id: 'dr-1' }));
  s.fills.push(ready('f-9', 'rx-9', '2026-11-29T09:00:00-05:00', { due: 0 }));
  s.fills.find(x => x.fill_id === 'f-9').quantity = 100;
  s.claims.push(claim('cl-9', 'f-9', '2026-11-29T16:00:00.000Z', 'paid', { copay_cents: 0 }));
  s.issued.f = 9;
  return s;
}

test('T16 T20 prepay: the card owner confirms and the card is authorized for exactly the amount due, once', () => {
  const f = fixture({ seed: seed() });
  const notices = f.data().notices.length, v = stored(f, 'f-5').fill_version;
  const pv = preview(f, 'f-5').preview;
  assert.match(pv.token, /^tok-prepay-fill-f-5-[0-9a-f]{32}$/);
  assert.deepEqual([pv.required_confirmer, pv.changes], ['p-2', { card_id: 'card-3', amount_cents: 1200 }]);
  assert.equal(confirm(f, 'f-5', pv.token).status, 'confirmation_required');
  ok(f, pv.token);
  assert.deepEqual(get(f, 'f-5').approvals.map(a => [a.token, a.state]), [[pv.token, 'active']]);
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-6', store_id: 'st-1', quantity: 30 }).status, 'committed');
  const out = confirm(f, 'f-5', pv.token);
  assert.deepEqual(out.fill.authorization, { authorization_id: 'au-1', card_last4: '4417', amount_cents: 1200, state: 'live' });
  assert.deepEqual(f.data().authorizations, [{ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: NOW, ended_at: null }]);
  assert.deepEqual([stored(f, 'f-5').fill_version, stored(f, 'f-5').state, stored(f, 'f-5').amount_due_cents], [v + 1, 'ready', 1200]);
  assert.deepEqual(get(f, 'f-5').approvals.map(a => a.state), ['used']);
  assert.equal(preview(f, 'f-5').status, 'invalid_state');
  assert.equal(confirm(f, 'f-5', pv.token).status, 'confirmation_invalid');
  assert.equal(f.data().authorizations.length, 1);
  assert.equal(f.data().notices.length, notices);
});

test('T16 the parent\'s card → not_authorized; an unknown card → not_found; declined and expired cards → payment_failed with nothing stored', () => {
  const f = fixture({ seed: seed() });
  assert.equal(preview(f, 'f-5', 'card-4').status, 'not_authorized');
  assert.equal(preview(f, 'f-5', 'card-99').status, 'not_found');
  const made = 'tok-prepay-fill-f-5-' + '0'.repeat(32);
  ok(f, made);
  assert.equal(confirm(f, 'f-5', made, 'card-4').status, 'not_authorized');
  assert.equal(confirm(f, 'f-5', made, 'card-99').status, 'not_found');
  const pv = preview(f, 'f-5', 'card-5').preview;
  ok(f, pv.token);
  const before = JSON.stringify(f.data());
  assert.equal(confirm(f, 'f-5', pv.token, 'card-5').status, 'payment_failed');
  assert.equal(JSON.stringify(f.data()), before);
  assert.equal(f.data().approvals.find(a => a.token === pv.token).used_at, null);
  for (const [at, expected] of [['2026-11-30T23:59:59-05:00', 'committed'], ['2026-12-01T00:00:00-05:00', 'payment_failed']]) {
    const g = fixture({ seed: seed(), now: '2026-11-30T23:50:00-05:00' });
    const t = preview(g, 'f-5', 'card-6').preview.token;
    ok(g, t);
    g.setNow(at);
    assert.equal(confirm(g, 'f-5', t, 'card-6').status, expected, at);
  }
});

test('T16 state checks: held → on_hold; not ready, zero due or a live authorization → invalid_state; a pre-hold token with a valid approval → stale_preview', () => {
  const f = fixture({ seed: seed() });
  assert.deepEqual(['f-1', 'f-2', 'f-3', 'f-4', 'f-6', 'f-7', 'f-8', 'f-9'].map(id => preview(f, id).status), Array(8).fill('invalid_state'));
  const pv = preview(f, 'f-5').preview;
  ok(f, pv.token);
  ev(f, 'fill.hold_placed', { fill_id: 'f-5', note: 'Interaction flag: confirm with the prescriber' });
  assert.equal(preview(f, 'f-5').status, 'on_hold');
  assert.equal(confirm(f, 'f-5', pv.token).status, 'stale_preview');
  assert.equal(confirm(f, 'f-5', 'tok-prepay-fill-f-5-' + '9'.repeat(32)).status, 'confirmation_required');
  ev(f, 'fill.hold_released', { fill_id: 'f-5', note: 'Prescriber confirmed the dose' });
  assert.equal(confirm(f, 'f-5', pv.token).status, 'stale_preview');
  const again = preview(f, 'f-5').preview;
  assert.notEqual(again.token, pv.token);
  ok(f, again.token);
  assert.equal(confirm(f, 'f-5', again.token).fill.authorization.state, 'live');
});

test('T16 a card owner who sees only fill A cannot prepay fill B; for A the logistics view comes back with their own authorization', () => {
  const { seed: s, binding } = asActor(householdSeed(), require('../fixtures/binding.json'), 'p-1');
  const f = fixture({ seed: s, binding });
  assert.equal(preview(f, 'f-1', 'card-1').status, 'not_authorized');
  assert.equal(preview(f, 'f-5', 'card-3').status, 'not_authorized');
  const pv = preview(f, 'f-5', 'card-1').preview;
  assert.equal(pv.required_confirmer, 'p-1');
  ok(f, pv.token, 'p-1');
  const out = confirm(f, 'f-5', pv.token, 'card-1').fill;
  assert.deepEqual([out.view, out.own_authorization, out.approvals.map(a => a.state)], ['logistics', { card_last4: '2208', amount_cents: 1200, state: 'live' }, ['used']]);
  const back = asActor(f.data(), binding, 'p-2');
  const owner = fixture({ seed: back.seed, binding: back.binding });
  assert.equal(owner.call(P + 'fills.get', { fill_id: 'f-5' }).fill.authorization.card_last4, '2208');
});

test('T16 a guardian prepays a minor\'s fill with their own card', () => {
  const s = seed();
  s.prescriptions.push(rx('rx-30', { patient_id: 'p-3' }));
  s.fills.push(ready('f-30', 'rx-30', '2026-11-29T09:00:00-05:00', { due: 1000 }));
  s.claims.push(claim('cl-30', 'f-30', '2026-11-29T16:00:00.000Z', 'paid', { copay_cents: 1000 }));
  const f = fixture({ seed: s });
  const pv = preview(f, 'f-30').preview;
  ok(f, pv.token);
  assert.equal(confirm(f, 'f-30', pv.token).fill.authorization.amount_cents, 1000);
});

test('T20 a prepay preview on projected state, then user.confirmed commits those timers, then the confirm commits', () => {
  const s = seed();
  s.prescriptions.push(rx('rx-31', { patient_id: 'p-2' }));
  s.fills.push(requested('f-31', 'rx-31', '2026-11-30T08:30:00-05:00'));
  const f = fixture({ seed: s, now: '2026-11-30T10:45:00-05:00' });
  const storedVersion = stored(f, 'f-31').fill_version;
  assert.equal(stored(f, 'f-31').state, 'requested');
  const projected = get(f, 'f-31');
  assert.deepEqual([projected.state, projected.amount_due_cents], ['ready', 1000]);
  const pv = preview(f, 'f-31').preview;
  ok(f, pv.token);
  assert.deepEqual([stored(f, 'f-31').state, stored(f, 'f-31').fill_version], ['ready', projected.fill_version]);
  assert.ok(projected.fill_version > storedVersion);
  assert.equal(confirm(f, 'f-31', pv.token).fill.authorization.amount_cents, 1000);
});
