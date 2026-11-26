#!/usr/bin/env node
'use strict';
// Captures the GUI workflow sequences of evidence/README.md (not part of `npm test`; needs the
// repository's pinned Playwright and its Chromium: `npm ci && npx playwright install chromium` at the
// repository root). Starts the shared Web Host on a fresh sandbox run of the reference household,
// drives the real page with real clicks and typing, and after every write confirms the persisted
// record and the App version through an independent Agent MCP connection to the same run; reloads
// check persistence. Each frame is a viewport screenshot (1280 x 800, a few at 390 x 844) with the
// action taken, the expected and the observed result written to sequences.json and sequences.md.
//   node scripts/capture-gui-evidence.cjs [--runtime DIR] [--output DIR] [--zopfli]
// --output defaults to evidence/gui in this package. --zopfli recompresses the PNGs losslessly with
// zopflipng when it is on PATH. Screenshots can differ in pixels between machines and runs (font
// rendering); the actions, checks, records and versions in sequences.json are the same on every run.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {spawnSync} = require('node:child_process');
const locate = require('./locate.cjs');
const runtime = locate.runtimeDir();
const {start} = require(path.join(runtime, 'web/server.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const {chromium} = require(require.resolve('playwright', {paths: [path.dirname(runtime)]}));
const {unreadable} = require('./check-fixtures.cjs');
const registry = path.join(locate.packageDir, 'web.registry.json');
const out = locate.option('output') || path.join(locate.packageDir, 'evidence/gui');
const P = 'platewright.';
const WAIT = {timeout: 20000};
const DESKTOP = {width: 1280, height: 800}, PHONE = {width: 390, height: 844};

async function main() {
  fs.mkdirSync(out, {recursive: true});
  for (const f of fs.readdirSync(out)) if (/\.png$/.test(f)) fs.rmSync(path.join(out, f));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platewright-evidence-'));
  const sequences = [], errors = [];
  let seq = null, host, restricted, browser, mcp, infra;
  const begin = (id, title, workflow, test) => { seq = {id, title, workflow, browser_test: test, frames: [], confirmations: []}; sequences.push(seq); };
  const fail = (what, detail) => { throw new Error(what + ' ' + JSON.stringify(detail ?? '').slice(0, 400)); };
  try {
    host = await start({app: 'platewright', registry, run: 'evidence', stateDir, profile: 'sandbox'});
    mcp = new Client('platewright', 'agent', 'evidence', stateDir, 'platewright-evidence-check', {registry});
    await mcp.initialize();
    infra = new Client('platewright', 'infra', 'evidence', stateDir, 'platewright-evidence-infra', {registry});
    await infra.initialize();
    browser = await chromium.launch();
    let page = await browser.newPage({viewport: DESKTOP});
    const watch = p => { p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); };
    watch(page);
    const idle = (p = page) => p.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false' && !document.querySelector('#records .empty h3')?.textContent.startsWith('Loading'), null, WAIT);
    const nav = async label => { await page.click(`nav button:has-text("${label}")`); await idle(); };
    const dialog = op => page.locator(`dialog[data-operation="${P + op}"]`);
    const submit = op => dialog(op).locator('button[type=submit]').click();
    const closed = op => dialog(op).waitFor({state: 'detached', ...WAIT}).catch(async e => { throw new Error('The form did not close: ' + (await dialog(op).locator('.form-error').textContent().catch(() => '')) + ' ' + e.message.split('\n')[0]); });
    const formError = async op => { await page.waitForFunction(o => document.querySelector(`dialog[data-operation="${o}"] .form-error`)?.textContent, P + op, WAIT);
      const e = dialog(op).locator('.form-error'); return {message: await e.textContent(), code: await e.getAttribute('data-code')}; };
    const version = async () => (await mcp.call(P + 'household.get', {id: 'person-nora'})).version;
    // A frame: the screenshot, what was done and what was expected and seen. Every frame is checked
    // for raw IDs, ISO dates, vocabulary keys and missing values in the visible text first.
    const frame = async (name, {action, expected, observed, p = page, allow = []}) => {
      const lines = (await p.locator('body').innerText()).split('\n').map(x => x.trim()).filter(Boolean);
      const bad = lines.filter(l => !allow.some(a => l.includes(a))).map(unreadable).filter(Boolean);
      if (bad.length) fail(`Frame ${name} shows unreadable text`, bad.slice(0, 5));
      const file = `${seq.id}-${String(seq.frames.length + 1).padStart(2, '0')}-${name}.png`;
      // A frame with an open form is cropped to the form (the page behind it is dimmed and blurred);
      // the viewport is made tall enough for the whole form first, and restored afterwards.
      const before = p.viewportSize();
      const tall = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); return d ? d.scrollHeight : 0; });
      if (tall) { await p.setViewportSize({width: before.width, height: Math.min(1800, Math.max(before.height, tall + 240))}); await p.evaluate(() => { const d = document.querySelector('dialog[open]'); if (d) d.scrollTop = 0; }); await p.waitForTimeout(100); }
      const form = tall ? await p.locator('dialog[open]').boundingBox().catch(() => null) : null;
      const viewport = p.viewportSize();
      const clip = form && {x: Math.max(0, Math.floor(form.x) - 8), y: Math.max(0, Math.floor(form.y) - 8)};
      if (clip) Object.assign(clip, {width: Math.min(viewport.width - clip.x, Math.ceil(form.width) + 16), height: Math.min(viewport.height - clip.y, Math.ceil(form.height) + 16)});
      await p.screenshot({path: path.join(out, file), fullPage: false, ...(clip ? {clip} : {})});
      if (tall) await p.setViewportSize(before);
      seq.frames.push({file, viewport: `${viewport.width}x${viewport.height}`, ...(clip ? {cropped_to: 'open form'} : {}), action, expected, observed});
    };
    const confirm = async (what, tool, args, pick) => {
      const r = await mcp.call(P + tool, args);
      const record = pick(r);
      seq.confirmations.push({what, tool: P + tool, arguments: args, record, app_version: r.version});
      return record;
    };
    const reload = async (what, test) => {
      await page.reload(); await page.waitForSelector('#records', WAIT); await idle();
      const ok = await test();
      if (!ok) fail('Reload lost ' + what);
      seq.confirmations.push({what: 'After a page reload: ' + what, tool: 'browser reload', record: true});
    };
    const text = async sel => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();

    await page.goto(host.accessUrl);
    await page.waitForSelector('.pw-day', WAIT); await idle();

    // ---- W4 Weekly meal plan ------------------------------------------------------------------------
    begin('w4', 'Weekly meal plan: plan, change, invalid, stale, clear, cook', 'W4', 'tests/web-browser.cjs (W4 checks)');
    await frame('week', {action: 'Open the App: Meal plan, the week of 2–8 Nov 2026 (loaded time Sun 8 Nov, 08:00).',
      expected: 'Seven days with each meal, who eats it and its state; earlier days read-only, today marked.', observed: await text('.pw-bar h3')});
    await page.click('button[aria-label="Next week"]'); await idle();
    await page.click('[data-slot-id="2026-11-14:dinner"]'); await idle();
    const sat = await text('.pw-slot-detail');
    if (!sat.includes('Maya: Unsafe') || !sat.includes('Ines: Unsuitable')) fail('Saturday flags', sat.slice(0, 200));
    await frame('flags', {action: 'Next week (›), select Saturday 14 Nov dinner.', expected: 'The check names each guest the dish is wrong for and the ingredient lines behind it.',
      observed: 'Maya: Unsafe; Ines: Unsuitable, with the lines named'});
    await page.click('button[aria-label^="Plan a meal on Tuesday"]');
    const plan = dialog('plan.slot.set'); await plan.waitFor(WAIT);
    await plan.locator('select').nth(0).selectOption('breakfast');
    await plan.locator('select[aria-label="Recipe"]').first().selectOption('rec-banana-pancakes');
    await plan.locator('button:has-text("+ Add a guest")').click();
    await plan.locator('input[aria-label="Guest name"]').fill('Priya');
    await plan.locator('select[aria-label="Guest need"]').selectOption('allergy');
    await plan.locator('select[aria-label="Guest need"] + span select').selectOption('egg');
    await plan.locator('button:has-text("Add need")').click();
    await frame('plan-form', {action: '“+ Plan a meal” on Tuesday 10 Nov; Meal: breakfast; Recipe: Banana pancakes; “+ Add a guest” Priya with an egg allergy.',
      expected: 'A modal form with the dish, the members at the table and the guest with her need; nothing is written yet.', observed: 'Form filled, not sent'});
    let v0 = await version();
    await submit('plan.slot.set'); await closed('plan.slot.set'); await idle();
    const breakfast = await confirm('Tuesday breakfast planned with the guest', 'plan.get', {start: '2026-11-10', end: '2026-11-10'},
      r => { const s = r.slots.find(x => x.id === '2026-11-10:breakfast'); return s && {id: s.id, state: s.state, dishes: s.dishes.map(d => d.recipe_id), guests: s.guests.map(g => g.name), flags: s.flags.filter(f => f.type === 'person').map(f => f.name + ': ' + f.verdict)}; });
    if (!breakfast || breakfast.state !== 'planned' || breakfast.guests[0] !== 'Priya' || !breakfast.flags.includes('Priya: unsafe')) fail('breakfast', breakfast);
    await frame('planned', {action: 'Submit “Save meal”.', expected: 'The form closes; the meal is on Tuesday and selected, with its guest; a dish wrong for her is planned and flagged, not refused.',
      observed: `MCP plan.get: ${breakfast.id} ${breakfast.state}, guest Priya, flags ${breakfast.flags.join('; ') || 'none'}; App version ${JSON.stringify(v0)} → ${JSON.stringify(seq.confirmations.at(-1).app_version)}`});
    await reload('the planned Tuesday breakfast', async () => { await page.click('button[aria-label="Next week"]'); await idle(); return await page.locator('[data-slot-id="2026-11-10:breakfast"]').count() === 1; });
    // Edit: change a planned meal (Thursday's dinner, which has no guests: see evidence/README.md on
    // changing a meal whose guest has a need).
    await page.click('[data-slot-id="2026-11-12:dinner"]'); await idle();
    await page.click('.pw-actions button:has-text("Change meal")');
    const change = dialog('plan.slot.set'); await change.waitFor(WAIT);
    await change.locator('button:has-text("+ Add a dish")').click();
    await change.locator('select[aria-label="Recipe"]').last().selectOption('rec-greek-salad');
    await frame('change-form', {action: 'After a reload, select Thursday 12 Nov dinner (Spaghetti bolognese), “Change meal”, “+ Add a dish”: Greek salad.', expected: 'The form opens with the saved dish and people; a second dish is added.', observed: 'Second dish added in the form'});
    await submit('plan.slot.set'); await closed('plan.slot.set'); await idle();
    const changed = await confirm('Thursday dinner changed', 'plan.get', {start: '2026-11-12', end: '2026-11-12'},
      r => { const s = r.slots.find(x => x.id === '2026-11-12:dinner'); return {id: s.id, state: s.state, dishes: s.dishes.map(d => d.recipe_id), history: s.history.map(h => h.action)}; });
    if (changed.dishes.length !== 2) fail('change', changed);
    await frame('changed', {action: 'Submit “Save meal”.', expected: 'Two dishes; the history shows the earlier plan and the change.', observed: `MCP: dishes ${changed.dishes.join(', ')}; history ${changed.history.join(', ')}`});
    // Invalid: a guest name longer than the tool's schema allows is stopped in the form.
    await page.click('.pw-actions button:has-text("Change meal")');
    const long = dialog('plan.slot.set'); await long.waitFor(WAIT);
    await long.locator('button:has-text("+ Add a guest")').click();
    await long.locator('input[aria-label="Guest name"]').last().fill(('Bartholomew Featherstonehaugh-Llewellyn ').repeat(4).slice(0, 121));
    v0 = await version();
    await submit('plan.slot.set');
    const tooLong = await formError('plan.slot.set');
    if (tooLong.code !== 'form_check' || JSON.stringify(await version()) !== JSON.stringify(v0)) fail('long name', tooLong);
    await frame('invalid', {action: '“Change meal”, “+ Add a guest” with a 121-character name, submit.', expected: 'The form names the limit in words and sends nothing.',
      observed: `“${tooLong.message}”; App version unchanged ${JSON.stringify(v0)}`});
    await long.locator('button:has-text("Cancel")').click(); await closed('plan.slot.set');
    // Stale: the form was opened before another write committed.
    await page.click('.pw-actions button:has-text("Change meal")');
    const stale = dialog('plan.slot.set'); await stale.waitFor(WAIT);
    await stale.locator('textarea').last().fill('Salad first');
    const other = await mcp.call(P + 'pantry.set', {id: 'ing-lime', quantity: 7, unit: 'each', expected_version: await version(), request_id: 'evidence-mcp-lime'});
    if (other.status !== 'committed') fail('independent write', other);
    seq.confirmations.push({what: 'Independent MCP write while the form is open (pantry: 7 limes)', tool: P + 'pantry.set', record: {id: other.id, status: other.status}, app_version: other.version});
    await submit('plan.slot.set');
    const staleErr = await formError('plan.slot.set');
    const still = (await mcp.call(P + 'plan.get', {start: '2026-11-12', end: '2026-11-12'})).slots.find(x => x.id === '2026-11-12:dinner');
    if (staleErr.code !== 'stale_version' || still.note !== null) fail('stale', [staleErr, still.note]);
    await frame('stale', {action: '“Change meal”, type a note; meanwhile another connection commits a pantry write; submit.', expected: 'The form says the record changed and writes nothing.',
      observed: `“${staleErr.message}” (data-code stale_version); MCP: the meal has no note`});
    await stale.locator('button:has-text("Cancel")').click(); await closed('plan.slot.set');
    // Cancel path: clear a planned meal.
    await page.click('.toolbar button:has-text("Refresh")'); await idle();
    await page.click('[data-slot-id="2026-11-10:breakfast"]'); await idle();
    await page.click('.pw-actions button:has-text("Clear")');
    await dialog('plan.slot.set').waitFor(WAIT);
    await frame('clear-confirm', {action: 'Refresh, select the breakfast, “Clear”.', expected: 'A confirmation saying the meal stays in the history as cleared.', observed: 'Confirmation shown'});
    await submit('plan.slot.set'); await closed('plan.slot.set'); await idle();
    const cleared = await confirm('Tuesday breakfast cleared', 'plan.get', {start: '2026-11-10', end: '2026-11-10'},
      r => { const s = r.slots.find(x => x.id === '2026-11-10:breakfast'); return {id: s.id, state: s.state, history: s.history.map(h => h.action)}; });
    if (cleared.state !== 'cleared') fail('clear', cleared);
    await page.click('[data-slot-id="2026-11-10:breakfast"]'); await idle();
    await frame('cleared', {action: '“Clear this meal”.', expected: 'The meal reads Cleared; its history keeps what was planned.', observed: `MCP: ${cleared.state}; history ${cleared.history.join(', ')}`});
    // Cooked today, taking from the pantry: what was short is a note, not an error.
    await page.click('.pw-bar button:has-text("This week")'); await idle();
    await page.click('[data-slot-id="2026-11-08:dinner"]'); await idle();
    await page.click('.pw-actions button:has-text("Mark cooked")');
    const mark = dialog('plan.slot.mark'); await mark.waitFor(WAIT);
    await mark.locator('label.pw-checks input[type=checkbox]').check();
    await frame('cook-form', {action: 'This week, today’s dinner (Chicken noodle soup), “Mark cooked”, tick “Take the ingredients from the pantry”.', expected: 'Portions made and eaten, and the pantry option.', observed: 'Form filled'});
    await submit('plan.slot.mark'); await closed('plan.slot.mark'); await idle();
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('Cooked.'), null, WAIT);
    const note = await page.evaluate(() => ({text: document.querySelector('#status').textContent, error: document.querySelector('#status').dataset.error || null}));
    const dinner = await confirm('Today’s dinner cooked from the pantry', 'plan.get', {start: '2026-11-08', end: '2026-11-08'},
      r => { const s = r.slots.find(x => x.id === '2026-11-08:dinner'); return {id: s.id, state: s.state, deducted: s.cooked.deducted, short: s.cooked.short.map(x => x.ingredient_id)}; });
    if (dinner.state !== 'cooked' || note.error !== null) fail('cooked', [dinner, note]);
    await frame('cooked', {action: 'Submit “Mark cooked”.', expected: 'Cooked; what the pantry lacked is reported in the status line as a note, not as an error.', observed: `“${note.text}”; MCP: ${dinner.state}, deducted ${dinner.deducted}`});

    // ---- W1 Recipe box -----------------------------------------------------------------------------
    begin('w1', 'Recipe box: search, scale, create (invalid then valid), edit, archive and restore', 'W1', 'tests/web-browser.cjs (W1 checks)');
    await nav('Recipes');
    await page.fill('.toolbar input[type=search]', 'green curry'); await idle();
    await page.click('[data-record-id="rec-green-curry"]'); await idle();
    await frame('search', {action: 'Recipes, search “green curry”, select Sweet potato green curry.', expected: 'The matching recipes; the recipe with its lines, method, nutrition, allergens and revisions.', observed: await text('.detail h2')});
    await page.locator('.pw-inline input[aria-label="Servings"]').fill('6');
    await page.click('.pw-inline button:has-text("Scale")');
    await page.waitForFunction(() => document.querySelector('.pw-recipe .pw-table')?.textContent.includes('1050 ml'), null, WAIT);
    await page.locator('.pw-recipe .pw-table').scrollIntoViewIfNeeded();
    await frame('scale', {action: 'Servings 6, “Scale”.', expected: 'The lines for 6 servings with the conversions kept exact; coconut milk 1050 ml.', observed: '1050 ml shown'});
    await page.click('.pw-recipe .pw-inline button:has-text("Check")');
    await page.waitForFunction(() => document.querySelector('.pw-recipe .pw-verdicts [data-verdict]'), null, WAIT);
    const verdicts = await text('.pw-recipe .pw-verdicts');
    await page.locator('.pw-recipe .pw-verdicts').scrollIntoViewIfNeeded();
    await frame('check', {action: '“Check” for the four members on the default day (today).', expected: 'A verdict per person naming the ingredient behind it (the W2 check).', observed: verdicts.slice(0, 160)});
    await page.click('.pw-bar button:has-text("New recipe")');
    const fresh = dialog('recipes.create'); await fresh.waitFor(WAIT);
    await fresh.locator('label.field:has-text("Title") input').fill('Weeknight omelette');
    await fresh.locator('select[aria-label="Ingredient"]').first().selectOption('ing-egg');
    await fresh.locator('input[aria-label="Quantity"]').first().fill('3');
    await fresh.locator('select[aria-label="Unit"]').first().selectOption('each');
    await fresh.locator('label.field:has-text("Steps") textarea').fill('Whisk the eggs.\nCook gently and fold.');
    v0 = await version();
    await submit('recipes.create');
    const noMethod = await formError('recipes.create');
    if (noMethod.message !== 'Tick at least one method.' || JSON.stringify(await version()) !== JSON.stringify(v0)) fail('no method', noMethod);
    await frame('create-invalid', {action: '“New recipe”: title, 3 eggs, two steps, no method ticked; submit.', expected: 'The form names what is missing and sends nothing.', observed: `“${noMethod.message}”; App version unchanged`});
    await fresh.locator('label.field:has-text("Method") input[type=checkbox][value="fry"]').check();
    await submit('recipes.create'); await closed('recipes.create'); await idle();
    const omelette = await confirm('New recipe saved', 'recipes.search', {query: 'omelette'}, r => r.items.map(x => ({id: x.id, title: x.title, revision: x.revision})));
    if (omelette.length !== 1) fail('create', omelette);
    await frame('created', {action: 'Tick a method, submit “Save recipe”.', expected: 'The new recipe is saved at revision 1 and shown.', observed: `MCP recipes.search: ${omelette[0].title}, revision ${omelette[0].revision}`});
    await page.fill('.toolbar input[type=search]', 'green curry'); await idle();
    await page.click('[data-record-id="rec-green-curry"]'); await idle();
    await page.click('.pw-actions button:has-text("Edit recipe")');
    const edit = dialog('recipes.update'); await edit.waitFor(WAIT);
    await edit.locator('label.field:has-text("Title") input').fill('Sweet potato green curry for Saturdays');
    await frame('edit-form', {action: 'Select the curry, “Edit recipe”, change the title.', expected: 'The form holds the current recipe; only changed fields are sent.', observed: 'Title changed in the form'});
    await submit('recipes.update'); await closed('recipes.update'); await idle();
    const curry = await confirm('Recipe edited', 'recipes.get', {id: 'rec-green-curry'}, r => ({id: r.recipe.id, title: r.recipe.title, revision: r.recipe.revision, revisions: r.recipe.revisions.length}));
    if (curry.revision !== 3) fail('edit', curry);
    await frame('edited', {action: 'Submit “Save changes”.', expected: 'A new revision; the earlier ones stay readable.', observed: `MCP: “${curry.title}”, revision ${curry.revision}`});
    await page.fill('.toolbar input[type=search]', 'omelette'); await idle();
    await page.click('[data-record-id]'); await idle();
    await page.click('.pw-actions button:has-text("Archive")');
    await dialog('recipes.update').waitFor(WAIT);
    await frame('archive-confirm', {action: 'Select the omelette, “Archive”.', expected: 'A confirmation: it stays readable and in past plans.', observed: 'Confirmation shown'});
    await submit('recipes.update'); await closed('recipes.update'); await idle();
    const archived = await confirm('Recipe archived', 'recipes.get', {id: omelette[0].id}, r => ({id: r.recipe.id, state: r.recipe.state, revision: r.recipe.revision}));
    if (archived.state !== 'archived') fail('archive', archived);
    await page.click(`[data-record-id="${omelette[0].id}"]`).catch(() => {}); await idle();
    await frame('archived', {action: '“Archive recipe”.', expected: 'The recipe moves to Archived recipes, with a Restore action; no new revision.', observed: `MCP: ${archived.state}, revision ${archived.revision}`});
    await page.click('.pw-actions button:has-text("Restore")');
    await dialog('recipes.update').waitFor(WAIT);
    await submit('recipes.update'); await closed('recipes.update'); await idle();
    const restored = await confirm('Recipe restored', 'recipes.get', {id: omelette[0].id}, r => ({id: r.recipe.id, state: r.recipe.state, revision: r.recipe.revision}));
    if (restored.state !== 'active') fail('restore', restored);
    await reload('the restored recipe and the edited title', async () => {
      await nav('Recipes'); await page.fill('.toolbar input[type=search]', 'saturdays'); await idle(); return (await page.locator('[data-record-id="rec-green-curry"]').count()) === 1; });
    await page.click('[data-record-id="rec-green-curry"]'); await idle();
    await frame('restored', {action: '“Restore”, then reload and search “saturdays”.', expected: 'The omelette is active again; after a reload the edited curry title is still there.', observed: `MCP: omelette ${restored.state}; curry found after reload`});

    // ---- W3 Substitutions --------------------------------------------------------------------------
    begin('w3', 'Substitutions: preview a swap per person, save a variant', 'W3', 'tests/web-browser.cjs (W3 checks)');
    await page.click('.pw-actions button:has-text("Swap ingredients")');
    const swap = dialog('recipes.variant.create'); await swap.waitFor(WAIT);
    await frame('swap-form', {action: 'On the curry, “Swap ingredients”.', expected: 'One choice per line; rules that do not apply to this recipe are listed with their reason and cannot be chosen.', observed: 'Form open'});
    await swap.locator('select[aria-label="Swap for Fish sauce"]').selectOption('rule-fish-sauce-tamari');
    await swap.locator('button:has-text("Preview")').click();
    await page.waitForFunction(() => document.querySelector('dialog[data-operation="platewright.recipes.variant.create"] .pw-verdicts strong'), null, WAIT);
    const preview = (await swap.locator('.pw-verdicts').innerText()).replace(/\s+/g, ' ');
    v0 = await version();
    await frame('preview', {action: 'Fish sauce → Tamari, “Preview”.', expected: 'Each person before → after; the preview writes nothing.', observed: preview.slice(0, 160)});
    await submit('recipes.variant.create'); await closed('recipes.variant.create'); await idle();
    const variant = await confirm('Variant saved', 'recipes.search', {query: 'tamari', limit: 100}, r => r.items.filter(x => x.variant_of === 'rec-green-curry').map(x => ({id: x.id, title: x.title})));
    if (variant.length !== 2) fail('variant', variant);
    await frame('saved', {action: 'Submit “Save as a variant”.', expected: 'A new variant recording the base, its revision and the swap.', observed: `MCP: ${variant.map(x => x.title).join('; ')}`});

    // ---- W2 Household --------------------------------------------------------------------------------
    begin('w2', 'Household needs: invalid window, add, end', 'W2', 'tests/web-browser.cjs (W2 checks)');
    await page.fill('.toolbar input[type=search]', ''); await idle();
    await nav('Household');
    await page.click('[data-member-id="person-evan"]'); await idle();
    await frame('member', {action: 'Household, select Evan.', expected: 'His portion factor and needs with state, dates, notes and history.', observed: await text('.detail h2')});
    await page.click('.pw-actions button:has-text("Add a need")');
    const need = dialog('members.constraint.set'); await need.waitFor(WAIT);
    await need.locator('select[aria-label="Kind"]').selectOption('dislike');
    await need.locator('input[placeholder^="or a tag"]').fill('spicy');
    const [from, until] = [need.locator('input[type=date]').nth(0), need.locator('input[type=date]').nth(1)];
    await from.fill('2026-11-20'); await until.fill('2026-11-10');
    await need.locator('input[placeholder="Where this came from"]').fill('Asked at breakfast');
    v0 = await version();
    await submit('members.constraint.set');
    const win = await formError('members.constraint.set');
    if (win.code !== 'invalid_window' || JSON.stringify(await version()) !== JSON.stringify(v0)) fail('window', win);
    await frame('invalid', {action: '“Add a need”: dislike tag spicy, from 20 Nov until 10 Nov; submit.', expected: 'The App refuses; its message is shown in words and nothing is written.', observed: `“${win.message}” (data-code ${win.code}); App version unchanged`});
    await until.fill('2026-11-30');
    await submit('members.constraint.set'); await closed('members.constraint.set'); await idle();
    const spicy = await confirm('Need saved', 'household.get', {id: 'person-evan'}, r => r.members[0].constraints.filter(c => c.tag === 'spicy').map(c => ({id: c.id, state: c.state, effective_from: c.effective_from, expires_on: c.expires_on})));
    if (spicy.length !== 1 || spicy[0].state !== 'scheduled') fail('need', spicy);
    await frame('saved', {action: 'Until 30 Nov, submit.', expected: 'The need is saved as scheduled from 20 Nov.', observed: `MCP: ${spicy[0].state}, ${spicy[0].effective_from} to ${spicy[0].expires_on}`});
    await page.locator(`[data-constraint-id="${spicy[0].id}"] button:has-text("End")`).click();
    await dialog('members.constraint.remove').waitFor(WAIT);
    await frame('end-confirm', {action: '“End” on the new need.', expected: 'A confirmation: it stops applying from today and keeps its history.', observed: 'Confirmation shown'});
    await submit('members.constraint.remove'); await closed('members.constraint.remove'); await idle();
    const ended = await confirm('Need ended', 'household.get', {id: 'person-evan'}, r => r.members[0].constraints.filter(c => c.id === spicy[0].id).map(c => ({id: c.id, state: c.state, history: c.history.map(h => h.action)}))[0]);
    if (ended.state !== 'ended') fail('end', ended);
    await page.locator(`[data-constraint-id="${spicy[0].id}"]`).scrollIntoViewIfNeeded();
    await frame('ended', {action: '“End it now”.', expected: 'The need reads Ended, with its history.', observed: `MCP: ${ended.state}; history ${ended.history.join(', ')}`});

    // ---- W5 Pantry and shopping list ---------------------------------------------------------------
    begin('w5', 'Shopping list and pantry: stale list, tick, exclude, add, remove, regenerate; stock update with a stale form', 'W5', 'tests/web-browser.cjs (W5 checks)');
    await nav('Shopping list');
    await frame('stale-list', {action: 'Shopping list.', expected: 'The list for 9–15 Nov with a notice that the plan or pantry changed since it was made.', observed: await text('.pw-banner')});
    const lineId = await page.locator('.pw-row.needed').first().getAttribute('data-line-id');
    await page.locator(`.pw-row[data-line-id="${lineId}"] input[type=checkbox]`).click(); await idle();
    await page.click(`.pw-row[data-line-id="${lineId}"]`); await idle();
    const ticked = await confirm('Line ticked', 'shopping.get', {}, r => { const l = r.list.lines.find(x => x.id === lineId); return {id: l.id, state: l.state}; });
    if (ticked.state !== 'ticked') fail('tick', ticked);
    await frame('ticked', {action: 'Tick the first line’s checkbox and select it.', expected: 'The line moves to “In the basket”.', observed: `MCP: ${ticked.state}`});
    const needLine = await page.locator('.pw-row.needed').nth(0).getAttribute('data-line-id');
    await page.click(`.pw-row[data-line-id="${needLine}"]`); await idle();
    await page.click('.pw-actions button:has-text("Not buying")');
    const excl = dialog('shopping.item.set'); await excl.waitFor(WAIT);
    await excl.locator('input[placeholder^="e.g."]').fill('Still have some at work');
    await frame('exclude-form', {action: 'Select a line still to buy, “Not buying”, give a reason.', expected: 'A form asking why.', observed: 'Reason entered'});
    await submit('shopping.item.set'); await closed('shopping.item.set'); await idle();
    const excluded = await confirm('Line left off', 'shopping.get', {}, r => { const l = r.list.lines.find(x => x.id === needLine); return {id: l.id, state: l.state, reason: l.excluded_reason}; });
    if (excluded.state !== 'excluded') fail('exclude', excluded);
    await frame('excluded', {action: '“Leave it off”.', expected: 'The line reads Excluded with the reason; “Buy it after all” puts it back.', observed: `MCP: ${excluded.state} (“${excluded.reason}”)`});
    await page.click('.pw-bar button:has-text("Add item")');
    const add = dialog('shopping.item.set'); await add.waitFor(WAIT);
    await add.locator('input[placeholder^="e.g."]').fill('Paper napkins');
    await submit('shopping.item.set'); await closed('shopping.item.set'); await idle();
    const napkins = await confirm('Item added by hand', 'shopping.get', {}, r => r.list.lines.filter(x => x.text === 'Paper napkins').map(x => ({id: x.id, state: x.state, kind: x.kind})));
    if (napkins.length !== 1) fail('add', napkins);
    await page.click(`.pw-row[data-line-id="${napkins[0].id}"]`); await idle();
    await page.locator(`.pw-row[data-line-id="${napkins[0].id}"]`).scrollIntoViewIfNeeded();
    await frame('added', {action: '“Add item”: Paper napkins, 1 each, “Add”; select it.', expected: 'An item added by hand, selected, with Edit and Remove.', observed: `MCP: ${napkins[0].kind} line, ${napkins[0].state}`});
    await page.click('.pw-actions button:has-text("Remove")');
    await dialog('shopping.item.remove').waitFor(WAIT);
    await submit('shopping.item.remove'); await closed('shopping.item.remove'); await idle();
    const gone = await confirm('Item removed', 'shopping.get', {}, r => r.list.lines.filter(x => x.text === 'Paper napkins').length);
    if (gone !== 0) fail('remove', gone);
    await page.click('.pw-banner button:has-text("Update the list")');
    await dialog('shopping.generate').waitFor(WAIT);
    await frame('regenerate-confirm', {action: '“Remove” the napkins (confirmed), then “Update the list” in the notice.', expected: 'The napkins are gone; a confirmation to rebuild the list from the current plan and pantry.', observed: 'MCP: no napkins line; confirmation shown'});
    await submit('shopping.generate'); await closed('shopping.generate'); await idle();
    const regen = await confirm('List regenerated', 'shopping.get', {}, r => ({stale: r.list.stale, lines: r.list.lines.length, ticked: r.list.lines.filter(l => l.state === 'ticked').length, excluded: r.list.lines.filter(l => l.state === 'excluded').map(l => l.id)}));
    if (regen.stale !== false || !regen.excluded.includes(needLine)) fail('regenerate', regen);
    await frame('regenerated', {action: '“Update the list”.', expected: 'The notice is gone; ticks and the exclusion are kept on lines still needed.', observed: `MCP: stale ${regen.stale}, ${regen.lines} lines, exclusion kept`});
    await nav('Pantry');
    await page.click('[data-item-id="ing-egg"]'); await idle();
    await page.click('.pw-actions button:has-text("Update stock")');
    const set = dialog('pantry.set'); await set.waitFor(WAIT);
    await set.locator('input[type=number]').fill('18');
    await frame('stock-form', {action: 'Pantry, Eggs, “Update stock”: 18.', expected: 'The form with quantity, unit and use-by date.', observed: 'Form filled'});
    const lime = await mcp.call(P + 'pantry.set', {id: 'ing-lime', quantity: 9, unit: 'each', expected_version: await version(), request_id: 'evidence-mcp-lime-2'});
    seq.confirmations.push({what: 'Independent MCP write while the form is open (pantry: 9 limes)', tool: P + 'pantry.set', record: {id: lime.id, status: lime.status}, app_version: lime.version});
    await submit('pantry.set');
    const stockStale = await formError('pantry.set');
    const eggs = (await mcp.call(P + 'pantry.list', {})).items.find(i => i.ingredient_id === 'ing-egg').quantity;
    if (stockStale.code !== 'stale_version' || eggs === 18) fail('stock stale', stockStale);
    await frame('stock-stale', {action: 'Meanwhile another connection sets 9 limes; submit “Save”.', expected: 'The stale form says the record changed and writes nothing.', observed: `“${stockStale.message}”; MCP: eggs still ${eggs}`});
    await set.locator('button:has-text("Cancel")').click(); await closed('pantry.set');
    await page.click('.toolbar button:has-text("Refresh")'); await idle();
    await page.click('[data-item-id="ing-lime"]'); await idle();
    const limeText = await text('[data-item-id="ing-lime"]');
    if (!limeText.includes('9')) fail('refresh', limeText);
    await frame('refreshed', {action: 'Cancel, “Refresh”, select Lime.', expected: 'The independent change is shown.', observed: limeText});
    await page.click('[data-item-id="ing-egg"]'); await idle();
    await page.click('.pw-actions button:has-text("Update stock")');
    await set.waitFor(WAIT);
    await set.locator('input[type=number]').fill('18');
    await submit('pantry.set'); await closed('pantry.set'); await idle();
    const egg = await confirm('Stock saved', 'pantry.list', {}, r => { const i = r.items.find(x => x.ingredient_id === 'ing-egg'); return {id: 'pantry:' + i.ingredient_id, quantity: i.quantity, unit: i.unit, history_rows: i.history.length}; });
    if (egg.quantity !== 18) fail('stock', egg);
    await reload('the 18 eggs', async () => { await nav('Pantry'); return (await text('[data-item-id="ing-egg"]')).includes('18'); });
    await page.click('[data-item-id="ing-egg"]'); await idle();
    await frame('stock-saved', {action: 'Eggs, “Update stock” again: 18, “Save”; reload.', expected: '18 eggs, with a new history row; still there after a reload.', observed: `MCP: ${egg.quantity} ${egg.unit}, ${egg.history_rows} history rows`});

    // ---- Another member's change arrives as an event ------------------------------------------------
    begin('events', 'Another member’s change (Infra event) seen after Refresh', 'Events', 'tests/web-browser.cjs (event check)');
    const snap = await infra.call('env.snapshot', {});
    const ev = await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'ev-evidence-1', at: '2026-11-08T09:00:00-05:00', operation: P + 'pantry.changed',
      payload: {items: [{ingredient_id: 'ing-milk', quantity: 2000, unit: 'ml', use_by: '2026-11-15'}], by: 'person-eli', note: 'Market run'}}});
    if (ev.status !== 'committed') fail('event', ev);
    seq.confirmations.push({what: 'Infra applies pantry.changed by Eli (2 l milk)', tool: 'env.apply_event', record: {event_id: 'ev-evidence-1', status: ev.status}, app_version: ev.version});
    await nav('Activity');
    const activity = await text('#records');
    if (!activity.includes('Eli')) fail('activity', activity.slice(0, 200));
    await frame('activity', {action: 'Infra applies a pantry.changed event by Eli; open Activity.', expected: 'Eli’s change is listed, in words, at the top.', observed: activity.slice(0, 120)});

    // ---- Phone width ---------------------------------------------------------------------------------
    begin('phone', 'Phone width (390 px)', 'Layout', 'tests/web-browser.cjs (overflow checks)');
    await page.setViewportSize(PHONE);
    for (const [label, name, what] of [['Meal plan', 'week', 'The week as a single column; navigation scrolls sideways.'], ['Shopping list', 'shopping', 'The list as a single column.']]) {
      await nav(label);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) fail('overflow ' + label, overflow);
      await frame(name, {action: label + ' at 390 x 844.', expected: what + ' No horizontal page scroll.', observed: `horizontal overflow ${overflow}px`});
    }
    await nav('Recipes');
    await page.click('[data-record-id="rec-green-curry"]'); await idle();
    await page.locator('.detail h2').scrollIntoViewIfNeeded();
    await frame('recipe', {action: 'Recipes, select the curry, at 390 px.', expected: 'The recipe detail below the list, readable without sideways scroll.', observed: `horizontal overflow ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}px`});
    await nav('Pantry');
    await page.click('[data-item-id="ing-egg"]'); await idle();
    await page.click('.pw-actions button:has-text("Update stock")');
    await dialog('pantry.set').waitFor(WAIT);
    await frame('form', {action: 'Pantry, Eggs, “Update stock” at 390 px.', expected: 'The form fits the screen.', observed: 'Form open'});
    await dialog('pantry.set').locator('button:has-text("Cancel")').click();
    await page.setViewportSize(DESKTOP);
    const unexpected = errors.slice();
    if (unexpected.length) fail('JavaScript errors', unexpected);
    await page.close();

    // ---- Restricted Task profile ---------------------------------------------------------------------
    begin('restricted', 'Read-only Task profile (scenario): no write controls; a forged write is refused', 'Business-only access', 'tests/web-browser.cjs (restricted checks)');
    restricted = await start({app: 'platewright', registry, run: 'evidence-restricted', stateDir, profile: 'scenario'});
    page = await browser.newPage({viewport: DESKTOP}); watch(page);
    await page.goto(restricted.accessUrl); await page.waitForSelector('.pw-day', WAIT); await idle();
    await page.click('button[aria-label="Next week"]'); await idle();
    await page.click('[data-slot-id="2026-11-14:dinner"]'); await idle();
    const controls = await page.locator('.pw-add, .pw-actions button').count();
    if (errors.length) fail('JavaScript errors', errors);
    const status = await page.evaluate(async () => { const s = await (await fetch('/session')).json(); return (await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': s.csrf}, body: JSON.stringify({name: 'platewright.pantry.set', arguments: {id: 'ing-egg', quantity: 1, unit: 'each', expected_version: {epoch: 1, revision: 0}, request_id: 'x'}})})).status; });
    if (controls !== 0 || status !== 403) fail('restricted', [controls, status]);
    seq.confirmations.push({what: 'A pantry.set request sent directly from the restricted page', tool: 'POST /api/call', record: {http_status: status}});
    await frame('no-controls', {action: 'Host started with --profile scenario; next week, Saturday dinner.', expected: 'The same reads, no “Plan a meal”, “Change meal” or other write control; a forged write is refused by the Host.', observed: `${controls} write controls; forged write HTTP ${status}`});
    // The only console error allowed is the browser's report of the refused forged request.
    if (errors.some(e => !/status of 403/.test(e)) || errors.length > 1) fail('JavaScript errors', errors);
    return {schema: 'platewright.gui-evidence.v1', passed: true, app_version: require('../app.json').version, host: 'runtime/web/server.cjs', browser: 'Chromium ' + browser.version(),
      viewports: {desktop: `${DESKTOP.width}x${DESKTOP.height}`, phone: `${PHONE.width}x${PHONE.height}`}, run: 'evidence (sandbox) and evidence-restricted (scenario), fresh state from fixtures/reference.json',
      account: 'platewright-nora (person-nora, Nora Arden, synthetic)', sequences};
  } catch (e) {
    return {schema: 'platewright.gui-evidence.v1', passed: false, error: e.message, sequences, errors};
  } finally {
    await browser?.close(); await mcp?.close(); await infra?.close(); await host?.close(); await restricted?.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}

function markdown(r) {
  const L = ['# Platewright GUI workflow sequences', '',
    `Captured by \`node scripts/capture-gui-evidence.cjs\` (${r.browser}, shared Web Host \`${r.host}\`, Platewright ${r.app_version}; viewports ${r.viewports.desktop} and ${r.viewports.phone}; run: ${r.run}; account ${r.account}). ` +
    'Every frame is a viewport screenshot of the real page after the action, checked for record IDs, ISO dates, vocabulary keys and missing values before it was taken. “MCP” is an independent Agent connection to the same run. The index is [../README.md](../README.md).', ''];
  for (const s of r.sequences) {
    L.push(`## ${s.id}: ${s.title}`, '', `Workflow ${s.workflow}. Same steps asserted in ${s.browser_test}.`, '', '| # | Frame | Action | Expected | Observed |', '| --- | --- | --- | --- | --- |');
    s.frames.forEach((f, i) => L.push(`| ${i + 1} | [${f.file}](${f.file}) (${f.viewport}) | ${f.action} | ${f.expected} | ${String(f.observed).replace(/\|/g, '/').replace(/\n/g, ' ')} |`));
    if (s.confirmations.length) {
      L.push('', 'Persisted state and versions:', '');
      for (const c of s.confirmations) L.push(`- ${c.what}: \`${c.tool}\`${c.arguments ? ' `' + JSON.stringify(c.arguments) + '`' : ''} → \`${JSON.stringify(c.record)}\`${c.app_version ? ' at App version `' + JSON.stringify(c.app_version) + '`' : ''}`);
    }
    L.push('');
  }
  return L.join('\n');
}

main().then(report => {
  if (report.passed && process.argv.includes('--zopfli')) {
    for (const f of fs.readdirSync(out).filter(x => x.endsWith('.png'))) {
      const file = path.join(out, f), tmp = file + '.z.png';
      const z = spawnSync('zopflipng', ['-y', '--lossy_transparent=false', file, tmp], {encoding: 'utf8'});
      if (z.status === 0 && fs.existsSync(tmp)) { if (fs.statSync(tmp).size < fs.statSync(file).size) fs.renameSync(tmp, file); else fs.rmSync(tmp); }
      else { fs.rmSync(tmp, {force: true}); console.error('zopflipng unavailable; PNGs left as captured'); break; }
    }
  }
  const sizes = fs.readdirSync(out).filter(x => x.endsWith('.png')).map(f => fs.statSync(path.join(out, f)).size);
  fs.writeFileSync(path.join(out, 'sequences.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.passed) fs.writeFileSync(path.join(out, 'sequences.md'), markdown(report));
  process.stdout.write(JSON.stringify({passed: report.passed, error: report.error, frames: report.sequences.reduce((n, s) => n + s.frames.length, 0), png_bytes: sizes.reduce((a, b) => a + b, 0), largest_png: Math.max(0, ...sizes)}) + '\n');
  if (!report.passed) process.exitCode = 1;
});
