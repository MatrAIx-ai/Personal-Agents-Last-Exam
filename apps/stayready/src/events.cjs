'use strict';
const path=require('node:path');
const {compile}=require('./schema-validator.cjs');
const {copy,fail,hash,same,sorted,instant,lookup,nextId,record,pending}=require('./common.cjs');
const {conditions,terms,selectorWindow,inside,sameIdentity,matchesConditions,matchesTerms}=require('./conditions.cjs');
const {validateSeed}=require('./model.cjs');
const validEvent=compile(require('../schemas/events.schema.json'),path.join(__dirname,'../schemas'));
function eventRecord(data,ctx,event,outcome,target_id=null,details={}){return record(data,ctx,{kind:event.operation==='stayready.source_updated'?'source_event':'hotel_event',operation:event.operation,outcome,target_id,event,selector:event.payload.target||null,details});}
function replySemantic(r){return {outcome:r.outcome,terms:r.terms,message:r.message};}
function sourceUpdate(ctx,data,event){
 const p=event.payload,s=lookup(data.sources,p.source_id,'Source');
 if(p.expected_source_version!==s.version||p.source_version!==s.version+1)fail('invalid_event','Source updates require the current version and the next source version.');
 if(Object.hasOwn(p,'fields')&&Object.hasOwn(p,'arrival_at'))fail('invalid_event','Use a complete fields replacement or the arrival shorthand, not both.');
 if(Object.hasOwn(p,'disclose_fields')&&(p.grant_version===undefined||p.grant_version<=s.grant_version))fail('invalid_event','Disclosure grant changes require a newer grant version.');
 if(p.grant_version!==undefined&&p.grant_version<=s.grant_version)fail('invalid_event','Grant versions cannot be reused or move backwards.');
 if(p.fields!==undefined)s.fields=copy(p.fields);
 if(p.arrival_at!==undefined)s.fields.arrival_at=instant(p.arrival_at);
 if(p.readable!==undefined)s.readable=p.readable;
 if(p.disclose_fields!==undefined)s.disclose_fields=sorted(p.disclose_fields);
 if(p.grant_version!==undefined)s.grant_version=p.grant_version;
 s.version=p.source_version;s.observed_at=instant(event.at);
 for(const n of data.needs)if(n.source_ids.includes(s.id)){n.review_required=true;n.revision++;}
 eventRecord(data,ctx,event,'source_updated',s.id,{source_version:s.version,grant_version:s.grant_version});
}
function hotelReply(ctx,data,event){
 const p=event.payload,t=p.target,n=lookup(data.needs,t.need_id,'Need');
 const wanted=conditions(data,t.request_conditions,n),w=selectorWindow(t.submitted_in,event.at);
 if(t.action==='arrange'&&t.predecessor||t.action!=='arrange'&&!t.predecessor)fail('invalid_event','The selector must identify predecessor terms for change/cancel only.');
 let predecessor=null;
 if(t.predecessor)predecessor={terms:terms(data,t.predecessor.commitment_terms,n),window:selectorWindow(t.predecessor.confirmed_in,event.at)};
 if(p.outcome!=='confirmed'&&p.terms!==undefined||t.action==='cancel'&&p.terms!==undefined)fail('invalid_event','Only a service confirmation supplies new hotel terms.');
 if(p.outcome==='confirmed'&&t.action!=='cancel'&&p.terms===undefined)fail('invalid_event','Service confirmation requires explicit hotel terms.');
 const promised=p.terms?terms(data,p.terms,n):null;
 if(promised&&!sameIdentity(wanted,promised))fail('invalid_event','Hotel terms must address the selected request service, stay and travelers.');
 const candidates=data.requests.filter(r=>r.need_id===n.id&&r.action===t.action&&inside(r.submitted_at,w)&&matchesConditions(data,r.conditions,wanted,n)&&(!predecessor||r.predecessor&&matchesTerms(data,r.predecessor.terms,predecessor.terms,n)&&inside(r.predecessor.confirmed_at,predecessor.window)));
 if(!candidates.length){eventRecord(data,ctx,event,'history_only/no_matching_request');return;}
 if(candidates.length!==1){eventRecord(data,ctx,event,'history_only/ambiguous_target',null,{matches:candidates.length});return;}
 const r=candidates[0],reply={event_id:event.event_id,at:instant(event.at),outcome:p.outcome,terms:promised,message:p.message||''};
 if(['withdrawn','superseded'].includes(r.status)){eventRecord(data,ctx,event,'history_only/stale_request',r.id);return;}
 if(!pending(r)){
  if(['confirmed','declined'].includes(p.outcome)){
   if(!same(replySemantic(r.final_reply),replySemantic(reply)))fail('invalid_event','A completed request cannot receive a conflicting final response.');
   eventRecord(data,ctx,event,'no_op/identical_final',r.id);return;
  }
  eventRecord(data,ctx,event,'history_only/completed_request',r.id);return;
 }
 const old=r.predecessor_id?lookup(data.commitments,r.predecessor_id,'Commitment'):null;
 if(old&&old.status!=='active'||r.action==='arrange'&&data.commitments.some(c=>c.need_id===n.id&&c.status==='active')){eventRecord(data,ctx,event,'history_only/stale_commitment',r.id);return;}
 r.replies.push(reply);
 if(p.outcome==='acknowledged'||p.outcome==='needs_clarification'){
  // A receipt after a clarification request cannot erase the unanswered question.
  if(r.status!=='needs_clarification'||p.outcome==='needs_clarification')r.status=p.outcome;
  eventRecord(data,ctx,event,p.outcome,r.id);return;
 }
 r.status=p.outcome;r.final_reply=copy(reply);
 if(p.outcome==='declined'){eventRecord(data,ctx,event,'declined',r.id);return;}
 if(r.action==='cancel'){
  old.status='cancelled';eventRecord(data,ctx,event,'cancelled',r.id,{commitment_id:old.id});return;
 }
 const commitment={id:nextId(data,'commitment'),need_id:r.need_id,request_id:r.id,request_conditions:copy(r.conditions),terms:promised,confirmed_at:instant(event.at),status:'active',unavailability:[]};
 if(old)old.status='superseded';data.commitments.push(commitment);
 eventRecord(data,ctx,event,'confirmed',r.id,{commitment_id:commitment.id,superseded_commitment_id:old?.id||null});
}
function unavailable(ctx,data,event){
 const p=event.payload,t=p.target,n=lookup(data.needs,t.need_id,'Need'),wanted=terms(data,t.commitment_terms,n),w=selectorWindow(t.confirmed_in,event.at);
 if(Date.parse(p.effective_at)<Date.parse(event.at))fail('invalid_event','A service notice cannot take effect before its event time.');
 const matches=data.commitments.filter(c=>c.need_id===n.id&&inside(c.confirmed_at,w)&&matchesTerms(data,c.terms,wanted,n));
 if(!matches.length){eventRecord(data,ctx,event,'history_only/no_matching_commitment');return;}
 if(matches.length!==1){eventRecord(data,ctx,event,'history_only/ambiguous_target',null,{matches:matches.length});return;}
 const c=matches[0];if(c.status!=='active'){eventRecord(data,ctx,event,'history_only/stale_commitment',c.id);return;}
 const effective=instant(p.effective_at);
 if(c.unavailability.some(x=>Date.parse(x.effective_at)===Date.parse(effective)&&x.reason===p.reason)){eventRecord(data,ctx,event,'no_op/identical_unavailability',c.id);return;}
 c.unavailability.push({event_id:event.event_id,recorded_at:instant(event.at),effective_at:effective,reason:p.reason});
 eventRecord(data,ctx,event,'unavailability_recorded',c.id,{effective_at:effective,reason:p.reason});
}
function applyEvent(ctx,original,event){
 if(!validEvent(event))fail('invalid_event','Event payload does not match StayReady schemas.');
 const known=original.history.find(h=>h.event_id===event.event_id);
 if(known){if(known.fingerprint!==hash(event))fail('idempotency_conflict','An accepted event ID cannot identify different content.');return copy(original);}
 const data=copy(original),eventCtx={...ctx,virtual_now:instant(event.at)};
 try{
  if(event.operation==='stayready.source_updated')sourceUpdate(eventCtx,data,event);
  else if(event.operation==='stayready.hotel_reply')hotelReply(eventCtx,data,event);
  else if(event.operation==='stayready.service_unavailable')unavailable(eventCtx,data,event);
  validateSeed(eventCtx,data);return data;
 }catch(error){if(error.code==='idempotency_conflict')throw error;fail('invalid_event',error.code?error.message:'The event failed business validation.');}
}
module.exports={applyEvent};
