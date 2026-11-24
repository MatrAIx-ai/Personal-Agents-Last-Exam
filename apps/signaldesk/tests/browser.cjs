'use strict';
// Run from a full checkout with its pinned Playwright dev dependency installed.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const runtime=process.env.PALE_RUNTIME_ROOT||path.resolve(__dirname,'../../../runtime');
const {start}=require(path.join(runtime,'web/server.cjs'));
const {Client}=require(path.join(runtime,'client.cjs'));
async function main(){
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'signaldesk-web-'));
  const registry=path.resolve(__dirname,'../registry.json'),run='acceptance';
  let host,browser,infra;
  try{
    host=await start({app:'signaldesk',registry,run,stateDir});
    infra=new Client('signaldesk','infra',run,stateDir,'signaldesk-verification',{registry});await infra.initialize();
    browser=await chromium.launch({headless:true,...(process.env.SIGNALDESK_BROWSER?{executablePath:process.env.SIGNALDESK_BROWSER}:{})});
    const page=await browser.newPage();page.setDefaultTimeout(10000);
    const click=name=>page.getByRole('button',{name,exact:true}).click();
    const visible=text=>page.getByText(text,{exact:true}).first().waitFor();
    const view=async(name)=>{await click(name);await page.getByRole('heading',{name,exact:true}).waitFor();};
    const read=async(name)=>(await host.client.call('signaldesk.'+name,{})).details;
    const snapshot=()=>infra.call('env.snapshot');
    const admin=async(name,args)=>{const r=await infra.call(name,{expected_version:(await snapshot()).version,...args});assert.ok(['ready','committed'].includes(r.status),JSON.stringify(r));return r;};
    await page.goto(host.accessUrl);await visible('line-03');
    assert.equal((await read('account')).usage.length,36);
    await view('Compare plans');await visible('global');assert.equal((await read('catalog')).plans.length,3);
    await view('Manage plan');await page.getByLabel('New plan').selectOption('global');await click('Preview plan change');
    await visible('Review change');assert.equal((await read('plan')).pending,null);await click('Confirm change');
    await page.getByRole('status').filter({hasText:'Confirmed'}).waitFor();
    await page.reload();await visible('line-03');await view('Manage plan');await page.locator('p').filter({hasText:'Pending change global'}).waitFor();
    assert.equal((await read('plan')).pending.plan_id,'global');
    await view('Roaming passes');
    await page.getByLabel('Mobile line').selectOption('line-02');
    await page.getByLabel('Destination').selectOption('JP');
    await page.getByLabel('Start (UTC)').fill('2026-01-03T00:00');
    await click('Preview new pass');await visible('Choose a covered destination.');
    await page.getByLabel('Pass product').selectOption('world');await click('Preview new pass');
    await click('Confirm change');await visible('scheduled');assert.equal((await read('passes')).passes[0].line_id,'line-02');
    await admin('env.advance_time',{request_id:'start-pass',virtual_now:'2026-01-03T00:00:00Z'});
    await click('Refresh');await visible('active');
    const ledgerLength=(await snapshot()).snapshot.data.charges.length;
    await view('Statements & notices');await visible('activation-'+(await read('passes')).passes[0].id);assert.equal((await read('statement')).charges.length,ledgerLength+1);
    assert.equal((await snapshot()).snapshot.data.charges.length,ledgerLength);
    const event={...require('../examples/scenario.json'),at:'2026-01-03T00:10:00Z'};
    event.payload={...event.payload,occurred_at:event.at};
    await admin('env.apply_event',{event});
    assert.equal((await snapshot()).snapshot.data.charges.length,ledgerLength+1);
    await click('Refresh');await visible('Pass activated');
    assert.equal((await host.client.call('env.snapshot',{})).status,'permission_denied');
    // Replay the same traffic and change requests from the loaded baseline twice.
    await admin('env.reset',{});
    const seed=(await snapshot()).snapshot.data;
    let previous;
    for(let trial=0;trial<2;trial++){
      const args={event,expected_version:(await snapshot()).version};
      assert.equal((await infra.call('env.apply_event',args)).status,'committed');
      assert.equal((await infra.call('env.apply_event',args)).duplicate,true);
      const data=(await snapshot()).snapshot.data;
      if(previous)assert.deepEqual(data,previous);previous=data;
      await admin('env.reset',{});assert.deepEqual((await snapshot()).snapshot.data,seed);
    }
    const peer=new Client('signaldesk','agent',run,stateDir,'second-session',{registry});
    try{
      await peer.initialize();
      const {version}=await host.client.call('signaldesk.plan',{});
      const race=await Promise.all([host.client,peer].map((client,index)=>client.call('signaldesk.preview',{
        expected_version:version,request_id:'race-'+index,action:'change_plan',plan_id:index?'global':'basic'
      })));
      assert.deepEqual(race.map(r=>r.status).sort(),['committed','stale_version']);
      assert.equal((await snapshot()).snapshot.data.previews.length,1);
    }finally{await peer.close();}
    const s=(await snapshot()).snapshot;
    await admin('env.load_seed',{request_id:'load-member',data:require('../fixtures/build.cjs').fixture('member'),binding:s.binding,policies:require('../fixtures/member-policies.json'),bundle:s.resources.bundle,virtual_now:'2026-01-01T00:00:00Z'});
    await page.reload();await visible('line-02');assert.equal(await page.getByText('line-03',{exact:true}).count(),0);
    await view('Manage plan');assert.equal(await page.getByRole('button',{name:'Preview plan change'}).count(),0);
    console.log('PASS: five browser views, plan and pass confirmations, visible rejection, reload and MCP parity, pure clock projection, one charge, two reset/replays, concurrent write conflict, member scope. Browser '+browser.version());
  }finally{if(browser)await browser.close();if(infra)await infra.close();if(host)await host.close();fs.rmSync(stateDir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
