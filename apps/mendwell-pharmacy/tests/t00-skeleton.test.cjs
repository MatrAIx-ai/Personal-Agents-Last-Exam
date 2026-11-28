'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const app = require('../app.json');
const { nextId, PROJECTION } = require('../src/util.cjs');

const root = path.resolve(__dirname, '..');
const P = 'mendwell-pharmacy.';
const tool = name => tools.find(t => t.name === P + name);
const outputOf = name => compile(tool(name).outputSchema, root);
const inputOf = name => compile(tool(name).inputSchema, root);
const events = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
const seedSchema = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
const core = { status: 'ok', app_id: 'mendwell-pharmacy', version: { epoch: 1, revision: 0 } };
const committed = { ...core, status: 'committed' };
const WRITES = ['grants.change.confirm', 'fills.request', 'fills.change_quantity', 'fills.change_store', 'fills.wait', 'fills.choose_cash.confirm', 'fills.set_collector', 'fills.prepay.confirm', 'fills.cancel.confirm', 'plan_requests.create', 'plan_requests.withdraw', 'renewals.create', 'renewals.withdraw'];
const READS = ['household.list', 'grants.list', 'cards.list', 'stores.list', 'rx.list', 'rx.get', 'fills.list', 'fills.get', 'grants.change.preview', 'fills.choose_cash.preview', 'fills.prepay.preview', 'fills.cancel.preview'];
const LONG = 'f_visit.1:a-' + 'x'.repeat(68);

test('T00 the plugin exports the six hooks', () => {
  for (const hook of ['validateSeed', 'records', 'objects', 'references', 'handleTool', 'applyEvent']) assert.equal(typeof plugin[hook], 'function', hook);
});

test('T00 exactly 25 prefixed tools: 12 read-only, 13 writes', () => {
  assert.equal(tools.length, 25);
  assert.deepEqual(tools.map(t => t.name).sort(), [...READS, ...WRITES].map(n => P + n).sort());
  for (const name of READS) assert.equal(tool(name).read_only, true, name);
  for (const name of WRITES) assert.equal(tool(name).read_only, false, name);
});

test('T00 exactly the 9 events of the proposal', () => {
  assert.deepEqual(app.event_types, ['rx.received', 'renewal.replied', 'plan.decided', 'grant.changed', 'fill.hold_placed', 'fill.hold_released', 'store.restocked', 'fill.collection_attempted', 'user.confirmed']);
});

test('T00 output schemas require the Core keys and every write allows duplicate', () => {
  for (const t of tools) {
    for (const key of ['status', 'app_id', 'version']) assert.ok(t.outputSchema.required.includes(key), t.name + ' ' + key);
    assert.equal(Boolean(t.outputSchema.properties.duplicate), !t.read_only, t.name);
  }
});

test('T00 nullable view fields: cleared collector, patient-wide grant, pending renewal, replayed write', () => {
  const fill = { view: 'full', fill_id: 'f-1', fill_version: 0, patient_id: 'p-4', rx_id: 'rx-1', drug_id: 'd-atorvastatin-40', quantity: 30, store_id: 'st-1', state: 'requested', amount_due_cents: null, claim: null, cash: null, authorization: null, collector_id: null, hold: null, notes: [], plan_request: null, review_due_at: '2026-11-30T11:00:00-05:00', resubmission_due_at: null, ready_at: null, warning_at: null, return_at: null, timeline: [{ state: 'requested', at: '2026-11-30T09:00:00-05:00' }], refusals: [], cancellation: null, charge: null, approvals: [] };
  assert.ok(outputOf('fills.set_collector')({ ...committed, fill }));
  assert.ok(outputOf('fills.set_collector')({ ...committed, fill, duplicate: true }));
  assert.ok(!outputOf('fills.set_collector')({ ...committed, fill, duplicate: false }));
  const grant = { grant_id: 'g-1', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'view', fill_id: null, expires_at: null, state: 'active' };
  assert.ok(outputOf('grants.change.confirm')({ ...committed, grant }));
  assert.ok(outputOf('renewals.create')({ ...committed, renewal: { renewal_id: 'rn-1', rx_id: 'rx-1', state: 'pending', new_rx_id: null } }));
  const logistics = { view: 'logistics', fill_id: 'f-1', store_id: 'st-1', state: 'ready', amount_due_cents: 1200, ready_at: '2026-11-30T11:00:00-05:00', return_at: '2026-12-10T11:00:00-05:00', own_authorization: null, approvals: [] };
  assert.ok(outputOf('fills.get')({ ...core, fill: logistics }));
  assert.ok(outputOf('fills.list')({ ...core, fills: [fill, logistics] }));
});

