'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { householdSeed, asActor } = require('./seeds.cjs');
const tools = require('../tools.json');
const app = require('../app.json');
const { GUARDS, EVENT_TARGETS } = require('../src/guards.cjs');
const { handleTool, OPS } = require('../src/operations.cjs');
const { makeToken, parseToken, businessArgs, findApproval, canonical } = require('../src/tokens.cjs');
const { dueTimers } = require('../src/timers.cjs');
const binding = require('../fixtures/binding.json');

const P = 'mendwell-pharmacy.';
const as = (person, now) => { const a = asActor(householdSeed(), binding, person); return fixture({ ...a, now }); };
const asP2 = now => fixture({ seed: householdSeed(), now });
const ids = list => list.map(x => x.fill_id);

test('T03 the guard table covers all 25 tools and the event table all 9 events', () => {
  assert.deepEqual(Object.keys(GUARDS).map(k => P + k).sort(), tools.map(t => t.name).sort());
  assert.deepEqual(Object.keys(EVENT_TARGETS).sort(), [...app.event_types].sort());
});

test('T03 a tool without a handler fails invalid_state only after its guard', () => {
  const f = asP2();
  const ctx = f.ctx, data = f.data();
  const handlers = { ...OPS }; delete handlers['fills.wait'];
  const call = (fillId, request_id) => { try { return handleTool(ctx, structuredClone(data), P + 'fills.wait', { request_id, expected_version: { epoch: 1, revision: 0 }, fill_id: fillId }, handlers); } catch (e) { return { status: e.code }; } };
  assert.equal(call('f-3', 'a').status, 'invalid_state');
  assert.equal(call('f-99', 'b').status, 'not_found');
  const p1 = as('p-1');
  try { handleTool(p1.ctx, p1.data(), P + 'fills.wait', { request_id: 'c', expected_version: { epoch: 1, revision: 0 }, fill_id: 'f-3' }, handlers); assert.fail('expected a denial'); } catch (e) { assert.equal(e.code, 'not_authorized'); }
});

test('T03 reads by relation: self, guardian, view, refill, fill-limited and patient-wide pickup, expired and unrelated', () => {
  const p2 = asP2();
  const all = p2.call(P + 'fills.list', {}).fills;
  assert.ok(all.every(x => x.view === 'full'));
  assert.deepEqual(ids(all).sort(), ['f-1', 'f-2', 'f-21', 'f-3', 'f-31', 'f-4', 'f-41', 'f-5', 'f-6', 'f-7', 'f-8']);
  const p1 = as('p-1');
  const mixed = p1.call(P + 'fills.list', {}).fills;
  assert.deepEqual(mixed.map(x => [x.fill_id, x.view]), [['f-21', 'logistics'], ['f-31', 'full'], ['f-41', 'full'], ['f-5', 'logistics']]);
  const logistics = p1.call(P + 'fills.get', { fill_id: 'f-5' }).fill;
  assert.deepEqual(Object.keys(logistics).sort(), ['amount_due_cents', 'approvals', 'fill_id', 'own_authorization', 'ready_at', 'return_at', 'state', 'store_id', 'view']);
  assert.equal(p1.call(P + 'fills.get', { fill_id: 'f-1' }).status, 'not_authorized');
  assert.equal(p1.call(P + 'rx.list', { patient_id: 'p-4' }).status, 'not_authorized');
  assert.equal(p1.call(P + 'rx.get', { rx_id: 'rx-5' }).status, 'not_authorized');
  assert.equal(p1.call(P + 'fills.list', { patient_id: 'p-2' }).status, 'not_authorized');
  assert.equal(p1.call(P + 'fills.list', { rx_id: 'rx-5' }).status, 'not_authorized');
  assert.deepEqual(p1.call(P + 'rx.list', {}).prescriptions.map(r => r.rx_id), ['rx-31', 'rx-41']);
  const p4 = as('p-4');
  assert.equal(p4.call(P + 'fills.get', { fill_id: 'f-31' }).status, 'not_authorized');
  assert.deepEqual(p4.call(P + 'household.list', {}).people.map(p => p.person_id), ['p-4']);
  const p3 = as('p-3');
  assert.equal(p3.call(P + 'fills.get', { fill_id: 'f-21' }).status, 'not_authorized');
  assert.deepEqual(ids(p3.call(P + 'fills.list', {}).fills), ['f-41']);
});

