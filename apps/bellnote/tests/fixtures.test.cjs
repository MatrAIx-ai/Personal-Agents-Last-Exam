'use strict';
// Fixture tests: both fixtures pass the consistency script, the reference fixture matches its
// builder, the checks catch broken data, and the proposal's example events apply to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {check} = require('../scripts/check-fixtures.cjs');
const {build} = require('../scripts/build-reference-fixture.cjs');
const history = require('../scripts/history.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const reference = require('../fixtures/reference.json');
const wireValid = compile(require('../schemas/router-message.schema.json'), path.resolve(__dirname, '../schemas'));

test('fixtures pass the consistency checks and the reference fixture matches its builder', () => {
  for (const f of ['minimal', 'reference']) assert.deepEqual(check(require('../fixtures/' + f + '.json')).problems, [], f);
  assert.deepEqual(build(), reference);
  // The hand-written 2026–27 records keep their counts; the generated history adds its own series.
  const handWritten = k => reference[k].filter(r => !history.isGenerated(r.id) && !(['attendance', 'menu_days'].includes(k) && r.date < '2026-08-26'));
  assert.deepEqual(['schools', 'children', 'pickup_people', 'restrictions', 'absence_reports', 'forms', 'form_responses', 'lunch_accounts', 'payment_methods', 'payments', 'notifications']
    .map(k => handWritten(k).length), [2, 3, 6, 1, 6, 10, 14, 3, 2, 8, 34]);
  assert.ok(handWritten('attendance').length >= 110 && handWritten('lunch_transactions').length >= 80);
  const {generated, records} = check(reference);
  assert.deepEqual(generated, {attendance: 27, absence_reports: 14, forms: 18, form_responses: 23, dismissal_changes: 30, pickup_people: 2, lunch_transactions: 192,
    menu_days: 111, payments: 26, notifications: 88, history_floor: '2025-01-01'});
  assert.equal(records, require('../contribution/dataset.json').expected_counts.records);
  // Without the generated history the builder reproduces the hand-written fixture exactly.
  const hand = build({withHistory: false});
  for (const k of Object.keys(hand)) if (Array.isArray(hand[k])) assert.deepEqual(k === 'people' ? reference.people.filter(p => p.person_id !== 'person-marisol') : handWritten(k), hand[k], k);
  assert.deepEqual([...new Set(reference.pickup_people.map(p => p.status))].sort(), ['approved', 'denied', 'pending_review', 'removed']);
  assert.deepEqual([...new Set(reference.form_responses.map(r => r.state))].sort(), ['declined', 'needs_review', 'signed', 'withdrawn']);
  assert.deepEqual([...new Set(reference.forms.map(f => f.kind))].sort(), ['information', 'medical_consent', 'medication', 'permission_slip']);
  assert.equal(handWritten('forms').filter(f => f.fee_cents > 0).length, 4);
});

test('the consistency checks catch broken fixtures', () => {
  const broken = {
    'real-looking phone': d => { d.people[1].phone = '206-555-1234'; },
    'date before the 2025 history floor': d => { d.attendance[0].history[0].at = '2024-12-31T09:00:00-08:00'; },
    'generated purchase on a holiday': d => { const t = d.lunch_transactions.find(x => x.id.startsWith('tx-h') && x.kind === 'purchase'); t.at = '2025-01-20T11:55:00-08:00'; },
    'generated attendance during spring break': d => { const a = d.attendance.find(x => x.date < '2026-01-01'); a.date = '2025-04-08'; a.id = 'att-' + a.child_id + '-2025-04-08'; },
    'rollover that does not match the carry-over': d => { const t = d.lunch_transactions.find(x => x.note === 'Year-end rollover: balance moved to the 2026–27 school year');
      t.amount_cents -= 100; d.lunch_accounts.find(a => a.id === t.lunch_account_id).balance_cents -= 100; },
    'history reveals a non-custodial child\'s dismissal plan': d => { const c = d.dismissal_changes.find(x => x.id.startsWith('dc-h')); c.child_id = 'child-nico'; },
    'Ines in school before kindergarten': d => { const a = d.attendance.find(x => x.child_id === 'child-theo' && x.date < '2025-07-01'); a.child_id = 'child-ines'; a.id = 'att-child-ines-' + a.date; },
    'a missing low-balance notice': d => { d.notifications = d.notifications.filter(n => !(n.kind === 'lunch.low_balance' && n.id.startsWith('ntf-h'))).slice(); },
    'ledger past the debt limit': d => { const t = d.lunch_transactions.find(x => x.kind === 'adjustment'); t.amount_cents -= 100000; d.lunch_accounts.find(a => a.id === t.lunch_account_id).balance_cents -= 100000; },
    'payment without its response': d => { d.form_responses.find(r => r.id === 'fr-0001').payment_ids = []; },
    'due time on a weekend': d => { d.forms[0].due_at = '2026-10-10T16:00:00-07:00'; }
  };
  for (const [name, mutate] of Object.entries(broken)) {
    const d = structuredClone(reference); mutate(d);
    assert.ok(check(d).problems.length > 0, name);
  }
});

test('the App\'s rules apply to hand-written records and to the minimal fixture as well', () => {
  const minimal = require('../fixtures/minimal.json');
  const broken = [
    // The original state of the pumpkin-farm answers: Dana signed and paid for Ines, whose link has no can_pay.
    [reference, 'a fee paid by a guardian who cannot pay', d => { d.form_responses.find(r => r.id === 'fr-0001').child_id = 'child-theo'; d.form_responses.find(r => r.id === 'fr-0002').child_id = 'child-ines';
      d.payments.find(p => p.id === 'pay-0003').child_id = 'child-theo'; }, /fr-0002 fee paid by a guardian who cannot pay/],
    [reference, 'an answer by a guardian who cannot sign', d => { d.guardian_links.find(l => l.id === 'gl-theo-dana').can_sign = false; }, /fr-0002 answered by a guardian who cannot sign/],
    [reference, 'a report sent after its cut-off', d => { const r = d.absence_reports.find(x => x.id === 'rep-0001'); r.submitted_at = r.history[0].at = '2026-09-29T08:31:00-07:00'; }, /rep-0001 submitted after its cut-off/],
    [reference, 'a way-home change naming a person the office denied', d => { d.dismissal_changes.find(x => x.id === 'dc-0001').person_id = 'person-lena'; }, /dc-0001 names a person not approved at the time/],
    [reference, 'a way-home change recorded after its cut-off', d => { d.dismissal_changes.find(x => x.id === 'dc-0001').created_at = '2026-10-23T11:30:00-07:00'; }, /dc-0001 recorded after its cut-off/],
    [reference, 'a pickup person added by a guardian without custodial rights', d => { d.pickup_people.find(x => x.id === 'pp-0006').added_by = 'person-maya'; }, /pp-0006 added by a guardian without custodial rights/],
    [reference, 'a top-up outside the range', d => { const t = d.lunch_transactions.find(x => x.payment_id === 'pay-0001'); t.amount_cents += 20000; d.payments.find(p => p.id === 'pay-0001').amount_cents += 20000;
      d.lunch_accounts.find(a => a.id === t.lunch_account_id).balance_cents += 20000; }, /top-up outside the top-up range/],
    [reference, 'a form without its published notice', d => { d.notifications = d.notifications.filter(n => !(n.kind === 'form.published' && n.object_id === 'form-aquarium')); }, /form-aquarium: 0 form\.published notifications/],
    [reference, 'a refund without its notice', d => { d.notifications = d.notifications.filter(n => n.kind !== 'lunch.refund' || n.id.startsWith('ntf-h')); }, /lunch\.refund notifications/],
    [reference, 'a notice that shows a record ID', d => { d.notifications.find(n => n.id === 'ntf-0001').body += ' (rep-0003)'; }, /ntf-0001 text shows a record ID/],
    [reference, 'a notice with an ISO date', d => { d.notifications.find(n => n.id === 'ntf-0001').body += ' Due 2026-10-01.'; }, /ntf-0001 text shows an ISO date/],
    [minimal, 'minimal: an answer by a guardian who cannot sign', d => { d.guardian_links.find(l => l.id === 'gl-theo-dana').can_sign = false; }, /fr-0001 answered by a guardian who cannot sign/],
    [minimal, 'minimal: a missing review notice', d => { d.notifications = d.notifications.filter(n => n.kind !== 'pickup.person_reviewed'); }, /pp-0001: 0 pickup\.person_reviewed notifications/]
  ];
  for (const [base, name, mutate, expected] of broken) {
    const d = structuredClone(base); mutate(d);
    const {problems} = check(d);
    assert.ok(problems.some(p => expected.test(p)), name + ': ' + JSON.stringify(problems).slice(0, 400));
  }
});

test('the proposal example events apply to the reference fixture', () => {
  const f = fixture({seed: reference});
  f.call('bellnote.preferences.update', {email_notices: true});
  f.event({event_id: 'ev-bn-101', at: '2026-11-17T09:20:00-08:00', operation: 'bellnote.attendance.marked', payload: {child_id: 'child-theo', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}});
  f.event({event_id: 'ev-bn-130', at: '2026-11-18T12:10:00-08:00', operation: 'bellnote.lunch.charged', payload: {transaction_id: 'tx-0412', child_id: 'child-ines', kind: 'purchase', amount_cents: -425, item: 'Peanut noodle bowl', allergens: ['peanut', 'wheat', 'soy']}});
  f.event({event_id: 'ev-bn-160', at: '2026-11-18T13:05:00-08:00', operation: 'bellnote.school.day_changed', payload: {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Staff training'}});
  const n = f.data.notifications.at(-1);
  assert.match(n.body, /Theo Okafor's way home that day is still collected by Dana Okafor\./);
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

test('T03 a report from an earlier school year keeps its state instead of reading moot', () => {
  // A day before the current term (whose calendar the App does not hold) is not `moot`: moot is only
  // for days that became closed, so a report of an earlier year keeps the state it ended in.
  const f = fixture({mutate: d => {
    d.absence_reports.push({id: 'rep-0099', child_id: 'child-theo', kind: 'absent', dates: ['2026-05-12'], time_local: null, reason: 'Fever', state: 'excused', cancelled_dates: [],
      submitted_by: 'person-maya', submitted_at: '2026-05-12T07:00:00-07:00', reviewed_by: 'staff-office-alder', reviewed_at: '2026-05-12T14:00:00-07:00', review_note: null,
      request_id: null, history: []});
  }});
  const r = f.call('bellnote.absences.list', {id: 'rep-0099'}).reports[0];
  assert.equal(r.state, 'excused'); assert.deepEqual(r.moot_dates, []);
  assert.deepEqual(r.days, [{date: '2026-05-12', state: 'reported', moot_reason: null, closed: false, cutoff_at: null, cutoff_passed: true}]);
  assert.equal(f.try('bellnote.absences.cancel', {id: 'rep-0099'}).status, 'invalid_state');
});

test('the generated history reads through the App: earlier years, default windows and rights', () => {
  const f = fixture({seed: reference});
  // Earlier reports keep their reviewed state; none reads moot.
  const reports = f.call('bellnote.absences.list', {}).reports;
  assert.ok(reports.filter(r => r.id.startsWith('rep-h')).every(r => ['excused', 'unexcused', 'cancelled'].includes(r.state) && r.moot_dates.length === 0));
  // Nico was in grade 5 at Alder in spring 2025: his marks then come from Alder's office.
  const spring = f.call('bellnote.attendance.list', {id: 'child-nico', start: '2025-01-01', end: '2025-04-30'}).records;
  assert.ok(spring.length > 0 && spring.every(a => a.marked_by === 'staff-office-alder'));
  // Ines started kindergarten in August 2025.
  assert.equal(f.call('bellnote.attendance.list', {id: 'child-ines', start: '2025-01-01', end: '2025-04-30'}).records.length, 0);
  // Default windows show the current period only.
  assert.ok(f.call('bellnote.attendance.list', {}).records.every(a => a.date >= '2026-11-03'));
  assert.ok(f.call('bellnote.notifications.list', {}).notifications.every(n => !n.id.startsWith('ntf-h')));
  assert.ok(f.call('bellnote.payments.list', {}).payments.every(p => !p.id.startsWith('pay-h')));
  assert.ok(f.call('bellnote.lunch.account_get', {id: 'lunch-theo'}).transactions.every(t => !t.id.startsWith('tx-h')));
  // forms.list has no window in the plan: the earlier forms are listed, all closed.
  const forms = f.call('bellnote.forms.list', {}).forms;
  assert.ok(forms.filter(x => history.isGenerated(x.id)).every(x => x.phase === 'closed'));
  // A balance read for a 2025 week reconciles with the ledger, and no generated purchase is flagged.
  const tx = f.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2025-08-24', end: '2025-12-19'}).transactions;
  assert.ok(tx.length > 0 && tx.every(t => !t.restricted_item && !t.over_daily_limit));
  // Nothing of Nico's pickup list or dismissal plans, then or now.
  assert.equal(f.try('bellnote.pickup.get', {id: 'child-nico'}).status, 'not_permitted');
  assert.ok(!reference.dismissal_changes.some(d => d.child_id === 'child-nico') && !reference.pickup_people.some(p => p.child_id === 'child-nico' && p.id.startsWith('pp-h')));
});
