'use strict';
// Browser acceptance for the Fernshelf page: real clicks in Chromium through the shared Web Host,
// with every change checked through a separate MCP connection to the same run. Needs the
// repository's pinned Playwright (npm ci && npx playwright install chromium at the repository
// root); it is not part of `npm test`. Screenshots and a JSON report go to --out DIR
// (default <repository>/.artifacts/fernshelf-web).
//   node tests/web-browser.cjs [--runtime DIR] [--out DIR]
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir(), {start} = require(path.join(runtime, 'web/server.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
const {chromium} = require(require.resolve('playwright', {paths: [path.dirname(runtime)]}));
const pkg = locate.packageDir, registry = path.join(pkg, 'web.registry.json');
const out = locate.option('out') || path.join(path.dirname(runtime), '.artifacts/fernshelf-web');
const HOSTILE = '<img src=x onerror="window.injected=true"> Steps & "quotes"';

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-browser-'));
  const browser = await chromium.launch({headless: true});
  const report = {schema: 'fernshelf.web-browser.v1', checked_at: new Date().toISOString(), node: process.version, browser: browser.version(), checks: [], screenshots: [], passed: false};
  const check = (name, condition, detail) => { assert.ok(condition, name + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); report.checks.push(name); console.log('ok - ' + name); };
  const hosts = [], clients = [];
  try {
    const host = await start({app: 'fernshelf', registry, run: 'browser', stateDir, profile: 'sandbox'}); hosts.push(host);
    const open = async (role, run = 'browser') => { const c = new Client('fernshelf', role, run, stateDir, 'fernshelf-browser-check', {registry}); await c.initialize(); clients.push(c); return c; };
    // Core answers "App is locked" to a second process while the page's write holds the lock; the
    // independent checks retry that answer.
    const patient = c => ({call: async (name, args) => { for (let i = 0; ; i++) { try { return await c.call(name, args); } catch (e) { if (!/locked/.test(e.message) || i > 60) throw e; await new Promise(r => setTimeout(r, 150)); } } }});
    const mcp = patient(await open('agent')), infra = patient(await open('infra'));
    const until = async (what, fn) => { const end = Date.now() + 20000; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise(r => setTimeout(r, 150)); } throw new Error('Timed out: ' + what); };
    const item = async id => (await mcp.call('fernshelf.items.get', {id})).item;
    const album = async id => (await mcp.call('fernshelf.albums.get', {id})).album;

    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = [];
    let expectNetworkError = false;
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    // Business HTTP answers that are not 200 are recorded with their body. The only ones expected
    // are Core's "App is locked" while this test's own MCP or Infra process commits; the page
    // retries those reads. The browser logs such answers as a failed resource load.
    const answers = [];
    page.on('response', async res => { if (res.url().endsWith('/api/call') && res.status() !== 200) answers.push({status: res.status(), body: await res.text().catch(() => '')}); });
    page.on('console', m => { if (m.type() === 'error' && !(expectNetworkError && /Failed to load resource|ERR_FAILED/.test(m.text())) && !/status of 400/.test(m.text())) errors.push('console: ' + m.text()); });
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const nav = async label => { await page.locator('nav button').filter({hasText: label}).first().click(); await idle(); };
    const dialog = page.locator('dialog[open]');
    const submit = async () => { await dialog.locator('button[type=submit]').click(); };
    const shot = async (name, p = page, full = false) => { const file = path.join(out, name + '.png'); await p.screenshot({path: file, fullPage: full}); report.screenshots.push(path.basename(file)); };
    const select = async id => { await page.locator('#records [data-record-id="' + id + '"]').first().click(); await page.locator('.detail[data-selected-id="' + id + '"]').waitFor(); await idle(); };
    const detailButton = name => page.locator('.detail').getByRole('button', {name, exact: true});

    await page.goto(host.accessUrl); await idle(); await page.locator('#records .fs-tile').first().waitFor();
    await until('first thumbnails', () => page.locator('#records .fs-tile img').count());
    check('Page opens from the access link and shows the photo grid with authorised thumbnails', await page.locator('#records .fs-tile img').count() > 0);
    check('Access token removed from the address bar', !page.url().includes('access='));
    const sha = await page.locator('#records .fs-tile img').first().getAttribute('data-sha256');
    const catalog = require('../contribution/assets.catalog.json');
    check('Thumbnail bytes are the catalogued image (items.read)', catalog.assets.some(a => a.integrity.sha256 === sha));
    await shot('desktop-photos');

    // W2: a new album through the schema form, with a lost response retried once.
    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === 'fernshelf.albums.create' && body.arguments.title === 'Browser trip') { dropped = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    expectNetworkError = true;
    await page.getByRole('button', {name: 'New album', exact: true}).click();
    await dialog.locator('[data-field=title]').fill('Browser trip'); await submit();
    await dialog.locator('[role=alert]').filter({hasText: /fetch/i}).waitFor();
    check('A lost response leaves the form open with the error', await dialog.count() === 1);
    await submit(); await dialog.waitFor({state: 'hidden'}); await idle();
    expectNetworkError = false; await page.unroute('**/api/call');
    const albums = (await mcp.call('fernshelf.albums.list')).albums.filter(a => a.title === 'Browser trip');
    check('Retry of the unchanged form commits one album (same request ID)', albums.length === 1, albums.length);
    const trip = albums[0].id;
    await page.locator('.fs-album-head h2', {hasText: 'Browser trip'}).waitFor();
    check('After creating, the page opens the new album', true);

    // Add items through the picker.
    await page.getByRole('button', {name: 'Add items', exact: true}).click();
    const picks = dialog.locator('[data-pick-id]');
    const chosenIds = [await picks.nth(0).getAttribute('data-pick-id'), await picks.nth(2).getAttribute('data-pick-id')];
    await picks.nth(0).click(); await picks.nth(2).click(); await submit(); await dialog.waitFor({state: 'hidden'});
    await until('album items', async () => (await album(trip)).entries.length === 2);
    check('Add items: albums.update add_ids committed in order', JSON.stringify((await album(trip)).entries.map(e => e.id)) === JSON.stringify(chosenIds));
    await idle();

    // Reorder and remove from the album through the photo panel.
    await select(chosenIds[0]);
    await detailButton('Move later').click();
    await until('reordered', async () => (await album(trip)).entries[0].id === chosenIds[1]);
    check('Move later: albums.update order', true);
    await idle();

    // W3: invite, link, revoke.
    await page.getByRole('button', {name: 'Invite', exact: true}).click();
    await dialog.locator('select[data-field=person_id]').selectOption('person-iris');
    await dialog.locator('select[data-field=role]').selectOption('contributor'); await submit(); await dialog.waitFor({state: 'hidden'});
    await until('invite', async () => (await album(trip)).members.some(m => m.person_id === 'person-iris' && m.status === 'invited' && m.role === 'contributor'));
    check('Invite: Iris invited as contributor', true); await idle();
    await page.getByRole('button', {name: 'Create link', exact: true}).click(); await submit(); await dialog.waitFor({state: 'hidden'});
    const link = await until('link', async () => (await album(trip)).links.find(l => l.state === 'active'));
    check('Create link: an active link without expiry', link.expires_at === null);
    await idle();
    await page.locator('.fs-sharing').getByRole('button', {name: 'Revoke', exact: true}).click();
    await dialog.getByRole('button', {name: 'Revoke link'}).click(); await dialog.waitFor({state: 'hidden'});
    await until('revoked', async () => (await album(trip)).links.find(l => l.id === link.id).state === 'revoked');
    check('Revoke link: link revoked', true); await idle();
    await shot('desktop-album');

    // Photo panel: favourite, caption (hostile text), people, trash and restore.
    await nav('Photos'); await select('it-2611-0931');
    await detailButton('♡ Favourite').click();
    await until('favourite', async () => (await item('it-2611-0931')).favorite === true);
    check('Favourite: items.update favorite', true); await idle();
    await detailButton('Edit details').click();
    check('Edit details shows only caption, favourite, archived and corrected time', JSON.stringify(await dialog.locator('label.field:not([hidden]) [data-field]').evaluateAll(n => n.map(x => x.dataset.field))) === JSON.stringify(['patch.caption', 'patch.favorite', 'patch.archived', 'patch.taken_at']));
    await dialog.locator('[data-field="patch.caption"]').fill(HOSTILE); await submit(); await dialog.waitFor({state: 'hidden'});
    await until('caption', async () => (await item('it-2611-0931')).caption === HOSTILE);
    await idle();
    check('Hostile caption is stored as text and shown as text, never executed',
      (await page.locator('.detail h2').innerText()) === HOSTILE && !(await page.evaluate(() => window.injected)) && await page.locator('.detail h2 img').count() === 0);
    const before = (await item('it-2611-0931')).people;
    const label = (await mcp.call('fernshelf.account.get')).labels.find(l => !before.includes(l.id));
    await page.locator('.detail select[aria-label="Add a person"]').selectOption(label.id);
    await until('person added', async () => (await item('it-2611-0931')).people.includes(label.id));
    check('People: add a label (items.update add_people)', true); await idle();
    await page.locator('.detail').getByRole('button', {name: 'Remove ' + label.name}).click();
    await until('person removed', async () => !(await item('it-2611-0931')).people.includes(label.id));
    check('People: remove a label (items.update remove_people)', true); await idle();
    await shot('desktop-photo-detail');

    // Stack cover on another stack.
    await select('it-2611-0942');
    const stack = (await item('it-2611-0942')).stack;
    await page.locator('.detail .fs-versions').getByRole('button', {name: 'Make cover'}).first().click();
    await until('cover', async () => (await item('it-2611-0942')).stack.cover_id !== stack.cover_id);
    check('Make cover: the stack cover changes', true); await idle();

    // W5: trash and restore one item; bulk trash and delete forever.
    await nav('Photos'); await select('it-2611-0931');
    await detailButton('Move to trash').click();
    await until('trashed', async () => (await item('it-2611-0931')).state === 'trashed');
    check('Move to trash: item trashed', true); await idle();
    await nav('Trash'); await select('it-2611-0931');
    check('Trashed item shows when it will be deleted for good', /Deleted for good on/.test(await page.locator('.detail .fs-warning').innerText()));
    await detailButton('Restore').click();
    await until('restored', async () => (await item('it-2611-0931')).state === 'active');
    check('Restore: item back in its albums', (await album('al-reunion-2026')).entries.some(e => e.id === 'it-2611-0931')); await idle();
    await nav('Photos');
    await page.getByRole('button', {name: 'Select', exact: true}).click(); await idle();
    const tiles = page.locator('#records .fs-tile');
    // Two items that no removal request names and that later steps do not use.
    const keep = new Set([...(await mcp.call('fernshelf.removals.list')).removals.flatMap(r => r.item_ids), 'it-2611-0931', 'it-2611-0934', 'it-2611-0942', ...chosenIds]);
    const bulk = (await tiles.evaluateAll(n => n.map(x => x.dataset.recordId))).filter(id => !keep.has(id)).slice(0, 2);
    for (const id of bulk) await page.locator('#records [data-record-id="' + id + '"]').click();
    check('Select mode counts the chosen items', (await page.locator('.fs-bulk strong').innerText()) === '2 selected');
    await page.locator('.fs-bulk').getByRole('button', {name: 'Move to trash'}).click();
    await until('bulk trashed', async () => (await Promise.all(bulk.map(item))).every(i => i.state === 'trashed'));
    check('Bulk move to trash: items.trash with 2 IDs', true); await idle();
    await nav('Trash');
    await page.getByRole('button', {name: 'Select', exact: true}).click(); await idle();
    for (const id of bulk) await page.locator('#records [data-record-id="' + id + '"]').click();
    await page.locator('.fs-bulk').getByRole('button', {name: 'Delete forever'}).click();
    await dialog.getByRole('button', {name: 'Delete forever'}).click();
    const freed = page.locator('dialog.fs-dialog[open]', {hasText: 'freed'}); await freed.waitFor();
    await until('purged', async () => (await Promise.all(bulk.map(item))).every(i => i.state === 'purged'));
    check('Delete forever: items.purge with confirm, and the freed space is shown', true);
    await freed.getByRole('button', {name: 'Close'}).click(); await dialog.waitFor({state: 'hidden'}); await idle();

    // W4: honour one request (result listed), decline the other.
    await nav('Requests');
    const pending = (await mcp.call('fernshelf.removals.list', {state: 'pending'})).removals;
    const albumScoped = pending.find(r => r.scope.type === 'album'), other = pending.find(r => r !== albumScoped);
    await select(albumScoped.item_ids[0]);
    await page.locator('.detail .fs-exposure .fs-surface').first().waitFor();
    check('Before answering, the photo panel shows where the item is visible (exposure.get)', (await page.locator('.detail .fs-exposure').innerText()).includes('Reunion 2026'));
    await page.locator('[data-request-id="' + albumScoped.id + '"]').getByRole('button', {name: 'Honor…'}).click();
    await dialog.locator('[data-field=note]').fill('Taken out of the reunion album.'); await submit();
    await page.locator('dialog.fs-dialog[open] h2', {hasText: 'Request honoured'}).waitFor();
    check('Honour shows what was taken down and what was already seen', /Taken down/i.test(await page.locator('dialog.fs-dialog[open]').innerText()));
    await shot('desktop-request-result');
    await page.locator('dialog.fs-dialog[open]').getByRole('button', {name: 'Close'}).click();
    const honored = (await mcp.call('fernshelf.removals.list', {state: 'honored'})).removals.find(r => r.id === albumScoped.id);
    check('Honour: request honoured with the note', honored?.answers.at(-1).note === 'Taken out of the reunion album.'); await idle();
    await page.locator('[data-request-id="' + other.id + '"]').getByRole('button', {name: 'Decline…'}).click(); await submit(); await dialog.waitFor({state: 'hidden'});
    await until('declined', async () => (await mcp.call('fernshelf.removals.list', {state: 'declined'})).removals.some(r => r.id === other.id));
    check('Decline: request declined', true); await idle();
    // Showing an honoured item again is accepted, with a warning naming the requester.
    await select(albumScoped.item_ids[0]);
    await detailButton('Add to album').click();
    await dialog.getByRole('button', {name: /Browser trip/}).click();
    const warned = page.locator('dialog.fs-dialog[open]', {hasText: /Shown again to people who asked for removal/i}); await warned.waitFor();
    check('Re-sharing an honoured item shows the removal_honored warning', (await warned.innerText()).includes(albumScoped.from.display_name.split(' ')[0]) &&
      (await album(trip)).entries.some(e => e.id === albumScoped.item_ids[0]));
    await shot('desktop-warning');
    await warned.getByRole('button', {name: 'Close'}).click(); await idle();

    // W3 on a seeded shared album: role change, saving a contribution, a refused delete.
    await nav('Albums'); await page.locator('[data-album-id="al-reunion-2026"]').click(); await idle();
    await page.locator('.fs-person', {hasText: 'Kofi Darrow'}).getByRole('button', {name: 'Change role'}).click();
    await dialog.locator('select[data-field=role]').selectOption('contributor'); await submit(); await dialog.waitFor({state: 'hidden'});
    await until('role', async () => (await album('al-reunion-2026')).members.find(m => m.person_id === 'person-kofi').role === 'contributor');
    check('Change role: Kofi is a contributor', true); await idle();
    const savedBefore = (await mcp.call('fernshelf.items.search', {source: 'saved_from_share'})).total;
    await page.locator('[data-contribution-id]').first().click();
    await dialog.locator('.fs-exposure .muted, .fs-exposure p').first().waitFor();
    await dialog.getByRole('button', {name: 'Save to my library'}).click(); await dialog.waitFor({state: 'hidden'});
    await until('saved', async () => (await mcp.call('fernshelf.items.search', {source: 'saved_from_share'})).total === savedBefore + 1);
    check('Save to my library: albums.save_item', true); await idle();
    await page.locator('.fs-album-head').getByRole('button', {name: 'Delete album'}).click();
    await dialog.getByRole('button', {name: 'Delete album'}).click();
    const refusal = dialog.locator('.form-error[data-code=confirm_required]'); await refusal.waitFor();
    check('A refused delete shows the App code and message and changes nothing',
      /joined members or an active link/.test(await refusal.innerText()) && (await album('al-reunion-2026')).deleted_at === null);
    await shot('desktop-refusal');
    await dialog.getByRole('button', {name: 'Cancel'}).click();

    // A stale form.
    await nav('Photos'); await select('it-2611-0934');
    await detailButton('Edit details').click();
    const v = (await infra.call('env.snapshot')).version;
    assert.equal((await mcp.call('fernshelf.items.update', {id: 'it-2611-0934', patch: {caption: 'Edited elsewhere'}, expected_version: v, request_id: 'outside-1'})).status, 'committed');
    await dialog.locator('[data-field="patch.caption"]').fill('Edited in the page'); await submit();
    await dialog.locator('[role=alert][data-code=stale_version]').waitFor();
    check('A stale form shows the conflict and keeps the other change', (await item('it-2611-0934')).caption === 'Edited elsewhere');
    await dialog.getByRole('button', {name: 'Cancel'}).click();

    // A scenario event from Infra, then Refresh.
    const event = JSON.parse(fs.readFileSync(path.join(pkg, 'examples/scenario.json'), 'utf8'));
    const applied = await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event});
    assert.equal(applied.status, 'committed', JSON.stringify(applied));
    await nav('Requests');
    check('Before Refresh the page shows what it last read', await page.locator('[data-request-id="' + event.payload.removal_id + '"]').count() === 0);
    await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await idle();
    await page.locator('[data-request-id="' + event.payload.removal_id + '"]').waitFor();
    check('Refresh shows a removal request that arrived as an event', (await page.locator('nav').innerText()).includes('Requests · 1 new'));

    // Reload keeps committed state and the open view.
    await page.reload(); await idle();
    await page.locator('[data-request-id="' + event.payload.removal_id + '"]').waitFor();
    // Trashing the stack's cover and restoring it made a newer burst frame the cover, so the item
    // is opened from its album rather than from the Photos grid.
    await nav('Albums'); await page.locator('[data-album-id="al-reunion-2026"]').click(); await idle(); await select('it-2611-0931');
    check('Reload: committed caption and favourite are read back', (await page.locator('.detail h2').innerText()) === HOSTILE && (await detailButton('♥ Favourite').count()) === 1);
    check('No JavaScript errors on the desktop page', errors.length === 0, errors);
    check('Every non-200 business answer was Core\'s lock during an outside commit (' + answers.length + ')', answers.every(a => a.status === 400 && /locked/i.test(a.body)), answers);

    // Phone width.
    const phone = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const p = await phone.newPage(); p.setDefaultTimeout(20000);
    p.on('pageerror', e => errors.push('phone pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push('phone console: ' + m.text()); });
    await p.goto(host.accessUrl); await p.locator('#app[aria-busy=false]').waitFor(); await p.locator('#records .fs-tile').first().waitFor();
    const overflow = async () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const view of ['Photos', 'Albums', 'Requests', 'Storage', 'Trash']) {
      await p.locator('nav button').filter({hasText: view}).first().click(); await p.locator('#app[aria-busy=false]').waitFor();
      await p.waitForTimeout(300);
      check('390 px: ' + view + ' has no horizontal page overflow', await overflow() <= 0, await overflow());
      await shot('phone-' + view.toLowerCase(), p);
    }
    await p.locator('nav button').filter({hasText: 'Photos'}).first().click(); await p.locator('#app[aria-busy=false]').waitFor();
    const phoneId = await p.locator('#records .fs-tile').nth(3).getAttribute('data-record-id');
    await p.locator('#records .fs-tile').nth(3).click(); await p.locator('.detail[data-selected-id="' + phoneId + '"]').waitFor();
    await p.waitForTimeout(600);
    check('390 px: tapping a photo scrolls to its panel', await p.locator('.detail .fs-photo h2').isVisible());
    await shot('phone-photo-detail', p, true);
    await p.locator('nav button').filter({hasText: 'Albums'}).first().click(); await p.locator('[data-album-id="al-reunion-2026"]').click(); await p.locator('#app[aria-busy=false]').waitFor();
    check('390 px: album page has no horizontal page overflow', await overflow() <= 0);
    await shot('phone-album', p, true);
    await phone.close();
    for (const view of ['Albums', 'Sharing', 'Storage', 'Activity']) { await nav(view); await page.waitForTimeout(2500); await shot('desktop-' + view.toLowerCase()); }
    check('1280 px: no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await context.close();

    // Restricted profile on a fresh run: no write controls, reads and images still work.
    const restricted = await start({app: 'fernshelf', registry, run: 'browser-restricted', stateDir, profile: 'scenario'}); hosts.push(restricted);
    const rc = await browser.newContext({viewport: {width: 1280, height: 900}}), r = await rc.newPage(); r.setDefaultTimeout(20000);
    r.on('pageerror', e => errors.push('restricted pageerror: ' + e.message));
    await r.goto(restricted.accessUrl); await r.locator('#app[aria-busy=false]').waitFor(); await r.locator('.detail[data-selected-id]').waitFor();
    await until('restricted thumbnails', () => r.locator('#records .fs-tile img').count());
    const writes = ['New album', 'Edit details', 'Add to album', 'Move to trash', 'Archive', 'Select'];
    const present = []; for (const name of writes) if (await r.getByRole('button', {name, exact: true}).count()) present.push(name);
    check('Restricted profile: no write controls on the photo view', present.length === 0, present);
    check('Restricted profile: no people editor', await r.locator('.detail select[aria-label="Add a person"]').count() === 0);
    await r.locator('nav button').filter({hasText: 'Requests'}).first().click(); await r.locator('#app[aria-busy=false]').waitFor();
    check('Restricted profile: requests are readable but cannot be answered', await r.locator('[data-request-id]').count() > 0 && await r.getByRole('button', {name: 'Honor…'}).count() === 0);
    await r.locator('nav button').filter({hasText: 'Albums'}).first().click(); await r.locator('[data-album-id="al-reunion-2026"]').click(); await r.locator('#app[aria-busy=false]').waitFor();
    await r.locator('.fs-album-head h2', {hasText: 'Reunion 2026'}).waitFor(); await r.locator('.fs-sharing .fs-person').first().waitFor();
    check('Restricted profile: album page without Invite, Create link, Revoke or Delete', await r.getByRole('button', {name: /^(Invite|Create link|Revoke|Delete album|Add items|Rename|Change role|Remove)$/}).count() === 0);
    await r.waitForTimeout(1500); await r.screenshot({path: path.join(out, 'restricted-album.png')}); report.screenshots.push('restricted-album.png');
    const denied = await r.evaluate(async () => { const s = await (await fetch('/session')).json(); const res = await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': s.csrf}, body: JSON.stringify({name: 'fernshelf.albums.create', arguments: {title: 'x', expected_version: {epoch: 1, revision: 0}, request_id: 'forced-1'}})}); return res.status; });
    check('Restricted profile: a forced write from the page is refused by the Host', denied === 403);
    await rc.close();
    check('No JavaScript errors anywhere', errors.length === 0, errors);
    report.passed = true;
  } finally {
    fs.writeFileSync(path.join(out, 'web-browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    for (const c of clients) await c.close().catch(() => {});
    await browser.close();
    for (const h of hosts) await h.close().catch(() => {});
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
  console.log(report.checks.length + ' checks passed; report and ' + report.screenshots.length + ' screenshots in ' + out);
})().catch(e => { console.error(e); process.exitCode = 1; });
