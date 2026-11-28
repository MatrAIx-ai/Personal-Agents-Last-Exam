'use strict';
const { fail, byId, bump, sortBy, compareSeq } = require('./util.cjs');
const { ms } = require('./time.cjs');
const { makeToken, businessArgs, coverageSubject } = require('./tokens.cjs');
const { confirmFlow } = require('./confirm.cjs');
const C = require('./claims.cjs');

const record = (data, memberId, year) => data.coverage.find(x => x.member_id === memberId && x.plan_year === year) || null;

function openRequests(data, memberId, year) {
  const claims = new Map(data.claims.map(c => [c.claim_id, c]));
  return data.info_requests.filter(r => r.type === 'other_coverage' && r.status === 'open' && r.plan_year === year && claims.get(r.claim_id).member_id === memberId)
    .sort(sortBy('info_request_id'))
    .sort((a, b) => { const x = claims.get(a.claim_id), y = claims.get(b.claim_id); return ms(x.received_at) - ms(y.received_at) || compareSeq(x.received_seq, y.received_seq); });
}

const claimsOf = (data, requests) => [...new Set(requests.map(r => r.claim_id))].map(id => byId(data.claims, 'claim_id', id));
const notOpen = (memberId, year) => fail('info_not_requested', 'No other-coverage question is open for member ' + memberId + ' in plan year ' + year + '.');

const cobToken = (ctx, data, g, args, cov) => makeToken({ ctx, data, actor: g.actor, action: 'cob', kind: 'coverage', id: cov.member_id + ':' + cov.plan_year, subject: coverageSubject(data, cov), args: businessArgs('cob', args), targetVersion: cov.version });

function cobPreview(ctx, data, args, g) {
  const open = openRequests(data, args.member_id, args.plan_year);
  if (!open.length) notOpen(args.member_id, args.plan_year);
  const cov = record(data, args.member_id, args.plan_year);
  const ids = new Set(open.map(r => r.info_request_id));
  const completes = claimsOf(data, open).filter(c => data.info_requests.every(r => r.claim_id !== c.claim_id || r.status !== 'open' || ids.has(r.info_request_id))).map(c => c.claim_id);
  return { preview: { token: cobToken(ctx, data, g, args, cov), required_confirmer: g.actor, changes: { resolves: open.map(r => r.info_request_id), completes } } };
}

function cobConfirm(ctx, data, args, g) {
  let cov = null, touched = [];
  confirmFlow({
    data, now: g.now, at: g.at, token: args.token, confirmer: g.actor,
    currentToken: () => { cov = record(data, args.member_id, args.plan_year); return cov === null ? null : cobToken(ctx, data, g, args, cov); },
    checkState: () => { if (!openRequests(data, args.member_id, args.plan_year).length) notOpen(args.member_id, args.plan_year); },
    commit: () => {
      const open = openRequests(data, args.member_id, args.plan_year);
      Object.assign(cov, { status: args.answer, attested_at: g.at });
      bump(data, cov, 'member_id', 'version');
      for (const r of open) C.close(data, r, { status: 'answered', answer: args.answer, answered_at: g.at });
      touched = claimsOf(data, open);
      for (const c of touched) C.complete(data, c, g.at);
    },
  });
  return { coverage: { member_id: cov.member_id, plan_year: cov.plan_year, status: cov.status, version: cov.version, attested_at: cov.attested_at }, claims: touched };
}

module.exports = { cobPreview, cobConfirm, openRequests };
