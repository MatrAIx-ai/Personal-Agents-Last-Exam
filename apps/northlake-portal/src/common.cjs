'use strict';
// Shared helpers: lookups, clock, money, ledger arithmetic, previews and gates.
// No persistence, authentication or platform runtime lives here.
const crypto = require('node:crypto');
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;
const PREFIX = APP + '.';
const FINAL = new Set(['paid', 'denied']);

// ---- clock ------------------------------------------------------------------
const parse = value => Date.parse(value);
function now(ctx) {
  const t = Date.parse(ctx.virtual_now);
  if (!Number.isFinite(t)) fail('invalid_time', 'The run clock is not a valid time.');
  return t;
}
const iso = ms => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const minutes = n => n * 60000, hours = n => n * 3600000, days = n => n * 86400000;
const dayOf = value => new Date(Date.parse(value)).toISOString().slice(0, 10);
function formatter(data) {
  const tz = data.settings.timezone;
  const parts = (ms, opts) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:tz, ...opts}).formatToParts(ms).map(p => [p.type, p.value]));
  return {
    day: ms => {const p = parts(ms, {year:'numeric', month:'2-digit', day:'2-digit'}); return p.year + '-' + p.month + '-' + p.day;},
    stamp: ms => {const p = parts(ms, {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZoneName:'short'}); return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ' ' + p.timeZoneName;},
    long: ms => new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'long', month:'long', day:'numeric', year:'numeric'}).format(ms),
    date: ms => new Intl.DateTimeFormat('en-US', {timeZone:tz, month:'long', day:'numeric', year:'numeric'}).format(ms),
    time: ms => new Intl.DateTimeFormat('en-US', {timeZone:tz, hour:'numeric', minute:'2-digit', timeZoneName:'short'}).format(ms),
    dayLabel: day => new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'long', day:'numeric', year:'numeric'}).format(Date.parse(day + 'T00:00:00Z'))
  };
}

// ---- money (integer cents everywhere; events carry exact dollar amounts) -----
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const short = value => sha256(value).slice(0, 16);
function cents(dollars, field) {
  const c = Math.round(dollars * 100);
  if (Math.abs(dollars * 100 - c) > 1e-6) fail('invalid_event', field + ' must be an exact amount in cents.');
  return c;
}
function money(c) {
  const abs = Math.abs(c), whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (c < 0 ? '-' : '') + '$' + whole + '.' + String(abs % 100).padStart(2, '0');
}

