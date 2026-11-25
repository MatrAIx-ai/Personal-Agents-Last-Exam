'use strict';
// W1 Attendance and absence reports: T01–T03, plus cut-off representation and DST boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, business, ev} = require('./harness.cjs');

const mark = (child_id, date, status, at, extra = {}) => ev('attendance.marked', at, {child_id, date, status, marked_by: 'staff-office-alder', ...extra});
const report = (f, args) => f.call('bellnote.absences.report', {kind: 'absent', reason: 'Fever', ...args});
function refused(f, name, args, code) {
  const before = f.data, rev = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' should be refused with ' + code + ': ' + r.message);
  assert.deepEqual(f.data, before); assert.equal(f.revision, rev);
}

test('T01 attendance lists by child and window; explained and unexplained; a mark before and after a report', () => {
  const f = fixture({now: '2026-11-17T07:10:00-08:00'});
  // Main path: report at 07:10 before the 08:30 cut-off, then the office marks the day.
  const r = report(f, {id: 'child-ines', start: '2026-11-17'});
  assert.equal(r.state, 'submitted');
  assert.equal(r.cutoff_at, '2026-11-17T08:30:00-08:00');
  const notesBefore = f.data.notifications.length;
  f.event(mark('child-ines', '2026-11-17', 'absent', '2026-11-17T09:20:00-08:00'));
  let rec = f.call('bellnote.attendance.list', {id: 'child-ines', start: '2026-11-17', end: '2026-11-17'}).records;
  assert.equal(rec.length, 1); assert.equal(rec[0].explanation, 'explained'); assert.equal(rec[0].report_id, r.id);
  assert.equal(f.data.notifications.length, notesBefore, 'An explained mark writes no notification');
  // A mark with no report: unexplained and exactly one notification.
  f.event(mark('child-theo', '2026-11-17', 'absent', '2026-11-17T09:21:00-08:00'));
  rec = f.call('bellnote.attendance.list', {id: 'child-theo', start: '2026-11-16', end: '2026-11-17'}).records;
  assert.deepEqual(rec.map(x => [x.date, x.status, x.explanation]), [['2026-11-16', 'present', null], ['2026-11-17', 'absent', 'unexplained']]);
  const notes = f.data.notifications.filter(n => n.kind === 'attendance.unexplained');
  assert.equal(notes.length, 1); assert.equal(notes[0].child_id, 'child-theo');
  // The whole-account list and window filtering.
  assert.equal(f.call('bellnote.attendance.list', {start: '2026-11-17', end: '2026-11-17'}).records.length, 2);
  assert.equal(f.call('bellnote.attendance.list', {start: '2026-11-01', end: '2026-11-15'}).records.length, 0, 'A day with no mark has no record');
  assert.equal(f.try('bellnote.attendance.list', {start: '2026-11-18', end: '2026-11-17'}).status, 'invalid_window');
  assert.equal(f.try('bellnote.attendance.list', {id: 'child-zed'}).status, 'not_found');
  // A mark that arrives before the report: a school whose cut-off is 10:00 lets the guardian explain it afterwards.
  const g = fixture({now: '2026-11-17T09:00:00-08:00', mutate: d => { d.district.policy.absence_cutoff_local = {anchor: 'fixed', local_time: '10:00'}; }});
  g.event(mark('child-theo', '2026-11-17', 'absent', '2026-11-17T09:20:00-08:00'));
  assert.equal(g.data.attendance.find(a => a.date === '2026-11-17').explanation, 'unexplained');
  const n0 = g.data.notifications.length;
  g.call('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-17', reason: 'Dentist'});
  const after = g.data.attendance.find(a => a.date === '2026-11-17');
  assert.equal(after.explanation, 'explained');
  assert.equal(g.data.notifications.length, n0, 'My own report writes no notification');
});

