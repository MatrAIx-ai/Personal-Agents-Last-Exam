'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Client}=require('../../../runtime/client.cjs');
const root=path.resolve(__dirname,'../../..');
function file(name,mime_type){const b=fs.readFileSync(path.join(__dirname,name));return {filename:name,mime_type,base64:b.toString('base64'),sha256:crypto.createHash('sha256').update(b).digest('hex')};}
function message(){const m=structuredClone(require('../delivery-to-mail/delivery/message.json'));m.id='order-with-files';m.type='org.pale.mail.attachments.v1';m.dataschema='urn:pale:email-attachments-payload:1';m.data.channel='channel.email.attachments';delete m.data.content.asset_ids;m.data.content.attachments=[file('receipt.pdf','application/pdf'),file('delivery.ics','text/calendar')];return m;}
async function run(){
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'pale-attachments-')),clients=[],runId='attachment-demo';
 async function open(app,role){const c=new Client(app,role,runId,state,'attachment-demo');clients.push(c);await c.initialize();return c;}
 try{
  const mi=await open('mail','infra'),ci=await open('calendar','infra');
  await ci.call('env.reset',{expected_version:(await ci.call('env.snapshot')).version,profile:'sandbox'});
  const router=new Client(null,null,null,null,'delivery',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',path.join(__dirname,'config.json'),'--publisher','delivery','--run',runId,'--state-dir',state]});clients.push(router);await router.initialize();
  const ma=await open('mail','agent'),ca=await open('calendar','agent'),m=message(),before=await mi.call('env.snapshot');
  const receipt=await router.call('router.publish',{request_id:'order-notification',message:m});assert.equal(receipt.status,'committed',JSON.stringify(receipt));
  const mail=await ma.call('mail.get',{id:receipt.event_id});assert.equal(mail.message.attachments.length,2);
  const files=[];for(const id of mail.message.attachments){const r=await ma.call('mail.attachment.get',{id:mail.message.id,asset_id:id});assert.equal(r.status,'ok',JSON.stringify(r));files.push(r.file);const raw=await ma.request('resources/read',{uri:'pale://'+runId+'/mail/assets/'+id});assert.equal(raw.result.contents[0].blob,r.file.base64);}
  for(const f of files)assert.equal(f.sha256,m.data.content.attachments.find(a=>a.filename===f.filename).sha256);
  const calBefore=await ci.call('env.snapshot'),imported=await ca.call('calendar.import_ics',{text:Buffer.from(files.find(f=>f.mime_type==='text/calendar').base64,'base64').toString(),expected_version:calBefore.version,request_id:'import-window'});assert.equal(imported.status,'committed',JSON.stringify(imported));
  const added=await ca.call('calendar.attachment.add',{id:imported.id,files:[files.find(f=>f.mime_type==='application/pdf')],expected_version:imported.version,request_id:'attach-receipt'});assert.equal(added.status,'committed',JSON.stringify(added));
  const event=await ca.call('calendar.get',{id:imported.id});assert.equal(event.event.attachments.length,1);
  const calendarFile=await ca.call('calendar.attachment.get',{id:imported.id,asset_id:event.event.attachments[0]});assert.equal(calendarFile.file.sha256,files[0].sha256);
  const duplicate=await router.call('router.publish',{request_id:'notification-retry',message:m});assert.equal(duplicate.duplicate,true);
  const after=await mi.call('env.snapshot');assert.equal(after.snapshot.data.messages.length,before.snapshot.data.messages.length+1);assert.equal(after.snapshot.resources.bundle.catalog.assets.length,before.snapshot.resources.bundle.catalog.assets.length+2);
  return {passed:true,steps:['Independent order publisher sends PDF and ICS through Messaging','Mail commits notification and authorized attachment bytes together','Agent reads exact attachment bytes from Mail','Agent imports the ICS into Calendar and attaches the receipt','Repeated notification has one effect'],mail_id:mail.message.id,calendar_id:imported.id,files:files.map(({filename,mime_type,sha256})=>({filename,mime_type,sha256})),receipt};
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(state,{recursive:true,force:true});}
}
module.exports={file,message,run};if(require.main===module)run().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