test('T00 ID and token patterns: punctuated 80-character subject and the spec example token', () => {
  assert.equal(LONG.length, 80);
  const token = 'tok-prepay-fill-' + LONG + '-' + 'a'.repeat(32);
  assert.ok(token.length <= 164);
  assert.ok(inputOf('fills.prepay.confirm')({ request_id: 'r1', expected_version: { epoch: 1, revision: 0 }, fill_id: LONG, card_id: 'card-3', token }));
  assert.ok(outputOf('fills.prepay.preview')({ ...core, preview: { token, required_confirmer: 'p-2', changes: { card_id: 'card-3', amount_cents: 1200 } } }));
  const confirmed = at => ({ event_id: 'e1', at: '2026-12-06T18:00:00-05:00', operation: 'user.confirmed', payload: { token: at, confirmed_by: 'p-2' } });
  assert.ok(events(confirmed(token)));
  assert.ok(events(confirmed('tok-7c1e')));
  assert.ok(!events(confirmed('tok-')));
  const f = fixture();
  const data = f.data();
  data.approvals.push({ approval_id: 'ap-1', token, subject: { action: 'prepay', kind: 'fill', id: LONG }, confirmed_by: 'p-2', confirmed_at: '2026-12-06T18:00:00-05:00', used_at: null });
  data.approvals.push({ approval_id: 'ap-2', token: 'tok-7c1e', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-12-06T18:00:00-05:00', used_at: null });
  assert.ok(seedSchema(data));
  assert.ok(!inputOf('fills.get')({ fill_id: 'x'.repeat(81) }));
});

test('T00 grant-change inputs are flat objects with no root combinator; the handler checks the variant', () => {
  for (const t of tools) for (const k of ['oneOf', 'anyOf', 'allOf']) assert.ok(!(k in t.inputSchema), t.name + ' root ' + k);
  const v = inputOf('grants.change.preview');
  assert.ok(v({ action: 'grant', patient_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: 'f-1', expires_at: null }));
  assert.ok(v({ action: 'revoke', grant_id: 'g-1' }));
  assert.ok(!v({ action: 'extend', grant_id: 'g-1' }));
  assert.ok(!v({ grant_id: 'g-1' }));
  assert.ok(!v({ action: 'revoke', grant_id: 'g-1', note: 'x' }));
  const c = inputOf('grants.change.confirm');
  assert.ok(c({ request_id: 'r', expected_version: { epoch: 1, revision: 0 }, action: 'revoke', grant_id: 'g-1', token: 'tok-revoke-grant-g-1-' + 'b'.repeat(32) }));
  assert.ok(!c({ action: 'revoke', grant_id: 'g-1', token: 'tok-x' }));
});

test('T00 frozen contract snapshot: view keys and required inputs', () => {
  const keys = name => Object.keys(name).sort().join(',');
  const fillSchema = tool('fills.get').outputSchema.properties.fill.anyOf;
  assert.equal(keys(fillSchema[0].properties), 'amount_due_cents,approvals,authorization,cancellation,cash,charge,claim,collector_id,drug_id,fill_id,fill_version,hold,notes,patient_id,plan_request,quantity,ready_at,refusals,resubmission_due_at,return_at,review_due_at,rx_id,state,store_id,timeline,view,warning_at');
  assert.equal(keys(fillSchema[1].properties), 'amount_due_cents,approvals,fill_id,own_authorization,ready_at,return_at,state,store_id,view');
  assert.equal(keys(tool('rx.get').outputSchema.properties.prescription.properties), 'drug,expires_at,facts,fill_ids,fills_authorized,fills_remaining,patient_id,prescriber,quantity,renewals,rx_id,state,superseded_by,written_on');
  assert.equal(keys(tool('grants.list').outputSchema.properties.grants.items.properties), 'expires_at,fill_id,grant_id,grant_version,grantee_id,grantor_id,patient_id,scope,state');
  const required = Object.fromEntries(tools.map(t => [t.name.slice(P.length), t.inputSchema.required.filter(k => !['request_id', 'expected_version'].includes(k)).join(',')]));
  assert.deepEqual(required, {
    'household.list': '', 'grants.list': '', 'cards.list': '', 'stores.list': '', 'rx.list': '', 'rx.get': 'rx_id', 'fills.list': '', 'fills.get': 'fill_id',
    'grants.change.preview': 'action', 'grants.change.confirm': 'action,token', 'fills.choose_cash.preview': 'fill_id', 'fills.choose_cash.confirm': 'fill_id,token',
    'fills.prepay.preview': 'fill_id,card_id', 'fills.prepay.confirm': 'fill_id,card_id,token', 'fills.cancel.preview': 'fill_id', 'fills.cancel.confirm': 'fill_id,token',
    'fills.request': 'rx_id,store_id,quantity', 'fills.change_quantity': 'fill_id,quantity', 'fills.change_store': 'fill_id,store_id', 'fills.wait': 'fill_id',
    'fills.set_collector': 'fill_id,collector_id', 'plan_requests.create': 'fill_id', 'plan_requests.withdraw': 'plan_request_id', 'renewals.create': 'rx_id', 'renewals.withdraw': 'renewal_id',
  });
});

test('T00 household.list: self, guarded minors and view or refill grantors, with patient-wide powers', () => {
  const f = fixture();
  const out = f.call(P + 'household.list', {});
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.people.map(p => [p.person_id, p.relation, p.powers]), [['p-2', 'self', ['self']], ['p-3', 'child', ['guardian']], ['p-4', 'parent', ['view', 'refill']]]);
});

test('T00 store.restocked persists stock', () => {
  const f = fixture();
  const out = f.event({ event_id: 'e-restock', at: '2026-11-30T10:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-atorvastatin-40' } });
  assert.equal(out.status, 'committed');
  assert.equal(f.data().stores.find(s => s.store_id === 'st-2').stock['d-atorvastatin-40'], true);
  assert.equal(f.event({ event_id: 'e-x', at: '2026-11-30T10:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-9', drug_id: 'd-atorvastatin-40' } }).status, 'invalid_event');
});

