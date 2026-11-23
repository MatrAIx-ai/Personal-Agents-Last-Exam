'use strict';
// Writes schemas/seed.schema.json, schemas/events.schema.json and tools.json from one set of record shapes.
// Run `node dev/build.cjs` after a change, or `node dev/build.cjs --check` to compare with the committed files.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'alderbrook';

const obj = (properties, optional = []) => ({type: 'object', properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false});
const arr = (items, extra = {}) => ({type: 'array', items, ...extra});
const nullable = schema => ({anyOf: [{type: 'null'}, schema]});
const en = (...values) => ({enum: values});
const text = (max = 2000) => ({type: 'string', minLength: 1, maxLength: max});
const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const KEY = {type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$'};
// A stored or given time has a year from 1970 to 2999. `now` is the clock that Core supplies, so it has no such bound.
const TIME = {type: 'string', format: 'date-time', pattern: '^(19[7-9]\\d|2\\d{3})-'};
const NOW = {type: 'string', format: 'date-time'};
const DAY = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const AMOUNT = {type: 'number', minimum: 0, maximum: 100000000};
const POSITIVE = {type: 'number', minimum: 0.01, maximum: 100000000};
// A sum that the App computes has no upper bound.
const SUM = {type: 'number', minimum: 0};
const COUNT = {type: 'integer', minimum: 0};
const BOOL = {type: 'boolean'};
const IDS = arr(ID, {uniqueItems: true, maxItems: 50});

const COVERAGE = en('collision', 'comprehensive', 'personal_property');
const EVIDENCE_KIND = en('photo', 'receipt', 'report', 'statement', 'other');
const DRIVER = {oneOf: [obj({kind: {const: 'listed'}, person_id: ID}), obj({kind: {const: 'other'}, name: text(200)})]};
const DIRECTION = {oneOf: [obj({kind: {const: 'policyholder'}}), obj({kind: {const: 'shop'}, name: text(200)})]};
const FLAGS = arr(en('request_overdue', 'lines_pending', 'lines_denied', 'under_deductible', 'overpaid',
  'payee_mismatch', 'offer_expired', 'below_payoff', 'rental_uncovered'), {uniqueItems: true});
const FAILURES = arr(en('invalid_window', 'not_in_force', 'not_covered', 'too_late', 'duplicate_claim'), {uniqueItems: true});

// Stored records.
const policy = {
  id: ID, kind: en('auto', 'renters'), number: text(40), term: obj({start: TIME, end: TIME}),
  named_insured: obj({person_id: ID, name: text(200)}),
  listed_people: arr(obj({person_id: ID, name: text(200), role: en('named_insured', 'driver', 'household_member')}), {maxItems: 20}),
  vehicles: arr(obj({id: ID, year: {type: 'integer', minimum: 1950, maximum: 2100}, make: text(80), model: text(80),
    lienholder: nullable(obj({name: text(200)}))}), {maxItems: 10}),
  insured_address: nullable(obj({id: ID, line: text(300)})),
  coverages: arr(obj({type: COVERAGE, deductible: AMOUNT, limit: nullable(POSITIVE)}), {minItems: 1, maxItems: 3}),
  rental_benefit: nullable(obj({daily_cap: POSITIVE, max_days: {type: 'integer', minimum: 1, maximum: 366}}))
};
const evidence = {id: ID, kind: EVIDENCE_KIND, dated: TIME, description: text(), reference: nullable(text(200)), added_at: TIME};
const answer = obj({text: text(), evidence_ids: IDS, answered_at: TIME});
const request = {id: ID, issued_at: TIME, due_at: TIME, issued_by: text(200), state: en('open', 'answered', 'void'),
  asks: arr(obj({key: KEY, text: text(), answer: nullable(answer)}), {maxItems: 20})};
const decision = obj({status: en('approved', 'denied'), amount: nullable(AMOUNT), reason: nullable(text()), decided_at: TIME,
  source: en('determination', 'dispute'), source_id: ID});
const line = {id: ID, text: text(300), amount: POSITIVE, decisions: arr(decision)};
const estimate = lineSchema => ({id: ID, kind: en('initial', 'supplement'), source: en('shop', 'adjuster', 'policyholder'),
  shop_name: nullable(text(200)), submitted_at: TIME, lines: arr(lineSchema, {maxItems: 60})});
const determination = {id: ID, issued_at: TIME, issued_by: text(200), note: nullable(text()), line_ids: arr(ID, {uniqueItems: true, maxItems: 60})};
const dispute = {id: ID, line_id: ID, decision_index: COUNT, reason: text(), evidence_ids: IDS, opened_at: TIME,
  state: en('open', 'upheld', 'changed', 'void'), decided_at: nullable(TIME), decided_by: nullable(text(200)), note: nullable(text())};
const offer = states => ({id: ID, issued_at: TIME, valuation: POSITIVE, lienholder_payoff: nullable(AMOUNT), respond_by: TIME,
  issued_by: text(200), basis: nullable(text()), state: en(...states), answered_at: nullable(TIME), reason: nullable(text()), evidence_ids: IDS});
const rental = {id: ID, start_at: TIME, daily_rate: POSITIVE, state: en('active', 'ended'), end_at: nullable(TIME),
  ended_by: nullable(en('agent', 'claim_withdrawn', 'claim_closed'))};
const payee = obj({kind: en('policyholder', 'shop', 'lienholder'), name: nullable(text(200))});
const payment = {id: ID, kind: en('repair', 'settlement', 'rental'), amount: {type: 'number', maximum: 100000000}, payee,
  direction_on_file: nullable(DIRECTION), payee_named: BOOL, reference: nullable(text(200)), issued_at: TIME, state: {const: 'issued'}};
const historyRow = obj({at: TIME, action: text(80), actor: en('agent', 'event'), ref: ID});
const claim = parts => ({
  id: ID, policy_id: ID, coverage: COVERAGE, subject_id: ID, loss_at: TIME, filed_at: TIME, description: text(),
  police_report_number: nullable(text(80)), driver: nullable(DRIVER), state: en('open', 'withdrawn', 'closed'),
  path: en('repair', 'total_loss'), outcome: nullable(en('paid', 'denied', 'no_response')), closed_at: nullable(TIME),
  withdrawn_at: nullable(TIME), repair_completed_at: nullable(TIME), repair_reported_by: nullable(text(200)),
  final_invoice_total: nullable(AMOUNT), payee: nullable(DIRECTION),
  // A list that calls can grow without end has no upper bound: these lists, and the decisions of a line.
  evidence: arr(obj(evidence)), requests: arr(obj(parts.request)),
  estimates: arr(obj(parts.estimate)), determinations: arr(obj(determination)),
  disputes: arr(obj(dispute)), offers: arr(obj(parts.offer)),
  rentals: arr(obj(parts.rental)), payments: arr(obj(payment)),
  history: arr(historyRow)
});
const storedClaim = claim({request, estimate: estimate(obj(line)), offer: offer(['open', 'accepted', 'rejected', 'superseded']), rental});
const preferences = obj({timezone: text(64), email_notices: BOOL});
const wire = {type: 'object'};
const notification = {id: ID, at: TIME, kind: text(60), claim_id: ID, event_id: ID, title: text(200), text: text(4000), email: nullable(wire)};
const activity = obj({seq: {type: 'integer', minimum: 1}, at: TIME, actor: en('agent', 'event'), action: text(80), object_id: ID,
  request_id: nullable(ID), event_id: nullable(ID), effect: BOOL});
const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:alderbrook:seed:1', ...obj({
    account_id: ID, owner_person_id: ID,
    insurer: obj({name: text(200), timezone: text(64), rules: obj({notice_days: {type: 'integer', minimum: 1, maximum: 366},
      request_response_days: {type: 'integer', minimum: 1, maximum: 366}, dispute_window_days: {type: 'integer', minimum: 1, maximum: 366},
      offer_response_days: {type: 'integer', minimum: 1, maximum: 366}, rental_grace_days: {type: 'integer', minimum: 0, maximum: 366}})}),
    preferences,
    policies: arr(obj(policy), {maxItems: 20}), claims: arr(obj(storedClaim)),
    notifications: arr(obj(notification)), activity: arr(activity)
  })
};

