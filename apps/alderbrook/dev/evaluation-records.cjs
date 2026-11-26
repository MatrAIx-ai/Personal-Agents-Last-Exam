'use strict';
// The dated claim lifecycle steps of a seed, with one authoritative date field for each kind of step.
// The coverage report reads them from the delivered seed files, and tests/evaluation.integration.cjs reads them from `claims.get` results. Both give the same rows.
const time = require('../src/time.cjs');

const ZONE = 'America/New_York', WINDOW = {start: '2025-01-01', end: '2026-12-31'};
// kind, the list that holds the record, its date field, and how to find the records of one claim.
const KINDS = [
  ['claim_filed', 'claims[]', 'filed_at', claim => [[claim.id, claim.filed_at]]],
  ['evidence_added', 'claims[].evidence[]', 'added_at', claim => claim.evidence.map(e => [e.id, e.added_at])],
  ['request_issued', 'claims[].requests[]', 'issued_at', claim => claim.requests.map(q => [q.id, q.issued_at])],
  ['request_answered', 'claims[].requests[].asks[].answer', 'answered_at', claim => claim.requests.flatMap(q => q.asks.filter(a => a.answer).map(a => [q.id + '#' + a.key, a.answer.answered_at]))],
  ['estimate_submitted', 'claims[].estimates[]', 'submitted_at', claim => claim.estimates.map(e => [e.id, e.submitted_at])],
  ['determination_issued', 'claims[].determinations[]', 'issued_at', claim => claim.determinations.map(d => [d.id, d.issued_at])],
  ['dispute_opened', 'claims[].disputes[]', 'opened_at', claim => claim.disputes.map(d => [d.id, d.opened_at])],
  ['dispute_decided', 'claims[].disputes[]', 'decided_at', claim => claim.disputes.filter(d => d.decided_at).map(d => [d.id, d.decided_at])],
  ['offer_issued', 'claims[].offers[]', 'issued_at', claim => claim.offers.map(o => [o.id, o.issued_at])],
  ['offer_answered', 'claims[].offers[]', 'answered_at', claim => claim.offers.filter(o => o.answered_at).map(o => [o.id, o.answered_at])],
  ['rental_started', 'claims[].rentals[]', 'start_at', claim => claim.rentals.map(r => [r.id, r.start_at])],
  ['rental_ended', 'claims[].rentals[]', 'end_at', claim => claim.rentals.filter(r => r.end_at).map(r => [r.id, r.end_at])],
  ['payment_issued', 'claims[].payments[]', 'issued_at', claim => claim.payments.map(p => [p.id, p.issued_at])],
  ['repair_completed', 'claims[]', 'repair_completed_at', claim => claim.repair_completed_at ? [[claim.id, claim.repair_completed_at]] : []],
  ['claim_closed', 'claims[]', 'closed_at', claim => claim.closed_at ? [[claim.id, claim.closed_at]] : []],
  ['claim_withdrawn', 'claims[]', 'withdrawn_at', claim => claim.withdrawn_at ? [[claim.id, claim.withdrawn_at]] : []]
].map(([kind, list, field, find]) => ({kind, list, field, find}));

// The calendar day of a stored time in the counting zone, or null when it is not a valid time with a UTC offset.
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) return null;
  return time.localDay(Date.parse(value), ZONE);
}
// One row per dated lifecycle step: {account_id, claim_id, kind, record_id, at, day}.
function lifecycle(accountId, claims) {
  const rows = [];
  for (const claim of claims) {
    for (const {kind, find} of KINDS) for (const [id, at] of find(claim)) rows.push({account_id: accountId, claim_id: claim.id, kind, record_id: id, at, day: day(at)});
  }
  return rows;
}
// Times that are due after the clock: the due time of an open request and the answer time of an open offer. They are scheduled, not past activity.
function scheduled(accountId, claims, clock) {
  const rows = [], now = Date.parse(clock);
  for (const claim of claims.filter(c => c.state === 'open')) {
    for (const q of claim.requests) if (q.state === 'open' && Date.parse(q.due_at) > now) rows.push({account_id: accountId, claim_id: claim.id, kind: 'request_due', record_id: q.id, at: q.due_at, day: day(q.due_at)});
    const last = claim.offers[claim.offers.length - 1];
    if (last && last.state === 'open' && Date.parse(last.respond_by) > now) rows.push({account_id: accountId, claim_id: claim.id, kind: 'offer_respond_by', record_id: last.id, at: last.respond_by, day: day(last.respond_by)});
  }
  return rows;
}
// Every timestamp in a seed, with its path. Deadlines (`due_at`, `respond_by`) and policy term ends may lie after the clock; a policy term start may equal it.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function stamps(value, at = '') {
  if (typeof value === 'string') return STAMP.test(value) ? [{path: at, value}] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => stamps(item, at + (Array.isArray(value) ? '[' + key + ']' : '.' + key)));
}
const DEADLINE = /\.(due_at|respond_by)$|^\.policies\[\d+\]\.term\.end$/;
// The timestamps of a seed that are not before `clock`: records that a seed cut at that time must not hold.
function after(seed, clock) {
  const limit = Date.parse(clock);
  return stamps(seed).filter(s => !DEADLINE.test(s.path) && (/^\.policies\[\d+\]\.term\.start$/.test(s.path) ? Date.parse(s.value) > limit : Date.parse(s.value) >= limit));
}
module.exports = {ZONE, WINDOW, KINDS, day, lifecycle, scheduled, stamps, after};
