'use strict';
const { fail, byId, nextSeq, nextPost, nextId, bump } = require('./util.cjs');
const { ms, toIso, localDate, planYear, validDate, dayDeadline } = require('./time.cjs');
const { adjudicate, lineOutcome, ordered } = require('./adjudication.cjs');
const { makeToken, businessArgs, requestSubject } = require('./tokens.cjs');
const { confirmFlow } = require('./confirm.cjs');
const N = require('./notices.cjs');

const invalid = message => fail('invalid_event', message);
const due = (at, n) => toIso(dayDeadline(at, n));

function claimReceived(data, payload, ctx) {
  const at = ctx.virtual_now;
  if (byId(data.claims, 'claim_id', payload.claim_id)) invalid('Claim ' + payload.claim_id + ' already exists.');
  const member = byId(data.members, 'member_id', payload.member_id);
  const seen = new Set();
  for (const l of payload.lines) {
    if (seen.has(l.line_id)) invalid('Claim ' + payload.claim_id + ' repeats line ' + l.line_id + '.');
    seen.add(l.line_id);
    if (!validDate(l.service_date)) invalid('Line ' + l.line_id + ' has an invalid service date ' + l.service_date + '.');
    if (l.service_date > localDate(ms(at))) invalid('Line ' + l.line_id + ' is dated after the claim was received.');
    const year = planYear(l.service_date);
    if (!data.plan.years[String(year)]) invalid('Line ' + l.line_id + ' falls in plan year ' + year + ', which the plan does not cover.');
    if (!member.enrolled_years.includes(year)) invalid('Member ' + member.member_id + ' is not enrolled in plan year ' + year + '.');
    const service = byId(data.services, 'service_id', l.service_id);
    if (service.category === 'pharmacy') invalid('Pharmacy claims belong to the pharmacy; line ' + l.line_id + ' names a pharmacy service.');
  }
  data.claims.push({ claim_id: payload.claim_id, claim_version: 0, member_id: payload.member_id, provider_id: payload.provider_id, received_at: at, received_seq: nextSeq(data),
    review_at: due(at, 3), status: 'received',
    lines: payload.lines.map((l, i) => ({ line_id: l.line_id, position: i + 1, service_id: l.service_id, service_date: l.service_date, units: l.units, billed_cents: l.billed_cents, emergency: l.emergency, possible_accident: l.possible_accident })),
    processed_at: null });
  return data;
}

const coverageOf = (data, memberId, year) => data.coverage.find(c => c.member_id === memberId && c.plan_year === year);

const standing = (data, claim, line) => coverageOf(data, claim.member_id, planYear(line.service_date)).status;

const accOf = (data, memberId, year) => data.accumulators.find(a => a.member_id === memberId && a.plan_year === year);

function ledgerFor(data, memberId, years) {
  const out = {};
  for (const y of years) {
    const family = { deductible_cents: 0, oop_cents: 0 };
    for (const m of data.members) if (m.enrolled_years.includes(Number(y))) { const a = accOf(data, m.member_id, Number(y)); family.deductible_cents += a.deductible_cents; family.oop_cents += a.oop_cents; }
    const own = accOf(data, memberId, Number(y));
    out[y] = { member: { deductible_cents: own.deductible_cents, oop_cents: own.oop_cents }, family };
  }
  return out;
}

const requestsOf = (data, claimId) => data.info_requests.filter(r => r.claim_id === claimId);

