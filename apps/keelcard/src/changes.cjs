'use strict';
const crypto = require('node:crypto');
const { fail, copy, addMinutes, addHours, addDays, codeDigits, nextSerial, money, luhnComplete, CATEGORIES, LIMIT_FIELDS } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');
const { maybe, codeBody, declineBody } = require('./notices.cjs');
const { decide, contentKey, findDecision } = require('./decisions.cjs');
const { postLedger, settleTouched, settleRequest, availableCents, eventMark, stampMutation } = require('./ledger.cjs');

function findCard(data, cardId) {
  const card = data.cards.find(item => item.card_id === cardId);
  if (!card) fail('not_found', 'Card does not exist in this account.');
  return card;
}

function touch(ctx, card) {
  if (Date.parse(ctx.virtual_now) < Date.parse(card.updated_at)) fail('invalid_time', 'The run clock must not precede the last card update.');
  card.updated_at = ctx.virtual_now;
}

function assertActive(card) {
  if (card.status === 'closed') fail('card_closed', 'This card is closed.');
  return card;
}

function cancelOpenRequests(ctx, data, cardId) {
  for (const request of data.change_requests) {
    if (request.card_id !== cardId) continue;
    if (request.status !== 'pending_verification' && request.status !== 'pending_owner') continue;
    settleRequest(data, request, ctx.virtual_now);
    if (request.status !== 'pending_verification' && request.status !== 'pending_owner') continue;
    request.status = 'cancelled';
    request.resolved_at = ctx.virtual_now;
  }
}

function recordChange(ctx, data, row) {
  const entry = {
    control_change_id: nextSerial(data.control_changes, 'control_change_id', 'cc-'),
    at: ctx.virtual_now,
    ...row,
    request_id: row.request_id || null,
    applied_request_id: row.applied_request_id || row.request_id || null
  };
  data.control_changes.push(entry);
  log(ctx, 'keelcard.control_changed', { control_change_id: entry.control_change_id, card_id: entry.card_id, field: entry.field });
  return entry;
}

function fingerprint(card) {
  return { card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code, last_four: card.last_four };
}

function createCard(ctx, data, args) {
  const limits = args.limits || {};
  for (const field of LIMIT_FIELDS) {
    if (!Number.isInteger(limits[field]) || limits[field] < 0) fail('invalid_arguments', 'Delegate-created cards need each limit in integer cents.');
    if (limits[field] > data.delegate.card_ceiling_cents) fail('delegate_card_limit_exceeded', 'A delegate cannot create a card above the owner ceiling.');
  }
  const categories = args.categories || [];
  if (args.type === 'category_locked' && !categories.length) fail('invalid_arguments', 'A category-locked card needs at least one category.');
  for (const category of categories) if (!CATEGORIES.includes(category)) fail('invalid_arguments', 'Unknown category.');
  const issued = issueCredentials(data);
  const card = {
    card_id: issued.card_id,
    account_id: data.account_id,
    type: args.type,
    nickname: args.nickname,
    last_four: issued.last_four,
    number: issued.number,
    expiry: '2029-12',
    security_code: issued.security_code,
    status: 'active',
    paused_by: null,
    closure_reason: null,
    merchant_lock: null,
    categories: copy(categories),
    limits: {
      per_transaction: limits.per_transaction,
      per_day: limits.per_day,
      per_month: limits.per_month,
      lifetime: limits.lifetime
    },
    funding_source: 'local',
    created_at: ctx.virtual_now,
    updated_at: ctx.virtual_now,
    closed_at: null
  };
  data.cards.push(card);
  data.fingerprints.push(fingerprint(card));
  maybe(ctx, data, data.alerts.card_events, {
    notice_id: 'notice-' + card.card_id + '-created',
    kind: 'card_created',
    title: 'Your Keelcard card is active',
    body: 'Card ' + card.last_four + ' (' + card.nickname + ') is active.',
    source_object: { object_type: 'card', object_id: card.card_id },
    related_id: card.card_id
  });
  log(ctx, 'keelcard.card_created', { card_id: card.card_id, type: card.type });
  return card;
}

