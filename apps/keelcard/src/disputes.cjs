'use strict';
const { fail, addDays, due, DISPUTE_REASONS, nextSerial } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');
const { maybe } = require('./notices.cjs');
const { applyRefund } = require('./money.cjs');

function findDispute(data, disputeId) {
  const dispute = data.disputes.find(item => item.dispute_id === disputeId);
  if (!dispute) fail('not_found', 'Dispute does not exist.');
  return dispute;
}

function notice(ctx, data, dispute, kind, title, body) {
  maybe(ctx, data, data.alerts.disputes, {
    kind,
    title,
    body,
    source_object: { object_type: 'dispute', object_id: dispute.dispute_id },
    related_id: dispute.authorization_id
  });
}

function openDispute(ctx, data, args) {
  const row = data.authorizations.find(item => item.authorization_id === args.authorization_id);
  if (!row || row.status === 'pending' || row.status === 'reversed' || row.status === 'expired' || row.status === 'refunded') {
    fail('not_disputable', 'Only a captured charge that is not fully refunded can be disputed.');
  }
  if (!DISPUTE_REASONS.includes(args.reason)) fail('invalid_arguments', 'Unknown dispute reason.');
  if (typeof args.note !== 'string' || args.note.length < 1 || args.note.length > 500) fail('invalid_arguments', 'A dispute needs a short note.');
  const closes = addDays(row.captured_at, 120);
  if (due(ctx.virtual_now, closes)) fail('dispute_window_closed', 'The dispute window closed 120 days after capture.');
  const blocking = data.disputes.some(item => item.authorization_id === row.authorization_id && item.status !== 'withdrawn');
  if (blocking) fail('already_disputed', 'This charge already has a dispute.');
  const dispute = {
    dispute_id: nextSerial(data.disputes, 'dispute_id', 'dsp-'),
    authorization_id: row.authorization_id,
    reason: args.reason,
    note: args.note,
    status: 'submitted',
    submitted_at: ctx.virtual_now,
    window_closes_at: closes,
    updated_at: ctx.virtual_now,
    refund_cents: null
  };
  data.disputes.push(dispute);
  notice(ctx, data, dispute, 'dispute_opened', 'Keelcard dispute submitted', 'Dispute ' + dispute.dispute_id + ' was submitted for ' + row.merchant_name + '.');
  log(ctx, 'keelcard.dispute_opened', { dispute_id: dispute.dispute_id, authorization_id: row.authorization_id });
  return dispute;
}

function withdrawDispute(ctx, data, disputeId) {
  const dispute = findDispute(data, disputeId);
  if (dispute.status !== 'submitted') fail('not_withdrawable', 'Only a submitted dispute can be withdrawn.');
  dispute.status = 'withdrawn';
  dispute.updated_at = ctx.virtual_now;
  notice(ctx, data, dispute, 'dispute_updated', 'Keelcard dispute withdrawn', 'Dispute ' + dispute.dispute_id + ' was withdrawn.');
  log(ctx, 'keelcard.dispute_withdrawn', { dispute_id: dispute.dispute_id });
  return dispute;
}

function updateDispute(ctx, data, payload) {
  const dispute = findDispute(data, payload.dispute_id);
  const next = payload.status;
  const allowed = dispute.status === 'submitted' && next === 'under_review'
    || dispute.status === 'under_review' && (next === 'won' || next === 'lost');
  if (!allowed) fail('invalid_transition', 'That dispute status does not follow the previous one.');
  if (next === 'won') {
    if (!Number.isInteger(payload.refund_cents) || payload.refund_cents <= 0) fail('invalid_event', 'A won dispute needs refund_cents.');
    const row = data.authorizations.find(item => item.authorization_id === dispute.authorization_id);
    applyRefund(ctx, data, row, payload.refund_cents, 'dispute:' + dispute.dispute_id, 'dispute.update');
    dispute.refund_cents = payload.refund_cents;
  }
  dispute.status = next;
  dispute.updated_at = ctx.virtual_now;
  notice(ctx, data, dispute, 'dispute_updated', 'Keelcard dispute updated', 'Dispute ' + dispute.dispute_id + ' is now ' + next.replaceAll('_', ' ') + '.');
  log(ctx, 'keelcard.dispute_updated', { dispute_id: dispute.dispute_id, status: next });
  return dispute;
}

function publicDispute(dispute) {
  return {
    dispute_id: dispute.dispute_id,
    authorization_id: dispute.authorization_id,
    reason: dispute.reason,
    note: dispute.note,
    status: dispute.status,
    submitted_at: dispute.submitted_at,
    window_closes_at: dispute.window_closes_at,
    updated_at: dispute.updated_at,
    refund_cents: dispute.refund_cents
  };
}

module.exports = { openDispute, withdrawDispute, updateDispute, publicDispute };
