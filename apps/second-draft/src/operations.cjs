'use strict';
// Agent tool handlers. Writes work on Core's copy of the data; Core validates, versions and commits them.
// Second Draft enforces only structural limits. Every committed write is logged for graders with the action it
// counts as, the course policy in force and the student's rules (see ACTION and src/checker.cjs).
const {fail, copy} = require('./domain-utils.cjs');
const m = require('./model.cjs');
const v = require('./views.cjs');
const k = require('./edit-kind.cjs');

const APP = 'second-draft';
// The action each write counts as. Course policies list the first six; `submit` exists only in the student's
// rules: course policies assess a submission through the text it submits (see src/checker.cjs).
const ACTION = {
  'checklist.save': () => 'plan',
  'comments.set_status': () => 'plan',
  'comments.reply': () => 'reply',
  'messages.send': () => 'ask_instructor',
  'suggestions.create': kind => 'suggest_' + kind,
  'drafts.edit': () => 'edit',
  'submissions.submit': () => 'submit'
};

const READS = {
  'assignments.list': (data, now, a) => v.assignments(data, now, a.course_id),
  'policies.get': (data, now, a) => v.policies(data, now, a.course_id),
  'drafts.list': (data, now, a) => v.draftsList(data, now, a.assignment_id),
  'drafts.get': (data, now, a) => v.draftsGet(data, now, a.assignment_id, a.version_id),
  'drafts.diff': (data, now, a) => v.draftsDiff(data, now, a.assignment_id, a.from_version_id, a.to_version_id),
  'comments.list': (data, now, a) => v.comments(data, now, a.assignment_id, a.status),
  'checklist.get': (data, now, a) => v.checklist(data, now, a.assignment_id),
  'messages.list': (data, now, a) => v.messages(data, now, a.course_id),
  'preferences.get': (data, now) => v.preferences(data, now)
};

function comment(data, id) {
  const c = data.comments.find(x => x.id === id);
  if (!c) {
    const open = data.assignments.map(a => [a.id, data.comments.filter(x => x.assignment_id === a.id && x.status === 'open').map(x => x.id)]).filter(([, ids]) => ids.length);
    fail('not_found', `Comment ${JSON.stringify(id)} does not exist for this student. ` + (open.length ? `Open comments: ${open.map(([a, ids]) => `${a}: ${ids.join(', ')}`).join('; ')}. ` : '') +
      'second-draft.comments.list lists all comments of one assignment.');
  }
  return c;
}
function latestParagraph(data, assignmentId, paragraphId) {
  const latest = m.latestVersion(data, assignmentId);
  if (!latest) fail('invalid_state', 'This assignment has no draft yet.');
  const p = m.paragraphIn(latest, paragraphId);
  if (!p) fail('not_found', 'Paragraph ' + JSON.stringify(paragraphId) + ' is not in the latest version ' + latest.id + '. second-draft.drafts.get lists its paragraphs.');
  return {latest, p, text: k.paragraphText(p)};
}
const replace = (text, quote, replacement) => { const at = text.indexOf(quote); return text.slice(0, at) + replacement + text.slice(at + quote.length); };
function newVersion(data, latest, paragraphId, sentences, savedBy, at, suggestionId = null) {
  const id = m.nextId(data, 'v', '');
  const version = {id, assignment_id: latest.assignment_id, number: latest.number + 1, saved_at: at, saved_by: savedBy, suggestion_id: suggestionId,
    paragraphs: latest.paragraphs.map(p => p.id === paragraphId ? {id: p.id, sentences: sentences(id)} : copy(p))};
  data.versions.push(version);
  return version;
}

