'use strict';
// Account-level reads and writes: children, schools and calendars, payments, notifications,
// preferences; and the school-calendar event.
const c = require('./common.cjs');
const {notify, longDate} = require('./notify.cjs');
const pickup = require('./pickup.cjs');
const attendance = require('./attendance.cjs');

function children(ctx, data) {
  // A child's default way home is part of the pickup list: omitted unless the account holder is custodial.
  const visible = k => { const {default_dismissal, ...rest} = c.copy(k); return c.myLink(data, k.id)?.custodial ? {...rest, default_dismissal} : rest; };
  // The lunch account ID is how lunch.account_get, lunch.topup and lunch.settings_update name the child's account.
  return {children: data.children.map(k => ({...visible(k), school_name: c.school(data, k.school_id).name,
    lunch_account_id: data.lunch_accounts.find(a => a.child_id === k.id)?.id ?? null,
    guardians: data.guardian_links.filter(l => l.child_id === k.id).map(l => ({person_id: l.person_id, display_name: c.displayName(data, l.person_id),
      relationship: l.relationship, is_me: l.person_id === data.owner_person_id, can_pickup: l.can_pickup, can_sign: l.can_sign, can_pay: l.can_pay, custodial: l.custodial}))}))};
}
function schoolGet(ctx, data, args) {
  const s = c.school(data, args.id), {start, end} = c.windowOf(ctx, data, args, 0, 14);
  return {school: {id: s.id, name: s.name, level: s.level, time_zone: c.tz(data), bell: c.copy(s.bell), term: c.copy(s.term),
    policy: c.policy(data, s)}, start, end, days: c.time.eachDate(start, end).map(d => c.dayInfo(data, s, d))};
}
function payments(ctx, data, args) {
  const {start, end} = c.windowOf(ctx, data, args, 60, 0), zone = c.tz(data);
  if (args.child_id) c.child(data, args.child_id);
  return {start, end, payments: data.payments.filter(p => (!args.child_id || p.child_id === args.child_id) &&
    c.time.localDate(p.paid_at, zone) >= start && c.time.localDate(p.paid_at, zone) <= end).map(c.copy)};
}
function notifications(ctx, data, args) {
  const {start, end} = c.windowOf(ctx, data, args, 30, 0), zone = c.tz(data);
  return {start, end, notifications: data.notifications.filter(n => (!args.kind || n.kind === args.kind) &&
    c.time.localDate(n.at, zone) >= start && c.time.localDate(n.at, zone) <= end)
    .map(({wire, ...n}) => ({...c.copy(n), email_message_stored: wire !== null}))};
}
function preferences(ctx, data) {
  return {preferences: c.copy(data.preferences), payment_methods: data.payment_methods.map(m => ({...c.copy(m), ...c.methodState(ctx, data, m)}))};
}
function updatePreferences(ctx, data, args) {
  const has = k => Object.hasOwn(args, k);
  if (!has('email_notices') && !has('default_payment_method_id')) c.fail('invalid_arguments', 'Give email_notices, default_payment_method_id or both.');
  if (has('default_payment_method_id') && args.default_payment_method_id !== null) c.find(data.payment_methods, args.default_payment_method_id, 'Payment method');
  if (has('email_notices')) data.preferences.email_notices = args.email_notices;
  if (has('default_payment_method_id')) data.preferences.default_payment_method_id = args.default_payment_method_id;
  c.activity(ctx, data, {actor: 'agent', action: 'preferences.update', object_id: data.account_id, request_id: args.request_id});
  return {id: data.account_id, preferences: c.copy(data.preferences)};
}

