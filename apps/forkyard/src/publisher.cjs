'use strict';
// Forkyard-owned Mail adapter. Infra supplies the router client and the grant.
// A committed pull closure stays committed whatever this adapter learns about delivery.
const SOURCE = 'urn:pale:email-payload:1';

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

function reconcile({messaging, mailReceipt} = {}) {
  const messagingCommitted = messaging && messaging.status === 'committed';
  const mailCommitted = !!(mailReceipt && (mailReceipt.status === 'committed' || mailReceipt.receipt && mailReceipt.receipt.status === 'committed'));
  if (messagingCommitted || mailCommitted) {
    return {delivery: 'confirmed', source_committed: true, same_run_retry: false};
  }
  return {delivery: 'unresolved', source_committed: true, same_run_retry: false};
}

function stopped(result) {
  if (!result) return true;
  if (result.status === 'committed') return false;
  return true;
}

async function publishPending({notices, accountId, router}) {
  const sent = [];
  for (const notice of notices.filter(item => item.status === 'pending_delivery')) {
    const args = publishArgs(notice, accountId);
    const result = await router.call('router.publish', args);
    const outcome = reconcile({messaging: result});
    sent.push({notice_id: notice.notice_id, request_id: args.request_id, message: args.message, result, outcome});
    if (stopped(result)) break;
  }
  return sent;
}

module.exports = {payloadFor, messageFor, publishArgs, reconcile, publishPending};
