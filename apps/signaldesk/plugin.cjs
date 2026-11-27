'use strict';
const {plans,products}=require('./src/catalog.cjs');
const {sweep,find,iso,month,nextCycle,fail,stateOf,allocation,postUsage}=require('./src/billing.cjs');
const {changeTerms,commitChange}=require('./src/changes.cjs');

function validateSeed(ctx,d) {
  const account=ctx.binding.accounts.find(a=>a.app_id==='signaldesk' && a.account_id===d.account_id);
  if(!account || account.owner_person_id!==d.owner_person_id) fail('invalid_seed','Account is outside the identity binding.');
  if((d.role==='owner')!==(d.actor_id===d.owner_person_id)) fail('invalid_seed','Invalid actor role.');
  if(!d.lines.some(l=>l.person_id===d.actor_id) || d.lines.some(l=>!ctx.binding.people.some(p=>p.person_id===l.person_id))) fail('invalid_seed','Unbound line owner.');
  if(ctx.virtual_now && Date.parse(d.settled_at)>Date.parse(ctx.virtual_now)) fail('invalid_seed','Ledger settlement is ahead of the task clock.');
  find(plans,d.plan_id);
  if(d.pending) {
    find(plans,d.pending.plan_id);
    if(iso(d.pending.effective)!==nextCycle(d.settled_at)) fail('invalid_seed','Pending plan must begin at the next monthly boundary.');
  }
  for(const rows of [d.lines,d.usage,d.passes,d.charges,d.notices,d.previews,d.receipts]){
    if(new Set(rows.map(r=>r.id)).size!==rows.length) fail('invalid_seed','Duplicate record ID.');
  }
  for(const row of d.usage) {
    find(d.lines,row.line_id);
    if(Date.parse(row.occurred_at)>Date.parse(d.settled_at)) fail('invalid_seed','Usage exceeds settled history.');
    if((row.included_mb||0)+(row.pass_mb||0)+(row.uncovered_mb||0)>row.amount_mb) fail('invalid_seed','Usage allocation exceeds reported traffic.');
  }
  for(const pass of d.passes){
    find(d.lines,pass.line_id);
    const product=find(products,pass.product_id);
    if(!product.coverage.includes(pass.destination)||pass.remaining_mb>product.data_mb||Date.parse(pass.end)-Date.parse(pass.start)!==product.days*86400000) fail('invalid_seed','Invalid pass terms.');
    if(!pass.cancelled && d.passes.some(p=>p.id!==pass.id && !p.cancelled && p.line_id===pass.line_id && Date.parse(p.start)<Date.parse(pass.end) && Date.parse(pass.start)<Date.parse(p.end))) fail('invalid_seed','Pass intervals overlap.');
  }
}
function view(d,name,now){
  const owner=d.role==='owner';
  const lines=d.lines.filter(l=>owner||l.person_id===d.actor_id);
  const visible=r=>owner||lines.some(l=>l.id===r.line_id);
  switch(name){
    case 'account': return {account_id:d.account_id,role:d.role,cycle:month(now),plan_id:d.plan_id,lines:lines.map(l=>({...l,...allocation(d,now,l.id)})),usage:d.usage.filter(visible)};
    case 'catalog': return {plans,products,effective:nextCycle(now)};
    case 'plan': return {active:find(plans,d.plan_id),pending:owner?d.pending:null,effective:nextCycle(now),preview:owner?d.previews.find(p=>p.terms.action.endsWith('_plan')):null};
    case 'passes': return {passes:d.passes.filter(visible).map(p=>({...p,status:stateOf(p,now),coverage:find(products,p.product_id).coverage})),preview:owner?d.previews.find(p=>p.terms.action.endsWith('_pass')):null};
    case 'statement': {
      const charges=d.charges.filter(visible), totals={};
      for(const row of charges) totals[month(row.at)]=(totals[month(row.at)]||0)+row.cents;
      return {charges,monthly_totals_cents:totals,notices:d.notices.filter(visible),receipts:owner?d.receipts:[]};
    }
    default: fail('invalid_arguments','Unknown view.');
  }
}
function handleTool(ctx,data,name,args){
  const action=name.split('.')[1], now=iso(ctx.virtual_now);
  if(['account','catalog','plan','passes','statement'].includes(action)){
    const projected=structuredClone(data); sweep(projected,now);
    projected.notices=data.notices;
    return {data,result:{details:view(projected,action,now)}};
  }
  if(data.role!=='owner') fail('permission_denied','Only the account owner can change service.');
  sweep(data,now);
  const id='change-'+data.sequence++;
  if(action==='preview'){
    const terms=changeTerms(data,args,now);
    const preview={id,terms,version:{epoch:args.expected_version.epoch,revision:args.expected_version.revision+1}};
    data.previews=[preview];
    return {data,result:{details:preview}};
  }
  const preview=find(data.previews,args.preview_id);
  if(action==='confirm' && (preview.version.epoch!==args.expected_version.epoch||preview.version.revision!==args.expected_version.revision))
    fail('stale_version','Review a new preview after an intervening update.');
  data.previews=data.previews.filter(p=>p.id!==preview.id);
  if(action==='abandon') return {data,result:{details:{abandoned:preview.id}}};
  if(action!=='confirm') fail('invalid_arguments','Unknown operation.');
  const terms=changeTerms(data,preview.terms,now);
  const source=commitChange(data,terms,id,now);
  const receipt={id,source,at:now,terms};
  data.receipts.push(receipt);
  return {data,result:{details:receipt}};
}
function applyEvent(ctx,d,e){
  const now=iso(ctx.virtual_now),p=e.payload;
  sweep(d,now);
  if(e.operation==='signaldesk.post_usage') postUsage(d,p,now,e.event_id);
  else if(e.operation==='signaldesk.account_update'){
    if(p.actor_person_id!==d.owner_person_id) fail('permission_denied','Account owner required.');
    const input=p.action==='cancel_pending_plan_change'?{action:'cancel_plan',target_id:p.plan_change_id}:p;
    const terms=changeTerms(d,input,now);
    const id='change-'+d.sequence++;
    const source=commitChange(d,terms,id,now);
    d.receipts.push({id,source,terms,at:now});
  }else fail('invalid_event','Unknown carrier event.');
  return d;
}
module.exports={validateSeed,handleTool,applyEvent,records:d=>d.lines,objects:d=>d.lines.map(l=>l.id),references:()=>[]};
