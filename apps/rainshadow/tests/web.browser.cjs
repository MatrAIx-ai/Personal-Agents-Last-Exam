#!/usr/bin/env node
'use strict';
// Browser checks of the Rainshadow web pages on the public business Web Host: real controls in
// a real browser, with the same run inspected through MCP after every write.
//
//   node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--chrome PATH]
//
// DIR is the `runtime` directory of a public PALE checkout (1.6.0 or later, with runtime/web);
// PALE_RUNTIME_ROOT=DIR works too. Playwright is the checkout's own pinned dev dependency
// (`npm ci` at the checkout root, then `npx playwright install chromium`); --chrome uses an
// installed Chrome instead of Playwright's Chromium. The package is copied into a temporary
// registry; nothing in the checkout or this folder is written except the report and screenshots.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');

function options() {
  const out = { runtime: process.env.PALE_RUNTIME_ROOT };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--runtime', '--report', '--screenshots', '--chrome'].includes(key) || !value) return null;
    out[key.slice(2)] = value;
  }
  return out.runtime ? out : null;
}
const opts = options(), root = opts && path.resolve(opts.runtime);
if (!opts || !fs.existsSync(path.join(root, 'web', 'server.cjs'))) {
  console.error('Usage: node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--chrome PATH]');
  process.exit(2);
}
let playwright;
try { playwright = require(require.resolve('playwright', { paths: [process.cwd(), path.dirname(root)] })); }
catch { console.error('Playwright is not installed: run `npm ci` at the checkout root (it pins playwright), then `npx playwright install chromium`.'); process.exit(2); }
const { prepare } = require(path.join(root, 'prepare.cjs')), { Client } = require(path.join(root, 'client.cjs'));
const { start } = require(path.join(root, 'web', 'server.cjs')), { digestTree } = require(path.join(root, 'verify.cjs'));

const WREN = 'pl-wren-lake', MARROW = 'pl-marrowby', DENVER = 'America/Denver';
const at = (date, hhmm, offset = '-07:00') => date + 'T' + hhmm + ':00' + offset;
const temperature = v => Number(v).toFixed(1).replace(/\.0$/, '');

