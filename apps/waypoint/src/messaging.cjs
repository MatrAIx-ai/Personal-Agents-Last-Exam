'use strict';
// Loyalty-credit messages. The sender builds a stable CloudEvent from its own transfer record;
// the host publishes it through Messaging. Receiving is the household-combine side.
const crypto = require('node:crypto');
const c = require('./common.cjs');
const {account} = require('./model.cjs');

function payload(data, t) {
  return {channel:'channel.loyalty-credit', recipient:{kind:'app_account_ref', app_id:t.recipient.app_id, id:t.recipient.account_id},
    source_object:{app_id:'waypoint', account_id:data.account_id, object_type:t.kind === 'partner_transfer' ? 'transfer' : 'combine', object_id:t.id},
    content:{kind:t.kind, member_person_id:t.kind === 'partner_transfer' ? data.owner_person_id : t.to_person_id,
      member_number:t.member_number, points:t.points, base_points:t.base_points, bonus_pct:t.bonus_pct},
    extensions:[]};
}

// Same transfer → same event identity, so a republish is deduplicated by Messaging.
function outbound(ctx, data, t) {
  if (t.status === 'rejected') c.fail('invalid_state', 'A rejected transfer is not delivered again.');
  if (t.status === 'pending' && c.ms(ctx.virtual_now) < c.ms(t.available_at)) c.fail('not_due', 'This transfer is released at ' + t.available_at + '.');
  const data_ = payload(data, t);
  const id = 'credit-' + crypto.createHash('sha256').update(JSON.stringify([t.id, data_])).digest('hex').slice(0, 40);
  return {specversion:'1.0', id, source:'urn:pale:app:waypoint:account:' + encodeURIComponent(data.account_id),
    type:'org.pale.loyalty.credit.v1', time:t.created_at, datacontenttype:'application/json',
    dataschema:'urn:pale:loyalty-credit:1', data:data_};
}

// Household combine received from another member's Waypoint account.
function receive(ctx, data, event) {
  const {recipient_account_id, message} = event.payload, body = message.data;
  if (recipient_account_id !== data.account_id || body.recipient.app_id !== 'waypoint' || body.recipient.id !== data.account_id) {
    c.fail('invalid_event', 'Wrong receiving account.');
  }
  if (body.content.kind !== 'household_combine' || body.source_object.object_type !== 'combine') c.fail('invalid_event', 'Waypoint receives household combines only.');
  const sender = account(ctx, 'waypoint', body.source_object.account_id);
  const member = sender && data.household.find(m => m.person_id === sender.owner_person_id && m.waypoint_account_id === sender.account_id);
  if (!member || body.content.member_person_id !== data.owner_person_id) c.fail('permission_denied', 'Points can be combined only from another member of this household.');
  if (data.ledger.some(r => r.id === event.event_id)) c.fail('already_exists', 'Delivered credit already exists.');
  c.post(ctx, data, {id:event.event_id, kind:'combine_in', points:body.content.points, description:'Combined from ' + member.name,
    ref:{kind:'message', id:body.source_object.object_id, app_id:'waypoint', account_id:sender.account_id, message_id:message.id, sent_at:message.time ?? null}});
  return data;
}

module.exports = {outbound, receive, payload};
