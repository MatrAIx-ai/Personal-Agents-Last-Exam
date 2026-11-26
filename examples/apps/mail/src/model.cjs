'use strict';
// Domain records and references; Core owns persistence and versioning.
const {fail,references}=require('./domain-utils.cjs');
function validateSeed(ctx,data){
 references(ctx,data);
 if(new Set(data.messages.map(m=>m.id)).size!==data.messages.length)fail('invalid_seed','Duplicate message ID.');
 for(const m of data.messages){
  if(m.account_id!==data.account_id)fail('invalid_seed','Message account does not match this App instance.');
  if(m.event_ref){const r=m.event_ref;if(!ctx.binding.accounts.some(a=>a.app_id===r.app_id&&a.account_id===r.account_id)||!ctx.binding.objects[r.app_id]?.includes(r.object_id))fail('invalid_seed','Cross-App reference is missing from the binding.');}
 }
}
module.exports={validateSeed,records:data=>data.messages,objects:data=>data.messages.map(x=>x.id),references:data=>data.messages.filter(x=>x.event_ref).map(x=>x.event_ref),assetReferences:data=>data.messages.flatMap(x=>(x.attachments||[]).map(asset_id=>({asset_id,object_id:x.id,object_type:'message'})))};
