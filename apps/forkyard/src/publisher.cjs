'use strict';
// Forkyard-owned Mail adapter. Infra supplies the router client and the grant.
// A committed pull closure stays committed whatever this adapter learns about delivery.
// A duplicate confirmation is the stored receipt for the original run and the receiver epoch.
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

function reconcile({messaging, mailReceipt, attempted} = {}) {
  const attempt = attempted || {};
  const eventId = attempt.event_id || (messaging && messaging.event_id) || null;
  const runId = attempt.run_id || (messaging && messaging.run_id) || null;
  const receiver = attempt.receiver || (messaging && messaging.target) || null;
  const epoch = attempt.receiver_epoch == null ? (messaging && messaging.version ? messaging.version.epoch : null) : attempt.receiver_epoch;
  const receipt = receiptOf(mailReceipt);
  const receiptEvent = receipt && (receipt.event_id || null);
  const sameEvent = !!(eventId && receiptEvent && receiptEvent === eventId);
  const sameReceiver = !receiver || !receipt || !receipt.app_id || receipt.app_id === receiver.app_id;
  const sameRun = !runId || !receipt || !receipt.run_id || receipt.run_id === runId;
  const sameEpoch = epoch == null || !receipt || !receipt.version || receipt.version.epoch === epoch;
  const mailConfirms = !!(receipt && receipt.status === 'committed' && sameEvent && sameReceiver && sameRun && sameEpoch);
  const messagingConfirms = !!(messaging && messaging.status === 'committed' && messaging.event_id && (!eventId || messaging.event_id === eventId));
  if (messagingConfirms || mailConfirms) {
    return {
      delivery: 'confirmed',
      source_committed: true,
      same_run_retry: false,
      duplicate_within_run: !!(messaging && messaging.duplicate === true && messaging.status === 'committed' && (!runId || messaging.run_id === runId)),
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
    let mailReceipt = null;
    if (result.status === 'unknown' && result.event_id && typeof inspectReceipt === 'function') {
      mailReceipt = await inspectReceipt(result.event_id);
    }
    const outcome = reconcile({
      messaging: result,
      mailReceipt,
      attempted: {
        event_id: result.event_id || null,
        run_id: result.run_id || runId,
        receiver: result.target || receiver || null,
        receiver_epoch: result.version ? result.version.epoch : null
      }
    });
    attempts.push({notice_id: notice.notice_id, request_id: args.request_id, message: args.message, result, outcome});
    if (stopped(result)) {
      stopReason = result.code || result.status;
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
