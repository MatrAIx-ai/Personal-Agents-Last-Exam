'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,committed,preview,book}=require('./harness.cjs');
test('audit: venue cancellation accepts the full declared reason and leaves a sourced pending refund',t=>{
 const f=setup(t),r=book(f).reservation,reason='x'.repeat(200);committed(f.event('venue_cancelled',{reservation_id:r.id,reason,source_ref:'venue-closure-proof'}));
 const cancelled=f.call('agent','tablewise.reservations.get',{id:r.id}).reservation;assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.refund_due_cents,10000);assert.equal(cancelled.refund_paid_cents,0);assert.equal(cancelled.balance_due_cents,0);assert.ok(f.state.data.receipts.at(-1).text.includes(reason));
 assert.equal(f.event('venue_cancelled',{reservation_id:r.id,reason,source_ref:'repeat-closure'}).status,'reservation_closed');assert.equal(f.state.data.receipts.length,2);
});
test('audit: bounded overlap admits two permitted bookings and rejects a third',t=>{
 const f=setup(t),data=structuredClone(f.state.data);data.overlap_policy='bounded_overlap';assert.equal(f.call('infra','env.load_seed',{data,request_id:'overlap-profile',expected_version:{epoch:1,revision:0}}).status,'ready');
 book(f);book(f,'slot-2-28-19',2);const h=committed(f.write('holds.create',{slot_id:'slot-4-28-19',party_size:2,grant_id:'grant-1'})).hold;
 assert.equal(f.write('reservations.preview',{hold_id:h.id,grant_id:'grant-1'}).status,'booking_limit');assert.equal(f.state.data.reservations.length,2);
});
test('audit: participant responses do not amend a guaranteed headcount or price',t=>{
 const f=setup(t),r=book(f,'slot-2-28-19',8).reservation;committed(f.event('participant_replied',{plan_id:'plan-1',person_id:'person-alex',status:'declined',source_ref:'guest-decline'}));
 const plan=f.call('agent','tablewise.plans.get'),stored=f.call('agent','tablewise.reservations.get',{id:r.id}).reservation;assert.equal(plan.expected_attendance,1);assert.equal(plan.plan.participants[1].status,'declined');assert.equal(stored.guaranteed_headcount,8);assert.equal(stored.snapshot.cost.total_cents,78000);
});
test('audit: resuming identical holds, previews and pending inquiries does not create duplicate business records',t=>{
 const f=setup(t),args={slot_id:'slot-2-28-19',party_size:2,grant_id:'grant-1'};
 const first=committed(f.write('holds.create',args)).hold,again=committed(f.write('holds.create',args)).hold;assert.equal(first.id,again.id);assert.equal(f.state.data.holds.length,1);
 const p=committed(f.write('reservations.preview',{hold_id:first.id,grant_id:'grant-1'})).preview,p2=committed(f.write('reservations.preview',{hold_id:first.id,grant_id:'grant-1'})).preview;assert.equal(p.id,p2.id);assert.equal(f.state.data.previews.length,1);
 const inquiry={venue_id:'venue-2',party_size:8,menu_request:'Private dinner question'},i=committed(f.write('inquiries.create',inquiry)).inquiry,i2=committed(f.write('inquiries.create',inquiry)).inquiry;assert.equal(i.id,i2.id);assert.equal(f.state.data.inquiries.length,1);
 committed(f.write('reservations.confirm',{preview_id:p2.id}));assert.equal(f.state.data.reservations.length,1);
});
test('audit: unreleased inventory stays private while published opening times remain visible',t=>{
 const f=setup(t),w=f.call('agent','tablewise.workspace.get');
 assert.equal(w.workspace.slots.some(s=>s.venue_id==='venue-3'),false);
 assert.ok(w.release_rules.some(r=>r.venue_id==='venue-3'&&r.opens_at==='2026-11-24T10:00:00-08:00'));
 const result=f.call('agent','tablewise.availability.get',{venue_id:'venue-3',party_size:2});
 assert.equal(result.slots[0].status,'not_yet_released');assert.equal(result.slots[0].slot,null);
 committed(f.clock('2026-11-24T10:00:00-08:00'));
 assert.equal(f.call('agent','tablewise.workspace.get').workspace.slots.filter(s=>s.venue_id==='venue-3').length,6);
});
test('audit: a lower amendment deposit retains the full actual credit and correct balance',t=>{
 const f=setup(t),r=book(f,'slot-2-28-19',2).reservation;
 committed(f.event('terms_published',{venue_id:'venue-2',terms:{...r.snapshot.terms,revision:2,deposit_cents:2000},source_ref:'venue-lower-deposit'}));
 const p=committed(f.write('reservations.change_preview',{id:r.id,slot_id:'slot-2-29-19',party_size:2,grant_id:'grant-1'})).preview;
 assert.equal(p.charge_cents,0);assert.equal(p.deposit_credit_cents,10000);
 const changed=committed(f.write('reservations.change_confirm',{preview_id:p.id}));
 assert.equal(changed.reservation.deposit_paid_cents,10000);assert.equal(changed.reservation.balance_due_cents,68000);
 assert.ok(changed.receipt.text.includes('Remaining meal balance: USD 680.00'));
});
test('audit: UTC input sittings are searched by Los Angeles dining date',t=>{
 const f=setup(t),s=f.state.data.slots.find(s=>s.id==='slot-1-28-19');s.starts_at='2026-11-29T03:00:00Z';
 const out=f.call('agent','tablewise.availability.get',{venue_id:'venue-1',date:'2026-11-28',party_size:2});
 assert.ok(out.slots.some(x=>x.slot?.id===s.id));
});
test('audit: pending refunds still consume the trusted deposit budget',t=>{
 const f=setup(t);f.state.data.grants[0].max_deposit_cents=10000;const r=book(f).reservation;
 const cp=committed(f.write('reservations.cancel_preview',{id:r.id,grant_id:'grant-1'})).preview;committed(f.write('reservations.cancel_confirm',{preview_id:cp.id}));
 const h=committed(f.write('holds.create',{slot_id:'slot-1-29-19',party_size:2,grant_id:'grant-1'})).hold;
 assert.equal(f.write('reservations.preview',{hold_id:h.id,grant_id:'grant-1'}).status,'deposit_limit');
 committed(f.event('refund_recorded',{refund_id:'refund-budget',reservation_id:r.id,amount_cents:10000,source_ref:'provider-confirmation'}));
 assert.equal(f.write('reservations.preview',{hold_id:h.id,grant_id:'grant-1'}).status,'committed');
});
test('audit: cancellation crossing the exact free cutoff requires a new preview',t=>{
 const f=setup(t),r=book(f).reservation;committed(f.clock('2026-11-27T18:59:00-08:00'));
 const p=committed(f.write('reservations.cancel_preview',{id:r.id,grant_id:'grant-1'})).preview;assert.equal(p.fee_cents,0);
 committed(f.clock('2026-11-27T19:00:00-08:00'));assert.equal(f.write('reservations.cancel_confirm',{preview_id:p.id}).status,'stale_preview');
 assert.equal(f.state.data.reservations[0].status,'confirmed');const fresh=committed(f.write('reservations.cancel_preview',{id:r.id,grant_id:'grant-1'})).preview;
 assert.equal(fresh.fee_cents,15000);assert.equal(fresh.charge_cents,5000);assert.equal(fresh.refund_due_cents,0);
 committed(f.write('reservations.cancel_confirm',{preview_id:fresh.id}));
});
