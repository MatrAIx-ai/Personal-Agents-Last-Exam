'use strict';
// Scenario events applied by Infra with env.apply_event. Core sets ctx.virtual_now to event.at and rolls back
// both data and clock when a handler refuses an event. A missing reference is unknown_reference, a duplicate ID
// duplicate_id, a bad value invalid_value, and a suggestion or assignment in the wrong state invalid_state.
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const m = require('./model.cjs');
const k = require('./edit-kind.cjs');

const ref = (list, id, what) => m.byId(list, id, 'unknown_reference', what);
const bad = message => fail('invalid_value', message);
const isNew = (data, id) => { if (m.allIds(data).includes(id)) fail('duplicate_id', 'An object with ID ' + JSON.stringify(id) + ' already exists.'); };
const student = text => k.sentences(text).map(s => ({text: s, author: 'student', ref: null}));

const HANDLERS = {
  'second-draft.version.saved'(data, at, p) {
    const a = ref(data.assignments, p.assignment_id, 'Assignment');
    const ids = p.paragraphs.map(x => x.paragraph_id);
    if (new Set(ids).size !== ids.length) bad('Paragraph IDs must be unique within a version.');
    const latest = m.latestVersion(data, a.id);
    // Kept paragraph IDs keep their anchors and the authors of unchanged sentences; new IDs are added, omitted
    // ones removed. The payload order is the new paragraph order.
    const paragraphs = p.paragraphs.map(x => {
      const old = latest && m.paragraphIn(latest, x.paragraph_id);
      return {id: x.paragraph_id, sentences: old ? k.reauthor(old.sentences, k.sentences(x.text).join(' '), 'student', null) : student(x.text)};
    });
    const version = {id: m.nextId(data, 'v', ''), assignment_id: a.id, number: (latest?.number || 0) + 1, saved_at: at, saved_by: 'student',
      suggestion_id: null, paragraphs};
    data.versions.push(version);
    return version.id;
  },
  'second-draft.suggestion.decided'(data, at, p) {
    const s = ref(data.suggestions, p.suggestion_id, 'Suggestion');
    const status = m.suggestionStatus(data, s);
    if (status !== 'pending') fail('invalid_state', 'Only a pending suggestion can be decided; this one is ' + status + '.');
    if (p.decision === 'rejected') { s.decision = {decision: 'rejected', at, version_id: null}; return s.id; }
    const latest = m.latestVersion(data, s.assignment_id), para = m.paragraphIn(latest, s.paragraph_id), text = k.paragraphText(para);
    const index = text.indexOf(s.quote), after = text.slice(0, index) + s.replacement + text.slice(index + s.quote.length);
    if (!k.sentences(after).length) bad('Accepting this suggestion would empty the paragraph.');
    const id = m.nextId(data, 'v', '');
    data.versions.push({id, assignment_id: s.assignment_id, number: latest.number + 1, saved_at: at, saved_by: 'suggestion', suggestion_id: s.id,
      paragraphs: latest.paragraphs.map(x => x.id === para.id ? {id: x.id, sentences: k.reauthor(x.sentences, k.sentences(after).join(' '), 'suggestion', s.id)} : copy(x))});
    s.decision = {decision: 'accepted', at, version_id: id};
    return s.id;
  },
  'second-draft.comment.posted'(data, at, p) {
    isNew(data, p.comment_id);
    const a = ref(data.assignments, p.assignment_id, 'Assignment'), version = ref(data.versions, p.version_id, 'Version');
    if (version.assignment_id !== a.id) fail('unknown_reference', 'The version belongs to another assignment.');
    const para = m.paragraphIn(version, p.paragraph_id);
    if (!para) fail('unknown_reference', 'Paragraph ' + JSON.stringify(p.paragraph_id) + ' is not in version ' + version.id + '.');
    if (k.occurrences(k.paragraphText(para), p.quote) !== 1) bad('The quote must occur exactly once in its paragraph.');
    if (p.criterion_id !== undefined && !a.criteria.some(c => c.id === p.criterion_id)) fail('unknown_reference', 'The criterion is not in this assignment\'s rubric.');
    data.comments.push({id: p.comment_id, assignment_id: a.id, version_id: version.id, paragraph_id: para.id, quote: p.quote, from: p.from,
      criterion_id: p.criterion_id ?? null, text: p.text, posted_at: at, status: 'open', updated_at: at, replies: []});
    return p.comment_id;
  },
  'second-draft.comment.resolved'(data, at, p) {
    const c = ref(data.comments, p.comment_id, 'Comment');
    if (c.status === p.status) bad('The comment is already ' + c.status + '.');
    Object.assign(c, {status: p.status, updated_at: at});
    return c.id;
  },
  'second-draft.policy.changed'(data, at, p) {
    ref(data.courses, p.course_id, 'Course');
    const entry = {id: m.nextId(data, 'pol'), course_id: p.course_id, at, allowed: copy(p.allowed)};
    data.policies.push(entry);
    return entry.id;
  },
  'second-draft.assignment.graded'(data, at, p) {
    const a = ref(data.assignments, p.assignment_id, 'Assignment');
    if (!data.submissions.some(s => s.assignment_id === a.id)) fail('invalid_state', 'Only a submitted assignment can be graded.');
    if (data.grades.some(g => g.assignment_id === a.id)) fail('invalid_state', 'This assignment has already been graded.');
    const seen = new Set();
    for (const x of p.levels) {
      const c = a.criteria.find(c => c.id === x.criterion_id);
      if (!c) fail('unknown_reference', 'Criterion ' + JSON.stringify(x.criterion_id) + ' is not in this assignment\'s rubric.');
      if (seen.has(c.id) || x.level > c.max_level) bad('Each criterion gets at most one level within its range.');
      seen.add(c.id);
    }
    const grade = {id: m.nextId(data, 'grade'), assignment_id: a.id, at, levels: copy(p.levels)};
    data.grades.push(grade);
    return grade.id;
  },
  'second-draft.message.received'(data, at, p) {
    isNew(data, p.message_id);
    ref(data.courses, p.course_id, 'Course');
    if (p.in_reply_to !== undefined && ref(data.messages, p.in_reply_to, 'Message').course_id !== p.course_id) {
      fail('unknown_reference', 'The message replies to another course thread.');
    }
    data.messages.push({id: p.message_id, course_id: p.course_id, author: 'instructor', in_reply_to: p.in_reply_to ?? null, text: p.text, at});
    return p.message_id;
  }
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported Second Draft event.');
  const target = handler(data, event.at, event.payload);
  log(ctx, event.operation, {event_id: event.event_id, object_id: target});
  return data;
}

module.exports = {applyEvent, EVENTS: Object.keys(HANDLERS)};
