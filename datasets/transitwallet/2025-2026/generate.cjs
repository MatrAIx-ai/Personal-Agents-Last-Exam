'use strict';
const C=require('./common.cjs'),e=C.environment('transitwallet',__dirname),{day,iso}=C,seeds=[];
const purposes=['job interview','library training','family visit','public consultation','course orientation','community meeting','equipment fitting','volunteer shift','research appointment','gallery visit','benefits meeting','year-end gathering'];
for(let i=0;i<24;i++){
 const year=2025+Math.floor(i/12),month=i%12+1,key=year+'-'+String(month).padStart(2,'0'),start=key+(i===23?'-30':'-01')+'T09:00:00Z';
 const data=C.retime(e,C.fixture(e,['minimal.json','account-sam.json','account-jo.json'][i%3]),start),t=s=>iso(Date.parse(s)+Date.parse(start)-Date.parse(e.clock));
 for(const r of data.records)r.created_at=start;data.records=data.records.slice(0,3);
 for(const [j,r]of data.records.entries())r.body=[`Trip brief (${key}): ${purposes[i%12]}. Preserve provider-confirmed assistance and inspect physical arrival separately from ticket payment. The opening credit is synthetic and does not grant unlimited spending.`,`The current chair width is ${data.equipment[0].width_mm} mm, revision ${data.equipment[0].revision}; verify the actual dated service. Do not substitute an older profile for the current equipment record.`,`The early return is tentative. If the meeting runs late, cancel any paid early ticket and inspect the actual refund before replacing it; unused unpaid holds may expire.`][j];
 for(const s of data.services){s.created_at=start;s.label=purposes[i%12]+' — '+s.label;s.fare_cents+=i%3*100;s.cancel_fee_cents=(i%5===0&&s.id.includes('early'))?100:0;}
 data.equipment[0].updated_at=start;data.ledger[0].created_at=start;
 const h=C.runner(e,data,start),equipment=data.equipment[0];
 const hold=service=>h.call('booking.hold',{service_id:service,equipment_id:equipment.id}).item;
 const confirm=b=>{const q=h.call('booking.preview',{id:b.id,action:'confirm'}).quote;return h.call('booking.confirm',{id:b.id,quote_digest:q.digest}).item;};
 const cancel=b=>{const q=h.call('booking.preview',{id:b.id,action:'cancel'}).quote;return h.call('booking.cancel',{id:b.id,quote_digest:q.digest});};
 const assist=b=>{const q=h.call('assistance.request',{booking_id:b.id,declared_width_mm:equipment.width_mm,equipment_revision:equipment.revision}).item;h.event('assistance.reply',{selector:q.selector,source_actor_id:'person-provider',status:'confirmed',equipment_revision:equipment.revision});return q;};
 const out=confirm(hold('wide-out-20270209')),earlyHold=hold('wide-early-20270209');
 const early=i%2?earlyHold:confirm(earlyHold);assist(out);if(i%2===0)assist(early);
 const j=h.call('journey.plan',{booking_id:out.id}).item;
 h.event('route.update',{service_id:'rail-out-20270209',source_actor_id:'person-provider',status:i%3?'lift_unavailable':'unavailable'},t('2027-02-09T06:10:00-06:00'));
 h.event('journey.perform',{selector:j.selector,phase:'departure',source_actor_id:'person-provider',actual_equipment:{width_mm:equipment.width_mm,equipment_revision:equipment.revision},user_ready:true},t('2027-02-09T07:30:00-06:00'));
 h.event('journey.perform',{selector:j.selector,phase:'arrival',source_actor_id:'person-provider'},t('2027-02-09T08:30:00-06:00'));
 h.advance(t('2027-02-09T10:40:00-06:00'));if(i%2===0)cancel(early);
 const back=confirm(hold('wide-late-20270209'));assist(back);const j2=h.call('journey.plan',{booking_id:back.id}).item;
 h.event('journey.perform',{selector:j2.selector,phase:'departure',source_actor_id:'person-provider',actual_equipment:{width_mm:equipment.width_mm,equipment_revision:equipment.revision},user_ready:true},t('2027-02-09T12:30:00-06:00'));
 h.event('journey.perform',{selector:j2.selector,phase:'arrival',source_actor_id:'person-provider'},t('2027-02-09T13:30:00-06:00'));
 h.event('record.add',{id:'trip-closeout',source_actor_id:data.owner_person_id,body:`${key}: outward and later return physically completed. The earlier ${i%2?'unpaid reservation lapsed':'paid ticket was cancelled and refunded minus its disclosed retained fee'}. Use the full immutable ledger to reconcile the actual net fare.`});
 const wallet=h.call('wallet.get');C.assert.equal(h.data.journeys.filter(x=>x.status==='completed').length,2);
 const item=C.seed(e,key,h.data,i%2?'expired-unpaid-return':'cancelled-paid-return',`${purposes[i%12]} with later return; observed account net debit ${data.ledger[0].amount_cents-wallet.balance_cents} cents.`);seeds.push(item);
}
const r=C.deliver(e,seeds,'24 original synthetic selected travel episodes, rotating three account profiles. Both actual trip legs, current equipment, assistance proofs, cancelled paid returns or lapsed unpaid holds, and append-only debits/refunds are loaded as business records. This is a selected episode corpus, not an exhaustive daily commute log.');
console.log(JSON.stringify({app:e.id,seeds:r.seed_count,dates:r.global_distinct_dates,months:Object.keys(r.months).length}));
