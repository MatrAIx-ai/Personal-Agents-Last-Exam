'use strict';

// End-to-end integration test: RecallWatch (apps/recallwatch) -> Messaging Router -> real Mail (examples/apps/mail).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-recallwatch-mail-'));
  const preparedRw = prepare(path.join(repoRoot, 'apps/recallwatch'), []);
  const clients = [];
  let host = null;
  try {
    // Router config referencing real repo paths (no mutations to repo files)
    const routerConfigPath = path.join(dir, 'router-config.json');
    fs.writeFileSync(
      routerConfigPath,
      JSON.stringify(
        {
          schema_version: 2,
          registry: 'examples/registry.mail.json',
          publishers: [
            {
              app_id: 'recallwatch',
              account_id: 'acct-priya',
              owner_person_id: 'person-priya',
              package_root: 'apps/recallwatch',
              contribution_ref: 'contribution/contribution.json',
              allowed_recipients: [
                {
                  app_id: 'mail',
                  account_id: 'mail-maya',
                  channel: 'channel.email',
                },
              ],
            },
          ],
          authentication: { mode: 'trusted-stdio' },
        },
        null,
        2
      )
    );

    const rwStateDir = path.join(dir, 'rw-state');
    const mailStateDir = path.join(dir, 'mail-state');
    const rwInfra = new Client('recallwatch', 'infra', 'rw-mail-run', rwStateDir, 'rw-infra', {
      registry: preparedRw.registry,
    });
    const rwAgent = new Client('recallwatch', 'agent', 'rw-mail-run', rwStateDir, 'rw-agent', {
      registry: preparedRw.registry,
      profile: 'sandbox',
    });
    const mailAgent = new Client('mail', 'agent', 'rw-mail-run', mailStateDir, 'mail-reader', {
      registry: path.join(repoRoot, 'examples/registry.mail.json'),
    });
    const router = new Client(null, null, null, null, 'rw-mail-run', {
      commandArgs: [
        path.join(repoRoot, 'runtime/messaging/service.cjs'),
        '--config',
        routerConfigPath,
        '--publisher',
        'recallwatch',
        '--run',
        'rw-mail-run',
        '--state-dir',
        mailStateDir,
      ],
    });
    clients.push(rwInfra, rwAgent, mailAgent, router);
    await Promise.all(clients.map((c) => c.initialize()));

    // Ensure RecallWatch run starts in sandbox profile so agent writes are authorized
    const initSnap = await rwInfra.call('env.snapshot', {});
    const resetSandbox = await rwInfra.call('env.reset', { expected_version: initSnap.version, profile: 'sandbox' });
    assert.equal(resetSandbox.status, 'ready');

    // 0. Real MCP verification of ASSET_MISSING via ctx.assets.read() on RW-2026-020
    const missingRecall = await rwAgent.call('recallwatch.recall.get', { id: 'RW-2026-020' });
    assert.equal(missingRecall.status, 'ok');
    assert.ok(missingRecall.asset_warning && missingRecall.asset_warning.startsWith('ASSET_MISSING:'));

    // 1. Submit draft claim clm-draft-syrup
    const beforeClaim = await rwAgent.call('recallwatch.claim.get', { id: 'clm-draft-syrup' });
    assert.equal(beforeClaim.status, 'ok');
    const submitted = await rwAgent.call('recallwatch.claim.submit', {
      id: 'clm-draft-syrup',
      expected_version: beforeClaim.version,
      request_id: 'req-submit-syrup-1',
    });
    assert.equal(submitted.status, 'committed');
    assert.equal(submitted.claim_receipt_id, 'rcpt-clm-draft-syrup');

    // 2. Explicit post-commit publish to granted Mail recipient (mail-maya)
    const delivered = await publisher.publishClaimNotification({
      agent: rwAgent,
      router,
      claimId: 'clm-draft-syrup',
      requestId: 'req-pub-syrup-1',
      sourceAccount: 'acct-priya',
      recipient: { kind: 'app_account_ref', app_id: 'mail', id: 'mail-maya' },
    });
    assert.equal(delivered.stage, 'delivered');
    assert.equal(delivered.receipt.status, 'committed');
    assert.equal(delivered.correlation.source_object.object_id, 'clm-draft-syrup');

    // Verify real Mail inbox via mail.get; correlate source_object via sender correlation record
    const mailMsg = await mailAgent.call('mail.get', { id: delivered.receipt.event_id });
    assert.equal(mailMsg.status, 'ok');
    assert.ok(mailMsg.message.body.includes('clm-draft-syrup'));
    assert.ok(mailMsg.message.subject.includes('RW-2026-016'));

    // 3. Idempotent retry with identical message & new request_id deduplicates cleanly
    const retry = await router.call('router.publish', {
      request_id: 'req-pub-syrup-retry',
      message: delivered.message,
    });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.event_id, delivered.receipt.event_id);

    // 4. Ungranted recipient refusal does not roll back RecallWatch claim
    const refused = await publisher.publishClaimNotification({
      agent: rwAgent,
      router,
      claimId: 'clm-draft-syrup',
      requestId: 'req-pub-ungranted',
      sourceAccount: 'acct-priya',
      recipient: { kind: 'app_account_ref', app_id: 'mail', id: 'mail-ungranted' },
    });
    assert.equal(refused.stage, 'router_rejected');
    const claimStillSubmitted = await rwAgent.call('recallwatch.claim.get', { id: 'clm-draft-syrup' });
    assert.equal(claimStillSubmitted.item.status, 'submitted');

    // 5. Resetting RecallWatch restores baseline without clearing Mail inbox
    const snap = await rwInfra.call('env.snapshot', {});
    const reset = await rwInfra.call('env.reset', { expected_version: snap.version, profile: 'sandbox' });
    assert.equal(reset.status, 'ready');
    const afterResetClaim = await rwAgent.call('recallwatch.claim.get', { id: 'clm-draft-syrup' });
    assert.equal(afterResetClaim.item.status, 'draft');
    const mailAfterReset = await mailAgent.call('mail.get', { id: delivered.receipt.event_id });
    assert.equal(mailAfterReset.status, 'ok');

    // 6. Real shared Web Host verification across all 4 GUI views + record-level write + env.reset 403
    host = await webHost.start({
      app: 'recallwatch',
      registry: preparedRw.registry,
      run: 'rw-web-run',
      stateDir: path.join(dir, 'web-state'),
      profile: 'sandbox',
      port: 0,
    });
    const accessToken = new URL(host.accessUrl).hash.replace(/^#access=/, '');
    const sessRes = await fetch(`${host.url}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: host.url },
      body: JSON.stringify({ token: accessToken }),
    });
    assert.equal(sessRes.status, 200);
    const cookie = sessRes.headers.get('set-cookie').split(';')[0];
    const { csrf } = await sessRes.json();
    const hdrs = { 'Content-Type': 'application/json', Origin: host.url, Cookie: cookie, 'x-pale-csrf': csrf };

    const guiJs = await (await fetch(`${host.url}/app.js`)).text();
    assert.ok(guiJs.includes('Household Inventory') && guiJs.includes('Watchlists') && guiJs.includes('Remedy Claims'));

    let latestVer = null;
    for (const tool of ['recallwatch.recall.search', 'recallwatch.inventory.list', 'recallwatch.watchlist.list', 'recallwatch.claim.list']) {
      const r = await (await fetch(`${host.url}/api/call`, {
        method: 'POST', headers: hdrs, body: JSON.stringify({ name: tool, arguments: {} }),
      })).json();
      assert.equal(r.status, 'ok');
      latestVer = r.version;
    }
    const webSubmit = await (await fetch(`${host.url}/api/call`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ name: 'recallwatch.claim.submit', arguments: { id: 'clm-draft-syrup', expected_version: latestVer, request_id: 'web-submit-syrup' } }),
    })).json();
    assert.equal(webSubmit.status, 'committed');

    const deniedAdmin = await fetch(`${host.url}/api/call`, {
      method: 'POST', headers: hdrs, body: JSON.stringify({ name: 'env.reset', arguments: {} }),
    });
    assert.equal(deniedAdmin.status, 403);

    return {
      passed: true,
      mcp_asset_warning: missingRecall.asset_warning,
      claim_receipt_id: submitted.claim_receipt_id,
      mail_event_id: delivered.receipt.event_id,
      correlation: delivered.correlation,
      refused_status: refused.receipt.status,
      web_host_verified: true,
    };
  } finally {
    if (host) await host.close();
    await Promise.allSettled(clients.map((c) => c.close()));
    preparedRw.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { run };
if (require.main === module) {
  run()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      console.log('PASS: 5 RecallWatch-to-Mail real MCP integration checks.');
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
