#!/usr/bin/env node
'use strict';
// Ordered screenshots of every core workflow of the web page, taken while the real controls are used
// in Chromium against the repository's shared Web Host on a fresh run of the reference library.
// After each step the result is confirmed through a separate Agent MCP connection to the same run
// (record and version), and the sequence ends with a reload. Writes evidence/gui/*.png,
// evidence/gui/sequences.json and evidence/gui/SEQUENCES.md (or --out DIR). Needs the repository's
// pinned Playwright, like tests/web-browser.cjs; not part of `npm test`. sequences.json and SEQUENCES.md
// hold no wall-clock time, Node version or file size, so a re-run writes them byte for byte; the PNG
// frames show the same content but their pixels can differ between runs.
//   node scripts/capture-workflows.cjs [--runtime DIR] [--out DIR]
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib');
const locate = require('./locate.cjs');
const runtime = locate.runtimeDir(), {start} = require(path.join(runtime, 'web/server.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
const {chromium} = require(require.resolve('playwright', {paths: [path.dirname(runtime)]}));
const pkg = locate.packageDir, registry = path.join(pkg, 'web.registry.json');
const out = locate.option('out') || path.join(pkg, 'evidence/gui');
const DESKTOP = {width: 1280, height: 720}, PHONE = {width: 390, height: 844};

// Lossless PNG recompression with zlib only: decode the 8-bit RGB/RGBA image Chromium writes, drop an
// alpha channel that is opaque everywhere, choose a filter per row and deflate at level 9.
function optimisePng(buf) {
  const sig = buf.subarray(0, 8); let pos = 8, ihdr, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data; else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), depth = ihdr[8], colour = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) return buf;
  const bpp = colour === 6 ? 4 : 3, stride = width * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0, v = raw[src + x];
      px[row + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  let opaque = bpp === 4;
  for (let i = 3; opaque && i < px.length; i += 4) if (px[i] !== 255) opaque = false;
  const ob = opaque ? 3 : bpp, os2 = width * ob, img = opaque ? Buffer.alloc(os2 * height) : px;
  if (opaque) for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { img[j] = px[i]; img[j + 1] = px[i + 1]; img[j + 2] = px[i + 2]; }
  const filtered = Buffer.alloc((os2 + 1) * height), cand = Buffer.alloc(os2);
  for (let y = 0; y < height; y++) {
    const row = y * os2; let best = -1, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < os2; x++) {
        const a = x >= ob ? img[row + x - ob] : 0, b = y ? img[row - os2 + x] : 0, c = x >= ob && y ? img[row - os2 + x - ob] : 0, v = img[row + x];
        const r = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 255;
        cand[x] = r; sum += r < 128 ? r : 256 - r;
      }
      if (sum < bestSum) { bestSum = sum; best = f; cand.copy(filtered, y * (os2 + 1) + 1); }
    }
    filtered[y * (os2 + 1)] = best;
  }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(zlib.crc32 ? zlib.crc32(b.subarray(4, 8 + data.length)) : crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const head = Buffer.from(ihdr); head[9] = opaque ? 2 : colour;
  const result = Buffer.concat([sig, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(filtered, {level: 9, memLevel: 9})), chunk('IEND', Buffer.alloc(0))]);
  return result.length < buf.length ? result : buf;
}
const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

