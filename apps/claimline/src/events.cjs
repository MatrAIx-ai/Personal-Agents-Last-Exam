'use strict';
const m=require('./model.cjs');
function applyEvent(ctx,original,event){
  m.need(ctx.role==='infra','permission_denied','Review, payment and source events require trusted Infra.');
  const data=m.copy(original),p=event.payload;
  switch(event.operation){
    case 'expense.charge_recorded':{let charge=data.charges.find(r=>r.id===p.charge_id);
      if(!charge){
        m.need(p.source_revision===1,'stale_source','A new charge must start at source revision 1.');
        m.need(typeof p.merchant==='string'&&p.merchant.trim()&&typeof p.date==='string'&&['company_card','personal_card','cash'].includes(p.payment_type)&&p.amount_cents!==undefined,'invalid_source','A new charge needs merchant, date, payment type and amount.');
        m.day(p.date);m.cents(p.amount_cents);const lineage_id=p.lineage_id||p.charge_id;
        m.need(!data.charges.some(r=>r.lineage_id===lineage_id),'duplicate_charge','This transaction lineage already exists.');
        charge={id:p.charge_id,lineage_id,source_revision:0,merchant:p.merchant,date:p.date,payment_type:p.payment_type,status:p.status,amount_cents:p.amount_cents,refund_cents:0,source_ref:p.source_ref,history:[]};data.charges.push(charge);
      }
      for(const key of ['merchant','date','payment_type','lineage_id'])m.need(p[key]===undefined||p[key]===charge[key],'invalid_source','Charge identity cannot change within a transaction lineage.');
      m.need(p.source_revision===charge.source_revision+1,'stale_source','Charge source revision must follow the current revision.');
      m.need(!(charge.status==='settled'&&p.status==='pending')&&!(charge.status==='refunded'&&p.status!=='refunded'),'invalid_state','Charge lineage cannot move backwards.');
      const amount=p.amount_cents??charge.amount_cents,refund=p.refund_cents??charge.refund_cents;m.cents(amount);m.cents(refund);m.need(refund<=amount,'invalid_amount','Refund exceeds charge.');
      Object.assign(charge,{source_revision:p.source_revision,status:p.status,amount_cents:amount,refund_cents:refund,source_ref:p.source_ref});charge.history.push({source_revision:p.source_revision,status:p.status,amount_cents:amount,refund_cents:refund,at:ctx.virtual_now,source_ref:p.source_ref});break;
    }
    case 'expense.receipt_delivered':{const prior=m.latestSource(data,p.source_id);m.need(p.source_revision===(prior?prior.source_revision+1:1),'stale_source','Receipt correction must follow its source revision.');
      const source={items:[],...(prior?m.copy(prior):{}),...p,id:p.source_id+'-v'+p.source_revision,available_at:ctx.virtual_now,status:p.status||'ready'};delete source.file;
      if(p.file){m.need(ctx.assets?.add,'unsupported_capability','Receipt delivery needs the attachment writer.');const [asset_id]=ctx.assets.add({object_type:'receipt_source',object_id:source.id,files:[p.file]});source.asset_id=asset_id;source.sha256=p.file.sha256;source.byte_length=Buffer.from(p.file.base64,'base64').length;}
      m.need(source.asset_id&&source.sha256&&source.merchant&&source.date&&source.amount_cents!==undefined,'invalid_original','A new source requires original bytes and visible receipt fields.');
      if(!p.file)m.need(prior&&source.asset_id===prior.asset_id,'invalid_original','New original bytes must arrive through the public attachment interface.');
      data.receipt_sources.push(source);break;
    }
    case 'expense.request_replied':{const request=m.find(data,'requests',p.request_id);m.need(request.status==='open','invalid_state','Request is not outstanding.');request.replies.push({at:ctx.virtual_now,text:p.text,source_ref:p.source_ref});request.status='answered';break;}
    case 'expense.policy_published':{m.need(!data.policies.some(r=>r.policy_id===p.policy.policy_id&&r.revision>=p.policy.revision),'stale_policy','Policy revisions must increase.');data.policies.push({...m.copy(p.policy),published_at:ctx.virtual_now});break;}
    case 'expense.review_recorded':{const report=m.find(data,'reports',p.report_id);m.need(report.status==='submitted'&&report.revision===p.report_revision,'stale_report','Review must target the currently submitted revision.');
      const snapshot=report.snapshots.find(s=>s.revision===report.revision);let decision=p.decision,amounts={};
      if(['approved','partially_approved'].includes(decision)){
        m.need(m.evidenceFlags(data,snapshot.lines).length===0,'stale_evidence','Evidence changed after submission; return the report for revision.');
        for(const l of snapshot.lines){const business=m.sum(m.lineParts(l).filter(i=>!i.personal).map(i=>i.amount_cents));const approved=p.approved_line_amounts?p.approved_line_amounts[l.id]||0:business;m.cents(approved);m.need(approved<=business,'invalid_approval','A reviewer cannot approve more than the business expense.');amounts[l.id]=approved;}
        m.need(!p.approved_line_amounts||Object.keys(p.approved_line_amounts).every(id=>snapshot.lines.some(l=>l.id===id)),'invalid_approval','Approval includes a foreign line.');
        if(snapshot.lines.some(l=>amounts[l.id]<m.sum(m.lineParts(l).filter(i=>!i.personal).map(i=>i.amount_cents))))decision='partially_approved';
      }
      data.reviews.push({id:m.allocate(data,'review'),report_id:report.id,report_revision:report.revision,decision,reason:p.reason,approved_line_amounts:amounts,at:ctx.virtual_now,source_ref:p.source_ref});report.status=decision;
      if(decision==='returned')report.amend_by=p.amend_by||new Date(m.stamp(ctx.virtual_now)+3*86400000).toISOString();
      m.addNotice(ctx,data,report,decision,p.reason);break;
    }
    case 'expense.payment_recorded':{const report=m.find(data,'reports',p.report_id);m.need(['approved','partially_approved'].includes(report.status)&&report.revision===p.report_revision,'stale_report','Payment requires the approved report revision.');
      m.cents(p.amount_cents);m.need(p.amount_cents>0,'invalid_payment','Payment amount must be positive.');const prior=data.payments.find(r=>r.id===p.payment_id);
      if(prior){m.need(prior.report_id===p.report_id&&prior.report_revision===p.report_revision&&prior.amount_cents===p.amount_cents,'idempotency_conflict','Payment ID identifies different terms.');if(prior.status==='paid'){m.need(p.status==='paid'&&prior.source_ref===p.source_ref,'payment_terminal','A paid payment is terminal.');break;}}
      const others=data.payments.filter(r=>r.id!==p.payment_id&&r.report_id===report.id&&r.report_revision===report.revision&&['paid','scheduled'].includes(r.status));
      const approved=m.paymentSummary(data,report).approved_employee_cents,committed=others.filter(r=>p.status!=='failed'||r.status==='paid');m.need(m.sum(committed.map(r=>r.amount_cents))+p.amount_cents<=approved,'overpayment','Payment exceeds the approved employee balance or its unreserved amount.');
      const payment=prior||{id:p.payment_id,report_id:p.report_id,report_revision:p.report_revision,amount_cents:p.amount_cents,status:p.status,source_ref:p.source_ref,history:[]};
      payment.status=p.status;payment.source_ref=p.source_ref;payment.history.push({at:ctx.virtual_now,status:p.status,source_ref:p.source_ref});if(!prior)data.payments.push(payment);
      m.addNotice(ctx,data,report,'payment '+p.status,'Payment '+p.payment_id+': '+p.status+'; '+p.amount_cents+' USD cents.');break;
    }
    default:m.fail('invalid_event','Unknown expense event.');
  }
  m.validateSeed(ctx,data);return data;
}
module.exports={applyEvent};
