'use strict';
// Member notices and their Mail messages. Harbor writes the notice in its own state; the
// outbound tool builds Mail's wire message and Infra publishes it through Messaging.
const crypto = require('node:crypto');
const c = require('./common.cjs');

function notice(ctx, data, kind, title, body, ref) {
  const item = {id:c.nextId(c.recordIds(data), 'notice'), created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[],
    kind, title, body, ref};
  c.stamp(ctx, item, 'notice_' + kind);
  data.notices.push(item);
  return item;
}

function outbound(data, item) {
  if (data.mail_account_id === null) c.fail('invalid_state', 'This account has no Mail account to notify.');
  const payload = {channel:'channel.email', recipient:{kind:'app_account_ref', app_id:'mail', id:data.mail_account_id},
    source_object:{app_id:'harbor', account_id:data.account_id, object_type:'notice', object_id:item.id},
    content:{title:item.title, body:{format:'text/plain', text:item.body}, asset_ids:[]}, extensions:[]};
  // Stable retries; a different recipient or text produces a new event identity.
  const id = 'harbor-notice-' + crypto.createHash('sha256').update(JSON.stringify([item.id, payload])).digest('hex').slice(0, 40);
  return {specversion:'1.0', id, source:'urn:pale:app:harbor:account:' + encodeURIComponent(data.account_id),
    type:'org.pale.mail.notification.v1', time:item.created_at, datacontenttype:'application/json',
    dataschema:'urn:pale:email-payload:1', data:payload};
}

module.exports = {notice, outbound};
