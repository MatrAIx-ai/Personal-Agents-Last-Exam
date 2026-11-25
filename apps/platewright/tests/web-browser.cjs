'use strict';
// Browser acceptance for Platewright's web interface (not part of `npm test`; needs the repository's
// pinned Playwright: `npm ci && npx playwright install chromium` at the repository root).
// Starts the shared Web Host for a fresh run, clicks through the real controls and confirms each
// result with an independent Agent MCP connection to the same run.
//   node tests/web-browser.cjs [--runtime DIR] [--output DIR]   (screenshots and report.json in DIR)
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir();
const {start} = require(path.join(runtime, 'web/server.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const {chromium} = require(require.resolve('playwright', {paths: [path.dirname(runtime)]}));
const registry = path.join(locate.packageDir, 'web.registry.json');
const out = locate.option('output') || path.join(path.dirname(runtime), '.artifacts/web/platewright');
const P = 'platewright.';
const HOSTILE = '<img src=x onerror="window.__pwned=1">Zoë & "Co"';
const WAIT = {timeout: 20000};
const {unreadable} = require('../scripts/check-fixtures.cjs');

async function main() {
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platewright-browser-'));
  const checks = [], errors = [];
  const check = (name, ok, detail) => { checks.push({name, passed: !!ok, ...(ok ? {} : {detail})}); if (!ok) throw new Error(name + ' ' + JSON.stringify(detail ?? '')); };
  let host, restricted, browser, mcp, infra;
  try {
    host = await start({app: 'platewright', registry, run: 'browser', stateDir, profile: 'sandbox'});
    mcp = new Client('platewright', 'agent', 'browser', stateDir, 'platewright-browser-check', {registry});
    await mcp.initialize();
    browser = await chromium.launch();
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const idle = () => page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false' && !document.querySelector('#records .empty h3')?.textContent.startsWith('Loading'), null, WAIT);
    const nav = async label => { await page.click(`nav button:has-text("${label}")`); await idle(); };
    const dialog = op => page.locator(`dialog[data-operation="${op}"]`);
    const submit = async op => { await dialog(op).locator('button[type=submit]').click(); };
    const closed = op => dialog(op).waitFor({state: 'detached', ...WAIT});
    const shot = async name => { await page.screenshot({path: path.join(out, name + '.png'), fullPage: false}); };
    // What a person reads in a view: no record IDs, slot IDs, ISO dates, vocabulary keys or missing values.
    const readable = async where => {
      const lines = (await page.locator('#app').innerText()).split('\n').map(x => x.trim()).filter(Boolean);
      const bad = lines.map(unreadable).filter(Boolean);
      check(`${where}: the page shows names, dates and words, not IDs or keys`, !bad.length, bad.slice(0, 5));
    };

    await page.goto(host.accessUrl);
    await page.waitForSelector('.pw-day', WAIT); await idle();
    check('Host serves the App page; the access fragment is removed', (await page.title()).startsWith('Platewright') && !page.url().includes('access='));
    check('The week opens on the loaded week with its days', await page.locator('.pw-day').count() === 7 && (await page.textContent('.pw-bar h3')).includes('2 Nov'));
    await shot('01-week-1280');

    // Earlier meals keep the plan they started from: a meal another member cleared, one they changed
    // and one a guest joined show what was planned before.
    const back = async weeks => { for (let i = 0; i < weeks; i++) { await page.click('button[aria-label="Previous week"]'); await idle(); } };
    const slotHistory = async id => { await page.click(`[data-slot-id="${id}"]`); await idle(); return page.locator('.detail .pw-history').innerText(); };
    await back(11);
    const cleared = await slotHistory('2026-08-22:dinner');
    await shot('01b-cleared-meal-1280');
    const changed = await slotHistory('2026-08-17:dinner');
    await shot('01c-changed-meal-1280');
    await back(5);
    const joined = await slotHistory('2026-07-18:dinner');
    await shot('01d-guest-meal-1280');
    const planned = text => (/Planned · .*\n.*[A-Za-z]/.exec(text) || [''])[0];
    check('A cleared earlier meal shows what was planned before it was cleared', cleared.startsWith('Cleared') && /Nothing planned/.test(cleared) && planned(cleared) && !/Nothing planned/.test(planned(cleared)), cleared);
    check('A changed earlier meal shows the plan it replaced', /^Cooked/.test(changed) && /Changed · .*Evan|Changed · .*Eli/.test(changed) && /Planned · /.test(changed), changed);
    check('A meal a guest joined shows the plan before the guest', /Guest added[^\n]*\n[^\n]*guests: /.test(joined) && /Planned · [^\n]*\n(?![^\n]*guests)/.test(joined), joined);
    await readable('An earlier week with a meal selected');
    await page.click('.pw-bar button:has-text("This week")'); await idle();

    // Next week: Saturday's dinner shows the guests the check flags.
    await page.click('button[aria-label="Next week"]'); await idle();
    await page.click('[data-slot-id="2026-11-14:dinner"]'); await idle();
    const detail = await page.textContent('.detail');
    check('A slot shows what the check found for each guest', detail.includes('Maya: Unsafe') && detail.includes('Ines: Unsuitable'), detail.slice(0, 300));
    await readable('Meal plan with a meal selected');
    await shot('02-slot-flags-1280');

    // W4: plan Tuesday's breakfast with a guest whose name is hostile text.
    await page.click('button[aria-label^="Plan a meal on Tuesday"]');
    const plan = dialog(P + 'plan.slot.set'); await plan.waitFor(WAIT);
    await plan.locator('select').nth(0).selectOption('breakfast');
    await plan.locator('select[aria-label="Recipe"]').first().selectOption('rec-banana-pancakes');
    await plan.locator('button:has-text("+ Add a guest")').click();
    await plan.locator('input[aria-label="Guest name"]').fill(HOSTILE);
    await plan.locator('select[aria-label="Guest need"]').selectOption('allergy');
    await plan.locator('button:has-text("Add need")').click();
    await submit(P + 'plan.slot.set'); await closed(P + 'plan.slot.set'); await idle();
    let slot = (await mcp.call(P + 'plan.get', {start: '2026-11-10', end: '2026-11-10'})).slots.find(s => s.id === '2026-11-10:breakfast');
    check('Planning a meal in the page commits the slot (MCP read)', slot && slot.state === 'planned' && slot.dishes[0].recipe_id === 'rec-banana-pancakes' && slot.guests[0].name === HOSTILE, slot);
    check('Hostile text is shown as text, never as markup', await page.locator('.pw-slot-detail').innerText().then(t => t.includes(HOSTILE)) && await page.locator('#app img').count() === 0 && !(await page.evaluate(() => window.__pwned)));
    await shot('03-planned-with-guest-1280');

    // W4: mark Monday's dinner skipped.
    await page.click('[data-slot-id="2026-11-09:dinner"]'); await idle();
    await page.click('.pw-actions button:has-text("Mark skipped")');
    await submit(P + 'plan.slot.mark'); await closed(P + 'plan.slot.mark'); await idle();
    slot = (await mcp.call(P + 'plan.get', {start: '2026-11-09', end: '2026-11-09'})).slots.find(s => s.id === '2026-11-09:dinner');
    check('Marking a meal skipped commits (MCP read)', slot.state === 'skipped', slot.state);

    // W5: the shopping list; tick a line with its checkbox.
    await nav('Shopping list');
    check('The list says it is stale', (await page.textContent('.pw-banner')).includes('changed since'));
    const lineId = await page.locator('.pw-row.needed').first().getAttribute('data-line-id');
    await page.locator(`.pw-row[data-line-id="${lineId}"] input[type=checkbox]`).click(); await idle();
    check('Ticking a line commits (MCP read)', (await mcp.call(P + 'shopping.get', {})).list.lines.find(l => l.id === lineId).state === 'ticked');
    await page.click(`.pw-row[data-line-id="${lineId}"]`); await idle();
    await readable('Shopping list with an item selected');
    await shot('04-shopping-1280');

    // A lost response: the server commits, the page sees a network failure; sending the unchanged form
    // again reuses the request ID and nothing is added twice.
    await page.click('.pw-bar button:has-text("Add item")');
    const add = dialog(P + 'shopping.item.set'); await add.waitFor(WAIT);
    await add.locator('input[placeholder^="e.g."]').fill('Paper napkins');
    let dropped = false;
    await page.route('**/api/call', async route => {
      const body = route.request().postDataJSON();
      if (!dropped && body.name === P + 'shopping.item.set') { dropped = true; await route.fetch(); return route.abort('connectionreset'); }
      return route.continue();
    });
    await submit(P + 'shopping.item.set');
    await page.waitForFunction(() => document.querySelector('dialog[data-operation="platewright.shopping.item.set"] .form-error')?.textContent, null, WAIT);
    await page.unroute('**/api/call');
    await submit(P + 'shopping.item.set'); await closed(P + 'shopping.item.set'); await idle();
    const napkins = (await mcp.call(P + 'shopping.get', {})).list.lines.filter(l => l.text === 'Paper napkins');
    check('A retried form after a lost response commits once (same request ID)', dropped && napkins.length === 1, napkins.length);

    // W5: pantry; a stale form shows the conflict, then a fresh one saves.
    await nav('Pantry');
    await page.click('[data-item-id="ing-egg"]'); await idle();
    await readable('Pantry with an item selected');
    await page.click('.pw-actions button:has-text("Update stock")');
    const set = dialog(P + 'pantry.set'); await set.waitFor(WAIT);
    await set.locator('input[type=number]').fill('18');
    const v = (await mcp.call(P + 'pantry.list', {})).version;
    check('An independent MCP write commits while the form is open',
      (await mcp.call(P + 'pantry.set', {id: 'ing-lime', quantity: 7, unit: 'each', expected_version: v, request_id: 'mcp-lime'})).status === 'committed');
    await submit(P + 'pantry.set');
    await page.waitForFunction(() => document.querySelector('dialog[data-operation="platewright.pantry.set"] .form-error')?.dataset.code, null, WAIT);
    const conflict = await set.locator('.form-error').textContent();
    const conflictCode = await set.locator('.form-error').getAttribute('data-code');
    check('The stale form shows the conflict and writes nothing', conflictCode === 'stale_version' && !conflict.includes('stale_version') &&
      (await mcp.call(P + 'pantry.list', {})).items.find(i => i.ingredient_id === 'ing-egg').quantity !== 18, conflict);
    await shot('05-stale-conflict-1280');
    await set.locator('button:has-text("Cancel")').click();
    await page.click('.toolbar button:has-text("Refresh")'); await idle();
    check('Refresh shows the independent change', (await page.textContent('[data-item-id="ing-lime"]')).includes('7'));
    await page.click('[data-item-id="ing-egg"]'); await idle();
    await page.click('.pw-actions button:has-text("Update stock")');
    await set.locator('input[type=number]').fill('18');
    await submit(P + 'pantry.set'); await closed(P + 'pantry.set'); await idle();
    check('Updating stock commits (MCP read)', (await mcp.call(P + 'pantry.list', {})).items.find(i => i.ingredient_id === 'ing-egg').quantity === 18);

    // W2: a need whose end is before its start is refused with the App's code; corrected, it saves.
    await nav('Household');
    await page.click('[data-member-id="person-evan"]'); await idle();
    await readable('Household with a member selected');
    await page.click('.pw-actions button:has-text("Add a need")');
    const need = dialog(P + 'members.constraint.set'); await need.waitFor(WAIT);
    await need.locator('select[aria-label="Kind"]').selectOption('dislike');
    await need.locator('input[placeholder^="or a tag"]').fill('spicy');
    const [from, until] = [need.locator('input[type=date]').nth(0), need.locator('input[type=date]').nth(1)];
    await from.fill('2026-11-20'); await until.fill('2026-11-10');
    await need.locator('input[placeholder="Where this came from"]').fill('Asked at breakfast');
    await submit(P + 'members.constraint.set');
    await page.waitForFunction(() => document.querySelector('dialog[data-operation="platewright.members.constraint.set"] .form-error')?.dataset.code, null, WAIT);
    const refusal = await need.locator('.form-error').textContent();
    const refusalCode = await need.locator('.form-error').getAttribute('data-code');
    check('A refusal shows the App\'s message in words (its code stays on the element)', refusalCode === 'invalid_window' && refusal.length > 10 && !unreadable(refusal), refusal);
    await shot('06-refusal-1280');
    await until.fill('2026-11-30');
    await submit(P + 'members.constraint.set'); await closed(P + 'members.constraint.set'); await idle();
    const evan = (await mcp.call(P + 'household.get', {id: 'person-evan'})).members[0];
    check('Adding a need commits (MCP read)', evan.constraints.some(c => c.tag === 'spicy' && c.effective_from === '2026-11-20' && c.expires_on === '2026-11-30' && c.state === 'scheduled'));

    // W1 and W3: edit a recipe (adds a revision), then save a variant from a previewed swap.
    await nav('Recipes');
    // A new recipe that its tool's schema would refuse is named in the form, before anything is sent.
    await page.click('.pw-bar button:has-text("New recipe")');
    const fresh = dialog(P + 'recipes.create'); await fresh.waitFor(WAIT);
    await fresh.locator('label.field:has-text("Title") input').fill('Weeknight omelette');
    await fresh.locator('select[aria-label="Ingredient"]').first().selectOption('ing-egg');
    await fresh.locator('input[aria-label="Quantity"]').first().fill('3');
    await fresh.locator('label.field:has-text("Steps") textarea').fill('Whisk and cook.');
    const formMessage = async () => { await submit(P + 'recipes.create'); await page.waitForFunction(() => document.querySelector('dialog[data-operation="platewright.recipes.create"] .form-error')?.textContent, null, WAIT);
      const text = await fresh.locator('.form-error').textContent(); await fresh.locator('.form-error').evaluate(e => { e.textContent = ''; }); return text; };
    const noMethod = await formMessage();
    await fresh.locator('label.field:has-text("Method") input[type=checkbox]').first().check();
    await fresh.locator('label.field:has-text("Tags") input').fill('quick, ' + 'x'.repeat(41));
    const longTag = await formMessage();
    check('The recipe form names a missing method and a long tag instead of a schema error', noMethod === 'Tick at least one method.' && longTag === 'Each tag can be at most 40 characters.', [noMethod, longTag]);
    await fresh.locator('button:has-text("Cancel")').click(); await closed(P + 'recipes.create');
    check('Nothing was written by the refused form (MCP read)', !(await mcp.call(P + 'recipes.search', {query: 'omelette'})).items.length);
    await page.fill('.toolbar input[type=search]', 'green curry'); await idle();
    await page.click('[data-record-id="rec-green-curry"]'); await idle();
    await page.click('.pw-actions button:has-text("Edit recipe")');
    const edit = dialog(P + 'recipes.update'); await edit.waitFor(WAIT);
    await edit.locator('label.field:has-text("Title") input').fill('Sweet potato green curry for Saturdays');
    await submit(P + 'recipes.update'); await closed(P + 'recipes.update'); await idle();
    const curry = (await mcp.call(P + 'recipes.get', {id: 'rec-green-curry'})).recipe;
    check('Editing a recipe commits a new revision (MCP read)', curry.title === 'Sweet potato green curry for Saturdays' && curry.revision === 3, [curry.title, curry.revision]);
    check('The recipe view shows no empty placeholders', !/\bnull\b|undefined|\[object Object\]/.test(await page.textContent('.detail')));
    await page.locator('.pw-inline input[aria-label="Servings"]').fill('6');
    await page.click('.pw-inline button:has-text("Scale")');
    await page.waitForFunction(() => document.querySelector('.pw-recipe .pw-table')?.textContent.includes('1050 ml'), null, WAIT);
    check('Scaling to 6 servings shows 1050 ml of coconut milk', true);
    await page.click('.pw-recipe .pw-inline button:has-text("Check")');
    await page.waitForFunction(() => document.querySelector('.pw-recipe .pw-verdicts [data-verdict]'), null, WAIT);
    const verdicts = await page.textContent('.pw-recipe .pw-verdicts');
    check('The check for the table names the ingredient a finding is about', verdicts.includes('Green curry paste') && !verdicts.includes('green-curry-paste'), verdicts);
    await readable('Recipe with the check for the table');
    await page.click('.pw-actions button:has-text("Swap ingredients")');
    const swap = dialog(P + 'recipes.variant.create'); await swap.waitFor(WAIT);
    await swap.locator('select[aria-label="Swap for Fish sauce"]').selectOption('rule-fish-sauce-tamari');
    await swap.locator('button:has-text("Preview")').click();
    await page.waitForFunction(() => document.querySelector('dialog[data-operation="platewright.recipes.variant.create"] .pw-verdicts strong'), null, WAIT);
    check('The swap preview shows each person before and after', (await swap.locator('.pw-verdicts').textContent()).includes('→'));
    await shot('07-variant-preview-1280');
    await submit(P + 'recipes.variant.create'); await closed(P + 'recipes.variant.create'); await idle();
    const variants = (await mcp.call(P + 'recipes.search', {query: 'tamari', limit: 100})).items.filter(r => r.variant_of === 'rec-green-curry');
    check('Saving a variant commits (MCP read)', variants.length === 2, variants.map(r => r.id));
    await shot('08-recipe-1280');

    // An event from another member arrives through Infra; Refresh shows it in Activity.
    infra = new Client('platewright', 'infra', 'browser', stateDir, 'platewright-browser-infra', {registry});
    await infra.initialize();
    const snap = await infra.call('env.snapshot', {});
    const ev = await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'ev-browser-1', at: '2026-11-08T09:00:00-05:00', operation: P + 'pantry.changed',
      payload: {items: [{ingredient_id: 'ing-milk', quantity: 2000, unit: 'ml', use_by: '2026-11-15'}], by: 'person-eli', note: 'Market run'}}});
    check('An independent event commits', ev.status === 'committed', ev.status);
    await page.fill('.toolbar input[type=search]', ''); await idle();
    await nav('Activity');
    check('Activity shows the other member\'s change after the view is read again', (await page.textContent('#records')).includes('Eli changed the pantry') || (await page.textContent('#records')).includes('Market run'), (await page.textContent('#records')).slice(0, 300));
    await readable('Activity');
    await shot('09-activity-1280');

    // Reload keeps committed state.
    await page.reload(); await page.waitForSelector('#records', WAIT); await idle();
    await nav('Meal plan');
    await page.click('button[aria-label="Next week"]'); await idle();
    check('After reload the planned breakfast and the skipped dinner are still there',
      await page.locator('[data-slot-id="2026-11-10:breakfast"]').count() === 1 && (await page.getAttribute('[data-slot-id="2026-11-09:dinner"]', 'class')).includes('skipped'));

    // Layout at phone and desktop widths: no horizontal page overflow.
    for (const [w, h, name] of [[390, 844, 'phone'], [1280, 900, 'desktop']]) {
      await page.setViewportSize({width: w, height: h});
      for (const [label, file] of [['Meal plan', 'week'], ['Shopping list', 'shopping'], ['Recipes', 'recipes']]) {
        await nav(label);
        if (label === 'Recipes' && w === 390) await page.click('[data-record-id]').catch(() => {});
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${label} at ${w}px has no horizontal page overflow`, overflow <= 0, overflow);
        await page.screenshot({path: path.join(out, `10-${file}-${name}.png`), fullPage: w === 390});
      }
    }
    // The one network error is the response this test dropped on purpose above.
    const unexpected = errors.filter(e => !e.includes('ERR_CONNECTION_RESET'));
    check('No JavaScript errors in the console (apart from the deliberately dropped response)', unexpected.length === 0 && errors.length <= 1, errors);
    errors.length = 0;
    await page.close();

    // Restricted profile: write controls are absent.
    restricted = await start({app: 'platewright', registry, run: 'browser-restricted', stateDir, profile: 'scenario'});
    const ro = await browser.newPage({viewport: {width: 1280, height: 900}});
    ro.on('pageerror', e => errors.push('restricted pageerror: ' + e.message));
    await ro.goto(restricted.accessUrl); await ro.waitForSelector('.pw-day', WAIT);
    await ro.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, WAIT);
    await ro.click('button[aria-label="Next week"]');
    await ro.waitForSelector('[data-slot-id="2026-11-14:dinner"]', WAIT);
    await ro.click('[data-slot-id="2026-11-14:dinner"]');
    await ro.waitForFunction(() => document.querySelector('.detail h2'), null, WAIT);
    const roButtons = await ro.locator('.pw-add, .pw-actions button').count();
    check('Under the scenario profile no write controls are shown', roButtons === 0, roButtons);
    await ro.screenshot({path: path.join(out, '11-restricted-1280.png')});
    const status = await ro.evaluate(async () => { const s = await (await fetch('/session')).json(); return (await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': s.csrf}, body: JSON.stringify({name: 'platewright.pantry.set', arguments: {id: 'ing-egg', quantity: 1, unit: 'each', expected_version: {epoch: 1, revision: 0}, request_id: 'x'}})})).status; });
    check('A direct write request from the restricted page is refused by the Host', status === 403, status);
    check('No JavaScript errors in the restricted page', errors.length === 0, errors);
    return {schema: 'platewright.web-browser.v1', node: process.version, browser: browser.version(), passed: true, checks};
  } catch (e) {
    return {schema: 'platewright.web-browser.v1', node: process.version, passed: false, error: e.message, checks, errors};
  } finally {
    await browser?.close(); await mcp?.close(); await infra?.close(); await host?.close(); await restricted?.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}

main().then(report => {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
});
