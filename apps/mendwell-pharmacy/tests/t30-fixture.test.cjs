'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, UNIT_CLOCK } = require('./harness.cjs');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const sender = require('../infra/sender.cjs');
const { BRANDS, NAME_BRANDS } = require('../dev/check-fixture.cjs');
const { HISTORY } = require('../dev/generate-history.cjs');
const { toIso, rxExpiry } = require('../src/time.cjs');

const SEED = require('../fixtures/minimal.json');
const CLOCK = require('../fixtures/clock.json').initial_time;
const BINDING = require('../fixtures/binding.json');
const P = 'mendwell-pharmacy.';
const WIRE = '{"specversion":"1.0","id":"e2-n-9","source":"urn:pale:app:mendwell-pharmacy:account:mendwell-p-2","type":"org.pale.mail.notification.v1","time":"2026-12-06T08:00:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"p-2"},"source_object":{"app_id":"mendwell-pharmacy","account_id":"mendwell-p-2","object_type":"fill","object_id":"f-15"},"content":{"title":"Fill ready for pickup","body":{"format":"text/plain","text":"Fill f-15 is ready at store st-2. Amount due: $12.00."},"asset_ids":[]},"extensions":[]}}';
const wireValid = compile(require('../schemas/router-message.schema.json'), path.join(__dirname, '..', 'schemas'));
const open = () => fixture({ seed: structuredClone(SEED), now: CLOCK });
const find = (list, key, id) => list.find(r => r[key] === id);
const notice = (notice_id, kind, recipient_id, audience, subject, at, title, body, fields) => ({ notice_id, kind, recipient_id, audience, subject, at, title, body, fields });
const fill = id => ({ type: 'fill', id });

test('Fixture the unit seed of the business tests still passes the seed schema and validateSeed at the unit clock', () => {
  const unit = require('./unit-seed.json');
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(__dirname, '..', 'schemas'));
  assert.ok(seedValid(unit));
  plugin.validateSeed({ app_id: 'mendwell-pharmacy', virtual_now: UNIT_CLOCK, binding: BINDING }, unit);
  assert.equal(UNIT_CLOCK, '2026-11-30T09:00:00-05:00');
  assert.deepEqual(fixture().data(), unit);
  assert.notEqual(unit.seed_id, SEED.seed_id);
});

test('Fixture the household is the one the README describes, with the elderly parent born in 1951', () => {
  assert.deepEqual(SEED.people.map(p => [p.person_id, p.name, p.relation, p.birth_date, p.is_minor, p.guardian_ids, p.plan_id]), [
    ['p-1', 'Sam Rivera', 'spouse', '1984-03-12', false, [], 'plan-a'],
    ['p-2', 'Alex Rivera', 'self', '1986-07-04', false, [], 'plan-a'],
    ['p-3', 'Mia Rivera', 'child', '2021-01-05', true, ['p-1', 'p-2'], 'plan-a'],
    ['p-4', 'Elena Ortiz', 'parent', '1951-01-30', false, [], 'plan-b'],
  ]);
});

test('Fixture the unit seed and the test builders name no real brand, chain, insurer or card network, and reuse the fixture\'s invented catalog names', () => {
  const unit = require('./unit-seed.json');
  const texts = [JSON.stringify(unit), fs.readFileSync(path.join(__dirname, 'seeds.cjs'), 'utf8'), fs.readFileSync(path.join(__dirname, 'harness.cjs'), 'utf8')];
  assert.deepEqual(texts.filter(t => BRANDS.test(t) || NAME_BRANDS.test(t)), []);
  const names = (s, list, key) => s[list].map(r => r[key]);
  for (const [list, key] of [['stores', 'name'], ['stores', 'address'], ['prescribers', 'name'], ['plans', 'name'], ['people', 'name']]) assert.deepEqual(names(unit, list, key).filter(x => !names(SEED, list, key).includes(x)), [], list + ' ' + key);
  assert.deepEqual(unit.prescribers.map(p => p.prescriber_id + ' ' + p.name).filter(x => !SEED.prescribers.map(p => p.prescriber_id + ' ' + p.name).includes(x)), []);
});

