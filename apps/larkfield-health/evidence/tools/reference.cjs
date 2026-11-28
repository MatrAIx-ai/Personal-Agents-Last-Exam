'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '..', 'reference');
const LIMIT = 400 * 1024;
const MAX_HEIGHT = 1500;
const PDFJS_VERSION = '3.11.174';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/';
const PDFJS_FILES = {
  'pdf.min.js': '5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946',
  'pdf.worker.min.js': 'feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b'
};
const ARTICLE = 'public consumer article from the reference product, not a product page; reviewer agreement pending';
const PENDING = 'Alternative proposed, reviewer agreement pending';
const SAMPLE = 'Screenshots of the publisher\'s sample statement';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const UHC = 'https://www.uhc.com/';
const EOB_ARTICLE = UHC + 'understanding-health-insurance/how-does-health-insurance-work/explanation-of-benefits';
const EOB_FLIER = UHC + 'content/dam/uhcdotcom/en/general/understanding-your-eob-flier.pdf';
const FORMS = UHC + 'member-resources/forms';
const CLAIM_FORM = 'https://member.uhc.com/myuhc/content/dam/myuhc/pdfs/claim-forms/CMS1500ClaimForm010402.pdf';
const PA_ARTICLE = UHC + 'understanding-health-insurance/how-does-health-insurance-work/what-is-prior-authorization';
const DENIALS = UHC + 'news-articles/newsroom/claims-denials';
const LETTERS = UHC + 'news-articles/newsroom/claims-letters';
const OOP = UHC + 'understanding-health-insurance/understanding-health-insurance-costs/types-of-health-insurance-costs/out-of-pocket-limits';

const W = {
  household: 'Household and grants',
  claims: 'Claims with lines',
  requests: 'Information requests and EOB versions',
  attest: 'Attestations (other coverage, accident)',
  pa: 'Prior authorizations with expedite',
  appeals: 'Appeals with statement and withdraw',
  plan: 'Plan accumulators'
};

const WORKFLOWS = [
  { workflow: W.household, status: PENDING, gap: 'The member portal screen for giving a family member or representative access is behind sign-in. The closest public reference is the start page of the plan\'s form for releasing health information and filing a power of attorney (01).' },
  { workflow: W.claims, status: SAMPLE, gap: 'The member portal\'s claim list is behind sign-in. A claim with its lines is shown on the publisher\'s sample explanation of benefits (02), and the article on reading an EOB lists what it contains (03).' },
  { workflow: W.requests, status: 'Alternative proposed; 04 and 05 are public consumer articles from the reference product, not product pages; reviewer agreement pending', gap: 'No public page shows a plan\'s information request to a member or a revised EOB. The closest public text: why claims go to further review (04), the letters sent while a claim is reviewed (05) and what to do when an EOB looks wrong (06).' },
  { workflow: W.attest, status: PENDING, gap: 'No public page shows the plan\'s questions on other coverage or an accident as a member answers them. The plan\'s public medical claim form asks both (07), and its coordination of benefits notice says members are asked to identify every plan that covers the family (08).' },
  { workflow: W.pa, status: PENDING, gap: 'No public page shows a prior authorization\'s status in the portal or an expedite request. The closest public text: how prior authorization works and how long it takes (09), and that a provider can ask for a faster review (10).' },
  { workflow: W.appeals, status: PENDING, gap: 'No public page shows the portal\'s appeal screens, and no public page describes withdrawing an appeal. The closest public references: the start page of the plan\'s appeal request form (11), and the appeal rights printed on the sample statement: an appeal in writing within 180 days, by the member or an authorized representative such as a family member, with comments, documents or other information (12).' },
  { workflow: W.plan, status: SAMPLE, gap: 'The portal\'s plan balances screen is behind sign-in. The sample statement\'s plan balances show deductible and out-of-pocket progress (13), and the article explains individual and family limits (14).' }
];