// Views: stored records plus the values the App computes from the clock when it is read.
const standing = obj({status: en('pending', 'approved', 'denied'), approved_amount: nullable(AMOUNT), reason: nullable(text()),
  decided_at: nullable(TIME), dispute_by: nullable(DAY), disputable: BOOL});
const settlement = obj({offer_id: ID, offer_state: en('open', 'accepted', 'rejected', 'expired', 'superseded'), valuation: AMOUNT,
  lienholder_payoff: nullable(AMOUNT), net: SUM, to_lienholder: SUM, to_me: SUM, shortfall: nullable(SUM),
  paid_to_lienholder: SUM, paid_to_me: SUM, still_due_to_lienholder: SUM, still_due_to_me: SUM});
const summary = obj({approved_total: nullable(SUM), insurer_owes: nullable(SUM), over_limit: nullable(SUM), paid: SUM,
  still_due: nullable(SUM), overpaid: SUM, my_share: nullable(SUM), not_approved_total: nullable(SUM), settlement: nullable(settlement)});
const estimateView = {...estimate(obj({...line, standing})), claim_id: ID};
const claimView = {
  ...claim({request: {...request, overdue: BOOL}, estimate: estimateView,
    offer: offer(['open', 'accepted', 'rejected', 'expired', 'superseded']),
    rental: {...rental, rental_days: COUNT, covered_days: COUNT, uncovered_days: COUNT, my_cost: SUM}}),
  deductible: AMOUNT, limit: nullable(POSITIVE), lienholder: nullable(obj({name: text(200)})), rental_stops_on: nullable(DAY),
  summary, flags: FLAGS
};
const claimRow = obj({id: ID, policy_id: ID, coverage: COVERAGE, subject_id: ID, loss_at: TIME, filed_at: TIME,
  state: en('open', 'withdrawn', 'closed'), path: en('repair', 'total_loss'), outcome: nullable(en('paid', 'denied', 'no_response')), flags: FLAGS});
