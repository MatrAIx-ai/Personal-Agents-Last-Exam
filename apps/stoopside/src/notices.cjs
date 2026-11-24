'use strict';
// The user's outgoing notices and the delivery history for every member.
//
// Each committed write or event that creates a notice for the user stores it in
// data.notices in the same commit. A notice holds a full CloudEvents message for
// Mail 1.3.0's channel.email receive contract (urn:pale:email-message:2), with
// the notice ID as the CloudEvents id. A host-side Messaging caller publishes
// it (examples/publish-to-mail.cjs); Stoopside does not record delivery to Mail.
//
// Deliveries to members (the user included) are history rows in
// data.deliveries: recipient, object, channel and time. Deliveries to other
// members are never sent anywhere; they are what the visibility record reads.
const {nextId} = require('./ids.cjs');

function lines(fields) {
  return fields.filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n');
}

function notify(data, {at, kind, title, fields, object_type, object_id}) {
  const id = nextId(data.notices, 'st-notice');
  const message = {
    specversion: '1.0',
    id,
    source: `urn:pale:app:stoopside:account:${data.account_id}`,
    type: 'org.pale.mail.notification.v1',
    time: at,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: 'stoopside', account_id: data.account_id, object_type, object_id},
      content: {
        title: title.slice(0, 200),
        body: {format: 'text/plain', text: lines(fields)},
        asset_ids: [],
      },
      extensions: [],
    },
  };
  data.notices.push({id, kind, created_at: at, object_type, object_id, message});
  return id;
}

function seq(data) {
  return data.next_seq++;
}

// One delivery row per recipient, in recipient ID order.
function deliver(data, {at, recipients, object_type, object_id, channel, reason}) {
  let n = Number(nextId(data.deliveries, 'dl').slice(3));
  for (const recipient of [...new Set(recipients)].sort()) {
    data.deliveries.push({id: 'dl-' + String(n++).padStart(4, '0'), seq: seq(data), at, recipient_member_id: recipient,
      object_type, object_id, channel, reason});
  }
}

module.exports = {notify, deliver, seq, lines};
