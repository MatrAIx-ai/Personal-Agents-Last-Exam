'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Client}=require('../../../runtime/client.cjs');
const root=path.resolve(__dirname,'../../..'),registry=path.join(root,'apps.registry.json');

test('Core reset restores the latest task-loaded baseline and virtual time',async()=>{
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'namegrove-reset-')),runId='namegrove-reset-proof',clients=[];
 try{
  const infra=new Client('namegrove-domains','infra',runId,stateDir,'namegrove-reset-infra',{registry,initialProfile:'sandbox'});clients.push(infra);await infra.initialize();
  const initial=await infra.call('env.snapshot'),taskData=structuredClone(initial.snapshot.data),taskTime='2026-11-25T13:30:00-08:00';taskData.settings.tax_basis_points=900;taskData.contact_profiles[0].label='Task-loaded primary contact';
  const loaded=await infra.call('env.load_seed',{expected_version:initial.version,request_id:'task-baseline',data:taskData,virtual_now:taskTime});assert.equal(loaded.status,'ready');
  const agent=new Client('namegrove-domains','agent',runId,stateDir,'namegrove-reset-agent',{registry});clients.push(agent);await agent.initialize();const beforeWrite=await infra.call('env.snapshot');
  const changed=await agent.call('namegrove-domains.domain.quote.create',{domain:'resetproof.bloom',years:1,contact_profile_id:'contact-primary',payment_method_id:'payment-amber',privacy:false,auto_renew:false,expected_version:beforeWrite.version,request_id:'reset-proof-write'});assert.equal(changed.status,'committed');
  const dirty=await infra.call('env.snapshot');assert.equal(dirty.snapshot.data.quotes.some(x=>x.domain==='resetproof.bloom'),true);
  const reset=await infra.call('env.reset',{expected_version:dirty.version});assert.equal(reset.status,'ready');const restored=await infra.call('env.snapshot');
  assert.deepEqual(restored.snapshot.data,taskData);assert.equal(restored.snapshot.virtual_now,taskTime);assert.ok(restored.version.epoch>dirty.version.epoch);assert.equal(restored.snapshot.data.settings.tax_basis_points,900);
 }finally{await Promise.allSettled(clients.map(x=>x.close()));fs.rmSync(stateDir,{recursive:true,force:true});}
});
