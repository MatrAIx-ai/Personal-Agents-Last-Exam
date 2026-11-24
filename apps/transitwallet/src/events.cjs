'use strict';
const {check,fail,copy,all,find,select,stamp,now,time,before,person,effective}=require('./domain.cjs');
function applyEvent(ctx,data,event){
 const a=event.payload,op=event.operation;
 if(op==='record.add'){
  check(!all(data).some(x=>x.id===a.id),'already_exists','Record IDs are immutable');check(person(ctx,a.source_actor_id),'wrong_source','Unknown record source');data.records.push({...copy(a),created_at:ctx.virtual_now});stamp(ctx,data,op,a.id,event.event_id);
 }else if(op==='route.update'){
  const s=find(data,'services',a.service_id);check(a.source_actor_id===s.provider_actor_id,'wrong_source','Provider must own the dated service');s.status=a.status;if(a.width_mm!==undefined)s.width_mm=a.width_mm;s.changes.push({at:ctx.virtual_now,status:s.status,width_mm:s.width_mm,source_event_id:event.event_id});stamp(ctx,data,op,s.id,event.event_id);
 }else if(op==='verification.reply'||op==='assistance.reply'){
  const q=select(data,'requests',a.selector),assist=op==='assistance.reply';check(q.kind===(assist?'assistance':'measurement'),'wrong_subject','Reply family differs from request');check(q.status==='pending','request_not_pending','Reply must match the exact pending generation');check(a.source_actor_id===q.source_actor_id&&person(ctx,a.source_actor_id),'wrong_source','Reply source differs from requested participant');
  let observation=null;
  if(assist){
   const b=data.bookings.find(b=>b.service_id===q.selector.service_id&&b.booking_attempt===q.selector.booking_attempt);check(b&&['held','confirmed'].includes(effective(ctx,b))&&before(ctx,b.depart_at),'invalid_state','Assistance parent is inactive or departed');check(a.equipment_revision===q.equipment_snapshot.equipment_revision,'wrong_subject','Provider reply must bind the declared equipment revision');
  }else if(a.status==='performed'){
   check(a.observation,'invalid_arguments','Performed measurement needs actual dimensions');const e=find(data,'equipment',q.selector.equipment_id);check(a.observation.equipment_revision>=e.revision,'stale_equipment','Cannot replace a newer observation');check(a.observation.equipment_revision!==e.revision||a.observation.width_mm===e.width_mm,'wrong_subject','The same revision cannot have different dimensions');e.width_mm=a.observation.width_mm;e.revision=a.observation.equipment_revision;e.updated_at=ctx.virtual_now;observation=copy(a.observation);
  }else check(a.observation===null,'invalid_arguments','A refusal cannot claim a performed measurement');
  q.status=a.status;q.reply={at:ctx.virtual_now,source_event_id:event.event_id,source_actor_id:a.source_actor_id,status:a.status,observation};stamp(ctx,data,op,q.id,event.event_id);
 }else if(op==='journey.perform'){
  const j=select(data,'journeys',a.selector),b=find(data,'bookings',j.booking_id),s=find(data,'services',b.service_id);check(a.source_actor_id===s.provider_actor_id,'wrong_source','Journey outcome must come from its provider');
  if(a.phase==='departure'){
   check(j.status==='planned'&&b.status==='confirmed','invalid_state','Departure requires the exact planned unused ticket');check(now(ctx)===time(s.depart_at),'invalid_time','Departure event must occur at the dated service departure');
   const e=find(data,'equipment',b.equipment_id),actual=a.actual_equipment;check(actual.equipment_revision>=e.revision,'stale_equipment','Physical observation cannot contradict a newer revision');check(actual.equipment_revision!==e.revision||actual.width_mm===e.width_mm,'wrong_subject','Physical revision has inconsistent dimensions');
   if(actual.equipment_revision>e.revision){e.width_mm=actual.width_mm;e.revision=actual.equipment_revision;e.updated_at=ctx.virtual_now;}
   const q=data.requests.find(q=>q.kind==='assistance'&&q.selector.service_id===b.service_id&&q.selector.booking_attempt===b.booking_attempt&&q.status==='confirmed');const reasons=[];
   if(s.status!=='available')reasons.push('service_unavailable');if(actual.width_mm>s.width_mm)reasons.push('equipment_incompatible');if(!a.user_ready)reasons.push('user_not_ready');if(!q)reasons.push('assistance_missing');else if(q.equipment_snapshot.width_mm!==actual.width_mm||q.equipment_snapshot.equipment_revision!==actual.equipment_revision)reasons.push('assistance_equipment_mismatch');
   j.departed_at=ctx.virtual_now;j.departure_event_id=event.event_id;j.actual_equipment=copy(actual);j.departure_snapshot={service_status:s.status,service_width_mm:s.width_mm,user_ready:a.user_ready,assistance_request_id:q?.id||null};j.failure_reasons=reasons;j.status=reasons.length?'failed':'in_transit';b.status='consumed';b.consumed_at=ctx.virtual_now;stamp(ctx,data,'booking.consume',b.id,event.event_id);
  }else{
   check(a.phase==='arrival'&&j.status==='in_transit','invalid_state','Arrival requires a successful actual departure');check(now(ctx)>=time(j.departed_at),'invalid_time','Arrival cannot precede departure');j.status='completed';j.arrived_at=ctx.virtual_now;j.arrival_event_id=event.event_id;
  }
  stamp(ctx,data,op,j.id,event.event_id);
 }else fail('invalid_event','Unknown event operation');
 return data;
}
module.exports={applyEvent};
