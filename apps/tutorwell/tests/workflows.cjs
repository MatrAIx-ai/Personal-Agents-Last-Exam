'use strict';
// The four workflows end to end through the tools, with every operation's error cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, refused} = require('./harness.cjs');
const {at, history, binding, MATH, WRITING} = require('./seeds.cjs');

const T = 'tutorwell.';
const book = (f, slot_id, intake) => f.call(T + 'appointments.book', {slot_id, intake});
const ids = list => list.map(x => x.id);
const full = () => { const seed = history(); return fixture({seed, binding: binding(seed)}); };
const throwsCode = (fn, code, pattern) => assert.throws(fn, e => (e.code === code && (!pattern || pattern.test(e.message))) || assert.fail(`Expected ${code}, got ${e.code}: ${e.message}`));

test('workflow 1: services with the rules in force, tutors and open slots by service, tutor and skill', () => {
  const f = fixture();
  const s = f.call(T + 'services.list');
  assert.equal(s.rule_version, 'centre-rules/1');
  assert.deepEqual(s.settings, {weekly_cap: 2, cancel_cutoff_hours: 12, no_show_limit: 2, no_show_window_days: 30, suspension_days: 14});
  assert.deepEqual(s.services.map(x => [x.id, x.requires_draft, ids(x.skills)]), [['math', false, ['alg-factoring', 'alg-expand']], ['writing', true, ['wr-thesis', 'wr-evidence']]]);
  assert.ok(s.rules.some(x => x.includes('12 hours before the start')) && s.rules.some(x => x.includes('suspended for 14 days')));
  assert.deepEqual(ids(f.call(T + 'tutors.list', {service_id: 'writing'}).tutors), ['t-ben']);
  assert.deepEqual(ids(f.call(T + 'tutors.list', {skill_id: 'alg-expand'}).tutors), ['t-ana']);
  assert.deepEqual(f.call(T + 'tutors.list').tutors[1], {id: 't-ben', name: 'Ben Osei', service_id: 'writing', skill_ids: ['wr-thesis', 'wr-evidence'], modes: ['online']});
  assert.deepEqual(ids(f.call(T + 'slots.list', {service_id: 'writing'}).slots), ['s3', 's4']);
  assert.deepEqual(ids(f.call(T + 'slots.list', {tutor_id: 't-ana'}).slots), ['s1', 's2']);
  assert.deepEqual(ids(f.call(T + 'slots.list', {skill_id: 'wr-evidence'}).slots), ['s3', 's4']);
  assert.deepEqual(f.call(T + 'slots.list').slots[0], {id: 's1', tutor_id: 't-ana', service_id: 'math', start: '2027-03-09T16:00:00-05:00',
    end: '2027-03-09T16:50:00-05:00', weekday: 'Tue', minutes: 50, mode: 'in_person'});
  for (const [name, args] of [['tutors.list', {service_id: 'chem'}], ['tutors.list', {skill_id: 'calc-1'}], ['slots.list', {tutor_id: 't-zoe'}], ['slots.list', {service_id: 'chem'}]]) {
    throwsCode(() => f.call(T + name, args), 'not_found', /Known: .+ tutorwell\.(services|tutors)\.list lists them\./);
  }
  // A skill ID given as a service, or a service ID as a skill, is named as what it is.
  throwsCode(() => f.call(T + 'tutors.list', {service_id: 'alg-factoring'}), 'not_found', /alg-factoring is a skill \(Factoring polynomials\); filter by it with skill_id\. Services: math/);
  throwsCode(() => f.call(T + 'slots.list', {skill_id: 'writing'}), 'not_found', /writing is a service \(Writing centre\); filter by it with service_id/);
});

