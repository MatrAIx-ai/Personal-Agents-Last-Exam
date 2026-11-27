'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const app=process.argv[2];
if(!app) throw Error('Provide absolute path to pinned Hopline apps/hopline directory');
const {fixture}=require(path.join(path.resolve(app),'tests/harness.cjs'));
const seed=require('./seed.json'), binding=require('./binding.json');
const T=x=>'2026-11-21T'+x+':00+08:00';
const f=fixture({seed,binding,now:T('08:00')});
const route=(from,to,depart_at,step_free=true)=>f.call('hopline.trips.plan',{from,to,depart_at,step_free,max_walk_m:2500}).itineraries[0];
function validate(it,from,to){
 assert.ok(it.edges.length);
 assert.equal(it.edges[0].from,from);
 assert.equal(it.edges.at(-1).to,to);
 for(let i=0;i<it.edges.length;i++){
  const e=it.edges[i]; assert.ok(Date.parse(e.enter_at)<=Date.parse(e.exit_at));
  if(i){assert.equal(it.edges[i-1].to,e.from);assert.ok(Date.parse(it.edges[i-1].exit_at)<=Date.parse(e.enter_at));}
 }
}
const B='pl-recipient-b', C='pl-recipient-c', J='pl-jules', R='pl-rowan';
const before=route(J,B,T('14:30'));validate(before,J,B);
assert.ok(before.edges.some(e=>e.pathway_id==='pw-cc-lift'));
assert.equal((Date.parse(before.arrive)-Date.parse(before.depart))/1000,330);
const next=route(B,C,before.arrive);validate(next,B,C);assert.ok(Date.parse(next.arrive)<=Date.parse(T('14:52')));
f.event({event_id:'ev-lift-closure',at:T('09:00'),operation:'facility.status_changed',payload:{facility_id:'fac-cc-lift',status:'out_of_service',since:T('09:00'),expected_return:'2026-11-23T09:00:00+08:00',note:'Closed until Monday'}});
f.advance(T('09:10'));
const after=route(J,B,T('14:30'));validate(after,J,B);assert.ok(after.edges.some(e=>e.pathway_id==='pw-rr-ramp'));assert.equal(after.step_free,true);
assert.ok(Date.parse(after.arrive)<=Date.parse(T('17:00')));
const impossible=route(J,C,T('14:30'));validate(impossible,J,C);assert.ok(Date.parse(impossible.arrive)>Date.parse(T('14:52')));
const backup=route(R,C,T('14:20'));validate(backup,R,C);assert.ok(Date.parse(backup.arrive)<=Date.parse(T('14:52')));
const counterfactual=route(J,C,T('14:30'),false);validate(counterfactual,J,C);assert.ok(counterfactual.edges.some(e=>e.pathway_id==='pw-ep-stairs'));assert.ok(Date.parse(counterfactual.arrive)<=Date.parse(T('14:52')));
console.log(JSON.stringify({before:before.arrive,preclosureBoth:next.arrive,after:after.arrive,julesSupply:impossible.arrive,rowanSupply:backup.arrive,stairsSupply:counterfactual.arrive},null,2));
