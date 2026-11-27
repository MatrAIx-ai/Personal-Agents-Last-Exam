'use strict';
// Seed validation and the data-relationship hooks Core calls. Reports facts about records; grants nothing.
const c = require('./common.cjs');
const {fail, parse} = c;
function timeline(created, updated, history, what) {
  if (parse(created) > parse(updated)) fail('invalid_seed', what + ': timestamps are reversed.');
  let previous = parse(created);
  for (const h of history) {const at = parse(h.at); if (!Number.isFinite(at) || at < previous || at > parse(updated)) fail('invalid_seed', what + ': history is out of order.'); previous = at;}
  if (!history.length || previous !== parse(updated)) fail('invalid_seed', what + ': history must end with the last update.');
}
function validateSeed(ctx, data) {
  c.references(ctx, data);
  const seen = new Map();
  const unique = (id, what) => {if (seen.has(id)) fail('invalid_seed', 'Duplicate ID ' + id + ' (' + what + ' and ' + seen.get(id) + ').'); seen.set(id, what);};
  const agencies = new Set();
  for (const a of data.agencies) {unique(a.agency_id, 'agency'); agencies.add(a.agency_id); try {new Intl.DateTimeFormat('en-US', {timeZone:a.timezone});} catch {fail('invalid_seed', 'Agency ' + a.agency_id + ' has an unknown time zone.');}}
  const dockets = new Map(), docs = new Map(), assets = new Set();
  for (const d of data.dockets) {
    unique(d.docket_id, 'docket'); dockets.set(d.docket_id, d);
    if (!agencies.has(d.agency_id)) fail('invalid_seed', 'Docket ' + d.docket_id + ' names unknown agency ' + d.agency_id + '.');
    if (parse(d.opened_at) >= parse(d.closes_at)) fail('invalid_seed', 'Docket ' + d.docket_id + ': the period closes before it opens.');
    if (d.extended_from !== null && parse(d.extended_from) >= parse(d.closes_at)) fail('invalid_seed', 'Docket ' + d.docket_id + ': an extension must move the closing later.');
    let previous = 0;
    for (const x of d.corrections) {if (parse(x.at) < previous || parse(x.at) < parse(d.opened_at)) fail('invalid_seed', 'Docket ' + d.docket_id + ': corrections are out of order.'); previous = parse(x.at);}
    timeline(d.created_at, d.updated_at, d.history, 'Docket ' + d.docket_id);
  }
  for (const x of data.documents) {
    unique(x.document_id, 'document'); docs.set(x.document_id, x);
    if (!dockets.has(x.docket_id)) fail('invalid_seed', 'Document ' + x.document_id + ' names unknown docket ' + x.docket_id + '.');
    if (!dockets.get(x.docket_id).document_ids.includes(x.document_id)) fail('invalid_seed', 'Document ' + x.document_id + ' is not listed on its docket.');
    if (assets.has(x.asset_id)) fail('invalid_seed', 'Asset ' + x.asset_id + ' is used by two documents.'); assets.add(x.asset_id);
  }
  for (const d of data.dockets) for (const id of d.document_ids) if (!docs.has(id) || docs.get(id).docket_id !== d.docket_id) fail('invalid_seed', 'Docket ' + d.docket_id + ' lists a document it does not own: ' + id + '.');
  for (const r of data.drafts) {
    unique(r.draft_id, 'draft');
    if (!dockets.has(r.docket_id)) fail('invalid_seed', 'Draft ' + r.draft_id + ' names unknown docket.');
    if ((r.submitter.kind === 'anonymous') && (r.submitter.name !== null || r.submitter.organization !== null)) fail('invalid_seed', 'Draft ' + r.draft_id + ': an anonymous submitter carries no name.');
    timeline(r.created_at, r.updated_at, r.history, 'Draft ' + r.draft_id);
  }
  for (const x of data.comments) {
    unique(x.comment_id, 'comment');
    if (!dockets.has(x.docket_id)) fail('invalid_seed', 'Comment ' + x.comment_id + ' names unknown docket.');
    if (c.sha256(x.text) !== x.text_sha256) fail('invalid_seed', 'Comment ' + x.comment_id + ': text_sha256 does not match the text.');
    if ((x.status === 'returned') !== (x.return_reason !== null)) fail('invalid_seed', 'Comment ' + x.comment_id + ': returned comments carry a reason and only they do.');
    if (x.submitter.kind === 'anonymous' && (x.submitter.name !== null || x.submitter.organization !== null)) fail('invalid_seed', 'Comment ' + x.comment_id + ': an anonymous submitter carries no name.');
    if (parse(x.submitted_at) < parse(dockets.get(x.docket_id).opened_at)) fail('invalid_seed', 'Comment ' + x.comment_id + ' was submitted before its docket opened.');
    timeline(x.submitted_at, x.updated_at, x.history, 'Comment ' + x.comment_id);
  }
  for (const d of data.dockets) {
    const mine = data.comments.filter(x => x.docket_id === d.docket_id);
    if (mine.filter(x => !x.supplemental).length > 1) fail('invalid_seed', 'Docket ' + d.docket_id + ' holds two non-supplemental comments by this account.');
  }
}
const records = data => [...data.agencies, ...data.dockets, ...data.documents, ...data.drafts, ...data.comments];
const KEYS = ['agency_id', 'docket_id', 'document_id', 'draft_id', 'comment_id'];
const objects = data => records(data).map(r => r[KEYS.find(k => k in r)]);
const assetReferences = data => data.documents.map(x => ({asset_id:x.asset_id, object_id:x.docket_id, object_type:'docket'}));
module.exports = {validateSeed, records, objects, references:() => [], assetReferences};
