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

function messageAgrees(record, message, eventId) {
  if (!record || !message) return false;
  if (record.thread_id !== message.id) return false;
  if (filled(eventId) && filled(record.id) && record.id !== eventId) return false;
  const app = message.data && message.data.source_object && message.data.source_object.app_id;
  if (app && filled(record.from) && record.from !== app + '@pale.example') return false;
  if (filled(message.source) && app && message.source !== 'urn:pale:app:' + app + ':account:' + message.data.source_object.account_id) return false;
  return true;
}

function messagingAgrees(messaging, attempt, message) {
  if (!messaging || messaging.status !== 'committed') return false;
  if (!filled(messaging.event_id) || !filled(messaging.run_id) || !filled(attempt.run_id)) return false;
  if (messaging.event_id !== attempt.event_id || messaging.run_id !== attempt.run_id) return false;
  const target = messaging.target;
  if (!target || !filled(target.app_id) || !filled(target.account_id)) return false;
  if (attempt.receiver && (target.app_id !== attempt.receiver.app_id || target.account_id !== attempt.receiver.account_id)) return false;
  if (!messaging.version || messaging.version.epoch == null) return false;
  if (attempt.receiver_epoch != null && messaging.version.epoch !== attempt.receiver_epoch) return false;
  if (message && messaging.cloud_event && (messaging.cloud_event.id !== message.id || messaging.cloud_event.source !== message.source)) return false;
  return true;
}

function mailAgrees(receipt, record, attempt, message) {
  if (!receipt || receipt.status !== 'committed' || !messageAgrees(record, message, attempt.event_id)) return false;
  if (!filled(attempt.event_id) || receipt.event_id !== attempt.event_id || !filled(attempt.run_id)) return false;
  const run = receiptRun(receipt) || (record && record.run_id) || null;
  if (run !== attempt.run_id) return false;
  const receiver = attempt.receiver;
  if (!receiver || !filled(receiver.app_id) || !filled(receiver.account_id)) return false;
  const account = receiptAccount(receipt, record);
  const appId = receipt.app_id || (record && record.app_id) || null;
  if (account !== receiver.account_id || appId !== receiver.app_id) return false;
  const epoch = receipt.version && receipt.version.epoch != null ? receipt.version.epoch : (record && record.epoch != null ? record.epoch : null);
  if (attempt.receiver_epoch == null || epoch !== attempt.receiver_epoch) return false;
  return true;
}

function reconcile({messaging, mailReceipt, attempted, message} = {}) {
  const attempt = attempted || {};
  const eventId = attempt.event_id || null;
  const receipt = receiptOf(mailReceipt);
  const record = (mailReceipt && mailReceipt.receiver_record) || null;
  const cloud = message || attempt.message || null;
  const messagingConfirms = messagingAgrees(messaging, {...attempt, event_id: eventId}, cloud);
  const mailConfirms = mailAgrees(receipt, record, {...attempt, event_id: eventId}, cloud);
  const observed = {
    run_id: attempt.run_id || null,
    receiver: attempt.receiver || null,
    cloud_event: cloud ? {id: cloud.id, source: cloud.source} : null,
    message: record ? {id: record.id || null, thread_id: record.thread_id || null, from: record.from || null} : null
  };
  if (messagingConfirms || mailConfirms) {
    return {
      delivery: 'confirmed',
      source_committed: true,
      same_run_retry: false,
      duplicate_within_run: !!(messagingConfirms && messaging && messaging.duplicate === true && messaging.run_id === attempt.run_id),
      event_id: eventId,
      correlated: true,
      observed
    };
  }
  return {delivery: 'unresolved', source_committed: true, same_run_retry: false, duplicate_within_run: false, event_id: eventId, correlated: false, observed};
}

async function inspectReceiver(client, eventId) {
  const status = await client.call('env.event_status', {event_id: eventId});
  const snap = await client.call('env.snapshot');
  const data = snap.snapshot && snap.snapshot.data;
  const stored = data && data.messages ? data.messages.find(item => item.id === eventId) : null;
  const receipt = status && Object.prototype.hasOwnProperty.call(status, 'receipt') ? status.receipt : null;
  return {
    receipt,
    receiver_record: stored ? {
      app_id: 'mail',
      account_id: stored.account_id,
      run_id: receipt && receipt.trace && receipt.trace.run_id ? receipt.trace.run_id : snap.snapshot.run_id,
      epoch: receipt && receipt.version && receipt.version.epoch != null ? receipt.version.epoch : snap.snapshot.epoch,
      id: stored.id,
      thread_id: stored.thread_id,
      from: stored.from,
      subject: stored.subject,
      body: stored.body
    } : null
  };
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
      const outcome = reconcile({messaging: result, message: args.message, attempted: {event_id: null, run_id: runId, receiver: receiver || null, message: args.message}});
      attempts.push({notice_id: notice.notice_id, request_id: args.request_id, message: args.message, result, outcome});
      stopReason = 'transport_error';
      break;
    }
    const needsInspection = !!(result.event_id && result.status !== 'committed');
    const pending = {notice_id: notice.notice_id, request_id: args.request_id, message: args.message, result, outcome: null};
    attempts.push(pending);
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
    const receiverTarget = receiver || result.target || null;
    let receiverEpoch = result.version && result.run_id === runId ? result.version.epoch : null;
    if (receiverEpoch == null && result.event_id && receiverTarget && args.message) {
      const receipt = receiptOf(mailReceipt);
      const epoch = receipt && receipt.version ? receipt.version.epoch : null;
      if (epoch != null) {
        const expected = 'router-' + digest({
          run: runId,
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
      message: args.message,
      attempted: {
        event_id: result.event_id || null,
        run_id: runId,
        receiver: receiverTarget,
        receiver_epoch: receiverEpoch,
        message: args.message
      }
    });
    if (lookupError) outcome.lookup_error = lookupError;
    pending.outcome = outcome;
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

module.exports = {payloadFor, messageFor, publishArgs, reconcile, inspectReceiver, publishPending, resetDelivery};