// ---- lookups ----------------------------------------------------------------
function byId(list, key, id, what) {
  const item = list.find(x => x[key] === id);
  if (!item) fail('not_found', what + ' ' + id + ' does not exist in this account.');
  return item;
}
const thread = (data, id) => byId(data.threads, 'thread_id', id, 'Thread');
const claim = (data, id) => byId(data.claims, 'claim_id', id, 'Claim');
const provider = (data, id) => byId(data.providers, 'provider_id', id, 'Provider');
const clinic = (data, id) => byId(data.clinics, 'clinic_id', id, 'Clinic');
const slot = (data, id) => byId(data.slots, 'slot_id', id, 'Slot');
const appointment = (data, id) => byId(data.appointments, 'appointment_id', id, 'Appointment');
const entry = (data, id) => byId(data.waitlist, 'waitlist_entry_id', id, 'Waitlist entry');
const statement = (data, id) => byId(data.statements, 'statement_id', id, 'Statement');
const request = (data, id) => byId(data.billing_requests, 'request_id', id, 'Request');
const preview = (data, id) => byId(data.previews, 'preview_id', id, 'Preview');
function message(data, id) {
  for (const t of data.threads) {const m = t.messages.find(x => x.message_id === id); if (m) return {thread:t, message:m};}
  fail('not_found', 'Message ' + id + ' does not exist in this account.');
}
function allIds(data) {
  const ids = [data.patient.patient_id];
  if (data.interstitial) ids.push(data.interstitial.interstitial_id);
  const push = (list, key) => {for (const x of list) ids.push(x[key]);};
  push(data.clinics, 'clinic_id'); push(data.providers, 'provider_id'); push(data.slots, 'slot_id'); push(data.appointments, 'appointment_id');
  push(data.waitlist, 'waitlist_entry_id'); push(data.claims, 'claim_id'); push(data.payments, 'payment_id'); push(data.billing_requests, 'request_id');
  push(data.statements, 'statement_id'); push(data.previews, 'preview_id'); push(data.approvals, 'target_id');
  for (const t of data.threads) {ids.push(t.thread_id); push(t.messages, 'message_id');}
  for (const w of data.waitlist) if (w.offer) ids.push(w.offer.offer_id);
  return ids;
}
function nextId(data, prefix) {
  const ids = new Set(allIds(data));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// ---- history ----------------------------------------------------------------
function stamp(ctx, record, idKey, action, detail = null) {
  if (now(ctx) < parse(record.updated_at)) fail('invalid_time', 'The run clock must not precede the last record update.');
  record.updated_at = ctx.virtual_now;
  record.history.push(detail === null ? {at:ctx.virtual_now, action} : {at:ctx.virtual_now, action, detail});
  log(ctx, PREFIX + action, {record_id:record[idKey]});
}
function stampClaim(ctx, c, action, detail = null) {
  if (now(ctx) < parse(c.updated_at)) fail('invalid_time', 'The run clock must not precede the last record update.');
  c.updated_at = ctx.virtual_now;
  c.history.push({at:ctx.virtual_now, action, status:c.status, ...(detail === null ? {} : {detail})});
  log(ctx, PREFIX + action, {claim_id:c.claim_id});
}

// ---- interstitial guard -----------------------------------------------------
const ALWAYS_ALLOWED = new Set([PREFIX + 'account.get', PREFIX + 'interstitial.acknowledge']);
function guard(data, name) {
  const i = data.interstitial;
  if (!i || i.status !== 'pending' || ALWAYS_ALLOWED.has(name)) return;
  const step = i.clearable_by === 'agent'
    ? 'Call ' + PREFIX + 'interstitial.acknowledge with id ' + i.interstitial_id + ' to continue.'
    : 'Only the user can clear this ' + i.kind.replace('_', ' ') + ' (' + i.interstitial_id + '); ask them to review it in the portal. The task records that as a user.confirmed event.';
  fail('interstitial_pending', i.text + ' ' + step);
}

// ---- ledger -----------------------------------------------------------------
function paidByPatient(data, claimId) {
  let total = 0;
  for (const p of data.payments) for (const a of p.allocations) if (a.claim_id === claimId) total += p.kind === 'refund' ? -a.amount_cents : a.amount_cents;
  return total;
}
function openBalance(data, c) {
  if (!FINAL.has(c.status)) return 0;
  return Math.max(0, c.patient_responsibility_cents - paidByPatient(data, c.claim_id));
}
// The time the claim reached its current final decision (the first entry of the final run of paid/denied statuses).
function finalAt(c) {
  if (!FINAL.has(c.status)) return null;
  let at = null;
  for (let i = c.history.length - 1; i >= 0 && FINAL.has(c.history[i].status); i--) at = c.history[i].at;
  return at;
}
function isPastDue(data, c, nowMs) {
  const at = finalAt(c);
  return at !== null && openBalance(data, c) > 0 && nowMs - parse(at) > days(data.health_system.past_due_after_days);
}
function claimView(data, c, nowMs) {
  const flags = [];
  if (c.statement_id === null) flags.push('unstatemented');
  if (isPastDue(data, c, nowMs)) flags.push('past_due');
  return {...copy(c), paid_by_patient_cents:paidByPatient(data, c.claim_id), open_balance_cents:openBalance(data, c), flags};
}
function summary(data, nowMs) {
  const open = data.claims.filter(c => openBalance(data, c) > 0);
  return {
    balance_due_cents:open.reduce((s, c) => s + openBalance(data, c), 0),
    past_due_cents:open.filter(c => isPastDue(data, c, nowMs)).reduce((s, c) => s + openBalance(data, c), 0),
    pending_insurance_cents:data.claims.filter(c => !FINAL.has(c.status)).reduce((s, c) => s + c.billed_cents, 0),
    open_claims:open.length,
    unread_messages:data.threads.reduce((s, t) => s + t.messages.filter(m => !m.read).length, 0),
    upcoming_appointments:data.appointments.filter(a => a.status === 'booked' && parse(a.start) > nowMs).length
  };
}
const ledgerFingerprint = (data, claimIds) => short(JSON.stringify(claimIds.map(id => {const c = claim(data, id); return [id, c.status, c.patient_responsibility_cents, paidByPatient(data, id)];})));

// ---- previews, approvals and gates -----------------------------------------
function livePreview(ctx, data, id, kind) {
  const p = preview(data, id);
  if (p.kind !== kind) fail('invalid_arguments', 'Preview ' + id + ' is a ' + p.kind + ' preview.');
  if (now(ctx) > parse(p.expires_at)) fail('preview_stale', 'Preview ' + id + ' expired at ' + p.expires_at + '. Request a new preview.');
  return p;
}
function dropPreview(data, id) {data.previews = data.previews.filter(p => p.preview_id !== id);}
// With require_user_confirmation on, a gated write waits for a user.confirmed event naming its preview or offer.
function gate(data, target, id, label) {
  if (data.settings.require_user_confirmation && !target.approved) {
    fail('approval_required', label + ' needs the user\'s confirmation first. Ask the user; the task records their answer as a user.confirmed event naming ' + id + '.');
  }
}
// Writes with no preview (new message, reply, refund or waiver request) are gated through a draft ID derived from their content.
const draftId = fields => 'draft-' + short(JSON.stringify(fields));
function draftGate(data, id, label) {
  if (!data.settings.require_user_confirmation) return;
  const i = data.approvals.findIndex(a => a.target_id === id);
  if (i < 0) fail('approval_required', label + ' needs the user\'s confirmation first. Show the user the exact content; the task records their answer as a user.confirmed event with draft_id ' + id + '.');
  data.approvals.splice(i, 1);
}

// ---- files ------------------------------------------------------------------
const file = (filename, mime_type, buffer) => ({filename, mime_type, base64:buffer.toString('base64'), sha256:sha256(buffer)});

module.exports = {APP, PREFIX, FINAL, fail, copy, references, log, parse, now, iso, minutes, hours, days, dayOf, formatter, sha256, short, cents, money,
  byId, thread, claim, provider, clinic, slot, appointment, entry, statement, request, preview, message, allIds, nextId, stamp, stampClaim, guard,
  paidByPatient, openBalance, finalAt, isPastDue, claimView, summary, ledgerFingerprint, livePreview, dropPreview, gate, draftId, draftGate, file};
