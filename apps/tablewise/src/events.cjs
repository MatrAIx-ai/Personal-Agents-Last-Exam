'use strict';
const m=require('./model.cjs'),{find,need}=m;
function applyEvent(ctx,data,event){const d=structuredClone(data),a=event.payload;
 switch(event.operation){
 case 'dining.inventory_changed':{const s=find(d,'slots',a.slot_id);need(a.external_booked_seats<=s.capacity,'capacity_exceeded','External seats exceed capacity.');const increase=a.external_booked_seats-s.external_booked_seats;need(increase<=m.seats(ctx,d,s),'capacity_exceeded','External booking cannot take protected seats.');s.external_booked_seats=a.external_booked_seats;break;}
 case 'dining.authority_recorded':{need(!d.grants.some(g=>g.id===a.grant.id),'duplicate_grant','Grant IDs are immutable; issue a new grant.');need(a.grant.source_ref,'invalid_source','Trusted user decision required.');d.grants.push(a.grant);break;}
 case 'dining.authority_revoked':find(d,'grants',a.grant_id).revoked=true;break;
 case 'dining.participant_replied':{const p=find(d,'plans',a.plan_id),guest=p.participants.find(p=>p.person_id===a.person_id);need(p.status==='active'&&guest,'invalid_participant','Reply must identify an invited run-bound person.');guest.status=a.status;guest.source_ref=a.source_ref;p.revision++;break;}
 case 'dining.venue_quoted':{const q=a.quote,i=find(d,'inquiries',q.inquiry_id),old=d.quotes.filter(r=>r.inquiry_id===i.id);need(!d.quotes.some(r=>r.id===q.id)&&q.revision>Math.max(0,...old.map(r=>r.revision)),'stale_quote','Quote IDs and revisions must advance.');need(m.stamp(q.valid_until)>m.stamp(ctx.virtual_now),'quote_expired','Venue quote already expired.');d.quotes.push(q);i.status='quoted';break;}
 case 'dining.terms_published':{const v=find(d,'venues',a.venue_id);need(a.terms.revision>v.terms.revision,'stale_terms','Terms revision must advance.');need(a.terms.asset_id===v.terms.asset_id,'unsupported_asset','M1 requires the package original; new originals need a Task bundle.');v.terms=a.terms;break;}
 case 'dining.refund_recorded':{const r=find(d,'reservations',a.reservation_id),old=d.refunds.find(f=>f.id===a.refund_id);if(old){need(old.reservation_id===r.id&&old.amount_cents===a.amount_cents&&old.source_ref===a.source_ref,'payment_conflict','Refund ID has different evidence.');break;}need(r.status==='cancelled'&&a.amount_cents>0&&r.refund_paid_cents+a.amount_cents<=r.refund_due_cents,'over_refund','Refund exceeds the outstanding amount.');d.refunds.push({id:a.refund_id,reservation_id:r.id,amount_cents:a.amount_cents,source_ref:a.source_ref,at:ctx.virtual_now});r.refund_paid_cents+=a.amount_cents;m.receipt(ctx,d,r,'refund paid',0);break;}
 case 'dining.venue_cancelled':{const r=find(d,'reservations',a.reservation_id);need(r.status==='confirmed','reservation_closed','Venue can cancel a confirmed reservation once.');r.status='cancelled';r.revision++;r.cancelled_at=ctx.virtual_now;r.refund_due_cents=r.deposit_paid_cents;r.fee_cents=0;m.receipt(ctx,d,r,'venue cancelled: '+a.reason,0);break;}
 default:need(false,'unknown_event','Unsupported venue event.');
 }
 return d;
}
module.exports={applyEvent};
