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
const { runtimeDigest, hostRevision } = require('./digest.cjs');

const APP = 'larkfield-health', P = APP + '.';
const COMMAND = 'node apps/larkfield-health/evidence/tools/mail.cjs';
const RASTER = ['--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const CAPTURED_ON = (() => { const i = process.argv.findIndex(a => a === '--captured-on' || a.startsWith('--captured-on=')); if (i < 0) return null; const v = process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1]; if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw Error('--captured-on needs a date as YYYY-MM-DD'); return v; })();
const WALK = read(path.join(appDir, 'examples/walkthrough.json'));
const walk = id => structuredClone(WALK.find(x => x.event && x.event.event_id === id).event);
const versionOf = v => v.epoch + '.' + v.revision;
const MAIL_SOURCE = path.join(root, 'examples/apps/mail');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');
const REGISTRY = path.join(root, 'apps.registry.json');
const MAIL = [{ app_id: 'mail', account_id: 'mail-m-1', owner_person_id: 'm-1' }, { app_id: 'mail', account_id: 'mail-m-2', owner_person_id: 'm-2' }];
const fixtureBinding = read(path.join(appDir, 'fixtures/binding.json'));
const CONFIG = read(path.join(appDir, 'infra/router.config.example.json'));
const KINDS = ['notice.appeal_decision', 'notice.appeal_info_requested', 'notice.appeal_received', 'notice.appeal_window_closing', 'notice.claim_denied', 'notice.decision_overdue', 'notice.eob_available', 'notice.info_requested', 'notice.pa_decision'];

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
  dataset.dataset_id = 'larkfield-mail-demo';
  dataset.expected_counts = { records: 0, assets: 0 };
  const loaded = await infra.call('env.load_seed', {
    expected_version: (await infra.call('env.snapshot')).version, request_id: 'mail-demo-seed',
    bundle: { dataset, catalog: { schema_version: 'pale.asset-catalog.v1', catalog_id: 'larkfield-mail-demo-empty', app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: [] }, blobs: {} },
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
  const run = 'mail-gui-demo', stateDir = path.join(scratch, 'larkfield-state');
  const opened = [], routers = [], steps = [];
  let browser, larkfieldHost, mailHost;
  try {
    larkfieldHost = await start({ app: APP, run, stateDir, profile: 'sandbox', registry: REGISTRY });
    const infra = new Client(APP, 'infra', run, stateDir, 'evidence-larkfield-infra', { registry: REGISTRY });
    opened.push(infra);
    await infra.initialize();
    await bindMail(infra);
    const { sessions, mails } = await openSessions({ run, stateDir, scratch, opened, routers });
    const snap = () => infra.call('env.snapshot');
    const initialL = await snap();
    const initial = {
      larkfield: { run_id: initialL.snapshot.run_id, account_id: initialL.snapshot.data.account_id, owner_person_id: initialL.snapshot.data.owner_person_id, version: versionOf(initialL.version), virtual_now: initialL.snapshot.virtual_now, notices_in_log: initialL.snapshot.data.notices.length, seed_id: initialL.snapshot.data.seed_id },
      mail: await Promise.all(MAIL.map(async a => { const s = await mails[a.account_id].snapshot(); return { account_id: s.snapshot.data.account_id, owner_person_id: s.snapshot.data.owner_person_id, address: s.snapshot.data.address, run_id: s.snapshot.run_id, version: versionOf(s.version), records: s.snapshot.data.messages.length }; }))
    };
    const pendingNow = async () => sender.pending((await snap()).snapshot).map(n => n.notice_id + ' ' + n.kind + ' to ' + n.recipient_id);

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
    const settled = () => page.waitForFunction(() => { const s = document.getElementById('status'); return document.querySelector('#app').getAttribute('aria-busy') === 'false' && (!s || s.textContent === 'All changes saved' || s.dataset.error === 'true' || s.dataset.settled === 'true'); });
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
    const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click(); await idle(); await settled(); };
    const refresh = async () => { await page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true }).click(); await settled(); };
    const pick = async (kind, id) => { await page.locator('[data-' + kind + '-id="' + id + '"]').click(); await page.locator('[data-' + kind + '="' + id + '"]').waitFor(); await settled(); };
    let n = 0;
    const event = async (e, label) => {
      const s = await snap();
      const r = await infra.call('env.apply_event', { expected_version: s.version, event: e });
      assert.equal(r.status, 'committed', e.operation + ': ' + JSON.stringify(r));
      return (label || e.operation) + ' ' + r.status;
    };
    const advance = async at => {
      const r = await infra.call('env.advance_time', { expected_version: (await snap()).version, virtual_now: at, request_id: 'mail-demo-clock-' + (++n) });
      assert.equal(r.status, 'committed', JSON.stringify(r));
      return 'env.advance_time to ' + at + ' ' + r.status;
    };
    const paOf = async id => { const p = (await snap()).snapshot.data.pas.find(x => x.pa_id === id); return id + ' ' + p.status + (p.expedite ? ', expedite ' + p.expedite.status : ''); };

    await page.goto(larkfieldHost.accessUrl);
    await page.locator('[data-claim-id]').first().waitFor();
    await settled();

    const s1 = [await advance('2026-12-01T09:00:00-05:00'), await event(walk('ev-1'), 'claim.received cl-7 (ev-1)'), await event(walk('ev-2'), 'pa.submitted pa-4 (ev-2)')];
    await nav('Prior authorizations');
    await refresh();
    await pick('pa', 'pa-4');
    const v1 = await snap();
    steps.push({ step: 1, app: 'Larkfield (Infra clock and events, then GUI Refresh)', action: 'Infra moves the clock to 1 December 09:00, past the reviews of cl-15, cl-16 and cl-17 and the expiry of cl-13\'s questions already scheduled in the fixture, and applies the proposal\'s example events ev-1 (claim.received cl-7) and ev-2 (pa.submitted pa-4 for Riley); Refresh; Prior authorizations → pa-4', expected: 'pa-4 pending with its decision due; explanation-of-benefits, information-request, claim-denied and decision-overdue entries in Larkfield\'s log', observed: { infra: s1, pa: await paOf('pa-4'), pending: await pendingNow() }, version: versionOf(v1.version), screenshot: await shot('01-larkfield-pa-submitted', '[data-pa="pa-4"]') });

    const s2 = [await event(walk('ev-3'), 'pa.info_requested pa-4 (ev-3)'), await event(walk('ev-4'), 'pa.info_provided pa-4 (ev-4)'), await advance('2026-12-03T11:30:00-05:00')];
    await refresh();
    await pick('pa', 'pa-4');
    await page.locator('[data-form="expedite:pa-4"] [data-field=reason]').fill('Riley\'s orthopedist wants therapy for the injured knee to start this week.');
    await page.locator('[data-action=expedite]').click();
    await settled();
    await page.locator('[data-pa="pa-4"]').waitFor();
    const v2 = await snap();
    const p2 = v2.snapshot.data.pas.find(x => x.pa_id === 'pa-4');
    assert.equal(p2.expedite && p2.expedite.status, 'open', 'The expedite request from the page was not recorded');
    steps.push({ step: 2, app: 'Larkfield (Infra events, then GUI)', action: 'Infra applies ev-3 (pa.info_requested) and ev-4 (pa.info_provided) and moves the clock to 3 December 11:30; Refresh; pa-4 → reason → Ask for expedited review', expected: 'The expedite request is recorded with its reason', observed: { infra: s2, pa: await paOf('pa-4') }, version: versionOf(v2.version), screenshot: await shot('02-larkfield-expedite', '[data-pa="pa-4"]') });

    const kf = 'file:pa:pa-4';
    const s3 = [await event(walk('ev-5'), 'pa.expedite_decided approved (ev-5)'), await event({ event_id: 'mail-demo-pa-denied', at: '2026-12-04T10:00:00-05:00', operation: 'pa.decided', payload: { pa_id: 'pa-4', decision: 'denied' } }, 'pa.decided pa-4 denied')];
    await refresh();
    await pick('pa', 'pa-4');
    await page.locator('[data-form="' + kf + '"] [data-field=statement]').fill('Riley needs the therapy now; the knee is not healing without it.');
    await page.locator('[data-action=preview][data-key="' + kf + '"]').click();
    await page.locator('[data-flow="' + kf + '"]').waitFor();
    await settled();
    const token = await page.locator('[data-flow="' + kf + '"] [data-token]').getAttribute('data-token');
    s3.push(await event({ event_id: 'mail-demo-confirmed', at: '2026-12-04T10:30:00-05:00', operation: 'user.confirmed', payload: { token, confirmed_by: 'm-1' } }, 'user.confirmed by m-1'));
    await refresh();
    await page.locator('[data-flow="' + kf + '"] [data-action=confirm]').click();
    await page.locator('[data-flash]', { hasText: 'Appeal filed' }).waitFor();
    await settled();
    const v3 = await snap();
    const filed = v3.snapshot.data.appeals.find(a => a.target.type === 'pa' && a.target.id === 'pa-4');
    assert.ok(filed, 'The appeal filed from the page is not in Larkfield');
    steps.push({ step: 3, app: 'Larkfield (Infra events, then GUI)', action: 'Infra applies ev-5 (expedite approved) and pa.decided denying pa-4; Refresh; pa-4 → statement → Preview appeal; Infra applies user.confirmed by Jordan; Refresh; Confirm', expected: 'pa-4 denied; the appeal on it filed from the page, with its decision due', observed: { infra: s3, pa: await paOf('pa-4'), appeal: filed.appeal_id + ' ' + filed.status + ', due ' + filed.due_at }, version: versionOf(v3.version), screenshot: await shot('03-larkfield-appeal-filed', '[data-flash]') });

    const s4 = [await event(walk('ev-8'), 'appeal.info_requested ap-3 (ev-8)'), await advance('2027-04-03T09:00:00-04:00'), await event({ ...walk('ev-9'), event_id: 'mail-demo-ap3-decided', at: '2027-04-05T09:00:00-04:00' }, 'appeal.decided ap-3 overturned (ev-9, at 5 April 2027)')];
    await nav('Appeals');
    await refresh();
    await pick('appeal', 'ap-3');
    const v4 = await snap();
    const pending = sender.pending(v4.snapshot);
    const kinds = [...new Set(pending.map(x => x.kind))].sort();
    assert.deepEqual(kinds, KINDS, 'Not every notice kind is pending: ' + kinds.join(', '));
    steps.push({ step: 4, app: 'Larkfield (Infra events and clock, then GUI Refresh)', action: 'Infra applies ev-8 (appeal.info_requested on ap-3), moves the clock to 3 April 2027, past the closing notice of cl-14\'s appeal window, and applies appeal.decided overturning ap-3 on 5 April; Refresh; Appeals → ap-3', expected: 'ap-3 overturned; entries of all ' + KINDS.length + ' notice kinds in Larkfield\'s log, waiting for the sender', observed: { infra: s4, pending: pending.map(x => x.notice_id + ' ' + x.kind + ' to ' + x.recipient_id) }, version: versionOf(v4.version), screenshot: await shot('04-larkfield-appeal-decided', '[data-appeal="ap-3"]') });

    const halts = [];
    const adapter = sender.create({ app: infra, sessions, onHalt: cause => { halts.push(cause); } });
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
    const jordan = mails['mail-m-1'];
    mailHost = await start({ app: 'mail', run, stateDir: jordan.dir, profile: 'sandbox', registry: MAIL_REGISTRY });
    const recordFor = (kind, account) => out.receipts.find(r => r.account_id === account && pending.find(x => x.notice_id === r.notice_id).kind === kind).receipt.event_id;
    await page.goto(mailHost.accessUrl);
    await page.locator('[data-record-id="' + recordFor('notice.appeal_decision', 'mail-m-1') + '"]').waitFor();
    await idle();
    steps.push({ step: 5, app: 'Messaging and Mail (Infra runs the sender; Mail GUI)', action: 'Infra runs infra/sender.cjs: one Router session per recipient Mail account (mail-m-1 for Jordan, mail-m-2 for Casey), each with its grant from infra/router.config.example.json; then Jordan\'s Mail inbox is opened on Mail\'s own Web Host page', expected: 'Every entry whose recipient may still see the member delivered to that person\'s Mail account with a committed receipt; entries for Riley, a minor without a Mail account (no_mail_account), and entries whose recipient lost access to the member before the sender ran (access_changed: Casey\'s act grant for Jordan\'s records ended on 1 January 2027) stay in Larkfield\'s log; Larkfield\'s state unchanged by publishing', observed: { status: out.status, receipts: receipts.length, held: out.held.map(h => h.notice_id + ' ' + h.reason), larkfield_version: versionOf(before.version) + ' → ' + versionOf(after.version), mail_records: await (async () => Object.fromEntries(await Promise.all(MAIL.map(async a => [a.account_id, (await mails[a.account_id].records()).length]))))() }, version: versionOf(after.version), screenshot: await shot('05-mail-inbox') });

    let step = 6;
    const readback = [];
    for (const [kind, file] of [['notice.appeal_received', '06-mail-appeal-received'], ['notice.appeal_window_closing', '07-mail-appeal-window-closing']]) {
      const id = recordFor(kind, 'mail-m-1');
      const entry = pending.filter(x => x.kind === kind && x.recipient_id === 'm-1').at(-1);
      await page.locator('[data-record-id="' + id + '"]').click();
      await page.locator('.mail-reader h2', { hasText: entry.title }).waitFor();
      await idle();
      const got = await jordan.agent.call('mail.get', { id });
      const r = { record_id: id, status: got.status, subject: got.message.subject, from: got.message.from, to: got.message.to, folder: got.message.folder, received_at: got.message.received_at, body: got.message.body, body_matches_notice: got.message.body === entry.body };
      readback.push(r);
      steps.push({ step: step++, app: 'Mail (GUI and Agent MCP)', action: 'Open the “' + entry.title + '” message in Mail; read it through Mail\'s Agent tool mail.get', expected: 'The notice text as Larkfield wrote it, from the Larkfield sender address to mail-m-1', observed: r, version: versionOf(after.version), screenshot: await shot(file) });
    }
    const all = [];
    for (const r of out.receipts) { const m = mails[r.account_id]; const got = await m.agent.call('mail.get', { id: r.receipt.event_id }); const entry = pending.find(x => x.notice_id === r.notice_id); all.push({ notice_id: r.notice_id, kind: entry.kind, account_id: r.account_id, record_id: r.receipt.event_id, subject: got.message.subject, body_matches_notice: got.message.body === entry.body }); }
    assert.ok(all.every(x => x.body_matches_notice));

    const retry = await adapter.send();
    assert.ok(retry.receipts.every(r => r.receipt.duplicate === true));
    const counts = Object.fromEntries(await Promise.all(MAIL.map(async a => [a.account_id, (await mails[a.account_id].records()).length])));
    assert.equal(counts['mail-m-1'] + counts['mail-m-2'], out.receipts.length);
    assert.deepEqual(errors, []);
    assert.deepEqual(halts, []);
    return {
      run, browser: 'chromium ' + browser.version(), viewport: '1280x900', locale: 'en-US', browser_timezone: 'America/New_York', initial, steps,
      stages: {
        local_commit: { app: APP, notices: pending.map(x => ({ id: x.notice_id, kind: x.kind, recipient_id: x.recipient_id, member_id: x.member_id, subject: x.subject.type + ' ' + x.subject.id, at: x.at })), larkfield_version: versionOf(before.version) },
        receiver_commit: { receipts, held: out.held, mail_event_status: eventStatus, records, readback: all },
        business_confirmation: 'Not claimed. A committed Mail record shows delivery into the recipient\'s Mail account, not that the person read or acted on it.'
      },
      retry: { status: retry.status, receipts: retry.receipts.map(r => ({ request_id: r.message_id, account_id: r.account_id, status: r.receipt.status, duplicate: r.receipt.duplicate, event_id: r.receipt.event_id })), mail_records: counts },
      page_errors: errors.length
    };
  } finally {
    await browser?.close().catch(() => {});
    await Promise.allSettled(routers.map(r => r.close()));
    await Promise.allSettled(opened.map(c => c.close()));
    await larkfieldHost?.close().catch(() => {});
    await mailHost?.close().catch(() => {});
  }
}

