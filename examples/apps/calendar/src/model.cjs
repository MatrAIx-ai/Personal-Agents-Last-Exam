'use strict';
// Domain records and references; Core owns persistence and versioning.
const {fail,references,range}=require('./domain-utils.cjs');
function validateSeed(ctx,data){
 references(ctx,data);try{new Intl.DateTimeFormat('en',{timeZone:data.timezone});}catch{fail('invalid_event','Unknown timezone.');}
 if(new Set(data.events.map(e=>e.uid)).size!==data.events.length)fail('invalid_seed','Duplicate event UID.');
 if(new Set(data.events.map(e=>e.id)).size!==data.events.length)fail('invalid_seed','Duplicate event ID.');
 for(const e of data.events){
  if(e.account_id!==data.account_id||e.calendar_id!==data.calendar_id||!range(e)||!ctx.binding.people.some(p=>p.person_id===e.organizer_person_id)||e.attendees.some(id=>!ctx.binding.people.some(p=>p.person_id===id)))fail('invalid_event','Invalid event time, account or person reference.');
  try{new Intl.DateTimeFormat('en',{timeZone:e.timezone});}catch{fail('invalid_event','Unknown timezone.');}
 }
}
module.exports={validateSeed,records:data=>data.events,objects:data=>data.events.map(x=>x.id),references:()=>[],assetReferences:data=>data.events.flatMap(x=>(x.attachments||[]).map(asset_id=>({asset_id,object_id:x.id,object_type:'event'})))};
