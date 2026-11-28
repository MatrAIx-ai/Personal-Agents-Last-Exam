'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, householdSeed, asActor } = require('./seeds.cjs');
const binding = require('../fixtures/binding.json');
const tools = require('../tools.json');

const P = 'mendwell-pharmacy.';
const g1 = s => s.grants.find(g => g.grant_id === 'g-1');

function base() {
  const s = baseSeed();
  s.cards.push({ card_id: 'card-4', owner_id: 'p-4', label: 'Pension card', last4: '6610', exp_month: 5, exp_year: 2029, status: 'active' });
  s.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-7', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-25T09:00:00-05:00', closed_at: null });
  s.issued.rn = 1;
  return s;
}

const RELATIONS = {
  self: () => ({ ...asActor(base(), binding, 'p-4'), card: 'card-4' }),
  guardian: () => { const s = base(); Object.assign(s.people.find(p => p.person_id === 'p-4'), { is_minor: true, guardian_ids: ['p-2'] }); s.grants = []; return { seed: s, binding, card: 'card-3' }; },
  view: () => { const s = base(); g1(s).scope = 'view'; return { seed: s, binding, card: 'card-3' }; },
  refill: () => ({ seed: base(), binding, card: 'card-3' }),
  pickup_all: () => { const s = base(); g1(s).scope = 'pickup'; return { seed: s, binding, card: 'card-3' }; },
  pickup_fill: () => { const s = base(); Object.assign(g1(s), { scope: 'pickup', fill_id: 'f-5', created_at: '2026-11-29T10:00:00-05:00' }); return { seed: s, binding, card: 'card-3' }; },
  expired: () => { const s = base(); g1(s).expires_at = '2026-11-01T09:00:00-05:00'; return { seed: s, binding, card: 'card-3' }; },
  unrelated: () => { const s = base(); s.grants = []; return { seed: s, binding, card: 'card-3' }; },
};

const FULL = ['self', 'guardian'], VIEW = [...FULL, 'view', 'refill'], REFILL = [...FULL, 'refill'], SEE = [...VIEW, 'pickup_all', 'pickup_fill'], ANY = Object.keys(RELATIONS);
const token = kind => 'tok-' + kind + '-' + 'a'.repeat(32);
const CALLS = {
  'household.list': [ANY, () => ({})],
  'grants.list': [ANY, () => ({ patient_id: 'p-4' })],
  'cards.list': [ANY, () => ({})],
  'stores.list': [ANY, () => ({ drug_id: 'd-atorvastatin-40' })],
  'rx.list': [VIEW, () => ({ patient_id: 'p-4' })],
  'rx.get': [VIEW, () => ({ rx_id: 'rx-5' })],
  'fills.list': [VIEW, () => ({ patient_id: 'p-4' })],
  'fills.get': [SEE, () => ({ fill_id: 'f-5' })],
  'grants.change.preview': [FULL, () => ({ action: 'grant', patient_id: 'p-4', grantee_id: 'p-1', scope: 'view' })],
  'grants.change.confirm': [FULL, () => ({ action: 'grant', patient_id: 'p-4', grantee_id: 'p-1', scope: 'view', token: token('grant-patient-p-4') })],
  'fills.choose_cash.preview': [REFILL, () => ({ fill_id: 'f-3' })],
  'fills.choose_cash.confirm': [REFILL, () => ({ fill_id: 'f-3', token: token('cash-fill-f-3') })],
  'fills.prepay.preview': [SEE, c => ({ fill_id: 'f-5', card_id: c })],
  'fills.prepay.confirm': [SEE, c => ({ fill_id: 'f-5', card_id: c, token: token('prepay-fill-f-5') })],
  'fills.cancel.preview': [REFILL, () => ({ fill_id: 'f-5' })],
  'fills.cancel.confirm': [REFILL, () => ({ fill_id: 'f-5', token: token('cancel-fill-f-5') })],
  'fills.request': [REFILL, () => ({ rx_id: 'rx-7', store_id: 'st-1', quantity: 30 })],
  'fills.change_quantity': [REFILL, () => ({ fill_id: 'f-1', quantity: 90 })],
  'fills.change_store': [REFILL, () => ({ fill_id: 'f-2', store_id: 'st-1' })],
  'fills.wait': [REFILL, () => ({ fill_id: 'f-3' })],
  'fills.set_collector': [REFILL, () => ({ fill_id: 'f-5', collector_id: 'p-4' })],
  'plan_requests.create': [REFILL, () => ({ fill_id: 'f-3' })],
  'plan_requests.withdraw': [REFILL, () => ({ plan_request_id: 'pr-1' })],
  'renewals.create': [REFILL, () => ({ rx_id: 'rx-7' })],
  'renewals.withdraw': [REFILL, () => ({ renewal_id: 'rn-1' })],
};

test('Denial matrix: every tool × each relation to the patient matches the authority table', () => {
  assert.deepEqual(Object.keys(CALLS).sort(), tools.map(t => t.name.slice(P.length)).sort());
  const seen = [];
  for (const [rel, build] of Object.entries(RELATIONS)) {
    for (const [tool, [allowed, args]] of Object.entries(CALLS)) {
      const r = build();
      const f = fixture({ seed: r.seed, binding: r.binding });
      const before = JSON.stringify(f.data());
      const out = f.call(P + tool, args(r.card));
      if (allowed.includes(rel)) assert.ok(!['not_authorized', 'not_found', 'invalid_arguments'].includes(out.status), rel + ' ' + tool + ' → ' + out.status + ' ' + (out.message || ''));
      else {
        assert.equal(out.status, 'not_authorized', rel + ' ' + tool + ' → ' + out.status);
        assert.equal(JSON.stringify(f.data()), before);
      }
      seen.push(rel + ':' + tool);
    }
  }
  assert.equal(seen.length, 8 * 25);
});

