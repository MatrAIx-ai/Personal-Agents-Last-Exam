'use strict';
// Outgoing notices. Each committed write or event stores its notices in the
// same commit; a host-side Messaging caller publishes them to Mail's
// channel.email contract (urn:pale:email-message:2) using the notice ID as the
// CloudEvents id. Switchback does not record delivery.
const {iso} = require('./clock.cjs');
const {nextId} = require('./ids.cjs');

function lines(fields) {
  return fields.filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n');
}

function money(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function notify(ctx, data, {kind, title, fields, object_type, object_id}) {
  const id = nextId(data.notices, 'sb-notice');
  const message = {
    specversion: '1.0',
    id,
    source: `urn:pale:app:switchback:account:${data.account_id}`,
    type: 'org.pale.mail.notification.v1',
    time: ctx.virtual_now,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: 'switchback', account_id: data.account_id, object_type, object_id},
      content: {
        title: title.slice(0, 200),
        body: {format: 'text/plain', text: lines(fields)},
        asset_ids: [],
      },
      extensions: [],
    },
  };
  data.notices.push({id, kind, created_at: ctx.virtual_now, object_type, object_id, message});
  return id;
}

module.exports = {notify, money, iso};