test('workflow 1: the student\'s history, reports, accommodations and weekly counts', () => {
  const f = full();
  const list = f.call(T + 'appointments.list').appointments;
  assert.deepEqual(list.map(a => [a.id, a.status, a.counts_toward_week]), [['apt-h1', 'completed', true], ['apt-h2', 'cancelled', false], ['apt-p1', 'no_show', true]]);
  assert.deepEqual(ids(f.call(T + 'appointments.list', {status: 'no_show'}).appointments), ['apt-p1']);
  const h1 = list[0];
  assert.deepEqual([h1.report_id, h1.outcome_recorded_at, h1.cancellation_cutoff, h1.end], ['rep-h1', '2027-01-20T17:00:00-05:00', null, '2027-01-20T16:50:00-05:00']);
  assert.equal(list[1].cancelled_at, '2027-02-01T10:00:00-05:00');
  const [report] = f.call(T + 'reports.list', {appointment_id: 'apt-h1'}).reports;
  assert.deepEqual([report.id, report.next_focus, report.followups.map(x => [x.id, x.status, x.done_at])],
    ['rep-h1', 'alg-factoring', [['fu-h1', 'done', '2027-01-22T09:00:00-05:00'], ['fu-h2', 'open', null]]]);
  assert.deepEqual(f.call(T + 'reports.list', {appointment_id: 'apt-p1'}).reports, []);
  throwsCode(() => f.call(T + 'reports.list', {appointment_id: 'apt-9'}), 'not_found',
    /Appointments with a report: apt-h1 \(Wed 2027-01-20T16:00:00-05:00, Ana Ruiz\)\. tutorwell\.appointments\.list lists them all/);
  const p = f.call(T + 'profile.get');
  assert.deepEqual([p.display_name, p.accommodations], ['Jun Park', [{id: 'acc-1', title: 'Extended time (1.5x) on timed work', consent_to_share: false}]]);
  book(f, 's2', MATH);
  f.event({event_id: 'ev-s', at: at('03-08', '09:30'), operation: T + 'slot.released', payload: {slot_id: 's9', tutor_id: 't-ana', start: '2027-03-16T16:00:00-04:00', minutes: 50, mode: 'online'}});
  book(f, 's9', MATH);
  assert.deepEqual(f.call(T + 'profile.get').weekly_counts, [{week_start: '2027-03-08', count: 1}, {week_start: '2027-03-15', count: 1}]);
});

test('workflow 2: a booking stores the intake; unknown, unavailable and unknown-skill bookings are refused', () => {
  const f = fixture();
  book(f, 's1', {skill_ids: ['alg-factoring'], work_type: 'practice', share_accommodations: false});
  const [a] = f.call(T + 'appointments.list', {status: 'booked'}).appointments;
  assert.deepEqual(a.intake, {skill_ids: ['alg-factoring'], questions: [], item_refs: [], work_type: 'practice', draft_ref: null, share_accommodations: false});
  assert.deepEqual(ids(f.call(T + 'slots.list').slots), ['s3', 's2', 's4'], 'a booked slot is no longer open');
  throwsCode(() => book(f, 's7', MATH), 'not_found', /Open slots: s3, s2, s4\. tutorwell\.slots\.list lists them/);
  refused(f, () => book(f, 's2', {...MATH, skill_ids: ['calc-1']}), 'unknown_reference');
  refused(f, () => book(f, 's1', MATH), 'slot_unavailable');
  f.event(require('../examples/events/slot-withdrawn.json'));   // s2, at 13:00
  refused(f, () => book(f, 's2', MATH), 'slot_unavailable');
  f.advance(at('03-10', '14:00'));
  throwsCode(() => book(f, 's3', WRITING), 'slot_unavailable', /started at 2027-03-10T14:00:00-05:00; it is now 2027-03-10T14:00:00-05:00/);
  // Tutorwell does not judge the choice of skill: a writing booking about factoring is committed, and graders decide.
  assert.equal(book(f, 's4', {...WRITING, skill_ids: ['alg-factoring']}).id, 'apt-2');
});

