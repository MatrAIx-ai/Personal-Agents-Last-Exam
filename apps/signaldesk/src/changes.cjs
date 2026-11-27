'use strict';
const {plans,products}=require('./catalog.cjs');
const {find,iso,nextCycle,fail,stateOf,notice}=require('./billing.cjs');
function changeTerms(d, input, now) {
  const {action}=input;
  if(action==='change_plan') {
    const plan=find(plans,input.plan_id);
    if(plan.id===d.plan_id) fail('invalid_state','This plan is already active.');
    return {action,plan_id:plan.id,effective:nextCycle(now),replaces:d.pending?.id||null,monthly_cents:plan.price};
  }
  if(action==='cancel_plan') {
    if(!d.pending || input.target_id!==d.pending.id) fail('invalid_state','Select the current pending change.');
    return {action,target_id:d.pending.id,monthly_cents:find(plans,d.plan_id).price};
  }
  const old=action==='buy_pass'?null:find(d.passes,input.target_id);
  if(old && stateOf(old,now)!=='scheduled') fail('invalid_state','Only scheduled passes can change.');
  if(action==='cancel_pass') return {action,target_id:old.id,line_id:old.line_id,charge_cents:0};
  const line=find(d.lines,old?.line_id||input.line_id);
  const product=find(products,old?.product_id||input.product_id);
  const destination=old?.destination||input.destination;
  if(!product.coverage.includes(destination)) fail('out_of_coverage','Choose a covered destination.');
  if(!input.start || !Number.isFinite(Date.parse(input.start))) fail('invalid_time','Select a start time.');
  const start=iso(input.start),end=iso(Date.parse(start)+product.days*86400000);
  if(start<=now) fail('invalid_time','Choose a future start time.');
  if(d.passes.some(p=>!p.cancelled && p.id!==old?.id && p.line_id===line.id && iso(p.start)<end && start<iso(p.end)))
    fail('overlap','This line already has a pass in that interval.');
  return {action,target_id:old?.id||null,line_id:line.id,product_id:product.id,destination,start,end,coverage:product.coverage,charge_cents:product.price};
}
function commitChange(d,t,id,now) {
  let source=t.target_id||id;
  switch(t.action) {
    case 'change_plan': d.pending={id,plan_id:t.plan_id,effective:t.effective};break;
    case 'cancel_plan': d.pending=null;break;
    case 'buy_pass': d.passes.push({id,line_id:t.line_id,product_id:t.product_id,destination:t.destination,start:t.start,end:t.end,remaining_mb:find(products,t.product_id).data_mb,cancelled:false});break;
    case 'reschedule_pass': Object.assign(find(d.passes,t.target_id),{start:t.start,end:t.end});break;
    case 'cancel_pass': find(d.passes,t.target_id).cancelled=true;break;
    default: fail('invalid_arguments','Unknown change.');
  }
  notice(d,'notice-'+id,now,source,t.action,t.line_id||null);
  return source;
}
module.exports={changeTerms,commitChange};