function issueCredentials(data) {
  const numbers = new Set(data.cards.map(card => card.number));
  const ids = new Set(data.cards.map(card => card.card_id));
  let number = '';
  let cardId = '';
  do {
    number = luhnComplete('9' + String(crypto.randomInt(0, 100000000000000)).padStart(14, '0'));
  } while (numbers.has(number));
  do {
    cardId = 'card-' + crypto.randomBytes(4).toString('hex');
  } while (ids.has(cardId));
  return { number, card_id: cardId, last_four: number.slice(-4), security_code: String(crypto.randomInt(100, 1000)) };
}

function requestIdentity(spec) {
  if (LIMIT_FIELDS.includes(spec.field)) return spec.card_id + '|' + spec.field;
  if (spec.field === 'merchant_unblock') return spec.card_id + '|merchant_unblock|' + (spec.merchant_id || '');
  if (spec.field === 'category_unblock') return spec.card_id + '|category_unblock|' + (spec.category || '');
  if (spec.field === 'unpause') return spec.card_id + '|unpause';
  if (spec.field === 'alert_disable') return 'alert_disable|' + (spec.alert || '');
  if (spec.field === 'alert_threshold') return 'alert_threshold';
  return spec.card_id + '|' + spec.field;
}

function rejectIrrelevant(spec) {
  const extraMerchant = Boolean(spec.merchant_id);
  const extraCategory = Boolean(spec.category);
  const extraAlert = Boolean(spec.alert);
  const extraAmount = spec.to_cents !== undefined && spec.to_cents !== null;
  if (LIMIT_FIELDS.includes(spec.field) && (extraMerchant || extraCategory || extraAlert)) {
    fail('invalid_arguments', 'A limit change names only the card, the limit and the amount.');
  }
  if (spec.field === 'merchant_unblock' && (extraCategory || extraAlert || extraAmount)) {
    fail('invalid_arguments', 'Merchant unblock names only the card and the merchant.');
  }
  if (spec.field === 'category_unblock' && (extraMerchant || extraAlert || extraAmount)) {
    fail('invalid_arguments', 'Category unblock names only the card and the category.');
  }
  if (spec.field === 'unpause' && (extraMerchant || extraCategory || extraAlert || extraAmount)) {
    fail('invalid_arguments', 'Unpause names only the card.');
  }
  if (spec.field === 'alert_disable' && (extraMerchant || extraCategory || extraAmount)) {
    fail('invalid_arguments', 'Turning an alert off names only that alert.');
  }
}

function findOpen(data, spec) {
  return data.change_requests.find(item => (item.status === 'pending_verification' || item.status === 'pending_owner') && requestIdentity(item) === requestIdentity(spec));
}

