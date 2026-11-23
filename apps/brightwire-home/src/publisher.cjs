'use strict';
// Infra runs this after a Brightwire commit. It reads pending notices and
// publishes each one once. A rejected or unknown acknowledgement stops the
// rest. Device state is not changed here.

function sourceUri(accountId) {
  return 'urn:pale:app:' + encodeURIComponent('brightwire-home') + ':account:' + encodeURIComponent(accountId);
}

function messageFor(data, notice) {
  return {
    specversion: '1.0',
    id: 'brightwire-' + data.account_id + '-' + notice.notice_id,
    source: sourceUri(data.account_id),
    type: 'org.pale.mail.notification.v1',
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    time: notice.created_at,
    data: {
      channel: 'channel.email',
      recipient: {kind: 'person_ref', id: notice.recipient_person_id},
      source_object: {
        app_id: 'brightwire-home',
        account_id: data.account_id,
        object_type: notice.object_type,
        object_id: notice.object_id
      },
      content: {
        title: notice.title,
        body: {format: 'text/plain', text: notice.body},
        asset_ids: []
      },
      extensions: []
    }
  };
}

function pendingNotices(snapshot) {
  const data = snapshot.data || snapshot.snapshot?.data;
  return (data.notices || []).filter(notice => notice.delivery_status === 'pending_delivery');
}

function attemptFields(data, notice, message, run_id, extra) {
  return {
    notice_id: notice.notice_id,
    request_id: 'notice-' + notice.notice_id,
    message_id: message.id,
    source: message.source,
    run_id: run_id || null,
    ...extra
  };
}

function runIdOf(snapshot, explicit) {
  if (explicit) return explicit;
  if (snapshot && snapshot.run_id) return snapshot.run_id;
  if (snapshot && snapshot.snapshot && snapshot.snapshot.run_id) return snapshot.snapshot.run_id;
  return null;
}

async function publishPending({snapshot, router, run_id = null}) {
  const resolvedRun = runIdOf(snapshot, run_id);
  if (!resolvedRun) {
    const error = new Error('publishPending needs a run id from the snapshot.');
    error.code = 'invalid_arguments';
    throw error;
  }
  const data = snapshot.data || snapshot.snapshot.data;
  const notices = pendingNotices(snapshot);
  run_id = resolvedRun;
  const results = [];
  for (const notice of notices) {
    const message = messageFor(data, notice);
    const request_id = 'notice-' + notice.notice_id;
    let receipt;
    try {
      receipt = await router.call('router.publish', {request_id, message});
    } catch (error) {
      results.push(attemptFields(data, notice, message, run_id, {
        delivery: 'unresolved',
        reason: 'unknown',
        message: error.message
      }));
      return {delivery: 'unresolved', stopped: true, results};
    }
    const confirmed = receipt && (receipt.status === 'committed' || receipt.duplicate === true && receipt.status === 'committed');
    const recordedRun = receipt && receipt.run_id || run_id;
    results.push(attemptFields(data, notice, message, recordedRun, {
      delivery: confirmed ? 'confirmed' : 'unresolved',
      receipt
    }));
    if (!confirmed) return {delivery: 'unresolved', stopped: true, results};
  }
  return {delivery: 'confirmed', stopped: false, results};
}

function snapshotData(value) {
  if (!value) return {};
  if (value.snapshot) return snapshotData(value.snapshot);
  if (value.data && value.data.notices) return value.data;
  if (value.notices) return value;
  return value.data || {};
}

function unresolvedAttempt(data, attempt) {
  return {
    delivery: 'unresolved',
    results: [{
      run_id: attempt.run_id || null,
      account_id: data.account_id || null,
      notice_id: attempt.notice_id,
      request_id: attempt.request_id || null,
      message_id: attempt.message_id || null,
      source: attempt.source || null,
      mail_event_id: null,
      delivery: 'unresolved'
    }]
  };
}

async function reconcilePending({snapshot, mail, attempt}) {
  const data = snapshotData(snapshot);
  if (!attempt || !attempt.notice_id) return {delivery: 'unresolved', results: []};
  const message_id = attempt.message_id || ('brightwire-' + data.account_id + '-' + attempt.notice_id);
  const source = attempt.source || sourceUri(data.account_id);
  const run_id = attempt.run_id || null;
  const row = {
    run_id,
    account_id: data.account_id || null,
    notice_id: attempt.notice_id,
    request_id: attempt.request_id || ('notice-' + attempt.notice_id),
    message_id,
    source,
    mail_event_id: null,
    delivery: 'unresolved'
  };
  try {
    if (!mail || typeof mail.call !== 'function' || !run_id) return {delivery: 'unresolved', results: [row]};
    const snap = await mail.call('env.snapshot');
    const mailData = snapshotData(snap);
    const found = (mailData.messages || []).find(item => item.thread_id === message_id);
    if (!found) return {delivery: 'unresolved', results: [row]};
    const status = await mail.call('env.event_status', {event_id: found.id});
    const receipt = status && status.receipt;
    const cloud = receipt && receipt.trace && receipt.trace.cloud_event;
    const sameRun = receipt && receipt.trace && receipt.trace.run_id === run_id;
    if (receipt && receipt.status === 'committed' && cloud && cloud.id === message_id && cloud.source === source && sameRun) {
      row.delivery = 'confirmed';
      row.mail_event_id = found.id;
    }
  } catch (error) {
    return unresolvedAttempt(data, {...attempt, message_id, source, run_id});
  }
  return {delivery: row.delivery, results: [row]};
}

module.exports = {messageFor, pendingNotices, publishPending, reconcilePending, sourceUri};
