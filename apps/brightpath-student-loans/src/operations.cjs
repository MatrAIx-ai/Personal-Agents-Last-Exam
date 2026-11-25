'use strict';
const c=require('./common.cjs'),rules=require('./rules.cjs'),mail=require('./mail.cjs');
const PREFIX='brightpath-student-loans.';
function read(ctx,data,op,args){
  if(op==='loan.portfolio.list'){
    const outstanding=data.loans.filter(x=>x.status!=='paid');return {borrower:{borrower_account_id:data.account_id,display_name:data.borrower.display_name,masked_email:data.borrower.masked_email,masked_payment_account:data.borrower.masked_payment_account,recertification_due_on:data.borrower.recertification_due_on},summary:{loan_count:outstanding.length,principal_cents:outstanding.reduce((s,x)=>s+x.principal_cents,0),accrued_interest_cents:outstanding.reduce((s,x)=>s+x.accrued_interest_cents,0),scheduled_payment_cents:outstanding.reduce((s,x)=>s+x.scheduled_payment_cents,0)},loans:c.copy(data.loans),servicers:c.copy(data.servicers)};
  }
  if(op==='loan.get'){const loan=c.find(data.loans,args.id,'Loan');return {loan:c.copy(loan),servicer:c.copy(c.find(data.servicers,loan.servicer_id,'Servicer')),history:c.copy(data.history.filter(x=>x.loan_id===loan.id))};}
  if(op==='repayment.plan.compare')return rules.compare(data,args,c.now(ctx));
  if(op==='repayment.application.list'){let apps=data.applications;if(args.status)apps=apps.filter(x=>x.status===args.status);return {applications:c.copy(apps),documents:c.copy(data.documents)};}
  if(op==='repayment.application.get'){const app=c.find(data.applications,args.id,'Application');return {application:c.copy(app),estimate:c.copy(c.find(data.estimates,app.estimate_id,'Estimate')),documents:c.copy(data.documents.filter(x=>app.document_ids.includes(x.id))),history:c.copy(data.history.filter(x=>x.application_id===app.id))};}
  if(op==='loan.notices.list')return {notices:c.copy(data.notices.filter(x=>args.include_acknowledged||!x.acknowledged_at).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)))};
  if(op==='loan.notice.get')return {notice:c.copy(c.find(data.notices,args.id,'Notice'))};
  if(op==='loan.history.list'){let rows=data.history;if(args.loan_id)rows=rows.filter(x=>x.loan_id===args.loan_id);if(args.application_id)rows=rows.filter(x=>x.application_id===args.application_id);return {history:c.copy(rows.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)))};}
  return null;
}
function saveEstimate(ctx,data,args){
  const at=c.now(ctx),compared=rules.compare(data,args,at),selected=compared.comparisons.find(x=>x.plan_id===args.plan_id);if(!selected)c.fail('not_found','Repayment plan does not exist.');if(!selected.eligible)c.fail('ineligible_plan',selected.ineligible_reasons.join(' '));
  const existing=data.estimates.find(x=>x.selected_plan_id===args.plan_id&&JSON.stringify(x.input_snapshot)===JSON.stringify(compared.input_snapshot));if(existing)return {id:existing.id,estimate:c.copy(existing),reused:true};
  const estimate={id:c.id('estimate',args.request_id),loan_ids:compared.input_snapshot.loan_ids,selected_plan_id:args.plan_id,input_snapshot:compared.input_snapshot,result:selected,created_at:at};data.estimates.push(estimate);c.log(ctx,'brightpath.estimate_prepared',{estimate_id:estimate.id,plan_id:args.plan_id,loan_count:estimate.loan_ids.length});return {id:estimate.id,estimate:c.copy(estimate)};
}
function createApplication(ctx,data,args){
  const at=c.now(ctx),estimate=c.find(data.estimates,args.estimate_id,'Estimate');if(!estimate.result.eligible)c.fail('ineligible_plan','The saved estimate is not eligible.');
  const application={id:c.id('application',args.request_id),application_type:args.application_type,loan_ids:[...estimate.loan_ids],estimate_id:estimate.id,selected_plan_id:estimate.selected_plan_id,status:'draft',attestations:c.copy(args.attestations),consent_status:args.consent_status,income_snapshot_id:args.income_snapshot_id??null,document_ids:[],required_by:args.application_type==='annual_recertification'?new Date(data.borrower.recertification_due_on+'T23:59:59Z').toISOString():null,requested_action:null,submitted_snapshot:null,receipt_id:null,version:1,created_at:at,updated_at:at};
  if(application.income_snapshot_id)c.find(data.income_snapshots,application.income_snapshot_id,'Income snapshot');data.applications.push(application);rules.history(data,{at,action:'application_created',application_id:application.id,summary:`Created ${application.application_type} draft for ${application.selected_plan_id}.`,key:args.request_id});c.log(ctx,'brightpath.application_prepared',{application_id:application.id,operation:'create'});return {id:application.id,application:c.copy(application)};
}
function updateApplication(ctx,data,args){
  const at=c.now(ctx),app=c.find(data.applications,args.id,'Application');c.ensureVersion(app,args.application_version,'Application');if(!['draft','needs_information'].includes(app.status))c.fail('invalid_transition','Only draft or needs-information applications can be edited.');if(!Object.keys(args.patch).length)c.fail('invalid_arguments','Application patch cannot be empty.');
  if(args.patch.estimate_id){const e=c.find(data.estimates,args.patch.estimate_id,'Estimate');if(!e.result.eligible)c.fail('ineligible_plan','The selected estimate is ineligible.');app.estimate_id=e.id;app.selected_plan_id=e.selected_plan_id;app.loan_ids=[...e.loan_ids];}
  if(args.patch.income_snapshot_id!==undefined){if(args.patch.income_snapshot_id)c.find(data.income_snapshots,args.patch.income_snapshot_id,'Income snapshot');app.income_snapshot_id=args.patch.income_snapshot_id;}
  if(args.patch.attestations)app.attestations=c.copy(args.patch.attestations);if(args.patch.consent_status)app.consent_status=args.patch.consent_status;
  app.version++;app.updated_at=at;rules.history(data,{at,action:'application_updated',application_id:app.id,summary:'Updated borrower-controlled application fields.',key:args.request_id});return {id:app.id,application:c.copy(app)};
}
function submitApplication(ctx,data,args){
  const at=c.now(ctx),app=c.find(data.applications,args.id,'Application');c.ensureVersion(app,args.application_version,'Application');if(!['draft','needs_information'].includes(app.status))c.fail('invalid_transition','Only draft or needs-information applications can be submitted.');if(args.confirm_selected_plan!==true)c.fail('confirmation_required','Explicitly confirm the selected repayment plan before submission.');
  const estimate=rules.applicationReady(data,app,at);app.status='submitted';app.submitted_snapshot={application_type:app.application_type,loan_ids:[...app.loan_ids],selected_plan_id:app.selected_plan_id,estimate:c.copy(estimate.result),attestations:c.copy(app.attestations),consent_status:app.consent_status,income_snapshot_id:app.income_snapshot_id,documents:c.copy(data.documents.filter(x=>app.document_ids.includes(x.id))),submitted_at:at};app.receipt_id=c.id('receipt',args.request_id);app.requested_action=null;app.version++;app.updated_at=at;
  const notice=rules.notice(data,{kind:'application_receipt',application_id:app.id,title:'Application received',body:`Brightpath received application ${app.id} for plan ${app.selected_plan_id}. Receipt ${app.receipt_id}.`,next_action:'Track processing in Brightpath.',at,key:args.request_id});rules.history(data,{at,action:'application_submitted',application_id:app.id,summary:`Submitted application with receipt ${app.receipt_id}.`,key:args.request_id});c.log(ctx,'brightpath.application_prepared',{application_id:app.id,operation:'submit',notice_id:notice.id});return {id:app.id,application:c.copy(app),notice:c.copy(notice)};
}
function withdrawApplication(ctx,data,args){
  const at=c.now(ctx),app=c.find(data.applications,args.id,'Application');c.ensureVersion(app,args.application_version,'Application');if(!['draft','submitted','processing','needs_information'].includes(app.status))c.fail('invalid_transition','Approved, denied, or already withdrawn applications cannot be withdrawn.');app.status='withdrawn';app.version++;app.updated_at=at;app.requested_action=null;rules.history(data,{at,action:'application_withdrawn',application_id:app.id,summary:args.reason,key:args.request_id});return {id:app.id,application:c.copy(app)};
}
function addDocument(ctx,data,args){
  const at=c.now(ctx),app=c.find(data.applications,args.application_id,'Application');c.ensureVersion(app,args.application_version,'Application');if(!['draft','needs_information'].includes(app.status))c.fail('invalid_transition','Documents can only be added to draft or needs-information applications.');if(app.required_by&&Date.parse(at)>Date.parse(app.required_by))c.fail('deadline_passed','The requested document deadline has passed.');
  const document={id:c.id('document',args.request_id),application_id:app.id,filename:args.filename,document_type:args.document_type,tax_period:args.tax_period,checksum_sha256:args.checksum_sha256,submitted_at:at,metadata_only:true};data.documents.push(document);app.document_ids.push(document.id);app.version++;app.updated_at=at;rules.history(data,{at,action:'document_metadata_added',application_id:app.id,summary:`Added metadata for ${document.document_type}; no document bytes were stored.`,key:args.request_id});return {id:document.id,document:c.copy(document),application:c.copy(app)};
}
function acknowledge(ctx,data,args){const at=c.now(ctx),notice=c.find(data.notices,args.id,'Notice');c.ensureVersion(notice,args.notice_version,'Notice');if(notice.acknowledged_at)c.fail('invalid_transition','Notice is already acknowledged.');notice.acknowledged_at=at;notice.version++;return {id:notice.id,notice:c.copy(notice)};}
function email(ctx,data,op,args){
  if(!op.startsWith('notice.email.'))return null;const notice=c.find(data.notices,args.id,'Notice');c.ensureVersion(notice,args.notice_version,'Notice');
  if(op==='notice.email.prepare'){
    if(notice.email_status==='delivered')c.fail('invalid_transition','This notice was already delivered.');if(notice.email_status==='unknown')c.fail('reconciliation_required','Reconcile the unknown acknowledgement before another send.');
    notice.email_message=mail.message(data,notice,args.router_request_id);notice.email_status='pending';notice.email_request_id=args.router_request_id;notice.email_receipt_id=null;notice.reconciliation_required=false;notice.delivery_attempts++;notice.version++;return {id:notice.id,notice:c.copy(notice),message:c.copy(notice.email_message)};
  }
  if(op==='notice.email.record'){
    if(notice.email_request_id!==args.router_request_id)c.fail('invalid_state','Delivery result does not match the prepared request.');if(notice.email_status==='unknown'&&!args.reconciled)c.fail('reconciliation_required','Unknown acknowledgement can only be changed by reconciliation.');if(notice.email_status!=='pending'&&notice.email_status!=='unknown')c.fail('invalid_transition','No matching delivery attempt is pending.');
    notice.email_status=args.delivery_status;notice.email_receipt_id=args.receipt_id;notice.reconciliation_required=args.delivery_status==='unknown';notice.version++;return {id:notice.id,notice:c.copy(notice)};
  }
  return null;
}
function handleTool(ctx,data,name,args){
  if(!name.startsWith(PREFIX))c.fail('unknown_tool','Unknown business operation.');const op=name.slice(PREFIX.length),result=read(ctx,data,op,args);if(result)return {data,result};
  let out;if(op==='repayment.estimate.save')out=saveEstimate(ctx,data,args);else if(op==='repayment.application.create')out=createApplication(ctx,data,args);else if(op==='repayment.application.update')out=updateApplication(ctx,data,args);else if(op==='repayment.application.submit')out=submitApplication(ctx,data,args);else if(op==='repayment.application.withdraw')out=withdrawApplication(ctx,data,args);else if(op==='repayment.document.add')out=addDocument(ctx,data,args);else if(op==='loan.notice.acknowledge')out=acknowledge(ctx,data,args);else out=email(ctx,data,op,args);if(!out)c.fail('unknown_tool','Unknown business operation.');return {data,result:out};
}
module.exports={handleTool};
