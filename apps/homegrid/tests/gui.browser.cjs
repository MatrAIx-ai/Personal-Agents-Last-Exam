'use strict';
// Browser acceptance for the Homegrid business page through the shared Web Host (needs the full checkout
// and Playwright: `npm ci && npx playwright install chromium` at the repository root):
//   node apps/homegrid/tests/gui.browser.cjs
// It drives the real page, checks every effect in MCP state, and writes screenshots to .artifacts/web/.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/web/server.cjs'))) { const up = path.dirname(root); if (up === root) { console.log('SKIP: no PALE runtime checkout'); process.exit(0); } root = up; }
let chromium;
try { ({chromium} = require(require.resolve('playwright', {paths: [root]}))); } catch { console.log('SKIP: Playwright is not installed (npm ci && npx playwright install chromium)'); process.exit(0); }
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const out = path.join(root, '.artifacts/web');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homegrid-web-')), checks = [];
  const record = (name, ok = true) => { assert.ok(ok, name); checks.push(name); };
  fs.cpSync(pkg, path.join(dir, 'pkg/homegrid'), {recursive: true});
  const registry = path.join(dir, 'pkg/registry.json');
  fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'homegrid', version: '1.0.0', path: 'homegrid'}], initial_time: require('../fixtures/clock.json').initial_time}));
  fs.mkdirSync(out, {recursive: true});
  let host, infra, browser;
  try {
    host = await start({app: 'homegrid', registry, stateDir: path.join(dir, 'state'), run: 'web-homegrid', profile: 'sandbox'});
    infra = new Client('homegrid', 'infra', host.run, path.join(dir, 'state'), 'web-inspector', {registry: host.registry}); await infra.initialize();
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot.data;
    browser = await chromium.launch({headless: true});
    const page = await (await browser.newContext({viewport: {width: 1280, height: 900}})).newPage();
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(host.accessUrl);
    await page.locator('#records .record').first().waitFor(); await page.locator('#app[aria-busy=false]').waitFor();
    record('The Host serves the App-owned page with records');
    const tools = JSON.parse(fs.readFileSync(path.join(pkg, 'tools.json'))), controller = fs.readFileSync(path.join(pkg, 'gui/src/app.js'), 'utf8');
    record('The controller covers every declared business tool', tools.every(t => controller.includes("'" + t.name + "'")));
    record('Business discovery has no management tools', (await host.client.request('tools/list')).result.tools.every(t => !t.name.startsWith('env.')));
    const busy = () => page.locator('#app[aria-busy=false]').waitFor();
    const nav = async text => { await page.locator('nav button', {hasText: text}).click(); await busy(); };
    const form = page.locator('dialog form');
    const submit = async () => { await form.locator('button[type=submit]').click(); await page.locator('dialog').waitFor({state: 'hidden'}); await busy(); };

    // Services: the Maple internet service and a connection test from its detail view.
    await page.locator('#records .record', {hasText: 'internet'}).first().click(); await busy();
    record('Selecting a service shows its detail', await page.locator('.detail h2', {hasText: '22 Maple St'}).count() === 1);
    await page.getByRole('button', {name: 'Run connection test', exact: true}).click(); await form.waitFor(); await submit();
    const svc = (await snapshot()).services.find(s => s.service_id === 'sv-pr-maple-22-internet');
    record('A connection test from the page commits in MCP state', svc.last_test && svc.last_test.result === 'pass');
    await page.screenshot({path: path.join(out, 'homegrid-services.png'), fullPage: true});

    // A read action (preview) shows its result; placing the order uses the token.
    await page.getByRole('button', {name: 'Preview an order', exact: true}).click(); await form.waitFor();
    await form.locator('[data-field="type"]').selectOption('transfer');
    for (const [k, v] of Object.entries({from_premise_id: 'pr-maple-22', to_premise_id: 'pr-linden-14', stop_date: '2027-01-15', start_date: '2027-01-15'})) await form.locator(`[data-field="${k}"]`).fill(v);
    await submit();
    const result = await page.locator('.query-result').innerText();
    record('A preview shows the gap and overlap warnings', result.includes('Service gap days: 3') && result.includes('Overlap days: 1'));
    const token = /Order token\s*\n\s*([A-Za-z0-9_-]{40,})/.exec(result)?.[1];
    record('The preview result carries an order token', !!token);
    await page.getByRole('button', {name: 'Place the previewed order', exact: true}).click(); await form.waitFor();
    await form.locator('[data-field="order_token"]').fill(token); await submit();
    record('Placing the order from the page creates the six orders', (await snapshot()).orders.length === 6);

    // Orders: book the technician window from the order's detail view.
    await nav('Moves & installs');
    await page.locator('#records .record', {hasText: 'start internet'}).click(); await busy();
    await page.getByRole('button', {name: 'Book a window', exact: true}).click(); await form.waitFor();
    await form.locator('[data-field="date"]').fill('2027-01-19'); await form.locator('[data-field="slot"]').selectOption('08-12'); await submit();
    record('Booking a window from the order view commits the appointment', (await snapshot()).appointments.some(a => a.date === '2027-01-19' && a.status === 'booked'));
    record('The order view lists the booked window', await page.locator('.detail', {hasText: '2027-01-19'}).count() > 0 || await page.locator('.detail', {hasText: 'Jan 19'}).count() > 0);
    await page.screenshot({path: path.join(out, 'homegrid-orders.png'), fullPage: true});

    // Bills: the December bill's lines, then a payment from the global form (that bill is already paid).
    await nav('Bills & payments');
    await page.locator('#records .record', {hasText: 'bl-1231'}).click(); await busy();
    record('A bill shows its lines', await page.locator('.detail', {hasText: 'electricity 520 kwh'}).count() === 1);
    await page.getByRole('button', {name: 'Make a payment', exact: true}).click(); await form.waitFor();
    await form.locator('[data-field="amount_cents"]').fill('2500'); await form.locator('[data-field="payment_method_id"]').fill('pm-visa'); await submit();
    record('A payment from the page is pending in MCP state', (await snapshot()).payments.some(p => p.amount_cents === 2500 && p.status === 'pending'));

    // Notices: mark the move confirmation as read.
    await nav('Notices');
    await page.locator('#records .record', {hasText: 'Your move is scheduled'}).click(); await busy();
    await page.getByRole('button', {name: 'Mark as read', exact: true}).click(); await form.waitFor(); await submit();
    record('Acknowledging a notice commits', (await snapshot()).notifications.find(n => n.notification_id === 'n-tr-1-0-sam').acknowledged_at);

    // App text is rendered as text, never as HTML.
    record('No script ran from App text', !(await page.evaluate(() => window.injected)));
    await page.setViewportSize({width: 390, height: 844}); await page.reload(); await page.locator('#records .record').first().waitFor();
    await page.screenshot({path: path.join(out, 'homegrid-mobile.png'), fullPage: true});
    record('Narrow layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    record('No JavaScript errors', errors.length === 0);
    return {checks, screenshots: ['homegrid-services.png', 'homegrid-orders.png', 'homegrid-mobile.png'].map(f => path.join('.artifacts/web', f))};
  } finally {
    await browser?.close(); await infra?.close(); await host?.close?.();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log(`PASS: Homegrid web page, ${r.checks.length} checks.`); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
