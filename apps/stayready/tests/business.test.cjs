'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const seed = require('../fixtures/minimal.json');
const binding = require('../fixtures/binding.json');
const clone = value => structuredClone(value);
const start = '2026-12-01T18:00:00Z';
function fixture(input = seed) {
  let data = clone(input);
  const ctx = {app_id:'stayready',run_id:'unit',role:'agent',binding:clone(binding),virtual_now:start};
  plugin.validateSeed(ctx, data);
  return {ctx, get data(){return clone(data);},
    call(name,args={}) { const out=plugin.handleTool(ctx,clone(data),'stayready.'+name,clone(args)); plugin.validateSeed(ctx,out.data); data=out.data; return clone(out.result); },
    event(event) { const next={...ctx,virtual_now:event.at}; const out=plugin.applyEvent(next,clone(data),clone(event)); plugin.validateSeed(next,out); data=out;ctx.virtual_now=event.at;return clone(data); }
  };
}
function preview(f,need_id='need-arrival',action='arrange',predecessor_id) {
  const args={need_id,action,...(predecessor_id?{predecessor_id}:{})};
  return {args, value:f.call('request.preview',args).preview};
}
function submit(f,need_id='need-arrival',action='arrange',predecessor_id) {
  const p=preview(f,need_id,action,predecessor_id);
  return f.call('request.submit',{...p.args,preview_token:p.value.preview_token}).hotel_request_id;
}
function reply(request,{id='reply-1',at='2026-12-01T18:05:00Z',from=start,until=at,outcome='confirmed',terms}={}) {
  const target={need_id:request.need_id,action:request.action,request_conditions:clone(request.conditions),submitted_in:{from,until}};
  if(request.predecessor) target.predecessor={commitment_terms:clone(request.predecessor.terms),confirmed_in:{from:'2026-11-01T00:00:00Z',until:at}};
  if(terms===undefined&&request.action!=='cancel'&&outcome==='confirmed') {
    const c=request.conditions;
    terms=c.service==='late_arrival'?{stay_id:c.stay_id,service:c.service,person_ids:c.person_ids,arrival_window:{start:'2026-12-01T21:00:00Z',end:'2026-12-01T22:00:00Z'},entrance_id:'east',access_method_id:'night-desk'}:
      c.service==='step_free_access'?{stay_id:c.stay_id,service:c.service,person_ids:c.person_ids,route_id:'east-step-free',window:c.window}:clone(c);
  }
  return {event_id:id,at,operation:'stayready.hotel_reply',payload:{target,outcome,...(terms?{terms}: {})}};
}
function unavailable(commitment,{id='outage-1',at='2026-12-01T18:10:00Z',effective_at='2026-12-01T22:00:00Z'}={}) {
  return {event_id:id,at,operation:'stayready.service_unavailable',payload:{target:{need_id:commitment.need_id,commitment_terms:clone(commitment.terms),confirmed_in:{from:'2026-11-01T00:00:00Z',until:at}},effective_at,reason:'East route temporarily closed'}};
}
function noMutation(f,fn) { const before=f.data; assert.throws(fn); assert.deepEqual(f.data,before); }
function outcome(f,text) { assert.ok(JSON.stringify(f.data.history).includes(text), 'history records '+text); }

