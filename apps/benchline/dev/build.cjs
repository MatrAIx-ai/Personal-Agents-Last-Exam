'use strict';
// Writes schemas/seed.schema.json, schemas/events.schema.json and tools.json from one set of record shapes.
// Run `node dev/build.cjs` after a change, or `node dev/build.cjs --check` to compare with the committed files.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'benchline';

const obj = (properties, optional = []) => ({type: 'object', properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false});
const arr = (items, extra = {}) => ({type: 'array', items, ...extra});
const nullable = schema => ({anyOf: [{type: 'null'}, schema]});
const en = (...values) => ({enum: values});
const text = (max = 2000) => ({type: 'string', minLength: 1, maxLength: max});
const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
// A stored or given time has a year from 1970 to 2999. `now` is the clock that Core supplies, so it has no such bound.
const TIME = {type: 'string', format: 'date-time', pattern: '^(19[7-9]\\d|2\\d{3})-'};
const NOW = {type: 'string', format: 'date-time'};
const DAY = {type: 'string', pattern: '^(19[7-9]\\d|2\\d{3})-\\d{2}-\\d{2}$'};
// GPU-hours have at most two decimals. The App checks the decimals and answers invalid_arguments, invalid_seed or invalid_event.
const HOURS = {type: 'number', minimum: 0, maximum: 10000000};
const LIMIT = {type: 'number', minimum: 0.01, maximum: 720};
const RATE = {type: 'number', minimum: 0, maximum: 100};
// Sums and differences that the App computes have no bound.
const SUM = {type: 'number'};
const GPUS = {type: 'integer', minimum: 1, maximum: 64};
const SEED = {type: 'integer', minimum: 0, maximum: 1000000};
const MINUTES = {type: 'integer', minimum: 0, maximum: 525600};
const COUNT = {type: 'integer', minimum: 0};
const BOOL = {type: 'boolean'};
const METRIC_VALUE = {type: 'number'};
// Metric names are checked by the App: a seed, an event or a plan with a bad name or no metric is refused.
const metrics = {type: 'object', additionalProperties: METRIC_VALUE};
const metricSpec = obj({name: {type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$'}, direction: en('higher', 'lower')});
const METRICS = arr(metricSpec, {minItems: 1, maxItems: 20});
const SEEDS = arr(SEED, {minItems: 1, maxItems: 50});
const params = {type: 'object', additionalProperties: {anyOf: [{type: 'string', maxLength: 200}, {type: 'number'}, {type: 'boolean'}, {type: 'null'}]}};

const JOB_STATE = en('queued', 'running', 'completed', 'failed', 'timed_out', 'held', 'cancelled', 'interrupted');
const STORED_JOB = en('queued', 'held', 'cancelled', 'interrupted');
const END_KIND = en('completed', 'failed', 'timed_out');
const HOLD = en('submitted_held', 'allocation', 'agent');
const BY = en('agent', 'script', 'labmate');
const PROTOCOL_STATE = en('proposed', 'signed', 'superseded', 'declined', 'withdrawn', 'expired');
const STORED_PROTOCOL = en('proposed', 'signed', 'superseded', 'declined', 'withdrawn');
const TABLE_STATE = en('draft', 'frozen', 'superseded', 'discarded');
const RESULT_STATE = en('candidate', 'excluded');
const ANSWER = en('sign', 'decline');
const ERRORS = en('time_limit_too_long', 'protocol_mismatch', 'too_many_active', 'over_allocation', 'over_share');
const NOTICE_KINDS = en('allocation.changed', 'job.ended', 'job.interrupted', 'job.submission_rejected', 'protocol.proposed', 'protocol.updated', 'result.invalidated');
const OBJECT_TYPES = en('allocation', 'job', 'config', 'protocol', 'result');
const JOB_FLAGS = arr(en('over_share', 'unfunded', 'protocol_unsigned', 'protocol_superseded'), {uniqueItems: true});
const RESULT_FLAGS = arr(en('protocol_unsigned', 'protocol_superseded', 'invalidated'), {uniqueItems: true});
const TABLE_FLAGS = arr(en('empty_table', 'incomplete_seeds', 'cites_excluded', 'cites_invalidated', 'protocol_unsigned', 'protocol_superseded'), {uniqueItems: true});
const ESTIMATE_FLAGS = arr(en('over_share', 'protocol_unsigned', 'protocol_superseded'), {uniqueItems: true});

// Stored records.
const ACTOR = en('agent', 'event');
const history = (extra = {}) => arr(obj({at: TIME, action: text(80), actor: ACTOR, ref: ID, ...extra}, Object.keys(extra)));
const policy = obj({hard_shares: BOOL, max_active_jobs: {type: 'integer', minimum: 1, maximum: 100}, required_signers: arr(ID, {maxItems: 20}),
  signoff_window_days: {type: 'integer', minimum: 1, maximum: 365}});
const project = obj({id: ID, name: text(200), cluster: text(200), timezone: text(64), lab_head_person_id: ID, policy});
const partition = obj({id: ID, name: text(120), rate: RATE, max_hours: LIMIT});
const personRecord = obj({person_id: ID, name: text(120), role: text(120), share_hours: nullable(HOURS)});
const share = obj({person_id: ID, share_hours: nullable(HOURS)});
const period = {period_id: ID, label: text(80), starts_at: TIME, ends_at: TIME, opening_hours: HOURS, allocation_hours: HOURS};
const allocation = obj({...period, opening_shares: arr(share, {maxItems: 200})});
const change = obj({id: ID, period_id: ID, at: TIME, from_hours: HOURS, to_hours: HOURS, shares: arr(obj({person_id: ID, from: nullable(HOURS), to: nullable(HOURS)})),
  changed_by: ID, reason: nullable(text(1000)), event_id: ID});
const config = obj({id: ID, family: text(80), version: {type: 'integer', minimum: 1, maximum: 100000}, params, dataset_version: text(120), eval_split: text(120),
  code_ref: text(120), registered_by: ID, registered_at: TIME, event_id: nullable(ID)});
const signoff = obj({person_id: ID, answer: ANSWER, at: TIME, note: nullable(text(1000)), request_id: nullable(ID), event_id: nullable(ID)});
const protocolBase = {id: ID, line: ID, version: {type: 'integer', minimum: 1, maximum: 100000}, dataset_version: text(120), eval_split: text(120), metrics: METRICS,
  seeds: SEEDS, proposed_by: ID, proposed_at: TIME, rationale: nullable(text(2000)), respond_by: TIME, signoffs: arr(signoff), signed_at: nullable(TIME),
  supersedes: nullable(ID), superseded_at: nullable(TIME), superseded_by: nullable(ID), declined_at: nullable(TIME), withdrawn_at: nullable(TIME),
  withdraw_note: nullable(text(1000)), request_id: nullable(ID), event_id: nullable(ID), history: history({answer: ANSWER})};
const runPlan = obj({id: ID, config_id: ID, seed: nullable(SEED), partition_id: nullable(ID), queue_wait_minutes: MINUTES, run_minutes: MINUTES,
  outcome: en('completed', 'failed'), metrics: nullable(metrics), error: nullable(text(1000)), set_at: TIME, event_id: nullable(ID)});
const run = nullable(obj({plan_id: nullable(ID), starts_at: TIME, ends_at: TIME, end_kind: END_KIND, metrics: nullable(metrics), error: nullable(text(1000))}));
const review = nullable(obj({tags: arr(text(60), {maxItems: 50}), note: nullable(text(2000)), excluded: BOOL, reason: nullable(text(1000)), updated_at: TIME}));
const invalidation = obj({by: ID, at: TIME, reason: nullable(text(1000)), event_id: ID});
const jobBase = {id: ID, owner_person_id: ID, submitted_by: BY, script: nullable(text(200)), config_id: ID, seed: SEED, partition_id: ID, gpus: GPUS,
  time_limit_hours: LIMIT, protocol_id: nullable(ID), period_id: ID, submitted_at: TIME};
const job = obj({...jobBase, stored_state: STORED_JOB, hold_reason: nullable(HOLD), run, cancelled_at: nullable(TIME), interrupted_at: nullable(TIME),
  interrupt_reason: nullable(text(1000)), review, invalidation: nullable(invalidation), request_id: nullable(ID), event_id: nullable(ID),
  history: history({state: JOB_STATE, disposition: RESULT_STATE})});
const row = obj({name: text(200), result_ids: arr(ID, {minItems: 1, maxItems: 50})});
const stat = obj({count: COUNT, mean: nullable(METRIC_VALUE), sd: nullable(METRIC_VALUE)});
const manifestRow = obj({name: text(200), config_id: ID, seeds: arr(SEED), result_ids: arr(ID), metrics: {type: 'object', additionalProperties: stat}});
const manifest = obj({table_id: ID, version: {type: 'integer', minimum: 1}, title: text(200), protocol_id: ID, metrics: METRICS, rows: arr(manifestRow), frozen_at: TIME,
  content_hash: {type: 'string', pattern: '^sha256:[0-9a-f]{64}$'}});
const tableBase = {id: ID, table_id: ID, version: {type: 'integer', minimum: 1, maximum: 100000}, title: text(200), protocol_id: ID, rows: arr(row, {maxItems: 200}),
  created_at: TIME, frozen_at: nullable(TIME), superseded_at: nullable(TIME), discarded_at: nullable(TIME), revises: nullable(ID), manifest: nullable(manifest),
  request_id: nullable(ID), history: history({rows: COUNT, from: ID})};
const table = obj({...tableBase, stored_state: TABLE_STATE});
const preferences = obj({timezone: text(64), email_notices: BOOL, job_end_notices: BOOL});
const rejected = obj({script: text(200), config_id: ID, seed: SEED, partition_id: ID, gpus: GPUS, time_limit_hours: LIMIT, protocol_id: nullable(ID), hold: BOOL, error: ERRORS});
const wire = {type: 'object'};
const notification = obj({id: ID, at: TIME, kind: NOTICE_KINDS, event_id: nullable(ID), request_id: nullable(ID), object_type: OBJECT_TYPES, object_id: ID,
  title: text(200), text: text(4000), details: nullable(rejected), email: nullable(wire), removed_at: nullable(TIME)});
const activity = obj({seq: {type: 'integer', minimum: 1}, at: TIME, actor: ACTOR, action: text(80), object_id: ID,
  request_id: nullable(ID), event_id: nullable(ID), effect: BOOL});
const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:benchline:seed:1', ...obj({
    account_id: ID, owner_person_id: ID, project, partitions: arr(partition, {minItems: 1, maxItems: 50}), people: arr(personRecord, {minItems: 1, maxItems: 200}),
    allocation, past_periods: arr(obj(period), {maxItems: 400}),
    // A list that calls or events can grow has no upper bound.
    allocation_changes: arr(change), configs: arr(config), protocols: arr(obj({...protocolBase, stored_state: STORED_PROTOCOL})), run_plans: arr(runPlan),
    jobs: arr(job), tables: arr(table), preferences, notifications: arr(notification), activity: arr(activity)
  })
};

