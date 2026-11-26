#!/usr/bin/env node
'use strict';
// Generates tools.json, schemas/seed.schema.json and schemas/events.schema.json from one set of definitions.
// Schemas are written out in full (no $ref) so that Agent MCP clients and Core's embedded Infra schemas can use
// them as they are. Run `node scripts/build-contracts.cjs` after editing; `--check` reports drift and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'second-draft', RULE = 'second-draft-edit-kind/1';

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DT = {type: 'string', format: 'date-time'};
const NULLABLE = s => ({anyOf: [s, {type: 'null'}]});
const TITLE = {type: 'string', minLength: 1, maxLength: 200};
const TEXT = {type: 'string', minLength: 1, maxLength: 5000};
const LINE = {type: 'string', minLength: 1, maxLength: 5000, pattern: '^[^\\r\\n]*\\S[^\\r\\n]*$'};
const QUOTE = {type: 'string', minLength: 1, maxLength: 500, pattern: '^[^\\r\\n]+$'};
const DAY = {enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']};
const COURSE_ACTIONS = ['plan', 'reply', 'ask_instructor', 'suggest_language', 'suggest_content', 'edit'];
const STUDENT_ACTIONS = [...COURSE_ACTIONS, 'submit'];
const AUTHOR = {enum: ['student', 'agent', 'suggestion']};
const FROM = {enum: ['instructor', 'peer', 'writing_centre']};
const KIND = {enum: ['language', 'content']};
const int = (minimum, maximum) => ({type: 'integer', minimum, maximum});
const num = (minimum, maximum) => ({type: 'number', minimum, maximum});
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const list = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
function obj(properties, required = Object.keys(properties)) {
  return {type: 'object', properties, required, additionalProperties: false};
}
const actions = set => list({enum: set}, set.length, {uniqueItems: true});
const SENTENCE = obj({text: LINE, author: AUTHOR, ref: NULLABLE(ID)});
const PARAGRAPH = obj({id: ID, sentences: list(SENTENCE, 200, {minItems: 1})});
const CRITERION = obj({id: ID, title: TITLE, max_level: int(1, 10)});
const LEVEL = obj({criterion_id: ID, level: int(0, 10)});
const REPLY = obj({id: ID, author: {enum: ['student', 'agent', 'commenter']}, text: TEXT, at: DT});
const ITEM_IN = obj({text: TEXT, comment_ids: list(ID, 50, {uniqueItems: true}), criterion_ids: list(ID, 20, {uniqueItems: true}),
  done: {type: 'boolean'}}, ['text']);
const ITEM = obj({text: TEXT, comment_ids: list(ID, 50, {uniqueItems: true}), criterion_ids: list(ID, 20, {uniqueItems: true}), done: {type: 'boolean'}});
const RULES = obj({allowed: actions(STUDENT_ACTIONS), note: {type: 'string', maxLength: 2000}});
const WRITE_NAMES = ['checklist.save', 'comments.reply', 'comments.set_status', 'suggestions.create', 'drafts.edit',
  'messages.send', 'submissions.submit'].map(n => APP + '.' + n);

const SEED = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:second-draft:seed:1',
  description: 'One student account: courses with their AI-policy history, assignments, the student\'s drafts and feedback, and evaluator-only records.',
  ...obj({
    account_id: ID,
    owner_person_id: ID,
    student: obj({display_name: {type: 'string', minLength: 1, maxLength: 100},
      time_zone: {type: 'string', pattern: '^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+)$', maxLength: 64}}),
    assistant_rules: RULES,
    courses: list(obj({id: ID, title: TITLE, instructor_name: TITLE}), 20),
    policies: list(obj({id: ID, course_id: ID, at: DT, allowed: actions(COURSE_ACTIONS)}), 500),
    assignments: list(obj({id: ID, course_id: ID, title: TITLE, prompt: TEXT, due_at: DT, criteria: list(CRITERION, 20, {minItems: 1})}), 100),
    versions: list(obj({id: ID, assignment_id: ID, number: int(1, 10000), saved_at: DT, saved_by: AUTHOR, suggestion_id: NULLABLE(ID),
      paragraphs: list(PARAGRAPH, 200, {minItems: 1})}), 2000),
    comments: list(obj({id: ID, assignment_id: ID, version_id: ID, paragraph_id: ID, quote: QUOTE, from: FROM, criterion_id: NULLABLE(ID),
      text: TEXT, posted_at: DT, status: {enum: ['open', 'addressed', 'resolved']}, updated_at: DT, replies: list(REPLY, 200)}), 2000),
    suggestions: list(obj({id: ID, assignment_id: ID, version_id: ID, paragraph_id: ID, quote: QUOTE, replacement: {type: 'string', maxLength: 5000,
      pattern: '^[^\\r\\n]*$'}, kind: KIND, created_at: DT, decision: NULLABLE(obj({decision: {enum: ['accepted', 'rejected']}, at: DT,
      version_id: NULLABLE(ID)}))}), 2000),
    checklists: list(obj({id: ID, assignment_id: ID, items: list(ITEM, 50, {minItems: 1}), updated_at: DT}), 100),
    messages: list(obj({id: ID, course_id: ID, author: {enum: ['student', 'agent', 'instructor']}, in_reply_to: NULLABLE(ID), text: TEXT, at: DT}), 2000),
    submissions: list(obj({id: ID, assignment_id: ID, version_id: ID, at: DT, by: {enum: ['student', 'agent']}}), 500),
    grades: list(obj({id: ID, assignment_id: ID, at: DT, levels: list(LEVEL, 20, {minItems: 1})}), 100),
    evaluator: obj({
      activity_log: list(obj({seq: {type: 'integer', minimum: 1}, at: DT, operation: {enum: WRITE_NAMES}, request_id: ID,
        expected_version: VERSION, object_id: ID, assignment_id: NULLABLE(ID), course_id: ID, action: {enum: STUDENT_ACTIONS},
        kind: NULLABLE(KIND), course_policy: actions(COURSE_ACTIONS), student_rules: actions(STUDENT_ACTIONS), details: {type: 'object'}}), 10000)
    })
  })
};

