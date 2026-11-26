'use strict';
// W4 Notifications and the digest, the Mail wire message and the account preferences.
// A notification is written once, when a revision arrives, with its release time: that
// moment, the end of the quiet period it was written in, or the next daily digest time.
// Nothing is rewritten when that time passes; `held` and `released` are read from the
// release time and the supplied clock. Belltower never delivers anything itself: an
// Infra-run sender (infra/sender.cjs) reads notifications from a snapshot and publishes the
// stored wire messages through Messaging.
const { fail, ms, isoAt, localDate, localMinutes, localToInstant, addDays, dayMonth, sentence, nextId, page } = require('./util.cjs');
const { KIND_OF, index, contentOf, notificationState, ruleMatches, quietAt, preferencesProblem, usedIds } = require('./model.cjs');
const { record } = require('./activity.cjs');

// ---- quiet hours and the digest ----------------------------------------------------
const inQuietHours = (preferences, t) => preferences.quiet_hours.enabled && quietAt(preferences.quiet_hours, localMinutes(t, preferences.timezone));
// The first instant at or after `t` at which the wall clock of the account shows `hhmm`.
function nextAt(preferences, t, hhmm) {
  const tz = preferences.timezone, day = localDate(t, tz), today = localToInstant(day, hhmm, tz);
  return today >= t ? today : localToInstant(addDays(day, 1), hhmm, tz);
}
// End of the quiet period that contains instant `t`: its end time is the next one after `t`.
const quietEnd = (preferences, t) => nextAt(preferences, t + 1, preferences.quiet_hours.end);
// The next daily digest time at or after `t`.
const nextDigest = (preferences, t) => nextAt(preferences, t, preferences.digest_time);

// ---- wording ----------------------------------------------------------------------
// Title and body of the notification for one arriving revision. A publisher's note is quoted
// as the publisher wrote it; the day is the day the item was first published, in the
// account's time zone.
function wording(data, ix, item, revision) {
  const source = ix.sources.get(item.source_id), c = contentOf(item, revision), n = revision.number;
  const noun = item.kind === 'notice' ? 'notice' : 'article', day = dayMonth(ms(item.revisions[0].published_at), data.preferences.timezone);
  const earlier = n === 2 ? 'the earlier version' : 'the earlier versions', tail = ' This is revision ' + n + '. Open Belltower for ';
  if (revision.type === 'original') return { title: c.headline, body: source.name + ' published ' + (noun === 'article' ? 'an article' : 'a notice') + ' on ' + day + ': ' + sentence(c.headline) + tail + 'the full text.' };
  if (revision.type === 'update') return { title: 'Update: ' + c.headline, body: source.name + ' updated its ' + noun + ' of ' + day + ': ' + sentence(c.headline) + tail + 'the full text and ' + earlier + '.' };
  const note = ' Publisher\'s note: ' + sentence(revision.note);
  if (revision.type === 'correction') return { title: 'Correction: ' + c.headline, body: source.name + ' corrected its ' + noun + ' of ' + day + '.' + note + tail + 'the full text and ' + earlier + '.' };
  return { title: 'Retracted: ' + c.headline, body: source.name + ' retracted its ' + noun + ' of ' + day + '.' + note + tail + earlier + '.' };
}

// Full CloudEvents wire message for Mail's receive declaration (urn:pale:email-message:2).
function wireMessage(data, notification, subscription) {
  return {
    specversion: '1.0',
    id: notification.id,
    source: 'urn:pale:app:belltower:account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1',
    time: notification.release_at,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: { kind: 'person_ref', id: data.owner_person_id },
      source_object: { app_id: 'belltower', account_id: data.account_id, object_type: 'item', object_id: notification.item_id },
      content: { title: notification.title, body: { format: 'text/plain', text: notification.body }, asset_ids: [] },
      subscription_ref: data.account_id + ':' + subscription,
      extensions: [],
    },
  };
}

