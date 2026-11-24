#!/usr/bin/env node
'use strict';
// Browser checks of the Pegboard web pages on the public business Web Host: real controls in
// a real browser, with the same run inspected through MCP after every write.
//
//   node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--chrome PATH]
//
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
    if (!['--runtime', '--report', '--screenshots', '--chrome'].includes(key) || !value) return null;
    out[key.slice(2)] = value;
  }
  return out.runtime ? out : null;
}
const opts = options(), root = opts && path.resolve(opts.runtime);
if (!opts || !fs.existsSync(path.join(root, 'web', 'server.cjs'))) {
  console.error('Usage: node tests/web.browser.cjs --runtime DIR [--report FILE] [--screenshots DIR] [--chrome PATH]');
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
const nextMonday = monday => { const d = new Date(monday + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); };

async function main() {
  const prepared = prepare(appDir), stateDir = path.join(prepared.root, 'state'), started = Date.now();
  const shots = opts.screenshots ? path.resolve(opts.screenshots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const checks = [], screenshots = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  let browser, host, restricted, infra, restrictedInfra;
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
    await shiftPage(COVERED).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await dialog.locator('[data-field=to_person_id]').selectOption(INES);
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    await dialog.locator('button[type=submit]').click();
    await refused('not_qualified');
    check('a cover the rules refuse is refused visibly and writes nothing', !(await data()).handoffs.some(h => h.shift_id === COVERED && h.state === 'awaiting_coworker'));
    await shiftPage(COVERED).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await dialog.locator('[data-field=to_person_id]').selectOption(KAI);
    const kaiCheck = dialog.locator('[aria-label=Eligibility][data-loaded="true"]');
    await kaiCheck.waitFor();
    const kai = await mcp('eligibility.check', { id: COVERED, person_id: KAI });
    check('the cover form shows the App\'s check for the chosen coworker', (await kaiCheck.locator('[data-eligible]').getAttribute('data-eligible')) === String(kai.eligible) && kai.eligible);
    await dialog.locator('[data-field=message]').fill('Could you take my Thursday?');
    await submit();
    equal('asking for cover sends the shift, the coworker and the message', args(lastCall('pegboard.handoffs.cover')), { id: COVERED, to_person_id: KAI, message: 'Could you take my Thursday?' });
    const cover = (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.find(h => h.shift.id === COVERED && h.state === 'awaiting_coworker');
    const coveredShift = (await mcp('shifts.get', { id: COVERED })).shift;
    check('the cover is the App\'s record and the shift stays mine until it is approved', cover && cover.counterpart_id === KAI && coveredShift.assignee === 'person-noor' && coveredShift.pending_handoff_id === cover.id);

    await openShift(STALE);
    await shiftPage(STALE).getByRole('button', { name: 'Ask for cover', exact: true }).click();
    await dialog.locator('[data-field=to_person_id]').selectOption('person-ada');
    await mcp('handoffs.release', { id: STALE, expected_version: (await snap()).version, request_id: 'outside-release' });
    await dialog.locator('button[type=submit]').click();
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
    await submit();
    await page.unroute('**/api/call');
    equal('a retry after a lost response has one effect', (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.filter(h => h.shift.id === RELEASED && h.kind === 'release').length, 1);

    await gotoWeek('2026-11-30');
    await openShift(TRADED);
    await shiftPage(TRADED).getByRole('button', { name: 'Offer a trade', exact: true }).click();
    await dialog.locator('[data-field=their_shift_id]').selectOption(THEIRS);
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    await submit();
    equal('offering a trade sends my shift and the one I want', args(lastCall('pegboard.handoffs.trade')), { id: TRADED, their_shift_id: THEIRS });
    const trade = (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.find(h => h.kind === 'trade' && h.shift.id === TRADED && h.state === 'awaiting_coworker');
    check('the trade is the App\'s record and nothing has changed hands', trade && trade.other_shift.id === THEIRS && (await mcp('shifts.get', { id: TRADED })).shift.assignee === 'person-noor');

    await gotoWeek('2026-11-23');
    await openShift(OPEN);
    await shiftPage(OPEN).getByRole('button', { name: 'Pick up this shift', exact: true }).click();
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    await dialog.locator('button[type=submit]').click();
    await refused((await mcp('eligibility.check', { id: OPEN })).blocks[0]);
    check('a pick-up the rules refuse is refused visibly and writes nothing', !(await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.some(h => h.kind === 'pickup' && h.shift.id === OPEN));

    await nav('Handoffs');
    const incoming = (await mcp('handoffs.list', { state: 'awaiting_me', limit: 100 })).handoffs[0];
    await page.locator('#records [data-handoff-id="' + incoming.id + '"]').click();
    await handoffPage(incoming.id).getByRole('button', { name: 'Accept', exact: true }).click();
    await dialog.locator('[aria-label=Eligibility][data-loaded="true"]').waitFor();
    const mineCheck = await mcp('eligibility.check', { id: incoming.shift.id });
    await dialog.locator('button[type=submit]').click();
    await refused(mineCheck.blocks[0]);
    check('accepting a request the rules refuse is refused visibly and the request still waits for me', (await mcp('handoffs.get', { id: incoming.id })).handoff.state === 'awaiting_me');
    await handoffPage(incoming.id).getByRole('button', { name: 'Decline', exact: true }).click();
    await dialog.locator('[data-field=message]').fill('Sorry, I am at my cap that week.');
    await submit();
    equal('declining sends the answer and the message', args(lastCall('pegboard.handoffs.respond')), { id: incoming.id, answer: 'decline', message: 'Sorry, I am at my cap that week.' });
    check('the request is declined in the App', (await mcp('handoffs.get', { id: incoming.id })).handoff.state === 'declined');
    const asked = (await mcp('handoffs.list', { state: 'awaiting_coworker', limit: 100 })).handoffs.find(h => h.asked_by_me && h.id !== cover.id && h.id !== trade.id);
    await page.locator('#records [data-handoff-id="' + asked.id + '"]').click();
    await handoffPage(asked.id).getByRole('button', { name: 'Cancel request', exact: true }).click();
    await submit();
    check('cancelling my request closes it in the App', (await mcp('handoffs.get', { id: asked.id })).handoff.state === 'cancelled');
    equal('handoffs are listed as the App lists them, grouped by who they wait for', (await page.locator('#records [data-handoff-id]').evaluateAll(n => n.map(x => x.dataset.handoffId))).sort(), (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.map(h => h.id).sort());
    await shot('handoffs');

    // ---- W2 time off, availability and settings -------------------------------------------------------------------
    await nav('Time off');
    await page.getByRole('button', { name: 'Request time off', exact: true }).click();
    await dialog.locator('[data-field=start]').fill('2026-11-30'); await dialog.locator('[data-field=end]').fill('2026-11-30');
    await dialog.locator('button[type=submit]').click();
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
    await page.locator('.detail article[data-time-off-id="' + off.id + '"]').getByRole('button', { name: 'Cancel time off', exact: true }).click();
    await submit();
    check('cancelling the time off is recorded in the App', (await mcp('time_off.list', { include_closed: true })).time_off.find(t => t.id === off.id).state === 'cancelled');

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
    await clash.getByRole('button', { name: 'Remove', exact: true }).click();
    await form.getByRole('button', { name: 'Save availability', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Availability saved' }).waitFor(); await ready();
    equal('saving availability sends the whole list', args(lastCall('pegboard.availability.update')), { blocks: [...blocksBefore, { weekday: 'thu', start: '08:00', end: '14:00' }] });
    await nav('Schedule'); await gotoWeek('2026-11-23'); await openShift(COVERED);
    check('a shift in the new blocked time is flagged at the next read', await shiftPage(COVERED).locator('section[aria-label="Flag outside_availability"]').count() === 1);

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
    await settings.locator('input[data-field="quiet_hours.start"]').fill('07:00');
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await settings.locator('[role=alert][data-code=invalid_arguments]').waitFor();
    check('quiet hours that start and end at the same time are refused visibly and nothing changes', (await mcp('preferences.get')).preferences.quiet_hours.start === '22:00');
    await shot('settings');

    // ---- independent changes: events and the clock, through Infra only ---------------------------------------------------
    const apply = async event => { const r = await infra.call('env.apply_event', { expected_version: (await snap()).version, event }); assert.equal(r.status, 'committed', JSON.stringify(r)); };
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    await apply(scenario);
    await nav('Schedule'); await refresh(); await gotoWeek('2026-11-23');
    check('after Refresh the schedule shows a manager\'s change that arrived as a scenario event', (await page.locator('#records [data-record-id="' + STALE + '"]').innerText()).startsWith(await clockText(scenario.payload.change.start)));
    await nav('Handoffs');
    const voided = (await mcp('handoffs.list', { include_closed: true, limit: 100 })).handoffs.find(h => h.shift.id === STALE && h.kind === 'release');
    check('the pending handoff that named the changed shift reads void', voided.state === 'void' && (await page.locator('#records [data-handoff-id="' + voided.id + '"]').innerText()).includes('Void'));
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

    const report = { schema: 'pegboard.web-check.v1', passed: true, recorded_at: new Date().toISOString(), node: process.version, browser: browser.version(), runtime: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      package_sha256: digestTree(appDir), duration_ms: Date.now() - started, checks: checks.length, names: checks, screenshots };
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + '\n'); }
    console.log('PASS: ' + checks.length + ' browser checks (' + browser.version() + ').');
  } catch (e) {
    console.error('FAIL after ' + checks.length + ' checks: ' + (e.stack || e));
    if (shots) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(shots, 'failed-' + i + '.png'), fullPage: true }).catch(() => {});
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify({ schema: 'pegboard.web-check.v1', passed: false, checks: checks.length, names: checks, error: String(e.message || e) }, null, 2) + '\n'); }
    process.exitCode = 1;
  } finally {
    await infra?.close().catch(() => {}); await restrictedInfra?.close().catch(() => {});
    await host?.close().catch(() => {}); await restricted?.close().catch(() => {}); await browser?.close().catch(() => {});
    prepared.cleanup();
  }
}
main();
