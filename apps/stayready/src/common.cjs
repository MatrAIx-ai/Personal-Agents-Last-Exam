'use strict';
const crypto=require('node:crypto');
const copy=value=>structuredClone(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const pending=r=>['submitted','acknowledged','needs_clarification'].includes(r.status);
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function instant(value){const n=Date.parse(value);if(typeof value!=='string'||!Number.isFinite(n))fail('invalid_time','A valid explicit date-time is required.');return new Date(n).toISOString().replace('.000Z','Z');}
function sorted(values){if(!Array.isArray(values)||new Set(values).size!==values.length)fail('invalid_arguments','Values must be a set without duplicates.');return [...values].sort();}
function window(value){if(!value||Date.parse(value.start)>=Date.parse(value.end))fail('invalid_arguments','Window start must precede end.');return {start:instant(value.start),end:instant(value.end)};}
function lookup(rows,id,kind='Record'){const x=rows.find(x=>x.id===id);if(!x)fail('not_found',kind+' was not found in this account.');return x;}
function nextId(data,prefix){const used=new Set([data.property,data.stay,...data.people,...data.sources,...data.needs,...data.requests,...data.commitments,...data.history].map(x=>x.id));let n=1;while(used.has(prefix+'-'+n))n++;return prefix+'-'+n;}
function record(data,ctx,{kind='operation',operation,outcome,target_id=null,event=null,selector=null,details={}}){const h={id:nextId(data,'history'),kind,at:instant(ctx.virtual_now),operation,outcome,event_id:event?.event_id||null,fingerprint:event?hash(event):null,selector:copy(selector),target_id,details:copy(details)};data.history.push(h);return h;}
function current(data,need){return need.person_ids.every(id=>data.stay.guest_person_ids.includes(id));}
function effectiveStatus(c,now){if(c.status!=='active')return c.status;return c.unavailability.some(n=>Date.parse(n.effective_at)<=Date.parse(now))?'unavailable':'active';}
module.exports={copy,fail,canonical,same,hash,instant,sorted,window,lookup,nextId,record,pending,current,effectiveStatus};
