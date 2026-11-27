'use strict';
// Shared helpers: clock, lookups, pricing under the plan, overlaps, previews and gates.
// No persistence, authentication or platform runtime lives here.
const crypto = require('node:crypto');
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;
const PREFIX = APP + '.';
const BOOKED = new Set(['booked']), HELD = new Set(['booked', 'attended', 'no_show']);

// ---- clock ------------------------------------------------------------------
const parse = value => Date.parse(value);
function now(ctx) {
  const t = Date.parse(ctx.virtual_now);
  if (!Number.isFinite(t)) fail('invalid_time', 'The run clock is not a valid time.');
  return t;
}
const iso = ms => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const minutes = n => n * 60000, hours = n => n * 3600000, days = n => n * 86400000;
function formatter(data) {
  const tz = data.settings.timezone;
  const parts = (ms, opts) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:tz, ...opts}).formatToParts(ms).map(p => [p.type, p.value]));
  return {
    day: ms => {const p = parts(ms, {year:'numeric', month:'2-digit', day:'2-digit'}); return p.year + '-' + p.month + '-' + p.day;},
    hour: ms => Number(parts(ms, {hour:'2-digit', hourCycle:'h23'}).hour),
    long: ms => new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'long', month:'long', day:'numeric'}).format(ms),
    short: ms => new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'short', month:'short', day:'numeric'}).format(ms),
    time: ms => new Intl.DateTimeFormat('en-US', {timeZone:tz, hour:'numeric', minute:'2-digit'}).format(ms),
    stamp: ms => new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}).format(ms),
    dayLabel: day => new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'long', day:'numeric', year:'numeric'}).format(Date.parse(day + 'T00:00:00Z'))
  };
}
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const short = value => sha256(value).slice(0, 16);
function money(c) {
  const abs = Math.abs(c), whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (c < 0 ? '-' : '') + '$' + whole + '.' + String(abs % 100).padStart(2, '0');
}
const credits = n => n + ' credit' + (n === 1 ? '' : 's');