// ---- a revision arrives -------------------------------------------------------------
// Whoever was told is told again. When a revision arrives at the event's time, the account
// gets exactly one notification if an active rule matches it, or the account already holds a
// notification for that item, or it watches a clipping of it; otherwise none. Returns the
// notification, or null.
function arrive(data, ix, item, revision, event) {
  const at = event.at, T = ms(at), preferences = data.preferences;
  const matched = data.follows.filter(rule => ruleMatches(ix, rule, item, revision));
  const earlier = data.notifications.filter(n => n.item_id === item.id), previous = earlier[earlier.length - 1];
  const watched = data.clippings.find(c => c.item_id === item.id && c.watch);
  const reasons = [...(matched.length ? ['follow'] : []), ...(previous ? ['earlier_notification'] : []), ...(watched ? ['watched_clipping'] : [])];
  if (!reasons.length) return null;

  // Delivery: immediate when a matching rule is immediate, when the account watches the item,
  // when the item's previous notification was immediate, or for a correction or a retraction
  // under the `corrections: immediate` preference; otherwise digest.
  const correction = revision.type === 'correction' || revision.type === 'retraction';
  const immediate = matched.some(rule => rule.delivery === 'immediate') || Boolean(watched) || (previous !== undefined && previous.delivery === 'immediate')
    || (correction && preferences.corrections === 'immediate');
  // Release: quiet hours hold an immediate notification to their end unless the revision is
  // urgent; a digest notification waits for the next digest time, urgent or not.
  const urgent = contentOf(item, revision).priority === 'urgent';
  const release = immediate ? (!urgent && inQuietHours(preferences, T) ? quietEnd(preferences, T) : T) : nextDigest(preferences, T);

  const notification = {
    id: nextId(usedIds(data), 'ntf-'), seq: 0, kind: KIND_OF[revision.type], item_id: item.id, revision: revision.number, created_at: at,
    release_at: release === T ? at : isoAt(release, preferences.timezone), delivery: immediate ? 'immediate' : 'digest', reasons,
    matched_follow_ids: matched.map(rule => rule.id),
  };
  // A replaced version is not put in front of the person: a notification for this item that is
  // still held at T is superseded and never released. One whose release time has been
  // reached was released; it is left as it is and is followed by the new one.
  if (previous !== undefined && ms(previous.release_at) > T) {
    previous.superseded_by = notification.id;
    previous.superseded_at = at;
    notification.supersedes = previous.id;
    record(data, { at, actor: 'event', action: 'notification.superseded', object_id: previous.id, event_id: event.event_id, details: { item_id: item.id, revision: previous.revision, by: notification.id } });
  }
  const text = wording(data, ix, item, revision);
  notification.title = text.title.slice(0, 200);
  notification.body = text.body.slice(0, 2000);
  notification.cause = { event_id: event.event_id };
  // The wire message is stored only when email notices are on at this moment, dated at the release time.
  if (preferences.email_notices) notification.wire = wireMessage(data, notification, matched.length ? matched[0].id : watched ? watched.id : 'earlier-notification');
  data.notifications.push(notification);
  notification.seq = record(data, {
    at, actor: 'event', action: 'notification.created', object_id: notification.id, event_id: event.event_id,
    details: { kind: notification.kind, item_id: item.id, revision: revision.number, delivery: notification.delivery, release_at: notification.release_at, reasons },
  });
  return notification;
}

// ---- reads and preferences -----------------------------------------------------------
function present(notification, now) {
  return {
    id: notification.id, kind: notification.kind, state: notificationState(notification, now), item_id: notification.item_id, revision: notification.revision,
    created_at: notification.created_at, release_at: notification.release_at, delivery: notification.delivery, reasons: notification.reasons,
    matched_follow_ids: notification.matched_follow_ids, supersedes: notification.supersedes ?? null, superseded_by: notification.superseded_by ?? null,
    title: notification.title, body: notification.body, email_prepared: notification.wire !== undefined,
  };
}

// Newest first; notifications created at the same instant keep their creation order reversed.
function list(ctx, data, args) {
  const now = ms(ctx.virtual_now);
  if (args.id !== undefined && !index(data).items.has(args.id)) fail('not_found', 'Unknown item ' + args.id + '.');
  const start = args.start === undefined ? -Infinity : ms(args.start), end = args.end === undefined ? Infinity : ms(args.end);
  if (!(end > start)) fail('invalid_window', 'end must be after start.');
  const all = data.notifications.map((n, order) => ({ n, order }))
    .filter(({ n }) => (args.id === undefined || n.item_id === args.id) && (args.kind === undefined || n.kind === args.kind)
      && (args.state === undefined || notificationState(n, now) === args.state) && ms(n.created_at) >= start && ms(n.created_at) < end)
    .sort((a, b) => ms(b.n.created_at) - ms(a.n.created_at) || b.order - a.order);
  const { items, next_cursor } = page(args, all);
  return { notifications: items.map(({ n }) => present(n, now)), next_cursor };
}

function presentPreferences(data, now) {
  const p = data.preferences;
  return { timezone: p.timezone, quiet_hours: p.quiet_hours, digest_time: p.digest_time, corrections: p.corrections, email_notices: p.email_notices, in_quiet_hours: inQuietHours(p, now), next_digest_at: isoAt(nextDigest(p, now), p.timezone) };
}
function getPreferences(ctx, data) { return { preferences: presentPreferences(data, ms(ctx.virtual_now)) }; }
function updatePreferences(ctx, data, args) {
  const patch = args.patch, fields = Object.keys(patch), p = data.preferences;
  if (!fields.length) fail('invalid_arguments', 'patch needs at least one field.');
  const next = { ...p, ...patch, quiet_hours: { ...p.quiet_hours, ...(patch.quiet_hours || {}) } };
  const problem = preferencesProblem(next);
  if (problem) fail(problem.code, problem.message);
  data.preferences = { timezone: next.timezone, quiet_hours: { enabled: next.quiet_hours.enabled, start: next.quiet_hours.start, end: next.quiet_hours.end }, digest_time: next.digest_time, corrections: next.corrections, email_notices: next.email_notices };
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'preferences.update', object_id: data.account_id, request_id: args.request_id, details: { fields } });
  return { id: data.account_id, preferences: presentPreferences(data, ms(ctx.virtual_now)) };
}

module.exports = { inQuietHours, quietEnd, nextDigest, wording, wireMessage, arrive, present, list, getPreferences, updatePreferences };
