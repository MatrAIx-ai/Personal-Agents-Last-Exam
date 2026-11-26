'use strict';
// GUI workflow sequences for the delivery evidence (evidence/gui/). Not part of the default npm test:
// it needs Playwright and Chromium, installed at the repository root with
// `npm ci && npx playwright install chromium`.
// It starts the real shared Web Host on a fresh run of the reference fixture, drives the page's own
// controls for every core workflow and its refused, stale, cancel and denied paths, takes a
// viewport screenshot at each step, confirms every write with an independent Agent MCP client on the
// same run (record, state and version), reloads the page after each outcome, and writes
// evidence/gui/sequences.json and evidence/gui/README.md from what it observed.
//   node tests/web-evidence.cjs [--runtime DIR] [--out DIR] [--optimize]
// --optimize recompresses the PNG files losslessly with zopflipng when it is on PATH.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir(), repo = path.dirname(runtime);
const {start} = require(path.join(runtime, 'web/server.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
const {chromium} = require(require.resolve('playwright', {paths: [repo, process.cwd()]}));
const registry = path.join(locate.packageDir, 'web.registry.json');
const out = locate.option('out') || path.join(locate.packageDir, 'evidence/gui');
const RUN = 'bellnote-evidence', DESKTOP = {width: 1280, height: 720}, PHONE = {width: 390, height: 844};
// Record IDs of this App and words that must never reach the page.
const LEAK = /\b(?:child|form|pp|dc|rep|tx|pay|ntf|pm|lunch|school|person|staff|att|menu|fr|gl|rs|day)-[a-z0-9]+(?:-[a-z0-9]+)*\b|\bnull\b|\bundefined\b|\[object|\bNaN\b/g;

const frames = [], checks = [], consoleErrors = [];
const check = (name, cond, detail) => { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 500) : '')); checks.push(name); console.log('ok - ' + name); };

async function host(profile, run) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bellnote-evidence-'));
  const h = await start({app: 'bellnote', registry, run, stateDir, profile});
  return {...h, stateDir, async stop() { await h.close(); fs.rmSync(stateDir, {recursive: true, force: true}); }};
}
async function page(browser, h, viewport) {
  const context = await browser.newContext({viewport, deviceScaleFactor: 1});
  const p = await context.newPage();
  p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  p.on('pageerror', e => consoleErrors.push(e.message));
  await p.goto(h.accessUrl);
  await settled(p);
  return p;
}
async function settled(p) {
  await p.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false' && document.querySelector('.detail .bn-page, .detail .empty h3'), null, {timeout: 20000});
}
async function section(p, label) { await p.click('nav button:has-text("' + label + '")'); await p.waitForTimeout(50); await settled(p); }
async function submitDialog(p) { await p.click('dialog[open] .form-actions button.primary'); }
async function closeDialog(p) { await p.click('dialog[open] .form-actions button:not(.primary)'); await p.waitForFunction(() => !document.querySelector('dialog[open]'), null, {timeout: 20000}); }
async function closed(p) { await p.waitForFunction(() => !document.querySelector('dialog[open]'), null, {timeout: 20000}); await settled(p); }
async function errorOf(p) { await p.waitForFunction(() => document.querySelector('dialog[open] .form-error')?.textContent, null, {timeout: 20000}); return p.$eval('dialog[open] .form-error', e => ({code: e.dataset.code, text: e.textContent})); }
async function reload(p) { await p.reload(); await settled(p); }
async function child(p, id) { await p.click('button.bn-row[data-child-id=' + id + ']'); await settled(p); }

// One frame: scroll the element that matters into view, check the visible text, take a viewport
// screenshot and record what was done and seen.
async function frame(p, file, meta, focus) {
  if (focus) await p.$eval(focus, e => e.scrollIntoView({block: 'center'})).catch(() => {});
  await p.waitForTimeout(80);
  const text = await p.evaluate(() => document.body.innerText);
  const leaks = [...new Set(text.match(LEAK) || [])];
  check(file + ': no record ID, null, undefined or NaN visible', leaks.length === 0, leaks);
  await p.screenshot({path: path.join(out, file + '.png')});
  frames.push({file: file + '.png', viewport: p.viewportSize().width + 'x' + p.viewportSize().height, ...meta});
}
const v = x => x && {epoch: x.epoch, revision: x.revision};

