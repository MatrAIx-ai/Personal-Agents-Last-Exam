'use strict';
const C=require('./common.cjs'),e=C.environment('warrantydesk',__dirname),{day,iso}=C,seeds=[];
const episodes={3:'normal',7:'pre-dispatch-withdrawal',11:'shipped-withdrawal',15:'shipped-withdrawal',19:'normal',23:'pre-dispatch-withdrawal'};
const notes=[
 ['Purchase proof','Retained the dated purchase record and serial mapping in the private service folder; no passwords or recovery codes belong in a repair packet.'],
 ['Ownership handover','The household spare remains separately inventoried. A borrowed device does not transfer authority to wipe or surrender the owner’s work handset.'],
 ['Backup rehearsal','Restored a test contact to the spare device. Copied files and app icons do not certify an independent work login.'],
 ['Coverage inquiry','Checked which purchase document would be needed for a future eligibility decision; no replacement order or refundable hold was authorized.'],
 ['Intermittent fault','Recorded the intermittent charging symptom and an available spare before choosing whether the offered remedy was still needed.'],
 ['Account separation','Moved the proof-of-purchase copy into the owner’s folder. Employer authentication instructions remain in the private journal.'],
 ['Travel contingency','A planned trip narrows courier availability. A future return must use the actual serial and a slot whose booking and cancellation cutoffs remain open.'],
 ['Courier address review','Confirmed the fictional service address and delivery contact for future authorized collection; this note is not a booked pickup.'],
 ['Replacement inspection','Recorded why the shipped remedy no longer suited the owner. Keeping the original requires returning the actual replacement, not sending the old device by habit.'],
 ['Warranty document renewal','Filed the updated coverage document after a household device purchase. Terms are synthetic; eligibility still comes from a case-specific provider offer.'],
 ['Banking continuity rehearsal','Checked that recovery instructions were available to the owner without sharing a one-time code. A future migration still needs performed exact-device login tests.'],
 ['Year-end inventory','Reconciled retained purchase proofs, owned serials and any manufacturer receipt already in the service folder. A courier handoff alone is not a manufacturer receipt.']
];
for(let i=3;i<24;i+=4){
 const year=2025+Math.floor(i/12),month=i%12+1,key=year+'-'+String(month).padStart(2,'0'),start=key+(i===23?'-24':'-01')+'T09:00:00Z',target=Date.parse(start),delta=target-Date.parse(e.clock),t=s=>iso(Date.parse(s)+delta);
 const data=C.retime(e,C.fixture(e,['minimal.json','account-maya.json','account-ren.json'][(i-3)/4%3]),start),kind=episodes[i]||'service-context';
 data.records=Array.from({length:4},(_,j)=>{const k=i-3+j,m=String(k%12+1).padStart(2,'0');return {id:'service-context-'+j,source_actor_id:data.owner_person_id,body:`${notes[k%12][0]} (${year}-${m}). ${notes[k%12][1]} This is an original fictional service record, not observed manufacturer history.`,created_at:year+'-'+m+'-01T09:00:00.000Z'};});
 if(kind==='service-context'){
  for(const k of ['devices','offers','cases','slots','requests','pickups','receipts','postings','history'])data[k]=[];
 }else{
  for(const o of data.offers)o.created_at=start;for(const c of data.cases)c.created_at=start;
  const h=C.runner(e,data,start),caseId='case-1',q=h.call('remedy.preview',{case_id:caseId,action:'accept'}).quote;h.call('remedy.accept',{case_id:caseId,quote_digest:q.digest});
  const event=(op,payload,at)=>h.event(op,payload,at);
  const withdraw=()=>{const q=h.call('remedy.preview',{case_id:caseId,action:'withdraw'}).quote;h.call('remedy.withdraw',{case_id:caseId,quote_digest:q.digest});};
  if(kind==='pre-dispatch-withdrawal'){
   h.advance(iso(target+day));withdraw();event('hold.released',{case_id:caseId,reason:'cancelled_before_dispatch',source_actor_id:'person-manufacturer'},iso(target+2*day));h.call('case.close',{id:caseId});
  }else{
   event('replacement.dispatched',{case_id:caseId,replacement_serial:'NEW-42',source_actor_id:'person-manufacturer'},t('2027-02-23T17:00:00-06:00'));
   if(kind==='shipped-withdrawal')withdraw();
   event('replacement.delivered',{case_id:caseId,replacement_serial:'NEW-42',source_actor_id:'person-courier'},t('2027-02-23T18:00:00-06:00'));
   const check=(kind,serial)=>{const r=h.call('verification.request',{case_id:caseId,device_serial:serial,kind}).item;event('verification.reply',{selector:r.selector,source_actor_id:r.source_actor_id,status:'performed',result:{success:true,used_old_device:false}});};
   if(kind==='normal'){check('work_enrollment','NEW-42');check('independent_bank_login','NEW-42');check('independent_work_login','NEW-42');check('erasure','OLD-17');}
   const serial=kind==='normal'?'OLD-17':'NEW-42',p=h.call('pickup.schedule',{case_id:caseId,device_serial:serial,slot_id:'slot-26'}).item;
   event('pickup.collected',{selector:p.selector,source_actor_id:'person-courier'},t('2027-02-26T15:30:00-06:00'));
   // A fixed 7-day historical episode preserves separate collection, receipt and posting.
   const receiptAt=iso(target+6*day);event('return.received',{selector:p.selector,source_actor_id:'person-manufacturer'},receiptAt);
   event('hold.released',{case_id:caseId,return_mode:kind==='normal'?'original_return':'withdrawal_return',device_serial:serial,source_actor_id:'person-manufacturer'},iso(target+6*day+3600000));h.call('case.close',{id:caseId});
  }
  h.event('record.add',{id:'service-closeout',source_actor_id:data.owner_person_id,body:`${key}: ${kind}; the case closes only after the actual release posting. Serial-specific collection and manufacturer receipt are retained when a physical return was required.`},iso(target+7*day));
  Object.assign(data,h.data);
 }
 seeds.push(C.seed(e,key,data,kind,notes[i%12][0]+(kind==='service-context'?'; no repair or financial action is invented.':'; complete '+kind+' business episode.')));
}
const r=C.deliver(e,seeds,'Six original synthetic replacement/withdrawal workspace partitions across three people over two years, each carrying four months of relevant prior purchase/coverage/continuity/courier context. Every month is represented; lower repair frequency is intentional rather than inventing monthly phone failures.');
console.log(JSON.stringify({app:e.id,seeds:r.seed_count,dates:r.global_distinct_dates,months:Object.keys(r.months).length}));
