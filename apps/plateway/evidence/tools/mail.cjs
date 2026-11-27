'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const appDir = path.resolve(__dirname, '..', '..');
const root = path.resolve(appDir, '..', '..');
const OUT = path.join(appDir, 'evidence', 'mail');
const { start } = require(path.join(root, 'runtime/web/server.cjs'));
const { Client } = require(path.join(root, 'runtime/client.cjs'));
const { create: createRouter } = require(path.join(root, 'runtime/messaging/src/router.cjs'));
const sender = require('../../infra/sender.cjs');
const { runtimeDigest, hostRevision } = require('./digest.cjs');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const versionOf = v => v.epoch + '.' + v.revision;
const MAIL_ACCOUNT = { app_id: 'mail', account_id: 'mail-p-1', owner_person_id: 'p-1' };
const RUN = 'mail-gui-demo';
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');

function integration(scratch) {
  const trail = path.join(scratch, 'trail.json');
  execFileSync(process.execPath, ['tests/mail.integration.cjs', '--evidence', trail], { cwd: appDir, stdio: 'inherit' });
  const t = read(trail);
  assert.equal(t.passed, true, 'Mail integration failed');
  return t;
}

async function guiDemo(scratch) {
  const plateState = path.join(scratch, 'plateway-state'), mailState = path.join(scratch, 'mail-state');
  const opened = [], steps = [];
  const track = async c => { opened.push(c); await c.initialize(); return c; };
  let browser, plateHost, mailHost, router;
  try {
    const mailInfra = await track(new Client('mail', 'infra', RUN, mailState, 'evidence-mail-infra', { registry: MAIL_REGISTRY }));
    const dataset = read(path.join(root, 'examples/apps/mail/contribution/dataset.json'));
    dataset.dataset_id = 'plateway-mail-demo';
    dataset.expected_counts = { records: 0, assets: 0 };
    const loaded = await mailInfra.call('env.load_seed', {
      expected_version: (await mailInfra.call('env.snapshot')).version, request_id: 'mail-demo-seed',
      bundle: { dataset, catalog: { schema_version: 'pale.asset-catalog.v1', catalog_id: 'plateway-mail-demo-empty', app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: [] }, blobs: {} },
      data: { account_id: MAIL_ACCOUNT.account_id, owner_person_id: MAIL_ACCOUNT.owner_person_id, address: MAIL_ACCOUNT.account_id + '@pale.example', messages: [] },
      binding: { people: [{ person_id: 'p-1', name: 'Jordan Lee' }], accounts: [MAIL_ACCOUNT], objects: {} },
      policies: read(path.join(root, 'examples/apps/mail/fixtures/policies.json'))
    });
    assert.equal(loaded.status, 'ready');
    plateHost = await start({ app: 'plateway', run: RUN, stateDir: plateState, profile: 'sandbox', registry: path.join(root, 'apps.registry.json') });
    const plateInfra = await track(new Client('plateway', 'infra', RUN, plateState, 'evidence-plateway-infra', { registry: path.join(root, 'apps.registry.json') }));
    const s0 = await plateInfra.call('env.snapshot');
    const binding = structuredClone(s0.snapshot.binding);
    binding.accounts.push(MAIL_ACCOUNT);
    assert.equal((await plateInfra.call('env.load_seed', { expected_version: s0.version, data: s0.snapshot.data, binding, request_id: 'mail-demo-bind' })).status, 'ready');
    mailHost = await start({ app: 'mail', run: RUN, stateDir: mailState, profile: 'sandbox', registry: MAIL_REGISTRY });
    const mailAgent = await track(new Client('mail', 'agent', RUN, mailState, 'evidence-mail-agent', { registry: MAIL_REGISTRY }));
    const pSnap = async () => plateInfra.call('env.snapshot');
    const mSnap = async () => mailInfra.call('env.snapshot');
    const initialP = await pSnap(), initialM = await mSnap();
    const initial = {
      plateway: { run_id: initialP.snapshot.run_id, account_id: initialP.snapshot.data.account_id, owner_person_id: initialP.snapshot.data.owner_person_id, version: versionOf(initialP.version), virtual_now: initialP.snapshot.virtual_now, orders: initialP.snapshot.data.orders.length, notices_in_seed: initialP.snapshot.initial_data.notices.length, bound_accounts: initialP.snapshot.binding.accounts },
      mail: { run_id: initialM.snapshot.run_id, account_id: initialM.snapshot.data.account_id, owner_person_id: initialM.snapshot.data.owner_person_id, address: initialM.snapshot.data.address, version: versionOf(initialM.version), virtual_now: initialM.snapshot.virtual_now, messages: initialM.snapshot.data.messages.length }
    };

    browser = await chromium.launch({ headless: true, args: ['--lang=en-US', '--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'], env: { ...process.env, LANG: 'en_US.UTF-8' } });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/New_York', locale: 'en-US' });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const shot = async name => { const file = 'gui/' + name + '.png'; await idle(); await page.mouse.move(1, 1); await page.waitForTimeout(400); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(OUT, file) }); return file; };
    const flash = text => page.locator('[data-flash]', { hasText: text }).waitFor();
    const pick = async item => { await page.locator('nav').getByRole('button', { name: /Restaurants/ }).click(); await page.locator('[data-restaurant-id=r-1]').click(); await page.locator('[data-item-id=' + item + ']').click(); await page.locator('[data-action=add-to-cart]').click(); };
    const checkout = async () => {
      await page.locator('nav').getByRole('button', { name: /Cart/ }).click();
      await idle();
      await page.locator('[data-action=preview]').click();
      await page.locator('[data-action=place-order]').waitFor();
      await idle();
      await page.locator('[data-action=place-order]').click();
      await page.locator('article[data-order][data-status=submitted]').waitFor();
      await idle();
      return page.locator('article[data-order]').getAttribute('data-order');
    };
    const pendingNow = async () => sender.pending((await pSnap()).snapshot).map(n => n.id + ' ' + n.kind);
    await page.goto(plateHost.accessUrl);
    await page.locator('[data-restaurant-id=r-1]').waitFor();
    await idle();
    await pick('mi-3');
    await flash('Added Tom Yum Soup');
    await pick('mi-4');
    await flash('Added Fresh Spring Rolls');
    await page.locator('nav').getByRole('button', { name: /Cart/ }).click();
    await idle();
    await page.locator('[data-field=tip]').fill('2.00');
    const orderId = await checkout();
    const afterPlace = await pSnap();
    steps.push({ step: 1, app: 'Plateway (GUI)', action: 'Add Tom Yum Soup and Fresh Spring Rolls, open Cart, tip $2.00, Preview total, Place order', expected: 'Local commit in Plateway: one order and a notice.order_placed entry in its notice log; nothing is sent yet', observed: { order_id: orderId, status: afterPlace.snapshot.data.orders.find(o => o.id === orderId).status, pending_notices: await pendingNow(), mail_messages: (await mSnap()).snapshot.data.messages.length }, version: 'plateway ' + versionOf(afterPlace.version), screenshot: await shot('01-plateway-order-placed') });

    let n = 0;
    const event = async (operation, at, extra = {}) => { const r = await plateInfra.call('env.apply_event', { expected_version: (await pSnap()).version, event: { event_id: 'mail-demo-e' + (++n), at, operation, payload: { order_id: orderId, ...extra } } }); assert.equal(r.status, 'committed'); return operation + ' ' + r.status; };
    const lifecycle = [await event('order.accepted', '2026-11-18T12:04:00-05:00'), await event('order.delayed', '2026-11-18T12:10:00-05:00', { estimated_delivery: '2026-11-18T12:50:00-05:00' }), await event('order.picked_up', '2026-11-18T12:25:00-05:00'), await event('order.delivered', '2026-11-18T12:45:00-05:00')];
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('article[data-order="' + orderId + '"][data-status=delivered]').waitFor();
    const delivered = await pSnap();
    steps.push({ step: 2, app: 'Plateway (Infra events, then GUI Refresh)', action: 'Infra applies order.accepted, order.delayed (new estimate 12:50), order.picked_up and order.delivered, as a task runner would; press Refresh', expected: 'Delivered; accepted, delayed and delivered notices join the placed one in Plateway\'s log (pickup has none); Mail is still empty', observed: { events: lifecycle, pending_notices: await pendingNow(), mail_messages: (await mSnap()).snapshot.data.messages.length }, version: 'plateway ' + versionOf(delivered.version), screenshot: await shot('02-plateway-delivered') });

    const soup = delivered.snapshot.data.orders.find(o => o.id === orderId).lines.find(l => l.item_id === 'mi-3');
    await page.locator('[data-action=report-issue]').click();
    await page.locator('[data-report-line="' + soup.id + '"]').check();
    await page.locator('[data-report-kind="' + soup.id + '"]').selectOption('missing');
    await page.locator('[data-action=send-report]').click();
    await flash('Report sent');
    const reported = await pSnap();
    const refund = reported.snapshot.data.orders.find(o => o.id === orderId).refunds.find(r => r.line_id === soup.id);
    steps.push({ step: 3, app: 'Plateway (GUI)', action: 'Report a problem: Tom Yum Soup missing; Send report', expected: 'The line is refunded and a notice.item_refunded entry is written locally', observed: { refund: refund && { id: refund.id, line_id: refund.line_id, amount_cents: refund.amount_cents }, pending_notices: await pendingNow() }, version: 'plateway ' + versionOf(reported.version), screenshot: await shot('03-plateway-reported') });

    await pick('mi-5');
    await flash('Added Mango Sticky Rice');
    const second = await checkout();
    await page.locator('[data-action=cancel-order]').click();
    await page.locator('[data-action=confirm-cancel]').waitFor();
    await idle();
    await page.locator('[data-action=confirm-cancel]').click();
    await page.locator('article[data-order="' + second + '"][data-status=cancelled]').waitFor();
    const cancelled = await pSnap();
    const pending = sender.pending(cancelled.snapshot);
    steps.push({ step: 4, app: 'Plateway (GUI)', action: 'Order Mango Sticky Rice, then Cancel order and Confirm cancellation', expected: 'A second order, cancelled with a full refund; notice.order_placed and notice.order_cancelled are written locally', observed: { order_id: second, status: cancelled.snapshot.data.orders.find(o => o.id === second).status, pending_notices: pending.map(x => x.id + ' ' + x.kind) }, version: 'plateway ' + versionOf(cancelled.version), screenshot: await shot('04-plateway-cancelled') });

    await mailInfra.call('env.advance_time', { expected_version: (await mSnap()).version, virtual_now: cancelled.snapshot.virtual_now, request_id: 'mail-demo-clock' });
    const config = read(path.join(appDir, 'infra/router.config.example.json'));
    const configFile = path.join(scratch, 'router.config.json');
    fs.writeFileSync(configFile, JSON.stringify(config));
    router = await createRouter({ config: configFile, publisher: 'plateway', run: RUN, stateDir: mailState });
    const out = await sender.send({ plateway: plateInfra, router, grants: config.publishers[0].allowed_recipients });
    assert.equal(out.status, 'published');
    assert.deepEqual([...new Set(pending.map(x => x.kind))].sort(), ['notice.item_refunded', 'notice.order_accepted', 'notice.order_cancelled', 'notice.order_delayed', 'notice.order_delivered', 'notice.order_placed']);
    const mailAfter = await mSnap();
    const mailReceipts = [];
    for (const r of out.receipts) mailReceipts.push({ event_id: r.receipt.event_id, status: (await mailInfra.call('env.event_status', { event_id: r.receipt.event_id })).receipt?.status });
    assert.ok(mailReceipts.every(r => r.status === 'committed'));
    const plateAfterPublish = await pSnap();
    assert.equal(versionOf(plateAfterPublish.version), versionOf(cancelled.version));
    const recordFor = kind => out.receipts.find(r => r.notice_id === pending.filter(x => x.kind === kind).at(-1).id).receipt.event_id;
    await page.goto(mailHost.accessUrl);
    await page.locator('[data-record-id="' + recordFor('notice.order_cancelled') + '"]').waitFor();
    await idle();
    const receipts = out.receipts.map(r => ({ notice_id: r.notice_id, kind: pending.find(x => x.id === r.notice_id).kind, message_id: r.message_id, request_id: r.message_id, status: r.receipt.status, event_id: r.receipt.event_id, target: r.receipt.target, channel: r.receipt.channel, cloud_event_time: r.receipt.cloud_event.time, applied_at: r.receipt.applied_at }));
    steps.push({ step: 5, app: 'Messaging and Mail (Infra runs the sender; Mail GUI)', action: 'Infra brings Mail\'s clock to Plateway\'s and runs sender.send with the Router and the grant from infra/router.config.example.json; open the Mail page for the same run', expected: 'Receiver commit: one committed Router receipt and one inbox record in mail-p-1 per notice, all six notice kinds, shown in Mail\'s own page; Plateway unchanged', observed: { receipts: receipts.map(r => r.message_id + ' ' + r.kind + ' -> ' + r.status + ' ' + r.event_id), mail_records: mailAfter.snapshot.data.messages.map(m => m.id + ' ' + m.subject), mail_event_status: mailReceipts.map(r => r.status), plateway_version_unchanged: true }, version: 'mail ' + versionOf(mailAfter.version) + ', plateway ' + versionOf(plateAfterPublish.version), screenshot: await shot('05-mail-inbox') });
    let step = 6;
    for (const [kind, label, file] of [['notice.item_refunded', 'Item refunded', '06-mail-refund'], ['notice.order_cancelled', 'Order cancelled', '07-mail-cancelled']]) {
      const id = recordFor(kind);
      await page.locator('[data-record-id="' + id + '"]').click();
      await page.locator('.mail-reader h2', { hasText: label }).waitFor();
      await idle();
      const readBack = await mailAgent.call('mail.get', { id });
      steps.push({ step: step++, app: 'Mail (GUI and Agent MCP)', action: 'Open the “' + label + '” message; read it through Mail\'s Agent tool mail.get', expected: 'The notice text as Plateway wrote it, from the Plateway sender address to mail-p-1', observed: { record_id: id, status: readBack.status, subject: readBack.message.subject, from: readBack.message.from, to: readBack.message.to, folder: readBack.message.folder, received_at: readBack.message.received_at, body_matches_notice: readBack.message.body === pending.filter(x => x.kind === kind).at(-1).body }, version: 'mail ' + versionOf((await mSnap()).version), screenshot: await shot(file) });
    }

    const retry = await sender.send({ plateway: plateInfra, router, grants: config.publishers[0].allowed_recipients });
    const afterRetry = await mSnap();
    assert.ok(retry.receipts.every(r => r.receipt.duplicate === true));
    assert.equal(afterRetry.snapshot.data.messages.length, pending.length);
    assert.deepEqual(errors, []);
    return {
      run: RUN, browser: 'chromium ' + browser.version(), viewport: '1280x1000', locale: 'en-US', browser_timezone: 'America/New_York', initial, order_ids: [orderId, second], steps,
      stages: {
        local_commit: { app: 'plateway', order_ids: [orderId, second], notices: pending.map(x => ({ id: x.id, kind: x.kind, at: x.at })), plateway_version: versionOf(cancelled.version) },
        receiver_commit: { app: 'mail', account_id: MAIL_ACCOUNT.account_id, receipts, mail_event_status: mailReceipts, records: mailAfter.snapshot.data.messages.map(m => ({ id: m.id, subject: m.subject, folder: m.folder, received_at: m.received_at })), mail_version: versionOf(mailAfter.version) },
        business_confirmation: 'Not claimed. A committed Mail record shows delivery into the recipient\'s Mail account, not that the person read or acted on it.'
      },
      retry: { receipts: retry.receipts.map(r => ({ message_id: r.message_id, status: r.receipt.status, duplicate: r.receipt.duplicate, event_id: r.receipt.event_id })), mail_records: afterRetry.snapshot.data.messages.length },
      page_errors: errors.length
    };
  } finally {
    await browser?.close().catch(() => {});
    await router?.close().catch(() => {});
    await Promise.allSettled(opened.map(c => c.close()));
    await plateHost?.close().catch(() => {});
    await mailHost?.close().catch(() => {});
  }
}

