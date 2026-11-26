'use strict';
// Workflow 2: drafting with validation, the acknowledged submission, receipts and status.
const c = require('./common.cjs');
const dockets = require('./dockets.cjs');
const {fail, copy, parse} = c;

function draftView(data, r, nowMs) {
  const d = c.docket(data, r.docket_id), p = c.problems(data, d, r, nowMs);
  return {id:r.draft_id, ...copy(r), problems:p, ready:p.length === 0, docket_title:d.title, docket_status:c.periodStatus(d, nowMs)};
}
function commentView(data, x) {const d = c.docket(data, x.docket_id); return {id:x.comment_id, ...copy(x), docket_title:d.title, agency:dockets.agencySummary(c.agency(data, d.agency_id))};}
function receiptView(data, x) {
  const d = c.docket(data, x.docket_id), a = c.agency(data, d.agency_id);
  return {comment_id:x.comment_id, tracking_number:x.tracking_number, docket_id:d.docket_id, docket_title:d.title, agency:dockets.agencySummary(a), submitted_at:x.submitted_at, submitted_at_local:c.local(x.submitted_at, a.timezone),
    submitter:copy(x.submitter), supplemental:x.supplemental, text_sha256:x.text_sha256, status:x.status, text:x.text};
}
const normalize = s => ({kind:s.kind, name:s.kind === 'anonymous' ? null : (s.name ?? null), organization:s.kind === 'anonymous' ? null : (s.organization ?? null)});

function validate(ctx, data, args) {
  const nowMs = c.now(ctx), d = c.docket(data, args.docket_id), p = c.problems(data, d, {text:args.text, submitter:normalize(args.submitter), supplemental:!!args.supplemental}, nowMs);
  return {ok:p.length === 0, problems:p, docket_status:c.periodStatus(d, nowMs), closes_at:d.closes_at, closes_at_local:c.closesLocal(data, d), characters:(args.text || '').trim().length};
}
function draft(ctx, data, args) {
  const nowMs = c.now(ctx), d = c.docket(data, args.docket_id), submitter = normalize(args.submitter), supplemental = !!args.supplemental;
  let r;
  if (args.id !== undefined) {
    r = c.draft(data, args.id);
    if (r.docket_id !== d.docket_id) fail('invalid_arguments', 'Draft ' + r.draft_id + ' belongs to docket ' + r.docket_id + '.');
    r.text = args.text; r.submitter = submitter; r.supplemental = supplemental;
    c.stamp(ctx, r, 'draft_id', 'updated');
  } else {
    r = {draft_id:c.nextId(data, 'draft'), docket_id:d.docket_id, text:args.text, submitter, supplemental, created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
    data.drafts.push(r);
    c.stamp(ctx, r, 'draft_id', 'created');
  }
  const p = c.problems(data, d, r, nowMs);
  return {id:r.draft_id, docket_id:d.docket_id, problems:p, ready:p.length === 0, characters:r.text.trim().length};
}
// The acknowledgment is the member's, checked by the App; the task policy decides whether the agent may call this at all.
function submit(ctx, data, args) {
  const nowMs = c.now(ctx), r = c.draft(data, args.id), d = c.docket(data, r.docket_id);
  if (!args.acknowledged) fail('acknowledgment_required', 'Submitting makes the comment public and permanent; the member must acknowledge that (acknowledged: true). Nothing was submitted.');
  const p = c.problems(data, d, r, nowMs);
  const closed = p.find(x => x.code === 'period_closed'); if (closed) fail('period_closed', closed.message + ' Nothing was submitted.');
  const dup = p.find(x => x.code === 'possible_duplicate'); if (dup) fail('possible_duplicate', dup.message);
  if (p.length) fail('invalid_draft', 'The draft is not ready: ' + p.map(x => x.message).join(' '));
  const x = {comment_id:c.nextId(data, 'cmt'), docket_id:d.docket_id, draft_id:r.draft_id, tracking_number:c.tracking(d, r.text, ctx.virtual_now), text:r.text, text_sha256:c.sha256(r.text), submitter:copy(r.submitter), supplemental:r.supplemental,
    status:'received', return_reason:null, submitted_at:ctx.virtual_now, updated_at:ctx.virtual_now, notices:[], history:[]};
  data.comments.push(x);
  data.drafts = data.drafts.filter(y => y.draft_id !== r.draft_id);
  d.public_comment_count += 1;
  c.stamp(ctx, x, 'comment_id', 'submitted', (x.submitter.kind === 'anonymous' ? 'Anonymous' : 'Named') + (x.supplemental ? ', supplemental' : '') + '; tracking ' + x.tracking_number);
  return {id:x.comment_id, draft_id:r.draft_id, docket_id:d.docket_id, tracking_number:x.tracking_number, submitted_at:x.submitted_at, outcome:'received'};
}
const receipt = (ctx, data, args) => ({receipt:receiptView(data, c.comment(data, args.id))});
const status = (ctx, data, args) => ({comment:commentView(data, c.comment(data, args.id))});
function listMine(ctx, data, args) {
  const nowMs = c.now(ctx), st = args.status || 'all';
  return {drafts:data.drafts.map(r => draftView(data, r, nowMs)), comments:data.comments.filter(x => st === 'all' || x.status === st).map(x => commentView(data, x)).sort((a, b) => parse(b.submitted_at) - parse(a.submitted_at))};
}
module.exports = {draftView, commentView, receiptView, validate, draft, submit, receipt, status, listMine};
