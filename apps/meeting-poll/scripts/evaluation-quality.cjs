'use strict';
// Inspect delivered histories, independently of the generation recipe.
function quality(parts){
 const counts=xs=>Object.fromEntries([...new Set(xs)].sort().map(k=>[k,xs.filter(x=>x===k).length]));
 const polls=parts.flatMap(p=>p.data.polls),issues=[],delays=[],spans=[];
 let missing=0,withdrawn=0,multiDay=0,rescheduled=0;
 const signatures=[];
 for(const p of polls){
  const publication=p.history.find(h=>h.action==='publish');
  const dates=new Set(p.responses.map(r=>r.at.slice(0,10)));
  if(dates.size>1)multiDay++;
  spans.push((Date.parse(p.updated_at)-Date.parse(p.created_at))/3600000);
  if(publication){
   if(p.participant_ids.some(person=>!p.responses.some(r=>r.person_id===person)))missing++;
   if(p.participant_ids.some(person=>p.responses.filter(r=>r.person_id===person).at(-1)?.withdrawn))withdrawn++;
  }
  for(const r of p.responses){
   const delay=(Date.parse(r.at)-Date.parse(publication?.at))/3600000;
   if(!Number.isFinite(delay)||delay<0)issues.push(p.id+': response before publication');
   delays.push(delay);
   if(Date.parse(r.at)>Date.parse(p.deadline))issues.push(p.id+': reply after deadline');
  }
  let previous=p.created_at;
  for(const h of p.history){if(h.at<previous)issues.push(p.id+': backwards history');previous=h.at;}
  const reopen=p.history.find(h=>h.action==='reopen');
  if(reopen){
   rescheduled++;
   const old=p.meetings.find(m=>m.status==='superseded'),current=p.meetings.find(m=>m.status==='active');
   const oldSlot=p.slots.find(s=>s.id===old?.slot_id),newSlot=p.slots.find(s=>s.id===current?.slot_id);
   if(!old||!current||!oldSlot||!newSlot||oldSlot.active||!newSlot.active||old.slot_id===current.slot_id||oldSlot.start===newSlot.start)issues.push(p.id+': reopening without changed arrangement');
   if(old&&(Date.parse(reopen.at)-Date.parse(old.at)<86400000))issues.push(p.id+': no elapsed time before scheduling change');
   if(!reopen.reason.includes('conflicting with'))issues.push(p.id+': missing scheduling conflict');
   if(!p.history.some(h=>h.action==='edit'&&h.at>reopen.at&&h.at<current?.at))issues.push(p.id+': no candidate change before reconfirmation');
   if(!p.responses.some(r=>r.at>reopen.at&&r.at<current?.at&&r.votes.some(v=>v.slot_id===newSlot?.id&&v.value==='yes')))issues.push(p.id+': replacement confirmed without a fresh positive reply');
  }
  signatures.push(p.history.map(h=>h.action).join(' > '));
 }
 const purpose=p=>p.title.slice(8),purposes={};
 for(const p of polls){const key=purpose(p);(purposes[key]||=[]).push(p.organizer_id);}
 return {polls:polls.length,organizers:counts(polls.map(p=>p.organizer_id)),participant_combinations:counts(polls.map(p=>[...p.participant_ids].sort().join(','))),outcomes:counts(polls.map(p=>p.status)),effective_outcomes:counts(parts.flatMap(part=>part.data.polls.map(p=>p.status==='open'&&Date.parse(p.deadline)<=Date.parse(part.virtual_now)?'closed':p.status))),lifecycle_sequences:counts(signatures),purposes: Object.fromEntries(Object.entries(purposes).map(([k,v])=>[k,counts(v)])),monthly:parts.map(part=>({month:part.month,ordered_purposes:part.data.polls.map(purpose),outcomes:counts(part.data.polls.map(p=>p.status))})),published_polls_with_missing_replies:missing,polls_with_outstanding_withdrawal:withdrawn,polls_with_responses_on_multiple_dates:multiDay,polls_rescheduled_after_conflict:rescheduled,response_delay_hours:{minimum:Math.min(...delays),maximum:Math.max(...delays)},lifecycle_span_hours:{minimum:Math.min(...spans),maximum:Math.max(...spans)},issues};
}
module.exports={quality};
