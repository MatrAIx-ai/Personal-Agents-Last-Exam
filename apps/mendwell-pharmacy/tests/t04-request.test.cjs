'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, rx } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
const req = (f, extra = {}) => f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30, ...extra });
const seed = fn => { const s = structuredClone(minimal); if (fn) fn(s); return s; };
const newNotices = (f, from) => f.data().notices.slice(from).map(n => [n.kind, n.recipient_id, n.audience]);

test('T04 T01 request at an open store → reviewed 2 hours later → ready, amount due fixed, fills unchanged until collection', () => {
  const f = fixture({ seed: seed() });
  const out = req(f);
  assert.equal(out.status, 'committed');
  assert.deepEqual([out.fill.state, out.fill.review_due_at, out.fill.claim, out.fill.amount_due_cents], ['requested', '2026-11-30T11:00:00-05:00', null, null]);
  assert.deepEqual(f.data().notices, []);
  f.setNow('2026-11-30T10:59:59-05:00');
  assert.equal(f.call(P + 'fills.get', { fill_id: out.fill.fill_id }).fill.state, 'requested');
  f.setNow('2026-11-30T11:00:00-05:00');
  const read = f.call(P + 'fills.get', { fill_id: out.fill.fill_id }).fill;
  assert.deepEqual([read.state, read.amount_due_cents, read.claim.result, read.ready_at, read.warning_at, read.return_at], ['ready', 1200, 'paid', '2026-11-30T11:00:00-05:00', '2026-12-07T11:00:00-05:00', '2026-12-10T11:00:00-05:00']);
  assert.equal(f.data().fills[0].state, 'requested');
  f.event({ event_id: 'e-1', at: '2026-11-30T11:30:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' } });
  const stored = f.data().fills[0];
  assert.deepEqual([stored.state, stored.ready_at, stored.fill_version], ['ready', '2026-11-30T11:00:00-05:00', 1]);
  assert.equal(f.data().prescriptions[0].fills_remaining, 5);
  assert.deepEqual(newNotices(f, 0), [['notice.fill_ready', 'p-2', 'full'], ['notice.fill_ready', 'p-4', 'full']]);
  assert.equal(f.data().notices[0].at, '2026-11-30T11:00:00-05:00');
});

test('T04 review time: open → +2 h; closed → next opening + 2 h; DST fall-back example', () => {
  const late = fixture({ seed: seed(), now: '2026-11-30T21:30:00-05:00' });
  assert.equal(req(late).fill.review_due_at, '2026-12-01T10:00:00-05:00');
  const sunday = fixture({ seed: seed(), now: '2026-12-05T18:30:00-05:00' });
  assert.equal(req(sunday).fill.review_due_at, '2026-12-06T12:00:00-05:00');
  const dst = fixture({ seed: seed(s => { s.stores[0].hours = [{ day: 0, open: '00:30', close: '03:00' }]; }), now: '2026-10-31T23:00:00-04:00' });
  assert.equal(req(dst).fill.review_due_at, '2026-11-01T01:30:00-05:00');
  const spring = fixture({ seed: seed(s => { s.stores[0].hours = [{ day: 0, open: '02:15', close: '05:00' }]; }), now: '2027-03-13T23:00:00-05:00' });
  assert.equal(req(spring).fill.review_due_at, '2027-03-14T05:00:00-04:00');
});

test('T04 fills.request check order: not_found, not_authorized, superseded, expired, no fills, duplicate, quantity', () => {
  const f = fixture({ seed: seed() });
  assert.equal(req(f, { rx_id: 'rx-9' }).status, 'not_found');
  assert.equal(req(f, { store_id: 'st-9' }).status, 'not_found');
  const unrelated = seed(s => { s.prescriptions.push(rx('rx-31', { patient_id: 'p-1', fills_remaining: 0 })); });
  assert.equal(req(fixture({ seed: unrelated }), { rx_id: 'rx-31', quantity: 7 }).status, 'not_authorized');
  const exhaustedSuperseded = seed(s => {
    s.prescriptions.push(rx('rx-2', { written_on: '2026-11-01', received_at: '2026-11-01T09:00:00-05:00' }));
    Object.assign(s.prescriptions[0], { state: 'superseded', superseded_by: 'rx-2', superseded_at: '2026-11-01T09:00:00-05:00', fills_remaining: 0, written_on: '2025-06-01' });
  });
  assert.equal(req(fixture({ seed: exhaustedSuperseded }), { quantity: 7 }).status, 'rx_superseded');
  assert.equal(req(fixture({ seed: seed(s => { s.prescriptions[0].written_on = '2025-11-29'; s.prescriptions[0].fills_remaining = 0; s.prescriptions[0].received_at = '2025-11-29T09:00:00-05:00'; }) }), { quantity: 7 }).status, 'rx_expired');
  assert.equal(req(fixture({ seed: seed(s => { s.prescriptions[0].fills_remaining = 0; }) }), { quantity: 7 }).status, 'no_fills_remaining');
  assert.equal(req(f).status, 'committed');
  assert.equal(req(f, { quantity: 7 }).status, 'duplicate_request');
  assert.equal(req(fixture({ seed: seed() }), { quantity: 7 }).status, 'quantity_not_allowed');
});

