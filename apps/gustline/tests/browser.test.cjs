'use strict';
// Browser acceptance for Gustline's web pages through the shared Web Host (needs the full checkout,
// `npm ci` and Chromium: `npx playwright install chromium`). From the repository root:
//   node apps/gustline/tests/browser.test.cjs
// Real clicks and form entry; every write is checked in the App state through a separate Infra MCP
// connection. Screenshots and a JSON report go to .artifacts/web/gustline/.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const pkg = path.resolve(__dirname, '..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/web/server.cjs'))) { const up = path.dirname(root); if (up === root) { console.log('SKIP: no PALE checkout'); process.exit(0); } root = up; }
let chromium;
try { ({chromium} = require(require.resolve('playwright', {paths: [root]}))); } catch { console.log('SKIP: run `npm ci` and `npx playwright install chromium` first'); process.exit(0); }
const {start} = require(path.join(root, 'runtime/web/server.cjs')), {Client} = require(path.join(root, 'runtime/client.cjs'));
const out = path.resolve(process.env.PALE_WEB_REPORT_DIR || path.join(root, '.artifacts/web/gustline'));

async function main() {
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gustline-browser-')), checks = [];
  const record = (name, condition = true) => { assert.ok(condition, name); checks.push(name); };
  const browser = await chromium.launch({headless: true});
  let host, infra;
  try {
    host = await start({app: 'gustline', registry: path.join(pkg, 'registry.json'), stateDir, run: 'browser-gustline'});
    infra = new Client('gustline', 'infra', host.run, stateDir, 'gustline-web-inspector', {registry: host.registry}); await infra.initialize();
    const data = async () => (await infra.call('env.snapshot')).snapshot.data;
    const context = await browser.newContext({viewport: {width: 1280, height: 900}}), page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const settled = async () => { await idle(); await page.waitForFunction(() => !document.querySelector('#status')?.textContent.startsWith('Connecting')); };
    const dialog = page.locator('dialog');
    const submit = async () => { await dialog.locator('button[type=submit]').click(); await dialog.waitFor({state: 'hidden'}); await idle(); };

    // Page, discovery and coverage.
    await page.goto(host.accessUrl); await settled();
    record('Public Host loads the App-owned page with the default saved place', await page.locator('h2', {hasText: "Kids' school"}).count() === 1);
    for (const heading of ['Official alerts', 'Daylight']) record('Place page shows ' + heading, await page.getByText(heading, {exact: false}).count() > 0);
    record('Place page shows the hourly forecast from the current issuance', await page.locator('.hour').count() > 0);
    const controller = fs.readFileSync(path.join(pkg, 'gui/src/app.js'), 'utf8');
    record('Controller covers every declared business tool', require('../tools.json').every(t => controller.includes("'" + t.name + "'")));
    record('Business discovery has no management tools', (await host.client.request('tools/list')).result.tools.every(t => !t.name.startsWith('env.')));
    await page.screenshot({path: path.join(out, 'place.png'), fullPage: true});

    // Save a place from the gazetteer, with a label that must render as text.
    await page.locator('[data-nav=search]').click(); await idle();
    await page.locator('[data-place-id=pl-dunes]').click(); await dialog.waitFor();
    const label = '<img src=x onerror="window.injected=true">Dunes';
    await dialog.locator('[data-field=label]').fill(label);
    // The first response is lost after Gustline commits; the unchanged retry has one effect.
    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === 'gustline.saved_places.add') { dropped = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
    });
    await dialog.locator('button[type=submit]').click(); await dialog.locator('[role=alert]:not(:empty)').waitFor();
    await submit(); await page.unroute('**/api/call');
    const added = (await data()).saved_places.filter(s => s.place_id === 'pl-dunes');
    record('Retry after a lost committed response has one effect', added.length === 1 && added[0].label === label);
    record('App text is rendered as text, not HTML', await page.evaluate(() => window.injected === undefined) && await page.locator('nav').getByText(label).count() === 1);

    // Rename it, then reload: committed data persists.
    await page.locator('nav').getByText(label).click(); await idle();
    await page.getByRole('button', {name: 'Rename', exact: true}).click(); await dialog.waitFor();
    await dialog.locator('[data-field=label]').fill('Dune Flats'); await submit();
    record('Rename commits', (await data()).saved_places.some(s => s.place_id === 'pl-dunes' && s.label === 'Dune Flats'));
    await page.reload(); await settled();
    record('Reload shows persisted state', await page.locator('nav').getByText('Dune Flats').count() === 1);

    // Create a rule through the form, then edit, pause and resume it.
    await page.getByRole('button', {name: 'New rule', exact: true}).click(); await dialog.waitFor();
    await dialog.locator('[data-field=saved_place_id]').selectOption('sp-2');
    await dialog.locator('[data-field=metric]').selectOption('gust_kph');
    await dialog.locator('[data-field=threshold]').fill('45');
    await dialog.locator('[data-field=delivery]').selectOption('mail');
    await submit();
    let rule = (await data()).rules.find(r => r.metric === 'gust_kph' && r.threshold === 45);
    record('Browser rule create commits a real rule', !!rule && rule.delivery === 'mail' && rule.saved_place_id === 'sp-2');
    await page.locator('[data-nav=rules]').click(); await idle();
    await page.locator(`[data-record-id="${rule.rule_id}"]`).click(); await idle();
    await page.getByRole('button', {name: 'Edit rule'}).click(); await dialog.waitFor();
    await dialog.locator('[data-field=threshold]').fill('55'); await submit();
    rule = (await data()).rules.find(r => r.rule_id === rule.rule_id);
    record('Rule edit sends only the change and adds a revision', rule.threshold === 55 && rule.revision === 2 && JSON.stringify(rule.history.at(-1).changes) === '{"threshold":55}');
    await page.getByRole('button', {name: 'Pause', exact: true}).click(); await dialog.waitFor(); await submit();
    record('Pause commits', (await data()).rules.find(r => r.rule_id === rule.rule_id).status === 'paused');
    await page.getByRole('button', {name: 'Resume', exact: true}).click(); await dialog.waitFor(); await submit();
    record('Resume commits', (await data()).rules.find(r => r.rule_id === rule.rule_id).status === 'active');
    await page.screenshot({path: path.join(out, 'rules.png'), fullPage: true});

    // A stale form shows the conflict and changes nothing.
    await page.getByRole('button', {name: 'Edit rule'}).click(); await dialog.waitFor();
    await dialog.locator('[data-field=threshold]').fill('60');
    const s = await infra.call('env.snapshot');
    const applied = await infra.call('env.apply_event', {expected_version: s.version, event: require('../examples/scenario.json')});
    assert.equal(applied.status, 'committed', JSON.stringify(applied));
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('[role=alert][data-code=stale_version]').waitFor();
    record('Stale form reports the conflict', (await data()).rules.find(r => r.rule_id === rule.rule_id).threshold === 55);
    await dialog.getByRole('button', {name: 'Cancel'}).click();

    // The Infra scenario event shows after Refresh; mark the new notification as read.
    await page.locator('[data-nav=notifications]').click(); await idle();
    await page.getByRole('button', {name: 'Refresh'}).click(); await idle();
    const fresh = (await data()).notifications.find(n => n.status === 'pending_delivery');
    record('Scenario event is visible after Refresh', await page.locator(`[data-record-id="${fresh.notification_id}"]`).count() === 1);
    await page.locator(`[data-record-id="${fresh.notification_id}"]`).click(); await idle();
    await page.getByRole('button', {name: 'Mark as read'}).click(); await idle();
    await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Marked as read.');
    record('Acknowledge commits', !!(await data()).notifications.find(n => n.notification_id === fresh.notification_id).acknowledged_at);
    await page.screenshot({path: path.join(out, 'notifications.png'), fullPage: true});

    // Settings: switch to US units and see the place page change.
    await page.locator('[data-nav=settings]').click(); await idle();
    await page.getByRole('button', {name: 'Change settings'}).click(); await dialog.waitFor();
    await dialog.locator('[data-field=units]').selectOption('us'); await submit();
    record('Settings update commits', (await data()).settings.units === 'us');
    await page.locator('nav [data-nav="sp:sp-2"]').click(); await idle();
    record('Place page renders US units', await page.getByText('°F').count() > 0);

    // Delete the rule; the tombstone stays readable.
    await page.locator('[data-nav=rules]').click(); await idle();
    await page.locator(`[data-record-id="${rule.rule_id}"]`).click(); await idle();
    await page.getByRole('button', {name: 'Delete', exact: true}).click(); await dialog.waitFor(); await submit();
    record('Delete keeps a tombstone', (await data()).rules.find(r => r.rule_id === rule.rule_id).status === 'deleted');

    // Remove the saved place.
    await page.locator('nav').getByText('Dune Flats').click(); await idle();
    await page.getByRole('button', {name: 'Remove', exact: true}).click(); await dialog.waitFor(); await submit();
    record('Remove commits', !(await data()).saved_places.some(s => s.place_id === 'pl-dunes'));

    // The page cannot reach management operations, even by asking directly.
    const direct = await page.evaluate(async () => {
      const session = await (await fetch('/session')).json();
      const r = await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': session.csrf}, body: JSON.stringify({name: 'env.snapshot', arguments: {}})});
      return r.status;
    });
    record('Direct management request is refused', direct === 403);

    // Narrow screen: no horizontal page scroll.
    await page.setViewportSize({width: 760, height: 900}); await page.locator('nav [data-nav="sp:sp-1"]').click(); await idle();
    record('Narrow layout has no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({path: path.join(out, 'narrow.png'), fullPage: true});
    record('No JavaScript errors', errors.length === 0);
    await context.close();
    const report = {schema: 'pale.web-acceptance.v1', app: 'gustline', checked_at: new Date().toISOString(), node: process.version,
      browser: browser.version(), checks, passed: true};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally {
    if (infra) await infra.close();
    if (host) await host.close();
    await browser.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}

if (require.main === module) main().then(r => { console.log(r.checks.map(c => 'ok - ' + c).join('\n')); console.log('PASS: Gustline web, ' + r.checks.length + ' checks.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
module.exports = {main};
