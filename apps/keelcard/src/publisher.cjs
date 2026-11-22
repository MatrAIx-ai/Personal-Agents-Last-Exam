'use strict';
const { wireFor } = require('./notices.cjs');

// Infra runs this adapter. It reads pending notices from an Infra snapshot.
// A halted Messaging result stops this call. The request and code stay on the Keelcard record.
function classifyDelivery({ receipt, mailStatus, mailRecord }) {
  const mailCommitted = mailStatus === 'committed' || mailStatus?.status === 'committed' || Boolean(mailRecord);
  if (receipt?.status === 'committed' || receipt?.duplicate === true || mailCommitted) {
    return { outcome: 'confirmed', halted: Boolean(receipt?.stop_run) };
  }
  const halted = Boolean(receipt?.stop_run) || receipt?.status === 'halted' || receipt?.status === 'unknown' || receipt?.code === 'receiver_rejected';
  if (halted) return { outcome: 'unresolved', halted: true };
  return { outcome: 'rejected', halted: false, code: receipt?.code || null };
}

async function publishPending({ data, router }) {
  const sent = [];
  const pending = data.notices.filter(notice => notice.status === 'pending_delivery');
  for (const notice of pending) {
    const message = wireFor(data, notice);
    const receipt = await router.call('router.publish', { request_id: notice.publish_request_id, message });
    sent.push({ notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, cloud_event_id: notice.cloud_event_id, receipt });
    const report = classifyDelivery({ receipt });
    if (report.halted || report.outcome !== 'confirmed') {
      return { stopped: report.halted, sent, report };
    }
  }
  return { stopped: false, sent, report: { outcome: sent.length ? 'confirmed' : 'confirmed', halted: false } };
}

module.exports = { classifyDelivery, publishPending, wireFor };
