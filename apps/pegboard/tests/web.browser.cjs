#!/usr/bin/env node
'use strict';
// Browser checks of the Pegboard web pages on the public business Web Host: real controls in
// a real browser, with the same run inspected through MCP after every write.
//
//   node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--evidence DIR] [--chrome PATH]
//
// --evidence DIR writes the ordered review evidence of evidence/README.md: a JPEG of the window
// at each step of each workflow and sequences.json with the action, the expected and the
// observed result and the App state read back through MCP at that moment.
// DIR is the `runtime` directory of a public PALE checkout (1.6.0 or later, with runtime/web);
// PALE_RUNTIME_ROOT=DIR works too. Playwright is the checkout's own pinned dev dependency
// (`npm ci` at the checkout root, then `npx playwright install chromium`); --chrome uses an
// installed Chrome instead of Playwright's Chromium. The package is copied into a temporary
// registry; nothing in the checkout or this folder is written except the report and screenshots.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');

function options() {
  const out = { runtime: process.env.PALE_RUNTIME_ROOT };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--runtime', '--report', '--screenshots', '--evidence', '--chrome'].includes(key) || !value) return null;
    out[key.slice(2)] = value;
  }
  return out.runtime ? out : null;
}
const opts = options(), root = opts && path.resolve(opts.runtime);
if (!opts || !fs.existsSync(path.join(root, 'web', 'server.cjs'))) {
  console.error('Usage: node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--evidence DIR] [--chrome PATH]');
  process.exit(2);
}
let playwright;
try { playwright = require(require.resolve('playwright', { paths: [process.cwd(), path.dirname(root)] })); }
catch { console.error('Playwright is not installed: run `npm ci` at the checkout root (it pins playwright), then `npx playwright install chromium`.'); process.exit(2); }
const { prepare } = require(path.join(root, 'prepare.cjs')), { Client } = require(path.join(root, 'client.cjs'));
const { start } = require(path.join(root, 'web', 'server.cjs')), { digestTree } = require(path.join(root, 'verify.cjs'));

const ZONE = 'America/Los_Angeles', KAI = 'person-kai', INES = 'person-ines';
const at = (date, hhmm) => date + 'T' + hhmm + ':00-08:00';
const WIDE = { start: '2000-01-01T00:00:00Z', end: '2100-01-01T00:00:00Z' };
const week = (monday, days = 7) => { const end = new Date(monday + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + days); return { start: at(monday, '00:00'), end: at(end.toISOString().slice(0, 10), '00:00') }; };
// Core's package digest (verify.cjs digestTree) of the package without one top-level folder:
// the evidence folder holds the screenshots this test takes, so they cannot be part of what they show.
function digestWithout(dir, skip) {
  const hash = require('node:crypto').createHash('sha256');
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (d === dir && e.name === skip) continue; if (e.isDirectory()) walk(f); else { hash.update(path.relative(dir, f).split(path.sep).join('/')); hash.update('\0'); hash.update(fs.readFileSync(f)); } } };
  walk(dir);
  return hash.digest('hex');
}
const SEQUENCES = {
  'cover-refused': 'Asking for cover: refused by the rules', 'cover-expired': 'Asking for cover: pending, then expired at its cut-off',
  'stale-form': 'A form that went stale', 'release-denied': 'Release: a lost response, a retry, then denied by the manager',
  'trade-approved': 'Trade: accepted by the coworker, approved by the manager', 'pickup-refused': 'Picking up an open shift: refused by the rules',
  'incoming-declined': 'A coworker\'s request: accepting refused, then declined', 'request-cancelled': 'Cancelling my own request',
  'time-off': 'Time off: refused, requested, cancelled', 'availability': 'Availability: refused, saved, flagged on a shift',
  'settings': 'Settings: saved, refused', 'manager-change': 'A manager\'s change voids a pending release',
  'restricted-policy': 'A Task-like policy', 'full-window': 'The full-window dataset in the web pages',
};
const nextMonday = monday => { const d = new Date(monday + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); };

