'use strict';
const APP='home-repair-slots';
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const find=(xs,id)=>xs.find(x=>x.id===id);
const requireRecord=(xs,id,noun)=>find(xs,id)||fail('not_found',noun+' was not found in this account.');
const owner=(ctx,d)=>ctx.binding?.accounts?.find(x=>x.app_id===APP&&x.account_id===d.account_id)?.owner_person_id;
const current=(d)=>d.reservations.find(x=>x.status==='open');
const conflict=(d,id)=>d.bookings.some(x=>x.slot_id===id&&x.status==='confirmed');
const publicSlot=({taken,...s})=>s;
const dateFormatters=new Map();
function dateAt(s, timeZone){
 let fmt=dateFormatters.get(timeZone);
 if(!fmt){fmt=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});dateFormatters.set(timeZone,fmt);}
 const parts=Object.fromEntries(fmt.formatToParts(new Date(s)).map(x=>[x.type,x.value]));
 return [parts.year,parts.month,parts.day].join('-');
}
const isDate=s=>{const t=Date.parse(s);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;};
const future=(slot,now)=>Date.parse(slot.start)>Date.parse(now);
const allowed=(d,slot)=>{const c=d.constraints;return slot.estimate_minor<=c.budget_minor&&dateAt(slot.start,c.timezone)>=c.from_date&&dateAt(slot.end,c.timezone)<=c.through_date;};
function unique(xs,label){
 if(new Set(xs).size!==xs.length)fail('invalid_seed','Duplicate '+label+'.');
}
function validateSeed(ctx,d){
 if(!ctx.binding?.people?.some(x=>x.person_id===owner(ctx,d)))fail('invalid_seed','The synthetic booking account is not bound.');
 if(!isDate(d.constraints.from_date)||!isDate(d.constraints.through_date)||d.constraints.from_date>d.constraints.through_date)fail('invalid_seed','Invalid scenario date window.');
 unique([...d.providers,...d.slots,...d.reservations,...d.bookings].map(x=>x.id),'object ID');
 if(d.reservations.filter(x=>x.status==='open').length>1)fail('invalid_seed','Only one open reservation is allowed.');
 const occupied=d.bookings.filter(x=>x.status==='confirmed').map(x=>x.slot_id);
 unique(occupied,'confirmed slot');
 unique(d.bookings.map(x=>x.origin),'booking origin');
 for(const s of d.slots)
  if(!find(d.providers,s.provider_id)||Date.parse(s.start)>=Date.parse(s.end)||!/[+-][0-9]{2}:[0-9]{2}$/.test(s.start)||!/[+-][0-9]{2}:[0-9]{2}$/.test(s.end))fail('invalid_seed','Invalid slot or explicit offset.');
 for(const x of [...d.reservations,...d.bookings])if(!find(d.slots,x.slot_id))fail('invalid_seed','Invalid booking or preview slot reference.');
 if(d.slots.some(x=>x.taken&&occupied.includes(x.id)))fail('invalid_seed','A competitor cannot take a confirmed slot.');
 for(const h of d.history)if(!find([...d.bookings,...d.reservations],h.object_id)||!find(d.slots,h.slot_id)||(h.prior_slot_id&&!find(d.slots,h.prior_slot_id)))fail('invalid_seed','Invalid business history reference.');
}
function track(d,ctx,operation,x,prior_slot_id){
 if(d.history.length>=500)fail('capacity_reached','Local booking history limit reached.');
 d.history.push({operation,object_id:x.id,slot_id:x.slot_id,at:ctx.virtual_now,...(prior_slot_id?{prior_slot_id}:{})});
}
function openRecord(d,id,kind){
 const xs=kind==='booking'?d.bookings:d.reservations;
 return requireRecord(xs,id,kind==='booking'?'Booking':'Reservation');
}
function candidate(d,id,now){
 const s=requireRecord(d.slots,id,'Slot');
 if(!future(s,now)||s.taken||conflict(d,id))fail('slot_unavailable','This slot is no longer available.');
 if(!allowed(d,s))fail('outside_constraints','Slot must stay inside the requested dates and all-inclusive budget.');
 return s;
}
function allocate(d,prefix,start){
 const existing=new Set([...d.slots,...d.providers,...d.reservations,...d.bookings].map(x=>x.id));
 let i=start;
 while(existing.has(prefix+i))i++;
 return prefix+i;
}
function applyEvent(ctx,d,event){
 if(ctx.role!=='infra'||event.operation!==APP+'.slot_taken'||event.payload.target!=='open_reservation')fail('invalid_event','Unsupported incoming event.');
 const r=current(d);
 if(!r)fail('invalid_event','No open reservation was available to invalidate.');
 const s=find(d.slots,r.slot_id);
 if(!s||!future(s,ctx.virtual_now)||s.taken||conflict(d,s.id))fail('invalid_event','The selected slot is no longer eligible for the competing event.');
 track(d,ctx,'slot_taken',r);
 s.taken=true;r.status='invalidated';
 return d;
}
function handleTool(ctx,d,name,a){
 if(!owner(ctx,d))fail('permission_denied','No bound synthetic account.');
 if(!name.startsWith(APP+'.'))fail('invalid_arguments','Unknown Home Repair Slots operation.');
 const tool=name.slice(APP.length+1);
 const wrap=result=>({data:d,result});
 const details=(k,x)=>({[k]:x,slot:publicSlot(find(d.slots,x.slot_id))});
 switch(tool){
  case 'list_slots':return wrap({
   slots:d.slots.filter(s=>future(s,ctx.virtual_now)&&!s.taken&&!conflict(d,s.id)&&allowed(d,s)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id)).map(publicSlot),
   providers:d.providers,constraints:d.constraints,service:d.service,reservation_id:(current(d)||(d.reservations.at(-1)?.status==='invalidated'?d.reservations.at(-1):null))?.id||null,booking_ids:d.bookings.map(x=>x.id)
  });
  case 'get_reservation':return wrap(details('reservation',openRecord(d,a.reservation_id,'reservation')));
  case 'get_booking':{
   const b=openRecord(d,a.booking_id,'booking');
   // Project only this bound account's booking events. No changes to stored seeds or write receipts.
   const history=d.history.filter(h=>h.object_id===b.id&&['confirm_reservation','reschedule_booking','cancel_booking'].includes(h.operation));
   return wrap({...details('booking',b),history});
  }
  case 'select_slot':{
   const s=candidate(d,a.slot_id,ctx.virtual_now);
   if(d.reservations.length>=100)fail('capacity_reached','Local reservation limit reached.');
   const old=current(d);
   const r={id:allocate(d,'R',1),slot_id:s.id,status:'open'};
   track(d,ctx,tool,r);
   if(old)old.status='discarded';
   d.reservations.push(r);
   return wrap(details('reservation',r));
  }
  case 'confirm_reservation':{
   const r=openRecord(d,a.reservation_id,'reservation');
   if(r.status==='confirmed')fail('already_confirmed','This reservation was already confirmed.');
   if(r.status==='invalidated')fail('slot_unavailable','The selected slot was taken before confirmation. Please recheck alternatives.');
   if(r.status!=='open')fail('not_open','This reservation has been discarded.');
   const s=candidate(d,r.slot_id,ctx.virtual_now);
   if(d.bookings.length>=100)fail('capacity_reached','Local booking limit reached.');
   const b={id:allocate(d,'B',1),slot_id:s.id,status:'confirmed',origin:r.id};
   track(d,ctx,tool,b);
   r.status='confirmed';d.bookings.push(b);
   return wrap({reservation:r,...details('booking',b)});
  }
  case 'discard_reservation':{
   const r=openRecord(d,a.reservation_id,'reservation');
   if(r.status==='discarded')fail('already_discarded','This reservation was already discarded.');
   if(r.status==='confirmed')fail('already_confirmed','Use booking cancellation for a confirmed reservation.');
   track(d,ctx,tool,r);
   r.status='discarded';
   return wrap(details('reservation',r));
  }
  case 'reschedule_booking':{
   const b=openRecord(d,a.booking_id,'booking');
   if(b.status==='cancelled')fail('already_cancelled','This booking is cancelled.');
   const s=candidate(d,a.slot_id,ctx.virtual_now);
   const old=find(d.slots,b.slot_id);
   if(!future(old,ctx.virtual_now))fail('slot_started','A booking that has already started cannot be moved.');
   track(d,ctx,tool,{...b,slot_id:s.id},old.id);
   b.slot_id=s.id;return wrap(details('booking',b));
  }
  case 'cancel_booking':{
   const b=openRecord(d,a.booking_id,'booking');
   if(b.status==='cancelled')fail('already_cancelled','This booking was already cancelled.');
   const s=find(d.slots,b.slot_id);
   if(!future(s,ctx.virtual_now))fail('slot_started','A booking that has already started cannot be cancelled.');
   track(d,ctx,tool,b);
   b.status='cancelled';return wrap(details('booking',b));
  }
  default:fail('invalid_arguments','Unknown Home Repair Slots operation.');
 }
}
module.exports={validateSeed,applyEvent,handleTool,objects:d=>[...d.providers,...d.slots,...d.reservations,...d.bookings].map(x=>x.id),records:d=>[...d.slots,...d.bookings],references:()=>[]};
