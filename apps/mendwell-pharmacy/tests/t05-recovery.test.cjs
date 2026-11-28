'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, withCollected } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
const base = (fn, collected = true) => { const s = structuredClone(minimal); if (collected) withCollected(s, 'rx-1', '2026-11-10T15:00:00-05:00'); if (fn) fn(s); return s; };
function reviewed(fn, args = {}, collected = true) {
  const f = fixture({ seed: base(fn, collected) });
  const o = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30, ...args });
  f.setNow('2026-11-30T11:00:00-05:00');
  return { f, id: o.fill.fill_id };
}
const get = (f, id) => f.call(P + 'fills.get', { fill_id: id }).fill;
const ev = (f, operation, payload) => f.event({ event_id: 'e-' + Math.random().toString(36).slice(2), at: f.ctx.virtual_now, operation, payload });
const kinds = (f, from) => f.data().notices.slice(from).map(n => n.kind + ':' + n.recipient_id);
const pa = s => {
  s.plans[1].rules['d-atorvastatin-40'].prior_auth_required = true;
  const hist = s.fills.find(x => x.fill_id === 'f-c1');
  if (!hist) return;
  const price = s.cash_prices['d-atorvastatin-40'][String(hist.quantity)];
  Object.assign(s.claims.find(c => c.claim_id === 'cl-f-c1'), { result: 'rejected', reason: 'prior_auth_required', copay_cents: null });
  Object.assign(hist, { cash: { price_cents: price }, amount_due_cents: price });
  s.charges.find(c => c.charge_id === 'ch-f-c1').amount_cents = price;
};

