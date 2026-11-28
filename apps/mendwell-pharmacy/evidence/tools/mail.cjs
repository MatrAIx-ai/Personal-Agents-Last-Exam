'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const appDir = path.resolve(__dirname, '..', '..');
const root = path.resolve(appDir, '..', '..');
const FINAL = path.join(appDir, 'evidence', 'mail');
let OUT = null;
const { start } = require(path.join(root, 'runtime/web/server.cjs'));
const { Client } = require(path.join(root, 'runtime/client.cjs'));
const { create: createRouter } = require(path.join(root, 'runtime/messaging/src/router.cjs'));
const { digestTree } = require(path.join(root, 'runtime/verify.cjs'));
const sender = require('../../infra/sender.cjs');
const { options, today } = require('./options.cjs');
const { runtimeDigest, hostRevision } = require('./digest.cjs');

const APP = 'mendwell-pharmacy', P = APP + '.';
const COMMAND = 'node apps/mendwell-pharmacy/evidence/tools/mail.cjs';
const RASTER = ['--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const versionOf = v => v.epoch + '.' + v.revision;
const MAIL_SOURCE = path.join(root, 'examples/apps/mail');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');
const REGISTRY = path.join(root, 'apps.registry.json');
const MAIL = [{ app_id: 'mail', account_id: 'mail-p-1', owner_person_id: 'p-1' }, { app_id: 'mail', account_id: 'mail-p-2', owner_person_id: 'p-2' }];
const fixtureBinding = read(path.join(appDir, 'fixtures/binding.json'));
const CONFIG = read(path.join(appDir, 'infra/router.config.example.json'));
const KINDS = ['notice.claim_rejected', 'notice.fill_ready', 'notice.held', 'notice.payment_voided', 'notice.plan_decision', 'notice.refused', 'notice.released', 'notice.renewal_reply', 'notice.return_warning', 'notice.returned'];

function integration(scratch) {
  const file = path.join(scratch, 'integration.json');
  execFileSync(process.execPath, ['tests/mail.integration.cjs', '--report', file], { cwd: appDir, stdio: 'inherit' });
  const r = read(file);
  assert.equal(r.passed, true, 'Mail integration failed');
  return r;
}

async function loadMail(run, account, dir, opened) {
  const infra = new Client('mail', 'infra', run, dir, 'evidence-mail-infra', { registry: MAIL_REGISTRY });
  opened.push(infra);
  await infra.initialize();
  const dataset = read(path.join(MAIL_SOURCE, 'contribution/dataset.json'));
  dataset.dataset_id = 'mendwell-mail-demo';
  dataset.expected_counts = { records: 0, assets: 0 };
  const loaded = await infra.call('env.load_seed', {
    expected_version: (await infra.call('env.snapshot')).version, request_id: 'mail-demo-seed',
    bundle: { dataset, catalog: { schema_version: 'pale.asset-catalog.v1', catalog_id: 'mendwell-mail-demo-empty', app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: [] }, blobs: {} },
    data: { account_id: account.account_id, owner_person_id: account.owner_person_id, address: account.account_id + '@pale.example', messages: [] },
    binding: { people: fixtureBinding.people.filter(p => p.person_id === account.owner_person_id), accounts: [account], objects: {} },
    policies: read(path.join(MAIL_SOURCE, 'fixtures/policies.json'))
  });
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
  const agent = new Client('mail', 'agent', run, dir, 'evidence-mail-agent', { registry: MAIL_REGISTRY });
  opened.push(agent);
  await agent.initialize();
  const snapshot = async () => infra.call('env.snapshot');
  return { account, dir, infra, agent, snapshot, records: async () => (await snapshot()).snapshot.data.messages };
}

async function openSessions({ run, stateDir, scratch, opened, routers, configure = (account, c) => c }) {
  const sessions = [], mails = {};
  for (const account of MAIL) {
    sessions.push(await sender.openSession({
      run, stateDir, account, config: CONFIG,
      openMail: async ({ stateDir: dir, namespace }) => { const m = await loadMail(run, account, path.join(dir, namespace), opened); mails[account.account_id] = m; return m.infra; },
      openRouter: async ({ config, namespace }) => {
        const file = path.join(scratch, run + '-' + namespace + '-router.json');
        fs.writeFileSync(file, JSON.stringify(configure(account.account_id, config)));
        const r = await createRouter({ config: file, publisher: APP, run, stateDir });
        routers.push(r);
        return r;
      }
    }));
  }
  return { sessions, mails };
}

async function bindMail(infra) {
  const s0 = await infra.call('env.snapshot');
  const binding = structuredClone(s0.snapshot.binding);
  binding.accounts.push(...MAIL);
  const loaded = await infra.call('env.load_seed', { expected_version: s0.version, data: s0.snapshot.data, binding, virtual_now: s0.snapshot.virtual_now, request_id: 'mail-demo-bind' });
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
}

const stateHash = s => sha(JSON.stringify(s.snapshot.data));
const row = r => ({ notice_id: r.notice_id, recipient_id: r.recipient_id, request_id: r.message_id, account_id: r.account_id, status: r.receipt.status, ...(r.receipt.code ? { code: r.receipt.code } : {}), event_id: r.receipt.event_id || null, target: r.receipt.target || null, cloud_event_time: r.receipt.cloud_event ? r.receipt.cloud_event.time : null, mail_version: r.receipt.version ? versionOf(r.receipt.version) : null, ...(r.receipt.duplicate !== undefined ? { duplicate: r.receipt.duplicate } : {}) });

async function guiDemo(scratch) {
  const run = 'mail-gui-demo', stateDir = path.join(scratch, 'mendwell-state');
  const opened = [], routers = [], steps = [];
  let browser, mendwellHost, mailHost;
  try {
    mendwellHost = await start({ app: APP, run, stateDir, profile: 'sandbox', registry: REGISTRY });
    const infra = new Client(APP, 'infra', run, stateDir, 'evidence-mendwell-infra', { registry: REGISTRY });
    opened.push(infra);
    await infra.initialize();
    await bindMail(infra);
    const { sessions, mails } = await openSessions({ run, stateDir, scratch, opened, routers });
    const snap = () => infra.call('env.snapshot');
    const initialM = await snap();
    const initial = {
      mendwell: { run_id: initialM.snapshot.run_id, account_id: initialM.snapshot.data.account_id, owner_person_id: initialM.snapshot.data.owner_person_id, version: versionOf(initialM.version), virtual_now: initialM.snapshot.virtual_now, fills: initialM.snapshot.data.fills.length, notices_in_seed: initialM.snapshot.initial_data.notices.length, bound_accounts: initialM.snapshot.binding.accounts },
      mail: await Promise.all(MAIL.map(async a => { const s = await mails[a.account_id].snapshot(); return { account_id: s.snapshot.data.account_id, owner_person_id: s.snapshot.data.owner_person_id, address: s.snapshot.data.address, run_id: s.snapshot.run_id, state_namespace: sender.namespace(a.account_id), version: versionOf(s.version), virtual_now: s.snapshot.virtual_now, messages: s.snapshot.data.messages.length }; }))
    };
    const mailCounts = async () => Object.fromEntries(await Promise.all(MAIL.map(async a => [a.account_id, (await mails[a.account_id].records()).length])));
    const pendingNow = async () => sender.pending((await snap()).snapshot).map(n => n.notice_id + ' ' + n.kind + ' to ' + n.recipient_id + (n.audience === 'full' ? '' : ' (' + n.audience + ')'));

    browser = await chromium.launch({ headless: true, args: ['--lang=en-US', ...RASTER], env: { ...process.env, LANG: 'en_US.UTF-8' } });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York', locale: 'en-US' });
    await context.addInitScript(prefix => {
      const next = () => { const m = document.cookie.match(/(?:^|; )evidence_request_ids=(\d+)/); const n = (m ? Number(m[1]) : 0) + 1; document.cookie = 'evidence_request_ids=' + n + '; path=/; SameSite=Strict'; return n; };
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => prefix + '-' + String(next()).padStart(4, '0') });
    }, 'mail-demo');
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const settled = () => page.waitForFunction(() => { const s = document.getElementById('status'); return document.querySelector('#app').getAttribute('aria-busy') === 'false' && (!s || s.textContent === 'All changes saved' || s.dataset.error === 'true'); });
    const shot = async (name, focus) => {
      const file = 'gui/' + name + '.png';
      await idle();
      await page.mouse.move(1, 1);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.evaluate(() => scrollTo(0, 0));
      if (focus) await page.locator(focus).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, file), animations: 'disabled' });
      return file;
    };
    const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click(); await idle(); };
    const refresh = async () => { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await settled(); };
    const openFill = async id => {
      await nav('Fills');
      const item = page.locator('[data-list=fills] [data-fill-id="' + id + '"]');
      if (!(await item.isVisible())) await page.locator('[data-list=fills] details summary').click();
      await item.click();
      await page.locator('article[data-fill="' + id + '"]').waitFor();
      await settled();
    };
    let n = 0;
    const event = async (operation, payload, at) => {
      const s = await snap();
      const r = await infra.call('env.apply_event', { expected_version: s.version, event: { event_id: 'mail-demo-e' + (++n), at: at || s.snapshot.virtual_now, operation, payload } });
      assert.equal(r.status, 'committed', operation + ': ' + JSON.stringify(r));
      return operation + ' ' + r.status;
    };
    const advance = async at => {
      const r = await infra.call('env.advance_time', { expected_version: (await snap()).version, virtual_now: at, request_id: 'mail-demo-clock-' + (++n) });
      assert.equal(r.status, 'committed', JSON.stringify(r));
      return 'env.advance_time to ' + at + ' ' + r.status;
    };
    const fillState = async id => { const f = (await snap()).snapshot.data.fills.find(x => x.fill_id === id); return id + ' ' + f.state; };

    await page.goto(mendwellHost.accessUrl);
    await page.locator('[data-fill-id]').first().waitFor();
    await settled();

    const s1 = [await advance('2026-11-18T12:41:00-05:00'), await event('plan.decided', { plan_request_id: 'pr-12', decision: 'approved' })];
    await refresh();
    await openFill('f-20');
    const v1 = await snap();
    steps.push({ step: 1, app: 'Mendwell (Infra clock and event, then GUI Refresh)', action: 'Infra moves the clock to 12:41, past the review of Sam\'s sertraline fill f-20, and applies plan.decided approving pr-12 (Alex\'s metformin f-16); press Refresh and open f-20', expected: 'Local commit in Mendwell: f-20\'s claim is rejected as too soon and f-16 becomes ready; claim-rejected, plan-decision and fill-ready entries join Mendwell\'s notice log; nothing is sent', observed: { infra: s1, fills: [await fillState('f-20'), await fillState('f-16')], pending_notices: await pendingNow(), mail_messages: await mailCounts() }, version: 'mendwell ' + versionOf(v1.version), screenshot: await shot('01-mendwell-claim-rejected', 'article[data-fill="f-20"]') });

    const s2 = [
      await event('renewal.replied', { renewal_id: 'rn-2', decision: 'approved', rx: { rx_id: 'rx-20', quantity: 90, fills_authorized: 3, written_on: '2026-11-18' } }),
      await event('fill.hold_placed', { fill_id: 'f-16', note: 'Pharmacist checking the dose' }),
      await event('fill.collection_attempted', { fill_id: 'f-16', collector_id: 'p-2' }),
      await event('fill.hold_released', { fill_id: 'f-16', note: 'Dose confirmed' })
    ];
    await refresh();
    await openFill('f-16');
    const v2 = await snap();
    steps.push({ step: 2, app: 'Mendwell (Infra events, then GUI Refresh)', action: 'Infra applies renewal.replied approving rn-2 (Alex\'s levothyroxine renewal, new rx-20), fill.hold_placed on f-16, fill.collection_attempted on f-16 by Alex while it is held, and fill.hold_released; press Refresh and open f-16', expected: 'Renewal-reply, held, refused (on hold) and released entries are written locally; f-16 is ready again', observed: { infra: s2, fills: [await fillState('f-16')], pending_notices: await pendingNow(), mail_messages: await mailCounts() }, version: 'mendwell ' + versionOf(v2.version), screenshot: await shot('02-mendwell-hold-released', 'article[data-fill="f-16"]') });

    await openFill('f-17');
    await page.locator('[data-action=preview-cancel]').click();
    await page.locator('[data-flow=cancel]').waitFor();
    await settled();
    await page.locator('[data-action=confirm-flow]').click();
    await page.locator('[data-flash]', { hasText: 'Fill cancelled.' }).waitFor();
    await settled();
    const v3 = await snap();
    const au = v3.snapshot.data.authorizations.find(a => a.fill_id === 'f-17');
    steps.push({ step: 3, app: 'Mendwell (GUI)', action: 'Open Sam\'s prepaid omeprazole fill f-17, press Cancel fill, then Confirm cancellation', expected: 'f-17 cancelled, its $65.00 prepayment voided; payment-voided entries for Sam (patient) and Alex (card owner) are written locally', observed: { fills: [await fillState('f-17')], authorization: au.authorization_id + ' ' + au.state, pending_notices: await pendingNow(), mail_messages: await mailCounts() }, version: 'mendwell ' + versionOf(v3.version), screenshot: await shot('03-mendwell-cancelled', 'article[data-fill="f-17"]') });

    const s4 = [await advance('2026-11-28T13:00:00-05:00'), await event('store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' })];
    await refresh();
    await openFill('f-16');
    const v4 = await snap();
    const pending = sender.pending(v4.snapshot);
    const kinds = [...new Set(pending.map(x => x.kind))].sort();
    assert.deepEqual(kinds, KINDS, 'Not every notice kind is pending: ' + kinds.join(', '));
    steps.push({ step: 4, app: 'Mendwell (Infra clock and event, then GUI Refresh)', action: 'Infra moves the clock to Saturday 28 November 13:00, past f-16\'s pickup reminder (25 November 12:41) and return (28 November 12:41), and applies store.restocked at store st-2, which commits the due timers; press Refresh and open f-16', expected: 'f-16 returned to stock; return-warning and returned entries are written locally; Mendwell\'s log now holds all ten notice kinds; Mail is still empty', observed: { infra: s4, fills: [await fillState('f-16')], pending_notices: pending.map(x => x.notice_id + ' ' + x.kind + ' to ' + x.recipient_id + (x.audience === 'full' ? '' : ' (' + x.audience + ')')), notice_kinds: kinds, mail_messages: await mailCounts() }, version: 'mendwell ' + versionOf(v4.version), screenshot: await shot('04-mendwell-returned', 'article[data-fill="f-16"]') });

    const halts = [];
    const adapter = sender.create({ mendwell: infra, sessions, onHalt: cause => { halts.push(cause); } });
    const before = await snap();
    const out = await adapter.send();
    const after = await snap();
    assert.equal(out.status, 'published', JSON.stringify(out).slice(0, 2000));
    assert.equal(versionOf(after.version), versionOf(before.version));
    assert.equal(stateHash(after), stateHash(before));
    const receipts = out.receipts.map(row);
    assert.ok(receipts.every(r => r.status === 'committed'));
    const eventStatus = [];
    for (const r of out.receipts) eventStatus.push({ account_id: r.account_id, event_id: r.receipt.event_id, status: (await mails[r.account_id].infra.call('env.event_status', { event_id: r.receipt.event_id })).receipt?.status });
    assert.ok(eventStatus.every(r => r.status === 'committed'));
    const records = Object.fromEntries(await Promise.all(MAIL.map(async a => [a.account_id, (await mails[a.account_id].records()).map(m => ({ id: m.id, subject: m.subject, folder: m.folder, received_at: m.received_at, thread_id: m.thread_id }))])));
    const deliveredKinds = [...new Set(out.receipts.map(r => pending.find(x => x.notice_id === r.notice_id).kind))].sort();
    assert.deepEqual(deliveredKinds, KINDS);
    const alex = mails['mail-p-2'];
    mailHost = await start({ app: 'mail', run, stateDir: alex.dir, profile: 'sandbox', registry: MAIL_REGISTRY });
    const recordFor = (kind, account) => out.receipts.find(r => r.account_id === account && pending.find(x => x.notice_id === r.notice_id).kind === kind).receipt.event_id;
    await page.goto(mailHost.accessUrl);
    await page.locator('[data-record-id="' + recordFor('notice.returned', 'mail-p-2') + '"]').waitFor();
    await idle();
    steps.push({ step: 5, app: 'Messaging and Mail (Infra runs the sender; Mail GUI)', action: 'Infra runs infra/sender.cjs: one Router session per recipient Mail account (mail-p-1 for Sam, mail-p-2 for Alex), each with its grant from infra/router.config.example.json; the sender aligns the Mail clocks and publishes every pending entry; open Mail\'s page for mail-p-2 in the same run', expected: 'Receiver commit: one committed Router receipt and one inbox record per entry in the recipient\'s own account, all ten notice kinds; Mendwell unchanged by publishing', observed: { status: out.status, clock: out.clock, receipts: receipts.map(r => r.request_id + ' ' + r.recipient_id + ' -> ' + r.account_id + ' ' + r.status + ' ' + r.event_id), held: out.held, refused: out.refused, mail_event_status: eventStatus.map(r => r.status), mail_records: Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.map(m => m.id + ' ' + m.subject)])), mendwell_version_unchanged: true }, version: 'mail-p-1 ' + versionOf((await mails['mail-p-1'].snapshot()).version) + ', mail-p-2 ' + versionOf((await alex.snapshot()).version) + ', mendwell ' + versionOf(after.version), screenshot: await shot('05-mail-inbox') });

    let step = 6;
    const readback = [];
    for (const [kind, file] of [['notice.payment_voided', '06-mail-payment-voided'], ['notice.returned', '07-mail-returned']]) {
      const id = recordFor(kind, 'mail-p-2');
      const entry = pending.filter(x => x.kind === kind && x.recipient_id === 'p-2').at(-1);
      await page.locator('[data-record-id="' + id + '"]').click();
      await page.locator('.mail-reader h2', { hasText: entry.title }).waitFor();
      await idle();
      const got = await alex.agent.call('mail.get', { id });
      const r = { record_id: id, status: got.status, subject: got.message.subject, from: got.message.from, to: got.message.to, folder: got.message.folder, received_at: got.message.received_at, body: got.message.body, body_matches_notice: got.message.body === entry.body, notice: entry.notice_id + ' (' + entry.audience + ')' };
      readback.push(r);
      steps.push({ step: step++, app: 'Mail (GUI and Agent MCP)', action: 'Open the “' + entry.title + '” message in Mail; read it through Mail\'s Agent tool mail.get', expected: 'The notice text as Mendwell wrote it, from the Mendwell sender address to mail-p-2', observed: r, version: 'mail-p-2 ' + versionOf((await alex.snapshot()).version), screenshot: await shot(file) });
    }
    const all = [];
    for (const r of out.receipts) { const m = mails[r.account_id]; const got = await m.agent.call('mail.get', { id: r.receipt.event_id }); const entry = pending.find(x => x.notice_id === r.notice_id); all.push({ notice_id: r.notice_id, kind: entry.kind, audience: entry.audience, account_id: r.account_id, record_id: r.receipt.event_id, subject: got.message.subject, body_matches_notice: got.message.body === entry.body }); }
    assert.ok(all.every(x => x.body_matches_notice));

    const retry = await adapter.send();
    assert.ok(retry.receipts.every(r => r.receipt.duplicate === true));
    const counts = await mailCounts();
    assert.equal(counts['mail-p-1'] + counts['mail-p-2'], out.receipts.length);
    assert.deepEqual(errors, []);
    assert.deepEqual(halts, []);
    return {
      run, browser: 'chromium ' + browser.version(), viewport: '1280x900', locale: 'en-US', browser_timezone: 'America/New_York', initial, steps,
      stages: {
        local_commit: { app: APP, notices: pending.map(x => ({ id: x.notice_id, kind: x.kind, recipient_id: x.recipient_id, audience: x.audience, subject: x.subject.type + ' ' + x.subject.id, at: x.at })), mendwell_version: versionOf(before.version) },
        receiver_commit: { receipts, mail_event_status: eventStatus, records, readback: all },
        business_confirmation: 'Not claimed. A committed Mail record shows delivery into the recipient\'s Mail account, not that the person read or acted on it.'
      },
      retry: { status: retry.status, receipts: retry.receipts.map(r => ({ request_id: r.message_id, account_id: r.account_id, status: r.receipt.status, duplicate: r.receipt.duplicate, event_id: r.receipt.event_id })), mail_records: counts },
      page_errors: errors.length
    };
  } finally {
    await browser?.close().catch(() => {});
    await Promise.allSettled(routers.map(r => r.close()));
    await Promise.allSettled(opened.map(c => c.close()));
    await mendwellHost?.close().catch(() => {});
    await mailHost?.close().catch(() => {});
  }
}

