'use strict';
// Writes schemas/seed.schema.json, schemas/events.schema.json and tools.json from one set of record shapes.
// Run `node dev/build.cjs` after a change, or `node dev/build.cjs --check` to compare with the committed files.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'brindle';

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
// A day that the App computes from a stored time can fall after 2999.
const COMPUTED_DAY = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const POSITIVE = {type: 'number', minimum: 0.01, maximum: 100000000};
const AMOUNT = {type: 'number', minimum: 0, maximum: 100000000};
// A statement balance can be below zero (a credit balance).
const SIGNED = {type: 'number', minimum: -100000000, maximum: 100000000};
// Sums that the App computes have no bound.
const SUM = {type: 'number'};
const POINTS = {type: 'integer', minimum: 1, maximum: 100000000};
const SIGNED_POINTS = {type: 'integer', minimum: -100000000, maximum: 100000000};
const COUNT = {type: 'integer', minimum: 0};
const BOOL = {type: 'boolean'};
const NUMBER = {type: 'number'};
const RATE = {type: 'number', minimum: 0.01, maximum: 100};
const RULE_DAYS = {type: 'integer', minimum: 1, maximum: 3660};

const KIND = en('purchase', 'refund', 'fee', 'interest', 'credit', 'provisional_credit', 'reversal');
const TX_STATE = en('pending', 'posted', 'dropped');
const PAYMENT_STATE = en('scheduled', 'posted', 'skipped', 'cancelled', 'returned');
const AMOUNT_TYPE = en('fixed', 'minimum_due', 'statement_balance', 'current_balance');
const AUTOPAY_MODE = en('off', 'minimum_due', 'statement_balance');
const DISPUTE_STATE = en('open', 'withdrawn', 'resolved_for_me', 'resolved_for_merchant', 'closed_matched');
const REASON = en('not_received', 'not_as_described', 'credit_not_processed', 'duplicate_charge', 'wrong_amount', 'not_recognized', 'cancelled_recurring', 'other');
const OFFER_KIND = en('statement_credit', 'spend_credit', 'bonus_points', 'product_change');
const OFFER_STATE = en('available', 'enrolled', 'declined', 'expired', 'unavailable');
const CONDITION = en('open', 'met', 'missed');
const POINTS_REASON = en('earned', 'bonus', 'adjustment', 'redeemed', 'transferred', 'forfeited');
const EVENT_POINTS_REASON = en('earned', 'bonus', 'adjustment');
const NOTICE_KINDS = en('transaction.posted', 'statement.issued', 'payment.returned', 'dispute.updated', 'offer.issued', 'points.adjusted');
const OBJECT_TYPES = en('transaction', 'statement', 'payment', 'dispute', 'offer', 'points_entry');
const ACCOUNT_FLAGS = arr(en('past_due', 'statement_unpaid', 'payment_returned', 'credit_balance', 'fee_refund_open'), {uniqueItems: true});
const PURCHASE_FLAGS = arr(en('disputed', 'temporary_credit', 'double_credited'), {uniqueItems: true});
const OFFER_FLAGS = arr(en('condition_met', 'condition_missed'), {uniqueItems: true});

// Stored records.
const ACTOR = en('agent', 'event');
const history = (extra = {}) => arr(obj({at: TIME, action: text(80), actor: ACTOR, ref: ID, ...extra}));
const rules = obj({dispute_window_days: RULE_DAYS, fee_refund_days: RULE_DAYS, redeem_cents_per_point: RATE, min_redeem_points: POINTS});
const issuer = obj({name: text(200), timezone: text(64), rules});
const partner = obj({id: ID, name: text(120), ratio: RATE, min_points: POINTS, step: POINTS});
const product = obj({id: ID, name: text(120), annual_fee: nullable(POSITIVE), partners: arr(partner, {maxItems: 20})});
const feeRefund = obj({fee_id: ID, amount: POSITIVE, cause: en('closing', 'product_change'), recorded_at: TIME, request_id: ID});
const autopay = obj({mode: AUTOPAY_MODE, source: text(120)});
const accountHistory = history({from: nullable(text(120)), to: nullable(text(120))});
const account = obj({product_id: ID, credit_limit: POSITIVE, state: en('open', 'closed'), opened_at: TIME, closed_at: nullable(TIME), autopay,
  fee_refunds: arr(feeRefund), history: accountHistory});
