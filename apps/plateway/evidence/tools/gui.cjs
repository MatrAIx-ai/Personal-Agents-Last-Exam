'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..', '..');
const OUT = path.join(appDir, 'evidence', 'gui');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plateway-gui-evidence-'));
process.env.PALE_WEB_REPORT_DIR = scratch;
const { runWebAcceptance, root } = require('../../tests/web/harness.cjs');
const { Client } = require(path.join(root, 'runtime/client.cjs'));
const { runtimeDigest, hostRevision } = require('./digest.cjs');
const { createRecorder } = require('./recorder.cjs');
const { runProbes } = require('./probes.cjs');
const { chromium } = require('playwright');

const acceptanceSource = fs.readFileSync(path.join(appDir, 'tests/web.browser.cjs'), 'utf8');
const money = cents => '$' + (cents / 100).toFixed(2);
const vstr = v => v.epoch + '.' + v.revision;
const DESKTOP = { width: 1280, height: 1000 }, PHONE = { width: 390, height: 844 };
const RASTER = ['--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'];
const stableIds = page => page.addInitScript(prefix => {
  let n = Number(sessionStorage.getItem('evidence-request-ids') || 0);
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => { n += 1; sessionStorage.setItem('evidence-request-ids', String(n)); return prefix + '-' + String(n).padStart(4, '0'); } });
}, 'evidence');
const sequences = [];
const extra = {};
const read = file => JSON.parse(fs.readFileSync(path.join(appDir, file), 'utf8'));
const WRITES = new Set(read('tools.json').filter(x => (x.inputSchema.required || []).includes('request_id')).map(x => x.name));
const PREVIEWS = new Set(['plateway.checkout.preview', 'plateway.orders.cancel.preview']);

const recorders = [], between = [];
function recorder(t, session) {
  const { page } = t;
  const R = createRecorder({ page, infra: t.infra, host: t.host, Client, session, writes: WRITES, previews: PREVIEWS });
  recorders.push({ session, R });
  let seq = null, n = 0;
  const begin = async (id, title, workflow, scope) => { await R.begin(id); seq = { id, title, workflow, scope, run: t.host.run, steps: [] }; sequences.push(seq); n = 0; fs.mkdirSync(path.join(OUT, id), { recursive: true }); };
  const step = async ({ name, action, expected, check, observe, acceptance, show, shows, top, text, submits }) => {
    n += 1;
    if (acceptance && !acceptanceSource.includes(acceptance)) throw Error('Unknown acceptance check: ' + acceptance);
    const file = path.join(seq.id, String(n).padStart(2, '0') + '-' + name + '.png');
    const prepare = async () => {
      await t.idle();
      await page.mouse.move(1, 1);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.evaluate(() => scrollTo(0, 0));
      const loc = typeof show === 'string' ? page.locator(show).first() : show.first();
      await loc.waitFor();
      if (top) await loc.evaluate(e => { e.scrollIntoView({ block: 'start' }); scrollBy(0, -230); });
      else await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox(), vp = page.viewportSize();
      assert.ok(box && box.y >= 0 && box.y + box.height <= vp.height + 0.5 && await loc.isVisible(), seq.title + ', step ' + n + ': the outcome (' + shows + ') is not fully on screen');
      if (text) assert.ok((await loc.innerText()).includes(text), seq.title + ', step ' + n + ': the outcome on screen does not read ' + JSON.stringify(text));
    };
    await t.idle();
    await R.step({
      check: async () => { const ok = await check(); t.check(seq.title + ', step ' + n + ': ' + expected, ok); return ok; },
      observe,
      prepare,
      record: ({ version, snapshot: s, observed, calls }) => {
        if (submits) assert.ok(calls.some(c => c.kind === 'write' || c.kind === 'forced call'), seq.title + ', step ' + n + ': the action submits a write, but the step records ' + (calls.length ? 'only ' + [...new Set(calls.map(c => c.client))].join(', ') : 'no MCP call'));
        seq.steps.push({ step: n, action, expected, result: 'as expected', submits: !!submits, on_screen: shows + (text ? ': “' + text + '”' : ''), observed, version: vstr(version), virtual_now: s.virtual_now, mcp_calls: calls, acceptance_check: acceptance || null, screenshot: file });
      },
      capture: () => page.screenshot({ path: path.join(OUT, file) })
    });
  };
  const aside = async (label, fn) => { const r = await R.aside(label, fn); between.push({ run: t.host.run, owner: label, calls: r.calls }); return r; };
  return { ...R, begin, step, aside };
}

function helpers(t) {
  const { page } = t;
  const at = sel => page.locator(sel);
  const nav = name => page.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click();
  const refresh = async () => { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await t.settled(); };
  const flash = async text => { await page.locator('[data-flash]', { hasText: text }).waitFor(); await t.settled(); };
  const alert = async (code, text) => { const l = page.locator('[role=alert][data-code=' + code + ']'); await (text ? l.filter({ hasText: text }) : l).first().waitFor(); await t.settled(); };
  const alertAt = code => page.locator('[role=alert][data-code=' + code + ']');
  const text = async sel => (await at(sel).first().innerText()).trim();
  const data = () => t.data();
  const cart = async () => (await data()).cart;
  const order = async id => (await data()).orders.find(o => o.id === id);
  const article = id => page.locator('article[data-order="' + id + '"]');
  const inOrder = (id, words) => article(id).getByText(words, { exact: false });
  const open = async id => { await at('[data-order-id="' + id + '"]').click(); await article(id).waitFor(); await t.settled(); };
  const pickDish = async (restaurant, item) => {
    await nav('Restaurants');
    await at('[data-restaurant-id=' + restaurant + ']').click();
    await at('[data-item-id=' + item + ']').click();
    await at('[data-action=add-to-cart], [data-conflict=dish]').first().waitFor();
    await t.settled();
  };
  const preview = async () => { await at('[data-action=preview]').click(); await at('[data-action=place-order]').waitFor(); await t.settled(); return Number(await at('[data-total]').getAttribute('data-total')); };
  const lineSummary = c => c.lines.map(l => ({ id: l.id, item: l.item_id, options: l.option_ids, quantity: l.quantity, label: l.label }));
  const orderSummary = o => o && ({ id: o.id, status: o.status, charged: o.charge ? money(o.charge.amount_cents) : null, refunds: o.refunds.map(r => money(r.amount_cents) + ' ' + r.reason), rating: o.rating ? { stars: o.rating.stars, text: o.rating.text } : null });
  return { at, nav, refresh, flash, alert, alertAt, text, data, cart, order, article, inOrder, open, pickDish, preview, lineSummary, orderSummary };
}

