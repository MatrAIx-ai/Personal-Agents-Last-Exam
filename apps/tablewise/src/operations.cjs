'use strict';
const m=require('./model.cjs'),{need,find,id,stamp}=m;
function handleTool(ctx,data,name,a){const d=structuredClone(data),op=name.replace(/^tablewise\./,'');let result;
 if(op==='workspace.get')result={workspace:d,now:ctx.virtual_now};
 else if(op==='venues.search')result={venues:d.venues.filter(v=>(!a.query||[v.name,v.cuisine,v.neighborhood].join(' ').toLowerCase().includes(a.query.toLowerCase()))&&(!a.cuisine||v.cuisine===a.cuisine)&&(a.max_menu_cents===undefined||v.terms.menu_cents<=a.max_menu_cents))};
 else if(op==='venues.get')result={venue:find(d,'venues',a.id)};
 else if(op==='venues.document'){const v=find(d,'venues',a.id);result={file:ctx.assets.read(v.terms.asset_id)};}
 else if(op==='availability.get')result={slots:d.slots.filter(s=>(!a.venue_id||s.venue_id===a.venue_id)&&(!a.date||s.starts_at.startsWith(a.date))).map(s=>m.availability(ctx,d,s,a.party_size))};
 else if(op==='plans.get'){const p=m.activePlan(d);result={plan:p,expected_attendance:p.participants.filter(a=>a.status==='accepted').length};}
 else if(op==='plans.update'){const p=m.activePlan(d);if(a.name!==undefined)p.name=a.name;if(a.party_size!==undefined)p.party_size=a.party_size;p.revision++;result={plan:p};}
 else if(op==='holds.create'){const snap=m.snapshot(ctx,d,a.slot_id,a.party_size),g=m.authority(ctx,d,a.grant_id,snap,0,null,false);need(d.holds.filter(h=>m.alive(ctx,h)).length<g.max_active_holds,'hold_limit','The active hold limit is reached.');need(m.seats(ctx,d,find(d,'slots',a.slot_id))>=a.party_size,'unavailable','No released seats remain.');const hold={id:id(d,'hold'),slot_id:a.slot_id,party_size:a.party_size,expires_at:new Date(stamp(ctx.virtual_now)+5*60000).toISOString(),status:'held'};d.holds.push(hold);result={hold};}
 else if(op==='holds.release'){const h=find(d,'holds',a.id);need(h.status!=='consumed','hold_consumed','This hold already became a booking.');h.status='released';result={hold:h};}
 else if(op==='reservations.get')result={reservation:find(d,'reservations',a.id)};
 else if(['reservations.preview','reservations.change_preview','reservations.cancel_preview'].includes(op)){
  const kind=op==='reservations.preview'?'book':op.includes('cancel')?'cancel':'change',r=kind==='book'?null:find(d,'reservations',a.id);if(r)need(r.status==='confirmed','reservation_closed','Only confirmed reservations can change or cancel.');
  let hold=null,snap,amounts={fee_cents:0,refund_due_cents:0,charge_cents:0};
  if(kind==='book'){hold=find(d,'holds',a.hold_id);need(m.alive(ctx,hold),'hold_expired','This hold is no longer valid.');snap=m.snapshot(ctx,d,hold.slot_id,hold.party_size);amounts.charge_cents=snap.cost.deposit_cents;}
  else if(kind==='change'){need(stamp(ctx.virtual_now)<stamp(r.snapshot.free_cancel_until),'change_locked','The free-change window has ended; retain the original or preview cancellation.');snap=m.snapshot(ctx,d,a.slot_id,a.party_size);need(snap.cost.total_cents>=r.deposit_paid_cents,'deposit_credit','The replacement total cannot be below the retained deposit in M1.');amounts.charge_cents=Math.max(0,snap.cost.deposit_cents-r.deposit_paid_cents);}
  else{snap=structuredClone(r.snapshot);amounts=m.cancellation(ctx,r);}
  m.authority(ctx,d,a.grant_id,snap,amounts.charge_cents,r?.id,kind!=='cancel');if(kind!=='cancel')need(m.seats(ctx,d,find(d,'slots',snap.slot_id),hold?.id,r?.id)>=snap.party_size,'unavailable','The requested seats are no longer available.');
  const preview={id:id(d,'preview'),kind,reservation_id:r?.id||null,reservation_revision:r?.revision||0,hold_id:hold?.id||null,grant_id:a.grant_id,snapshot:snap,...amounts,expires_at:new Date(Math.min(stamp(ctx.virtual_now)+5*60000,hold?stamp(hold.expires_at):Infinity)).toISOString(),used:false};d.previews.push(preview);result={preview};
 }
 else if(['reservations.confirm','reservations.change_confirm','reservations.cancel_confirm'].includes(op)){
  const p=find(d,'previews',a.preview_id),kind=op==='reservations.confirm'?'book':op.includes('cancel')?'cancel':'change';need(p.kind===kind&&!p.used,'invalid_preview','Wrong preview or already committed.');need(stamp(ctx.virtual_now)<stamp(p.expires_at),'preview_expired','Preview expired; review current terms.');let r=p.reservation_id?find(d,'reservations',p.reservation_id):null;if(r)need(r.status==='confirmed'&&r.revision===p.reservation_revision,'stale_preview','The original reservation changed.');
  if(kind==='cancel'){const values=m.cancellation(ctx,r);need(['fee_cents','charge_cents','refund_due_cents'].every(k=>p[k]===values[k]),'stale_preview','The cancellation window changed; preview the current fee.');m.authority(ctx,d,p.grant_id,p.snapshot,p.charge_cents,r.id,false);r.status='cancelled';r.cancelled_at=ctx.virtual_now;r.revision++;r.fee_cents=p.fee_cents;r.refund_due_cents=p.refund_due_cents;}
  else{
   if(kind==='change')need(stamp(ctx.virtual_now)<stamp(r.snapshot.free_cancel_until),'change_locked','The amendment window ended.');
   const fresh=m.snapshot(ctx,d,p.snapshot.slot_id,p.snapshot.party_size);need(JSON.stringify(fresh)===JSON.stringify(p.snapshot),'stale_preview','Published prices or terms changed; obtain a fresh preview.');
   if(p.hold_id)need(m.alive(ctx,find(d,'holds',p.hold_id)),'hold_expired','Hold expired.');m.authority(ctx,d,p.grant_id,fresh,p.charge_cents,r?.id,true);need(m.seats(ctx,d,find(d,'slots',fresh.slot_id),p.hold_id,r?.id)>=fresh.party_size,'unavailable','Seats changed; the original reservation is preserved.');
   if(r){r.history.push(structuredClone(r.snapshot));r.snapshot=fresh;r.guaranteed_headcount=fresh.party_size;r.revision++;r.deposit_paid_cents+=p.charge_cents;}
   else{r={id:id(d,'reservation'),plan_id:m.activePlan(d).id,revision:1,status:'confirmed',snapshot:fresh,guaranteed_headcount:fresh.party_size,confirmed_at:ctx.virtual_now,cancelled_at:null,deposit_paid_cents:p.charge_cents,fee_cents:0,refund_due_cents:0,refund_paid_cents:0,history:[]};d.reservations.push(r);}
   if(p.hold_id)find(d,'holds',p.hold_id).status='consumed';
  }
  p.used=true;result={reservation:r,receipt:m.receipt(ctx,d,r,kind==='book'?'confirmed':kind==='change'?'changed':'cancelled',p.charge_cents)};
 }
 else if(op==='inquiries.create'){const v=find(d,'venues',a.venue_id);need(a.party_size<=v.max_party_size,'invalid_party','This venue cannot accommodate that group.');const inquiry={id:id(d,'inquiry'),venue_id:v.id,plan_id:m.activePlan(d).id,party_size:a.party_size,menu_request:a.menu_request,status:'pending',created_at:ctx.virtual_now};d.inquiries.push(inquiry);result={inquiry};}
 else if(op==='inquiries.get'){const inquiry=find(d,'inquiries',a.id);result={inquiry,quotes:d.quotes.filter(q=>q.inquiry_id===inquiry.id)};}
 else if(op==='receipts.get'){const r=find(d,'receipts',a.id);result={receipt:r,file:m.file(r.id+'.txt',r.text)};}
 else if(op==='notices.list')result={notices:d.notices.map(n=>m.noticeMessages(d,n))};
 else need(false,'unknown_tool','Unknown dining operation.');
 return {data:d,result};
}
module.exports={handleTool};
