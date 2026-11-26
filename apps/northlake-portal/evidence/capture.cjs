'use strict';
// GUI evidence capture (docs/submission-evidence.md, section 1). Starts the public Web Host for this App, drives a
// real Chrome over the DevTools protocol (no npm packages; Node 22+ global WebSocket), walks each core workflow and
// its error paths, checks the persisted state over the Infra MCP connection after every write, and writes ordered
// screenshots plus gui-sequences.json. Reviewers reproduce with:
//   node apps/northlake-portal/evidence/capture.cjs            (CHROME_PATH=/path/to/chrome to override detection)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../../..'), appDir = path.resolve(__dirname, '..');
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const APP = 'northlake-portal', T = APP + '.';
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
const outDir = path.join(__dirname, 'screenshots'), downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-capture-dl-'));
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Browser {
  static async launch() {
    if (!CHROME) throw new Error('Chrome was not found; set CHROME_PATH.');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-capture-profile-'));
    const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,900', 'about:blank'], {stdio:['ignore', 'ignore', 'pipe']});
    const url = await new Promise((resolve, reject) => {let text = ''; child.stderr.on('data', b => {text += b; const m = text.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]);}); child.on('exit', () => reject(new Error('Chrome exited: ' + text)));});
    const b = new Browser(); b.child = child; b.profile = profile; b.seq = 0; b.pending = new Map();
    b.ws = new WebSocket(url);
    await new Promise((resolve, reject) => {b.ws.addEventListener('open', resolve); b.ws.addEventListener('error', reject);});
    b.ws.addEventListener('message', e => {const m = JSON.parse(e.data); const p = b.pending.get(m.id); if (p) {b.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);}});
    return b;
  }
  send(method, params = {}, sessionId) {return new Promise((resolve, reject) => {const id = ++this.seq; this.pending.set(id, {resolve, reject}); this.ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));});}
  async page() {
    const {targetId} = await this.send('Target.createTarget', {url:'about:blank'});
    const {sessionId} = await this.send('Target.attachToTarget', {targetId, flatten:true});
    await this.send('Page.enable', {}, sessionId); await this.send('Runtime.enable', {}, sessionId);
    await this.send('Emulation.setDeviceMetricsOverride', {width:1280, height:900, deviceScaleFactor:1, mobile:false}, sessionId);
    await this.send('Browser.setDownloadBehavior', {behavior:'allow', downloadPath:downloads, eventsEnabled:true});
    const b = this;
    return {
      async goto(url) {await b.send('Page.navigate', {url}, sessionId); await this.waitFor("document.readyState==='complete'");},
      async eval(expression) {const r = await b.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true}, sessionId); if (r.exceptionDetails) throw new Error('Page script failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value;},
      async waitFor(expression, timeout = 12000) {const until = Date.now() + timeout; while (Date.now() < until) {if (await this.eval('!!(' + expression + ')')) return; await sleep(120);} throw new Error('Timed out waiting for: ' + expression);},
      async ready() {await this.waitFor("document.querySelector('#app')?.getAttribute('aria-busy')==='false' && !document.querySelector('dialog[open]') && document.querySelector('#status')?.textContent!=='Connecting…'");},
      async shot(file) {const {data} = await b.send('Page.captureScreenshot', {format:'png'}, sessionId); fs.writeFileSync(path.join(outDir, file), Buffer.from(data, 'base64')); return file;},
      // A control is a button whose text, or one of whose label spans (sidebar navigation), equals the given text; or a CSS selector.
      async click(selectorOrText) {await this.eval("(function(){const t=" + JSON.stringify(selectorOrText) + ";const byText=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===t||[...x.querySelectorAll('span')].some(s=>s.textContent.trim()===t));const n=byText||(function(){try{return document.querySelector(t);}catch(e){return null;}})();if(!n)throw new Error('No control: '+t);n.click();return true;})()");},
      async fill(field, value) {await this.eval("(function(){const i=document.querySelector('dialog[open] [data-field=\"" + field + "\"], .pay-panel [data-field=\"" + field + "\"]');if(!i)throw new Error('No field " + field + "');i.value=" + JSON.stringify(String(value)) + ";i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");},
      async text(selector) {return this.eval("document.querySelector(" + JSON.stringify(selector) + ")?.textContent||''");}
    };
  }
  async version() {return (await this.send('Browser.getVersion')).product;}
  async close() {
    try {await this.send('Browser.close');} catch {}
    const exited = new Promise(r => this.child.once('exit', r)); this.child.kill('SIGTERM'); await Promise.race([exited, sleep(3000)]);
    try {fs.rmSync(this.profile, {recursive:true, force:true});} catch {}
  }
}