async function steps(t) {
  const { page } = t;
  await page.setViewportSize(DESKTOP);
  await stableIds(page);
  const R = recorder(t, 'main');
  const { begin, step, agentRead, agentWrite, event, advance } = R;
  const { at, nav, refresh, flash, alert, alertAt, text, data, cart, order, article, inOrder, open, pickDish, preview, lineSummary, orderSummary } = helpers(t);

  await t.open('[data-restaurant-id]');
  extra.start = { virtual_now: (await t.snapshot()).virtual_now, seed_id: (await data()).seed_id, account_id: (await data()).account_id, owner_person_id: (await data()).owner_person_id, time_zone: (await data()).time_zone };

  await begin('01-browse', 'Browse and search restaurants', 'Browse and search', 'Required (W1)');
  const home = (await agentRead('plateway.restaurants.search', { address_id: 'a-1' }, r => r.restaurants.map(x => x.id + ' ' + x.status))).restaurants;
  await step({ name: 'start', action: 'Open the page on a fresh run (fixture loaded, Wednesday 18 November 2026, 12:00 in New York)', expected: 'The restaurants that deliver to Home, each with its status, delivery fee, estimate and rating; the list says how many deliver there', acceptance: 'The list says how many restaurants deliver to the chosen address', show: '[data-delivery-note]', shows: 'the delivery note', text: home.length + ' restaurants deliver to Home.',
    check: async () => JSON.stringify(await page.locator('[data-restaurant-id]').evaluateAll(e => e.map(x => x.dataset.restaurantId))) === JSON.stringify(home.map(r => r.id)),
    observe: d => ({ restaurants_delivering_to_home: home.map(r => r.id), cart_lines: d.cart.lines.length, orders: d.orders.length }) });
  const curry = (await agentRead('plateway.restaurants.search', { address_id: 'a-1', text: 'curry' }, r => r.restaurants.map(x => x.id))).restaurants.map(r => r.id);
  await at('.toolbar input[type=search]').fill('curry');
  await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('[data-restaurant-id]')].map(e => e.dataset.restaurantId)) === JSON.stringify(ids), curry);
  await step({ name: 'search', action: 'Type "curry" in the search box', expected: 'Exactly the restaurants the App returns for "curry" (by restaurant, dish or cuisine name)', acceptance: 'Text search shows exactly the restaurants the App returns for "curry"', show: '[data-restaurant-id=r-1]', shows: 'the only listed restaurant', text: 'Basil Row',
    check: async () => curry.length === 1, observe: () => ({ shown: curry }) });
  await at('.toolbar input[type=search]').fill('');
  await at('[data-field=search-cuisine]').selectOption('mexican');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-restaurant-id]')].map(e => e.dataset.restaurantId).join() === 'r-4');
  await step({ name: 'cuisine', action: 'Clear the search and choose the cuisine Mexican', expected: 'Only Masa Verde', acceptance: 'The cuisine filter narrows the list to Masa Verde', show: '[data-restaurant-id=r-4]', shows: 'the only listed restaurant', text: 'Masa Verde',
    check: async () => await page.locator('[data-restaurant-id]').count() === 1, observe: () => ({ shown: ['r-4'] }) });
  await at('[data-field=search-cuisine]').selectOption('');
  const office = (await agentRead('plateway.restaurants.search', { address_id: 'a-2' }, r => r.restaurants.map(x => x.id))).restaurants.map(r => r.id);
  await at('[data-field=search-address]').selectOption('a-2');
  await page.locator('[data-delivery-note]', { hasText: 'to Office' }).waitFor();
  await step({ name: 'office', action: 'Clear the cuisine and switch the delivery address to Office', expected: 'Only the restaurants that deliver to Office, and the list says how many', acceptance: 'Switching to the Office address lists only the restaurants that deliver there and says so', show: '[data-delivery-note]', shows: 'the delivery note', text: office.length + ' restaurants deliver to Office.',
    check: async () => JSON.stringify(await page.locator('[data-restaurant-id]').evaluateAll(e => e.map(x => x.dataset.restaurantId))) === JSON.stringify(office), observe: () => ({ shown: office }) });
  await R.aside('the preparation between 01-browse and 02-restaurant-dish: the delivery address goes back to Home', async () => {
    await at('[data-field=search-address]').selectOption('a-1');
    await page.locator('[data-delivery-note]', { hasText: 'to Home' }).waitFor();
    await t.settled();
  });

  await begin('02-restaurant-dish', 'Restaurant, menu and a dish with options', 'Restaurant, menu and dish with options', 'Required (W1)');
  await at('[data-restaurant-id=r-2]').click();
  await at('[data-status-line=closed]').waitFor();
  await agentRead('plateway.restaurants.get', { restaurant_id: 'r-2' }, r => r.restaurant.status);
  await step({ name: 'closed-restaurant', action: 'Open Lantern Noodle House', expected: 'Closed now, opens today at 5:00 PM, delivery can be scheduled; weekly hours; menu with allergens and a sold-out dish', acceptance: 'A closed restaurant says when it opens, that delivery can be scheduled, and shows its weekly hours', show: '[data-status-line]', shows: 'the status line', text: 'Closed now · opens today at 5:00 PM · you can schedule',
    check: async () => (await text('[data-hours=r-2]')).includes('5:00 PM – 1:00 AM'), observe: d => ({ restaurant: 'r-2', sold_out: d.dishes.filter(x => x.restaurant_id === 'r-2' && !x.available).map(x => x.name) }) });
  await at('[data-restaurant-id=r-1]').click();
  await at('[data-status-line=open]').waitFor();
  await agentRead('plateway.restaurants.get', { restaurant_id: 'r-1' }, r => r.restaurant.status);
  await step({ name: 'open-restaurant', action: 'Open Basil Row', expected: 'Open now, closes at 9:00 PM; its menu with prices and allergens', acceptance: 'An open restaurant says when it closes', show: '[data-status-line]', shows: 'the status line', text: 'Open now · closes at 9:00 PM',
    check: async () => true, observe: () => ({ restaurant: 'r-1' }) });
  await at('[data-item-id=mi-1]').click();
  await at('[data-action=add-to-cart]').waitFor();
  await t.settled();
  const padThai = (await agentRead('plateway.menu_items.get', { item_id: 'mi-1' }, r => r.item.option_groups.map(g => g.name + (g.required ? ' (required, ' + g.min + '-' + g.max + ')' : ' (optional, up to ' + g.max + ')')))).item;
  await step({ name: 'dish-options', action: 'Open Pad Thai', expected: 'Its option groups with their limits (Spice level: choose 1), quantity and an optional receipt label', show: '[data-options-for=mi-1]', top: true, shows: 'the dish\'s option groups', text: 'Spice level · choose 1',
    check: async () => await at('[data-option=op-2]').count() === 1, observe: () => ({ item: 'mi-1', groups: padThai.option_groups.map(g => g.name) }) });
  const v0 = await t.version();
  await at('[data-action=add-to-cart]').click();
  await alert('invalid_option', 'Choose 1 for Spice level.');
  await step({ name: 'required-option-missing', action: 'Press Add to cart without choosing a spice level', expected: 'The rule “Choose 1 for Spice level.” is shown and nothing is written', acceptance: 'Adding without the required option shows the rule and writes nothing', show: alertAt('invalid_option'), shows: 'the refusal', text: 'Choose 1 for Spice level.',
    check: async () => (await cart()).lines.length === 0 && JSON.stringify(await t.version()) === JSON.stringify(v0), observe: d => ({ cart_lines: d.cart.lines.length, version_unchanged: true }) });
  await at('[data-option=op-2]').check();
  await at('[data-option=op-5]').check();
  await at('[data-field=quantity]').selectOption('2');
  await at('[data-field=label]').fill('For Sam');
  await at('[data-action=add-to-cart]').click();
  await flash('Added Pad Thai');
  await step({ name: 'added', submits: true, action: 'Choose a spice level and an extra, quantity 2, label “For Sam”, then Add to cart', expected: '“Added Pad Thai”; the cart holds that line with its options, quantity and label', acceptance: 'Add to cart commits the dish with its options, quantity and label', show: '[data-flash]', shows: 'the confirmation', text: 'Added Pad Thai',
    check: async () => { const c = await cart(); return c.lines.length === 1 && JSON.stringify(c.lines[0].option_ids) === '["op-2","op-5"]' && c.lines[0].quantity === 2 && c.lines[0].label === 'For Sam'; }, observe: d => ({ cart: lineSummary(d.cart) }) });

  await begin('03-cart', 'Edit the cart', 'Cart edit', 'Required (W1)');
  await nav('Cart');
  await t.idle();
  const line = (await cart()).lines[0];
  await step({ name: 'cart', action: 'Open Cart', expected: 'The line with its options and label, − and + buttons, Edit and Remove, and the checkout form', show: '[data-quantity="' + line.id + '"]', shows: 'the line\'s quantity', text: '2',
    check: async () => true, observe: d => ({ cart: lineSummary(d.cart) }) });
  await page.getByRole('button', { name: 'Increase Pad Thai', exact: true }).click();
  await flash('Pad Thai: quantity 3');
  await step({ name: 'plus', submits: true, action: 'Press + on Pad Thai', expected: 'Quantity 3 in the App and on the page', acceptance: 'The + button raises the quantity in the App', show: '[data-quantity="' + line.id + '"]', shows: 'the line\'s quantity', text: '3',
    check: async () => (await cart()).lines[0].quantity === 3, observe: d => ({ cart: lineSummary(d.cart) }) });
  await at('[data-action=edit-line][data-line-id="' + line.id + '"]').click();
  await at('[data-action=save-line]').waitFor();
  await at('[data-field=label]').fill('x'.repeat(41));
  const v1 = await t.version();
  await at('[data-action=save-line]').click();
  await alert('invalid_option', 'Labels are limited to 40 characters.');
  await step({ name: 'label-too-long', action: 'Edit the line and enter a 41-character label, then Save', expected: 'Refused in the form (“Labels are limited to 40 characters.”); nothing is written', acceptance: 'A 41-character label is refused in the form and nothing is written', show: alertAt('invalid_option'), shows: 'the refusal', text: 'Labels are limited to 40 characters.',
    check: async () => (await cart()).lines[0].label === 'For Sam' && JSON.stringify(await t.version()) === JSON.stringify(v1), observe: d => ({ cart: lineSummary(d.cart), version_unchanged: true }) });
  await at('[data-field=quantity]').selectOption('2');
  await at('[data-field=label]').fill('No peanuts, please');
  await at('[data-action=save-line]').click();
  await flash('Updated Pad Thai');
  await step({ name: 'edited', submits: true, action: 'Set quantity 2 and the label “No peanuts, please”, then Save', expected: '“Updated Pad Thai”; the App holds quantity 2 and the new label', acceptance: 'Editing a cart line changes its quantity and label in the App', show: '[data-label="' + line.id + '"]', shows: 'the line\'s label', text: 'No peanuts, please',
    check: async () => { const l = (await cart()).lines[0]; return l.quantity === 2 && l.label === 'No peanuts, please' && (await text('[data-quantity="' + line.id + '"]')) === '2'; }, observe: d => ({ cart: lineSummary(d.cart) }) });
  await at('[data-action=remove-line][data-line-id="' + line.id + '"]').click();
  await flash('Removed Pad Thai');
  await step({ name: 'removed', submits: true, action: 'Press Remove', expected: '“Removed Pad Thai” with Undo; the cart is empty in the App', acceptance: 'Removing the line empties the cart in the App', show: '[data-flash]', shows: 'the confirmation with Undo', text: 'Removed Pad Thai',
    check: async () => (await cart()).lines.length === 0 && await at('[data-action=undo-remove]').count() === 1, observe: d => ({ cart: lineSummary(d.cart) }) });
  await at('[data-action=undo-remove]').click();
  await flash('Put Pad Thai back');
  const back = (await cart()).lines[0];
  await step({ name: 'undo', submits: true, action: 'Press Undo', expected: 'The same dish, options, quantity and label are back in the cart (as a new line)', acceptance: 'Undo puts the removed line back with its options, quantity and label', show: '[data-label="' + back.id + '"]', shows: 'the restored line\'s label', text: 'No peanuts, please',
    check: async () => { const l = (await cart()).lines; return l.length === 1 && l[0].item_id === 'mi-1' && JSON.stringify(l[0].option_ids) === '["op-2","op-5"]' && l[0].quantity === 2 && l[0].label === 'No peanuts, please'; }, observe: d => ({ cart: lineSummary(d.cart) }) });
  const added = await agentWrite('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1 });
  const stillOne = await page.locator('[data-action=remove-line]').count() === 1;
  await refresh();
  await at('[data-line-id="' + added.line_id + '"]').first().waitFor();
  await step({ name: 'independent-update', submits: true, action: 'A second Agent MCP client adds 1 × Tom Yum Soup with plateway.cart.add_item; then press Refresh', expected: 'Before Refresh the page still shows one line; after Refresh both lines', show: '[data-quantity="' + added.line_id + '"]', shows: 'the line written through MCP', text: '1',
    check: async () => stillOne && (await cart()).lines.length === 2, observe: d => ({ page_before_refresh: '1 line', cart: lineSummary(d.cart) }) });
  await page.reload();
  await t.idle();
  await nav('Cart');
  await t.idle();
  await step({ name: 'reload', action: 'Reload the browser page and open Cart', expected: 'The same two lines after the reload', show: '[data-quantity="' + added.line_id + '"]', shows: 'the second line after the reload', text: '1',
    check: async () => await page.locator('[data-action=remove-line]').count() === 2, observe: d => ({ cart: lineSummary(d.cart) }) });
  const v2 = await t.version();
  await pickDish('r-4', 'mi-23');
  await step({ name: 'other-restaurant', action: 'Open Elote at Masa Verde while the cart holds Basil Row dishes', expected: 'The page says a cart holds one restaurant\'s dishes and offers Clear cart in place of Add; nothing is written', acceptance: 'A dish from another restaurant than the cart’s shows the conflict and Clear cart in place of Add as soon as it opens, writing nothing', show: '[data-conflict=dish]', shows: 'the one-restaurant notice', text: 'a cart holds one restaurant',
    check: async () => await at('[data-action=clear-cart]').count() === 1 && await at('[data-action=add-to-cart]').count() === 0 && JSON.stringify(await t.version()) === JSON.stringify(v2), observe: d => ({ cart_restaurant: d.cart.restaurant_id, cart_lines: d.cart.lines.length, version_unchanged: true }) });

  await begin('04-checkout-asap', 'Check out as soon as possible', 'Checkout, as soon as possible and scheduled', 'Required (W1)');
  await nav('Cart');
  await t.idle();
  await at('[data-field=address_id]').selectOption('a-1');
  await at('[data-field=card_id]').selectOption('c-1');
  await at('[data-field=tip]').fill('2.00');
  const before = (await data()).orders.length, vp = await t.version();
  const total = await preview();
  const quoted = await agentRead('plateway.checkout.preview', { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 200 }, q => ({ subtotal: money(q.subtotal_cents), delivery: money(q.fees.delivery_cents), service: money(q.fees.service_cents), tax: money(q.tax_cents), tip: money(q.tip_cents), total: money(q.total_cents) }));
  await step({ name: 'preview', action: 'Home, card •••• 4242, as soon as possible, tip $2.00; press Preview total', expected: 'Address, card and time; every line, delivery fee, service fee, tax, tip and total, as the App\'s own preview computes them; nothing is stored', acceptance: 'Preview shows every line subtotal, each fee (including the small-order fee), tax once, tip and the total as the App computes them, with the address and card, and stores nothing', show: '[data-total]', shows: 'the previewed total', text: money(quoted.total_cents),
    check: async () => total === quoted.total_cents && JSON.stringify(await t.version()) === JSON.stringify(vp), observe: () => ({ total: money(total), version_unchanged: true }) });
  await at('[data-action=place-order]').click();
  await at('article[data-order][data-status=submitted]').waitFor();
  await t.settled();
  const first = await at('article[data-order]').getAttribute('data-order');
  await agentRead('plateway.orders.get', { order_id: first }, r => r.order.status);
  await step({ name: 'placed', submits: true, action: 'Press Place order', expected: 'One new order waiting for the restaurant, charged the previewed total; the cart is empty; a placed notice is written', acceptance: 'Place order creates exactly one order to the previewed address, charged the previewed total', show: inOrder(first, 'Total charged'), shows: 'the Total charged row',
    check: async () => { const d = await data(), o = d.orders.find(x => x.id === first); return d.orders.length === before + 1 && o.charge.amount_cents === total && d.cart.lines.length === 0 && (await article(first).innerText()).includes(money(total)); },
    observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)), cart_lines: d.cart.lines.length, last_notice: d.notices.at(-1).kind }) });
  await page.reload();
  await t.idle();
  await at('[data-order-id="' + first + '"]').waitFor();
  await step({ name: 'reload', action: 'Reload the browser page', expected: 'The page reopens Orders with the new order', acceptance: 'After a reload the page reopens Orders and still shows the new order', show: '[data-order-id="' + first + '"]', shows: 'the new order in the list', text: 'Waiting for the restaurant',
    check: async () => true, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)) }) });

  await begin('05-tracking', 'Follow the order', 'Order tracking', 'Required (W2)');
  await open(first);
  await event({ event_id: 'evidence-accept-1', at: '2026-11-18T12:05:00-05:00', operation: 'order.accepted', payload: { order_id: first } });
  await step({ name: 'accepted-before-refresh', action: 'Infra applies order.accepted at 12:05 (the restaurant accepts), as a task runner would; the page is not refreshed', expected: 'The page still shows the earlier state (waiting for the restaurant) while the App holds preparing', acceptance: 'Before Refresh the page still shows the earlier state', show: '[data-order-id="' + first + '"]', shows: 'the order in the list', text: 'Waiting for the restaurant',
    check: async () => await at('article[data-status=submitted]').count() === 1, observe: d => ({ app_status: d.orders.find(o => o.id === first).status }) });
  await refresh();
  await at('article[data-order="' + first + '"][data-status=preparing]').waitFor();
  await step({ name: 'preparing', action: 'Press Refresh', expected: 'Preparing, with the expected arrival', acceptance: 'After an Infra acceptance, Refresh shows the order as preparing', show: '[data-order-id="' + first + '"]', shows: 'the order in the list', text: 'Preparing',
    check: async () => true, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)), estimated_delivery_at: d.orders.find(o => o.id === first).estimated_delivery_at }) });
  await event({ event_id: 'evidence-delay-1', at: '2026-11-18T12:15:00-05:00', operation: 'order.delayed', payload: { order_id: first, estimated_delivery: '2026-11-18T12:55:00-05:00' } });
  await refresh();
  await step({ name: 'delayed', action: 'Infra applies order.delayed at 12:15 with a new estimate of 12:55; press Refresh', expected: 'The new expected arrival', show: '[data-order-id="' + first + '"]', shows: 'the order in the list', text: 'arriving about 12:55 PM',
    check: async () => true, observe: d => ({ estimated_delivery_at: d.orders.find(o => o.id === first).estimated_delivery_at, last_notice: d.notices.at(-1).kind }) });
  await event({ event_id: 'evidence-pickup-1', at: '2026-11-18T12:30:00-05:00', operation: 'order.picked_up', payload: { order_id: first } });
  await refresh();
  await at('article[data-order="' + first + '"][data-status=picked_up]').waitFor();
  const lateCancel = await agentRead('plateway.orders.cancel.preview', { order_id: first }, r => ({ status: r.status, message: r.message }));
  await step({ name: 'on-the-way', action: 'Infra applies order.picked_up at 12:30; press Refresh', expected: 'On the way; Cancel order is no longer offered, and a cancel preview through the Agent MCP interface is refused (invalid_state)', show: '[data-order-id="' + first + '"]', shows: 'the order in the list', text: 'On the way',
    check: async () => await at('[data-action=cancel-order]').count() === 0 && lateCancel.status === 'invalid_state', observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)) }) });
  await event({ event_id: 'evidence-deliver-1', at: '2026-11-18T12:50:00-05:00', operation: 'order.delivered', payload: { order_id: first } });
  await refresh();
  await at('article[data-order="' + first + '"][data-status=delivered]').waitFor();
  await step({ name: 'delivered', action: 'Infra applies order.delivered at 12:50; press Refresh', expected: 'Delivered, with Report a problem and Rate order offered', show: article(first).locator('[data-action=report-issue]'), shows: 'the Report a problem control', text: 'Report a problem',
    check: async () => await at('[data-action=rate-order]').count() === 1 && (await article(first).innerText()).includes('Delivered'), observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)), delivered_at: d.orders.find(o => o.id === first).delivered_at }) });

  await begin('06-cancel', 'Cancel an order', 'Cancel', 'Required (W3)');
  await open('o-11');
  const vc = await t.version();
  await at('[data-action=cancel-order]').click();
  await at('[data-kept]').waitFor();
  await t.settled();
  const quote = await agentRead('plateway.orders.cancel.preview', { order_id: 'o-11' }, q => ({ refund: money(q.refund_cents), kept: money(q.kept_cents) }));
  await step({ name: 'preview-preparing', action: 'Open the Masa Verde order that is being prepared and press Cancel order', expected: 'The refund (delivery fee and tip) and the amount kept, as the App computes them; nothing changes yet', acceptance: 'The cancel preview of a preparing order shows the App refund and the amount kept', show: '[data-kept]', shows: 'the amount kept', text: money(quote.kept_cents),
    check: async () => Number(await at('[data-refund]').getAttribute('data-refund')) === quote.refund_cents && Number(await at('[data-kept]').getAttribute('data-kept')) === quote.kept_cents && JSON.stringify(await t.version()) === JSON.stringify(vc), observe: d => ({ order: orderSummary(d.orders.find(o => o.id === 'o-11')), version_unchanged: true }) });
  await at('[data-action=keep-order]').click();
  await t.settled();
  await step({ name: 'kept', action: 'Press Keep order', expected: 'The preview closes and the order is unchanged', acceptance: 'Keep order closes the preview and changes nothing', show: article('o-11').locator('[data-action=cancel-order]'), shows: 'the Cancel order control again', text: 'Cancel order',
    check: async () => (await order('o-11')).status === 'preparing' && await at('[data-kept]').count() === 0 && JSON.stringify(await t.version()) === JSON.stringify(vc), observe: d => ({ order: orderSummary(d.orders.find(o => o.id === 'o-11')), version_unchanged: true }) });
  await open('o-12');
  await at('[data-action=cancel-order]').click();
  await at('[data-action=confirm-cancel]').waitFor();
  await t.settled();
  const charge12 = (await order('o-12')).charge.amount_cents;
  await step({ name: 'preview-scheduled', action: 'Open the scheduled Olive & Ember order and press Cancel order', expected: 'A full refund and nothing kept', acceptance: 'Cancelling the scheduled order previews a full refund', show: '[data-kept]', shows: 'the amount kept', text: '$0.00',
    check: async () => Number(await at('[data-refund]').getAttribute('data-refund')) === charge12 && Number(await at('[data-kept]').getAttribute('data-kept')) === 0, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === 'o-12')) }) });
  await at('[data-action=confirm-cancel]').click();
  await at('article[data-order=o-12][data-status=cancelled]').waitFor();
  await t.settled();
  await step({ name: 'cancelled', submits: true, action: 'Press Confirm cancellation', expected: 'Cancelled by you, one refund equal to the charge, net charge $0.00', acceptance: 'Confirming cancels the order with one full refund', show: '[data-net]', shows: 'the net charge', text: '$0.00',
    check: async () => { const o = await order('o-12'); return o.status === 'cancelled' && o.refunds.length === 1 && o.refunds[0].amount_cents === charge12 && (await article('o-12').innerText()).includes('cancelled by you'); }, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === 'o-12')), cancellation: d.orders.find(o => o.id === 'o-12').cancellation }) });

  await begin('07-report', 'Report a missing or wrong item', 'Report missing or incorrect items', 'Required (W4)');
  await open(first);
  await at('[data-action=report-issue]').click();
  await at('[data-action=send-report]').waitFor();
  const soup = (await order(first)).lines.find(l => l.item_id === 'mi-3');
  await at('[data-report-line="' + soup.id + '"]').check();
  await at('[data-report-kind="' + soup.id + '"]').selectOption('missing');
  await t.settled();
  await step({ name: 'form', action: 'On the delivered order press Report a problem, tick Tom Yum Soup and choose “missing”', expected: 'The delivered lines, each with missing or wrong; nothing is sent yet', show: '[data-action=send-report]', shows: 'the Send report control', text: 'Send report',
    check: async () => (await order(first)).refunds.length === 0 && await at('[data-report-line="' + soup.id + '"]').isChecked(), observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)) }) });
  await at('[data-action=send-report]').click();
  await flash('Report sent');
  await step({ name: 'sent', submits: true, action: 'Press Send report', expected: 'That line\'s subtotal and tax are refunded; the refunds name the dish', acceptance: 'Reporting a missing item on the delivered order refunds that line in full', show: inOrder(first, 'Reported item: Tom Yum Soup'), shows: 'the refund row', text: 'Reported item: Tom Yum Soup',
    check: async () => { const o = await order(first), r = o.refunds.find(x => x.line_id === soup.id); return !!r && r.amount_cents === soup.subtotal_cents + soup.tax_cents && o.lines.find(l => l.id === soup.id).report?.kind === 'missing'; },
    observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)), refund_line: soup.id, last_notice: d.notices.at(-1).kind }) });
  await open('o-10');
  const late = await agentWrite('plateway.orders.report_issue', { order_id: 'o-10', lines: [{ line_id: (await order('o-10')).lines[0].id, kind: 'missing' }] });
  await step({ name: 'window-closed', submits: true, action: 'Open the Lantern Noodle House order delivered on Sunday 15 November; a second Agent MCP client also sends plateway.orders.report_issue for it', expected: 'No Report control; the page says problems could be reported until Tue, Nov 17, 8:33 PM; Rate is still offered. The MCP report is refused with window_closed and changes nothing', acceptance: 'After its 48-hour window an order offers no Report control and says when reporting closed, while Rate stays', show: '[data-report-closed]', shows: 'the closed-window note', text: 'Problems could be reported until Tue, Nov 17, 8:33 PM',
    check: async () => await at('[data-action=report-issue]').count() === 0 && await at('[data-action=rate-order]').count() === 1 && late.status === 'window_closed' && (await order('o-10')).refunds.length === 0, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === 'o-10')) }) });

  await begin('08-rate', 'Rate an order', 'Rate', 'Required (W4)');
  await open(first);
  await at('[data-action=rate-order]').click();
  await at('[data-stars="4"]').check();
  await at('[data-field=rating-text]').fill('Arrived hot.');
  await t.settled();
  await step({ name: 'form', action: 'On the delivered order press Rate order, choose 4 stars and write “Arrived hot.”', expected: 'The rating form with 1 to 5 stars and an optional comment; nothing is sent yet', show: '[data-action=send-rating]', shows: 'the Submit rating control', text: 'Submit rating',
    check: async () => (await order(first)).rating === null && await at('[data-stars="4"]').isChecked(), observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)) }) });
  await at('[data-action=send-rating]').click();
  await flash('Thanks for rating');
  await step({ name: 'rated', submits: true, action: 'Press Submit rating', expected: 'The App stores 4 stars and the comment, and the order shows them; Rate is no longer offered', acceptance: 'Rating the delivered order stores the stars and the comment', show: inOrder(first, '★★★★ · Arrived hot.'), shows: 'the saved rating', text: '★★★★ · Arrived hot.',
    check: async () => { const o = await order(first); return o.rating?.stars === 4 && o.rating.text === 'Arrived hot.' && await at('[data-action=rate-order]').count() === 0; }, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)) }) });
  await agentWrite('plateway.orders.rate', { order_id: 'o-10', stars: 5, text: 'Dumplings were great.' });
  await open('o-10');
  await refresh();
  await step({ name: 'independent-update', submits: true, action: 'A second Agent MCP client rates the Lantern Noodle House order 5 stars with plateway.orders.rate; open that order and press Refresh', expected: 'The page shows the 5-star rating written through MCP and no Rate control', show: inOrder('o-10', '★★★★★ · Dumplings were great.'), shows: 'the rating written through MCP', text: '★★★★★ · Dumplings were great.',
    check: async () => await at('[data-action=rate-order]').count() === 0 && (await order('o-10')).rating?.stars === 5, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === 'o-10')) }) });

  await begin('09-checkout-scheduled', 'Schedule an order', 'Checkout, as soon as possible and scheduled', 'Required (W1)');
  await pickDish('r-1', 'mi-3');
  await at('[data-action=add-to-cart]').click();
  await flash('Added Tom Yum Soup');
  await nav('Cart');
  await t.idle();
  await at('[data-field=address_id]').selectOption('a-1');
  await at('[data-field=card_id]').selectOption('c-1');
  await at('[data-field=when-scheduled]').check();
  for (const [sel, value] of [['[data-field=delivery-date]', '2026-11-19'], ['[data-field=delivery-time]', '19:00']]) { const f = at(sel); await f.fill(value); await f.press('Tab'); }
  await t.settled();
  await step({ name: 'schedule', submits: true, action: 'Add Tom Yum Soup, open Cart, choose Schedule for later and enter Thursday 19 November, 19:00', expected: 'The restaurant\'s hours for that day; the small-order fee note for a subtotal under $12.00', acceptance: 'Scheduling shows the restaurant hours for the chosen day', show: '[data-hours-hint]', shows: 'the hours for the chosen day', text: 'Basil Row on Thursday: 11:00 AM – 9:00 PM.',
    check: async () => await at('[data-small-order-note]').count() === 1, observe: d => ({ cart: lineSummary(d.cart) }) });
  await at('[data-field=tip]').fill('1.50');
  const scheduledTotal = await preview();
  const planned = await agentRead('plateway.checkout.preview', { address_id: 'a-1', card_id: 'c-1', when: { mode: 'scheduled', delivery_at: '2026-11-19T19:00:00-05:00' }, tip_cents: 150 }, q => ({ delivery_at: q.delivery_at, release_at: q.release_at, small_order_fee: money(q.fees.small_order_cents), total: money(q.total_cents) }));
  await step({ name: 'preview', action: 'Tip $1.50; press Preview total', expected: 'Delivery Thu, Nov 19, 7:00 PM EST and the App\'s release time; the small-order fee in the receipt; the App\'s total', acceptance: 'A scheduled preview shows the App delivery and release times in New York time', show: '[data-release]', shows: 'the time the order is sent to the restaurant', text: 'Thu, Nov 19',
    check: async () => scheduledTotal === planned.total_cents && await at('[data-delivery]').getAttribute('data-delivery') === planned.delivery_at && await at('[data-release]').getAttribute('data-release') === planned.release_at, observe: () => ({ total: money(scheduledTotal) }) });
  await at('[data-action=place-order]').click();
  await at('article[data-order][data-status=scheduled]').waitFor();
  await t.settled();
  const scheduledId = await at('article[data-order]').getAttribute('data-order');
  await step({ name: 'placed', submits: true, action: 'Press Place order', expected: 'A scheduled order for Thursday 19:00 New York time', acceptance: 'Scheduled checkout creates a scheduled order for Thursday 19:00 New York time', show: '[data-order-id="' + scheduledId + '"]', shows: 'the scheduled order in the list', text: 'Scheduled for Thu, Nov 19, 7:00 PM',
    check: async () => { const o = await order(scheduledId); return o.status === 'scheduled' && o.delivery_at === '2026-11-19T19:00:00-05:00'; }, observe: d => { const o = d.orders.find(x => x.id === scheduledId); return { order: orderSummary(o), delivery_at: o.delivery_at, release_at: o.release_at }; } });

  await begin('10-checkout-refused', 'Checkout refused: declining card and closed restaurant', 'Checkout, as soon as possible and scheduled', 'Required (W1), failure paths');
  await pickDish('r-1', 'mi-3');
  await at('[data-action=add-to-cart]').click();
  await flash('Added Tom Yum Soup');
  await nav('Cart');
  await t.idle();
  await at('[data-field=when-asap]').check();
  await at('[data-field=card_id]').selectOption('c-2');
  const count = (await data()).orders.length;
  await preview();
  await at('[data-action=place-order]').click();
  await alert('payment_failed');
  await step({ name: 'declined', submits: true, action: 'Add Tom Yum Soup, open Cart, choose the card that declines (•••• 0005), Preview total, then Place order', expected: 'payment_failed is shown; no order is created and the cart is kept', acceptance: 'A declining card shows payment_failed and creates no order', show: alertAt('payment_failed'), shows: 'the refusal', text: 'The card was declined.',
    check: async () => (await data()).orders.length === count && (await cart()).lines.length === 1, observe: d => ({ orders: d.orders.length, cart_lines: d.cart.lines.length }) });
  extra.expired_card_disabled = await at('[data-field=card_id] option[value=c-3]').evaluate(o => o.disabled && o.textContent.includes('expired'));
  await at('[data-action=remove-line]').first().click();
  await flash('Removed Tom Yum Soup');
  await pickDish('r-2', 'mi-10');
  await at('[data-action=add-to-cart]').click();
  await flash('Added Scallion Pancake');
  await nav('Cart');
  await t.idle();
  await at('[data-field=card_id]').selectOption('c-1');
  const vr = await t.version();
  await at('[data-action=preview]').click();
  await alert('restaurant_closed');
  await step({ name: 'closed', submits: true, action: 'Replace the dish with Scallion Pancake from Lantern Noodle House (closed until 5:00 PM), choose as soon as possible and press Preview total', expected: 'restaurant_closed: the page says when it opens and suggests scheduling; nothing is stored', acceptance: 'Checking out a closed restaurant as soon as possible explains when it opens and suggests scheduling', show: '[data-checkout-hint=restaurant_closed]', shows: 'the explanation', text: 'opens today at 5:00 PM',
    check: async () => JSON.stringify(await t.version()) === JSON.stringify(vr), observe: d => ({ orders: d.orders.length, cart: lineSummary(d.cart), version_unchanged: true }) });

  await begin('11-stale', 'Stale preview and stale version at checkout', 'Checkout, as soon as possible and scheduled', 'Required (W1), stale and conflicting cases');
  await at('[data-action=remove-line]').first().click();
  await flash('Removed Scallion Pancake');
  await pickDish('r-1', 'mi-3');
  await at('[data-action=add-to-cart]').click();
  await flash('Added Tom Yum Soup');
  await nav('Cart');
  await t.idle();
  await at('[data-field=card_id]').selectOption('c-1');
  const count2 = (await data()).orders.length;
  await preview();
  await event({ event_id: 'evidence-price-1', at: '2026-11-18T12:55:00-05:00', operation: 'menu_item.price_changed', payload: { item_id: 'mi-3', price_cents: 925 } });
  await refresh();
  await at('[data-action=place-order]').click();
  await alert('stale_preview');
  await step({ name: 'stale-preview', submits: true, action: 'Replace the dish with Tom Yum Soup and press Preview total; Infra changes the Tom Yum Soup price to $9.25 at 12:55; press Refresh, then Place order with the earlier preview', expected: 'stale_preview (the business details behind the preview changed; preview again); nothing is placed', acceptance: 'After a price change and Refresh, the old preview is refused as stale_preview and nothing is placed', show: alertAt('stale_preview'), shows: 'the refusal', text: 'preview again',
    check: async () => (await data()).orders.length === count2, observe: d => ({ orders: d.orders.length }) });
  await preview();
  await event({ event_id: 'evidence-price-2', at: '2026-11-18T12:56:00-05:00', operation: 'menu_item.price_changed', payload: { item_id: 'mi-3', price_cents: 950 } });
  await at('[data-action=place-order]').click();
  await alert('stale_version');
  await step({ name: 'stale-version', submits: true, action: 'Preview total again; Infra changes the price to $9.50 at 12:56 without a Refresh; press Place order', expected: 'stale_version (Plateway changed since the page last read it), shown apart from stale_preview; nothing is placed', acceptance: 'A change the page has not read is refused as stale_version, shown apart from stale_preview, and nothing is placed', show: alertAt('stale_version'), shows: 'the refusal', text: 'Plateway changed since this page last read it',
    check: async () => (await data()).orders.length === count2, observe: d => ({ orders: d.orders.length }) });
  await refresh();
  const fresh = await preview();
  await at('[data-action=place-order]').click();
  await at('article[data-order][data-status=submitted]').waitFor();
  await t.settled();
  const recovered = await at('article[data-order]').getAttribute('data-order');
  await step({ name: 'recovered', submits: true, action: 'Press Refresh, Preview total and Place order', expected: 'The order is placed once at the new price', show: inOrder(recovered, 'Total charged'), shows: 'the Total charged row',
    check: async () => (await data()).orders.length === count2 + 1 && (await order(recovered)).charge.amount_cents === fresh && (await article(recovered).innerText()).includes(money(fresh)), observe: d => ({ order: orderSummary(d.orders.find(o => o.id === recovered)) }) });

  await begin('12-conflicts', 'Stale and conflicting changes outside checkout', 'Cart edit, cancel and report', 'Required (W1, W3, W4), stale and conflicting cases');
  await pickDish('r-1', 'mi-4');
  await at('[data-action=add-to-cart]').click();
  await flash('Added Fresh Spring Rolls');
  await nav('Cart');
  await t.idle();
  const rolls = (await cart()).lines[0];
  await agentWrite('plateway.cart.update_item', { line_id: rolls.id, quantity: 3 });
  await page.getByRole('button', { name: 'Increase Fresh Spring Rolls', exact: true }).click();
  await alert('stale_version');
  await step({ name: 'cart-edit-stale', submits: true, action: 'Add Fresh Spring Rolls and open Cart; a second Agent MCP client sets that line to quantity 3; without a Refresh, press + on the page', expected: 'stale_version: the page\'s change is refused and nothing it sent is written; the page rereads the cart and shows the other client\'s quantity 3', show: alertAt('stale_version'), shows: 'the refusal', text: 'Plateway changed since this page last read it',
    check: async () => (await cart()).lines[0].quantity === 3 && (await text('[data-quantity="' + rolls.id + '"]')) === '3', observe: d => ({ cart: lineSummary(d.cart) }) });
  await nav('Orders');
  await open(recovered);
  await at('[data-action=cancel-order]').click();
  await at('[data-action=confirm-cancel]').waitFor();
  await t.settled();
  const fullCharge = (await order(recovered)).charge.amount_cents;
  await step({ name: 'cancel-quote', action: 'Open the order just placed (waiting for the restaurant) and press Cancel order', expected: 'A full refund is quoted; nothing changes yet', show: '[data-refund]', shows: 'the quoted refund', text: money(fullCharge),
    check: async () => Number(await at('[data-refund]').getAttribute('data-refund')) === fullCharge, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === recovered)) }) });
  await event({ event_id: 'evidence-accept-2', at: '2026-11-18T12:58:00-05:00', operation: 'order.accepted', payload: { order_id: recovered } });
  await refresh();
  await at('[data-action=confirm-cancel]').click();
  await alert('stale_preview');
  await step({ name: 'cancel-quote-stale', submits: true, action: 'Infra accepts that order at 12:58; press Refresh (the quote stays open) and then Confirm cancellation', expected: 'stale_preview: the quote was taken before the status changed, so nothing is cancelled or refunded', show: alertAt('stale_preview'), shows: 'the refusal', text: 'preview again',
    check: async () => { const o = await order(recovered); return o.status === 'preparing' && o.refunds.length === 0; }, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === recovered)) }) });
  await at('[data-action=cancel-order]').click();
  await at('[data-kept]').waitFor();
  await t.settled();
  const requote = await agentRead('plateway.orders.cancel.preview', { order_id: recovered }, q => ({ refund: money(q.refund_cents), kept: money(q.kept_cents) }));
  await step({ name: 'cancel-requote', action: 'Press Cancel order again', expected: 'A new quote for a preparing order: the delivery fee and tip refunded, the rest kept', show: '[data-kept]', shows: 'the amount kept', text: money(requote.kept_cents),
    check: async () => requote.kept_cents > 0 && Number(await at('[data-refund]').getAttribute('data-refund')) === requote.refund_cents, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === recovered)) }) });
  await event({ event_id: 'evidence-pickup-2', at: '2026-11-18T12:59:00-05:00', operation: 'order.picked_up', payload: { order_id: recovered } });
  await at('[data-action=confirm-cancel]').click();
  await alert('stale_version');
  await step({ name: 'cancel-after-pickup', submits: true, action: 'With that quote open, Infra records the courier\'s pickup at 12:59; without a Refresh, press Confirm cancellation', expected: 'stale_version: the cancellation is refused; the order is on the way and nothing is refunded', show: alertAt('stale_version'), shows: 'the refusal', text: 'Plateway changed since this page last read it',
    check: async () => { const o = await order(recovered); return o.status === 'picked_up' && o.refunds.length === 0; }, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === recovered)) }) });
  await open(first);
  await at('[data-action=report-issue]').click();
  await at('[data-action=send-report]').waitFor();
  const pad = (await order(first)).lines.find(l => l.item_id === 'mi-1');
  await at('[data-report-line="' + pad.id + '"]').check();
  await at('[data-report-kind="' + pad.id + '"]').selectOption('missing');
  await t.settled();
  await agentWrite('plateway.orders.report_issue', { order_id: first, lines: [{ line_id: pad.id, kind: 'missing' }] });
  await at('[data-action=send-report]').click();
  await alert('stale_version');
  await step({ name: 'report-conflict', submits: true, action: 'Open the delivered order, Report a problem, tick Pad Thai as missing; a second Agent MCP client reports the same line first; press Send report', expected: 'stale_version: the page\'s report is refused; the line is refunded once, by the other client\'s report', show: alertAt('stale_version'), shows: 'the refusal', text: 'Plateway changed since this page last read it',
    check: async () => (await order(first)).refunds.filter(r => r.line_id === pad.id).length === 1, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)) }) });
  await refresh();
  await step({ name: 'report-refreshed', action: 'Press Refresh', expected: 'Pad Thai shows as reported, with one refund', show: inOrder(first, 'Reported item: Pad Thai'), shows: 'the refund row', text: 'Reported item: Pad Thai',
    check: async () => (await order(first)).refunds.filter(r => r.line_id === pad.id).length === 1, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === first)) }) });

  await begin('13-tracking-outcomes', 'Order outcomes from the restaurant and the clock', 'Order tracking', 'Required (W2), failure and timer outcomes');
  const elote = (await order('o-11')).lines.find(l => l.name === 'Elote');
  await open('o-11');
  await event({ event_id: 'evidence-unavailable-1', at: '2026-11-18T13:00:00-05:00', operation: 'order.item_unavailable', payload: { order_id: 'o-11', line_id: elote.id } });
  await refresh();
  await step({ name: 'item-unavailable', action: 'Infra reports Elote unavailable on the Masa Verde order being prepared (13:00); press Refresh', expected: 'Elote is removed and refunded (subtotal and tax); the rest of the order goes ahead', show: inOrder('o-11', 'Unavailable item: Elote'), shows: 'the refund row', text: 'Unavailable item: Elote',
    check: async () => { const o = await order('o-11'), r = o.refunds.find(x => x.line_id === elote.id); return o.status === 'preparing' && !!r && r.amount_cents === elote.subtotal_cents + elote.tax_cents; }, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === 'o-11')) }) });
  await nav('Cart');
  await t.idle();
  await at('[data-field=card_id]').selectOption('c-1');
  await at('[data-field=when-asap]').check();
  await preview();
  await at('[data-action=place-order]').click();
  await at('article[data-order][data-status=submitted]').waitFor();
  await t.settled();
  const doomed = await at('article[data-order]').getAttribute('data-order');
  await event({ event_id: 'evidence-reject-1', at: '2026-11-18T13:02:00-05:00', operation: 'order.rejected', payload: { order_id: doomed, reason: 'Kitchen closed early' } });
  await refresh();
  await step({ name: 'rejected', submits: true, action: 'Check out the three Fresh Spring Rolls in the cart; Infra rejects the new order for the restaurant at 13:02; press Refresh', expected: 'Cancelled, declined by the restaurant, with a full refund', show: inOrder(doomed, 'declined by the restaurant'), shows: 'the cancellation reason', text: 'declined by the restaurant',
    check: async () => { const o = await order(doomed); return o.status === 'cancelled' && o.refunds.length === 1 && o.refunds[0].amount_cents === o.charge.amount_cents; }, observe: d => ({ order: orderSummary(d.orders.find(o => o.id === doomed)), cancellation: d.orders.find(o => o.id === doomed).cancellation }) });
  await advance('2026-11-19T18:30:00-05:00');
  await open(scheduledId);
  await refresh();
  const released = await agentRead('plateway.orders.get', { order_id: scheduledId }, r => ({ status: r.order.status, released_at: r.order.submitted_at, accept_by: r.order.accept_by }));
  await step({ name: 'released', action: 'Infra moves the clock to Thursday 18:30, after the scheduled order\'s release time (18:25); open that order and press Refresh', expected: 'The scheduled order has been sent to the restaurant and is waiting for it; reads show this before any write stores it', show: '[data-order-id="' + scheduledId + '"]', shows: 'the order in the list', text: 'Waiting for the restaurant',
    check: async () => released.order.status === 'submitted', observe: d => ({ stored_status: d.orders.find(o => o.id === scheduledId).status, read_status: released.order.status }) });
  await advance('2026-11-19T18:46:00-05:00');
  await refresh();
  const timedOut = await agentRead('plateway.orders.get', { order_id: scheduledId }, r => ({ status: r.order.status, reason: r.order.cancellation && r.order.cancellation.reason, refunds: r.order.refunds.map(x => money(x.amount_cents)) }));
  await step({ name: 'not-accepted', action: 'Infra moves the clock to 18:46, past the 20 minutes the restaurant had to accept; press Refresh', expected: 'Cancelled, not accepted by the restaurant in time, with a full refund', show: inOrder(scheduledId, 'not accepted by the restaurant in time'), shows: 'the cancellation reason', text: 'not accepted by the restaurant in time',
    check: async () => timedOut.order.status === 'cancelled' && timedOut.order.cancellation.reason === 'not_accepted' && timedOut.order.refunds.length === 1, observe: d => ({ stored_status: d.orders.find(o => o.id === scheduledId).status, read_status: timedOut.order.status }) });

  await begin('14-account', 'Account', 'Account', 'Required (W1, read-only account view)');
  await nav('Account');
  await t.idle();
  await step({ name: 'account', action: 'Open Account', expected: 'The holder, the saved addresses and the masked cards, with the expired card marked and unavailable at checkout', acceptance: 'A status message stays on the screen where it happened, and Account marks the expired card', show: page.locator('.detail').getByText('Expired 10/2026'), shows: 'the expired card', text: 'Expired 10/2026',
    check: async () => extra.expired_card_disabled, observe: d => ({ addresses: d.addresses.map(a => a.label), cards: d.cards.map(c => '•••• ' + c.last4) }) });

  t.allowConsole(/status of 403/);
  const management = await R.aside('the management check between 14-account and 15-phone: a direct env.snapshot from the page\'s business session', () => R.forced('env.snapshot', {}));
  t.check('A direct management request from the authenticated business session is refused (403)', management.out.http === 403);
  extra.management_request = { tool: 'env.snapshot', http: management.out.http };

  await begin('15-phone', 'Phone width', 'Layout at 390 px', 'Required (GUI)');
  await page.setViewportSize(PHONE);
  await nav('Orders');
  await t.settled();
  await step({ name: 'orders', action: 'Set the viewport to 390 × 844 and open Orders', expected: 'Every navigation tab visible; no horizontal overflow', acceptance: 'At 390 px every navigation tab is visible and there is no horizontal overflow in Orders, a restaurant with a dish open, Cart and Account', show: page.locator('nav').getByRole('button', { name: /Account/ }), shows: 'the last navigation tab', text: 'Account',
    check: async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), observe: () => ({ viewport: '390x844' }) });
  await nav('Restaurants');
  await at('[data-restaurant-id=r-1]').click();
  await at('[data-item-id=mi-1]').click();
  await at('[data-action=add-to-cart], [data-conflict=dish]').first().waitFor();
  await t.settled();
  await step({ name: 'dish', action: 'Open Basil Row and Pad Thai', expected: 'The dish form fits the width', show: '[data-option=op-2]', shows: 'the first spice option',
    check: async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), observe: () => ({ viewport: '390x844' }) });
  await page.setViewportSize(DESKTOP);
  await R.finish();
  await R.close();
}

