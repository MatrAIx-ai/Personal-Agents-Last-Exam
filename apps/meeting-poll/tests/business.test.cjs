'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs'),plugin=require('../plugin.cjs'),{validateSlot}=require('../src/time.cjs');
const base=require('../fixtures/minimal.json'),args=()=>({title:'Release planning',description:'Alex must attend',location:'Room 2',participant_ids:['person-maya','person-alex'],deadline:base.polls[0].deadline,slots:base.polls[0].slots.map(({start,end,timezone})=>({start,end,timezone}))});
const votes=value=>[{slot_id:'slot-1',value},{slot_id:'slot-2',value}];
const denied=(h,fn,code)=>{const before=h.data;assert.throws(fn,e=>!code||e.code===code);assert.deepEqual(h.data,before);};
test('all eight versioned fixtures are valid and reads do not mutate data',()=>{for(const name of ['minimal','draft','closed','finalized','cancelled','changed-vote','cross-zone','private']){const h=fixture(name);h.call('list');h.call('context');h.call('notifications');}});
test('complete create, publish, respond, withdraw, finalize, reopen, cancel lifecycle',()=>{
 const h=fixture(),id=h.call('create',args()).id;assert.equal(h.data.notifications.length,0);
 h.call('edit',{id,patch:{title:'Release planning updated'}});h.call('publish',{id});assert.equal(h.data.notifications.length,2);
 h.call('respond',{id,votes:votes('yes')});h.call('withdraw',{id});assert.equal(h.data.polls.at(-1).responses.at(-1).withdrawn,true);
 denied(h,()=>h.call('withdraw',{id}),'invalid_state');
 h.call('respond',{id,votes:votes('if-needed')});h.call('finalize',{id,slot_id:'slot-2'});assert.equal(h.data.polls.at(-1).meetings[0].status,'active');
 h.call('reopen',{id,deadline:'2026-11-21T17:00:00Z',reason:'Reconfirm availability'});assert.equal(h.data.polls.at(-1).meetings[0].status,'superseded');
 h.call('finalize',{id,slot_id:'slot-1'});h.call('cancel',{id,reason:'Project postponed'});assert.equal(h.data.polls.at(-1).meetings.filter(m=>m.status==='active').length,0);
 const notices=h.data.notifications.length;h.call('cancel',{id,reason:'Already cancelled'});assert.equal(h.data.notifications.length,notices);
 denied(h,()=>h.call('respond',{id,votes:votes('yes')}),'poll_closed');
});
test('participants cannot finalize, edit another reply, see private reply history or notices',()=>{
 const h=fixture(),id='poll-review';denied(h,()=>h.call('finalize',{id,slot_id:'slot-1'}),'permission_denied');
 denied(h,()=>h.call('respond',{id,actor_id:'person-alex',votes:votes('yes')}));
 h.event({...require('../examples/scenario.json'),payload:{actor_id:'person-sam',action:'respond',arguments:{id,votes:votes('no')}}});
 const read=h.call('get',{id}).item;assert.equal(read.responses.length,0);assert.ok(!read.history.some(x=>x.action==='respond'));assert.equal(h.call('notifications').items.length,0);
 h.call('respond',{id,votes:votes('yes')});assert.deepEqual(h.call('get',{id}).item.responses.map(r=>r.person_id),['person-maya']);
 denied(h,()=>h.call('notification.read',{id:h.data.notifications[0].id}),'not_found');
});
test('uninvited and private drafts are invisible even by guessed ID',()=>{
 const h=fixture('private');assert.ok(!h.call('list').items.some(p=>p.id==='poll-team'));denied(h,()=>h.call('get',{id:'poll-team'}),'not_found');
 const data=fixture().data;data.polls[1].status='draft';const out=plugin.handleTool(fixture().ctx,data,'meeting-poll.list',{});assert.equal(out.result.items.length,1);
});
test('deadline equality freezes writes without needing a close event; repeat close is harmless',()=>{
 const h=fixture();h.at(base.polls[0].deadline);assert.equal(h.call('get',{id:'poll-team'}).item.effective_status,'closed');
 denied(h,()=>h.call('respond',{id:'poll-team',votes:votes('yes')}),'poll_closed');
 h.event({event_id:'close',at:h.ctx.virtual_now,operation:'meeting-poll.close_due',payload:{}});const notices=h.data.notifications.length;
 h.event({event_id:'close-again',at:h.ctx.virtual_now,operation:'meeting-poll.close_due',payload:{}});assert.equal(h.data.notifications.length,notices);
 h.call('finalize',{id:'poll-team',slot_id:'slot-2'});
});
test('replacing a slot does not transfer votes; removed slots cannot be finalized',()=>{
 const h=fixture();h.call('edit',{id:'poll-team',patch:{remove_slot_ids:['slot-1'],add_slots:[{start:'2026-11-25T17:00:00Z',end:'2026-11-25T17:30:00Z',timezone:'Asia/Shanghai'}]}});
 const p=h.call('get',{id:'poll-team'}).item;assert.equal(p.slots.at(-1).id,'slot-3');assert.ok(p.responses.every(r=>!r.votes.some(v=>v.slot_id==='slot-3')));
 denied(h,()=>h.call('finalize',{id:p.id,slot_id:'slot-1'}),'not_found');denied(h,()=>h.call('respond',{id:p.id,votes:votes('yes')}),'invalid_arguments');
});
test('duplicate, missing, unknown and incomplete votes fail atomically',()=>{
 const h=fixture();for(const v of [[{slot_id:'slot-1',value:'yes'},{slot_id:'slot-1',value:'no'}],[{slot_id:'missing',value:'yes'},{slot_id:'slot-2',value:'yes'}],[]])denied(h,()=>h.call('respond',{id:'poll-team',votes:v}));
});
test('invalid creation/edit leaves records and notifications untouched',()=>{
 const h=fixture();for(const change of [{title:' '},{participant_ids:['person-maya','unknown']},{slots:[args().slots[0],args().slots[0]]},{deadline:'2026-11-25T17:00:00Z'},{deadline:'2025-11-25T17:00:00Z'}])denied(h,()=>h.call('create',{...args(),...change}));
 denied(h,()=>h.call('edit',{id:'poll-team',patch:{remove_slot_ids:['slot-1','slot-2']}}));
 denied(h,()=>h.call('edit',{id:'poll-team',patch:{participant_ids:['person-maya','person-jules']}}),'invalid_state');
 denied(h,()=>h.call('edit',{id:'poll-team',patch:{}}),'invalid_arguments');
});
test('past meetings and reversed/new deadlines are rejected',()=>{
 const h=fixture();h.at('2026-11-23T17:00:00Z');denied(h,()=>h.call('finalize',{id:'poll-team',slot_id:'slot-1'}),'invalid_time');
 denied(h,()=>h.call('reopen',{id:'poll-team',deadline:'2026-11-24T17:00:00Z',reason:'too late'}));
});
test('DST gaps are rejected and both explicit fall-back offsets are valid',()=>{
 const slot=(start,end)=>({start,end,timezone:'America/Los_Angeles'});
 assert.throws(()=>validateSlot(slot('2026-03-08T02:15:00-08:00','2026-03-08T02:45:00-08:00')),e=>e.code==='invalid_time');
 const a=validateSlot(slot('2026-11-01T01:00:00-07:00','2026-11-01T01:30:00-07:00'));
 const b=validateSlot(slot('2026-11-01T01:00:00-08:00','2026-11-01T01:30:00-08:00'));assert.notEqual(a.start,b.start);
 assert.throws(()=>validateSlot(slot('2026-02-30T09:00:00-08:00','2026-02-30T10:00:00-08:00')));
 assert.throws(()=>validateSlot({...slot('2026-11-01T08:00:00Z','2026-11-01T08:30:00Z'),timezone:'not-a-zone'}));
});
test('seed rejects invalid binding, duplicate IDs, broken references and lifecycle',()=>{
 const h=fixture();for(const mutate of [d=>d.account_id='other',d=>d.polls.push(structuredClone(d.polls[0])),d=>d.polls[0].status='finalized',d=>d.polls[0].responses[0].votes[0].slot_id='unknown',d=>d.polls[0].history[0].at='2030-01-01T00:00:00Z']){const d=h.data;mutate(d);assert.throws(()=>h.validate(d));}
});
test('scenario actions enforce actor business authority and rejection is atomic',()=>{
 const h=fixture();const e=structuredClone(require('../examples/scenario.json'));h.event(e);assert.equal(h.data.polls[0].responses.at(-1).votes[0].value,'yes');
 e.event_id='bad';e.payload.action='finalize';e.payload.arguments={id:'poll-team',slot_id:'slot-1'};denied(h,()=>h.event(e),'permission_denied');
});
test('notification read operates only on the account owner messages',()=>{const h=fixture();h.call('publish',{id:h.call('create',args()).id});const n=h.call('notifications').items[0];h.call('notification.read',{id:n.id});assert.equal(h.call('notifications').items[0].read,true);});
test('delivered evaluation data reproduce and exclude invalid/out-of-window dates',()=>{
 const {execFileSync}=require('node:child_process'),path=require('node:path');
 execFileSync(process.execPath,[path.join(__dirname,'../scripts/evaluation.cjs'),'--check']);
 const {coverage}=require('../scripts/evaluation.cjs');
 const c=coverage([{month:'2025-01',data:{polls:[{id:'counter-case',created_at:'2025-01-01T00:30:00+01:00',slots:[{id:'s',start:'2025-01-01T05:00:00Z'}],responses:[{at:'invalid'}],history:[{at:'2025-01-01T05:00:00Z'}],meetings:[]}],notifications:[]}}]);
 assert.equal(c.distinct_dates,1);assert.equal(c.included_records,2);assert.equal(c.excluded.length,2);
});

