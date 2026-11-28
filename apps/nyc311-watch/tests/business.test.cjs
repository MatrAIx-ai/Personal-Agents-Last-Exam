'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),p=require('../plugin.cjs');
const seed=()=>structuredClone(require('../fixtures/minimal.json'));
const base={app_id:'civic311',binding:require('../fixtures/binding.json'),role:'agent'};
const ctx=(virtual_now,role='agent')=>({...base,virtual_now,role});
const early=ctx('2026-11-21T13:58:00Z'),observed=ctx('2026-11-21T14:00:00Z');
const call=(c,d,n,x={})=>p.handleTool(c,d,'civic311.'+n,x).result;
const status=(d,c=observed)=>call(c,d,'read_case',{case_id:'C17'}).item;
const closure=require('../examples/scenario.json');
const event=(d,e)=>p.applyEvent(ctx(e.at,'infra'),d,e);
const watch=(d,change_types=['resolved'])=>call(observed,d,'save_watch',{case_id:'C17',request_id:'seed-watch',change_types}).watch;
test('creation boundary and read-only projection of observed fields',()=>{
 const d=seed(), before=structuredClone(d);
 a.throws(()=>status(d,ctx('2026-11-20T13:59:59Z')),{code:'not_found'});
 a.deepEqual(status(d,early),{case_id:'C17',created_at:'2026-11-20T14:00:00Z',borough:'QUEENS',category:'Street Condition',status:'unknown',agency:null,admin_update_code:null,last_updated_at:null});
 a.equal(status(d).status,'open');a.equal(status(d).agency,'DOT');
 a.equal(call(early,d,'search_cases',{borough:'QUEENS',status:'open'}).total,0);
 a.equal(call(early,d,'search_cases',{borough:'QUEENS',status:'unknown'}).total,1);
 a.deepEqual(d,before);
});
test('invalid first status and unrelated agency change cannot trigger a resolved watch',()=>{
 const d=seed();watch(d);
 a.throws(()=>event(d,{...closure,at:'2026-11-21T13:59:00Z'}),{code:'invalid_event'});
 const agency={event_id:'a1',at:'2026-11-21T14:01:00Z',operation:'civic311.case_agency_changed',payload:{case_id:'C17',previous_agency:'DOT',new_agency:'DEP'}};
 event(d,agency);a.equal(d.activity.length,0);a.equal(status(d,ctx(agency.at)).agency,'DEP');
 event(d,closure);a.equal(d.activity.length,1);a.equal(d.activity[0].change_type,'resolved');a.equal(status(d,ctx(closure.at)).agency,'DEP');
 a.throws(()=>event(d,{...closure,event_id:'mismatch'}),{code:'invalid_event'});
 p.validateSeed(observed,d);
});
test('reopening and admin updates preserve other fields; acknowledgements survive watch removal',()=>{
 const d=seed(),w=watch(d,['resolved','reopened','admin_update']);event(d,closure);
 const reopen={event_id:'s2',at:'2026-11-21T14:03:00Z',operation:'civic311.case_status_changed',payload:{case_id:'C17',previous_status:'closed',new_status:'in_progress'}};
 const admin={event_id:'a2',at:'2026-11-21T14:04:00Z',operation:'civic311.case_admin_updated',payload:{case_id:'C17',update_code:'record_corrected'}};
 event(d,reopen);event(d,admin);a.deepEqual(d.activity.map(x=>x.change_type),['resolved','reopened','admin_update']);
 const now=ctx(admin.at);
 a.deepEqual([status(d,now).status,status(d,now).agency,status(d,now).admin_update_code],['in_progress','DOT','record_corrected']);
 const ack=call(now,d,'ack_activity',{activity_id:d.activity[0].activity_id});
 a.equal(ack.activity.acknowledged_at,admin.at);
 call(now,d,'remove_watch',{watch_id:w.watch_id});
 a.equal(call(now,d,'list_activity',{unread_only:true}).items.length,2);
 a.equal(call(now,d,'list_watches').items.length,0);p.validateSeed(now,d);
});
test('an update on another case is unrelated and owner binding is enforced',()=>{
 const d=seed(),w=watch(d);
 event(d,{...closure,payload:{...closure.payload,case_id:'C18'}});
 a.equal(d.activity.length,0);
 a.throws(()=>call(observed,d,'save_watch',{watch_id:w.watch_id,case_id:'C18',change_types:['resolved']}),{code:'invalid_arguments'});
 a.throws(()=>p.validateSeed(observed,{...d,account_id:'another-account'}),{code:'invalid_seed'});
 a.throws(()=>p.applyEvent(observed,d,closure),{code:'permission_denied'});
});
test('source closure is never promoted to a status, and future observation does not leak',()=>{
 const d=seed();d.cases[0].recorded_closed_at='2026-11-20T17:00:00Z';
 d.cases[0].observations[0].status='closed';
 a.equal(status(d,early).status,'unknown');
 a.equal(status(d,early).last_updated_at,null);
 a.equal(status(d).status,'closed');
});
