'use strict';

// Real Chromium browser acceptance & screenshot capture for RecallWatch (apps/recallwatch).
// Drives Chrome DevTools Protocol (CDP) over Node 22 native WebSocket with zero external packages.
// Usage:
//   CHROMIUM_BIN=/path/to/chrome-headless-shell node apps/recallwatch/examples/browser-evidence.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const { Client } = require(path.join(repoRoot, 'runtime/client.cjs'));
const { prepare } = require(path.join(repoRoot, 'runtime/prepare.cjs'));
const webHost = require(path.join(repoRoot, 'runtime/web/server.cjs'));

const OUT_DIR = path.join(__dirname, '../evidence/screenshots');
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Set CHROMIUM_BIN to a local Chromium / chrome-headless-shell executable.');
}

async function launchChromium(bin) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-cdp-profile-'));
  const proc = spawn(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,900',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chromium startup timeout:\n${stderr}`)), 15000);
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited (${code}):\n${stderr}`));
    });
  });

  const baseHttp = wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '');
  const versionInfo = await (await fetch(`${baseHttp}/json/version`)).json();
  const target = await (await fetch(`${baseHttp}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const pageErrors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails.text || 'Runtime exception');
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', VIEWPORT);

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'JS eval error');
    return r.result ? r.result.value : undefined;
  };

  const waitFor = async (predicateExpr, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await evalJs(predicateExpr)) return;
      await new Promise((r) => setTimeout(r, 120));
    }
    throw new Error(`Timed out waiting for: ${predicateExpr}`);
  };

  const screenshot = async (filename) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const dest = path.join(OUT_DIR, filename);
    fs.writeFileSync(dest, Buffer.from(data, 'base64'));
    return dest;
  };

  const close = async () => {
    try { ws.close(); } catch {}
    if (proc.exitCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill('SIGKILL');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
    }
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  };

  return { version: versionInfo.Browser, pageErrors, send, evalJs, waitFor, screenshot, close };
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bin = findChromium();
  const cdp = await launchChromium(bin);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-rw-browser-'));
  const prepared = prepare(path.join(repoRoot, 'apps/recallwatch'), []);
  let host = null;
  let infra = null;
  const captured = [];

  try {
    // 1. Capture live public reference site (CPSC.gov Recalls) unless SKIP_REF=1
    let refStatus = 'skipped';
    if (process.env.SKIP_REF !== '1') {
      try {
        await cdp.send('Page.navigate', { url: 'https://www.cpsc.gov/Recalls' });
        await cdp.waitFor('document.readyState === "complete" && document.body && document.body.innerText.length > 200', 15000);
        await new Promise((r) => setTimeout(r, 1200));
        await cdp.screenshot('01-ref-cpsc-recalls.png');
        captured.push('01-ref-cpsc-recalls.png');
        refStatus = 'captured_live';
      } catch (err) {
        refStatus = `unavailable: ${err.message}`;
      }
    }

    // 2. Start real PALE shared Web Host + Infra inspector on the same stateDir/run
    const stateDir = path.join(dir, 'state');
    host = await webHost.start({
      app: 'recallwatch',
      registry: prepared.registry,
      run: 'rw-browser-evidence',
      stateDir,
      profile: 'sandbox',
      port: 0,
    });
    infra = new Client('recallwatch', 'infra', 'rw-browser-evidence', stateDir, 'rw-browser-infra', { registry: prepared.registry });
    await infra.initialize();

    // Open real Web Host accessUrl in Chromium
    await cdp.send('Page.navigate', { url: host.accessUrl });
    await cdp.waitFor('document.querySelectorAll("[data-view=recalls] .card").length >= 10');
    await cdp.screenshot('02-recalls-view.png');
    captured.push('02-recalls-view.png');

    // View 2: Click Household Inventory tab
    await cdp.evalJs('document.querySelector("button[data-tab=inventory]").click()');
    await cdp.waitFor('document.querySelectorAll("[data-view=inventory] .card").length >= 10');
    await cdp.screenshot('03-inventory-view.png');
    captured.push('03-inventory-view.png');

    // View 3: Click Watchlists tab
    await cdp.evalJs('document.querySelector("button[data-tab=watchlists]").click()');
    await cdp.waitFor('document.querySelectorAll("[data-view=watchlists] .card").length >= 5');
    await cdp.screenshot('04-watchlists-view.png');
    captured.push('04-watchlists-view.png');

    // View 4: Click Remedy Claims tab -> Test invalid proof-required submission (omitting proof_ref)
    await cdp.evalJs('document.querySelector("button[data-tab=claims]").click()');
    await cdp.waitFor('!!document.querySelector("#claim-create-submit-btn")');
    const claimsBefore = (await infra.call('env.snapshot', {})).snapshot.data.claims.length;

    await cdp.evalJs('document.querySelector("#claim-create-submit-btn").click()');
    await cdp.waitFor('!!document.querySelector("[role=alert]") && document.querySelector("[role=alert]").innerText.includes("PROOF_REQUIRED")');
    assert.equal((await infra.call('env.snapshot', {})).snapshot.data.claims.length, claimsBefore, 'Rejected proof-required claim must not persist');
    await cdp.screenshot('05-claims-proof-rejected.png');
    captured.push('05-claims-proof-rejected.png');

    // Fill structured proof_ref id and click Create & Submit Proof-Required Claim
    await cdp.evalJs(`(() => {
      const inp = document.querySelector('#claim-proof-id');
      inp.value = 'rcpt-oat-daycare-2026';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#claim-create-submit-btn').click();
    })()`);
    await cdp.waitFor('!!document.querySelector("[role=status]") && document.querySelector("[role=status]").innerText.includes("Receipt: rcpt-")');
    const snapAfterSubmit = await infra.call('env.snapshot', {});
    const newClaim = snapAfterSubmit.snapshot.data.claims.find((c) => c.recall_id === 'RW-2026-014' && c.item_id === 'item-oat-daycare');
    assert.ok(newClaim, 'Persisted claim for RW-2026-014 must exist in MCP snapshot');
    assert.equal(newClaim.status, 'submitted');
    assert.ok(newClaim.claim_receipt_id && newClaim.claim_receipt_id.startsWith('rcpt-'));
    await cdp.screenshot('06-claims-proof-submitted.png');
    captured.push('06-claims-proof-submitted.png');

    // Reload browser page & verify persisted claim survives full reload
    await cdp.send('Page.reload');
    await cdp.waitFor('document.querySelectorAll("[data-view=recalls] .card").length >= 10');
    await cdp.evalJs('document.querySelector("button[data-tab=claims]").click()');
    await cdp.waitFor(`!!document.querySelector('[data-record-id="${newClaim.id}"]')`);
    const reloadedText = await cdp.evalJs(`document.querySelector('[data-record-id="${newClaim.id}"]').innerText`);
    assert.ok(reloadedText.includes(newClaim.claim_receipt_id), 'Reloaded GUI must display persisted receipt');

    // Apply independent Infra event (claim.status_changed -> approved_refund) and verify GUI Refresh shows it
    const applied = await infra.call('env.apply_event', {
      expected_version: snapAfterSubmit.version,
      event: {
        event_id: 'evt-browser-approve-001',
        at: '2026-11-19T16:00:00+00:00',
        operation: 'claim.decision',
        payload: {
          claim_id: newClaim.id,
          decision: 'approved_refund',
          amount_cents: 1850,
          note: 'Approved after lot & receipt check',
        },
      },
    });
    assert.equal(applied.status, 'committed');
    await cdp.evalJs('document.querySelector("#refresh-btn").click()');
    await cdp.waitFor(`document.querySelector('[data-record-id="${newClaim.id}"]').innerText.includes("approved_refund")`);
    await cdp.screenshot('07-claims-after-reload-and-mcp.png');
    captured.push('07-claims-after-reload-and-mcp.png');

    // Verify direct browser call to forbidden Infra tool returns HTTP 403
    const forbiddenStatus = await cdp.evalJs(`(async () => {
      const s = await (await fetch('/session')).json();
      const r = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pale-csrf': s.csrf },
        body: JSON.stringify({ name: 'env.reset', arguments: {} })
      });
      return r.status;
    })()`);
    assert.equal(forbiddenStatus, 403);
    assert.equal(cdp.pageErrors.length, 0, `Unexpected browser page errors: ${cdp.pageErrors.join('; ')}`);

    return {
      passed: true,
      browser: cdp.version,
      node: process.version,
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      reference_capture: refStatus,
      screenshots: captured,
      persisted_claim_id: newClaim.id,
      persisted_receipt_id: newClaim.claim_receipt_id,
      post_event_status: 'approved_refund',
      forbidden_env_reset_status: forbiddenStatus,
      page_errors: cdp.pageErrors.length,
    };
  } finally {
    await cdp.close();
    if (host) await host.close();
    if (infra) await infra.close();
    prepared.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
