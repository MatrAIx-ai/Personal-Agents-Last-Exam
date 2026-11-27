'use strict';

// Explicit App-owned post-commit outbound publisher for channel.email.
// Core clock advances and local claim commits never dispatch Mail automatically;
// a caller or workflow driver invokes these functions after verifying local commit.

function buildCloudEvent({ id, sourceAccount, time, subject, recipient, sourceObject, title, text }) {
  return {
    specversion: '1.0',
    id,
    source: `urn:pale:app:recallwatch:account:${sourceAccount}`,
    type: 'org.pale.mail.notification.v1',
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    time,
    subject,
    data: {
      channel: 'channel.email',
      recipient,
      source_object: sourceObject,
      content: {
        title,
        body: { format: 'text/plain', text },
        asset_ids: [],
      },
      extensions: [],
    },
  };
}

function claimNotification(claim, { sourceAccount, recipient }) {
  if (!claim || claim.account_id !== sourceAccount) {
    throw new Error('Only claims belonging to the bound sourceAccount can be published.');
  }
  if (!['submitted', 'approved_refund', 'approved_replacement', 'approved_repair_kit', 'rejected'].includes(claim.status)) {
    throw new Error(`Claim status ${claim.status} is not eligible for outbound Mail notification.`);
  }
  const time = claim.submitted_at || claim.updated_at;
  const msgId = `recallwatch-claim-${claim.id}-${claim.status}`;
  return buildCloudEvent({
    id: msgId,
    sourceAccount,
    time,
    subject: claim.id,
    recipient,
    sourceObject: {
      app_id: 'recallwatch',
      account_id: sourceAccount,
      object_type: 'remedy_claim',
      object_id: claim.id,
    },
    title: `RecallWatch Claim ${claim.status.replace(/_/g, ' ')}: ${claim.recall_id}`,
    text: `Claim ${claim.id} (${claim.remedy_type}) for lot ${claim.lot_code} under ${claim.recall_id} is now ${claim.status}. Receipt: ${claim.claim_receipt_id || 'pending'}.`,
  });
}

async function publishClaimNotification({ agent, router, claimId, requestId, sourceAccount, recipient }) {
  const fetched = await agent.call('recallwatch.claim.get', { id: claimId });
  if (fetched.status !== 'ok') {
    return { stage: 'source_read', result: fetched, correlation: null };
  }
  const message = claimNotification(fetched.item, { sourceAccount, recipient });
  const receipt = await router.call('router.publish', { request_id: requestId, message });

  const correlation = {
    message_id: message.id,
    event_id: receipt.event_id || null,
    source_object: message.data.source_object,
    recipient: message.data.recipient,
    router_status: receipt.status,
  };

  if (receipt.status === 'committed') {
    return { stage: 'delivered', source: fetched.item, message, receipt, correlation, stop_run: false };
  }
  if (receipt.status === 'unknown' || receipt.status === 'unknown_outcome') {
    return { stage: 'unknown_outcome', source: fetched.item, message, receipt, correlation, stop_run: true };
  }
  return { stage: 'router_rejected', source: fetched.item, message, receipt, correlation, stop_run: false };
}

module.exports = {
  buildCloudEvent,
  claimNotification,
  publishClaimNotification,
};
