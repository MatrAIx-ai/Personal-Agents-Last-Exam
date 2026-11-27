'use strict';
const {fail,instant,validateSlot}=require('./time.cjs');
const unique=(rows,key,label)=>{if(new Set(rows.map(x=>x[key])).size!==rows.length)fail('invalid_seed','Duplicate '+label);};
function validateSeed(ctx,data){
 const people=new Set(ctx.binding.people.map(p=>p.person_id));
 if(!ctx.binding.accounts.some(a=>a.app_id==='meeting-poll'&&a.account_id===data.account_id&&a.owner_person_id===data.owner_person_id)||!people.has(data.owner_person_id))fail('invalid_seed','Account owner must match the trusted binding.');
 unique(data.polls,'id','poll');unique(data.notifications,'id','notification');
 for(const p of data.polls){
  if(!p.title.trim()||!people.has(p.organizer_id)||p.participant_ids.some(id=>!people.has(id)))fail('invalid_seed','Unknown person or empty meeting title.');
  if(new Set(p.participant_ids).size!==p.participant_ids.length)fail('invalid_seed','Duplicate participant.');
  unique(p.slots,'id','slot');unique(p.meetings,'id','meeting');
  const active=p.slots.filter(s=>s.active);
  if(active.length<2||active.length>10)fail('invalid_seed','A poll needs 2–10 active slots.');
  const times=new Set();
  for(const s of p.slots){validateSlot(s);if(s.active){const key=instant(s.start)+':'+instant(s.end);if(times.has(key))fail('invalid_seed','Duplicate active times.');times.add(key);if(instant(p.deadline)>=instant(s.start))fail('invalid_time','Deadline must precede every active slot.');}}
  let previous=instant(p.created_at);
  if(!p.history.length||instant(p.updated_at)<previous||instant(p.updated_at)>instant(ctx.virtual_now))fail('invalid_seed','Invalid record timeline.');
  for(const h of p.history){if(!people.has(h.actor_id)||instant(h.at)<previous||instant(h.at)>instant(p.updated_at))fail('invalid_seed','Invalid history.');previous=instant(h.at);}
  if(previous!==instant(p.updated_at))fail('invalid_seed','History must include latest change.');
  let responseAt=instant(p.created_at);
  for(const r of p.responses){
   if(!p.participant_ids.includes(r.person_id)||instant(r.at)<responseAt||instant(r.at)>instant(p.updated_at))fail('invalid_seed','Invalid response person/time.');responseAt=instant(r.at);
   unique(r.votes,'slot_id','vote');if(r.votes.some(v=>!p.slots.some(s=>s.id===v.slot_id))||(r.withdrawn&&r.votes.length))fail('invalid_seed','Invalid response slots.');
  }
  for(const m of p.meetings)if(!p.slots.some(s=>s.id===m.slot_id)||instant(m.at)<instant(p.created_at)||instant(m.at)>instant(p.updated_at))fail('invalid_seed','Invalid meeting.');
  const live=p.meetings.filter(m=>m.status==='active');
  if((p.status==='finalized'&&live.length!==1)||(p.status!=='finalized'&&live.length))fail('invalid_seed','Meeting and poll lifecycle disagree.');
  if(live.some(m=>!p.slots.find(s=>s.id===m.slot_id).active))fail('invalid_seed','Meeting uses inactive slot.');
 }
 for(const n of data.notifications){const p=data.polls.find(p=>p.id===n.poll_id);if(!p||![p.organizer_id,...p.participant_ids].includes(n.recipient_id)||instant(n.at)>instant(ctx.virtual_now)||instant(n.at)<instant(p.created_at))fail('invalid_seed','Invalid notification reference/time.');}
}
module.exports={validateSeed,records:data=>data.polls,objects:data=>data.polls.map(p=>p.id),references:()=>[]};
