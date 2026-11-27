'use strict';
// Notifications are created only when a business event commits, by subscription evaluation; never on reads
// or clock movement. Title, body and time are frozen at creation, so a retry sends identical bytes.
const {log, triggerKey, notificationId, render, zone} = require('./common.cjs');
const {quietRelease} = require('./time.cjs');

const OPEN = ['held_quiet_hours'];
// A held notice is withdrawn when a newer version of its source arrives, or when an event resolves its cause.
function withdraw(data, test, now) {
  for (const n of data.notifications) if (OPEN.includes(n.status) && Date.parse(now) < Date.parse(n.release_at) && test(n)) n.status = 'withdrawn';
}
const resolve = (data, sourceId, now) => withdraw(data, n => n.source.id === sourceId, now);
// Has this subscription already told the person about the source (a notice that was not withdrawn)?
const told = (data, sub, sourceId) => data.notifications.some(n => n.subscription_id === sub.subscription_id && n.source.id === sourceId && n.status !== 'withdrawn');

function notify(ctx, data, sub, {source: cause, title, body, urgent = false}) {
  if (sub.status !== 'active') return null;
  const source = {kind: cause.kind, id: cause.id, version: cause.version ?? 0};
  withdraw(data, n => n.subscription_id === sub.subscription_id && n.source.id === source.id && (n.source.version ?? 0) < (source.version ?? 0), ctx.virtual_now);
  const recipient = data.owner_person_id, key = triggerKey(sub.subscription_id, source, recipient), id = notificationId(key);
  if (data.notifications.some(n => n.trigger_key === key || n.notification_id === id)) return null;
  const now = Date.parse(ctx.virtual_now), tz = zone(data);
  let status = 'in_app', release = null;
  if (sub.delivery === 'mail') {
    release = quietRelease(now, tz, sub.quiet_hours);
    if (release !== null && urgent && sub.urgent_override) release = null;
    status = release === null ? 'pending_delivery' : 'held_quiet_hours';
  }
  const n = {notification_id: id, subscription_id: sub.subscription_id, trigger_key: key, source, urgent, created_at: render(now, tz),
    release_at: release === null ? null : render(release, tz), delivery: sub.delivery, status, title: title.slice(0, 200), body: body.slice(0, 2000),
    time: render(release === null ? now : release, tz), recipient_person_id: recipient, outcome: null, acknowledged_at: null};
  data.notifications.push(n);
  log(ctx, 'hopline.notification_created', {notification_id: id, status});
  return n;
}

module.exports = {notify, resolve, told, withdraw};
