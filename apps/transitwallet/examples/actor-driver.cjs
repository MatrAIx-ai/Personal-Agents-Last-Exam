'use strict';
// Public Infra adapter, not a scheduler or a user simulator. The caller supplies
// actual actor decisions/results and chronological time; no business internals.
const same=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);
async function actorScope(infra){const r=await infra.call('env.snapshot');return {run_id:r.snapshot.run_id,account_id:r.snapshot.data.account_id,epoch:r.version.epoch};}
function inScope(s,scope){return s.version.epoch===scope.epoch&&s.snapshot.run_id===scope.run_id&&s.snapshot.data.account_id===scope.account_id;}
function family(operation){return operation==='journey.perform'?'journeys':'requests';}
function eligible(s,step,x){
 if(step.operation==='journey.perform')return x.status===(step.payload.phase==='arrival'?'in_transit':'planned');
 if(step.operation==='verification.reply')return x.kind==='measurement'&&x.status==='pending';
 if(step.operation==='assistance.reply'){
  if(x.kind!=='assistance'||x.status!=='pending')return false;const b=s.snapshot.data.bookings.find(b=>b.service_id===x.selector.service_id&&b.booking_attempt===x.selector.booking_attempt);
  return b&&['held','confirmed'].includes(b.status)&&Date.parse(step.at)<Date.parse(b.depart_at)&&(b.status==='confirmed'||Date.parse(step.at)<Math.min(Date.parse(b.hold_expires_at),Date.parse(b.confirm_before)));
 }
 return false;
}
async function prepareActorStep(infra,scope,spec){
 const s=await infra.call('env.snapshot');if(!inScope(s,scope))return {prepared:false,reason:'stale_scope'};
 const step={...structuredClone(spec),scope:structuredClone(scope)};
 if(['verification.reply','assistance.reply','journey.perform'].includes(step.operation)){
  const rows=s.snapshot.data[family(step.operation)].filter(x=>eligible(s,step,x)&&Object.entries(step.intent||{}).every(([k,v])=>x.selector[k]===v));
  if(!rows.length)return {prepared:false,reason:'no_applicable_target'};if(rows.length!==1)throw Error('Ambiguous actor intent; use a more specific generation');
  step.payload.selector=structuredClone(rows[0].selector);
 }
 delete step.intent;return {prepared:true,step};
}
async function applyActorStep(infra,prepared){
 if(!prepared.prepared)return {emitted:false,reason:prepared.reason};const step=prepared.step,s=await infra.call('env.snapshot');
 if(!inScope(s,step.scope))return {emitted:false,reason:'stale_scope'};
 if(['verification.reply','assistance.reply','journey.perform'].includes(step.operation)){
  const rows=s.snapshot.data[family(step.operation)].filter(x=>same(x.selector,step.payload.selector));
  if(rows.length!==1||!eligible(s,step,rows[0]))return {emitted:false,reason:'target_inactive'};
 }
 const event={event_id:step.event_id,at:step.at,operation:step.operation,payload:step.payload};
 return {emitted:true,result:await infra.call('env.apply_event',{expected_version:s.version,event})};
}
module.exports={actorScope,prepareActorStep,applyActorStep};
