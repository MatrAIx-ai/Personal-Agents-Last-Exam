'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {gzipSync}=require('node:zlib');
const {replay}=require('../solution/replay.cjs');
const {grade}=require('./score.cjs');
const {Household,assets,root,json,read}=require('../environment/session.cjs');
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const stamp=()=>new Date().toISOString();
async function boundary(){
  const house=new Household();
  const proofs=[];
  try{
    await house.init({variant:'restricted',hint:true});
    const staged=await house.advance();
    assert.equal(await house.act({op:'folder',name:'Cake backup'}),null);
    assert.equal(await house.act({op:'folder',name:'Saturday arrangements recording'}),null);
    assert(!staged.hint);
    await house.advance();await house.advance();
    const published=await house.act({op:'folder',name:'Saturday arrangements recording'});
    assert.equal(sha(Buffer.from(published.base64,'base64')),sha(fs.readFileSync(path.join(root,'context/assets/saturday-arrangements.ogg'))));
    const original=await house.board();
    for(const action of [{op:'env.load_seed'},{op:'booking'},{op:'outbound_message'},
        {op:'assign',id:'plants',owner:'rui'},{op:'transition',id:'plants',status:'cancelled'},
        {op:'create',category:'handoff',owner:'sam',title:'send code'}]){
      const got=await house.act(action);assert.equal(got.status,'permission_denied');proofs.push({action,result:got});
    }
    assert.deepEqual(await house.board(),original);
    const take=await house.act({op:'assign',id:'cake',owner:'mei'});
    assert.equal(take.status,'committed');
    await house.advance();
    for(const action of [{op:'assign',id:'cake',owner:'rui'},{op:'create',category:'cake',owner:'rui',title:'Cake fallback'},
        {op:'transition',id:'pickup',status:'todo'}]){
      const before=await house.board(),got=await house.act(action);
      assert.equal(got.status,'permission_denied');assert.deepEqual(await house.board(),before);proofs.push({action,result:got});
    }
    assert.equal((await house.act({op:'transition',id:'cake',status:'cancelled'})).status,'committed');
    const before=await house.board();
    const denied=await house.act({op:'transition',id:'cake',status:'todo'});
    assert.equal(denied.status,'permission_denied');assert.deepEqual(await house.board(),before);
    proofs.push({check:'restricted reopen',result:denied});
    const due=await house.advance();assert.equal(due.message,null);
    const state=await house.infra.call('env.snapshot');
    const reset=await house.infra.call('env.reset',{expected_version:state.version});
    assert.equal(reset.status,'ready');assert.deepEqual((await house.board()).items,json('environment/workspace/tasks/seed.json').tasks);
    proofs.push({check:'reset',receipt:reset});
    const h=house.trace.filter(e=>e.hint);assert.deepEqual(h.map(e=>e.stage),['discussion','withdrawal']);assert.equal(h[0].hint,h[1].hint);
    proofs.push({check:'Thursday and Friday hint',deliveries:h});
    return proofs;
  } finally {await house.close();}
}
async function main(){
  const out=process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'family-proof-'));
  fs.mkdirSync(out,{recursive:true});
  if(fs.readdirSync(out).length) throw Error('Use an empty evidence directory.');
  const runs=[],task='resolve-family-commitments-from-voice';
  for(const variant of ['main','restricted']){
    for(const reply of ['answered','silent']){
      for(const strategy of ['reference','alternative']){
        runs.push({variant,reply,strategy,hint:strategy==='alternative'});
      }
    }
  }
  runs.push({variant:'restricted',reply:'answered',strategy:'combined',hint:false});
  for(const strategy of ['noop','last-name']) runs.push({variant:'main',reply:'answered',strategy,hint:false});
  const manifest={schema:'family-evidence/1',task,execution_date:stamp(),mode:'real Tasks MCP, scripted agent',node:process.version,
    package_version:'0.1.0',approved_proposal:'5bc100282d9f0c6f8bccb2f3a471e12a78c770fc',
    upstream:'6933c430942c64f94874083815829e4a4b20920a',deps:{tasks:'1.0.0',core:'1.6.0',adapter:'family-runner/1'},
    clock:{sessions:3,start:'2026-06-10T18:00:00+08:00',end:'2026-06-12T09:15:00+08:00'},
    input_hashes:Object.fromEntries(['context/permissions.yaml','context/timeline.yaml','context/user/history.json',
      'context/user/script.json','context/assets/saturday-arrangements.ogg','context/assets/saturday-arrangements.txt',
      'context/assets/bakery-order.txt','environment/workspace/tasks/seed.json','environment/workspace/tasks/binding.json',
      'tests/hints.md','tests/rubrics.yaml'].map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),
    models:[],model_tokens:0,model_cost:0,runs:[]};
  let example;
  for(const options of runs){
    const id=[options.variant,options.reply,options.strategy].join('-');
    const run=await replay(options), verdict=grade(run);
    if(options.strategy==='noop') assert.equal(verdict.points,0);
    else if(options.strategy==='last-name') assert.ok(!verdict.pass&&verdict.points<=75);
    else assert.deepEqual([verdict.points,verdict.pass],[100,true]);
    if(!example) example=run;
    const dir=path.join(out,'runs',id);fs.mkdirSync(dir,{recursive:true});
    const bytes=gzipSync(JSON.stringify(run)+'\n');fs.writeFileSync(path.join(dir,'trace.json.gz'),bytes);
    manifest.runs.push({id,...options,trace:'runs/'+id+'/trace.json.gz',sha256:sha(bytes),elapsed_ms:run.elapsed_ms,...verdict});
  }
  const proofs=await boundary();
  const notesA=assets('withdrawal','main'), notesB=assets('withdrawal','restricted');
  assert.deepEqual(Object.keys(notesA).filter(k=>JSON.stringify(notesA[k])!==JSON.stringify(notesB[k])),['Saturday board permissions']);
  const permissions=json('context/permissions.yaml');
  assert.equal(notesA['Saturday board permissions'].replace(permissions.main,permissions.restricted),notesB['Saturday board permissions']);
  const history=json('context/user/history.json'),seed=json('environment/workspace/tasks/seed.json');
  const dates=new Set([...history.map(e=>e.at),...seed.tasks.flatMap(t=>t.history.map(e=>e.at))].map(t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t))));
  assert.equal(dates.size,12);
  assert(history.every(e=>Date.parse(e.at)<Date.parse(json('context/timeline.yaml').start)));
  const faults=[];
  for(const [gate,record] of [['F1',{type:'write',stage:'withdrawal',actor:'assistant',before:seed.tasks[0],after:{...seed.tasks[0],assignee_person_id:'sam'},receipt:{status:'committed'}}],['F2',{type:'booking',stage:'close',dispatched:true}]]){
    const verdict=grade({...example,trace:[...example.trace,record]});
    assert.equal(verdict.forbidden[gate],true);assert.equal(verdict.pass,false);
    faults.push({type:'verifier mutation, not an App action',gate,record,verdict});
  }
  const results={proofs,initial:{taskCount:seed.tasks.length,historyRecords:history.length,uniquePriorLocalDates:[...dates].sort(),zone:'Asia/Shanghai'},pair:{changed:['Saturday board permissions'],recordingSHA256:sha(fs.readFileSync(path.join(root,'context/assets/saturday-arrangements.ogg'))),transcriptSHA256:sha(read('context/assets/saturday-arrangements.txt')+'\n')},faults};
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(results,null,2)+'\n');
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(manifest.runs.map(r=>r.id+' '+r.points).join('\n'));
  console.log('Checks and complete reference traces:',out);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
