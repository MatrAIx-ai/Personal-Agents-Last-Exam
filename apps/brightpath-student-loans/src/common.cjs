'use strict';
const crypto=require('node:crypto');
function fail(code,message){throw Object.assign(Error(message),{code});}
function copy(value){return structuredClone(value);}
function log(ctx,step,details={}){try{ctx.log?.(step,copy(details));}catch{}}
function id(prefix,key){return prefix+'-'+crypto.createHash('sha256').update(String(key)).digest('hex').slice(0,16);}
function find(items,value,label='Record'){const item=items.find(x=>x.id===value);if(!item)fail('not_found',label+' does not exist or is outside this borrower account.');return item;}
function now(ctx){if(!Number.isFinite(Date.parse(ctx.virtual_now)))fail('invalid_time','A valid virtual clock is required.');return ctx.virtual_now;}
function ensureVersion(record,expected,label){if(record.version!==expected)fail('stale_record',label+' changed; inspect it and retry.');}
function dateOnly(value){return new Date(value).toISOString().slice(0,10);}
module.exports={fail,copy,log,id,find,now,ensureVersion,dateOnly};
