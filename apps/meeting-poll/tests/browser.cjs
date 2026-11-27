'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),runtime=require('./runtime-path.cjs');
const {start}=require(path.join(runtime,'web/server.cjs')),{Client}=require(path.join(runtime,'client.cjs')),{prepare}=require(path.join(runtime,'prepare.cjs')),{digestTree}=require(path.join(runtime,'verify.cjs'));
const app=path.resolve(__dirname,'..'),out=path.resolve(process.env.PALE_REPORT_DIR||'.artifacts/meeting-poll');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const prepared=prepare(app),clients=[];
 const report={kind:'meeting-poll-browser',app_sha256:digestTree(app),node:process.version,runtime:require(path.join(runtime,'package.json')).version,checks:[],passed:false};let browser,host,context,page;
 const check=(name,value=true)=>{assert.ok(value,name);report.checks.push({name,status:'passed'});};
 const capture=async label=>{const file=String((report.sequence||=[]).length+1).padStart(2,'0')+'.png';await page.screenshot({path:path.join(out,file),fullPage:true});const state=await clients[0].call('env.snapshot');report.sequence.push({label,file,viewport:page.viewportSize(),version:state.version,data:state.snapshot.data});};
 try{
  host=await start({app:'meeting-poll',registry:prepared.registry,stateDir:path.join(prepared.root,'state'),run:'browser',profile:'sandbox'});
  const infra=new Client('meeting-poll','infra','browser',host.stateDir,'browser-inspector',{registry:prepared.registry});clients.push(infra);await infra.initialize();
  browser=await chromium.launch({headless:true});report.browser=browser.version();context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const snap=()=>infra.call('env.snapshot'),data=async()=>(await snap()).snapshot.data;
  const ready=()=>page.locator('#app[aria-busy=false]').waitFor();
  const form=page.locator('dialog form'),field=k=>form.locator('[data-field="'+k+'"]');
  const open=async label=>{await page.getByRole('button',{name:label,exact:true}).click();await form.waitFor();await capture('Before '+label);};
  const submit=async()=>{await form.locator('button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await ready();await capture('After committed Web action');};
  const pick=async id=>{await page.locator('[data-record-id="'+id+'"]').click();await page.locator('.detail[data-selected-id="'+id+'"]').waitFor();await ready();};
  await page.goto(host.accessUrl);await page.locator('[data-record-id=poll-team]').waitFor();await ready();check('Public Host serves a reachable App business interface');
  await open('New poll');await field('title').fill('Browser planning');await field('participant-person-alex').check();await field('description').fill('<img src=x onerror="window.injected=true">');await submit();
  let created=(await data()).polls.find(p=>p.title==='Browser planning');check('Browser create is visible through actual MCP snapshot',created&&created.status==='draft');
  await pick(created.id);await open('Edit poll');await field('title').fill('Browser planning revised');await submit();check('Browser edit persists',(await data()).polls.find(p=>p.id===created.id).title==='Browser planning revised');
  await page.reload();await page.locator('[data-record-id="'+created.id+'"]').waitFor();await pick(created.id);check('Reload retains data',await page.locator('.detail').innerText().then(x=>x.includes('Browser planning revised')));check('Untrusted text never executes',!(await page.evaluate(()=>window.injected))&&await page.locator('.detail').innerText().then(x=>x.includes('<img src=x')));
  await open('Publish poll');await submit();check('Publishing creates exactly the invited app-local notifications',(await data()).notifications.filter(n=>n.poll_id===created.id&&n.type==='invitation').length===2);
  await open('Your availability');await field('vote-slot-1').selectOption('yes');await field('vote-slot-2').selectOption('if-needed');await submit();check('Browser votes are committed',(await data()).polls.find(p=>p.id===created.id).responses.at(-1).votes[1].value==='if-needed');
  await open('Withdraw response');await submit();check('Withdrawal is distinct from voting no',(await data()).polls.find(p=>p.id===created.id).responses.at(-1).withdrawn);
  await open('Your availability');await field('vote-slot-1').selectOption('no');await field('vote-slot-2').selectOption('yes');await submit();
  await open('Confirm meeting');await field('slot_id').selectOption('slot-2');await submit();check('Confirmation uses selected slot',(await data()).polls.find(p=>p.id===created.id).meetings.at(-1).slot_id==='slot-2');
  await open('Reopen poll');await field('deadline').fill('2026-11-21T17:00:00Z');await field('reason').fill('Agenda changed');await submit();check('Reopening invalidates prior confirmation',(await data()).polls.find(p=>p.id===created.id).meetings.at(-1).status==='superseded');
  await open('Edit poll');await field('remove-slot-1').check();await form.getByRole('button',{name:'Add candidate time',exact:true}).click();await field('slot-0-start').fill('2026-11-26T09:00');await submit();
  created=(await data()).polls.find(p=>p.id===created.id);check('Slot replacement preserves old record but has no inherited votes',!created.slots[0].active&&created.slots.at(-1).id==='slot-3'&&created.responses.every(r=>!r.votes.some(v=>v.slot_id==='slot-3')));
  const beforeReplacement=created.responses.at(-1).votes.find(v=>v.slot_id==='slot-2');
  check('Unchanged slot keeps its prior vote',beforeReplacement.value==='yes');
  await open('Confirm meeting');await field('slot_id').selectOption('slot-2');
  const beforeStale=await snap();
  const independent={event_id:'browser-independent-response',at:'2026-11-18T17:30:00Z',operation:'meeting-poll.action',payload:{actor_id:'person-alex',action:'respond',arguments:{id:created.id,votes:[{slot_id:'slot-2',value:'yes'},{slot_id:'slot-3',value:'no'}]}}};
  const eventReceipt=await infra.call('env.apply_event',{expected_version:beforeStale.version,event:independent});assert.equal(eventReceipt.status,'committed');
  const afterIndependent=await data();await form.locator('button[type=submit]').click();await form.locator('[role=alert][data-code=stale_version]').waitFor();
  check('Stale finalize after independent reply changes no business records',JSON.stringify(await data())===JSON.stringify(afterIndependent));await capture('Stale finalize rejected');
  await form.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready();await pick(created.id);
  await open('Confirm meeting');await field('slot_id').selectOption('slot-2');await submit();await page.reload();await ready();await pick(created.id);
  const confirmed=await host.client.call('meeting-poll.get',{id:created.id});
  check('Reload and independent MCP query show exactly one current meeting',confirmed.item.meetings.filter(m=>m.status==='active').length===1&&confirmed.item.meetings.at(-1).slot_id==='slot-2'&&confirmed.item.meetings[0].status==='superseded');
  report.main_acceptance={independent,eventReceipt,confirmed};await capture('Reloaded current meeting with superseded history');
  await open('Reopen poll');await field('deadline').fill('2026-11-21T17:00:00Z');await field('reason').fill('Exercise concurrent edits');await submit();
  // Concurrent MCP changes must not be silently overwritten by an open form.
  await open('Edit poll');await field('title').fill('Stale overwrite');const snapshot=await snap();
  await host.client.call('meeting-poll.edit',{id:created.id,patch:{title:'Concurrent MCP title'},expected_version:snapshot.version,request_id:'browser-concurrent'});
  await form.locator('button[type=submit]').click();await form.locator('[role=alert][data-code=stale_version]').waitFor();check('Stale dialog displays failure without false success',(await data()).polls.find(p=>p.id===created.id).title==='Concurrent MCP title');await form.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready();await pick(created.id);check('Refresh displays independent MCP change',await page.locator('.detail').innerText().then(x=>x.includes('Concurrent MCP title')));
  // Abort the browser response only after the server has actually committed it.
  let dropped=false;await page.route('**/api/call',async route=>{const payload=route.request().postDataJSON();if(!dropped&&payload.name==='meeting-poll.cancel'){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await open('Cancel poll');await field('reason').fill('Cancelled in browser');await form.locator('button[type=submit]').click();await form.locator('[role=alert]').filter({hasText:/fetch/i}).waitFor();const noticesAfter=(await data()).notifications.length;await submit();
  check('Lost-response retry has one cancellation effect',dropped&&(await data()).notifications.length===noticesAfter&&(await data()).polls.find(p=>p.id===created.id).status==='cancelled');await page.unroute('**/api/call');
  await pick('poll-review');check('Participant UI has no organizer controls',await page.getByRole('button',{name:'Confirm meeting',exact:true}).count()===0&&await page.getByRole('button',{name:'Edit poll',exact:true}).count()===0);
  await open('Your availability');await form.locator('button[type=submit]').click();await form.locator('[role=alert]').filter({hasText:'Choose an answer'}).waitFor();check('Incomplete response reports validation error');await form.getByRole('button',{name:'Close',exact:true}).click();
  const event=require('../examples/scenario.json');await infra.call('env.apply_event',{expected_version:(await snap()).version,event});await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready();await pick('poll-team');check('Refresh observes independent scenario event',await page.locator('.detail table').innerText().then(x=>x.includes('yes')));
  const forbidden=await page.evaluate(async()=>{const {csrf}=await(await fetch('/session')).json();return(await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf},body:JSON.stringify({name:'env.snapshot',arguments:{}})})).status;});check('Direct browser request cannot access management snapshots',forbidden===403);
  const denied=await page.evaluate(async version=>{const {csrf}=await(await fetch('/session')).json();return(await(await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf},body:JSON.stringify({name:'meeting-poll.finalize',arguments:{id:'poll-review',slot_id:'slot-1',expected_version:version,request_id:'forbidden-finalize'}})})).json()).status;},(await snap()).version);check('Backend rejects organizer operation even when participant crafts request',denied==='permission_denied');
  await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  await page.getByRole('combobox',{name:'Display timezone'}).selectOption('Asia/Shanghai');check('Timezone selector changes visible local dates',await page.locator('.detail table').innerText().then(x=>x.includes('24 Nov 2026')));
  await page.getByRole('button',{name:/Notifications \(/}).click();check('Notifications view is usable',await page.getByRole('heading',{name:'Your notifications'}).count()===1);
  if(await page.getByRole('button',{name:'Mark read',exact:true}).count()){await page.getByRole('button',{name:'Mark read',exact:true}).first().click();await submit();check('Notification read commits',(await data()).notifications.some(n=>n.recipient_id==='person-maya'&&n.read));}
  await pick('poll-team');await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});check('Mobile viewport has no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('No browser JavaScript errors',errors.length===0);
  report.passed=true;
 }catch(e){report.error=e.stack;process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}finally{if(context)await context.close();if(browser)await browser.close();await Promise.allSettled(clients.map(c=>c.close()));if(host)await host.close();prepared.cleanup();fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error},null,2));}
})();
