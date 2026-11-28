'use strict';
const { nextId, byId } = require('./util.cjs');
const { ms } = require('./time.cjs');
const { relation } = require('./authority.cjs');
const { parseToken, coverageKey, approvalView, ACTS_ON } = require('./tokens.cjs');

const memberOfRecord = (list, key, id) => { const r = byId(list, key, id); return r ? r.member_id : null; };

function subjectMember(data, parsed) {
  if (!ACTS_ON[parsed.kind].includes(parsed.action)) return null;
  if (parsed.kind === 'pair') return byId(data.members, 'member_id', parsed.id) ? parsed.id : null;
  if (parsed.kind === 'grant') return memberOfRecord(data.grants, 'grant_id', parsed.id);
  if (parsed.kind === 'coverage') { const k = coverageKey(parsed.id); return data.coverage.some(c => c.member_id === k.member_id && c.plan_year === k.plan_year) ? k.member_id : null; }
  if (parsed.kind === 'request') { const r = byId(data.info_requests, 'info_request_id', parsed.id); return r ? memberOfRecord(data.claims, 'claim_id', r.claim_id) : null; }
  if (parsed.kind === 'claim') return memberOfRecord(data.claims, 'claim_id', parsed.id);
  if (parsed.kind === 'pa') return memberOfRecord(data.pas, 'pa_id', parsed.id);
  return memberOfRecord(data.appeals, 'appeal_id', parsed.id);
}

function canAct(data, actor, parsed, now) {
  const memberId = subjectMember(data, parsed);
  if (memberId === null) return false;
  const rel = relation(data, actor, memberId, now);
  return parsed.kind === 'pair' || parsed.kind === 'grant' ? rel.full : rel.act;
}

function approvalsFor(data, actor, now, match) {
  return data.approvals
    .filter(a => a.confirmed_by === actor)
    .map(a => ({ a, parsed: parseToken(a.token) }))
    .filter(({ parsed }) => parsed !== null && match(parsed) && canAct(data, actor, parsed, now))
    .sort((x, y) => ms(x.a.confirmed_at) - ms(y.a.confirmed_at))
    .map(({ a }) => approvalView(a, now));
}

const subjectsMatch = subjects => parsed => subjects.some(([kind, id]) => parsed.kind === kind && parsed.id === id);

function userConfirmed(data, payload, ctx) {
  data.approvals.push({ approval_id: nextId(data, 'cf'), token: payload.token, subject: parseToken(payload.token), confirmed_by: payload.confirmed_by, confirmed_at: ctx.virtual_now, used_at: null });
  return data;
}

module.exports = { userConfirmed, canAct, approvalsFor, subjectsMatch, subjectMember };