async function refusalDemo(scratch) {
  const run = 'mail-refusal-demo', stateDir = path.join(scratch, 'refusal-state');
  const opened = [], routers = [];
  try {
    const infra = new Client(APP, 'infra', run, stateDir, 'evidence-mendwell-infra', { registry: REGISTRY });
    opened.push(infra);
    await infra.initialize();
    await bindMail(infra);
    const { sessions, mails } = await openSessions({ run, stateDir, scratch, opened, routers, configure: (account, c) => (account === 'mail-p-1' ? { ...c, publishers: c.publishers.map(p => ({ ...p, allowed_recipients: [] })) } : c) });
    const s0 = await infra.call('env.snapshot');
    const r = await infra.call('env.apply_event', { expected_version: s0.version, event: { event_id: 'refusal-demo-e1', at: s0.snapshot.virtual_now, operation: 'fill.hold_placed', payload: { fill_id: 'f-20', note: 'Pharmacist review' } } });
    assert.equal(r.status, 'committed');
    const mailState = async () => Object.fromEntries(await Promise.all(MAIL.map(async a => { const s = await mails[a.account_id].snapshot(); return [a.account_id, { version: versionOf(s.version), records: s.snapshot.data.messages.length, state_sha256: stateHash(s) }]; })));
    const adapter = sender.create({ mendwell: infra, sessions, onHalt: () => {} });
    const aligned = await adapter.align();
    assert.equal(aligned.status, 'aligned', JSON.stringify(aligned));
    const before = await infra.call('env.snapshot'), mailBefore = await mailState();
    const pending = sender.pending(before.snapshot).map(n => n.notice_id + ' ' + n.kind + ' to ' + n.recipient_id);
    const out = await adapter.send();
    const after = await infra.call('env.snapshot'), mailAfter = await mailState();
    assert.equal(out.status, 'partial');
    assert.deepEqual(out.refused.map(x => [x.account_id, x.code]), [['mail-p-1', 'recipient_not_authorized']]);
    assert.equal(stateHash(after), stateHash(before));
    assert.deepEqual(mailAfter['mail-p-1'], mailBefore['mail-p-1']);
    const halted = await Promise.all(sessions.map(async s => [s.account_id, (await s.router.call('router.capabilities', {})).halted]));
    return {
      run, condition: 'The Router session for mail-p-1 is configured without the grant for that account (allowed_recipients empty); mail-p-2 keeps its grant',
      action: 'Infra applies fill.hold_placed on Sam\'s fill f-20, which writes a held entry for Sam (p-1) and for Alex (p-2); Infra aligns the Mail clocks to Mendwell\'s (adapter.align), records both Apps\' state, and runs the sender once',
      aligned: { status: aligned.status, virtual_now: aligned.virtual_now },
      pending, status: out.status, refused: out.refused, receipts: out.receipts.map(row), held: out.held,
      mendwell: { before: versionOf(before.version), after: versionOf(after.version), state_sha256_before: stateHash(before), state_sha256_after: stateHash(after) },
      mail: { before: mailBefore, after: mailAfter }, routers_halted: Object.fromEntries(halted)
    };
  } finally {
    await Promise.allSettled(routers.map(r => r.close()));
    await Promise.allSettled(opened.map(c => c.close()));
  }
}

