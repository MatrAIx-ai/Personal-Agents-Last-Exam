'use strict';
const { copy } = require('./domain-utils.cjs');
const { effectiveStatus, spent, availableCents, openHolds } = require('./ledger.cjs');
const { dayWindow, monthWindow } = require('./domain-utils.cjs');

function maskCard(card) {
  return {
    card_id: card.card_id,
    type: card.type,
    nickname: card.nickname,
    last_four: card.last_four,
    expiry: card.expiry,
    status: card.status,
    paused_by: card.paused_by,
    closure_reason: card.closure_reason,
    merchant_lock: card.merchant_lock,
    categories: copy(card.categories),
    limits: copy(card.limits),
    funding_source: card.funding_source,
    created_at: card.created_at,
    updated_at: card.updated_at,
    closed_at: card.closed_at
  };
}

function windowReport(data, card, now) {
  const day = dayWindow(now, data.time_zone);
  const month = monthWindow(now, data.time_zone);
  return {
    per_transaction: { limit_cents: card.limits.per_transaction, spent_cents: null },
    per_day: { limit_cents: card.limits.per_day, spent_cents: spent(data, card.card_id, now, 'per_day'), start: day.start, end: day.end },
    per_month: { limit_cents: card.limits.per_month, spent_cents: spent(data, card.card_id, now, 'per_month'), start: month.start, end: month.end },
    lifetime: { limit_cents: card.limits.lifetime, spent_cents: spent(data, card.card_id, now, 'lifetime') }
  };
}

function transactionView(auth, now) {
  return {
    authorization_id: auth.authorization_id,
    authorization_key: auth.authorization_key,
    card_id: auth.card_id,
    merchant_id: auth.merchant_id,
    merchant_name: auth.merchant_name,
    category: auth.category,
    amount_cents: auth.amount_cents,
    currency: auth.currency,
    decision: auth.decision,
    status: auth.status,
    effective_status: effectiveStatus(auth, now),
    hold_cents: effectiveStatus(auth, now) === 'pending' ? auth.hold_cents : 0,
    captured_cents: auth.captured_cents,
    expires_at: auth.expires_at,
    decided_at: auth.decided_at,
    captured_at: auth.captured_at,
    expired_at: auth.expired_at,
    reversed_at: auth.reversed_at,
    merchant_ref: copy(auth.merchant_ref)
  };
}

function lookupView(row, now) {
  if (!row) return null;
  const pending = row.decision === 'approved' && effectiveStatus(row, now) === 'pending';
  return {
    authorization_id: row.authorization_id,
    authorization_key: row.authorization_key,
    decision: row.decision,
    decline_code: row.decline_code,
    amount_cents: row.amount_cents,
    hold_cents: pending ? row.hold_cents : 0,
    card_id: row.card_id,
    merchant_ref: copy(row.merchant_ref),
    decided_at: row.decided_at,
    status: row.decision === 'approved' ? effectiveStatus(row, now) : 'declined'
  };
}

function requestView(request) {
  return {
    change_request_id: request.change_request_id,
    card_id: request.card_id,
    field: request.field,
    merchant_id: request.merchant_id,
    category: request.category,
    from_cents: request.from_cents,
    to_cents: request.to_cents,
    status: request.status,
    mode: request.mode,
    attempts_used: request.attempts_used,
    max_attempts: request.max_attempts,
    created_at: request.created_at,
    expires_at: request.expires_at,
    resolved_at: request.resolved_at
  };
}

function summary(data, now, cardId) {
  const cards = data.cards.filter(card => !cardId || card.card_id === cardId).map(card => ({
    card_id: card.card_id,
    last_four: card.last_four,
    windows: windowReport(data, card, now),
    holds_cents: data.authorizations.filter(auth => auth.card_id === card.card_id && effectiveStatus(auth, now) === 'pending').reduce((sum, auth) => sum + auth.hold_cents, 0)
  }));
  return {
    cards,
    funding_balance_cents: data.funding.balance_cents,
    available_cents: availableCents(data, now),
    open_holds_cents: openHolds(data, now)
  };
}

module.exports = { maskCard, transactionView, lookupView, requestView, summary };
