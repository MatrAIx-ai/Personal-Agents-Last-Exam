'use strict';
const C=require('./common.cjs');
// Author-side synthesis of source imports plus actual App domain transitions.
// This is not a Core implementation, MCP transcript or model rollout.
class Timeline{
 constructor(e,data,profile){this.e=e;this.data=C.clone(data);this.profile=profile;this.steps=[];this.ordinal=0;this.sources={};this.events=0;this.now='2025-01-01T00:00:00.000Z';}
 at(time,fn){this.steps.push({time:C.iso(time),fn,order:this.ordinal++});}
 ctx(){return {app_id:this.e.id,virtual_now:this.now,binding:this.e.binding};}
 validate(){this.e.plugin.validateSeed(this.ctx(),this.data);}
 import(fn){const next=C.clone(this.data);fn(next);this.e.plugin.validateSeed(this.ctx(),next);this.data=next;}
 call(name,args={}){const r=this.e.plugin.handleTool(this.ctx(),C.clone(this.data),this.e.id+'.'+name,{request_id:'history-'+this.profile+'-'+(++this.events),...args});this.e.plugin.validateSeed(this.ctx(),r.data);this.data=r.data;return C.clone(r.result.value);}
 event(operation,payload){const data=this.e.plugin.applyEvent(this.ctx(),C.clone(this.data),{event_id:'history-'+this.profile+'-'+(++this.events),at:this.now,operation,payload});this.e.plugin.validateSeed(this.ctx(),data);this.data=data;}
 note(id,actor,type,body){this.event('record.add',{id,source_actor_id:actor,body});this.sources[id]={type,source_actor_id:actor,occurred_at:this.now};}
 run(cutoff){for(const step of this.steps.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.order-b.order)){if(Date.parse(step.time)>=Date.parse(cutoff))break;this.now=step.time;try{step.fn(this);this.validate();}catch(e){e.message=this.profile+' '+this.now+': '+e.message;throw e;}}this.now=C.iso(cutoff);this.validate();return {id:this.e.id+'-'+this.profile,kind:'continuous-account-history',description:'A single cumulative account state, not independently reset trip/case partitions.',provenance:'original-synthetic',load_at:C.iso(cutoff),account_id:this.data.account_id,data_sha256:C.hash(this.data),source_catalog:this.sources,data:this.data};}
}
module.exports={Timeline};
