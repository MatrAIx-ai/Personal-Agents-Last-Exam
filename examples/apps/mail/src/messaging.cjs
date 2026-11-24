'use strict';
const {log}=require('./diagnostics.cjs');
// Convert an already authorized Router notification into Mail-owned records.
const {fail}=require('./domain-utils.cjs');
function receiveNotification(ctx,data,event){
  const {recipient_account_id,message}=event.payload;
  const body=message.data;
  if(recipient_account_id!==data.account_id)fail('invalid_seed','Recipient account does not belong to this mailbox');
  if(body.extensions?.some(extension=>extension.required))fail('invalid_event','Unsupported required message extension');
  const id=event.event_id;
  if(data.messages.some(x=>x.id===id))fail('already_exists','Message ID already exists');
  log(ctx,'mail.notification.validated',{message_id:id});
  data.messages.push({id,thread_id:message.id,account_id:data.account_id,from:(body.source_object.app_id==='mail'?body.source_object.account_id:body.source_object.app_id)+'@pale.example',to:[data.address],subject:body.content.title,body:body.content.body.text,received_at:event.at,folder:'inbox',read:false,attachments:[]});
  if(event.operation==='mail.receive_attachments'){const received=data.messages[data.messages.length-1];received.attachments=require('./attachments.cjs').add(ctx,received,body.content.attachments);}
  log(ctx,'mail.notification.prepared',{message_id:id});
  return data;
 }
module.exports={receiveNotification};
