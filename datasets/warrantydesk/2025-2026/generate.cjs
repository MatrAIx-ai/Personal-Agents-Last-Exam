'use strict';
const C=require('./common.cjs'),{Timeline}=require('./timeline.cjs'),e=C.environment('warrantydesk',__dirname),opt=C.options(),{day,iso}=C,H=3600000;
const template=require(C.path.join(e.app,'fixtures/minimal.json'));
const profiles=[{key:'eli',name:'Eli',billing:5,price:899,role:'field-service technician'},{key:'maya',name:'Maya',billing:12,price:1099,role:'college instructor'},{key:'ren',name:'Ren',billing:19,price:749,role:'community coordinator'}];
const contacts=[
 ['purchase registration','The purchase invoice and work-phone serial were registered; coverage starts from the invoice, not the delivery scan.','registration was accepted with a dated proof of purchase'],
 ['battery-health query','The owner asked whether a lower battery estimate by itself established a covered fault.','diagnostic evidence was requested; no additional advance remedy was opened'],
 ['coverage-address correction','A move changed the service contact address, while device ownership stayed the same.','the service-address record was corrected without authorizing a courier pickup'],
 ['tablet purchase and coverage','A separate household tablet was purchased and added to the owner inventory.','the tablet proof was registered under its own serial and purchase date'],
 ['charging-cable fault','Intermittent charging stopped when the owner tried the original cable.','the cable guidance resolved this contact without a replacement order'],
 ['coverage proof request','The owner needed a copy of coverage dates for an employer equipment audit.','the dated certificate was reissued; no claim payment or refund was created'],
 ['travel service planning','Travel dates narrowed which courier appointments the owner could actually attend.','booking and cancellation cutoffs were explained; an inquiry did not reserve a window'],
 ['software restart guidance','A post-update restart was distinguished from evidence of a hardware fault.','the documented restart procedure was provided with a request to retain diagnostic logs'],
 ['liquid-damage eligibility inquiry','The owner asked whether an accidental-damage incident would follow the same remedy terms.','eligibility could not be inferred from the normal warranty; the contact ended without a new remedy'],
 ['independent-access preparation','The owner checked which work enrollment step would still require the old device.','IT approval was identified as separate from copied files or application icons'],
 ['courier contact update','A delivery contact number changed before any new physical handoff.','the contact was updated; actual collection still needs the matching case and serial'],
 ['annual inventory reconciliation','Purchase proofs, closed service cases and retained devices were reconciled.','duplicate document copies were linked to the original serial instead of registering another device'],
 ['protection-plan price renewal','The new-year protection invoice had a changed monthly rate and the same scope.','the renewed price and billing period were disclosed without changing a replacement hold'],
 ['backup restore rehearsal','A test contact restored to the spare device; no banking credentials were shared.','the owner was reminded that a backup test does not prove independent work login'],
 ['screen-mark assessment','A cosmetic mark was documented separately from functional damage.','photo guidance was given; no eligible advance remedy was asserted for cosmetic wear'],
 ['secondary-phone purchase','A separately purchased personal phone joined the equipment inventory.','its invoice was registered without transferring ownership of the work handset'],
 ['coverage transfer query','The owner asked whether a completed replacement automatically changed coverage dates.','the service receipt was referenced; the original purchase term was retained'],
 ['support ticket reopen','An earlier contact was reopened after a diagnostic symptom returned.','the previous ticket was linked rather than treating its acknowledgement as a new remedy decision'],
 ['shipping-address verification','The owner verified that a work address could receive a signed parcel.','address suitability was confirmed; dispatch still requires an accepted case'],
 ['return-label clarification','The owner checked which of two device serials belonged on a return label.','only the active case obligation identifies the return serial; old and replacement devices are not interchangeable'],
 ['missed-window inquiry','The owner asked how to recover after a courier window passes without collection.','a new available slot is required; a missed reservation is not an actual handoff'],
 ['settlement status question','A courier scan was visible while manufacturer receipt and hold release were still separate stages.','the owner was directed to actual receipt and financial postings rather than treating transit as settlement'],
 ['coverage expiry reminder','A reminder disclosed the end of the current monthly coverage period and the next renewal.','future coverage remained contingent on the next period; no future payment was recorded as completed'],
 ['year-end proof archive','The owner archived actual purchases, support decisions and settled remedy receipts.','the archive distinguished returned serials, retained devices and manufacturer receipt from courier tracking']
];
const seeds=profiles.map((p,pi)=>{
 const owner='person-'+p.key,capital=p.key.toUpperCase(),fleet=[capital+'-WORK-A',capital+'-TABLET-B',capital+'-PERSONAL-C'];
 const d={account_id:'warranty-'+p.key,owner_person_id:owner,records:[],devices:[],offers:[],cases:[],slots:[],requests:[],pickups:[],receipts:[],postings:[],history:[]},t=new Timeline(e,d,p.key),cases=[];
 t.at('2025-01-01T10:00:00Z',h=>h.note(p.key+'-purchase-work',owner,'purchase',`${p.name}, a ${p.role}, bought work handset ${fleet[0]} under the fictional New Year equipment programme. Purchase proof PO-${capital}-2501 records USD ${499+pi*90}. Keep this invoice separate from later refundable remedy holds.`));
 for(let m=0;m<24;m++){
  const y=2025+Math.floor(m/12),mo=m%12+1,key=p.key+'-'+y+String(mo).padStart(2,'0'),question=contacts[m],contactDay=4+(m*5+pi*3)%18;
  const activeSerial=h=>{const c=h.data.cases.find(c=>c.old_serial===fleet[0]&&c.status==='closed');return c?c.replacement_serial:fleet[0];};
  t.at(Date.UTC(y,mo-1,p.billing,8+pi,10),h=>h.note(key+'-invoice','person-manufacturer','coverage_invoice',`Protection invoice COV-${capital}-${y}${String(mo).padStart(2,'0')}: ${( (p.price+(y===2026?100:0))/100).toFixed(2)} USD for coverage from ${iso(Date.UTC(y,mo-1,p.billing,8+pi,10))} until ${iso(Date.UTC(y,mo,p.billing,8+pi,10))} on ${activeSerial(h)}. The prior period ended before this renewal. This is a synthetic manufacturer invoice, not a bank settlement or a replacement-hold posting.`));
  t.at(Date.UTC(y,mo-1,contactDay,11+pi,20),h=>h.note(key+'-contact',owner,'support_contact',`Ticket ${capital}-${100+m}: ${question[0]}. ${question[1]} ${p.name}'s current work serial is ${activeSerial(h)}; the ${p.role} schedule determines service availability.`));
  t.at(Date.UTC(y,mo-1,contactDay+1+(m%2),13,15+pi),h=>h.note(key+'-decision','person-manufacturer',m%3===0?'registration_decision':'support_decision',`Response to ticket ${capital}-${100+m}: ${question[2]}. This contact creates no additional advance-replacement obligation; any separately accepted remedy retains its own case, serial and immutable offer.`));
  t.at(Date.UTC(y,mo-1,contactDay+3,17-pi,35),h=>h.note(key+'-followup',owner,'support_followup',`${p.name} retained the response for ${question[0]}. ${m%4===0?'The original proof and case references were linked for the equipment audit.':m%4===1?'The owner followed the guidance and retained the device; acknowledgement was not treated as a completed repair.':m%4===2?'Courier availability was checked against the work rota without asserting a completed collection.':'The private continuity checklist remains separate from manufacturer eligibility.'} Current work serial: ${activeSerial(h)}.`));
 }
 t.at('2025-04-21T14:25:00Z',h=>h.note(p.key+'-tablet-invoice',owner,'purchase',`Invoice TAB-${capital}-0421: tablet ${fleet[1]}, USD ${299+pi*40}, purchased as a household spare. Its registration and service obligations are separate from ${fleet[0]}.`));
 t.at('2026-04-18T16:40:00Z',h=>h.note(p.key+'-personal-invoice',owner,'purchase',`Invoice MOB-${capital}-0418: personal handset ${fleet[2]}, USD ${399+pi*55}. It is owner-controlled and is not automatically enrolled for work authentication.`));
 for(let k=0;k<3;k++){
  const m=[0,9+pi,19+pi][k],year=2025+Math.floor(m/12),month=m%12+1,base=Date.UTC(year,month-1,7+pi*2,9+pi),key=p.key+'-case-'+(k+1),old=fleet[k],replacement=capital+'-REPLACEMENT-'+(k+1),kind=['normal','pre-dispatch-withdrawal','shipped-withdrawal'][(k+pi)%3],hold=[22000,14500,33500][(k+pi)%3]+pi*1000,missed=kind==='normal'&&pi!==1,firstTime=base+6*day+(2+pi)*H,secondTime=base+8*day+(4-pi)*H;
  const slot1=key+'-pickup-'+iso(firstTime).slice(0,10),slot2=key+'-pickup-'+iso(secondTime).slice(0,10);let bank,work,enroll,wipe,pickup;
  const slot=(id,start)=>({id,courier_actor_id:'person-courier',start_at:iso(start),end_at:iso(start+(30+pi*10)*60000),book_before:iso(start-90*60000),cancel_before:iso(start-3*H),capacity:2+pi});
  t.at(base,h=>{h.import(data=>{data.devices.push({id:old,owner_person_id:owner,label:['Work handset','Household tablet','Personal handset'][k],custody:'user',erased:false,erased_at:null},{id:replacement,owner_person_id:owner,label:'Advance replacement for '+old,custody:'provider',erased:false,erased_at:null});const c=C.clone(template.cases[0]);Object.assign(c,{id:key,old_serial:old,replacement_serial:replacement,offer_id:key+'-offer',created_at:iso(base),return_due_at:iso(base+(kind==='normal'&&pi===0?9:16)*day)});data.cases.push(c);data.offers.push({id:c.offer_id,case_id:key,eligible:true,manufacturer_actor_id:'person-manufacturer',courier_actor_id:'person-courier',it_actor_id:'person-it',hold_amount_cents:hold,currency:'USD',return_due_at:c.return_due_at,withdrawal_return_due_at:iso(base+(kind==='shipped-withdrawal'&&pi===2?8:17)*day),created_at:iso(base)});data.slots.push(slot(slot1,firstTime),slot(slot2,secondTime));});h.note(key+'-eligibility','person-manufacturer','remedy_offer',`The case-specific diagnostic decision for ${old} offers an advance ${replacement} with a refundable ${(hold/100).toFixed(2)} USD hold and the displayed return deadlines. This is an actual synthetic offer, not a generic USD 300 template.`);});
  t.at(base+30*60000,h=>{const q=h.call('remedy.preview',{case_id:key,action:'accept'}).quote;h.call('remedy.accept',{case_id:key,quote_digest:q.digest});});
  const request=(h,type,serial)=>h.call('verification.request',{case_id:key,device_serial:serial,kind:type}).item;
  const reply=(h,q,success,used=false)=>h.event('verification.reply',{selector:q.selector,source_actor_id:q.source_actor_id,status:'performed',result:{success,used_old_device:used}});
  if(kind==='pre-dispatch-withdrawal'){
   t.at(base+day+2*H,h=>{h.note(key+'-cancel-intent',owner,'remedy_withdrawal','The original device recovered after the owner completed the support guidance. Cancel the accepted remedy before dispatch; a requested release is not yet a posted release.');const q=h.call('remedy.preview',{case_id:key,action:'withdraw'}).quote;h.call('remedy.withdraw',{case_id:key,quote_digest:q.digest});});
   t.at(base+3*day+pi*H,h=>h.event('hold.released',{case_id:key,reason:'cancelled_before_dispatch',source_actor_id:'person-manufacturer'}));
   t.at(base+4*day+H,h=>h.call('case.close',{id:key}));
  }else{
   t.at(base+day+(2+pi)*H,h=>h.event('replacement.dispatched',{case_id:key,replacement_serial:replacement,source_actor_id:'person-manufacturer'}));
   if(kind==='shipped-withdrawal')t.at(base+day+7*H,h=>{const q=h.call('remedy.preview',{case_id:key,action:'withdraw'}).quote;h.call('remedy.withdraw',{case_id:key,quote_digest:q.digest});h.note(key+'-reverse',owner,'remedy_withdrawal',`The remedy was withdrawn after dispatch. Keep ${old}; after delivery the return obligation is ${replacement}, with a separately displayed deadline.`);});
   t.at(base+2*day+(1+pi)*H,h=>h.event('replacement.delivered',{case_id:key,replacement_serial:replacement,source_actor_id:'person-courier'}));
   if(kind==='normal'){
    t.at(base+2*day+4*H,h=>{bank=request(h,'independent_bank_login',replacement);});t.at(base+2*day+5*H,h=>reply(h,bank,true));
    t.at(base+2*day+6*H,h=>{work=request(h,'independent_work_login',replacement);});t.at(base+2*day+7.5*H,h=>reply(h,work,false,true));
    t.at(base+3*day+H,h=>{enroll=request(h,'work_enrollment',replacement);});t.at(base+3*day+3*H,h=>h.event('verification.reply',{selector:enroll.selector,source_actor_id:'person-it',status:'refused',result:null}));
    t.at(base+3*day+6*H,h=>{enroll=request(h,'work_enrollment',replacement);});t.at(base+4*day+H,h=>reply(h,enroll,true));
    t.at(base+4*day+3*H,h=>{work=request(h,'independent_work_login',replacement);});t.at(base+4*day+5*H,h=>reply(h,work,true));
    t.at(base+5*day+H,h=>{wipe=request(h,'erasure',old);});t.at(base+5*day+2*H,h=>reply(h,wipe,true));
   }else{
    t.at(base+4*day+H,h=>{wipe=request(h,'erasure',replacement);});t.at(base+4*day+3*H,h=>reply(h,wipe,true));
   }
   const serial=kind==='normal'?old:replacement;
   t.at(base+3*day+5*H,h=>{pickup=h.call('pickup.schedule',{case_id:key,device_serial:serial,slot_id:slot1}).item;});
   if(missed){t.at(firstTime+2*H,h=>{h.note(key+'-missed','person-courier','missed_pickup',`No courier collected ${serial} during the first booked window. That reservation is effectively missed, not collected. A new appointment is required.`);pickup=h.call('pickup.schedule',{case_id:key,device_serial:serial,slot_id:slot2}).item;});}
   t.at(missed?secondTime:firstTime,h=>h.event('pickup.collected',{selector:pickup.selector,source_actor_id:'person-courier'}));
   t.at(base+(missed?11:9)*day+2*H,h=>h.event('return.received',{selector:pickup.selector,source_actor_id:'person-manufacturer'}));
   t.at(base+(missed?12:10)*day+4*H,h=>h.event('hold.released',{case_id:key,return_mode:kind==='normal'?'original_return':'withdrawal_return',device_serial:serial,source_actor_id:'person-manufacturer'}));
   t.at(base+(missed?13:11)*day+H,h=>h.call('case.close',{id:key}));
  }
  const end=base+(kind==='pre-dispatch-withdrawal'?5:missed?14:12)*day+H;
  t.at(end,h=>{const c=h.data.cases.find(c=>c.id===key),r=h.data.receipts.find(r=>r.selector.case_id===key);h.note(key+'-closeout','person-manufacturer','case_reconciliation',`Case ${key} ended ${c.status}; its ${(hold/100).toFixed(2)} USD hold is ${c.hold_status}. ${r?`Manufacturer receipt ${r.id} records ${r.selector.device_serial}, returned_late=${r.returned_late}.`:'No parcel receipt exists because dispatch was cancelled.'} Courier booking, collection, receipt and financial release remain separate facts.`);});
  cases.push(key);
 }
 t.at('2026-12-31T19:30:00Z',h=>h.note('annual-proof-'+p.key,'person-manufacturer','annual_reconciliation',`Account ${p.name}: the two-year service folder contains ${h.data.cases.length} case-specific offers, ${h.data.receipts.length} actual manufacturer returns, and ${h.data.postings.filter(p=>p.kind==='release').length} posted hold releases. Invoice and support records remain distinct from refundable case postings.`));
 return t.run(opt.before);
});
C.deliver(e,seeds,'Three cumulative per-account 2025-2026 service histories: separate purchases/coverage invoices/support decisions and nine varied remedy cases, with spaced checks, failed checks, IT refusals, missed pickups and late returns. --before replays only events before a Task cutoff.',opt);

