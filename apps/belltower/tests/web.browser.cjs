#!/usr/bin/env node
'use strict';
// Browser checks of the Belltower web pages on the public business Web Host: real controls in
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

const BRIDGE = 'it-roads-0031', LIBRARY = 'it-city-0207', BULLETIN = 'it-bull-0312', REPORT = 'it-ledg-0431', CLIPPED = 'clp-0004';
const ZONE = 'America/Chicago';
const at = (date, hhmm) => date + 'T' + hhmm + ':00-06:00';
// Core's package digest (verify.cjs digestTree) of the package without one top-level folder:
// the evidence folder holds the screenshots this test takes, so they cannot be part of what they show.
function digestWithout(dir, skip) {
  const hash = require('node:crypto').createHash('sha256');
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (d === dir && e.name === skip) continue; if (e.isDirectory()) walk(f); else { hash.update(path.relative(dir, f).split(path.sep).join('/')); hash.update('\0'); hash.update(fs.readFileSync(f)); } } };
  walk(dir);
  return hash.digest('hex');
}
const SEQUENCES = {
  'read-mark': 'Reading a corrected item and marking it read', 'clipping': 'Clipping: refused, saved, moved, edited, cancelled, watched, removed',
  'follow': 'Following: saved, edited, stale, retried, refused, paused, removed', 'correction': 'A correction arrives on a watched clipping',
  'retraction': 'A retraction arrives on a clipped item', 'settings': 'Settings: saved, refused', 'restricted-policy': 'A Task-like policy',
  'full-window': 'The full-window dataset in the web pages',
};

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
    infra = new Client(prepared.app, 'infra', host.run, stateDir, 'belltower-web-inspector', { registry: prepared.registry });
    await infra.initialize();
    const agent = host.client;
    const snap = async () => infra.call('env.snapshot');
    const data = async () => (await snap()).snapshot.data;
    const mcp = async (name, args = {}) => { const r = await agent.call('belltower.' + name, args); assert.ok(['ok', 'committed'].includes(r.status), name + ': ' + r.status); return r; };

    // The browser runs in another zone than the account: times must come out in the account's zone.
    const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), page = await context.newPage();
    page.setDefaultTimeout(10000); pages.push(page);
    const errors = [], calls = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/call')) calls.push(r.postDataJSON()); });
    const ready = () => page.locator('#app[aria-busy=false]').waitFor();
    const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp(name) }).click(); await ready(); };
    const itemPage = id => page.locator('.detail article[data-item-id="' + id + '"][data-loaded="true"]');
    const openItem = async id => { await page.locator('#records [data-record-id="' + id + '"]').click(); await itemPage(id).waitFor(); };
    const listIds = () => page.locator('#records [data-record-id]').evaluateAll(nodes => nodes.map(n => n.dataset.recordId));
    const dialog = page.locator('dialog.bt-dialog');
    const submit = async () => { await dialog.locator('button[type=submit]').click(); await dialog.waitFor({ state: 'detached' }); await ready(); };
    const refused = async code => { await dialog.locator('[role=alert][data-code="' + code + '"]').waitFor(); const text = await dialog.locator('[role=alert]').innerText(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); return text; };
    const lastCall = name => calls.filter(c => c.name === name).at(-1);
    const args = call => { const { expected_version, request_id, ...rest } = call.arguments; assert.ok(expected_version && request_id, 'a write carries a version and a request ID'); return rest; };
    const shot = async name => { if (!shots) return; const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(path.basename(file)); };
    const inZone = (iso) => page.evaluate(([value, zone]) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)), [iso, ZONE]);
    const refresh = async () => { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await ready(); };
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
    const head = async article => (await article.evaluate(a => [...a.querySelectorAll(':scope > header, :scope > .bt-chips, :scope > .bt-banner')].map(n => n.innerText).join(' · '))).replace(/\s+/g, ' ').trim().slice(0, 400);
    const version = async () => { const v = (await snap()).version; return 'epoch ' + v.epoch + ', revision ' + v.revision; };
    const alertOf = async code => { const a = dialog.locator('[role=alert][data-code="' + code + '"]'); await a.waitFor(); return said(a); };
    const receipt = name => 'request ' + lastCall(name).arguments.request_id;
    const cancel = async () => { await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); };

    // ---- the pages and what the Host offers them ------------------------------------------------------------
    await page.goto(host.accessUrl);
    await page.locator('#records .record').first().waitFor(); await ready();
    check('the Host serves the App-owned pages', await page.title() === 'Belltower · PALE' && await page.locator('nav').getByRole('button', { name: /News/ }).count() === 1);
    const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8'), tools = JSON.parse(fs.readFileSync(path.join(appDir, 'tools.json'), 'utf8'));
    check('the controller names every declared business tool', tools.every(t => controller.includes("'" + t.name + "'")));
    const discovered = await page.evaluate(async () => (await (await fetch('/api/tools')).json()).tools.map(t => t.name));
    check('business discovery offers no management tool', discovered.length === tools.length && discovered.every(n => !n.startsWith('env.')));

    // ---- W2 evidence: items, revisions, copies -----------------------------------------------------------------
    equal('the news list is the App\'s list, newest first', await listIds(), (await mcp('items.list', { limit: 100 })).items.map(i => i.id));
    const marksBefore = (await mcp('reading.list', { limit: 100 })).marks;
    await openItem(BRIDGE);
    const bridge = (await mcp('items.get', { id: BRIDGE })).item;
    const bridgePage = itemPage(BRIDGE);
    check('an item opens at its latest revision with the publisher\'s correction note', (await bridgePage.locator('section[aria-label="Revision text"]').getAttribute('data-revision')) === String(bridge.latest_revision)
      && (await bridgePage.locator('section[aria-label="Correction"]').innerText()).includes(bridge.note));
    check('times are shown in the account\'s zone, not the browser\'s', (await bridgePage.locator('section[aria-label="Revision text"]').innerText()).includes(await inZone(bridge.received_at)));
    await shot('news');
    await step(page, 'read-mark', 'The bridge notice opens at its correction, with the publisher\'s note', { action: 'News: open “' + bridge.headline + '” (' + BRIDGE + ').', expected: 'Revision ' + bridge.latest_revision + ' (a correction) with the publisher\'s note; times in ' + ZONE + ' although the browser runs in Asia/Tokyo; the list row says Changed since read.', observed: await head(bridgePage) + ' · ' + await said(page.locator('#records [data-record-id="' + BRIDGE + '"]')), state: { 'items.get': BRIDGE + ' latest revision ' + bridge.latest_revision + ' (' + bridge.type + '), last read revision ' + bridge.last_read_revision }, check: 'an item opens at its latest revision with the publisher\'s correction note' });
    await bridgePage.locator('button.bt-rev[data-revision="1"]').click();
    await itemPage(BRIDGE).locator('section[aria-label="Revision text"][data-revision="1"]').waitFor();
    const first = (await mcp('items.get', { id: BRIDGE, revision: 1 })).item;
    check('an earlier revision is shown as such, with its own text', (await itemPage(BRIDGE).locator('section[aria-label="Earlier revision"]').innerText()).includes('revision 1 of ' + bridge.latest_revision)
      && (await itemPage(BRIDGE).locator('h2').innerText()) === first.headline && (await itemPage(BRIDGE).locator('section[aria-label="Revision text"]').innerText()).includes(first.body));
    await step(page, 'read-mark', 'Revision 1 is shown as an earlier revision, with its own text', { action: 'Click revision 1 in the list of revisions.', expected: 'The page says it shows revision 1 of ' + bridge.latest_revision + ' and shows that revision\'s headline and text.', observed: await said(itemPage(BRIDGE).locator('section[aria-label="Earlier revision"]')) + ' · ' + await said(itemPage(BRIDGE).locator('h2')), state: { 'items.get': BRIDGE + ' revision 1: “' + first.headline + '”' }, check: 'an earlier revision is shown as such, with its own text' });
    await openItem(LIBRARY); await openItem(BULLETIN);
    equal('opening items marks nothing as read', (await mcp('reading.list', { limit: 100 })).marks, marksBefore);
    await openItem(BRIDGE);
    await itemPage(BRIDGE).getByRole('button', { name: 'Show the latest revision', exact: true }).click();
    await itemPage(BRIDGE).locator('section[aria-label="Revision text"][data-revision="' + bridge.latest_revision + '"]').waitFor();
    await itemPage(BRIDGE).getByRole('button', { name: 'Mark revision ' + bridge.latest_revision + ' as read', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'marked as read' }).waitFor(); await ready();
    equal('marking sends the revision on the page', args(lastCall('belltower.reading.mark')), { id: BRIDGE, revision: bridge.latest_revision });
    check('the read mark is the App\'s record and the list no longer says changed since read', (await data()).read_marks.some(m => m.item_id === BRIDGE && m.revision === bridge.latest_revision)
      && !(await page.locator('#records [data-record-id="' + BRIDGE + '"]').innerText()).includes('Changed since read'));
    await step(page, 'read-mark', 'Marked as read: the App records revision ' + bridge.latest_revision + ' and the list stops saying changed', { action: 'Show the latest revision, then Mark revision ' + bridge.latest_revision + ' as read. (Opening three items before marked nothing.)', expected: 'belltower.reading.mark records revision ' + bridge.latest_revision + '; the list row no longer says Changed since read.', observed: await said(page.locator('#status')) + ' · ' + await said(page.locator('#records [data-record-id="' + BRIDGE + '"]')), state: { 'reading.list': (await mcp('reading.list', { limit: 1 })).marks.map(m => m.item_id + '@' + m.revision).join(), receipt: receipt('belltower.reading.mark'), version: await version() }, check: 'the read mark is the App\'s record and the list no longer says changed since read' });

    await page.locator('.toolbar input[type=search]').fill('Thursday'); await ready();
    const thursday = (await mcp('items.list', { query: 'Thursday', limit: 100 })).items;
    equal('search is the App\'s word search over every revision', await listIds(), thursday.map(i => i.id));
    check('an item found only in an earlier revision says so', thursday.find(i => i.id === BRIDGE).matched_revisions.join() === '1'
      && (await page.locator('#records [data-record-id="' + BRIDGE + '"]').innerText()).includes('Found in revision 1'));
    await page.locator('.toolbar input[type=search]').fill(''); await ready();
    await page.locator('details.bt-filters summary').click();
    await page.locator('details.bt-filters select[data-field=status]').selectOption('corrected'); await ready();
    equal('a filter is the App\'s filter', await listIds(), (await mcp('items.list', { status: 'corrected', limit: 100 })).items.map(i => i.id));
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await ready();

    await openItem(BULLETIN);
    const basis = itemPage(BULLETIN).locator('section[aria-label="Based on"][data-loaded="true"]');
    await basis.waitFor();
    const library = (await mcp('items.get', { id: LIBRARY })).item;
    check('a copy names the revision it copied and the source\'s revisions now, and nothing is labelled outdated', (await basis.innerText()).includes('copies revision 1 of “' + (await mcp('items.get', { id: LIBRARY, revision: 1 })).item.headline + '”')
      && (await basis.innerText()).includes('has ' + library.latest_revision + ' revisions now') && !/outdated/i.test(await page.locator('.detail').innerText()));
    await basis.getByRole('button', { name: 'Open its latest revision', exact: true }).click();
    await itemPage(LIBRARY).locator('section[aria-label="Revision text"][data-revision="' + library.latest_revision + '"]').waitFor();
    equal('the copied item lists who copied or reported it, with the revision each used', await itemPage(LIBRARY).locator('section[aria-label="Copied or reported by"] li').evaluateAll(n => n.map(x => x.dataset.refItemId)), library.referenced_by.map(r => r.item_id));
    const retracted = (await mcp('items.list', { status: 'retracted', limit: 1 })).items[0], gone = (await mcp('items.get', { id: retracted.id })).item;
    await openItem(retracted.id);
    check('a retraction shows the publisher\'s note and no text of its own', (await itemPage(retracted.id).locator('section[aria-label="Retraction"]').innerText()).includes(gone.note)
      && (await itemPage(retracted.id).locator('section[aria-label="Revision text"]').innerText()).includes('No text in this revision.'));
    await itemPage(retracted.id).locator('button.bt-rev[data-revision="1"]').click();
    await itemPage(retracted.id).locator('section[aria-label="Revision text"][data-revision="1"]').waitFor();
    check('the retracted item\'s earlier revision stays readable', (await itemPage(retracted.id).locator('section[aria-label="Revision text"]').innerText()).includes((await mcp('items.get', { id: retracted.id, revision: 1 })).item.body));

    // ---- W3 clippings --------------------------------------------------------------------------------------------
    await openItem(REPORT);
    await itemPage(REPORT).getByRole('button', { name: 'Clip this item', exact: true }).click();
    await dialog.locator('[data-field=note]').fill('Check the new hours before Tuesday.');
    await dialog.locator('[data-field="linked_object.app_id"]').fill('calendar'); await dialog.locator('[data-field="linked_object.object_type"]').fill('event');
    await dialog.locator('[data-field=watch]').check();
    const clipsBefore = (await data()).clippings.length, beforeClip = await version();
    await dialog.locator('button[type=submit]').click();
    const halfLink = await alertOf('invalid_input');
    check('a half-filled link is refused in the form and nothing is written', (await data()).clippings.length === clipsBefore && await version() === beforeClip);
    await step(page, 'clipping', 'A link without its object ID is refused in the form', { action: 'News: open “' + (await mcp('items.get', { id: REPORT })).item.headline + '” (' + REPORT + '), Clip this item: a note, calendar · event with no object ID, Watch; send.', expected: 'The form names the missing part and keeps its input; no clipping is written.', observed: halfLink, state: { 'clippings.list': clipsBefore + ' clippings', version: beforeClip }, check: 'a half-filled link is refused in the form and nothing is written' });
    await dialog.locator('[data-field="linked_object.object_id"]').fill('evt-web-1');
    await submit();
    const reportItem = (await mcp('items.get', { id: REPORT })).item, clip = (await data()).clippings.find(c => c.item_id === REPORT);
    equal('a clipping made in the browser is the App\'s record at the latest revision', clip && [clip.revision, clip.note, clip.linked_object, clip.watch], [reportItem.latest_revision, 'Check the new hours before Tuesday.', { app_id: 'calendar', object_type: 'event', object_id: 'evt-web-1' }, true]);
    await step(page, 'clipping', 'Completed and sent: the clipping is the App\'s record', { action: 'Give the object ID evt-web-1 and send again.', expected: 'belltower.clippings.add writes one clipping at revision ' + reportItem.latest_revision + ' with the note, the link and Watch on; the list row says Clipped.', observed: await said(page.locator('#status')) + ' · ' + await said(page.locator('#records [data-record-id="' + REPORT + '"]')), state: { 'clippings.list': clip.id + ' revision ' + clip.revision + ', note “' + clip.note + '”, linked calendar · event · evt-web-1, watch ' + clip.watch, receipt: receipt('belltower.clippings.add'), version: await version() }, check: 'a clipping made in the browser is the App\'s record at the latest revision' });

    await nav('Clippings');
    await page.locator('#records [data-clipping-id="' + CLIPPED + '"]').click();
    const clipPage = page.locator('.detail article[data-clipping-id="' + CLIPPED + '"][data-loaded="true"]');
    await clipPage.waitFor();
    await shot('clippings');
    await step(page, 'clipping', 'A clipping behind its item: the page says a newer revision arrived', { action: 'Clippings: open ' + CLIPPED + '.', expected: 'The clipping holds revision 1 of ' + library.latest_revision + ' and says that revision ' + library.latest_revision + ' (a correction) arrived, with the publisher\'s note.', observed: await head(clipPage), state: { 'clippings.list': CLIPPED + ' revision 1, state behind', 'items.get': LIBRARY + ' latest revision ' + library.latest_revision } });
    await clipPage.getByRole('button', { name: 'Move to revision ' + library.latest_revision, exact: true }).click();
    await page.locator('#status').filter({ hasText: 'now holds revision' }).waitFor(); await ready();
    equal('moving a clipping sends only the new revision', args(lastCall('belltower.clippings.update')), { id: CLIPPED, patch: { revision: library.latest_revision } });
    let kept = (await data()).clippings.find(c => c.id === CLIPPED);
    check('the clipping holds the newer revision and keeps the old one in its history', kept.revision === library.latest_revision && kept.history.at(-1).revision === 1);
    await clipPage.waitFor();
    await step(page, 'clipping', 'Moved: it holds revision ' + library.latest_revision + ' and keeps revision 1 in its history', { action: 'Move to revision ' + library.latest_revision + '.', expected: 'belltower.clippings.update sends only the revision; the clipping is current and its history keeps revision 1 with its note.', observed: await head(clipPage) + ' · ' + await said(clipPage.locator('section[aria-label="Clipping history"]')), state: { 'clippings.list': CLIPPED + ' revision ' + kept.revision + ', history: revision ' + kept.history.map(h => h.revision).join(', '), receipt: receipt('belltower.clippings.update'), version: await version() }, check: 'the clipping holds the newer revision and keeps the old one in its history' });
    const beforeCancel = await version();
    await clipPage.getByRole('button', { name: 'Edit clipping', exact: true }).click();
    await dialog.locator('[data-field=note]').fill('This note is never saved.');
    await cancel(); await clipPage.waitFor();
    check('cancelling an edit writes nothing', await version() === beforeCancel && (await data()).clippings.find(c => c.id === CLIPPED).note === kept.note && (await clipPage.innerText()).includes(kept.note));
    await step(page, 'clipping', 'Edit, then Cancel: nothing is written', { action: 'Edit clipping, type a new note, Cancel.', expected: 'The dialog closes; the page and the App keep the old note; the version is unchanged.', observed: await said(clipPage.locator('dl')), state: { 'clippings.list': CLIPPED + ' note “' + kept.note + '”', version: await version() }, check: 'cancelling an edit writes nothing' });
    await clipPage.getByRole('button', { name: 'Edit clipping', exact: true }).click();
    await dialog.locator('[data-field=note]').fill('Study group moved to the corrected hours.');
    await submit();
    equal('editing a clipping sends only the changed note', args(lastCall('belltower.clippings.update')), { id: CLIPPED, patch: { note: 'Study group moved to the corrected hours.' } });
    await clipPage.waitFor();
    await step(page, 'clipping', 'Edited: only the note changed', { action: 'Edit clipping, note “Study group moved to the corrected hours.”, Save clipping.', expected: 'belltower.clippings.update sends only the note.', observed: await said(clipPage.locator('dl')), state: { 'clippings.list': CLIPPED + ' note “' + (await data()).clippings.find(c => c.id === CLIPPED).note + '”', receipt: receipt('belltower.clippings.update'), version: await version() }, check: 'editing a clipping sends only the changed note' });
    await clipPage.getByRole('button', { name: 'Watch', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Watching this item.' }).waitFor(); await ready();
    kept = (await data()).clippings.find(c => c.id === CLIPPED);
    check('watching sends only the watch flag and the App now watches the clipping', JSON.stringify(args(lastCall('belltower.clippings.update'))) === JSON.stringify({ id: CLIPPED, patch: { watch: true } }) && kept.watch === true && kept.note === 'Study group moved to the corrected hours.');
    await clipPage.waitFor();
    await step(page, 'clipping', 'Watching: every later revision of the item will notify', { action: 'Watch.', expected: 'belltower.clippings.update sends only watch: true; the page says Watching.', observed: await head(clipPage), state: { 'clippings.list': CLIPPED + ' watch ' + kept.watch, receipt: receipt('belltower.clippings.update'), version: await version() }, check: 'watching sends only the watch flag and the App now watches the clipping' });
    await page.locator('#records [data-clipping-id="' + clip.id + '"]').click();
    await page.locator('.detail article[data-clipping-id="' + clip.id + '"][data-loaded="true"]').getByRole('button', { name: 'Remove clipping', exact: true }).click();
    await dialog.waitFor();
    await step(page, 'clipping', 'Remove asks first', { action: 'Clippings: open ' + clip.id + ', Remove clipping.', expected: 'A confirmation names the item and says the item and the read marks stay.', observed: await said(dialog), state: { 'clippings.list': clip.id + ' still present' } });
    await submit();
    check('removing a clipping takes it out of the App', !(await data()).clippings.some(c => c.id === clip.id));
    await step(page, 'clipping', 'Removed: the clipping is gone, the item stays', { action: 'Confirm with Remove clipping.', expected: 'belltower.clippings.remove deletes ' + clip.id + '; the item is still listed.', observed: await said(page.locator('#status')), state: { 'clippings.list': clip.id + ' absent, ' + (await data()).clippings.length + ' clippings', 'items.get': REPORT + ' still listed', receipt: receipt('belltower.clippings.remove'), version: await version() }, check: 'removing a clipping takes it out of the App' });

    // ---- W1 following ----------------------------------------------------------------------------------------------
    await nav('Following');
    const before = (await data()).follows.length;
    await page.getByRole('button', { name: 'New follow rule', exact: true }).click();
    await dialog.locator('[data-field=topics] input[value=transit]').check();
    await dialog.locator('[data-field=area_ids] input[value=ar-old-quay]').check();
    await dialog.locator('[data-field=min_priority]').selectOption('important'); await dialog.locator('[data-field=delivery]').selectOption('immediate');
    await step(page, 'follow', 'A new rule, filled in before sending', { action: 'Following: New follow rule; topic transit, area Old Quay, Important or urgent, Immediate.', expected: 'The form holds exactly these choices; nothing is written yet.', observed: 'checked: ' + (await dialog.locator('input[type=checkbox]:checked').evaluateAll(n => n.map(x => x.value))).join(', ') + ' · ' + await dialog.locator('[data-field=min_priority]').inputValue() + ' · ' + await dialog.locator('[data-field=delivery]').inputValue(), state: { 'follows.list': before + ' rules' } });
    await submit();
    let rule = (await data()).follows.find(f => f.topics.join() === 'transit' && f.area_ids.join() === 'ar-old-quay');
    equal('a follow rule made in the browser is the App\'s rule with exactly the chosen filters', rule && { s: rule.source_ids, a: rule.area_ids, t: rule.topics, p: rule.min_priority, d: rule.delivery, paused: rule.paused }, { s: [], a: ['ar-old-quay'], t: ['transit'], p: 'important', d: 'immediate', paused: false });
    const created = receipt('belltower.follows.create');
    await page.reload(); await page.locator('#records [data-follow-id="' + rule.id + '"]').waitFor();
    checks.push('a reload keeps the committed rule');
    await page.locator('#records [data-follow-id="' + rule.id + '"]').click();
    const rulePage = page.locator('.detail article[data-follow-id="' + rule.id + '"][data-loaded="true"]');
    await rulePage.waitFor();
    await step(page, 'follow', 'Sent, and still there after a reload', { action: 'Send; reload the page; open the new rule.', expected: 'belltower.follows.create writes the rule with exactly these filters; after a reload the page reads it back from the App.', observed: await head(rulePage), state: { 'follows.list': rule.id + ': topics transit, areas ar-old-quay, important, immediate, active', receipt: created, version: await version() }, check: 'a reload keeps the committed rule' });
    await rulePage.getByRole('button', { name: 'Edit rule', exact: true }).click();
    await dialog.locator('[data-field=delivery]').selectOption('digest');
    await submit();
    equal('an edit sends only the edited field', args(lastCall('belltower.follows.update')), { id: rule.id, patch: { delivery: 'digest' } });
    await rulePage.waitFor();
    await step(page, 'follow', 'Edited: a daily digest instead of at once', { action: 'Edit rule, Delivery: Daily digest, Save.', expected: 'belltower.follows.update sends only the delivery.', observed: await head(rulePage), state: { 'follows.list': rule.id + ' delivery ' + (await data()).follows.find(f => f.id === rule.id).delivery, receipt: receipt('belltower.follows.update'), version: await version() }, check: 'an edit sends only the edited field' });
    await rulePage.getByRole('button', { name: 'Edit rule', exact: true }).click();
    await mcp('follows.update', { id: rule.id, patch: { min_priority: 'urgent' }, expected_version: (await snap()).version, request_id: 'outside-edit' });
    await dialog.locator('[data-field=delivery]').selectOption('immediate');
    await dialog.locator('button[type=submit]').click();
    const staleText = await alertOf('stale_version');
    rule = (await data()).follows.find(f => f.id === rule.id);
    equal('a stale form shows the conflict and the concurrent change stands', [rule.min_priority, rule.delivery], ['urgent', 'digest']);
    await step(page, 'follow', 'A form that went stale: the conflict is shown and the other change stands', { action: 'Edit rule; meanwhile another session sets Urgent only through MCP (request outside-edit); choose Immediate and Save.', expected: 'The App answers stale_version and the form says so; the rule keeps urgent and digest.', observed: staleText, state: { 'follows.list': rule.id + ' ' + rule.min_priority + ', ' + rule.delivery, receipt: 'request outside-edit (the other session)', version: await version() }, check: 'a stale form shows the conflict and the concurrent change stands' });
    await cancel();

    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === 'belltower.follows.create' && (body.arguments.topics || []).join() === 'weather') { dropped = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'New follow rule', exact: true }).click();
    await dialog.locator('[data-field=topics] input[value=weather]').check();
    await dialog.locator('button[type=submit]').click();
    const lost = await alertOf('request_failed');
    await step(page, 'follow', 'The response is lost: the form says so and keeps its input', { action: 'New follow rule, topic weather, send. The test drops the response after the App has committed it.', expected: 'The form reports the failure and offers to send again with the same request ID.', observed: lost, state: { 'follows.list': 'weather rules: ' + (await data()).follows.filter(f => f.topics.join() === 'weather').length } });
    await submit();
    await page.unroute('**/api/call');
    const weather = (await data()).follows.filter(f => f.topics.join() === 'weather');
    equal('a retry after a lost response has one effect', weather.length, 1);
    await step(page, 'follow', 'Sent again: still one rule', { action: 'Send again.', expected: 'The retry is the same write with the same request ID: one weather rule.', observed: await said(page.locator('#status')), state: { 'follows.list': 'weather rules: ' + weather.length + ' (' + weather[0].id + ')', receipt: receipt('belltower.follows.create'), version: await version() }, check: 'a retry after a lost response has one effect' });

    const existing = (await data()).follows.find(f => f.id === 'fl-0001'), count = (await data()).follows.length;
    await page.getByRole('button', { name: 'New follow rule', exact: true }).click();
    for (const t of existing.topics) await dialog.locator('[data-field=topics] input[value=' + t + ']').check();
    for (const a of existing.area_ids) await dialog.locator('[data-field=area_ids] input[value=' + a + ']').check();
    await dialog.locator('[data-field=min_priority]').selectOption(existing.min_priority);
    await dialog.locator('button[type=submit]').click();
    const duplicate = await alertOf('already_following');
    equal('a rule that already exists is refused visibly and nothing is written', (await data()).follows.length, count);
    await step(page, 'follow', 'The same rule twice is refused', { action: 'New follow rule with the filters of fl-0001 (community and business in Millbrook North); send.', expected: 'belltower.follows.create answers already_following; nothing is written.', observed: duplicate, state: { 'follows.list': count + ' rules', version: await version() }, check: 'a rule that already exists is refused visibly and nothing is written' });
    await cancel();
    check('the new rules were added one each', count === before + 2);

    await page.locator('#records [data-follow-id="' + rule.id + '"]').click();
    await rulePage.getByRole('button', { name: 'Pause rule', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Rule paused.' }).waitFor(); await ready();
    equal('pausing sends only the paused flag', args(lastCall('belltower.follows.update')), { id: rule.id, patch: { paused: true } });
    check('the rule is paused in the App', (await data()).follows.find(f => f.id === rule.id).paused === true);
    await rulePage.waitFor();
    await step(page, 'follow', 'Paused', { action: 'Open ' + rule.id + ', Pause rule.', expected: 'belltower.follows.update sends only paused: true; the page says Paused.', observed: await head(rulePage), state: { 'follows.list': rule.id + ' paused', receipt: receipt('belltower.follows.update'), version: await version() }, check: 'the rule is paused in the App' });
    await page.locator('#records [data-follow-id="' + weather[0].id + '"]').click();
    await page.locator('.detail article[data-follow-id="' + weather[0].id + '"][data-loaded="true"]').getByRole('button', { name: 'Remove rule', exact: true }).click();
    await dialog.waitFor();
    await step(page, 'follow', 'Remove asks first', { action: 'Open ' + weather[0].id + ', Remove rule.', expected: 'A confirmation names the rule and says what stays.', observed: await said(dialog), state: { 'follows.list': weather[0].id + ' still present' } });
    await submit();
    check('removing a rule takes it out of the App', !(await data()).follows.some(f => f.id === weather[0].id));
    await step(page, 'follow', 'Removed', { action: 'Confirm with Remove rule.', expected: 'belltower.follows.remove deletes ' + weather[0].id + '.', observed: await said(page.locator('#status')), state: { 'follows.list': weather[0].id + ' absent, ' + (await data()).follows.length + ' rules', receipt: receipt('belltower.follows.remove'), version: await version() }, check: 'removing a rule takes it out of the App' });
    await shot('following');

    // ---- W4 notifications, the reading record and settings -----------------------------------------------------------
    await nav('Notifications');
    const log = (await mcp('notifications.list', { limit: 50 })).notifications;
    equal('notifications are listed newest first, as the App lists them', await page.locator('#records [data-notification-id]').evaluateAll(n => n.map(x => x.dataset.notificationId)), log.map(n => n.id));
    const superseded = log.find(n => n.state === 'superseded'), held = log.find(n => n.state === 'held');
    await page.locator('#records [data-notification-id="' + superseded.id + '"]').click();
    check('a superseded notification says it was never shown and names the one that replaced it', (await page.locator('.detail article[data-notification-id="' + superseded.id + '"]').innerText()).includes('Superseded by ' + superseded.superseded_by));
    await page.locator('#records [data-notification-id="' + held.id + '"]').click();
    check('a held notification shows its release time in the account\'s zone', (await page.locator('.detail article[data-notification-id="' + held.id + '"]').innerText()).includes('Held until ' + await inZone(held.release_at)));
    await page.locator('select[aria-label="Notification kind"]').selectOption('item.corrected');
    await page.locator('#records [data-notification-id]').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#records [data-notification-id]')].every(n => n.innerText.includes('Corrected')));
    equal('the kind filter is the App\'s filter', await page.locator('#records [data-notification-id]').evaluateAll(n => n.map(x => x.dataset.notificationId)), (await mcp('notifications.list', { kind: 'item.corrected', limit: 50 })).notifications.map(n => n.id));
    await page.locator('select[aria-label="Notification kind"]').selectOption('');
    await shot('notifications');

    await nav('Read');
    await page.locator('.detail article[data-read-view][data-loaded="true"]').waitFor();
    equal('the reading record is the App\'s, newest first', await page.locator('#records [data-mark-item-id]').evaluateAll(n => n.map(x => x.dataset.markItemId + '@' + x.dataset.revision)), (await mcp('reading.list', { limit: 100 })).marks.map(m => m.item_id + '@' + m.revision));

    await nav('Settings');
    const settings = page.locator('.detail article[data-settings][data-loaded="true"]');
    await settings.waitFor();
    await settings.locator('select[data-field=corrections]').selectOption('immediate');
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'Settings saved.' }).waitFor(); await ready();
    equal('settings send only what changed', args(lastCall('belltower.preferences.update')), { patch: { corrections: 'immediate' } });
    check('the App now delivers corrections at once', (await mcp('preferences.get')).preferences.corrections === 'immediate');
    await settings.waitFor();
    await step(page, 'settings', 'Saved: corrections and retractions at once', { action: 'Settings: Corrections and retractions, Deliver them at once; Save settings.', expected: 'belltower.preferences.update sends only corrections.', observed: await said(page.locator('#status')), state: { 'preferences.get': 'corrections ' + (await mcp('preferences.get')).preferences.corrections, receipt: receipt('belltower.preferences.update'), version: await version() }, check: 'the App now delivers corrections at once' });
    await settings.locator('input[data-field=digest_time]').fill('23:00');
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await settings.locator('[role=alert][data-code=invalid_arguments]').waitFor();
    check('a digest time inside the quiet hours is refused visibly and nothing changes', (await mcp('preferences.get')).preferences.digest_time === '18:00');
    await step(page, 'settings', 'A digest time inside the quiet hours is refused', { action: 'Digest time 23:00 (quiet hours 22:00–07:00); Save settings.', expected: 'The App answers invalid_arguments and the page says why; the digest time stays 18:00.', observed: await said(settings.locator('[role=alert]')), state: { 'preferences.get': 'digest_time ' + (await mcp('preferences.get')).preferences.digest_time, version: await version() }, check: 'a digest time inside the quiet hours is refused visibly and nothing changes' });
    await shot('settings');

    // ---- independent changes: the clock and events, through Infra only ---------------------------------------------------
    const moved = await infra.call('env.advance_time', { request_id: 'web-clock', expected_version: (await snap()).version, virtual_now: at('2026-11-17', '18:05') });
    assert.ok(['committed', 'ok'].includes(moved.status), JSON.stringify(moved));
    await refresh(); await nav('Notifications');
    await page.locator('#records [data-notification-id="' + held.id + '"] .bt-chip').filter({ hasText: 'Released' }).waitFor();
    checks.push('after a clock move by Infra alone, a held notification reads released');
    const apply = async event => { const r = await infra.call('env.apply_event', { expected_version: (await snap()).version, event }); assert.equal(r.status, 'committed', JSON.stringify(r)); };
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    await apply(scenario);
    await nav('News'); await refresh();
    equal('after Refresh the news list shows an item that arrived as a scenario event', (await listIds())[0], scenario.payload.item_id);
    await openItem(scenario.payload.item_id);
    const copied = itemPage(scenario.payload.item_id).locator('section[aria-label="Based on"][data-loaded="true"]');
    await copied.waitFor();
    check('the new copy names the revision it copied while its source has a newer one', (await copied.innerText()).includes('copies revision 1') && (await copied.innerText()).includes('has 2 revisions now'));
    const hostile = '<img src=x onerror="window.injected=true">';
    await apply({ event_id: 'web-hostile', at: at('2026-11-18', '06:20'), operation: 'belltower.item.published', payload: { item_id: 'it-web-0001', source_id: 'src-courier', kind: 'article',
      revision: { number: 1, published_at: at('2026-11-18', '06:20'), headline: 'Market hours ' + hostile, body: 'Stalls open early. ' + hostile, topics: ['community'], area_ids: ['ar-old-quay'], priority: 'routine' } } });
    await refresh(); await openItem('it-web-0001');
    check('untrusted text is shown as text and never executed', (await page.locator('.detail').innerText()).includes(hostile) && !(await page.evaluate(() => window.injected)) && await page.locator('.detail img').count() === 0);

    // ---- a correction and a retraction from their publishers, as events through Infra ---------------------------------
    const CLINIC = 'it-cour-0907', CLINIC_CLIP = 'clp-0003', MARKET = 'it-ledg-0427', MARKET_CLIP = 'clp-0002';
    const clippingPage = id => page.locator('.detail article[data-clipping-id="' + id + '"][data-loaded="true"]');
    const openClipping = async id => { await page.locator('#records [data-clipping-id="' + id + '"]').click(); await clippingPage(id).waitFor(); };
    const dd = (article, label) => article.evaluate((a, l) => { const t = [...a.querySelectorAll('dl dt')].find(x => x.innerText.trim() === l); return t ? l + ': ' + t.nextElementSibling.innerText.trim() : ''; }, label);
    await nav('Clippings'); await openClipping(CLINIC_CLIP);
    const clinic1 = (await mcp('items.get', { id: CLINIC })).item, clinicKept = (await data()).clippings.find(c => c.id === CLINIC_CLIP);
    check('the watched clipping holds the clinic article\'s only revision', clinicKept.revision === 1 && clinicKept.watch === true && clinic1.latest_revision === 1);
    await step(page, 'correction', 'Start: a watched clipping with a personal note', { action: 'Clippings: open ' + CLINIC_CLIP + ' (“' + clinic1.headline + '”).', expected: 'The clipping holds revision 1 of 1, is watched and keeps the note about Mum\'s appointment.', observed: await head(clippingPage(CLINIC_CLIP)) + ' · ' + await dd(clippingPage(CLINIC_CLIP), 'Note'), state: { 'clippings.list': CLINIC_CLIP + ' revision ' + clinicKept.revision + ', watch ' + clinicKept.watch, 'items.get': CLINIC + ' latest revision ' + clinic1.latest_revision + ', last read revision ' + clinic1.last_read_revision }, check: 'the watched clipping holds the clinic article\'s only revision' });
    const correction = { event_id: 'web-correction', at: at('2026-11-18', '08:10'), operation: 'belltower.item.corrected', payload: { item_id: CLINIC, revision: { number: 2, published_at: at('2026-11-18', '08:00'),
      note: 'Corrects the closing date: the clinic closes on 31 January, not 18 December.', headline: 'Riverside Clinic to close at the end of January, board papers show',
      body: 'Riverside Clinic in Millbrook South will close on 31 January and move its patients to the Northgate clinic, according to board papers seen by the Courier. Appointments booked at Riverside before then go ahead there.',
      topics: ['health'], area_ids: ['ar-millbrook-south'], priority: 'important' } } };
    await apply(correction); await refresh();
    await clippingPage(CLINIC_CLIP).locator('section[aria-label="Newer revision"]').waitFor();
    const clinic2 = (await mcp('items.get', { id: CLINIC })).item;
    check('after Refresh the watched clipping says its item was corrected, with the publisher\'s note', clinic2.latest_revision === 2 && (await clippingPage(CLINIC_CLIP).locator('section[aria-label="Newer revision"]').innerText()).includes(correction.payload.revision.note));
    await step(page, 'correction', 'The publisher corrects the article: the clipping says so', { action: 'Infra applies belltower.item.corrected (event web-correction: revision 2 with the publisher\'s note); Refresh.', expected: 'The clipping still holds revision 1 and says that revision 2 (a correction) arrived, quoting the publisher\'s note.', observed: await head(clippingPage(CLINIC_CLIP)), state: { 'env.event_status': 'web-correction ' + (await infra.call('env.event_status', { event_id: 'web-correction' })).receipt.status, 'items.get': CLINIC + ' latest revision ' + clinic2.latest_revision + ' (' + clinic2.type + ')', version: await version() }, check: 'after Refresh the watched clipping says its item was corrected, with the publisher\'s note' });
    await nav('Notifications');
    const told = (await mcp('notifications.list', { limit: 1 })).notifications[0], toldPage = page.locator('.detail article[data-notification-id="' + told.id + '"]');
    await page.locator('#records [data-notification-id="' + told.id + '"]').click(); await toldPage.waitFor();
    check('the correction is released at once because the clipping is watched', told.item_id === CLINIC && told.kind === 'item.corrected' && told.state === 'released' && told.delivery === 'immediate' && told.reasons.includes('watched_clipping'));
    await step(page, 'correction', 'The notification: released at once because the clipping is watched', { action: 'Notifications: open the newest notification.', expected: 'A Corrected notification for revision 2, released at once, written because the clipping is watched.', observed: await head(toldPage) + ' · ' + await dd(toldPage, 'Why'), state: { 'notifications.list': told.id + ' ' + told.kind + ', ' + told.state + ', ' + told.delivery + ', reasons ' + told.reasons.join(', ') }, check: 'the correction is released at once because the clipping is watched' });
    await toldPage.getByRole('button', { name: 'Open revision 2', exact: true }).click();
    await itemPage(CLINIC).locator('section[aria-label="Revision text"][data-revision="2"]').waitFor(); await ready();
    await itemPage(CLINIC).getByRole('button', { name: 'Mark revision 2 as read', exact: true }).click();
    await page.locator('#status').filter({ hasText: 'marked as read' }).waitFor(); await ready();
    check('the corrected revision is marked as read from the page the notification opened', (await data()).read_marks.some(m => m.item_id === CLINIC && m.revision === 2));
    await itemPage(CLINIC).waitFor();
    await step(page, 'correction', 'Opened from the notification and marked as read', { action: 'Open revision 2, then Mark revision 2 as read.', expected: 'The article at revision 2 under the publisher\'s correction note; belltower.reading.mark records revision 2.', observed: await head(itemPage(CLINIC)) + ' · ' + await said(page.locator('#status')), state: { 'reading.list': (await mcp('reading.list', { limit: 1 })).marks.map(m => m.item_id + '@' + m.revision).join(), receipt: receipt('belltower.reading.mark'), version: await version() }, check: 'the corrected revision is marked as read from the page the notification opened' });
    const newNote = 'Closing moved to 31 January: Mum\'s 3 December appointment can stay at Riverside.';
    await nav('Clippings'); await openClipping(CLINIC_CLIP);
    await clippingPage(CLINIC_CLIP).getByRole('button', { name: 'Edit clipping', exact: true }).click();
    await dialog.locator('select[data-field=revision]').selectOption('2');
    await dialog.locator('[data-field=note]').fill(newNote);
    await step(page, 'correction', 'Edit the clipping: take the corrected revision and rewrite the note', { action: 'Clippings: open ' + CLINIC_CLIP + ', Edit clipping; Revision: Move to revision 2 (correction); a new note.', expected: 'The form offers only newer revisions; nothing is written until it is saved.', observed: await said(dialog.locator('select[data-field=revision] option:checked')) + ' · ' + await dialog.locator('[data-field=note]').inputValue(), state: { 'clippings.list': CLINIC_CLIP + ' revision ' + (await data()).clippings.find(c => c.id === CLINIC_CLIP).revision } });
    await submit();
    const clinicNow = (await data()).clippings.find(c => c.id === CLINIC_CLIP);
    equal('the edit sends the new revision and the new note together', args(lastCall('belltower.clippings.update')), { id: CLINIC_CLIP, patch: { revision: 2, note: newNote } });
    check('the clipping holds the corrected revision with the new note and keeps revision 1 and its note in its history', clinicNow.revision === 2 && clinicNow.note === newNote && clinicNow.history.at(-1).revision === 1 && clinicNow.history.at(-1).note === clinicKept.note);
    await clippingPage(CLINIC_CLIP).waitFor();
    await step(page, 'correction', 'Saved: revision 2 with the new note; revision 1 and the old note stay in its history', { action: 'Save clipping.', expected: 'belltower.clippings.update sends the revision and the note together; the clipping is current; its history keeps revision 1 with the old note.', observed: await head(clippingPage(CLINIC_CLIP)) + ' · ' + await said(clippingPage(CLINIC_CLIP).locator('section[aria-label="Clipping history"]')), state: { 'clippings.list': CLINIC_CLIP + ' revision ' + clinicNow.revision + ', note “' + clinicNow.note + '”, history: revision ' + clinicNow.history.map(h => h.revision).join(', '), receipt: receipt('belltower.clippings.update'), version: await version() }, check: 'the clipping holds the corrected revision with the new note and keeps revision 1 and its note in its history' });
    await page.reload(); await page.locator('#records [data-clipping-id="' + CLINIC_CLIP + '"]').waitFor();
    await openClipping(CLINIC_CLIP);
    check('after a reload the clipping still holds the corrected revision', (await clippingPage(CLINIC_CLIP).locator('dl').innerText()).includes('Revision 2 of 2') && (await clippingPage(CLINIC_CLIP).locator('dl').innerText()).includes(newNote));
    await step(page, 'correction', 'After a reload: read back from the App', { action: 'Reload the page; open ' + CLINIC_CLIP + '.', expected: 'The clipping holds revision 2 of 2 with the new note.', observed: await said(clippingPage(CLINIC_CLIP).locator('dl')), state: { 'clippings.list': CLINIC_CLIP + ' revision ' + (await mcp('clippings.list', { id: CLINIC })).clippings[0].revision }, check: 'after a reload the clipping still holds the corrected revision' });

    await openClipping(MARKET_CLIP);
    const market1 = (await mcp('items.get', { id: MARKET })).item, notesBefore = (await mcp('notifications.list', { id: MARKET, limit: 50 })).notifications.length;
    await step(page, 'retraction', 'Start: a clipping of the market list, not watched', { action: 'Clippings: open ' + MARKET_CLIP + ' (“' + market1.headline + '”).', expected: 'The clipping holds revision 1 of 1 with its note; it is not watched.', observed: await head(clippingPage(MARKET_CLIP)) + ' · ' + await dd(clippingPage(MARKET_CLIP), 'Note'), state: { 'clippings.list': MARKET_CLIP + ' revision 1, watch false', 'items.get': MARKET + ' latest revision ' + market1.latest_revision } });
    const retraction = { event_id: 'web-retraction', at: at('2026-11-18', '08:20'), operation: 'belltower.item.retracted', payload: { item_id: MARKET, revision: { number: 2, published_at: at('2026-11-18', '08:15'),
      note: 'This list was last month\'s and was published in error; this week\'s traders have not been announced yet.' } } };
    await apply(retraction); await refresh();
    await clippingPage(MARKET_CLIP).locator('section[aria-label="Newer revision"]').waitFor();
    const market2 = (await mcp('items.get', { id: MARKET })).item, notesAfter = (await mcp('notifications.list', { id: MARKET, limit: 50 })).notifications.length;
    check('after Refresh the clipping of a retracted item keeps the text it held and quotes the retraction', market2.latest_revision === 2 && market2.status === 'retracted' && (await clippingPage(MARKET_CLIP).locator('section[aria-label="Newer revision"]').innerText()).includes(retraction.payload.revision.note) && (await clippingPage(MARKET_CLIP).locator('section[aria-label="Clipped text"]').innerText()).includes('cheese stall'));
    check('a retraction of an item that no rule matches and no watched clipping holds writes no notification', notesAfter === notesBefore);
    await step(page, 'retraction', 'The publisher retracts it: the clipping keeps the text it held', { action: 'Infra applies belltower.item.retracted (event web-retraction, with the publisher\'s note); Refresh.', expected: 'The clipping still holds revision 1 and its text, and says that revision 2 (a retraction) arrived, quoting the note. No notification is written: no rule matches the item and the clipping is not watched.', observed: await head(clippingPage(MARKET_CLIP)), state: { 'env.event_status': 'web-retraction ' + (await infra.call('env.event_status', { event_id: 'web-retraction' })).receipt.status, 'items.get': MARKET + ' latest revision ' + market2.latest_revision + ', ' + market2.status, 'notifications.list': 'for ' + MARKET + ': ' + notesAfter + ' (before: ' + notesBefore + ')', version: await version() }, check: 'after Refresh the clipping of a retracted item keeps the text it held and quotes the retraction' });
    await nav('News'); await openItem(MARKET);
    check('the retracted item shows the publisher\'s note and no text of its own', (await itemPage(MARKET).locator('section[aria-label="Retraction"]').innerText()).includes(retraction.payload.revision.note) && (await itemPage(MARKET).locator('section[aria-label="Revision text"]').innerText()).includes('No text in this revision.') && (await page.locator('#records [data-record-id="' + MARKET + '"]').innerText()).includes('Retracted'));
    await step(page, 'retraction', 'The item: retracted, with the note and no text of its own', { action: 'News: open “' + market1.headline + '”.', expected: 'The list row says Retracted; the page shows the publisher\'s note and no text for revision 2.', observed: await head(itemPage(MARKET)) + ' · ' + await said(page.locator('#records [data-record-id="' + MARKET + '"]')), state: { 'items.get': MARKET + ' revision ' + market2.latest_revision + ' (' + market2.type + ')' }, check: 'the retracted item shows the publisher\'s note and no text of its own' });
    await itemPage(MARKET).locator('button.bt-rev[data-revision="1"]').click();
    await itemPage(MARKET).locator('section[aria-label="Revision text"][data-revision="1"]').waitFor();
    check('revision 1 of the retracted item stays readable', (await itemPage(MARKET).locator('section[aria-label="Revision text"]').innerText()).includes('cheese stall'));
    await step(page, 'retraction', 'Revision 1 stays readable', { action: 'Click revision 1.', expected: 'The page says it shows revision 1 of 2 and shows that revision\'s text.', observed: await said(itemPage(MARKET).locator('section[aria-label="Earlier revision"]')) + ' · ' + (await said(itemPage(MARKET).locator('section[aria-label="Revision text"]'))).slice(0, 180), state: { 'items.get': MARKET + ' revision 1: “' + market1.headline + '”' }, check: 'revision 1 of the retracted item stays readable' });
    await nav('Clippings'); await openClipping(MARKET_CLIP);
    await clippingPage(MARKET_CLIP).getByRole('button', { name: 'Remove clipping', exact: true }).click();
    await dialog.waitFor();
    await step(page, 'retraction', 'Remove the clipping: the dialog asks first', { action: 'Clippings: open ' + MARKET_CLIP + ', Remove clipping.', expected: 'A confirmation names the item and says the item and the read marks stay.', observed: await said(dialog), state: { 'clippings.list': MARKET_CLIP + ' still present' } });
    await submit();
    const marketAfter = (await mcp('items.get', { id: MARKET })).item;
    check('removing the clipping of a retracted item leaves the item and its revisions', !(await data()).clippings.some(c => c.id === MARKET_CLIP) && marketAfter.latest_revision === 2 && marketAfter.status === 'retracted');
    await step(page, 'retraction', 'Removed: the clipping is gone; the retracted item keeps both revisions', { action: 'Confirm with Remove clipping.', expected: 'belltower.clippings.remove deletes ' + MARKET_CLIP + '; the item keeps both revisions.', observed: await said(page.locator('#status')), state: { 'clippings.list': MARKET_CLIP + ' absent', 'items.get': MARKET + ' ' + marketAfter.latest_revision + ' revisions, ' + marketAfter.status, receipt: receipt('belltower.clippings.remove'), version: await version() }, check: 'removing the clipping of a retracted item leaves the item and its revisions' });

    const denied = await page.evaluate(async () => { const { csrf } = await (await fetch('/session')).json(); return (await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name: 'env.snapshot', arguments: {} }) })).status; });
    equal('a management request from the business session is denied', denied, 403);
    for (const section of ['News', 'Following', 'Clippings', 'Notifications', 'Read', 'Settings']) {
      await page.setViewportSize({ width: 390, height: 844 }); await nav(section); await page.locator('.detail [data-loaded="true"]').first().waitFor();
      check('no horizontal page overflow on a narrow screen: ' + section, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await shot('narrow');
    await page.setViewportSize({ width: 1360, height: 960 });
    equal('no JavaScript errors in the browser', errors, []);
    await context.close();

    // ---- a Task-like policy: only what the scenario profile allows -------------------------------------------------
    restricted = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'restricted', profile: 'scenario' });
    restrictedInfra = new Client(prepared.app, 'infra', restricted.run, stateDir, 'belltower-web-inspector', { registry: prepared.registry });
    await restrictedInfra.initialize();
    const rdata = async () => (await restrictedInfra.call('env.snapshot')).snapshot.data;
    const rcontext = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), rpage = await rcontext.newPage();
    rpage.setDefaultTimeout(10000); pages.push(rpage);
    const rerrors = [];
    rpage.on('pageerror', e => rerrors.push(e.message));
    await rpage.goto(restricted.accessUrl); await rpage.locator('#records .record').first().waitFor(); await rpage.locator('#app[aria-busy=false]').waitFor();
    const rready = () => rpage.locator('#app[aria-busy=false]').waitFor();
    const ritem = id => rpage.locator('.detail article[data-item-id="' + id + '"][data-loaded="true"]');
    const ropen = async id => { await rpage.locator('#records [data-record-id="' + id + '"]').click(); await ritem(id).waitFor(); };
    const rnav = async name => { await rpage.locator('nav').getByRole('button', { name: new RegExp(name) }).click(); await rready(); };
    await ropen(BULLETIN);
    await ritem(BULLETIN).getByRole('button', { name: 'Mark revision 1 as read', exact: true }).click();
    await rpage.locator('#status[data-error="true"]').waitFor();
    check('a write the policy refuses is shown as refused and changes nothing', (await rpage.locator('#status').innerText()).includes('not allowed') && !(await rdata()).read_marks.some(m => m.item_id === BULLETIN));
    await step(rpage, 'restricted-policy', 'Under a Task-like policy a refused write says so', { action: 'A second run with the scenario profile: open ' + BULLETIN + ', Mark revision 1 as read.', expected: 'The policy does not allow this item: the page says the action is not allowed; nothing is written.', observed: await said(rpage.locator('#status')), state: { 'reading.list': 'marks for ' + BULLETIN + ': ' + (await rdata()).read_marks.filter(m => m.item_id === BULLETIN).length }, check: 'a write the policy refuses is shown as refused and changes nothing' });
    await ropen(BRIDGE);
    await ritem(BRIDGE).getByRole('button', { name: 'Mark revision 2 as read', exact: true }).click();
    await rpage.locator('#status').filter({ hasText: 'marked as read' }).waitFor();
    check('a read mark on an allowed item is recorded', (await rdata()).read_marks.some(m => m.item_id === BRIDGE && m.revision === 2));
    await rnav('Following');
    check('controls the policy does not offer are absent', await rpage.getByRole('button', { name: 'New follow rule', exact: true }).count() === 0 && await rpage.getByRole('button', { name: 'Remove rule', exact: true }).count() === 0);
    await rpage.locator('#records [data-follow-id="fl-0004"]').click();
    const rrule = rpage.locator('.detail article[data-follow-id="fl-0004"][data-loaded="true"]');
    await rrule.getByRole('button', { name: 'Pause rule', exact: true }).click();
    await rpage.locator('#status').filter({ hasText: 'Rule paused.' }).waitFor(); await rready();
    check('the allowed rule can be paused', (await rdata()).follows.find(f => f.id === 'fl-0004').paused === true);
    await rrule.getByRole('button', { name: 'Edit rule', exact: true }).click();
    const rdialog = rpage.locator('dialog.bt-dialog');
    await rdialog.locator('[data-field=topics] input[value=health]').check();
    await rdialog.locator('button[type=submit]').click();
    await rdialog.locator('[role=alert][data-code=permission_denied]').waitFor();
    await step(rpage, 'restricted-policy', 'A change outside the allowed fields is refused', { action: 'Following: open fl-0004 (pausing it is allowed and was done), Edit rule, add the topic health, send.', expected: 'The App answers permission_denied and the form says so; the rule keeps its topics.', observed: await said(rdialog.locator('[role=alert]')), state: { 'follows.list': 'fl-0004 topics ' + (await rdata()).follows.find(f => f.id === 'fl-0004').topics.join(', ') + ', paused ' + (await rdata()).follows.find(f => f.id === 'fl-0004').paused }, check: 'a change outside the allowed fields is refused' });
    await rdialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await rdialog.waitFor({ state: 'detached' });
    check('a change outside the allowed fields is refused', !(await rdata()).follows.find(f => f.id === 'fl-0004').topics.includes('health'));
    await rnav('Clippings');
    check('a clipping cannot be removed under this policy', await rpage.getByRole('button', { name: 'Remove clipping', exact: true }).count() === 0);
    await rnav('Settings');
    const rsettings = rpage.locator('.detail article[data-settings][data-loaded="true"]');
    await rsettings.waitFor();
    await rsettings.locator('input[data-field=timezone]').fill('America/Denver');
    await rsettings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await rsettings.locator('[role=alert][data-code=permission_denied]').waitFor();
    check('a settings change outside the allowed fields is refused', (await rdata()).preferences.timezone === ZONE);
    equal('no JavaScript errors under the restricted policy', rerrors, []);
    await rcontext.close();

    // ---- the full-window evaluation dataset in the same pages --------------------------------------------------------
    full = await start({ app: prepared.app, registry: prepared.registry, stateDir, run: 'full-window', profile: 'sandbox' });
    fullInfra = new Client(prepared.app, 'infra', full.run, stateDir, 'belltower-web-dataset', { registry: prepared.registry });
    await fullInfra.initialize();
    const fwDir = path.join(appDir, 'datasets/full-window'), fwClock = JSON.parse(fs.readFileSync(path.join(fwDir, 'clock.json'), 'utf8')).initial_time;
    const fwLoad = await fullInfra.call('env.load_seed', { expected_version: (await fullInfra.call('env.snapshot')).version, data: JSON.parse(fs.readFileSync(path.join(fwDir, 'seed.json'), 'utf8')), virtual_now: fwClock, request_id: 'web-full-window' });
    assert.equal(fwLoad.status, 'ready', JSON.stringify(fwLoad).slice(0, 300));
    const fcontext = await browser.newContext({ viewport: { width: 1360, height: 960 }, timezoneId: 'Asia/Tokyo' }), fpage = await fcontext.newPage();
    fpage.setDefaultTimeout(30000); pages.push(fpage);
    const ferrors = [];
    fpage.on('pageerror', e => ferrors.push(e.message));
    const fready = () => fpage.locator('#app[aria-busy=false]').waitFor();
    const fmcp = async (name, a = {}) => { const r = await full.client.call('belltower.' + name, a); assert.equal(r.status, 'ok', name); return r; };
    const fitem = id => fpage.locator('.detail article[data-item-id="' + id + '"][data-loaded="true"]');
    const fopen = async id => { await fpage.locator('#records [data-record-id="' + id + '"]').click(); await fitem(id).waitFor(); };
    const fsearch = async words => { await fpage.locator('.toolbar input[type=search]').fill(words); await fready(); };
    await fpage.goto(full.accessUrl); await fpage.locator('#records .record').first().waitFor(); await fready();
    const newest = (await fmcp('items.list', { limit: 5 })).items;
    await fopen(newest[0].id);
    equal('on the full-window dataset the news list opens on the newest items at the dataset clock', (await fpage.locator('#records [data-record-id]').evaluateAll(n => n.map(x => x.dataset.recordId))).slice(0, 5), newest.map(i => i.id));
    await step(fpage, 'full-window', 'Two years of news: the list opens on the newest items at the dataset clock', { action: 'A third run: Infra loads datasets/full-window with env.load_seed at its clock (' + fwClock + '); open the access link and the first item.', expected: 'The news list starts with the newest items, ' + newest[0].id + ' first.', observed: await head(fitem(newest[0].id)), state: { 'env.load_seed': fwLoad.status + ', ' + fwLoad.loaded + ' records', 'items.list': 'first ' + newest.slice(0, 3).map(i => i.id).join(', ') }, check: 'on the full-window dataset the news list opens on the newest items at the dataset clock' });
    const OLDEST = 'it-city-25001', SCHEDULED = 'it-works-26078';
    await fsearch('Mill Road'); await fopen(OLDEST);
    const oldest = (await fmcp('items.get', { id: OLDEST })).item;
    check('the oldest item of the dataset opens with its year shown', oldest.received_at.startsWith('2025-01-01') && (await fitem(OLDEST).innerText()).includes('2025'));
    await step(fpage, 'full-window', 'The oldest item, from 1 January 2025, with its year shown', { action: 'Search “Mill Road”; open ' + OLDEST + '.', expected: 'The item received ' + oldest.received_at + '; a date outside the clock\'s year shows its year.', observed: await head(fitem(OLDEST)) + ' · ' + (await said(fitem(OLDEST).locator('section[aria-label="Revision text"]'))).slice(0, 140), state: { 'items.get': OLDEST + ' received ' + oldest.received_at }, check: 'the oldest item of the dataset opens with its year shown' });
    await fsearch('Riverside Drive'); await fopen(SCHEDULED);
    const scheduled = (await fmcp('items.get', { id: SCHEDULED })).item, coverage = JSON.parse(fs.readFileSync(path.join(fwDir, 'coverage.json'), 'utf8'));
    check('a closure that starts after the dataset clock is shown as upcoming', scheduled.effect === 'upcoming' && (await head(fitem(SCHEDULED))).includes('Upcoming'));
    await step(fpage, 'full-window', 'A closure that starts after the clock: upcoming, not history', { action: 'Search “Riverside Drive”; open ' + SCHEDULED + '.', expected: 'The notice is Upcoming: its period starts ' + scheduled.effective.start + ', after the clock. The coverage report counts the date it was received, not the dates it announces.', observed: await head(fitem(SCHEDULED)), state: { 'items.get': SCHEDULED + ' received ' + scheduled.received_at + ', effective ' + scheduled.effective.start + ' to ' + scheduled.effective.end + ', ' + scheduled.effect, 'coverage.json': coverage.effective_periods.starting_after_clock + ' notices start after the clock; effective periods are excluded from every count' }, check: 'a closure that starts after the dataset clock is shown as upcoming' });
    equal('no JavaScript errors on the full-window dataset', ferrors, []);
    await fcontext.close();

    const report = { schema: 'belltower.web-check.v1', passed: true, recorded_at: new Date().toISOString(), node: process.version, browser: browser.version(), runtime: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      package_sha256: digestTree(appDir), duration_ms: Date.now() - started, checks: checks.length, names: checks, screenshots };
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + '\n'); }
    if (evidence) {
      for (const x of sequences) if (x.check) assert.ok(checks.includes(x.check), 'evidence step names a check of this run: ' + x.check);
      fs.writeFileSync(path.join(evidence, 'sequences.json'), JSON.stringify({
        schema: 'belltower.web-evidence.v1', app_version: JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8')).version, package_sha256_without_evidence: digestWithout(appDir, 'evidence'),
        runtime: report.runtime, node: process.version, browser: 'Chrome ' + browser.version() + ', headless', viewport: '1360x960 (narrow checks at 390x844)', browser_time_zone: 'Asia/Tokyo', account_time_zone: ZONE,
        runs: { browser: 'sandbox profile, fixtures/minimal.json, account belltower-dana (Dana Reyes), clock 2026-11-17T17:00:00-06:00', restricted: 'scenario profile, same fixture', 'full-window': 'sandbox profile, datasets/full-window loaded by Infra at its clock' },
        test: 'tests/web.browser.cjs', checks: checks.length, steps: sequences,
      }, null, 2) + '\n');
    }
    console.log('PASS: ' + checks.length + ' browser checks (' + browser.version() + ').' + (evidence ? ' Evidence: ' + sequences.length + ' steps.' : ''));
  } catch (e) {
    console.error('FAIL after ' + checks.length + ' checks: ' + (e.stack || e));
    if (shots) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(shots, 'failed-' + i + '.png'), fullPage: true }).catch(() => {});
    if (opts.report) { fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true }); fs.writeFileSync(opts.report, JSON.stringify({ schema: 'belltower.web-check.v1', passed: false, checks: checks.length, names: checks, error: String(e.message || e) }, null, 2) + '\n'); }
    process.exitCode = 1;
  } finally {
    await infra?.close().catch(() => {}); await restrictedInfra?.close().catch(() => {}); await fullInfra?.close().catch(() => {}); await full?.close().catch(() => {});
    await host?.close().catch(() => {}); await restricted?.close().catch(() => {}); await browser?.close().catch(() => {});
    prepared.cleanup();
  }
}
main();
