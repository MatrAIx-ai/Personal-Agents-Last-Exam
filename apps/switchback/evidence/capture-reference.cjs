#!/usr/bin/env node
'use strict';
// Captures the reference-product screenshots for the evidence index: public
// Recreation.gov pages (campground and campsite pages, the rules page, public
// Help Center articles). No login, no account, no cart, no form submission,
// no bot-check bypass: default headless Chromium, one page at a time. A page
// that refuses automated access is recorded as blocked, not retried.
//
//   node apps/switchback/evidence/capture-reference.cjs [--only ID]    (from a full checkout)
//
// Writes evidence/reference/<id>.png and evidence/reference/sources.json. The
// images belong to their owners (see evidence/reference/NOTICE.md); they are
// review comparison evidence only and are not runtime assets. Live pages
// change, so a later run can differ; sources.json records what was captured when.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const {chromium} = require(path.join(root, 'node_modules/playwright'));
const dir = path.join(__dirname, 'reference');
const KB = id => `https://help.recreation.gov/helpcenter?id=kb_article&sysparm_article=${id}`;

// id, workflow, url, text to scroll to the top of the view (optional; [text, 'first'|'last']), what it shows
const TARGETS = [
  ['r01-search-results', 'Search and availability', 'https://www.recreation.gov/search?q=Upper%20Pines', null, 'Search results for a place: campground cards with location and a link to each campground.'],
  ['r02-campground-sites', 'Search and availability', 'https://www.recreation.gov/camping/campgrounds/232447', 'Campsite List', 'A campground page: name, park, booking-window note and the Campsite List tab where dates and filters are chosen.'],
  ['r03-campsite-detail', 'Search and availability', 'https://www.recreation.gov/camping/campsites/75', ['Max Num of People', 'first'], 'A campsite page: site attributes (vehicle length, driveway, electricity, accessibility, people, pets) next to its availability.'],
  ['r04-help-availability-matrix', 'Search and availability', KB('KB0010928'), null, 'Help article: how to read the campsite availability matrix (the letter codes per night).'],
  ['r05-help-not-yet-released', 'Search and availability', KB('KB0011278'), null, 'Help article: what "Not Yet Released" means for nights beyond the booking window.'],
  ['r06-help-book-camping', 'Cart hold, preview and confirm', KB('KB0010097'), 'How-To Steps', 'Help article: the booking steps from the Campsite List through the cart and order details.'],
  ['r06b-help-order-details', 'Cart hold, preview and confirm', KB('KB0010097'), ['Order Details', 'last'], 'The same article at the order details step: occupant, equipment and party are entered before payment.'],
  ['r07-help-cart-timer', 'Cart hold, preview and confirm', KB('KB0011259'), null, 'Help article: the cart holds a reservation for 15 minutes after the first item is added.'],
  ['r08-help-equipment', 'Cart hold, preview and confirm', KB('KB0011581'), null, 'Help article: which equipment to select when booking; the site must accommodate it.'],
  ['r09-help-modify', 'Modify with change fee', KB('KB0011115'), ['Modification Fees', 'last'], 'Help article: modifying a camping reservation, within the same campground, and its modification fees.'],
  ['r10-rules-change-fee', 'Modify with change fee', 'https://www.recreation.gov/rules-reservation-policies', 'Change Fee', 'Rules and Reservation Policies page: the change fee section.'],
  ['r11-help-cancel', 'Cancel with refund', KB('KB0010103'), 'How-To Steps', 'Help article: cancelling a camping reservation from the account; not possible once the stay has started.'],
  ['r12-help-cancellation-policy', 'Cancel with refund', KB('KB0010874'), null, 'Help article: the camping cancellation policy (fees by how close to arrival).'],
  ['r13-help-refund-timing', 'Cancel with refund', KB('KB0010936'), null, 'Help article: how and when refunds reach the original payment method.'],
  ['r14-help-arriving-late', 'Late arrival and no-show', KB('KB0011303'), null, 'Help article: what to do when arriving late, and the no-show rule.'],
  ['r15-campground-closed-alert', 'Alerts and closure notice', 'https://www.recreation.gov/camping/campgrounds/232450', 'This campground is closed', 'A campground page showing a closure notice in its alerts.'],
  ['r16-help-conditions', 'Alerts and closure notice', KB('KB0011304'), null, 'Help article: checking campground conditions and alerts before a trip.'],
  ['r17-help-refund-policies', 'Alerts and closure notice', KB('KB0010920'), null, 'Help article: refund policies, including cancellations made by the facility.'],
  ['r18-help-digital-wallet', 'Wallet and default card', KB('KB0012186'), null, 'Help article: adding, using and managing saved payment methods in the Digital Wallet.'],
  ['r18b-help-wallet-default', 'Wallet and default card', KB('KB0012186'), ['default', 'first'], 'The same article where it describes the default payment method.'],
  ['r19-help-viewing-reservations', 'Reservations list and detail', KB('KB0010127'), null, 'Help article: the Upcoming and Past reservation lists in the account.'],
];

function compress(files) {
  // Optional: palette-quantize the PNGs (Pillow) to keep the evidence small.
  try {
    execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nfor f in sys.argv[1:]:\n  Image.open(f).convert("RGB").quantize(colors=160,method=Image.Quantize.MEDIANCUT).save(f,optimize=True)', ...files], {stdio: 'pipe'});
    return 'Pillow palette quantization, 160 colours';
  } catch { return 'none (python3 with Pillow not available)'; }
}

(async () => {
  fs.mkdirSync(dir, {recursive: true});
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const previous = only && fs.existsSync(path.join(dir, 'sources.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8')).sources : [];
  const sources = [], files = [];
  for (const [id, workflow, url, scrollTo, shows] of TARGETS) {
    if (only && id !== only) { const kept = previous.find(x => x.id === id); if (kept) sources.push(kept); continue; }
    const entry = {id, workflow, url, shows, file: null, captured_at: new Date().toISOString(), viewport: '1280x800'};
    try {
      const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 45000});
      await page.waitForTimeout(7000);
      entry.http_status = response?.status() ?? null;
      entry.final_url = page.url();
      entry.title = await page.title();
      const text = await page.locator('body').innerText();
      if (/access denied|captcha|are you a robot|unusual traffic/i.test(text) || (entry.http_status && entry.http_status >= 400)) {
        entry.blocked = `refused automated access (HTTP ${entry.http_status})`;
      } else {
        if (scrollTo) {
          const [words, which] = Array.isArray(scrollTo) ? scrollTo : [scrollTo, 'first'];
          const matches = page.getByText(words, {exact: false}), target = which === 'last' ? matches.last() : matches.first();
          if (await target.count()) { await target.evaluate(e => e.scrollIntoView({block: 'start'})); await page.evaluate(() => window.scrollBy(0, -90)); await page.waitForTimeout(800); entry.scrolled_to = `${which} "${words}"`; }
          else entry.scrolled_to = `not found on the page: ${words}`;
        }
        entry.file = `reference/${id}.png`;
        await page.screenshot({path: path.join(dir, id + '.png')});
        files.push(path.join(dir, id + '.png'));
      }
    } catch (e) { entry.blocked = 'could not load: ' + e.message.split('\n')[0]; }
    sources.push(entry);
    console.log(id, entry.blocked || entry.title);
  }
  const compression = compress(files);
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({captured_by: 'evidence/capture-reference.cjs', browser: `Chromium ${browser.version()} (Playwright, headless, default user agent)`,
    compression, note: 'Public pages only; no login, account, cart or form submission. Images belong to their owners; see NOTICE.md.', sources}, null, 2) + '\n');
  await browser.close();
})();
