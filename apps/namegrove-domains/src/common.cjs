'use strict';
const crypto=require('node:crypto');
function fail(code,message){throw Object.assign(Error(message),{code});}
function copy(value){return structuredClone(value);}
function log(ctx,step,details={}){try{ctx.log?.(step,copy(details));}catch{}}
function id(prefix,key){return `${prefix}-${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0,16)}`;}
function hash(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function matchesHash(value,digest){const actual=Buffer.from(hash(value));const expected=Buffer.from(String(digest));return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}
function find(items,idValue,label='Record'){const item=items.find(x=>x.id===idValue);if(!item)fail('not_found',`${label} does not exist.`);return item;}
function now(ctx){if(!Number.isFinite(Date.parse(ctx.virtual_now)))fail('invalid_time','A valid virtual clock is required.');return ctx.virtual_now;}
function addYears(value,years){const date=new Date(value);const month=date.getUTCMonth();date.setUTCFullYear(date.getUTCFullYear()+years);if(date.getUTCMonth()!==month)date.setUTCDate(0);return date.toISOString();}
function addMinutes(value,minutes){return new Date(Date.parse(value)+minutes*60000).toISOString();}
function ensureVersion(actual,expected,label){if(actual!==expected)fail('stale_record',`${label} changed; inspect it and retry.`);}
module.exports={fail,copy,log,id,hash,matchesHash,find,now,addYears,addMinutes,ensureVersion};