function openChange(ctx, data, spec) {
  const card = findCard(data, spec.card_id);
  assertActive(card);
  const allowed = [...LIMIT_FIELDS, 'merchant_unblock', 'category_unblock', 'unpause', 'alert_disable', 'alert_threshold'];
  if (!allowed.includes(spec.field)) fail('invalid_arguments', 'Unknown change field.');
  if (spec.field === 'unpause' && card.status !== 'paused') fail('invalid_arguments', 'The card is not paused.');
  if (spec.field === 'unpause' && card.paused_by !== 'owner') fail('invalid_arguments', 'A delegate pause can be cleared directly.');
  if (LIMIT_FIELDS.includes(spec.field)) {
    if (!Number.isInteger(spec.to_cents) || spec.to_cents < 0) fail('invalid_arguments', 'A limit change needs amount_cents.');
    const current = card.limits[spec.field];
    if (current === null || spec.to_cents <= current) fail('invalid_arguments', 'Use controls.lower to reduce a limit.');
    if (spec.to_cents > data.delegate.card_ceiling_cents) fail('delegate_card_limit_exceeded', 'The requested limit is above the owner ceiling.');
    spec.from_cents = current;
  }
  if (spec.field === 'merchant_unblock' && !spec.merchant_id) fail('invalid_arguments', 'Merchant unblock needs merchant_id.');
  if (spec.field === 'merchant_unblock' && !data.merchant_blocks.includes(spec.merchant_id)) fail('invalid_arguments', 'That merchant is not blocked.');
  if (spec.field === 'category_unblock') {
    if (!CATEGORIES.includes(spec.category)) fail('invalid_arguments', 'Unknown category.');
    if (!data.category_blocks.includes(spec.category)) fail('invalid_arguments', 'That category is not blocked.');
  }
  if (spec.field === 'alert_disable' && !spec.alert) fail('invalid_arguments', 'Turning an alert off needs the alert name.');
  if (spec.field === 'alert_disable' && spec.alert === 'codes' && data.verification.mode === 'email_code') {
    fail('invalid_arguments', 'email_code mode keeps the code alert on.');
  }
  if (spec.field === 'alert_threshold' && !Number.isInteger(spec.to_cents)) fail('invalid_arguments', 'A threshold change needs amount_cents.');
  rejectIrrelevant(spec);
  for (const open of data.change_requests) {
    if ((open.status === 'pending_verification' || open.status === 'pending_owner') && requestIdentity(open) === requestIdentity(spec)) {
      settleRequest(data, open, ctx.virtual_now);
    }
  }
  if (findOpen(data, spec)) fail('request_already_open', 'That card and control already have an open request.');
  const mode = data.verification.mode;
  const created = ctx.virtual_now;
  const expires = mode === 'owner_approval'
    ? addHours(created, data.verification.owner_window_hours)
    : addMinutes(created, data.verification.code_ttl_minutes);
  const request = {
    change_request_id: nextSerial(data.change_requests, 'change_request_id', 'cr-'),
    card_id: card.card_id,
    field: spec.field,
    merchant_id: spec.merchant_id || null,
    category: spec.category || null,
    from_cents: spec.from_cents ?? null,
    to_cents: spec.to_cents ?? null,
    alert: spec.alert || null,
    status: mode === 'owner_approval' ? 'pending_owner' : 'pending_verification',
    mode,
    code: mode === 'email_code' ? codeDigits() : null,
    attempts: [],
    attempts_used: 0,
    max_attempts: data.verification.max_attempts,
    created_at: created,
    expires_at: expires,
    resolved_at: null,
    settled_at: null,
    notice_id: null,
    request_id: spec.request_id || null
  };
  data.change_requests.push(request);
  if (mode === 'email_code') {
    const notice = maybe(ctx, data, true, {
      notice_id: 'notice-' + request.change_request_id + '-code',
      kind: 'code',
      title: 'Your Keelcard verification code',
      body: codeBody(data, card, request, request.code),
      source_object: { object_type: 'change_request', object_id: request.change_request_id },
      related_id: request.change_request_id
    });
    request.notice_id = notice.notice_id;
  }
  log(ctx, 'keelcard.change_requested', { change_request_id: request.change_request_id, request_id: request.request_id, mode, field: request.field });
  return request;
}

function limitNotice(ctx, data, card, field, amount, related) {
  maybe(ctx, data, data.alerts.card_events, {
    kind: 'limit_changed',
    title: 'Keelcard limit updated',
    body: 'The ' + field.replaceAll('_', ' ') + ' limit on card ' + card.last_four + ' is now ' + money(amount) + '.',
    source_object: { object_type: 'card', object_id: card.card_id },
    related_id: related
  });
}

