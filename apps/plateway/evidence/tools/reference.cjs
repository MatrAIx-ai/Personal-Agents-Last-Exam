'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '..', 'reference');
const LIMIT = 400 * 1024;
const article = slug => 'https://help.doordash.com/en-us/consumers/article/' + slug;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const SOURCES = [
  { slug: 'how-do-i-update-my-account-information', image: 0, above: 8, scale: 2, tight: true, frames: [
    { file: '01-browse-home.png', workflow: 'Browse and search', shows: 'Home screen: the delivery address, cuisine shortcuts, filters for rating and delivery time, and favourite stores.', redact: [{ box: [0.33, 0.125, 0.64, 0.19], what: 'delivery street address' }] },
    { file: '25-account-menu.png', workflow: 'Account', shows: 'Account page: profile, payment methods, saved addresses, notifications.', redact: [{ box: [0.04, 0.245, 0.2, 0.278], what: 'profile display name' }], note: 'The banner and the screen below it are misaligned in the publisher\'s animated image itself; the frame is reproduced as published.' },
    { skip: true }
  ] },
  { slug: 'profiles', image: 0, above: 160, file: '02-browse-search.png', workflow: 'Browse and search', shows: 'The search box with the chosen location.', visible: 'city name (New York)' },
  { slug: 'is-doordash-available-in-my-city', text: { until: 'neighboring cities' }, file: '03-browse-availability.png', workflow: 'Browse and search', shows: 'Article text: enter a delivery address to see the restaurants that deliver there.' },
  { slug: 'what-is-a-group-order-and-how-can-i-create-one', image: 0, above: 260, file: '04-restaurant-page.png', workflow: 'Restaurant, menu and dish with options', shows: 'A restaurant page: rating, delivery fee, time, distance, featured items and the full menu.', visible: 'restaurant Doc B\'s Fresh Kitchen and its dishes (business)' },
  { slug: 'profiles', image: 7, above: 120, file: '05-restaurant-menu.png', workflow: 'Restaurant, menu and dish with options', shows: 'A restaurant page with menu category tabs, dishes with prices and the restaurant\'s ratings.', redact: [{ box: [0.32, 0.475, 0.93, 0.535], what: 'name of the person who wrote the review' }, { box: [0.32, 0.565, 0.81, 0.645], what: 'review text written by a customer' }], visible: 'restaurant Limon and its dishes (business)' },
  { slug: 'can-i-specify-special-instructions-for-my-order', text: { until: 'double meat' }, alternative: 'No public page shows the item options dialog.', file: '06-dish-preferences.png', workflow: 'Restaurant, menu and dish with options', shows: 'Article text: select a menu item and use its Preferences section; some requests add charges. No public page shows the dish options dialog.' },
  { slug: 'can-i-order-from-different-restaurants-at-the-same-time', text: { until: 'same Dasher' }, alternative: 'No public page shows editing a cart before checkout; this article is about orders from several stores.', file: '07-cart-restaurants.png', workflow: 'Cart edit', shows: 'Article text: items from other nearby stores are added through DoubleDash. No public page shows editing the cart.' },
  { slug: 'i-want-to-add-or-remove-items-in-my-order', text: { until: 'Chat with Support' }, alternative: 'No public page shows editing a cart before checkout; this article is about changing an order after it is placed.', file: '08-cart-after-placing.png', workflow: 'Cart edit', shows: 'Article text: after placing, items are added or removed through a support chat, not in the cart.' },
  { slug: 'can-i-schedule-a-delivery-in-advance', text: { until: 'handle the rest' }, alternative: 'No public page shows the scheduled checkout screen; this article describes it in text.', file: '09-checkout-schedule.png', workflow: 'Checkout, as soon as possible and scheduled', shows: 'Article text: at checkout choose Scheduled, pick a date and time, then Place Order.' },
  { slug: 'what-fees-do-i-pay', text: { until: 'tipping is always optional' }, alternative: 'No public page shows the checkout form; this article lists the fees shown before checkout.', file: '10-checkout-fees.png', workflow: 'Checkout, as soon as possible and scheduled', shows: 'Article text: the fees shown before checkout (service fee, delivery fee, tax, optional tip).' },
  { slug: 'can-i-adjust-the-tip-i-provide-to-my-dasher', image: 1, above: 60, scale: 2, file: '11-checkout-receipt.png', workflow: 'Checkout, as soon as possible and scheduled', shows: 'An order\'s details: items, subtotal, delivery fee, service fee, tax, tip and total.', redact: [{ box: [0.11, 0.32, 0.34, 0.354], what: 'courier name' }], visible: 'restaurant House of Thai and its dishes (business)', note: 'The order details after an order is complete, not the checkout form: no public page shows the checkout form.' },
  { slug: 'customer-where-is-my-order', image: 0, above: 250, file: '12-tracking-stages.png', workflow: 'Order tracking', shows: 'The order stages after checkout: being confirmed, at the restaurant, on the way.' },
  { slug: 'customer-where-is-my-order', image: 1, above: 8, scale: 0.75, frames: [
    { file: '13-tracking-received.png', workflow: 'Order tracking', shows: 'Step 1 of the walkthrough: the live order, received, with Cancel Order and Receipt.', redact: [{ box: [0.55, 0.465, 0.87, 0.585], what: 'delivery destination pin' }], visible: 'store Peet\'s Coffee and its map pin (business); public map labels' },
    { file: '14-tracking-at-restaurant.png', workflow: 'Order tracking', shows: 'Step 2: the order at the restaurant, with the expected arrival.', redact: [{ box: [0.55, 0.465, 0.87, 0.585], what: 'delivery destination pin' }, { box: [0.05, 0.87, 0.25, 0.91], what: 'courier name' }], visible: 'store Peet\'s Coffee and its map pin (business); public map labels' },
    { file: '15-tracking-on-the-way.png', workflow: 'Order tracking', shows: 'Step 3: on the way, arriving in a few minutes.', redact: [{ box: [0.55, 0.465, 0.87, 0.585], what: 'delivery destination pin' }, { box: [0.05, 0.905, 0.25, 0.945], what: 'courier name' }], visible: 'store Peet\'s Coffee and its map pin (business); public map labels' },
    { file: '16-tracking-delivered.png', workflow: 'Order tracking', shows: 'Step 4: delivered, with Rate Your Order.', redact: [{ box: [0.5, 0.345, 0.82, 0.47], what: 'delivery destination pin' }], visible: 'store Peet\'s Coffee and its map pin (business); public map labels' }
  ] },
  { slug: 'how-do-i-cancel-my-order', image: 0, above: 8, frames: [
    { skip: true },
    { file: '17-cancel-help.png', workflow: 'Cancel', shows: 'Step 2 of the walkthrough: Help on the live order.', visible: 'store Frosty Bear and its map pin, nearby business labels (business)' },
    { file: '18-cancel-order.png', workflow: 'Cancel', shows: 'Step 3: Cancel order in the order\'s help menu, then the on-screen prompts.', visible: 'store Frosty Bear (business)' }
  ] },
  { slug: 'how-do-i-cancel-my-order', text: { from: 'Timeline:', until: 'No Refund' }, file: '19-cancel-refunds.png', workflow: 'Cancel', shows: 'Article text: the refund depends on how far the order has gone (full, partial or none).' },
  { slug: 'my-order-was-missing-an-item-incorrect-order', image: 0, above: 8, frames: [
    { skip: true },
    { file: '20-report-order.png', workflow: 'Report missing or incorrect items', shows: 'Step 2 of the walkthrough: the delivered order with Help and Rate Your Order.', redact: [{ box: [0.03, 0.83, 0.95, 0.895], what: 'customer delivery instructions' }] , visible: 'restaurant Deccan Spice and its dishes (business)' },
    { file: '21-report-issues.png', workflow: 'Report missing or incorrect items', shows: 'Step 3: Order issues, Missing items or Items made incorrectly.' , visible: 'restaurant Deccan Spice and its dishes (business)' },
    { file: '22-report-missing.png', workflow: 'Report missing or incorrect items', shows: 'Step 4: which items were missing, chosen per item.' , visible: 'restaurant Deccan Spice and its dishes (business)' }
  ] },
  { slug: 'my-order-was-missing-an-item-incorrect-order', text: { from: 'Here is a quick guide', until: 'Redelivery of your missing' }, file: '23-report-kinds.png', workflow: 'Report missing or incorrect items', shows: 'Article text: what counts as a missing or an incorrect item, and the possible credit or refund.' },
  { slug: 'frequently-asked-questions-user-generated-content', image: 2, above: 60, file: '24-rate.png', workflow: 'Rate', shows: 'Rating after delivery: one to five stars for the delivery, then one to five stars, a written review and per-dish likes for the food.', redact: [{ box: [0.28, 0.07, 0.7, 0.11], what: 'delivery street address' }, { box: [0.4, 0.70, 0.87, 0.745], what: 'courier name' }, { image: 3, box: [0.07, 0.42, 0.88, 0.505], what: 'review text written by a customer' }, { image: 3, box: [0.07, 0.52, 0.33, 0.575], what: 'name of the person who wrote the review' }], visible: 'restaurant Comal Next Door and its dishes (business)', note: 'Older guidance: the same article says a simplified Didn\'t Like / Liked / Loved system replaces the previous 5-star ratings for restaurant orders; this image shows the earlier 5-star screens.' },
  { slug: 'how-do-i-update-my-credit-card-information', text: { until: 'Enter the card number' }, file: '26-account-cards.png', workflow: 'Account', shows: 'Article text: cards are managed in the account; the last card used stays the default.' }
];

