'use strict';
const c=require('./common.cjs'),cloudEvents=require('./message-envelope.cjs');
function message(data,notification,requestId){
 if(!data.settings.email_alerts_enabled||!data.settings.mail_account_id)c.fail('not_available','Mail alerts are not configured for this account.');
 const alert=c.find(data.price_alerts,notification.alert_id,'Alert');
 return cloudEvents.create({id:'fueltrail-'+notification.id,app:'fueltrail',account:data.account_id,type:'org.pale.mail.notification.v1',dataschema:'urn:pale:email-payload:1',time:notification.triggered_at,subject:notification.id,data:{channel:'channel.email',recipient:{kind:'app_account_ref',app_id:'mail',id:data.settings.mail_account_id},source_object:{app_id:'fueltrail',account_id:data.account_id,object_type:'price_alert',object_id:alert.id},content:{title:notification.title,body:{format:'text/plain',text:notification.body},asset_ids:[]},extensions:[{namespace:'org.pale.fueltrail.delivery',version:'1',required:false,data:{request_id:requestId,notification_id:notification.id}}]}});
}
async function send({agent,router,notificationId,requestId}){
 const listed=await agent.call('fueltrail.price_alert.list',{include_deleted:true});if(listed.status!=='ok')return {stage:'source_read',result:listed};
 const notification=listed.notifications.find(x=>x.id===notificationId);if(!notification)return {stage:'source_read',result:{status:'not_found'}};
 const prepared=await agent.call('fueltrail.notification.email.prepare',{id:notificationId,router_request_id:requestId,expected_version:listed.version,request_id:requestId+'-prepare'});
 if(prepared.status!=='committed')return {stage:'prepare',result:prepared};
 let receipt,status='unknown';
 try{receipt=await router.call('router.publish',{request_id:requestId,message:prepared.message});status=receipt.status==='committed'?'delivered':'rejected';}catch(error){receipt={status:'unknown',message:error.message};}
 const recorded=await agent.call('fueltrail.notification.email.record',{id:notificationId,router_request_id:requestId,delivery_status:status,receipt_id:receipt.receipt_id||receipt.event_id||receipt.request_id||null,reconciled:false,expected_version:prepared.version,request_id:requestId+'-record'});
 return {stage:status,result:receipt,local:recorded,message:prepared.message};
}
async function reconcile({agent,router,notificationId,requestId}){
 const listed=await agent.call('fueltrail.price_alert.list',{include_deleted:true});if(listed.status!=='ok')return {stage:'source_read',result:listed};
 const notification=listed.notifications.find(x=>x.id===notificationId);if(!notification||notification.email_status!=='unknown'||notification.email_request_id!==requestId)return {stage:'not_reconcilable',result:{status:'invalid_state'}};
 const receipt=await router.call('router.publish',{request_id:requestId,message:notification.email_message});const status=receipt.status==='committed'?'delivered':'rejected';
 const recorded=await agent.call('fueltrail.notification.email.record',{id:notificationId,router_request_id:requestId,delivery_status:status,receipt_id:receipt.receipt_id||receipt.event_id||receipt.request_id||null,reconciled:true,expected_version:listed.version,request_id:requestId+'-reconcile'});
 return {stage:status,result:receipt,local:recorded};
}
module.exports={message,send,reconcile};
