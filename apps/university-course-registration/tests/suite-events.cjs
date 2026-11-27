'use strict';
// Infra events: competitors moving through the shared ledger, section-time
// changes and offer expiry. Loaded by business.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {APP, fixture, read, clone, withSeed, seatsOf, section, rejected, recordChecks, holdingCs240, swapOffered, offered, event, EXAMPLE_EVENTS,
  refusedEvent, entryOf, offerOf, enrollmentOf} = require('./support.cjs');

const CS240_LAB1 = ['sec-cs240-lec1', 'sec-cs240-lab1'], CS240_LAB2 = ['sec-cs240-lec1', 'sec-cs240-lab2'];
const own = f => f.data.enrollments.filter(e => e.occupant_ref === 'stu-noor' && e.status === 'enrolled');
const occupancy = (id, at, payload) => event(id, at, 'occupancy.change', payload);

test('the proposal\'s three-event example replays exactly on the packaged seed', () => {
  assert.deepEqual(read('examples/scenario.json'), EXAMPLE_EVENTS[0], 'the packaged example scenario is evt-0007 itself');
  assert.equal(read('fixtures/minimal.json').enrollment_policy.offer_window_minutes, 24 * 60);
  const f = fixture(), [withdraws, reschedules, expires] = EXAMPLE_EVENTS;

  // evt-0007: the synthetic student's whole CS240 bundle is released, freeing
  // the last lab seat the first eligible entry needed.
  f.event(withdraws);
  assert.deepEqual([enrollmentOf(f, 'enr-synthetic-017-cs240').status, enrollmentOf(f, 'enr-synthetic-017-cs240').ended_at], ['withdrawn', withdraws.at]);
  assert.deepEqual(f.data.offers, [{id: 'off-6', seq: 6, entry_id: 'wl-noor-cs240', held_section_ids: CS240_LAB1, issued_at: withdraws.at,
    expires_at: '2027-01-12T09:30:00-05:00', status: 'live', resolved_at: null}]);
  assert.deepEqual(f.data.waitlist_entries.map(e => [e.id, e.status]), [['wl-noor-cs240', 'offered'], ['wl-synthetic-021-cs240', 'queued']]);
  assert.deepEqual(seatsOf(f, 'sec-cs240-lec1'), {capacity: 60, enrolled: 52, held: 1, available: 7});
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 12, enrolled: 11, held: 1, available: 0}, 'capacity did not change; the freed seat is held');
  assert.deepEqual(f.data.notices.map(n => [n.kind, n.at, n.refs.event_id, n.refs.offer_id]), [['offer_issued', withdraws.at, 'evt-0007', 'off-6']]);
  assert.deepEqual([f.now, f.version.revision], [withdraws.at, 1]);

  // evt-0012: an enrolled MATH221 section moves into another enrolled course's time.
  const enrollments = f.data.enrollments;
  f.event(reschedules);
  const lecture = section(f.data, 'sec-math221-lec1');
  assert.deepEqual([lecture.version, lecture.meetings, lecture.history], [2, [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}],
    [{version: 1, meetings: [{days: ['MON', 'WED'], start: '10:00', end: '11:20'}], replaced_at: reschedules.at, event_id: 'evt-0012'}]]);
  assert.deepEqual(f.data.enrollments, enrollments, 'no enrollment was dropped or changed');
  assert.deepEqual(f.call('schedule.get').conflicts, [{section_ids: ['sec-math221-lec1', 'sec-stat210-lec1'],
    caused_by: {event_id: 'evt-0012', section_id: 'sec-math221-lec1', replaced_at: reschedules.at, from_version: 1, to_version: 2}}]);
  const told = f.data.notices[1];
  assert.deepEqual([told.id, told.kind, told.at, told.refs], ['ntc-8', 'section_rescheduled', reschedules.at,
    {event_id: 'evt-0012', course_id: 'crs-math221', section_id: 'sec-math221-lec1', from_version: 1, to_version: 2, enrollment_id: 'enr-noor-math221'}]);
  assert.match(told.text, /MATH221 LEC 1 now meets TUE\/THU 14:30-15:50 \(was MON\/WED 10:00-11:20\)\. It now overlaps STAT210 LEC 1\. Your enrollments are unchanged/);
  assert.equal(offerOf(f, 'off-6').status, 'live', 'the offer is untouched');

  // evt-0015: with no acceptance in between, the offer expires at its deadline,
  // its hold is released and the bundle is offered to the next eligible entry.
  f.event(expires);
  assert.deepEqual([offerOf(f, 'off-6').status, offerOf(f, 'off-6').resolved_at], ['expired', expires.at]);
  assert.deepEqual([entryOf(f, 'wl-noor-cs240').status, entryOf(f, 'wl-noor-cs240').ended_at, entryOf(f, 'wl-noor-cs240').end_reason], ['expired', expires.at, 'expired']);
  assert.deepEqual(f.data.offers[1], {id: 'off-10', seq: 10, entry_id: 'wl-synthetic-021-cs240', held_section_ids: CS240_LAB1, issued_at: expires.at,
    expires_at: '2027-01-13T09:30:00-05:00', status: 'live', resolved_at: null});
  assert.equal(entryOf(f, 'wl-synthetic-021-cs240').status, 'offered');
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 12, enrolled: 11, held: 1, available: 0}, 'held again, now for the next entry');
  const last = f.data.notices[2];
  assert.deepEqual([last.id, last.kind, last.refs], ['ntc-9', 'offer_expired',
    {event_id: 'evt-0015', course_id: 'crs-cs240', entry_id: 'wl-noor-cs240', offer_id: 'off-6', expires_at: '2027-01-12T09:30:00-05:00'}]);
  assert.equal(f.data.notices.length, 3, 'the competitor\'s offer produces no notice for the student');
  // The student ends with what she started with: two courses, six credits, nothing waiting.
  assert.deepEqual([own(f).map(e => e.course_id), f.call('schedule.get').credits, f.call('waitlist.list').entries, f.call('waitlist.list').offers],
    [['crs-math221', 'crs-stat210'], {enrolled: 6, limit: 16}, [], []]);
  assert.deepEqual([f.now, f.version.revision, f.data.counters.next_seq], [expires.at, 3, 11]);
  recordChecks(f.data);
});

