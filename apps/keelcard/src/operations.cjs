'use strict';
const { fail, copy, LIMIT_FIELDS, CATEGORIES } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');
const { maskCard, transactionView, lookupView, requestView, summary } = require('./views.cjs');
const { findDecision } = require('./decisions.cjs');
const {
  findCard, touch, assertActive, recordChange, createCard, openChange, applyRequest
} = require('./changes.cjs');

function requestsFor(data, cardId) {
  return data.change_requests.filter(item => !cardId || item.card_id === cardId).map(requestView);
}

function handleTool(ctx, data, name, args) {
  if (name === 'keelcard.cards.list') {
    const query = (args.query || '').toLocaleLowerCase();
    const cards = data.cards.filter(card => {
      if (!args.include_closed && card.status === 'closed') return false;
      const blob = (card.nickname + ' ' + card.last_four + ' ' + card.card_id).toLocaleLowerCase();
      return blob.includes(query);
    }).map(maskCard);
    return { data, result: { cards } };
  }
  if (name === 'keelcard.cards.get') return { data, result: { card: maskCard(findCard(data, args.card_id)) } };
  if (name === 'keelcard.controls.get') {
    return { data, result: {
      verification: { mode: data.verification.mode, code_ttl_minutes: data.verification.code_ttl_minutes, max_attempts: data.verification.max_attempts, owner_window_hours: data.verification.owner_window_hours },
      delegate: copy(data.delegate),
      alerts: copy(data.alerts),
      category_blocks: copy(data.category_blocks),
      merchant_blocks: copy(data.merchant_blocks),
      cards: data.cards.map(maskCard)
    } };
  }
  if (name === 'keelcard.controls.requests.list') return { data, result: { requests: requestsFor(data, args.card_id) } };
  if (name === 'keelcard.transactions.list') {
    const rows = data.authorizations.filter(item => !args.card_id || item.card_id === args.card_id).map(item => transactionView(item, ctx.virtual_now));
    return { data, result: { transactions: rows } };
  }
  if (name === 'keelcard.transactions.get') {
    const row = data.authorizations.find(item => item.authorization_id === args.authorization_id);
    if (!row) fail('not_found', 'Transaction does not exist in this account.');
    return { data, result: { transaction: transactionView(row, ctx.virtual_now) } };
  }
  if (name === 'keelcard.declines.list') {
    const declines = data.declines.filter(item => !args.card_id || item.card_id === args.card_id).map(item => ({
      authorization_id: item.authorization_id,
      authorization_key: item.authorization_key,
      card_id: item.card_id,
      merchant_id: item.merchant_id,
      merchant_name: item.merchant_name,
      category: item.category,
      amount_cents: item.amount_cents,
      decline_code: item.decline_code,
      hold_cents: 0,
      limits_in_force: copy(item.limits_in_force),
      merchant_ref: copy(item.merchant_ref),
      decided_at: item.decided_at
    }));
    return { data, result: { declines } };
  }
  if (name === 'keelcard.spend.summary') return { data, result: { summary: summary(data, ctx.virtual_now, args.card_id) } };
  if (name === 'keelcard.authorizations.lookup') {
    return { data, result: { authorization: lookupView(findDecision(data, args.authorization_key), ctx.virtual_now) } };
  }
  if (name === 'keelcard.statements.list') {
    return { data, result: { statements: copy(data.statements) } };
  }

  if (name === 'keelcard.cards.create') {
    const card = createCard(ctx, data, args);
    return { data, result: { card_id: card.card_id, last_four: card.last_four, card_status: card.status, type: card.type } };
  }
  if (name === 'keelcard.cards.update') {
    const card = assertActive(findCard(data, args.card_id));
    card.nickname = args.nickname;
    touch(ctx, card);
    log(ctx, 'keelcard.card_updated', { card_id: card.card_id });
    return { data, result: { card_id: card.card_id, nickname: card.nickname } };
  }
  if (name === 'keelcard.cards.pause') {
    const card = assertActive(findCard(data, args.card_id));
    if (card.status === 'paused') fail('invalid_arguments', 'The card is already paused.');
    card.status = 'paused';
    card.paused_by = 'delegate';
    touch(ctx, card);
    log(ctx, 'keelcard.card_paused', { card_id: card.card_id });
    return { data, result: { card_id: card.card_id, card_status: card.status, paused_by: card.paused_by } };
  }
  if (name === 'keelcard.cards.unpause') {
    const card = assertActive(findCard(data, args.card_id));
    if (card.status !== 'paused') fail('invalid_arguments', 'The card is not paused.');
    if (card.paused_by === 'owner') fail('permission_denied', 'Unpausing a card the owner paused is a change request.');
    card.status = 'active';
    card.paused_by = null;
    touch(ctx, card);
    return { data, result: { card_id: card.card_id, card_status: card.status } };
  }
  if (name === 'keelcard.cards.close') {
    const card = findCard(data, args.card_id);
    if (card.status === 'closed') fail('card_closed', 'This card is already closed.');
    card.status = 'closed';
    card.closure_reason = 'closed';
    card.closed_at = ctx.virtual_now;
    touch(ctx, card);
    if (data.alerts.card_events) {
      require('./notices.cjs').maybe(ctx, data, true, {
        kind: 'card_closed',
        title: 'Keelcard card closed',
        body: 'Card ' + card.last_four + ' is closed.',
        source_object: { object_type: 'card', object_id: card.card_id },
        related_id: card.card_id
      });
    }
    return { data, result: { card_id: card.card_id, card_status: 'closed' } };
  }
  if (name === 'keelcard.cards.reveal') {
    const card = findCard(data, args.card_id);
    if (card.status === 'closed') fail('card_closed', 'This card is closed.');
    if (!data.delegate.may_reveal) fail('reveal_not_permitted', 'This delegate cannot reveal card details.');
    data.reveals.push({ reveal_id: require('./domain-utils.cjs').nextSerial(data.reveals, 'reveal_id', 'rev-'), card_id: card.card_id, at: ctx.virtual_now, connection_role: ctx.role || 'agent' });
    log(ctx, 'keelcard.card_revealed', { card_id: card.card_id });
    return { data, result: { card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code, last_four: card.last_four } };
  }
  if (name === 'keelcard.controls.lower') {
    const card = assertActive(findCard(data, args.card_id));
    if (!LIMIT_FIELDS.includes(args.field)) fail('invalid_arguments', 'Unknown limit field.');
    const current = card.limits[args.field];
    if (current !== null && args.amount_cents >= current) fail('invalid_arguments', 'The new limit must be lower than the current limit.');
    card.limits[args.field] = args.amount_cents;
    touch(ctx, card);
    recordChange(ctx, data, {
      card_id: card.card_id, field: args.field, from_cents: current, to_cents: args.amount_cents,
      merchant_id: null, category: null, changed_by: 'delegate', verification: 'direct', change_request_id: null
    });
    return { data, result: { card_id: card.card_id, field: args.field, limit_cents: args.amount_cents } };
  }
  if (name === 'keelcard.controls.block') {
    if (args.kind === 'merchant') {
      if (!args.merchant_id) fail('invalid_arguments', 'Merchant block needs merchant_id.');
      if (data.merchant_blocks.includes(args.merchant_id)) fail('invalid_arguments', 'That merchant is already blocked.');
      data.merchant_blocks.push(args.merchant_id);
    } else if (args.kind === 'category') {
      if (!CATEGORIES.includes(args.category)) fail('invalid_arguments', 'Unknown category.');
      if (data.category_blocks.includes(args.category)) fail('invalid_arguments', 'That category is already blocked.');
      data.category_blocks.push(args.category);
    } else fail('invalid_arguments', 'Block kind must be merchant or category.');
    recordChange(ctx, data, {
      card_id: args.card_id || null, field: args.kind === 'merchant' ? 'merchant_block' : 'category_block',
      from_cents: null, to_cents: null, merchant_id: args.merchant_id || null, category: args.category || null,
      changed_by: 'delegate', verification: 'direct', change_request_id: null
    });
    return { data, result: { kind: args.kind, merchant_id: args.merchant_id || null, category: args.category || null } };
  }
  if (name === 'keelcard.controls.request_change') {
    const request = openChange(ctx, data, {
      card_id: args.card_id, field: args.field, to_cents: args.amount_cents, merchant_id: args.merchant_id, category: args.category
    });
    return { data, result: {
      change_request_id: request.change_request_id,
      request_status: request.status,
      expires_at: request.expires_at,
      card_id: request.card_id,
      field: request.field,
      limit_cents: request.to_cents
    } };
  }
  if (name === 'keelcard.controls.confirm_change') {
    const request = data.change_requests.find(item => item.change_request_id === args.change_request_id);
    if (!request || (request.status !== 'pending_verification' && request.status !== 'pending_owner')) {
      fail('no_pending_request', 'There is no open change request to confirm.');
    }
    if (request.mode === 'owner_approval' || request.status === 'pending_owner') {
      fail('owner_approval_required', 'This request waits for an owner decision.');
    }
    require('./ledger.cjs').settleTouched(data, ctx.virtual_now, { requestId: request.change_request_id });
    if (request.status === 'expired') {
      return { data, result: { change_request_id: request.change_request_id, outcome: 'code_expired', attempts_used: request.attempts_used, attempts_remaining: request.max_attempts - request.attempts_used, limit_cents: findCard(data, request.card_id).limits[request.field] ?? null } };
    }
    const matched = args.code === request.code;
    const outcome = matched ? 'applied' : (request.attempts_used + 1 >= request.max_attempts ? 'attempts_exhausted' : 'code_rejected');
    request.attempts.push({ request_id: args.request_id, at: ctx.virtual_now, code_matched: matched, outcome, connection_role: ctx.role || 'agent' });
    request.attempts_used += 1;
    if (matched) {
      applyRequest(ctx, data, request, 'delegate', 'email_code');
    } else if (outcome === 'attempts_exhausted') {
      request.status = 'failed';
      request.resolved_at = ctx.virtual_now;
    }
    const card = findCard(data, request.card_id);
    log(ctx, 'keelcard.change_confirmed', { change_request_id: request.change_request_id, outcome });
    return { data, result: {
      change_request_id: request.change_request_id,
      outcome,
      attempts_used: request.attempts_used,
      attempts_remaining: Math.max(0, request.max_attempts - request.attempts_used),
      limit_cents: LIMIT_FIELDS.includes(request.field) ? card.limits[request.field] : null
    } };
  }
  if (name === 'keelcard.controls.cancel_request') {
    const request = data.change_requests.find(item => item.change_request_id === args.change_request_id);
    if (!request || (request.status !== 'pending_verification' && request.status !== 'pending_owner')) {
      fail('no_pending_request', 'There is no open change request to cancel.');
    }
    request.status = 'cancelled';
    request.resolved_at = ctx.virtual_now;
    return { data, result: { change_request_id: request.change_request_id, request_status: 'cancelled' } };
  }
  fail('unknown_tool', 'Unknown Keelcard operation.');
}

module.exports = { handleTool };
