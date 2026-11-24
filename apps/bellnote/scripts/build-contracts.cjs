#!/usr/bin/env node
'use strict';
// Authoring-time generator for Bellnote's own contracts: tools.json, schemas/seed.schema.json,
// schemas/events.schema.json and schemas/state.schema.json come from the definitions below, so
// record shapes are written once. `--check` fails on drift (run by the business tests).
// Shared platform schema copies (bundle, dataset, ...) are not generated here; the repository's
// `npm run contracts:check` keeps those in sync.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const {ALLERGENS} = require('../src/common.cjs');
const {KINDS} = require('../src/notify.cjs');
const app = require('../app.json');

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DATE = {type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$'};
const LOCAL = {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'};
const TS = {type: 'string', format: 'date-time'};
const BOOL = {type: 'boolean'}, INT = {type: 'integer'}, CENTS = {type: 'integer', minimum: 0, maximum: 10000000};
const str = (max = 200, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const nul = s => ({anyOf: [s, {type: 'null'}]});
const arr = (items, extra = {}) => ({type: 'array', items, ...extra});
const en = (...values) => ({enum: values});
function obj(properties, optional = [], open = false) {
  return {type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: open};
}
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const HISTORY = arr({type: 'object', properties: {at: TS, action: str(80)}, required: ['at', 'action']}, {maxItems: 1000});
const ALLERGEN = en(...ALLERGENS);
const MODE = en('pickup', 'bus', 'after_care', 'walker');

const defs = {};
defs.cutoff = {anyOf: [obj({anchor: {const: 'fixed'}, local_time: LOCAL}), obj({anchor: {const: 'dismissal'}, minutes_before: {type: 'integer', minimum: 0, maximum: 600}})]};
const policyProps = {absence_cutoff_local: {$ref: 'seed.schema.json#/$defs/cutoff'}, dismissal_change_cutoff_local: {$ref: 'seed.schema.json#/$defs/cutoff'}, pickup_person_review: BOOL,
  topup_min_cents: CENTS, topup_max_cents: CENTS, meal_debt_limit_cents: CENTS};
defs.policy = obj(policyProps);
defs.policy_override = obj(policyProps, Object.keys(policyProps));
defs.district = obj({id: ID, name: str(), time_zone: str(64), policy: {$ref: 'seed.schema.json#/$defs/policy'}});
defs.school = obj({id: ID, name: str(), level: en('elementary', 'middle', 'high'), bell: obj({start_local: LOCAL, dismissal_local: LOCAL}),
  term: obj({start_date: DATE, end_date: DATE}), policy: {$ref: 'seed.schema.json#/$defs/policy_override'},
  calendar: arr(obj({date: DATE, kind: en('closed', 'early_dismissal'), dismissal_local: nul(LOCAL), reason: str(300), changed_at: nul(TS), event_id: nul(ID)}), {maxItems: 400})});
defs.staff = obj({id: ID, name: str(), role: str(80), school_id: ID});
defs.person = obj({person_id: ID, display_name: str(120), phone: nul(str(30))});
defs.child = obj({id: ID, display_name: str(120), school_id: ID, grade: str(20), homeroom: str(80), meal_restrictions: arr(ALLERGEN, {uniqueItems: true}),
  default_dismissal: en('guardian_pickup', 'bus', 'after_care', 'walker')});
defs.guardian_link = obj({id: ID, child_id: ID, person_id: ID, relationship: str(60), can_pickup: BOOL, can_sign: BOOL, can_pay: BOOL, custodial: BOOL});
defs.pickup_person = obj({id: ID, child_id: ID, person_id: ID, display_name: str(120), relationship: str(60), phone: str(30),
  status: en('pending_review', 'approved', 'denied', 'removed'), added_by: ID, created_at: TS, history: HISTORY});
defs.restriction = obj({id: ID, child_id: ID, person_id: ID, recorded_at: TS});
defs.dismissal_change = obj({id: ID, child_id: ID, date: DATE, mode: MODE, person_id: nul(ID), note: nul(str(300)), recorded_by: ID,
  actor: en('agent', 'event', 'seed'), created_at: TS, status: en('active', 'replaced', 'cancelled', 'void'), replaces: nul(ID), replaced_by: nul(ID),
  request_id: nul(ID), event_id: nul(ID), history: HISTORY});
defs.attendance = obj({id: ID, child_id: ID, date: DATE, status: en('present', 'absent', 'late', 'left_early'), time_local: nul(LOCAL),
  explanation: nul(en('explained', 'unexplained')), report_id: nul(ID), office_review: nul(en('excused', 'unexcused')), marked_by: ID, marked_at: TS, history: HISTORY});
defs.absence_report = obj({id: ID, child_id: ID, kind: en('absent', 'late', 'early_leave'), dates: arr(DATE, {maxItems: 10, uniqueItems: true}),
  time_local: nul(LOCAL), reason: str(500), state: en('submitted', 'excused', 'unexcused', 'cancelled'), cancelled_dates: arr(DATE, {maxItems: 10}),
  submitted_by: ID, submitted_at: TS, reviewed_by: nul(ID), reviewed_at: nul(TS), review_note: nul(str(500)), request_id: nul(ID), history: HISTORY});
defs.question = obj({id: ID, type: en('text', 'choice', 'boolean', 'number'), label: str(300), options: arr(str(100), {minItems: 2, maxItems: 20}), required: BOOL}, ['options']);
const formContent = {title: str(), text: str(5000), questions: arr({$ref: 'seed.schema.json#/$defs/question'}, {maxItems: 30}), fee_cents: CENTS, event_date: nul(DATE)};
defs.form = obj({id: ID, school_id: ID, child_ids: arr(ID, {minItems: 1, uniqueItems: true}), kind: en('permission_slip', 'medication', 'medical_consent', 'information'),
  ...formContent, due_at: TS, version: {type: 'integer', minimum: 1},
  versions: arr(obj({version: {type: 'integer', minimum: 1}, at: TS, ...formContent, reason: nul(str(300)), event_id: nul(ID)}), {minItems: 1}),
  published_at: TS, history: HISTORY});
const ANSWER = {anyOf: [{type: 'string', maxLength: 2000}, {type: 'number'}, BOOL]};
defs.answers = {type: 'object', additionalProperties: ANSWER};
defs.form_response = obj({id: ID, form_id: ID, child_id: ID, by_person_id: ID, state: en('signed', 'declined', 'withdrawn', 'needs_review'),
  form_version: {type: 'integer', minimum: 1}, answers: {$ref: 'seed.schema.json#/$defs/answers'}, paid_cents: CENTS, payment_ids: arr(ID), answered_at: TS, history: HISTORY});
defs.lunch_account = obj({id: ID, child_id: ID, balance_cents: INT, low_balance_threshold_cents: CENTS, daily_limit_cents: nul(CENTS), low_balance_notified: BOOL});
defs.lunch_transaction = obj({id: ID, lunch_account_id: ID, child_id: ID, kind: en('purchase', 'refund', 'adjustment', 'topup'), amount_cents: INT,
  item: nul(str(120)), allergens: arr(ALLERGEN, {uniqueItems: true}), at: TS, payment_id: nul(ID), note: nul(str(300)), request_id: nul(ID), event_id: nul(ID)});
defs.menu_item = obj({id: ID, name: str(120), allergens: arr(ALLERGEN, {uniqueItems: true})});
defs.menu_day = obj({id: ID, school_id: ID, date: DATE, items: arr({$ref: 'seed.schema.json#/$defs/menu_item'}, {maxItems: 20})});
defs.payment_method = obj({id: ID, label: str(80), kind: en('card', 'bank_account'), last4: {type: 'string', pattern: '^\\d{4}$'},
  expiry_month: nul({type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$'}), status: en('active', 'declined')});
defs.payment = obj({id: ID, kind: en('form_fee', 'lunch_topup'), child_id: ID, amount_cents: {type: 'integer', minimum: 1, maximum: 10000000}, payment_method_id: ID,
  object_type: en('form_response', 'lunch_transaction'), object_id: ID, status: en('paid', 'refunded'), paid_at: TS, refunded_at: nul(TS),
  refund_reason: nul(str(80)), request_id: nul(ID)});
defs.notification = obj({id: ID, kind: en(...KINDS), at: TS, child_id: nul(ID), object_type: str(60), object_id: ID, title: str(300), body: str(5000),
  event_id: nul(ID), wire: nul({type: 'object'})});
defs.activity = obj({seq: {type: 'integer', minimum: 1}, at: TS, actor: en('agent', 'event'), action: str(80), child_id: nul(ID), object_id: ID,
  request_id: nul(ID), event_id: nul(ID), cause_seq: {type: 'integer', minimum: 1}}, ['cause_seq']);
defs.preferences = obj({email_notices: BOOL, default_payment_method_id: nul(ID)});
const list = (def, max = 5000) => arr({$ref: 'seed.schema.json#/$defs/' + def}, {maxItems: max});
const seed = {$schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Bellnote account seed',
  description: 'One guardian account in one district: district and school records plus the account history. Generated by scripts/build-contracts.cjs.',
  ...obj({account_id: ID, owner_person_id: ID, district: {$ref: 'seed.schema.json#/$defs/district'}, schools: list('school', 20), staff: list('staff', 200), people: list('person', 500),
    children: list('child', 10), guardian_links: list('guardian_link', 50), pickup_people: list('pickup_person', 200), restrictions: list('restriction', 50),
    dismissal_changes: list('dismissal_change'), attendance: list('attendance'), absence_reports: list('absence_report'), forms: list('form', 500),
    form_responses: list('form_response'), lunch_accounts: list('lunch_account', 10), lunch_transactions: list('lunch_transaction'), menu_days: list('menu_day', 2000),
    payment_methods: list('payment_method', 20), payments: list('payment'), notifications: list('notification'), activity: list('activity', 20000),
    preferences: {$ref: 'seed.schema.json#/$defs/preferences'}}),
  $defs: defs};

// ---- events ------------------------------------------------------------------------------------
const P = {};
P['attendance.marked'] = obj({child_id: ID, date: DATE, status: en('present', 'absent', 'late', 'left_early'), time_local: LOCAL, marked_by: ID}, ['time_local']);
P['absence.reviewed'] = obj({report_id: ID, decision: en('excused', 'unexcused'), reviewed_by: ID, note: str(500)}, ['note']);
P['form.published'] = obj({form_id: ID, school_id: ID, child_ids: arr(ID, {minItems: 1, uniqueItems: true}), kind: defs.form.properties.kind,
  title: str(), text: str(5000), questions: arr(defs.question, {maxItems: 30}), fee_cents: CENTS, event_date: nul(DATE), due_at: TS}, ['event_date']);
P['form.changed'] = obj({form_id: ID, change: obj({title: str(), text: str(5000), questions: arr(defs.question, {maxItems: 30}), fee_cents: CENTS,
  event_date: nul(DATE), due_at: TS}, ['title', 'text', 'questions', 'fee_cents', 'event_date', 'due_at']), reason: str(300)});
P['form.answered'] = obj({form_id: ID, child_id: ID, by_guardian_id: ID, action: en('sign', 'decline', 'withdraw'), form_version: {type: 'integer', minimum: 1},
  answers: {type: 'object', additionalProperties: ANSWER}}, ['form_version', 'answers']);
P['pickup.person_reviewed'] = obj({pickup_person_id: ID, decision: en('approve', 'deny', 'revoke'), reviewed_by: ID});
P['dismissal.recorded'] = obj({change_id: ID, child_id: ID, date: DATE, mode: MODE, person_id: nul(ID), recorded_by: ID, note: str(300)}, ['person_id', 'note']);
P['lunch.charged'] = obj({transaction_id: ID, child_id: ID, kind: en('purchase', 'refund', 'adjustment'), amount_cents: {type: 'integer', minimum: -10000000, maximum: 10000000},
  item: str(120), allergens: arr(ALLERGEN, {uniqueItems: true}), payment_id: ID, note: str(300)}, ['item', 'allergens', 'payment_id', 'note']);
P['school.day_changed'] = obj({school_id: ID, date: DATE, kind: en('closed', 'early_dismissal'), dismissal_local: LOCAL, reason: str(300)}, ['dismissal_local']);
const operations = Object.keys(P).map(k => 'bellnote.' + k);
const events = {$schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Bellnote incoming events',
  description: 'Events from the school office, the cafeteria and the other guardian, applied by Infra with env.apply_event. Generated by scripts/build-contracts.cjs.',
  type: 'object', properties: {event_id: ID, at: TS, operation: en(...operations), payload: {type: 'object'}}, required: ['event_id', 'at', 'operation', 'payload'],
  additionalProperties: false, anyOf: Object.entries(P).map(([k, payload]) => ({properties: {operation: {const: 'bellnote.' + k}, payload}}))};

// ---- tools ---------------------------------------------------------------------------------------
// Published MCP schemas must be self-contained: inline every $ref.
function inline(schema) {
  if (Array.isArray(schema)) return schema.map(inline);
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return inline(defs[schema.$ref.split('/').pop()]);
  return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, inline(v)]));
}
// A read view is a stored record plus derived fields: keep the record's typing, allow additions.
const view = (def, extra = {}) => { const s = inline(defs[def]); return {...s, properties: {...s.properties, ...extra}, additionalProperties: true}; };
const optional = (schema, keys) => ({...schema, required: schema.required.filter(k => !keys.includes(k))});
const any = (required = []) => ({type: 'object', required, additionalProperties: true});
const base = readOnly => ({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: 'bellnote'}, version: VERSION});
const WINDOW = {start: DATE, end: DATE};
const tools = [];
function tool(name, readOnly, description, input, output, optional = [], target = 'current account') {
  const inputSchema = readOnly ? obj(input, optional) : obj({...input, expected_version: VERSION, request_id: ID}, optional);
  const outputSchema = obj({...base(readOnly), ...output});
  tools.push({name: 'bellnote.' + name, description, read_only: readOnly, scope: 'bellnote.' + name, resource_target: target,
    inputSchema: inline(inputSchema), outputSchema: inline(outputSchema)});
}
tool('children.list', true, 'List the children on this account with school, grade, homeroom, meal restrictions, default way home (only for a child you are custodial for) and every guardian\'s rights for each child.',
  {}, {children: arr(optional(view('child', {school_name: str(), guardians: arr(any(['person_id', 'is_me', 'can_pickup', 'can_sign', 'can_pay', 'custodial']))}), ['default_dismissal']))});
tool('schools.get', true, 'Read one school: bell times, term, the effective policy (cut-off rules, pickup review, top-up range, meal debt limit) and, for start..end (dates, default today..+14), each calendar day with its kind, dismissal time and resolved cut-off instants.',
  {id: ID, ...WINDOW}, {school: any(['id', 'name', 'time_zone', 'bell', 'term', 'policy']), start: DATE, end: DATE, days: arr(any(['date', 'kind', 'school_day']))}, ['start', 'end'], 'school');
tool('attendance.list', true, 'Attendance records by day (status, explained/unexplained, the office\'s excused/unexcused) for one child (id) or all children, in start..end (default the last 14 days). A day with no mark has no record.',
  {id: ID, ...WINDOW}, {start: DATE, end: DATE, records: arr(view('attendance'))}, ['id', 'start', 'end'], 'child');
tool('absences.list', true, 'Absence, late-arrival and early-leave reports with their state (submitted, excused, unexcused, cancelled, or moot when every day became a closed day) and per-day cut-offs. Filter by report id, child_id or state.',
  {id: ID, child_id: ID, state: en('submitted', 'excused', 'unexcused', 'cancelled', 'moot')}, {reports: arr(view('absence_report', {state: str(20), days: arr(any(['date', 'closed', 'cutoff_passed']))}))}, ['id', 'child_id', 'state'], 'absence_report');
tool('forms.list', true, 'Forms addressed to the account\'s children with phase (closed once the due time passes; otherwise answered when every child in scope has a signed or declined answer, else open), fee, due time, version and each child\'s answer (unanswered, signed, declined, withdrawn, needs_review).',
  {child_id: ID, phase: en('open', 'answered', 'closed')}, {forms: arr(any(['id', 'title', 'phase', 'version', 'fee_cents', 'due_at', 'responses']))}, ['child_id', 'phase'], 'form');
tool('forms.get', true, 'Read one form: exact text, questions, fee, event date, due time, current version and version history, each addressed child\'s answer and your rights to sign and pay.',
  {id: ID}, {form: any(['id', 'title', 'text', 'questions', 'fee_cents', 'due_at', 'version', 'phase', 'versions', 'responses', 'my_rights'])}, [], 'form');
tool('pickup.get', true, 'Who may collect one child (id): guardians with can_pickup, standing pickup people by state, restrictions on file with the school office, the default way home, dismissal changes in start..end and the resulting plan per day. Requires your custodial right for the child.',
  {id: ID, ...WINDOW}, {child_id: ID, default_dismissal: str(20), start: DATE, end: DATE, guardians: arr(any(['person_id', 'display_name'])),
    pickup_people: arr(view('pickup_person')), restrictions: arr(any(['person_id', 'display_name', 'note'])),
    dismissal_changes: arr(view('dismissal_change', {status: str(20), phase: en('upcoming', 'past')})), days: arr(any(['date', 'kind', 'plan']))}, ['start', 'end'], 'child');
tool('lunch.account_get', true, 'Read one lunch account (id): balance, low-balance threshold, daily spending limit, the child\'s meal restrictions and the transactions in start..end, each with restricted_item and over_daily_limit computed at read time.',
  {id: ID, ...WINDOW}, {account: view('lunch_account', {meal_restrictions: arr(ALLERGEN), below_threshold: BOOL}), start: DATE, end: DATE,
    transactions: arr(view('lunch_transaction', {restricted_item: BOOL, over_daily_limit: BOOL, local_date: DATE}))}, ['start', 'end'], 'lunch_account');
tool('menu.list', true, 'The lunch menu per school day in start..end (default this week) for the account\'s schools or one school (id): items with allergen tags and excluded_for, the children whose restrictions exclude the item. A school day without a menu has menu_published false.',
  {id: ID, ...WINDOW}, {start: DATE, end: DATE, days: arr(any(['school_id', 'date', 'menu_published', 'items']))}, ['id', 'start', 'end'], 'school');
tool('payments.list', true, 'Payments (form fees and lunch top-ups) with status paid or refunded, paid in start..end (default the last 60 days), optionally for one child.',
  {child_id: ID, ...WINDOW}, {start: DATE, end: DATE, payments: arr(view('payment'))}, ['child_id', 'start', 'end'], 'payment');
tool('notifications.list', true, 'Notifications about what the school, the cafeteria or the other guardian did, in start..end (default the last 30 days), optionally of one kind.',
  {kind: en(...KINDS), ...WINDOW}, {start: DATE, end: DATE, notifications: arr(any(['id', 'kind', 'at', 'title', 'body', 'email_message_stored']))}, ['kind', 'start', 'end'], 'notification');
tool('preferences.get', true, 'Account preferences (email notices, default payment method) and payment methods with expired/usable computed from the clock.',
  {}, {preferences: inline(defs.preferences), payment_methods: arr(view('payment_method', {expired: BOOL, usable: BOOL}))});
const W = (more = {}) => ({id: ID, ...more});
tool('absences.report', false, 'Report an absence (one day or a range of up to 10 school days), a late arrival or an early leave (one day, with time_local) for child id, with a reason. Needs your custodial right and must be made before each day\'s absence cut-off.',
  W({kind: en('absent', 'late', 'early_leave'), start: DATE, end: DATE, time_local: LOCAL, reason: str(500)}), {id: ID, child_id: ID, state: {const: 'submitted'}, dates: arr(DATE), cutoff_at: TS}, ['end', 'time_local'], 'child');
tool('absences.cancel', false, 'Cancel a submitted report (id) for its days that have not passed their cut-off; days already past stay reported.',
  W(), {id: ID, state: en('submitted', 'cancelled'), cancelled_dates: arr(DATE), remaining_dates: arr(DATE)}, [], 'absence_report');
tool('forms.respond', false, 'Answer form id for child_id: sign with the required answers, or decline. form_version must be the current version shown by forms.get. Signing a form with a fee charges payment_method_id (or the default) once.',
  W({child_id: ID, action: en('sign', 'decline'), form_version: {type: 'integer', minimum: 1}, answers: {$ref: 'seed.schema.json#/$defs/answers'}, payment_method_id: ID}),
  {id: ID, form_id: ID, child_id: ID, state: en('signed', 'declined'), form_version: {type: 'integer', minimum: 1}, charged_cents: CENTS, payment_id: nul(ID), paid_cents: CENTS}, ['answers', 'payment_method_id'], 'form');
tool('forms.withdraw', false, 'Withdraw your own answer (form response id) while the form is open; a paid fee is refunded.',
  W(), {id: ID, state: {const: 'withdrawn'}, refunded_cents: CENTS}, [], 'form_response');
tool('pickup.person_add', false, 'Add a person who may collect child id (name, relationship, phone, or the person_id the school already holds). Needs your custodial right; a new person counts only once the office approves them where the district reviews additions.',
  W({name: str(120), relationship: str(60), phone: {type: 'string', pattern: '^[0-9+() .-]{7,20}$'}, person_id: ID}),
  {id: ID, child_id: ID, person_id: ID, person_record: en('created', 'existing'), state: en('pending_review', 'approved')}, ['person_id'], 'child');
tool('pickup.person_remove', false, 'Remove a pickup person (id) from a child\'s list. Refused while a dismissal change still ahead names them.',
  W(), {id: ID, state: {const: 'removed'}}, [], 'pickup_person');
tool('dismissal.set', false, 'Set how child id goes home on one school day (date): mode pickup with the person_id of an approved guardian or pickup person, or bus, after_care, walker. Replaces an earlier change for that day; must be made before that day\'s cut-off.',
  W({date: DATE, mode: MODE, person_id: ID, note: str(300)}), {id: ID, child_id: ID, date: DATE, state: {const: 'active'}, replaced_id: nul(ID), cutoff_at: TS}, ['person_id', 'note'], 'child');
tool('dismissal.cancel', false, 'Cancel an active dismissal change (id) before that day\'s cut-off; the child\'s default way home applies.',
  W(), {id: ID, state: {const: 'cancelled'}, default_dismissal: str(20)}, [], 'dismissal_change');
tool('lunch.topup', false, 'Top up lunch account id by amount_cents from payment_method_id (or the default). The amount must be inside the district\'s top-up range. A top-up is final in the portal.',
  W({amount_cents: {type: 'integer', minimum: 1, maximum: 10000000}, payment_method_id: ID}), {id: ID, transaction_id: ID, payment: inline(defs.payment), balance_cents: INT}, ['payment_method_id'], 'lunch_account');
tool('lunch.settings_update', false, 'Set the low-balance threshold and/or the daily spending limit (null clears it) of lunch account id.',
  W({low_balance_threshold_cents: INT, daily_limit_cents: nul(INT)}), {id: ID, low_balance_threshold_cents: CENTS, daily_limit_cents: nul(CENTS)}, ['low_balance_threshold_cents', 'daily_limit_cents'], 'lunch_account');
tool('preferences.update', false, 'Turn email notices on or off and set the default payment method.',
  {email_notices: BOOL, default_payment_method_id: nul(ID)}, {id: ID, preferences: inline(defs.preferences)}, ['email_notices', 'default_payment_method_id']);

// ---- state envelope ------------------------------------------------------------------------------
const tasksState = JSON.parse(fs.readFileSync(path.join(root, 'schemas/state.schema.json'), 'utf8'));
tasksState.properties.package_version = {const: app.version};
tasksState.properties.core_api_version = {const: app.core_api_version};
tasksState.properties.app_id = {const: app.app_id};

const outputs = {
  'tools.json': tools,
  'schemas/seed.schema.json': seed,
  'schemas/events.schema.json': events,
  'schemas/state.schema.json': tasksState
};
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(outputs)) {
    const text = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(file); }
    else fs.writeFileSync(target, text);
  }
  return drift;
}
module.exports = {build, operations, tools};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = build({check});
  if (drift.length) { console.error('Generated contract drift: ' + drift.join(', ')); process.exitCode = 1; }
  else console.log(check ? 'Bellnote contracts match their source.' : 'Bellnote contracts written.');
}
