'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),plugin=require('../plugin.cjs'),binding=require('../fixtures/binding.json');
const seed=()=>structuredClone(require('../fixtures/minimal.json'));
const t0='2026-01-15T10:00:00Z',end='2026-02-01T00:00:00Z',account_id='account-1';
const ctx=(virtual_now=t0)=>({binding,virtual_now});
const run=(d,n,args={},t=t0)=>plugin.handleTool(ctx(t),d,'subscription-exit.'+n,{account_id,...args});
const status=(d,t)=>run(d,'read_status',{},t).result.entitlement;
const prepare=(d,action='cancellation',t=t0)=>run(d,'prepare_'+action,{},t).result.preview.id;
const confirm=(d,preview_id,t=t0)=>run(d,'confirm',{preview_id},t).result.receipt;

test('Abandoning a cancellation preview does not change entitlement',()=>{
 const d=seed(),id=prepare(d);a.equal(status(d).entitlement,'paid_active');
 run(d,'abandon',{preview_id:id});a.equal(d.previews[0].status,'abandoned');a.equal(d.action_receipts.length,0);
 a.throws(()=>confirm(d,id),{code:'not_open'});a.equal(status(d).renewal,'scheduled');
});
test('Cancel retains paid access until equality; read is non-mutating',()=>{
 const d=seed(),id=prepare(d);const r=confirm(d,id);a.equal(r.effective_at,end);a.equal(r.resulting_status,'cancellation_scheduled');
 const before=structuredClone(d);a.equal(status(d,'2026-01-31T23:59:59Z').access,'paid');
 const after=status(d,end);a.equal(after.access,'free');a.equal(after.effective_end,end);a.deepEqual(after.saved,before.saved);a.deepEqual(d,before);
 a.throws(()=>prepare(d,'revocation',end),{code:'free_account'});
 a.deepEqual(run(d,'read_receipt',{receipt_id:r.id},end).result.receipt,r);
});
test('A pre-end revocation preview is stale at equality with no second receipt',()=>{
 const d=seed();confirm(d,prepare(d));const id=prepare(d,'revocation','2026-01-31T23:59:59Z');
 const before=structuredClone(d);a.throws(()=>confirm(d,id,end),{code:'stale_preview'});a.deepEqual(d,before);
 a.equal(run(d,'read_status',{},end).result.open_previews.length,0);
});
test('Confirmed revocation retains paid access and sole period advances once',()=>{
 const d=seed();confirm(d,prepare(d));confirm(d,prepare(d,'revocation'));
 const late=status(d,'2026-04-02T00:00:00Z');
 a.equal(late.access,'paid');a.equal(late.period_start,end);a.equal(late.period_end,'2026-03-01T00:00:00Z');a.equal(late.renewal,'outside_scenario');
 a.equal(d.phase,0);a.throws(()=>prepare(d,'cancellation','2026-03-01T00:00:00Z'),{code:'period_outside_scenario'});
});
test('A competing confirmation invalidates every older preview',()=>{
 const d=seed(),id=prepare(d),second=prepare(d);const r=confirm(d,second);const before=structuredClone(d);
 a.throws(()=>confirm(d,id),{code:'stale_preview'});a.throws(()=>confirm(d,second),{code:'already_confirmed',message:new RegExp(r.id)});
 a.deepEqual(d,before);a.throws(()=>run(d,'read_status',{account_id:'other'}),{code:'not_found'});
});
test('Reject impossible seed history; accept all initial scenarios',()=>{
 for(const file of ['minimal','pending','free'])plugin.validateSeed(ctx(file==='free'?end:t0),require('../fixtures/'+file+'.json'));
 const d=seed();d.saved[1].saved_at='2024-12-31T23:59:59Z';a.throws(()=>plugin.validateSeed(ctx(),d),{code:'invalid_seed'});
});

test('Fresh renewed-period cancellation ends paid access exactly at the renewed boundary',()=>{
 const d=seed(),old=prepare(d),renewed='2026-03-01T00:00:00Z';
 a.throws(()=>confirm(d,old,end),{code:'stale_preview'});
 let op=run(d,'prepare_cancellation',{},end);a.equal(op.data.phase,1);
 const cancelled=run(op.data,'confirm',{preview_id:op.result.preview.id},end);a.equal(cancelled.result.receipt.effective_at,renewed);
 plugin.validateSeed(ctx(end),cancelled.data);
 a.equal(status(cancelled.data,'2026-02-28T23:59:59Z').access,'paid');
 a.equal(status(cancelled.data,renewed).access,'free');
 a.deepEqual(status(cancelled.data,renewed).saved,d.saved);
 a.throws(()=>prepare(cancelled.data,'revocation',renewed),{code:'free_account'});
});
test('Same-time repeat preview records remain distinct after abandon',()=>{
 const d=seed();
 for(let i=0;i<2;i++){const id=prepare(d);run(d,'abandon',{preview_id:id});}
 const fingerprint=({id,...r})=>JSON.stringify(r);
 a.equal(new Set(plugin.records(d).map(fingerprint)).size,plugin.records(d).length);
 a.deepEqual(d.previews.map(p=>p.status),['abandoned','abandoned']);
});
