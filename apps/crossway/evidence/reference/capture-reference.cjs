#!/usr/bin/env node
// Captures screenshots of PUBLIC reference pages (E-ZPass NY / Tolls by Mail NY)
// used as review comparison evidence for the Crossway App workflows.
//
// Rules this script follows:
// - headless Playwright Chromium, default user agent, viewport 1280x800
// - public pages only: no sign-in, no form input, no lookup submission
// - UI-only interactions: hovering nav menus, switching FAQ categories,
//   expanding/collapsing FAQ answers, stepping the home alert carousel
// - one attempt per URL; if a page is blocked (HTTP >= 400, bot challenge,
//   empty page) it is recorded in sources.json "blocked" and skipped
//
// Usage (from the repo root):
//   node apps/crossway/evidence/reference/capture-reference.cjs
// Writes PNGs (JPEG q70 fallback only if a PNG exceeds MAX_BYTES) and sources.json
// next to this script.

'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../../node_modules/playwright'));

const OUT = __dirname;
const VIEWPORT = { width: 1280, height: 800 };
const MAX_BYTES = 250 * 1024;
const HEADER_H = 80; // fixed site header height (px)

// action: what UI-only step to perform before capturing.
// capture: 'viewport' | { union: true } (clip around the targeted FAQ answers) | { selector } | { clip }
const TARGETS = [
  {
    file: 'tbm-pay-toll',
    workflow: 'pay_notice',
    url: 'https://www.e-zpassny.com/tbm/pay-toll',
    action: { type: 'none' },
    capture: 'viewport',
    notes: 'Public "Manage & Pay Toll Bill/Violation" lookup entry page (by toll bill/violation number or by license plate). Fields left empty; nothing entered or submitted. The sample toll-invoice header and the sample "DAV 999" plate are the site\'s own published illustrations, not personal data.',
  },
  {
    file: 'tbm-ways-to-pay',
    workflow: 'pay_notice',
    url: 'https://www.e-zpassny.com/tbm/ways-to-pay',
    action: { type: 'none' },
    capture: 'viewport',
    notes: 'Tolls by Mail "Ways To Pay" page (online, app, phone, in person, mail).',
  },
  {
    file: 'tbm-faq-pay-toll-bill',
    workflow: 'pay_notice',
    url: 'https://www.e-zpassny.com/tbm/faq',
    action: { type: 'faq', category: 'Payments', questions: ['How do I pay my Toll Bill?'] },
    capture: { union: true },
    notes: 'Tolls by Mail FAQ, Payments category, answer expanded (UI toggle only).',
  },
  {
    file: 'ezpass-faq-pay-violation',
    workflow: 'pay_notice',
    url: 'https://www.e-zpassny.com/faq',
    action: { type: 'faq', category: 'Violations', questions: ['How can I pay a Notice of Violation?'] },
    capture: { union: true },
    notes: 'E-ZPass FAQ, Violations category, answer expanded (UI toggle only).',
  },
  {
    file: 'tbm-faq-dispute-violation',
    workflow: 'dispute_notice',
    url: 'https://www.e-zpassny.com/tbm/faq',
    action: { type: 'faq', category: 'Violations', questions: ['How do I dispute a Violation Notice?'] },
    capture: { union: true },
    notes: 'Tolls by Mail FAQ, Violations category, dispute answer expanded (UI toggle only).',
  },
  {
    file: 'tbm-faq-not-my-vehicle',
    workflow: 'dispute_notice',
    url: 'https://www.e-zpassny.com/tbm/faq',
    action: { type: 'faq', category: 'General Questions', questions: ['I received a Toll Bill but it was not my vehicle'] },
    capture: { union: true },
    notes: 'Tolls by Mail FAQ, General Questions category: what to do when a Toll Bill is for a vehicle that is not yours (dispute path).',
  },
  {
    file: 'ezpass-faq-dispute-violation',
    workflow: 'dispute_notice',
    url: 'https://www.e-zpassny.com/faq',
    action: { type: 'faq', category: 'Violations', questions: ['How do I dispute a Notice of Violation'] },
    capture: { union: true },
    notes: 'E-ZPass FAQ, Violations category, dispute answer expanded (UI toggle only).',
  },
  {
    file: 'ezpass-faq-plates',
    workflow: 'vehicles_plates',
    url: 'https://www.e-zpassny.com/faq',
    action: { type: 'faq', category: 'Vehicles & Tags', questions: ['list all my current license plates'] },
    capture: { union: true },
    notes: 'E-ZPass FAQ, Vehicles & Tags category: why every license plate must be listed on the account.',
  },
  {
    file: 'ezpass-faq-update-account',
    workflow: 'vehicles_plates',
    url: 'https://www.e-zpassny.com/faq',
    action: { type: 'faq', category: 'Account Updates', questions: ['How do I update my account?'] },
    capture: { union: true },
    notes: 'E-ZPass FAQ, Account Updates category: how account details (including vehicles) are updated.',
  },
  {
    file: 'ezpass-faq-replenish',
    workflow: 'topup_replenish',
    url: 'https://www.e-zpassny.com/faq',
    action: { type: 'faq', category: 'Payments', questions: ['How can I replenish my account?'] },
    capture: { union: true },
    notes: 'E-ZPass FAQ, Payments category: replenishment methods (Auto-Replenishment, Pay-Per-Trip, manual).',
  },
  {
    file: 'ezpass-home-rebill-alert',
    workflow: 'topup_replenish',
    url: 'https://www.e-zpassny.com',
    action: { type: 'alertSlide', text: 'Rebill Evaluation' },
    capture: { clip: { x: 0, y: 0, width: 1280, height: 250 } },
    notes: 'Home page alert carousel stepped (next arrow, UI only) to the "Rebill Evaluation Reminder" alert about automatic rebill/replenishment amount adjustment.',
  },
  {
    file: 'ezpass-faq-tags',
    workflow: 'transponder',
    url: 'https://www.e-zpassny.com/faq',
    action: { type: 'faq', category: 'Vehicles & Tags', questions: ['How do I report my Tag lost or stolen?', 'Can I request an additional Tag?'] },
    capture: { union: true },
    notes: 'E-ZPass FAQ, Vehicles & Tags category: lost/stolen Tag and additional Tag answers expanded.',
  },
  {
    file: 'ezpass-account-types',
    workflow: 'transponder',
    url: 'https://www.e-zpassny.com/ezpass/account-types',
    action: { type: 'none' },
    capture: 'viewport',
    notes: '"Which Account is for Me?" page: Private Account allows up to 4 Tags and Tags can be moved between vehicles of the same type.',
  },
  {
    file: 'mta-tolls',
    workflow: 'rates',
    url: 'https://www.mta.info/fares-tolls/tolls',
    action: { type: 'none' },
    capture: 'viewport',
    notes: 'MTA Bridges and Tunnels toll rates page, linked from the E-ZPass NY "Toll Rates" menu. Owned by the MTA, not by E-ZPass NY.',
    alternative: 'Captured the web.archive.org copy of the same page instead (file mta-tolls-archive, Wayback snapshot 20261104030145). Other options: the MTA public toll-rate PDF schedule, or a manual browser screenshot by a reviewer.',
  },
  {
    file: 'mta-tolls-archive',
    workflow: 'rates',
    url: 'https://web.archive.org/web/20261104030145/https://www.mta.info/fares-tolls/tolls',
    action: { type: 'none' },
    capture: 'viewport',
    archive_timestamp: '20261104030145',
    notes: 'ARCHIVE CAPTURE (web.archive.org, Wayback snapshot timestamp 20261104030145 = 2026-11-04 03:01:45 UTC) of the MTA Bridges and Tunnels toll rates page https://www.mta.info/fares-tolls/tolls, which returned HTTP 403 to headless Playwright. Owned by the MTA, linked from the E-ZPass NY "Toll Rates" menu. The Wayback toolbar at the top is part of the capture.',
  },
];

