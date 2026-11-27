'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');

function regression(native) {
  const tz='Asia/Singapore', owner='person-mina', ca='calendar-mina', ma='mail-mina', cid='cal-reading-circle';
  const now='2026-11-21T14:20:00+08:00', stamp=(d,t)=>'2026-11-'+d+'T'+t+':00+08:00';
  const person=id=>({person_id:id,name:id});
  const event=(id,title,d,start,end)=>({id,uid:id+'@reading-circle.example',account_id:ca,calendar_id:cid,title,start:stamp(d,start),end:stamp(d,end),timezone:tz,organizer_person_id:owner,attendees:[owner],status:'confirmed',sequence:0,location:'Community Center',attachments:[]});
  const historic=event('availability-review','Jules and Rowan availability confirmation', '16','08:00','08:15');
  const blocking=event('shift-jules','Jules Saturday availability','21','14:30','17:00');
  const calendar={account_id:ca,owner_person_id:owner,calendar_id:cid,timezone:tz,events:[historic]};
  const msg=(id,from,body)=>({id,thread_id:'reading-circle',account_id:ma,from:from+'@reading-circle.example',to:['mina@reading-circle.example'],subject:'Accepted availability',body,received_at:stamp('16','08:20'),folder:'inbox',read:false,attachments:[],event_ref:{app_id:'calendar',account_id:ca,object_id:historic.id}});
  const mail={account_id:ma,owner_person_id:owner,address:'mina@reading-circle.example',messages:[msg('jules-window','jules','Jules: Saturday 14:30–17:00; step-free only.'),msg('rowan-window','rowan','Rowan: one item, available from 14:20; requires explicit consent.')]};
  const binding={people:[owner,'person-jules','person-rowan'].map(person),accounts:[{app_id:'calendar',account_id:ca,owner_person_id:owner},{app_id:'mail',account_id:ma,owner_person_id:owner}],objects:{calendar:[historic.id,blocking.id]}};
  const cc={app_id:'calendar',binding,virtual_now:now}, mc={app_id:'mail',binding,virtual_now:now};
  const cm=native('calendar/src/model.cjs'), co=native('calendar/src/operations.cjs'), mm=native('mail/src/model.cjs'), mo=native('mail/src/operations.cjs');
  const clone=x=>JSON.parse(JSON.stringify(x)); const checks=[];
  function check(name,value){if(!value)throw Error(name);checks.push(name)}
  function code(f){try{f();return null}catch(e){return e.code}}
  function tool(state,name,args){return co.handleTool(cc,clone(state),name,args)}
  const create=(title,start,end)=>({title,start:stamp('21',start),end:stamp('21',end),timezone:tz,location:'Recipient'});
  const kit=create('KIT-B | Jules | route commitment','14:30','14:45');
  const supply=create('SUPPLY-C | Rowan | route commitment','14:20','14:24');
  cm.validateSeed(cc,calendar);mm.validateSeed(mc,mail);check('native seed validation',true);
  const found=mo.handleTool(mc,clone(mail),'mail.search',{query:'Saturday 14:30'}).result.messages;
  check('dated accepted window discoverable',found.some(m=>m.id==='jules-window'));
  check('historic Calendar reference resolves',tool(calendar,'calendar.get',{id:historic.id}).result.event.id===historic.id);
  const before=JSON.stringify(calendar.events[0]);
  const withShift=clone(calendar);withShift.events.push(blocking);
  check('same-account confirmed window blocks commitment',code(()=>tool(withShift,'calendar.create',kit))==='calendar_overlap');
  check('freebusy exclude is read-only',tool(withShift,'calendar.freebusy',{start:kit.start,end:kit.end,exclude_id:blocking.id}).result.busy.length===0&&code(()=>tool(withShift,'calendar.create',kit))==='calendar_overlap');
  const first=tool(calendar,'calendar.create',kit);
  const second=tool(first.data,'calendar.create',supply);
  check('two nonoverlapping commitments created',second.data.events.length===3&&first.result.id!==second.result.id);
  check('historical availability reference preserved',JSON.stringify(second.data.events[0])===before);
  check('both commitments read back',tool(second.data,'calendar.get',{id:first.result.id}).result.event.title===kit.title&&tool(second.data,'calendar.get',{id:second.result.id}).result.event.title===supply.title);
  check('overlapping real commitment still rejected',code(()=>tool(second.data,'calendar.create',create('overlap','14:40','14:50')))==='calendar_overlap');
  check('half-open adjacent commitment accepted',tool(second.data,'calendar.create',create('adjacent','14:45','14:50')).data.events.length===4);
  check('original Mail unchanged',mail.messages.length===2&&mail.messages.every(m=>m.event_ref.object_id===historic.id));
  return {checks,scope:'Source-level synthetic feasibility only. Dated historical Calendar confirmation plus explicit Mail availability window is a proposed representation; not approved, not full Core/runtime, consent or receipt validation.'};
}
module.exports=regression;
if(require.main===module){
 const root=process.argv[2];if(!root)throw Error('pass pinned PALE checkout');
 const pins={
  "mail/src/model.cjs":"d8a4f2f74840864c6a27fcad2e6236746903044e",
  "mail/src/domain-utils.cjs":"931f916aa09cdaeec1112a4adcd448bd14ef8556",
  "mail/src/operations.cjs":"991eb2a41aef4dde06f7868fb74b7ce7eedc0596",
  "mail/src/diagnostics.cjs":"67d20e449404aecfac5adf0f100aafbf373c9a5d",
  "calendar/src/model.cjs":"017bc695c57b94a5c19c01e85919173062f6fe92",
  "calendar/src/domain-utils.cjs":"931f916aa09cdaeec1112a4adcd448bd14ef8556",
  "calendar/src/operations.cjs":"1159958daf79087d63850b847bd72ddd105b04b2",
  "calendar/src/diagnostics.cjs":"67d20e449404aecfac5adf0f100aafbf373c9a5d",
  "calendar/src/formats/ical.cjs":"254814b017ef25db04b4f7b1eab1c5e5c9f63d2e"
 };
 for(const [name,sha] of Object.entries(pins)){
  const b=fs.readFileSync(path.resolve(root,'examples/apps',name));
  const actual=crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
  if(actual!==sha)throw Error('pin mismatch '+name);
 }
 console.log(JSON.stringify(regression(n=>require(path.resolve(root,'examples/apps',n))),null,2));
}
