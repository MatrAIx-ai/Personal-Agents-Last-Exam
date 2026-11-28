'use strict';
const D=require('./domain.cjs');
function applyEvent(ctx,d,event){const a=event.payload,op=event.operation;
 if(op==='record.add'){
  D.check(!D.all(d).some(x=>x.id===a.id),'already_exists','Immutable record ID already exists');D.check(D.person(ctx,a.source_actor_id),'wrong_source','Unknown source');d.records.push({...D.copy(a),created_at:ctx.virtual_now});D.stamp(ctx,d,op,a.id,event.event_id);
 }else if(op==='replacement.dispatched'||op==='replacement.delivered'){
  const c=D.find(d,'cases',a.case_id),o=D.find(d,'offers',c.offer_id),device=D.find(d,'devices',c.replacement_serial);D.check(a.replacement_serial===c.replacement_serial,'wrong_serial','Replacement serial differs from case');D.check(['active','withdrawal_pending','return_received'].includes(c.status),'invalid_state','Order is not open for fulfilment');
  if(op==='replacement.dispatched'){D.check(a.source_actor_id===o.manufacturer_actor_id,'wrong_source','Dispatch source must be manufacturer');D.check(c.fulfilment==='ordered','order_cancelled','Only an uncancelled ordered replacement can dispatch');c.fulfilment='dispatched';c.dispatched_at=ctx.virtual_now;device.custody='courier';}
  else{D.check(a.source_actor_id===o.courier_actor_id,'wrong_source','Delivery source must be the assigned courier');D.check(c.fulfilment==='dispatched','missing_dispatch','Delivery requires actual dispatch');c.fulfilment='delivered';c.delivered_at=ctx.virtual_now;device.custody='user';}
  D.stamp(ctx,d,op,c.id,event.event_id);
 }else if(op==='verification.reply'){
  const r=D.selectRequest(d,a.selector),c=D.find(d,'cases',r.selector.case_id),device=D.find(d,'devices',r.selector.device_serial);D.check(r.status==='pending','request_not_pending','Reply must bind the original pending generation');D.check(a.source_actor_id===r.source_actor_id&&D.person(ctx,a.source_actor_id),'wrong_source','Reply source differs from requested actor');D.check(['active','withdrawal_pending'].includes(c.status),'invalid_state','Case no longer accepts this requested work');
  if(a.status==='performed'){D.check(a.result!==null,'invalid_arguments','Performed work needs actual boolean outcomes');D.check(device.custody==='user','device_unavailable','A performed local check requires the actual device with the user');if(r.selector.kind==='erasure'&&a.result.success&&!device.erased){device.erased=true;device.erased_at=ctx.virtual_now;}}
  else D.check(a.status==='refused'&&a.result===null,'invalid_arguments','A refusal cannot claim performed work');
  r.status=a.status;r.reply={at:ctx.virtual_now,source_actor_id:a.source_actor_id,source_event_id:event.event_id,status:a.status,result:D.copy(a.result)};D.stamp(ctx,d,op,r.id,event.event_id);
 }else if(op==='pickup.collected'||op==='return.received'){
  const p=D.selectPickup(d,a.selector),c=D.find(d,'cases',p.selector.case_id),o=D.find(d,'offers',c.offer_id),slot=D.find(d,'slots',p.slot_id),device=D.find(d,'devices',p.selector.device_serial);
  D.check(p.selector.return_mode===c.return_mode&&p.selector.device_serial===D.target(c),'wrong_obligation','Return no longer belongs to the active case obligation');D.check(['active','withdrawal_pending'].includes(c.status),'invalid_state','Case has no outstanding return');
  if(op==='pickup.collected'){
   D.check(a.source_actor_id===o.courier_actor_id,'wrong_source','Collection source must be the assigned courier');D.check(p.status==='scheduled','pickup_inactive','Cancelled or collected pickup cannot collect again');D.check(D.now(ctx)>=D.time(slot.start_at)&&D.before(ctx,slot.end_at),'invalid_time','Collection must occur in its booked window');D.check(device.custody==='user','device_unavailable','Target serial is not with the user');
   if(c.return_mode==='withdrawal_return')D.check(c.fulfilment==='delivered','missing_delivery','Cannot return a replacement not actually delivered');
   p.status='collected';p.collected_at=ctx.virtual_now;p.collection_event_id=event.event_id;device.custody='courier';D.stamp(ctx,d,op,p.id,event.event_id);
  }else{
   D.check(a.source_actor_id===o.manufacturer_actor_id,'wrong_source','Receipt source must be manufacturer');D.check(p.status==='collected'&&p.collected_at&&D.now(ctx)>=D.time(p.collected_at),'missing_collection','Manufacturer receipt requires the actual matching pickup');D.check(!D.receiptFor(d,c),'receipt_exists','Obligation already has a manufacturer receipt');
   const receipt={id:D.id(d,'receipt'),selector:D.copy(p.selector),pickup_id:p.id,source_actor_id:a.source_actor_id,source_event_id:event.event_id,received_at:ctx.virtual_now,returned_late:D.now(ctx)>=D.time(c.return_due_at)};d.receipts.push(receipt);device.custody='provider';c.status='return_received';D.requestRelease(ctx,d,c,event.event_id);D.stamp(ctx,d,op,receipt.id,event.event_id);
  }
 }else if(op==='hold.released'){
  const c=D.find(d,'cases',a.case_id),o=D.find(d,'offers',c.offer_id);D.check(a.source_actor_id===o.manufacturer_actor_id,'wrong_source','Financial posting source must be provider');D.check(c.hold_status==='release_pending','settlement_pending','A release request is required before posting');
  if(c.fulfilment==='cancelled_before_dispatch')D.check(a.reason==='cancelled_before_dispatch','wrong_obligation','Pre-dispatch cancellation needs its actual settlement reason');
  else{D.check(a.return_mode===c.return_mode&&a.device_serial===D.target(c),'wrong_obligation','Release must name the active return mode and serial');D.check(D.receiptFor(d,c),'missing_receipt','No actual manufacturer receipt for release');}
  c.hold_status='released';c.released_at=ctx.virtual_now;D.posting(ctx,d,c,'release',event.event_id);D.stamp(ctx,d,op,c.id,event.event_id);
 }else D.fail('invalid_event','Unknown incoming operation');
 return d;
}
module.exports={applyEvent};
