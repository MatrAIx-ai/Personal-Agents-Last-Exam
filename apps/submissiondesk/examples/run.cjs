'use strict';
const assert=require('node:assert/strict');
const {fixture,bundle,register,commit}=require('../tests/harness.cjs');
const h=fixture();register(h);const original=bundle(h),first=commit(h,original);
const derived=h.call('artifact.derive',{source_id:'material-alder-3',omit_section_ids:['partner-appendix']}).item;
const updated=bundle(h,derived.id);
for(const [person,scope]of [['person-reed','claims'],['person-jun','author-order'],['person-seema','external-release']]){
 const q=h.call('approval.request',{recipient_person_id:person,scope,bundle_id:updated.id}).item;assert.equal(q.status,'pending');
 h.event({event_id:'example-'+scope,at:h.ctx.virtual_now,operation:'approval.reply',payload:{request_id:q.id,responder_person_id:person,status:'approved',body:'This specific bundle was reviewed for '+scope+'.',content_digest:updated.content_digest}});
}
const received=commit(h,updated);assert.equal(received.receipt.kind,'replaced');assert.deepEqual(h.data.receipts.find(r=>r.id===first.receipt.id),first.receipt);
const withdrawn=h.call('submission.withdraw',{id:received.submission_id});assert.equal(withdrawn.receipt.kind,'withdrawn');
console.log(JSON.stringify({app:'submissiondesk',example:'derive -> three external scoped replies -> atomic replacement -> withdrawal',original_receipt:first.receipt.id,replacement_receipt:received.receipt.id,withdrawal_receipt:withdrawn.receipt.id,historical_receipts_retained:true}));
