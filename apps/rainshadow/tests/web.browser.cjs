#!/usr/bin/env node
'use strict';
// Browser checks of the Rainshadow web pages on the public business Web Host: real controls in
// a real browser, with the same run inspected through MCP after every write.
//
//   node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--evidence DIR] [--chrome PATH]
//
// --evidence DIR writes the ordered review evidence of evidence/README.md: a JPEG of the window
// at each step of each workflow and sequences.json with the action, the expected and the
// observed result and the App state read back through MCP at that moment.
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
    if (!['--runtime', '--report', '--screenshots', '--evidence', '--chrome'].includes(key) || !value) return null;
    out[key.slice(2)] = value;
  }
  return out.runtime ? out : null;
}
const opts = options(), root = opts && path.resolve(opts.runtime);
if (!opts || !fs.existsSync(path.join(root, 'web', 'server.cjs'))) {
  console.error('Usage: node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--evidence DIR] [--chrome PATH]');
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
// Core's package digest (verify.cjs digestTree) of the package without one top-level folder:
// the evidence folder holds the screenshots this test takes, so they cannot be part of what they show.
function digestWithout(dir, skip) {
  const hash = require('node:crypto').createHash('sha256');
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (d === dir && e.name === skip) continue; if (e.isDirectory()) walk(f); else { hash.update(path.relative(dir, f).split(path.sep).join('/')); hash.update('\0'); hash.update(fs.readFileSync(f)); } } };
  walk(dir);
  return hash.digest('hex');
}
const SEQUENCES = {
  forecast: 'Forecasts: the latest issuance, another source, an earlier issuance, a new and a late arrival', watch: 'Watches: saved, edited, stale, retried, refused, cancelled, ended',
  alert: 'An alert: acknowledging is refused while an update is unread, then recorded; the alert is cancelled', place: 'Saved places: alerts paused, renamed, added by search, removal refused and done',
  settings: 'Settings: units', 'restricted-policy': 'A Task-like policy', 'full-window': 'The full-window dataset in the web pages',
};

