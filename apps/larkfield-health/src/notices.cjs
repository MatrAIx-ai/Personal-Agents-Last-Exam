'use strict';
const { nextId, byId, money } = require('./util.cjs');
const { ms, toIso, localParts } = require('./time.cjs');
const { inForceAt } = require('./authority.cjs');

const BODY_LIMIT = 20000;
const TITLES = {
  'notice.eob_available': 'Explanation of benefits available', 'notice.info_requested': 'Information requested', 'notice.claim_denied': 'Claim denied',
  'notice.pa_decision': 'Prior authorization decision', 'notice.appeal_received': 'Appeal received', 'notice.appeal_info_requested': 'Appeal information requested',
  'notice.appeal_decision': 'Appeal decision', 'notice.appeal_window_closing': 'Appeal window closing', 'notice.decision_overdue': 'Decision overdue',
};
const REASONS = { out_of_network: 'out of network', prior_auth_missing: 'no prior authorization', other_party_liable: 'another party is liable', missing_information: 'information was not provided' };
const QUESTIONS = { other_coverage: 'whether the member has other coverage for plan year ', accident: 'whether the service on line ' };

const pad = n => String(n).padStart(2, '0');
const when = iso => { const p = localParts(ms(iso)); return p.date + ' at ' + pad(p.hour) + ':' + pad(p.minute) + ' Eastern Time'; };
const before = iso => { const p = localParts(ms(iso)); return 'before ' + pad(p.hour) + ':' + pad(p.minute) + ' Eastern Time on ' + p.date; };
const units = n => n + (n === 1 ? ' unit' : ' units');
const targetName = target => (target.type === 'pa' ? 'prior authorization ' : 'claim ') + target.id;
const windowOf = (data, type, id) => data.windows.find(w => w.target.type === type && w.target.id === id) || null;

function recipients(data, memberId, at) {
  const t = ms(at), m = byId(data.members, 'member_id', memberId);
  const people = new Set([memberId, ...m.guardian_ids]);
  for (const g of data.grants) if (g.member_id === memberId && inForceAt(g, t)) people.add(g.grantee_id);
  return [...people].sort();
}

function clip(text, limit) {
  if (text.length <= limit) return text;
  let out = '';
  for (const ch of text) { if (out.length + ch.length > limit - 1) break; out += ch; }
  return out + '…';
}

function notify(data, kind, subject, memberId, at, body, fields) {
  const stamp = toIso(ms(at)), added = [];
  for (const p of recipients(data, memberId, stamp)) {
    const n = { notice_id: nextId(data, 'n'), kind, recipient_id: p, subject: { ...subject }, member_id: memberId, at: stamp, title: TITLES[kind], body: clip(body, BODY_LIMIT), fields: structuredClone(fields) };
    data.notices.push(n);
    added.push(n);
  }
  return added;
}

const total = (eob, key) => eob.lines.reduce((sum, l) => sum + l[key], 0);

function eobAvailable(data, claim, eob, at) {
  const cost = total(eob, 'member_cost_cents'), paid = total(eob, 'plan_paid_cents');
  const body = 'Explanation of benefits version ' + eob.version + ' for claim ' + claim.claim_id + ' (member ' + claim.member_id + ') is available: member cost ' + money(cost) + ', plan paid ' + money(paid) + '.';
  return notify(data, 'notice.eob_available', { type: 'claim', id: claim.claim_id }, claim.member_id, at, body, { claim_id: claim.claim_id, eob_version: eob.version, member_cost_cents: cost, plan_paid_cents: paid });
}

function infoRequested(data, request, at) {
  const claim = byId(data.claims, 'claim_id', request.claim_id);
  const question = request.type === 'accident' ? QUESTIONS.accident + request.line_id + ' resulted from an accident' : QUESTIONS.other_coverage + request.plan_year + ' (line ' + request.line_id + ')';
  const body = 'Claim ' + claim.claim_id + ' for member ' + claim.member_id + ' needs an answer on ' + question + '. Answer ' + before(request.expires_at) + '; an unanswered request can lead to a denial for missing information.';
  return notify(data, 'notice.info_requested', { type: 'info_request', id: request.info_request_id }, claim.member_id, at, body, { claim_id: claim.claim_id, line_id: request.line_id, type: request.type, expires_at: request.expires_at });
}

