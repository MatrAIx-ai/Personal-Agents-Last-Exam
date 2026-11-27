'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../../..'),runtime=process.env.PALE_RUNTIME_ROOT||path.join(root,'runtime');
const {prepare}=require(path.join(runtime,'prepare.cjs')),{start}=require(path.join(runtime,'web/server.cjs')),{Client}=require(path.join(runtime,'client.cjs'));
const {digestTree}=require(path.join(runtime,'verify.cjs'));
const out=path.resolve(process.env.PALE_FINANCE_BROWSER_OUTPUT||path.join(root,'.artifacts/finance-web'));
async function run() {
  fs.mkdirSync(out,{recursive:true});
  const prepared=prepare(path.resolve(__dirname,'..')),checks=[],errors=[];
  let host,infra,browser,page;
  const report={schema:'pale.finance-browser.v1',checked_at:new Date().toISOString(),node:process.version,
    runtime_version:require(path.join(runtime,'package.json')).version,
    package_sha256:digestTree(prepared.model.get('finance').dir),checks,passed:false};
  const check=(name,condition=true)=>{assert.ok(condition,name);checks.push(name);console.log('PASS: '+name);};
  try {
    host=await start({app:'finance',registry:prepared.registry,stateDir:path.join(prepared.root,'state'),run:'finance-browser'});
    infra=new Client('finance','infra',host.run,host.stateDir,'finance-browser-inspector',{registry:prepared.registry});await infra.initialize();
    browser=await chromium.launch({headless:true});report.browser=browser.version();
    page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    const idle=()=>page.locator('#app[aria-busy=false]').waitFor();
    const snapshot=async()=>(await infra.call('env.snapshot')).snapshot;
    const navigate=async label=>{await page.locator('nav').getByRole('button',{name:label,exact:true}).click();await idle();};
    const refresh=async()=>{await page.getByRole('button',{name:'Refresh',exact:true}).click();await idle();};
    const apply=async(operation,payload,id=operation,at)=>{const s=await snapshot();const r=await infra.call('env.apply_event',{expected_version:{epoch:s.epoch,revision:s.revision},event:{event_id:id,at:at||s.virtual_now,operation,payload}});assert.equal(r.status,'committed',r.message);return r;};
    const approve=async p=>apply('finance.decision_recorded',{approval_id:'browser-approval-'+p.id,proposal_id:p.id,proposal_revision:p.revision,decision:'approve',expires_at:p.expires_at,source_ref:'trusted-browser-test-user'},'decision-'+p.id);
    const preview=async(kind,fields={})=>{
      await page.getByRole('button',{name:{transfer:'Transfer cash',buy:'Buy shares',sell:'Sell shares'}[kind],exact:true}).click();
      const form=page.locator('dialog form');
      for(const[key,value]of Object.entries(fields)) {
        const field=form.locator('[data-field="'+key+'"]');
        if(await field.evaluate(e=>e.tagName)==='SELECT')await field.selectOption(String(value));else await field.fill(String(value));
      }
      await form.locator('[data-field=reason]').fill('Explicitly requested browser workflow.');
      await form.getByRole('button',{name:'Create preview',exact:true}).click();
      await page.locator('dialog').waitFor({state:'hidden'});await idle();
      return (await snapshot()).data.proposals.at(-1);
    };
    await page.goto(host.accessUrl);await page.locator('#records .record').first().waitFor();await idle();
    check('Finance opens through the shared Host with actual MCP account balances',await page.locator('.detail').innerText().then(t=>t.includes('$4,200.00')));
    await page.screenshot({path:path.join(out,'accounts.png'),fullPage:true});
    const p=await preview('transfer',{amount:'100.00'});
    check('Browser preview commits exact parameters without moving money',(await snapshot()).data.accounts[0].balance_cents===420000&&p.parameters.amount_cents===10000);
    const forbidden=await page.evaluate(async()=>{const {csrf}=await(await fetch('/session')).json();return(await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf},body:JSON.stringify({name:'env.snapshot',arguments:{}})})).status;});
    check('Business browser cannot access the Infra connection',forbidden===403);
    check('Business browser offers no self-approval button',await page.getByRole('button',{name:/^(Approve|Confirm)$/}).count()===0);
    await approve(p);await refresh();
    let dropped=false;
    await page.route('**/api/call',async route=>{
      const body=route.request().postDataJSON();
      if(!dropped&&body.name==='finance.actions.execute') {dropped=true;await route.fetch();await route.abort('failed');}
      else await route.continue();
    });
    await page.getByRole('button',{name:'Execute transfer',exact:true}).click();
    await page.locator('#status[data-error=true]').waitFor();await idle();
    await page.getByRole('button',{name:'Execute transfer',exact:true}).click();await idle();
    await page.unroute('**/api/call');
    check('A lost committed response retries the original request with one transfer effect',(await snapshot()).data.receipts.length===1&&(await snapshot()).data.accounts[0].balance_cents===410000);
    await page.reload();await page.locator('#records .record').first().waitFor();await idle();
    await navigate('Receipts');check('Browser reload reads the persisted receipt',await page.locator('.detail').innerText().then(t=>t.includes('-$100.00')));
    const buy=await preview('buy',{quantity:'2'});await approve(buy);await refresh();
    await page.getByRole('button',{name:'Execute buy',exact:true}).click();await idle();
    await navigate('Holdings');check('Browser buy updates the shared holding to seven shares',(await snapshot()).data.holdings[0].quantity===7);
    await page.screenshot({path:path.join(out,'holdings.png'),fullPage:true});
    const sell=await preview('sell',{quantity:'1'});await approve(sell);await refresh();
    await page.getByRole('button',{name:'Execute sell',exact:true}).click();await idle();
    check('Browser sell updates cash and shares',(await snapshot()).data.holdings[0].quantity===6&&(await snapshot()).data.accounts[2].balance_cents===305000);
    await navigate('Market');await page.locator('canvas').waitFor();
    check('Market displays a real locally drawn price chart',await page.locator('canvas').evaluate(c=>c.width>100&&c.height>100));
    await page.screenshot({path:path.join(out,'market.png'),fullPage:true});
    const stale=await preview('buy',{quantity:'1'});await approve(stale);
    await apply('finance.quote_published',{quote_id:'browser-new-quote',instrument_id:'FUND1',price_cents:5100,valid_until:'2026-12-01T09:10:00-08:00'});
    await refresh();
    check('Changed quote removes execution control and explains the invalid preview',await page.getByRole('button',{name:'Execute buy',exact:true}).count()===0&&await page.locator('.detail').innerText().then(t=>t.includes('Quote changed')));
    await page.getByRole('button',{name:'Cancel action',exact:true}).click();await idle();
    check('Browser cancellation commits without an extra fill',(await snapshot()).data.proposals.at(-1).status==='cancelled'&&(await snapshot()).data.receipts.length===3);
    const debit={account_id:'checking',obligation_id:'rent',occurrence_id:'browser-rent',amount_cents:450000};
    await apply('finance.debit_due',debit,'rent-failed');
    await refresh();await navigate('Activity');
    const failed=(await snapshot()).data.transactions.find(t=>t.status==='failed');
    await page.locator('[data-record-id="'+failed.id+'"]').click();
    check('Failed debit is visible and cash remains unchanged',await page.locator('.detail').innerText().then(t=>t.includes('did not debit'))&&(await snapshot()).data.accounts[0].balance_cents===410000);
    await page.screenshot({path:path.join(out,'failed-debit.png'),fullPage:true});
    await apply('finance.credit_posted',{account_id:'checking',amount_cents:50000,source_ref:'additional-funds'},'additional-credit');
    await apply('finance.debit_due',debit,'rent-paid');
    await apply('finance.balance_check',{account_id:'checking',rule_id:'daily-floor',business_date:'2026-12-01'},'fee-assessment','2026-12-01T23:59:00-08:00');
    let interruptedRead=false;
    await page.route('**/api/call',async route=>{
      if(!interruptedRead&&route.request().postDataJSON().name==='finance.accounts.list') {
        interruptedRead=true;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Internal local environment error'})});
      } else await route.continue();
    });
    await refresh();await navigate('Accounts');await page.locator('[data-record-id=checking]').click();
    await page.unroute('**/api/call');
    check('A temporary read failure retries once without replaying any write',interruptedRead);
    check('Independent events refresh the browser with the actual fee and cash',await page.locator('.detail').innerText().then(t=>t.includes('$90.00')&&t.includes('$10.00 assessed')));
    await page.screenshot({path:path.join(out,'account-fee.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    check('Mobile account view has no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await navigate('Market');await page.locator('canvas').waitFor();
    check('Mobile chart fits its page',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
    const reset=await snapshot();assert.equal((await infra.call('env.reset',{expected_version:{epoch:reset.epoch,revision:reset.revision}})).status,'ready');
    await refresh();await navigate('Accounts');
    check('Infra reset restores the original browser-visible baseline',await page.locator('.detail').innerText().then(t=>t.includes('$4,200.00'))&&(await snapshot()).data.receipts.length===0);
    const baseline=await snapshot(),restricted={allow:['finance.accounts.list'],constraints:{}};
    const restrictedLoad=await infra.call('env.load_seed',{expected_version:{epoch:baseline.epoch,revision:baseline.revision},
      request_id:'restricted-browser-load',data:baseline.data,binding:baseline.binding,bundle:baseline.resources.bundle,
      policies:{scenario:restricted,sandbox:restricted},virtual_now:baseline.virtual_now});
    assert.equal(restrictedLoad.status,'ready');
    await refresh();
    check('Restricted discovery hides unavailable actions and reads only permitted accounts',
      await page.getByRole('button',{name:'Transfer cash',exact:true}).count()===0&&await page.locator('nav button').count()===1&&
      await page.locator('.detail').innerText().then(t=>t.includes('$4,200.00')));
    check('No browser JavaScript errors',errors.length===0);
    report.passed=true;
  } catch(error) {
    report.error=error.stack;
    report.host_errors=host?.client.errors;
    report.infra_errors=infra?.errors;
    if(host?.stateDir)fs.cpSync(host.stateDir,path.join(out,'failure-state'),{recursive:true});
    if(page)await page.screenshot({path:path.join(out,'failed.png'),fullPage:true}).catch(()=>{});
    throw error;
  } finally {
    await browser?.close();await infra?.close();await host?.close();prepared.cleanup();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
}
if(require.main===module)run().then(r=>console.log('Finance: '+r.checks.length+' browser checks passed.')).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={run};