const SOURCES = [
  { file: '01-household-authorization-form.png', workflow: W.household, url: 'https://memberforms.uhc.com/E&I-Authorization-for-Release-of-Health-Information-and-Power-of-Attorney.html', top: true, from: 'Authorization for Release of Health Information and Power of Attorney', until: 'Start new form', shows: 'Start page of the plan\'s form for members with insurance through work: a release of health information lets others access a member\'s health information; a power of attorney, guardianship or conservatorship appoints someone to manage the member\'s affairs. Nothing is filled in or submitted.', alternative: 'No public page shows the portal screen for giving access; this is the public start page of the plan\'s form for it.' },
  { file: '02-claims-sample-eob-detail.png', workflow: W.claims, pdf: EOB_FLIER, page: 2, box: [0.05, 0.315, 0.95, 0.925], linked_from: EOB_ARTICLE, shows: 'Claim detail on the sample statement: one line per service with its date and processing code, billed amount, amount saved, plan allowed amount, plan paid, and what the member owes split into deductible, copay, coinsurance and not covered, with totals and the codes explained.', redact: [
    { box: [0.2125, 0.347, 0.292, 0.366], what: 'member first name in the heading (placeholder)' },
    { box: [0.7005, 0.369, 0.762, 0.38], what: 'patient account number (placeholder)' },
    { box: [0.7005, 0.3795, 0.762, 0.3895], what: 'claim number (placeholder)' }
  ], covers: [{ text: 'Claim detail for ROBERT', part: 'ROBERT' }, { text: 'C1' }, { text: '000000000' }, { text: '0', near: 0.378 }, { text: 'EC' }, { text: '01234567' }, { text: '01', near: 0.387 }], visible: 'provider name placeholder (TEST); the plan\'s placeholder customer service number; the statement\'s form and print codes', note: 'The flier says an EOB may look different depending on the plan.' },
  { file: '03-claims-eob-contents.png', workflow: W.claims, url: EOB_ARTICLE, from: 'How do you read an EOB?', until: 'How much was paid by your health insurance plan', shows: 'Article text: what an EOB typically includes (the provider, the claim number and status, each service with its date, total cost, what the plan paid, costs not covered and what the member owes).' },
  { file: '04-requests-review-reasons.png', workflow: W.requests, label: ARTICLE, url: DENIALS, from: 'What are the most common reasons claims go through further review?', until: 'evidence and established standards', shows: 'Article text: a claim not approved right away usually has missing information or questions to resolve; the review categories (eligibility, duplicates, documentation, coverage, clinical quality).', alternative: 'No public page shows a plan\'s information request to a member; this article explains why claims go to further review.' },
  { file: '05-requests-claim-letters.png', workflow: W.requests, label: ARTICLE, url: LETTERS, from: 'What should I do if I receive a letter saying my claim has been denied?', until: 'explain the status of your claim', shows: 'Article text: letters are sent while a claim is still being reviewed; look for language asking for additional documentation; more information may be needed about the services or their timing.', alternative: 'No public page shows a plan\'s information request to a member; this article explains the letters sent during a claim review.' },
  { file: '06-requests-eob-error.png', workflow: W.requests, url: EOB_ARTICLE, from: 'What if I find an error on my EOB?', until: 'details of your calls', shows: 'Article text: what to check when an EOB and a bill do not match, then call the plan and, if needed, ask about filing an appeal.', alternative: 'No public page shows a revised EOB; this article covers an EOB that looks wrong.' },
  { file: '07-attest-claim-form-questions.png', workflow: W.attest, pdf: CLAIM_FORM, page: 2, box: [0.05, 0.535, 0.985, 0.808], linked_from: FORMS, shows: 'The plan\'s medical claim form, page 2: Accident Information (date, type of accident: work, auto or other, how it happened) and Other Insurance (is the patient covered by another plan, with that plan\'s details, and whether its EOB is attached). The form is blank.', alternative: 'No public page shows the plan\'s questions on other coverage or an accident as a member answers them; this blank claim form asks both.', note: 'The form is for claims a member files for out-of-network care; it asks these questions when the claim is filed.' },
  { file: '08-attest-other-coverage-notice.png', workflow: W.attest, url: UHC + 'legal/required-state-notices/texas/coordination-of-benefits', from: 'Texas Coordination of Benefits', until: 'The primary plan always pays first when you have a claim.', shows: 'Notice text: family members covered by more than one plan; members will be asked to identify all the plans that cover their family so the plan can decide whether it pays first or second.', alternative: 'No public page shows the plan\'s other-coverage questions as a member answers them; this notice says members are asked them.', note: 'A required notice for plans in Texas; coordination rules vary by state.' },
  { file: '09-pa-how-it-works.png', workflow: W.pa, url: PA_ARTICLE, from: 'How does prior authorization work?', until: 'how long it could take', shows: 'Article text: the doctor sends the request, plan clinicians review it, the decision rests on medical evidence; urgent requests are answered within 1 to 3 days in many states, others within 2 to 15 days.', alternative: 'No public page shows a prior authorization in the portal; this article describes the process.' },
  { file: '10-pa-expedited-faq.png', workflow: W.pa, url: PA_ARTICLE, expand: 'Can a provider request an expedited review?', from: 'Frequently asked questions about prior authorization', until: 'simpler approval process for certain procedures', shows: 'The article\'s questions, with Can a provider request an expedited review? opened: sometimes a provider can ask for a faster prior authorization review.', alternative: 'No public page shows an expedite request; this answer says a provider can ask for one.' },
  { file: '11-appeals-request-form.png', workflow: W.appeals, url: 'https://memberforms.uhc.com/Memberappealsandgrievances.html', top: true, from: 'UHC member service request form', until: 'except for Individual Family Plans', shows: 'Start page of the plan\'s appeal and grievance request form: what is needed (subscriber, patient, service, pre-service reference or processed claim number), one form per appeal, and the designation form needed when someone other than the subscriber files. Nothing is filled in or submitted.', alternative: 'No public page shows the portal\'s appeal screens; this is the public start page of the plan\'s appeal request form.' },
  { file: '12-appeals-rights-statement.png', workflow: W.appeals, pdf: EOB_FLIER, page: 3, box: [0.05, 0.075, 0.95, 0.39], linked_from: EOB_ARTICLE, shows: 'Member rights on the sample statement: request an appeal in writing within 180 days; the member or an authorized representative, such as a family member, may appeal by submitting comments, documents or other relevant information; external review.', redact: [], covers: [], visible: 'the plan\'s appeals mailing address; public phone numbers of the plan and of government agencies; the plan\'s placeholder customer service number; the statement\'s form and print codes', alternative: 'No public page shows the portal\'s appeal screens; the sample statement\'s rights section describes an appeal with comments and documents.' },
  { file: '13-accumulators-sample-eob-balances.png', workflow: W.plan, pdf: EOB_FLIER, page: 1, box: [0.05, 0.285, 0.95, 0.908], linked_from: EOB_ARTICLE, shows: 'First page of the sample statement: the claim summary (provider billed, total owed) and the plan balances for the plan year, in and out of network: deductible and out-of-pocket limit with maximum, progress so far and remaining amount.', redact: [
    { box: [0.458, 0.4135, 0.513, 0.4235], what: 'member and patient name (placeholder)' },
    { box: [0.458, 0.4235, 0.506, 0.4305], what: 'member ID (placeholder)' },
    { box: [0.458, 0.4375, 0.523, 0.4515], what: 'group name and group number (placeholder)' },
    { box: [0.147, 0.471, 0.236, 0.4985], what: 'member name and mailing address (placeholder)' },
    { box: [0.1212, 0.5645, 0.219, 0.5865], what: 'member first name in the greeting (placeholder)' },
    { box: [0.153, 0.7175, 0.208, 0.7305], what: 'member first name above the balances (placeholder)' }
  ], covers: [{ text: 'ROBERT', near: 0.422 }, { text: 'TEST', near: 0.422 }, { text: 'A', near: 0.429 }, { text: '123456789' }, { text: 'TEST CUSTOMER' }, { text: '0', near: 0.45 }, { text: '123456', near: 0.45 }, { text: 'ROBERT', near: 0.48 }, { text: 'TEST', near: 0.48 }, { text: 'Address', near: 0.488 }, { text: 'City, State, ZIP Code', near: 0.496 }, { text: 'Hi, ROBERT.', part: 'ROBERT' }, { text: 'ROBERT', near: 0.728 }], visible: 'the plan\'s placeholder sender block (legal entity, service center, address); relationship code (EE); the plan\'s placeholder customer service number; the statement\'s form and print codes', note: 'The flier says an EOB may look different depending on the plan.' },
  { file: '14-accumulators-family-limit.png', workflow: W.plan, url: OOP, expand: 'difference between an individual and family out-of-pocket limit', from: 'Frequently asked questions about out-of-pocket limits', until: 'for the rest of the plan year', shows: 'The article\'s questions, with the difference between individual and family out-of-pocket limits opened: everyone\'s costs count toward the family limit; once it is met, the plan pays 100% of everyone\'s covered costs for the rest of the plan year.' }
];

