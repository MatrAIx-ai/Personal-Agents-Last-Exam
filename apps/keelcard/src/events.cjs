'use strict';
const { fail, CATEGORIES } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');
const { settleDue, settleTouched } = require('./ledger.cjs');
const { commitAuthorization, captureAuthorization, reverseAuthorization, applyRequest } = require('./changes.cjs');
const { issueRefund, topUp } = require('./money.cjs');
const { updateDispute } = require('./disputes.cjs');

function authorizationFromMessage(data, payload) {
  if (!payload.message) return payload;
  if (payload.recipient_account_id && payload.recipient_account_id !== data.account_id) {
    fail('invalid_event', 'Authorization recipient does not match this account.');
  }
  const body = payload.message.data;
  if (!body || body.channel !== 'channel.card.authorization' || !body.authorization) {
    fail('invalid_event', 'Authorization message is missing.');
  }
  const source = body.source_object;
  return {
    authorization_key: body.authorization.authorization_key,
    card: body.authorization.card,
    merchant: body.authorization.merchant,
    amount_cents: body.authorization.amount_cents,
    currency: body.authorization.currency,
    merchant_ref: source ? {
      app_id: source.app_id,
      account_id: source.account_id,
      object_type: source.object_type,
      object_id: source.object_id
    } : null
  };
}

function requireKey(payload) {
  if (!payload || typeof payload !== 'object') fail('invalid_event', 'Event payload is missing.');
  if (!payload.authorization_key || typeof payload.authorization_key !== 'string') fail('invalid_event', 'Authorization requires authorization_key.');
  if (!payload.card || typeof payload.card !== 'object') fail('invalid_event', 'Authorization requires a card.');
  const hasId = typeof payload.card.card_id === 'string' && payload.card.card_id.length > 0;
  const hasDetails = typeof payload.card.number === 'string' && typeof payload.card.expiry === 'string' && typeof payload.card.security_code === 'string' && payload.card.number && payload.card.expiry && payload.card.security_code;
  if (!hasId && !hasDetails) fail('invalid_event', 'Authorization requires a card id or the full card details.');
  if (!payload.merchant || !payload.merchant.merchant_id || !payload.merchant.name) fail('invalid_event', 'Authorization requires a merchant.');
  if (!CATEGORIES.includes(payload.merchant.category)) fail('invalid_event', 'Unknown merchant category.');
  if (!Number.isInteger(payload.amount_cents) || payload.amount_cents <= 0) fail('invalid_event', 'Amount must be a positive number of cents.');
  if (payload.currency !== 'USD') fail('invalid_event', 'Only USD is accepted.');
}

function applyEvent(ctx, data, event) {
  const payload = event.payload || {};
  if (event.operation === 'authorization.request') {
    const request = authorizationFromMessage(data, payload);
    requireKey(request);
    commitAuthorization(ctx, data, request, event.event_id);
    return data;
  }
  if (event.operation === 'authorization.capture') {
    if (!payload.capture_key || (!payload.authorization_id && !payload.authorization_key)) fail('invalid_event', 'Capture requires a target and capture_key.');
    if (!Number.isInteger(payload.amount_cents) || payload.amount_cents <= 0) fail('invalid_event', 'Capture amount must be a positive integer.');
    captureAuthorization(ctx, data, payload);
    return data;
  }
  if (event.operation === 'authorization.reverse') {
    if (!payload.reason || (!payload.authorization_id && !payload.authorization_key)) fail('invalid_event', 'Reversal requires a target and a reason.');
    reverseAuthorization(ctx, data, payload);
    return data;
  }
  if (event.operation === 'refund.issue') {
    if (!payload.refund_key || !(payload.transaction_id || payload.authorization_id)) fail('invalid_event', 'Refund requires a transaction and refund_key.');
    if (!Number.isInteger(payload.amount_cents) || payload.amount_cents <= 0) fail('invalid_event', 'Refund amount must be a positive integer.');
    issueRefund(ctx, data, payload);
    return data;
  }
  if (event.operation === 'funding.top_up') {
    topUp(ctx, data, payload);
    return data;
  }
  if (event.operation === 'dispute.update') {
    updateDispute(ctx, data, payload);
    return data;
  }
  if (event.operation === 'ledger.settle_due') {
    const transitions = settleDue(data, ctx.virtual_now);
    log(ctx, 'keelcard.settled', { count: transitions.length });
    return data;
  }
  if (event.operation === 'change_request.owner_decision') {
    const request = data.change_requests.find(item => item.change_request_id === payload.change_request_id);
    if (!request) fail('not_pending', 'There is no open owner request with that id.');
    const wasOpen = request.status === 'pending_owner' || request.status === 'pending_verification';
    settleTouched(data, ctx.virtual_now, { requestId: request.change_request_id });
    if (wasOpen && request.status === 'expired') {
      log(ctx, 'keelcard.owner_decision_expired', { change_request_id: request.change_request_id });
      return data;
    }
    if (request.status !== 'pending_owner') fail('not_pending', 'That request is not waiting for an owner decision.');
    if (payload.decision === 'approved') applyRequest(ctx, data, request, 'owner', 'owner_approval');
    else if (payload.decision === 'denied') {
      request.status = 'denied';
      request.resolved_at = ctx.virtual_now;
      log(ctx, 'keelcard.owner_decision_denied', { change_request_id: request.change_request_id });
    } else fail('invalid_event', 'Owner decision must be approved or denied.');
    return data;
  }
  if (event.operation === 'notice.delivery_result') {
    const notice = data.notices.find(item => item.notice_id === payload.notice_id);
    if (!notice) fail('notice_not_found', 'Notice does not exist.');
    const next = payload.status;
    if (!['committed', 'rejected', 'unknown'].includes(next)) fail('invalid_event', 'Unknown delivery status.');
    if (payload.publish_request_id && payload.publish_request_id !== notice.publish_request_id) {
      fail('delivery_status_conflict', 'Delivery evidence names a different publish request.');
    }
    if (notice.delivery && notice.delivery.event_id && payload.event_id && notice.delivery.event_id !== payload.event_id) {
      fail('delivery_status_conflict', 'Delivery evidence names a different receiver event.');
    }
    if ((notice.status === 'committed' || notice.status === 'rejected') && notice.status !== next) {
      fail('delivery_status_conflict', 'Delivery status is already final.');
    }
    if (notice.status !== 'committed' && notice.status !== 'rejected') notice.status = next;
    notice.delivery = {
      publish_request_id: notice.publish_request_id,
      status: notice.status,
      event_id: notice.delivery && notice.delivery.event_id ? notice.delivery.event_id : (payload.event_id || null),
      code: payload.code || (notice.delivery && notice.delivery.code) || null,
      recorded_at: ctx.virtual_now
    };
    log(ctx, 'keelcard.delivery_recorded', { notice_id: notice.notice_id, status: notice.status });
    return data;
  }
  fail('invalid_event', 'Unsupported operation.');
}

module.exports = { applyEvent };
