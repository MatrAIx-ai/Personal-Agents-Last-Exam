'use strict';
const c=require('./common.cjs');
function groups(data){return [data.servicers,data.plans,data.loans,data.income_snapshots,data.estimates,data.applications,data.documents,data.notices,data.history];}
function records(data){return groups(data).flat();}
function validateSeed(ctx,data){
  const account=ctx.binding.accounts.find(x=>x.app_id==='brightpath-student-loans');
  if(!account||account.account_id!==data.account_id||account.owner_person_id!==data.owner_person_id)c.fail('invalid_seed','Brightpath account does not match its trusted binding.');
  if(data.borrower.person_id!==data.owner_person_id||data.borrower.borrower_account_id!==data.account_id)c.fail('invalid_seed','Borrower identity references are inconsistent.');
  const seen=new Set();for(const item of records(data)){if(seen.has(item.id))c.fail('invalid_seed','Business IDs must be globally unique.');seen.add(item.id);}
  const servicers=new Set(data.servicers.map(x=>x.id)),plans=new Set(data.plans.map(x=>x.id)),loans=new Set(data.loans.map(x=>x.id)),estimates=new Map(data.estimates.map(x=>[x.id,x])),apps=new Map(data.applications.map(x=>[x.id,x]));
  for(const loan of data.loans){if(!servicers.has(loan.servicer_id)||!plans.has(loan.plan_id))c.fail('invalid_seed','Loan plan or servicer reference is invalid.');}
  for(const estimate of data.estimates){if(!plans.has(estimate.selected_plan_id)||estimate.loan_ids.some(x=>!loans.has(x))||estimate.result.plan_id!==estimate.selected_plan_id)c.fail('invalid_seed','Estimate references are invalid.');}
  for(const app of data.applications){const estimate=estimates.get(app.estimate_id);if(!estimate||app.selected_plan_id!==estimate.selected_plan_id||app.loan_ids.some(x=>!loans.has(x)))c.fail('invalid_seed','Application references are invalid.');if(app.document_ids.some(x=>!data.documents.some(d=>d.id===x&&d.application_id===app.id)))c.fail('invalid_seed','Application document references are invalid.');if(app.status==='draft'&&(app.receipt_id||app.submitted_snapshot))c.fail('invalid_seed','Draft applications cannot have submission evidence.');}
  for(const document of data.documents)if(!apps.has(document.application_id))c.fail('invalid_seed','Document application reference is invalid.');
  for(const notice of data.notices){if(notice.loan_id&&!loans.has(notice.loan_id)||notice.application_id&&!apps.has(notice.application_id))c.fail('invalid_seed','Notice source reference is invalid.');if(notice.email_status==='unknown'!==notice.reconciliation_required)c.fail('invalid_seed','Unknown Mail acknowledgement and reconciliation flag must agree.');}
  for(const row of data.history)if(row.loan_id&&!loans.has(row.loan_id)||row.application_id&&!apps.has(row.application_id)||row.servicer_id&&!servicers.has(row.servicer_id))c.fail('invalid_seed','History reference is invalid.');
  if(new Set(data.processed_event_ids).size!==data.processed_event_ids.length)c.fail('invalid_seed','Processed event IDs must be unique.');
}
module.exports={validateSeed,records,objects:data=>records(data).map(x=>x.id),references:()=>[]};
