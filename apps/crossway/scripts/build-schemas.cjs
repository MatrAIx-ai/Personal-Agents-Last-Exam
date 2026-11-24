#!/usr/bin/env node
'use strict';
// Writes tools.json, schemas/seed.schema.json, schemas/events.schema.json and
// schemas/state.schema.json from the definitions below. Run after changing a
// tool or record shape: node scripts/build-schemas.cjs (--check to compare only).
// The validator in the public runtime supports a keyword subset; only those
// keywords are used here.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = require('../app.json');

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const REF_ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'};
const DATE = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const PERIOD = {type: 'string', pattern: '^\\d{4}-\\d{2}$'};
const DT = {type: 'string', format: 'date-time'};
const PLATE = {type: 'string', pattern: '^[A-Z0-9]{2,8}$'};
const PLATE_IN = {type: 'string', pattern: '^[A-Za-z0-9 -]{2,10}$'};
const BOOL = {type: 'boolean'};
const str = (max = 200, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const int = (min, max) => ({type: 'integer', minimum: min, maximum: max});
const CENTS = int(-100000000, 100000000);
const AMOUNT = int(0, 100000000);
const CLASS = int(1, 9);
const nul = s => ({anyOf: [s, {type: 'null'}]});
const arr = (items, max, extra = {}) => ({type: 'array', items, maxItems: max, ...extra});
const obj = (props, required = Object.keys(props)) => ({type: 'object', properties: props, required, additionalProperties: false});
const en = (...values) => ({enum: values});
const HISTORY = arr({type: 'object', properties: {at: DT, action: str(40)}, required: ['at', 'action']}, 500);
const EVIDENCE = obj({app_id: REF_ID, account_id: REF_ID, object_id: REF_ID});
const NOTICE_STATES = ['issued', 'escalated', 'collections', 'paid', 'disputed', 'dismissed'];
const REASONS = ['sold_or_not_in_possession', 'paid_by_rental_agency', 'transponder_malfunction', 'not_my_plate'];

// ---- Seed (business data) -------------------------------------------------

const previewBase = {id: ID, created_at: DT, expires_at: DT, used_at: nul(DT)};
const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Crossway account seed',
  ...obj({
    account_id: ID,
    owner_person_id: ID,
    holder: obj({display_name: str(100)}),
    opened_on: DATE,
    authority: obj({
      name: str(100),
      time_zone: {const: 'America/New_York'},
      plazas: arr(obj({id: ID, name: str(100), road: str(100), account_cents: arr(AMOUNT, 9, {minItems: 1}), mail_cents: arr(AMOUNT, 9, {minItems: 1})}), 100),
      rental_agencies: arr(obj({id: ID, name: str(100)}), 50),
      plates_on_other_accounts: arr(PLATE, 1000, {uniqueItems: true}),
      policy: obj({
        vehicle_classes: arr(obj({class: CLASS, label: str(100)}), 9, {minItems: 1}),
        late_fee_cents: AMOUNT, notice_due_days: int(1, 365), escalated_due_days: int(1, 365),
        dispute_window_days: int(1, 365), denial_due_days: int(1, 365), preview_minutes: int(1, 1440),
        temporary_plate_max_days: int(1, 365),
        topup_min_cents: AMOUNT, topup_max_cents: AMOUNT, replenish_min_cents: AMOUNT, replenish_max_cents: AMOUNT,
        threshold_min_cents: AMOUNT, threshold_max_cents: AMOUNT,
      }),
    }),
    cards: arr(obj({id: ID, holder_person_id: ID, holder_name: str(100), brand: str(20), last4: {type: 'string', pattern: '^\\d{4}$'},
      exp_month: int(1, 12), exp_year: int(2020, 2100), status: en('active', 'declined', 'closed'), history: HISTORY}), 20),
    replenish: obj({enabled: BOOL, card_id: ID, amount_cents: AMOUNT, threshold_cents: AMOUNT, consecutive_failures: int(0, 1000), updated_at: DT}),
    balance_cents: CENTS,
    suspended_at: nul(DT),
    vehicles: arr(obj({id: ID, plate: PLATE, class: CLASS, label: str(100), temporary: BOOL, rental_agency_id: nul(ID),
      possession_start: DATE, possession_end: nul(DATE), ended_at: nul(DT), added_at: DT, history: HISTORY}), 200),
    transponders: arr(obj({id: ID, serial: str(40), class: CLASS, vehicle_id: nul(ID), issued_on: DATE, history: HISTORY}), 50),
    tolls: arr(obj({id: ID, plaza_id: ID, at: DT, read: en('transponder', 'plate'), transponder_id: nul(ID), plate_seen: PLATE,
      class_seen: CLASS, class_charged: nul(CLASS), rate: nul(en('account', 'mail')), amount_cents: AMOUNT, vehicle_id: nul(ID),
      disposition: en('debited', 'noticed', 'unmatched'), notice_id: nul(ID), ledger_id: nul(ID)}), 20000),
    ledger: arr(obj({id: ID, at: DT, kind: en('toll', 'topup', 'replenish'), amount_cents: CENTS, balance_cents: CENTS, ref_id: ID}), 50000),
    statements: arr(obj({id: ID, period: PERIOD, issued_at: DT, opening_balance_cents: CENTS, closing_balance_cents: CENTS,
      toll_count: int(0, 100000), toll_cents: AMOUNT, topup_cents: AMOUNT, replenish_cents: AMOUNT, notices_issued: int(0, 100000)}), 1000),
    notices: arr(obj({id: ID, toll_id: ID, vehicle_id: nul(ID), plate: PLATE, plaza_id: ID, toll_at: DT, class_charged: CLASS,
      issued_at: DT, issue_date: DATE, toll_cents: AMOUNT, late_fee_cents: AMOUNT, state: en(...NOTICE_STATES), due_date: DATE,
      escalated_at: nul(DT), collections_at: nul(DT), paid_at: nul(DT), payment_receipt_id: nul(ID), dispute_id: nul(ID), history: HISTORY}), 5000),
    disputes: arr(obj({id: ID, notice_id: ID, reason: en(...REASONS), transfer_date: nul(DATE), agency_id: nul(ID), transponder_id: nul(ID),
      explanation: nul(str(2000)), evidence: arr(EVIDENCE, 10), state: en('submitted', 'granted', 'denied', 'withdrawn'),
      submitted_at: DT, decided_at: nul(DT), withdrawn_at: nul(DT), prior_state: en('issued', 'escalated'),
      remaining_days: int(0, 1000), receipt_id: nul(ID)}), 1000),
    dispute_decisions: arr(obj({id: ID, at: DT, notice_id: ID, dispute_id: nul(ID), outcome: en('granted', 'denied', 'no_target')}), 1000),
    receipts: arr(obj({id: ID, kind: en('topup', 'replenish', 'notice_payment', 'dispute'), created_at: DT, card_id: nul(ID),
      amount_cents: AMOUNT, notice_ids: arr(ID, 20), dispute_id: nul(ID), status: en('approved', 'failed'),
      failure_code: nul(en('card_expired', 'card_declined'))}), 20000),
    outgoing: arr(obj({id: ID, kind: str(40), created_at: DT, object_type: str(40), object_id: ID,
      message: {$ref: 'router-message.schema.json'}}), 5000),
    run: obj({previews: arr({oneOf: [
      obj({...previewBase, kind: {const: 'topup'}, amount_cents: AMOUNT, card_id: ID, balance_before_cents: CENTS, balance_after_cents: CENTS}),
      obj({...previewBase, kind: {const: 'pay'}, notice_ids: arr(ID, 20), card_id: ID, total_cents: AMOUNT,
        lines: arr(obj({notice_id: ID, plate: PLATE, toll_date: DATE, plaza_name: str(100), state: en(...NOTICE_STATES), amount_cents: AMOUNT}), 20)}),
      obj({...previewBase, kind: {const: 'dispute'}, notice_id: ID, reason: en(...REASONS), transfer_date: nul(DATE), agency_id: nul(ID),
        transponder_id: nul(ID), explanation: nul(str(2000)), evidence: arr(EVIDENCE, 10)}),
    ]}, 2000)}),
  }),
};

