'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { wireFor } = require('./notices.cjs');

// Halt and confirmation are separate.
// A router result halts the run unless it is a fresh committed receipt for this binding.
// The halt is stored before Mail is inspected, and nothing in the run clears it.
// Mail confirmation only changes delivery evidence.

function evidenceEventId(noticeId, status, receiptEventId, code) {
  const raw = JSON.stringify([noticeId, status, receiptEventId || null, code || null]);
  return 'delivery-' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

function haltPath(receiptLog) {
  if (!receiptLog) return null;
  return require('node:path').join(require('node:path').dirname(receiptLog), 'keelcard-publication.json');
}

function readHalt(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.halted ? parsed : null;
  } catch {
    return null;
  }
}

function writeHalt(file, record) {
  if (!file) return;
  fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record));
}

function sameNotice(notice, row) {
  if (!row) return false;
  const request = row.request_id || null;
  const cloud = row.cloud_event && row.cloud_event.id || null;
  if (!request && !cloud) return false;
  if (request && request !== notice.publish_request_id) return false;
  if (cloud && cloud !== notice.cloud_event_id) return false;
  return true;
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
    if (sameNotice(notice, row)) found = row.result || null;
  }
  return found;
}

function isFresh(receipt, notice, binding) {
  if (!receipt || receipt.status !== 'committed' || receipt.stop_run || receipt.duplicate) return false;
  if (!receipt.event_id) return false;
  const cloud = receipt.cloud_event && receipt.cloud_event.id;
  if (cloud && cloud !== notice.cloud_event_id) return false;
  if (receipt.request_id && receipt.request_id !== notice.publish_request_id) return false;
  if (!binding) return true;
  if (binding.run_id && receipt.run_id !== binding.run_id) return false;
  if (binding.account_id && (!receipt.target || receipt.target.account_id !== binding.account_id)) return false;
  if (binding.epoch !== undefined && binding.epoch !== null) {
    const epoch = receipt.version && receipt.version.epoch;
    if (epoch !== binding.epoch) return false;
  }
  return true;
}

function mailAgrees(eventId, eventStatus, mailRecord) {
  if (!eventId) return false;
  const evidence = eventStatus && eventStatus.receipt;
  const evidenceId = evidence && (evidence.event_id || evidence.id) || null;
  if (evidence && evidence.status === 'committed' && evidenceId === eventId) return true;
  if (mailRecord && mailRecord.id === eventId) return true;
  return false;
}

function classifyDelivery({ receipt, eventStatus, mailRecord, expectedEventId }) {
  const receiptId = receipt && receipt.event_id || null;
  if (expectedEventId && receiptId && expectedEventId !== receiptId) {
    return { outcome: 'unresolved', halted: true, event_id: null, code: 'identity_mismatch', mail_confirmed: false };
  }
  const eventId = receiptId || expectedEventId || null;
  if (receipt && receipt.status === 'rejected' && !receipt.stop_run) {
    return { outcome: 'rejected', halted: true, event_id: eventId, code: receipt.code || null, mail_confirmed: false };
  }
  const confirmed = mailAgrees(eventId, eventStatus, mailRecord);
  if (confirmed) return { outcome: 'confirmed', halted: false, event_id: eventId, code: null, mail_confirmed: true };
  return {
    outcome: 'unresolved',
    halted: true,
    event_id: eventId,
    code: receipt && receipt.code || (eventId ? 'unconfirmed' : 'response_lost'),
    mail_confirmed: false
  };
}

function deliveryStatus(report) {
  if (report.mail_confirmed) return 'committed';
  if (report.outcome === 'rejected') return 'rejected';
  return 'unknown';
}

function recordEvidence(data, report) {
  const notice = data.notices.find(item => item.notice_id === report.notice_id);
  if (!notice) return;
  const status = deliveryStatus(report);
  notice.delivery = {
    at: null,
    status,
    event_id: report.event_id || null,
    code: report.code || null
  };
  notice.status = status;
}

function persistOf(report) {
  const status = deliveryStatus(report);
  return {
    kind: 'evidence',
    notice_id: report.notice_id,
    publish_request_id: report.publish_request_id,
    cloud_event_id: report.cloud_event_id,
    event_id: evidenceEventId(report.notice_id, status, report.event_id, report.code),
    status,
    code: report.code || null,
    receipt_event_id: report.event_id || null
  };
}

function writeOk(write) {
  if (!write) return false;
  if (write.duplicate === true) return true;
  return ['committed', 'ok', 'ready'].includes(write.status);
}

async function inspectNotice(inspect, notice, eventId) {
  if (!inspect || !eventId) return null;
  try {
    return await inspect({ notice, event_id: eventId });
  } catch {
    return { failed: true };
  }
}

