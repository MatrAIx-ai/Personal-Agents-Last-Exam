'use strict';
const crypto=require('node:crypto');
function fail(code,message){throw Object.assign(Error(message),{code});}
function copy(value){return structuredClone(value);}
function log(ctx,step,details={}){try{ctx.log?.(step,copy(details));}catch{}}
function id(prefix,key){return `${prefix}-${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0,16)}`;}
function find(items,value,label='Record'){const row=items.find(x=>x.id===value);if(!row)fail('not_found',`${label} does not exist.`);return row;}
function now(ctx){if(!Number.isFinite(Date.parse(ctx.virtual_now)))fail('invalid_time','A valid virtual clock is required.');return ctx.virtual_now;}
function addMinutes(value,minutes){return new Date(Date.parse(value)+minutes*60000).toISOString();}
function ensureVersion(actual,expected,label){if(actual!==expected)fail('stale_record',`${label} changed; inspect it and retry.`);}
function text(value,label,max=500){const out=String(value??'').trim();if(!out||out.length>max)fail('invalid_arguments',`${label} must contain 1-${max} characters.`);return out;}
module.exports={fail,copy,log,id,find,now,addMinutes,ensureVersion,text};
