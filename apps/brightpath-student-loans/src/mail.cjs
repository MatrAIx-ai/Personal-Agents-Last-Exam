'use strict';
const c=require('./common.cjs'),cloudEvents=require('./message-envelope.cjs');
function message(data,notice,requestId){
  if(!data.settings.mail_enabled||!data.settings.mail_account_id)c.fail('not_available','Mail is not configured for this borrower account.');
  return cloudEvents.create({id:'brightpath-'+notice.id,app:'brightpath-student-loans',account:data.account_id,type:'org.pale.mail.notification.v1',dataschema:'urn:pale:email-payload:1',time:notice.created_at,subject:notice.id,data:{channel:'channel.email',recipient:{kind:'app_account_ref',app_id:'mail',id:data.settings.mail_account_id},source_object:{app_id:'brightpath-student-loans',account_id:data.account_id,object_type:'loan_notice',object_id:notice.id},content:{title:notice.title,body:{format:'text/plain',text:notice.body},asset_ids:[]},extensions:[{namespace:'org.pale.brightpath.delivery',version:'1',required:false,data:{request_id:requestId,notice_id:notice.id}}]}});
}
async function send({agent,router,noticeId,requestId}){
  const listed=await agent.call('brightpath-student-loans.loan.notices.list',{include_acknowledged:true});if(listed.status!=='ok')return {stage:'source_read',result:listed};
  const notice=listed.notices.find(x=>x.id===noticeId);if(!notice)return {stage:'source_read',result:{status:'not_found'}};
  const prepared=await agent.call('brightpath-student-loans.notice.email.prepare',{id:noticeId,router_request_id:requestId,notice_version:notice.version,expected_version:listed.version,request_id:requestId+'-prepare'});
  if(prepared.status!=='committed')return {stage:'prepare',result:prepared};
  let receipt,status='unknown';
  try{receipt=await router.call('router.publish',{request_id:requestId,message:prepared.message});status=receipt.status==='committed'?'delivered':'rejected';}catch(error){receipt={status:'unknown',message:error.message};}
  const recorded=await agent.call('brightpath-student-loans.notice.email.record',{id:noticeId,router_request_id:requestId,delivery_status:status,receipt_id:receipt.receipt_id||receipt.event_id||receipt.request_id||null,reconciled:false,notice_version:prepared.notice.version,expected_version:prepared.version,request_id:requestId+'-record'});
  return {stage:status,result:receipt,local:recorded,message:prepared.message};
}
async function reconcile({agent,router,noticeId,requestId}){
  const listed=await agent.call('brightpath-student-loans.loan.notices.list',{include_acknowledged:true});if(listed.status!=='ok')return {stage:'source_read',result:listed};
  const notice=listed.notices.find(x=>x.id===noticeId);if(!notice||notice.email_status!=='unknown'||notice.email_request_id!==requestId)return {stage:'not_reconcilable',result:{status:'invalid_state'}};
  const receipt=await router.call('router.publish',{request_id:requestId,message:notice.email_message});const status=receipt.status==='committed'?'delivered':'rejected';
  const recorded=await agent.call('brightpath-student-loans.notice.email.record',{id:noticeId,router_request_id:requestId,delivery_status:status,receipt_id:receipt.receipt_id||receipt.event_id||receipt.request_id||null,reconciled:true,notice_version:notice.version,expected_version:listed.version,request_id:requestId+'-reconcile'});
  return {stage:status,result:receipt,local:recorded};
}
module.exports={message,send,reconcile};
