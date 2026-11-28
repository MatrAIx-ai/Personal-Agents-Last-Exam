'use strict';
const APP='community-lending-library', DAY=86400000, MIN=Date.parse('2025-01-01T00:00:00+08:00');
const epoch=Date.parse, iso=ms=>new Date(ms).toISOString();
const fail=(code,text)=>{throw Object.assign(Error(text),{code});};
const lookup=(xs,id)=>xs.find(x=>x.id===id);
const key=(o)=>[o.operation,o.member_id,o.copy_id,o.attempt].join('/');
const tuple=(o)=>[o.operation,o.member_id,o.copy_id].join('/');
const own=(x,m)=>x?.member_id===m;
const publicRow=({member_id,renewed_at,...attrs})=>attrs;
const order=(a,b)=>a.sequence-b.sequence;
const current=(l)=>l.returned_at===null;
const open=(h)=>h.status==='open';
const pending=(r)=>r.status==='pending';
const due=(l,at)=>current(l)&&epoch(l.due_at)<=at;
const actor=(ctx,d)=>ctx.binding?.accounts?.find(x=>x.app_id===APP&&x.account_id===d.account_id)?.owner_person_id;
const atLeast=k=>typeof k==='string'&&epoch(k)>=MIN&&/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(k);
const need=(x,code='not_found',msg='This record is not available to the current member.')=>x||fail(code,msg);
const unique=(list,msg)=>{if(list.length!==new Set(list).size)fail('invalid_seed','Duplicate '+msg+'.');};
function validateSeed(ctx,d){
 if(actor(ctx,d)!==d.member_id||!lookup(d.members,d.member_id))fail('invalid_seed','The bound account must match the run member.');
 for(const k of ['members','items','copies','holds','loans','attempts'])unique(d[k].map(x=>x.id),k+' ID');
 unique(d.queue.map(q=>q.item_id+'/'+q.member_id),'item/member queue entry');
 unique([...d.queue,...(d.queue_history||[])].map(q=>q.sequence),'FIFO sequence');
 unique(d.attempts.map(key),'exact desk attempt');
 unique(d.attempts.filter(pending).map(tuple),'pending desk transition');
 unique(d.attempts.filter(r=>r.event_id).map(r=>r.event_id),'applied desk event');
 unique([...d.holds.filter(open),...d.loans.filter(current)].map(x=>x.copy_id),'live custody claim');
 const dates=[d.seed_at,d.materialized_at,...d.holds.flatMap(x=>[x.created_at,x.expires_at]),...d.loans.flatMap(x=>[x.checked_out_at,x.due_at,x.returned_at,x.renewed_at].filter(Boolean)),...d.queue.map(x=>x.joined_at),...(d.queue_history||[]).flatMap(x=>[x.joined_at,x.ended_at]),...d.attempts.flatMap(x=>[x.requested_at,x.resolved_at].filter(Boolean))];
 if(dates.some(x=>!atLeast(x))||epoch(d.materialized_at)<epoch(d.seed_at))fail('invalid_seed','Use valid offset timestamps no earlier than January 1, 2025 (library time).');
 if(ctx.virtual_now&&epoch(ctx.virtual_now)<epoch(d.materialized_at))fail('invalid_seed','The load clock precedes materialized history. Generate an as-of prefix first.');
 const observed=[...d.holds.map(x=>x.created_at),...d.loans.flatMap(x=>[x.checked_out_at,x.returned_at,x.renewed_at].filter(Boolean)),...[...d.queue,...(d.queue_history||[])].flatMap(x=>[x.joined_at,x.ended_at].filter(Boolean)),...d.attempts.flatMap(x=>[x.requested_at,x.resolved_at].filter(Boolean))];
 if(observed.some(x=>epoch(x)>epoch(d.materialized_at)))fail('invalid_seed','Observed history cannot be later than the materialized clock.');
 if([...d.queue,...(d.queue_history||[])].some(q=>q.sequence>=d.next_sequence||!lookup(d.items,q.item_id)||!lookup(d.members,q.member_id)||(q.ended_at&&epoch(q.ended_at)<epoch(q.joined_at))))fail('invalid_seed','Invalid queue entry or sequence counter.');
 const hasRefs=r=>lookup(d.members,r.member_id)&&lookup(d.copies,r.copy_id);
 if(d.copies.some(c=>!lookup(d.items,c.item_id))||[...d.holds,...d.loans,...d.attempts].some(r=>!hasRefs(r)))fail('invalid_seed','Unresolved item, member or copy reference.');
 if(d.holds.some(h=>epoch(h.expires_at)-epoch(h.created_at)!==DAY)||d.loans.some(l=>epoch(l.due_at)-epoch(l.checked_out_at)!==(l.renewed?10:7)*DAY||l.returned_at&&epoch(l.returned_at)<epoch(l.checked_out_at)||l.renewed_at&&(!l.renewed||epoch(l.renewed_at)<epoch(l.checked_out_at)||epoch(l.renewed_at)>=epoch(l.checked_out_at)+7*DAY||l.returned_at&&epoch(l.renewed_at)>epoch(l.returned_at))))fail('invalid_seed','Invalid lending dates.');
 if([...d.holds.filter(open),...d.loans.filter(current)].some(r=>lookup(d.copies,r.copy_id).maintenance))fail('invalid_seed','Maintenance copies cannot belong to live holds or loans.');
 if(d.members.some(m=>uses(d,m.id)>2))fail('invalid_seed','A member holds or borrows too many copies.');
 for(const r of d.attempts){
  const linked=lookup(r.operation==='checkout'?d.holds:d.loans,r.reference_id);
  if(!linked||linked.copy_id!==r.copy_id||linked.member_id!==r.member_id)fail('invalid_seed','Desk attempt does not match its initiating hold or loan.');
  if(pending(r)&&(r.event_id||r.resolved_at||!(r.operation==='checkout'?open(linked):current(linked))))fail('invalid_seed','Invalid pending attempt.');
  if(!pending(r)&&(!r.resolved_at||epoch(r.resolved_at)<epoch(r.requested_at)||(r.status==='cancelled'?r.event_id:!r.event_id)))fail('invalid_seed','Invalid terminal attempt receipt.');
 }
}
function uses(d,m){return d.holds.filter(x=>open(x)&&own(x,m)).length+d.loans.filter(x=>current(x)&&own(x,m)).length;}
function hasOverdue(d,m,t){return d.loans.some(x=>own(x,m)&&due(x,t));}
function copyStatus(d,c){
 if(c.maintenance)return 'maintenance';
 if(d.loans.some(l=>current(l)&&l.copy_id===c.id))return 'on_loan';
 if(d.holds.some(h=>open(h)&&h.copy_id===c.id))return 'held';
 return 'available';
}
const forItem=(d,id)=>d.queue.filter(q=>q.item_id===id).sort(order);
const itemCopies=(d,id)=>d.copies.filter(c=>c.item_id===id);
const borrowed=(d,id,m)=>d.loans.some(l=>current(l)&&own(l,m)&&itemCopies(d,id).some(c=>c.id===l.copy_id));
const hasCirculation=(d,id)=>itemCopies(d,id).some(c=>!c.maintenance);
const available=(d,id)=>itemCopies(d,id).filter(c=>copyStatus(d,c)==='available').sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
function summary(d,id,m){
 const x=need(lookup(d.items,id)), queue=forItem(d,id),pos=queue.findIndex(q=>own(q,m));
 return {...x,available:available(d,id).length,queue_length:queue.length,your_position:pos<0?null:pos+1, your_active_loan:borrowed(d,id,m), has_circulating_copy:hasCirculation(d,id)};
}
function createId(d,k,prefix,list,max=700){
 if(list.length>=max)fail('capacity_reached','Local fixture state limit reached.');
 while(lookup(list,prefix+d[k]))d[k]++;
 return prefix+d[k]++;
}
function makeHold(d,m,c,t){
 const h={id:createId(d,'next_hold','H',d.holds),member_id:m,copy_id:c,created_at:iso(t),expires_at:iso(t+DAY),status:'open'};
 d.holds.push(h);return h;
}
function finishAttempt(r,status,t,event_id=null){r.status=status;r.event_id=event_id;r.resolved_at=iso(t);return r;}
function clearCheckout(d,h,t){for(const r of d.attempts)if(pending(r)&&r.operation==='checkout'&&r.reference_id===h.id)finishAttempt(r,'cancelled',t);}
function closeQueue(d,q,t,outcome){
 if((d.queue_history?.length||0)>=1000)fail('capacity_reached','Local queue history limit reached.');
 (d.queue_history??=[]).push({...q,ended_at:iso(t),outcome});
 d.queue=d.queue.filter(y=>y!==q);
}
function promote(d,t){
 for(const item of d.items){
  for(const c of available(d,item.id)){
   const q=forItem(d,item.id).find(x=>!borrowed(d,item.id,x.member_id)&&uses(d,x.member_id)<2&&!hasOverdue(d,x.member_id,t));
   if(!q)break;
   closeQueue(d,q,t,'promoted');makeHold(d,q.member_id,c.id,t);
  }
 }
}
function reconcile(d,t){
 const old=epoch(d.materialized_at);
 if(t<old)fail('invalid_time','Core time precedes the loaded scenario.');
 // Catch up at historical boundaries, not at the time the caller happens to read.
 promote(d,old);
 while(true){
  const expired=d.holds.filter(h=>open(h)&&epoch(h.expires_at)<=t);
  if(!expired.length)break;
  const next=Math.min(...expired.map(h=>Math.max(old,epoch(h.expires_at))));
  for(const h of expired)if(epoch(h.expires_at)<=next){h.status='expired';clearCheckout(d,h,next);}
  promote(d,next);
 }
 d.materialized_at=iso(t);return d;
}
function addQueue(d,m,id,t,sequence=d.next_sequence){
 need(lookup(d.items,id));need(lookup(d.members,m),'invalid_event','Unknown seeded member.');
 if(d.queue.some(q=>q.item_id===id&&own(q,m)))fail('already_queued','The member is already queued for this item.');
 if(d.holds.some(h=>open(h)&&own(h,m)&&lookup(d.copies,h.copy_id).item_id===id))fail('already_held','The member already holds a copy of this item.');
 if(borrowed(d,id,m))fail('already_borrowed','You already have a copy of this item on loan.');
 if(!hasCirculation(d,id))fail('not_circulating','This item has no serviceable copies.');
 if(sequence!==d.next_sequence)fail('invalid_event','Queue sequence does not match the next fixture ordinal.');
 if(d.queue.length>=200)fail('capacity_reached','Local queue limit reached.');
 d.next_sequence++;d.queue.push({item_id:id,member_id:m,sequence,joined_at:iso(t)});
}
function renewal(d,l,t){
 let reason='eligible';
 const item=lookup(d.copies,l.copy_id).item_id;
 if(!current(l))reason='loan_closed';
 else if(epoch(l.due_at)<=t||hasOverdue(d,l.member_id,t))reason='overdue';
 else if(l.renewed)reason='already_renewed';
 else if(forItem(d,item).some(q=>!own(q,l.member_id)))reason='member_waiting';
 else if(d.attempts.some(r=>pending(r)&&r.operation==='return'&&r.reference_id===l.id))reason='return_pending';
 return {loan_id:l.id,eligible:reason==='eligible',due_at:l.due_at,proposed_due_at:reason==='eligible'?iso(epoch(l.due_at)+3*DAY):l.due_at,reason};
}
function makeAttempt(d,operation,r,t){
 const raw={operation,member_id:r.member_id,copy_id:r.copy_id};
 if(d.attempts.some(x=>pending(x)&&tuple(x)===tuple(raw)))fail('request_pending','There is already a pending desk request for this transition.');
 const attempt=1+Math.max(0,...d.attempts.filter(x=>tuple(x)===tuple(raw)).map(x=>x.attempt));
 const out={id:createId(d,'next_attempt','R',d.attempts),...raw,attempt,reference_id:r.id,requested_at:iso(t),status:'pending',event_id:null,resolved_at:null};
 d.attempts.push(out);return out;
}
function applyEvent(ctx,d,e){
 if(ctx.role!=='infra')fail('invalid_event','Only Infra may deliver desk or queue events.');
 const t=epoch(ctx.virtual_now);
 reconcile(d,t);
 if(e.operation===APP+'.queue_join'){addQueue(d,e.payload.member_id,e.payload.item_id,t,e.payload.sequence);return reconcile(d,t);}
 if(e.operation!==APP+'.desk_outcome')fail('invalid_event','Unknown lending event.');
 const found=d.attempts.filter(r=>key(r)===key(e.payload));
 if(found.length!==1||!pending(found[0]))fail('invalid_event','No exact uniquely pending desk attempt matched; never rerouted.');
 const r=found[0];
 if(r.operation==='checkout'){
  const h=lookup(d.holds,r.reference_id), c=lookup(d.copies,r.copy_id);
  if(!h||!open(h)||!c||c.maintenance||hasOverdue(d,r.member_id,t)||uses(d,r.member_id)>2||d.loans.some(x=>current(x)&&x.copy_id===r.copy_id))fail('invalid_event','Checkout is no longer eligible; custody unchanged.');
  if(e.payload.outcome==='accepted'){
   h.status='checked_out';
   d.loans.push({id:createId(d,'next_loan','L',d.loans),member_id:r.member_id,copy_id:r.copy_id,checked_out_at:iso(t),due_at:iso(t+7*DAY),renewed:false,returned_at:null});
  }
 }else{
  const l=lookup(d.loans,r.reference_id);
  if(!l||!current(l))fail('invalid_event','No matching open loan to return.');
  if(e.payload.outcome==='accepted')l.returned_at=iso(t);
 }
 finishAttempt(r,e.payload.outcome,t,e.event_id);
 return reconcile(d,t);
}
function handleTool(ctx,orig,name,a){
 const m=actor(ctx,orig);
 if(m!==orig.member_id||!lookup(orig.members,m))fail('permission_denied','No bound lending member.');
 if(!name.startsWith(APP+'.'))fail('invalid_arguments','Unknown lending tool.');
 const t=epoch(ctx.virtual_now), now=iso(t), d=reconcile(structuredClone(orig),t);
 const mine=(xs,id)=>need(xs.find(r=>r.id===id&&own(r,m)));
 const read=result=>({data:orig,result}), write=result=>({data:reconcile(d,t),result});
 switch(name.slice(APP.length+1)){
  case 'search_items':{
   const q=(a.query||'').trim().toLowerCase();
   return read({now,items:d.items.filter(i=>i.name.toLowerCase().includes(q)).map(i=>summary(d,i.id,m))});
  }
  case 'get_item':return read({now,item:summary(d,a.item_id,m),copies:itemCopies(d,a.item_id).map(c=>{const loan=d.loans.find(l=>l.copy_id===c.id&&current(l)&&own(l,m));return {id:c.id,status:copyStatus(d,c),...(loan?{your_due_at:loan.due_at}:{})};})});
  case 'list_holds':return read({now,member_name:lookup(d.members,m).name,holds:d.holds.filter(h=>own(h,m)).map(h=>({...publicRow(h),checkout_pending:d.attempts.some(r=>pending(r)&&r.operation==='checkout'&&r.reference_id===h.id)})),queue:d.queue.filter(q=>own(q,m)).map(q=>({item_id:q.item_id,position:summary(d,q.item_id,m).your_position,length:forItem(d,q.item_id).length}))});
  case 'list_loans':return read({now,loans:d.loans.filter(x=>own(x,m)).map(x=>({...publicRow(x),overdue:due(x,t)}))});
  case 'list_activity':return read({now,attempts:d.attempts.filter(x=>own(x,m)).map(publicRow)});
  case 'preview_renewal':return read(renewal(d,mine(d.loans,a.loan_id),t));
  case 'confirm_hold':{
   const c=need(d.copies.find(c=>c.id===a.copy_id&&c.item_id===a.item_id));
   if(hasOverdue(d,m,t))fail('overdue','Return overdue copies first.');
   if(uses(d,m)>=2)fail('limit_reached','At most two copies may be held or borrowed.');
   if(copyStatus(d,c)!=='available')fail('copy_unavailable','The selected copy is no longer available.');
   return write({hold:publicRow(makeHold(d,m,c.id,t))});
  }
  case 'cancel_hold':{
   const h=mine(d.holds,a.hold_id);if(!open(h))fail('hold_not_open','This hold is no longer open.');
   h.status='cancelled';clearCheckout(d,h,t);return write({hold:publicRow(h)});
  }
  case 'join_queue':
   if(available(d,a.item_id).length)fail('copy_available','An eligible copy is already available.');
   addQueue(d,m,a.item_id,t);
   return write({item:summary(d,a.item_id,m)});
  case 'leave_queue':{
   const q=d.queue.find(q=>q.item_id===a.item_id&&own(q,m));
   if(!q)fail('not_queued','You are not on that queue.');
   closeQueue(d,q,t,'left');return write({item:summary(d,a.item_id,m)});
  }
  case 'request_checkout':{
   const h=mine(d.holds,a.hold_id);
   if(!open(h))fail('hold_not_open','The hold expired or was cancelled.');
   if(hasOverdue(d,m,t))fail('overdue','Return overdue copies before checkout.');
   return write({attempt:publicRow(makeAttempt(d,'checkout',h,t))});
  }
  case 'request_return':{
   const l=mine(d.loans,a.loan_id);if(!current(l))fail('loan_closed','This loan is already closed.');
   return write({attempt:publicRow(makeAttempt(d,'return',l,t))});
  }
  case 'cancel_request':{
   const r=mine(d.attempts,a.attempt_id);if(!pending(r))fail('request_not_pending','This desk attempt is already terminal.');
   return write({attempt:publicRow(finishAttempt(r,'cancelled',t))});
  }
  case 'confirm_renewal':{
   const l=mine(d.loans,a.loan_id), approval=renewal(d,l,t);
   if(!approval.eligible)fail(approval.reason,'Renewal no longer eligible; original due date preserved.');
   l.due_at=approval.proposed_due_at;l.renewed=true;l.renewed_at=now;return write({loan:publicRow(l)});
  }
  default:fail('invalid_arguments','Unknown lending tool.');
 }
}
module.exports={reconcile,validateSeed,applyEvent,handleTool,objects:d=>[...d.items,...d.copies,...d.holds,...d.loans,...d.attempts].map(x=>x.id),records:d=>d.copies,references:()=>[]};
