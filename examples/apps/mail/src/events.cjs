'use strict';
const {log}=require('./diagnostics.cjs');
const {copy,fail}=require('./domain-utils.cjs');
const {receiveNotification}=require('./messaging.cjs');
function applyEvent(ctx,data,event){
 log(ctx,'mail.event.started',{event_id:event.event_id,operation:event.operation});
 if(['mail.receive_notification','mail.receive_attachments'].includes(event.operation))return receiveNotification(ctx,data,event);
 if(event.operation!=='mail.deliver')fail('invalid_event','Unknown Mail event.');
 if(event.payload.account_id!==data.account_id)fail('invalid_seed','Message account does not match this App instance.');
 if(data.messages.some(x=>x.id===event.payload.id))fail('already_exists','Message ID already exists.');
 log(ctx,'mail.deliver.validated',{message_id:event.payload.id});
 data.messages.push(copy(event.payload));log(ctx,'mail.deliver.prepared',{message_id:event.payload.id});return data;
}
module.exports={applyEvent};
