'use strict';
const a=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const rt=path.resolve(process.env.PALE_RUNTIME_ROOT||path.join(__dirname,'../../../runtime'));
const {prepare}=require(rt+'/prepare.cjs'),{Client}=require(rt+'/client.cjs'),{start}=require(rt+'/web/server.cjs');
const width=Number(process.env.PALE_BROWSER_WIDTH||1280),viewport={width,height:width===390?844:900},out=process.env.PALE_EVIDENCE_DIR,run='refund-browser';
let p,h,i,b;
async function main(){
 if(out)fs.mkdirSync(out,{recursive:true});
 p=prepare(path.join(__dirname,'..'));
 h=await start({app:p.app,registry:p.registry,run,profile:'scenario',stateDir:path.join(p.root,'state')});
 i=new Client(p.app,'infra',h.run,h.stateDir,'browser-verifier',{registry:p.registry});await i.initialize();
 b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,chromiumSandbox:true});
 const page=await b.newPage({viewport,locale:'en-US',timezoneId:'Asia/Shanghai'}),errors=[],steps=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/content security policy/i.test(m.text()))errors.push(m.text());});
 const btn=name=>page.getByRole('button',{name,exact:true}),visible=txt=>page.getByText(txt,{exact:true}).waitFor(),status=page.getByRole('status'),field=page.getByLabel('Order number');
 const open=async id=>{await btn('Order lookup').click();await field.fill(id);await field.press('Enter');};
 const accessibleView=async(view,navFocus=true)=>{
  const heading=page.getByRole('heading',{level:2,name:view,exact:true});await heading.waitFor();
  a.equal(await page.title(),view+' · Refund-only Returns');
  a.equal(await btn(view).getAttribute('aria-current'),'page');
  a.equal(await page.locator('[aria-current=page]').count(),1);
  if(navFocus)a.equal(await heading.evaluate(n=>document.activeElement===n),true);
 };
 const contrast=([r,g,b])=>[r,g,b].map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
  .reduce((sum,v,k)=>sum+v*[.2126,.7152,.0722][k],0);
 async function readable(){
  const metrics=await page.locator('#app').evaluate(root=>{
   const visible=Array.from(root.querySelectorAll('*')).filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
   return {minFont:Math.min(...visible.map(n=>parseFloat(getComputedStyle(n).fontSize))),
    noScroll:document.documentElement.scrollWidth<=window.innerWidth, colors:[...root.querySelectorAll('.quiet,.metadata-line span,.result,.form-error')].filter(e=>visible.includes(e)).map(e=>{
     let bg=e;while(bg&&getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;
     return [getComputedStyle(e).color,getComputedStyle(bg||root).backgroundColor];
    })};
  });
  a.ok(metrics.minFont>=12);a.equal(metrics.noScroll,true);
  for(const [fg,bg] of metrics.colors){
   const lum=v=>contrast(v.match(/[\d.]+/g).slice(0,3).map(Number));
   const [lo,hi]=[lum(fg),lum(bg)].sort((x,y)=>x-y);
   a.ok((hi+.05)/(lo+.05)>=4.5,fg+' on '+bg+' does not meet 4.5:1');
  }
 }
 async function twoCards(leftName){
  await readable();
  const left=await page.getByRole('region',{name:leftName}).boundingBox(),right=await page.getByRole('region',{name:'Refund summary'}).boundingBox();
  if(width>=620){a.equal(left.y,right.y);a.ok(right.x>left.x+left.width);a.ok(right.x+right.width-left.x>width*.70);}
  else{a.equal(left.x,right.x);a.ok(right.y>left.y+left.height);}
 }
 const snap=()=>i.call('env.snapshot'),base=await snap();
 const frame=async (slug,action,expected,check)=>{
  await readable();const s=await snap();a.equal(s.status,'ok');
  const observed=check(s.snapshot,s.version);
  const file=String(steps.length+1).padStart(2,'0')+'-'+slug+'.png';
  if(out)await page.screenshot({path:path.join(out,file),fullPage:true});
  steps.push({file,action,expected,observed,infra:{snapshot_call:'env.snapshot',version:s.version,virtual_now:s.snapshot.virtual_now}});
 };
 const noWrite=s=>{a.deepEqual(s.data,base.snapshot.data);return 'Baseline business data unchanged';};
 const reset=async()=>{a.equal((await i.call('env.reset',{expected_version:(await snap()).version})).status,'ready');const s=await snap();a.deepEqual(s.snapshot.data,base.snapshot.data);a.deepEqual(s.snapshot.receipts,{});a.equal(s.snapshot.virtual_now,base.snapshot.virtual_now);};
 const forward=async id=>{const s=await snap();a.equal((await i.call('env.advance_time',{expected_version:s.version,request_id:id,virtual_now:'2026-01-10T10:00:01Z'})).status,'committed');};
 await page.goto(h.accessUrl);await field.waitFor();
 await accessibleView('Order lookup',false);a.equal(await page.locator('p[role=status]').isVisible(),false);
 await frame('lookup','Open Web Host access link','Order lookup has a labeled order-number field and start action',noWrite);
 await open('bad?input');await visible('Enter a valid order number without internal spaces.');a.equal(await field.getAttribute('aria-invalid'),'true');
 await frame('malformed-number','Submit malformed order number','Inline message; no raw validator text and no state mutation',noWrite);
 await open('99999');await visible('No order matched that number in this account. Check it and try again.');
 await frame('not-found','Search for missing #99999','Field-level not-found message; no state mutation',noWrite);
 await open('#10423');await visible('Return deadline passed');await visible('The refund request window for this item has closed. Check your order confirmation or look up another order.');a.equal(await btn('Prepare refund preview').count(),0);
 await frame('expired-order','Find older order #10423','Expired with no preview button',noWrite);
 await open('#10424');await visible('Not eligible');await visible('This item is excluded by the store’s return policy. Check your order confirmation or look up a different order.');
 await frame('ineligible-order','Find policy-excluded order','Reason and next action are shown, with no preview action',noWrite);
 await open('# 10421');await visible('Desk organizer');await accessibleView('Order detail');
 a.match(await page.locator('article').innerText(),/¥13\.50/);
 a.doesNotMatch(await page.locator('article').innerText(),/2026-01-02T09:/);
 a.match(await page.getByRole('region',{name:'Order summary'}).innerText(),/5:00 PM/);
 await frame('order-detail','Find #10421','Item, amount, formatted dates and eligibility visible; read only',noWrite);
 for(let pass=0;pass<2;pass++){
  await btn('Prepare refund preview').click();await status.getByText('Preview prepared. Nothing has been submitted.').waitFor();
  const id='RR-'+(pass+1);
  await accessibleView('Request review');await twoCards('Order summary');
  const button=await btn('Confirm refund request').boundingBox(),summary=await page.getByRole('region',{name:'Refund summary'}).boundingBox();
  a.ok(button.width>summary.width-54);a.ok(button.height>=44);
  await frame('discard-'+pass+'-preview','Open refund preview '+(pass+1),'New draft; no confirmed request',s=>{a.equal(s.data.requests.find(r=>r.id===id).status,'draft');return id+' draft';});
  await btn('Discard preview').click();await status.getByText('Preview discarded. No refund request was submitted.').waitFor();
  await frame('discard-'+pass+'-result','Discard preview','Draft becomes discarded without a confirmed request',s=>{a.equal(s.data.requests.find(r=>r.id===id).status,'discarded');a.equal(s.data.requests.filter(r=>r.order_id==='order-1'&&r.status==='confirmed').length,0);return id+' discarded; confirmed count 0';});
 }
 for(let pass=0;pass<2;pass++){
  await reset();
  await open('#10422');await btn('Review preview').click();await btn('Confirm refund request').waitFor();
  if(!pass)await frame('cutoff-before','Review seeded draft for #10422','Eligible before advancing to the deadline',noWrite);
  await forward('browser-cutoff');
  await btn('Confirm refund request').click();await visible('The workspace changed. Refresh and review before retrying.');
  if(!pass)await frame('cutoff-stale','After Infra advances clock, click old confirmation','Inline stale rejection; draft remains unchanged',noWrite);
  await btn('Refresh view').click();await visible('Return deadline passed');a.equal(await btn('Confirm refund request').count(),0);
  if(!pass)await frame('cutoff-refreshed','Refresh after stale denial','Expired and no confirm control; business records unchanged',noWrite);
  a.deepEqual((await snap()).snapshot.data,base.snapshot.data);
 }
 await reset();
 await open('#10421');
 for(let pass=0;pass<2;pass++){
  await btn('Prepare refund preview').click();await btn('Confirm refund request').click();
  await status.getByText('Refund request recorded. No payment was issued.').waitFor();
  await accessibleView('Request status');await twoCards('Request progress');await visible('What happens next');await visible('Return deadline');
  await visible('Submitted');await visible('You can cancel this request before dispatch. No payment was issued.');
  const id='RR-'+(pass+1);
  await frame('cancel-'+pass+'-confirmed','Confirm the '+(pass+1)+' refund request','Current request is confirmed',s=>{a.equal(s.data.requests.find(r=>r.id===id).status,'confirmed');return id+' confirmed';});
  await btn('Cancel request…').click();
  await frame('cancel-'+pass+'-prompt','Open cancellation confirmation','Prompt visible; request still confirmed',s=>{a.equal(s.data.requests.find(r=>r.id===id).status,'confirmed');return id+' still confirmed';});
  await btn('Confirm cancellation').click();await status.getByText('Refund request cancelled.').waitFor();
  await frame('cancel-'+pass+'-result','Confirm cancellation','Same-clock previously cancelled request does not block this attempt',s=>{a.equal(s.data.requests.find(r=>r.id===id).status,'cancelled');a.equal(s.virtual_now,base.snapshot.virtual_now);return id+' cancelled, clock unchanged';});
  await btn('Order detail').click();await btn('Prepare refund preview').waitFor();
 }
 await reset();
 await open('#10422');await btn('Review preview').click();await btn('Confirm refund request').click();
 await status.getByText('Refund request recorded. No payment was issued.').waitFor();
 await forward('browser-after-confirm');await btn('Refresh view').click();await visible('Confirmed');
 await frame('confirmed-after-cutoff','Advance past deadline after confirmation, then refresh','Request remains confirmed',s=>{a.equal(s.data.requests.find(r=>r.id==='request-1').status,'confirmed');return 'request-1 confirmed after deadline';});
 await btn('Cancel request…').click();await btn('Confirm cancellation').click();await status.getByText('Refund request cancelled.').waitFor();
 a.equal((await snap()).snapshot.data.requests.find(r=>r.id==='request-1').status,'cancelled');
 await open('#10426');await visible('Request already dispatched');await btn('View request 1 · dispatched').click();await visible('Dispatched requests cannot be cancelled.');
 a.equal(await btn('Cancel request…').count(),0);
 await frame('dispatched','Open dispatched request','Status stays dispatched; no cancellation button',s=>{a.equal(s.data.requests.find(r=>r.id==='request-4').status,'dispatched');return 'request-4 dispatched';});
 await reset();await open('#10422');await btn('Review preview').click();await btn('Confirm refund request').waitFor();
 const other=new Client(p.app,'agent',h.run,h.stateDir,'other-browser-session',{registry:p.registry});
 try {
  await other.initialize();
  const prior=await snap(),confirmed=await other.call(p.app+'.confirm_request',{refund_request_id:'request-1',expected_version:prior.version,request_id:'second-tab-confirm'});
  a.equal(confirmed.status,'committed');a.equal(confirmed.request.submitted_at,prior.snapshot.virtual_now);
  await btn('Confirm refund request').click();await visible('The workspace changed. Refresh and review before retrying.');
  await btn('Refresh view').click();await page.getByRole('heading',{name:'Request status',exact:true}).waitFor();
  await visible('Submitted');a.equal(await btn('Confirm refund request').count(),0);a.equal(await btn('Cancel request…').count(),1);
  await frame('stale-confirmed-refresh','Second session confirms; stale first session refreshes','Heading changes to Request status, submitted time and cancellation are shown',s=>{a.equal(s.data.requests.find(x=>x.id==='request-1').status,'confirmed');return 'request-1 confirmed once; first session is on Request status';});
 } finally { await other.close(); }
 await reset();await open('#10421');await btn('Prepare refund preview').waitFor();
 const localized=await b.newPage({viewport,locale:'fr-FR',timezoneId:'Asia/Shanghai'});
 try {
  const session=await page.context().cookies();
  await localized.context().addCookies(session);
  await localized.goto(new URL(h.accessUrl).origin);
  const f=localized.getByLabel('Order number');await f.fill('# 10421');await f.press('Enter');
  await localized.getByRole('heading',{name:'Desk organizer'}).waitFor();
  a.equal(await localized.locator('.amount').innerText(),new Intl.NumberFormat('fr-FR',{style:'currency',currency:'CNY',currencyDisplay:'narrowSymbol'}).format(13.5));
 } finally {await localized.close();}
 await frame('reset','Reset through independent Infra, then look up again','Baseline and clock restored',noWrite);
 a.deepEqual(errors,[]);
 if(out)fs.writeFileSync(path.join(out,'sequence.json'),JSON.stringify({chromium:b.version(),viewport,timezone:'Asia/Shanghai',run,steps},null,2)+'\n');
 console.log('PASS: actual Chromium and independent Infra checks for lookup, malformed/missing order, two same-clock discards and cancellations, stale expiry, confirmed-after-deadline, dispatch cutoff and reset/replay at '+viewport.width+'×'+viewport.height+'; responsive geometry, text/contrast, focus, page state and localized currency asserted.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await Promise.allSettled([b?.close(),i?.close()]);await h?.close();p?.cleanup();});