// ---- lookups ----------------------------------------------------------------
function byId(list, key, id, what) {
  const item = list.find(x => x[key] === id);
  if (!item) fail('not_found', what + ' ' + id + ' does not exist in this account.');
  return item;
}
const plan = (data, id) => byId(data.plans, 'plan_id', id, 'Plan');
const studio = (data, id) => byId(data.studios, 'studio_id', id, 'Studio');
const instance = (data, id) => byId(data.class_instances, 'class_instance_id', id, 'Class');
const reservation = (data, id) => byId(data.reservations, 'reservation_id', id, 'Reservation');
const entry = (data, id) => byId(data.waitlist, 'waitlist_entry_id', id, 'Waitlist entry');
const preview = (data, id) => byId(data.previews, 'preview_id', id, 'Preview');
const paymentMethod = (data, id) => id === null ? null : byId(data.payment_methods, 'payment_method_id', id, 'Payment method');
const instructor = (data, id) => id === null ? null : byId(data.instructors, 'instructor_id', id, 'Instructor');
const activePlan = data => plan(data, data.account.plan_id);
function allIds(data) {
  const ids = [];
  const push = (list, key) => {for (const x of list) ids.push(x[key]);};
  push(data.plans, 'plan_id'); push(data.payment_methods, 'payment_method_id'); push(data.studios, 'studio_id'); push(data.instructors, 'instructor_id');
  push(data.class_instances, 'class_instance_id'); push(data.reservations, 'reservation_id'); push(data.waitlist, 'waitlist_entry_id'); push(data.previews, 'preview_id'); push(data.receipts, 'receipt_id');
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

// ---- session guard: every Agent operation is refused while the session is expired ----
function guard(data) {
  if (data.account.signed_out) fail('signed_out', 'The Cadence session has expired. Ask the member to sign in again; the task records the sign-in as an account.session_restored event. Nothing can be read or booked until then.');
}

// ---- pricing under the plan -------------------------------------------------
const myHeld = (data, instId, except = null) => data.reservations.filter(r => r.class_instance_id === instId && HELD.has(r.status) && r.reservation_id !== except);
// "Visited" counts reservations held in the current plan period (for a trial: since it started), so earlier membership history does not use up the trial's first visits.
function visitedStudio(data, studioId, except = null) {
  const since = Date.parse(data.account.period_start + 'T00:00:00Z') - 86400000;
  return data.reservations.some(r => HELD.has(r.status) && r.reservation_id !== except && instance(data, r.class_instance_id).studio_id === studioId && parse(instance(data, r.class_instance_id).start) >= since);
}
// A trial includes the first visit at each studio and excludes premium classes; a credit plan pays the class's credit cost.
function price(data, inst, except = null) {
  const acct = data.account, p = activePlan(data);
  if (acct.status === 'cancelled') return {kind:'not_available', credits:0, reason:'plan_cancelled'};
  if (p.kind === 'trial') {
    if (inst.premium) return {kind:'not_available', credits:0, reason:'premium_excluded'};
    if (visitedStudio(data, inst.studio_id, except)) return {kind:'not_available', credits:0, reason:'repeat_visit'};
    return {kind:'included', credits:0, reason:null};
  }
  if (inst.premium && !p.premium_allowed) return {kind:'not_available', credits:0, reason:'premium_excluded'};
  return {kind:'credits', credits:inst.credit_cost, reason:null};
}
const REASON = {premium_excluded:'premium classes are not included in this plan', repeat_visit:'the trial includes only the first visit at each studio, and this studio has already been visited or booked', plan_cancelled:'the plan is cancelled'};
const spotsLeft = (data, inst) => Math.max(0, inst.capacity - inst.external_bookings - myHeld(data, inst.class_instance_id).length);
const cancelBy = (data, inst) => iso(parse(inst.start) - hours(data.settings.late_cancel_hours));
const overlap = (a, b) => parse(a.start) < parse(b.end) && parse(b.start) < parse(a.end);
function myBookedUpcoming(data, nowMs) {
  return data.reservations.filter(r => BOOKED.has(r.status) && parse(instance(data, r.class_instance_id).end) > nowMs);
}
const ratingLabel = x => x.rating === null ? 'No ratings yet' : x.rating.toFixed(1) + ' of 5 (' + x.review_count + ' review' + (x.review_count === 1 ? '' : 's') + ')';
const fingerprint = (data, inst) => short(JSON.stringify([inst.start, inst.capacity, inst.external_bookings, inst.status, inst.instructor_id, price(data, inst), data.account.plan_id, data.account.credits_remaining, data.account.status]));

// ---- previews, approvals and gates -----------------------------------------
function livePreview(ctx, data, id, kind) {
  const p = preview(data, id);
  if (p.kind !== kind) fail('invalid_arguments', 'Preview ' + id + ' is a ' + p.kind + ' preview.');
  if (now(ctx) > parse(p.expires_at)) fail('preview_stale', 'Preview ' + id + ' expired at ' + p.expires_at + '. Request a new preview.');
  return p;
}
function dropPreview(data, id) {data.previews = data.previews.filter(p => p.preview_id !== id);}
function dropPreviewsOn(data, instId) {data.previews = data.previews.filter(p => !(p.kind === 'booking' && p.payload.class_instance_id === instId));}
function gate(data, target, id, label) {
  if (data.settings.require_user_confirmation && !target.approved) {
    fail('approval_required', label + ' needs the member\'s confirmation first. Ask the member; the task records their answer as a user.confirmed event naming ' + id + '.');
  }
}
function expireOffers(ctx, data) {
  const nowMs = now(ctx);
  for (const e of data.waitlist) if (e.status === 'offered' && parse(e.offer.offer_expires_at) < nowMs) {e.status = 'expired'; stamp(ctx, e, 'waitlist_entry_id', 'offer_expired', 'Offer ' + e.offer.offer_id + ' was not answered by ' + e.offer.offer_expires_at);}
}
const file = (filename, mime_type, buffer) => ({filename, mime_type, base64:buffer.toString('base64'), sha256:sha256(buffer)});

module.exports = {APP, PREFIX, BOOKED, HELD, fail, copy, references, log, parse, now, iso, minutes, hours, days, formatter, addDays, sha256, short, money, credits,
  byId, plan, studio, instance, reservation, entry, preview, paymentMethod, instructor, activePlan, allIds, nextId, stamp, guard,
  myHeld, visitedStudio, price, REASON, spotsLeft, cancelBy, overlap, myBookedUpcoming, ratingLabel, fingerprint, livePreview, dropPreview, dropPreviewsOn, gate, expireOffers, file};