async function main() {
  const prepared = prepare(appDir), stateDir = path.join(prepared.root, 'state'), started = Date.now();
  const shots = opts.screenshots ? path.resolve(opts.screenshots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const checks = [], screenshots = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  let browser, host, restricted, infra, restrictedInfra, full, fullInfra;
  const sequences = [], evidence = opts.evidence ? path.resolve(opts.evidence) : null;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const pages = []; // for a screenshot of each open page when a check fails
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(opts.chrome ? { executablePath: opts.chrome } : {}) });
    host = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'browser', profile: 'sandbox' });
    infra = new Client(prepared.app, 'infra', host.run, stateDir, 'pegboard-web-inspector', { registry: prepared.registry });
    await infra.initialize();
    const agent = host.client;
    const snap = async () => infra.call('env.snapshot');
    const data = async () => (await snap()).snapshot.data;
    const mcp = async (name, args = {}) => { const r = await agent.call('pegboard.' + name, args); assert.ok(['ok', 'committed'].includes(r.status), name + ': ' + r.status); return r; };

    // The browser runs in another zone than the workplace: times must come out in the workplace's zone.
    const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), page = await context.newPage();
    page.setDefaultTimeout(10000); pages.push(page);
    const errors = [], calls = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/call')) calls.push(r.postDataJSON()); });
    const ready = () => page.locator('#app[aria-busy=false]').waitFor();
    const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click(); await ready(); };
    const shiftPage = id => page.locator('.detail article[data-shift-id="' + id + '"][data-loaded="true"]');
    const listIds = () => page.locator('#records [data-record-id]').evaluateAll(nodes => nodes.map(n => n.dataset.recordId));
    const shownWeek = () => page.locator('[data-week]').first().getAttribute('data-week');
    const gotoWeek = async monday => { for (let i = 0; i < 8 && await shownWeek() !== monday; i++) { await page.getByRole('button', { name: (await shownWeek()) < monday ? 'Next week' : 'Previous week' }).click(); await ready(); } assert.equal(await shownWeek(), monday); };
    const openShift = async id => { await page.locator('#records [data-record-id="' + id + '"]').click(); await shiftPage(id).waitFor(); };
    const dialog = page.locator('dialog.pb-dialog');
    const submit = async () => { await dialog.locator('button[type=submit]').click(); await dialog.waitFor({ state: 'detached' }); await ready(); };
    const refused = async code => { await dialog.locator('[role=alert][data-code="' + code + '"]').waitFor(); const text = await dialog.locator('[role=alert]').innerText(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); return text; };
    const lastCall = name => calls.filter(c => c.name === name).at(-1);
    const args = call => { const { expected_version, request_id, ...rest } = call.arguments; assert.ok(expected_version && request_id, 'a write carries a version and a request ID'); return rest; };
    const shot = async name => { if (!shots) return; const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(path.basename(file)); };
    // Ordered evidence (--evidence DIR): a JPEG of the window at each step, with the action, the
    // expected and the observed result and the App state read back through MCP at that moment.
    const step = async (target, sequence, caption, note) => {
      if (!evidence) return;
      const n = sequences.filter(x => x.sequence === sequence).length + 1, file = sequence + '-' + String(n).padStart(2, '0') + '.jpg';
      await target.screenshot({ path: path.join(evidence, file), type: 'jpeg', quality: 70 });
      sequences.push({ sequence, title: SEQUENCES[sequence], step: n, caption, file, ...note });
    };
    const said = async locator => (await locator.innerText()).replace(/\s+/g, ' ').trim().slice(0, 300);
    // The top of a page: its heading, its state chips and any banner, as the reader sees them.
    const head = async article => (await article.evaluate(a => [...a.querySelectorAll(':scope > header, :scope > .pb-chips, :scope > .pb-banner')].map(n => n.innerText).join(' · '))).replace(/\s+/g, ' ').trim();
    const fullText = async locator => (await locator.innerText()).replace(/\s+/g, ' ');
    const version = async () => { const v = (await snap()).version; return 'epoch ' + v.epoch + ', revision ' + v.revision; };
    const alertOf = async code => { const a = dialog.locator('[role=alert][data-code="' + code + '"]'); await a.waitFor(); return said(a); };
    const clockText = iso => page.evaluate(([value, zone]) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(value)), [iso, ZONE]);
    const refresh = async () => { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready(); };
    const handoffPage = id => page.locator('.detail article[data-handoff-id="' + id + '"][data-loaded="true"]');

    // ---- the pages and what the Host offers them ------------------------------------------------------------
    await page.goto(host.accessUrl);
    await page.locator('#records .record').first().waitFor(); await ready();
    check('the Host serves the App-owned pages', await page.title() === 'Pegboard · PALE' && await page.locator('nav').getByRole('button', { name: /Schedule/ }).count() === 1);
    const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8'), tools = JSON.parse(fs.readFileSync(path.join(appDir, 'tools.json'), 'utf8'));
    check('the controller names every declared business tool', tools.every(t => controller.includes("'" + t.name + "'")));
    const discovered = await page.evaluate(async () => (await (await fetch('/api/tools')).json()).tools.map(t => t.name));
    check('business discovery offers no management tool', discovered.length === tools.length && discovered.every(n => !n.startsWith('env.')));

    // ---- W1 schedule and hours --------------------------------------------------------------------------------
    const mine = (await mcp('shifts.list', { ...WIDE, mine: true, limit: 200 })).shifts, next = mine.find(s => s.phase !== 'ended');
    equal('the schedule opens on the week of my next shift that has not ended, by the App\'s clock', await shownWeek(), next.week_start);
    await shiftPage(next.id).waitFor();
    checks.push('that shift is the one selected');
    const sortByStart = list => [...list].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map(s => s.id);
    equal('the week\'s list is the App\'s list of the whole team, in time order', await listIds(), sortByStart((await mcp('shifts.list', { ...week(next.week_start), limit: 200 })).shifts));
    const first = (await mcp('shifts.list', { ...week(next.week_start), limit: 200 })).shifts[0];
    check('shift times are shown in the workplace\'s zone, not the browser\'s', (await page.locator('#records [data-record-id="' + first.id + '"]').innerText()).startsWith(await clockText(first.start)));
    const hours = (await mcp('hours.summary', week(next.week_start))).weeks[0];
    check('my hours for the week are the App\'s', (await page.locator('[aria-label="My hours this week"]').innerText()).includes(hours.scheduled_hours + ' of ' + hours.cap + ' hours'));
    await shot('schedule');
    const W2 = nextMonday(next.week_start);
    await gotoWeek(W2);
    equal('the next week is the App\'s next week', await listIds(), sortByStart((await mcp('shifts.list', { ...week(W2), limit: 200 })).shifts));
    await page.locator('select[aria-label="Shifts shown"]').selectOption('open'); await ready();
    equal('open shifts are the App\'s open shifts', await listIds(), sortByStart((await mcp('shifts.list', { ...week(W2), open: true, limit: 200 })).shifts));
    await page.locator('select[aria-label="Shifts shown"]').selectOption('mine'); await ready();
    equal('my shifts are the App\'s list of mine', await listIds(), sortByStart((await mcp('shifts.list', { ...week(W2), mine: true, limit: 200 })).shifts));
    await page.locator('select[aria-label="Shifts shown"]').selectOption('team'); await ready();

    // A coworker's shift: what blocks me from taking it.
    const theirs = (await mcp('shifts.list', { ...week(W2), limit: 200 })).shifts.find(s => !s.is_mine && s.state === 'assigned');
    await openShift(theirs.id);
    const could = shiftPage(theirs.id).locator('section[aria-label="Could you take it"][data-loaded="true"]');
    await could.waitFor();
    const elig = await mcp('eligibility.check', { id: theirs.id });
    check('the eligibility shown for a coworker\'s shift is the App\'s check', (await could.locator('[data-eligible]').getAttribute('data-eligible')) === String(elig.eligible) && (await could.innerText()).includes(elig.hours.before + ' → ' + elig.hours.after + ' of ' + elig.hours.cap + ' hours'));

    // ---- W3 handoffs ------------------------------------------------------------------------------------------
    const COVERED = 'sh-1126-02', RELEASED = 'sh-1127-05', STALE = 'sh-1123-01', TRADED = 'sh-1201-03', THEIRS = 'sh-1130-03', OPEN = 'sh-1125-02';
    await gotoWeek('2026-11-23');
    await openShift(COVERED);
    await step(page, 'cover-refused', 'Noor\'s Thursday shift, before anything is asked', { action: 'Schedule, week of 23 November: open sh-1126-02.', expected: 'The shift is Noor\'s, with no handoff pending.', observed: await head(shiftPage(COVERED)), state: { 'shifts.get': (await mcp('shifts.get', { id: COVERED })).shift.assignee + ', pending handoff ' + (await mcp('shifts.get', { id: COVERED })).shift.pending_handoff_id, version: await version() } });
    await shiftPage(COVERED).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await dialog.locator('[data-field=to_person_id]').selectOption(INES);
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    const ines = await mcp('eligibility.check', { id: COVERED, person_id: INES });
    await step(page, 'cover-refused', 'The form shows the App\'s check for Ines', { action: 'Ask for cover, then choose Ines Okafor.', expected: 'The check says she cannot take it: ' + ines.blocks.join(', ') + '.', observed: await said(dialog.locator('[aria-label=Eligibility]')), state: { 'eligibility.check': 'eligible ' + ines.eligible + ', blocks ' + ines.blocks.join(', ') } });
    await dialog.locator('button[type=submit]').click();
    await step(page, 'cover-refused', 'Sending it anyway is refused, and nothing is written', { action: 'Send the request.', expected: 'pegboard.handoffs.cover answers not_qualified; no handoff is created.', observed: await alertOf('not_qualified'), state: { 'handoffs.list': 'pending for sh-1126-02: ' + (await mcp('handoffs.list', { id: COVERED })).handoffs.length, version: await version() }, check: 'a cover the rules refuse is refused visibly and writes nothing' });
    await refused('not_qualified');
    check('a cover the rules refuse is refused visibly and writes nothing', !(await data()).handoffs.some(h => h.shift_id === COVERED && h.state === 'awaiting_coworker'));
    await shiftPage(COVERED).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await dialog.locator('[data-field=to_person_id]').selectOption(KAI);
    const kaiCheck = dialog.locator('[aria-label=Eligibility][data-loaded="true"]');
    await kaiCheck.waitFor();
    const kai = await mcp('eligibility.check', { id: COVERED, person_id: KAI });
    check('the cover form shows the App\'s check for the chosen coworker', (await kaiCheck.locator('[data-eligible]').getAttribute('data-eligible')) === String(kai.eligible) && kai.eligible);
    await dialog.locator('[data-field=message]').fill('Could you take my Thursday?');
    await step(page, 'cover-expired', 'The form shows Kai can take it', { action: 'Ask for cover again, choose Kai Moreno and write a message.', expected: 'The App\'s check says Kai is eligible (' + kai.hours.before + ' → ' + kai.hours.after + ' of ' + kai.hours.cap + ' hours).', observed: await said(kaiCheck), state: { 'eligibility.check': 'eligible ' + kai.eligible } });
    await submit();
    equal('asking for cover sends the shift, the coworker and the message', args(lastCall('pegboard.handoffs.cover')), { id: COVERED, to_person_id: KAI, message: 'Could you take my Thursday?' });
    const cover = (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.find(h => h.shift.id === COVERED && h.state === 'awaiting_coworker');
    const coveredShift = (await mcp('shifts.get', { id: COVERED })).shift;
    check('the cover is the App\'s record and the shift stays mine until it is approved', cover && cover.counterpart_id === KAI && coveredShift.assignee === 'person-noor' && coveredShift.pending_handoff_id === cover.id);
    await step(page, 'cover-expired', 'Sent: it waits for Kai and the shift stays Noor\'s', { action: 'Send the request.', expected: 'A handoff waits for Kai until its cut-off; the shift keeps its assignee and shows the pending handoff.', observed: await head(shiftPage(COVERED)), state: { 'handoffs.get': cover.id + ' ' + cover.state + ', cut-off ' + cover.cutoff_at, 'shifts.get': coveredShift.assignee + ', pending ' + coveredShift.pending_handoff_id, receipt: 'request ' + lastCall('pegboard.handoffs.cover').arguments.request_id, version: await version() }, check: 'the cover is the App\'s record and the shift stays mine until it is approved' });

    await openShift(STALE);
    await shiftPage(STALE).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await dialog.locator('[data-field=to_person_id]').selectOption('person-ada');
    await step(page, 'stale-form', 'A cover form open for Monday\'s shift', { action: 'Open sh-1123-01, Ask for cover, choose Ada Brennan; do not send yet.', expected: 'The form was read at the current version.', observed: await said(dialog.locator('h2').first()), state: { version: await version() } });
    await mcp('handoffs.release', { id: STALE, expected_version: (await snap()).version, request_id: 'outside-release' });
    await dialog.locator('button[type=submit]').click();
    const staleText = await alertOf('stale_version');
    await step(page, 'stale-form', 'Another client released the shift first: the form says so', { action: 'Meanwhile the same run releases sh-1123-01 through MCP (pegboard.handoffs.release); then send the form.', expected: 'The write is refused as stale_version; the release made elsewhere stands.', observed: staleText, state: { 'handoffs.list': 'sh-1123-01: ' + (await mcp('handoffs.list', { id: STALE })).handoffs.map(h => h.kind + ' ' + h.state).join(', '), version: await version() }, check: 'a stale form shows the conflict and the concurrent change stands' });
    await refused('stale_version');
    const staleHandoffs = (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.filter(h => h.shift.id === STALE && h.state !== 'declined' && h.state !== 'cancelled' && h.state !== 'void' && h.state !== 'expired');
    equal('a stale form shows the conflict and the concurrent change stands', staleHandoffs.map(h => h.kind), ['release']);

    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === 'pegboard.handoffs.release' && body.arguments.id === RELEASED) { dropped = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await refresh(); await openShift(RELEASED);
    await shiftPage(RELEASED).getByRole('button', { name: 'Release to open shifts', exact: true }).click();
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('[role=alert][data-code=request_failed]').waitFor();
    await step(page, 'release-denied', 'The response to "Release" is lost: the form says so and keeps its input', { action: 'Open Friday\'s shift sh-1127-05, Release to open shifts, send. The test drops the response after the App has committed it.', expected: 'The form reports the failure and offers to send again with the same request ID.', observed: await said(dialog.locator('[role=alert]')), state: { 'handoffs.list': 'releases of sh-1127-05: ' + (await mcp('handoffs.list', { id: RELEASED })).handoffs.length } });
    await submit();
    await page.unroute('**/api/call');
    equal('a retry after a lost response has one effect', (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.filter(h => h.shift.id === RELEASED && h.kind === 'release').length, 1);
    const release = (await mcp('handoffs.list', { id: RELEASED })).handoffs[0];
    await step(page, 'release-denied', 'Sent again: one release, waiting for the manager', { action: 'Send again.', expected: 'The retry is the same write: one release, waiting for the manager; the shift is still Noor\'s.', observed: await head(shiftPage(RELEASED)), state: { 'handoffs.get': release.id + ' ' + release.state, 'shifts.get': (await mcp('shifts.get', { id: RELEASED })).shift.assignee, version: await version() }, check: 'a retry after a lost response has one effect' });

    await gotoWeek('2026-11-30');
    await openShift(TRADED);
    await shiftPage(TRADED).getByRole('button', { name: 'Offer a trade', exact: true }).click();
    await dialog.locator('[data-field=their_shift_id]').selectOption(THEIRS);
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    const both = await mcp('eligibility.check', { id: THEIRS, give_shift_id: TRADED });
    await step(page, 'trade-approved', 'The trade form checks both sides', { action: 'Week of 30 November: open Noor\'s sh-1201-03, Offer a trade, choose Kai\'s sh-1130-03.', expected: 'Noor may take Kai\'s shift and Kai may take hers: both checks pass.', observed: await said(dialog.locator('[aria-label=Eligibility]')), state: { 'eligibility.check': 'Noor ' + both.eligible + ', Kai ' + both.other.eligible } });
    await submit();
    equal('offering a trade sends my shift and the one I want', args(lastCall('pegboard.handoffs.trade')), { id: TRADED, their_shift_id: THEIRS });
    const trade = (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.find(h => h.kind === 'trade' && h.shift.id === TRADED && h.state === 'awaiting_coworker');
    check('the trade is the App\'s record and nothing has changed hands', trade && trade.other_shift.id === THEIRS && (await mcp('shifts.get', { id: TRADED })).shift.assignee === 'person-noor');
    await step(page, 'trade-approved', 'Sent: it waits for Kai; nothing has changed hands', { action: 'Send the offer.', expected: 'One trade waits for Kai; both shifts keep their assignees.', observed: await head(shiftPage(TRADED)), state: { 'handoffs.get': trade.id + ' ' + trade.state, 'shifts.get': 'sh-1201-03 ' + (await mcp('shifts.get', { id: TRADED })).shift.assignee + ', sh-1130-03 ' + (await mcp('shifts.get', { id: THEIRS })).shift.assignee, receipt: 'request ' + lastCall('pegboard.handoffs.trade').arguments.request_id, version: await version() } });

    await gotoWeek('2026-11-23');
    await openShift(OPEN);
    await shiftPage(OPEN).getByRole('button', { name: 'Pick up this shift', exact: true }).click();
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    const pick = await mcp('eligibility.check', { id: OPEN });
    await step(page, 'pickup-refused', 'The pick-up form shows Noor\'s hours for that week', { action: 'Week of 23 November: open the open shift sh-1125-02, Pick up this shift.', expected: 'The App\'s check: ' + pick.blocks.join(', ') + ' (' + pick.hours.before + ' → ' + pick.hours.after + ' of ' + pick.hours.cap + ' hours).', observed: await said(dialog.locator('[aria-label=Eligibility]')), state: { 'eligibility.check': 'eligible ' + pick.eligible + ', blocks ' + pick.blocks.join(', ') } });
    await dialog.locator('button[type=submit]').click();
    await step(page, 'pickup-refused', 'Sending it anyway is refused, and nothing is written', { action: 'Send the request.', expected: 'pegboard.handoffs.pickup answers ' + pick.blocks[0] + '; no pick-up is created.', observed: await alertOf(pick.blocks[0]), state: { 'handoffs.list': 'pick-ups of sh-1125-02: ' + (await mcp('handoffs.list', { id: OPEN })).handoffs.length, version: await version() }, check: 'a pick-up the rules refuse is refused visibly and writes nothing' });
    await refused(pick.blocks[0]);
    check('a pick-up the rules refuse is refused visibly and writes nothing', !(await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.some(h => h.kind === 'pickup' && h.shift.id === OPEN));

    await nav('Handoffs');
    const incoming = (await mcp('handoffs.list', { state: 'awaiting_me', limit: 100 })).handoffs[0];
    await page.locator('#records [data-handoff-id="' + incoming.id + '"]').click();
    await handoffPage(incoming.id).waitFor();
    await step(page, 'incoming-declined', 'Ada asks Noor to cover her Sunday shift', { action: 'Handoffs: open the request that waits for Noor.', expected: 'The request, the shift, Ada\'s message and the cut-off, waiting for Noor.', observed: await head(handoffPage(incoming.id)), state: { 'handoffs.get': incoming.id + ' ' + incoming.state + ', cut-off ' + incoming.cutoff_at } });
    await handoffPage(incoming.id).getByRole('button', { name: 'Accept', exact: true }).click();
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    const mineCheck = await mcp('eligibility.check', { id: incoming.shift.id });
    await dialog.locator('button[type=submit]').click();
    await step(page, 'incoming-declined', 'Accepting is refused by the rules', { action: 'Accept, then send.', expected: 'pegboard.handoffs.respond answers ' + mineCheck.blocks[0] + '; the request still waits for Noor.', observed: await alertOf(mineCheck.blocks[0]), state: { 'handoffs.get': incoming.id + ' ' + (await mcp('handoffs.get', { id: incoming.id })).handoff.state } });
    await refused(mineCheck.blocks[0]);
    check('accepting a request the rules refuse is refused visibly and the request still waits for me', (await mcp('handoffs.get', { id: incoming.id })).handoff.state === 'awaiting_me');
    await handoffPage(incoming.id).getByRole('button', { name: 'Decline', exact: true }).click();
    await dialog.locator('[data-field=message]').fill('Sorry, I am at my cap that week.');
    await submit();
    equal('declining sends the answer and the message', args(lastCall('pegboard.handoffs.respond')), { id: incoming.id, answer: 'decline', message: 'Sorry, I am at my cap that week.' });
    check('the request is declined in the App', (await mcp('handoffs.get', { id: incoming.id })).handoff.state === 'declined');
    await handoffPage(incoming.id).waitFor();
    await step(page, 'incoming-declined', 'Declined with a message', { action: 'Decline, write "Sorry, I am at my cap that week." and send.', expected: 'The request is declined, with Noor\'s message in its history; Ada\'s shift stays hers.', observed: await head(handoffPage(incoming.id)), state: { 'handoffs.get': incoming.id + ' ' + (await mcp('handoffs.get', { id: incoming.id })).handoff.state, 'shifts.get': incoming.shift.id + ' ' + (await mcp('shifts.get', { id: incoming.shift.id })).shift.assignee, version: await version() }, check: 'the request is declined in the App' });
    const asked = (await mcp('handoffs.list', { state: 'awaiting_coworker', limit: 100 })).handoffs.find(h => h.asked_by_me && h.id !== cover.id && h.id !== trade.id);
    await page.locator('#records [data-handoff-id="' + asked.id + '"]').click();
    await handoffPage(asked.id).waitFor();
    await step(page, 'request-cancelled', 'Noor\'s own request, still waiting for Tomas', { action: 'Handoffs: open Noor\'s pending cover request to Tomas.', expected: 'The request waits for the coworker and can be cancelled.', observed: await head(handoffPage(asked.id)), state: { 'handoffs.get': asked.id + ' ' + asked.state } });
    await handoffPage(asked.id).getByRole('button', { name: 'Cancel request', exact: true }).click();
    await submit();
    check('cancelling my request closes it in the App', (await mcp('handoffs.get', { id: asked.id })).handoff.state === 'cancelled');
    await handoffPage(asked.id).waitFor();
    await step(page, 'request-cancelled', 'Cancelled: closed, and the shift is still Noor\'s', { action: 'Cancel request, then confirm.', expected: 'The request is cancelled; nothing changed hands.', observed: await head(handoffPage(asked.id)), state: { 'handoffs.get': asked.id + ' cancelled', 'shifts.get': asked.shift.id + ' ' + (await mcp('shifts.get', { id: asked.shift.id })).shift.assignee, version: await version() }, check: 'cancelling my request closes it in the App' });
    equal('handoffs are listed as the App lists them, grouped by who they wait for', (await page.locator('#records [data-handoff-id]').evaluateAll(n => n.map(x => x.dataset.handoffId))).sort(), (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.map(h => h.id).sort());
    // The coworker and the manager answer through Infra events; the page shows them after Refresh.
    const applyNow = async event => { const r = await infra.call('env.apply_event', { expected_version: (await snap()).version, event }); assert.equal(r.status, 'committed', JSON.stringify(r)); return r; };
    const openHandoff = async id => { await page.locator('#records [data-handoff-id="' + id + '"]').click(); await handoffPage(id).waitFor(); };
    await applyNow({ event_id: 'web-answer', at: at('2026-11-21', '18:10'), operation: 'pegboard.handoff.answered', payload: { handoff_id: trade.id, answer: 'accept', message: 'Deal.' } });
    await refresh(); await openHandoff(trade.id);
    check('after Refresh the trade Kai accepted waits for the manager', (await mcp('handoffs.get', { id: trade.id })).handoff.state === 'awaiting_manager' && (await head(handoffPage(trade.id))).includes('Waiting for the manager'));
    await step(page, 'trade-approved', 'Kai accepts: it now waits for the manager', { action: 'Infra applies pegboard.handoff.answered (accept) from Kai; Refresh.', expected: 'The trade waits for the manager; still nothing has changed hands.', observed: await head(handoffPage(trade.id)), state: { 'handoffs.get': trade.id + ' awaiting_manager', 'shifts.get': 'sh-1201-03 ' + (await mcp('shifts.get', { id: TRADED })).shift.assignee, version: await version() }, check: 'after Refresh the trade Kai accepted waits for the manager' });
    await applyNow({ event_id: 'web-approve', at: at('2026-11-21', '18:20'), operation: 'pegboard.handoff.decided', payload: { handoff_id: trade.id, decision: 'approve', decided_by: 'person-rosa' } });
    await refresh(); await openHandoff(trade.id);
    const swapped = [(await mcp('shifts.get', { id: TRADED })).shift, (await mcp('shifts.get', { id: THEIRS })).shift];
    check('after Refresh the approved trade has moved both shifts, each with a history row naming it', (await mcp('handoffs.get', { id: trade.id })).handoff.state === 'approved' && swapped[0].assignee === KAI && swapped[1].assignee === 'person-noor' && swapped.every(s => s.history.at(-1).handoff_id === trade.id));
    const approvedNote = (await mcp('notifications.list', { limit: 5 })).notifications.find(n => n.object.id === trade.id);
    await step(page, 'trade-approved', 'Rosa approves: both shifts change hands', { action: 'Infra applies pegboard.handoff.decided (approve) from Rosa; Refresh.', expected: 'The trade is approved: sh-1201-03 is Kai\'s, sh-1130-03 is Noor\'s, each with a history row naming the trade; Noor gets a notification.', observed: await head(handoffPage(trade.id)), state: { 'handoffs.get': trade.id + ' approved', 'shifts.get': 'sh-1201-03 ' + swapped[0].assignee + ', sh-1130-03 ' + swapped[1].assignee, 'notifications.list': approvedNote.id + ' "' + approvedNote.title + '"', version: await version() }, check: 'after Refresh the approved trade has moved both shifts, each with a history row naming it' });
    await page.reload(); await page.locator('#records .record').first().waitFor(); await ready();
    await nav('Schedule'); await gotoWeek('2026-11-30'); await openShift(THEIRS);
    check('after a reload, Kai\'s Monday shift is shown as Noor\'s, with the trade in its history', (await head(shiftPage(THEIRS))).includes('Yours') && (await fullText(shiftPage(THEIRS))).includes(trade.id));
    await step(page, 'trade-approved', 'After a reload: Kai\'s Monday shift is Noor\'s, with the move in its history', { action: 'Reload the page; Schedule, week of 30 November; open sh-1130-03.', expected: 'The shift is Noor\'s; its history ends with the move by the approved trade.', observed: await head(shiftPage(THEIRS)), state: { 'shifts.get': 'sh-1130-03 ' + swapped[1].assignee + ', last history row: handoff ' + swapped[1].history.at(-1).handoff_id }, check: 'after a reload, Kai\'s Monday shift is shown as Noor\'s, with the trade in its history' });
    await nav('Handoffs');
    await applyNow({ event_id: 'web-deny', at: at('2026-11-21', '18:30'), operation: 'pegboard.handoff.decided', payload: { handoff_id: release.id, decision: 'deny', decided_by: 'person-rosa', note: 'I need you on Friday evening.' } });
    await refresh(); await openHandoff(release.id);
    const deniedShift = (await mcp('shifts.get', { id: RELEASED })).shift, deniedNote = (await mcp('notifications.list', { limit: 5 })).notifications.find(n => n.object.id === release.id);
    check('after Refresh the denied release shows the manager\'s note and the shift is still mine', (await mcp('handoffs.get', { id: release.id })).handoff.state === 'denied' && deniedShift.assignee === 'person-noor' && (await fullText(handoffPage(release.id))).includes('I need you on Friday evening.'));
    await step(page, 'release-denied', 'Rosa denies it: nothing changes hands', { action: 'Infra applies pegboard.handoff.decided (deny, with a note) from Rosa; Refresh.', expected: 'The release is denied with Rosa\'s note; sh-1127-05 is still Noor\'s; Noor gets a notification.', observed: await head(handoffPage(release.id)), state: { 'handoffs.get': release.id + ' denied', 'shifts.get': 'sh-1127-05 ' + deniedShift.assignee, 'notifications.list': deniedNote.id + ' "' + deniedNote.title + '"', version: await version() }, check: 'after Refresh the denied release shows the manager\'s note and the shift is still mine' });
    await shot('handoffs');

    // ---- W2 time off, availability and settings -------------------------------------------------------------------
    await nav('Time off');
    await page.getByRole('button', { name: 'Request time off', exact: true }).click();
    await dialog.locator('[data-field=start]').fill('2026-11-30'); await dialog.locator('[data-field=end]').fill('2026-11-30');
    await dialog.locator('button[type=submit]').click();
    await step(page, 'time-off', 'Nine days ahead is too late: the form says so', { action: 'Time off: Request time off for Monday 30 November and send.', expected: 'pegboard.time_off.request answers too_late (the policy asks 14 days); nothing is written.', observed: await alertOf('too_late'), state: { 'time_off.list': (await mcp('time_off.list', { include_closed: true })).time_off.length + ' entries' } });
    await refused('too_late');
    const before = (await data()).time_off.length;
    check('time off with too little notice is refused visibly and nothing is written', before === (await mcp('time_off.list', { include_closed: true })).time_off.length);
    await page.getByRole('button', { name: 'Request time off', exact: true }).click();
    await dialog.locator('[data-field=start]').fill('2026-12-28'); await dialog.locator('[data-field=end]').fill('2026-12-29');
    await dialog.locator('[data-field=reason]').fill('Family visit');
    await submit();
    equal('requesting time off sends the two days and the reason', args(lastCall('pegboard.time_off.request')), { start: '2026-12-28', end: '2026-12-29', reason: 'Family visit' });
    const off = (await mcp('time_off.list', { include_closed: true })).time_off.find(t => t.start_date === '2026-12-28');
    check('the time off is the App\'s pending entry', off && off.state === 'pending' && off.days === 2);
    await page.locator('#records [data-time-off-id="' + off.id + '"]').click();
    const offPage = page.locator('.detail article[data-time-off-id="' + off.id + '"]');
    await offPage.waitFor();
    await step(page, 'time-off', 'Requested: two days, pending the manager', { action: 'Request 28 and 29 December with the reason "Family visit".', expected: 'A pending entry for the two days, waiting for the manager.', observed: await head(offPage), state: { 'time_off.list': off.id + ' ' + off.state + ', ' + off.days + ' days', receipt: 'request ' + lastCall('pegboard.time_off.request').arguments.request_id, version: await version() }, check: 'the time off is the App\'s pending entry' });
    await page.locator('.detail article[data-time-off-id="' + off.id + '"]').getByRole('button', { name: 'Cancel time off', exact: true }).click();
    await submit();
    check('cancelling the time off is recorded in the App', (await mcp('time_off.list', { include_closed: true })).time_off.find(t => t.id === off.id).state === 'cancelled');
    await offPage.waitFor();
    await step(page, 'time-off', 'Cancelled', { action: 'Cancel time off, then confirm.', expected: 'The entry is cancelled and kept in the list of closed entries.', observed: await head(offPage), state: { 'time_off.list': off.id + ' cancelled', version: await version() }, check: 'cancelling the time off is recorded in the App' });

    await nav('Availability');
    const form = page.locator('.detail article[data-availability][data-loaded="true"]');
    await form.waitFor();
    const blocksBefore = (await mcp('availability.get')).blocks;
    await form.getByRole('button', { name: 'Add a time', exact: true }).click();
    const added = form.locator('[data-block]').last();
    await added.locator('[data-field=weekday]').selectOption('thu'); await added.locator('[data-field=start]').fill('08:00'); await added.locator('[data-field=end]').fill('14:00');
    await form.getByRole('button', { name: 'Add a time', exact: true }).click();
    const clash = form.locator('[data-block]').last();
    await clash.locator('[data-field=weekday]').selectOption('thu'); await clash.locator('[data-field=start]').fill('13:00'); await clash.locator('[data-field=end]').fill('15:00');
    await form.getByRole('button', { name: 'Save availability', exact: true }).click();
    await form.locator('[role=alert][data-code=invalid_arguments]').waitFor();
    equal('overlapping times are refused visibly and nothing changes', (await mcp('availability.get')).blocks, blocksBefore);
    await step(page, 'availability', 'Two Thursday times that overlap are refused', { action: 'Availability: add Thursday 08:00–14:00 and Thursday 13:00–15:00, save.', expected: 'pegboard.availability.update answers invalid_arguments; the saved list is unchanged.', observed: await said(form.locator('[role=alert]')), state: { 'availability.get': blocksBefore.length + ' blocks' }, check: 'overlapping times are refused visibly and nothing changes' });
    await clash.getByRole('button', { name: 'Remove', exact: true }).click();
    await form.getByRole('button', { name: 'Save availability', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Availability saved' }).waitFor(); await ready();
    equal('saving availability sends the whole list', args(lastCall('pegboard.availability.update')), { blocks: [...blocksBefore, { weekday: 'thu', start: '08:00', end: '14:00' }] });
    await nav('Schedule'); await gotoWeek('2026-11-23'); await openShift(COVERED);
    check('a shift in the new blocked time is flagged at the next read', await shiftPage(COVERED).locator('section[aria-label="Flag outside_availability"]').count() === 1);
    await step(page, 'availability', 'Saved without the overlap: Thursday\'s shift is now flagged', { action: 'Remove the second time and save; open Thursday\'s shift sh-1126-02.', expected: 'The list is saved; the shift inside the new time carries the flag outside_availability. The manager\'s schedule stands.', observed: await head(shiftPage(COVERED)), state: { 'availability.get': (await mcp('availability.get')).blocks.length + ' blocks', 'shifts.get': 'flags ' + (await mcp('shifts.get', { id: COVERED })).shift.flags.join(', '), version: await version() }, check: 'a shift in the new blocked time is flagged at the next read' });

    await nav('Hours');
    const hoursPage = page.locator('.detail article[data-hours][data-loaded="true"]');
    await hoursPage.waitFor();
    const W = await page.evaluate(() => [...document.querySelectorAll('.detail [data-week]')].map(n => n.dataset.week));
    const summary = (await mcp('hours.summary', week(W[0], 28))).weeks;
    equal('the hours page is the App\'s summary, week by week', W, summary.map(w => w.week_start));
    check('each week shows the App\'s scheduled hours and cap and labels pay an estimate', (await hoursPage.innerText()).includes(summary[0].scheduled_hours + ' of ' + summary[0].cap + ' hours') && (await hoursPage.innerText()).includes('an estimate, not payroll'));

    await nav('Notifications');
    equal('notifications are listed newest first, as the App lists them', await page.locator('#records [data-notification-id]').evaluateAll(n => n.map(x => x.dataset.notificationId)), (await mcp('notifications.list', { limit: 50 })).notifications.map(n => n.id));
    await page.locator('select[aria-label="Notification kind"]').selectOption('handoff.received');
    await page.waitForFunction(() => [...document.querySelectorAll('#records [data-notification-id]')].length > 0 && [...document.querySelectorAll('#records [data-notification-id]')].every(n => n.innerText.includes('Handoff received')));
    equal('the kind filter is the App\'s filter', await page.locator('#records [data-notification-id]').evaluateAll(n => n.map(x => x.dataset.notificationId)), (await mcp('notifications.list', { kind: 'handoff.received', limit: 50 })).notifications.map(n => n.id));
    await page.locator('select[aria-label="Notification kind"]').selectOption('');

    await nav('Settings');
    const settings = page.locator('.detail article[data-settings][data-loaded="true"]');
    await settings.waitFor();
    await settings.locator('input[data-field=open_shift_notices]').uncheck();
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Settings saved.' }).waitFor(); await ready();
    equal('settings send only what changed', args(lastCall('pegboard.preferences.update')), { patch: { open_shift_notices: false } });
    await settings.waitFor();
    await step(page, 'settings', 'Open-shift notices switched off and saved', { action: 'Settings: untick open-shift notices, Save settings.', expected: 'Only open_shift_notices is sent; the App stores it.', observed: 'Status: Settings saved.', state: { 'preferences.get': 'open_shift_notices ' + (await mcp('preferences.get')).preferences.open_shift_notices, version: await version() }, check: 'settings send only what changed' });
    await settings.waitFor();
    await settings.locator('input[data-field="quiet_hours.start"]').fill('07:00');
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await settings.locator('[role=alert][data-code=invalid_arguments]').waitFor();
    check('quiet hours that start and end at the same time are refused visibly and nothing changes', (await mcp('preferences.get')).preferences.quiet_hours.start === '22:00');
    await step(page, 'settings', 'Quiet hours from 07:00 to 07:00 are refused', { action: 'Set quiet hours to start at 07:00 (they end at 07:00), Save settings.', expected: 'pegboard.preferences.update answers invalid_arguments; quiet hours stay 22:00–07:00.', observed: await said(settings.locator('[role=alert]')), state: { 'preferences.get': 'quiet hours ' + (await mcp('preferences.get')).preferences.quiet_hours.start + '–' + (await mcp('preferences.get')).preferences.quiet_hours.end }, check: 'quiet hours that start and end at the same time are refused visibly and nothing changes' });
    await shot('settings');

    // ---- independent changes: events and the clock, through Infra only ---------------------------------------------------
    const apply = async event => { const r = await infra.call('env.apply_event', { expected_version: (await snap()).version, event }); assert.equal(r.status, 'committed', JSON.stringify(r)); };
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    await apply(scenario);
    await nav('Schedule'); await refresh(); await gotoWeek('2026-11-23');
    check('after Refresh the schedule shows a manager\'s change that arrived as a scenario event', (await page.locator('#records [data-record-id="' + STALE + '"]').innerText()).startsWith(await clockText(scenario.payload.change.start)));
    await openShift(STALE);
    await step(page, 'manager-change', 'Rosa moves Monday\'s opening shift an hour earlier', { action: 'Infra applies the package\'s scenario event (pegboard.shift.changed, ev-pb-310); Refresh; open sh-1123-01.', expected: 'The shift now starts at 05:00, with the change and its reason in its history.', observed: await head(shiftPage(STALE)), state: { 'shifts.get': 'start ' + (await mcp('shifts.get', { id: STALE })).shift.start, version: await version() }, check: 'after Refresh the schedule shows a manager\'s change that arrived as a scenario event' });
    await nav('Handoffs');
    const voided = (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.find(h => h.shift.id === STALE && h.kind === 'release');
    check('the pending handoff that named the changed shift reads void', voided.state === 'void' && (await page.locator('#records [data-handoff-id="' + voided.id + '"]').innerText()).includes('Void'));
    await page.locator('#records [data-handoff-id="' + voided.id + '"]').click(); await handoffPage(voided.id).waitFor();
    await step(page, 'manager-change', 'The release that named it is void: nothing changed hands', { action: 'Handoffs: open the release made earlier through MCP for sh-1123-01.', expected: 'The release reads Void; the shift stays Noor\'s.', observed: await head(handoffPage(voided.id)), state: { 'handoffs.get': voided.id + ' void', 'shifts.get': (await mcp('shifts.get', { id: STALE })).shift.assignee }, check: 'the pending handoff that named the changed shift reads void' });
    const hostile = '<img src=x onerror="window.injected=true">';
    await apply({ event_id: 'web-hostile', at: at('2026-11-21', '20:50'), operation: 'pegboard.handoff.received', payload: { handoff_id: 'ho-web-1', kind: 'cover', from_person_id: KAI, their_shift_id: 'sh-1124-05', message: 'Can you cover? ' + hostile } });
    await refresh();
    await page.locator('#records [data-handoff-id="ho-web-1"]').click();
    await handoffPage('ho-web-1').waitFor();
    check('untrusted text is shown as text and never executed', (await page.locator('.detail').innerText()).includes(hostile) && !(await page.evaluate(() => window.injected)) && await page.locator('.detail img').count() === 0);
    const moved = await infra.call('env.advance_time', { request_id: 'web-clock', expected_version: (await snap()).version, virtual_now: at('2026-11-25', '09:00') });
    assert.ok(['committed', 'ok'].includes(moved.status), JSON.stringify(moved));
    await refresh();
    await page.locator('#records [data-handoff-id="' + cover.id + '"] .pb-chip').filter({ hasText: 'Expired' }).waitFor();
    checks.push('after a clock move by Infra alone, a request past its cut-off reads expired');
    await page.locator('#records [data-handoff-id="' + cover.id + '"]').click(); await handoffPage(cover.id).waitFor();
    await step(page, 'cover-expired', 'Kai never answered: past the cut-off the request reads Expired', { action: 'Infra moves the clock to 25 November 09:00 with env.advance_time (no App event); Refresh; open the request.', expected: 'The request is expired (derived from its cut-off, nothing rewritten); the shift is still Noor\'s.', observed: await head(handoffPage(cover.id)), state: { 'handoffs.get': cover.id + ' ' + (await mcp('handoffs.get', { id: cover.id })).handoff.state, 'shifts.get': 'sh-1126-02 ' + (await mcp('shifts.get', { id: COVERED })).shift.assignee, version: await version() }, check: 'after a clock move by Infra alone, a request past its cut-off reads expired' });

    const denied = await page.evaluate(async () => { const { csrf } = await (await fetch('/session')).json(); return (await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name: 'env.snapshot', arguments: {} }) })).status; });
    equal('a management request from the business session is denied', denied, 403);
    for (const section of ['Schedule', 'Handoffs', 'Time off', 'Availability', 'Hours', 'Notifications', 'Settings']) {
      await page.setViewportSize({ width: 390, height: 844 }); await nav(section); await page.locator('.detail [data-loaded="true"]').first().waitFor();
      check('no horizontal page overflow on a narrow screen: ' + section, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await shot('narrow');
    await page.setViewportSize({ width: 1360, height: 960 });
    equal('no JavaScript errors in the browser', errors, []);
    await context.close();

    // ---- a Task-like policy: only what the scenario profile allows -------------------------------------------------
    restricted = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'restricted', profile: 'scenario' });
    restrictedInfra = new Client(prepared.app, 'infra', restricted.run, stateDir, 'pegboard-web-inspector', { registry: prepared.registry });
    await restrictedInfra.initialize();
    const rdata = async () => (await restrictedInfra.call('env.snapshot')).snapshot.data;
    const rcontext = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), rpage = await rcontext.newPage();
    rpage.setDefaultTimeout(10000); pages.push(rpage);
    const rerrors = [];
    rpage.on('pageerror', e => rerrors.push(e.message));
    await rpage.goto(restricted.accessUrl); await rpage.locator('#records .record').first().waitFor(); await rpage.locator('#app[aria-busy=false]').waitFor();
    const rready = () => rpage.locator('#app[aria-busy=false]').waitFor();
    const rshift = id => rpage.locator('.detail article[data-shift-id="' + id + '"][data-loaded="true"]');
    const rnav = async name => { await rpage.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click(); await rready(); };
    const rweek = async monday => { for (let i = 0; i < 8 && await rpage.locator('[data-week]').first().getAttribute('data-week') !== monday; i++) { await rpage.getByRole('button', { name: 'Next week' }).click(); await rready(); } };
    const rdialog = rpage.locator('dialog.pb-dialog');
    await rweek('2026-11-23');
    await rpage.locator('#records [data-record-id="' + STALE + '"]').click(); await rshift(STALE).waitFor();
    await rshift(STALE).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await rdialog.locator('[data-field=to_person_id]').selectOption('person-ada');
    await rdialog.locator('button[type=submit]').click();
    await rdialog.locator('[role=alert][data-code=permission_denied]').waitFor();
    await step(rpage, 'restricted-policy', 'Under the scenario policy, a cover for a shift it does not list is refused', { action: 'A second run with the scenario profile: open sh-1123-01, Ask for cover, choose Ada, send.', expected: 'Core answers permission_denied (the policy allows covers for three shifts only); nothing is written.', observed: await said(rdialog.locator('[role=alert]')), state: { 'env.snapshot': 'pending handoffs for sh-1123-01: ' + (await rdata()).handoffs.filter(h => h.shift_id === STALE && ['awaiting_coworker', 'awaiting_manager'].includes(h.state)).length } });
    await rdialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await rdialog.waitFor({ state: 'detached' });
    check('a write the policy refuses is shown as refused and changes nothing', !(await rdata()).handoffs.some(h => h.shift_id === STALE && ['awaiting_coworker', 'awaiting_manager'].includes(h.state)));
    await rpage.locator('#records [data-record-id="' + COVERED + '"]').click(); await rshift(COVERED).waitFor();
    await rshift(COVERED).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await rdialog.locator('[data-field=to_person_id]').selectOption(KAI);
    await rdialog.locator('button[type=submit]').click(); await rdialog.waitFor({ state: 'detached' }); await rready();
    check('a cover the policy allows is recorded', (await rdata()).handoffs.some(h => h.shift_id === COVERED && h.state === 'awaiting_coworker'));
    await rnav('Availability');
    await rpage.locator('.detail article[data-availability][data-loaded="true"]').waitFor();
    check('availability is read-only when the policy offers no availability write', await rpage.getByRole('button', { name: 'Save availability', exact: true }).count() === 0 && await rpage.locator('.detail [data-block] select').first().isDisabled());
    await rnav('Settings');
    const rsettings = rpage.locator('.detail article[data-settings][data-loaded="true"]');
    await rsettings.waitFor();
    await rsettings.locator('input[data-field=email_notices]').uncheck();
    await rsettings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await rsettings.locator('[role=alert][data-code=permission_denied]').waitFor();
    check('a settings change outside the allowed fields is refused', (await rdata()).preferences.email_notices === true);
    equal('no JavaScript errors under the restricted policy', rerrors, []);
    await rcontext.close();

    // ---- the full-window evaluation dataset in the same pages --------------------------------------------------------
    full = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'full-window', profile: 'sandbox' });
    fullInfra = new Client(prepared.app, 'infra', full.run, stateDir, 'pegboard-web-dataset', { registry: prepared.registry });
    await fullInfra.initialize();
    const fwDir = path.join(appDir, 'datasets/full-window'), fwClock = JSON.parse(fs.readFileSync(path.join(fwDir, 'clock.json'), 'utf8')).initial_time;
    const fwLoad = await fullInfra.call('env.load_seed', { expected_version: (await fullInfra.call('env.snapshot')).version, data: JSON.parse(fs.readFileSync(path.join(fwDir, 'seed.json'), 'utf8')), virtual_now: fwClock, request_id: 'web-full-window' });
    assert.equal(fwLoad.status, 'ready', JSON.stringify(fwLoad).slice(0, 300));
    const fcontext = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), fpage = await fcontext.newPage();
    fpage.setDefaultTimeout(30000); pages.push(fpage);
    const ferrors = [];
    fpage.on('pageerror', e => ferrors.push(e.message));
    const fready = () => fpage.locator('#app[aria-busy=false]').waitFor();
    const fmcp = async (name, a = {}) => { const r = await full.client.call('pegboard.' + name, a); assert.equal(r.status, 'ok', name); return r; };
    await fpage.goto(full.accessUrl); await fpage.locator('#records .record').first().waitFor(); await fready();
    let fnext = null, fcursor = null;
    do { const r = await fmcp('shifts.list', { ...WIDE, mine: true, limit: 200, ...(fcursor ? { cursor: fcursor } : {}) }); fnext = r.shifts.find(x => x.phase !== 'ended'); fcursor = r.next_cursor; } while (!fnext && fcursor);
    const fshift = fpage.locator('.detail article[data-shift-id="' + fnext.id + '"][data-loaded="true"]');
    await fshift.waitFor();
    equal('on the full-window dataset the schedule opens on the week of Noor\'s next shift, past two years of history, with that shift selected', await fpage.locator('[data-week]').first().getAttribute('data-week'), fnext.week_start);
    await step(fpage, 'full-window', 'Two years of history: the page opens on Noor\'s next shift after the clock', { action: 'A third run: Infra loads datasets/full-window with env.load_seed at its clock (' + fwClock + '); open the access link.', expected: 'The schedule opens on the week of Noor\'s next shift that has not ended, ' + fnext.week_start + ', with that shift selected.', observed: await head(fshift), state: { 'env.load_seed': fwLoad.status + ', ' + fwLoad.loaded + ' records', 'shifts.list': 'next shift ' + fnext.id + ' (week of ' + fnext.week_start + ')' }, check: 'on the full-window dataset the schedule opens on the week of Noor\'s next shift, past two years of history, with that shift selected' });
    await fpage.locator('nav').getByRole('button', { name: /^\S*\s*Handoffs/ }).click(); await fready();
    const oldest = (await fmcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.at(-1), oldPage = fpage.locator('.detail article[data-handoff-id="' + oldest.id + '"][data-loaded="true"]');
    await fpage.locator('#records [data-handoff-id="' + oldest.id + '"]').click(); await oldPage.waitFor();
    check('the oldest handoff of the dataset opens with its year shown', oldest.created_at.startsWith('2025-01') && (await fullText(oldPage)).includes('2025'));
    await step(fpage, 'full-window', 'The oldest handoff, from January 2025', { action: 'Handoffs: open the last closed request in the list.', expected: 'The request of ' + oldest.created_at.slice(0, 10) + ' with its history; dates outside the opening year show their year.', observed: await head(oldPage), state: { 'handoffs.get': oldest.id + ' ' + oldest.state + ', created ' + oldest.created_at } , check: 'the oldest handoff of the dataset opens with its year shown' });
    const oldShift = (await fmcp('shifts.get', { id: oldest.shift.id })).shift;
    await oldPage.getByRole('button', { name: 'Open the shift', exact: true }).click();
    await fpage.locator('.detail article[data-shift-id="' + oldShift.id + '"][data-loaded="true"]').waitFor(); await fready();
    equal('opening its shift moves the schedule to that week of January 2025', await fpage.locator('[data-week]').first().getAttribute('data-week'), oldShift.week_start);
    await step(fpage, 'full-window', 'Its shift, in its week of January 2025', { action: 'Open the shift.', expected: 'The schedule moves to the week of ' + oldShift.week_start + ' and lists the whole team\'s shifts of that week.', observed: await said(fpage.locator('.pb-week')) + ' · ' + await head(fpage.locator('.detail article[data-shift-id="' + oldShift.id + '"]')), state: { 'shifts.list': (await fmcp('shifts.list', { ...week(oldShift.week_start), limit: 200 })).shifts.length + ' shifts that week' }, check: 'opening its shift moves the schedule to that week of January 2025' });
    equal('no JavaScript errors on the full-window dataset', ferrors, []);
    await fcontext.close();

    const report = { schema: 'pegboard.web-check.v1', passed: true, recorded_at: new Date().toISOString(), node: process.version, browser: browser.version(), runtime: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      package_sha256: digestTree(appDir), duration_ms: Date.now() - started, checks: checks.length, names: checks, screenshots };
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + '\n'); }
    if (evidence) {
      for (const x of sequences) if (x.check) assert.ok(checks.includes(x.check), 'evidence step names a check of this run: ' + x.check);
      fs.writeFileSync(path.join(evidence, 'sequences.json'), JSON.stringify({
        schema: 'pegboard.web-evidence.v1', app_version: JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8')).version, package_sha256_without_evidence: digestWithout(appDir, 'evidence'),
        runtime: report.runtime, node: process.version, browser: 'Chrome ' + browser.version() + ', headless', viewport: '1360x960 (narrow checks at 390x844)', browser_time_zone: 'Asia/Tokyo', workplace_time_zone: ZONE,
        runs: { browser: 'sandbox profile, fixtures/minimal.json, account pegboard-noor (Noor Haddad), clock 2026-11-21T18:00:00-08:00', restricted: 'scenario profile, same fixture', 'full-window': 'sandbox profile, datasets/full-window loaded by Infra at its clock' },
        test: 'tests/web.browser.cjs', checks: checks.length, steps: sequences,
      }, null, 2) + '\n');
    }
    console.log('PASS: ' + checks.length + ' browser checks (' + browser.version() + ').' + (evidence ? ' Evidence: ' + sequences.length + ' steps.' : ''));
  } catch (e) {
    console.error('FAIL after ' + checks.length + ' checks: ' + (e.stack || e));
    if (shots) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(shots, 'failed-' + i + '.png'), fullPage: true }).catch(() => {});
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify({ schema: 'pegboard.web-check.v1', passed: false, checks: checks.length, names: checks, error: String(e.message || e) }, null, 2) + '\n'); }
    process.exitCode = 1;
  } finally {
    await infra?.close().catch(() => {}); await restrictedInfra?.close().catch(() => {}); await fullInfra?.close().catch(() => {}); await full?.close().catch(() => {});
    await host?.close().catch(() => {}); await restricted?.close().catch(() => {}); await browser?.close().catch(() => {});
    prepared.cleanup();
  }
}
main();