function participants() {
  const contribution = read(path.join(appDir, 'contribution/contribution.json'));
  const mailContribution = read(path.join(MAIL_SOURCE, 'contribution/contribution.json'));
  const wire = fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json'));
  const payload = fs.readFileSync(path.join(MAIL_SOURCE, 'schemas/email-payload.schema.json'));
  return {
    mendwell: { version: read(path.join(appDir, 'app.json')).version, publishes: contribution.messaging.publishes },
    sender: 'apps/mendwell-pharmacy/infra/sender.cjs (run by Infra)',
    mail: { version: read(path.join(MAIL_SOURCE, 'app.json')).version, package_sha256: digestTree(MAIL_SOURCE), receives: mailContribution.messaging.receives.filter(x => x.channel === 'channel.email') },
    wire_schema: { id: read(path.join(appDir, 'schemas/router-message.schema.json')).$id, sha256: sha(wire), identical_in: { runtime: wire.equals(fs.readFileSync(path.join(root, 'runtime/contracts/schemas/router-message.schema.json'))), mail: wire.equals(fs.readFileSync(path.join(MAIL_SOURCE, 'schemas/router-message.schema.json'))) } },
    payload_schema: { id: JSON.parse(payload).$id, sha256: sha(payload) },
    runtime: { version: read(path.join(root, 'runtime/package.json')).version },
    router: { grants: CONFIG.publishers[0].allowed_recipients, publisher_account: CONFIG.publishers[0].account_id },
    mail_accounts: MAIL
  };
}

