'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const runtime=path.resolve(process.env.PALE_RUNTIME_ROOT||path.join(__dirname,'../../../runtime'));
const {prepare}=require(path.join(runtime,'prepare.cjs')),{Client}=require(path.join(runtime,'client.cjs'));
const app='civic311',dir=path.resolve(__dirname,'..');
const early='2026-11-21T13:58:00Z',observed='2026-11-21T14:00:00Z',closure=require('../examples/scenario.json');
const agency={event_id:'smoke-agency-1',at:'2026-11-21T14:01:00Z',operation:'civic311.case_agency_changed',payload:{case_id:'C17',previous_agency:'DOT',new_agency:'DEP'}};
const accept=(r,s='ok')=>{assert.equal(r.status,s,JSON.stringify(r));return r};
const business=(client,n,q={})=>client.call('civic311.'+n,q);
const stable=r=>[r.version,r.snapshot.virtual_now,r.snapshot.data,r.snapshot.resources,r.snapshot.receipts];
function session(){
 const staged=prepare(dir),state=fs.mkdtempSync(path.join(os.tmpdir(),'civic311-')),clients=[];
 async function make(role,run='civic-test',profile='sandbox'){
  const c=new Client(app,role,run,state,'civic-test',{registry:staged.registry,...(role==='infra'?{initialProfile:profile}:{})});
  clients.push(c);await c.initialize();return c;
 }
 async function close(){await Promise.allSettled(clients.map(c=>c.close()));staged.cleanup();fs.rmSync(state,{recursive:true,force:true})}
 return {staged,state,make,close};
}
const snap=async c=>accept(await c.call('env.snapshot'));
const apply=async(c,event)=>c.call('env.apply_event',{event,expected_version:(await snap(c)).version});
const advance=async(c,virtual_now,request_id)=>accept(await c.call('env.advance_time',{virtual_now,request_id,expected_version:(await snap(c)).version}),'committed');
async function load(c,virtual_now,data,bundle){
 const s=await snap(c);
 return accept(await c.call('env.load_seed',{data:data??s.snapshot.data,bundle:bundle??s.snapshot.resources.bundle,virtual_now,request_id:'load-seed',expected_version:s.version}),'ready');
}
module.exports={runtime,early,observed,closure,agency,accept,business,stable,session,snap,apply,advance,load};