async function hideFloating(page) {
  return page.evaluate(() => {
    let n = 0;
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if ((s.position === 'fixed' || s.position === 'sticky') && s.display !== 'none') { e.style.setProperty('display', 'none', 'important'); n++; }
    }
    return n;
  });
}

async function region(page, src) {
  return page.evaluate(src => {
    const visible = e => e.getClientRects().length > 0;
    const find = text => {
      for (const e of document.body.querySelectorAll('*')) if (visible(e) && e.textContent.includes(text) && ![...e.children].some(c => visible(c) && c.textContent.includes(text))) return e;
      return null;
    };
    const from = find(src.from), until = find(src.until);
    if (!from || !until) return { error: 'text anchor not found: ' + (from ? src.until : src.from) };
    let anc = from;
    while (anc && !anc.contains(until)) anc = anc.parentElement;
    const box = e => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left + scrollX, width: r.width }; };
    const text = (e, t) => {
      const g = document.createRange();
      const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      let found = false;
      for (let n = walk.nextNode(); n && !found; n = walk.nextNode()) { const i = n.data.indexOf(t); if (i >= 0) { g.setStart(n, i); g.setEnd(n, i + t.length); found = true; } }
      if (!found) g.selectNodeContents(e);
      const r = g.getBoundingClientRect();
      return { top: r.top + scrollY, bottom: r.bottom + scrollY };
    };
    const a = box(anc), f = text(from, src.from), u = text(until, src.until);
    const h1 = document.querySelector('h1');
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch { return null; } }).find(x => x && (x.dateModified || x.datePublished)) || null;
    const x = Math.max(0, Math.floor(a.left - 12));
    return { title: (h1 && h1.innerText.trim()) || document.title.trim(), scroll: scrollY, x, y: src.top ? 0 : Math.floor(f.top - 12), width: Math.min(Math.ceil(a.width + 24), 1280 - x), bottom: Math.ceil(u.bottom + 12), published: ld && (ld.dateModified || ld.datePublished) || null };
  }, src);
}

