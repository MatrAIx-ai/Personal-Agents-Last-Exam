'use strict';
// Conditional actor adapter using only public Infra MCP. It is not a scheduler,
// credential service, user simulator or source of manufactured performed facts.
const same=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);
async function actorScope(infra){const s=await infra.call('env.snapshot');return {run_id:s.snapshot.run_id,account_id:s.snapshot.data.account_id,epoch:s.version.epoch};}
const inScope=(s,scope)=>scope.epoch===s.version.epoch&&scope.run_id===s.snapshot.run_id&&scope.account_id===s.snapshot.data.account_id;
const family=op=>op==='verification.reply'?'requests':'pickups';
function eligible(d,step,x){const c=d.cases.find(c=>c.id===x.selector.case_id);if(!c||!['active','withdrawal_pending'].includes(c.status))return false;
 if(step.operation==='verification.reply')return x.status==='pending';
 if(x.selector.return_mode!==c.return_mode||x.selector.device_serial!==(c.return_mode==='original_return'?c.old_serial:c.replacement_serial))return false;
 if(step.operation==='return.received')return x.status==='collected'&&!d.receipts.some(r=>same(r.selector,x.selector));
 const slot=d.slots.find(s=>s.id===x.slot_id),device=d.devices.find(e=>e.id===x.selector.device_serial);return x.status==='scheduled'&&slot&&device?.custody==='user'&&(c.return_mode!=='withdrawal_return'||c.fulfilment==='delivered')&&Date.parse(step.at)>=Date.parse(slot.start_at)&&Date.parse(step.at)<Date.parse(slot.end_at);
}
function directEligible(d,step){if(step.operation==='record.add')return true;const c=d.cases.find(c=>c.id===step.payload.case_id);if(!c)return false;if(step.operation==='replacement.dispatched')return c.fulfilment==='ordered'&&['active','withdrawal_pending','return_received'].includes(c.status);if(step.operation==='replacement.delivered')return c.fulfilment==='dispatched'&&['active','withdrawal_pending','return_received'].includes(c.status);if(step.operation==='hold.released')return c.hold_status==='release_pending';return false;}
async function prepareActorStep(infra,scope,spec){const s=await infra.call('env.snapshot');if(!inScope(s,scope))return {prepared:false,reason:'stale_scope'};const step={...structuredClone(spec),scope:structuredClone(scope)};
 if(['verification.reply','pickup.collected','return.received'].includes(step.operation)){
  const rows=s.snapshot.data[family(step.operation)].filter(x=>eligible(s.snapshot.data,step,x)&&Object.entries(step.intent||{}).every(([k,v])=>x.selector[k]===v));if(!rows.length)return {prepared:false,reason:'no_applicable_target'};if(rows.length!==1)throw Error('Ambiguous actor intent; select an exact historical generation');step.payload.selector=structuredClone(rows[0].selector);
 }else if(!directEligible(s.snapshot.data,step))return {prepared:false,reason:'no_applicable_target'};
 delete step.intent;return {prepared:true,step};
}
async function applyActorStep(infra,prepared){if(!prepared.prepared)return {emitted:false,reason:prepared.reason};const step=prepared.step,s=await infra.call('env.snapshot');if(!inScope(s,step.scope))return {emitted:false,reason:'stale_scope'};
 if(['verification.reply','pickup.collected','return.received'].includes(step.operation)){const rows=s.snapshot.data[family(step.operation)].filter(x=>same(x.selector,step.payload.selector));if(rows.length!==1||!eligible(s.snapshot.data,step,rows[0]))return {emitted:false,reason:'target_inactive'};}else if(!directEligible(s.snapshot.data,step))return {emitted:false,reason:'target_inactive'};
 return {emitted:true,result:await infra.call('env.apply_event',{expected_version:s.version,event:{event_id:step.event_id,at:step.at,operation:step.operation,payload:step.payload}})};
}
module.exports={actorScope,prepareActorStep,applyActorStep};
