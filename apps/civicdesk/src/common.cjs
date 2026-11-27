'use strict';
// Shared helpers: clock, period status in the agency's time zone, lookups, validation of a comment, tracking numbers.
const crypto = require('node:crypto');
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;
const PREFIX = APP + '.';

const parse = value => Date.parse(value);
function now(ctx) {const t = Date.parse(ctx.virtual_now); if (!Number.isFinite(t)) fail('invalid_time', 'The run clock is not a valid time.'); return t;}
const iso = ms => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const days = n => n * 86400000;
const local = (value, tz) => new Intl.DateTimeFormat('en-US', {timeZone:tz, month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'}).format(new Date(value));
const dayIn = (value, tz) => {const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:tz, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(value)).map(x => [x.type, x.value])); return p.year + '-' + p.month + '-' + p.day;};
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const short = value => sha256(value).slice(0, 16);

function byId(list, key, id, what) {const item = list.find(x => x[key] === id); if (!item) fail('not_found', what + ' ' + id + ' does not exist.'); return item;}
const agency = (data, id) => byId(data.agencies, 'agency_id', id, 'Agency');
const docket = (data, id) => {const d = data.dockets.find(x => x.docket_id === id); if (!d) fail('unknown_docket', 'Docket ' + id + ' does not exist. Search with dockets.search.'); return d;};
const document = (data, id) => byId(data.documents, 'document_id', id, 'Document');
const draft = (data, id) => byId(data.drafts, 'draft_id', id, 'Draft');
const comment = (data, id) => byId(data.comments, 'comment_id', id, 'Comment');
function allIds(data) {
  const ids = [];
  for (const [list, key] of [[data.agencies, 'agency_id'], [data.dockets, 'docket_id'], [data.documents, 'document_id'], [data.drafts, 'draft_id'], [data.comments, 'comment_id']]) for (const x of list) ids.push(x[key]);
  return ids;
}
function nextId(data, prefix) {const ids = new Set(allIds(data)); let n = 1; while (ids.has(prefix + '-' + n)) n++; return prefix + '-' + n;}
function stamp(ctx, record, idKey, action, detail = null) {
  if (now(ctx) < parse(record.updated_at)) fail('invalid_time', 'The run clock must not precede the last record update.');
  record.updated_at = ctx.virtual_now;
  record.history.push(detail === null ? {at:ctx.virtual_now, action} : {at:ctx.virtual_now, action, detail});
  log(ctx, PREFIX + action, {record_id:record[idKey]});
}

// ---- comment periods: open, extended or closed by the clock, shown in the agency's time zone ----
const periodStatus = (d, nowMs) => nowMs > parse(d.closes_at) ? 'closed' : d.extended_from !== null ? 'extended' : 'open';
const daysLeft = (d, nowMs) => nowMs > parse(d.closes_at) ? null : Math.ceil((parse(d.closes_at) - nowMs) / days(1));
const closesLocal = (data, d) => local(d.closes_at, agency(data, d.agency_id).timezone);
const closingSoon = (data, d, nowMs) => periodStatus(d, nowMs) !== 'closed' && daysLeft(d, nowMs) <= data.settings.closing_soon_days;

// ---- validation shared by validate, draft and submit ----
function problems(data, d, {text, submitter, supplemental}, nowMs, {except = null} = {}) {
  const out = [], n = (text || '').trim().length, s = data.settings;
  if (n < s.min_comment_chars) out.push({code:'too_short', message:'The comment has ' + n + ' characters; at least ' + s.min_comment_chars + ' are required.'});
  if (n > s.max_comment_chars) out.push({code:'too_long', message:'The comment has ' + n + ' characters; at most ' + s.max_comment_chars + ' are allowed.'});
  if (submitter.kind === 'named' && !(submitter.name && submitter.name.trim())) out.push({code:'name_required', message:'A named submission needs the submitter\'s name; choose anonymous to leave it off the public record.'});
  if (periodStatus(d, nowMs) === 'closed') out.push({code:'period_closed', message:'The comment period for ' + d.docket_id + ' closed on ' + closesLocal(data, d) + '.'});
  const mine = data.comments.filter(c => c.docket_id === d.docket_id && c.comment_id !== except);
  if (mine.length && !supplemental) out.push({code:'possible_duplicate', message:'You already submitted ' + mine.map(c => c.comment_id).join(', ') + ' on ' + d.docket_id + '. Mark this one supplemental to add to it; it is then labeled as a supplemental comment.'});
  return out;
}
const tracking = (d, text, at) => 'CDK-' + d.docket_id.split('-').slice(1).join('-') + '-' + sha256(d.docket_id + '|' + text + '|' + at).slice(0, 5).toUpperCase();
const file = (filename, mime_type, buffer) => ({filename, mime_type, base64:buffer.toString('base64'), sha256:sha256(buffer)});

module.exports = {APP, PREFIX, fail, copy, references, log, parse, now, iso, days, local, dayIn, sha256, short, byId, agency, docket, document, draft, comment, allIds, nextId, stamp,
  periodStatus, daysLeft, closesLocal, closingSoon, problems, tracking, file};
