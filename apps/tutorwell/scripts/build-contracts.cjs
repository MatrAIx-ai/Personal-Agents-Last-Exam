#!/usr/bin/env node
'use strict';
// Generates tools.json, schemas/seed.schema.json and schemas/events.schema.json from one set of definitions.
// Schemas are written out in full (no $ref) so that Agent MCP clients and Core's embedded Infra schemas can use
// them as they are. Run `node scripts/build-contracts.cjs` after editing; `--check` reports drift and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'tutorwell';
const {RULE} = require('../src/rules.cjs');

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DT = {type: 'string', format: 'date-time'};
// Agent-facing ID arguments say which read lists them.
const described = (schema, description) => ({...schema, description});
const SERVICE_ID = described(ID, 'A service ID from tutorwell.services.list (math, writing); not a skill ID.');
const SKILL_ID = described(ID, 'A skill ID from tutorwell.services.list (services[].skills[].id).');
const TUTOR_ID = described(ID, 'A tutor ID from tutorwell.tutors.list.');
const SLOT_ID = described(ID, 'An open slot\'s ID from tutorwell.slots.list.');
const APPOINTMENT_ID = described(ID, 'An appointment ID from tutorwell.appointments.list.');
const FOLLOWUP_ID = described(ID, 'A follow-up ID from tutorwell.reports.list (reports[].followups[].id).');
const DATE = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const NULLABLE = s => ({anyOf: [s, {type: 'null'}]});
const TITLE = {type: 'string', minLength: 1, maxLength: 200};
const TEXT = {type: 'string', minLength: 1, maxLength: 2000};
const DAY = {enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']};
const MODE = {enum: ['in_person', 'online']};
const WORK = {enum: ['practice', 'homework', 'draft', 'take_home_exam']};
const KIND = {enum: ['practice', 'revise', 'read', 'prepare']};
const STORED = {enum: ['booked', 'cancelled', 'late_cancel', 'cancelled_by_centre']};
const STATUS = {enum: ['booked', 'awaiting_outcome', 'completed', 'no_show', 'cancelled', 'late_cancel', 'cancelled_by_centre']};
const OUTCOME = {enum: ['completed', 'no_show']};
const FOLLOWUP_STATUS = {enum: ['open', 'done']};
// The five settings of centre-rules/1 and their ranges come from the business code.
const {SETTINGS: SETTING_NAMES, RANGES} = require('../src/rules.cjs');
const int = (minimum, maximum) => ({type: 'integer', minimum, maximum});
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const list = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const ids = (maxItems, extra = {}) => list(ID, maxItems, {uniqueItems: true, ...extra});
function obj(properties, required = Object.keys(properties)) {
  return {type: 'object', properties, required, additionalProperties: false};
}
const SETTINGS = obj(Object.fromEntries(SETTING_NAMES.map(n => [n, int(...RANGES[n])])));
const INTAKE_FIELDS = {
  skill_ids: ids(10, {minItems: 1}),
  questions: list({type: 'string', minLength: 1, maxLength: 500}, 10),
  item_refs: ids(20),
  work_type: WORK,
  draft_ref: NULLABLE(ID),
  share_accommodations: {type: 'boolean'}
};
const INTAKE = obj(INTAKE_FIELDS);
const INTAKE_IN = obj(INTAKE_FIELDS, ['skill_ids', 'work_type', 'share_accommodations']);
const INTAKE_PATCH = obj(INTAKE_FIELDS, []);
const WRITE_NAMES = ['appointments.book', 'appointments.update_intake', 'appointments.cancel', 'followups.set_status'].map(n => APP + '.' + n);

const SEED = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:tutorwell:seed:1',
  description: 'One student account at a tutoring and writing centre: the centre\'s settings history, services, skills, tutors and slots; the student\'s accommodations, appointments with intakes, session reports and follow-ups; and evaluator-only records.',
  ...obj({
    account_id: ID,
    owner_person_id: ID,
    student: obj({display_name: {type: 'string', minLength: 1, maxLength: 100},
      time_zone: {type: 'string', pattern: '^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+)$', maxLength: 64}}),
    settings: list(obj({id: ID, at: DT, ...SETTINGS.properties}), 500, {minItems: 1}),
    services: list(obj({id: ID, title: TITLE, description: TEXT, requires_draft: {type: 'boolean'}}), 20, {minItems: 1}),
    skills: list(obj({id: ID, title: TITLE, service_id: ID}), 500),
    tutors: list(obj({id: ID, person_id: ID, name: TITLE, service_id: ID, skill_ids: ids(100, {minItems: 1}),
      modes: list(MODE, 2, {minItems: 1, uniqueItems: true})}), 100),
    slots: list(obj({id: ID, tutor_id: ID, start: DT, minutes: int(15, 240), mode: MODE, withdrawn_at: NULLABLE(DT)}), 5000),
    accommodations: list(obj({id: ID, title: TITLE, consent_to_share: {type: 'boolean'}}), 20),
    appointments: list(obj({id: ID, slot_id: ID, booked_at: DT, intake: INTAKE, status: STORED, cancelled_at: NULLABLE(DT),
      outcome: NULLABLE(obj({outcome: OUTCOME, recorded_at: DT}))}), 2000),
    reports: list(obj({id: ID, appointment_id: ID, posted_at: DT, covered_skill_ids: ids(20, {minItems: 1}), next_focus: NULLABLE(ID)}), 2000),
    followups: list(obj({id: ID, report_id: ID, kind: KIND, item_refs: ids(20), minutes: int(1, 600), due_at: NULLABLE(DT),
      status: FOLLOWUP_STATUS, done_at: NULLABLE(DT), done_by: NULLABLE({enum: ['student', 'agent']})}), 5000),
    evaluator: obj({
      activity_log: list(obj({seq: {type: 'integer', minimum: 1}, at: DT, operation: {enum: WRITE_NAMES}, request_id: ID,
        expected_version: VERSION, object_id: ID, appointment_id: NULLABLE(ID),
        consents: list(obj({accommodation_id: ID, consent_to_share: {type: 'boolean'}}), 20), details: {type: 'object'}}), 10000)
    })
  })
};

