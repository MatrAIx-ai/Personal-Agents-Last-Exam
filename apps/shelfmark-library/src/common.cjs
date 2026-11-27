'use strict';

function fail(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function parseIso(value, label = 'timestamp') {
  if (typeof value !== 'string' || !value.trim()) {
    throw fail('validation_error', `${label} must be an ISO-8601 timestamp string.`, { field: label });
  }
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!hasOffset) {
    throw fail('validation_error', `${label} must include a timezone offset.`, { field: label, value });
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw fail('validation_error', `${label} is not a valid ISO-8601 timestamp.`, { field: label, value });
  }
  return ms;
}

function addHours(iso, hours) {
  const ms = parseIso(iso, 'timestamp');
  return new Date(ms + hours * 3600 * 1000).toISOString().replace('Z', '+00:00');
}

function addDays(iso, days) {
  return addHours(iso, days * 24);
}

function nowOf(ctx, fallback = '2026-11-18T09:00:00+00:00') {
  return (ctx && ctx.virtual_now) || fallback;
}

function nextId(list, prefix) {
  let max = 0;
  for (const item of list || []) {
    if (typeof item.id === 'string' && item.id.startsWith(`${prefix}-`)) {
      const n = Number.parseInt(item.id.slice(prefix.length + 1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}-${max + 1}`;
}

function effectiveHoldStatus(hold, virtualNow) {
  if (!hold) return null;
  const nowMs = Date.parse(virtualNow);
  if (hold.status === 'ready_for_pickup' && hold.pickup_expires_at && nowMs > Date.parse(hold.pickup_expires_at)) {
    return 'expired';
  }
  if (hold.status === 'suspended' && hold.resume_at && nowMs >= Date.parse(hold.resume_at)) {
    return 'queued';
  }
  return hold.status;
}

function effectiveLoanStatus(loan, virtualNow) {
  if (!loan) return null;
  const nowMs = Date.parse(virtualNow);
  if (loan.status === 'active' && loan.due_at && nowMs > Date.parse(loan.due_at)) {
    return 'overdue';
  }
  return loan.status;
}

function isBranchClosedAt(branch, virtualNow) {
  if (!branch || !branch.closed_until) return false;
  return Date.parse(virtualNow) < Date.parse(branch.closed_until);
}

function commitDueTransitions(data, virtualNow) {
  const nowMs = Date.parse(virtualNow);
  for (const hold of data.holds || []) {
    if (hold.status === 'ready_for_pickup' && hold.pickup_expires_at && nowMs > Date.parse(hold.pickup_expires_at)) {
      hold.status = 'expired';
      hold.history = hold.history || [];
      hold.history.push({ at: virtualNow, action: 'expired', reason: 'pickup_window_elapsed' });
    } else if (hold.status === 'suspended' && hold.resume_at && nowMs >= Date.parse(hold.resume_at)) {
      hold.status = 'queued';
      hold.resume_at = null;
      hold.history = hold.history || [];
      hold.history.push({ at: virtualNow, action: 'auto_resumed' });
    }
  }
  for (const loan of data.loans || []) {
    if (loan.status === 'active' && loan.due_at && nowMs > Date.parse(loan.due_at)) {
      loan.status = 'overdue';
      loan.history = loan.history || [];
      loan.history.push({ at: virtualNow, action: 'overdue' });
    }
  }
}

function cardUnpaidBalanceCents(data, cardId) {
  let openCents = 0;
  let disputedCents = 0;
  for (const fine of data.fines || []) {
    if (fine.card_id !== cardId) continue;
    if (fine.status === 'open') openCents += fine.amount_cents;
    else if (fine.status === 'disputed') disputedCents += fine.amount_cents;
  }
  return { open_cents: openCents, disputed_cents: disputedCents, unpaid_cents: openCents + disputedCents };
}

function recomputeCardStatus(data, cardId) {
  const card = (data.managed_cards || []).find((c) => c.id === cardId);
  if (!card) return null;
  const { unpaid_cents } = cardUnpaidBalanceCents(data, cardId);
  card.card_status = unpaid_cents >= card.block_threshold_cents ? 'blocked_fines' : 'active';
  return card.card_status;
}

function assetWarning(ctx, assetId) {
  if (!assetId || !ctx || !ctx.assets || typeof ctx.assets.read !== 'function') return null;
  try {
    ctx.assets.read(assetId);
    return null;
  } catch (err) {
    if (err && (err.code === 'unavailable' || err.code === 'not_available' || err.code === 'not_found')) {
      return {
        code: 'ASSET_MISSING',
        asset_id: assetId,
        message: `Optional asset '${assetId}' is unavailable in this bundle.`,
      };
    }
    throw err;
  }
}

module.exports = {
  fail,
  parseIso,
  addHours,
  addDays,
  nowOf,
  nextId,
  effectiveHoldStatus,
  effectiveLoanStatus,
  isBranchClosedAt,
  commitDueTransitions,
  cardUnpaidBalanceCents,
  recomputeCardStatus,
  assetWarning,
};
