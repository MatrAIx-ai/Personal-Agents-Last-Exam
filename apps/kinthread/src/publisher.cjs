'use strict';
const cloudEvents = require('./message-envelope.cjs');

function messageFor(accountId, notice) {
  return cloudEvents.create({
    id: 'kinthread-' + accountId + '-' + notice.notice_id,
    app: 'kinthread',
    account: accountId,
    type: 'org.pale.mail.notification.v1',
    dataschema: 'urn:pale:email-payload:1',
    time: notice.created_at,
    subject: notice.notice_id,
    data: {
      channel: 'channel.email',
      recipient: {kind: 'person_ref', id: notice.recipient_person_id},
      source_object: {app_id: 'kinthread', account_id: accountId, object_type: notice.object_type, object_id: notice.object_id},
      content: {title: notice.title, body: {format: 'text/plain', text: notice.body}, asset_ids: []},
      extensions: []
    }
  });
}

async function publishPending({infra, router}) {
  const snap = await infra.call('env.snapshot');
  const data = snap.snapshot ? snap.snapshot.data : snap.data;
  const pending = (data.notices || []).filter(notice => notice.status === 'pending_delivery');
  const results = [];
  for (const notice of pending) {
    const message = messageFor(data.account_id, notice);
    const request_id = 'notice-' + notice.notice_id;
    const result = await router.call('router.publish', {request_id, message});
    results.push({notice_id: notice.notice_id, request_id, result});
    if (!result || result.status === 'unknown' || result.status === 'halted' || result.stop_run) {
      return {stopped: true, reason: result && (result.code || result.status), results};
    }
  }
  return {stopped: false, results};
}

module.exports = {messageFor, publishPending};
