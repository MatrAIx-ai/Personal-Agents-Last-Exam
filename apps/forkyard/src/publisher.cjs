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

function routerEventId(runId, message, receiver, epoch) {
  if (!message || !receiver || !filled(receiver.app_id) || !filled(receiver.account_id) || epoch == null) return null;
  return 'router-' + digest({
    run: runId,
    source: message.source,
    id: message.id,
    target: receiver.app_id,
    account: receiver.account_id,
    epoch
  }).slice(0, 32);
}

function expectedPayload(message) {
  const data = message && message.data;
  const content = data && data.content;
  return {
    recipient: data && data.recipient ? data.recipient : null,
    subject: content ? content.title : null,
    body: content && content.body ? content.body.text : null
  };
}

function observedMessage(record) {
  if (!record) return null;
  return {
    id: record.id || null,
    thread_id: record.thread_id || null,
    from: record.from || null,
    to: Array.isArray(record.to) ? record.to.slice() : [],
    subject: record.subject == null ? null : record.subject,
    body: record.body == null ? null : record.body,
    account_id: record.account_id || null
  };
}

function payloadAgrees(record, message, receiver) {
  const expected = expectedPayload(message);
  const observed = observedMessage(record);
  if (!observed || expected.subject == null || expected.body == null) return false;
  if (observed.subject !== expected.subject || observed.body !== expected.body) return false;
  if (!observed.to.length) return false;
  if (receiver && filled(receiver.address) && !observed.to.includes(receiver.address)) return false;
  const app = message.data && message.data.source_object && message.data.source_object.app_id;
  if (app && filled(observed.from) && observed.from !== app + '@pale.example') return false;
  if (filled(message.id) && filled(observed.thread_id) && observed.thread_id !== message.id) return false;
  return true;
}

function identityAgrees(receipt, record, binding, eventId) {
  if (!receipt || receipt.status !== 'committed' || !filled(eventId) || receipt.event_id !== eventId) return false;
  if (!binding || !filled(binding.run_id)) return false;
  const run = receiptRun(receipt) || (record && record.run_id) || null;
  if (run !== binding.run_id) return false;
  if (!binding.receiver || !filled(binding.receiver.app_id) || !filled(binding.receiver.account_id)) return false;
  const account = receiptAccount(receipt, record);
  const appId = receipt.app_id || (record && record.app_id) || null;
  if (account !== binding.receiver.account_id || appId !== binding.receiver.app_id) return false;
  const epoch = receipt.version && receipt.version.epoch != null ? receipt.version.epoch : (record && record.epoch != null ? record.epoch : null);
  if (epoch == null) return false;
  const expected = routerEventId(binding.run_id, binding.message, binding.receiver, epoch);
  if (expected !== eventId) return false;
  if (binding.receiver.epoch != null && binding.receiver.epoch !== epoch) return false;
  return true;
}

function judge({messaging, mailReceipt, binding, eventId}) {
  const receipt = receiptOf(mailReceipt);
  const record = (mailReceipt && mailReceipt.receiver_record) || null;
  const message = binding && binding.message;
  const identity = identityAgrees(receipt, record, binding, eventId);
  const payload = payloadAgrees(record, message, binding && binding.receiver);
  const comparison = {
    expected: {
      run_id: binding && binding.run_id || null,
      receiver: binding && binding.receiver || null,
      event_id: eventId || null,
      ...expectedPayload(message)
    },
    observed: {
      run_id: receiptRun(receipt),
      app_id: receipt && (receipt.app_id || (record && record.app_id)) || null,
      account_id: receiptAccount(receipt, record),
      epoch: receipt && receipt.version ? receipt.version.epoch : null,
      event_id: receipt && receipt.event_id || null,
      message: observedMessage(record)
    },
    identity,
    payload
  };
  if (identity && payload) {
    return {
      delivery: 'confirmed',
      source_committed: true,
      same_run_retry: false,
      duplicate_within_run: !!(messaging && messaging.duplicate === true && messaging.run_id === binding.run_id),
      event_id: eventId,
      correlated: true,
      comparison
    };
  }
  const reason = !identity ? 'identity_mismatch' : 'payload_mismatch';
  return {
    delivery: 'unresolved',
    source_committed: true,
    same_run_retry: false,
    duplicate_within_run: false,
    event_id: eventId,
    correlated: false,
    reason,
    comparison
  };
}

