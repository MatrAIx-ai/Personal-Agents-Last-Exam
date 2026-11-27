'use strict';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const TERMINAL_CLAIM_STATUSES = new Set([
  'approved_refund',
  'approved_replacement',
  'approved_repair_kit',
  'rejected',
  'withdrawn',
]);
const ACTIVE_CLAIM_STATUSES = new Set(['draft', 'submitted', 'under_review']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function copy(value) {
  return structuredClone(value);
}

function nowOf(ctx) {
  return (ctx && ctx.virtual_now) || '2026-11-18T12:00:00+00:00';
}

function parseMs(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) fail('invalid_timestamp', 'Timestamp must be valid ISO-8601 date-time.');
  return ms;
}

function isLotAffected(recall, lotCode) {
  if (!recall || !lotCode) return false;
  if (Array.isArray(recall.excluded_lots) && recall.excluded_lots.includes(lotCode)) return false;
  return Array.isArray(recall.affected_lots) && recall.affected_lots.includes(lotCode);
}

// Deadline comparison is inclusive: now <= remedy_deadline_at is eligible; strictly > is expired.
function isDeadlineExpired(recall, virtualNow) {
  return parseMs(virtualNow) > parseMs(recall.remedy_deadline_at);
}

function evaluateRecallForLot(recall, lotCode, virtualNow) {
  if (!isLotAffected(recall, lotCode)) return 'unaffected';
  if (recall.status === 'closed' || isDeadlineExpired(recall, virtualNow)) {
    return 'matched_remedy_expired';
  }
  return 'matched_active';
}

function evaluateItemExposure(data, item, virtualNow) {
  if (item.status === 'archived') {
    return {
      item_id: item.id,
      lot_code: item.lot_code,
      item_status: item.status,
      exposure_status: 'archived',
      matched_recall_ids: [],
      remedy_deadlines: [],
    };
  }
  const matched = [];
  const deadlines = [];
  let hasActive = false;
  let hasExpired = false;
  for (const r of data.recalls) {
    if (r.upc !== item.upc) continue;
    if (!isLotAffected(r, item.lot_code)) continue;
    matched.push(r.id);
    const expired = r.status === 'closed' || isDeadlineExpired(r, virtualNow);
    deadlines.push({
      recall_id: r.id,
      remedy_deadline_at: r.remedy_deadline_at,
      expired,
    });
    if (expired) hasExpired = true;
    else hasActive = true;
  }
  let exposure_status = 'unaffected';
  if (hasActive) exposure_status = 'matched_active';
  else if (hasExpired) exposure_status = 'matched_remedy_expired';
  return {
    item_id: item.id,
    lot_code: item.lot_code,
    item_status: item.status,
    exposure_status,
    matched_recall_ids: matched,
    remedy_deadlines: deadlines,
  };
}

// Paused rules automatically resume at read time once virtualNow >= pause_until (no background scheduler required).
function effectiveWatchlistStatus(rule, virtualNow) {
  if (rule.status === 'paused' && rule.pause_until && parseMs(virtualNow) >= parseMs(rule.pause_until)) {
    return 'active';
  }
  return rule.status;
}

function validateProofRef(proofRef) {
  if (proofRef === null || proofRef === undefined) return { valid: true, present: false };
  if (typeof proofRef !== 'object' || Array.isArray(proofRef)) {
    return { valid: false, present: true, reason: 'PROOF_REFERENCE_INVALID' };
  }
  if (!['file_ref', 'asset_ref', 'receipt_ref'].includes(proofRef.kind)) {
    return { valid: false, present: true, reason: 'PROOF_REFERENCE_INVALID' };
  }
  if (typeof proofRef.id !== 'string' || !ID_RE.test(proofRef.id)) {
    return { valid: false, present: true, reason: 'PROOF_REFERENCE_INVALID' };
  }
  if (proofRef.version !== undefined && proofRef.version !== null) {
    if (!Number.isInteger(proofRef.version) || proofRef.version < 1) {
      return { valid: false, present: true, reason: 'PROOF_REFERENCE_INVALID' };
    }
  }
  return { valid: true, present: true };
}

function findActiveClaim(data, recallId, itemId, excludeClaimId = null) {
  return data.claims.find(
    (c) =>
      c.id !== excludeClaimId &&
      c.recall_id === recallId &&
      c.item_id === itemId &&
      ACTIVE_CLAIM_STATUSES.has(c.status)
  ) || null;
}

function evaluateClaimEligibility(data, { recall, item, remedy_type, proof_ref, virtualNow, excludeClaimId = null }) {
  const reasons = [];
  if (item.status === 'archived') reasons.push('ITEM_ARCHIVED');
  if (recall.upc !== item.upc || !isLotAffected(recall, item.lot_code)) {
    reasons.push('LOT_NOT_AFFECTED');
  }
  if (recall.status === 'closed' || isDeadlineExpired(recall, virtualNow)) {
    reasons.push('REMEDY_WINDOW_EXPIRED');
  }
  if (!recall.remedy_types.includes(remedy_type)) {
    reasons.push('REMEDY_TYPE_UNSUPPORTED');
  }
  const proofCheck = validateProofRef(proof_ref);
  if (!proofCheck.valid) {
    reasons.push('PROOF_REFERENCE_INVALID');
  } else if (recall.proof_required && !proofCheck.present) {
    reasons.push('PROOF_REQUIRED');
  }
  const existing = findActiveClaim(data, recall.id, item.id, excludeClaimId);
  if (existing) {
    reasons.push('DUPLICATE_ACTIVE_CLAIM');
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    lot_code: item.lot_code,
    remedy_deadline_at: recall.remedy_deadline_at,
    evaluated_at: virtualNow,
    existing_claim_id: existing ? existing.id : null,
  };
}

function stamp(record, at, action, note) {
  record.updated_at = at;
  const entry = note ? { at, action, note } : { at, action };
  record.history.push(entry);
}

function nextId(prefix, existingList, requestedId) {
  if (requestedId) {
    if (existingList.some((r) => r.id === requestedId)) {
      fail('duplicate_id', `Record ID already exists: ${requestedId}`);
    }
    return requestedId;
  }
  let n = existingList.length + 1;
  while (existingList.some((r) => r.id === `${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function assertAccountBinding(ctx, data) {
  const binding = ctx && ctx.binding;
  if (!binding) return;
  const accounts = Array.isArray(binding.accounts) ? binding.accounts : [];
  const people = Array.isArray(binding.people) ? binding.people : [];
  const accountMatch = accounts.find(
    (a) => a.app_id === 'recallwatch' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id
  );
  if (!accountMatch) {
    fail('invalid_seed', 'Account or owner_person_id is not bound in fixtures/binding.json.');
  }
  const personIds = new Set(people.map((p) => p.person_id));
  if (!personIds.has(data.owner_person_id)) {
    fail('invalid_seed', `Unknown owner_person_id: ${data.owner_person_id}`);
  }
  for (const item of data.inventory) {
    if (!personIds.has(item.holder_person_ref)) {
      fail('invalid_seed', `Unknown holder_person_ref: ${item.holder_person_ref}`);
    }
  }
}

module.exports = {
  ID_RE,
  TERMINAL_CLAIM_STATUSES,
  ACTIVE_CLAIM_STATUSES,
  fail,
  copy,
  nowOf,
  parseMs,
  isLotAffected,
  isDeadlineExpired,
  evaluateRecallForLot,
  evaluateItemExposure,
  effectiveWatchlistStatus,
  validateProofRef,
  findActiveClaim,
  evaluateClaimEligibility,
  stamp,
  nextId,
  assertAccountBinding,
};
