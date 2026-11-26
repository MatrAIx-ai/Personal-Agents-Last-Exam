'use strict';
// Writes schemas/seed.schema.json, schemas/events.schema.json and tools.json from one set of record shapes.
// Run `node dev/build.cjs` after a change, or `node dev/build.cjs --check` to compare with the committed files.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'payleaf';

const obj = (properties, optional = []) => ({type: 'object', properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false});
const arr = (items, extra = {}) => ({type: 'array', items, ...extra});
const nullable = schema => ({anyOf: [{type: 'null'}, schema]});
const en = (...values) => ({enum: values});
const text = (max = 2000) => ({type: 'string', minLength: 1, maxLength: max});
const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
// A stored or given time or day has a year from 1970 to 2999. `now` is the clock that Core supplies, so it has no such bound.
const TIME = {type: 'string', format: 'date-time', pattern: '^(19[7-9]\\d|2\\d{3})-'};
const NOW = {type: 'string', format: 'date-time'};
const DAY = {type: 'string', pattern: '^(19[7-9]\\d|2\\d{3})-\\d{2}-\\d{2}$'};
// A day that the App computes from a stored day can fall after 2999.
const COMPUTED_DAY = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const MONTH_DAY = {type: 'string', pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$'};
const YEAR = {type: 'integer', minimum: 1970, maximum: 2999};
const AMOUNT = {type: 'number', minimum: 0, maximum: 100000000};
const POSITIVE = {type: 'number', minimum: 0.01, maximum: 100000000};
// A sum or a part of a sum that the App computes has no upper bound.
const SUM = {type: 'number', minimum: 0};
const PART = {type: 'number', minimum: 0.01};
const PERCENT = {type: 'number', minimum: 0, maximum: 100};
const SHARE = {type: 'number', minimum: 0.1, maximum: 100};
const DAY_HOURS = {type: 'number', minimum: 0.1, maximum: 8};
const HOURS = {type: 'number', minimum: -100000, maximum: 100000};
// Hours that the App computes: a balance can be below zero only in a seed that holds such history.
const COMPUTED_HOURS = {type: 'number'};
const LAST4 = {type: 'string', pattern: '^\\d{4}$'};
const BOOL = {type: 'boolean'};
const COUNT = {type: 'integer', minimum: 0};
const DAYS = {type: 'integer', minimum: 0, maximum: 366};

const SETTING = en('deposit', 'withholding', 'retirement');
const CHANGE_STATE = en('waiting', 'replaced', 'cancelled', 'locked', 'applied');
const LEAVE_STATE = en('pending', 'approved', 'denied', 'cancelled', 'taken', 'lapsed');
const INQUIRY_STATE = en('open', 'withdrawn', 'answered');
const EARNING_KIND = en('salary', 'reimbursement', 'bonus', 'other');
const LEAVE_REASON = en('accrual', 'carryover', 'forfeited', 'correction', 'grant');
const KINDS = en('payroll.run_posted', 'calendar.changed', 'deposit.updated', 'inquiry.answered', 'leave.decided', 'leave.adjusted', 'enrollment.opened');
const OBJECT_TYPES = en('pay_statement', 'pay_date', 'deposit', 'inquiry', 'leave_request', 'leave_balance', 'enrollment_window');
const ERRORS = en('invalid_window', 'too_late', 'conflict', 'insufficient_balance');
const ACCOUNT_FLAGS = arr(en('change_waiting', 'deposit_returned', 'leave_expiring', 'enrollment_open', 'will_default'), {uniqueItems: true});
const STATEMENT_FLAGS = arr(en('short_deposit', 'deductions_cut'), {uniqueItems: true});
const REQUEST_FLAGS = arr(en('lapsing'), {uniqueItems: true});

// Stored records.
const bank = {label: text(100), kind: en('checking', 'savings'), last4: LAST4};
// A deposit account takes a fixed amount, a percentage or the remainder.
const ACCOUNT = {oneOf: [obj({...bank, amount: POSITIVE}), obj({...bank, percent: SHARE}), obj({...bank, remainder: {const: true}})]};
const DEPOSIT = obj({accounts: arr(ACCOUNT, {minItems: 1, maxItems: 10})});
const WITHHOLDING = obj({filing_status: en('single', 'married_jointly', 'head_of_household'), multiple_jobs: BOOL,
  dependents_amount: AMOUNT, other_income: AMOUNT, deductions: AMOUNT, extra_withholding: AMOUNT});
const RETIREMENT = obj({percent: PERCENT});
const settings = {deposit: DEPOSIT, withholding: WITHHOLDING, retirement: RETIREMENT};
const history = obj({at: TIME, action: text(80), actor: en('agent', 'event'), ref: ID});
const dates = obj({pay_date: DAY, cutoff_at: TIME});
const entry = {id: ID, period_start: DAY, period_end: DAY, pay_date: DAY, cutoff_at: TIME, state: en('planned', 'paid'), statement_id: nullable(ID),
  history: arr(obj({at: TIME, action: en('added', 'moved', 'paid'), event_id: ID, from: nullable(dates), to: nullable(dates), reason: nullable(text(500))}))};
const earning = obj({line_id: ID, kind: EARNING_KIND, text: text(200), amount: POSITIVE, inquiry_id: nullable(ID)});
const tax = obj({line_id: ID, text: text(200), amount: POSITIVE});
const deduction = obj({line_id: ID, kind: en('benefit', 'retirement'), plan_id: nullable(ID), option_id: nullable(ID), text: text(300), due: PART, amount: SUM});
const deposit = obj({id: ID, account: obj(bank), amount: PART, state: en('sent', 'returned', 'reissued'),
  history: arr(obj({at: TIME, state: en('sent', 'returned', 'reissued'), reason: nullable(text(500)), event_id: ID})),
  reissued_to: nullable(obj({kind: en('account', 'check'), label: text(100), last4: nullable(LAST4)}))});
const statement = {id: ID, entry_id: ID, pay_date: DAY, period_start: DAY, period_end: DAY, posted_at: TIME, event_id: nullable(ID),
  earnings: arr(earning, {maxItems: 50}), taxes: arr(tax, {maxItems: 50}), deductions: arr(deduction),
  net_pay: SUM, settings_used: obj({...settings, election_set_id: nullable(ID), change_ids: arr(ID, {uniqueItems: true, maxItems: 3})}), deposits: arr(deposit, {maxItems: 10})};
const change = {id: ID, setting: SETTING, value: {anyOf: [DEPOSIT, WITHHOLDING, RETIREMENT]}, made_at: TIME, request_id: ID,
  stored_state: nullable(en('cancelled', 'replaced', 'applied')), entry_id: nullable(ID), cancelled_at: nullable(TIME), history: arr(history)};
const answer = obj({outcome: en('corrected', 'no_change'), correction_amount: nullable(POSITIVE), answered_by: text(200), note: nullable(text()), answered_at: TIME, event_id: ID});
const inquiry = obj({id: ID, statement_id: ID, line_id: nullable(ID), amount: POSITIVE, note: text(), opened_at: TIME, request_id: ID, state: INQUIRY_STATE,
  withdrawn_at: nullable(TIME), answer: nullable(answer)});
const leaveType = obj({id: ID, name: text(80), needs_notice: BOOL, accrual_per_period: {type: 'number', minimum: 0, maximum: 80},
  carryover_cap: nullable({type: 'number', minimum: 0, maximum: 10000}), carryover_date: nullable(MONTH_DAY)});
const leaveEntry = obj({id: ID, leave_type_id: ID, at: TIME, hours: HOURS, reason: LEAVE_REASON, note: nullable(text()), statement_id: nullable(ID), event_id: nullable(ID)});
const request = {id: ID, leave_type_id: ID, start: DAY, end: DAY, hours_per_day: DAY_HOURS, days: arr(DAY), hours: {type: 'number', minimum: 0.1},
  note: nullable(text()), requested_at: TIME, request_id: ID, decided_at: nullable(TIME), decided_by: nullable(ID), decision_note: nullable(text()),
  cancelled_at: nullable(TIME), cancel_reason: nullable(text())};
const CHOICE = {oneOf: [obj({option_id: ID}), obj({yearly_amount: POSITIVE}), obj({no_coverage: {const: true}})]};
const choices = arr(obj({plan_id: ID, choice: CHOICE}), {maxItems: 20});
const plan = {id: ID, name: text(120), kind: en('options', 'yearly_amount'), rolls_over: BOOL,
  options: arr(obj({id: ID, name: text(120), per_pay_cost: AMOUNT}), {maxItems: 20}), yearly_max: nullable(POSITIVE)};
const save = obj({plan_id: ID, choice: CHOICE, saved_at: TIME, request_id: ID});
const window = obj({id: ID, plan_year: YEAR, opens_at: TIME, closes_at: TIME, plan_ids: arr(ID, {maxItems: 20}), saved: arr(save), set_id: nullable(ID), event_id: nullable(ID)});
const setHistory = arr(obj({at: TIME, choices, request_id: nullable(ID)}));
const electionSet = obj({id: ID, window_id: nullable(ID), plan_year: YEAR, choices, submitted_at: TIME, request_id: nullable(ID), history: setHistory});
const preferences = obj({timezone: text(64), email_notices: BOOL});
const wire = {type: 'object'};
const notification = obj({id: ID, at: TIME, kind: KINDS, event_id: ID, object_type: OBJECT_TYPES, object_id: ID, title: text(200), text: text(4000), email: nullable(wire)});
const activity = obj({seq: {type: 'integer', minimum: 1}, at: TIME, actor: en('agent', 'event'), action: text(80), object_id: ID,
  request_id: nullable(ID), event_id: nullable(ID), effect: BOOL});
const rules = obj({leave_notice_days: DAYS, sick_backdate_days: DAYS, inquiry_window_days: {type: 'integer', minimum: 1, maximum: 366},
  max_retirement_percent: PERCENT, pay_periods_per_year: {type: 'integer', minimum: 1, maximum: 53}});
const employer = obj({name: text(200), timezone: text(64), rules, holidays: arr(DAY, {uniqueItems: true, maxItems: 400})});
const employment = obj({employee_number: text(40), name: text(200), job_title: text(200), department: text(200), start_date: DAY, pay_type: {const: 'salary'},
  annual_salary: POSITIVE, manager: obj({person_id: ID, name: text(200), job_title: text(200)})});
const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:payleaf:seed:1', ...obj({
    account_id: ID, owner_person_id: ID, employer, employment, preferences, settings: obj(settings),
    // A list that calls or events can grow has no upper bound.
    calendar: arr(obj(entry)), statements: arr(obj(statement)), changes: arr(obj(change)), inquiries: arr(inquiry),
    leave_types: arr(leaveType, {maxItems: 10}), leave_entries: arr(leaveEntry),
    leave_requests: arr(obj({...request, stored_state: en('pending', 'approved', 'denied', 'cancelled')})),
    plans: arr(obj(plan), {maxItems: 20}), windows: arr(window), election_sets: arr(electionSet),
    notifications: arr(notification), activity: arr(activity)
  })
};