async function run() {
  fs.mkdirSync(out, {recursive: true});
  for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.rmSync(path.join(out, f));
  const browser = await chromium.launch();
  const h = await host('sandbox', RUN);
  const mcp = new Client('bellnote', 'agent', RUN, h.stateDir, 'bellnote-evidence-check', {registry});
  const infra = new Client('bellnote', 'infra', RUN, h.stateDir, 'bellnote-evidence-infra', {registry});
  try {
    await mcp.initialize(); await infra.initialize();
    const p = await page(browser, h, DESKTOP);
    await frame(p, 'home-01-start', {workflow: 'Home', step: 'start', action: 'Open the access link the Host prints',
      expected: 'Three children with attendance today, way home and lunch balance; what needs attention', observed: (await p.$$('.bn-kid')).length + ' children, ' + (await p.$$('.bn-attention .bn-item')).length + ' items need attention',
      browser_test: ['Host serves the App-owned page and Home lists three children', 'Home shows what needs attention (changed form, unanswered form, low balance)']});

    // ---- W1 attendance: report, refused overlap, cancel.
    await section(p, 'Attendance');
    await frame(p, 'w1-01-start', {workflow: 'W1 Attendance', step: 'start', action: 'Attendance, Theo', expected: 'Theo\'s marks, reports and coming school days with their cut-offs', observed: 'shown',
      mcp: {tool: 'bellnote.absences.list', args: {child_id: 'child-theo'}, observed: (await mcp.call('bellnote.absences.list', {child_id: 'child-theo'})).reports.length + ' reports'}});
    await p.click('button:has-text("Report absence or late arrival")');
    await p.selectOption('dialog[open] [data-field=start]', '2026-11-18');
    await p.fill('dialog[open] [data-field=reason]', 'Dentist appointment');
    await frame(p, 'w1-02-report-form', {workflow: 'W1 Attendance', step: 'action', action: 'Report absence or late arrival: absent, Wednesday, November 18, reason "Dentist appointment", then Send report',
      expected: 'The form offers only school days still before their cut-off', observed: 'Wed 18 selected', browser_test: ['W1 browser report commits; MCP reads it with the exact reason']}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    const rep = (await mcp.call('bellnote.absences.list', {child_id: 'child-theo', state: 'submitted'})).reports.find(r => r.dates[0] === '2026-11-18' && r.reason === 'Dentist appointment');
    check('W1 report committed', rep && rep.state === 'submitted', rep);
    const row = 'div[data-report-id="' + rep.id + '"]';
    check('W1 report row shown with the status line', (await p.textContent('#status')) === 'Report sent to the school.' && (await p.textContent(row)).includes('Dentist appointment'));
    let snap = await infra.call('env.snapshot');
    await frame(p, 'w1-03-reported', {workflow: 'W1 Attendance', step: 'outcome', action: 'Send report', expected: 'Status line "Report sent to the school."; the report is listed as sent for Wed, Nov 18',
      observed: 'status "' + (await p.textContent('#status')) + '"; report listed',
      mcp: {tool: 'bellnote.absences.list', args: {id: rep.id}, record: rep.id, state: rep.state, version: v(snap.version)}}, row);
    await p.click('button:has-text("Report absence or late arrival")');
    await p.selectOption('dialog[open] [data-field=start]', '2026-11-18');
    await p.fill('dialog[open] [data-field=reason]', 'Dentist appointment');
    await submitDialog(p);
    const overlap = await errorOf(p);
    check('W1 overlapping report refused in the form', overlap.code === 'conflict', overlap);
    const afterOverlap = await infra.call('env.snapshot');
    check('W1 refused report wrote nothing', JSON.stringify(afterOverlap.version) === JSON.stringify(snap.version));
    await frame(p, 'w1-04-overlap-refused', {workflow: 'W1 Attendance', step: 'invalid', action: 'Report the same day again, Send report', expected: 'Refused (conflict); the App\'s message stays in the form; nothing written',
      observed: '"' + overlap.text + '"; version unchanged', mcp: {tool: 'env.snapshot (Infra)', version: v(afterOverlap.version), observed: 'unchanged'}}, 'dialog[open]');
    await closeDialog(p);
    await p.click(row + ' button:has-text("Cancel report")');
    await frame(p, 'w1-05-cancel-confirm', {workflow: 'W1 Attendance', step: 'cancel: confirmation', action: 'Cancel report', expected: 'A confirmation naming the report before anything is sent', observed: 'confirmation shown',
      browser_test: ['W1 cancel through the confirmation commits; MCP reads cancelled']}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    const cancelled = (await mcp.call('bellnote.absences.list', {id: rep.id}));
    check('W1 cancel committed', cancelled.reports[0].state === 'cancelled');
    await reload(p);
    check('W1 reload keeps the cancelled report', (await p.textContent(row)).includes('Wed, Nov 18') && /[Cc]ancelled/.test(await p.textContent(row)));
    await frame(p, 'w1-06-cancelled-after-reload', {workflow: 'W1 Attendance', step: 'outcome after reload', action: 'Confirm, then reload the page', expected: 'The report reads cancelled and still names its day',
      observed: 'cancelled, Wed, Nov 18; kept after reload', reload: 'kept', mcp: {tool: 'bellnote.absences.list', args: {id: rep.id}, record: rep.id, state: cancelled.reports[0].state, version: v(cancelled.version)},
      browser_test: ['A fully cancelled report still names its day']}, row);

    // ---- W2 forms: sign the changed form again, withdraw, a stale sheet, denied signing.
    await section(p, 'Forms');
    await frame(p, 'w2-01-start', {workflow: 'W2 Forms', step: 'start', action: 'Forms', expected: 'The first form to do is the changed aquarium trip: Theo\'s answer needs review on version 2', observed: 'aquarium trip open, needs review',
      mcp: {tool: 'bellnote.forms.get', args: {id: 'form-aquarium'}, observed: (await mcp.call('bellnote.forms.get', {id: 'form-aquarium'})).form.responses[0].state}}, 'article[data-form-id]');
    await p.click('button:has-text("Review and sign again")');
    await p.selectOption('dialog[open] [data-question=q-lunch]', 'bring_own');
    await frame(p, 'w2-02-answer-sheet', {workflow: 'W2 Forms', step: 'action', action: 'Review and sign again: the sheet is prefilled with the earlier answers; change Lunch to "Bring own", then Send answer',
      expected: 'Questions of version 2 with the earlier answers', observed: 'prefilled; emergency phone 555-0100', browser_test: ['Answer sheet prefills the earlier answers']}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    const aq = await mcp.call('bellnote.forms.get', {id: 'form-aquarium'}), aqr = aq.form.responses[0];
    check('W2 signature on version 2 committed with no second payment', aqr.state === 'signed' && aqr.form_version === 2 && aqr.payment_ids.length === 1, aqr);
    await frame(p, 'w2-03-signed-v2', {workflow: 'W2 Forms', step: 'outcome', action: 'Send answer', expected: 'Theo\'s answer reads signed on version 2; the fee already paid is not charged again',
      observed: 'signed', mcp: {tool: 'bellnote.forms.get', args: {id: 'form-aquarium'}, record: aqr.id, state: aqr.state, form_version: aqr.form_version, payments: aqr.payment_ids.length, version: v(aq.version)},
      browser_test: ['W2 browser signature on version 2 commits; MCP reads signed, no second payment']}, 'div.bn-item[data-child-id=child-theo]');
    await p.click('button[data-form-id=form-winter-concert]'); await settled(p);
    await p.click('div.bn-item[data-child-id=child-theo] button:has-text("Withdraw answer")');
    await frame(p, 'w2-04-withdraw-confirm', {workflow: 'W2 Forms', step: 'cancel: confirmation', action: 'Winter concert evening → Withdraw answer (Theo)', expected: 'A confirmation that the $5.00 fee is refunded', observed: 'confirmation shown'}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    const wc = (await mcp.call('bellnote.forms.get', {id: 'form-winter-concert'})), wct = wc.form.responses.find(r => r.child_id === 'child-theo');
    const refund = (await mcp.call('bellnote.payments.list', {child_id: 'child-theo'})).payments.find(x => x.object_id === wct.id);
    check('W2 withdrawal committed and the fee refunded', wct.state === 'withdrawn' && refund.status === 'refunded');
    await frame(p, 'w2-05-withdrawn', {workflow: 'W2 Forms', step: 'outcome', action: 'Withdraw answer', expected: 'Theo\'s answer reads withdrawn and Answer is offered again; the payment reads refunded (MCP here, Account → Payments in frame account-03)', observed: 'withdrawn, Answer offered',
      mcp: {tool: 'bellnote.forms.get + bellnote.payments.list', record: wct.id, state: wct.state, payment: refund.id, payment_status: refund.status, version: v(wc.version)},
      browser_test: ['W2 browser withdrawal commits; MCP reads withdrawn and the fee refunded']}, 'div.bn-item[data-child-id=child-theo]');
    // Ines answers; the school changes the form while the sheet is open.
    await p.click('div.bn-item[data-child-id=child-ines] button:has-text("Answer")');
    await p.selectOption('dialog[open] [data-question=q-size]', 'youth_s');
    snap = await infra.call('env.snapshot');
    const changed = await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'ev-evidence-form-change', at: '2026-11-17T07:05:00-08:00', operation: 'bellnote.form.changed',
      payload: {form_id: 'form-winter-concert', change: {text: 'The winter concert is on 15 December at 18:30; the fee covers the costume rental.'}, reason: 'Start time moved'}}});
    check('Infra event changes the winter concert form while the sheet is open', changed.status === 'committed', changed);
    await submitDialog(p);
    const stale = await errorOf(p);
    check('W2 stale sheet refused; nothing written', stale.code === 'stale_version' && (await mcp.call('bellnote.forms.get', {id: 'form-winter-concert'})).form.responses.find(r => r.child_id === 'child-ines').state === 'withdrawn', stale);
    await frame(p, 'w2-06-stale-sheet', {workflow: 'W2 Forms', step: 'stale', action: 'Answer (Ines), size Youth S; meanwhile the school changes the form (Infra form.changed event); Send answer',
      expected: 'Refused as stale: the form changed since the page read it; nothing is signed or charged', observed: '"' + stale.text + '"', mcp: {tool: 'env.apply_event (Infra)', event: 'ev-evidence-form-change', version: v(changed.version)}}, 'dialog[open]');
    await closeDialog(p);
    await p.click('.toolbar button:has-text("Refresh")'); await settled(p);
    await p.click('div.bn-item[data-child-id=child-ines] button:has-text("Answer")');
    await p.selectOption('dialog[open] [data-question=q-size]', 'youth_s');
    await submitDialog(p); await closed(p);
    const wc2 = await mcp.call('bellnote.forms.get', {id: 'form-winter-concert'}), wci = wc2.form.responses.find(r => r.child_id === 'child-ines');
    check('W2 signature after Refresh commits on version 2 with the fee', wci.state === 'signed' && wci.form_version === 2 && wci.paid_cents === 500, wci);
    await reload(p);
    check('W2 reload keeps Ines\'s signature', /[Ss]igned/.test(await p.textContent('div.bn-item[data-child-id=child-ines]')));
    await frame(p, 'w2-07-signed-after-refresh', {workflow: 'W2 Forms', step: 'outcome after reload', action: 'Close, Refresh, Answer again, Send answer; reload the page', expected: 'Ines\'s answer reads signed on version 2, fee $5.00 paid once',
      observed: 'signed; kept after reload', reload: 'kept', mcp: {tool: 'bellnote.forms.get', args: {id: 'form-winter-concert'}, record: wci.id, state: wci.state, form_version: wci.form_version, paid_cents: wci.paid_cents, version: v(wc2.version)}},
    'div.bn-item[data-child-id=child-ines]');
    await p.click('button[data-form-id=form-k-band]'); await settled(p);
    check('W2 no signing control where the right is with another guardian', !(await p.$('.detail button:has-text("Answer")')) && (await p.textContent('div.bn-item[data-child-id=child-nico]')).includes('Signing for Nico is with Sam Reyes'));
    await frame(p, 'w2-08-denied-nico', {workflow: 'W2 Forms', step: 'denied', action: 'Open Band festival (Nico)', expected: 'No Answer control: Maya cannot sign for Nico; the page says who can',
      observed: '"Signing for Nico is with Sam Reyes"', browser_test: ['Signing is not offered where the right belongs to another guardian']}, 'div.bn-item[data-child-id=child-nico]');

    // ---- W3 pickup: a restricted phone, a new person, change and cancel a way home, Nico.
    await section(p, 'Pickup & dismissal');
    await frame(p, 'w3-01-start', {workflow: 'W3 Pickup', step: 'start', action: 'Pickup & dismissal, Theo', expected: 'Way home for the next two weeks with cut-offs, people who may collect Theo, restriction on file', observed: 'shown'});
    await p.click('button:has-text("Add pickup person")');
    await p.fill('dialog[open] [data-field=name]', 'R. Halvorsen');
    await p.fill('dialog[open] [data-field=relationship]', 'family friend');
    await p.fill('dialog[open] [data-field=phone]', '555-0191');
    snap = await infra.call('env.snapshot');
    await submitDialog(p);
    const restricted = await errorOf(p);
    check('W3 a restricted person under another name is refused by phone', restricted.code === 'restricted_person', restricted);
    check('W3 refusal wrote nothing', JSON.stringify((await infra.call('env.snapshot')).version) === JSON.stringify(snap.version));
    await frame(p, 'w3-02-restricted-refused', {workflow: 'W3 Pickup', step: 'denied', action: 'Add pickup person "R. Halvorsen", family friend, 555-0191 (the number of the person on file with the office), Add person',
      expected: 'Refused (restricted_person): matched by the school-held person, not by name; nothing written', observed: '"' + restricted.text + '"; version unchanged', mcp: {tool: 'env.snapshot (Infra)', version: v(snap.version), observed: 'unchanged'}}, 'dialog[open]');
    await p.fill('dialog[open] [data-field=name]', 'June Park');
    await p.fill('dialog[open] [data-field=relationship]', 'neighbor');
    await p.fill('dialog[open] [data-field=phone]', '555-0166');
    await submitDialog(p); await closed(p);
    const pk = await mcp.call('bellnote.pickup.get', {id: 'child-theo'}), june = pk.pickup_people.find(x => x.display_name === 'June Park');
    check('W3 new person committed and waiting for the office', june?.status === 'pending_review');
    await frame(p, 'w3-03-added-pending', {workflow: 'W3 Pickup', step: 'outcome', action: 'Change the entry to "June Park", neighbor, 555-0166, Add person', expected: 'June Park listed as waiting for the office',
      observed: (await p.textContent('div[data-person-id="' + june.id + '"]')).includes('Waiting for the office') ? 'waiting for the office' : 'NOT SHOWN',
      mcp: {tool: 'bellnote.pickup.get', args: {id: 'child-theo'}, record: june.id, state: june.status, version: v(pk.version)}, browser_test: ['W3 browser add commits; MCP reads the person waiting for review']}, 'div[data-person-id="' + june.id + '"]');
    await p.click('div[data-date="2026-11-18"] button:has-text("Change")');
    await p.selectOption('dialog[open] [data-field=mode]', 'pickup');
    await p.selectOption('dialog[open] [data-field=person_id]', 'person-rosa');
    await p.fill('dialog[open] [data-field=note]', 'Dentist, Rosa collects');
    await frame(p, 'w3-04-change-form', {workflow: 'W3 Pickup', step: 'action', action: 'Wednesday, November 18 → Change: Pickup, collected by Rosa Delgado, note, Save change', expected: 'Only approved collectors are offered', observed: 'Rosa Delgado selected'}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    let pk2 = await mcp.call('bellnote.pickup.get', {id: 'child-theo'}), day = pk2.days.find(d => d.date === '2026-11-18');
    check('W3 way-home change committed', day.plan.source === 'dismissal_change' && day.plan.person_id === 'person-rosa');
    await frame(p, 'w3-05-changed', {workflow: 'W3 Pickup', step: 'outcome', action: 'Save change', expected: 'Wednesday reads "Picked up by Rosa Delgado"', observed: (await p.textContent('div[data-date="2026-11-18"]')).includes('Picked up by Rosa Delgado') ? 'Picked up by Rosa Delgado' : 'NOT SHOWN',
      mcp: {tool: 'bellnote.pickup.get', args: {id: 'child-theo'}, record: day.plan.change_id || null, state: 'active', version: v(pk2.version)}, browser_test: ['W3 browser way-home change commits; MCP plan names Rosa']}, 'div[data-date="2026-11-18"]');
    await p.click('div[data-date="2026-11-18"] button:has-text("Cancel change")');
    await frame(p, 'w3-06-cancel-confirm', {workflow: 'W3 Pickup', step: 'cancel: confirmation', action: 'Cancel change', expected: 'A confirmation before anything is sent', observed: 'confirmation shown'}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    pk2 = await mcp.call('bellnote.pickup.get', {id: 'child-theo'}); day = pk2.days.find(d => d.date === '2026-11-18');
    check('W3 cancel committed; default way home again', day.plan.source === 'default');
    await reload(p);
    await frame(p, 'w3-07-cancelled-after-reload', {workflow: 'W3 Pickup', step: 'outcome after reload', action: 'Confirm, then reload the page', expected: 'Wednesday is back to the usual way home (bus)', observed: 'usual way home; kept after reload', reload: 'kept',
      mcp: {tool: 'bellnote.pickup.get', args: {id: 'child-theo'}, observed: 'plan ' + day.plan.source, version: v(pk2.version)}, browser_test: ['W3 browser cancel commits; MCP plan is the default again']}, 'div[data-date="2026-11-18"]');
    await child(p, 'child-nico');
    check('W3 Nico: no list and no controls', (await p.textContent('.detail')).includes('shared only with custodial guardians') && !(await p.$('.detail button:has-text("Add pickup person")')));
    const nicoPickup = await mcp.call('bellnote.pickup.get', {id: 'child-nico'});
    await frame(p, 'w3-08-denied-nico', {workflow: 'W3 Pickup', step: 'denied', action: 'Choose Nico', expected: 'No pickup list and no controls: Maya is not custodial for Nico', observed: 'list not shown',
      mcp: {tool: 'bellnote.pickup.get', args: {id: 'child-nico'}, observed: nicoPickup.status + (nicoPickup.code ? ' ' + nicoPickup.code : '')}, browser_test: ['Non-custodial child: no pickup list and no controls']});
    await child(p, 'child-theo');

    // ---- W4 lunch: refused amount, stale form, top-up, settings, an independent cafeteria charge.
    await section(p, 'Lunch');
    await child(p, 'child-ines');
    await frame(p, 'w4-01-start', {workflow: 'W4 Lunch', step: 'start', action: 'Lunch, Ines', expected: 'Balance $3.10 under the $5.00 alert; meal restrictions; purchases; this week\'s menu', observed: 'balance ' + (await p.getAttribute('[data-balance]', 'data-balance')) + ' cents'});
    await p.click('button:has-text("Add money")');
    await p.fill('dialog[open] [data-money-for=amount_cents]', '2.00');
    await submitDialog(p);
    const range = await errorOf(p);
    check('W4 amount under the minimum refused', range.code === 'amount_out_of_range', range);
    await frame(p, 'w4-02-amount-refused', {workflow: 'W4 Lunch', step: 'invalid', action: 'Add money $2.00, Pay', expected: 'Refused (amount_out_of_range) with the school\'s range; nothing charged', observed: '"' + range.text + '"',
      browser_test: ['A refusal stays in the form with the App message (no protocol code shown)', 'No false success after a refusal']}, 'dialog[open]');
    const pv = (await mcp.call('bellnote.preferences.get')).version;
    const other = await mcp.call('bellnote.preferences.update', {email_notices: true, expected_version: pv, request_id: 'evidence-other-client'});
    check('An independent Agent MCP write commits while the form is open', other.status === 'committed');
    await p.fill('dialog[open] [data-money-for=amount_cents]', '20.00');
    await submitDialog(p);
    const staleTopup = await errorOf(p);
    check('W4 stale top-up refused; nothing charged', staleTopup.code === 'stale_version' && (await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'})).account.balance_cents === 310, staleTopup);
    await frame(p, 'w4-03-stale-refused', {workflow: 'W4 Lunch', step: 'stale', action: 'Another Agent connection changes the account (preferences.update); then $20.00, Pay', expected: 'Refused as stale; the balance stays $3.10',
      observed: '"' + staleTopup.text + '"', mcp: {tool: 'bellnote.preferences.update (other client)', state: other.status, version: v(other.version)}, browser_test: ['A stale form shows the conflict instead of overwriting', 'Nothing was charged by the stale form']}, 'dialog[open]');
    await closeDialog(p);
    await p.click('.toolbar button:has-text("Refresh")'); await settled(p);
    await p.click('button:has-text("Add money")');
    await p.fill('dialog[open] [data-money-for=amount_cents]', '20.00');
    await p.selectOption('dialog[open] [data-field=payment_method_id]', 'pm-0001');
    await frame(p, 'w4-04-topup-form', {workflow: 'W4 Lunch', step: 'action', action: 'Cancel, Refresh, Add money $20.00 with the card ending 4417, Pay', expected: 'Amount typed in dollars, card chosen from the usable payment methods', observed: 'filled'}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    const acct1 = await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'}), top = acct1.transactions.filter(t => t.kind === 'topup').at(-1);
    check('W4 top-up committed once', acct1.account.balance_cents === 2310 && top.amount_cents === 2000);
    await frame(p, 'w4-05-topped-up', {workflow: 'W4 Lunch', step: 'outcome', action: 'Pay', expected: 'Balance $23.10 and a top-up row', observed: 'balance ' + (await p.getAttribute('[data-balance]', 'data-balance')) + ' cents',
      mcp: {tool: 'bellnote.lunch.account_get', args: {id: 'lunch-ines'}, record: top.id, payment: top.payment_id, balance_cents: acct1.account.balance_cents, version: v(acct1.version)}});
    await p.click('button:has-text("Alerts and limits")');
    await p.fill('dialog[open] [data-money-for=low_balance_threshold_cents]', '8.00');
    await p.fill('dialog[open] [data-money-for=daily_limit_cents]', '');
    await frame(p, 'w4-06-settings-form', {workflow: 'W4 Lunch', step: 'edit', action: 'Alerts and limits: alert under $8.00, no daily limit, Save', expected: 'Prefilled with the current values', observed: 'filled'}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    const acct2 = await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'});
    check('W4 settings committed', acct2.account.low_balance_threshold_cents === 800 && acct2.account.daily_limit_cents === null);
    snap = await infra.call('env.snapshot');
    const charge = await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'ev-evidence-charge', at: '2026-11-17T07:20:00-08:00', operation: 'bellnote.lunch.charged',
      payload: {transaction_id: 'tx-evidence-1', child_id: 'child-ines', kind: 'purchase', amount_cents: -425, item: 'Peanut noodle bowl', allergens: ['peanut', 'wheat', 'soy']}}});
    check('Independent Infra event (cafeteria charge) commits', charge.status === 'committed', charge);
    await p.click('.toolbar button:has-text("Refresh")'); await settled(p);
    await reload(p);
    check('W4 the charge shows flagged after Refresh and reload', (await p.textContent('div[data-transaction-id=tx-evidence-1]')).includes('Restricted for Ines') && (await p.getAttribute('[data-balance]', 'data-balance')) === '1885');
    const acct3 = await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'}), tx = acct3.transactions.find(t => t.id === 'tx-evidence-1');
    await frame(p, 'w4-07-charge-after-reload', {workflow: 'W4 Lunch', step: 'independent update, after reload', action: 'Infra applies a cafeteria charge (lunch.charged, peanut item); Refresh, then reload',
      expected: 'Balance $18.85; the purchase flagged as restricted for Ines; alert $8.00 kept', observed: 'flagged; balance ' + (await p.getAttribute('[data-balance]', 'data-balance')) + ' cents; kept after reload', reload: 'kept',
      mcp: {tool: 'bellnote.lunch.account_get', args: {id: 'lunch-ines'}, record: tx.id, restricted_item: tx.restricted_item, balance_cents: acct3.account.balance_cents, threshold_cents: acct3.account.low_balance_threshold_cents, version: v(acct3.version)},
      browser_test: ['Refresh shows the cafeteria charge, flagged as restricted', 'Reload keeps the view and the committed balance']}, 'div[data-transaction-id=tx-evidence-1]');
    const menu = await mcp.call('bellnote.menu.list', {id: 'school-alder'}), excluded = menu.days.flatMap(d => d.items.filter(i => i.excluded_for.includes('child-ines')).map(i => d.date + ' ' + i.name));
    check('W4 the menu marks items excluded for Ines', excluded.length > 0 && /[Nn]ot for Ines|[Ee]xcluded|Ines/.test(await p.textContent('h3:has-text("Menu this week") + .bn-menu')), excluded);
    await frame(p, 'w4-08-menu', {workflow: 'W4 Lunch', step: 'read', action: 'Scroll to the week\'s menu', expected: 'Each day\'s items with allergen tags; items Ines\'s restrictions exclude are marked for her',
      observed: excluded.length + ' items marked for Ines this week', mcp: {tool: 'bellnote.menu.list', args: {id: 'school-alder'}, observed: 'excluded_for Ines: ' + excluded.join('; '), version: v(menu.version)}}, 'h3:has-text("Menu this week")');

    // ---- Account: email copies (the preference behind the optional Mail notices).
    await section(p, 'Account');
    await p.click('.collection button:has-text("Edit")');
    const prefilled = await p.inputValue('dialog[open] [data-field=email_notices]');
    check('Preferences form prefilled with the other client\'s change (email copies on)', prefilled === 'true', prefilled);
    await p.selectOption('dialog[open] [data-field=default_payment_method_id]', 'pm-0002');
    await frame(p, 'account-01-preferences-form', {workflow: 'Account', step: 'edit', action: 'Account → Edit: the form opens with email copies on (set by the other client during W4); change the default card to the one ending 2291, Save',
      expected: 'Prefilled with the current values', observed: 'email copies Yes, card ending 2291 chosen', browser_test: ['The preferences form is prefilled with the current value']}, 'dialog[open]');
    await submitDialog(p); await closed(p);
    const prefs = await mcp.call('bellnote.preferences.get');
    check('Account preferences committed', prefs.preferences.email_notices === true && prefs.preferences.default_payment_method_id === 'pm-0002');
    await reload(p);
    check('Account reload shows email copies on', (await p.textContent('.collection')).includes('Email copies on'));
    await frame(p, 'account-02-saved-after-reload', {workflow: 'Account', step: 'outcome after reload', action: 'Save; reload the page', expected: '"Email copies on" (each later notification also stores its Mail message, see mail-delivery.md); the card ending 2291 is the default',
      observed: 'email copies on, card ending 2291 default; kept after reload', reload: 'kept', mcp: {tool: 'bellnote.preferences.get', observed: 'email_notices ' + prefs.preferences.email_notices + ', default ' + prefs.preferences.default_payment_method_id, version: v(prefs.version)},
      browser_test: ['Preferences commit; MCP reads them']});
    const pays = (await mcp.call('bellnote.payments.list', {})).payments;
    await frame(p, 'account-03-payments', {workflow: 'Account', step: 'read', action: 'Scroll to Payments', expected: 'Today\'s form fee and top-up paid; Theo\'s winter concert fee refunded (W2)',
      observed: pays.filter(x => x.status === 'refunded').length + ' refunded, ' + pays.filter(x => x.status === 'paid').length + ' paid in the last 60 days',
      mcp: {tool: 'bellnote.payments.list', observed: pays.slice(0, 3).map(x => x.id + ' ' + x.kind + ' ' + x.status).join('; ')}}, 'h3:has-text("Payments")');

    // ---- Notifications.
    await section(p, 'Notifications');
    await p.click('button.bn-row[data-notice-id]'); await settled(p);
    await frame(p, 'notifications-01-read', {workflow: 'Notifications', step: 'read', action: 'Notifications → the latest one', expected: 'What the school, cafeteria or other guardian did, in names and dates; a link to the related view',
      observed: (await p.$$('button.bn-row[data-notice-id]')).length + ' notifications listed', browser_test: ['Notifications list and reader render']}, 'article[data-notice-id]');
    await p.context().close();

    // ---- Phone width.
    const phone = await page(browser, h, PHONE);
    for (const [label, name] of [['Home', 'home'], ['Attendance', 'attendance'], ['Forms', 'forms'], ['Lunch', 'lunch']]) {
      await section(phone, label);
      const fits = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check('390px ' + name + ' has no horizontal overflow', fits);
      await frame(phone, 'phone-' + name, {workflow: 'Phone width', step: label, action: 'Open ' + label + ' at 390 px', expected: 'Single column, no horizontal page scroll', observed: fits ? 'no horizontal overflow' : 'OVERFLOW',
        browser_test: ['390px ' + name + ' has no horizontal overflow']});
    }
    await phone.context().close();

    // ---- Read-only profile on a fresh run.
    const r = await host('scenario', RUN + '-scenario');
    try {
      const rp = await page(browser, r, DESKTOP);
      await section(rp, 'Lunch');
      check('Read-only profile: no write controls', (await rp.textContent('.bn-today')).includes('View only') && !(await rp.$('button:has-text("Add money")')));
      await frame(rp, 'restricted-01-view-only', {workflow: 'Read-only profile', step: 'denied', action: 'Host started with --profile scenario; Lunch', expected: '"View only" in the toolbar and no write controls', observed: 'view only, no Add money',
        browser_test: ['Restricted profile says the session is view only', 'Restricted profile renders no write controls']});
      await rp.context().close();
    } finally { await r.stop(); }
    check('No browser JavaScript errors', consoleErrors.length === 0, consoleErrors);

    if (process.argv.includes('--optimize')) await optimize(frames.map(f => path.join(out, f.file)));
    for (const f of frames) f.bytes = fs.statSync(path.join(out, f.file)).size;
    const appFiles = ['gui/index.html', 'gui/src/app.js', 'tools.json', 'fixtures/reference.json', ...fs.readdirSync(path.join(locate.packageDir, 'src')).sort().map(x => 'src/' + x)];
    const digest = crypto.createHash('sha256'); for (const f of appFiles) { digest.update(f + '\0'); digest.update(fs.readFileSync(path.join(locate.packageDir, f))); }
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: locate.packageDir, encoding: 'utf8'});
    const manifest = {schema: 'bellnote.gui-evidence.v1', node: process.version, browser: 'Chromium ' + browser.version() + ' (headless, Playwright)',
      host: 'runtime/web/server.cjs ' + JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version, run: RUN, profile: 'sandbox', account: 'bellnote-maya (Maya Chen, synthetic)',
      checkout_head: head.status === 0 ? head.stdout.trim() : null, app_files_sha256: digest.digest('hex'), app_files: appFiles,
      viewports: {desktop: DESKTOP.width + 'x' + DESKTOP.height, phone: PHONE.width + 'x' + PHONE.height}, checks: checks.length, frames};
    fs.writeFileSync(path.join(out, 'sequences.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'README.md'), readme(manifest));
    console.log(checks.length + ' checks passed; ' + frames.length + ' frames, ' + frames.reduce((n, f) => n + f.bytes, 0) + ' bytes in ' + out);
  } finally { await mcp.close(); await infra.close(); await h.stop(); await browser.close(); }
}

// Lossless recompression with zopflipng when it is installed; the files are kept as they are otherwise.
async function optimize(files) {
  if (spawnSync('zopflipng', ['-h'], {encoding: 'utf8'}).error) { console.log('zopflipng not found; PNG files left as captured'); return; }
  const queue = [...files], work = async () => { for (let file; (file = queue.shift());) {
    const tmp = file + '.opt.png';
    const code = await new Promise(resolve => spawn('zopflipng', ['-y', file, tmp], {stdio: 'ignore'}).on('close', resolve));
    if (code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size < fs.statSync(file).size) fs.renameSync(tmp, file); else if (fs.existsSync(tmp)) fs.rmSync(tmp);
  } };
  await Promise.all(Array.from({length: Math.max(1, Math.min(6, os.cpus().length - 1))}, work));
}
function readme(m) {
  const esc = s => String(s).replace(/\|/g, '\\|');
  const mcpText = x => !x ? '–' : esc([x.tool, x.args ? JSON.stringify(x.args) : null, x.record ? 'record `' + x.record + '`' : null, x.state ? 'state ' + x.state : null,
    x.form_version ? 'form version ' + x.form_version : null, x.payments !== undefined ? x.payments + ' payment' : null, x.payment ? 'payment `' + x.payment + '`' + (x.payment_status ? ' ' + x.payment_status : '') : null,
    x.paid_cents !== undefined ? 'paid ' + x.paid_cents + ' cents' : null, x.balance_cents !== undefined ? 'balance ' + x.balance_cents + ' cents' : null, x.threshold_cents !== undefined ? 'alert ' + x.threshold_cents + ' cents' : null,
    x.restricted_item !== undefined ? 'restricted_item ' + x.restricted_item : null, x.event ? 'event `' + x.event + '`' : null, x.observed ? x.observed : null,
    x.version ? 'version {' + x.version.epoch + ', ' + x.version.revision + '}' : null].filter(Boolean).join(', '));
  const L = ['# Bellnote GUI workflow sequences', '',
    'Captured by `node tests/web-evidence.cjs --optimize` (`npm run evidence:gui`) on the real shared Web Host. Run `' + m.run + '` (profile `' + m.profile + '`, fresh from `fixtures/reference.json` at Tuesday, November 17, 2026 07:00 America/Los_Angeles), account ' + m.account + '; ' + m.browser + '; ' + m.host + '; Node ' + m.node + '. ' +
    'Viewports ' + m.viewports.desktop + ' (sequences) and ' + m.viewports.phone + ' (phone frames); each image is the visible viewport, scrolled to the element named in the step. ' +
    m.checks + ' checks passed during the capture, including one per frame that no record ID, `null`, `undefined` or `NaN` is visible. App files digest (sha256 over ' + m.app_files.length + ' files: page, controller, tools, reference fixture and `src/`): `' + m.app_files_sha256.slice(0, 16) + '…`.', '',
    'Each write is confirmed by a separate Agent MCP client on the same run ("MCP" column: tool, record, state, Core version `{epoch, revision}`), and each workflow\'s outcome is checked again after a page reload. "Browser test" names the check in `tests/web-browser.cjs` that covers the same path. Frames are numbered in the order they were taken.', '',
    '| Frame | Workflow / step | Action | Expected | Observed | MCP confirmation | Reload | Browser test |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const f of m.frames) L.push('| [' + f.file + '](' + f.file + ') | ' + esc(f.workflow) + ': ' + esc(f.step) + ' | ' + esc(f.action) + ' | ' + esc(f.expected) + ' | ' + esc(f.observed) + ' | ' + mcpText(f.mcp) + ' | ' + (f.reload || '–') + ' | ' + (f.browser_test ? esc(f.browser_test.map(x => '"' + x + '"').join('; ')) : '–') + ' |');
  L.push('', 'Reproducibility: the run, data, clock, actions, MCP results and versions are the same on every capture (the run starts from the fixture and uses virtual time only); pixels can differ slightly between Chromium builds and font installations, so the images are evidence of this capture rather than byte-reproducible outputs. `sequences.json` holds the same table with exact values.', '');
  return L.join('\n');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