test('T00 nextId skips taken IDs, keeps counters and stops at the cap', () => {
  const data = structuredClone(require('./unit-seed.json'));
  data.grants.push({ ...data.grants[0], grant_id: 'g-2' });
  assert.equal(nextId(data, 'g'), 'g-3');
  assert.equal(data.issued.g, 3);
  data.issued.f = 999999999;
  assert.throws(() => nextId(data, 'f'), e => e.code === 'invalid_state');
  data[PROJECTION] = true;
  assert.doesNotThrow(() => nextId(data, 'f'));
});

test('T00 an unknown operation is rejected', () => {
  const f = fixture();
  assert.equal(f.callRaw('mendwell-pharmacy.nothing.here', {}).status, 'unknown_tool');
});

test('T00 the nine approved example events and their alternate payloads validate', () => {
  const env = (operation, payload, at = '2026-12-01T09:00:00-05:00') => ({ event_id: 'ev-' + operation, at, operation, payload });
  const ok = [
    env('rx.received', { rx_id: 'rx-9', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-12-01' }),
    env('renewal.replied', { renewal_id: 'rn-2', decision: 'approved', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 5, written_on: '2026-12-02' } }),
    env('renewal.replied', { renewal_id: 'rn-2', decision: 'denied' }),
    env('plan.decided', { plan_request_id: 'pr-12', decision: 'approved' }),
    env('grant.changed', { grant_id: 'g-3', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'pickup', fill_id: 'f-15', expires_at: null, status: 'active' }),
    env('grant.changed', { grant_id: 'g-3', status: 'revoked' }),
    env('fill.hold_placed', { fill_id: 'f-15', note: 'Interaction flag: confirm with the prescriber' }),
    env('fill.hold_released', { fill_id: 'f-15', note: 'Prescriber confirmed the dose' }),
    env('store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' }),
    env('fill.collection_attempted', { fill_id: 'f-15', collector_id: 'p-2', card_id: 'card-3' }),
    env('fill.collection_attempted', { fill_id: 'f-15', collector_id: 'p-2' }),
    env('user.confirmed', { token: 'tok-7c1e', confirmed_by: 'p-2' }),
  ];
  for (const e of ok) assert.ok(events(e), e.operation + ' ' + JSON.stringify(e.payload));
  const bad = [
    env('renewal.replied', { renewal_id: 'rn-2', decision: 'approved' }),
    env('renewal.replied', { renewal_id: 'rn-2', decision: 'denied', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 5, written_on: '2026-12-02' } }),
    env('grant.changed', { grant_id: 'g-3', status: 'active' }),
    env('plan.decided', { plan_request_id: 'pr-12', decision: 'maybe' }),
    env('store.restocked', { store_id: 'st-2' }),
    env('clock.ticked', {}),
  ];
  for (const e of bad) assert.ok(!events(e), 'rejects ' + e.operation + ' ' + JSON.stringify(e.payload));
});

test('T00 cash and cancel previews carry no confirmer; grant and prepay previews require one', () => {
  const tok = 'tok-cash-fill-f-1-' + 'c'.repeat(32);
  assert.ok(outputOf('fills.choose_cash.preview')({ ...core, preview: { token: tok, changes: { price_cents: 2400, store_id: 'st-1', resulting_state: 'ready', cleared_resubmission: { due_at: '2026-12-05T00:00:00-05:00' } } } }));
  assert.ok(!outputOf('fills.choose_cash.preview')({ ...core, preview: { token: tok, required_confirmer: null, changes: { price_cents: 2400, store_id: 'st-1', resulting_state: 'ready', cleared_resubmission: null } } }));
  assert.ok(outputOf('fills.cancel.preview')({ ...core, preview: { token: tok, changes: { claim_reversal: { claim_id: 'cl-1' }, authorization_void: null, plan_request_withdrawal: null, cancelled_timers: [{ kind: 'review', due_at: '2026-11-30T11:00:00-05:00' }, { kind: 'return', remaining_ms: 1000 }] } } }));
  assert.ok(!outputOf('fills.prepay.preview')({ ...core, preview: { token: tok, required_confirmer: null, changes: { card_id: 'card-3', amount_cents: 1200 } } }));
  assert.ok(inputOf('fills.request')({ request_id: 'r', expected_version: { epoch: 1, revision: 0 }, rx_id: 'rx-1', store_id: 'st-1', quantity: 1001 }));
});
