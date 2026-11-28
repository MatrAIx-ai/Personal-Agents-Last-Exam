'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { baseSeed, householdSeed, asActor, rx, ready, claim, only, drop } = require('./seeds.cjs');
const binding = require('../fixtures/binding.json');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
let n = 0;
const ev = (f, operation, payload) => f.event({ event_id: 'e20b-' + (++n), at: f.ctx.virtual_now, operation, payload });
const ok = (f, token, by = 'p-2') => ev(f, 'user.confirmed', { token, confirmed_by: by });
const stored = (f, id) => f.data().fills.find(x => x.fill_id === id);
const card = (card_id, owner_id) => ({ card_id, owner_id, label: 'Card ' + card_id, last4: '500' + card_id.slice(-1), exp_month: 8, exp_year: 2028, status: 'active' });
const prepay = (f, fill_id, card_id, by = 'p-2') => { const pv = f.call(P + 'fills.prepay.preview', { fill_id, card_id }).preview; ok(f, pv.token, by); return f.call(P + 'fills.prepay.confirm', { fill_id, card_id, token: pv.token }); };
const grantEvent = o => ({ grant_id: 'g-30', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: null, status: 'active', ...o });

test('T20b after a same-seed reset an old cancel token does not void another card\'s authorization', () => {
  const s = baseSeed();
  s.cards.push(card('card-5', 'p-2'));
  const a = fixture({ seed: s });
  prepay(a, 'f-5', 'card-3');
  const old = a.call(P + 'fills.cancel.preview', { fill_id: 'f-5' }).preview.token;
  const b = fixture({ seed: s });
  prepay(b, 'f-5', 'card-5');
  assert.deepEqual([b.data().authorizations[0].authorization_id, stored(b, 'f-5').fill_version], [a.data().authorizations[0].authorization_id, stored(a, 'f-5').fill_version]);
  assert.equal(b.call(P + 'fills.cancel.confirm', { fill_id: 'f-5', token: old }).status, 'stale_preview');
  assert.equal(b.data().authorizations[0].state, 'live');
});

test('T20b after a same-seed reset a fill reused for another prescription or quantity does not match old grant or prepay tokens', () => {
  const s = structuredClone(minimal);
  s.prescriptions.push(rx('rx-31', { patient_id: 'p-3' }), rx('rx-32', { patient_id: 'p-3', drug_id: 'd-amoxicillin-250-5', quantity: 100, prescriber_id: 'dr-1' }));
  const args = { action: 'grant', patient_id: 'p-3', grantee_id: 'p-4', scope: 'pickup', fill_id: 'f-1' };
  const a = fixture({ seed: s });
  a.call(P + 'fills.request', { rx_id: 'rx-31', store_id: 'st-1', quantity: 30 });
  const grantToken = a.call(P + 'grants.change.preview', args).preview.token;
  const b = fixture({ seed: s });
  b.call(P + 'fills.request', { rx_id: 'rx-32', store_id: 'st-1', quantity: 100 });
  ok(b, grantToken);
  assert.equal(b.call(P + 'grants.change.confirm', { ...args, token: grantToken }).status, 'stale_preview');
  const c = fixture({ seed: s });
  c.call(P + 'fills.request', { rx_id: 'rx-31', store_id: 'st-1', quantity: 30 });
  c.setNow('2026-11-30T11:00:00-05:00');
  const prepayToken = c.call(P + 'fills.prepay.preview', { fill_id: 'f-1', card_id: 'card-3' }).preview.token;
  const d = fixture({ seed: s });
  d.call(P + 'fills.request', { rx_id: 'rx-31', store_id: 'st-1', quantity: 90 });
  d.setNow('2026-11-30T11:00:00-05:00');
  assert.deepEqual([d.call(P + 'fills.get', { fill_id: 'f-1' }).fill.amount_due_cents, d.call(P + 'fills.get', { fill_id: 'f-1' }).fill.fill_version], [c.call(P + 'fills.get', { fill_id: 'f-1' }).fill.amount_due_cents, c.call(P + 'fills.get', { fill_id: 'f-1' }).fill.fill_version]);
  ok(d, prepayToken);
  assert.equal(d.call(P + 'fills.prepay.confirm', { fill_id: 'f-1', card_id: 'card-3', token: prepayToken }).status, 'stale_preview');
  assert.equal(d.data().authorizations.length, 0);
});

test('T20b a seed whose fill records postdate a pending due time, or whose authorization ends out of order, is invalid_seed', () => {
  const reject = (edit, pattern) => { const s = baseSeed(); edit(s); assert.throws(() => fixture({ seed: s, now: '2026-12-10T09:30:00-05:00' }), pattern); };
  reject(s => {
    s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-12-10T09:00:00-05:00', ended_at: null });
    Object.assign(s.fills.find(f => f.fill_id === 'f-5'), { authorization_id: 'au-1', warning_due_at: null, warned_at: '2026-12-06T12:00:00-05:00' });
    s.issued.au = 1;
  }, /at or after its pending return due/);
  reject(s => {
    s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-7', card_id: 'card-3', amount_cents: 1200, state: 'voided', at: '2026-11-15T12:00:00-05:00', ended_at: '2026-11-14T12:00:00-05:00' });
    s.issued.au = 1;
  }, /ended before it was made|other than when the fill closed/);
  reject(s => {
    s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-7', card_id: 'card-3', amount_cents: 1200, state: 'voided', at: '2026-11-15T12:00:00-05:00', ended_at: '2026-11-16T12:00:00-05:00' });
    s.issued.au = 1;
  }, /other than when the fill closed/);
});

test('T20b once caller authority holds, a terminal fill answers invalid_state before collector eligibility or the request state', () => {
  const f = fixture({ seed: baseSeed() });
  assert.deepEqual(['p-1', 'p-9'].map(id => f.call(P + 'fills.set_collector', { fill_id: 'f-6', collector_id: id }).status), ['invalid_state', 'not_found']);
  const pv = f.call(P + 'fills.cancel.preview', { fill_id: 'f-4' }).preview;
  f.call(P + 'fills.cancel.confirm', { fill_id: 'f-4', token: pv.token });
  assert.equal(f.call(P + 'plan_requests.withdraw', { plan_request_id: 'pr-1' }).status, 'invalid_state');
});