test('T05 wait: resubmission at 00:00 local on the eligible date, consumed when it runs, then ready', () => {
  const { f, id } = reviewed();
  const w = f.call(P + 'fills.wait', { fill_id: id });
  assert.deepEqual([w.fill.state, w.fill.resubmission_due_at, w.fill.claim.eligible_on], ['claim_rejected', '2026-12-05T00:00:00-05:00', '2026-12-05']);
  assert.equal(f.call(P + 'fills.wait', { fill_id: id }).status, 'invalid_state');
  assert.equal(f.data().fills.find(x => x.fill_id === id).resubmission_due_at, '2026-12-05T00:00:00-05:00');
  f.setNow('2026-12-04T23:59:59-05:00');
  assert.equal(get(f, id).state, 'claim_rejected');
  f.setNow('2026-12-05T00:00:00-05:00');
  const from = f.data().notices.length;
  ev(f, 'store.restocked', { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' });
  const stored = f.data().fills.find(x => x.fill_id === id);
  assert.deepEqual([stored.state, stored.resubmission_due_at, stored.ready_at, f.data().claims.filter(c => c.fill_id === id).length], ['ready', null, '2026-12-05T00:00:00-05:00', 2]);
  assert.deepEqual(kinds(f, from), ['notice.fill_ready:p-2', 'notice.fill_ready:p-4']);
});

test('T05 a wait already due runs once in the same write, after fills.wait', () => {
  const { f, id } = reviewed();
  f.setNow('2026-12-06T10:00:00-05:00');
  const w = f.call(P + 'fills.wait', { fill_id: id });
  assert.deepEqual([w.fill.state, w.fill.resubmission_due_at, w.fill.claim.attempt], ['ready', null, 2]);
  assert.equal(f.data().fills.find(x => x.fill_id === id).fill_version, 3);
});

test('T05 the three outcomes; rejected again → no further automatic attempt, a new wait is allowed', () => {
  const waiting = reviewed(null, { store_id: 'st-2' });
  waiting.f.setNow('2026-12-06T10:00:00-05:00');
  assert.equal(waiting.f.call(P + 'fills.wait', { fill_id: waiting.id }).fill.state, 'waiting_stock');
  const s = baseSeed();
  const f = fixture({ seed: s });
  f.call(P + 'fills.wait', { fill_id: 'f-3' });
  f.setNow('2026-12-05T08:00:00-05:00');
  let fill = get(f, 'f-3');
  assert.deepEqual([fill.state, fill.claim.attempt, fill.claim.eligible_on, fill.resubmission_due_at], ['claim_rejected', 2, '2026-12-16', null]);
  f.setNow('2026-12-17T08:00:00-05:00');
  assert.equal(get(f, 'f-3').claim.attempt, 2);
  const again = f.call(P + 'fills.wait', { fill_id: 'f-3' });
  assert.deepEqual([again.fill.state, again.fill.claim.attempt], ['ready', 3]);
});

test('T05 choosing cash first clears the scheduled resubmission', () => {
  const { f, id } = reviewed();
  f.call(P + 'fills.wait', { fill_id: id });
  const p = f.call(P + 'fills.choose_cash.preview', { fill_id: id });
  assert.deepEqual(p.preview.changes, { price_cents: 2400, store_id: 'st-1', resulting_state: 'ready', cleared_resubmission: { due_at: '2026-12-05T00:00:00-05:00' } });
  assert.match(p.preview.token, new RegExp('^tok-cash-fill-' + id + '-[0-9a-f]{32}$'));
  assert.equal(p.preview.required_confirmer, undefined);
  const c = f.call(P + 'fills.choose_cash.confirm', { fill_id: id, token: p.preview.token });
  assert.deepEqual([c.fill.state, c.fill.amount_due_cents, c.fill.cash, c.fill.resubmission_due_at, c.fill.claim.result], ['ready', 2400, { price_cents: 2400 }, null, 'rejected']);
  f.setNow('2026-12-05T09:00:00-05:00');
  assert.equal(get(f, id).claim.attempt, 1);
});

test('T05 clearing: wait → plan request → withdrawal → the original due time passes with no resubmission', () => {
  const { f, id } = reviewed();
  f.call(P + 'fills.wait', { fill_id: id });
  const pr = f.call(P + 'plan_requests.create', { fill_id: id }).plan_request;
  assert.equal(get(f, id).resubmission_due_at, null);
  f.call(P + 'plan_requests.withdraw', { plan_request_id: pr.plan_request_id });
  f.setNow('2026-12-06T09:00:00-05:00');
  const fill = get(f, id);
  assert.deepEqual([fill.state, fill.claim.attempt, fill.resubmission_due_at, fill.plan_request.state], ['claim_rejected', 1, null, 'withdrawn']);
});

test('T06 an early-refill override approved → ready; notices plan_decision then fill_ready', () => {
  const { f, id } = reviewed();
  const pr = f.call(P + 'plan_requests.create', { fill_id: id, note: 'Leaving on a trip' });
  assert.deepEqual([pr.plan_request.state, pr.plan_request.reason, get(f, id).state], ['pending', 'refill_too_soon', 'pending_plan_decision']);
  assert.equal(f.call(P + 'plan_requests.create', { fill_id: id }).status, 'request_pending');
  f.setNow('2026-11-30T15:00:00-05:00');
  const from = f.data().notices.length;
  ev(f, 'plan.decided', { plan_request_id: pr.plan_request.plan_request_id, decision: 'approved' });
  const fill = get(f, id);
  assert.deepEqual([fill.state, fill.claim.result, fill.claim.waived, fill.plan_request.state], ['ready', 'paid', ['refill_too_soon'], 'approved']);
  assert.deepEqual(kinds(f, from), ['notice.plan_decision:p-2', 'notice.plan_decision:p-4', 'notice.fill_ready:p-2', 'notice.fill_ready:p-4']);
  const late = ev(f, 'plan.decided', { plan_request_id: pr.plan_request.plan_request_id, decision: 'denied' });
  assert.equal(late.status, 'committed');
  assert.equal(get(f, id).state, 'ready');
  assert.equal(ev(f, 'plan.decided', { plan_request_id: 'pr-99', decision: 'denied' }).status, 'invalid_event');
});

test('T06 prior authorization approved → resubmission rejected refill_too_soon → wait → resubmitted without prior_auth_required → ready', () => {
  const { f, id } = reviewed(pa);
  assert.equal(get(f, id).claim.reason, 'prior_auth_required');
  const pr = f.call(P + 'plan_requests.create', { fill_id: id }).plan_request;
  ev(f, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: 'approved' });
  let fill = get(f, id);
  assert.deepEqual([fill.state, fill.claim.reason, fill.claim.waived, fill.claim.attempt], ['claim_rejected', 'refill_too_soon', ['prior_auth_required'], 2]);
  f.call(P + 'fills.wait', { fill_id: id });
  f.setNow('2026-12-05T09:00:00-05:00');
  fill = get(f, id);
  assert.deepEqual([fill.state, fill.claim.result, fill.claim.attempt], ['ready', 'paid', 3]);
});

test('T07 prior authorization denied → claim_rejected → cash → ready at the cash price', () => {
  const { f, id } = reviewed(pa, {}, false);
  const pr = f.call(P + 'plan_requests.create', { fill_id: id }).plan_request;
  const from = f.data().notices.length;
  ev(f, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: 'denied' });
  assert.deepEqual(kinds(f, from), ['notice.plan_decision:p-2', 'notice.plan_decision:p-4']);
  assert.deepEqual([get(f, id).state, get(f, id).plan_request.state], ['claim_rejected', 'denied']);
  const p = f.call(P + 'fills.choose_cash.preview', { fill_id: id });
  const c = f.call(P + 'fills.choose_cash.confirm', { fill_id: id, token: p.preview.token });
  assert.deepEqual([c.fill.state, c.fill.amount_due_cents], ['ready', 2400]);
});