async function restricted(t) {
  const { page } = t;
  await page.setViewportSize(DESKTOP);
  await stableIds(page);
  const R = recorder(t, 'policy');
  const { open, article, at, refresh, order } = helpers(t);
  await t.open('[data-restaurant-id]');
  await R.begin('16-policy', 'A policy without orders.rate', 'Rate', 'Required (GUI): denied by policy, on a separate run');
  await page.locator('nav').getByRole('button', { name: /Orders/ }).click();
  await t.idle();
  await open('o-10');
  await at('[data-action=rate-order]').click();
  await at('[data-action=send-rating]').waitFor();
  await t.settled();
  await R.step({ name: 'form-open', action: 'On a second fresh run, open the Lantern Noodle House order delivered on Sunday 15 November and press Rate order', expected: 'The rating form is open', show: '[data-action=send-rating]', shows: 'the Submit rating control', text: 'Submit rating',
    check: async () => (await order('o-10')).rating === null, observe: d => ({ order_rating: d.orders.find(o => o.id === 'o-10').rating }) });
  const policies = read('fixtures/policies.json');
  for (const p of Object.values(policies)) p.allow = p.allow.filter(x => x !== 'plateway.orders.rate');
  const loaded = await R.management('env.load_seed', { data: read('fixtures/minimal.json'), policies, request_id: 'evidence-policy' }, { data: 'fixtures/minimal.json', policies: 'fixtures/policies.json without plateway.orders.rate', request_id: 'evidence-policy' }, r => ({ status: r.status }));
  assert.equal(loaded.status, 'ready', 'Seed load: ' + JSON.stringify(loaded));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('[data-action=send-rating]').waitFor({ state: 'detached' });
  await t.idle();
  await R.step({ name: 'rate-removed', action: 'Infra loads the same fixture with a policy that omits plateway.orders.rate; press Refresh', expected: 'The open rating form and the Rate control are gone; Reorder stays', acceptance: 'After the policy drops orders.rate, Refresh removes the open rating form and the Rate control while the other order actions stay', show: article('o-10').locator('[data-action=reorder]'), shows: 'the remaining order action', text: 'Reorder',
    check: async () => await at('[data-action=rate-order]').count() === 0 && await at('[data-action=send-rating]').count() === 0, observe: d => ({ order_rating: d.orders.find(o => o.id === 'o-10').rating }) });
  t.allowConsole(/status of 403/);
  const forced = await R.forced('plateway.orders.rate', { order_id: 'o-10', stars: 5, expected_version: await t.version(), request_id: 'evidence-forced-rate' });
  await R.step({ name: 'forced-call', submits: true, action: 'Send plateway.orders.rate directly from the page\'s business session', expected: 'HTTP 403; the order stays unrated', acceptance: 'A forced orders.rate call is refused (403) and the order stays unrated', show: article('o-10').locator('[data-action=reorder]'), shows: 'the order without a Rate control', text: 'Reorder',
    check: async () => forced.http === 403 && (await order('o-10')).rating === null, observe: d => ({ order_rating: d.orders.find(o => o.id === 'o-10').rating }) });
  await R.finish();
  await R.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) if (e.isDirectory()) fs.rmSync(path.join(OUT, e.name), { recursive: true });
  extra.probes = await runProbes({ root, chromium, launchArgs: RASTER, writes: WRITES, previews: PREVIEWS });
  try { await runWebAcceptance({ app: 'plateway', appDir, steps, restricted, timezoneId: 'Europe/London', launchArgs: RASTER }); }
  finally { for (const r of recorders) await r.R.close().catch(() => {}); }
  const report = JSON.parse(fs.readFileSync(path.join(scratch, 'report.json'), 'utf8'));
  const leftover = recorders.flatMap(r => r.R.leftovers().map(e => r.session + ': ' + e));
  if (report.passed && leftover.length) { console.error('Recorder error during teardown: ' + leftover.join('; ')); process.exitCode = 1; return; }
  fs.rmSync(scratch, { recursive: true, force: true });
  if (!report.passed) { console.error(report.error); process.exitCode = 1; return; }
  const digest = runtimeDigest(appDir);
  const run = {
    schema: 'plateway.gui-evidence.v2', captured_on: report.checked_at.slice(0, 10), rendering: 'Chromium launched with ' + RASTER.join(' ') + ' so repeated captures rasterize the same pixels', request_ids: 'The page draws its request IDs from crypto.randomUUID; the capture replaces that function in the page with a counter kept in sessionStorage (web-evidence-0001, …), so IDs are stable between runs. The GUI source is unchanged.', command: 'node apps/plateway/evidence/tools/gui.cjs',
    app: 'plateway', app_version: report.app_version,
    app_load_digest: { sha256: digest.sha256, files: digest.files, includes: digest.includes, excludes: digest.excludes, algorithm: digest.algorithm, command: 'node apps/plateway/evidence/tools/digest.cjs' },
    host: { ...hostRevision(root), server: 'runtime/web/server.cjs (shared public Web Host)', registry: 'apps.registry.json' }, core_api_version: report.core_api_version,
    node: report.node, playwright: report.playwright, browser: report.browser, viewport: { desktop: DESKTOP.width + 'x' + DESKTOP.height, phone: PHONE.width + 'x' + PHONE.height }, browser_timezone: report.browser_timezone, browser_locale: report.browser_locale,
    runs: ['plateway-web', 'plateway-web-restricted'], profile: 'sandbox', account: { app_account: extra.start.account_id, owner_person: extra.start.owner_person_id, time_zone: extra.start.time_zone, seed_id: extra.start.seed_id, synthetic: true }, start_virtual_time: extra.start.virtual_now,
    inspector: 'Infra MCP client on the same run (env.snapshot), as in tests/web.browser.cjs', second_agent: 'A separate Agent MCP client on the same run, for independent reads and writes through the public business tools',
    checks_passed: report.checks.length + (report.restricted ? report.restricted.checks.length : 0), recorder_probes: extra.probes, between_sequences: between, trace: 'Every call is owned when it is sent, by the step open at that moment: page reads and tool discovery, page writes and previews, forced calls, second Agent reads and writes, Infra events, clock moves, the seed load and the inspector\'s own snapshot reads. A step opens when the previous one is sealed or its sequence begins, and its action runs inside it. The page load before the first sequence is owned by the setup, which may make only unlisted reads and is not listed here; the two pieces of work between sequences are owned separately and are the two entries of between_sequences. A call sent with no owner stops the script, and a reply never changes ownership. A step is frozen before anything is taken from it: the recorder reads the version, runs the check, waits until nothing the step owns is outstanding and reads the App\'s state, and stops if the version changed since before the check; observations, version and virtual time come from that frozen state, the wait and scrolling before the screenshot come after it, and a call sent after the freeze stops the script and cannot count toward submits. Each call has exactly one terminal outcome, the reply or a failure with its HTTP status and error; a failure or a second outcome stops the script. A forced call carries a header token bound to the exact tool and arguments it was issued for; a token sent with any other call stops the script. Recorder errors are append-only, so a stop that a caller catches is still reported at teardown. Listed: page writes and previews with their raw arguments and raw reply (HTTP status and JSON body), unshortened; second Agent writes, Infra events, clock moves and forced calls raw, except the host wall-clock fields received_at and processed_at in Infra event receipts, replaced by a note so repeated captures are identical; second Agent reads summarized to the fields the step checks; the seed load by its file names. Page reads, tool discovery and inspector reads are owned and waited for but not listed. Before capturing, gui.cjs runs the recorder probes in evidence/tools/probes.cjs (recorder_probes); each makes the recorder stop with its exact expected message.', console_errors: report.console_errors, management_request: extra.management_request,
    screenshots: sequences.reduce((a, s) => a + s.steps.length, 0)
  };
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'sequences.json'), JSON.stringify({ schema: 'plateway.gui-sequences.v2', runs: run.runs, account: run.account.app_account, sequences }, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), markdown(run));
  console.log('evidence: ' + run.screenshots + ' screenshots in ' + sequences.length + ' sequences, ' + run.checks_passed + ' checks');
}