test('T20b an expiry past the last supported time is refused by the tool and by grant.changed; the last supported instant works', () => {
  const f = fixture();
  const far = '9999-12-31T23:59:59-12:00';
  assert.equal(f.call(P + 'grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view', expires_at: far }).status, 'invalid_state');
  assert.equal(ev(f, 'grant.changed', grantEvent({ patient_id: 'p-2', grantor_id: 'p-2', scope: 'view', expires_at: far })).status, 'invalid_event');
  assert.equal(f.call(P + 'grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view', expires_at: '2199-12-31T23:59:59.999-05:00' }).status, 'ok');
});

test('T20b a pickup holder\'s refusal notice for an unmade fill states no amount', () => {
  const s = householdSeed();
  s.grants.push({ grant_id: 'g-6', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-01T09:00:00-05:00', revoked_at: null });
  s.issued.g = 6;
  const f = fixture({ seed: s });
  const from = f.data().notices.length;
  ev(f, 'fill.collection_attempted', { fill_id: 'f-1', collector_id: 'p-1' });
  const entry = f.data().notices.slice(from).find(x => x.recipient_id === 'p-1');
  assert.deepEqual([entry.audience, entry.body, entry.fields], ['logistics', 'Collection of fill f-1 at store st-1 was refused.', { fill_id: 'f-1', store_id: 'st-1', amount_due_cents: null }]);
  assert.ok(f.data().notices.every(x => !x.body.includes('null')));
});

test('T20b a pickup grant limited to fill A neither collects nor is named for fill B; a pickup-only viewer never sees another payer\'s authorization', () => {
  const s = householdSeed();
  s.prescriptions.push(rx('rx-9'));
  s.fills.push(ready('f-9', 'rx-9', '2026-11-29T10:00:00-05:00', { due: 1200 }));
  s.claims.push(claim('cl-9', 'f-9', '2026-11-29T17:00:00.000Z', 'paid'));
  s.issued.f = 41;
  const f = fixture({ seed: s });
  assert.deepEqual([f.call(P + 'fills.set_collector', { fill_id: 'f-9', collector_id: 'p-1' }).status, f.call(P + 'fills.set_collector', { fill_id: 'f-5', collector_id: 'p-1' }).status], ['not_authorized', 'committed']);
  prepay(f, 'f-5', 'card-3');
  ev(f, 'fill.collection_attempted', { fill_id: 'f-9', collector_id: 'p-1', card_id: 'card-1' });
  assert.equal(stored(f, 'f-9').refusals.at(-1).reason, 'collector_not_authorized');
  const view = asActor(f.data(), binding, 'p-1');
  const p1 = fixture({ seed: view.seed, binding: view.binding });
  const seen = p1.call(P + 'fills.get', { fill_id: 'f-5' }).fill;
  assert.deepEqual([seen.view, seen.own_authorization], ['logistics', null]);
  ev(f, 'fill.collection_attempted', { fill_id: 'f-5', collector_id: 'p-1', card_id: 'card-1' });
  assert.equal(stored(f, 'f-5').state, 'collected');
});

test('T20b a cancel token goes stale when only the fill version moves', () => {
  const f = fixture({ seed: baseSeed() });
  const pv = f.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview;
  const v = stored(f, 'f-1').fill_version;
  ev(f, 'fill.hold_placed', { fill_id: 'f-1', note: 'Flag' });
  ev(f, 'fill.hold_released', { fill_id: 'f-1', note: 'Cleared' });
  assert.equal(stored(f, 'f-1').fill_version, v + 2);
  assert.deepEqual(f.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview.changes, pv.changes);
  assert.equal(f.call(P + 'fills.cancel.confirm', { fill_id: 'f-1', token: pv.token }).status, 'stale_preview');
});

test('T20b grant.changed refuses a foreign grantor, a past expiry and a changed grantor on their own grounds', () => {
  const f = fixture();
  ev(f, 'grant.changed', grantEvent({ grant_id: 'g-2', patient_id: 'p-2', grantor_id: 'p-2', scope: 'view' }));
  for (const payload of [grantEvent({ grant_id: 'g-51', patient_id: 'p-2', grantor_id: 'p-1', grantee_id: 'p-4', scope: 'view' }), grantEvent({ grant_id: 'g-56', patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-4', scope: 'view', expires_at: '2026-11-30T08:59:00-05:00' }), grantEvent({ grant_id: 'g-2', patient_id: 'p-2', grantor_id: 'p-1', scope: 'view', expires_at: '2026-12-10T09:00:00-05:00' })]) {
    const before = JSON.stringify(f.data());
    assert.equal(ev(f, 'grant.changed', payload).status, 'invalid_event', payload.grant_id);
    assert.equal(JSON.stringify(f.data()), before);
  }
  assert.equal(ev(f, 'grant.changed', grantEvent({ grant_id: 'g-57', patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-4', scope: 'view' })).status, 'committed');
});

test('T20b collector records: a finished fill clears at grant expiry, a revoke clears only its own grant\'s records, collection and cancellation keep the record', () => {
  const s = structuredClone(minimal);
  s.prescriptions.push(rx('rx-2'));
  s.cards.push(card('card-1', 'p-1'));
  const f = fixture({ seed: s });
  const a = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  const b = f.call(P + 'fills.request', { rx_id: 'rx-2', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  ev(f, 'grant.changed', grantEvent({ grant_id: 'g-7', expires_at: '2026-12-03T12:00:00-05:00' }));
  ev(f, 'grant.changed', grantEvent({ grant_id: 'g-8', grantee_id: 'p-3' }));
  f.setNow('2026-11-30T12:00:00-05:00');
  f.call(P + 'fills.set_collector', { fill_id: a, collector_id: 'p-1' });
  f.call(P + 'fills.set_collector', { fill_id: b, collector_id: 'p-3' });
  ev(f, 'fill.collection_attempted', { fill_id: a, collector_id: 'p-1', card_id: 'card-1' });
  assert.deepEqual([stored(f, a).state, stored(f, a).collector.via_grant_id], ['collected', 'g-7']);
  ev(f, 'grant.changed', { grant_id: 'g-8', status: 'revoked' });
  assert.deepEqual([stored(f, b).collector, stored(f, a).collector.person_id], [null, 'p-1']);
  f.call(P + 'fills.set_collector', { fill_id: b, collector_id: 'p-4' });
  const pv = f.call(P + 'fills.cancel.preview', { fill_id: b }).preview;
  f.call(P + 'fills.cancel.confirm', { fill_id: b, token: pv.token });
  assert.deepEqual([stored(f, b).state, stored(f, b).collector.person_id], ['cancelled', 'p-4']);
  f.setNow('2026-12-03T12:00:00-05:00');
  const version = stored(f, a).fill_version;
  ok(f, 'tok-7c1e');
  assert.deepEqual([stored(f, a).collector, stored(f, a).fill_version, stored(f, b).collector.person_id], [null, version, 'p-4']);
});

test('T20b revoking a grant the other guardian made needs the actor\'s own confirmation; grants.list filters patient approvals by patient_id', () => {
  const f = fixture();
  ev(f, 'grant.changed', grantEvent({ grant_id: 'g-40', patient_id: 'p-3', grantor_id: 'p-1', grantee_id: 'p-4', scope: 'view' }));
  const revoke = { action: 'revoke', grant_id: 'g-40' };
  const pv = f.call(P + 'grants.change.preview', revoke).preview;
  assert.equal(pv.required_confirmer, 'p-2');
  ok(f, pv.token, 'p-1');
  assert.equal(f.call(P + 'grants.change.confirm', { ...revoke, token: pv.token }).status, 'confirmation_invalid');
  ok(f, pv.token, 'p-2');
  assert.equal(f.call(P + 'grants.change.confirm', { ...revoke, token: pv.token }).grant.state, 'revoked');
  const self = f.call(P + 'grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view' }).preview.token;
  const kid = f.call(P + 'grants.change.preview', { action: 'grant', patient_id: 'p-3', grantee_id: 'p-1', scope: 'pickup' }).preview.token;
  ok(f, self);
  ok(f, kid);
  const tokens = id => f.call(P + 'grants.list', { patient_id: id }).approvals.map(a => a.token);
  assert.deepEqual([tokens('p-2'), tokens('p-3').filter(t => t !== pv.token)], [[self], [kid]]);
});

test('T20b after a same-seed reset an Rx ID reused for another drug stales old cancel and prepay tokens even at equal copays', () => {
  const s = structuredClone(minimal);
  const amox = s.drugs.find(d => d.drug_id === 'd-amoxicillin-250-5');
  amox.quantities = [30, ...amox.quantities];
  s.cash_prices['d-amoxicillin-250-5']['30'] = 900;
  s.plans.find(x => x.plan_id === 'plan-a').rules['d-amoxicillin-250-5'].copay_cents = 1000;
  const run = drug => {
    const f = fixture({ seed: s });
    ev(f, 'rx.received', { rx_id: 'rx-9', patient_id: 'p-2', prescriber_id: 'dr-1', drug_id: drug, quantity: 30, fills_authorized: 3, written_on: '2026-11-30' });
    f.call(P + 'fills.request', { rx_id: 'rx-9', store_id: 'st-1', quantity: 30 });
    f.setNow('2026-11-30T11:00:00-05:00');
    return f;
  };
  const a = run('d-atorvastatin-40'), b = run('d-amoxicillin-250-5');
  const fa = a.call(P + 'fills.get', { fill_id: 'f-1' }).fill, fb = b.call(P + 'fills.get', { fill_id: 'f-1' }).fill;
  assert.deepEqual([fa.fill_version, fa.amount_due_cents, fa.claim.claim_id], [fb.fill_version, fb.amount_due_cents, fb.claim.claim_id]);
  const cancel = a.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview.token;
  const pay = a.call(P + 'fills.prepay.preview', { fill_id: 'f-1', card_id: 'card-3' }).preview.token;
  assert.equal(b.call(P + 'fills.cancel.confirm', { fill_id: 'f-1', token: cancel }).status, 'stale_preview');
  ok(b, pay);
  assert.equal(b.call(P + 'fills.prepay.confirm', { fill_id: 'f-1', card_id: 'card-3', token: pay }).status, 'stale_preview');
});

test('T20b an unmade fill\'s records may not postdate its prescription expiry, even with a sparse timeline', () => {
  const s = baseSeed();
  s.prescriptions.find(r => r.rx_id === 'rx-4').written_on = '2025-11-27';
  s.prescriptions.find(r => r.rx_id === 'rx-4').received_at = '2025-11-27T09:00:00-05:00';
  const f4 = s.fills.find(f => f.fill_id === 'f-4');
  f4.timeline = [{ state: 'requested', at: '2026-11-27T10:00:00-05:00' }];
  s.plan_requests[0].created_at = '2026-11-28T09:00:00-05:00';
  assert.throws(() => fixture({ seed: s }), /pending prescription expiry/);
  only(s, ['f-4']);
  s.plan_requests[0].created_at = '2026-11-27T13:00:00-05:00';
  assert.doesNotThrow(() => fixture({ seed: s }));
});

test('T20b prepaying a fill does not stale an approved revocation of a pickup grant limited to it', () => {
  const s = structuredClone(minimal);
  s.prescriptions.push(rx('rx-30', { patient_id: 'p-3' }));
  s.fills.push(ready('f-30', 'rx-30', '2026-11-29T09:00:00-05:00', { due: 1000 }));
  s.claims.push(claim('cl-30', 'f-30', '2026-11-29T16:00:00.000Z', 'paid', { copay_cents: 1000 }));
  s.grants.push({ grant_id: 'g-9', grant_version: 0, patient_id: 'p-3', grantor_id: 'p-2', grantee_id: 'p-4', scope: 'pickup', fill_id: 'f-30', expires_at: null, status: 'active', created_at: '2026-11-29T10:00:00-05:00', revoked_at: null });
  s.issued = { ...s.issued, f: 30, g: 9 };
  const f = fixture({ seed: s });
  const revoke = { action: 'revoke', grant_id: 'g-9' };
  const pv = f.call(P + 'grants.change.preview', revoke).preview;
  ok(f, pv.token);
  assert.equal(prepay(f, 'f-30', 'card-3').status, 'committed');
  assert.equal(f.call(P + 'grants.change.confirm', { ...revoke, token: pv.token }).grant.state, 'revoked');
});

test('T20b an expiry with a year before 1000 is refused as not after now, never as an invalid result', () => {
  const f = fixture();
  const old = '0999-06-01T12:00:00Z';
  assert.equal(f.call(P + 'grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view', expires_at: old }).status, 'invalid_state');
  assert.equal(ev(f, 'grant.changed', grantEvent({ patient_id: 'p-2', grantor_id: 'p-2', scope: 'view', expires_at: old })).status, 'invalid_event');
});

test('T20b the Rx, the store and requested_at each bind a fill token on their own', () => {
  const s = structuredClone(minimal);
  s.prescriptions.push(rx('rx-2'));
  s.stores.find(x => x.store_id === 'st-2').stock['d-atorvastatin-40'] = true;
  const make = (rxId, store, at) => { const f = fixture({ seed: s, now: at }); f.call(P + 'fills.request', { rx_id: rxId, store_id: store, quantity: 30 }); return f; };
  const base = make('rx-1', 'st-1', '2026-11-30T09:00:00-05:00');
  const token = base.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview;
  for (const [label, other] of [['rx', make('rx-2', 'st-1', '2026-11-30T09:00:00-05:00')], ['store', make('rx-1', 'st-2', '2026-11-30T09:00:00-05:00')]]) {
    const pv = other.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview;
    assert.deepEqual([pv.changes, stored(other, 'f-1').fill_version], [token.changes, stored(base, 'f-1').fill_version], label);
    assert.equal(other.call(P + 'fills.cancel.confirm', { fill_id: 'f-1', token: token.token }).status, 'stale_preview', label);
  }
  const late = make('rx-1', 'st-1', '2026-11-30T22:00:00-05:00'), later = make('rx-1', 'st-1', '2026-11-30T23:00:00-05:00');
  const night = late.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview;
  later.setNow('2026-11-30T23:00:00-05:00');
  assert.deepEqual([later.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview.changes, stored(later, 'f-1').review_due_at], [night.changes, '2026-12-01T10:00:00-05:00']);
  assert.equal(later.call(P + 'fills.cancel.confirm', { fill_id: 'f-1', token: night.token }).status, 'stale_preview');
});

test('T20b each new seed rule rejects on its own', () => {
  const reject = (edit, pattern) => { const s = baseSeed(); edit(s); assert.throws(() => fixture({ seed: s }), pattern); };
  const f = (s, id) => s.fills.find(x => x.fill_id === id);
  reject(s => { s.notices.push({ notice_id: 'n-1', kind: 'notice.held', recipient_id: 'p-4', audience: 'full', subject: { type: 'fill', id: 'f-1' }, at: '2026-11-30T08:45:00-05:00', title: 'Fill on hold', body: 'x', fields: { fill_id: 'f-1', store_id: 'st-1', state: 'requested', amount_due_cents: null } }); f(s, 'f-1').review_due_at = '2026-11-30T08:40:00-05:00'; f(s, 'f-1').requested_at = f(s, 'f-1').timeline[0].at = '2026-11-30T06:40:00-05:00'; s.issued.n = 1; }, /records 2026-11-30T08:45:00-05:00 at or after its pending review/);
  reject(s => { s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: '2026-11-29T14:00:00-05:00' }); f(s, 'f-5').authorization_id = 'au-1'; s.issued.au = 1; }, /end time exactly when it is captured or voided/);
  reject(s => { s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T11:00:00-05:00', ended_at: null }); f(s, 'f-5').authorization_id = 'au-1'; s.issued.au = 1; }, /made before the fill was ready/);
  reject(s => { s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-7', card_id: 'card-3', amount_cents: 1200, state: 'voided', at: '2026-11-20T13:00:00-05:00', ended_at: '2026-11-20T12:00:00-05:00' }); s.issued.au = 1; }, /ended before it was made/);
  reject(s => { s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-6', card_id: 'card-3', amount_cents: 1200, state: 'voided', at: '2026-11-21T09:00:00-05:00', ended_at: '2026-11-21T15:00:00-05:00' }); s.issued.au = 1; }, /voided on a fill that is collected/);
});

test('T20b a grant.changed update past the last supported time is invalid_event', () => {
  const f = fixture();
  ev(f, 'grant.changed', grantEvent({ grant_id: 'g-2', patient_id: 'p-2', grantor_id: 'p-2', scope: 'view' }));
  assert.equal(ev(f, 'grant.changed', grantEvent({ grant_id: 'g-2', patient_id: 'p-2', grantor_id: 'p-2', scope: 'view', expires_at: '2200-01-01T00:00:00-05:00' })).status, 'invalid_event');
});

test('T20b a fill-limited grant previewed before its fill moves still confirms after review, prepayment or a revocation preview', () => {
  const s = householdSeed();
  const f = fixture({ seed: s, now: '2026-11-30T09:45:00-05:00' });
  const args = { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'pickup', fill_id: 'f-21' };
  const pv = f.call(P + 'grants.change.preview', args).preview;
  f.setNow('2026-11-30T10:05:00-05:00');
  ok(f, pv.token);
  assert.equal(stored(f, 'f-21').state, 'ready');
  assert.equal(prepay(f, 'f-21', 'card-3').status, 'committed');
  const out = f.call(P + 'grants.change.confirm', { ...args, token: pv.token });
  assert.equal(out.grant.fill_id, 'f-21');
  const revoke = { action: 'revoke', grant_id: out.grant.grant_id };
  const rv = f.call(P + 'grants.change.preview', revoke).preview;
  ok(f, rv.token);
  ev(f, 'fill.collection_attempted', { fill_id: 'f-21', collector_id: 'p-3' });
  assert.equal(f.call(P + 'grants.change.confirm', { ...revoke, token: rv.token }).grant.state, 'revoked');
});

test('T20b after a same-seed reset an old cancel token does not cancel a fill that took another path to the same version', () => {
  const s = baseSeed();
  s.fills.find(f => f.fill_id === 'f-3').store_id = 'st-2';
  const a = fixture({ seed: s });
  ev(a, 'fill.hold_placed', { fill_id: 'f-3', note: 'Flag' });
  const old = a.call(P + 'fills.cancel.preview', { fill_id: 'f-3' }).preview;
  const b = fixture({ seed: s });
  const cash = b.call(P + 'fills.choose_cash.preview', { fill_id: 'f-3' }).preview;
  assert.equal(b.call(P + 'fills.choose_cash.confirm', { fill_id: 'f-3', token: cash.token }).fill.state, 'waiting_stock');
  assert.deepEqual([b.call(P + 'fills.cancel.preview', { fill_id: 'f-3' }).preview.changes, stored(b, 'f-3').fill_version], [old.changes, stored(a, 'f-3').fill_version]);
  assert.equal(b.call(P + 'fills.cancel.confirm', { fill_id: 'f-3', token: old.token }).status, 'stale_preview');
});

test('T20b a seed whose records postdate any pending timer is invalid_seed, so a review never sees a later collection', () => {
  const s = baseSeed();
  Object.assign(s.fills.find(f => f.fill_id === 'f-1'), { requested_at: '2026-11-26T08:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-26T08:00:00-05:00' }], review_due_at: '2026-11-26T10:00:00-05:00' });
  assert.throws(() => fixture({ seed: s }), /earliest pending timer \(review of fill f-1, due 2026-11-26T10:00:00-05:00\)/);
  const q = only(baseSeed(), ['f-1']);
  Object.assign(q.fills[0], { requested_at: '2026-11-26T08:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-26T08:00:00-05:00' }], review_due_at: '2026-11-26T10:00:00-05:00' });
  const f = fixture({ seed: q });
  assert.equal(f.call(P + 'fills.get', { fill_id: 'f-1' }).fill.claim.result, 'paid');
});

test('T20b after a same-seed reset an old revocation token does not revoke a grant another guardian made', () => {
  const s = structuredClone(minimal);
  const g = grantor => ({ grant_id: 'g-9', grant_version: 0, patient_id: 'p-3', grantor_id: grantor, grantee_id: 'p-4', scope: 'view', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-29T10:00:00-05:00', revoked_at: null });
  s.grants.push(g('p-2'));
  s.issued.g = 9;
  const a = fixture({ seed: s });
  const old = a.call(P + 'grants.change.preview', { action: 'revoke', grant_id: 'g-9' }).preview.token;
  const t = structuredClone(s);
  t.grants[t.grants.length - 1] = g('p-1');
  const b = fixture({ seed: t });
  ok(b, old);
  assert.equal(b.call(P + 'grants.change.confirm', { action: 'revoke', grant_id: 'g-9', token: old }).status, 'stale_preview');
});

test('T20b decisions, reversals and closings may not precede what they act on; one authorization per fill, referenced by it', () => {
  const reject = (edit, pattern) => { const s = baseSeed(); edit(s); assert.throws(() => fixture({ seed: s }), pattern); };
  reject(s => { const f4 = s.fills.find(f => f.fill_id === 'f-4'); s.prescriptions.find(r => r.rx_id === 'rx-4').written_on = '2025-11-28'; s.prescriptions.find(r => r.rx_id === 'rx-4').received_at = '2025-11-28T09:00:00-05:00'; f4.hold = { note: 'x', placed_at: '2026-11-27T14:00:00-05:00', remaining: {}, stored_decision: { plan_request_id: 'pr-1', decision: 'approved', at: '2026-11-29T09:00:00-05:00' } }; only(s, ['f-4']); }, /pending prescription expiry|earliest pending timer/);
  reject(s => { s.claims.find(c => c.claim_id === 'cl-6').reversed_at = '2026-11-09T12:00:00-05:00'; }, /reversed before it was made|reversed at a different time/);
  reject(s => { s.plan_requests.push({ plan_request_id: 'pr-2', fill_id: 'f-3', claim_id: 'cl-2', reason: 'refill_too_soon', state: 'withdrawn', decision: null, note: null, created_at: '2026-11-28T13:00:00-05:00', closed_at: '2026-11-28T12:30:00-05:00' }); s.issued.pr = 2; }, /closed before it was made/);
  const voided = (id, card) => ({ authorization_id: id, fill_id: 'f-7', card_id: card, amount_cents: 1200, state: 'voided', at: '2026-11-11T09:00:00-05:00', ended_at: '2026-11-20T12:00:00-05:00' });
  reject(s => { s.cards.push({ card_id: 'card-8', owner_id: 'p-2', label: 'Spare', last4: '8888', exp_month: 8, exp_year: 2028, status: 'active' }); s.authorizations.push(voided('au-1', 'card-3'), voided('au-2', 'card-8')); s.fills.find(f => f.fill_id === 'f-7').authorization_id = 'au-2'; s.issued.au = 2; }, /more than one authorization/);
  reject(s => { s.authorizations.push(voided('au-1', 'card-3')); s.issued.au = 1; }, /does not reference its authorization/);
});

test('T20b the patient, prescriber and written date each bind a fill token on their own after a same-seed reset', () => {
  const s = structuredClone(minimal);
  const run = payload => {
    const f = fixture({ seed: s });
    ev(f, 'rx.received', { rx_id: 'rx-9', patient_id: 'p-2', prescriber_id: 'dr-1', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-11-30', ...payload });
    f.call(P + 'fills.request', { rx_id: 'rx-9', store_id: 'st-1', quantity: 30 });
    f.setNow('2026-11-30T11:00:00-05:00');
    return f;
  };
  const base = run({});
  const old = base.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview;
  for (const [label, payload] of [['patient', { patient_id: 'p-3' }], ['prescriber', { prescriber_id: 'dr-2' }], ['written date', { written_on: '2026-11-29' }]]) {
    const other = run(payload);
    const pv = other.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview;
    assert.deepEqual([pv.changes, other.call(P + 'fills.get', { fill_id: 'f-1' }).fill.fill_version], [old.changes, base.call(P + 'fills.get', { fill_id: 'f-1' }).fill.fill_version], label);
    assert.equal(other.call(P + 'fills.cancel.confirm', { fill_id: 'f-1', token: old.token }).status, 'stale_preview', label);
  }
});

test('T20b a resubmission at the instant of a committed collection counts that collection', () => {
  const s = structuredClone(minimal);
  s.prescriptions.push(rx('rx-2'));
  s.cards.push({ card_id: 'card-4', owner_id: 'p-4', label: 'Pension card', last4: '6610', exp_month: 5, exp_year: 2029, status: 'active' });
  const f = fixture({ seed: s });
  const a = f.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }).fill.fill_id;
  const b = f.call(P + 'fills.request', { rx_id: 'rx-2', store_id: 'st-1', quantity: 90 }).fill.fill_id;
  f.setNow('2026-11-30T11:00:00-05:00');
  ev(f, 'fill.collection_attempted', { fill_id: a, collector_id: 'p-4', card_id: 'card-4' });
  assert.deepEqual([stored(f, a).state, f.call(P + 'fills.get', { fill_id: b }).fill.claim.reason], ['collected', 'quantity_limit']);
  const claim = f.call(P + 'fills.change_quantity', { fill_id: b, quantity: 30 }).fill.claim;
  assert.deepEqual([claim.result, claim.reason, claim.eligible_on], ['rejected', 'refill_too_soon', '2026-12-25']);
});

test('T20b cash and cancel tokens bind the whole claim and plan request they act on', () => {
  const vary = edit => { const s = baseSeed(); edit(s); return fixture({ seed: s }); };
  const a = vary(() => {}), b = vary(s => { s.claims.find(c => c.claim_id === 'cl-2').eligible_on = '2026-12-06'; });
  const cash = a.call(P + 'fills.choose_cash.preview', { fill_id: 'f-3' }).preview;
  assert.deepEqual(b.call(P + 'fills.choose_cash.preview', { fill_id: 'f-3' }).preview.changes, cash.changes);
  assert.equal(b.call(P + 'fills.choose_cash.confirm', { fill_id: 'f-3', token: cash.token }).status, 'stale_preview');
  const c = vary(s => { s.plan_requests[0].note = 'Called the plan about an early refill'; });
  const cancel = a.call(P + 'fills.cancel.preview', { fill_id: 'f-4' }).preview;
  assert.deepEqual(c.call(P + 'fills.cancel.preview', { fill_id: 'f-4' }).preview.changes, cancel.changes);
  assert.equal(c.call(P + 'fills.cancel.confirm', { fill_id: 'f-4', token: cancel.token }).status, 'stale_preview');
  assert.equal(stored(c, 'f-4').state, 'pending_plan_decision');
});

test('T20b a stored decision is versioned and may not predate its hold or its plan request', () => {
  const f = fixture({ seed: baseSeed() });
  ev(f, 'fill.hold_placed', { fill_id: 'f-4', note: 'Flag' });
  const v = stored(f, 'f-4').fill_version;
  const pv = f.call(P + 'fills.cancel.preview', { fill_id: 'f-4' }).preview;
  ev(f, 'plan.decided', { plan_request_id: 'pr-1', decision: 'approved' });
  assert.deepEqual([stored(f, 'f-4').fill_version, stored(f, 'f-4').hold.stored_decision.decision], [v + 1, 'approved']);
  assert.equal(f.call(P + 'fills.cancel.confirm', { fill_id: 'f-4', token: pv.token }).status, 'stale_preview');
  const reject = at => { const s = baseSeed(); s.fills.find(x => x.fill_id === 'f-4').hold = { note: 'x', placed_at: '2026-11-27T14:00:00-05:00', remaining: {}, stored_decision: { plan_request_id: 'pr-1', decision: 'approved', at } }; return () => fixture({ seed: s }); };
  assert.throws(reject('2026-11-26T09:00:00-05:00'), /decision dated before its hold or its plan request/);
  assert.throws(reject('2026-11-27T13:30:00-05:00'), /decision dated before its hold or its plan request/);
  assert.doesNotThrow(reject('2026-11-27T15:00:00-05:00'));
});

test('T20b an approved update of one grant survives a change to another grant of the same patient', () => {
  const f = fixture();
  ev(f, 'grant.changed', grantEvent({ grant_id: 'g-2', patient_id: 'p-2', grantor_id: 'p-2', scope: 'view' }));
  const args = { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view', expires_at: '2026-12-31T12:00:00-05:00' };
  const pv = f.call(P + 'grants.change.preview', args).preview;
  assert.match(pv.token, /^tok-grant-grant-g-2-/);
  ok(f, pv.token);
  ev(f, 'grant.changed', grantEvent({ grant_id: 'g-3', patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-4', scope: 'view' }));
  assert.equal(f.data().people.find(p => p.person_id === 'p-2').grant_set_version, 2);
  assert.equal(f.call(P + 'grants.change.confirm', { ...args, token: pv.token }).grant.expires_at, '2026-12-31T12:00:00-05:00');
});

test('T20b the creation time of a grant binds its token; the cutoff counts a collector grant expiry and its own instant; renewals and grant revocations follow their creation', () => {
  const s = structuredClone(minimal);
  const g = created => ({ grant_id: 'g-9', grant_version: 0, patient_id: 'p-3', grantor_id: 'p-2', grantee_id: 'p-4', scope: 'view', fill_id: null, expires_at: null, status: 'active', created_at: created, revoked_at: null });
  s.grants.push(g('2026-11-29T10:00:00-05:00'));
  s.issued.g = 9;
  const a = fixture({ seed: s });
  const old = a.call(P + 'grants.change.preview', { action: 'revoke', grant_id: 'g-9' }).preview.token;
  const t = structuredClone(s);
  t.grants[t.grants.length - 1] = g('2026-11-29T11:00:00-05:00');
  const b = fixture({ seed: t });
  ok(b, old);
  assert.equal(b.call(P + 'grants.change.confirm', { action: 'revoke', grant_id: 'g-9', token: old }).status, 'stale_preview');
  const reject = (edit, pattern) => { const x = baseSeed(); edit(x); assert.throws(() => fixture({ seed: x }), pattern); };
  reject(x => { drop(x, 'f-1'); x.grants.push({ grant_id: 'g-9', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: '2026-11-29T20:00:00-05:00', status: 'active', created_at: '2026-11-29T12:30:00-05:00', revoked_at: null }); x.fills.find(f => f.fill_id === 'f-5').collector = { person_id: 'p-1', via_grant_id: 'g-9', set_at: '2026-11-29T13:00:00-05:00' }; x.fills.find(f => f.fill_id === 'f-2').notes.push({ at: '2026-11-29T21:00:00-05:00', text: 'Called the store' }); x.issued.g = 9; }, /collector grant expiry of fill f-5/);
  const at = baseSeed();
  only(at, ['f-1', 'f-2']);
  const f2 = at.fills.find(f => f.fill_id === 'f-2');
  f2.notes.push({ at: '2026-11-30T10:30:00-05:00', text: 'x' });
  assert.throws(() => fixture({ seed: at, now: '2026-11-30T11:00:00-05:00' }), /earliest pending timer \(review of fill f-1/);
  f2.notes[0].at = '2026-11-30T10:29:59.999-05:00';
  assert.doesNotThrow(() => fixture({ seed: at, now: '2026-11-30T11:00:00-05:00' }));
  reject(x => { x.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-7', state: 'withdrawn', new_rx_id: null, note: null, created_at: '2026-11-25T09:00:00-05:00', closed_at: '2026-11-24T09:00:00-05:00' }); x.issued.rn = 1; }, /Renewal rn-1 closed before it was made/);
  reject(x => { x.grants.push({ grant_id: 'g-9', grant_version: 1, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'view', fill_id: null, expires_at: null, status: 'revoked', created_at: '2026-11-20T09:00:00-05:00', revoked_at: '2026-11-19T09:00:00-05:00' }); x.issued.g = 9; }, /revoked before it was created/);
});

test('T20b a limited pickup grant token binds the prescribed quantity after a same-seed reset', () => {
  const s = structuredClone(minimal);
  const run = quantity => {
    const f = fixture({ seed: s });
    ev(f, 'rx.received', { rx_id: 'rx-9', patient_id: 'p-3', prescriber_id: 'dr-1', drug_id: 'd-atorvastatin-40', quantity, fills_authorized: 3, written_on: '2026-11-30' });
    f.call(P + 'fills.request', { rx_id: 'rx-9', store_id: 'st-1', quantity: 30 });
    return f;
  };
  const args = { action: 'grant', patient_id: 'p-3', grantee_id: 'p-4', scope: 'pickup', fill_id: 'f-1' };
  const old = run(30).call(P + 'grants.change.preview', args).preview.token;
  const b = run(90);
  ok(b, old);
  assert.equal(b.call(P + 'grants.change.confirm', { ...args, token: old }).status, 'stale_preview');
});

test('T20b history order: ready before supersession, paid only on the last attempt, no prepayment during a hold, a plan request after its rejection', () => {
  const reject = (edit, pattern) => { const s = baseSeed(); edit(s); assert.throws(() => fixture({ seed: s }), pattern); };
  const F = (s, id) => s.fills.find(f => f.fill_id === id);
  reject(s => { s.prescriptions.push(rx('rx-20')); Object.assign(s.prescriptions.find(r => r.rx_id === 'rx-5'), { state: 'superseded', superseded_by: 'rx-20', superseded_at: '2026-11-29T11:00:00-05:00' }); }, /became ready after its prescription was superseded/);
  reject(s => { s.claims.push(claim('cl-4b', 'f-5', '2026-11-29T11:00:00-05:00', 'paid')); s.claims.find(c => c.claim_id === 'cl-4').attempt = 2; }, /paid claim before its latest attempt/);
  reject(s => { s.claims.push(claim('cl-4b', 'f-5', '2026-11-29T13:00:00-05:00', 'rejected', { reason: 'refill_too_soon', eligible_on: '2026-12-16', copay_cents: null })); s.claims.find(c => c.claim_id === 'cl-4').attempt = 2; }, /dated out of attempt order/);
  reject(s => { Object.assign(F(s, 'f-5'), { warning_due_at: null, return_due_at: null, hold: { note: 'x', placed_at: '2026-11-29T13:00:00-05:00', remaining: { warning_ms: 167 * 3600000, return_ms: 239 * 3600000 }, stored_decision: null }, authorization_id: 'au-1' }); s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T14:00:00-05:00', ended_at: null }); s.issued.au = 1; }, /made while the fill was on hold/);
  reject(s => { s.plan_requests[0].created_at = '2026-11-27T11:00:00-05:00'; }, /made before the rejection it addresses/);
});

test('T20b a cancel token goes stale when a quantity round trip moves only the version; a decision between an earlier hold and a later request is refused', () => {
  const f = fixture({ seed: baseSeed() });
  const pv = f.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview;
  f.call(P + 'fills.change_quantity', { fill_id: 'f-1', quantity: 90 });
  f.call(P + 'fills.change_quantity', { fill_id: 'f-1', quantity: 30 });
  assert.deepEqual(f.call(P + 'fills.cancel.preview', { fill_id: 'f-1' }).preview.changes, pv.changes);
  assert.equal(f.call(P + 'fills.cancel.confirm', { fill_id: 'f-1', token: pv.token }).status, 'stale_preview');
  const s = baseSeed();
  s.fills.find(x => x.fill_id === 'f-4').hold = { note: 'x', placed_at: '2026-11-27T12:30:00-05:00', remaining: {}, stored_decision: { plan_request_id: 'pr-1', decision: 'approved', at: '2026-11-27T12:45:00-05:00' } };
  assert.throws(() => fixture({ seed: s }), /decision dated before its hold or its plan request/);
});

test('T20b a limited pickup grant token binds the fill request time and the prescription ID after a same-seed reset', () => {
  const s = structuredClone(minimal);
  const run = (rxId, wait) => {
    const f = fixture({ seed: s });
    ev(f, 'rx.received', { rx_id: rxId, patient_id: 'p-3', prescriber_id: 'dr-1', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-11-30' });
    if (wait) f.advance(wait);
    f.call(P + 'fills.request', { rx_id: rxId, store_id: 'st-1', quantity: 30 });
    return f;
  };
  const args = { action: 'grant', patient_id: 'p-3', grantee_id: 'p-4', scope: 'pickup', fill_id: 'f-1' };
  const old = run('rx-9', 0).call(P + 'grants.change.preview', args).preview.token;
  const same = run('rx-9', 0);
  ok(same, old);
  assert.equal(same.call(P + 'grants.change.confirm', { ...args, token: old }).status, 'committed');
  for (const other of [run('rx-9', 5), run('rx-8', 0)]) {
    ok(other, old);
    assert.equal(other.call(P + 'grants.change.confirm', { ...args, token: old }).status, 'stale_preview');
  }
});

test('T20b one open fill per prescription, requests after receipt, returns at least 72 hours after the warning, claims that follow the plan rule, funding before readiness, approved requests resubmitted at approval', () => {
  const reject = (edit, pattern) => { const s = baseSeed(); edit(s); assert.throws(() => fixture({ seed: s }), pattern); };
  const F = (s, id) => s.fills.find(f => f.fill_id === id), C = (s, id) => s.claims.find(c => c.claim_id === id);
  reject(s => { F(s, 'f-7').rx_id = 'rx-6'; }, /were open at the same time/);
  reject(s => { s.prescriptions.find(r => r.rx_id === 'rx-5').received_at = '2026-11-29T10:30:00-05:00'; }, /requested before its prescription was received/);
  reject(s => { F(s, 'f-7').warned_at = '2026-11-18T12:00:00-05:00'; }, /less than 72 hours after its pickup warning/);
  reject(s => { F(s, 'f-7').warned_at = null; }, /returned to stock without its pickup warning/);
  reject(s => { s.plans.find(p => p.plan_id === 'plan-b').rules['d-atorvastatin-40'].covered = false; }, /which the plan rule for this fill does not give/);
  reject(s => { C(s, 'cl-4').at = '2026-11-29T12:30:00-05:00'; }, /became ready before the claim decision that funds it/);
  const approved = at => s => {
    s.claims.push(claim('cl-7', 'f-3', at, 'rejected', { attempt: 2, reason: 'quantity_limit' }));
    Object.assign(F(s, 'f-3'), { claim_id: 'cl-7', waived: ['refill_too_soon'], quantity: 90 });
    s.plan_requests.push({ plan_request_id: 'pr-2', fill_id: 'f-3', claim_id: 'cl-2', reason: 'refill_too_soon', state: 'approved', decision: 'approved', note: null, created_at: '2026-11-28T13:00:00-05:00', closed_at: '2026-11-29T00:00:00-05:00' });
  };
  const ok = baseSeed(); approved('2026-11-29T00:00:00-05:00')(ok); fixture({ seed: ok });
  reject(approved('2026-11-29T01:00:00-05:00'), /was not resubmitted at its approval/);
});

test('T20b same-instant boundaries the App writes load: ready at the supersession instant, an authorization at the instant the hold begins', () => {
  const loads = edit => { const s = baseSeed(); edit(s); fixture({ seed: s }); };
  const F = (s, id) => s.fills.find(f => f.fill_id === id);
  loads(s => { s.prescriptions.push(rx('rx-20')); Object.assign(s.prescriptions.find(r => r.rx_id === 'rx-5'), { state: 'superseded', superseded_by: 'rx-20', superseded_at: '2026-11-29T12:00:00-05:00' }); });
  loads(s => { Object.assign(F(s, 'f-5'), { warning_due_at: null, return_due_at: null, hold: { note: 'x', placed_at: '2026-11-29T13:00:00-05:00', remaining: { warning_ms: 167 * 3600000, return_ms: 239 * 3600000 }, stored_decision: null }, authorization_id: 'au-1' }); s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null }); s.issued.au = 1; });
});

test('T20b a limited pickup grant token binds the prescription fill count and receipt time after a same-seed reset', () => {
  const s = structuredClone(minimal);
  const run = ({ fills = 3, early = 0 } = {}) => {
    const f = fixture({ seed: s });
    f.advance(early);
    ev(f, 'rx.received', { rx_id: 'rx-9', patient_id: 'p-3', prescriber_id: 'dr-1', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: fills, written_on: '2026-11-30' });
    f.advance(10 - early);
    f.call(P + 'fills.request', { rx_id: 'rx-9', store_id: 'st-1', quantity: 30 });
    return f;
  };
  const args = { action: 'grant', patient_id: 'p-3', grantee_id: 'p-4', scope: 'pickup', fill_id: 'f-1' };
  const old = run().call(P + 'grants.change.preview', args).preview.token;
  const same = run();
  ok(same, old);
  assert.equal(same.call(P + 'grants.change.confirm', { ...args, token: old }).status, 'committed');
  for (const other of [run({ fills: 5 }), run({ early: 5 })]) {
    ok(other, old);
    assert.equal(other.call(P + 'grants.change.confirm', { ...args, token: old }).status, 'stale_preview');
  }
});

test('T20b a rejection for a waived reason, a charge on a card expired at collection, cash readiness before the rejection; the reachable boundaries load', () => {
  const reject = (edit, pattern, now) => { const s = baseSeed(); edit(s); assert.throws(() => fixture({ seed: s, now }), pattern); };
  const loads = (edit, now) => { const s = baseSeed(); edit(s); fixture({ seed: s, now }); };
  const F = (s, id) => s.fills.find(f => f.fill_id === id), C = (s, id) => s.claims.find(c => c.claim_id === id);
  reject(s => { F(s, 'f-3').waived = ['refill_too_soon']; F(s, 'f-3').claim_id = 'cl-7'; s.plan_requests.push({ plan_request_id: 'pr-2', fill_id: 'f-3', claim_id: 'cl-2', reason: 'refill_too_soon', state: 'approved', decision: 'approved', note: null, created_at: '2026-11-28T13:00:00-05:00', closed_at: '2026-11-28T14:00:00-05:00' }); s.claims.push(claim('cl-7', 'f-3', '2026-11-28T14:00:00-05:00', 'rejected', { attempt: 2, reason: 'refill_too_soon', eligible_on: '2026-12-05' })); }, /Claim cl-7 is rejected for refill_too_soon, which an approved plan request had already waived/);
  reject(s => { s.cards.find(c => c.card_id === 'card-3').exp_year = 2025; }, /made on a card that had expired/);
  reject(s => { Object.assign(F(s, 'f-5'), { quantity: 90, cash: { price_cents: 6000 }, amount_due_cents: 6000 }); Object.assign(C(s, 'cl-4'), { result: 'rejected', reason: 'quantity_limit', copay_cents: null, at: '2026-11-29T12:30:00-05:00' }); }, /Fill f-5 became ready before the claim decision that funds it/);
  reject(s => { F(s, 'f-3').ready_at = '2026-11-28T12:30:00-05:00'; }, /has a ready time but is not made/);
  reject(s => { C(s, 'cl-2').at = '2026-11-28T11:00:00-05:00'; }, /dated before its fill's review could finish/);
  reject(s => { F(s, 'f-3').quantity = 90; }, /is rejected refill_too_soon, which the plan rule for this fill does not give \(quantity_limit\)/);
  reject(s => { F(s, 'f-3').quantity = 90; C(s, 'cl-2').reason = 'prior_auth_required'; C(s, 'cl-2').eligible_on = null; }, /is rejected prior_auth_required, which the plan rule for this fill does not give \(quantity_limit\)/);
  const now = '2026-12-08T12:00:00-05:00';
  reject(s => { Object.assign(F(s, 'f-5'), { warned_at: '2026-12-07T12:00:00-05:00', warning_due_at: null, return_due_at: '2026-12-09T12:00:00-05:00' }); }, /returns less than 72 hours after its pickup warning/, now);
  reject(s => { Object.assign(F(s, 'f-5'), { warned_at: '2026-12-07T12:00:00-05:00', warning_due_at: null, return_due_at: null, hold: { note: 'x', placed_at: '2026-12-07T13:00:00-05:00', remaining: { return_ms: 50 * 3600000 }, stored_decision: null } }); }, /returns less than 72 hours after its pickup warning/, now);
  loads(s => { const f = F(s, 'f-8'), t = F(s, 'f-7').closed_at, end = '2026-11-20T12:30:00-05:00'; Object.assign(f, { rx_id: 'rx-7', requested_at: t, timeline: [{ state: 'requested', at: t }, { state: 'cancelled', at: end }], closed_at: end, cancellation: { ...f.cancellation, at: end } }); });
});