async function capturePage(browser, src, scale) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1700 }, deviceScaleFactor: scale, locale: 'en-US', timezoneId: 'America/New_York' });
  try {
    const page = await context.newPage();
    const response = await page.goto(src.url, { waitUntil: 'load', timeout: 60000 });
    const status = response ? response.status() : null;
    if (!status || status >= 400) throw Error(src.url + ': HTTP ' + status);
    await page.waitForTimeout(1500);
    for (let y = 0; y < 15000; y += 600) { await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), y); await page.waitForTimeout(100); }
    await hideFloating(page);
    if (src.expand) { await page.getByText(src.expand).first().click(); await page.waitForTimeout(1000); }
    await hideFloating(page);
    let r = await region(page, src);
    if (r.error) throw Error(src.file + ': ' + r.error);
    if (r.bottom - r.y > MAX_HEIGHT) throw Error(src.file + ': region is ' + (r.bottom - r.y) + ' px tall');
    await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, r.y - 100));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].filter(i => i.getClientRects().length).every(i => i.complete), null, { timeout: 30000 });
    for (let k = 0, last = ''; ; k++) {
      await page.waitForTimeout(400);
      await hideFloating(page);
      r = await region(page, src);
      const now = JSON.stringify([r.x, r.y, r.width, r.bottom, r.scroll]);
      if (now === last) break;
      if (k >= 20) throw Error(src.file + ': the page layout did not settle');
      last = now;
    }
    const bytes = await page.screenshot({ clip: { x: r.x, y: r.y - r.scroll, width: r.width, height: r.bottom - r.y } });
    return { bytes, title: r.title, published: r.published, region: (src.top ? 'Page from its top' : 'Page text from "' + src.from + '"') + ' to "' + src.until + '"' + (src.expand ? ', with the question "' + src.expand + '" opened' : '') };
  } finally { await context.close(); }
}

