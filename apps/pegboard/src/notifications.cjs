'use strict';
// The activity log, the notification log, quiet hours, the Mail wire message and preferences.
// A notification is written once, with its release time: the time it was written, or the
// end of the quiet period it was written in. Nothing is rewritten when that time passes;
// `held` and `released` are read from the release time and the supplied clock.
// Pegboard never delivers anything itself: an Infra-run sender (infra/sender.cjs) reads
// notifications from a snapshot and publishes the stored wire messages through Messaging.
const { fail, ms, isoAt, localDate, localMinutes, localToInstant, addDays, nextId, validTimeZone, minutesOf, HOUR } = require('./util.cjs');
const { notificationState, objects } = require('./model.cjs');

// One row for every committed Agent write, every applied event and every effect of an event
// (a shift reassigned, a handoff voided, a notification written). Time-driven changes run no
// App code and write no row. Returns the row's sequence number.
function record(data, row) {
  const seq = (data.activity.length ? data.activity[data.activity.length - 1].seq : 0) + 1;
  const clean = { seq };
  for (const key of ['at', 'actor', 'action', 'object_id', 'request_id', 'event_id', 'details']) if (row[key] !== undefined) clean[key] = row[key];
  data.activity.push(clean);
  return seq;
}

function inQuietHours(preferences, t) {
  const q = preferences.quiet_hours;
  if (!q.enabled) return false;
  const now = localMinutes(t, preferences.timezone), start = minutesOf(q.start), end = minutesOf(q.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}
// End of the quiet period that contains instant `t`.
function quietEnd(preferences, t) {
  const tz = preferences.timezone, day = localDate(t, tz), today = localToInstant(day, preferences.quiet_hours.end, tz);
  return today > t ? today : localToInstant(addDays(day, 1), preferences.quiet_hours.end, tz);
}

const TOPIC = {
  'schedule.published': 'schedule', 'shift.changed': 'shift-changes', 'open_shift.posted': 'open-shifts',
  'handoff.received': 'handoffs', 'handoff.updated': 'handoffs', 'time_off.decided': 'time-off',
};
// Full CloudEvents wire message for Mail's receive declaration (urn:pale:email-message:2).
function wireMessage(data, notification, time) {
  return {
    specversion: '1.0',
    id: notification.id,
    source: 'urn:pale:app:pegboard:account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1',
    time,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: { kind: 'person_ref', id: data.owner_person_id },
      source_object: { app_id: 'pegboard', account_id: data.account_id, object_type: notification.object.type, object_id: notification.object.id },
      content: { title: notification.title, body: { format: 'text/plain', text: notification.body }, asset_ids: [] },
      subscription_ref: data.account_id + ':' + TOPIC[notification.kind],
      extensions: [],
    },
  };
}

const URGENT_WITHIN = 12 * HOUR;
// Write one notification at event time `at`. Inside quiet hours its release time is the end
// of that quiet period, unless it is about a shift that starts less than 12 hours after it
// is written; otherwise it is released as it is written. When email notices are on at this
// moment, the full wire message is stored with it, dated at the release time.
function notify(data, at, spec, eventId) {
  const preferences = data.preferences, t = ms(at);
  const starts = spec.shifts.map(s => ms(s.start)).filter(start => start > t);
  const urgent = starts.length > 0 && Math.min(...starts) - t < URGENT_WITHIN;
  const held = !urgent && inQuietHours(preferences, t);
  const notification = {
    id: nextId(objects(data), 'ntf-'), seq: 0, kind: spec.kind, created_at: at,
    release_at: held ? isoAt(quietEnd(preferences, t), preferences.timezone) : at, object: spec.object,
    shift_ids: spec.shifts.map(s => s.id), ...(spec.change ? { change: spec.change } : {}),
    title: spec.title.slice(0, 200), body: spec.body.slice(0, 2000), cause: { event_id: eventId },
  };
  if (preferences.email_notices) notification.wire = wireMessage(data, notification, notification.release_at);
  data.notifications.push(notification);
  notification.seq = record(data, { at, actor: 'event', action: 'notification.created', object_id: notification.id, event_id: eventId, details: { kind: spec.kind, release_at: notification.release_at } });
  return notification;
}

function present(notification, now) {
  return {
    id: notification.id, kind: notification.kind, state: notificationState(notification, now), created_at: notification.created_at,
    release_at: notification.release_at, object: notification.object, shift_ids: notification.shift_ids, change: notification.change ?? null,
    title: notification.title, body: notification.body, email_copy: notification.wire !== undefined,
  };
}

// Pagination shared by the list reads: `cursor` is the offset of the next page.
function page(args, all, defaultLimit = 20) {
  if (args.cursor !== undefined && !/^\d{1,6}$/.test(args.cursor)) fail('invalid_arguments', 'cursor must be a next_cursor value from an earlier page.');
  const offset = args.cursor === undefined ? 0 : Number(args.cursor), limit = args.limit ?? defaultLimit;
  return { items: all.slice(offset, offset + limit), next_cursor: offset + limit < all.length ? String(offset + limit) : null };
}

// Newest first; notifications created at the same instant keep their creation order reversed.
function list(ctx, data, args) {
  const now = ms(ctx.virtual_now);
  const all = data.notifications.map((n, order) => ({ n, order }))
    .filter(({ n }) => (args.kind === undefined || n.kind === args.kind) && (args.state === undefined || notificationState(n, now) === args.state) && (args.since === undefined || ms(n.created_at) >= ms(args.since)))
    .sort((a, b) => ms(b.n.created_at) - ms(a.n.created_at) || b.order - a.order);
  const { items, next_cursor } = page(args, all);
  return { notifications: items.map(({ n }) => present(n, now)), next_cursor };
}

const presentPreferences = (data, now) => ({ ...data.preferences, in_quiet_hours: inQuietHours(data.preferences, now) });
function getPreferences(ctx, data) { return { preferences: presentPreferences(data, ms(ctx.virtual_now)) }; }
function updatePreferences(ctx, data, args) {
  const patch = args.patch, p = data.preferences;
  if (!Object.keys(patch).length) fail('invalid_arguments', 'patch needs at least one field.');
  if (patch.timezone !== undefined) {
    if (!validTimeZone(patch.timezone)) fail('invalid_timezone', 'Unknown time zone ' + patch.timezone + '. Use an IANA name such as America/Los_Angeles.');
    p.timezone = patch.timezone;
  }
  if (patch.quiet_hours !== undefined) {
    const next = { ...p.quiet_hours, ...patch.quiet_hours };
    if (next.start === next.end) fail('invalid_arguments', 'Quiet hours cannot start and end at the same time.');
    p.quiet_hours = next;
  }
  for (const key of ['email_notices', 'open_shift_notices']) if (patch[key] !== undefined) p[key] = patch[key];
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'preferences.update', object_id: data.account_id, request_id: args.request_id, details: { fields: Object.keys(patch) } });
  return { id: data.account_id, preferences: presentPreferences(data, ms(ctx.virtual_now)) };
}

module.exports = { record, inQuietHours, quietEnd, wireMessage, notify, present, page, list, getPreferences, updatePreferences };
