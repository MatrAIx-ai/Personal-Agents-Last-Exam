'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../../..'),{Client}=require('../../client.cjs'),{create}=require('../src/router.cjs');
const bindings=require('../src/bindings.cjs'),auth=require('../src/authorization.cjs'),config=require('../src/config.cjs'),ce=require('../../core/cloud-events.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),copy=x=>structuredClone(x);
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-messaging-v2-')),clients=[];
 try{
  const event=read('examples/workflows/delivery-to-mail/delivery/message.json'),configuration=read('examples/workflows/delivery-to-mail/config.json');
  check(ce.valid(event),'CloudEvents JSON profile validates actual fixture');
  check(event.specversion==='1.0'&&event.dataschema==='urn:pale:email-payload:1','CE version is 1.0; payload version belongs to Mail');
  check(config.valid(configuration),'runtime config v2 validates');
  const noGrant=copy(configuration);delete noGrant.publishers[0].allowed_recipients;check(!config.valid(noGrant),'missing explicit grant is rejected, even for same owner');
  const old=copy(configuration);old.schema_version=1;check(!config.valid(old),'old permissive config is not silently accepted');
  const source=configuration.publishers[0];check(!auth.allows({...source,allowed_recipients:[]},{app_id:'mail',account_id:'mail-maya',owner_person_id:source.owner_person_id},'channel.email'),'same person is not an authorization grant');
  const targets=[{channel:'channel.email',app_id:'mail',account_id:'a',owner_person_id:'person-maya'},{channel:'channel.email',app_id:'mail',account_id:'b',owner_person_id:'person-maya'}];
  check(bindings.resolve(targets,'channel.email',{kind:'person_ref',id:'person-maya'}).error==='ambiguous_recipient','ambiguous person never broadcasts');
  check(bindings.resolve(targets,'channel.email',{kind:'app_account_ref',app_id:'mail',id:'b'}).target.account_id==='b','explicit account disambiguates');
  check(bindings.resolve(targets,'channel.email',{kind:'person_ref',id:'missing'}).error==='recipient_unavailable','missing recipient rejected');
  assert.throws(()=>bindings.bind({entry:{},appId:'mail',snapshot:{run_id:'other',data:{account_id:'a'},binding:{accounts:[]}},run:'run'}));checks++;
  const payload=read('examples/apps/mail/schemas/email-payload.schema.json');
  for(const f of ['examples/apps/mail/schemas/router-message.schema.json','examples/workflows/delivery-to-mail/delivery/schemas/router-message.schema.json','runtime/contracts/schemas/router-message.schema.json']){assert.deepEqual(read(f).properties.data,payload);checks++;}
  const router=await create({publisher:'delivery',run:'ce-regression',stateDir:dir});clients.push(router);
  const infra=new Client('mail','infra','ce-regression',dir,'ce-tests',{registry:path.join(root,'examples/registry.mail.json')});clients.push(infra);await infra.initialize();
  const before=await infra.call('env.snapshot');
  const send=(message=event,request_id='first')=>router.call('router.publish',{request_id,message});
  for(const mutate of [e=>delete e.id,e=>e.specversion='1.0.2',e=>e.source='not a URI',e=>e.type='unknown',e=>e.dataschema='urn:wrong',e=>e.time='2026-02-30T09:00:00Z',e=>e.datacontenttype='text/plain',e=>e.data_base64='YWJj',e=>e.role='infra',e=>delete e.data.content,e=>e.data.content.asset_ids=['secret']]){
   const e=copy(event);mutate(e);check((await send(e)).code==='invalid_arguments','invalid CE/profile rejected');
  }
  const forged=copy(event);forged.source='urn:pale:app:mail:account:mail-maya';check((await send(forged)).code==='source_identity_mismatch','well-formed CE source cannot impersonate another authenticated source');
  const legacy={schema_version:'pale.notification.v1',notification_id:'old',...event.data};check((await send(legacy)).code==='invalid_arguments','legacy custom envelope rejected');
  check(JSON.stringify((await infra.call('env.snapshot')).snapshot.data)===JSON.stringify(before.snapshot.data),'invalid events never mutate receiver');
  const result=await send();check(result.status==='committed','CloudEvents delivered through real receiver MCP');
  check(result.cloud_event.source===event.source&&result.cloud_event.id===event.id,'receipt retains original CloudEvents identity');
  check(Number.isFinite(Date.parse(result.applied_at))&&Number.isFinite(Date.parse(result.committed_at)),'virtual application and wall commit timestamps are separate');
  const repeat=await send(copy(event),'different-request');check(repeat.duplicate&&repeat.event_id===result.event_id,'new request ID with same CloudEvents source/id is deduplicated');
  const changed=copy(event);changed.data.content.title='changed';check((await send(changed,'third-request')).code==='idempotency_conflict','same CloudEvents identity with changed payload is rejected');
  changed.id='new-event';check((await send(changed,'different-request')).code==='idempotency_conflict','duplicate request remains pinned to first event');
  const second=await send(changed,'new-request');check(second.status==='committed'&&second.event_id!==result.event_id,'new source/id can commit separately');
  const after=await infra.call('env.snapshot');check(after.snapshot.data.messages.length===before.snapshot.data.messages.length+2,'deduplication creates exactly two new records');
  const log=fs.readFileSync(path.join(dir,'ce-regression/messaging.receipts.jsonl'),'utf8');
  const rows=log.trim().split('\n').map(JSON.parse);check(rows.some(x=>x.result.code==='source_identity_mismatch')&&rows.some(x=>x.result.duplicate),'receipt log contains rejected and duplicate outcomes');
  check(!log.includes(event.data.content.body.text)&&!log.includes('access_token'),'receipt log excludes mail body and credentials');
  await infra.call('env.reset',{expected_version:after.version});check((await send()).code==='receiver_lifecycle_changed','reset invalidates event cache and target binding');
  const missing=copy(configuration);missing.publishers[0].allowed_recipients=[];const file=path.join(dir,'denied.json');fs.writeFileSync(file,JSON.stringify(missing));
  const denied=await create({config:file,publisher:'delivery',run:'same-owner-denied',stateDir:dir});clients.push(denied);check((await denied.call('router.publish',{request_id:'denied',message:event})).code==='recipient_not_authorized','actual same-owner delivery without grant is denied');
  console.log('PASS: '+checks+' Infra messaging CloudEvents, bindings, explicit authorization, receipts and lifecycle checks.');
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
