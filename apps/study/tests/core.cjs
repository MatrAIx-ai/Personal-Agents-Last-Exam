'use strict';
const path=require('node:path'), fs=require('node:fs'), os=require('node:os'), assert=require('node:assert/strict');
const runtime=process.env.PALE_RUNTIME_ROOT||path.resolve(__dirname,'../../../runtime');
const {prepare}=require(path.join(runtime,'prepare.cjs'));
const {Client}=require(path.join(runtime,'client.cjs'));
const data=require('../fixtures/minimal.json');
const day0='2027-01-08T00:00:00+08:00';
async function run(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-run-'));
  const app=path.resolve(__dirname,'..');const assembly=prepare(app);
  const clients=[];
  const connect=(role,runId='study-demo')=>{
    const x=new Client('study',role,runId,root,'study-evidence',{registry:assembly.registry,...(role==='infra'?{initialProfile:'sandbox'}:{})});clients.push(x);return x;
  };
  try {
    const i=connect('infra'), a=connect('agent'), isolated=connect('agent','isolated'), isolatedInfra=connect('infra','isolated');
    await Promise.all(clients.map(x=>x.initialize()));
    await isolatedInfra.call('env.snapshot');
    const snap=()=>i.call('env.snapshot');
    const baseline=await snap();
    const load=await i.call('env.load_seed',{data,virtual_now:day0,expected_version:baseline.version,bundle:baseline.snapshot.resources.bundle,request_id:'load-study'});
    assert.equal(load.status,'ready');
    const q0=await a.call('study.get_queue');assert.equal(q0.day,0);
    assert.deepEqual(q0.cards.map(x=>x.id),['C1','C4','C2']);
    assert.equal((await a.call('study.get_plan')).plan.daily_limit,3);
    assert.equal((await a.call('env.snapshot')).status,'permission_denied');
    const reveal=await a.call('study.reveal',{card_id:'C1'});assert.equal(reveal.answer,'estación de tren');
    const args={card_id:reveal.card_id,card_version:reveal.card_version,review_day:reveal.review_day,rating:'Good',request_id:'one',expected_version:reveal.version};
    const receipt=await a.call('study.record_review',args);
    assert.equal(receipt.status,'committed');assert.equal(receipt.review.due_day,3);
    assert.equal((await a.call('study.record_review',args)).duplicate,true);
    assert.equal((await a.call('study.record_review',{...args,rating:'Again'})).status,'idempotency_conflict');
    assert.equal((await a.call('study.record_review',{...args,request_id:'stale'})).status,'stale_version');
    assert.equal((await a.call('study.record_review',{...args,request_id:'one-more',expected_version:receipt.version})).status,'not_eligible');
    const resumed=connect('agent');await resumed.initialize();
    assert.equal((await resumed.call('study.get_history')).history.length,1);
    assert.equal((await isolated.call('study.get_history')).history.length,0);
    const advanced=await i.call('env.advance_time',{expected_version:receipt.version,request_id:'day2',virtual_now:'2027-01-10T00:00:00+08:00'});
    assert.equal(advanced.status,'committed');
    assert.equal((await a.call('study.get_queue')).day,2);
    assert.equal((await a.call('study.get_history')).history.length,1);
    assert.equal((await a.call('study.record_review',{...args,request_id:'old-day',expected_version:advanced.version})).status,'stale_review_day');
    const reset=await i.call('env.reset',{expected_version:advanced.version,profile:'scenario'});assert.equal(reset.status,'ready');
    const state=(await snap()).snapshot;
    assert.deepEqual(state.data,data);assert.equal(state.virtual_now,day0);
    assert.equal((await a.call('study.record_review',{...args,expected_version:reset.version})).status,'permission_denied');
    const second=await i.call('env.reset',{expected_version:reset.version});assert.equal(second.status,'ready');
    const restored=(await snap()).snapshot;
    assert.deepEqual(restored.data,data);assert.equal(restored.virtual_now,day0);
    assert.deepEqual((await a.call('study.get_queue')).cards,q0.cards);
    console.log(JSON.stringify({app:'study',core_api:'1.2.0',seed_clock:day0,ordered_queue:q0.cards.map(c=>c.id),committed:receipt.review,duplicate_safe:true,stale_and_denied_safe:true,isolated:true,unchanged_on_clock_advance:true,repeat_resets:2},null,2));
  } finally {await Promise.all(clients.map(x=>x.close()));assembly.cleanup();fs.rmSync(root,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
