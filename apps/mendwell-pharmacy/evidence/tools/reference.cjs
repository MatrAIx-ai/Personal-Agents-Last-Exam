'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { options, today } = require('./options.cjs');

const OUT = path.resolve(__dirname, '..', 'reference');
const LIMIT = 400 * 1024;
const MAX_HEIGHT = 1500;
const CUTOFF = '20261117235959';
const LABEL = 'archived copy of the public page, cvs.com refuses requests from outside the United States; reviewer agreement pending';
const REFUSAL = 'CVS.com® is not available to customers or patients who are located outside of the United States or U.S. territories.';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const help = slug => 'https://www.cvs.com/retail/help/' + slug;
const archive = (stamp, url) => 'https://web.archive.org/web/' + stamp + '/' + url;
const stampDate = s => s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + 'T' + s.slice(8, 10) + ':' + s.slice(10, 12) + ':' + s.slice(12, 14) + 'Z';

const W = {
  household: 'Household access and grants',
  rx: 'Prescriptions and renewals',
  refill: 'Refill requests',
  claims: 'Fills, insurance claims and plan requests',
  holds: 'Holds and store changes',
  prepay: 'Prepay',
  pickup: 'Pickup by someone else and cancellation',
  account: 'Account and stores'
};

const PAGES = {
  family: { url: help('help-subtopic-family-prescription-management'), title: 'Family Prescription Management', snapshot: '20260910024542', refused: ['2026-11-27T21:02:22.621Z', '2026-11-27T21:34:06.528Z'] },
  caregiver: { url: 'https://www.cvs.com/content/familymanagement', title: 'Caregiver Tools & Services', snapshot: '20251113211356', refused: ['2026-11-27T21:02:24.293Z', '2026-11-27T21:34:08.255Z'] },
  management: { url: help('help-subtopic-prescription-management'), title: 'Prescription Management', snapshot: '20260509231536', refused: ['2026-11-27T21:02:25.980Z', '2026-11-27T21:34:09.960Z'] },
  orderingFaq: { url: help('help-subtopic-ordering-your-prescriptions-faqs'), title: 'Ordering Your Prescriptions FAQs', snapshot: '20250806121818', refused: ['2026-11-27T21:02:27.689Z', '2026-11-27T21:34:11.672Z'] },
  refill: { url: 'https://www.cvs.com/content/refill', title: 'Prescription Refill', snapshot: '20261005064129', refused: ['2026-11-27T21:02:29.360Z', '2026-11-27T21:34:13.384Z'] },
  ordering: { url: help('help-subtopic-ordering-prescriptions-on-cvs'), title: 'Ordering Prescriptions on CVS.com', snapshot: '20251112224711', refused: ['2026-11-27T21:02:31.067Z', '2026-11-27T21:34:15.100Z'] },
  prices: { url: help('help-subtopic-prices-insurance-and-payments'), title: 'Prices, Insurance and Payments', snapshot: '20260223191631', refused: ['2026-11-27T21:02:32.802Z', '2026-11-27T21:34:16.815Z'] },
  transfer: { url: help('help-subtopic-transferring-prescriptions'), title: 'Transferring Prescriptions', snapshot: '20250929222723', refused: ['2026-11-27T21:02:34.476Z', '2026-11-27T21:34:18.535Z'] },
  caregiverPickup: { url: 'https://www.cvs.com/learn/wellness/caregiver-support/caregivers-pharmacy', title: 'Caregivers relationship with the pharmacy', snapshot: null, refused: ['2026-11-27T21:02:36.168Z', '2026-11-27T21:34:20.303Z'] },
  account: { url: help('help-subtopic-create-an-account'), title: 'Create an Account', snapshot: '20260423033547', refused: ['2026-11-27T21:02:37.862Z', '2026-11-27T21:34:21.972Z'] },
  faq: { url: help('help_faq'), title: 'FAQ', snapshot: '20261002011257', refused: ['2026-11-27T21:02:39.657Z', '2026-11-27T21:34:23.661Z'] }
};