test('T02 reports: one day, a range, late arrival and early leave; cut-off boundary; every refusal leaves state unchanged', () => {
  const f = fixture({now: '2026-11-17T07:10:00-08:00'});
  // A range across the Thanksgiving closure covers only school days.
  const range = report(f, {id: 'child-theo', start: '2026-11-23', end: '2026-11-30', reason: 'Family travel'});
  assert.deepEqual(range.dates, ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-30']);
  const late = f.call('bellnote.absences.report', {id: 'child-ines', kind: 'late', start: '2026-11-18', time_local: '10:15', reason: 'Clinic visit'});
  assert.equal(late.state, 'submitted');
  const leave = f.call('bellnote.absences.report', {id: 'child-ines', kind: 'early_leave', start: '2026-11-19', time_local: '13:30', reason: 'Clinic visit'});
  assert.equal(f.call('bellnote.absences.list', {id: leave.id}).reports[0].time_local, '13:30');
  // Refusals.
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-21', reason: 'x'}, 'not_school_day'); // Saturday
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-26', reason: 'x'}, 'not_school_day'); // closed
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-24', end: '2026-11-24', reason: 'x'}, 'conflict');
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-20', end: '2026-11-19', reason: 'x'}, 'invalid_window');
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-12-01', end: '2026-12-15', reason: 'x'}, 'invalid_window'); // 11 school days
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'late', start: '2026-12-01', end: '2026-12-02', time_local: '09:30', reason: 'x'}, 'invalid_window');
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'late', start: '2026-12-01', time_local: '08:00', reason: 'x'}, 'invalid_time');
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'early_leave', start: '2026-12-01', time_local: '15:30', reason: 'x'}, 'invalid_time');
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'early_leave', start: '2026-12-18', time_local: '13:00', reason: 'x'}, 'invalid_time'); // early dismissal 12:30
  refused(f, 'bellnote.absences.report', {id: 'child-theo', kind: 'late', start: '2026-12-01', reason: 'x'}, 'invalid_time'); // no time
  refused(f, 'bellnote.absences.report', {id: 'child-nico', kind: 'absent', start: '2026-12-01', reason: 'x'}, 'not_permitted'); // not custodial
  refused(f, 'bellnote.absences.report', {id: 'child-zed', kind: 'absent', start: '2026-12-01', reason: 'x'}, 'not_found');
  // The cut-off boundary in the district's zone: 08:29:59 is accepted, 08:30:00 and 09:05 are too late.
  const before = fixture({now: '2026-11-17T08:29:59-08:00'});
  assert.equal(report(before, {id: 'child-theo', start: '2026-11-17'}).state, 'submitted');
  for (const now of ['2026-11-17T08:30:00-08:00', '2026-11-17T16:30:00Z', '2026-11-17T09:05:00-08:00']) {
    const late2 = fixture({now});
    refused(late2, 'bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-17', reason: 'Fever'}, 'too_late');
  }
});

test('T02 cut-off rules resolve to dated instants across daylight-saving transitions', () => {
  const term = d => { for (const s of d.schools) s.term.start_date = '2026-01-05'; };
  // Spring forward (Sunday 8 March 2026): Monday's 08:30 cut-off is 15:30Z, not 16:30Z.
  const spring = fixture({now: '2026-03-09T08:29:00-07:00', mutate: term});
  assert.equal(spring.call('bellnote.schools.get', {id: 'school-alder', start: '2026-03-06', end: '2026-03-09'}).days
    .filter(d => d.school_day).map(d => d.absence_cutoff_at).join(), '2026-03-06T08:30:00-08:00,2026-03-09T08:30:00-07:00');
  assert.equal(report(spring, {id: 'child-theo', start: '2026-03-09'}).cutoff_at, '2026-03-09T08:30:00-07:00');
  const springLate = fixture({now: '2026-03-09T15:30:00Z', mutate: term});
  assert.equal(springLate.try('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-03-09', reason: 'x'}).status, 'too_late');
  // Fall back (Sunday 1 November 2026): Monday's cut-off is 16:30Z; 15:45Z (07:45 local) is still in time.
  const fall = fixture({now: '2026-11-02T15:45:00Z'});
  assert.equal(report(fall, {id: 'child-theo', start: '2026-11-02'}).cutoff_at, '2026-11-02T08:30:00-08:00');
  const fallLate = fixture({now: '2026-11-02T16:30:00Z'});
  assert.equal(fallLate.try('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-02', reason: 'x'}).status, 'too_late');
  // A school override and a dismissal-relative rule resolve per day.
  const k = fixture();
  const days = k.call('bellnote.schools.get', {id: 'school-kestrel', start: '2026-12-03', end: '2026-12-04'}).days;
  assert.deepEqual(days.map(d => [d.absence_cutoff_at, d.dismissal_change_cutoff_at]),
    [['2026-12-03T09:00:00-08:00', '2026-12-03T12:00:00-08:00'], ['2026-12-04T09:00:00-08:00', '2026-12-04T12:00:00-08:00']]);
  const a = k.call('bellnote.schools.get', {id: 'school-alder', start: '2026-12-17', end: '2026-12-18'}).days;
  assert.deepEqual(a.map(d => d.dismissal_change_cutoff_at), ['2026-12-17T13:40:00-08:00', '2026-12-18T11:00:00-08:00']);
});

