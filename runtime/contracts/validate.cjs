'use strict';
// Contract validation only. Never fetches assets, starts Apps, or delivers notifications.
const fs=require('node:fs'),path=require('node:path'),{compile}=require('./schema-validator.cjs');
const root=__dirname,base=path.join(root,'schemas'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const validators=Object.fromEntries(fs.readdirSync(base).filter(p=>p.endsWith('.schema.json')).map(p=>[p.slice(0,-12),compile(read(path.join(base,p)),base)]));
function requireThat(ok,message){if(!ok)throw new Error(message);}
function unique(values,label){requireThat(new Set(values).size===values.length,'Duplicate '+label);}
function extensions(value){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach(extensions);return;}
 if(Array.isArray(value.extensions))unique(value.extensions.map(x=>x.namespace),'extension namespaces');
 for(const [k,v] of Object.entries(value))if(k!=='extensions')extensions(v);
}
function validate(kind,x){
 requireThat(!!validators[kind],'Unknown contract kind: '+kind);requireThat(validators[kind](x),'Invalid '+kind+' schema');extensions(x);
 if(kind==='app-contribution'){
  requireThat(x.state.isolation_keys.includes('run_id')&&x.state.isolation_keys.includes('app_id'),'State must isolate run and App');
  unique(x.interfaces.map(i=>i.interface_id),'interfaces');
  for(const i of x.interfaces){
   for(const o of i.operations){requireThat(i.audience.includes(o.caller),'Operation caller not in interface audience');requireThat(!((o.effect==='admin'||o.name.startsWith('env.'))&&o.caller==='agent'),'Administrative operation cannot be exposed to Agent');}
  }
 }
 if(kind==='asset-descriptor'){
  const a=x,s=a.storage;
  if(s.adapter==='storage.file')requireThat(typeof s.path==='string'&&!path.isAbsolute(s.path)&&!s.path.includes('\\')&&!s.path.split('/').some(p=>p==='..'||p==='.'||p===''),'Unsafe or missing bundled asset path');
  if(s.adapter==='storage.http')requireThat(typeof s.uri==='string'&&/^https?:\/\//.test(s.uri),'HTTP storage requires URL');
  if(s.adapter==='storage.generated')requireThat(!!s.generator_ref,'Generated storage requires generator_ref');
  if(s.adapter==='storage.stream')requireThat(!!s.stream_ref,'Stream storage requires stream_ref');
  if(s.adapter==='storage.inline')requireThat(typeof s.inline_base64==='string'&&Buffer.from(s.inline_base64,'base64').toString('base64')===s.inline_base64,'Inline storage requires canonical base64');
  if(a.availability.status==='ready')requireThat(s.packaging!=='not_materialized','Ready assets cannot be unmaterialized');
  if(a.availability.status==='declared'||a.availability.status==='missing')requireThat(!!a.availability.reason,'Unmaterialized / missing asset needs reason');
  if(a.scope.level==='task')requireThat(!!a.scope.task_id,'Task-scoped asset needs task_id');
  if(a.scope.level==='run')requireThat(!!a.scope.run_id,'Run-scoped asset needs run_id');
  if(a.roles.some(r=>r==='content.attachment'||r==='content.inline'))requireThat(a.subjects.length>0&&a.access.rule!=='app_surface','Content attachments need parent or Task policy binding');
  if(a.access.rule==='parent_object')requireThat(a.subjects.some(s=>!!s.account_id),'Parent visibility needs account-bound subject');
  if(a.access.rule==='task_policy')requireThat(!!a.access.policy_ref,'Task policy binding required');
 }
 if(kind==='gui'){
  unique(x.routes.map(r=>r.route_id),'GUI routes');
  if(x.audience.includes('agent'))requireThat(x.state_connection.authoritative_state==='app_runtime','Agent GUI must observe the App runtime state');
  if(x.content_policy.remote_fetch==='allowlist')requireThat(x.content_policy.remote_allowlist.length>0,'Remote fetch allowlist cannot be empty');
 }
 if(kind==='notification'||kind==='router-message'){
  if(x.data.recipient.kind==='app_account_ref')requireThat(!!x.data.recipient.app_id,'Account recipient requires target App namespace');
 }
 return true;
}
function validateAppSet(contract,catalog,dataset,gui){
 validate('app-contribution',contract);validate('asset-catalog',catalog);validate('dataset',dataset);validate('gui',gui);
 requireThat(catalog.app_id===contract.app_id,'Catalog App mismatch');unique(catalog.assets.map(a=>a.asset_id),'asset IDs');
 unique(dataset.sources.map(s=>s.source_id),'source IDs');const sourceIds=new Set(dataset.sources.map(s=>s.source_id));
 requireThat(dataset.record_source_ids.every(id=>sourceIds.has(id)),'Record source not declared');requireThat(dataset.expected_counts.assets===catalog.assets.length,'Asset count mismatch');
 const ids=new Set(catalog.assets.map(a=>a.asset_id));
 for(const a of catalog.assets){
  validate('asset-descriptor',a);requireThat(a.scope.app_id===contract.app_id,'Asset App mismatch');
  requireThat(a.provenance.dataset_id===dataset.dataset_id&&a.provenance.source_ids.every(id=>sourceIds.has(id)),'Asset provenance not declared');
  const refs=[...(a.presentation?.renditions||[]).map(r=>r.asset_id),...(a.provenance.derivation?.parent_asset_ids||[]),...(a.presentation?.fallback_asset_id?[a.presentation.fallback_asset_id]:[])];
  requireThat(refs.every(id=>ids.has(id)&&id!==a.asset_id),'Dangling / self asset relationship');
 }
 for(const route of gui.routes)for(const b of route.asset_bindings)requireThat(ids.has(b.asset_id),'GUI asset binding not declared');
 return true;
}
function main(){
 for(const app of ['mail','calendar','delivery']){const d=path.join(root,'examples',app);validateAppSet(read(path.join(d,'contribution.json')),read(path.join(d,'assets.catalog.json')),read(path.join(d,'dataset.json')),read(path.join(d,'gui.json')));console.log(app+': contract, GUI and asset declarations valid');}
 validate('router-message',read(path.join(root,'examples/email-message.json')));
 console.log('All contract examples valid. No runtime behavior was executed.');
}
module.exports={validate,validateAppSet,validators};if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
