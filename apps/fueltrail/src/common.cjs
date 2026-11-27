'use strict';
const crypto=require('node:crypto');
function fail(code,message){throw Object.assign(Error(message),{code});}
function copy(value){return structuredClone(value);}
function log(ctx,step,details={}){try{ctx.log?.(step,copy(details));}catch{}}
function id(prefix,requestId){return prefix+'-'+crypto.createHash('sha256').update(String(requestId)).digest('hex').slice(0,16);}
function find(items,idValue,label='record'){const item=items.find(x=>x.id===idValue);if(!item)fail('not_found',label+' does not exist.');return item;}
function activeVehicle(data,idValue){const vehicle=find(data.vehicles,idValue,'Vehicle');if(vehicle.status==='archived')fail('invalid_state','Archived vehicles cannot be changed or used for fuel logs.');return vehicle;}
function now(ctx){if(!Number.isFinite(Date.parse(ctx.virtual_now)))fail('invalid_time','A valid virtual clock is required.');return ctx.virtual_now;}
function totalCents(priceMills,volumeThousandths){return Math.round(priceMills*volumeThousandths/10000);}
function hoursBetween(later,earlier){return (Date.parse(later)-Date.parse(earlier))/3600000;}
module.exports={fail,copy,log,id,find,activeVehicle,now,totalCents,hoursBetween};
