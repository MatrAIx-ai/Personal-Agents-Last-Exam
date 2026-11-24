'use strict';
const m=require('./model.cjs');
const crypto=require('node:crypto');
function handleTool(ctx,original,name,a){
  const data=m.copy(original);let result;
  const row=(group,id=a.id)=>m.find(data,group,id);
  const reportFor=line=>m.editReport(data,row('reports',line.report_id));
  const readFile=source=>{m.need(ctx.assets?.read,'unsupported_capability','Original bytes need the public resource reader.');return ctx.assets.read(source.asset_id);};
  switch(name){
    case 'expense.workspace.get':result={workspace:data};break;
    case 'expense.trips.list':result={trips:data.trips};break;
    case 'expense.trips.create':{const trip={id:m.allocate(data,'trip'),name:a.name,purpose:a.purpose,start_date:a.start_date,end_date:a.end_date,cost_center:a.cost_center,source_ref:a.source_ref,revision:1};data.trips.push(trip);result={trip};break;}
    case 'expense.trips.update':{const trip=row('trips');m.need(!data.reports.some(r=>r.trip_id===trip.id&&!['draft','returned','discarded'].includes(r.status)),'report_locked','Trip context is frozen by a submitted report.');Object.assign(trip,a.patch);trip.revision++;result={trip};break;}
    case 'expense.charges.list':result={charges:data.charges};break;
    case 'expense.receipts.list':result={sources:data.receipt_sources,receipts:data.receipts};break;
    case 'expense.receipts.download':{const source=row('receipt_sources');m.need(source.status==='ready'&&m.stamp(ctx.virtual_now)>=m.stamp(source.available_at)&&m.stamp(ctx.virtual_now)<m.stamp(source.available_until),'source_expired','Merchant original is expired, unavailable or voided.');result={source,file:readFile(source)};break;}
    case 'expense.receipts.read':{const receipt=row('receipts');result={receipt,file:readFile(receipt)};break;}
    case 'expense.receipts.register':{
      const source=row('receipt_sources',a.source_record_id);m.need(source.status==='ready','source_expired','A voided original cannot be newly registered.');
      m.need(!data.receipts.some(r=>r.source_record_id===source.id),'duplicate_receipt','This original version is already saved.');
      const known=readFile(source);m.need(a.file.sha256===source.sha256&&a.file.mime_type===known.mime_type&&a.file.base64===known.base64,'invalid_original','Registration must preserve the obtained original bytes.');
      if(a.file_ref)m.need(a.file_ref.sha256===source.sha256&&a.file_ref.app_id==='files','invalid_original','External Files reference does not identify these original bytes.');
      const id=m.allocate(data,'receipt');m.need(ctx.assets?.add,'unsupported_capability','The public attachment writer is required.');
      const [asset_id]=ctx.assets.add({object_type:'receipt',object_id:id,files:[a.file]});
      const receipt={id,source_record_id:source.id,source_id:source.source_id,source_revision:source.source_revision,sha256:source.sha256,asset_id,byte_length:source.byte_length,registered_at:ctx.virtual_now,file_ref:a.file_ref||null};data.receipts.push(receipt);result={receipt};break;
    }
    case 'expense.matches.preview':{
      const receipt=row('receipts',a.receipt_id),source=row('receipt_sources',receipt.source_record_id);
      result={receipt_id:receipt.id,candidates:data.lines.filter(l=>l.merchant===source.merchant&&l.date===source.date&&l.amount_cents===source.amount_cents&&!l.receipt_id).map(l=>({line_id:l.id,charge_id:l.charge_id,merchant:l.merchant,date:l.date,amount_cents:l.amount_cents})),source};break;
    }
    case 'expense.matches.confirm':{const line=row('lines',a.line_id);reportFor(line);const receipt=row('receipts',a.receipt_id),source=row('receipt_sources',receipt.source_record_id);
      m.need(!data.lines.some(l=>l.id!==line.id&&l.receipt_id===receipt.id),'duplicate_receipt','Original is already associated with an expense.');
      m.need(source.merchant===line.merchant&&source.date===line.date&&source.amount_cents===line.amount_cents,'receipt_mismatch','Confirm only matching merchant, date and amount.');line.receipt_id=receipt.id;line.revision++;result={line};break;}
    case 'expense.matches.separate':{const line=row('lines',a.line_id);reportFor(line);line.receipt_id=null;line.revision++;result={line};break;}
    case 'expense.lines.create':{
      const report=m.editReport(data,row('reports',a.report_id)),trip=row('trips',report.trip_id);const charge=a.charge_id?row('charges',a.charge_id):null;
      const line={id:m.allocate(data,'line'),report_id:report.id,charge_id:a.charge_id||null,charge_revision:charge?.source_revision||null,receipt_id:null,merchant:a.merchant,date:a.date,amount_cents:a.amount_cents,category:a.category,payment_type:a.payment_type,purpose:a.purpose,purpose_source_ref:a.purpose_source_ref,attendees:a.attendees||[],cost_center:trip.cost_center,itemizations:[],personal:a.personal||false,explanation:a.explanation||'',revision:1};
      data.lines.push(line);report.line_ids.push(line.id);result={line};break;
    }
    case 'expense.lines.update':{const line=row('lines');reportFor(line);Object.assign(line,a.patch);if(line.charge_id)line.charge_revision=row('charges',line.charge_id).source_revision;line.revision++;result={line};break;}
    case 'expense.lines.itemize':{const line=row('lines');reportFor(line);m.need(a.items.length&&m.sum(a.items.map(r=>r.amount_cents))===line.amount_cents,'invalid_itemization','Itemization must preserve the complete original amount.');line.itemizations=m.copy(a.items);line.revision++;result={line};break;}
    case 'expense.requests.create':{const request={id:m.allocate(data,'request'),report_id:a.report_id||null,recipient:a.recipient,question:a.question,status:'open',at:ctx.virtual_now,replies:[]};if(request.report_id)row('reports',request.report_id);data.requests.push(request);result={request};break;}
    case 'expense.requests.cancel':{const request=row('requests');m.need(request.status==='open','invalid_state','Only an outstanding request can be cancelled.');request.status='cancelled';result={request};break;}
    case 'expense.policy.get':result={policies:data.policies};break;
    case 'expense.reports.list':result={reports:data.reports};break;
    case 'expense.reports.get':{const report=row('reports');result={report,preview:m.preview(ctx,data,report),payment:m.paymentSummary(data,report),reviews:data.reviews.filter(r=>r.report_id===report.id)};break;}
    case 'expense.reports.create':{row('trips',a.trip_id);const report={id:m.allocate(data,'report'),trip_id:a.trip_id,name:a.name,status:'draft',revision:1,line_ids:[],snapshots:[],first_submitted_at:null,amend_by:null};data.reports.push(report);result={report};break;}
    case 'expense.reports.preview':result={preview:m.preview(ctx,data,row('reports'))};break;
    case 'expense.reports.submit':{const report=m.editReport(data,row('reports')),preview=m.preview(ctx,data,report);m.need(preview.can_submit,'policy_blocked',preview.findings.map(f=>f.message).join(' '));
      report.first_submitted_at??=ctx.virtual_now;report.status='submitted';report.snapshots.push({revision:report.revision,submitted_at:ctx.virtual_now,first_submitted_at:report.first_submitted_at,trip:m.copy(row('trips',report.trip_id)),policy_ids:preview.policy_ids,lines:report.line_ids.map(id=>m.copy(row('lines',id))),totals:preview.totals});m.addNotice(ctx,data,report,'submitted','Report revision '+report.revision+' submitted for review.');result={report};break;
    }
    case 'expense.reports.withdraw':{const report=row('reports');m.need(report.status==='submitted'&&!data.reviews.some(r=>r.report_id===report.id&&r.report_revision===report.revision),'report_locked','Withdrawal is allowed only before a review decision.');report.status='draft';report.revision++;report.amend_by=null;result={report};break;}
    case 'expense.reports.discard':{const report=m.editReport(data,row('reports'));report.status='discarded';result={report};break;}
    case 'expense.reports.export':{const report=row('reports'),snapshot=report.snapshots.find(s=>s.revision===(a.revision||report.revision));m.need(snapshot,'not_found','Choose a submitted report revision.');const text=JSON.stringify({report_id:report.id,name:report.name,snapshot,payment:m.paymentSummary(data,report)},null,2)+'\n',bytes=Buffer.from(text);result={file:{filename:report.id+'-r'+snapshot.revision+'.json',mime_type:'application/json',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};break;}
    case 'expense.payments.list':result={payments:data.payments,reviews:data.reviews,summaries:data.reports.map(r=>({report_id:r.id,...m.paymentSummary(data,r)}))};break;
    case 'expense.notices.list':result={notices:data.notices.map(n=>({notice:n,message:m.noticeMessage(data,n)}))};break;
    default:m.fail('unknown_tool','Unknown expense operation.');
  }
  m.validateSeed(ctx,data);return {data,result:m.copy(result)};
}
module.exports={handleTool};
