#!/usr/bin/env node
'use strict';
// Browser acceptance for Crossway's nine pages on the shared business Web Host
// (runtime/web/server.cjs), with real Chromium through Playwright:
//   - the controller names every tool, its icons are embedded 16x16 PNGs, and
//     the page loads with no JavaScript error;
//   - each page shows the values the tools return for the same run;
//   - writes made through the pages commit the state the tools then return,
//     business errors and stale versions are shown in place with state
//     unchanged, and a retry after a lost response has one effect;
//   - controls follow the permission profile; the pages fit a 390px viewport;
//   - all three seeds render; and, the page half of check (e), no sentinel of
//     a pending event appears on any page before the event fires.
// Needs `npm ci` and `npx playwright install chromium` at the repository root.
// Run from a full checkout: node apps/crossway/tests/web-checks.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {root, hash, loadSeed, sentinelSchedule, SEEDS} = require('./platform-lib.cjs');
const {chromium} = require(path.join(root, 'node_modules/playwright'));
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {block} = require('../scripts/build-icons.cjs');

const appDir = path.resolve(__dirname, '..');
const registry = path.join(appDir, 'web-registry.json');
const out = path.join(root, '.artifacts/crossway-web');
const VIEWS = ['account', 'topup', 'statements', 'vehicles', 'tolls', 'notices', 'pay', 'disputes', 'policies'];
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toFixed(2);

