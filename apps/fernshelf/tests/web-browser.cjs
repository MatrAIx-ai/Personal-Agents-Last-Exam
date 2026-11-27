'use strict';
// Browser acceptance for the Fernshelf page: real clicks in Chromium through the shared Web Host,
// with every change checked through a separate MCP connection to the same run. Needs the
// repository's pinned Playwright (npm ci && npx playwright install chromium at the repository
// root); it is not part of `npm test`. Screenshots and a JSON report go to --out DIR
// (default <repository>/.artifacts/fernshelf-web).
//   node tests/web-browser.cjs [--runtime DIR] [--out DIR]
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir(), {start} = require(path.join(runtime, 'web/server.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
const {chromium} = require(require.resolve('playwright', {paths: [path.dirname(runtime)]}));
const pkg = locate.packageDir, registry = path.join(pkg, 'web.registry.json');
const out = locate.option('out') || path.join(path.dirname(runtime), '.artifacts/fernshelf-web');
const HOSTILE = '<img src=x onerror="window.injected=true"> Steps & "quotes"';

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(out, 'state-'));
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
    const until = async (what, fn) => { const end = Date.now() + 45000; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise(r => setTimeout(r, 150)); } throw new Error('Timed out: ' + what); };
    const item = async id => (await mcp.call('fernshelf.items.get', {id})).item;
    const album = async id => (await mcp.call('fernshelf.albums.get', {id})).album;

    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const page = await context.newPage(); page.setDefaultTimeout(45000);
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
    // What a person reads: no record IDs, no null/undefined, no JSON and no wording meant for the
    // Agent (argument names, error codes) anywhere in the visible page, open dialogs included.
    const RAW = /\b(?:it|al|ln|rr|ct|vw|ntf|pl|st|img)-[a-z]*\d[\w-]*|\bundefined\b|\bnull\b|\{"|confirm: true|\b[a-z]+_[a-z_]+\b/;
    // The page spells as the account holder reads it: Honour, Favourite (never the US forms).
    const US = /\b(?:Honor|Honored|Honoring|Favorite|Favorites|Color)\b/;
    const readable = async (p, where) => {
      const text = await p.evaluate(() => document.body.innerText), m = RAW.exec(text), u = US.exec(text);
      check(where + ': only readable text (no IDs, null, JSON or Agent wording)', !m, m && text.slice(Math.max(0, m.index - 80), m.index + 80));
      check(where + ': British spelling on every visible control', !u, u && text.slice(Math.max(0, u.index - 60), u.index + 60));
    };
    // What a dialog really shows: controls that are rendered (computed style and a box), in order.
    // Nothing else may be in it, so a field meant to stay out of sight cannot be there at all.
    const shownFields = async (what, expected) => {
      const info = await dialog.evaluate(d => {
        const vis = n => n.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0;
        const controls = [...d.querySelectorAll('input,select,textarea')];
        return {fields: controls.filter(vis).map(n => n.dataset.field || n.type), unseen: controls.filter(n => !vis(n)).map(n => n.dataset.field || n.type), text: d.innerText};
      });
      check(what + ': the dialog shows exactly ' + expected.join(', ') + ' and holds no unseen field', JSON.stringify(info.fields) === JSON.stringify(expected) && !info.unseen.length, info);
      check(what + ': no field asks for record IDs, an order or a decision', !/\b(?:Add|Remove) ids\b|One value per line|\bDecision\b|\bOrder\b/i.test(info.text), info.text);
      await readable(page, what + ' dialog');
    };

    await page.goto(host.accessUrl); await idle(); await page.locator('#records .fs-tile').first().waitFor();
    await until('first thumbnails', () => page.locator('#records .fs-tile img').count());
    check('Page opens from the access link and shows the photo grid with authorised thumbnails', await page.locator('#records .fs-tile img').count() > 0);
    check('Access token removed from the address bar', !page.url().includes('access='));
    const sha = await page.locator('#records .fs-tile img').first().getAttribute('data-sha256');
    const catalog = require('../contribution/assets.catalog.json');
    check('Thumbnail bytes are the catalogued image (items.read)', catalog.assets.some(a => a.integrity.sha256 === sha));
    await shot('desktop-photos'); await readable(page, 'Photos');

    // Versions. The page reads its view as one batch at one version and never pairs those values
    // with a newer version: after its own write it reads the whole view again, and a form sends the
    // version of the read that filled it.
    const version = async () => (await mcp.call('fernshelf.account.get')).version;
    const best = 'al-best-2026', caption = async (id, text) => {
      await select(id); await detailButton('Edit details').click();
      await dialog.locator('[data-field="patch.caption"]').fill(text); await submit(); await dialog.waitFor({state: 'hidden'}); await idle();
      await until('caption ' + text, async () => (await item(id)).caption === text);
    };
    await nav('Albums'); await page.locator('[data-album-id="' + best + '"]').click(); await idle();
    await nav('Requests'); await nav('Photos');
    const pendingBefore = (await mcp.call('fernshelf.removals.list', {state: 'pending'})).removals.length;
    // (a) Changes from outside (Agent connection and an Infra event), then a write in the page.
    let ov = await version();
    ov = (await mcp.call('fernshelf.albums.update', {id: best, title: 'Best of 2026 (elsewhere)', expected_version: ov, request_id: 'outside-rename-1'})).version;
    assert.equal((await mcp.call('fernshelf.albums.members.invite', {id: best, person_id: 'person-dana', role: 'viewer', expected_version: ov, request_id: 'outside-invite-1'})).status, 'committed');
    const request = {event_id: 'ev-web-410', at: '2026-11-20T09:30:00-08:00', operation: 'fernshelf.removal.requested',
      payload: {removal_id: 'rr-web-1', from_person_id: 'person-sam', item_ids: [(await album(best)).entries[0].id], scope: {type: 'everywhere'}, message: 'Could this one stay private?'}};
    assert.equal((await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: request})).status, 'committed');
    await caption('it-2611-0935', 'Edited in the page after changes elsewhere');
    await nav('Albums');
    check('After its own write the page shows an album renamed elsewhere', (await page.locator('[data-album-id="' + best + '"] strong').innerText()) === 'Best of 2026 (elsewhere)');
    check('After its own write the page counts a request that arrived elsewhere', (await page.locator('nav').innerText()).includes('Requests · ' + (pendingBefore + 1) + ' new'));
    await page.locator('[data-album-id="' + best + '"]').click(); await idle();
    check('After its own write the album page shows the new title and the member invited elsewhere',
      await page.locator('.fs-album-meta[data-album-title="Best of 2026 (elsewhere)"]').count() === 1 && (await page.locator('.fs-sharing').innerText()).includes('Dana'));
    // (b) Another change elsewhere, a write in the page, then a form opened before a third change.
    assert.equal((await mcp.call('fernshelf.albums.update', {id: best, title: 'Best of 2026 (second)', expected_version: await version(), request_id: 'outside-rename-2'})).status, 'committed');
    await nav('Photos'); await caption('it-2611-0935', 'Edited in the page again');
    await nav('Albums'); await page.locator('[data-album-id="' + best + '"]').click(); await idle();
    await page.getByRole('button', {name: 'Rename', exact: true}).click();
    await shownFields('Rename album', ['title']);
    check('The Rename form shows the title as it is now', (await dialog.locator('[data-field=title]').inputValue()) === 'Best of 2026 (second)');
    assert.equal((await mcp.call('fernshelf.albums.update', {id: best, title: 'Best of 2026 (third)', expected_version: await version(), request_id: 'outside-rename-3'})).status, 'committed');
    await dialog.locator('[data-field=title]').fill('Renamed in the page'); await submit();
    await dialog.locator('[role=alert][data-code=stale_version]').waitFor();
    check('A form opened before a change elsewhere shows the conflict, and the change elsewhere stays', (await album(best)).title === 'Best of 2026 (third)');
    await shot('desktop-conflict'); await readable(page, 'Conflict');
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await dialog.waitFor({state: 'hidden'});
    await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await idle();
    check('Refresh shows the change made elsewhere', await page.locator('.fs-album-meta[data-album-title="Best of 2026 (third)"]').count() === 1);
    // The request made for this check is withdrawn again, so later checks start from the seeded requests.
    const withdraw = {event_id: 'ev-web-411', at: '2026-11-20T09:31:00-08:00', operation: 'fernshelf.removal.withdrawn', payload: {removal_id: 'rr-web-1'}};
    assert.equal((await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: withdraw})).status, 'committed');
    await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await idle();

    // W2: a new album through the schema form, with a lost response retried once.
    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === 'fernshelf.albums.create' && body.arguments.title === 'Browser trip') { dropped = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    expectNetworkError = true;
    await page.getByRole('button', {name: 'New album', exact: true}).click();
    await shownFields('New album', ['title']);
    await dialog.locator('[data-field=title]').fill('Browser trip'); await submit();
    await dialog.locator('[role=alert]').filter({hasText: /connection was interrupted/i}).waitFor();
    check('A lost response leaves the form open with the error', await dialog.count() === 1);
    await submit(); await dialog.waitFor({state: 'hidden'}); await idle();
    expectNetworkError = false; await page.unroute('**/api/call');
    const albums = (await mcp.call('fernshelf.albums.list')).albums.filter(a => a.title === 'Browser trip');
    check('Retry of the unchanged form commits one album (same request ID)', albums.length === 1, albums.length);
    const trip = albums[0].id;
    await page.locator('.fs-album-meta[data-album-title="Browser trip"]').waitFor();
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
    await shownFields('Invite', ['person_id', 'role']);
    await dialog.locator('select[data-field=person_id]').selectOption('person-iris');
    await dialog.locator('select[data-field=role]').selectOption('contributor'); await submit(); await dialog.waitFor({state: 'hidden'});
    await until('invite', async () => (await album(trip)).members.some(m => m.person_id === 'person-iris' && m.status === 'invited' && m.role === 'contributor'));
    check('Invite: Iris invited as contributor', true); await idle();
    await page.getByRole('button', {name: 'Create link', exact: true}).click();
    await shownFields('Create link', ['expires_at']); await submit(); await dialog.waitFor({state: 'hidden'});
    const link = await until('link', async () => (await album(trip)).links.find(l => l.state === 'active'));
    check('Create link: an active link without expiry', link.expires_at === null);
    await idle();
    await page.locator('.fs-sharing').getByRole('button', {name: 'Revoke', exact: true}).click();
    await dialog.getByRole('button', {name: 'Revoke link'}).click(); await dialog.waitFor({state: 'hidden'});
    await until('revoked', async () => (await album(trip)).links.find(l => l.id === link.id).state === 'revoked');
    check('Revoke link: link revoked', true); await idle();
    await shot('desktop-album'); await readable(page, 'Album page');

    // Photo panel: favourite, caption (hostile text), people, trash and restore.
    await nav('Photos'); await select('it-2611-0931');
    await detailButton('♡ Favourite').click();
    await until('favourite', async () => (await item('it-2611-0931')).favorite === true);
    check('Favourite: items.update favorite', true); await idle();
    await detailButton('Edit details').click();
    await shownFields('Edit details', ['patch.caption', 'patch.favorite', 'patch.archived', 'patch.taken_at']);
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
    await page.locator('.detail .fs-history summary').click();
    await shot('desktop-photo-detail'); await readable(page, 'Photo panel with its history');

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
    await page.locator('[data-request-id="' + albumScoped.id + '"]').getByRole('button', {name: 'Honour…'}).click();
    await shownFields('Honour', ['note']);
    await dialog.locator('[data-field=note]').fill('Taken out of the reunion album.'); await submit();
    await page.locator('dialog.fs-dialog[open] h2', {hasText: 'Request honoured'}).waitFor();
    check('Honour shows what was taken down and what was already seen', /Taken down/i.test(await page.locator('dialog.fs-dialog[open]').innerText()));
    await shot('desktop-request-result'); await readable(page, 'Honour result');
    await page.locator('dialog.fs-dialog[open]').getByRole('button', {name: 'Close'}).click();
    const honored = (await mcp.call('fernshelf.removals.list', {state: 'honored'})).removals.find(r => r.id === albumScoped.id);
    check('Honour: request honoured with the note', honored?.answers.at(-1).note === 'Taken out of the reunion album.'); await idle();
    await page.locator('[data-request-id="' + other.id + '"]').getByRole('button', {name: 'Decline…'}).click();
    await shownFields('Decline', ['note']); await submit(); await dialog.waitFor({state: 'hidden'});
    await until('declined', async () => (await mcp.call('fernshelf.removals.list', {state: 'declined'})).removals.some(r => r.id === other.id));
    check('Decline: request declined', true); await idle();
    // Showing an honoured item again is accepted, with a warning naming the requester.
    await select(albumScoped.item_ids[0]);
    await detailButton('Add to album').click();
    await dialog.getByRole('button', {name: /Browser trip/}).click();
    const warned = page.locator('dialog.fs-dialog[open]', {hasText: /Shown again to people who asked for removal/i}); await warned.waitFor();
    check('Re-sharing an honoured item shows the removal_honored warning', (await warned.innerText()).includes(albumScoped.from.display_name.split(' ')[0]) &&
      (await album(trip)).entries.some(e => e.id === albumScoped.item_ids[0]));
    await shot('desktop-warning'); await readable(page, 'Re-share warning');
    await warned.getByRole('button', {name: 'Close'}).click(); await idle();

    // W3 on a seeded shared album: role change, saving a contribution, a refused delete.
    await nav('Albums'); await page.locator('[data-album-id="al-reunion-2026"]').click(); await idle();
    await page.locator('.fs-person', {hasText: 'Kofi Darrow'}).getByRole('button', {name: 'Change role'}).click();
    await shownFields('Change role', ['role']);
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
    check('A refused delete (confirm_required) says what to do and changes nothing',
      /still shared\. Tick “Also end access”/.test(await refusal.innerText()) && (await album('al-reunion-2026')).deleted_at === null);
    await shot('desktop-refusal'); await readable(page, 'Refused delete');
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
    const p = await phone.newPage(); p.setDefaultTimeout(45000);
    p.on('pageerror', e => errors.push('phone pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push('phone console: ' + m.text()); });
    await p.goto(host.accessUrl); await p.locator('#app[aria-busy=false]').waitFor(); await p.locator('#records .fs-tile').first().waitFor();
    const overflow = async () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cut = await p.locator('nav button').evaluateAll(ns => ns.filter(n => { const r = n.getBoundingClientRect(); return r.left < 0 || r.right > window.innerWidth || n.scrollWidth > n.clientWidth; }).map(n => n.innerText));
    check('390 px: every navigation entry is shown whole', cut.length === 0, cut);
    for (const view of ['Photos', 'Albums', 'Requests', 'Storage', 'Trash']) {
      await p.locator('nav button').filter({hasText: view}).first().click(); await p.locator('#app[aria-busy=false]').waitFor();
      await p.waitForTimeout(300);
      check('390 px: ' + view + ' has no horizontal page overflow', await overflow() <= 0, await overflow());
      await shot('phone-' + view.toLowerCase(), p); await readable(p, '390 px ' + view);
    }
    await p.locator('nav button').filter({hasText: 'Photos'}).first().click(); await p.locator('#app[aria-busy=false]').waitFor();
    const phoneId = await p.locator('#records .fs-tile').nth(3).getAttribute('data-record-id');
    await p.locator('#records .fs-tile').nth(3).click(); await p.locator('.detail[data-selected-id="' + phoneId + '"]').waitFor();
    await p.waitForTimeout(600);
    check('390 px: tapping a photo scrolls to its panel', await p.locator('.detail .fs-photo h2').isVisible());
    await shot('phone-photo-detail', p, true);
    await p.locator('nav button').filter({hasText: 'Albums'}).first().click(); await p.locator('[data-album-id="al-reunion-2026"]').click(); await p.locator('#app[aria-busy=false]').waitFor();
    check('390 px: album page has no horizontal page overflow', await overflow() <= 0);
    await shot('phone-album', p, true); await readable(p, '390 px album page');
    await phone.close();
    for (const view of ['Albums', 'Sharing', 'Requests', 'Storage', 'Activity', 'Trash']) {
      await nav(view); await page.waitForTimeout(2500); await shot('desktop-' + view.toLowerCase()); await readable(page, '1280 px ' + view);
    }
    // Older notices are folded under "Earlier"; opening it shows them.
    await nav('Activity'); await page.locator('.fs-earlier summary').click();
    check('Activity: notices older than 90 days open from "Earlier"', await page.locator('.fs-earlier .notice').count() > 0); await readable(page, 'Activity with earlier notices');
    check('1280 px: no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await context.close();

    // Dialogs on a fresh run. A confirmation or chooser sends the version of the view it was drawn
    // from. When a later read shows that something changed elsewhere, the page reads the view again
    // behind the open dialog; confirming then shows the conflict and changes nothing.
    const drun = 'browser-dialogs', dh = await start({app: 'fernshelf', registry, run: drun, stateDir, profile: 'sandbox'}); hosts.push(dh);
    const dm = patient(await open('agent', drun)), di = patient(await open('infra', drun));
    const dalbum = async id => (await dm.call('fernshelf.albums.get', {id})).album, dversion = async () => (await di.call('env.snapshot')).version;
    const dc = await browser.newContext({viewport: {width: 1280, height: 900}}), q = await dc.newPage(); q.setDefaultTimeout(45000);
    q.on('pageerror', e => errors.push('dialogs pageerror: ' + e.message));
    q.on('console', m => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errors.push('dialogs console: ' + m.text()); });
    const sent = []; q.on('request', r => { if (r.url().endsWith('/api/call')) sent.push(r.postDataJSON()); });
    // A held read: the next "who can see this" read waits in the browser until released, so it is
    // answered after the change made elsewhere.
    let hold = null;
    await q.route('**/api/call', async route => { if (hold && !hold.taken && route.request().postDataJSON().name === 'fernshelf.exposure.get') { hold.taken = true; await hold.released; } await route.continue(); });
    const holdNext = () => { let release; hold = {taken: false, released: new Promise(r => { release = r; })}; hold.release = release; return hold; };
    const qIdle = () => q.locator('#app[aria-busy=false]').waitFor(), qDialog = q.locator('dialog[open]');
    const qNav = async label => { await q.locator('nav button').filter({hasText: label}).first().click(); await qIdle(); };
    const qAlbum = async title => { await qNav('Albums'); await q.locator('.fs-album-card').filter({hasText: title}).click(); await qIdle(); };
    // Open a photo with its exposure read held, then the dialog.
    const holdingPhoto = async id => { const h = holdNext(); await q.locator('#records [data-record-id="' + id + '"]').first().click(); await q.locator('.detail[data-selected-id="' + id + '"]').waitFor(); await until('held read', () => h.taken); return h; };
    // Release the held read and wait until the page has read its whole view again behind the dialog.
    const behind = async (h, what, shows) => {
      const n = sent.length; h.release();
      await until('view read again behind the dialog', () => sent.slice(n).some(b => b.name === 'fernshelf.account.get')); await qIdle();
      await until(what, shows);
      check(what + ' while the dialog stays open', await qDialog.count() === 1);
    };
    const staleOnConfirm = async (what, unchanged) => {
      await qDialog.locator('.form-error[data-code=stale_version]').waitFor();
      check(what + ': confirming shows the conflict and nothing is written', await unchanged());
      await qDialog.getByRole('button', {name: /^(Cancel|Close)$/}).click(); await qDialog.waitFor({state: 'hidden'}); await qIdle();
    };
    // Delete album, drawn for an album nobody sees; a link and a joined member are added elsewhere.
    // Nothing is held: at phone width the album's lower images load only when the list scrolls, so
    // scrolling it behind the dialog makes the page's own image reads answer with the newer version.
    await q.setViewportSize({width: 390, height: 500});
    await q.goto(dh.accessUrl); await qIdle(); await q.locator('#records .fs-tile').first().waitFor();
    const quiet = async () => { for (let n = -1; n !== sent.length;) { n = sent.length; await q.waitForTimeout(1200); } await qIdle(); };
    await qAlbum('Pip'); await quiet();
    await q.locator('.fs-album-head').getByRole('button', {name: 'Delete album'}).click();
    check('Delete album on an album nobody sees asks for no extra confirmation', await qDialog.locator('input[type=checkbox]').count() === 0);
    let dv = (await dm.call('fernshelf.links.create', {id: 'al-pip', expected_version: await dversion(), request_id: 'dialog-g-link'})).version;
    dv = (await dm.call('fernshelf.albums.members.invite', {id: 'al-pip', person_id: 'person-kofi', role: 'viewer', expected_version: dv, request_id: 'dialog-g-invite'})).version;
    assert.equal((await di.call('env.apply_event', {expected_version: await dversion(), event: {event_id: 'ev-web-g', at: '2026-11-20T09:30:00-08:00', operation: 'fernshelf.member.changed', payload: {album_id: 'al-pip', person_id: 'person-kofi', change: 'join'}}})).status, 'committed');
    await q.evaluate(() => { document.querySelector('#records').scrollTop = 1e5; });
    await until('Pip read again behind the dialog', async () => /Kofi Darrow[\s\S]*Joined/.test(await q.locator('.fs-sharing').innerText()));
    check('Delete album: the album page behind the dialog was read again and lists the member who joined elsewhere', await qDialog.count() === 1);
    await qDialog.getByRole('button', {name: 'Delete album'}).click();
    await staleOnConfirm('Delete album drawn before a link and a member were added elsewhere', async () => { const a = await dalbum('al-pip'); return a.deleted_at === null && a.links.some(l => l.state === 'active') && a.members.some(m => m.person_id === 'person-kofi' && m.status === 'joined'); });
    await q.setViewportSize({width: 1280, height: 900});

    // Delete album with the box ticked; Kofi is invited and joins elsewhere, then a held read is answered.
    await qAlbum('Winter visit');
    let h = await holdingPhoto((await dalbum('al-winter-visit')).entries[1].id);
    await q.locator('.fs-album-head').getByRole('button', {name: 'Delete album'}).click();
    check('Delete album is drawn with no joined member', /0 joined members and 1 active link/.test(await qDialog.innerText()));
    await qDialog.locator('input[type=checkbox]').check();
    assert.equal((await dm.call('fernshelf.albums.members.invite', {id: 'al-winter-visit', person_id: 'person-kofi', role: 'viewer', expected_version: await dversion(), request_id: 'dialog-b-invite'})).status, 'committed');
    assert.equal((await di.call('env.apply_event', {expected_version: await dversion(), event: {event_id: 'ev-web-b', at: '2026-11-20T09:31:00-08:00', operation: 'fernshelf.member.changed', payload: {album_id: 'al-winter-visit', person_id: 'person-kofi', change: 'join'}}})).status, 'committed');
    await behind(h, 'Delete album: the album page behind the dialog lists Kofi as joined', async () => /Kofi Darrow[\s\S]*Joined/.test(await q.locator('.fs-sharing').innerText()));
    await qDialog.getByRole('button', {name: 'Delete album'}).click();
    await staleOnConfirm('Delete album drawn before a member joined elsewhere', async () => { const a = await dalbum('al-winter-visit'); return a.deleted_at === null && a.links.some(l => l.state === 'active') && a.members.some(m => m.person_id === 'person-kofi' && m.status === 'joined'); });

    // Remove member, drawn before Kofi's role changes elsewhere.
    await qAlbum('Reunion 2026');
    h = await holdingPhoto((await dalbum('al-reunion-2026')).entries[0].id);
    await q.locator('.fs-sharing .fs-person', {hasText: 'Kofi Darrow'}).getByRole('button', {name: 'Remove'}).click();
    assert.equal((await dm.call('fernshelf.albums.members.update', {id: 'al-reunion-2026', person_id: 'person-kofi', role: 'contributor', expected_version: await dversion(), request_id: 'dialog-remove-role'})).status, 'committed');
    await behind(h, 'Remove member: the album page behind the dialog shows the new role', async () => (await q.locator('.fs-sharing .fs-person', {hasText: 'Kofi Darrow'}).first().innerText()).includes('Contributor'));
    await qDialog.getByRole('button', {name: 'Remove member'}).click();
    await staleOnConfirm('Remove member drawn before a change elsewhere', async () => (await dalbum('al-reunion-2026')).members.some(m => m.person_id === 'person-kofi' && m.status === 'joined'));

    // Revoke, drawn before the album is renamed elsewhere.
    h = await holdingPhoto((await dalbum('al-reunion-2026')).entries[0].id);
    await q.locator('.fs-sharing').getByRole('button', {name: 'Revoke', exact: true}).click();
    assert.equal((await dm.call('fernshelf.albums.update', {id: 'al-reunion-2026', title: 'Reunion 2026 (renamed elsewhere)', expected_version: await dversion(), request_id: 'dialog-revoke-rename'})).status, 'committed');
    await behind(h, 'Revoke: the album page behind the dialog shows the new title', async () => await q.locator('.fs-album-meta[data-album-title="Reunion 2026 (renamed elsewhere)"]').count() === 1);
    await qDialog.getByRole('button', {name: 'Revoke link'}).click();
    await staleOnConfirm('Revoke drawn before a change elsewhere', async () => (await dalbum('al-reunion-2026')).links.some(l => l.id === 'ln-0012' && l.state === 'active'));

    // Add to album (the chooser), drawn before the chosen album changes elsewhere.
    await qNav('Photos');
    const bestIds = new Set((await dalbum('al-best-2026')).entries.map(e => e.id));
    const loose = (await q.locator('#records .fs-tile').evaluateAll(n => n.map(x => x.dataset.recordId))).find(id => !bestIds.has(id));
    h = await holdingPhoto(loose);
    await q.locator('.detail').getByRole('button', {name: 'Add to album', exact: true}).click();
    assert.equal((await dm.call('fernshelf.albums.update', {id: 'al-best-2026', title: 'Best of 2026 (renamed elsewhere)', expected_version: await dversion(), request_id: 'dialog-choose-rename'})).status, 'committed');
    await behind(h, 'Add to album: the view behind the chooser was read again', async () => true);
    await qDialog.getByRole('button', {name: /Best of 2026/}).click();
    await staleOnConfirm('Add to album drawn before the album changed elsewhere', async () => !(await dalbum('al-best-2026')).entries.some(e => e.id === loose));

    // Delete forever, drawn before the item is restored elsewhere.
    await qNav('Trash');
    const binned = await q.locator('#records .fs-tile').first().getAttribute('data-record-id');
    h = await holdingPhoto(binned);
    await q.locator('.detail').getByRole('button', {name: 'Delete forever', exact: true}).click();
    assert.equal((await dm.call('fernshelf.items.restore', {ids: [binned], expected_version: await dversion(), request_id: 'dialog-purge-restore'})).status, 'committed');
    await behind(h, 'Delete forever: the trash behind the dialog no longer lists the restored item', async () => await q.locator('#records [data-record-id="' + binned + '"]').count() === 0);
    await qDialog.getByRole('button', {name: 'Delete forever'}).click();
    await staleOnConfirm('Delete forever drawn before the item was restored elsewhere', async () => (await dm.call('fernshelf.items.get', {id: binned})).item.state === 'active');
    await readable(q, 'Dialogs after conflicts');
    await dc.close();

    // Restricted profile on a fresh run: no write controls, reads and images still work.
    const restricted = await start({app: 'fernshelf', registry, run: 'browser-restricted', stateDir, profile: 'scenario'}); hosts.push(restricted);
    const rc = await browser.newContext({viewport: {width: 1280, height: 900}}), r = await rc.newPage(); r.setDefaultTimeout(45000);
    r.on('pageerror', e => errors.push('restricted pageerror: ' + e.message));
    await r.goto(restricted.accessUrl); await r.locator('#app[aria-busy=false]').waitFor(); await r.locator('.detail[data-selected-id]').waitFor();
    await until('restricted thumbnails', () => r.locator('#records .fs-tile img').count());
    const writes = ['New album', 'Edit details', 'Add to album', 'Move to trash', 'Archive', 'Select'];
    const present = []; for (const name of writes) if (await r.getByRole('button', {name, exact: true}).count()) present.push(name);
    check('Restricted profile: no write controls on the photo view', present.length === 0, present);
    check('Restricted profile: no people editor', await r.locator('.detail select[aria-label="Add a person"]').count() === 0);
    await r.locator('nav button').filter({hasText: 'Requests'}).first().click(); await r.locator('#app[aria-busy=false]').waitFor();
    check('Restricted profile: requests are readable but cannot be answered', await r.locator('[data-request-id]').count() > 0 && await r.getByRole('button', {name: 'Honour…'}).count() === 0);
    await r.locator('nav button').filter({hasText: 'Albums'}).first().click(); await r.locator('[data-album-id="al-reunion-2026"]').click(); await r.locator('#app[aria-busy=false]').waitFor();
    await r.locator('.fs-album-meta[data-album-title="Reunion 2026"]').waitFor(); await r.locator('.fs-sharing .fs-person').first().waitFor();
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
