'use strict';
// Browser acceptance for the Hopline business page through the shared Web Host (needs the full checkout
// and Playwright: `npm ci && npx playwright install chromium` at the repository root):
//   node apps/hopline/tests/gui.browser.cjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hopline-web-')), checks = [];
  const record = (name, ok = true) => { assert.ok(ok, name); checks.push(name); };
  fs.cpSync(pkg, path.join(dir, 'pkg/hopline'), {recursive: true});
  const registry = path.join(dir, 'pkg/registry.json');
  fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'hopline', version: '1.0.0', path: 'hopline'}], initial_time: require('../fixtures/clock.json').initial_time}));
  fs.mkdirSync(out, {recursive: true});
  let host, infra, browser;
  try {
    host = await start({app: 'hopline', registry, stateDir: path.join(dir, 'state'), run: 'web-hopline', profile: 'sandbox'});
    infra = new Client('hopline', 'infra', host.run, path.join(dir, 'state'), 'web-inspector', {registry: host.registry}); await infra.initialize();
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot.data;
    browser = await chromium.launch({headless: true});
    const page = await (await browser.newContext({viewport: {width: 1280, height: 900}, timezoneId: 'America/New_York'})).newPage();
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
    const pick = async text => { await page.locator('#records .record', {hasText: text}).first().click(); await busy(); };
    const button = name => page.getByRole('button', {name, exact: true});
    const form = page.locator('dialog form');
    const submit = async () => { await form.locator('button[type=submit]').click(); await page.locator('dialog').waitFor({state: 'hidden'}); await busy(); };

    // Saved trips: plan the saved step-free commute from its view (a read; the result shows in place).
    await pick('Work commute');
    record('A saved commute shows its window and preferences', await page.locator('.detail', {hasText: '07:20–08:00'}).count() === 1);
    await button('Plan this commute').click(); await form.waitFor(); await submit();
    const plan = await page.locator('.query-result').innerText();
    record('Planning from the page shows itineraries with the Blue Line via Central', plan.includes('Itineraries') && plan.includes('trip:blue:nb'));
    await page.screenshot({path: path.join(out, 'hopline-trips.png'), fullPage: true});

    // Stations: EL-12 fails (an Infra event); after Refresh the station view shows it and its estimate.
    let s = await infra.call('env.snapshot');
    const applied = await infra.call('env.apply_event', {expected_version: s.version, event: JSON.parse(fs.readFileSync(path.join(pkg, 'examples/scenario.json')))});
    record('The outage event commits', applied.status === 'committed');
    await button('Refresh').click(); await busy();
    await nav('Stations & elevators'); await pick('Central');
    record('The station view shows EL-12 out of service with its estimate', await page.locator('.detail', {hasText: 'expected back'}).count() === 1 && await page.locator('.detail', {hasText: 'EL-12'}).count() > 0);
    await page.screenshot({path: path.join(out, 'hopline-stations.png'), fullPage: true});
    await nav('Notices');
    record('The commute notice appears', await page.locator('#records .record', {hasText: 'Elevator out at Central'}).count() === 1);
    await pick('Elevator out at Central'); await button('Mark as read').click(); await busy();
    record('Acknowledging a notice commits', !!(await snapshot()).notifications[0].acknowledged_at);

    // Cards: add value to Lee's card (pending until settled), a pass Dana cannot afford, then a lost card.
    await nav('Cards'); await pick("Dad's card");
    await button('Add value').click(); await form.waitFor(); await form.locator('[data-field="amount_cents"]').fill('2000'); await submit();
    record('Adding value from the page creates a pending load', (await snapshot()).ledger.some(e => e.card_id === 'cd-lee' && e.kind === 'load_pending' && e.amount_cents === 2000));
    record('The card view shows the pending load', await page.locator('.detail', {hasText: '$20.00 (le-cd-lee-6)'}).count() === 1);
    await pick("Dana's card"); await button('Buy a monthly pass').click(); await form.waitFor();
    await form.locator('button[type=submit]').click(); await page.locator('dialog .form-error', {hasText: 'settled balance'}).waitFor();
    record('A pass the balance cannot cover shows the business error and changes nothing', (await snapshot()).passes.length === 0);
    await page.keyboard.press('Escape'); await page.locator('dialog').waitFor({state: 'hidden'});
    await pick("Dad's card"); await button('Report lost').click(); await form.waitFor(); await submit();
    const data = await snapshot();
    record('Reporting the card lost issues cd-lee~r1 and moves the pending load', data.cards.some(c => c.card_id === 'cd-lee~r1') && data.ledger.find(e => e.entry_id === 'le-cd-lee-6').card_id === 'cd-lee~r1');
    await page.screenshot({path: path.join(out, 'hopline-cards.png'), fullPage: true});

    // Autoreload off with an empty rule, and saving a place from the global form (commute fields left empty).
    await pick('cd-dana'); await button('Autoreload').click(); await form.waitFor(); await submit();
    record('An empty autoreload form turns autoreload off', (await snapshot()).cards.find(c => c.card_id === 'cd-dana').autoreload === null);
    await button('Save a place or commute').click(); await form.waitFor();
    await form.locator('[data-field="kind"]').selectOption('place'); await form.locator('[data-field="label"]').fill('Library');
    await form.locator('[data-field="place_ref"]').fill('pl-library'); await submit();
    record('Saving a place from the page commits', (await snapshot()).saved.some(x => x.label === 'Library' && x.place_ref === 'pl-library'));

    // Subscriptions: pause the route subscription.
    await nav('Subscriptions'); await pick('route rt-40'); await button('Pause').click(); await busy();
    record('Pausing a subscription commits a revision', (await snapshot()).subscriptions.find(x => x.subscription_id === 'sub-1').status === 'paused');

    record('No script ran from App text', !(await page.evaluate(() => window.injected)));
    await page.setViewportSize({width: 390, height: 844}); await page.reload(); await page.locator('#records .record').first().waitFor();
    await page.screenshot({path: path.join(out, 'hopline-mobile.png'), fullPage: true});
    record('Narrow layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    record('No JavaScript errors', errors.length === 0);
    return {checks, screenshots: ['hopline-trips.png', 'hopline-stations.png', 'hopline-cards.png', 'hopline-mobile.png'].map(f => path.join('.artifacts/web', f))};
  } finally {
    await browser?.close(); await infra?.close(); await host?.close?.();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log(`PASS: Hopline web page, ${r.checks.length} checks.`); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
