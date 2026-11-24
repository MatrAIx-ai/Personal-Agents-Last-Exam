'use strict';
const D=require('./domain.cjs');
function validateSeed(ctx,d){
 const ok=(v,m)=>D.check(v,'invalid_seed',m),finite=t=>Number.isFinite(Date.parse(t)),past=t=>finite(t)&&Date.parse(t)<=D.now(ctx),whole=x=>Number.isSafeInteger(x)&&x>=0;
 ok(ctx.binding.accounts.some(a=>a.app_id===ctx.app_id&&a.account_id===d.account_id&&a.owner_person_id===d.owner_person_id)&&D.person(ctx,d.owner_person_id),'Account/owner must match the Core binding');
 ok(Buffer.byteLength(JSON.stringify(d),'utf8')<=524288,'Business data exceeds 512 KiB');
 const objects=D.all(d),ids=new Set(objects.map(x=>x.id));ok(ids.size===objects.length,'Duplicate object ID');
 const maps=Object.fromEntries(D.collections.map(k=>[k,new Map(d[k].map(x=>[x.id,x]))])),get=(k,x)=>maps[k].get(x);
 for(const x of objects)for(const k of ['created_at','updated_at','confirmed_at','cancelled_at','consumed_at','departed_at','arrived_at'])if(x[k]!==undefined&&x[k]!==null)ok(past(x[k]),'Actual business record has invalid/future time');
 for(const r of d.records)ok(D.person(ctx,r.source_actor_id)&&Buffer.byteLength(r.body,'utf8')<=65536,'Unknown record source or oversized body');
 for(const e of d.equipment)ok(e.owner_person_id===d.owner_person_id&&whole(e.width_mm)&&e.width_mm>0&&whole(e.revision)&&e.revision>0,'Invalid equipment owner/measurement');
 for(const s of d.services){
  ok(D.person(ctx,s.provider_actor_id),'Unknown service provider');ok([s.reserve_from,s.reserve_before,s.confirm_before,s.hold_expires_at,s.cancel_before,s.depart_at,s.scheduled_arrival_at].every(finite),'Invalid service timestamps');
  ok(D.time(s.reserve_from)<D.time(s.reserve_before)&&D.time(s.reserve_before)<=D.time(s.confirm_before)&&D.time(s.hold_expires_at)<=D.time(s.confirm_before)&&D.time(s.confirm_before)<=D.time(s.depart_at)&&D.time(s.cancel_before)<=D.time(s.depart_at)&&D.time(s.depart_at)<=D.time(s.scheduled_arrival_at),'Service cutoff chronology');
  ok(whole(s.fare_cents)&&whole(s.cancel_fee_cents)&&s.cancel_fee_cents<=s.fare_cents&&s.currency==='USD'&&s.width_mm>0&&whole(s.capacity),'Invalid fare/dimensions/capacity');
  let previous=-Infinity;for(const c of s.changes){ok(past(c.at)&&D.time(c.at)>=previous,'Service history chronology');previous=D.time(c.at);}if(s.changes.length){const c=s.changes.at(-1);ok(c.status===s.status&&c.width_mm===s.width_mm,'Service head differs from accepted history');}
 }
 const bookingKeys=new Set(),live=new Set();for(const b of d.bookings){
  const s=get('services',b.service_id);ok(s&&get('equipment',b.equipment_id),'Unknown booking reference');
  const k=b.service_id+':'+b.booking_attempt;ok(whole(b.booking_attempt)&&b.booking_attempt>0&&!bookingKeys.has(k),'Duplicate/invalid booking generation');bookingKeys.add(k);
  ok(['held','confirmed','cancelled','consumed'].includes(b.status),'Invalid booking status');
  for(const k of ['fare_cents','cancel_fee_cents','currency','hold_expires_at','confirm_before','cancel_before','depart_at'])ok(b[k]===s[k],'Locked booking terms disagree with its immutable dated offer');
  ok(D.time(b.created_at)>=D.time(s.reserve_from)&&D.time(b.created_at)<D.time(s.reserve_before),'Booking was made outside its reservation window');
  if(['held','confirmed'].includes(D.effective(ctx,b))){ok(!live.has(b.service_id),'Duplicate live account booking');live.add(b.service_id);}
  if(b.confirmed_at)ok(D.time(b.confirmed_at)>=D.time(b.created_at)&&D.time(b.confirmed_at)<Math.min(D.time(b.hold_expires_at),D.time(b.confirm_before)),'Invalid confirmation time');
  if(['confirmed','consumed'].includes(b.status))ok(b.confirmed_at!==null,'Paid booking requires confirmation');
  if(b.status==='held')ok(b.confirmed_at===null&&b.cancelled_at===null&&b.consumed_at===null,'Held booking has terminal facts');
  if(b.status==='cancelled')ok(b.cancelled_at!==null&&b.consumed_at===null&&(!b.confirmed_at||D.time(b.cancelled_at)<D.time(b.cancel_before)),'Invalid cancellation record');
 }
 const requestKeys=new Set(),activeRequests=new Set();for(const q of d.requests){
  const v=q.selector,key=q.kind+':'+D.digest(v);ok(!requestKeys.has(key),'Duplicate request selector');requestKeys.add(key);
  const e=get('equipment',q.equipment_snapshot.equipment_id);ok(e&&q.equipment_snapshot.width_mm>0&&q.equipment_snapshot.equipment_revision<=e.revision&&D.person(ctx,q.source_actor_id),'Invalid request equipment/source');
  let parent;
  if(q.kind==='measurement')ok(v.equipment_id===e.id&&v.kind==='measurement'&&q.source_actor_id===e.owner_person_id,'Measurement subject/source mismatch');
  else{parent=d.bookings.find(b=>b.service_id===v.service_id&&b.booking_attempt===v.booking_attempt);ok(parent&&parent.equipment_id===e.id&&q.source_actor_id===get('services',parent.service_id).provider_actor_id,'Assistance subject/source mismatch');}
  const active=q.kind==='measurement'?q.status==='pending':['pending','confirmed'].includes(q.status);
  if(active){const key=q.kind+':'+(q.kind==='measurement'?e.id:parent.id);ok(!activeRequests.has(key),'Duplicate active request');activeRequests.add(key);}
  if(q.reply){ok(past(q.reply.at)&&D.time(q.reply.at)>=D.time(q.created_at)&&q.reply.source_actor_id===q.source_actor_id,'Invalid performed reply chronology/source');ok(q.status==='cancelled'||q.status===q.reply.status,'Reply and current status mismatch');ok(q.kind==='measurement'?['performed','refused'].includes(q.reply.status):['confirmed','refused'].includes(q.reply.status),'Wrong reply family');if(q.reply.status==='performed')ok(q.reply.observation&&q.reply.observation.equipment_revision<=e.revision,'Performed measurement requires valid actual observation');else ok(q.reply.observation===null,'Non-measurement reply cannot report dimensions');}
  else ok(['pending','cancelled'].includes(q.status),'Resolved request lacks source reply');
  if(q.status==='cancelled')ok(q.cancelled_at!==null&&D.time(q.cancelled_at)>=D.time(q.created_at)&&(!q.reply||D.time(q.cancelled_at)>=D.time(q.reply.at)),'Cancellation must retain a valid ordered time');
 }
 const journeyKeys=new Set(),liveJourneys=new Set(),departed=new Set();for(const j of d.journeys){
  const b=get('bookings',j.booking_id);ok(b&&j.selector.service_id===b.service_id&&j.selector.booking_attempt===b.booking_attempt,'Journey selector differs from booking');const k=D.digest(j.selector);ok(!journeyKeys.has(k),'Duplicate journey selector');journeyKeys.add(k);
  if(['planned','in_transit'].includes(j.status)){ok(!liveJourneys.has(b.id),'Duplicate live journey');liveJourneys.add(b.id);}
  if(j.departed_at){
   ok(!departed.has(b.id)&&b.status==='consumed'&&b.consumed_at===j.departed_at&&D.time(j.departed_at)===D.time(b.depart_at),'Invalid duplicate departure/consumption');departed.add(b.id);ok(j.actual_equipment&&j.departure_snapshot&&j.departure_event_id,'Departure lacks physical evidence');
   const snap=j.departure_snapshot,ref=snap.assistance_request_id,q=ref===null?null:get('requests',ref);
   ok(ref===null||(q?.kind==='assistance'&&q.selector.service_id===b.service_id&&q.selector.booking_attempt===b.booking_attempt&&q.reply?.status==='confirmed'&&D.time(q.reply.at)<=D.time(j.departed_at)&&(!q.cancelled_at||D.time(q.cancelled_at)>D.time(j.departed_at))),'Departure assistance has wrong booking or was not confirmed at departure');
   const reasons=[];if(snap.service_status!=='available')reasons.push('service_unavailable');if(j.actual_equipment.width_mm>snap.service_width_mm)reasons.push('equipment_incompatible');if(!snap.user_ready)reasons.push('user_not_ready');if(!q)reasons.push('assistance_missing');else if(q.equipment_snapshot.width_mm!==j.actual_equipment.width_mm||q.equipment_snapshot.equipment_revision!==j.actual_equipment.equipment_revision)reasons.push('assistance_equipment_mismatch');
   ok(JSON.stringify(reasons)===JSON.stringify(j.failure_reasons)&&['failed','in_transit','completed'].includes(j.status)&&(j.status==='failed')===(reasons.length>0),'Physical snapshot, outcome and failure reasons disagree');
  }
  else ok(['planned','cancelled'].includes(j.status)&&j.arrived_at===null&&j.actual_equipment===null&&j.departure_snapshot===null&&j.failure_reasons.length===0,'Unperformed designation has actual travel facts');
  if(j.status==='completed')ok(j.arrived_at&&j.arrival_event_id&&D.time(j.arrived_at)>=D.time(j.departed_at),'Completion lacks valid actual arrival');else ok(j.arrived_at===null&&j.arrival_event_id===null,'Non-completed journey has arrival');
 }
 for(const b of d.bookings)ok((b.status==='consumed')===departed.has(b.id),'Consumed ticket must have exactly one departure outcome');
 let funds=0,previous=-Infinity;const debits=new Map(),refunds=new Map();let openings=0;
 for(const l of d.ledger){
  ok(whole(l.amount_cents)&&l.currency==='USD'&&D.time(l.created_at)>=previous,'Invalid money/currency/ledger chronology');previous=D.time(l.created_at);
  if(l.kind==='opening_credit'){ok(l.booking_id===null,'Opening balance cannot reference a booking');openings++;funds+=l.amount_cents;}
  else{const b=get('bookings',l.booking_id);ok(b,'Unknown ledger booking');const target=l.kind==='debit'?debits:refunds;ok(!target.has(b.id),'Duplicate financial effect');target.set(b.id,l);ok(l.amount_cents===(l.kind==='debit'?b.fare_cents:b.fare_cents-b.cancel_fee_cents),'Posted amount differs from locked fare policy');funds+=l.kind==='debit'?-l.amount_cents:l.amount_cents;}
  ok(funds>=0&&funds<=100000000,'Wallet prefixes must stay within valid funds');
 }
 ok(openings===1,'Exactly one original opening credit is required');
 for(const b of d.bookings){ok(debits.has(b.id)===(b.confirmed_at!==null),'Confirmation/debit mismatch');ok(refunds.has(b.id)===(b.status==='cancelled'&&b.confirmed_at!==null),'Paid cancellation/refund mismatch');if(debits.has(b.id))ok(debits.get(b.id).created_at===b.confirmed_at,'Debit time mismatch');if(refunds.has(b.id))ok(refunds.get(b.id).created_at===b.cancelled_at,'Refund time mismatch');}
 let at=-Infinity;for(const [i,h]of d.history.entries()){ok(h.sequence===i+1&&ids.has(h.object_id)&&past(h.at)&&D.time(h.at)>=at,'Invalid ordered business history');at=D.time(h.at);}
}
module.exports={validateSeed,objects:d=>D.all(d).map(x=>x.id),records:D.all,references:()=>[]};