const policyView = obj({...policy, in_force: BOOL});
const noticeRow = obj({id: ID, at: TIME, kind: text(60), claim_id: ID, title: text(200), text: text(4000), emailed: BOOL});

// Tools.
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const REQUEST = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const tools = [];
function tool(name, description, readOnly, input, optional, output) {
  const inputSchema = readOnly ? obj(input, optional) : obj({...input, expected_version: VERSION, request_id: REQUEST}, optional);
  const outputSchema = obj({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: APP}, version: VERSION,
    ...output, ...(readOnly ? {now: NOW} : {})});
  tools.push({name: APP + '.' + name, description, read_only: readOnly, scope: APP + '.' + name, resource_target: 'current account', inputSchema, outputSchema});
}
const read = (name, description, input, optional, output) => tool(name, description, true, input, optional, output);
const write = (name, description, input, optional, output = {id: ID}) => tool(name, description, false, input, optional, output);
const evidenceIds = arr(ID, {uniqueItems: true, maxItems: 20});

read('policies.list', 'List the policies of the account. Returns the current virtual time as `now`.', {}, [], {items: arr(policyView)});
read('policies.get', 'Read one policy with its coverages, people, vehicles or insured address, rental benefit and lienholder.', {id: ID}, [], {policy: policyView});
read('coverage.check', 'Check in advance whether a loss can be claimed. Writes nothing. `id` is the policy. `subject_id` is a vehicle of the policy or its insured address. Lists every rule that a filing would break, and the last day to file.',
  {id: ID, coverage: COVERAGE, subject_id: ID, loss_at: TIME, estimated_amount: POSITIVE}, ['estimated_amount'],
  {covered: BOOL, coverage: nullable(obj({type: COVERAGE, deductible: AMOUNT, limit: nullable(POSITIVE)})), failures: FAILURES,
    last_day_to_file: DAY, expected_payment: nullable(SUM), flags: FLAGS});
read('claims.list', 'List claims by state, policy or coverage, in a window of filing time (`start` to `end`, both included). `id` is a policy. Sorted by filing time.',
  {state: en('open', 'withdrawn', 'closed'), id: ID, coverage: COVERAGE, start: TIME, end: TIME},
  ['state', 'id', 'coverage', 'start', 'end'], {items: arr(claimRow)});
read('claims.get', 'Read one claim with its history, evidence, requests, estimates, standing decisions, disputes, offers, rental periods, payee direction, money summary and flags.',
  {id: ID}, [], {claim: obj(claimView)});
read('estimates.get', 'Read one estimate with its lines and the standing decision of each line.', {id: ID}, [], {estimate: obj(estimateView)});
read('payments.list', 'List payment records in a window of issue time (`start` to `end`, both included), for one claim or for all. `id` is a claim.',
  {id: ID, kind: en('repair', 'settlement', 'rental'), start: TIME, end: TIME}, ['id', 'kind', 'start', 'end'],
  {items: arr(obj({...payment, claim_id: ID}))});
read('notifications.list', 'List notifications in a window of their time (`start` to `end`, both included), for one claim or for all. `id` is a claim.',
  {id: ID, start: TIME, end: TIME}, ['id', 'start', 'end'], {items: arr(noticeRow)});
read('preferences.get', 'Read the notification preferences of the account.', {}, [], {preferences});

write('claims.file', 'File a claim. `id` is the policy. `subject_id` is a vehicle of the policy or its insured address. Returns the `id` of the new claim.',
  {id: ID, coverage: COVERAGE, subject_id: ID, loss_at: TIME, description: text(), police_report_number: text(80), driver: nullable(DRIVER)},
  ['police_report_number', 'driver']);