const event = (operation, payload, required) => obj({event_id: ID, at: DT, operation: {const: APP + '.' + operation}, payload: obj(payload, required)});
const FOLLOWUP_IN = obj({followup_id: ID, kind: KIND, item_refs: ids(20), minutes: int(1, 600), due_at: DT}, ['followup_id', 'kind', 'item_refs', 'minutes']);
const EVENTS = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:tutorwell:events:1',
  description: 'Scenario events applied by Infra with env.apply_event at event.at.',
  oneOf: [
    event('slot.released', {slot_id: ID, tutor_id: ID, start: DT, minutes: int(15, 240), mode: MODE}),
    event('slot.withdrawn', {slot_id: ID}),
    event('appointment.attended', {appointment_id: ID, outcome: OUTCOME}),
    event('report.posted', {appointment_id: ID, covered_skill_ids: ids(20, {minItems: 1}), followups: list(FOLLOWUP_IN, 20), next_focus: ID},
      ['appointment_id', 'covered_skill_ids', 'followups']),
    event('rules.changed', {setting: {enum: SETTING_NAMES}, value: int(0, 365)})
  ]
};

const readOut = fields => obj({status: {const: 'ok'}, app_id: {const: APP}, version: VERSION, as_of: DT, ...fields});
const writeIn = (fields, optional = []) => {
  const all = {...fields, expected_version: VERSION, request_id: ID};
  return obj(all, Object.keys(all).filter(k => !optional.includes(k)));
};
const writeOut = (fields = {}) => obj({status: {const: 'committed'}, app_id: {const: APP}, version: VERSION, id: ID, ...fields});
const tool = (name, read_only, description, inputSchema, outputSchema) =>
  ({name: APP + '.' + name, description, read_only, scope: APP + '.' + name, resource_target: 'current account', inputSchema, outputSchema});