test('inspection and preview are read-only; public view has no private background',()=>{
  const f=fixture(),before=f.data,view=f.call('inspect').view;
  assert.equal(view.stay.guest_person_ids.length,2);
  assert.ok(!JSON.stringify(view).includes('Private journey details'));
  const a=preview(f).value,b=preview(f).value;
  assert.equal(a.preview_token,b.preview_token);assert.deepEqual(f.data,before);
  assert.ok(!JSON.stringify(a.disclosures).includes('private_background'));
});
test('request receipt and acknowledgment create no commitment; confirmation does',()=>{
  const f=fixture(),id=submit(f),request=f.data.requests.find(r=>r.id===id);
  assert.equal(f.data.commitments.length,1);
  f.event(reply(request,{outcome:'acknowledged'}));assert.equal(f.data.commitments.length,1);
  f.event(reply(request,{id:'confirm',at:'2026-12-01T18:06:00Z'}));
  assert.equal(f.data.commitments.length,2);assert.equal(f.data.requests[0].status,'confirmed');
  assert.equal(f.data.commitments.find(c=>c.request_id===id).terms.entrance_id,'east');
});
test('breakfast dates and guest-specific terms remain distinct',()=>{
  const f=fixture();submit(f,'need-breakfast-person-1');const r=f.data.requests[0];
  f.event(reply(r));const c=f.data.commitments.find(c=>c.request_id===r.id);
  assert.deepEqual(c.terms.person_ids,['person-1']);assert.deepEqual(c.terms.morning_dates,['2026-12-02','2026-12-03']);
  assert.equal(f.data.commitments[0].status,'active');
});
test('step-free service requires the specified actual route, not a generic lift',()=>{
  const f=fixture();submit(f,'need-access-person-2');const r=f.data.requests[0];
  const invalid=reply(r);invalid.payload.terms.route_id='front-steps';
  noMutation(f,()=>f.event(invalid));f.event(reply(r));
  assert.equal(f.data.commitments.at(-1).terms.route_id,'east-step-free');
});
test('no matching request is history-only and a consumed event never rebinds',()=>{
  const f=fixture(),mock={need_id:'need-arrival',action:'arrange',conditions:f.data.needs[0].conditions};
  const e=reply(mock);f.event(e);outcome(f,'no_matching_request');
  submit(f);const before=f.data;f.event(e);assert.deepEqual(f.data,before);assert.equal(f.data.commitments.length,1);
});
test('different request conditions cannot confirm a current request',()=>{
  const f=fixture();submit(f);const e=reply(f.data.requests[0]);
  e.payload.target.request_conditions.arrival_at='2026-12-02T00:20:00Z';
  f.event(e);outcome(f,'no_matching_request');assert.equal(f.data.requests[0].status,'submitted');
});
test('withdraw A then identical B in the same virtual-time window is ambiguous',()=>{
  const f=fixture(),a=submit(f),e=reply(f.data.requests[0]);f.call('request.withdraw',{hotel_request_id:a});submit(f);
  assert.equal(f.data.requests[0].submitted_at,f.data.requests[1].submitted_at);
  f.event(e);outcome(f,'ambiguous_target');assert.equal(f.data.requests[1].status,'submitted');assert.equal(f.data.commitments.length,1);
});
test('an old-window reply remains tied to withdrawn A when B is later',()=>{
  const f=fixture(),a=submit(f),e=reply(f.data.requests[0],{until:'2026-12-01T18:01:00Z'});
  f.call('request.withdraw',{hotel_request_id:a});f.ctx.virtual_now='2026-12-01T18:02:00Z';submit(f);
  f.event(e);outcome(f,'stale_request');assert.equal(f.data.requests[1].status,'submitted');
});
test('new successful pending submission supersedes the old one atomically',()=>{
  const f=fixture();submit(f);submit(f);
  assert.deepEqual(f.data.requests.map(r=>r.status),['superseded','submitted']);
});
test('declined changes and cancellations preserve prior commitments',()=>{
  for(const action of ['change','cancel']){
    const f=fixture(),before=f.data.commitments[0];submit(f,before.need_id,action,before.id);
    f.event(reply(f.data.requests[0],{outcome:'declined'}));assert.deepEqual(f.data.commitments[0],before);
  }
});
test('confirmed cancellation affects only its immutable predecessor',()=>{
  const f=fixture(),before=f.data.commitments[0];submit(f,before.need_id,'cancel',before.id);
  assert.equal(f.data.commitments[0].status,'active');f.event(reply(f.data.requests[0]));
  assert.equal(f.data.commitments[0].status,'cancelled');assert.equal(f.data.stay.reservation_status,'confirmed');
});
test('confirmed change supersedes only the previous promise and installs replacement',()=>{
  const f=fixture(),old=f.data.commitments[0];submit(f,old.need_id,'change',old.id);f.event(reply(f.data.requests[0]));
  assert.equal(f.data.commitments[0].status,'superseded');assert.equal(f.data.commitments[1].status,'active');assert.deepEqual(f.data.commitments[0].terms,old.terms);
});
test('future unavailability changes usability after time, never business data on read',()=>{
  const f=fixture(),old=f.data.commitments[0];f.event(unavailable(old));
  assert.equal(f.call('inspect').view.commitments[0].effective_status,'active');
  const before=f.data;f.ctx.virtual_now='2026-12-01T22:00:00Z';
  assert.equal(f.call('inspect').view.commitments[0].effective_status,'unavailable');assert.deepEqual(f.data,before);assert.deepEqual(f.data.commitments[0].terms,old.terms);
});
test('old unavailable notice never redirects to a replacement commitment',()=>{
  const f=fixture(),old=f.data.commitments[0],e=unavailable(old);
  e.payload.target.confirmed_in.until='2026-12-01T00:00:00Z';
  submit(f,old.need_id,'change',old.id);f.event(reply(f.data.requests[0]));f.event(e);
  outcome(f,'stale_commitment');assert.equal(f.data.commitments[1].unavailability.length,0);
});
test('clearing a need is not hotel cancellation',()=>{
  const f=fixture(),old=f.data.commitments[0];f.call('need.save',{need_id:old.need_id,conditions:null,source_ids:[]});assert.deepEqual(f.data.commitments[0],old);
});
test('same-headcount companion replacement preserves old promises and activates new slots',()=>{
  const f=fixture();submit(f,'need-breakfast-person-2');f.event(reply(f.data.requests[0]));const old=clone(f.data.commitments);
  f.call('people.replace',{old_person_id:'person-2',new_person_id:'person-3'});
  assert.deepEqual(f.data.stay.guest_person_ids,['person-1','person-3']);assert.deepEqual(f.data.commitments,old);
  const view=f.call('inspect').view;
  assert.equal(view.needs.find(n=>n.id==='need-breakfast-person-2').is_current,false);assert.equal(view.needs.find(n=>n.id==='need-breakfast-person-3').is_current,true);
});
test('duplicate, unknown, owner replacement and wrong service/date inputs fail atomically',()=>{
  const f=fixture();for(const args of [{old_person_id:'person-1',new_person_id:'person-3'},{old_person_id:'person-2',new_person_id:'person-1'},{old_person_id:'person-2',new_person_id:'unknown'}])noMutation(f,()=>f.call('people.replace',args));
  const need=f.data.needs.find(n=>n.service==='breakfast');
  for(const dates of [['2026-12-04'],['2026-12-02','2026-12-02']])noMutation(f,()=>f.call('need.save',{need_id:need.id,conditions:{...need.conditions,morning_dates:dates},source_ids:need.source_ids}));
});
test('source changes flag only linked needs; previews cannot outlive changed authority',()=>{
  const f=fixture(),p=preview(f).value,old=f.data.commitments;
  f.event({event_id:'source-2',at:'2026-12-01T18:01:00Z',operation:'stayready.source_updated',payload:{source_id:'source-arrival',expected_source_version:1,source_version:2,arrival_at:'2026-12-02T00:20:00Z'}});
  assert.equal(f.data.needs[0].review_required,true);assert.equal(f.data.needs[1].review_required,false);assert.deepEqual(f.data.commitments,old);
  noMutation(f,()=>f.call('request.submit',{need_id:'need-arrival',action:'arrange',preview_token:p.preview_token}));
});
test('revoked disclosure and unreadable sources cannot be used or leaked',()=>{
  const f=fixture();f.event({event_id:'grant-revoke',at:'2026-12-01T18:01:00Z',operation:'stayready.source_updated',payload:{source_id:'source-arrival',expected_source_version:1,source_version:2,readable:false,disclose_fields:[],grant_version:2}});
  noMutation(f,()=>preview(f));assert.ok(!JSON.stringify(f.call('inspect').view.sources).includes('Private journey details'));
});
test('private background cannot be laundered as a meal request or extra condition',()=>{
  const f=fixture(),n=f.data.needs.find(n=>n.service==='breakfast');
  noMutation(f,()=>f.call('need.save',{need_id:n.id,conditions:{...n.conditions,meal_request:'Personal background not authorized for the hotel.'},source_ids:n.source_ids}));
  noMutation(f,()=>f.call('need.save',{need_id:n.id,conditions:{...n.conditions,private_background:'private'},source_ids:n.source_ids}));
});
test('unknown references, impossible windows and conflicting events are atomic failures',()=>{
  const f=fixture();submit(f);const r=f.data.requests[0];
  for(const mutate of [e=>e.payload.target.need_id='unknown',e=>e.payload.target.submitted_in.until='2026-12-02T00:00:00Z',e=>e.payload.target.submitted_in.from=e.payload.target.submitted_in.until,e=>e.payload.terms.person_ids=['person-3']]){const e=reply(r);mutate(e);noMutation(f,()=>f.event(e));}
  const e=reply(r);f.event(e);const conflict=clone(e);conflict.payload.outcome='declined';noMutation(f,()=>f.event(conflict));
});
test('an identical final reply is harmless but a conflicting final decision fails',()=>{
  const f=fixture();submit(f);const r=f.data.requests[0];f.event(reply(r));const commitments=f.data.commitments;
  f.event(reply(r,{id:'identical-final',at:'2026-12-01T18:06:00Z'}));assert.deepEqual(f.data.commitments,commitments);
  noMutation(f,()=>f.event(reply(r,{id:'conflicting-final',at:'2026-12-01T18:07:00Z',outcome:'declined'})));
});
test('invalid seed identities, dangling source and malformed timeline are rejected',()=>{
  for(const mutate of [d=>d.account_id='unbound',d=>d.needs[0].source_ids=['unknown'],d=>d.stay.guest_person_ids=['person-1','person-1'],d=>d.sources[0].observed_at='invalid']){const d=clone(seed);mutate(d);assert.throws(()=>fixture(d));}
});
test('loaded historical personal requests cannot change traveler or invent disclosure sources',()=>{
  const f=fixture();submit(f,'need-breakfast-person-1');
  for(const mutate of [
    d=>d.requests[0].conditions.person_ids=['person-2'],
    d=>d.requests[0].source_versions[0].source_id='missing-source',
    d=>d.requests[0].disclosures[0].source_id='missing-source',
    d=>d.requests[0].disclosures[0].field='private_background',
    d=>d.requests[0].source_versions[0].version=999
  ]){const d=f.data;mutate(d);assert.throws(()=>fixture(d));}
});
test('loaded hotel commitments must preserve their actual confirmation terms and time',()=>{
  const f=fixture();submit(f,'need-breakfast-person-1');f.event(reply(f.data.requests[0]));
  for(const mutate of [
    d=>d.commitments.find(c=>c.request_id).terms.meal_request='Unrelated meal promise',
    d=>d.commitments.find(c=>c.request_id).confirmed_at='2026-11-01T09:00:00Z',
    d=>d.commitments=d.commitments.filter(c=>c.request_id===null),
    d=>d.requests[0].replies=[]
  ]){const d=f.data;mutate(d);assert.throws(()=>fixture(d));}
});
test('required need slots and source/notice chronology remain valid after seed loading',()=>{
  for(const mutate of [
    d=>d.needs=d.needs.filter(n=>n.id!=='need-breakfast-person-3'),
    d=>d.needs.push({...clone(d.needs[2]),id:'duplicate-personal-slot'}),
    d=>d.commitments[0].unavailability=[{event_id:'bad-notice',recorded_at:'2026-11-29T00:00:00Z',effective_at:'2026-12-01T22:00:00Z',reason:'Notice predates confirmation'}]
  ]){const d=clone(seed);mutate(d);assert.throws(()=>fixture(d));}
});

