'use strict';
const path=require('node:path');
const {compile}=require('./schema-validator.cjs');
const {copy,fail,hash,same,sorted,instant,lookup,nextId,record,pending,current,effectiveStatus}=require('./common.cjs');
const {conditions,terms}=require('./conditions.cjs');
const {validateSeed}=require('./model.cjs');
// Core validates transport request_id/expected_version; App-only calls exercise business arguments.
const toolSchemas=new Map(require('../tools.json').map(t=>{const schema=copy(t.inputSchema);schema.required=schema.required.filter(k=>!['request_id','expected_version'].includes(k));return [t.name,compile(schema,path.join(__dirname,'../schemas'))];}));
function sourceSnapshot(s){return {source_id:s.id,version:s.version,grant_version:s.grant_version};}
function serviceField(service){return {late_arrival:'arrival_at',step_free_access:'functional_need',breakfast:'meal_request'}[service];}
function factEqual(field,a,b){return field==='arrival_at'?Date.parse(a)===Date.parse(b):typeof a==='string'&&a.trim()===b;}
function authorize(ctx,data,need,value,sourceIds){
 const field=serviceField(need.service);if(!sourceIds.length)fail('permission_denied','Select a trusted source for this service fact.');
 const sources=sourceIds.map(id=>lookup(data.sources,id,'Source'));
 for(const s of sources){if(!s.readable||Date.parse(s.observed_at)>Date.parse(ctx.virtual_now))fail('permission_denied','A selected source is not currently readable.');if(s.person_id!==null&&!value.person_ids.includes(s.person_id))fail('permission_denied','A selected source belongs to another traveler.');}
 const matches=sources.filter(s=>s.disclose_fields.includes(field)&&factEqual(field,s.fields[field],value[field]));
 if(!matches.length)fail('permission_denied','The exact service fact is not authorized for disclosure to this property.');
 return {source_versions:sources.map(sourceSnapshot).sort((a,b)=>a.source_id.localeCompare(b.source_id)),disclosures:matches.map(s=>({source_id:s.id,field,value:value[field]}))};
}
function preview(ctx,data,args){
 const need=lookup(data.needs,args.need_id,'Need');
 if(!['arrange','change','cancel'].includes(args.action))fail('invalid_arguments','Unknown requested action.');
 let predecessor=null,value,auth={source_versions:[],disclosures:[]};
 if(args.action==='arrange'){
  if(args.predecessor_id)fail('invalid_arguments','An initial arrangement cannot name a predecessor.');
  if(data.commitments.some(c=>c.need_id===need.id&&c.status==='active'))fail('invalid_state','Use change or cancel for the existing hotel commitment.');
 }else{
  if(!args.predecessor_id)fail('invalid_arguments','Change and cancellation require the existing commitment.');
  predecessor=lookup(data.commitments,args.predecessor_id,'Commitment');
  if(predecessor.need_id!==need.id||predecessor.status!=='active')fail('invalid_state','The predecessor is not a current commitment for this need.');
 }
 if(args.action==='cancel')value=conditions(data,predecessor.request_conditions,need);
 else{
  if(!current(data,need))fail('invalid_state','This need belongs to a former companion; only existing service cancellation is available.');
  if(!need.conditions)fail('invalid_state','Record an explicit service need before requesting an arrangement.');
  value=conditions(data,need.conditions,need);
  auth=authorize(ctx,data,need,value,need.source_ids);
  if(need.review_required||!same(auth.source_versions,need.source_versions))fail('stale_source','Review and save the need against the current sources first.');
 }
 const prior=data.requests.find(r=>r.need_id===need.id&&pending(r));
 const result={need_id:need.id,action:args.action,predecessor_id:predecessor?.id||null,request_conditions:value,disclosures:auth.disclosures,source_versions:auth.source_versions,property_id:data.property.id,person_ids:copy(value.person_ids)};
 const bindings={result,need_revision:args.action==='cancel'?null:need.revision,guests:args.action==='cancel'?null:sorted(data.stay.guest_person_ids),predecessor:predecessor?{id:predecessor.id,status:predecessor.status,terms:terms(data,predecessor.terms,need),confirmed_at:instant(predecessor.confirmed_at),unavailability:predecessor.unavailability}:null,pending:prior?{id:prior.id,status:prior.status}:null};
 return {preview_token:hash(bindings),...result};
}
function inspect(ctx,data){
 const view=copy(data);view.virtual_now=instant(ctx.virtual_now);
 view.sources=data.sources.map(s=>s.readable&&Date.parse(s.observed_at)<=Date.parse(ctx.virtual_now)?{...copy(s),fields:Object.fromEntries(Object.entries(s.fields).filter(([field])=>['arrival_at','functional_need','meal_request'].includes(field)))}:{id:s.id,person_id:s.person_id,version:s.version,observed_at:s.observed_at,readable:false,disclose_fields:[],grant_version:s.grant_version,provenance:copy(s.provenance)});
 view.needs=data.needs.map(n=>({...copy(n),is_current:current(data,n)}));
 view.commitments=data.commitments.map(c=>({...copy(c),effective_status:effectiveStatus(c,ctx.virtual_now)}));
 // Source updates never place raw source bodies into history. Historical outgoing
 // disclosures remain visible as evidence of what the property already received.
 return view;
}
function handleTool(ctx,original,name,args={}){
 const valid=toolSchemas.get(name);if(!valid)fail('unknown_tool','Unknown StayReady operation.');if(!valid(args))fail('invalid_arguments','Arguments do not match the declared business tool.');
 const data=copy(original);let result;
 if(name==='stayready.inspect')return {data,result:{view:inspect(ctx,data)}};
 if(name==='stayready.request.preview')return {data,result:{preview:preview(ctx,data,args)}};
 if(name==='stayready.need.save'){
  const n=lookup(data.needs,args.need_id,'Need');
  if(!current(data,n))fail('invalid_state','A former companion need cannot be edited; cancel its existing service instead.');
  if(args.conditions===null){if(args.source_ids.length)fail('invalid_arguments','A cleared need must have no source references.');n.conditions=null;n.source_ids=[];n.source_versions=[];}
  else{const value=conditions(data,args.conditions,n);if(!same(sorted(n.person_ids),value.person_ids))fail('invalid_arguments','Need traveler identity cannot be changed here.');const auth=authorize(ctx,data,n,value,args.source_ids);n.conditions=value;n.source_ids=sorted(args.source_ids);n.source_versions=auth.source_versions;}
  n.revision++;n.review_required=false;record(data,ctx,{operation:name,outcome:'saved',target_id:n.id,details:{revision:n.revision}});result={need_id:n.id};
 }else if(name==='stayready.people.replace'){
  if(args.old_person_id===data.owner_person_id)fail('invalid_arguments','The owner cannot be replaced.');
  if(!data.stay.guest_person_ids.includes(args.old_person_id)||data.stay.guest_person_ids.includes(args.new_person_id)||!data.people.some(p=>p.id===args.new_person_id))fail('invalid_arguments','Choose the current companion and a different known person.');
  data.stay.guest_person_ids=data.stay.guest_person_ids.map(id=>id===args.old_person_id?args.new_person_id:id);data.stay.guest_revision++;
  for(const n of data.needs.filter(n=>n.service==='late_arrival')){n.person_ids=sorted(data.stay.guest_person_ids);if(n.conditions)n.conditions.person_ids=copy(n.person_ids);n.revision++;n.review_required=true;}
  record(data,ctx,{operation:name,outcome:'replaced',target_id:data.stay.id,details:{old_person_id:args.old_person_id,new_person_id:args.new_person_id}});result={guest_person_ids:copy(data.stay.guest_person_ids)};
 }else if(name==='stayready.request.submit'){
  const p=preview(ctx,data,args);if(args.preview_token!==p.preview_token)fail('stale_preview','The preview changed. Inspect and preview the current request before submitting.');
  const previous=data.requests.find(r=>r.need_id===args.need_id&&pending(r));
  const predecessor=p.predecessor_id?lookup(data.commitments,p.predecessor_id):null;
  const r={id:nextId(data,'hotel-request'),need_id:p.need_id,action:p.action,conditions:copy(p.request_conditions),submitted_at:instant(ctx.virtual_now),status:'submitted',predecessor_id:p.predecessor_id,predecessor:predecessor?{terms:terms(data,predecessor.terms),confirmed_at:instant(predecessor.confirmed_at)}:null,disclosures:copy(p.disclosures),source_versions:copy(p.source_versions),replies:[],final_reply:null};
  if(previous)previous.status='superseded';data.requests.push(r);record(data,ctx,{operation:name,outcome:'submitted',target_id:r.id,details:{need_id:r.need_id,action:r.action,superseded_request_id:previous?.id||null}});result={hotel_request_id:r.id};
 }else if(name==='stayready.request.withdraw'){
  const r=lookup(data.requests,args.hotel_request_id,'Request');if(!pending(r))fail('invalid_state','Only pending requests can be withdrawn; use cancellation for a confirmed service.');r.status='withdrawn';record(data,ctx,{operation:name,outcome:'withdrawn',target_id:r.id});result={hotel_request_id:r.id};
 }
 validateSeed(ctx,data);return {data,result};
}
module.exports={handleTool,preview,inspect};