// ---- Events ----------------------------------------------------------------

const event = (operation, payload) => obj({event_id: ID, at: DT, operation: {const: operation}, payload: obj(payload)});
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Crossway scenario events',
  oneOf: [
    event('crossway.toll.posted', {toll_id: ID, plaza_id: ID, read: en('transponder', 'plate'), plate: PLATE_IN, transponder_id: nul(ID), class: CLASS}),
    event('crossway.card.status_changed', {card_id: ID, status: en('active', 'declined', 'closed')}),
    event('crossway.dispute.decided', {notice_id: ID, grant_if: arr(obj({reason: en(...REASONS), evidence: arr(EVIDENCE, 10)}), 10)}),
  ],
};

// ---- Tools -----------------------------------------------------------------

const VERSION = obj({epoch: int(1, 1000000000), revision: int(0, 1000000000)});
const OBJECT = {type: 'object'};
const LIST = arr(OBJECT, 20000);
const tool = (name, read_only, description, input, required, output) => ({
  name: 'crossway.' + name, description, read_only, scope: 'crossway.' + name, resource_target: 'current account',
  inputSchema: obj(read_only ? input : {expected_version: VERSION, request_id: str(100), ...input},
    read_only ? required : ['expected_version', 'request_id', ...required]),
  outputSchema: obj({status: {const: read_only ? 'ok' : 'committed'}, app_id: {const: app.app_id}, version: VERSION, ...output}),
});
const tools = [
  tool('account.get', true, 'Account summary: status (active, low_balance, suspended), prepaid balance, saved cards with holder, expiry and status, and the auto-replenish rule.', {}, [], {account: OBJECT}),
  tool('account.statements', true, 'Monthly statements (opening and closing balance, tolls, top-ups, auto-replenish, notices issued). A statement is issued at 00:00 on the 1st for the month before.', {period: PERIOD}, [], {statements: LIST, balance_cents: {type: 'integer'}}),
  tool('vehicles.list', true, 'Vehicles on the account with plate, class, possession start and end dates, temporary flag, status (active, ended) and assigned transponder.', {status: en('active', 'ended')}, [], {vehicles: LIST}),
  tool('transponders.list', true, 'Transponders with their charged class and assigned vehicle; class_matches_vehicle shows a transponder charging a class other than its vehicle\'s.', {}, [], {transponders: LIST}),
  tool('tolls.list', true, 'Toll records, newest first: plaza, time, transponder, plate seen, class seen and charged, rate (account or mail), amount and disposition (debited, noticed, unmatched). Dates are authority dates, inclusive.',
    {from: DATE, to: DATE, vehicle_id: ID, plaza_id: ID, transponder_id: ID, plate: PLATE_IN, disposition: en('debited', 'noticed', 'unmatched'), limit: int(1, 500)}, [], {total: {type: 'integer'}, tolls: LIST}),
  tool('notices.list', true, 'Violation notices with state (issued, escalated, collections, paid, disputed, dismissed), amount due, due date, plate, toll date and dispute window.',
    {state: en(...NOTICE_STATES), vehicle_id: ID, plate: PLATE_IN, open_only: BOOL}, [], {notices: LIST}),
  tool('notices.get', true, 'One violation notice with its toll and dispute. Errors: not_found.', {notice_id: ID}, ['notice_id'], {notice: OBJECT, toll: OBJECT, dispute: nul(OBJECT)}),
  tool('disputes.reasons', true, 'Dispute reasons, the fields each one requires, and the dispute rules.', {}, [], {reasons: LIST, rules: arr(str(1000), 50)}),
  tool('disputes.get', true, 'One dispute by dispute_id or notice_id. Errors: not_found, invalid_arguments.', {dispute_id: ID, notice_id: ID}, [], {dispute: OBJECT, notice: OBJECT}),
  tool('policies.get', true, 'Rates by plaza and class (account and mail), late fee, deadlines, ranges and the account rules, including how the clock moves.', {}, [], {policies: OBJECT}),
  tool('account.replenish.set', false, 'Set the auto-replenish rule: on or off, card, amount and low-balance threshold. Errors: amount_out_of_range, card_expired, card_declined, not_found.',
    {enabled: BOOL, card_id: ID, amount_cents: AMOUNT, threshold_cents: AMOUNT}, ['enabled'], {replenish: OBJECT, account_status: str(20)}),
  tool('account.topup.preview', false, 'Preview a top-up of the prepaid balance; the card defaults to the auto-replenish card. Errors: amount_out_of_range, card_expired, card_declined, not_found.',
    {amount_cents: AMOUNT, card_id: ID}, ['amount_cents'], {preview: OBJECT}),
  tool('account.topup.confirm', false, 'Confirm a top-up preview and charge the card. A successful top-up lifts a suspension. Errors: preview_expired, preview_used, card_expired, card_declined, not_found.',
    {preview_id: ID}, ['preview_id'], {receipt: OBJECT, account: OBJECT}),
  tool('vehicles.add', false, 'Add a vehicle. possession_start defaults to today. A temporary (rental) plate needs possession_end within 30 days. Errors: plate_on_another_account, plate_already_listed, end_before_start, temp_too_long, missing_required_field, not_found, invalid_arguments.',
    {plate: PLATE_IN, class: CLASS, label: str(100), possession_start: DATE, temporary: BOOL, possession_end: DATE, rental_agency_id: ID}, ['plate', 'class', 'label'], {vehicle: OBJECT}),
  tool('vehicles.update', false, 'Correct a vehicle\'s possession dates or label, for example the end date of an ended vehicle. Errors: end_before_start, end_in_future, temp_too_long, plate_already_listed, invalid_state, not_found.',
    {vehicle_id: ID, possession_start: DATE, possession_end: DATE, label: str(100)}, ['vehicle_id'], {vehicle: OBJECT}),
  tool('vehicles.end', false, 'End possession of a vehicle on end_date, which defaults to today. Later reads of the plate are not billed here; notices already issued need a dispute. Unassigns its transponder. Errors: end_before_start, end_in_future, invalid_state, not_found.',
    {vehicle_id: ID, end_date: DATE}, ['vehicle_id'], {vehicle: OBJECT, note: str(300)}),
  tool('transponders.assign', false, 'Move a transponder to a vehicle and set its charged class to that vehicle\'s class. Errors: transponder_in_use, invalid_state, not_found.',
    {transponder_id: ID, vehicle_id: ID}, ['transponder_id', 'vehicle_id'], {transponder: OBJECT}),
  tool('notices.pay.preview', false, 'Preview paying one or more notices by card (default: the auto-replenish card). Shows each plate and toll date, the card holder and the total. Payment is final and closes the right to dispute. One ineligible notice rejects the whole preview and is named. Errors: notice_in_dispute, already_paid, in_collections, notice_dismissed, card_expired, card_declined, not_found.',
    {notice_ids: arr(ID, 20, {minItems: 1, uniqueItems: true}), card_id: ID}, ['notice_ids'], {preview: OBJECT}),
  tool('notices.pay.confirm', false, 'Confirm a payment preview and charge the card. Errors: amount_changed (an amount moved since the preview; nothing is charged), notice_in_dispute, already_paid, in_collections, notice_dismissed, preview_expired, preview_used, card_expired, card_declined, not_found.',
    {preview_id: ID}, ['preview_id'], {receipt: OBJECT, notices: LIST}),
  tool('disputes.preview', false, 'Preview a dispute of one notice. Required fields by reason: sold_or_not_in_possession (transfer_date, evidence), paid_by_rental_agency (agency_id, evidence), transponder_malfunction (transponder_id), not_my_plate (explanation). Evidence items are {app_id, account_id, object_id}. Errors: dispute_exists, dispute_window_closed, closed_by_payment, missing_required_field, invalid_evidence_ref, toll_before_transfer, not_found.',
    {notice_id: ID, reason: en(...REASONS), transfer_date: DATE, agency_id: ID, transponder_id: ID, explanation: str(2000), evidence: arr(OBJECT, 10)}, ['notice_id', 'reason'], {preview: OBJECT}),
  tool('disputes.confirm', false, 'Submit a previewed dispute. The notice is frozen until the decision. Errors: dispute_exists, dispute_window_closed, closed_by_payment, preview_expired, preview_used, not_found.',
    {preview_id: ID}, ['preview_id'], {dispute: OBJECT, receipt: OBJECT, notice: OBJECT}),
  tool('disputes.withdraw', false, 'Withdraw a submitted dispute; the notice returns to its prior state with the days that remained. Errors: invalid_state, not_found.',
    {dispute_id: ID}, ['dispute_id'], {dispute: OBJECT, notice: OBJECT}),
];

// ---- State envelope (Core's, with this App's identity) ---------------------

const state = JSON.parse(fs.readFileSync(path.join(root, 'schemas/state.schema.json'), 'utf8'));
state.properties.package_version.const = app.version;
state.properties.app_id.const = app.app_id;

const outputs = {
  'tools.json': tools,
  'schemas/seed.schema.json': seed,
  'schemas/events.schema.json': events,
  'schemas/state.schema.json': state,
};
const check = process.argv.includes('--check');
for (const [file, value] of Object.entries(outputs)) {
  const text = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw Error('Out of date: ' + file);
  } else fs.writeFileSync(target, text);
}
console.log(check ? 'Generated schemas and tools match.' : 'Wrote ' + Object.keys(outputs).join(', '));
