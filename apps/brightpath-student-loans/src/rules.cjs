'use strict';
const c=require('./common.cjs');
function addMonths(value,months){const d=new Date(value);d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10);}
function amortized(principalCents,annualBps,months){
  if(!principalCents)return 0;if(!annualBps)return Math.round(principalCents/months);
  const rate=annualBps/10000/12;return Math.round(principalCents*rate/(1-Math.pow(1+rate,-months)));
}
function normalizedInputs(data,args={}){
  const loanIds=args.loan_ids?.length?[...new Set(args.loan_ids)]:data.loans.filter(x=>x.status!=='paid').map(x=>x.id);
  const loans=loanIds.map(id=>c.find(data.loans,id,'Loan'));
  return {loan_ids:loanIds,loans,annual_income_cents:args.annual_income_cents??data.borrower.annual_income_cents,family_size:args.family_size??data.borrower.family_size,filing_status:args.filing_status??data.borrower.filing_status};
}
function calculate(data,plan,inputs,at){
  const reasons=[];
  for(const loan of inputs.loans){
    if(!plan.eligible_loan_types.includes(loan.loan_type))reasons.push(`${loan.id} has ineligible type ${loan.loan_type}.`);
    if(plan.earliest_disbursement_on&&loan.disbursed_on<plan.earliest_disbursement_on)reasons.push(`${loan.id} was disbursed before ${plan.earliest_disbursement_on}.`);
  }
  const debt=inputs.loans.reduce((sum,x)=>sum+x.principal_cents+x.accrued_interest_cents,0);
  if(!debt)reasons.push('The selected loans have no outstanding balance.');
  if(reasons.length)return {plan_id:plan.id,plan_name:plan.name,eligible:false,ineligible_reasons:[...new Set(reasons)],monthly_payment_cents:null,total_projected_payment_cents:null,projected_interest_cents:null,forgiveness_estimate_cents:null,term_months:plan.term_months,projected_end_on:null,tradeoff:plan.tradeoff};
  const standard=inputs.loans.reduce((sum,x)=>sum+amortized(x.principal_cents+x.accrued_interest_cents,x.interest_bps,120),0);
  let monthly;
  if(plan.kind==='fixed')monthly=inputs.loans.reduce((sum,x)=>sum+amortized(x.principal_cents+x.accrued_interest_cents,x.interest_bps,plan.term_months),0);
  else{
    const protectedIncome=plan.poverty_base_cents+plan.poverty_family_increment_cents*Math.max(0,inputs.family_size-1);
    const disposable=Math.max(0,inputs.annual_income_cents-protectedIncome);
    monthly=Math.min(standard,Math.round(disposable*plan.income_percent_bps/10000/12));
  }
  const total=monthly*plan.term_months;
  const simpleProjected=inputs.loans.reduce((sum,x)=>sum+x.principal_cents+x.accrued_interest_cents+Math.round(x.principal_cents*x.interest_bps/10000*plan.term_months/12),0);
  const forgiveness=plan.kind==='income_driven'?Math.max(0,simpleProjected-total):0;
  const interest=Math.max(0,Math.min(total,simpleProjected)-debt);
  return {plan_id:plan.id,plan_name:plan.name,eligible:true,ineligible_reasons:[],monthly_payment_cents:monthly,total_projected_payment_cents:total,projected_interest_cents:interest,forgiveness_estimate_cents:forgiveness,term_months:plan.term_months,projected_end_on:addMonths(at,plan.term_months),tradeoff:plan.tradeoff};
}
function compare(data,args,at){
  const inputs=normalizedInputs(data,args);const comparisons=data.plans.map(p=>calculate(data,p,inputs,at));
  return {input_snapshot:{loan_ids:inputs.loan_ids,annual_income_cents:inputs.annual_income_cents,family_size:inputs.family_size,filing_status:inputs.filing_status,calculated_at:at,rounding:'Nearest whole cent using Math.round on positive deterministic inputs; terms use calendar months.'},comparisons};
}
function history(data,{at,action,loan_id=null,application_id=null,servicer_id=null,summary,event_id=null,key}){
  const row={id:c.id('history',key||`${at}:${action}:${loan_id||application_id||servicer_id||'account'}`),at,action,loan_id,application_id,servicer_id,summary,event_id};
  data.history.push(row);return row;
}
function notice(data,{kind,loan_id=null,application_id=null,title,body,next_action=null,at,key}){
  const row={id:c.id('notice',key),kind,loan_id,application_id,title,body,next_action,created_at:at,acknowledged_at:null,version:1,email_status:data.settings.mail_enabled?'not_prepared':'disabled',email_request_id:null,email_receipt_id:null,email_message:null,delivery_attempts:0,reconciliation_required:false};
  data.notices.push(row);return row;
}
function applicationReady(data,app,at){
  if(!app.attestations.information_accurate||!app.attestations.electronic_signature)c.fail('missing_attestation','Both accuracy and electronic-signature attestations are required.');
  if(app.required_by&&Date.parse(at)>Date.parse(app.required_by))c.fail('deadline_passed','The document or recertification deadline has passed.');
  if(app.consent_status!=='granted'&&!app.document_ids.length)c.fail('missing_income_evidence','Grant synthetic IRS consent or add on-time income-document metadata.');
  if(app.status==='needs_information'&&!app.document_ids.length)c.fail('missing_document','Requested information is still missing.');
  const estimate=c.find(data.estimates,app.estimate_id,'Estimate');if(!estimate.result.eligible)c.fail('ineligible_plan','The saved estimate is not eligible.');
  return estimate;
}
module.exports={addMonths,amortized,normalizedInputs,calculate,compare,history,notice,applicationReady};
