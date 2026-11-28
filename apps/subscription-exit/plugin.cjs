'use strict';
const APP='subscription-exit';
const PLAN=Object.freeze({id:'plan-1',service:'Echo Arbor (fictional)',name:'Individual',currency:'CNY',renewal_minor:2900,charge_simulated:false});
const FLOOR=Date.parse('2025-01-01T00:00:00Z'), millis=Date.parse, utc=t=>new Date(t).toISOString();
function fail(code,message){throw Object.assign(new Error(message),{code});}
function bound(ctx,d){const owner=ctx.binding?.accounts?.find(a=>a.app_id===APP&&a.account_id===d.account_id)?.owner_person_id;return ctx.binding?.people?.some(p=>p.person_id===owner);}
function objects(d){return [PLAN.id,d.account_id,...records(d).map(r=>r.id)];}
// Core fingerprints record bodies without their id. Sequence preserves each distinct preview attempt even at one virtual instant.
function records(d){return [...d.saved,...d.history,...d.previews.map((p,index)=>({...p,preview_sequence:index+1})),...d.action_receipts];}
function validateSeed(ctx,d){
 const now=millis(ctx.virtual_now),start=millis(d.period_start),end=millis(d.period_end),next=millis(d.next_period_end);
 if(!bound(ctx,d))fail('invalid_seed','Account must have a trusted binding.');
 if(new Set(objects(d)).size!==objects(d).length)fail('invalid_seed','Object IDs must be unique.');
 if(!(FLOOR<=start&&start<=now&&start<end&&(d.phase?end<=next:end<next)))fail('invalid_seed','Period dates must be ordered and current period must have started.');
 const ended=millis(d.ended_at);
 const notYetSubscribed=d.status==='free'&&d.phase===0&&d.ended_at===null&&now<end&&records(d).length===0;
 if(d.status==='free' ? !notYetSubscribed&&!(d.phase===1&&ended===end&&ended<=now) : d.ended_at!==null)fail('invalid_seed','Entitlement date and phase do not agree.');
 if(d.saved.concat(d.history).some(r=>!(FLOOR<=millis(r.at||r.saved_at)&&millis(r.at||r.saved_at)<=now)))fail('invalid_seed','History and saved entries must be within the past of the scenario.');
 if(d.previews.some(p=>!(FLOOR<=millis(p.created_at)&&millis(p.created_at)<=now)||p.phase>d.phase||p.decision_revision>d.decision_revision))fail('invalid_seed','Invalid preview history.');
 const receiptIds=new Set();
 for(const r of d.action_receipts){
  const p=d.previews.find(x=>x.id===r.preview_id);
  const at=millis(r.confirmed_at);
  if(!p||receiptIds.has(p.id)||p.status!=='confirmed'||p.action!==r.action||!(millis(p.created_at)<=at&&at<=now&&at<millis(r.effective_at))||r.resulting_status!==(r.action==='cancel'?'cancellation_scheduled':'paid_active'))fail('invalid_seed','Invalid confirmation receipt.');
  receiptIds.add(p.id);
 }
 if(d.previews.some(p=>p.status==='confirmed'&&!receiptIds.has(p.id)))fail('invalid_seed','Confirmed previews require receipts.');
}
function projection(d,now){
 if(d.status==='free'||millis(now)<millis(d.period_end))return d;
 if(d.status==='cancellation_scheduled')return {...d,phase:1,status:'free',ended_at:d.period_end};
 if(d.phase)return d;
 return {...d,phase:1,period_start:d.period_end,period_end:d.next_period_end};
}
function view(d){
 return {access:d.status==='free'?'free':'paid',entitlement:d.status,period_start:d.period_start,period_end:d.period_end,
 next_period_end:d.phase?null:d.next_period_end,effective_end:d.status==='free'?d.ended_at:d.status==='cancellation_scheduled'?d.period_end:null,
 renewal:d.status!=='paid_active'?'off':d.phase?'outside_scenario':'scheduled',
 transition_consumed:Boolean(d.phase),saved:d.saved};
}
function handleTool(ctx,stored,name,a){
 if(!bound(ctx,stored))fail('permission_denied','Unbound account.');
 if(a.account_id!==undefined&&a.account_id!==stored.account_id)fail('not_found','Account not found.');
 const clock=utc(ctx.virtual_now), d=projection(stored,clock), entitlement=()=>view(d), op=name.slice(APP.length+1);
 // Runtime copies inputs. Return original stored data for every read, including a projected status.
 const account_name=ctx.binding.people.find(p=>p.person_id===ctx.binding.accounts.find(a=>a.app_id===APP&&a.account_id===d.account_id).owner_person_id).name;
 const output=(x,data=stored)=>({data,result:{virtual_now:clock,...x}});
 const allowed=action=>{
  if(d.status==='free')fail('free_account','Paid access has ended. Re-subscription is not part of this scenario.');
  if(d.phase&&millis(clock)>=millis(d.period_end))fail('period_outside_scenario','The last modeled billing period has ended. No later renewal is simulated.');
  if(action==='cancel'&&d.status!=='paid_active')fail('cancellation_already_scheduled','A cancellation is already scheduled.');
  if(action==='revoke'&&d.status!=='cancellation_scheduled')fail('no_pending_cancellation','There is no scheduled cancellation to revoke.');
 };
 const current=p=>p.phase===d.phase&&p.decision_revision===d.decision_revision&&d.status!=='free'&&(!d.phase||millis(clock)<millis(d.period_end));
 const getPreview=()=>stored.previews.find(p=>p.id===a.preview_id)||fail('not_found','Preview not found.');
 switch(op){
  case 'read_plan':return output({plan:PLAN,account_name,entitlement:entitlement()});
  case 'read_status':return output({plan:PLAN,account_name,entitlement:entitlement(),history:stored.history,open_previews:stored.previews.filter(p=>p.status==='open'&&current(p)),receipts:stored.action_receipts});
  case 'read_receipt':{
   const receipt=stored.action_receipts.find(r=>r.id===a.receipt_id)||fail('not_found','Receipt not found.');
   return output({receipt,entitlement:entitlement()});
  }
  case 'prepare_cancellation':
  case 'prepare_revocation':{
   const action=op==='prepare_cancellation'?'cancel':'revoke';
   allowed(action);
   if(stored.previews.length>=128)fail('capacity','Preview capacity reached.');
   const ids=new Set(objects(stored)); let i=1; while(ids.has('SE-P'+i)||ids.has('SE-R'+i))i++;
   const p={id:'SE-P'+i,action,status:'open',phase:d.phase,decision_revision:d.decision_revision,created_at:clock};
   d.previews.push(p);return output({preview:p,entitlement:entitlement()},d);
  }
  case 'abandon':{
   const p=getPreview();
   if(p.status!=='open')fail('not_open','Only an open preview can be abandoned.');
   if(!current(p))fail('stale_preview','The period or prior decision changed. This preview is stale.');
   p.status='abandoned';return output({preview:p,entitlement:entitlement()},d);
  }
  case 'confirm':{
   const p=getPreview();
   if(p.status==='confirmed'){
    const original=stored.action_receipts.find(r=>r.preview_id===p.id);
    fail('already_confirmed','Already confirmed. Read receipt '+original.id+' or retry the identical request.');
   }
   if(p.status!=='open')fail('not_open','Only an open preview can be confirmed.');
   if(!current(p))fail('stale_preview','The period or prior decision changed. This preview is stale.');
   allowed(p.action);
   if(d.decision_revision>=128||d.action_receipts.length>=128)fail('capacity','Confirmation capacity reached.');
   const ids=new Set(objects(stored));let i=1;while(ids.has('SE-R'+i))i++;
   d.decision_revision++;d.status=p.action==='cancel'?'cancellation_scheduled':'paid_active';p.status='confirmed';
   const receipt={id:'SE-R'+i,preview_id:p.id,action:p.action,confirmed_at:clock,resulting_status:d.status,effective_at:d.period_end};
   d.action_receipts.push(receipt);return output({receipt,entitlement:entitlement()},d);
  }
  default:fail('invalid_arguments','Unknown operation.');
 }
}
module.exports={validateSeed,handleTool,applyEvent:()=>fail('invalid_event','The only boundary is derived from Infra virtual time.'),objects,records,references:()=>[]};
