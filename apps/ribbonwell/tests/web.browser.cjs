#!/usr/bin/env node
'use strict';
// Browser acceptance for Ribbonwell's page on the shared Web Host: real clicks in Chromium, and every
// write read back through a separate Infra MCP connection. Needs the PALE checkout and its Playwright.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let root = __dirname;
while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) { const parent = path.dirname(root); if (parent === root) throw Error('Run inside the public PALE checkout.'); root = parent; }
const {chromium} = require('playwright');
const {start} = require(path.join(root, 'runtime/web/server.cjs')), {Client} = require(path.join(root, 'runtime/client.cjs'));
const registry = path.resolve(__dirname, '../registry.json'), APP = 'ribbonwell';
const out = path.resolve(process.env.RIBBONWELL_WEB_REPORT_DIR || path.join(root, '.artifacts/ribbonwell-web'));
const checks = [];
const check = (name, ok = true) => { assert.ok(ok, name); checks.push(name); };

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ribbonwell-web-'));
  const browser = await chromium.launch({headless: true});
  let host, readOnly, infra;
  try {
    host = await start({app: APP, registry, stateDir, run: 'browser'});
    infra = new Client(APP, 'infra', host.run, stateDir, 'ribbonwell-web-inspector', {registry}); await infra.initialize();
    const data = async () => (await infra.call('env.snapshot')).snapshot.data;
    const context = await browser.newContext({viewport: {width: 1280, height: 900}}), page = await context.newPage(); page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const settle = async () => { await page.waitForFunction(() => /Signed in|Saved/.test(document.querySelector('#status').textContent)); };
    const view = async id => { await page.click('[data-view=' + id + ']'); await settle(); await page.waitForTimeout(150); };
    const openList = async id => { await page.click('[data-record-id="' + id + '"]'); await settle(); await page.waitForTimeout(150); };
    const itemCard = id => page.locator('article', {has: page.locator('[data-item-id="' + id + '"]')});
    const save = async () => { await page.click('dialog button[type=submit]'); await page.waitForFunction(() => !document.querySelector('dialog').open); await settle(); };
    await page.goto(host.accessUrl); await settle();
    check('The page opens on the member\'s own list and names the signed-in member', /Priya Raman/.test(await page.textContent('#status')) && /Priya Raman’s list/.test(await page.textContent('.detail h2')));
    check('The access token is removed from the address bar', !page.url().includes('access='));
    check('The own list shows no claim line and no Reserve button', await page.locator('.detail [data-claim-id]').count() === 0 && await page.locator('.detail [data-action="claims.reserve"]').count() === 0);

    // W2: add, edit, remove and restore an item with real controls.
    const hostile = '<img src=x onerror="window.injected=true">';
    await page.click('[data-action="items.add"]'); await page.fill('dialog [name=name]', hostile); await page.fill('dialog [name=price]', '2100'); await save();
    let added = (await data()).items.find(i => i.name === hostile);
    check('Add item writes the item the form described', added && added.list_id === 'lst-priya-family' && added.price_cents === 2100 && added.status === 'listed');
    check('Text that looks like HTML is shown as text and never runs', await page.locator('[data-item-id="' + added.item_id + '"]').textContent() === hostile && await page.evaluate(() => window.injected === undefined) && await page.locator('.detail img').count() === 0);
    await itemCard(added.item_id).locator('[data-action="items.update"]').click(); await page.fill('dialog [name=name]', 'Trail running vest'); await page.fill('dialog [name=variant]', 'size M'); await save();
    added = (await data()).items.find(i => i.item_id === added.item_id);
    check('Edit changes the same item', added.name === 'Trail running vest' && added.variant === 'size M');
    await itemCard(added.item_id).locator('[data-action="items.remove"]').click(); await save();
    check('Remove marks the item removed and hides it', (await data()).items.find(i => i.item_id === added.item_id).status === 'removed' && await page.locator('[data-item-id="' + added.item_id + '"]').count() === 0);
    await page.check('#show-removed'); await settle(); await page.waitForSelector('[data-item-id="' + added.item_id + '"]');
    await itemCard(added.item_id).locator('[data-action="items.restore"]').click(); await save();
    check('Restore lists it again', (await data()).items.find(i => i.item_id === added.item_id).status === 'listed');
    await page.click('[data-action="items.add"]'); await page.fill('dialog [name=name]', ' trail RUNNING vest '); await page.click('dialog button[type=submit]');
    await page.waitForFunction(() => document.querySelector('dialog [role=alert]').textContent.includes('name_taken'));
    check('A refused write stays visible in the form and changes nothing', (await data()).items.filter(i => /trail running vest/i.test(i.name)).length === 1);
    await page.click('dialog button[type=button]');

    // W3: reserve on someone else's list, then buy and release from My claims.
    await openList('lst-tomas-family');
    const target = (await data()).items.find(i => i.name === 'Cast-iron skillet');
    check('Someone else\'s list shows who holds a claim', /Kamala Raman/.test(await itemCard(target.item_id).textContent()) && await itemCard(target.item_id).locator('[data-action="claims.reserve"]').count() === 1);
    const now = await data(), free = now.items.find(i => i.list_id === 'lst-tomas-family' && i.status === 'listed' && !now.claims.some(c => c.item_id === i.item_id && c.status !== 'released'));
    await itemCard(free.item_id).locator('[data-action="claims.reserve"]').click(); await page.fill('dialog [name=note]', 'Check the colour first.'); await save();
    let claim = (await data()).claims.find(c => c.item_id === free.item_id && c.member_id === 'mem-priya');
    check('Reserve creates the claim with a 14-day hold and the private note', claim && claim.status === 'reserved' && claim.note === 'Check the colour first.' && Date.parse(claim.reserved_until) - Date.parse(claim.created_at) === 14 * 86400000);
    await view('claims');
    const claimCard = id => page.locator('article', {has: page.locator('[data-claim-id="' + id + '"]')});
    await claimCard(claim.claim_id).locator('button', {hasText: 'Mark purchased'}).click(); await save();
    check('Mark purchased is stored', (await data()).claims.find(c => c.claim_id === claim.claim_id).status === 'purchased');
    await claimCard(claim.claim_id).locator('[data-action="claims.release"]').click(); await save();
    check('Release is stored', (await data()).claims.find(c => c.claim_id === claim.claim_id).status === 'released');

    // W4: join an exchange and create one.
    await view('exchanges'); await openList('exc-family-cookies');
    await page.click('[data-action="exchanges.join"]'); await save();
    check('Join is stored', (await data()).exchanges.find(x => x.exchange_id === 'exc-family-cookies').participant_ids.includes('mem-priya'));
    await page.click('[data-action="exchanges.create"]'); await page.fill('dialog [name=name]', 'Raman family draw'); await page.fill('dialog [name=budget]', '4000');
    await page.fill('dialog [name=join_by]', '2026-11-30T23:59:00-05:00'); await page.fill('dialog [name=date]', '2026-12-24T18:00:00-05:00'); await page.fill('dialog [name=exclusions]', 'mem-priya, mem-tomas'); await save();
    const made = (await data()).exchanges.find(x => x.name === 'Raman family draw');
    check('New exchange is stored with its exclusion and the member as organizer', made && made.organizer_member_id === 'mem-priya' && JSON.stringify(made.exclusions) === '[["mem-priya","mem-tomas"]]' && made.budget_cents === 4000);
    await openList(made.exchange_id);
    check('The organizer sees why a draw is not ready', /not ready: too_few_participants/.test(await page.textContent('.detail')));

    // Reload keeps committed state; an Infra event appears after Refresh.
    await page.reload(); await settle();
    check('A reload shows the same committed state', /Raman family draw/.test(await page.textContent('.collection')));
    const snap = await infra.call('env.snapshot');
    const event = {...require('../examples/scenario.json')};
    check('Infra applies a scenario event', (await infra.call('env.apply_event', {expected_version: snap.version, event})).status === 'committed');
    await view('notifications');
    check('The event\'s notification appears after a refresh', /Enamel camp mug/.test(await page.textContent('.detail')));

    // A stale form reports the conflict and changes nothing.
    await view('lists'); await openList('lst-priya-family');
    await itemCard(added.item_id).locator('[data-action="items.update"]').click(); await page.fill('dialog [name=note]', 'written in a stale form');
    const before = await infra.call('env.snapshot');
    await infra.call('env.apply_event', {expected_version: before.version, event: {event_id: 'web-stale', at: '2026-11-24T20:00:00-05:00', operation: 'ribbonwell.item.changed', payload: {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-031', patch: {note: 'Dishwasher safe.'}}}});
    const mid = JSON.stringify(await data());
    await page.click('dialog button[type=submit]');
    await page.waitForFunction(() => document.querySelector('dialog [role=alert]').textContent.includes('stale_version'));
    check('A form opened before another change reports the conflict and saves nothing', JSON.stringify(await data()) === mid && await page.evaluate(() => document.querySelector('dialog').open));
    await page.click('dialog button[type=button]');

    // A retry after a lost response has exactly one effect.
    await page.click('#refresh'); await settle();
    await page.click('[data-action="items.add"]'); await page.fill('dialog [name=name]', 'Lost-response candle');
    let dropped = 0;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (body.name === 'ribbonwell.items.add' && dropped === 0) { dropped = 1; await route.fetch(); return route.abort(); }   // the server commits; the browser never hears back
      return route.continue();
    });
    await page.click('dialog button[type=submit]');
    await page.waitForFunction(() => document.querySelector('dialog [role=alert]').textContent.length > 0);
    check('The write was committed although its response was lost', (await data()).items.filter(i => i.name === 'Lost-response candle').length === 1);
    await save();
    await page.unroute('**/api/call');
    check('The unchanged retry reuses its request ID: still exactly one item', (await data()).items.filter(i => i.name === 'Lost-response candle').length === 1 && /Lost-response candle/.test(await page.textContent('.detail')));

    // Management stays out of reach, even when requested directly from the page.
    const direct = await page.evaluate(async () => { const {csrf} = await (await fetch('/session')).json();
      const r = await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name: 'env.snapshot', arguments: {}})}); return {status: r.status, body: await r.json()}; });
    check('A direct env.snapshot request from the page is refused', direct.status === 403 && !('snapshot' in direct.body));
    check('The page offers no management control', await page.locator('text=/snapshot|load seed|reset|apply event/i').count() === 0);

    // Narrow layout.
    await page.setViewportSize({width: 390, height: 800}); await page.click('#refresh'); await settle();
    check('At 390 px nothing overflows sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({path: path.join(out, 'narrow.png')});
    await page.setViewportSize({width: 1280, height: 900}); await view('exchanges'); await page.screenshot({path: path.join(out, 'exchanges.png')});
    await view('lists'); await page.screenshot({path: path.join(out, 'lists.png')});
    check('No JavaScript error was raised', errors.length === 0);

    // A read-only profile: the same page shows no write control.
    readOnly = await start({app: APP, registry, stateDir, run: 'browser-readonly', profile: 'scenario'});
    const quiet = await context.newPage(); await quiet.goto(readOnly.accessUrl); await quiet.waitForFunction(() => /Signed in/.test(document.querySelector('#status').textContent));
    check('Under the read-only profile the page offers no write button', await quiet.locator('[data-action]').count() === 0 && await quiet.locator('.detail [data-item-id]').count() > 0);
    const report = {schema: 'ribbonwell.web-acceptance.v1', app: APP, node: process.version, browser: browser.version(), passed: true, checks};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  } catch (e) { console.error(JSON.stringify({app: APP, passed: false, completed: checks, error: e.message}, null, 2)); process.exitCode = 1; }
  finally { await browser.close(); await infra?.close(); await host?.close(); await readOnly?.close(); fs.rmSync(stateDir, {recursive: true, force: true}); }
})();
