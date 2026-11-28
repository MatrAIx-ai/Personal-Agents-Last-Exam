'use strict';
// What a guardian reads: refusal messages and notification text name people, days and times, never
// record IDs, ISO timestamps or field names (the web page shows both as they are; the one exception is a
// refusal of an unknown ID the caller sent, which repeats it); and the tool descriptions state the rules
// the handlers apply.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');
const tools = require('../tools.json');
const reference = require('../fixtures/reference.json');

const RAW = [
  [/\b(rep|fr|pp|dc|pay|tx|ntf|att|pm|form|person|staff|child|lunch|school|day|gl|r)-[a-z0-9]/, 'a record ID'],
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'an ISO timestamp'],
  [/\b[a-z]+_[a-z_]+\b/, 'a field name']
];
const clean = (text, what) => { for (const [re, kind] of RAW) assert.doesNotMatch(text, re, what + ' shows ' + kind + ': ' + text); };

test('refusal messages name people, days and times instead of record IDs and timestamps', () => {
  const f = fixture({seed: reference, now: '2026-11-17T08:45:00-08:00'});
  const own = f.call('bellnote.absences.report', {id: 'child-ines', kind: 'absent', start: '2026-12-01', reason: 'Clinic'});
  const cases = [
    ['bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-17', reason: 'x'}, 'too_late', /absence cut-off for Tuesday, November 17 passed at 08:30/],
    ['bellnote.absences.report', {id: 'child-theo', kind: 'late', start: '2026-11-17', time_local: '08:30', reason: 'x'}, 'invalid_time', /inside that school day/],
    ['bellnote.absences.report', {id: 'child-ines', kind: 'absent', start: '2026-11-30', end: '2026-12-02', reason: 'x'}, 'conflict', /already covers Tuesday, December 1/],
    ['bellnote.absences.report', {id: 'child-nico', kind: 'absent', start: '2026-11-18', reason: 'x'}, 'not_permitted', /Nico Reyes does not include custodial rights/],
    ['bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-21', reason: 'x'}, 'not_school_day', /Saturday, November 21 is not a school day/],
    ['bellnote.forms.respond', {id: 'form-k-band', child_id: 'child-nico', action: 'sign', form_version: 1, answers: {'q-emergency': '555-0100'}}, 'not_permitted'],
    ['bellnote.forms.respond', {id: 'form-winter-concert', child_id: 'child-ines', action: 'sign', form_version: 1, answers: {}}, 'missing_answer', /"T-shirt size" needs an answer/],
    ['bellnote.forms.respond', {id: 'form-winter-concert', child_id: 'child-ines', action: 'sign', form_version: 1, answers: {'q-size': 'xxl'}}, 'missing_answer', /"T-shirt size" must be one of the listed options/],
    ['bellnote.forms.respond', {id: 'form-fluclinic', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {'q-consent-allergies': 'none'}}, 'already_answered', /Dana Okafor/],
    ['bellnote.forms.withdraw', {id: 'fr-0005'}, 'not_yours'],
    ['bellnote.forms.withdraw', {id: 'fr-0011'}, 'invalid_state'],
    ['bellnote.forms.respond', {id: 'form-pumpkin', child_id: 'child-theo', action: 'decline', form_version: 1}, 'closed', /closed on Friday, October 9 at 16:00/],
    ['bellnote.pickup.person_add', {id: 'child-theo', name: 'Pat', relationship: 'neighbor', phone: '555-0177', person_id: 'person-rosa'}, 'conflict', /for someone else\. To add the person who has this number, send the request without a person ID/],
    ['bellnote.pickup.person_add', {id: 'child-ines', name: 'Owen Pike', relationship: 'friend', phone: '555-0177'}, 'conflict', /already on Ines Okafor's list \(approved\)/],
    ['bellnote.pickup.person_remove', {id: 'pp-0003'}, 'invalid_state', /already denied/],
    ['bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-16', mode: 'bus'}, 'too_late', /changes on Monday, November 16 passed at 13:40/],
    ['bellnote.dismissal.cancel', {id: 'dc-0001'}, 'too_late'],
    ['bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 200}, 'amount_out_of_range', /between \$5\.00 and \$200\.00/]
  ];
  for (const [name, args, code, text] of cases) {
    const r = f.try(name, args);
    assert.equal(r.status, code, name + ' ' + JSON.stringify(args) + ': ' + r.message);
    clean(r.message, name + ' ' + code);
    if (text) assert.match(r.message, text);
  }
  // A dismissal change still ahead names the person by name and day.
  const g = fixture({seed: reference, now: '2026-11-17T07:00:00-08:00'});
  const owen = g.call('bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-19', mode: 'pickup', person_id: 'person-owen'});
  const inUse = g.try('bellnote.pickup.person_remove', {id: 'pp-0004'});
  assert.equal(inUse.status, 'in_use'); clean(inUse.message, 'in_use');
  assert.match(inUse.message, /Owen Pike is named in the way home for Thursday, November 19/);
  assert.ok(owen.id && own.id);
});