test('T08 not_covered: plan request, wait and quantity change → invalid_state; cash succeeds', () => {
  const { f, id } = reviewed(s => { s.plans[1].rules['d-atorvastatin-40'].covered = false; }, {}, false);
  assert.equal(get(f, id).claim.reason, 'not_covered');
  assert.equal(f.call(P + 'plan_requests.create', { fill_id: id }).status, 'invalid_state');
  assert.equal(f.call(P + 'fills.wait', { fill_id: id }).status, 'invalid_state');
  assert.equal(f.call(P + 'fills.change_quantity', { fill_id: id, quantity: 90 }).status, 'invalid_state');
  const p = f.call(P + 'fills.choose_cash.preview', { fill_id: id });
  assert.equal(f.call(P + 'fills.choose_cash.confirm', { fill_id: id, token: p.preview.token }).fill.state, 'ready');
});

test('T09 quantity_limit → allowed quantity → paid; disallowed → quantity_not_allowed; pending → request_pending; change in requested', () => {
  const { f, id } = reviewed(null, { quantity: 90 }, false);
  assert.equal(get(f, id).claim.reason, 'quantity_limit');
  assert.equal(f.call(P + 'fills.change_quantity', { fill_id: id, quantity: 45 }).status, 'quantity_not_allowed');
  const c = f.call(P + 'fills.change_quantity', { fill_id: id, quantity: 30 });
  assert.deepEqual([c.fill.state, c.fill.quantity, c.fill.claim.attempt, c.fill.amount_due_cents], ['ready', 30, 2, 1200]);
  const r = reviewed();
  r.f.call(P + 'plan_requests.create', { fill_id: r.id });
  assert.equal(r.f.call(P + 'fills.change_quantity', { fill_id: r.id, quantity: 90 }).status, 'request_pending');
  const g = fixture({ seed: base(null, false) });
  const o = g.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 });
  const changed = g.call(P + 'fills.change_quantity', { fill_id: o.fill.fill_id, quantity: 90 });
  assert.deepEqual([changed.fill.state, changed.fill.quantity, changed.fill.review_due_at, changed.fill.claim], ['requested', 90, '2026-11-30T11:00:00-05:00', null]);
  g.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(get(g, o.fill.fill_id).claim.reason, 'quantity_limit');
});

