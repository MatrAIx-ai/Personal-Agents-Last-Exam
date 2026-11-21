'use strict';
// A publisher fixture, not a complete ordering service. The receiver is real Mail.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Client}=require('../../../runtime/client.cjs');
const root=path.resolve(__dirname,'../../..');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-delivery-to-mail-')),clients=[];
 try{
  const router=new Client(null,null,null,null,'delivery-example',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--publisher','delivery','--run','delivery-example','--state-dir',dir]});clients.push(router);await router.initialize();
  const agent=new Client('mail','agent','delivery-example',dir,'mail-reader',{registry:path.join(root,'examples/registry.mail.json')});clients.push(agent);await agent.initialize();
  const message=JSON.parse(fs.readFileSync(path.join(__dirname,'delivery/message.json'))),receipt=await router.call('router.publish',{request_id:'delivery-example',message});
  assert.equal(receipt.status,'committed');const received=await agent.call('mail.get',{id:receipt.event_id});assert.equal(received.status,'ok');assert.equal(received.message.body,message.data.content.body.text);
  const duplicate=await router.call('router.publish',{request_id:'delivery-retry',message});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.event_id,receipt.event_id);
  return {passed:true,source:'delivery publisher fixture',receiver:'mail',receipt,received,duplicate};
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().then(report=>{console.log(JSON.stringify(report,null,2));console.log('PASS: 5 Delivery-to-Mail real MCP checks.');}).catch(e=>{console.error(e);process.exitCode=1;});
