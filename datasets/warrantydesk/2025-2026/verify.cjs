'use strict';
const C=require('./common.cjs'),{assert,fs,path,hash,clone}=C;
const id=path.basename(path.dirname(__dirname)),e=C.environment(id,__dirname);
const runtime=path.resolve(process.env.PALE_RUNTIME_ROOT||path.resolve(e.app,'../../runtime'));
const {prepare}=require(path.join(runtime,'prepare.cjs')),{Client}=require(path.join(runtime,'client.cjs'));
const {digestTree}=require(path.join(runtime,'verify.cjs'));
const dataset=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
const report={schema:'pale.history-load-verification.v1',app_id:id,app_revision:dataset.app_revision,package_sha256:digestTree(e.app),dataset_sha256:hash(dataset),runtime_version:require(path.join(runtime,'package.json')).version,core_api_version:'1.2.0',node:process.version,verified_at:new Date().toISOString(),checks:[],observations:[],passed:false};
const check=(name,test)=>{assert.ok(test,name);report.checks.push({name,status:'passed'});};
const eq=(name,a,b)=>{assert.deepEqual(a,b,name);report.checks.push({name,status:'passed'});};
const output=path.resolve(process.argv[2]||path.join(__dirname,'mcp-readback.json'));
const p=prepare(e.app),clients=[];
async function main(){
 eq('Dataset pins unchanged approved App package',report.package_sha256,dataset.app_package_sha256);
 for(const [file,digest]of Object.entries(dataset.source_hashes)){const at=file.startsWith('apps/')?path.resolve(e.app,'../..',file):path.join(__dirname,file);eq('Source hash '+file,hash(fs.readFileSync(at,'utf8')),digest);}
 const calculated=C.coverage(e,dataset),stored=JSON.parse(fs.readFileSync(path.join(__dirname,'coverage.json'),'utf8'));
 eq('Coverage recalculates exactly over delivered records',calculated,stored);eq('All 24 months contain actual represented records',calculated.missing_months,[]);eq('Unresolved date errors',calculated.errors,[]);
 // These controls verify the new report's exclusions and sensitivity, not App behavior.
 const sparse=clone(dataset);const feb=new Set(stored.facts.filter(x=>x.date.startsWith('2025-02')).map(x=>x.record.split('/')[0]));sparse.seeds=sparse.seeds.filter(s=>!feb.has(s.id));check('Dropping a month is exposed',C.coverage(e,sparse).missing_months.includes('2025-02'));
 const future=clone(dataset);future.seeds[0].data.records[0].created_at='2027-01-02T09:00:00Z';future.seeds[0].data_sha256=hash(future.seeds[0].data);check('Future scenario record is excluded from Environment count',C.coverage(e,future).exclusions.some(x=>x.value==='2027-01-02T09:00:00Z'));
 const invalid=clone(dataset);invalid.seeds[0].data.records[0].created_at='not-a-date';invalid.seeds[0].data_sha256=hash(invalid.seeds[0].data);check('Invalid timestamp is visible as an error',C.coverage(e,invalid).errors.length>0);
 const make=async role=>{const c=new Client(id,role,'history-coverage',path.join(p.root,'state'),'historical-data-readback',{registry:p.registry});clients.push(c);await c.initialize();return c;};
 const infra=await make('infra'),agent=await make('agent'),read=async(name,args={})=>{const r=await agent.call(id+'.'+name,args);assert.ok(r.value,JSON.stringify(r));return r.value;};
 eq('Agent cannot load history',(await agent.call('env.load_seed',{})).status,'permission_denied');
 let n=0;
 for(const s of dataset.seeds){
  const before=await infra.call('env.snapshot');
  const result=await infra.call('env.load_seed',{expected_version:before.version,request_id:'history-load-'+(++n),data:s.data,binding:e.binding,virtual_now:s.load_at});
  if(result.status!=='ready')throw new Error(s.id+' real Core load: '+JSON.stringify(result));eq(s.id+' real Core load',result.status,'ready');const loaded=await infra.call('env.snapshot');eq(s.id+' entire persisted snapshot',loaded.snapshot.data,s.data);
  eq(s.id+' Agent bound account',(await read('workspace.get')).account_id,s.account_id);
  eq(s.id+' all narrative records readable',(await read('records.list')).items,s.data.records);
  for(const r of s.data.records)eq(s.id+' exact record '+r.id,(await read('records.get',{id:r.id})).item,r);
  const observation={seed_id:s.id,account_id:s.account_id,dataset_data_sha256:s.data_sha256,persisted_data_sha256:hash(loaded.snapshot.data),loaded_version:loaded.version,receipts:[],sample_record:s.data.records[0],kind:s.kind};
  if(id==='submissiondesk'){
   for(const k of ['materials','bundles','requests','abstracts','papers','venues'])eq(s.id+' '+k+' Agent readback',(await read(k+'.list')).items,s.data[k]);
   const submissions=await read('submissions.list');eq(s.id+' portal receipts',submissions.receipts,s.data.receipts);eq(s.id+' ordered business history',submissions.history,s.data.history);eq(s.id+' submissions',submissions.items,s.data.submissions);
   observation.receipts=submissions.receipts.map(r=>({id:r.id,kind:r.kind,digest:r.snapshot.content_digest,at:r.at}));
   for(const r of s.data.receipts.filter(r=>r.kind!=='withdrawn')){const qs=s.data.requests.filter(q=>q.bundle_id===r.bundle_id&&q.status==='approved'&&Date.parse(q.reply.at)<=Date.parse(r.at));eq(s.id+' actual release has three prior proof scopes '+r.id,new Set(qs.map(q=>q.scope)).size,3);}
  }else if(id==='transitwallet'){
   eq(s.id+' equipment readback',(await read('workspace.get')).equipment,s.data.equipment);
   const routeViews=(await read('routes.list')).items;eq(s.id+' all service IDs',routeViews.map(x=>x.id),s.data.services.map(x=>x.id));
   const bookings=(await read('bookings.list')).items;eq(s.id+' booking IDs',bookings.map(x=>x.id),s.data.bookings.map(x=>x.id));
   eq(s.id+' actual journey receipts',(await read('journeys.list')).items,s.data.journeys);eq(s.id+' request proofs',(await read('requests.list')).items,s.data.requests);
   const wallet=await read('wallet.get');eq(s.id+' entire immutable ledger',wallet.ledger,s.data.ledger);eq(s.id+' actual completed legs',s.data.journeys.filter(j=>j.status==='completed').length,2);
   if(s.kind==='expired-unpaid-return')check(s.id+' lapsed hold remains historically held',bookings.some(b=>b.status==='held'&&b.effective_status==='expired'));
   observation.receipts=s.data.journeys.map(j=>({id:j.id,status:j.status,arrived_at:j.arrived_at}));observation.balance_cents=wallet.balance_cents;
  }else{
   eq(s.id+' request proof readback',(await read('requests.list')).items,s.data.requests);const ps=(await read('pickups.list')).items;eq(s.id+' pickup facts',ps.map(v=>Object.fromEntries(Object.keys(s.data.pickups.find(p=>p.id===v.id)).map(k=>[k,v[k]]))),s.data.pickups);
   for(const c of s.data.cases){const view=await read('case.get',{id:c.id});eq(s.id+' actual hold postings',view.postings,s.data.postings.filter(x=>x.case_id===c.id));eq(s.id+' manufacturer receipts',view.receipts,s.data.receipts.filter(x=>x.selector.case_id===c.id));eq(s.id+' terminal case',view.item.status,c.status);eq(s.id+' physical device custody',view.devices,s.data.devices.filter(x=>[c.old_serial,c.replacement_serial].includes(x.id)));observation.receipts.push({case_id:c.id,status:view.item.status,hold_status:view.item.hold_status,receipt_ids:view.receipts.map(r=>r.id)});}
  }
  const stable=await infra.call('env.snapshot');eq(s.id+' reads preserve all data',stable.snapshot.data,s.data);
  eq(s.id+' reset uses historical loaded baseline',(await infra.call('env.reset',{expected_version:stable.version})).status,'ready');const reset=await infra.call('env.snapshot');eq(s.id+' historical reset data',reset.snapshot.data,s.data);eq(s.id+' historical reset clock',reset.snapshot.virtual_now,s.load_at);
  report.observations.push(observation);
 }
 const good=await infra.call('env.snapshot'),bad=clone(dataset.seeds[0].data);
 if(id==='submissiondesk')bad.bundles[0].content_digest='0'.repeat(64);else if(id==='transitwallet')bad.ledger.find(x=>x.kind==='debit').amount_cents+=1;else bad.postings.pop();
 eq('Tampered historical business facts are rejected',(await infra.call('env.load_seed',{expected_version:good.version,data:bad,binding:e.binding,virtual_now:dataset.seeds[0].load_at})).status,'invalid_seed');const unchanged=await infra.call('env.snapshot');eq('Rejected history preserves previous account data',unchanged.snapshot.data,good.snapshot.data);eq('Rejected history preserves version',unchanged.version,good.version);
 eq('App package unchanged after all history loads',digestTree(e.app),report.package_sha256);report.passed=true;
}
main().catch(error=>{report.error={message:error.message,stack:error.stack};process.exitCode=1;}).finally(async()=>{for(const c of clients)await c.close();p.cleanup();C.write(output,report);console.log(JSON.stringify({app:id,passed:report.passed,checks:report.checks.length,loaded_partitions:report.observations.length,error:report.error?.message,output}));});
