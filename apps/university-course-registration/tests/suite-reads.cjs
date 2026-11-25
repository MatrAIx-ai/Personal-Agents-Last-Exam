'use strict';
// Workflow 1 (inspect courses and eligibility) and the read side of the
// others. Loaded by business.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/rules.cjs');
const {fixture, seed, read, withSeed, seatsOf, section, holdingCs240, swapOffered, rescheduled, RESCHEDULED_AT} = require('./support.cjs');

const READS = ['catalog.search', 'course.get', 'record.get', 'schedule.get', 'waitlist.list', 'activity.list'];
const AFTER_CLOSE = '2027-01-25T09:00:00-05:00';
const noLeak = (value, label) => {
  const text = JSON.stringify(value);
  for (const hidden of ['synthetic', 'occupant_ref', 'base_enrolled', 'blocked_reason']) assert.ok(!text.includes(hidden), label + ' must not expose ' + hidden);
};

test('course detail shows bundles, prerequisites, the registration window and the student\'s own status', () => {
  const f = fixture(), before = f.data;
  const cs240 = f.call('course.get', {id: 'crs-cs240'});
  assert.deepEqual([cs240.course.code, cs240.course.credits, cs240.course.requires_lab], ['CS240', 4, true]);
  assert.deepEqual(cs240.course.sections.map(s => [s.id, s.available]), [['sec-cs240-lec1', 7], ['sec-cs240-lab1', 0], ['sec-cs240-lab2', 3]]);
  assert.deepEqual(cs240.prerequisites, [{code: 'CS140', completed: true}]);
  assert.deepEqual(cs240.registration, {opens_at: '2026-11-23T09:00:00-05:00', closes_at: '2027-01-22T17:00:00-05:00', open: true});
  assert.deepEqual(cs240.bundles, [
    {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1'], available: false},
    {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2'], available: true}]);
  assert.equal(cs240.enrollment_id, null);
  assert.deepEqual(f.call('course.get', {id: 'crs-cs310'}).prerequisites, [{code: 'CS240', completed: false}]);
  assert.deepEqual(f.call('course.get', {id: 'crs-phys150'}).bundles, [{section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1'], available: false}],
    'a free lecture with a full lab is not an available bundle');
  const math = f.call('course.get', {id: 'crs-math221'});
  assert.equal(math.enrollment_id, 'enr-noor-math221');
  assert.deepEqual(math.bundles.map(b => b.section_ids), [['sec-math221-lec1'], ['sec-math221-lec2']]);

  // "open" follows the supplied time and a course's own narrower window.
  assert.equal(fixture({now: AFTER_CLOSE}).call('course.get', {id: 'crs-cs240'}).registration.open, false);
  const narrowed = fixture({data: withSeed(d => {
    d.courses.find(c => c.code === 'HIST105').registration_window = {opens_at: '2026-11-23T09:00:00-05:00', closes_at: '2027-01-08T17:00:00-05:00'};
  })});
  assert.deepEqual(narrowed.call('course.get', {id: 'crs-hist105'}).registration,
    {opens_at: '2026-11-23T09:00:00-05:00', closes_at: '2027-01-08T17:00:00-05:00', open: false});

  assert.throws(() => f.call('course.get', {id: 'crs-unknown'}), {code: 'not_found'});
  assert.throws(() => f.call('course.get', {}), /Input schema/);
  assert.throws(() => f.call('course.get', {id: 'crs-cs240', code: 'CS240'}), /Input schema/);
  noLeak(cs240, 'course.get');
  assert.deepEqual(f.data, before);
});

test('the academic record and the applicable rules are readable and cannot be edited', () => {
  const f = fixture(), data = seed();
  const record = f.call('record.get');
  assert.deepEqual(record.student, {id: 'stu-noor', name: 'Noor Haddad', program: 'BSc Computer Science'});
  assert.deepEqual(record.completed_courses, data.student.completed_courses);
  assert.deepEqual(record.credits, {enrolled: 6, limit: 16});
  assert.deepEqual(record.term, data.term);
  // The Agent cannot read the clock, so whether the deadline has passed is stated.
  assert.deepEqual(record.withdrawal, {deadline: '2027-02-19T17:00:00-05:00', open: true});
  assert.equal(fixture({now: '2027-02-19T16:59:59-05:00'}).call('record.get').withdrawal.open, true);
  assert.equal(fixture({now: '2027-02-19T17:00:00-05:00'}).call('record.get').withdrawal.open, false, 'closed at the deadline itself');
  assert.deepEqual(record.university, data.university);
  // Queue order, offer window and boundary rules are stated as data.
  assert.deepEqual(record.enrollment_policy, data.enrollment_policy);
  assert.deepEqual([record.enrollment_policy.version, record.enrollment_policy.offer_window_minutes, record.enrollment_policy.queue.order,
    record.enrollment_policy.expiry.boundary], ['2027W-1', 1440, 'join_sequence', 'invalid_at_or_after_expires_at']);
  // So is the permissions model.
  assert.deepEqual(record.enrollment_policy.access, {records: 'own_account_only', other_students: 'section_totals_only', academic_record: 'read_only',
    rule_exceptions: 'none', management: 'infra_only'});
  assert.throws(() => f.call('record.get', {student_id: 'stu-tomas'}), /Input schema/);
  // No operation writes the record: every write tool acts on enrollments, waitlists or offers.
  const writes = read('tools.json').filter(t => !t.read_only).map(t => t.name.split('.').slice(1, 2)[0]);
  assert.ok(writes.length && writes.every(area => ['enrollment', 'waitlist', 'offer'].includes(area)));
  assert.deepEqual(f.data, data);
});

test('the schedule lists enrollments, credits, conflicts with their cause, and pending swaps', () => {
  const f = fixture(), before = f.data;
  const schedule = f.call('schedule.get');
  assert.deepEqual(schedule.enrollments, [
    {id: 'enr-noor-math221', course_id: 'crs-math221', code: 'MATH221', title: 'Linear Algebra', credits: 3, enrolled_at: '2026-12-02T10:15:00-05:00',
      sections: [{id: 'sec-math221-lec1', kind: 'lecture', label: 'LEC 1', meetings: [{days: ['MON', 'WED'], start: '10:00', end: '11:20'}], version: 1}]},
    {id: 'enr-noor-stat210', course_id: 'crs-stat210', code: 'STAT210', title: 'Probability', credits: 3, enrolled_at: '2026-12-02T10:17:00-05:00',
      sections: [{id: 'sec-stat210-lec1', kind: 'lecture', label: 'LEC 1', meetings: [{days: ['TUE', 'THU'], start: '14:00', end: '15:20'}], version: 1}]}]);
  assert.deepEqual([schedule.credits, schedule.conflicts, schedule.pending_swaps], [{enrolled: 6, limit: 16}, [], []]);
  assert.deepEqual(f.data, before);

  // A section-time change produced the overlap: it stays visible and is attributed to the event.
  const moved = fixture({data: rescheduled(), now: '2027-01-12T09:00:00-05:00'}).call('schedule.get');
  assert.deepEqual(moved.conflicts, [{section_ids: ['sec-math221-lec1', 'sec-stat210-lec1'],
    caused_by: {event_id: 'evt-0012', section_id: 'sec-math221-lec1', replaced_at: RESCHEDULED_AT, from_version: 1, to_version: 2}}]);
  assert.equal(moved.enrollments.length, 2, 'no course was dropped');
  assert.equal(moved.enrollments[0].sections[0].version, 2);
  // An overlap that was already there is not blamed on a change.
  const preexisting = fixture({data: withSeed(d => { section(d, 'sec-math221-lec1').meetings = [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}]; })});
  assert.deepEqual(preexisting.call('schedule.get').conflicts, [{section_ids: ['sec-math221-lec1', 'sec-stat210-lec1'], caused_by: null}]);
  const alreadyOverlapping = fixture({data: rescheduled(d => { section(d, 'sec-math221-lec1').history[0].meetings = [{days: ['TUE'], start: '14:00', end: '15:00'}]; })});
  assert.equal(alreadyOverlapping.call('schedule.get').conflicts[0].caused_by, null);

  const holding = fixture({data: holdingCs240()}).call('schedule.get');
  assert.deepEqual(holding.enrollments.map(e => [e.code, e.sections.map(s => s.label)]), [['MATH221', ['LEC 1']], ['CS240', ['LEC 1', 'LAB 2']]]);
  assert.deepEqual(holding.credits, {enrolled: 7, limit: 16}, 'the pending swap adds no credits');
  assert.deepEqual(holding.pending_swaps, [{entry_id: 'wl-noor-cs240', from_enrollment_id: 'enr-noor-cs240', course_id: 'crs-cs240',
    section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1'], status: 'queued'}]);
  noLeak(holding, 'schedule.get');
});

test('the waitlist view shows only the student\'s entries, with rank, what they wait for and what blocks them', () => {
  const f = fixture(), before = f.data;
  const list = f.call('waitlist.list');
  assert.deepEqual(list.entries, [{id: 'wl-noor-cs240', course_id: 'crs-cs240', code: 'CS240', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1'],
    swap_from_enrollment_id: null, status: 'queued', joined_at: '2027-01-06T11:00:00-05:00', rank: 1,
    waiting_for_section_ids: ['sec-cs240-lab1'], blocked_by: []}]);
  assert.deepEqual(list.offers, []);
  noLeak(list, 'waitlist.list');
  assert.deepEqual(f.data, before);

  // Rank counts earlier entries waiting for the same seats, whoever they belong to.
  const behind = fixture({data: withSeed(d => {
    Object.assign(d.waitlist_entries[1], {seq: 4, joined_at: '2027-01-05T09:00:00-05:00'});
    Object.assign(d.waitlist_entries[0], {seq: 5});
  })});
  assert.equal(behind.call('waitlist.list').entries[0].rank, 2);
  const unrelated = fixture({data: withSeed(d => {
    d.waitlist_entries.push({id: 'wl-synthetic-040-phys150', seq: 6, occupant_ref: 'synthetic-040', course_id: 'crs-phys150',
      section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1'], swap_from_enrollment_id: null, status: 'queued',
      joined_at: '2027-01-08T09:00:00-05:00', ended_at: null, end_reason: null, blocked_reason: null});
    Object.assign(d.waitlist_entries[0], {seq: 7, joined_at: '2027-01-09T09:00:00-05:00'});
    d.counters.next_seq = 8;
  })});
  assert.equal(unrelated.call('waitlist.list').entries[0].rank, 2, 'an earlier entry for other seats does not count');

  // Blocking reasons are derived when read, from the rules as they stand now.
  const blockedBy = g => g.call('waitlist.list').entries[0].blocked_by.map(b => b.code);
  assert.deepEqual(blockedBy(fixture({data: withSeed(d => { d.student.credit_limit = 6; })})), ['credit_limit_exceeded']);
  const late = fixture({now: AFTER_CLOSE}), lateData = late.data;
  assert.deepEqual(blockedBy(late), ['registration_closed']);
  assert.deepEqual(late.data, lateData, 'the reason is computed, not stored');
  const clash = fixture({data: withSeed(d => { section(d, 'sec-stat210-lec1').meetings = [{days: ['FRI'], start: '09:30', end: '10:50'}]; })});
  const blocked = clash.call('waitlist.list').entries[0];
  assert.deepEqual(blocked.blocked_by.map(b => [b.code, b.conflicts]), [['time_conflict', [['sec-cs240-lab1', 'sec-stat210-lec1']]]]);
  assert.deepEqual(blocked.waiting_for_section_ids, ['sec-cs240-lab1'], 'still queued, holding nothing');
  assert.equal(seatsOf(clash, 'sec-cs240-lab1').held, 0);
});

test('a pending swap waits only for the sections it does not already hold', () => {
  const entry = g => g.call('waitlist.list').entries[0];
  const holding = fixture({data: holdingCs240()});
  assert.deepEqual([entry(holding).swap_from_enrollment_id, entry(holding).rank, entry(holding).waiting_for_section_ids, entry(holding).blocked_by],
    ['enr-noor-cs240', 1, ['sec-cs240-lab1'], []]);
  // Even with the shared lecture full, only the lab is awaited.
  const lectureFull = fixture({data: holdingCs240(d => { section(d, 'sec-cs240-lec1').capacity = 54; })});
  assert.equal(seatsOf(lectureFull, 'sec-cs240-lec1').available, 0);
  assert.deepEqual(entry(lectureFull).waiting_for_section_ids, ['sec-cs240-lab1']);
});

test('an offer is listed with its expiry; reading it at or after expiry changes nothing', () => {
  const offered = swapOffered(), expiresAt = offered.offers[0].expires_at;
  const before = fixture({data: offered});
  const list = before.call('waitlist.list');
  assert.deepEqual(list.offers, [{id: 'off-6', entry_id: 'wl-noor-cs240', course_id: 'crs-cs240', held_section_ids: ['sec-cs240-lab1'],
    issued_at: '2027-01-10T09:30:00-05:00', expires_at: expiresAt, expired: false}]);
  assert.deepEqual([list.entries[0].status, list.entries[0].waiting_for_section_ids, list.entries[0].blocked_by], ['offered', [], []],
    'the seat held for the offer counts as available to its own entry');
  assert.deepEqual(seatsOf(before, 'sec-cs240-lab1'), {capacity: 13, enrolled: 12, held: 1, available: 0});
  assert.equal(fixture({data: offered, now: '2027-01-11T09:29:59-05:00'}).call('waitlist.list').offers[0].expired, false);
  for (const now of [expiresAt, '2027-01-13T09:00:00-05:00']) {
    const after = fixture({data: offered, now}), stored = after.data;
    assert.equal(after.call('waitlist.list').offers[0].expired, true, 'expired at ' + now);
    assert.deepEqual(after.data, stored, 'no read releases the hold');
    assert.equal(seatsOf(after, 'sec-cs240-lab1').held, 1, 'the seat stays held until the expiry is processed');
    assert.equal(after.data.offers[0].status, 'live');
  }
});

test('activity lists notices and receipts in order; every read leaves the ledger untouched', () => {
  const f = fixture({data: holdingCs240()});
  assert.deepEqual([f.call('activity.list').notices, f.call('activity.list').receipts], [[], []]);
  f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1'], request_id: 'a-1'});
  f.call('enrollment.withdraw', {id: 'enr-noor-cs240', request_id: 'a-2'});
  const activity = f.call('activity.list');
  assert.deepEqual(activity.receipts.map(r => [r.id, r.action, r.request_id]),
    [['rcp-7', 'enrollment.enroll', 'a-1'], ['rcp-9', 'enrollment.withdraw', 'a-2']]);
  assert.deepEqual(activity.notices.map(n => [n.id, n.kind, n.refs.entry_id]), [['ntc-8', 'swap_cancelled', 'wl-noor-cs240']]);
  assert.deepEqual(activity.receipts, f.data.receipts);
  noLeak(activity, 'activity.list');

  const stored = f.data;
  for (const name of READS) f.call(name, name === 'course.get' ? {id: 'crs-cs240'} : {});
  f.call('change.preview', {action: 'withdraw', id: 'enr-noor-math221'});
  assert.deepEqual(f.data, stored);
  assert.equal(f.version.revision, 2, 'only the two writes advanced the version');
});

test('a preview reports every failure and the resulting schedule, and stores nothing', () => {
  const f = fixture(), before = f.data;
  const enroll = f.call('change.preview', {action: 'enroll', section_ids: ['sec-hist105-lec1']});
  assert.deepEqual([enroll.status, enroll.version, enroll.action, enroll.allowed, enroll.failures], ['ok', {epoch: 1, revision: 0}, 'enroll', true, []]);
  assert.deepEqual(enroll.credits, {current: 6, resulting: 9, limit: 16});
  assert.deepEqual(enroll.schedule, [
    {course_id: 'crs-math221', code: 'MATH221', section_ids: ['sec-math221-lec1'], change: 'kept'},
    {course_id: 'crs-stat210', code: 'STAT210', section_ids: ['sec-stat210-lec1'], change: 'kept'},
    {course_id: 'crs-hist105', code: 'HIST105', section_ids: ['sec-hist105-lec1'], change: 'added'}]);
  assert.deepEqual(enroll.conflicts, {current: [], resulting: [], introduced: [], resolved: []});

  const full = f.call('change.preview', {action: 'enroll', section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1']});
  assert.deepEqual([full.allowed, full.failures.map(x => [x.code, x.full_section_ids])], [false, [['section_full', ['sec-phys150-lab1']]]]);
  const clash = f.call('change.preview', {action: 'enroll', section_ids: ['sec-econ101-lec1']});
  assert.deepEqual(clash.failures.map(x => [x.code, x.conflicts]), [['time_conflict', [['sec-econ101-lec1', 'sec-math221-lec1']]]]);
  assert.deepEqual(clash.conflicts.introduced, [['sec-econ101-lec1', 'sec-math221-lec1']]);
  // A bundle that shares a section with one already held is a duplicate, not a time conflict with itself.
  const again = f.call('change.preview', {action: 'enroll', section_ids: ['sec-math221-lec1']});
  assert.deepEqual([again.failures.map(x => x.code), again.conflicts.introduced, again.conflicts.resulting], [['duplicate_enrollment'], [], []]);
  // Every failing rule is listed, not only the first.
  const tight = fixture({data: withSeed(d => { d.student.credit_limit = 8; })});
  const several = tight.call('change.preview', {action: 'enroll', section_ids: ['sec-cs310-lec1']});
  assert.deepEqual(several.failures.map(x => x.code), ['prerequisite_missing', 'credit_limit_exceeded']);
  assert.deepEqual(several.failures[0].missing_prerequisites, ['CS240']);

  const withdraw = f.call('change.preview', {action: 'withdraw', id: 'enr-noor-stat210'});
  assert.deepEqual([withdraw.allowed, withdraw.credits, withdraw.schedule.map(r => r.code + ':' + r.change)],
    [true, {current: 6, resulting: 3, limit: 16}, ['MATH221:kept', 'STAT210:removed']]);
  const swap = f.call('change.preview', {action: 'swap', id: 'enr-noor-stat210', section_ids: ['sec-hist105-lec1']});
  assert.deepEqual([swap.allowed, swap.credits.resulting, swap.schedule.map(r => r.code + ':' + r.change)],
    [true, 6, ['MATH221:kept', 'STAT210:removed', 'HIST105:added']]);

  // Something that cannot be evaluated leaves the schedule as it is.
  const unknown = f.call('change.preview', {action: 'withdraw', id: 'enr-synthetic-017-cs240'});
  assert.deepEqual([unknown.allowed, unknown.failures.map(x => x.code), unknown.schedule.map(r => r.change), unknown.credits.resulting],
    [false, ['not_found'], ['kept', 'kept'], 6]);

  for (const args of [{action: 'enroll', id: 'enr-noor-stat210'}, {action: 'enroll', section_ids: ['sec-hist105-lec1'], id: 'enr-noor-stat210'},
    {action: 'withdraw', id: 'enr-noor-stat210', section_ids: ['sec-hist105-lec1']}, {action: 'withdraw'}, {action: 'swap', id: 'enr-noor-stat210'},
    {action: 'swap', section_ids: ['sec-hist105-lec1']}]) {
    assert.throws(() => f.call('change.preview', args), {code: 'invalid_arguments'}, JSON.stringify(args));
  }
  assert.throws(() => f.call('change.preview', {action: 'accept_everything'}), /Input schema/);
  assert.deepEqual(f.data, before, 'a preview stores nothing');
  assert.equal(f.version.revision, 0);
});

test('a preview names the pending swap a withdrawal would cancel and the conflicts a swap would resolve', () => {
  const holding = fixture({data: holdingCs240()});
  assert.deepEqual(holding.call('change.preview', {action: 'withdraw', id: 'enr-noor-cs240'}).cancelled_entry_ids, ['wl-noor-cs240']);
  assert.deepEqual(holding.call('change.preview', {action: 'withdraw', id: 'enr-noor-math221'}).cancelled_entry_ids, []);
  const moved = fixture({data: rescheduled(), now: '2027-01-12T09:00:00-05:00'});
  const repair = moved.call('change.preview', {action: 'swap', id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']});
  assert.deepEqual([repair.allowed, repair.conflicts], [true, {current: [['sec-math221-lec1', 'sec-stat210-lec1']], resulting: [],
    introduced: [], resolved: [['sec-math221-lec1', 'sec-stat210-lec1']]}]);
});

test('what a preview says is what the write then does', () => {
  const changes = [
    ['enrollment.enroll', {action: 'enroll', section_ids: ['sec-hist105-lec1']}],
    ['enrollment.enroll', {action: 'enroll', section_ids: ['sec-psyc100-lec1']}],
    ['enrollment.enroll', {action: 'enroll', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']}],
    ['enrollment.swap', {action: 'swap', id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']}],
    ['enrollment.swap', {action: 'swap', id: 'enr-noor-stat210', section_ids: ['sec-econ101-lec1']}],
    ['enrollment.swap', {action: 'swap', id: 'enr-noor-stat210', section_ids: ['sec-cs310-lec1']}],
    ['enrollment.withdraw', {action: 'withdraw', id: 'enr-noor-stat210'}],
    ['enrollment.withdraw', {action: 'withdraw', id: 'enr-unknown'}]
  ];
  for (const [tool, change] of changes) {
    const f = fixture(), preview = f.call('change.preview', change), before = f.data;
    const {action, ...args} = change;
    if (preview.allowed) {
      const done = f.call(tool, args);
      assert.equal(done.status, 'committed', JSON.stringify(change));
      assert.equal(done.credits.enrolled, preview.credits.resulting);
    } else {
      const first = rules.PRIORITY.find(code => preview.failures.some(x => x.code === code));
      assert.throws(() => f.call(tool, args), {code: first}, JSON.stringify(change));
      assert.deepEqual(f.data, before);
    }
  }
});
