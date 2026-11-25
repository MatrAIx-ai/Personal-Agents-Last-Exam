'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write.
const {references:bound} = require('./domain-utils.cjs');
const c = require('./common.cjs');
const d = require('./dates.cjs');
const o = require('./office.cjs');
const {message} = require('./notices.cjs');

const bad = text => c.fail('invalid_seed', text);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function timeline(record) {
  if (c.ms(record.created_at) > c.ms(record.updated_at)) bad(record.id + ' timestamps are reversed.');
  let previous = c.ms(record.created_at);
  for (const entry of record.history) {
    const at = c.ms(entry.at);
    if (!Number.isFinite(at) || at < previous || at > c.ms(record.updated_at)) bad('Invalid history timeline for ' + record.id + '.');
    previous = at;
  }
  if (!record.history.length || previous !== c.ms(record.updated_at)) bad(record.id + ' history must include the last update.');
}

function calendar(data) {
  if (!d.validTimeZone(data.office.timezone)) bad('The office time zone is not a valid IANA zone.');
  const dates = (data.holidays || []).map(h => h.date);
  if (!dates.every(d.validDate)) bad('A holiday has an invalid date.');
  if (new Set(dates).size !== dates.length) bad('Duplicate holiday date.');
}

function request(ctx, data, r, signatures) {
  timeline(r);
  if (!data.documents.some(doc => doc.id === r.document_id)) bad('Request ' + r.id + ' names an unknown document.');
  if (c.ms(r.created_at) !== c.ms(r.submitted_at)) bad('Request ' + r.id + ' is created when it is submitted.');
  if (r.submitted_on !== o.today(data, r.submitted_at)) bad('Request ' + r.id + ' submitted_on must be the office date of submitted_at.');
  if (r.due_on !== o.computation(data, r.submitted_on, r.business_days).due_on) bad('Request ' + r.id + ' due_on does not follow the business-day rule.');
  const done = r.status === 'processed';
  if ([r.processed_at, r.processed_event_id, r.signature_id].some(v => (v !== null) !== done)) bad('Request ' + r.id + ' processing fields do not match its status.');
  if (!done) return;
  const sig = signatures.get(r.signature_id);
  if (r.signature_id !== c.signatureIdFor(r.id) || !sig || sig.request_id !== r.id) bad('Request ' + r.id + ' must point to its own signature.');
  if (c.ms(r.processed_at) !== c.ms(sig.issued_at) || c.ms(r.processed_at) < c.ms(r.submitted_at)) bad('Request ' + r.id + ' was processed at a different time from its signature.');
  if (o.today(data, r.processed_at) < r.due_on) bad('Request ' + r.id + ' was processed before its due date.');
}

function signature(data, s, requests) {
  const r = requests.get(s.request_id);
  if (!r || r.signature_id !== s.id || r.document_id !== s.document_id) bad('Signature ' + s.id + ' must belong to a processed request for the same document.');
  if (!d.validDate(s.signed_on) || !d.validDate(s.valid_until)) bad('Signature ' + s.id + ' has an invalid date.');
  if (s.signed_on !== o.today(data, s.issued_at)) bad('Signature ' + s.id + ' signed_on must be the office date of issued_at.');
  if (s.valid_until <= s.signed_on) bad('Signature ' + s.id + ' must be valid for at least a day.');
}

function notices(ctx, data, requests, signatures) {
  for (const n of data.notices) {
    if (!(n.ref.object_type === 'travel_signature' ? signatures : requests).has(n.ref.object_id)) bad('Notice ' + n.id + ' refers to an unknown object.');
    if ((n.kind === 'signature_issued') !== (n.ref.object_type === 'travel_signature')) bad('Notice ' + n.id + ' kind does not match its object.');
    if (n.message === null) continue;
    const to = n.message.data.recipient.id;
    if (!ctx.binding.accounts.some(a => a.app_id === 'mail' && a.account_id === to && a.owner_person_id === data.owner_person_id)) bad('Notice ' + n.id + ' is addressed to a Mail account that is not the student\'s.');
    if (!same(n.message, message(data, n, to))) bad('Notice ' + n.id + ' message does not match the notice.');
  }
}

function validateSeed(ctx, data) {
  bound(ctx, data);
  if (data.mail_account_id !== null && !ctx.binding.accounts.some(a => a.app_id === 'mail' && a.account_id === data.mail_account_id &&
      a.owner_person_id === data.owner_person_id)) bad('The Mail account must be bound to the student.');
  calendar(data);
  const ids = new Set();
  for (const record of [...data.documents, ...data.requests, ...data.signatures, ...data.notices]) {
    if (ids.has(record.id)) bad('Duplicate record ID.');
    ids.add(record.id);
  }
  if (data.requests.filter(r => r.status === 'submitted').length > 1) bad('At most one request can be in processing.');
  const requests = new Map(data.requests.map(r => [r.id, r])), signatures = new Map(data.signatures.map(s => [s.id, s]));
  for (const r of data.requests) request(ctx, data, r, signatures);
  for (const s of data.signatures) signature(data, s, requests);
  notices(ctx, data, requests, signatures);
}

const records = data => [...data.documents, ...data.requests, ...data.signatures, ...data.notices];
module.exports = {validateSeed, records, objects:data => records(data).map(r => r.id), references:() => [], assetReferences:() => []};