const BLOCK_PATTERNS = /(access denied|just a moment|attention required|verify you are human|are you a robot|request unsuccessful|incapsula|captcha|pardon our interruption|403 forbidden)/i;

async function doAction(page, action) {
  if (action.type === 'none') return;
  if (action.type === 'hoverMenu') {
    const trigger = page.locator('header [tabindex="0"]', { hasText: action.label }).first();
    await trigger.hover();
    await page.waitForTimeout(1200);
    if (action.sub) {
      await page.locator('header [role="menuitem"]', { hasText: action.sub }).first().hover();
      await page.waitForTimeout(1200);
    }
    return;
  }
  if (action.type === 'alertSlide') {
    for (let i = 0; i < 6; i++) {
      const visible = await page.evaluate((t) => {
        return [...document.querySelectorAll('body *')].some((el) => {
          if (el.children.length) return false;
          if (!(el.textContent || '').includes(t)) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth && r.top < 300;
        });
      }, action.text);
      if (visible) return;
      // the right-hand "next" arrow of the alert carousel
      await page.mouse.click(1227, 162);
      await page.waitForTimeout(1200);
    }
    throw new Error('alert slide not found: ' + action.text);
  }
  if (action.type === 'faq') {
    await page.getByRole('link', { name: action.category, exact: true }).first().click();
    await page.waitForTimeout(1500);
    const summaries = page.locator('.MuiAccordionSummary-root');
    const n = await summaries.count();
    for (let i = 0; i < n; i++) {
      const s = summaries.nth(i);
      if (!(await s.isVisible())) continue;
      const q = (await s.innerText()).trim();
      const want = action.questions.some((t) => q.includes(t));
      const expanded = (await s.getAttribute('aria-expanded')) === 'true';
      if (want !== expanded) {
        await s.click();
        await page.waitForTimeout(700);
      }
    }
    await page.waitForTimeout(800);
    return;
  }
  throw new Error('unknown action ' + action.type);
}

