'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const runtime=process.env.PALE_RUNTIME_ROOT;if(!runtime)throw Error('Set PALE_RUNTIME_ROOT');
const {prepare}=require(path.join(runtime,'prepare.cjs')),{start}=require(path.join(runtime,'web/server.cjs'));
const APP='community-lending-library';
async function main(){
 const p=prepare(path.resolve(__dirname,'..'));let host;
 try{
  host=await start({app:APP,registry:p.registry,run:'lending-http',profile:'sandbox',stateDir:p.root+'/http'});
  const pathOf=u=>host.url+u;
  assert.equal((await fetch(pathOf('/api/tools'))).status,401);
  const token=new URLSearchParams(host.accessUrl.split('#')[1]).get('access');
  const post=(route,body,headers={})=>fetch(pathOf(route),{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const login=await post('/session',{token}),cookie=login.headers.get('set-cookie').split(';')[0];assert.equal(login.status,200);
  const {csrf}=await login.json(),headers={Cookie:cookie,'X-Pale-CSRF':csrf};
  const get=u=>fetch(pathOf(u),{headers:{Cookie:cookie}});
  assert.equal((await get('/fixtures/minimal.json')).status,404);
  for(const [url,marker] of [['/','Community Lending Library'],['/app.js','Activity and receipts']]){
   const r=await get(url);assert.equal(r.status,200);assert.ok((await r.text()).includes(marker));
  }
  const t=(await (await get('/api/tools')).json()).tools;
  assert.equal(t.length,14);assert.ok(t.every(x=>x.name.startsWith(APP+'.')));
  assert.equal((await post('/api/call',{name:'env.snapshot',arguments:{}},headers)).status,403);
  const call=async(name,args={})=>(await (await post('/api/call',{name:APP+'.'+name,arguments:args},headers)).json());
  const holds=await call('list_holds');
  const req=await call('request_checkout',{hold_id:'H1',expected_version:holds.version,request_id:'web-proof'});
  assert.equal(req.status,'committed');assert.equal(req.attempt.attempt,2);
  const inspected=await host.client.call(APP+'.list_activity',{});
  assert.deepEqual(inspected.attempts.at(-1),req.attempt);
  assert.deepEqual((await host.client.call(APP+'.list_loans',{})).loans,[]);
  console.log('PASS: real official Web Host with authentic business state, rendered files, and no Infra surface.');
 }finally{await host?.close();p.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
