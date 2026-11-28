'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const app=path.resolve(__dirname,'..'),id='home-repair-slots';
const runtime=process.env.PALE_RUNTIME_ROOT?path.resolve(process.env.PALE_RUNTIME_ROOT):path.resolve(app,'../../runtime');
const {prepare}=require(path.join(runtime,'prepare.cjs')),{Client}=require(path.join(runtime,'client.cjs')),{start}=require(path.join(runtime,'web/server.cjs'));
const driver=process.env.PALE_PLAYWRIGHT_MODULE||'playwright';
const {chromium}=require(driver),playwright=require(driver+'/package.json').version;
const event=require('../examples/scenario.json');
const initialFixture=require('../fixtures/minimal.json');

(async ()=>{
 const staged=prepare(app),stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-repair-chromium-')),run='review-browser';
 const cfg={registry:staged.registry};
 const infra=new Client(id,'infra',run,stateDir,'browser-infra',{...cfg,initialProfile:'sandbox'});
 const agent=new Client(id,'agent',run,stateDir,'browser-read',cfg);
 let host,browser;
 try{
  await Promise.all([infra.initialize(),agent.initialize()]);
  host=await start({app:id,registry:staged.registry,profile:'sandbox',run,stateDir});
  browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const viewport={width:1280,height:900},evidence=process.env.PALE_EVIDENCE_DIR,frames=[];
  if(evidence)fs.mkdirSync(evidence,{recursive:true});
  const page=await browser.newPage({viewport}),errors=[],external=[],interactions=[];
  await page.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===new URL(host.url).origin)return route.continue();external.push(url);return route.abort();});
  page.on('pageerror',e=>errors.push(e.message));
  const click=async name=>{
   const locator=page.getByRole('button',{name,exact:name!=='Bookings'});
   await locator.waitFor({state:'visible'});
   const before=String(interactions.length+1).padStart(2,'0')+'-before-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.png';
   if(evidence)await page.screenshot({path:path.join(evidence,before),fullPage:true});
   interactions.push({type:'click',selector:{role:'button',name,exact:name!=='Bookings'},before});
   await locator.click();
  };
  const text=(name)=>page.getByText(name,{exact:false}).first().waitFor();
  const stage=page.getByRole('article',{name:'Synthetic booking workspace'});
  const ready=name=>stage.getByRole('heading',{name,exact:true}).waitFor();
  const noNull=async()=>assert.doesNotMatch(await stage.innerText(),/\bnull\b/);
  const snap=()=>infra.call('env.snapshot');
  const call=(n,a={})=>agent.call(id+'.'+n,a);
  const booking=(n)=>call('get_booking',{booking_id:n});
  const list=()=>call('list_slots');
  const slotIds=async()=>(await list()).slots.map(x=>x.id);
  const mark=async(name,action,expected)=>{
   if(!evidence)return;
   const r=await snap();assert.equal(r.status,'ok');
   const all=await list();assert.equal(all.status,'ok');
   const s=r.snapshot;
   const file=String(frames.length+1).padStart(2,'0')+'-'+name+'.png';
   await page.screenshot({path:path.join(evidence,file),fullPage:true});
   frames.push({file,action,expected,observed:{heading:await stage.getByRole('heading',{level:2}).first().textContent(),
    notice:await page.getByRole('status').textContent(),available:all.slots.map(x=>x.id),active_reservation:all.reservation_id,
    latest_activity:s.data.history.at(-1),b5:s.data.bookings.find(x=>x.id==='B5')||null},
    core:{infra_call:'env.snapshot',agent_call:id+'.list_slots',version:r.version,virtual_now:s.virtual_now}});
  };
  const original=(await snap()).snapshot.data;
  assert.deepEqual(original.history,initialFixture.history);
  assert.equal(original.history[0].at.slice(0,10),'2025-01-01');
  await page.goto(host.accessUrl);
  await ready('Slots');assert.deepEqual(await slotIds(),['S1','S2','S4']);
  const offers=page.getByRole('table',{name:'Available appointment offers'});
  assert.deepEqual(await offers.getByRole('columnheader').allTextContents(),['Provider','Appointment window','Price','Action']);
  assert.equal(await offers.getByRole('row').count(),4);
  const nav=page.getByRole('navigation',{name:'Home Repair navigation'});
  assert.match(await nav.getByRole('button',{name:/Bookings/}).innerText(),/8/);await mark('offers','Open shared Web Host','Eligible offers S1, S2, S4; no new booking.');
  // Existing seeded reservation and newly created review both exercise the null child.
  await click('Review reservation');await text('Reservation R0');await noNull();await mark('seeded-review','Open existing R0','R0 is readable; no stray null.');
  await click('Slots');await click('Select S1');await ready('Review reservation');await stage.getByText('open',{exact:true}).waitFor();await noNull();await mark('preview','Select S1','Review temporary preview with no new booking.');
  await click('Discard reservation');await text('Reservation discarded. No booking created.');
  assert.equal((await list()).reservation_id,null);
  assert.deepEqual((await snap()).snapshot.data.bookings,original.bookings);await mark('discard','Discard temporary preview','Reservation discarded, no booking created.');
  await click('Slots');await click('Select S1');await ready('Review reservation');await noNull();
  const beforeEvent=await snap(),applied=await infra.call('env.apply_event',{event,expected_version:beforeEvent.version});
  assert.equal(applied.status,'committed');await mark('competing-event','Infra consumes the selected slot','S1 no longer offered; existing browser preview is now stale.');
  await click('Confirm reservation');await text('stale');
  assert.deepEqual((await snap()).snapshot.data.bookings,original.bookings);await mark('stale-rejected','Click stale confirmation','No booking; a stale error appears.');
  await click('Refresh');await text('This slot was taken before confirmation.');await noNull();await mark('invalidated','Refresh after race','Visible invalidation notice, no booking.');
  await click('Slots');await click('Select S2');await ready('Review reservation');await noNull();
  await mark('alternative-review','Select backup S2','New temporary preview; no booking until confirmed.');
  await click('Confirm reservation');await text('Synthetic booking confirmed: B5');
  assert.equal((await booking('B5')).booking.slot_id,'S2');assert.match(await nav.getByRole('button',{name:/Bookings/}).innerText(),/9/);await mark('confirmed','Confirm alternative','B5 is confirmed on S2.');
  await click('Change or cancel B5');await click('Reschedule to S4');await mark('move-prompt','Choose S4 for a move','Prompt visible; B5 is still confirmed on S2.');await click('Confirm reschedule');await text('Booking B5 rescheduled to S4.');
  assert.equal((await booking('B5')).booking.slot_id,'S4');assert.deepEqual(await slotIds(),['S2']);await noNull();await mark('move-result','Confirm change','B5 is on S4 and releases S2.');
  await click('Change or cancel B5');await click('Cancel booking');await mark('cancel-prompt','Choose cancellation','Confirmation prompt; B5 remains confirmed on S4 for now.');await click('Confirm cancellation');await text('Booking B5 cancelled.');
  assert.deepEqual((await booking('B5')).history.map(x=>x.operation),['confirm_reservation','reschedule_booking','cancel_booking']);
  assert.equal((await booking('B5')).booking.status,'cancelled');assert.deepEqual(await slotIds(),['S2','S4']);await mark('cancel-result','Confirm cancellation','B5 remains readable as cancelled; S4 reopens.');
  await click('Open BH2025A');await stage.getByRole('heading',{name:'Booking BH2025A'}).waitFor();
  const activity=stage.getByRole('region',{name:'Booking activity'});
  await activity.getByText('Confirmed',{exact:true}).waitFor();
  await activity.getByText('Cancelled',{exact:true}).waitFor();
  assert.deepEqual(await activity.locator('time').evaluateAll(xs=>xs.map(x=>x.getAttribute('datetime'))),(await booking('BH2025A')).history.map(x=>x.at));
  await noNull();
  assert.equal((await booking('BH2025A')).booking.status,'cancelled');await mark('historical-read','Open BH2025A','Historic cancelled booking remains readable.');
  const beforeReset=await snap();
  const reset=await infra.call('env.reset',{expected_version:beforeReset.version});assert.equal(reset.status,'ready');
  assert.deepEqual((await snap()).snapshot.data,original);
  await page.reload();await ready('Slots');await click('Select S1');await ready('Review reservation');await noNull();
  await click('Confirm reservation');await text('Synthetic booking confirmed: B5');
  assert.equal((await booking('B5')).booking.slot_id,'S1');await mark('reset-replay','Infra reset, browser reload, select and confirm','Original history and offers restored; independent new B5 on S1.');
  if(evidence)fs.writeFileSync(path.join(evidence,'sequence.json'),JSON.stringify({browser:browser.version(),playwright,node:process.version,viewport,run,frames,interactions},null,2)+'\n');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: Chromium '+browser.version()+' actual clicks, no literal null, independent Core state/readback, stale race, reschedule/cancel, historical lookup and reset/replay.');
 }finally{
  await browser?.close();await agent.close();await infra.close();await host?.close();
  staged.cleanup();fs.rmSync(stateDir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
