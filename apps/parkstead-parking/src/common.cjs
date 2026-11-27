'use strict';
const crypto=require('node:crypto');
const copy=value=>structuredClone(value);
function fail(code,message,details){throw Object.assign(new Error(message),{code,details});}
function find(rows,id,label='Object'){const row=rows.find(x=>x.id===id);if(!row)fail('not_found',`${label} ${id} does not exist.`);return row;}
function now(ctx){const value=ctx.virtual_now;if(!Number.isFinite(Date.parse(value)))fail('invalid_time','Virtual time is invalid.');return new Date(value).toISOString();}
function ensureVersion(row,version,label='Record'){if(row.version!==version)fail('stale_record',`${label} version ${version} is stale; current version is ${row.version}.`,{current_version:row.version});}
function id(prefix,key){return `${prefix}-${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0,16)}`;}
function log(ctx,step,details){try{ctx.log?.(step,details);}catch{}}
function overlap(a0,a1,b0,b1){return Date.parse(a0)<Date.parse(b1)&&Date.parse(b0)<Date.parse(a1);}
function assertWindow(arrival,departure){const a=Date.parse(arrival),d=Date.parse(departure);if(!Number.isFinite(a)||!Number.isFinite(d)||a>=d)fail('invalid_time_range','Arrival must be before departure.');if(d-a>31*86400000)fail('invalid_time_range','Parking windows cannot exceed 31 days.');return {a,d};}
function money(value,label='amount'){if(!Number.isInteger(value)||value<0)fail('invalid_arguments',`${label} must be a non-negative integer number of cents.`);return value;}
module.exports={copy,fail,find,now,ensureVersion,id,log,overlap,assertWindow,money};
