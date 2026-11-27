'use strict';
const {fail,instant,validateSlot}=require('./time.cjs');
const {validateSeed}=require('./model.cjs');
const copy=x=>structuredClone(x);
const next=(rows,prefix)=>{let n=1;const ids=new Set(rows.map(r=>r.id));while(ids.has(prefix+n))n++;return prefix+n;};
const effective=(ctx,p)=>p.status==='open'&&instant(ctx.virtual_now)>=instant(p.deadline)?'closed':p.status;
const visible=(p,actor)=>p.organizer_id===actor||(p.status!=='draft'&&p.participant_ids.includes(actor));
function find(data,id,actor){const p=data.polls.find(p=>p.id===id&&visible(p,actor));if(!p)fail('not_found','Poll is not available to this account.');return p;}
function projection(ctx,p,actor){const out=copy(p);out.viewer_id=actor;out.viewer_role=p.organizer_id===actor?'organizer':'participant';out.effective_status=effective(ctx,p);if(out.viewer_role==='participant'){
 out.responses=out.responses.filter(r=>r.person_id===actor);
 // Other participants' response activity is private too. Keep public lifecycle plus own response activity.
 out.history=out.history.filter(h=>!['respond','withdraw'].includes(h.action)||h.actor_id===actor);
 }return out;}
