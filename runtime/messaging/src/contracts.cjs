'use strict';
// App declarations are the sole source of channels, schemas and receive handlers.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inside,read}=require('../../core/registry.cjs');
const {compile}=require('../../core/schema.cjs');
const {validate}=require('../../contracts/validate.cjs');
const {extensions}=require('../../core/contribution.cjs');
const insist=(ok,message)=>{if(!ok)throw new Error(message);};
function canonical(x){return JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
const digest=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
function packagePath(base,ref,label){
 insist(typeof ref==='string'&&ref.length>0&&!path.isAbsolute(ref)&&!path.win32.isAbsolute(ref)&&!ref.split(/[\\/]/).includes('..'),label+' must be a relative path without traversal');
 return inside(base,ref);
}
function summarize(publishes,receives){
 const brief=items=>items.map(({channel,schema_id,event_type,payload_schema_id})=>({channel,schema_id,event_type,payload_schema_id}));
 return {envelope:'cloudevents/1.0',direction:publishes.length?(receives.length?'bidirectional':'publish-only'):(receives.length?'receive-only':'none'),publishes:brief(publishes),receives:brief(receives)};
}
function load({packageRoot,contributionRef,appId}){
 insist(fs.statSync(packageRoot).isDirectory(),'Publisher package_root must be a directory');
 const file=packagePath(packageRoot,contributionRef,'Publisher contribution_ref'),declaration=read(file);
 validate('app-contribution',declaration);extensions(declaration);insist(declaration.app_id===appId,'Publisher identity mismatch');
 const compileDirection=direction=>{
  const entries=declaration.messaging[direction];
  insist(new Set(entries.map(e=>e.channel)).size===entries.length,'Duplicate messaging direction / channel');
  return entries.filter(e=>e.status==='implemented').map(entry=>{
   const schemaFile=packagePath(packageRoot,entry.schema_ref,'Message schema_ref'),schema=read(schemaFile);
   insist(!JSON.stringify(schema).includes('"$ref"'),'Router wire schema must be self-contained');
   insist(schema.$id===entry.schema_id&&schema.properties?.specversion?.const==='1.0'&&schema.properties?.type?.const===entry.event_type&&schema.properties?.dataschema?.const===entry.payload_schema_id,'Messaging declaration / CloudEvents schema mismatch');
   return {...entry,schema,hash:digest(schema),valid:compile(schema,path.dirname(schemaFile))};
  });
 };
 const publishes=compileDirection('publishes'),receives=compileDirection('receives');
 return {declaration,publishes,receives,summary:summarize(publishes,receives)};
}
module.exports={load,summarize,packagePath,digest};
