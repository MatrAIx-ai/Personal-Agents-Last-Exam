'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function regression(native){
 const now="2026-11-16T10:00:00+08:00",tz="Asia/Singapore",owner="person-mina",ca="calendar-mina",ma="mail-mina",cid="cal-reading-circle",addr="mina@reading-circle.example";
 const stamp=(d,t)=>`2026-11-${d}T${t}:00+08:00`;
 const event=(id,title,d,start,end,attendees)=>({id,uid:id+"@reading-circle.example",account_id:ca,calendar_id:cid,title,start:stamp(d,start),end:stamp(d,end),timezone:tz,organizer_person_id:owner,attendees,status:"confirmed",sequence:0,location:"Community Center",attachments:[]});
 const calendar={account_id:ca,owner_person_id:owner,calendar_id:cid,timezone:tz,events:[event("past-review","Accessibility coordination review","02","18:00","18:30",[owner,"person-jules"]),event("shift-jules","Jules Saturday accepted availability","21","14:30","17:00",[owner,"person-jules"])]};
 const msg=(id,sender,subject,body,d,t,ref)=>({id,thread_id:"reading-circle",account_id:ma,from:sender+"@reading-circle.example",to:[addr],subject,body,received_at:stamp(d,t),folder:"inbox",read:false,attachments:[],...(ref?{event_ref:{app_id:"calendar",account_id:ca,object_id:ref}}:{})});
 const mail={account_id:ma,owner_person_id:owner,address:addr,messages:[
 msg("jules-policy","jules","Accepted accessibility conditions","Step-free only. Do not use East Passage stairs.","03","09:00"),
 msg("coordination-policy","mina","Standing policy","Keep confirmed handoffs. Reassign an undelivered item only after explicit item-specific acceptance.","05","18:00"),
 msg("recipient-c","recipient-c","Supply box cutoff","SUPPLY-C must arrive by 14:52 Saturday.","15","15:00"),
 msg("jules-shift","jules","Saturday shift confirmation","Available Saturday 14:30–17:00, step-free only.","16","08:00","shift-jules"),
 msg("rowan-availability","rowan","Backup availability","I can accept at most one stop after 14:00, with a dispatch start from 14:20. Ask me for specific consent.","16","08:15")]};
 const binding={people:[{person_id:owner,name:"Mina"},{person_id:"person-jules",name:"Jules"},{person_id:"person-rowan",name:"Rowan"}],accounts:[{app_id:"mail",account_id:ma,owner_person_id:owner},{app_id:"calendar",account_id:ca,owner_person_id:owner}],objects:{calendar:calendar.events.map(e=>e.id)}};
 const mc={app_id:"mail",binding,virtual_now:now},cc={app_id:"calendar",binding,virtual_now:now};
 const clone=x=>JSON.parse(JSON.stringify(x));const checks=[];function check(name,b){if(!b)throw Error(name);checks.push(name);}
 const mm=native("mail/src/model.cjs"),cm=native("calendar/src/model.cjs"),mo=native("mail/src/operations.cjs"),co=native("calendar/src/operations.cjs");
 mm.validateSeed(mc,mail);cm.validateSeed(cc,calendar);check("native seed validators",true);
 const find=query=>mo.handleTool(mc,clone(mail),"mail.search",{query}).result.messages;
 check("accessibility record discoverable",find("East Passage stairs").some(m=>m.id==="jules-policy"));
 check("backup restriction discoverable",find("at most one stop").some(m=>m.id==="rowan-availability"));
 check("hard cutoff discoverable",find("14:52").some(m=>m.id==="recipient-c"));
 check("cross-App reference resolves",co.handleTool(cc,clone(calendar),"calendar.get",{id:find("Saturday shift confirmation")[0].event_ref.object_id}).result.event.id==="shift-jules");
 const create={title:"KIT-B | Jules | commitment test",start:stamp("21","14:30"),end:stamp("21","14:45"),timezone:tz,location:"Recipient B"};
 let code=null;try{co.handleTool(cc,clone(calendar),"calendar.create",create)}catch(e){code=e.code;}
 check("confirmed availability conflicts",code==="calendar_overlap");
 const control=clone(calendar);control.events=control.events.filter(e=>e.id!=="shift-jules");const r=co.handleTool(cc,control,"calendar.create",create);
 check("counterfactual control creates commitment",r.data.events.some(e=>e.id===r.result.id&&e.title===create.title));
 const bad=clone(mail);bad.messages.find(m=>m.event_ref).event_ref.object_id="missing";let reject=false;try{mm.validateSeed(mc,bad)}catch(e){reject=e.code==="invalid_seed";}check("dangling cross-App reference rejected",reject);
 check("no later messages before first session",mail.messages.every(m=>Date.parse(m.received_at)<Date.parse(now)));
 const past=calendar.events.filter(e=>Date.parse(e.end)<Date.parse(now)),dates=[...new Set([...mail.messages.map(m=>m.received_at.slice(0,10)),...past.map(e=>e.start.slice(0,10))])].sort();
 return {checks,calendarOverlap:code,controlCreated:r.result.id,mailMessages:mail.messages.length,calendarEvents:calendar.events.length,priorDistinctDates:dates.length,dates,scope:"Minimal synthetic source-level reproduction, not a complete task or delivered history."};
}
const root=process.argv[2];if(!root)throw Error('pass pinned PALE checkout');
const pins={
  "mail/src/model.cjs": "d8a4f2f74840864c6a27fcad2e6236746903044e",
  "mail/src/domain-utils.cjs": "931f916aa09cdaeec1112a4adcd448bd14ef8556",
  "mail/src/operations.cjs": "991eb2a41aef4dde06f7868fb74b7ce7eedc0596",
  "mail/src/diagnostics.cjs": "67d20e449404aecfac5adf0f100aafbf373c9a5d",
  "calendar/src/model.cjs": "017bc695c57b94a5c19c01e85919173062f6fe92",
  "calendar/src/domain-utils.cjs": "931f916aa09cdaeec1112a4adcd448bd14ef8556",
  "calendar/src/operations.cjs": "1159958daf79087d63850b847bd72ddd105b04b2",
  "calendar/src/diagnostics.cjs": "67d20e449404aecfac5adf0f100aafbf373c9a5d",
  "calendar/src/formats/ical.cjs": "254814b017ef25db04b4f7b1eab1c5e5c9f63d2e"
};
for(const [name,sha] of Object.entries(pins)){const b=fs.readFileSync(path.resolve(root,'examples/apps',name));const actual=crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');if(actual!==sha)throw Error('pin mismatch '+name);}
console.log(JSON.stringify(regression(n=>require(path.resolve(root,'examples/apps',n))),null,2));
