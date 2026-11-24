'use strict';
// Shared Bellnote domain helpers: lookups, rights, school days, cut-offs and the activity log.
const time = require('./time.cjs');
const {log} = require('./diagnostics.cjs');

const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
const copy = value => structuredClone(value);
const ALLERGENS = Object.freeze(['peanut', 'tree_nut', 'milk', 'egg', 'wheat', 'soy', 'fish', 'shellfish', 'sesame']);
const RESTRICTION_NOTE = 'on file with the school office';

// ---- identifiers -----------------------------------------------------------------------------
// Sequential, data-derived IDs keep replays and resets deterministic (Core replays receipts).
function nextId(records, prefix, key = 'id') {
  let max = 0;
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  for (const r of records) { const m = re.exec(r[key]); if (m) max = Math.max(max, +m[1]); }
  return prefix + '-' + String(max + 1).padStart(4, '0');
}
function allIds(data) {
  const ids = [];
  for (const k of ['schools', 'staff', 'children', 'guardian_links', 'pickup_people', 'restrictions', 'dismissal_changes',
    'attendance', 'absence_reports', 'forms', 'form_responses', 'lunch_accounts', 'lunch_transactions', 'menu_days',
    'payment_methods', 'payments', 'notifications']) for (const r of data[k]) ids.push(r.id);
  return ids;
}
const idTaken = (data, id) => allIds(data).includes(id) || data.district.id === id;

// ---- lookups ---------------------------------------------------------------------------------
function find(list, id, what = 'Record') {
  const item = list.find(x => x.id === id);
  if (!item) fail('not_found', what + ' ' + id + ' does not exist in this account.');
  return item;
}
const child = (data, id) => find(data.children, id, 'Child');
const school = (data, id) => find(data.schools, id, 'School');
const schoolOf = (data, childId) => school(data, child(data, childId).school_id);
function person(data, personId) {
  return data.people.find(p => p.person_id === personId) || null;
}
function displayName(data, personId) {
  const p = person(data, personId);
  if (p) return p.display_name;
  const s = data.staff.find(x => x.id === personId);
  return s ? s.name : personId;
}
// The account holder's own link for a child: the source of every per-child right.
function myLink(data, childId) {
  return data.guardian_links.find(l => l.child_id === childId && l.person_id === data.owner_person_id) || null;
}
function requireRight(data, childId, right) {
  child(data, childId);
  const l = myLink(data, childId);
  if (!l || !l[right]) fail('not_permitted', 'Your guardian record for this child does not include ' + right + '.');
  return l;
}
const guardianLink = (data, childId, personId) => data.guardian_links.find(l => l.child_id === childId && l.person_id === personId) || null;
const restricted = (data, childId, personId) => data.restrictions.some(r => r.child_id === childId && r.person_id === personId);