// Views: stored records plus the values the App computes from the clock when it is read.
const target = nullable(obj({entry_id: ID, pay_date: DAY, cutoff_at: TIME}));
const entryView = obj({...entry, cutoff_passed: BOOL});
const totals = {earnings_total: SUM, taxes_total: SUM, deductions_total: SUM, flags: STATEMENT_FLAGS};
const statementRow = obj({id: ID, entry_id: ID, pay_date: DAY, period_start: DAY, period_end: DAY, posted_at: TIME, net_pay: SUM, ...totals});
const statementView = obj({...statement, ...totals, last_inquiry_day: COMPUTED_DAY});
const changeOf = (setting, value) => obj({id: ID, setting, value, made_at: TIME, request_id: ID, state: CHANGE_STATE, applies_to: target,
  cancelled_at: nullable(TIME), history: arr(history)});
const changeView = changeOf(SETTING, change.value);
const settingView = (name, value) => obj({in_use: value, waiting: nullable(changeOf({const: name}, value)), locked: nullable(changeOf({const: name}, value))});
const balanceRow = obj({leave_type_id: ID, name: text(80), needs_notice: BOOL, accrual_per_period: leaveType.properties.accrual_per_period,
  carryover_cap: leaveType.properties.carryover_cap, carryover_date: nullable(MONTH_DAY), balance: COMPUTED_HOURS, pending_hours: COMPUTED_HOURS,
  approved_hours: COMPUTED_HOURS, available: COMPUTED_HOURS, expiring: COMPUTED_HOURS, next_carryover_date: nullable(COMPUTED_DAY), entries: arr(leaveEntry)});
