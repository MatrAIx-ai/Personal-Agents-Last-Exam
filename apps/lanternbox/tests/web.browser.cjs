#!/usr/bin/env node
'use strict';
// Browser acceptance for Lanternbox's page on the shared Web Host: real clicks in Chromium, and every
// write read back through a separate Infra MCP connection. Needs the PALE checkout and its Playwright.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let root = __dirname;
while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) { const parent = path.dirname(root); if (parent === root) throw Error('Run inside the public PALE checkout.'); root = parent; }
const {chromium} = require('playwright');
const {start} = require(path.join(root, 'runtime/web/server.cjs')), {Client} = require(path.join(root, 'runtime/client.cjs'));
const registry = path.resolve(__dirname, '../registry.json'), APP = 'lanternbox';
const out = path.resolve(process.env.LANTERNBOX_WEB_REPORT_DIR || path.join(root, '.artifacts/lanternbox-web'));
const checks = [];
const check = (name, ok = true) => { assert.ok(ok, name); checks.push(name); };

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanternbox-web-'));
  const browser = await chromium.launch({headless: true});
  let host, readOnly, infra;
  try {
    host = await start({app: APP, registry, stateDir, run: 'browser'});
    infra = new Client(APP, 'infra', host.run, stateDir, 'lanternbox-web-inspector', {registry}); await infra.initialize();
    const data = async () => (await infra.call('env.snapshot')).snapshot.data;
    const context = await browser.newContext({viewport: {width: 1280, height: 900}}), page = await context.newPage(); page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const settle = async () => { await page.waitForFunction(() => /^Account |Saved/.test(document.querySelector('#status').textContent)); await page.waitForTimeout(150); };
    const view = async id => { await page.click('[data-view=' + id + ']'); await settle(); };
    const open = async id => { await page.click('[data-record-id="' + id + '"]'); await settle(); };
    const as = async id => { await page.selectOption('select[name=viewing-as]', id); await settle(); };
    const episode = id => page.locator('article', {has: page.locator('[data-playable-id="' + id + '"]')});
    const save = async () => { await page.click('dialog button[type=submit]'); await page.waitForFunction(() => !document.querySelector('dialog').open); await settle(); };
    const refusal = async code => { await page.click('dialog button[type=submit]'); await page.waitForFunction(c => document.querySelector('dialog [role=alert]').textContent.includes(c), code); };
    const closeForm = () => page.click('dialog button[type=button]');
    const row = async (profile, playable) => (await data()).progress.find(r => r.profile_id === profile && r.playable_id === playable);
    await page.goto(host.accessUrl); await settle();
    check('The page opens on the catalog as the account holder and names the account', /Account lanternbox-okoro · standard plan · active/.test(await page.textContent('#status')) && await page.inputValue('select[name=viewing-as]') === 'prof-sana');
    check('The access token is removed from the address bar', !page.url().includes('access='));

    // W1 and W2: one series seen as two profiles; marking, positions and lists with real controls.
    await open('ttl-harbor-lights');
    check('As Sana, every released episode is watched: nothing is next', /nothing new to watch/.test(await page.textContent('.detail')));
    await as('prof-dele');
    check('As Dele, the same series is next up at season 2, episode 4', /Season 2, episode 4 · Spring Tide/.test(await page.textContent('.detail')) && /not started/.test(await episode('ep-harbor-s2e04').textContent()));
    const viewings = (await data()).history.length;
    await episode('ep-harbor-s2e04').locator('button', {hasText: 'Mark watched'}).click(); await save();
    let stored = await row('prof-dele', 'ep-harbor-s2e04');
    check('Mark watched stores the progress as set by hand and adds no viewing', stored && stored.completed && stored.set_by === 'agent' && (await data()).history.length === viewings && /marked by hand/.test(await episode('ep-harbor-s2e04').textContent()));
    await episode('ep-harbor-s2e05').locator('button', {hasText: 'Set position'}).click(); await page.fill('dialog [name=position]', '600'); await save();
    stored = await row('prof-dele', 'ep-harbor-s2e05');
    check('Set position stores the position for that profile only', stored.position_seconds === 600 && !stored.completed && (await row('prof-sana', 'ep-harbor-s2e05')).set_by === 'playback');
    await episode('ep-harbor-s2e05').locator('button', {hasText: 'Set position'}).click(); await page.fill('dialog [name=position]', '99999');
    const beforeRefusal = JSON.stringify(await data());
    await refusal('invalid_position');
    check('A refused write stays visible in the form and changes nothing', JSON.stringify(await data()) === beforeRefusal);
    await closeForm();
    await open('ttl-paper-kites');
    await page.click('[data-action="watchlist.add"]'); await save();
    check('Add to watchlist stores the entry on the chosen profile', (await data()).watchlist.some(w => w.profile_id === 'prof-dele' && w.title_id === 'ttl-paper-kites') && await page.locator('.detail [data-action="watchlist.remove"]').count() === 1);
    await page.click('.detail [data-action="watchlist.remove"]'); await save();
    check('Remove from watchlist removes it', !(await data()).watchlist.some(w => w.profile_id === 'prof-dele' && w.title_id === 'ttl-paper-kites'));
    await as('prof-timi');
    const shown = await page.locator('.collection .record-subtitle').allTextContents();
    check('As the kids profile the catalog leaves out everything above 7+', shown.length === 19 && shown.every(text => / · (all|7\+) · /.test(text)) && await page.textContent('.collection-count') === '19');
    await as('prof-dele');

    // W3: profiles and devices.
    await view('profiles');
    await page.click('[data-action="profiles.create"]'); await page.fill('dialog [name=name]', 'Ola'); await page.selectOption('dialog [name=kind]', 'kids');
    await refusal('limit_reached');
    check('A fifth profile on a four-profile plan is refused in the form', (await data()).profiles.length === 4);
    await closeForm();
    await open('prof-bisi');
    await page.click('[data-action="profiles.delete"]'); await page.waitForSelector('dialog[open] form');
    check('The delete form says what it will remove', /31 viewings, 9 progress rows and 4 list entries/.test(await page.textContent('dialog')));
    await save();
    let now = await data();
    check('Delete profile removes the profile with its rows and records the counts', !now.profiles.some(p => p.profile_id === 'prof-bisi') && !now.history.some(h => h.profile_id === 'prof-bisi') &&
      JSON.stringify(now.activity.at(-1).removed) === JSON.stringify({history_rows: 31, progress_rows: 9, watchlist_entries: 4}));
    const hostile = '<img src=x onerror="window.injected=1">';
    await page.click('[data-action="profiles.create"]'); await page.fill('dialog [name=name]', hostile); await page.selectOption('dialog [name=kind]', 'kids'); await save();
    let made = (await data()).profiles.find(p => p.name === hostile);
    check('New profile creates a kids profile with the 7+ ceiling', made && made.kind === 'kids' && made.maturity_ceiling === '7+' && made.profile_id === 'prof-r1');
    await open(made.profile_id);
    check('Text that looks like HTML is shown as text and never runs', (await page.locator('[data-profile-id="prof-r1"]').textContent()).startsWith(hostile) && await page.evaluate(() => window.injected === undefined) && await page.locator('.detail img, .collection img').count() === 0);
    await page.click('[data-action="profiles.update"]'); await page.selectOption('dialog [name=ceiling]', '13+');
    await refusal('invalid_ceiling');
    await page.selectOption('dialog [name=ceiling]', '7+'); await page.fill('dialog [name=name]', 'Ola'); await page.selectOption('dialog [name=autoplay]', 'false'); await save();
    made = (await data()).profiles.find(p => p.profile_id === 'prof-r1');
    check('Edit profile refuses a kids ceiling above 7+ and then saves the corrected form', made.name === 'Ola' && made.autoplay === false && made.maturity_ceiling === '7+');
    await open('prof-sana');
    const first = await page.locator('.detail [data-history-id]').first().getAttribute('data-history-id');
    await page.locator('[data-history-id="' + first + '"] [data-action="history.hide"]').click(); await save();
    check('Hide stores the flag and takes the viewing out of the default list', (await data()).history.find(h => h.history_id === first).hidden === true && await page.locator('[data-history-id="' + first + '"]').count() === 0);
    await page.check('#show-hidden'); await settle(); await page.waitForSelector('[data-history-id="' + first + '"]');
    await page.locator('[data-history-id="' + first + '"] [data-action="history.hide"]').click(); await save();
    check('With hidden viewings shown, Unhide restores it', (await data()).history.find(h => h.history_id === first).hidden === false);
    await view('account');
    await page.locator('[data-device-id="dev-sana-phone"] [data-action="devices.sign_out"]').click(); await save();
    check('Sign out is stored and the button goes away', (await data()).devices.find(d => d.device_id === 'dev-sana-phone').status === 'signed_out' && await page.locator('[data-device-id="dev-sana-phone"] [data-action]').count() === 0);

    // W4: plan and billing.
    await page.locator('[data-plan-id="basic"] [data-action="plan.change"]').click();
    await refusal('too_many_profiles');
    check('A downgrade with too many profiles is refused in the form', (await data()).account.pending === null);
    await closeForm();
    await page.locator('[data-plan-id="premium"] [data-action="plan.change"]').click(); await save();
    check('An upgrade takes effect at once', (await data()).account.plan_id === 'premium' && /Premium · \$22\.99 a month/.test(await page.textContent('.detail')));
    await page.locator('[data-plan-id="standard"] [data-action="plan.change"]').click(); await save();
    now = await data();
    check('A downgrade is stored as pending and shown with its date', now.account.plan_id === 'premium' && now.account.pending.plan_id === 'standard' && /downgrade to Standard at 2026-12-03 00:00/.test(await page.textContent('.detail')));
    await page.click('[data-action="plan.resume"]'); await save();
    check('Undo pending change clears it', (await data()).account.pending === null && await page.locator('[data-action="plan.resume"]').count() === 0);
    await page.click('[data-action="plan.cancel"]'); await save();
    check('Cancel plan stores a pending cancellation and the account stays active', (await data()).account.pending.kind === 'cancel' && /cancellation at 2026-12-03 00:00/.test(await page.textContent('.detail')) && /active$/.test(await page.textContent('[data-account-id]')));
    await page.click('[data-action="plan.resume"]'); await save();

    // Reload keeps committed state; an Infra event appears after Refresh.
    await page.reload(); await settle();
    check('A reload shows the same committed state', /Premium · \$22\.99 a month/.test(await page.textContent('.detail')) && /signed out/.test(await page.textContent('[data-device-id="dev-sana-phone"]')));
    let snap = await infra.call('env.snapshot');
    check('Infra applies a scenario event', (await infra.call('env.apply_event', {expected_version: snap.version, event: {...require('../examples/scenario.json')}})).status === 'committed');
    await view('notifications');
    check('The event\'s notification appears after a refresh', /New episode of Harbor Lights: season 2, episode 6, "Low Tide"/.test(await page.textContent('.detail')));
    await view('browse'); await as('prof-sana'); await open('ttl-harbor-lights');
    check('…and the new episode is next up for the profile that had finished the season', /Season 2, episode 6 · Low Tide/.test(await page.textContent('.detail')));

    // A stale form reports the conflict and changes nothing.
    await view('profiles'); await open('prof-dele');
    await page.click('[data-action="profiles.update"]'); await page.fill('dialog [name=name]', 'Written in a stale form');
    snap = await infra.call('env.snapshot');
    await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'web-stale', at: '2026-11-22T23:18:00-05:00', operation: 'lanternbox.device.signed_in', payload: {device_id: 'dev-tablet-02', name: 'Android tablet', kind: 'tablet'}}});
    const mid = JSON.stringify(await data());
    await refusal('stale_version');
    check('A form opened before another change reports the conflict and saves nothing', JSON.stringify(await data()) === mid && await page.evaluate(() => document.querySelector('dialog').open));
    await closeForm();

    // A retry after a lost response has exactly one effect.
    await view('browse'); await as('prof-dele'); await open('ttl-marigold-station');
    await page.click('[data-action="watchlist.add"]');
    let dropped = 0;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (body.name === 'lanternbox.watchlist.add' && dropped === 0) { dropped = 1; await route.fetch(); return route.abort(); }   // the server commits; the browser never hears back
      return route.continue();
    });
    await page.click('dialog button[type=submit]');
    await page.waitForFunction(() => document.querySelector('dialog [role=alert]').textContent.length > 0);
    const entries = async () => (await data()).watchlist.filter(w => w.profile_id === 'prof-dele' && w.title_id === 'ttl-marigold-station').length;
    const rows = (await data()).activity.length;
    check('The write was committed although its response was lost', await entries() === 1);
    await save();
    await page.unroute('**/api/call');
    check('The unchanged retry reuses its request ID: still one entry and no second activity row', await entries() === 1 && (await data()).activity.length === rows);

    // Time alone: Infra moves the clock, the page reads the new status after Refresh.
    snap = await infra.call('env.snapshot');
    await infra.call('env.advance_time', {expected_version: snap.version, virtual_now: '2026-12-03T00:00:00-05:00', request_id: 'web-clock'});
    await view('account');
    check('After the clock passes paid_through the page reads past due and says when the account suspends', / · past due · /.test(await page.textContent('#status')) && /Suspends at\s*2026-12-10 00:00/.test(await page.textContent('.detail')));

    // Management stays out of reach, even when requested directly from the page.
    const direct = await page.evaluate(async () => { const {csrf} = await (await fetch('/session')).json();
      const r = await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name: 'env.snapshot', arguments: {}})}); return {status: r.status, body: await r.json()}; });
    check('A direct env.snapshot request from the page is refused', direct.status === 403 && !('snapshot' in direct.body));
    check('The page offers no management control', await page.locator('text=/snapshot|load seed|reset|apply event|advance time/i').count() === 0);

    // Narrow layout.
    await page.setViewportSize({width: 390, height: 800}); await page.click('#refresh'); await settle();
    check('At 390 px nothing overflows sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({path: path.join(out, 'narrow.png')});
    await page.setViewportSize({width: 1280, height: 900}); await page.click('#refresh'); await settle(); await page.screenshot({path: path.join(out, 'account.png')});
    await view('profiles'); await page.screenshot({path: path.join(out, 'profiles.png')});
    await view('browse'); await open('ttl-harbor-lights'); await page.screenshot({path: path.join(out, 'browse.png')});
    check('No JavaScript error was raised', errors.length === 0);

    // A read-only profile: the same page shows no write control.
    readOnly = await start({app: APP, registry, stateDir, run: 'browser-readonly', profile: 'scenario'});
    const quiet = await context.newPage(); await quiet.goto(readOnly.accessUrl); await quiet.waitForFunction(() => /^Account /.test(document.querySelector('#status').textContent));
    await quiet.click('[data-record-id="ttl-harbor-lights"]'); await quiet.waitForSelector('[data-playable-id]');
    check('Under the read-only profile the page offers no write button', await quiet.locator('[data-action]').count() === 0 && await quiet.locator('.detail [data-playable-id]').count() === 13);
    const report = {schema: 'lanternbox.web-acceptance.v1', app: APP, node: process.version, browser: browser.version(), passed: true, checks};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  } catch (e) { console.error(JSON.stringify({app: APP, passed: false, completed: checks, error: e.message}, null, 2)); process.exitCode = 1; }
  finally { await browser.close(); await infra?.close(); await host?.close(); await readOnly?.close(); fs.rmSync(stateDir, {recursive: true, force: true}); }
})();
