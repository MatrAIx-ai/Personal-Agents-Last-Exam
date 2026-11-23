'use strict';
// Transaction-local file import. Apps choose parent records; Core owns bytes and access.
const crypto=require('node:crypto');
const {copy,fail}=require('./helpers.cjs'),assets=require('./assets.cjs');
function create(state,pkg){
 return {read(id){
  const a=state.resources.bundle.catalog.assets.find(a=>a.asset_id===id);
  if(!require('./resource-access.cjs').allowed(pkg,state,a))fail('not_available','Attachment is not available to this caller');
  if(a.availability.status!=='ready')fail('unavailable','Attachment bytes are unavailable');
  return {filename:require('node:path').basename(a.storage.path||a.asset_id),mime_type:a.mime_type,base64:state.resources.bundle.blobs[id],sha256:a.integrity.sha256,media:copy(a.media||{})};
 },add({object_type,object_id,files}){
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(object_id)||(typeof object_type!=='string'||!object_type.length||object_type.length>100)||!Array.isArray(files)||!files.length||files.length>8)fail('invalid_arguments','Invalid attachment parent or file count');
  const b=state.resources.bundle,ids=[];
  for(const file of files){
   if(typeof file.filename!=='string'||!file.filename.length||file.filename.length>160||/[\\/\x00-\x1f\x7f]/.test(file.filename)||['.','..'].includes(file.filename))fail('invalid_arguments','Invalid attachment filename');
   let bytes;try{bytes=assets.decode(file.base64);}catch{fail('invalid_attachment','Invalid attachment encoding');}
   const sha=crypto.createHash('sha256').update(bytes).digest('hex');
   if(sha!==file.sha256||!assets.mimeMatches(bytes,file.mime_type))fail('invalid_attachment','Attachment hash or format mismatch');
   const id='att-'+crypto.createHash('sha256').update(JSON.stringify([state.app_id,state.data.account_id,object_type,object_id,file.filename,sha])).digest('hex').slice(0,40);
   if(ids.includes(id))fail('invalid_attachment','Duplicate attachment');ids.push(id);
   const old=b.catalog.assets.find(a=>a.asset_id===id);
   if(old){if(old.integrity.sha256!==sha||old.mime_type!==file.mime_type||JSON.stringify(old.media||{})!==JSON.stringify(file.media||{}))fail('invalid_attachment','Attachment metadata conflict');continue;}
   const source='runtime-attachment-import';
   if(!b.dataset.sources.some(s=>s.source_id===source))b.dataset.sources.push({source_id:source,kind:'unspecified',description:'Attachment bytes provided through an authorized App operation or delivery.',uri:null,license:'UNSPECIFIED',usage:'review_required',collection:null,generation:null});
   b.dataset.review={status:'pending',reviewer:null,notes:'Imported attachments need provenance review before redistribution.'};
   b.catalog.assets.push({schema_version:'pale.asset-descriptor.v1',asset_id:id,scope:{level:'run',app_id:state.app_id,run_id:state.run_id},roles:['content.attachment'],subjects:[{app_id:state.app_id,account_id:state.data.account_id,object_type,object_id}],mime_type:file.mime_type,availability:{status:'ready'},storage:{adapter:'storage.inline',path:'assets/'+file.filename,packaging:'runtime_import',inline_base64:file.base64},integrity:{bytes:bytes.length,sha256:sha},provenance:{dataset_id:b.dataset.dataset_id,source_ids:[source]},publication:'restricted',access:{audience:['agent'],rule:'parent_object'},media:copy(file.media||{}),extensions:[]});
   b.blobs[id]=file.base64;
  }
  b.dataset.expected_counts.assets=b.catalog.assets.length;
  return ids;
 }};
}
module.exports={create};
