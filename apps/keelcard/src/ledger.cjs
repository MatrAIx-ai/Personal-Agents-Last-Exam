'use strict';
const { due, dayWindow, monthWindow, parts, zonedToIso, nextSerial } = require('./domain-utils.cjs');

function effectiveStatus(auth, now) {
  if (auth.status === 'pending' && due(now, auth.expires_at)) return 'expired';
  return auth.status;
}

function countsTowardSpend(auth, now) {
  const status = effectiveStatus(auth, now);
  return status === 'pending' || status === 'captured' || status === 'refunded' || status === 'partially_refunded';
}

function spendAmount(auth, now) {
  if (!countsTowardSpend(auth, now)) return 0;
  if (effectiveStatus(auth, now) === 'pending') return auth.hold_cents;
  return auth.captured_cents;
}

function openHolds(data, now) {
  return data.authorizations.reduce((sum, auth) => sum + (effectiveStatus(auth, now) === 'pending' ? auth.hold_cents : 0), 0);
}

function availableCents(data, now) {
  return data.funding.balance_cents - openHolds(data, now);
}

function spent(data, cardId, now, window) {
  let start = null;
  let end = null;
  if (window === 'per_day') { const span = dayWindow(now, data.time_zone); start = Date.parse(span.start); end = Date.parse(span.end); }
  if (window === 'per_month') { const span = monthWindow(now, data.time_zone); start = Date.parse(span.start); end = Date.parse(span.end); }
  let total = 0;
  for (const auth of data.authorizations) {
    if (auth.card_id !== cardId) continue;
    const at = Date.parse(auth.decided_at);
    if (start !== null && (at < start || at >= end)) continue;
    total += spendAmount(auth, now);
  }
  return total;
}

function postLedger(data, entry) {
  const amount = entry.direction === 'debit' ? -entry.amount_cents : entry.amount_cents;
  data.funding.balance_cents += amount;
  const row = {
    entry_id: nextSerial(data.ledger, 'entry_id', 'led-'),
    at: entry.at,
    kind: entry.kind,
    direction: entry.direction,
    amount_cents: entry.amount_cents,
    balance_after_cents: data.funding.balance_cents,
    authorization_id: entry.authorization_id || null,
    card_id: entry.card_id || null,
    statement_id: null
  };
  data.ledger.push(row);
  return row;
}

function settleAuthorization(data, auth, now, effectiveAt) {
  if (auth.status !== 'pending') return false;
  if (!due(now, auth.expires_at)) return false;
  auth.status = 'expired';
  auth.expired_at = effectiveAt || auth.expires_at;
  auth.settled_at = now;
  auth.hold_cents = 0;
  return true;
}

function settleRequest(data, request, now) {
  if (request.status !== 'pending_verification' && request.status !== 'pending_owner') return false;
  if (!due(now, request.expires_at)) return false;
  request.status = 'expired';
  request.resolved_at = request.expires_at;
  request.settled_at = now;
  return true;
}

function completedMonths(data, now) {
  const cursor = parts(now, data.time_zone);
  const months = [];
  const seen = new Set(data.statements.map(item => item.statement_id));
  const first = data.ledger.length ? parts(data.ledger[0].at, data.time_zone) : cursor;
  let year = first.year;
  let month = first.month;
  while (year < cursor.year || (year === cursor.year && month < cursor.month)) {
    const id = 'stmt-' + year + '-' + String(month).padStart(2, '0');
    if (!seen.has(id)) months.push({ year, month, id });
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return months;
}

function issueStatement(data, spec, settledAt) {
  const start = zonedToIso(spec.year, spec.month, 1, 0, 0, 0, data.time_zone);
  const nextMonth = spec.month === 12 ? 1 : spec.month + 1;
  const nextYear = spec.month === 12 ? spec.year + 1 : spec.year;
  const end = zonedToIso(nextYear, nextMonth, 1, 0, 0, 0, data.time_zone);
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  let debits = 0;
  let credits = 0;
  const entryIds = [];
  for (const entry of data.ledger) {
    const at = Date.parse(entry.at);
    if (at < startMs || at >= endMs) continue;
    entryIds.push(entry.entry_id);
    if (entry.direction === 'debit') debits += entry.amount_cents;
    else credits += entry.amount_cents;
    entry.statement_id = spec.id;
  }
  const prior = data.statements.filter(item => Date.parse(item.period_end) <= startMs).sort((a, b) => Date.parse(a.period_end) - Date.parse(b.period_end));
  const opening = prior.length ? prior[prior.length - 1].closing_balance_cents : data.funding.opening_balance_cents;
  data.statements.push({
    statement_id: spec.id,
    period_start: start,
    period_end: end,
    issued_at: settledAt,
    effective_at: end,
    opening_balance_cents: opening,
    debits_cents: debits,
    credits_cents: credits,
    closing_balance_cents: opening + credits - debits,
    entry_ids: entryIds
  });
}

function settleDue(data, now) {
  const transitions = [];
  const queue = [];
  for (const auth of data.authorizations) {
    if (auth.status === 'pending' && due(now, auth.expires_at)) queue.push({ at: auth.expires_at, id: auth.authorization_id, kind: 'authorization' });
  }
  for (const request of data.change_requests) {
    if ((request.status === 'pending_verification' || request.status === 'pending_owner') && due(now, request.expires_at)) {
      queue.push({ at: request.expires_at, id: request.change_request_id, kind: 'change_request' });
    }
  }
  for (const spec of completedMonths(data, now)) {
    const end = zonedToIso(spec.month === 12 ? spec.year + 1 : spec.year, spec.month === 12 ? 1 : spec.month + 1, 1, 0, 0, 0, data.time_zone);
    queue.push({ at: end, id: spec.id, kind: 'statement', spec });
  }
  queue.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  for (const item of queue) {
    if (item.kind === 'authorization') {
      const auth = data.authorizations.find(row => row.authorization_id === item.id);
      settleAuthorization(data, auth, now, auth.expires_at);
      transitions.push({ kind: 'authorization_expired', id: auth.authorization_id, effective_at: auth.expires_at, settled_at: now });
    } else if (item.kind === 'change_request') {
      const request = data.change_requests.find(row => row.change_request_id === item.id);
      settleRequest(data, request, now);
      transitions.push({ kind: 'change_request_expired', id: request.change_request_id, effective_at: request.expires_at, settled_at: now });
    } else {
      issueStatement(data, item.spec, now);
      transitions.push({ kind: 'statement_issued', id: item.id, effective_at: data.statements.at(-1).effective_at, settled_at: now });
    }
  }
  return transitions;
}

function settleTouched(data, now, { cardId, requestId, authorizationId } = {}) {
  if (authorizationId) {
    const auth = data.authorizations.find(item => item.authorization_id === authorizationId);
    if (auth) settleAuthorization(data, auth, now, auth.expires_at);
  }
  if (cardId) {
    for (const auth of data.authorizations.filter(item => item.card_id === cardId)) settleAuthorization(data, auth, now, auth.expires_at);
  }
  if (requestId) {
    const request = data.change_requests.find(item => item.change_request_id === requestId);
    if (request) settleRequest(data, request, now);
  }
}

module.exports = {
  effectiveStatus, spendAmount, openHolds, availableCents, spent, postLedger,
  settleAuthorization, settleRequest, settleDue, settleTouched, completedMonths
};
