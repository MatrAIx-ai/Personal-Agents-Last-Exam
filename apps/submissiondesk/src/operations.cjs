'use strict';
const {check,copy,digest,find,id,person,bundleContent,recordHistory,snapshot,liveSubmission,preview}=require('./domain.cjs');
function handleTool(ctx,data,name,args){
 const op=name.replace(/^submissiondesk\./,''),now=ctx.virtual_now;
 const done=value=>({data,result:{value}}),history=object_id=>recordHistory(ctx,data,name,object_id,args.request_id);
 if(op==='workspace.get')return done({account_id:data.account_id,owner_person_id:data.owner_person_id,people:copy(ctx.binding.people),virtual_now:now});
 const listing={'records.list':'records','venues.list':'venues','papers.list':'papers','materials.list':'materials','bundles.list':'bundles','requests.list':'requests','abstracts.list':'abstracts'};
 if(listing[op])return done({items:copy(data[listing[op]].filter(x=>!args.query||JSON.stringify(x).toLowerCase().includes(args.query.toLowerCase())))});
 const reading={'records.get':'records','materials.get':'materials','bundles.get':'bundles'};
 if(reading[op])return done({item:copy(find(data,reading[op],args.id))});
 if(op==='submissions.list')return done({items:copy(data.submissions),receipts:copy(data.receipts),history:copy(data.history)});
 if(op==='artifact.derive'){
  const src=find(data,'materials',args.source_id),omit=args.omit_section_ids;
  check(new Set(omit).size===omit.length&&omit.every(x=>src.sections.some(s=>s.id===x)),'invalid_arguments','Only existing unique section IDs may be omitted');
  const sections=copy(src.sections.filter(s=>!omit.includes(s.id)));check(sections.length,'empty_material','Cannot omit every section');
  const m={id:id(data,'material-local'),paper_id:src.paper_id,source_person_id:data.owner_person_id,parent_id:src.id,omitted_section_ids:copy(omit),sections,created_at:now};data.materials.push(m);history(m.id);return done({item:copy(m)});
 }
 if(op==='bundle.create'){
  find(data,'papers',args.paper_id);check(args.material_ids.length&&new Set(args.material_ids).size===args.material_ids.length,'invalid_arguments','Unique nonempty material list required');
  check(args.material_ids.every(x=>find(data,'materials',x).paper_id===args.paper_id),'wrong_paper','All bundle materials must belong to the same paper');check(args.author_person_ids.length&&new Set(args.author_person_ids).size===args.author_person_ids.length&&args.author_person_ids.every(x=>person(ctx,x)),'invalid_arguments','Known unique authors required');
  const b={id:id(data,'bundle-local'),paper_id:args.paper_id,material_ids:copy(args.material_ids),author_person_ids:copy(args.author_person_ids),created_at:now};b.content_digest=digest(bundleContent(data,b));data.bundles.push(b);history(b.id);return done({item:copy(b)});
 }
 if(op==='approval.request'){
  check(person(ctx,args.recipient_person_id),'not_found','Unknown recipient');const bundle_id=args.bundle_id??null;
  if(args.scope==='purpose')check(bundle_id===null,'invalid_arguments','Purpose clarification does not approve a bundle');else find(data,'bundles',bundle_id);
  const q={id:id(data,'request-local'),recipient_person_id:args.recipient_person_id,scope:args.scope,bundle_id,status:'pending',reply:null,created_at:now};data.requests.push(q);history(q.id);return done({item:copy(q)});
 }
 if(op==='approval.cancel'){const q=find(data,'requests',args.id);check(q.status==='pending','invalid_state','Only unanswered requests can be cancelled');q.status='cancelled';history(q.id);return done({item:copy(q)});}
 if(op==='abstract.register'){
  find(data,'papers',args.paper_id);const v=find(data,'venues',args.venue_id);check(Date.parse(now)<Date.parse(v.abstract_before),'deadline_closed','Abstract window is closed, including its exact cutoff');
  check(!data.abstracts.some(a=>a.paper_id===args.paper_id&&a.venue_id===v.id&&a.status==='registered'),'already_registered','Active abstract already exists');
  const a={id:id(data,'abstract-local'),paper_id:args.paper_id,venue_id:v.id,status:'registered',created_at:now};data.abstracts.push(a);history(a.id);return done({item:copy(a)});
 }
 if(op==='abstract.cancel'){
  const a=find(data,'abstracts',args.id),v=find(data,'venues',a.venue_id);check(a.status==='registered','invalid_state','Abstract is not active');check(Date.parse(now)<Date.parse(v.abstract_before),'deadline_closed','Abstract changes are closed');const s=liveSubmission(data,a.paper_id,a.venue_id);check(!s||s.status!=='received','in_use','Withdraw the received submission before cancelling its abstract');a.status='cancelled';history(a.id);return done({item:copy(a)});
 }
 if(op==='submission.preview')return done({preview:preview(ctx,data,args.bundle_id,args.venue_id)});
 if(op==='submission.commit'){
  const expected=preview(ctx,data,args.bundle_id,args.venue_id);check(digest(expected)===digest(args.preview),'stale_preview','Preview must match paper, venue, policy, content, abstract and active receipt');
  const b=find(data,'bundles',args.bundle_id),v=find(data,'venues',args.venue_id);check(Date.parse(now)<Date.parse(v.submit_before),'deadline_closed','Submission window is closed, including its exact cutoff');
  let s=liveSubmission(data,b.paper_id,v.id);const previous=s?.active_receipt_id??null;
  if(!s){s={id:id(data,'submission-local'),paper_id:b.paper_id,venue_id:v.id,status:'received',active_receipt_id:null,last_receipt_id:null,created_at:now,updated_at:now};data.submissions.push(s);}
  const r={id:id(data,'receipt-local'),submission_id:s.id,venue_id:v.id,bundle_id:b.id,kind:previous?'replaced':'submitted',snapshot:snapshot(data,b),previous_receipt_id:previous,at:now};data.receipts.push(r);s.active_receipt_id=r.id;s.last_receipt_id=r.id;s.updated_at=now;history(r.id);
  return done({submission_id:s.id,receipt:copy(r)});
 }
 if(op==='submission.withdraw'){
  const s=find(data,'submissions',args.id),v=find(data,'venues',s.venue_id);check(s.status==='received','invalid_state','Only a received submission can be withdrawn');check(Date.parse(now)<Date.parse(v.withdraw_before),'deadline_closed','Withdrawal window is closed');
  const old=find(data,'receipts',s.active_receipt_id),r={...copy(old),id:id(data,'receipt-local'),kind:'withdrawn',previous_receipt_id:old.id,at:now};data.receipts.push(r);s.status='withdrawn';s.active_receipt_id=null;s.last_receipt_id=r.id;s.updated_at=now;history(r.id);return done({submission_id:s.id,receipt:copy(r)});
 }
 check(false,'not_found','Unknown SubmissionDesk operation');
}
module.exports={handleTool};