test('T11 store change in each allowed state, with and without stock at the target', () => {
  const g = fixture({ seed: base(null, false) });
  const o = g.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 });
  const moved = g.call(P + 'fills.change_store', { fill_id: o.fill.fill_id, store_id: 'st-2' });
  assert.deepEqual([moved.fill.state, moved.fill.store_id, moved.fill.review_due_at], ['requested', 'st-2', '2026-11-30T11:00:00-05:00']);
  assert.equal(g.call(P + 'fills.change_store', { fill_id: o.fill.fill_id, store_id: 'st-2' }).status, 'invalid_state');
  assert.equal(g.call(P + 'fills.change_store', { fill_id: o.fill.fill_id, store_id: 'st-9' }).status, 'not_found');
  g.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(get(g, o.fill.fill_id).state, 'waiting_stock');
  const from = g.data().notices.length;
  const ready = g.call(P + 'fills.change_store', { fill_id: o.fill.fill_id, store_id: 'st-1' });
  assert.deepEqual([ready.fill.state, ready.fill.claim.result, ready.fill.store_id], ['ready', 'paid', 'st-1']);
  assert.deepEqual(kinds(g, from), ['notice.fill_ready:p-2', 'notice.fill_ready:p-4']);
  assert.equal(g.call(P + 'fills.change_store', { fill_id: o.fill.fill_id, store_id: 'st-2' }).status, 'invalid_state');
  const w = reviewed(null, { store_id: 'st-2' }, false);
  assert.equal(get(w.f, w.id).state, 'waiting_stock');
  const s2 = base(s => { s.stores.push({ store_id: 'st-3', name: 'Mendwell Third', address: '3 Third Street', hours: s.stores[0].hours, stock: {} }); }, false);
  const x = fixture({ seed: s2 });
  const xo = x.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-2', quantity: 30 });
  x.setNow('2026-11-30T11:00:00-05:00');
  assert.equal(x.call(P + 'fills.change_store', { fill_id: xo.fill.fill_id, store_id: 'st-3' }).status, 'store_unavailable');
  const rej = reviewed();
  const kept = rej.f.call(P + 'fills.change_store', { fill_id: rej.id, store_id: 'st-2' });
  assert.deepEqual([kept.fill.state, kept.fill.claim.reason, kept.fill.store_id], ['claim_rejected', 'refill_too_soon', 'st-2']);
  rej.f.call(P + 'fills.wait', { fill_id: rej.id });
  rej.f.setNow('2026-12-05T09:00:00-05:00');
  assert.equal(get(rej.f, rej.id).state, 'waiting_stock');
  const pend = reviewed();
  pend.f.call(P + 'plan_requests.create', { fill_id: pend.id });
  const pk = pend.f.call(P + 'fills.change_store', { fill_id: pend.id, store_id: 'st-2' });
  assert.deepEqual([pk.fill.state, pk.fill.plan_request.state, pk.fill.store_id], ['pending_plan_decision', 'pending', 'st-2']);
});

test('T05 cash without stock → waiting_stock passes post-write validation; a restock that changes the resulting state makes the old cash token stale at the same version', () => {
  const { f, id } = reviewed(null, { store_id: 'st-2' });
  ev(f, 'store.restocked', { store_id: 'st-1', drug_id: 'd-amoxicillin-250-5' });
  const p = f.call(P + 'fills.choose_cash.preview', { fill_id: id });
  assert.equal(p.preview.changes.resulting_state, 'waiting_stock');
  const version = f.data().fills.find(x => x.fill_id === id).fill_version;
  ev(f, 'store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' });
  assert.equal(f.data().fills.find(x => x.fill_id === id).fill_version, version);
  assert.equal(f.call(P + 'fills.choose_cash.confirm', { fill_id: id, token: p.preview.token }).status, 'stale_preview');
  const fresh = f.call(P + 'fills.choose_cash.preview', { fill_id: id });
  assert.equal(fresh.preview.changes.resulting_state, 'ready');
  const g = reviewed(null, { store_id: 'st-2' });
  const q = g.f.call(P + 'fills.choose_cash.preview', { fill_id: g.id });
  const c = g.f.call(P + 'fills.choose_cash.confirm', { fill_id: g.id, token: q.preview.token });
  assert.deepEqual([c.fill.state, c.fill.cash, c.fill.amount_due_cents, c.fill.claim.result], ['waiting_stock', { price_cents: 2400 }, null, 'rejected']);
  assert.equal(g.f.call(P + 'fills.choose_cash.preview', { fill_id: g.id }).status, 'invalid_state');
  assert.equal(g.f.call(P + 'fills.choose_cash.confirm', { fill_id: g.id, token: q.preview.token }).status, 'stale_preview');
  assert.equal(g.f.call(P + 'fills.choose_cash.preview', { fill_id: 'f-c1' }).status, 'invalid_state');
});