test('T17 a pickup grant limited to fill A: the logistics view of A only; fill B, its preview and the prescription list → not_authorized; logistics notices for A only', () => {
  const r = RELATIONS.pickup_fill();
  const f = fixture({ seed: r.seed, binding: r.binding });
  assert.equal(f.call(P + 'fills.get', { fill_id: 'f-5' }).fill.view, 'logistics');
  assert.deepEqual(f.call(P + 'fills.list', {}).fills.map(x => [x.fill_id, x.view]), [['f-5', 'logistics']]);
  for (const [tool, args] of [['fills.get', { fill_id: 'f-1' }], ['fills.prepay.preview', { fill_id: 'f-2', card_id: 'card-3' }], ['rx.list', { patient_id: 'p-4' }], ['rx.get', { rx_id: 'rx-5' }], ['fills.list', { patient_id: 'p-4' }], ['fills.list', { rx_id: 'rx-5' }]]) assert.equal(f.call(P + tool, args).status, 'not_authorized', tool);
  const from = f.data().notices.length;
  f.setNow('2026-12-06T12:00:00-05:00');
  f.event({ event_id: 'e14b-1', at: f.ctx.virtual_now, operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-atorvastatin-40' } });
  const mine = f.data().notices.slice(from).filter(x => x.recipient_id === 'p-2');
  assert.deepEqual(mine.map(x => [x.kind, x.subject.id, x.audience]), [['notice.return_warning', 'f-5', 'logistics']]);
  assert.deepEqual(mine[0].fields, { fill_id: 'f-5', store_id: 'st-1', amount_due_cents: 1200 });
  assert.ok(f.data().notices.slice(from).some(x => x.subject.id === 'f-2' && x.recipient_id === 'p-4'));
});

const EVENTS = {
  'rx.received': [{ rx_id: 'rx-90', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-11-30' }, ['patient_id', 'prescriber_id', 'drug_id']],
  'renewal.replied': [{ renewal_id: 'rn-1', decision: 'denied' }, ['renewal_id']],
  'plan.decided': [{ plan_request_id: 'pr-1', decision: 'denied' }, ['plan_request_id']],
  'grant.changed': [{ grant_id: 'g-90', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: 'f-5', expires_at: null, status: 'active' }, ['patient_id', 'grantor_id', 'grantee_id', 'fill_id']],
  'fill.hold_placed': [{ fill_id: 'f-5', note: 'Flag' }, ['fill_id']],
  'fill.hold_released': [{ fill_id: 'f-5', note: 'Done' }, ['fill_id']],
  'store.restocked': [{ store_id: 'st-2', drug_id: 'd-atorvastatin-40' }, ['store_id', 'drug_id']],
  'fill.collection_attempted': [{ fill_id: 'f-5', collector_id: 'p-4', card_id: 'card-4' }, ['fill_id']],
  'user.confirmed': [{ token: 'tok-7c1e', confirmed_by: 'p-2' }, ['confirmed_by']],
};

test('Event target matrix: every event with each unknown target → invalid_event and nothing stored; the valid base payload commits', () => {
  let k = 0;
  for (const [operation, [payload, targets]] of Object.entries(EVENTS)) {
    for (const key of targets) {
      const f = fixture({ seed: base() });
      const before = JSON.stringify(f.data());
      const out = f.event({ event_id: 'e14b-u' + (++k), at: f.ctx.virtual_now, operation, payload: { ...payload, [key]: 'zz-9' } });
      assert.equal(out.status, 'invalid_event', operation + ' ' + key);
      assert.equal(JSON.stringify(f.data()), before);
    }
    const f = fixture({ seed: base() });
    assert.equal(f.event({ event_id: 'e14b-v' + (++k), at: f.ctx.virtual_now, operation, payload }).status, 'committed', operation);
  }
  assert.equal(Object.keys(EVENTS).length, 9);
});

test('fill.collection_attempted: an unknown collector or card at the counter is a refusal, not invalid_event; a held fill answers on_hold first', () => {
  const f = fixture({ seed: base() });
  const at = f.ctx.virtual_now;
  assert.equal(f.event({ event_id: 'e14b-c1', at, operation: 'fill.collection_attempted', payload: { fill_id: 'f-5', collector_id: 'zz-9' } }).status, 'committed');
  assert.equal(f.event({ event_id: 'e14b-c2', at, operation: 'fill.collection_attempted', payload: { fill_id: 'f-5', collector_id: 'p-4', card_id: 'zz-9' } }).status, 'committed');
  f.event({ event_id: 'e14b-c3', at, operation: 'fill.hold_placed', payload: { fill_id: 'f-5', note: 'Flag' } });
  assert.equal(f.event({ event_id: 'e14b-c4', at, operation: 'fill.collection_attempted', payload: { fill_id: 'f-5', collector_id: 'zz-9', card_id: 'zz-9' } }).status, 'committed');
  assert.deepEqual(f.data().fills.find(x => x.fill_id === 'f-5').refusals.map(r => r.reason), ['collector_not_authorized', 'payment_failed', 'on_hold']);
  const h = fixture({ seed: householdSeed() });
  assert.equal(h.event({ event_id: 'e14b-c5', at: h.ctx.virtual_now, operation: 'fill.collection_attempted', payload: { fill_id: 'f-31', collector_id: 'p-4', card_id: 'card-1' } }).status, 'committed');
  assert.equal(h.data().fills.find(x => x.fill_id === 'f-31').refusals[0].reason, 'collector_not_authorized');
});
