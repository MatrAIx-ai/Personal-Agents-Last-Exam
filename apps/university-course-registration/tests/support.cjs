'use strict';
// Shared helpers and seed variants for the App-only tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ledger = require('../src/ledger.cjs');
const harness = require('./harness.cjs');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const seed = () => read('fixtures/minimal.json');
const clone = value => structuredClone(value);
const withSeed = change => { const data = seed(); change(data); return data; };
const seatsOf = (f, id) => ledger.seats(f.data).get(id);
const section = (data, id) => data.sections.find(s => s.id === id);

// Run fn, expect a rule failure with this status code, and require that the
// stored ledger is exactly what it was before.
function rejected(f, fn, code, pattern) {
  const before = f.data;
  assert.throws(fn, error => {
    assert.equal(error.code, code, 'status code (' + error.message + ')');
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
  assert.deepEqual(f.data, before, 'a rejected operation must not change the ledger');
}

// The student holds CS240 as LEC 1 + LAB 2 (instead of STAT210) and waits to
// swap into LAB 1: a pending swap that shares the lecture with its original.
function holdingCs240(change = () => {}) {
  return withSeed(d => {
    d.enrollments[1] = {id: 'enr-noor-cs240', seq: 2, occupant_ref: 'stu-noor', course_id: 'crs-cs240',
      section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2'], status: 'enrolled', enrolled_at: '2026-12-02T10:17:00-05:00', ended_at: null};
    d.waitlist_entries[0].swap_from_enrollment_id = 'enr-noor-cs240';
    change(d);
  });
}
// As above, and a seat in LAB 1 is on offer to the student's pending swap.
function swapOffered(change = () => {}) {
  return holdingCs240(d => {
    section(d, 'sec-cs240-lab1').capacity = 13;
    d.waitlist_entries[0].status = 'offered';
    d.offers.push({id: 'off-6', seq: 6, entry_id: 'wl-noor-cs240', held_section_ids: ['sec-cs240-lab1'],
      issued_at: '2027-01-10T09:30:00-05:00', expires_at: '2027-01-11T09:30:00-05:00', status: 'live', resolved_at: null});
    d.counters.next_seq = 7;
    change(d);
  });
}
// MATH221 LEC 1 was moved onto STAT210's time by a platform event.
const RESCHEDULED_AT = '2027-01-12T08:00:00-05:00';
function rescheduled(change = () => {}) {
  return withSeed(d => {
    const lecture = section(d, 'sec-math221-lec1');
    lecture.history.push({version: 1, meetings: lecture.meetings, replaced_at: RESCHEDULED_AT, event_id: 'evt-0012'});
    lecture.meetings = [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}];
    lecture.version = 2;
    change(d);
  });
}

// An Infra event envelope for this App.
const event = (event_id, at, operation, payload = {}) => ({event_id, at, operation: harness.APP + '.' + operation, payload});
// The three envelopes of the approved proposal's worked example, verbatim.
const EXAMPLE_EVENTS = [
  event('evt-0007', '2027-01-11T09:30:00-05:00', 'occupancy.change', {enrollment_id: 'enr-synthetic-017-cs240', occupant_ref: 'synthetic-017', change: 'withdraw'}),
  event('evt-0012', '2027-01-12T08:00:00-05:00', 'section.reschedule', {section_id: 'sec-math221-lec1', meetings: [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}]}),
  event('evt-0015', '2027-01-12T09:30:00-05:00', 'offers.expire', {})
];
// The packaged seed after evt-0007: a competitor left CS240 and the student's
// entry holds offer off-6 for LEC 1 + LAB 1 until 2027-01-12T09:30-05:00.
function offered(options = {}) {
  const f = harness.fixture(options);
  f.event(EXAMPLE_EVENTS[0]);
  return f;
}
// Apply an event, expect it to be refused with this code, and require that nothing changed.
function refusedEvent(f, envelope, code, pattern) {
  const before = f.data, version = f.version, now = f.now;
  assert.throws(() => f.event(envelope), error => {
    assert.equal(error.code, code, 'status code (' + error.message + ')');
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
  assert.deepEqual([f.data, f.version, f.now], [before, version, now], 'a refused event changes neither the ledger nor the clock');
}
const entryOf = (f, id) => f.data.waitlist_entries.find(e => e.id === id);
const offerOf = (f, id) => f.data.offers.find(o => o.id === id);
const enrollmentOf = (f, id) => f.data.enrollments.find(e => e.id === id);

module.exports = {...harness, root, read, seed, clone, withSeed, seatsOf, section, rejected, holdingCs240, swapOffered,
  rescheduled, RESCHEDULED_AT, event, EXAMPLE_EVENTS, offered, refusedEvent, entryOf, offerOf, enrollmentOf};