function claimDenied(data, claim, eob, at) {
  const denied = eob.lines.filter(l => l.status === 'denied'), w = windowOf(data, 'claim', claim.claim_id);
  const body = 'Claim ' + claim.claim_id + ' for member ' + claim.member_id + ' has denied lines: ' + denied.map(l => l.line_id + ' (' + REASONS[l.reason] + ')').join(', ') + '. An appeal can be filed ' + before(w.ends_at) + '.';
  return notify(data, 'notice.claim_denied', { type: 'claim', id: claim.claim_id }, claim.member_id, at, body, { claim_id: claim.claim_id, denied_lines: denied.map(l => l.line_id), window_ends_at: w.ends_at });
}

function paDecision(data, pa, at) {
  const head = 'Prior authorization ' + pa.pa_id + ' for member ' + pa.member_id + ' was ';
  const a = pa.approved;
  let body;
  if (a === null) { const w = windowOf(data, 'pa', pa.pa_id); body = head + 'denied.' + (w ? ' An appeal can be filed ' + before(w.ends_at) + '.' : ''); }
  else body = head + 'approved: ' + units(a.units) + ', valid ' + a.valid_from + ' to ' + a.valid_until + '.' + (pa.status === 'expired' ? ' That validity has already ended.' : '');
  return notify(data, 'notice.pa_decision', { type: 'pa', id: pa.pa_id }, pa.member_id, at, body,
    { pa_id: pa.pa_id, status: pa.status, units: a ? a.units : null, valid_from: a ? a.valid_from : null, valid_until: a ? a.valid_until : null });
}

function appealBody(kind, a) {
  const head = (a.expedited ? 'Expedited appeal ' : 'Appeal ') + a.appeal_id + ' of ' + targetName(a.target) + ' for member ' + a.member_id;
  if (kind === 'notice.appeal_received') return head + ' was received; a decision is due by ' + when(a.due_at) + '.';
  if (kind === 'notice.appeal_info_requested') return 'The plan asked for more information on ' + head.charAt(0).toLowerCase() + head.slice(1) + ': "' + a.info_requests[a.info_requests.length - 1].text + '". The decision is still due by ' + when(a.due_at) + '.';
  if (a.status === 'upheld') return head + ' was upheld; the denial stands.';
  if (a.target.type === 'claim') return head + ' was overturned for line' + (a.outcome.lines.length === 1 ? ' ' : 's ') + a.outcome.lines.join(', ') + '; a new explanation of benefits was issued.';
  return head + ' was overturned: ' + units(a.outcome.units) + ', valid until ' + a.outcome.valid_until + '.';
}

function appealNotice(data, kind, appeal, at) {
  return notify(data, kind, { type: 'appeal', id: appeal.appeal_id }, appeal.member_id, at, appealBody(kind, appeal), { appeal_id: appeal.appeal_id, target: { ...appeal.target }, status: appeal.status, due_at: appeal.due_at });
}

const targetRecord = (data, target) => (target.type === 'pa' ? byId(data.pas, 'pa_id', target.id) : byId(data.claims, 'claim_id', target.id));

function windowClosing(data, w, at) {
  const memberId = targetRecord(data, w.target).member_id;
  const body = 'The appeal window for ' + targetName(w.target) + ' (member ' + memberId + ') closes on ' + when(w.ends_at) + '.';
  return notify(data, 'notice.appeal_window_closing', { type: w.target.type, id: w.target.id }, memberId, at, body, { target: { ...w.target }, window_ends_at: w.ends_at });
}

function decisionOverdue(data, type, rec, at) {
  const name = type === 'pa' ? 'prior authorization ' + rec.pa_id : 'appeal ' + rec.appeal_id;
  const body = 'The decision on ' + name + ' for member ' + rec.member_id + ' was due by ' + when(rec.due_at) + ' and is overdue.';
  return notify(data, 'notice.decision_overdue', { type, id: type === 'pa' ? rec.pa_id : rec.appeal_id }, rec.member_id, at, body, { due_at: rec.due_at });
}

module.exports = { TITLES, BODY_LIMIT, recipients, notify, eobAvailable, infoRequested, claimDenied, paDecision, appealNotice, windowClosing, decisionOverdue };
