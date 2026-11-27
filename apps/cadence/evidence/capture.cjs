'use strict';
// GUI evidence capture (docs/submission-evidence.md, section 1). Starts the public Web Host for this App, drives a
// real Chrome over the DevTools protocol (no npm packages; Node 22+ global WebSocket), walks each core workflow and
// its error paths, checks the persisted state over the Infra MCP connection after every write, and writes ordered
// screenshots plus gui-sequences.json. Reviewers reproduce with:
//   node apps/cadence/evidence/capture.cjs            (CHROME_PATH=/path/to/chrome to override detection)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../../..'), appDir = path.resolve(__dirname, '..');
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const APP = 'cadence', T = APP + '.';
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

    // Workflow 2: search and booking, with the plan's refusals.
    await step(page, {id:'01-classes', workflow:'booking', state:'start', description:'Two weeks of classes priced under the trial: included, credit cost or not on the plan; spots left and ratings', checks:[['Trial banner and included tags shown', (await page.text('#records')).includes('Included in trial')]]});
    await page.click('[data-record-id="ci-7752"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"ci-7752\"]')?.textContent.includes('Book this class')");
    await step(page, {id:'02-class', workflow:'booking', state:'intermediate', description:'Class page: studio, instructor, price under the plan, spots, cancellation deadline, whether the studio was visited', control:'Class row'});
    await page.click('Book this class'); await page.waitFor("document.querySelector('.book-result h3')");
    await step(page, {id:'03-book-preview', workflow:'booking', state:'intermediate', description:'Booking preview: included in the trial, free cancellation deadline, expiry; nothing booked yet', control:'Book this class', checks:[['MCP state: one live booking preview, no new reservation', (await snapshot()).previews.length === 1 && (await snapshot()).reservations.filter(r => r.status === 'booked').length === 3]]});
    await page.click('Confirm booking'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Booked.')");
    let data = await snapshot(); const booked = data.reservations.find(r => r.class_instance_id === 'ci-7752');
    await step(page, {id:'04-booked', workflow:'booking', state:'result', description:'Reservation page after the confirm: included, cancel-free deadline, history', control:'Confirm booking', checks:[['MCP state: reservation booked on ci-7752 at no cost', !!booked && booked.status === 'booked' && booked.credits_charged === 0], ['MCP state: preview consumed', data.previews.length === 0]]});
    await page.click('Classes'); await page.ready(); await page.click('[data-record-id="ci-7745"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"ci-7745\"]')?.textContent.includes('Not available on your plan')");
    await step(page, {id:'05-premium-not-included', workflow:'booking', state:'error', description:'A premium class is not available on the trial; the page says why and offers no booking control', checks:[['No Book control', !(await page.eval("[...document.querySelectorAll('.detail button')].some(b=>b.textContent.trim()==='Book this class')"))], ['Reason shown', (await page.text('.detail')).includes('premium classes are not included')]]});
    await page.click('[data-record-id="ci-7722"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"ci-7722\"]')");
    await step(page, {id:'06-repeat-visit', workflow:'booking', state:'error', description:'A second class at a studio already booked this trial is not included (first visit at each studio only)', checks:[['Repeat-visit reason shown', (await page.text('.detail')).includes('first visit at each studio')]]});
    await page.click('[data-record-id="ci-7750"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"ci-7750\"]')?.textContent.includes('Book this class')");
    await page.click('Book this class'); await page.waitFor("document.querySelector('.book-result h3')"); await page.click('Confirm booking'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Booked.')");
    await page.click('Classes'); await page.ready(); await page.click('[data-record-id="ci-7751"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"ci-7751\"]')?.textContent.includes('Book this class')");
    await page.click('Book this class'); await page.waitFor("document.querySelector('.flow [role=alert]')?.textContent");
    data = await snapshot();
    await step(page, {id:'07-overlap-refused', workflow:'booking', state:'error', description:'After booking Wednesday HIIT 45, a boxing class that overlaps it is refused with both times and the conflicting reservation; nothing is stored', control:'Book this class', checks:[['overlap message names the reservation', (await page.text('.flow [role=alert]')).includes('overlaps your reservation')], ['MCP state: no preview stored', data.previews.length === 0]]});
    await page.click('[data-record-id="ci-7740"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"ci-7740\"]')");
    await step(page, {id:'08-full-class-waitlisted', workflow:'booking', state:'intermediate', description:'A full class: the member already holds a waitlist place on it', checks:[['Waitlist place shown', (await page.text('.detail')).includes('wl-311')]]});

    // Workflow 3: reservations, free and late cancellations.
    await page.click('Reservations'); await page.ready();
    await step(page, {id:'09-reservations', workflow:'reservations', state:'start', description:'Upcoming reservations with status, price and overlap flags; past and cancelled below'});
    await page.click('[data-record-id="' + booked.reservation_id + '"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"" + booked.reservation_id + "\"]')");
    await page.click('Cancel'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('inside the free window')");
    await page.click('Confirm cancellation'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Cancelled.')");
    data = await snapshot();
    await step(page, {id:'10-cancelled-free', workflow:'reservations', state:'result', description:'Cancellation inside the free window: no charge, status cancelled', control:'Cancel → Confirm cancellation', checks:[['MCP state: reservation cancelled', data.reservations.find(r => r.reservation_id === booked.reservation_id).status === 'cancelled']]});
    const before = await infra.call('env.snapshot');
    const advanced = await infra.call('env.advance_time', {expected_version:before.version, request_id:'capture-clock-thursday', virtual_now:'2026-12-10T08:00:00-05:00'});
    await page.click('Refresh'); await page.ready();
    await page.click('[data-record-id="rsv-2041"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"rsv-2041\"]')");
    await page.click('Cancel (late)'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Prepare late cancellation')");
    await page.click('Prepare late cancellation'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Cancellation preview')");
    await step(page, {id:'11-late-cancel-preview', workflow:'reservations', state:'intermediate', description:'Infra advanced the clock to Thursday morning: the free window for Strength 60 has closed, so the cancellation shows the $15.00 late fee before anything happens', control:'Cancel (late) → Prepare late cancellation', checks:[['Clock advanced through Infra', advanced.status === 'committed'], ['Fee shown', (await page.text('.detail')).includes('$15.00')]]});
    await page.click('Confirm late cancellation'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Late cancellation recorded')");
    data = await snapshot();
    await step(page, {id:'12-late-cancelled', workflow:'reservations', state:'result', description:'Late cancellation recorded with the fee on a receipt', control:'Confirm late cancellation', checks:[['MCP state: rsv-2041 late_cancelled with a $15.00 fee', data.reservations.find(r => r.reservation_id === 'rsv-2041').status === 'late_cancelled' && data.reservations.find(r => r.reservation_id === 'rsv-2041').fee_cents === 1500], ['MCP state: late fee receipt', data.receipts.some(r => r.kind === 'late_fee' && r.amount_cents === 1500)]]});

    // Waitlist and plan.
    await page.click('Waitlist'); await page.ready(); await page.click('[data-record-id="wl-311"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"wl-311\"]')");
    await step(page, {id:'13-waitlist', workflow:'waitlist', state:'start', description:'Waitlist entry on the full Saturday class: waiting, with the leave control; accept and decline appear once an offer arrives', checks:[['Leave control present', await page.eval("[...document.querySelectorAll('.detail button')].some(b=>b.textContent.trim()==='Leave waitlist')")]]});
    await page.click('Plan'); await page.ready(); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Plan rules')");
    await step(page, {id:'14-plan', workflow:'plan', state:'start', description:'Plan page: trial status and end date, what renews, payment method on file, rules'});
    await page.click('Preview plan change'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Effective on')");
    await step(page, {id:'15-plan-change-preview', workflow:'plan', state:'intermediate', description:'Plan change preview: 8 Credits from the trial end, the charge and credit difference; nothing changed yet', control:'Preview plan change', checks:[['Effective at the trial end', (await page.text('.detail')).includes('2026-12-13')]]});
    await page.click('Confirm plan change'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Plan change scheduled')");
    data = await snapshot();
    await step(page, {id:'16-plan-change-scheduled', workflow:'plan', state:'result', description:'The change is scheduled for the renewal date and shown on the plan page', control:'Confirm plan change', checks:[['MCP state: pending change to 8 Credits', !!data.account.pending_change && data.account.pending_change.plan_id === 'plan-8-credits']]});

    // Restricted policy: the scenario profile withholds plan.change, so the preview is prepared but the confirm is not offered.
    const restricted = await start({app:APP, registry, run:'capture-scenario', stateDir, profile:'scenario'}); hosts.push(restricted);
    const page2 = await browser.page(); await page2.goto(restricted.accessUrl); await page2.ready();
    await page2.click('Plan'); await page2.ready(); await page2.waitFor("document.querySelector('.detail')?.textContent.includes('Plan rules')");
    await page2.click('Preview plan change'); await page2.waitFor("document.querySelector('.detail')?.textContent.includes('Effective on')");
    await step(page2, {id:'17-scenario-plan-withheld', workflow:'plan', state:'error', description:'Under the scenario policy the plan preview is prepared but the change is withheld: the tool is absent from discovery, not hidden by the page', control:'Preview plan change (scenario profile)', checks:[['Withheld notice shown', (await page2.text('.detail')).includes('withheld')], ['No confirm control', !(await page2.eval("[...document.querySelectorAll('.detail button')].some(b=>b.textContent.trim()==='Confirm plan change')"))]]});

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
