'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Client}=require('../../../runtime/client.cjs'),mailFlow=require('../src/mail.cjs');
const root=path.resolve(__dirname,'../../..'),registry=path.join(root,'apps.registry.json');
async function run(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-brightpath-mail-')),clients=[],runId='brightpath-mail-example';
  try{
    const brightInfra=new Client('brightpath-student-loans','infra',runId,dir,'brightpath-clock',{registry,initialProfile:'sandbox'});clients.push(brightInfra);await brightInfra.initialize();
    const mailInfra=new Client('mail','infra',runId,dir,'mail-clock',{registry,initialProfile:'sandbox'});clients.push(mailInfra);await mailInfra.initialize();
    for(const [client,key] of [[brightInfra,'bright-clock'],[mailInfra,'mail-clock']]){const snap=await client.call('env.snapshot');const advanced=await client.call('env.advance_time',{expected_version:snap.version,virtual_now:'2026-11-18T10:00:00-08:00',request_id:key});assert.equal(advanced.status,'committed');}
    const agent=new Client('brightpath-student-loans','agent',runId,dir,'brightpath-agent',{registry});clients.push(agent);await agent.initialize();
    const router=new Client(null,null,null,null,'brightpath-router',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',path.join(__dirname,'mail-config.json'),'--publisher','brightpath-student-loans','--run',runId,'--state-dir',dir]});clients.push(router);await router.initialize();
    const deniedRouter=new Client(null,null,null,null,'brightpath-denied-router',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',path.join(__dirname,'mail-config-no-grant.json'),'--publisher','brightpath-student-loans','--run',runId,'--state-dir',dir]});clients.push(deniedRouter);await deniedRouter.initialize();
    const receipt=await mailFlow.send({agent,router,noticeId:'notice-receipt',requestId:'route-receipt'});assert.equal(receipt.stage,'delivered');
    const decision=await mailFlow.send({agent,router,noticeId:'notice-decision',requestId:'route-decision'});assert.equal(decision.stage,'delivered');
    const duplicate=await router.call('router.publish',{request_id:'route-decision-transport-retry',message:decision.message});assert.equal(duplicate.status,'committed');assert.equal(duplicate.duplicate,true);
    const lostAckRouter={call:async(name,args)=>{await router.call(name,args);throw Error('Synthetic lost acknowledgement after receiver commit');}};
    const unknown=await mailFlow.send({agent,router:lostAckRouter,noticeId:'notice-missing-info',requestId:'route-missing'});assert.equal(unknown.stage,'unknown');assert.equal(unknown.local.notice.reconciliation_required,true);
    const reconciled=await mailFlow.reconcile({agent,router,noticeId:'notice-missing-info',requestId:'route-missing'});assert.equal(reconciled.stage,'delivered');assert.equal(reconciled.result.duplicate,true);
    const denied=await mailFlow.send({agent,router:deniedRouter,noticeId:'notice-payment-failed',requestId:'route-denied'});assert.equal(denied.stage,'rejected');
    const mail=new Client('mail','agent',runId,dir,'mail-reader',{registry});clients.push(mail);await mail.initialize();
    const destination=[];for(const sent of [receipt,decision]){const record=await mail.call('mail.get',{id:sent.result.event_id});assert.equal(record.status,'ok');destination.push(record.message);}
    const missing=await mail.call('mail.get',{id:reconciled.result.event_id});assert.equal(missing.status,'ok');destination.push(missing.message);assert.equal(destination.length,3);assert.ok(destination.every(x=>x.received_at==='2026-11-18T10:00:00-08:00'));
    const final=await agent.call('brightpath-student-loans.loan.notices.list',{include_acknowledged:true});const state=Object.fromEntries(final.notices.filter(x=>['notice-receipt','notice-decision','notice-missing-info','notice-payment-failed'].includes(x.id)).map(x=>[x.id,{email_status:x.email_status,reconciliation_required:x.reconciliation_required,delivery_attempts:x.delivery_attempts}]));assert.equal(state['notice-missing-info'].reconciliation_required,false);assert.equal(state['notice-payment-failed'].email_status,'rejected');
    return {passed:true,producer_virtual_time:'2026-11-18T10:00:00-08:00',sender_state:state,router_receipts:{receipt:receipt.result,decision:decision.result,duplicate,lost_ack_reconciliation:reconciled.result,grant_denied:denied.result},destination_records:destination.map(x=>({id:x.id,folder:x.folder,subject:x.subject,received_at:x.received_at,thread_id:x.thread_id}))};
  }finally{await Promise.allSettled(clients.map(x=>x.close()));fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().then(report=>{console.log(JSON.stringify(report,null,2));console.log('PASS: Brightpath sender state, receipts, real Mail records, duplicate, denial, and lost-ack reconciliation.');}).catch(e=>{console.error(e);process.exitCode=1;});