test('T03 cancel ahead of the cut-off, partial cancel, invalid_state, office review and moot on a closed day', () => {
  const f = fixture({now: '2026-11-17T07:10:00-08:00'});
  const one = report(f, {id: 'child-theo', start: '2026-11-18'});
  const c1 = f.call('bellnote.absences.cancel', {id: one.id});
  assert.equal(c1.state, 'cancelled'); assert.deepEqual(c1.cancelled_dates, ['2026-11-18']);
  refused(f, 'bellnote.absences.cancel', {id: one.id}, 'invalid_state');
  refused(f, 'bellnote.absences.cancel', {id: 'rep-9999'}, 'not_found');
  // The same days can be reported again once cancelled.
  report(f, {id: 'child-theo', start: '2026-11-18'});
  // A range whose first day has passed: only the days ahead are cancelled.
  const range = report(f, {id: 'child-ines', start: '2026-11-17', end: '2026-11-19'});
  f.event(mark('child-ines', '2026-11-17', 'absent', '2026-11-17T09:20:00-08:00'));
  const partial = f.call('bellnote.absences.cancel', {id: range.id});
  assert.equal(partial.state, 'submitted'); assert.deepEqual(partial.cancelled_dates, ['2026-11-18', '2026-11-19']);
  assert.deepEqual(partial.remaining_dates, ['2026-11-17']);
  // Office review: excused on the report and the day it covers; one notification.
  const n0 = f.data.notifications.length;
  f.event(ev('absence.reviewed', '2026-11-17T14:00:00-08:00', {report_id: range.id, decision: 'excused', reviewed_by: 'staff-office-alder', note: 'Medical.'}));
  assert.equal(f.call('bellnote.absences.list', {id: range.id}).reports[0].state, 'excused');
  assert.equal(f.data.attendance.find(a => a.id === 'att-child-ines-2026-11-17').office_review, 'excused');
  assert.equal(f.data.notifications.length, n0 + 1);
  refused(f, 'bellnote.absences.cancel', {id: range.id}, 'invalid_state');
  // A second review of the same report is refused as an event, state unchanged.
  const again = f.tryEvent(ev('absence.reviewed', '2026-11-17T14:05:00-08:00', {report_id: range.id, decision: 'unexcused', reviewed_by: 'staff-office-alder'}));
  assert.equal(again.status, 'invalid_event');
  // Unexcused path.
  const g = fixture({now: '2026-11-17T07:00:00-08:00'});
  const r2 = report(g, {id: 'child-theo', start: '2026-11-17'});
  g.event(ev('absence.reviewed', '2026-11-17T15:00:00-08:00', {report_id: r2.id, decision: 'unexcused', reviewed_by: 'staff-office-alder'}));
  assert.equal(g.call('bellnote.absences.list', {child_id: 'child-theo', state: 'unexcused'}).reports.length, 1);
  // A day that becomes closed makes a report for it moot; a moot report cannot be cancelled or reviewed.
  const h = fixture({now: '2026-11-17T07:00:00-08:00'});
  const r3 = report(h, {id: 'child-theo', start: '2026-11-20'});
  const kept = business(h.data);
  h.event(ev('school.day_changed', '2026-11-18T13:05:00-08:00', {school_id: 'school-alder', date: '2026-11-20', kind: 'closed', reason: 'Water main repair'}));
  const view = h.call('bellnote.absences.list', {id: r3.id}).reports[0];
  assert.equal(view.state, 'moot'); assert.equal(view.stored_state, 'submitted');
  assert.deepEqual(h.data.absence_reports, kept.absence_reports, 'Moot is derived at read time, never stored');
  refused(h, 'bellnote.absences.cancel', {id: r3.id}, 'invalid_state');
  assert.equal(h.tryEvent(ev('absence.reviewed', '2026-11-18T14:00:00-08:00', {report_id: r3.id, decision: 'excused', reviewed_by: 'staff-office-alder'})).status, 'invalid_event');
  const closedNote = h.data.notifications.find(n => n.kind === 'school.day_changed');
  assert.match(closedNote.body, /Theo Okafor: the absence reported on Tuesday, November 17 no longer applies to that day\./);
});
