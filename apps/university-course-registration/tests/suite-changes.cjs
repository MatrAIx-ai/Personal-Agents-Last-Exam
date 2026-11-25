'use strict';
// Workflow 2 (withdraw) and the immediate half of workflow 4 (swap without
// losing the existing place). Loaded by business.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/ledger.cjs');
const {APP, fixture, seed, withSeed, seatsOf, section, rejected, recordChecks, holdingCs240, swapOffered, rescheduled} = require('./support.cjs');

const own = (f, courseId) => f.data.enrollments.filter(e => e.occupant_ref === 'stu-noor' && e.status === 'enrolled' && (!courseId || e.course_id === courseId));
const row = (f, id) => f.data.enrollments.find(e => e.id === id);
const entry = (f, id) => f.data.waitlist_entries.find(e => e.id === id);

test('withdrawing releases the whole bundle, keeps the history and leaves a receipt', () => {
  const f = fixture(), before = f.data, seat = seatsOf(f, 'sec-stat210-lec1');
  const out = f.call('enrollment.withdraw', {id: 'enr-noor-stat210', request_id: 'w-1'});
  assert.deepEqual(out, {id: 'enr-noor-stat210', receipt_id: 'rcp-6', course_id: 'crs-stat210', section_ids: ['sec-stat210-lec1'],
    cancelled_entry_ids: [], credits: {enrolled: 3, limit: 16}, status: 'committed', app_id: APP, version: {epoch: 1, revision: 1}});
  assert.deepEqual(row(f, 'enr-noor-stat210'), {...before.enrollments[1], status: 'withdrawn', ended_at: f.now}, 'the row is kept as history');
  assert.deepEqual(seatsOf(f, 'sec-stat210-lec1'), {...seat, enrolled: seat.enrolled - 1, available: seat.available + 1});
  assert.deepEqual(f.data.receipts, [{id: 'rcp-6', seq: 6, at: f.now, action: 'enrollment.withdraw', request_id: 'w-1',
    refs: {course_id: 'crs-stat210', enrollment_id: 'enr-noor-stat210', section_ids: ['sec-stat210-lec1'], cancelled_entry_ids: []}}]);
  assert.deepEqual(f.call('schedule.get').enrollments.map(e => e.code), ['MATH221']);
  assert.deepEqual(f.call('record.get').credits, {enrolled: 3, limit: 16});
  for (const key of ['courses', 'sections', 'waitlist_entries', 'offers', 'notices', 'student']) assert.deepEqual(f.data[key], before[key]);

  rejected(f, () => f.call('enrollment.withdraw', {id: 'enr-noor-stat210'}), 'invalid_state', /no longer held \(withdrawn\)/);
  rejected(f, () => f.call('enrollment.withdraw', {id: 'enr-unknown'}), 'not_found');
  // A competitor's enrollment is not addressable: it does not exist for this account.
  rejected(f, () => f.call('enrollment.withdraw', {id: 'enr-synthetic-017-cs240'}), 'not_found', /does not exist in this account/);
  assert.throws(() => f.call('enrollment.withdraw', {}), /Input schema/);
});

test('a lecture/lab bundle is withdrawn as a whole', () => {
  const f = fixture({data: holdingCs240()});
  const lecture = seatsOf(f, 'sec-cs240-lec1'), lab = seatsOf(f, 'sec-cs240-lab2');
  const out = f.call('enrollment.withdraw', {id: 'enr-noor-cs240'});
  assert.deepEqual(out.section_ids, ['sec-cs240-lec1', 'sec-cs240-lab2']);
  assert.equal(seatsOf(f, 'sec-cs240-lec1').available, lecture.available + 1);
  assert.equal(seatsOf(f, 'sec-cs240-lab2').available, lab.available + 1);
  assert.deepEqual(out.credits, {enrolled: 3, limit: 16}, 'the bundle\'s credits are removed once');
});