// school.day_changed: the school's calendar is a fact and is applied as given.
function dayChanged(ctx, data, event, row) {
  const p = event.payload, s = data.schools.find(x => x.id === p.school_id);
  if (!s) c.fail('invalid_event', 'Unknown school.');
  const before = c.dayInfo(data, s, p.date);
  if (!['regular', 'early_dismissal'].includes(before.kind)) c.fail('invalid_event', p.date + ' is not a school day that can change (' + before.kind + ').');
  if (p.date < c.time.localDate(ctx.virtual_now, c.tz(data))) c.fail('invalid_event', 'A past school day cannot change.');
  if (p.kind === 'early_dismissal') {
    if (!p.dismissal_local) c.fail('invalid_event', 'An early dismissal needs its dismissal time.');
    const t = c.time.minutesOf(p.dismissal_local);
    if (t <= c.time.minutesOf(s.bell.start_local) || t >= c.time.minutesOf(s.bell.dismissal_local)) c.fail('invalid_event', 'The early dismissal must fall inside the usual school day.');
    if (before.kind === 'early_dismissal' && before.dismissal_local === p.dismissal_local) c.fail('invalid_event', 'The day already has that dismissal time.');
  } else if (p.dismissal_local) c.fail('invalid_event', 'A closed day has no dismissal time.');
  s.calendar = s.calendar.filter(e => e.date !== p.date);
  s.calendar.push({date: p.date, kind: p.kind, dismissal_local: p.kind === 'early_dismissal' ? p.dismissal_local : null, reason: p.reason,
    changed_at: ctx.virtual_now, event_id: event.event_id});
  s.calendar.sort((a, b) => a.date.localeCompare(b.date));
  const dayId = 'day-' + s.id.replace(/^school-/, '') + '-' + p.date;
  row.object_id = dayId;
  const after = c.dayInfo(data, s, p.date), zone = c.tz(data);
  const kids = data.children.filter(k => k.school_id === s.id);
  // Pickup details are given only for children the account holder is custodial for.
  const lines = kids.flatMap(k => {
    const out = [], custodial = !!c.myLink(data, k.id)?.custodial, d = pickup.activeChange(data, k.id, p.date);
    if (custodial && p.kind === 'closed') {
      const whose = d && (d.recorded_by === data.owner_person_id ? 'your dismissal change' : 'the dismissal change recorded by ' + c.displayName(data, d.recorded_by));
      out.push(k.display_name + ': ' + (d ? whose + ' (' + pickup.describe(data, d) + ', ' + d.id + ') no longer applies.' : 'no dismissal change for that day.'));
    } else if (custodial) {
      out.push(k.display_name + "'s dismissal plan for that day is still: " + (d ? pickup.describe(data, d) + ' (' + d.id + ')' : 'the default, ' + k.default_dismissal.replace('_', ' ')) + '.');
    }
    const moot = data.absence_reports.filter(r => r.child_id === k.id && r.state !== 'cancelled' && r.dates.includes(p.date) &&
      attendance.reportView(ctx, data, r).days.find(x => x.date === p.date).state === 'moot');
    if (moot.length) out.push(k.display_name + ': report ' + moot.map(r => r.id).join(', ') + ' no longer applies to that day.');
    return out;
  });
  const when = p.kind === 'closed' ? s.name + ' will be closed on ' + longDate(p.date) + '.'
    : s.name + ' will dismiss at ' + p.dismissal_local + ' on ' + longDate(p.date) + ' (usually ' + s.bell.dismissal_local + ').';
  const anyCustodial = kids.some(k => c.myLink(data, k.id)?.custodial);
  const cutoff = p.kind === 'early_dismissal' && anyCustodial ? ' Changes for that day can be made until ' + c.time.localTime(after.dismissal_change_cutoff_at, zone) + ' that day.' : '';
  notify(ctx, data, {kind: 'school.day_changed', child_id: kids.length === 1 ? kids[0].id : null, object_type: 'school_day', object_id: dayId,
    event_id: event.event_id, cause_seq: row.seq,
    title: s.name + ': ' + (p.kind === 'closed' ? 'closed' : 'early dismissal at ' + p.dismissal_local) + ' on ' + longDate(p.date),
    body: when + ' Reason given: ' + p.reason + '. ' + lines.join(' ') + cutoff});
}
module.exports = {children, schoolGet, payments, notifications, preferences, updatePreferences, dayChanged};
