'use strict';
const crypto = require('node:crypto');
const { copy } = require('./domain-utils.cjs');
const { spent, availableCents, effectiveStatus } = require('./ledger.cjs');

function matchCard(data, cardInput) {
  if (!cardInput || typeof cardInput !== 'object') return { decline: 'card_not_found' };
  if (cardInput.card_id) {
    const card = data.cards.find(item => item.card_id === cardInput.card_id);
    if (!card) return { decline: 'card_not_found' };
    if (cardInput.number && cardInput.number !== card.number) return { decline: 'card_details_mismatch', card };
    if (cardInput.expiry && cardInput.expiry !== card.expiry) return { decline: 'card_details_mismatch', card };
    if (cardInput.security_code && cardInput.security_code !== card.security_code) return { decline: 'card_details_mismatch', card };
    return { card };
  }
  if (cardInput.number) {
    const card = data.cards.find(item => item.number === cardInput.number);
    if (!card) return { decline: 'card_not_found' };
    if (card.expiry !== cardInput.expiry || card.security_code !== cardInput.security_code) return { decline: 'card_details_mismatch', card };
    return { card };
  }
  return { decline: 'card_not_found' };
}

function overLimit(limit, amount, already) {
  if (limit === null || limit === undefined) return false;
  return amount + (already || 0) > limit;
}

function decide(data, request, now) {
  const matched = matchCard(data, request.card);
  if (matched.decline && !matched.card) {
    return { decision: 'declined', decline_code: matched.decline, card: null, limits_in_force: { funding_balance_cents: data.funding.balance_cents } };
  }
  const card = matched.card;
  const merchant = request.merchant;
  const base = {
    per_transaction: card.limits.per_transaction,
    per_day: card.limits.per_day,
    per_month: card.limits.per_month,
    lifetime: card.limits.lifetime,
    merchant_lock: card.merchant_lock,
    categories: copy(card.categories),
    category_blocks: copy(data.category_blocks),
    merchant_blocked: data.merchant_blocks.includes(merchant.merchant_id),
    funding_balance_cents: data.funding.balance_cents,
    available_cents: availableCents(data, now)
  };
  base.spend_in_force = {
    per_day: spent(data, card.card_id, now, 'per_day'),
    per_month: spent(data, card.card_id, now, 'per_month'),
    lifetime: spent(data, card.card_id, now, 'lifetime')
  };
  base.spend_in_force_cents = base.spend_in_force.per_day;
  const decline = code => ({ decision: 'declined', decline_code: code, card, limits_in_force: base });
  if (matched.decline) return decline(matched.decline);
  if (card.status === 'paused') return decline('card_paused');
  if (card.status === 'closed') return decline(card.closure_reason === 'single_use' ? 'single_use_spent' : 'card_closed');
  if (card.type === 'single_use') {
    const used = data.authorizations.some(auth => auth.card_id === card.card_id && ['pending', 'captured', 'refunded', 'partially_refunded'].includes(effectiveStatus(auth, now)));
    if (used) return decline('single_use_spent');
  }
  if (card.type === 'merchant_locked' && card.merchant_lock && card.merchant_lock !== merchant.merchant_id) return decline('merchant_not_allowed');
  if (card.type === 'category_locked' && !card.categories.includes(merchant.category)) return decline('category_blocked');
  if (data.category_blocks.includes(merchant.category)) return decline('category_blocked');
  if (data.merchant_blocks.includes(merchant.merchant_id)) return decline('merchant_blocked');
  const amount = request.amount_cents;
  const daySpend = base.spend_in_force.per_day;
  const monthSpend = base.spend_in_force.per_month;
  const lifeSpend = base.spend_in_force.lifetime;
  const withSpend = (code, spend) => {
    base.spend_in_force_cents = spend;
    return decline(code);
  };
  if (overLimit(card.limits.per_transaction, amount, 0)) return withSpend('exceeds_transaction_limit', 0);
  if (overLimit(card.limits.per_day, amount, daySpend)) return withSpend('exceeds_daily_limit', daySpend);
  if (overLimit(card.limits.per_month, amount, monthSpend)) return withSpend('exceeds_monthly_limit', monthSpend);
  if (overLimit(card.limits.lifetime, amount, lifeSpend)) return withSpend('exceeds_lifetime_limit', lifeSpend);
  if (amount > availableCents(data, now)) return withSpend('insufficient_funds', base.spend_in_force.per_day);
  base.spend_in_force_cents = daySpend;
  return { decision: 'approved', decline_code: null, card, limits_in_force: base };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function contentKey(payload) {
  const body = {
    authorization_key: payload.authorization_key || null,
    card_id: payload.card && payload.card.card_id || null,
    number: payload.card && payload.card.number || null,
    expiry: payload.card && payload.card.expiry || null,
    security_code: payload.card && payload.card.security_code || null,
    merchant_id: payload.merchant && payload.merchant.merchant_id || null,
    merchant_name: payload.merchant && payload.merchant.name || null,
    category: payload.merchant && payload.merchant.category || null,
    amount_cents: payload.amount_cents,
    currency: payload.currency || null,
    merchant_ref: payload.merchant_ref || null
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
}

function findDecision(data, key) {
  return data.authorizations.find(item => item.authorization_key === key) || data.declines.find(item => item.authorization_key === key) || null;
}

module.exports = { decide, contentKey, findDecision };
