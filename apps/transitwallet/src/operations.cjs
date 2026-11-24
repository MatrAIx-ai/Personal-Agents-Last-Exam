'use strict';
const D=require('./domain.cjs');
const {copy,check,find,id,stamp,now,time,before,effective,bookingView,reservationOpen,routeView,balance,quote,ledger,nextAttempt}=D;
function handleTool(ctx,data,tool,a){
 const name=tool.replace(/^transitwallet\./,'');let value;
 if(name==='workspace.get')value={account_id:data.account_id,owner_person_id:data.owner_person_id,virtual_now:ctx.virtual_now,equipment:copy(data.equipment)};
 else if(name==='records.list')value={items:copy(data.records)};
 else if(name==='records.get')value={item:copy(find(data,'records',a.id))};
 else if(name==='routes.list')value={items:data.services.map(s=>routeView(ctx,data,s))};
 else if(name==='bookings.list')value={items:data.bookings.map(b=>bookingView(ctx,b))};
 else if(name==='requests.list')value={items:copy(data.requests)};
 else if(name==='journeys.list')value={items:copy(data.journeys)};
 else if(name==='wallet.get')value={currency:'USD',balance_cents:balance(data),ledger:copy(data.ledger)};
 else if(name==='booking.hold'){
  const s=find(data,'services',a.service_id);find(data,'equipment',a.equipment_id);
  check(reservationOpen(ctx,s),'window_closed','Reservation window is not open');check(s.status==='available','service_unavailable','Service cannot take new reservations');
  check(!data.bookings.some(b=>b.service_id===s.id&&['held','confirmed'].includes(effective(ctx,b))),'booking_exists','One live booking per service/account');check(routeView(ctx,data,s).free_capacity>0,'capacity_exceeded','No reservable capacity');
  const b={id:id(data,'booking'),service_id:s.id,booking_attempt:nextAttempt(data.bookings,x=>x.service_id===s.id),equipment_id:a.equipment_id,status:'held',fare_cents:s.fare_cents,cancel_fee_cents:s.cancel_fee_cents,currency:s.currency,hold_expires_at:s.hold_expires_at,confirm_before:s.confirm_before,cancel_before:s.cancel_before,depart_at:s.depart_at,created_at:ctx.virtual_now,confirmed_at:null,cancelled_at:null,consumed_at:null};data.bookings.push(b);stamp(ctx,data,name,b.id,a.request_id);value={item:copy(b)};
 }else if(name==='booking.preview')value={quote:quote(ctx,data,find(data,'bookings',a.id),a.action)};
 else if(name==='booking.confirm'||name==='booking.cancel'){
  const b=find(data,'bookings',a.id),action=name.endsWith('confirm')?'confirm':'cancel',q=quote(ctx,data,b,action);
  check(a.quote_digest===q.digest,'quote_changed','A matching current preview is required');const rows=[];
  if(action==='confirm'){
   check(q.balance_after_cents>=0,'insufficient_funds','Reservation wallet cannot cover fare');b.status='confirmed';b.confirmed_at=ctx.virtual_now;rows.push(ledger(ctx,data,b,'debit',b.fare_cents,a.request_id));
  }else{
   if(b.status==='confirmed')rows.push(ledger(ctx,data,b,'refund',q.refund_cents,a.request_id));b.status='cancelled';b.cancelled_at=ctx.virtual_now;
   for(const q of data.requests)if(q.kind==='assistance'&&q.selector.service_id===b.service_id&&q.selector.booking_attempt===b.booking_attempt&&['pending','confirmed'].includes(q.status)){q.status='cancelled';q.cancelled_at=ctx.virtual_now;stamp(ctx,data,'assistance.cancel',q.id,a.request_id);}
   for(const j of data.journeys)if(j.booking_id===b.id&&j.status==='planned'){j.status='cancelled';stamp(ctx,data,'journey.cancel',j.id,a.request_id);}
  }
  stamp(ctx,data,name,b.id,a.request_id);value={item:copy(b),ledger:copy(rows)};
 }else if(name==='verification.request'||name==='assistance.request'){
  const assist=name.startsWith('assistance');let e,s,b,selector,source;
  if(assist){
   b=find(data,'bookings',a.booking_id);s=find(data,'services',b.service_id);e=find(data,'equipment',b.equipment_id);
   check(['held','confirmed'].includes(effective(ctx,b))&&before(ctx,b.depart_at),'invalid_state','Assistance requires an active unused booking');
   check(!data.requests.some(q=>q.kind==='assistance'&&q.selector.service_id===b.service_id&&q.selector.booking_attempt===b.booking_attempt&&['pending','confirmed'].includes(q.status)),'request_exists','Cancel current assistance before requesting another snapshot');
   check(a.equipment_revision<=e.revision,'invalid_arguments','An Agent cannot invent a future equipment revision');
   selector={service_id:b.service_id,booking_attempt:b.booking_attempt,request_attempt:nextAttempt(data.requests,q=>q.kind==='assistance'&&q.selector.service_id===b.service_id&&q.selector.booking_attempt===b.booking_attempt)};source=s.provider_actor_id;
  }else{
   e=find(data,'equipment',a.equipment_id);check(!data.requests.some(q=>q.kind==='measurement'&&q.selector.equipment_id===e.id&&q.status==='pending'),'request_exists','Measurement request is already pending');
   selector={equipment_id:e.id,kind:'measurement',request_attempt:nextAttempt(data.requests,q=>q.kind==='measurement'&&q.selector.equipment_id===e.id)};source=e.owner_person_id;
  }
  const q={id:id(data,'request'),kind:assist?'assistance':'measurement',selector,source_actor_id:source,equipment_snapshot:{equipment_id:e.id,width_mm:assist?a.declared_width_mm:e.width_mm,equipment_revision:assist?a.equipment_revision:e.revision},status:'pending',reply:null,created_at:ctx.virtual_now,cancelled_at:null};data.requests.push(q);stamp(ctx,data,name,q.id,a.request_id);value={item:copy(q)};
 }else if(name==='verification.cancel'||name==='assistance.cancel'){
  const q=find(data,'requests',a.id),assist=name.startsWith('assistance');check(q.kind===(assist?'assistance':'measurement'),'wrong_subject','Wrong request family');check((assist?['pending','confirmed']:['pending']).includes(q.status),'request_not_pending','Request is not cancellable');
  if(assist){const s=find(data,'services',q.selector.service_id);check(before(ctx,s.depart_at),'departure_started','Cannot cancel assistance after departure');}
  q.status='cancelled';q.cancelled_at=ctx.virtual_now;stamp(ctx,data,name,q.id,a.request_id);value={item:copy(q)};
 }else if(name==='journey.plan'){
  const b=find(data,'bookings',a.booking_id);check(b.status==='confirmed'&&before(ctx,b.depart_at),'invalid_state','Plan an unused confirmed ticket before departure');check(!data.journeys.some(j=>j.booking_id===b.id&&['planned','in_transit'].includes(j.status)),'already_selected','Booking already has a live designation');
  const j={id:id(data,'journey'),selector:{service_id:b.service_id,booking_attempt:b.booking_attempt,journey_attempt:nextAttempt(data.journeys,x=>x.booking_id===b.id)},booking_id:b.id,status:'planned',created_at:ctx.virtual_now,departed_at:null,arrived_at:null,departure_event_id:null,arrival_event_id:null,actual_equipment:null,departure_snapshot:null,failure_reasons:[]};data.journeys.push(j);stamp(ctx,data,name,j.id,a.request_id);value={item:copy(j)};
 }else if(name==='journey.cancel'){
  const j=find(data,'journeys',a.id),b=find(data,'bookings',j.booking_id);check(j.status==='planned'&&before(ctx,b.depart_at),'departure_started','Only a planned not-yet-departed designation can be cancelled');j.status='cancelled';stamp(ctx,data,name,j.id,a.request_id);value={item:copy(j)};
 }else D.fail('unknown_tool','Unknown business operation');
 return {data,result:{value}};
}
module.exports={handleTool};