test('the event contract accepts the documented envelopes and nothing else', () => {
  const {eventValid} = require('./support.cjs');
  for (const envelope of EXAMPLE_EVENTS) assert.ok(eventValid(envelope), envelope.event_id);
  const broken = (index, change) => { const envelope = clone(EXAMPLE_EVENTS[index]); change(envelope); assert.equal(eventValid(envelope), false); };
  broken(0, e => { e.at = '2027-01-11T09:30:00'; });
  broken(0, e => { e.payload.change = 'teleport'; });
  broken(0, e => { delete e.payload.enrollment_id; });
  broken(1, e => { e.payload.meetings[0].start = '25:00'; });
  broken(2, e => { e.payload.note = 'x'; });
  broken(2, e => { e.operation = APP + '.capacity.change'; });
  assert.deepEqual(read('app.json').event_types, ['occupancy.change', 'section.reschedule', 'offers.expire'].map(name => APP + '.' + name));
  const f = fixture();
  assert.throws(() => plugin.applyEvent(f.context, f.data, {...EXAMPLE_EVENTS[0], operation: APP + '.capacity.change'}), {code: 'invalid_event'});
});

test('occupancy.change moves competitors through the same ledger and never the student', () => {
  const f = fixture(), t = f.now;
  // Enroll: takes a seat like anyone else, under the ID the scenario gives or a generated one.
  f.event(occupancy('e-1', t, {change: 'enroll', occupant_ref: 'synthetic-060', section_ids: CS240_LAB2, enrollment_id: 'enr-synthetic-060-cs240'}));
  assert.deepEqual(enrollmentOf(f, 'enr-synthetic-060-cs240'), {id: 'enr-synthetic-060-cs240', seq: 6, occupant_ref: 'synthetic-060', course_id: 'crs-cs240',
    section_ids: CS240_LAB2, status: 'enrolled', enrolled_at: t, ended_at: null});
  assert.equal(seatsOf(f, 'sec-cs240-lab2').available, 2);
  f.event(occupancy('e-2', t, {change: 'enroll', occupant_ref: 'synthetic-061', section_ids: ['sec-hist105-lec1']}));
  assert.deepEqual(f.data.enrollments[f.data.enrollments.length - 1].id, 'enr-7');
  // Refused like anyone else: full section, duplicate course, invalid bundle, unknown rows, a used ID.
  refusedEvent(f, occupancy('e-3', t, {change: 'enroll', occupant_ref: 'synthetic-062', section_ids: CS240_LAB1}), 'section_full', /sec-cs240-lab1/);
  refusedEvent(f, occupancy('e-4', t, {change: 'enroll', occupant_ref: 'synthetic-060', section_ids: CS240_LAB2}), 'duplicate_enrollment');
  refusedEvent(f, occupancy('e-5', t, {change: 'enroll', occupant_ref: 'synthetic-062', section_ids: ['sec-cs240-lec1']}), 'invalid_bundle');
  refusedEvent(f, occupancy('e-6', t, {change: 'enroll', occupant_ref: 'synthetic-062', section_ids: ['sec-none']}), 'not_found');
  refusedEvent(f, occupancy('e-7', t, {change: 'enroll', occupant_ref: 'synthetic-062', section_ids: ['sec-hist105-lec1'], enrollment_id: 'enr-noor-math221'}), 'invalid_event', /already in use/);
  refusedEvent(f, occupancy('e-8', t, {change: 'withdraw', occupant_ref: 'synthetic-060', enrollment_id: 'enr-synthetic-017-cs240'}), 'not_found');

  // Waitlist: joins at the back; only for a bundle without seats.
  f.event(occupancy('e-9', t, {change: 'waitlist_join', occupant_ref: 'synthetic-063', section_ids: CS240_LAB1, entry_id: 'wl-synthetic-063-cs240'}));
  assert.deepEqual(entryOf(f, 'wl-synthetic-063-cs240'), {id: 'wl-synthetic-063-cs240', seq: 8, occupant_ref: 'synthetic-063', course_id: 'crs-cs240',
    section_ids: CS240_LAB1, swap_from_enrollment_id: null, status: 'queued', joined_at: t, ended_at: null, end_reason: null, blocked_reason: null});
  refusedEvent(f, occupancy('e-10', t, {change: 'waitlist_join', occupant_ref: 'synthetic-063', section_ids: CS240_LAB1}), 'invalid_state', /already waiting/);
  refusedEvent(f, occupancy('e-11', t, {change: 'waitlist_join', occupant_ref: 'synthetic-064', section_ids: ['sec-hist105-lec1']}), 'seats_available');
  refusedEvent(f, occupancy('e-12', t, {change: 'waitlist_join', occupant_ref: 'synthetic-060', section_ids: CS240_LAB1}), 'swap_required');
  f.event(occupancy('e-13', t, {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-synthetic-021-cs240'}));
  assert.deepEqual([entryOf(f, 'wl-synthetic-021-cs240').status, entryOf(f, 'wl-synthetic-021-cs240').end_reason], ['left', 'left']);
  refusedEvent(f, occupancy('e-14', t, {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-synthetic-021-cs240'}), 'invalid_state');

  // The student is never moved by an event, whatever the change.
  for (const payload of [{change: 'withdraw', enrollment_id: 'enr-noor-math221'}, {change: 'enroll', section_ids: ['sec-hist105-lec1']},
    {change: 'waitlist_leave', entry_id: 'wl-noor-cs240'}, {change: 'waitlist_join', section_ids: ['sec-psyc100-lec1']}]) {
    refusedEvent(f, occupancy('e-student-' + payload.change, t, {...payload, occupant_ref: 'stu-noor'}), 'invalid_event', /signed-in student/);
  }
  assert.deepEqual([f.data.notices, f.data.receipts], [[], []], 'competitor events leave the student no notices and no receipts');
  recordChecks(f.data);
});

test('competitors accept, decline and lose offers under the same rules', () => {
  // The student is blocked, so the seat freed by evt-0007 is offered to the competitor behind her.
  const start = () => {
    const f = fixture({data: withSeed(d => { d.student.credit_limit = 9; })});
    f.event(EXAMPLE_EVENTS[0]);
    assert.deepEqual(f.data.offers.map(o => [o.id, o.entry_id, o.expires_at]), [['off-6', 'wl-synthetic-021-cs240', '2027-01-12T09:30:00-05:00']]);
    return f;
  };
  const accepted = start();
  accepted.event(occupancy('c-1', '2027-01-12T09:29:59-05:00', {change: 'offer_accept', occupant_ref: 'synthetic-021', offer_id: 'off-6'}));
  const row = accepted.data.enrollments[accepted.data.enrollments.length - 1];
  assert.deepEqual([row.id, row.occupant_ref, row.section_ids, row.status], ['enr-7', 'synthetic-021', CS240_LAB1, 'enrolled']);
  assert.deepEqual([offerOf(accepted, 'off-6').status, entryOf(accepted, 'wl-synthetic-021-cs240').status], ['accepted', 'fulfilled']);
  assert.deepEqual(seatsOf(accepted, 'sec-cs240-lab1'), {capacity: 12, enrolled: 12, held: 0, available: 0});
  assert.equal(entryOf(accepted, 'wl-noor-cs240').status, 'queued', 'the student keeps waiting');

  // The expiry boundary applies to everyone: at the deadline it is too late.
  const late = start();
  refusedEvent(late, occupancy('c-2', '2027-01-12T09:30:00-05:00', {change: 'offer_accept', occupant_ref: 'synthetic-021', offer_id: 'off-6'}), 'offer_expired');
  refusedEvent(late, occupancy('c-2b', '2027-01-12T09:30:00-05:00', {change: 'offer_decline', occupant_ref: 'synthetic-021', offer_id: 'off-6'}), 'offer_expired',
    /Offer off-6 expired at 2027-01-12T09:30:00-05:00/);
  refusedEvent(late, occupancy('c-3', late.now, {change: 'offer_accept', occupant_ref: 'synthetic-099', offer_id: 'off-6'}), 'not_found');
  late.event(occupancy('c-4', late.now, {change: 'offer_decline', occupant_ref: 'synthetic-021', offer_id: 'off-6'}));
  assert.deepEqual([offerOf(late, 'off-6').status, entryOf(late, 'wl-synthetic-021-cs240').status, seatsOf(late, 'sec-cs240-lab1').held], ['declined', 'declined', 0]);
  refusedEvent(late, occupancy('c-5', late.now, {change: 'offer_decline', occupant_ref: 'synthetic-021', offer_id: 'off-6'}), 'offer_not_live');
  // Past the deadline a competitor can still leave the queue; that gives the held seat back.
  const overdue = start();
  overdue.event(occupancy('c-8', '2027-01-12T10:00:00-05:00', {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-synthetic-021-cs240'}));
  assert.deepEqual([offerOf(overdue, 'off-6').status, offerOf(overdue, 'off-6').resolved_at, entryOf(overdue, 'wl-synthetic-021-cs240').status, seatsOf(overdue, 'sec-cs240-lab1').held],
    ['cancelled', '2027-01-12T10:00:00-05:00', 'left', 0]);
  // An Infra event cannot resolve the student's own offer.
  const mine = offered();
  refusedEvent(mine, occupancy('c-6', mine.now, {change: 'offer_accept', occupant_ref: 'stu-noor', offer_id: 'off-6'}), 'invalid_event');
  refusedEvent(mine, occupancy('c-7', mine.now, {change: 'offer_accept', occupant_ref: 'synthetic-021', offer_id: 'off-6'}), 'not_found');
});

test('a competitor withdrawing cancels their own pending swap, without a notice to the student', () => {
  // The competitor behind the student holds PHYS150 and waits to swap into CS240.
  const f = fixture({data: withSeed(d => {
    d.enrollments.push({id: 'enr-synthetic-021-hist105', seq: 6, occupant_ref: 'synthetic-021', course_id: 'crs-hist105', section_ids: ['sec-hist105-lec1'],
      status: 'enrolled', enrolled_at: '2026-12-05T09:00:00-05:00', ended_at: null});
    d.waitlist_entries[1].swap_from_enrollment_id = 'enr-synthetic-021-hist105';
    d.counters.next_seq = 7;
  })});
  f.event(occupancy('w-1', f.now, {change: 'withdraw', occupant_ref: 'synthetic-021', enrollment_id: 'enr-synthetic-021-hist105'}));
  assert.deepEqual([entryOf(f, 'wl-synthetic-021-cs240').status, entryOf(f, 'wl-synthetic-021-cs240').end_reason], ['cancelled', 'source_withdrawn']);
  assert.deepEqual(f.data.notices, []);
  assert.equal(seatsOf(f, 'sec-hist105-lec1').enrolled, 35);
});

test('a section-time change is recorded, attributed and told; nothing is dropped', () => {
  const f = fixture(), t = '2027-01-11T10:00:00-05:00';
  refusedEvent(f, event('r-1', t, 'section.reschedule', {section_id: 'sec-none', meetings: []}), 'not_found');
  refusedEvent(f, event('r-2', t, 'section.reschedule', {section_id: 'sec-math221-lec1', meetings: [{start: '10:00', end: '11:20', days: ['MON', 'WED']}]}),
    'invalid_event', /already meets at these times/);
  // The same times listed in another order are still the same times.
  const lab2 = {section_id: 'sec-cs240-lab2', meetings: [{days: ['TUE'], start: '14:00', end: '15:50'}, {days: ['THU', 'FRI'], start: '09:00', end: '09:50'}]};
  const twice = fixture({data: withSeed(d => { section(d, 'sec-cs240-lab2').meetings = clone(lab2.meetings); })});
  refusedEvent(twice, event('r-2b', t, 'section.reschedule', {...lab2, meetings: [{days: ['FRI', 'THU'], start: '09:00', end: '09:50'}, lab2.meetings[0]]}),
    'invalid_event', /already meets at these times/);
  // Nor are they new times when one meeting is split by day, two are merged, or one is listed twice.
  const split = [{days: ['WED'], start: '10:00', end: '11:20'}, {days: ['MON'], start: '10:00', end: '11:20'}];
  refusedEvent(f, event('r-2d', t, 'section.reschedule', {section_id: 'sec-math221-lec1', meetings: split}), 'invalid_event', /already meets at these times/);
  const stored = fixture({data: withSeed(d => { section(d, 'sec-math221-lec1').meetings = clone(split); })});
  refusedEvent(stored, event('r-2e', t, 'section.reschedule', {section_id: 'sec-math221-lec1', meetings: [{days: ['MON', 'WED'], start: '10:00', end: '11:20'}]}),
    'invalid_event', /already meets at these times/);
  const friday = {days: ['FRI'], start: '13:00', end: '15:50'};
  refusedEvent(f, event('r-2f', t, 'section.reschedule', {section_id: 'sec-hist105-lec1', meetings: [friday, clone(friday)]}), 'invalid_event', /already meets at these times/);
  assert.deepEqual([section(f.data, 'sec-math221-lec1').version, section(f.data, 'sec-hist105-lec1').version, f.data.notices], [1, 1, []]);
  // One day of a split meeting at another time is a change, as is losing a meeting.
  stored.event(event('r-2g', t, 'section.reschedule', {section_id: 'sec-math221-lec1', meetings: [split[1], {...split[0], end: '11:30'}]}));
  assert.equal(section(stored.data, 'sec-math221-lec1').version, 2);
  twice.event(event('r-2c', t, 'section.reschedule', {...lab2, meetings: [lab2.meetings[0]]}));
  assert.equal(section(twice.data, 'sec-cs240-lab2').version, 2, 'dropping one of two meetings is a change');
  // A meeting that does not start before it ends is the event's fault, and says so.
  for (const [start, end] of [['11:00', '10:00'], ['10:00', '10:00']]) {
    refusedEvent(f, event('r-3', t, 'section.reschedule', {section_id: 'sec-math221-lec1',
      meetings: [{days: ['MON'], start: '10:00', end: '11:20'}, {days: ['WED'], start, end}]}), 'invalid_event', /must start before it ends: WED/);
  }

  // A section the student neither holds nor waits for: recorded, no notice.
  f.event(event('r-4', t, 'section.reschedule', {section_id: 'sec-hist105-lec1', meetings: [{days: ['FRI'], start: '14:00', end: '16:50'}]}));
  assert.deepEqual([section(f.data, 'sec-hist105-lec1').version, section(f.data, 'sec-hist105-lec1').history.length, f.data.notices], [2, 1, []]);
  // A section of the bundle she waits for: told, place unchanged.
  f.event(event('r-5', t, 'section.reschedule', {section_id: 'sec-cs240-lab1', meetings: [{days: ['FRI'], start: '11:00', end: '12:50'}]}));
  assert.deepEqual(f.data.notices.map(n => [n.kind, n.refs]), [['section_rescheduled',
    {event_id: 'r-5', course_id: 'crs-cs240', section_id: 'sec-cs240-lab1', from_version: 1, to_version: 2, entry_id: 'wl-noor-cs240'}]]);
  assert.match(f.data.notices[0].text, /your place in the queue is unchanged/);
  // A held section moved without creating an overlap.
  f.event(event('r-6', t, 'section.reschedule', {section_id: 'sec-stat210-lec1', meetings: [{days: ['TUE', 'THU'], start: '16:00', end: '17:20'}]}));
  assert.match(f.data.notices[1].text, /STAT210 LEC 1 now meets TUE\/THU 16:00-17:20 \(was TUE\/THU 14:00-15:20\)\. Your enrollment is unchanged\./);
  assert.deepEqual(f.call('schedule.get').conflicts, []);
  // A second move of the same section keeps the whole history, and the cause names the latest change.
  f.event(event('r-7', '2027-01-11T11:00:00-05:00', 'section.reschedule', {section_id: 'sec-stat210-lec1', meetings: [{days: ['MON', 'WED'], start: '10:30', end: '11:50'}]}));
  const stat = section(f.data, 'sec-stat210-lec1');
  assert.deepEqual([stat.version, stat.history.map(h => [h.version, h.event_id])], [3, [[1, 'r-6'], [2, 'r-7']]]);
  assert.deepEqual(f.call('schedule.get').conflicts, [{section_ids: ['sec-math221-lec1', 'sec-stat210-lec1'],
    caused_by: {event_id: 'r-7', section_id: 'sec-stat210-lec1', replaced_at: '2027-01-11T11:00:00-05:00', from_version: 2, to_version: 3}}]);
  assert.deepEqual(own(f).map(e => e.course_id), ['crs-math221', 'crs-stat210'], 'both courses are still held');
  // The conflict is hers to repair; a repair is allowed, a new conflict is not.
  rejected(f, () => f.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-econ101-lec1']}), 'time_conflict');
  f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']});
  assert.deepEqual(f.call('schedule.get').conflicts, []);
  recordChecks(f.data);
});

test('a section-time change re-checks the queue: a blocked entry can become eligible, and the reverse', () => {
  // The student's target lab overlaps STAT210, so the freed seat passes her by.
  const f = fixture({data: withSeed(d => { section(d, 'sec-cs240-lab1').meetings = [{days: ['TUE'], start: '14:30', end: '16:20'}]; })});
  assert.deepEqual(f.call('waitlist.list').entries[0].blocked_by.map(b => b.code), ['time_conflict']);
  // Only the student is waiting for it.
  f.event(occupancy('q-0', f.now, {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-synthetic-021-cs240'}));
  f.event(EXAMPLE_EVENTS[0]);
  assert.deepEqual([f.data.offers, entryOf(f, 'wl-noor-cs240').status, seatsOf(f, 'sec-cs240-lab1').available], [[], 'queued', 1],
    'a free seat, but no offer and no hold for an entry that would create a conflict');
  // The lab moves away from STAT210: the same event's re-check issues the offer.
  f.event(event('q-1', '2027-01-11T12:00:00-05:00', 'section.reschedule', {section_id: 'sec-cs240-lab1', meetings: [{days: ['FRI'], start: '09:00', end: '10:50'}]}));
  assert.deepEqual(f.data.offers.map(o => [o.entry_id, o.status, o.issued_at, o.expires_at]),
    [['wl-noor-cs240', 'live', '2027-01-11T12:00:00-05:00', '2027-01-12T12:00:00-05:00']]);
  assert.deepEqual(f.data.notices.map(n => [n.kind, n.refs.event_id]), [['section_rescheduled', 'q-1'], ['offer_issued', 'q-1']]);
});

test('offers.expire closes exactly the offers whose deadline has been reached', () => {
  const f = offered(), deadline = '2027-01-12T09:30:00-05:00';
  // Nothing is due one second early: the event is accepted and changes no business record.
  const before = f.data;
  f.event(event('x-1', '2027-01-12T09:29:59-05:00', 'offers.expire'));
  assert.deepEqual(f.data, before);
  assert.equal(f.call('waitlist.list').offers[0].expired, false);
  f.event(event('x-2', deadline, 'offers.expire'));
  assert.deepEqual([offerOf(f, 'off-6').status, entryOf(f, 'wl-noor-cs240').status], ['expired', 'expired']);
  // Applied again later it finds nothing of hers; the competitor's new offer is not yet due.
  const settled = f.data;
  f.event(event('x-3', '2027-01-12T10:00:00-05:00', 'offers.expire'));
  assert.deepEqual(f.data, settled);
  // A swap offer that expires leaves the original enrollment alone and says so.
  const g = fixture({data: swapOffered()});
  g.event(event('x-4', '2027-01-11T09:30:00-05:00', 'offers.expire'));
  assert.deepEqual([offerOf(g, 'off-6').status, entryOf(g, 'wl-noor-cs240').status, enrollmentOf(g, 'enr-noor-cs240').status], ['expired', 'expired', 'enrolled']);
  assert.match(g.data.notices[0].text, /Enrollment enr-noor-cs240 is unchanged/);
  assert.deepEqual(g.data.notices[0].refs.enrollment_id, 'enr-noor-cs240');
  assert.deepEqual(g.call('schedule.get').pending_swaps, []);
});

test('from the expiry instant an offer can be neither accepted nor declined, before or after the expiry is processed', () => {
  const deadline = '2027-01-12T09:30:00-05:00';
  // One second before the deadline both answers still work.
  const early = offered();
  early.advance('2027-01-12T09:29:59-05:00');
  assert.equal(early.call('offer.accept', {id: 'off-6'}).status, 'committed');
  // The boundary is exact: one millisecond before it, declining still works, and the expiry that follows does not rewrite it.
  const declining = offered();
  declining.advance('2027-01-12T09:29:59.999-05:00');
  assert.equal(declining.call('offer.decline', {id: 'off-6'}).status, 'committed');
  assert.deepEqual(declining.data.offers.map(o => [o.entry_id, o.status, o.resolved_at]),
    [['wl-noor-cs240', 'declined', '2027-01-12T09:29:59.999-05:00'], ['wl-synthetic-021-cs240', 'live', null]]);
  declining.event(event('evt-0015', deadline, 'offers.expire'));
  assert.deepEqual([offerOf(declining, 'off-6').status, entryOf(declining, 'wl-noor-cs240').end_reason, declining.data.notices.map(n => n.kind)],
    ['declined', 'declined', ['offer_issued']]);
  // The same instant written with another offset is the deadline too.
  const utc = offered();
  utc.advance('2027-01-12T14:30:00Z');
  rejected(utc, () => utc.call('offer.decline', {id: 'off-6'}), 'offer_expired');

  // The clock reaches the deadline but the expiry event has not been applied.
  const f = offered();
  f.advance(deadline);
  const stored = f.data;
  assert.equal(f.call('waitlist.list').offers[0].expired, true);
  assert.deepEqual(f.call('change.preview', {action: 'accept_offer', id: 'off-6'}).failures.map(x => x.code), ['offer_expired']);
  rejected(f, () => f.call('offer.accept', {id: 'off-6'}), 'offer_expired', /expired at 2027-01-12T09:30:00-05:00 and can no longer be accepted/);
  rejected(f, () => f.call('offer.decline', {id: 'off-6'}), 'offer_expired',
    /expired at 2027-01-12T09:30:00-05:00 and can no longer be declined\. .*leaving waitlist entry wl-noor-cs240 releases its seat now/);
  assert.deepEqual(f.data, stored, 'neither the reads nor the refused answers released anything');
  assert.deepEqual([offerOf(f, 'off-6').status, seatsOf(f, 'sec-cs240-lab1').held, entryOf(f, 'wl-synthetic-021-cs240').status], ['live', 1, 'queued'],
    'the seat stays held until the expiry is processed');

  // After the expiry event: the offer is closed, the hold is gone, the next entry is served.
  f.event(event('evt-0015', deadline, 'offers.expire'));
  rejected(f, () => f.call('offer.accept', {id: 'off-6'}), 'offer_not_live', /expired/);
  rejected(f, () => f.call('offer.decline', {id: 'off-6'}), 'offer_not_live', /expired/);
  assert.deepEqual([offerOf(f, 'off-6').status, entryOf(f, 'wl-synthetic-021-cs240').status], ['expired', 'offered']);
});

test('past its deadline an offer is not answered, but leaving the queue or giving up the original still releases its seat', () => {
  const deadline = '2027-01-12T09:30:00-05:00';
  // The expiry event is late. Leaving the waitlist is not an answer to the offer: it works and frees the seat at once.
  const g = offered();
  g.advance('2027-01-12T11:00:00-05:00');
  rejected(g, () => g.call('offer.decline', {id: 'off-6'}), 'offer_expired');
  const left = g.call('waitlist.leave', {id: 'wl-noor-cs240'});
  assert.deepEqual([left.status, left.cancelled_offer_id], ['committed', 'off-6']);
  assert.deepEqual(g.data.offers.map(o => [o.entry_id, o.status, o.resolved_at, o.expires_at]),
    [['wl-noor-cs240', 'cancelled', '2027-01-12T11:00:00-05:00', deadline], ['wl-synthetic-021-cs240', 'live', null, '2027-01-13T11:00:00-05:00']]);
  assert.deepEqual([entryOf(g, 'wl-noor-cs240').status, entryOf(g, 'wl-noor-cs240').end_reason], ['left', 'left']);
  // The expiry event, when it comes, finds nothing of hers left to close and tells her nothing new.
  const told = g.data.notices;
  g.event(event('late-expiry', '2027-01-12T12:00:00-05:00', 'offers.expire'));
  assert.deepEqual([g.data.notices, offerOf(g, 'off-6').status], [told, 'cancelled']);

  // A pending swap whose offer is overdue: the original can still be withdrawn, which cancels the swap and frees the held seat.
  const h = fixture({data: swapOffered()});
  h.advance('2027-01-11T10:00:00-05:00');
  assert.equal(h.call('waitlist.list').offers[0].expired, true);
  rejected(h, () => h.call('offer.accept', {id: 'off-6'}), 'offer_expired');
  rejected(h, () => h.call('offer.decline', {id: 'off-6'}), 'offer_expired');
  assert.equal(seatsOf(h, 'sec-cs240-lab1').held, 1);
  const out = h.call('enrollment.withdraw', {id: 'enr-noor-cs240'});
  assert.deepEqual(out.cancelled_entry_ids, ['wl-noor-cs240']);
  assert.deepEqual([offerOf(h, 'off-6').status, offerOf(h, 'off-6').resolved_at, entryOf(h, 'wl-noor-cs240').status, enrollmentOf(h, 'enr-noor-cs240').status],
    ['cancelled', '2027-01-11T10:00:00-05:00', 'cancelled', 'withdrawn']);
  assert.deepEqual(h.data.offers.slice(1).map(o => [o.entry_id, o.status, o.issued_at]), [['wl-synthetic-021-cs240', 'live', '2027-01-11T10:00:00-05:00']]);

  // When the withdrawal deadline has passed as well, neither answer nor withdrawal is possible; leaving the entry is, and keeps the original.
  const closed = fixture({data: swapOffered(d => Object.assign(d.term.registration, {closes_at: '2027-01-11T09:40:00-05:00', withdraw_deadline: '2027-01-11T09:45:00-05:00'}))});
  closed.advance('2027-01-11T10:00:00-05:00');
  rejected(closed, () => closed.call('offer.decline', {id: 'off-6'}), 'offer_expired');
  rejected(closed, () => closed.call('enrollment.withdraw', {id: 'enr-noor-cs240'}), 'withdrawal_closed');
  assert.deepEqual(closed.call('change.preview', {action: 'accept_offer', id: 'off-6'}).failures.map(x => x.code), ['offer_expired', 'withdrawal_closed', 'registration_closed']);
  assert.equal(closed.call('waitlist.leave', {id: 'wl-noor-cs240'}).status, 'committed');
  assert.deepEqual([enrollmentOf(closed, 'enr-noor-cs240').status, offerOf(closed, 'off-6').status, entryOf(closed, 'wl-noor-cs240').status], ['enrolled', 'cancelled', 'left']);

  // A competitor's overdue offer still looks exactly like one that does not exist: the deadline is not checked before ownership.
  const theirs = fixture({data: withSeed(d => { d.student.credit_limit = 9; })});
  theirs.event(EXAMPLE_EVENTS[0]);
  assert.deepEqual(theirs.data.offers.map(o => [o.id, o.entry_id]), [['off-6', 'wl-synthetic-021-cs240']]);
  theirs.advance('2027-01-12T10:00:00-05:00');
  const answer = id => { try { theirs.call('offer.decline', {id}); } catch (error) { return [error.code, error.message.split(id).join('<id>')]; } return ['committed']; };
  assert.equal(answer('off-6')[0], 'not_found');
  assert.deepEqual(answer('off-6'), answer('no-such-row'));
});

test('an event ID is Core\'s: it is stored as given, and its form never decides whether the event applies', () => {
  const [withdraws, reschedules] = EXAMPLE_EVENTS;
  for (const id of ['evt 7', 'evt/7#retry', '\u00e9vt-0007', ' ', '__proto__', 'x'.repeat(100)]) {
    // An event that tells the student something records its ID in the notice.
    const f = fixture();
    f.event({...withdraws, event_id: id});
    assert.deepEqual([f.data.offers.length, f.data.notices.at(-1).kind, f.data.notices.at(-1).refs.event_id], [1, 'offer_issued', id], JSON.stringify(id));
    assert.equal(f.call('activity.list').notices.at(-1).refs.event_id, id);
    // One that changes a section records it in the section's history, where a conflict's cause is read from.
    const g = fixture();
    g.event({...reschedules, event_id: id});
    assert.equal(section(g.data, 'sec-math221-lec1').history[0].event_id, id);
    assert.equal(g.call('schedule.get').conflicts[0].caused_by.event_id, id);
    // One that has nothing to do applies just the same.
    const h = fixture();
    h.event(event(id, '2027-01-11T09:30:00-05:00', 'offers.expire'));
    assert.deepEqual([h.now, h.version.revision], ['2027-01-11T09:30:00-05:00', 1]);
    // The records that quote the ID are valid seed data: the ledger reloads as it is.
    for (const live of [f, g]) assert.deepEqual(fixture({data: live.data, now: live.now}).data, live.data);
  }
  // The envelope's own bound is the only one: 1 to 100 characters.
  for (const id of ['', 'x'.repeat(101)]) {
    const f = fixture(), before = f.data;
    assert.throws(() => f.event({...withdraws, event_id: id}), /Event schema/);
    assert.deepEqual([f.data, f.version.revision], [before, 0]);
  }
});

test('a write that frees a seat offers it within the same commit', () => {
  // The student gives up her CS240 lab seat; the competitor waiting for that lab is offered it.
  const f = fixture({data: holdingCs240(d => {
    d.waitlist_entries[0].status = 'left';
    Object.assign(d.waitlist_entries[0], {ended_at: '2027-01-08T09:00:00-05:00', end_reason: 'left'});
    d.waitlist_entries[1].section_ids = CS240_LAB2;
    section(d, 'sec-cs240-lab2').capacity = 10;
  })});
  assert.equal(seatsOf(f, 'sec-cs240-lab2').available, 0);
  const out = f.call('enrollment.withdraw', {id: 'enr-noor-cs240', request_id: 'free-1'});
  assert.deepEqual([out.receipt_id, f.data.offers.map(o => [o.id, o.entry_id, o.held_section_ids, o.issued_at])],
    ['rcp-6', [['off-7', 'wl-synthetic-021-cs240', CS240_LAB2, f.now]]]);
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab2'), {capacity: 10, enrolled: 9, held: 1, available: 0}, 'released and held again at once');
  assert.deepEqual(f.data.notices, [], 'the offer went to someone else');
  // She cannot take the seat back: it is held.
  rejected(f, () => f.call('enrollment.enroll', {section_ids: CS240_LAB2}), 'section_full');

  // The same after an immediate swap out of the lab.
  const g = fixture({data: holdingCs240(d => {
    d.waitlist_entries[0].status = 'left';
    Object.assign(d.waitlist_entries[0], {ended_at: '2027-01-08T09:00:00-05:00', end_reason: 'left'});
    d.waitlist_entries[1].section_ids = CS240_LAB2;
    section(d, 'sec-cs240-lab2').capacity = 10;
    section(d, 'sec-cs240-lab1').capacity = 13;
  })});
  g.call('enrollment.swap', {id: 'enr-noor-cs240', section_ids: CS240_LAB1});
  assert.deepEqual(g.data.offers.map(o => [o.entry_id, o.held_section_ids]), [['wl-synthetic-021-cs240', CS240_LAB2]]);
});

test('one expiry event closes every due offer and passes each seat on', () => {
  // Two queues: CS240 (the student, then a competitor) and PSYC100 (two competitors).
  const f = fixture({data: withSeed(d => {
    section(d, 'sec-psyc100-lec1').base_enrolled = 99;
    d.enrollments.push({id: 'enr-synthetic-090-psyc100', seq: 6, occupant_ref: 'synthetic-090', course_id: 'crs-psyc100', section_ids: ['sec-psyc100-lec1'],
      status: 'enrolled', enrolled_at: '2026-12-07T09:00:00-05:00', ended_at: null});
    for (const [seq, who] of [[7, '091'], [8, '092']]) {
      d.waitlist_entries.push({id: 'wl-synthetic-' + who + '-psyc100', seq, occupant_ref: 'synthetic-' + who, course_id: 'crs-psyc100',
        section_ids: ['sec-psyc100-lec1'], swap_from_enrollment_id: null, status: 'queued', joined_at: '2027-01-08T0' + seq + ':00:00-05:00',
        ended_at: null, end_reason: null, blocked_reason: null});
    }
    d.counters.next_seq = 9;
  })});
  f.event(EXAMPLE_EVENTS[0]);
  f.event(occupancy('p-1', EXAMPLE_EVENTS[0].at, {change: 'withdraw', occupant_ref: 'synthetic-090', enrollment_id: 'enr-synthetic-090-psyc100'}));
  assert.deepEqual(f.data.offers.map(o => [o.entry_id, o.status, o.expires_at]),
    [['wl-noor-cs240', 'live', '2027-01-12T09:30:00-05:00'], ['wl-synthetic-091-psyc100', 'live', '2027-01-12T09:30:00-05:00']]);
  f.event(EXAMPLE_EVENTS[2]);
  assert.deepEqual(f.data.offers.map(o => [o.entry_id, o.status]), [['wl-noor-cs240', 'expired'], ['wl-synthetic-091-psyc100', 'expired'],
    ['wl-synthetic-021-cs240', 'live'], ['wl-synthetic-092-psyc100', 'live']], 'both expired, and the one re-check served both queues');
  assert.deepEqual(f.data.notices.map(n => n.kind), ['offer_issued', 'offer_expired'], 'only her own offer is told to her');
  recordChecks(f.data);
});

test('running data with a live offer, a pending swap and a three-entry queue reloads as a seed and continues identically', () => {
  const f = fixture({data: holdingCs240(d => {
    d.waitlist_entries.push({id: 'wl-synthetic-033-cs240', seq: 6, occupant_ref: 'synthetic-033', course_id: 'crs-cs240', section_ids: CS240_LAB1,
      swap_from_enrollment_id: null, status: 'queued', joined_at: '2027-01-08T09:00:00-05:00', ended_at: null, end_reason: null, blocked_reason: null});
    d.counters.next_seq = 7;
  })});
  f.event(EXAMPLE_EVENTS[0]);
  const live = f.data;
  assert.deepEqual(live.waitlist_entries.map(e => [e.id, e.status, e.swap_from_enrollment_id]),
    [['wl-noor-cs240', 'offered', 'enr-noor-cs240'], ['wl-synthetic-021-cs240', 'queued', null], ['wl-synthetic-033-cs240', 'queued', null]]);
  assert.deepEqual(live.offers.map(o => [o.id, o.status, o.held_section_ids]), [['off-7', 'live', ['sec-cs240-lab1']]]);

  // The checkpoint: the live data itself, loaded as a seed at the same clock.
  const g = fixture({data: live, now: f.now});
  assert.deepEqual(g.data, live);
  const steps = [
    h => h.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1'], request_id: 'after-1'}),
    h => h.call('offer.accept', {id: 'off-7', request_id: 'after-2'}),
    h => h.event(event('after-3', '2027-01-11T12:00:00-05:00', 'occupancy.change', {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-synthetic-021-cs240'})),
    h => h.call('enrollment.withdraw', {id: h.data.enrollments[h.data.enrollments.length - 1].id, request_id: 'after-4'}),
    h => h.event(event('after-5', '2027-01-13T12:00:00-05:00', 'offers.expire'))
  ];
  for (const step of steps) {
    step(f);
    step(g);
    assert.deepEqual(g.data, f.data, 'the reloaded ledger and the original agree after every step');
  }
  const ids = plugin.objects(g.data);
  assert.equal(new Set(ids).size, ids.length, 'no ID was reused after the reload');
  assert.deepEqual(g.data.offers.map(o => [o.id, o.entry_id, o.status]),
    [['off-7', 'wl-noor-cs240', 'accepted'], [g.data.offers[1].id, 'wl-synthetic-033-cs240', 'expired']]);
  recordChecks(g.data);
});
