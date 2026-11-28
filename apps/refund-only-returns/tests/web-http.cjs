'use strict';
const a=require('node:assert/strict'),path=require('node:path'),r=path.resolve(process.env.PALE_RUNTIME_ROOT||path.join(__dirname,'../../../runtime'));
const {prepare}=require(r+'/prepare.cjs'),{Client}=require(r+'/client.cjs'),{start}=require(r+'/web/server.cjs');
const p=prepare(path.join(__dirname,'..'));let h,i,g;
async function main(){
 h=await start({app:p.app,registry:p.registry,run:'refund-http',stateDir:path.join(p.root,'state')});
 i=new Client(p.app,'infra',h.run,h.stateDir,'refund-http-infra',{registry:p.registry});
 g=new Client(p.app,'agent',h.run,h.stateDir,'refund-http-agent',{registry:p.registry});
 await Promise.all([i.initialize(),g.initialize()]);
 const get=(route,headers={})=>fetch(h.url+route,{headers});
 const post=(route,body,headers={})=>fetch(h.url+route,{method:'POST',headers:{origin:h.url,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 a.equal((await get('/api/tools')).status,401);
 const login=await post('/session',{token:new URL(h.accessUrl).hash.slice('#access='.length)});
 const {csrf}=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0],headers={cookie,'X-Pale-CSRF':csrf};
 a.equal((await (await get('/api/tools',headers)).json()).tools.length,7);
 a.equal((await post('/api/call',{name:'env.advance_time',arguments:{}},headers)).status,403);
 a.equal((await post('/api/call',{name:p.app+'.lookup_order',arguments:{}},{cookie})).status,403);
 const call=async(n,args)=>{const response=await post('/api/call',{name:p.app+'.'+n,arguments:args},headers);a.equal(response.status,200);return response.json();};
 const order={order_id:'order-1'},read=await call('read_order',order);
 const d=await call('prepare_preview',{...order,expected_version:read.version,request_id:'prepare'});a.equal(d.status,'committed');
 const q={refund_request_id:d.request.id};
 const gRead=await g.call(p.app+'.read_request',q);a.deepEqual(gRead.request,d.request);
 const confirm=await call('confirm_request',{...q,expected_version:gRead.version,request_id:'confirm'});a.equal(confirm.request.status,'confirmed');
 a.equal((await i.call('env.snapshot')).snapshot.data.requests.filter(r=>r.order_id==='order-1'&&r.status==='confirmed').length,1);
 console.log('PASS: Web Host and independent Agent/Infra MCP observe identical persisted records; no browser simulated.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await Promise.allSettled([g?.close(),i?.close()]);await h?.close();p.cleanup();});
