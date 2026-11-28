#!/usr/bin/env node
'use strict';
// Captures the public Meetup reference pages used in evidence/README.md with
// headless Chromium. Public pages only: no login, no account, no bot-check
// bypass. Before each screenshot every image is blurred and every person name
// the page links to a member profile, or prints after "Hosted by" or
// "Organized by", is blurred, so no personal data is kept. A page that answers
// with a bot check is recorded as blocked and not captured.
//   node apps/stoopside/evidence/reference/capture.cjs
// Writes PNGs and sources.json next to this file. Not part of the App package's
// runtime; the images belong to their owners (see NOTICE.md).
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const {chromium} = require(require.resolve('playwright', {paths: [root]}));

const PAGES = [
  {file: 'meetup-find-groups.png', url: 'https://www.meetup.com/find/?source=GROUPS&location=us--ny--New%20York', workflow: 'Group discovery: group cards with name, member count and join entry point'},
  {file: 'meetup-find-events.png', url: 'https://www.meetup.com/find/?source=EVENTS&location=us--ny--New%20York', workflow: 'Event discovery: event cards with date, title, group and attendee count'},
  {file: 'meetup-group-home.png', url: 'https://www.meetup.com/nycnonprofit/', workflow: 'Group home: description, organizers, upcoming events and join button'},
  {file: 'meetup-event-page.png', url: 'https://www.meetup.com/nycnonprofit/events/317300605/', workflow: 'Event page: date block, time and place, hosts, attendees and the Attend (RSVP) button'},
  {file: 'meetup-group-members.png', url: 'https://www.meetup.com/nycnonprofit/members/', workflow: 'Member directory: member list with roles and search'},
  {file: null, url: 'https://help.meetup.com/hc/en-us', workflow: 'Help center articles on RSVPs, waitlists, guests, editing and cancelling events, discussions and member management'},
];

const REDACT = () => {
  const style = document.createElement('style');
  style.textContent = 'img,picture,video,[style*="background-image"]{filter:blur(14px)!important}.st-redact{filter:blur(7px)!important}';
  document.head.append(style);
  for (const a of document.querySelectorAll('a[href*="/members/"]')) if (!/\/members\/?(\?|$)/.test(new URL(a.href).pathname + new URL(a.href).search) || a.textContent.trim().split(/\s+/).length <= 4) a.classList.add('st-redact');
  for (const n of document.querySelectorAll('body *')) {
    if (n.children.length > 3) continue;
    const t = n.textContent.trim();
    if (/^(Hosted by|Organized by)\b/i.test(t) && t.length < 80) n.classList.add('st-redact');
    // The Organizers, Attendees and Members panels list people: blur the panel, keep its heading.
    if (/^(Organizers|Attendees)$/.test(t) && /^H[1-6]$/.test(n.tagName)) {
      let panel = n;
      while (panel.parentElement && panel.parentElement.textContent.trim().length < t.length + 400 && panel.parentElement !== document.body) panel = panel.parentElement;
      for (const x of panel.querySelectorAll('*')) if (!x.contains(n) && !n.contains(x)) x.classList.add('st-redact');
    }
  }
  // Hide (do not answer) the cookie banner so it does not cover the page.
  for (const n of document.querySelectorAll('body *')) {
    if (/^We use cookies/.test(n.textContent.trim()) && n.textContent.length < 800 && ['fixed', 'sticky'].includes(getComputedStyle(n).position)) n.style.display = 'none';
  }
  for (const n of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(n);
    if (cs.position === 'fixed' && /We use cookies/.test(n.textContent) && n.textContent.length < 1500) n.style.display = 'none';
  }
};

(async () => {
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 800}, locale: 'en-US'});
  const page = await context.newPage();
  const sources = {captured_with: `Playwright Chromium ${browser.version()}, headless, 1280x800, no login`, pages: []};
  for (const p of PAGES) {
    const at = new Date().toISOString();
    let status = null, title = '', outcome;
    try {
      const r = await page.goto(p.url, {waitUntil: 'domcontentloaded', timeout: 30000});
      status = r && r.status();
      await page.waitForTimeout(5000);
      title = await page.title();
      const blocked = status === 403 || /just a moment|security verification|captcha/i.test(title + ' ' + (await page.evaluate(() => document.body.innerText.slice(0, 400))));
      if (blocked) outcome = 'blocked: the site answered with a bot check (Cloudflare "Just a moment..."); not bypassed';
      else if (/\/login/.test(page.url()) || await page.locator('input[type=password]').count()) outcome = 'login required (redirected to the log-in page); not captured';
      else if (p.file) {
        await page.evaluate(REDACT);
        await page.waitForTimeout(300);
        await page.screenshot({path: path.join(__dirname, p.file)});
        outcome = 'captured';
      }
    } catch (e) { outcome = 'error: ' + e.message.split('\n')[0]; }
    sources.pages.push({file: outcome === 'captured' ? p.file : null, url: p.url, workflow: p.workflow, captured_at: at, http_status: status, title, outcome});
    console.log(`${outcome}: ${p.url}`);
  }
  fs.writeFileSync(path.join(__dirname, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
