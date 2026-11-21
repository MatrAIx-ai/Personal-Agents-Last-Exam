'use strict';
const crypto=require('node:crypto');
const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e;};
const check=(condition,code,message)=>{if(!condition)fail(code,message);};
const copy=x=>structuredClone(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const collections=['records','venues','papers','materials','bundles','requests','abstracts','submissions','receipts'];
const find=(data,collection,id)=>{const v=data[collection].find(x=>x.id===id);check(v,'not_found','Unknown '+collection+' reference');return v;};
const all=data=>collections.flatMap(k=>data[k]);
function id(data,prefix){const used=new Set(all(data).map(x=>x.id));let n=1;while(used.has(prefix+'-'+n))n++;return prefix+'-'+n;}
const person=(ctx,id)=>ctx.binding.people.some(p=>p.person_id===id);
function bundleContent(data,b){return {paper_id:b.paper_id,author_person_ids:b.author_person_ids,materials:b.material_ids.map(x=>find(data,'materials',x).sections)};}
function recordHistory(ctx,data,operation,object_id,source){data.history.push({sequence:data.history.length+1,at:ctx.virtual_now,operation,object_id,source_id:source});}
function snapshot(data,b){return {bundle_id:b.id,paper_id:b.paper_id,author_person_ids:copy(b.author_person_ids),materials:b.material_ids.map(x=>copy(find(data,'materials',x))),content_digest:b.content_digest};}
function liveSubmission(data,paper,venue){return data.submissions.find(s=>s.paper_id===paper&&s.venue_id===venue);}
function preview(ctx,data,bundle_id,venue_id){
 const b=find(data,'bundles',bundle_id),v=find(data,'venues',venue_id);
 const abstract=data.abstracts.find(a=>a.paper_id===b.paper_id&&a.venue_id===v.id&&a.status==='registered');
 check(abstract,'no_abstract','No active abstract for this paper and venue');
 const s=liveSubmission(data,b.paper_id,v.id);check(!s||s.status!=='withdrawn','withdrawn','A withdrawn submission cannot be reopened in this first version');
 return {bundle_id:b.id,paper_id:b.paper_id,venue_id:v.id,policy_version:v.policy_version,content_digest:b.content_digest,abstract_id:abstract.id,active_receipt_id:s?.active_receipt_id??null};
}
module.exports={fail,check,copy,canonical,digest,collections,find,all,id,person,bundleContent,recordHistory,snapshot,liveSubmission,preview};
