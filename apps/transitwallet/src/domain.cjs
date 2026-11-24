'use strict';
const crypto=require('node:crypto');
const copy=x=>structuredClone(x);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const check=(v,c,m)=>{if(!v)fail(c,m);};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const collections=['records','equipment','services','bookings','requests','journeys','ledger'];
const all=d=>collections.flatMap(k=>d[k]);
const find=(d,k,id)=>{const x=d[k].find(x=>x.id===id);check(x,'not_found','Unknown '+k+' reference');return x;};
function id(d,p){let n=1,used=new Set(all(d).map(x=>x.id));while(used.has(p+'-'+n))n++;return p+'-'+n;}
const stamp=(ctx,d,operation,object_id,source_id)=>d.history.push({sequence:d.history.length+1,at:ctx.virtual_now,operation,object_id,source_id});
const now=ctx=>Date.parse(ctx.virtual_now),time=x=>Date.parse(x);
const before=(ctx,t)=>now(ctx)<time(t);
const person=(ctx,p)=>ctx.binding.people.some(x=>x.person_id===p);
function effective(ctx,b){return b.status==='held'&&(!before(ctx,b.hold_expires_at)||!before(ctx,b.confirm_before))?'expired':b.status;}
function bookingView(ctx,b){return {...copy(b),effective_status:effective(ctx,b),expiry_reason:effective(ctx,b)==='expired'?(!before(ctx,b.hold_expires_at)?'hold_expired':'confirmation_closed'):null};}
function reservationOpen(ctx,s){return now(ctx)>=time(s.reserve_from)&&before(ctx,s.reserve_before);}
function routeView(ctx,d,s){const used=d.bookings.filter(b=>b.service_id===s.id&&['held','confirmed'].includes(effective(ctx,b))).length;return {...copy(s),free_capacity:Math.max(0,s.capacity-used),reservation_open:reservationOpen(ctx,s)};}
const balance=d=>d.ledger.reduce((n,x)=>n+(x.kind==='debit'?-x.amount_cents:x.amount_cents),0);
function quote(ctx,d,b,action){
 const status=effective(ctx,b);
 if(action==='confirm'){
  check(b.status==='held','invalid_state','Only a held booking can be confirmed');check(status!=='expired','hold_expired','Hold or confirmation window expired');check(before(ctx,b.depart_at),'departure_started','Service already departed');
 }else{
  check(['held','confirmed'].includes(b.status),'invalid_state','Only unused bookings can be cancelled');
  if(b.status==='confirmed')check(before(ctx,b.cancel_before)&&before(ctx,b.depart_at),'cancellation_closed','Paid cancellation cutoff passed');
 }
 const paid=b.status==='confirmed',refund=action==='cancel'&&paid?b.fare_cents-b.cancel_fee_cents:0;
 const v={booking_id:b.id,action,fare_cents:b.fare_cents,retained_fee_cents:action==='cancel'&&paid?b.cancel_fee_cents:0,refund_cents:refund,balance_before_cents:balance(d),balance_after_cents:balance(d)+(action==='confirm'?-b.fare_cents:refund),cutoff:action==='confirm'?(time(b.hold_expires_at)<time(b.confirm_before)?b.hold_expires_at:b.confirm_before):b.status==='confirmed'?b.cancel_before:b.depart_at};
 return {...v,digest:digest({...v,booking:copy(b)})};
}
function ledger(ctx,d,b,kind,amount,source){const row={id:id(d,'ledger'),kind,booking_id:b.id,amount_cents:amount,currency:b.currency,source_id:source,created_at:ctx.virtual_now};d.ledger.push(row);stamp(ctx,d,'ledger.'+kind,row.id,source);return row;}
function select(d,k,selector){const rows=d[k].filter(x=>digest(x.selector)===digest(selector));check(rows.length>0,'not_found','Selector has no historical target');check(rows.length===1,'ambiguous_target','Selector has multiple targets');return rows[0];}
function nextAttempt(rows,key){return Math.max(0,...rows.filter(key).map(x=>x.request_attempt||x.selector?.request_attempt||x.selector?.journey_attempt||x.booking_attempt))+1;}
module.exports={copy,fail,check,canonical,digest,collections,all,find,id,stamp,now,time,before,person,effective,bookingView,reservationOpen,routeView,balance,quote,ledger,select,nextAttempt};