const cell = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const json = v => '`' + JSON.stringify(v).replace(/\|/g, '\\|').replace(/`/g, '\'') + '`';
const callText = c => c.client + ', ' + c.kind + ' `' + c.tool + '` ' + json(c.arguments) + ' → ' + (c.http !== undefined && c.http !== null ? 'HTTP ' + c.http + ' ' : '') + (c.result_summary !== undefined ? 'summary ' + json(c.result_summary) : json(c.result));
function markdown(run) {
  const lines = ['# Plateway GUI workflow sequences', '',
    'Generated by `' + run.command + '` (do not edit by hand). Each step was performed with real controls in Chromium on the shared Web Host. After each step the script checked the App\'s persisted state through a separate Infra MCP client on the same run against the expected result, then froze the step: it waited until no call the step made was outstanding, read the App\'s state and version, and stopped if the version had changed since before the check. The observations, version and virtual time below come from that frozen state; the script then scrolled the outcome into view, checked that it is fully on screen and reads as expected, and only then took the screenshot. A failed expectation stops the script, so every step below is observed as expected. Every MCP call made in a step is listed with its arguments and result. Every call is owned when it is sent, by the step open at that moment: page reads and tool discovery, the page\'s own writes and previews (`POST /api/call`), forced calls from the page\'s business session, second Agent reads and writes, Infra events, clock moves, the seed load and the inspector\'s own snapshot reads. A step opens when the previous one is sealed or its sequence begins, and its action runs inside it; the page load before the first sequence and the two pieces of work between sequences have owners of their own (the two are listed in `run.json` as `between_sequences`). A call sent with no owner stops the script, and a reply never changes ownership. A call sent after a step is frozen stops the script and cannot count toward a submitting step, which must list a write or forced call. Each call has exactly one terminal outcome (the reply, or a failure with its HTTP status and error); a failure or a second outcome stops the script. A forced call carries a header token bound to the exact tool and arguments it was issued for. Recorder errors are append-only, so a stop that a caller catches is still reported at teardown. Page writes and previews are listed with the raw arguments (tokens and versions included, unshortened) and the raw reply (HTTP status and JSON body, including fee breakdowns and tokens). Writes by a second Agent MCP client, Infra events, clock moves and forced calls are listed raw, except that the host wall-clock fields `received_at` and `processed_at` in Infra event receipts are replaced by a note so that repeated captures are identical (their virtual times are kept); reads by the second Agent client are summarized to the fields the step checks; page reads, tool discovery and inspector reads are owned and waited for but not listed. Before capturing, the script runs the 20 recorder probes in `evidence/tools/probes.cjs`; each must make the recorder stop with its exact expected message, and the results are in `run.json` (`recorder_probes`). The capture runs Chromium with software rasterization on one thread and replaces the page\'s random request IDs with a counter, so two runs on the same machine give the same screenshots and step data; on another machine or Chromium build, anti-aliased edges can differ by a few pixels.', '',
    '| Item | Value |', '| --- | --- |',
    '| App | plateway ' + run.app_version + '; App load digest `' + run.app_load_digest.sha256 + '` over ' + run.app_load_digest.files + ' files in ' + run.app_load_digest.includes.map(x => '`' + x + '`').join(', ') + ' (`' + run.app_load_digest.command + '`) |',
    '| Host | public runtime ' + run.host.runtime_version + ' (runtime tree `' + run.host.runtime_tree_sha256 + '`), Core API ' + run.core_api_version + ', ' + run.host.server + ', registry ' + run.host.registry + ' |',
    '| Browser | ' + run.browser + ' (Playwright ' + run.playwright + '), viewports ' + run.viewport.desktop + ' and ' + run.viewport.phone + ', locale ' + run.browser_locale + ', browser time zone ' + run.browser_timezone + ' (the page shows the account\'s America/New_York) |',
    '| Node | ' + run.node + ' |',
    '| Runs and account | runs ' + run.runs.map(r => '`' + r + '`').join(' and ') + ', profile ' + run.profile + ', synthetic account `' + run.account.app_account + '` owned by `' + run.account.owner_person + '`, seed `' + run.account.seed_id + '`, starting at ' + run.start_virtual_time + ' |',
    '| Captured | ' + run.captured_on + ', ' + run.checks_passed + ' checks passed, unexpected console errors: ' + run.console_errors.unexpected.length + ' |',
    '| Business-only access | `env.snapshot` sent directly from the business session: HTTP ' + run.management_request.http + ' |', ''];
  for (const s of JSON.parse(fs.readFileSync(path.join(OUT, 'sequences.json'), 'utf8')).sequences) {
    lines.push('## ' + s.title, '', 'Workflow: ' + s.workflow + '. Scope: ' + s.scope + '. Run `' + s.run + '`.', '', '| Step | Action | Expected | On screen | Observed in the App (Infra MCP) | MCP calls in this step | Version | Virtual time | Acceptance check in `tests/web.browser.cjs` | Screenshot |', '| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const st of s.steps) lines.push('| ' + st.step + ' | ' + cell(st.action) + ' | ' + cell(st.expected) + ' | ' + cell(st.on_screen) + ' | ' + json(st.observed) + ' | ' + (st.mcp_calls.length ? st.mcp_calls.map(callText).join('<br>') : 'none') + ' | ' + st.version + ' | ' + st.virtual_now + ' | ' + (st.acceptance_check ? cell(st.acceptance_check) : 'Evidence script only') + ' | [' + path.basename(st.screenshot, '.png') + '](' + st.screenshot + ') |');
    lines.push('');
  }
  return lines.join('\n');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
