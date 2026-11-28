'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, withCollected } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e14-' + (++n), at: f.ctx.virtual_now, operation, payload });
const ok = (f, token, by = 'p-2') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const tick = f => ok(f, 'tok-7c1e');
const notes = (f, from, id) => f.data().notices.slice(from).filter(x => id === undefined || x.subject.id === id).map(x => [x.kind, x.recipient_id, x.audience, x.at]);
const full = (kind, at) => [[kind, 'p-2', 'full', at], [kind, 'p-4', 'full', at]];
const wide = (kind, at) => [...full(kind, at), [kind, 'p-1', 'logistics', at]];
const request = (f, store = 'st-1') => f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: store, quantity: 30 }).fill.fill_id;
const T11 = '2026-11-30T11:00:00-05:00';

function make(edit = () => {}, now) {
  const s = structuredClone(minimal);
  s.grants.push({ grant_id: 'g-9', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-01T09:00:00-05:00', revoked_at: null });
  s.cards.push({ card_id: 'card-4', owner_id: 'p-4', label: 'Pension card', last4: '6610', exp_month: 5, exp_year: 2029, status: 'active' });
  s.issued.g = 9;
  edit(s);
  return fixture({ seed: s, now });
}
const pa = s => { s.plans.find(x => x.plan_id === 'plan-b').rules['d-atorvastatin-40'].prior_auth_required = true; };

test('Notices for review → ready: notice.fill_ready to full holders and the logistics entry to the pickup holder', () => {
  const f = make(), id = request(f), from = f.data().notices.length;
  f.setNow(T11);
  tick(f);
  assert.deepEqual(notes(f, from), wide('notice.fill_ready', T11));
  const [a, , c] = f.data().notices.slice(from);
  assert.deepEqual([a.subject, a.fields, c.fields], [{ type: 'fill', id }, { fill_id: id, store_id: 'st-1', state: 'ready', amount_due_cents: 1200 }, { fill_id: id, store_id: 'st-1', amount_due_cents: 1200 }]);
});

test('Notices for review → claim_rejected: notice.claim_rejected to full holders only, with the reason; review → waiting_stock: none', () => {
  const f = make(pa), from = f.data().notices.length;
  request(f);
  f.setNow(T11);
  tick(f);
  assert.deepEqual(notes(f, from), full('notice.claim_rejected', T11));
  assert.equal(f.data().notices[from].fields.reason, 'prior_auth_required');
  const g = make(), start = g.data().notices.length;
  const id = request(g, 'st-2');
  g.setNow(T11);
  tick(g);
  assert.deepEqual([g.data().fills.find(x => x.fill_id === id).state, notes(g, start)], ['waiting_stock', []]);
});

test('Notices for resubmission → ready: notice.fill_ready at the due time; resubmission → claim_rejected again: notice.claim_rejected', () => {
  const f = make(s => withCollected(s, 'rx-1', '2026-11-10T15:00:00-05:00'));
  const id = request(f);
  f.setNow(T11);
  assert.equal(f.call(P + 'fills.wait', { fill_id: id }).fill.resubmission_due_at, '2026-12-05T00:00:00-05:00');
  const from = f.data().notices.length;
  f.setNow('2026-12-05T08:00:00-05:00');
  tick(f);
  assert.deepEqual(notes(f, from, id), wide('notice.fill_ready', '2026-12-05T00:00:00-05:00'));
  const g = fixture({ seed: baseSeed() });
  g.call(P + 'fills.wait', { fill_id: 'f-3' });
  const start = g.data().notices.length;
  g.setNow('2026-12-05T08:00:00-05:00');
  tick(g);
  assert.deepEqual(notes(g, start, 'f-3'), full('notice.claim_rejected', '2026-12-05T00:00:00-05:00'));
});

test('Notices for ready by restock, by a store change and by cash; cash → waiting_stock sends none', () => {
  const f = make(), id = request(f, 'st-2');
  f.setNow('2026-11-30T12:00:00-05:00');
  let from = f.data().notices.length;
  ev(f, 'store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' });
  assert.deepEqual(notes(f, from, id), wide('notice.fill_ready', '2026-11-30T12:00:00-05:00'));
  const g = make(), gid = request(g, 'st-2');
  g.setNow('2026-11-30T12:00:00-05:00');
  from = g.data().notices.length;
  g.call(P + 'fills.change_store', { fill_id: gid, store_id: 'st-1' });
  assert.deepEqual(notes(g, from, gid), wide('notice.fill_ready', '2026-11-30T12:00:00-05:00'));
  for (const [store, expected] of [['st-1', wide('notice.fill_ready', '2026-11-30T12:00:00-05:00')], ['st-2', []]]) {
    const c = make(pa), cid = request(c, store);
    c.setNow('2026-11-30T12:00:00-05:00');
    tick(c);
    const pv = c.call(P + 'fills.choose_cash.preview', { fill_id: cid }).preview;
    const start = c.data().notices.length;
    c.call(P + 'fills.choose_cash.confirm', { fill_id: cid, token: pv.token });
    assert.deepEqual(notes(c, start, cid), expected, store);
  }
});

test('Notices for holds: notice.held, then notice.released followed by the deferred effects in order (stored decision, then stock recheck)', () => {
  const f = make(), id = request(f, 'st-2');
  f.setNow('2026-11-30T12:00:00-05:00');
  let from = f.data().notices.length;
  ev(f, 'fill.hold_placed', { fill_id: id, note: 'Interaction flag' });
  ev(f, 'store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' });
  assert.deepEqual(notes(f, from, id), full('notice.held', '2026-11-30T12:00:00-05:00'));
  f.setNow('2026-11-30T13:00:00-05:00');
  from = f.data().notices.length;
  ev(f, 'fill.hold_released', { fill_id: id, note: 'Cleared' });
  assert.deepEqual(notes(f, from, id), [...full('notice.released', '2026-11-30T13:00:00-05:00'), ...wide('notice.fill_ready', '2026-11-30T13:00:00-05:00')]);
  const g = make(pa), gid = request(g);
  g.setNow('2026-11-30T12:00:00-05:00');
  const pr = g.call(P + 'plan_requests.create', { fill_id: gid }).plan_request;
  ev(g, 'fill.hold_placed', { fill_id: gid, note: 'Interaction flag' });
  ev(g, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: 'approved' });
  from = g.data().notices.length;
  g.setNow('2026-11-30T14:00:00-05:00');
  ev(g, 'fill.hold_released', { fill_id: gid, note: 'Cleared' });
  const at = '2026-11-30T14:00:00-05:00';
  assert.deepEqual(notes(g, from, gid), [...full('notice.released', at), ...full('notice.plan_decision', at), ...wide('notice.fill_ready', at)]);
});

