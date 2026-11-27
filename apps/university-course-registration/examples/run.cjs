'use strict';
// Runnable walkthrough on fresh synthetic data, covering the four workflows:
// inspect, enroll / withdraw, waitlist and offer, swap. Infra events are the
// three from the approved proposal. Every step is checked against the stored
// ledger rather than the reply.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

const APP = 'university-course-registration';
const event = (event_id, at, operation, payload = {}) => ({event_id, at, operation: APP + '.' + operation, payload});
const f = fixture(), before = f.data;
const active = data => data.enrollments.filter(e => e.occupant_ref === data.student.id && e.status === 'enrolled').map(e => e.section_ids.join('+'));

// 1. Inspect: nothing in this block changes data.
const found = f.call('catalog.search', {query: 'history', open_only: true});
assert.deepEqual(found.courses.map(c => c.code), ['HIST105']);
const cs240 = f.call('course.get', {id: 'crs-cs240'});
assert.deepEqual(cs240.bundles.map(b => b.available), [false, true]);
const waiting = f.call('waitlist.list').entries[0];
assert.deepEqual([waiting.rank, waiting.waiting_for_section_ids], [1, ['sec-cs240-lab1']]);
assert.deepEqual(f.data, before, 'reads change nothing');

// 2. Enroll: preview, then confirm with the version the preview was computed from.
const preview = f.call('change.preview', {action: 'enroll', section_ids: ['sec-hist105-lec1']});
assert.equal(preview.allowed, true);
const enrolled = f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1'], expected_version: preview.version, request_id: 'example-enroll'});
assert.equal(enrolled.credits.enrolled, preview.credits.resulting);
assert.equal(f.data.receipts.at(-1).id, enrolled.receipt_id);

// 3. Waitlist and offer. A competitor leaves CS240 (evt-0007): the student, first in the queue, is offered the bundle.
f.event(event('evt-0007', '2027-01-11T09:30:00-05:00', 'occupancy.change', {enrollment_id: 'enr-synthetic-017-cs240', occupant_ref: 'synthetic-017', change: 'withdraw'}));
const offer = f.call('waitlist.list').offers[0];
assert.equal(offer.expires_at, '2027-01-12T09:30:00-05:00');
assert.equal(active(f.data).length, 3, 'an offer is not an enrollment');
// A section she holds is moved onto another of her courses (evt-0012): the conflict is visible and attributed.
f.event(event('evt-0012', '2027-01-12T08:00:00-05:00', 'section.reschedule', {section_id: 'sec-math221-lec1', meetings: [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}]}));
const conflict = f.call('schedule.get').conflicts[0];
assert.deepEqual([conflict.section_ids, conflict.caused_by.event_id], [['sec-math221-lec1', 'sec-stat210-lec1'], 'evt-0012']);
// She accepts in time; the existing conflict does not stop an unrelated acceptance.
const accepting = f.call('change.preview', {action: 'accept_offer', id: offer.id});
assert.equal(accepting.allowed, true);
const accepted = f.call('offer.accept', {id: offer.id, expected_version: accepting.version, request_id: 'example-accept'});
assert.deepEqual([f.data.offers[0].status, f.data.waitlist_entries[0].status], ['accepted', 'fulfilled']);
// The expiry event at the old deadline now finds nothing of hers to expire.
f.event(event('evt-0015', '2027-01-12T09:30:00-05:00', 'offers.expire'));
assert.equal(f.data.offers[0].status, 'accepted');

// 4. Swap: repair the conflict without losing a place. A swap that fails a rule changes nothing.
const kept = f.data;
assert.throws(() => f.call('enrollment.swap', {id: 'enr-noor-stat210', section_ids: ['sec-cs310-lec1']}), {code: 'prerequisite_missing'});
assert.deepEqual(f.data, kept, 'a refused swap keeps the original enrollment');
const swapped = f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2'], request_id: 'example-swap'});
assert.equal(f.data.enrollments.find(e => e.id === swapped.replaced_id).status, 'swapped_out');
assert.deepEqual(f.call('schedule.get').conflicts, []);
// A pending swap: wait for a full section while keeping the current one, then change her mind.
const pending = f.call('waitlist.join', {section_ids: ['sec-psyc100-lec1'], swap_from_enrollment_id: enrolled.id, request_id: 'example-join'});
assert.deepEqual([pending.rank, f.call('schedule.get').pending_swaps.length], [1, 1]);
f.call('waitlist.leave', {id: pending.id, request_id: 'example-leave'});
assert.equal(f.data.enrollments.find(e => e.id === enrolled.id).status, 'enrolled', 'leaving a pending swap keeps the original course');

// 2 again. Withdraw.
const withdrawn = f.call('enrollment.withdraw', {id: 'enr-noor-stat210', request_id: 'example-withdraw'});
assert.deepEqual(active(f.data), ['sec-hist105-lec1', 'sec-cs240-lec1+sec-cs240-lab1', 'sec-math221-lec2']);
const activity = f.call('activity.list');
assert.deepEqual(activity.receipts.map(r => r.action),
  ['enrollment.enroll', 'offer.accept', 'enrollment.swap', 'waitlist.join', 'waitlist.leave', 'enrollment.withdraw']);
assert.deepEqual(activity.notices.map(n => n.kind), ['offer_issued', 'section_rescheduled']);

console.log(JSON.stringify({
  app: APP,
  student: before.student.id,
  inspected: {open_history_courses: found.courses.map(c => c.code), cs240_bundles_available: cs240.bundles.map(b => b.available), waitlist_rank: waiting.rank},
  enrolled: {id: enrolled.id, receipt_id: enrolled.receipt_id, credits: enrolled.credits},
  offer: {id: offer.id, expires_at: offer.expires_at, accepted_as: accepted.id, credits: accepted.credits},
  conflict: {sections: conflict.section_ids, caused_by: conflict.caused_by.event_id, repaired_by: swapped.id},
  pending_swap: {entry: pending.id, left: true, original_kept: true},
  withdrawn: {id: withdrawn.id, credits: withdrawn.credits},
  notices: activity.notices.map(n => n.kind),
  receipts: activity.receipts.map(r => r.action),
  schedule: {before: active(before), after: active(f.data)}
}, null, 2));
