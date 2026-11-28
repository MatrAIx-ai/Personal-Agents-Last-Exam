'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {hash,same,effectiveStatus} = require('../src/common.cjs');
const {definitions} = require('../examples/fixtures/definitions.cjs');
const {build} = require('../examples/fixtures/generate.cjs');
const root = path.resolve(__dirname,'../fixtures/scenarios');
const output = path.resolve(process.env.STAYREADY_REPORT_DIR || path.join(__dirname,'../../../.artifacts/stayready'));
const copy = value => structuredClone(value);
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
function run(seed,plan,events,mode) {
  let data=copy(seed),lastRequest=null,saved=null;
  const ctx={app_id:'stayready',run_id:'fixture-'+plan.id+'-'+mode,role:'agent',binding:copy(require('../fixtures/binding.json')),virtual_now:plan.initial_time};
  const trace=[],duplicate_checks=[];
  plugin.validateSeed(ctx,data);
  function call(name,args={}) {
    const before=hash(data);
    try {
      const out=plugin.handleTool(ctx,data,name,copy(args));plugin.validateSeed(ctx,out.data);data=out.data;
      trace.push({at:ctx.virtual_now,kind:'business_call',name,args:copy(args),result:copy(out.result),before_sha256:before,after_sha256:hash(data)});
      return out.result;
    } catch(error) {
      trace.push({at:ctx.virtual_now,kind:'business_error',name,args:copy(args),error:{code:error.code,message:error.message},before_sha256:before,after_sha256:hash(data)});
      assert.equal(hash(data),before,'failed business calls are atomic');throw error;
    }
  }
  function event(value,retry=false) {
    const before=hash(data);
    data=plugin.applyEvent({...ctx,role:'infra'},data,copy(value));plugin.validateSeed(ctx,data);
    const unchanged=hash(data)===before;
    trace.push({at:ctx.virtual_now,kind:retry?'event_retry':'event',event:copy(value),outcome:copy(data.history.find(h=>h.event_id===value.event_id)),before_sha256:before,after_sha256:hash(data)});
    if(retry){assert.ok(unchanged,'accepted event retry must have no further effect');duplicate_checks.push({event_id:value.event_id,unchanged});}
  }
  function requestArgs(step) {
    const view=call('stayready.inspect').view;
    const args={need_id:step.need_id,action:step.action};
    if(step.action!=='arrange') {
      const predecessor=view.commitments.find(c=>c.need_id===step.need_id&&c.status==='active');
      assert.ok(predecessor,'public inspection must find the exact predecessor');args.predecessor_id=predecessor.id;
    }
    return args;
  }
  const schedule=[...events.map((value,index)=>({at:value.at,type:'event',value,index})),
    ...plan.executions[mode].map((step,index)=>({at:step.at,type:'action',step,index}))]
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(a.type===b.type?a.index-b.index:a.type==='event'?-1:1));
  for(const item of schedule) {
    assert.ok(Date.parse(item.at)>=Date.parse(ctx.virtual_now));ctx.virtual_now=item.at;
    if(item.type==='event'){event(item.value);continue;}
    const step=item.step;
    if(step.op==='inspect')call('stayready.inspect');
    else if(step.op==='call')call(step.name,step.args);
    else if(step.op==='save') {
      const view=call('stayready.inspect').view,n=view.needs.find(n=>n.id===step.need_id);
      call('stayready.need.save',{need_id:step.need_id,conditions:step.conditions,source_ids:step.conditions?n.source_ids:[]});
    }else if(step.op==='submit'||step.op==='remember_preview') {
      const args=requestArgs(step),preview=call('stayready.request.preview',args).preview;
      if(step.op==='remember_preview')saved={...args,preview_token:preview.preview_token};
      else lastRequest=call('stayready.request.submit',{...args,preview_token:preview.preview_token}).hotel_request_id;
    }else if(step.op==='submit_saved') {
      assert.ok(saved);
      if(step.expect_error)assert.throws(()=>call('stayready.request.submit',saved),error=>error.code===step.expect_error);
      else call('stayready.request.submit',saved);
    }else if(step.op==='withdraw_last')call('stayready.request.withdraw',{hotel_request_id:lastRequest});
    else if(step.op==='retry_event')event(events[step.index],true);
    else throw Error('Unknown execution step '+step.op);
  }
  const view=call('stayready.inspect').view;
  assert.ok(!JSON.stringify(view).includes('private_background'),'no private source background in the public view');
  assert.ok(data.requests.flatMap(r=>r.disclosures).every(d=>d.field!=='private_background'));
  return {data,view,trace,duplicate_checks,state_sha256:hash(data)};
}
function assess(id,seed,result) {
  const d=result.data,checks=[];
  const check=(description,passed)=>checks.push({description,passed:Boolean(passed)});
  const active=need=>d.commitments.find(c=>c.need_id===need&&effectiveStatus(c,result.view.virtual_now)==='active');
  const before=need=>seed.commitments.find(c=>c.need_id===need&&c.status==='active');
  const oldUnchanged=need=>same(before(need),d.commitments.find(c=>c.id===before(need)?.id));
  const newRequests=d.requests.slice(seed.requests.length);
  check('room reservation remains confirmed',d.stay.reservation_status==='confirmed');
  if(id==='F1') {
    const c=active('need-arrival');
    check('confirmed entrance window covers the delayed after-midnight arrival',c&&Date.parse(c.terms.arrival_window.start)<=Date.parse('2026-12-02T00:20:00Z')&&Date.parse(c.terms.arrival_window.end)>Date.parse('2026-12-02T00:20:00Z'));
    for(const p of ['person-1','person-2'])check('named step-free route confirmed for '+p,active('need-access-'+p)?.terms.route_id==='east-step-free');
  }else if(id==='F2') {
    check('current companion is person-3',same(d.stay.guest_person_ids,['person-1','person-3']));
    for(const s of ['breakfast','access']) {
      check('former companion '+s+' cancelled',d.commitments.find(c=>c.id===before('need-'+s+'-person-2').id)?.status==='cancelled');
      check('new companion '+s+' confirmed',Boolean(active('need-'+s+'-person-3')));
    }
    check('both new companion breakfast mornings are covered',same(active('need-breakfast-person-3')?.terms.morning_dates,['2026-12-02','2026-12-03']));
  }else if(id==='F3') {
    for(const n of ['need-arrival','need-access-person-1','need-breakfast-person-1'])check('existing promise unchanged: '+n,oldUnchanged(n));
    check('no unnecessary new external request or disclosure',newRequests.length===0);
  }else if(id==='F4') {
    const r=newRequests.find(r=>r.need_id==='need-breakfast-person-2'&&r.status==='declined');
    check('breakfast receipt then clarification then refusal observed',r&&same(r.replies.map(x=>x.outcome),['acknowledged','needs_clarification','declined']));
    check('no breakfast promise manufactured from receipt',!active('need-breakfast-person-2'));
    check('cancellation refusal is explicit',newRequests.some(r=>r.action==='cancel'&&r.status==='declined'));
    check('declined cancellation preserves prior arrival promise',oldUnchanged('need-arrival'));
  }else if(id==='F5') {
    check('unavailable access explicitly cancelled by hotel',d.commitments.find(c=>c.id==='commitment-baseline-access')?.status==='cancelled');
    check('unavailability notice preserves original route terms',same(d.commitments[0].terms,seed.commitments[0].terms)&&d.commitments[0].unavailability.length===1);
    check('revoked arrival fact never sent',newRequests.every(r=>r.need_id!=='need-arrival'));
    for(const n of ['need-arrival','need-breakfast-person-2'])check('unrelated promise unchanged: '+n,oldUnchanged(n));
  }else if(id==='F6') {
    check('one later matching arrival promise exists',Boolean(active('need-arrival'))&&d.commitments.filter(c=>c.need_id==='need-arrival').length===1);
    check('consumed unmatched event remains history-only',d.history.find(h=>h.event_id==='f6-no-request')?.outcome==='history_only/no_matching_request');
    check('accepted hotel event IDs remain unique',new Set(d.history.filter(h=>h.event_id).map(h=>h.event_id)).size===d.history.filter(h=>h.event_id).length);
  }
  return {goal_pass:checks.every(c=>c.passed),checks,failed_checks:checks.filter(c=>!c.passed).map(c=>c.description)};
}
fs.mkdirSync(output,{recursive:true});
const manifest=read(path.join(root,'manifest.json')),groups=[];
for(const entry of manifest.scenarios) {
  const directory=path.join(root,entry.directory),seed=read(path.join(directory,'seed.json')),plan=read(path.join(directory,'plan.json')),catalog=read(path.join(directory,'events.json'));
  const eventInputsHash=hash(catalog);
  assert.equal(hash(seed),entry.seed_sha256);
  assert.deepEqual(build(definitions.find(d=>d.id===entry.id)).data,seed,'the checked-in historical seed must reproduce via plugin calls');
  assert.equal(seed.requests.length,2);assert.equal(catalog.bootstrap.length+catalog.run.length,6);
  const executions={};
  for(const mode of ['reference','no_action','incorrect']) {
    const result=run(seed,plan,catalog.run,mode),assessment=assess(entry.id,seed,result);
    const expected=mode==='reference'||mode==='no_action'&&plan.no_action_pass;
    assert.equal(assessment.goal_pass,expected,entry.id+' '+mode+' business goal must have the declared outcome: '+assessment.failed_checks.join('; '));
    if(!expected)assert.ok(assessment.failed_checks.length,'a failing control must identify an actual failed business predicate');
    executions[mode]={...assessment,expected_goal_pass:expected,state_sha256:result.state_sha256,duplicate_checks:result.duplicate_checks,trace:result.trace,snapshot:result.data};
  }
  const replay=run(seed,plan,catalog.run,'reference');
  assert.equal(replay.state_sha256,executions.reference.state_sha256,'reset to identical seed and ordered replay must reproduce canonical business state');
  assert.equal(hash(catalog),eventInputsHash,'control executions must never rewrite static event inputs');
  const untouched=copy(seed);plugin.validateSeed({binding:copy(require('../fixtures/binding.json'))},untouched);
  const independent=plugin.handleTool({binding:copy(require('../fixtures/binding.json')),virtual_now:plan.initial_time,role:'agent',run_id:'independent'},untouched,'stayready.inspect',{});
  assert.equal(hash(independent.data),entry.seed_sha256,'independent public inspection retains the baseline');
  assert.equal(hash(untouched),entry.seed_sha256,'an independent untouched run keeps the baseline');
  const group={id:entry.id,title:plan.title,goal:plan.goal,representative_failure:plan.representative_failure,
    seed_sha256:entry.seed_sha256,event_inputs:entry.event_inputs,histories:entry.histories,
    replay:{same_business_hash:true,hash:replay.state_sha256,unchanged_static_events:true},independent_run:{baseline_unchanged:true},executions};
  groups.push(group);
  fs.writeFileSync(path.join(output,'fixture-'+entry.id.toLowerCase()+'.json'),JSON.stringify(group,null,2)+'\n');
}
const report={schema:'stayready.fixture-control-results.v1',passed:true,app_version:'0.1.0',node:process.version,
  mode:'App-only public plugin business calls; this harness does not implement or claim Core transport idempotency, epochs, permissions or persistence.',
  core_evidence:'tests/mcp-flow.cjs and the real MCP report cover Core reset/receipt/policy/session boundaries. Browser evidence is separate.',
  fixtures:groups.map(g=>({id:g.id,histories:g.histories,event_inputs:g.event_inputs,replay:g.replay,
    executions:Object.fromEntries(Object.entries(g.executions).map(([mode,e])=>[mode,{goal_pass:e.goal_pass,expected_goal_pass:e.expected_goal_pass,failed_checks:e.failed_checks,state_sha256:e.state_sha256}]))}))};
fs.writeFileSync(path.join(output,'fixture-controls.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
