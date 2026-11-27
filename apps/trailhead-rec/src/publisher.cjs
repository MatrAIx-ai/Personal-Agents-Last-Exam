'use strict';

// Explicit App-owned post-commit outbound publisher for channel.email.
// Uses unique CloudEvents IDs (<= 100 chars), which Mail preserves as thread_id for mail.get correlation.

function buildCloudEvent({ id, sourceAccount, time, subject, recipient, sourceObject, title, text }) {
  if (id.length > 100) throw new Error('CloudEvents id must be <= 100 characters.');
  return {
    specversion: '1.0',
    id,
    source: `urn:pale:app:trailhead-rec:account:${sourceAccount}`,
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

function enrollmentNotification(enr, { sourceAccount, recipient, noticeTag = 'v1' }) {
  if (!enr || enr.account_id !== sourceAccount) {
    throw new Error('Enrollment does not belong to bound sourceAccount.');
  }
  const msgId = `th-enr-${enr.id}-${enr.status}-${noticeTag}`.slice(0, 100);
  return buildCloudEvent({
    id: msgId,
    sourceAccount,
    time: enr.updated_at,
    subject: enr.id,
    recipient,
    sourceObject: {
      app_id: 'trailhead-rec',
      account_id: sourceAccount,
      object_type: 'enrollment',
      object_id: enr.id,
    },
    title: `Trailhead Enrollment ${enr.status}: ${enr.program_id} (${enr.confirmation_code})`,
    text: `Enrollment ${enr.id} for ${enr.person_ref} in ${enr.program_id} is now ${enr.status}. Fee paid: ${enr.fee_paid_cents} cents. Confirmation: ${enr.confirmation_code}.`,
  });
}

async function publishEnrollmentNotice({ agent, router, enrollmentId, requestId, sourceAccount, recipient, noticeTag = 'v1' }) {
  const fetched = await agent.call('trailhead-rec.enrollment.get', { id: enrollmentId });
  if (fetched.status !== 'ok') return { stage: 'source_read', result: fetched, correlation: null };
  const message = enrollmentNotification(fetched.item, { sourceAccount, recipient, noticeTag });
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
  enrollmentNotification,
  publishEnrollmentNotice,
};
