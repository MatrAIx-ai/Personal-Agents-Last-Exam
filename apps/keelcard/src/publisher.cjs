'use strict';
const { wireFor } = require('./notices.cjs');

// Infra runs this adapter. It reads pending notices from an Infra snapshot.
// A halt keeps the receipt, inspects Mail, records confirmed or unresolved, and stops.
function matchingRecord(messages, eventId) {
  if (!eventId || !Array.isArray(messages)) return null;
  return messages.find(message => message && message.id === eventId) || null;
}

function classifyDelivery({ receipt, eventStatus, mailRecord, expectedEventId }) {
  const attempted = expectedEventId || receipt?.event_id || null;
  const statusReceipt = eventStatus && eventStatus.receipt ? eventStatus.receipt : null;
  const statusEvent = statusReceipt && (statusReceipt.event_id || attempted);
  const record = mailRecord && attempted && mailRecord.id === attempted ? mailRecord : null;
  const statusConfirmed = Boolean(statusReceipt && statusReceipt.status === 'committed' && (!statusReceipt.event_id || statusReceipt.event_id === attempted));
  if (receipt?.status === 'committed' || receipt?.duplicate === true) {
    return { outcome: 'confirmed', halted: false, event_id: receipt.event_id || attempted, publish_request_id: receipt.request_id || null };
  }
  if (statusConfirmed || record) {
    return { outcome: 'confirmed', halted: Boolean(receipt?.stop_run), event_id: statusEvent || record.id, publish_request_id: null };
  }
  const halted = Boolean(receipt?.stop_run) || receipt?.status === 'halted' || receipt?.status === 'unknown' || receipt?.code === 'receiver_rejected';
  if (halted) return { outcome: 'unresolved', halted: true, event_id: attempted, publish_request_id: null };
  return { outcome: 'rejected', halted: false, code: receipt?.code || null, event_id: attempted, publish_request_id: null };
}

function recordEvidence(data, notice, report) {
  if (!report || report.outcome === 'rejected') return;
  const next = report.outcome === 'confirmed' ? 'committed' : 'unknown';
  if ((notice.status === 'committed' || notice.status === 'rejected') && notice.status !== next) return;
  if (notice.delivery && notice.delivery.event_id && report.event_id && notice.delivery.event_id !== report.event_id) return;
  if (notice.status !== 'committed' && notice.status !== 'rejected') notice.status = next === 'committed' ? 'committed' : notice.status;
  notice.delivery = {
    publish_request_id: notice.publish_request_id,
    status: next === 'committed' ? 'committed' : (notice.delivery && notice.delivery.status) || 'unknown',
    event_id: (notice.delivery && notice.delivery.event_id) || report.event_id || null,
    code: report.code || null,
    recorded_at: notice.delivery && notice.delivery.recorded_at || null
  };
}

async function publishPending({ data, router, inspect }) {
  const sent = [];
  const pending = data.notices.filter(notice => notice.status === 'pending_delivery');
  for (const notice of pending) {
    const message = wireFor(data, notice);
    const receipt = await router.call('router.publish', { request_id: notice.publish_request_id, message });
    sent.push({ notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, cloud_event_id: notice.cloud_event_id, receipt });
    let report = classifyDelivery({ receipt, expectedEventId: receipt && receipt.event_id });
    if (report.halted) {
      const evidence = inspect ? await inspect({ notice, receipt, event_id: receipt && receipt.event_id }) : null;
      report = classifyDelivery({
        receipt,
        eventStatus: evidence && evidence.eventStatus,
        mailRecord: evidence && evidence.mailRecord,
        expectedEventId: receipt && receipt.event_id
      });
      recordEvidence(data, notice, report);
      return { stopped: true, sent, report };
    }
    if (report.outcome !== 'confirmed') return { stopped: false, sent, report };
  }
  return { stopped: false, sent, report: { outcome: 'confirmed', halted: false } };
}

module.exports = { classifyDelivery, publishPending, wireFor, matchingRecord, recordEvidence };