const requestView = obj({...request, state: LEAVE_STATE, flags: REQUEST_FLAGS});
const windowState = en('upcoming', 'open', 'closed');
const setView = nullable(obj({id: nullable(ID), state: en('submitted', 'final', 'defaulted'), submitted_at: nullable(TIME), request_id: nullable(ID), choices, history: setHistory}));
const windowRow = obj({id: ID, plan_year: YEAR, state: windowState, opens_at: TIME, closes_at: TIME, plan_ids: arr(ID), set_id: nullable(ID),
  set_state: nullable(en('submitted', 'final', 'defaulted'))});
const windowView = obj({id: ID, plan_year: YEAR, state: windowState, opens_at: TIME, closes_at: TIME, event_id: nullable(ID),
  plans: arr(obj({...plan, in_force: CHOICE, saved: nullable(CHOICE)})), saves: arr(save), set: setView});
const noticeRow = obj({id: ID, at: TIME, kind: KINDS, event_id: ID, object_type: OBJECT_TYPES, object_id: ID, title: text(200), text: text(4000), email_stored: BOOL});

// Tools.
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const REQUEST = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const tools = [];
function tool(name, description, readOnly, input, optional, output, extra = {}) {
  const inputSchema = {...(readOnly ? obj(input, optional) : obj({...input, expected_version: VERSION, request_id: REQUEST}, optional)), ...extra};
  const outputSchema = obj({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: APP}, version: VERSION,
    ...output, ...(readOnly ? {now: NOW} : {})});
  tools.push({name: APP + '.' + name, description, read_only: readOnly, scope: APP + '.' + name, resource_target: 'current account', inputSchema, outputSchema});
}
const read = (name, description, input, optional, output) => tool(name, description, true, input, optional, output);
const write = (name, description, input, optional, output = {id: ID}, extra) => tool(name, description, false, input, optional, output, extra);
const RANGE = {start: DAY, end: DAY};
const changed = {id: ID, state: CHANGE_STATE, applies_to: target};