// Views: stored records plus the values the App computes from the clock when it is read. Run plans are never shown.
const block = {used: SUM, reserved: SUM, remaining: SUM, overdrawn_hours: SUM};
const periodView = obj({period_id: ID, label: text(80), starts_at: TIME, ends_at: TIME});
const usageView = obj({period: periodView, allocation_hours: HOURS, hard_shares: BOOL, ...block,
  shares: arr(obj({person_id: ID, name: text(120), share_hours: HOURS, ...block}))});
const jobView = obj({...jobBase, state: JOB_STATE, hold_reason: nullable(HOLD), starts_at: nullable(TIME), ends_at: nullable(TIME), error: nullable(text(1000)),
  reserved_hours: SUM, charged_hours: SUM, has_result: BOOL, flags: JOB_FLAGS});
const jobDetail = obj({...jobView.properties, history: history({state: JOB_STATE, disposition: RESULT_STATE})});
const resultView = obj({id: ID, job_id: ID, owner_person_id: ID, config_id: ID, seed: SEED, protocol_id: nullable(ID), metrics, completed_at: TIME, state: RESULT_STATE,
  exclusion_reason: nullable(text(1000)), tags: arr(text(60)), note: nullable(text(2000)), invalidated: nullable(invalidation), flags: RESULT_FLAGS});
