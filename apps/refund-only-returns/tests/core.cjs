'use strict';
const a=require('node:assert/strict'),path=require('node:path'),r=path.resolve(process.env.PALE_RUNTIME_ROOT||path.join(__dirname,'../../../runtime'));
const {prepare}=require(r+'/prepare.cjs'),{Client}=require(r+'/client.cjs');
const app='refund-only-returns',p=prepare(path.join(__dirname,'..')),cs=[];
const make=(role,run,initialProfile)=>{const c=new Client(app,role,run,path.join(p.root,'state'),'returns-verifier',{registry:p.registry,initialProfile});cs.push(c);return c;};
const exp=(r,s='ok')=>{a.equal(r.status,s,JSON.stringify(r));return r;};
const q=id=>({refund_request_id:id}),o=id=>({order_id:id});
const call=(c,n,args={})=>c.call(app+'.'+n,args),write=(c,n,args,v,id)=>call(c,n,{...args,expected_version:v,request_id:id});
const snap=async c=>exp(await c.call('env.snapshot'));
const time='2026-01-10T10:00:01Z';
async function main(){
 const i=make('infra','approved-v1');await i.initialize();
 const low=make('infra','read-only-control');await low.initialize();
 const lb=await snap(low), policies=structuredClone(lb.snapshot.policies);policies.scenario=policies['read-only'];
 exp(await low.call('env.load_seed',{expected_version:lb.version,data:lb.snapshot.data,policies,bundle:lb.snapshot.resources.bundle,request_id:'read-only-seed',virtual_now:lb.snapshot.virtual_now}),'ready');
 const ga=make('agent','read-only-control');await ga.initialize();
 const lowOrder=exp(await call(ga,'read_order',o('order-1')));
 exp(await write(ga,'prepare_preview',o('order-1'),lowOrder.version,'permission-test'),'permission_denied');
 const g=make('agent','approved-v1'),g2=make('agent','approved-v1');await Promise.all([g.initialize(),g2.initialize()]);
 const orig=await snap(i);
 const loaded=exp(await i.call('env.load_seed',{expected_version:orig.version,data:orig.snapshot.data,bundle:orig.snapshot.resources.bundle,request_id:'baseline',virtual_now:'2026-01-10T09:00:00Z'}),'ready');
 const baseline=await snap(i);
 for(const [j,key] of ['order','request'].entries()){
  const bad=structuredClone(baseline.snapshot.data);
  if(key==='order')bad.orders[3].ordered_at='2026-01-10T09:00:01Z';
  else bad.requests[0].created_at='2026-01-10T09:00:01Z';
  exp(await i.call('env.load_seed',{expected_version:baseline.version,data:bad,virtual_now:'2026-01-10T09:00:00Z',request_id:'bad-seed-'+j}),'invalid_seed');
  const same=await snap(i);a.deepEqual(same.snapshot.data,baseline.snapshot.data);a.deepEqual(same.version,baseline.version);
 }

 a.equal(exp(await call(g,'read_order',o('order-2'))).order.eligibility,'eligible');
 exp(await call(g,'read_order',o('wrong')),'not_found');
 exp(await g.call('env.advance_time',{}),'permission_denied');
 const move=exp(await i.call('env.advance_time',{expected_version:loaded.version,request_id:'expire-first',virtual_now:time}),'committed');
 a.deepEqual((await snap(i)).snapshot.data,baseline.snapshot.data);
 exp(await write(g,'confirm_request',q('request-1'),loaded.version,'old'),'stale_version');
 a.equal(exp(await call(g2,'read_order',o('order-2'))).order.eligibility,'expired');
 exp(await write(g,'confirm_request',q('request-1'),move.version,'new'),'return_expired');
 a.deepEqual((await snap(i)).snapshot.data,baseline.snapshot.data);
 exp(await write(g,'cancel_request',q('request-4'),move.version,'dispatched'),'already_dispatched');
 for(let j=0;j<2;j++){
  const reset=exp(await i.call('env.reset',{expected_version:(await snap(i)).version}),'ready');
  const restored=await snap(i);a.deepEqual(restored.snapshot.data,baseline.snapshot.data);a.deepEqual(restored.snapshot.receipts,{});a.equal(restored.snapshot.virtual_now,baseline.snapshot.virtual_now);
  const args={...q('request-1'),expected_version:reset.version,request_id:'confirm-before-cutoff'};
  const yes=exp(await call(g,'confirm_request',args),'committed');a.equal(yes.request.status,'confirmed');
  const m=exp(await i.call('env.advance_time',{expected_version:yes.version,request_id:'expire-after-confirm',virtual_now:time}),'committed');
  const view=exp(await call(g2,'read_request',q('request-1')));
  a.equal(view.request.status,'confirmed');a.equal(view.order.deadline_passed,true);
  const old=await snap(i);
  a.deepEqual(await call(g2,'confirm_request',args),{...yes,duplicate:true});
  a.deepEqual((await snap(i)).version,old.version);a.deepEqual((await snap(i)).snapshot.data,old.snapshot.data);
  exp(await call(g2,'confirm_request',{...args,...q('request-4')}),'idempotency_conflict');
  const cancel=exp(await write(g,'cancel_request',q('request-1'),m.version,'cancel-after-expiry'),'committed');
  a.equal(cancel.request.status,'cancelled');
  exp(await write(g,'prepare_preview',o('order-2'),cancel.version,'expired-reopen'),'return_expired');
  const prev=exp(await write(g,'prepare_preview',o('order-1'),cancel.version,'new-preview'),'committed');
  const drop=exp(await write(g,'discard_preview',q(prev.request.id),prev.version,'discard'),'committed');
  a.equal(drop.request.status,'discarded');
  a.equal(exp(await call(g2,'read_order',o('order-1'))).requests.filter(x=>x.status==='confirmed').length,0);
 }
 // Identical virtual time, distinct attempt records. Core must retain duplicate_records: reject.
 const rs=make('infra','repeat-attempts'),ra=make('agent','repeat-attempts');await Promise.all([rs.initialize(),ra.initialize()]);
 const first=await snap(rs);let v=first.version;
 for(let k=0;k<4;k++){
  let live=exp(await write(ra,'prepare_preview',o('#10421'),v,'repeat-prepare-'+k),'committed');
  a.equal(live.request.attempt,k+2);
  if(k<2)live=exp(await write(ra,'confirm_request',q(live.request.id),live.version,'repeat-confirm-'+k),'committed');
  live=exp(await write(ra,k<2?'cancel_request':'discard_preview',q(live.request.id),live.version,'repeat-end-'+k),'committed');
  a.equal(live.request.status,k<2?'cancelled':'discarded');v=live.version;
 }
 const repeated=await snap(rs);
 a.equal(repeated.snapshot.virtual_now,first.snapshot.virtual_now);
 a.deepEqual(repeated.snapshot.data.requests.filter(r=>r.order_id==='order-1').map(r=>r.attempt),[1,2,3,4,5]);
 const {profileAt,fullClock}=require('../evaluation/recount.cjs');
 const timeline=require('../evaluation/timeline.json'),coverage=require('../evaluation/coverage.json');
 a.equal(coverage.missing_months.length,0);a.ok(Object.values(coverage.monthly).some(m=>m.orders===0));
 a.ok(Math.max(...Object.values(coverage.monthly).map(m=>m.orders))>=4);
 const e=timeline.episodes.find(e=>e.outcome==='dispatched');
 const profiles=[['full-window',fullClock],['task-start','2026-11-20T09:00:00Z'],
  ['useful-sept','2026-09-07T09:00:00Z'],['useful-dec','2026-12-11T09:00:00Z'],['during-pending',e.submitted_at],['after-resolution',e.resolved_at],['empty-start','2025-01-01T00:00:00Z']];
 for(const [run,cut] of profiles){
  const ev=make('infra',run),ea=make('agent',run);await Promise.all([ev.initialize(),ea.initialize()]);
  const pre=await snap(ev),{data,dataset,virtual_now}=profileAt(cut,timeline);
  const full=exp(await ev.call('env.load_seed',{expected_version:pre.version,request_id:run,data,virtual_now,bundle:{...pre.snapshot.resources.bundle,dataset}}),'ready');
  a.equal(full.quality.automated_pass,true);
  const current=await snap(ev);a.deepEqual(current.snapshot.data,data);
  a.equal(Date.parse(current.snapshot.virtual_now),Date.parse(cut));
  a.equal(dataset.expected_counts.records,data.orders.length+data.requests.length);
  const sample=data.orders[0];
  if(sample){
   const prefix='#'+sample.order_number;
   a.deepEqual(exp(await call(ea,'lookup_order',o(prefix))).order,exp(await call(ea,'read_order',o(prefix))).order);
  }else{
   a.equal(run,'empty-start');exp(await call(ea,'read_order',o('#20001')),'not_found');
  }
  if(run==='full-window'){
   a.deepEqual(data,require('../evaluation/seed.json'));a.deepEqual(dataset,require('../evaluation/dataset.json'));
   a.equal(data.orders[0].ordered_at.slice(0,10),'2025-01-01');a.equal(data.orders.at(-1).ordered_at.slice(0,10),'2026-12-31');
   a.deepEqual([...new Set(data.requests.map(q=>q.status))].sort(),['cancelled','dispatched']);
   a.ok(data.orders.every(x=>Date.parse(x.return_deadline)-Date.parse(x.ordered_at)===30*86400000));
   const repeat=data.requests.filter(q=>q.attempt===2);a.equal(repeat.length,3);
   for(const row of repeat){
    const previous=data.requests.find(q=>q.order_id===row.order_id&&q.attempt===1);
    a.equal(previous.status,'cancelled');a.ok(Date.parse(previous.submitted_at)<Date.parse(row.submitted_at));
   }
   for(const qv of data.requests){
    a.equal(exp(await call(ea,'read_request',q(qv.id))).request.submitted_at,qv.submitted_at);
   }
  }
  if(run==='task-start'){
   const someday=timeline.orders.find(x=>Date.parse(x.ordered_at)>Date.parse(cut));
   exp(await call(ea,'read_order',o('#'+someday.order_number)),'not_found');
   a.ok(data.requests.every(x=>Date.parse(x.submitted_at)<=Date.parse(cut)));
   a.equal(exp(await call(ea,'read_order',o('#20048'))).order.eligibility,'eligible');
  }
  if(run==='useful-sept'||run==='useful-dec'){
   const [orderNumber,requestId]=run==='useful-sept'?['#20041','history-request-43']:['#20052','history-request-53'];
   a.equal(exp(await call(ea,'read_order',o(orderNumber))).order.eligibility,'eligible');
   a.equal(exp(await call(ea,'read_request',q(requestId))).request.status,'confirmed');
  }
  if(run==='during-pending'||run==='after-resolution')a.equal(exp(await call(ea,'read_request',q(e.id))).request.status,run==='during-pending'?'confirmed':'dispatched');
  exp(await ev.call('env.reset',{expected_version:current.version}),'ready');
  a.deepEqual((await snap(ev)).snapshot.data,data);
 }
 console.log('PASS: independent Infra/Agent MCP same-clock repeat cancellations and discards; full-window and early Task profile load, cutoff-aware request status, public #number lookup, and reset.');
 console.log('PASS: real Core MCP state, roles, time/optimistic-version boundary, replay/conflict, cancellation and two full resets/replays.');
}
main().catch(e=>{console.error(e,cs.map(c=>c.errors));process.exitCode=1;}).finally(async()=>{await Promise.allSettled(cs.map(c=>c.close()));p.cleanup();});
