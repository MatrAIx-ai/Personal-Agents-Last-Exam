'use strict';

function buildCloudEvent({ id, sourceAccount, time, subject, recipient, sourceObject, title, text }) {
  return {
    specversion: '1.0',
    id: String(id).slice(0, 100),
    source: `urn:pale:app:shelfmark-library:account:${sourceAccount}`,
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

function holdReadyNotification(hold, { sourceAccount, recipient, time, noticeTag = 'v1' }) {
  return buildCloudEvent({
    id: `shelfmark-hold-ready-${hold.id}-${noticeTag}`,
    sourceAccount,
    time,
    subject: `hold:${hold.id}`,
    recipient,
    sourceObject: {
      app_id: 'shelfmark-library',
      account_id: sourceAccount,
      object_type: 'hold',
      object_id: hold.id,
    },
    title: `ShelfMark Hold Ready at ${hold.pickup_branch_name || hold.pickup_branch_id}`,
    text: `Your hold ${hold.id} (${hold.title_name || hold.title_id}) is ready for pickup at ${hold.pickup_branch_name || hold.pickup_branch_id} until ${hold.pickup_expires_at}.`,
  });
}

function branchClosureNotification(branchId, { closedUntil, reason, extendedHoldIds, cancelledBookingIds, sourceAccount, recipient, time, noticeTag = 'v1' }) {
  return buildCloudEvent({
    id: `shelfmark-closure-${branchId}-${noticeTag}`,
    sourceAccount,
    time,
    subject: `branch:${branchId}`,
    recipient,
    sourceObject: {
      app_id: 'shelfmark-library',
      account_id: sourceAccount,
      object_type: 'branch',
      object_id: branchId,
    },
    title: `ShelfMark Branch Closure Notice (${branchId})`,
    text: `Branch ${branchId} is closed until ${closedUntil} (${reason}). Extended holds: ${(extendedHoldIds || []).join(', ') || 'none'}. Cancelled room bookings (penalty waived): ${(cancelledBookingIds || []).join(', ') || 'none'}.`,
  });
}

function finePaymentNotification(receipt, { sourceAccount, recipient, time, noticeTag = 'v1' }) {
  return buildCloudEvent({
    id: `shelfmark-receipt-${receipt.payment_receipt_id}-${noticeTag}`,
    sourceAccount,
    time,
    subject: `card:${receipt.card_id}`,
    recipient,
    sourceObject: {
      app_id: 'shelfmark-library',
      account_id: sourceAccount,
      object_type: 'card',
      object_id: receipt.card_id,
    },
    title: `ShelfMark Payment Receipt ${receipt.payment_receipt_id}`,
    text: `Payment of $${(receipt.total_paid_cents / 100).toFixed(2)} received for card ${receipt.card_id} (fines: ${(receipt.paid_fine_ids || []).join(', ')}). Card status is now ${receipt.card_status}.`,
  });
}

async function deliverNotice({ router, message, requestId }) {
  const receipt = await router.call('router.publish', { request_id: requestId, message });
  const correlation = {
    message_id: message.id,
    event_id: receipt.event_id || null,
    source_object: message.data.source_object,
    recipient: message.data.recipient,
    router_status: receipt.status,
  };
  if (receipt.status === 'committed') {
    return { stage: 'delivered', message, receipt, correlation, stop_run: false };
  }
  if (receipt.status === 'unknown' || receipt.status === 'unknown_outcome') {
    return { stage: 'unknown_outcome', message, receipt, correlation, stop_run: true };
  }
  return { stage: 'router_rejected', message, receipt, correlation, stop_run: false };
}

async function publishHoldReadyNotice({ agent, router, holdId, requestId, sourceAccount, recipient, noticeTag = 'v1' }) {
  const fetched = await agent.call('shelfmark-library.hold.get', { hold_id: holdId });
  if (fetched.status !== 'ok') return { stage: 'source_read', result: fetched, correlation: null, stop_run: false };
  const hold = fetched.hold;
  const message = holdReadyNotification(hold, {
    sourceAccount,
    recipient,
    time: hold.ready_at || fetched.virtual_now,
    noticeTag,
  });
  return deliverNotice({ router, message, requestId });
}

async function publishBranchClosureNotice({ router, branchId, closedUntil, reason, extendedHoldIds, cancelledBookingIds, requestId, sourceAccount, recipient, time, noticeTag = 'v1' }) {
  const message = branchClosureNotification(branchId, {
    closedUntil,
    reason,
    extendedHoldIds,
    cancelledBookingIds,
    sourceAccount,
    recipient,
    time,
    noticeTag,
  });
  return deliverNotice({ router, message, requestId });
}

async function publishFinePaymentReceipt({ router, receipt, requestId, sourceAccount, recipient, time, noticeTag = 'v1' }) {
  const message = finePaymentNotification(receipt, {
    sourceAccount,
    recipient,
    time,
    noticeTag,
  });
  return deliverNotice({ router, message, requestId });
}

module.exports = {
  buildCloudEvent,
  holdReadyNotification,
  branchClosureNotification,
  finePaymentNotification,
  deliverNotice,
  publishHoldReadyNotice,
  publishBranchClosureNotice,
  publishFinePaymentReceipt,
};
