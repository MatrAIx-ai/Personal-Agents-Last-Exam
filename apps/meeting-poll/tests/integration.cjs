'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const runtime=require('./runtime-path.cjs'),{Client}=require(path.join(runtime,'client.cjs')),{prepare}=require(path.join(runtime,'prepare.cjs')),{digestTree}=require(path.join(runtime,'verify.cjs'));
const app=path.resolve(__dirname,'..'),out=path.resolve(process.env.PALE_REPORT_DIR||'.artifacts/meeting-poll');
(async()=>{
 const prepared=prepare(app),stateDir=path.join(prepared.root,'state'),clients=[];
 const report={kind:'meeting-poll-integration',app_sha256:digestTree(app),runtime:require(path.join(runtime,'package.json')).version,node:process.version,icu:process.versions.icu,tz:process.versions.tz,checks:[],passed:false};
 const check=(name,value)=>{assert.ok(value,name);report.checks.push({name,status:'passed'});};
 async function client(role,run='integration'){const c=new Client('meeting-poll',role,run,stateDir,'meeting-poll-check',{registry:prepared.registry,...(role==='infra'?{initialProfile:'sandbox'}:{})});clients.push(c);await c.initialize();return c;}
 try{
  const infra=await client('infra'),agent=await client('agent'),peer=await client('agent');
  const snap=()=>infra.call('env.snapshot');let seq=0;
  const write=async(name,args={})=>agent.call('meeting-poll.'+name,{...args,expected_version:(await snap()).version,request_id:'i-'+(++seq)});
  const initial=await snap();check('All 13 business tools are discoverable in sandbox',(await agent.request('tools/list')).result.tools.length===13);
  check('No Agent reset', (await agent.call('env.reset',{expected_version:initial.version})).status==='permission_denied');
  check('Forged actor rejected',(await agent.call('meeting-poll.respond',{id:'poll-team',actor_id:'person-alex',votes:[],expected_version:initial.version,request_id:'forged'})).status==='invalid_arguments');
  const votes=[{slot_id:'slot-1',value:'yes'},{slot_id:'slot-2',value:'no'}];
  const request={id:'poll-team',votes,expected_version:initial.version,request_id:'reply-once'};
  const a=await agent.call('meeting-poll.respond',request);check('Real MCP response commits',a.status==='committed');
  const after=await snap(),retry=await agent.call('meeting-poll.respond',request);check('Retry returns original receipt and no duplicate notification',retry.duplicate&&JSON.stringify((await snap()).snapshot.data)===JSON.stringify(after.snapshot.data));
  check('Same key with changed content rejects',(await agent.call('meeting-poll.respond',{...request,votes:[...votes].reverse()})).status==='idempotency_conflict');
  check('Stale confirmation cannot overwrite intervening reply',(await agent.call('meeting-poll.finalize',{id:'poll-team',slot_id:'slot-1',expected_version:initial.version,request_id:'stale'})).status==='stale_version');
  const version=after.version,results=await Promise.all([agent.call('meeting-poll.edit',{id:'poll-team',patch:{title:'Concurrent A'},expected_version:version,request_id:'concurrent-a'}),peer.call('meeting-poll.edit',{id:'poll-team',patch:{title:'Concurrent B'},expected_version:version,request_id:'concurrent-b'})]);
  check('Exactly one concurrent edit wins',results.filter(x=>x.status==='committed').length===1&&results.filter(x=>x.status==='stale_version').length===1);
  check('Participant cannot confirm another organizer poll',(await write('finalize',{id:'poll-review',slot_id:'slot-1'})).status==='permission_denied');
  const beforeBad=await snap();check('Invalid transition rejected',(await write('reopen',{id:'poll-team',deadline:'2026-11-21T17:00:00Z',reason:'wrong state'})).status==='invalid_state');check('Failed transaction leaves business state intact',JSON.stringify((await snap()).snapshot.data)===JSON.stringify(beforeBad.snapshot.data));
  const event=require('../examples/scenario.json');let eventArgs={expected_version:(await snap()).version,event};const eventResult=await infra.call('env.apply_event',eventArgs);check('Other participant acts via Infra only',eventResult.status==='committed');
  check('Event retry deduplicates',(await infra.call('env.apply_event',eventArgs)).duplicate===true);check('Event receipt query matches',(await infra.call('env.event_status',{event_id:event.event_id})).receipt.status==='committed');
  const response=await agent.call('meeting-poll.get',{id:'poll-team'});check('Organizer sees latest event reply',response.item.responses.filter(r=>r.person_id==='person-alex').at(-1).votes[0].value==='yes');
  check('Finalization commits',(await write('finalize',{id:'poll-team',slot_id:'slot-1'})).status==='committed');
  check('Reopen commits',(await write('reopen',{id:'poll-team',deadline:'2026-11-21T17:00:00Z',reason:'Changed agenda'})).status==='committed');
  check('Previous meeting is invalidated',(await snap()).snapshot.data.polls[0].meetings[0].status==='superseded');
  check('Cancellation commits',(await write('cancel',{id:'poll-team',reason:'Postponed'})).status==='committed');
  const count=(await snap()).snapshot.data.notifications.length;await write('cancel',{id:'poll-team',reason:'Postponed'});check('Second cancellation produces no additional notice',(await snap()).snapshot.data.notifications.length===count);
  // Separate run and process persist/isolate independently.
  const other=await client('infra','other');check('Run isolation preserves untouched baseline',JSON.stringify((await other.call('env.snapshot')).snapshot.data)===JSON.stringify(initial.snapshot.data));
  await peer.close();const restarted=await client('agent');check('Restart sees persistent cancellation',(await restarted.call('meeting-poll.get',{id:'poll-team'})).item.status==='cancelled');
  await infra.call('env.reset',{expected_version:(await snap()).version});const reset=await snap();check('Reset restores all business data',JSON.stringify(reset.snapshot.data)===JSON.stringify(initial.snapshot.data));check('Old epoch rejected',(await agent.call('meeting-poll.respond',{...request,request_id:'old-epoch'})).status==='stale_version');
  const clock=await infra.call('env.advance_time',{expected_version:reset.version,request_id:'deadline',virtual_now:'2026-11-20T17:00:00Z'});check('Clock advances without business mutation',clock.status==='committed'&&JSON.stringify((await snap()).snapshot.data)===JSON.stringify(initial.snapshot.data));
  check('Deadline prevents late response even without close event',(await write('respond',{id:'poll-team',votes})).status==='poll_closed');
  const backwards=await infra.call('env.advance_time',{expected_version:(await snap()).version,request_id:'backwards',virtual_now:'2026-11-18T17:00:00Z'});check('Clock never moves backwards',backwards.status==='invalid_time');
  const close={event_id:'deadline-close',at:'2026-11-20T17:00:00Z',operation:'meeting-poll.close_due',payload:{}};check('Explicit close event persists closure',(await infra.call('env.apply_event',{expected_version:(await snap()).version,event:close})).status==='committed');
  // Historical replacement and replay with trusted accounts/policies, not an invented env.restore.
  await infra.call('env.reset',{expected_version:(await snap()).version});const replay=await infra.call('env.apply_event',{expected_version:(await snap()).version,event});check('Reset and replay reconstruct same response',replay.status==='committed'&&(await snap()).snapshot.data.polls[0].responses.at(-1).votes[0].value==='yes');
  const d=structuredClone(initial.snapshot.data);d.owner_person_id='person-alex';d.account_id='poll-alex';const binding=structuredClone(initial.snapshot.binding);binding.accounts[0].account_id='poll-alex';binding.accounts[0].owner_person_id='person-alex';
  check('Infra may load a different trusted account',(await infra.call('env.load_seed',{expected_version:(await snap()).version,data:d,binding,virtual_now:'2026-11-18T17:00:00Z'})).status==='ready');
  check('Participant view redacts other replies',(await agent.call('meeting-poll.get',{id:'poll-team'})).item.responses.every(r=>r.person_id==='person-alex'));
  const denied=await write('edit',{id:'poll-team',patch:{title:'Impersonated'}});check('Backend enforces changed account authority',denied.status==='permission_denied');
  report.passed=true;
 }catch(e){report.error=e.stack;process.exitCode=1;}finally{await Promise.allSettled(clients.map(c=>c.close()));prepared.cleanup();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'integration.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error},null,2));}
})();
