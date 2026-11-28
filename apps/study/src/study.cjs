'use strict';
const {createHash}=require('node:crypto');
const DAY=86400000, ORIGIN=Date.parse('2027-01-08T00:00:00+08:00');
const stageDelay=[1,1,3,7];
const today=ctx=>Math.floor((Date.parse(ctx.virtual_now)-ORIGIN)/DAY);
function reject(code,message){throw Object.assign(new Error(message),{code});}
const order=(a,b)=>a.due_day-b.due_day||(a.id<b.id?-1:a.id>b.id?1:0);
const withoutAnswer=({answer,...c})=>c;
const effective=(s,day)=>s.history.filter(r=>r.day===day&&!r.undone);
function queue(s,day){
 const reviews=effective(s,day), seen=new Set(reviews.map(r=>r.card_id));
 const remaining=Math.max(0,s.plan.daily_limit-reviews.length);
 const new_remaining=Math.max(0,s.plan.new_limit-reviews.filter(r=>r.was_new).length);
 const candidates=s.cards.filter(c=>!c.suspended&&s.plan.deck_ids.includes(c.deck_id)&&!seen.has(c.id)&&c.due_day<=day);
 const cards=[...candidates.filter(c=>c.reviewed).sort(order),...candidates.filter(c=>!c.reviewed).sort(order).slice(0,new_remaining)].slice(0,remaining);
 // Do not surface a stale progress cursor after a task switch, expiry to a new study day, or capacity loss.
 const session=s.session&&s.session.day===day&&cards.some(c=>c.id===s.session.card_id)?{card_id:s.session.card_id,paused:s.session.paused}:null;
 return {day,remaining,new_remaining,cards,session};
}
function planFor(s,a){
 const p={id:s.plan.id,deck_ids:[...a.deck_ids],daily_limit:a.daily_limit,new_limit:a.new_limit,target_day:a.target_day,revision:s.plan.revision};
 if(!p.deck_ids.length||new Set(p.deck_ids).size!==p.deck_ids.length||p.deck_ids.some(d=>!s.decks.some(x=>x.id===d))||p.new_limit>p.daily_limit)
  reject('invalid_plan','Select valid unique decks and a new-card limit within the daily limit.');
 return p;
}
function capacity(s,p,day){
 const done=effective(s,day), doneIds=new Set(done.map(r=>r.card_id));
 const active=s.cards.filter(c=>!c.suspended&&p.deck_ids.includes(c.deck_id)&&!doneIds.has(c.id));
 // Each relevant card needs a single review by the target; release dates and both daily caps apply.
 // This is a next-review workload estimate, not a claim of repeat-interval coverage or mastery.
 const end=Math.max(day-1,p.target_day);
 const waiting=active.filter(c=>!c.reviewed||c.due_day<=end);
 const available_slots=end<day?0:Math.max(0,p.daily_limit-done.length)+(end-day)*p.daily_limit;
 const due_now=active.filter(c=>c.due_day<=day).length;
 // Schedule backwards by release day, placing released new cards first only within the new cap;
 // carry spare total/new slots to earlier release groups without looping across huge target dates.
 const dates=[...new Set(waiting.map(c=>Math.max(day,c.due_day)).filter(d=>d<=end))].sort((a,b)=>b-a);
 let cursor=end,total=0,newSlots=0,served=0;
 for(const date of dates){
  const future=Math.max(0,cursor-date+(date!==day?1:0));
  total+=future*p.daily_limit;newSlots+=future*p.new_limit;
  if(date===day){total+=Math.max(0,p.daily_limit-done.length);newSlots+=Math.max(0,p.new_limit-done.filter(r=>r.was_new).length);}
  const here=waiting.filter(c=>Math.max(day,c.due_day)===date);
  const fresh=Math.min(total,newSlots,here.filter(c=>!c.reviewed).length);
  served+=fresh;total-=fresh;newSlots-=fresh;
  const due=Math.min(total,here.filter(c=>c.reviewed).length);
  served+=due;total-=due;newSlots=Math.min(newSlots,total);cursor=date-1;
 }
 return {remaining_cards:waiting.length,due_now,available_slots,missing_slots:waiting.length-served};
}
function lookup(s,id){
 const c=s.cards.find(c=>c.id===id);
 if(!c)reject('not_found','Card is unavailable.');
 return c;
}
function undoCandidate(s,day){return effective(s,day).at(-1);}
function validateSeed(_ctx,s){
 for(const xs of [s.decks,s.cards,s.history,s.notices])if(new Set(xs.map(x=>x.id)).size!==xs.length)reject('invalid_seed','Duplicate record IDs.');
 const decks=new Set(s.decks.map(d=>d.id)), cards=new Map(s.cards.map(c=>[c.id,c]));
 if(s.cards.some(c=>!decks.has(c.deck_id)||(!c.reviewed&&c.stage!==0)))reject('invalid_seed','Invalid card/deck relationship.');
 try{planFor(s,s.plan);}catch{reject('invalid_seed','Invalid plan/deck relationship.');}
 const active=s.history.filter(r=>!r.undone);
 if(new Set(active.map(r=>JSON.stringify([r.card_id,r.day]))).size!==active.length ||
    s.history.some(r=>!cards.has(r.card_id)||r.was_new===r.previous_reviewed||r.due_day!==r.day+stageDelay[r.stage]) ||
    active.some(r=>!cards.get(r.card_id).reviewed) || (s.session&&!cards.has(s.session.card_id)))
   reject('invalid_seed','Invalid history or session relationship.');
}
function applyEvent(ctx,s,event){
 const a=event.payload, day=today(ctx);
 if(s.notices.length>=1000)reject('capacity_reached','Notice limit reached.');
 if(event.operation==='study.change_target'){
  if(a.plan_id!==s.plan.id)reject('not_found','Plan is unavailable.');
  if(a.expected_revision!==s.plan.revision)reject('stale_plan','The plan changed; use its current revision.');
  s.plan.target_day=a.target_day;s.plan.revision++;
  s.notices.push({id:event.event_id,kind:'target_changed',object_id:s.plan.id,day});
 }else if(event.operation==='study.correct_card'){
  const c=lookup(s,a.card_id);
  if(a.expected_revision!==c.card_version)reject('stale_card','The card changed; use its current revision.');
  c.answer=a.answer;c.card_version++;
  s.notices.push({id:event.event_id,kind:'card_corrected',object_id:c.id,day});
 }else reject('invalid_event','Unsupported study event.');
 return s;
}
function handleTool(ctx,s,name,a){
 const day=today(ctx),q=()=>queue(s,day);
 let result;
 switch(name){
  case 'study.list_cards':
   if(a.deck_id&&!s.decks.some(d=>d.id===a.deck_id))reject('not_found','Deck is unavailable.');
   result={decks:s.decks,cards:s.cards.filter(c=>!a.deck_id||c.deck_id===a.deck_id).map(withoutAnswer)};break;
  case 'study.get_card':result={card:lookup(s,a.card_id)};break;
  case 'study.save_card':{
   if(!s.decks.some(d=>d.id===a.deck_id))reject('not_found','Deck is unavailable.');
   let c;
   if(a.card_id){c=lookup(s,a.card_id);Object.assign(c,{deck_id:a.deck_id,prompt:a.prompt,answer:a.answer,card_version:c.card_version+1});}
   else{
    if(s.cards.length>=1000)reject('capacity_reached','Card limit reached.');
    let index=1;while(s.cards.some(c=>c.id==='card-'+index))index++;
    c={id:'card-'+index,deck_id:a.deck_id,prompt:a.prompt,answer:a.answer,reviewed:false,stage:0,due_day:day,card_version:1,suspended:false};
    s.cards.push(c);
   }
   result={card:c};break;
  }
  case 'study.set_suspension':{
   const c=lookup(s,a.card_id);c.suspended=a.suspended;c.card_version++;
   if(c.suspended&&s.session?.card_id===c.id)s.session=null;
   result={card:c};break;
  }
  case 'study.get_plan':result={plan:s.plan,notices:s.notices};break;
  case 'study.get_capacity':result={capacity:capacity(s,s.plan,day)};break;
  case 'study.preview_plan':
  case 'study.save_plan':{
   const p=planFor(s,a);
   if(name==='study.save_plan'){p.revision++;s.plan=p;}
   result={plan:p,capacity:capacity(s,p,day)};break;
  }
  case 'study.get_queue':{const {cards,...rest}=q();result={...rest,cards:cards.map(withoutAnswer)};break;}
  case 'study.set_session':{
   if(!q().cards.some(c=>c.id===a.card_id))reject('not_eligible','Card is not eligible in this queue.');
   s.session={card_id:a.card_id,paused:a.paused,day};result={session:q().session};break;
  }
  case 'study.reveal':{
   const c=q().cards.find(c=>c.id===a.card_id);
   if(!c)reject('not_eligible','Card is not eligible in this queue.');
   if(q().session?.paused&&q().session.card_id===c.id)reject('session_paused','Resume the card before revealing it.');
   result={card_id:c.id,card_version:c.card_version,answer:c.answer,review_day:day};break;
  }
  case 'study.get_history':result={history:s.history,undoable_review_id:undoCandidate(s,day)?.id??null};break;
  case 'study.record_review':{
   if(a.review_day!==day)reject('stale_review_day','Reveal the card again on this study day.');
   const c=q().cards.find(c=>c.id===a.card_id);
   if(!c)reject('not_eligible','Card is not eligible in this queue.');
   if(q().session?.paused&&q().session.card_id===c.id)reject('session_paused','Resume the card before rating it.');
   if(a.card_version!==c.card_version)reject('stale_card','Card version changed.');
   if(s.history.length>=1000)reject('capacity_reached','Review ledger limit reached.');
   const was_new=!c.reviewed,previous_stage=c.stage,previous_due_day=c.due_day,previous_reviewed=c.reviewed;
   c.stage=a.rating==='Good'?Math.min(3,c.stage+1):0;c.due_day=day+stageDelay[c.stage];c.reviewed=true;
   const n=s.history.filter(r=>r.card_id===c.id&&r.day===day).length;
   const review={id:'review:'+createHash('sha256').update(JSON.stringify(n?[c.id,day,n]:[c.id,day])).digest('hex').slice(0,32),card_id:c.id,day,rating:a.rating,was_new,stage:c.stage,due_day:c.due_day,undone:false,previous_stage,previous_due_day,previous_reviewed};
   s.history.push(review);if(s.session?.card_id===c.id)s.session=null;
   result={review,remaining:q().remaining,new_remaining:q().new_remaining};break;
  }
  case 'study.undo_review':{
   const r=undoCandidate(s,day);
   if(!r||r.id!==a.review_id)reject('not_undoable','Only the latest effective review from this study day may be undone.');
   const c=lookup(s,r.card_id);
   Object.assign(c,{stage:r.previous_stage,due_day:r.previous_due_day,reviewed:r.previous_reviewed,card_version:c.card_version+1});r.undone=true;
   result={review:r,remaining:q().remaining,new_remaining:q().new_remaining};break;
  }
  default:reject('unknown_tool','Unknown study operation.');
 }
 return {data:s,result:{status:'ok',...result}};
}
module.exports={handleTool,validateSeed,applyEvent,records:s=>s.cards,objects:s=>[...s.cards,...s.decks,s.plan].map(x=>x.id),references:()=>[]};
