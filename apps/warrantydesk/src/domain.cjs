'use strict';
const crypto=require('node:crypto');
const copy=x=>structuredClone(x),fail=(code,message)=>{throw Object.assign(new Error(message),{code});},check=(v,c,m)=>{if(!v)fail(c,m);};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const collections=['records','devices','offers','cases','slots','requests','pickups','receipts','postings'];
const all=d=>collections.flatMap(k=>d[k]),find=(d,k,id)=>{const x=d[k].find(x=>x.id===id);check(x,'not_found','Unknown '+k+' reference');return x;};
function id(d,p){let n=1;const used=new Set(all(d).map(x=>x.id));while(used.has(p+'-'+n))n++;return p+'-'+n;}
const time=x=>Date.parse(x),now=ctx=>time(ctx.virtual_now),before=(ctx,t)=>now(ctx)<time(t),person=(ctx,id)=>ctx.binding.people.some(p=>p.person_id===id);
const stamp=(ctx,d,operation,object_id,source_id)=>d.history.push({sequence:d.history.length+1,at:ctx.virtual_now,operation,object_id,source_id});
const target=c=>c.fulfilment==='cancelled_before_dispatch'?null:c.return_mode==='original_return'?c.old_serial:c.replacement_serial;
function pickupStatus(ctx,d,p){return p.status==='scheduled'&&!before(ctx,find(d,'slots',p.slot_id).end_at)?'missed':p.status;}
const livePickup=(ctx,d,p)=>pickupStatus(ctx,d,p)==='scheduled';
const receiptFor=(d,c)=>d.receipts.find(r=>r.selector.case_id===c.id&&r.selector.return_mode===c.return_mode&&r.selector.device_serial===target(c));
function caseView(ctx,d,c){return {...copy(c),overdue:c.status!=='open'&&target(c)!==null&&!receiptFor(d,c)&&!before(ctx,c.return_due_at),return_serial:target(c),held_cents:['authorized','release_pending'].includes(c.hold_status)?c.hold_amount_cents:0};}
function slotView(ctx,d,c,s,exclude=null){const used=d.pickups.filter(p=>p.id!==exclude&&p.slot_id===s.id&&livePickup(ctx,d,p)).length,free=Math.max(0,s.capacity-used);return {...copy(s),available:['active','withdrawal_pending'].includes(c.status)&&target(c)!==null&&before(ctx,s.book_before)&&before(ctx,s.start_at)&&free>0,free_capacity:free};}
function guardWithdraw(ctx,d,c){
 check(!d.pickups.some(p=>p.selector.case_id===c.id&&p.selector.return_mode==='original_return'&&p.status==='collected'),'return_already_started','Original parcel handoff cannot be recalled');
 check(c.status==='active'&&c.return_mode==='original_return','invalid_state','Only the active original-return remedy can be withdrawn');
 for(const p of d.pickups.filter(p=>p.selector.case_id===c.id&&livePickup(ctx,d,p)))check(before(ctx,find(d,'slots',p.slot_id).cancel_before),'pickup_locked','Cannot bypass a courier cancellation cutoff');
}
function quote(ctx,d,c,action){const o=find(d,'offers',c.offer_id);if(action==='accept')check(c.status==='open'&&o.eligible,'ineligible','No available eligible remedy');else guardWithdraw(ctx,d,c);
 const mode=action==='accept'?'original_return':'withdrawal_return',serial=action==='accept'?c.old_serial:c.fulfilment==='ordered'?null:c.replacement_serial;
 const q={case_id:c.id,offer_id:o.id,action,hold_amount_cents:o.hold_amount_cents,current_hold_status:c.hold_status,return_mode:mode,return_serial:serial,return_due_at:action==='accept'?o.return_due_at:o.withdrawal_return_due_at};
 return {...q,digest:digest({quote:q,case:c,offer:o,active_pickups:d.pickups.filter(p=>p.selector.case_id===c.id&&livePickup(ctx,d,p))})};
}
function posting(ctx,d,c,kind,source){const p={id:id(d,'posting'),case_id:c.id,kind,amount_cents:c.hold_amount_cents,currency:'USD',source_id:source,at:ctx.virtual_now};d.postings.push(p);stamp(ctx,d,'hold.'+kind,p.id,source);return p;}
function requestRelease(ctx,d,c,source){check(c.hold_status==='authorized','invalid_state','Hold is not awaiting a release request');c.hold_status='release_pending';c.release_requested_at=ctx.virtual_now;posting(ctx,d,c,'release_request',source);}
function selectRequest(d,selector){const rows=d.requests.filter(x=>digest(x.selector)===digest(selector));check(rows.length>0,'not_found','No historical request matches selector');check(rows.length===1,'ambiguous_target','Duplicate request selector');return rows[0];}
function selectPickup(d,selector){const rows=d.pickups.filter(x=>x.selector.case_id===selector.case_id&&x.selector.return_mode===selector.return_mode&&x.selector.pickup_attempt===selector.pickup_attempt);check(rows.length>0,'not_found','No historical pickup matches selector');check(rows.length===1,'ambiguous_target','Duplicate pickup selector');check(rows[0].selector.device_serial===selector.device_serial,'wrong_serial','Physical serial differs from the booked return');return rows[0];}
function newPickup(ctx,d,c,serial,slotId,exclude=null){
 check(['active','withdrawal_pending'].includes(c.status)&&target(c)!==null,'invalid_state','Case has no open physical return');check(serial===target(c),'wrong_serial','Use the active obligation serial');const s=find(d,'slots',slotId),o=find(d,'offers',c.offer_id);check(s.courier_actor_id===o.courier_actor_id,'wrong_source','Slot is not from the case courier');
 check(!d.pickups.some(p=>p.id!==exclude&&p.selector.case_id===c.id&&livePickup(ctx,d,p)),'pickup_exists','Case already has a live pickup');check(!d.pickups.some(p=>p.selector.case_id===c.id&&p.selector.return_mode===c.return_mode&&p.status==='collected'),'return_already_started','Active return was already collected');check(slotView(ctx,d,c,s,exclude).available,'slot_unavailable','Slot has closed or has no capacity');
 const attempt=Math.max(0,...d.pickups.filter(p=>p.selector.case_id===c.id&&p.selector.return_mode===c.return_mode&&p.selector.device_serial===serial).map(p=>p.selector.pickup_attempt))+1;
 return {id:id(d,'pickup'),selector:{case_id:c.id,return_mode:c.return_mode,device_serial:serial,pickup_attempt:attempt},slot_id:s.id,status:'scheduled',created_at:ctx.virtual_now,cancelled_at:null,cancel_reason:null,collected_at:null,collection_event_id:null};
}
module.exports={copy,fail,check,canonical,digest,collections,all,find,id,time,now,before,person,stamp,target,pickupStatus,livePickup,receiptFor,caseView,slotView,guardWithdraw,quote,posting,requestRelease,selectRequest,selectPickup,newPickup};
