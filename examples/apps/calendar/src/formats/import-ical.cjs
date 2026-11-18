'use strict';
// Bounded RFC 5545 interchange: one UTC VEVENT. Never silently discard semantics.
const {fail,overlap}=require('../domain-utils.cjs');
const {log}=require('../diagnostics.cjs');
const unescape=s=>s.replace(/\\([nN,;\\])/g,(_,c)=>/[nN]/.test(c)?'\n':c);
function parse(text){
 if(typeof text!=='string'||text.length>100000||/[\x00]/.test(text))fail('invalid_ics','Invalid calendar text');
 const lines=text.replace(/\r\n[ \t]/g,'').replace(/\n[ \t]/g,'').split(/\r?\n/).filter(Boolean);
 if(lines[0]!=='BEGIN:VCALENDAR'||lines.at(-1)!=='END:VCALENDAR')fail('invalid_ics','Expected VCALENDAR');
 let level='calendar',seen=false,ended=false;const values={},calendar={};
 const allowed=new Set(['UID','DTSTAMP','DTSTART','DTEND','SUMMARY','LOCATION','SEQUENCE','STATUS']);
 for(const line of lines.slice(1,-1)){
  if(line==='BEGIN:VEVENT'){if(level!=='calendar'||seen)fail('unsupported_ics','Import one VEVENT at a time');seen=true;level='event';continue;}
  if(line==='END:VEVENT'){if(level!=='event')fail('invalid_ics','Unexpected component end');level='calendar';ended=true;continue;}
  const match=line.match(/^([A-Z-]+):(.*)$/);if(!match)fail('unsupported_ics','Parameters, nested components or malformed lines are not supported');
  const [,key,value]=match,target=level==='event'?values:calendar;
  if(level==='event'?!allowed.has(key):!['VERSION','PRODID','CALSCALE'].includes(key))fail('unsupported_ics','Unsupported calendar property: '+key);
  if(Object.hasOwn(target,key))fail('invalid_ics','Duplicate calendar property');target[key]=value;
 }
 if(!seen||!ended||level!=='calendar'||calendar.VERSION!=='2.0'||!calendar.PRODID||calendar.CALSCALE&&calendar.CALSCALE!=='GREGORIAN')fail('invalid_ics','Incomplete calendar');
 for(const key of ['UID','DTSTAMP','DTSTART','DTEND','SUMMARY'])if(!values[key])fail('invalid_ics','Missing '+key);
 function date(v){
  if(!/^\d{8}T\d{6}Z$/.test(v))fail('unsupported_ics','UTC date-times are required');
  const iso=v.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/,'$1-$2-$3T$4:$5:$6Z'),d=new Date(iso);
  if(!Number.isFinite(+d)||d.toISOString().replace(/[-:]/g,'').replace('.000Z','Z')!==v)fail('invalid_ics','Invalid calendar date');return iso;
 }
 date(values.DTSTAMP);const start=date(values.DTSTART),end=date(values.DTEND);
 if(Date.parse(start)>=Date.parse(end))fail('invalid_ics','Start must precede end');
 if(values.SEQUENCE!==undefined&&!/^\d{1,9}$/.test(values.SEQUENCE))fail('invalid_ics','Invalid sequence');
 if(values.STATUS&&!['CONFIRMED','CANCELLED'].includes(values.STATUS))fail('unsupported_ics','Unsupported event status');
 return {uid:unescape(values.UID),title:unescape(values.SUMMARY),start,end,timezone:'UTC',location:unescape(values.LOCATION||''),sequence:Number(values.SEQUENCE||0),status:(values.STATUS||'CONFIRMED').toLowerCase()};
}
function importCalendar(ctx,data,args){
 const fields=parse(args.text),old=data.events.find(e=>e.uid===fields.uid);
 if(old&&fields.sequence<old.sequence)fail('stale_event','An older calendar sequence cannot overwrite this event');
 if(old&&fields.sequence===old.sequence){
  const equal=['uid','title','location','status','sequence'].every(k=>old[k]===fields[k])&&Date.parse(old.start)===Date.parse(fields.start)&&Date.parse(old.end)===Date.parse(fields.end);
  if(!equal)fail('sequence_conflict','Changed event requires a newer SEQUENCE');return {data,result:{id:old.id}};
 }
 if(fields.status!=='cancelled'&&data.events.some(e=>e.id!==old?.id&&e.status!=='cancelled'&&overlap(e,fields)))fail('calendar_overlap','Imported event conflicts with this calendar');
 let n=1;while(data.events.some(e=>e.id==='evt-import-'+n))n++;
 const e=old||{id:'evt-import-'+n,account_id:data.account_id,calendar_id:data.calendar_id,organizer_person_id:data.owner_person_id,attendees:[data.owner_person_id]};Object.assign(e,fields);if(!old)data.events.push(e);
 log(ctx,'calendar.import_ics.prepared',{object_id:e.id});return {data,result:{id:e.id}};
}
module.exports={parse,importCalendar};
