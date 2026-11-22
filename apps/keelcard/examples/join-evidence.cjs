'use strict';
// Read-only join of a Keelcard snapshot, Core audit and supplied execution records.
function stateOf(snapshot) {
  if (snapshot && snapshot.snapshot && snapshot.snapshot.data) return snapshot.snapshot;
  return snapshot;
}

function joinEvidence(snapshot, execution) {
  const state = stateOf(snapshot || {});
  const data = state.data || {};
  const audit = Array.isArray(state.audit) ? state.audit : [];
  const records = Array.isArray(execution) ? execution : [];
  const used = new Set();
  const paired = records.map(record => {
    const index = audit.findIndex((row, i) => !used.has(i) && row.tool === record.tool);
    const row = index >= 0 ? audit[index] : null;
    if (index >= 0) used.add(index);
    return { request_id: record.request_id || null, tool: record.tool || null, arguments: record.arguments || null, result: record.result || null, audit: row };
  });
  const denied = {};
  for (const item of paired) {
    if (!item.audit || item.audit.decision !== 'deny') continue;
    const key = item.request_id || 'missing-request';
    if (!denied[key]) denied[key] = [];
    denied[key].push({ tool: item.tool, reason: item.audit.reason, virtual_time: item.audit.virtual_time, arguments: item.arguments });
  }
  const attempts = (data.change_requests || []).flatMap(request => (request.attempts || []).map(attempt => ({
    change_request_id: request.change_request_id,
    request_id: attempt.request_id,
    outcome: attempt.outcome,
    code_matched: attempt.code_matched,
    at: attempt.at
  })));
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
      source_event_id: row.source_event_id || null,
      merchant_ref: row.merchant_ref || null
    })),
    attempts,
    control_changes: (data.control_changes || []).map(row => ({
      control_change_id: row.control_change_id, request_id: row.request_id || null, field: row.field, changed_by: row.changed_by, change_request_id: row.change_request_id || null
    })),
    reveals: (data.reveals || []).map(row => ({ reveal_id: row.reveal_id, card_id: row.card_id, request_id: row.request_id || null, at: row.at })),
    notices: (data.notices || []).map(row => ({
      notice_id: row.notice_id, kind: row.kind, cloud_event_id: row.cloud_event_id, publish_request_id: row.publish_request_id, status: row.status
    })),
    fingerprints: data.fingerprints || [],
    rejected: denied,
    counts: {
      authorizations: (data.authorizations || []).length + (data.declines || []).length,
      attempts: attempts.length,
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
