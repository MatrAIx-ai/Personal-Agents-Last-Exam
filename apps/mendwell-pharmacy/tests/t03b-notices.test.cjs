'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const { householdSeed } = require('./seeds.cjs');

const P = 'mendwell-pharmacy.';
const appended = (before, after) => after.notices.slice(before.notices.length);
const rows = list => list.map(n => [n.kind, n.recipient_id, n.audience]);

function prepaidSeed(pickupExpires) {
  const s = householdSeed();
  s.grants.find(g => g.grant_id === 'g-3').expires_at = pickupExpires;
  s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-1', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null });
  s.fills.find(f => f.fill_id === 'f-5').authorization_id = 'au-1';
  s.issued.au = 1;
  return s;
}

test('T03b a timer notice goes to the patient and full-access holders, and pickup holders get the logistics entry with only store, fill and amount', () => {
  const s1 = fixture({ seed: householdSeed() });
  s1.setNow('2026-11-30T10:00:00-05:00');
  const before = s1.data();
  s1.event({ event_id: 'e-2', at: '2026-11-30T10:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' } });
  const ready = appended(before, s1.data()).filter(n => n.subject.id === 'f-21');
  assert.deepEqual(rows(ready), [['notice.fill_ready', 'p-2', 'full'], ['notice.fill_ready', 'p-1', 'logistics']]);
  const pickup = ready.find(n => n.audience === 'logistics');
  assert.equal(pickup.body, 'Fill f-21 is ready at store st-1. Amount due: $10.00.');
  assert.deepEqual(pickup.fields, { fill_id: 'f-21', store_id: 'st-1', amount_due_cents: 1000 });
  assert.equal(pickup.at, '2026-11-30T10:00:00-05:00');
  assert.equal(pickup.title, 'Fill ready for pickup');
});

test('T03b the card owner gets one masked void entry even with full access elsewhere; one entry per person', () => {
  const f = fixture({ seed: prepaidSeed(null), now: '2026-12-09T13:00:00-05:00' });
  const before = f.data();
  f.event({ event_id: 'e-3', at: '2026-12-09T13:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' } });
  const notes = appended(before, f.data()).filter(n => n.subject.type === 'notice' || n.subject.id === 'f-5');
  assert.deepEqual(rows(notes.filter(n => n.kind === 'notice.returned')), [['notice.returned', 'p-2', 'full'], ['notice.returned', 'p-4', 'full'], ['notice.returned', 'p-1', 'logistics']]);
  const voids = notes.filter(n => n.kind === 'notice.payment_voided');
  assert.deepEqual(rows(voids), [['notice.payment_voided', 'p-2', 'full'], ['notice.payment_voided', 'p-4', 'full'], ['notice.payment_voided', 'p-1', 'card_owner']]);
  const masked = voids.find(n => n.audience === 'card_owner');
  assert.deepEqual(masked.fields, { card_last4: '2208', amount_cents: 1200, status: 'voided' });
  assert.equal(masked.subject.id, masked.notice_id);
  assert.ok(!/f-5|atorvastatin|Elena/.test(masked.body));
  assert.ok(notes.filter(n => n.kind !== 'notice.return_warning').every(n => n.at === '2026-12-09T12:00:00-05:00'));
  const people = voids.map(n => n.recipient_id);
  assert.equal(new Set(people).size, people.length);
});

test('T03b recipients of a timer notice use the grants in force at its due time, not at the next write', () => {
  const late = fixture({ seed: prepaidSeed('2026-12-09T13:00:00-05:00'), now: '2026-12-09T14:00:00-05:00' });
  const b1 = late.data();
  late.event({ event_id: 'e-4', at: '2026-12-09T14:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' } });
  assert.ok(appended(b1, late.data()).some(n => n.kind === 'notice.returned' && n.recipient_id === 'p-1' && n.audience === 'logistics'));
  const early = fixture({ seed: prepaidSeed('2026-12-09T11:00:00-05:00'), now: '2026-12-09T14:00:00-05:00' });
  const b2 = early.data();
  early.event({ event_id: 'e-5', at: '2026-12-09T14:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' } });
  const notes = appended(b2, early.data());
  assert.ok(!notes.some(n => n.kind === 'notice.returned' && n.subject.id === 'f-5' && n.recipient_id === 'p-1'));
  assert.ok(notes.some(n => n.kind === 'notice.return_warning' && n.subject.id === 'f-5' && n.recipient_id === 'p-1' && n.audience === 'logistics'));
  assert.ok(notes.some(n => n.kind === 'notice.payment_voided' && n.recipient_id === 'p-1' && n.audience === 'card_owner'));
});

test('T03b notice titles and bodies stay within the limits', () => {
  const f = fixture({ seed: prepaidSeed(null), now: '2026-12-09T13:00:00-05:00' });
  f.event({ event_id: 'e-6', at: '2026-12-09T13:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' } });
  for (const n of f.data().notices) { assert.ok([...n.title].length <= 200 && n.title.length <= 200); assert.ok([...n.body].length <= 20000 && n.body.length <= 20000); }
});
