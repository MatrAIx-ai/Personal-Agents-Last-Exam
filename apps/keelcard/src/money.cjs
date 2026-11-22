'use strict';
const { fail, money } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');
const { maybe } = require('./notices.cjs');
const { postLedger } = require('./ledger.cjs');

function findAuthorization(data, payload) {
  const id = payload.transaction_id || payload.authorization_id;
  const row = data.authorizations.find(item => item.authorization_id === id);
  if (!row) fail('not_found', 'Transaction does not exist.');
  return row;
}

function sameRefund(existing, payload) {
  return existing.authorization_id === (payload.transaction_id || payload.authorization_id) && existing.amount_cents === payload.amount_cents;
}

function applyRefund(ctx, data, row, amount, key, source) {
  const prior = data.refunds.find(item => item.refund_key === key);
  if (prior) {
    if (!sameRefund(prior, { transaction_id: row.authorization_id, amount_cents: amount })) {
      fail('refund_key_conflict', 'This refund key already belongs to a different refund.');
    }
    return prior;
  }
  if (!['captured', 'partially_refunded'].includes(row.status)) fail('not_refundable', 'Only a captured charge can be refunded.');
  if (!Number.isInteger(amount) || amount <= 0) fail('invalid_event', 'Refund amount must be a positive integer.');
  if (row.refunded_cents + amount > row.captured_cents) fail('refund_exceeds_captured', 'Refund amount is above the captured amount.');
  row.refunded_cents += amount;
  row.status = row.refunded_cents === row.captured_cents ? 'refunded' : 'partially_refunded';
  const entry = postLedger(data, {
    at: ctx.virtual_now, kind: 'refund', direction: 'credit', amount_cents: amount,
    authorization_id: row.authorization_id, card_id: row.card_id
  });
  const refund = {
    refund_id: require('./domain-utils.cjs').nextSerial(data.refunds, 'refund_id', 'rfd-'),
    refund_key: key,
    authorization_id: row.authorization_id,
    amount_cents: amount,
    at: ctx.virtual_now,
    source,
    entry_id: entry.entry_id
  };
  data.refunds.push(refund);
  const card = data.cards.find(item => item.card_id === row.card_id);
  maybe(ctx, data, data.alerts.receipts, {
    kind: 'refund',
    title: 'Keelcard refund',
    body: row.merchant_name + ' refunded ' + money(amount) + ' on card ' + (card ? card.last_four : row.card_id) + '.',
    source_object: { object_type: 'refund', object_id: refund.refund_id },
    related_id: row.authorization_id
  });
  log(ctx, 'keelcard.refunded', { refund_id: refund.refund_id, authorization_id: row.authorization_id, amount_cents: amount });
  return refund;
}

function issueRefund(ctx, data, payload) {
  if (!payload.refund_key) fail('invalid_event', 'Refund requires refund_key.');
  const row = findAuthorization(data, payload);
  if (row.status === 'pending' || row.status === 'reversed' || row.status === 'expired') {
    fail('not_refundable', 'A pending authorization is not a captured charge.');
  }
  return applyRefund(ctx, data, row, payload.amount_cents, payload.refund_key, 'refund.issue');
}

function topUp(ctx, data, payload) {
  if (!payload.top_up_key) fail('invalid_event', 'Top-up requires top_up_key.');
  if (!Number.isInteger(payload.amount_cents) || payload.amount_cents <= 0) fail('invalid_event', 'Top-up amount must be a positive integer.');
  const prior = data.top_ups.find(item => item.top_up_key === payload.top_up_key);
  if (prior) {
    if (prior.amount_cents !== payload.amount_cents) fail('top_up_key_conflict', 'This top-up key already belongs to a different amount.');
    return prior;
  }
  const entry = postLedger(data, {
    at: ctx.virtual_now, kind: 'top_up', direction: 'credit', amount_cents: payload.amount_cents, authorization_id: null, card_id: null
  });
  const row = {
    top_up_id: require('./domain-utils.cjs').nextSerial(data.top_ups, 'top_up_id', 'tup-'),
    top_up_key: payload.top_up_key,
    amount_cents: payload.amount_cents,
    at: ctx.virtual_now,
    entry_id: entry.entry_id
  };
  data.top_ups.push(row);
  log(ctx, 'keelcard.top_up', { top_up_id: row.top_up_id, amount_cents: row.amount_cents });
  return row;
}

module.exports = { issueRefund, applyRefund, topUp };