async function region(page, src) {
  return page.evaluate(src => {
    const art = document.querySelector('article') || document.querySelector('main');
    const h1 = art.querySelector('h1') || document.querySelector('h1');
    const box = e => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left + scrollX, width: r.width, height: r.height }; };
    const find = text => {
      for (const e of art.querySelectorAll('*')) if (e.textContent.includes(text) && ![...e.children].some(c => c.textContent.includes(text))) return e;
      return null;
    };
    const images = [...art.querySelectorAll('img[src*="migrated-image"]')];
    const a = box(art), title = h1.innerText.trim(), scroll = scrollY;
    const boxes = images.map(box);
    if (src.image !== undefined) {
      const img = images[src.image];
      if (!img) return { error: 'image ' + src.image + ' not found' };
      const i = boxes[src.image];
      return { title, scroll, boxes, image: { natural: img.naturalWidth + 'x' + img.naturalHeight, src: img.currentSrc.split('?')[0], url: img.currentSrc }, x: src.tight ? i.left - 8 : a.left - 8, y: Math.max(box(h1).top - 12, i.top - src.above), width: src.tight ? i.width + 16 : a.width + 16, bottom: i.bottom + 8 };
    }
    const from = src.text.from ? find(src.text.from) : h1, until = find(src.text.until);
    if (!from || !until) return { error: 'text anchor not found' };
    return { title, scroll, boxes, x: a.left - 8, y: box(from).top - 12, width: a.width + 16, bottom: box(until).bottom + 12 };
  }, src);
}

