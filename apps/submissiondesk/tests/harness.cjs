'use strict';
// App-only unit fixture. No transport, locking, persistence or replacement Core.
const plugin=require('../plugin.cjs');
function fixture(){
 let data=structuredClone(require('../fixtures/minimal.json')),seq=0;
 const ctx={app_id:'submissiondesk',virtual_now:require('../fixtures/clock.json').initial_time,binding:structuredClone(require('../fixtures/binding.json'))};
 plugin.validateSeed(ctx,data);
 return {ctx,get data(){return structuredClone(data);},call(name,args={}){
  const out=plugin.handleTool(ctx,structuredClone(data),name.startsWith('submissiondesk.')?name:'submissiondesk.'+name,{request_id:'unit-'+(++seq),...args});plugin.validateSeed(ctx,out.data);data=out.data;return structuredClone(out.result.value);
 },event(event){const nextCtx={...ctx,virtual_now:event.at},next=plugin.applyEvent(nextCtx,structuredClone(data),structuredClone(event));plugin.validateSeed(nextCtx,next);data=next;ctx.virtual_now=event.at;return structuredClone(data);}};
}
const bundle=(h,material='material-alder-1')=>h.call('bundle.create',{paper_id:'paper-alder',material_ids:[material],author_person_ids:['person-mara','person-jun','person-ali']}).item;
const register=h=>h.call('abstract.register',{paper_id:'paper-alder',venue_id:'venue-c'}).item;
function commit(h,b){const {preview}=h.call('submission.preview',{bundle_id:b.id,venue_id:'venue-c'});return h.call('submission.commit',{bundle_id:b.id,venue_id:'venue-c',preview});}
module.exports={fixture,bundle,register,commit};
