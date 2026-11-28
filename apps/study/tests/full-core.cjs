'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const rt=process.env.PALE_RUNTIME_ROOT;
if(!rt)throw Error('PALE_RUNTIME_ROOT must identify the approved public runtime.');
const {prepare}=require(path.join(rt,'prepare.cjs')), {Client}=require(path.join(rt,'client.cjs'));
async function main(){
 const env=prepare(path.resolve(__dirname,'..')),state=path.join(env.root,'full-core');
 const opts={registry:env.registry}, run='study-full';
 const infra=new Client('study','infra',run,state,'study-infra',{...opts,initialProfile:'sandbox'});
 const agent=new Client('study','agent',run,state,'study-agent',opts);
 const assertStatus=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r));return r;};
 try {
  await infra.initialize();await agent.initialize();
  const snap=()=>infra.call('env.snapshot');
  const before=await snap();
  const call=(op,args={})=>agent.call('study.'+op,args);
  const write=async(op,args,id,version)=>
   call(op,{...args,request_id:id,expected_version:version??(await snap()).version});
  assert.equal((await call('list_cards')).cards.length,36);
  const preview={deck_ids:['D1','D2'],daily_limit:3,new_limit:1,target_day:0};
  const plan=assertStatus(await call('preview_plan',preview),'ok');
  assert.equal(plan.capacity.missing_slots,1);
  assert.deepEqual((await snap()).snapshot.data,before.snapshot.data);
  const saved=assertStatus(await write('save_plan',preview,'plan-write',plan.version),'committed');
  assertStatus(await write('save_plan',preview,'stale-plan',plan.version),'stale_version');
  const scope=(await call('get_card',{card_id:'C2'})).card;
  const changed=assertStatus(await write('save_card',{card_id:'C2',deck_id:'D1',prompt:'Window seat',answer:'asiento junto a la ventana'},'edit-card'),'committed');
  assert.equal(changed.card.card_version,scope.card_version+1);
  assertStatus(await write('set_suspension',{card_id:'C2',suspended:true},'suspend'),'committed');
  assert.ok(!(await call('get_queue')).cards.find(x=>x.id==='C2'));
  assertStatus(await write('set_suspension',{card_id:'C2',suspended:false},'restore'),'committed');
  assertStatus(await write('set_session',{card_id:'C2',paused:true},'pause'),'committed');
  assert.equal((await call('get_queue')).session.paused,true);
  assertStatus(await call('reveal',{card_id:'C2'}),'session_paused');
  assertStatus(await write('set_session',{card_id:'C2',paused:false},'resume'),'committed');
  const reveal=assertStatus(await call('reveal',{card_id:'C2'}),'ok');
  const event={event_id:'correct-1',at:'2027-01-08T09:00:00+08:00',operation:'study.correct_card',payload:{card_id:'C2',expected_revision:reveal.card_version,answer:'asiento junto a la ventanilla'}};
  const corrected=assertStatus(await infra.call('env.apply_event',{expected_version:reveal.version,event}),'committed');
  assert.equal((await infra.call('env.apply_event',{expected_version:reveal.version,event})).duplicate,true);
  assertStatus(await infra.call('env.apply_event',{expected_version:corrected.version,event:{...event,event_id:'stale-correction',payload:{...event.payload,answer:'never'}}}),'stale_card');
  assert.equal((await call('get_card',{card_id:'C2'})).card.answer,event.payload.answer);
  const rateArgs={card_id:'C2',card_version:reveal.card_version,review_day:0,rating:'Good'};
  assertStatus(await write('record_review',rateArgs,'old-form',corrected.version),'stale_card');
  const after=assertStatus(await call('reveal',{card_id:'C2'}),'ok');
  const rated=assertStatus(await write('record_review',{...rateArgs,card_version:after.card_version},'fresh-form',after.version),'committed');
  const undid=assertStatus(await write('undo_review',{review_id:rated.review.id},'undo',rated.version),'committed');
  assert.equal(undid.new_remaining,1);
  assert.equal((await write('undo_review',{review_id:rated.review.id},'undo',rated.version)).duplicate,true);
  assertStatus(await write('undo_review',{review_id:rated.review.id},'undo-again',undid.version),'not_undoable');
  const target={event_id:'target-1',at:'2027-01-08T10:00:00+08:00',operation:'study.change_target',payload:{plan_id:'P1',expected_revision:saved.plan.revision,target_day:1}};
  const preTarget=(await snap()).snapshot.data;
  const set=assertStatus(await infra.call('env.apply_event',{expected_version:undid.version,event:target}),'committed');
  assert.equal((await call('get_plan')).plan.daily_limit,3);
  assert.equal((await call('get_plan')).notices.length,2);
  const postTarget=(await snap()).snapshot.data;
  assert.deepEqual(postTarget.cards,preTarget.cards);assert.deepEqual(postTarget.history,preTarget.history);
  const reset=assertStatus(await infra.call('env.reset',{expected_version:set.version,profile:'scenario'}),'ready');
  const resetSnap=await snap();
  assert.deepEqual(resetSnap.snapshot.data,before.snapshot.data);
  assert.equal(resetSnap.snapshot.virtual_now,before.snapshot.virtual_now);
  assertStatus(await write('save_plan',preview,'denied',reset.version),'permission_denied');
  assert.deepEqual((await snap()).snapshot.data,before.snapshot.data);
  // Load a second reproducible scenario with historical evidence (no fresh ratings are invented).
  const historical={...before.snapshot.data,...require('../fixtures/history-scenario.json')};
  const loaded=assertStatus(await infra.call('env.load_seed',{data:historical,virtual_now:before.snapshot.virtual_now,
    expected_version:reset.version,bundle:resetSnap.snapshot.resources.bundle,request_id:'historical-fixture'}),'ready');
  const history=assertStatus(await call('get_history'),'ok');
  assert.deepEqual(history.history,historical.history);
  assert.equal(history.undoable_review_id,null);
  assertStatus(await infra.call('env.reset',{expected_version:loaded.version}),'ready');
  assert.deepEqual((await snap()).snapshot.data,historical);
  console.log('PASS real Core: synthetic plan preview/save/denial, card edit/suspension, persisted pause/resume, correction/replay/stale, confirm rating/undo, deadline/caps/notice and reset.');
 }finally{await Promise.all([infra.close(),agent.close()]);env.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