test('withdrawal follows its own deadline, later than the close of registration', () => {
  const deadline = seed().term.registration.withdraw_deadline;
  const justBefore = fixture({now: '2027-02-19T16:59:59-05:00'});
  assert.equal(justBefore.call('course.get', {id: 'crs-stat210'}).registration.open, false, 'registration is already closed');
  assert.equal(justBefore.call('enrollment.withdraw', {id: 'enr-noor-stat210'}).status, 'committed');
  for (const now of [deadline, '2027-03-01T09:00:00-05:00']) {
    const f = fixture({now});
    rejected(f, () => f.call('enrollment.withdraw', {id: 'enr-noor-stat210'}), 'withdrawal_closed', /2027-02-19T17:00:00-05:00/);
    assert.deepEqual(f.call('change.preview', {action: 'withdraw', id: 'enr-noor-stat210'}).failures.map(x => x.code), ['withdrawal_closed']);
  }
});

test('withdrawing the original cancels its pending swap; it never becomes an enrollment', () => {
  const f = fixture({data: holdingCs240()});
  const out = f.call('enrollment.withdraw', {id: 'enr-noor-cs240', request_id: 'w-2'});
  assert.deepEqual([out.receipt_id, out.cancelled_entry_ids], ['rcp-7', ['wl-noor-cs240']]);
  assert.deepEqual(entry(f, 'wl-noor-cs240'), {...holdingCs240().waitlist_entries[0], status: 'cancelled', ended_at: f.now, end_reason: 'source_withdrawn'});
  assert.deepEqual(own(f, 'crs-cs240'), [], 'the student is not in CS240 in any form');
  assert.deepEqual(f.data.notices.map(n => [n.id, n.seq, n.kind, n.refs]), [['ntc-6', 6, 'swap_cancelled',
    {course_id: 'crs-cs240', entry_id: 'wl-noor-cs240', enrollment_id: 'enr-noor-cs240'}]]);
  assert.match(f.data.notices[0].text, /pending swap into CS240 was cancelled/);
  assert.deepEqual(f.data.receipts[0].refs.cancelled_entry_ids, ['wl-noor-cs240']);
  assert.deepEqual(entry(f, 'wl-synthetic-021-cs240').status, 'queued', 'other entries are untouched');
  assert.deepEqual(f.call('waitlist.list').entries, []);
  assert.deepEqual(f.call('schedule.get').pending_swaps, []);
  recordChecks(f.data);
});

test('withdrawing the original also cancels a live offer and releases its hold', () => {
  const f = fixture({data: swapOffered()});
  assert.equal(seatsOf(f, 'sec-cs240-lab1').held, 1);
  const out = f.call('enrollment.withdraw', {id: 'enr-noor-cs240'});
  assert.deepEqual(out.cancelled_entry_ids, ['wl-noor-cs240']);
  assert.deepEqual(f.data.offers[0], {...swapOffered().offers[0], status: 'cancelled', resolved_at: f.now});
  assert.equal(entry(f, 'wl-noor-cs240').status, 'cancelled');
  assert.equal(f.data.notices[0].refs.offer_id, 'off-6');
  assert.deepEqual(own(f, 'crs-cs240'), []);
  // The released seat went straight to the next entry in the queue, not back to the student.
  assert.deepEqual(f.data.offers[1], {id: 'off-9', seq: 9, entry_id: 'wl-synthetic-021-cs240', held_section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1'],
    issued_at: f.now, expires_at: '2027-01-12T09:00:00-05:00', status: 'live', resolved_at: null});
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 13, enrolled: 12, held: 1, available: 0});
  assert.deepEqual(f.call('waitlist.list'), {entries: [], offers: [], status: 'ok', app_id: APP, version: {epoch: 1, revision: 1}});
});

