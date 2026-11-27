'use strict';

// End-to-end integration test:
// 1) CloverVet -> Messaging Router -> real Mail for ALL 3 publishers (appointment, clearance, refill)
// 2) Real MCP verification of ASSET_MISSING (via ctx.assets.read) and REFERENCE_INVALID
// 3) Real shared Web Host verification across all 4 workflow API surfaces + env.* denial
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-clovervet-int-'));
  const prepared = prepare(path.join(repoRoot, 'apps/clovervet'), []);
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
              app_id: 'clovervet',
              account_id: 'acct-hannah',
              owner_person_id: 'person-hannah',
              package_root: 'apps/clovervet',
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

    const cvState = path.join(dir, 'cv-state');
    const mailState = path.join(dir, 'mail-state');
    const cvInfra = new Client('clovervet', 'infra', 'cv-mail-run', cvState, 'cv-infra', { registry: prepared.registry });
    const cvAgent = new Client('clovervet', 'agent', 'cv-mail-run', cvState, 'cv-agent', { registry: prepared.registry, profile: 'sandbox' });
    const mailAgent = new Client('mail', 'agent', 'cv-mail-run', mailState, 'mail-reader', { registry: path.join(repoRoot, 'examples/registry.mail.json') });
    const router = new Client(null, null, null, null, 'cv-mail-run', {
      commandArgs: [
        path.join(repoRoot, 'runtime/messaging/service.cjs'),
        '--config', routerConfigPath,
        '--publisher', 'clovervet',
        '--run', 'cv-mail-run',
        '--state-dir', mailState,
      ],
    });
    clients.push(cvInfra, cvAgent, mailAgent, router);
    await Promise.all(clients.map((c) => c.initialize()));

    const initSnap = await cvInfra.call('env.snapshot', {});
    assert.equal((await cvInfra.call('env.reset', { expected_version: initSnap.version, profile: 'sandbox' })).status, 'ready');

    // A. Real MCP checks for ASSET_MISSING (ctx.assets.read) and REFERENCE_INVALID
    const cleoMcp = await cvAgent.call('clovervet.pet.get', { id: 'pet-cleopatra' });
    assert.equal(cleoMcp.status, 'ok');
    assert.ok(cleoMcp.asset_warning && cleoMcp.asset_warning.startsWith('ASSET_MISSING:'), 'Expected ASSET_MISSING over real MCP');

    const badRefMcp = await cvAgent.call('clovervet.clearance.check', {
      pet_id: 'pet-biscuit',
      clearance_type: 'boarding_stay',
      stay_start_at: '2026-11-26T12:00:00+00:00',
      stay_end_at: '2026-12-01T12:00:00+00:00',
      requirement_ref: { kind: 'file_ref', id: 'bad id with spaces' },
    });
    assert.equal(badRefMcp.status, 'ok');
    assert.equal(badRefMcp.eligible, false);
    assert.equal(badRefMcp.requirement_ref_status, 'invalid');
    assert.ok(badRefMcp.reasons.includes('REFERENCE_INVALID'));

    // B. Book appointment & publish all 3 Mail notice types (appointment, clearance, refill)
    const snap = await cvInfra.call('env.snapshot', {});
    const booked = await cvAgent.call('clovervet.appointment.book', {
      id: 'appt-mochi-vax',
      pet_id: 'pet-mochi',
      slot_id: 'slot-oak-01',
      visit_type: 'vaccine_booster',
      expected_version: snap.version,
      request_id: 'req-book-mochi-1',
    });
    assert.equal(booked.status, 'committed');

    const recipient = { kind: 'app_account_ref', app_id: 'mail', id: 'mail-maya' };
    const apptDel = await publisher.publishAppointmentConfirmation({
      agent: cvAgent, router, appointmentId: 'appt-mochi-vax', requestId: 'req-pub-appt-1', sourceAccount: 'acct-hannah', recipient,
    });
    assert.equal(apptDel.stage, 'delivered');
    const apptMail = await mailAgent.call('mail.get', { id: apptDel.receipt.event_id });
    assert.equal(apptMail.message.thread_id, apptDel.message.id);

    const clrDel = await publisher.publishClearanceNotice({
      agent: cvAgent, router, clearanceId: 'cert-biscuit-board-02', requestId: 'req-pub-clr-1', sourceAccount: 'acct-hannah', recipient,
    });
    assert.equal(clrDel.stage, 'delivered');
    const clrMail = await mailAgent.call('mail.get', { id: clrDel.receipt.event_id });
    assert.equal(clrMail.message.thread_id, clrDel.message.id);

    const rflDel = await publisher.publishRefillNotice({
      agent: cvAgent, router, refillId: 'rfl-101', requestId: 'req-pub-rfl-1', sourceAccount: 'acct-hannah', recipient,
    });
    assert.equal(rflDel.stage, 'delivered');
    const rflMail = await mailAgent.call('mail.get', { id: rflDel.receipt.event_id });
    assert.equal(rflMail.message.thread_id, rflDel.message.id);

    // C. Idempotent retry & ungranted refusal without rollback
    const retry = await router.call('router.publish', { request_id: 'req-pub-appt-retry', message: apptDel.message });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.event_id, apptDel.receipt.event_id);

    const refused = await publisher.publishAppointmentConfirmation({
      agent: cvAgent, router, appointmentId: 'appt-mochi-vax', requestId: 'req-pub-cv-denied', sourceAccount: 'acct-hannah',
      recipient: { kind: 'app_account_ref', app_id: 'mail', id: 'mail-ungranted' }, noticeTag: 'denied',
    });
    assert.equal(refused.stage, 'router_rejected');
    assert.equal((await cvAgent.call('clovervet.appointment.get', { id: 'appt-mochi-vax' })).item.status, 'scheduled');

    // D. Reset isolation
    const preReset = await cvInfra.call('env.snapshot', {});
    assert.equal((await cvInfra.call('env.reset', { expected_version: preReset.version, profile: 'sandbox' })).status, 'ready');
    assert.equal((await mailAgent.call('mail.get', { id: apptDel.receipt.event_id })).status, 'ok');

    // E. Shared Web Host end-to-end check across all 4 GUI views + env.* denial
    host = await webHost.start({ app: 'clovervet', registry: prepared.registry, run: 'cv-web-run', stateDir: path.join(dir, 'web-state'), profile: 'sandbox', port: 0 });
    const accessToken = new URL(host.accessUrl).hash.replace(/^#access=/, '');
    const sessRes = await fetch(`${host.url}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: host.url },
      body: JSON.stringify({ token: accessToken }),
    });
    assert.equal(sessRes.status, 200);
    const cookie = sessRes.headers.get('set-cookie').split(';')[0];
    const { csrf } = await sessRes.json();

    const guiJs = await (await fetch(`${host.url}/app.js`)).text();
    assert.ok(guiJs.includes('Vaccinations & Clearances') && guiJs.includes('Prescriptions & Refills'));

    for (const tool of ['clovervet.pet.list', 'clovervet.clearance.list', 'clovervet.appointment.list', 'clovervet.prescription.list']) {
      const apiRes = await fetch(`${host.url}/api/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: host.url, Cookie: cookie, 'x-pale-csrf': csrf },
        body: JSON.stringify({ name: tool, arguments: {} }),
      });
      assert.equal(apiRes.status, 200);
      assert.equal((await apiRes.json()).status, 'ok');
    }
    const deniedAdmin = await fetch(`${host.url}/api/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: host.url, Cookie: cookie, 'x-pale-csrf': csrf },
      body: JSON.stringify({ name: 'env.reset', arguments: {} }),
    });
    assert.equal(deniedAdmin.status, 403);

    return {
      passed: true,
      mcp_asset_warning: cleoMcp.asset_warning,
      mcp_reference_invalid: badRefMcp.reasons,
      mail_threads: [apptMail.message.thread_id, clrMail.message.thread_id, rflMail.message.thread_id],
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
      console.log('PASS: CloverVet real MCP, 3x Mail publishers, and 4-view Web Host integration checks.');
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
