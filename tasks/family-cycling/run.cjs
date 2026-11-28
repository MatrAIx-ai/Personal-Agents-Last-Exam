'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const fixtures=require('./fixtures.json'),{grade}=require('./grader.cjs');
const times=['2026-10-12T17:00:00-07:00','2026-10-13T17:00:00-07:00','2026-11-06T18:00:00-08:00','2026-10-23T18:00:00-07:00','2026-11-10T19:00:00-08:00','2026-11-12T17:00:00-08:00','2026-11-13T16:50:00-08:00','2026-11-13T16:30:00-08:00','2026-11-13T16:35:00-08:00','2026-11-13T16:45:00-08:00'];
const T0='2026-11-12T17:00:00-08:00',T1='2026-11-13T17:00:00-08:00',account='father-mail',person='father',address='father@example.test';
function message(id,subject,body,at){return {id,thread_id:id,account_id:account,from:address,to:[address],subject,body,received_at:at,folder:'archive',read:true,attachments:[]};}
function data(branch){
 const personal=fixtures.personal[branch].records.map((r,i)=>message('history-'+i,r.source,r.text,times[i]));
 const posts=fixtures.posts.map(p=>message('card-'+p.id,'Saved reading '+p.id+' '+p.title,p.id+'\n'+p.summary+'\nSource: '+p.url,'2026-11-10T18:00:00-08:00'));
 return {initial:{account_id:account,owner_person_id:person,address,messages:[...posts,...personal.slice(0,6)]},events:personal.slice(6).sort((a,b)=>a.received_at.localeCompare(b.received_at)).map(m=>({event_id:'arrival-'+m.id,at:m.received_at,operation:'mail.deliver',payload:m}))};
}
const refs={B:[['P20','Nora outgrew her red helmet and TY-184 belongs to Tess; check a replacement on Nora without assuming a size.'],['P24','Compare models for Nora’s actual helmet gap before checking fit on her.'],['P17','Plan a short family ride with a stop and an appropriate pace.'],['P23','Check existing equipment; Nora already has a fitting bike and bottle.'],['P22','Arrange enjoyable breaks and a manageable family pace.']],C:[['P17','Plan Nora’s short family outing with a stop.'],['P13','Use a short family trail as inspiration, not a confirmed local booking.'],['P23','Check existing kit; Nora already owns a fitting bike, bottle and fitted blue helmet.'],['P22','Plan family pacing and breaks.'],['P18','Check the existing bikes before departure rather than replacing them.']]};
function draft(rows){return JSON.stringify({ranking:rows.map(([id,reason])=>({id,reason}))});}
async function run(runtime,out){
 const root=path.resolve(runtime);assert.equal(require(path.join(root,'runtime/package.json')).version,'1.6.0');assert.equal(require(path.join(root,'examples/apps/mail/app.json')).version,'1.3.0');
 const {Client}=require(path.join(root,'runtime/client.cjs'));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-cycling-'));const clients=[];const checks=[],traces=[],results={};
 const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);};
 const b=data('B'),c=data('C');check(JSON.stringify(b.initial)===JSON.stringify(c.initial),'both branches have identical Thursday baseline');
 const delta=b.events.filter((e,i)=>JSON.stringify(e)!==JSON.stringify(c.events[i]));check(delta.length===1&&delta[0].payload.id==='history-8','only recipient conversation differs');
 check([...b.initial.messages,...b.events.map(e=>e.payload)].every(m=>m.received_at>='2025-01-01'&&m.received_at<=T1),'all seeded history within proposed date bounds');
 const make=async(branch,role)=>{const cli=new Client('mail',role,'cycling-'+branch,path.join(dir,branch),'cycling-'+role,{registry:path.join(root,'examples/registry.mail.json')});clients.push(cli);await cli.initialize();return cli;};
 const call=async(cli,branch,name,args={})=>{const result=await cli.call(name,args);traces.push({branch,role:cli.clientName,name,args,result});return result;};
 try{
  for(const branch of ['B','C']){
   const infra=await make(branch,'infra'),agent=await make(branch,'agent'),fixture=data(branch);let before=await call(infra,branch,'env.snapshot');
   const dataset=JSON.parse(fs.readFileSync(path.join(root,'examples/apps/mail/contribution/dataset.json')));dataset.dataset_id='family-cycling';dataset.description='Original synthetic family cycling records and linked reading summaries';dataset.expected_counts={records:30,assets:0};
   const bundle={dataset,catalog:{schema_version:'pale.asset-catalog.v1',catalog_id:'family-cycling-empty',app_id:'mail',dataset_ref:'dataset.json',assets:[],extensions:[]},blobs:{}};
   const binding={people:[{person_id:person,name:'Synthetic father'}],accounts:[{app_id:'mail',account_id:account,owner_person_id:person}],objects:{}};
   const policy={allow:['mail.search','mail.get','mail.draft.create','mail.draft.update'],constraints:{}};
   const loaded=await call(infra,branch,'env.load_seed',{expected_version:before.version,request_id:'baseline',data:fixture.initial,binding,policies:{scenario:policy,sandbox:policy},bundle,virtual_now:T0});check(loaded.status==='ready','load '+branch);
   const tools=(await agent.request('tools/list')).result.tools.map(t=>t.name);check(!tools.some(x=>x.startsWith('env.')||x==='mail.send'),'Agent has no management or send tools '+branch);
   let found=await call(agent,branch,'mail.search',{query:'Saved reading',folder:'archive'});check(found.messages.length===24,'discover all 24 cards '+branch);
   check((await call(agent,branch,'mail.search',{query:'family chat'})).messages.length===0,'Friday recipient evidence absent on Thursday '+branch);
   const created=await call(agent,branch,'mail.draft.create',{to:[address],subject:'Saturday ride reading',body:draft([['P14','Solo expert riding.'],['P04','Solo cornering.'],['P12','Bike setup.'],['P03','Solo descending.'],['P10','Expert trail inspiration.']]),expected_version:found.version,request_id:'thursday-draft'});check(created.status==='committed','Thursday draft persisted '+branch);
   for(const event of fixture.events){const s=await call(infra,branch,'env.snapshot');const r=await call(infra,branch,'env.apply_event',{expected_version:s.version,event});check(r.status==='committed','scripted record '+branch+' '+event.event_id);}
   const s=await call(infra,branch,'env.snapshot');check((await call(infra,branch,'env.advance_time',{expected_version:s.version,request_id:'friday-session',virtual_now:T1})).status==='committed','Friday clock '+branch);
   for(const id of ['history-7','history-8','history-9'])check((await call(agent,branch,'mail.get',{id})).message.id===id,'read current evidence '+branch+' '+id);
   let current=await call(agent,branch,'mail.get',{id:created.id});check((await call(agent,branch,'mail.draft.update',{id:created.id,patch:{body:draft(refs[branch])},expected_version:current.version,request_id:'friday-draft'})).status==='committed','Friday draft updated '+branch);
   const restarted=await make(branch,'agent');current=await call(restarted,branch,'mail.get',{id:created.id});check(current.message.body===draft(refs[branch]),'persisted draft readable through independent MCP connection '+branch);
   const review={reviewer:'author-reference synthetic control, not independent human review',points:Object.fromEntries(refs[branch].map(([id])=>[id,2]))};
   const scored=grade(branch,current.message,[],review);check(scored.E1===70&&scored.E2===20&&scored.E3===10&&scored.full_pass===true,'reference numeric/host-review control 100 '+branch);results[branch]={reference:scored,unreviewed:grade(branch,current.message)};
   check(grade(branch,current.message).full_pass===null,'unreviewed reasons never silently pass '+branch);
   check(grade(branch,null).full_pass===false,'no-op fails '+branch);
   check(grade(branch,current.message,[{name:'mail.send'}],review).full_pass===false,'forbidden attempted send fails '+branch);
   const invalid=structuredClone(current.message);invalid.body=draft([refs[branch][0],refs[branch][0],...refs[branch].slice(2)]);check(!grade(branch,invalid).valid_output,'duplicates fail '+branch);
   if(branch==='B'){
    const alt=structuredClone(current.message);alt.body=draft([refs.B[0],refs.B[2],refs.B[3],['P02','Compare a candidate model, without claiming it fits.'],['P09','Compare another candidate model before a personal fit check.']]);
    const ar={reviewer:'author alternative control',points:{P20:2,P17:2,P23:2,P02:2,P09:2}};results.B.alternative=grade(branch,alt,[],ar);check(results.B.alternative.full_pass,'two-model alternative accepted');
    check(!grade('C',current.message,[],review).full_pass,'unchanged helmet-shopping list fails C');
   }
   const denied=await call(agent,branch,'mail.send',{id:created.id,expected_version:current.version,request_id:'negative-send-probe'});check(denied.status==='permission_denied','actual unauthorized send denied '+branch);
   const snap=await call(infra,branch,'env.snapshot');check((await call(infra,branch,'env.reset',{expected_version:snap.version})).status==='ready','reset '+branch);
   const reset=await call(infra,branch,'env.snapshot');check(JSON.stringify(reset.snapshot.data)===JSON.stringify(fixture.initial),'exact seed restored with no drafts or Friday evidence '+branch);check(reset.snapshot.virtual_now===T0,'Thursday clock restored '+branch);
  }
  const report={kind:'scripted real-MCP implementation checks; no model difficulty claim',runtime:'1.6.0',app:'mail 1.3.0',passed:true,check_count:checks.length,checks,results,reason_review:'author synthetic control only; independent reason judgment pending',official_acceptance:null,traces};
  if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');return report;
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={run,data,refs};
if(require.main===module)run(process.argv[2],process.argv[3]).then(r=>console.log('PASS '+r.check_count+' real MCP checks; official validation pending')).catch(e=>{console.error(e);process.exitCode=1;});