const pdfDate = d => { const m = /^D:(\d{4})(\d{2})(\d{2})/.exec(d || ''); return m ? m[1] + '-' + m[2] + '-' + m[3] : null; };

async function loadPdfjs(browser) {
  const context = await browser.newContext();
  try {
    const out = {};
    for (const [name, pinned] of Object.entries(PDFJS_FILES)) {
      const res = await context.request.get(PDFJS + name, { timeout: 60000 });
      if (res.status() >= 400) throw Error(PDFJS + name + ': HTTP ' + res.status());
      const bytes = await res.body();
      if (sha(bytes) !== pinned) throw Error('pdf.js ' + name + ': SHA-256 ' + sha(bytes) + ' does not match the pinned ' + pinned);
      out[name] = bytes.toString('utf8');
    }
    return out;
  } finally { await context.close(); }
}

async function capturePdf(browser, src, scale, lib) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  try {
    const res = await context.request.get(src.pdf, { timeout: 60000 });
    if (res.status() >= 400) throw Error(src.pdf + ': HTTP ' + res.status());
    const data = (await res.body()).toString('base64');
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: lib['pdf.min.js'] });
    await page.waitForFunction(() => window.pdfjsLib, null, { timeout: 30000 });
    const out = await page.evaluate(async ({ data, worker, src, scale }) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
      const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(data), c => c.charCodeAt(0)) }).promise;
      const meta = await doc.getMetadata();
      const pg = await doc.getPage(src.page);
      const base = pg.getViewport({ scale: 1 });
      const items = (await pg.getTextContent()).items.filter(it => it.str.trim()).map(it => ({ str: it.str, x: it.transform[4] / base.width, y: 1 - it.transform[5] / base.height, w: it.width / base.width, h: it.height / base.height }));
      const masks = (src.redact || []).map(r => r.box);
      const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
      const problems = [];
      for (const c of src.covers || []) {
        const hits = items.filter(it => it.str === c.text && (c.near === undefined || Math.abs(it.y - c.near) < 0.006));
        if (!hits.length) { problems.push('not found: ' + c.text); continue; }
        for (const it of hits) {
          const i = c.part ? it.str.indexOf(c.part) : 0, n = c.part ? c.part.length : it.str.length;
          const x0 = it.x + it.w * i / it.str.length + 0.001, x1 = it.x + it.w * (i + n) / it.str.length - 0.001;
          const y0 = it.y - it.h * 0.8, y1 = it.y;
          if (![[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(p => masks.some(b => inside(p, b)))) problems.push('not covered: ' + c.text + ' at ' + it.x.toFixed(3) + ',' + it.y.toFixed(3));
        }
      }
      if (problems.length) return { problems };
      const vp = pg.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      ctx.fillStyle = '#9aa0a6';
      for (const b of masks) ctx.fillRect(b[0] * canvas.width, b[1] * canvas.height, (b[2] - b[0]) * canvas.width, (b[3] - b[1]) * canvas.height);
      const [x0, y0, x1, y1] = src.box;
      const crop = document.createElement('canvas');
      crop.width = Math.round((x1 - x0) * canvas.width);
      crop.height = Math.round((y1 - y0) * canvas.height);
      crop.getContext('2d').drawImage(canvas, Math.round(x0 * canvas.width), Math.round(y0 * canvas.height), crop.width, crop.height, 0, 0, crop.width, crop.height);
      return { png: crop.toDataURL('image/png').split(',')[1], pages: doc.numPages, title: meta.info.Title || null, modified: meta.info.ModDate || null, created: meta.info.CreationDate || null };
    }, { data, worker: lib['pdf.worker.min.js'], src: { page: src.page, box: src.box, redact: src.redact, covers: src.covers }, scale });
    if (out.problems) throw Error(src.file + ': ' + out.problems.join('; '));
    const bytes = Buffer.from(out.png, 'base64');
    if (bytes.readUInt32BE(20) > MAX_HEIGHT * 1.2) throw Error(src.file + ': crop is ' + bytes.readUInt32BE(20) + ' px tall');
    const published = pdfDate(out.modified);
    return { bytes, title: out.title, published, publishedNote: published ? 'Modification date in the PDF\'s document properties (created ' + pdfDate(out.created) + ').' : null, region: 'Page ' + src.page + ' of ' + out.pages + ' of the PDF (' + src.pdf.split('/').pop() + '), rendered with pdf.js ' + PDFJS_VERSION + ', cropped to x ' + src.box[0] + '-' + src.box[2] + ' and y ' + src.box[1] + '-' + src.box[3] + ' of the page' };
  } finally { await context.close(); }
}

