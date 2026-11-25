'use strict';
// Rules where the plan was silent or that cut across workflows: what a non-custodial guardian learns,
// fees on the other guardian's answers, the `answered` listing phase, moot days, refused late events,
// the daily spend with refunds, the person_id mapping, late/early-leave cut-offs, fee decreases and
// exactly one notification per occurrence.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

const Q = [{id: 'q-lunch', type: 'choice', label: 'Lunch', options: ['school_sack_lunch', 'bring_own'], required: true},
  {id: 'q-emergency', type: 'text', label: 'Emergency phone', required: true}];
const ANS = {'q-lunch': 'bring_own', 'q-emergency': '555-0100'};
const publish = (f, at = '2026-11-17T07:30:00-08:00', extra = {}) => f.event(ev('form.published', at, {form_id: 'form-aq', school_id: 'school-alder',
  child_ids: ['child-theo', 'child-ines'], kind: 'permission_slip', title: 'Aquarium', text: 'Trip on 4 December.', questions: Q, fee_cents: 1800,
  event_date: '2026-12-04', due_at: '2026-11-25T16:00:00-08:00', ...extra}));
const PICKUP_WORDS = /collected by|dismissal change|dismissal plan|way home|Sam Reyes|Tomas|pickup|walker|bus/i;
const newNotes = (f, n0) => f.data.notifications.slice(n0);
function refused(f, name, args, code) {
  const before = f.data, r = f.try(name, args);
  assert.equal(r.status, code, name + ': ' + r.message); assert.deepEqual(f.data, before);
}

test('T09/T18 a guardian who is not custodial (Nico) learns nothing of the pickup list', () => {
  const f = fixture({mutate: d => {
    d.people.push({person_id: 'person-tomas', display_name: 'Tomas Ferro', phone: '555-0184'});
    d.pickup_people.push({id: 'pp-0009', child_id: 'child-nico', person_id: 'person-tomas', display_name: 'Tomas Ferro', relationship: 'coach', phone: '555-0184',
      status: 'pending_review', added_by: 'person-sam', created_at: '2026-11-16T18:00:00-08:00', history: []});
  }});
  // children.list omits the default way home for a non-custodial child only.
  const kids = f.call('bellnote.children.list').children;
  assert.equal('default_dismissal' in kids.find(k => k.id === 'child-nico'), false);
  assert.equal(kids.find(k => k.id === 'child-theo').default_dismissal, 'bus');
  // The other guardian's dismissal change is applied, with no notification to this account.
  let n0 = f.data.notifications.length;
  f.event(ev('dismissal.recorded', '2026-11-17T08:00:00-08:00', {change_id: 'dc-n1', child_id: 'child-nico', date: '2026-11-19', mode: 'pickup', person_id: 'person-sam', recorded_by: 'person-sam'}));
  assert.equal(f.data.dismissal_changes.find(d => d.id === 'dc-n1').status, 'active');
  assert.deepEqual(newNotes(f, n0), []);
  assert.equal(f.data.activity.at(-1).action, 'event.dismissal.recorded');
  // Office reviews of Nico's pickup people: no notification, including a revoke that voids a change.
  f.event(ev('pickup.person_reviewed', '2026-11-17T08:05:00-08:00', {pickup_person_id: 'pp-0009', decision: 'approve', reviewed_by: 'staff-office-kestrel'}));
  f.event(ev('dismissal.recorded', '2026-11-17T08:10:00-08:00', {change_id: 'dc-n2', child_id: 'child-nico', date: '2026-11-20', mode: 'pickup', person_id: 'person-tomas', recorded_by: 'person-sam'}));
  f.event(ev('pickup.person_reviewed', '2026-11-17T08:15:00-08:00', {pickup_person_id: 'pp-0009', decision: 'revoke', reviewed_by: 'staff-office-kestrel'}));
  assert.equal(f.data.dismissal_changes.find(d => d.id === 'dc-n2').status, 'void');
  assert.deepEqual(newNotes(f, n0), []);
  // Calendar changes at Nico's school are notified without any pickup detail.
  n0 = f.data.notifications.length;
  f.event(ev('school.day_changed', '2026-11-17T09:00:00-08:00', {school_id: 'school-kestrel', date: '2026-11-19', kind: 'closed', reason: 'Boiler repair'}));
  f.event(ev('school.day_changed', '2026-11-17T09:05:00-08:00', {school_id: 'school-kestrel', date: '2026-11-24', kind: 'early_dismissal', dismissal_local: '12:15', reason: 'Planning'}));
  const notes = newNotes(f, n0);
  assert.deepEqual(notes.map(n => n.kind), ['school.day_changed', 'school.day_changed']);
  for (const n of notes) assert.doesNotMatch(n.body, PICKUP_WORDS, n.body);
  assert.doesNotMatch(notes[1].body, /Changes for that day/);
});

