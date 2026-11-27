'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {readCapture}=require('../examples/market.cjs');
async function run(options) {
  const root=path.resolve(__dirname,'../../..'),out=path.join(root,'.artifacts'),checks=[];
  const capture=readCapture(path.resolve(options.capture));
  const browser=await chromium.launch({headless:true});
  try {
    for(const [mode,url]of [['live',options.liveUrl],['replay',options.replayUrl]]) {
      const address=new URL(url);assert.equal(address.hostname,'127.0.0.1');
      const page=await browser.newPage({viewport:{width:1280,height:1000}}),external=[],errors=[];
      page.on('request',r=>{if(new URL(r.url()).origin!==address.origin)external.push(r.url());});
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(url);await page.locator('#app[aria-busy=false]').waitFor();
      await page.locator('nav').getByRole('button',{name:'Market',exact:true}).click();await page.locator('canvas').waitFor();
      await page.locator('.source-details summary').click();
      const text=await page.locator('.detail').innerText();
      assert.ok(text.includes('Collected')&&text.includes('Price as of')&&text.includes('Provider delay'));
      await page.getByRole('button',{name:'1D',exact:true}).click();
      assert.ok((await page.locator('.detail').innerText()).includes('15-minute observations'));
      const market=await page.evaluate(async()=>{const {csrf}=await(await fetch('/session')).json();return(await fetch('/api/call',{
        method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf},body:JSON.stringify({name:'finance.market.get',arguments:{}})})).json();});
      assert.equal(market.status,'ok');assert.equal(market.source.mode,mode);assert.equal(market.source.provider,'yahoo_chart');
      assert.ok(market.quotes.length>0&&market.quotes.every(q=>q.raw_price&&q.collected_at&&q.raw_sha256));
      if(mode==='replay') {
        const index=capture.frames.findIndex(f=>f.snapshot.id===market.source.snapshot_id);assert.ok(index>=0);
        const latest=new Map();
        for(const frame of capture.frames.slice(0,index+1))for(const q of frame.snapshot.quotes){
          const prior=latest.get(q.instrument_id);if(!prior||Date.parse(q.as_of)>=Date.parse(prior.as_of))latest.set(q.instrument_id,q);
        }
        for(const q of market.quotes){const expected=latest.get(q.instrument_id);assert.equal(q.id,expected.id);assert.equal(q.price_cents,expected.price_cents);assert.equal(q.raw_price,expected.raw_price);}
      }
      await page.screenshot({path:path.join(out,'finance-'+mode+'-market.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
      checks.push({mode,passed:true,source_metadata:true,daily_and_intraday:true,provider:'yahoo_chart',
        observed_quotes:market.quotes.length,offline_capture_match:mode==='replay',external_browser_requests:0,mobile_no_overflow:true});
      await page.close();
    }
    const report={passed:true,browser:browser.version(),checks};
    fs.writeFileSync(path.join(out,'finance-real-market-browser.json'),JSON.stringify(report,null,2)+'\n');
    return report;
  } finally {await browser.close();}
}
if(require.main===module) {
  const o={};for(let i=2;i<process.argv.length;i+=2){const key={'--live-url':'liveUrl','--replay-url':'replayUrl','--capture':'capture'}[process.argv[i]];if(!key)throw Error('Use --live-url URL --replay-url URL --capture FILE.');o[key]=process.argv[i+1];}
  if(!o.liveUrl||!o.replayUrl||!o.capture)throw Error('Both local access links and the capture file are required.');
  run(o).then(r=>console.log(r.checks.length+' actual real-data/replay browser flows passed.')).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
module.exports={run};