test('T03 view-only and pickup-only holders are denied a sample of writes and previews the authority table withholds (the denial matrix covers every tool and relation)', () => {
  const p2 = asP2();
  const write = (f, op, args) => f.call(P + op, args).status;
  assert.equal(write(p2, 'fills.wait', { fill_id: 'f-31' }), 'not_authorized');
  assert.equal(write(p2, 'fills.choose_cash.preview', { fill_id: 'f-31' }), 'not_authorized');
  assert.equal(write(p2, 'fills.request', { rx_id: 'rx-31', store_id: 'st-1', quantity: 30 }), 'not_authorized');
  assert.equal(write(p2, 'renewals.create', { rx_id: 'rx-31' }), 'not_authorized');
  const p1 = as('p-1');
  assert.equal(write(p1, 'fills.change_store', { fill_id: 'f-5', store_id: 'st-2' }), 'not_authorized');
  assert.equal(write(p1, 'fills.cancel.preview', { fill_id: 'f-5' }), 'not_authorized');
  assert.equal(write(p1, 'plan_requests.create', { fill_id: 'f-21' }), 'not_authorized');
  assert.equal(write(p1, 'grants.change.preview', { action: 'grant', patient_id: 'p-4', grantee_id: 'p-1', scope: 'view' }), 'not_authorized');
  assert.equal(write(p2, 'grants.change.preview', { action: 'grant', patient_id: 'p-1', grantee_id: 'p-4', scope: 'view' }), 'not_authorized');
  assert.equal(write(p2, 'grants.change.preview', { action: 'revoke', grant_id: 'g-1', patient_id: 'p-4' }), 'invalid_arguments');
});

test('T03 unknown IDs are not_found; reads stay within the actor\'s own records', () => {
  const p2 = asP2();
  for (const [op, args] of [['fills.get', { fill_id: 'f-99' }], ['rx.get', { rx_id: 'rx-99' }], ['rx.list', { patient_id: 'p-9' }], ['stores.list', { drug_id: 'd-none' }], ['grants.list', { patient_id: 'p-9' }], ['fills.request', { rx_id: 'rx-1', store_id: 'st-9', quantity: 30 }]]) assert.equal(p2.call(P + op, args).status, 'not_found', op);
  assert.deepEqual(p2.call(P + 'cards.list', {}).cards, [{ card_id: 'card-3', label: 'Household card', last4: '4417', exp_month: 8, exp_year: 2028 }]);
  assert.deepEqual(as('p-1').call(P + 'cards.list', {}).cards.map(c => c.card_id), ['card-1']);
  const stores = p2.call(P + 'stores.list', { drug_id: 'd-atorvastatin-40' }).stores;
  assert.deepEqual(stores.map(s => [s.store_id, s.in_stock, s.open_now]), [['st-1', true, true], ['st-2', false, true]]);
  assert.ok(p2.call(P + 'stores.list', {}).stores.every(s => s.in_stock === null));
  const rx = p2.call(P + 'rx.get', { rx_id: 'rx-1' }).prescription;
  assert.equal(rx.state, 'active');
  assert.equal(rx.expires_at, '2027-06-01T23:59:00-04:00');
  assert.ok(rx.facts.length === 2 && rx.facts.every(x => x.source.url.startsWith('https://dailymed.nlm.nih.gov/')));
});

test('T03 grants.list: patients and guardians see every grant of the patient, grantees see their own', () => {
  const p2 = asP2();
  assert.deepEqual(p2.call(P + 'grants.list', {}).grants.map(g => [g.grant_id, g.state]), [['g-1', 'active'], ['g-2', 'active'], ['g-4', 'active']]);
  const p1 = as('p-1');
  assert.deepEqual(p1.call(P + 'grants.list', {}).grants.map(g => [g.grant_id, g.state]), [['g-2', 'active'], ['g-3', 'active'], ['g-4', 'active'], ['g-5', 'expired']]);
  assert.deepEqual(p1.call(P + 'grants.list', { patient_id: 'p-4' }).grants.map(g => g.grant_id), ['g-3']);
});