async function settle(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('article img[src*="migrated-image"]')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 30000 });
}

async function redact(browser, bytes, r, redactions, defaultImage, scale) {
  if (!redactions || !redactions.length) return bytes;
  const width = r.width, height = Math.min(r.bottom - r.y, 1500);
  const context = await browser.newContext({ viewport: { width: Math.ceil(width), height: Math.ceil(height) }, deviceScaleFactor: scale });
  try {
    const page = await context.newPage();
    const boxes = redactions.map(x => { const b = r.boxes[x.image ?? defaultImage]; return { left: b.left - r.x + x.box[0] * b.width, top: b.top - r.y + x.box[1] * b.height, width: (x.box[2] - x.box[0]) * b.width, height: (x.box[3] - x.box[1]) * b.height }; });
    await page.setContent('<body style="margin:0"><img id="shot" style="display:block;width:' + width + 'px;height:' + height + 'px" src="data:image/png;base64,' + bytes.toString('base64') + '">' + boxes.map(b => '<div style="position:absolute;background:#9aa0a6;left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px"></div>').join('') + '</body>');
    await page.waitForFunction(() => document.getElementById('shot').complete);
    return await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  } finally { await context.close(); }
}

async function capture(browser, src, scale) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1700 }, deviceScaleFactor: scale, locale: 'en-US', timezoneId: 'America/New_York' });
  const page = await context.newPage();
  try {
    await page.goto(article(src.slug), { waitUntil: 'load', timeout: 60000 });
    await page.locator('h1').first().waitFor();
    for (let y = 0; y < 12000; y += 600) { await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(120); }
    await settle(page);
    let r = await region(page, src);
    if (r.error) throw Error(src.slug + ': ' + r.error);
    await page.evaluate(y => scrollTo(0, y), Math.max(0, r.y - 140));
    await page.waitForTimeout(700);
    r = await region(page, src);
    const clip = { x: r.x, y: r.y - r.scroll, width: r.width, height: Math.min(r.bottom - r.y, 1500) };
    const shots = [];
    if (src.frames) {
      const file = await context.request.get(r.image.url);
      const bytes = (await file.body()).toString('base64');
      const type = file.headers()['content-type'];
      const count = await page.evaluate(async ({ index, bytes, type }) => {
        const img = [...document.querySelector('article').querySelectorAll('img[src*="migrated-image"]')][index];
        const decoder = new ImageDecoder({ data: Uint8Array.from(atob(bytes), c => c.charCodeAt(0)), type });
        await decoder.tracks.ready;
        const box = img.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(box.width * devicePixelRatio);
        canvas.height = Math.round(box.height * devicePixelRatio);
        Object.assign(canvas.style, { position: 'absolute', left: (box.left + scrollX) + 'px', top: (box.top + scrollY) + 'px', width: box.width + 'px', height: box.height + 'px', zIndex: 2147483645 });
        document.body.appendChild(canvas);
        window.__frame = async k => { const { image } = await decoder.decode({ frameIndex: k }); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close(); };
        return decoder.tracks.selectedTrack.frameCount;
      }, { index: src.image, bytes, type });
      if (count !== src.frames.length) throw Error(src.slug + ': expected ' + src.frames.length + ' frames, the image has ' + count);
      for (let k = 0; k < count; k++) {
        await page.evaluate(k => window.__frame(k), k);
        shots.push({ bytes: await page.screenshot({ clip }) });
      }
    } else shots.push({ bytes: await page.screenshot({ clip }) });
    const ld = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch { return null; } }).find(x => x && x['@type'] === 'Article') || null);
    return { r, clip, shots, published: ld && (ld.dateModified || ld.datePublished) || null };
  } finally { await context.close(); }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f));
  const browser = await chromium.launch({ headless: true });
  const version = browser.version();
  const entries = [];
  try {
    for (const src of SOURCES) {
      const targets = src.frames || [src];
      let scale = src.scale || 1, shot, outputs;
      for (;;) {
        shot = await capture(browser, src, scale);
        outputs = [];
        for (const [k, target] of targets.entries()) {
          if (target.skip) continue;
          outputs.push({ target, k, bytes: await redact(browser, shot.shots[k].bytes, shot.r, target.redact, src.image, scale) });
        }
        if (outputs.every(o => o.bytes.length <= LIMIT) || scale <= 0.5) break;
        scale = Math.round((scale - 0.25) * 100) / 100;
      }
      const captured = new Date().toISOString();
      for (const { target, k, bytes } of outputs) {
        fs.writeFileSync(path.join(OUT, target.file), bytes);
        entries.push({
          file: target.file, workflow: target.workflow, source_url: article(src.slug), article_title: shot.r.title,
          captured_at: captured, publication_date: shot.published, publication_date_note: shot.published ? null : 'The page shows no publication or update date.',
          region: src.image === undefined ? 'Article text' : 'Embedded image ' + (src.image + 1) + ' of the article (' + shot.r.image.src.split('/').pop() + ', ' + shot.r.image.natural + ')' + (src.frames ? ', an animated walkthrough: frame ' + (k + 1) + ' of ' + targets.length + ', decoded from the published file and drawn in place of the moving image' : '') + ', with the text above it',
          shows: target.shows, text_alternative: src.alternative || null, note: target.note || null, redactions: (target.redact || []).map(x => x.what), left_visible: target.visible || null,
          width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), scale, bytes: bytes.length, sha256: sha(bytes)
        });
        console.log(target.file + ' ' + bytes.length + ' bytes, scale ' + scale);
      }
    }
  } finally { await browser.close(); }
  entries.sort((a, b) => a.file.localeCompare(b.file));
  const manifest = {
    schema: 'plateway.reference-screenshots.v1', reference_product: 'DoorDash', source: 'DoorDash Help Center, public consumer articles (help.doordash.com), opened without signing in',
    browser: 'chromium ' + version, viewport: '1280x1700', locale: 'en-US', command: 'node apps/plateway/evidence/tools/reference.cjs',
    note: 'Screenshots of public help pages, kept as review evidence only. The App copies no branding, text or images from them. Personal details and free-text customer content in the published images (courier and review-author names, a profile name, delivery street addresses, delivery destination pins, customer delivery instructions and review texts written by customers) are covered by grey boxes; each entry lists what was covered and the business examples left visible (restaurant and store names, their map pins and public map labels). Width and height are read from the saved PNG. An entry with text_alternative is article text standing in for a screen no public page shows; it is a proposed alternative awaiting reviewer agreement.',
    references: entries
  };
  fs.writeFileSync(path.join(OUT, 'references.json'), JSON.stringify(manifest, null, 2) + '\n');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