// Keep service facts and sources coherent while exercising calendar boundaries.
function calendarSeed(checkIn,checkOut,mornings) {
  const data=clone(seed),window={start:checkIn,end:checkOut};
  data.stay.check_in=checkIn;data.stay.check_out=checkOut;
  data.requests=[];data.commitments=[];data.history=[];
  const arrival=new Date(Date.parse(checkIn)+30*60000).toISOString();
  for(const route of data.property.routes)route.window=clone(window);
  for(const source of data.sources) {
    source.observed_at=new Date(Date.parse(checkIn)-2*86400000).toISOString();
    if(source.fields.arrival_at)source.fields.arrival_at=arrival;
  }
  for(const need of data.needs) {
    if(need.service==='late_arrival')need.conditions.arrival_at=arrival;
    if(need.service==='step_free_access')need.conditions.window=clone(window);
    if(need.service==='breakfast')need.conditions.morning_dates=clone(mornings);
  }
  return data;
}

test('breakfast edits and confirmed terms use property dates across a UTC midnight boundary',()=>{
  // These UTC instants mean local 2 July 00:30 -> 4 July 00:30 in London.
  const f=fixture(calendarSeed('2026-07-01T23:30:00Z','2026-07-03T23:30:00Z',['2026-07-03','2026-07-04']));
  f.ctx.virtual_now='2026-07-01T18:00:00Z';
  const n=f.data.needs.find(n=>n.id==='need-breakfast-person-1');
  f.call('need.save',{need_id:n.id,conditions:n.conditions,source_ids:n.source_ids});
  for(const morning of ['2026-07-02','2026-07-05'])
    noMutation(f,()=>f.call('need.save',{need_id:n.id,conditions:{...n.conditions,morning_dates:[morning]},source_ids:n.source_ids}));
  submit(f,n.id);
  const event=reply(f.data.requests[0],{at:'2026-07-01T18:05:00Z',from:'2026-07-01T18:00:00Z'});
  const invalid=clone(event);invalid.payload.terms.morning_dates=['2026-07-02'];
  noMutation(f,()=>f.event(invalid));
  f.event(event);
  assert.deepEqual(f.data.commitments[0].terms.morning_dates,['2026-07-03','2026-07-04']);
});

