#!/usr/bin/env node
'use strict';
// Browser acceptance for Crossway's nine pages on the shared business Web Host
// (runtime/web/server.cjs), with real Chromium through Playwright:
//   - the controller names every tool, its icons are embedded 16x16 PNGs, and
//     the page loads with no JavaScript error;
//   - each page shows the values the tools return for the same run, with dates
//     in a US format and the Eastern zone, IDs secondary, and no App text
//     under 12px;
//   - writes made through the pages commit the state the tools then return;
//     destructive actions (end possession, withdraw a dispute) ask first and
//     can be cancelled; previews can be cancelled; business errors and stale
//     versions are shown in place with state unchanged, and a new submission
//     clears the previous receipt; a retry after a lost response has one
//     effect;
//   - choices that are certain to fail (an expired card, a notice in
//     collections) are disabled with the reason, and a client that submits
//     them anyway is refused by the App in place;
//   - controls follow the permission profile; an unknown page has its own
//     title; the pages fit a 390px viewport;
//   - all four seeds render; and, the page half of check (e), no sentinel of
//     a pending event appears on any page before the event fires.
// With --evidence it also writes the curated workflow screenshots and their
// manifest to apps/crossway/evidence/screens/ (see evidence/README.md).
// Needs `npm ci` and `npx playwright install chromium` at the repository root.
// Run from a full checkout: node apps/crossway/tests/web-checks.cjs [--evidence]
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {root, hash, loadSeed, sentinelSchedule, SEEDS} = require('./platform-lib.cjs');
const {chromium} = require(path.join(root, 'node_modules/playwright'));
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {block} = require('../scripts/build-icons.cjs');

const appDir = path.resolve(__dirname, '..');
const registry = path.join(appDir, 'web-registry.json');
const out = path.join(root, '.artifacts/crossway-web');
const EVIDENCE = process.argv.includes('--evidence');
const evidenceDir = path.join(appDir, 'evidence/screens');
const VIEWPORT = {width: 1280, height: 800};
const VIEWS = ['account', 'topup', 'statements', 'vehicles', 'tolls', 'notices', 'pay', 'disputes', 'policies'];
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toFixed(2);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = d => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const git = (...args) => { try { return execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim(); } catch { return null; } };

