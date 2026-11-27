'use strict';
// Run against a local live/replay Host with at least one week of intraday
// history and more than a month of daily history. No provider calls here.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
async function run(url) {
  assert.equal(new URL(url).hostname,'127.0.0.1');
  const browser=await chromium.launch({headless:true}),checks=[];
  try {
    const page=await browser.newPage({viewport:{width:1360,height:950}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.locator('#app[aria-busy=false]').waitFor();
    await page.locator('nav').getByRole('button',{name:'Market',exact:true}).click();
    const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const observed=new Map();
    for(const style of ['Line','Candles']) {
      await page.getByRole('button',{name:style,exact:true}).click();
      for(const range of ['1D','1W','1M','ALL','1M','1W','1D','ALL']) {
        await page.getByRole('button',{name:range,exact:true}).click();await settled();
        assert.equal(await page.locator('.chart-ranges [aria-pressed=true]').innerText(),range);
        const coverage=await page.locator('.chart-coverage').innerText();
        const hash=await page.locator('canvas').evaluate(e=>e.toDataURL());
        const signature=crypto.createHash('sha256').update(hash).digest('hex');
        const key=style+range,prior=observed.get(key);
        if(prior)assert.deepEqual({coverage,signature},prior,'Returning to a range must restore its exact series.');
        else observed.set(key,{coverage,signature});
        checks.push({style,range,coverage});
      }
      assert.equal(new Set(['1D','1W','1M','ALL'].map(range=>observed.get(style+range).signature)).size,4,'Each time range must draw distinct data.');
      assert.notEqual(observed.get(style+'1D').coverage,observed.get(style+'1W').coverage);
      assert.notEqual(observed.get(style+'1M').coverage,observed.get(style+'ALL').coverage);
    }
    // Multiple range changes in the same frame must leave the final selection drawn.
    await page.evaluate(()=>{for(const range of ['1D','ALL','1W','1M','1D'])[...document.querySelectorAll('.chart-ranges button')].find(b=>b.textContent===range).click();});await settled();
    assert.equal(await page.locator('.chart-ranges [aria-pressed=true]').innerText(),'1D');
    const final=await page.locator('canvas').evaluate(e=>e.toDataURL());
    assert.equal(crypto.createHash('sha256').update(final).digest('hex'),observed.get('Candles1D').signature);
    assert.deepEqual(errors,[]);
    const report={passed:true,checked_at:new Date().toISOString(),checks,rapid_switch:true};
    const output=path.resolve(__dirname,'../../../.artifacts/finance-chart-ranges.json');
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log('PASS: 16 range switches, distinct data in every range, exact restoration and rapid switching.');
    return report;
  } finally {await browser.close();}
}
if(require.main===module)run(process.argv[2]).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={run};
