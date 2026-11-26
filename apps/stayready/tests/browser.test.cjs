'use strict';
// Real Chromium controls → public Web Host → Agent MCP. Infra is used only by
// this evidence driver for prewritten hotel events and independent inspection.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const {start}=require('../../../runtime/web/server.cjs');
const {Client}=require('../../../runtime/client.cjs');
const {digestTree}=require('../../../runtime/verify.cjs');
const root=path.resolve(__dirname,'../../..');
const output=path.resolve(process.env.STAYREADY_BROWSER_REPORT_DIR||path.join(root,'.artifacts/stayready/browser'));
const baseline=require('../fixtures/minimal.json');
const initial='2026-12-01T18:00:00Z';
const normalizeTimes=value=>Array.isArray(value)?value.map(normalizeTimes):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizeTimes(v)])):typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)?new Date(value).toISOString():value;
const arrivalConditions={stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_at:'2026-12-02T00:20:00Z'};
const arrivalTerms={stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_window:{start:'2026-12-02T00:00:00Z',end:'2026-12-02T01:00:00Z'},entrance_id:'east',access_method_id:'night-desk'};
const breakfastConditions={stay_id:'stay-1',service:'breakfast',person_ids:['person-2'],morning_dates:['2026-12-02','2026-12-03'],meal_request:'Plant-based breakfast'};
const breakfastTerms={...breakfastConditions,morning_dates:['2026-12-02']};
// These selector payloads are authored before execution. They never consume a
// generated hotel request ID, submit timestamp or rewritten matching window.
const events={
 arrival:{event_id:'browser-source-arrival',at:initial,operation:'stayready.source_updated',payload:{source_id:'source-arrival',expected_source_version:1,source_version:2,arrival_at:arrivalConditions.arrival_at}},
 acknowledgment:{event_id:'browser-acknowledgment',at:'2026-12-01T18:02:00Z',operation:'stayready.hotel_reply',payload:{target:{need_id:'need-arrival',action:'arrange',request_conditions:arrivalConditions,submitted_in:{from:initial,until:'2026-12-01T18:01:00Z'}},outcome:'acknowledged',message:'We have received your arrival request. Night access is not yet confirmed.'}},
 confirmation:{event_id:'browser-confirmation',at:'2026-12-01T18:05:00Z',operation:'stayready.hotel_reply',payload:{target:{need_id:'need-arrival',action:'arrange',request_conditions:arrivalConditions,submitted_in:{from:initial,until:'2026-12-01T18:01:00Z'}},outcome:'confirmed',terms:arrivalTerms,message:'Please use the east entrance and ask the night desk for assistance.'}},
 cancellation:{event_id:'browser-cancellation',at:'2026-12-01T18:06:00Z',operation:'stayready.hotel_reply',payload:{target:{need_id:'need-access-person-1',action:'cancel',request_conditions:baseline.commitments[0].request_conditions,submitted_in:{from:'2026-12-01T18:05:00Z',until:'2026-12-01T18:06:00Z'},predecessor:{commitment_terms:baseline.commitments[0].terms,confirmed_in:{from:'2026-11-30T00:00:00Z',until:'2026-12-01T00:00:00Z'}}},outcome:'confirmed',message:'The requested step-free service arrangement is cancelled. Your room booking remains confirmed.'}},
 breakfastPartial:{event_id:'browser-breakfast-partial-confirmation',at:'2026-12-01T18:06:45Z',operation:'stayready.hotel_reply',payload:{target:{need_id:'need-breakfast-person-2',action:'arrange',request_conditions:breakfastConditions,submitted_in:{from:'2026-12-01T18:06:00Z',until:'2026-12-01T18:06:30Z'}},outcome:'confirmed',terms:breakfastTerms,message:'Breakfast is confirmed for 2 December only. Breakfast on 3 December remains unconfirmed.'}},
 denied:{event_id:'browser-sharing-revoked',at:'2026-12-01T18:07:00Z',operation:'stayready.source_updated',payload:{source_id:'source-breakfast-person-1',expected_source_version:1,source_version:2,disclose_fields:[],grant_version:2}},
 content:{event_id:'browser-untrusted-source-text',at:'2026-12-01T18:08:00Z',operation:'stayready.source_updated',payload:{source_id:'source-breakfast-person-2',expected_source_version:1,source_version:2,fields:{meal_request:'<img src=x onerror="window.untrustedExecuted=true"> plant-based breakfast',private_background:'PRIVATE TEST BACKGROUND DO NOT SHARE'}}}
};
const report={schema:'stayready.browser-evidence.v1',checked_at:new Date().toISOString(),app_version:require('../app.json').version,host_version:require('../../../runtime/package.json').version,node:process.version,playwright:require('playwright/package.json').version,viewport:{width:1360,height:920},run:'stayready-browser',checks:[],screenshots:[],mcp:[],browser_requests:[],console_errors:[],page_errors:[],static_events:events,passed:false};
let host,infra,observer,browser,context,page,sequence=0;
const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'stayready-browser-'));
fs.mkdirSync(output,{recursive:true});
if(fs.existsSync(path.join(output,'report.json'))){const previous=JSON.parse(fs.readFileSync(path.join(output,'report.json'),'utf8'));if(previous.schema===report.schema)for(const item of previous.screenshots||[]){if(/^\d{2}-[a-z-]+\.png$/.test(item.filename))fs.rmSync(path.join(output,item.filename),{force:true});}}
fs.rmSync(path.join(output,'failure.png'),{force:true});
function check(name,condition=true,details){assert.ok(condition,name);report.checks.push({name,passed:true,...(details?{details}:{})});console.log('PASS '+name);}
async function capture(name,action,expected){const filename=String(++sequence).padStart(2,'0')+'-'+name+'.png';await page.screenshot({path:path.join(output,filename),fullPage:true});report.screenshots.push({sequence,filename,action,expected,view:await page.locator('nav [aria-current=page]').innerText(),visible_status:await page.locator('#status').innerText()});}
async function observed(label){const result=await observer.call('stayready.inspect');assert.equal(result.status,'ok');report.mcp.push({kind:'independent-agent-inspect',label,result});return result;}
async function snapshot(label){const result=await infra.call('env.snapshot');assert.equal(result.status,'ok');report.mcp.push({kind:'infra-snapshot',label,result});return result;}
async function event(name){const input={expected_version:(await snapshot('before '+name)).version,event:events[name]};const result=await infra.call('env.apply_event',input);report.mcp.push({kind:'infra-event',name,input,result});assert.equal(result.status,'committed',JSON.stringify(result));return result;}
async function idle(){await page.locator('.workspace[aria-busy=false]').waitFor();}
async function refresh(){await page.getByRole('button',{name:'Refresh',exact:true}).click();await idle();}
async function nav(label){await page.locator('nav').getByRole('button',{name:label,exact:true}).click();}
async function select(id){await page.locator('[data-record-id="'+id+'"]').click();}
async function submit(){await page.locator('dialog button[type=submit]').click();}
async function closed(){await page.locator('dialog').waitFor({state:'hidden'});await idle();}
async function closeDialog(){await page.locator('dialog').getByRole('button',{name:'Close',exact:true}).click();}

