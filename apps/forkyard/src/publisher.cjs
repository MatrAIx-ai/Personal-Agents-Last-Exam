'use strict';
// Forkyard-owned Mail adapter. Infra supplies the router client and the grant.
// A committed pull closure stays committed whatever this adapter learns about delivery.
// Within the same run and receiver epoch, a duplicate request returns the original receipt.
const {digest} = require('../../../runtime/messaging/src/contracts.cjs');
const SOURCE = 'urn:pale:email-payload:1';
const runs = new Map();

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

function filled(value) {
  return value !== undefined && value !== null && value !== '';
}

function messageHash(message) {
  return message ? digest(message) : null;
}

function payloadHash(message) {
  return message && message.data ? digest(message.data) : null;
}

function sourceObject(message) {
  const object = message && message.data && message.data.source_object;
  if (!object) return null;
  return (object.object_type || '') + ':' + (object.object_id || '');
}

function bindingKey(runId, receiver, message) {
  const epoch = receiver && receiver.epoch != null ? String(receiver.epoch) : '';
  const source = message && message.source ? message.source : '';
  return [runId || '', epoch, source, messageHash(message) || ''].join('|');
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

function copyReceiver(receiver) {
  if (!receiver) return null;
  return {
    app_id: receiver.app_id || null,
    account_id: receiver.account_id || null,
    address: receiver.address || null,
    epoch: receiver.epoch == null ? null : receiver.epoch
  };
}

function routerMatches(result, binding) {
  if (!result || result.status !== 'committed' || result.duplicate === true) return false;
  if (!binding || !binding.message || result.run_id !== binding.run_id) return false;
  const receiver = binding.receiver;
  if (!receiver || !result.target) return false;
  if (result.target.app_id !== receiver.app_id || result.target.account_id !== receiver.account_id) return false;
  if (!result.version || result.version.epoch !== receiver.epoch) return false;
  const expected = routerEventId(binding.run_id, binding.message, receiver, receiver.epoch);
  return !!expected && result.event_id === expected;
}

function retainedCloudEvent(mailReceipt) {
  const event = mailReceipt && mailReceipt.retained_event;
  const message = event && event.payload && event.payload.message;
  return message && message.specversion ? message : null;
}

function envelopeDiff(attempted, retained) {
  if (!attempted || !retained) return ['missing_event'];
  const diffs = [];
  if (retained.id !== attempted.id) diffs.push('id');
  if (retained.source !== attempted.source) diffs.push('source');
  if (retained.subject !== attempted.subject) diffs.push('subject');
  if (sourceObject(retained) !== sourceObject(attempted)) diffs.push('source_object');
  if (retained.time !== attempted.time) diffs.push('time');
  const left = attempted.data && attempted.data.recipient;
  const right = retained.data && retained.data.recipient;
  if (JSON.stringify(left || null) !== JSON.stringify(right || null)) diffs.push('recipient');
  if (payloadHash(retained) !== payloadHash(attempted)) diffs.push('payload_hash');
  return diffs;
}

function renderedMessage(record) {
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

function judge({messaging, mailReceipt, binding}) {
  const message = binding && binding.message;
  const retained = retainedCloudEvent(mailReceipt);
  const diffs = envelopeDiff(message, retained);
  const identity = routerMatches(messaging, binding);
  const confirmed = diffs.length === 0;
  const eventId = (messaging && messaging.event_id) || (binding && binding.receiver ? routerEventId(binding.run_id, message, binding.receiver, binding.receiver.epoch) : null);
  return {
    delivery: confirmed ? 'confirmed' : 'unresolved',
    source_committed: true,
    same_run_retry: false,
    duplicate_within_run: !!(confirmed && messaging && messaging.duplicate === true && binding && messaging.run_id === binding.run_id && messaging.version && binding.receiver && messaging.version.epoch === binding.receiver.epoch),
    event_id: eventId,
    correlated: confirmed,
    reason: confirmed ? null : diffs[0],
    comparison: {
      expected: message ? {
        id: message.id,
        source: message.source,
        subject: message.subject,
        source_object: sourceObject(message),
        time: message.time,
        recipient: message.data && message.data.recipient || null,
        payload_hash: payloadHash(message)
      } : null,
      observed: {
        id: retained && retained.id || null,
        source: retained && retained.source || null,
        subject: retained && retained.subject || null,
        source_object: sourceObject(retained),
        time: retained && retained.time || null,
        recipient: retained && retained.data && retained.data.recipient || null,
        payload_hash: payloadHash(retained),
        message: renderedMessage(mailReceipt && mailReceipt.receiver_record)
      },
      identity,
      payload: confirmed,
      discrepancies: diffs
    }
  };
}

function reconcile({messaging, mailReceipt, attempted, message} = {}) {
  const attempt = attempted || {};
  const cloud = message || attempt.message || null;
  const receiver = copyReceiver(attempt.receiver);
  if (receiver && attempt.receiver_epoch != null) receiver.epoch = attempt.receiver_epoch;
  return judge({
    messaging,
    mailReceipt,
    binding: {run_id: attempt.run_id || null, receiver, message: cloud}
  });
}

function retainedEvent(snapshot, eventId) {
  const slot = snapshot && snapshot.receipts && snapshot.receipts['event:' + eventId];
  if (!slot || !slot.fingerprint) return null;
  try {
    const parsed = JSON.parse(slot.fingerprint);
    return parsed && parsed.event ? parsed.event : null;
  } catch (error) {
    return null;
  }
}

async function inspectReceiver(client, eventId) {
  const status = await client.call('env.event_status', {event_id: eventId});
  const snap = await client.call('env.snapshot');
  const data = snap.snapshot && snap.snapshot.data;
  const stored = data && data.messages ? data.messages.find(item => item.id === eventId) : null;
  const receipt = status && Object.prototype.hasOwnProperty.call(status, 'receipt') ? status.receipt : null;
  return {
    receipt,
    retained_event: retainedEvent(snap.snapshot, eventId),
    receiver_record: stored ? {
      app_id: 'mail',
      account_id: stored.account_id,
      run_id: snap.snapshot.run_id,
      epoch: snap.snapshot.epoch,
      id: stored.id,
      thread_id: stored.thread_id,
      from: stored.from,
      subject: stored.subject,
      body: stored.body,
      to: stored.to
    } : null
  };
}

function blankAttempt(notice, accountId, runId, receiver) {
  const args = publishArgs(notice, accountId);
  const copied = copyReceiver(receiver);
  return {
    key: bindingKey(runId, copied, args.message),
    notice_id: notice.notice_id,
    request_id: args.request_id,
    run_id: runId,
    receiver_epoch: copied && copied.epoch != null ? copied.epoch : null,
    source: args.message.source,
    message_hash: messageHash(args.message),
    message: args.message,
    receiver: copied,
    event_id: routerEventId(runId, args.message, copied, copied && copied.epoch),
    result: null,
    outcome: null
  };
}

function unresolved(attempt, reason) {
  attempt.outcome = {
    delivery: 'unresolved',
    source_committed: true,
    same_run_retry: false,
    duplicate_within_run: false,
    event_id: attempt.event_id,
    correlated: false,
    reason,
    comparison: {expected: null, observed: null, identity: false, payload: false, discrepancies: [reason]}
  };
  return attempt;
}

function project(state, notices, accountId, runId, receiver) {
  const attempts = [];
  const history = [];
  const seen = new Set();
  for (const notice of notices || []) {
    if (notice.status !== 'pending_delivery') continue;
    const key = bindingKey(runId, receiver, messageFor(notice, accountId));
    const current = state.attempts.filter(item => item.notice_id === notice.notice_id && item.key === key);
    const older = state.attempts.filter(item => item.notice_id === notice.notice_id && item.key !== key);
    if (current.length) attempts.push(current[current.length - 1]);
    for (const item of older) {
      if (seen.has(item)) continue;
      seen.add(item);
      history.push(item);
    }
  }
  return {attempts, history};
}

async function settle(attempt, binding, messaging, inspectReceipt) {
  const eventId = attempt.event_id || (messaging && messaging.event_id) || null;
  let mailReceipt = null;
  let lookupError = null;
  if (eventId && typeof inspectReceipt === 'function') {
    try {
      mailReceipt = await inspectReceipt(eventId);
    } catch (error) {
      lookupError = error && error.message ? error.message : 'lookup_failed';
    }
  }
  const outcome = judge({messaging, mailReceipt, binding});
  if (lookupError) {
    outcome.lookup_error = lookupError;
    outcome.delivery = 'unresolved';
    outcome.correlated = false;
    outcome.reason = 'lookup_error';
    outcome.comparison.payload = false;
    outcome.comparison.discrepancies = outcome.comparison.discrepancies.concat('lookup_error');
  }
  attempt.outcome = outcome;
  attempt.event_id = eventId;
  return lookupError;
}

async function publishPending({notices, accountId, router, runId, inspectReceipt, receiver} = {}) {
  if (!runId) throw new Error('publishPending requires the run id.');
  const copied = copyReceiver(receiver);
  const state = runs.get(runId) || {halted: false, reason: null, in_flight: false, receiver: copied, attempts: []};
  state.receiver = copied || state.receiver;
  runs.set(runId, state);
  const pending = (notices || []).filter(item => item.status === 'pending_delivery');
  if (state.halted || state.in_flight) {
    return {attempts: state.attempts.slice(), history: [], stopped: true, stop_reason: state.reason, suppressed: true, halted: state.halted, receiver: state.receiver};
  }
  let published = false;
  for (const notice of pending) {
    const attempt = blankAttempt(notice, accountId, runId, copied);
    const same = state.attempts.find(item => item.key === attempt.key);
    if (same) continue;
    const older = state.attempts.some(item => item.notice_id === notice.notice_id || item.receiver_epoch !== attempt.receiver_epoch);
    if (older && state.attempts.some(item => item.receiver_epoch !== attempt.receiver_epoch)) {
      state.attempts.push(unresolved(attempt, 'binding_changed'));
      continue;
    }
    if (state.attempts.some(item => item.notice_id === notice.notice_id && item.message_hash !== attempt.message_hash)) {
      state.attempts.push(unresolved(attempt, 'binding_changed'));
      continue;
    }
    state.attempts.push(attempt);
    state.in_flight = true;
    runs.set(runId, state);
    let result;
    try {
      result = await router.call('router.publish', {request_id: attempt.request_id, message: attempt.message});
    } catch (error) {
      result = {status: 'unknown', code: 'transport_error', message: error && error.message ? error.message : 'transport_error'};
    }
    attempt.result = result;
    const binding = {run_id: runId, receiver: copied, message: attempt.message};
    if (!routerMatches(result, binding)) {
      state.halted = true;
      state.reason = (result && (result.code || result.status)) || 'unresolved';
      runs.set(runId, state);
    }
    const lookupError = await settle(attempt, binding, result, inspectReceipt);
    state.in_flight = false;
    if (lookupError) {
      state.halted = true;
      state.reason = 'lookup_error';
      runs.set(runId, state);
    }
    published = true;
    if (state.halted) break;
  }
  const view = project(state, pending, accountId, runId, copied);
  return {
    attempts: view.attempts,
    history: view.history,
    stopped: state.halted,
    stop_reason: state.reason,
    suppressed: !published,
    halted: state.halted,
    receiver: state.receiver
  };
}

function resetDelivery(runId) {
  if (runId) runs.delete(runId);
  else runs.clear();
}

module.exports = {payloadFor, messageFor, publishArgs, reconcile, inspectReceiver, routerEventId, publishPending, resetDelivery};
