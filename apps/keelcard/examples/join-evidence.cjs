'use strict';
// Read-only join of a Keelcard snapshot, Core audit and supplied execution records.
function stateOf(snapshot) {
  if (snapshot && snapshot.snapshot && snapshot.snapshot.data) return snapshot.snapshot;
  return snapshot;
}

function requestIdOf(row) {
  return row && row.input && row.input.request_id || null;
}

function wanted(record) {
  if (record.result && record.result.duplicate === true) return 'allow';
  if (!record.result) return 'deny';
  if (record.result.status && !['committed', 'ok', 'ready'].includes(record.result.status)) return 'deny';
  return 'allow';
}

function resultReason(record) {
  if (!record.result) return null;
  if (record.result.reason) return record.result.reason;
  if (record.result.status && !['committed', 'ok', 'ready'].includes(record.result.status)) return record.result.status;
  return null;
}

function versionOf(record) {
  if (record.expected_version) return record.expected_version;
  if (record.arguments && record.arguments.expected_version) return record.arguments.expected_version;
  return null;
}

function sameVersion(expected, before) {
  if (!expected || !before) return false;
  return expected.epoch === before.epoch && expected.revision === before.revision;
}

function blank(record, extra) {
  return {
    request_id: record.request_id || null,
    tool: record.tool || null,
    run_id: record.run_id || null,
    epoch: record.epoch !== undefined ? record.epoch : null,
    arguments: record.arguments || null,
    result: record.result || null,
    audit: null,
    audit_rows: [],
    ...extra
  };
}

function pairRecord(record, audit, used) {
  const want = wanted(record);
  const matches = [];
  audit.forEach((row, index) => {
    if (used.has(index) || row.tool !== record.tool || row.decision !== want) return;
    const auditRequest = requestIdOf(row);
    if (!record.request_id || auditRequest !== record.request_id) return;
    if (record.run_id && row.run_id && row.run_id !== record.run_id) return;
    if (record.epoch !== undefined && row.before && row.before.epoch !== record.epoch) return;
    matches.push({ index, row });
  });
  if (record.result && record.result.duplicate === true) {
    return blank(record, { result: record.result, audit: null, audit_rows: [], match: 'duplicate', ambiguous: false });
  }
  if (!record.request_id) return blank(record, { match: 'ambiguous', ambiguous: true });
  let pool = matches;
  const reason = resultReason(record);
  if (reason) {
    const narrowed = pool.filter(item => item.row.reason === reason);
    if (narrowed.length) pool = narrowed;
  }
  const expected = versionOf(record);
  if (expected) {
    const narrowed = pool.filter(item => sameVersion(expected, item.row.before));
    if (narrowed.length) pool = narrowed;
  }
  if (pool.length === 0) return blank(record, { match: 'unmatched', ambiguous: false });
  if (pool.length > 1) {
    const ordered = pool.every(item => Number.isInteger(item.row.seq));
    if (!ordered) return blank(record, { match: 'ambiguous', ambiguous: true });
    pool = pool.slice().sort((a, b) => a.row.seq - b.row.seq);
  }
  const chosen = pool[0];
  used.add(chosen.index);
  return blank(record, {
    audit: chosen.row,
    audit_rows: [chosen.row],
    match: pool.length > 1 ? 'call_order' : 'call',
    ambiguous: false
  });
}

function joinEvidence(snapshot, execution) {
  const state = stateOf(snapshot || {});
  const data = state.data || {};
  const audit = Array.isArray(state.audit) ? state.audit : [];
  const records = Array.isArray(execution) ? execution : [];
  const used = new Set();
  const paired = records.map(record => pairRecord(record, audit, used));
  const denied = {};
  for (const item of paired) {
    const row = item.audit && item.audit.decision === 'deny' ? item.audit : null;
    if (!row || item.match === 'duplicate' || item.match === 'ambiguous') continue;
    const key = item.request_id || 'missing-request';
    if (!denied[key]) denied[key] = [];
    const target = item.arguments && (item.arguments.card_id || item.arguments.authorization_key || item.arguments.id) || null;
    denied[key].push({
      tool: item.tool,
      reason: row.reason,
      virtual_time: row.virtual_time,
      arguments: item.arguments,
      target,
      expected_version: versionOf(item) || (row.before ? { epoch: row.before.epoch, revision: row.before.revision } : null)
    });
  }
  const attempts = (data.change_requests || []).flatMap(request => (request.attempts || []).map(attempt => ({
    change_request_id: request.change_request_id,
    request_id: attempt.request_id,
    outcome: attempt.outcome,
    code_matched: attempt.code_matched,
    at: attempt.at
  })));
  const requests = (data.change_requests || []).map(request => ({
    change_request_id: request.change_request_id,
    request_id: request.request_id || null,
    status: request.status,
    field: request.field,
    attempts: request.attempts || []
  }));
  return {
    run_id: state.run_id || null,
    app_id: state.app_id || 'keelcard',
    account_id: data.account_id || null,
    authorizations: [...(data.authorizations || []), ...(data.declines || [])].map(row => ({
      authorization_id: row.authorization_id,
      authorization_key: row.authorization_key,
      decision: row.decision,
      decline_code: row.decline_code || null,
      amount_cents: row.amount_cents,
      card_id: row.card_id || null,
      merchant_id: row.merchant_id || null,
      category: row.category || null,
      limits_in_force: row.limits_in_force || null,
      source_event_id: row.source_event_id || null,
      merchant_ref: row.merchant_ref || null
    })),
    requests,
    attempts,
    control_changes: (data.control_changes || []).map(row => ({
      control_change_id: row.control_change_id,
      request_id: row.request_id || null,
      applied_request_id: row.applied_request_id || null,
      field: row.field,
      changed_by: row.changed_by,
      verification: row.verification || null,
      change_request_id: row.change_request_id || null
    })),
    reveals: (data.reveals || []).map(row => ({ reveal_id: row.reveal_id, card_id: row.card_id, request_id: row.request_id || null, at: row.at })),
    notices: (data.notices || []).map(row => ({
      notice_id: row.notice_id,
      kind: row.kind,
      cloud_event_id: row.cloud_event_id,
      publish_request_id: row.publish_request_id,
      status: row.status,
      event_id: row.delivery && row.delivery.event_id || null
    })),
    fingerprints: data.fingerprints || [],
    rejected: denied,
    ambiguous: paired.filter(item => item.ambiguous).map(item => item.request_id),
    paired,
    counts: {
      authorizations: (data.authorizations || []).length + (data.declines || []).length,
      attempts: attempts.length,
      requests: requests.length,
      control_changes: (data.control_changes || []).length,
      reveals: (data.reveals || []).length,
      notices: (data.notices || []).length,
      rejected_requests: Object.keys(denied).length
    }
  };
}

module.exports = { joinEvidence };
if (require.main === module) {
  const fs = require('node:fs');
  const snapshot = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const execution = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [];
  process.stdout.write(JSON.stringify(joinEvidence(snapshot, execution), null, 2) + '\n');
}
