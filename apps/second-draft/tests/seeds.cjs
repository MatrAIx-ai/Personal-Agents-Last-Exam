'use strict';
// Test seeds built from fixtures/minimal.json. history() adds a graded past essay with a resolved comment, an
// instructor message and a second course's assignment that has no draft yet.
const MINIMAL = require('../fixtures/minimal.json');
const at = (date, time) => `2027-${date}T${time}:00-05:00`;
const S = text => ({text, author: 'student', ref: null});

function history() {
  const d = structuredClone(MINIMAL);
  d.assignments.push(
    {id: 'hist-essay-1', course_id: 'hist-210', title: 'Essay 1: Reading a woodcut', prompt: 'Explain what one woodcut from the reader argues and for whom.',
      due_at: at('02-12', '23:59'), criteria: structuredClone(MINIMAL.assignments[0].criteria)},
    {id: 'comp-reflection-1', course_id: 'comp-101', title: 'Reflection 1', prompt: 'Reflect on one revision you made this term.',
      due_at: '2027-03-15T23:59:00-04:00', criteria: [{id: 'reflection', title: 'Depth of reflection', max_level: 4}]});
  d.versions.push({id: 'h1-v1', assignment_id: 'hist-essay-1', number: 1, saved_at: at('02-11', '21:00'), saved_by: 'student', suggestion_id: null,
    paragraphs: [{id: 'p1', sentences: [S('The woodcut shows the pope as a monster.'), S('It was made for readers who already distrusted Rome.')]}]});
  d.comments.push({id: 'h1-c1', assignment_id: 'hist-essay-1', version_id: 'h1-v1', paragraph_id: 'p1', quote: 'The woodcut shows the pope as a monster.',
    from: 'instructor', criterion_id: 'thesis', text: 'A description, not yet a thesis: what does the image argue?', posted_at: at('02-15', '10:00'),
    status: 'resolved', updated_at: at('02-18', '09:00'), replies: [{id: 'h1-r1', author: 'student', text: 'Thanks, I see it now.', at: at('02-16', '18:00')}]});
  d.submissions.push({id: 'h1-sub', assignment_id: 'hist-essay-1', version_id: 'h1-v1', at: at('02-12', '22:00'), by: 'student'});
  d.grades.push({id: 'h1-grade', assignment_id: 'hist-essay-1', at: at('02-19', '12:00'),
    levels: [{criterion_id: 'thesis', level: 2}, {criterion_id: 'evidence', level: 3}, {criterion_id: 'mechanics', level: 3}]});
  d.messages.push({id: 'msg-h1', course_id: 'hist-210', author: 'instructor', in_reply_to: null, text: 'Office hours move to Thursday this week.', at: at('02-20', '08:00')});
  return d;
}

function binding(seed) {
  const b = structuredClone(require('../fixtures/binding.json'));
  b.objects['second-draft'] = require('../src/model.cjs').objects(seed);
  return b;
}

module.exports = {MINIMAL, history, binding, at};
