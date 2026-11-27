'use strict';
// Real MCP integration: platform traces must work with unchanged App packages.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../../..'),{Client}=require('../../client.cjs');
const {create}=require('../src/router.cjs'),{run:mailToMail}=require('../../../examples/workflows/mail-to-mail/run.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),copy=x=>structuredClone(x);
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-time-trace-')),clients=[],evidence=[];
 const app=async(appId,run)=>{
  const c=new Client(appId,'infra',run,dir,'time-trace-review',{registry:path.join(root,'examples/registry.'+appId+'.json')});
  clients.push(c);await c.initialize();return c;
 };
 const logs=run=>fs.readFileSync(path.join(dir,run,'messaging.receipts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 try{
  const run='time-trace',router=new Client(null,null,null,null,'time-trace-publisher',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--publisher','delivery','--run',run,'--state-dir',dir]});
  clients.push(router);await router.initialize();
  const infra=await app('mail',run),before=await infra.call('env.snapshot');
  const sample=read('examples/workflows/delivery-to-mail/delivery/message.json');
  const wire=read('examples/apps/mail/schemas/router-message.schema.json');
  check(!wire.required.includes('time'),'App wire schema still permits absent time');
  const committed=[];
  for(const hasTime of [true,false]){
   const request_id=hasTime?'with-time':'without-time',message=copy(sample);message.id=request_id;
   if(hasTime)message.time='2026-11-15T08:42:12.345-08:00';else delete message.time;
   message.data.content.body.text='PRIVATE-BODY-FOR-TRACE-TEST access_token=DO-NOT-LOG';
   const receipt=await router.call('router.publish',{request_id,message});
   check(receipt.status==='committed',request_id+' delivered through MCP');
   check(timestamp(receipt.received_at)&&timestamp(receipt.committed_at),'Messaging records receive and acknowledged commit wall times');
   equal(receipt.applied_at,before.snapshot.virtual_now,'Producer time does not change the receiver clock');
   equal(Object.hasOwn(receipt.cloud_event,'time'),hasTime,'Original time presence is preserved, never invented');
   if(hasTime)equal(receipt.cloud_event.time,message.time,'Producer time retains its exact timezone and precision');
   const saved=await infra.call('env.event_status',{event_id:receipt.event_id}),snapshot=await infra.call('env.snapshot');
   const mail=snapshot.snapshot.data.messages.find(m=>m.id===receipt.event_id);
   const audit=snapshot.snapshot.audit.find(row=>row.tool==='env.apply_event'&&row.trace?.event_id===receipt.event_id);
   check(!!mail&&!!audit,'Receipt event ID joins to the Mail record and Core audit');
   equal(saved.receipt.trace,receipt.receiver_trace,'Messaging retains the exact persisted Core trace');
   equal(audit.trace,saved.receipt.trace,'Core audit and event status share the same trace');
   equal(audit.trace.cloud_event,receipt.cloud_event,'CloudEvents source/id/time join both platform layers');
   equal(audit.trace.run_id,run,'Trace has a trusted run binding');
   equal(audit.trace.app_id,'mail','Trace identifies the receiving App');
   check(timestamp(audit.trace.received_at)&&timestamp(audit.trace.processed_at),'Core records receipt and processing wall times');
   equal(mail.received_at,receipt.applied_at,'Mail business timestamp is the virtual application time');
   check(!Object.hasOwn(mail,'time')&&!Object.hasOwn(mail,'trace'),'Trace metadata is not added to the App business record');
   const row=logs(run).find(row=>row.request_id===request_id);
   equal(row.run_id,run,'Messaging audit carries its trusted run');
   equal(row.received_at,receipt.received_at,'First attempt receipt time joins the Messaging log');
   equal(row.cloud_event,receipt.cloud_event,'Metadata log retains source time when present');
   equal(row.result.receiver_trace,audit.trace,'Persisted Messaging log joins to Core audit');
   check(timestamp(row.wall_time),'Audit write has a separate wall timestamp');
   const repeated=await router.call('router.publish',{request_id:request_id+'-retry',message});
   check(repeated.duplicate,'Retry is identified');
   equal(repeated,{...receipt,duplicate:true},'Retry does not rewrite original receive, source or commit times');
   const retryRow=logs(run).at(-1);
   check(timestamp(retryRow.received_at)&&timestamp(retryRow.wall_time),'Retry has its own attempt timestamps');
   equal(retryRow.result.committed_at,receipt.committed_at,'Retry points back to the first commit');
   const changed=copy(message);changed.time='2027-01-01T00:00:00Z';
   const conflict=await router.call('router.publish',{request_id:request_id+'-changed',message:changed});
   check(conflict.code==='idempotency_conflict'&&!conflict.committed_at,'Changing source time under the same identity cannot rewrite history');
   const duplicateEvent=await infra.call('env.apply_event',{expected_version:before.version,event:{event_id:receipt.event_id,at:receipt.applied_at,operation:'mail.receive_notification',payload:{recipient_account_id:'mail-maya',message}}});
   check(duplicateEvent.duplicate,'Core independently deduplicates an identical event');
   equal(duplicateEvent.trace,receipt.receiver_trace,'Core retry retains the original trace');
   committed.push(receipt);
   evidence.push({case:request_id,cloud_event:receipt.cloud_event,messaging:row,core_audit:audit,mail:{id:mail.id,thread_id:mail.thread_id,received_at:mail.received_at},retry:retryRow});
  }
  const after=await infra.call('env.snapshot');
  equal(after.snapshot.data.messages.length,before.snapshot.data.messages.length+2,'Retries do not add duplicate mail');
  const invalid=copy(sample);invalid.id='invalid-time';invalid.time='2026-02-30T09:00:00Z';
  const rejected=await router.call('router.publish',{request_id:'invalid-time',message:invalid});
  check(rejected.code==='invalid_arguments'&&timestamp(rejected.received_at)&&!rejected.committed_at,'Malformed source time is rejected without a fabricated commit');
  equal((await infra.call('env.snapshot')).snapshot.data,after.snapshot.data,'Malformed time leaves App data unchanged');
  const logText=JSON.stringify(logs(run));
  check(!logText.includes('PRIVATE-BODY-FOR-TRACE-TEST')&&!logText.includes('DO-NOT-LOG'),'Time tracing does not log message bodies or credentials');
  await infra.close();
  const restarted=await app('mail',run);
  for(const receipt of committed)equal((await restarted.call('env.event_status',{event_id:receipt.event_id})).receipt.trace,receipt.receiver_trace,'Trace survives a receiver MCP restart');
  const snap=await restarted.call('env.snapshot'),badEvent={event_id:'failed-receive',at:snap.snapshot.virtual_now,operation:'mail.receive_notification',payload:{recipient_account_id:'wrong-account',message:sample}};
  const failed=await restarted.call('env.apply_event',{expected_version:snap.version,event:badEvent});
  check(failed.applied===false&&failed.trace.applied_at===null&&!failed.committed_at,'Core rejection has no application or commit timestamp');
  equal(failed.trace.cloud_event.time,sample.time,'Valid reported source time is retained on a rejected receiver attempt');
  equal((await restarted.call('env.snapshot')).snapshot.data,snap.snapshot.data,'Rejected receiver operation keeps business data unchanged');
  equal((await restarted.call('env.event_status',{event_id:badEvent.event_id})).receipt,null,'Rejected events have no committed receipt');

  // A real receiver commits, but its acknowledgement is lost. Preserve the event
  // ID for investigation without making the Router claim a confirmed commit.
  const uncertain=await create({publisher:'delivery',run:'lost-ack',stateDir:dir});clients.push(uncertain);
  const originalCall=Client.prototype.call;let lost;
  try{
   Client.prototype.call=async function(name,args){const result=await originalCall.call(this,name,args);if(name==='env.apply_event')throw new Error('Simulated lost acknowledgement');return result;};
   lost=await uncertain.call('router.publish',{request_id:'lost-ack',message:sample});
  }finally{Client.prototype.call=originalCall;}
  check(lost.status==='unknown'&&lost.event_id&&!lost.committed_at,'Unconfirmed delivery retains correlation ID but no commit claim');
  const inspector=await app('mail','lost-ack'),persisted=(await inspector.call('env.event_status',{event_id:lost.event_id})).receipt;
  check(persisted.status==='committed'&&persisted.trace.event_id===lost.event_id,'Unknown Router outcome can be traced to persisted receiver evidence');
  const unknownRow=logs('lost-ack').at(-1);
  equal(unknownRow.cloud_event,persisted.trace.cloud_event,'Unknown attempt and Core commit still join by event identity');
  evidence.push({case:'lost-ack',messaging:unknownRow,receiver_receipt:persisted});

  const calendar=await app('calendar','calendar-time'),calendarBefore=await calendar.call('env.snapshot'),event=read('examples/apps/calendar/examples/scenario.json');
  const calReceipt=await calendar.call('env.apply_event',{expected_version:calendarBefore.version,event});
  check(calReceipt.status==='committed'&&calReceipt.trace.cloud_event===null,'Core also traces Calendar events without a messaging envelope');
  equal(calReceipt.trace.applied_at,event.at,'Calendar application time follows the Infra event');
  equal((await calendar.call('env.event_status',{event_id:event.event_id})).receipt.trace,calReceipt.trace,'Calendar event trace persists without any App changes');
  evidence.push({case:'calendar-event',receiver_receipt:calReceipt});

  const m2m=await mailToMail({case:'allowed',subject:'Timestamp trace',body:'Synthetic local Mail-to-Mail check'}),sent=m2m.source.messages[0],delivery=m2m.execution.result;
  check(m2m.passed&&delivery.status==='committed','Existing Mail-to-Mail example still runs');
  equal(delivery.cloud_event.time,sent.sent_at,'Mail source sent_at joins to original CloudEvents time');
  equal(delivery.receiver_trace.cloud_event,delivery.cloud_event,'Mail-to-Mail Core and Messaging identities match');
  equal(m2m.observed.message.id,delivery.event_id,'Mail-to-Mail receipt resolves to the actual received mail');
  equal(m2m.observed.message.received_at,delivery.applied_at,'Mail-to-Mail virtual reception time matches the receipt');
  evidence.push({case:'mail-to-mail',source:{id:sent.id,sent_at:sent.sent_at},receipt:delivery,target:{id:m2m.observed.message.id,received_at:m2m.observed.message.received_at}});
  const report={passed:true,checks,node:process.version,verified_at:new Date().toISOString(),scope:'Core and Infra messaging only; App schemas unchanged; CloudEvents time remains optional.',evidence};
  if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: '+checks+' timestamp tracing, optional producer time, persisted receipts, retries, lost acknowledgements and Mail-to-Mail checks.');
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
