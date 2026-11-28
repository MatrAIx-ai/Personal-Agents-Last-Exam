'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=process.env.PALE_RUNTIME_ROOT||path.resolve(__dirname,'../../../runtime');
const {prepare}=require(path.join(runtime,'prepare.cjs'));
const {Client}=require(path.join(runtime,'client.cjs'));
const {start}=require(path.join(runtime,'web/server.cjs'));
const seed=require('../fixtures/minimal.json');

async function run(){
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'study-host-full-'));
 const assembly=prepare(path.resolve(__dirname,'..'));const hosts=[];let infra;
 try{
  const launch=async(profile,id)=>{
   const host=await start({app:'study',registry:assembly.registry,profile,run:id,stateDir});hosts.push(host);
   const post=(route,body,h={})=>fetch(host.url+route,{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json',...h},body:JSON.stringify(body)});
   const login=await post('/session',{token:new URLSearchParams(host.accessUrl.split('#')[1]).get('access')});
   assert.equal(login.status,200);
   const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json(),headers={Cookie:cookie,'X-Pale-CSRF':csrf};
   const read=route=>fetch(host.url+route,{headers:{Cookie:cookie}});
   const call=async(name,args={})=>(await (await post('/api/call',{name:'study.'+name,arguments:args},headers)).json());
   return {host,read,call,tools:(await (await read('/api/tools')).json()).tools.map(x=>x.name)};
  };
  const w=await launch('sandbox','study-full-http');
  const o=await launch('scenario','study-full-observer');
  const mutations=['save_card','set_suspension','save_plan','set_session','record_review','undo_review'];
  for(const t of mutations){assert.ok(w.tools.includes('study.'+t));assert.ok(!o.tools.includes('study.'+t));}
  const javascript=await (await w.read('/app.js')).text();
  for(const marker of ['Edit plan','Discard plan draft','Pause at this card','Confirm undo','Suspend card'])assert.ok(javascript.includes(marker));
  assert.equal((await w.read('/fixtures/minimal.json')).status,404);
  const ok=(x,s='ok')=>{assert.equal(x.status,s,JSON.stringify(x));return x};
  let counter=0;
  const write=(name,args,version)=>w.call(name,{...args,expected_version:version,request_id:'browser-http-'+(++counter)});
  const baseline=ok(await w.call('get_history')).history;
  const observerCard=ok(await o.call('get_card',{card_id:'C1'}));
  assert.deepEqual(await o.call('set_suspension',{card_id:'C1',suspended:true,expected_version:observerCard.version,request_id:'observer-no'}),{error:'Business operation not permitted'});
  assert.deepEqual(ok(await o.call('get_card',{card_id:'C1'})).card,observerCard.card);

  const readCard=()=>w.call('get_card',{card_id:'C1'});
  const c=ok(await readCard());
  ok(await write('save_card',{card_id:c.card.id,deck_id:c.card.deck_id,prompt:'Railway station',answer:c.card.answer},c.version),'committed');
  const revised=ok(await readCard());assert.equal(revised.card.prompt,'Railway station');assert.equal(revised.card.id,c.card.id);
  const suspended=ok(await write('set_suspension',{card_id:c.card.id,suspended:true},revised.version),'committed');
  assert.ok(!(await w.call('get_queue')).cards.some(x=>x.id===c.card.id));
  ok(await write('set_suspension',{card_id:c.card.id,suspended:false},suspended.version),'committed');
  assert.ok((await w.call('get_queue')).cards.some(x=>x.id===c.card.id));

  const plan=ok(await w.call('get_plan'));const newPlan={deck_ids:plan.plan.deck_ids,daily_limit:plan.plan.daily_limit,new_limit:plan.plan.new_limit,target_day:plan.plan.target_day+1};
  ok(await w.call('preview_plan',newPlan));assert.deepEqual((await w.call('get_plan')).version,plan.version);
  ok(await write('save_plan',newPlan,plan.version),'committed');
  assert.equal((await w.call('get_plan')).plan.target_day,newPlan.target_day);
  ok(await write('save_plan',{...newPlan,target_day:99},plan.version),'stale_version');
  assert.equal((await w.host.client.call('study.get_plan')).plan.target_day,newPlan.target_day);

  const initialQueue=ok(await w.call('get_queue'));
  const paused=ok(await write('set_session',{card_id:c.card.id,paused:true},initialQueue.version),'committed');
  assert.deepEqual((await w.call('get_queue')).session,{card_id:c.card.id,paused:true});
  ok(await write('set_session',{card_id:c.card.id,paused:false},paused.version),'committed');
  const reveal=ok(await w.call('reveal',{card_id:c.card.id}));
  const rateArgs={card_id:reveal.card_id,card_version:reveal.card_version,review_day:reveal.review_day,rating:'Good',expected_version:reveal.version,request_id:'one-rating'};
  const rated=ok(await w.call('record_review',rateArgs),'committed');
  assert.equal((await w.call('record_review',rateArgs)).duplicate,true);
  const h=ok(await w.call('get_history'));assert.equal(h.history.length,baseline.length+1);
  assert.equal(h.undoable_review_id,rated.review.id);
  const undoArgs={review_id:rated.review.id,request_id:'one-undo',expected_version:h.version};
  ok(await w.call('undo_review',undoArgs),'committed');assert.equal((await w.call('undo_review',undoArgs)).duplicate,true);
  const undone=ok(await w.host.client.call('study.get_history'));
  assert.equal(undone.history.find(x=>x.id===rated.review.id).undone,true);
  assert.equal((await w.call('get_queue')).remaining,initialQueue.remaining);

  infra=new Client('study','infra','study-full-http',stateDir,'gui-http-proof',{registry:assembly.registry,initialProfile:'sandbox'});
  await infra.initialize();
  const closed=ok(await w.call('reveal',{card_id:c.card.id}));
  const correction={event_id:'gui-proof-correction',at:'2027-01-08T09:00:00+08:00',operation:'study.correct_card',
    payload:{card_id:c.card.id,expected_revision:closed.card_version,answer:'Respuesta corregida'}};
  const fix=ok(await infra.call('env.apply_event',{event:correction,expected_version:closed.version}),'committed');
  ok(await w.call('record_review',{...rateArgs,expected_version:fix.version,card_version:closed.card_version,request_id:'corrected-form'}),'stale_card');
  assert.equal((await w.call('get_history')).history.length,baseline.length+1);
  assert.equal((await readCard()).card.answer,'Respuesta corregida');

  const nowPlan=ok(await w.call('get_plan'));
  const target={event_id:'gui-proof-target',at:'2027-01-08T10:00:00+08:00',operation:'study.change_target',
    payload:{plan_id:nowPlan.plan.id,expected_revision:nowPlan.plan.revision,target_day:-1}};
  ok(await infra.call('env.apply_event',{event:target,expected_version:nowPlan.version}),'committed');
  const changed=ok(await w.call('get_plan'));assert.equal(changed.plan.target_day,-1);
  assert.equal(changed.plan.daily_limit,seed.plan.daily_limit);
  assert.ok(changed.notices.some(n=>n.id===target.event_id&&n.object_id===nowPlan.plan.id));
  assert.ok(ok(await w.call('get_capacity')).capacity.missing_slots>0);
  assert.equal((await w.call('get_history')).history.length,baseline.length+1);
  console.log('PASS: fixed Web Host HTTP→Agent MCP full six-path interface matrix and observer gates; separate Infra events do not leak into Agent discovery.');
 }finally{
  await infra?.close();await Promise.all(hosts.map(h=>h.close()));assembly.cleanup();fs.rmSync(stateDir,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
