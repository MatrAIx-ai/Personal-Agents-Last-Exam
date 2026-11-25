'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{setup,committed}=require('./harness.cjs'),{makeReply}=require('../src/provider.cjs');
test('review: quote pricing uses only actual disclosed facts',t=>{
 const f=setup(t),provider=f.state.data.providers[0],old=provider.rules[0];
 committed(f.event('provider_rules_published',{provider_id:provider.id,rule:{...old,revision:2,required_fields:old.required_fields.filter(k=>k!=='annual_mileage'),ask_mileage:false},source_ref:'minimal-provider-fields'}));
 const app=f.state.data.applications[0],p=committed(f.write('disclosures.preview',{provider_id:provider.id,application_id:app.id,grant_id:'grant-a'})).preview;
 assert.equal(Object.hasOwn(p.payload,'annual_mileage'),false);committed(f.write('applications.amend',{id:app.id,preview_id:p.id}));
 const reply=makeReply({virtual_now:f.state.virtual_now},f.state.data,f.state.data.applications[0]);
 assert.equal(reply.terms.premium_cents,65000);assert.equal(reply.terms.discounts[0].status,'not_applied');
});
test('review: a required verification question cannot be silently skipped',t=>{
 const f=setup(t),d=structuredClone(f.state.data);d.requests=[];
 assert.equal(makeReply({virtual_now:f.state.virtual_now},d,d.applications[0]).terms.stage,'conditional');
});
test('review: one answer leaves other current questions unresolved and visible',t=>{
 const f=setup(t),app=f.state.data.applications[0],first=f.state.data.requests[0];
 committed(f.event('information_requested',{provider_id:app.provider_id,application_id:app.id,application_revision:1,request_id:'garage-question',fields:['garaging'],question:'Confirm garaging.',reply_by:first.reply_by,source_ref:'provider-garage-request'}));
 const p=committed(f.write('disclosures.preview',{provider_id:app.provider_id,application_id:app.id,information_request_id:first.id,grant_id:'grant-a'})).preview;
 committed(f.write('requests.reply',{id:first.id,preview_id:p.id}));assert.equal(f.state.data.applications[0].status,'needs_info');
 assert.equal(makeReply({virtual_now:f.state.virtual_now},f.state.data,f.state.data.applications[0]).terms.stage,'conditional');
});
test('review: withdrawn questions are closed in every Agent read surface',t=>{
 const f=setup(t),app=f.state.data.applications[0];committed(f.write('applications.withdraw',{id:app.id}));
 const workspace=f.call('agent','coverline.workspace.get').workspace,requests=f.call('agent','coverline.requests.list').requests;
 assert.equal(workspace.requests[0].display_status,'withdrawn');assert.equal(requests[0].display_status,'withdrawn');
});
test('review: invalid disclosure history is rejected before becoming the reset baseline',t=>{
 const f=setup(t),before=structuredClone(f.state.data),bad=structuredClone(before);bad.disclosures[0].payload.annual_mileage=99999;
 const result=f.call('infra','env.load_seed',{request_id:'bad-disclosure-history',expected_version:{epoch:f.state.epoch,revision:f.state.revision},data:bad});
 assert.notEqual(result.status,'ready');assert.deepEqual(f.state.data,before);
});
test('review: parent denial blocks original bytes and corrupt history imports roll back',t=>{
 const f=setup(t),before=structuredClone(f.state),asset=before.resources.bundle.catalog.assets[0].asset_id,restricted=structuredClone(before);
 restricted.policies.sandbox.constraints['coverline.documents.get']={ids:[]};
 assert.equal(f.p.model.resourceBytes(restricted,asset).status,'not_available');
 const bundle=structuredClone(before.resources.bundle);bundle.blobs[asset]=Buffer.from('corrupt original').toString('base64');
 const result=f.call('infra','env.load_seed',{request_id:'corrupt-history-original',expected_version:{epoch:before.epoch,revision:before.revision},data:before.data,bundle});
 assert.notEqual(result.status,'ready');assert.deepEqual(f.state.data,before.data);assert.deepEqual(f.state.resources,before.resources);
});
test('review: another question cannot suppress the required mileage request',async t=>{
 const f=setup(t),app=f.state.data.applications[0],p=committed(f.write('disclosures.preview',{provider_id:app.provider_id,application_id:app.id,grant_id:'grant-a'})).preview;committed(f.write('applications.amend',{id:app.id,preview_id:p.id}));
 committed(f.event('information_requested',{provider_id:app.provider_id,application_id:app.id,application_revision:2,request_id:'garage-only',fields:['garaging'],question:'Confirm garaging.',reply_by:f.state.data.requests[0].reply_by,source_ref:'garage-only'}));
 const g=committed(f.write('disclosures.preview',{provider_id:app.provider_id,application_id:app.id,information_request_id:'garage-only',grant_id:'grant-a'})).preview;committed(f.write('requests.reply',{id:'garage-only',preview_id:g.id}));
 await require('../examples/provider-actor.cjs').tick({call:(name,args)=>Promise.resolve(f.call('infra',name,args))});
 assert.ok(f.state.data.requests.some(q=>q.application_revision===2&&q.fields.includes('annual_mileage')&&q.status==='open'));assert.equal(f.state.data.quotes.at(-1).terms.stage,'conditional');
});
