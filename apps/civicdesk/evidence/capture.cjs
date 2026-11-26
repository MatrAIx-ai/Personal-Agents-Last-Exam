'use strict';
// GUI evidence capture (docs/submission-evidence.md, section 1). Starts the public Web Host for this App, drives a
// real Chrome over the DevTools protocol (no npm packages; Node 22+ global WebSocket), walks each core workflow and
// its error paths, checks the persisted state over the Infra MCP connection after every write, and writes ordered
// screenshots plus gui-sequences.json. Reviewers reproduce with:
//   node apps/civicdesk/evidence/capture.cjs            (CHROME_PATH=/path/to/chrome to override detection)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../../..'), appDir = path.resolve(__dirname, '..');
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const APP = 'civicdesk', T = APP + '.';
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
      async fill(field, value) {await this.eval("(function(){const i=document.querySelector('dialog[open] [data-field=\"" + field + "\"], .flow [data-field=\"" + field + "\"]');if(!i)throw new Error('No field " + field + "');i.value=" + JSON.stringify(String(value)) + ";i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");},
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
  const TEXT = 'Retention should be opt-in and end with the episode of care: I have never needed a patient\'s step or heart-rate data more than twelve months after discharge. De-identified sensor streams can be re-identified in a town of about 3,000 where a patient\'s daily 6 am walk past the clinic would identify him. Small clinics need a clear deletion path when care ends; a 30-day deletion on request would work for a two-person practice.';
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

    // Workflow 1: dockets and documents.
    await step(page, {id:'01-dockets', workflow:'dockets', state:'start', description:'Dockets open for comment, soonest deadline first, with days left, extensions, corrections and the member\'s own comments flagged', checks:[['Target docket listed first with days left', (await page.text('#records')).includes('OCDD-2026-0031') && (await page.text('#records')).includes('5 days left')]]});
    await page.click('[data-record-id="OCDD-2026-0031"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"OCDD-2026-0031\"]')?.textContent.includes('Comment on this docket')"); await page.ready();
    await step(page, {id:'02-docket', workflow:'dockets', state:'intermediate', description:'Docket page: summary, supplementary information, the deadline in the agency\'s time zone (Eastern), documents and the comment control', control:'Docket row', checks:[['Deadline shown in Eastern time', (await page.text('.detail')).includes('EST')]]});
    const expectedDocs = (await host.client.call(T + 'dockets.documents', {id:'OCDD-2026-0031'})).documents;
    await page.eval("[...document.querySelectorAll('.detail button')].find(b=>b.textContent.includes('Notice of proposed rulemaking')).click()");
    let downloaded = null; for (let i = 0; i < 50 && !downloaded; i++) {await sleep(200); const f = fs.readdirSync(downloads)[0]; if (f) downloaded = path.join(downloads, f);}
    const bytes = downloaded ? fs.readFileSync(downloaded) : null;
    await step(page, {id:'03-document-downloaded', workflow:'dockets', state:'result', description:'Downloading the notice saves the document; its bytes match dockets.documents byte for byte', control:'Document button', checks:[['Browser download has the SHA-256 the App reports', !!bytes && expectedDocs.some(x => x.file.sha256 === sha(bytes))]]});

    // Workflow 2: draft with validation, review with the acknowledgment, submit, receipt.
    await page.click('Comment on this docket'); await page.waitFor("document.querySelector('.flow textarea')");
    await page.fill('text', 'Too short.'); await page.fill('kind', 'named');
    await page.click('Review and submit'); await page.waitFor("document.querySelector('.problems li')");
    let data = await snapshot();
    await step(page, {id:'04-draft-problems', workflow:'comments', state:'error', description:'A short, named draft without a name is saved but reported: too short and name required; nothing can be submitted yet', control:'Review and submit', checks:[['Both problems listed', (await page.text('.problems')).includes('characters') && (await page.text('.problems')).includes('name')], ['MCP state: draft stored, no comment', data.drafts.length === 1 && data.comments.filter(c => c.docket_id === 'OCDD-2026-0031').length === 0]]});
    await page.fill('text', TEXT); await page.fill('kind', 'anonymous');
    await page.click('Review and submit'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Review before submitting')");
    await step(page, {id:'05-review', workflow:'comments', state:'intermediate', description:'Review step: the final text, how the member appears (anonymous), the deadline, and the acknowledgment that the comment is public and permanent', control:'Review and submit', checks:[['Acknowledgment shown', (await page.text('.detail')).includes('cannot be withdrawn')]]});
    await page.click('Submit comment'); await page.waitFor("document.querySelector('.flow [role=alert]')?.textContent");
    data = await snapshot();
    await step(page, {id:'06-submit-unacknowledged', workflow:'comments', state:'error', description:'Submitting without the acknowledgment is refused; nothing is submitted', control:'Submit comment (unticked)', checks:[['acknowledgment_required message', (await page.text('.flow [role=alert]')).includes('acknowledge')], ['MCP state: still no comment on the docket', data.comments.filter(c => c.docket_id === 'OCDD-2026-0031').length === 0]]});
    await page.click('[data-field="acknowledged"]'); await page.click('Submit comment'); await page.waitFor("document.querySelector('.detail')?.textContent.includes('Tracking number')");
    data = await snapshot(); const mine = data.comments.find(c => c.docket_id === 'OCDD-2026-0031');
    await step(page, {id:'07-receipt', workflow:'comments', state:'result', description:'Receipt: tracking number, anonymous submission, submission time in the agency\'s time zone, the text as submitted, history', control:'Submit comment (acknowledged)', checks:[['MCP state: comment received, draft consumed', !!mine && mine.status === 'received' && mine.submitter.kind === 'anonymous' && data.drafts.length === 0], ['Receipt shows the tracking number', !!mine && (await page.text('.detail')).includes(mine.tracking_number)]]});
    await step(page, {id:'08-my-comments', workflow:'comments', state:'intermediate', description:'My comments: the new submission as received, earlier comments posted'});
    await page.click('Open for comment'); await page.ready(); await page.click('[data-record-id="OCDD-2026-0031"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"OCDD-2026-0031\"]')?.textContent.includes('Comment on this docket')"); await page.ready();
    await page.click('Comment on this docket'); await page.waitFor("document.querySelector('.flow textarea')");
    await page.fill('text', TEXT + ' Also, please publish the deletion timeline.'); await page.click('Review and submit'); await page.waitFor("document.querySelector('.problems li')");
    await step(page, {id:'09-duplicate-refused', workflow:'comments', state:'error', description:'A second non-supplemental comment on the same docket is a possible duplicate; the page offers the supplemental option instead', control:'Review and submit', checks:[['possible_duplicate names the earlier comment', !!mine && (await page.text('.problems')).includes(mine.comment_id)]]});
    await page.click('All dockets'); await page.ready(); await page.click('[data-record-id="BSBR-2025-0004"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"BSBR-2025-0004\"]')");
    await step(page, {id:'10-closed-docket', workflow:'dockets', state:'error', description:'A closed docket offers no comment control; its closing date and the member\'s posted comment are shown', checks:[['No comment control', !(await page.eval("[...document.querySelectorAll('.detail button')].some(b=>b.textContent.trim()==='Comment on this docket')"))], ['Posted comment linked', (await page.text('.detail')).includes('cmt-h001')]]});

    // Events: an extension and a status change applied by Infra appear on the pages after a refresh.
    const before = await infra.call('env.snapshot');
    const extended = await infra.call('env.apply_event', {expected_version:before.version, event:{event_id:'capture-evt-1', at:'2026-12-02T09:00:00-05:00', operation:'docket.period_extended', payload:{docket_id:'OCDD-2026-0031', new_closes_at:'2026-12-18T23:59:00-05:00', reason:'Extended at the request of commenters'}}});
    const posted = await infra.call('env.apply_event', {expected_version:(await infra.call('env.snapshot')).version, event:{event_id:'capture-evt-2', at:'2026-12-09T11:00:00-05:00', operation:'comment.status_changed', payload:{comment_id:mine.comment_id, status:'posted'}}});
    await page.click('Refresh'); await page.ready(); await page.click('Open for comment'); await page.ready(); await page.click('[data-record-id="OCDD-2026-0031"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"OCDD-2026-0031\"]')?.textContent.includes('Extended')");
    await step(page, {id:'11-extended', workflow:'dockets', state:'result', description:'After Infra applied the extension event, the docket shows the new Eastern deadline and the date it was extended from; the member\'s comment stands', control:'env.apply_event docket.period_extended (Infra)', checks:[['Extension committed', extended.status === 'committed'], ['New deadline shown', (await page.text('.detail')).includes('Dec 18, 2026')]]});
    await page.click('My comments'); await page.ready(); await page.click('[data-record-id="' + mine.comment_id + '"]'); await page.waitFor("document.querySelector('.detail[data-selected-id=\"" + mine.comment_id + "\"]')?.textContent.includes('Posted')");
    await step(page, {id:'12-posted', workflow:'comments', state:'result', description:'After Infra applied the status event, the comment reads posted on its receipt page', control:'env.apply_event comment.status_changed (Infra)', checks:[['Status event committed', posted.status === 'committed'], ['MCP state: comment posted', (await snapshot()).comments.find(c => c.comment_id === mine.comment_id).status === 'posted']]});

    const report = {schema:'pale.gui-sequences.v1', app_id:APP, captured_at:new Date().toISOString(), node:process.version, browser:await browser.version(), viewport:{width:1280, height:900},
      hosts:hosts.map(h => ({run:h.run, profile:'sandbox', url:h.url})), passed:steps.every(s => s.checks.every(c => c.passed)), steps};
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
