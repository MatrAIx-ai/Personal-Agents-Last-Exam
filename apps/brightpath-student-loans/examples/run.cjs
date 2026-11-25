'use strict';
const {fixture}=require('../tests/harness.cjs');
const P='brightpath-student-loans.';
function run(){
  const f=fixture(),compareArgs={loan_ids:['loan-1','loan-2'],annual_income_cents:5200000,family_size:2,filing_status:'single'};
  const before=f.snapshot(),comparison=f.read(P+'repayment.plan.compare',compareArgs);if(JSON.stringify(before)!==JSON.stringify(f.snapshot()))throw Error('Comparison mutated state');
  const estimate=f.commit(P+'repayment.estimate.save',{...compareArgs,plan_id:'plan-horizon',request_id:'example-estimate'});
  let application=f.commit(P+'repayment.application.create',{estimate_id:estimate.id,application_type:'repayment_plan',attestations:{information_accurate:true,electronic_signature:true},consent_status:'granted',income_snapshot_id:'income-2025',request_id:'example-application'}).application;
  application=f.commit(P+'repayment.application.submit',{id:application.id,application_version:application.version,confirm_selected_plan:true,request_id:'example-submit'}).application;
  const event=require('./scenario.json');f.event(event);
  return {passed:true,read_only_comparison:{eligible:comparison.comparisons.filter(x=>x.eligible).map(x=>x.plan_id),saved_estimate_id:estimate.id},submitted_application:{id:application.id,status:application.status,receipt_id:application.receipt_id,snapshot:application.submitted_snapshot},event_result:{application_id:event.payload.application_id,status:f.data.applications.find(x=>x.id===event.payload.application_id).status,event_time:f.data.history.find(x=>x.event_id===event.event_id).at},diagnostic_steps:f.logs};
}
module.exports={run};if(require.main===module){console.log(JSON.stringify(run(),null,2));console.log('PASS: Brightpath compare, save, apply, receipt, and event workflow.');}