function stamp(notice, report) {
  report.notice_id = notice.notice_id;
  report.publish_request_id = notice.publish_request_id;
  report.cloud_event_id = notice.cloud_event_id;
  return report;
}

async function settle(data, notice, receipt, inspect, commit) {
  const eventId = receipt && receipt.event_id || notice.delivery && notice.delivery.event_id || null;
  const evidence = await inspectNotice(inspect, notice, eventId);
  const report = stamp(notice, classifyDelivery({
    receipt: receipt ? { ...receipt, event_id: eventId } : null,
    eventStatus: evidence && evidence.eventStatus,
    mailRecord: evidence && evidence.mailRecord,
    expectedEventId: eventId
  }));
  if (evidence && evidence.failed && !report.mail_confirmed) report.code = 'inspection_unavailable';
  const item = persistOf(report);
  recordEvidence(data, report);
  let write = null;
  if (commit) {
    try { write = await commit(item); }
    catch (error) { write = { status: error && error.code || 'stale_version', message: error && error.message }; }
  }
  report.persisted = commit ? writeOk(write) : true;
  report.mail_confirmed = Boolean(report.mail_confirmed);
  return { report, item, write };
}

function rememberHalt(data, file, notice, receipt) {
  const existing = readHalt(file);
  if (existing && existing.halted) {
    data.publication = existing;
    return existing;
  }
  const record = {
    halted: true,
    notice_id: notice.notice_id,
    publish_request_id: notice.publish_request_id,
    cloud_event_id: notice.cloud_event_id,
    event_id: receipt && receipt.event_id || null,
    status: receipt && receipt.status || 'unknown',
    stop_run: Boolean(receipt && receipt.stop_run),
    code: receipt && receipt.code || (receipt ? 'unconfirmed' : 'response_lost')
  };
  data.publication = record;
  writeHalt(file, record);
  return record;
}

function haltedAlready(data, file) {
  return readHalt(file) || (data.publication && data.publication.halted ? data.publication : null);
}

async function publishPending({ data, router, inspect, commit, receiptLog, binding }) {
  const file = haltPath(receiptLog);
  const sent = [];
  const persist = [];
  const held = haltedAlready(data, file);
  if (held) {
    data.publication = held;
    const notice = data.notices.find(item => item.notice_id === held.notice_id) || data.notices.find(item => item.status === 'pending_delivery');
    if (!notice || notice.notice_id !== held.notice_id) {
      return { stopped: true, halted: true, sent, persist, report: stamp(notice || held, { outcome: 'unresolved', halted: true, event_id: held.event_id || null, code: held.code || 'run_halted', mail_confirmed: false, persisted: false }) };
    }
    const logged = receiptForNotice(receiptLog, notice);
    const receipt = logged || {
      status: held.status || 'unknown',
      event_id: held.event_id || notice.delivery && notice.delivery.event_id || null,
      code: held.code || null,
      stop_run: held.stop_run
    };
    const done = await settle(data, notice, receipt, inspect, commit);
    done.report.halted = true;
    persist.push(done.item);
    return { stopped: true, halted: true, sent, persist, report: done.report, write: done.write };
  }
  const pending = data.notices.filter(notice => notice.status === 'pending_delivery');
  let report = null;
  for (const notice of pending) {
    const logged = receiptForNotice(receiptLog, notice);
    let receipt = logged;
    let fresh = false;
    if (!logged) {
      try {
        receipt = await router.call('router.publish', {
          request_id: notice.publish_request_id,
          message: wireFor(data, notice)
        });
        sent.push({ notice_id: notice.notice_id, receipt });
        fresh = isFresh(receipt, notice, binding);
      } catch {
        receipt = receiptForNotice(receiptLog, notice);
        fresh = false;
        if (receipt) sent.push({ notice_id: notice.notice_id, receipt, recovered: true });
      }
    } else {
      sent.push({ notice_id: notice.notice_id, receipt: logged, recovered: true });
      fresh = false;
    }
    if (!fresh) {
      rememberHalt(data, file, notice, receipt);
      const done = await settle(data, notice, receipt, inspect, commit);
      done.report.halted = true;
      persist.push(done.item);
      return { stopped: true, halted: true, sent, persist, report: done.report, write: done.write };
    }
    const done = await settle(data, notice, receipt, inspect, commit);
    done.report.halted = false;
    persist.push(done.item);
    report = done.report;
    if (commit && !done.report.persisted) {
      return { stopped: true, halted: false, sent, persist, report: done.report, write: done.write };
    }
  }
  return { stopped: false, halted: false, sent, persist, report };
}

module.exports = { classifyDelivery, publishPending, receiptForNotice, evidenceEventId, isFresh, wireFor };
