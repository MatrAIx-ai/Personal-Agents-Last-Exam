'use strict';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail('invalid_time','Use an ISO timestamp with an explicit UTC offset.');
 const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
 if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)fail('invalid_time','Invalid calendar date.');
 return Date.parse(value);
}
function validateSlot(s){
 const start=instant(s.start),end=instant(s.end),minutes=(end-start)/60000;
 if(minutes<15||minutes>120)fail('invalid_time','Meeting duration must be 15–120 minutes.');
 let formatter;try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone:s.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}catch{fail('invalid_time','Unknown IANA timezone.');}
 // UTC inputs are unambiguous instants. Offset-bearing local inputs must exist in the stated zone.
 for(const key of ['start','end'])if(!s[key].endsWith('Z')){
  const p=Object.fromEntries(formatter.formatToParts(new Date(s[key])).map(x=>[x.type,x.value]));
  const local=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  if(local!==s[key].slice(0,19))fail('invalid_time','Local time and UTC offset do not match the timezone; resolve daylight-saving ambiguity explicitly.');
 }
 return {...s,start:new Date(start).toISOString(),end:new Date(end).toISOString()};
}
module.exports={fail,instant,validateSlot};