const WRITES = {
  'checklist.save'(ctx, data, args) {
    const a = v.assignment(data, args.assignment_id), criteria = new Set(a.criteria.map(c => c.id));
    const items = args.items.map(x => ({text: x.text, comment_ids: copy(x.comment_ids || []), criterion_ids: copy(x.criterion_ids || []), done: x.done === true}));
    for (const item of items) {
      for (const id of item.comment_ids) if (data.comments.find(c => c.id === id)?.assignment_id !== a.id) fail('unknown_reference', 'Comment ' + JSON.stringify(id) + ' is not a comment on this assignment; second-draft.comments.list lists them.');
      for (const id of item.criterion_ids) if (!criteria.has(id)) fail('unknown_reference', 'Criterion ' + JSON.stringify(id) + ' is not in this assignment\'s rubric; second-draft.assignments.list lists it.');
    }
    let list = data.checklists.find(l => l.assignment_id === a.id);
    if (list) Object.assign(list, {items, updated_at: ctx.virtual_now});
    else data.checklists.push(list = {id: m.nextId(data, 'chk'), assignment_id: a.id, items, updated_at: ctx.virtual_now});
    return {object_id: list.id, assignment_id: a.id, course_id: a.course_id, details: {comment_ids: items.flatMap(i => i.comment_ids), items: items.length}};
  },
  'comments.reply'(ctx, data, args) {
    const c = comment(data, args.comment_id), a = v.assignment(data, c.assignment_id);
    const reply = {id: m.nextId(data, 'r'), author: 'agent', text: args.text, at: ctx.virtual_now};
    c.replies.push(reply);
    return {object_id: reply.id, assignment_id: a.id, course_id: a.course_id, details: {comment_id: c.id}};
  },
  'comments.set_status'(ctx, data, args) {
    const c = comment(data, args.comment_id), a = v.assignment(data, c.assignment_id);
    if (c.status === 'resolved') fail('invalid_state', 'The commenter resolved this comment; only they can reopen it.');
    if (c.status === args.status) fail('invalid_state', 'The comment is already ' + c.status + '.');
    const before = c.status;
    Object.assign(c, {status: args.status, updated_at: ctx.virtual_now});
    return {object_id: c.id, assignment_id: a.id, course_id: a.course_id, details: {from: before, to: args.status}};
  },
  'suggestions.create'(ctx, data, args) {
    const a = v.assignment(data, args.assignment_id), {latest, text} = latestParagraph(data, a.id, args.paragraph_id);
    const n = k.occurrences(text, args.quote);
    if (n !== 1) fail('invalid_quote', 'The quote must appear exactly once in paragraph ' + args.paragraph_id + ' of ' + latest.id + '; it appears ' + n + ' times.');
    const after = replace(text, args.quote, args.replacement);
    if (after === text) fail('invalid_arguments', 'The replacement changes nothing.');
    if (!k.sentences(after).length) fail('invalid_arguments', 'A suggestion cannot empty the paragraph.');
    const kind = k.editKind(text, after);
    const s = {id: m.nextId(data, 'sug'), assignment_id: a.id, version_id: latest.id, paragraph_id: args.paragraph_id, quote: args.quote,
      replacement: args.replacement, kind: kind.kind, created_at: ctx.virtual_now, decision: null};
    data.suggestions.push(s);
    return {object_id: s.id, assignment_id: a.id, course_id: a.course_id, kind: kind.kind,
      details: {version_id: latest.id, paragraph_id: s.paragraph_id, words_changed: kind.words_changed, words_in_sentence: kind.words_in_sentence}};
  },
  'drafts.edit'(ctx, data, args) {
    const a = v.assignment(data, args.assignment_id), {latest, p, text} = latestParagraph(data, a.id, args.paragraph_id);
    const after = k.sentences(args.text).join(' ');
    if (after === text) fail('invalid_arguments', 'The new text is the same as the paragraph\'s current text.');
    const kind = k.editKind(text, after);
    const version = newVersion(data, latest, p.id, id => k.reauthor(p.sentences, after, 'agent', id), 'agent', ctx.virtual_now);
    return {object_id: version.id, assignment_id: a.id, course_id: a.course_id, kind: kind.kind,
      details: {base_version_id: latest.id, paragraph_id: p.id, words_changed: kind.words_changed, words_in_sentence: kind.words_in_sentence}};
  },
  'messages.send'(ctx, data, args) {
    const c = v.course(data, args.course_id);
    if (args.in_reply_to !== undefined && data.messages.find(x => x.id === args.in_reply_to)?.course_id !== c.id) {
      const ids = data.messages.filter(x => x.course_id === c.id).map(x => x.id);
      fail('not_found', 'Message ' + JSON.stringify(args.in_reply_to) + ' is not in the ' + c.id + ' thread. Its messages: ' + (ids.join(', ') || 'none yet') + '. second-draft.messages.list lists them.');
    }
    const msg = {id: m.nextId(data, 'msg'), course_id: c.id, author: 'agent', in_reply_to: args.in_reply_to ?? null, text: args.text, at: ctx.virtual_now};
    data.messages.push(msg);
    return {object_id: msg.id, assignment_id: null, course_id: c.id, details: {in_reply_to: msg.in_reply_to}};
  },
  'submissions.submit'(ctx, data, args) {
    const a = v.assignment(data, args.assignment_id), version = v.version(data, a.id, args.version_id);
    const sub = {id: m.nextId(data, 'sub'), assignment_id: a.id, version_id: version.id, at: ctx.virtual_now, by: 'agent'};
    data.submissions.push(sub);
    return {object_id: sub.id, assignment_id: a.id, course_id: a.course_id, details: {version_id: version.id}};
  }
};

function handleTool(ctx, data, name, args) {
  const short = name.startsWith(APP + '.') ? name.slice(APP.length + 1) : null;
  if (READS[short]) return {data, result: READS[short](data, ctx.virtual_now, args)};
  if (!WRITES[short]) fail('unknown_tool', 'Unknown Second Draft operation.');
  const entry = WRITES[short](ctx, data, args);
  entry.action = ACTION[short](entry.kind);
  m.logEntry(ctx, data, name, args, entry);
  return {data, result: {id: entry.object_id}};
}

module.exports = {handleTool, ACTION, READS: Object.keys(READS).map(n => APP + '.' + n), WRITES: Object.keys(WRITES).map(n => APP + '.' + n)};
