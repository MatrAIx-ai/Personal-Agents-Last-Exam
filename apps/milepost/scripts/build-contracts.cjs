#!/usr/bin/env node
'use strict';
// Generates tools.json, schemas/seed.schema.json and schemas/events.schema.json from one set of definitions.
// Schemas are written out in full (no $ref) so that Agent MCP clients and Core's embedded Infra schemas can use
// them as they are. Run `node scripts/build-contracts.cjs` after editing; `--check` reports drift and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'milepost', RULE = 'milepost-learner/1';

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DT = {type: 'string', format: 'date-time'};
const NULLABLE = s => ({anyOf: [s, {type: 'null'}]});
const LEVEL = {type: 'number', minimum: 0, maximum: 1};
const TARGET = {type: 'number', minimum: 0.01, maximum: 1};
const TITLE = {type: 'string', minLength: 1, maxLength: 200};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = {enum: DAYS};
const HHMM = {type: 'string', pattern: '^(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'};
const int = (minimum, maximum) => ({type: 'integer', minimum, maximum});
const num = (minimum, maximum) => ({type: 'number', minimum, maximum});
const PRACTICE_MINUTES = int(5, 300), BLOCK_MINUTES = int(5, 240);
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const list = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
function obj(properties, required = Object.keys(properties)) {
  return {type: 'object', properties, required, additionalProperties: false};
}
const SKILL_LEVEL = obj({skill_id: ID, level: LEVEL});
const SKILL_TARGET = obj({skill_id: ID, level: TARGET});
const WINDOW = obj({day: DAY, from: HHMM, to: HHMM});
const PREFERENCES = obj({
  available_hours: list(WINDOW, 21),
  daily_cap_minutes: int(0, 720),
  rest_days: list(DAY, 7, {uniqueItems: true}),
  block_minutes: obj({min: BLOCK_MINUTES, max: BLOCK_MINUTES})
});
const WRITE_NAMES = ['practice.record', 'practice.remove', 'plan.add_block', 'plan.update_block', 'plan.remove_block'].map(n => APP + '.' + n);

const SEED = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:milepost:seed:1',
  description: 'One student account: course catalog, the student record and evaluator-only data.',
  ...obj({
    account_id: ID,
    owner_person_id: ID,
    student: obj({display_name: {type: 'string', minLength: 1, maxLength: 100},
      time_zone: {type: 'string', pattern: '^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+)$', maxLength: 64}}),
    courses: list(obj({id: ID, title: TITLE}), 20),
    units: list(obj({id: ID, course_id: ID, title: TITLE, position: int(1, 1000)}), 200),
    skills: list(obj({id: ID, unit_id: ID, title: TITLE, prerequisites: list(ID, 20, {uniqueItems: true})}), 500),
    mastery: list(obj({skill_id: ID, level: LEVEL, stability_days: num(0.01, 365), as_of: NULLABLE(DT), last_practised_at: NULLABLE(DT)}), 500),
    assessments: list(obj({id: ID, title: TITLE, date: DT, targets: list(SKILL_TARGET, 100, {minItems: 1}), created_at: DT, updated_at: DT}), 200),
    results: list(obj({id: ID, assessment_id: ID, posted_at: DT, levels: list(SKILL_LEVEL, 100, {minItems: 1})}), 200),
    practice: list(obj({id: ID, skill_id: ID, minutes: PRACTICE_MINUTES, ended_at: DT, source: {enum: ['platform', 'student_report']},
      block_id: NULLABLE(ID), recorded_at: DT}), 5000),
    plan: list(obj({id: ID, skill_id: ID, start: DT, minutes: BLOCK_MINUTES, created_at: DT, updated_at: DT, done: {type: 'boolean'}}), 2000),
    preferences: PREFERENCES,
    evaluator: obj({
      learner_params: obj({learning_rate: num(0.0001, 10), prerequisite_floor: num(0, 1), retention_base: num(0.01, 0.9999),
        stability_growth: num(0, 10), spacing_bonus: num(0, 10), min_stability_days: num(0.01, 365), max_stability_days: num(0.01, 365)}),
      activity_log: list(obj({seq: {type: 'integer', minimum: 1}, at: DT, operation: {enum: WRITE_NAMES}, request_id: ID,
        expected_version: VERSION, object_id: ID, details: {type: 'object'}}), 10000)
    })
  })
};

const event = (operation, payload, required) => obj({event_id: ID, at: DT, operation: {const: APP + '.' + operation}, payload: obj(payload, required)});
const RULES = [
  ['available_hours', list(WINDOW, 21)], ['daily_cap_minutes', int(0, 720)],
  ['rest_days', list(DAY, 7, {uniqueItems: true})], ['block_minutes', obj({min: BLOCK_MINUTES, max: BLOCK_MINUTES})]
];
const EVENTS = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:milepost:events:1',
  description: 'Scenario events applied by Infra with env.apply_event at event.at.',
  oneOf: [
    event('practice.completed', {skill_id: ID, minutes: PRACTICE_MINUTES, block_id: ID}, ['skill_id', 'minutes']),
    event('assessment.result_posted', {assessment_id: ID, results: list(SKILL_LEVEL, 100, {minItems: 1})}),
    event('assessment.added', {assessment_id: ID, title: TITLE, date: DT, targets: list(SKILL_TARGET, 100, {minItems: 1})}, ['assessment_id', 'date', 'targets']),
    event('assessment.moved', {assessment_id: ID, date: DT}),
    ...RULES.map(([rule, value]) => obj({event_id: ID, at: DT, operation: {const: APP + '.preferences.changed'}, payload: obj({rule: {const: rule}, value})}))
  ]
};

