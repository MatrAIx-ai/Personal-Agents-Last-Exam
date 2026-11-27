'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../../..');
const { start } = require(path.join(root, 'runtime/web/server.cjs'));
const { Client } = require(path.join(root, 'runtime/client.cjs'));
const { digestTree } = require(path.join(root, 'runtime/verify.cjs'));
const { createRuntime } = require(path.join(root, 'runtime/core/runtime.cjs'));

async function session(browser, { app, stateDir, run, profile, timezoneId, locale, registry, report }) {
  const host = await start({ app, stateDir, run, profile, registry });
  const infra = new Client(app, 'infra', host.run, stateDir, 'web-acceptance-inspector', { registry: host.registry });
  await infra.initialize();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId, locale });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [], consoleErrors = [], allowed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const s = {
    host, infra, page, errors, consoleErrors,
    allowConsole(pattern) { allowed.push(pattern); },
    unexpectedConsole() { return consoleErrors.filter(text => !allowed.some(p => p.test(text))); },
    async open(ready) { await page.goto(host.accessUrl); await page.locator(ready).first().waitFor(); await s.idle(); },
    async idle() { await page.locator('#app[aria-busy=false]').waitFor(); },
    async settled() { await page.waitForFunction(() => { const status = document.getElementById('status'); return document.querySelector('#app').getAttribute('aria-busy') === 'false' && (status.textContent === 'All changes saved' || status.dataset.error === 'true'); }); },
    async snapshot() { return (await infra.call('env.snapshot')).snapshot; },
    async data() { return (await s.snapshot()).data; },
    async version() { return (await infra.call('env.snapshot')).version; },
    async event(event) {
      const r = await infra.call('env.apply_event', { expected_version: await s.version(), event });
      assert.equal(r.status, 'committed', 'Infra event ' + event.event_id + ': ' + JSON.stringify(r));
      report.receipts.push({ kind: 'infra_event', event_id: event.event_id, operation: event.operation, status: r.status });
      return r;
    },
    async advance(at) {
      const r = await infra.call('env.advance_time', { expected_version: await s.version(), virtual_now: at, request_id: 'web-advance-' + at });
      assert.equal(r.status, 'committed', 'Clock advance: ' + JSON.stringify(r));
      report.receipts.push({ kind: 'infra_clock', virtual_now: at, status: r.status });
      return r;
    },
    async loadSeed(args) {
      const r = await infra.call('env.load_seed', { expected_version: await s.version(), ...args });
      assert.equal(r.status, 'ready', 'Seed load: ' + JSON.stringify(r));
      return r;
    },
    async business(name, args) {
      return page.evaluate(async ({ name, args }) => {
        const { csrf } = await (await fetch('/session')).json();
        const r = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name, arguments: args }) });
        return { http: r.status, body: await r.json() };
      }, { name, args });
    },
    async dropAfterCommit(match) {
      const seen = { dropped: false, forwarded: null, request: null };
      await page.route('**/api/call', async route => {
        const payload = route.request().postDataJSON();
        if (!seen.dropped && match(payload)) {
          seen.dropped = true;
          seen.request = payload;
          const response = await route.fetch();
          seen.forwarded = await response.json();
          await route.abort('failed');
        } else await route.continue();
      });
      return seen;
    },
    async answerAfterCommit(match, status, body) {
      const seen = { answered: false, forwarded: null, request: null };
      await page.route('**/api/call', async route => {
        if (!seen.answered && match(route.request().postDataJSON())) {
          seen.answered = true;
          seen.request = route.request().postDataJSON();
          seen.forwarded = await (await route.fetch()).json();
          await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        } else await route.continue();
      });
      return seen;
    },
    async dropBeforeSend(match) {
      const seen = { dropped: false };
      await page.route('**/api/call', async route => {
        if (!seen.dropped && match(route.request().postDataJSON())) { seen.dropped = true; await route.abort('failed'); }
        else await route.continue();
      });
      return seen;
    },
    async failNextDiscovery() {
      let failed = false;
      await page.route('**/api/tools', async route => { if (!failed) { failed = true; await route.abort('failed'); } else await route.continue(); });
    },
    async release() { await page.unroute('**/api/call'); await page.unroute('**/api/tools'); },
    async shot(name) {
      const file = path.join(report.out, name + '.png');
      await page.screenshot({ path: file, fullPage: true });
      report.screenshots.push(path.relative(root, file));
    },
    async overflow(width) {
      await page.setViewportSize({ width, height: 844 });
      return page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    },
    async close() { await context.close(); await infra.close(); await host.close(); }
  };
  return s;
}

async function runWebAcceptance({ app, appDir, steps, restricted, timezoneId = 'UTC', locale = 'en-US', launchArgs = [], registry = path.join(root, 'apps.registry.json') }) {
  const out = path.resolve(process.env.PALE_WEB_REPORT_DIR || path.join(root, '.artifacts/web', app));
  fs.mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-' + app + '-web-'));
  const report = {
    schema: 'pale.web-acceptance.v1', app, app_version: manifest.version, package_sha256: digestTree(appDir),
    checked_at: new Date().toISOString(), node: process.version, browser: null,
    playwright: require('playwright/package.json').version, runtime_version: require(path.join(root, 'runtime/package.json')).version,
    core_api_version: null, host: 'runtime/web/server.cjs', registry: path.relative(root, registry),
    command: 'node ' + path.relative(root, require.main.filename), browser_timezone: timezoneId, browser_locale: locale,
    checks: [], receipts: [], screenshots: [], restricted: null, passed: false, out
  };
  const check = list => (name, condition = true) => { assert.ok(condition, name); list.push(name); console.log('  ✓ ' + name); };
  let s, r, browser;
  try {
    report.core_api_version = createRuntime({ registryFile: registry }).registry.api;
    browser = await chromium.launch({ headless: true, args: ['--lang=' + locale, ...launchArgs], env: { ...process.env, LANG: locale.replace('-', '_') + '.UTF-8' } });
    report.browser = 'chromium ' + browser.version();
    s = await session(browser, { app, stateDir, run: app + '-web', profile: 'sandbox', timezoneId, locale, registry, report });
    try { await steps({ ...s, check: check(report.checks), report }); }
    catch (e) { await s.shot('failed').catch(() => {}); throw e; }
    check(report.checks)('No JavaScript errors and no console or CSP errors beyond the induced network failures', s.errors.length === 0 && s.unexpectedConsole().length === 0);
    report.console_errors = { seen: s.consoleErrors.length, unexpected: s.unexpectedConsole() };
    if (restricted) {
      const checks = [];
      r = await session(browser, { app, stateDir, run: app + '-web-restricted', profile: 'sandbox', timezoneId, locale, registry, report });
      try { await restricted({ ...r, check: check(checks), report }); }
      catch (e) { await r.shot('restricted-failed').catch(() => {}); throw e; }
      check(checks)('No JavaScript errors and no console or CSP errors beyond the induced refusals', r.errors.length === 0 && r.unexpectedConsole().length === 0);
      report.restricted = { passed: true, checks };
    }
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    console.error(e);
    process.exitCode = 1;
  } finally {
    await s?.close().catch(() => {});
    await r?.close().catch(() => {});
    await browser?.close().catch(() => {});
    fs.rmSync(stateDir, { recursive: true, force: true });
    report.out = path.relative(root, out);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log((report.passed ? 'passed' : 'FAILED') + ': ' + report.checks.length + ' checks' + (report.restricted ? ' + ' + report.restricted.checks.length + ' restricted' : '') + '; report ' + report.out + '/report.json');
  }
}

module.exports = { runWebAcceptance, root };
