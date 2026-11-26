'use strict';
const assert=require('node:assert/strict');
const {run,input,CASES}=require('../../examples/workflows/mail-to-mail/run.cjs');
const {notification}=require('../../examples/apps/mail/src/publisher.cjs');
let count=0;const check=(v,m)=>{assert.ok(v,m);count++;};
(async()=>{
 for(const kind of CASES){
  const t=await run({case:kind,subject:'MCP <script> text',body:'Synthetic body '+kind});
  for(const c of t.checks)check(c.passed,kind+': '+c.label);
  check(t.source.state_path!==t.target.state_path,kind+' independent state roots');
  if(kind==='allowed'){check(t.source.messages[0].folder==='sent','source send committed');check(t.target.messages.length===1&&t.observed.message.body==='Synthetic body allowed','Agent reads exact received content');check(t.target.owner!==t.source.owner&&t.authorization.recipient_grants.length===1,'cross-owner delivery requires explicit grant');}
  if(kind==='no_grant'){check(t.execution.local.status==='committed'&&t.source.messages[0].folder==='sent','local sent does not imply recipient delivery');check(t.target.messages.length===0&&t.execution.result.code==='recipient_not_authorized','no grant means no downstream write');}
  if(kind==='readonly')check(!t.source.tools.includes('mail.send')&&t.source.messages[0].folder==='drafts','readonly source cannot publish through adapter');
  if(kind==='admin')check(t.admin_probe.agent.status==='permission_denied'&&t.admin_probe.publisher.status==='permission_denied','both direct admin probes denied');
 }
 for(const value of [null,7,'hello',[],{case:'unknown'},{case:'allowed',run_id:'forged'},{subject:'x'.repeat(201)},{body:2}]){assert.throws(()=>input(value));count++;}
 const msg={id:'x',account_id:'mail-a',folder:'sent',to:['mail-b@pale.example'],subject:'x',body:'y',attachments:[]},binding={sourceAccount:'mail-a',recipient:{account_id:'mail-b',address:'mail-b@pale.example'}};
 for(const change of [m=>m.folder='drafts',m=>m.account_id='victim',m=>m.to=['victim@example.com'],m=>m.attachments=['secret']]){const m=structuredClone(msg);change(m);assert.throws(()=>notification(m,binding));count++;}
 console.log('PASS: '+count+' two-Mail authorization, isolated real MCP delivery and retry checks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
