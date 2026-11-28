'use strict';
const test=require('node:test'),A='community-lending-library',assert=require('node:assert/strict');
const {handleTool,applyEvent,validateSeed}=require('../plugin.cjs'),binding=require('../fixtures/binding.json');
const data=()=>structuredClone(require('../fixtures/minimal.json'));
const ctx=(virtual_now='2026-12-10T09:00:00+08:00')=>({binding,virtual_now,role:'agent'});
const call=(d,n,a={},c=ctx())=>handleTool(c,d,A+'.'+n,a);
const send=(d,payload,operation='desk_outcome',at='2026-12-10T09:00:00+08:00',event_id='desk-test')=>applyEvent({...ctx(at),role:'infra'},d,{event_id,at,payload,operation:A+'.'+operation});
const payload=(operation,attempt,outcome='accepted')=>({operation,attempt,outcome,member_id:'M1',copy_id:'C4'});
test('catalog has maintenance exclusion, bound user isolation and non-mutating derived clock reads',()=>{
 const d=data(),before=structuredClone(d);validateSeed(ctx(),d);
 assert.equal(call(d,'search_items').result.items.length,8);
 assert.equal(call(d,'get_item',{item_id:'I6'}).result.copies[0].status,'maintenance');
 assert.throws(()=>call(d,'request_return',{loan_id:'L1'}),{code:'not_found'});
 assert.throws(()=>call(d,'preview_renewal',{loan_id:'L1'}),{code:'not_found'});
 assert.deepEqual(call(d,'list_loans').result.loans,[]);
 const at=ctx('2026-12-11T09:00:00+08:00');
 assert.equal(call(d,'list_holds',{},at).result.holds[0].status,'expired');
 assert.deepEqual(d,before);
});
test('checkout exact tuple, cancellation and late outcome, rejected/accepted receipt, return custody, and one renewal',()=>{
 let d=data();
 const q=call(d,'request_checkout',{hold_id:'H1'});
 assert.equal(q.result.attempt.attempt,2);d=q.data;
 assert.equal(call(d,'list_loans').result.loans.length,0);
 assert.throws(()=>send(structuredClone(d),payload('checkout',1)),{code:'invalid_event'});
 d=send(d,payload('checkout',2,'rejected'));
 assert.equal(call(d,'list_loans').result.loans.length,0);
 const retry=call(d,'request_checkout',{hold_id:'H1'});d=retry.data;assert.equal(retry.result.attempt.attempt,3);
 d=send(d,payload('checkout',3),'desk_outcome',undefined,'accepted-checkout');
 const loan=call(d,'list_loans').result.loans[0];assert.equal(loan.copy_id,'C4');
 const preview=call(d,'preview_renewal',{loan_id:loan.id});assert.equal(preview.result.eligible,true);
 d=call(d,'confirm_renewal',{loan_id:loan.id}).data;
 assert.equal(call(d,'preview_renewal',{loan_id:loan.id}).result.reason,'already_renewed');
 const ret=call(d,'request_return',{loan_id:loan.id});d=ret.data;
 assert.equal(call(d,'list_loans').result.loans[0].returned_at,null);
 d=send(d,payload('return',1,'rejected'),'desk_outcome',undefined,'rejected-return');
 assert.equal(call(d,'list_loans').result.loans[0].returned_at,null);
 d=call(d,'request_return',{loan_id:loan.id}).data;
 d=send(d,payload('return',2),'desk_outcome',undefined,'accepted-return');
 assert.ok(call(d,'list_loans').result.loans[0].returned_at);
 assert.equal(call(d,'get_item',{item_id:'I2'}).result.copies.find(x=>x.id==='C4').status,'available');
});
test('FIFO promotes at historical expiry with committed-state equality on reads',()=>{
 let d=data();d=send(d,{item_id:'I2',member_id:'M3',sequence:12},'queue_join',undefined,'queue-a');
 d=send(d,{item_id:'I2',member_id:'M4',sequence:13},'queue_join',undefined,'queue-b');
 const before=structuredClone(d), later=ctx('2026-12-11T15:00:00+08:00');
 assert.equal(call(d,'get_item',{item_id:'I2'},later).result.item.queue_length,1);
 assert.deepEqual(d,before);
 const next=call(d,'confirm_hold',{item_id:'I1',copy_id:'C1'},later).data;
 const h=next.holds.find(x=>x.member_id==='M3');assert.equal(h.created_at,'2026-12-11T01:00:00.000Z');
 assert.equal(h.expires_at,'2026-12-12T01:00:00.000Z');
 assert.equal(next.queue[0].member_id,'M4');
});
test('two-copy cap; overdue stays open, blocks hold and renewal but allows return',()=>{
 const c=ctx(),d=data();
 const n=call(d,'confirm_hold',{item_id:'I1',copy_id:'C1'}).data;
 assert.throws(()=>call(n,'confirm_hold',{item_id:'I1',copy_id:'C2'}),{code:'limit_reached'});
 const custom=data();custom.member_id='M2';
 const ownCtx={...c,virtual_now:'2026-12-16T09:00:00+08:00',binding:{...binding,accounts:[{...binding.accounts[0],owner_person_id:'M2'}]}};
 assert.equal(call(custom,'list_loans',{},ownCtx).result.loans[0].overdue,true);
 assert.equal(call(custom,'preview_renewal',{loan_id:'L1'},ownCtx).result.reason,'overdue');
 assert.throws(()=>call(custom,'confirm_hold',{item_id:'I1',copy_id:'C1'},ownCtx),{code:'overdue'});
 assert.equal(call(custom,'request_return',{loan_id:'L1'},ownCtx).result.attempt.status,'pending');
});
test('six task-selectable scenario presets retain scoped bindings and valid synthetic dates',()=>{
 const {choices,build}=require('../fixtures/scenarios.cjs');
 assert.equal(choices.length,6);
 for(const n of choices){
  const x=build(n);validateSeed({binding:x.binding},x.data);
  assert.ok(['scenario','sandbox'].includes(x.profile));
  assert.ok(Date.parse(x.virtual_now)>=Date.parse('2026-01-01T00:00:00Z'));
 }
 assert.equal(build('desk-replay').data.attempts.at(-1).attempt,2);
 assert.equal(build('fifo-expiry').data.queue.length,2);
 assert.equal(build('observer').profile,'scenario');
});
test('2025 local floor is inclusive, but future observed history is not a valid baseline',()=>{
 const early=data();
 early.seed_at='2025-01-01T00:00:00+08:00';
 validateSeed(ctx(),early);
 early.seed_at='2024-12-31T23:59:59+08:00';
 assert.throws(()=>validateSeed(ctx(),early),{code:'invalid_seed'});
 early.seed_at='2025-01-01T00:00:00+08:00';
 early.attempts[0].resolved_at='2026-12-11T09:00:00+08:00';
 assert.throws(()=>validateSeed(ctx(),early),{code:'invalid_seed'});
});
test('FIFO terminal history is internal and equal in projection vs committed result',()=>{
 const d=send(data(),{item_id:'I2',member_id:'M3',sequence:12},'queue_join');
 const prior=structuredClone(d),later=ctx('2026-12-11T12:00:00+08:00');
 assert.equal(call(d,'get_item',{item_id:'I2'},later).result.item.queue_length,0);
 assert.deepEqual(d,prior);
 const next=call(d,'confirm_hold',{item_id:'I1',copy_id:'C1'},later).data;
 validateSeed(later,next);
 assert.deepEqual(next.queue_history,[{...prior.queue[0],ended_at:'2026-12-11T01:00:00.000Z',outcome:'promoted'}]);
 assert.deepEqual(call(next,'list_holds',{},later).result.queue,[]);
});

test('waitlist denies the current borrower and maintenance-only items without leaking other due dates',()=>{
 const m2=data();m2.member_id='M2';
 const ownCtx={...ctx(),binding:{...binding,accounts:[{...binding.accounts[0],owner_person_id:'M2'}]}};
 const req=call(m2,'get_item',{item_id:'I2'},ownCtx).result;
 assert.equal(req.item.your_active_loan,true);assert.ok(req.copies.find(x=>x.id==='C3').your_due_at);
 assert.equal(call(data(),'get_item',{item_id:'I2'}).result.copies.find(x=>x.id==='C3').your_due_at,undefined);
 assert.throws(()=>call(m2,'join_queue',{item_id:'I2'},ownCtx),{code:'already_borrowed'});
 assert.throws(()=>call(m2,'join_queue',{item_id:'I6'},ownCtx),{code:'not_circulating'});
 assert.throws(()=>send(m2,{item_id:'I6',member_id:'M3',sequence:12},'queue_join'),{code:'not_circulating'});
 assert.deepEqual(call(m2,'search_items',{query:'I6'},ownCtx).result.items,[]);
 assert.equal(call(m2,'list_holds',{},ownCtx).result.member_name,'Arun Patel');
});
