'use strict';
// Actual public Agent/Infra MCP processes; this is separate from App-only tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),appDir=path.resolve(__dirname,'..');
const runtimeRoot=process.env.PALE_RUNTIME_ROOT||path.join(root,'runtime');
const {prepare}=require(path.join(runtimeRoot,'prepare.cjs')),{Client}=require(path.join(runtimeRoot,'client.cjs'));
const {digestTree}=require(path.join(runtimeRoot,'verify.cjs'));
const clone=x=>structuredClone(x);
const initial='2026-12-01T18:00:00Z';
const arrival={stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_at:'2026-12-02T00:20:00Z'};
// These payloads are fixed before any Agent action, including both reset passes.
const source={event_id:'source-delay',at:initial,operation:'stayready.source_updated',payload:{source_id:'source-arrival',expected_source_version:1,source_version:2,arrival_at:arrival.arrival_at}};
const hotel={event_id:'hotel-arrival-confirmation',at:'2026-12-01T18:05:00Z',operation:'stayready.hotel_reply',payload:{target:{need_id:'need-arrival',action:'arrange',submitted_in:{from:initial,until:'2026-12-01T18:05:00Z'},request_conditions:arrival},outcome:'confirmed',terms:{stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_window:{start:'2026-12-02T00:00:00Z',end:'2026-12-02T01:00:00Z'},entrance_id:'east',access_method_id:'night-desk'}}};
const unavailable={event_id:'access-unavailable',at:'2026-12-01T18:10:00Z',operation:'stayready.service_unavailable',payload:{target:{need_id:'need-access-person-1',confirmed_in:{from:'2026-11-30T00:00:00Z',until:'2026-12-01T00:00:00Z'},commitment_terms:{stay_id:'stay-1',service:'step_free_access',person_ids:['person-1'],route_id:'east-step-free',window:{start:'2026-12-01T15:00:00Z',end:'2026-12-03T11:00:00Z'}}},effective_at:'2026-12-01T22:00:00Z',reason:'East route temporarily closed'}};
async function main(){
 const output=path.resolve(process.env.STAYREADY_REPORT_DIR||path.join(root,'.artifacts/stayready'));
 fs.mkdirSync(output,{recursive:true});const prepared=prepare(appDir),clients=[],trace=[],checks=[];
 const report={schema:'stayready.mcp-evidence.v1',node:process.version,runtime:require(path.join(runtimeRoot,'package.json')).version,package_sha256:digestTree(appDir),events_sha256:crypto.createHash('sha256').update(JSON.stringify([source,hotel,unavailable])).digest('hex'),checks,passed:false};
 const check=(name,condition=true)=>{assert.ok(condition,name);checks.push({name,status:'passed'});};
 async function client(role,run='mcp-stayready',profile){const c=new Client('stayready',role,run,path.join(prepared.root,'state'),'stayready-evidence',{registry:prepared.registry,...(profile?{initialProfile:profile}:{})});clients.push(c);await c.initialize();return c;}
 async function call(c,name,args={}){const result=await c.call(name,args);trace.push({name,args:clone(args),result:clone(result)});return result;}
 try{
  const infra=await client('infra','mcp-stayready','sandbox'),agent=await client('agent');
  const snap=()=>call(infra,'env.snapshot'),inspect=()=>call(agent,'stayready.inspect');
  const write=async(name,args,id)=>{const s=await snap();return call(agent,name,{...args,expected_version:s.version,request_id:id});};
  const inject=async event=>{const s=await snap();return call(infra,'env.apply_event',{expected_version:s.version,event:clone(event)});};
  const baseline=clone(require('../fixtures/minimal.json'));
  const initialSnap=await snap();check('load_seed establishes the explicit reset/time baseline',(await call(infra,'env.load_seed',{expected_version:initialSnap.version,request_id:'load-baseline',data:baseline,virtual_now:initial})).status==='ready');
  check('Agent discovery excludes management',(await agent.request('tools/list')).result.tools.every(t=>!t.name.startsWith('env.')));
  for(const name of ['env.load_seed','env.reset','env.snapshot','env.apply_event','env.advance_time'])check('Agent denied '+name,(await call(agent,name,{})).status==='permission_denied');
  let originalEpoch;
  async function runPass(pass){
   const s0=await snap();if(pass===1)originalEpoch=s0.version.epoch;
   check('pass '+pass+' source update commits',(await inject(source)).status==='committed');
   check('pass '+pass+' need save commits',(await write('stayready.need.save',{need_id:'need-arrival',conditions:arrival,source_ids:['source-arrival']},'save-arrival')).status==='committed');
   const p=await call(agent,'stayready.request.preview',{need_id:'need-arrival',action:'arrange'});check('pass '+pass+' preview succeeds',p.status==='ok');
   const before=await snap(),args={need_id:'need-arrival',action:'arrange',preview_token:p.preview.preview_token,expected_version:before.version,request_id:'submit-arrival'};
   const submitted=await call(agent,'stayready.request.submit',args);check('pass '+pass+' submit commits',submitted.status==='committed');
   check('pass '+pass+' submit alone creates no arrival promise',(await inspect()).view.commitments.every(c=>c.terms.service!=='late_arrival'));
   const retry=await call(agent,'stayready.request.submit',args);check('pass '+pass+' lost-response exact retry deduplicates',retry.duplicate===true&&retry.hotel_request_id===submitted.hotel_request_id);
   check('pass '+pass+' retry has one request',(await inspect()).view.requests.length===1);
   const different={...args,preview_token:'0'.repeat(64)};check('pass '+pass+' conflicting successful ID rejected',(await call(agent,'stayready.request.submit',different)).status==='idempotency_conflict');
   const eventArgs={expected_version:(await snap()).version,event:clone(hotel)};
   const accepted=await call(infra,'env.apply_event',eventArgs);check('pass '+pass+' original prewritten reply commits',accepted.status==='committed');
   check('pass '+pass+' event retry returns original receipt',(await call(infra,'env.apply_event',eventArgs)).duplicate===true);
   const view=(await inspect()).view,c=view.commitments.find(c=>c.terms.service==='late_arrival');
   check('pass '+pass+' hotel promise has applicable overnight terms',c&&c.terms.arrival_window.start==='2026-12-02T00:00:00Z'&&c.terms.entrance_id==='east');
   check('pass '+pass+' unrelated access commitment retained',view.commitments.find(c=>c.id==='commitment-baseline-access').effective_status==='active');
   check('pass '+pass+' private source background absent from Agent view',!JSON.stringify(view).includes('Private journey details'));
   check('pass '+pass+' future unavailability notice commits',(await inject(unavailable)).status==='committed');
   check('pass '+pass+' future notice does not disable access early',(await inspect()).view.commitments.find(c=>c.id==='commitment-baseline-access').effective_status==='active');
   const beforeClock=await snap();const advanced=await call(infra,'env.advance_time',{expected_version:beforeClock.version,request_id:'advance-night',virtual_now:'2026-12-01T22:00:00Z'});
   check('pass '+pass+' clock advance succeeds',advanced.status==='committed');
   const afterClock=await snap();assert.deepEqual(afterClock.snapshot.data,beforeClock.snapshot.data);check('pass '+pass+' advance_time performs no business write');
   check('pass '+pass+' access read changes at effective time',(await inspect()).view.commitments.find(c=>c.id==='commitment-baseline-access').effective_status==='unavailable');
   const afterRead=await snap();assert.deepEqual(afterRead.snapshot.data,afterClock.snapshot.data);check('pass '+pass+' usability read is mutation-free');
   return afterRead.snapshot.data;
  }
  const first=await runPass(1),beforeBadSeed=await snap();
  const forged=clone(first);forged.commitments.find(c=>c.request_id).terms.arrival_window.end='2026-12-02T02:00:00Z';
  check('historical promise inconsistent with its actual reply is rejected',(await call(infra,'env.load_seed',{expected_version:beforeBadSeed.version,data:forged,virtual_now:beforeBadSeed.snapshot.virtual_now})).status==='invalid_seed');
  const rejectedSeed=await snap();assert.deepEqual(rejectedSeed.snapshot.data,beforeBadSeed.snapshot.data);assert.deepEqual(rejectedSeed.snapshot.initial_data,beforeBadSeed.snapshot.initial_data);assert.deepEqual(rejectedSeed.version,beforeBadSeed.version);check('rejected seed preserves current state, reset baseline and version');
  const beforeReset=await snap();
  check('reset succeeds',(await call(infra,'env.reset',{expected_version:beforeReset.version})).status==='ready');
  const reset=await snap();assert.deepEqual(reset.snapshot.data,baseline);check('reset returns loaded business baseline');
  check('reset advances epoch',reset.version.epoch>originalEpoch);check('reset clears old event receipts',(await call(infra,'env.event_status',{event_id:hotel.event_id})).receipt===null);
  const second=await runPass(2);assert.deepEqual(second,first);check('fresh epoch replay reproduces complete business state with unchanged hotel payloads');
  report.canonical_business_sha256=crypto.createHash('sha256').update(JSON.stringify(second)).digest('hex');
  const peer=await client('infra','isolated-peer','sandbox');check('independent run has no leaked requests',(await call(peer,'env.snapshot')).snapshot.data.requests.length===0);
  const invalidEvent=clone(hotel);invalidEvent.event_id='invalid-future-target';invalidEvent.at='2026-12-01T22:05:00Z';invalidEvent.payload.target.need_id='unknown-need';
  const beforeInvalid=await snap();check('invalid event rejects',(await inject(invalidEvent)).status==='invalid_event');
  const afterInvalid=await snap();assert.deepEqual(afterInvalid.snapshot.data,beforeInvalid.snapshot.data);assert.equal(afterInvalid.snapshot.virtual_now,beforeInvalid.snapshot.virtual_now);check('rejected event rolls back business data and clock');
  const deniedInfra=await client('infra','denied','scenario'),deniedAgent=await client('agent','denied');
  const deniedSnap=await call(deniedInfra,'env.snapshot'),policies=clone(deniedSnap.snapshot.policies);policies.scenario.allow=['stayready.inspect'];policies.scenario.constraints={};
  check('restricted policy loads',(await call(deniedInfra,'env.load_seed',{expected_version:deniedSnap.version,data:baseline,policies,virtual_now:initial})).status==='ready');
  check('denied write has no effect',(await call(deniedAgent,'stayready.need.save',{need_id:'need-arrival',conditions:arrival,source_ids:['source-arrival'],expected_version:(await call(deniedInfra,'env.snapshot')).version,request_id:'denied-write'})).status==='permission_denied');
  assert.deepEqual((await call(deniedInfra,'env.snapshot')).snapshot.data,baseline);check('denied policy preserves business state');
  const raceInfra=await client('infra','race','sandbox'),raceA=await client('agent','race'),raceB=await client('agent','race');
  const raceVersion=(await call(raceInfra,'env.snapshot')).version;
  const edits=['person-1','person-2'].map((person,index)=>{const n=baseline.needs.find(n=>n.id==='need-breakfast-'+person);return {need_id:n.id,conditions:n.conditions,source_ids:n.source_ids,expected_version:raceVersion,request_id:'concurrent-'+index};});
  const raceResults=await Promise.all([call(raceA,'stayready.need.save',edits[0]),call(raceB,'stayready.need.save',edits[1])]);
  check('same-version concurrent writers have exactly one commit and one stale rejection',raceResults.filter(r=>r.status==='committed').length===1&&raceResults.filter(r=>r.status==='stale_version').length===1);
  const losing=raceResults.findIndex(r=>r.status==='stale_version'),retryEdit={...edits[losing],expected_version:(await call(raceInfra,'env.snapshot')).version};
  check('rejected write has no successful receipt and may retry its key with refreshed version',(await call(losing===0?raceA:raceB,'stayready.need.save',retryEdit)).status==='committed');
  const racePreview=await call(raceA,'stayready.request.preview',{need_id:'need-arrival',action:'arrange'});
  const raceSubmitted=await call(raceA,'stayready.request.submit',{need_id:'need-arrival',action:'arrange',preview_token:racePreview.preview.preview_token,expected_version:(await call(raceInfra,'env.snapshot')).version,request_id:'race-arrival'});
  check('race request is pending before either competing action',raceSubmitted.status==='committed');
  const raceEvent={event_id:'race-fixed-reply',at:'2026-12-01T18:05:00Z',operation:'stayready.hotel_reply',payload:{target:{need_id:'need-arrival',action:'arrange',request_conditions:{stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_at:'2026-12-01T21:30:00Z'},submitted_in:{from:initial,until:'2026-12-01T18:05:00Z'}},outcome:'confirmed',terms:{stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_window:{start:'2026-12-01T21:00:00Z',end:'2026-12-01T22:00:00Z'},entrance_id:'east',access_method_id:'night-desk'}}};
  const competingVersion=(await call(raceInfra,'env.snapshot')).version;
  const competing=await Promise.all([call(raceInfra,'env.apply_event',{expected_version:competingVersion,event:raceEvent}),call(raceA,'stayready.request.withdraw',{expected_version:competingVersion,request_id:'race-withdraw',hotel_request_id:raceSubmitted.hotel_request_id})]);
  check('concurrent hotel reply and withdrawal are serialized with visible conflict',competing.filter(r=>r.status==='committed').length===1&&competing.filter(r=>r.status==='stale_version').length===1);
  if(competing[0].status==='stale_version'){
   check('fixed reply after committed withdrawal is history-only',(await call(raceInfra,'env.apply_event',{expected_version:(await call(raceInfra,'env.snapshot')).version,event:raceEvent})).status==='committed');
   const v=(await call(raceA,'stayready.inspect')).view;check('withdrawal-first race cannot create an arrival promise',v.requests[0].status==='withdrawn'&&v.commitments.every(c=>c.terms.service!=='late_arrival'));
  }else{
   check('withdrawal after committed confirmation is invalid',(await call(raceA,'stayready.request.withdraw',{expected_version:(await call(raceInfra,'env.snapshot')).version,request_id:'race-withdraw',hotel_request_id:raceSubmitted.hotel_request_id})).status==='invalid_state');
   const v=(await call(raceA,'stayready.inspect')).view;check('confirmation-first race retains exactly one hotel promise',v.requests[0].status==='confirmed'&&v.commitments.filter(c=>c.terms.service==='late_arrival').length===1);
  }
  report.concurrent_winner={edit:raceResults.findIndex(r=>r.status==='committed'),reply_or_withdrawal:competing[0].status==='committed'?'hotel_reply':'withdrawal'};
  report.passed=true;
 }catch(e){report.error=e.stack||e.message;process.exitCode=1;}finally{await Promise.allSettled(clients.map(c=>c.close()));prepared.cleanup();fs.writeFileSync(path.join(output,'mcp-flow.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(output,'mcp-trace.json'),JSON.stringify(trace,null,2)+'\n');}
 console.log(JSON.stringify({passed:report.passed,checks:checks.length,error:report.error,report:path.join(output,'mcp-flow.json')},null,2));
}
if(require.main===module)main();
module.exports={main,events:{source,hotel,unavailable}};
