'use strict';
// Trusted user terminal. This is not an Agent tool or a Web Host browser route.
const path=require('node:path'),readline=require('node:readline/promises');
const root=path.resolve(__dirname,'../../..');
const {Client}=require(path.join(process.env.PALE_RUNTIME_ROOT||path.join(root,'runtime'),'client.cjs'));
async function main() {
  const options={run:'finance-demo',stateDir:path.join(root,'.state'),registry:path.resolve(__dirname,'../registry.json'),decision:'approve'};
  for(let i=2;i<process.argv.length;i+=2) {
    const key=process.argv[i],value=process.argv[i+1],name={'--run':'run','--state-dir':'stateDir','--registry':'registry','--proposal':'proposal','--decision':'decision'}[key];
    if(!name||!value)throw Error('Use --run RUN --proposal ID [--decision approve|reject --state-dir DIR --registry FILE].');
    options[name]=value;
  }
  if(!['approve','reject'].includes(options.decision))throw Error('Decision must be approve or reject.');
  const clients=['agent','infra'].map(role=>new Client('finance',role,options.run,options.stateDir,'finance-trusted-user',{registry:options.registry}));
  try {
    const [agent,infra]=clients;await Promise.all(clients.map(c=>c.initialize()));
    const accounts=await agent.call('finance.accounts.list');
    if(!options.proposal) {for(const id of accounts.action_ids){const r=await agent.call('finance.actions.get',{id});console.log(JSON.stringify({proposal:r.proposal,validity:r.validity},null,2));}return;}
    const observed=await agent.call('finance.actions.get',{id:options.proposal});
    if(observed.status!=='ok')throw Error(observed.message);
    const p=observed.proposal;
    if(p.status!=='pending')throw Error('Only a pending action can receive a decision.');
    if(options.decision==='approve'&&!observed.validity.valid_now)throw Error(observed.validity.reason);
    console.log(JSON.stringify({id:p.id,kind:p.kind,parameters:p.parameters,purpose:p.reason,expires_at:p.expires_at,hash:p.proposal_hash},null,2));
    const prompt=readline.createInterface({input:process.stdin,output:process.stdout});
    let answer;try{answer=await prompt.question('Type '+options.decision.toUpperCase()+' for this exact action: ');}finally{prompt.close();}
    if(answer!==options.decision.toUpperCase())throw Error('No decision recorded.');
    const snapshot=await infra.call('env.snapshot');
    // Preserve the version seen when the user reviewed the terms. A concurrent
    // change must trigger a fresh review instead of silently approving new state.
    const result=await infra.call('env.apply_event',{expected_version:observed.version,event:{event_id:'user-decision-'+Date.now(),
      at:snapshot.snapshot.virtual_now,operation:'finance.decision_recorded',payload:{approval_id:'user-approval-'+Date.now(),
        proposal_id:p.id,proposal_revision:p.revision,decision:options.decision,expires_at:p.expires_at,source_ref:'trusted-user-terminal'}}});
    if(result.status!=='committed')throw Error(result.message||result.status);
    console.log('Decision recorded. Refresh Finance to review or execute the approved action.');
  } finally {await Promise.allSettled(clients.map(c=>c.close()));}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