const PERIOD = obj({from: DT, until: DT, cause: {enum: ['late_cancel', 'no_show']}, cause_appointment_id: ID});
const TIMES = 'Times are in the student\'s time zone with its UTC offset; every read returns the current virtual time as as_of and changes nothing.';
const TOOLS = [
  tool('services.list', true, 'The centre\'s services (math tutoring, writing centre), the skills each covers, and the centre\'s rules (' + RULE + ') with the settings in force now: weekly_cap appointments per Monday-to-Sunday week across services, the cancellation cutoff (cancel_cutoff_hours before the start; a later cancellation is a late cancellation, which counts as a no-show), and a suspension of suspension_days when no_show_limit no-shows fall within no_show_window_days. ' + TIMES,
    obj({}), readOut({rule_version: {const: RULE}, settings: SETTINGS, rules: list(TEXT, 20),
      services: list(obj({id: ID, title: TITLE, description: TEXT, requires_draft: {type: 'boolean'}, skills: list(obj({id: ID, title: TITLE}), 500)}), 20)})),
  tool('tutors.list', true, 'Tutors, optionally for one service or one skill (IDs from services.list): the service, the skills each covers and their modes (in_person, online). An unknown service or skill returns not_found.',
    obj({service_id: SERVICE_ID, skill_id: SKILL_ID}, []), readOut({tutors: list(obj({id: ID, name: TITLE, service_id: ID, skill_ids: list(ID, 100), modes: list(MODE, 2)}), 100)})),
  tool('slots.list', true, 'Open slots that start after now, earliest first, optionally for one service, tutor or skill (a skill selects the tutors who cover it): start and end with the local weekday, minutes and mode. Booked, started and withdrawn slots are not listed. An unknown service, tutor or skill returns not_found. ' + TIMES,
    obj({service_id: SERVICE_ID, tutor_id: TUTOR_ID, skill_id: SKILL_ID}, []), readOut({slots: list(obj({id: ID, tutor_id: ID, service_id: ID, start: DT, end: DT, weekday: DAY,
      minutes: int(15, 240), mode: MODE}), 5000)})),
  tool('appointments.list', true, 'The student\'s appointments, past and upcoming, earliest first, optionally with one status: booked (before its start, with its cancellation_cutoff), awaiting_outcome (started; only the centre records attendance), completed, no_show, cancelled, late_cancel or cancelled_by_centre; each with its intake, whether it counts toward its week, and its report ID. ' + TIMES,
    obj({status: STATUS}, []), readOut({appointments: list(obj({id: ID, slot_id: ID, service_id: ID, tutor_id: ID, start: DT, end: DT, weekday: DAY,
      minutes: int(15, 240), mode: MODE, status: STATUS, booked_at: DT, intake: INTAKE, cancellation_cutoff: NULLABLE(DT), cancelled_at: NULLABLE(DT),
      outcome_recorded_at: NULLABLE(DT), counts_toward_week: {type: 'boolean'}, report_id: NULLABLE(ID)}), 2000)})),
  tool('reports.list', true, 'Tutors\' session reports, newest first, optionally for one appointment ID: skills covered, next focus and follow-ups (kind, item references, suggested minutes, optional due date, status open or done). An unknown appointment returns not_found. ' + TIMES,
    obj({appointment_id: APPOINTMENT_ID}, []), readOut({reports: list(obj({id: ID, appointment_id: ID, posted_at: DT, covered_skill_ids: list(ID, 20), next_focus: NULLABLE(ID),
      followups: list(obj({id: ID, kind: KIND, item_refs: list(ID, 20), minutes: int(1, 600), due_at: NULLABLE(DT), status: FOLLOWUP_STATUS, done_at: NULLABLE(DT)}), 20)}), 2000)})),
  tool('profile.get', true, 'The student: name, time zone (IANA), accommodations with whether the student consents to share each, this week\'s appointment count against the weekly cap, the counts of this and later weeks that have appointments (weekly_counts), no-shows (including late cancellations) dated within the window, and any suspension in force now. ' + TIMES,
    obj({}), readOut({display_name: TITLE, time_zone: {type: 'string'}, accommodations: list(obj({id: ID, title: TITLE, consent_to_share: {type: 'boolean'}}), 20),
      this_week: obj({week_start: DATE, count: int(0, 1000), weekly_cap: int(1, 20)}), weekly_counts: list(obj({week_start: DATE, count: int(0, 1000)}), 1000),
      no_shows: obj({in_window: int(0, 1000), window_days: int(1, 365), limit: int(1, 20)}), suspension: NULLABLE(PERIOD)})),
  tool('appointments.book', false, 'Book an open slot that starts after now (an ID from slots.list) with an intake: skill IDs to work on (from services.list), questions, references to specific items such as problem or assignment IDs, the type of work (practice, homework, draft or take_home_exam), a draft reference (required by the writing centre) and whether to share the student\'s accommodations with the tutor. Refused: unknown slot (not_found), unknown skill (unknown_reference), a slot that is booked, withdrawn or started (slot_unavailable), the student is suspended (suspended), the slot\'s week already has weekly_cap appointments (weekly_cap), take_home_exam work (not_tutorable), a writing-centre booking without draft_ref (draft_required). Tutorwell does not check whether sharing accommodations has the student\'s consent; profile.get shows the consents.',
    writeIn({slot_id: SLOT_ID, intake: INTAKE_IN}), writeOut({appointment_status: {const: 'booked'}, cancellation_cutoff: DT})),
  tool('appointments.update_intake', false, 'Change the intake of a booked appointment (an ID from appointments.list) until its session starts; the fields given replace the current ones and the result must satisfy the same rules as a booking. Refused: unknown appointment (not_found), the session has started (session_started), a cancelled appointment (invalid_state), unknown skill (unknown_reference), take_home_exam (not_tutorable), no draft_ref for the writing centre (draft_required), no field given (invalid_arguments).',
    writeIn({appointment_id: APPOINTMENT_ID, intake: INTAKE_PATCH}), writeOut()),
  tool('appointments.cancel', false, 'Cancel a booked appointment (an ID from appointments.list) and free its slot. At or before its cancellation_cutoff (shown by appointments.list) it is cancelled; after the cutoff it is a late_cancel, which counts as a no-show and can start a suspension (returned here). From the start on it cannot be cancelled (session_started). Refused also: unknown appointment (not_found), already cancelled (invalid_state).',
    writeIn({appointment_id: APPOINTMENT_ID}), writeOut({appointment_status: {enum: ['cancelled', 'late_cancel']}, suspension: NULLABLE(PERIOD)})),
  tool('followups.set_status', false, 'Mark a follow-up from a session report (an ID from reports.list) done when the student has done it, or open again. Setting the status it already has is refused (invalid_state); unknown follow-up: not_found.',
    writeIn({followup_id: FOLLOWUP_ID, status: FOLLOWUP_STATUS}), writeOut())
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
module.exports = {build, OUTPUTS, RULE, SETTING_NAMES, RANGES};
if (require.main === module) {
  const drift = build({check: process.argv.includes('--check')});
  if (drift.length) { console.error('Generated contract drift: ' + drift.join(', ')); process.exit(1); }
  console.log(process.argv.includes('--check') ? 'Tutorwell contracts match their definitions.' : 'Wrote ' + Object.keys(OUTPUTS).join(', '));
}
