'use strict';
// Notifications are created only when a write or business event commits; never on reads or clock movement.
const {log, triggerKey, notificationId, render} = require('./common.cjs');
const {quietRelease} = require('./time.cjs');

const ACTIVE = ['active', 'pending_start', 'pending_stop'];

// Withdraw held notifications for earlier versions of the same source (only the latest version is sent).
function supersede(data, kind, sourceId, version, now) {
  for (const n of data.notifications) {
    if (n.source.kind === kind && n.source.id === sourceId && (n.source.version ?? 0) < version &&
        n.status === 'held_quiet_hours' && Date.parse(now) < Date.parse(n.release_at)) n.status = 'withdrawn';
  }
}

// `account` marks a notice about the account's own money (a bill or plan), sent even after the premise's
// services have stopped; other premise notices reach the holder only while the account has a service there.
function notify(ctx, data, {type, source, premiseId = null, title, body, health = false, account = false}) {
  // A newer version of the same source withdraws held notices for earlier versions.
  supersede(data, source.kind, source.id, source.version ?? 0, ctx.virtual_now);
  if (premiseId && !account && !data.services.some(s => s.premise_id === premiseId && ACTIVE.includes(s.status))) return null;
  const prefs = data.preferences, recipient = data.owner_person_id;
  const key = triggerKey(type, source, recipient);
  if (data.notifications.some(n => n.trigger_key === key || n.notification_id === notificationId(key))) return null;
  const pref = prefs.types[type];
  if (!health && !pref.enabled) return null;
  // Health advisories always keep an in-app record; their delivery and quiet-hour bypass are configurable.
  const delivery = health ? prefs.health.delivery : pref.delivery, now = Date.parse(ctx.virtual_now), zone = prefs.time_zone;
  let status = 'in_app', release = null;
  if (delivery === 'mail') {
    release = quietRelease(now, zone, prefs.quiet_hours);
    if (release !== null && health && prefs.health.bypass_quiet_hours) release = null;
    status = release === null ? 'pending_delivery' : 'held_quiet_hours';
  }
  const n = {notification_id: notificationId(key), type, trigger_key: key, source, premise_id: premiseId, health,
    created_at: render(now, zone), release_at: release === null ? null : render(release, zone), delivery, status,
    title: title.slice(0, 200), body: body.slice(0, 2000), time: render(release === null ? now : release, zone),
    recipient_person_id: recipient, outcome: null, acknowledged_at: null};
  data.notifications.push(n);
  log(ctx, 'homegrid.notification_created', {notification_id: n.notification_id, type, status});
  return n;
}

module.exports = {notify, supersede};
