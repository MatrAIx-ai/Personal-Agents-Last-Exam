'use strict';
const a=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const rt=path.resolve(process.env.PALE_RUNTIME_ROOT||path.join(__dirname,'../../../runtime'));
const {prepare}=require(rt+'/prepare.cjs'),{Client}=require(rt+'/client.cjs'),{start}=require(rt+'/web/server.cjs');
let p,h,i,agent,b;
const end='2026-02-01T00:00:00Z',end2='2026-03-01T00:00:00Z',view={width:1280,height:900};
const expect=(r,s='ok')=>{a.equal(r.status,s,JSON.stringify(r));return r;};
async function main(){
 p=prepare(path.join(__dirname,'..'));
 h=await start({app:p.app,registry:p.registry,run:'subscription-browser',profile:'scenario',stateDir:path.join(p.root,'state')});
 i=new Client(p.app,'infra',h.run,h.stateDir,'browser-verifier',{registry:p.registry});
 agent=new Client(p.app,'agent',h.run,h.stateDir,'independent-updates',{registry:p.registry});
 await Promise.all([i.initialize(),agent.initialize()]);
 b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,chromiumSandbox:true});
 const ctx=await b.newContext({viewport:view,timezoneId:'America/Los_Angeles'}),page=await ctx.newPage(),errors=[],out=process.env.PALE_SCREENSHOTS;
 page.setDefaultTimeout(9000);page.on('pageerror',e=>errors.push(e.message));
 const btn=name=>page.getByRole('button',{name,exact:true}),visible=txt=>page.getByText(txt,{exact:true}).waitFor();
 const snap=async()=>expect(await i.call('env.snapshot')),base=await snap();
 const reset=async()=>{expect(await i.call('env.reset',{expected_version:(await snap()).version}),'ready');const s=await snap();a.deepEqual(s.snapshot.data,base.snapshot.data);a.deepEqual(s.snapshot.receipts,{});a.equal(s.snapshot.virtual_now,base.snapshot.virtual_now);};
 const forward=async(id,virtual_now)=>expect(await i.call('env.advance_time',{expected_version:(await snap()).version,request_id:id,virtual_now}),'committed');
 const trace=[];
 async function capture(id,expected){
  const s=await snap();
  trace.push({id,expected,observed:await page.locator('main').innerText(),virtual_now:s.snapshot.virtual_now,
   version:s.version,storedStatus:s.snapshot.data.status,phase:s.snapshot.data.phase,
   previewStates:s.snapshot.data.previews.map(q=>[q.id,q.status]),receipts:s.snapshot.data.action_receipts.map(q=>[q.id,q.action,q.effective_at]),
   saved:s.snapshot.data.saved.map(q=>q.id)});
  if(out&&!['05-reload-receipt','06-two-open-revocations','14-reset-replay'].includes(id)){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,id+'.png'),fullPage:true});}
 }
 const cancel=async()=>{await btn('Prepare cancellation').click();await visible('Preview prepared. No entitlement change.');await btn('Confirm cancellation').click();await visible('Confirmation recorded.');await visible('Paid until scheduled end');};
 const abandon=async()=>{await btn('Abandon preview').click();await visible('Preview abandoned. No entitlement change.');};
 await page.goto(h.accessUrl);
 await visible('Paid · active');
 a.match(await page.locator('.account-clock').innerText(),/Account holder: .+ · Simulated date: .+ UTC\. All dates and billing cutoffs use UTC\./);
 a.ok(await page.locator('.kicker').last().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=14&&getComputedStyle(e).color==='rgb(52, 64, 87)'));a.ok(await page.locator('.tag').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=12));a.equal(await page.getByLabel('Account ID').count(),0);
 a.ok((await page.locator('article').first().evaluate(e=>getComputedStyle(e).borderTopWidth))==='1px','plan card border renders');
 await capture('01-plan-start','Bound subscriber opens Plan without entering an account ID; paid card and saved titles are visible.');
 for(let j=0;j<2;j++){
  await btn('Overview').click();await btn('Prepare cancellation').click();await visible('Your paid access will continue until February 1, 2026. Your saved entries will stay in your library.');
  if(j===0){
   const danger=btn('Confirm cancellation'),secondary=btn('Abandon preview');
   const bg=button=>button.evaluate(e=>getComputedStyle(e).backgroundColor);
   a.equal(await bg(danger),'rgb(163, 25, 48)');
   a.notEqual(await bg(danger),await bg(secondary));
   await capture('02-cancel-preview','Cancellation preview explains the billing boundary and visually distinguishes confirm from abandon; Core has no decision receipt.');
  }
  await abandon();
 }
 let s=await snap();a.equal(s.snapshot.data.status,'paid_active');a.deepEqual(s.snapshot.data.previews.map(q=>q.status),['abandoned','abandoned']);a.equal(s.snapshot.data.action_receipts.length,0);
 await capture('03-repeat-discard','Two consecutive same-clock previews can be independently abandoned; paid entitlement and receipts unchanged.');
 await btn('Overview').click();await cancel();
 s=await snap();a.equal(s.snapshot.data.status,'cancellation_scheduled');a.equal(s.snapshot.data.action_receipts[0].action,'cancel');
 await capture('04-cancel-confirmed','Confirmation schedules cancellation and displays a human-readable receipt.');
 await page.reload();await visible('Paid until scheduled end');await btn('Status and receipts').click();
 await page.getByRole('button',{name:/^View cancellation receipt ·/}).click();await visible('Cancellation scheduled');
 await capture('05-reload-receipt','Reload keeps scheduled entitlement; historical receipt remains retrievable.');
 await btn('Overview').click();await btn('Prepare withdrawal').click();await visible('Review withdrawal');
 const other=await ctx.newPage();await other.goto(page.url());
 await other.getByRole('button',{name:'Prepare withdrawal',exact:true}).click();
 await other.getByText('Review withdrawal',{exact:true}).waitFor();
 await visible('Withdraw the scheduled cancellation to keep paid access after February 1, 2026 (UTC). Your plan is CNY 29.00 per month (simulated; no charge).');
 s=await snap();a.equal(s.snapshot.data.previews.filter(q=>q.action==='revoke'&&q.status==='open').length,2);
 await capture('06-two-open-revocations','Second browser tab can prepare another withdrawal at the same time; two distinct open previews exist.');
 await other.getByRole('button',{name:'Abandon preview',exact:true}).click();await other.getByText('Preview abandoned. No entitlement change.',{exact:true}).waitFor();
 await other.close();
 await btn('Refresh view').click();await abandon();
 a.equal((await snap()).snapshot.data.status,'cancellation_scheduled');
 const request=(op,args,version,id)=>agent.call('subscription-exit.'+op,{...args,expected_version:version,request_id:id});
 const prep=expect(await request('prepare_revocation',{},(await snap()).version,'agent-revoke-draft'),'committed');
 expect(await request('confirm',{preview_id:prep.preview.id},prep.version,'agent-revoke-confirm'),'committed');
 await btn('Refresh view').click();await visible('Paid · active');
 s=await snap();a.equal(s.snapshot.data.status,'paid_active');a.equal(s.snapshot.data.action_receipts.length,2);
 await capture('07-independent-mcp-visible','Independent Agent MCP withdraws cancellation; Refresh shows paid active and both persisted receipts.');
 await btn('Overview').click();await cancel();
 await btn('Overview').click();await btn('Prepare withdrawal').click();await btn('Confirm withdrawal').click();
 await visible('Cancellation withdrawn');await visible('Paid · active');
 s=await snap();a.equal(s.snapshot.data.action_receipts.length,4);a.equal(s.snapshot.data.action_receipts.at(-1).action,'revoke');
 await capture('07b-browser-withdrawal','The browser confirmation withdraws a newly scheduled cancellation and displays the retained-access receipt.');

 await forward('next-period',end);await btn('Overview').click();await visible('Current billing period ends March 1, 2026.');
 await capture('08-renewed-overview','At first exact boundary, the only predeclared renewal has occurred; a fresh cancellation action remains available.');
 await cancel();s=await snap();a.equal(s.snapshot.data.phase,1);a.equal(s.snapshot.data.action_receipts.at(-1).effective_at,end2);
 await capture('09-renewed-confirmed','A fresh cancellation now schedules access end on March 1; receipt points to renewed period end.');
 await forward('end-renewed',end2);await btn('Refresh view').click();await visible('Free · paid access ended');
 await capture('10-renewed-exact-end','At renewed period end, cancellation takes effect and all saved entries stay.');
 for(let run=0;run<2;run++){
  await reset();await btn('Overview').click();await cancel();
  await forward('before-end','2026-01-31T23:59:59Z');await btn('Overview').click();await btn('Prepare withdrawal').click();await btn('Confirm withdrawal').waitFor();
  if(!run)await capture('11-pre-boundary-withdrawal','A withdrawal preview is open one second before the scheduled paid-access end.');
  await forward('exact-end',end);const boundary=await snap();await btn('Confirm withdrawal').click();await visible('The workspace changed. Refresh and review the current subscription.');
  if(!run)await capture('12-stale-denied','Confirming the older preview after exact equality is rejected at the action; no second receipt.');
  await btn('Refresh view').click();await visible('Free · paid access ended');
  a.equal(await btn('Confirm withdrawal').count(),0);
  for(const item of base.snapshot.data.saved)await visible(item.title);
  const after=await snap();a.deepEqual(after.snapshot.data,boundary.snapshot.data);a.deepEqual(after.snapshot.receipts,boundary.snapshot.receipts);a.deepEqual(after.version,boundary.version);
  await capture('1'+(3+run)+'-reset-replay','Refresh projects Free; persisted prior records and all saved entries remain, including after a second reset/replay.');
 }
 await reset();await forward('both-boundaries',end2);await btn('Overview').click();
 await visible('This simulation ends at the last billing date. No further subscription changes are available.');
 a.equal(await btn('Prepare cancellation').count(),0);
 await capture('15-no-further-period','With no cancellation, skipping to the renewed boundary does not create a third period or allow an unmodeled write.');
 // Capture the reviewer’s active/scheduled cohort repro, plus an already-ended subscriber.
 const cohorts=require('../evaluation/accounts-v1.json').accounts,{at,withBundle}=require('../evaluation/build.cjs');
 for(const [index,id,status,action,confirmation] of [
  [0,'16-evaluation-active','Paid · active','Prepare cancellation','Review cancellation'],
  [2,'17-evaluation-pending','Paid until scheduled end','Prepare withdrawal','Review withdrawal'],
  [1,'18-evaluation-free','Free · paid access ended',null,null]
 ]){
  const row=index===0?at('listener-cohort-1','2026-11-20T12:00:00Z'):cohorts[index];
  expect(await i.call('env.load_seed',withBundle(row,await snap(),'evaluation-'+index)),'ready');
  await btn('Overview').click();await visible(status);
  await page.getByText('Account holder: '+row.label,{exact:false}).waitFor();
  for(const item of row.seed.saved)await visible(item.title);
  await btn('Status and receipts').click();
  await visible('Subscription history');
  await page.getByText('Paid subscription started ·',{exact:false}).waitFor();
  await page.getByText(/Saved .* \(UTC\)$/).first().waitFor();
  await btn('Overview').click();await visible(status);
  if(action){await btn(action).click();await visible(confirmation);a.equal((await snap()).snapshot.data.previews.at(-1).status,'open');}
  else{a.equal(await btn('Prepare cancellation').count(),0);a.equal(await btn('Prepare withdrawal').count(),0);}
  const checked=await snap();
  a.equal(checked.snapshot.data.status,row.seed.status);
  a.deepEqual(checked.snapshot.data.action_receipts,row.seed.action_receipts);
  await capture(id,status+(action?' · matching action opens its preview without changing entitlement or receipts.':' · no paid action; history and saved entries remain.'));
 }
 a.deepEqual(errors,[]);
 const meta={browser:b.version(),playwright:require(path.join(require.resolve(process.env.PLAYWRIGHT_MODULE||'playwright'),'../package.json')).version,viewport:view,browserTimezone:'America/Los_Angeles',displayTimezone:'UTC',run:h.run,trace};
 if(out)fs.writeFileSync(path.join(out,'browser-trace.json'),JSON.stringify(meta,null,2)+'\n');
 console.log('PASS: browser '+b.version()+', 1280x900 with Los Angeles browser zone and UTC display, 19 trace points with 16 distinct screenshots; repeated abandons, two browser tabs, independent Agent MCP updates, renewed-period cancellation, stale exact-boundary denial, retained entries and reset/replays.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await Promise.allSettled([b?.close(),i?.close(),agent?.close()]);await h?.close();p?.cleanup();});
