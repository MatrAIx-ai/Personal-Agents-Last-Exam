'use strict';
// Notifications are written only inside an applied event, for what other people did.
// When email notices are on at that moment, the notification also stores the full wire
// message for Mail's existing receive contract (urn:pale:email-message:2). Bellnote never
// delivers it: an Infra-run sender (src/publisher.cjs) reads it from a snapshot.
const c = require('./common.cjs');
const KINDS = Object.freeze(['attendance.unexplained', 'absence.reviewed', 'form.published', 'form.changed', 'form.answered',
  'pickup.person_reviewed', 'dismissal.recorded', 'dismissal.void', 'lunch.low_balance', 'lunch.refund', 'school.day_changed']);
const sourceURI = accountId => 'urn:pale:app:bellnote:account:' + encodeURIComponent(accountId);
function wireMessage(data, n) {
  return {
    specversion: '1.0', id: n.id, source: sourceURI(data.account_id), type: 'org.pale.mail.notification.v1', time: n.at,
    datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: 'bellnote', account_id: data.account_id, object_type: n.object_type, object_id: n.object_id},
      content: {title: n.title.slice(0, 200), body: {format: 'text/plain', text: n.body}, asset_ids: []},
      subscription_ref: data.account_id + ':' + n.kind,
      extensions: []
    }
  };
}
function notify(ctx, data, {kind, child_id = null, object_type, object_id, title, body, event_id, cause_seq}) {
  if (!KINDS.includes(kind)) c.fail('invalid_state', 'Unknown notification kind ' + kind);
  const n = {id: c.nextId(data.notifications, 'ntf'), kind, at: ctx.virtual_now, child_id, object_type, object_id,
    title, body, event_id, wire: null};
  if (data.preferences.email_notices) n.wire = wireMessage(data, n);
  data.notifications.push(n);
  c.activity(ctx, data, {actor: 'event', action: 'effect.notification.written', child_id, object_id: n.id, event_id, cause_seq});
  return n;
}
// Human-readable helpers for notification text.
const money = cents => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);
function longDate(date) {
  const [y, m, d] = date.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'});
}
module.exports = {KINDS, notify, wireMessage, sourceURI, money, longDate};
