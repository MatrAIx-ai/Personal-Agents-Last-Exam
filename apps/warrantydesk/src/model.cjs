'use strict';
const D=require('./domain.cjs');
function validateSeed(ctx,d){
 const ok=(x,m)=>D.check(x,'invalid_seed',m),validTime=x=>Number.isFinite(D.time(x)),past=x=>validTime(x)&&D.time(x)<=D.now(ctx),whole=x=>Number.isSafeInteger(x)&&x>=0;
 ok(D.person(ctx,d.owner_person_id)&&ctx.binding.accounts.some(a=>a.app_id===ctx.app_id&&a.account_id===d.account_id&&a.owner_person_id===d.owner_person_id),'Account/owner must match the Core binding');ok(Buffer.byteLength(JSON.stringify(d),'utf8')<=524288,'Business data exceeds 512 KiB');
 const objects=D.all(d),ids=new Set(objects.map(x=>x.id));ok(ids.size===objects.length,'Duplicate object ID');const maps=Object.fromEntries(D.collections.map(k=>[k,new Map(d[k].map(x=>[x.id,x]))])),get=(k,id)=>maps[k].get(id);
 for(const x of objects)for(const k of ['created_at','accepted_at','withdraw_requested_at','dispatched_at','delivered_at','release_requested_at','released_at','closed_at','cancelled_at','collected_at','received_at','erased_at','at'])if(x[k]!==undefined&&x[k]!==null)ok(past(x[k]),'Actual record has invalid/future time');
 for(const r of d.records)ok(D.person(ctx,r.source_actor_id)&&Buffer.byteLength(r.body,'utf8')<=65536,'Invalid record source/body');
 for(const e of d.devices)ok(e.owner_person_id===d.owner_person_id,'Foreign device ownership');
 for(const o of d.offers)ok(get('cases',o.case_id)&&[o.manufacturer_actor_id,o.courier_actor_id,o.it_actor_id].every(x=>D.person(ctx,x))&&whole(o.hold_amount_cents)&&o.currency==='USD'&&validTime(o.return_due_at)&&validTime(o.withdrawal_return_due_at),'Invalid offer reference, source or terms');
 for(const s of d.slots)ok(D.person(ctx,s.courier_actor_id)&&[s.start_at,s.end_at,s.book_before,s.cancel_before].every(validTime)&&D.time(s.start_at)<D.time(s.end_at)&&D.time(s.book_before)<=D.time(s.start_at)&&D.time(s.cancel_before)<=D.time(s.start_at)&&whole(s.capacity),'Invalid courier slot or cutoff chronology');
 const activeDevices=new Set();
 for(const c of d.cases){
  const o=get('offers',c.offer_id);ok(o&&o.case_id===c.id&&c.old_serial!==c.replacement_serial&&get('devices',c.old_serial)&&get('devices',c.replacement_serial),'Invalid case/offer/serial references');
  if(!['closed','withdrawn'].includes(c.status))for(const serial of [c.old_serial,c.replacement_serial]){ok(!activeDevices.has(serial),'Device has two active replacement cases');activeDevices.add(serial);}
  ok(c.return_due_at===(c.return_mode==='original_return'?o.return_due_at:o.withdrawal_return_due_at),'Obligation deadline differs from immutable offer');
  if(c.status==='open')ok(c.fulfilment==='not_ordered'&&c.hold_status==='none'&&c.hold_amount_cents===0&&c.accepted_at===null&&c.return_mode==='original_return','Unaccepted case has order/hold facts');
  else ok(c.accepted_at&&c.hold_amount_cents===o.hold_amount_cents&&c.hold_status!=='none'&&c.fulfilment!=='not_ordered','Accepted case lacks quoted authorization/order');
  if(c.return_mode==='withdrawal_return')ok(c.withdraw_requested_at&&D.time(c.withdraw_requested_at)>=D.time(c.accepted_at),'Withdrawal lacks ordered acceptance/request time');else ok(c.withdraw_requested_at===null,'Normal return has a withdrawal timestamp');
  if(c.dispatched_at)ok(c.accepted_at&&D.time(c.dispatched_at)>=D.time(c.accepted_at),'Dispatch predates acceptance');
  if(c.delivered_at)ok(c.dispatched_at&&D.time(c.delivered_at)>=D.time(c.dispatched_at),'Delivery lacks prior dispatch');
  if(c.fulfilment==='delivered')ok(c.delivered_at,'Delivered status lacks actual delivery');
  if(c.fulfilment==='dispatched')ok(c.dispatched_at&&!c.delivered_at,'Dispatch status has inconsistent actual facts');
  if(['ordered','not_ordered','cancelled_before_dispatch'].includes(c.fulfilment))ok(c.dispatched_at===null&&c.delivered_at===null,'Undispatched state has physical fulfilment facts');
  if(c.fulfilment==='cancelled_before_dispatch')ok(c.return_mode==='withdrawal_return'&&['withdrawal_pending','withdrawn'].includes(c.status),'Cancellation branch is not a withdrawal');
  const receipt=D.receiptFor(d,c);
  if(['return_received','closed'].includes(c.status)||(c.status==='withdrawn'&&c.fulfilment!=='cancelled_before_dispatch'))ok(receipt,'Settled/received case lacks actual matching manufacturer receipt');
  if(c.status==='closed')ok(c.return_mode==='original_return'&&c.fulfilment==='delivered'&&c.hold_status==='released'&&c.closed_at,'Normal closure lacks physical/financial completion');
  if(c.status==='withdrawn')ok(c.return_mode==='withdrawal_return'&&c.hold_status==='released'&&c.closed_at,'Withdrawal closure lacks actual financial completion');
  if(c.closed_at)ok(['closed','withdrawn'].includes(c.status)&&c.released_at&&D.time(c.closed_at)>=D.time(c.released_at),'Close time predates settled posting');
 }
 const requestKeys=new Set(),pending=new Set();for(const r of d.requests){
  const s=r.selector,c=get('cases',s.case_id),o=c&&get('offers',c.offer_id);ok(c&&[c.old_serial,c.replacement_serial].includes(s.device_serial),'Unknown request case/serial');ok(r.source_actor_id===(s.kind==='work_enrollment'?o.it_actor_id:d.owner_person_id),'Requested actor disagrees with private journal source role');
  const key=D.digest(s);ok(!requestKeys.has(key),'Duplicate verification generation');requestKeys.add(key);const subject=[s.case_id,s.device_serial,s.kind].join(':');if(r.status==='pending'){ok(!pending.has(subject),'Duplicate pending check');pending.add(subject);}
  if(r.reply){ok(past(r.reply.at)&&D.time(r.reply.at)>=D.time(r.created_at)&&r.reply.source_actor_id===r.source_actor_id,'Invalid reply time/source');ok(r.status==='cancelled'||r.status===r.reply.status,'Reply/status mismatch');ok(r.reply.status==='performed'?r.reply.result!==null:r.reply.result===null,'Performed/refused result mismatch');}
  else ok(['pending','cancelled'].includes(r.status),'Resolved check lacks source reply');
  if(r.status==='cancelled')ok(r.cancelled_at&&D.time(r.cancelled_at)>=D.time(r.created_at)&&(!r.reply||D.time(r.cancelled_at)>=D.time(r.reply.at)),'Invalid check cancellation chronology');
 }
 const pickupKeys=new Set(),activePickups=new Set();for(const p of d.pickups){
  const s=p.selector,c=get('cases',s.case_id),slot=get('slots',p.slot_id);ok(c&&slot&&s.device_serial===(s.return_mode==='original_return'?c.old_serial:c.replacement_serial)&&slot.courier_actor_id===get('offers',c.offer_id).courier_actor_id,'Pickup case/serial/provider mismatch');const key=D.digest(s);ok(!pickupKeys.has(key),'Duplicate pickup generation');pickupKeys.add(key);
  ok(D.time(p.created_at)<D.time(slot.book_before),'Pickup created after its booking cutoff');
  if(D.livePickup(ctx,d,p)){ok(!activePickups.has(c.id),'Duplicate effectively active pickup');activePickups.add(c.id);ok(c.return_mode===s.return_mode&&D.target(c)===s.device_serial,'Scheduled pickup has obsolete obligation');}
  if(p.status==='collected')ok(p.collected_at&&p.collection_event_id&&D.time(p.collected_at)>=D.time(slot.start_at)&&D.time(p.collected_at)<D.time(slot.end_at),'Collection lacks actual in-window evidence');else ok(p.collected_at===null&&p.collection_event_id===null,'Uncollected booking has a physical handoff');
  if(p.status==='cancelled')ok(p.cancelled_at&&D.time(p.cancelled_at)>=D.time(p.created_at)&&D.time(p.cancelled_at)<D.time(slot.cancel_before)&&p.cancel_reason,'Invalid pickup cancellation chronology');
 }
 const receiptKeys=new Set();for(const r of d.receipts){const p=get('pickups',r.pickup_id),c=get('cases',r.selector.case_id),o=c&&get('offers',c.offer_id);ok(p&&c&&D.digest(p.selector)===D.digest(r.selector)&&p.status==='collected'&&r.source_actor_id===o.manufacturer_actor_id&&D.time(r.received_at)>=D.time(p.collected_at),'Manufacturer receipt has wrong/missing collection, serial or source');const key=[c.id,r.selector.return_mode].join(':');ok(!receiptKeys.has(key),'Duplicate manufacturer return receipt');receiptKeys.add(key);const due=r.selector.return_mode==='original_return'?o.return_due_at:o.withdrawal_return_due_at;ok(r.returned_late===(D.time(r.received_at)>=D.time(due)),'Historical lateness flag disagrees with actual receipt time');}
 for(const c of d.cases){const posts=d.postings.filter(p=>p.case_id===c.id),types=posts.map(p=>p.kind);ok(new Set(types).size===types.length,'Duplicate authorization/release posting');let last=-Infinity;for(const p of posts){ok(whole(p.amount_cents)&&p.amount_cents===c.hold_amount_cents&&p.currency==='USD'&&D.time(p.at)>=last,'Invalid posted money/order');last=D.time(p.at);}
  const expected=c.hold_status==='none'?[]:c.hold_status==='authorized'?['authorization']:c.hold_status==='release_pending'?['authorization','release_request']:['authorization','release_request','release'];ok(JSON.stringify(types)===JSON.stringify(expected),'Hold stage disagrees with immutable posting history');
  if(posts.length)ok(posts[0].at===c.accepted_at,'Authorization time mismatch');if(posts.length>=2){ok(posts[1].at===c.release_requested_at,'Release-request time mismatch');ok(c.fulfilment==='cancelled_before_dispatch'||D.receiptFor(d,c),'Release requested without receipt or pre-dispatch cancellation');}if(posts.length===3)ok(posts[2].at===c.released_at,'Actual release time mismatch');
 }
 for(const p of d.postings)ok(get('cases',p.case_id),'Orphaned financial posting');
 for(const device of d.devices){
  const facts=[];for(const c of d.cases){if(c.replacement_serial===device.id){if(c.dispatched_at)facts.push([c.dispatched_at,1,'courier']);if(c.delivered_at)facts.push([c.delivered_at,2,'user']);}}
  for(const p of d.pickups)if(p.selector.device_serial===device.id&&p.collected_at)facts.push([p.collected_at,3,'courier']);for(const r of d.receipts)if(r.selector.device_serial===device.id)facts.push([r.received_at,4,'provider']);facts.sort((a,b)=>D.time(a[0])-D.time(b[0])||a[1]-b[1]);const original=d.cases.some(c=>c.old_serial===device.id)?'user':'provider';ok(device.custody===(facts.at(-1)?.[2]||original),'Device custody disagrees with actual delivery/return history');
  const wipes=d.requests.filter(r=>r.selector.device_serial===device.id&&r.selector.kind==='erasure'&&r.reply?.status==='performed'&&r.reply.result?.success).map(r=>r.reply.at).sort((a,b)=>D.time(a)-D.time(b));ok(device.erased===(wipes.length>0)&&device.erased_at===(wipes[0]||null),'First erasure fact differs from immutable performed-check history');
 }
 let at=-Infinity;for(const [i,h]of d.history.entries()){ok(h.sequence===i+1&&ids.has(h.object_id)&&past(h.at)&&D.time(h.at)>=at,'Invalid ordered business history');at=D.time(h.at);}
}
module.exports={validateSeed,objects:d=>D.all(d).map(x=>x.id),records:D.all,references:()=>[]};