const SOURCES = [
  { file: '01-household-family-management.png', page: 'family', workflow: W.household, from: 'Family Prescription Management', until: 'add prescription management and authorize your access', shows: 'Help text: linking a minor\'s prescription records (the child\'s date of birth and details from one prescription label; not possible without a fill in the past year), and becoming an adult\'s Rx Caregiver through a request the adult answers and authorizes from their own account.' },
  { file: '02-household-add-family-member.png', page: 'management', workflow: W.household, from: 'Completing the verification process', until: 'click the Add an Adult button, and follow the steps', shows: 'Help text: the one-time two-step identity verification, then adding a child (Add a Minor) or an adult (Add an Adult, who must authorize the caregiver) from the Family Prescription Accounts tab.' },
  { file: '03-household-caregiver-tools.png', page: 'caregiver', workflow: W.household, also: [W.pickup], from: 'Mom. Daughter. Caregiver.', until: 'get started online now', shows: 'Caregiver page: caregivers take care of prescriptions for other people online, in the app and at the pharmacy, and view pharmacy health records for children; sign up with a pharmacy team member or online.' },
  { file: '04-rx-prescription-management.png', page: 'management', workflow: W.rx, from: 'Adding prescription management', until: 'complete a one-time, two-step verification process', shows: 'Help text: prescription management adds reminders, a calendar of upcoming refills and prescription expirations, the current prescription list and a printable history, for the account holder and family, after a one-time two-step verification.' },
  { file: '05-refill-faq-renewal.png', page: 'refill', workflow: W.refill, also: [W.rx], expand: ['How do I refill a prescription?', 'What if I have zero refills left on a prescription enrolled in ReadyFill'], from: 'Prescription Refill FAQs', until: 'unenroll online', shows: 'The refill questions with two answers opened: refill by checking off prescriptions under All Prescriptions or at the pharmacy; with zero refills left, the pharmacy requests a renewal from the prescriber before the next automatic refill date.' },
  { file: '06-refill-ordering-online.png', page: 'ordering', workflow: W.refill, also: [W.claims], from: 'Ordering Prescriptions on CVS.com', until: 'transferred out', shows: 'Help text: order refills online for pickup at any store; a new prescription comes from the prescriber; only prescriptions that can be refilled or renewed can be submitted, and when it is too soon to refill the checkbox stays greyed out until it is time to fill.' },
  { file: '07-claims-insurance-payments.png', page: 'prices', workflow: W.claims, also: [W.prepay], from: 'We accept most prescription insurance', until: 'prices on prescriptions being picked up in store', shows: 'Help text: the pharmacy bills the prescription insurance when it fills and charges the copay or deductible; if the plan does not cover the drug the pharmacy contacts the customer about alternatives; pickup orders are paid at the pharmacy when picked up; cash prices are not posted online.' },
  { file: '08-stores-change-store.png', page: 'transfer', workflow: W.holds, from: 'Transferring is as easy as 1, 2, 3', until: 'Rapid Refill and choose to pick up your refill at your new CVS', shows: 'Help text: transferring a prescription to a chosen store, and moving a refill from one store to another by choosing the new store when refilling.' },
  { file: '09-pickup-cancel-faq.png', page: 'orderingFaq', workflow: W.pickup, from: 'Ordering Your Prescriptions FAQs', until: 'requested the prescription be available for pickup', shows: 'Questions and answers: a new prescription must reach the store first; transferring from another pharmacy; changes to a refill already submitted for in-store pickup are made by phone with that store.' },
  { file: '10-account-create.png', page: 'account', workflow: W.account, from: 'Create an Account', until: 'your account and prescription information', shows: 'Help text: guest use, creating an account, adding prescription management and becoming an Rx Caregiver, and identity questions before prescription information is shown.' },
  { file: '11-account-store-finder.png', page: 'faq', workflow: W.account, from: 'Other FAQs', until: 'for information about a CVS/pharmacy store near you', shows: 'Question and answer: store locations and hours are found with the store finder by city, state, ZIP code, cross streets or store number.' }
];

