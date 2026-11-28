#!/usr/bin/env node
'use strict';
// Drives Switchback's nine pages in Chromium on the public business Web Host
// and compares what they show with the same Agent tools and Infra snapshots.
// Needs the repository's dev dependency: npm ci && npx playwright install chromium
// Run from a full checkout: node apps/switchback/tests/browser.cjs
// Screenshots and a report go to .artifacts/web/switchback/. The curated,
// annotated workflow sequences are written by evidence/capture.cjs instead.
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

// Every visible text node inside #app must render at 12px or more.
async function smallText(page) {
  return page.evaluate(() => {
    const bad = [], walker = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const e = n.parentElement, s = getComputedStyle(e), r = e.getBoundingClientRect();
      if (s.display === 'none' || s.visibility === 'hidden' || !r.width || !r.height || e.closest('dialog:not([open])')) continue;
      if (parseFloat(s.fontSize) < 12) bad.push(`${e.tagName}.${e.className}: ${parseFloat(s.fontSize)}px "${n.textContent.trim().slice(0, 30)}"`);
    }
    return bad;
  });
}

(async () => {
  fs.mkdirSync(out, {recursive: true});
  // A disposable registry whose initial_time is fixtures/clock.json (2027-05-20).
  const prepared = prepare(path.join(root, 'apps/switchback'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchback-browser-'));
  const browser = await chromium.launch({headless: true});
  const checks = [], errors = [], report = {app: 'switchback', checked_at: new Date().toISOString(), node: process.version, browser: browser.version(), checks, passed: false};
  const record = (name, condition = true) => { assert.ok(condition, name); checks.push(name); };
  let host, readOnlyHost, infra, context, page;
  try {
    host = await start({app: 'switchback', registry: prepared.registry, stateDir, run: 'browser', profile: 'sandbox'});
    infra = new Client('switchback', 'infra', 'browser', stateDir, 'switchback-browser-inspector', {registry: prepared.registry});
    await infra.initialize();
    // An independent Agent MCP client on the same run, as another session would be.
    const other = new Client('switchback', 'agent', 'browser', stateDir, 'switchback-browser-other-agent', {registry: prepared.registry});
    await other.initialize();
    const agent = (name, args = {}) => host.client.call('switchback.' + name, args);
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot.data;
    const version = async () => (await infra.call('env.snapshot')).version;
    let otherN = 0;
    const otherWrite = async (name, args) => {
      const r = await other.call('switchback.' + name, {expected_version: await version(), request_id: 'other-' + (++otherN), ...args});
      assert.equal(r.status, 'committed', name + ': ' + JSON.stringify(r).slice(0, 200)); return r;
    };
    context = await browser.newContext({viewport: {width: 1280, height: 900}});
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const go = async (hash, name) => { await page.evaluate(h => { location.hash = h; }, hash); await page.locator(`#page[data-page=${name}]`).waitFor(); await idle(); };
    const text = () => page.locator('#page').innerText();
    const flash = async kind => { const f = page.locator(`[data-flash=${kind}]`); await f.waitFor(); await idle(); return f.innerText(); };
    const inlineError = async scope => { const e = (scope ? page.locator(scope) : page).locator('.sb-error[data-error-code]').first(); await e.waitFor(); return e.getAttribute('data-error-code'); };
    const shots = [];
    const shot = async name => { await page.screenshot({path: path.join(out, name + '.png'), fullPage: true}); shots.push(name + '.png'); };
    const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

    await page.goto(host.accessUrl);
    await page.locator('#page[data-page=search]').waitFor(); await idle();
    record('Host serves the Switchback controller; the search page loads');
    const icons = await page.locator('img[data-icon]').evaluateAll(list => list.map(i => i.complete && i.naturalWidth === 24));
    record('PNG icons load from blob: URLs under the Host content policy', icons.length > 0 && icons.every(Boolean));
    const facilities = (await agent('facilities.search')).facilities;
    record('Search page lists the facilities facilities.search returns',
      JSON.stringify(await page.locator('[data-facility-id]').evaluateAll(l => l.map(e => e.dataset.facilityId))) === JSON.stringify(facilities.map(f => f.id)));

    // Workflow 1: the filters, and the same sites and night states the tool returns.
    const form = page.getByRole('form', {name: 'Site search'});
    await form.locator('[name=facility_id]').selectOption('cedar-flat');
    await form.locator('[name=arrival]').fill('2027-06-25'); await form.locator('[name=departure]').fill('2027-06-27');
    await form.locator('[name=electric_min_amps]').selectOption('30'); await form.locator('[name=min_vehicle_ft]').fill('26');
    await form.locator('[name=available_only]').check();
    await form.getByRole('button', {name: 'Search sites'}).click(); await page.locator('#site-results h3').waitFor();
    const shown = await page.locator('#site-results tr[data-site-id]').evaluateAll(l => l.map(e => e.dataset.siteId));
    const found = (await agent('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27', electric_min_amps: 30, min_vehicle_ft: 26, available_only: true})).sites;
    record('Filtered site results match sites.search', JSON.stringify(shown) === JSON.stringify(found.map(s => s.id)) && shown.length > 0);
    const cells = await page.locator('#site-results td[data-night]').evaluateAll(l => l.map(e => e.dataset.night + ':' + e.dataset.state));
    record('The availability matrix shows each night state sites.search returns', JSON.stringify(cells) === JSON.stringify(found.flatMap(s => s.nights.map(n => n.date + ':' + n.state))));
    record('Search results print dates as readable US dates', (await page.locator('#site-results h3').innerText()).includes('Fri, Jun 25 to Sun, Jun 27, 2027'));
    await shot('1-search');
    await go('#/facility/cedar-flat', 'facility');
    record('Facility page shows an unrecorded attribute as Not recorded', (await page.locator('tr[data-site-id=cf-C07] td[data-attr=vehicle]').innerText()).includes('Not recorded'));
    await shot('2-facility');
    await go('#/site/cf-B12/2027-06-25/2027-06-27', 'site');
    const nights = (await agent('sites.get', {site_id: 'cf-B12', arrival: '2027-06-25', departure: '2027-06-27'})).nights;
    record('Site page night states match sites.get', JSON.stringify(await page.locator('[data-night]').evaluateAll(l => l.map(e => ({date: e.dataset.night, state: e.dataset.state})))) === JSON.stringify(nights.map(n => ({date: n.date, state: n.state}))));
    await shot('3-site');

    // Controls that are certain to fail are disabled with a reason.
    await go('#/site/cf-B14/2027-06-18/2027-06-20', 'site');
    record('Booked nights: the hold button is disabled with a reason', await page.locator('[data-action=hold]').isDisabled() && (await page.locator('[data-reason]').innerText()).includes('not available (reserved)'));
    await go('#/site/cf-B12/2027-05-10/2027-05-12', 'site');
    record('Past nights (sites.get past: true): hold disabled, nights shown as already past', await page.locator('[data-action=hold]').isDisabled() && (await text()).includes('Already past'));
    // A stale page: another session holds the nights after this page loaded.
    await go('#/site/cf-B10/2027-06-25/2027-06-26', 'site');
    await otherWrite('cart.hold', {site_id: 'cf-B10', arrival: '2027-06-25', departure: '2027-06-26'});
    await page.locator('[data-action=hold]').click();
    record('A hold from a page another session changed is refused with stale_version, shown next to the button with reload guidance',
      await inlineError('[aria-label=Booking]') === 'stale_version' && (await page.locator('#status').getAttribute('data-error-code')) === 'stale_version');
    await page.reload(); await page.locator('#page[data-page=site]').waitFor(); await idle();
    record('After a reload the night shows as in someone\'s cart and the hold is disabled with that reason',
      (await page.locator('[data-night]').first().getAttribute('data-state')) === 'held' && await page.locator('[data-action=hold]').isDisabled());

    // Workflow 2: hold, preview with the stale saved defaults, Back, then the right card.
    await go('#/site/cf-B12/2027-06-25/2027-06-27', 'site');
    await page.locator('[data-action=hold]').click(); await page.locator('#page[data-page=checkout]').waitFor(); await idle();
    record('After a hold the checkout page keeps the hold receipt on screen', (await flash('success')).includes('held for you until'));
    await page.locator('[data-action=preview]').click(); await page.locator('[data-preview-id]').waitFor(); await idle();
    let preview = (await snapshot()).previews.at(-1);
    record('Checkout pre-fills the saved defaults: another person\'s card and the old trailer',
      preview.card_id === 'card-carol-visa' && preview.equipment.id === 'equip-0001' && (await text()).includes('Carol Okafor'));
    const previewText = await page.locator('[data-preview-id]').innerText();
    record('The preview reads as labelled sentences with readable dates and no raw values',
      previewText.includes('Primary occupant: Dana Okafor (account holder).') && previewText.includes('Payment: $84.00 on') && !isoLike.test(previewText) && !previewText.includes('{}'));
    await page.locator('[data-action=preview-back]').click(); await page.locator('[data-preview-id]').waitFor({state: 'detached'}); await idle();
    record('Back to details discards the preview and keeps the hold', await page.locator('[data-preview-id]').count() === 0 && (await snapshot()).holds.at(-1).status === 'active');
    await page.getByRole('form', {name: 'Checkout details'}).locator('[name=card_id]').selectOption('card-dana-mc');
    await page.locator('[data-action=preview]').click(); await page.locator('[data-preview-id]').waitFor(); await idle();
    record('An expired card: Confirm is disabled with the reason', await page.locator('[data-action=confirm]').isDisabled() && (await page.locator('[data-preview-id] [data-reason]').innerText()).includes('has expired'));
    await page.getByRole('form', {name: 'Checkout details'}).locator('[name=card_id]').selectOption('card-dana-visa');
    const before = (await snapshot()).previews.length;
    await page.locator('[data-action=preview]').click();
    await page.waitForFunction(n => document.querySelector('[data-preview-id]') && document.querySelector('[data-preview-id]').dataset.previewId !== n, preview.id); await idle();
    preview = (await snapshot()).previews.at(-1);
    record('The preview shows the tool\'s total, ladder and paying card', (await snapshot()).previews.length > before && preview.card_id === 'card-dana-visa' &&
      (await page.locator('[data-total]').getAttribute('data-total')) === String(preview.total_cents) && (await page.locator('[data-preview-id] [data-rung]').count()) === 4);
    await shot('4-checkout');
    await page.locator('[data-action=confirm]').click(); await page.locator('#page[data-page=receipt]').waitFor();
    const receiptFlash = await flash('success');
    const booked = (await snapshot()).reservations.at(-1), charge = (await snapshot()).payments.at(-1);
    record('Confirm books through reservations.confirm; the receipt page keeps the receipt (reservation, amount, payment ID) visible',
      booked.card_id === 'card-dana-visa' && booked.site_id === 'cf-B12' && receiptFlash.includes(booked.id) && receiptFlash.includes(charge.id) && receiptFlash.includes('$84.00'));
    record('The receipt page names the campground and site, with IDs secondary', (await page.locator('h2').innerText()).includes('Reservation confirmed') && (await text()).includes('Cedar Flat · Site B12'));
    await shot('5-receipt');
    await page.reload(); await page.locator('#page[data-page=receipt]').waitFor(); await idle();
    record('After a reload the booking is still there', (await text()).includes(booked.id));

    // Workflow 3: modify one stay (with Discard), cancel another (with Keep), file a late-arrival notice (with a confirmation).
    await go('#/reservation/res-0001', 'reservation');
    const modify = page.getByRole('form', {name: 'Change dates or site'});
    await modify.locator('[name=arrival]').fill('2027-05-10'); await modify.locator('[name=departure]').fill('2027-05-12');
    await page.locator('[data-action=modify-preview]').click();
    record('A change to past nights shows night_in_past inside the change panel', await inlineError('[data-panel=modify]') === 'night_in_past');
    await modify.locator('[name=arrival]').fill('2027-06-19'); await modify.locator('[name=departure]').fill('2027-06-21');
    await page.locator('[data-action=modify-preview]').click(); await page.locator('[data-action=modify-confirm]').waitFor();
    record('The change preview shows the $10 change fee and that it cannot be undone', /Change fee \$10\.00/.test(await text()) && (await text()).includes('cannot be undone'));
    record('An earlier error is cleared when the next action starts', await page.locator('[data-panel=modify] .sb-error').count() === 0);
    await page.locator('[data-action=modify-back]').click(); await page.locator('[data-action=modify-confirm]').waitFor({state: 'detached'});
    record('Discard change leaves the reservation unchanged', (await snapshot()).reservations.find(r => r.id === 'res-0001').arrival === '2027-06-18' && await page.locator('[data-action=modify-confirm]').count() === 0);
    await page.locator('[data-action=modify-preview]').click(); await page.locator('[data-action=modify-confirm]').waitFor();
    await shot('6-reservation-modify');
    await page.locator('[data-action=modify-confirm]').click();
    const changed = await flash('success');
    let r1 = (await snapshot()).reservations.find(r => r.id === 'res-0001');
    record('Modify confirm moves the stay and the receipt (new dates, fee) stays on the re-rendered page',
      r1.arrival === '2027-06-19' && r1.departure === '2027-06-21' && changed.includes('Sat, Jun 19 to Mon, Jun 21, 2027') && changed.includes('Change fee $10.00'));
    await page.locator('[data-action=late-arrival]').click(); await page.locator('dialog[open]').waitFor();
    await page.locator('[data-dialog=cancel]').click();
    record('The late-arrival notice asks first; Go back files nothing', (await snapshot()).reservations.find(r => r.id === 'res-0001').late_arrival === false);
    await page.locator('[data-action=late-arrival]').click(); await page.locator('[data-dialog=confirm]').click();
    const late = await flash('success');
    r1 = (await snapshot()).reservations.find(r => r.id === 'res-0001');
    record('The late-arrival panel files the notice and shows the new release time', r1.late_arrival === true && late.includes('Sun, Jun 20, 2027, 12:00 PM (UTC-07:00)'));
    await go('#/reservation/res-0002', 'reservation');
    const refundNow = (await agent('reservations.get', {reservation_id: 'res-0002'})).reservation.cancel_refund_now_cents;
    record('The reservation page shows the refund the tool computes now', (await page.locator('[data-refund-now]').getAttribute('data-refund-now')) === String(refundNow));
    await page.locator('[data-action=cancel-preview]').click(); await page.locator('[data-action=cancel-confirm]').waitFor();
    record('The cancel preview names the same refund', (await page.locator('[data-refund]').getAttribute('data-refund')) === String(refundNow));
    await page.locator('[data-action=cancel-back]').click(); await page.locator('[data-action=cancel-confirm]').waitFor({state: 'detached'});
    record('Keep reservation closes the preview and cancels nothing', await page.locator('[data-action=cancel-confirm]').count() === 0 && (await snapshot()).reservations.find(r => r.id === 'res-0002').state === 'confirmed');
    await page.locator('[data-action=cancel-preview]').click(); await page.locator('[data-action=cancel-confirm]').click();
    const cancelled = await flash('success');
    record('Cancel confirm cancels the stay and the refund receipt stays visible', (await snapshot()).reservations.find(r => r.id === 'res-0002').state === 'cancelled' && cancelled.includes('$138.00'));
    record('A cancelled stay has no modify, cancel or late-arrival panel', await page.locator('[data-panel]').count() === 0);
    record('Reservation pages print no raw timestamps', !isoLike.test(await text()));

    // Workflow 4 and check (e): an alert is invisible until Infra applies it.
    const outage = {event_id: 'browser-outage', at: '2027-05-21T08:00:00-07:00', operation: 'switchback.alert.posted', payload: {alert_id: 'al-0777',
      kind: 'electrical_outage', facility_id: 'cedar-flat', site_ids: ['cf-B12'], from: '2027-05-21T08:00:00-07:00', to: '2027-06-28T12:00:00-07:00', text: 'Pedestal 12 rewiring: no power at B12.'}};
    await go('#/reservation/' + booked.id, 'reservation');
    record('Before the event no page shows its alert', !(await text()).includes(outage.payload.text));
    const applied = await infra.call('env.apply_event', {expected_version: await version(), event: outage});
    record('Infra applies an alert event', applied.status === 'committed');
    await page.reload(); await page.locator('#page[data-page=reservation]').waitFor(); await idle();
    record('After a reload the stay shows as affected and still confirmed',
      (await page.locator('p[data-affected]').getAttribute('data-affected')) === 'al-0777' && (await page.locator('[data-badge=confirmed]').count()) > 0);
    await go('#/facility/cedar-flat', 'facility');
    record('The facility page lists the alert', (await text()).includes(outage.payload.text));
    await shot('7-facility-alert');
    await go('#/reservations/confirmed', 'reservations');
    const listed = (await agent('reservations.list', {state: 'confirmed'})).reservations.map(r => r.id);
    const cardIds = await page.locator('[data-reservation-id]').evaluateAll(l => l.map(e => e.dataset.reservationId));
    record('The reservations page filters through reservations.list', JSON.stringify([...cardIds].sort()) === JSON.stringify([...listed].sort()));
    record('Reservation cards lead with the campground and site; the reservation ID is secondary', (await page.locator('[data-reservation-id] h4').allInnerTexts()).every(t => !t.includes('res-') && t.includes('Site')));
    await shot('8-reservations');

    // Account and wallet: a stale page shows stale_version next to the control; a removal asks first.
    await go('#/account', 'account');
    await otherWrite('companions.save', {companion_id: 'comp-0003', default_party: false});
    await page.locator('[data-card-id=card-dana-visa] [data-action=set-default]').click();
    record('A write from a page another session changed shows stale_version with reload guidance', await inlineError() === 'stale_version' &&
      (await page.locator('.sb-error[data-error-code=stale_version]').innerText()).includes('Reload the page'));
    await page.reload(); await page.locator('#page[data-page=account]').waitFor(); await idle();
    await page.locator('[data-card-id=card-dana-visa] [data-action=set-default]').click();
    record('Make default changes the wallet through wallet.set_default and the receipt stays visible', (await flash('success')).includes('Visa ending 4417') && (await snapshot()).wallet.default_card_id === 'card-dana-visa');
    const gear = page.locator('form[data-equipment-form=new]');
    await gear.locator('[name=label]').fill('New trailer'); await gear.locator('[name=length_ft]').fill('26'); await gear.locator('[name=make_default]').check();
    await gear.getByRole('button', {name: 'Add equipment'}).click(); await flash('success');
    const data = await snapshot();
    record('Equipment saves through equipment.save', data.default_equipment_id === 'equip-0003' && data.equipment.at(-1).length_ft === 26);
    await page.locator('[data-companion-id=comp-0003] [data-action=remove-companion]').click(); await page.locator('dialog[open]').waitFor();
    await page.locator('[data-dialog=cancel]').click();
    record('Removing a companion asks first; Go back keeps the companion', (await snapshot()).companions.some(c => c.id === 'comp-0003'));
    await page.locator('[data-companion-id=comp-0003] [data-action=remove-companion]').click(); await page.locator('[data-dialog=confirm]').click(); await flash('success');
    record('Confirming the removal removes the companion', !(await snapshot()).companions.some(c => c.id === 'comp-0003'));
    await shot('9-account');

    // Policy: the rule text policy.get returns.
    await go('#/policy/cedar-flat', 'policy');
    const rules = (await agent('policy.get', {facility_id: 'cedar-flat'})).policies[0].rules;
    const shownText = await text();
    record('The policy page prints every rule policy.get returns', rules.every(r => shownText.includes(r)));
    await shot('10-policy');

    // A missing record replaces the page and its title.
    await go('#/reservation/res-9999', 'error');
    record('An unknown reservation shows Not found, with the page title updated and no earlier content left', (await page.title()) === 'Not found · Switchback' &&
      (await page.locator('.sb-error').getAttribute('data-error-code')) === 'not_found' && !(await text()).includes('Refunds and changes'));

    // Every App-owned text is at least 12px on every page.
    const pagesToCheck = [['#/search', 'search'], ['#/facility/cedar-flat', 'facility'], ['#/site/cf-B12/2027-06-25/2027-06-27', 'site'], ['#/checkout', 'checkout'],
      ['#/receipt/' + booked.id, 'receipt'], ['#/reservations', 'reservations'], ['#/reservation/' + booked.id, 'reservation'], ['#/account', 'account'], ['#/policy', 'policy']];
    const small = [];
    for (const [hash, name] of pagesToCheck) { await go(hash, name); small.push(...(await smallText(page)).map(x => name + ': ' + x)); }
    assert.deepEqual(small, [], 'text under 12px');
    record('All App text on the nine pages is at least 12px');

    // The browse profile (Infra reset): confirms leave discovery, and the pages say so instead of offering them.
    assert.equal((await infra.call('env.reset', {expected_version: await version(), profile: 'browse'})).status, 'ready');
    await go('#/site/cf-B12/2027-06-25/2027-06-27', 'site');
    await page.locator('[data-action=hold]').click(); await page.locator('#page[data-page=checkout]').waitFor(); await idle();
    await page.locator('[data-action=preview]').click(); await page.locator('[data-preview-id]').waitFor(); await idle();
    record('Under browse the preview works but no Confirm button is offered', await page.locator('[data-action=confirm]').count() === 0 && (await text()).includes('Confirming is not allowed'));
    await go('#/account', 'account');
    record('Under browse Make default is not offered', await page.locator('[data-action=set-default]').count() === 0);

    // The read-only scenario profile on a fresh run: no write controls; a direct write is refused by the Host.
    readOnlyHost = await start({app: 'switchback', registry: prepared.registry, stateDir, run: 'browser-read-only', profile: 'scenario'});
    const ro = await context.newPage();
    ro.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await ro.goto(readOnlyHost.accessUrl); await ro.locator('#page[data-page=search]').waitFor(); await ro.locator('#app[aria-busy=false]').waitFor();
    const roGo = async (hash, name) => { await ro.evaluate(h => { location.hash = h; }, hash); await ro.locator(`#page[data-page=${name}]`).waitFor(); await ro.locator('#app[aria-busy=false]').waitFor(); };
    const writeControls = '[data-action=hold]:not([disabled]),[data-action=preview],[data-action=modify-preview],[data-action=cancel-preview],[data-action=late-arrival],[data-action=set-default],[data-action=remove-companion],form[data-equipment-form],form[data-companion-form]';
    let shownWrites = 0;
    for (const [hash, name] of [['#/site/cf-B12/2027-06-25/2027-06-27', 'site'], ['#/reservation/res-0001', 'reservation'], ['#/account', 'account']]) {
      await roGo(hash, name); shownWrites += await ro.locator(writeControls).count();
    }
    record('In the read-only scenario profile no write control is shown; the pages say editing is not available', shownWrites === 0 && await ro.locator('[data-read-only]').count() > 0);
    const forbidden = await ro.evaluate(async () => {
      const {csrf} = await (await fetch('/session')).json();
      const r = await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name: 'switchback.wallet.set_default', arguments: {card_id: 'card-dana-visa', expected_version: {epoch: 1, revision: 0}, request_id: 'direct'}})});
      return {http: r.status, body: await r.json()};
    });
    record('A direct write request from the read-only page is refused by the Host (403, operation not permitted)', forbidden.http === 403 && /not permitted/.test(forbidden.body.error));
    await ro.close();

    // Every page fits a phone-width viewport, and nothing logged an error.
    await page.setViewportSize({width: 390, height: 844});
    for (const [hash, name] of pagesToCheck.map(([h, n]) => [h.replace(booked.id, 'res-0001'), n])) {
      await go(hash, name);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflows at 390 px');
    }
    await shot('11-narrow-policy');
    record('All nine pages render at 390 px with no horizontal page overflow');
    record('No JavaScript, console or content-policy errors', errors.length === 0);
    report.screenshots = shots;
    report.passed = true;
    await other.close();
    console.log(`switchback: ${checks.length} page checks passed`);
  } catch (e) {
    report.error = e.stack; report.errors = errors;
    report.status = await page?.locator('#status').innerText().catch(() => null);
    await page?.screenshot({path: path.join(out, 'failed.png'), fullPage: true}).catch(() => {});
    console.error('Status line:', report.status);
    console.error(e, errors);
    process.exitCode = 1;
  } finally {
    await context?.close(); await infra?.close(); await host?.close(); await readOnlyHost?.close(); await browser.close();
    fs.rmSync(stateDir, {recursive: true, force: true}); prepared.cleanup();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    process.exit(process.exitCode || 0);
  }
})();