test('T13 closed-day notice names whose dismissal change it was', () => {
  const f = fixture();
  f.call('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-19', mode: 'walker'});
  f.event(ev('dismissal.recorded', '2026-11-17T08:00:00-08:00', {change_id: 'dc-d1', child_id: 'child-ines', date: '2026-11-19', mode: 'pickup', person_id: 'person-dana', recorded_by: 'person-dana'}));
  f.event(ev('school.day_changed', '2026-11-17T09:00:00-08:00', {school_id: 'school-alder', date: '2026-11-19', kind: 'closed', reason: 'Power outage'}));
  const body = f.data.notifications.at(-1).body;
  assert.match(body, /Theo Okafor: your dismissal change \(walking home\) no longer applies/);
  assert.match(body, /Ines Okafor: the dismissal change recorded by Dana Okafor \(collected by Dana Okafor\) no longer applies/);
});

test('T05/T06 the other guardian can sign a fee form only with can_pay for that child', () => {
  const f = fixture();
  publish(f);
  const before = f.data;
  const r = f.tryEvent(ev('form.answered', '2026-11-17T08:00:00-08:00', {form_id: 'form-aq', child_id: 'child-ines', by_guardian_id: 'person-dana', action: 'sign', form_version: 1, answers: ANS}));
  assert.equal(r.status, 'invalid_event'); assert.deepEqual(f.data, before);
  // Declining needs no payment right; signing for a child where they can pay is applied.
  f.event(ev('form.answered', '2026-11-17T08:01:00-08:00', {form_id: 'form-aq', child_id: 'child-ines', by_guardian_id: 'person-dana', action: 'decline', form_version: 1}));
  f.event(ev('form.answered', '2026-11-17T08:02:00-08:00', {form_id: 'form-aq', child_id: 'child-theo', by_guardian_id: 'person-dana', action: 'sign', form_version: 1, answers: ANS}));
  assert.equal(f.data.form_responses.find(x => x.form_id === 'form-aq' && x.child_id === 'child-theo').paid_cents, 1800);
  // A fee rise after their signature: re-signing also needs can_pay.
  const g = fixture();
  publish(g, '2026-11-17T07:30:00-08:00', {fee_cents: 0});
  g.event(ev('form.answered', '2026-11-17T08:00:00-08:00', {form_id: 'form-aq', child_id: 'child-ines', by_guardian_id: 'person-dana', action: 'sign', form_version: 1, answers: ANS}));
  g.event(ev('form.changed', '2026-11-17T09:00:00-08:00', {form_id: 'form-aq', change: {fee_cents: 500}, reason: 'Bus'}));
  assert.equal(g.tryEvent(ev('form.answered', '2026-11-17T09:05:00-08:00', {form_id: 'form-aq', child_id: 'child-ines', by_guardian_id: 'person-dana', action: 'sign', form_version: 2, answers: ANS})).status, 'invalid_event');
});

