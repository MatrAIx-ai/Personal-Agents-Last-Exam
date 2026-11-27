'use strict';
// Workflow 1: dockets, their periods in the agency's time zone, corrections and supporting documents.
const c = require('./common.cjs');
const {fail, copy, parse} = c;
const agencySummary = a => ({agency_id:a.agency_id, name:a.name, acronym:a.acronym, timezone:a.timezone});
const mine = (data, d) => ({my_comment_ids:data.comments.filter(x => x.docket_id === d.docket_id).map(x => x.comment_id), my_draft_id:(data.drafts.find(x => x.docket_id === d.docket_id) || {draft_id:null}).draft_id});
const docSummary = x => ({id:x.document_id, ...copy(x)});
function summary(data, d, nowMs) {
  return {id:d.docket_id, docket_id:d.docket_id, title:d.title, agency:agencySummary(c.agency(data, d.agency_id)), status:c.periodStatus(d, nowMs), opened_at:d.opened_at, closes_at:d.closes_at, closes_at_local:c.closesLocal(data, d), extended_from:d.extended_from,
    closing_soon:c.closingSoon(data, d, nowMs), days_left:c.daysLeft(d, nowMs), corrections:d.corrections.length, document_count:d.document_ids.length, public_comment_count:d.public_comment_count, ...mine(data, d)};
}
function view(data, d, nowMs) {
  return {id:d.docket_id, ...copy(d), agency:agencySummary(c.agency(data, d.agency_id)), status:c.periodStatus(d, nowMs), closes_at_local:c.closesLocal(data, d), closing_soon:c.closingSoon(data, d, nowMs), days_left:c.daysLeft(d, nowMs),
    documents:d.document_ids.map(id => docSummary(c.document(data, id))), ...mine(data, d)};
}
function search(ctx, data, args) {
  const nowMs = c.now(ctx), q = (args.query || '').toLocaleLowerCase(), status = args.status || 'all';
  const out = data.dockets.filter(d => {
    const a = c.agency(data, d.agency_id);
    if (args.agency_id && d.agency_id !== args.agency_id) return false;
    const st = c.periodStatus(d, nowMs);
    if (status !== 'all' && st !== status) return false;
    const closesDay = c.dayIn(d.closes_at, a.timezone);
    if (args.closing_after && closesDay < args.closing_after) return false;
    if (args.closing_before && closesDay > args.closing_before) return false;
    if (q && ![d.docket_id, d.title, d.summary, a.name, a.acronym].join(' ').toLocaleLowerCase().includes(q)) return false;
    return true;
  }).map(d => summary(data, d, nowMs));
  const rank = {open:0, extended:0, closed:1};
  out.sort((x, y) => rank[x.status] - rank[y.status] || (x.status === 'closed' ? parse(y.closes_at) - parse(x.closes_at) : parse(x.closes_at) - parse(y.closes_at)));
  return {dockets:out};
}
const get = (ctx, data, args) => ({docket:view(data, c.docket(data, args.id), c.now(ctx))});
function documents(ctx, data, args) {
  const d = c.docket(data, args.id);
  if (!ctx.assets?.read) fail('unsupported_capability', 'An asset reader is required.');
  return {docket_id:d.docket_id, documents:d.document_ids.map(id => {const x = c.document(data, id); const {media, ...file} = ctx.assets.read(x.asset_id); return {...docSummary(x), file};})};
}
module.exports = {agencySummary, summary, view, search, get, documents};