test('an impossible calendar date is refused as such', () => {
  const f = fixture({now: '2026-11-17T07:00:00-08:00'});
  for (const start of ['2026-02-30', '2026-11-31']) {
    const r = f.try('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start, reason: 'x'});
    assert.equal(r.status, 'invalid_window');
    assert.equal(r.message, start + ' is not a calendar date (YYYY-MM-DD).');
  }
  const r = f.try('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-19', end: '2026-11-18', reason: 'x'});
  assert.match(r.message, /must start on or before the day it ends/);
});

test('notifications written by every event kind use names and long dates', () => {
  const f = fixture({seed: reference, now: '2026-11-17T07:00:00-08:00'});
  f.call('bellnote.preferences.update', {email_notices: true});
  const at = m => '2026-11-17T' + m + ':00-08:00';
  f.call('bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-19', mode: 'pickup', person_id: 'person-owen'});
  f.call('bellnote.absences.report', {id: 'child-theo', kind: 'late', start: '2026-11-19', time_local: '10:00', reason: 'Dentist'});
  f.call('bellnote.lunch.topup', {id: 'lunch-theo', amount_cents: 5000});
  const events = [
    ev('attendance.marked', at('09:20'), {child_id: 'child-theo', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}),
    ev('attendance.marked', at('09:21'), {child_id: 'child-nico', date: '2026-11-17', status: 'late', time_local: '09:05', marked_by: 'staff-office-kestrel'}),
    ev('absence.reviewed', at('09:30'), {report_id: 'rep-0006', decision: 'excused', reviewed_by: 'staff-office-alder'}),
    ev('form.published', at('10:00'), {form_id: 'form-zoo', school_id: 'school-alder', child_ids: ['child-theo'], kind: 'permission_slip', title: 'Zoo trip',
      text: 'Bus at 09:00.', questions: [{id: 'q-ok', type: 'boolean', label: 'May attend', required: true}], fee_cents: 900, event_date: '2026-12-02', due_at: '2026-11-30T16:00:00-08:00'}),
    ev('form.changed', at('10:05'), {form_id: 'form-aquarium', change: {fee_cents: 2000, event_date: '2026-12-18'}, reason: 'New booking'}),
    ev('form.answered', at('10:10'), {form_id: 'form-k-physical', child_id: 'child-nico', by_guardian_id: 'person-sam', action: 'sign', form_version: 1, answers: {'q-allergies': 'none'}}),
    ev('pickup.person_reviewed', at('10:20'), {pickup_person_id: 'pp-0004', decision: 'revoke', reviewed_by: 'staff-office-alder'}),
    ev('dismissal.recorded', at('10:30'), {change_id: 'dc-ev-1', child_id: 'child-theo', date: '2026-11-18', mode: 'walker', recorded_by: 'person-dana'}),
    ev('lunch.charged', at('11:50'), {transaction_id: 'tx-ev-2', child_id: 'child-theo', kind: 'refund', amount_cents: -5000, payment_id: 'pay-0008'}),
    ev('lunch.charged', at('12:00'), {transaction_id: 'tx-ev-1', child_id: 'child-theo', kind: 'purchase', amount_cents: -1100, item: 'Pizza', allergens: ['milk', 'wheat']}),
    ev('school.day_changed', at('13:00'), {school_id: 'school-alder', date: '2026-11-19', kind: 'closed', reason: 'Power outage'}),
    ev('school.day_changed', at('13:05'), {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Training'})
  ];
  const n0 = f.data.notifications.length;
  for (const e of events) f.event(e);
  const written = f.data.notifications.slice(n0);
  assert.deepEqual([...new Set(written.map(n => n.kind))].sort(), ['absence.reviewed', 'attendance.unexplained', 'dismissal.recorded', 'dismissal.void', 'form.answered', 'form.changed',
    'form.published', 'lunch.low_balance', 'lunch.refund', 'pickup.person_reviewed', 'school.day_changed'].sort());
  for (const n of written) { clean(n.title, n.kind + ' title'); clean(n.body, n.kind + ' body'); assert.equal(n.wire.data.content.body.text, n.body); }
  const body = kind => written.find(n => n.kind === kind).body;
  assert.match(body('form.published'), /Answers are due by Monday, November 30 at 16:00\./);
  assert.match(body('form.changed'), /The school changed the fee and the event date on "Grade 3 aquarium trip"/);
  assert.match(body('lunch.refund'), /refunded the \$50\.00 top-up of Sunday, October 25 to its payment method/);
  assert.match(body('absence.reviewed'), /The office reviewed your report for Ines Okafor \(Monday, November 23, Tuesday, November 24 and Wednesday, November 25\)/);
  assert.match(body('pickup.person_reviewed'), /The way home planned with them for Thursday, November 19 no longer applies\./);
  const nico = written.find(n => n.kind === 'attendance.unexplained' && n.child_id === 'child-nico');
  assert.doesNotMatch(nico.body, /Open Bellnote to report/, 'Reporting for a child is offered only to a custodial guardian');
  assert.match(written.find(n => n.kind === 'attendance.unexplained' && n.child_id === 'child-theo').body, /Open Bellnote to report the reason\./);
  assert.match(written.find(n => n.kind === 'school.day_changed' && n.title.includes('closed')).body, /Theo Okafor: the late arrival reported on Tuesday, November 17 no longer applies to that day\./);
});

test('tool descriptions state the cut-off and rights rules the handlers apply', () => {
  const d = name => tools.find(t => t.name === 'bellnote.' + name).description;
  // A late arrival is accepted after the absence cut-off, until the stated arrival time.
  const f = fixture({seed: reference, now: '2026-11-17T08:45:00-08:00'});
  assert.equal(f.try('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-17', reason: 'x'}).status, 'too_late');
  assert.equal(f.try('bellnote.absences.report', {id: 'child-theo', kind: 'late', start: '2026-11-17', time_local: '09:30', reason: 'x'}).status, 'committed');
  assert.match(d('absences.report'), /An absence must be reported before the first day's absence cut-off; a late arrival can be reported until the stated arrival time and an early leave until the stated leaving time\./);
  assert.match(d('absences.list'), /an early dismissal moved the end of the day to or before the reported time/);
  // The other guardian's dismissal change can be cancelled by a custodial guardian.
  const g = fixture({seed: reference, now: '2026-11-17T07:00:00-08:00'});
  assert.equal(g.call('bellnote.dismissal.cancel', {id: 'dc-0004'}).state, 'cancelled');
  assert.match(d('dismissal.cancel'), /yours or another custodial guardian's/);
  // The top-up range is the school's effective policy.
  assert.match(d('lunch.topup'), /top-up range of the child's school/);
  for (const name of ['absences.report', 'absences.cancel', 'pickup.person_add', 'pickup.person_remove', 'dismissal.set', 'dismissal.cancel']) assert.match(d(name), /custodial right/, name);
  for (const name of ['lunch.topup', 'lunch.settings_update']) assert.match(d(name), /can_pay right/, name);
  assert.match(d('forms.respond'), /can_sign right/);
  // Stated read defaults match the handlers.
  const r = fixture({seed: reference, now: '2026-11-17T07:00:00-08:00'});
  const win = (name, args = {}) => { const x = r.call('bellnote.' + name, args); return [x.start, x.end]; };
  assert.deepEqual(win('menu.list'), ['2026-11-17', '2026-11-23']); assert.match(d('menu.list'), /default today\.\.\+6/);
  assert.deepEqual(win('pickup.get', {id: 'child-theo'}), ['2026-11-17', '2026-12-01']); assert.match(d('pickup.get'), /default today\.\.\+14/);
  assert.deepEqual(win('lunch.account_get', {id: 'lunch-theo'}), ['2026-11-03', '2026-11-17']); assert.match(d('lunch.account_get'), /default the last 14 days/);
  assert.deepEqual(win('schools.get', {id: 'school-alder'}), ['2026-11-17', '2026-12-01']); assert.match(d('schools.get'), /default today\.\.\+14/);
  assert.deepEqual(win('attendance.list'), ['2026-11-03', '2026-11-17']); assert.match(d('attendance.list'), /default the last 14 days/);
  assert.deepEqual(win('notifications.list'), ['2026-10-18', '2026-11-17']); assert.match(d('notifications.list'), /default the last 30 days/);
  assert.deepEqual(win('payments.list'), ['2026-09-18', '2026-11-17']); assert.match(d('payments.list'), /default the last 60 days/);
});