async function main() {
  const prepared = prepare(appDir), stateDir = path.join(prepared.root, 'state'), started = Date.now();
  const shots = opts.screenshots ? path.resolve(opts.screenshots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const checks = [], screenshots = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  let browser, host, restricted, infra, restrictedInfra;
  const pages = []; // for a screenshot of each open page when a check fails
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(opts.chrome ? { executablePath: opts.chrome } : {}) });
    host = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'browser', profile: 'sandbox' });
    infra = new Client(prepared.app, 'infra', host.run, stateDir, 'rainshadow-web-inspector', { registry: prepared.registry });
    await infra.initialize();
    const agent = host.client;
    const snap = async () => infra.call('env.snapshot');
    const data = async () => (await snap()).snapshot.data;
    const mcp = async (name, args) => { const r = await agent.call('rainshadow.' + name, args); assert.ok(['ok', 'committed'].includes(r.status), name + ': ' + r.status); return r; };

    // The browser runs in another zone than any place: times must come out in the place's own zone.
    const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), page = await context.newPage();
    page.setDefaultTimeout(10000); pages.push(page);
    const errors = [], calls = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/call')) calls.push(r.postDataJSON()); });
    const ready = () => page.locator('#app[aria-busy=false]').waitFor();
    const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp(name) }).click(); await ready(); };
    const placePage = id => page.locator('.detail article[data-place-id="' + id + '"][data-loaded="true"]');
    const openPlace = async id => { await nav('Places'); await page.locator('#records [data-record-id="' + id + '"]').click(); await placePage(id).waitFor(); };
    const dialog = page.locator('dialog.rs-dialog');
    const submit = async () => { await dialog.locator('button[type=submit]').click(); await dialog.waitFor({ state: 'detached' }); await ready(); };
    const refused = async code => { await dialog.locator('[role=alert][data-code="' + code + '"]').waitFor(); const text = await dialog.locator('[role=alert]').innerText(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); return text; };
    const lastCall = name => calls.filter(c => c.name === name).at(-1);
    const shot = async name => { if (!shots) return; const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(path.basename(file)); };

    // ---- the pages and what they show ----------------------------------------------------------
    await page.goto(host.accessUrl);
    await page.locator('#records .record').first().waitFor(); await ready();
    check('the Host serves the App-owned pages', await page.locator('.brand h1').innerText() === 'Rainshadow');
    const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8'), tools = JSON.parse(fs.readFileSync(path.join(appDir, 'tools.json'), 'utf8'));
    check('the controller names every declared business tool', tools.every(t => controller.includes("'" + t.name + "'")));
    const discovered = (await agent.request('tools/list')).result.tools.map(t => t.name);
    check('business discovery offers no management tool', discovered.length === tools.length && discovered.every(n => !n.startsWith('env.')));
    equal('saved places are listed as the App lists them', await page.locator('#records [data-record-id]').evaluateAll(n => n.map(x => x.dataset.recordId)), (await mcp('places.list', {})).places.map(p => p.id));

    await openPlace(WREN);
    const hourly = await mcp('forecast.hourly', { id: WREN }), table = placePage(WREN).locator('section[aria-label="Next 24 hours"] table');
    equal('the place page shows the latest issuance of the default source', await table.getAttribute('data-issuance-id'), hourly.issuance.id);
    const firstRow = table.locator('tbody tr').first(), cells = await firstRow.locator('td').allInnerTexts();
    // The expected label is formatted by the same browser (its ICU), in the place's zone.
    const label = await page.evaluate(([iso, tz]) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric' }).format(new Date(iso)), [hourly.rows[0].start, DENVER]);
    equal('hourly rows are the issuance\'s rows, in the place\'s own time zone', [await firstRow.getAttribute('data-start'), cells[0], cells[2]], [hourly.rows[0].start, label, temperature(hourly.rows[0].temp) + ' °C']);
    equal('every hourly row is shown', await table.locator('tbody tr').count(), hourly.rows.length);
    const daily = await mcp('forecast.daily', { id: WREN });
    equal('the daily cards are the issuance\'s daily rows', await placePage(WREN).locator('.rs-day').evaluateAll(n => n.map(x => [x.dataset.date, x.querySelector('.rs-hl').textContent])), daily.rows.map(d => [d.date, d.headline]));
    const now = await mcp('conditions.get', { id: WREN });
    check('the latest observation is shown', await placePage(WREN).locator('[data-observation="' + now.observation.id + '"]').count() === 1);
    await shot('place');

    await placePage(WREN).locator('select[aria-label="Forecast source"]').selectOption('src-skyline');
    await page.waitForFunction(id => document.querySelector('section[aria-label="Next 24 hours"] table')?.dataset.issuanceId === id, (await mcp('forecast.hourly', { id: WREN, source_id: 'src-skyline' })).issuance.id);
    checks.push('the source picker shows the other source\'s own issuance, with no fallback');
    const earlier = (await mcp('forecast.issuances', { id: WREN, source_id: 'src-skyline', limit: 3 })).issuances[1];
    await page.locator('select[aria-label="Issuance"]').selectOption(earlier.id);
    await page.locator('[data-earlier="true"]').waitFor();
    equal('an earlier issuance is shown as such', await table.getAttribute('data-issuance-id'), earlier.id);
    await page.getByRole('button', { name: 'Show the latest', exact: true }).click();
    await page.locator('[data-earlier="true"]').waitFor({ state: 'detached' });
    await placePage(WREN).locator('select[aria-label="Forecast source"]').selectOption('src-pfo');
    await page.waitForFunction(id => document.querySelector('section[aria-label="Next 24 hours"] table')?.dataset.issuanceId === id, hourly.issuance.id);

    // ---- watches ----------------------------------------------------------------------------------------
    const watchCount = async () => (await data()).watches.length;
    let before = await watchCount();
    await page.getByRole('button', { name: 'New watch here', exact: true }).click();
    await dialog.locator('[data-field=label]').fill('GUI hike');
    await dialog.locator('[data-field=start]').fill('2026-11-22T09:00');
    await dialog.locator('[data-field=end]').fill('2026-11-22T12:00');
    await dialog.locator('[data-condition-row] [data-field="condition.value"]').first().fill('35');
    await dialog.getByRole('button', { name: 'Add condition', exact: true }).click();
    await submit();
    let created = (await data()).watches.at(-1);
    equal('a watch made in the browser is the App\'s record, with the typed local times', [await watchCount(), created.label, created.place_id, created.start, created.end, created.conditions],
      [before + 1, 'GUI hike', WREN, at('2026-11-22', '09:00'), at('2026-11-22', '12:00'), [{ variable: 'pop', op: 'gte', value: 35, unit: '%' }, { variable: 'thunder_prob', op: 'gte', value: 20, unit: '%' }]]);
    await page.locator('.detail article[data-watch-id="' + created.id + '"][data-loaded="true"]').waitFor();
    check('the new watch opens with its evaluation', (await page.locator('.detail').innerText()).includes('Latest evaluation'));
    await page.reload(); await page.locator('#records [data-watch-id="' + created.id + '"]').waitFor(); await ready();
    checks.push('a reload keeps the committed watch');

    await page.locator('#records [data-watch-id="' + created.id + '"]').click();
    await page.locator('.detail article[data-watch-id="' + created.id + '"][data-loaded="true"]').waitFor();
    await page.getByRole('button', { name: 'Edit watch', exact: true }).click();
    await dialog.locator('[data-field=end]').fill('2026-11-22T13:00');
    await submit();
    equal('an edit sends only the edited field', Object.keys(lastCall('rainshadow.watches.update').arguments.patch), ['end']);
    created = (await data()).watches.find(w => w.id === created.id);
    equal('the edit changes the same record', [created.end, created.label], [at('2026-11-22', '13:00'), 'GUI hike']);

    await page.locator('.detail article[data-watch-id="' + created.id + '"][data-loaded="true"]').waitFor();
    await page.getByRole('button', { name: 'Edit watch', exact: true }).click();
    await mcp('watches.update', { id: created.id, patch: { label: 'Changed elsewhere' }, expected_version: (await snap()).version, request_id: 'outside-edit' });
    await dialog.locator('[data-field=label]').fill('Stale label');
    await dialog.locator('button[type=submit]').click();
    await refused('stale_version');
    equal('a stale form shows the conflict and the concurrent change stands', (await data()).watches.find(w => w.id === created.id).label, 'Changed elsewhere');

    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === 'rainshadow.watches.create' && body.arguments.label === 'Lost response') { dropped = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'New watch', exact: true }).click();
    await dialog.locator('[data-field=label]').fill('Lost response');
    await dialog.locator('[data-field=start]').fill('2026-11-23T09:00'); await dialog.locator('[data-field=end]').fill('2026-11-23T11:00');
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('[role=alert][data-code=request_failed]').waitFor();
    await submit();
    await page.unroute('**/api/call');
    equal('a retry after a lost response has one effect', (await data()).watches.filter(w => w.label === 'Lost response').length, 1);

    before = await snap();
    await page.getByRole('button', { name: 'New watch', exact: true }).click();
    await dialog.locator('[data-field=start]').fill('2026-11-23T12:00'); await dialog.locator('[data-field=end]').fill('2026-11-23T10:00');
    await dialog.locator('button[type=submit]').click();
    const why = await refused('invalid_window');
    check('an invalid window is refused visibly and writes nothing', why.length > 0 && (await snap()).version.revision === before.version.revision);

    await page.locator('#records [data-watch-id="' + created.id + '"]').click();
    await page.locator('.detail article[data-watch-id="' + created.id + '"][data-loaded="true"]').waitFor();
    await page.getByRole('button', { name: 'Cancel watch', exact: true }).click();
    await submit();
    created = (await data()).watches.find(w => w.id === created.id);
    check('cancelling a watch commits it as cancelled', typeof created.cancelled_at === 'string');
    await page.locator('#records [data-watch-id="' + created.id + '"] .rs-chip').filter({ hasText: 'Cancelled' }).waitFor();
    await shot('watches');

    // ---- alerts ---------------------------------------------------------------------------------------------
    await nav('Alerts');
    await page.locator('#records [data-alert-id="al-0004"]').click();
    await page.locator('.detail article[data-alert-id="al-0004"][data-loaded="true"]').waitFor();
    const thread = (await mcp('alerts.get', { id: 'al-0004' })).alert;
    equal('the alert thread is shown message by message', await page.locator('.detail [data-message-id]').evaluateAll(n => n.map(x => x.dataset.messageId)), thread.messages.map(m => m.message_id).reverse());
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Alert acknowledged.' }).waitFor();
    const ack = (await data()).acknowledgements.at(-1);
    equal('acknowledging records the latest message', [ack.alert_id, ack.message_id], ['al-0004', thread.latest_message_id]);
    await page.locator('.detail article[data-alert-id="al-0004"][data-loaded="true"]').waitFor();
    check('the acknowledged alert no longer offers the control', await page.getByRole('button', { name: 'Acknowledge', exact: true }).count() === 0);
    await shot('alerts');

    // ---- places -------------------------------------------------------------------------------------------------
    await openPlace(MARROW);
    await page.getByRole('button', { name: 'Pause alerts', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Alerts paused for this place.' }).waitFor();
    equal('pausing alerts sends only the paused flag', lastCall('rainshadow.places.update').arguments.patch, { alert_rule: { paused: true } });
    check('the place is paused in the App', (await data()).saved_places.find(p => p.place_id === MARROW).alert_rule.paused === true);
    await placePage(MARROW).getByRole('button', { name: 'Resume alerts', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Alerts resumed for this place.' }).waitFor();
    await placePage(MARROW).getByRole('button', { name: 'Edit place', exact: true }).click();
    await dialog.locator('[data-field=label]').fill('Mom and Dad');
    await submit();
    equal('editing a place sends only the label', lastCall('rainshadow.places.update').arguments.patch, { label: 'Mom and Dad' });
    equal('the place keeps its rule and gets the new label', [(await data()).saved_places.find(p => p.place_id === MARROW).label, (await data()).saved_places.find(p => p.place_id === MARROW).alert_rule.paused], ['Mom and Dad', false]);

    await nav('Places');
    await page.getByRole('button', { name: 'Add place', exact: true }).click();
    await dialog.locator('[data-field=query]').fill('Quill');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    await dialog.locator('[data-result-id="pl-quillmere"] input').check();
    await dialog.locator('[data-field=label]').fill('Workshop');
    await submit();
    let saved = (await data()).saved_places.find(p => p.place_id === 'pl-quillmere');
    check('a place found by search is saved with its label', saved && saved.label === 'Workshop');
    await placePage('pl-quillmere').waitFor();
    equal('the new place is listed last, as saved', await page.locator('#records [data-record-id]').evaluateAll(n => n.map(x => x.dataset.recordId).at(-1)), 'pl-quillmere');

    await openPlace(WREN);
    await placePage(WREN).getByRole('button', { name: 'Remove place', exact: true }).click();
    await dialog.locator('button[type=submit]').click();
    await refused('place_in_use');
    check('a place with an open watch is not removed, and the refusal is visible', (await data()).saved_places.some(p => p.place_id === WREN));
    await openPlace('pl-quillmere');
    await placePage('pl-quillmere').getByRole('button', { name: 'Remove place', exact: true }).click();
    await submit();
    check('removing a place takes it out of the saved places', !(await data()).saved_places.some(p => p.place_id === 'pl-quillmere'));

    // ---- notices and settings ----------------------------------------------------------------------------------
    await nav('Notices');
    await page.locator('#records [data-notice-id]').first().waitFor();
    equal('notices are listed newest first, as the App lists them', await page.locator('#records [data-notice-id]').first().getAttribute('data-notice-id'), (await mcp('notices.list', { limit: 1 })).notices[0].id);
    await page.locator('select[aria-label="Notice kind"]').selectOption('watch.triggered');
    await page.waitForFunction(() => [...document.querySelectorAll('#records [data-notice-id]')].every(n => n.textContent.includes('Watch triggered')));
    equal('the kind filter is the App\'s filter', await page.locator('#records [data-notice-id]').evaluateAll(n => n.map(x => x.dataset.noticeId)), (await mcp('notices.list', { kind: 'watch.triggered', limit: 50 })).notices.map(n => n.id));
    await page.locator('select[aria-label="Notice kind"]').selectOption('');
    await page.waitForFunction(id => document.querySelector('#records [data-notice-id]')?.dataset.noticeId === id, (await mcp('notices.list', { limit: 1 })).notices[0].id);
    await shot('notices');

    await nav('Settings');
    await page.locator('.detail article[data-settings][data-loaded="true"]').waitFor();
    await page.locator('select[data-field=units]').selectOption('us');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Settings saved.' }).waitFor();
    equal('settings send only what changed', lastCall('rainshadow.preferences.update').arguments.patch, { units: 'us' });
    check('the App now uses US units', (await data()).preferences.units === 'us');
    await shot('settings');
    await openPlace(WREN);
    check('the pages show the units the App returns', (await placePage(WREN).locator('section[aria-label="Next 24 hours"] .rs-card-head').innerText()).includes('°F, mph, in'));

    // ---- independent changes: events and the clock, through Infra only -------------------------------------------
    const apply = async event => { const r = await infra.call('env.apply_event', { expected_version: (await snap()).version, event }); assert.equal(r.status, 'committed', JSON.stringify(r)); };
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    await apply(scenario);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready();
    await page.waitForFunction(id => document.querySelector('section[aria-label="Next 24 hours"] table')?.dataset.issuanceId === id, scenario.payload.issuance_id);
    checks.push('after Refresh the page shows an issuance that arrived as a scenario event');
    const hostile = '<img src=x onerror="window.injected=true">';
    await apply({ event_id: 'web-hostile', at: at('2026-11-20', '20:40'), operation: 'rainshadow.alert.issued', payload: { alert_id: 'al-web-1', source_id: 'src-pfo', category: 'flood', zone_ids: ['z-wren'],
      message: { message_id: 'al-web-1-m1', type: 'alert', sent_at: at('2026-11-20', '20:40'), event: 'Flood Watch', severity: 'moderate', urgency: 'future', certainty: 'possible',
        onset: at('2026-11-21', '12:00'), ends: at('2026-11-21', '21:00'), headline: 'Flood Watch ' + hostile, description: 'Creeks may rise. ' + hostile, instruction: 'Stay off low crossings.' } } });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready();
    await nav('Alerts');
    await page.locator('#records [data-alert-id="al-web-1"]').click();
    await page.locator('.detail article[data-alert-id="al-web-1"][data-loaded="true"]').waitFor();
    check('untrusted text is shown as text and never executed', (await page.locator('.detail').innerText()).includes(hostile) && !(await page.evaluate(() => window.injected)) && await page.locator('.detail img').count() === 0);
    await apply({ ...scenario, event_id: 'web-late', operation: 'rainshadow.forecast.issued', at: at('2026-11-20', '20:50'), payload: { ...scenario.payload, issuance_id: 'iss-pfo-wren-web-late', issued_at: at('2026-11-20', '19:30') } });
    await openPlace(WREN);
    equal('a late arrival with an older issue time does not replace the latest on the page', await placePage(WREN).locator('section[aria-label="Next 24 hours"] table').getAttribute('data-issuance-id'), scenario.payload.issuance_id);
    const advanced = await infra.call('env.advance_time', { request_id: 'web-clock', expected_version: (await snap()).version, virtual_now: at('2026-11-21', '19:00') });
    assert.ok(['committed', 'ok'].includes(advanced.status), JSON.stringify(advanced));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready();
    await nav('Watches');
    const hike = (await data()).watches.find(w => w.label === 'Saturday hike');
    await page.locator('#records [data-watch-id="' + hike.id + '"] .rs-chip').filter({ hasText: 'Ended' }).waitFor();
    checks.push('after a clock move by Infra alone, a watch whose window is over reads ended');

    const denied = await page.evaluate(async () => { const { csrf } = await (await fetch('/session')).json(); return (await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name: 'env.snapshot', arguments: {} }) })).status; });
    equal('a management request from the business session is denied', denied, 403);
    for (const section of ['Places', 'Alerts', 'Watches', 'Notices', 'Settings']) {
      await page.setViewportSize({ width: 390, height: 844 }); await nav(section); await page.locator('.detail [data-loaded="true"]').first().waitFor();
      check('no horizontal page overflow on a narrow screen: ' + section, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await shot('narrow');
    await page.setViewportSize({ width: 1360, height: 960 });
    equal('no JavaScript errors in the browser', errors, []);
    await context.close();

    // ---- a Task-like policy: only what the scenario profile allows -------------------------------------------------
    restricted = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'restricted', profile: 'scenario' });
    restrictedInfra = new Client(prepared.app, 'infra', restricted.run, stateDir, 'rainshadow-web-inspector', { registry: prepared.registry });
    await restrictedInfra.initialize();
    const rdata = async () => (await restrictedInfra.call('env.snapshot')).snapshot.data;
    const rcontext = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), rpage = await rcontext.newPage();
    rpage.setDefaultTimeout(10000); pages.push(rpage);
    const rerrors = [];
    rpage.on('pageerror', e => rerrors.push(e.message));
    await rpage.goto(restricted.accessUrl); await rpage.locator('#records .record').first().waitFor(); await rpage.locator('#app[aria-busy=false]').waitFor();
    const rplace = id => rpage.locator('.detail article[data-place-id="' + id + '"][data-loaded="true"]');
    const ropen = async id => { await rpage.locator('#records [data-record-id="' + id + '"]').click(); await rplace(id).waitFor(); };
    await ropen(MARROW);
    check('controls the policy does not offer are absent', await rpage.getByRole('button', { name: 'Add place', exact: true }).count() === 0 && await rpage.getByRole('button', { name: 'Remove place', exact: true }).count() === 0);
    await rplace(MARROW).getByRole('button', { name: 'Pause alerts', exact: true }).click();
    await rpage.locator('#status[data-error="true"]').waitFor();
    check('a write the policy refuses is shown as refused and changes nothing', (await rpage.locator('#status').innerText()).includes('not allowed') && (await rdata()).saved_places.find(p => p.place_id === MARROW).alert_rule.paused === false);
    await ropen(WREN);
    await rplace(WREN).getByRole('button', { name: 'Pause alerts', exact: true }).click();
    await rpage.locator('#status').filter({ hasText: 'Alerts paused for this place.' }).waitFor();
    check('the alert rule of the allowed place can be changed', (await rdata()).saved_places.find(p => p.place_id === WREN).alert_rule.paused === true);
    await rplace(WREN).getByRole('button', { name: 'Edit place', exact: true }).click();
    await rpage.locator('dialog.rs-dialog [data-field=label]').fill('Not allowed');
    await rpage.locator('dialog.rs-dialog button[type=submit]').click();
    await rpage.locator('dialog.rs-dialog [role=alert][data-code=permission_denied]').waitFor();
    await rpage.locator('dialog.rs-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await rpage.locator('dialog.rs-dialog').waitFor({ state: 'detached' });
    check('a label change outside the allowed fields is refused', (await rdata()).saved_places.find(p => p.place_id === WREN).label === 'Saturday hike');
    await rpage.locator('nav').getByRole('button', { name: /Settings/ }).click(); await rpage.locator('.detail article[data-settings][data-loaded="true"]').waitFor();
    check('settings are read-only when the policy offers no settings write', await rpage.getByRole('button', { name: 'Save settings', exact: true }).count() === 0 && await rpage.locator('select[data-field=units]').isDisabled());
    equal('no JavaScript errors under the restricted policy', rerrors, []);
    await rcontext.close();

    const report = { schema: 'rainshadow.web-check.v1', passed: true, recorded_at: new Date().toISOString(), node: process.version, browser: browser.version(), runtime: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      package_sha256: digestTree(appDir), duration_ms: Date.now() - started, checks: checks.length, names: checks, screenshots };
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + '\n'); }
    console.log('PASS: ' + checks.length + ' browser checks (' + browser.version() + ').');
  } catch (e) {
    console.error('FAIL after ' + checks.length + ' checks: ' + (e.stack || e));
    if (shots) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(shots, 'failed-' + i + '.png'), fullPage: true }).catch(() => {});
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify({ schema: 'rainshadow.web-check.v1', passed: false, checks: checks.length, names: checks, error: String(e.message || e) }, null, 2) + '\n'); }
    process.exitCode = 1;
  } finally {
    await infra?.close().catch(() => {}); await restrictedInfra?.close().catch(() => {});
    await host?.close().catch(() => {}); await restricted?.close().catch(() => {}); await browser?.close().catch(() => {});
    prepared.cleanup();
  }
}
main();
