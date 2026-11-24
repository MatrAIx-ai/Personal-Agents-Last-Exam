#!/usr/bin/env node
'use strict';
// Drives Switchback's nine pages in Chromium on the public business Web Host
// and compares what they show with the same Agent tools and Infra snapshots.
// Needs the repository's dev dependency: npm ci && npx playwright install chromium
// Run from a full checkout: node apps/switchback/tests/browser.cjs
// Screenshots and a report go to .artifacts/web/switchback/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const {chromium} = require('playwright');
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const out = path.join(root, '.artifacts/web/switchback');

(async () => {
  fs.mkdirSync(out, {recursive: true});
  // A disposable registry whose initial_time is fixtures/clock.json (2027-05-20).
  const prepared = prepare(path.join(root, 'apps/switchback'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchback-browser-'));
  const browser = await chromium.launch({headless: true});
  const checks = [], errors = [], report = {app: 'switchback', checked_at: new Date().toISOString(), node: process.version, browser: browser.version(), checks, passed: false};
  const record = (name, condition = true) => { assert.ok(condition, name); checks.push(name); };
  let host, infra, context, page;
  try {
    host = await start({app: 'switchback', registry: prepared.registry, stateDir, run: 'browser', profile: 'sandbox'});
    infra = new Client('switchback', 'infra', 'browser', stateDir, 'switchback-browser-inspector', {registry: prepared.registry});
    await infra.initialize();
    const agent = (name, args = {}) => host.client.call('switchback.' + name, args);
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot.data;
    context = await browser.newContext({viewport: {width: 1280, height: 900}});
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const go = async (hash, name) => { await page.evaluate(h => { location.hash = h; }, hash); await page.locator(`#page[data-page=${name}]`).waitFor(); await idle(); };
    const text = () => page.locator('#page').innerText();
    // A page action ends by printing its success line after the write and re-read.
    const done = async message => { await page.locator('#status').filter({hasText: message}).waitFor(); await idle(); };
    const shots = [];
    const shot = async name => { await page.screenshot({path: path.join(out, name + '.png'), fullPage: true}); shots.push(name + '.png'); };
    const errorCode = async () => { await page.locator('#status[data-error=true]').waitFor(); return page.locator('#status').getAttribute('data-error-code'); };

    await page.goto(host.accessUrl);
    await page.locator('#page[data-page=search]').waitFor(); await idle();
    record('Host serves the Switchback controller; the search page loads');
    const icons = await page.locator('img[data-icon]').evaluateAll(list => list.map(i => i.complete && i.naturalWidth === 24));
    record('PNG icons load from blob: URLs under the Host content policy', icons.length > 0 && icons.every(Boolean));
    const facilities = (await agent('facilities.search')).facilities;
    record('Search page lists the facilities facilities.search returns',
      JSON.stringify(await page.locator('[data-facility-id]').evaluateAll(l => l.map(e => e.dataset.facilityId))) === JSON.stringify(facilities.map(f => f.id)));

    // Workflow 1: the filters, and the same sites the tool returns.
    const form = page.getByRole('form', {name: 'Site search'});
    await form.locator('[name=facility_id]').selectOption('cedar-flat');
    await form.locator('[name=arrival]').fill('2027-06-25'); await form.locator('[name=departure]').fill('2027-06-27');
    await form.locator('[name=electric_min_amps]').selectOption('30'); await form.locator('[name=min_vehicle_ft]').fill('26');
    await form.locator('[name=available_only]').check();
    await form.getByRole('button', {name: 'Search sites'}).click(); await page.locator('#site-results h3').waitFor();
    const shown = await page.locator('#site-results [data-site-id]').evaluateAll(l => l.map(e => e.dataset.siteId));
    const tool = (await agent('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27', electric_min_amps: 30, min_vehicle_ft: 26, available_only: true})).sites.map(s => s.id);
    record('Filtered site results match sites.search', JSON.stringify(shown) === JSON.stringify(tool) && shown.length > 0);
    await shot('1-search');
    await go('#/facility/cedar-flat', 'facility');
    record('Facility page shows an unknown attribute as unknown', (await page.locator('tr[data-site-id=cf-C07] td[data-attr=vehicle]').innerText()).includes('unknown'));
    await shot('2-facility');
    await go('#/site/cf-B12/2027-06-25/2027-06-27', 'site');
    const nights = (await agent('sites.get', {site_id: 'cf-B12', arrival: '2027-06-25', departure: '2027-06-27'})).nights;
    record('Site page night states match sites.get', JSON.stringify(await page.locator('[data-night]').evaluateAll(l => l.map(e => ({date: e.dataset.night, state: e.dataset.state})))) === JSON.stringify(nights));
    await shot('3-site');

    // A named error through the page: a booked night.
    await go('#/site/cf-B14/2027-06-18/2027-06-20', 'site');
    await page.locator('[data-action=hold]').click();
    record('A hold on a booked night shows site_taken', await errorCode() === 'site_taken');

    // Workflow 2: hold, preview with the stale saved defaults, then the right card.
    await go('#/site/cf-B12/2027-06-25/2027-06-27', 'site');
    await page.locator('[data-action=hold]').click(); await page.locator('#page[data-page=checkout]').waitFor(); await idle();
    await page.locator('[data-action=preview]').click(); await done('Preview ready.');
    let preview = (await snapshot()).previews.at(-1);
    record('Checkout pre-fills the saved defaults: another person\'s card and the old trailer',
      preview.card_id === 'card-carol-visa' && preview.equipment.id === 'equip-0001' && (await text()).includes('Carol Okafor'));
    await page.getByRole('form', {name: 'Checkout details'}).locator('[name=card_id]').selectOption('card-dana-visa');
    await page.locator('[data-action=preview]').click(); await page.locator(`[data-preview-id]:not([data-preview-id="${preview.id}"])`).waitFor(); await idle();
    preview = (await snapshot()).previews.at(-1);
    record('The preview shows the tool\'s total, ladder and paying card', preview.card_id === 'card-dana-visa' &&
      (await page.locator('[data-total]').getAttribute('data-total')) === String(preview.total_cents) && (await page.locator('[data-preview-id] [data-rung]').count()) === 4);
    await shot('4-checkout');
    await page.locator('[data-action=confirm]').click(); await page.locator('#page[data-page=receipt]').waitFor(); await idle();
    const booked = (await snapshot()).reservations.at(-1);
    record('Confirm books through reservations.confirm and opens the receipt', booked.card_id === 'card-dana-visa' && booked.site_id === 'cf-B12' && (await text()).includes(booked.id));
    await shot('5-receipt');

    // Workflow 3: modify one stay, cancel another, file a late-arrival notice.
    await go('#/reservation/res-0001', 'reservation');
    const modify = page.getByRole('form', {name: 'Change dates or site'});
    await modify.locator('[name=arrival]').fill('2027-06-19'); await modify.locator('[name=departure]').fill('2027-06-21');
    await page.locator('[data-action=modify-preview]').click(); await page.locator('[data-action=modify-confirm]').waitFor();
    record('The modify panel shows the $10 change fee and that it cannot be undone', /Change fee\s*\$10\.00/.test(await text()) && (await text()).includes('cannot be undone'));
    await shot('6-reservation-modify');
    await page.locator('[data-action=modify-confirm]').click(); await done('Changed.');
    let r1 = (await snapshot()).reservations.find(r => r.id === 'res-0001');
    record('Modify confirm moves the stay', r1.arrival === '2027-06-19' && r1.departure === '2027-06-21');
    await page.locator('#page[data-page=reservation]').waitFor(); await idle();
    await page.locator('[data-action=late-arrival]').click(); await done('Late arrival noted.');
    r1 = (await snapshot()).reservations.find(r => r.id === 'res-0001');
    record('The late-arrival panel files the notice', r1.late_arrival === true);
    await go('#/reservation/res-0002', 'reservation');
    const refundNow = (await agent('reservations.get', {reservation_id: 'res-0002'})).reservation.cancel_refund_now_cents;
    record('The reservation page shows the refund the tool computes now', (await page.locator('[data-refund-now]').getAttribute('data-refund-now')) === String(refundNow));
    await page.locator('[data-action=cancel-preview]').click(); await page.locator('[data-action=cancel-confirm]').waitFor();
    record('The cancel preview names the same refund', (await page.locator('[data-refund]').getAttribute('data-refund')) === String(refundNow));
    await page.locator('[data-action=cancel-confirm]').click(); await done('Cancelled.');
    record('Cancel confirm cancels the stay', (await snapshot()).reservations.find(r => r.id === 'res-0002').state === 'cancelled');
    await go('#/reservation/res-0002', 'reservation');
    record('A cancelled stay has no modify, cancel or late-arrival panel', await page.locator('[data-panel]').count() === 0);

    // Workflow 4 and check (e): an alert is invisible until Infra applies it.
    const outage = {event_id: 'browser-outage', at: '2027-05-21T08:00:00-07:00', operation: 'switchback.alert.posted', payload: {alert_id: 'al-0777',
      kind: 'electrical_outage', facility_id: 'cedar-flat', site_ids: ['cf-B12'], from: '2027-05-21T08:00:00-07:00', to: '2027-06-28T12:00:00-07:00', text: 'Pedestal 12 rewiring: no power at B12.'}};
    await go('#/reservation/' + booked.id, 'reservation');
    record('Before the event no page shows its alert', !(await text()).includes(outage.payload.text));
    const applied = await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: outage});
    record('Infra applies an alert event', applied.status === 'committed');
    await page.reload(); await page.locator('#page[data-page=reservation]').waitFor(); await idle();
    record('After a reload the stay shows as affected and still confirmed',
      (await page.locator('[data-affected]').getAttribute('data-affected')) === 'al-0777' && (await page.locator('[data-badge=confirmed]').count()) > 0);
    await go('#/facility/cedar-flat', 'facility');
    record('The facility page lists the alert', (await text()).includes(outage.payload.text));
    await shot('7-facility-alert');
    await go('#/reservations/confirmed', 'reservations');
    const listed = (await agent('reservations.list', {state: 'confirmed'})).reservations.map(r => r.id);
    record('The reservations page filters through reservations.list', JSON.stringify(await page.locator('[data-reservation-id]').evaluateAll(l => l.map(e => e.dataset.reservationId))) === JSON.stringify(listed));
    await shot('8-reservations');

    // Account and wallet.
    await go('#/account', 'account');
    await page.locator('tr[data-card-id=card-dana-visa] [data-action=set-default]').click(); await done('Default card changed.');
    record('Make default changes the wallet through wallet.set_default', (await snapshot()).wallet.default_card_id === 'card-dana-visa');
    const gear = page.locator('form[data-equipment-form=new]');
    await gear.locator('[name=label]').fill('New trailer'); await gear.locator('[name=length_ft]').fill('26'); await gear.locator('[name=make_default]').check();
    await gear.getByRole('button', {name: 'Add equipment'}).click(); await done('Equipment saved.');
    const data = await snapshot();
    record('Equipment saves through equipment.save', data.default_equipment_id === 'equip-0003' && data.equipment.at(-1).length_ft === 26);
    await shot('9-account');

    // Policy: the rule text policy.get returns.
    await go('#/policy/cedar-flat', 'policy');
    const rules = (await agent('policy.get', {facility_id: 'cedar-flat'})).policies[0].rules;
    const shownText = await text();
    record('The policy page prints every rule policy.get returns', rules.every(r => shownText.includes(r)));
    await shot('10-policy');

    // Every page fits a phone-width viewport, and nothing logged an error.
    await page.setViewportSize({width: 390, height: 844});
    for (const [hash, name] of [['#/search', 'search'], ['#/facility/cedar-flat', 'facility'], ['#/site/cf-B12/2027-06-25/2027-06-27', 'site'], ['#/checkout', 'checkout'],
      ['#/receipt/' + booked.id, 'receipt'], ['#/reservations', 'reservations'], ['#/reservation/' + booked.id, 'reservation'], ['#/account', 'account'], ['#/policy', 'policy']]) {
      await go(hash, name);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflows at 390 px');
    }
    await shot('11-narrow-policy');
    record('All nine pages render at 390 px with no horizontal page overflow');
    record('No JavaScript, console or content-policy errors', errors.length === 0);
    report.screenshots = shots;
    report.passed = true;
    console.log(`switchback: ${checks.length} page checks passed`);
  } catch (e) {
    report.error = e.stack; report.errors = errors;
    report.status = await page?.locator('#status').innerText().catch(() => null);
    await page?.screenshot({path: path.join(out, 'failed.png'), fullPage: true}).catch(() => {});
    console.error('Status line:', report.status);
    console.error(e, errors);
    process.exitCode = 1;
  } finally {
    await context?.close(); await infra?.close(); await host?.close(); await browser.close();
    fs.rmSync(stateDir, {recursive: true, force: true}); prepared.cleanup();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
})();