const WORKFLOWS = [
  { workflow: W.household, gap: 'Help and caregiver pages only; the screens for linking a child or authorizing an adult caregiver are behind sign-in.' },
  { workflow: W.rx, gap: 'Help text only; the prescription list and a renewal request are behind sign-in.' },
  { workflow: W.refill, gap: 'Help text and questions only; the refill screens are behind sign-in.' },
  { workflow: W.claims, gap: 'No archived page in the set describes an early refill or a prior authorization request to the plan; the closest are the insurance billing text and the too-soon refill rule.' },
  { workflow: W.holds, gap: 'No archived page in the set describes a pharmacist\'s hold on a fill; only changing the pickup store is covered.' },
  { workflow: W.prepay, gap: 'No archived page in the set describes paying ahead for a pickup order; the page says pickup orders are paid at the pharmacy when picked up.' },
  { workflow: W.pickup, gap: 'The page on caregivers picking up prescriptions (caregivers-pharmacy) has no usable snapshot: the archive holds only a capture on which cvs.com answered HTTP 403. Cancelling is covered only as changes made by phone with the store.' },
  { workflow: W.account, gap: 'Help text and questions only; the account pages are behind sign-in and store pages are not used.' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdx(url, onlyOk) {
  const q = 'https://web.archive.org/cdx/search/cdx?url=' + encodeURIComponent(url) + '&to=' + CUTOFF + '&output=json&fl=timestamp,statuscode' + (onlyOk ? '&filter=statuscode:200&filter=mimetype:text/html' : '') + '&limit=-1';
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(q);
      if (r.ok) { const rows = await r.json(); return rows.length > 1 ? { timestamp: rows[1][0], status: rows[1][1] } : null; }
      if (k >= 6) throw Error('archive index answered HTTP ' + r.status);
    } catch (e) { if (k >= 6) throw e; }
    await sleep(5000 * (k + 1));
  }
}

async function hideFloating(page) {
  await page.evaluate(() => {
    for (const id of ['wm-ipp-base', 'wm-ipp', 'wm-ipp-print', 'donato']) { const e = document.getElementById(id); if (e) e.style.setProperty('display', 'none', 'important'); }
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if ((s.position === 'fixed' || s.position === 'sticky') && s.display !== 'none') e.style.setProperty('display', 'none', 'important');
    }
  });
}

async function reveal(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return 0;
    let n = 0;
    for (const e of [main, ...main.querySelectorAll('*')]) if (getComputedStyle(e).opacity === '0') { e.style.setProperty('opacity', '1', 'important'); n++; }
    return n;
  });
}

async function region(page, src) {
  return page.evaluate(src => {
    const visible = e => e.getClientRects().length > 0 && !e.closest('#wm-ipp-base,#wm-ipp,#donato');
    const deepest = text => {
      for (const e of document.body.querySelectorAll('*')) if (visible(e) && e.textContent.includes(text) && ![...e.children].some(c => visible(c) && c.textContent.includes(text))) return e;
      return null;
    };
    const heading = text => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(e => visible(e) && e.textContent.includes(text)) || null;
    const from = heading(src.from) || deepest(src.from), until = deepest(src.until);
    if (!from || !until) return { error: 'text anchor not found: ' + (from ? src.until : src.from) };
    let anc = from;
    while (anc && !anc.contains(until)) anc = anc.parentElement;
    const text = (e, t) => {
      const g = document.createRange();
      const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      let found = false;
      for (let n = walk.nextNode(); n && !found; n = walk.nextNode()) { const i = n.data.indexOf(t); if (i >= 0) { g.setStart(n, i); g.setEnd(n, i + t.length); found = true; } }
      if (!found) g.selectNodeContents(e);
      const r = g.getBoundingClientRect();
      return { top: r.top + scrollY, bottom: r.bottom + scrollY };
    };
    const b = anc.getBoundingClientRect();
    const f = text(from, src.from), u = text(until, src.until);
    const lines = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const p = n.parentElement;
      if (!n.data.trim() || !p || !visible(p) || p.closest('script,style')) continue;
      const g = document.createRange();
      g.selectNodeContents(n);
      for (const c of g.getClientRects()) if (c.width > 0 && c.height > 0) lines.push({ top: c.top + scrollY, bottom: c.bottom + scrollY });
    }
    for (const i of document.images) if (visible(i)) { const c = i.getBoundingClientRect(); if (c.width > 0 && c.height > 0) lines.push({ top: c.top + scrollY, bottom: c.bottom + scrollY }); }
    const next = Math.min(Infinity, ...lines.filter(c => c.top >= u.bottom - 0.5).map(c => c.top));
    const prev = Math.max(-Infinity, ...lines.filter(c => c.bottom <= f.top + 0.5).map(c => c.bottom));
    const x = Math.max(0, Math.floor(b.left + scrollX - 12));
    const h1 = [...document.querySelectorAll('h1')].find(visible);
    return { title: (h1 && h1.innerText.trim()) || document.title.trim(), scroll: scrollY, x, y: Math.floor(Math.max(f.top - 12, prev + 1)), width: Math.min(Math.ceil(b.width + 24), 1280 - x), bottom: Math.ceil(Math.min(u.bottom + 12, next - 1)) };
  }, src);
}