async function run() {
  if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
  fs.mkdirSync(outDir, {recursive:true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-capture-state-')), steps = [], hosts = [], clients = [];
  let browser;
  const step = async (page, {id, workflow, state, description, control = null, checks = []}) => {
    const file = await page.shot(id + '.png');
    const entry = {id, file:'screenshots/' + file, workflow, state, description, control, checks:checks.map(([label, passed]) => ({label, passed:!!passed}))};
    steps.push(entry); console.log((entry.checks.every(c => c.passed) ? 'ok   ' : 'FAIL ') + id + '  ' + description);
    return entry;
  };
  try {
    browser = await Browser.launch();
    const registry = path.join(appDir, 'registry.json');
    const host = await start({app:APP, registry, run:'capture-sandbox', stateDir, profile:'sandbox'}); hosts.push(host);
    const infra = new Client(APP, 'infra', host.run, stateDir, 'capture-inspector', {registry}); clients.push(infra); await infra.initialize();
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot.data;
    const page = await browser.page();
    await page.goto(host.accessUrl); await page.ready();

    // Workflow 1: secure messaging. Inbox, thread, reply, and the closed-thread boundary.
    await step(page, {id:'01-inbox', workflow:'messaging', state:'start', description:'Inbox with the billing thread selected; unread threads marked', checks:[['Two open threads listed', (await page.text('#records')).includes('Denied physical therapy claims')]]});
    await page.click('Reply'); await page.waitFor("document.querySelector('dialog[open]')");
    await page.fill('body', 'Thank you. I will also submit a fee waiver request for the October 21 cancellation.');
    await step(page, {id:'02-reply-form', workflow:'messaging', state:'action', description:'Reply form opened from the thread, body filled', control:'Reply → body'});
    await page.click('dialog[open] form button[type=submit]'); await page.ready();
    let data = await snapshot(); const thread = data.threads.find(t => t.thread_id === 'thr-billing-0928'); const last = thread.messages[thread.messages.length - 1];
    await step(page, {id:'03-reply-sent', workflow:'messaging', state:'result', description:'Reply appears in the thread; thread now awaits staff', control:'Send reply', checks:[['MCP state: last message is the patient reply', last.author.role === 'patient' && last.body.startsWith('Thank you. I will also')], ['MCP state: thread awaits staff', thread.awaiting === 'staff']]});
    await page.click('Closed'); await page.ready();
    await step(page, {id:'04-closed-thread', workflow:'messaging', state:'error', description:'A closed thread offers no Reply control and explains that replies are not delivered', checks:[['No Reply control on a closed thread', !(await page.eval("[...document.querySelectorAll('.detail-actions button')].some(b=>b.textContent.trim()==='Reply')"))], ['Closed notice shown', (await page.text('.detail')).includes('replies are not delivered')]]});

    // Workflow 2: billing. Ledger, claim, a refused overpayment, preview, confirm, statement download, billing question.
    await page.click('Billing'); await page.ready();
    await step(page, {id:'05-billing-ledger', workflow:'billing', state:'start', description:'Billing ledger: balance summary, charges with insurer status and flags, payments', checks:[['Balance due shown', (await page.text('#records')).includes('$170.00')]]});
    await page.click('[data-record-id="clm-0815"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"clm-0815\"]')");
    await step(page, {id:'06-claim', workflow:'billing', state:'intermediate', description:'Claim clm-0815: insurer arithmetic, payments applied, denial and reprocessing history, related thread', control:'Charge row', checks:[['History shows resubmitted and reprocessed', (await page.text('.detail')).includes('reprocessed')]]});
    await page.click('Pay $40.00'); await page.waitFor("document.querySelector('.pay-panel')");
    await page.fill('amount_cents', 5000); await page.click('Prepare payment'); await page.waitFor("document.querySelector('.pay-panel [role=alert]')?.textContent");
    await step(page, {id:'07-pay-exceeds-balance', workflow:'billing', state:'error', description:'Preparing $50.00 against a $40.00 charge is refused with the figures; nothing is stored', control:'Prepare payment (5000)', checks:[['exceeds_balance message with figures', (await page.text('.pay-panel [role=alert]')).includes('$50.00 exceeds')], ['MCP state: no preview stored', (await snapshot()).previews.length === 0]]});
    await page.fill('amount_cents', 4000); await page.click('Prepare payment'); await page.waitFor("document.querySelector('.pay-result h3')");
    data = await snapshot();
    await step(page, {id:'08-pay-preview', workflow:'billing', state:'intermediate', description:'Payment preview: allocation, balance after, expiry; nothing charged yet', control:'Prepare payment (4000)', checks:[['MCP state: one live payment preview, no payment yet', data.previews.length === 1 && data.payments.length === 8]]});
    await page.click('Confirm payment of $40.00'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Payment posted')");
    data = await snapshot(); const payment = data.payments.find(p => p.allocations.some(a => a.claim_id === 'clm-0815'));
    await step(page, {id:'09-pay-posted', workflow:'billing', state:'result', description:'Payment posted: the claim page shows the receipt, a $0.00 open balance and the payment in its history; the ledger balance drops to $130.00', control:'Confirm payment', checks:[['MCP state: payment of 4000 cents allocated to clm-0815', !!payment && payment.amount_cents === 4000], ['MCP state: preview consumed', data.previews.length === 0], ['Ledger shows the new balance', (await page.text('#records')).includes('$130.00')], ['Claim page shows the receipt and the applied payment', (await page.text('.detail')).includes('Confirmation NLH-') && (await page.text('.detail')).includes('payment applied')]]});
    await page.click('Statements'); await page.ready(); await page.click('[data-record-id="stmt-2026-10"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"stmt-2026-10\"]')");
    await step(page, {id:'10-statement', workflow:'billing', state:'intermediate', description:'October 2026 statement with its past-due note and the charges it covers', control:'Statement row'});
    await page.click('Download PDF');
    const expected = (await host.client.call(T + 'billing.statement', {id:'stmt-2026-10'})).file;
    let downloaded = null; for (let i = 0; i < 50 && !downloaded; i++) {await sleep(200); const f = fs.readdirSync(downloads).find(x => x.endsWith('.pdf')); if (f) downloaded = path.join(downloads, f);}
    const bytes = downloaded ? fs.readFileSync(downloaded) : null;
    await step(page, {id:'11-statement-downloaded', workflow:'billing', state:'result', description:'Download PDF saved the statement; its bytes match billing.statement byte for byte', control:'Download PDF', checks:[['Browser download has the SHA-256 the portal reports', !!bytes && sha(bytes) === expected.sha256], ['Downloaded file is a PDF with the expected name', !!downloaded && path.basename(downloaded) === expected.filename && bytes.subarray(0, 5).toString() === '%PDF-']]});
    await page.click('Billing'); await page.ready(); await page.click('[data-record-id="clm-0820"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"clm-0820\"]')");
    await page.click('Ask the billing office'); await page.waitFor("document.querySelector('dialog[open]')");
    await page.fill('body', 'I cancelled the October 21 visit through the scheduling thread the evening before. Why was the fee applied?');
    await step(page, {id:'12-billing-question-form', workflow:'billing', state:'action', description:'Billing question about the late cancellation fee, opened from the claim', control:'Ask the billing office → body'});
    await page.click('dialog[open] form button[type=submit]'); await page.ready();
    await page.waitFor("document.querySelector('.detail')?.textContent.includes('Your question was sent')");
    data = await snapshot(); const question = data.threads.find(t => t.related.claim_id === 'clm-0820');
    await step(page, {id:'13-billing-question-sent', workflow:'billing', state:'result', description:'The claim page confirms the question and links the new billing thread', control:'Send question', checks:[['MCP state: billing thread related to clm-0820', !!question && question.recipient.category === 'billing_office'], ['Claim page names the new thread', !!question && (await page.text('.detail')).includes(question.thread_id)]]});

    // Restricted policy: the scenario profile withholds the confirms, so the preview is offered and the confirm is not.
    const restricted = await start({app:APP, registry, run:'capture-scenario', stateDir, profile:'scenario'}); hosts.push(restricted);
    const page2 = await browser.page(); await page2.goto(restricted.accessUrl); await page2.ready();
    await page2.click('Billing'); await page2.ready(); await page2.click('[data-record-id="clm-0816"]'); await page2.waitFor("document.querySelector('.detail[data-selected-id=\"clm-0816\"]')");
    await page2.click('Pay $40.00'); await page2.waitFor("document.querySelector('.pay-panel')"); await page2.click('Prepare payment'); await page2.waitFor("document.querySelector('.pay-result h3')");
    await step(page2, {id:'14-scenario-confirm-withheld', workflow:'billing', state:'error', description:'Under the scenario policy the preview is prepared but the confirm is not offered: the tool is withheld, not hidden by the page', control:'Prepare payment (scenario profile)', checks:[['Withheld notice shown', (await page2.text('.pay-result')).includes('withheld')], ['No confirm control', !(await page2.eval("[...document.querySelectorAll('.pay-result button')].length"))]]});

    const report = {schema:'pale.gui-sequences.v1', app_id:APP, captured_at:new Date().toISOString(), node:process.version, browser:await browser.version(), viewport:{width:1280, height:900},
      hosts:hosts.map(h => ({run:h.run, profile:h.run.endsWith('scenario') ? 'scenario' : 'sandbox', url:h.url})), passed:steps.every(s => s.checks.every(c => c.passed)), steps};
    fs.writeFileSync(path.join(__dirname, 'gui-sequences.json'), JSON.stringify(report, null, 2) + '\n');
    console.log((report.passed ? 'PASS: ' : 'FAIL: ') + steps.length + ' screenshots, ' + steps.reduce((s, x) => s + x.checks.length, 0) + ' checks → ' + path.relative(root, outDir));
    if (!report.passed) process.exitCode = 1;
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    for (const h of hosts) await h.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const d of [stateDir, downloads]) try {fs.rmSync(d, {recursive:true, force:true});} catch {}
  }
}
if (require.main === module) run().catch(e => {console.error(e); process.exitCode = 1;});
module.exports = {run};
