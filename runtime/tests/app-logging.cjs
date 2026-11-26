'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../..'),{Client}=require('../client.cjs'),{createRuntime}=require('../core/runtime.cjs'),logging=require('../core/app-log.cjs');
let checks=0;const check=(x,label)=>{assert.ok(x,label);checks++;},equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),now=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pale-app-logging-')),clients=[];
 const make=async(app,role,run='logging')=>{const c=new Client(app,role,run,directory,'logging-tests',{registry:path.join(root,'examples/registry.'+app+'.json')});clients.push(c);await c.initialize();return c;};
 const rows=(app,run='logging')=>fs.readFileSync(path.join(directory,run,app+'.debug.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const attempt=(app,request)=>{const all=rows(app).filter(x=>x.request_id===request),id=all.at(-1).call_id;return all.filter(x=>x.call_id===id);};
 try{
  for(const app of ['mail','calendar']){
   const model=createRuntime(),s=model.create(app,'direct','sandbox'),args=app==='mail'?{id:'materials'}:{};
   const tool=app==='mail'?'mail.get':'calendar.list',events=[];
   const original=model.execute(s,'agent',tool,args),logged=model.execute(s,'agent',tool,args,{log:(step,details)=>events.push({step,details})});
   equal(logged.result,original.result,'Optional logging leaves direct business result unchanged');equal(logged.state.data,original.state.data,'Read logging does not mutate data');check(events.length>=2,'App reports meaningful steps');
   equal(model.execute(s,'agent',tool,args,{log:()=>{throw Error('bad observer');}}).result,original.result,'Broken observer does not change result');
  }
  const mi=await make('mail','infra'),ma=await make('mail','agent');let snap=await mi.call('env.snapshot');
  await mi.call('env.reset',{expected_version:snap.version,profile:'sandbox'});
  const discovered=(await ma.request('tools/list')).result.tools;
  check(!discovered.some(t=>/log|debug/.test(t.name)),'Logs are not an Agent tool');
  equal(discovered.find(t=>t.name==='mail.get').outputSchema,read('examples/apps/mail/tools.json').find(t=>t.name==='mail.get').outputSchema,'MCP output schema remains the declared schema');
  const response=await ma.request('tools/call',{name:'mail.get',arguments:{id:'materials'}});
  equal(Object.keys(response.result).sort(),['content','isError','structuredContent'],'No diagnostic fields in MCP envelope');
  equal(JSON.parse(response.result.content[0].text),response.result.structuredContent,'MCP text and structured result still agree');
  check(!JSON.stringify(response.result).includes('debug')&&!Object.hasOwn(response.result.structuredContent,'logs'),'No diagnostics in Agent observation');
  snap=await mi.call('env.snapshot');
  const draft=await ma.call('mail.draft.create',{to:['alex@example.com'],subject:'PRIVATE-LOG-TEST',body:'AUTHENTICATION-CODE-843901',request_id:'create',expected_version:snap.version});
  const args={id:draft.id,request_id:'send',expected_version:draft.version};
  const sent=await ma.call('mail.send',args),sendLog=attempt('mail','send');
  equal(sendLog.map(x=>x.step),['core.call.started','mail.send.started','mail.record.found','mail.send.validated','mail.send.prepared','core.call.committed'],'Business steps then persisted commit');
  check(sendLog.every(x=>x.run_id==='logging'&&x.app_id==='mail'&&x.actor==='agent'&&now(x.wall_time)&&now(x.virtual_time)),'Trusted run/App/role/time present');
  equal(sendLog.map(x=>x.seq),sendLog.map((_,i)=>i+1),'Sequence is local to each call');
  equal(sendLog.at(-1).version,sent.version,'Commit version agrees with MCP reply');
  const stored=JSON.parse(fs.readFileSync(path.join(directory,'logging','mail.json')));
  equal(stored.data.messages.find(x=>x.id===draft.id).folder,'sent','Terminal commit corresponds to persisted business data');
  check(!Object.hasOwn(stored,'debug')&&!Object.hasOwn(stored,'logs'),'App state schema untouched');
  const duplicate=await ma.call('mail.send',args),dupLog=attempt('mail','send');
  equal(duplicate,{...sent,duplicate:true},'Idempotent return unchanged');equal(dupLog.map(x=>x.step),['core.call.started','core.call.duplicate'],'Retry logs a new attempt without rerunning App steps');check(dupLog[0].call_id!==sendLog[0].call_id,'Retry has a new call ID');
  const fail=await ma.call('mail.send',{id:draft.id,request_id:'send-again',expected_version:sent.version}),failure=attempt('mail','send-again');
  equal(fail.status,'invalid_state','Domain error unchanged');equal(failure.map(x=>x.step),['core.call.started','mail.send.started','mail.record.found','core.call.rejected'],'Partial steps retained on failure');
  equal((await mi.call('env.snapshot')).version,sent.version,'Failed write leaves version unchanged');
  const stale=await ma.call('mail.flags.update',{id:draft.id,read:false,request_id:'stale',expected_version:draft.version});
  equal(stale.status,'stale_version','Stale version still rejected');equal(attempt('mail','stale').map(x=>x.step),['core.call.started','core.call.rejected'],'Version rejection does not run business handler');
  const unauthorized=await ma.call('env.reset',{expected_version:sent.version});equal(unauthorized.status,'permission_denied','Agent cannot use lifecycle APIs');
  const beforeText=fs.readFileSync(path.join(directory,'logging','mail.debug.jsonl'),'utf8');
  check(!beforeText.includes('PRIVATE-LOG-TEST')&&!beforeText.includes('843901')&&!beforeText.includes('alex@example.com'),'Examples never log message content or recipient addresses');
  check((fs.statSync(path.join(directory,'logging','mail.debug.jsonl')).mode&0o777)===0o600,'Diagnostic file is owner-only');
  snap=await mi.call('env.snapshot');await mi.call('env.reset',{expected_version:snap.version,profile:'sandbox'});
  check(fs.readFileSync(path.join(directory,'logging','mail.debug.jsonl'),'utf8').startsWith(beforeText),'Reset preserves separate diagnostic history');
  await ma.close();const restarted=await make('mail','agent');await restarted.call('mail.get',{id:'materials'});
  check(rows('mail').some(x=>x.call_id===sendLog[0].call_id),'Diagnostics survive process restart');
  const preFailure=await mi.call('env.snapshot'),tempTarget=path.join(directory,'logging','mail.json.'+restarted.child.pid+'.tmp');fs.mkdirSync(tempTarget);
  try{
   const unconfirmed=await restarted.request('tools/call',{name:'mail.draft.create',arguments:{to:['alex@example.com'],subject:'Persistence failure',body:'Synthetic',expected_version:preFailure.version,request_id:'persistence-failure'}});
   check(!!unconfirmed.error,'Persistence failure retains existing MCP RPC error behavior');
   const failureLog=attempt('mail','persistence-failure');check(failureLog.some(x=>x.step==='mail.draft.create.prepared'),'Prepared steps survive a failed state write');
   equal(failureLog.at(-1).step,'core.call.persistence_unconfirmed','Real state-write failure never claims a commit');
   equal(failureLog.at(-1).status,'unconfirmed','Diagnostic status does not mislabel an unpersisted result as committed');
   check(!failureLog.some(x=>x.step==='core.call.committed'),'Failed transaction has no committed diagnostic row');
   equal(JSON.parse(fs.readFileSync(path.join(directory,'logging','mail.json'))).data,preFailure.snapshot.data,'Failed persistence leaves stored business records unchanged');
  }finally{fs.rmdirSync(tempTarget);}
  const other=await make('mail','infra','other-run');await other.call('env.snapshot');check(rows('mail','other-run').every(x=>x.run_id==='other-run'),'Runs have separate diagnostic files');
  const ci=await make('calendar','infra'),ca=await make('calendar','agent');let cs=await ci.call('env.snapshot');await ci.call('env.reset',{expected_version:cs.version,profile:'sandbox'});cs=await ci.call('env.snapshot');
  const conflict=await ca.call('calendar.update',{id:'evt-review',patch:{start:'2026-11-16T13:30:00-08:00',end:'2026-11-16T14:30:00-08:00'},expected_version:cs.version,request_id:'conflict'});
  equal(conflict.status,'calendar_overlap','Calendar conflict remains unchanged');const clog=attempt('calendar','conflict');check(clog.some(x=>x.step==='calendar.update.conflict_checked'&&x.details.conflict),'Conflict explanation is recorded');check(!clog.some(x=>x.step.endsWith('.prepared')||x.step==='core.call.committed'),'Conflict never claims success');equal((await ci.call('env.snapshot')).snapshot.data,cs.snapshot.data,'Conflict keeps state unchanged');
  const event=read('examples/apps/calendar/examples/scenario.json');event.event_id='logged-calendar-event';const applied=await ci.call('env.apply_event',{expected_version:cs.version,event});
  equal(applied.status,'committed','Dynamic event still commits');const elog=rows('calendar').filter(x=>x.event_id===event.event_id);check(elog.some(x=>x.step==='calendar.upsert.prepared')&&elog.at(-1).step==='core.call.committed','Infra event logs steps and persisted outcome');equal(elog.at(-1).virtual_time,event.at,'Terminal event log records application simulation time');
  check(rows('calendar').every(x=>x.app_id==='calendar'),'App files are separate');
  const state=createRuntime().create('mail','sanitization','sandbox'),batch=logging.createCall({state,role:'agent',tool:'mail.send',args:{request_id:'unit'},connection_id:'trusted'});
  batch.log('mail.send.validated',{message_id:'m1',body:'SECRET',authentication_code:'843901',run_id:'spoofed',found:true});batch.log('core.call.committed',{});
  const malformed={};Object.defineProperty(malformed,'message_id',{enumerable:true,get(){throw Error('bad metadata');}});batch.log('mail.test.metadata',malformed);
  for(let i=0;i<100;i++)batch.log('mail.test.bounded',{match_count:i});
  batch.decided({state,result:{status:'committed'}});const bounded=batch.finish(false);
  check(bounded.length<=66,'Step log volume is bounded');check(bounded.at(-1).dropped_steps>0,'Dropped step count is visible');
  equal(bounded.at(-1).step,'core.call.persistence_unconfirmed','No commit claim before persistence');
  check(!bounded.some(x=>x.step==='core.call.committed'),'App cannot forge a Core commit marker');
  equal(bounded[1].run_id,'sanitization','Caller metadata cannot replace trusted run');check(!JSON.stringify(bounded).includes('SECRET')&&!JSON.stringify(bounded).includes('843901'),'Unsupported payload fields are discarded');
  equal(batch.finish(true),[],'Finishing twice cannot manufacture another outcome');
  const blocked=path.join(directory,'not-a-directory');fs.writeFileSync(blocked,'x');let warned=false;
  equal(logging.append(blocked,'mail',bounded,{warn:()=>{warned=true;}}),false,'Sink failure is explicit to platform');check(warned,'Sink failure emits a platform warning');
  // Real MCP call still succeeds if the diagnostic target cannot be opened.
  const broken=await make('mail','infra','broken-log'),brokenAgent=await make('mail','agent','broken-log');await broken.call('env.snapshot');
  const logPath=path.join(directory,'broken-log','mail.debug.jsonl');fs.unlinkSync(logPath);fs.mkdirSync(logPath);
  equal((await brokenAgent.call('mail.get',{id:'materials'})).status,'ok','Sink failure does not corrupt MCP stdout or business result');
  console.log('PASS: '+checks+' App diagnostic logging checks.');
 }finally{await Promise.all(clients.map(c=>c.close()));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
