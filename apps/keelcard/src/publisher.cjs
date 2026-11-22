'use strict';
const { wireFor } = require('./notices.cjs');

// Infra runs this adapter. It reads pending notices from an Infra snapshot.
// A halt keeps the receipt, inspects Mail, and returns evidence the host applies.
function matchingRecord(messages, eventId) {
  if (!eventId || !Array.isArray(messages)) return null;
  return messages.find(message => message && message.id === eventId) || null;
}

function classifyDelivery({ receipt, eventStatus, mailRecord, expectedEventId }) {
  const attempted = expectedEventId || receipt?.event_id || null;
  const statusReceipt = eventStatus && eventStatus.receipt ? eventStatus.receipt : null;
  const record = mailRecord && attempted && mailRecord.id === attempted ? mailRecord : null;
  const statusConfirmed = Boolean(statusReceipt && statusReceipt.status === 'committed' && (!statusReceipt.event_id || statusReceipt.event_id === attempted));
  if (receipt?.status === 'committed' || receipt?.duplicate === true) {
    return { outcome: 'confirmed', halted: false, event_id: receipt.event_id || attempted, publish_request_id: receipt.request_id || null };
  }
  if (statusConfirmed || record) {
    return {
      outcome: 'confirmed',
      halted: Boolean(receipt?.stop_run),
      event_id: record ? record.id : (statusReceipt && statusReceipt.event_id) || attempted,
      publish_request_id: receipt?.request_id || null
    };
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

function persistOf(notice, report) {
  if (!report || report.outcome === 'rejected') return null;
  return {
    notice_id: notice.notice_id,
    publish_request_id: notice.publish_request_id,
    status: report.outcome === 'confirmed' ? 'committed' : 'unknown',
    event_id: report.event_id || null,
    code: report.code || null
  };
}

async function routerAlreadyHalted(router) {
  try {
    const caps = await router.call('router.capabilities', {});
    return Boolean(caps && caps.status === 'ok' && caps.halted);
  } catch {
    return false;
  }
}

async function publishPending({ data, router, inspect, commit }) {
  const sent = [];
  const persist = [];
  if (await routerAlreadyHalted(router)) {
    return { stopped: true, sent, persist, report: { outcome: 'unresolved', halted: true, code: 'run_halted' } };
  }
  const pending = data.notices.filter(notice => notice.status === 'pending_delivery');
  for (const notice of pending) {
    const message = wireFor(data, notice);
    let receipt;
    try {
      receipt = await router.call('router.publish', { request_id: notice.publish_request_id, message });
    } catch {
      const report = { outcome: 'unresolved', halted: true, event_id: null, code: 'inspection_unavailable', publish_request_id: notice.publish_request_id };
      const item = persistOf(notice, report);
      persist.push(item);
      if (commit) await commit(item);
      return { stopped: true, sent, persist, report };
    }
    sent.push({ notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, cloud_event_id: notice.cloud_event_id, receipt });
    let report = classifyDelivery({ receipt, expectedEventId: receipt && receipt.event_id });
    if (report.halted) {
      let evidence = null;
      let inspectionFailed = false;
      if (inspect) {
        try {
          evidence = await inspect({ notice, receipt, event_id: receipt && receipt.event_id });
        } catch {
          inspectionFailed = true;
        }
      }
      if (inspectionFailed) {
        report = { outcome: 'unresolved', halted: true, event_id: receipt && receipt.event_id || null, code: 'inspection_unavailable', publish_request_id: notice.publish_request_id };
      } else {
        report = classifyDelivery({
          receipt,
          eventStatus: evidence && evidence.eventStatus,
          mailRecord: evidence && evidence.mailRecord,
          expectedEventId: receipt && receipt.event_id
        });
      }
      report.publish_request_id = notice.publish_request_id;
      report.notice_id = notice.notice_id;
      recordEvidence(data, notice, report);
      const item = persistOf(notice, report);
      if (item) persist.push(item);
      if (item && commit) await commit(item);
      return { stopped: true, sent, persist, report };
    }
    if (report.outcome !== 'confirmed') return { stopped: false, sent, persist, report };
    report.publish_request_id = notice.publish_request_id;
    const item = persistOf(notice, report);
    if (item) persist.push(item);
    if (item && commit) await commit(item);
  }
  return { stopped: false, sent, persist, report: { outcome: 'confirmed', halted: false } };
}

module.exports = { classifyDelivery, publishPending, wireFor, matchingRecord, recordEvidence };