function issueV1(data, c, at) {
  const years = [...new Set(c.lines.map(l => l.service_date.slice(0, 4)))].sort();
  const ledger = ledgerFor(data, c.member_id, years), requests = requestsOf(data, c.claim_id);
  const outcomes = Object.fromEntries(c.lines.map(l => [l.line_id, lineOutcome(standing(data, c, l), requests.filter(r => r.line_id === l.line_id))]));
  const pas = data.pas.filter(p => p.member_id === c.member_id && p.approved !== null)
    .map(p => ({ pa_id: p.pa_id, service_id: p.service_id, valid_from: p.approved.valid_from, valid_until: p.approved.valid_until, remaining: p.approved.units - p.units_used }));
  const out = adjudicate({ plan: data.plan, services: new Map(data.services.map(s => [s.service_id, s])), provider: byId(data.providers, 'provider_id', c.provider_id), memberId: c.member_id, lines: c.lines, ledger, outcomes, pas });
  const eob = { eob_id: nextId(data, 'eob'), claim_id: c.claim_id, version: 1, issued_at: at, posting_seq: nextPost(data), reason: 'initial', appeal_id: null, ledger_before: ledger, lines: out.lines, postings: out.postings };
  data.eobs.push(eob);
  for (const p of out.postings) { const a = accOf(data, p.member_id, p.plan_year); a.deductible_cents += p.deductible_cents; a.oop_cents += p.oop_cents; }
  for (const u of out.pa_use) { const p = byId(data.pas, 'pa_id', u.pa_id); p.units_used += u.units; bump(data, p, 'pa_id', 'pa_version'); }
  Object.assign(c, { status: 'processed', processed_at: at });
  bump(data, c, 'claim_id', 'claim_version');
  N.eobAvailable(data, c, eob, at);
  if (out.lines.some(l => l.status === 'denied')) {
    data.windows.push({ target: { type: 'claim', id: c.claim_id }, notice_at: at, ends_at: due(at, 180), closing: { due_at: due(at, 166), done: false, notice_at: null } });
    N.claimDenied(data, c, eob, at);
  }
}

function openRequest(data, c, line, type, at) {
  const r = { info_request_id: nextId(data, 'ir'), request_version: 0, type, claim_id: c.claim_id, line_id: line.line_id, plan_year: planYear(line.service_date), opened_at: at, expires_at: due(at, 45), status: 'open', answer: null, answered_at: null };
  data.info_requests.push(r);
  return r;
}

function review(data, c, at) {
  const opened = [];
  for (const l of ordered(c.lines)) {
    const st = standing(data, c, l);
    if (st === 'other_primary') continue;
    if (st === 'unknown') opened.push(openRequest(data, c, l, 'other_coverage', at));
    if (l.possible_accident) opened.push(openRequest(data, c, l, 'accident', at));
  }
  if (!opened.length) { issueV1(data, c, at); return; }
  c.status = 'pending_info';
  bump(data, c, 'claim_id', 'claim_version');
  for (const r of opened) N.infoRequested(data, r, at);
}

const stillOpen = (data, claimId) => requestsOf(data, claimId).some(r => r.status === 'open');

function close(data, r, fields) {
  Object.assign(r, fields);
  bump(data, r, 'info_request_id', 'request_version');
  const c = byId(data.claims, 'claim_id', r.claim_id);
  bump(data, c, 'claim_id', 'claim_version');
  return c;
}

function complete(data, c, at) {
  if (!stillOpen(data, c.claim_id)) issueV1(data, c, at);
}

function expire(data, r, at) {
  complete(data, close(data, r, { status: 'expired' }), at);
}

const accidentOf = (data, claimId, lineId) => data.info_requests.find(r => r.claim_id === claimId && r.line_id === lineId && r.type === 'accident') || null;

const infoToken = (ctx, data, g, args, r) => makeToken({ ctx, data, actor: g.actor, action: 'info', kind: 'request', id: r.info_request_id, subject: requestSubject(data, r), args: businessArgs('info', args), targetVersion: r.request_version });

function infoPreview(ctx, data, args, g) {
  const r = accidentOf(data, g.claim.claim_id, g.line.line_id);
  if (r === null || r.status !== 'open') fail('info_not_requested', 'Line ' + g.line.line_id + ' of claim ' + g.claim.claim_id + ' has no open accident question.');
  const last = !requestsOf(data, r.claim_id).some(x => x !== r && x.status === 'open');
  return { preview: { token: infoToken(ctx, data, g, args, r), required_confirmer: g.actor, changes: { info_request_id: r.info_request_id, claim_id: r.claim_id, line_id: r.line_id, completes: last ? r.claim_id : null } } };
}

function infoConfirm(ctx, data, args, g) {
  let r = null;
  confirmFlow({
    data, now: g.now, at: g.at, token: args.token, confirmer: g.actor,
    currentToken: () => { r = accidentOf(data, g.claim.claim_id, g.line.line_id); return r === null ? null : infoToken(ctx, data, g, args, r); },
    checkState: () => { if (r.status !== 'open') fail('info_not_requested', 'Line ' + g.line.line_id + ' of claim ' + g.claim.claim_id + ' has no open accident question.'); },
    commit: () => complete(data, close(data, r, { status: 'answered', answer: args.answer, answered_at: g.at }), g.at),
  });
  return g.claim;
}

module.exports = { claimReceived, review, expire, complete, close, issueV1, standing, ledgerFor, infoPreview, infoConfirm };