const protocolView = obj({...protocolBase, stored_state: STORED_PROTOCOL, state: PROTOCOL_STATE, required_signers: arr(ID), missing_signers: arr(ID)});
const tableView = obj({...tableBase, stored_state: TABLE_STATE, flags: TABLE_FLAGS, csv: nullable({type: 'string'})});
const tableRow = obj({id: ID, table_id: ID, version: {type: 'integer'}, title: text(200), protocol_id: ID, state: TABLE_STATE, rows: COUNT, created_at: TIME,
  frozen_at: nullable(TIME), flags: TABLE_FLAGS});
const noticeRow = obj({id: ID, at: TIME, kind: NOTICE_KINDS, event_id: nullable(ID), request_id: nullable(ID), object_type: OBJECT_TYPES, object_id: ID,
  title: text(200), text: text(4000), details: nullable(rejected), email_stored: BOOL});
const estimate = obj({allowed: BOOL, failures: arr(ERRORS), reserve_hours: SUM, project_left: SUM, share_left: nullable(SUM), flags: ESTIMATE_FLAGS});

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
const write = (name, description, input, optional, output, extra) => tool(name, description, false, input, optional, output, extra);
const RANGE = {start: DAY, end: DAY};
const SUBMIT = {id: ID, seed: SEED, partition_id: ID, gpus: GPUS, time_limit_hours: LIMIT, protocol_id: nullable(ID), hold: BOOL};

