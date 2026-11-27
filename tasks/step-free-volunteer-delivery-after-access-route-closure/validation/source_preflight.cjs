'use strict';
// Source-layer preflight only. No Core transport, task-local runner or rubric.
// Reproduce against Hopline #171 at 1d7fecfb8b12bc4c85b02f776cae651b9f1b6dab.
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const pins={common:'711f38893ec06dcc805b9493e3fb05615a0a5ae8',planner:'43ef9a8790aa737348311e8f7f4d10d74874e672',catalog:'a1fe463f36126d18f9944b0bb9402c57cdb821a8',time:'fc67b5990a86c505df73cf7ba7b5d3e110751c9a',network:'be3fc5fdce4a89da4e8541871ac7bef7306c2388',diagnostics:'67d20e449404aecfac5adf0f100aafbf373c9a5d','domain-utils':'931f916aa09cdaeec1112a4adcd448bd14ef8556',subs:'e4810abecdc6e66114a64ebff1708c3947fb5d3c',derive:'5f7e37799ae316afa61d0180f8f680e18084044d',events:'2a8413dd09c8d1399b7ce3e952d336e5418d0d5f',cards:'ea43e6b9adca25012b7aa061b65599104f66c884',notify:'80e7f02401167155a0dc07aa826928b9f9de908d',model:'0d56ab41095e56e06465c217cd014e12fea45321'};
function pinned(file,sha){
  const bytes=fs.readFileSync(file);
  assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),sha,'source changed: '+file);
  return bytes;
}
function check(ok,msg){assert.ok(ok,msg)}
function run(modules,data,binding){
  const {model,planner,events,cards}=modules;
  const T=x=>'2026-11-21T'+x+':00+08:00';
  const ctx={virtual_now:T('08:00'),binding,app_id:'hopline'};
  const result=[];
  model.validateSeed(ctx,data);
  const route=(label,from,to,depart,step_free,expected,dist)=>{
    const original=JSON.stringify(data);
    const it=planner.plan(data,{from,to,depart_at:depart,step_free,max_walk_m:2500},ctx.virtual_now,it=>cards.quote(data,undefined,it.legs.filter(l=>l.kind==='ride'))).itineraries[0];
    check(original===JSON.stringify(data),'read mutated seed');
    let pos=from,tm=Date.parse(it.depart),walk=0;
    for(const e of it.edges){
      check(e.from===pos&&Date.parse(e.enter_at)===tm,'discontinuity');
      pos=e.to;tm=Date.parse(e.exit_at);walk+=e.length_m;
      check(!step_free||e.step_free===true,'inaccessible edge');
    }
    check(pos===to&&tm===Date.parse(it.arrive)&&walk===it.walk_m&&walk===dist&&tm-Date.parse(depart)===expected*1000,'incorrect totals');
    check(!it.uses_estimates.length,'estimate');
    check(it.fare.total_cents===0&&it.fare.rides.length===0,'unexpected fare');
    result.push({label,as_of:ctx.virtual_now,from,to,itinerary:it});return it;
  };
  const J='pl-jules',B='pl-recipient-b',C='pl-recipient-c',R='pl-rowan';
  const before=route('before',J,B,T('14:30'),true,330,310);
  const next=route('next',B,C,before.arrive,true,840,780);
  check(before.edges.some(e=>e.pathway_id==='pw-cc-lift'),'missing initial lift');
  check(Date.parse(next.arrive)<=Date.parse(T('14:52')),'initial promise infeasible');
  const initial=JSON.parse(JSON.stringify(data));
  ctx.virtual_now=T('09:00');
  events.applyEvent(ctx,data,{event_id:'ev-lift-closure',at:T('09:00'),operation:'facility.status_changed',payload:{facility_id:'fac-cc-lift',status:'out_of_service',since:T('09:00'),expected_return:'2026-11-23T09:00:00+08:00',note:'Closed until Monday'}});
  ctx.virtual_now=T('09:10');model.validateSeed(ctx,data);
  const after=route('after',J,B,T('14:30'),true,870,1020);
  const late=route('impossible',J,C,T('14:30'),true,1470,1500);
  const backup=route('backup',R,C,T('14:20'),true,240,300);
  const cf=route('counterfactual',J,C,T('14:30'),false,1140,1100);
  check(after.edges.some(e=>e.pathway_id==='pw-rr-ramp')&&Date.parse(after.arrive)<=Date.parse(T('17:00')),'wrong replacement');
  check(Date.parse(late.arrive)>Date.parse(T('14:52')),'Jules unexpectedly on time');
  check(Date.parse(backup.arrive)<=Date.parse(T('14:52')),'backup late');
  check(cf.edges.some(e=>e.pathway_id==='pw-ep-stairs')&&Date.parse(cf.arrive)<=Date.parse(T('14:52')),'wrong counterfactual');
  const closed=data.facilities.find(f=>f.facility_id==='fac-cc-lift').history.at(-1);
  check(closed.seq===1&&closed.status==='out_of_service'&&closed.recorded_at===T('09:00'),'wrong closure evidence');
  return {scope:'source-layer-preflight-not-runtime-receipts',initial,after_closure:data,routes:result};
}
if(require.main===module){
  const app=process.argv[2];
  if(!app)throw Error('Usage: node source_preflight.cjs <pinned apps/hopline directory>');
  const src=path.resolve(app,'src'), fixture=path.join(__dirname,'../environment/workspace/hopline');
  for(const [name,sha] of Object.entries(pins))pinned(path.join(src,name+'.cjs'),sha);
  const data=JSON.parse(pinned(path.join(fixture,'seed.json'),'57651d4ff6860b22394b9c1e92fbeaa3510e820a'));
  const binding=JSON.parse(pinned(path.join(fixture,'binding.json'),'a6eab6bbe052221c59c5954b96a4afd9e893bd35'));
  const modules=Object.fromEntries(['model','planner','events','cards'].map(n=>[n,require(path.join(src,n+'.cjs'))]));
  console.log(JSON.stringify(run(modules,data,binding),null,2));
}
module.exports={run,pins};
