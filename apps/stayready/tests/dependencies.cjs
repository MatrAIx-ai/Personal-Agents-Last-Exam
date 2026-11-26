'use strict';
// Optional Task/Infra composition, using actual public Contacts and Notes MCPs.
// StayReady has no required App dependency and never opens their state files.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),appDir=path.resolve(__dirname,'..');
const runtimeRoot=process.env.PALE_RUNTIME_ROOT||path.join(root,'runtime');
const {prepare}=require(path.join(runtimeRoot,'prepare.cjs')),{Client}=require(path.join(runtimeRoot,'client.cjs'));
const clone=x=>structuredClone(x),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const at='2026-12-01T18:00:00Z',created='2026-11-30T12:00:00Z';
async function main(){
 const output=path.resolve(process.env.STAYREADY_REPORT_DIR||path.join(root,'.artifacts/stayready'));fs.mkdirSync(output,{recursive:true});
 const prepared=prepare(appDir,['contacts','notes'].map(x=>path.join(root,'apps',x))),clients=[],checks=[],trace=[];
 const report={schema:'stayready.dependency-evidence.v1',node:process.version,runtime:require(path.join(runtimeRoot,'package.json')).version,dependencies:{contacts:'1.0.0',notes:'1.0.0'},checks,passed:false};
 const check=(name,value=true)=>{assert.ok(value,name);checks.push({name,status:'passed'});};
 async function client(app,role,run='dependencies',registry=prepared.registry){const c=new Client(app,role,run,path.join(prepared.root,'state'),'stayready-dependency-evidence',{registry,initialProfile:role==='infra'?'sandbox':undefined});clients.push(c);await c.initialize();return c;}
 async function call(c,name,args={}){const result=await c.call(name,args);trace.push({name,args:clone(args),result:clone(result)});return result;}
 const snap=c=>call(c,'env.snapshot');
 async function load(c,data,binding,policies){const s=await snap(c);return call(c,'env.load_seed',{expected_version:s.version,data,binding,virtual_now:at,...(policies?{policies}:{})});}
 try{
  const contactsInfra=await client('contacts','infra'),notesInfra=await client('notes','infra'),stayInfra=await client('stayready','infra');
  const contacts=await client('contacts','agent'),notes=await client('notes','agent'),stay=await client('stayready','agent');
  const base=clone(require('../fixtures/minimal.json')),binding=clone(require('../fixtures/binding.json'));
  const identity=app=>({people:clone(binding.people),accounts:[{app_id:app,account_id:app+'-alex',owner_person_id:'person-1'}],objects:{[app]:[app==='notes'?'note-breakfast-jamie':'contact-jamie']}});
  const contactSeed={account_id:'contacts-alex',owner_person_id:'person-1',contacts:[{id:'contact-jamie',account_id:'contacts-alex',created_at:created,updated_at:created,history:[{at:created,action:'seeded'}],display_name:'Jamie Chen',person_id:'person-2',emails:['jamie@example.test'],phones:[],organization:'',groups:['travel'],notes:'Private contact background',archived:false}]};
  const noteSeed={account_id:'notes-alex',owner_person_id:'person-1',notes:[{id:'note-breakfast-jamie',account_id:'notes-alex',created_at:created,updated_at:created,history:[{at:created,action:'seeded'}],title:'Jamie breakfast request',body:JSON.stringify({person_id:'person-2',meal_request:'Plant-based breakfast',private_background:'Private dietary background'}),tags:['travel'],pinned:false,archived:false,trashed:false,attachments:[],revisions:[]}]};
  check('actual Contacts fixture loads',(await load(contactsInfra,contactSeed,identity('contacts'))).status==='ready');
  check('actual Notes fixture loads',(await load(notesInfra,noteSeed,identity('notes'))).status==='ready');
  const contactsBefore=await snap(contactsInfra),notesBefore=await snap(notesInfra);
  const contact=await call(contacts,'contacts.get',{id:'contact-jamie'}),note=await call(notes,'notes.get',{id:'note-breakfast-jamie'});
  check('public Contacts/Notes reads succeed',contact.status==='ok'&&note.status==='ok');
  const parsed=JSON.parse(note.item.body);check('read sources agree on bound traveler',contact.item.person_id===parsed.person_id&&binding.people.some(p=>p.person_id===parsed.person_id));
  // Only trusted Infra constructs the source snapshot and disclosure grant.
  // A successful dependency read by itself does not authorize hotel disclosure.
  base.people.find(p=>p.id===contact.item.person_id).name=contact.item.display_name;
  const source=base.sources.find(s=>s.id==='source-breakfast-person-2');
  source.fields={meal_request:parsed.meal_request,private_background:parsed.private_background};
  source.observed_at=at;source.provenance={app_id:'notes',account_id:'notes-alex',object_id:note.item.id,observed_version:note.version.epoch+':'+note.version.revision};
  source.disclose_fields=['meal_request'];source.readable=true;
  binding.accounts.push(...identity('contacts').accounts,...identity('notes').accounts);
  binding.objects.contacts=['contact-jamie'];binding.objects.notes=['note-breakfast-jamie'];
  check('Infra loads explicit source grant and binding',(await load(stayInfra,base,binding)).status==='ready');
  const need=base.needs.find(n=>n.id==='need-breakfast-person-2'),conditions={...need.conditions,meal_request:parsed.meal_request};
  const saved=await call(stay,'stayready.need.save',{need_id:need.id,conditions,source_ids:[source.id],request_id:'save-from-notes',expected_version:(await snap(stayInfra)).version});
  check('actual Notes fact is used by StayReady',saved.status==='committed');
  const preview=await call(stay,'stayready.request.preview',{need_id:need.id,action:'arrange'});
  check('preview is narrowed to source-authorized service fields',preview.status==='ok'&&!JSON.stringify(preview).includes('Private dietary background')&&!JSON.stringify(preview).includes('jamie@example.test'));
  const args={need_id:need.id,action:'arrange',preview_token:preview.preview.preview_token,request_id:'submit-from-notes',expected_version:(await snap(stayInfra)).version};
  await call(stay,'stayready.request.submit',args); // Simulated lost acknowledgement: ignore the first result.
  const retry=await call(stay,'stayready.request.submit',args);check('unknown-outcome retry deduplicates the real write',retry.status==='committed'&&retry.duplicate===true);
  const result=await call(stay,'stayready.inspect'),request=result.view.requests.find(r=>r.id===retry.hotel_request_id);
  check('persisted downstream request has actual person and note fact',request.conditions.person_ids[0]===contact.item.person_id&&request.conditions.meal_request===parsed.meal_request&&request.status==='submitted');
  check('source read and local submit do not imply hotel confirmation',result.view.commitments.every(c=>c.need_id!==need.id));
  const contactsAfter=await snap(contactsInfra),notesAfter=await snap(notesInfra);
  assert.deepEqual(contactsAfter.snapshot.data,contactsBefore.snapshot.data);assert.deepEqual(notesAfter.snapshot.data,notesBefore.snapshot.data);assert.deepEqual(contactsAfter.version,contactsBefore.version);assert.deepEqual(notesAfter.version,notesBefore.version);
  check('read-only dependencies retain exact business state and version');
  report.sources=[{app:'contacts',account:contactSeed.account_id,id:contact.item.id,version:contact.version,before_sha256:hash(contactsBefore.snapshot.data),after_sha256:hash(contactsAfter.snapshot.data)},{app:'notes',account:noteSeed.account_id,id:note.item.id,version:note.version,before_sha256:hash(notesBefore.snapshot.data),after_sha256:hash(notesAfter.snapshot.data)}];
  report.downstream={account:base.account_id,request_id:request.id,conditions:request.conditions,source_provenance:source.provenance,version:result.version};
  const beforeFailure=await snap(stayInfra);
  check('missing source is visible',(await call(notes,'notes.get',{id:'missing-note'})).status==='not_found');
  const deniedInfra=await client('notes','infra','denied-dependency'),deniedAgent=await client('notes','agent','denied-dependency');
  const denialSnapshot=await snap(deniedInfra),policies=clone(denialSnapshot.snapshot.policies);for(const p of Object.values(policies)){p.allow=['notes.list'];p.constraints={};}
  check('restricted real Notes policy loads',(await load(deniedInfra,noteSeed,identity('notes'),policies)).status==='ready');
  check('denied dependency read is explicit',(await call(deniedAgent,'notes.get',{id:'note-breakfast-jamie'})).status==='permission_denied');
  const afterFailure=await snap(stayInfra);assert.deepEqual(beforeFailure.snapshot.data,afterFailure.snapshot.data);assert.deepEqual(beforeFailure.version,afterFailure.version);check('failed dependency reads cause no downstream operation or state write');
  // No installed receiver is fabricated; exercise real registry rejection.
  for(const variant of ['missing','incompatible']){
   const registry=JSON.parse(fs.readFileSync(prepared.registry,'utf8'));
   if(variant==='missing')registry.apps=registry.apps.filter(a=>a.app_id!=='contacts');else registry.apps.find(a=>a.app_id==='contacts').version='99.0.0';
   const file=path.join(prepared.root,variant+'.json');fs.writeFileSync(file,JSON.stringify(registry));
   let rejected=false;try{await client('contacts','agent',variant,file);}catch(e){rejected=true;report[variant+'_dependency_error']=e.message;}
   check(variant+' dependency cannot be silently substituted',rejected);
  }
  report.passed=true;
 }catch(e){report.error=e.stack||e.message;process.exitCode=1;}finally{await Promise.allSettled(clients.map(c=>c.close()));prepared.cleanup();fs.writeFileSync(path.join(output,'dependencies.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(output,'dependency-trace.json'),JSON.stringify(trace,null,2)+'\n');}
 console.log(JSON.stringify({passed:report.passed,checks:checks.length,error:report.error,report:path.join(output,'dependencies.json')},null,2));
}
if(require.main===module)main();
module.exports={main};
