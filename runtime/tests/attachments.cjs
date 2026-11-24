'use strict';
const crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRuntime}=require('../core/runtime.cjs'),{Client}=require('../client.cjs');
const samples=require('../../examples/workflows/attachments/run.cjs'),publisher=require('../../examples/apps/mail/src/publisher.cjs');
const root=path.resolve(__dirname,'../..'),model=createRuntime();let count=0;
function eq(a,b,label){assert.deepEqual(a,b,label);count++;}
function ok(a,label){assert.ok(a,label);count++;}
function signature(s){return {data:s.data,resources:s.resources,version:model.version(s)};}
function write(s,name,args,id='request'){return model.execute(s,'agent',name,{...args,request_id:id,expected_version:model.version(s)});}
(async()=>{
 for(const app of ['mail','calendar']){
  let state=model.create(app,'files-'+app,'sandbox');const baseline=structuredClone(state),record=app==='mail'?'materials':'evt-review';
  let id=record;if(app==='mail'){const d=write(state,'mail.draft.create',{to:['test@example.com'],subject:'Receipt',body:'Synthetic receipt'});state=d.state;id=d.result.id;}
  const start=structuredClone(state),file=samples.file('receipt.pdf','application/pdf');
  const added=write(state,app+'.attachment.add',{id,files:[file]},'add');eq(added.result.status,'committed',app+' commits PDF');state=added.state;
  const ids=app==='mail'?state.data.messages.find(m=>m.id===id).attachments:state.data.events.find(e=>e.id===id).attachments;
  const assetId=ids.at(-1);eq(model.resourceBytes(state,assetId).blob,file.base64,app+' exact PDF bytes');
  const read=model.execute(state,'agent',app+'.attachment.get',{id,asset_id:assetId});eq(read.result.file.sha256,file.sha256,app+' exported hash');eq(signature(read.state),signature(state),app+' read preserves state');
  const retry=model.execute(state,'agent',app+'.attachment.add',{id,files:[file],request_id:'add',expected_version:model.version(start)});ok(retry.result.duplicate,app+' duplicate request');eq(signature(retry.state),signature(state),app+' retry does not add files');
  const bad=structuredClone(file);bad.sha256='0'.repeat(64);const denied=write(state,app+'.attachment.add',{id,files:[bad]},'bad');eq(denied.result.status,'invalid_attachment',app+' rejects bad integrity');eq(signature(denied.state),signature(state),app+' no partial attachment');
  const changed=structuredClone(file);changed.filename='../escape.pdf';eq(write(state,app+'.attachment.add',{id,files:[changed]},'path').result.status,'invalid_arguments',app+' rejects paths');
  const wrongType=structuredClone(file);wrongType.mime_type='image/png';eq(write(state,app+'.attachment.add',{id,files:[wrongType]},'mime').result.status,'invalid_attachment',app+' verifies MIME bytes');
  const huge=Buffer.from('x'.repeat(1024*1024-10)),large={filename:'large.txt',mime_type:'text/plain',base64:huge.toString('base64'),sha256:crypto.createHash('sha256').update(huge).digest('hex')};
  const oversized=write(state,app+'.attachment.add',{id,files:[large]},'oversized');eq(oversized.result.status,'invalid_bundle',app+' enforces total bundle limit');eq(signature(oversized.state),signature(state),app+' oversized write rolls back');
  const repeated=write(state,app+'.attachment.add',{id,files:[file,file]},'repeated');eq(repeated.result.status,'invalid_attachment',app+' duplicate file input rejected');eq(signature(repeated.state),signature(state),app+' duplicate input leaves state unchanged');
  const removed=write(state,app+'.attachment.remove',{id,asset_id:assetId},'remove');eq(removed.result.status,'committed',app+' removes attachment');eq(model.resourceBytes(removed.state,assetId).status,'not_available',app+' detached bytes are not exposed');
  const restricted=structuredClone(state);restricted.policies.sandbox.constraints[app+'.get']={ids:[]};eq(model.execute(restricted,'agent',app+'.attachment.get',{id,asset_id:assetId}).result.status,'not_available',app+' parent permissions gate bytes');
  const reset=model.execute(state,'infra','env.reset',{expected_version:model.version(state)});eq(reset.state.resources.bundle,baseline.resources.bundle,app+' reset restores original assets');eq(model.resourceBytes(reset.state,assetId).status,'not_available',app+' reset removes imported asset');
 }
 // Corrupt second file after the first was staged: neither the new record nor bytes commit.
 let s=model.create('mail','bad-event');const event={event_id:'receipt-with-bad-second-file',at:s.virtual_now,operation:'mail.receive_attachments',payload:{recipient_account_id:s.data.account_id,message:samples.message()}};
 event.payload.message.data.content.attachments[1].sha256='0'.repeat(64);
 const bad=model.execute(s,'infra','env.apply_event',{expected_version:model.version(s),event});eq(bad.result.status,'invalid_attachment','bad second attachment rejects delivery');eq(signature(bad.state),signature(s),'mail and all staged bytes roll back together');ok(!bad.state.receipts['event:'+event.event_id],'no false event receipt');
 const readPkg=model.get('mail'),old=readPkg.plugin.handleTool;
 try{readPkg.plugin.handleTool=(ctx,data)=>{ctx.assets.add({object_id:'materials',object_type:'message',files:[samples.file('receipt.pdf','application/pdf')]});return {data,result:{message:data.messages[0]}};};eq(model.execute(s,'agent','mail.get',{id:'materials'}).result.status,'invalid_plugin_result','read-only handler cannot import hidden bytes');}finally{readPkg.plugin.handleTool=old;}
 // Real two-Mail transfer: source reads authorized bytes; receiver gets its own IDs.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pale-mail-files-')),clients=[];
 async function open(role,namespace){const c=new Client('mail',role,'two-mail',path.join(temp,namespace),'mail-files',{registry:path.join(root,'examples/registry.mail.json')});clients.push(c);await c.initialize();return c;}
 try{
  const source=await open('infra','source'),target=await open('infra','destination');let initial=await source.call('env.snapshot');
  await source.call('env.reset',{expected_version:initial.version,profile:'sandbox'});const agent=await open('agent','source'),receiver=await open('agent','destination');initial=await source.call('env.snapshot');
  const targetStart=await target.call('env.snapshot'),draft=await agent.call('mail.draft.create',{to:[targetStart.snapshot.data.address],subject:'Forwarded receipt',body:'The actual PDF travels with this email.',expected_version:initial.version,request_id:'draft'});eq(draft.status,'committed','MCP draft');
  const sourceBundle=model.get('mail').bundle,transfer=[samples.file('receipt.pdf','application/pdf'),...sourceBundle.catalog.assets.filter(a=>a.availability.status==='ready'&&a.roles.some(r=>r==='content.attachment'||r==='content.inline')).map(a=>({filename:path.basename(a.storage.path),mime_type:a.mime_type,base64:sourceBundle.blobs[a.asset_id],sha256:a.integrity.sha256,media:a.media||{}}))];
  const attach=await agent.call('mail.attachment.add',{id:draft.id,files:transfer,expected_version:draft.version,request_id:'attach'});eq(attach.status,'committed','MCP attach');
  const sourceRecord=await agent.call('mail.get',{id:draft.id}),config=structuredClone(require('../../examples/workflows/mail-to-mail/router.json'));config.receiver_state_namespace='destination';config.publishers[0].account_id=initial.snapshot.data.account_id;config.publishers[0].allowed_recipients=[{app_id:'mail',account_id:targetStart.snapshot.data.account_id,channel:'channel.email.attachments'}];
  const conf=path.join(temp,'config.json');fs.writeFileSync(conf,JSON.stringify(config));
  const router=new Client(null,null,null,null,'mail-files-router',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',conf,'--publisher','mail','--run','two-mail','--state-dir',temp]});clients.push(router);await router.initialize();
  const oversizedMessage=samples.message();oversizedMessage.data.content.body.text='x'.repeat(2*1024*1024);const started=Date.now();await assert.rejects(router.call('router.publish',{request_id:'oversized',message:oversizedMessage}),/oversized/);count++;ok(Date.now()-started<5000,'oversized frame returns a transport error without timeout');
  const sent=await publisher.send({agent,router,messageId:draft.id,requestId:'send',sourceAccount:initial.snapshot.data.account_id,recipient:{account_id:targetStart.snapshot.data.account_id,address:targetStart.snapshot.data.address}});eq(sent.result.status,'committed','Mail to Mail attachment commits');
  const received=await receiver.call('mail.get',{id:sent.result.event_id}),asset=received.message.attachments[0];ok(asset!==sourceRecord.message.attachments[0],'receiver owns a fresh parent-scoped ID');
  const bytes=await receiver.call('mail.attachment.get',{id:received.message.id,asset_id:asset});eq(bytes.file.base64,samples.file('receipt.pdf','application/pdf').base64,'receiver reads exact PDF');
  eq(received.message.attachments.length,transfer.length,'all image/audio/video/observation attachments arrive');
  for(const asset_id of received.message.attachments){const r=await receiver.call('mail.attachment.get',{id:received.message.id,asset_id});const expected=transfer.find(f=>f.filename===r.file.filename);eq(r.file.base64,expected.base64,'exact '+expected.mime_type+' bytes');}
  ok((await receiver.request('resources/read',{uri:'pale://two-mail/mail/assets/'+sourceRecord.message.attachments[0]})).error,'source asset ID cannot be read in receiver');
  const before=await target.call('env.snapshot'),duplicate=await router.call('router.publish',{request_id:'retry',message:sent.message});ok(duplicate.duplicate,'attachment delivery deduplicates');eq((await target.call('env.snapshot')).version,before.version,'retry does not reimport files');
  const deniedConfig=structuredClone(require('../../examples/workflows/attachments/config.json'));deniedConfig.publishers[0].allowed_recipients=[];const deniedConf=path.join(temp,'denied.json');fs.writeFileSync(deniedConf,JSON.stringify(deniedConfig));
  const denial=new Client(null,null,null,null,'denied-files',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',deniedConf,'--publisher','delivery','--run','denied-files','--state-dir',temp]});clients.push(denial);await denial.initialize();
  const beforeDenied=JSON.parse(fs.readFileSync(path.join(temp,'denied-files/mail.json')));const reject=await denial.call('router.publish',{request_id:'no-grant',message:samples.message()});eq(reject.code,'recipient_not_authorized','attachment channel needs an explicit grant');eq(signature(JSON.parse(fs.readFileSync(path.join(temp,'denied-files/mail.json')))),signature(beforeDenied),'unauthorized delivery cannot import any bytes');
  // Source credentials cannot expand to management calls.
  eq((await agent.call('env.load_seed',{})).status,'permission_denied','upload does not expose history loading');
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(temp,{recursive:true,force:true});}
 console.log('PASS: '+count+' attachment integrity, permissions, rollback, reset and Mail-to-Mail checks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