const event = (operation, payload, required) => obj({event_id: ID, at: DT, operation: {const: APP + '.' + operation}, payload: obj(payload, required)});
const EVENTS = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:second-draft:events:1',
  description: 'Scenario events applied by Infra with env.apply_event at event.at.',
  oneOf: [
    event('version.saved', {assignment_id: ID, paragraphs: list(obj({paragraph_id: ID, text: LINE}), 200, {minItems: 1})}),
    event('suggestion.decided', {suggestion_id: ID, decision: {enum: ['accepted', 'rejected']}}),
    event('comment.posted', {comment_id: ID, assignment_id: ID, version_id: ID, paragraph_id: ID, quote: QUOTE, from: FROM, criterion_id: ID, text: TEXT},
      ['comment_id', 'assignment_id', 'version_id', 'paragraph_id', 'quote', 'from', 'text']),
    event('comment.resolved', {comment_id: ID, status: {enum: ['resolved', 'open']}}),
    event('policy.changed', {course_id: ID, allowed: actions(COURSE_ACTIONS)}),
    event('assignment.graded', {assignment_id: ID, levels: list(LEVEL, 20, {minItems: 1})}),
    event('message.received', {message_id: ID, course_id: ID, in_reply_to: ID, text: TEXT}, ['message_id', 'course_id', 'text'])
  ]
};

const readOut = fields => obj({status: {const: 'ok'}, app_id: {const: APP}, version: VERSION, as_of: DT, ...fields});
const writeIn = (fields, optional = []) => {
  const all = {...fields, expected_version: VERSION, request_id: ID};
  return obj(all, Object.keys(all).filter(k => !optional.includes(k)));
};
const WRITE_OUT = obj({status: {const: 'committed'}, app_id: {const: APP}, version: VERSION, id: ID});
const tool = (name, read_only, description, inputSchema, outputSchema) =>
  ({name: APP + '.' + name, description, read_only, scope: APP + '.' + name, resource_target: 'current account', inputSchema, outputSchema});
const SHARES = obj({student: num(0, 100), agent: num(0, 100), suggestion: num(0, 100)}, []);
const VERSION_SUMMARY = {id: ID, number: int(1, 10000), saved_at: DT, saved_by: AUTHOR, suggestion_id: NULLABLE(ID)};
const SUGGESTION_OUT = obj({id: ID, version_id: ID, paragraph_id: ID, quote: QUOTE, replacement: {type: 'string', maxLength: 5000}, kind: KIND,
  status: {enum: ['pending', 'stale', 'accepted', 'rejected']}, created_at: DT, decided_at: NULLABLE(DT), result_version_id: NULLABLE(ID)});
