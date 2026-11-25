'use strict';
// Workflow 3 (join and manage a waitlist, offers) and the waitlisted half of
// workflow 4 (a pending swap that keeps the original place). Loaded by
// business.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/rules.cjs');
const {APP, fixture, withSeed, seatsOf, section, rejected, recordChecks, holdingCs240, swapOffered, offered, event, entryOf, offerOf,
  enrollmentOf} = require('./support.cjs');

const CS240_LAB1 = ['sec-cs240-lec1', 'sec-cs240-lab1'], CS240_LAB2 = ['sec-cs240-lec1', 'sec-cs240-lab2'];
const PSYC100 = ['sec-psyc100-lec1'];
const AFTER_CLOSE = '2027-01-25T09:00:00-05:00';
const own = f => f.data.enrollments.filter(e => e.occupant_ref === 'stu-noor' && e.status === 'enrolled');
const listed = f => f.call('waitlist.list');
const competitor = (f, change, payload) => f.event(event('evt-' + change + '-' + f.version.revision, f.now, 'occupancy.change', {change, ...payload}));

test('joining a waitlist records a place in the queue, not an enrollment', () => {
  const f = fixture(), before = f.data;
  const out = f.call('waitlist.join', {section_ids: PSYC100, request_id: 'join-1'});
  assert.deepEqual(out, {id: 'wl-6', receipt_id: 'rcp-7', course_id: 'crs-psyc100', section_ids: PSYC100, swap_from_enrollment_id: null,
    existing: false, rank: 1, waiting_for_section_ids: PSYC100, blocked_by: [], status: 'committed', app_id: APP, version: {epoch: 1, revision: 1}});
  assert.deepEqual(entryOf(f, 'wl-6'), {id: 'wl-6', seq: 6, occupant_ref: 'stu-noor', course_id: 'crs-psyc100', section_ids: PSYC100,
    swap_from_enrollment_id: null, status: 'queued', joined_at: f.now, ended_at: null, end_reason: null, blocked_reason: null});
  assert.deepEqual(f.data.receipts, [{id: 'rcp-7', seq: 7, at: f.now, action: 'waitlist.join', request_id: 'join-1',
    refs: {course_id: 'crs-psyc100', entry_id: 'wl-6', section_ids: PSYC100, existing: false}}]);
  // Neither credits, nor the timetable, nor a seat.
  assert.deepEqual([f.data.enrollments, f.data.offers, f.data.notices], [before.enrollments, [], []]);
  assert.deepEqual(f.call('schedule.get').credits, {enrolled: 6, limit: 16});
  assert.deepEqual(seatsOf(f, 'sec-psyc100-lec1'), {capacity: 100, enrolled: 100, held: 0, available: 0});
  assert.deepEqual(listed(f).entries.map(e => [e.id, e.status, e.rank]), [['wl-noor-cs240', 'queued', 1], ['wl-6', 'queued', 1]]);

  // A lecture with seats whose required lab is full is still something to wait for.
  const lab = f.call('waitlist.join', {section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1']});
  assert.deepEqual([lab.id, lab.waiting_for_section_ids, seatsOf(f, 'sec-phys150-lec1').held], ['wl-8', ['sec-phys150-lab1'], 0]);
  recordChecks(f.data);
});

test('joining again returns the existing entry; its rank does not change', () => {
  const f = fixture();
  const first = f.call('waitlist.join', {section_ids: PSYC100});
  competitor(f, 'waitlist_join', {occupant_ref: 'synthetic-050', section_ids: PSYC100});
  const stored = entryOf(f, first.id), entries = f.data.waitlist_entries.length;
  const again = f.call('waitlist.join', {section_ids: PSYC100, request_id: 'join-again'});
  assert.deepEqual([again.id, again.existing, again.rank, again.status], [first.id, true, 1, 'committed']);
  assert.deepEqual(entryOf(f, first.id), stored, 'the entry, and so its sequence, is unchanged');
  assert.equal(f.data.waitlist_entries.length, entries, 'no second entry');
  assert.deepEqual(f.data.receipts[f.data.receipts.length - 1].refs, {course_id: 'crs-psyc100', entry_id: first.id, section_ids: PSYC100, existing: true});
  assert.equal(again.receipt_id, f.data.receipts[f.data.receipts.length - 1].id);

  // The same holds for a pending swap, as long as it is the same request.
  const g = fixture({data: holdingCs240()});
  const swap = g.call('waitlist.join', {section_ids: CS240_LAB1, swap_from_enrollment_id: 'enr-noor-cs240'});
  assert.deepEqual([swap.id, swap.existing, swap.swap_from_enrollment_id, swap.rank], ['wl-noor-cs240', true, 'enr-noor-cs240', 1]);
  // Waiting for the same bundle in a different way is a different request, and is refused.
  rejected(g, () => g.call('waitlist.join', {section_ids: CS240_LAB1}), 'invalid_state', /already waiting for this bundle through entry wl-noor-cs240/);
});

test('a waitlist is refused when there is nothing to wait for or the request cannot stand', () => {
  const f = fixture();
  rejected(f, () => f.call('waitlist.join', {section_ids: ['sec-hist105-lec1']}), 'seats_available', /enroll directly/);
  rejected(f, () => f.call('waitlist.join', {section_ids: CS240_LAB2}), 'seats_available');
  rejected(f, () => f.call('waitlist.join', {section_ids: ['sec-geog200-lec1']}), 'not_found');
  rejected(f, () => f.call('waitlist.join', {section_ids: ['sec-phys150-lec1']}), 'invalid_bundle', /one lecture plus one lab/);
  rejected(f, () => f.call('waitlist.join', {section_ids: PSYC100, swap_from_enrollment_id: 'enr-synthetic-017-cs240'}), 'not_found');
  rejected(f, () => f.call('waitlist.join', {section_ids: ['sec-math221-lec1'], swap_from_enrollment_id: 'enr-noor-math221'}), 'invalid_bundle', /already holds exactly this bundle/);
  assert.throws(() => f.call('waitlist.join', {}), /Input schema/);
  assert.throws(() => f.call('waitlist.join', {section_ids: PSYC100, id: 'wl-noor-cs240'}), /Input schema/);
  const late = fixture({now: AFTER_CLOSE});
  rejected(late, () => late.call('waitlist.join', {section_ids: PSYC100}), 'registration_closed');

  // Changing sections of a course already held needs a swap.
  const holding = fixture({data: holdingCs240(d => { d.waitlist_entries.shift(); })});
  rejected(holding, () => holding.call('waitlist.join', {section_ids: CS240_LAB1}), 'swap_required', /swap_from_enrollment_id/);
  // One pending swap per original enrollment.
  const pending = fixture({data: holdingCs240()});
  rejected(pending, () => pending.call('waitlist.join', {section_ids: PSYC100, swap_from_enrollment_id: 'enr-noor-cs240'}), 'pending_swap_exists', /wl-noor-cs240/);
  // An enrollment already given up cannot be swapped from.
  f.call('enrollment.withdraw', {id: 'enr-noor-stat210'});
  rejected(f, () => f.call('waitlist.join', {section_ids: PSYC100, swap_from_enrollment_id: 'enr-noor-stat210'}), 'invalid_state');

  // For a swap only the sections not already held count: a free lab is not waited for, even behind a full shared lecture.
  const free = fixture({data: holdingCs240(d => {
    d.waitlist_entries = [];
    section(d, 'sec-cs240-lab1').capacity = 13;
    section(d, 'sec-cs240-lec1').capacity = 54;
  })});
  assert.equal(seatsOf(free, 'sec-cs240-lec1').available, 0);
  rejected(free, () => free.call('waitlist.join', {section_ids: CS240_LAB1, swap_from_enrollment_id: 'enr-noor-cs240'}), 'seats_available', /swap directly/);
  assert.equal(free.call('enrollment.swap', {id: 'enr-noor-cs240', section_ids: CS240_LAB1}).status, 'committed');
});

test('a pending swap is a waitlist entry tied to an enrollment that is kept', () => {
  const f = fixture({data: withSeed(d => { d.waitlist_entries = []; d.counters.next_seq = 4; })});
  const cs240 = f.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: CS240_LAB2});
  const out = f.call('waitlist.join', {section_ids: CS240_LAB1, swap_from_enrollment_id: cs240.id, request_id: 'swap-join'});
  assert.deepEqual([out.existing, out.swap_from_enrollment_id, out.rank, out.waiting_for_section_ids, out.blocked_by],
    [false, cs240.id, 1, ['sec-cs240-lab1'], []], 'only the lab is awaited; the lecture is already held');
  assert.equal(entryOf(f, out.id).swap_from_enrollment_id, cs240.id);
  assert.deepEqual(f.data.receipts[f.data.receipts.length - 1].refs,
    {course_id: 'crs-cs240', entry_id: out.id, section_ids: CS240_LAB1, existing: false, enrollment_id: cs240.id});
  assert.equal(enrollmentOf(f, cs240.id).status, 'enrolled', 'the original place is kept');
  assert.deepEqual(f.call('schedule.get').pending_swaps, [{entry_id: out.id, from_enrollment_id: cs240.id, course_id: 'crs-cs240',
    section_ids: CS240_LAB1, status: 'queued'}]);
  assert.deepEqual(f.call('schedule.get').credits, {enrolled: 7, limit: 16});

  // Cancelling the pending swap does not drop the original course.
  const left = f.call('waitlist.leave', {id: out.id, request_id: 'swap-leave'});
  assert.deepEqual([left.id, left.cancelled_offer_id, left.status], [out.id, null, 'committed']);
  assert.deepEqual([entryOf(f, out.id).status, entryOf(f, out.id).end_reason, entryOf(f, out.id).ended_at], ['left', 'left', f.now]);
  assert.equal(enrollmentOf(f, cs240.id).status, 'enrolled');
  assert.deepEqual(f.call('schedule.get').pending_swaps, []);
  assert.deepEqual(own(f).map(e => e.course_id), ['crs-math221', 'crs-cs240']);
});