async function main() {
  fs.mkdirSync(out, {recursive: true});
  const results = [];
  const ok = (name, condition) => { assert.ok(condition, name); results.push(name); };

  // ---- Package checks ----
  const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8');
  ok('the controller names every declared tool', require('../tools.json').every(t => controller.includes(`'${t.name}'`)));
  ok('icons are the build-icons output; no SVG or data: URI in the page files', controller.includes(block()) && !/<svg|data:image/i.test(controller + fs.readFileSync(path.join(appDir, 'gui/index.html'), 'utf8')));
  const icons = [...block().matchAll(/ (\w+):'([A-Za-z0-9+/=]+)'/g)];
  ok('ten embedded icons, each a 16x16 PNG', icons.length === 10 && icons.every(([, , b64]) => {
    const png = Buffer.from(b64, 'base64');
    return png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 16 && png.readUInt32BE(20) === 16;
  }));
  const gui = require('../contribution/gui.json'), web = gui.extensions.find(e => e.namespace === 'pale.web').data;
  ok('gui.json declares the pages with pale.web and contribution.json points at it',
    require('../contribution/contribution.json').gui_ref === 'gui.json' && web.page === 'gui/index.html' && web.controller === 'gui/src/app.js' && gui.content_policy.svg === 'disabled');

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossway-web-'));
  const browser = await chromium.launch({headless: true});
  let host, infra, context;
  try {
    host = await start({app: 'crossway', registry, stateDir, run: 'web'});
    infra = new Client('crossway', 'infra', host.run, stateDir, 'crossway-web-inspector', {registry});
    await infra.initialize();
    const tool = async (name, args = {}) => host.client.call('crossway.' + name, args);
    const snap = async () => (await infra.call('env.snapshot')).snapshot;
    context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(host.accessUrl);
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const show = async view => {
      await page.locator(`nav button[data-view=${view}]`).click();
      await page.waitForFunction(v => document.querySelector('#view')?.dataset.view === v && document.querySelector('#app').getAttribute('aria-busy') === 'false', view);
    };
    const refresh = async () => { await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await idle(); };
    const cell = (id, col) => page.locator(`#view tr[data-record-id="${id}"] td[data-col=${col}]`).first().innerText();
    const alert = page.locator('#view form [role=alert]:not(:empty)');
    await idle();
    ok('the Host serves the page; the clock shown is the seed clock', (await page.locator('[data-key=clock]').innerText()).includes('2026-11-02 09:00'));
    ok('nine pages, each with a loaded PNG icon', await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('nav button img')];
      return imgs.length === 9 && imgs.every(i => i.complete && i.naturalWidth === 16 && i.src.startsWith('blob:'));
    }));

    // ---- Each page shows what the tools return ----
    const a = (await tool('account.get')).account;
    await show('account');
    ok('account: status, balance and the replenish card', (await page.locator('[data-key=balance] strong').innerText()) === money(a.balance_cents) &&
      (await page.locator('[data-key=status] strong').innerText()) === a.status &&
      (await page.locator('[data-key=replenish-card] strong').innerText()) === `${a.replenish.card.label}, ${a.replenish.card.holder_name}`);
    for (const c of a.cards) assert.equal(await cell(c.id, 'expired'), c.expired ? 'yes' : 'no', c.id);
    ok('account: every card with its expiry flag', true);
    await show('topup');
    ok('top-up: the balance', (await page.locator('[data-key=balance] strong').innerText()) === money(a.balance_cents));
    const st = (await tool('account.statements')).statements;
    await show('statements');
    for (const s of st) assert.equal(await cell(s.id, 'closing'), money(s.closing_balance_cents), s.id);
    ok(`statements: all ${st.length} periods with their closing balances`, (await page.locator('#view tbody tr').count()) === st.length);
    const vs = (await tool('vehicles.list')).vehicles, tps = (await tool('transponders.list')).transponders;
    await show('vehicles');
    for (const v of vs) assert.deepEqual([await cell(v.id, 'plate'), await cell(v.id, 'status'), await cell(v.id, 'transponder')], [v.plate, v.status, v.transponder_id || ''], v.id);
    for (const t of tps) assert.equal(await cell(t.id, 'class'), String(t.class), t.id);
    ok('vehicles and transponders: plate, status, transponder and charged class', true);
    const tl = await tool('tolls.list', {limit: 500});
    await show('tolls');
    ok('tolls: count and every row\'s amount and disposition', (await page.locator('[data-key=toll-count]').innerText()).startsWith(`${tl.tolls.length} of ${tl.total} tolls`) &&
      (await page.locator('#view tbody tr').count()) === tl.tolls.length);
    for (const t of tl.tolls.slice(0, 40)) assert.deepEqual([await cell(t.id, 'amount'), await cell(t.id, 'disposition')], [money(t.amount_cents), t.disposition], t.id);
    const ns = (await tool('notices.list')).notices;
    await show('notices');
    for (const n of ns) assert.deepEqual([await cell(n.id, 'state'), await cell(n.id, 'amount'), await cell(n.id, 'due')], [n.state, money(n.amount_due_cents), n.due_date], n.id);
    ok(`notices: all ${ns.length} with state, amount due and due date`, true);
    await page.locator('#view tr[data-record-id="n-0017"]').click();
    await page.locator('#view [data-selected-id="n-0017"]').waitFor();
    const n17 = (await tool('notices.get', {notice_id: 'n-0017'})).notice;
    ok('notice detail: state, amount due and due date', (await page.locator('[data-selected-id="n-0017"] [data-key=amount-due] strong').innerText()) === money(n17.amount_due_cents) &&
      (await page.locator('[data-selected-id="n-0017"] [data-key=due-date] strong').innerText()) === n17.due_date);
    await show('pay');
    const checked = await page.$$eval('#view input[data-field=notice_ids]', bs => bs.filter(b => b.checked).map(b => b.value));
    ok('payment page preselects exactly the payable notices', JSON.stringify(checked) === JSON.stringify(ns.filter(n => n.payable).map(n => n.id)) && checked.length > 0);
    await show('disputes');
    const dps = ns.filter(n => n.dispute_id);
    ok('disputes: one row per dispute', (await page.locator('#view tbody tr[data-record-id^="dp-"]').count()) === dps.length);
    const pol = (await tool('policies.get')).policies;
    await show('policies');
    ok('policies: the rules text', JSON.stringify(await page.locator('[data-key=rules] li').allInnerTexts()) === JSON.stringify(pol.rules));
    for (const v of VIEWS) { await show(v); await page.screenshot({path: path.join(out, `dani-${v}.png`), fullPage: true}); }

    // ---- Writes through the pages ----
    await show('topup');
    let before = hash(await snap());
    await page.locator('#view [data-field=amount_cents]').fill('50');
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-mc');
    await page.getByRole('button', {name: 'Preview top-up'}).click();
    await idle();
    ok('an expired card is refused in place with card_expired; nothing changes', (await alert.getAttribute('data-code')) === 'card_expired' && hash(await snap()) === before);
    await page.locator('#view [data-field=amount_cents]').fill('25.00');
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    await page.getByRole('button', {name: 'Preview top-up'}).click();
    await page.locator('#view .cw-preview').waitFor();
    // Lose the first confirm response after Core commits it; the retry reuses the request ID.
    let dropped = false;
    await page.route('**/api/call', async route => {
      if (!dropped && route.request().postDataJSON().name === 'crossway.account.topup.confirm') { dropped = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
    });
    const receipts = (await snap()).data.receipts.length;
    await page.getByRole('button', {name: 'Confirm top-up'}).click();
    await page.locator('#view .cw-preview [role=alert]:not(:empty)').waitFor();
    await page.getByRole('button', {name: 'Confirm top-up'}).click();
    await page.locator('#view .cw-done').waitFor();
    await page.unroute('**/api/call');
    const afterTopup = await snap();
    ok('a top-up confirmed after a lost response commits once, and the receipt shown is the stored one',
      afterTopup.data.receipts.length === receipts + 1 && afterTopup.data.balance_cents === a.balance_cents + 2500 &&
      (await page.locator('#view .cw-done').getAttribute('data-receipt-id')) === afterTopup.data.receipts.at(-1).id);

    await show('account');
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    await page.getByRole('button', {name: 'Save auto-replenish'}).click();
    await page.locator('#view .cw-done').waitFor();
    ok('auto-replenish moved to Dani\'s Visa through the page', (await snap()).data.replenish.card_id === 'card-dani-visa');

    await show('vehicles');
    await page.locator('#view tr[data-record-id="v-0002"]').click();
    await page.locator('#view [data-selected-id="v-0002"]').waitFor();
    await page.locator('#view [data-selected-id="v-0002"] [data-field=end_date]').fill('2026-09-28');
    await page.getByRole('button', {name: 'End possession'}).click();
    await page.locator('#view .cw-done').waitFor();
    const fit = (await snap()).data.vehicles.find(v => v.id === 'v-0002');
    ok('possession of the sold Fit ended on the sale date through the page', fit.ended_at !== null && fit.possession_end === '2026-09-28');
    await page.locator('#view tr[data-record-id="v-0004"]').click();
    await page.locator('#view [data-selected-id="v-0004"]').waitFor();
    await page.locator('#view [data-selected-id="v-0004"] [data-field=transponder_id]').selectOption('tp-0001');
    await page.getByRole('button', {name: 'Assign transponder'}).click();
    await page.locator('#view .cw-done').waitFor();
    const tp1 = (await snap()).data.transponders.find(t => t.id === 'tp-0001');
    ok('transponder moved to the Kia at class 1 through the page', tp1.vehicle_id === 'v-0004' && tp1.class === 1);

    const fileDispute = async (noticeId) => {
      await show('disputes');
      await page.locator('#view [data-field=notice_id]').selectOption(noticeId);
      await page.locator('#view [data-field=reason]').selectOption('sold_or_not_in_possession');
      await page.locator('#view [data-field=transfer_date]').fill('2026-09-28');
      await page.locator('#view [data-field=evidence]').fill('mail/mail-dani/m-11133');
      await page.getByRole('button', {name: 'Preview dispute'}).click();
      await page.locator('#view .cw-preview').waitFor();
      await page.getByRole('button', {name: 'Submit dispute'}).click();
      await page.locator('#view .cw-done').waitFor();
    };
    await fileDispute('n-0017');
    const d17 = (await tool('disputes.get', {notice_id: 'n-0017'})).dispute;
    ok('a dispute filed through the page is stored with its reason, date and evidence',
      d17.state === 'submitted' && d17.transfer_date === '2026-09-28' && JSON.stringify(d17.evidence) === JSON.stringify([{app_id: 'mail', account_id: 'mail-dani', object_id: 'm-11133'}]));
    await fileDispute('n-0018');
    const d18 = (await tool('disputes.get', {notice_id: 'n-0018'})).dispute;
    await page.locator(`#view tr[data-record-id="${d18.id}"] button`).click();
    await page.locator('#view .cw-done', {hasText: 'withdrawn'}).waitFor();
    ok('a dispute withdrawn through the page', (await tool('disputes.get', {dispute_id: d18.id})).dispute.state === 'withdrawn');

    await show('pay');
    before = hash(await snap());
    await page.locator('#view input[value="n-0001"]').check();
    await page.getByRole('button', {name: 'Preview payment'}).click();
    await idle();
    ok('one ineligible notice rejects the preview, named in place; nothing changes',
      (await alert.getAttribute('data-code')) === 'in_collections' && (await alert.innerText()).includes('n-0001') && hash(await snap()) === before);
    await refresh();
    for (const box of await page.locator('#view input[data-field=notice_ids]').all()) {
      if (['n-0014', 'n-0016'].includes(await box.getAttribute('value'))) await box.check(); else await box.uncheck();
    }
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    // Another client changes the account after the page loaded: the page's version is stale.
    await host.client.call('crossway.account.replenish.set', {expected_version: (await infra.call('env.snapshot')).version, request_id: 'outside-change', enabled: true});
    before = hash(await snap());
    await page.getByRole('button', {name: 'Preview payment'}).click();
    await idle();
    ok('a stale page shows stale_version and writes nothing', (await alert.getAttribute('data-code')) === 'stale_version' && hash(await snap()) === before);
    await refresh();
    for (const box of await page.locator('#view input[data-field=notice_ids]').all()) {
      if (['n-0014', 'n-0016'].includes(await box.getAttribute('value'))) await box.check(); else await box.uncheck();
    }
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    await page.getByRole('button', {name: 'Preview payment'}).click();
    await page.locator('#view .cw-preview').waitFor();
    const n14 = ns.find(n => n.id === 'n-0014'), n16 = ns.find(n => n.id === 'n-0016');
    ok('the payment preview shows the lines, total, cardholder and the final-payment text',
      (await page.locator('#view .cw-preview [data-key=total] strong').innerText()) === money(n14.amount_due_cents + n16.amount_due_cents) &&
      (await page.locator('#view .cw-preview [data-key=holder] strong').innerText()) === 'Dani Reyes' &&
      (await page.locator('#view .cw-final').innerText()) === 'Payment is final and closes the right to dispute.');
    await page.getByRole('button', {name: 'Confirm payment'}).click();
    await page.locator('#view .cw-done').waitFor();
    const paid = (await snap()).data;
    ok('the payment confirmed through the page paid both notices on Dani\'s Visa',
      ['n-0014', 'n-0016'].every(id => paid.notices.find(n => n.id === id).state === 'paid') && paid.receipts.at(-1).card_id === 'card-dani-visa');

    await page.reload();
    await idle();
    ok('reload keeps the page and shows committed state', (await page.locator('#view').getAttribute('data-view')) === 'pay' &&
      (await page.locator('#view input[value="n-0014"]').count()) === 0 && (await page.locator('#view input[value="n-0013"]').isChecked()));
    const ev = require('../examples/schedules/dani.json').events[0];
    await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: ev});
    await show('tolls');
    await refresh();
    ok('refresh shows a toll posted by a scenario event', (await page.locator(`#view tr[data-record-id="${ev.payload.toll_id}"]`).count()) === 1);
    ok('a direct management request from the page session is refused', await page.evaluate(async () => {
      const {csrf} = await (await fetch('/session')).json();
      return (await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name: 'env.snapshot', arguments: {}})})).status;
    }) === 403);

    // ---- Controls follow the permission profile ----
    await infra.call('env.reset', {expected_version: (await infra.call('env.snapshot')).version, profile: 'browse'});
    await show('topup');
    await page.locator('#view [data-field=amount_cents]').fill('20');
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    await page.getByRole('button', {name: 'Preview top-up'}).click();
    await page.locator('#view .cw-preview').waitFor();
    ok('browse: a top-up can be previewed but has no confirm control', (await page.getByRole('button', {name: 'Confirm top-up'}).count()) === 0);
    await show('vehicles');
    await page.locator('#view tr[data-record-id="v-0002"]').click();
    await page.locator('#view [data-selected-id="v-0002"]').waitFor();
    ok('browse: no end or correction controls; transponder assignment stays',
      (await page.getByRole('button', {name: 'End possession'}).count()) === 0 && (await page.getByRole('button', {name: 'Save corrections'}).count()) === 0 &&
      (await page.getByRole('button', {name: 'Assign transponder'}).count()) === 1);
    await infra.call('env.reset', {expected_version: (await infra.call('env.snapshot')).version, profile: 'scenario'});
    await show('pay');
    ok('scenario (reads only): no payment controls', (await page.getByRole('button', {name: 'Preview payment'}).count()) === 0);

    // ---- Narrow viewport ----
    await page.setViewportSize({width: 390, height: 844});
    for (const v of VIEWS) {
      await show(v);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + v);
    }
    ok('all nine pages fit a 390px viewport without horizontal page scroll', true);
    await page.setViewportSize({width: 1280, height: 900});

    // ---- Other seeds, and check (e) on the pages ----
    const sentinelPages = {};
    for (const {seed_id: id} of SEEDS) {
      await loadSeed(infra, id, 'full');
      const acc = (await tool('account.get')).account;
      await show('account');
      await refresh();
      assert.equal(await page.locator('[data-key=balance] strong').innerText(), money(acc.balance_cents), id);
      assert.equal(await page.locator('[data-key=status] strong').innerText(), acc.status.replace(/_/g, ' '), id);
      if (acc.status === 'suspended') assert.equal(await page.locator('.cw-banner').count(), 1, id);
      const list = (await tool('notices.list')).notices;
      await show('notices');
      for (const n of list) assert.equal(await cell(n.id, 'state'), n.state, `${id} ${n.id}`);
      for (const v of VIEWS) { await show(v); await page.screenshot({path: path.join(out, `${id}-${v}.png`), fullPage: true}); }
      const schedule = sentinelSchedule(id);
      let renders = 0;
      const pagesText = async () => {
        let text = '';
        for (const v of VIEWS) { await show(v); text += await page.locator('#app').innerText() + await page.locator('#app').innerHTML(); renders++; }
        return text;
      };
      for (const [k, item] of schedule.entries()) {
        const text = await pagesText();
        for (const x of schedule.slice(k).flatMap(e => e.all)) assert.ok(!text.includes(x), `${id}: pending ${x} on a page`);
        await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: item.event});
        if (item.surfaces.length) {
          await show('tolls');
          await refresh();
          for (const x of item.surfaces) assert.ok((await page.locator('#view').innerText()).includes(x), `${id}: fired ${x} not shown`);
        }
      }
      const final = await pagesText();
      for (const x of schedule.flatMap(e => e.hidden)) assert.ok(!final.includes(x), `${id}: hidden ${x} on a page`);
      sentinelPages[id] = {events: schedule.length, page_renders: renders};
    }
    ok('all three seeds render with their balance, status and notices', true);
    ok('(e) on the pages: no pending sentinel on any of the nine pages before its event; fired tolls appear; decision tables never do', true);
    ok('no JavaScript errors', errors.length === 0);
    const report = {app: 'crossway', checked_at: new Date().toISOString(), browser: browser.version(), node: process.version, passed: results, sentinel_pages: sentinelPages, screenshots: path.relative(root, out)};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context?.close();
    await browser.close();
    await infra?.close();
    await host?.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
