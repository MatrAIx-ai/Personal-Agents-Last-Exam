'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const {runtime,early,observed,closure,agency,accept,business,stable,session,snap,apply,advance,load}=require('./session.cjs');
const run='browser';
const output=process.env.PALE_EVIDENCE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'civic311-browser-'));
fs.mkdirSync(output,{recursive:true});
async function urlFrom(child){
 return new Promise((resolve,reject)=>{
  let log='';
  const t=setTimeout(()=>{reject(new Error('Web Host startup: '+log));child.kill()},15000);
  child.once('exit',c=>{clearTimeout(t);reject(new Error('Web Host exit '+c+': '+log))});
  for(const stream of [child.stdout,child.stderr])stream.on('data',x=>{
   log+=x.toString();
   const u=log.match(/http:\/\/127\.0\.0\.1:\d+\/#access=[A-Za-z0-9_\-]+/);
   if(u){clearTimeout(t);resolve(u[0]);}
  });
 });
}
(async()=>{
 const f=session();let browser,host;
 try{
  const i=await f.make('infra',run),a=await f.make('agent',run);
  await load(i,early);
  host=spawn(process.execPath,[path.join(runtime,'web/server.cjs'),'--app','civic311','--run',run,'--profile','sandbox','--state-dir',f.state,'--registry',f.staged.registry]);
  const url=await urlFrom(host);
  const executablePath=process.env.CHROMIUM_PATH||(['/usr/bin/chromium','/usr/bin/google-chrome'].find(x=>fs.existsSync(x)));
  browser=await chromium.launch(executablePath?{executablePath,chromiumSandbox:true}:{chromiumSandbox:true});const page=await browser.newPage({viewport:{width:1100,height:860}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const click=n=>page.getByRole('button',{name:n,exact:true}).click();
  const see=t=>page.getByText(t,{exact:false}).first().waitFor({state:'visible'});
  const ready=()=>see('Workspace state loaded.');
  const captures=[];
  const shot=async(name)=>{const n=String(captures.length+1).padStart(2,'0')+'-'+name+'.png';await page.screenshot({path:path.join(output,n),fullPage:true});captures.push(n)};
  const watches=async()=>accept(await business(a,'list_watches')).items;
  const activity=async()=>accept(await business(a,'list_activity')).items;
  const read=async()=>accept(await business(a,'read_case',{case_id:'C17'})).item;
  await page.goto(url);await ready();await shot('lookup');
  await page.getByRole('textbox',{name:'Local case ID'}).fill('absent');
  await click('Search cases');await see('No matching case.');await shot('not-found');
  await page.getByRole('textbox',{name:'Local case ID'}).fill('');
  await page.getByRole('combobox',{name:'Borough'}).selectOption('QUEENS');
  await page.getByRole('combobox',{name:'Status'}).selectOption('unknown');
  await click('Search cases');await click('Open C17');
  await see('Status not yet observed');assert.equal((await read()).agency,null);await shot('case-before-observation');
  const before=stable(await snap(i));
  accept(await apply(i,{...closure,at:'2026-11-21T13:59:00Z'}),'invalid_event');
  assert.deepEqual(stable(await snap(i)),before);
  await advance(i,observed,'observe-browser');
  await click('Refresh');await see('QUEENS · Open');assert.equal((await read()).status,'open');
  await click('New watch');await click('Preview watch');await see('Select at least one change.');
  await page.getByRole('checkbox',{name:'Agency closure'}).check();
  await click('Preview watch');await see('Review watch for C17');await shot('watch-preview');
  await click('Discard preview');await see('Nothing saved.');assert.deepEqual(await watches(),[]);
  assert.deepEqual(await activity(),[]);await shot('discard-no-write');
  await click('New watch');await page.getByRole('checkbox',{name:'Agency closure'}).check();
  await click('Preview watch');await click('Confirm watch');await see('Watch saved.');
  assert.deepEqual((await watches())[0].change_types,['resolved']);await shot('saved-watch');
  await click('Edit watch');await page.getByRole('checkbox',{name:'Reopened'}).check();
  await click('Preview watch');
  await advance(i,'2026-11-21T14:00:30Z','invalidate-preview');
  await click('Confirm watch');await page.getByRole('alert').filter({hasText:/version/i}).waitFor();
  assert.deepEqual((await watches())[0].change_types,['resolved']);await shot('stale-preview');
  await click('Refresh');await see('Watching: Agency closure');
  accept(await apply(i,agency),'committed');
  await click('Refresh');await see('Agency: DEP');assert.equal((await read()).agency,'DEP');assert.deepEqual(await activity(),[]);
  await shot('unmatched-agency');
  accept(await apply(i,closure),'committed');assert.equal((await apply(i,closure)).duplicate,true);
  await click('Watches and activity');await see('The agency closed this case.');assert.equal((await activity()).length,1);
  await shot('single-closure');
  await click('Acknowledge C17');await see('Reminder acknowledged.');
  assert.ok((await activity())[0].acknowledged_at);await shot('acknowledged');
  await click('Open C17');
  await click('Edit watch');await page.getByRole('checkbox',{name:'Reopened'}).check();
  await click('Preview watch');await click('Confirm watch');await see('Watch saved.');
  assert.deepEqual((await watches())[0].change_types,['reopened','resolved']);await shot('edited-watch');
  await click('Remove watch');await click('Confirm removal');await see('Watch removed.');
  assert.deepEqual(await watches(),[]);assert.equal((await activity()).length,1);await shot('removed-watch');
  await page.reload();await ready();await click('Watches and activity');await see('Acknowledged');
  accept(await i.call('env.reset',{expected_version:(await snap(i)).version}),'ready');
  await click('Refresh');await see('No local reminders.');assert.deepEqual(await activity(),[]);assert.equal((await read()).status,'unknown');
  await shot('reset');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'browser.json'),JSON.stringify({status:'passed',chromium:browser.version(),captures,
   verified:['filter and not found','unknown and time rollback','discard no-op','persisted save','stale preview','nonmatching agency event','closure with exact replay','acknowledgement and persistence','edit and removal','reset and no JS errors']},null,2));
  console.log('PASS: Chromium + independent public Core Agent/Infra checks. Evidence:',output);
 }finally{await browser?.close();host?.kill();await f.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
