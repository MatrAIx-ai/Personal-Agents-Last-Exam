'use strict';
const { fail, CATEGORIES, LIMIT_FIELDS, luhnOk, references, dayWindow, monthWindow } = require('./domain-utils.cjs');
const { completedMonths } = require('./ledger.cjs');

function atSeedClock(ctx, data) {
  if (!data.initial_clock) return true;
  return Date.parse(ctx.virtual_now) === Date.parse(data.initial_clock);
}

function assertLoadClock(data, virtualNow) {
  if (!data || !data.initial_clock) fail('invalid_seed', 'The seed must declare an initial clock.');
  if (!virtualNow || Date.parse(virtualNow) !== Date.parse(data.initial_clock)) {
    fail('invalid_seed', 'Load the seed at its initial clock. Move time afterward with the host clock.');
  }
}

function decisionOrder(id) {
  const match = /^auth-(\d+)$/.exec(id || '');
  return match ? Number(match[1]) : null;
}

function priorSpend(data, cardId, at, field, beforeId) {
  let start = null;
  let end = null;
  if (field === 'per_day') {
    const span = dayWindow(at, data.time_zone);
    start = Date.parse(span.start);
    end = Date.parse(span.end);
  }
  if (field === 'per_month') {
    const span = monthWindow(at, data.time_zone);
    start = Date.parse(span.start);
    end = Date.parse(span.end);
  }
  const cutoff = Date.parse(at);
  let total = 0;
  for (const auth of data.authorizations) {
    if (auth.card_id !== cardId) continue;
    const when = Date.parse(auth.decided_at);
    if (when > cutoff) continue;
    if (when === cutoff && beforeId) {
      const authOrder = decisionOrder(auth.authorization_id);
      const declineOrder = decisionOrder(beforeId);
      if (authOrder !== null && declineOrder !== null && authOrder >= declineOrder) continue;
    }
    if (start !== null && (when < start || when >= end)) continue;
    if (auth.reversed_at && Date.parse(auth.reversed_at) < cutoff) continue;
    if (auth.expired_at && Date.parse(auth.expired_at) < cutoff) continue;
    if (auth.captured_at && Date.parse(auth.captured_at) < cutoff) total += auth.captured_cents;
    else total += auth.amount_cents;
  }
  return total;
}

