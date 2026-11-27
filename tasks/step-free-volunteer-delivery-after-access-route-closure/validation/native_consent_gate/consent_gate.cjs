'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function replay(native){
 const mo=native("mail/src/operations.cjs"),me=native("mail/src/events.cjs"),mm=native("mail/src/model.cjs"),co=native("calendar/src/operations.cjs"),cm=native("calendar/src/model.cjs");
 const T=x=>"2026-11-21T"+x+":00+08:00",owner="person-mina",ma="mail-mina",ca="calendar-mina",addr="mina@reading-circle.example";
 const binding={people:[{person_id:owner,name:"Mina"},{person_id:"person-rowan",name:"Rowan"}],accounts:[{app_id:"mail",account_id:ma,owner_person_id:owner},{app_id:"calendar",account_id:ca,owner_person_id:owner}],objects:{calendar:[]}};
 const clone=x=>JSON.parse(JSON.stringify(x));
 const variants=["valid","no-reply","wrong-sender","wrong-item","pre-request","late-reply","wrong-account","duplicate-reply","missing-receipt","wrong-receipt"],results=[];
 for(const mode of variants){
  let mail={account_id:ma,owner_person_id:owner,address:addr,messages:[]},cal={account_id:ca,owner_person_id:owner,calendar_id:"cal-personal",timezone:"Asia/Singapore",events:[]};
  const mc={app_id:"mail",binding,virtual_now:T("09:13")},cc={app_id:"calendar",binding,virtual_now:T("14:20")};
  function send(to,subject,body,at){mc.virtual_now=at;let r=mo.handleTool(mc,clone(mail),"mail.draft.create",{to:[to],subject,body});mail=r.data;const id=r.result.id;r=mo.handleTool(mc,clone(mail),"mail.send",{id});mail=r.data;mm.validateSeed(mc,mail);return mo.handleTool(mc,clone(mail),"mail.get",{id}).result.message;}
  const req=send("rowan@reading-circle.example","SUPPLY-C request","Accept SUPPLY-C to recipient C?",T("09:13"));
  if(req.folder!=="sent"||req.sent_at!==T("09:13"))throw Error("local send");
  const consent="I accept SUPPLY-C to recipient C; request "+req.id;
  function inject(id,from,subject,body,at,account=ma){const ev={event_id:"ev-"+id,at,operation:"mail.deliver",payload:{id,thread_id:req.id,account_id:account,from,to:[addr],subject,body,received_at:at,folder:"inbox",read:false,attachments:[]}};mc.virtual_now=at;mail=me.applyEvent(mc,clone(mail),ev);mm.validateSeed(mc,mail);}
  let error=null;
  if(mode!=="no-reply"){try{inject("reply",mode==="wrong-sender"?"someone@reading-circle.example":"rowan@reading-circle.example","SUPPLY-C reply",mode==="wrong-item"?"I accept KIT-B":consent,mode==="pre-request"?T("09:12"):mode==="late-reply"?T("14:21"):T("14:10"),mode==="wrong-account"?"other":ma);}catch(e){error=e.code||e.message;}}
  if(mode==="duplicate-reply"){try{inject("reply","rowan@reading-circle.example","SUPPLY-C reply",consent,T("14:10"));}catch(e){error=e.code;}}
  mc.virtual_now=T("14:20");
  const reply=mo.handleTool(mc,clone(mail),"mail.search",{query:"SUPPLY-C reply",folder:"inbox"}).result.messages.find(m=>m.from==="rowan@reading-circle.example"&&m.body===consent&&m.thread_id===req.id&&Date.parse(m.received_at)>Date.parse(req.sent_at)&&Date.parse(m.received_at)<=Date.parse(T("14:20")));
  let commit=null;
  if(reply){const r=co.handleTool(cc,clone(cal),"calendar.create",{title:"SUPPLY-C | Rowan | recipient C",start:T("14:20"),end:T("14:24"),timezone:"Asia/Singapore",location:"recipient C"});cal=r.data;cm.validateSeed(cc,cal);commit=co.handleTool(cc,clone(cal),"calendar.get",{id:r.result.id}).result.event;}
  const expected=commit?"SUPPLY-C delivered; commitment "+commit.id+"; 14:24":null;
  if(commit&&mode!=="missing-receipt")inject("receipt",mode==="wrong-receipt"?"rowan@reading-circle.example":"recipient-c@reading-circle.example","SUPPLY-C receipt",expected,T("14:25"));
  const confirmed=!!commit&&mo.handleTool(mc,clone(mail),"mail.search",{query:"SUPPLY-C receipt",folder:"inbox"}).result.messages.some(m=>m.from==="recipient-c@reading-circle.example"&&m.body===expected&&Date.parse(m.received_at)>=Date.parse(commit.end));
  if(!!commit!==["valid","duplicate-reply","missing-receipt","wrong-receipt"].includes(mode)||confirmed!==["valid","duplicate-reply"].includes(mode))throw Error(JSON.stringify({mode,error,commit,confirmed}));
  if(mode==="wrong-account"&&error!=="invalid_seed")throw Error("account rejection "+error);
  if(mode==="duplicate-reply"&&error!=="already_exists")throw Error("duplicate rejection "+error);
  results.push({mode,committed:!!commit,confirmed,error,calendarRecords:cal.events.length});
 }
 return {scope:"synthetic native source replay, exact fixture message semantics, not official grader or authenticated runtime",cases:results,passed:results.length};
}
const root=process.argv[2];if(!root)throw Error('pass pinned PALE checkout');const pins={
  "mail/src/events.cjs": "c1a312bf2fd451cc73ed3d078b673bf8e67e7e7e",
  "mail/src/messaging.cjs": "94b7c0635ba120e89151c6951b016ecab1eda0d1",
  "mail/src/operations.cjs": "991eb2a41aef4dde06f7868fb74b7ce7eedc0596",
  "mail/src/model.cjs": "d8a4f2f74840864c6a27fcad2e6236746903044e",
  "mail/src/domain-utils.cjs": "931f916aa09cdaeec1112a4adcd448bd14ef8556",
  "mail/src/diagnostics.cjs": "67d20e449404aecfac5adf0f100aafbf373c9a5d",
  "calendar/src/operations.cjs": "1159958daf79087d63850b847bd72ddd105b04b2",
  "calendar/src/model.cjs": "017bc695c57b94a5c19c01e85919173062f6fe92",
  "calendar/src/formats/ical.cjs": "254814b017ef25db04b4f7b1eab1c5e5c9f63d2e",
  "calendar/src/domain-utils.cjs": "931f916aa09cdaeec1112a4adcd448bd14ef8556",
  "calendar/src/diagnostics.cjs": "67d20e449404aecfac5adf0f100aafbf373c9a5d"
};
for(const [n,sha] of Object.entries(pins)){const b=fs.readFileSync(path.resolve(root,'examples/apps',n));if(crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex')!==sha)throw Error('pin mismatch '+n);}
console.log(JSON.stringify(replay(n=>require(path.resolve(root,'examples/apps',n))),null,2));
