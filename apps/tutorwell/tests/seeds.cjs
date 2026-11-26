'use strict';
// Test seeds built from fixtures/minimal.json (the proposal's example: virtual now Mon 2027-03-08 09:00, -05:00).
// history() adds a term of past appointments: a completed math session with its report and two follow-ups (one
// done by the student), and a writing-centre appointment cancelled in time.
const MINIMAL = require('../fixtures/minimal.json');
const at = (date, time) => `2027-${date}T${time}:00-05:00`;   // dates before the 2027-03-14 clock change
const NOW = at('03-08', '09:00');

function history() {
  const d = structuredClone(MINIMAL);
  d.slots.push(
    {id: 'sh1', tutor_id: 't-ana', start: at('01-20', '16:00'), minutes: 50, mode: 'in_person', withdrawn_at: null},
    {id: 'sh2', tutor_id: 't-ben', start: at('02-03', '14:00'), minutes: 50, mode: 'online', withdrawn_at: null});
  d.appointments.push(
    {id: 'apt-h1', slot_id: 'sh1', booked_at: at('01-18', '20:00'), intake: {skill_ids: ['alg-expand'], questions: ['Why does (a+b)^2 have a middle term?'],
      item_refs: ['hw-2'], work_type: 'homework', draft_ref: null, share_accommodations: false}, status: 'booked', cancelled_at: null,
      outcome: {outcome: 'completed', recorded_at: at('01-20', '17:00')}},
    {id: 'apt-h2', slot_id: 'sh2', booked_at: at('01-30', '10:00'), intake: {skill_ids: ['wr-thesis'], questions: [], item_refs: ['hist-essay-1'],
      work_type: 'draft', draft_ref: 'hist-essay-1-v1', share_accommodations: false}, status: 'cancelled', cancelled_at: at('02-01', '10:00'), outcome: null});
  d.reports.push({id: 'rep-h1', appointment_id: 'apt-h1', posted_at: at('01-20', '18:00'), covered_skill_ids: ['alg-expand'], next_focus: 'alg-factoring'});
  d.followups.push(
    {id: 'fu-h1', report_id: 'rep-h1', kind: 'practice', item_refs: ['hw-2'], minutes: 20, due_at: at('01-22', '17:00'), status: 'done', done_at: at('01-22', '09:00'), done_by: 'student'},
    {id: 'fu-h2', report_id: 'rep-h1', kind: 'read', item_refs: ['text-7-1'], minutes: 15, due_at: null, status: 'open', done_at: null, done_by: null});
  return d;
}

function binding(seed) {
  const b = structuredClone(require('../fixtures/binding.json'));
  b.objects.tutorwell = require('../src/model.cjs').objects(seed);
  return b;
}
// A booking intake for the math tutor (or the writing centre with a draft reference).
const MATH = {skill_ids: ['alg-factoring'], questions: ['How do I start when the leading coefficient is not 1?'], item_refs: ['q-4', 'q-7'],
  work_type: 'homework', draft_ref: null, share_accommodations: false};
const WRITING = {skill_ids: ['wr-thesis'], questions: ['Is my claim arguable?'], item_refs: ['hist-essay-2'], work_type: 'draft',
  draft_ref: 'hist-essay-2-v1', share_accommodations: false};

module.exports = {MINIMAL, NOW, history, binding, at, MATH, WRITING};