async function refusalDemo(scratch) {
  const run = 'mail-refusal-demo', stateDir = path.join(scratch, 'refusal-state');
  const opened = [], routers = [];
  try {
    const infra = new Client(APP, 'infra', run, stateDir, 'evidence-larkfield-infra', { registry: REGISTRY });
    opened.push(infra);
    await infra.initialize();
    await bindMail(infra);
    const { sessions, mails } = await openSessions({ run, stateDir, scratch, opened, routers, configure: (account, c) => (account === 'mail-m-1' ? { ...c, publishers: c.publishers.map(p => ({ ...p, allowed_recipients: [] })) } : c) });
    const s0 = await infra.call('env.snapshot');
    const r = await infra.call('env.apply_event', { expected_version: s0.version, event: { event_id: 'refusal-demo-e1', at: s0.snapshot.virtual_now, operation: 'appeal.info_requested', payload: { appeal_id: 'ap-3', request: 'A letter from the treating provider' } } });
    assert.equal(r.status, 'committed');
    const mailState = async () => Object.fromEntries(await Promise.all(MAIL.map(async a => { const s = await mails[a.account_id].snapshot(); return [a.account_id, { version: versionOf(s.version), records: s.snapshot.data.messages.length, state_sha256: stateHash(s) }]; })));
    const adapter = sender.create({ app: infra, sessions, onHalt: () => {} });
    const aligned = await adapter.align();
    assert.equal(aligned.status, 'aligned', JSON.stringify(aligned));
    const before = await infra.call('env.snapshot'), mailBefore = await mailState();
    const pending = sender.pending(before.snapshot).map(n => n.notice_id + ' ' + n.kind + ' to ' + n.recipient_id);
    const out = await adapter.send();
    const after = await infra.call('env.snapshot'), mailAfter = await mailState();
    assert.equal(out.status, 'partial');
    assert.deepEqual(out.refused.map(x => [x.account_id, x.code]), [['mail-m-1', 'recipient_not_authorized']]);
    assert.equal(stateHash(after), stateHash(before));
    assert.deepEqual(mailAfter['mail-m-1'], mailBefore['mail-m-1']);
    const halted = await Promise.all(sessions.map(async s => [s.account_id, (await s.router.call('router.capabilities', {})).halted]));
    return {
      run, condition: 'The Router session for mail-m-1 is configured without the grant for that account (allowed_recipients empty); mail-m-2 keeps its grant',
      action: 'Infra applies appeal.info_requested on Riley\'s appeal ap-3, which writes an entry for each guardian, Jordan (m-1) and Casey (m-2), and for Riley (m-3); Infra aligns the Mail clocks to Larkfield\'s (adapter.align), records both Apps\' state, and runs the sender once',
      aligned: { status: aligned.status, virtual_now: aligned.virtual_now },
      pending, status: out.status, refused: out.refused, receipts: out.receipts.map(row), held: out.held,
      larkfield: { before: versionOf(before.version), after: versionOf(after.version), state_sha256_before: stateHash(before), state_sha256_after: stateHash(after) },
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
    larkfield: { version: read(path.join(appDir, 'app.json')).version, publishes: contribution.messaging.publishes },
    sender: 'apps/larkfield-health/infra/sender.cjs (run by Infra)',
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
  const L = ['# Larkfield → Mail demonstration', '',
    'Generated by `' + d.command + '` (do not edit by hand). Larkfield publishes its notices to the real pinned Mail App through the public Messaging Router, one Router session per recipient Mail account. Part 1 starts from Larkfield\'s GUI and Infra events, produces each of the nine notice kinds the App sends and ends on Mail\'s own page; part 2 shows a refusal before dispatch leaving both Apps unchanged; part 3 is the result of `tests/mail.integration.cjs` (' + d.integration.checks.length + ' checks passed), run by this script. Captured ' + d.captured_on + '.', '',
    'The capture runs Chromium with software rasterization on one thread, so two runs on the same machine give the same screenshots and data; on another machine or Chromium build, anti-aliased edges can differ by a few pixels.', '',
    'Three stages are kept apart throughout: **local commit** (Larkfield commits the change and appends a notice to its own log), **receiver commit** (the Router returns Mail\'s committed receipt and the record exists in the recipient\'s Mail account) and **business confirmation** (the person read or acted on the message). The last one is **not claimed**: Mail has no read receipt, and a committed record proves delivery only.', '',
    '## Participants and contracts', '', '| Item | Value |', '| --- | --- |',
    '| Source | Larkfield ' + p.larkfield.version + ', App load digest ' + code(d.larkfield_load_digest) + ' (`node apps/larkfield-health/evidence/tools/digest.cjs`), publishes ' + code(p.larkfield.publishes.map(x => x.channel + ' ' + x.schema_id + ' ' + x.event_type + ' ' + x.payload_schema_id).join('; ')) + ', sender `' + p.sender + '` |',
    '| Destination | Mail ' + p.mail.version + ' (`examples/apps/mail`, package SHA-256 ' + code(p.mail.package_sha256) + '), receives ' + code(p.mail.receives.map(x => x.channel + ' ' + x.schema_id + ' via ' + x.mcp_tool + ' ' + x.operation).join('; ')) + ' |',
    '| Wire contract | ' + code(p.wire_schema.id) + ', `schemas/router-message.schema.json` SHA-256 ' + code(p.wire_schema.sha256) + ', byte-identical in the runtime (' + p.wire_schema.identical_in.runtime + ') and in Mail (' + p.wire_schema.identical_in.mail + '); payload ' + code(p.payload_schema.id) + ' (Mail-owned, SHA-256 ' + code(p.payload_schema.sha256) + ') |',
    '| Router | public runtime ' + p.runtime.version + ' Messaging Router (runtime tree ' + code(d.host.runtime_tree_sha256) + ', `runtime/messaging/src/router.cjs` ' + code(d.host.files['runtime/messaging/src/router.cjs']) + '); publisher account ' + code(p.router.publisher_account) + '; grants from `infra/router.config.example.json`: ' + code(p.router.grants) + ', one session per Mail account with its own grant and a state namespace derived from the account |',
    '| Recipient binding | ' + p.mail_accounts.map(a => 'person `' + a.owner_person_id + '` (synthetic) owns Mail account ' + code(a.account_id)).join('; ') + '; Riley (m-3), a minor, has no Mail account, so entries for Riley stay in Larkfield\'s log (held as no_mail_account) |',
    '| Direction | send-only: Larkfield publishes, Mail receives; Larkfield receives nothing |', '',
    '## Part 1: from Larkfield\'s GUI to Mail\'s page', '',
    'Run `' + g.run + '`, ' + g.browser + ', viewport ' + g.viewport + ', locale ' + g.locale + ', time zone ' + g.browser_timezone + ', JavaScript errors: ' + g.page_errors + '. Initial state: Larkfield ' + code(g.initial.larkfield) + '; Mail ' + code(g.initial.mail) + '.', '',
    '| Step | App | Action | Expected | Observed | Version | Screenshot |', '| ---: | --- | --- | --- | --- | --- | --- |'];
  for (const s of g.steps) L.push('| ' + s.step + ' | ' + cell(s.app) + ' | ' + cell(s.action) + ' | ' + cell(s.expected) + ' | ' + code(s.observed) + ' | ' + s.version + ' | [' + path.basename(s.screenshot, '.png') + '](' + s.screenshot + ') |');
  L.push('', '### Every notice kind', '', '| Notice | Kind | Member | Recipient | Request ID | Router receipt | Mail account | Mail record (event ID) | Mail subject | Body equals the notice |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of g.stages.receiver_commit.receipts) {
    const n = g.stages.local_commit.notices.find(x => x.id === r.notice_id), b = g.stages.receiver_commit.readback.find(x => x.notice_id === r.notice_id);
    L.push('| ' + r.notice_id + ' | ' + n.kind + ' | ' + n.member_id + ' | ' + r.recipient_id + ' | `' + r.request_id + '` | ' + r.status + ' | ' + r.account_id + ' | `' + r.event_id + '` | ' + b.subject + ' | ' + b.body_matches_notice + ' |');
  }
  L.push('', '| Stage | Evidence |', '| --- | --- |',
    '| Local commit | ' + g.stages.local_commit.notices.length + ' entries in Larkfield\'s log, ' + code(g.stages.local_commit.notices.map(x => x.id + ' ' + x.kind)) + ', Larkfield version ' + g.stages.local_commit.larkfield_version + ', unchanged by publishing |',
    '| Receiver commit | ' + g.stages.receiver_commit.receipts.length + ' committed Router receipts; Mail `env.event_status`: ' + code([...new Set(g.stages.receiver_commit.mail_event_status.map(x => x.status))]) + ' for every event; records ' + code(Object.fromEntries(Object.entries(g.stages.receiver_commit.records).map(([k, v]) => [k, v.length]))) + '; every body read back through `mail.get` equals the notice text. Held in Larkfield\'s log, not sent: ' + Object.entries(g.stages.receiver_commit.held.reduce((a, h) => { (a[h.reason] = a[h.reason] || []).push(h.notice_id + ' to ' + h.recipient_id); return a; }, {})).map(([reason, list]) => list.length + ' as `' + reason + '` (' + list.join(', ') + ')').join('; ') + '. Mail receives every record at the aligned clock (the time the sender ran); each receipt\'s CloudEvents time keeps the notice\'s own time |',
    '| Business confirmation | ' + g.stages.business_confirmation + ' |',
    '| Retry | an identical `adapter.send()` returns ' + code(g.retry.status) + ' with every receipt marked duplicate (' + g.retry.receipts.filter(r => r.duplicate).length + ' of ' + g.retry.receipts.length + '); Mail still holds ' + code(g.retry.mail_records) + ' records |', '',
    '## Part 2: a refusal before dispatch', '',
    '| Item | Evidence |', '| --- | --- |',
    '| Run | `' + f.run + '` |', '| Condition | ' + cell(f.condition) + ' |', '| Action | ' + cell(f.action) + ' |',
    '| Pending entries | ' + code(f.pending) + ' |',
    '| Result | ' + code({ status: f.status, refused: f.refused, held: f.held }) + ' |',
    '| Router receipts | ' + code(f.receipts.map(r => r.request_id + ' ' + r.account_id + ' ' + r.status + (r.code ? ' ' + r.code : '') + (r.event_id ? ' ' + r.event_id : ''))) + ' |',
    '| Larkfield | version ' + f.larkfield.before + ' → ' + f.larkfield.after + ', data SHA-256 ' + code(f.larkfield.state_sha256_before) + ' → ' + code(f.larkfield.state_sha256_after) + ' |',
    '| Mail | ' + code(f.mail.before) + ' → ' + code(f.mail.after) + ' |',
    '| Routers halted | ' + code(f.routers_halted) + ' |', '',
    'The refused entry stays in Larkfield\'s log; the refused inbox is unchanged record for record, and the other inbox receives only its own entry. No case rolls back or changes the other App: a refused or unknown delivery leaves Larkfield\'s committed state and notice log as they were, and Mail only ever holds records whose receipts it committed. There is no cross-App transaction.', '',
    '## Part 3: integration run', '',
    '`' + d.integration.command + '` stages a copy of the runtime, this package and ' + d.integration.receiver.replace(/^mail /, 'Mail ') + ' and runs each case on its own run ID: delivery, retry and reset, a colon in the account ID, missing and ungranted recipients, foreign and incompatible Routers, receiver rejection, receiver resets, lost replies and their reconciliation, ambiguous and pinned destinations, misbound sessions, locks, timeouts and lost fences. Node ' + d.integration.node + ', runtime ' + d.integration.runtime + '. All ' + d.integration.checks.length + ' checks passed:', '',
    ...d.integration.checks.map(c => '- ' + c.name), '',
    '## Reproduce', '', '```sh', 'npm ci && npx playwright install chromium', d.command, 'node apps/larkfield-health/tests/mail.integration.cjs --report .artifacts/larkfield-mail.json', '```', '',
    'Full data: [demo.json](demo.json).', '');
  return L.join('\n');
}

function publish(staging, final) {
  fs.mkdirSync(final, { recursive: true });
  for (const e of fs.readdirSync(final)) fs.rmSync(path.join(final, e), { recursive: true, force: true });
  fs.cpSync(staging, final, { recursive: true });
}

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'larkfield-mail-evidence-'));
  OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'larkfield-mail-capture-'));
  try {
    fs.mkdirSync(path.join(OUT, 'gui'), { recursive: true });
    const report = integration(scratch);
    const gui = await guiDemo(scratch);
    const refusal = await refusalDemo(scratch);
    const demo = { schema: 'larkfield.mail-demonstration.v1', captured_on: CAPTURED_ON || new Date().toISOString().slice(0, 10), command: COMMAND, node: process.version, larkfield_load_digest: runtimeDigest(appDir).sha256, host: hostRevision(root), participants: participants(), gui, refusal, integration: { command: 'node apps/larkfield-health/tests/mail.integration.cjs --report FILE', receiver: report.receiver, runtime: report.runtime, node: report.node, checks: report.checks } };
    fs.writeFileSync(path.join(OUT, 'demo.json'), JSON.stringify(demo, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT, 'README.md'), markdown(demo));
    publish(OUT, FINAL);
    console.log('mail evidence: ' + gui.steps.length + ' GUI steps, ' + gui.stages.receiver_commit.receipts.length + ' deliveries of ' + KINDS.length + ' notice kinds, ' + report.checks.length + ' integration checks');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true }); }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