test('Notices for replies: plan.decided approved → plan_decision then the resubmission\'s fill_ready; denied → plan_decision only; renewal.replied → renewal_reply on the renewal', () => {
  for (const [decision, tail] of [['approved', wide('notice.fill_ready', '2026-11-30T12:00:00-05:00')], ['denied', []]]) {
    const f = make(pa), id = request(f);
    f.setNow('2026-11-30T12:00:00-05:00');
    const pr = f.call(P + 'plan_requests.create', { fill_id: id }).plan_request;
    const from = f.data().notices.length;
    ev(f, 'plan.decided', { plan_request_id: pr.plan_request_id, decision });
    assert.deepEqual(notes(f, from, id), [...full('notice.plan_decision', '2026-11-30T12:00:00-05:00'), ...tail], decision);
  }
  const g = make(s => { s.prescriptions[0].fills_remaining = 0; });
  const rn = g.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal;
  const from = g.data().notices.length;
  ev(g, 'renewal.replied', { renewal_id: rn.renewal_id, decision: 'denied' });
  assert.deepEqual(notes(g, from, rn.renewal_id), full('notice.renewal_reply', '2026-11-30T09:00:00-05:00'));
  assert.equal(g.data().notices[from].subject.type, 'renewal');
});

test('Notices for warning and return, the return followed by notice.payment_voided: the card owner\'s masked entry and the full entries', () => {
  const f = make(), id = request(f);
  f.setNow(T11);
  const pv = f.call(P + 'fills.prepay.preview', { fill_id: id, card_id: 'card-3' }).preview;
  ok(f, pv.token);
  f.call(P + 'fills.prepay.confirm', { fill_id: id, card_id: 'card-3', token: pv.token });
  const from = f.data().notices.length;
  f.setNow('2026-12-10T12:00:00-05:00');
  tick(f);
  const w = '2026-12-07T11:00:00-05:00', r = '2026-12-10T11:00:00-05:00';
  const voided = f.data().notices.slice(from).filter(x => x.kind === 'notice.payment_voided');
  assert.deepEqual(notes(f, from).filter(x => x[0] !== 'notice.payment_voided'), [...wide('notice.return_warning', w), ...wide('notice.returned', r)]);
  assert.deepEqual(voided.map(x => [x.recipient_id, x.audience, x.at]), [['p-4', 'full', r], ['p-2', 'card_owner', r]]);
  assert.deepEqual(voided[1].fields, { card_last4: '4417', amount_cents: 1200, status: 'voided' });
  assert.equal(voided[1].subject.type, 'notice');
});