const preferences = obj({timezone: text(64), email_notices: BOOL});
const statement = {id: ID, closing_at: TIME, issued_at: TIME, due_at: TIME, statement_balance: SIGNED, minimum_due: AMOUNT, event_id: nullable(ID),
  autopay_payment_id: nullable(ID)};
const transaction = {id: ID, kind: KIND, state: TX_STATE, amount: POSITIVE, pending_amount: nullable(POSITIVE), merchant: nullable(text(120)), note: nullable(text(500)),
  transaction_at: TIME, added_at: TIME, posted_at: nullable(TIME), dropped_at: nullable(TIME), drop_reason: nullable(text(500)), relates_to: nullable(ID),
  dispute_id: nullable(ID), offer_id: nullable(ID), fee_type: nullable(en('annual', 'other')), points_entry_id: nullable(ID), event_id: nullable(ID),
  request_id: nullable(ID), history: history({amount: nullable(POSITIVE)})};
const payment = {id: ID, source: text(120), amount_type: AMOUNT_TYPE, statement_id: nullable(ID), scheduled_amount: POSITIVE, autopay: BOOL, pay_on: DAY,
  posts_at: TIME, scheduled_at: TIME, cancelled_at: nullable(TIME), returned_at: nullable(TIME), return_reason: nullable(text(500)),
  request_id: nullable(ID), event_id: nullable(ID), history: history()};
const disputeHistory = arr(obj({at: TIME, status: DISPUTE_STATE, note: nullable(text(2000)), actor: ACTOR, ref: ID, credit_id: nullable(ID), reversal_id: nullable(ID)}));
const dispute = {id: ID, transaction_id: ID, amount: POSITIVE, reason: REASON, note: text(2000), opened_at: TIME, request_id: nullable(ID), state: DISPUTE_STATE,
  withdrawn_at: nullable(TIME), ended_at: nullable(TIME), history: disputeHistory};
const offer = {id: ID, kind: OFFER_KIND, group: nullable(ID), terms: text(2000), accept_by: TIME, issued_at: TIME, event_id: nullable(ID),
  credit_amount: nullable(POSITIVE), spend_target: nullable(POSITIVE), spend_days: nullable(RULE_DAYS), points: nullable(POINTS), product_id: nullable(ID),
  enrolled_at: nullable(TIME), declined_at: nullable(TIME), unavailable_at: nullable(TIME), unavailable_cause: nullable(en('group', 'closing')),
  request_id: nullable(ID), history: history()};
const transfer = obj({partner_id: ID, partner_name: text(120), member_name: text(120), partner_points: COUNT});
const pointsEntry = obj({id: ID, at: TIME, points: SIGNED_POINTS, reason: POINTS_REASON, note: nullable(text(500)), offer_id: nullable(ID), transaction_id: nullable(ID),
  transfer: nullable(transfer), event_id: nullable(ID), request_id: nullable(ID), history: history()});
const wire = {type: 'object'};
const notification = obj({id: ID, at: TIME, kind: NOTICE_KINDS, event_id: ID, object_type: OBJECT_TYPES, object_id: ID, title: text(200), text: text(4000), email: nullable(wire)});
const activity = obj({seq: {type: 'integer', minimum: 1}, at: TIME, actor: ACTOR, action: text(80), object_id: ID,
  request_id: nullable(ID), event_id: nullable(ID), effect: BOOL});
const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:brindle:seed:1', ...obj({
    account_id: ID, owner_person_id: ID, issuer, products: arr(product, {minItems: 1, maxItems: 20}), account, preferences,
    // A list that calls or events can grow has no upper bound.
    statements: arr(obj(statement)), transactions: arr(obj(transaction)), payments: arr(obj({...payment, stored_state: en('scheduled', 'cancelled', 'returned')})),
    disputes: arr(obj(dispute)), offers: arr(obj({...offer, stored_state: en('available', 'enrolled', 'declined', 'unavailable')})), points_entries: arr(pointsEntry),
    notifications: arr(notification), activity: arr(activity)
  })
};

// Views: stored records plus the values the App computes from the clock when it is read.
const recovery = obj({amount: POSITIVE, refunded_final: SUM, temporary_credit: SUM, net_charge: SUM});
const txRow = obj({id: ID, kind: KIND, state: TX_STATE, amount: POSITIVE, merchant: nullable(text(120)), transaction_at: TIME, posted_at: nullable(TIME),
  relates_to: nullable(ID), dispute_id: nullable(ID), flags: PURCHASE_FLAGS});
