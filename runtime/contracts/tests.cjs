'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validate,validateAppSet,validators}=require('./validate.cjs');let count=0;
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,p),'utf8'));
const ok=(value,label)=>{assert.ok(value,label);count++;};
const appSet=app=>['contribution.json','assets.catalog.json','dataset.json','gui.json'].map(f=>read('examples/'+app+'/'+f));
const bad=(kind,data,mutate,label)=>{const x=structuredClone(data);mutate(x);assert.throws(()=>validate(kind,x),undefined,label);count++;};
const badSet=(change,label)=>{const x=appSet('delivery');change(...x);assert.throws(()=>validateAppSet(...x),undefined,label);count++;};
for(const app of ['mail','calendar','delivery']){
 const x=appSet(app);for(const [i,kind] of ['app-contribution','asset-catalog','dataset','gui'].entries())ok(validate(kind,x[i]),app+' '+kind);
 ok(validateAppSet(...x),app+' referenced records consistent');
}
const mail=appSet('mail'),external=appSet('delivery'),a=external[1].assets[0];
ok(!Object.hasOwn(a,'owner')&&validate('asset-descriptor',a),'UI logo has no fake mailbox owner');
const reuse=structuredClone(a);reuse.roles.push('ui.future_feature');reuse.mime_type='image/avif';reuse.extensions=[{namespace:'org.example.display',version:'1.0.0',required:false,data:{density:3}}];ok(validate('asset-descriptor',reuse),'new roles, MIME and optional vendor metadata need no base schema edit');
const privateAsset=structuredClone(a);privateAsset.publication='public';privateAsset.access={audience:['evaluator'],rule:'app_surface'};ok(validate('asset-descriptor',privateAsset),'publication is independent from runtime visibility');
bad('asset-descriptor',a,x=>x.mime_type='jpeg','malformed MIME');
bad('asset-descriptor',a,x=>x.storage.path='../private.png','escaping path');
bad('asset-descriptor',a,x=>x.storage.path='/private.png','absolute path');
bad('asset-descriptor',a,x=>x.availability={status:'declared'},'missing declaration reason');
bad('asset-descriptor',a,x=>x.availability={status:'ready'},'ready requires integrity');
bad('asset-descriptor',a,x=>{x.availability={status:'ready'};x.integrity={bytes:1,sha256:'0'.repeat(64)};},'ready cannot be unmaterialized');
bad('asset-descriptor',a,x=>{x.roles=['content.attachment'];},'attachment needs object visibility');
bad('asset-descriptor',a,x=>{x.access={audience:['agent'],rule:'parent_object'};},'parent scope requires account');
bad('asset-descriptor',a,x=>{x.access={audience:['agent'],rule:'task_policy'};},'task policy reference required');
bad('asset-descriptor',a,x=>x.scope={level:'run',app_id:'delivery'},'run scoped asset needs run id');
bad('asset-descriptor',a,x=>x.roles=['newtype'],'roles are namespaced');
bad('asset-descriptor',a,x=>x.typo_field=true,'core field typo rejected');
bad('asset-descriptor',reuse,x=>x.extensions.push(structuredClone(x.extensions[0])),'duplicate extension namespace');
bad('asset-descriptor',a,x=>x.storage={adapter:'storage.http',packaging:'external',uri:'file:///private'},'remote storage must not name local file');
bad('asset-descriptor',a,x=>x.storage={adapter:'storage.inline',packaging:'runtime_import',inline_base64:'bad'},'inline bytes canonical');
bad('app-contribution',mail[0],x=>x.interfaces[0].operations.push({name:'env.reset',caller:'agent',effect:'read'}),'admin exposure rejected even if mislabeled read');
bad('app-contribution',mail[0],x=>x.state.isolation_keys=['app_id','instance_id'],'run isolation required');
bad('app-contribution',mail[0],x=>x.interfaces[0].operations[0].caller='infra','caller must match surface');
bad('gui',external[3],x=>x.state_connection.authoritative_state='static_fixture','Agent GUI cannot fake state with fixture');
bad('gui',external[3],x=>x.content_policy.remote_fetch='allowlist','empty allowlist rejected');
badSet((app,catalog)=>catalog.assets.push(structuredClone(catalog.assets[0])),'duplicate asset ids');
badSet((app,catalog)=>catalog.assets[0].provenance.source_ids=['missing'],'missing provenance');
badSet((app,catalog)=>catalog.assets[0].provenance.dataset_id='other','wrong dataset');
badSet((app,catalog)=>catalog.assets[0].scope.app_id='mail','cross App catalog');
badSet((app,catalog,dataset,gui)=>gui.routes[0].asset_bindings[0].asset_id='missing','GUI missing asset');
badSet((app,catalog)=>catalog.assets[1].presentation.renditions[0].asset_id='unknown','rendition missing');
badSet((app,catalog,dataset)=>dataset.expected_counts.assets++,'declared asset count mismatch');
const notice=read('examples/email-message.json');ok(validate('router-message',notice),'actual Email wire contract');
for(const [change,label] of [
 [x=>x.data.channel='channel.push','unsupported channel'],[x=>x.data.content.body.format='text/html','unsupported HTML'],
 [x=>x.data.content.asset_ids=['private-photo'],'no unimplemented cross App attachment transfer'],
 [x=>delete x.data.source_object.account_id,'source account required'],
 [x=>x.data.recipient={kind:'app_account_ref',id:'mail-maya'},'target namespace required'],
 [x=>x.role='infra','message cannot supply caller role']
])bad('router-message',notice,change,label);
const report={contract_revision:'0.4.0',checks:count,passed:true,scope:'Schema and declaration-reference validation only; not runtime delivery, asset rendering, or human provenance review',schema_count:Object.keys(validators).length};
const reportDir=path.resolve(process.env.PALE_REPORT_DIR||path.join(__dirname,'../../.artifacts'));
fs.mkdirSync(reportDir,{recursive:true});
fs.writeFileSync(path.join(reportDir,'contracts.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: '+count+' schema and declaration checks');
