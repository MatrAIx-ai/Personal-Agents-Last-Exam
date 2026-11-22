'use strict';
const fs = require('node:fs');
const path = require('node:path');
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' };
const time = { type: 'string', format: 'date-time' };
const cents = { type: 'integer', minimum: 0 };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const version = {
  type: 'object',
  properties: { epoch: { type: 'integer', minimum: 1 }, revision: { type: 'integer', minimum: 0 } },
  required: ['epoch', 'revision'],
  additionalProperties: false
};
const expected = {
  type: 'object', required: ['expected_version', 'request_id'], additionalProperties: false,
  properties: {
    expected_version: version,
    request_id: { type: 'string', minLength: 1, maxLength: 120 }
  }
};
function writeInput(extra, required) {
  return {
    type: 'object',
    properties: { ...expected.properties, ...extra },
    required: [...expected.required, ...required],
    additionalProperties: false
  };
}
function readInput(extra, required = []) {
  return { type: 'object', properties: extra, required, additionalProperties: false };
}
function out(status, properties, required) {
  return {
    type: 'object',
    properties: { status: { const: status }, app_id: { const: 'keelcard' }, version, ...properties },
    required: ['status', 'app_id', 'version', ...required],
    additionalProperties: false
  };
}
const category = { type: 'string', enum: ['grocery', 'restaurants', 'travel', 'telecom', 'domains_hosting', 'digital_goods', 'crypto', 'gift_cards', 'healthcare', 'utilities', 'entertainment', 'education', 'transport', 'general_merchandise'] };
const limits = {
  type: 'object',
  properties: { per_transaction: nullable(cents), per_day: nullable(cents), per_month: nullable(cents), lifetime: nullable(cents) },
  required: ['per_transaction', 'per_day', 'per_month', 'lifetime'],
  additionalProperties: false
};
const card = {
  type: 'object',
  properties: {
    card_id: id, type: { enum: ['single_use', 'merchant_locked', 'category_locked', 'general'] }, nickname: { type: 'string' },
    last_four: { type: 'string' }, expiry: { type: 'string' }, status: { enum: ['active', 'paused', 'closed'] },
    paused_by: nullable({ enum: ['owner', 'delegate'] }), closure_reason: nullable({ enum: ['closed', 'single_use'] }),
    merchant_lock: nullable(id), categories: { type: 'array', items: category }, limits, funding_source: { const: 'local' },
    created_at: time, updated_at: time, closed_at: nullable(time)
  },
  required: ['card_id', 'type', 'nickname', 'last_four', 'expiry', 'status', 'paused_by', 'closure_reason', 'merchant_lock', 'categories', 'limits', 'funding_source', 'created_at', 'updated_at', 'closed_at'],
  additionalProperties: false
};
const merchantRef = nullable({
  type: 'object',
  properties: { app_id: id, account_id: id, object_type: { type: 'string' }, object_id: id },
  required: ['app_id', 'account_id', 'object_type', 'object_id'],
  additionalProperties: false
});
const transaction = {
  type: 'object',
  properties: {
    authorization_id: id, authorization_key: id, card_id: id, merchant_id: id, merchant_name: { type: 'string' }, category,
    amount_cents: cents, currency: { const: 'USD' }, decision: { const: 'approved' },
    status: { enum: ['pending', 'captured', 'reversed', 'expired'] }, effective_status: { enum: ['pending', 'captured', 'reversed', 'expired'] },
    hold_cents: cents, captured_cents: cents, expires_at: time, decided_at: time, captured_at: nullable(time), expired_at: nullable(time), reversed_at: nullable(time), merchant_ref: merchantRef
  },
  required: ['authorization_id', 'authorization_key', 'card_id', 'merchant_id', 'merchant_name', 'category', 'amount_cents', 'currency', 'decision', 'status', 'effective_status', 'hold_cents', 'captured_cents', 'expires_at', 'decided_at', 'captured_at', 'expired_at', 'reversed_at', 'merchant_ref'],
  additionalProperties: false
};
const request = {
  type: 'object',
  properties: {
    change_request_id: id, card_id: id, field: { type: 'string' }, merchant_id: nullable(id), category: nullable(category),
    from_cents: nullable(cents), to_cents: nullable(cents),
    status: { enum: ['pending_verification', 'pending_owner', 'applied', 'failed', 'expired', 'cancelled', 'denied'] },
    mode: { enum: ['email_code', 'owner_approval'] }, attempts_used: { type: 'integer', minimum: 0 }, max_attempts: { type: 'integer', minimum: 1 },
    created_at: time, expires_at: time, resolved_at: nullable(time)
  },
  required: ['change_request_id', 'card_id', 'field', 'merchant_id', 'category', 'from_cents', 'to_cents', 'status', 'mode', 'attempts_used', 'max_attempts', 'created_at', 'expires_at', 'resolved_at'],
  additionalProperties: false
};
const window = {
  type: 'object',
  properties: { limit_cents: nullable(cents), spent_cents: nullable(cents), start: time, end: time },
  required: ['limit_cents', 'spent_cents'],
  additionalProperties: false
};
const tools = [
  ['keelcard.cards.list', true, 'List cards on this account. Closed cards stay hidden unless include_closed is true. Full numbers stay off this result.', readInput({ query: { type: 'string', maxLength: 80 }, include_closed: { type: 'boolean' } }), out('ok', { cards: { type: 'array', items: card } }, ['cards'])],
  ['keelcard.cards.get', true, 'Read one masked card.', readInput({ card_id: id }, ['card_id']), out('ok', { card }, ['card'])],
  ['keelcard.controls.get', true, 'Read limits, blocks, alerts and the verification mode. Codes are not included.', readInput({}), out('ok', {
    verification: { type: 'object' }, delegate: { type: 'object' }, alerts: { type: 'object' },
    category_blocks: { type: 'array', items: category }, merchant_blocks: { type: 'array', items: id }, cards: { type: 'array', items: card }
  }, ['verification', 'delegate', 'alerts', 'category_blocks', 'merchant_blocks', 'cards'])],
  ['keelcard.controls.requests.list', true, 'List change requests without verification codes.', readInput({ card_id: id }), out('ok', { requests: { type: 'array', items: request } }, ['requests'])],
  ['keelcard.transactions.list', true, 'List authorizations with effective status. Expired holds drop out of the effective status before settlement.', readInput({ card_id: id }), out('ok', { transactions: { type: 'array', items: transaction } }, ['transactions'])],
  ['keelcard.transactions.get', true, 'Read one authorization.', readInput({ authorization_id: id }, ['authorization_id']), out('ok', { transaction }, ['transaction'])],
  ['keelcard.declines.list', true, 'List committed declines. A decline does not change limits, holds or balance.', readInput({ card_id: id }), out('ok', { declines: { type: 'array', items: { type: 'object' } } }, ['declines'])],
  ['keelcard.spend.summary', true, 'Spent amounts against each limit for the current day, month and lifetime.', readInput({ card_id: id }), out('ok', { summary: { type: 'object' } }, ['summary'])],
  ['keelcard.authorizations.lookup', true, 'Read the decision for an authorization key. Unknown keys return a null authorization and no card details.', readInput({ authorization_key: id }, ['authorization_key']), out('ok', { authorization: nullable({ type: 'object' }) }, ['authorization'])],
  ['keelcard.statements.list', true, 'List issued monthly statements.', readInput({}), out('ok', { statements: { type: 'array', items: { type: 'object' } } }, ['statements'])],
  ['keelcard.cards.create', false, 'Create a card at or under the owner ceiling. The full number is stored and a masked result is returned.', writeInput({
    type: { enum: ['single_use', 'merchant_locked', 'category_locked', 'general'] },
    nickname: { type: 'string', minLength: 1, maxLength: 80 },
    limits: { type: 'object', properties: { per_transaction: cents, per_day: cents, per_month: cents, lifetime: cents }, required: ['per_transaction', 'per_day', 'per_month', 'lifetime'], additionalProperties: false },
    categories: { type: 'array', items: category }
  }, ['type', 'nickname', 'limits']), out('committed', { card_id: id, last_four: { type: 'string' }, card_status: { const: 'active' }, type: { type: 'string' } }, ['card_id', 'last_four', 'card_status', 'type'])],
  ['keelcard.cards.update', false, 'Change a card nickname.', writeInput({ card_id: id, nickname: { type: 'string', minLength: 1, maxLength: 80 } }, ['card_id', 'nickname']), out('committed', { card_id: id, nickname: { type: 'string' } }, ['card_id', 'nickname'])],
  ['keelcard.cards.pause', false, 'Pause an active card. The delegate can unpause this directly.', writeInput({ card_id: id }, ['card_id']), out('committed', { card_id: id, card_status: { const: 'paused' }, paused_by: { const: 'delegate' } }, ['card_id', 'card_status', 'paused_by'])],
  ['keelcard.cards.unpause', false, 'Unpause a card this delegate paused. An owner pause needs a change request.', writeInput({ card_id: id }, ['card_id']), out('committed', { card_id: id, card_status: { const: 'active' } }, ['card_id', 'card_status'])],
  ['keelcard.cards.close', false, 'Close a card. Closing is irreversible.', writeInput({ card_id: id }, ['card_id']), out('committed', { card_id: id, card_status: { const: 'closed' } }, ['card_id', 'card_status'])],
  ['keelcard.cards.reveal', false, 'Record a disclosure and return the full number, expiry and security code when the delegate is allowed to reveal.', writeInput({ card_id: id }, ['card_id']), out('committed', { card_id: id, number: { type: 'string' }, expiry: { type: 'string' }, security_code: { type: 'string' }, last_four: { type: 'string' } }, ['card_id', 'number', 'expiry', 'security_code', 'last_four'])],
  ['keelcard.controls.lower', false, 'Lower one limit immediately.', writeInput({ card_id: id, field: { enum: ['per_transaction', 'per_day', 'per_month', 'lifetime'] }, amount_cents: cents }, ['card_id', 'field', 'amount_cents']), out('committed', { card_id: id, field: { type: 'string' }, limit_cents: cents }, ['card_id', 'field', 'limit_cents'])],
  ['keelcard.controls.block', false, 'Block a merchant or a category immediately.', writeInput({ kind: { enum: ['merchant', 'category'] }, merchant_id: id, category, card_id: id }, ['kind']), out('committed', { kind: { type: 'string' }, merchant_id: nullable(id), category: nullable(category) }, ['kind', 'merchant_id', 'category'])],
  ['keelcard.controls.request_change', false, 'Open a step-up request to raise a limit, remove a block, or unpause an owner-paused card. The code stays off this result.', writeInput({
    card_id: id, field: { enum: ['per_transaction', 'per_day', 'per_month', 'lifetime', 'merchant_unblock', 'category_unblock', 'unpause'] },
    amount_cents: cents, merchant_id: id, category
  }, ['card_id', 'field']), out('committed', { change_request_id: id, request_status: { type: 'string' }, expires_at: time, card_id: id, field: { type: 'string' }, limit_cents: nullable(cents) }, ['change_request_id', 'request_status', 'expires_at', 'card_id', 'field', 'limit_cents'])],
  ['keelcard.controls.confirm_change', false, 'Confirm an email-code request. Wrong codes, exhausted attempts and expiry commit. Owner-approval mode rejects the call.', writeInput({ change_request_id: id, code: { type: 'string', minLength: 1, maxLength: 12 } }, ['change_request_id', 'code']), out('committed', {
    change_request_id: id, outcome: { enum: ['applied', 'code_rejected', 'attempts_exhausted', 'code_expired'] },
    attempts_used: { type: 'integer', minimum: 0 }, attempts_remaining: { type: 'integer', minimum: 0 }, limit_cents: nullable(cents)
  }, ['change_request_id', 'outcome', 'attempts_used', 'attempts_remaining', 'limit_cents'])],
  ['keelcard.controls.cancel_request', false, 'Cancel an open change request.', writeInput({ change_request_id: id }, ['change_request_id']), out('committed', { change_request_id: id, request_status: { const: 'cancelled' } }, ['change_request_id', 'request_status'])]
];
const document = tools.map(([name, readOnly, description, inputSchema, outputSchema]) => ({
  name, description, read_only: readOnly, scope: name, resource_target: 'current account', inputSchema, outputSchema
}));
fs.writeFileSync(path.join(__dirname, '../tools.json'), JSON.stringify(document, null, 2) + '\n');
console.log('tools', document.length);
if (require.main === module) { /* written */ }
