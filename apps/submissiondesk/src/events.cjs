'use strict';
const {check,copy,all,find,person,recordHistory}=require('./domain.cjs');
function applyEvent(ctx,data,event){
 const a=event.payload;
 if(event.operation==='record.add'){
  check(!all(data).some(x=>x.id===a.id),'already_exists','An existing object cannot be overwritten');check(person(ctx,a.source_person_id),'not_found','Unknown record source');
  data.records.push({...copy(a),created_at:ctx.virtual_now});recordHistory(ctx,data,event.operation,a.id,event.event_id);return data;
 }
 if(event.operation==='material.add'){
  check(!all(data).some(x=>x.id===a.id),'already_exists','Immutable material IDs cannot be overwritten');find(data,'papers',a.paper_id);check(person(ctx,a.source_person_id),'not_found','Unknown material source');
  data.materials.push({...copy(a),parent_id:null,omitted_section_ids:[],created_at:ctx.virtual_now});recordHistory(ctx,data,event.operation,a.id,event.event_id);return data;
 }
 if(event.operation==='approval.reply'){
  const q=find(data,'requests',a.request_id);check(q.status==='pending','invalid_state','Only a pending request can receive its first reply');
  check(a.responder_person_id===q.recipient_person_id&&person(ctx,a.responder_person_id),'wrong_responder','Responder must match the requested participant');
  const expected=q.bundle_id?find(data,'bundles',q.bundle_id).content_digest:null;check(a.content_digest===expected,'wrong_digest','Reply must identify exactly the requested content');
  check((q.scope==='purpose')===(a.status==='answered'),'invalid_arguments','Use answered for purpose and approved/changes_requested for a scoped bundle');
  q.status=a.status;q.reply={responder_person_id:a.responder_person_id,body:a.body,content_digest:a.content_digest,at:ctx.virtual_now,source_event_id:event.event_id};recordHistory(ctx,data,event.operation,q.id,event.event_id);return data;
 }
 check(false,'invalid_event','Undeclared event operation');
}
module.exports={applyEvent};
