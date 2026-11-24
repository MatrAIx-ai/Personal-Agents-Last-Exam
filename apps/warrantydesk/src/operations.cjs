'use strict';
const D=require('./domain.cjs');
function handleTool(ctx,d,tool,a){const name=tool.replace(/^warrantydesk\./,'');let value;
 if(name==='workspace.get')value={account_id:d.account_id,owner_person_id:d.owner_person_id,virtual_now:ctx.virtual_now};
 else if(name==='records.list')value={items:D.copy(d.records)};
 else if(name==='records.get')value={item:D.copy(D.find(d,'records',a.id))};
 else if(name==='case.get'){const c=D.find(d,'cases',a.id);value={item:D.caseView(ctx,d,c),offer:D.copy(D.find(d,'offers',c.offer_id)),devices:d.devices.filter(x=>[c.old_serial,c.replacement_serial].includes(x.id)).map(D.copy),receipts:d.receipts.filter(x=>x.selector.case_id===c.id).map(D.copy),postings:d.postings.filter(x=>x.case_id===c.id).map(D.copy)};}
 else if(name==='requests.list')value={items:D.copy(d.requests)};
 else if(name==='remedy.preview')value={quote:D.quote(ctx,d,D.find(d,'cases',a.case_id),a.action)};
 else if(name==='remedy.accept'||name==='remedy.withdraw'){
  const c=D.find(d,'cases',a.case_id),action=name.endsWith('accept')?'accept':'withdraw',q=D.quote(ctx,d,c,action);D.check(q.digest===a.quote_digest,'quote_changed','A matching current remedy preview is required');
  if(action==='accept'){c.status='active';c.fulfilment='ordered';c.hold_status='authorized';c.hold_amount_cents=q.hold_amount_cents;c.accepted_at=ctx.virtual_now;D.posting(ctx,d,c,'authorization',a.request_id);}
  else{
   for(const p of d.pickups.filter(p=>p.selector.case_id===c.id&&D.livePickup(ctx,d,p))){p.status='cancelled';p.cancelled_at=ctx.virtual_now;p.cancel_reason='withdrawal';D.stamp(ctx,d,'pickup.cancel',p.id,a.request_id);}
   for(const r of d.requests.filter(r=>r.selector.case_id===c.id&&r.status==='pending')){r.status='cancelled';r.cancelled_at=ctx.virtual_now;D.stamp(ctx,d,'verification.cancel',r.id,a.request_id);}
   c.status='withdrawal_pending';c.withdraw_requested_at=ctx.virtual_now;c.return_mode='withdrawal_return';c.return_due_at=q.return_due_at;
   if(c.fulfilment==='ordered'){c.fulfilment='cancelled_before_dispatch';D.requestRelease(ctx,d,c,a.request_id);}
  }
  D.stamp(ctx,d,name,c.id,a.request_id);value={item:D.copy(c)};
 }else if(name==='verification.request'){
  const c=D.find(d,'cases',a.case_id),o=D.find(d,'offers',c.offer_id);D.check(['active','withdrawal_pending'].includes(c.status),'invalid_state','Checks belong to an accepted open coordination case');D.check([c.old_serial,c.replacement_serial].includes(a.device_serial),'wrong_serial','Device does not belong to case');
  const matches=r=>r.selector.case_id===c.id&&r.selector.device_serial===a.device_serial&&r.selector.kind===a.kind;D.check(!d.requests.some(r=>matches(r)&&r.status==='pending'),'request_exists','This exact check already awaits a reply');
  const r={id:D.id(d,'request'),selector:{case_id:c.id,device_serial:a.device_serial,kind:a.kind,request_attempt:Math.max(0,...d.requests.filter(matches).map(r=>r.selector.request_attempt))+1},source_actor_id:a.kind==='work_enrollment'?o.it_actor_id:d.owner_person_id,status:'pending',reply:null,created_at:ctx.virtual_now,cancelled_at:null};d.requests.push(r);D.stamp(ctx,d,name,r.id,a.request_id);value={item:D.copy(r)};
 }else if(name==='verification.cancel'){
  const r=D.find(d,'requests',a.id);D.check(r.status==='pending','request_not_pending','Only a pending check can be cancelled');r.status='cancelled';r.cancelled_at=ctx.virtual_now;D.stamp(ctx,d,name,r.id,a.request_id);value={item:D.copy(r)};
 }else if(name==='pickup.options'){const c=D.find(d,'cases',a.case_id),o=D.find(d,'offers',c.offer_id);value={items:d.slots.filter(s=>s.courier_actor_id===o.courier_actor_id).map(s=>D.slotView(ctx,d,c,s))};}
 else if(name==='pickups.list')value={items:d.pickups.map(p=>({...D.copy(p),effective_status:D.pickupStatus(ctx,d,p)}))};
 else if(name==='pickup.schedule'){
  const c=D.find(d,'cases',a.case_id),p=D.newPickup(ctx,d,c,a.device_serial,a.slot_id);d.pickups.push(p);D.stamp(ctx,d,name,p.id,a.request_id);value={item:D.copy(p)};
 }else if(name==='pickup.cancel'||name==='pickup.reschedule'){
  const p=D.find(d,'pickups',a.id),s=D.find(d,'slots',p.slot_id),c=D.find(d,'cases',p.selector.case_id);D.check(D.livePickup(ctx,d,p),'pickup_inactive','Pickup is no longer scheduled');D.check(D.before(ctx,s.cancel_before),'cancellation_closed','Courier cancellation cutoff has passed');
  let replacement;if(name==='pickup.reschedule'){D.check(a.slot_id!==p.slot_id,'invalid_arguments','Choose a different pickup slot');replacement=D.newPickup(ctx,d,c,p.selector.device_serial,a.slot_id,p.id);}
  p.status='cancelled';p.cancelled_at=ctx.virtual_now;p.cancel_reason=replacement?'rescheduled':'agent_cancelled';D.stamp(ctx,d,'pickup.cancel',p.id,a.request_id);
  if(replacement){d.pickups.push(replacement);D.stamp(ctx,d,name,replacement.id,a.request_id);value={item:D.copy(replacement),cancelled:D.copy(p)};}else value={item:D.copy(p)};
 }else if(name==='case.close'){
  const c=D.find(d,'cases',a.id);D.check(['return_received','withdrawal_pending'].includes(c.status)&&c.hold_status==='released','settlement_pending','No completed physical/financial settlement');
  if(c.fulfilment!=='cancelled_before_dispatch'){D.check(c.fulfilment==='delivered'&&D.receiptFor(d,c),'missing_receipt','Closure requires actual delivery and matching return receipt');}
  for(const r of d.requests.filter(r=>r.selector.case_id===c.id&&r.status==='pending')){r.status='cancelled';r.cancelled_at=ctx.virtual_now;D.stamp(ctx,d,'verification.cancel',r.id,a.request_id);}
  c.status=c.return_mode==='original_return'?'closed':'withdrawn';c.closed_at=ctx.virtual_now;D.stamp(ctx,d,name,c.id,a.request_id);value={item:D.copy(c)};
 }else D.fail('unknown_tool','Unknown replacement operation');
 return {data:d,result:{value}};
}
module.exports={handleTool};
