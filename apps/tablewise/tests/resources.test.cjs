'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const runtime=process.env.PALE_RUNTIME_ROOT||path.resolve(__dirname,'../../../runtime');
test('actual MCP resource reads enforce the venue parent grant and reject corrupt imports atomically',async t=>{
 const p=require(path.join(runtime,'prepare.cjs')).prepare(path.resolve(__dirname,'..')),clients=[];t.after(async()=>{await Promise.allSettled(clients.map(c=>c.close()));p.cleanup();});
 const {Client}=require(path.join(runtime,'client.cjs'));async function open(role){const c=new Client('tablewise',role,'parent-test',path.join(p.root,'state'),'resource-test',{registry:p.registry,initialProfile:role==='infra'?'sandbox':undefined});clients.push(c);await c.initialize();return c;}
 const infra=await open('infra'),agent=await open('agent'),s=await infra.call('env.snapshot'),document=await agent.call('tablewise.venues.document',{id:'venue-1'});assert.equal(document.status,'ok');
 const direct=await agent.request('resources/read',{uri:'pale://parent-test/tablewise/assets/menu-1'});assert.equal(direct.result.contents[0].blob,document.file.base64);
 const corrupt=structuredClone(s.snapshot.resources.bundle);corrupt.catalog.assets[0].integrity.sha256='0'.repeat(64);const rejected=await infra.call('env.load_seed',{request_id:'corrupt',expected_version:s.version,data:s.snapshot.data,bundle:corrupt});assert.notEqual(rejected.status,'ready');assert.deepEqual((await infra.call('env.snapshot')).snapshot.data,s.snapshot.data);
 const restricted={allow:['tablewise.workspace.get'],constraints:{}};assert.equal((await infra.call('env.load_seed',{request_id:'restrict',expected_version:s.version,data:s.snapshot.data,bundle:s.snapshot.resources.bundle,policies:{scenario:restricted,sandbox:restricted}})).status,'ready');assert.equal((await agent.call('tablewise.venues.document',{id:'venue-1'})).status,'permission_denied');assert.ok((await agent.request('resources/read',{uri:'pale://parent-test/tablewise/assets/menu-1'})).error);
});