test('T03 tokens: format, round trip, business arguments only, normalised instants, changes in the digest', () => {
  const f = asP2(), ctx = f.ctx, data = f.data();
  const base = { ctx, data, actor: 'p-2', action: 'cancel', kind: 'fill', subject: { id: 'f-5', patient: 'p-4' }, args: businessArgs({ fill_id: 'f-5', request_id: 'x', token: 'y' }, ['fill_id']), targetVersion: 0, changes: { a: 1 } };
  const t1 = makeToken(base);
  assert.match(t1, /^tok-cancel-fill-f-5-[0-9a-f]{32}$/);
  assert.deepEqual(parseToken(t1), { action: 'cancel', kind: 'fill', id: 'f-5' });
  assert.equal(parseToken('tok-7c1e'), null);
  assert.deepEqual(parseToken('tok-grant-patient-p_4.x:1-' + 'a'.repeat(32)), { action: 'grant', kind: 'patient', id: 'p_4.x:1' });
  assert.notEqual(makeToken({ ...base, changes: { a: 2 } }), t1);
  assert.notEqual(makeToken({ ...base, targetVersion: 1 }), t1);
  assert.notEqual(makeToken({ ...base, ctx: { ...ctx, run_id: 'other' } }), t1);
  assert.notEqual(makeToken({ ...base, subject: { id: 'f-5', patient: 'p-1' } }), t1);
  assert.deepEqual(businessArgs({ expires_at: '2026-12-01T14:00:00Z', fill_id: undefined }, ['expires_at', 'fill_id', 'scope']), { expires_at: '2026-12-01T09:00:00-05:00', fill_id: null, scope: null });
  assert.equal(canonical({ b: 1, a: [undefined, 2] }), '{"a":[null,2],"b":1}');
});

test('T03 approvals: required, invalid, the earliest usable one wins', () => {
  const data = { approvals: [] };
  const now = Date.parse('2026-11-30T09:00:00-05:00');
  assert.equal(findApproval(data, 'tok-x', 'p-2', now).error, 'confirmation_required');
  data.approvals.push({ approval_id: 'ap-1', token: 'tok-x', subject: null, confirmed_by: 'p-1', confirmed_at: '2026-11-30T08:50:00-05:00', used_at: null });
  assert.equal(findApproval(data, 'tok-x', 'p-2', now).error, 'confirmation_invalid');
  data.approvals.push({ approval_id: 'ap-2', token: 'tok-x', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-11-30T08:30:00-05:00', used_at: null });
  assert.equal(findApproval(data, 'tok-x', 'p-2', now).error, 'confirmation_invalid');
  data.approvals.push({ approval_id: 'ap-3', token: 'tok-x', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-11-30T08:40:00-05:00', used_at: null }, { approval_id: 'ap-4', token: 'tok-x', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-11-30T08:45:00-05:00', used_at: null });
  assert.equal(findApproval(data, 'tok-x', 'p-2', now).approval.approval_id, 'ap-3');
  data.approvals[2].used_at = '2026-11-30T08:41:00-05:00';
  assert.equal(findApproval(data, 'tok-x', 'p-2', now).approval.approval_id, 'ap-4');
  assert.equal(findApproval(data, 'tok-x', 'p-2', Date.parse('2026-11-30T09:15:00-05:00')).error, 'confirmation_invalid');
});

test('T03 timers: order by due time, fill ID string and kind; reads project on a copy without storing', () => {
  const f = asP2('2026-11-30T09:00:00-05:00');
  const before = JSON.stringify(f.data());
  f.setNow('2026-11-30T12:00:00-05:00');
  const due = dueTimers(f.data(), '2026-11-30T12:00:00-05:00').map(t => [t.kind, t.fill.fill_id]);
  assert.deepEqual(due, [['review', 'f-21'], ['review', 'f-41'], ['review', 'f-1']]);
  const read = f.call(P + 'fills.get', { fill_id: 'f-21' }).fill;
  assert.notEqual(read.state, 'requested');
  assert.equal(JSON.stringify(f.data()), before);
});