const AS_OF = {as_of: DT};
const readOut = fields => obj({status: {const: 'ok'}, app_id: {const: APP}, version: VERSION, ...AS_OF, ...fields});
const writeIn = fields => obj({...fields, expected_version: VERSION, request_id: ID});
const WRITE_OUT = obj({status: {const: 'committed'}, app_id: {const: APP}, version: VERSION, id: ID});
const tool = (name, read_only, description, inputSchema, outputSchema) =>
  ({name: APP + '.' + name, description, read_only, scope: APP + '.' + name, resource_target: 'current account', inputSchema, outputSchema});
const BLOCK_STATUS = {enum: ['planned', 'done', 'missed']};
const TOOLS = [
  tool('courses.list', true, 'List the student\'s courses with their units and the skills in each unit. Reads change nothing; every read returns the current virtual time as as_of.',
    obj({}), readOut({courses: list(obj({id: ID, title: TITLE, units: list(obj({id: ID, title: TITLE, position: int(1, 1000), skill_ids: list(ID, 500)}), 200)}), 20)})),
  tool('skills.list', true, 'List skills (their IDs, titles and prerequisites), optionally for one course ID from courses.list. An unknown course returns not_found.',
    obj({course_id: ID}, []), readOut({skills: list(obj({id: ID, title: TITLE, course_id: ID, unit_id: ID, prerequisites: list(ID, 20)}), 500)})),
  tool('mastery.get', true, 'Current mastery level of each skill (or of the listed skills) and when it was last practised, under learner rule ' + RULE + '. Levels fade with the time since practice. An unknown skill returns not_found.',
    obj({skill_ids: list(ID, 500, {minItems: 1, uniqueItems: true})}, []),
    readOut({rule_version: {const: RULE}, skills: list(obj({skill_id: ID, level: LEVEL, last_practised_at: NULLABLE(DT)}), 500)})),
  tool('assessments.list', true, 'Assessments with their ID, date, target level per skill, status and posted result. Use these IDs with plan.project.',
    obj({}), readOut({assessments: list(obj({id: ID, title: TITLE, date: DT, day: DAY, targets: list(SKILL_TARGET, 100), status: {enum: ['scheduled', 'assessed']},
      result: NULLABLE(obj({posted_at: DT, levels: list(SKILL_LEVEL, 100)}))}), 200)})),
  tool('practice.list', true, 'Recorded practice sessions, optionally for one skill: platform sessions and practice the student reported. An unknown skill returns not_found.',
    obj({skill_id: ID}, []), readOut({sessions: list(obj({id: ID, skill_id: ID, minutes: PRACTICE_MINUTES, started_at: DT, ended_at: DT, day: DAY,
      source: {enum: ['platform', 'student_report']}, block_id: NULLABLE(ID)}), 5000)})),
  tool('plan.list', true, 'Study blocks with their status: planned, done (a completed session names it) or missed (it ended without one).',
    obj({}), readOut({blocks: list(obj({id: ID, skill_id: ID, start: DT, end: DT, day: DAY, minutes: BLOCK_MINUTES, status: BLOCK_STATUS}), 2000)})),
  tool('plan.project', true, 'For the stored plan and one future assessment (an ID from assessments.list), the level each target skill would reach on the assessment date if every planned block is completed, under learner rule ' + RULE + ', and whether it reaches its target (judged on the unrounded level, so 0.650 against 0.65 can still be short). Study-rule checks are not included. Unknown assessment: not_found; past assessment: invalid_state.',
    obj({assessment_id: ID}), readOut({rule_version: {const: RULE}, assessment_id: ID, date: DT,
      skills: list(obj({skill_id: ID, projected_level: LEVEL, target: TARGET, reaches_target: {type: 'boolean'}}), 100)})),
  tool('preferences.get', true, 'The student\'s study rules (available hours, daily cap, rest days, block length) and time zone. Milepost does not enforce these rules.',
    obj({}), readOut({time_zone: {type: 'string'}, preferences: PREFERENCES})),
  tool('practice.record', false, 'Record practice the student reports doing elsewhere, with its skill (an ID from skills.list), minutes and end time. Refused: unknown skill (not_found), a session ending in the future (invalid_time), or one overlapping a recorded session (overlap).',
    writeIn({skill_id: ID, minutes: PRACTICE_MINUTES, ended_at: DT}), WRITE_OUT),
  tool('practice.remove', false, 'Remove practice the student reported. Sessions recorded by the platform cannot be removed (not_removable). The skill is recomputed from its history; later assessment results stay.',
    writeIn({id: ID}), WRITE_OUT),
  tool('plan.add_block', false, 'Add a study block for one skill (an ID from skills.list). Refused: unknown skill (not_found), a start in the past (past_block) or an overlap with another block (overlap).',
    writeIn({skill_id: ID, start: DT, minutes: BLOCK_MINUTES}), WRITE_OUT),
  tool('plan.update_block', false, 'Change the skill, start or length of a planned block that has not started. Done or missed blocks are history (invalid_state); a past start (past_block) and overlaps (overlap) are refused.',
    writeIn({id: ID, patch: obj({skill_id: ID, start: DT, minutes: BLOCK_MINUTES}, [])}), WRITE_OUT),
  tool('plan.remove_block', false, 'Remove a planned block. Done or missed blocks cannot be removed (invalid_state).',
    writeIn({id: ID}), WRITE_OUT)
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
module.exports = {build, OUTPUTS, DAYS};
if (require.main === module) {
  const drift = build({check: process.argv.includes('--check')});
  if (drift.length) { console.error('Generated contract drift: ' + drift.join(', ')); process.exit(1); }
  console.log(process.argv.includes('--check') ? 'Milepost contracts match their definitions.' : 'Wrote ' + Object.keys(OUTPUTS).join(', '));
}