async function main() {
  fs.mkdirSync(out, {recursive: true});
  if (EVIDENCE) {
    fs.mkdirSync(evidenceDir, {recursive: true});
    for (const f of fs.readdirSync(evidenceDir)) if (f.endsWith('.png')) fs.rmSync(path.join(evidenceDir, f));
  }
  const results = [];
  const ok = (name, condition) => { assert.ok(condition, name); results.push(name); };
  const shots = [];

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
  let host, infra, context, page;
  try {
    host = await start({app: 'crossway', registry, stateDir, run: 'web'});
    infra = new Client('crossway', 'infra', host.run, stateDir, 'crossway-web-inspector', {registry});
    await infra.initialize();
    const tool = async (name, args = {}) => host.client.call('crossway.' + name, args);
    const snap = async () => (await infra.call('env.snapshot')).snapshot;
    context = await browser.newContext({viewport: VIEWPORT});
    page = await context.newPage();
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
    let seedId = 'dani';
    // One curated screenshot of a workflow step: the element scrolled into view,
    // the visible part of the main column (the sidebar only names the page,
    // which the heading also shows); at a narrow width, the whole viewport.
    const shot = async (sequence, step, caption, {focus = null, records = []} = {}) => {
      if (focus) await page.locator(focus).first().scrollIntoViewIfNeeded();
      const file = `${sequence}-${String(step).padStart(2, '0')}.png`;
      const size = page.viewportSize(), main = await page.locator('main.app-main').boundingBox();
      const clip = size.width >= 1000 && main ? {x: Math.round(main.x), y: 0, width: size.width - Math.round(main.x), height: size.height} : undefined;
      await page.screenshot({path: path.join(out, 'evidence-' + file), clip});
      if (EVIDENCE) await page.screenshot({path: path.join(evidenceDir, file), clip});
      shots.push({file, sequence, step, caption, seed: seedId, view: await page.locator('#view').getAttribute('data-view'), records});
    };
    await idle();
    ok('the Host serves the page; the clock shows the seed clock in a US format with the zone',
      (await page.locator('[data-key=clock]').innerText()) === 'Account time: Nov 2, 2026, 9:00 AM EST (US Eastern)' &&
      (await page.locator('[data-key=clock]').getAttribute('data-as-of')) === '2026-11-02T09:00:00-05:00');
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
    for (const c of a.cards) {
      assert.equal(await cell(c.id, 'expired'), c.expired ? 'yes' : 'no', c.id);
      const cls = await page.locator(`#view tr[data-record-id="${c.id}"] td[data-col=expired] .cw-badge`).getAttribute('class');
      assert.ok(c.expired ? /\bbad\b/.test(cls) : /\bneutral\b/.test(cls), `${c.id} expired badge ${cls}`);
    }
    ok('account: every card with its expiry flag; an expired card is marked in the danger style, a valid one neutral', true);
    await show('topup');
    ok('top-up: the balance', (await page.locator('[data-key=balance] strong').innerText()) === money(a.balance_cents));
    const st = (await tool('account.statements')).statements;
    await show('statements');
    for (const s of st) assert.equal(await cell(s.id, 'closing'), money(s.closing_balance_cents), s.id);
    ok(`statements: all ${st.length} periods with their closing balances`, (await page.locator('#view tbody tr').count()) === st.length &&
      (await cell(st.at(-1).id, 'period')) === 'October 2026');
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
    ok('tolls: times in a US format with the zone', /^[A-Z][a-z]{2} \d{1,2}, 2026, \d{1,2}:\d{2} (AM|PM) E[SD]T$/.test(await cell(tl.tolls[0].id, 'time')));
    const ns = (await tool('notices.list')).notices;
    await show('notices');
    for (const n of ns) assert.deepEqual([await cell(n.id, 'state'), await cell(n.id, 'amount'), await cell(n.id, 'due')], [n.state, money(n.amount_due_cents), day(n.due_date)], n.id);
    ok(`notices: all ${ns.length} with state, amount due and due date; the notice ID is the last column`,
      (await page.locator('#view thead th').last().innerText()) === 'Notice');
    await page.locator('#view tr[data-record-id="n-0017"]').click();
    await page.locator('#view [data-selected-id="n-0017"]').waitFor();
    const n17 = (await tool('notices.get', {notice_id: 'n-0017'})).notice;
    ok('notice detail: state, amount due, due date, and a history with zoned times',
      (await page.locator('[data-selected-id="n-0017"] [data-key=amount-due] strong').innerText()) === money(n17.amount_due_cents) &&
      (await page.locator('[data-selected-id="n-0017"] [data-key=due-date] strong').innerText()) === day(n17.due_date) &&
      (await page.locator('[data-selected-id="n-0017"] [data-key=history] li').first().innerText()).startsWith('Oct 11, 2026, 7:42 AM EDT: '));
    await show('pay');
    const checked = await page.$$eval('#view input[data-field=notice_ids]', bs => bs.filter(b => b.checked).map(b => b.value));
    ok('payment page preselects exactly the payable notices', JSON.stringify(checked) === JSON.stringify(ns.filter(n => n.payable).map(n => n.id)) && checked.length > 0);
    const disabled = await page.$$eval('#view input[data-field=notice_ids]', bs => bs.filter(b => b.disabled).map(b => b.value));
    ok('payment page: every notice that cannot be paid has a disabled box and the reason beside it',
      JSON.stringify(disabled) === JSON.stringify(ns.filter(n => ['disputed', 'collections'].includes(n.state)).map(n => n.id)) && disabled.length > 0 &&
      (await cell('n-0001', 'why')) === 'In collections: no longer payable here.');
    await show('disputes');
    const dps = ns.filter(n => n.dispute_id);
    ok('disputes: one row per dispute, evidence as a sentence', (await page.locator('#view tbody tr[data-record-id^="dp-"]').count()) === dps.length);
    const pol = (await tool('policies.get')).policies;
    await show('policies');
    ok('policies: the rules text', JSON.stringify(await page.locator('[data-key=rules] li').allInnerTexts()) === JSON.stringify(pol.rules));
    await shot('policies', 1, 'Rates and policies: the rules, then account and by-mail rates for each plaza and class (Crossway\'s own fictional rates).', {focus: '#view .cw-panel >> nth=2'});
    const small = [];
    for (const v of VIEWS) {
      await show(v);
      await page.screenshot({path: path.join(out, `dani-${v}.png`), fullPage: true});
      small.push(...await page.evaluate(() => [...document.querySelectorAll('#app *')].filter(e => e.childElementCount === 0 && e.textContent.trim() && e.offsetParent !== null)
        .map(e => [e.tagName, parseFloat(getComputedStyle(e).fontSize), e.textContent.trim().slice(0, 30)]).filter(([, size]) => size < 12)));
    }
    ok('no App text on any page is smaller than 12px', small.length === 0 || assert.fail(JSON.stringify(small.slice(0, 5))));
    await page.evaluate(() => { location.hash = 'no-such-page'; });
    await page.waitForFunction(() => document.querySelector('#view')?.dataset.view === 'not_found' && document.querySelector('#app').getAttribute('aria-busy') === 'false');
    ok('an unknown page says so and has its own title', (await page.title()) === 'Page not found | Crossway' && (await page.locator('[data-key=not-found]').count()) === 1);
    await shot('not-found', 1, 'An address that names no page: "Page not found" in the heading and the browser title, with a way back.');

    // ---- Writes through the pages ----
    // Top-up: an expired card is disabled; a client that submits it anyway is refused.
    await show('topup');
    await shot('topup', 1, 'Start: Dani\'s balance and status; the card list offers her own cards, and the expired Mastercard is disabled with its expiry.', {records: ['card-dani-mc']});
    ok('top-up: the expired Mastercard is listed but disabled, with the reason', await page.$eval('#view [data-field=card_id] option[value="card-dani-mc"]', o => o.disabled && o.textContent.includes('expired 09/2026')));
    let before = hash(await snap());
    await page.locator('#view [data-field=amount_cents]').fill('50');
    await page.$eval('#view [data-field=card_id] option[value="card-dani-mc"]', o => { o.disabled = false; });
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-mc');
    await page.getByRole('button', {name: 'Preview top-up'}).click();
    await idle();
    ok('a client that submits the expired card anyway is refused in place with card_expired; nothing changes', (await alert.getAttribute('data-code')) === 'card_expired' && hash(await snap()) === before);
    await shot('topup', 2, 'Error path card_expired: a client that ignores the disabled option submits the expired Mastercard; the App refuses in place and nothing is stored.', {focus: '#view form [role=alert]', records: ['card-dani-mc']});
    await show('topup');
    await page.locator('#view [data-field=amount_cents]').fill('25.00');
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    await page.getByRole('button', {name: 'Preview top-up'}).click();
    await page.locator('#view .cw-preview').waitFor();
    ok('the top-up preview states the charge, the card and the expiry with its zone',
      (await page.locator('#view .cw-preview [data-key=card]').innerText()) === 'Visa ending 4417, Dani Reyes' && / EST$/.test(await page.locator('#view .cw-preview [data-key=expires]').innerText()));
    await shot('topup', 3, 'Preview: $25.00 from Dani\'s Visa, balance before and after, preview expiry in Eastern time; Confirm or Cancel.', {focus: '#view .cw-preview'});
    before = hash(await snap());
    await page.locator('#view .cw-preview button[data-action=cancel]').click();
    await idle();
    ok('Cancel closes the preview and writes nothing', (await page.locator('#view .cw-preview').count()) === 0 && hash(await snap()) === before);
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
    ok('a lost confirm response shows an error in the preview, not a receipt', (await page.locator('#view .cw-done').count()) === 0);
    await shot('topup', 4, 'Lost response: the confirm committed but its response was dropped; the page shows the network error in the preview and no receipt.', {focus: '#view .cw-preview'});
    await page.getByRole('button', {name: 'Confirm top-up'}).click();
    await page.locator('#view .cw-done').waitFor();
    await page.unroute('**/api/call');
    const afterTopup = await snap();
    const topupReceipt = afterTopup.data.receipts.at(-1).id;
    ok('a top-up confirmed after a lost response commits once, and the receipt shown is the stored one',
      afterTopup.data.receipts.length === receipts + 1 && afterTopup.data.balance_cents === a.balance_cents + 2500 &&
      (await page.locator('#view .cw-done').getAttribute('data-receipt-id')) === topupReceipt);
    await shot('topup', 5, 'Retry with the same request ID returns the first receipt: one charge, balance up by $25.00.', {records: [topupReceipt]});
    await refresh();
    ok('the receipt stays on the page where it was made after a refresh', (await page.locator('#view .cw-done').getAttribute('data-receipt-id')) === topupReceipt);

    // Auto-replenish: save, then a failed save clears the previous receipt.
    await show('account');
    await shot('replenish', 1, 'Start: auto-replenish runs on Jordan Albright\'s Amex; Dani\'s Mastercard is marked expired.', {focus: '#view [aria-label=Auto-replenish]', records: ['card-jordan-amex', 'card-dani-mc']});
    ok('a receipt from another page is not carried over', (await page.locator('#view .cw-done').count()) === 0);
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    await page.getByRole('button', {name: 'Save auto-replenish'}).click();
    await page.locator('#view .cw-done').waitFor();
    ok('auto-replenish moved to Dani\'s Visa through the page', (await snap()).data.replenish.card_id === 'card-dani-visa' &&
      (await page.locator('#view .cw-done').innerText()).includes('Visa ending 4417 (Dani Reyes)'));
    await shot('replenish', 2, 'Saved: the receipt names the rule as stored (on, $40.00 below $15.00, Dani\'s Visa).', {records: ['card-dani-visa']});
    before = hash(await snap());
    await page.locator('#view [data-field=amount_cents]').fill('500');
    await page.getByRole('button', {name: 'Save auto-replenish'}).click();
    await idle();
    ok('a failed save after a successful one shows only the new error; the old receipt is gone',
      (await alert.getAttribute('data-code')) === 'amount_out_of_range' && (await page.locator('#view .cw-done').count()) === 0 && hash(await snap()) === before);
    await shot('replenish', 3, 'Error path amount_out_of_range: a $500.00 amount is refused in place; the earlier "saved" receipt is cleared, so only the latest outcome shows.', {focus: '#view [aria-label=Auto-replenish]'});

    // End possession: asks first, can be cancelled, refuses a future date in place.
    await show('vehicles');
    await page.locator('#view tr[data-record-id="v-0002"]').click();
    await page.locator('#view [data-selected-id="v-0002"]').waitFor();
    await shot('end-possession', 1, 'Start: the sold Honda Fit HKR4471 is selected; it is still active with possession open.', {focus: '#view [data-selected-id="v-0002"]', records: ['v-0002']});
    before = hash(await snap());
    await page.locator('#view [data-selected-id="v-0002"] [data-field=end_date]').fill('2026-12-01');
    await page.getByRole('button', {name: 'End possession'}).click();
    await page.locator('#view .cw-confirm').waitFor();
    await page.locator('#view .cw-confirm button[data-action=confirm]').click();
    await page.locator('#view .cw-confirm [role=alert]:not(:empty)').waitFor();
    ok('a future end date is refused in the confirmation with end_in_future; nothing changes',
      (await page.locator('#view .cw-confirm [role=alert]').getAttribute('data-code')) === 'end_in_future' && hash(await snap()) === before);
    await shot('end-possession', 2, 'Error path end_in_future: Dec 1, 2026 is after the account date; refused in place, nothing stored.', {focus: '#view .cw-confirm'});
    await page.locator('#view .cw-confirm button[data-action=cancel]').click();
    ok('Keep the vehicle closes the confirmation and writes nothing', (await page.locator('#view .cw-confirm').count()) === 0 && hash(await snap()) === before);
    await page.locator('#view [data-selected-id="v-0002"] [data-field=end_date]').fill('2026-09-28');
    await page.getByRole('button', {name: 'End possession'}).click();
    await page.locator('#view .cw-confirm').waitFor();
    ok('ending possession asks first and names the date', (await page.locator('#view .cw-confirm [data-key=end-date]').innerText()) === 'Sep 28, 2026' && hash(await snap()) === before);
    await shot('end-possession', 3, 'Confirmation: end possession of HKR4471 on Sep 28, 2026, with what that changes; End possession or Keep the vehicle.', {focus: '#view .cw-confirm'});
    await page.locator('#view .cw-confirm button[data-action=confirm]').click();
    await page.locator('#view .cw-done').waitFor();
    const fit = (await snap()).data.vehicles.find(v => v.id === 'v-0002');
    ok('possession of the sold Fit ended on the sale date through the page', fit.ended_at !== null && fit.possession_end === '2026-09-28' &&
      (await page.locator('#view .cw-done').innerText()) === 'Possession of HKR4471 ended on Sep 28, 2026.');
    await shot('end-possession', 4, 'Result: the receipt and the table show HKR4471 ended, possession Jan 6, 2025 to Sep 28, 2026.', {records: ['v-0002']});

    // Transponder assignment.
    await page.locator('#view tr[data-record-id="v-0001"]').click();
    await page.locator('#view [data-selected-id="v-0001"]').waitFor();
    ok('a vehicle that already carries a transponder offers no assignment, and says why',
      (await page.locator('#view [data-key=assign-note]').innerText()).includes('already carries tp-0001') && (await page.getByRole('button', {name: 'Assign transponder'}).count()) === 0);
    await shot('transponder', 1, 'Start: the van VNT8812 still carries tp-0001 at class 2; the page says it cannot take another tag.', {focus: '#view [data-selected-id="v-0001"]', records: ['v-0001', 'tp-0001']});
    await page.locator('#view tr[data-record-id="v-0004"]').click();
    await page.locator('#view [data-selected-id="v-0004"]').waitFor();
    await page.locator('#view [data-selected-id="v-0004"] [data-field=transponder_id]').selectOption('tp-0001');
    await shot('transponder', 2, 'Action: the Kia KLM2210 is selected and tp-0001 (now in VNT8812, class 2) is chosen.', {focus: '#view [data-selected-id="v-0004"]', records: ['v-0004']});
    await page.getByRole('button', {name: 'Assign transponder'}).click();
    await page.locator('#view .cw-done').waitFor();
    const tp1 = (await snap()).data.transponders.find(t => t.id === 'tp-0001');
    ok('transponder moved to the Kia at class 1 through the page', tp1.vehicle_id === 'v-0004' && tp1.class === 1);
    await shot('transponder', 3, 'Result: tp-0001 is in KLM2210 and charges class 1; the transponders table agrees.', {focus: '#view .cw-table-wrap >> nth=1', records: ['tp-0001', 'v-0004']});

    // Dispute: file (preview, cancel, submit), then withdraw (asks first).
    const fileDispute = async (noticeId, capture) => {
      await show('disputes');
      await page.locator('#view [data-field=notice_id]').selectOption(noticeId);
      await page.locator('#view [data-field=reason]').selectOption('sold_or_not_in_possession');
      await page.locator('#view [data-field=transfer_date]').fill('2026-09-28');
      await page.locator('#view [data-field=evidence]').fill('mail/mail-dani/m-11133');
      if (capture) await shot('dispute', 1, 'Start: n-0017 (HKR4471, Oct 11, 2026) chosen; reason "sold or not in possession", transfer date and the Mail evidence reference entered.', {focus: '#view form', records: [noticeId]});
      await page.getByRole('button', {name: 'Preview dispute'}).click();
      await page.locator('#view .cw-preview').waitFor();
      if (capture) {
        ok('the dispute preview names the evidence as a Mail message, with the date in a US format',
          (await page.locator('#view .cw-preview [data-key=evidence]').innerText()) === 'Mail message m-11133 (mailbox mail-dani)' && / E[SD]T$/.test(await page.locator('#view .cw-preview [data-key=expires]').innerText()));
        await shot('dispute', 2, 'Preview: notice, amount, reason, transfer date Sep 28, 2026, evidence "Mail message m-11133", the rules; Submit or Cancel.', {focus: '#view .cw-preview'});
      }
      await page.getByRole('button', {name: 'Submit dispute'}).click();
      await page.locator('#view .cw-done').waitFor();
    };
    await fileDispute('n-0017', true);
    const d17 = (await tool('disputes.get', {notice_id: 'n-0017'})).dispute;
    ok('a dispute filed through the page is stored with its reason, date and evidence',
      d17.state === 'submitted' && d17.transfer_date === '2026-09-28' && JSON.stringify(d17.evidence) === JSON.stringify([{app_id: 'mail', account_id: 'mail-dani', object_id: 'm-11133'}]));
    await shot('dispute', 3, `Result: dispute ${d17.id} submitted for n-0017, with its receipt; the table lists it as submitted.`, {records: [d17.id, 'n-0017']});
    await fileDispute('n-0018', false);
    const d18 = (await tool('disputes.get', {notice_id: 'n-0018'})).dispute;
    before = hash(await snap());
    await page.locator(`#view tr[data-record-id="${d18.id}"] button[data-action=withdraw]`).click();
    await page.locator('#view .cw-confirm').waitFor();
    ok('withdrawing a dispute asks first; nothing changes yet', hash(await snap()) === before);
    await shot('dispute', 4, `Withdraw: confirmation for ${d18.id} on n-0018, saying the withdrawal is final; Withdraw dispute or Keep the dispute.`, {focus: '#view .cw-confirm', records: [d18.id]});
    await page.locator('#view .cw-confirm button[data-action=cancel]').click();
    ok('Keep the dispute closes the confirmation and writes nothing',
      (await page.locator('#view .cw-confirm').count()) === 0 && hash(await snap()) === before && (await tool('disputes.get', {dispute_id: d18.id})).dispute.state === 'submitted');
    await page.locator(`#view tr[data-record-id="${d18.id}"] button[data-action=withdraw]`).click();
    await page.locator('#view .cw-confirm button[data-action=confirm]').click();
    await page.locator('#view .cw-done', {hasText: 'withdrawn'}).waitFor();
    ok('a dispute withdrawn through the page, after its confirmation', (await tool('disputes.get', {dispute_id: d18.id})).dispute.state === 'withdrawn');
    await shot('dispute', 5, `Result: ${d18.id} withdrawn; n-0018 is issued again with the days that remained.`, {records: [d18.id, 'n-0018']});

    // Batch payment.
    await show('pay');
    await shot('pay', 1, 'Start: every payable notice is preselected; notices in dispute or in collections have a disabled box and the reason.', {records: (await tool('notices.list')).notices.filter(n => n.payable).map(n => n.id)});
    before = hash(await snap());
    await page.$eval('#view input[value="n-0001"]', b => { b.disabled = false; });
    await page.locator('#view input[value="n-0001"]').check();
    await page.getByRole('button', {name: 'Preview payment'}).click();
    await idle();
    ok('a client that submits a notice in collections anyway: the whole preview is refused, the notice named in place; nothing changes',
      (await alert.getAttribute('data-code')) === 'in_collections' && (await alert.innerText()).includes('n-0001') && hash(await snap()) === before);
    await shot('pay', 2, 'Error path in_collections: a client that ignores the disabled box submits n-0001; the App rejects the whole preview and names n-0001; nothing stored.', {focus: '#view form [role=alert]', records: ['n-0001']});
    await refresh();
    for (const box of await page.locator('#view input[data-field=notice_ids]:not([disabled])').all()) {
      if (['n-0014', 'n-0016'].includes(await box.getAttribute('value'))) await box.check(); else await box.uncheck();
    }
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    // Another client changes the account after the page loaded: the page's version is stale.
    await host.client.call('crossway.account.replenish.set', {expected_version: (await infra.call('env.snapshot')).version, request_id: 'outside-change', enabled: true});
    before = hash(await snap());
    await page.getByRole('button', {name: 'Preview payment'}).click();
    await idle();
    ok('a stale page shows stale_version and writes nothing', (await alert.getAttribute('data-code')) === 'stale_version' && hash(await snap()) === before);
    await shot('pay', 3, 'Error path stale_version: another client changed the account after this page loaded; the preview is refused in place and nothing is stored.', {focus: '#view form [role=alert]'});
    await refresh();
    for (const box of await page.locator('#view input[data-field=notice_ids]:not([disabled])').all()) {
      if (['n-0014', 'n-0016'].includes(await box.getAttribute('value'))) await box.check(); else await box.uncheck();
    }
    await page.locator('#view [data-field=card_id]').selectOption('card-dani-visa');
    await page.getByRole('button', {name: 'Preview payment'}).click();
    await page.locator('#view .cw-preview').waitFor();
    const n14 = ns.find(n => n.id === 'n-0014'), n16 = ns.find(n => n.id === 'n-0016');
    ok('the payment preview lists each notice as a sentence, with the total, cardholder and the final-payment text',
      (await page.locator('#view .cw-preview [data-key=total]').innerText()) === money(n14.amount_due_cents + n16.amount_due_cents) &&
      (await page.locator('#view .cw-preview [data-key=holder]').innerText()) === 'Dani Reyes' &&
      (await page.locator('#view .cw-preview [data-key=lines] li[data-record-id="n-0014"]').innerText()).includes(day(n14.toll_date)) &&
      (await page.locator('#view .cw-final').innerText()) === 'Payment is final and closes the right to dispute.');
    await shot('pay', 4, 'Preview: n-0014 and n-0016 with plaza, toll date and amount, the total, cardholder Dani Reyes and "Payment is final and closes the right to dispute."', {focus: '#view .cw-preview', records: ['n-0014', 'n-0016']});
    await page.getByRole('button', {name: 'Confirm payment'}).click();
    await page.locator('#view .cw-done').waitFor();
    const paid = (await snap()).data;
    ok('the payment confirmed through the page paid both notices on Dani\'s Visa',
      ['n-0014', 'n-0016'].every(id => paid.notices.find(n => n.id === id).state === 'paid') && paid.receipts.at(-1).card_id === 'card-dani-visa');
    await shot('pay', 5, `Result: receipt ${paid.receipts.at(-1).id}, ${money(paid.receipts.at(-1).amount_cents)} for n-0014 and n-0016 on Dani's Visa; both left the payable list.`, {records: [paid.receipts.at(-1).id, 'n-0014', 'n-0016']});

    await page.reload();
    await idle();
    ok('reload keeps the page and shows committed state', (await page.locator('#view').getAttribute('data-view')) === 'pay' &&
      (await page.locator('#view input[value="n-0014"]').count()) === 0 && (await page.locator('#view input[value="n-0013"]').isChecked()));
    const mcpPaid = (await tool('notices.get', {notice_id: 'n-0014'})).notice;
    ok('an independent MCP read sees the page\'s payment', mcpPaid.state === 'paid');
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
    ok('browse: a top-up can be previewed but has no confirm control, and the preview can be closed',
      (await page.getByRole('button', {name: 'Confirm top-up'}).count()) === 0 && (await page.locator('#view .cw-preview button[data-action=cancel]').count()) === 1);
    await shot('profiles', 1, 'Profile browse: the top-up preview is allowed, the confirm control is not drawn.', {focus: '#view .cw-preview'});
    await show('vehicles');
    await page.locator('#view tr[data-record-id="v-0002"]').click();
    await page.locator('#view [data-selected-id="v-0002"]').waitFor();
    ok('browse: no end or correction controls; transponder assignment stays',
      (await page.getByRole('button', {name: 'End possession'}).count()) === 0 && (await page.getByRole('button', {name: 'Save corrections'}).count()) === 0 &&
      (await page.locator('#view [data-selected-id="v-0002"]').innerText()).includes('already carries tp-0002'));
    await show('disputes');
    ok('browse: no withdraw control', (await page.locator('#view button[data-action=withdraw]').count()) === 0);
    await infra.call('env.reset', {expected_version: (await infra.call('env.snapshot')).version, profile: 'scenario'});
    await show('pay');
    ok('scenario (reads only): no payment controls', (await page.getByRole('button', {name: 'Preview payment'}).count()) === 0);
    await show('account');
    ok('scenario (reads only): no auto-replenish form', (await page.getByRole('button', {name: 'Save auto-replenish'}).count()) === 0);

    // ---- Narrow viewport ----
    await page.setViewportSize({width: 390, height: 844});
    for (const v of VIEWS) {
      await show(v);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow on ' + v);
    }
    ok('all nine pages fit a 390px viewport without horizontal page scroll', true);
    await show('notices');
    await shot('narrow', 1, 'The notices page at 390px wide: the table scrolls inside its frame, the page does not.');
    await page.setViewportSize(VIEWPORT);

    // ---- Other seeds, and check (e) on the pages ----
    const sentinelPages = {};
    for (const {seed_id: id} of SEEDS) {
      await loadSeed(infra, id, 'full');
      seedId = id;
      const acc = (await tool('account.get')).account;
      await show('account');
      await refresh();
      assert.equal(await page.locator('[data-key=balance] strong').innerText(), money(acc.balance_cents), id);
      assert.equal(await page.locator('[data-key=status] strong').innerText(), acc.status.replace(/_/g, ' '), id);
      assert.equal(await page.locator('[data-key=clock]').getAttribute('data-as-of'), acc.as_of, id);
      if (acc.status === 'suspended') assert.equal(await page.locator('.cw-banner').count(), 1, id);
      if (id !== 'dani') await shot(`seed-${id}`, 1, `Seed ${id} at its clock: account overview (status ${acc.status.replace(/_/g, ' ')}, balance ${money(acc.balance_cents)}).`);
      const list = (await tool('notices.list')).notices;
      await show('notices');
      for (const n of list) assert.equal(await cell(n.id, 'state'), n.state, `${id} ${n.id}`);
      if (id === 'priya') await shot('seed-priya', 2, `Seed priya (clock Dec 31, 2026): ${list.length} notices, the latest from ${day(list.map(n => n.toll_date).sort().at(-1))}, in ${new Set(list.map(n => n.state)).size} states.`);
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
    ok(`all ${SEEDS.length} seeds render with their balance, status, clock and notices`, true);
    ok('(e) on the pages: no pending sentinel on any of the nine pages before its event; fired tolls appear; decision tables never do', true);
    ok('no JavaScript errors', errors.length === 0);
    const environment = {
      app_commit: git('rev-parse', 'HEAD'), app_tree_clean: git('status', '--porcelain', '--', 'apps/crossway', ':!apps/crossway/evidence') === '',
      host: 'runtime/web/server.cjs', host_revision: git('rev-parse', 'HEAD:runtime/web/server.cjs'), runtime_version: require(path.join(root, 'runtime/package.json')).version,
      controller_sha256: crypto.createHash('sha256').update(controller).digest('hex'),
      browser: `Chromium ${browser.version()} (Playwright ${require(path.join(root, 'node_modules/playwright/package.json')).version}, headless)`,
      node: process.version, viewport: VIEWPORT, run_id: host.run, seed: 'dani (fixtures/minimal.json) at 2026-11-02T09:00:00-05:00, then marisol, theo and priya at their clocks',
    };
    const report = {app: 'crossway', checked_at: new Date().toISOString(), ...environment, passed: results, sentinel_pages: sentinelPages, screenshots: path.relative(root, out), sequence_shots: shots.length};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (EVIDENCE) {
      const manifest = {captured_at: report.checked_at, by: 'node apps/crossway/tests/web-checks.cjs --evidence', ...environment, checks_passed: results.length, shots};
      fs.writeFileSync(path.join(evidenceDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    // Keep what the page showed when a check failed.
    await page?.screenshot({path: path.join(out, 'failure.png'), fullPage: true}).catch(() => {});
    throw e;
  } finally {
    await context?.close();
    await browser.close();
    await infra?.close();
    await host?.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
