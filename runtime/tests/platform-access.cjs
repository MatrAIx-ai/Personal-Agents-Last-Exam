'use strict';
const assert=require('node:assert/strict'),{createRuntime}=require('../core/runtime.cjs');
const runtime=createRuntime();let checks=0;
for(const app of ['mail','calendar']){
 const s=runtime.create(app,'platform-access'),pkg=runtime.get(app);
 assert.equal(typeof pkg.plugin.authorizeResource,'undefined');checks++;
 const asset=s.resources.bundle.catalog.assets.find(a=>a.access.rule==='parent_object'&&a.availability.status==='ready');
 assert.ok(asset);checks++;assert.equal(runtime.resource(s,asset.asset_id).status,'ok');checks++;
 const denied=structuredClone(s);denied.policies[denied.profile].allow=[];
 // A contributor cannot grant access by adding the old hook back.
 pkg.plugin.authorizeResource=()=>true;
 assert.equal(runtime.resource(denied,asset.asset_id).status,'not_available');checks++;
 delete pkg.plugin.authorizeResource;
 const wrong=structuredClone(asset);wrong.subjects.forEach(x=>x.account_id='another-account');
 assert.equal(runtime.resource(s,asset.asset_id,[wrong]).status,'not_available');checks++;
 const unknown=structuredClone(asset);unknown.subjects.forEach(x=>x.object_type='not-approved');
 assert.equal(runtime.resource(s,asset.asset_id,[unknown]).status,'not_available');checks++;
}
console.log('PASS: '+checks+' platform-owned attachment authorization and contributor hook bypass checks.');
