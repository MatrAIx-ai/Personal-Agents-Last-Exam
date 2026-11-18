'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Client}=require('../client.cjs'),root=path.resolve(__dirname,'../..'),fixture=path.join(__dirname,'fixtures/non-mail');
let count=0;const check=(v,m)=>{assert.ok(v,m);count++;};
(async()=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'pale-non-mail-')),clients=[];
 const publisher=async(run,config=path.join(fixture,'config.json'))=>{const c=new Client(null,null,null,null,'non-mail-source',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',config,'--publisher','delivery','--run',run,'--state-dir',state]});clients.push(c);await c.initialize();return c;};
 try{
  const router=await publisher('notice'),agent=new Client('noticebox','agent','notice',state,'notice-reader',{registry:path.join(fixture,'registry.json')});clients.push(agent);await agent.initialize();
  const message=JSON.parse(fs.readFileSync(path.join(fixture,'message.json'))),cap=await router.call('router.capabilities');
  check(cap.app_messaging.direction==='publish-only','publisher is independently send-only');
  check(cap.channels[0].channel==='channel.test-notice','channel comes from the custom declaration');
  const receipt=await router.call('router.publish',{request_id:'notice-1',message});check(receipt.status==='committed','non-Mail receiver actually commits');
  check(receipt.target.app_id==='noticebox'&&receipt.target.account_id==='noticebox-maya','explicit account resolves to the declared non-Mail receiver');
  const observed=await agent.call('noticebox.list',{});check(observed.items.length===1&&observed.items[0].text===message.data.content.text,'receiver business handler writes its own item schema');
  check(receipt.cloud_event.time===message.time&&receipt.receiver_trace.cloud_event.id===message.id,'time and event identity trace across the custom route');
  const duplicate=await router.call('router.publish',{request_id:'notice-retry',message});check(duplicate.duplicate&&duplicate.event_id===receipt.event_id,'custom receiver receives only once');
  check((await agent.call('noticebox.list',{})).items.length===1,'retry has no second item');
  const changed=structuredClone(message);changed.data.content.text='Different';check((await router.call('router.publish',{request_id:'notice-changed',message:changed})).code==='idempotency_conflict','changed retry fails');
  changed.id='other';changed.data.channel='channel.email';check((await router.call('router.publish',{request_id:'wrong-channel',message:changed})).code==='invalid_arguments','Mail channel cannot masquerade as custom channel');
  check((await agent.call('env.apply_event',{})).status==='permission_denied','receiver Agent cannot use delivery management API');
  check(!fs.existsSync(path.join(state,'notice/mail.json')),'Mail is not instantiated or used');
  const config=JSON.parse(fs.readFileSync(path.join(fixture,'config.json')));config.publishers[0].allowed_recipients=[];const deniedFile=path.join(state,'denied.json');fs.writeFileSync(deniedFile,JSON.stringify(config));
  const denied=await publisher('denied',deniedFile);check((await denied.call('router.publish',{request_id:'denied',message})).code==='recipient_not_authorized','no grant rejects a non-Mail destination too');
  const stored=JSON.parse(fs.readFileSync(path.join(state,'denied/noticebox.json')));check(stored.data.items.length===0,'denied custom delivery leaves target empty');
  console.log('PASS: '+count+' custom-channel, non-Mail receiver, authorization and trace checks.');
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(state,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
