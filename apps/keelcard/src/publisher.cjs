'use strict';

const fs = require('node:fs');
const { wireFor } = require('./notices.cjs');

function classifyDelivery({ receipt, eventStatus, mailRecord, expectedEventId }) {
  const eventId = receipt && receipt.event_id || null;
  if (receipt && receipt.status === 'rejected' && !receipt.stop_run) {
    return { outcome: 'rejected', halted: false, event_id: eventId, code: receipt.code || null };
  }
  const halted = Boolean(receipt && (receipt.stop_run || receipt.status === 'unknown' || receipt.status === 'halted'));
  const status = eventStatus && eventStatus.receipt;
  const observed = eventId || (status && status.event_id) || null;
  const sameEvent = !expectedEventId || observed === expectedEventId;
  if (sameEvent && status && status.status === 'committed' && (!expectedEventId || status.event_id === expectedEventId || eventId === expectedEventId)) {
    return { outcome: 'confirmed', halted, event_id: observed, code: null };
  }
  if (mailRecord && ((eventId && mailRecord.id === eventId) || (expectedEventId && mailRecord.id === expectedEventId))) {
    return { outcome: 'confirmed', halted, event_id: mailRecord.id, code: null };
  }
  if (!halted && receipt && (receipt.status === 'committed' || receipt.duplicate)) {
    return { outcome: 'confirmed', halted: false, event_id: eventId, code: null };
  }
  return { outcome: 'unresolved', halted, event_id: eventId, code: receipt && receipt.code || (halted ? 'unconfirmed' : null) };
}

function recordEvidence(data, report) {
  const notice = data.notices.find(item => item.notice_id === report.notice_id);
  if (!notice) return;
  notice.delivery = {
    at: null,
    status: report.outcome === 'confirmed' ? 'committed' : report.outcome === 'rejected' ? 'rejected' : 'unknown',
    event_id: report.event_id,
    code: report.code
  };
  if (report.outcome === 'confirmed') notice.status = 'committed';
  else if (report.outcome === 'rejected') notice.status = 'rejected';
}

function persistOf(report) {
  return {
    notice_id: report.notice_id,
    publish_request_id: report.publish_request_id,
    cloud_event_id: report.cloud_event_id,
    event_id: 'delivery-' + report.notice_id,
    status: report.outcome === 'confirmed' ? 'committed' : report.outcome === 'rejected' ? 'rejected' : 'unknown',
    code: report.code,
    receipt_event_id: report.event_id
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

async function routerAlreadyHalted(router) {
  try {
    const caps = await router.call('router.capabilities', {});
    return Boolean(caps && caps.status === 'ok' && caps.halted);
  } catch {
    return false;
  }
}

function attemptReport(notice, extra) {
  return {
    outcome: 'unresolved',
    halted: true,
    event_id: null,
    code: 'response_lost',
    notice_id: notice.notice_id,
    publish_request_id: notice.publish_request_id,
    cloud_event_id: notice.cloud_event_id,
    ...extra
  };
}

async function reconcile(notice, receipt, inspect) {
  let report = classifyDelivery({ receipt, expectedEventId: receipt && receipt.event_id });
  if (report.halted && inspect) {
    try {
      const evidence = await inspect({ notice, receipt, event_id: receipt && receipt.event_id });
      report = classifyDelivery({
        receipt,
        eventStatus: evidence && evidence.eventStatus,
        mailRecord: evidence && evidence.mailRecord,
        expectedEventId: receipt && receipt.event_id
      });
    } catch {
      report = { outcome: 'unresolved', halted: true, event_id: receipt && receipt.event_id || null, code: 'inspection_unavailable' };
    }
  }
  report.notice_id = notice.notice_id;
  report.publish_request_id = notice.publish_request_id;
  report.cloud_event_id = notice.cloud_event_id;
  if (!report.event_id && receipt && receipt.event_id) report.event_id = receipt.event_id;
  return report;
}

async function finish(data, report, commit) {
  const persist = report.event_id || report.outcome === 'rejected' ? [persistOf(report)] : [];
  if (persist.length) recordEvidence(data, report);
  let write = null;
  if (commit && persist.length) {
    try { write = await commit(persist[0]); }
    catch (error) { write = { status: error && error.code || 'stale_version' }; }
  }
  return { persist, write };
}

async function publishPending({ data, router, inspect, commit, receiptLog }) {
  const halted = await routerAlreadyHalted(router);
  const pending = data.notices.filter(notice => notice.status === 'pending_delivery');
  const sent = [];
  if (halted) {
    const notice = pending[0];
    if (!notice) return { stopped: true, sent, persist: [], report: { outcome: 'unresolved', halted: true, code: 'run_halted', event_id: null } };
    const receipt = receiptForNotice(receiptLog, notice);
    const report = receipt
      ? await reconcile(notice, receipt, inspect)
      : attemptReport(notice, { code: 'run_halted' });
    report.halted = true;
    const done = await finish(data, report, commit);
    return { stopped: true, sent, persist: done.persist, report, write: done.write };
  }
  const persist = [];
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
        if (!receipt) {
          const report = attemptReport(notice);
          return { stopped: true, sent, persist, report };
        }
        sent.push({ notice_id: notice.notice_id, receipt, recovered: true });
      }
    } else {
      sent.push({ notice_id: notice.notice_id, receipt, recovered: true });
    }
    const report = await reconcile(notice, receipt, inspect);
    const done = await finish(data, report, commit);
    persist.push(...done.persist);
    if (report.halted || report.outcome !== 'confirmed') {
      return { stopped: report.halted, sent, persist, report, write: done.write };
    }
  }
  return { stopped: false, sent, persist, report: null };
}

module.exports = { classifyDelivery, publishPending, receiptForNotice, wireFor };