test('T04 forms.list phase: open, answered (every child in scope signed or declined), closed', () => {
  const f = fixture();
  publish(f);
  const ph = args => Object.fromEntries(f.call('bellnote.forms.list', args).forms.map(x => [x.id, x.phase]));
  assert.equal(ph({})['form-aq'], 'open');
  f.call('bellnote.forms.respond', {id: 'form-aq', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANS});
  assert.equal(ph({child_id: 'child-theo'})['form-aq'], 'answered');
  assert.equal(ph({})['form-aq'], 'open', 'Ines has not answered yet');
  f.call('bellnote.forms.respond', {id: 'form-aq', child_id: 'child-ines', action: 'decline', form_version: 1});
  assert.equal(ph({})['form-aq'], 'answered');
  assert.deepEqual(f.call('bellnote.forms.list', {phase: 'answered'}).forms.map(x => x.id), ['form-aq']);
  f.event(ev('form.changed', '2026-11-18T08:00:00-08:00', {form_id: 'form-aq', change: {text: 'Trip on 11 December.'}, reason: 'Moved'}));
  assert.equal(ph({child_id: 'child-theo'})['form-aq'], 'open', 'A needs_review answer does not count as answered');
  f.advance('2026-11-25T16:00:00-08:00');
  assert.equal(ph({})['form-aq'], 'closed');
  assert.equal(f.call('bellnote.forms.get', {id: 'form-aq'}).form.accepting_answers, false);
});

test('T03 a multi-day report reads moot per day; the whole report only when every day is moot', () => {
  const f = fixture({now: '2026-11-17T07:00:00-08:00'});
  const r = f.call('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-18', end: '2026-11-19', reason: 'x'});
  f.event(ev('school.day_changed', '2026-11-17T09:00:00-08:00', {school_id: 'school-alder', date: '2026-11-19', kind: 'closed', reason: 'Repairs'}));
  let v = f.call('bellnote.absences.list', {id: r.id}).reports[0];
  assert.equal(v.state, 'submitted'); assert.deepEqual(v.moot_dates, ['2026-11-19']);
  assert.deepEqual(v.days.map(d => [d.date, d.state, d.moot_reason]), [['2026-11-18', 'reported', null], ['2026-11-19', 'moot', 'closed']]);
  assert.match(f.data.notifications.at(-1).body, /Theo Okafor: the absence reported on Tuesday, November 17 no longer applies to that day\./);
  assert.deepEqual(f.call('bellnote.absences.cancel', {id: r.id}).cancelled_dates, ['2026-11-18'], 'Only reported days are cancelled');
  const g = fixture({now: '2026-11-17T07:00:00-08:00'});
  const r2 = g.call('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-18', end: '2026-11-19', reason: 'x'});
  for (const [i, date] of ['2026-11-18', '2026-11-19'].entries()) {
    g.event(ev('school.day_changed', '2026-11-17T09:0' + i + ':00-08:00', {school_id: 'school-alder', date, kind: 'closed', reason: 'Repairs'}));
  }
  assert.equal(g.call('bellnote.absences.list', {id: r2.id}).reports[0].state, 'moot');
});

test('Late events are refused: changing a closed form, a dismissal change for a past dismissal', () => {
  const f = fixture();
  publish(f);
  f.advance('2026-11-25T16:00:00-08:00');
  assert.equal(f.tryEvent(ev('form.changed', '2026-11-25T17:00:00-08:00', {form_id: 'form-aq', change: {due_at: '2026-11-30T16:00:00-08:00'}, reason: 'Late'})).status, 'invalid_event');
  const g = fixture({now: '2026-11-18T15:10:00-08:00'});
  for (const date of ['2026-11-16', '2026-11-18']) {
    assert.equal(g.tryEvent(ev('dismissal.recorded', '2026-11-18T15:10:00-08:00', {change_id: 'dc-p-' + date, child_id: 'child-theo', date, mode: 'walker', recorded_by: 'person-dana'})).status, 'invalid_event', date);
  }
  g.event(ev('dismissal.recorded', '2026-11-18T15:10:00-08:00', {change_id: 'dc-next', child_id: 'child-theo', date: '2026-11-19', mode: 'walker', recorded_by: 'person-dana'}));
});

