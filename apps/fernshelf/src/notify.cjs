'use strict';
// Notifications are written only inside an applied event, for what other people and the device
// did; never for the account holder's own writes and never for a change that time alone causes.
// When email notices are on at that moment, the notification also stores the full wire message
// for Mail's existing receive contract (urn:pale:email-message:2). Fernshelf never delivers it:
// the Infra-run sender (src/publisher.cjs) reads it from a snapshot.
const crypto = require('node:crypto');
const c = require('./common.cjs');

const KINDS = Object.freeze(['album.activity', 'removal.requested', 'removal.withdrawn', 'storage.threshold']);
const sourceURI = accountId => 'urn:pale:app:fernshelf:account:' + encodeURIComponent(accountId);
// The wire message ID is the notification ID plus a digest of what the notification says and which
// event caused it. Notification IDs restart after a Fernshelf-only reset, while the router and Mail
// deduplicate on (source, id): an identical notification produced again by the same event keeps its
// ID and is delivered once; a different notification that reuses the number gets a new ID.
const wireId = n => 'fernshelf-' + n.id + '-' + crypto.createHash('sha256')
  .update(JSON.stringify([n.event_id, n.at, n.kind, n.object_type, n.object_id, n.title, n.body])).digest('hex').slice(0, 16);
function wireMessage(data, n) {
  return {
    specversion: '1.0', id: wireId(n), source: sourceURI(data.account_id), type: 'org.pale.mail.notification.v1', time: n.at,
    datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: 'fernshelf', account_id: data.account_id, object_type: n.object_type, object_id: n.object_id},
      content: {title: n.title, body: {format: 'text/plain', text: n.body}, asset_ids: []},
      subscription_ref: data.account_id + ':' + n.kind,
      extensions: []
    }
  };
}
function notify(ctx, data, {kind, object_type, object_id, title, body, event_id, cause_seq, level = null}) {
  const n = {id: c.nextId(data.notifications.map(x => x.id), 'ntf-'), kind, at: ctx.virtual_now, title: title.slice(0, 200), body,
    object_type, object_id, event_id, level, wire: null};
  if (data.account.email_notices) n.wire = wireMessage(data, n);
  data.notifications.push(n);
  c.activity(ctx, data, {actor: 'event', action: 'effect.notification.written', object_ids: [n.id, object_id], event_id, cause_seq,
    details: {kind, ...(level !== null ? {level} : {})}});
  return n;
}
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const itemWord = (kinds, n) => plural(n, kinds.every(k => k === 'video') ? 'video' : kinds.every(k => k === 'photo') ? 'photo' : 'item');
module.exports = {KINDS, notify, wireMessage, wireId, sourceURI, plural, itemWord};
