'use strict';
// Build reproducible synthetic evaluation history by replaying the actual lending rules.
// No external data, clock, randomness or dependency.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {handleTool,applyEvent,reconcile,validateSeed}=require('../plugin.cjs');
const app='community-lending-library';
const d0=require('../fixtures/minimal.json'), b=require('../fixtures/binding.json');
const argv=process.argv.slice(2);
const untilArg=argv.includes('--until')?argv[argv.indexOf('--until')+1]:null;
const paired=argv.includes('--profile'), bindingOnly=argv.includes('--binding');
const until=untilArg==null?null:Date.parse(/^\d{4}-\d\d-\d\d$/.test(untilArg)?untilArg+'T00:00:00+08:00':untilArg);
if(argv.includes('--until')&&(!Number.isFinite(until)||!/^(\d{4}-\d\d-\d\d)(T[0-9:.]+(?:Z|[+-]\d\d:\d\d))?$/.test(untilArg)||until<Date.parse('2025-01-01T00:00:00+08:00')||until>=Date.parse('2027-01-01T00:00:00+08:00')))throw Error('--until requires a clock inside 2025–2026 library time; provide YYYY-MM-DD or an ISO timestamp with offset.');
const data=structuredClone(d0);
for(const key of ['holds','loans','queue','attempts','queue_history'])data[key]=[];
for(const key of ['next_hold','next_loan','next_attempt','next_sequence'])data[key]=1;
data.seed_at=data.materialized_at='2025-01-01T00:00:00+08:00';
let state=data, eventNumber=0;
const as=(m,at,role='agent')=>({role,virtual_now:at,binding:{...b,accounts:b.accounts.map(r=>({...r,owner_person_id:m}))}});
function act(m,at,n,args){
 state.member_id=m;
 const {data,result}=handleTool(as(m,at),state,app+'.'+n,args);
 state=data;return result;
}
function event(at,n,payload){
 state=applyEvent(as(state.member_id,at,'infra'),state,{operation:app+'.'+n,payload,event_id:'history-event-'+(++eventNumber)});
}
function resolve(m,at,action,attempt,outcome){
 event(at,'desk_outcome',{operation:action,member_id:m,copy_id:attempt.copy_id,attempt:attempt.attempt,outcome});
}
// Calendar of pickup sessions, with holiday bursts and quieter weeks.
const DAY=86400000, HOUR=3600000, MINUTE=60000;
const stagger=(at,span)=>((Math.floor(at/MINUTE)%span)+span)%span;
const members=['M1','M2','M3','M4'];
const circulation=data.copies.filter(c=>!c.maintenance);
const single=circulation.filter(c=>circulation.filter(k=>k.item_id===c.item_id).length===1);
let rng=0x6b6ce71;
function random(max){rng=(Math.imul(1664525,rng)+1013904223)>>>0;return Math.floor(rng*max/2**32);}
const pick=a=>a[random(a.length)], iso=t=>new Date(t).toISOString();
const time=(month,day,h,m)=>Date.UTC(2025,month,day,h-8,m);
const pending=[];
function plan(t,fn){pending.push({t,fn});}
function send(m,t,n,args){return act(m,iso(t),n,args);}
function status(m,t,c){return send(m,t,'get_item',{item_id:c.item_id}).copies.find(k=>k.id===c.id).status;}
function queue(m,t,c){event(iso(t),'queue_join',{member_id:m,item_id:c.item_id,sequence:state.next_sequence});}
function checkout(m,t,h,reject=false){
 const first=send(m,t,'request_checkout',{hold_id:h.id}).attempt;
 const resolved=t+(7+random(33))*MINUTE;
 plan(resolved,()=>{resolve(m,iso(resolved),'checkout',first,reject?'rejected':'accepted');
   if(reject){const retry=resolved+(34+stagger(resolved,67))*MINUTE;plan(retry,()=>checkout(m,retry,h));}
   else {
    const l=state.loans.at(-1); assert.equal(l.member_id,m);assert.equal(l.copy_id,h.copy_id);
    if(h.keep)return;
    const renew=!!h.renew,due=renew?10:7;
    if(renew){const renewal=resolved+(2+random(3))*DAY+ (8+stagger(resolved,75))*MINUTE;plan(renewal,()=>{if(send(m,renewal,'preview_renewal',{loan_id:l.id}).eligible)send(m,renewal,'confirm_renewal',{loan_id:l.id});});}
    const days=h.fast?1: h.late?due+1+random(2):2+random(due-2);
    const returned=resolved+days*DAY+(12+random(200))*MINUTE;
    plan(returned,()=>{
      const a=send(m,returned,'request_return',{loan_id:l.id}).attempt;
      const receiptAt=returned+(3+stagger(returned,24))*MINUTE;
      plan(receiptAt,()=>{
      resolve(m,iso(receiptAt),'return',a,'accepted');
      if(h.waiter){
       const promoted=state.holds.find(x=>x.copy_id===h.copy_id&&x.member_id===h.waiter&&x.status==='open');
       if(promoted&&h.promotion==='checkout'){const pickup=receiptAt+(19+random(70))*MINUTE;plan(pickup,()=>checkout(h.waiter,pickup,{...promoted,fast:true}));}
       else if(promoted&&h.promotion==='cancel'){const cancelled=receiptAt+(25+random(130))*MINUTE;plan(cancelled,()=>send(h.waiter,cancelled,'cancel_hold',{hold_id:promoted.id}));}
       // No pickup means the regular reconcile path expires the promoted hold.
      }
      });
    });
   }
 });
}
const active=m=>state.holds.filter(x=>x.member_id===m&&x.status==='open').length+state.loans.filter(x=>x.member_id===m&&!x.returned_at).length;
const overdue=(m,t)=>state.loans.some(x=>x.member_id===m&&!x.returned_at&&Date.parse(x.due_at)<=t);
const slot=(start,opts={})=>plan(start,()=>{
 // A normal write advances reconciliation; if an old hold expired, signed Agent
 // availability below sees its projected state without changing that history.
 const eligible=members.filter(m=>active(m)<2&&!overdue(m,start));
 const choices=(opts.waiter?single:circulation).filter(c=>status(members[0],start,c)==='available');
 if(!eligible.length||!choices.length)return;
 const m=opts.member??pick(eligible), c=opts.copy??pick(choices);
 const h=send(m,start,'confirm_hold',{item_id:c.item_id,copy_id:c.id}).hold;
 if(opts.expire||opts.open)return;
 if(opts.cancel){const at=start+(45+random(410))*MINUTE;plan(at,()=>send(m,at,'cancel_hold',{hold_id:h.id}));return;}
 const waiter=opts.waiter?pick(members.filter(k=>k!==m&&active(k)<2&&!overdue(k,start))):undefined;
 if(waiter){
  const join=start+(1+random(3))*HOUR+(5+random(44))*MINUTE;
  plan(join,()=>{if(!state.holds.some(k=>k.member_id===waiter&&k.copy_id===c.id&&k.status==='open')&&!state.loans.some(k=>k.member_id===waiter&&!k.returned_at&&state.copies.find(copy=>copy.id===k.copy_id).item_id===c.item_id))queue(waiter,join,c);});
 }
 const at=start+(18+random(48))*MINUTE;
 plan(at,()=>checkout(m,at,{...h,renew:opts.renew&&!waiter,late:opts.late,fast:opts.fast,waiter,promotion:opts.promotion,keep:opts.keep},opts.reject));
});
slot(time(0,1,10,23),{copy:circulation[4],member:'M2',late:true});
for(let month=0;month<24;month++){
 const heavier=[5,10,11].includes(month%12);
 const days=[month===0?9:1+random(10),13+random(8)];
 if(heavier||random(4)===0)days.push(21+random(month===23?2:5));
 if(!heavier&&random(5)===0)days.splice(1,1);
 for(const day of days){
  const late=month!==23&&random(5)===0, rotate=random(8), waiter=month!==23&&random(4)===0;
  slot(time(month,day,9+random(7),random(60)),{
   late,waiter:waiter&&rotate>1,promotion:['checkout','cancel','expire'][random(3)],renew:random(3)===0,
   cancel:rotate===0,expire:rotate===1,fast:month===23,reject:random(7)===0
  });
 }
}
slot(time(23,30,14,36),{copy:circulation.find(c=>c.id==='C7'),member:'M1',keep:true});
slot(time(23,31,15,51),{copy:circulation.find(c=>c.id==='C8'),member:'M2',open:true});
while(pending.length){
 pending.sort((a,b)=>a.t-b.t);
 const {t,fn}=pending.shift();if(until!==null&&t>until)break;assert.ok(t>=Date.parse(state.materialized_at));
 fn();
}
if(until!==null)reconcile(state,until);
state.member_id='M1';
validateSeed(as('M1',state.materialized_at),state);
const binding={...b,objects:{...b.objects,[app]:[...state.items,...state.copies,...state.holds,...state.loans,...state.attempts].map(x=>x.id)}};
const out=JSON.stringify(state,null,2)+'\n';
if(bindingOnly)process.stdout.write(JSON.stringify(binding,null,2)+'\n');
else if(paired)process.stdout.write(JSON.stringify({data:state,binding,virtual_now:state.materialized_at},null,2)+'\n');
else if(until!==null)process.stdout.write(out);
else if(process.argv.includes('--check'))assert.equal(out,fs.readFileSync(path.join(__dirname,'evaluation-v1.json'),'utf8'));
else fs.writeFileSync(path.join(__dirname,'evaluation-v1.json'),out);