(async()=>{
 try{
  host=await start({app:'stayready',registry:path.join(root,'stayready.registry.json'),stateDir,run:report.run,profile:'sandbox'});
  infra=new Client('stayready','infra',report.run,stateDir,'stayready-browser-infra',{registry:host.registry});await infra.initialize();
  observer=new Client('stayready','agent',report.run,stateDir,'stayready-independent-observer',{registry:host.registry});await observer.initialize();
  // The public registry clock can predate this fixture. Use the standard seed
  // load to establish its declared explicit time, binding and policy baseline.
  let current=await snapshot('initial');
  const load=await infra.call('env.load_seed',{expected_version:current.version,data:baseline,virtual_now:initial,request_id:'browser-fixture-baseline'});
  assert.equal(load.status,'ready');report.mcp.push({kind:'baseline-load',result:load});
  browser=await chromium.launch({headless:true});report.browser=browser.version();
  context=await browser.newContext({viewport:report.viewport});page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>report.page_errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.console_errors.push(message.text());});
  page.on('request',request=>{if(request.url().endsWith('/api/call'))report.browser_requests.push({method:request.method(),body:request.postDataJSON()});});
  await page.goto(host.accessUrl);await idle();
  check('Public Host loads packaged StayReady controller',await page.getByRole('heading',{name:'StayReady',exact:true}).isVisible());
  check('Access token removed from URL',!page.url().includes('access='));
  await capture('stay-start','Open authenticated public Host','Confirmed room booking and current guests visible');
  await select('policies');
  check('Policies distinguish steps from a lift',await page.getByText('Includes steps',{exact:true}).isVisible());
  await capture('stay-policies','Click Policies & routes','Reception and both route conditions visible');
  await select('booking');await page.getByRole('button',{name:'Review needs',exact:true}).click();
  await capture('need-start','Click Review needs','Original arrival requirement visible');
  await event('arrival');await refresh();
  check('Refresh sees source update through same MCP state',await page.locator('.detail').getByText('Source changed · review needed',{exact:true}).isVisible());
  const beforeNeedSave=await observed('before GUI arrival save');
  await page.getByRole('button',{name:'Edit need',exact:true}).click();
  await capture('need-edit','Click Edit need','Latest observed arrival fact selected');
  // Simulate an unknown network outcome after the server commits the write.
  let dropped=false;
  await page.route('**/api/call',async route=>{if(!dropped&&route.request().postDataJSON().name==='stayready.need.save'){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await submit();await page.locator('dialog [role=alert]').filter({hasText:/./}).waitFor();
  await capture('need-retry','Submit; response lost after server commit','Failure stays visible with editable form and retry');
  await submit();await closed();await page.unroute('**/api/call');
  current=await observed('after GUI arrival save and retry');
  check('Lost-response retry changes need exactly once',current.view.needs.find(n=>n.id==='need-arrival').revision===beforeNeedSave.view.needs.find(n=>n.id==='need-arrival').revision+1);
  check('GUI saved the source arrival fact',Date.parse(current.view.needs.find(n=>n.id==='need-arrival').conditions.arrival_at)===Date.parse(arrivalConditions.arrival_at));
  const receipts=(await snapshot('GUI save persisted receipt')).snapshot.receipts;
  check('Retry reused one successful write receipt',Object.keys(receipts).filter(k=>k.startsWith('request:')).length===1);
  await page.reload();await idle();
  check('Reload reconstructs latest business state',await page.locator('.detail').getByText(/2 Dec 2026, 00:20 UTC/).first().isVisible());
  await capture('need-saved','Retry then reload','Updated arrival requirement persists; source review cleared');
  const beforePreview=await observed('before read-only preview');
  await page.getByRole('button',{name:'Preview request',exact:true}).click();
  const afterPreview=await observed('after read-only preview');
  check('Disclosure preview is read-only',JSON.stringify(beforePreview.view)===JSON.stringify(afterPreview.view)&&JSON.stringify(beforePreview.version)===JSON.stringify(afterPreview.version));
  await capture('request-preview','Click Preview request','Exact arrival, people and permitted disclosure visible before send');
  check('Preview excludes private background',!(await page.locator('dialog').innerText()).includes('Private journey'));
  await submit();await closed();
  current=await observed('after browser request submit');let arrival=current.view.requests.find(r=>r.need_id==='need-arrival');
  check('GUI submit persists pending hotel request',arrival.status==='submitted');
  check('Pending request is not a hotel commitment',!current.view.commitments.some(c=>c.need_id==='need-arrival'));
  await capture('request-sent','Click Send to hotel','Sent and awaiting hotel, without invented confirmation');
  await event('acknowledgment');await refresh();
  check('Acknowledgment remains unconfirmed',(await observed('acknowledgment')).view.commitments.length===1);
  await capture('reply-acknowledged','Apply static acknowledgment through Infra then click Refresh','Received but not yet confirmed');
  await event('confirmation');await refresh();
  current=await observed('hotel confirmation');arrival=current.view.requests.find(r=>r.need_id==='need-arrival');
  assert.deepEqual(normalizeTimes(current.view.commitments.find(c=>c.need_id==='need-arrival').terms),normalizeTimes(arrivalTerms));check('Hotel confirmation creates exact terms');
  await capture('reply-confirmed','Apply static confirmation and click Refresh','Hotel-confirmed entrance, window and night desk visible');
  await page.getByRole('button',{name:'View arrangements',exact:true}).click();
  await capture('arrangements-confirmed','Click View arrangements','Both original access promise and new arrival promise visible');
  await nav('Needs & requests');await select('need-arrival');await page.getByRole('button',{name:'Preview change',exact:true}).click();
  await capture('change-preview','Preview a change to the arrival service','Prior promise remains until hotel confirmation');await submit();await closed();
  check('Submitting change preserves existing promise',(await observed('pending change')).view.commitments.find(c=>c.need_id==='need-arrival').status==='active');
  await page.getByRole('button',{name:'Withdraw pending request',exact:true}).click();await capture('withdraw-confirm','Click Withdraw pending request','Confirmation explains existing services remain');await submit();await closed();
  current=await observed('withdrawn change');check('Withdrawing request preserves active commitment',current.view.requests.filter(r=>r.action==='change')[0].status==='withdrawn'&&current.view.commitments.find(c=>c.need_id==='need-arrival').status==='active');
  await capture('withdraw-result','Confirm withdrawal','Request is withdrawn and earlier promise remains');
  await nav('Needs & requests');await select('need-access-person-1');await page.getByRole('button',{name:'Preview cancellation',exact:true}).click();
  await capture('cancel-preview','Preview cancellation of access arrangement','Original terms and provider confirmation requirement visible');await submit();await closed();
  check('Pending cancellation preserves service',(await observed('pending cancellation')).view.commitments.find(c=>c.id==='commitment-baseline-access').status==='active');
  await capture('cancel-pending','Send cancellation request','Sent cancellation has not yet cancelled hotel service');
  await event('cancellation');await refresh();await page.getByRole('button',{name:'View arrangements',exact:true}).click();
  check('Only hotel confirmation cancels service',(await observed('confirmed cancellation')).view.commitments.find(c=>c.id==='commitment-baseline-access').status==='cancelled');
  await capture('cancel-confirmed','Apply static cancellation reply and refresh','Cancelled service retained in history; room stays confirmed');
  // Invalid dates must visibly fail without changing business state.
  await nav('Needs & requests');await select('need-breakfast-person-1');await page.getByRole('button',{name:'Edit need',exact:true}).click();
  await page.locator('input[name=morning_dates]').fill('2026-11-30');const beforeInvalid=await observed('before invalid date');await submit();
  await page.locator('dialog [role=alert]').filter({hasText:/./}).waitFor();
  check('Out-of-stay date fails visibly without partial write',JSON.stringify((await observed('after invalid date')).view.needs)===JSON.stringify(beforeInvalid.view.needs));
  await capture('invalid-date','Try a breakfast date outside the stay','Validation error; saved requirement unchanged');await closeDialog();
  // A second Agent edits a separate need while this browser form is open.
  await page.getByRole('button',{name:'Edit need',exact:true}).click();await page.locator('input[name=morning_dates]').fill('2026-12-02');
  current=await observed('before independent write');const other=current.view.needs.find(n=>n.id==='need-breakfast-person-2');
  const writeArgs={need_id:other.id,conditions:other.conditions,source_ids:other.source_ids,expected_version:current.version,request_id:'browser-independent-edit'};
  const external=await observer.call('stayready.need.save',writeArgs);assert.equal(external.status,'committed');report.mcp.push({kind:'independent-agent-write',arguments:writeArgs,result:external});
  await submit();await page.locator('dialog [data-code=stale_version]').waitFor();
  await capture('stale-write','Submit form after independent MCP write','Stale form stays open; no silent overwrite');await closeDialog();await refresh();
  check('Stale browser write preserves external update',(await observed('after stale form')).view.needs.find(n=>n.id===other.id).revision===other.revision+1);
  // A successful breakfast workflow must preserve the difference between both
  // requested mornings and the one morning the hotel actually confirms.
  await select('need-breakfast-person-2');await capture('breakfast-start','Select Jamie Chen’s breakfast need','Two requested mornings and the permitted plant-based service fact are visible');
  await page.getByRole('button',{name:'Edit need',exact:true}).click();await page.locator('input[name=morning_dates]').fill('2026-12-02, 2026-12-03');
  await capture('breakfast-edit','Edit breakfast mornings through the business form','Both in-stay dates are ready to save');await submit();await closed();
  current=await observed('after GUI breakfast save');assert.deepEqual(current.view.needs.find(n=>n.id==='need-breakfast-person-2').conditions,breakfastConditions);check('GUI saves both requested breakfast mornings');
  await capture('breakfast-saved','Save breakfast need','Both requested dates persist in the need');
  await page.getByRole('button',{name:'Preview request',exact:true}).click();await capture('breakfast-preview','Preview breakfast request','Exact guest, both mornings and permitted meal request appear before send');await submit();await closed();
  current=await observed('after GUI breakfast submission');
  check('Breakfast submission remains pending without a commitment',current.view.requests.find(r=>r.need_id==='need-breakfast-person-2').status==='submitted'&&!current.view.commitments.some(c=>c.need_id==='need-breakfast-person-2'));
  await capture('breakfast-pending','Send breakfast request','Both mornings are requested; the hotel has not confirmed either');
  await event('breakfastPartial');await refresh();current=await observed('partial breakfast confirmation');
  const breakfastCommitment=current.view.commitments.find(c=>c.need_id==='need-breakfast-person-2');
  assert.deepEqual(breakfastCommitment.terms,breakfastTerms);assert.deepEqual(current.view.requests.find(r=>r.need_id==='need-breakfast-person-2').conditions,breakfastConditions);check('Partial breakfast reply retains two requested dates but confirms only one');
  const breakfastReply=page.locator('.detail .query-result').filter({hasText:'Breakfast is confirmed for 2 December only.'});
  check('Visible hotel reply does not imply the second morning is covered',(await breakfastReply.innerText()).includes('2026-12-02')&&!(await breakfastReply.innerText()).includes('2026-12-03'));
  await capture('breakfast-partial-reply','Apply the prewritten partial reply and click Refresh','Request lists both dates; hotel reply explicitly confirms 2 December only');
  await page.getByRole('button',{name:'View arrangements',exact:true}).click();
  const breakfastCard=page.locator('[data-commitment-id="'+breakfastCommitment.id+'"]');
  check('Arrangement shows only the hotel-confirmed breakfast date',(await breakfastCard.innerText()).includes('2026-12-02')&&!(await breakfastCard.innerText()).includes('2026-12-03'));
  await capture('breakfast-partial-arrangement','Open confirmed arrangements','Breakfast commitment covers 2 December; 3 December is not included');
  await nav('Needs & requests');await select('need-breakfast-person-2');await page.getByRole('button',{name:'Clear local need',exact:true}).click();
  await capture('clear-need-confirm','Click Clear local need','Confirmation explains that existing hotel service stays on record');await submit();await closed();
  current=await observed('after clearing breakfast need');
  assert.deepEqual(current.view.commitments.find(c=>c.id===breakfastCommitment.id),breakfastCommitment);check('Clearing local need preserves the confirmed breakfast service',current.view.needs.find(n=>n.id==='need-breakfast-person-2').conditions===null);
  await page.reload();await idle();check('Reload shows cleared need alongside the surviving promise',await page.getByText('No current requirement saved. Existing hotel arrangements remain on record.',{exact:true}).isVisible()&&await page.locator('.detail').getByText('2026-12-02',{exact:true}).isVisible());
  await capture('clear-need-result','Clear the local need and reload','No current requirement is saved; the hotel’s 2 December promise remains visible');
  await select('need-breakfast-person-1');
  await event('denied');await refresh();await page.getByRole('button',{name:'Preview request',exact:true}).click();await page.locator('#status[data-error=true]').waitFor();
  check('Revoked sharing permission causes visible denial',(await page.locator('#status').innerText()).length>0);
  await capture('sharing-denied','Preview after trusted source grant revocation','Hotel disclosure denied; no request created');
  check('Denied preview creates no hotel request',!(await observed('denied preview')).view.requests.some(r=>r.need_id==='need-breakfast-person-1'));
  // Source text is rendered as text, including in the hotel disclosure preview.
  await event('content');await refresh();await select('need-breakfast-person-2');await page.getByRole('button',{name:'Edit need',exact:true}).click();await page.locator('input[name=morning_dates]').fill('2026-12-02, 2026-12-03');await submit();await closed();await page.getByRole('button',{name:'Preview change',exact:true}).click();
  check('Untrusted source text cannot create elements or execute script',await page.locator('dialog img').count()===0&&await page.evaluate(()=>window.untrustedExecuted!==true));
  check('Private source background is absent from business UI',!(await page.locator('#app').innerText()).includes('PRIVATE TEST BACKGROUND')&&!(await page.locator('dialog').innerText()).includes('PRIVATE TEST BACKGROUND'));
  await capture('untrusted-text','Preview permitted service fact containing markup','Markup is literal text; private background omitted');await closeDialog();
  // Person replacement is a complete browser edit with a preserved booking.
  await nav('Your stay');await select('booking');await page.getByRole('button',{name:'Replace companion',exact:true}).click();
  await capture('people-replace-confirm','Click Replace companion','Same-headcount substitution and preserved promises explained');await submit();await closed();
  current=await observed('after companion substitution');check('Companion replacement preserves headcount and booking',current.view.stay.guest_person_ids.join(',')==='person-1,person-3'&&current.view.stay.reservation_status==='confirmed');
  await page.reload();await idle();await capture('people-replaced','Replace companion and reload','Sam Rivera now staying; confirmed booking unchanged');
  const denial=await page.evaluate(async()=>{const {csrf}=await(await fetch('/session')).json();return(await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf},body:JSON.stringify({name:'env.snapshot',arguments:{}})})).status;});
  check('Direct hidden-state management request denied by backend',denial===403);
  check('No management or reset controls in GUI',await page.getByRole('button',{name:/reset|load seed|advance time|apply event|snapshot/i}).count()===0);
  await nav('Replies & arrangements');await select('history');
  check('Observed history exposes source and hotel activity',await page.locator('.detail').getByRole('heading',{name:'Hotel reply received',exact:true}).count()===4);
  await capture('observed-history','Click Activity history','Observed source updates, hotel replies and actions remain traceable');
  await page.setViewportSize({width:390,height:844});await nav('Needs & requests');await select('need-arrival');
  check('Mobile viewport has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check('Mobile action labels remain readable',await page.locator('.detail .reader-footer button').evaluateAll(buttons=>buttons.every(button=>{const rect=button.getBoundingClientRect();return rect.width>=88&&rect.height<=80;})));
  await capture('mobile-needs','Open needs at 390 × 844','All controls usable without horizontal page overflow');
  check('No browser JavaScript errors',report.page_errors.length===0,report.page_errors);
  await snapshot('final persisted records and receipts');report.package_sha256=digestTree(path.join(root,'apps/stayready'));report.host_sha256=digestTree(path.join(root,'runtime'));report.passed=true;
 }catch(error){report.error=error.stack;console.error(error);if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
 finally{await context?.close();await browser?.close();await observer?.close();await infra?.close();await host?.close();fs.rmSync(stateDir,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Browser evidence: '+output);}
})().catch(error=>{console.error(error);process.exitCode=1;});