async function unionClip(page, questions) {
  const box = await page.evaluate((qs) => {
    const accs = [...document.querySelectorAll('.MuiAccordion-root')].filter((a) => {
      const s = a.querySelector('.MuiAccordionSummary-root');
      return s && s.offsetParent !== null && qs.some((q) => s.innerText.includes(q));
    });
    if (!accs.length) return null;
    let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
    for (const a of accs) {
      const r = a.getBoundingClientRect();
      top = Math.min(top, r.top + window.scrollY);
      left = Math.min(left, r.left + window.scrollX);
      bottom = Math.max(bottom, r.bottom + window.scrollY);
      right = Math.max(right, r.right + window.scrollX);
    }
    return { top, left, bottom, right };
  }, questions);
  if (!box) throw new Error('FAQ answer not found: ' + questions.join(' / '));
  const pad = 16;
  const x = Math.max(0, Math.floor(box.left - pad));
  const y = Math.max(0, Math.floor(box.top - pad));
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, Math.ceil(box.right - box.left + 2 * pad)),
    height: Math.min(1400, Math.ceil(box.bottom - box.top + 2 * pad)),
  };
}

async function shoot(page, capture, action, type, quality) {
  const opts = { type };
  if (type === 'jpeg') opts.quality = quality;
  if (capture === 'viewport') return page.screenshot(opts);
  if (capture.union) {
    const clip = await unionClip(page, action.questions);
    return page.screenshot({ ...opts, fullPage: true, clip });
  }
  if (capture.clip) return page.screenshot({ ...opts, clip: capture.clip });
  throw new Error('bad capture spec');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const sources = [];
  const blocked = [];
  const only = process.argv.slice(2);

  for (const t of TARGETS) {
    if (only.length && !only.includes(t.file)) continue;
    const page = await context.newPage();
    const triedAt = new Date().toISOString();
    try {
      const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4500);
      const status = resp ? resp.status() : 0;
      const title = await page.title();
      const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      if (status >= 400 || BLOCK_PATTERNS.test(title) || BLOCK_PATTERNS.test(bodyText.slice(0, 2000)) || bodyText.trim().length < 200) {
        blocked.push({
          url: t.url,
          tried_at: triedAt,
          reason: `HTTP ${status}; title "${title}"; body length ${bodyText.trim().length}` + (BLOCK_PATTERNS.test(title + bodyText.slice(0, 2000)) ? '; bot-check or access-denied text detected' : ''),
          alternative: t.alternative || 'Use a web.archive.org capture of the same public page (labelled as an archive capture with its archive timestamp).',
        });
        console.log('BLOCKED', t.url, status, title);
        await page.close();
        continue;
      }
      await doAction(page, t.action);
      let buf = await shoot(page, t.capture, t.action, 'png');
      let ext = 'png';
      if (buf.length > MAX_BYTES) {
        buf = await shoot(page, t.capture, t.action, 'jpeg', 70);
        ext = 'jpg';
      }
      const file = `${t.file}.${ext}`;
      // remove a stale file with the other extension
      for (const e of ['png', 'jpg']) {
        const p = path.join(OUT, `${t.file}.${e}`);
        if (e !== ext && fs.existsSync(p)) fs.unlinkSync(p);
      }
      fs.writeFileSync(path.join(OUT, file), buf);
      sources.push({
        file,
        workflow: t.workflow,
        title,
        url: page.url(),
        requested_url: t.url,
        captured_at: new Date().toISOString(),
        viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
        capture: t.capture === 'viewport' ? 'viewport' : t.capture.union ? 'clip around expanded FAQ answer(s)' : `clip ${JSON.stringify(t.capture.clip)}`,
        bytes: buf.length,
        ...(t.archive_timestamp ? { archive_capture: true, archive_timestamp: t.archive_timestamp } : {}),
        notes: t.notes + (ext === 'jpg' ? ' Saved as JPEG quality 70 because the PNG exceeded 250 KB.' : ''),
      });
      console.log('OK', file, buf.length, page.url());
    } catch (e) {
      console.log('ERROR', t.file, e.message);
      blocked.push({ url: t.url, tried_at: triedAt, reason: 'capture error: ' + e.message.split('\n')[0], alternative: 'Retry manually or use a web.archive.org capture of the same page.' });
    }
    await page.close();
  }
  await browser.close();

  const outPath = path.join(OUT, 'sources.json');
  let merged = { generated_by: 'capture-reference.cjs', sources, blocked };
  if (only.length && fs.existsSync(outPath)) {
    // partial re-run: replace only the re-captured entries
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const keep = (prev.sources || []).filter((s) => !only.includes(s.file.replace(/\.(png|jpg)$/, '')));
    merged = { generated_by: 'capture-reference.cjs', sources: [...keep, ...sources], blocked: [...(prev.blocked || []).filter((b) => !TARGETS.some((t) => only.includes(t.file) && t.url === b.url)), ...blocked] };
  }
  const order = (s) => TARGETS.findIndex((t) => s.file.replace(/\.(png|jpg)$/, '') === t.file);
  merged.sources.sort((a, b) => order(a) - order(b));
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
  const total = merged.sources.reduce((a, s) => a + s.bytes, 0);
  console.log('total bytes', total, 'files', merged.sources.length, 'blocked', merged.blocked.length);
})();
