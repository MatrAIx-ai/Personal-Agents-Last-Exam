'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, householdSeed, asActor, requested } = require('./seeds.cjs');
const { notifyFill } = require('../src/notices.cjs');
const minimal = require('./unit-seed.json');
const binding = require('../fixtures/binding.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e9-' + (++n), at: f.ctx.virtual_now, operation, payload });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);

test('T08b an oversized store name is clipped to both text limits so catch-up still commits', () => {
  const s = structuredClone(minimal);
  s.stores[0].name = '\u{20BB7}'.repeat(10001);
  const f = fixture({ seed: s });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(ev(f, 'store.restocked', { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' }).status, 'committed');
  for (const x of f.data().notices) assert.ok(x.body.length <= 20000 && [...x.body].length <= 20000 && !/[\uD800-\uDBFF]$/.test(x.body.slice(0, -1)));
  assert.equal(stored(f, id).state, 'ready');
});

test('T08b versions run to the largest safe integer; seeds start at least 2^40 increments below it', () => {
  const st = require('../schemas/state.schema.json').properties.initial_data.properties;
  const reserve = Number.MAX_SAFE_INTEGER - 2 ** 40;
  assert.equal(st.fills.items.properties.fill_version.maximum, reserve);
  assert.equal(st.grants.items.properties.grant_version.maximum, reserve);
  assert.equal(st.people.items.properties.grant_set_version.maximum, reserve);
  assert.equal(require('../schemas/seed.schema.json').properties.fills.items.properties.fill_version.maximum, Number.MAX_SAFE_INTEGER);
  const s = baseSeed();
  s.fills.find(x => x.fill_id === 'f-5').fill_version = reserve;
  const f = fixture({ seed: s, now: '2026-12-06T12:00:00-05:00' });
  assert.equal(ev(f, 'store.restocked', { store_id: 'st-1', drug_id: 'd-amoxicillin-250-5' }).status, 'committed');
  assert.equal(stored(f, 'f-5').fill_version, reserve + 1);
  const { bump, newStep, PROJECTION } = require('../src/util.cjs');
  const d = { fills: [] }, rec = { fill_id: 'f-x', fill_version: Number.MAX_SAFE_INTEGER };
  newStep(d);
  assert.throws(() => bump(d, rec), e => e.code === 'invalid_state');
  d[PROJECTION] = true;
  assert.doesNotThrow(() => bump(d, rec));
  assert.equal(rec.fill_version, Number.MAX_SAFE_INTEGER);
});

test('T08b validation never depends on whether the clock is in range; timers after 2199 simply never run', () => {
  const v = require('../src/model.cjs').validateSeed;
  const ctx = now => ({ app_id: 'mendwell-pharmacy', run_id: 'u', role: 'agent', virtual_now: now, binding: require('../fixtures/binding.json') });
  assert.doesNotThrow(() => v(ctx('2300-01-01T00:00:00-05:00'), baseSeed()));
  const s = structuredClone(require('./unit-seed.json'));
  const f = fixture({ seed: s, now: '2199-12-31T16:00:00-05:00' });
  assert.equal(f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).status, 'rx_expired');
  ev(f, 'rx.received', { rx_id: 'rx-9', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2199-12-31' });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-9', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  f.setNow('2199-12-31T18:00:00-05:00');
  assert.equal(ev(f, 'store.restocked', { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' }).status, 'committed');
  assert.deepEqual([stored(f, id).state, stored(f, id).return_due_at], ['ready', '2200-01-10T18:00:00-05:00']);
  f.setNow('2200-01-10T18:00:00-05:00');
  assert.equal(f.call(P + 'fills.list', {}).status, 'invalid_state');
});

test('T08b the App supports clocks from 2000 to 2199 and dates up to 2200', () => {
  const f = fixture({ seed: baseSeed() });
  f.setNow('9999-12-30T23:00:00-05:00');
  assert.equal(f.call(P + 'fills.list', {}).status, 'invalid_state');
  assert.equal(ev(f, 'store.restocked', { store_id: 'st-1', drug_id: 'd-amoxicillin-250-5' }).status, 'invalid_event');
  const t = require('../src/time.cjs');
  assert.equal(t.validDate('2101-01-24'), true);
  assert.equal(t.validDate('2201-01-01'), true);
  assert.equal(t.validDate('2202-01-01'), false);
  assert.equal(t.clockInRange('2199-12-31T23:59:59-05:00'), true);
  assert.equal(t.clockInRange('2200-01-01T00:00:00-05:00'), false);
});

test('T08b held remainders and prescription dates stay within what timers and formats allow', () => {
  const s = baseSeed();
  const f1 = s.fills.find(x => x.fill_id === 'f-1');
  Object.assign(f1, { review_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T08:40:00-05:00', remaining: { review_ms: 9000000000000000 }, stored_decision: null } });
  assert.throws(() => fixture({ seed: s }), e => e.code === 'invalid_seed' && /more time left than the timer allows/.test(e.message));
  const f = fixture({ seed: structuredClone(minimal) });
  const rx = extra => ({ rx_id: 'rx-9', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-11-30', ...extra });
  assert.equal(ev(f, 'rx.received', rx({ written_on: '9999-01-01' })).status, 'invalid_event');
  assert.equal(ev(f, 'rx.received', rx({ written_on: '2026-12-01' })).status, 'invalid_event');
  assert.equal(ev(f, 'rx.received', rx()).status, 'committed');
  assert.equal(f.call(P + 'rx.get', { rx_id: 'rx-9' }).status, 'ok');
});

test('T08b pickup-only notices carry store, fill and amount and never the refusal reason', () => {
  const s = householdSeed();
  const data = structuredClone(s);
  const f5 = data.fills.find(x => x.fill_id === 'f-5');
  notifyFill(data, 'notice.refused', f5, '2026-11-30T09:00:00-05:00', { reason: 'on_hold' });
  notifyFill(data, 'notice.returned', f5, '2026-11-30T09:00:00-05:00', { reversed: true });
  const pickup = data.notices.filter(x => x.audience === 'logistics');
  assert.deepEqual(pickup.map(x => x.body), ['Collection of fill f-5 at store st-1 was refused. Amount due: $12.00.', 'Fill f-5 was returned to stock at store st-1. Amount due: $12.00.']);
  assert.ok(pickup.every(x => !('reason' in x.fields)));
  assert.ok(data.notices.filter(x => x.audience === 'full' && x.kind === 'notice.refused').every(x => x.fields.reason === 'on_hold'));
});

test('T08b an unchanged quantity does not bump the version; a seeded pending renewal answers duplicate_request', () => {
  const f = fixture({ seed: structuredClone(minimal) });
  const id = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  const v = stored(f, id).fill_version;
  f.call(P + 'fills.change_quantity', { fill_id: id, quantity: 30 });
  assert.equal(stored(f, id).fill_version, v);
  const s = baseSeed();
  s.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-1', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null });
  s.issued.rn = 1;
  assert.equal(fixture({ seed: s }).call(P + 'renewals.create', { rx_id: 'rx-1' }).status, 'duplicate_request');
});

test('T08b combined list filters resolve every ID before checking authority', () => {
  const a = asActor(householdSeed(), binding, 'p-1');
  const f = fixture(a);
  assert.equal(f.call(P + 'fills.list', { patient_id: 'p-4', rx_id: 'rx-99' }).status, 'not_found');
  assert.equal(f.call(P + 'fills.list', { patient_id: 'p-4', rx_id: 'rx-5' }).status, 'not_authorized');
});

test('T08b a denied call after catch-up leaves the version where it was', () => {
  const f = fixture({ seed: baseSeed() });
  f.setNow('2026-12-10T09:00:00-05:00');
  const before = f.call(P + 'fills.list', {}).version;
  assert.equal(f.call(P + 'fills.wait', { fill_id: 'f-5' }).status, 'invalid_state');
  assert.deepEqual(f.call(P + 'fills.list', {}).version, before);
});

test('T08b supersession of a cash-funded waiting fill cancels it and keeps its rejected claim', () => {
  const s = baseSeed();
  const c = s.fills.find(x => x.fill_id === 'f-3');
  Object.assign(c, { state: 'waiting_stock', store_id: 'st-2', cash: { price_cents: 2400 } });
  c.timeline.push({ state: 'waiting_stock', at: '2026-11-28T13:00:00-05:00' });
  s.renewals.push({ renewal_id: 'rn-3', rx_id: 'rx-3', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null });
  s.issued.rn = 3;
  const f = fixture({ seed: s });
  ev(f, 'renewal.replied', { renewal_id: 'rn-3', decision: 'approved', rx: { rx_id: 'rx-33', quantity: 30, fills_authorized: 5, written_on: '2026-11-30' } });
  const d = f.data();
  assert.deepEqual([stored(f, 'f-3').state, stored(f, 'f-3').cancellation.reason, d.claims.find(x => x.claim_id === 'cl-2').result, d.claims.find(x => x.claim_id === 'cl-2').reversed_at], ['cancelled', 'rx_superseded', 'rejected', null]);
});