const txView = obj({...transaction, flags: PURCHASE_FLAGS});
const paymentView = obj({...payment, state: PAYMENT_STATE, posted_amount: nullable(AMOUNT)});
const disputeView = obj({...dispute, merchant: nullable(text(120)), purchase_amount: POSITIVE, outstanding: SUM});
const spend = nullable(obj({target: POSITIVE, progress: SUM, deadline: NOW, condition: CONDITION}));
const offerView = obj({...offer, state: OFFER_STATE, spend, flags: OFFER_FLAGS, paid_by: arr(ID)});
const statementRow = obj({...statement, paid_toward: SUM, due_passed: BOOL});
const statementView = obj({...statement, paid_toward: SUM, due_passed: BOOL, payments: arr(paymentView), transaction_ids: arr(ID)});
const latest = nullable(obj({id: ID, closing_at: TIME, due_at: TIME, statement_balance: SIGNED, minimum_due: AMOUNT, paid_toward: SUM,
  minimum_left: SUM, balance_left: SUM, due_passed: BOOL}));
const options = obj({minimum_due: nullable(SUM), statement_balance: nullable(SUM), current_balance: SUM});
const accountView = obj({product_id: ID, credit_limit: POSITIVE, state: en('open', 'closed'), opened_at: TIME, closed_at: nullable(TIME), autopay,
  fee_refunds: arr(feeRefund)});
const noticeRow = obj({id: ID, at: TIME, kind: NOTICE_KINDS, event_id: ID, object_type: OBJECT_TYPES, object_id: ID, title: text(200), text: text(4000), email_stored: BOOL});
const feeRefundPreview = nullable(obj({fee_id: ID, amount: POSITIVE, until: COMPUTED_DAY}));
const offerBrief = obj({id: ID, kind: OFFER_KIND, state: OFFER_STATE, terms: text(2000)});

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

read('account.get', 'Read the account: the product with its annual fee and transfer partners, the credit limit, the state, the balance, `pending_total`, `available_credit`, the latest statement with what has been paid toward it, what each payment choice would pay now, the autopay setting, the points balance, the flags and the issuer\'s four rule values. Every read returns the current virtual time as `now`, with the issuer\'s UTC offset.',
  {}, [], {account_id: ID, owner_person_id: ID, issuer, product, products: arr(product), account: accountView, balance: SUM, pending_total: SUM, available_credit: SUM,
    latest_statement: latest, payment_options: options, points_balance: {type: 'integer'}, flags: ACCOUNT_FLAGS});
read('account.close_preview', 'Check what closing the account now would do. Writes nothing. Returns the points that would be lost, the annual fee refund and its last day, the offers that would end, the accepted bonus offers whose points have not arrived, and what stays open after a closing.',
  {}, [], {already_closed: BOOL, points_lost: COUNT, fee_refund: feeRefundPreview, offers_ending: arr(offerBrief), bonus_not_arrived: arr(offerBrief),
    stays_open: obj({balance: SUM, scheduled_payments: arr(ID), open_disputes: arr(ID), pending_transactions: arr(ID), credits_owed: arr(ID)})});
read('transactions.list', 'List transactions with a transaction time on a day in a window (`start` to `end`, both included, in the issuer\'s time zone), by kind, state or merchant (exact name, any case). Sorted by transaction time.',
  {...RANGE, kind: KIND, state: TX_STATE, merchant: text(120)}, ['start', 'end', 'kind', 'state', 'merchant'], {items: arr(txRow)});
read('transactions.get', 'Read one transaction with every transaction that relates to it, the disputes of a purchase, its recovery summary (`refunded_final`, `temporary_credit`, `net_charge`) and flags, and the offer it names.',
  {id: ID}, [], {transaction: txView, related: arr(txRow), disputes: arr(disputeView), recovery: nullable(recovery), offer: nullable(offerView)});
read('statements.list', 'List statements with a closing day in a window (`start` to `end`, both included), with what has been paid toward each one.',
  RANGE, ['start', 'end'], {items: arr(statementRow)});
read('statements.get', 'Read one statement with what has been paid toward it, the payments toward it, and the transactions posted in its cycle.',
  {id: ID}, [], {statement: statementView});
read('payments.list', 'List payments with a payment day in a window (`start` to `end`, both included), by state. A payment reads `posted` from the start of its day, or `skipped` when autopay had nothing left to pay.',
  {...RANGE, state: PAYMENT_STATE}, ['start', 'end', 'state'], {items: arr(paymentView)});
