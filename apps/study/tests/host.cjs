'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=process.env.PALE_RUNTIME_ROOT||path.resolve(__dirname,'../../../runtime');
const {prepare}=require(path.join(runtime,'prepare.cjs'));
const {start}=require(path.join(runtime,'web/server.cjs'));
async function run(){
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'study-host-'));
 const assembly=prepare(path.resolve(__dirname,'..'));
 let host;
 try{
  host=await start({app:'study',registry:assembly.registry,run:'study-host',stateDir});
  const post=(route,body,headers={})=>fetch(host.url+route,{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(host.url+'/api/tools')).status,401);
  const login=await post('/session',{token:new URLSearchParams(host.accessUrl.split('#')[1]).get('access')});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();
  const headers={Cookie:cookie,'X-Pale-CSRF':csrf};
  const read=route=>fetch(host.url+route,{headers:{Cookie:cookie}});
  for(const [route,marker] of [['/','Language Study Workspace'],['/app.js','record_review']]){
   const reply=await read(route);assert.equal(reply.status,200);assert.ok((await reply.text()).includes(marker));
  }
  assert.equal((await read('/fixtures/minimal.json')).status,404);
  const discovered=await (await read('/api/tools')).json();
  assert.deepEqual(discovered.tools.map(t=>t.name),require('../tools.json').map(t=>t.name));
  assert.ok(discovered.tools.every(x=>x.name.startsWith('study.')));
  assert.equal((await post('/api/call',{name:'env.snapshot',arguments:{}},headers)).status,403);
  const call=async (name,args={})=>(await (await post('/api/call',{name:'study.'+name,arguments:args},headers)).json());
  assert.deepEqual((await call('get_queue')).cards.map(c=>c.id),['C1','C4','C2']);
  const rev=await call('reveal',{card_id:'C1'});
  assert.equal(rev.answer,'estación de tren');
  const args={card_id:rev.card_id,card_version:rev.card_version,review_day:rev.review_day,expected_version:rev.version,request_id:'web-write',rating:'Good'};
  const write=await call('record_review',args);
  assert.equal(write.status,'committed');
  assert.equal((await call('record_review',args)).duplicate,true);
  assert.deepEqual((await host.client.call('study.get_history')).history,[write.review]);
  console.log('Web Host HTTP path → fixed real Agent MCP: discovery, reveal, rating, duplicate safety, authoritative ledger and Infra isolation passed.');
 }finally{await host?.close();assembly.cleanup();fs.rmSync(stateDir,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