function entryOf(src, shot, scale) {
  return {
    file: src.file, workflow: src.workflow, label: src.label || null, source_url: src.pdf || src.url, linked_from: src.linked_from || null, article_title: shot.title,
    captured_at: new Date().toISOString(), publication_date: shot.published || null,
    publication_date_note: shot.published ? (shot.publishedNote || null) : 'The page shows no publication or update date.',
    region: shot.region, shows: src.shows, text_alternative: src.alternative || null, note: src.note || null,
    redactions: (src.redact || []).map(x => x.what), left_visible: src.visible || null,
    width: shot.bytes.readUInt32BE(16), height: shot.bytes.readUInt32BE(20), scale, bytes: shot.bytes.length, sha256: sha(shot.bytes)
  };
}

function manifestOf(entries, version) {
  return {
    schema: 'larkfield.reference-screenshots.v1',
    reference_product: 'UnitedHealthcare',
    source: 'UnitedHealthcare public pages for members (uhc.com member resources, health insurance articles and consumer news articles, the start pages of its member forms at memberforms.uhc.com, and the member PDFs those pages link to), opened without signing in',
    browser: 'chromium ' + version, viewport: '1280x1700', locale: 'en-US',
    pdf_renderer: {
      library: 'pdf.js ' + PDFJS_VERSION,
      files: Object.entries(PDFJS_FILES).map(([file, sha256]) => ({ file, url: PDFJS + file, sha256 })),
      check: 'Before rendering any PDF the tool downloads both files, compares their SHA-256 with these pinned values and stops on a mismatch; the checked bytes are the ones loaded into the page (the worker from a blob URL). The pinned files equal build/pdf.min.js and build/pdf.worker.min.js of the npm release pdfjs-dist 3.11.174.'
    },
    labels: { [ARTICLE]: entries.filter(e => e.label === ARTICLE).map(e => e.file) },
    command: 'node apps/larkfield-health/evidence/tools/reference.cjs',
    note: 'Screenshots of public pages and documents, kept as review evidence only. The App copies no branding, text or images from them. Floating site elements (the cookie notice, the feedback tab and the survey invitation) are hidden before each web capture; the page content is unchanged. The web pages captured show no personal data. PDF pages are rendered with pdf.js and cropped to the region named in each entry. The publisher\'s sample statement carries placeholder member data (a test name and mailing address, member ID, group name and number, patient account and claim numbers); these are covered by grey boxes like personal data, the capture stops if any of them is found outside a box, and each entry lists what was covered and what was left visible. Width and height are read from the saved PNG. Most workflows have no public image of the member portal, which is behind sign-in; for those, articles, form start pages, the blank claim form and the sample statement stand in, each entry with text_alternative says what it stands in for, and the workflow is marked alternative proposed, reviewer agreement pending.',
    workflows: WORKFLOWS.map(w => ({ ...w, files: entries.filter(e => e.workflow === w.workflow).map(e => e.file) })),
    references: entries
  };
}