read('project.get', 'Read the project: its name, cluster, time zone, lab head and policy (`hard_shares`, `max_active_jobs`, `required_signers`, `signoff_window_days`), the partitions with their charge rate and longest job time, the people with their role and share, the current allocation period, the earlier periods, and the history of allocation changes. Every read returns the current virtual time as `now`, with the project\'s UTC offset.',
  {}, [], {account_id: ID, owner_person_id: ID, project, partitions: arr(partition), people: arr(personRecord), allocation, past_periods: arr(obj(period)), allocation_changes: arr(change)});
read('usage.summary', 'Read the usage of the current allocation period in GPU-hours: the allocation, and what is used, reserved, remaining and overdrawn, for the project and for each person with a share. A queued or running job reserves gpus × rate × time limit. A held job reserves nothing. An ended, cancelled or interrupted job is charged gpus × rate × hours run.',
  {}, [], {usage: usageView});
read('configs.list', 'List the registered configs, optionally of one family, by registration time.', {family: text(80)}, ['family'], {items: arr(config)});
read('configs.get', 'Read one config: its parameters, dataset version, evaluation split and code reference.', {id: ID}, [], {config});
read('jobs.list', 'List the lab\'s jobs submitted on a day in a window (`start` to `end`, both included, in the project\'s time zone), by owner, state, config or protocol version. Sorted by submission time. A job shows its start only once it has started, and its end only once it has ended.',
  {...RANGE, owner_person_id: ID, state: JOB_STATE, config_id: ID, protocol_id: ID}, ['start', 'end', 'owner_person_id', 'state', 'config_id', 'protocol_id'], {items: arr(jobView)});
read('jobs.get', 'Read one job with its history and, once it has completed, its result.', {id: ID}, [], {job: jobDetail, result: nullable(resultView)});
read('jobs.estimate', 'Run the submission check without writing, for a job of the config `id`. Returns `allowed`, every failing step after `not_found` (`time_limit_too_long`, `protocol_mismatch`, `too_many_active`, `over_allocation`, `over_share`), the GPU-hours the job would reserve, what the project and your share would have left (below zero when it does not fit), and the flags the job would carry. With `hold: true` only the first four steps run, and nothing is reserved.',
  SUBMIT, ['protocol_id', 'hold'], {estimate});
read('results.list', 'List the results of completed jobs that ended on a day in a window (`start` to `end`, both included), by owner, config, protocol version or state (`candidate`, `excluded`). A result has the ID of its job.',
  {...RANGE, owner_person_id: ID, config_id: ID, protocol_id: ID, state: RESULT_STATE}, ['start', 'end', 'owner_person_id', 'config_id', 'protocol_id', 'state'], {items: arr(resultView)});
read('results.compare', 'Compare two or more results. They are `comparable` only when they name the same protocol version. `differences` lists every field in which their protocol versions differ.',
  {ids: arr(ID, {minItems: 2, maxItems: 50, uniqueItems: true})}, [], {comparable: BOOL, protocol_ids: arr(nullable(ID)),
    differences: arr(obj({field: en('protocol_id', 'dataset_version', 'eval_split', 'metrics', 'seeds'), values: {type: 'object'}})), results: arr(resultView)});
read('protocols.list', 'List protocol versions, by line and state, by proposal time. A proposed version reads `expired` once its `respond_by` has passed.',
  {line: ID, state: PROTOCOL_STATE}, ['line', 'state'], {items: arr(protocolView)});