async function maskSensitive(page, r) {
  return page.evaluate(r => {
    const kinds = [
      { what: 'phone number', re: /(?:\b1[-\s]?)?\(?\b\d{3}\)?[-.\s]?[0-9A-Z]{3}[-.\s][0-9A-Z]{4}\b/g, keep: m => (m.match(/\d/g) || []).length >= 7 },
      { what: 'email address', re: /[\w.+-]+@[\w-]+\.[\w.]+/g, keep: () => true }
    ];
    const found = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.parentElement || n.parentElement.closest('#wm-ipp-base,#wm-ipp,#donato,script,style')) continue;
      for (const k of kinds) {
        k.re.lastIndex = 0;
        for (let m = k.re.exec(n.data); m; m = k.re.exec(n.data)) {
          if (!k.keep(m[0])) continue;
          const g = document.createRange();
          g.setStart(n, m.index);
          g.setEnd(n, m.index + m[0].length);
          for (const c of g.getClientRects()) {
            const top = c.top + scrollY, left = c.left + scrollX;
            if (top + c.height <= r.y || top >= r.bottom || left + c.width <= r.x || left >= r.x + r.width) continue;
            const d = document.createElement('div');
            Object.assign(d.style, { position: 'absolute', left: (left - 2) + 'px', top: (top - 2) + 'px', width: (c.width + 4) + 'px', height: (c.height + 4) + 'px', background: '#9aa0a6', zIndex: 2147483647 });
            document.body.appendChild(d);
            found.push(k.what);
          }
        }
      }
    }
    return found;
  }, r);
}

async function capture(browser, src, page, scale) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1700 }, deviceScaleFactor: scale, locale: 'en-US', timezoneId: 'America/New_York' });
  const blocked = [];
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    if (/(^|\.)archive\.org$/.test(host)) return route.continue();
    blocked.push(host);
    return route.abort();
  });
  try {
    const tab = await context.newPage();
    const url = archive(page.snapshot, page.url);
    let response = null;
    for (let k = 0; ; k++) {
      try { response = await tab.goto(url, { waitUntil: 'load', timeout: 120000 }); break; }
      catch (e) { if (k >= 4) throw e; await sleep(10000 * (k + 1)); }
    }
    const status = response ? response.status() : null;
    if (status !== 200) throw Error(src.file + ': archive answered HTTP ' + status);
    if (!tab.url().includes('/web/' + page.snapshot + '/')) throw Error(src.file + ': archive redirected to ' + tab.url());
    await tab.waitForTimeout(2500);
    for (let y = 0; y < 15000; y += 600) { await tab.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), y); await tab.waitForTimeout(100); }
    await hideFloating(tab);
    const revealed = await reveal(tab);
    for (const q of src.expand || []) { await tab.getByText(q).first().click(); await tab.waitForTimeout(1000); }
    await hideFloating(tab);
    let r = await region(tab, src);
    if (r.error) throw Error(src.file + ': ' + r.error);
    if (r.bottom - r.y > MAX_HEIGHT) throw Error(src.file + ': region is ' + (r.bottom - r.y) + ' px tall');
    await tab.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, r.y - 100));
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForFunction(() => [...document.images].filter(i => i.getClientRects().length).every(i => i.complete), null, { timeout: 30000 });
    for (let k = 0, last = ''; ; k++) {
      await tab.waitForTimeout(400);
      await hideFloating(tab);
      r = await region(tab, src);
      const now = JSON.stringify([r.x, r.y, r.width, r.bottom, r.scroll]);
      if (now === last) break;
      if (k >= 20) throw Error(src.file + ': the page layout did not settle');
      last = now;
    }
    const masked = await maskSensitive(tab, r);
    const bytes = await tab.screenshot({ clip: { x: r.x, y: r.y - r.scroll, width: r.width, height: r.bottom - r.y } });
    return { bytes, title: r.title, revealed, masked, blocked: blocked.length, archiveUrl: url };
  } finally { await context.close(); }
}

