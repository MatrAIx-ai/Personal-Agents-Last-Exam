'use strict';
// Forkyard-owned Mail adapter. Infra supplies the router client and the grant.
// A committed pull closure stays committed whatever this adapter learns about delivery.
// A duplicate confirmation is the stored receipt for the original run and the receiver epoch.
const {digest} = require('../../../runtime/messaging/src/contracts.cjs');
const SOURCE = 'urn:pale:email-payload:1';
const stoppedRuns = new Map();

function payloadFor(notice, accountId) {
  return {
    channel: 'channel.email',
    recipient: {kind: 'person_ref', id: notice.person_id},
    source_object: {
      app_id: 'forkyard',
      account_id: accountId,
      object_type: notice.object_type,
      object_id: notice.object_id
    },
    content: {
      title: notice.title,
      body: {format: 'text/plain', text: notice.text},
      asset_ids: []
    },
    extensions: []
  };
}

function messageFor(notice, accountId) {
  const data = payloadFor(notice, accountId);
  return {
    specversion: '1.0',
    id: 'forkyard-' + accountId + '-' + notice.notice_id,
    source: 'urn:pale:app:forkyard:account:' + accountId,
    type: 'org.pale.mail.notification.v1',
    time: notice.created_at,
    subject: notice.object_type + '/' + notice.object_id,
    datacontenttype: 'application/json',
    dataschema: SOURCE,
    data
  };
}

function publishArgs(notice, accountId) {
  return {request_id: 'notice-' + notice.notice_id, message: messageFor(notice, accountId)};
}

function receiptOf(mailReceipt) {
  if (!mailReceipt) return null;
  if (Object.prototype.hasOwnProperty.call(mailReceipt, 'receipt')) return mailReceipt.receipt;
  return mailReceipt;
}

function filled(value) {
  return value !== undefined && value !== null && value !== '';
}

function receiptRun(receipt) {
  if (!receipt) return null;
  if (filled(receipt.run_id)) return receipt.run_id;
  if (receipt.trace && filled(receipt.trace.run_id)) return receipt.trace.run_id;
  return null;
}

function receiptAccount(receipt, record) {
  if (receipt && filled(receipt.account_id)) return receipt.account_id;
  if (receipt && receipt.trace && filled(receipt.trace.account_id)) return receipt.trace.account_id;
  if (record && filled(record.account_id)) return record.account_id;
  return null;
}

function identityOf(source) {
  if (!source) return null;
  return {
    event_id: source.event_id || null,
    run_id: source.run_id || null,
    app_id: source.app_id || null,
    account_id: source.account_id || null,
    epoch: source.epoch == null ? null : source.epoch
  };
}

function matchesAttempt(source, attempt) {
  const row = identityOf(source);
  if (!row || !filled(row.event_id) || !filled(row.run_id) || !filled(row.app_id) || !filled(row.account_id) || row.epoch == null) return false;
  if (!filled(attempt.event_id) || row.event_id !== attempt.event_id) return false;
  if (!filled(attempt.run_id) || row.run_id !== attempt.run_id) return false;
  const receiver = attempt.receiver;
  if (!receiver || !filled(receiver.app_id) || !filled(receiver.account_id)) return false;
  if (row.app_id !== receiver.app_id || row.account_id !== receiver.account_id) return false;
  if (attempt.receiver_epoch == null || row.epoch !== attempt.receiver_epoch) return false;
  return true;
}