read('disputes.list', 'List disputes by state, for one purchase or for all. `id` is a purchase.',
  {id: ID, state: DISPUTE_STATE}, ['id', 'state'], {items: arr(disputeView)});
read('disputes.get', 'Read one dispute with its history, its purchase, and its outstanding temporary credit.',
  {id: ID}, [], {dispute: disputeView});
read('offers.list', 'List offers by state and kind. An available offer reads `expired` once its `accept_by` has passed.',
  {state: OFFER_STATE, kind: OFFER_KIND}, ['state', 'kind'], {items: arr(offerView)});
read('offers.get', 'Read one offer with its state, its terms, the credits or points entries that paid it, and for an accepted spending offer its progress, deadline and condition.',
  {id: ID}, [], {offer: offerView});
read('rewards.get', 'Read the points balance, the points entries (newest first) and the transfer partners of the current product, each with its ratio, smallest amount and step.',
  {}, [], {balance: {type: 'integer'}, entries: arr(pointsEntry), partners: arr(partner)});
read('notifications.list', 'List notifications written on a day in a window (`start` to `end`, both included). `email_stored` means the App stored an email message for the Infra sender. It does not mean that Mail received it.',
  RANGE, ['start', 'end'], {items: arr(noticeRow)});
read('preferences.get', 'Read the notification preferences of the account.', {}, [], {preferences});

const SCHEDULED = {id: ID, state: en('scheduled', 'posted'), scheduled_amount: POSITIVE, pay_on: DAY, posts_at: TIME};
write('payments.schedule', 'Schedule a payment for today or a later day (`pay_on`), from a named bank account (`source`). `amount_type` is `fixed` (give `amount`, at most two decimals), `minimum_due`, `statement_balance` or `current_balance`. The amount is set now. `id` is the account. A payment for today posts at once. Returns the `id` of the new payment.',
  {id: ID, amount_type: AMOUNT_TYPE, amount: POSITIVE, pay_on: DAY, source: text(120)}, ['amount'], SCHEDULED,
  {oneOf: [{properties: {amount_type: {const: 'fixed'}}, required: ['amount']},
    {properties: {amount_type: en('minimum_due', 'statement_balance', 'current_balance'), amount: {type: 'null'}}}]});
write('payments.cancel', 'Cancel a scheduled payment before the start of its day. An autopay payment can be cancelled too: the autopay setting stays, and no new payment is scheduled for that statement.',
  {id: ID}, [], {id: ID, state: {const: 'cancelled'}});
write('autopay.set', 'Set autopay to `off`, `minimum_due` or `statement_balance`, with an optional new `source`. `id` is the account. A new setting does not touch a payment that is already scheduled, and turning autopay on schedules nothing for a statement that is already issued.',
  {id: ID, mode: AUTOPAY_MODE, source: text(120)}, ['source'], {id: ID, mode: AUTOPAY_MODE, source: text(120)});
write('disputes.open', 'Dispute a posted purchase for an amount (at most two decimals, at most its `net_charge`), with a reason and a note. `id` is the purchase. Returns the `id` of the new dispute.',
  {id: ID, amount: POSITIVE, reason: REASON, note: text(2000)}, [], {id: ID, state: {const: 'open'}});
write('disputes.withdraw', 'Withdraw an open dispute. A dispute is not edited: withdraw it and open another. A temporary credit stays temporary until the issuer reverses it.',
  {id: ID, note: text(2000)}, ['note'], {id: ID, state: {const: 'withdrawn'}});
write('offers.accept', 'Accept an available offer. The other available offers of its group become unavailable. A product change moves the account to the new product at once. The issuer pays a credit or bonus points later. This cannot be undone.',
  {id: ID}, [], {id: ID, state: {const: 'enrolled'}, unavailable: arr(ID), product_id: ID, fee_refund: nullable(obj({fee_id: ID, amount: POSITIVE}))});
write('offers.decline', 'Decline an available offer. No other offer changes. This cannot be undone.',
  {id: ID}, [], {id: ID, state: {const: 'declined'}});
write('rewards.redeem', 'Redeem points as a statement credit of the points times `redeem_cents_per_point`, rounded down to the cent. `id` is the account. Returns the `id` of the new points entry and the credit. This cannot be undone.',
  {id: ID, points: POINTS}, [], {id: ID, points_left: {type: 'integer'}, credit_id: ID, credit_amount: AMOUNT});