test('evaluation histories vary actors and outcomes and retain realistic incomplete coordination',()=>{
 const fs=require('node:fs'),path=require('node:path'),{quality}=require('../scripts/evaluation-quality.cjs');
 const dir=path.join(__dirname,'../evaluation'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 const parts=manifest.partitions.map(p=>JSON.parse(fs.readFileSync(path.join(dir,p.file))));
 const q=quality(parts);assert.deepEqual(q.issues,[]);assert.equal(q.polls,192);
 assert.equal(Object.keys(q.organizers).length,4);assert.ok(Object.keys(q.participant_combinations).length>=5);
 assert.ok(Object.values(q.purposes).every(actors=>Object.keys(actors).length>=3));
 assert.ok(new Set(q.monthly.map(m=>JSON.stringify(m.ordered_purposes))).size>12);
 assert.ok(new Set(q.monthly.map(m=>JSON.stringify(m.outcomes))).size>4);
 for(const n of ['published_polls_with_missing_replies','polls_with_outstanding_withdrawal','polls_with_responses_on_multiple_dates','polls_rescheduled_after_conflict'])assert.ok(q[n]>=24,n);
 assert.ok(q.response_delay_hours.maximum>72);assert.ok(q.lifecycle_span_hours.maximum>168);
 const broken=structuredClone(parts),poll=broken.flatMap(p=>p.data.polls).find(p=>p.history.some(h=>h.action==='reopen'));
 poll.slots.find(s=>s.id===poll.meetings[0].slot_id).active=true;
 assert.ok(quality(broken).issues.some(x=>x.includes('reopening without changed arrangement')));
 const badTime=structuredClone(parts),responded=badTime.flatMap(p=>p.data.polls).find(p=>p.responses.length);
 responded.responses[0].at='2024-12-31T00:00:00Z';
 assert.ok(quality(badTime).issues.some(x=>x.includes('response before publication')));
});