function reconcile({messaging, mailReceipt, attempted} = {}) {
  const attempt = attempted || {};
  const eventId = attempt.event_id || (messaging && messaging.event_id) || null;
  const runId = attempt.run_id || (messaging && messaging.run_id) || null;
  const receiver = attempt.receiver || (messaging && messaging.target) || null;
  const epoch = attempt.receiver_epoch == null ? (messaging && messaging.version ? messaging.version.epoch : null) : attempt.receiver_epoch;
  const expected = {event_id: eventId, run_id: runId, receiver, receiver_epoch: epoch};
  const receipt = receiptOf(mailReceipt);
  const record = (mailReceipt && mailReceipt.receiver_record) || null;
  const messagingSource = messaging && messaging.status === 'committed' ? {
    event_id: messaging.event_id,
    run_id: messaging.run_id,
    app_id: messaging.target && messaging.target.app_id,
    account_id: messaging.target && messaging.target.account_id,
    epoch: messaging.version && messaging.version.epoch
  } : null;
  const mailSource = receipt && receipt.status === 'committed' ? {
    event_id: receipt.event_id,
    run_id: receiptRun(receipt) || (record && record.run_id) || null,
    app_id: receipt.app_id || (record && record.app_id) || null,
    account_id: receiptAccount(receipt, record),
    epoch: receipt.version && receipt.version.epoch != null ? receipt.version.epoch : (record && record.epoch != null ? record.epoch : null)
  } : null;
  const messagingConfirms = matchesAttempt(messagingSource, expected);
  const mailConfirms = matchesAttempt(mailSource, expected);
  if (messagingConfirms || mailConfirms) {
    return {
      delivery: 'confirmed',
      source_committed: true,
      same_run_retry: false,
      duplicate_within_run: !!(messagingConfirms && messaging && messaging.duplicate === true && messaging.run_id === runId),
      event_id: eventId,
      correlated: true
    };
  }
  return {delivery: 'unresolved', source_committed: true, same_run_retry: false, duplicate_within_run: false, event_id: eventId, correlated: false};
}

function stopped(result) {
  if (!result) return true;
  if (result.status === 'committed') return false;
  return true;
}

async function publishPending({notices, accountId, router, runId, inspectReceipt, receiver} = {}) {
  if (!runId) throw new Error('publishPending requires the run id.');
  const prior = stoppedRuns.get(runId);
  if (prior) return {attempts: prior.attempts.slice(), stopped: true, stop_reason: prior.reason, suppressed: true};
  const attempts = [];
  let stopReason = null;
  for (const notice of (notices || []).filter(item => item.status === 'pending_delivery')) {
    const args = publishArgs(notice, accountId);
    let result;
    try {
      result = await router.call('router.publish', args);
    } catch (error) {
      result = {status: 'unknown', code: 'transport_error', message: error && error.message ? error.message : 'transport_error'};
      const outcome = reconcile({messaging: result, attempted: {event_id: null, run_id: runId, receiver: receiver || null}});
      attempts.push({notice_id: notice.notice_id, request_id: args.request_id, message: args.message, result, outcome});
      stopReason = 'transport_error';
      break;
    }
    const needsInspection = !!(result.event_id && result.status !== 'committed');
    if (needsInspection) {
      stopReason = result.code || result.status || 'unconfirmed';
      stoppedRuns.set(runId, {reason: stopReason, attempts});
    }
    let mailReceipt = null;
    let lookupError = null;
    if (needsInspection && typeof inspectReceipt === 'function') {
      try {
        mailReceipt = await inspectReceipt(result.event_id);
      } catch (error) {
        lookupError = error && error.message ? error.message : 'lookup_failed';
      }
    }
    const receiverTarget = result.target || receiver || null;
    let receiverEpoch = result.version ? result.version.epoch : null;
    if (receiverEpoch == null && result.event_id && receiverTarget && args.message) {
      const receipt = receiptOf(mailReceipt);
      const epoch = receipt && receipt.version ? receipt.version.epoch : null;
      if (epoch != null) {
        const expected = 'router-' + digest({
          run: result.run_id || runId,
          source: args.message.source,
          id: args.message.id,
          target: receiverTarget.app_id,
          account: receiverTarget.account_id,
          epoch
        }).slice(0, 32);
        if (expected === result.event_id) receiverEpoch = epoch;
      }
    }
    const outcome = reconcile({
      messaging: result,
      mailReceipt,
      attempted: {
        event_id: result.event_id || null,
        run_id: result.run_id || runId,
        receiver: receiverTarget,
        receiver_epoch: receiverEpoch
      }
    });
    if (lookupError) outcome.lookup_error = lookupError;
    attempts.push({notice_id: notice.notice_id, request_id: args.request_id, message: args.message, result, outcome});
    if (stopped(result)) {
      stopReason = result.code || result.status || 'unconfirmed';
      stoppedRuns.set(runId, {reason: stopReason, attempts});
      break;
    }
  }
  if (stopReason) stoppedRuns.set(runId, {reason: stopReason, attempts});
  return {attempts, stopped: !!stopReason, stop_reason: stopReason, suppressed: false};
}

function resetDelivery(runId) {
  if (runId) stoppedRuns.delete(runId);
  else stoppedRuns.clear();
}

module.exports = {payloadFor, messageFor, publishArgs, reconcile, publishPending, resetDelivery};
