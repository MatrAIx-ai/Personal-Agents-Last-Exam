'use strict';
// Record consistency, object IDs, policy history and versions for one student's data.
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {ms} = require('./time.cjs');
const k = require('./edit-kind.cjs');

const COURSE_ACTIONS = ['plan', 'reply', 'ask_instructor', 'suggest_language', 'suggest_content', 'edit'];
const STUDENT_ACTIONS = [...COURSE_ACTIONS, 'submit'];
const COLLECTIONS = ['courses', 'policies', 'assignments', 'versions', 'comments', 'suggestions', 'checklists', 'messages', 'submissions', 'grades'];
const invalid = message => fail('invalid_seed', message);

function records(data) {
  return COLLECTIONS.flatMap(name => data[name]);
}
// Core's object list: one ID per record (Core counts records and objects alike when it checks a bundle).
function objects(data) {
  return records(data).map(r => r.id);
}
// Every ID in use, including comment replies, which live inside their comment.
function allIds(data) {
  return [...objects(data), ...data.comments.flatMap(c => c.replies.map(r => r.id))];
}
// Versions are numbered v1, v2, ... like the proposal's examples; other objects use prefix-N.
function nextId(data, prefix, separator = '-') {
  const ids = new Set(allIds(data));
  let n = 1;
  while (ids.has(prefix + separator + n)) n++;
  return prefix + separator + n;
}
function byId(list, id, code = 'not_found', what = 'Object', lister = null) {
  const item = list.find(x => x.id === id);
  if (!item) fail(code, what + ' ' + JSON.stringify(id) + ' does not exist for this student.' + (lister ? ` ${lister} lists the valid IDs.` : ''));
  return item;
}

// The course policy in force at `at`: its latest entry at or before that time (a later entry wins a tie).
function policyAt(data, courseId, at) {
  let current = null;
  for (const p of data.policies) if (p.course_id === courseId && ms(p.at) <= ms(at) && (!current || ms(p.at) >= ms(current.at))) current = p;
  return current;
}
const versionsOf = (data, assignmentId) => data.versions.filter(v => v.assignment_id === assignmentId).sort((a, b) => a.number - b.number);
const latestVersion = (data, assignmentId) => versionsOf(data, assignmentId).at(-1) || null;
const paragraphIn = (version, paragraphId) => version.paragraphs.find(p => p.id === paragraphId) || null;

// pending or stale for an undecided suggestion, judged against the latest version of its draft.
function suggestionStatus(data, s) {
  if (s.decision) return s.decision.decision;
  const latest = latestVersion(data, s.assignment_id), p = latest && paragraphIn(latest, s.paragraph_id);
  return p && k.occurrences(k.paragraphText(p), s.quote) === 1 ? 'pending' : 'stale';
}
// A comment is touched once a later version of its draft changes its paragraph's text or removes the paragraph.
function touched(data, comment) {
  const versions = versionsOf(data, comment.assignment_id), anchor = versions.find(v => v.id === comment.version_id);
  const text = k.paragraphText(paragraphIn(anchor, comment.paragraph_id));
  return versions.filter(v => v.number > anchor.number).some(v => {
    const p = paragraphIn(v, comment.paragraph_id);
    return !p || k.paragraphText(p) !== text;
  });
}

