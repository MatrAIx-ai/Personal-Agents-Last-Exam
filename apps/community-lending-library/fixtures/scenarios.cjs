'use strict';
// Builds suggested task seeds with no I/O or external IDs. The caller chooses clock and profile.
const stored=require('./minimal.json'), ids=require('./binding.json'), rules=require('./policies.json');
const choices=['happy-cycle','fifo-expiry','renewal-race','desk-replay','overdue-maintenance','observer'];
function build(name){
 if(!choices.includes(name))throw Error('Unknown lending scenario.');
 const data=structuredClone(stored),binding=structuredClone(ids),policies=structuredClone(rules);
 const chooseMember=member=>{data.member_id=member;binding.accounts[0].owner_person_id=member;};
 if(name==='fifo-expiry'){
  data.queue=[{item_id:'I2',member_id:'M3',sequence:12,joined_at:data.seed_at},{item_id:'I2',member_id:'M4',sequence:13,joined_at:data.seed_at}];
  data.next_sequence=14;
 }
 if(name==='renewal-race'||name==='overdue-maintenance')chooseMember('M2');
 if(name==='desk-replay'){
  data.attempts.push({...data.attempts[0],id:'R2',attempt:2,status:'pending',resolved_at:null});
  data.next_attempt=3;
  binding.objects['community-lending-library'].push('R2');
 }
 const virtual_now=name==='overdue-maintenance'?'2026-12-16T09:00:00+08:00':data.materialized_at;
 return {data,binding,policies,virtual_now,profile:name==='observer'?'scenario':'sandbox'};
}
module.exports={choices,build};