test('An early dismissal before a reported early-leave or arrival time makes that day moot', () => {
  const f = fixture({now: '2026-11-17T07:00:00-08:00'});
  const leave = f.call('bellnote.absences.report', {id: 'child-theo', kind: 'early_leave', start: '2026-11-20', time_local: '14:00', reason: 'Dentist'});
  const late = f.call('bellnote.absences.report', {id: 'child-ines', kind: 'late', start: '2026-11-20', time_local: '13:00', reason: 'Clinic'});
  f.event(ev('school.day_changed', '2026-11-18T09:00:00-08:00', {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Training'}));
  for (const id of [leave.id, late.id]) {
    const v = f.call('bellnote.absences.list', {id}).reports[0];
    assert.equal(v.state, 'moot'); assert.equal(v.days[0].moot_reason, 'time_outside_day');
  }
  assert.match(f.data.notifications.at(-1).body, /Theo Okafor: the early leave reported on Tuesday, November 17 no longer applies to that day\./);
  assert.match(f.data.notifications.at(-1).body, /Ines Okafor: the late arrival reported on Tuesday, November 17 no longer applies to that day\./);
  // A report time still inside the shortened day stays reported.
  const g = fixture({now: '2026-11-17T07:00:00-08:00'});
  const ok = g.call('bellnote.absences.report', {id: 'child-theo', kind: 'early_leave', start: '2026-11-20', time_local: '11:00', reason: 'Dentist'});
  g.event(ev('school.day_changed', '2026-11-18T09:00:00-08:00', {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Training'}));
  assert.equal(g.call('bellnote.absences.list', {id: ok.id}).reports[0].state, 'submitted');
});

test('T02 late arrival and early leave can be reported until the stated time', () => {
  const at = now => fixture({now});
  const leave = {id: 'child-theo', kind: 'early_leave', start: '2026-11-18', time_local: '13:30', reason: 'Dentist'};
  assert.equal(at('2026-11-18T10:00:00-08:00').call('bellnote.absences.report', leave).cutoff_at, '2026-11-18T13:30:00-08:00');
  assert.equal(at('2026-11-18T13:29:59-08:00').try('bellnote.absences.report', leave).status, 'committed');
  assert.equal(at('2026-11-18T13:30:00-08:00').try('bellnote.absences.report', leave).status, 'too_late');
  const late = {id: 'child-theo', kind: 'late', start: '2026-11-18', time_local: '10:15', reason: 'Clinic'};
  assert.equal(at('2026-11-18T10:14:00-08:00').try('bellnote.absences.report', late).status, 'committed');
  assert.equal(at('2026-11-18T10:15:00-08:00').try('bellnote.absences.report', late).status, 'too_late');
  // A full-day absence keeps the morning cut-off.
  assert.equal(at('2026-11-18T10:00:00-08:00').try('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-18', reason: 'x'}).status, 'too_late');
  // Cancelling follows the same rule.
  const f = at('2026-11-18T10:00:00-08:00'), r = f.call('bellnote.absences.report', leave);
  f.advance('2026-11-18T13:30:00-08:00');
  assert.equal(f.try('bellnote.absences.cancel', {id: r.id}).status, 'too_late');
});

test('T16 a same-day meal refund reduces the spending counted against the daily limit', () => {
  const f = fixture();
  f.call('bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 2000});
  f.event(ev('lunch.charged', '2026-11-17T11:00:00-08:00', {transaction_id: 'tx-a', child_id: 'child-ines', kind: 'purchase', amount_cents: -500, item: 'A', allergens: []}));
  f.event(ev('lunch.charged', '2026-11-17T11:10:00-08:00', {transaction_id: 'tx-r', child_id: 'child-ines', kind: 'refund', amount_cents: 500, item: 'A'}));
  f.event(ev('lunch.charged', '2026-11-17T12:00:00-08:00', {transaction_id: 'tx-b', child_id: 'child-ines', kind: 'purchase', amount_cents: -200, item: 'B', allergens: []}));
  f.event(ev('lunch.charged', '2026-11-17T12:30:00-08:00', {transaction_id: 'tx-c', child_id: 'child-ines', kind: 'purchase', amount_cents: -450, item: 'C', allergens: []}));
  const tx = f.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2026-11-17', end: '2026-11-17'}).transactions;
  assert.deepEqual(tx.filter(t => t.kind === 'purchase').map(t => [t.id, t.over_daily_limit]), [['tx-a', false], ['tx-b', false], ['tx-c', true]]);
});

test('T12 an explicit person_id never takes another known person\'s phone number', () => {
  const f = fixture();
  const people = JSON.stringify(f.data.people);
  refused(f, 'bellnote.pickup.person_add', {id: 'child-theo', name: 'Rex Halvorsen', relationship: 'friend', phone: '555-0191', person_id: 'person-june'}, 'restricted_person');
  refused(f, 'bellnote.pickup.person_add', {id: 'child-theo', name: 'June Albright', relationship: 'neighbor', phone: '555-0142', person_id: 'person-june'}, 'conflict');
  const ok = f.call('bellnote.pickup.person_add', {id: 'child-theo', name: 'J. Albright', relationship: 'neighbor', phone: '555-0133', person_id: 'person-june'});
  assert.equal(ok.person_id, 'person-june');
  assert.equal(JSON.stringify(f.data.people), people, 'No person record is created or changed');
});

test('T09 pickup.get shows pickup people in every state, including denied and removed', () => {
  const f = fixture({seed: require('../fixtures/reference.json')});
  const theo = f.call('bellnote.pickup.get', {id: 'child-theo'}).pickup_people.map(p => [p.id, p.status]);
  // pp-h0001 / pp-h0002: the babysitter of the generated history, removed in June 2026.
  assert.deepEqual(theo, [['pp-h0001', 'removed'], ['pp-0001', 'approved'], ['pp-0003', 'denied'], ['pp-0005', 'removed']]);
  const ines = f.call('bellnote.pickup.get', {id: 'child-ines'}).pickup_people.map(p => [p.id, p.status]);
  assert.deepEqual(ines, [['pp-h0002', 'removed'], ['pp-0002', 'pending_review'], ['pp-0004', 'approved']]);
  // Denied and removed people cannot be named.
  for (const person_id of ['person-lena', 'person-owen', 'person-marisol']) {
    assert.equal(f.try('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-19', mode: 'pickup', person_id}).status, 'not_authorized_person', person_id);
  }
});

test('T07 a fee decrease: re-signing charges nothing and refunds nothing; withdrawing refunds the full amount paid', () => {
  const f = fixture();
  publish(f);
  const r = f.call('bellnote.forms.respond', {id: 'form-aq', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANS});
  f.event(ev('form.changed', '2026-11-18T08:00:00-08:00', {form_id: 'form-aq', change: {fee_cents: 1000}, reason: 'Cheaper bus'}));
  const again = f.call('bellnote.forms.respond', {id: 'form-aq', child_id: 'child-theo', action: 'sign', form_version: 2, answers: ANS});
  assert.deepEqual([again.charged_cents, again.paid_cents], [0, 1800]);
  assert.equal(f.call('bellnote.forms.withdraw', {id: r.id}).refunded_cents, 1800);
});

test('T18 each event writes exactly one notification of its kind per occurrence', () => {
  const cases = [
    ['attendance.unexplained', f => f.event(ev('attendance.marked', '2026-11-17T09:20:00-08:00', {child_id: 'child-theo', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}))],
    ['absence.reviewed', f => { const r = f.call('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-18', reason: 'x'});
      f.event(ev('absence.reviewed', '2026-11-17T10:00:00-08:00', {report_id: r.id, decision: 'excused', reviewed_by: 'staff-office-alder'})); }],
    ['form.published', f => publish(f)],
    ['form.changed', f => { publish(f); f.event(ev('form.changed', '2026-11-17T09:00:00-08:00', {form_id: 'form-aq', change: {text: 'New'}, reason: 'x'})); }],
    ['form.answered', f => f.event(ev('form.answered', '2026-11-17T08:00:00-08:00', {form_id: 'form-fluclinic', child_id: 'child-ines', by_guardian_id: 'person-dana', action: 'decline', form_version: 1}))],
    ['pickup.person_reviewed', f => f.event(ev('pickup.person_reviewed', '2026-11-17T08:00:00-08:00', {pickup_person_id: 'pp-0002', decision: 'approve', reviewed_by: 'staff-office-alder'}))],
    ['dismissal.recorded', f => f.event(ev('dismissal.recorded', '2026-11-17T08:00:00-08:00', {change_id: 'dc-x', child_id: 'child-theo', date: '2026-11-19', mode: 'bus', recorded_by: 'person-dana'}))],
    ['dismissal.void', f => { f.call('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-19', mode: 'pickup', person_id: 'person-rosa'});
      f.event(ev('pickup.person_reviewed', '2026-11-17T08:00:00-08:00', {pickup_person_id: 'pp-0001', decision: 'revoke', reviewed_by: 'staff-office-alder'})); }],
    ['lunch.low_balance', f => f.event(ev('lunch.charged', '2026-11-17T12:00:00-08:00', {transaction_id: 'tx-x', child_id: 'child-theo', kind: 'purchase', amount_cents: -900, item: 'x'}))],
    ['lunch.refund', f => f.event(ev('lunch.charged', '2026-11-17T12:00:00-08:00', {transaction_id: 'tx-x', child_id: 'child-theo', kind: 'refund', amount_cents: 375, item: 'x'}))],
    ['school.day_changed', f => f.event(ev('school.day_changed', '2026-11-17T09:00:00-08:00', {school_id: 'school-alder', date: '2026-11-19', kind: 'closed', reason: 'x'}))]
  ];
  assert.deepEqual(cases.map(c => c[0]).sort(), require('../src/notify.cjs').KINDS.slice().sort());
  for (const [kind, run] of cases) {
    const f = fixture(), n0 = f.data.notifications.length;
    run(f);
    const written = newNotes(f, n0);
    assert.equal(written.filter(n => n.kind === kind).length, 1, kind);
    assert.ok(written.every(n => n.event_id), kind + ': notifications come only from events');
    assert.equal(new Set(written.map(n => n.kind)).size, written.length, kind + ': no kind written twice for one occurrence');
  }
});

test('W4 children.list names each child\'s lunch account, so every balance can be read without guessing an ID', () => {
  const f = fixture();
  const kids = f.call('bellnote.children.list').children;
  for (const k of kids) {
    assert.equal(k.lunch_account_id, f.data.lunch_accounts.find(a => a.child_id === k.id).id, k.id);
    assert.equal(f.call('bellnote.lunch.account_get', {id: k.lunch_account_id}).account.child_id, k.id);
  }
  const g = fixture({mutate: d => {
    d.lunch_transactions = d.lunch_transactions.filter(t => t.child_id !== 'child-nico');
    d.payments = d.payments.filter(p => p.child_id !== 'child-nico');
    d.lunch_accounts = d.lunch_accounts.filter(a => a.child_id !== 'child-nico');
  }});
  assert.equal(g.call('bellnote.children.list').children.find(k => k.id === 'child-nico').lunch_account_id, null);
});
