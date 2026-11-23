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
      results.push({
        notice_id: notice.notice_id,
        request_id,
        message_id: message.id,
        delivery: 'unresolved',
        reason: 'unknown',
        message: error.message
      });
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

function snapshotData(value) {
  if (!value) return {};
  if (value.snapshot) return snapshotData(value.snapshot);
  if (value.data && value.data.notices) return value.data;
  if (value.notices) return value;
  return value.data || {};
}

async function reconcilePending({snapshot, mail}) {
  const data = snapshotData(snapshot);
  const state = snapshot && snapshot.snapshot ? snapshot.snapshot : snapshot || {};
  const notices = (data.notices || []).filter(notice => notice.delivery_status === 'pending_delivery' || notice.delivery_status === 'unknown');
  const results = [];
  let mailData = null;
  for (const notice of notices) {
    const message_id = 'brightwire-' + data.account_id + '-' + notice.notice_id;
    const request_id = 'notice-' + notice.notice_id;
    let confirmed = false;
    let mail_event_id = null;
    async function committedReceipt(eventId) {
      if (!mail || typeof mail.call !== 'function' || !eventId) return null;
      try {
        const status = await mail.call('env.event_status', {event_id: eventId});
        const receipt = status && status.receipt;
        if (receipt && receipt.status === 'committed') return receipt;
      } catch (error) {
        return null;
      }
      return null;
    }
    const direct = await committedReceipt(message_id);
    if (direct) {
      confirmed = true;
      mail_event_id = direct.event_id || message_id;
    }
    if (!confirmed && mail && typeof mail.call === 'function') {
      if (!mailData) {
        const snap = await mail.call('env.snapshot');
        mailData = snapshotData(snap);
      }
      const found = (mailData.messages || []).find(item => item.thread_id === message_id || item.id === message_id);
      if (found) {
        const receipt = await committedReceipt(found.id);
        if (receipt) {
          confirmed = true;
          mail_event_id = found.id;
        }
      }
    }
    const receipts = state.receipts || (snapshot && snapshot.receipts) || {};
    if (!confirmed) {
      for (const receipt of Object.values(receipts)) {
        const cloud = receipt && receipt.trace && receipt.trace.cloud_event;
        if (cloud && cloud.id === message_id && receipt.status === 'committed') {
          confirmed = true;
          mail_event_id = receipt.event_id || message_id;
        }
      }
    }
    results.push({
      run_id: state.run_id || null,
      account_id: data.account_id,
      notice_id: notice.notice_id,
      request_id,
      message_id,
      mail_event_id,
      delivery: confirmed ? 'confirmed' : 'unresolved'
    });
  }
  const confirmedCount = results.filter(item => item.delivery === 'confirmed').length;
  return {
    delivery: results.length && confirmedCount === results.length ? 'confirmed' : 'unresolved',
    results
  };
}

module.exports = {messageFor, pendingNotices, publishPending, reconcilePending, sourceUri};