read('employment.get', 'Read the employment record, the employer with its rules and company holidays, and the account flags. Every read returns the current virtual time as `now`, with the employer\'s UTC offset.',
  {}, [], {account_id: ID, employment, employer, flags: ACCOUNT_FLAGS});
read('calendar.list', 'List pay calendar entries with a pay date in a window of days (`start` to `end`, both included). Each entry has its pay period, pay date, cut-off and state. A setting change made before the cut-off reaches that run.',
  RANGE, ['start', 'end'], {items: arr(entryView)});
read('pay_statements.list', 'List pay statements with a pay date in a window of days (`start` to `end`, both included), with their totals and flags.',
  RANGE, ['start', 'end'], {items: arr(statementRow)});
read('pay_statements.get', 'Read one pay statement with its earnings, taxes, deductions, deposits, the settings it used, its flags and the last day to ask payroll about it.',
  {id: ID}, [], {statement: statementView});
read('settings.get', 'Read the three pay settings: the deposit setup, the withholding form and the retirement percentage. Each one shows the value the last run used, and any change that is waiting or locked. `next_change_applies_to` is the pay run that a change made now would first apply to.',
  {}, [], {settings: obj({deposit: settingView('deposit', DEPOSIT), withholding: settingView('withholding', WITHHOLDING), retirement: settingView('retirement', RETIREMENT)}), next_change_applies_to: target});
