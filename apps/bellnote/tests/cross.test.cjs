'use strict';
// Cross-workflow business tests: T17 invalid events, T18 notifications and the clock, and the
// App-side parts of T19 (seed validation and activity-row counting). Core's replay,
// idempotency_conflict, stale_version, permission_denied and reset are exercised against the
// real runtime by scripts/real-mcp.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {fixture, business, ev} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const wireValid = compile(require('../schemas/router-message.schema.json'), path.resolve(__dirname, '../schemas'));

const QUESTIONS = [{id: 'q-lunch', type: 'choice', label: 'Lunch', options: ['school_sack_lunch', 'bring_own'], required: true}];
const publish = (at, extra = {}) => ev('form.published', at, {form_id: 'form-aquarium', school_id: 'school-alder', child_ids: ['child-theo'], kind: 'permission_slip',
  title: 'Grade 3 aquarium trip', text: 'Bus leaves 08:45 on 4 December.', questions: QUESTIONS, fee_cents: 1800, due_at: '2026-11-25T16:00:00-08:00', ...extra});

test('T17 invalid events leave state unchanged: duplicate IDs, unknown references, a child outside the account, a second answer, a wrong-state review, debt limit, time', () => {
  const f = fixture();
  f.event(publish('2026-11-17T07:30:00-08:00'));
  f.call('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {'q-lunch': 'bring_own'}});
  const at = '2026-11-17T10:00:00-08:00';
  const cases = {
    'duplicate form ID': publish(at),
    'duplicate transaction ID': ev('lunch.charged', at, {transaction_id: 'tx-0001', child_id: 'child-theo', kind: 'purchase', amount_cents: -100, item: 'x'}),
    'duplicate ID of another kind': ev('dismissal.recorded', at, {change_id: 'pp-0001', child_id: 'child-theo', date: '2026-11-19', mode: 'bus', recorded_by: 'person-dana'}),
    'unknown school': publish(at, {form_id: 'form-x', school_id: 'school-nowhere'}),
    'child outside the account': ev('attendance.marked', at, {child_id: 'child-zed', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}),
    'child at another school': publish(at, {form_id: 'form-y', child_ids: ['child-nico']}),
    'unknown staff': ev('attendance.marked', at, {child_id: 'child-theo', date: '2026-11-17', status: 'absent', marked_by: 'staff-ghost'}),
    'mark on a closed day': ev('attendance.marked', at, {child_id: 'child-theo', date: '2026-11-11', status: 'absent', marked_by: 'staff-office-alder'}),
    'mark for a future day': ev('attendance.marked', at, {child_id: 'child-theo', date: '2026-11-18', status: 'absent', marked_by: 'staff-office-alder'}),
    'unknown report': ev('absence.reviewed', at, {report_id: 'rep-9999', decision: 'excused', reviewed_by: 'staff-office-alder'}),
    'unknown form': ev('form.changed', at, {form_id: 'form-none', change: {fee_cents: 1}, reason: 'x'}),
    'second answer': ev('form.answered', at, {form_id: 'form-aquarium', child_id: 'child-theo', by_guardian_id: 'person-dana', action: 'sign', form_version: 1, answers: {'q-lunch': 'bring_own'}}),
    'answer by a non-guardian': ev('form.answered', at, {form_id: 'form-fluclinic', child_id: 'child-ines', by_guardian_id: 'person-rosa', action: 'decline', form_version: 1}),
    'withdraw of an answer that is not theirs': ev('form.answered', at, {form_id: 'form-aquarium', child_id: 'child-theo', by_guardian_id: 'person-dana', action: 'withdraw'}),
    'review in the wrong state': ev('pickup.person_reviewed', at, {pickup_person_id: 'pp-0001', decision: 'approve', reviewed_by: 'staff-office-alder'}),
    'unknown pickup person': ev('pickup.person_reviewed', at, {pickup_person_id: 'pp-9999', decision: 'approve', reviewed_by: 'staff-office-alder'}),
    'unknown person named': ev('dismissal.recorded', at, {change_id: 'dc-0099', child_id: 'child-theo', date: '2026-11-19', mode: 'pickup', person_id: 'person-ghost', recorded_by: 'person-dana'}),
    'charge past the debt limit': ev('lunch.charged', at, {transaction_id: 'tx-9001', child_id: 'child-ines', kind: 'purchase', amount_cents: -1311, item: 'x'}),
    'closed day changed again': ev('school.day_changed', at, {school_id: 'school-alder', date: '2026-11-26', kind: 'closed', reason: 'x'}),
    'early dismissal outside the day': ev('school.day_changed', at, {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '16:00', reason: 'x'}),
    'event before the App clock': ev('lunch.charged', '2026-11-17T06:00:00-08:00', {transaction_id: 'tx-9002', child_id: 'child-ines', kind: 'purchase', amount_cents: -100, item: 'x'})
  };
  for (const [name, e] of Object.entries(cases)) {
    const before = f.data, now = f.now, rev = f.revision, r = f.tryEvent(e);
    assert.equal(r.status, 'invalid_event', name + ': ' + r.message);
    assert.deepEqual(f.data, before, name + ' leaves data unchanged');
    assert.equal(f.now, now, name + ' leaves the clock unchanged'); assert.equal(f.revision, rev);
  }
  assert.equal(f.tryEvent({event_id: 'x', at, operation: 'bellnote.unknown', payload: {}}).status, 'invalid_arguments', 'Undeclared operation fails the event schema');
});

test('T18 notifications: one per event that concerns me, none for my own writes; wire stored only with email notices on', () => {
  const f = fixture();
  const n0 = f.data.notifications.length;
  // Every Agent write writes no notification.
  f.call('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-17', reason: 'Fever'});
  f.call('bellnote.absences.cancel', {id: 'rep-0001'});
  f.call('bellnote.forms.respond', {id: 'form-fluclinic', child_id: 'child-ines', action: 'decline', form_version: 1});
  f.call('bellnote.forms.withdraw', {id: f.data.form_responses.at(-1).id});
  const pp = f.call('bellnote.pickup.person_add', {id: 'child-theo', name: 'Lena Marsh', relationship: 'aunt', phone: '555-0155'});
  f.call('bellnote.pickup.person_remove', {id: pp.id});
  const d = f.call('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-19', mode: 'walker'});
  f.call('bellnote.dismissal.cancel', {id: d.id});
  f.call('bellnote.lunch.topup', {id: 'lunch-theo', amount_cents: 1000});
  f.call('bellnote.lunch.settings_update', {id: 'lunch-theo', low_balance_threshold_cents: 700});
  f.call('bellnote.preferences.update', {email_notices: false});
  assert.equal(f.data.notifications.length, n0, 'No notification for my own writes');
  assert.equal(f.data.activity.filter(a => a.actor === 'agent').length, 11, 'One activity row per committed write');
  // Events that concern me: one notification each, wire null while email notices are off.
  f.event(ev('attendance.marked', '2026-11-17T09:20:00-08:00', {child_id: 'child-ines', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}));
  assert.equal(f.data.notifications.length, n0 + 1); assert.equal(f.data.notifications.at(-1).wire, null);
  // With email notices on, the full Mail wire message is stored and matches Mail's schema.
  f.call('bellnote.preferences.update', {email_notices: true});
  f.event(ev('school.day_changed', '2026-11-18T13:05:00-08:00', {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Staff training'}));
  const n = f.data.notifications.at(-1);
  assert.ok(wireValid(n.wire), 'Wire message matches urn:pale:email-message:2');
  assert.equal(n.wire.id, n.id); assert.equal(n.wire.time, n.at); assert.equal(n.wire.source, 'urn:pale:app:bellnote:account:bellnote-maya');
  assert.deepEqual(n.wire.data.recipient, {kind: 'person_ref', id: 'person-maya'});
  assert.deepEqual(n.wire.data.source_object, {app_id: 'bellnote', account_id: 'bellnote-maya', object_type: 'school_day', object_id: 'day-alder-2026-11-20'});
  assert.equal(n.wire.data.content.body.format, 'text/plain');
  assert.ok(!wireValid({...n.wire, data: {...n.wire.data, recipient: undefined}}), 'A message without a recipient fails');
  assert.ok(!wireValid({...n.wire, data: {...n.wire.data, content: {...n.wire.data.content, body: {format: 'text/html', text: '<b>x</b>'}}}}), 'An HTML body fails');
  assert.equal(f.call('bellnote.notifications.list', {kind: 'school.day_changed'}).notifications[0].email_message_stored, true);
  // An event that does not concern a guardian (a present mark) writes no notification.
  const n1 = f.data.notifications.length;
  f.event(ev('attendance.marked', '2026-11-18T13:10:00-08:00', {child_id: 'child-theo', date: '2026-11-18', status: 'present', marked_by: 'staff-office-alder'}));
  assert.equal(f.data.notifications.length, n1);
});

test('T18 the clock alone: a form closes, a cut-off passes and a card expires, with no App code, notification or activity row', () => {
  const f = fixture({now: '2026-11-17T07:00:00-08:00'});
  f.event(publish('2026-11-17T07:30:00-08:00'));
  const stored = JSON.stringify(f.data);
  assert.equal(f.call('bellnote.forms.get', {id: 'form-aquarium'}).form.phase, 'open');
  f.advance('2026-12-01T00:00:00-08:00');
  assert.equal(f.call('bellnote.forms.get', {id: 'form-aquarium'}).form.phase, 'closed');
  const day = f.call('bellnote.schools.get', {id: 'school-alder', start: '2026-12-01', end: '2026-12-01'}).days[0];
  assert.equal(Date.parse(day.absence_cutoff_at) > Date.parse('2026-12-01T00:00:00-08:00'), true);
  assert.equal(f.call('bellnote.preferences.get').payment_methods.find(m => m.id === 'pm-0002').expired, true);
  assert.equal(f.try('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-30', reason: 'x'}).status, 'too_late');
  assert.equal(JSON.stringify(f.data), stored, 'Business data, notifications and activity are unchanged by time');
});

test('T19 seed validation rejects inconsistent history (invalid_seed)', () => {
  const base = require('../fixtures/minimal.json');
  const ctx = {app_id: 'bellnote', binding: require('../fixtures/binding.json')};
  const bad = {
    'duplicate IDs': d => { d.lunch_transactions[1].id = 'tx-0001'; },
    'duplicate ID across collections': d => { d.restrictions[0].id = 'pp-0001'; },
    'dangling school': d => { d.children[0].school_id = 'school-none'; },
    'dangling payment method': d => { d.payments[0].payment_method_id = 'pm-none'; },
    'child without a link for the account holder': d => { d.guardian_links = d.guardian_links.filter(l => l.id !== 'gl-nico-maya'); },
    'approved and restricted': d => { d.restrictions.push({id: 'rs-0002', child_id: 'child-theo', person_id: 'person-rosa', recorded_at: '2026-09-01T09:00:00-07:00'}); },
    'two active dismissal changes': d => {
      const c = {id: 'dc-0001', child_id: 'child-theo', date: '2026-11-20', mode: 'bus', person_id: null, note: null, recorded_by: 'person-maya', actor: 'seed',
        created_at: '2026-11-16T08:00:00-08:00', status: 'active', replaces: null, replaced_by: null, request_id: null, event_id: null, history: []};
      d.dismissal_changes.push(c, {...c, id: 'dc-0002', mode: 'walker'});
    },
    'response version the form never had': d => { d.form_responses[0].form_version = 2; },
    'balance not equal to its transactions': d => { d.lunch_accounts[0].balance_cents += 1; },
    'timestamp without offset': d => { d.attendance[0].marked_at = '2026-11-16T09:15:00'; },
    'unknown allergen': d => { d.menu_days[0].items[0].allergens.push('glitter'); },
    'account not in the binding': d => { d.account_id = 'bellnote-other'; }
  };
  for (const [name, mutate] of Object.entries(bad)) {
    const d = structuredClone(base); mutate(d);
    assert.throws(() => plugin.validateSeed(ctx, d), e => e.code === 'invalid_seed', name);
  }
  plugin.validateSeed(ctx, structuredClone(base));
});

test('T19 activity rows: one per committed write, per applied event and per event effect; none for a refusal or the clock', () => {
  const f = fixture();
  f.call('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-19', mode: 'pickup', person_id: 'person-rosa'});
  assert.equal(f.try('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-21', mode: 'bus'}).status, 'not_school_day');
  assert.equal(f.tryEvent(ev('absence.reviewed', '2026-11-17T08:00:00-08:00', {report_id: 'rep-9', decision: 'excused', reviewed_by: 'staff-office-alder'})).status, 'invalid_event');
  f.advance('2026-11-17T08:00:00-08:00');
  f.event(ev('pickup.person_reviewed', '2026-11-17T09:00:00-08:00', {pickup_person_id: 'pp-0001', decision: 'revoke', reviewed_by: 'staff-office-alder'}, 'ev-revoke'));
  const rows = f.data.activity;
  assert.deepEqual(rows.map(r => [r.seq, r.actor, r.action]), [
    [1, 'agent', 'dismissal.set'], [2, 'event', 'event.pickup.person_reviewed'], [3, 'event', 'effect.dismissal_change.void'],
    [4, 'event', 'effect.notification.written'], [5, 'event', 'effect.notification.written']]);
  assert.equal(rows[0].request_id, 'local-1'); assert.equal(rows[0].event_id, null);
  assert.ok(rows.slice(1).every(r => r.event_id === 'ev-revoke' && r.request_id === null));
  assert.ok(rows.slice(2).every(r => r.cause_seq === 2));
  assert.equal(f.audit.filter(a => a.decision === 'deny').length, 2, 'Refusals appear only as denials, never as activity rows');
  assert.deepEqual(business(f.data).lunch_accounts, business(fixture().data).lunch_accounts);
});
