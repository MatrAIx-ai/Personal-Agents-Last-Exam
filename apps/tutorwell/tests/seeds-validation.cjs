'use strict';
// validateSeed: unique IDs, valid references, non-overlapping slots per tutor, outcomes only for started sessions,
// reports only for completed ones, and past records not after the run's virtual time, while scheduled times (slot
// starts, due dates) may be later. A seed that fails is not loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {history, binding, at, NOW} = require('./seeds.cjs');
const {fixture} = require('./harness.cjs');

const load = (seed, now = NOW) => plugin.validateSeed({app_id: 'tutorwell', virtual_now: now, binding: binding(seed)}, seed);
const apt = (d, id) => d.appointments.find(a => a.id === id);
const CASES = [
  ['a duplicate ID across collections', d => { d.slots[1].id = 'math'; }],
  ['an unbound account', d => { d.account_id = 'other'; }],
  ['a settings entry after the virtual time', d => { d.settings.push({...d.settings[0], id: 'set-2', at: at('03-09', '09:00')}); }],
  ['no settings in force at a booking', d => { d.settings[0].at = at('01-19', '00:00'); }],
  ['a skill of an unknown service', d => { d.skills[0].service_id = 'chem'; }],
  ['a tutor who is not in the binding', d => { d.tutors[0].person_id = 'person-zoe'; }],
  ['a tutor covering another service\'s skill', d => { d.tutors[0].skill_ids.push('wr-thesis'); }],
  ['a slot of an unknown tutor', d => { d.slots[1].tutor_id = 't-zoe'; }],
  ['a slot in a mode its tutor does not offer', d => { d.slots.find(s => s.id === 's3').mode = 'in_person'; }],
  ['overlapping slots of one tutor', d => { d.slots.find(s => s.id === 's2').start = '2027-03-09T16:30:00-05:00'; }],
  ['a slot withdrawn after it started', d => { d.slots.find(s => s.id === 's0').withdrawn_at = at('02-26', '09:00'); }],
  ['an appointment on an unknown slot', d => { apt(d, 'apt-p1').slot_id = 's9'; }],
  ['an intake with an unknown skill', d => { apt(d, 'apt-p1').intake.skill_ids = ['calc-1']; }],
  ['a writing-centre intake without a draft', d => { apt(d, 'apt-h2').intake.draft_ref = null; }],
  ['take-home exam work', d => { apt(d, 'apt-p1').intake.work_type = 'take_home_exam'; }],
  ['a booking after the virtual time', d => { apt(d, 'apt-p1').booked_at = at('03-08', '10:00'); }],
  ['a booking after the session started', d => { apt(d, 'apt-p1').booked_at = at('02-25', '16:30'); }],
  ['two booked appointments on one slot', d => { d.appointments.push({...structuredClone(apt(d, 'apt-p1')), id: 'apt-p2'}); }],
  ['an outcome before the session started', d => { apt(d, 'apt-p1').outcome.recorded_at = at('02-25', '15:59'); }],
  ['an outcome after the virtual time', d => { apt(d, 'apt-p1').outcome.recorded_at = at('03-08', '09:01'); }],
  ['an outcome on a cancelled appointment', d => { apt(d, 'apt-h2').outcome = {outcome: 'completed', recorded_at: at('02-03', '15:00')}; }],
  ['a cancellation after the session started', d => { apt(d, 'apt-h2').cancelled_at = at('02-03', '14:00'); }],
  ['a cancellation marked in time although it was after the cutoff', d => { apt(d, 'apt-h2').cancelled_at = at('02-03', '09:00'); }],
  ['a late cancellation that was in time', d => { apt(d, 'apt-h2').status = 'late_cancel'; }],
  ['a centre cancellation without a withdrawn slot', d => { apt(d, 'apt-h2').status = 'cancelled_by_centre'; }],
  ['a report for an appointment that was not completed', d => { d.reports[0].appointment_id = 'apt-p1'; }],
  ['a report posted before attendance was recorded', d => { d.reports[0].posted_at = at('01-20', '16:59'); }],
  ['a report with an unknown skill', d => { d.reports[0].next_focus = 'calc-1'; }],
  ['two reports for one appointment', d => { d.reports.push({...d.reports[0], id: 'rep-h2'}); }],
  ['a follow-up of an unknown report', d => { d.followups[0].report_id = 'rep-9'; }],
  ['a done follow-up without its time', d => { Object.assign(d.followups[0], {done_at: null}); }],
  ['a follow-up done after the virtual time', d => { d.followups[0].done_at = at('03-08', '10:00'); }],
  ['an activity-log entry after the virtual time', d => { d.evaluator.activity_log.push({seq: 1, at: at('03-08', '10:00'), operation: 'tutorwell.appointments.cancel',
    request_id: 'r1', expected_version: {epoch: 1, revision: 0}, object_id: 'apt-h2', appointment_id: 'apt-h2', consents: [], details: {}}); }]
];

test('the history seed is valid, and scheduled times after the virtual time are allowed', () => {
  const d = history();
  d.followups[1].due_at = at('04-01', '12:00');
  load(d);
});

for (const [name, change] of CASES) {
  test('validateSeed refuses ' + name, () => {
    const d = history();
    change(d);
    assert.throws(() => load(d), e => e.code === 'invalid_seed' || assert.fail('Expected invalid_seed, got ' + (e.code || e.message)));
  });
}

test('a centre cancellation dated at its slot\'s withdrawal loads; a suspension follows from seeded history', () => {
  const d = history();
  d.slots.find(s => s.id === 'sh2').withdrawn_at = at('02-01', '10:00');
  apt(d, 'apt-h2').status = 'cancelled_by_centre';
  load(d);
  // A late cancellation on Fri 03-05 at 10:00 for that afternoon, with the February no-show: suspended from then.
  const e = history();
  e.slots.push({id: 'sh3', tutor_id: 't-ana', start: at('03-05', '16:00'), minutes: 50, mode: 'online', withdrawn_at: null});
  e.appointments.push({id: 'apt-h3', slot_id: 'sh3', booked_at: at('03-01', '12:00'), intake: structuredClone(apt(e, 'apt-p1').intake), status: 'late_cancel',
    cancelled_at: at('03-05', '10:00'), outcome: null});
  const f = fixture({seed: e, binding: binding(e)});
  assert.deepEqual(f.call('tutorwell.profile.get').suspension, {from: '2027-03-05T10:00:00-05:00', until: '2027-03-19T11:00:00-04:00', cause: 'late_cancel', cause_appointment_id: 'apt-h3'});
});
