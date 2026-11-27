#!/usr/bin/env node
'use strict';
// Browser acceptance for the business Web App. Starts the shared public Web Host on this
// package, drives the real page with Chromium, and checks every write against independent
// Agent and Infra MCP connections on the same run. Needs a public PALE checkout (or
// PALE_RUNTIME_ROOT) and Playwright; App-only tests live in ../business.test.cjs.
// Usage: node tests/web/acceptance.cjs [report-directory]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const appDir = path.resolve(__dirname, '../..');
let runtime = process.env.PALE_RUNTIME_ROOT;
if (!runtime) {
  let root = appDir;
  while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) {
    const parent = path.dirname(root);
    if (parent === root) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
    root = parent;
  }
  runtime = path.join(root, 'runtime');
}
const {start} = require(path.join(runtime, 'web/server.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const {digestTree} = require(path.join(runtime, 'verify.cjs'));
const manifest = require('../../app.json');
const APP = manifest.app_id, T = name => APP + '.' + name;
const registry = path.join(appDir, 'web.registry.json');
const out = path.resolve(process.argv[2] || process.env.PALE_WEB_REPORT_DIR || '.artifacts/parcel-web');

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parcel-web-'));
  const packageHash = digestTree(appDir);
  const browser = await chromium.launch({headless: true});
  const checks = [], closers = [], problems = [];
  const report = {schema: 'parcel-delivery-manager.web-acceptance.v1', checked_at: new Date().toISOString(), app_id: APP, app_version: manifest.version,
    runtime_version: require(path.join(runtime, 'package.json')).version, node: process.version, browser: 'chromium ' + browser.version(),
    package_sha256: packageHash, checks, screenshots: [], passed: false};
  const record = (name, condition = true) => { assert.ok(condition, name); checks.push(name); };

  // One Host, one browser page and independent MCP inspectors per run.
  async function open(run, profile, prepare) {
    const host = await start({app: APP, registry, stateDir, run, profile});
    closers.push(() => host.close());
    const client = async role => { const c = new Client(APP, role, run, stateDir, 'parcel-web-' + role, {registry}); closers.push(() => c.close()); await c.initialize(); return c; };
    const infra = await client('infra'), agent = await client('agent');
    if (prepare) await prepare(infra);
    const context = await browser.newContext({viewport: {width: 1360, height: 900}, deviceScaleFactor: 2});
    closers.push(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    // Failed-resource lines are produced on purpose by the denial and lost-response checks below.
    page.on('pageerror', e => problems.push(run + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(run + ' console: ' + m.text()); });
    const settle = async () => {
      await page.locator('#app[aria-busy=false]').waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-panel][data-ready]')].every(p => p.dataset.ready === 'true'));
    };
    await page.goto(host.accessUrl);
    await page.locator('#records [data-list]').waitFor();
    await settle();
    const shot = async name => { const file = run + '-' + name + '.png'; await page.screenshot({path: path.join(out, file), fullPage: true}); report.screenshots.push(file); };
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot.data;
    const applyEvent = async event => infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event});
    const nav = async label => { await page.locator('nav button', {hasText: label}).click(); await settle(); };
    const select = async id => { await page.locator('[data-record-id="' + id + '"]').click(); await page.locator('[data-parcel="' + id + '"]').waitFor(); await settle(); };
    const dialog = page.locator('dialog[open]');
    const submit = dialog.locator('button[type=submit]');
    const closed = async () => { await dialog.waitFor({state: 'detached'}); await settle(); };
    const detail = () => page.locator('.detail').innerText();
    // Same-origin requests from the page itself, as a script on it could send them.
    const direct = (name, args) => page.evaluate(async ({name, args}) => {
      const {csrf} = await (await fetch('/session')).json();
      const r = await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name, arguments: args})});
      return {http: r.status, body: await r.json()};
    }, {name, args});
    return {host, infra, agent, page, settle, shot, snapshot, applyEvent, nav, select, dialog, submit, closed, detail, direct};
  }

  try {
    // ================= Recipient, sandbox profile =================
    const w = await open('recipient', 'sandbox');
    const {page, agent, infra, dialog, submit} = w;
    record('Shared Web Host serves the App-owned page from the package registry', (await page.title()) === 'Parcels · PALE' && await page.locator('#records .record').count() === 3);
    const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8');
    record('Controller covers every declared business tool', require('../../tools.json').every(t => controller.includes("'" + t.name + "'")));
    const allowed = (await w.host.client.request('tools/list')).result.tools.map(t => t.name);
    record('Business discovery has no management tools', allowed.length === 16 && allowed.every(name => name.startsWith(APP + '.')));
    record('Page has no management controls', !/load seed|reset|snapshot|apply event|advance time/i.test(await page.locator('#app').innerText()));
    await w.shot('1-inbox');

    // ---- View 1: inbox, sections and search ----
    await w.nav('Needs action');
    record('Section filter shows only the parcel ready for pickup', await page.locator('#records .record').count() === 1 && await page.locator('[data-record-id=S002]').isVisible());
    await w.nav('Closed');
    record('Empty section shows an empty state, not stale rows', await page.locator('#records .record').count() === 0 && await page.locator('#records .empty').isVisible());
    await w.nav('Active parcels');
    await page.locator('.toolbar input[type=search]').fill('glasses');
    await page.locator('#records .record').first().waitFor(); await w.settle();
    record('Search narrows the inbox through the App', await page.locator('#records .record').count() === 1 && await page.locator('[data-record-id=S003]').isVisible());
    await page.locator('.toolbar input[type=search]').fill(''); await page.locator('[data-record-id=S001]').waitFor(); await w.settle();

    // ---- View 2: parcel details and timeline ----
    await w.select('S001');
    let text = await w.detail();
    record('Detail shows tracking number, plan and timeline', /NL4471200019/.test(text) && /Home delivery to Home — 418 Larchmere Row, Harlow Bay on 2026-03-04/.test(text) && /Departed regional sort facility/.test(text));

    // ---- View 3: delivery options; view 4: change review ----
    record('Options offer only what the policy and plan allow', await page.locator('[data-change]').count() === 4 && await page.locator('[data-change=home_delivery]').count() === 0);
    await page.locator('[data-change=reschedule]').click();
    await dialog.locator('[data-field=delivery_date]').fill('2026-03-20');
    await submit.click();
    record('Browser validation keeps an out-of-range date from being sent', await dialog.getAttribute('data-step') === 'edit' && await dialog.locator('[data-field=delivery_date]:invalid').count() === 1);
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await w.closed();
    await page.locator('[data-change=address]').click();
    await dialog.locator('[data-field=address_id]').selectOption('addr-maya-work');
    await dialog.locator('[data-field=delivery_date]').fill('2026-03-20');
    await submit.click();
    await dialog.locator('.form-error[data-code=date_out_of_range]').waitFor();
    record('A request the App refuses stays in the form with its reason and no confirm step', await dialog.getAttribute('data-step') === 'edit' &&
      /outside the allowed range/.test(await dialog.locator('.form-error').innerText()) && (await w.snapshot()).changes.length === 1);
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await w.closed();

    await page.locator('[data-change=reschedule]').click();
    await dialog.locator('[data-field=delivery_date]').fill('2026-03-06');
    await submit.click();
    await page.locator('dialog[open][data-step=review]').waitFor();
    text = await dialog.innerText();
    record('Preview shows the current and requested plan before anything is sent', /Current plan/.test(text) && /on 2026-03-04/.test(text) && /on 2026-03-06/.test(text) &&
      /changes only after the carrier applies it/.test(text) && (await w.snapshot()).changes.length === 1);
    await w.shot('2-change-review');
    await dialog.getByRole('button', {name: 'Edit'}).click();
    record('Edit returns to the form without sending', await dialog.getAttribute('data-step') === 'edit' && await dialog.locator('[data-field=delivery_date]').isEnabled());
    await submit.click(); await page.locator('dialog[open][data-step=review]').waitFor();
    await submit.click(); await w.closed();
    text = await w.detail();
    record('Sent request appears as pending; the plan is unchanged', /Change pending/.test(text) && /Request waiting for the carrier/.test(text) && /on 2026-03-04/.test(text) &&
      await page.locator('[data-blocked=change_pending]').count() === 1 && await page.locator('[data-change]').count() === 0);
    await w.shot('3-pending');

    // ---- Shared state: browser write seen through MCP, and after reload ----
    let viaMcp = await agent.call(T('shipments.get'), {id: 'S001'});
    record('Independent Agent MCP reads the browser\'s pending request', viaMcp.shipment.pending_change?.status === 'pending' && viaMcp.shipment.pending_change.target.delivery_date === '2026-03-06' && viaMcp.shipment.plan.revision === 1);
    const firstChange = viaMcp.shipment.pending_change.id;
    await page.reload(); await page.locator('[data-parcel=S001]').waitFor(); await w.settle();
    record('Reload shows the committed pending request', /Request waiting for the carrier/.test(await w.detail()));

    // ---- Scenario event through Infra, then Refresh ----
    record('Carrier decision is applied through Infra MCP', (await w.applyEvent({event_id: 'web-decide-1', at: '2026-03-02T15:00:00Z', operation: 'carrier.change_resolved',
      payload: {shipment_id: 'S001', change_id: firstChange, base_plan_revision: 1, decision: 'applied', reason: null}})).status === 'committed');
    record('Page does not invent the decision before it is refreshed', /Request waiting for the carrier/.test(await w.detail()));
    await page.getByRole('button', {name: 'Refresh'}).click(); await w.settle();
    text = await w.detail();
    record('Refresh shows the applied plan and the carrier\'s timeline entry', /Home delivery to Home — 418 Larchmere Row, Harlow Bay on 2026-03-06/.test(text) && !/Request waiting for the carrier/.test(text) && /Carrier applied the change/.test(text));

    // ---- Separate MCP write, then withdraw it in the browser ----
    const p2 = await agent.call(T('change.preview'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-07'});
    const s2 = await agent.call(T('change.submit'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-07', confirmation: p2.preview.confirmation, expected_version: p2.version, request_id: 'web-mcp-submit'});
    record('Agent MCP submits a request outside the browser', s2.status === 'committed');
    await page.getByRole('button', {name: 'Refresh'}).click(); await w.settle();
    record('Refresh shows the request made through MCP', /Request waiting for the carrier/.test(await w.detail()) && /on 2026-03-07/.test(await page.locator('[data-panel=pending]').innerText()));
    await page.getByRole('button', {name: 'Withdraw request'}).click();
    await submit.click(); await w.closed();
    record('Withdrawing in the browser cancels the request in the App', !/Request waiting for the carrier/.test(await w.detail()) && (await w.snapshot()).changes.find(c => c.id === s2.change_id).status === 'cancelled');

    // ---- Stale edit: the App changed after the form was opened ----
    await page.locator('[data-change=hold]').click();
    await dialog.locator('[data-field=hold_until]').fill('2026-03-08');
    await submit.click(); await page.locator('dialog[open][data-step=review]').waitFor();
    const p3 = await agent.call(T('change.preview'), {id: 'S003', kind: 'redirect', point_id: 'P03'});
    await agent.call(T('change.submit'), {id: 'S003', kind: 'redirect', point_id: 'P03', confirmation: p3.preview.confirmation, expected_version: p3.version, request_id: 'web-concurrent'});
    await submit.click();
    await dialog.locator('.form-error[data-code=stale_version]').waitFor();
    record('A stale form shows the conflict and sends nothing', /changed/i.test(await dialog.locator('.form-error').innerText()) && await dialog.isVisible() &&
      !(await w.snapshot()).changes.some(c => c.shipment_id === 'S001' && c.status === 'pending'));
    await w.shot('4-stale-conflict');
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await w.closed();
    await page.getByRole('button', {name: 'Refresh'}).click(); await w.settle();

    // ---- Lost response: the write committed but the browser never heard back ----
    await page.locator('[data-change=hold]').click();
    await dialog.locator('[data-field=hold_until]').fill('2026-03-08');
    await submit.click(); await page.locator('dialog[open][data-step=review]').waitFor();
    let dropped = 0;
    await page.route('**/api/call', async route => {
      if (route.request().postDataJSON().name === T('change.submit') && !dropped) { dropped++; await route.fetch(); return route.abort('failed'); }
      return route.continue();
    });
    await submit.click();
    await dialog.locator('.form-error[data-code]').waitFor();
    record('A lost response is shown as a failure, not as success', dropped === 1 && await dialog.isVisible());
    await page.unroute('**/api/call');
    await submit.click(); await w.closed();
    const holds = (await w.snapshot()).changes.filter(c => c.shipment_id === 'S001' && c.kind === 'hold');
    record('Retrying after a lost response has exactly one effect', holds.length === 1 && holds[0].status === 'pending' && /Request waiting for the carrier/.test(await w.detail()));

    // ---- View 5: pass and collector authorization ----
    await w.select('S002');
    record('Recipient sees their own valid pickup pass', await page.locator('[data-pass-code]').innerText() === 'K7QM-4R2X' && /Valid/.test(await page.locator('[data-pass]').innerText()));
    await page.locator('[data-authorize]').click();
    record('Authorization form offers saved collectors and defaults to the latest allowed time',
      /Alex Rivera \(Neighbour\)/.test(await dialog.locator('[data-field=collector_person_id]').innerText()) && await dialog.locator('[data-field=expires_at]').inputValue() === '2026-03-04T15:00');
    await dialog.locator('[data-field=expires_at]').fill('2026-03-04T12:00');
    await submit.click(); await page.locator('dialog[open][data-step=review]').waitFor();
    record('Authorization preview states the limited access before it is granted', /Alex Rivera will be able to collect/.test(await dialog.innerText()) && (await w.snapshot()).grants.length === 0);
    await w.shot('5-authorize-review');
    await submit.click(); await w.closed();
    record('Authorization appears as current', /Current/.test(await page.locator('[data-grant=G001]').innerText()));
    const grants = await agent.call(T('grants.list'), {shipment_id: 'S002'});
    const ledger = await w.snapshot();
    record('Agent MCP sees the authorization and the collector\'s pass', grants.items[0].valid_now === true && grants.items[0].expires_at === '2026-03-04T12:00:00Z' &&
      ledger.passes.filter(p => p.shipment_id === 'S002' && p.status === 'active').length === 2);
    await w.shot('6-collection');
    await page.locator('[data-grant=G001]').getByRole('button', {name: 'Replace'}).click();
    record('Replace form preselects the authorization being replaced', await dialog.locator('[data-field=replaces_grant_id]').inputValue() === 'G001' &&
      await dialog.locator('[data-field=collector_person_id]').inputValue() === 'person-alex');
    await dialog.locator('[data-field=expires_at]').fill('2026-03-04T10:00');
    await submit.click(); await page.locator('dialog[open][data-step=review]').waitFor();
    record('Replacement preview says the old pass stops working', /replaces authorization G001/.test(await dialog.innerText()));
    await submit.click(); await w.closed();
    const swapped = (await w.snapshot()).grants.map(g => [g.id, g.status, g.expires_at, g.replaces_grant_id]);
    record('Replacing in the browser swaps the authorization in one step', /Replaced/.test(await page.locator('[data-grant=G001]').innerText()) && /Current/.test(await page.locator('[data-grant=G002]').innerText()) &&
      JSON.stringify(swapped) === JSON.stringify([['G001', 'replaced', '2026-03-04T12:00:00Z', null], ['G002', 'active', '2026-03-04T10:00:00Z', 'G001']]));
    await page.locator('[data-grant=G002]').getByRole('button', {name: 'Revoke'}).click();
    await submit.click(); await w.closed();
    record('Revoking in the browser ends the authorization and its pass', /Revoked/.test(await page.locator('[data-grant=G002]').innerText()) &&
      await page.locator('[data-grant=G002] button').count() === 0 && (await w.snapshot()).passes.filter(p => p.shipment_id === 'S002' && p.status === 'active').length === 1);

    // ---- Views 3, 4, 5, 6 as directories ----
    await w.nav('Pickup points');
    record('Pickup-point directory lists hours, access and status', await page.locator('[data-point]').count() === 3 && /Mon–Sat 08:00–18:00 \(America\/Toronto\)/.test(await page.locator('[data-point=P03]').innerText()));
    await w.shot('7-pickup-points');
    await w.nav('Change requests');
    record('Change history lists every request with its decision', await page.locator('[data-change-id]').count() === (await w.snapshot()).changes.length &&
      /Applied/.test(await page.locator('[data-change-id="' + firstChange + '"]').innerText()) && /Cancelled/.test(await page.locator('[data-change-id="' + s2.change_id + '"]').innerText()));
    await w.shot('8-change-history');
    await page.locator('[data-change-id="' + firstChange + '"]').click(); await page.locator('[data-parcel=S001]').waitFor(); await w.settle();
    record('A request in the history opens its parcel', /Wool blanket/.test(await w.detail()));
    await w.nav('Collectors');
    record('Collectors view lists saved collectors and past authorizations', await page.locator('[data-collector=person-alex]').count() === 1 && /Replaced/.test(await page.locator('[data-grant-id=G001]').innerText()) &&
      /Revoked/.test(await page.locator('[data-grant-id=G002]').innerText()));
    await w.nav('Notices');
    const visibleNotices = (await agent.call(T('notices.list'), {})).items, allNotices = (await w.snapshot()).notices;
    record('Notices view lists exactly the notices this person may read', await page.locator('[data-notice-id]').count() === visibleNotices.length && visibleNotices.length < allNotices.length &&
      /Change applied/.test(await page.locator('#records').innerText()) && !/You may collect a parcel/.test(await page.locator('#records').innerText()));
    await w.shot('9-notices');

    // ---- Business-only access: forbidden requests sent directly from the page ----
    const admin = await w.direct('env.snapshot', {});
    const forged = await w.direct(T('shipments.list'), {owner_person_id: 'person-alex'});
    const hidden = await page.evaluate(async () => Promise.all(['/api/state', '/fixtures/minimal.json', '/src/operations.cjs', '/app.json', '/web.registry.json'].map(async p => (await fetch(p)).status)));
    record('Management operations are refused by the Host even when requested directly', admin.http === 403 && !('snapshot' in admin.body));
    record('A request naming another person is rejected by the App', forged.body.status === 'invalid_arguments');
    record('No state, fixture or source file is downloadable', hidden.every(status => status === 404));

    // ---- Narrow viewport ----
    await page.setViewportSize({width: 430, height: 860});
    await w.nav('Active parcels'); await w.select('S002');
    record('Narrow layout keeps the list and detail usable', await page.locator('[data-record-id=S002]').isVisible() && await page.locator('[data-pass-code]').isVisible());
    await w.shot('10-narrow');
    await page.setViewportSize({width: 1360, height: 900});

    // ---- Untrusted text is rendered as text ----
    const hostile = structuredClone(await w.snapshot());
    const target = hostile.shipments.find(s => s.id === 'S003');
    target.contents_label = '<img src=x onerror="window.injected=1">';
    target.sender_label = '<script>window.injected=2</script>';
    target.timeline.at(-1).summary = '<b onmouseover="window.injected=3">bold</b>';
    hostile.pickup_points[0].status_note = '<iframe src="javascript:window.injected=4"></iframe>';
    record('Infra loads history containing markup', (await infra.call('env.load_seed', {expected_version: (await infra.call('env.snapshot')).version, data: hostile})).status === 'ready');
    await page.getByRole('button', {name: 'Refresh'}).click(); await w.settle();
    await w.select('S003');
    text = await w.detail();
    record('Markup in App data is shown as text and never executed', text.includes('<img src=x onerror="window.injected=1">') && text.includes('<script>window.injected=2</script>') &&
      text.includes('<b onmouseover="window.injected=3">bold</b>') && await page.locator('#app img, #app script, #app iframe, #app b').count() === 0 &&
      await page.evaluate(() => window.injected) === undefined);
    await w.shot('11-untrusted-text');

    // ================= W4 in the browser: failure, deadline, return =================
    const v = await open('recovery', 'sandbox');
    const advance = async at => v.infra.call('env.advance_time', {request_id: 'web-' + at, expected_version: (await v.infra.call('env.snapshot')).version, virtual_now: at});
    const refresh = async () => { await v.page.getByRole('button', {name: 'Refresh'}).click(); await v.settle(); };
    await v.applyEvent({event_id: 'web-failed', at: '2026-03-04T20:00:00Z', operation: 'carrier.delivery_failed',
      payload: {shipment_id: 'S001', plan_revision: 1, reason: 'Nobody was available to receive the parcel.'}});
    await refresh(); await v.nav('Needs action'); await v.select('S001');
    text = await v.detail();
    record('Failed delivery shows its reason, the action deadline and the recovery options', /Delivery failed/.test(text) && /Nobody was available to receive the parcel/.test(text) &&
      /Choose a new option by\s+Mar 6, 2026, 8:00 PM UTC/.test(text) && await v.page.locator('[data-change=reschedule]').count() === 1 && await v.page.locator('[data-change=redirect]').count() === 1);
    await v.shot('1-delivery-failed');
    // Recover a second failed parcel through the page: choose a new date, the carrier applies it.
    await v.applyEvent({event_id: 'web-failed-2', at: '2026-03-04T20:05:00Z', operation: 'carrier.delivery_failed',
      payload: {shipment_id: 'S003', plan_revision: 1, reason: 'An adult signature was required and nobody could sign.'}});
    await refresh(); await v.select('S003');
    await v.page.locator('[data-change=reschedule]').click();
    await v.dialog.locator('[data-field=delivery_date]').fill('2026-03-07');
    await v.submit.click(); await v.page.locator('dialog[open][data-step=review]').waitFor();
    await v.submit.click(); await v.closed();
    const redelivery = (await v.snapshot()).changes.find(c => c.shipment_id === 'S003' && c.status === 'pending');
    record('Redelivery requested in the browser after a failed attempt is pending in the App', redelivery?.target.delivery_date === '2026-03-07' && /Delivery failed/.test(await v.detail()));
    await v.applyEvent({event_id: 'web-redelivery', at: '2026-03-04T21:00:00Z', operation: 'carrier.change_resolved',
      payload: {shipment_id: 'S003', change_id: redelivery.id, base_plan_revision: 1, decision: 'applied', reason: null}});
    await refresh(); await v.nav('Active parcels'); await v.select('S003');
    text = await v.detail();
    record('Once the carrier applies it the parcel is on its way again and the failure stays in the timeline', /In transit/.test(text) && !/Failed attempt/.test(text) &&
      /on 2026-03-07/.test(text) && /Delivery attempt failed: An adult signature was required/.test(text));
    await v.nav('Needs action'); await v.select('S001');

    record('Infra advances the clock past the deadline without any event', (await advance('2026-03-06T20:00:00Z')).status === 'committed');
    await refresh(); await v.select('S001');
    text = await v.detail();
    record('After the deadline passes by the clock the page shows it and offers no change', /Delivery failed/.test(text) && /Deadline passed/.test(text) && /passed/.test(text) &&
      await v.page.locator('[data-blocked=deadline_passed]').count() === 1 && await v.page.locator('[data-change]').count() === 0 &&
      (await v.snapshot()).shipments.find(s => s.id === 'S001').status === 'attempt_failed');
    await v.shot('2-deadline-passed');
    await v.applyEvent({event_id: 'web-expired', at: '2026-03-06T20:00:00Z', operation: 'carrier.deadline_reached', payload: {shipment_id: 'S001', deadline: 'failure_action'}});
    await refresh(); await v.nav('Active parcels'); await v.select('S001');
    text = await v.detail();
    record('Return in progress is shown with its reason and no change is offered', /Returning to sender/.test(text) && /No delivery option was chosen/.test(text) &&
      await v.page.locator('[data-blocked=return_started]').count() === 1 && await v.page.locator('[data-change]').count() === 0);
    const forcedChange = await v.direct(T('change.submit'), {id: 'S001', kind: 'redirect', point_id: 'P01', confirmation: 'cf-guess', expected_version: (await v.infra.call('env.snapshot')).version, request_id: 'web-forced'});
    record('A change sent directly for a returning parcel is refused', forcedChange.body.status === 'return_started');
    await v.shot('3-returning');
    await v.applyEvent({event_id: 'web-returned', at: '2026-03-09T15:00:00Z', operation: 'carrier.return_completed', payload: {shipment_id: 'S001'}});
    await refresh();
    record('Returned parcel leaves the active list', await v.page.locator('[data-record-id=S001]').count() === 0);
    await v.nav('Closed'); await v.select('S001');
    text = await v.detail();
    record('Terminal outcome keeps the failure reason and timeline visible', /Returned to sender/.test(text) && /Nobody was available/.test(text) && /Return to sender started/.test(text) &&
      await v.page.locator('[data-panel=options]').count() === 0);
    await v.shot('4-returned');

    // ================= W2 in the browser: redirect, arrival, handoff =================
    const u = await open('pickup', 'sandbox');
    const reload = async () => { await u.page.getByRole('button', {name: 'Refresh'}).click(); await u.settle(); };
    await u.select('S001');
    await u.page.locator('[data-change=redirect]').click();
    const choices = await u.dialog.locator('[data-field=point_id] option').allInnerTexts();
    record('Redirect form lists the eligible pickup points with their kind and access', choices.length === 3 && choices.includes('Quay Street depot counter (counter, step-free)') &&
      choices.includes('Foundry Lane parcel locker (locker, not step-free)'));
    await u.dialog.locator('[data-field=point_id]').selectOption('P03');
    await u.submit.click(); await u.page.locator('dialog[open][data-step=review]').waitFor();
    record('Redirect preview names the pickup point before anything is sent', /Pickup at Quay Street depot counter/.test(await u.dialog.innerText()) && (await u.snapshot()).changes.length === 1);
    await u.submit.click(); await u.closed();
    const toPoint = (await u.snapshot()).changes.find(c => c.shipment_id === 'S001' && c.status === 'pending');
    record('Redirect sent from the browser is pending in the App', toPoint?.target.point_id === 'P03' && /Home delivery to Home/.test(await u.detail()));
    await u.applyEvent({event_id: 'web-redirect', at: '2026-03-02T15:00:00Z', operation: 'carrier.change_resolved',
      payload: {shipment_id: 'S001', change_id: toPoint.id, base_plan_revision: 1, decision: 'applied', reason: null}});
    await reload();
    text = await u.detail();
    record('An applied redirect shows the new plan and no pass before the parcel arrives', /Pickup at Quay Street depot counter/.test(text) && /In transit/.test(text) &&
      await u.page.locator('[data-pass]').count() === 0 && await u.page.locator('[data-panel=collection]').count() === 0);
    await u.applyEvent({event_id: 'web-arrival', at: '2026-03-03T15:00:00Z', operation: 'carrier.pickup_ready', payload: {shipment_id: 'S001', plan_revision: 2, point_id: 'P03', pickup_epoch: 1}});
    await reload();
    const shown = await u.page.locator('[data-pass-code]').innerText(), viaAgent = (await u.agent.call(T('pass.get'), {id: 'S001'})).pass;
    record('Arrival shows the pass and the deadline, the same as MCP', shown === viaAgent.code && viaAgent.valid_now === true && /Ready for pickup/.test(await u.detail()) &&
      /Collect by\s+Mar 6, 2026, 3:00 PM UTC/.test(await u.detail()));
    await u.shot('1-ready-after-redirect');
    await u.applyEvent({event_id: 'web-handoff', at: '2026-03-04T15:00:00Z', operation: 'carrier.collected',
      payload: {shipment_id: 'S001', point_id: 'P03', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: shown}});
    await reload();
    record('A collected parcel leaves the active list', await u.page.locator('[data-record-id=S001]').count() === 0);
    await u.nav('Closed'); await u.select('S001');
    text = await u.detail();
    record('The handoff is shown with who collected and where', /Collected/.test(text) && /Collected at Quay Street depot counter by Maya Chen/.test(text) && await u.page.locator('[data-pass]').count() === 0);

    // ================= Restricted profile: reads only =================
    const r = await open('read-only', 'scenario');
    await r.select('S001');
    record('Restricted profile shows options as text with no write controls', await r.page.locator('[data-option]').count() === 4 && await r.page.locator('[data-change]').count() === 0 &&
      /Read-only access/.test(await r.page.locator('[data-panel=options]').innerText()));
    await r.select('S002');
    record('Restricted profile shows the pass but cannot authorize', await r.page.locator('[data-pass-code]').innerText() === 'K7QM-4R2X' && await r.page.locator('[data-authorize]').count() === 0);
    const deniedPreview = await r.direct(T('change.preview'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06'});
    const denied = await r.direct(T('change.submit'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06', confirmation: deniedPreview.body.preview.confirmation,
      expected_version: deniedPreview.body.version, request_id: 'web-denied'});
    record('A write sent directly under the restricted profile is denied and changes nothing', (denied.http === 403 || denied.body.status === 'permission_denied') && (await r.snapshot()).changes.length === 1);
    await r.shot('1-read-only');

    // ================= Collector: separate run over the same ledger =================
    const binding = require('../../fixtures/binding.json');
    const forAlex = {...structuredClone(ledger), account_id: 'pdm-alex', owner_person_id: 'person-alex'};
    const d = await open('collector', 'sandbox', async admin => {
      const loaded = await admin.call('env.load_seed', {expected_version: (await admin.call('env.snapshot')).version, data: forAlex, binding, virtual_now: '2026-03-02T15:00:00Z'});
      assert.equal(loaded.status, 'ready', 'Collector history loads');
    });
    record('Collector sees exactly one parcel, as an authorized pickup', await d.page.locator('#records .record').count() === 1 && /Authorized pickup/.test(await d.page.locator('[data-record-id=S002]').innerText()));
    await d.select('S002');
    text = await d.page.locator('#app').innerText();
    record('Collector gets their own pass and the pickup details', /Your pass as authorized collector/.test(text) && await d.page.locator('[data-pass-code]').innerText() !== 'K7QM-4R2X' &&
      /Larchmere Pharmacy counter/.test(text) && /Collect by/.test(text));
    record('Collector sees no tracking number, sender, address, plan, options or timeline', !/NL4471200027|Brightleaf|418 Larchmere Row|Foundry Lane|Delivery plan|Timeline/.test(text) &&
      await d.page.locator('[data-panel=options]').count() === 0 && await d.page.locator('[data-authorize]').count() === 0);
    await d.nav('Notices');
    record('Collector\'s notices mention only their authorization', await d.page.locator('[data-notice-id]').count() === 1 && /You may collect a parcel/.test(await d.page.locator('#records').innerText()));
    const onward = await d.direct(T('grant.preview'), {id: 'S002', collector_person_id: 'person-sam', expires_at: '2026-03-04T12:00:00Z'});
    record('Collector cannot authorize anyone else, even directly', onward.body.status === 'not_found');
    await d.nav('Active parcels'); await d.select('S002');
    await d.shot('1-collector');

    // ================= Data catalog seeds in the browser =================
    const {loadSeed} = require('../../scripts/load-seed.cjs');
    const c = await open('catalog', 'sandbox', () => loadSeed({seed: '08-expiry-return', run: 'catalog', stateDir, registry}));
    record('A catalog seed loaded through Infra appears in the Web App', await c.page.locator('#records .record').count() === 3 &&
      JSON.stringify((await c.agent.call(T('shipments.list'), {})).items.map(x => x.id).sort()) === JSON.stringify(['S121', 'S122', 'S123']));
    await c.select('S122');
    text = await c.detail();
    record('Seed with a deadline passed before its event shows the unchanged status, an expired pass and no change', /Ready for pickup/.test(text) && /Deadline passed/.test(text) &&
      /Expired/.test(await c.page.locator('[data-pass]').innerText()) && await c.page.locator('[data-blocked=deadline_passed]').count() === 1);
    await c.shot('1-catalog-deadline-passed');
    await c.select('S123');
    record('Seed parcel being returned shows its reason', /Returning to sender/.test(await c.detail()) && /was not collected from Quay Street depot counter/.test(await c.detail()));
    await c.nav('Closed'); await c.select('S124');
    record('January history is visible on a closed parcel', /Returned to sender/.test(await c.detail()) && /Jan 22, 2026/.test(await c.detail()));
    const a = await open('catalog-collector', 'sandbox', () => loadSeed({seed: '05-delegation', actor: 'person-alex', run: 'catalog-collector', stateDir, registry}));
    await a.select('S113');
    record('The same seed loaded for its collector shows only the authorized parcel and their pass', await a.page.locator('#records .record').count() === 1 &&
      /Your pass as authorized collector/.test(await a.detail()) && !/Harbour Wool|418 Larchmere Row|Timeline/.test(await a.page.locator('#app').innerText()));

    record('No script error or content-security violation in any run', problems.length === 0);
    record('Package files are unchanged by the run', digestTree(appDir) === packageHash);
    report.passed = true;
  } catch (e) {
    report.error = e.message;
    report.problems = problems;
  } finally {
    for (const close of closers.reverse()) await close().catch(() => {});
    await browser.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(checks.map(c => 'PASS ' + c).join('\n'));
  console.log(report.passed ? '\n' + checks.length + ' browser acceptance checks passed. Report and screenshots: ' + out : '\nFAILED: ' + report.error + (problems.length ? '\n' + problems.join('\n') : ''));
  if (!report.passed) process.exitCode = 1;
})();