async function main() {
  const prepared = prepare(appDir), stateDir = path.join(prepared.root, 'state'), started = Date.now();
  const shots = opts.screenshots ? path.resolve(opts.screenshots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const checks = [], screenshots = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  let browser, host, restricted, infra, restrictedInfra, full, fullInfra;
  const sequences = [], evidence = opts.evidence ? path.resolve(opts.evidence) : null;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
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
    // Ordered evidence (--evidence DIR): a JPEG of the window at each step, with the action, the
    // expected and the observed result and the App state read back through MCP at that moment.
    const step = async (target, sequence, caption, note) => {
      if (!evidence) return;
      const n = sequences.filter(x => x.sequence === sequence).length + 1, file = sequence + '-' + String(n).padStart(2, '0') + '.jpg';
      await target.screenshot({ path: path.join(evidence, file), type: 'jpeg', quality: 70 });
      sequences.push({ sequence, title: SEQUENCES[sequence], step: n, caption, file, ...note });
    };
    const said = async locator => (await locator.innerText()).replace(/\s+/g, ' ').trim().slice(0, 300);
    // The top of a page: its heading, its state chips and any banner, as the reader sees them.
    const head = async article => (await article.evaluate(a => [...a.querySelectorAll(':scope > header, :scope > .rs-chips, :scope > .rs-banner')].map(n => n.innerText).join(' · '))).replace(/\s+/g, ' ').trim().slice(0, 400);
    const version = async () => { const v = (await snap()).version; return 'epoch ' + v.epoch + ', revision ' + v.revision; };
    const alertOf = async code => { const a = dialog.locator('[role=alert][data-code="' + code + '"]'); await a.waitFor(); return said(a); };
    const receipt = name => 'request ' + lastCall(name).arguments.request_id;
    const cancel = async () => { await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); };
    const issuedLine = id => placePage(id).locator('[data-issuance]');
    const watchPage = id => page.locator('.detail article[data-watch-id="' + id + '"][data-loaded="true"]');
    const alertPage = id => page.locator('.detail article[data-alert-id="' + id + '"][data-loaded="true"]');
    const dd = (article, label) => article.evaluate((a, l) => { const t = [...a.querySelectorAll('dl dt')].find(x => x.innerText.trim() === l); return t ? l + ': ' + t.nextElementSibling.innerText.trim() : ''; }, label);

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
    await step(page, 'forecast', 'Wren Lake: the latest issuance of the default source, in the place\'s own time zone', { action: 'Places: open Wren Lake (saved as “Saturday hike”).', expected: 'The latest issuance of the default source, ' + hourly.issuance.id + '; hours in ' + DENVER + ' although the browser runs in Asia/Tokyo; the latest observation.', observed: await said(issuedLine(WREN)) + ' · first hour: ' + cells.join(' | '), state: { 'forecast.hourly': hourly.issuance.id + ', issued ' + hourly.issuance.issued_at + ', ' + hourly.rows.length + ' rows', 'conditions.get': now.observation.id }, check: 'the place page shows the latest issuance of the default source' });

    await placePage(WREN).locator('select[aria-label="Forecast source"]').selectOption('src-skyline');
    const skyline = (await mcp('forecast.hourly', { id: WREN, source_id: 'src-skyline' })).issuance;
    await page.waitForFunction(id => document.querySelector('section[aria-label="Next 24 hours"] table')?.dataset.issuanceId === id, skyline.id);
    checks.push('the source picker shows the other source\'s own issuance, with no fallback');
    await step(page, 'forecast', 'Another source: its own latest issuance, never a mix', { action: 'Forecast from: Skyline.', expected: 'Skyline\'s own latest issuance, ' + skyline.id + '; nothing from the other source fills a gap.', observed: await said(issuedLine(WREN)), state: { 'forecast.hourly': 'source src-skyline: ' + skyline.id + ', issued ' + skyline.issued_at }, check: 'the source picker shows the other source\'s own issuance, with no fallback' });
    const earlier = (await mcp('forecast.issuances', { id: WREN, source_id: 'src-skyline', limit: 3 })).issuances[1];
    await page.locator('select[aria-label="Issuance"]').selectOption(earlier.id);
    await page.locator('[data-earlier="true"]').waitFor();
    equal('an earlier issuance is shown as such', await table.getAttribute('data-issuance-id'), earlier.id);
    await step(page, 'forecast', 'An earlier issuance is labelled as such', { action: 'Issuance: choose the one before the latest.', expected: 'The page shows ' + earlier.id + ' and says that newer forecasts from this source exist.', observed: await said(issuedLine(WREN)) + ' · ' + await said(placePage(WREN).locator('[data-earlier="true"]')), state: { 'forecast.issuances': earlier.id + ' issued ' + earlier.issued_at + ', is_latest ' + earlier.is_latest }, check: 'an earlier issuance is shown as such' });
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
    await step(page, 'watch', 'A new watch, filled in before sending', { action: 'Wren Lake: New watch here; label “GUI hike”, Sunday 22 November 09:00–12:00 (the place\'s time), chance of rain at least 35 %, Add condition (chance of thunder).', expected: 'The form holds the window in the place\'s own time and two conditions; nothing is written yet.', observed: await dialog.locator('[data-field=start]').inputValue() + ' → ' + await dialog.locator('[data-field=end]').inputValue() + ' · ' + (await dialog.locator('[data-condition-row]').count()) + ' conditions', state: { 'watches.list': before + ' watches' } });
    await submit();
    let created = (await data()).watches.at(-1);
    equal('a watch made in the browser is the App\'s record, with the typed local times', [await watchCount(), created.label, created.place_id, created.start, created.end, created.conditions],
      [before + 1, 'GUI hike', WREN, at('2026-11-22', '09:00'), at('2026-11-22', '12:00'), [{ variable: 'pop', op: 'gte', value: 35, unit: '%' }, { variable: 'thunder_prob', op: 'gte', value: 20, unit: '%' }]]);
    await watchPage(created.id).waitFor();
    check('the new watch opens with its evaluation', (await page.locator('.detail').innerText()).includes('Latest evaluation'));
    await step(page, 'watch', 'Sent: the watch opens with its first evaluation', { action: 'Send.', expected: 'rainshadow.watches.create writes the watch with the typed local times; the page shows its latest evaluation.', observed: await head(watchPage(created.id)), state: { 'watches.list': created.id + ' “' + created.label + '” ' + created.start + ' → ' + created.end + ', status ' + (await mcp('watches.list', {})).watches.find(w => w.id === created.id).status, receipt: receipt('rainshadow.watches.create'), version: await version() }, check: 'the new watch opens with its evaluation' });
    await page.reload(); await page.locator('#records [data-watch-id="' + created.id + '"]').waitFor(); await ready();
    checks.push('a reload keeps the committed watch');

    await page.locator('#records [data-watch-id="' + created.id + '"]').click();
    await watchPage(created.id).waitFor();
    await step(page, 'watch', 'After a reload: read back from the App', { action: 'Reload the page; open the watch.', expected: 'The same watch, read back from the App.', observed: await head(watchPage(created.id)), state: { 'watches.list': created.id + ' present' }, check: 'a reload keeps the committed watch' });
    await page.getByRole('button', { name: 'Edit watch', exact: true }).click();
    await dialog.locator('[data-field=end]').fill('2026-11-22T13:00');
    await submit();
    equal('an edit sends only the edited field', Object.keys(lastCall('rainshadow.watches.update').arguments.patch), ['end']);
    created = (await data()).watches.find(w => w.id === created.id);
    equal('the edit changes the same record', [created.end, created.label], [at('2026-11-22', '13:00'), 'GUI hike']);
    await watchPage(created.id).waitFor();
    await step(page, 'watch', 'Edited: only the end time', { action: 'Edit watch, end 13:00, Save.', expected: 'rainshadow.watches.update sends only the end; the same record now ends at 13:00.', observed: await head(watchPage(created.id)), state: { 'watches.list': created.id + ' ends ' + created.end, receipt: receipt('rainshadow.watches.update'), version: await version() }, check: 'an edit sends only the edited field' });

    await page.getByRole('button', { name: 'Edit watch', exact: true }).click();
    await mcp('watches.update', { id: created.id, patch: { label: 'Changed elsewhere' }, expected_version: (await snap()).version, request_id: 'outside-edit' });
    await dialog.locator('[data-field=label]').fill('Stale label');
    await dialog.locator('button[type=submit]').click();
    const staleText = await alertOf('stale_version');
    equal('a stale form shows the conflict and the concurrent change stands', (await data()).watches.find(w => w.id === created.id).label, 'Changed elsewhere');
    await step(page, 'watch', 'A form that went stale: the conflict is shown and the other change stands', { action: 'Edit watch; meanwhile another session renames it through MCP (request outside-edit); type “Stale label” and Save.', expected: 'The App answers stale_version and the form says so; the label stays “Changed elsewhere”.', observed: staleText, state: { 'watches.list': created.id + ' “' + (await data()).watches.find(w => w.id === created.id).label + '”', receipt: 'request outside-edit (the other session)', version: await version() }, check: 'a stale form shows the conflict and the concurrent change stands' });
    await cancel();

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
    const lost = await alertOf('request_failed');
    await step(page, 'watch', 'The response is lost: the form says so and keeps its input', { action: 'New watch “Lost response”, Monday 09:00–11:00, send. The test drops the response after the App has committed it.', expected: 'The form reports the failure and offers to send again with the same request ID.', observed: lost, state: { 'watches.list': '“Lost response”: ' + (await data()).watches.filter(w => w.label === 'Lost response').length } });
    await submit();
    await page.unroute('**/api/call');
    equal('a retry after a lost response has one effect', (await data()).watches.filter(w => w.label === 'Lost response').length, 1);
    await step(page, 'watch', 'Sent again: still one watch', { action: 'Send again.', expected: 'The retry is the same write with the same request ID: one watch.', observed: await said(page.locator('#status')), state: { 'watches.list': '“Lost response”: ' + (await data()).watches.filter(w => w.label === 'Lost response').length, receipt: receipt('rainshadow.watches.create'), version: await version() }, check: 'a retry after a lost response has one effect' });

    before = await snap();
    await page.getByRole('button', { name: 'New watch', exact: true }).click();
    await dialog.locator('[data-field=start]').fill('2026-11-23T12:00'); await dialog.locator('[data-field=end]').fill('2026-11-23T10:00');
    await dialog.locator('button[type=submit]').click();
    const why = await alertOf('invalid_window');
    check('an invalid window is refused visibly and writes nothing', why.length > 0 && (await snap()).version.revision === before.version.revision);
    await step(page, 'watch', 'A window that ends before it starts is refused', { action: 'New watch, Monday 12:00 → 10:00, send.', expected: 'The App answers invalid_window and the form says why; nothing is written.', observed: why, state: { version: await version() }, check: 'an invalid window is refused visibly and writes nothing' });
    await cancel();

    await page.locator('#records [data-watch-id="' + created.id + '"]').click();
    await watchPage(created.id).waitFor();
    await page.getByRole('button', { name: 'Cancel watch', exact: true }).click();
    await dialog.waitFor();
    await step(page, 'watch', 'Cancel asks first', { action: 'Open the watch, Cancel watch.', expected: 'A confirmation names the watch.', observed: await said(dialog), state: { 'watches.list': created.id + ' open' } });
    await submit();
    created = (await data()).watches.find(w => w.id === created.id);
    check('cancelling a watch commits it as cancelled', typeof created.cancelled_at === 'string');
    await page.locator('#records [data-watch-id="' + created.id + '"] .rs-chip').filter({ hasText: 'Cancelled' }).waitFor();
    await shot('watches');
    await step(page, 'watch', 'Cancelled: kept, and marked as cancelled', { action: 'Confirm with Cancel watch.', expected: 'rainshadow.watches.cancel commits the cancellation; the watch stays listed as Cancelled.', observed: await said(page.locator('#records [data-watch-id="' + created.id + '"]')), state: { 'watches.list': created.id + ' cancelled at ' + created.cancelled_at, receipt: receipt('rainshadow.watches.cancel'), version: await version() }, check: 'cancelling a watch commits it as cancelled' });

    // ---- alerts ---------------------------------------------------------------------------------------------
    await nav('Alerts');
    await page.locator('#records [data-alert-id="al-0004"]').click();
    await alertPage('al-0004').waitFor();
    const thread = (await mcp('alerts.get', { id: 'al-0004' })).alert;
    equal('the alert thread is shown message by message', await page.locator('.detail [data-message-id]').evaluateAll(n => n.map(x => x.dataset.messageId)), thread.messages.map(m => m.message_id).reverse());
    await step(page, 'alert', 'Start: the coastal flood advisory for Marrowby, not acknowledged', { action: 'Alerts: open al-0004.', expected: 'One message, in effect, with an Acknowledge control.', observed: await head(alertPage('al-0004')) + ' · ' + await dd(alertPage('al-0004'), 'Acknowledged'), state: { 'alerts.get': 'al-0004 ' + thread.status + ', ' + thread.message_count + ' message, latest ' + thread.latest_message_id + ', acknowledged ' + thread.acknowledged }, check: 'the alert thread is shown message by message' });
    // The forecaster extends the advisory while the page is open: acknowledging the message on the page is refused.
    const apply = async event => { const r = await infra.call('env.apply_event', { expected_version: (await snap()).version, event }); assert.equal(r.status, 'committed', JSON.stringify(r)); };
    const m1 = thread.messages[0];
    await apply({ event_id: 'web-alert-update', at: at('2026-11-20', '20:05'), operation: 'rainshadow.alert.updated', payload: { alert_id: 'al-0004', message: { message_id: 'al-0004-m2', type: 'update', sent_at: at('2026-11-20', '20:05'),
      event: m1.event, severity: m1.severity, urgency: m1.urgency, certainty: m1.certainty, onset: m1.onset, ends: '2026-11-21T08:00:00-08:00',
      headline: 'Coastal Flood Advisory extended until 8 AM Saturday', description: 'The morning high tide may bring water onto Harbor Road again. The advisory now runs until 8 AM.', instruction: m1.instruction || 'Avoid Harbor Road at high tide.' } } });
    const acksBefore = (await data()).acknowledgements.length;
    await alertPage('al-0004').getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await page.locator('#status[data-error="true"]').waitFor();
    check('acknowledging while a newer message is unread is refused and writes nothing', (await said(page.locator('#status'))).includes('newer message') && (await data()).acknowledgements.length === acksBefore);
    await step(page, 'alert', 'An update arrives while the page is open: acknowledging is refused', { action: 'Infra applies rainshadow.alert.updated (event web-alert-update, message al-0004-m2); without refreshing, Acknowledge.', expected: 'The page reads the thread again, finds a newer message and refuses; no acknowledgement is written.', observed: await said(page.locator('#status')), state: { 'alerts.get': 'al-0004 latest ' + (await mcp('alerts.get', { id: 'al-0004' })).alert.latest_message_id, 'env.event_status': 'web-alert-update ' + (await infra.call('env.event_status', { event_id: 'web-alert-update' })).receipt.status, acknowledgements: acksBefore + ' (unchanged)' }, check: 'acknowledging while a newer message is unread is refused and writes nothing' });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready();
    await alertPage('al-0004').locator('[data-message-id="al-0004-m2"]').waitFor();
    check('after Refresh the thread shows the update first', (await page.locator('.detail [data-message-id]').evaluateAll(n => n.map(x => x.dataset.messageId))).join() === 'al-0004-m2,al-0004-m1');
    await step(page, 'alert', 'After Refresh: the update is first in the thread', { action: 'Refresh.', expected: 'Two messages, newest first; the advisory now ends at 8 AM; Acknowledge is offered again.', observed: await head(alertPage('al-0004')) + ' · ' + await dd(alertPage('al-0004'), 'In effect'), state: { 'alerts.get': 'al-0004 messages al-0004-m1, al-0004-m2' }, check: 'after Refresh the thread shows the update first' });
    await alertPage('al-0004').getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Alert acknowledged.' }).waitFor();
    const ack = (await data()).acknowledgements.at(-1);
    equal('acknowledging records the latest message', [ack.alert_id, ack.message_id], ['al-0004', 'al-0004-m2']);
    await alertPage('al-0004').waitFor();
    check('the acknowledged alert no longer offers the control', await page.getByRole('button', { name: 'Acknowledge', exact: true }).count() === 0);
    await shot('alerts');
    await step(page, 'alert', 'Acknowledged: the App records the message that was read', { action: 'Acknowledge.', expected: 'rainshadow.alerts.acknowledge records al-0004-m2; the control is replaced by Acknowledged.', observed: await head(alertPage('al-0004')) + ' · ' + await dd(alertPage('al-0004'), 'Acknowledged'), state: { acknowledgements: ack.alert_id + ' ' + ack.message_id + ' at ' + ack.acknowledged_at, receipt: receipt('rainshadow.alerts.acknowledge'), version: await version() }, check: 'acknowledging records the latest message' });
    await apply({ event_id: 'web-alert-cancel', at: at('2026-11-20', '20:25'), operation: 'rainshadow.alert.cancelled', payload: { alert_id: 'al-0004', message: { message_id: 'al-0004-m3', type: 'cancel', sent_at: at('2026-11-20', '20:25'),
      headline: 'Coastal Flood Advisory cancelled', description: 'The evening tide peaked below flood stage. The advisory is cancelled.' } } });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready();
    await alertPage('al-0004').locator('[data-message-id="al-0004-m3"]').waitFor();
    const gone = (await mcp('alerts.get', { id: 'al-0004' })).alert;
    check('after Refresh a cancelled alert says so and keeps its acknowledgement', gone.status === 'cancelled' && (await head(alertPage('al-0004'))).includes('Cancelled') && (await dd(alertPage('al-0004'), 'Acknowledged')).includes('al-0004-m2'));
    await step(page, 'alert', 'The forecaster cancels it: the alert closes and keeps its record', { action: 'Infra applies rainshadow.alert.cancelled (event web-alert-cancel); Refresh.', expected: 'The alert is Cancelled, listed under Ended or cancelled, with three messages and the acknowledgement of al-0004-m2.', observed: await head(alertPage('al-0004')) + ' · ' + await dd(alertPage('al-0004'), 'Acknowledged'), state: { 'alerts.get': 'al-0004 ' + gone.status + ', ' + gone.message_count + ' messages', 'env.event_status': 'web-alert-cancel ' + (await infra.call('env.event_status', { event_id: 'web-alert-cancel' })).receipt.status, version: await version() }, check: 'after Refresh a cancelled alert says so and keeps its acknowledgement' });

    // ---- places -------------------------------------------------------------------------------------------------
    await openPlace(MARROW);
    await page.getByRole('button', { name: 'Pause alerts', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Alerts paused for this place.' }).waitFor();
    equal('pausing alerts sends only the paused flag', lastCall('rainshadow.places.update').arguments.patch, { alert_rule: { paused: true } });
    check('the place is paused in the App', (await data()).saved_places.find(p => p.place_id === MARROW).alert_rule.paused === true);
    await placePage(MARROW).waitFor();
    await step(page, 'place', 'Alerts paused for Marrowby', { action: 'Places: open Marrowby, Pause alerts.', expected: 'rainshadow.places.update sends only the paused flag.', observed: await said(page.locator('#status')) + ' · ' + await head(placePage(MARROW)), state: { 'places.list': MARROW + ' alert rule paused', receipt: receipt('rainshadow.places.update'), version: await version() }, check: 'the place is paused in the App' });
    await placePage(MARROW).getByRole('button', { name: 'Resume alerts', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Alerts resumed for this place.' }).waitFor();
    await placePage(MARROW).getByRole('button', { name: 'Edit place', exact: true }).click();
    await dialog.locator('[data-field=label]').fill('Mom and Dad');
    await submit();
    equal('editing a place sends only the label', lastCall('rainshadow.places.update').arguments.patch, { label: 'Mom and Dad' });
    equal('the place keeps its rule and gets the new label', [(await data()).saved_places.find(p => p.place_id === MARROW).label, (await data()).saved_places.find(p => p.place_id === MARROW).alert_rule.paused], ['Mom and Dad', false]);
    await placePage(MARROW).waitFor();
    await step(page, 'place', 'Resumed, then renamed: the rule stays', { action: 'Resume alerts; Edit place, label “Mom and Dad”, Save.', expected: 'rainshadow.places.update sends only the label; the alert rule is active again.', observed: await head(placePage(MARROW)), state: { 'places.list': MARROW + ' “Mom and Dad”, alert rule paused false', receipt: receipt('rainshadow.places.update'), version: await version() }, check: 'the place keeps its rule and gets the new label' });

    await nav('Places');
    await page.getByRole('button', { name: 'Add place', exact: true }).click();
    await dialog.locator('[data-field=query]').fill('Quill');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    await dialog.locator('[data-result-id="pl-quillmere"] input').check();
    await dialog.locator('[data-field=label]').fill('Workshop');
    await step(page, 'place', 'Add a place: search, choose, label', { action: 'Add place; search “Quill”; choose Quillmere; label “Workshop”.', expected: 'The search lists places from the App\'s regions; nothing is saved yet.', observed: await said(dialog.locator('[data-result-id]').first()) + ' · results: ' + await dialog.locator('[data-result-id]').count(), state: { 'places.list': (await data()).saved_places.length + ' saved places' } });
    await submit();
    let saved = (await data()).saved_places.find(p => p.place_id === 'pl-quillmere');
    check('a place found by search is saved with its label', saved && saved.label === 'Workshop');
    await placePage('pl-quillmere').waitFor();
    equal('the new place is listed last, as saved', await page.locator('#records [data-record-id]').evaluateAll(n => n.map(x => x.dataset.recordId).at(-1)), 'pl-quillmere');
    await step(page, 'place', 'Saved: listed last, with its forecast', { action: 'Save.', expected: 'rainshadow.places.save stores Quillmere as “Workshop”; it is listed last and opens.', observed: await head(placePage('pl-quillmere')), state: { 'places.list': 'pl-quillmere “' + saved.label + '”', receipt: receipt('rainshadow.places.save'), version: await version() }, check: 'a place found by search is saved with its label' });

    await openPlace(WREN);
    await placePage(WREN).getByRole('button', { name: 'Remove place', exact: true }).click();
    await dialog.locator('button[type=submit]').click();
    const inUse = await alertOf('place_in_use');
    check('a place with an open watch is not removed, and the refusal is visible', (await data()).saved_places.some(p => p.place_id === WREN));
    await step(page, 'place', 'A place with an open watch is not removed', { action: 'Open Wren Lake, Remove place, confirm.', expected: 'The App answers place_in_use and the form names the open watch; the place stays.', observed: inUse, state: { 'places.list': WREN + ' still saved', version: await version() }, check: 'a place with an open watch is not removed, and the refusal is visible' });
    await cancel();
    await openPlace('pl-quillmere');
    await placePage('pl-quillmere').getByRole('button', { name: 'Remove place', exact: true }).click();
    await dialog.waitFor();
    await step(page, 'place', 'Removing Quillmere asks first', { action: 'Open Quillmere, Remove place.', expected: 'A confirmation names the place.', observed: await said(dialog), state: { 'places.list': 'pl-quillmere still saved' } });
    await submit();
    check('removing a place takes it out of the saved places', !(await data()).saved_places.some(p => p.place_id === 'pl-quillmere'));
    await step(page, 'place', 'Removed', { action: 'Confirm with Remove place.', expected: 'rainshadow.places.remove deletes the saved place.', observed: await said(page.locator('#status')), state: { 'places.list': (await data()).saved_places.map(p => p.place_id).join(', '), receipt: receipt('rainshadow.places.remove'), version: await version() }, check: 'removing a place takes it out of the saved places' });

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
    await step(page, 'settings', 'Saved: US units', { action: 'Settings: Units, US; Save settings.', expected: 'rainshadow.preferences.update sends only the units.', observed: await said(page.locator('#status')), state: { 'preferences.get': 'units ' + (await data()).preferences.units, receipt: receipt('rainshadow.preferences.update'), version: await version() }, check: 'the App now uses US units' });
    await openPlace(WREN);
    check('the pages show the units the App returns', (await placePage(WREN).locator('section[aria-label="Next 24 hours"] .rs-card-head').innerText()).includes('°F, mph, in'));
    await step(page, 'settings', 'The forecast pages follow: °F, mph, in', { action: 'Places: open Wren Lake.', expected: 'The hours are shown in the units the App now returns.', observed: await said(placePage(WREN).locator('section[aria-label="Next 24 hours"] .rs-card-head')) + ' · first hour: ' + (await placePage(WREN).locator('section[aria-label="Next 24 hours"] tbody tr').first().locator('td').allInnerTexts()).join(' | '), state: { 'forecast.hourly': 'units ' + JSON.stringify((await mcp('forecast.hourly', { id: WREN })).units) }, check: 'the pages show the units the App returns' });

    // ---- independent changes: events and the clock, through Infra only -------------------------------------------
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    await apply(scenario);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready();
    await page.waitForFunction(id => document.querySelector('section[aria-label="Next 24 hours"] table')?.dataset.issuanceId === id, scenario.payload.issuance_id);
    checks.push('after Refresh the page shows an issuance that arrived as a scenario event');
    await step(page, 'forecast', 'A new issuance arrives: after Refresh the page shows it', { action: 'Infra applies rainshadow.forecast.issued (examples/scenario.json, ' + scenario.payload.issuance_id + '); Refresh.', expected: 'Wren Lake shows ' + scenario.payload.issuance_id + ', issued ' + scenario.payload.issued_at + '.', observed: await said(issuedLine(WREN)), state: { 'env.event_status': scenario.event_id + ' ' + (await infra.call('env.event_status', { event_id: scenario.event_id })).receipt.status, 'forecast.issuances': 'latest ' + (await mcp('forecast.issuances', { id: WREN, limit: 1 })).issuances[0].id }, check: 'after Refresh the page shows an issuance that arrived as a scenario event' });
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
    const both = (await mcp('forecast.issuances', { id: WREN, limit: 3 })).issuances;
    await step(page, 'forecast', 'A late arrival with an older issue time does not replace the latest', { action: 'Infra applies rainshadow.forecast.issued (event web-late: iss-pfo-wren-web-late, issued 19:30, received 20:50); open Wren Lake.', expected: 'The page keeps ' + scenario.payload.issuance_id + ' (issued 20:30); the late one is listed as an earlier issuance.', observed: await said(issuedLine(WREN)), state: { 'forecast.issuances': both.map(i => i.id + (i.is_latest ? ' (latest)' : '') + ' issued ' + i.issued_at).join('; ') }, check: 'a late arrival with an older issue time does not replace the latest on the page' });
    const advanced = await infra.call('env.advance_time', { request_id: 'web-clock', expected_version: (await snap()).version, virtual_now: at('2026-11-21', '19:00') });
    assert.ok(['committed', 'ok'].includes(advanced.status), JSON.stringify(advanced));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready();
    await nav('Watches');
    const hike = (await data()).watches.find(w => w.label === 'Saturday hike');
    await page.locator('#records [data-watch-id="' + hike.id + '"] .rs-chip').filter({ hasText: 'Ended' }).waitFor();
    checks.push('after a clock move by Infra alone, a watch whose window is over reads ended');
    await page.locator('#records [data-watch-id="' + hike.id + '"]').click(); await watchPage(hike.id).waitFor();
    await step(page, 'watch', 'The clock moves past the hike: the watch reads Ended', { action: 'Infra moves the clock to Saturday 21 November 19:00 (env.advance_time, request web-clock); Refresh; open “Saturday hike”.', expected: 'The watch whose window is over reads Ended; nothing else wrote to it.', observed: await head(watchPage(hike.id)), state: { 'watches.list': hike.id + ' ' + (await mcp('watches.get', { id: hike.id })).watch.status + ', window ' + hike.start + ' → ' + hike.end }, check: 'after a clock move by Infra alone, a watch whose window is over reads ended' });

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
    await step(rpage, 'restricted-policy', 'Under a Task-like policy a refused write says so', { action: 'A second run with the scenario profile: open Marrowby, Pause alerts.', expected: 'The policy allows changes to Wren Lake only: the page says the action is not allowed; nothing is written. Add place and Remove place are not offered.', observed: await said(rpage.locator('#status')), state: { 'places.list': MARROW + ' alert rule paused ' + (await rdata()).saved_places.find(p => p.place_id === MARROW).alert_rule.paused }, check: 'a write the policy refuses is shown as refused and changes nothing' });
    await ropen(WREN);
    await rplace(WREN).getByRole('button', { name: 'Pause alerts', exact: true }).click();
    await rpage.locator('#status').filter({ hasText: 'Alerts paused for this place.' }).waitFor();
    check('the alert rule of the allowed place can be changed', (await rdata()).saved_places.find(p => p.place_id === WREN).alert_rule.paused === true);
    await rplace(WREN).getByRole('button', { name: 'Edit place', exact: true }).click();
    await rpage.locator('dialog.rs-dialog [data-field=label]').fill('Not allowed');
    await rpage.locator('dialog.rs-dialog button[type=submit]').click();
    await rpage.locator('dialog.rs-dialog [role=alert][data-code=permission_denied]').waitFor();
    await step(rpage, 'restricted-policy', 'A change outside the allowed fields is refused', { action: 'Open Wren Lake (pausing its alerts is allowed and was done), Edit place, a new label, send.', expected: 'The App answers permission_denied and the form says so; the label stays.', observed: await said(rpage.locator('dialog.rs-dialog [role=alert]')), state: { 'places.list': WREN + ' “' + (await rdata()).saved_places.find(p => p.place_id === WREN).label + '”, alert rule paused ' + (await rdata()).saved_places.find(p => p.place_id === WREN).alert_rule.paused }, check: 'a label change outside the allowed fields is refused' });
    await rpage.locator('dialog.rs-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await rpage.locator('dialog.rs-dialog').waitFor({ state: 'detached' });
    check('a label change outside the allowed fields is refused', (await rdata()).saved_places.find(p => p.place_id === WREN).label === 'Saturday hike');
    await rpage.locator('nav').getByRole('button', { name: /Settings/ }).click(); await rpage.locator('.detail article[data-settings][data-loaded="true"]').waitFor();
    check('settings are read-only when the policy offers no settings write', await rpage.getByRole('button', { name: 'Save settings', exact: true }).count() === 0 && await rpage.locator('select[data-field=units]').isDisabled());
    equal('no JavaScript errors under the restricted policy', rerrors, []);
    await rcontext.close();

    // ---- the full-window evaluation dataset in the same pages --------------------------------------------------------
    full = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'full-window', profile: 'sandbox' });
    fullInfra = new Client(prepared.app, 'infra', full.run, stateDir, 'rainshadow-web-dataset', { registry: prepared.registry });
    await fullInfra.initialize();
    const fwDir = path.join(appDir, 'datasets/full-window'), fwClock = JSON.parse(fs.readFileSync(path.join(fwDir, 'clock.json'), 'utf8')).initial_time;
    const fwLoad = await fullInfra.call('env.load_seed', { expected_version: (await fullInfra.call('env.snapshot')).version, data: JSON.parse(fs.readFileSync(path.join(fwDir, 'seed.json'), 'utf8')), virtual_now: fwClock, request_id: 'web-full-window' });
    assert.equal(fwLoad.status, 'ready', JSON.stringify(fwLoad).slice(0, 300));
    const fcontext = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), fpage = await fcontext.newPage();
    fpage.setDefaultTimeout(30000); pages.push(fpage);
    const ferrors = [];
    fpage.on('pageerror', e => ferrors.push(e.message));
    const fready = () => fpage.locator('#app[aria-busy=false]').waitFor();
    const fnav = async name => { await fpage.locator('nav').getByRole('button', { name: new RegExp(name) }).click(); await fready(); };
    const fmcp = async (name, a = {}) => { const r = await full.client.call('rainshadow.' + name, a); assert.equal(r.status, 'ok', name); return r; };
    const coverage = JSON.parse(fs.readFileSync(path.join(fwDir, 'coverage.json'), 'utf8'));
    await fpage.goto(full.accessUrl); await fpage.locator('#records .record').first().waitFor(); await fready();
    const firstPlace = (await fmcp('places.list', {})).places[0], fplace = fpage.locator('.detail article[data-place-id="' + firstPlace.id + '"][data-loaded="true"]');
    await fplace.waitFor();
    const flatest = (await fmcp('forecast.hourly', { id: firstPlace.id })).issuance;
    await fpage.waitForFunction(id => document.querySelector('section[aria-label="Next 24 hours"] table')?.dataset.issuanceId === id, flatest.id);
    checks.push('on the full-window dataset the first place opens on its latest issuance at the dataset clock');
    await step(fpage, 'full-window', 'Two years of forecasts: the first place opens on its latest issuance at the dataset clock', { action: 'A third run: Infra loads datasets/full-window with env.load_seed at its clock (' + fwClock + '); open the access link.', expected: 'The first saved place shows its latest issuance, ' + flatest.id + '.', observed: await said(fplace.locator('[data-issuance]')), state: { 'env.load_seed': fwLoad.status + ', ' + fwLoad.loaded + ' records', 'forecast.hourly': firstPlace.id + ': ' + flatest.id + ', issued ' + flatest.issued_at }, check: 'on the full-window dataset the first place opens on its latest issuance at the dataset clock' });
    await fnav('Alerts');
    let storm = null;
    for (const p of (await fmcp('places.list', {})).places) { storm = (await fmcp('alerts.list', { id: p.id })).alerts.find(a => a.status === 'active'); if (storm) break; }
    const fstorm = fpage.locator('.detail article[data-alert-id="' + storm.id + '"][data-loaded="true"]');
    await fpage.locator('#records [data-alert-id="' + storm.id + '"]').click(); await fstorm.waitFor();
    check('the alert in effect at the dataset clock is listed and opens', (await head(fstorm)).includes('Active'));
    await step(fpage, 'full-window', 'The winter storm in effect at the clock', { action: 'Alerts: open the alert in effect.', expected: storm.id + ' is active; what it announces after the clock (its end) is not counted as history.', observed: await head(fstorm) + ' · ' + await dd(fstorm, 'In effect'), state: { 'alerts.list': storm.id + ' ' + storm.status + ', ends ' + storm.ends, 'coverage.json': coverage.forecast_and_announced_times.alerts_ending_after_clock + ' alert ends after the clock; announced times are excluded from every count' }, check: 'the alert in effect at the dataset clock is listed and opens' });
    await fnav('Watches');
    const upcoming = (await fmcp('watches.list', {})).watches.find(w => Date.parse(w.start) > Date.parse(fwClock)), fwatch = fpage.locator('.detail article[data-watch-id="' + upcoming.id + '"][data-loaded="true"]');
    await fpage.locator('#records [data-watch-id="' + upcoming.id + '"]').click(); await fwatch.waitFor();
    check('a watch whose window is after the dataset clock is open, and its window is not history', !upcoming.cancelled_at && (await head(fwatch)).includes(upcoming.label));
    await step(fpage, 'full-window', 'A watch for New Year\'s Day: its window is after the clock', { action: 'Watches: open “' + upcoming.label + '”.', expected: 'The watch is open; the coverage report counts when it was created, not the hours it looks at.', observed: await head(fwatch), state: { 'watches.list': upcoming.id + ' ' + upcoming.status + ', window ' + upcoming.start + ' → ' + upcoming.end, 'coverage.json': coverage.forecast_and_announced_times.watch_windows_after_clock + ' watch window after the clock, excluded' }, check: 'a watch whose window is after the dataset clock is open, and its window is not history' });
    await fnav('Notices');
    await fpage.locator('select[aria-label="Notice kind"]').selectOption('alert.cancelled');
    await fpage.waitForFunction(() => [...document.querySelectorAll('#records [data-notice-id]')].length > 0 && [...document.querySelectorAll('#records [data-notice-id]')].every(n => n.textContent.includes('Alert cancelled')));
    const cancelledNotices = (await fmcp('notices.list', { kind: 'alert.cancelled', limit: 50 })).notices, oldestNotice = cancelledNotices.at(-1), fnotice = fpage.locator('.detail article[data-notice-id="' + oldestNotice.id + '"]');
    await fpage.locator('#records [data-notice-id="' + oldestNotice.id + '"]').click(); await fnotice.waitFor();
    check('the oldest cancelled-alert notice of the dataset shows its year', oldestNotice.created_at.startsWith('2025') && (await fnotice.innerText()).includes('2025'));
    await step(fpage, 'full-window', 'The oldest cancelled-alert notice, from 2025, with its year shown', { action: 'Notices: kind Alert cancelled; open the last one in the list.', expected: 'The notice written ' + oldestNotice.created_at + '; a date outside the clock\'s year shows its year.', observed: await head(fnotice), state: { 'notices.list': cancelledNotices.length + ' alert.cancelled notices; oldest ' + oldestNotice.id + ' at ' + oldestNotice.created_at }, check: 'the oldest cancelled-alert notice of the dataset shows its year' });
    equal('no JavaScript errors on the full-window dataset', ferrors, []);
    await fcontext.close();

    const report = { schema: 'rainshadow.web-check.v1', passed: true, recorded_at: new Date().toISOString(), node: process.version, browser: browser.version(), runtime: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      package_sha256: digestTree(appDir), duration_ms: Date.now() - started, checks: checks.length, names: checks, screenshots };
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + '\n'); }
    if (evidence) {
      for (const x of sequences) if (x.check) assert.ok(checks.includes(x.check), 'evidence step names a check of this run: ' + x.check);
      fs.writeFileSync(path.join(evidence, 'sequences.json'), JSON.stringify({
        schema: 'rainshadow.web-evidence.v1', app_version: JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8')).version, package_sha256_without_evidence: digestWithout(appDir, 'evidence'),
        runtime: report.runtime, node: process.version, browser: 'Chrome ' + browser.version() + ', headless', viewport: '1360x960 (narrow checks at 390x844)', browser_time_zone: 'Asia/Tokyo', place_time_zones: 'each place\'s own (Wren Lake: ' + DENVER + ')',
        runs: { browser: 'sandbox profile, fixtures/minimal.json, account rainshadow-maya (Maya Chen), clock ' + JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures/clock.json'), 'utf8')).initial_time, restricted: 'scenario profile, same fixture', 'full-window': 'sandbox profile, datasets/full-window loaded by Infra at its clock' },
        test: 'tests/web.browser.cjs', checks: checks.length, steps: sequences,
      }, null, 2) + '\n');
    }
    console.log('PASS: ' + checks.length + ' browser checks (' + browser.version() + ').' + (evidence ? ' Evidence: ' + sequences.length + ' steps.' : ''));
  } catch (e) {
    console.error('FAIL after ' + checks.length + ' checks: ' + (e.stack || e));
    if (shots) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(shots, 'failed-' + i + '.png'), fullPage: true }).catch(() => {});
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify({ schema: 'rainshadow.web-check.v1', passed: false, checks: checks.length, names: checks, error: String(e.message || e) }, null, 2) + '\n'); }
    process.exitCode = 1;
  } finally {
    await infra?.close().catch(() => {}); await restrictedInfra?.close().catch(() => {}); await fullInfra?.close().catch(() => {}); await full?.close().catch(() => {});
    await host?.close().catch(() => {}); await restricted?.close().catch(() => {}); await browser?.close().catch(() => {});
    prepared.cleanup();
  }
}
main();
