'use strict';
// The five scenario events: each example in examples/events/ applies, and each ID rule refuses as the proposal says.
// A refused event changes neither data nor the clock (checked by `refused`).
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');
const {at, MATH, WRITING} = require('./seeds.cjs');

const T = 'tutorwell.';
const ev = (operation, payload, time, id = 'ev-' + operation + '-' + time) => ({event_id: id, at: time, operation: T + operation, payload});
const example = name => require('../examples/events/' + name + '.json');
const book = (f, slot_id, intake) => f.call(T + 'appointments.book', {slot_id, intake});
const status = (f, id) => f.call(T + 'appointments.list').appointments.find(a => a.id === id).status;

test('every example event applies on the example seed, in order, with the effect it describes', () => {
  const f = fixture();
  f.event(example('slot-released'));
  assert.ok(f.call(T + 'slots.list').slots.some(s => s.id === 's5' && s.start === '2027-03-12T15:00:00-05:00' && s.mode === 'online'));
  book(f, 's2', MATH);   // apt-1 on s2, which the next example withdraws
  f.event(example('slot-withdrawn'));
  assert.equal(status(f, 'apt-1'), 'cancelled_by_centre');
  assert.equal(f.call(T + 'profile.get').this_week.count, 0, 'a centre cancellation does not count against the student');
  f.event(example('rules-changed'));
  assert.equal(f.call(T + 'services.list').settings.cancel_cutoff_hours, 24);
  const g = fixture();
  book(g, 's3', WRITING);   // apt-1 on s3 (Wed 14:00), as in E5
  g.event(example('appointment-attended'));
  assert.equal(status(g, 'apt-1'), 'completed');
  g.event(example('report-posted'));
  const [report] = g.call(T + 'reports.list').reports;
  assert.deepEqual([report.appointment_id, report.covered_skill_ids, report.next_focus, report.followups.map(x => x.id)], ['apt-1', ['wr-thesis'], 'wr-evidence', ['fu-1']]);
  assert.equal(g.call(T + 'appointments.list').appointments.find(a => a.id === 'apt-1').report_id, report.id);
});

test('slot.released: a new ID, a known tutor, a start after the event, the tutor\'s mode and no overlap', () => {
  const f = fixture();
  const p = {slot_id: 's8', tutor_id: 't-ben', start: at('03-11', '11:00'), minutes: 50, mode: 'online'};
  refused(f, () => f.event(ev('slot.released', {...p, slot_id: 's1'}, at('03-08', '10:00'))), 'duplicate_id');
  refused(f, () => f.event(ev('slot.released', {...p, tutor_id: 't-zoe'}, at('03-08', '10:00'))), 'unknown_reference');
  refused(f, () => f.event(ev('slot.released', {...p, start: at('03-08', '10:00')}, at('03-08', '10:00'))), 'invalid_value');
  refused(f, () => f.event(ev('slot.released', {...p, mode: 'in_person'}, at('03-08', '10:00'))), 'invalid_value');
  refused(f, () => f.event(ev('slot.released', {...p, start: at('03-10', '14:30')}, at('03-08', '10:00'))), 'invalid_value');   // overlaps s3
  f.event(ev('slot.released', {...p, start: at('03-10', '14:50')}, at('03-08', '10:00')));   // starts when s3 ends
  assert.ok(f.call(T + 'slots.list', {tutor_id: 't-ben'}).slots.some(s => s.id === 's8'));
});

test('slot.withdrawn: an existing slot that has not started; a withdrawn slot can be replaced', () => {
  const f = fixture();
  refused(f, () => f.event(ev('slot.withdrawn', {slot_id: 's9'}, at('03-08', '10:00'))), 'unknown_reference');
  refused(f, () => f.event(ev('slot.withdrawn', {slot_id: 's0'}, at('03-08', '10:00'))), 'invalid_state');
  f.event(ev('slot.withdrawn', {slot_id: 's3'}, at('03-08', '10:00')));
  refused(f, () => f.event(ev('slot.withdrawn', {slot_id: 's3'}, at('03-08', '10:30'))), 'invalid_state');
  assert.ok(!f.call(T + 'slots.list').slots.some(s => s.id === 's3'));
  f.event(ev('slot.released', {slot_id: 's3b', tutor_id: 't-ben', start: at('03-10', '14:00'), minutes: 50, mode: 'online'}, at('03-08', '11:00')));
  assert.ok(f.call(T + 'slots.list').slots.some(s => s.id === 's3b'));
});