test('nothing else is cancelled implicitly: an entry the student stops qualifying for keeps its place and holds nothing', () => {
  // The student is queued for CS240 LEC 1 + LAB 1 and then enrolls directly in LEC 1 + LAB 2.
  const f = fixture(), queued = entry(f, 'wl-noor-cs240');
  f.call('enrollment.withdraw', {id: 'enr-noor-stat210'});
  const out = f.call('enrollment.enroll', {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']});
  assert.equal(out.cancelled_entry_ids, undefined, 'an enrollment cancels nothing');
  assert.deepEqual(entry(f, 'wl-noor-cs240'), queued, 'the waitlist entry is exactly as it was');
  assert.deepEqual([f.data.notices, f.data.offers], [[], []]);
  assert.equal(seatsOf(f, 'sec-cs240-lab1').held, 0, 'a blocked entry holds no seat');
  const listed = f.call('waitlist.list').entries[0];
  assert.deepEqual([listed.status, listed.rank, listed.waiting_for_section_ids, listed.blocked_by.map(b => b.code)],
    ['queued', 1, ['sec-cs240-lab1'], ['duplicate_enrollment']], 'one reason: the lecture both bundles share is not a time conflict with itself');
  assert.deepEqual(ledger.conflictPairs([section(f.data, 'sec-cs240-lec1'), section(f.data, 'sec-cs240-lec1')]).size, 0);
  assert.deepEqual(f.call('schedule.get').pending_swaps, [], 'a plain entry is not a pending swap');
  // Giving the course up again lifts the block; the entry never left the queue.
  f.call('enrollment.withdraw', {id: out.id});
  assert.deepEqual(f.call('waitlist.list').entries[0].blocked_by, []);
  assert.deepEqual(entry(f, 'wl-noor-cs240'), queued);

  // Changing an unrelated enrollment leaves a pending swap and its live offer alone.
  for (const [tool, args] of [['enrollment.withdraw', {id: 'enr-noor-math221'}],
    ['enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']}]]) {
    const g = fixture({data: swapOffered()}), before = g.data;
    assert.deepEqual(g.call(tool, args).cancelled_entry_ids, [], tool);
    assert.deepEqual([g.data.waitlist_entries, g.data.offers, g.data.notices], [before.waitlist_entries, before.offers, []], tool);
    assert.equal(seatsOf(g, 'sec-cs240-lab1').held, 1, 'the offered seat is still held');
    assert.deepEqual(g.call('waitlist.list').offers.map(o => [o.id, o.expired]), [['off-6', false]]);
  }
});

