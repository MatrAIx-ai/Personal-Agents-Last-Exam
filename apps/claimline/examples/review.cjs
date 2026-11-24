'use strict';
const path=require('node:path'),readline=require('node:readline/promises'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),runtime=process.env.PALE_RUNTIME_ROOT||path.join(root,'runtime'),{Client}=require(path.join(runtime,'client.cjs'));
async function main(argv=process.argv.slice(2)){
 const o={run:'claimline-demo',report:'report-1',registry:path.resolve(__dirname,'../registry.json'),'state-dir':path.join(root,'.state')};for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||!argv[i+1])throw Error('Use --run RUN --report ID --decision returned|approved|rejected --reason TEXT, or --payment ID --amount CENTS --status scheduled|paid|failed.');o[argv[i].slice(2)]=argv[i+1];}
 const infra=new Client('claimline','infra',o.run,o['state-dir'],'claimline-trusted-reviewer',{registry:o.registry});try{await infra.initialize();const observed=await infra.call('env.snapshot'),report=observed.snapshot.data.reports.find(r=>r.id===o.report);if(!report)throw Error('Report not found.');
 const payload=o.payment?{payment_id:o.payment,report_id:report.id,report_revision:report.revision,amount_cents:Number(o.amount),status:o.status||'paid',source_ref:o.reason||'local-payment-proof'}:{report_id:report.id,report_revision:report.revision,decision:o.decision||'approved',reason:o.reason||'Evidence reviewed.',source_ref:'trusted-reviewer-terminal',...(o.approved?{approved_line_amounts:JSON.parse(o.approved)}:{})};
 const event={event_id:'trusted-'+crypto.randomUUID(),at:observed.snapshot.virtual_now,operation:o.payment?'expense.payment_recorded':'expense.review_recorded',payload};console.log(JSON.stringify(event,null,2));const terminal=readline.createInterface({input:process.stdin,output:process.stdout});let answer;try{answer=await terminal.question('Apply this exact trusted event? Type CONFIRM: ');}finally{terminal.close();}if(answer!=='CONFIRM'){console.log('No event applied.');return;}const result=await infra.call('env.apply_event',{expected_version:observed.version,event});console.log(JSON.stringify(result,null,2));if(result.status!=='committed')process.exitCode=1;
 }finally{await infra.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