const committedMode = e => (/ of the PDF /.test(e.region) ? 'pdf' : 'web');

async function main({ out = OUT, update = process.argv.includes('--update'), launch = () => chromium.launch({ headless: true, args: ['--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'] }), page = capturePage, pdf = capturePdf, pdfjs = loadPdfjs, log = console.log } = {}) {
  const manifestFile = path.join(out, 'references.json');
  const committed = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'larkfield-reference-'));
  const browser = await launch();
  const version = browser.version();
  const entries = [], refused = [];
  try {
    const lib = await pdfjs(browser);
    for (const src of SOURCES) {
      let scale = src.pdf ? 2.5 : 1, shot;
      for (;;) {
        shot = src.pdf ? await pdf(browser, src, scale, lib) : await page(browser, src, scale);
        if (shot.bytes.length <= LIMIT || scale <= 0.75) break;
        scale = Math.round((scale - 0.25) * 100) / 100;
      }
      if (shot.bytes.length > LIMIT) throw Error(src.file + ': ' + shot.bytes.length + ' bytes');
      const entry = entryOf(src, shot, scale);
      const old = committed && committed.references.find(x => x.file === src.file);
      if (old) {
        const changed = [];
        if (committedMode(old) !== (src.pdf ? 'pdf' : 'web')) changed.push('rendering mode ' + committedMode(old) + ' → ' + (src.pdf ? 'pdf' : 'web'));
        if (old.scale !== entry.scale) changed.push('scale ' + old.scale + ' → ' + entry.scale);
        if (old.width !== entry.width || old.height !== entry.height) changed.push('size ' + old.width + '×' + old.height + ' → ' + entry.width + '×' + entry.height);
        if (changed.length && !update) refused.push(src.file + ' (' + changed.join(', ') + ')');
        if (old.sha256 === entry.sha256) entry.captured_at = old.captured_at;
      }
      fs.writeFileSync(path.join(staging, src.file), shot.bytes);
      entries.push(entry);
      log(src.file + ' ' + shot.bytes.length + ' bytes, scale ' + scale + (old && old.sha256 === entry.sha256 ? ', unchanged' : ''));
    }
    if (refused.length) throw Error('The rendering of ' + refused.length + ' reference' + (refused.length === 1 ? '' : 's') + ' differs from the committed manifest, so nothing was replaced: ' + refused.join('; ') + '. Check the new capture and rerun with --update to accept it.');
    entries.sort((a, b) => a.file.localeCompare(b.file));
    const manifest = manifestOf(entries, version);
    const pdfsUnchanged = committed && entries.filter(e => SOURCES.find(x => x.file === e.file).pdf).every(e => { const old = committed.references.find(x => x.file === e.file); return old && old.sha256 === e.sha256; });
    if (pdfsUnchanged && committed.pdf_renderer && committed.pdf_renderer.rechecked) manifest.pdf_renderer.rechecked = committed.pdf_renderer.rechecked;
    fs.writeFileSync(path.join(staging, 'references.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
    fs.cpSync(staging, out, { recursive: true });
  } finally {
    await browser.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function selfCheck() {
  const committed = JSON.parse(fs.readFileSync(path.join(OUT, 'references.json'), 'utf8'));
  const byFile = new Map(committed.references.map(e => [e.file, e]));
  const fake = { version: () => committed.browser.replace(/^chromium /, ''), close: async () => {} };
  const shotOf = (src, alter) => {
    const e = byFile.get(src.file);
    let bytes = fs.readFileSync(path.join(OUT, src.file));
    if (alter) bytes = alter(src, bytes);
    return { bytes, title: e.article_title, published: e.publication_date, publishedNote: e.publication_date_note, region: e.region };
  };
  const taller = (src, bytes) => { const b = Buffer.from(bytes); b.writeUInt32BE(b.readUInt32BE(20) + 1, 20); return b; };
  const touched = (src, bytes) => Buffer.concat([bytes, Buffer.from([0])]);
  const scenario = async (alterFile, alter, update) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'larkfield-reference-check-'));
    fs.cpSync(OUT, out, { recursive: true });
    const before = new Map(fs.readdirSync(out).map(f => [f, sha(fs.readFileSync(path.join(out, f)))]));
    const capture = async (b, src) => shotOf(src, src.file === alterFile ? alter : null);
    let error = null;
    try { await main({ out, update, launch: async () => fake, page: capture, pdf: capture, pdfjs: async () => ({}), log: () => {} }); } catch (e) { error = String(e.message).split('\n')[0]; }
    const after = new Map(fs.readdirSync(out).map(f => [f, sha(fs.readFileSync(path.join(out, f)))]));
    const changedFiles = [...after.keys()].filter(f => before.get(f) !== after.get(f)).sort();
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'references.json'), 'utf8'));
    fs.rmSync(out, { recursive: true, force: true });
    return { error, changedFiles, manifest };
  };
  const target = '05-requests-claim-letters.png';
  const same = await scenario(null, null, false);
  if (same.error || same.changedFiles.length) throw Error('Unchanged captures changed files: ' + (same.error || same.changedFiles.join(', ')));
  const refusedRun = await scenario(target, taller, false);
  if (!refusedRun.error || !refusedRun.error.includes(target) || refusedRun.changedFiles.length) throw Error('A changed size was not refused with every file kept');
  const accepted = await scenario(target, taller, true);
  if (accepted.error || JSON.stringify(accepted.changedFiles) !== JSON.stringify([target, 'references.json'])) throw Error('--update did not replace exactly the changed capture and the manifest');
  const content = await scenario(target, touched, false);
  const kept = content.manifest.references.filter(e => e.file !== target).every(e => e.captured_at === byFile.get(e.file).captured_at);
  if (content.error || !kept || content.manifest.references.find(e => e.file === target).captured_at === byFile.get(target).captured_at) throw Error('A same-size change was not taken with a new capture time while the others kept theirs');
  console.log(JSON.stringify({ unchanged_captures: 'no file changed, the manifest included', changed_size_without_update: refusedRun.error, changed_size_with_update: 'replaced ' + accepted.changedFiles.join(' and '), same_size_new_bytes: 'replaced with a new captured_at; every other entry kept its captured_at' }, null, 2));
}

if (require.main === module) (process.argv.includes('--self-check') ? selfCheck() : main()).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { SOURCES, WORKFLOWS, ARTICLE, PDFJS_FILES, loadPdfjs, capturePdf, entryOf, manifestOf };
