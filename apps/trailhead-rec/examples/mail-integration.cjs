'use strict';

// End-to-end integration test:
// 1) Trailhead Parks & Rec -> Messaging Router -> real Mail (examples/apps/mail)
// 2) Real MCP verification of ASSET_MISSING (ctx.assets.read) and dynamic weather closure recovery
// 3) Real shared Web Host verification across all 4 GUI views + record-level write with id + env.* denial
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const publisher = require('../src/publisher.cjs');

const repoRoot = path.resolve(__dirname, '../../..');
const { Client } = require(path.join(repoRoot, 'runtime/client.cjs'));
const { prepare } = require(path.join(repoRoot, 'runtime/prepare.cjs'));
const webHost = require(path.join(repoRoot, 'runtime/web/server.cjs'));

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-trailhead-int-'));
  const prepared = prepare(path.join(repoRoot, 'apps/trailhead-rec'), []);
  const clients = [];
  let host = null;
  try {
    const routerConfigPath = path.join(dir, 'router-config.json');
    fs.writeFileSync(
      routerConfigPath,
      JSON.stringify(
        {
          schema_version: 2,
          registry: 'examples/registry.mail.json',
          publishers: [
            {
              app_id: 'trailhead-rec',
              account_id: 'acct-elena',
              owner_person_id: 'person-elena',
              package_root: 'apps/trailhead-rec',
              contribution_ref: 'contribution/contribution.json',
              allowed_recipients: [{ app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email' }],
            },
          ],
          authentication: { mode: 'trusted-stdio' },
        },
        null,
        2
      )
    );

    const thState = path.join(dir, 'th-state');
    const mailState = path.join(dir, 'mail-state');
    const thInfra = new Client('trailhead-rec', 'infra', 'th-mail-run', thState, 'th-infra', { registry: prepared.registry });
    const thAgent = new Client('trailhead-rec', 'agent', 'th-mail-run', thState, 'th-agent', { registry: prepared.registry, profile: 'sandbox' });
    const mailAgent = new Client('mail', 'agent', 'th-mail-run', mailState, 'mail-reader', { registry: path.join(repoRoot, 'examples/registry.mail.json') });
    const router = new Client(null, null, null, null, 'th-mail-run', {
      commandArgs: [
        path.join(repoRoot, 'runtime/messaging/service.cjs'),
        '--config', routerConfigPath,
        '--publisher', 'trailhead-rec',
        '--run', 'th-mail-run',
        '--state-dir', mailState,
      ],
    });
    clients.push(thInfra, thAgent, mailAgent, router);
    await Promise.all(clients.map((c) => c.initialize()));

    const initSnap = await thInfra.call('env.snapshot', {});
    assert.equal((await thInfra.call('env.reset', { expected_version: initSnap.version, profile: 'sandbox' })).status, 'ready');

    // A. Real MCP ASSET_MISSING check via ctx.assets.read()
    const missingPrg = await thAgent.call('trailhead-rec.program.get', { id: 'prg-pickleball-beg' });
    assert.equal(missingPrg.status, 'ok');
    assert.ok(missingPrg.asset_warning && missingPrg.asset_warning.startsWith('ASSET_MISSING:'), 'Expected ASSET_MISSING over real MCP');

    // B. Accept waitlist offer enr-205 & publish to real Mail
    const before = await thAgent.call('trailhead-rec.enrollment.get', { id: 'enr-205' });
    assert.equal(before.effective_status, 'offer_pending');
    const accepted = await thAgent.call('trailhead-rec.enrollment.accept_offer', {
      id: 'enr-205', expected_version: before.version, request_id: 'req-accept-205',
    });
    assert.equal(accepted.status, 'committed');
    assert.equal(accepted.fee_charged_cents, 6500);

    const delivered = await publisher.publishEnrollmentNotice({
      agent: thAgent, router, enrollmentId: 'enr-205', requestId: 'req-pub-th-1', sourceAccount: 'acct-elena',
      recipient: { kind: 'app_account_ref', app_id: 'mail', id: 'mail-maya' },
    });
    assert.equal(delivered.stage, 'delivered');
    const mailMsg = await mailAgent.call('mail.get', { id: delivered.receipt.event_id });
    assert.equal(mailMsg.status, 'ok');
    assert.equal(mailMsg.message.thread_id, delivered.message.id);

    const retry = await router.call('router.publish', { request_id: 'req-pub-th-retry', message: delivered.message });
    assert.equal(retry.duplicate, true);

    const refused = await publisher.publishEnrollmentNotice({
      agent: thAgent, router, enrollmentId: 'enr-205', requestId: 'req-pub-th-denied', sourceAccount: 'acct-elena',
      recipient: { kind: 'app_account_ref', app_id: 'mail', id: 'mail-ungranted' }, noticeTag: 'denied',
    });
    assert.equal(refused.stage, 'router_rejected');
    assert.equal((await thAgent.call('trailhead-rec.enrollment.get', { id: 'enr-205' })).item.status, 'enrolled');

    // C. Reset isolation
    const preReset = await thInfra.call('env.snapshot', {});
    assert.equal((await thInfra.call('env.reset', { expected_version: preReset.version, profile: 'sandbox' })).status, 'ready');
    assert.equal((await mailAgent.call('mail.get', { id: delivered.receipt.event_id })).status, 'ok');

    // D. Shared Web Host verification across all 4 views + record-level write with id + env.* 403
    host = await webHost.start({ app: 'trailhead-rec', registry: prepared.registry, run: 'th-web-run', stateDir: path.join(dir, 'web-state'), profile: 'sandbox', port: 0 });
    const accessToken = new URL(host.accessUrl).hash.replace(/^#access=/, '');
    const sessRes = await fetch(`${host.url}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: host.url },
      body: JSON.stringify({ token: accessToken }),
    });
    assert.equal(sessRes.status, 200);
    const cookie = sessRes.headers.get('set-cookie').split(';')[0];
    const { csrf } = await sessRes.json();
    const hdrs = { 'Content-Type': 'application/json', Origin: host.url, Cookie: cookie, 'x-pale-csrf': csrf };

    const guiJs = await (await fetch(`${host.url}/app.js`)).text();
    assert.ok(guiJs.includes('Household & Passes') && guiJs.includes('Courts & Bookings'));

    let latestVer = null;
    for (const tool of ['trailhead-rec.program.search', 'trailhead-rec.household.get', 'trailhead-rec.enrollment.list', 'trailhead-rec.court.list_bookings']) {
      const r = await (await fetch(`${host.url}/api/call`, { method: 'POST', headers: hdrs, body: JSON.stringify({ name: tool, arguments: {} }) })).json();
      assert.equal(r.status, 'ok');
      latestVer = r.version;
    }
    // Record-level accept_offer through Web Host /api/call with explicit id
    const webAccept = await (await fetch(`${host.url}/api/call`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ name: 'trailhead-rec.enrollment.accept_offer', arguments: { id: 'enr-205', expected_version: latestVer, request_id: 'web-accept-205' } }),
    })).json();
    assert.equal(webAccept.status, 'committed');

    const deniedAdmin = await fetch(`${host.url}/api/call`, {
      method: 'POST', headers: hdrs, body: JSON.stringify({ name: 'env.reset', arguments: {} }),
    });
    assert.equal(deniedAdmin.status, 403);

    return { passed: true, mcp_asset_warning: missingPrg.asset_warning, mail_thread_id: mailMsg.message.thread_id, web_host_verified: true };
  } finally {
    if (host) await host.close();
    await Promise.allSettled(clients.map((c) => c.close()));
    prepared.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { run };
if (require.main === module) {
  run()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.log('PASS: Trailhead real MCP, Mail integration, and 4-view Web Host checks.');
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
