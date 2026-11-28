'use strict';
const { fail, byId, bump, nextId, nextPost, nextFile, textLength } = require('./util.cjs');
const { ms, toIso, dayDeadline, HOUR, localDate } = require('./time.cjs');
const { overturn } = require('./adjudication.cjs');
const { makeToken, businessArgs, claimSubject, paSubject, appealSubject } = require('./tokens.cjs');
const { confirmFlow } = require('./confirm.cjs');
const { ledgerFor } = require('./claims.cjs');
const { approve } = require('./pa.cjs');
const N = require('./notices.cjs');

const OPEN = new Set(['under_review', 'info_requested']);
const DECIDED = new Set(['upheld', 'overturned']);
const due = (at, n) => toIso(dayDeadline(at, n));
const invalid = message => fail('invalid_event', message);
const change = (data, a) => bump(data, a, 'appeal_id', 'appeal_version');
const appealsOn = (data, type, id) => data.appeals.filter(a => a.target.type === type && a.target.id === id);
const windowOf = (data, type, id) => data.windows.find(w => w.target.type === type && w.target.id === id);
const first = (data, claimId) => data.eobs.find(e => e.claim_id === claimId && e.version === 1);
const name = type => (type === 'pa' ? 'PA ' : 'Claim ');

function appealable(data, type, rec) {
  const id = type === 'pa' ? rec.pa_id : rec.claim_id;
  if (appealsOn(data, type, id).some(a => DECIDED.has(a.status))) return false;
  if (type === 'pa') return rec.status === 'denied';
  return rec.status === 'processed' && first(data, id).lines.some(l => l.status === 'denied');
}

function statement(text) {
  if (textLength(text) > 2000) fail('invalid_arguments', 'The statement is longer than 2,000 characters.');
}

function filingCheck(data, args, g) {
  const type = args.target_type, id = args.target_id;
  if (!appealable(data, type, g.target)) fail('not_appealable', name(type) + id + ' has no denial that can be appealed.');
  if (appealsOn(data, type, id).some(a => OPEN.has(a.status))) fail('duplicate_request', name(type) + id + ' already has an open appeal.');
  const w = windowOf(data, type, id);
  if (g.now >= ms(w.ends_at)) fail('appeal_window_closed', 'The appeal window for ' + id + ' closed at ' + w.ends_at + '.');
  if (args.expedited === true && (type === 'claim' || args.urgency_attested !== true)) fail('expedite_not_allowed', 'Only a PA appeal with an urgency attestation can be expedited.');
  return w;
}

const deniedLines = (data, claimId) => first(data, claimId).lines.filter(l => l.status === 'denied').map(l => l.line_id);

function terms(args, at) {
  if (args.target_type === 'claim') return { rule: 'claim_60_days', due_at: due(at, 60) };
  return args.expedited === true ? { rule: 'pa_72_hours', due_at: toIso(ms(at) + 72 * HOUR) } : { rule: 'pa_30_days', due_at: due(at, 30) };
}

function fileToken(ctx, data, g, args) {
  const claim = args.target_type === 'claim', rec = g.target;
  return makeToken({ ctx, data, actor: g.actor, action: 'file', kind: args.target_type, id: args.target_id, subject: claim ? claimSubject(data, rec) : paSubject(rec), args: businessArgs('file', args), targetVersion: claim ? rec.claim_version : rec.pa_version });
}

function filePreview(ctx, data, args, g) {
  const w = filingCheck(data, args, g), t = terms(args, g.at);
  statement(args.statement);
  return { preview: { token: fileToken(ctx, data, g, args), required_confirmer: g.actor, changes: { target_type: args.target_type, target_id: args.target_id, lines: args.target_type === 'claim' ? deniedLines(data, args.target_id) : null,
    expedited: args.expedited === true, due_rule: t.rule, due_at_if_filed_now: t.due_at, window_ends_at: w.ends_at } } };
}

function fileConfirm(ctx, data, args, g) {
  let appeal = null;
  confirmFlow({
    data, now: g.now, at: g.at, token: args.token, confirmer: g.actor,
    currentToken: () => fileToken(ctx, data, g, args),
    checkState: () => { filingCheck(data, args, g); statement(args.statement); },
    commit: () => {
      appeal = { appeal_id: nextId(data, 'ap'), appeal_version: 0, member_id: g.target.member_id, target: { type: args.target_type, id: args.target_id }, lines: args.target_type === 'claim' ? deniedLines(data, args.target_id) : null,
        expedited: args.expedited === true, filed_at: g.at, filed_seq: nextFile(data), due_at: terms(args, g.at).due_at, overdue: false, overdue_at: null, status: 'under_review',
        statements: [{ at: g.at, by: g.actor, text: args.statement }], info_requests: [], decided_at: null, outcome: null, withdrawn_at: null };
      data.appeals.push(appeal);
      N.appealNotice(data, 'notice.appeal_received', appeal, g.at);
    },
  });
  return appeal;
}

function openCheck(a, what) {
  if (!OPEN.has(a.status)) fail('invalid_state', 'Appeal ' + a.appeal_id + ' is ' + a.status + '; it can no longer ' + what + '.');
}