read('changes.list', 'List setting changes by setting and state, made on a day in a window (`start` to `end`, both included). Each change shows the pay run it applies to.',
  {setting: SETTING, state: CHANGE_STATE, ...RANGE}, ['setting', 'state', 'start', 'end'], {items: arr(changeView)});
read('inquiries.list', 'List pay inquiries by state, for one pay statement or for all. `id` is a pay statement.',
  {id: ID, state: INQUIRY_STATE}, ['id', 'state'], {items: arr(inquiry)});
read('leave.balances', 'Read the leave balance of each leave type: the balance, the hours held by pending and approved requests, what is available, what will expire at the carryover date, and the entries behind the balance.',
  {}, [], {items: arr(balanceRow)});
read('leave.list', 'List leave requests by leave type and state, with a range that overlaps a window of days (`start` to `end`, both included). `id` is a leave type.',
  {id: ID, state: LEAVE_STATE, ...RANGE}, ['id', 'state', 'start', 'end'], {items: arr(requestView)});
read('leave.preview', 'Check a leave request in advance. Writes nothing. `id` is the leave type, and `start` and `end` are the first and last day. Hours have at most one decimal. Returns the working days, the hours, the hours available before and after, and every rule that the request would break.',
  {id: ID, ...RANGE, hours_per_day: DAY_HOURS}, [], {leave_type_id: ID, start: DAY, end: DAY, hours_per_day: DAY_HOURS, days: arr(DAY), working_days: COUNT,
    hours: COMPUTED_HOURS, available_before: COMPUTED_HOURS, available_after: COMPUTED_HOURS, allowed: BOOL, failures: arr(obj({code: ERRORS, message: text()}))});
read('benefits.windows', 'List the benefits enrollment windows with their state and the state of their election set.', {}, [], {items: arr(windowRow)});
read('benefits.get', 'Read one enrollment window: its plans with their options, the choice in force in the year before the plan year (`in_force`), the saved choice of each plan, every save, and the submitted, final or defaulted election set.',
  {id: ID}, [], {window: windowView});
read('notifications.list', 'List notifications written on a day in a window (`start` to `end`, both included). `email_stored` means the App stored an email message for the Infra sender. It does not mean that Mail received it.', RANGE, ['start', 'end'], {items: arr(noticeRow)});
read('preferences.get', 'Read the notification preferences of the account.', {}, [], {preferences});

write('deposit.update', 'Replace the deposit setup: up to three accounts, with fixed amounts, percentages, and exactly one account that takes the remainder. Amounts have at most two decimals, and percentages at most one. `id` is the account. The change applies to the planned run with the earliest cut-off after now. Returns the change with its state and the run it applies to.',
  {id: ID, accounts: arr(ACCOUNT, {minItems: 1, maxItems: 10})}, [], changed);
write('withholding.update', 'Replace the withholding form. Payleaf stores the form and computes no tax. `id` is the account. Returns the change with its state and the run it applies to.',
  {id: ID, form: WITHHOLDING}, [], changed);
write('retirement.set', 'Set the retirement percentage of salary, up to the employer maximum, with at most one decimal. 0 stops saving. `id` is the account. Returns the change with its state and the run it applies to.',
  {id: ID, percent: PERCENT}, [], changed);
write('changes.cancel', 'Cancel a waiting setting change before the cut-off of its run. An older change of the same setting for the same run then applies again.', {id: ID}, []);
write('inquiries.open', 'Ask payroll about a pay statement or one of its lines, with an amount and a note. `id` is the pay statement. Without `line_id` the question is about the whole statement. Returns the `id` of the new inquiry.',
  {id: ID, line_id: ID, amount: POSITIVE, note: text()}, ['line_id']);
write('inquiries.withdraw', 'Withdraw an open pay inquiry. An inquiry is not edited: withdraw it and ask again.', {id: ID}, []);
write('leave.request', 'Ask for leave of one type, from a first day (`start`) to a last day (`end`), with the hours for each working day (at most one decimal). `id` is the leave type. Returns the `id` of the new request.',
  {id: ID, ...RANGE, hours_per_day: DAY_HOURS, note: text()}, ['note'], {id: ID, state: {const: 'pending'}, hours: {type: 'number', minimum: 0.1}});
