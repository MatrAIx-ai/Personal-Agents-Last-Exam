'use strict';
const {plans, products} = require('./catalog.cjs');
const iso = time => new Date(time).toISOString();
const month = time => iso(time).slice(0,7);
function nextCycle(time) {
  const d = new Date(time);
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1));
}
function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function find(rows, id) {
  const row = rows.find(r=>r.id===id);
  if (!row) fail('not_found','Unknown record: '+id);
  return row;
}
function stateOf(pass, now) {
  if (pass.cancelled) return 'cancelled';
  if (now < iso(pass.start)) return 'scheduled';
  return now < iso(pass.end) ? 'active' : 'expired';
}
function notice(d, id, at, source, text, line_id=null) {
  d.notices.push({id,at,source,text,line_id});
}
function sweep(d, time) {
  const now=iso(time), events=[];
  const settled=iso(d.settled_at);
  if (now < settled) fail('invalid_time','Clock precedes the settled ledger.');
  for (let at=nextCycle(d.settled_at); at<=now; at=nextCycle(at)) events.push({at,order:0});
  for (const pass of d.passes.filter(p=>!p.cancelled)) {
    for (const [at,order] of [[iso(pass.end),1],[iso(pass.start),2]]) {
      if (at>settled && at<=now) events.push({at,order,pass});
    }
  }
  events.sort((a,b)=>a.at.localeCompare(b.at)||a.order-b.order);
  for (const {at,order,pass} of events) {
    if (order===0 && d.pending && iso(d.pending.effective)===at) {d.plan_id=d.pending.plan_id; d.pending=null;}
    if (order===1) {notice(d,'expiry-'+pass.id,at,pass.id,'Pass expired',pass.line_id);continue;}
    const source=pass?.id || d.plan_id, id=pass?'activation-'+pass.id:'monthly-'+month(at);
    const amount=pass?find(products,pass.product_id).price:find(plans,d.plan_id).price;
    d.charges.push({id,at,source,line_id:pass?.line_id||null,cents:amount});
    notice(d,'notice-'+id,at,id,pass?'Pass activated':'New billing cycle',pass?.line_id||null);
  }
  d.settled_at=now;
}
function allocation(d, at, line) {
  const rows=d.usage.filter(u=>month(u.occurred_at)===month(at));
  const sum=rs=>rs.reduce((n,u)=>n+u.amount_mb-(u.uncovered_mb||0),0);
  const plan=find(plans,d.plan_id);
  return {
    domestic_remaining_mb: Math.max(0,plan.domestic_mb-sum(rows.filter(u=>u.kind!=='roaming'))),
    hotspot_remaining_mb: Math.max(0,plan.hotspot_mb-sum(rows.filter(u=>u.line_id===line && u.kind==='hotspot'))),
    roaming_remaining_mb: plan.roaming_mb-rows.filter(u=>u.line_id===line).reduce((n,u)=>n+(u.included_mb||0),0)
  };
}
function postUsage(d,p,at,eventId) {
  find(d.lines,p.line_id);
  if (iso(p.occurred_at)!==at) fail('invalid_time','Post usage at its occurrence time.');
  const plan=find(plans,d.plan_id), b=allocation(d,at,p.line_id);
  const row={...p,occurred_at:at,id:eventId};
  let available=b.domestic_remaining_mb;
  if (p.kind==='hotspot') available=Math.min(available,b.hotspot_remaining_mb);
  if (p.kind==='roaming') {
    const included=plan.coverage.includes(p.destination)?b.roaming_remaining_mb:0;
    row.included_mb=Math.min(included,p.amount_mb);
    const pass=d.passes.find(x=>x.line_id===p.line_id && stateOf(x,at)==='active' && find(products,x.product_id).coverage.includes(p.destination));
    available=included+(pass?.remaining_mb||0);
    if(pass){ row.pass_id=pass.id;row.pass_mb=Math.min(pass.remaining_mb,p.amount_mb-row.included_mb);pass.remaining_mb-=row.pass_mb; }
  }
  row.uncovered_mb=Math.max(0,p.amount_mb-available);
  d.usage.push(row);
  if(p.amount_mb>=available) notice(d,'limit-'+eventId,at,eventId,'Allowance reached or unavailable',p.line_id);
  else if(p.kind!=='roaming' && b.domestic_remaining_mb>plan.domestic_mb/5 && b.domestic_remaining_mb-p.amount_mb<=plan.domestic_mb/5)
    notice(d,'threshold-'+eventId,at,eventId,'Household data reached 80% of its monthly allowance',p.line_id);
}
module.exports={sweep,find,iso,month,nextCycle,fail,notice,allocation,stateOf,postUsage};
