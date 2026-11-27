'use strict';

// End-to-end integration verification:
// 1) ShelfMark Public Library -> Messaging Router -> real Mail (examples/apps/mail)
//    across all 3 publishers (hold_ready, branch_closure, fine_payment) + idempotent retry + reset isolation
// 2) Real MCP verification of ASSET_MISSING via ctx.assets.read() on br-harbor
// 3) Real shared Web Host verification across all 4 GUI views + record-level write + env.reset 403
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-shelfmark-int-'));
  const prepared = prepare(path.join(repoRoot, 'apps/shelfmark-library'), []);
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
              app_id: 'shelfmark-library',
              account_id: 'acct-maya',
              owner_person_id: 'person-maya',
              package_root: 'apps/shelfmark-library',
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

    const smState = path.join(dir, 'sm-state');
    const mailState = path.join(dir, 'mail-state');
    const smInfra = new Client('shelfmark-library', 'infra', 'sm-mail-run', smState, 'sm-infra', { registry: prepared.registry });
    const smAgent = new Client('shelfmark-library', 'agent', 'sm-mail-run', smState, 'sm-agent', { registry: prepared.registry, profile: 'sandbox' });
    const mailAgent = new Client('mail', 'agent', 'sm-mail-run', mailState, 'mail-reader', { registry: path.join(repoRoot, 'examples/registry.mail.json') });
    const router = new Client(null, null, null, null, 'sm-mail-run', {
      commandArgs: [
        path.join(repoRoot, 'runtime/messaging/service.cjs'),
        '--config', routerConfigPath,
        '--publisher', 'shelfmark-library',
        '--run', 'sm-mail-run',
        '--state-dir', mailState,
      ],
    });
    clients.push(smInfra, smAgent, mailAgent, router);
    await Promise.all(clients.map((c) => c.initialize()));

    const initSnap = await smInfra.call('env.snapshot', {});
    assert.equal((await smInfra.call('env.reset', { expected_version: initSnap.version, profile: 'sandbox' })).status, 'ready');

    // A. Real MCP ASSET_MISSING check via ctx.assets.read() on br-harbor (ttl-911 / hld-405)
    const harborTitle = await smAgent.call('shelfmark-library.catalog.get', { title_id: 'ttl-911' });
    assert.equal(harborTitle.status, 'ok');
    assert.equal(harborTitle.asset_warnings.length, 1);
    assert.equal(harborTitle.asset_warnings[0].code, 'ASSET_MISSING');
    assert.equal(harborTitle.asset_warnings[0].asset_id, 'asset-missing-map');

    const harborHold = await smAgent.call('shelfmark-library.hold.get', { hold_id: 'hld-405' });
    assert.equal(harborHold.status, 'ok');
    assert.equal(harborHold.branch_asset_warning.code, 'ASSET_MISSING');

    // B. Publisher 1: hold_ready notice + Mail delivery & thread_id correlation
    const recipient = { kind: 'app_account_ref', app_id: 'mail', id: 'mail-maya' };
    const p1 = await publisher.publishHoldReadyNotice({
      agent: smAgent,
      router,
      holdId: 'hld-401',
      requestId: 'sm-pub-hold-1',
      sourceAccount: 'acct-maya',
      recipient,
      noticeTag: 'ready1',
    });
    assert.equal(p1.stage, 'delivered');

    // Idempotent retry
    const retry = await router.call('router.publish', { request_id: 'sm-pub-hold-1-retry', message: p1.message });
    assert.equal(retry.duplicate, true);

    // Ungranted recipient rejected without affecting local ShelfMark state
    const refused = await publisher.publishHoldReadyNotice({
      agent: smAgent,
      router,
      holdId: 'hld-401',
      requestId: 'sm-pub-hold-denied',
      sourceAccount: 'acct-maya',
      recipient: { kind: 'app_account_ref', app_id: 'mail', id: 'mail-ungranted' },
      noticeTag: 'denied',
    });
    assert.equal(refused.stage, 'router_rejected');
    assert.equal((await smAgent.call('shelfmark-library.hold.get', { hold_id: 'hld-401' })).hold.status, 'ready_for_pickup');

    // C. Publisher 2: branch.closure event -> branch_closure notice
    const evSnap = await smInfra.call('env.snapshot', {});
    const closureEv = await smInfra.call('env.apply_event', {
      expected_version: evSnap.version,
      event: {
        event_id: 'evt-int-closure-1',
        at: '2026-11-20T07:00:00+00:00',
        operation: 'branch.closure',
        payload: { branch_id: 'br-westside', closed_until: '2026-11-22T09:00:00+00:00', reason: 'HVAC maintenance' },
      },
    });
    assert.equal(closureEv.status, 'committed');

    const p2 = await publisher.publishBranchClosureNotice({
      router,
      branchId: 'br-westside',
      closedUntil: '2026-11-22T09:00:00+00:00',
      reason: 'HVAC maintenance',
      extendedHoldIds: ['hld-401'],
      cancelledBookingIds: ['rmb-201'],
      requestId: 'sm-pub-closure-1',
      sourceAccount: 'acct-maya',
      recipient,
      time: '2026-11-20T07:00:00+00:00',
      noticeTag: 'close1',
    });
    assert.equal(p2.stage, 'delivered');

    // D. Publisher 3: fine.pay -> fine_payment receipt
    const paySnap = await smInfra.call('env.snapshot', {});
    const paid = await smAgent.call('shelfmark-library.fine.pay', {
      card_id: 'card-leo',
      fine_ids: ['fin-202'],
      payment_method: 'card_on_file',
      expected_version: paySnap.version,
      request_id: 'sm-int-pay-202',
    });
    assert.equal(paid.status, 'committed');
    const p3 = await publisher.publishFinePaymentReceipt({
      router,
      receipt: paid,
      requestId: 'sm-pub-receipt-1',
      sourceAccount: 'acct-maya',
      recipient,
      time: '2026-11-20T07:05:00+00:00',
      noticeTag: 'rcpt1',
    });
    assert.equal(p3.stage, 'delivered');

    // Verify all 3 messages landed in real Mail inbox with thread_id === wire.id
    const expectedIds = [];
    for (const p of [p1, p2, p3]) {
      const m = await mailAgent.call('mail.get', { id: p.receipt.event_id });
      assert.equal(m.status, 'ok');
      assert.equal(m.message.thread_id, p.message.id);
      expectedIds.push(p.message.id);
    }

    // E. env.reset isolation: resets ShelfMark without clearing Mail
    const preResetSnap = await smInfra.call('env.snapshot', {});
    const resetRes = await smInfra.call('env.reset', { expected_version: preResetSnap.version, profile: 'sandbox' });
    assert.equal(resetRes.status, 'ready');
    assert.equal((await mailAgent.call('mail.get', { id: p1.receipt.event_id })).status, 'ok');

    // F. Real shared Web Host verification across all 4 views + record-level write + env.reset 403
    host = await webHost.start({
      app: 'shelfmark-library',
      run: 'sm-web-run',
      stateDir: path.join(dir, 'web-state'),
      registry: prepared.registry,
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
    assert.ok(guiJs.includes('Cards & Fines') && guiJs.includes('Holds & Loans') && guiJs.includes('Study Rooms & Passes'));

    let latestVer = null;
    for (const tool of [
      'shelfmark-library.catalog.search',
      'shelfmark-library.card.list',
      'shelfmark-library.hold.list',
      'shelfmark-library.loan.list',
      'shelfmark-library.fine.list',
      'shelfmark-library.room.search',
      'shelfmark-library.room.list_bookings',
    ]) {
      const r = await (await fetch(`${host.url}/api/call`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ name: tool, arguments: {} }),
      })).json();
      assert.equal(r.status, 'ok');
      latestVer = r.version;
    }

    // Record-level write through Web Host /api/call
    const webRenew = await (await fetch(`${host.url}/api/call`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        name: 'shelfmark-library.loan.renew',
        arguments: { loan_id: 'ln-302', expected_version: latestVer, request_id: 'web-renew-302' },
      }),
    })).json();
    assert.equal(webRenew.status, 'committed');

    // Infra admin tool denied with 403
    const deniedAdmin = await fetch(`${host.url}/api/call`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ name: 'env.reset', arguments: {} }),
    });
    assert.equal(deniedAdmin.status, 403);

    return {
      passed: true,
      mcp_asset_warning: harborTitle.asset_warnings[0],
      mail_thread_ids: expectedIds,
      web_host_verified: true,
    };
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
      console.log('PASS: ShelfMark real MCP, 3x Mail publishers, and 4-view Web Host checks.');
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