function applyRequest(ctx, data, request, changedBy, verification, appliedId) {
  const card = findCard(data, request.card_id);
  if (card.status === 'closed') fail('card_closed', 'This card is closed.');
  if (request.field === 'alert_disable' && request.alert === 'codes' && data.verification.mode === 'email_code') {
    fail('invalid_arguments', 'email_code mode keeps the code alert on.');
  }
  const applied_request_id = appliedId || request.request_id || null;
  if (LIMIT_FIELDS.includes(request.field)) {
    const previous = card.limits[request.field];
    card.limits[request.field] = request.to_cents;
    touch(ctx, card);
    recordChange(ctx, data, {
      card_id: card.card_id, field: request.field, from_cents: previous, to_cents: request.to_cents,
      merchant_id: null, category: null, changed_by: changedBy, verification, change_request_id: request.change_request_id, request_id: request.request_id, applied_request_id
    });
    limitNotice(ctx, data, card, request.field, request.to_cents, request.change_request_id);
  } else if (request.field === 'merchant_unblock') {
    data.merchant_blocks = data.merchant_blocks.filter(id => id !== request.merchant_id);
    recordChange(ctx, data, {
      card_id: card.card_id, field: request.field, from_cents: null, to_cents: null,
      merchant_id: request.merchant_id, category: null, changed_by: changedBy, verification, change_request_id: request.change_request_id, request_id: request.request_id, applied_request_id
    });
  } else if (request.field === 'category_unblock') {
    data.category_blocks = data.category_blocks.filter(id => id !== request.category);
    recordChange(ctx, data, {
      card_id: card.card_id, field: request.field, from_cents: null, to_cents: null,
      merchant_id: null, category: request.category, changed_by: changedBy, verification, change_request_id: request.change_request_id, request_id: request.request_id, applied_request_id
    });
  } else if (request.field === 'alert_disable') {
    data.alerts[request.alert] = false;
    recordChange(ctx, data, {
      card_id: card.card_id, field: request.field, from_cents: null, to_cents: null,
      merchant_id: null, category: null, changed_by: changedBy, verification, change_request_id: request.change_request_id, request_id: request.request_id, applied_request_id
    });
  } else if (request.field === 'alert_threshold') {
    data.alerts.decline_threshold_cents = request.to_cents;
    recordChange(ctx, data, {
      card_id: card.card_id, field: request.field, from_cents: request.from_cents, to_cents: request.to_cents,
      merchant_id: null, category: null, changed_by: changedBy, verification, change_request_id: request.change_request_id, request_id: request.request_id, applied_request_id
    });
  } else if (request.field === 'unpause') {
    card.status = 'active';
    card.paused_by = null;
    touch(ctx, card);
    recordChange(ctx, data, {
      card_id: card.card_id, field: 'unpause', from_cents: null, to_cents: null,
      merchant_id: null, category: null, changed_by: changedBy, verification, change_request_id: request.change_request_id, request_id: request.request_id, applied_request_id
    });
  }
  request.status = 'applied';
  request.resolved_at = ctx.virtual_now;
}

function merchantRef(payload) {
  if (!payload.merchant_ref) return null;
  return copy(payload.merchant_ref);
}

function authorizationResult(row) {
  return {
    authorization_id: row.authorization_id,
    authorization_key: row.authorization_key,
    decision: row.decision,
    decline_code: row.decline_code,
    redelivered: false
  };
}

function rememberRedelivery(row, at) {
  row.redelivered_at.push(at);
  return { ...authorizationResult(row), redelivered: true };
}

function commitAuthorization(ctx, data, payload, eventId) {
  const now = ctx.virtual_now;
  const existing = findDecision(data, payload.authorization_key);
  if (existing) {
    if (existing.content_key !== contentKey(payload)) fail('authorization_key_conflict', 'This authorization key already belongs to different content.');
    return rememberRedelivery(existing, now);
  }
  const request = {
    card: payload.card,
    merchant: payload.merchant,
    amount_cents: payload.amount_cents
  };
  const cardId = payload.card.card_id || data.cards.find(item => item.number === payload.card.number)?.card_id;
  if (cardId) settleTouched(data, now, { cardId });
  const outcome = decide(data, request, now);
  outcome.limits_in_force.decision_seq = eventMark(data);
  const common = {
    authorization_id: nextSerial([...data.authorizations, ...data.declines], 'authorization_id', 'auth-'),
    authorization_key: payload.authorization_key,
    content_key: contentKey(payload),
    card_id: outcome.card ? outcome.card.card_id : null,
    merchant_id: payload.merchant.merchant_id,
    merchant_name: payload.merchant.name,
    category: payload.merchant.category,
    amount_cents: payload.amount_cents,
    currency: 'USD',
    merchant_ref: merchantRef(payload),
    source_event_id: eventId,
    decided_at: now,
    limits_in_force: outcome.limits_in_force,
    redelivered_at: []
  };
  if (outcome.decision === 'declined') {
    const row = { ...common, decision: 'declined', decline_code: outcome.decline_code, hold_cents: 0, status: 'declined' };
    data.declines.push(row);
    const threshold = data.alerts.decline_threshold_cents;
    const notify = data.alerts.declines && (threshold === null || threshold === undefined || payload.amount_cents >= threshold);
    maybe(ctx, data, notify, {
      kind: 'decline',
      title: 'Keelcard decline',
      body: declineBody(payload.merchant.name, payload.amount_cents, outcome.decline_code),
      source_object: { object_type: 'decline', object_id: row.authorization_id },
      related_id: row.authorization_id
    });
    log(ctx, 'keelcard.authorization_declined', { authorization_id: row.authorization_id, decline_code: row.decline_code });
    return authorizationResult(row);
  }
  const card = outcome.card;
  if (card.type === 'merchant_locked' && !card.merchant_lock) {
    card.merchant_lock = payload.merchant.merchant_id;
    touch(ctx, card);
  }
  const row = {
    ...common,
    decision: 'approved',
    decline_code: null,
    status: 'pending',
    hold_cents: payload.amount_cents,
    captured_cents: 0,
    refunded_cents: 0,
    expires_at: addDays(now, 7),
    captured_at: null,
    expired_at: null,
    reversed_at: null,
    settled_at: null,
    capture_key: null
  };
  data.authorizations.push(row);
  log(ctx, 'keelcard.authorization_approved', { authorization_id: row.authorization_id, card_id: card.card_id, amount_cents: row.amount_cents });
  return authorizationResult(row);
}

