'use strict';
// The proposal's expected states E1-E7 (section 2, "Centre rules and expected states"), each from the example seed:
// virtual now Mon 2027-03-08 09:00 (-05:00), America/New_York (clocks move forward on Sun 03-14); weekly_cap 2,
// cancel_cutoff_hours 12, no_show_limit 2, no_show_window_days 30, suspension_days 14; one no-show on Thu 02-25 16:00.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');
const {at, MATH, WRITING} = require('./seeds.cjs');
const {checkAppointments} = require('../src/checker.cjs');

const T = 'tutorwell.';
const book = (f, slot_id, intake) => f.call(T + 'appointments.book', {slot_id, intake});
const appointment = (f, id) => f.call(T + 'appointments.list').appointments.find(a => a.id === id);
const attended = (id, outcome, when) => ({event_id: 'ev-att-' + id + '-' + outcome, at: when, operation: T + 'appointment.attended', payload: {appointment_id: id, outcome}});

test('E1 reading: every result has as_of, profile.get names the zone, four open slots, counts and no suspension', () => {
  const f = fixture();
  for (const name of ['services.list', 'tutors.list', 'slots.list', 'appointments.list', 'reports.list', 'profile.get']) {
    assert.equal(f.call(T + name).as_of, '2027-03-08T09:00:00-05:00', name);   // the harness also checks that reads change nothing
  }
  const profile = f.call(T + 'profile.get');
  assert.equal(profile.time_zone, 'America/New_York');
  assert.deepEqual(f.call(T + 'slots.list').slots.map(s => [s.id, s.start, s.weekday]), [['s1', '2027-03-09T16:00:00-05:00', 'Tue'],
    ['s3', '2027-03-10T14:00:00-05:00', 'Wed'], ['s2', '2027-03-11T16:00:00-05:00', 'Thu'], ['s4', '2027-03-12T10:00:00-05:00', 'Fri']]);
  assert.deepEqual(profile.this_week, {week_start: '2027-03-08', count: 0, weekly_cap: 2});
  assert.deepEqual(profile.no_shows, {in_window: 1, window_days: 30, limit: 2});
  assert.equal(profile.suspension, null);
});

test('E2 weekly cap: s1 and s3 are booked; a third booking that week is refused with weekly_cap', () => {
  const f = fixture();
  assert.deepEqual(book(f, 's1', MATH), {id: 'apt-1', appointment_status: 'booked', cancellation_cutoff: '2027-03-09T04:00:00-05:00'});
  assert.equal(book(f, 's3', WRITING).id, 'apt-2');
  assert.equal(f.call(T + 'profile.get').this_week.count, 2);
  refused(f, () => book(f, 's2', MATH), 'weekly_cap');   // data, clock and version unchanged
  assert.deepEqual(f.call(T + 'appointments.list').appointments.filter(a => a.status === 'booked').map(a => a.slot_id), ['s1', 's3']);
});

test('E3 late cancellation: cutoff Tue 04:00, a cancel at Tue 08:00 suspends Jun until Tue 03-23 09:00 (-04:00)', () => {
  const f = fixture();
  book(f, 's1', MATH);
  f.advance(at('03-09', '08:00'));
  assert.equal(appointment(f, 'apt-1').cancellation_cutoff, '2027-03-09T04:00:00-05:00');
  const suspension = {from: '2027-03-09T08:00:00-05:00', until: '2027-03-23T09:00:00-04:00', cause: 'late_cancel', cause_appointment_id: 'apt-1'};
  assert.deepEqual(f.call(T + 'appointments.cancel', {appointment_id: 'apt-1'}), {id: 'apt-1', appointment_status: 'late_cancel', suspension});
  assert.equal(appointment(f, 'apt-1').status, 'late_cancel');
  const profile = f.call(T + 'profile.get');
  assert.equal(profile.no_shows.in_window, 2, 'the February no-show and the late cancellation');
  assert.deepEqual(profile.suspension, suspension);
  assert.equal(Date.parse(suspension.until) - Date.parse(suspension.from), 14 * 24 * 3600000, 'exactly 14 x 24 hours across the clock change');
  refused(f, () => book(f, 's2', MATH), 'suspended');
});

