'use strict';

const fs = require('node:fs');
const { wireFor } = require('./notices.cjs');

// One run has three publication states.
// pending: this notice has not been attempted.
// verified: receiver evidence for this exact event id is committed.
// stopped: every other outcome. The original notice identifiers are stored first.
// Later calls may inspect and write that evidence again. They do not publish.

function attemptedId(receipt, expectedEventId) {
  return (receipt && receipt.event_id) || expectedEventId || null;
}

function classifyDelivery({ receipt, eventStatus, mailRecord, expectedEventId }) {
  const eventId = attemptedId(receipt, expectedEventId);
  if (receipt && receipt.status === 'rejected' && !receipt.stop_run) {
    return { outcome: 'rejected', halted: true, event_id: eventId, code: receipt.code || null };
  }
  const evidence = eventStatus && eventStatus.receipt;
  const evidenceId = evidence && (evidence.event_id || evidence.id) || null;
  if (evidence && evidence.status === 'committed' && evidenceId && eventId && evidenceId === eventId) {
    return { outcome: 'confirmed', halted: false, event_id: eventId, code: null };
  }
  if (mailRecord && mailRecord.id && eventId && mailRecord.id === eventId) {
    return { outcome: 'confirmed', halted: false, event_id: eventId, code: null };
  }
  const halted = !receipt || Boolean(receipt.stop_run || receipt.status === 'unknown' || receipt.status === 'halted' || receipt.status !== 'committed');
  return {
    outcome: 'unresolved',
    halted: halted || true,
    event_id: eventId,
    code: receipt && receipt.code || (eventId ? 'unconfirmed' : 'response_lost')
  };
}

function blockingNotice(data, logPath) {
  const stored = data.notices.find(notice => notice.status === 'unknown' || notice.status === 'rejected');
  if (stored) return stored;
  return data.notices.find(notice => {
    const receipt = receiptForNotice(logPath, notice);
    return receipt && receipt.status !== 'committed';
  }) || null;
}

function recordEvidence(data, report) {
  const notice = data.notices.find(item => item.notice_id === report.notice_id);
  if (!notice) return;
  const status = report.outcome === 'confirmed' ? 'committed' : report.outcome === 'rejected' ? 'rejected' : 'unknown';
  notice.delivery = {
    at: null,
    status,
    event_id: report.event_id || null,
    code: report.code || null
  };
  notice.status = status === 'committed' ? 'committed' : status === 'rejected' ? 'rejected' : 'unknown';
}

function persistOf(report) {
  const status = report.outcome === 'confirmed' ? 'committed' : report.outcome === 'rejected' ? 'rejected' : 'unknown';
  return {
    notice_id: report.notice_id,
    publish_request_id: report.publish_request_id,
    cloud_event_id: report.cloud_event_id,
    event_id: 'delivery-' + report.notice_id,
    status,
    code: report.code || null,
    receipt_event_id: report.event_id || null
  };
}

function readReceipts(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function receiptForNotice(logPath, notice) {
  let found = null;
  for (const row of readReceipts(logPath)) {
    const id = row.cloud_event && row.cloud_event.id;
    if (row.request_id === notice.publish_request_id || id === notice.cloud_event_id) found = row.result || null;
  }
  return found;
}

function stamp(notice, report) {
  report.notice_id = notice.notice_id;
  report.publish_request_id = notice.publish_request_id;
  report.cloud_event_id = notice.cloud_event_id;
  return report;
}

async function verify(notice, receipt, inspect) {
  let evidence = null;
  if (inspect && receipt && receipt.event_id) {
    try {
      evidence = await inspect({ notice, receipt, event_id: receipt.event_id });
    } catch {
      evidence = { failed: true };
    }
  }
  const report = classifyDelivery({
    receipt,
    eventStatus: evidence && evidence.eventStatus,
    mailRecord: evidence && evidence.mailRecord,
    expectedEventId: receipt && receipt.event_id
  });
  if (evidence && evidence.failed && report.outcome !== 'confirmed') report.code = 'inspection_unavailable';
  if (report.outcome !== 'confirmed') report.halted = true;
  return stamp(notice, report);
}

async function finish(data, report, commit) {
  const item = persistOf(report);
  recordEvidence(data, report);
  let write = null;
  if (commit) {
    try { write = await commit(item); }
    catch (error) { write = { status: error && error.code || 'stale_version' }; }
  }
  return { persist: [item], write };
}

function writeFailed(write) {
  return Boolean(write && write.status && !['committed', 'ok', 'ready'].includes(write.status));
}

async function publishPending({ data, router, inspect, commit, receiptLog }) {
  const sent = [];
  const persist = [];
  const blocked = blockingNotice(data, receiptLog);
  if (blocked) {
    const notice = blocked;
    const receipt = receiptForNotice(receiptLog, notice);
    const report = receipt
      ? await verify(notice, receipt, inspect)
      : stamp(notice, { outcome: 'unresolved', halted: true, event_id: notice.delivery && notice.delivery.event_id || null, code: 'run_halted' });
    report.halted = true;
    if (report.outcome === 'confirmed') {
      const done = await finish(data, report, commit);
      return { stopped: true, sent, persist: done.persist, report, write: done.write };
    }
    return { stopped: true, sent, persist, report };
  }
  const pending = data.notices.filter(notice => notice.status === 'pending_delivery');
  for (const notice of pending) {
    let receipt = receiptForNotice(receiptLog, notice);
    if (!receipt) {
      try {
        receipt = await router.call('router.publish', {
          request_id: notice.publish_request_id,
          message: wireFor(data, notice)
        });
        sent.push({ notice_id: notice.notice_id, receipt });
      } catch {
        receipt = receiptForNotice(receiptLog, notice);
        if (receipt) sent.push({ notice_id: notice.notice_id, receipt, recovered: true });
      }
    } else {
      sent.push({ notice_id: notice.notice_id, receipt, recovered: true });
    }
    const report = receipt
      ? await verify(notice, receipt, inspect)
      : stamp(notice, { outcome: 'unresolved', halted: true, event_id: null, code: 'response_lost' });
    const done = await finish(data, report, commit);
    persist.push(...done.persist);
    const clean = receipt && receipt.status === 'committed' && !receipt.stop_run;
    if (report.outcome !== 'confirmed' || !clean || writeFailed(done.write)) {
      return { stopped: true, sent, persist, report, write: done.write };
    }
  }
  return { stopped: false, sent, persist, report: null };
}

module.exports = { classifyDelivery, publishPending, receiptForNotice, wireFor };
