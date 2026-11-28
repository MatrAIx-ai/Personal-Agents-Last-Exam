'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../../..');
const { start } = require(path.join(root, 'runtime/web/server.cjs'));
const { Client } = require(path.join(root, 'runtime/client.cjs'));
const { digestTree } = require(path.join(root, 'runtime/verify.cjs'));
const { createRuntime } = require(path.join(root, 'runtime/core/runtime.cjs'));

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function session(browser, options) {
  const cleanup = [];
  const undo = async () => { for (const close of cleanup.splice(0).reverse()) await close().catch(() => {}); };
  try { return await open(browser, options, cleanup, undo); }
  catch (e) { await undo(); throw e; }
}

async function open(browser, { app, appDir, stateDir, run, profile, timezoneId, locale, registry, report }, cleanup, undo) {
  const host = await start({ app, stateDir, run, profile, registry });
  cleanup.push(() => host.close());
  const infra = new Client(app, 'infra', host.run, stateDir, 'web-acceptance-inspector', { registry: host.registry });
  cleanup.push(() => infra.close());
  await infra.initialize();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId, locale });
  cleanup.push(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [], consoleErrors = [], allowed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  let events = 0;
  const s = {
    host, infra, page, errors, consoleErrors, run: host.run, stateDir,
    allowConsole(pattern) { allowed.push(pattern); },
    unexpectedConsole() { return consoleErrors.filter(text => !allowed.some(p => p.test(text))); },
    async open(ready) { await page.goto(host.accessUrl); await page.locator(ready).first().waitFor(); await s.idle(); },
    async idle() { await page.locator('#app[aria-busy=false]').waitFor(); },
    async settled() { await page.waitForFunction(() => { const status = document.getElementById('status'); return document.querySelector('#app').getAttribute('aria-busy') === 'false' && (status.textContent === 'All changes saved' || status.dataset.error === 'true' || status.dataset.settled === 'true'); }); },
    async refresh() { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await s.settled(); },
    async snapshot() { return (await infra.call('env.snapshot')).snapshot; },
    async data() { return (await s.snapshot()).data; },
    async version() { return (await infra.call('env.snapshot')).version; },
    async agent(name, args = {}) { return host.client.call(app + '.' + name, args); },
    async event(operation, payload, at) {
      const snap = await s.snapshot();
      const event = { event_id: 'web-' + operation.replace(/\W/g, '-') + '-' + (++events), at: at || snap.virtual_now, operation, payload };
      const r = await infra.call('env.apply_event', { expected_version: await s.version(), event });
      assert.equal(r.status, 'committed', 'Infra event ' + event.event_id + ': ' + JSON.stringify(r));
      report.receipts.push({ kind: 'infra_event', event_id: event.event_id, operation, status: r.status, version: r.version });
      return r;
    },
    async advance(at) {
      const r = await infra.call('env.advance_time', { expected_version: await s.version(), virtual_now: at, request_id: 'web-advance-' + at.replace(/\W/g, '') });
      assert.equal(r.status, 'committed', 'Clock advance: ' + JSON.stringify(r));
      report.receipts.push({ kind: 'infra_clock', virtual_now: at, status: r.status });
      return r;
    },
    confirm(token, by) {
      const out = JSON.parse(execFileSync(process.execPath, [path.join(appDir, 'dev/confirm.cjs'), host.run, token, '--state-dir', stateDir, '--registry', host.registry, ...(by ? ['--by', by] : [])], { encoding: 'utf8' }));
      assert.equal(out.status, 'committed', 'dev/confirm.cjs: ' + JSON.stringify(out));
      report.receipts.push({ kind: 'user_confirmed', via: 'dev/confirm.cjs', token, confirmed_by: out.confirmed_by, at: out.at, version: out.version });
      return out;
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
    async beforeForward(match, during, failNext = false) {
      const seen = { hit: false, failed: false, failedCall: null };
      const fails = typeof failNext === 'function' ? failNext : () => failNext === true;
      await page.route('**/api/call', async route => {
        const payload = route.request().postDataJSON();
        if (!seen.hit && match(payload)) { seen.hit = true; await during(); await route.continue(); }
        else if (seen.hit && !seen.failed && fails(payload)) { seen.failed = true; seen.failedCall = payload.name; await route.abort('failed'); }
        else await route.continue();
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
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: file, fullPage: true });
      report.screenshots.push(path.relative(root, file));
    },
    async overflow(width) {
      await page.setViewportSize({ width, height: 844 });
      return page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    },
    close: undo
  };
  return s;
}

async function capture(t, evidence, workflow, index, step) {
  const { page } = t;
  const name = String(index).padStart(2, '0') + '-' + slug(step.title) + '.jpg';
  const dir = path.join(evidence.dir, workflow.id);
  fs.mkdirSync(dir, { recursive: true });
  const marked = step.focus ? await page.locator(step.focus).first().elementHandle().catch(() => null) : null;
  if (marked) {
    await marked.scrollIntoViewIfNeeded().catch(() => {});
    await marked.evaluate(n => { n.dataset.evidenceOutline = n.style.outline || ''; n.style.outline = '3px solid #d9480f'; n.style.outlineOffset = '2px'; });
  }
  await page.screenshot({ path: path.join(dir, name), type: 'jpeg', quality: 70 });
  if (marked) await marked.evaluate(n => { n.style.outline = n.dataset.evidenceOutline; n.style.outlineOffset = ''; delete n.dataset.evidenceOutline; }).catch(() => {});
  return workflow.id + '/' + name;
}

async function runWorkflows(t, workflows, evidence) {
  const done = [];
  for (const workflow of workflows) {
    console.log(workflow.title);
    const rows = [];
    let index = 0;
    for (const step of workflow.steps) {
      const before = t.report.checks.length;
      const observed = await step.run(t);
      await t.settled();
      if (t.report.checks.length === before) throw Error('Step "' + step.title + '" passed no check');
      index++;
      const shot = evidence ? await capture(t, evidence, workflow, index, step) : null;
      rows.push({ index, title: step.title, action: step.action, expected: step.expected, observed: observed || '', shot });
    }
    done.push({ id: workflow.id, title: workflow.title, summary: workflow.summary || '', rows });
  }
  return done;
}

function writeEvidence(evidence, report, sequences) {
  const cell = text => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = ['# ' + evidence.title + ' GUI workflow sequences', '',
    'Generated by `' + report.command + '` from the repository root. Each row is one step of the browser acceptance run: the action taken with the real page controls, what the step expects, and what was observed, read back through the Infra MCP snapshot or the Agent MCP reads of the same run. The outlined element in each screenshot is the one the step checks.', '',
    '| Field | Value |', '| --- | --- |',
    '| App | `' + report.app + '` ' + report.app_version + ' |',
    '| Page and controller | `gui/index.html`, `gui/src/app.js` (sha256 `' + report.controller_sha256.slice(0, 16) + '…`) |',
    '| Host | `' + report.host + '` (sha256 `' + report.host_sha256.slice(0, 16) + '…`), shared client sha256 `' + report.client_sha256.slice(0, 16) + '…` |',
    '| Runtime / Core API | ' + report.runtime_version + ' / ' + report.core_api_version + ' |',
    '| Browser | ' + report.browser + ', Playwright ' + report.playwright + ', Node ' + report.node + ' |',
    '| Viewport | 1280 × 900 (narrow checks at 390 × 844) |',
    '| Browser time zone | ' + report.browser_timezone + ' (the page shows America/New_York) |',
    '| Run / account | `' + report.run + '`, ' + evidence.account + ' |',
    '| Registry | `' + report.registry + '` |',
    '| Captured | ' + report.checked_at + ' |', '',
    'Browser checks passed: ' + report.checks.length + (report.restricted ? ' + ' + report.restricted.checks.length + ' in the restricted-policy run' : '') + '. Machine-readable report: `report.json` in the run folder printed by the same command.', ''];
  for (const s of sequences) {
    lines.push('## ' + s.title, '');
    if (s.summary) lines.push(s.summary, '');
    lines.push('| # | Screenshot | Action | Expected | Observed |', '| --- | --- | --- | --- | --- |');
    for (const r of s.rows) lines.push('| ' + r.index + ' | ' + (r.shot ? '[' + path.basename(r.shot) + '](' + r.shot + ')' : '—') + ' | ' + cell(r.action) + ' | ' + cell(r.expected) + ' | ' + cell(r.observed) + ' |');
    lines.push('');
  }
  fs.writeFileSync(path.join(evidence.dir, 'README.md'), lines.join('\n'));
}

async function runWebAcceptance({ app, appDir, workflows, restricted, timezoneId = 'UTC', locale = 'en-US', launchArgs = [], registry = path.join(root, 'apps.registry.json'), evidence = null, strictChecks = false }) {
  if (evidence && fs.existsSync(evidence.dir) && (!fs.statSync(evidence.dir).isDirectory() || fs.readdirSync(evidence.dir).length)) {
    console.error('Evidence folder ' + evidence.dir + ' is not an empty folder; pass --evidence with an empty or new folder. Nothing was run and nothing was removed.');
    process.exitCode = 1;
    return;
  }
  const out = path.resolve(process.env.PALE_WEB_REPORT_DIR || path.join(root, '.artifacts/web', app, new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid));
  fs.mkdirSync(out, { recursive: true });
  if (evidence) fs.mkdirSync(evidence.dir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
  const report = {
    schema: 'pale.web-acceptance.v1', app, app_version: manifest.version, package_sha256: digestTree(appDir),
    controller_sha256: sha(path.join(appDir, 'gui/src/app.js')), host_sha256: sha(path.join(root, 'runtime/web/server.cjs')), client_sha256: sha(path.join(root, 'runtime/web/client.js')),
    checked_at: new Date().toISOString(), node: process.version, browser: null,
    playwright: require('playwright/package.json').version, runtime_version: require(path.join(root, 'runtime/package.json')).version,
    core_api_version: null, host: 'runtime/web/server.cjs', registry: path.relative(root, registry), run: app + '-web',
    command: 'node ' + path.relative(root, require.main.filename) + (evidence ? ' --evidence <empty-dir>' : ''), browser_timezone: timezoneId, browser_locale: locale,
    checks: [], receipts: [], screenshots: [], workflows: [], restricted: null, passed: false, out
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-' + app + '-web-'));
  const check = list => (name, condition) => {
    if (strictChecks && typeof condition !== 'boolean') throw Error('Check "' + name + '" has no true/false condition');
    assert.ok(condition === undefined ? true : condition, name); list.push(name); console.log('  ✓ ' + name);
  };
  let s, r, browser;
  try {
    report.core_api_version = createRuntime({ registryFile: registry }).registry.api;
    browser = await chromium.launch({ headless: true, args: ['--lang=' + locale, ...launchArgs], env: { ...process.env, LANG: locale.replace('-', '_') + '.UTF-8' } });
    report.browser = 'chromium ' + browser.version();
    s = await session(browser, { app, appDir, stateDir, run: app + '-web', profile: 'sandbox', timezoneId, locale, registry, report });
    const t = { ...s, check: check(report.checks), report };
    try { report.workflows = await runWorkflows(t, workflows(t), evidence); }
    catch (e) { await s.shot('failed').catch(() => {}); throw e; }
    check(report.checks)('No JavaScript errors and no console or CSP errors beyond the induced network failures and refusals', s.errors.length === 0 && s.unexpectedConsole().length === 0);
    report.console_errors = { seen: s.consoleErrors.length, unexpected: s.unexpectedConsole(), page_errors: s.errors };
    if (restricted) {
      const checks = [];
      r = await session(browser, { app, appDir, stateDir, run: app + '-web-restricted', profile: 'sandbox', timezoneId, locale, registry, report });
      try { await restricted({ ...r, check: check(checks), report }); }
      catch (e) { await r.shot('restricted-failed').catch(() => {}); throw e; }
      check(checks)('No JavaScript errors and no console or CSP errors beyond the induced refusals', r.errors.length === 0 && r.unexpectedConsole().length === 0);
      report.restricted = { passed: true, checks };
    }
    report.passed = true;
    if (evidence) writeEvidence(evidence, report, report.workflows);
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

module.exports = { runWebAcceptance, runWorkflows, root };
