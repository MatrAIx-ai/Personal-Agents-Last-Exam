'use strict';
// Student notices and their Mail messages. Passage writes the notice in its own state together
// with the CloudEvent for Mail's receive contract (urn:pale:email-message:2, payload
// urn:pale:email-payload:1, unchanged). Infra reads it from env.snapshot and publishes it
// through Messaging; Passage never delivers mail itself.
const crypto = require('node:crypto');
const c = require('./common.cjs');

function message(data, item, mailAccountId) {
  const payload = {channel:'channel.email', recipient:{kind:'app_account_ref', app_id:'mail', id:mailAccountId},
    source_object:{app_id:'passage', account_id:data.account_id, object_type:item.ref.object_type, object_id:item.ref.object_id},
    content:{title:item.title, body:{format:'text/plain', text:item.body}, asset_ids:[]}, extensions:[]};
  // Stable retries; a different recipient or text produces a new event identity.
  const id = 'passage-notice-' + crypto.createHash('sha256').update(JSON.stringify([item.id, payload])).digest('hex').slice(0, 40);
  return {specversion:'1.0', id, source:'urn:pale:app:passage:account:' + encodeURIComponent(data.account_id),
    type:'org.pale.mail.notification.v1', time:item.created_at, datacontenttype:'application/json',
    dataschema:'urn:pale:email-payload:1', data:payload};
}

function notice(ctx, data, kind, title, body, ref) {
  const item = {id:c.nextId(data.notices, 'notice'), kind, created_at:ctx.virtual_now, title, body, ref, message:null};
  if (data.mail_account_id !== null) item.message = message(data, item, data.mail_account_id);
  data.notices.push(item);
  c.log(ctx, 'passage.notice_' + kind, {record_id:item.id, object_id:ref.object_id, mail:item.message !== null});
  return item;
}

module.exports = {notice, message};