test('T04 adjudication outcomes: paid with stock, paid without stock, each rejection in order', () => {
  const at = (fn, extra = {}) => { const f = fixture({ seed: seed(fn) }); const out = req(f, extra); f.setNow('2026-11-30T11:00:00-05:00'); return f.call(P + 'fills.get', { fill_id: out.fill.fill_id }).fill; };
  assert.deepEqual([at(null, { store_id: 'st-2' }).state, at(null, { store_id: 'st-2' }).amount_due_cents, at(null, { store_id: 'st-2' }).claim.result], ['waiting_stock', null, 'paid']);
  const rule = s => s.plans[1].rules['d-atorvastatin-40'];
  assert.equal(at(s => { rule(s).covered = false; rule(s).prior_auth_required = true; }, { quantity: 90 }).claim.reason, 'not_covered');
  assert.equal(at(s => { rule(s).prior_auth_required = true; }, { quantity: 90 }).claim.reason, 'quantity_limit');
  assert.equal(at(s => { rule(s).prior_auth_required = true; }).claim.reason, 'prior_auth_required');
  assert.equal(at(s => { s.people[3].plan_id = null; }).claim.reason, 'not_covered');
  assert.equal(at(null).claim.eligible_on, null);
});

test('T04 refill eligibility per patient and drug: another patient\'s collection does not count', () => {
  const s = baseSeed();
  s.fills = s.fills.filter(x => x.fill_id === 'f-6');
  s.claims = s.claims.filter(c => c.fill_id === 'f-6');
  s.plan_requests = [];
  const f = fixture({ seed: s });
  const out = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 });
  f.setNow('2026-11-30T11:00:00-05:00');
  const claim = f.call(P + 'fills.get', { fill_id: out.fill.fill_id }).fill.claim;
  assert.deepEqual([claim.result, claim.reason, claim.eligible_on], ['rejected', 'refill_too_soon', '2026-12-16']);
  const other = baseSeed();
  other.fills = other.fills.filter(x => x.fill_id === 'f-6');
  other.claims = other.claims.filter(c => c.fill_id === 'f-6');
  other.plan_requests = [];
  other.prescriptions.find(r => r.rx_id === 'rx-6').patient_id = 'p-1';
  other.claims[0].copay_cents = 1000; other.fills[0].amount_due_cents = 1000; other.charges[0].amount_cents = 1000;
  const g = fixture({ seed: other });
  const o2 = g.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 });
  g.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(g.call(P + 'fills.get', { fill_id: o2.fill.fill_id }).fill.claim.result, 'paid');
});

test('T04 a rejection writes notice.claim_rejected with its reason and eligible date to full recipients', () => {
  const s = baseSeed();
  s.fills = s.fills.filter(x => x.fill_id === 'f-6'); s.claims = s.claims.filter(c => c.fill_id === 'f-6'); s.plan_requests = [];
  const f = fixture({ seed: s });
  f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 });
  f.setNow('2026-11-30T12:00:00-05:00');
  f.event({ event_id: 'e-x', at: '2026-11-30T12:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' } });
  const notes = f.data().notices;
  assert.deepEqual(notes.map(n => [n.kind, n.recipient_id, n.at]), [['notice.claim_rejected', 'p-2', '2026-11-30T11:00:00-05:00'], ['notice.claim_rejected', 'p-4', '2026-11-30T11:00:00-05:00']]);
  assert.match(notes[0].body, /too soon to refill; it can be refilled from 2026-12-16\.$/);
  assert.equal(notes[0].fields.reason, 'refill_too_soon');
});
