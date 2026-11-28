'use strict';
const {createHash}=require('node:crypto');
const stamp=Date.parse;
const atOrBefore=(a,b)=>stamp(a)<=stamp(b);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const uniq=xs=>new Set(xs).size===xs.length;
const id=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const OP='civic311.';
const sourceCase=(data,caseId)=>data.cases.find(r=>r.case_id===caseId);
function visible(data,c,now) {
 if(!c||!atOrBefore(c.created_at,now))return null;
 const view={case_id:c.case_id,created_at:c.created_at,borough:c.borough,category:c.category,
  status:'unknown',agency:null,admin_update_code:null,last_updated_at:null};
 const steps=[...c.observations.filter(o=>atOrBefore(o.at,now)),...data.events.filter(e=>e.payload.case_id===c.case_id&&atOrBefore(e.at,now))];
 steps.sort((a,b)=>stamp(a.at)-stamp(b.at));
 for(const e of steps){
  if(!e.operation){view.status=e.status;view.agency=e.agency;}
  else if(e.operation===OP+'case_status_changed')view.status=e.payload.new_status;
  else if(e.operation===OP+'case_agency_changed')view.agency=e.payload.new_agency;
  else view.admin_update_code=e.payload.update_code;
  view.last_updated_at=e.at;
 }
 return view;
}
function getCase(ctx,data,caseId){
 const c=visible(data,sourceCase(data,caseId),ctx.virtual_now);
 if(!c)fail('not_found','No visible case matches that ID.');
 return c;
}
function bound(ctx,data){
 if(!ctx.binding.accounts.some(a=>a.app_id===ctx.app_id&&a.account_id===data.account_id))
  fail('invalid_seed','Seed account has no matching binding.');
}
function validateSeed(ctx,data){
 bound(ctx,data);
 for(const [rows,key] of [[data.cases,'case_id'],[data.watches,'watch_id'],[data.activity,'activity_id'],[data.events,'event_id']]){
  if(!uniq(rows.map(x=>x[key]))) fail('invalid_seed','Duplicate record ID.');
 }
 for(const c of data.cases){
  if(c.recorded_closed_at&&!atOrBefore(c.created_at,c.recorded_closed_at))fail('invalid_seed','Source close predates creation.');
  let prior=stamp(c.created_at)-1;
  for(const o of c.observations){
   if(!(stamp(o.at)>prior)||o.source!==c.source)fail('invalid_seed','Observations must be ordered and have the case source.');
   prior=stamp(o.at);
  }
 }
 if(data.watches.some(w=>w.account_id!==data.account_id||!sourceCase(data,w.case_id)||!uniq(w.change_types)))fail('invalid_seed','Invalid watch ownership, case or choices.');
 const prev={...data,events:[]};
 for(const e of data.events){
  if(prev.events.length&&!atOrBefore(prev.events.at(-1).at,e.at))fail('invalid_seed','Events out of order.');
  try{transition(prev,e);}catch(err){fail('invalid_seed',err.message);}
  prev.events.push(e);
 }
 if(!uniq(data.activity.map(a=>JSON.stringify([a.watch_id,a.event_id])))||data.activity.some(a=>{
  const e=data.events.find(e=>e.event_id===a.event_id);
  return a.account_id!==data.account_id||!e||e.payload.case_id!==a.case_id||e.at!==a.at||derive(e)!==a.change_type||
   (a.acknowledged_at!==null&&!atOrBefore(a.at,a.acknowledged_at));
 }))fail('invalid_seed','Invalid activity linkage, time or owner.');
}
function handleTool(ctx,data,name,args){
 let result;
 switch(name){
  case OP+'search_cases':{
   const items=data.cases.map(c=>visible(data,c,ctx.virtual_now)).filter(c=>c&&
    (!args.case_id||c.case_id===args.case_id)&&(!args.borough||c.borough===args.borough)&&(!args.status||c.status===args.status))
    .sort((a,b)=>stamp(b.created_at)-stamp(a.created_at)||a.case_id.localeCompare(b.case_id));
   const offset=args.offset??0,limit=args.limit??25;
   result={items:items.slice(offset,offset+limit),total:items.length,next_offset:items.length>offset+limit?offset+limit:null};break;
  }
  case OP+'read_case': result={item:getCase(ctx,data,args.case_id)}; break;
  case OP+'list_watches': result={items:data.watches.filter(w=>w.account_id===data.account_id&&atOrBefore(w.updated_at,ctx.virtual_now))};break;
  case OP+'list_activity': result={items:data.activity.filter(a=>a.account_id===data.account_id&&(!args.unread_only||a.acknowledged_at===null||!atOrBefore(a.acknowledged_at,ctx.virtual_now))&&atOrBefore(a.at,ctx.virtual_now)).map(a=>({...a,acknowledged_at:atOrBefore(a.acknowledged_at,ctx.virtual_now)?a.acknowledged_at:null})).reverse()};break;
  case OP+'save_watch':{
   getCase(ctx,data,args.case_id);
   const existing=args.watch_id?data.watches.find(w=>w.watch_id===args.watch_id&&w.account_id===data.account_id&&atOrBefore(w.updated_at,ctx.virtual_now)):null;
   if(args.watch_id&&!existing) fail('not_found','Watch does not exist in this account.');
   if(existing&&existing.case_id!==args.case_id)fail('invalid_arguments','A watch cannot be moved to another case.');
   const duplicate=data.watches.find(w=>w.case_id===args.case_id&&w.account_id===data.account_id&&w!==existing);
   if(duplicate)fail('already_watched','Edit your existing watch for this case.');
   const w={watch_id:existing?.watch_id??'W-'+id(data.account_id,args.case_id,args.request_id),account_id:data.account_id,
    case_id:args.case_id,change_types:[...args.change_types].sort(),version:(existing?.version??0)+1,updated_at:ctx.virtual_now};
   if(existing)data.watches.splice(data.watches.indexOf(existing),1,w);else data.watches.push(w);
   result={watch:w};break;
  }
  case OP+'remove_watch':{
   const i=data.watches.findIndex(w=>w.watch_id===args.watch_id&&w.account_id===data.account_id&&atOrBefore(w.updated_at,ctx.virtual_now));
   if(i<0)fail('not_found','Watch does not exist in this account.');
   data.watches.splice(i,1); result={watch_id:args.watch_id};break;
  }
  case OP+'ack_activity':{
   const a=data.activity.find(x=>x.activity_id===args.activity_id&&x.account_id===data.account_id&&atOrBefore(x.at,ctx.virtual_now));
   if(!a)fail('not_found','Activity does not exist in this account.');
   if(a.acknowledged_at!==null) fail('already_acknowledged','This reminder has already been acknowledged.');
   a.acknowledged_at=ctx.virtual_now;result={activity:a};break;
  }
  default:fail('unknown_tool','Unknown 311 operation.');
 }
 return {data,result};
}
function derive(e){
 const p=e.payload;
 if(e.operation===OP+'case_status_changed') return p.new_status==='closed'?'resolved':p.previous_status==='closed'?'reopened':null;
 return e.operation===OP+'case_agency_changed'?'agency_changed':'admin_update';
}
function transition(data,e){
 const p=e.payload,c=visible(data,sourceCase(data,p.case_id),e.at);
 if(!c)fail('invalid_event','Case not visible at event time.');
 if(c.status==='unknown')fail('invalid_event','An explicit case observation must precede scenario events.');
 if(e.operation===OP+'case_status_changed'){
  if(c.status==='unknown'||c.status!==p.previous_status||c.status===p.new_status)
   fail('invalid_event','Status event requires an evidenced, matching prior status and a real change.');
 }else if(e.operation===OP+'case_agency_changed'){
  if(c.agency===null||c.agency!==p.previous_agency||c.agency===p.new_agency)
   fail('invalid_event','Agency event requires a matching prior agency and a real change.');
 }else if(c.admin_update_code===p.update_code) fail('invalid_event','Administrative update is unchanged.');
}
const messages={resolved:'The agency closed this case. This is not proof of repair.',reopened:'The case was reopened.',agency_changed:'The case agency changed.',admin_update:'A sandbox administrative update was recorded.'};
function applyEvent(ctx,data,e){
 if(ctx.role!=='infra')fail('permission_denied','Only Infra can apply scenario events.');
 transition(data,e);
 const change=derive(e);
 for(const w of data.watches){
  if(w.case_id!==e.payload.case_id||!w.change_types.includes(change)||!atOrBefore(w.updated_at,e.at))continue;
  data.activity.push({activity_id:'A-'+id(w.watch_id,e.event_id),watch_id:w.watch_id,account_id:data.account_id,
   case_id:w.case_id,event_id:e.event_id,change_type:change,at:e.at,message:messages[change],acknowledged_at:null});
 }
 data.events.push(e);
 return data;
}
const records=data=>[...data.cases,...data.watches,...data.activity];
module.exports={validateSeed,handleTool,applyEvent,records,objects:data=>records(data).map(r=>r.case_id&&!(r.watch_id||r.activity_id)?r.case_id:r.activity_id??r.watch_id),references:()=>[]};
