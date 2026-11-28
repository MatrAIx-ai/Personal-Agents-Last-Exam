'use strict';
const a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const app=path.resolve(__dirname,'..'),id='home-repair-slots';
const runtime=path.resolve(process.env.PALE_RUNTIME_ROOT||path.join(app,'../../runtime'));
const {prepare}=require(path.join(runtime,'prepare.cjs')),{Client}=require(path.join(runtime,'client.cjs'));
const dir=path.join(app,'evaluation'),cov=require('../evaluation/coverage.json'),{recount,profiles}=require('../evaluation/recount.cjs');
const entries=profiles.map(x=>{const raw=fs.readFileSync(path.join(dir,x.seed),'utf8');return {...x,raw,profile:JSON.parse(raw),manifest:require(path.join(dir,x.dataset))};});
const staged=prepare(app),stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'repair-evaluation-')),clients=[];
function make(role,run){
 const c=new Client(id,role,run,stateDir,'evaluation-'+role,{registry:staged.registry,...(role==='infra'?{initialProfile:'sandbox'}:{})});clients.push(c);return c;
}
const expect=(x,status)=>{a.equal(x.status,status,JSON.stringify(x));return x;};
const snap=async c=>expect(await c.call('env.snapshot'),'ok');
async function test(){
 a.deepEqual(recount(entries),cov);a.deepEqual(cov.observed_window,['2025-01-01','2026-12-31']);a.deepEqual(cov.missing_months,[]);
 const smoke=make('infra','control-smoke');await smoke.initialize();const other=await snap(smoke);
 for(const {key,profile:p,manifest:dataset} of entries){
  const d=p.data,i=make('infra','eval-'+key),g=make('agent','eval-'+key);
  await Promise.all([i.initialize(),g.initialize()]);
  const base=await snap(i),call=(n,args={})=>g.call(id+'.'+n,args);
  a.equal(dataset.sources[0].generation.parameters.sha256,cov.sources.find(x=>x.id===key).sha256);
  const load=expect(await i.call('env.load_seed',{...p,expected_version:base.version,request_id:'eval-load',bundle:{...base.snapshot.resources.bundle,dataset}}),'ready');
  a.equal(load.quality.automated_pass,true);
  const loaded=await snap(i);a.deepEqual(loaded.snapshot.data,d);
  const list=expect(await call('list_slots'),'ok');
  a.deepEqual(list.slots.map(x=>x.id),['S1','S2']);a.deepEqual(list.booking_ids,d.bookings.map(x=>x.id));
  for(const b of d.bookings){
   const row=expect(await call('get_booking',{booking_id:b.id}),'ok');
   const bookingEvents=d.history.filter(h=>h.object_id===b.id);
   a.deepEqual(row.booking,b);a.deepEqual(row.history,bookingEvents);
   const [confirm,...next]=bookingEvents;
   a.equal(confirm.operation,'confirm_reservation');
   const pick=d.history.find(x=>x.object_id===b.origin);
   a.ok(Date.parse(confirm.at)>=Date.parse(pick.at));
   a.ok(next.every(x=>Date.parse(x.at)>=Date.parse(confirm.at)&&Date.parse(x.at)<Date.parse(row.slot.start)));
   a.equal(next.filter(x=>x.operation==='cancel_booking').length,b.status==='cancelled'?1:0);
   const move=next.find(x=>x.operation==='reschedule_booking');
   if(move){a.equal(move.slot_id,b.slot_id);a.equal(move.prior_slot_id,pick.slot_id);}
  }
  for(const x of entries.filter(x=>x.key!==key))expect(await call('get_booking',{booking_id:x.profile.data.bookings[0].id}),'not_found');
  const pick=expect(await call('select_slot',{slot_id:'S1',expected_version:list.version,request_id:'eval-preview'}),'committed');
  const ok=expect(await call('confirm_reservation',{reservation_id:pick.reservation.id,expected_version:pick.version,request_id:'eval-book'}),'committed');
  const row=expect(await call('get_booking',{booking_id:ok.booking.id}),'ok');
  a.equal(row.history.length,1);a.equal(row.history[0].operation,'confirm_reservation');a.equal(+new Date(row.history[0].at),+new Date(p.virtual_now));
  expect(await i.call('env.reset',{expected_version:ok.version}),'ready');
  const reset=await snap(i);a.deepEqual(reset.snapshot.data,d);a.deepEqual(reset.snapshot.resources.bundle.dataset,dataset);
  a.deepEqual(reset.snapshot.receipts,{});a.equal(+new Date(reset.snapshot.virtual_now),+new Date(p.virtual_now));a.ok(reset.version.epoch>ok.version.epoch);
  expect(await call('get_booking',{booking_id:ok.booking.id}),'not_found');
 }
 a.deepEqual((await snap(smoke)).snapshot.data,other.snapshot.data);
 console.log('PASS: three separately bound households, reproducible 24-month coverage, independent public Agent booking activity readbacks, cross-account not_found, live confirmation and Core reset.');
}
test().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await Promise.allSettled(clients.map(c=>c.close()));staged.cleanup();fs.rmSync(stateDir,{force:true,recursive:true});});
