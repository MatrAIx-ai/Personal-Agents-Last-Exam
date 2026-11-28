'use strict';
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(x).digest('hex');
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
const DAY=86400000, first=Date.parse('2025-01-01'), last=Date.parse('2026-12-31');
const iso=t=>new Date(t).toISOString().slice(0,10);
function random(seed){return n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0; return Math.floor(seed/4294967296*n);};}
function context(repo,name){
 const appDir=path.join(repo,'apps',name);
 const root=process.env.PALE_RUNTIME_ROOT?path.resolve(process.env.PALE_RUNTIME_ROOT):path.join(repo,'runtime');
 const {prepare}=require(path.join(root,'prepare.cjs'));
 const p=prepare(appDir); return {...p,Client:require(path.join(root,'client.cjs')).Client};
}
function engine(p,seed,binding,dataset,profile='scenario'){
 let s=p.model.create(p.app,'historical-generation',profile), request=0;
 const bundle={...s.resources.bundle,dataset};
 function call(role,tool,args,status){
  const res=p.model.execute(s,role,tool,args);
  assert.equal(res.result.status,status,tool+' '+JSON.stringify(res.result).slice(0,1200));
  s=res.state; return res.result;
 }
 function mutation(role,tool,args,status='committed'){
  return call(role,tool,{...args,expected_version:{epoch:s.epoch,revision:s.revision},request_id:'history-'+(++request)},status);
 }
 mutation('infra','env.load_seed',{data:seed,binding,bundle,virtual_now:'2025-01-01T00:00:00+08:00'},'ready');
 return {state:()=>s,call,mutation,advance:(date,h='20:00:00')=>mutation('infra','env.advance_time',{virtual_now:date+'T'+h+'+08:00'})};
}
function manifest(id,records,seed,method){
 return {schema_version:'pale.dataset.v1',dataset_id:id,version:'1.0.0',description:'Fictional private account activity, generated entirely from authored synthetic inputs.',record_source_ids:['authored-synthetic'],sources:[{source_id:'authored-synthetic',kind:'synthetic',description:'Fictional contents, identities, and activity; no collection from any source.',uri:null,license:'MIT',usage:'permitted',collection:null,generation:{method,tool:'Node.js deterministic generator',tool_version:'1.0.0',seed:String(seed),parameters:{start:'2025-01-01',end:'2026-12-31',timezone:'Asia/Shanghai'}}}],transformations:['Replay actual App tools through PALE Core; project stable activity records and a separately loadable final snapshot.'],expected_counts:{records,assets:0},quality_policy:{duplicate_records:'reject',duplicate_assets:'reject',missing_assets:'allow_declared'},review:{status:'pending',reviewer:null,notes:'Separate review candidate. No third-party content or real user activity.'}};
}
function coverage(rows){
 const months={};
 for(let m=0;m<24;m++)months[iso(Date.UTC(2025,m,1)).slice(0,7)]={source:'authored-synthetic',real:0,synthetic:0,dates:new Set(),types:{}};
 const dateSet=new Set();
 for(const row of rows){
  assert.match(row.date,/^202[56]-\d\d-\d\d$/);
  assert.equal(row.source,'authored-synthetic');
  const month=months[row.date.slice(0,7)];assert.ok(month);
  month.synthetic++;month.dates.add(row.date);dateSet.add(row.date);
  month.types[row.kind]=(month.types[row.kind]||0)+1;
 }
 const monthly=Object.entries(months).map(([month,{dates,...r}])=>({month,...r,activity_dates:dates.size}));
 assert.ok(monthly.every(r=>r.synthetic>0)); assert.ok(dateSet.size>=300);
 return {period:['2025-01-01','2026-12-31'],real:0,synthetic:rows.length,activity_dates:dateSet.size,first_activity:[...dateSet].sort()[0],last_activity:[...dateSet].sort().at(-1),monthly};
}
async function mcp(p,pack,fn){
 const dir=path.join(p.root,'history-check-state'), run='history-public-check';
 const infra=new p.Client(p.app,'infra',run,dir,'history-verification',{registry:p.registry});
 const agent=new p.Client(p.app,'agent',run,dir,'history-verification',{registry:p.registry});
 const result=async (client,tool,args,status)=>{const r=await client.call(tool,args);assert.equal(r.status,status,tool+' '+JSON.stringify(r).slice(0,320));return r;};
 try{
  await infra.initialize();await agent.initialize();
  const bi=(await result(infra,'env.snapshot',{},'ok')).version;
  const bundle={...pack.bundle};
  const args={...pack,expected_version:bi,request_id:'history-public-check'};
  await result(infra,'env.validate_bundle',{data:pack.data,binding:pack.binding,bundle},'ok');
  await result(infra,'env.load_seed',args,'ready');
  const snapshot=()=>result(infra,'env.snapshot',{},'ok');
  const loaded=await snapshot();
  assert.deepEqual(loaded.snapshot.data,pack.data);
  assert.equal(loaded.snapshot.virtual_now,pack.virtual_now);
  assert.equal(loaded.snapshot.resources.quality.automated_pass,true);
  await result(agent,'env.snapshot',{},'permission_denied');
  await fn((tool,args={},status='ok')=>result(agent,tool,args,status),loaded.snapshot);
  const reset=await result(infra,'env.reset',{expected_version:loaded.version},'ready');
  assert.ok(reset.version.epoch>loaded.version.epoch);
  const restored=(await snapshot()).snapshot;
  assert.deepEqual(restored.data,pack.data);
  assert.equal(restored.virtual_now,pack.virtual_now);
  assert.deepEqual(restored.resources.bundle,loaded.snapshot.resources.bundle);
  assert.deepEqual(restored.receipts,{});
  return 'Public MCP: bundle validates, opt-in load and role-scoped queries pass, reset reproduces the loaded snapshot.';
 }finally{await Promise.allSettled([infra.close(),agent.close()]);}
}
function save(out,pack,rows){
 fs.mkdirSync(out,{recursive:true});
 const ledger=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
 fs.writeFileSync(path.join(out,'activity.jsonl'),ledger);
 write(path.join(out,'load-seed.json'),pack);
 write(path.join(out,'coverage.json'),{...coverage(rows),ledger_sha256:sha(ledger),load_seed_sha256:sha(fs.readFileSync(path.join(out,'load-seed.json')))});
}
module.exports={context,engine,manifest,coverage,save,mcp,random,sha,DAY,first,last,iso,assert};
