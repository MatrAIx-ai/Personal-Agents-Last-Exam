'use strict';

// Explicit App-owned post-commit outbound publisher for channel.email.
// Uses unique CloudEvents IDs (<= 100 chars), which Mail preserves as thread_id for mail.get correlation.

function buildCloudEvent({ id, sourceAccount, time, subject, recipient, sourceObject, title, text }) {
  if (id.length > 100) throw new Error('CloudEvents id must be <= 100 characters.');
  return {
    specversion: '1.0',
    id,
    source: `urn:pale:app:clovervet:account:${sourceAccount}`,
    type: 'org.pale.mail.notification.v1',
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    time,
    subject,
    data: {
      channel: 'channel.email',
      recipient,
      source_object: sourceObject,
      content: { title, body: { format: 'text/plain', text }, asset_ids: [] },
      extensions: [],
    },
  };
}

function appointmentNotification(appt, { sourceAccount, recipient, noticeTag = 'v1' }) {
  if (!appt || appt.account_id !== sourceAccount) throw new Error('Appointment does not belong to bound sourceAccount.');
  const msgId = `cv-appt-${appt.id}-${appt.status}-${noticeTag}`.slice(0, 100);
  return buildCloudEvent({
    id: msgId, sourceAccount, time: appt.updated_at, subject: appt.id, recipient,
    sourceObject: { app_id: 'clovervet', account_id: sourceAccount, object_type: 'appointment', object_id: appt.id },
    title: `CloverVet Appointment ${appt.status}: ${appt.visit_type} (${appt.confirmation_code})`,
    text: `Appointment ${appt.id} (${appt.visit_type}) for pet ${appt.pet_id} at ${appt.branch_id} on ${appt.starts_at} is ${appt.status}. Confirmation: ${appt.confirmation_code}.`,
  });
}

function clearanceNotification(cert, { sourceAccount, recipient, noticeTag = 'v1' }) {
  if (!cert || cert.account_id !== sourceAccount) throw new Error('Clearance does not belong to bound sourceAccount.');
  const msgId = `cv-cert-${cert.id}-${cert.status}-${noticeTag}`.slice(0, 100);
  return buildCloudEvent({
    id: msgId, sourceAccount, time: cert.updated_at, subject: cert.id, recipient,
    sourceObject: { app_id: 'clovervet', account_id: sourceAccount, object_type: 'clearance_certificate', object_id: cert.id },
    title: `CloverVet Health Clearance ${cert.status}: ${cert.clearance_type} (${cert.id})`,
    text: `Health clearance ${cert.id} (${cert.clearance_type}) for pet ${cert.pet_id} is ${cert.status}. Valid until ${cert.valid_until}.`,
  });
}

function refillNotification(rfl, { sourceAccount, recipient, noticeTag = 'v1' }) {
  if (!rfl || rfl.account_id !== sourceAccount) throw new Error('Refill does not belong to bound sourceAccount.');
  const msgId = `cv-rfl-${rfl.id}-${rfl.status}-${noticeTag}`.slice(0, 100);
  return buildCloudEvent({
    id: msgId, sourceAccount, time: rfl.updated_at, subject: rfl.id, recipient,
    sourceObject: { app_id: 'clovervet', account_id: sourceAccount, object_type: 'prescription_refill', object_id: rfl.id },
    title: `CloverVet Prescription Refill ${rfl.status}: ${rfl.prescription_id} (${rfl.refill_receipt_id})`,
    text: `Refill ${rfl.id} for prescription ${rfl.prescription_id} (pet ${rfl.pet_id}) is ${rfl.status} (${rfl.fulfillment_mode}). Receipt: ${rfl.refill_receipt_id}.`,
  });
}

async function dispatch(router, requestId, message, source) {
  const receipt = await router.call('router.publish', { request_id: requestId, message });
  const correlation = {
    message_id: message.id,
    event_id: receipt.event_id || null,
    source_object: message.data.source_object,
    recipient: message.data.recipient,
    router_status: receipt.status,
  };
  if (receipt.status === 'committed') return { stage: 'delivered', source, message, receipt, correlation, stop_run: false };
  if (receipt.status === 'unknown' || receipt.status === 'unknown_outcome') {
    return { stage: 'unknown_outcome', source, message, receipt, correlation, stop_run: true };
  }
  return { stage: 'router_rejected', source, message, receipt, correlation, stop_run: false };
}

async function publishAppointmentConfirmation({ agent, router, appointmentId, requestId, sourceAccount, recipient, noticeTag = 'v1' }) {
  const fetched = await agent.call('clovervet.appointment.get', { id: appointmentId });
  if (fetched.status !== 'ok') return { stage: 'source_read', result: fetched, correlation: null };
  return dispatch(router, requestId, appointmentNotification(fetched.item, { sourceAccount, recipient, noticeTag }), fetched.item);
}

async function publishClearanceNotice({ agent, router, clearanceId, requestId, sourceAccount, recipient, noticeTag = 'v1' }) {
  const listed = await agent.call('clovervet.clearance.list', {});
  if (listed.status !== 'ok') return { stage: 'source_read', result: listed, correlation: null };
  const cert = listed.items.find((x) => x.id === clearanceId);
  if (!cert) return { stage: 'source_read', result: { status: 'not_found', id: clearanceId }, correlation: null };
  return dispatch(router, requestId, clearanceNotification(cert, { sourceAccount, recipient, noticeTag }), cert);
}

async function publishRefillNotice({ agent, router, refillId, requestId, sourceAccount, recipient, noticeTag = 'v1' }) {
  const fetched = await agent.call('clovervet.prescription.get', { id: refillId });
  if (fetched.status !== 'ok' || !fetched.refill_request) return { stage: 'source_read', result: fetched, correlation: null };
  return dispatch(router, requestId, refillNotification(fetched.refill_request, { sourceAccount, recipient, noticeTag }), fetched.refill_request);
}

module.exports = {
  buildCloudEvent,
  appointmentNotification,
  clearanceNotification,
  refillNotification,
  publishAppointmentConfirmation,
  publishClearanceNotice,
  publishRefillNotice,
};