read('protocols.get', 'Read one protocol version with its sign-offs, the required signers and the signatures still missing.', {id: ID}, [], {protocol: protocolView});
read('tables.list', 'List results table versions, by state or protocol version, with their flags.', {state: TABLE_STATE, protocol_id: ID}, ['state', 'protocol_id'], {items: arr(tableRow)});
read('tables.get', 'Read one table version with its rows and flags. A frozen version also returns its manifest and the same rows as CSV text.', {id: ID}, [], {table: tableView});
read('notifications.list', 'List notifications released on a day in a window (`start` to `end`, both included). A notification is listed only from its release time on. `email_stored` means the App stored an email message for the Infra sender. It does not mean that Mail received it.',
  RANGE, ['start', 'end'], {items: arr(noticeRow)});
read('preferences.get', 'Read the notification preferences: the time zone of notification text, `email_notices` and `job_end_notices`.', {}, [], {preferences});

write('jobs.submit', 'Submit a job of the config `id` for one seed, on a partition, with a number of GPUs and a time limit in hours, optionally under a protocol version. The submission check runs first. With `hold: true` the job starts `held` (reason `submitted_held`), reserves nothing and runs only the first four steps of the check; `jobs.release` runs the full check later. A job is not edited: cancel it and submit again. Returns the `id` of the new job.',
  SUBMIT, ['protocol_id', 'hold'], {id: ID, config_id: ID, state: en('queued', 'held'), hold_reason: nullable(HOLD), reserved_hours: SUM, flags: ESTIMATE_FLAGS});
write('jobs.hold', 'Hold a queued job of yours. It gives its reserved hours back and waits for `jobs.release`.', {id: ID}, [], {id: ID, state: {const: 'held'}, hold_reason: {const: 'agent'}});
write('jobs.release', 'Release a held job of yours. The full submission check runs again, and the job does not count against your own job count. It then waits in the queue again from now.',
  {id: ID}, [], {id: ID, state: {const: 'queued'}, reserved_hours: SUM, flags: ESTIMATE_FLAGS});
write('jobs.cancel', 'Cancel a queued, held or running job of yours. It leaves no result. A running job is charged for the hours it ran. This cannot be undone.',
  {id: ID}, [], {id: ID, state: {const: 'cancelled'}, charged_hours: SUM});
write('results.update', 'Tag a result of yours, set its note, exclude it with a reason, or bring it back (`disposition`). Nothing is deleted. `id` is the job.',
  {id: ID, tags: arr(text(60), {maxItems: 50}), note: nullable(text(2000)), disposition: RESULT_STATE, reason: text(1000)}, ['tags', 'note', 'disposition', 'reason'],
  {id: ID, state: RESULT_STATE, tags: arr(text(60)), note: nullable(text(2000))}, {anyOf: [{required: ['tags']}, {required: ['note']}, {required: ['disposition']}]});
write('protocols.propose', 'Propose a new version of the protocol line `id`, with its dataset version, evaluation split, metrics and seeds, and a rationale. You sign it by proposing when you are a required signer. A proposal is not edited: withdraw it and propose again. Returns the `id` of the new version and its `respond_by`.',
  {id: ID, dataset_version: text(120), eval_split: text(120), metrics: METRICS, seeds: {...SEEDS, uniqueItems: true}, rationale: text(2000)}, ['rationale'],
  {id: ID, state: en('proposed', 'signed'), respond_by: TIME, missing_signers: arr(ID)});
write('protocols.respond', 'Sign or decline a proposed protocol version as a required signer, with an optional note. The last required signature signs it and supersedes the earlier signed version of the line. A decline declines it.',
  {id: ID, answer: ANSWER, note: text(1000)}, ['note'], {id: ID, state: en('proposed', 'signed', 'declined'), missing_signers: arr(ID)});
write('protocols.withdraw', 'Withdraw your own proposed protocol version. No other version changes.', {id: ID, note: text(1000)}, ['note'], {id: ID, state: {const: 'withdrawn'}});
write('tables.create', 'Create a results table under the protocol version `id`, as draft version 1. Returns the `id` of the version and of the table.',
  {id: ID, title: text(200)}, [], {id: ID, table_id: ID, table_version: {const: 1}, state: {const: 'draft'}});
write('tables.update', 'Set the named rows of a draft table version. Each row cites results of completed jobs by job ID, all under the protocol version of the table.',
  {id: ID, rows: arr(row, {maxItems: 200})}, [], {id: ID, state: {const: 'draft'}, rows: COUNT, flags: TABLE_FLAGS});