function validateSeed(ctx, data) {
  references(ctx, data);
  const now = ms(ctx.virtual_now), past = at => ms(at) <= now;
  const ids = new Set();
  for (const id of allIds(data)) {
    if (ids.has(id)) invalid('Every object ID must be unique.');
    ids.add(id);
  }
  const courses = new Set(data.courses.map(c => c.id));
  for (const p of data.policies) {
    if (!courses.has(p.course_id)) invalid('A policy refers to an unknown course.');
    if (!past(p.at)) invalid('A policy entry cannot be dated after the run\'s virtual time.');
  }
  for (const c of data.courses) if (!policyAt(data, c.id, ctx.virtual_now)) invalid('Every course needs a policy in force at the run\'s virtual time.');
  const assignments = new Map();
  for (const a of data.assignments) {
    if (!courses.has(a.course_id)) invalid('An assignment refers to an unknown course.');
    const criteria = new Set();
    for (const c of a.criteria) { if (criteria.has(c.id)) invalid('Rubric criterion IDs must be unique within an assignment.'); criteria.add(c.id); }
    assignments.set(a.id, {a, criteria: new Map(a.criteria.map(c => [c.id, c]))});
  }
  const versions = new Map(data.versions.map(v => [v.id, v]));
  const suggestions = new Map(data.suggestions.map(s => [s.id, s]));
  for (const [id] of assignments) {
    const list = versionsOf(data, id);
    list.forEach((v, i) => {
      if (v.number !== i + 1) invalid('An assignment\'s versions are numbered 1, 2, 3 ... without gaps.');
      if (!past(v.saved_at) || (i > 0 && ms(v.saved_at) < ms(list[i - 1].saved_at))) invalid('Versions are saved in order and not after the run\'s virtual time.');
    });
  }
  for (const v of data.versions) {
    if (!assignments.has(v.assignment_id)) invalid('A version refers to an unknown assignment.');
    const paragraphs = new Set();
    for (const p of v.paragraphs) {
      if (paragraphs.has(p.id)) invalid('Paragraph IDs must be unique within a version.');
      paragraphs.add(p.id);
      if (k.sentences(k.paragraphText(p)).length !== p.sentences.length || p.sentences.some(s => k.sentences(s.text).length !== 1)) {
        invalid('Each stored sentence must be exactly one sentence under ' + k.RULE + '.');
      }
      for (const s of p.sentences) {
        if ((s.author === 'student') !== (s.ref === null)) invalid('Only agent and suggestion sentences carry a reference.');
        const source = s.author === 'agent' ? versions.get(s.ref) : s.author === 'suggestion' ? suggestions.get(s.ref) : null;
        if (s.author !== 'student' && (!source || source.assignment_id !== v.assignment_id)) invalid('A sentence refers to an unknown edit or suggestion.');
        if (s.author === 'agent' && (source.saved_by !== 'agent' || source.number > v.number)) invalid('An agent sentence refers to an earlier or the same direct edit.');
      }
    }
    if ((v.saved_by === 'suggestion') !== (v.suggestion_id !== null)) invalid('A version names a suggestion exactly when an accepted suggestion saved it.');
  }
  const assignmentOf = id => assignments.get(id) || invalid('A record refers to an unknown assignment.');
  const anchor = (r, what) => {
    const v = versions.get(r.version_id);
    if (!v || v.assignment_id !== r.assignment_id) invalid(what + ' refers to an unknown version of its assignment.');
    const p = paragraphIn(v, r.paragraph_id);
    if (!p) invalid(what + ' refers to an unknown paragraph.');
    if (k.occurrences(k.paragraphText(p), r.quote) !== 1) invalid(what + ' quotes text that does not occur exactly once in its paragraph.');
    return v;
  };
  for (const c of data.comments) {
    const {criteria} = assignmentOf(c.assignment_id), v = anchor(c, 'A comment');
    if (c.criterion_id !== null && !criteria.has(c.criterion_id)) invalid('A comment cites a criterion of another assignment.');
    if (ms(c.posted_at) < ms(v.saved_at) || !past(c.posted_at) || ms(c.updated_at) < ms(c.posted_at) || !past(c.updated_at)) invalid('Comment times are out of order or after the run\'s virtual time.');
    for (const r of c.replies) if (ms(r.at) < ms(c.posted_at) || !past(r.at)) invalid('A reply is dated before its comment or after the run\'s virtual time.');
  }
  for (const s of data.suggestions) {
    assignmentOf(s.assignment_id);
    const v = anchor(s, 'A suggestion');
    if (ms(s.created_at) < ms(v.saved_at) || !past(s.created_at)) invalid('A suggestion is dated before its version or after the run\'s virtual time.');
    if (s.decision) {
      if (ms(s.decision.at) < ms(s.created_at) || !past(s.decision.at)) invalid('A suggestion is decided before it was made or after the run\'s virtual time.');
      const result = s.decision.version_id === null ? null : versions.get(s.decision.version_id);
      if ((s.decision.decision === 'accepted') !== (result !== null) || (result && (result.suggestion_id !== s.id || result.assignment_id !== s.assignment_id))) {
        invalid('An accepted suggestion names the version it saved; a rejected one names none.');
      }
    }
  }
  for (const v of data.versions) if (v.suggestion_id !== null) {
    const s = suggestions.get(v.suggestion_id);
    if (!s || s.decision?.version_id !== v.id) invalid('A version saved by a suggestion must be that suggestion\'s accepted result.');
  }
  const comments = new Map(data.comments.map(c => [c.id, c]));
  const checklistFor = new Set();
  for (const l of data.checklists) {
    const {criteria} = assignmentOf(l.assignment_id);
    if (checklistFor.has(l.assignment_id)) invalid('An assignment has at most one checklist.');
    checklistFor.add(l.assignment_id);
    if (!past(l.updated_at)) invalid('A checklist cannot be saved after the run\'s virtual time.');
    for (const item of l.items) {
      if (item.comment_ids.some(id => comments.get(id)?.assignment_id !== l.assignment_id)) invalid('A checklist item cites a comment of another assignment.');
      if (item.criterion_ids.some(id => !criteria.has(id))) invalid('A checklist item cites a criterion of another assignment.');
    }
  }
  const messages = new Map(data.messages.map(m => [m.id, m]));
  for (const m of data.messages) {
    if (!courses.has(m.course_id)) invalid('A message refers to an unknown course.');
    if (!past(m.at)) invalid('A message cannot be dated after the run\'s virtual time.');
    if (m.in_reply_to !== null && (messages.get(m.in_reply_to)?.course_id !== m.course_id || ms(messages.get(m.in_reply_to).at) > ms(m.at))) invalid('A message replies to an earlier message of the same course thread.');
  }
  for (const s of data.submissions) {
    assignmentOf(s.assignment_id);
    const v = versions.get(s.version_id);
    if (!v || v.assignment_id !== s.assignment_id) invalid('A submission names a version of its own assignment.');
    if (ms(s.at) < ms(v.saved_at) || !past(s.at)) invalid('A submission is dated before its version or after the run\'s virtual time.');
  }
  const graded = new Set();
  for (const g of data.grades) {
    const {criteria} = assignmentOf(g.assignment_id);
    if (graded.has(g.assignment_id)) invalid('An assignment is graded at most once.');
    graded.add(g.assignment_id);
    const first = data.submissions.filter(s => s.assignment_id === g.assignment_id).map(s => ms(s.at)).sort((a, b) => a - b)[0];
    if (first === undefined || ms(g.at) < first || !past(g.at)) invalid('A grade needs an earlier submission and cannot be after the run\'s virtual time.');
    const seen = new Set();
    for (const x of g.levels) {
      const c = criteria.get(x.criterion_id);
      if (!c || seen.has(x.criterion_id) || x.level > c.max_level) invalid('A grade gives each of its assignment\'s criteria at most one level within its range.');
      seen.add(x.criterion_id);
    }
  }
  for (const e of data.evaluator.activity_log) if (!past(e.at)) invalid('An activity-log entry cannot be after the run\'s virtual time.');
}

function logEntry(ctx, data, operation, args, entry) {
  const at = ctx.virtual_now, policy = policyAt(data, entry.course_id, at);
  data.evaluator.activity_log.push({seq: data.evaluator.activity_log.length + 1, at, operation, request_id: args.request_id,
    expected_version: copy(args.expected_version), object_id: entry.object_id, assignment_id: entry.assignment_id ?? null,
    course_id: entry.course_id, action: entry.action, kind: entry.kind ?? null, course_policy: copy(policy.allowed),
    student_rules: copy(data.assistant_rules.allowed), details: copy(entry.details || {})});
  log(ctx, operation, {object_id: entry.object_id});
}

module.exports = {COURSE_ACTIONS, STUDENT_ACTIONS, COLLECTIONS, records, objects, allIds, nextId, byId, policyAt, versionsOf, latestVersion,
  paragraphIn, suggestionStatus, touched, validateSeed, logEntry, references: () => []};
