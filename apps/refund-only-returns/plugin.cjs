'use strict';
const APP='refund-only-returns', after=(a,b)=>Date.parse(a)>Date.parse(b);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const owner=(ctx,d)=>ctx.binding?.accounts?.find(a=>a.app_id===APP&&a.account_id===d.account_id)?.owner_person_id;
const active=(d,id)=>d.requests.find(r=>r.order_id===id&&['confirmed','dispatched'].includes(r.status));
const objects=d=>[d.merchant.id,d.policy.id,...d.orders.flatMap(o=>[o.id,o.item_id]),...d.requests.map(r=>r.id)];
function validateSeed(ctx,d){
 if(!ctx.binding?.people?.some(p=>p.person_id===owner(ctx,d)))fail('invalid_seed','Unbound synthetic account.');
 const ids=objects(d);if(new Set(ids).size!==ids.length)fail('invalid_seed','Duplicate IDs.');
 const orderNumbers=d.orders.map(o=>o.order_number).filter(Boolean);
 if(new Set(orderNumbers).size!==orderNumbers.length||orderNumbers.some(n=>ids.includes(n)))fail('invalid_seed','Conflicting order numbers.');
 for(const o of d.orders){
  if(o.policy_id!==d.policy.id||after('2025-01-01T00:00:00Z',o.ordered_at)||after(o.ordered_at,o.return_deadline)||after(o.ordered_at,ctx.virtual_now))fail('invalid_seed','Invalid order dates or policy.');
  const rs=d.requests.filter(r=>r.order_id===o.id), dr=rs.filter(r=>r.status==='draft').length;
  const attempts=rs.map(r=>r.attempt).filter(n=>n!==undefined);
  if(new Set(attempts).size!==attempts.length)fail('invalid_seed','Duplicate request attempt.');
  if(dr>1||rs.filter(r=>['confirmed','dispatched'].includes(r.status)).length>1||dr&&active(d,o.id))fail('invalid_seed','Conflicting requests for an order.');
 }
 for(const r of d.requests){
  const o=d.orders.find(o=>o.id===r.order_id);
  if(!o||!o.refundable||after(o.ordered_at,r.created_at)||after(r.created_at,o.return_deadline)||after(r.created_at,ctx.virtual_now))fail('invalid_seed','Invalid request history.');
  if(r.submitted_at&&(!['confirmed','cancelled','dispatched'].includes(r.status)||after(r.created_at,r.submitted_at)||after(r.submitted_at,o.return_deadline)||after(r.submitted_at,ctx.virtual_now)))fail('invalid_seed','Invalid request submission time.');
 }
}
function handleTool(ctx,d,name,a){
 if(!owner(ctx,d))fail('permission_denied','Unbound synthetic account.');
 const get=(rows,id,n)=>rows.find(x=>x.id===id)||fail('not_found',n+' was not found in this account.');
 const order=id=>d.orders.find(o=>o.order_number===id.replace(/^#/,'').trim())||get(d.orders,id,'Order'),request=id=>get(d.requests,id,'Request');
 const view=o=>{const deadline_passed=after(ctx.virtual_now,o.return_deadline);return {...o,deadline_passed,eligibility:active(d,o.id)?'already_requested':!o.refundable?'ineligible':deadline_passed?'expired':'eligible'};};
 const out=result=>({data:d,result:{virtual_now:ctx.virtual_now,...result}});
 const read=r=>out({request:r,order:view(order(r.order_id))});
 const eligible=o=>{
  const e=view(o).eligibility;
  if(e==='expired')fail('return_expired','The deadline has passed. Nothing was submitted.');
  if(e==='ineligible')fail('ineligible','This item is not eligible.');
  if(e==='already_requested')fail('already_requested',active(d,o.id)?.status==='dispatched'?'A request has already been dispatched.':'An active request already exists.');
 };
 switch(name){
 case APP+'.lookup_order':return out({order:view(order(a.order_id))});
 case APP+'.read_order':{const o=order(a.order_id);return out({order:view(o),merchant:d.merchant,policy:d.policy,requests:d.requests.filter(r=>r.order_id===o.id)});}
 case APP+'.read_request':return read(request(a.refund_request_id));
 case APP+'.prepare_preview':{
  const o=order(a.order_id);eligible(o);
  if(d.requests.some(r=>r.order_id===o.id&&r.status==='draft'))fail('preview_exists','This order already has a preview.');
  if(d.requests.length>=256)fail('capacity_reached','Local capacity reached.');
  const used=new Set(objects(d));let n=1;while(used.has('RR-'+n))n++;
  const prior=d.requests.filter(r=>r.order_id===o.id);
  const attempt=Math.max(prior.length,...prior.map(r=>r.attempt??0))+1;
  if(attempt>256)fail('capacity_reached','Order attempt capacity reached.');
  const r={id:'RR-'+n,order_id:o.id,status:'draft',created_at:ctx.virtual_now,attempt};d.requests.push(r);return read(r);
 }
 case APP+'.discard_preview':{
  const r=request(a.refund_request_id);if(r.status!=='draft')fail('not_draft','Only open previews may be discarded.');
  r.status='discarded';return read(r);
 }
 case APP+'.confirm_request':{
  const r=request(a.refund_request_id),o=order(r.order_id);
  if(active(d,o.id)?.id===r.id)return read(r);
  if(r.status!=='draft')fail('not_draft','Only open previews may be confirmed.');
  eligible(o);r.status='confirmed';r.submitted_at=ctx.virtual_now;return read(r);
 }
 case APP+'.cancel_request':{
  const r=request(a.refund_request_id);
  if(r.status==='dispatched')fail('already_dispatched','Dispatched requests cannot be cancelled.');
  if(r.status!=='confirmed')fail('not_confirmed','Only confirmed requests may be cancelled.');
  r.status='cancelled';return read(r);
 }
 default:fail('invalid_arguments','Unknown operation.');
 }
}
module.exports={validateSeed,handleTool,applyEvent:()=>fail('invalid_event','Use Infra clock advancement; no application event is declared.'),objects,records:d=>[...d.orders,...d.requests],references:()=>[]};