const withdrawToken = (ctx, data, g, a) => makeToken({ ctx, data, actor: g.actor, action: 'withdraw', kind: 'appeal', id: a.appeal_id, subject: appealSubject(data, a), args: businessArgs('withdraw', { appeal_id: a.appeal_id }), targetVersion: a.appeal_version });

function withdrawPreview(ctx, data, args, g) {
  openCheck(g.appeal, 'be withdrawn');
  return { preview: { token: withdrawToken(ctx, data, g, g.appeal), required_confirmer: g.actor, changes: { appeal_id: g.appeal.appeal_id, window_ends_at: windowOf(data, g.appeal.target.type, g.appeal.target.id).ends_at } } };
}

function withdrawConfirm(ctx, data, args, g) {
  const a = g.appeal;
  confirmFlow({
    data, now: g.now, at: g.at, token: args.token, confirmer: g.actor,
    currentToken: () => withdrawToken(ctx, data, g, a),
    checkState: () => openCheck(a, 'be withdrawn'),
    commit: () => { Object.assign(a, { status: 'withdrawn', withdrawn_at: g.at }); change(data, a); },
  });
  return a;
}

function addStatement(ctx, data, args, g) {
  const a = g.appeal;
  openCheck(a, 'take statements');
  statement(args.statement);
  a.statements.push({ at: g.at, by: g.actor, text: args.statement });
  a.status = 'under_review';
  change(data, a);
  return a;
}

function appealInfoRequested(data, p, ctx) {
  const a = byId(data.appeals, 'appeal_id', p.appeal_id);
  if (a.status !== 'under_review') return data;
  if (textLength(p.request) > 2000) invalid('The information request is longer than 2,000 characters.');
  a.status = 'info_requested';
  a.info_requests.push({ at: ctx.virtual_now, text: p.request });
  change(data, a);
  N.appealNotice(data, 'notice.appeal_info_requested', a, ctx.virtual_now);
  return data;
}

function issueV2(data, a, at) {
  const c = byId(data.claims, 'claim_id', a.target.id), prev = first(data, c.claim_id);
  const ledger = ledgerFor(data, c.member_id, prev.postings.map(p => String(p.plan_year)));
  const out = overturn({ plan: data.plan, services: new Map(data.services.map(s => [s.service_id, s])), memberId: c.member_id, lines: c.lines, previous: prev.lines, named: a.outcome.lines, ledger });
  const eob = { eob_id: nextId(data, 'eob'), claim_id: c.claim_id, version: prev.version + 1, issued_at: at, posting_seq: nextPost(data), reason: 'appeal', appeal_id: a.appeal_id, ledger_before: ledger, lines: out.lines, postings: out.postings };
  data.eobs.push(eob);
  for (const p of out.postings) {
    const was = prev.postings.find(x => x.plan_year === p.plan_year), acc = data.accumulators.find(x => x.member_id === p.member_id && x.plan_year === p.plan_year);
    acc.deductible_cents += p.deductible_cents - was.deductible_cents;
    acc.oop_cents += p.oop_cents - was.oop_cents;
  }
  bump(data, c, 'claim_id', 'claim_version');
  N.eobAvailable(data, c, eob, at);
}

function appealDecided(data, p, ctx) {
  const a = byId(data.appeals, 'appeal_id', p.appeal_id), at = ctx.virtual_now;
  if (!OPEN.has(a.status)) return data;
  if (p.outcome === 'upheld') Object.assign(a, { status: 'upheld', decided_at: at });
  else if (a.target.type === 'claim') {
    if (p.lines === undefined) invalid('Appeal ' + a.appeal_id + ' is on a claim; an overturn names the lines it reprices.');
    for (const l of p.lines) if (!a.lines.includes(l)) invalid('Line ' + l + ' is not one of the lines of appeal ' + a.appeal_id + '.');
    Object.assign(a, { status: 'overturned', decided_at: at, outcome: { lines: a.lines.filter(l => p.lines.includes(l)), units: null, valid_until: null } });
    issueV2(data, a, at);
  } else {
    if (p.units === undefined) invalid('Appeal ' + a.appeal_id + ' is on a PA; an overturn gives units and valid_until.');
    const pa = byId(data.pas, 'pa_id', a.target.id);
    approve(data, pa, { units: p.units, valid_from: localDate(ms(at)), valid_until: p.valid_until }, at);
    bump(data, pa, 'pa_id', 'pa_version');
    Object.assign(a, { status: 'overturned', decided_at: at, outcome: { lines: null, units: p.units, valid_until: p.valid_until } });
  }
  change(data, a);
  N.appealNotice(data, 'notice.appeal_decision', a, at);
  return data;
}

function appealDue(data, a, at) {
  Object.assign(a, { overdue: true, overdue_at: at });
  change(data, a);
  N.decisionOverdue(data, 'appeal', a, at);
}

function windowClosing(data, w, at) {
  w.closing.done = true;
  const rec = w.target.type === 'pa' ? byId(data.pas, 'pa_id', w.target.id) : byId(data.claims, 'claim_id', w.target.id);
  if (!appealable(data, w.target.type, rec)) return;
  w.closing.notice_at = at;
  N.windowClosing(data, w, at);
}

module.exports = { filePreview, fileConfirm, withdrawPreview, withdrawConfirm, addStatement, appealInfoRequested, appealDecided, appealDue, windowClosing, appealable };