const cell = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = v => '`' + (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\|/g, '\\|').replace(/`/g, '\'') + '`';

function markdown(d) {
  const p = d.participants, c = d.integration.cases, ok = c['mail-ok'];
  const L = ['# Plateway → Mail demonstration', '',
    'Generated by `' + d.command + '` (do not edit by hand). Plateway publishes its order notices (placed, accepted, delayed, delivered, cancelled, item refunded) to the real pinned Mail App through the public Messaging Router. Part 1 starts from Plateway\'s GUI and ends on Mail\'s own page; part 2 is the evidence trail of `tests/mail.integration.cjs` (' + d.integration.checks.length + ' checks passed), run by this script with `--evidence`. Captured ' + d.captured_on + '.', '',
    'The capture runs Chromium with software rasterization on one thread, so two runs on the same machine give the same screenshots and data; on another machine or Chromium build, anti-aliased edges can differ by a few pixels.', '',
    'Three stages are kept apart throughout: **local commit** (Plateway commits the order and appends a notice to its own log), **receiver commit** (the Router returns Mail\'s committed receipt and the record exists in the recipient\'s Mail account) and **business confirmation** (the person read or acted on the message). The last one is **not claimed**: Mail has no read receipt, and a committed record proves delivery only.', '',
    '## Participants and contracts', '', '| Item | Value |', '| --- | --- |',
    '| Source | Plateway ' + p.plateway.version + ', App load digest ' + code(d.plateway_load_digest) + ' (`node apps/plateway/evidence/tools/digest.cjs`)' + ', publishes ' + code(p.plateway.publishes.map(x => x.channel + ' ' + x.schema_id + ' ' + x.event_type + ' ' + x.payload_schema_id).join('; ')) + ', sender `' + p.sender + '` (run by Infra) |',
    '| Destination | Mail ' + p.mail.version + ' (`examples/apps/mail`, package SHA-256 ' + code(p.mail.package_sha256) + '), receives ' + code(p.mail.receives.map(x => x.channel + ' ' + x.schema_id + ' via ' + x.mcp_tool + ' ' + x.operation).join('; ')) + ' |',
    '| Wire contract | ' + code(p.wire_schema.id) + ', `schemas/router-message.schema.json` SHA-256 ' + code(p.wire_schema.sha256) + ', byte-identical in the runtime, Plateway and Mail; payload ' + code(p.payload_schema.id) + ' (Mail-owned, SHA-256 ' + code(p.payload_schema.sha256) + ') |',
    '| Router | public runtime ' + p.runtime.version + ' Messaging Router (runtime tree ' + code(d.host.runtime_tree_sha256) + ', `runtime/messaging/src/router.cjs` ' + code(d.host.files['runtime/messaging/src/router.cjs']) + '), Core API ' + p.runtime.core_api + '; grant from `infra/router.config.example.json`: ' + code(p.router.grants) + ' |',
    '| Recipient binding | person `p-1` (synthetic) owns `plateway-p-1` and Mail account ' + code(p.mail_account.account_id) + ' (`' + ok.initial.mail.address + '`) |',
    '| Direction | send-only: Plateway publishes, Mail receives; Plateway receives nothing |', '',
    '## Part 1: from Plateway\'s GUI to Mail\'s page', '',
    'Run `' + d.gui.run + '`, ' + d.gui.browser + ', viewport ' + d.gui.viewport + ', locale ' + d.gui.locale + ', time zone ' + d.gui.browser_timezone + ', JavaScript errors: ' + d.gui.page_errors + '. Initial state: Plateway ' + code(d.gui.initial.plateway) + '; Mail ' + code(d.gui.initial.mail) + '.', '',
    '| Step | App | Action | Expected | Observed | Version | Screenshot |', '| ---: | --- | --- | --- | --- | --- | --- |'];
  for (const s of d.gui.steps) L.push('| ' + s.step + ' | ' + cell(s.app) + ' | ' + cell(s.action) + ' | ' + cell(s.expected) + ' | ' + code(s.observed) + ' | ' + s.version + ' | [' + path.basename(s.screenshot, '.png') + '](' + s.screenshot + ') |');
  const g = d.gui.stages;
  L.push('', '| Stage | Evidence |', '| --- | --- |',
    '| Local commit | Plateway orders ' + code(g.local_commit.order_ids) + ', notices ' + code(g.local_commit.notices.map(x => x.id + ' ' + x.kind)) + ', Plateway version ' + g.local_commit.plateway_version + ' |',
    '| Receiver commit | ' + g.receiver_commit.receipts.map(r => r.kind + ': request ' + code(r.request_id) + ' → ' + r.status + ', event/record ' + code(r.event_id) + ' in ' + code(r.target.account_id)).join('; ') + '; Mail `env.event_status`: ' + code(g.receiver_commit.mail_event_status) + '; Mail version ' + g.receiver_commit.mail_version + ' |',
    '| Business confirmation | ' + g.business_confirmation + ' |',
    '| Retry | an identical `sender.send` returns ' + code(d.gui.retry.receipts.map(r => r.message_id + ' ' + r.status + ' duplicate=' + r.duplicate)) + '; Mail still holds ' + d.gui.retry.mail_records + ' records |', '',
    '## Part 2: integration run', '',
    'Each case runs on its own run ID in a staged copy of the runtime, this package and Mail. Mail is loaded with an empty inbox for `mail-p-1`; Plateway starts from its fixture with the Mail account added to its binding.', '',
    '### Delivered, retried, and after a Plateway reset (`mail-ok`)', '',
    '| Item | Evidence |', '| --- | --- |',
    '| Initial states | Plateway ' + code(ok.initial.plateway) + '; Mail ' + code(ok.initial.mail) + ' |',
    '| Command | ' + code(ok.command) + ' |',
    '| Local commit | ' + code(ok.local_commit) + ' |',
    '| Router receipts (request ID = message ID; event ID = Mail record ID) | ' + code(ok.send.receipts.map(r => ({ request_id: r.request_id, status: r.receipt.status, event_id: r.receipt.event_id, target: r.receipt.target, mail_version: r.receipt.version && versionOf(r.receipt.version), cloud_event_time: r.receipt.cloud_event.time }))) + ' |',
    '| Receiver commit | ' + code(ok.receiver_commit) + ' |',
    '| Read back through Mail\'s Agent tool | ' + code(ok.readback) + ' |',
    '| Plateway after publishing | ' + code(ok.plateway_after_publish) + ' |',
    '| Business confirmation | Not claimed |',
    '| Duplicate retry (same Router session) | ' + code({ receipts: ok.retry.send.receipts.map(r => r.request_id + ' duplicate=' + r.receipt.duplicate + ' ' + r.receipt.event_id), mail_records: ok.retry.mail_records }) + ' |',
    '| After a Plateway reset | ' + code({ plateway_epoch: ok.after_plateway_reset.plateway_epoch, receipts: ok.after_plateway_reset.send.receipts.map(r => r.request_id + ' ' + r.receipt.status), mail_records: ok.after_plateway_reset.mail_records }) + ' |', '',
    '### Every notice kind (`mail-kinds`)', '',
    'One order is accepted, delayed, has a line removed as unavailable, is picked up, delivered and has a line reported missing; a second order is cancelled by the account holder; a third is rejected by the restaurant. Steps: ' + code(c['mail-kinds'].kinds.steps) + '. Plateway version ' + c['mail-kinds'].kinds.plateway_version + ' before and after publishing; Mail version ' + c['mail-kinds'].kinds.mail_version + ' after.', '',
    '| Notice | Kind | Order | Request ID | Router receipt | Mail record (event ID) | Mail subject | Mail receipt |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...c['mail-kinds'].kinds.notices.map(x => '| ' + x.notice_id + ' | ' + x.kind + ' | ' + x.order_id + ' | `' + x.request_id + '` | ' + x.receipt + ' | `' + x.mail_record + '` | ' + x.mail_subject + ' | ' + x.mail_receipt + ' |'), '',
    '### Missing, denied, incompatible and unknown outcomes', '',
    'Where a case refuses before dispatch, both Apps\' full state is compared before and after (versions shown as Plateway / Mail / Mail records); nothing changes on either side.', '',
    '| Case | Condition | Result | Mail records | Other state |', '| --- | --- | --- | --- | --- |',
    '| Missing recipient (`mail-none`) | No Mail account bound to the account holder | ' + code({ status: c['mail-none'].no_mail_account.send.status, reason: c['mail-none'].no_mail_account.send.reason, pending: c['mail-none'].no_mail_account.send.pending }) + ' | ' + c['mail-none'].no_mail_account.mail_records + ' | notice ' + code(c['mail-none'].no_mail_account.plateway_notice_kept) + ' stays in Plateway\'s log |',
    '| No grant (`mail-ungranted`) | Router configuration with an empty `allowed_recipients` | ' + code({ status: c['mail-ungranted'].no_grant.status, reason: c['mail-ungranted'].no_grant.reason }) + ' | 0 | nothing published; both Apps unchanged: ' + code(c['mail-ungranted'].no_grant.before) + ' → ' + code(c['mail-ungranted'].no_grant.after) + ' |',
    '| Denied by the Router (`mail-ungranted`) | Sender given the grant, Router configured without it | ' + code(c['mail-ungranted'].router_refusal.send.receipts.map(r => r.receipt)) + ' | ' + c['mail-ungranted'].router_refusal.mail_records + ' | Router halted: ' + c['mail-ungranted'].router_refusal.router_halted + ' (refused before dispatch); both Apps unchanged: ' + code(c['mail-ungranted'].router_refusal.before) + ' → ' + code(c['mail-ungranted'].router_refusal.after) + ' |',
    '| Incompatible contract (`mail-incompatible`) | ' + cell(c['mail-incompatible'].incompatible.publisher_copy) + ' | ' + code(c['mail-incompatible'].incompatible.receipt) + ' | ' + c['mail-incompatible'].incompatible.mail_records + ' | refused before dispatch; both Apps unchanged: ' + code(c['mail-incompatible'].incompatible.before) + ' → ' + code(c['mail-incompatible'].incompatible.after) + ' |',
    '| Receiver rejection (`mail-reject`) | ' + cell(c['mail-reject'].receiver_rejection.cause) + ' | ' + code(c['mail-reject'].receiver_rejection.receipt) + ' | ' + c['mail-reject'].receiver_rejection.mail_records + ' | Router halted; Plateway unchanged; later sends return `halted` |',
    '| Receiver reset after Router setup (`mail-receiver-reset`) | Mail reset between Router setup and the send | ' + code(c['mail-receiver-reset'].receiver_reset.send.receipts.map(r => r.receipt)) + ' | ' + c['mail-receiver-reset'].receiver_reset.mail_records + ' | Router halted |',
    '| Unknown outcome (`mail-lost`) | ' + cell(c['mail-lost'].unknown.cause) + ' | ' + code({ send: c['mail-lost'].unknown.send.status, receipt: c['mail-lost'].unknown.send.receipts[0].receipt, reconciled: c['mail-lost'].unknown.reconciled }) + ' | ' + code(c['mail-lost'].unknown.mail_records) + ' | Router ' + c['mail-lost'].unknown.router_after + '; Plateway version ' + c['mail-lost'].unknown.plateway_version_before + ' → ' + c['mail-lost'].unknown.plateway_version_after + ' |',
    '| Unknown outcome, then Mail reset (`mail-lost-reset`) | As above, with a Mail reset before reconciliation | ' + code({ send: c['mail-lost-reset'].unknown_after_reset.send.status, reconciled: c['mail-lost-reset'].unknown_after_reset.reconciled }) + ' | ' + c['mail-lost-reset'].unknown_after_reset.mail_records + ' | recorded as indeterminate, never as delivered |', '',
    'No case rolls back or changes the other App: a refused or unknown delivery leaves Plateway\'s committed order and notice log as they were, and Mail only ever holds records whose receipts it committed. There is no cross-App transaction.', '',
    '## Reproduce', '', '```sh', 'npm ci && npx playwright install chromium', d.command, 'node apps/plateway/tests/mail.integration.cjs --evidence .artifacts/plateway-mail-trail.json', '```', '',
    'Full data: [demo.json](demo.json).', '');
  return L.join('\n');
}

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plateway-mail-evidence-'));
  try {
    fs.rmSync(path.join(OUT, 'gui'), { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, 'gui'), { recursive: true });
    const trail = integration(scratch);
    const gui = await guiDemo(scratch);
    const demo = { schema: 'plateway.mail-demonstration.v1', captured_on: new Date().toISOString().slice(0, 10), command: 'node apps/plateway/evidence/tools/mail.cjs', node: process.version, plateway_load_digest: runtimeDigest(appDir).sha256, host: hostRevision(root), participants: trail.participants, gui, integration: { command: 'node apps/plateway/tests/mail.integration.cjs --evidence FILE', checks: trail.checks, cases: trail.cases } };
    fs.writeFileSync(path.join(OUT, 'demo.json'), JSON.stringify(demo, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT, 'README.md'), markdown(demo));
    console.log('mail evidence: ' + gui.steps.length + ' GUI steps, ' + trail.checks.length + ' integration checks');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
