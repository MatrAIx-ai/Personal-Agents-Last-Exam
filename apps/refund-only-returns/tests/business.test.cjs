'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),p=require('../plugin.cjs');
const data=()=>structuredClone(require('../fixtures/minimal.json')),binding=require('../fixtures/binding.json');
const t='2026-01-10T09:00:00Z',late='2026-01-10T10:00:01Z';
const o=i=>({order_id:'order-'+i}),q=i=>({refund_request_id:i});
const call=(d,name,args,virtual_now=t)=>p.handleTool({binding,virtual_now},d,'refund-only-returns.'+name,args).result;
test('eligibility and seed semantics',()=>{const d=data();p.validateSeed({binding,virtual_now:t},d);for(const [i,e] of [[1,'eligible'],[2,'eligible'],[3,'expired'],[4,'ineligible'],[5,'already_requested'],[6,'already_requested']])a.equal(call(d,'lookup_order',o(i)).order.eligibility,e);a.throws(()=>call(d,'read_order',o(99)),{code:'not_found'});d.requests[0].order_id='missing';a.throws(()=>p.validateSeed({binding,virtual_now:t},d),{code:'invalid_seed'});});
test('exact instant, denial without mutation, allowed cancellation after expiry',()=>{const d=data();a.equal(call(d,'read_order',o(2),'2026-01-10T18:00:00+08:00').order.eligibility,'eligible');a.throws(()=>call(d,'confirm_request',q('request-1'),late),{code:'return_expired'});a.deepEqual(d,data());a.equal(call(d,'confirm_request',q('request-1')).request.status,'confirmed');a.equal(call(d,'confirm_request',q('request-1'),late).request.id,'request-1');a.equal(call(d,'cancel_request',q('request-1'),late).request.status,'cancelled');a.throws(()=>call(d,'prepare_preview',o(2),late),{code:'return_expired'});a.throws(()=>call(d,'cancel_request',q('request-4')),{code:'already_dispatched'});});
test('discard, confirm, cancel and restore eligibility',()=>{let d=data();let r=call(d,'prepare_preview',o(1)).request;a.throws(()=>call(d,'prepare_preview',o(1)),{code:'preview_exists'});a.equal(call(d,'discard_preview',q(r.id)).request.status,'discarded');a.throws(()=>call(d,'confirm_request',q(r.id)),{code:'not_draft'});r=call(d,'prepare_preview',o(1)).request;a.equal(call(d,'confirm_request',q(r.id)).request.order_id,'order-1');a.throws(()=>call(d,'prepare_preview',o(1)),{code:'already_requested'});call(d,'cancel_request',q(r.id));a.notEqual(call(d,'prepare_preview',o(1)).request.id,r.id);});
test('reject future orders or request history, not a future deadline',()=>{let d=data();d.orders[0].ordered_at='2026-01-12T10:00:00Z';a.throws(()=>p.validateSeed({binding,virtual_now:t},d),{code:'invalid_seed'});d=data();d.requests[0].created_at='2026-01-10T09:00:01Z';a.throws(()=>p.validateSeed({binding,virtual_now:t},d),{code:'invalid_seed'});p.validateSeed({binding,virtual_now:t},data());});
test('historical cutoff is independent of first session',()=>{const d=data();a.equal(d.orders[2].ordered_at.slice(0,10),'2025-01-01');p.validateSeed({binding,virtual_now:t},d);d.orders[2].ordered_at='2024-12-31T23:59:59Z';a.throws(()=>p.validateSeed({binding,virtual_now:t},d),{code:'invalid_seed'});});
test('public order numbers are unique; old internal IDs remain valid',()=>{
 const d=data(),x=call(d,'read_order',{order_id:'10421'});
 a.equal(x.order.id,'order-1');a.deepEqual(x,call(d,'read_order',{order_id:'order-1'}));
 d.orders[1].order_number='10421';
 a.throws(()=>p.validateSeed({binding,virtual_now:t},d),{code:'invalid_seed'});
});
test('same-clock terminal attempts have distinct business bodies',()=>{
 const d=data();
 for(let k=0;k<4;k++){
  let x=call(d,'prepare_preview',o(1)).request;
  a.equal(x.attempt,k+2);
  if(k<2)x=call(d,'confirm_request',q(x.id)).request;
  x=call(d,k<2?'cancel_request':'discard_preview',q(x.id)).request;
  a.equal(x.status,k<2?'cancelled':'discarded');
 }
 const body=r=>{const {id,...rest}=r;return JSON.stringify(rest);};
 const rows=p.records(d).filter(r=>r.order_id==='order-1');
 a.equal(new Set(rows.map(body)).size,rows.length);
 d.requests.at(-1).attempt=d.requests.at(-2).attempt;
 a.throws(()=>p.validateSeed({binding,virtual_now:t},d),{code:'invalid_seed'});
});