write('leave.cancel', 'Cancel a pending leave request, or approved leave before its first day.', {id: ID, reason: text()}, ['reason']);
write('benefits.elect', 'Save one choice for a plan in an open enrollment window: `option_id`, `yearly_amount` for a plan that takes one, or `no_coverage`. Give exactly one of them. `id` is the window. A saved choice changes nothing in force. A submitted set comes into force when the window closes.',
  {id: ID, plan_id: ID, option_id: ID, yearly_amount: POSITIVE, no_coverage: {const: true}}, ['option_id', 'yearly_amount', 'no_coverage'], {id: ID},
  {oneOf: [{required: ['option_id']}, {required: ['yearly_amount']}, {required: ['no_coverage']}]});
write('benefits.submit', 'Submit the saved choices of an open enrollment window as the election set. Every plan of the window needs a saved choice. A submitted set can be changed and submitted again until the window closes. `id` is the window.',
  {id: ID}, [], {id: ID, state: {const: 'submitted'}});
write('preferences.update', 'Set the time zone used in notification text, or `email_notices`. Give at least one of them.',
  {timezone: text(64), email_notices: BOOL}, ['timezone', 'email_notices']);

// Events: structure only. The handler checks the rules and answers `invalid_event`.
const NUMBER = {type: 'number'};
const payloads = {
  'payroll.run_posted': obj({entry_id: ID, statement_id: ID,
    earnings: arr(obj({line_id: ID, kind: EARNING_KIND, text: text(200), amount: NUMBER, inquiry_id: ID}, ['inquiry_id']), {maxItems: 50}),
    taxes: arr(obj({line_id: ID, text: text(200), amount: NUMBER}), {maxItems: 50})}),
  'calendar.changed': obj({entry_id: ID, period_start: DAY, period_end: DAY, pay_date: DAY, cutoff_at: TIME, reason: text(500)},
    ['period_start', 'period_end', 'pay_date', 'cutoff_at', 'reason']),
  'deposit.updated': obj({deposit_id: ID, state: en('sent', 'returned', 'reissued'), reason: text(500),
    reissued_to: obj({kind: en('account', 'check'), label: text(100), last4: LAST4}, ['last4'])}, ['reason', 'reissued_to']),
  'inquiry.answered': obj({inquiry_id: ID, outcome: en('corrected', 'no_change'), correction_amount: NUMBER, answered_by: text(200), note: text()},
    ['correction_amount', 'note']),
  'leave.decided': obj({leave_request_id: ID, decision: en('approve', 'deny'), decided_by: ID, note: text()}, ['note']),
  'leave.adjusted': obj({entry_id: ID, leave_type_id: ID, hours: NUMBER, reason: en('carryover', 'forfeited', 'correction', 'grant'), note: text()}, ['note']),
  'enrollment.opened': obj({window_id: ID, plan_year: YEAR, opens_at: TIME, closes_at: TIME, plan_ids: arr(ID, {maxItems: 20})})
};
const eventId = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const events = {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:payleaf:events:1',
  oneOf: Object.entries(payloads).map(([name, payload]) => obj({event_id: eventId, at: TIME, operation: {const: APP + '.' + name}, payload}))};

const files = {
  'schemas/seed.schema.json': seed,
  'schemas/events.schema.json': events,
  'tools.json': tools
};
const check = process.argv.includes('--check');
for (const [file, value] of Object.entries(files)) {
  const expected = JSON.stringify(value, null, 2) + '\n';
  const target = path.join(root, file);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) {
      console.error('Generated file is out of date: ' + file);
      process.exitCode = 1;
    }
  } else fs.writeFileSync(target, expected);
}
if (!process.exitCode) console.log((check ? 'Checked ' : 'Wrote ') + Object.keys(files).join(', ') + ' (' + tools.length + ' tools, ' + Object.keys(payloads).length + ' events).');
module.exports = {eventTypes: Object.keys(payloads).map(name => APP + '.' + name)};