test('two property-local nights remain valid through 47-hour and 49-hour daylight-saving stays',()=>{
  for(const [checkIn,checkOut,mornings,hours] of [
    ['2026-03-28T12:00:00Z','2026-03-30T11:00:00Z',['2026-03-29','2026-03-30'],47],
    ['2026-10-24T11:00:00Z','2026-10-26T12:00:00Z',['2026-10-25','2026-10-26'],49]
  ]) {
    assert.equal((Date.parse(checkOut)-Date.parse(checkIn))/3600000,hours);
    const data=calendarSeed(checkIn,checkOut,mornings),before=clone(data);
    assert.equal(plugin.validateSeed({binding:clone(binding)},data),true);
    assert.deepEqual(data,before,'calendar validation must not rewrite stored UTC instants');
    const f=fixture(data);
    assert.deepEqual(preview(f,'need-breakfast-person-1').value.request_conditions.morning_dates,mornings);
  }
});

test('a UTC two-date difference cannot admit a local three-night or one-night seed',()=>{
  for(const [checkIn,checkOut,mornings] of [
    ['2026-07-01T22:30:00Z','2026-07-03T23:30:00Z',['2026-07-02','2026-07-03']], // local 1 -> 4 July
    ['2026-07-01T23:30:00Z','2026-07-03T22:30:00Z',['2026-07-03']] // local 2 -> 3 July
  ]) {
    assert.equal(Date.parse(checkOut.slice(0,10))-Date.parse(checkIn.slice(0,10)),2*86400000);
    const data=calendarSeed(checkIn,checkOut,mornings),before=clone(data);
    assert.throws(()=>plugin.validateSeed({binding:clone(binding)},data),{code:'invalid_seed'});
    assert.deepEqual(data,before,'invalid local-calendar stays must leave the supplied seed unchanged');
  }
});