write('claims.update', 'Correct the description, the police report number or the driver of an open claim. Give at least one of them.',
  {id: ID, description: text(), police_report_number: nullable(text(80)), driver: nullable(DRIVER)}, ['description', 'police_report_number', 'driver']);
write('claims.add_evidence', 'Add evidence items to an open claim. An item is a record with a kind, a date and a description. It has no file bytes.',
  {id: ID, items: arr(obj({kind: EVIDENCE_KIND, dated: TIME, description: text(), reference: text(200)}, ['reference']), {minItems: 1, maxItems: 20})},
  [], {id: ID, evidence_ids: arr(ID)});
write('claims.withdraw', 'Withdraw an open claim that has no payment and no accepted offer.', {id: ID}, []);
write('requests.respond', 'Answer asks of an open information request, by key. An answer is given once and is not edited.',
  {id: ID, answers: arr(obj({key: KEY, text: text(), evidence_ids: evidenceIds}, ['evidence_ids']), {minItems: 1, maxItems: 20})}, []);
write('estimates.submit', 'Submit an estimate that a shop gave the policyholder. `id` is the claim. Returns the `id` of the new estimate.',
  {id: ID, kind: en('initial', 'supplement'), shop_name: text(200), lines: arr(obj({text: text(300), amount: POSITIVE}), {minItems: 1, maxItems: 60})}, []);
write('determinations.dispute', 'Dispute one estimate line that was denied, or approved for less than its estimate. `id` is the line and `claim_id` is its claim. Returns the `id` of the new dispute.',
  {id: ID, claim_id: ID, reason: text(), evidence_ids: evidenceIds}, ['evidence_ids']);
write('payee.set', 'Say who is paid for repairs: the policyholder or a named shop. `id` is the claim. Applies to later repair payments only.',
  {id: ID, payee: DIRECTION}, []);
write('offers.accept', 'Accept an open settlement offer. The acceptance is final for the amount of the claim.', {id: ID}, []);
write('offers.reject', 'Reject an open settlement offer, with a reason and evidence items.', {id: ID, reason: text(), evidence_ids: evidenceIds}, ['evidence_ids']);
write('rental.start', 'Start a rental period under the policy\'s rental benefit. `id` is the claim. Returns the `id` of the new rental period.',
  {id: ID, start_at: TIME, daily_rate: POSITIVE}, []);
write('rental.end', 'End an active rental period. `id` is the rental period.', {id: ID, end_at: TIME}, []);
write('preferences.update', 'Set the time zone used in notification text, or `email_notices`. Give at least one of them.',
  {timezone: text(64), email_notices: BOOL}, ['timezone', 'email_notices']);

// Events: structure only. The handler checks the rules and answers `invalid_event`.
const eventId = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const lineDecision = obj({status: en('approved', 'denied'), amount: {type: 'number'}, reason: text()}, ['amount', 'reason']);
const payloads = {
  'request.issued': obj({info_request_id: ID, claim_id: ID, asks: arr(obj({key: KEY, text: text()}), {maxItems: 20}), due_at: TIME, issued_by: text(200)}, ['due_at']),
  'estimate.submitted': obj({estimate_id: ID, claim_id: ID, kind: en('initial', 'supplement'), source: en('shop', 'adjuster'), shop_name: text(200),
    lines: arr(obj({line_id: ID, text: text(300), amount: {type: 'number'}}), {maxItems: 60})}, ['shop_name']),
  'determination.issued': obj({determination_id: ID, claim_id: ID, lines: arr(obj({line_id: ID, status: en('approved', 'denied'),
    amount: {type: 'number'}, reason: text()}, ['amount', 'reason']), {maxItems: 60}), issued_by: text(200), note: text()}, ['note']),
  'dispute.decided': obj({dispute_id: ID, decision: en('upheld', 'changed'), line: lineDecision, decided_by: text(200), note: text()}, ['line', 'note']),
  'offer.issued': obj({offer_id: ID, claim_id: ID, valuation: {type: 'number'}, lienholder_payoff: {type: 'number'}, respond_by: TIME,
    issued_by: text(200), basis: text()}, ['lienholder_payoff', 'respond_by', 'basis']),
  'payment.issued': obj({payment_id: ID, claim_id: ID, kind: en('repair', 'settlement', 'rental'), amount: {type: 'number'},
    payee: obj({kind: {type: 'string', maxLength: 40}, name: text(200)}, ['name']), reference: text(200)}, ['payee', 'reference']),
  'repair.completed': obj({claim_id: ID, reported_by: text(200), final_invoice_total: {type: 'number'}}, ['final_invoice_total']),
  'claim.closed': obj({claim_id: ID, outcome: en('paid', 'denied', 'no_response'), note: text()}, ['note'])
};
const events = {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:alderbrook:events:1',
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
