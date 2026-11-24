'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRuntime}=require('../core/runtime.cjs');
test('task clock loads an earlier start and reset restores that exact baseline',()=>{
 const m=createRuntime(),s=m.create('mail','clock','sandbox');
 const baseline='2024-01-01T08:00:00+09:00';
 const loaded=m.execute(s,'infra','env.load_seed',{expected_version:m.version(s),data:s.data,virtual_now:baseline,request_id:'clock-baseline'});
 assert.equal(loaded.result.status,'ready');assert.equal(loaded.state.virtual_now,baseline);
 const event=structuredClone(require('../../examples/apps/mail/examples/scenario.json'));event.at='2024-02-01T08:00:00+09:00';
 const advanced=m.execute(loaded.state,'infra','env.apply_event',{expected_version:m.version(loaded.state),event});
 assert.equal(advanced.result.status,'committed');assert.equal(advanced.state.virtual_now,event.at);
 const reset=m.execute(advanced.state,'infra','env.reset',{expected_version:m.version(advanced.state)});
 assert.equal(reset.result.status,'ready');assert.equal(reset.state.virtual_now,baseline);
 const bad=m.execute(reset.state,'infra','env.load_seed',{expected_version:m.version(reset.state),data:s.data,virtual_now:'not-a-date'});
 assert.equal(bad.result.status,'invalid_arguments');assert.equal(bad.state.virtual_now,baseline);
 const denied=m.execute(s,'agent','env.load_seed',{expected_version:m.version(s),data:s.data,virtual_now:baseline});
 assert.equal(denied.result.status,'permission_denied');
});
test('clock changes participate in seed idempotency',()=>{
 const m=createRuntime(),s=m.create('mail','retry-clock');
 const args={expected_version:m.version(s),data:s.data,virtual_now:'2024-01-01T00:00:00Z',request_id:'same'};
 const loaded=m.execute(s,'infra','env.load_seed',args);
 assert.equal(m.execute(loaded.state,'infra','env.load_seed',args).result.duplicate,true);
 assert.equal(m.execute(loaded.state,'infra','env.load_seed',{...args,virtual_now:'2025-01-01T00:00:00Z'}).result.status,'idempotency_conflict');
});
test('Core delegates data migration to an App and validates the result',()=>{
 const m=createRuntime(),s=m.create('mail'),pkg=m.get('mail'),old=pkg.plugin.migrateState;
 const input={...s,package_version:'1.2.0'};
 assert.equal(m.normalize(input).package_version,'1.3.0');assert.equal(input.package_version,'1.2.0');
 try{pkg.plugin.migrateState=raw=>({...raw,data:{}});assert.throws(()=>m.normalize(input));}finally{pkg.plugin.migrateState=old;}
});
test('new App resource registration needs a read tool and retains policy boundaries',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pale-registration-'));
 const {load}=require('../core/registration.cjs'),{allowed}=require('../core/resource-access.cjs');
 const tools=[{name:'shop.order.get',read_only:true},{name:'shop.order.pay',read_only:false}];
 const file=path.join(directory,'shop.json');
 try{
  const asset={asset_id:'receipt',scope:{app_id:'shop'},access:{rule:'parent_object',audience:['agent']},subjects:[{app_id:'shop',account_id:'buyer',object_id:'order-1',object_type:'order'}]};
  const state={app_id:'shop',data:{account_id:'buyer'},profile:'scenario',policies:{scenario:{allow:['shop.order.get'],constraints:{}}}};
  const pkg={tools,resourceAccess:load('shop',tools,directory),plugin:{objects:()=>['order-1'],assetReferences:()=>[{asset_id:'receipt',object_id:'order-1',object_type:'order'}]}};
  assert.equal(allowed(pkg,state,asset),false);
  fs.writeFileSync(file,JSON.stringify({app_id:'shop',resource_access:{order:'shop.order.get'}}));
  pkg.resourceAccess=load('shop',tools,directory);assert.equal(allowed(pkg,state,asset),true);
  state.policies.scenario.constraints['shop.order.get']={ids:['other']};assert.equal(allowed(pkg,state,asset),false);
  fs.writeFileSync(file,JSON.stringify({app_id:'shop',resource_access:{order:'shop.order.pay'}}));assert.throws(()=>load('shop',tools,directory));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('CI selects reverse dependencies, with full regression for shared changes',()=>{
 const {select}=require('../ci/select-apps.cjs');
 const apps=new Map([['mail',{relative:'apps/mail',manifest:{dependencies:[]}}],['shop',{relative:'apps/shop',manifest:{dependencies:[{app_id:'mail'}]}}],['trip',{relative:'apps/trip',manifest:{dependencies:[{app_id:'shop'}]}}],['music',{relative:'apps/music',manifest:{dependencies:[]}}]]);
 assert.deepEqual(select(apps,['apps/mail/src/read.cjs']),{full:false,ids:['mail','shop','trip']});
 assert.deepEqual(select(apps,['apps/music/app.json']),{full:false,ids:['music']});
 assert.equal(select(apps,['runtime/contracts/schemas/tools.schema.json']).full,true);
 assert.equal(select(apps,null).ids.length,4);
});
test('public schema compiler is shared and the reference profile is explicit',()=>{
 assert.equal(require('../core/schema.cjs').compile,require('../contracts/schema-validator.cjs').compile);
 assert.equal(require('../profiles/local-reference.json').id,'local-reference-v1');
 require('../sdk/sync.cjs').sync({check:true});
});
