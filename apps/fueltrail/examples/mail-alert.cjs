'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Client}=require('../../../runtime/client.cjs'),{send}=require('../src/mail.cjs');
const root=path.resolve(__dirname,'../../..'),registry=path.join(root,'apps.registry.json');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-fueltrail-mail-')),clients=[],runId='fueltrail-mail-example';
 try{
  const infra=new Client('fueltrail','infra',runId,dir,'fueltrail-infra',{registry,initialProfile:'sandbox'});clients.push(infra);await infra.initialize();
  const agent=new Client('fueltrail','agent',runId,dir,'fueltrail-agent',{registry});clients.push(agent);await agent.initialize();
  const before=await infra.call('env.snapshot');
  const created=await agent.call('fueltrail.price_alert.create',{area_id:'place-harbor',radius_milli:1000,grade:'regular',price_type:'credit',condition:'below_price',threshold_mills:3000,expected_version:before.version,request_id:'mail-example-alert'});
  assert.equal(created.status,'committed');
  const snap=await infra.call('env.snapshot'),applied=await infra.call('env.apply_event',{expected_version:snap.version,event:{event_id:'mail-example-price',at:'2026-11-23T09:00:00-08:00',operation:'fuel.price_observed',payload:{station_id:'station-01',grade:'regular',price_type:'credit',price_mills:2990,reason:'Mail integration example'}}});
  assert.equal(applied.status,'committed');
  const listed=await agent.call('fueltrail.price_alert.list',{include_deleted:false}),notification=listed.notifications.find(x=>x.alert_id===created.id);assert.ok(notification);
  const mailInfra=new Client('mail','infra',runId,dir,'fueltrail-mail-clock',{registry,initialProfile:'sandbox'});clients.push(mailInfra);await mailInfra.initialize();
  const mailBefore=await mailInfra.call('env.snapshot');
  const mailAdvanced=await mailInfra.call('env.advance_time',{expected_version:mailBefore.version,virtual_now:'2026-11-23T09:00:00-08:00',request_id:'mail-example-clock'});assert.equal(mailAdvanced.status,'committed');
  const router=new Client(null,null,null,null,'fueltrail-router',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',path.join(__dirname,'mail-config.json'),'--publisher','fueltrail','--run',runId,'--state-dir',dir]});clients.push(router);await router.initialize();
  const delivered=await send({agent,router,notificationId:notification.id,requestId:'fueltrail-mail-route'});assert.equal(delivered.stage,'delivered');
  const mail=new Client('mail','agent',runId,dir,'fueltrail-mail-reader',{registry});clients.push(mail);await mail.initialize();
  const received=await mail.call('mail.get',{id:delivered.result.event_id});assert.equal(received.status,'ok');assert.equal(received.message.body,notification.body);assert.equal(received.message.received_at,'2026-11-23T09:00:00-08:00');
  const final=await agent.call('fueltrail.price_alert.list',{include_deleted:false}),saved=final.notifications.find(x=>x.id===notification.id);assert.equal(saved.email_status,'delivered');
  return {passed:true,notification:saved,router_receipt:delivered.result,mail_record:received.message};
 }finally{await Promise.allSettled(clients.map(x=>x.close()));fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().then(report=>{console.log(JSON.stringify(report,null,2));console.log('PASS: Fueltrail price alert delivered to real Mail receiver.');}).catch(e=>{console.error(e);process.exitCode=1;});