// ---- policy, school days and cut-offs ----------------------------------------------------------
const tz = data => data.district.time_zone;
const policy = (data, s) => ({...data.district.policy, ...(s.policy || {})});
// A cut-off rule is either an absolute local time on the day or a number of minutes before
// that day's dismissal (which moves on an early-dismissal day). It always resolves to a dated
// instant in the district's time zone, so daylight-saving changes are handled by the zone rules.
function resolveCutoff(rule, date, dismissalLocal, zone) {
  if (rule.anchor === 'fixed') return time.zonedIso(date, rule.local_time, zone);
  const ms = time.zonedInstant(date, dismissalLocal, zone) - rule.minutes_before * 60000;
  return time.isoInZone(ms, zone);
}
function dayInfo(data, s, date) {
  const zone = tz(data), entry = s.calendar.find(c => c.date === date) || null, wd = time.weekday(date);
  const base = {school_id: s.id, date, start_local: s.bell.start_local, usual_dismissal_local: s.bell.dismissal_local};
  if (date < s.term.start_date || date > s.term.end_date) return {...base, kind: 'outside_term', school_day: false};
  if (wd === 0 || wd === 6) return {...base, kind: 'weekend', school_day: false};
  if (entry && entry.kind === 'closed') return {...base, kind: 'closed', school_day: false, reason: entry.reason};
  const dismissal = entry && entry.kind === 'early_dismissal' ? entry.dismissal_local : s.bell.dismissal_local;
  const p = policy(data, s);
  return {...base, kind: entry ? 'early_dismissal' : 'regular', school_day: true, dismissal_local: dismissal,
    ...(entry ? {reason: entry.reason} : {}),
    absence_cutoff_at: resolveCutoff(p.absence_cutoff_local, date, dismissal, zone),
    dismissal_change_cutoff_at: resolveCutoff(p.dismissal_change_cutoff_local, date, dismissal, zone),
    dismissal_at: time.zonedIso(date, dismissal, zone)};
}
const passed = (ctx, iso) => Date.parse(ctx.virtual_now) >= Date.parse(iso);
function schoolDay(data, s, date) {
  const info = dayInfo(data, s, date);
  if (!info.school_day) fail('not_school_day', date + ' is not a school day at ' + s.name + ' (' + info.kind + ').');
  return info;
}

// ---- windows ---------------------------------------------------------------------------------
const MAX_WINDOW_DAYS = 120;
function windowOf(ctx, data, args, defaultBack = 14, defaultAhead = 14) {
  const today = time.localDate(ctx.virtual_now, tz(data));
  const start = args.start || time.addDays(today, -defaultBack), end = args.end || time.addDays(today, defaultAhead);
  if (!time.validDate(start) || !time.validDate(end)) fail('invalid_window', 'start and end must be calendar dates (YYYY-MM-DD).');
  if (end < start) fail('invalid_window', 'The window ends before it starts.');
  if (time.daysBetween(start, end) > MAX_WINDOW_DAYS) fail('invalid_window', 'A window may span at most ' + MAX_WINDOW_DAYS + ' days.');
  return {start, end};
}

// ---- payment methods -------------------------------------------------------------------------
function methodState(ctx, data, m) {
  const expired = m.expiry_month ? Date.parse(ctx.virtual_now) >= time.monthEnd(m.expiry_month, tz(data)) : false;
  return {expired, usable: m.status === 'active' && !expired};
}
function chargeableMethod(ctx, data, methodId) {
  const id = methodId || data.preferences.default_payment_method_id;
  if (!id) fail('payment_declined', 'No payment method is on file for this account.');
  const m = data.payment_methods.find(x => x.id === id);
  if (!m) fail('not_found', 'Payment method ' + id + ' does not exist in this account.');
  const st = methodState(ctx, data, m);
  if (m.status !== 'active') fail('payment_declined', 'The payment method was declined.');
  if (st.expired) fail('payment_declined', 'The payment method has expired.');
  return m;
}

// ---- activity log ----------------------------------------------------------------------------
// One row per committed Agent write, per applied event and per effect of an event.
function activity(ctx, data, row) {
  const seq = data.activity.length ? data.activity[data.activity.length - 1].seq + 1 : 1;
  const entry = {seq, at: ctx.virtual_now, actor: row.actor, action: row.action, child_id: row.child_id ?? null,
    object_id: row.object_id, request_id: row.request_id ?? null, event_id: row.event_id ?? null};
  if (row.cause_seq) entry.cause_seq = row.cause_seq;
  data.activity.push(entry);
  log(ctx, 'bellnote.' + row.action, {object_id: row.object_id, actor: row.actor});
  return entry;
}

module.exports = {fail, copy, ALLERGENS, RESTRICTION_NOTE, nextId, allIds, idTaken, find, child, school, schoolOf,
  person, displayName, myLink, requireRight, guardianLink, restricted, tz, policy, resolveCutoff, dayInfo, passed,
  schoolDay, windowOf, methodState, chargeableMethod, activity, time, log};