const refusal = p => ({ http_status: 403, message: REFUSAL, checked_at: p.refused });
const PRESENTATION = 'The archived page keeps its main content at opacity 0 because the script that fades it in does not run in the archive; the capture sets the opacity to 1. Question lists on such pages then show every answer as plain text, as in the archived HTML.';

const rendering = presentation => presentation ? 'content revealed by the capture (opacity set to 1)' : 'the page as it renders';

function decide(src, shot, scale, before, opts) {
  const width = shot.bytes.readUInt32BE(16), height = shot.bytes.readUInt32BE(20), presentation = shot.revealed ? PRESENTATION : null;
  if (before && !opts.update) {
    const changed = [];
    if (rendering(before.presentation) !== rendering(presentation)) changed.push('rendering mode "' + rendering(before.presentation) + '" became "' + rendering(presentation) + '"');
    if (before.width !== width || before.height !== height || before.scale !== scale) changed.push('size ' + before.width + ' x ' + before.height + ' at scale ' + before.scale + ' became ' + width + ' x ' + height + ' at scale ' + scale);
    if (changed.length) throw Error(src.file + ': ' + changed.join('; ') + '. The committed file and manifest are kept; check the archived page, then rerun with --update to replace them.');
  }
  const same = !!before && before.sha256 === sha(shot.bytes);
  return { width, height, presentation, same, captured_on: same ? before.captured_on : opts.date };
}