write('rewards.transfer', 'Transfer points to a partner program of the current product, in whole steps and at least its smallest amount, for the member name given. The partner receives the points times its ratio, rounded down. `id` is the account. This cannot be undone.',
  {id: ID, partner_id: ID, points: POINTS, member_name: text(120)}, [], {id: ID, points_left: {type: 'integer'}, partner_points: COUNT});
write('account.close', 'Close the account. This cannot be undone. The whole points balance is lost, autopay turns off, available offers end, and an annual fee refund is recorded when the closing is within `fee_refund_days` of the fee. Scheduled payments and disputes go on. `id` is the account.',
  {id: ID}, [], {id: ID, state: {const: 'closed'}, points_forfeited: COUNT, fee_refund: nullable(obj({fee_id: ID, amount: POSITIVE}))});
write('preferences.update', 'Set the time zone used in notification text, or `email_notices`. Give at least one of them.',
  {timezone: text(64), email_notices: BOOL}, ['timezone', 'email_notices'], {id: ID}, {anyOf: [{required: ['timezone']}, {required: ['email_notices']}]});

// Events: structure only. The handler checks the plan's rules and answers `invalid_event`.
const NO = {type: 'null'};
const txBase = {transaction_id: ID, kind: KIND, state: en('pending', 'posted'), amount: NUMBER, merchant: text(120), relates_to: ID, note: text(500),
  transaction_at: TIME, fee_type: en('annual', 'other'), offer_id: ID, dispute_id: ID};
const txOptional = ['merchant', 'relates_to', 'note', 'transaction_at', 'fee_type', 'offer_id', 'dispute_id'];
// A fee names its type, a credit may name the offer it pays, and a reversal names its dispute instead of a purchase.
const txKinds = {oneOf: [
  {properties: {kind: en('purchase', 'refund', 'interest', 'provisional_credit'), fee_type: NO, offer_id: NO, dispute_id: NO}},
  {properties: {kind: {const: 'credit'}, fee_type: NO, dispute_id: NO}},
  {properties: {kind: {const: 'fee'}, offer_id: NO, dispute_id: NO}, required: ['fee_type']},
  {properties: {kind: {const: 'reversal'}, relates_to: NO, fee_type: NO, offer_id: NO}, required: ['dispute_id']}
]};
const move = obj({transaction_id: ID, amount: NUMBER});
const offerBase = {offer_id: ID, kind: OFFER_KIND, group: ID, terms: text(2000), accept_by: TIME, credit_amount: NUMBER, spend_target: NUMBER,
  spend_days: RULE_DAYS, points: POINTS, product_id: ID};
const offerKinds = {oneOf: [
  {properties: {kind: {const: 'statement_credit'}, spend_target: NO, spend_days: NO, points: NO, product_id: NO}, required: ['credit_amount']},
  {properties: {kind: {const: 'spend_credit'}, points: NO, product_id: NO}, required: ['credit_amount', 'spend_target', 'spend_days']},
  {properties: {kind: {const: 'bonus_points'}, credit_amount: NO, spend_target: NO, spend_days: NO, product_id: NO}, required: ['points']},
  {properties: {kind: {const: 'product_change'}, credit_amount: NO, spend_target: NO, spend_days: NO, points: NO}, required: ['product_id']}
]};
const payloads = {
  'transaction.posted': {...obj(txBase, txOptional), ...txKinds},
  'transaction.dropped': obj({transaction_id: ID, reason: text(500)}, ['reason']),
  'statement.issued': obj({statement_id: ID, closing_at: TIME, statement_balance: NUMBER, minimum_due: NUMBER, due_at: TIME}),
  'payment.returned': obj({payment_id: ID, reason: text(500)}, ['reason']),
  'dispute.updated': obj({dispute_id: ID, status: en('open', 'resolved_for_me', 'resolved_for_merchant', 'closed_matched'), provisional_credit: move, reversal: move,
    note: text(2000)}, ['provisional_credit', 'reversal', 'note']),
  'offer.issued': {...obj(offerBase, ['group', 'credit_amount', 'spend_target', 'spend_days', 'points', 'product_id']), ...offerKinds},
  'points.adjusted': obj({entry_id: ID, points: {type: 'integer', minimum: -100000000, maximum: 100000000}, reason: EVENT_POINTS_REASON, note: text(500), offer_id: ID},
    ['note', 'offer_id'])
};
const eventId = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const events = {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:brindle:events:1',
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