test('Notices for a refused collection: notice.refused, the pickup holder without the reason; a cancellation with a live authorization: notice.payment_voided', () => {
  const f = make(), id = request(f);
  f.setNow(T11);
  tick(f);
  let from = f.data().notices.length;
  ev(f, 'fill.collection_attempted', { fill_id: id, collector_id: 'p-3' });
  assert.deepEqual(notes(f, from, id), wide('notice.refused', T11));
  assert.deepEqual(f.data().notices.slice(from).map(x => x.fields.reason), ['collector_not_authorized', 'collector_not_authorized', undefined]);
  const pv = f.call(P + 'fills.prepay.preview', { fill_id: id, card_id: 'card-3' }).preview;
  ok(f, pv.token);
  f.call(P + 'fills.prepay.confirm', { fill_id: id, card_id: 'card-3', token: pv.token });
  const cv = f.call(P + 'fills.cancel.preview', { fill_id: id }).preview;
  from = f.data().notices.length;
  f.call(P + 'fills.cancel.confirm', { fill_id: id, token: cv.token });
  assert.deepEqual(f.data().notices.slice(from).map(x => [x.kind, x.recipient_id, x.audience]), [['notice.payment_voided', 'p-4', 'full'], ['notice.payment_voided', 'p-2', 'card_owner']]);
});

test('Everything else sends no notice: request, quantity change, a wait not yet due, plan requests, renewals, collection, grant changes, cancellation without payment, expiry, supersession', () => {
  const f = make(s => withCollected(s, 'rx-1', '2026-11-10T15:00:00-05:00'));
  let from = f.data().notices.length;
  const id = request(f);
  f.call(P + 'fills.change_quantity', { fill_id: id, quantity: 90 });
  f.call(P + 'fills.change_quantity', { fill_id: id, quantity: 30 });
  assert.deepEqual(notes(f, from), []);
  f.setNow(T11);
  tick(f);
  from = f.data().notices.length;
  f.call(P + 'fills.wait', { fill_id: id });
  assert.equal(f.call(P + 'plan_requests.create', { fill_id: id }).plan_request.state, 'pending');
  const pv = f.call(P + 'grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view' }).preview;
  ok(f, pv.token);
  f.call(P + 'grants.change.confirm', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view', token: pv.token });
  ev(f, 'grant.changed', { grant_id: 'g-20', patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-4', scope: 'view', fill_id: null, expires_at: null, status: 'active' });
  const cv = f.call(P + 'fills.cancel.preview', { fill_id: id }).preview;
  f.call(P + 'fills.cancel.confirm', { fill_id: id, token: cv.token });
  assert.deepEqual(notes(f, from), []);
  const g = make(pa), gid = request(g);
  g.setNow(T11);
  const plan = g.call(P + 'plan_requests.create', { fill_id: gid }).plan_request;
  g.call(P + 'plan_requests.withdraw', { plan_request_id: plan.plan_request_id });
  const c = make(), cid = request(c);
  c.setNow(T11);
  tick(c);
  from = c.data().notices.length;
  ev(c, 'fill.collection_attempted', { fill_id: cid, collector_id: 'p-4', card_id: 'card-4' });
  assert.deepEqual([c.data().fills.find(x => x.fill_id === cid).state, notes(c, from)], ['collected', []]);
  const r = make(s => { s.prescriptions[0].fills_remaining = 0; });
  from = r.data().notices.length;
  const rn = r.call(P + 'renewals.create', { rx_id: 'rx-1' }).renewal;
  r.call(P + 'renewals.withdraw', { renewal_id: rn.renewal_id });
  assert.deepEqual(notes(r, from), []);
  const e = make(s => Object.assign(s.prescriptions[0], { written_on: '2025-11-30', received_at: '2025-11-30T09:00:00-05:00' }), '2026-11-30T09:00:00-05:00');
  const eid = request(e, 'st-2');
  e.setNow('2026-12-01T09:00:00-05:00');
  from = e.data().notices.length;
  tick(e);
  assert.deepEqual([e.data().fills.find(x => x.fill_id === eid).cancellation.reason, notes(e, from)], ['rx_expired', []]);
  const s = make(st => {
    st.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-1', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null });
    st.issued.rn = 1;
  });
  const sid = request(s, 'st-2');
  s.setNow(T11);
  tick(s);
  from = s.data().notices.length;
  ev(s, 'renewal.replied', { renewal_id: 'rn-1', decision: 'approved', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 3, written_on: '2026-11-30' } });
  assert.deepEqual([s.data().fills.find(x => x.fill_id === sid).cancellation.reason, notes(s, from, sid)], ['rx_superseded', []]);
});

test('Seeded notices are history: they stay as loaded and new entries take fresh IDs after them', () => {
  const f = make(), id = request(f);
  f.setNow(T11);
  tick(f);
  const seeded = f.data();
  const g = fixture({ seed: seeded, now: T11 });
  const history = JSON.stringify(seeded.notices);
  ev(g, 'fill.collection_attempted', { fill_id: id, collector_id: 'p-3' });
  const after = g.data().notices;
  assert.equal(JSON.stringify(after.slice(0, seeded.notices.length)), history);
  const ids = after.map(x => x.notice_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(after.slice(seeded.notices.length).every(x => x.kind === 'notice.refused'));
});