test('workflow 2: the intake can be changed until the session starts, under the same rules', () => {
  const f = fixture();
  book(f, 's3', WRITING);
  f.call(T + 'appointments.update_intake', {appointment_id: 'apt-1', intake: {questions: ['Is my claim arguable?', 'Where is my evidence thin?'], share_accommodations: true}});
  const intake = () => f.call(T + 'appointments.list').appointments.find(a => a.id === 'apt-1').intake;
  assert.deepEqual([intake().questions.length, intake().share_accommodations, intake().draft_ref], [2, true, 'hist-essay-2-v1']);
  const entry = f.data.evaluator.activity_log[1];
  assert.deepEqual([entry.operation, entry.details.changed, entry.details.before.share_accommodations], [T + 'appointments.update_intake', ['questions', 'share_accommodations'], false]);
  refused(f, () => f.call(T + 'appointments.update_intake', {appointment_id: 'apt-1', intake: {draft_ref: null}}), 'draft_required');
  refused(f, () => f.call(T + 'appointments.update_intake', {appointment_id: 'apt-1', intake: {work_type: 'take_home_exam'}}), 'not_tutorable');
  refused(f, () => f.call(T + 'appointments.update_intake', {appointment_id: 'apt-1', intake: {skill_ids: ['wr-style']}}), 'unknown_reference');
  refused(f, () => f.call(T + 'appointments.update_intake', {appointment_id: 'apt-1', intake: {}}), 'invalid_arguments');
  refused(f, () => f.call(T + 'appointments.update_intake', {appointment_id: 'apt-9', intake: {questions: []}}), 'not_found');
  f.advance(at('03-10', '14:00'));
  refused(f, () => f.call(T + 'appointments.update_intake', {appointment_id: 'apt-1', intake: {questions: []}}), 'session_started');
  const g = fixture();
  book(g, 's1', MATH);
  g.call(T + 'appointments.cancel', {appointment_id: 'apt-1'});
  refused(g, () => g.call(T + 'appointments.update_intake', {appointment_id: 'apt-1', intake: {questions: []}}), 'invalid_state');
});

test('workflow 3: a cancellation in time frees the slot and the week; repeats, started and unknown appointments are refused', () => {
  const f = fixture();
  book(f, 's1', MATH);
  book(f, 's3', WRITING);
  assert.deepEqual(f.call(T + 'appointments.cancel', {appointment_id: 'apt-1'}), {id: 'apt-1', appointment_status: 'cancelled', suspension: null});
  assert.deepEqual(ids(f.call(T + 'slots.list', {tutor_id: 't-ana'}).slots), ['s1', 's2'], 'the slot is open again');
  assert.equal(f.call(T + 'profile.get').this_week.count, 1);
  assert.deepEqual(f.call(T + 'profile.get').no_shows.in_window, 1, 'a cancellation in time is not a no-show');
  refused(f, () => f.call(T + 'appointments.cancel', {appointment_id: 'apt-1'}), 'invalid_state');
  refused(f, () => f.call(T + 'appointments.cancel', {appointment_id: 'apt-7'}), 'not_found');
  // The error lists the appointments that can be cancelled, with their start and tutor.
  throwsCode(() => f.call(T + 'appointments.cancel', {appointment_id: 'tomorrow'}), 'not_found',
    /Booked appointments: apt-2 \(Wed 2027-03-10T14:00:00-05:00, Ben Osei\)\. tutorwell\.appointments\.list lists them all/);
  f.advance(at('03-10', '14:20'));
  throwsCode(() => f.call(T + 'appointments.cancel', {appointment_id: 'apt-2'}), 'session_started', /it is now 2027-03-10T14:20:00-05:00/);
});

test('workflow 4: follow-ups are marked done and open again; repeats and unknown follow-ups are refused', () => {
  const f = full();
  f.call(T + 'followups.set_status', {followup_id: 'fu-h2', status: 'done'});
  const fu = () => f.call(T + 'reports.list').reports[0].followups[1];
  assert.deepEqual([fu().status, fu().done_at], ['done', '2027-03-08T09:00:00-05:00']);
  refused(f, () => f.call(T + 'followups.set_status', {followup_id: 'fu-h2', status: 'done'}), 'invalid_state');
  f.call(T + 'followups.set_status', {followup_id: 'fu-h2', status: 'open'});
  assert.deepEqual([fu().status, fu().done_at], ['open', null]);
  refused(f, () => f.call(T + 'followups.set_status', {followup_id: 'fu-9', status: 'done'}), 'not_found');
  throwsCode(() => f.call(T + 'followups.set_status', {followup_id: 'reading', status: 'done'}), 'not_found',
    /Open: fu-h2 \(read text-7-1\)\. Done: fu-h1\. tutorwell\.reports\.list lists them with their reports\./);
  const log = f.data.evaluator.activity_log;
  assert.deepEqual(log.map(e => [e.object_id, e.appointment_id, e.details.to]), [['fu-h2', 'apt-h1', 'done'], ['fu-h2', 'apt-h1', 'open']]);
});