function stamp(ctx,p,actor,action,reason=''){p.updated_at=ctx.virtual_now;p.history.push({at:ctx.virtual_now,actor_id:actor,action,reason});}
function notify(ctx,data,p,type,recipients){
 for(const recipient_id of new Set(recipients)){data.notifications.push({id:next(data.notifications,'notice-'),poll_id:p.id,recipient_id,type,at:ctx.virtual_now,status:'delivered',read:false});}
}
function future(ctx,p){if(instant(p.deadline)<=instant(ctx.virtual_now))fail('invalid_time','Choose a future response deadline.');}
function action(ctx,data,actor,name,args){
 if(!ctx.binding.people.some(p=>p.person_id===actor))fail('permission_denied','Unknown actor.');
 let p;
 if(name==='create'){
  p={id:next(data.polls,'poll-'),title:args.title,description:args.description,location:args.location,organizer_id:actor,participant_ids:copy(args.participant_ids),deadline:args.deadline,status:'draft',slots:args.slots.map((s,i)=>({...validateSlot(s),id:'slot-'+(i+1),active:true})),responses:[],meetings:[],history:[],created_at:ctx.virtual_now,updated_at:ctx.virtual_now};
  future(ctx,p);stamp(ctx,p,actor,'create');data.polls.push(p);
 }else if(name==='notification.read'){
  const n=data.notifications.find(n=>n.id===args.id&&n.recipient_id===actor&&n.status==='delivered');if(!n)fail('not_found','Notification is unavailable.');n.read=true;return {data,result:{id:n.id}};
 }else{
  p=find(data,args.id,actor);
  if(!['respond','withdraw'].includes(name)&&p.organizer_id!==actor)fail('permission_denied','Only the organizer can change the poll.');
  const state=effective(ctx,p);
  if(name==='edit'){
   if(!['draft','open'].includes(state))fail('invalid_state','Reopen the poll before editing.');
   const patch=args.patch;if(!Object.keys(patch).length)fail('invalid_arguments','Supply a change.');
   if(p.status!=='draft'&&Object.hasOwn(patch,'participant_ids'))fail('invalid_state','Published participant lists are fixed.');
   for(const key of ['title','description','location','deadline','participant_ids'])if(Object.hasOwn(patch,key))p[key]=copy(patch[key]);
   for(const id of patch.remove_slot_ids||[]){const s=p.slots.find(s=>s.id===id&&s.active);if(!s)fail('not_found','Active slot does not exist.');s.active=false;}
   for(const s of patch.add_slots||[])p.slots.push({...validateSlot(s),id:next(p.slots,'slot-'),active:true});
   future(ctx,p);stamp(ctx,p,actor,'edit');if(p.status==='open')notify(ctx,data,p,'poll_changed',p.participant_ids);
  }else if(name==='publish'){
   if(state!=='draft')fail('invalid_state','Only a draft can be published.');future(ctx,p);p.status='open';stamp(ctx,p,actor,'publish');notify(ctx,data,p,'invitation',p.participant_ids);
  }else if(name==='respond'||name==='withdraw'){
   if(state!=='open')fail('poll_closed','Responses are only accepted before the deadline in an open poll.');
   if(!p.participant_ids.includes(actor))fail('permission_denied','Only invited participants may respond.');
   const votes=name==='withdraw'?[]:args.votes,ids=p.slots.filter(s=>s.active).map(s=>s.id);
   if(name==='respond'&&(votes.length!==ids.length||new Set(votes.map(v=>v.slot_id)).size!==ids.length||votes.some(v=>!ids.includes(v.slot_id))))fail('invalid_arguments','Respond once for every active slot.');
   if(name==='withdraw'&&(!p.responses.filter(r=>r.person_id===actor).at(-1)||p.responses.filter(r=>r.person_id===actor).at(-1).withdrawn))fail('invalid_state','There is no response to withdraw.');
   p.responses.push({person_id:actor,votes:copy(votes),withdrawn:name==='withdraw',at:ctx.virtual_now});stamp(ctx,p,actor,name);notify(ctx,data,p,'response_changed',[p.organizer_id]);
  }else if(name==='finalize'){
   if(!['open','closed'].includes(state))fail('invalid_state','Only an open or closed poll can be finalized.');
   const s=p.slots.find(s=>s.id===args.slot_id&&s.active);if(!s)fail('not_found','Active slot does not exist.');if(instant(s.start)<=instant(ctx.virtual_now))fail('invalid_time','Cannot confirm a meeting in the past.');
   p.status='finalized';p.meetings.push({id:next(p.meetings,'meeting-'),slot_id:s.id,status:'active',at:ctx.virtual_now});stamp(ctx,p,actor,'finalize');notify(ctx,data,p,'meeting_confirmed',[p.organizer_id,...p.participant_ids]);
  }else if(name==='reopen'){
   if(!['closed','finalized'].includes(state))fail('invalid_state','Only closed or finalized polls can be reopened.');
   p.deadline=args.deadline;future(ctx,p);for(const m of p.meetings)if(m.status==='active')m.status='superseded';p.status='open';stamp(ctx,p,actor,'reopen',args.reason);notify(ctx,data,p,'poll_reopened',[p.organizer_id,...p.participant_ids]);
  }else if(name==='cancel'){
   if(p.status==='cancelled')return {data,result:{id:p.id}};
   const published=p.status!=='draft';p.status='cancelled';for(const m of p.meetings)if(m.status==='active')m.status='cancelled';stamp(ctx,p,actor,'cancel',args.reason);if(published)notify(ctx,data,p,'meeting_cancelled',[p.organizer_id,...p.participant_ids]);
  }else fail('unknown_tool','Unknown meeting operation.');
 }
 validateSeed(ctx,data);return {data,result:{id:p.id}};
}
function handleTool(ctx,data,name,args){
 const actor=data.owner_person_id,n=name.replace(/^meeting-poll\./,'');
 if(n==='list')return {data,result:{items:data.polls.filter(p=>visible(p,actor)&&p.title.toLowerCase().includes((args.query||'').toLowerCase())).map(p=>projection(ctx,p,actor))}};
 if(n==='get')return {data,result:{item:projection(ctx,find(data,args.id,actor),actor)}};
 if(n==='context'){
  const ids=new Set([actor]);for(const p of data.polls.filter(p=>visible(p,actor)))for(const id of [p.organizer_id,...p.participant_ids])ids.add(id);
  return {data,result:{owner_person_id:actor,people:ctx.binding.people.filter(p=>ids.has(p.person_id)).map(p=>({person_id:p.person_id,name:p.name||p.person_id})),virtual_now:ctx.virtual_now}};
 }
 if(n==='notifications')return {data,result:{items:copy(data.notifications.filter(n=>n.recipient_id===actor&&n.status==='delivered'))}};
 return action(ctx,data,actor,n,args);
}
module.exports={handleTool,action,effective,projection,stamp,notify};