write('tables.freeze', 'Freeze a draft table version. It needs rows, a signed or superseded protocol version, exactly one result for each seed of the protocol in each row from one config, and no excluded or invalidated result. A frozen version is never edited, and the version it revises becomes `superseded`.',
  {id: ID}, [], {id: ID, state: {const: 'frozen'}, content_hash: {type: 'string'}, superseded: nullable(ID)});
write('tables.revise', 'Start a new draft version from the latest frozen version `id` of a table with no draft. The draft starts with its rows.',
  {id: ID}, [], {id: ID, table_version: {type: 'integer'}, state: {const: 'draft'}, revises: ID});
write('tables.discard', 'Discard a draft table version. No frozen version changes.', {id: ID}, [], {id: ID, state: {const: 'discarded'}});
write('preferences.update', 'Set the time zone used in notification text, `email_notices` or `job_end_notices`. Give at least one of them. A notification that is already written does not change.',
  {timezone: text(64), email_notices: BOOL, job_end_notices: BOOL}, ['timezone', 'email_notices', 'job_end_notices'], {id: ID, preferences},
  {anyOf: [{required: ['timezone']}, {required: ['email_notices']}, {required: ['job_end_notices']}]});

// Events: structure only. The handler checks the plan's rules and answers `invalid_event`.
const payloads = {
  'allocation.changed': {...obj({allocation_hours: HOURS, shares: arr(share, {minItems: 1, maxItems: 200}), changed_by: ID, reason: text(1000)}, ['allocation_hours', 'shares', 'reason']),
    anyOf: [{required: ['allocation_hours']}, {required: ['shares']}]},
  'job.recorded': obj({job_id: ID, owner_person_id: ID, config_id: ID, seed: SEED, partition_id: ID, gpus: GPUS, time_limit_hours: LIMIT, starts_at: TIME, ends_at: TIME,
    end_kind: END_KIND, protocol_id: nullable(ID), metrics, error: text(1000)}, ['protocol_id', 'metrics', 'error']),
  'job.script_submitted': obj({script: text(200), config_id: ID, seed: SEED, partition_id: ID, gpus: GPUS, time_limit_hours: LIMIT, protocol_id: nullable(ID), hold: BOOL}, ['protocol_id', 'hold']),
  'job.interrupted': obj({job_id: ID, reason: text(1000)}, ['reason']),
  'plan.set': obj({config_id: ID, seed: nullable(SEED), partition_id: nullable(ID), queue_wait_minutes: MINUTES, run_minutes: MINUTES, outcome: en('completed', 'failed'),
    metrics, error: text(1000)}, ['seed', 'partition_id', 'metrics', 'error']),
  'config.registered': obj({config_id: ID, family: text(80), version: {type: 'integer', minimum: 1, maximum: 100000}, params, dataset_version: text(120), eval_split: text(120),
    code_ref: text(120), registered_by: ID}),
  'protocol.proposed': obj({protocol_id: ID, line: ID, dataset_version: text(120), eval_split: text(120), metrics: METRICS, seeds: SEEDS, proposed_by: ID, rationale: text(2000)}, ['rationale']),
  'protocol.answered': obj({protocol_id: ID, person_id: ID, answer: ANSWER, note: text(1000)}, ['note']),
  'protocol.withdrawn': obj({protocol_id: ID, note: text(1000)}, ['note']),
  'result.invalidated': obj({job_id: ID, invalidated_by: ID, reason: text(1000)}, ['reason'])
};
// A completed recorded job or plan has its metrics. A failed one may have an error text.
payloads['job.recorded'].oneOf = [{properties: {end_kind: {const: 'completed'}, error: {type: 'null'}}, required: ['metrics']},
  {properties: {end_kind: en('failed', 'timed_out'), metrics: {type: 'null'}}}];
payloads['plan.set'].oneOf = [{properties: {outcome: {const: 'completed'}, error: {type: 'null'}}, required: ['metrics']},
  {properties: {outcome: {const: 'failed'}, metrics: {type: 'null'}}}];
const eventId = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const events = {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:benchline:events:1',
  oneOf: Object.entries(payloads).map(([name, payload]) => obj({event_id: eventId, at: TIME, operation: {const: APP + '.' + name}, payload}))};

const files = {
  'schemas/seed.schema.json': seed,
  'schemas/events.schema.json': events,
  'tools.json': tools
};
if (require.main === module) {
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
}
module.exports = {eventTypes: Object.keys(payloads).map(name => APP + '.' + name)};
