'use strict';
// Runnable walkthrough without a host, on the proposal's example seed (Mon 2027-03-08 09:00, America/New_York):
// read the rules and open slots, book a math session with an intake, the centre opens a Friday slot
// (examples/scenario.json), book the writing centre with a draft, the session is attended and the tutor's report
// arrives (examples/events/), mark the follow-up done when the student has done it, then show what the integrity
// checker reports for graders.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const {checkAppointments} = require('../src/checker.cjs');

const T = 'tutorwell.';
const f = fixture();
const rules = f.call(T + 'services.list');
const open = f.call(T + 'slots.list', {skill_id: 'alg-factoring'}).slots.map(s => s.id + ' ' + s.weekday + ' ' + s.start);
const math = f.call(T + 'appointments.book', {slot_id: 's1', intake: {skill_ids: ['alg-factoring'], questions: ['How do I start when the leading coefficient is not 1?'],
  item_refs: ['q-4', 'q-7'], work_type: 'homework', share_accommodations: false}});
f.event(require('./scenario.json'));
const writing = f.call(T + 'appointments.book', {slot_id: 's3', intake: {skill_ids: ['wr-thesis'], questions: ['Is my claim arguable?'], item_refs: ['hist-essay-2'],
  work_type: 'draft', draft_ref: 'hist-essay-2-v1', share_accommodations: false}});
assert.equal(writing.id, 'apt-2');
// The examples name apt-1, so the writing session here is attended and reported as apt-2.
f.event({...require('./events/appointment-attended.json'), payload: {appointment_id: 'apt-2', outcome: 'completed'}});
const report = require('./events/report-posted.json');
f.event({...report, payload: {...report.payload, appointment_id: 'apt-2'}});
f.advance('2027-03-11T12:00:00-05:00');
f.call(T + 'followups.set_status', {followup_id: 'fu-1', status: 'done'});
const check = checkAppointments(f.snapshot());
console.log(JSON.stringify({app: 'tutorwell', rule_version: rules.rule_version, settings: rules.settings, open_factoring_slots: open,
  booked: math, profile: f.call(T + 'profile.get'),
  appointments: f.call(T + 'appointments.list').appointments.map(a => ({id: a.id, start: a.start, status: a.status, cancellation_cutoff: a.cancellation_cutoff, report_id: a.report_id})),
  checker: {intakes: check.intakes.map(i => ({appointment_id: i.appointment_id, shared_without_consent: i.shared_without_consent})), followups: check.followups,
    no_shows: check.no_shows, suspensions: check.suspensions}}, null, 2));