test('an entry that fails a rule keeps its place and holds nothing; a later eligible entry is offered the seat', () => {
  // With a 9-credit limit the student cannot add 4-credit CS240 to her 6 credits.
  const f = fixture({data: withSeed(d => { d.student.credit_limit = 9; })});
  assert.deepEqual(listed(f).entries[0].blocked_by.map(b => b.code), ['credit_limit_exceeded']);
  f.event(event('evt-0007', '2027-01-11T09:30:00-05:00', 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'}));
  // First in the queue, but skipped: the seat goes to the entry behind her.
  assert.deepEqual(f.data.offers.map(o => [o.id, o.entry_id, o.status]), [['off-6', 'wl-synthetic-021-cs240', 'live']]);
  assert.deepEqual(f.data.notices, [], 'the student was offered nothing');
  const skipped = listed(f).entries[0];
  assert.deepEqual([skipped.status, skipped.rank, skipped.waiting_for_section_ids, skipped.blocked_by.map(b => b.code)],
    ['queued', 1, ['sec-cs240-lab1'], ['credit_limit_exceeded']]);
  assert.deepEqual(listed(f).offers, []);

  // She regains eligibility by dropping a course; the seat is still held for the other entry.
  f.call('enrollment.withdraw', {id: 'enr-noor-stat210'});
  assert.deepEqual([listed(f).entries[0].blocked_by, listed(f).entries[0].waiting_for_section_ids, f.data.offers.length], [[], ['sec-cs240-lab1'], 1]);
  // When that offer is declined the seat comes back to the front of the queue.
  competitor(f, 'offer_decline', {occupant_ref: 'synthetic-021', offer_id: 'off-6'});
  const mine = listed(f);
  assert.deepEqual([mine.entries[0].status, mine.offers.map(o => o.entry_id)], ['offered', ['wl-noor-cs240']]);
  assert.equal(entryOf(f, 'wl-synthetic-021-cs240').status, 'declined');
  recordChecks(f.data);
});

test('competitors are passed over under the rules that need no academic record', () => {
  const leaves = f => f.event(event('evt-0007', '2027-01-11T09:30:00-05:00', 'occupancy.change',
    {change: 'withdraw', occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'}));
  // The competitor ahead of the student is blocked by the scenario: the seat comes to her.
  const blocked = fixture({data: withSeed(d => {
    Object.assign(d.waitlist_entries[1], {seq: 4, joined_at: '2027-01-05T09:00:00-05:00', blocked_reason: 'registration_hold'});
    Object.assign(d.waitlist_entries[0], {seq: 5});
  })});
  assert.equal(listed(blocked).entries[0].rank, 2, 'second in the queue');
  leaves(blocked);
  assert.deepEqual(blocked.data.offers.map(o => o.entry_id), ['wl-noor-cs240']);
  assert.deepEqual([entryOf(blocked, 'wl-synthetic-021-cs240').status, entryOf(blocked, 'wl-synthetic-021-cs240').blocked_reason], ['queued', 'registration_hold']);

  // A competitor already enrolled in the course is not offered a second place in it.
  const enrolled = fixture({data: withSeed(d => {
    d.waitlist_entries.shift();
    d.enrollments.push({id: 'enr-synthetic-021-cs240', seq: 6, occupant_ref: 'synthetic-021', course_id: 'crs-cs240', section_ids: CS240_LAB2,
      status: 'enrolled', enrolled_at: '2026-12-06T09:00:00-05:00', ended_at: null});
    d.counters.next_seq = 7;
  })});
  leaves(enrolled);
  assert.deepEqual([enrolled.data.offers, entryOf(enrolled, 'wl-synthetic-021-cs240').status], [[], 'queued']);

  // Once registration has closed, a freed seat is offered to no one, student or competitor.
  const closed = fixture({now: AFTER_CLOSE});
  closed.event(event('evt-late', AFTER_CLOSE, 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'}));
  assert.deepEqual([closed.data.offers, closed.data.waitlist_entries.map(e => e.status), seatsOf(closed, 'sec-cs240-lab1').available], [[], ['queued', 'queued'], 1]);
  assert.deepEqual(listed(closed).entries[0].blocked_by.map(b => b.code), ['registration_closed']);
});

test('entries that share a section are served in one join order, and a bundle is offered whole or not at all', () => {
  // CS240 LEC 1 is full. One competitor holds LEC 1 + LAB 2; LAB 1 is full, LAB 2 is not.
  const world = change => withSeed(d => {
    section(d, 'sec-cs240-lec1').capacity = 54;
    d.enrollments.push({id: 'enr-synthetic-030-cs240', seq: 6, occupant_ref: 'synthetic-030', course_id: 'crs-cs240', section_ids: CS240_LAB2,
      status: 'enrolled', enrolled_at: '2026-12-04T09:00:00-05:00', ended_at: null});
    d.waitlist_entries[1].section_ids = CS240_LAB2;
    d.counters.next_seq = 7;
    change(d);
  });
  const leaves = f => competitor(f, 'withdraw', {occupant_ref: 'synthetic-030', enrollment_id: 'enr-synthetic-030-cs240'});

  // The student is first, but her bundle is incomplete: a lecture seat appears, her lab is still full.
  const f = fixture({data: world(() => {})});
  assert.deepEqual([seatsOf(f, 'sec-cs240-lec1').available, seatsOf(f, 'sec-cs240-lab1').available], [0, 0]);
  leaves(f);
  assert.deepEqual(f.data.offers.map(o => [o.entry_id, o.held_section_ids]), [['wl-synthetic-021-cs240', CS240_LAB2]], 'the later entry can use the seat');
  const first = listed(f).entries[0];
  assert.deepEqual([first.status, first.rank, first.waiting_for_section_ids], ['queued', 1, CS240_LAB1], 'still first, holding no part of the bundle');
  assert.deepEqual([seatsOf(f, 'sec-cs240-lec1').held, seatsOf(f, 'sec-cs240-lab1').held], [1, 0]);

  // The other way round: the competitor joined first, so the one lecture seat is theirs although the student's lab is free.
  const g = fixture({data: world(d => {
    Object.assign(d.waitlist_entries[1], {seq: 4, joined_at: '2027-01-05T09:00:00-05:00'});
    Object.assign(d.waitlist_entries[0], {seq: 5});
    section(d, 'sec-cs240-lab1').capacity = 13;
  })});
  assert.equal(listed(g).entries[0].rank, 2, 'behind an earlier entry for the shared lecture');
  leaves(g);
  assert.deepEqual(g.data.offers.map(o => o.entry_id), ['wl-synthetic-021-cs240']);
  assert.deepEqual([listed(g).entries[0].status, listed(g).entries[0].waiting_for_section_ids], ['queued', ['sec-cs240-lec1']]);
  assert.equal(seatsOf(g, 'sec-cs240-lab1').held, 0, 'her free lab is not held while the lecture is missing');
  competitor(g, 'offer_decline', {occupant_ref: 'synthetic-021', offer_id: g.data.offers[0].id});
  assert.deepEqual(listed(g).offers.map(o => o.held_section_ids), [CS240_LAB1]);
});

test('an offer holds a seat but is not an enrollment, and a notice accepts nothing', () => {
  const f = offered(), before = f.data;
  assert.deepEqual(offerOf(f, 'off-6'), {id: 'off-6', seq: 6, entry_id: 'wl-noor-cs240', held_section_ids: CS240_LAB1,
    issued_at: '2027-01-11T09:30:00-05:00', expires_at: '2027-01-12T09:30:00-05:00', status: 'live', resolved_at: null});
  assert.deepEqual(f.data.notices, [{id: 'ntc-7', seq: 7, at: f.now, kind: 'offer_issued', text: f.data.notices[0].text,
    refs: {course_id: 'crs-cs240', entry_id: 'wl-noor-cs240', offer_id: 'off-6', expires_at: '2027-01-12T09:30:00-05:00', event_id: 'evt-0007'}}]);
  assert.match(f.data.notices[0].text, /CS240 LEC 1 \+ LAB 1 until 2027-01-12T09:30:00-05:00.*not an enrollment/);
  const view = listed(f);
  assert.deepEqual(view.offers, [{id: 'off-6', entry_id: 'wl-noor-cs240', course_id: 'crs-cs240', held_section_ids: CS240_LAB1,
    issued_at: '2027-01-11T09:30:00-05:00', expires_at: '2027-01-12T09:30:00-05:00', expired: false}]);
  assert.deepEqual([view.entries[0].status, view.entries[0].waiting_for_section_ids, view.entries[0].blocked_by], ['offered', [], []]);
  // Reading the notice, the offer and the schedule changes nothing: still two courses and six credits.
  f.call('activity.list');
  assert.deepEqual(f.call('schedule.get').enrollments.map(e => e.code), ['MATH221', 'STAT210']);
  assert.deepEqual(f.call('record.get').credits, {enrolled: 6, limit: 16});
  assert.deepEqual(f.data, before);
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 12, enrolled: 11, held: 1, available: 0}, 'the seat is held, not occupied');
});

test('accepting an offer turns the held seat into an enrollment', () => {
  const f = offered();
  const preview = f.call('change.preview', {action: 'accept_offer', id: 'off-6'});
  assert.deepEqual([preview.action, preview.allowed, preview.failures, preview.credits, preview.cancelled_entry_ids],
    ['accept_offer', true, [], {current: 6, resulting: 10, limit: 16}, []]);
  assert.deepEqual(preview.schedule.map(r => r.code + ':' + r.change), ['MATH221:kept', 'STAT210:kept', 'CS240:added']);

  const out = f.call('offer.accept', {id: 'off-6', expected_version: preview.version, request_id: 'accept-1'});
  assert.deepEqual(out, {id: 'enr-8', receipt_id: 'rcp-9', offer_id: 'off-6', entry_id: 'wl-noor-cs240', course_id: 'crs-cs240', section_ids: CS240_LAB1,
    replaced_id: null, credits: {enrolled: 10, limit: 16}, status: 'committed', app_id: APP, version: {epoch: 1, revision: 2}});
  assert.deepEqual(enrollmentOf(f, 'enr-8'), {id: 'enr-8', seq: 8, occupant_ref: 'stu-noor', course_id: 'crs-cs240', section_ids: CS240_LAB1,
    status: 'enrolled', enrolled_at: f.now, ended_at: null});
  assert.deepEqual([offerOf(f, 'off-6').status, offerOf(f, 'off-6').resolved_at], ['accepted', f.now]);
  assert.deepEqual([entryOf(f, 'wl-noor-cs240').status, entryOf(f, 'wl-noor-cs240').end_reason, entryOf(f, 'wl-noor-cs240').ended_at], ['fulfilled', 'fulfilled', f.now]);
  assert.deepEqual(f.data.receipts, [{id: 'rcp-9', seq: 9, at: f.now, action: 'offer.accept', request_id: 'accept-1',
    refs: {course_id: 'crs-cs240', enrollment_id: 'enr-8', entry_id: 'wl-noor-cs240', offer_id: 'off-6', section_ids: CS240_LAB1}}]);
  // The hold became the occupied seat; nothing is counted twice.
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 12, enrolled: 12, held: 0, available: 0});
  assert.deepEqual(seatsOf(f, 'sec-cs240-lec1'), {capacity: 60, enrolled: 53, held: 0, available: 7});
  assert.deepEqual(listed(f), {entries: [], offers: [], status: 'ok', app_id: APP, version: {epoch: 1, revision: 2}});
  assert.deepEqual(f.call('schedule.get').enrollments.map(e => e.code), ['MATH221', 'STAT210', 'CS240']);
  // An offer is accepted once.
  rejected(f, () => f.call('offer.accept', {id: 'off-6'}), 'offer_not_live', /accepted/);
  rejected(f, () => f.call('offer.decline', {id: 'off-6'}), 'offer_not_live');
  assert.deepEqual(f.call('change.preview', {action: 'accept_offer', id: 'off-6'}).failures.map(x => x.code), ['offer_not_live']);
  recordChecks(f.data);
});

test('accepting a pending swap gives up the original and takes the new bundle together', () => {
  // The shared lecture is full: the swap still works, and its seat is counted once.
  const f = fixture({data: swapOffered(d => { section(d, 'sec-cs240-lec1').capacity = 54; })});
  assert.deepEqual(seatsOf(f, 'sec-cs240-lec1'), {capacity: 54, enrolled: 54, held: 0, available: 0});
  const preview = f.call('change.preview', {action: 'accept_offer', id: 'off-6'});
  assert.deepEqual([preview.allowed, preview.credits, preview.schedule.map(r => r.code + ':' + r.change), preview.cancelled_entry_ids],
    [true, {current: 7, resulting: 7, limit: 16}, ['MATH221:kept', 'CS240:removed', 'CS240:added'], []]);

  const out = f.call('offer.accept', {id: 'off-6', request_id: 'accept-swap'});
  assert.deepEqual([out.id, out.replaced_id, out.section_ids, out.credits], ['enr-7', 'enr-noor-cs240', CS240_LAB1, {enrolled: 7, limit: 16}]);
  assert.deepEqual([enrollmentOf(f, 'enr-noor-cs240').status, enrollmentOf(f, 'enr-noor-cs240').ended_at], ['swapped_out', f.now]);
  assert.equal(enrollmentOf(f, 'enr-7').status, 'enrolled');
  assert.deepEqual(own(f).map(e => e.section_ids), [['sec-math221-lec1'], CS240_LAB1], 'one CS240 enrollment, the new one');
  assert.deepEqual(f.data.receipts[0].refs, {course_id: 'crs-cs240', enrollment_id: 'enr-7', entry_id: 'wl-noor-cs240', offer_id: 'off-6',
    section_ids: CS240_LAB1, replaced_enrollment_id: 'enr-noor-cs240'});
  assert.deepEqual(seatsOf(f, 'sec-cs240-lec1'), {capacity: 54, enrolled: 54, held: 0, available: 0}, 'the shared lecture seat carried over');
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 13, enrolled: 13, held: 0, available: 0});
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab2'), {capacity: 12, enrolled: 9, held: 0, available: 3}, 'the old lab seat was released');
  assert.deepEqual([entryOf(f, 'wl-noor-cs240').status, offerOf(f, 'off-6').status, f.data.notices], ['fulfilled', 'accepted', []]);
  assert.deepEqual(f.call('schedule.get').pending_swaps, []);
  recordChecks(f.data);

  // The lab seat she gives up is offered, in the same commit, to whoever was waiting for it.
  const g = fixture({data: swapOffered(d => {
    section(d, 'sec-cs240-lab2').capacity = 10;
    d.waitlist_entries[1].section_ids = CS240_LAB2;
  })});
  assert.equal(seatsOf(g, 'sec-cs240-lab2').available, 0);
  g.call('offer.accept', {id: 'off-6'});
  assert.deepEqual(g.data.offers.slice(1).map(o => [o.entry_id, o.held_section_ids, o.status]), [['wl-synthetic-021-cs240', CS240_LAB2, 'live']]);
  assert.deepEqual(seatsOf(g, 'sec-cs240-lab2'), {capacity: 10, enrolled: 9, held: 1, available: 0});
});

test('a failed acceptance keeps the original enrollment and the offer', () => {
  // After the swap offer was issued, the target lab is moved onto MATH221.
  const f = fixture({data: swapOffered()});
  f.event(event('evt-move', f.now, 'section.reschedule', {section_id: 'sec-cs240-lab1', meetings: [{days: ['MON', 'WED'], start: '10:30', end: '12:20'}]}));
  const told = f.data.notices[f.data.notices.length - 1];
  assert.deepEqual([told.kind, told.refs], ['section_rescheduled', {event_id: 'evt-move', course_id: 'crs-cs240', section_id: 'sec-cs240-lab1',
    from_version: 1, to_version: 2, entry_id: 'wl-noor-cs240', offer_id: 'off-6'}]);
  assert.match(told.text, /stays open; accepting is checked against the new times/);
  const view = listed(f).entries[0];
  assert.deepEqual([view.status, view.blocked_by.map(b => [b.code, b.conflicts])], ['offered', [['time_conflict', [['sec-cs240-lab1', 'sec-math221-lec1']]]]]);
  assert.deepEqual(f.call('change.preview', {action: 'accept_offer', id: 'off-6'}).failures.map(x => x.code), ['time_conflict']);
  rejected(f, () => f.call('offer.accept', {id: 'off-6'}), 'time_conflict');
  assert.deepEqual([enrollmentOf(f, 'enr-noor-cs240').status, offerOf(f, 'off-6').status, entryOf(f, 'wl-noor-cs240').status, seatsOf(f, 'sec-cs240-lab1').held],
    ['enrolled', 'live', 'offered', 1], 'original enrollment kept, offer still live and still holding its seat');
  // The student can make room and then accept the same offer.
  f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']});
  assert.equal(f.call('offer.accept', {id: 'off-6'}).replaced_id, 'enr-noor-cs240');
});

test('a seat held for the student\'s own offer is used by accepting it, not by a separate change', () => {
  const f = fixture({data: swapOffered()});
  const preview = f.call('change.preview', {action: 'swap', id: 'enr-noor-cs240', section_ids: CS240_LAB1});
  assert.deepEqual(preview.failures.map(x => [x.code, x.full_section_ids, x.offer_id]), [['section_full', ['sec-cs240-lab1'], 'off-6']]);
  rejected(f, () => f.call('enrollment.swap', {id: 'enr-noor-cs240', section_ids: CS240_LAB1}), 'section_full', /held for your offer off-6: accept that offer/);
  const plain = offered();
  rejected(plain, () => plain.call('enrollment.enroll', {section_ids: CS240_LAB1}), 'section_full', /accept that offer/);
  // A seat held for someone else carries no such hint.
  const other = fixture({data: withSeed(d => { d.student.credit_limit = 9; })});
  other.event(event('evt-0007', '2027-01-11T09:30:00-05:00', 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'}));
  const full = other.call('change.preview', {action: 'enroll', section_ids: CS240_LAB1}).failures.find(x => x.code === 'section_full');
  assert.deepEqual([full.full_section_ids, full.offer_id, /offer/.test(full.message)], [['sec-cs240-lab1'], undefined, false]);
});

test('declining closes the offer, releases the seat and passes it to the next entry', () => {
  const f = offered();
  const out = f.call('offer.decline', {id: 'off-6', request_id: 'decline-1'});
  assert.deepEqual(out, {id: 'off-6', receipt_id: 'rcp-8', entry_id: 'wl-noor-cs240', course_id: 'crs-cs240', section_ids: CS240_LAB1,
    status: 'committed', app_id: APP, version: {epoch: 1, revision: 2}});
  assert.deepEqual([offerOf(f, 'off-6').status, offerOf(f, 'off-6').resolved_at], ['declined', f.now]);
  assert.deepEqual([entryOf(f, 'wl-noor-cs240').status, entryOf(f, 'wl-noor-cs240').end_reason], ['declined', 'declined'], 'a declined entry leaves the queue');
  assert.deepEqual(f.data.receipts[0].refs, {course_id: 'crs-cs240', entry_id: 'wl-noor-cs240', offer_id: 'off-6', section_ids: CS240_LAB1});
  // The same commit re-checked the queue.
  assert.deepEqual(f.data.offers.slice(1).map(o => [o.id, o.entry_id, o.status, o.expires_at]),
    [['off-9', 'wl-synthetic-021-cs240', 'live', '2027-01-12T09:30:00-05:00']]);
  assert.deepEqual(listed(f).entries, []);
  assert.deepEqual(own(f).map(e => e.course_id), ['crs-math221', 'crs-stat210']);
  rejected(f, () => f.call('offer.accept', {id: 'off-6'}), 'offer_not_live', /declined/);

  // Declining a swap offer keeps the original enrollment.
  const g = fixture({data: swapOffered()});
  g.call('offer.decline', {id: 'off-6'});
  assert.deepEqual([enrollmentOf(g, 'enr-noor-cs240').status, entryOf(g, 'wl-noor-cs240').status, g.call('schedule.get').pending_swaps], ['enrolled', 'declined', []]);
});

test('leaving the waitlist removes the entry and any offer made to it', () => {
  const f = fixture();
  const out = f.call('waitlist.leave', {id: 'wl-noor-cs240', request_id: 'leave-1'});
  assert.deepEqual(out, {id: 'wl-noor-cs240', receipt_id: 'rcp-6', course_id: 'crs-cs240', section_ids: CS240_LAB1, cancelled_offer_id: null,
    status: 'committed', app_id: APP, version: {epoch: 1, revision: 1}});
  assert.deepEqual([entryOf(f, 'wl-noor-cs240').status, entryOf(f, 'wl-noor-cs240').ended_at, entryOf(f, 'wl-noor-cs240').end_reason], ['left', f.now, 'left']);
  assert.deepEqual(listed(f).entries, []);
  rejected(f, () => f.call('waitlist.leave', {id: 'wl-noor-cs240'}), 'invalid_state', /already left/);
  // Having left, the student may join again, at the back.
  competitor(f, 'withdraw', {occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'});
  assert.deepEqual(f.data.offers.map(o => o.entry_id), ['wl-synthetic-021-cs240']);
  const back = f.call('waitlist.join', {section_ids: CS240_LAB1});
  assert.deepEqual([back.existing, back.rank], [false, 2]);

  // Leaving with an offer in hand cancels the offer and frees its seat for the next entry.
  const g = offered();
  const left = g.call('waitlist.leave', {id: 'wl-noor-cs240'});
  assert.equal(left.cancelled_offer_id, 'off-6');
  assert.deepEqual([offerOf(g, 'off-6').status, offerOf(g, 'off-6').resolved_at, entryOf(g, 'wl-noor-cs240').status], ['cancelled', g.now, 'left']);
  assert.deepEqual(g.data.offers.slice(1).map(o => o.entry_id), ['wl-synthetic-021-cs240']);
  assert.equal(g.data.receipts[0].refs.offer_id, 'off-6');
});

test('another occupant\'s entries and offers cannot be touched or told apart from missing ones', () => {
  // The competitor behind the student holds the offer.
  const f = fixture({data: withSeed(d => { d.student.credit_limit = 9; })});
  competitor(f, 'withdraw', {occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'});
  assert.deepEqual(f.data.offers.map(o => [o.id, o.entry_id]), [['off-6', 'wl-synthetic-021-cs240']]);
  const refusal = (tool, id) => {
    const before = f.data;
    try { f.call(tool, {id}); } catch (error) { assert.deepEqual(f.data, before); return [error.code, error.message.split(id).join('<id>')]; }
    return 'committed';
  };
  for (const [tool, theirs] of [['offer.accept', 'off-6'], ['offer.decline', 'off-6'], ['waitlist.leave', 'wl-synthetic-021-cs240']]) {
    assert.equal(refusal(tool, theirs)[0], 'not_found', tool);
    assert.deepEqual(refusal(tool, theirs), refusal(tool, 'no-such-row'), tool + ' answers both the same way');
  }
  const mask = (value, id) => JSON.stringify(value).split(id).join('<id>');
  assert.equal(mask(f.call('change.preview', {action: 'accept_offer', id: 'off-6'}), 'off-6'),
    mask(f.call('change.preview', {action: 'accept_offer', id: 'no-such-row'}), 'no-such-row'));
  assert.equal(offerOf(f, 'off-6').status, 'live');
});

test('what a preview of an acceptance says is what accepting then does', () => {
  const cases = [
    () => offered(),
    () => fixture({data: swapOffered()}),
    // At the expiry instant itself.
    () => fixture({data: swapOffered(), now: '2027-01-11T09:30:00-05:00'}),
    () => { const f = fixture({data: swapOffered()}); f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']}); return f; },
    // The offer was issued while CS240 fitted under the limit; a later enrollment used the room up.
    () => { const f = offered({data: withSeed(d => { d.student.credit_limit = 12; })}); f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1']}); return f; }
  ];
  const outcomes = cases.map(build => {
    const f = build(), preview = f.call('change.preview', {action: 'accept_offer', id: 'off-6'}), before = f.data;
    if (preview.allowed) {
      assert.equal(f.call('offer.accept', {id: 'off-6'}).credits.enrolled, preview.credits.resulting);
      return 'committed';
    }
    const first = rules.PRIORITY.find(code => preview.failures.some(x => x.code === code));
    assert.throws(() => f.call('offer.accept', {id: 'off-6'}), {code: first});
    assert.deepEqual(f.data, before, 'a refused acceptance leaves the offer and the enrollments as they were');
    assert.equal(offerOf(f, 'off-6').status, 'live');
    return first;
  });
  assert.deepEqual(outcomes, ['committed', 'committed', 'offer_expired', 'committed', 'credit_limit_exceeded']);
});