function findPending(data, payload, now) {
  const row = payload.authorization_id
    ? data.authorizations.find(item => item.authorization_id === payload.authorization_id)
    : data.authorizations.find(item => item.authorization_key === payload.authorization_key);
  if (!row) fail('not_found', 'Authorization does not exist.');
  settleTouched(data, now, { authorizationId: row.authorization_id });
  return row;
}

function captureAuthorization(ctx, data, payload) {
  const row = findPending(data, payload, ctx.virtual_now);
  if (row.status === 'expired') fail('authorization_expired', 'This authorization expired before capture.');
  if (row.status !== 'pending') fail('not_pending', 'Only a pending authorization can be captured.');
  if (!Number.isInteger(payload.amount_cents) || payload.amount_cents <= 0) fail('invalid_event', 'Capture amount must be a positive integer.');
  if (payload.amount_cents > row.hold_cents) fail('amount_exceeds_hold', 'Capture amount is above the hold.');
  if (!payload.capture_key) fail('invalid_event', 'Capture requires capture_key.');
  row.status = 'captured';
  row.captured_cents = payload.amount_cents;
  row.hold_cents = 0;
  row.captured_at = ctx.virtual_now;
  row.capture_key = payload.capture_key;
  stampMutation(data, row);
  postLedger(data, {
    at: ctx.virtual_now, kind: 'capture', direction: 'debit', amount_cents: payload.amount_cents,
    authorization_id: row.authorization_id, card_id: row.card_id
  });
  const card = findCard(data, row.card_id);
  if (card.type === 'single_use') {
    card.status = 'closed';
    card.closure_reason = 'single_use';
    card.closed_at = ctx.virtual_now;
    touch(ctx, card);
    cancelOpenRequests(ctx, data, card.card_id);
    maybe(ctx, data, data.alerts.card_events, {
      kind: 'card_closed',
      title: 'Keelcard card closed',
      body: 'Card ' + card.last_four + ' is closed.',
      source_object: { object_type: 'card', object_id: card.card_id },
      related_id: card.card_id
    });
  }
  maybe(ctx, data, data.alerts.receipts, {
    kind: 'receipt',
    title: 'Keelcard receipt',
    body: row.merchant_name + ' charged ' + money(payload.amount_cents) + ' on card ' + card.last_four + '.',
    source_object: { object_type: 'authorization', object_id: row.authorization_id },
    related_id: row.authorization_id
  });
  log(ctx, 'keelcard.captured', { authorization_id: row.authorization_id, amount_cents: payload.amount_cents });
  return { authorization_id: row.authorization_id, status: 'captured', amount_cents: payload.amount_cents };
}

function reverseAuthorization(ctx, data, payload) {
  const row = findPending(data, payload, ctx.virtual_now);
  if (row.status !== 'pending') fail('not_pending', 'Only a pending authorization can be reversed.');
  row.status = 'reversed';
  row.hold_cents = 0;
  row.reversed_at = ctx.virtual_now;
  row.reverse_reason = payload.reason;
  stampMutation(data, row);
  log(ctx, 'keelcard.reversed', { authorization_id: row.authorization_id });
  return { authorization_id: row.authorization_id, status: 'reversed', amount_cents: row.amount_cents };
}

module.exports = {
  findCard, touch, assertActive, recordChange, cancelOpenRequests, createCard, openChange, applyRequest, findOpen, limitNotice,
  commitAuthorization, captureAuthorization, reverseAuthorization, availableCents
};
