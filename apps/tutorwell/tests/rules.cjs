'use strict';
// centre-rules/1 at its boundaries: the cutoff to the second, the window edge, a late outcome, settings changes that
// alter only later results, Monday-to-Sunday weeks in the student's zone, and the 2027-03-14 clock change.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');
const {at, MATH, WRITING} = require('./seeds.cjs');
const {checkAppointments} = require('../src/checker.cjs');

const T = 'tutorwell.';
const book = (f, slot_id, intake = MATH) => f.call(T + 'appointments.book', {slot_id, intake});
const cancel = (f, id) => f.call(T + 'appointments.cancel', {appointment_id: id});
const ev = (operation, payload, time) => ({event_id: 'ev-' + operation + '-' + time + '-' + JSON.stringify(payload).length, at: time, operation: T + operation, payload});
const release = (f, slot_id, start, when, tutor_id = 't-ana') =>
  f.event({event_id: 'ev-release-' + slot_id, at: when, operation: T + 'slot.released', payload: {slot_id, tutor_id, start, minutes: 50, mode: 'online'}});
const profile = f => f.call(T + 'profile.get');

test('a cancellation exactly at the cutoff is in time; one second later it is late', () => {
  const f = fixture();
  book(f, 's1');
  f.advance(at('03-09', '04:00'));
  assert.equal(cancel(f, 'apt-1').appointment_status, 'cancelled');
  const g = fixture();
  book(g, 's1');
  g.advance('2027-03-09T04:00:01-05:00');
  assert.equal(cancel(g, 'apt-1').appointment_status, 'late_cancel');
  assert.equal(checkAppointments(g.snapshot()).cancellations.find(c => c.appointment_id === 'apt-1').cutoff, '2027-03-09T04:00:00-05:00');
});

test('the window: an incident dated exactly no_show_window_days before counts; one second older does not', () => {
  // The February no-show is dated Thu 02-25 16:00 (-05:00); exactly 30 x 24 hours later is Sat 03-27 17:00 (-04:00),
  // because the clocks moved forward in between. The cancelled slot starts three hours later, so the cancellation is late.
  for (const [cancelAt, counted] of [['2027-03-27T17:00:00-04:00', true], ['2027-03-27T17:00:01-04:00', false]]) {
    const f = fixture();
    release(f, 'sx', '2027-03-27T20:00:00-04:00', at('03-08', '09:00'));
    book(f, 'sx');
    f.advance(cancelAt);
    const r = cancel(f, 'apt-1');
    assert.equal(r.appointment_status, 'late_cancel');
    assert.equal(r.suspension !== null, counted, cancelAt);
    assert.equal(profile(f).no_shows.in_window, counted ? 2 : 1);
  }
});

test('an outcome recorded late counts when it is recorded, dated at the session; it is never inferred from the clock', () => {
  const f = fixture();
  book(f, 's1');
  f.advance('2027-04-30T09:00:00-04:00');   // seven weeks after the session, no attendance event yet
  assert.equal(f.call(T + 'appointments.list', {status: 'awaiting_outcome'}).appointments.length, 1);
  assert.deepEqual([profile(f).no_shows.in_window, profile(f).suspension], [0, null]);
  // Recorded 52 days after the session: dated outside the 30-day window at that moment, so it does not suspend.
  f.event(ev('appointment.attended', {appointment_id: 'apt-1', outcome: 'no_show'}, '2027-04-30T09:00:00-04:00'));
  assert.deepEqual(checkAppointments(f.snapshot()).no_shows.map(n => [n.appointment_id, n.dated_at]), [['apt-p1', '2027-02-25T16:00:00-05:00'], ['apt-1', '2027-03-09T16:00:00-05:00']]);
  assert.deepEqual([profile(f).no_shows.in_window, profile(f).suspension], [0, null]);
});