test('a swap replaces the bundle in one step: same course, different section', () => {
  const f = fixture(), before = f.data;
  const from = seatsOf(f, 'sec-math221-lec1'), to = seatsOf(f, 'sec-math221-lec2');
  const out = f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2'], request_id: 's-1'});
  assert.deepEqual(out, {id: 'enr-6', replaced_id: 'enr-noor-math221', receipt_id: 'rcp-7', course_id: 'crs-math221',
    section_ids: ['sec-math221-lec2'], cancelled_entry_ids: [], credits: {enrolled: 6, limit: 16},
    status: 'committed', app_id: APP, version: {epoch: 1, revision: 1}});
  assert.deepEqual(row(f, 'enr-noor-math221'), {...before.enrollments[0], status: 'swapped_out', ended_at: f.now});
  assert.deepEqual(row(f, 'enr-6'), {id: 'enr-6', seq: 6, occupant_ref: 'stu-noor', course_id: 'crs-math221',
    section_ids: ['sec-math221-lec2'], status: 'enrolled', enrolled_at: f.now, ended_at: null});
  assert.equal(own(f, 'crs-math221').length, 1, 'exactly one enrollment in the course, before and after');
  assert.equal(seatsOf(f, 'sec-math221-lec1').available, from.available + 1);
  assert.equal(seatsOf(f, 'sec-math221-lec2').available, to.available - 1);
  assert.deepEqual(f.data.receipts, [{id: 'rcp-7', seq: 7, at: f.now, action: 'enrollment.swap', request_id: 's-1',
    refs: {course_id: 'crs-math221', enrollment_id: 'enr-6', replaced_enrollment_id: 'enr-noor-math221',
      section_ids: ['sec-math221-lec2'], cancelled_entry_ids: []}}]);
  // The replaced enrollment can no longer be acted on.
  rejected(f, () => f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec1']}), 'invalid_state', /swapped_out/);
  rejected(f, () => f.call('enrollment.withdraw', {id: 'enr-noor-math221'}), 'invalid_state');
});

test('a swap can move to a different course; credits follow the resulting schedule', () => {
  const f = fixture();
  const out = f.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-hist105-lec1']});
  assert.deepEqual([out.course_id, out.credits], ['crs-hist105', {enrolled: 6, limit: 16}]);
  assert.deepEqual(own(f).map(e => e.course_id), ['crs-math221', 'crs-hist105']);
  // Moving to a heavier course counts the replacement, not the sum of both.
  const g = fixture({data: withSeed(d => { d.student.credit_limit = 7; })});
  assert.deepEqual(g.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']}).credits, {enrolled: 7, limit: 7});
  const h = fixture({data: withSeed(d => { d.student.credit_limit = 6; })});
  rejected(h, () => h.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']}),
    'credit_limit_exceeded', /7 credits; the limit is 6/);
});

test('a lab swap reuses the seat in a shared lecture, even when that lecture is full', () => {
  const data = holdingCs240(d => {
    section(d, 'sec-cs240-lec1').capacity = 54;
    section(d, 'sec-cs240-lab1').capacity = 13;
  });
  const f = fixture({data}), lecture = seatsOf(f, 'sec-cs240-lec1');
  assert.deepEqual([lecture.available, seatsOf(f, 'sec-cs240-lab1').available], [0, 1], 'the lecture is full; LAB 1 has one seat');
  // Enrolling fresh in this bundle would need a lecture seat and is refused...
  assert.deepEqual(fixture({data: withSeed(d => {
    section(d, 'sec-cs240-lec1').capacity = 53;
    section(d, 'sec-cs240-lab1').capacity = 13;
  })}).call('change.preview', {action: 'enroll', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1']}).failures.map(x => [x.code, x.full_section_ids]),
    [['section_full', ['sec-cs240-lec1']]]);
  // ...but the swap keeps the lecture seat the student already holds.
  const out = f.call('enrollment.swap', {id: 'enr-noor-cs240', section_ids: ['sec-cs240-lab1', 'sec-cs240-lec1']});
  assert.deepEqual(out.section_ids, ['sec-cs240-lec1', 'sec-cs240-lab1']);
  assert.deepEqual(seatsOf(f, 'sec-cs240-lec1'), lecture, 'the shared lecture seat is neither released nor counted twice');
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 13, enrolled: 13, held: 0, available: 0});
  assert.equal(seatsOf(f, 'sec-cs240-lab2').enrolled, 9, 'the old lab seat is released');
  assert.deepEqual(own(f, 'crs-cs240').map(e => e.section_ids), [['sec-cs240-lec1', 'sec-cs240-lab1']]);
  assert.deepEqual(out.credits, {enrolled: 7, limit: 16});
  // The pending swap that was waiting on the old enrollment goes with it.
  assert.deepEqual(out.cancelled_entry_ids, ['wl-noor-cs240']);
  assert.deepEqual([entry(f, 'wl-noor-cs240').status, entry(f, 'wl-noor-cs240').end_reason], ['cancelled', 'source_swapped']);
  assert.equal(f.data.notices.at(-1).kind, 'swap_cancelled');

  // With LAB 1 full the same swap fails on the lab alone and the original stays.
  const full = fixture({data: holdingCs240(d => { section(d, 'sec-cs240-lec1').capacity = 54; })});
  rejected(full, () => full.call('enrollment.swap', {id: 'enr-noor-cs240', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1']}),
    'section_full', /sec-cs240-lab1; every newly occupied/);
  assert.deepEqual(own(full, 'crs-cs240').map(e => e.id), ['enr-noor-cs240']);
});

test('a failed swap preserves the original enrollment and changes nothing', () => {
  const f = fixture();
  const swap = (id, ...section_ids) => () => f.call('enrollment.swap', {id, section_ids});
  rejected(f, swap('enr-noor-stat210', 'sec-psyc100-lec1'), 'section_full', /sec-psyc100-lec1/);
  rejected(f, swap('enr-noor-stat210', 'sec-cs310-lec1'), 'prerequisite_missing', /CS240/);
  rejected(f, swap('enr-noor-stat210', 'sec-econ101-lec1'), 'time_conflict', /sec-econ101-lec1 and sec-math221-lec1/);
  rejected(f, swap('enr-noor-stat210', 'sec-math221-lec2'), 'duplicate_enrollment', /MATH221/);
  rejected(f, swap('enr-noor-stat210', 'sec-phys150-lec1'), 'invalid_bundle', /one lecture plus one lab/);
  rejected(f, swap('enr-noor-stat210', 'sec-phys150-lec1', 'sec-phys150-lab1'), 'section_full', /sec-phys150-lab1/);
  rejected(f, swap('enr-noor-stat210', 'sec-stat210-lec1'), 'invalid_bundle', /already holds exactly this bundle/);
  rejected(f, swap('enr-noor-stat210', 'sec-unknown'), 'not_found', /Section sec-unknown/);
  rejected(f, swap('enr-unknown', 'sec-hist105-lec1'), 'not_found', /Enrollment enr-unknown/);
  rejected(f, swap('enr-synthetic-017-cs240', 'sec-hist105-lec1'), 'not_found', /does not exist in this account/);
  assert.throws(() => f.call('enrollment.swap', {id: 'enr-noor-stat210'}), /Input schema/);
  assert.throws(() => f.call('enrollment.swap', {section_ids: ['sec-hist105-lec1']}), /Input schema/);
  assert.equal(f.version.revision, 0);
  assert.deepEqual(own(f).map(e => e.id), ['enr-noor-math221', 'enr-noor-stat210']);

  const closed = fixture({now: '2027-01-25T09:00:00-05:00'});
  rejected(closed, () => closed.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-hist105-lec1']}), 'registration_closed', /HIST105/);
  const tooLate = fixture({now: '2027-03-01T09:00:00-05:00'});
  rejected(tooLate, () => tooLate.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-hist105-lec1']}),
    'withdrawal_closed', /\[registration_closed\]/);
});

test('a timetable conflict can be repaired by a swap, but not by trading it for a new one', () => {
  const f = fixture({data: rescheduled(), now: '2027-01-12T09:00:00-05:00'});
  assert.deepEqual(f.call('schedule.get').conflicts.map(c => c.section_ids), [['sec-math221-lec1', 'sec-stat210-lec1']]);
  // LAB 2 (Tue) overlaps the moved MATH221 lecture: resolves one conflict, introduces another.
  rejected(f, () => f.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']}),
    'time_conflict', /sec-cs240-lab2 and sec-math221-lec1/);
  // An enrollment that touches neither conflicting section is not blocked by the existing conflict.
  assert.equal(f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1']}).status, 'committed');
  const out = f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']});
  assert.equal(out.status, 'committed');
  assert.deepEqual(f.call('schedule.get').conflicts, []);
  assert.deepEqual(own(f).map(e => e.course_id), ['crs-stat210', 'crs-hist105', 'crs-math221'], 'nothing was dropped along the way');
});

test('no sequence of changes alters the academic record, the catalog or another occupant\'s rows', () => {
  const f = fixture(), before = f.data;
  f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1']});
  f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']});
  f.call('enrollment.withdraw', {id: 'enr-noor-stat210'});
  const after = f.data;
  for (const key of ['student', 'courses', 'sections', 'enrollment_policy', 'term', 'university', 'waitlist_entries', 'offers']) {
    assert.deepEqual(after[key], before[key], key + ' is unchanged');
  }
  const others = data => data.enrollments.filter(e => e.occupant_ref !== 'stu-noor');
  assert.deepEqual(others(after), others(before));
  assert.deepEqual(after.receipts.map(r => r.action), ['enrollment.enroll', 'enrollment.swap', 'enrollment.withdraw']);
  assert.deepEqual(own(f).map(e => e.course_id).sort(), ['crs-hist105', 'crs-math221']);
  assert.equal(ledger.credits(ledger.index(after), ledger.activeEnrollments(after, 'stu-noor')), 6);
  recordChecks(after);
  // Live data, with its history rows, is still a loadable seed.
  assert.deepEqual(fixture({data: after, now: f.now}).data, after);
});
