'use strict';
const { byId, sortBy } = require('./util.cjs');
const { planYear } = require('./time.cjs');
const { inForceAt } = require('./authority.cjs');

const providerView = p => ({ provider_id: p.provider_id, name: p.name, kind: p.kind, in_network: p.in_network });
const serviceView = s => ({ service_id: s.service_id, description: s.description, category: s.category });
const eobLine = l => ({ line_id: l.line_id, status: l.status, reason: l.reason, allowed_cents: l.allowed_cents, copay_cents: l.copay_cents, deductible_cents: l.deductible_cents, coinsurance_cents: l.coinsurance_cents,
  member_cost_cents: l.member_cost_cents, plan_paid_cents: l.plan_paid_cents, not_allowed_cents: l.not_allowed_cents, pa_id: l.pa_id, pa_units: l.pa_units });

function eobView(data, e) {
  const claim = byId(data.claims, 'claim_id', e.claim_id);
  const billed = claim.lines.reduce((sum, l) => sum + l.billed_cents, 0);
  const total = key => e.lines.reduce((sum, l) => sum + l[key], 0);
  return { eob_id: e.eob_id, version: e.version, issued_at: e.issued_at, reason: e.reason, appeal_id: e.appeal_id, lines: e.lines.map(eobLine),
    totals: { billed_cents: billed, allowed_cents: total('allowed_cents'), member_cost_cents: total('member_cost_cents'), plan_paid_cents: total('plan_paid_cents'), not_allowed_cents: total('not_allowed_cents') } };
}

function requestView(r, approvals) {
  return { info_request_id: r.info_request_id, request_version: r.request_version, type: r.type, claim_id: r.claim_id, line_id: r.line_id, plan_year: r.plan_year, opened_at: r.opened_at, expires_at: r.expires_at,
    status: r.status, answer: r.answer, answered_at: r.answered_at, approvals };
}

function windowView(data, type, id) {
  const w = data.windows.find(x => x.target.type === type && x.target.id === id);
  return w ? { notice_at: w.notice_at, ends_at: w.ends_at, closing_notice_at: w.closing.notice_at } : null;
}

function claimView(data, c, approvalsFor) {
  const eobs = data.eobs.filter(e => e.claim_id === c.claim_id).sort((a, b) => a.version - b.version);
  const current = eobs.length ? eobs[eobs.length - 1] : null;
  const requests = data.info_requests.filter(r => r.claim_id === c.claim_id).sort(sortBy('info_request_id'));
  const lines = c.lines.map(l => {
    const outcome = current ? current.lines.find(x => x.line_id === l.line_id) : null;
    return { line_id: l.line_id, position: l.position, service: serviceView(byId(data.services, 'service_id', l.service_id)), service_date: l.service_date, plan_year: planYear(l.service_date), units: l.units,
      billed_cents: l.billed_cents, emergency: l.emergency, possible_accident: l.possible_accident, outcome: outcome ? eobLine(outcome) : null };
  });
  return { claim_id: c.claim_id, claim_version: c.claim_version, member_id: c.member_id, provider: providerView(byId(data.providers, 'provider_id', c.provider_id)), received_at: c.received_at, review_at: c.review_at,
    status: c.status, lines, info_requests: requests.map(r => requestView(r, approvalsFor([['request', r.info_request_id]]))), eobs: eobs.map(e => eobView(data, e)), appeal_window: windowView(data, 'claim', c.claim_id),
    appeal_ids: data.appeals.filter(a => a.target.type === 'claim' && a.target.id === c.claim_id).map(a => a.appeal_id).sort(),
    approvals: approvalsFor([['claim', c.claim_id], ...requests.map(r => ['request', r.info_request_id])]) };
}

function paView(data, p, approvalsFor) {
  return { pa_id: p.pa_id, pa_version: p.pa_version, member_id: p.member_id, provider: providerView(byId(data.providers, 'provider_id', p.provider_id)), service: serviceView(byId(data.services, 'service_id', p.service_id)),
    status: p.status, submitted_at: p.submitted_at, requested: { ...p.requested }, approved: p.approved === null ? null : { ...p.approved }, units_used: p.units_used, info_requests: p.info_requests.map(r => ({ at: r.at, text: r.text })),
    expedite: p.expedite === null ? null : { requested_at: p.expedite.requested_at, reason: p.expedite.reason, status: p.expedite.status, decided_at: p.expedite.decided_at },
    due_at: p.due_at, overdue: p.overdue, overdue_at: p.overdue_at, decided_at: p.decided_at, expired_at: p.expired_at, denial_notice_at: p.denial_notice_at, appeal_window: windowView(data, 'pa', p.pa_id),
    covered_submissions: p.covered_submissions.map(s => ({ pa_id: s.pa_id, provider_id: s.provider_id, units: s.units, valid_from: s.valid_from, valid_until: s.valid_until, at: s.at })),
    appeal_ids: data.appeals.filter(a => a.target.type === 'pa' && a.target.id === p.pa_id).map(a => a.appeal_id).sort(), approvals: approvalsFor([['pa', p.pa_id]]) };
}

function appealView(a, approvalsFor) {
  return { appeal_id: a.appeal_id, appeal_version: a.appeal_version, member_id: a.member_id, target: { ...a.target }, lines: a.lines === null ? null : [...a.lines], expedited: a.expedited, filed_at: a.filed_at, due_at: a.due_at,
    overdue: a.overdue, overdue_at: a.overdue_at, status: a.status, statements: a.statements.map(s => ({ at: s.at, by: s.by, text: s.text })), info_requests: a.info_requests.map(r => ({ at: r.at, text: r.text })),
    decided_at: a.decided_at, outcome: a.outcome === null ? null : { lines: a.outcome.lines === null ? null : [...a.outcome.lines], units: a.outcome.units, valid_until: a.outcome.valid_until },
    withdrawn_at: a.withdrawn_at, approvals: approvalsFor([['appeal', a.appeal_id]]) };
}

const grantState = (g, now) => (g.status === 'revoked' ? 'revoked' : inForceAt(g, now) ? 'active' : 'expired');
const grantView = (g, now) => ({ grant_id: g.grant_id, grant_version: g.grant_version, member_id: g.member_id, grantor_id: g.grantor_id, grantee_id: g.grantee_id, scope: g.scope,
  created_at: g.created_at, expires_at: g.expires_at, revoked_at: g.revoked_at, state: grantState(g, now) });

module.exports = { providerView, serviceView, claimView, eobView, requestView, windowView, paView, appealView, grantState, grantView };
