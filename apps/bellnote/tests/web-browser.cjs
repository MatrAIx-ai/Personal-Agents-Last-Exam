'use strict';
// Browser acceptance for Bellnote's web page (not part of the default npm test: needs Playwright and
// Chromium, installed at the repository root with `npm ci && npx playwright install chromium`).
// It starts the real shared Host on a fresh run, clicks the page's own controls for W1-W4 and the
// account settings, and confirms every write through an independent MCP client on the same run.
//   node tests/web-browser.cjs [--runtime DIR] [--out DIR]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir(), repo = path.dirname(runtime);
const {start} = require(path.join(runtime, 'web/server.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
const {chromium} = require(require.resolve('playwright', {paths: [repo, process.cwd()]}));
const registry = path.join(locate.packageDir, 'web.registry.json');
const out = locate.option('out') || path.join(repo, '.artifacts/bellnote-web');
const HOSTILE = '<img src=x onerror="window.__bellnoteXss=1">Dentist & <b>ortho</b>';

const checks = [], consoleErrors = [], networkLogs = [];
const check = (name, cond, detail) => { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 400) : '')); checks.push(name); console.log('ok - ' + name); };

async function host(profile, run) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bellnote-browser-'));
  const h = await start({app: 'bellnote', registry, run, stateDir, profile});
  return {...h, stateDir, async stop() { await h.close(); fs.rmSync(stateDir, {recursive: true, force: true}); }};
}
async function page(browser, h, width) {
  const context = await browser.newContext({viewport: {width, height: width < 500 ? 844 : 900}});
  const p = await context.newPage();
  // Chromium logs every refused request ("Failed to load resource"); this test provokes some on purpose
  // (the dropped response, the direct management and fixture requests). Those are kept apart from
  // script errors and checked against the deliberate cases below.
  p.on('console', m => { if (m.type() !== 'error') return; (/^Failed to load resource/.test(m.text()) ? networkLogs : consoleErrors).push(width + ': ' + m.text()); });
  p.on('pageerror', e => consoleErrors.push(width + ': ' + e.message));
  await p.goto(h.accessUrl);
  await settled(p);
  return p;
}
async function settled(p) {
  await p.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false' && document.querySelector('.detail .bn-page, .detail .empty h3'), null, {timeout: 20000});
}
async function section(p, label) { await p.click('nav button:has-text("' + label + '")'); await p.waitForTimeout(50); await settled(p); }
async function submitDialog(p) { await p.click('dialog[open] .form-actions button.primary'); }
async function closed(p) { await p.waitForSelector('dialog[open]', {state: 'detached', timeout: 20000}).catch(() => p.waitForFunction(() => !document.querySelector('dialog[open]'), null, {timeout: 20000})); await settled(p); }
async function errorOf(p) { await p.waitForFunction(() => document.querySelector('dialog[open] .form-error')?.textContent, null, {timeout: 20000}); return p.$eval('dialog[open] .form-error', e => ({code: e.dataset.code, text: e.textContent})); }
const shot = (p, name) => p.screenshot({path: path.join(out, name + '.png'), fullPage: true});
const noOverflow = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function run() {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch();
  const h = await host('sandbox', 'bellnote-browser');
  const mcp = new Client('bellnote', 'agent', 'bellnote-browser', h.stateDir, 'bellnote-browser-check', {registry});
  const infra = new Client('bellnote', 'infra', 'bellnote-browser', h.stateDir, 'bellnote-browser-infra', {registry});
  try {
    await mcp.initialize(); await infra.initialize();
    const p = await page(browser, h, 1280);
    check('Host serves the App-owned page and Home lists three children', (await p.$$('.bn-kid')).length === 3);
    check('Home shows what needs attention (changed form, unanswered form, low balance)', (await p.$$('.bn-attention .bn-item')).length === 3);
    await shot(p, 'desktop-home');

    // W1: report an absence with a hostile reason, then cancel it.
    await section(p, 'Attendance');
    await p.click('button:has-text("Report absence or late arrival")');
    await p.selectOption('dialog[open] [data-field=start]', '2026-11-18');
    await p.fill('dialog[open] [data-field=reason]', HOSTILE);
    await shot(p, 'desktop-report-form');
    await submitDialog(p); await closed(p);
    const reports = (await mcp.call('bellnote.absences.list', {child_id: 'child-theo', state: 'submitted'})).reports;
    const report = reports.find(r => r.dates[0] === '2026-11-18');
    check('W1 browser report commits; MCP reads it with the exact reason', report && report.reason === HOSTILE, reports);
    const row = 'div[data-report-id="' + report.id + '"]';
    check('Hostile text is shown as text and never executed', (await p.textContent(row)).includes('<img src=x') && !(await p.$(row + ' img, ' + row + ' b')) && !(await p.evaluate(() => window.__bellnoteXss)));
    check('Success is announced in the status line', (await p.textContent('#status')) === 'Report sent to the school.');
    await p.click(row + ' button:has-text("Cancel report")');
    await submitDialog(p); await closed(p);
    check('W1 cancel through the confirmation commits; MCP reads cancelled', (await mcp.call('bellnote.absences.list', {id: report.id})).reports[0].state === 'cancelled');
    check('A fully cancelled report still names its day', (await p.textContent(row + ' strong')).includes('Wed, Nov 18'));
    await shot(p, 'desktop-attendance');

    // W2: sign the changed form again; withdraw another answer.
    await section(p, 'Forms');
    check('Forms opens on the first form to do', (await p.getAttribute('article[data-form-id]', 'data-form-id')) === 'form-aquarium');
    await p.click('button:has-text("Review and sign again")');
    check('Answer sheet prefills the earlier answers', (await p.inputValue('dialog[open] [data-question=q-emergency]')) === '555-0100');
    await p.selectOption('dialog[open] [data-question=q-lunch]', 'bring_own');
    await submitDialog(p); await closed(p);
    const aq = (await mcp.call('bellnote.forms.get', {id: 'form-aquarium'})).form.responses[0];
    check('W2 browser signature on version 2 commits; MCP reads signed, no second payment', aq.state === 'signed' && aq.form_version === 2 && aq.answers['q-lunch'] === 'bring_own' && aq.payment_ids.length === 1, aq);
    await p.click('button[data-form-id=form-winter-concert]'); await settled(p);
    await p.click('div.bn-item[data-child-id=child-theo] button:has-text("Withdraw answer")');
    await submitDialog(p); await closed(p);
    const wc = (await mcp.call('bellnote.forms.get', {id: 'form-winter-concert'})).form.responses.find(r => r.child_id === 'child-theo');
    check('W2 browser withdrawal commits; MCP reads withdrawn and the fee refunded', wc.state === 'withdrawn' && (await mcp.call('bellnote.payments.list', {child_id: 'child-theo'})).payments.find(x => x.object_id === wc.id).status === 'refunded');
    await p.click('button[data-form-id=form-k-band]'); await settled(p);
    check('Signing is not offered where the right belongs to another guardian', !(await p.$('.detail button:has-text("Answer")')) && (await p.textContent('div.bn-item[data-child-id=child-nico]')).includes('Signing for Nico is with Sam Reyes'));
    await shot(p, 'desktop-forms');

    // W3: add a pickup person, change and cancel a way home.
    await section(p, 'Pickup & dismissal');
    await p.click('button:has-text("Add pickup person")');
    check('The add-person form asks for name, relationship and phone only (no school ID field)', !(await p.$('dialog[open] [data-field=person_id]')) &&
      (await p.$$eval('dialog[open] label.field > span', s => s.map(x => x.textContent))).join('|') === 'Full name *|Relationship to the child *|Phone number *');
    await p.fill('dialog[open] [data-field=name]', 'Hostile Phone');
    await p.fill('dialog[open] [data-field=relationship]', 'neighbor');
    await p.fill('dialog[open] [data-field=phone]', '<img src=x onerror=alert(1)>');
    let calls = 0; const countCalls = r => { if (new URL(r.url()).pathname === '/api/call') calls++; }; p.on('request', countCalls);
    await submitDialog(p); await p.waitForTimeout(300);
    const phoneCheck = await p.$eval('dialog[open] [data-field=phone]', e => ({valid: e.validity.valid, mismatch: e.validity.patternMismatch, message: e.validationMessage}));
    check('A malformed phone number is stopped in the form, naming the phone field, and nothing is sent', phoneCheck.mismatch && phoneCheck.message.length > 0 && calls === 0, phoneCheck);
    p.off('request', countCalls);
    await p.fill('dialog[open] [data-field=name]', 'June Park');
    await p.fill('dialog[open] [data-field=relationship]', 'neighbor');
    await p.fill('dialog[open] [data-field=phone]', '555-0166');
    await submitDialog(p); await closed(p);
    const june = (await mcp.call('bellnote.pickup.get', {id: 'child-theo'})).pickup_people.find(x => x.display_name === 'June Park');
    check('W3 browser add commits; MCP reads the person waiting for review', june?.status === 'pending_review');
    check('The new person appears in the list as waiting for the office', (await p.textContent('div[data-person-id="' + june.id + '"]')).includes('Waiting for the office'));
    await p.click('div[data-date="2026-11-18"] button:has-text("Change")');
    await p.selectOption('dialog[open] [data-field=mode]', 'pickup');
    await p.selectOption('dialog[open] [data-field=person_id]', 'person-rosa');
    await p.fill('dialog[open] [data-field=note]', 'Dentist, Rosa collects');
    await submitDialog(p); await closed(p);
    let plan = (await mcp.call('bellnote.pickup.get', {id: 'child-theo'})).days.find(d => d.date === '2026-11-18').plan;
    check('W3 browser way-home change commits; MCP plan names Rosa', plan.source === 'dismissal_change' && plan.person_id === 'person-rosa');
    check('The day row shows the new way home', (await p.textContent('div[data-date="2026-11-18"]')).includes('Picked up by Rosa Delgado'));
    await p.click('div[data-date="2026-11-18"] button:has-text("Cancel change")');
    await submitDialog(p); await closed(p);
    plan = (await mcp.call('bellnote.pickup.get', {id: 'child-theo'})).days.find(d => d.date === '2026-11-18').plan;
    check('W3 browser cancel commits; MCP plan is the default again', plan.source === 'default');
    await p.click('button.bn-row[data-child-id=child-nico]'); await settled(p);
    check('Non-custodial child: no pickup list and no controls', (await p.textContent('.detail')).includes('shared only with custodial guardians') && !(await p.$('.detail button:has-text("Add pickup person")')));
    await p.click('button.bn-row[data-child-id=child-theo]'); await settled(p);
    await shot(p, 'desktop-pickup');

    // W4: a refused top-up, a stale form, a retried top-up after a lost response, settings.
    await section(p, 'Lunch');
    const seen = []; const record = r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) seen.push(u.pathname === '/api/call' ? JSON.parse(r.postData()).name : u.pathname); };
    p.on('request', record);
    await p.click('button.bn-row[data-child-id=child-ines]'); await settled(p);
    p.off('request', record);
    check('Choosing another child re-reads only that child\'s account and menu', JSON.stringify(seen.sort()) === JSON.stringify(['bellnote.lunch.account_get', 'bellnote.menu.list']) &&
      (await p.getAttribute('[data-balance]', 'data-balance')) === '310', seen);
    await p.click('button:has-text("Add money")');
    await p.fill('dialog[open] [data-money-for=amount_cents]', '2.00');
    await submitDialog(p);
    const refusal = await errorOf(p);
    await shot(p, 'desktop-topup-refused');
    check('A refusal stays in the form with the App message (no protocol code shown)', refusal.code === 'amount_out_of_range' && refusal.text === 'A top-up must be between $5.00 and $200.00.' &&
      (await p.$eval('dialog[open] .form-error', e => getComputedStyle(e, '::before').content)) === 'none', refusal);
    check('No false success after a refusal', (await p.isVisible('dialog[open]')) && (await p.textContent('#status')) !== 'Lunch account topped up.');
    // Another client changes the account while this form is open.
    const v = (await mcp.call('bellnote.preferences.get')).version;
    check('Independent MCP write commits while the form is open', (await mcp.call('bellnote.preferences.update', {email_notices: true, expected_version: v, request_id: 'mcp-pref-browser'})).status === 'committed');
    await p.fill('dialog[open] [data-money-for=amount_cents]', '20.00');
    await submitDialog(p);
    const conflict = await errorOf(p);
    check('A stale form shows the conflict instead of overwriting', conflict.code === 'stale_version', conflict);
    check('Nothing was charged by the stale form', (await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'})).account.balance_cents === 310);
    await p.click('dialog[open] .form-actions button:not(.primary)');
    await p.click('.toolbar button:has-text("Refresh")'); await settled(p);
    // Lose the response of the first submit: the request reaches the Host, the page never sees the answer.
    let dropped = 0, sentIds = [];
    await p.route('**/api/call', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.name === 'bellnote.lunch.topup') sentIds.push(body.arguments.request_id);
      if (body.name === 'bellnote.lunch.topup' && !dropped) { dropped++; await route.fetch(); return route.abort('connectionreset'); }
      return route.continue();
    });
    await p.click('button:has-text("Add money")');
    await p.fill('dialog[open] [data-money-for=amount_cents]', '20.00');
    await p.selectOption('dialog[open] [data-field=payment_method_id]', 'pm-0001');
    await submitDialog(p);
    const lost = await errorOf(p);
    check('A lost response is reported in plain words, not shown as success', lost.code === 'request_failed' && /may not have arrived/.test(lost.text), lost);
    await submitDialog(p); await closed(p);
    await p.unroute('**/api/call');
    const ines = await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'});
    check('Retry of the unchanged form reuses its request ID and commits once', sentIds.length === 2 && sentIds[0] === sentIds[1] && ines.account.balance_cents === 2310 &&
      ines.transactions.filter(x => x.kind === 'topup' && x.request_id === sentIds[0]).length === 1, {sentIds, balance: ines.account.balance_cents});
    check('The page shows the new balance', (await p.getAttribute('[data-balance]', 'data-balance')) === '2310');
    await p.click('button:has-text("Alerts and limits")');
    await p.fill('dialog[open] [data-money-for=low_balance_threshold_cents]', '8.00');
    await p.fill('dialog[open] [data-money-for=daily_limit_cents]', '');
    await submitDialog(p); await closed(p);
    const acct = (await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'})).account;
    check('W4 browser settings commit; MCP reads the threshold and no limit', acct.low_balance_threshold_cents === 800 && acct.daily_limit_cents === null);
    // An independent scenario event, then Refresh.
    const snap = await infra.call('env.snapshot');
    const applied = await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'ev-browser-charge', at: '2026-11-17T07:20:00-08:00', operation: 'bellnote.lunch.charged',
      payload: {transaction_id: 'tx-browser-1', child_id: 'child-ines', kind: 'purchase', amount_cents: -425, item: 'Peanut noodle bowl', allergens: ['peanut', 'wheat', 'soy']}}});
    check('Independent scenario event commits', applied.status === 'committed' || applied.status === 'ready', applied);
    await p.click('.toolbar button:has-text("Refresh")'); await settled(p);
    check('Refresh shows the cafeteria charge, flagged as restricted', (await p.textContent('div[data-transaction-id=tx-browser-1]')).includes('Restricted for Ines') && (await p.getAttribute('[data-balance]', 'data-balance')) === '1885');
    await shot(p, 'desktop-lunch');
    await p.reload(); await settled(p);
    check('Reload keeps the view and the committed balance', (await p.getAttribute('[data-balance]', 'data-balance')) === '1885');

    // Account: preferences through the shared form.
    await section(p, 'Account');
    await p.click('.collection button:has-text("Edit")');
    await p.selectOption('dialog[open] [data-field=email_notices]', 'false');
    await p.selectOption('dialog[open] [data-field=default_payment_method_id]', 'pm-0002');
    await submitDialog(p); await closed(p);
    const prefs = (await mcp.call('bellnote.preferences.get')).preferences;
    check('Preferences commit; MCP reads them', prefs.email_notices === false && prefs.default_payment_method_id === 'pm-0002');
    await shot(p, 'desktop-account');
    await section(p, 'Notifications');
    await p.click('button.bn-row[data-notice-id]'); await settled(p);
    check('Notifications list and reader render', (await p.$$('button.bn-row[data-notice-id]')).length > 5 && Boolean(await p.$('article[data-notice-id]')));
    await shot(p, 'desktop-notifications');

    // Direct management requests from the page's own session are refused.
    const direct = await p.evaluate(async () => {
      const {csrf} = await (await fetch('/session')).json(), out = {};
      for (const name of ['env.snapshot', 'env.reset', 'env.apply_event']) out[name] = (await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name, arguments: {}})})).status;
      out.fixture = (await fetch('/fixtures/reference.json')).status;
      return out;
    });
    check('Direct management and fixture requests from the business session are denied', direct['env.snapshot'] === 403 && direct['env.reset'] === 403 && direct['env.apply_event'] === 403 && direct.fixture === 404, direct);
    check('Desktop page has no horizontal overflow', await noOverflow(p));
    await p.context().close();

    // Phone width: every view, no horizontal page scroll.
    const phone = await page(browser, h, 390);
    for (const [label, name] of [['Home', 'home'], ['Attendance', 'attendance'], ['Forms', 'forms'], ['Pickup', 'pickup'], ['Lunch', 'lunch'], ['Notifications', 'notifications'], ['Account', 'account']]) {
      await section(phone, label);
      check('390px ' + name + ' has no horizontal overflow', await noOverflow(phone));
      await shot(phone, 'phone-' + name);
    }
    await phone.context().close();

    // Restricted profile on a fresh run: read views only.
    const r = await host('scenario', 'bellnote-browser-scenario');
    try {
      const rp = await page(browser, r, 1280);
      check('Restricted profile says the session is view only', (await rp.textContent('.bn-today')).includes('View only'));
      for (const label of ['Attendance', 'Forms', 'Pickup & dismissal', 'Lunch', 'Account']) await section(rp, label);
      await section(rp, 'Lunch');
      check('Restricted profile renders no write controls', !(await rp.$('button:has-text("Add money")')) && !(await rp.$('button:has-text("Alerts and limits")')));
      await section(rp, 'Attendance');
      check('Restricted profile: no report button', !(await rp.$('button:has-text("Report absence")')));
      await shot(rp, 'desktop-restricted-attendance');
      await rp.context().close();
    } finally { await r.stop(); }
    check('No browser JavaScript errors', consoleErrors.length === 0, consoleErrors);
    check('Only the deliberately provoked requests failed (1 dropped response, 3 management calls, 1 fixture)', networkLogs.length === 5 &&
      networkLogs.filter(x => /ERR_CONNECTION_RESET/.test(x)).length === 1 && networkLogs.filter(x => /403/.test(x)).length === 3 && networkLogs.filter(x => /404/.test(x)).length === 1, networkLogs);
    const summary = {schema: 'bellnote.web-browser.v1', node: process.version, browser: browser.version(), checks, console_errors: consoleErrors, provoked_network_failures: networkLogs, screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).sort()};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(checks.length + ' browser checks passed; screenshots in ' + out);
  } finally { await mcp.close(); await infra.close(); await h.stop(); await browser.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
