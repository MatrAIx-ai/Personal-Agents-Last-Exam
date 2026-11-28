'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyEvent,handleTool,validateSeed}=require('../plugin.cjs');
const d=()=>structuredClone(require('../fixtures/minimal.json'));
const seedClock=require('../fixtures/clock.json').initial_time;
const ctx=(virtual_now=seedClock)=>({binding:require('../fixtures/binding.json'),virtual_now,role:'agent'});
const event=require('../examples/scenario.json');
const tool=(s,name,args={},c=ctx())=>handleTool(c,s,'home-repair-slots.'+name,args).result;
const fail=(f,code)=>assert.throws(f,{code});
const ap=(s,at=event.at)=>applyEvent({...ctx(at),role:'infra'},s,event);
const list=s=>tool(s,'list_slots').slots.map(x=>x.id);
test('browse respects seed budget, date, borrowed capacity and exact clock boundary',()=>{
 const s=d();
 validateSeed(ctx(),s);
 assert.deepEqual(list(s),['S1','S2','S4']);
 assert.deepEqual(tool(s,'list_slots',{},ctx('2027-01-12T02:00:00Z')).slots.map(x=>x.id),['S2','S4']);
 const b=structuredClone(s);
 for(const id of ['S7','S8','S5'])fail(()=>tool(s,'select_slot',{slot_id:id}),'slot_unavailable');
 for(const id of ['S3','S6'])fail(()=>tool(s,'select_slot',{slot_id:id}),'outside_constraints');
 assert.deepEqual(s,b);
});
test('seed contains dated prior booking activity without shifting the task clock or availability',()=>{
 const s=d(),initial=Date.parse(seedClock);
 assert.ok(initial>=Date.parse('2026-01-01T00:00:00+08:00'));
 assert.equal(s.history[0].at.slice(0,10),'2025-01-01');
 assert.deepEqual([...new Set(s.history.map(h=>h.at.slice(0,4)))],['2025','2026']);
 const state=structuredClone(s);
 for(let n=0;n<s.history.length;n+=2){
  const [confirmed,cancelled]=s.history.slice(n,n+2);
  const {booking,slot}=tool(s,'get_booking',{booking_id:confirmed.object_id});
  assert.equal(confirmed.operation,'confirm_reservation');assert.equal(cancelled.operation,'cancel_booking');
  assert.equal(cancelled.object_id,confirmed.object_id);
  assert.equal(slot.id,confirmed.slot_id);assert.equal(slot.id,cancelled.slot_id);
  assert.equal(booking.status,'cancelled');
  assert.ok(Date.parse(confirmed.at)<Date.parse(cancelled.at));
  assert.ok(Date.parse(cancelled.at)<Date.parse(slot.start));
  assert.ok(Date.parse(slot.start)<initial);
  fail(()=>tool(s,'select_slot',{slot_id:slot.id}),'slot_unavailable');
 }
 assert.deepEqual(list(s),['S1','S2','S4']);
 assert.deepEqual(s,state);
});
test('preview replacement and discard never hold a slot or create a booking',()=>{
 const s=d(),r=tool(s,'select_slot',{slot_id:'S1'}).reservation;
 assert.equal(r.id,'R1');assert.equal(s.reservations[0].status,'discarded');
 assert.deepEqual(list(s),['S1','S2','S4']);
 assert.equal(tool(s,'discard_reservation',{reservation_id:r.id}).reservation.status,'discarded');
 assert.equal(s.bookings.length,8);
 fail(()=>tool(s,'confirm_reservation',{reservation_id:r.id}),'not_open');
});
test('race invalidates a preview without booking; non-Infra, no-open, booked and past guards are atomic',()=>{
 const s=d(),r=tool(s,'select_slot',{slot_id:'S1'}).reservation;
 const b=structuredClone(s);
 fail(()=>applyEvent(ctx(),s,event),'invalid_event');assert.deepEqual(s,b);
 ap(s);
 assert.equal(tool(s,'get_reservation',{reservation_id:r.id}).reservation.status,'invalidated');
 fail(()=>tool(s,'confirm_reservation',{reservation_id:r.id}),'slot_unavailable');
 assert.deepEqual(list(s),['S2','S4']);assert.equal(s.bookings.length,8);
 const taken=structuredClone(s);fail(()=>ap(s),'invalid_event');assert.deepEqual(s,taken);
 const booked=d();booked.reservations[0].slot_id='S5';
 const bBooked=structuredClone(booked);fail(()=>ap(booked),'invalid_event');assert.deepEqual(booked,bBooked);
 const past=d(),bPast=structuredClone(past);fail(()=>ap(past,'2027-01-12T12:00:00+08:00'),'invalid_event');assert.deepEqual(past,bPast);
});
test('confirmed, moved, and cancelled bookings are atomic and readable; no double booking',()=>{
 const s=d(),r=tool(s,'select_slot',{slot_id:'S1'}).reservation;
 const b=tool(s,'confirm_reservation',{reservation_id:r.id}).booking;
 assert.equal(b.id,'B5');assert.equal(b.slot_id,'S1');
 const prior=structuredClone(s);
 fail(()=>tool(s,'confirm_reservation',{reservation_id:r.id}),'already_confirmed');
 fail(()=>tool(s,'reschedule_booking',{booking_id:b.id,slot_id:'S3'}),'outside_constraints');
 fail(()=>tool(s,'reschedule_booking',{booking_id:b.id,slot_id:'S5'}),'slot_unavailable');
 assert.deepEqual(s,prior);
 const moved=tool(s,'reschedule_booking',{booking_id:b.id,slot_id:'S4'}).booking;
 assert.equal(moved.id,b.id);assert.equal(moved.slot_id,'S4');assert.deepEqual(list(s),['S1','S2']);
 tool(s,'cancel_booking',{booking_id:b.id});
 assert.equal(tool(s,'get_booking',{booking_id:b.id}).booking.status,'cancelled');
 const cancelled=structuredClone(s);
 fail(()=>tool(s,'cancel_booking',{booking_id:b.id}),'already_cancelled');assert.deepEqual(s,cancelled);
 assert.deepEqual(list(s),['S1','S2','S4']);
});
test('no suitable alternative can be reported without changing constraints or business state',()=>{
 const s=d();s.constraints.budget_minor=10000;
 const r=tool(s,'select_slot',{slot_id:'S1'}).reservation;ap(s);
 const prior=structuredClone(s);
 assert.deepEqual(list(s),[]);assert.deepEqual(s,prior);
 fail(()=>tool(s,'confirm_reservation',{reservation_id:r.id}),'slot_unavailable');assert.equal(s.bookings.length,8);
});