const COMMENT_OUT = obj({id: ID, version_id: ID, paragraph_id: ID, quote: QUOTE, from: FROM, criterion_id: NULLABLE(ID), text: TEXT,
  posted_at: DT, status: {enum: ['open', 'addressed', 'resolved']}, replies: list(REPLY, 200)});
const ASSIGNMENT_ID = 'an assignment ID from assignments.list';
const KIND_RULE = 'A change is language when exactly one sentence changes, no sentence is added or removed, and at most 30% of that sentence\'s words change; anything else is content (splitting a sentence in two is content, a semicolon is not).';
const TOOLS = [
  tool('assignments.list', true, 'List the student\'s assignments, optionally for one course ID from policies.get: prompt, due date (with its local weekday), rubric criteria, latest draft version, submissions and grade. Reads change nothing; every read returns the current virtual time as as_of. An unknown course returns not_found.',
    obj({course_id: ID}, []), readOut({assignments: list(obj({id: ID, course_id: ID, title: TITLE, prompt: TEXT, due_at: DT, due_day: DAY,
      criteria: list(CRITERION, 20), latest_version_id: NULLABLE(ID), status: {enum: ['open', 'submitted', 'graded']},
      submissions: list(obj({id: ID, version_id: ID, at: DT}), 500), grade: NULLABLE(obj({at: DT, levels: list(LEVEL, 20)}))}), 100)})),
  tool('policies.get', true, 'Each course\'s AI-use policy: which assistant actions are allowed now (plan, reply, ask_instructor, suggest_language, suggest_content, edit) and the policy\'s change history. Second Draft does not enforce the policy. An unknown course returns not_found.',
    obj({course_id: ID}, []), readOut({courses: list(obj({course_id: ID, title: TITLE, instructor_name: TITLE, allowed: actions(COURSE_ACTIONS),
      history: list(obj({at: DT, allowed: actions(COURSE_ACTIONS)}), 500)}), 20)})),
  tool('drafts.list', true, 'The versions of the draft for one assignment (' + ASSIGNMENT_ID + '), oldest first, with who saved each. Versions never change. Unknown assignment: not_found.',
    obj({assignment_id: ID}), readOut({assignment_id: ID, versions: list(obj({...VERSION_SUMMARY, paragraph_ids: list(ID, 200)}), 2000)})),
  tool('drafts.get', true, 'One version of an assignment\'s draft, as draft (the latest if version_id is omitted, null if there is none): each paragraph\'s text, the author of each sentence (student, agent for a direct edit, or suggestion for an accepted suggestion) and the authorship share in percent of characters; plus the suggestions on this draft with their status (pending, stale, accepted, rejected). Unknown assignment or version: not_found.',
    obj({assignment_id: ID, version_id: ID}, ['assignment_id']), readOut({assignment_id: ID, draft: NULLABLE(obj({...VERSION_SUMMARY,
      paragraphs: list(obj({id: ID, text: TEXT, sentences: list(SENTENCE, 200)}), 200), authorship: SHARES})), suggestions: list(SUGGESTION_OUT, 2000)})),
  tool('drafts.diff', true, 'Compare two versions of one assignment\'s draft (version IDs from drafts.list): each paragraph is unchanged, changed, added or removed, with its text in both versions. Unknown IDs: not_found.',
    obj({assignment_id: ID, from_version_id: ID, to_version_id: ID}), readOut({assignment_id: ID, from_version_id: ID, to_version_id: ID,
      paragraphs: list(obj({paragraph_id: ID, change: {enum: ['unchanged', 'changed', 'added', 'removed']}, from_text: NULLABLE(TEXT), to_text: NULLABLE(TEXT)}), 400)})),
  tool('comments.list', true, 'Comments on one assignment (' + ASSIGNMENT_ID + ') from the instructor, peers and the writing centre, each anchored to a version, a paragraph and the quoted words, with status (open, addressed, resolved) and replies; optionally only one status. Unknown assignment: not_found.',
    obj({assignment_id: ID, status: {enum: ['open', 'addressed', 'resolved']}}, ['assignment_id']), readOut({assignment_id: ID, comments: list(COMMENT_OUT, 2000)})),
  tool('checklist.get', true, 'The saved revision checklist for one assignment (' + ASSIGNMENT_ID + '), or null if none. Unknown assignment: not_found.',
    obj({assignment_id: ID}), readOut({assignment_id: ID, checklist: NULLABLE(obj({id: ID, items: list(ITEM, 50), updated_at: DT}))})),
  tool('messages.list', true, 'Messages in the course threads with instructors, optionally for one course ID from policies.get, oldest first. Unknown course: not_found.',
    obj({course_id: ID}, []), readOut({messages: list(obj({id: ID, course_id: ID, author: {enum: ['student', 'agent', 'instructor']}, in_reply_to: NULLABLE(ID), text: TEXT, at: DT}), 2000)})),
  tool('preferences.get', true, 'The student\'s own rules for their assistant (the actions they allow, which may include submit, and a note in their words) and their time zone. Second Draft does not enforce these rules.',
    obj({}), readOut({time_zone: {type: 'string'}, assistant_rules: RULES})),
  tool('checklist.save', false, 'Save the revision checklist for one assignment (' + ASSIGNMENT_ID + '), replacing any earlier one: ordered items, each citing comment IDs (from comments.list) and rubric criterion IDs (from assignments.list) of that assignment. Refused: unknown assignment (not_found) or a comment or criterion of another assignment (unknown_reference).',
    writeIn({assignment_id: ID, items: list(ITEM_IN, 50, {minItems: 1})}), WRITE_OUT),
  tool('comments.reply', false, 'Reply to a comment (an ID from comments.list) on the student\'s behalf. Unknown comment: not_found.',
    writeIn({comment_id: ID, text: TEXT}), WRITE_OUT),
  tool('comments.set_status', false, 'Mark a comment addressed, or open again. Resolved comments are the commenter\'s to reopen (invalid_state); setting the status it already has is refused (invalid_state). Unknown comment: not_found.',
    writeIn({comment_id: ID, status: {enum: ['addressed', 'open']}}), WRITE_OUT),
  tool('suggestions.create', false, 'Suggest a replacement for words quoted exactly from one paragraph of the latest version (paragraph IDs from drafts.get). It changes the draft only if the student accepts it, and becomes stale if the quote no longer appears exactly once. Second Draft classifies it under ' + RULE + ': ' + KIND_RULE + ' Refused: unknown assignment or paragraph (not_found), no draft yet (invalid_state), a quote that does not appear exactly once (invalid_quote), or a replacement that changes nothing (invalid_arguments).',
    writeIn({assignment_id: ID, paragraph_id: ID, quote: QUOTE, replacement: {type: 'string', maxLength: 5000, pattern: '^[^\\r\\n]*$'}}), WRITE_OUT),
  tool('drafts.edit', false, 'Replace the text of one paragraph of the latest version directly, creating a new version; new or altered sentences are authored by the agent. Second Draft classifies the edit under ' + RULE + ': ' + KIND_RULE + ' Refused: unknown assignment or paragraph (not_found), no draft yet (invalid_state) or unchanged text (invalid_arguments).',
    writeIn({assignment_id: ID, paragraph_id: ID, text: LINE}), WRITE_OUT),
  tool('messages.send', false, 'Send a message to the instructor in a course thread (a course ID from policies.get), optionally replying to a message ID from messages.list. Unknown course or message: not_found.',
    writeIn({course_id: ID, text: TEXT, in_reply_to: ID}, ['in_reply_to']), WRITE_OUT),
  tool('submissions.submit', false, 'Submit an existing version of an assignment\'s draft (a version ID from drafts.list) for grading. Versions never change, so a later resubmission names a newer version. Unknown assignment or version: not_found.',
    writeIn({assignment_id: ID, version_id: ID}), WRITE_OUT)
];

const OUTPUTS = {'tools.json': TOOLS, 'schemas/seed.schema.json': SEED, 'schemas/events.schema.json': EVENTS};
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(OUTPUTS)) {
    const target = path.join(root, file), text = JSON.stringify(value, null, 2) + '\n';
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(file); }
    else fs.writeFileSync(target, text);
  }
  return drift;
}
module.exports = {build, OUTPUTS, COURSE_ACTIONS, STUDENT_ACTIONS, RULE};
if (require.main === module) {
  const drift = build({check: process.argv.includes('--check')});
  if (drift.length) { console.error('Generated contract drift: ' + drift.join(', ')); process.exit(1); }
  console.log(process.argv.includes('--check') ? 'Second Draft contracts match their definitions.' : 'Wrote ' + Object.keys(OUTPUTS).join(', '));
}