function validateSeed(ctx, data) {
  references(ctx, data);
  if (data.time_zone !== 'America/New_York') fail('invalid_seed', 'v1 fixtures use America/New_York.');
  if (!['email_code', 'owner_approval'].includes(data.verification.mode)) fail('invalid_seed', 'Unknown verification mode.');
  if (data.verification.mode === 'email_code' && data.alerts.codes !== true) fail('invalid_seed', 'email_code mode requires the code alert so the code has a delivery path.');
  if (data.verification.code_ttl_minutes < 1 || data.verification.owner_window_hours < 1 || data.verification.max_attempts < 1) {
    fail('invalid_seed', 'Verification windows must be positive.');
  }
  for (const category of data.category_blocks) {
    if (!CATEGORIES.includes(category)) fail('invalid_seed', 'Unknown blocked category.');
  }
  const cardIds = new Set();
  const numbers = new Set();
  for (const card of data.cards) {
    if (cardIds.has(card.card_id) || card.account_id !== data.account_id) fail('invalid_seed', 'Duplicate card or wrong account.');
    cardIds.add(card.card_id);
    if (!luhnOk(card.number) || card.number.slice(-4) !== card.last_four) fail('invalid_seed', 'Card number must pass Luhn, start with 9, and match the last four.');
    if (numbers.has(card.number)) fail('invalid_seed', 'Duplicate card number.');
    numbers.add(card.number);
    if (card.type === 'category_locked' && !card.categories.length) fail('invalid_seed', 'A category-locked card needs at least one category.');
    for (const category of card.categories) if (!CATEGORIES.includes(category)) fail('invalid_seed', 'Unknown card category.');
    for (const field of LIMIT_FIELDS) {
      const value = card.limits[field];
      if (value !== null && (!Number.isInteger(value) || value < 0)) fail('invalid_seed', 'Limits are integer cents.');
    }
    if (Date.parse(card.created_at) > Date.parse(card.updated_at)) fail('invalid_seed', 'Card timestamps are reversed.');
    if (Date.parse(card.created_at) > Date.parse(ctx.virtual_now) || Date.parse(card.updated_at) > Date.parse(ctx.virtual_now)) {
      fail('invalid_seed', 'Card history is ahead of the run clock.');
    }
  }
  const authIds = new Set();
  const keys = new Set();
  for (const auth of data.authorizations) {
    if (authIds.has(auth.authorization_id) || keys.has(auth.authorization_key)) fail('invalid_seed', 'Duplicate authorization.');
    authIds.add(auth.authorization_id);
    keys.add(auth.authorization_key);
    if (!cardIds.has(auth.card_id)) fail('invalid_seed', 'Authorization card is missing.');
    if (auth.decision !== 'approved') fail('invalid_seed', 'Approved authorizations live in authorizations.');
    if (auth.status === 'captured' || auth.status === 'refunded' || auth.status === 'partially_refunded') {
      if (!auth.captured_at || auth.captured_cents <= 0) fail('invalid_seed', 'A capture needs a time and amount.');
    }
    if (Date.parse(auth.decided_at) > Date.parse(ctx.virtual_now)) fail('invalid_seed', 'Authorization is ahead of the run clock.');
    if (auth.captured_at && Date.parse(auth.captured_at) < Date.parse(auth.decided_at)) {
      fail('invalid_seed', 'A capture is dated before its authorization.');
    }
  }
  for (const decline of data.declines) {
    if (authIds.has(decline.authorization_id) || keys.has(decline.authorization_key)) fail('invalid_seed', 'Duplicate decline key.');
    authIds.add(decline.authorization_id);
    keys.add(decline.authorization_key);
    if (decline.decision !== 'declined' || decline.hold_cents !== 0) fail('invalid_seed', 'A decline holds nothing.');
    if (decline.card_id && !cardIds.has(decline.card_id)) fail('invalid_seed', 'Decline card is missing.');
  }
  let balance = data.funding.opening_balance_cents;
  const seenLedger = new Set();
  const orderedLedger = data.ledger.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.entry_id.localeCompare(b.entry_id));
  for (const entry of orderedLedger) {
    if (seenLedger.has(entry.entry_id)) fail('invalid_seed', 'Duplicate ledger entry.');
    seenLedger.add(entry.entry_id);
    balance += entry.direction === 'debit' ? -entry.amount_cents : entry.amount_cents;
    if (entry.balance_after_cents !== balance) fail('invalid_seed', 'Ledger balance does not reconcile.');
    if (entry.kind === 'capture') {
      const auth = data.authorizations.find(item => item.authorization_id === entry.authorization_id);
      if (!auth || auth.captured_cents < entry.amount_cents) fail('invalid_seed', 'A capture needs a prior approved authorization.');
      if (Date.parse(entry.at) < Date.parse(auth.decided_at)) fail('invalid_seed', 'A capture ledger row is dated before its authorization.');
    }
  }
  if (balance !== data.funding.balance_cents) fail('invalid_seed', 'Funding balance does not match the ledger.');
  if (atSeedClock(ctx, data) && completedMonths(data, ctx.virtual_now).length) fail('invalid_seed', 'A completed month is missing its statement.');
  const limitField = {
    exceeds_transaction_limit: 'per_transaction',
    exceeds_daily_limit: 'per_day',
    exceeds_monthly_limit: 'per_month',
    exceeds_lifetime_limit: 'lifetime'
  };
  for (const decline of data.declines) {
    const field = limitField[decline.decline_code];
    if (!field || !decline.limits_in_force) continue;
    const limit = decline.limits_in_force[field];
    if (!Number.isInteger(limit) || limit < 0) fail('invalid_seed', 'A historical decline names a limit that was not in force.');
    const storedWindows = decline.limits_in_force.spend_in_force;
    const stored = storedWindows && Number.isInteger(storedWindows[field])
      ? storedWindows[field]
      : (field !== 'per_transaction' && Number.isInteger(decline.limits_in_force.spend_in_force_cents) ? decline.limits_in_force.spend_in_force_cents : null);
    if (field === 'per_transaction' && stored !== null && stored !== 0) {
      fail('invalid_seed', 'A per-transaction decline has no earlier spend in that window.');
    }
    const prior = field === 'per_transaction'
      ? 0
      : priorSpend(data, decline.card_id, decline.decided_at, field, stored === null ? null : decline.authorization_id);
    if (stored !== null && field !== 'per_transaction' && stored !== prior) {
      fail('invalid_seed', 'A historical decline records spend that the history does not support.');
    }
    if (decline.amount_cents + prior <= limit) fail('invalid_seed', 'A historical decline does not match the limits in force at that time.');
  }
  for (const statement of data.statements) {
    const entries = data.ledger.filter(entry => statement.entry_ids.includes(entry.entry_id));
    const debits = entries.filter(entry => entry.direction === 'debit').reduce((sum, entry) => sum + entry.amount_cents, 0);
    const credits = entries.filter(entry => entry.direction === 'credit').reduce((sum, entry) => sum + entry.amount_cents, 0);
    if (debits !== statement.debits_cents || credits !== statement.credits_cents) fail('invalid_seed', 'Statement totals do not match its entries.');
    if (statement.closing_balance_cents !== statement.opening_balance_cents + credits - debits) fail('invalid_seed', 'Statement does not reconcile.');
  }
  const fingerprints = new Set();
  for (const print of data.fingerprints) {
    const card = data.cards.find(item => item.card_id === print.card_id);
    if (!card || print.number !== card.number || print.security_code !== card.security_code || print.expiry !== card.expiry || print.last_four !== card.last_four) {
      fail('invalid_seed', 'Fingerprint does not match its card.');
    }
    fingerprints.add(print.card_id);
  }
  if (fingerprints.size !== data.cards.length) fail('invalid_seed', 'Each card has one fingerprint.');
  if (atSeedClock(ctx, data)) {
    for (const auth of data.authorizations) {
      if (auth.status === 'pending' && Date.parse(auth.expires_at) <= Date.parse(ctx.virtual_now)) {
        fail('invalid_seed', 'A seeded hold is already due.');
      }
    }
    for (const request of data.change_requests) {
      if ((request.status === 'pending_verification' || request.status === 'pending_owner') && Date.parse(request.expires_at) <= Date.parse(ctx.virtual_now)) {
        fail('invalid_seed', 'A seeded change request is already due.');
      }
    }
  }
  for (const refund of data.refunds) {
    const auth = data.authorizations.find(item => item.authorization_id === refund.authorization_id);
    const entry = data.ledger.find(item => item.entry_id === refund.entry_id);
    if (!auth || !entry || entry.kind !== 'refund' || entry.direction !== 'credit' || entry.amount_cents !== refund.amount_cents) {
      fail('invalid_seed', 'A refund must match its authorization and ledger credit.');
    }
  }
  for (const top of data.top_ups) {
    const entry = data.ledger.find(item => item.entry_id === top.entry_id);
    if (!entry || entry.kind !== 'top_up' || entry.direction !== 'credit' || entry.amount_cents !== top.amount_cents) {
      fail('invalid_seed', 'A top-up must match its ledger credit.');
    }
  }
  for (const request of data.change_requests) {
    if (!cardIds.has(request.card_id)) fail('invalid_seed', 'Change request card is missing.');
    if (request.attempts.length !== request.attempts.filter(item => item.request_id).length) fail('invalid_seed', 'Attempt rows need a request id.');
  }
}

module.exports = {
  validateSeed, assertLoadClock,
  records: data => data.cards,
  objects: data => data.cards.map(card => card.card_id),
  references: () => [],
  assetReferences: () => []
};
