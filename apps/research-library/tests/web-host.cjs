'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const runtime=process.env.PALE_RUNTIME_ROOT;
if(!runtime)throw Error('Set PALE_RUNTIME_ROOT to the pinned upstream runtime directory.');
const {prepare}=require(path.join(path.resolve(runtime),'prepare.cjs'));
const {Client}=require(path.join(path.resolve(runtime),'client.cjs'));
const {start}=require(path.join(path.resolve(runtime),'web/server.cjs'));
async function run(){
 const env=prepare(path.resolve(__dirname,'..'));
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'library-host-'));
 let host,infra;
 try {
  host=await start({app:'library',registry:env.registry,run:'library-host',stateDir,profile:'scenario'});
  infra=new Client('library','infra','library-host',stateDir,'library-host-test',{registry:env.registry});
  await infra.initialize();
  const post=(route,body,h={})=>fetch(host.url+route,{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json',...h},body:JSON.stringify(body)});
  assert.equal((await fetch(host.url+'/api/tools')).status,401);
  const auth=await post('/session',{token:new URLSearchParams(host.accessUrl.split('#')[1]).get('access')});
  assert.equal(auth.status,200);
  const headers={Cookie:auth.headers.get('set-cookie').split(';')[0],'X-Pale-CSRF':(await auth.json()).csrf};
  for(const [url,text] of [['/','Research Library'],['/app.js','save_note']]){
    const r=await fetch(host.url+url,{headers});assert.equal(r.status,200);assert.ok((await r.text()).includes(text));
  }
  assert.equal((await fetch(host.url+'/fixtures/minimal.json',{headers})).status,404);
  const tools=await (await fetch(host.url+'/api/tools',{headers})).json();assert.ok(tools.tools.every(t=>t.name.startsWith('library.')));
  const call=async (op,args)=>(await (await post('/api/call',{name:'library.'+op,arguments:args},headers)).json());
  assert.equal((await post('/api/call',{name:'env.snapshot',arguments:{}},headers)).status,403);
  const l={library_id:'group-1'};
  const initial=(await infra.call('env.snapshot')).snapshot;
  const read=await call('search',{...l,tag:'methods'});assert.deepEqual(read.records.map(x=>x.id),['paper-17']);
  assert.deepEqual((await call('get',{...l,id:'paper-17'})).notes,[]);
  assert.equal((await call('search',{library_id:'private-a'})).status,'permission_denied');
  const picked=await call('catalog_search',{...l,query:'Synthetic Survey'});
  const args={...l,expected_version:picked.version,catalog_id:picked.items[0].id,request_id:'write-1'};
  assert.equal((await call('import',args)).status,'permission_denied');
  assert.deepEqual((await infra.call('env.snapshot')).snapshot.data,initial.data);
  const grant=await infra.call('env.apply_event',{expected_version:read.version,event:require('../examples/scenario.json')});
  assert.equal(grant.status,'committed');
  assert.equal((await call('import',{...args,request_id:'stale-write'})).status,'stale_version');
  const opened=await call('catalog_search',{...l,query:'Synthetic Survey'});
  const writeArgs={...args,expected_version:opened.version};
  const imported=await call('import',writeArgs);assert.equal(imported.status,'committed');
  assert.equal((await call('import',writeArgs)).duplicate,true);
  const base={...l,id:imported.record.id,expected_record_revision:imported.record.revision,expected_version:imported.version};
  const edited=await call('save_record',{...base,patch:{title:'Synthetic Survey reviewed'},request_id:'write-2'});
  assert.equal(edited.status,'committed');
  const note=await call('save_note',{...base,expected_record_revision:edited.record.revision,expected_version:edited.version,text:'My synthesis',request_id:'write-3'});
  assert.equal(note.status,'committed');
  assert.deepEqual((await host.client.call('library.get',{...l,id:base.id})).notes,[note.note]);
  assert.deepEqual((await call('get',{...l,id:'paper-17'})).notes,[]);
  const expiry=await infra.call('env.advance_time',{expected_version:note.version,virtual_now:'2027-01-08T12:00:00Z',request_id:'expiry'});
  assert.equal(expiry.status,'committed');
  assert.equal((await call('save_note',{...base,request_id:'expired',expected_version:expiry.version,text:'blocked',expected_record_revision:note.record.revision})).status,'session_expired');
  const reset=await infra.call('env.reset',{expected_version:expiry.version});assert.equal(reset.status,'ready');
  assert.deepEqual((await infra.call('env.snapshot')).snapshot.data,initial.data);
  assert.equal((await call('search',l)).records.length,1);
  console.log('PASS actual local Web Host HTTP session/static/tools/fixed Agent MCP, filter, import/edit/note, denial, stale/replay/expiry/reset.');
 } finally{await host?.close();await infra?.close();env.cleanup();fs.rmSync(stateDir,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
