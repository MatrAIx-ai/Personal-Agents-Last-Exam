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

async function publishPending({snapshot, router}) {
  const data = snapshot.data || snapshot.snapshot.data;
  const notices = pendingNotices(snapshot);
  const results = [];
  for (const notice of notices) {
    const message = messageFor(data, notice);
    const request_id = 'notice-' + notice.notice_id;
    let receipt;
    try {
      receipt = await router.call('router.publish', {request_id, message});
    } catch (error) {
      results.push({notice_id: notice.notice_id, delivery: 'unresolved', reason: 'unknown', message: error.message});
      return {delivery: 'unresolved', stopped: true, results};
    }
    const confirmed = receipt && (receipt.status === 'committed' || receipt.duplicate === true && receipt.status === 'committed');
    if (confirmed) {
      results.push({notice_id: notice.notice_id, request_id, delivery: 'confirmed', receipt});
      continue;
    }
    results.push({notice_id: notice.notice_id, request_id, delivery: 'unresolved', receipt});
    return {delivery: 'unresolved', stopped: true, results};
  }
  return {delivery: 'confirmed', stopped: false, results};
}

module.exports = {messageFor, pendingNotices, publishPending, sourceUri};
