'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { wireFor } = require('./notices.cjs');

// Halt and confirmation are separate.
// A router result halts the run unless it is a fresh committed receipt for this binding.
// The halt is written to the publication file first, then to Core.
// A stale Core write is repeated until a following read shows the halt.
// When that write cannot be stored, the call stops with no further router call.
// Mail confirmation only changes delivery evidence.

function evidenceEventId(noticeId, status, receiptEventId, code) {
  const raw = JSON.stringify([noticeId, status, receiptEventId || null, code || null]);
  return 'delivery-' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

function publicationPath(runDir, receiptLog) {
  const path = require('node:path');
  const dir = runDir || (receiptLog ? path.dirname(receiptLog) : null);
  if (!dir) return null;
  return path.join(dir, 'keelcard-publication.json');
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

function deliveryMatches(notice, report) {
  if (!notice || !notice.delivery || !notice.delivery.recorded_at) return false;
  const status = deliveryStatus(report);
  if (notice.status !== status) return false;
  if ((notice.delivery.event_id || null) !== (report.event_id || null)) return false;
  return (notice.delivery.code || null) === (report.code || null);
}

async function savedInCore(read, report) {
  if (!read) return false;
  try {
    const fresh = await read();
    if (!fresh || !Array.isArray(fresh.notices)) return false;
    const notice = fresh.notices.find(item => item.notice_id === report.notice_id);
    return deliveryMatches(notice, report);
  } catch {
    return false;
  }
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

async function settle(data, notice, receipt, inspect, commit, read) {
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
  if (deliveryMatches(notice, report)) item.recorded_at = notice.delivery.recorded_at;
  const seen = await savedInCore(read, report);
  if (seen || (!read && deliveryMatches(notice, report))) {
    report.persisted = true;
    report.mail_confirmed = Boolean(report.mail_confirmed);
    return { report, item, write: { status: 'committed', duplicate: true } };
  }
  recordEvidence(data, report);
  let write = null;
  if (commit) {
    try { write = await commit(item); }
    catch (error) { write = { status: error && error.code || 'stale_version', message: error && error.message }; }
    report.persisted = writeOk(write);
  } else {
    report.persisted = false;
  }
  report.mail_confirmed = Boolean(report.mail_confirmed);
  return { report, item, write };
}

function haltRecord(notice, receipt) {
  return {
    halted: true,
    notice_id: notice.notice_id,
    publish_request_id: notice.publish_request_id,
    cloud_event_id: notice.cloud_event_id,
    event_id: receipt && receipt.event_id || null,
    status: receipt && receipt.status || 'unknown',
    stop_run: Boolean(receipt && receipt.stop_run),
    code: receipt && receipt.code || (receipt ? 'unconfirmed' : 'response_lost')
  };
}

function haltItem(record) {
  return {
    kind: 'halt',
    event_id: 'halt-' + record.notice_id,
    notice_id: record.notice_id,
    publish_request_id: record.publish_request_id,
    cloud_event_id: record.cloud_event_id || null,
    status: record.status,
    code: record.code,
    stop_run: Boolean(record.stop_run),
    receipt_event_id: record.event_id
  };
}

const haltAttempts = 8;

async function readPublication(read) {
  if (!read) return null;
  try {
    const fresh = await read();
    if (fresh && fresh.publication && fresh.publication.halted) return fresh.publication;
  } catch {
    return null;
  }
  return null;
}

async function persistHalt(data, file, record, commit, read) {
  writeHalt(file, record);
  let write = null;
  if (!commit) {
    const seen = await readPublication(read);
    data.publication = seen || record;
    if (seen) writeHalt(file, seen);
    return { ok: Boolean(seen), record: data.publication, write };
  }
  for (let attempt = 0; attempt < haltAttempts; attempt += 1) {
    const seen = await readPublication(read);
    if (seen) {
      data.publication = seen;
      writeHalt(file, seen);
      return { ok: true, record: seen, write };
    }
    try { write = await commit(haltItem(record)); }
    catch (error) { write = { status: error && error.code || 'stale_version', message: error && error.message }; }
    if (writeOk(write)) {
      const confirmed = await readPublication(read);
      if (confirmed) {
        data.publication = confirmed;
        writeHalt(file, confirmed);
        return { ok: true, record: confirmed, write };
      }
      if (!read) {
        data.publication = record;
        return { ok: true, record, write };
      }
    } else if (!write || write.status !== 'stale_version') {
      break;
    }
  }
  const last = await readPublication(read);
  if (last) {
    data.publication = last;
    writeHalt(file, last);
    return { ok: true, record: last, write };
  }
  data.publication = record;
  return { ok: false, record, write };
}

function blocked(record, write) {
  const report = stamp(record, {
    outcome: 'unresolved',
    halted: true,
    event_id: record.event_id || null,
    code: record.code || 'run_halted',
    mail_confirmed: false,
    persisted: false
  });
  return { stopped: true, halted: true, sent: [], persist: [], report, reports: [report], write };
}

async function finishHeld(data, held, receiptLog, inspect, commit, read) {
  data.publication = held;
  const notice = data.notices.find(item => item.notice_id === held.notice_id);
  if (!notice) {
    const report = stamp(held, { outcome: 'unresolved', halted: true, event_id: held.event_id || null, code: held.code || 'run_halted', mail_confirmed: false, persisted: false });
    return { stopped: true, halted: true, sent: [], persist: [], report, reports: [report] };
  }
  const logged = receiptForNotice(receiptLog, notice);
  const receipt = logged || {
    status: held.status || 'unknown',
    event_id: held.event_id || (notice.delivery && notice.delivery.event_id) || null,
    code: held.code || null,
    stop_run: held.stop_run
  };
  const done = await settle(data, notice, receipt, inspect, commit, read);
  done.report.halted = true;
  return { stopped: true, halted: true, sent: [], persist: [done.item], report: done.report, reports: [done.report], write: done.write };
}

async function publishPending({ data, router, inspect, commit, read, receiptLog, runDir, binding }) {
  const file = publicationPath(runDir, receiptLog);
  const sent = [];
  const persist = [];
  const reports = [];
  const snapshotHalt = data.publication && data.publication.halted ? data.publication : null;
  const fileHalt = snapshotHalt ? null : readHalt(file);
  if (snapshotHalt) writeHalt(file, snapshotHalt);
  if (snapshotHalt || fileHalt) {
    let held = snapshotHalt;
    if (!held) {
      const saved = await persistHalt(data, file, fileHalt, commit, read);
      if (!saved.ok) return blocked(fileHalt, saved.write);
      held = saved.record;
    }
    return finishHeld(data, held, receiptLog, inspect, commit, read);
  }
  for (const notice of data.notices) {
    if (notice.status !== 'unknown') continue;
    const savedId = notice.delivery && notice.delivery.event_id;
    if (!savedId) continue;
    const logged = receiptForNotice(receiptLog, notice);
    const receipt = logged || { status: 'unknown', event_id: savedId, code: notice.delivery.code || null };
    const done = await settle(data, notice, receipt, inspect, commit, read);
    persist.push(done.item);
    reports.push(done.report);
  }
  const pending = data.notices.filter(notice => notice.status === 'pending_delivery');
  let report = reports.length ? reports[reports.length - 1] : null;
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
      const record = haltRecord(notice, receipt);
      await persistHalt(data, file, record, commit, read);
      const done = await settle(data, notice, receipt, inspect, commit, read);
      done.report.halted = true;
      persist.push(done.item);
      reports.push(done.report);
      return { stopped: true, halted: true, sent, persist, report: done.report, reports, write: done.write };
    }
    const done = await settle(data, notice, receipt, inspect, commit, read);
    done.report.halted = false;
    persist.push(done.item);
    reports.push(done.report);
    report = done.report;
    if (commit && !done.report.persisted) {
      return { stopped: true, halted: false, sent, persist, report: done.report, reports, write: done.write };
    }
  }
  return { stopped: false, halted: false, sent, persist, report, reports };
}

module.exports = { classifyDelivery, publishPending, receiptForNotice, evidenceEventId, isFresh, wireFor };
