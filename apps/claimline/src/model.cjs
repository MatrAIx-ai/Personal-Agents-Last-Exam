'use strict';
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const MAX=9_000_000_000_000;
const groups=['trips','charges','receipt_sources','receipts','lines','reports','requests','policies','reviews','payments','notices'];
const copy=x=>structuredClone(x);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const need=(condition,code,message)=>{if(!condition)fail(code,message);};
const cents=value=>{need(Number.isSafeInteger(value)&&value>=0&&value<=MAX,'invalid_amount','Amounts must be supported nonnegative integer cents.');return value;};
const sum=values=>cents(values.reduce((a,b)=>a+cents(b),0));
const stamp=value=>{const t=Date.parse(value);need(Number.isFinite(t),'invalid_time','A valid timestamp is required.');return t;};
const day=value=>{const t=Date.parse(value+'T12:00:00Z');need(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value,'invalid_date','Use a valid YYYY-MM-DD date.');return value;};
const localDay=(value,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const plusDays=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const records=data=>groups.flatMap(key=>data[key]);
const find=(data,group,id)=>{const row=data[group].find(r=>r.id===id);need(row,'not_found',group+' record not found.');return row;};
function allocate(data,prefix){const ids=new Set(records(data).map(r=>r.id));let id;do{id=prefix+'-'+data.next_id++;}while(ids.has(id));return id;}
function latestSource(data,id){return data.receipt_sources.filter(r=>r.source_id===id).sort((a,b)=>b.source_revision-a.source_revision)[0];}
function editReport(data,report){
  need(['draft','returned'].includes(report.status),'report_locked','Only draft or returned reports are editable.');
  if(report.status==='returned'){report.status='draft';report.revision++;}
  return report;
}
function lineParts(line){
  if(line.itemizations.length){need(sum(line.itemizations.map(r=>r.amount_cents))===line.amount_cents,'invalid_itemization','Itemizations must exactly equal the original expense.');return line.itemizations;}
  return [{category:line.category,label:line.merchant,date:line.date,amount_cents:line.amount_cents,personal:line.personal}];
}
function totals(lines){
  const total={gross_cents:0,company_paid_cents:0,employee_claim_cents:0,personal_liability_cents:0};
  for(const line of lines){const personal=sum(lineParts(line).filter(p=>p.personal).map(p=>p.amount_cents)),business=line.amount_cents-personal;
    total.gross_cents+=line.amount_cents;total.personal_liability_cents+=personal;
    if(line.payment_type==='company_card')total.company_paid_cents+=business;else total.employee_claim_cents+=business;
  }
  for(const v of Object.values(total))cents(v);return total;
}
function policyFor(data,date,now){
  const rows=data.policies.filter(p=>p.effective_from<=date&&(p.effective_until===null||date<=p.effective_until)&&stamp(p.published_at)<=stamp(now));
  need(rows.length,'missing_policy','No published policy covers this expense date.');return rows.sort((a,b)=>b.revision-a.revision)[0];
}
function evidenceFlags(data,lines){
  const flags=[];
  for(const line of lines){
    if(line.charge_id){const charge=find(data,'charges',line.charge_id);if(charge.source_revision!==line.charge_revision)flags.push({line_id:line.id,code:'charge_changed',message:'The card source changed; reconcile the expense.'});}
    if(line.receipt_id){const receipt=find(data,'receipts',line.receipt_id),source=latestSource(data,receipt.source_id);if(!source||source.status==='voided'||source.source_revision!==receipt.source_revision)flags.push({line_id:line.id,code:'receipt_changed',message:'A corrected or voided original needs review.'});}
  }
  return flags;
}
function preview(ctx,data,report){
  const lines=report.line_ids.map(id=>find(data,'lines',id)),trip=find(data,'trips',report.trip_id),findings=[],policyIds=new Set();
  const add=(line,code,message)=>findings.push({line_id:line?.id||null,code,message,severity:'error'});
  if(!lines.length)add(null,'empty_report','Add an expense before submission.');
  const usedCharges=new Set(),usedReceipts=new Set();
  const refs=new Set([...data.trips.map(r=>r.source_ref),...data.receipt_sources.map(r=>r.source_ref),...data.requests.flatMap(r=>r.replies.map(p=>p.source_ref))]);
  for(const line of lines){
    const policy=policyFor(data,line.date,ctx.virtual_now);
    policyIds.add(policy.id);
    if(line.date<trip.start_date||line.date>trip.end_date)add(line,'outside_trip','The expense date is outside this trip.');
    if(!line.purpose.trim()||!refs.has(line.purpose_source_ref))add(line,'purpose_evidence','Business purpose needs an obtained source reference.');
    if(line.cost_center!==trip.cost_center)add(line,'cost_center','Expense and trip cost centers differ.');
    if(line.category==='hotel'&&!line.itemizations.length)add(line,'hotel_itemization','Itemize hotel room, tax and personal charges.');
    const parts=lineParts(line),business=sum(parts.filter(p=>!p.personal).map(p=>p.amount_cents));
    const meals=line.category==='meals'?(business?[{date:line.date,amount_cents:business}]:[]):parts.filter(p=>p.category==='meals'&&!p.personal&&p.amount_cents>0);
    if(meals.length&&!line.attendees.length)add(line,'attendees','Record the business-meal attendees, including itemized hotel meals.');
    for(const meal of meals){const mealPolicy=policyFor(data,meal.date,ctx.virtual_now);policyIds.add(mealPolicy.id);if(meal.amount_cents>mealPolicy.meal_limit_cents&&!line.explanation.trim())add(line,'meal_limit','This meal or meal itemization exceeds the published limit; add an explanation.');}
    if(line.amount_cents>=policy.receipt_required_cents&&!line.receipt_id)add(line,'missing_receipt','Attach an original receipt.');
    if(line.charge_id){const charge=find(data,'charges',line.charge_id);
      if(usedCharges.has(charge.id))add(line,'duplicate_charge','A charge cannot be claimed twice in one report.');usedCharges.add(charge.id);
      if(charge.status!=='settled')add(line,'unsettled_charge','Only settled, unreversed charges can be submitted.');
      if(charge.amount_cents-charge.refund_cents!==line.amount_cents||charge.merchant!==line.merchant||charge.date!==line.date||charge.payment_type!==line.payment_type)add(line,'charge_mismatch','Expense amount, merchant, date or payment type differs from the source.');
      if(data.reports.some(r=>r.id!==report.id&&!['discarded','rejected'].includes(r.status)&&r.line_ids.some(id=>find(data,'lines',id).charge_id===charge.id)))add(line,'charge_in_other_report','The charge is already in another active report.');
    }
    if(line.receipt_id){const receipt=find(data,'receipts',line.receipt_id),source=find(data,'receipt_sources',receipt.source_record_id);
      if(usedReceipts.has(receipt.id))add(line,'duplicate_receipt','A receipt cannot support two expense lines.');usedReceipts.add(receipt.id);
      if(source.merchant!==line.merchant||source.date!==line.date||source.amount_cents!==line.amount_cents)add(line,'receipt_mismatch','Original merchant, date and amount must match.');
    }
    const deadline=plusDays(trip.end_date,policy.submit_days);
    if(!report.first_submitted_at&&localDay(ctx.virtual_now,policy.timezone)>deadline)add(line,'submission_deadline','The first-submission deadline has passed.');
  }
  for(const flag of evidenceFlags(data,lines))add(find(data,'lines',flag.line_id),flag.code,flag.message);
  if(report.amend_by&&stamp(ctx.virtual_now)>stamp(report.amend_by))add(null,'amendment_deadline','The returned report amendment deadline has passed.');
  return {report_id:report.id,report_revision:report.revision,totals:totals(lines),findings,can_submit:findings.length===0,policy_ids:[...policyIds]};
}
function paymentSummary(data,report){
  const review=data.reviews.find(r=>r.report_id===report.id&&r.report_revision===report.revision&&['approved','partially_approved'].includes(r.decision));
  const snapshot=report.snapshots.find(s=>s.revision===report.revision);
  const approved=review&&snapshot?sum(snapshot.lines.filter(l=>l.payment_type!=='company_card').map(l=>review.approved_line_amounts[l.id]||0)):0;
  const rows=data.payments.filter(p=>p.report_id===report.id&&p.report_revision===report.revision);
  const paid=sum(rows.filter(p=>p.status==='paid').map(p=>p.amount_cents)),scheduled=sum(rows.filter(p=>p.status==='scheduled').map(p=>p.amount_cents));
  need(paid+scheduled<=approved,'invalid_payment','Payments exceed approved employee reimbursement.');
  return {approved_employee_cents:approved,paid_cents:paid,scheduled_cents:scheduled,outstanding_cents:approved-paid,unreserved_cents:approved-paid-scheduled};
}
function addNotice(ctx,data,report,kind,text){data.notices.push({id:allocate(data,'notice'),report_id:report.id,report_revision:report.revision,kind,at:ctx.virtual_now,title:report.name+' · '+kind,body:text});}
function noticeMessage(data,notice){return {specversion:'1.0',id:notice.id,source:'urn:pale:app:claimline:account:'+data.account_id,type:'org.pale.mail.notification.v1',time:notice.at,datacontenttype:'application/json',dataschema:'urn:pale:email-payload:1',data:{channel:'channel.email',recipient:{kind:'person_ref',id:data.owner_person_id},source_object:{app_id:'claimline',account_id:data.account_id,object_type:'report',object_id:notice.report_id},content:{title:notice.title,body:{format:'text/plain',text:notice.body},asset_ids:[]},extensions:[]}};}
function validateSeed(ctx,data){
  need(ctx.binding.accounts.some(a=>a.app_id==='claimline'&&a.account_id===data.account_id&&a.owner_person_id===data.owner_person_id),'invalid_seed','Workspace must match the trusted employee account.');
  const ids=records(data).map(r=>r.id);need(ids.length===new Set(ids).size,'invalid_seed','Business IDs must be unique.');
  for(const trip of data.trips){day(trip.start_date);day(trip.end_date);need(trip.start_date<=trip.end_date,'invalid_seed','Trip dates are reversed.');}
  for(const line of data.lines){cents(line.amount_cents);day(line.date);const report=find(data,'reports',line.report_id);need(report.line_ids.includes(line.id),'invalid_seed','Line/report membership differs.');lineParts(line);if(line.charge_id)find(data,'charges',line.charge_id);if(line.receipt_id)find(data,'receipts',line.receipt_id);}
  for(const report of data.reports){find(data,'trips',report.trip_id);need(report.line_ids.length===new Set(report.line_ids).size,'invalid_seed','Duplicate report lines.');for(const id of report.line_ids)need(find(data,'lines',id).report_id===report.id,'invalid_seed','Wrong expense report.');
    const versions=report.snapshots.map(s=>s.revision);need(versions.length===new Set(versions).size,'invalid_seed','Duplicate submitted report revisions.');
    for(const snap of report.snapshots){need(JSON.stringify(snap.totals)===JSON.stringify(totals(snap.lines)),'invalid_seed','Frozen totals differ from evidence.');for(const l of snap.lines){if(l.receipt_id)find(data,'receipts',l.receipt_id);}}
    if(!['draft','discarded'].includes(report.status)){
      const snap=report.snapshots.find(s=>s.revision===report.revision);need(snap,'invalid_seed','Non-draft report lacks a frozen submission.');
      need(isDeepStrictEqual(snap.lines,report.line_ids.map(id=>find(data,'lines',id))),'invalid_seed','Frozen submission evidence differs from locked expenses.');
    }
    paymentSummary(data,report);
  }
  for(const c of data.charges){cents(c.amount_cents);cents(c.refund_cents);need(c.refund_cents<=c.amount_cents,'invalid_seed','Refund exceeds charge.');}
  for(const r of data.receipts){const source=find(data,'receipt_sources',r.source_record_id);need(r.sha256===source.sha256&&r.source_id===source.source_id&&r.source_revision===source.source_revision,'invalid_seed','Saved original source or hash mismatch.');}
  for(const policy of data.policies){day(policy.effective_from);if(policy.effective_until)need(day(policy.effective_until)>=policy.effective_from,'invalid_seed','Policy effective dates are reversed.');need(stamp(policy.published_at)<=stamp(ctx.virtual_now),'invalid_seed','Future policies must arrive as Infra events.');}
  for(const review of data.reviews){const report=find(data,'reports',review.report_id),snapshot=report.snapshots.find(s=>s.revision===review.report_revision);need(snapshot,'invalid_seed','Review lacks its submitted revision.');for(const [id,amount]of Object.entries(review.approved_line_amounts)){const line=snapshot.lines.find(l=>l.id===id);need(line&&cents(amount)<=sum(lineParts(line).filter(i=>!i.personal).map(i=>i.amount_cents)),'invalid_seed','Approval exceeds its frozen business line.');}}
  for(const group of ['receipt_sources','receipts'])for(const r of data[group])need(stamp(r[group==='receipts'?'registered_at':'available_at'])<=stamp(ctx.virtual_now),'invalid_seed','Future evidence must arrive as an Infra event.');
  const assets=new Map([...data.receipt_sources,...data.receipts].map(r=>[r.asset_id,r.byte_length]));need(assets.size<=48&&sum([...assets.values()])<=768*1024,'capacity_exceeded','Claimline allows at most 48 assets / 768 KiB.');
  for(const p of data.payments){cents(p.amount_cents);need(data.reviews.some(r=>r.report_id===p.report_id&&r.report_revision===p.report_revision&&['approved','partially_approved'].includes(r.decision)),'invalid_seed','Payment lacks an approved report revision.');need(p.history.length>0&&p.history.at(-1).status===p.status,'invalid_seed','Payment history and current status differ.');}
}
function assetReferences(data){const seen=new Set();return [...data.receipt_sources.map(r=>({asset_id:r.asset_id,object_type:'receipt_source',object_id:r.id})),...data.receipts.map(r=>({asset_id:r.asset_id,object_type:'receipt',object_id:r.id}))].filter(r=>{if(seen.has(r.asset_id))return false;seen.add(r.asset_id);return true;});}
module.exports={MAX,copy,fail,need,cents,sum,stamp,day,localDay,plusDays,groups,records,find,allocate,latestSource,editReport,lineParts,totals,preview,evidenceFlags,paymentSummary,addNotice,noticeMessage,validateSeed,assetReferences};