test('E4 writing centre and take-home work: draft_required and not_tutorable change nothing', () => {
  const f = fixture();
  refused(f, () => book(f, 's4', {...WRITING, draft_ref: null}), 'draft_required');
  refused(f, () => book(f, 's2', {...MATH, work_type: 'take_home_exam'}), 'not_tutorable');
  assert.equal(f.call(T + 'appointments.list').appointments.length, 1);
});

test('E5 report and a refused event: fu-1 is open, then done and logged; a report for an unknown appointment is refused', () => {
  const f = fixture();
  book(f, 's3', WRITING);
  f.event(attended('apt-1', 'completed', at('03-10', '15:00')));
  f.event(require('../examples/events/report-posted.json'));   // the proposal's example input, at 15:30
  const fu = () => f.call(T + 'reports.list').reports[0].followups[0];
  assert.deepEqual(fu(), {id: 'fu-1', kind: 'revise', item_refs: ['hist-essay-2'], minutes: 30, due_at: '2027-03-11T17:00:00-05:00', status: 'open', done_at: null});
  f.call(T + 'followups.set_status', {followup_id: 'fu-1', status: 'done'});
  assert.deepEqual([fu().status, fu().done_at], ['done', '2027-03-10T15:30:00-05:00']);
  const log = f.data.evaluator.activity_log;
  assert.deepEqual(log.map(e => [e.operation, e.object_id]), [[T + 'appointments.book', 'apt-1'], [T + 'followups.set_status', 'fu-1']]);
  refused(f, () => f.event({event_id: 'ev-6', at: at('03-10', '16:00'), operation: T + 'report.posted',
    payload: {appointment_id: 'apt-9', covered_skill_ids: ['wr-thesis'], followups: []}}), 'unknown_reference');
});

test('E6 consent: a booking that shares accommodations is committed and logged with Jun\'s consent false', () => {
  const f = fixture();
  assert.equal(book(f, 's2', {...MATH, share_accommodations: true}).id, 'apt-1');
  const [entry] = f.data.evaluator.activity_log;
  assert.deepEqual(entry.consents, [{accommodation_id: 'acc-1', consent_to_share: false}]);
  const [intake] = checkAppointments(f.snapshot()).intakes;
  assert.deepEqual([intake.appointment_id, intake.intake.share_accommodations, intake.shared_without_consent], ['apt-1', true, ['acc-1']]);
});

test('E7 outcome recorded late: awaiting_outcome still counts; Thursday\'s no-show suspends Jun from Thu 10:00 until 03-25 11:00 (-04:00)', () => {
  const f = fixture();
  book(f, 's1', MATH);
  f.advance(at('03-10', '09:00'));
  const waiting = appointment(f, 'apt-1');
  assert.deepEqual([waiting.status, waiting.counts_toward_week, waiting.cancellation_cutoff], ['awaiting_outcome', true, null]);
  book(f, 's2', MATH);
  let profile = f.call(T + 'profile.get');
  assert.deepEqual([profile.this_week.count, profile.no_shows.in_window], [2, 1]);
  refused(f, () => f.event({event_id: 'ev-r', at: at('03-10', '09:30'), operation: T + 'report.posted',
    payload: {appointment_id: 'apt-1', covered_skill_ids: ['alg-factoring'], followups: []}}), 'invalid_state');
  f.event(attended('apt-1', 'no_show', at('03-11', '10:00')));
  const check = checkAppointments(f.snapshot());
  assert.deepEqual(check.no_shows.find(n => n.appointment_id === 'apt-1'), {appointment_id: 'apt-1', dated_at: '2027-03-09T16:00:00-05:00', recorded_at: '2027-03-11T10:00:00-05:00'});
  profile = f.call(T + 'profile.get');
  assert.equal(profile.no_shows.in_window, 2);
  assert.deepEqual(profile.suspension, {from: '2027-03-11T10:00:00-05:00', until: '2027-03-25T11:00:00-04:00', cause: 'no_show', cause_appointment_id: 'apt-1'});
  assert.equal(appointment(f, 'apt-2').status, 'booked', 's2 stays booked');
  refused(f, () => f.event(attended('apt-1', 'completed', at('03-11', '10:05'))), 'invalid_state');
  assert.equal(appointment(f, 'apt-1').status, 'no_show');
});
