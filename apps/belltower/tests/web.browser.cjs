#!/usr/bin/env node
'use strict';
// Browser checks of the Belltower web pages on the public business Web Host: real controls in
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

const BRIDGE = 'it-roads-0031', LIBRARY = 'it-city-0207', BULLETIN = 'it-bull-0312', REPORT = 'it-ledg-0431', CLIPPED = 'clp-0004';
const ZONE = 'America/Chicago';
const at = (date, hhmm) => date + 'T' + hhmm + ':00-06:00';

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
    infra = new Client(prepared.app, 'infra', host.run, stateDir, 'belltower-web-inspector', { registry: prepared.registry });
    await infra.initialize();
    const agent = host.client;
    const snap = async () => infra.call('env.snapshot');
    const data = async () => (await snap()).snapshot.data;
    const mcp = async (name, args = {}) => { const r = await agent.call('belltower.' + name, args); assert.ok(['ok', 'committed'].includes(r.status), name + ': ' + r.status); return r; };

    // The browser runs in another zone than the account: times must come out in the account's zone.
    const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), page = await context.newPage();
    page.setDefaultTimeout(10000); pages.push(page);
    const errors = [], calls = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/call')) calls.push(r.postDataJSON()); });
    const ready = () => page.locator('#app[aria-busy=false]').waitFor();
    const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp(name) }).click(); await ready(); };
    const itemPage = id => page.locator('.detail article[data-item-id="' + id + '"][data-loaded="true"]');
    const openItem = async id => { await page.locator('#records [data-record-id="' + id + '"]').click(); await itemPage(id).waitFor(); };
    const listIds = () => page.locator('#records [data-record-id]').evaluateAll(nodes => nodes.map(n => n.dataset.recordId));
    const dialog = page.locator('dialog.bt-dialog');
    const submit = async () => { await dialog.locator('button[type=submit]').click(); await dialog.waitFor({ state: 'detached' }); await ready(); };
    const refused = async code => { await dialog.locator('[role=alert][data-code="' + code + '"]').waitFor(); const text = await dialog.locator('[role=alert]').innerText(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); return text; };
    const lastCall = name => calls.filter(c => c.name === name).at(-1);
    const args = call => { const { expected_version, request_id, ...rest } = call.arguments; assert.ok(expected_version && request_id, 'a write carries a version and a request ID'); return rest; };
    const shot = async name => { if (!shots) return; const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(path.basename(file)); };
    const inZone = (iso) => page.evaluate(([value, zone]) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)), [iso, ZONE]);
    const refresh = async () => { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready(); };

    // ---- the pages and what the Host offers them ------------------------------------------------------------
    await page.goto(host.accessUrl);
    await page.locator('#records .record').first().waitFor(); await ready();
    check('the Host serves the App-owned pages', await page.title() === 'Belltower · PALE' && await page.locator('nav').getByRole('button', { name: /News/ }).count() === 1);
    const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8'), tools = JSON.parse(fs.readFileSync(path.join(appDir, 'tools.json'), 'utf8'));
    check('the controller names every declared business tool', tools.every(t => controller.includes("'" + t.name + "'")));
    const discovered = await page.evaluate(async () => (await (await fetch('/api/tools')).json()).tools.map(t => t.name));
    check('business discovery offers no management tool', discovered.length === tools.length && discovered.every(n => !n.startsWith('env.')));

    // ---- W2 evidence: items, revisions, copies -----------------------------------------------------------------
    equal('the news list is the App\'s list, newest first', await listIds(), (await mcp('items.list', { limit: 100 })).items.map(i => i.id));
    const marksBefore = (await mcp('reading.list', { limit: 100 })).marks;
    await openItem(BRIDGE);
    const bridge = (await mcp('items.get', { id: BRIDGE })).item;
    const bridgePage = itemPage(BRIDGE);
    check('an item opens at its latest revision with the publisher\'s correction note', (await bridgePage.locator('section[aria-label="Revision text"]').getAttribute('data-revision')) === String(bridge.latest_revision)
      && (await bridgePage.locator('section[aria-label="Correction"]').innerText()).includes(bridge.note));
    check('times are shown in the account\'s zone, not the browser\'s', (await bridgePage.locator('section[aria-label="Revision text"]').innerText()).includes(await inZone(bridge.received_at)));
    await shot('news');
    await bridgePage.locator('button.bt-rev[data-revision="1"]').click();
    await itemPage(BRIDGE).locator('section[aria-label="Revision text"][data-revision="1"]').waitFor();
    const first = (await mcp('items.get', { id: BRIDGE, revision: 1 })).item;
    check('an earlier revision is shown as such, with its own text', (await itemPage(BRIDGE).locator('section[aria-label="Earlier revision"]').innerText()).includes('revision 1 of ' + bridge.latest_revision)
      && (await itemPage(BRIDGE).locator('h2').innerText()) === first.headline && (await itemPage(BRIDGE).locator('section[aria-label="Revision text"]').innerText()).includes(first.body));
    await openItem(LIBRARY); await openItem(BULLETIN);
    equal('opening items marks nothing as read', (await mcp('reading.list', { limit: 100 })).marks, marksBefore);
    await openItem(BRIDGE);
    await itemPage(BRIDGE).getByRole('button', { name: 'Show the latest revision', exact: true }).click();
    await itemPage(BRIDGE).locator('section[aria-label="Revision text"][data-revision="' + bridge.latest_revision + '"]').waitFor();
    await itemPage(BRIDGE).getByRole('button', { name: 'Mark revision ' + bridge.latest_revision + ' as read', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'marked as read' }).waitFor(); await ready();
    equal('marking sends the revision on the page', args(lastCall('belltower.reading.mark')), { id: BRIDGE, revision: bridge.latest_revision });
    check('the read mark is the App\'s record and the list no longer says changed since read', (await data()).read_marks.some(m => m.item_id === BRIDGE && m.revision === bridge.latest_revision)
      && !(await page.locator('#records [data-record-id="' + BRIDGE + '"]').innerText()).includes('Changed since read'));

    await page.locator('.toolbar input[type=search]').fill('Thursday'); await ready();
    const thursday = (await mcp('items.list', { query: 'Thursday', limit: 100 })).items;
    equal('search is the App\'s word search over every revision', await listIds(), thursday.map(i => i.id));
    check('an item found only in an earlier revision says so', thursday.find(i => i.id === BRIDGE).matched_revisions.join() === '1'
      && (await page.locator('#records [data-record-id="' + BRIDGE + '"]').innerText()).includes('Found in revision 1'));
    await page.locator('.toolbar input[type=search]').fill(''); await ready();
    await page.locator('details.bt-filters summary').click();
    await page.locator('details.bt-filters select[data-field=status]').selectOption('corrected'); await ready();
    equal('a filter is the App\'s filter', await listIds(), (await mcp('items.list', { status: 'corrected', limit: 100 })).items.map(i => i.id));
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await ready();

    await openItem(BULLETIN);
    const basis = itemPage(BULLETIN).locator('section[aria-label="Based on"][data-loaded="true"]');
    await basis.waitFor();
    const library = (await mcp('items.get', { id: LIBRARY })).item;
    check('a copy names the revision it copied and the source\'s revisions now, and nothing is labelled outdated', (await basis.innerText()).includes('copies revision 1 of “' + (await mcp('items.get', { id: LIBRARY, revision: 1 })).item.headline + '”')
      && (await basis.innerText()).includes('has ' + library.latest_revision + ' revisions now') && !/outdated/i.test(await page.locator('.detail').innerText()));
    await basis.getByRole('button', { name: 'Open its latest revision', exact: true }).click();
    await itemPage(LIBRARY).locator('section[aria-label="Revision text"][data-revision="' + library.latest_revision + '"]').waitFor();
    equal('the copied item lists who copied or reported it, with the revision each used', await itemPage(LIBRARY).locator('section[aria-label="Copied or reported by"] li').evaluateAll(n => n.map(x => x.dataset.refItemId)), library.referenced_by.map(r => r.item_id));
    const retracted = (await mcp('items.list', { status: 'retracted', limit: 1 })).items[0], gone = (await mcp('items.get', { id: retracted.id })).item;
    await openItem(retracted.id);
    check('a retraction shows the publisher\'s note and no text of its own', (await itemPage(retracted.id).locator('section[aria-label="Retraction"]').innerText()).includes(gone.note)
      && (await itemPage(retracted.id).locator('section[aria-label="Revision text"]').innerText()).includes('No text in this revision.'));
    await itemPage(retracted.id).locator('button.bt-rev[data-revision="1"]').click();
    await itemPage(retracted.id).locator('section[aria-label="Revision text"][data-revision="1"]').waitFor();
    check('the retracted item\'s earlier revision stays readable', (await itemPage(retracted.id).locator('section[aria-label="Revision text"]').innerText()).includes((await mcp('items.get', { id: retracted.id, revision: 1 })).item.body));

    // ---- W3 clippings --------------------------------------------------------------------------------------------
    await openItem(REPORT);
    await itemPage(REPORT).getByRole('button', { name: 'Clip this item', exact: true }).click();
    await dialog.locator('[data-field=note]').fill('Check the new hours before Tuesday.');
    await dialog.locator('[data-field="linked_object.app_id"]').fill('calendar'); await dialog.locator('[data-field="linked_object.object_type"]').fill('event'); await dialog.locator('[data-field="linked_object.object_id"]').fill('evt-web-1');
    await dialog.locator('[data-field=watch]').check();
    await submit();
    const reportItem = (await mcp('items.get', { id: REPORT })).item, clip = (await data()).clippings.find(c => c.item_id === REPORT);
    equal('a clipping made in the browser is the App\'s record at the latest revision', clip && [clip.revision, clip.note, clip.linked_object, clip.watch], [reportItem.latest_revision, 'Check the new hours before Tuesday.', { app_id: 'calendar', object_type: 'event', object_id: 'evt-web-1' }, true]);

    await nav('Clippings');
    await page.locator('#records [data-clipping-id="' + CLIPPED + '"]').click();
    const clipPage = page.locator('.detail article[data-clipping-id="' + CLIPPED + '"][data-loaded="true"]');
    await clipPage.waitFor();
    await shot('clippings');
    await clipPage.getByRole('button', { name: 'Move to revision ' + library.latest_revision, exact: true }).click();
    await page.locator('#status').filter({ hasText: 'now holds revision' }).waitFor(); await ready();
    equal('moving a clipping sends only the new revision', args(lastCall('belltower.clippings.update')), { id: CLIPPED, patch: { revision: library.latest_revision } });
    let kept = (await data()).clippings.find(c => c.id === CLIPPED);
    check('the clipping holds the newer revision and keeps the old one in its history', kept.revision === library.latest_revision && kept.history.at(-1).revision === 1);
    await clipPage.waitFor();
    await clipPage.getByRole('button', { name: 'Edit clipping', exact: true }).click();
    await dialog.locator('[data-field=note]').fill('Study group moved to the corrected hours.');
    await submit();
    equal('editing a clipping sends only the changed note', args(lastCall('belltower.clippings.update')), { id: CLIPPED, patch: { note: 'Study group moved to the corrected hours.' } });
    await clipPage.waitFor();
    await clipPage.getByRole('button', { name: 'Watch', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Watching this item.' }).waitFor(); await ready();
    kept = (await data()).clippings.find(c => c.id === CLIPPED);
    check('watching sends only the watch flag and the App now watches the clipping', JSON.stringify(args(lastCall('belltower.clippings.update'))) === JSON.stringify({ id: CLIPPED, patch: { watch: true } }) && kept.watch === true && kept.note === 'Study group moved to the corrected hours.');
    await page.locator('#records [data-clipping-id="' + clip.id + '"]').click();
    await page.locator('.detail article[data-clipping-id="' + clip.id + '"][data-loaded="true"]').getByRole('button', { name: 'Remove clipping', exact: true }).click();
    await submit();
    check('removing a clipping takes it out of the App', !(await data()).clippings.some(c => c.id === clip.id));

    // ---- W1 following ----------------------------------------------------------------------------------------------
    await nav('Following');
    const before = (await data()).follows.length;
    await page.getByRole('button', { name: 'New follow rule', exact: true }).click();
    await dialog.locator('[data-field=topics] input[value=transit]').check();
    await dialog.locator('[data-field=area_ids] input[value=ar-old-quay]').check();
    await dialog.locator('[data-field=min_priority]').selectOption('important'); await dialog.locator('[data-field=delivery]').selectOption('immediate');
    await submit();
    let rule = (await data()).follows.find(f => f.topics.join() === 'transit' && f.area_ids.join() === 'ar-old-quay');
    equal('a follow rule made in the browser is the App\'s rule with exactly the chosen filters', rule && { s: rule.source_ids, a: rule.area_ids, t: rule.topics, p: rule.min_priority, d: rule.delivery, paused: rule.paused }, { s: [], a: ['ar-old-quay'], t: ['transit'], p: 'important', d: 'immediate', paused: false });
    await page.reload(); await page.locator('#records [data-follow-id="' + rule.id + '"]').waitFor();
    checks.push('a reload keeps the committed rule');
    await page.locator('#records [data-follow-id="' + rule.id + '"]').click();
    const rulePage = page.locator('.detail article[data-follow-id="' + rule.id + '"][data-loaded="true"]');
    await rulePage.getByRole('button', { name: 'Edit rule', exact: true }).click();
    await dialog.locator('[data-field=delivery]').selectOption('digest');
    await submit();
    equal('an edit sends only the edited field', args(lastCall('belltower.follows.update')), { id: rule.id, patch: { delivery: 'digest' } });
    await rulePage.getByRole('button', { name: 'Edit rule', exact: true }).click();
    await mcp('follows.update', { id: rule.id, patch: { min_priority: 'urgent' }, expected_version: (await snap()).version, request_id: 'outside-edit' });
    await dialog.locator('[data-field=delivery]').selectOption('immediate');
    await dialog.locator('button[type=submit]').click();
    await refused('stale_version');
    rule = (await data()).follows.find(f => f.id === rule.id);
    equal('a stale form shows the conflict and the concurrent change stands', [rule.min_priority, rule.delivery], ['urgent', 'digest']);

    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === 'belltower.follows.create' && (body.arguments.topics || []).join() === 'weather') { dropped = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'New follow rule', exact: true }).click();
    await dialog.locator('[data-field=topics] input[value=weather]').check();
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('[role=alert][data-code=request_failed]').waitFor();
    await submit();
    await page.unroute('**/api/call');
    const weather = (await data()).follows.filter(f => f.topics.join() === 'weather');
    equal('a retry after a lost response has one effect', weather.length, 1);

    const existing = (await data()).follows.find(f => f.id === 'fl-0001'), count = (await data()).follows.length;
    await page.getByRole('button', { name: 'New follow rule', exact: true }).click();
    for (const t of existing.topics) await dialog.locator('[data-field=topics] input[value=' + t + ']').check();
    for (const a of existing.area_ids) await dialog.locator('[data-field=area_ids] input[value=' + a + ']').check();
    await dialog.locator('[data-field=min_priority]').selectOption(existing.min_priority);
    await dialog.locator('button[type=submit]').click();
    await refused('already_following');
    equal('a rule that already exists is refused visibly and nothing is written', (await data()).follows.length, count);
    check('the new rules were added one each', count === before + 2);

    await page.locator('#records [data-follow-id="' + rule.id + '"]').click();
    await rulePage.getByRole('button', { name: 'Pause rule', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Rule paused.' }).waitFor(); await ready();
    equal('pausing sends only the paused flag', args(lastCall('belltower.follows.update')), { id: rule.id, patch: { paused: true } });
    check('the rule is paused in the App', (await data()).follows.find(f => f.id === rule.id).paused === true);
    await page.locator('#records [data-follow-id="' + weather[0].id + '"]').click();
    await page.locator('.detail article[data-follow-id="' + weather[0].id + '"][data-loaded="true"]').getByRole('button', { name: 'Remove rule', exact: true }).click();
    await submit();
    check('removing a rule takes it out of the App', !(await data()).follows.some(f => f.id === weather[0].id));
    await shot('following');

    // ---- W4 notifications, the reading record and settings -----------------------------------------------------------
    await nav('Notifications');
    const log = (await mcp('notifications.list', { limit: 50 })).notifications;
    equal('notifications are listed newest first, as the App lists them', await page.locator('#records [data-notification-id]').evaluateAll(n => n.map(x => x.dataset.notificationId)), log.map(n => n.id));
    const superseded = log.find(n => n.state === 'superseded'), held = log.find(n => n.state === 'held');
    await page.locator('#records [data-notification-id="' + superseded.id + '"]').click();
    check('a superseded notification says it was never shown and names the one that replaced it', (await page.locator('.detail article[data-notification-id="' + superseded.id + '"]').innerText()).includes('Superseded by ' + superseded.superseded_by));
    await page.locator('#records [data-notification-id="' + held.id + '"]').click();
    check('a held notification shows its release time in the account\'s zone', (await page.locator('.detail article[data-notification-id="' + held.id + '"]').innerText()).includes('Held until ' + await inZone(held.release_at)));
    await page.locator('select[aria-label="Notification kind"]').selectOption('item.corrected');
    await page.locator('#records [data-notification-id]').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#records [data-notification-id]')].every(n => n.innerText.includes('Corrected')));
    equal('the kind filter is the App\'s filter', await page.locator('#records [data-notification-id]').evaluateAll(n => n.map(x => x.dataset.notificationId)), (await mcp('notifications.list', { kind: 'item.corrected', limit: 50 })).notifications.map(n => n.id));
    await page.locator('select[aria-label="Notification kind"]').selectOption('');
    await shot('notifications');

    await nav('Read');
    await page.locator('.detail article[data-read-view][data-loaded="true"]').waitFor();
    equal('the reading record is the App\'s, newest first', await page.locator('#records [data-mark-item-id]').evaluateAll(n => n.map(x => x.dataset.markItemId + '@' + x.dataset.revision)), (await mcp('reading.list', { limit: 100 })).marks.map(m => m.item_id + '@' + m.revision));

    await nav('Settings');
    const settings = page.locator('.detail article[data-settings][data-loaded="true"]');
    await settings.waitFor();
    await settings.locator('select[data-field=corrections]').selectOption('immediate');
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Settings saved.' }).waitFor(); await ready();
    equal('settings send only what changed', args(lastCall('belltower.preferences.update')), { patch: { corrections: 'immediate' } });
    check('the App now delivers corrections at once', (await mcp('preferences.get')).preferences.corrections === 'immediate');
    await settings.waitFor();
    await settings.locator('input[data-field=digest_time]').fill('23:00');
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await settings.locator('[role=alert][data-code=invalid_arguments]').waitFor();
    check('a digest time inside the quiet hours is refused visibly and nothing changes', (await mcp('preferences.get')).preferences.digest_time === '18:00');
    await shot('settings');

    // ---- independent changes: the clock and events, through Infra only ---------------------------------------------------
    const moved = await infra.call('env.advance_time', { request_id: 'web-clock', expected_version: (await snap()).version, virtual_now: at('2026-11-17', '18:05') });
    assert.ok(['committed', 'ok'].includes(moved.status), JSON.stringify(moved));
    await refresh(); await nav('Notifications');
    await page.locator('#records [data-notification-id="' + held.id + '"] .bt-chip').filter({ hasText: 'Released' }).waitFor();
    checks.push('after a clock move by Infra alone, a held notification reads released');
    const apply = async event => { const r = await infra.call('env.apply_event', { expected_version: (await snap()).version, event }); assert.equal(r.status, 'committed', JSON.stringify(r)); };
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    await apply(scenario);
    await nav('News'); await refresh();
    equal('after Refresh the news list shows an item that arrived as a scenario event', (await listIds())[0], scenario.payload.item_id);
    await openItem(scenario.payload.item_id);
    const copied = itemPage(scenario.payload.item_id).locator('section[aria-label="Based on"][data-loaded="true"]');
    await copied.waitFor();
    check('the new copy names the revision it copied while its source has a newer one', (await copied.innerText()).includes('copies revision 1') && (await copied.innerText()).includes('has 2 revisions now'));
    const hostile = '<img src=x onerror="window.injected=true">';
    await apply({ event_id: 'web-hostile', at: at('2026-11-18', '06:20'), operation: 'belltower.item.published', payload: { item_id: 'it-web-0001', source_id: 'src-courier', kind: 'article',
      revision: { number: 1, published_at: at('2026-11-18', '06:20'), headline: 'Market hours ' + hostile, body: 'Stalls open early. ' + hostile, topics: ['community'], area_ids: ['ar-old-quay'], priority: 'routine' } } });
    await refresh(); await openItem('it-web-0001');
    check('untrusted text is shown as text and never executed', (await page.locator('.detail').innerText()).includes(hostile) && !(await page.evaluate(() => window.injected)) && await page.locator('.detail img').count() === 0);

    const denied = await page.evaluate(async () => { const { csrf } = await (await fetch('/session')).json(); return (await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name: 'env.snapshot', arguments: {} }) })).status; });
    equal('a management request from the business session is denied', denied, 403);
    for (const section of ['News', 'Following', 'Clippings', 'Notifications', 'Read', 'Settings']) {
      await page.setViewportSize({ width: 390, height: 844 }); await nav(section); await page.locator('.detail [data-loaded="true"]').first().waitFor();
      check('no horizontal page overflow on a narrow screen: ' + section, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await shot('narrow');
    await page.setViewportSize({ width: 1360, height: 960 });
    equal('no JavaScript errors in the browser', errors, []);
    await context.close();

    // ---- a Task-like policy: only what the scenario profile allows -------------------------------------------------
    restricted = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'restricted', profile: 'scenario' });
    restrictedInfra = new Client(prepared.app, 'infra', restricted.run, stateDir, 'belltower-web-inspector', { registry: prepared.registry });
    await restrictedInfra.initialize();
    const rdata = async () => (await restrictedInfra.call('env.snapshot')).snapshot.data;
    const rcontext = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), rpage = await rcontext.newPage();
    rpage.setDefaultTimeout(10000); pages.push(rpage);
    const rerrors = [];
    rpage.on('pageerror', e => rerrors.push(e.message));
    await rpage.goto(restricted.accessUrl); await rpage.locator('#records .record').first().waitFor(); await rpage.locator('#app[aria-busy=false]').waitFor();
    const rready = () => rpage.locator('#app[aria-busy=false]').waitFor();
    const ritem = id => rpage.locator('.detail article[data-item-id="' + id + '"][data-loaded="true"]');
    const ropen = async id => { await rpage.locator('#records [data-record-id="' + id + '"]').click(); await ritem(id).waitFor(); };
    const rnav = async name => { await rpage.locator('nav').getByRole('button', { name: new RegExp(name) }).click(); await rready(); };
    await ropen(BULLETIN);
    await ritem(BULLETIN).getByRole('button', { name: 'Mark revision 1 as read', exact: true }).click();
    await rpage.locator('#status[data-error="true"]').waitFor();
    check('a write the policy refuses is shown as refused and changes nothing', (await rpage.locator('#status').innerText()).includes('not allowed') && !(await rdata()).read_marks.some(m => m.item_id === BULLETIN));
    await ropen(BRIDGE);
    await ritem(BRIDGE).getByRole('button', { name: 'Mark revision 2 as read', exact: true }).click();
    await rpage.locator('#status').filter({ hasText: 'marked as read' }).waitFor();
    check('a read mark on an allowed item is recorded', (await rdata()).read_marks.some(m => m.item_id === BRIDGE && m.revision === 2));
    await rnav('Following');
    check('controls the policy does not offer are absent', await rpage.getByRole('button', { name: 'New follow rule', exact: true }).count() === 0 && await rpage.getByRole('button', { name: 'Remove rule', exact: true }).count() === 0);
    await rpage.locator('#records [data-follow-id="fl-0004"]').click();
    const rrule = rpage.locator('.detail article[data-follow-id="fl-0004"][data-loaded="true"]');
    await rrule.getByRole('button', { name: 'Pause rule', exact: true }).click();
    await rpage.locator('#status').filter({ hasText: 'Rule paused.' }).waitFor(); await rready();
    check('the allowed rule can be paused', (await rdata()).follows.find(f => f.id === 'fl-0004').paused === true);
    await rrule.getByRole('button', { name: 'Edit rule', exact: true }).click();
    const rdialog = rpage.locator('dialog.bt-dialog');
    await rdialog.locator('[data-field=topics] input[value=health]').check();
    await rdialog.locator('button[type=submit]').click();
    await rdialog.locator('[role=alert][data-code=permission_denied]').waitFor();
    await rdialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await rdialog.waitFor({ state: 'detached' });
    check('a change outside the allowed fields is refused', !(await rdata()).follows.find(f => f.id === 'fl-0004').topics.includes('health'));
    await rnav('Clippings');
    check('a clipping cannot be removed under this policy', await rpage.getByRole('button', { name: 'Remove clipping', exact: true }).count() === 0);
    await rnav('Settings');
    const rsettings = rpage.locator('.detail article[data-settings][data-loaded="true"]');
    await rsettings.waitFor();
    await rsettings.locator('input[data-field=timezone]').fill('America/Denver');
    await rsettings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await rsettings.locator('[role=alert][data-code=permission_denied]').waitFor();
    check('a settings change outside the allowed fields is refused', (await rdata()).preferences.timezone === ZONE);
    equal('no JavaScript errors under the restricted policy', rerrors, []);
    await rcontext.close();

    const report = { schema: 'belltower.web-check.v1', passed: true, recorded_at: new Date().toISOString(), node: process.version, browser: browser.version(), runtime: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      package_sha256: digestTree(appDir), duration_ms: Date.now() - started, checks: checks.length, names: checks, screenshots };
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + '\n'); }
    console.log('PASS: ' + checks.length + ' browser checks (' + browser.version() + ').');
  } catch (e) {
    console.error('FAIL after ' + checks.length + ' checks: ' + (e.stack || e));
    if (shots) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(shots, 'failed-' + i + '.png'), fullPage: true }).catch(() => {});
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify({ schema: 'belltower.web-check.v1', passed: false, checks: checks.length, names: checks, error: String(e.message || e) }, null, 2) + '\n'); }
    process.exitCode = 1;
  } finally {
    await infra?.close().catch(() => {}); await restrictedInfra?.close().catch(() => {});
    await host?.close().catch(() => {}); await restricted?.close().catch(() => {}); await browser?.close().catch(() => {});
    prepared.cleanup();
  }
}
main();