function reconcile({messaging, mailReceipt, attempted, message} = {}) {
  const attempt = attempted || {};
  const cloud = message || attempt.message || null;
  const receiver = attempt.receiver || null;
  const binding = {
    run_id: attempt.run_id || null,
    receiver: receiver ? {...receiver, epoch: attempt.receiver_epoch != null ? attempt.receiver_epoch : receiver.epoch} : null,
    message: cloud
  };
  if (binding.receiver && attempt.receiver_epoch != null) binding.receiver.epoch = attempt.receiver_epoch;
  const eventId = attempt.event_id || routerEventId(binding.run_id, cloud, binding.receiver, binding.receiver && binding.receiver.epoch);
  return judge({messaging, mailReceipt, binding, eventId});
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
      body: stored.body,
      to: stored.to
    } : null
  };
}

function bindingFrom(runId, receiver, message) {
  return {
    run_id: runId,
    receiver: receiver ? {
      app_id: receiver.app_id || null,
      account_id: receiver.account_id || null,
      address: receiver.address || null,
      epoch: receiver.epoch == null ? null : receiver.epoch
    } : null,
    message
  };
}

async function settleAttempt(attempt, {messaging, inspectReceipt, binding, eventId}) {
  let mailReceipt = null;
  let lookupError = null;
  if (eventId && typeof inspectReceipt === 'function') {
    try {
      mailReceipt = await inspectReceipt(eventId);
    } catch (error) {
      lookupError = error && error.message ? error.message : 'lookup_failed';
    }
  }
  const outcome = judge({messaging, mailReceipt, binding, eventId});
  if (lookupError) outcome.lookup_error = lookupError;
  attempt.outcome = outcome;
  attempt.event_id = eventId;
  return outcome;
}

async function publishPending({notices, accountId, router, runId, inspectReceipt, receiver} = {}) {
  if (!runId) throw new Error('publishPending requires the run id.');
  const prior = stoppedRuns.get(runId);
  if (prior && (prior.phase === 'halted' || prior.phase === 'in_flight')) {
    return {attempts: prior.attempts.slice(), stopped: true, stop_reason: prior.reason, suppressed: true, receiver: prior.receiver};
  }
  const done = new Set((prior && prior.attempts || []).map(item => item.notice_id));
  const pending = (notices || []).filter(item => item.status === 'pending_delivery' && !done.has(item.notice_id));
  if (prior && prior.phase === 'settled' && !pending.length) {
    return {attempts: prior.attempts.slice(), stopped: false, stop_reason: null, suppressed: true, receiver: prior.receiver};
  }
  const attempts = prior && prior.attempts ? prior.attempts : [];
  const state = {
    phase: 'in_flight',
    reason: 'awaiting_router',
    receiver: receiver ? {
      app_id: receiver.app_id || null,
      account_id: receiver.account_id || null,
      address: receiver.address || null,
      epoch: receiver.epoch == null ? null : receiver.epoch
    } : null,
    attempts
  };
  stoppedRuns.set(runId, state);
  let stopReason = null;
  for (const notice of pending) {
    const args = publishArgs(notice, accountId);
    const binding = bindingFrom(runId, state.receiver, args.message);
    const plannedId = routerEventId(runId, args.message, state.receiver, state.receiver && state.receiver.epoch);
    const attempt = {
      notice_id: notice.notice_id,
      request_id: args.request_id,
      message: args.message,
      receiver: state.receiver,
      event_id: plannedId,
      result: null,
      outcome: null
    };
    attempts.push(attempt);
    let result;
    try {
      result = await router.call('router.publish', args);
    } catch (error) {
      result = {status: 'unknown', code: 'transport_error', message: error && error.message ? error.message : 'transport_error'};
    }
    attempt.result = result;
    const eventId = plannedId || (result && result.event_id) || null;
    const outcome = await settleAttempt(attempt, {messaging: result, inspectReceipt, binding, eventId});
    if (outcome.delivery !== 'confirmed') {
      stopReason = outcome.reason || (result && (result.code || result.status)) || 'unresolved';
      state.phase = 'halted';
      state.reason = stopReason;
      break;
    }
  }
  if (stopReason) {
    state.phase = 'halted';
    state.reason = stopReason;
  } else {
    state.phase = 'settled';
    state.reason = null;
  }
  return {attempts: attempts.slice(), stopped: !!stopReason, stop_reason: stopReason, suppressed: false, receiver: state.receiver};
}

function resetDelivery(runId) {
  if (runId) stoppedRuns.delete(runId);
  else stoppedRuns.clear();
}

module.exports = {payloadFor, messageFor, publishArgs, reconcile, inspectReceiver, routerEventId, publishPending, resetDelivery};