const cell = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = v => '`' + (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\|/g, '\\|').replace(/`/g, '\'') + '`';

function markdown(d) {
  const p = d.participants, g = d.gui, f = d.refusal;
  const L = ['# Mendwell → Mail demonstration', '',
    'Generated by `' + d.command + '` (do not edit by hand). Mendwell publishes its notices to the real pinned Mail App through the public Messaging Router, one Router session per recipient Mail account. Part 1 starts from Mendwell\'s GUI and Infra events, produces each of the ten notice kinds the App sends and ends on Mail\'s own page; part 2 shows a refusal before dispatch leaving both Apps unchanged; part 3 is the result of `tests/mail.integration.cjs` (' + d.integration.checks.length + ' checks passed), run by this script. Captured ' + d.captured_on + '.', '',
    'The capture runs Chromium with software rasterization on one thread, so two runs on the same machine give the same screenshots and data; on another machine or Chromium build, anti-aliased edges can differ by a few pixels.', '',
    'Three stages are kept apart throughout: **local commit** (Mendwell commits the change and appends a notice to its own log), **receiver commit** (the Router returns Mail\'s committed receipt and the record exists in the recipient\'s Mail account) and **business confirmation** (the person read or acted on the message). The last one is **not claimed**: Mail has no read receipt, and a committed record proves delivery only.', '',
    '## Participants and contracts', '', '| Item | Value |', '| --- | --- |',
    '| Source | Mendwell ' + p.mendwell.version + ', App load digest ' + code(d.mendwell_load_digest) + ' (`node apps/mendwell-pharmacy/evidence/tools/digest.cjs`), publishes ' + code(p.mendwell.publishes.map(x => x.channel + ' ' + x.schema_id + ' ' + x.event_type + ' ' + x.payload_schema_id).join('; ')) + ', sender `' + p.sender + '` |',
    '| Destination | Mail ' + p.mail.version + ' (`examples/apps/mail`, package SHA-256 ' + code(p.mail.package_sha256) + '), receives ' + code(p.mail.receives.map(x => x.channel + ' ' + x.schema_id + ' via ' + x.mcp_tool + ' ' + x.operation).join('; ')) + ' |',
    '| Wire contract | ' + code(p.wire_schema.id) + ', `schemas/router-message.schema.json` SHA-256 ' + code(p.wire_schema.sha256) + ', byte-identical in the runtime (' + p.wire_schema.identical_in.runtime + ') and in Mail (' + p.wire_schema.identical_in.mail + '); payload ' + code(p.payload_schema.id) + ' (Mail-owned, SHA-256 ' + code(p.payload_schema.sha256) + ') |',
    '| Router | public runtime ' + p.runtime.version + ' Messaging Router (runtime tree ' + code(d.host.runtime_tree_sha256) + ', `runtime/messaging/src/router.cjs` ' + code(d.host.files['runtime/messaging/src/router.cjs']) + '); publisher account ' + code(p.router.publisher_account) + '; grants from `infra/router.config.example.json`: ' + code(p.router.grants) + ', one session per Mail account with its own grant and a state namespace derived from the account |',
    '| Recipient binding | ' + p.mail_accounts.map(a => 'person `' + a.owner_person_id + '` (synthetic) owns Mail account ' + code(a.account_id)).join('; ') + '; other members of the household (Mia, Elena) have no Mail account, so their entries would stay in Mendwell\'s log |',
    '| Direction | send-only: Mendwell publishes, Mail receives; Mendwell receives nothing |', '',
    '## Part 1: from Mendwell\'s GUI to Mail\'s page', '',
    'Run `' + g.run + '`, ' + g.browser + ', viewport ' + g.viewport + ', locale ' + g.locale + ', time zone ' + g.browser_timezone + ', JavaScript errors: ' + g.page_errors + '. Initial state: Mendwell ' + code(g.initial.mendwell) + '; Mail ' + code(g.initial.mail) + '.', '',
    '| Step | App | Action | Expected | Observed | Version | Screenshot |', '| ---: | --- | --- | --- | --- | --- | --- |'];
  for (const s of g.steps) L.push('| ' + s.step + ' | ' + cell(s.app) + ' | ' + cell(s.action) + ' | ' + cell(s.expected) + ' | ' + code(s.observed) + ' | ' + s.version + ' | [' + path.basename(s.screenshot, '.png') + '](' + s.screenshot + ') |');
  L.push('', '### Every notice kind', '', '| Notice | Kind | Audience | Recipient | Request ID | Router receipt | Mail account | Mail record (event ID) | Mail subject | Body equals the notice |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of g.stages.receiver_commit.receipts) {
    const n = g.stages.local_commit.notices.find(x => x.id === r.notice_id), b = g.stages.receiver_commit.readback.find(x => x.notice_id === r.notice_id);
    L.push('| ' + r.notice_id + ' | ' + n.kind + ' | ' + n.audience + ' | ' + r.recipient_id + ' | `' + r.request_id + '` | ' + r.status + ' | ' + r.account_id + ' | `' + r.event_id + '` | ' + b.subject + ' | ' + b.body_matches_notice + ' |');
  }
  L.push('', '| Stage | Evidence |', '| --- | --- |',
    '| Local commit | ' + g.stages.local_commit.notices.length + ' entries in Mendwell\'s log, ' + code(g.stages.local_commit.notices.map(x => x.id + ' ' + x.kind)) + ', Mendwell version ' + g.stages.local_commit.mendwell_version + ', unchanged by publishing |',
    '| Receiver commit | ' + g.stages.receiver_commit.receipts.length + ' committed Router receipts; Mail `env.event_status`: ' + code([...new Set(g.stages.receiver_commit.mail_event_status.map(x => x.status))]) + ' for every event; records ' + code(Object.fromEntries(Object.entries(g.stages.receiver_commit.records).map(([k, v]) => [k, v.length]))) + '; every body read back through `mail.get` equals the notice text. Held in Mendwell\'s log, not sent: ' + code(g.steps[4].observed.held) + '. Mail receives every record at the aligned clock (the time the sender ran); each receipt\'s CloudEvents time keeps the notice\'s own time |',
    '| Business confirmation | ' + g.stages.business_confirmation + ' |',
    '| Retry | an identical `adapter.send()` returns ' + code(g.retry.status) + ' with every receipt marked duplicate (' + g.retry.receipts.filter(r => r.duplicate).length + ' of ' + g.retry.receipts.length + '); Mail still holds ' + code(g.retry.mail_records) + ' records |', '',
    '## Part 2: a refusal before dispatch', '',
    '| Item | Evidence |', '| --- | --- |',
    '| Run | `' + f.run + '` |', '| Condition | ' + cell(f.condition) + ' |', '| Action | ' + cell(f.action) + ' |',
    '| Pending entries | ' + code(f.pending) + ' |',
    '| Result | ' + code({ status: f.status, refused: f.refused, held: f.held }) + ' |',
    '| Router receipts | ' + code(f.receipts.map(r => r.request_id + ' ' + r.account_id + ' ' + r.status + (r.code ? ' ' + r.code : '') + (r.event_id ? ' ' + r.event_id : ''))) + ' |',
    '| Mendwell | version ' + f.mendwell.before + ' → ' + f.mendwell.after + ', data SHA-256 ' + code(f.mendwell.state_sha256_before) + ' → ' + code(f.mendwell.state_sha256_after) + ' |',
    '| Mail | ' + code(f.mail.before) + ' → ' + code(f.mail.after) + ' |',
    '| Routers halted | ' + code(f.routers_halted) + ' |', '',
    'The refused entry stays in Mendwell\'s log; the refused inbox is unchanged record for record, and the other inbox receives only its own entry. No case rolls back or changes the other App: a refused or unknown delivery leaves Mendwell\'s committed state and notice log as they were, and Mail only ever holds records whose receipts it committed. There is no cross-App transaction.', '',
    '## Part 3: integration run', '',
    '`' + d.integration.command + '` stages a copy of the runtime, this package and ' + d.integration.receiver.replace(/^mail /, 'Mail ') + ' and runs each case on its own run ID: delivery, retry and reset, a colon in the account ID, missing and ungranted recipients, foreign and incompatible Routers, receiver rejection, receiver resets, lost replies and their reconciliation, ambiguous and pinned destinations, misbound sessions, locks, timeouts and lost fences. Node ' + d.integration.node + ', runtime ' + d.integration.runtime + '. All ' + d.integration.checks.length + ' checks passed:', '',
    ...d.integration.checks.map(c => '- ' + c.name), '',
    '## Reproduce', '', '```sh', 'npm ci && npx playwright install chromium', d.command, 'node apps/mendwell-pharmacy/tests/mail.integration.cjs --report .artifacts/mendwell-mail.json', '```', '',
    'Full data: [demo.json](demo.json).', '');
  return L.join('\n');
}

function publish(staging, final) {
  fs.mkdirSync(final, { recursive: true });
  for (const e of fs.readdirSync(final)) fs.rmSync(path.join(final, e), { recursive: true, force: true });
  fs.cpSync(staging, final, { recursive: true });
}

async function main() {
  const opts = options(process.argv.slice(2));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mendwell-mail-evidence-'));
  OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'mendwell-mail-capture-'));
  try {
    fs.mkdirSync(path.join(OUT, 'gui'), { recursive: true });
    const report = integration(scratch);
    const gui = await guiDemo(scratch);
    const refusal = await refusalDemo(scratch);
    const demo = { schema: 'mendwell.mail-demonstration.v1', captured_on: opts.date || today(), command: COMMAND, node: process.version, mendwell_load_digest: runtimeDigest(appDir).sha256, host: hostRevision(root), participants: participants(), gui, refusal, integration: { command: 'node apps/mendwell-pharmacy/tests/mail.integration.cjs --report FILE', receiver: report.receiver, runtime: report.runtime, node: report.node, checks: report.checks } };
    fs.writeFileSync(path.join(OUT, 'demo.json'), JSON.stringify(demo, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT, 'README.md'), markdown(demo));
    publish(OUT, FINAL);
    console.log('mail evidence: ' + gui.steps.length + ' GUI steps, ' + gui.stages.receiver_commit.receipts.length + ' deliveries of ' + KINDS.length + ' notice kinds, ' + report.checks.length + ' integration checks');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true }); }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