(async () => {
  fs.mkdirSync(out, {recursive: true});
  for (const f of fs.readdirSync(out)) if (/\.png$/.test(f)) fs.rmSync(path.join(out, f));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-capture-'));
  const browser = await chromium.launch({headless: true});
  const frames = [], hosts = [], clients = [], errors = [];
  // Most items of the reference library are metadata only; the frames say so (see markdown()).
  const seed = JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/reference.json'), 'utf8'));
  const report = {schema: 'fernshelf.gui-sequences.v1', browser: 'Chromium ' + browser.version(),
    host: 'runtime/web/server.cjs (public runtime ' + JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version + ')',
    run: 'capture', profile: 'sandbox', account: 'fernshelf-maya (Maya Fenwick, synthetic)', clock: JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/clock.json'), 'utf8')).initial_time,
    viewports: {desktop: DESKTOP, phone: PHONE}, time_zone: 'America/Los_Angeles',
    library: {items: seed.items.length, items_with_image_file: seed.items.filter(i => i.file).length, active_items: seed.items.filter(i => i.state === 'active').length,
      active_items_with_image_file: seed.items.filter(i => i.state === 'active' && i.file).length}, frames};
  try {
    const host = await start({app: 'fernshelf', registry, run: 'capture', stateDir, profile: 'sandbox'}); hosts.push(host);
    const open = async (role, run = 'capture') => { const c = new Client('fernshelf', role, run, stateDir, 'fernshelf-capture-check', {registry}); await c.initialize(); clients.push(c); return c; };
    const patient = c => ({call: async (name, args) => { for (let i = 0; ; i++) { try { return await c.call(name, args); } catch (e) { if (!/locked/.test(e.message) || i > 60) throw e; await new Promise(r => setTimeout(r, 150)); } } }});
    const mcp = patient(await open('agent')), infra = patient(await open('infra'));
    const until = async (what, fn) => { const end = Date.now() + 45000; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise(r => setTimeout(r, 150)); } throw new Error('Timed out: ' + what); };
    const item = async id => (await mcp.call('fernshelf.items.get', {id}));
    const album = async id => (await mcp.call('fernshelf.albums.get', {id}));
    const ver = r => r.version ? r.version.epoch + '.' + r.version.revision : null;

    const context = await browser.newContext({viewport: DESKTOP, timezoneId: 'America/Los_Angeles', locale: 'en-GB'});
    let page = await context.newPage(); page.setDefaultTimeout(45000);
    const watch = (p, label) => { p.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/status of 400/.test(m.text()) && !(label === 'read-only' && /status of 403/.test(m.text()))) errors.push(label + ' console: ' + m.text()); }); };
    // 400 answers are Core's "App is locked" while a separate connection commits (the page retries them);
    // on the read-only run the one 403 is the forced write this script sends on purpose.
    watch(page, 'desktop');
    const idle = (p = page) => p.locator('#app[aria-busy=false]').waitFor();
    const nav = async (label, p = page) => { await p.locator('nav button').filter({hasText: label}).first().click(); await idle(p); };
    const dialog = page.locator('dialog[open]');
    const submit = async () => { await dialog.locator('button[type=submit]').click(); };
    const select = async (id, p = page) => { await p.locator('#records [data-record-id="' + id + '"]').first().click(); await p.locator('.detail[data-selected-id="' + id + '"]').waitFor(); await idle(p); };
    const detailButton = name => page.locator('.detail').getByRole('button', {name, exact: true});
    const RAW = /\b(?:it|al|ln|rr|ct|vw|ntf|pl|st|img)-[a-z]*\d[\w-]*|\bundefined\b|\bnull\b|\{"|\b[a-z]+_[a-z_]+\b/;
    // Thumbnails load lazily, two at a time, once their tile is in view: wait until no tile in view is
    // still waiting for its image (a tile whose item has a readable file and is neither shown nor refused).
    const pendingImages = p => p.evaluate(() => [...document.querySelectorAll('.fs-media')].filter(b => typeof b.loadImage === 'function' && !b.classList.contains('loaded') && !b.dataset.refused &&
      (r => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)(b.getBoundingClientRect())).length);
    const settle = async p => { await p.waitForTimeout(350);
      for (let i = 0; i < 60 && /Loading image…|Checking who can see it…/.test(await p.evaluate(() => document.body.innerText)); i++) await p.waitForTimeout(200);
      for (let i = 0; i < 100 && await pendingImages(p); i++) await p.waitForTimeout(200);
      await p.evaluate(() => Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; })))); };
    // One frame: the screenshot, what was done, what was expected and seen, the MCP read that confirms it.
    // A desktop frame is the whole viewport or, to keep files small, the part of it the step is about:
    // the open dialog, the photo panel, the list column, or (union: {label, selectors}) the smallest box
    // around the listed elements. Phone frames are always the whole viewport.
    const REGIONS = {dialog: 'dialog[open]', panel: '.detail', list: 'section.collection'};
    const frame = async (workflow, slug, meta, p = page) => {
      const focus = meta.focus;
      let region = p === page ? (meta.region || 'viewport') : 'viewport';
      delete meta.region; delete meta.focus;
      // Start from the top of the page, or bring the element the step is about into view and frame it,
      // or keep the page where the step left it (keepScroll: the page itself scrolled to the panel).
      const keepScroll = meta.keepScroll, union = meta.union; delete meta.keepScroll; delete meta.union;
      if (focus) { await p.locator(focus).first().scrollIntoViewIfNeeded(); region = 'focus'; } else if (!keepScroll) await p.evaluate(() => window.scrollTo(0, 0));
      await settle(p);
      const text = await p.evaluate(() => document.body.innerText), raw = RAW.exec(text);
      assert.ok(!raw, slug + ': visible text has a raw ID, null or Agent wording: ' + (raw && text.slice(Math.max(0, raw.index - 60), raw.index + 60)));
      const n = frames.filter(f => f.workflow === workflow).length + 1, file = workflow.toLowerCase() + '-' + String(n).padStart(2, '0') + '-' + slug + '.png';
      let clip;
      if (union) region = 'union';
      if (region !== 'viewport') {
        const boxes = await Promise.all((union ? union.selectors : [focus || REGIONS[region]]).map(sel => p.locator(sel).first().boundingBox())), vp = p.viewportSize();
        const box = {x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y))};
        box.width = Math.max(...boxes.map(b => b.x + b.width)) - box.x; box.height = Math.max(...boxes.map(b => b.y + b.height)) - box.y;
        const x = Math.max(0, Math.floor(box.x) - 8), y = Math.max(0, Math.floor(box.y) - 8);
        clip = {x, y, width: Math.min(vp.width, Math.ceil(box.x + box.width) + 8) - x, height: Math.min(vp.height, Math.ceil(box.y + box.height) + 8) - y};
      }
      const png = optimisePng(await p.screenshot(clip ? {clip} : {}));
      fs.writeFileSync(path.join(out, file), png);
      frames.push({workflow, n, file, viewport: p === page ? 'desktop' : 'phone', region: focus ? 'element' : union ? union.label : region, ...meta});
      console.log('frame ' + file + ' (' + png.length + ' bytes)');
    };

    await page.goto(host.accessUrl); await idle(); await page.locator('#records .fs-tile').first().waitFor();
    await until('thumbnails', () => page.locator('#records .fs-tile img').count());

    // W1: library, search, a photo with who can see it, storage (read-only).
    let r = await mcp.call('fernshelf.items.search', {archived: false});
    // The page opens on the newest item, which may have no image file or caption. The first frame shows
    // the newest photo that has both: the first such row of the same newest-first search.
    const featured = r.rows.find(x => x.kind === 'photo' && x.has_file && x.caption);
    await select(featured.id);
    await frame('W1', 'photos-grid', {union: {label: 'grid and panel', selectors: ['section.collection h2', '.detail .fs-media', '.detail h2 + *']}, stage: 'start', action: 'Open the access link printed by the Host and click the newest photo that has an image file and a caption.', expected: 'Photos grid by month, newest first, with the drawn stand-in images and placeholder tiles; the photo panel shows the image and its caption.',
      observed: (await page.locator('#records .fs-tile').count()) + ' tiles shown; page title ' + JSON.stringify(await page.title()) + '; panel ' + JSON.stringify(await page.locator('.detail h2').innerText()) + ' with ' + (await page.locator('.detail .fs-media.loaded img').count() ? 'its image' : 'no image') + '.',
      mcp: {call: 'fernshelf.items.search {"archived":false}', result: r.total + ' rows (stacks collapsed; archived items are under Archive); the first row with an image file and a caption is ' + JSON.stringify(featured.caption), version: ver(r)},
      test: 'web-browser.cjs "Page opens from the access link and shows the photo grid with authorised thumbnails"'});
    await page.locator('.toolbar input[type=search]').fill('hall');
    await page.waitForTimeout(700); await idle(); await until('filtered', async () => (await page.locator('#records .fs-tile').count()) < 20);
    const filtered = await page.locator('#records .fs-tile').count();
    r = await mcp.call('fernshelf.items.search', {text: 'hall'});
    await frame('W1', 'search-hall', {region: 'list', stage: 'action', action: 'Type "hall" in Search captions.', expected: 'Only photos whose caption contains "hall" (items.search text).',
      observed: filtered + ' tile(s): ' + r.rows.map(x => JSON.stringify(x.caption) + (x.stack_size > 1 ? ' (a stack of ' + x.stack_size + ', shown by its cover)' : '')).join(', ') + '.', mcp: {call: 'fernshelf.items.search {"text":"hall"}', result: r.total + ' rows', version: ver(r)}, test: 'web-smoke.cjs reads for Photos'});
    await select('it-2611-0931');
    await page.locator('.detail .fs-exposure .fs-surface').first().waitFor();
    r = await mcp.call('fernshelf.exposure.get', {id: 'it-2611-0931'});
    await frame('W1', 'photo-who-can-see', {focus: '.detail .fs-exposure', stage: 'outcome', action: 'Click the photo "Everyone on the hall steps".', expected: 'Photo panel with the image, details and "who can see this": Reunion 2026, its joined members, the link and Kofi\'s view and save.',
      observed: 'Panel lists ' + JSON.stringify((await page.locator('.detail .fs-exposure').innerText()).split('\n').filter(Boolean).slice(0, 3).join(' / ')) + '.',
      mcp: {call: 'fernshelf.exposure.get {"id":"it-2611-0931"}', result: 'visible_to ' + r.visible_to.length + ' people, albums ' + r.albums.map(a => a.title).join(', ') + ', ' + r.views.length + ' recorded view(s)', version: ver(r)},
      test: 'web-browser.cjs "Before answering, the photo panel shows where the item is visible (exposure.get)"'});
    await page.locator('.toolbar input[type=search]').fill(''); await page.waitForTimeout(700); await idle();
    await nav('Storage');
    r = await mcp.call('fernshelf.storage.summary', {});
    const usedBefore = r.storage.used_bytes;
    await frame('W1', 'storage', {region: 'list', stage: 'outcome', action: 'Open Storage.', expected: 'Plan, used and free space, trash, duplicates, largest items.',
      observed: JSON.stringify((await page.locator('#app').innerText()).match(/[\d.]+ GB of [\d.]+ GB[^\n]*/)?.[0] || 'meter shown') + '.',
      mcp: {call: 'fernshelf.storage.summary {}', result: 'used_bytes ' + r.storage.used_bytes + ', trash_bytes ' + r.storage.trash_bytes, version: ver(r)}, test: 'web-smoke.cjs reads for Storage'});

    // W2: edit an item (save, cancel, invalid), new album, add items, rename, a stale rename, remove from album.
    await nav('Photos'); await select('it-2611-0943');
    await detailButton('Edit details').click();
    await dialog.locator('[data-field="patch.caption"]').fill('Mum and me on the hall steps');
    await frame('W2', 'edit-details-form', {region: 'dialog', stage: 'action', action: 'On "Mum and me", click Edit details and change the caption.', expected: 'The form shows only caption, favourite, archived and corrected capture time.',
      observed: 'Form open with the new caption typed.', mcp: {call: 'fernshelf.items.get {"id":"it-2611-0943"}', result: 'caption ' + JSON.stringify((await item('it-2611-0943')).item.caption) + ' (unchanged until saved)', version: ver(await item('it-2611-0943'))},
      test: 'web-browser.cjs "Edit details: the dialog shows exactly patch.caption, patch.favorite, patch.archived, patch.taken_at"'});
    await submit(); await dialog.waitFor({state: 'hidden'}); await idle();
    r = await until('caption saved', async () => { const x = await item('it-2611-0943'); return x.item.caption === 'Mum and me on the hall steps' && x; });
    await frame('W2', 'edit-details-saved', {region: 'panel', stage: 'outcome', action: 'Click Save.', expected: 'The dialog closes and the panel shows the new caption.',
      observed: 'Panel title ' + JSON.stringify(await page.locator('.detail h2').innerText()) + '.', mcp: {call: 'fernshelf.items.get {"id":"it-2611-0943"}', result: 'caption ' + JSON.stringify(r.item.caption), version: ver(r)},
      test: 'web-browser.cjs "Hostile caption is stored as text and shown as text, never executed" (same form)'});
    const vSaved = ver(r);
    await detailButton('Edit details').click();
    await dialog.locator('[data-field="patch.caption"]').fill('A caption that is not kept');
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await dialog.waitFor({state: 'hidden'}); await idle();
    r = await item('it-2611-0943');
    assert.equal(r.item.caption, 'Mum and me on the hall steps'); assert.equal(ver(r), vSaved);
    await frame('W2', 'edit-details-cancelled', {region: 'panel', stage: 'outcome', action: 'Open Edit details again, type another caption, click Cancel.', expected: 'Nothing is written; the caption and version stay.',
      observed: 'Panel still shows ' + JSON.stringify(await page.locator('.detail h2').innerText()) + '.', mcp: {call: 'fernshelf.items.get {"id":"it-2611-0943"}', result: 'caption unchanged', version: ver(r) + ' (same as before)'}, test: 'capture only'});
    await detailButton('Edit details').click();
    await dialog.locator('[data-field="patch.taken_at"]').fill('2026-11-19T12:00');
    await submit();
    await dialog.locator('[role=alert][data-code=invalid_arguments], .form-error[data-code=invalid_arguments]').first().waitFor();
    r = await item('it-2611-0943');
    await frame('W2', 'edit-details-invalid', {region: 'dialog', stage: 'outcome', action: 'Set the corrected capture time to 19 Nov 2026 12:00, after the photo was backed up (14 Nov), and save.', expected: 'Refused (the App answers invalid_arguments); the form says so in the page\'s words and stays open.',
      observed: JSON.stringify(await dialog.locator('[data-code=invalid_arguments]').first().innerText()) + '.', mcp: {call: 'fernshelf.items.get {"id":"it-2611-0943"}', result: 'taken_at ' + r.item.taken_at + ' (unchanged)', version: ver(r) + ' (unchanged)'},
      test: 'w2-organising.test.cjs (corrected taken_at later than added_at is invalid_arguments)'});
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await dialog.waitFor({state: 'hidden'}); await idle();
    await nav('Albums');
    await page.getByRole('button', {name: 'New album', exact: true}).click();
    await dialog.locator('[data-field=title]').fill('Coast weekend');
    await frame('W2', 'new-album-form', {region: 'dialog', stage: 'action', action: 'In Albums, click New album and type a title.', expected: 'A form with the title only.', observed: 'Form with "Coast weekend".',
      mcp: {call: 'fernshelf.albums.list {}', result: (r = await mcp.call('fernshelf.albums.list', {})).albums.length + ' albums', version: ver(r)}, test: 'web-browser.cjs "New album: the dialog shows exactly title"'});
    await submit(); await dialog.waitFor({state: 'hidden'}); await idle();
    await page.locator('.fs-album-meta[data-album-title="Coast weekend"]').waitFor();
    const coast = (await mcp.call('fernshelf.albums.list', {})).albums.find(a => a.title === 'Coast weekend').id;
    r = await album(coast);
    await frame('W2', 'new-album-created', {region: 'list', stage: 'outcome', action: 'Click Save.', expected: 'The new, empty, private album opens.', observed: 'Album page "Coast weekend", no items.',
      mcp: {call: 'fernshelf.albums.get {"id":"<new album>"}', result: 'state ' + r.album.state + ', ' + r.album.entries.length + ' items', version: ver(r)}, test: 'web-browser.cjs "After creating, the page opens the new album"'});
    await page.getByRole('button', {name: 'Add items', exact: true}).click();
    await dialog.locator('input[aria-label="Filter photos"]').fill('Wrenfield'); await page.waitForTimeout(400);
    const picks = dialog.locator('[data-pick-id]');
    const chosen = [await picks.nth(1).getAttribute('data-pick-id'), await picks.nth(3).getAttribute('data-pick-id'), await picks.nth(4).getAttribute('data-pick-id')];
    await picks.nth(1).click(); await picks.nth(3).click(); await picks.nth(4).click();
    await frame('W2', 'add-items-picker', {region: 'dialog', stage: 'action', action: 'Click Add items, filter the picker by "Wrenfield" and pick three photos.', expected: 'A picker of the library narrowed to that place; picked photos are marked.', observed: '3 photos marked.',
      mcp: {call: 'fernshelf.albums.get {"id":"<new album>"}', result: '0 items (not yet saved)', version: ver(r)}, test: 'web-browser.cjs "Add items: albums.update add_ids committed in order"'});
    await submit(); await dialog.waitFor({state: 'hidden'});
    r = await until('added', async () => { const x = await album(coast); return x.album.entries.length === 3 && x; }); await idle();
    assert.deepEqual(r.album.entries.map(e => e.id), chosen);
    await frame('W2', 'add-items-done', {region: 'list', stage: 'outcome', action: 'Click Add.', expected: 'The album shows the three photos in the order picked.', observed: (await page.locator('#records .fs-tile').count()) + ' photos in the album.',
      mcp: {call: 'fernshelf.albums.get {"id":"<new album>"}', result: r.album.entries.length + ' items, in the picked order', version: ver(r)}, test: 'web-browser.cjs "Add items: albums.update add_ids committed in order"'});
    await page.getByRole('button', {name: 'Rename', exact: true}).click();
    await dialog.locator('[data-field=title]').fill('Coast weekend 2026');
    await frame('W2', 'rename-form', {region: 'dialog', stage: 'action', action: 'Click Rename and type a new title.', expected: 'A form with the current title, the only field.', observed: 'Form with "Coast weekend 2026".',
      mcp: {call: 'fernshelf.albums.get', result: 'title ' + JSON.stringify(r.album.title), version: ver(r)}, test: 'web-browser.cjs "The Rename form shows the title as it is now"'});
    await submit(); await dialog.waitFor({state: 'hidden'}); await idle();
    r = await until('renamed', async () => { const x = await album(coast); return x.album.title === 'Coast weekend 2026' && x; });
    await page.locator('.fs-album-meta[data-album-title="Coast weekend 2026"]').waitFor();
    await frame('W2', 'rename-saved', {region: 'list', stage: 'outcome', action: 'Click Save.', expected: 'The album page shows the new title.', observed: 'Title "Coast weekend 2026".',
      mcp: {call: 'fernshelf.albums.get', result: 'title ' + JSON.stringify(r.album.title), version: ver(r)}, test: 'web-smoke.cjs W2 rename'});
    await page.getByRole('button', {name: 'Rename', exact: true}).click();
    const elsewhere = await mcp.call('fernshelf.albums.update', {id: coast, title: 'Coast weekend (renamed elsewhere)', expected_version: r.version, request_id: 'capture-elsewhere-1'});
    assert.equal(elsewhere.status, 'committed');
    await dialog.locator('[data-field=title]').fill('Coast trip');
    await submit(); await dialog.locator('[data-code=stale_version]').first().waitFor();
    r = await album(coast);
    await frame('W2', 'rename-stale', {region: 'dialog', stage: 'outcome', action: 'Open Rename; meanwhile a separate MCP connection renames the album; type "Coast trip" and save.', expected: 'Refused as stale_version; the form says the library changed; the other rename stays.',
      observed: JSON.stringify(await dialog.locator('[data-code=stale_version]').first().innerText()) + '.', mcp: {call: 'fernshelf.albums.update (separate connection), then fernshelf.albums.get', result: 'title ' + JSON.stringify(r.album.title), version: ver(r)},
      test: 'web-browser.cjs "A form opened before a change elsewhere shows the conflict, and the change elsewhere stays"'});
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await dialog.waitFor({state: 'hidden'});
    await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await idle();
    await page.locator('.fs-album-meta[data-album-title="Coast weekend (renamed elsewhere)"]').waitFor();
    await frame('W2', 'refresh-shows-other-change', {region: 'list', stage: 'outcome', action: 'Cancel, then click Refresh.', expected: 'The page shows the title set elsewhere.', observed: 'Title "Coast weekend (renamed elsewhere)".',
      mcp: {call: 'fernshelf.albums.get', result: 'title ' + JSON.stringify(r.album.title), version: ver(r)}, test: 'web-browser.cjs "Refresh shows the change made elsewhere"'});
    await select(chosen[2]);
    await page.locator('.detail').getByRole('button', {name: /^Remove from “/}).click();
    r = await until('removed', async () => { const x = await album(coast); return x.album.entries.length === 2 && x; }); await idle();
    await frame('W2', 'remove-from-album', {region: 'list', stage: 'outcome', action: 'Open the third photo in the album and click Remove from "Coast weekend (renamed elsewhere)".', expected: 'The album keeps two photos; the photo stays in the library.',
      observed: (await page.locator('#records .fs-tile').count()) + ' photos in the album.', mcp: {call: 'fernshelf.albums.get; fernshelf.items.get', result: r.album.entries.length + ' items; removed photo state ' + (await item(chosen[2])).item.state, version: ver(r)},
      test: 'web-smoke.cjs W2; w2-organising.test.cjs T07 (remove_ids)'});

    // W3: invite, a join from Infra, create and revoke a link, change a role, save a contribution, a refused delete, a delete that ends access.
    await page.getByRole('button', {name: 'Invite', exact: true}).click();
    await dialog.locator('select[data-field=person_id]').selectOption('person-iris');
    await dialog.locator('select[data-field=role]').selectOption('contributor');
    await frame('W3', 'invite-form', {region: 'dialog', stage: 'action', action: 'On the album, click Invite; choose Iris and Contributor.', expected: 'A form with person and role only.', observed: 'Iris, Contributor chosen.',
      mcp: {call: 'fernshelf.albums.get', result: r.album.members.length + ' members', version: ver(r)}, test: 'web-browser.cjs "Invite: the dialog shows exactly person_id, role"'});
    await submit(); await dialog.waitFor({state: 'hidden'});
    r = await until('invited', async () => { const x = await album(coast); return x.album.members.some(m => m.person_id === 'person-iris' && m.status === 'invited') && x; }); await idle();
    await frame('W3', 'invited', {region: 'list', stage: 'outcome', action: 'Click Invite.', expected: 'Iris is listed as invited; the album is shared.', observed: JSON.stringify((await page.locator('.fs-sharing').innerText()).split('\n').slice(0, 4).join(' / ')) + '.',
      mcp: {call: 'fernshelf.albums.get', result: 'state ' + r.album.state + '; Iris ' + r.album.members.find(m => m.person_id === 'person-iris').status + ' as ' + r.album.members.find(m => m.person_id === 'person-iris').role, version: ver(r)},
      test: 'web-browser.cjs "Invite: Iris invited as contributor"'});
    const join = await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: {event_id: 'ev-capture-join', at: '2026-11-20T09:20:00-08:00',
      operation: 'fernshelf.member.changed', payload: {album_id: coast, person_id: 'person-iris', change: 'join'}}});
    assert.equal(join.status, 'committed');
    await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await idle();
    await until('joined shown', async () => /Iris[\s\S]*Joined/.test(await page.locator('.fs-sharing').innerText()));
    r = await album(coast);
    await frame('W3', 'joined-after-refresh', {region: 'list', stage: 'outcome', action: 'Infra applies a member.changed join for Iris (env.apply_event on the separate Infra connection); click Refresh.', expected: 'Iris is listed as joined.',
      observed: 'Iris shown as Joined.', mcp: {call: 'env.apply_event ev-capture-join, then fernshelf.albums.get', result: 'Iris ' + r.album.members.find(m => m.person_id === 'person-iris').status, version: ver(r)},
      test: 'web-browser.cjs "Refresh shows a removal request that arrived as an event" (same mechanism)'});
    await page.getByRole('button', {name: 'Create link', exact: true}).click();
    await frame('W3', 'create-link-form', {region: 'dialog', stage: 'action', action: 'Click Create link.', expected: 'A form with an optional expiry only.', observed: 'Form open, expiry empty.',
      mcp: {call: 'fernshelf.albums.get', result: r.album.links.length + ' links', version: ver(r)}, test: 'web-browser.cjs "Create link: the dialog shows exactly expires_at"'});
    await submit(); await dialog.waitFor({state: 'hidden'});
    r = await until('link', async () => { const x = await album(coast); return x.album.links.some(l => l.state === 'active') && x; }); await idle();
    await frame('W3', 'link-active', {region: 'list', stage: 'outcome', action: 'Click Create link with no expiry.', expected: 'An active link is listed by state and creation date, never by ID.', observed: 'Active link listed.',
      mcp: {call: 'fernshelf.albums.get', result: 'link state active, expires_at none', version: ver(r)}, test: 'web-browser.cjs "Create link: an active link without expiry"'});
    await page.locator('.fs-sharing').getByRole('button', {name: 'Revoke', exact: true}).click();
    await frame('W3', 'revoke-confirm', {region: 'dialog', stage: 'intermediate', action: 'Click Revoke on the link.', expected: 'A confirmation; nothing is revoked yet.', observed: 'Confirmation open.',
      mcp: {call: 'fernshelf.albums.get', result: 'link still active', version: ver(r)}, test: 'web-browser.cjs "Revoke link: link revoked"'});
    await dialog.getByRole('button', {name: 'Revoke link'}).click(); await dialog.waitFor({state: 'hidden'});
    r = await until('revoked', async () => { const x = await album(coast); return x.album.links.every(l => l.state === 'revoked') && x; }); await idle();
    await frame('W3', 'link-revoked', {region: 'list', stage: 'outcome', action: 'Click Revoke link.', expected: 'The link is listed as revoked.', observed: 'Link shown as revoked.',
      mcp: {call: 'fernshelf.albums.get', result: 'link state revoked', version: ver(r)}, test: 'web-browser.cjs "Revoke link: link revoked"'});
    await nav('Albums'); await page.locator('[data-album-id="al-reunion-2026"]').click(); await idle();
    await page.locator('.fs-person', {hasText: 'Kofi Darrow'}).getByRole('button', {name: 'Change role'}).click();
    await dialog.locator('select[data-field=role]').selectOption('contributor');
    await frame('W3', 'change-role-form', {region: 'dialog', stage: 'action', action: 'On Reunion 2026, click Change role for Kofi and choose Contributor.', expected: 'A form with the role only.', observed: 'Contributor chosen.',
      mcp: {call: 'fernshelf.albums.get {"id":"al-reunion-2026"}', result: 'Kofi viewer', version: ver(await album('al-reunion-2026'))}, test: 'web-browser.cjs "Change role: the dialog shows exactly role"'});
    await submit(); await dialog.waitFor({state: 'hidden'});
    r = await until('role', async () => { const x = await album('al-reunion-2026'); return x.album.members.find(m => m.person_id === 'person-kofi').role === 'contributor' && x; }); await idle();
    await frame('W3', 'role-changed', {region: 'list', stage: 'outcome', action: 'Click Save.', expected: 'Kofi is listed as a contributor.', observed: JSON.stringify((await page.locator('.fs-person', {hasText: 'Kofi Darrow'}).first().innerText()).split('\n').join(' / ')) + '.',
      mcp: {call: 'fernshelf.albums.get {"id":"al-reunion-2026"}', result: 'Kofi contributor', version: ver(r)}, test: 'web-browser.cjs "Change role: Kofi is a contributor"'});
    const saved = (await mcp.call('fernshelf.items.search', {source: 'saved_from_share'})), savedBefore = saved.total, savedIds = new Set(saved.rows.map(x => x.id));
    // A photo a member added that has a caption. Members' photos carry no image file in this library, so
    // the dialog and the saved copy show the placeholder.
    const shared = (await album('al-reunion-2026')).album.contributions.find(c => c.caption);
    await page.locator('[data-contribution-id="' + shared.id + '"]').click();
    await until('who can see the contribution', async () => !/Checking who can see it/.test(await dialog.innerText()));
    await frame('W3', 'contribution-dialog', {region: 'dialog', stage: 'intermediate', action: 'Click the photo ' + JSON.stringify(shared.caption) + ' that a member added.', expected: 'Its details, who added it, and Save to my library; members\' photos have no image file here, so the placeholder is shown.',
      observed: 'Dialog for ' + JSON.stringify(shared.caption) + ', ' + JSON.stringify((await dialog.innerText()).match(/Shared by [^\n]*/)?.[0] || 'shared photo') + '.',
      mcp: {call: 'fernshelf.items.search {"source":"saved_from_share"}', result: savedBefore + ' saved copies', version: ver(r)}, test: 'web-browser.cjs "Save to my library: albums.save_item"'});
    await dialog.getByRole('button', {name: 'Save to my library'}).click(); await dialog.waitFor({state: 'hidden'});
    r = await until('saved', async () => { const x = await mcp.call('fernshelf.items.search', {source: 'saved_from_share'}); return x.total === savedBefore + 1 && x; }); await idle();
    const copy = r.rows.find(x => !savedIds.has(x.id));
    await nav('Photos'); await select(copy.id);
    await frame('W3', 'contribution-saved', {region: 'panel', stage: 'outcome', action: 'Click Save to my library, then open the copy in Photos.', expected: 'A copy in my library with the member\'s caption, source "saved from a shared album"; like the shared photo, it has no image file.', observed: 'Panel for the copy: ' + JSON.stringify(await page.locator('.detail h2').innerText()) + '.',
      mcp: {call: 'fernshelf.items.search {"source":"saved_from_share"}', result: r.total + ' saved copies (+1)', version: ver(r)}, test: 'web-browser.cjs "Save to my library: albums.save_item"'});
    await nav('Albums'); await page.locator('[data-album-id="al-reunion-2026"]').click(); await idle();
    await page.locator('.fs-album-head').getByRole('button', {name: 'Delete album'}).click();
    await dialog.getByRole('button', {name: 'Delete album'}).click();
    await dialog.locator('.form-error[data-code=confirm_required]').waitFor();
    r = await album('al-reunion-2026');
    await frame('W3', 'delete-refused', {region: 'dialog', stage: 'outcome', action: 'Click Delete album on Reunion 2026 and confirm without ticking "Also end access".', expected: 'Refused (confirm_required); the dialog says the album is still shared and what to tick; nothing is deleted.',
      observed: JSON.stringify(await dialog.locator('.form-error').innerText()) + '.', mcp: {call: 'fernshelf.albums.get {"id":"al-reunion-2026"}', result: 'deleted_at ' + r.album.deleted_at + ', state ' + r.album.state, version: ver(r)},
      test: 'web-browser.cjs "A refused delete (confirm_required) says what to do and changes nothing"'});
    await dialog.getByRole('button', {name: 'Cancel'}).click(); await dialog.waitFor({state: 'hidden'});
    await nav('Albums'); await page.locator('[data-album-id="' + coast + '"]').click(); await idle();
    await page.locator('.fs-album-head').getByRole('button', {name: 'Delete album'}).click();
    await dialog.locator('input[type=checkbox]').check();
    await frame('W3', 'delete-with-end-access', {region: 'dialog', stage: 'intermediate', action: 'On the album Iris joined, click Delete album and tick "Also end access".', expected: 'The confirmation names the joined member it ends access for.', observed: JSON.stringify((await dialog.innerText()).split('\n').filter(Boolean).slice(0, 3).join(' / ')) + '.',
      mcp: {call: 'fernshelf.albums.get', result: 'Iris joined', version: ver(await album(coast))}, test: 'edge-cases.test.cjs "albums.delete asks for confirm only while…"'});
    await dialog.getByRole('button', {name: 'Delete album'}).click(); await dialog.waitFor({state: 'hidden'});
    r = await until('deleted', async () => { const x = await album(coast); return x.album.deleted_at && x; }); await idle();
    const listed = await page.locator('[data-album-id="' + coast + '"]').count();
    await frame('W3', 'album-deleted', {union: {label: 'first two rows of albums', selectors: ['section.collection h2', '.fs-album-card >> nth=5']}, stage: 'outcome', action: 'Click Delete album.', expected: 'The album is gone from Albums; its photos stay in the library; Iris no longer sees them.', observed: 'Albums view; the deleted album is ' + (listed ? 'still listed' : 'not listed') + '.',
      mcp: {call: 'fernshelf.albums.get; fernshelf.exposure.get', result: 'deleted_at ' + r.album.deleted_at + '; ' + chosen[0] + ' visible_to ' + JSON.stringify((await mcp.call('fernshelf.exposure.get', {id: chosen[0]})).visible_to), version: ver(r)},
      test: 'w2-organising.test.cjs T07; edge-cases.test.cjs "albums.delete revokes only the links active at that time"'});
    assert.equal(listed, 0);

    // W4: requests, where an item is visible, honour with the result, decline, a re-share warning, a new request arriving.
    await nav('Requests');
    let pending = (await mcp.call('fernshelf.removals.list', {state: 'pending'}));
    await frame('W4', 'requests', {stage: 'start', action: 'Open Requests.', expected: 'Pending requests first, each with requester, message, scope and the named photos.', observed: (await page.locator('[data-request-id]').count()) + ' request cards.',
      mcp: {call: 'fernshelf.removals.list {"state":"pending"}', result: pending.removals.length + ' pending', version: ver(pending)}, test: 'web-smoke.cjs "Requests (2 pending)"'});
    const albumScoped = pending.removals.find(x => x.scope.type === 'album'), other = pending.removals.find(x => x !== albumScoped);
    await select(albumScoped.item_ids[0]);
    await page.locator('.detail .fs-exposure .fs-surface').first().waitFor();
    r = await mcp.call('fernshelf.exposure.get', {id: albumScoped.item_ids[0]});
    await frame('W4', 'where-visible', {focus: '.detail .fs-exposure', stage: 'intermediate', action: 'Click the photo Kofi\'s request names.', expected: 'The panel shows where it is visible before answering.', observed: 'Who can see this lists ' + r.albums.map(a => a.title).join(', ') + '.',
      mcp: {call: 'fernshelf.exposure.get', result: 'albums ' + r.albums.map(a => a.title).join(', ') + '; visible_to ' + r.visible_to.length, version: ver(r)}, test: 'web-browser.cjs "Before answering, the photo panel shows where the item is visible (exposure.get)"'});
    await page.locator('[data-request-id="' + albumScoped.id + '"]').getByRole('button', {name: 'Honour…'}).click();
    await dialog.locator('[data-field=note]').fill('Taken out of the reunion album.');
    await frame('W4', 'honour-form', {region: 'dialog', stage: 'action', action: 'Click Honour… on Kofi\'s request and write a note.', expected: 'A form with the note only.', observed: 'Note typed.',
      mcp: {call: 'fernshelf.removals.list', result: albumScoped.state, version: ver(pending)}, test: 'web-browser.cjs "Honour: the dialog shows exactly note"'});
    await submit();
    await page.locator('dialog.fs-dialog[open] h2', {hasText: 'Request honoured'}).waitFor();
    r = await until('honoured', async () => { const x = await mcp.call('fernshelf.removals.list', {state: 'honored'}); return x.removals.some(y => y.id === albumScoped.id) && x; });
    const hon = r.removals.find(y => y.id === albumScoped.id);
    await frame('W4', 'honour-result', {region: 'dialog', stage: 'intermediate', action: 'Click Honour.', expected: 'A summary of what was taken down and the views and saves that cannot be called back.', observed: JSON.stringify((await page.locator('dialog.fs-dialog[open]').innerText()).split('\n').filter(Boolean).slice(0, 3).join(' / ')) + '.',
      mcp: {call: 'fernshelf.removals.list {"state":"honored"}', result: 'state honored, cleared ' + hon.cleared.map(c => c.album_ids.length + ' album(s)').join(', ') + ', note ' + JSON.stringify(hon.answers.at(-1).note), version: ver(r)},
      test: 'web-browser.cjs "Honour shows what was taken down and what was already seen"'});
    await page.locator('dialog.fs-dialog[open]').getByRole('button', {name: 'Close'}).click(); await idle();
    await frame('W4', 'honoured-card', {focus: '[data-request-id="' + albumScoped.id + '"]', stage: 'outcome', action: 'Close the summary.', expected: 'The request is shown as honoured with the note and the albums it was taken down from.', observed: JSON.stringify((await page.locator('[data-request-id="' + albumScoped.id + '"]').innerText()).split('\n').filter(Boolean).slice(0, 2).join(' / ')) + '.',
      mcp: {call: 'fernshelf.items.get', result: 'removal_history rows ' + (await item(albumScoped.item_ids[0])).item.removal_history.length, version: ver(r)}, test: 'web-browser.cjs "Honour: request honoured with the note"'});
    await page.locator('[data-request-id="' + other.id + '"]').getByRole('button', {name: 'Decline…'}).click();
    await dialog.locator('[data-field=note]').fill('This one stays in our private album.');
    await frame('W4', 'decline-form', {region: 'dialog', stage: 'action', action: 'Click Decline… on Lena\'s request and write a note.', expected: 'A form with the note only.', observed: 'Note typed.',
      mcp: {call: 'fernshelf.removals.list', result: other.state, version: ver(r)}, test: 'web-browser.cjs "Decline: the dialog shows exactly note"'});
    await submit(); await dialog.waitFor({state: 'hidden'});
    r = await until('declined', async () => { const x = await mcp.call('fernshelf.removals.list', {state: 'declined'}); return x.removals.some(y => y.id === other.id) && x; }); await idle();
    await frame('W4', 'declined', {focus: '[data-request-id="' + other.id + '"]', stage: 'outcome', action: 'Click Decline.', expected: 'The request is shown as declined with the note; no album changes.', observed: JSON.stringify((await page.locator('[data-request-id="' + other.id + '"]').innerText()).split('\n').filter(Boolean).slice(0, 2).join(' / ')) + '.',
      mcp: {call: 'fernshelf.removals.list {"state":"declined"}', result: 'state declined', version: ver(r)}, test: 'web-browser.cjs "Decline: request declined"'});
    await select(albumScoped.item_ids[0]);
    await detailButton('Add to album').click();
    await frame('W4', 're-share-chooser', {region: 'dialog', stage: 'action', action: 'On the honoured photo, click Add to album.', expected: 'A chooser of my albums.', observed: 'Chooser open.',
      mcp: {call: 'fernshelf.albums.list', result: (await mcp.call('fernshelf.albums.list', {})).albums.length + ' albums', version: ver(r)}, test: 'web-browser.cjs "Re-sharing an honoured item shows the removal_honored warning"'});
    await dialog.getByRole('button', {name: /Family 2026/}).click();
    const warned = page.locator('dialog.fs-dialog[open]', {hasText: /Shown again to people who asked for removal/i}); await warned.waitFor();
    r = await album('al-family-2026');
    await frame('W4', 're-share-warning', {region: 'dialog', stage: 'outcome', action: 'Choose Family 2026, which is shared.', expected: 'Accepted, with a notice naming Kofi, the photo and when his request was honoured.', observed: JSON.stringify((await warned.innerText()).split('\n').filter(Boolean).slice(0, 2).join(' / ')) + '.',
      mcp: {call: 'fernshelf.albums.get {"id":"al-family-2026"}', result: 'contains the photo: ' + r.album.entries.some(e => e.id === albumScoped.item_ids[0]), version: ver(r)}, test: 'web-browser.cjs "Re-sharing an honoured item shows the removal_honored warning"'});
    await warned.getByRole('button', {name: 'Close'}).click(); await idle();
    const scenario = JSON.parse(fs.readFileSync(path.join(pkg, 'examples/scenario.json'), 'utf8'));
    assert.equal((await infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: scenario})).status, 'committed');
    await nav('Requests'); await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await idle();
    await page.locator('[data-request-id="' + scenario.payload.removal_id + '"]').waitFor();
    pending = await mcp.call('fernshelf.removals.list', {state: 'pending'});
    await frame('W4', 'request-arrives', {region: 'list', stage: 'outcome', action: 'Infra applies Dana\'s removal.requested (examples/scenario.json); click Refresh.', expected: 'The new request is listed first and counted in the navigation.', observed: JSON.stringify((await page.locator('nav').innerText()).match(/Requests[^\n]*/)[0]) + '.',
      mcp: {call: 'env.apply_event ' + scenario.event_id + ', then fernshelf.removals.list {"state":"pending"}', result: pending.removals.length + ' pending', version: ver(pending)}, test: 'web-browser.cjs "Refresh shows a removal request that arrived as an event"'});

    // W5: the kept version of a stack, storage, trash and restore, delete forever with the freed space,
    // a stale confirmation, storage after.
    await nav('Photos'); await select('it-2611-0942');
    r = await item('it-2611-0942');
    const stackBefore = r.item.stack;
    await frame('W5', 'stack-versions', {focus: '.detail .fs-versions', stage: 'start', action: 'Open a photo that has edited versions.', expected: 'The panel lists every version with its time and size and marks the cover.',
      observed: JSON.stringify((await page.locator('.detail .fs-versions').innerText()).split('\n').filter(Boolean).slice(0, 4).join(' / ')) + '.',
      mcp: {call: 'fernshelf.items.get {"id":"it-2611-0942"}', result: 'stack of ' + stackBefore.versions.length + ', cover is version ' + (stackBefore.versions.findIndex(v => v.id === stackBefore.cover_id) + 1), version: ver(r)}, test: 'web-browser.cjs "Make cover: the stack cover changes"'});
    await page.locator('.detail .fs-versions').getByRole('button', {name: 'Make cover'}).first().click();
    r = await until('cover', async () => { const x = await item('it-2611-0942'); return x.item.stack.cover_id !== stackBefore.cover_id && x; }); await idle();
    // The grid shows a stack by its cover, so the new cover is the tile to open.
    await select(r.item.stack.cover_id);
    await page.locator('.detail .fs-versions').first().waitFor();
    await frame('W5', 'cover-changed', {focus: '.detail .fs-versions', stage: 'outcome', action: 'Click Make cover on another version, then open the stack again from the grid.', expected: 'That version becomes the cover and the grid shows the stack by it; nothing is deleted.',
      observed: JSON.stringify((await page.locator('.detail .fs-versions').innerText()).split('\n').filter(Boolean).slice(0, 4).join(' / ')) + '.',
      mcp: {call: 'fernshelf.items.get {"id":"it-2611-0942"}', result: 'cover is now version ' + (r.item.stack.versions.findIndex(v => v.id === r.item.stack.cover_id) + 1) + ' of ' + r.item.stack.versions.length, version: ver(r)}, test: 'web-browser.cjs "Make cover: the stack cover changes"; w2-organising.test.cjs T06 covers'});
    await nav('Photos');
    // A photo of the grid that no request names and no earlier step used.
    const used = new Set([...(await mcp.call('fernshelf.removals.list', {})).removals.flatMap(x => x.item_ids), 'it-2611-0931', 'it-2611-0943', ...chosen]);
    const tiles = await until('tiles with images', async () => { const t = await page.locator('#records .fs-tile').evaluateAll(n => n.map(x => ({id: x.dataset.recordId, image: !!x.querySelector('img'), caption: /\S/.test(x.innerText)}))); return t.some(x => x.image) && t; });
    let victim;
    for (const t of tiles.filter(x => !used.has(x.id) && x.image)) { const x = (await item(t.id)).item; if (x.caption && x.source === 'camera' && !x.stack) { victim = t.id; break; } }
    await select(victim);
    r = await item(victim);
    const victimAlbums = r.item.albums.length;
    await frame('W5', 'before-trash', {region: 'panel', stage: 'start', action: 'Open a photo.', expected: 'The panel offers Move to trash.', observed: 'Panel for ' + JSON.stringify(await page.locator('.detail h2').innerText()) + '.',
      mcp: {call: 'fernshelf.items.get', result: 'state ' + r.item.state, version: ver(r)}, test: 'web-browser.cjs "Move to trash: item trashed"'});
    await detailButton('Move to trash').click();
    r = await until('trashed', async () => { const x = await item(victim); return x.item.state === 'trashed' && x; }); await idle();
    await nav('Trash'); await select(victim);
    await frame('W5', 'in-trash', {stage: 'outcome', action: 'Click Move to trash, then open Trash.', expected: 'The photo is in the trash and says when it is deleted for good.', observed: JSON.stringify(await page.locator('.detail .fs-warning').innerText()) + '.',
      mcp: {call: 'fernshelf.items.get', result: 'state trashed, purge_at ' + r.item.purge_at, version: ver(r)}, test: 'web-browser.cjs "Trashed item shows when it will be deleted for good"'});
    await detailButton('Restore').click();
    r = await until('restored', async () => { const x = await item(victim); return x.item.state === 'active' && x; }); await idle();
    await frame('W5', 'restored', {region: 'list', stage: 'outcome', action: 'Click Restore.', expected: 'The photo leaves the trash and is back in the ' + victimAlbums + ' album(s) it was in.', observed: 'Trash no longer lists it.',
      mcp: {call: 'fernshelf.items.get', result: 'state active, in ' + r.item.albums.length + ' album(s)', version: ver(r)}, test: 'web-browser.cjs "Restore: item back in its albums"'});
    await page.getByRole('button', {name: 'Select', exact: true}).click(); await idle();
    const binned = (await page.locator('#records .fs-tile').evaluateAll(n => n.map(x => x.dataset.recordId))).slice(0, 2);
    for (const id of binned) await page.locator('#records [data-record-id="' + id + '"]').click();
    await page.locator('.fs-bulk').getByRole('button', {name: 'Delete forever'}).click();
    await frame('W5', 'delete-forever-confirm', {region: 'dialog', stage: 'intermediate', action: 'In Trash, click Select, pick two items, click Delete forever.', expected: 'A confirmation that this cannot be undone.', observed: JSON.stringify((await dialog.innerText()).split('\n').filter(Boolean).slice(0, 2).join(' / ')) + '.',
      mcp: {call: 'fernshelf.items.get (both)', result: 'both trashed', version: ver(await item(binned[0]))}, test: 'web-browser.cjs "Delete forever: items.purge with confirm, and the freed space is shown"'});
    await dialog.getByRole('button', {name: 'Delete forever'}).click();
    const freed = page.locator('dialog.fs-dialog[open]', {hasText: 'freed'}); await freed.waitFor();
    r = await until('purged', async () => { const x = await Promise.all(binned.map(item)); return x.every(i => i.item.state === 'purged') && x[1]; });
    await frame('W5', 'freed', {region: 'dialog', stage: 'outcome', action: 'Click Delete forever.', expected: 'The freed space is shown.', observed: JSON.stringify((await freed.innerText()).match(/[\d.]+ [KMG]?B freed/)?.[0]) + '.',
      mcp: {call: 'fernshelf.items.get (both)', result: 'both purged', version: ver(r)}, test: 'web-browser.cjs "Delete forever: items.purge with confirm, and the freed space is shown"'});
    await freed.getByRole('button', {name: 'Close'}).click(); await dialog.waitFor({state: 'hidden'}); await idle();
    await page.getByRole('button', {name: 'Select', exact: true}).click().catch(() => {}); await idle();
    const last = await page.locator('#records .fs-tile').first().getAttribute('data-record-id');
    await select(last);
    await detailButton('Delete forever').click();
    const restoredElsewhere = await mcp.call('fernshelf.items.restore', {ids: [last], expected_version: (await item(last)).version, request_id: 'capture-restore-elsewhere'});
    assert.equal(restoredElsewhere.status, 'committed');
    await dialog.getByRole('button', {name: 'Delete forever'}).click();
    await dialog.locator('[data-code=stale_version]').first().waitFor();
    r = await item(last);
    await frame('W5', 'delete-forever-stale', {region: 'dialog', stage: 'outcome', action: 'Open Delete forever on another trashed item; meanwhile a separate MCP connection restores it; confirm.', expected: 'Refused as stale_version; the item is not deleted.',
      observed: JSON.stringify(await dialog.locator('[data-code=stale_version]').first().innerText()) + '.', mcp: {call: 'fernshelf.items.restore (separate connection), then fernshelf.items.get', result: 'state ' + r.item.state, version: ver(r)},
      test: 'web-browser.cjs "Delete forever drawn before the item was restored elsewhere: confirming shows the conflict and nothing is written"'});
    await dialog.getByRole('button', {name: /^(Cancel|Close)$/}).click(); await dialog.waitFor({state: 'hidden'}); await idle();
    await nav('Storage');
    r = await mcp.call('fernshelf.storage.summary', {});
    await frame('W5', 'storage-after', {region: 'list', stage: 'outcome', action: 'Open Storage.', expected: 'Used space is lower by the bytes deleted for good.', observed: JSON.stringify((await page.locator('#app').innerText()).match(/[\d.]+ GB of [\d.]+ GB[^\n]*/)?.[0] || 'meter shown') + '.',
      mcp: {call: 'fernshelf.storage.summary', result: 'used_bytes ' + r.storage.used_bytes + ' (' + (r.storage.used_bytes - usedBefore) + ' since the start)', version: ver(r)}, test: 'w5-storage.test.cjs T13 (only a purge frees bytes)'});

    // Reload: committed state is read back.
    await nav('Requests');
    await page.reload(); await idle(); await page.locator('[data-request-id="' + albumScoped.id + '"]').waitFor();
    r = await mcp.call('fernshelf.removals.list', {});
    await frame('Reload', 'requests-after-reload', {region: 'list', stage: 'outcome', action: 'Reload the browser tab.', expected: 'The open view and every committed answer are read back.', observed: (await page.locator('[data-request-id]').count()) + ' request cards; the honoured and declined answers are shown.',
      mcp: {call: 'fernshelf.removals.list', result: r.removals.map(x => x.state).join(', '), version: ver(r)}, test: 'web-browser.cjs "Reload: committed caption and favourite are read back"'});
    await nav('Photos'); await select('it-2611-0943');
    await frame('Reload', 'caption-after-reload', {region: 'panel', stage: 'outcome', action: 'Open "Mum and me on the hall steps" after the reload.', expected: 'The caption saved in W2.', observed: 'Panel title ' + JSON.stringify(await page.locator('.detail h2').innerText()) + '.',
      mcp: {call: 'fernshelf.items.get', result: 'caption ' + JSON.stringify((await item('it-2611-0943')).item.caption), version: ver(await item('it-2611-0943'))}, test: 'web-browser.cjs "Reload: committed caption and favourite are read back"'});
    await context.close();

    // Phone width.
    const phone = await browser.newContext({viewport: PHONE, isMobile: true, hasTouch: true, timezoneId: 'America/Los_Angeles', locale: 'en-GB'});
    const p = await phone.newPage(); p.setDefaultTimeout(45000); watch(p, 'phone');
    await p.goto(host.accessUrl); await idle(p); await p.locator('#records .fs-tile').first().waitFor();
    await until('phone thumbnails', () => p.locator('#records .fs-tile img').count());
    await frame('Phone', 'photos', {stage: 'start', action: 'Open the page at 390 px.', expected: 'The grid and the whole navigation fit the width.', observed: 'No horizontal overflow: ' + (await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)) + '.',
      mcp: null, test: 'web-browser.cjs "390 px: Photos has no horizontal page overflow"'}, p);
    await p.locator('#records [data-record-id="' + featured.id + '"]').click(); await p.locator('.detail[data-selected-id="' + featured.id + '"]').waitFor(); await p.waitForTimeout(800);
    await frame('Phone', 'photo-panel', {keepScroll: true, stage: 'outcome', action: 'Tap the photo ' + JSON.stringify(featured.caption) + '.', expected: 'The page scrolls to its panel, which shows the image.',
      observed: 'Panel title in view: ' + (await p.locator('.detail .fs-photo h2').evaluate(h => { const b = h.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })) + '.',
      mcp: null, test: 'web-browser.cjs "390 px: tapping a photo scrolls to its panel"'}, p);
    await nav('Albums', p); await p.locator('[data-album-id="al-reunion-2026"]').click(); await idle(p);
    await frame('Phone', 'album', {stage: 'outcome', action: 'Open Albums, then Reunion 2026.', expected: 'The album page fits the width.', observed: 'No horizontal overflow: ' + (await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)) + '.',
      mcp: null, test: 'web-browser.cjs "390 px: album page has no horizontal page overflow"'}, p);
    await nav('Requests', p);
    await frame('Phone', 'requests', {stage: 'outcome', action: 'Open Requests.', expected: 'Request cards with their answer buttons fit the width.', observed: (await p.locator('[data-request-id]').count()) + ' request cards.',
      mcp: null, test: 'web-browser.cjs "390 px: Requests has no horizontal page overflow"'}, p);
    await phone.close();

    // Read-only profile: a fresh run where the Agent may only read.
    const restricted = await start({app: 'fernshelf', registry, run: 'capture-readonly', stateDir, profile: 'scenario'}); hosts.push(restricted);
    const rc = await browser.newContext({viewport: DESKTOP, timezoneId: 'America/Los_Angeles', locale: 'en-GB'}), rp = await rc.newPage(); rp.setDefaultTimeout(45000); watch(rp, 'read-only');
    await rp.goto(restricted.accessUrl); await idle(rp); await rp.locator('.detail[data-selected-id]').waitFor();
    await nav('Requests', rp);
    const rmcp = patient(await open('agent', 'capture-readonly')), before = await rmcp.call('fernshelf.removals.list', {state: 'pending'});
    const denied = await rp.evaluate(async () => { const s = await (await fetch('/session')).json(); const res = await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': s.csrf}, body: JSON.stringify({name: 'fernshelf.removals.respond', arguments: {id: 'rr-0005', decision: 'decline', request_id: 'forced', expected_version: {epoch: 1, revision: 0}}})}); return res.status; });
    await frame('Denied', 'read-only-profile', {stage: 'outcome', action: 'Open a run started with --profile scenario (reads only); open Requests; send a write directly from the page\'s session.', expected: 'No Honour or Decline buttons; the forced write is refused by the Host.',
      observed: (await rp.getByRole('button', {name: /^(Honour…|Decline…)$/}).count()) + ' answer buttons; forced write answered HTTP ' + denied + '.', mcp: {call: 'fernshelf.removals.list {"state":"pending"} on that run, before and after', result: before.removals.length + ' pending before, ' + (r = await rmcp.call('fernshelf.removals.list', {state: 'pending'})).removals.length + ' after', version: ver(before) + ' → ' + ver(r)}, test: 'web-browser.cjs "Restricted profile: requests are readable but cannot be answered"; "a forced write from the page is refused by the Host"'}, rp);
    assert.equal(denied, 403);
    await rc.close();
    assert.deepEqual(errors, [], 'JavaScript errors');
    report.passed = true;
  } finally {
    report.javascript_errors = errors;
    fs.writeFileSync(path.join(out, 'sequences.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'SEQUENCES.md'), markdown(report));
    for (const c of clients) await c.close().catch(() => {});
    await browser.close();
    for (const h of hosts) await h.close().catch(() => {});
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
  console.log(frames.length + ' frames in ' + out + (report.passed ? '' : ' (INCOMPLETE)'));
  if (!report.passed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

function markdown(r) {
  const cell = s => String(s == null ? '—' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const L = ['# Fernshelf web page: workflow sequences', '',
    'Captured by `node scripts/capture-workflows.cjs` (real controls in ' + r.browser + ', ' + r.host + ', run `' + r.run + '`, profile `' + r.profile + '`, account ' + r.account +
    ', clock ' + r.clock + ', browser time zone ' + r.time_zone + '). Desktop frames are ' + r.viewports.desktop.width + '×' + r.viewports.desktop.height + ', phone frames ' + r.viewports.phone.width + '×' + r.viewports.phone.height +
    '. After every step the script reads the record through a separate Agent MCP connection to the same run; that read and the version it answered are in the last columns. ' +
    'Every frame was checked by the script for raw record IDs, `null` and Agent wording in the visible text. ' + r.frames.length + ' frames' + (r.passed ? '.' : '; the run did not finish.'), '',
    'Placeholder tiles: ' + r.library.items_with_image_file + ' of the ' + r.library.items + ' items in the reference library (' + r.library.active_items_with_image_file + ' of the ' + r.library.active_items +
    ' active ones) have an image file, a drawn stand-in image; the rest of the library, and every photo another member adds to a shared album, is metadata only, so the page shows it as a placeholder tile with its caption or place. ' +
    'Frames about one photo use a photo with an image file and a caption, except W3 10–11 (a member\'s photo and its saved copy, which have no file) and W5 4 (an item in the trash, whose image the page does not read).', '',
    'Reproducible: this file and `sequences.json` hold no wall-clock time, Node version or file size, and a re-run of the script writes them byte for byte; the frames show the same content, but their pixels can differ between runs.', ''];
  for (const wf of [...new Set(r.frames.map(f => f.workflow))]) {
    L.push('## ' + wf, '', '| # | Frame | Stage | Action | Expected | Observed | MCP confirmation | Version | Test or check |', '| ---: | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const f of r.frames.filter(x => x.workflow === wf)) {
      L.push('| ' + f.n + ' | [' + f.file + '](' + f.file + ') | ' + f.stage + ' | ' + cell(f.action) + ' | ' + cell(f.expected) + ' | ' + cell(f.observed) + ' | ' +
        (f.mcp ? '`' + cell(f.mcp.call) + '`: ' + cell(f.mcp.result) : 'not applicable (layout)') + ' | ' + cell(f.mcp && f.mcp.version) + ' | ' + cell(f.test) + ' |');
    }
    L.push('');
  }
  return L.join('\n');
}