test('Fixture the nine example events of the proposal apply in order, each with its effect and complete notices, and the restock yields the wire example', () => {
  const f = open();
  const step = (event, expected) => {
    const before = f.data().notices.length;
    assert.equal(f.event(event).status, 'committed', event.event_id);
    const added = f.data().notices.slice(before);
    assert.deepEqual(added, expected, event.event_id + ' notices');
    return added;
  };
  const ev = (n, at, operation, payload) => ({ event_id: 'ev-' + n, at, operation, payload });
  const f20 = { fill_id: 'f-20', store_id: 'st-1', state: 'claim_rejected', amount_due_cents: null, reason: 'refill_too_soon' };
  const rejected = 'The plan rejected the claim for fill f-20 of sertraline hydrochloride 50 mg for Sam Rivera: it is too soon to refill; it can be refilled from 2027-01-20.';
  step(ev(1, '2026-12-01T09:00:00-05:00', 'rx.received', { rx_id: 'rx-9', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-12-01' }), [
    notice('n-1', 'notice.claim_rejected', 'p-1', 'full', fill('f-20'), '2026-11-18T12:40:00-05:00', 'Claim rejected', rejected, f20),
    notice('n-2', 'notice.claim_rejected', 'p-2', 'full', fill('f-20'), '2026-11-18T12:40:00-05:00', 'Claim rejected', rejected, f20),
  ]);
  let d = f.data();
  const rx9 = find(d.prescriptions, 'rx_id', 'rx-9');
  assert.deepEqual([rx9.patient_id, rx9.prescriber_id, rx9.drug_id, rx9.fills_remaining, rx9.state, toIso(rxExpiry(rx9.written_on))], ['p-4', 'dr-2', 'd-atorvastatin-40', 3, 'active', '2027-12-01T23:59:00-05:00']);
  const f20Now = find(d.fills, 'fill_id', 'f-20'), f20Claim = find(d.claims, 'claim_id', f20Now.claim_id);
  assert.deepEqual([f20Now.state, f20Claim.result, f20Claim.reason, f20Claim.eligible_on, f20Now.resubmission_due_at], ['claim_rejected', 'rejected', 'refill_too_soon', '2027-01-20', null]);
  const f17 = find(d.fills, 'fill_id', 'f-17');
  assert.deepEqual([f17.state, f17.hold !== null, find(d.authorizations, 'fill_id', 'f-17').state], ['ready', true, 'live']);

  step(ev(2, '2026-12-02T11:00:00-05:00', 'renewal.replied', { renewal_id: 'rn-2', decision: 'approved', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 5, written_on: '2026-12-02' } }), [
    notice('n-3', 'notice.renewal_reply', 'p-2', 'full', { type: 'renewal', id: 'rn-2' }, '2026-12-02T11:00:00-05:00', 'Renewal reply', 'The prescriber approved renewal rn-2 of prescription rx-5 (levothyroxine sodium 50 mcg for Alex Rivera); the new prescription rx-10 replaces it.', { renewal_id: 'rn-2', rx_id: 'rx-5', decision: 'approved', new_rx_id: 'rx-10' }),
  ]);
  d = f.data();
  const old = find(d.prescriptions, 'rx_id', find(d.renewals, 'renewal_id', 'rn-2').rx_id), rx10 = find(d.prescriptions, 'rx_id', 'rx-10');
  assert.deepEqual([find(d.renewals, 'renewal_id', 'rn-2').state, old.state, old.superseded_by, rx10.patient_id, rx10.drug_id, rx10.prescriber_id, rx10.fills_remaining], ['approved', 'superseded', 'rx-10', old.patient_id, old.drug_id, old.prescriber_id, 5]);
  assert.equal(find(d.fills, 'fill_id', 'f-15').state, 'waiting_stock');

  step(ev(3, '2026-12-04T10:00:00-05:00', 'plan.decided', { plan_request_id: 'pr-12', decision: 'approved' }), [
    notice('n-4', 'notice.plan_decision', 'p-2', 'full', fill('f-16'), '2026-12-04T10:00:00-05:00', 'Plan decision', 'The plan approved the early-refill override request pr-12 for fill f-16 of metformin hydrochloride 500 mg for Alex Rivera.', { fill_id: 'f-16', store_id: 'st-1', state: 'pending_plan_decision', amount_due_cents: null, reason: 'refill_too_soon' }),
    notice('n-5', 'notice.fill_ready', 'p-2', 'full', fill('f-16'), '2026-12-04T10:00:00-05:00', 'Fill ready for pickup', 'Fill f-16 of metformin hydrochloride 500 mg for Alex Rivera is ready at Mendwell Maple Avenue (st-1). Amount due: $0.00. It returns to stock if not collected by Monday, December 14 at 10:00.', { fill_id: 'f-16', store_id: 'st-1', state: 'ready', amount_due_cents: 0 }),
  ]);
  d = f.data();
  const f16 = find(d.fills, 'fill_id', 'f-16'), resubmitted = find(d.claims, 'claim_id', f16.claim_id);
  assert.deepEqual([find(d.plan_requests, 'plan_request_id', 'pr-12').state, f16.state, f16.waived, resubmitted.attempt, resubmitted.result, resubmitted.at], ['approved', 'ready', ['refill_too_soon'], 2, 'paid', '2026-12-04T10:00:00-05:00']);

  const setBefore = find(f.data().people, 'person_id', 'p-4').grant_set_version;
  step(ev(4, '2026-12-04T12:00:00-05:00', 'grant.changed', { grant_id: 'g-3', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'pickup', fill_id: 'f-15', expires_at: null, status: 'active' }), []);
  d = f.data();
  const g3 = find(d.grants, 'grant_id', 'g-3');
  assert.deepEqual([g3.scope, g3.fill_id, g3.status, g3.created_at, find(d.people, 'person_id', 'p-4').grant_set_version], ['pickup', 'f-15', 'active', '2026-12-04T12:00:00-05:00', setBefore + 1]);
  assert.equal(f.call(P + 'fills.get', { fill_id: 'f-15' }).fill.view, 'logistics');

  const waiting = { fill_id: 'f-15', store_id: 'st-2', state: 'waiting_stock', amount_due_cents: null };
  step(ev(5, '2026-12-05T09:00:00-05:00', 'fill.hold_placed', { fill_id: 'f-15', note: 'Interaction flag: confirm with the prescriber' }), [
    notice('n-6', 'notice.held', 'p-4', 'full', fill('f-15'), '2026-12-05T09:00:00-05:00', 'Fill on hold', 'Fill f-15 of atorvastatin calcium 40 mg for Elena Ortiz is on hold: Interaction flag: confirm with the prescriber', waiting),
  ]);
  assert.deepEqual([find(f.data().fills, 'fill_id', 'f-15').state, find(f.data().fills, 'fill_id', 'f-15').hold.note], ['waiting_stock', 'Interaction flag: confirm with the prescriber']);
  step(ev(6, '2026-12-05T13:00:00-05:00', 'fill.hold_released', { fill_id: 'f-15', note: 'Prescriber confirmed the dose' }), [
    notice('n-7', 'notice.released', 'p-4', 'full', fill('f-15'), '2026-12-05T13:00:00-05:00', 'Hold released', 'The hold on fill f-15 of atorvastatin calcium 40 mg for Elena Ortiz was released: Prescriber confirmed the dose', waiting),
  ]);
  assert.deepEqual([find(f.data().fills, 'fill_id', 'f-15').state, find(f.data().fills, 'fill_id', 'f-15').hold], ['waiting_stock', null]);

  const ready = step(ev(7, '2026-12-06T08:00:00-05:00', 'store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' }), [
    notice('n-8', 'notice.fill_ready', 'p-4', 'full', fill('f-15'), '2026-12-06T08:00:00-05:00', 'Fill ready for pickup', 'Fill f-15 of atorvastatin calcium 40 mg for Elena Ortiz is ready at Mendwell Harbor Street (st-2). Amount due: $12.00. It returns to stock if not collected by Wednesday, December 16 at 08:00.', { fill_id: 'f-15', store_id: 'st-2', state: 'ready', amount_due_cents: 1200 }),
    notice('n-9', 'notice.fill_ready', 'p-2', 'logistics', fill('f-15'), '2026-12-06T08:00:00-05:00', 'Fill ready for pickup', 'Fill f-15 is ready at store st-2. Amount due: $12.00.', { fill_id: 'f-15', store_id: 'st-2', amount_due_cents: 1200 }),
  ]);
  d = f.data();
  const message = sender.message({ epoch: 2, data: d }, ready[1]);
  assert.equal(JSON.stringify(message), WIRE);
  assert.ok(wireValid(message));
  assert.deepEqual([find(d.stores, 'store_id', 'st-2').stock['d-atorvastatin-40'], find(d.fills, 'fill_id', 'f-15').state, find(d.fills, 'fill_id', 'f-15').amount_due_cents], [true, 'ready', 1200]);

  const remaining = find(d.prescriptions, 'rx_id', find(d.fills, 'fill_id', 'f-15').rx_id).fills_remaining;
  step(ev(8, '2026-12-06T17:30:00-05:00', 'fill.collection_attempted', { fill_id: 'f-15', collector_id: 'p-2', card_id: 'card-3' }), []);
  d = f.data();
  const f15 = find(d.fills, 'fill_id', 'f-15'), charge = find(d.charges, 'charge_id', f15.charge_id);
  assert.deepEqual([f15.state, f15.refusals, charge.card_id, charge.payer_id, charge.method, charge.amount_cents, charge.at, find(d.prescriptions, 'rx_id', f15.rx_id).fills_remaining], ['collected', [], 'card-3', 'p-2', 'counter', 1200, '2026-12-06T17:30:00-05:00', remaining - 1]);

  step(ev(9, '2026-12-06T18:00:00-05:00', 'user.confirmed', { token: 'tok-7c1e', confirmed_by: 'p-2' }), []);
  assert.deepEqual(f.data().approvals, [{ approval_id: 'ap-1', token: 'tok-7c1e', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-12-06T18:00:00-05:00', used_at: null }]);
  assert.deepEqual(f.data().notices.slice(SEED.notices.length).map(n => n.notice_id), ['n-1', 'n-2', 'n-3', 'n-4', 'n-5', 'n-6', 'n-7', 'n-8', 'n-9']);
});

test('Fixture the account holder sees only what the grants allow, and new records continue the task-timeline counters', () => {
  const f = open();
  assert.deepEqual(f.call(P + 'household.list', {}).people.map(p => [p.person_id, p.powers]), [['p-1', ['view', 'refill', 'pickup']], ['p-2', ['self']], ['p-3', ['guardian']]]);
  assert.equal(f.call(P + 'rx.list', { patient_id: 'p-4' }).status, 'not_authorized');
  assert.equal(f.call(P + 'fills.get', { fill_id: 'f-15' }).status, 'not_authorized');
  assert.deepEqual(f.call(P + 'cards.list', {}).cards.map(c => c.card_id), ['card-2', 'card-3', 'card-4']);
  assert.deepEqual(f.call(P + 'fills.list', {}).fills.filter(x => !HISTORY.test(x.fill_id) && !['collected', 'returned_to_stock', 'cancelled'].includes(x.state)).map(x => [x.fill_id, x.state]), [['f-16', 'pending_plan_decision'], ['f-17', 'ready'], ['f-19', 'requested'], ['f-20', 'requested']]);
  const made = f.call(P + 'fills.request', { rx_id: 'rx-13', store_id: 'st-1', quantity: 1 });
  assert.equal(made.status, 'committed');
  assert.equal(made.fill.fill_id, 'f-21');
  const renewal = f.call(P + 'renewals.create', { rx_id: 'rx-14' });
  assert.equal(renewal.renewal.renewal_id, 'rn-3');
  f.setNow('2026-11-18T15:00:00-05:00');
  const before = f.data().notices.length;
  assert.equal(f.call(P + 'fills.set_collector', { fill_id: 'f-21', collector_id: 'p-2' }).status, 'committed');
  assert.deepEqual(f.data().notices.slice(before).map(n => [n.notice_id, n.kind, n.subject.id, n.recipient_id]), [['n-1', 'notice.claim_rejected', 'f-20', 'p-1'], ['n-2', 'notice.claim_rejected', 'f-20', 'p-2'], ['n-3', 'notice.fill_ready', 'f-21', 'p-1'], ['n-4', 'notice.fill_ready', 'f-21', 'p-2'], ['n-5', 'notice.fill_ready', 'f-21', 'p-3']]);
  assert.equal(find(f.data().fills, 'fill_id', 'f-20').claim_id, 'cl-28');
});