test('settings changes alter only later results: an earlier suspension and an earlier cancellation stand', () => {
  const f = fixture();
  book(f, 's1');
  book(f, 's3', WRITING);
  f.advance(at('03-08', '20:00'));
  assert.equal(cancel(f, 'apt-2').appointment_status, 'cancelled');   // 18 hours before Wed 14:00, cutoff 12 hours
  f.event(ev('rules.changed', {setting: 'cancel_cutoff_hours', value: 24}, at('03-08', '21:00')));
  assert.equal(f.call(T + 'appointments.list').appointments.find(a => a.id === 'apt-2').status, 'cancelled', 'judged by the cutoff in force then');
  assert.equal(f.call(T + 'appointments.list', {status: 'booked'}).appointments[0].cancellation_cutoff, '2027-03-08T16:00:00-05:00', 'the cutoff shown follows the new setting');
  const late = cancel(f, 'apt-1');   // 19 hours before Tue 16:00: late under the new 24-hour cutoff
  assert.deepEqual([late.appointment_status, late.suspension.until], ['late_cancel', '2027-03-22T22:00:00-04:00']);
  f.event(ev('rules.changed', {setting: 'no_show_limit', value: 3}, at('03-08', '21:30')));
  f.event(ev('rules.changed', {setting: 'suspension_days', value: 7}, at('03-08', '21:40')));
  assert.equal(profile(f).suspension.until, '2027-03-22T22:00:00-04:00', 'the suspension already recorded stands');
  const s = checkAppointments(f.snapshot()).suspensions;
  assert.deepEqual(s.map(x => [x.cause_appointment_id, x.settings.no_show_limit, x.settings.suspension_days, x.counted]), [['apt-1', 2, 14, ['apt-p1', 'apt-1']]]);
});

test('a suspension ends exactly at its end; bookings are refused until then, and booked appointments stay', () => {
  const f = fixture();
  book(f, 's1');
  book(f, 's2');
  f.advance(at('03-09', '08:00'));
  const {suspension} = cancel(f, 'apt-1');
  assert.equal(f.call(T + 'appointments.list').appointments.find(a => a.id === 'apt-2').status, 'booked');
  release(f, 'sy', '2027-03-24T16:00:00-04:00', at('03-09', '08:30'));
  f.advance('2027-03-23T08:59:59-04:00');
  refused(f, () => book(f, 'sy'), 'suspended');
  f.advance(suspension.until);
  assert.equal(book(f, 'sy').id, 'apt-3');
});

test('weeks run Monday to Sunday in the student\'s zone; awaiting, completed and no-show count, cancellations do not', () => {
  const f = fixture();
  // Sun 03-14 23:00 (-04:00) is in the week of Mon 03-08; Mon 03-15 00:00 (-04:00) starts the next week.
  release(f, 'sun', '2027-03-14T23:00:00-04:00', at('03-08', '09:00'));
  release(f, 'mon', '2027-03-15T00:00:00-04:00', at('03-08', '09:00'));
  book(f, 's1');
  book(f, 'sun');
  refused(f, () => book(f, 's2'), 'weekly_cap');
  assert.equal(book(f, 'mon').id, 'apt-3');
  assert.deepEqual(profile(f).weekly_counts, [{week_start: '2027-03-08', count: 2}, {week_start: '2027-03-15', count: 1}]);
  f.advance(at('03-09', '17:00'));
  f.event(ev('appointment.attended', {appointment_id: 'apt-1', outcome: 'completed'}, at('03-09', '17:00')));
  refused(f, () => book(f, 's2'), 'weekly_cap');   // a completed session still counts
  cancel(f, 'apt-2');   // Sunday's, in time
  assert.equal(book(f, 's2').id, 'apt-4');
});

test('times after the clock change are written with -04:00, and durations stay exact', () => {
  const f = fixture();
  release(f, 'late', '2027-03-15T16:00:00-04:00', at('03-08', '09:00'));
  const r = book(f, 'late');
  assert.equal(r.cancellation_cutoff, '2027-03-15T04:00:00-04:00');
  f.advance('2027-03-14T12:00:00Z');   // the clock may be given in UTC; results still use the student's zone
  assert.equal(profile(f).as_of, '2027-03-14T08:00:00-04:00');
  const slot = f.call(T + 'slots.list').slots.find(s => s.id === 's4');
  assert.equal(slot, undefined, 's4 has started');
  assert.equal(f.call(T + 'appointments.list').appointments.find(a => a.id === 'apt-1').end, '2027-03-15T16:50:00-04:00');
});
