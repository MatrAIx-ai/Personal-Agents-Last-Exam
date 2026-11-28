'use strict';
// App-owned outbound adapter. Infra supplies trusted clients and account binding.
// Local mail.send and downstream delivery are distinct commits, not a durable outbox.
const cloudEvents=require('./message-envelope.cjs');
function notification(message,{sourceAccount,sourceEpoch,recipient,attachments=[]}){
 if(!Number.isSafeInteger(sourceEpoch)||sourceEpoch<1)throw new Error('Publishing requires the source epoch from the Mail MCP version');
 if(message.folder!=='sent'||message.account_id!==sourceAccount)throw new Error('Only this account\'s sent record can be published');
 if(message.to.length!==1||message.to[0]!==recipient.address)throw new Error('Mail recipient must match the trusted account binding');
 if(message.attachments.length!==attachments.length)throw new Error('Every attachment requires authorized bytes');
 // Local record IDs can repeat after reset; retries within an epoch keep one identity.
 const wire=cloudEvents.create({id:'mail-'+sourceEpoch+'-'+message.id,app:'mail',account:sourceAccount,type:'org.pale.mail.notification.v1',dataschema:'urn:pale:email-payload:1',time:message.sent_at,subject:message.id,data:{channel:'channel.email',recipient:{kind:'app_account_ref',app_id:'mail',id:recipient.account_id},source_object:{app_id:'mail',account_id:sourceAccount,object_type:'message',object_id:message.id},content:{title:message.subject,body:{format:'text/plain',text:message.body},asset_ids:[]},extensions:[]}});
 if(attachments.length){wire.type='org.pale.mail.attachments.v1';wire.dataschema='urn:pale:email-attachments-payload:1';wire.data.channel='channel.email.attachments';delete wire.data.content.asset_ids;wire.data.content.attachments=attachments;}
 return wire;
}
async function send({agent,router,messageId,requestId,sourceAccount,recipient}){
 const before=await agent.call('mail.get',{id:messageId});
 if(before.status!=='ok')return {stage:'source_read',result:before};
 const attachments=[];
 for(const asset_id of before.message.attachments){const r=await agent.call('mail.attachment.get',{id:messageId,asset_id});if(r.status!=='ok')return {stage:'source_attachment',result:r};attachments.push(r.file);}
 // Validate the binding before changing the local Sent folder.
 notification({...before.message,folder:'sent'},{sourceAccount,sourceEpoch:before.version.epoch,recipient,attachments});
 const sent=await agent.call('mail.send',{id:messageId,expected_version:before.version,request_id:requestId+'-local'});
 if(sent.status!=='committed')return {stage:'agent_authorization',local:sent,result:sent};
 const confirmed=await agent.call('mail.get',{id:messageId});
 if(confirmed.status!=='ok')return {stage:'source_confirmation',local:sent,result:confirmed};
 if(confirmed.version.epoch!==sent.version.epoch)return {stage:'source_confirmation',local:sent,result:{status:'rejected',code:'source_lifecycle_changed'}};
 const message=notification(confirmed.message,{sourceAccount,sourceEpoch:sent.version.epoch,recipient,attachments});
 const receipt=await router.call('router.publish',{request_id:requestId,message});
 return {stage:receipt.status==='committed'?'delivered':'router_rejected',local:sent,source:confirmed.message,message,request_id:requestId,result:receipt};
}
module.exports={notification,send};
