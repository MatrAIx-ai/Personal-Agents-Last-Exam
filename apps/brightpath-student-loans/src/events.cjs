'use strict';
const c=require('./common.cjs'),rules=require('./rules.cjs');
const transitions={submitted:new Set(['processing','approved','denied','needs_information']),processing:new Set(['approved','denied','needs_information']),needs_information:new Set(['processing','approved','denied'])};
function applicationEvent(data,event){
  const p=event.payload,app=c.find(data.applications,p.application_id,'Application');if(!transitions[app.status]?.has(p.status))c.fail('invalid_transition',`Application cannot move from ${app.status} to ${p.status}.`);
  if(p.status==='approved'){
    const estimate=c.find(data.estimates,app.estimate_id,'Estimate');const payment=p.monthly_payment_cents??estimate.result.monthly_payment_cents;
    for(const id of app.loan_ids){const loan=c.find(data.loans,id,'Loan');loan.plan_id=app.selected_plan_id;loan.scheduled_payment_cents=payment;loan.version++;loan.updated_at=event.at;}
  }
  app.status=p.status;app.requested_action=p.requested_action;app.required_by=p.status==='needs_information'?new Date(Date.parse(event.at)+14*86400000).toISOString():app.required_by;app.version++;app.updated_at=event.at;
  const kind=p.status==='needs_information'?'document_request':'application_decision',title=p.status==='needs_information'?'More information needed':`Application ${p.status.replace('_',' ')}`;
  rules.notice(data,{kind,application_id:app.id,title,body:p.reason,next_action:p.requested_action,at:event.at,key:event.event_id});rules.history(data,{at:event.at,action:'application_status_changed',application_id:app.id,summary:`Application moved to ${p.status}: ${p.reason}`,event_id:event.event_id,key:event.event_id});
}
function paymentEvent(data,event){
  const p=event.payload,loan=c.find(data.loans,p.loan_id,'Loan');if(!['scheduled','failed','past_due'].includes(p.status))c.fail('invalid_event','Payment events cannot record a completed payment.');if(loan.status==='paid')c.fail('invalid_transition','Paid loans cannot receive payment-status changes.');if(!Number.isFinite(Date.parse(p.due_on+'T00:00:00Z')))c.fail('invalid_event','Payment due date is invalid.');
  loan.scheduled_payment_cents=p.amount_cents;loan.next_due_on=p.due_on;if(['failed','past_due'].includes(p.status))loan.status='delinquent';loan.version++;loan.updated_at=event.at;
  rules.notice(data,{kind:'payment_status',loan_id:loan.id,title:`Payment ${p.status.replace('_',' ')}`,body:p.reason,next_action:p.status==='scheduled'?'Review the scheduled amount and due date.':'Review the failed or overdue payment and contact the fictional servicer.',at:event.at,key:event.event_id});rules.history(data,{at:event.at,action:'payment_status_changed',loan_id:loan.id,servicer_id:loan.servicer_id,summary:`Payment status ${p.status}; no completed payment was recorded. ${p.reason}`,event_id:event.event_id,key:event.event_id});
}
function repaymentEvent(data,event){
  const p=event.payload,loan=c.find(data.loans,p.loan_id,'Loan');if(loan.status==='paid')c.fail('invalid_transition','Paid loans cannot re-enter repayment.');if(!Number.isFinite(Date.parse(p.next_due_on+'T00:00:00Z')))c.fail('invalid_event','Next due date is invalid.');
  loan.status=p.status;loan.scheduled_payment_cents=p.scheduled_payment_cents;loan.next_due_on=p.next_due_on;loan.version++;loan.updated_at=event.at;
  rules.notice(data,{kind:'repayment_status',loan_id:loan.id,title:`Repayment status: ${p.status}`,body:p.reason,next_action:'Review the loan detail and compare plans if a lower eligible payment is needed.',at:event.at,key:event.event_id});rules.history(data,{at:event.at,action:'repayment_status_changed',loan_id:loan.id,servicer_id:loan.servicer_id,summary:`Repayment status moved to ${p.status}: ${p.reason}`,event_id:event.event_id,key:event.event_id});
}
function transferEvent(data,event){
  const p=event.payload;if(p.from_servicer_id===p.to_servicer_id)c.fail('invalid_event','Transfer source and destination must differ.');c.find(data.servicers,p.from_servicer_id,'Source servicer');c.find(data.servicers,p.to_servicer_id,'Destination servicer');
  for(const id of p.loan_ids){const loan=c.find(data.loans,id,'Loan');if(loan.servicer_id!==p.from_servicer_id)c.fail('invalid_transition',`${id} is not assigned to the stated source servicer.`);}
  for(const id of p.loan_ids){const loan=c.find(data.loans,id,'Loan');loan.servicer_id=p.to_servicer_id;loan.version++;loan.updated_at=event.at;rules.history(data,{at:event.at,action:'servicer_transfer_completed',loan_id:loan.id,servicer_id:p.to_servicer_id,summary:`Transferred from ${p.from_servicer_id} to ${p.to_servicer_id}: ${p.reason}`,event_id:event.event_id,key:event.event_id+':'+id});}
  rules.notice(data,{kind:'servicer_transfer',loan_id:p.loan_ids[0],title:'Loan servicer transfer complete',body:`${p.loan_ids.length} loan(s) moved from ${p.from_servicer_id} to ${p.to_servicer_id}. ${p.reason}`,next_action:'Review the new servicer and upcoming payment date.',at:event.at,key:event.event_id});
}
function applyEvent(ctx,data,event){
  if(data.processed_event_ids.includes(event.event_id))return data;
  if(event.operation==='loan.application_status_changed')applicationEvent(data,event);
  else if(event.operation==='loan.payment_status_changed')paymentEvent(data,event);
  else if(event.operation==='loan.repayment_status_changed')repaymentEvent(data,event);
  else if(event.operation==='loan.servicer_transfer_completed')transferEvent(data,event);
  else c.fail('invalid_event','Unsupported Brightpath event operation.');
  data.processed_event_ids.push(event.event_id);c.log(ctx,'brightpath.event_prepared',{event_id:event.event_id,operation:event.operation});return data;
}
module.exports={applyEvent};
