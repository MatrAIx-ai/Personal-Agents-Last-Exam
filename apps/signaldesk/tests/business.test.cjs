'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const app=require('../plugin.cjs'), {fixture}=require('../fixtures/build.cjs');
const {sweep,allocation}=require('../src/billing.cjs');
const baseline=require('../fixtures/clock.json').initial_time;
const binding=require('../fixtures/binding.json');
function session(kind='ordinary'){
  let data=fixture(kind),revision=0,now=baseline;
  return {
    get data(){return data;}, at(t){now=t;revision++;},
    call(name,args={}){
      const out=app.handleTool({virtual_now:now,binding},structuredClone(data),'signaldesk.'+name,{...args,expected_version:{epoch:1,revision}});
      if(['preview','confirm','abandon'].includes(name))revision++;
      data=out.data;return out.result.details;
    },
    change(args){const p=this.call('preview',args);return this.call('confirm',{preview_id:p.id});},
    event(operation,payload,id){data=app.applyEvent({virtual_now:now,binding},structuredClone(data),{operation:'signaldesk.'+operation,payload,event_id:id,at:now});revision++;},
    usage(line_id,kind,amount_mb,destination){this.event('post_usage',{line_id,kind,amount_mb,occurred_at:now,...(destination?{destination}:{})},'event-'+revision);}
  };
}
const purchase={action:'buy_pass',line_id:'line-02',product_id:'world',destination:'JP',start:'2026-01-03T00:00:00Z'};
test('fixtures and task bindings are consistent',()=>{
  for(const name of ['ordinary','pending','scheduled','active-expired','member','near-limit'])app.validateSeed({binding},fixture(name));
  assert.deepEqual(fixture(),require('../fixtures/minimal.json'));
  assert.equal(fixture().usage[0].occurred_at,'2025-01-01T00:00:00.000Z');
  assert(fixture().usage.every(u=>Date.parse(u.occurred_at)<Date.parse(baseline)));
  assert.throws(()=>app.validateSeed({binding},{...fixture(),account_id:'other'}),{code:'invalid_seed'});
});
test('next-cycle replacement, abandonment and cancellation',()=>{
  const s=session(),choices=s.call('catalog');assert.equal(choices.plans.length,3);assert.equal(choices.products.length,2);
  const p=s.call('preview',{action:'change_plan',plan_id:'global'});
  assert.equal(p.terms.monthly_cents,9500);assert.equal(s.call('plan').pending,null);
  s.call('abandon',{preview_id:p.id});assert.equal(s.data.previews.length,0);
  s.change({action:'change_plan',plan_id:'basic'});
  const second=s.change({action:'change_plan',plan_id:'global'});
  assert.equal(s.data.pending.id,second.id);assert.equal(s.data.plan_id,'family');
  s.change({action:'cancel_plan',target_id:second.id});assert.equal(s.data.pending,null);
});
test('projection is pure and settlement is identical across time jumps',()=>{
  const s=session('pending');const before=structuredClone(s.data);
  s.at('2026-03-02T00:00:00Z');assert.equal(s.call('plan').active.id,'basic');
  const a=s.call('statement'),b=s.call('statement');assert.deepEqual(a,b);assert.deepEqual(s.data,before);
  assert.equal(a.monthly_totals_cents['2026-02'],4500);
  const direct=structuredClone(before),steps=structuredClone(before);
  sweep(direct,'2026-03-02T00:00:00Z');sweep(steps,'2026-02-01T00:00:00Z');sweep(steps,'2026-03-02T00:00:00Z');assert.deepEqual(direct,steps);
  s.usage('line-01','domestic_data',1);assert.equal(s.data.plan_id,'basic');assert.equal(s.data.charges.length,before.charges.length+2);
});
test('pass coverage, overlap, reschedule and cancellation',()=>{
  const s=session();
  assert.throws(()=>s.change({...purchase,product_id:'regional'}),{code:'out_of_coverage'});
  assert.throws(()=>s.change({...purchase,line_id:'foreign'}),{code:'not_found'});
  const buy=s.change(purchase);assert.equal(s.data.charges.length,13);
  assert.throws(()=>s.change(purchase),{code:'overlap'});
  s.change({action:'reschedule_pass',target_id:buy.id,start:'2026-01-04T00:00:00Z'});
  assert.equal(s.data.passes[0].start,'2026-01-04T00:00:00.000Z');
  s.change({action:'cancel_pass',target_id:buy.id});s.at('2026-01-05T00:00:00Z');
  assert.equal(s.call('passes').passes[0].status,'cancelled');assert.equal(s.call('statement').charges.length,13);
});
test('activation, roaming pools and expiry are bounded to line and destination',()=>{
  const s=session('scheduled');s.at('2026-01-03T00:00:00Z');
  assert.equal(s.call('passes').passes[0].status,'active');assert.equal(s.data.charges.length,13);
  assert.throws(()=>s.change({action:'cancel_pass',target_id:'pass-seeded'}),{code:'invalid_state'});
  s.usage('line-02','roaming',700,'CA');assert.equal(s.data.usage.at(-1).included_mb,500);assert.equal(s.data.usage.at(-1).pass_mb,200);
  assert.equal(s.data.passes[0].remaining_mb,4800);assert.equal(s.data.charges.at(-1).cents,2800);
  s.usage('line-01','roaming',100,'JP');assert.equal(s.data.usage.at(-1).uncovered_mb,100);
  s.at('2026-01-10T00:00:00Z');assert.equal(s.call('passes').passes[0].status,'expired');
  s.usage('line-02','roaming',100,'JP');assert.equal(s.data.usage.at(-1).uncovered_mb,100);assert.equal(s.data.charges.length,14);
  assert.equal(s.data.notices.filter(n=>n.id==='expiry-pass-seeded').length,1);
});
test('usage thresholds respect both limits and do not buy more service',()=>{
  const s=session('near-limit');s.usage('line-02','hotspot',110);
  assert.equal(s.data.usage.at(-1).uncovered_mb,10);const b=allocation(s.data,baseline,'line-02');
  assert.equal(b.domestic_remaining_mb,0);assert.equal(b.hotspot_remaining_mb,4900);
  assert.equal(s.data.notices.length,1);assert.equal(s.data.charges.length,13);assert.equal(s.data.passes.length,0);
});
test('member access and external updates have distinct authorities',()=>{
  const m=session('member'),a=m.call('account');assert.deepEqual(a.lines.map(l=>l.id),['line-02']);
  assert(a.usage.every(u=>u.line_id==='line-02'));assert.equal(m.call('statement').charges.length,0);
  assert.throws(()=>m.call('preview',{action:'change_plan',plan_id:'basic'}),{code:'permission_denied'});
  const s=session('pending'),p={...require('../examples/account-update.json').payload};
  assert.throws(()=>s.event('account_update',{...p,actor_person_id:'person-sam'},'bad'),{code:'permission_denied'});
  assert(s.data.pending);s.event('account_update',p,'good');assert.equal(s.data.pending,null);
});
test('a refreshed client cannot confirm obsolete terms',()=>{
  const s=session(),p=s.call('preview',purchase);s.at('2026-01-02T00:00:00Z');
  assert.throws(()=>s.call('confirm',{preview_id:p.id}),{code:'stale_version'});
  assert.equal(s.data.passes.length,0);
});
