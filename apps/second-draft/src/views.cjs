'use strict';
// Agent-visible read results. Every field is listed explicitly: the evaluator-only activity log, and the
// grader-only judgments of the integrity checker (touched comments, policy conflicts), never appear here.
const {ms, local} = require('./time.cjs');
const {copy, fail} = require('./domain-utils.cjs');
const m = require('./model.cjs');
const k = require('./edit-kind.cjs');

const byTime = key => (a, b) => ms(a[key]) - ms(b[key]) || (a.id < b.id ? -1 : 1);
// Unknown IDs: the error lists the valid ones (the sets are small), so a caller can retry without another read.
const named = list => list.map(x => `${x.id} (${x.title})`).join(', ');
function course(data, id) {
  const c = data.courses.find(x => x.id === id);
  if (!c) fail('not_found', `Course ${JSON.stringify(id)} does not exist for this student. Courses: ${named(data.courses)}. second-draft.policies.get lists them.`);
  return c;
}
function assignment(data, id) {
  const a = data.assignments.find(x => x.id === id);
  if (!a) fail('not_found', `Assignment ${JSON.stringify(id)} does not exist for this student. Assignments: ${named(data.assignments)}. second-draft.assignments.list lists them with their details.`);
  return a;
}
const summary = v => ({id: v.id, number: v.number, saved_at: v.saved_at, saved_by: v.saved_by, suggestion_id: v.suggestion_id});

function assignments(data, now, courseId) {
  if (courseId !== undefined) course(data, courseId);
  const zone = data.student.time_zone;
  return {as_of: now, assignments: data.assignments.filter(a => courseId === undefined || a.course_id === courseId).map(a => {
    const subs = data.submissions.filter(s => s.assignment_id === a.id).sort(byTime('at'));
    const grade = data.grades.find(g => g.assignment_id === a.id) || null;
    return {id: a.id, course_id: a.course_id, title: a.title, prompt: a.prompt, due_at: a.due_at, due_day: local(a.due_at, zone).weekday,
      criteria: copy(a.criteria), latest_version_id: m.latestVersion(data, a.id)?.id ?? null,
      status: grade ? 'graded' : subs.length ? 'submitted' : 'open', submissions: subs.map(s => ({id: s.id, version_id: s.version_id, at: s.at})),
      grade: grade && {at: grade.at, levels: copy(grade.levels)}};
  })};
}
function policies(data, now, courseId) {
  const list = courseId === undefined ? data.courses : [course(data, courseId)];
  return {as_of: now, courses: list.map(c => ({course_id: c.id, title: c.title, instructor_name: c.instructor_name,
    allowed: copy(m.policyAt(data, c.id, now).allowed),
    history: data.policies.filter(p => p.course_id === c.id && ms(p.at) <= ms(now)).sort(byTime('at')).map(p => ({at: p.at, allowed: copy(p.allowed)}))}))};
}
function draftsList(data, now, assignmentId) {
  assignment(data, assignmentId);
  return {as_of: now, assignment_id: assignmentId, versions: m.versionsOf(data, assignmentId).map(v => ({...summary(v), paragraph_ids: v.paragraphs.map(p => p.id)}))};
}
function suggestion(data, s) {
  return {id: s.id, version_id: s.version_id, paragraph_id: s.paragraph_id, quote: s.quote, replacement: s.replacement, kind: s.kind,
    status: m.suggestionStatus(data, s), created_at: s.created_at, decided_at: s.decision?.at ?? null, result_version_id: s.decision?.version_id ?? null};
}
function version(data, assignmentId, versionId) {
  if (versionId === undefined) return m.latestVersion(data, assignmentId);
  const v = data.versions.find(x => x.id === versionId);
  if (!v || v.assignment_id !== assignmentId) {
    fail('not_found', `Version ${JSON.stringify(versionId)} is not a version of ${assignmentId}. Its versions: ${m.versionsOf(data, assignmentId).map(x => x.id).join(', ') || 'none yet'}. second-draft.drafts.list lists them.`);
  }
  return v;
}
function draftsGet(data, now, assignmentId, versionId) {
  assignment(data, assignmentId);
  const v = version(data, assignmentId, versionId);
  return {as_of: now, assignment_id: assignmentId, draft: v && {...summary(v),
    paragraphs: v.paragraphs.map(p => ({id: p.id, text: k.paragraphText(p), sentences: copy(p.sentences)})), authorship: k.shares(v.paragraphs)},
  suggestions: data.suggestions.filter(s => s.assignment_id === assignmentId).sort(byTime('created_at')).map(s => suggestion(data, s))};
}
function draftsDiff(data, now, assignmentId, fromId, toId) {
  assignment(data, assignmentId);
  const from = version(data, assignmentId, fromId), to = version(data, assignmentId, toId);
  const text = (v, id) => { const p = m.paragraphIn(v, id); return p ? k.paragraphText(p) : null; };
  const rows = to.paragraphs.map(p => {
    const before = text(from, p.id), after = k.paragraphText(p);
    return {paragraph_id: p.id, change: before === null ? 'added' : before === after ? 'unchanged' : 'changed', from_text: before, to_text: after};
  });
  for (const p of from.paragraphs) if (!m.paragraphIn(to, p.id)) rows.push({paragraph_id: p.id, change: 'removed', from_text: k.paragraphText(p), to_text: null});
  return {as_of: now, assignment_id: assignmentId, from_version_id: from.id, to_version_id: to.id, paragraphs: rows};
}
function comments(data, now, assignmentId, status) {
  assignment(data, assignmentId);
  return {as_of: now, assignment_id: assignmentId, comments: data.comments.filter(c => c.assignment_id === assignmentId && (status === undefined || c.status === status))
    .sort(byTime('posted_at')).map(c => ({id: c.id, version_id: c.version_id, paragraph_id: c.paragraph_id, quote: c.quote, from: c.from,
      criterion_id: c.criterion_id, text: c.text, posted_at: c.posted_at, status: c.status, replies: copy(c.replies)}))};
}
function checklist(data, now, assignmentId) {
  assignment(data, assignmentId);
  const l = data.checklists.find(x => x.assignment_id === assignmentId);
  return {as_of: now, assignment_id: assignmentId, checklist: l ? {id: l.id, items: copy(l.items), updated_at: l.updated_at} : null};
}
function messages(data, now, courseId) {
  if (courseId !== undefined) course(data, courseId);
  return {as_of: now, messages: data.messages.filter(x => courseId === undefined || x.course_id === courseId).sort(byTime('at'))
    .map(x => ({id: x.id, course_id: x.course_id, author: x.author, in_reply_to: x.in_reply_to, text: x.text, at: x.at}))};
}
function preferences(data, now) {
  return {as_of: now, time_zone: data.student.time_zone, assistant_rules: copy(data.assistant_rules)};
}

module.exports = {assignments, policies, draftsList, draftsGet, draftsDiff, comments, checklist, messages, preferences, assignment, course, version};