test('appointment.attended: only a booked appointment whose session has started, once', () => {
  const f = fixture();
  book(f, 's1', MATH);
  book(f, 's3', WRITING);
  f.call(T + 'appointments.cancel', {appointment_id: 'apt-2'});
  refused(f, () => f.event(ev('appointment.attended', {appointment_id: 'apt-1', outcome: 'completed'}, at('03-09', '15:59'))), 'invalid_state');
  refused(f, () => f.event(ev('appointment.attended', {appointment_id: 'apt-2', outcome: 'completed'}, at('03-10', '15:00'))), 'invalid_state');
  refused(f, () => f.event(ev('appointment.attended', {appointment_id: 'apt-5', outcome: 'completed'}, at('03-10', '15:00'))), 'unknown_reference');
  f.event(ev('appointment.attended', {appointment_id: 'apt-1', outcome: 'completed'}, at('03-09', '16:00')));   // exactly at the start
  assert.equal(status(f, 'apt-1'), 'completed');
  refused(f, () => f.event(ev('appointment.attended', {appointment_id: 'apt-1', outcome: 'no_show'}, at('03-09', '17:00'))), 'invalid_state');
  refused(f, () => f.event(ev('appointment.attended', {appointment_id: 'apt-p1', outcome: 'completed'}, at('03-09', '17:00'))), 'invalid_state');
});

test('report.posted: a completed appointment without a report, known skills, new follow-up IDs and due dates after it', () => {
  const f = fixture();
  book(f, 's3', WRITING);
  const payload = structuredClone(example('report-posted').payload), when = at('03-10', '15:30');
  refused(f, () => f.event(ev('report.posted', payload, when)), 'invalid_state');   // not attended yet
  f.event(example('appointment-attended'));
  refused(f, () => f.event(ev('report.posted', {...payload, covered_skill_ids: ['wr-style']}, when)), 'unknown_reference');
  refused(f, () => f.event(ev('report.posted', {...payload, next_focus: 'wr-style'}, when)), 'unknown_reference');
  refused(f, () => f.event(ev('report.posted', {...payload, followups: [{...payload.followups[0], followup_id: 's1'}]}, when)), 'duplicate_id');
  refused(f, () => f.event(ev('report.posted', {...payload, followups: [payload.followups[0], payload.followups[0]]}, when)), 'duplicate_id');
  refused(f, () => f.event(ev('report.posted', {...payload, followups: [{...payload.followups[0], due_at: at('03-10', '15:00')}]}, when)), 'invalid_value');
  const {next_focus, ...without} = payload;
  f.event(ev('report.posted', {...without, followups: [{followup_id: 'fu-1', kind: 'practice', item_refs: [], minutes: 20}]}, when));
  const [report] = f.call(T + 'reports.list').reports;
  assert.deepEqual([report.next_focus, report.followups[0].due_at], [null, null]);
  refused(f, () => f.event(ev('report.posted', {...payload, followups: []}, at('03-10', '16:00'))), 'invalid_state');   // already has a report
  const g = fixture();
  book(g, 's1', MATH);
  g.event(ev('appointment.attended', {appointment_id: 'apt-1', outcome: 'no_show'}, at('03-09', '17:00')));
  refused(g, () => g.event(ev('report.posted', {appointment_id: 'apt-1', covered_skill_ids: ['alg-factoring'], followups: []}, at('03-09', '18:00'))), 'invalid_state');
});

test('rules.changed: one of the five settings, within its range, to a new value; later bookings follow it', () => {
  const f = fixture();
  refused(f, () => f.event(ev('rules.changed', {setting: 'weekly_cap', value: 0}, at('03-08', '10:00'))), 'invalid_value');
  refused(f, () => f.event(ev('rules.changed', {setting: 'cancel_cutoff_hours', value: 200}, at('03-08', '10:00'))), 'invalid_value');
  refused(f, () => f.event(ev('rules.changed', {setting: 'weekly_cap', value: 2}, at('03-08', '10:00'))), 'invalid_value');
  f.event(ev('rules.changed', {setting: 'weekly_cap', value: 1}, at('03-08', '10:00')));
  book(f, 's1', MATH);
  refused(f, () => book(f, 's3', WRITING), 'weekly_cap');
  assert.deepEqual(f.call(T + 'profile.get').this_week, {week_start: '2027-03-08', count: 1, weekly_cap: 1});
});

test('rules.changed cannot share its time with a recorded cancellation or attendance, which it would re-judge', () => {
  const f = fixture();
  book(f, 's1', MATH);
  f.advance(at('03-08', '20:00'));
  f.call(T + 'appointments.cancel', {appointment_id: 'apt-1'});   // in time: cutoff Tue 04:00
  // With a 24-hour cutoff the same cancellation would be late; dated at the cancellation, the change is refused.
  refused(f, () => f.event(ev('rules.changed', {setting: 'cancel_cutoff_hours', value: 24}, at('03-08', '20:00'))), 'invalid_value');
  f.event(ev('rules.changed', {setting: 'cancel_cutoff_hours', value: 24}, '2027-03-08T20:00:01-05:00'));
  assert.equal(f.call(T + 'appointments.list').appointments.find(a => a.id === 'apt-1').status, 'cancelled');
  const g = fixture();
  book(g, 's1', MATH);
  g.event(ev('appointment.attended', {appointment_id: 'apt-1', outcome: 'no_show'}, at('03-09', '17:00')));
  refused(g, () => g.event(ev('rules.changed', {setting: 'no_show_limit', value: 3}, at('03-09', '17:00'))), 'invalid_value');
  assert.equal(g.call(T + 'profile.get').suspension.cause_appointment_id, 'apt-1', 'the suspension recorded under limit 2 stands');
});
