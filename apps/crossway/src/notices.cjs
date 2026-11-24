'use strict';
// Outgoing Mail notices. Each committed write or event stores its notices in the
// same commit, as full CloudEvents messages for Mail 1.3.0's channel.email
// contract (urn:pale:email-message:2), with the outgoing record ID as the
// CloudEvents id. A host-side Messaging caller publishes them; Crossway does
// not record delivery. `at` is the time the notice is about: the deadline for a
// time effect, otherwise the write or event time.
const {nextId} = require('./ids.cjs');

function lines(fields) {
  return fields.filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n');
}

function money(cents) {
  const sign = cents < 0 ? '-' : '';
  return sign + '$' + (Math.abs(cents) / 100).toFixed(2);
}

function notify(data, {at, kind, title, fields, object_type, object_id}) {
  const id = nextId(data.outgoing, 'cw-notice');
  const message = {
    specversion: '1.0',
    id,
    source: `urn:pale:app:crossway:account:${data.account_id}`,
    type: 'org.pale.mail.notification.v1',
    time: at,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: 'crossway', account_id: data.account_id, object_type, object_id},
      content: {
        title: title.slice(0, 200),
        body: {format: 'text/plain', text: lines(fields)},
        asset_ids: [],
      },
      extensions: [],
    },
  };
  data.outgoing.push({id, kind, created_at: at, object_type, object_id, message});
  return id;
}

module.exports = {notify, money};
