'use strict';
// Fixture tests: both fixtures pass the consistency script, the reference fixture matches its
// builder, the checks catch broken data, and the proposal's example events apply to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {check} = require('../scripts/check-fixtures.cjs');
const {build} = require('../scripts/build-reference-fixture.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const reference = require('../fixtures/reference.json');
const wireValid = compile(require('../schemas/router-message.schema.json'), path.resolve(__dirname, '../schemas'));

test('fixtures pass the consistency checks and the reference fixture matches its builder', () => {
  for (const f of ['minimal', 'reference']) assert.deepEqual(check(require('../fixtures/' + f + '.json')).problems, [], f);
  assert.deepEqual(build(), reference);
  const {counts} = check(reference);
  assert.deepEqual([counts.schools, counts.children, counts.pickup_people, counts.restrictions, counts.absence_reports, counts.forms, counts.form_responses,
    counts.lunch_accounts, counts.payment_methods, counts.payments, counts.notifications], [2, 3, 6, 1, 6, 10, 14, 3, 2, 8, 20]);
  assert.ok(counts.attendance >= 110 && counts.lunch_transactions >= 80);
  assert.deepEqual([...new Set(reference.pickup_people.map(p => p.status))].sort(), ['approved', 'denied', 'pending_review', 'removed']);
  assert.deepEqual([...new Set(reference.form_responses.map(r => r.state))].sort(), ['declined', 'needs_review', 'signed', 'withdrawn']);
  assert.deepEqual([...new Set(reference.forms.map(f => f.kind))].sort(), ['information', 'medical_consent', 'medication', 'permission_slip']);
  assert.equal(reference.forms.filter(f => f.fee_cents > 0).length, 4);
});

test('the consistency checks catch broken fixtures', () => {
  const broken = {
    'real-looking phone': d => { d.people[1].phone = '206-555-1234'; },
    'date before 2026': d => { d.attendance[0].history[0].at = '2025-12-31T09:00:00-08:00'; },
    'ledger past the debt limit': d => { const t = d.lunch_transactions.find(x => x.kind === 'adjustment'); t.amount_cents -= 100000; d.lunch_accounts.find(a => a.id === t.lunch_account_id).balance_cents -= 100000; },
    'payment without its response': d => { d.form_responses.find(r => r.id === 'fr-0001').payment_ids = []; },
    'due time on a weekend': d => { d.forms[0].due_at = '2026-10-10T16:00:00-07:00'; }
  };
  for (const [name, mutate] of Object.entries(broken)) {
    const d = structuredClone(reference); mutate(d);
    assert.ok(check(d).problems.length > 0, name);
  }
});

test('the proposal example events apply to the reference fixture', () => {
  const f = fixture({seed: reference});
  f.call('bellnote.preferences.update', {email_notices: true});
  f.event({event_id: 'ev-bn-101', at: '2026-11-17T09:20:00-08:00', operation: 'bellnote.attendance.marked', payload: {child_id: 'child-theo', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}});
  f.event({event_id: 'ev-bn-130', at: '2026-11-18T12:10:00-08:00', operation: 'bellnote.lunch.charged', payload: {transaction_id: 'tx-0412', child_id: 'child-ines', kind: 'purchase', amount_cents: -425, item: 'Peanut noodle bowl', allergens: ['peanut', 'wheat', 'soy']}});
  f.event({event_id: 'ev-bn-160', at: '2026-11-18T13:05:00-08:00', operation: 'bellnote.school.day_changed', payload: {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Staff training'}});
  const n = f.data.notifications.at(-1);
  assert.match(n.body, /Theo Okafor's dismissal plan for that day is still: collected by Dana Okafor \(dc-0004\)/);
  assert.match(n.body, /until 11:00/);
  assert.ok(wireValid(n.wire));
  f.event({event_id: 'ev-bn-121', at: '2026-11-19T21:15:00-08:00', operation: 'bellnote.dismissal.recorded', payload: {change_id: 'dc-0031', child_id: 'child-theo', date: '2026-11-20', mode: 'pickup', person_id: 'person-rosa', recorded_by: 'person-dana'}});
  assert.equal(f.data.dismissal_changes.find(d => d.id === 'dc-0004').status, 'replaced');
  const lunch = f.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2026-11-18', end: '2026-11-18'});
  assert.equal(lunch.account.balance_cents, 310 - 425);
  assert.equal(lunch.transactions[0].restricted_item, true);
  const hist = f.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2026-11-04', end: '2026-11-04'}).transactions;
  assert.deepEqual(hist.map(t => [t.item, t.restricted_item, t.over_daily_limit]), [['Almond oat bar', true, false], ['Fruit cup', false, true]]);
});