async function run({ argv = [], out = OUT, cdxIndex = cdx, captureShot = capture, launch = null, log = console.log } = {}) {
  const opts = options(argv, ['--update']);
  opts.date = opts.date || today();
  const manifestFile = path.join(out, 'references.json');
  const committed = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).references || [] : [];
  const index = {};
  for (const [key, page] of Object.entries(PAGES)) {
    const ok = await cdxIndex(page.url, true);
    const any = ok ? null : await cdxIndex(page.url, false);
    if ((ok && ok.timestamp) !== (page.snapshot || null)) throw Error(page.url + ': the archive index now gives ' + (ok ? ok.timestamp : 'no snapshot') + ' as the latest usable snapshot before the cutoff, the tool pins ' + page.snapshot);
    index[key] = { latest_any: any && any.timestamp, latest_any_status: any && any.status };
  }
  const browser = await (launch || (() => require('playwright').chromium.launch({ headless: true, args: ['--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'] })))();
  const version = browser.version();
  const entries = [], files = [];
  try {
    for (const src of SOURCES) {
      const page = PAGES[src.page];
      let scale = 1, shot;
      for (;;) {
        shot = await captureShot(browser, src, page, scale);
        if (shot.bytes.length <= LIMIT || scale <= 0.75) break;
        scale = Math.round((scale - 0.25) * 100) / 100;
      }
      if (shot.bytes.length > LIMIT) throw Error(src.file + ': ' + shot.bytes.length + ' bytes');
      if (shot.blocked) throw Error(src.file + ': the archived page tried ' + shot.blocked + ' request(s) outside the archive');
      const d = decide(src, shot, scale, committed.find(e => e.file === src.file), opts);
      files.push([src.file, shot.bytes]);
      entries.push({
        file: src.file, workflow: src.workflow, also_for: src.also || [], label: LABEL,
        original_url: page.url, original_refusal: refusal(page),
        archive_url: shot.archiveUrl, archive_timestamp: page.snapshot, archive_date: stampDate(page.snapshot),
        captured_on: d.captured_on, page_title: shot.title,
        region: 'Archived page text from "' + src.from + '" to "' + src.until + '"' + (src.expand ? ', with the questions ' + src.expand.map(q => '"' + q + '"').join(' and ') + ' opened' : ''),
        shows: src.shows,
        presentation: d.presentation,
        redactions: shot.masked, left_visible: null,
        width: d.width, height: d.height, scale, bytes: shot.bytes.length, sha256: sha(shot.bytes)
      });
      log(src.file + ' ' + shot.bytes.length + ' bytes, scale ' + scale + ', masked ' + shot.masked.length + ', revealed ' + shot.revealed + (d.same ? ', unchanged' : ', new capture dated ' + d.captured_on));
    }
  } finally { await browser.close(); }
  const pages = Object.entries(PAGES).map(([key, p]) => ({
    original_url: p.url, page_title: p.title, original_refusal: refusal(p),
    archive_timestamp: p.snapshot, archive_url: p.snapshot ? archive(p.snapshot, p.url) : null, archive_date: p.snapshot ? stampDate(p.snapshot) : null,
    files: SOURCES.filter(s => s.page === key).map(s => s.file),
    no_snapshot: p.snapshot ? null : 'No usable snapshot before 2026-11-18: the archive index lists ' + (index[key].latest_any ? 'only a capture of ' + stampDate(index[key].latest_any) + ' on which cvs.com answered HTTP ' + index[key].latest_any_status : 'no capture') + '.'
  }));
  const manifest = {
    schema: 'mendwell.reference-screenshots.v1',
    reference_product: 'CVS Pharmacy',
    source: 'Internet Archive (web.archive.org) snapshots of public CVS Pharmacy help, FAQ and caregiver pages; no store, account or sign-in pages',
    label: LABEL,
    snapshot_choice: 'For each page, the most recent snapshot before 2026-11-18 that the archive index lists with HTTP 200 and an HTML page; the tool checks this against the index before capturing and stops if a later one has appeared.',
    browser: 'chromium ' + version, viewport: '1280x1700', locale: 'en-US',
    command: 'node apps/mendwell-pharmacy/evidence/tools/reference.cjs',
    note: 'cvs.com refused every page of the set on 2026-11-27, in two checks at 21:02 and 21:34 UTC (HTTP 403, "' + REFUSAL + '"). Each screenshot is therefore taken from the Internet Archive\'s copy of the same public page. This tool does not contact cvs.com: it blocks every request outside archive.org, and the capture stops if a page tries one (none did). The archive\'s toolbar and the archived pages\' floating cookie notices are hidden before capture. On help pages whose fade-in script does not run in the archive, the main content is set back to full opacity, as each entry states. Phone numbers and email addresses in a captured region are covered by grey boxes and listed per entry; the captured regions show no names, addresses, prescription, member or card numbers, dates of birth or free text. Width and height are read from the saved PNG. The App copies no branding, text or images from these pages.',
    workflows: WORKFLOWS.map(w => ({ workflow: w.workflow, status: LABEL, files: entries.filter(e => e.workflow === w.workflow || e.also_for.includes(w.workflow)).map(e => e.file), gap: w.gap })),
    pages,
    references: entries
  };
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.endsWith('.png') && !SOURCES.some(src => src.file === f)) fs.rmSync(path.join(out, f));
  for (const [file, bytes] of files) fs.writeFileSync(path.join(out, file), bytes);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

module.exports = { run, SOURCES, PAGES };

if (require.main === module) run({ argv: process.argv.slice(2) }).catch(e => { console.error(e.message || e); process.exitCode = 1; });
