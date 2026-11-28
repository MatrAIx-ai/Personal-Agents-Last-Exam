'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runWebAcceptance } = require('./web/harness.cjs');

const appDir = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(appDir, file), 'utf8'));
const tools = read('tools.json').map(t => t.name);
const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8');
const FIXTURE = read('fixtures/minimal.json');
const CLOCK = read('fixtures/clock.json').initial_time;
const WITHOUT_CL17 = { ...FIXTURE, seed_id: FIXTURE.seed_id + '-web-b', claims: FIXTURE.claims.filter(c => c.claim_id !== 'cl-17') };
const AP3_STATEMENTS = FIXTURE.appeals.find(a => a.appeal_id === 'ap-3').statements.length;
const L = name => 'larkfield-health.' + name;
const UNSAFE = '<img src=x onerror=window.injected=1>';
const ID_TEXT = /\b(cl|ap|pa|gr|ir|eob|ln|cf|n)-[a-z0-9]+\b/i;
const CANNOT_CONFIRM = 'Whether your last change took effect cannot be confirmed. See the message on the page.';
const NOTHING_CHANGED = 'Nothing was changed. See the message on the page.';

function helpers(t) {
  const { page } = t;
  const calls = [];
  page.on('request', r => { if (r.url().endsWith('/api/call')) calls.push(r.postDataJSON()); });
  const $ = selector => page.locator(selector);
  const h = {
    calls, $,
    sent: name => calls.filter(c => c.name === L(name)).length,
    nav: async name => { await page.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click(); await t.idle(); },
    refresh: async () => { await page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true }).click(); await t.settled(); },
    refreshFailing: async () => { await page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true }).click(); await $('#status[data-error=true]').waitFor(); await t.settled(); },
    pick: async (kind, id) => { await $('[data-' + kind + '-id="' + id + '"]').click(); await $('[data-' + kind + '="' + id + '"]').waitFor(); await t.settled(); },
    form: key => $('[data-form="' + key + '"]'),
    flow: key => $('[data-flow="' + key + '"]'),
    alert: async (code, scope = page) => { await scope.locator('[role=alert][data-code=' + code + ']').first().waitFor(); await t.settled(); },
    flash: async text => { await $('[data-flash]').filter({ hasText: text }).waitFor(); await t.settled(); },
    token: async key => h.flow(key).locator('[data-token]').getAttribute('data-token'),
    state: async key => h.flow(key).getAttribute('data-state'),
    preview: async key => { await $('[data-action=preview][data-key="' + key + '"]').click(); await h.flow(key).waitFor(); await t.settled(); return h.token(key); },
    confirm: async key => { await h.flow(key).locator('[data-action=confirm]').click(); },
    approve: async token => t.event('user.confirmed', { token, confirmed_by: 'm-1' }),
    now: async () => (await t.snapshot()).virtual_now,
    find: async (list, key, id) => (await t.data())[list].find(x => x[key] === id),
    text: async selector => (await $(selector).first().innerText()).trim(),
    status: async () => (await $('#status').innerText()).trim(),
    dismiss: async action => { if (await $('[data-action=' + action + ']').count()) { await $('[data-action=' + action + ']').first().click(); await t.idle(); } },
    focusIn: async selector => page.evaluate(s => { const n = document.querySelector(s); return !!n && !!document.activeElement && n.contains(document.activeElement); }, selector),
    noIds: async () => page.evaluate(src => { const re = new RegExp(src, 'i'); return [...document.querySelectorAll('.detail h2,.detail h3,#records h3,[data-flash],[role=alert],[data-notice] p,.record-title')].map(n => n.textContent).filter(x => re.test(x)); }, ID_TEXT.source),
    hold: async match => {
      const held = [];
      await page.route('**/api/call', async route => { const p = route.request().postDataJSON(); if (match(p)) held.push({ route, response: await route.fetch() }); else await route.fallback(); });
      return held;
    },
    stall: async match => {
      let open, seen = false;
      const opened = new Promise(r => { open = r; });
      await page.route('**/api/call', async route => { if (!seen && match(route.request().postDataJSON())) { seen = true; await opened; } await route.fallback(); });
      return { open: () => open(), seen: () => seen };
    },
    before: async (match, action) => {
      let done = false;
      await page.route('**/api/call', async route => { if (!done && match(route.request().postDataJSON())) { done = true; await action(); } await route.fallback(); });
    },
    fail: async match => {
      let done = false;
      await page.route('**/api/call', async route => { if (!done && match(route.request().postDataJSON())) { done = true; await route.abort('failed'); } else await route.fallback(); });
    },
    answer: async (match, status, body) => {
      let done = false;
      await page.route('**/api/call', async route => { if (!done && match(route.request().postDataJSON())) { done = true; await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); } else await route.fallback(); });
    },
    timeoutAfterCommit: async match => {
      const seen = { forwarded: null, request: null };
      await page.route('**/api/call', async route => { const p = route.request().postDataJSON(); if (!seen.forwarded && match(p)) { seen.request = p; seen.forwarded = await (await route.fetch()).json(); await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'MCP request timed out' }) }); } else await route.fallback(); });
      return seen;
    },
    until: async test => { for (let i = 0; i < 400; i++) { if (await test()) return; await page.waitForTimeout(25); } throw Error('Condition not reached'); }
  };
  return h;
}

async function views(t, h, shots) {
  const { page } = t;
  const list = [['Claims', 'claim', 'cl-14'], ['Prior authorizations', 'pa', 'pa-3'], ['Appeals', 'appeal', 'ap-3'], ['Plan & costs', null, '2026'], ['Household', null, null]];
  const open = async ([name, kind, id]) => { await h.nav(name); if (kind) await h.pick(kind, id); else if (id) await page.locator('[data-plan-year="' + id + '"]').click(); await t.idle(); };
  const name = v => v[0].split(' ')[0].toLowerCase();
  if (shots) for (const v of list) { await open(v); await t.shot(name(v) + '-1280'); }
  const out = [];
  for (const v of list) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(v);
    const wide = await t.overflow(390);
    await page.waitForTimeout(100);
    const small = await page.evaluate(() => [...document.querySelectorAll('#app button,#app select,#app textarea,#app summary,#app input:not([type=radio]):not([type=checkbox]),#app label[data-choice]')].filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).map(n => (n.textContent.trim() || n.outerHTML).slice(0, 40)));
    const boxed = await page.evaluate(() => [...document.querySelectorAll('#app *')].filter(n => n.tagName !== 'TEXTAREA' && /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1).map(n => n.id || n.className || n.tagName));
    out.push({ view: v[0], wide, small, boxed });
    if (shots) await t.shot(name(v) + '-390');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  return out;
}

function workflows(t) {
  const { page, check } = t;
  const h = helpers(t);
  const { $ } = h;
  t.allowConsole(/net::ERR_FAILED/);
  t.allowConsole(/status of 403/);
  t.allowConsole(/status of 400/);
  const k1 = 'info:ir-11', k2 = 'info:ir-12', kn = 'give';
  let tok1, tok2, gr3, seeds = 0;
  const seed = data => t.loadSeed({ data, virtual_now: CLOCK, request_id: 'web-seed-' + (++seeds) });
  const reset = async () => { const r = await t.infra.call('env.reset', { expected_version: await t.version() }); if (r.status !== 'ready') throw Error('Reset: ' + JSON.stringify(r)); t.report.receipts.push({ kind: 'infra_reset', status: r.status }); };
  const grantCasey = (id, scope = 'act') => t.event('grant.changed', { grant_id: id, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope, expires_at: null, status: 'active' });
  const revokeCasey = id => t.event('grant.changed', { grant_id: id, status: 'revoked' });
  const familyShown = async () => {
    await h.nav('Plan & costs');
    const out = [];
    for (const y of ['2025', '2026', '2027']) { await $('[data-plan-year="' + y + '"]').click(); await $('[data-plan="' + y + '"]').waitFor(); out.push(await $('[data-family=true]').count() === 1); }
    return out;
  };
  const devConfirm = (...args) => spawnSync(process.execPath, [path.join(appDir, 'dev/confirm.cjs'), ...args], { encoding: 'utf8' });

  const w0 = { id: 'w0-page', title: 'The page', summary: 'The shared Host serves the App-owned page; every section of the fixture is shown in Eastern Time, at 1280 and 390 pixels.', steps: [
    { title: 'Open the page', action: 'Open the access link', expected: 'The Larkfield page with Claims open and the claim waiting for answers selected', focus: '[data-list=claims]',
      run: async () => {
        await t.open('[data-claim-id]');
        await t.settled();
        check('The shared Host serves the App-owned Larkfield page and its first refresh completes', await page.title() === 'Larkfield · PALE' && await page.evaluate(() => document.body.dataset.app) === 'larkfield-health' && await h.status() === 'Up to date');
        check('The controller names all ' + tools.length + ' business tools', tools.length === 21 && tools.every(n => controller.includes("'" + n + "'")));
        const discovered = (await t.host.client.request('tools/list')).result.tools.map(x => x.name);
        check('Business discovery lists the 21 tools and no management operation', discovered.length === 21 && discovered.every(n => n.startsWith('larkfield-health.')));
        const listed = await $('[data-claim-id]').evaluateAll(n => n.map(e => e.dataset.claimId).sort());
        const visible = (await t.agent('claims.list')).claims.map(c => c.claim_id).sort();
        check('The claims list shows exactly the claims Larkfield returns for the account holder (' + visible.length + ', with the 2025 history)', JSON.stringify(listed) === JSON.stringify(visible) && visible.some(id => id.startsWith('cl-h')));
        check('A claim waiting for answers is listed first and opened', await $('[data-claim=cl-13]').count() === 1);
        check('Times are shown in America/New_York with the zone named, not in the browser zone (' + t.report.browser_timezone + ')', (await h.text('[data-claim=cl-13]')).includes('Mon, Oct 12, 2026, 1:15 PM EDT') && (await h.text('[data-request=ir-11]')).includes('Open until Sun, Nov 29, 2026, 11:59 PM EST'));
        check('List group labels are headings and answer choices are labelled groups', await $('[data-list=claims] h3.kicker').count() >= 2 && await $('[data-form="' + k1 + '"] fieldset[data-group=answer] legend').isVisible());
      } },
    { title: 'Every section at 1280 and 390 pixels', action: 'Open Claims, Prior authorizations, Appeals, Plan & costs and Household at both widths', expected: 'No sideways scrolling, touch targets at least 44 px tall, and no inner scroll box hiding content on a phone', focus: '#app',
      run: async () => {
        const v = await views(t, h, true);
        check('At 390 px no section scrolls sideways', v.every(x => !x.wide));
        check('At 390 px every button, field, choice and summary is at least 44 px tall' + (v.some(x => x.small.length) ? ' (' + JSON.stringify(v.flatMap(x => x.small).slice(0, 3)) + ')' : ''), v.every(x => x.small.length === 0));
        check('At 390 px no inner scroll box hides content' + (v.some(x => x.boxed.length) ? ' (' + JSON.stringify(v.flatMap(x => x.boxed).slice(0, 3)) + ')' : ''), v.every(x => x.boxed.length === 0));
        const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
        check('The page keeps no business state in browser storage (only the shell’s section)', stored.local.length === 0 && stored.session.every(k => k === 'larkfield-health-section'));
      } },
    { title: 'What a first-time user needs explained', action: 'Open an ended PA, an upheld claim, a claim with two explanation versions, claims in review, the appeals list, the 2026 and 2027 plan years; filter PAs by member; on a phone, tap a claim', expected: 'Each state says what it means and what can be done; the signed-in person is named; the detail comes into view on a phone', focus: '#app',
      run: async () => {
        await h.nav('Prior authorizations');
        await h.pick('pa', 'pa-3');
        check('The sidebar names the signed-in account holder and stays in view on a wide screen', (await h.text('.sidebar-foot strong')) === 'Jordan Hale' && await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).position) === 'sticky');
        check('An ended PA says when expedited review can be asked for', (await h.text('[data-expedite-help]')).includes('only while the plan has not yet decided'));
        await page.locator('[data-field=member-filter]').selectOption('m-1');
        await t.idle();
        check('Filtering by another member clears the PA detail of Riley', await $('[data-pa=pa-3]').count() === 0);
        await page.locator('[data-field=member-filter]').selectOption('');
        await t.idle();
        await h.nav('Claims');
        await h.pick('claim', 'cl-3');
        check('A claim whose appeal was upheld says so in plain words and explains amounts not allowed', (await h.text('[data-claim=cl-3]')).includes('upheld, so the denial stands') && (await h.text('[data-claim=cl-3] [data-not-allowed-help]')).includes('does not say whether the provider may bill you'));
        await h.pick('claim', 'cl-8');
        check('A newer explanation of benefits says what changed and the older one says it was replaced', (await h.text('[data-claim=cl-8] [data-eob-change="2"]')).includes('is now paid') && (await h.text('[data-claim=cl-8] [data-eob-version="1"] summary')).includes('replaced by version 2'));
        await h.pick('claim', 'cl-15');
        const inReview = await h.text('[data-claim=cl-15]');
        await h.pick('claim', 'cl-13');
        check('A claim not yet reviewed shows when its review is due, and one waiting for answers says so, instead of “Reviewed”', inReview.includes('Review due') && !inReview.includes('Reviewed') && (await h.text('[data-claim=cl-13]')).includes('Reviewed (waiting for answers)'));
        await h.nav('Appeals');
        check('Appeal outcomes are in plain words', (await h.text('[data-appeal-id=ap-1]')).includes('Upheld: the denial stands') && (await h.text('[data-appeal-id=ap-2]')).includes('Overturned: the plan reversed its denial'));
        await h.nav('Plan & costs');
        await $('[data-plan-year="2027"]').click();
        await t.idle();
        check('An unanswered 2027 other-coverage question says when it can be answered', (await h.text('[data-accumulator=m-1] [data-coverage-help]')).includes('when a claim for 2027 needs it'));
        await $('[data-plan-year="2026"]').click();
        await t.idle();
        const plan = await h.text('[data-plan="2026"]');
        check('Hidden family totals say that another enrolled member is not visible, and no service ID appears in the text', plan.includes('at least one other member enrolled that year is not visible to you') && !/svc-/.test(plan));
        await page.setViewportSize({ width: 390, height: 844 });
        await h.nav('Claims');
        check('At 390 px the search box placeholder fits', await page.locator('.toolbar input[type=search]').getAttribute('placeholder') === 'Search');
        await $('[data-claim-id=cl-3]').click();
        await $('[data-claim=cl-3]').waitFor();
        await t.settled();
        await page.waitForTimeout(300);
        const top = await page.evaluate(() => document.querySelector('[data-claim=cl-3] h2').getBoundingClientRect().top);
        check('On a phone, tapping a claim brings its detail into view', top >= 0 && top < 844);
      } }
  ] };

  const w2 = { id: 'w2-claims-info', title: 'W2 Claims and accident questions', summary: 'Two accident questions on one claim, answered through preview, an outside approval, Refresh and Confirm.', steps: [
    { title: 'A preview that fails to load', action: 'Back at 1280 px; Claims; open cl-13; then Line 1: Not related to an accident → Preview answer, with the connection dropped', expected: 'A plain error that nothing was changed, not an uncertain change', focus: '[data-form="info:ir-11"]',
      run: async () => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await h.nav('Claims');
        await h.pick('claim', 'cl-13');
        await h.form(k1).locator('[data-field=answer][data-value=not_accident]').check();
        await h.fail(p => p.name === L('claims.info.preview'));
        await $('[data-action=preview][data-key="' + k1 + '"]').click();
        await h.alert('read_failed', h.form(k1));
        await t.release();
        check('A preview that fails to load is a read failure: the status line says nothing was changed, not that a change is uncertain', await h.status() === NOTHING_CHANGED && await h.flow(k1).count() === 0);
      } },
    { title: 'Preview an answer', action: 'Line 1: Not related to an accident → Preview answer', expected: 'The approval code, that you must approve it, the 30-minute rule and a waiting state; focus on the preview; nothing stored', focus: '[data-flow="info:ir-11"]',
      run: async () => {
        await h.form(k1).locator('[data-field=answer][data-value=not_accident]').check();
        tok1 = await h.preview(k1);
        const text = await h.flow(k1).innerText();
        check('Previewing an answer shows the approval code, who must approve it, the 30-minute limit and a waiting state, and writes nothing', /^tok-info-request-ir-11-[0-9a-f]{32}$/.test(tok1) && await h.state(k1) === 'waiting' && text.includes('Approval needed from') && text.includes('You (Jordan Hale)') && text.includes('30 minutes') && text.includes('Waiting for your approval') && (await t.data()).approvals.length === 0);
        check('The approval panel says that this local preview sends no code and points to the GUI README, and what to do after a reload', (await h.text('[data-flow="' + k1 + '"] [data-local-preview]')).includes('In this local preview no code is sent') && (await h.text('[data-flow="' + k1 + '"] [data-reload-help]')).includes('preview the same change again'));
        check('Focus moves into the opened preview', await h.focusIn('[data-flow="' + k1 + '"]'));
        await h.flow(k1).scrollIntoViewIfNeeded();
        await t.shot('approval-waiting-1280');
        const narrow = await t.overflow(390);
        await h.flow(k1).scrollIntoViewIfNeeded();
        await t.shot('approval-waiting-390');
        await page.setViewportSize({ width: 1280, height: 900 });
        check('The waiting approval panel fits 390 px with its full code', !narrow);
      } },
    { title: 'Confirm before the approval', action: 'Confirm', expected: 'A waiting state, not an error; nothing written', focus: '[data-note=waiting]',
      run: async () => {
        await h.confirm(k1);
        await $('[data-flow="' + k1 + '"] [data-note=waiting]').waitFor();
        await t.settled();
        check('Confirm before the approval exists is a waiting state, not an error: nothing is written and no success message appears', (await h.find('info_requests', 'info_request_id', 'ir-11')).status === 'open' && await $('[data-flash]').count() === 0 && await h.flow(k1).locator('[role=alert]').count() === 0);
        check('While a change waits for its approval the status line is neutral, never “All changes saved” or “Saved”', await h.status() === 'Up to date');
      } },
    { title: 'Approve one of two questions', action: 'Line 2: An accident, not at work → Preview; Infra approves only line 1 (dev/confirm.cjs); Refresh', expected: 'Line 1 approved, line 2 still waiting', focus: '[data-flow="info:ir-11"]',
      run: async () => {
        await h.form(k2).locator('[data-field=answer][data-value=accident]').check();
        tok2 = await h.preview(k2);
        t.confirm(tok1);
        check('Before Refresh the page still shows both answers waiting', await h.state(k1) === 'waiting' && await h.state(k2) === 'waiting');
        await h.refresh();
        check('After Infra applies user.confirmed for one of the two requests, Refresh shows the approval on that request only', await h.state(k1) === 'active' && await h.state(k2) === 'waiting' && (await h.flow(k1).innerText()).includes('It can be used until') && await h.flow(k1).locator('[data-note=waiting]').count() === 0);
      } },
    { title: 'A form change during Confirm’s check sends nothing', action: 'Line 2: Confirm; while it re-checks, choose another answer', expected: 'No confirm call; the request stays open', focus: '[data-form="info:ir-12"]',
      run: async () => {
        const stalled = await h.stall(p => p.name === L('claims.info.preview') && p.arguments.line_id === 'ln-2');
        await h.confirm(k2);
        await h.until(() => stalled.seen());
        await h.form(k2).locator('[data-field=answer][data-value=not_accident]').check();
        stalled.open();
        await h.alert('details_changed', h.form(k2));
        await t.release();
        check('A selection change while Confirm re-previews cancels the send: no confirm call goes out and the request stays open', h.sent('claims.info.confirm') === 1 && await h.flow(k2).count() === 0 && (await h.find('info_requests', 'info_request_id', 'ir-12')).status === 'open');
        check('While a refusal is shown the status line never says “All changes saved”', await h.status() === NOTHING_CHANGED);
      } },
    { title: 'Confirm the approved answer', action: 'Line 1: Confirm', expected: 'ir-11 answered; ir-12 open; the claim keeps waiting', focus: '[data-request=ir-11]',
      run: async () => {
        await h.confirm(k1);
        await h.flash('Answer recorded for line 1');
        const ir11 = await h.find('info_requests', 'info_request_id', 'ir-11');
        check('After a commit the status line says “Saved”', await h.status() === 'Saved');
        check('Confirm with the approval answers that request in Larkfield; the other stays open and the claim keeps waiting', ir11.status === 'answered' && ir11.answer === 'not_accident' && (await h.find('info_requests', 'info_request_id', 'ir-12')).status === 'open' && (await h.find('claims', 'claim_id', 'cl-13')).status === 'pending_info');
      } },
    { title: 'An expired approval', action: 'Line 2: An accident → Preview (same code); Infra approves; the clock moves 31 minutes; Refresh; Confirm', expected: 'Expired; confirmation_invalid in plain words; no success message', focus: '[data-flow="info:ir-12"]',
      run: async () => {
        await h.form(k2).locator('[data-field=answer][data-value=accident]').check();
        const again = await h.preview(k2);
        check('Choosing the original answer again reproduces the same approval code', again === tok2);
        await h.approve(tok2);
        await t.advance(new Date(Date.parse(await h.now()) + 31 * 60000).toISOString().replace('.000Z', 'Z'));
        await h.refresh();
        check('After the clock passes the 30 minutes, Refresh shows the approval as expired', await h.state(k2) === 'expired');
        await h.confirm(k2);
        await h.alert('confirmation_invalid', h.flow(k2));
        check('Confirm with an expired approval shows confirmation_invalid in plain words and no success message, and writes nothing', await $('[data-flash]').count() === 0 && (await h.text('[data-flow="' + k2 + '"] [role=alert][data-code=confirmation_invalid]')).startsWith('The approval for this preview has expired') && (await h.find('info_requests', 'info_request_id', 'ir-12')).status === 'open');
      } },
    { title: 'A lost reply retried', action: 'Infra approves again; Refresh; Confirm with the reply dropped after the commit; Refresh; Retry', expected: '“Waiting for Larkfield”, then the stored receipt; the claim is processed', focus: '[data-claim=cl-13]',
      run: async () => {
        await h.approve(tok2);
        await h.refresh();
        const lost = await t.dropAfterCommit(p => p.name === L('claims.info.confirm'));
        await h.confirm(k2);
        await h.alert('connection_lost');
        await t.release();
        check('A confirm whose reply is lost after the commit shows “Waiting for Larkfield” with Retry, not success', lost.forwarded?.status === 'committed' && await $('[data-flash]').count() === 0 && await $('[data-action=retry-unknown]').count() === 1);
        await h.refresh();
        check('A manual Refresh with Retry outstanding does not report “All changes saved”', await h.status() === CANNOT_CONFIRM);
        await $('[data-action=retry-unknown]').click();
        await h.flash('had already gone through');
        const cl13 = await h.find('claims', 'claim_id', 'cl-13');
        check('Retry sends the exact request again and reports the stored receipt; the last answer completes the claim, which gets its first explanation of benefits', cl13.status === 'processed' && (await t.data()).eobs.filter(e => e.claim_id === 'cl-13').length === 1 && (await h.find('info_requests', 'info_request_id', 'ir-12')).answer === 'accident' && await $('[data-action=retry-unknown]').count() === 0);
        const view = (await t.agent('claims.get', { claim_id: 'cl-13' })).claim;
        check('The claim page shows the explanation of benefits version 1 with the member cost Larkfield computed', await $('[data-claim=cl-13][data-status=processed] [data-eob-version="1"] [data-member-cost="' + view.eobs[0].totals.member_cost_cents + '"]').count() === 1);
      } }
  ] };

  const w1 = { id: 'w1-grants', title: 'W1 Household access', summary: 'Jordan gives, changes and removes access to Riley’s records; every change needs Jordan’s approval from Infra.', steps: [
    { title: 'An unknown member ID is named as such', action: 'Household → Give access → Someone else → m-99 → Preview access change', expected: '“No member with that ID”; nothing previewed', focus: '[role=alert][data-code=not_found]',
      run: async () => {
        await h.nav('Household');
        await h.form(kn).locator('[data-field=grantee]').selectOption('other');
        await h.form(kn).locator('[data-field=other]').fill('m-99');
        await $('[data-action=preview][data-key="' + kn + '"]').click();
        await h.alert('not_found', h.form(kn));
        check('A typed member ID Larkfield does not know is reported as unknown, and nothing is previewed', (await h.text('[data-form="' + kn + '"] [role=alert][data-code=not_found]')) === 'No member with that ID is known to Larkfield, so nothing was done. Check the ID.' && await h.flow(kn).count() === 0);
      } },
    { title: 'Preview access with an end date', action: 'Whose records: Riley; Person: the member shown by reference; View; ends Dec 31, 2026 11 PM → Preview; Cancel; Preview; choose Act', expected: 'The end in Eastern Time; Cancel returns focus; changing the scope removes the preview', focus: '[data-form="give"]',
      run: async () => {
        await h.form(kn).locator('[data-field=member_id]').selectOption('m-3');
        check('For Riley’s records the person list starts empty and does not offer Jordan, who already has access as a guardian', await h.form(kn).locator('[data-field=grantee]').inputValue() === '' && await h.form(kn).locator('[data-field=grantee] option[value=m-1]').count() === 0);
        await h.form(kn).locator('[data-field=grantee]').selectOption('m-2');
        await h.form(kn).locator('[data-field=ends]').check();
        check('The end time starts empty and says that empty means the end of the day', await h.form(kn).locator('[data-field=end-time]').inputValue() === '' && (await h.text('[data-form="give"]')).includes('Leave the time empty for the end of that day (11:59 PM)'));
        await h.form(kn).locator('[data-field=end-date]').fill('2026-12-31');
        await h.form(kn).locator('[data-field=end-time]').fill('23:00');
        const ga = await h.preview(kn);
        check('A grant preview names the records, a person whose records you cannot see by reference only, and the end in Eastern Time', /^tok-grant-pair-m-3-/.test(ga) && (await h.flow(kn).innerText()).includes('Riley Hale') && await h.flow(kn).locator('[data-ref=m-2]').count() === 1 && (await h.flow(kn).locator('[data-after]').innerText()).includes('Thu, Dec 31, 2026, 11:00 PM EST'));
        await $('[data-flow="' + kn + '"] [data-action=cancel-flow]').click();
        await t.idle();
        check('Cancel closes the preview and returns focus to Preview', await h.flow(kn).count() === 0 && await h.focusIn('[data-action=preview][data-key="' + kn + '"]'));
        await h.preview(kn);
        await h.form(kn).locator('[data-field=scope][data-value=act]').check();
        check('Changing the scope removes the preview and its Confirm at once', await h.flow(kn).count() === 0 && await $('[data-action=preview][data-key="' + kn + '"]').count() === 1);
      } },
    { title: 'An approval from someone else is refused', action: 'Preview (Act); dev/confirm.cjs --by m-2; Refresh; Confirm', expected: 'confirmation_invalid in plain words; no grant', focus: '[data-flow="give"]',
      run: async () => {
        const gb = await h.preview(kn);
        t.confirm(gb, 'm-2');
        await h.refresh();
        await h.confirm(kn);
        await h.alert('confirmation_invalid', h.flow(kn));
        check('An approval given by another person is refused, with no success message and no grant written', await $('[data-flash]').count() === 0 && !(await t.data()).grants.some(g => g.member_id === 'm-3' && g.grantee_id === 'm-2'));
      } },
    { title: 'The confirm helper refuses mistakes', action: '`dev/confirm.cjs` with a mistyped run, with --by and no value, and with an unknown option', expected: 'Each refused before anything is confirmed; no run created', focus: '[data-flow="give"]',
      run: async () => {
        const token = await h.token(kn);
        const before = fs.readdirSync(t.stateDir).sort();
        const mistyped = devConfirm(t.run + '-typo', token, '--state-dir', t.stateDir, '--registry', t.host.registry);
        const noValue = devConfirm(t.run, token, '--state-dir', t.stateDir, '--registry', t.host.registry, '--by');
        const unknown = devConfirm(t.run, token, '--state-dir', t.stateDir, '--registry', t.host.registry, '--as', 'm-1');
        const malformed = devConfirm(t.run, 'tok-7c1e', '--state-dir', t.stateDir, '--registry', t.host.registry);
        const subjectless = devConfirm(t.run, 'tok-cob-coverage-m-1-' + 'a'.repeat(32), '--state-dir', t.stateDir, '--registry', t.host.registry);
        const mismatched = devConfirm(t.run, 'tok-withdraw-claim-cl-13-' + 'a'.repeat(32), '--state-dir', t.stateDir, '--registry', t.host.registry);
        check('dev/confirm.cjs refuses malformed approval codes (too short, a coverage code without a plan year, an action that does not fit its subject) before opening Infra, recording nothing', [malformed, subjectless, mismatched].every(x => x.status !== 0 && /Not a Larkfield approval code/.test(x.stderr)) && !(await t.data()).approvals.some(a => a.token === 'tok-7c1e' || a.token.startsWith('tok-cob-coverage-m-1-') || a.token.startsWith('tok-withdraw-claim-')));
        check('dev/confirm.cjs refuses a run that does not exist without creating it, a --by without a value and an unknown option', mistyped.status !== 0 && /No Larkfield run/.test(mistyped.stderr) && noValue.status !== 0 && /needs a value/.test(noValue.stderr) && unknown.status !== 0 && /Unknown option/.test(unknown.stderr) && JSON.stringify(fs.readdirSync(t.stateDir).sort()) === JSON.stringify(before) && !(await t.data()).approvals.some(a => a.token === token && a.confirmed_by === 'm-1'));
      } },
    { title: 'Give access', action: 'Infra approves as Jordan; Refresh; Confirm', expected: 'Grant gr-3 with the previewed scope and end', focus: '[data-grant-id=gr-3]',
      run: async () => {
        await h.approve(await h.token(kn));
        await h.refresh();
        await h.confirm(kn);
        await h.flash('can now view and act on Riley Hale');
        gr3 = await h.find('grants', 'grant_id', 'gr-3');
        check('Giving access commits grant gr-3 with the previewed scope and end', !!gr3 && gr3.member_id === 'm-3' && gr3.grantee_id === 'm-2' && gr3.scope === 'act' && gr3.expires_at === '2026-12-31T23:00:00-05:00' && gr3.status === 'active');
      } },
    { title: 'A change form closes when the grant changes meanwhile', action: 'Change on gr-3 (focus moves in); Close (focus returns); Change; choose View; Infra changes gr-3’s end; Refresh', expected: 'The form closes with a note; nothing sent', focus: '[data-notice]',
      run: async () => {
        await $('[data-action=change-grant][data-grant=gr-3]').click();
        await h.form('grant:gr-3').waitFor();
        check('Opening Change moves focus into its form', await h.focusIn('[data-form="grant:gr-3"]'));
        await $('[data-action=close-change]').click();
        await t.idle();
        check('Close returns focus to Change', await h.focusIn('[data-action=change-grant][data-grant=gr-3]'));
        await $('[data-action=change-grant][data-grant=gr-3]').click();
        await h.form('grant:gr-3').locator('[data-field=scope][data-value=view]').check();
        await t.event('grant.changed', { grant_id: 'gr-3', member_id: 'm-3', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'act', expires_at: '2026-12-30T23:00:45-05:00', status: 'active' });
        await h.refresh();
        check('A change form opened on an older version of the grant closes after Refresh and says why', await h.form('grant:gr-3').count() === 0 && (await h.text('[data-notice]')).includes('changed meanwhile') && (await h.find('grants', 'grant_id', 'gr-3')).grant_version === gr3.grant_version + 1);
        gr3 = await h.find('grants', 'grant_id', 'gr-3');
      } },
    { title: 'Change only the scope', action: 'Change on gr-3 → View (the end left as it is) → Preview → Infra approves → Refresh → Confirm', expected: 'gr-3 updated in place with its end exactly as stored, seconds included', focus: '[data-grant-id=gr-3]',
      run: async () => {
        await $('[data-action=change-grant][data-grant=gr-3]').click();
        await h.form('grant:gr-3').locator('[data-field=scope][data-value=view]').check();
        const gc = await h.preview('grant:gr-3');
        const after = JSON.parse(await h.flow('grant:gr-3').locator('[data-after]').getAttribute('data-after'));
        check('A scope-only change keeps the stored end to the second (23:00:45), as the preview shows', /^tok-grant-grant-gr-3-/.test(gc) && after.scope === 'view' && after.expires_at === '2026-12-30T23:00:45-05:00' && (await h.text('[data-flow="grant:gr-3"] [data-before]')).includes('view and act on until'));
        await h.approve(gc);
        await h.refresh();
        await h.confirm('grant:gr-3');
        await h.flash('can now view Riley Hale');
        const changed = await h.find('grants', 'grant_id', 'gr-3');
        check('Confirm updates gr-3 in place (same ID, next version) with the same end', changed.scope === 'view' && changed.expires_at === '2026-12-30T23:00:45-05:00' && changed.grant_version === gr3.grant_version + 1 && changed.status === 'active');
      } },
    { title: 'A change whose end has already passed', action: 'Change on gr-3 → end date Jan 1, 2026 → Preview', expected: 'Refused in words saying the end must be later than Larkfield’s current time; nothing previewed or changed', focus: '[data-form="grant:gr-3"] [role=alert][data-code=invalid_state]',
      run: async () => {
        const before = await h.find('grants', 'grant_id', 'gr-3');
        await $('[data-action=change-grant][data-grant=gr-3]').click();
        await h.form('grant:gr-3').locator('[data-field=end-date]').fill('2026-01-01');
        await $('[data-action=preview][data-key="grant:gr-3"]').click();
        await h.alert('invalid_state', h.form('grant:gr-3'));
        const said = await h.text('[data-form="grant:gr-3"] [role=alert][data-code=invalid_state]');
        const after = await h.find('grants', 'grant_id', 'gr-3');
        check('An access change whose end has already passed is refused in words saying the end must be later than Larkfield’s current time, with nothing previewed or changed', said.includes('later than Larkfield’s current time') && !said.includes('current state') && await h.flow('grant:gr-3').count() === 0 && after.grant_version === before.grant_version && after.expires_at === before.expires_at);
      } },
    { title: 'A change that changes nothing', action: 'Close; Change on gr-3; Preview with nothing changed', expected: 'Refused in words saying this access is already in force with the same end; nothing previewed', focus: '[data-form="grant:gr-3"] [role=alert][data-code=invalid_state]',
      run: async () => {
        await $('[data-action=close-change]').click();
        await t.idle();
        await $('[data-action=change-grant][data-grant=gr-3]').click();
        await h.form('grant:gr-3').waitFor();
        await $('[data-action=preview][data-key="grant:gr-3"]').click();
        await h.alert('invalid_state', h.form('grant:gr-3'));
        const said = await h.text('[data-form="grant:gr-3"] [role=alert][data-code=invalid_state]');
        check('An access change that keeps the same access and end is refused in words saying this access is already in force with that end, with nothing previewed', said.includes('already has exactly this access with the same end') && !said.includes('current state') && await h.flow('grant:gr-3').count() === 0);
      } },
    { title: 'Change only the end time', action: 'Close; Change on gr-3; end time 6:30 PM, the date left as filled in → Preview → Infra approves → Refresh → Confirm', expected: 'The form starts with gr-3’s end date and time in Eastern Time; gr-3 then ends Dec 30, 2026 6:30 PM EST, exactly as entered', focus: '[data-grant-id=gr-3]',
      run: async () => {
        await $('[data-action=close-change]').click();
        await t.idle();
        await $('[data-action=change-grant][data-grant=gr-3]').click();
        const form = h.form('grant:gr-3');
        await form.waitFor();
        check('The Change form starts with the grant’s end date and time in Eastern Time', await form.locator('[data-field=ends]').isChecked() && await form.locator('[data-field=end-date]').inputValue() === '2026-12-30' && await form.locator('[data-field=end-time]').inputValue() === '23:00');
        await form.locator('[data-field=end-time]').fill('18:30');
        const gt = await h.preview('grant:gr-3');
        const after = JSON.parse(await h.flow('grant:gr-3').locator('[data-after]').getAttribute('data-after'));
        const before = await h.find('grants', 'grant_id', 'gr-3');
        await h.approve(gt);
        await h.refresh();
        await h.confirm('grant:gr-3');
        await h.flash('can now view Riley Hale');
        const changed = await h.find('grants', 'grant_id', 'gr-3');
        check('Changing only the end time stores the end exactly as entered (Dec 30, 2026 6:30 PM Eastern Time), with the same scope', after.expires_at === '2026-12-30T18:30:00-05:00' && changed.expires_at === '2026-12-30T18:30:00-05:00' && changed.scope === 'view' && changed.grant_version === before.grant_version + 1 && changed.status === 'active');
      } },
    { title: 'Remove access', action: 'Remove access… → Infra approves → Refresh → Confirm', expected: 'gr-3 revoked', focus: '[data-grant-id=gr-3]',
      run: async () => {
        await $('[data-action=revoke-grant][data-grant=gr-3]').click();
        await h.flow('revoke:gr-3').waitFor();
        await t.settled();
        await h.approve(await h.token('revoke:gr-3'));
        await h.refresh();
        await h.confirm('revoke:gr-3');
        await h.flash('no longer has access');
        check('Removing access revokes gr-3 in Larkfield', (await h.find('grants', 'grant_id', 'gr-3')).status === 'revoked' && (await h.text('[data-grant-id=gr-3]')).includes('revoked'));
      } },
    { title: 'A used approval', action: 'Give access to Riley’s records again → Preview → Infra approves → the same change is confirmed outside the page → Refresh', expected: 'The preview says its approval was already used', focus: '[data-flow="give"]',
      run: async () => {
        await h.form(kn).locator('[data-field=member_id]').selectOption('m-3');
        await h.form(kn).locator('[data-field=grantee]').selectOption('m-2');
        const tu = await h.preview(kn);
        await h.approve(tu);
        const other = await t.agent('grants.change.confirm', { action: 'grant', member_id: 'm-3', grantee_id: 'm-2', scope: 'view', token: tu, expected_version: await t.version(), request_id: 'outside-grant' });
        await h.refresh();
        check('After the approval was used by a change made outside the page, the preview shows it as already used', other.status === 'committed' && await h.state(kn) === 'used' && (await h.text('[data-flow="' + kn + '"] [data-approval=used]')).startsWith('This approval was already used'));
      } },
    { title: 'Cancel the used preview', action: 'Cancel', expected: 'The preview closes', focus: '[data-form="give"]',
      run: async () => {
        await $('[data-flow="' + kn + '"] [data-action=cancel-flow]').click();
        await t.idle();
        check('Cancel closes it', await h.flow(kn).count() === 0);
        await t.shot('household');
      } }
  ] };

  const w3 = { id: 'w3-pa', title: 'W3 Prior authorization and expedite', summary: 'A PA for Riley arrives from Infra; Jordan asks for expedited review, the plan grants it and then denies the PA; Jordan files an expedited appeal.', steps: [
    { title: 'An Infra PA submission', action: 'Infra pa.submitted pa-w1; Refresh; open it', expected: 'Pending, with the decision due in Eastern Time', focus: '[data-pa=pa-w1]',
      run: async () => {
        await t.event('pa.submitted', { pa_id: 'pa-w1', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 6, valid_from: '2026-12-01', valid_until: '2027-01-31' });
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-w1');
        check('An Infra PA submission appears after Refresh as pending with its decision due date in Eastern Time', (await h.find('pas', 'pa_id', 'pa-w1')).status === 'pending' && (await h.text('[data-pa=pa-w1] [data-due]')).includes('Thu, Dec 3, 2026, 11:59 PM EST'));
      } },
    { title: 'Expedite, with the following refresh failing', action: 'Reason → Ask for expedited review; the refresh after it fails; Ask again; Refresh', expected: 'Recorded; further writes refused with no call until Refresh; then the committed request is shown, its text as text', focus: '[data-pa=pa-w1]',
      run: async () => {
        await h.form('expedite:pa-w1').locator('[data-field=reason]').fill('Riley ' + UNSAFE);
        await t.failNextDiscovery();
        await $('[data-action=expedite]').click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        const pw = await h.find('pas', 'pa_id', 'pa-w1');
        check('Asking for expedited review records it in Larkfield with the reason, and the page says the change was saved but could not be reloaded', pw.expedite?.status === 'open' && pw.expedite.reason === 'Riley ' + UNSAFE && (await h.status()).startsWith('Your change was saved') && await $('[data-stale]').count() === 1);
        const before = h.calls.length;
        await $('[data-action=expedite]').click();
        await h.alert('refresh_needed');
        check('Until a refresh succeeds, further writes are refused with no outgoing call', h.calls.length === before && (await h.find('pas', 'pa_id', 'pa-w1')).expedite.requested_at === pw.expedite.requested_at);
        await h.refresh();
        check('Refresh then shows the committed request, and its text is shown as text, never run', (await h.text('[data-pa=pa-w1]')).includes(UNSAFE) && await $('[data-action=expedite]').count() === 0 && !(await page.evaluate(() => window.injected)) && await $('#app img').count() === 0);
      } },
    { title: 'The plan grants the expedite, then denies the PA', action: 'Infra pa.expedite_decided approved; Refresh; Infra pa.decided denied; Refresh', expected: 'Due 72 hours after the request; then denied with an appeal form', focus: '[data-pa=pa-w1]',
      run: async () => {
        await t.event('pa.expedite_decided', { pa_id: 'pa-w1', decision: 'approved' });
        await h.refresh();
        const pw = await h.find('pas', 'pa_id', 'pa-w1');
        check('An approved expedite moves the decision due to 72 hours after the request, shown after Refresh', Date.parse(pw.due_at) === Date.parse(pw.expedite.requested_at) + 72 * 3600000 && (await h.text('[data-pa=pa-w1] [data-due]')).includes('Sat, Nov 21, 2026'));
        await t.event('pa.decided', { pa_id: 'pa-w1', decision: 'denied' });
        await h.refresh();
        check('The denied PA offers an appeal', await h.form('file:pa:pa-w1').count() === 1);
      } },
    { title: 'Expedited without the attestation', action: 'Statement A; Ask for an expedited appeal; Preview appeal', expected: 'expedite_not_allowed in plain words; no approval code', focus: '[data-form="file:pa:pa-w1"]',
      run: async () => {
        const kf = 'file:pa:pa-w1';
        await h.form(kf).locator('[data-field=statement]').fill('Statement A');
        await h.form(kf).locator('[data-field=expedited]').check();
        await $('[data-action=preview][data-key="' + kf + '"]').click();
        await h.alert('expedite_not_allowed', h.form(kf));
        check('An expedited PA appeal without the urgency attestation is refused at preview in plain words, with no approval code', await h.flow(kf).count() === 0 && (await h.text('[data-form="' + kf + '"] [role=alert][data-code=expedite_not_allowed]')).startsWith('An expedited appeal is possible only on a denied prior authorization'));
        check('The status line says nothing was changed rather than “All changes saved”', await h.status() === NOTHING_CHANGED);
      } },
    { title: 'Delayed previews released out of order', action: 'Attest; Preview (held); change the statement to B and back to A; Preview (held); release the first, then the second', expected: 'The first is discarded and enables no Confirm; the second shows the 72-hour rule', focus: '[data-flow="file:pa:pa-w1"]',
      run: async () => {
        const kf = 'file:pa:pa-w1';
        await h.form(kf).locator('[data-field=urgency_attested]').check();
        const held = await h.hold(p => p.name === L('appeals.file.preview'));
        await $('[data-action=preview][data-key="' + kf + '"]').click();
        await h.until(() => held.length === 1);
        await h.form(kf).locator('[data-field=statement]').fill('Statement B');
        await h.form(kf).locator('[data-field=statement]').fill('Statement A');
        await $('[data-action=preview][data-key="' + kf + '"]').click();
        await h.until(() => held.length === 2);
        await held[0].route.fulfill({ response: held[0].response });
        await page.waitForTimeout(300);
        check('A delayed preview released after the statement changed (A → B → A, the first A released before the second) is discarded and enables no Confirm', await h.flow(kf).count() === 0 && await $('[data-action=confirm]').count() === 0);
        await held[1].route.fulfill({ response: held[1].response });
        await h.flow(kf).waitFor();
        await t.settled();
        await t.release();
        check('The second preview shows the expedited 72-hour rule and the decision due if filed now', /^tok-file-pa-pa-w1-/.test(await h.token(kf)) && (await h.text('[data-flow="' + kf + '"]')).includes('72 hours after filing'));
      } },
    { title: 'File the expedited appeal', action: 'Infra approves; Refresh; Confirm', expected: 'One expedited appeal due 72 hours after filing; no ID inside a heading or message', focus: '[data-flash]',
      run: async () => {
        const kf = 'file:pa:pa-w1';
        await h.approve(await h.token(kf));
        await h.refresh();
        await h.confirm(kf);
        await h.flash('Appeal filed; decision due');
        const filed = (await t.data()).appeals.find(a => a.target.type === 'pa' && a.target.id === 'pa-w1');
        check('Confirm files one expedited appeal on the PA, due 72 hours after filing', !!filed && filed.expedited && Date.parse(filed.due_at) === Date.parse(filed.filed_at) + 72 * 3600000 && filed.statements[0].text === 'Statement A');
        const ids = await h.noIds();
        check('No ID appears inside a heading, title, message or notice' + (ids.length ? ' (' + JSON.stringify(ids.slice(0, 3)) + ')' : ''), ids.length === 0);
      } }
  ] };

  const w4 = { id: 'w4-appeals', title: 'W4 Appeals', summary: 'Statements on Riley’s appeal ap-3, its withdrawal and a refiling across a reload.', steps: [
    { title: 'A Host refusal is a plain error', action: 'Appeals → the Fernhollow appeal → Add statement; the Host answers 403 “Invalid request token”', expected: 'A plain session error, no “Waiting for Larkfield”, nothing stored', focus: '[data-form="statement:ap-3"]',
      run: async () => {
        await h.nav('Appeals');
        await h.pick('appeal', 'ap-3');
        const title = await h.text('[data-appeal=ap-3] h2');
        check('The appeal’s heading names its target in words, not by ID', !ID_TEXT.test(title) && title.startsWith('Appeal on the Fernhollow Physical Therapy claim'));
        const statements = (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length;
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('A statement the Host refuses.');
        await h.answer(p => p.name === L('appeals.add_statement'), 403, { error: 'Invalid request token' });
        await $('[data-action=add-statement]').click();
        await h.alert('session', h.form('statement:ap-3'));
        await t.release();
        check('A Host 403 for the session is a plain error with nothing pending: no Retry banner and no statement stored', await $('[data-action=retry-unknown]').count() === 0 && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements && await h.status() === NOTHING_CHANGED);
      } },
    { title: 'A Host timeout after the commit', action: 'Add statement; the Host answers 400 “MCP request timed out” after the commit; Retry', expected: 'The exact request is kept; Retry shows the stored receipt; one statement', focus: '[data-appeal=ap-3]',
      run: async () => {
        const statements = (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length;
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('The provider letter is attached to the portal message.');
        const timedOut = await h.timeoutAfterCommit(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('request_failed');
        await t.release();
        check('A statement that committed but got a Host error with no App status keeps its exact request in the banner', timedOut.forwarded?.status === 'committed' && await $('[data-action=retry-unknown]').count() === 1 && (await $('[aria-label="Waiting for Larkfield"]').innerText()).includes('MCP request timed out'));
        const [resent] = await Promise.all([page.waitForRequest(r => r.url().endsWith('/api/call') && r.postDataJSON().name === L('appeals.add_statement')), $('[data-action=retry-unknown]').click()]);
        await h.flash('had already gone through');
        check('Retry resends the same request ID and version and shows the stored receipt: one statement added', resent.postDataJSON().arguments.request_id === timedOut.request.arguments.request_id && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements + 1);
      } },
    { title: 'A lost reply is not guessed from the appeal', action: 'Add statement with the reply dropped after the commit; Refresh; Retry', expected: 'The form keeps the text and warns that it was probably stored and that sending again may add it twice; Retry proves it with the stored receipt', focus: '[data-form="statement:ap-3"]',
      run: async () => {
        const statements = (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length;
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('Sent once, reply lost.');
        const lost = await t.dropAfterCommit(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        await h.refresh();
        check('After a lost reply the page keeps the text, warns that it was probably stored and that sending again may add it twice, and claims nothing', lost.forwarded?.status === 'committed' && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements + 1 && await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === 'Sent once, reply lost.' && (await h.text('[data-uncertain=seen]')).includes('may add it twice') && !(await $('[data-notice]').allInnerTexts()).join(' ').includes('so it was added') && (await h.text('[data-form="statement:ap-3"] [data-action=add-statement]')) === 'Send it again anyway');
        await $('[data-action=retry-unknown]').click();
        await h.flash('had already gone through');
        check('Retry’s stored receipt is the proof: the form clears and the statement is stored once', await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === '' && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements + 1);
      } },
    { title: 'A lost send and an identical statement from elsewhere', action: 'Add statement with the request lost before it is sent; the same text is added outside the page; Refresh; then edit the draft to an existing statement’s text and Refresh', expected: 'The draft is never cleared on the evidence of the appeal alone; the warning stays', focus: '[data-form="statement:ap-3"]',
      run: async () => {
        const text = 'A statement also sent from elsewhere.';
        await h.form('statement:ap-3').locator('[data-field=statement]').fill(text);
        const lost = await t.dropBeforeSend(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        const other = await t.agent('appeals.add_statement', { appeal_id: 'ap-3', statement: text, expected_version: await t.version(), request_id: 'outside-statement' });
        await h.refresh();
        check('An identical statement added outside the page does not clear the draft of the lost send', lost.dropped && other.status === 'committed' && await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === text && await $('[data-uncertain]').count() === 1);
        const existing = (await h.find('appeals', 'appeal_id', 'ap-3')).statements[0].text;
        await h.form('statement:ap-3').locator('[data-field=statement]').fill(existing);
        await h.refresh();
        check('Editing the draft to an existing statement’s text does not clear it either, and nothing claims it was added', await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === existing && await $('[data-uncertain]').count() === 1 && !(await $('[data-notice]').allInnerTexts()).join(' ').includes('so it was added'));
      } },
    { title: 'A repeated statement whose send was lost', action: 'Dismiss “Waiting for Larkfield”; clear the statement; then type the text of a statement the appeal already has; Add statement with the request lost before it is sent; Refresh', expected: 'The page does not mistake the old statement for this one: the draft stays, with a warning', focus: '[data-form="statement:ap-3"]',
      run: async () => {
        await h.dismiss('dismiss-unknown');
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('');
        const before = (await h.find('appeals', 'appeal_id', 'ap-3')).statements;
        await h.form('statement:ap-3').locator('[data-field=statement]').fill(before[0].text);
        const lost = await t.dropBeforeSend(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        await h.refresh();
        check('A lost send whose text repeats an older statement keeps its draft and warns, because no new statement appeared', lost.dropped && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === before.length && await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === before[0].text && await $('[data-uncertain]').count() === 1 && !(await $('[data-notice]').allInnerTexts()).join(' ').includes('so it was added'));
        await $('[data-action=retry-unknown]').click();
        await h.flash('Statement added');
        check('Retry then stores it once, as a new statement, and clears the form', (await h.find('appeals', 'appeal_id', 'ap-3')).statements.filter(x => x.text === before[0].text).length === before.filter(x => x.text === before[0].text).length + 1 && await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === '');
      } },
    { title: 'A Retry that Larkfield did not apply', action: 'Add statement with the request lost before it is sent; an Infra event follows; Retry', expected: 'Retry reports it was not applied; the draft keeps its text and no longer says the outcome is unconfirmed', focus: '[data-form="statement:ap-3"]',
      run: async () => {
        const statements = (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length;
        const text = 'A statement whose send never arrived.';
        await h.form('statement:ap-3').locator('[data-field=statement]').fill(text);
        const lost = await t.dropBeforeSend(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        await t.event('pa.submitted', { pa_id: 'pa-x11', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2027-01-04', valid_until: '2027-01-31' });
        await $('[data-action=retry-unknown]').click();
        await h.alert('not_applied');
        check('After Retry settles as not applied, the draft keeps its text without the unconfirmed warning, and nothing was stored', lost.dropped && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements && await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === text && await $('[data-uncertain]').count() === 0 && (await h.text('[data-form="statement:ap-3"] [data-action=add-statement]')) === 'Add statement');
      } },
    { title: 'A lost reply with the following refresh failing', action: 'Dismiss the message; clear the statement; then Add statement with the reply dropped after the commit and the refresh after it failing; Refresh while Larkfield is still unreachable; Refresh; Retry', expected: 'The status says the outcome cannot be confirmed, never that nothing was changed; Retry finds the stored statement', focus: '#status',
      run: async () => {
        await h.dismiss('dismiss-error');
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('');
        const statements = (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length;
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('Sent while the page lost its connection.');
        const lost = await t.dropAfterCommit(p => p.name === L('appeals.add_statement'));
        await t.failNextDiscovery();
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        const first = await h.status();
        await t.failNextDiscovery();
        await h.refreshFailing();
        await t.release();
        const second = await h.status();
        const pending = 'The page could not reach Larkfield. Whether your last change took effect cannot be confirmed; see the message on the page.';
        check('With a write’s outcome unknown and Larkfield unreachable, the status says the outcome cannot be confirmed, also after a manual Refresh, never that nothing was changed', lost.forwarded?.status === 'committed' && first === pending && second === pending && await $('[data-action=retry-unknown]').count() === 1 && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements + 1);
        await h.refresh();
        await $('[data-action=retry-unknown]').click();
        await h.flash('had already gone through');
        check('Retry then reports the stored statement, which is in Larkfield once', (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements + 1);
      } },
    { title: 'Dismissing the banner while Larkfield is unreachable', action: 'Add statement with the reply dropped and the refresh after it failing; Dismiss the banner', expected: 'The status line no longer points to the dismissed banner', focus: '#status',
      run: async () => {
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('Sent before a dismissal.');
        await t.dropAfterCommit(p => p.name === L('appeals.add_statement'));
        await t.failNextDiscovery();
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        const pending = await h.status();
        await h.dismiss('dismiss-unknown');
        check('After Dismiss the status line says only that Larkfield could not be reached', pending.includes('cannot be confirmed') && await h.status() === 'The page could not reach Larkfield. Press Refresh to try again.');
      } },
    { title: 'A lost reply and a refresh refused by the Host', action: 'Refresh; clear the statement; then Add statement with the reply dropped after the commit; the Host answers the following tool list with 400 “MCP request timed out: tools/list”', expected: 'The status says the outcome cannot be confirmed, not the Host’s raw text', focus: '#status',
      run: async () => {
        await h.refresh();
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('');
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('Sent before the Host timed out.');
        await t.dropAfterCommit(p => p.name === L('appeals.add_statement'));
        let answered = false;
        await page.route('**/api/tools', async route => { if (!answered) { answered = true; await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'MCP request timed out: tools/list' }) }); } else await route.continue(); });
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        check('With the outcome unknown, a refresh refused by the Host shows that the outcome cannot be confirmed, not the raw error', await h.status() === CANNOT_CONFIRM && await $('[data-action=retry-unknown]').count() === 1);
        await h.refresh();
        await $('[data-action=retry-unknown]').click();
        await h.flash('had already gone through');
        check('Retry then reports the stored statement', await $('[data-action=retry-unknown]').count() === 0);
      } },
    { title: 'Withdraw the appeal', action: 'Withdraw appeal… → Infra approves → Refresh → Confirm', expected: 'ap-3 withdrawn', focus: '[data-appeal=ap-3]',
      run: async () => {
        await $('[data-action=preview][data-key="withdraw:ap-3"]').click();
        await h.flow('withdraw:ap-3').waitFor();
        await h.approve(await h.token('withdraw:ap-3'));
        await h.refresh();
        const confirms = h.sent('appeals.withdraw.confirm');
        await h.fail(p => p.name === L('appeals.withdraw.preview'));
        await h.confirm('withdraw:ap-3');
        await h.alert('read_failed', h.flow('withdraw:ap-3'));
        await t.release();
        check('When Confirm’s own check cannot reach Larkfield, nothing is sent and the status line says nothing was changed', h.sent('appeals.withdraw.confirm') === confirms && (await h.find('appeals', 'appeal_id', 'ap-3')).status === 'under_review' && await h.status() === NOTHING_CHANGED);
        await h.confirm('withdraw:ap-3');
        await h.flash('Appeal withdrawn');
        check('Withdrawing ap-3 commits it as withdrawn', (await h.find('appeals', 'appeal_id', 'ap-3')).status === 'withdrawn');
      } },
    { title: 'Refile across a reload', action: 'Claims → Fernhollow claim → statement one → Preview → Infra approves → reload; statement two → Preview; statement one → Preview → Confirm', expected: 'The untracked approval listed; a changed statement waits; the same statement reuses its approval and files', focus: '[data-claim=cl-14]',
      run: async () => {
        const kc = 'file:claim:cl-14';
        await h.nav('Claims');
        await h.pick('claim', 'cl-14');
        await h.form(kc).locator('[data-field=statement]').fill('Statement one');
        const t1 = await h.preview(kc);
        await h.approve(t1);
        await page.reload();
        await t.idle();
        await t.settled();
        await h.pick('claim', 'cl-14');
        check('After a reload the approval the page no longer tracks is listed on the claim', await $('[data-orphan="' + t1 + '"]').count() === 1);
        await h.form(kc).locator('[data-field=statement]').fill('Statement two');
        const t2 = await h.preview(kc);
        check('A changed statement gets a new code and waits again', t2 !== t1 && await h.state(kc) === 'waiting');
        await h.form(kc).locator('[data-field=statement]').fill('Statement one');
        const t3 = await h.preview(kc);
        check('Previewing the identical statement again returns the same code, shown as approved', t3 === t1 && await h.state(kc) === 'active');
        await h.confirm(kc);
        await h.flash('Appeal filed; decision due');
        const refiled = (await t.data()).appeals.filter(a => a.target.id === 'cl-14' && a.status === 'under_review');
        check('Confirm refiles an appeal on cl-14 after the withdrawal, with that statement and the claim’s denied line', refiled.length === 1 && refiled[0].statements[0].text === 'Statement one' && JSON.stringify(refiled[0].lines) === '["ln-2"]');
      } }
  ] };

  const w5 = { id: 'w5-visibility', title: 'Lost and reduced access', summary: 'Casey’s grants to Jordan come and go through Infra; the page removes what Jordan can no longer see or do, also when a refresh fails.', steps: [
    { title: 'Casey’s act grant shows her records and the family totals', action: 'Infra grant.changed gr-w1 (Casey → Jordan, act); Refresh', expected: 'Casey listed; family totals for every plan year', focus: '[data-family=true]',
      run: async () => {
        await grantCasey('gr-w1');
        await h.refresh();
        const plan26 = await t.agent('plan.get', { plan_year: 2026 });
        const families = await familyShown();
        await $('[data-plan-year="2026"]').click();
        check('With Casey’s act grant in force, Refresh shows her as a member and the family totals of every plan year, as Larkfield computes them', families.every(Boolean) && !!plan26.family && await $('[data-family-deductible="' + plan26.family.deductible_cents + '"]').count() === 1 && await $('[data-accumulator=m-2]').count() === 1);
      } },
    { title: 'Revoked while an approval waits', action: 'Infra denies pa-5; appeal preview on it → Infra approves → Refresh; Infra revokes gr-w1; Confirm', expected: 'not_authorized; nothing filed; Casey’s records, preview and Confirm leave the page', focus: '[data-notice]',
      run: async () => {
        await t.event('pa.decided', { pa_id: 'pa-5', decision: 'denied' });
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-5');
        const k5 = 'file:pa:pa-5';
        await h.form(k5).locator('[data-field=statement]').fill('Casey needs the arthroscopy before the new year.');
        await h.approve(await h.preview(k5));
        await h.refresh();
        check('An appeal on Casey’s denied pa-5 previewed under the act grant is approved and ready', await h.state(k5) === 'active');
        await revokeCasey('gr-w1');
        await h.confirm(k5);
        await $('[data-notice]').waitFor();
        await t.settled();
        check('Revoked while waiting: Confirm’s re-preview is refused (not_authorized), nothing is filed, and Casey’s records, the preview and its Confirm leave the page', !(await t.data()).appeals.some(a => a.target.id === 'pa-5') && await $('[data-pa-id=pa-5]').count() === 0 && await h.flow(k5).count() === 0 && await $('[role=alert][data-code=not_authorized]').count() === 1);
      } },
    { title: 'Revoked between the list and the detail read, with the next read failing', action: 'Dismiss the message; then Infra gr-w2; Refresh; open Casey’s claim; revoke just before its detail read and fail the plan read; Refresh', expected: 'Casey’s claim, member row and both family totals gone at once although the refresh failed', focus: '[data-family=hidden]',
      run: async () => {
        await h.dismiss('dismiss-error');
        await grantCasey('gr-w2');
        await h.nav('Claims');
        await h.refresh();
        await h.pick('claim', 'cl-4');
        await h.nav('Plan & costs');
        check('With Casey visible again, the family totals are back', await $('[data-family=true]').count() === 1);
        await h.nav('Claims');
        await h.before(p => p.name === L('claims.get') && p.arguments.claim_id === 'cl-4', () => revokeCasey('gr-w2'));
        await h.fail(p => p.name === L('plan.get'));
        await h.refreshFailing();
        await t.release();
        check('A refresh that cannot reach Larkfield says so in plain words, not “Failed to fetch”', await h.status() === 'The page could not reach Larkfield. Press Refresh to try again.');
        check('Casey’s claim and her member row leave the page at once', await $('[data-claim-id=cl-4]').count() === 0 && await $('[data-claim=cl-4]').count() === 0 && await $('[data-field=member-filter] option[value=m-2]').count() === 0);
        const hidden = await familyShown();
        check('Both family totals are gone for every plan year although the refresh failed', hidden.every(x => !x) && await $('[data-family=hidden]').count() === 1 && await $('[data-accumulator=m-2]').count() === 0);
        await h.refresh();
        check('The next successful refresh still shows no record of Casey', await $('[data-accumulator=m-2]').count() === 0 && await h.status() === 'Up to date');
      } },
    { title: 'Revoked between two reads of one refresh', action: 'Infra gr-w3; Refresh; open Casey’s claim; revoke between the member and grant reads; Refresh', expected: 'The mixed reads are discarded and reread; nothing of Casey', focus: '[data-list=claims]',
      run: async () => {
        await grantCasey('gr-w3');
        await h.refresh();
        await h.nav('Claims');
        await h.pick('claim', 'cl-4');
        await h.before(p => p.name === L('grants.list'), () => revokeCasey('gr-w3'));
        const mark = h.calls.length;
        await h.refresh();
        await t.release();
        check('A grant revoked between two reads of one refresh: the page discards the mixed reads, rereads, and shows nothing of Casey', h.calls.slice(mark).filter(c => c.name === L('members.list')).length === 3 && await $('[data-claim-id=cl-4]').count() === 0 && await $('[data-claim=cl-4]').count() === 0 && await h.status() === 'Up to date');
      } },
    { title: 'Revoked during the plan reads, with the next one failing', action: 'Infra gr-w5; Refresh; Plan & costs; Infra revokes it just before the first plan read, and the second plan read fails; Household', expected: 'Casey’s amounts and the family totals disappear at once, and the Household roster no longer lists her', focus: '[data-list=members]',
      run: async () => {
        await grantCasey('gr-w5');
        await h.nav('Plan & costs');
        await h.refresh();
        check('With Casey’s grant the plan page shows her amounts and the family totals', await $('[data-accumulator=m-2]').count() === 1 && await $('[data-family=true]').count() === 1);
        let plans = 0;
        await h.before(p => p.name === L('plan.get'), () => revokeCasey('gr-w5'));
        await h.fail(p => p.name === L('plan.get') && ++plans === 2);
        await h.refreshFailing();
        await t.release();
        const hidden = await familyShown();
        check('A plan read that shows the loss hides Casey’s amounts and every family total at once, although the next read failed', hidden.every(x => !x) && await $('[data-accumulator=m-2]').count() === 0);
        await h.nav('Household');
        check('… and the Household roster no longer lists her', await $('[data-member-row=m-2]').count() === 0 && await $('[data-member-row=m-1]').count() === 1);
      } },
    { title: 'Revoked with the shell’s roster read succeeding and the page’s own failing', action: 'Refresh; dismiss the notice; then Infra gr-w8; Refresh; Infra revokes it; Refresh with the page’s own member read failing after the shell’s succeeded', expected: 'Casey’s claims, plan rows and family totals leave the page at once', focus: '[data-list=claims]',
      run: async () => {
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w8');
        await h.nav('Claims');
        await h.refresh();
        check('With Casey’s grant her claims are listed', await $('[data-claim-id=cl-4]').count() === 1);
        await revokeCasey('gr-w8');
        let rosters = 0;
        await h.fail(p => p.name === L('members.list') && ++rosters === 2);
        await h.refreshFailing();
        await t.release();
        const families = await familyShown();
        check('The shell’s own member read is enough: Casey’s claims, plan rows and every family total are gone although the page’s read failed', families.every(x => !x) && await $('[data-accumulator=m-2]').count() === 0 && (await h.nav('Claims'), await $('[data-claim-id=cl-4]').count() === 0));
      } },
    { title: 'Reduced to view between the roster and the PA list read, with the plan read failing', action: 'Refresh; dismiss the notice; then Infra gr-w9 (act); appeal preview on pa-5 → Infra approves → Refresh; Refresh with gr-w9 reduced to view just before the PA list read and the plan read failing', expected: 'The approval, the preview and its Confirm leave the page at once', focus: '[data-pa=pa-5]',
      run: async () => {
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w9');
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-5');
        const k5 = 'file:pa:pa-5';
        await h.form(k5).locator('[data-field=statement]').fill('Casey asks once more.');
        const token = await h.preview(k5);
        await h.approve(token);
        await h.refresh();
        check('The appeal preview is approved before the change', await h.state(k5) === 'active');
        await h.before(p => p.name === L('pa.list'), () => grantCasey('gr-w9', 'view'));
        await h.fail(p => p.name === L('plan.get'));
        await h.refreshFailing();
        await t.release();
        check('A PA list read that no longer carries the approval removes it, the preview and Confirm at once although the plan read failed', await h.flow(k5).count() === 0 && await $('[data-action=confirm]').count() === 0 && await $('[data-token]').count() === 0 && !(await $('#app').innerText()).includes(token));
      } },
    { title: 'Revoked between the roster and the claims read with her claim open', action: 'Infra revokes gr-w9; Refresh; dismiss the notice; then Infra gr-w10; Refresh; open Casey’s claim; Refresh with a revocation just before the claims read', expected: 'No notice keeps a reference to her claim or her name', focus: '[data-list=claims]',
      run: async () => {
        await revokeCasey('gr-w9');
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w10');
        await h.nav('Claims');
        await h.refresh();
        await h.pick('claim', 'cl-4');
        await h.dismiss('dismiss-notice');
        await h.before(p => p.name === L('claims.list'), () => revokeCasey('gr-w10'));
        await h.refresh();
        await t.release();
        const notes = (await $('[data-notice]').allInnerTexts()).join(' ');
        check('After the refresh no notice refers to Casey’s claim or names her', !notes.includes('cl-4') && !/Casey/.test(notes) && await $('[data-ref=cl-4]').count() === 0 && await $('[data-claim-id=cl-4]').count() === 0);
      } },
    { title: 'An older roster answer released after a newer refresh', action: 'Dismiss the notice; then Plan & costs; hold the member read of a refresh started by the search box; Infra grants gr-w11 (act); clear the search box (a second refresh completes); release the held answer', expected: 'The older answer changes nothing: Casey and the family totals stay', focus: '[data-family=true]',
      run: async () => {
        await h.dismiss('dismiss-notice');
        await h.nav('Plan & costs');
        await h.refresh();
        let held = null;
        await page.route('**/api/call', async route => { const p = route.request().postDataJSON(); if (!held && p.name === L('members.list')) held = { route, response: await route.fetch() }; else await route.fallback(); });
        await page.locator('.toolbar input[type=search]').fill('x');
        await h.until(() => !!held);
        await grantCasey('gr-w11');
        await page.locator('.toolbar input[type=search]').fill('');
        await $('[data-accumulator=m-2]').waitFor();
        await t.settled();
        await held.route.fulfill({ response: held.response });
        await page.waitForTimeout(400);
        await t.settled();
        await t.release();
        check('A member list answered before the grant and released after a newer refresh does not remove Casey or the family totals', await $('[data-accumulator=m-2]').count() === 1 && await $('[data-family=true]').count() === 1);
      } },
    { title: 'An older PA list answer released after a newer refresh', action: 'Casey’s pa-5 → appeal preview; hold the PA list read of a refresh started by the search box; Infra approves; clear the search box (a second refresh completes); release the held answer', expected: 'The older answer does not strip the approval or Casey’s act right', focus: '[data-pa=pa-5]',
      run: async () => {
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-5');
        const k5 = 'file:pa:pa-5';
        await h.form(k5).locator('[data-field=statement]').fill('Casey, with an older list in flight.');
        const token = await h.preview(k5);
        let held = null;
        await page.route('**/api/call', async route => { const p = route.request().postDataJSON(); if (!held && p.name === L('pa.list')) held = { route, response: await route.fetch() }; else await route.fallback(); });
        await page.locator('.toolbar input[type=search]').fill('y');
        await h.until(() => !!held);
        await h.approve(token);
        await page.locator('.toolbar input[type=search]').fill('');
        await page.locator('[data-flow="' + k5 + '"][data-state=active]').waitFor();
        await t.settled();
        await held.route.fulfill({ response: held.response });
        await page.waitForTimeout(400);
        await t.settled();
        await t.release();
        check('A PA list answered before the approval and released after a newer refresh leaves the approval, its Confirm and Casey’s act right in place', await h.state(k5) === 'active' && await h.flow(k5).locator('[data-action=confirm]').count() === 1);
      } },
    { title: 'Reduced to view access while a form is open, with the refresh failing', action: 'Cancel the preview; Infra revokes gr-w11; Refresh; dismiss the notice; then Infra gr-w4 (act); Refresh; Casey’s pa-5 → statement → Preview; Infra changes gr-w4 to view; Refresh with the plan read failing', expected: 'The appeal form and its preview close at once; Casey’s records stay readable', focus: '[data-pa=pa-5]',
      run: async () => {
        await $('[data-flow="file:pa:pa-5"] [data-action=cancel-flow]').click();
        await t.idle();
        await revokeCasey('gr-w11');
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w4');
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-5');
        const k5 = 'file:pa:pa-5';
        await h.form(k5).locator('[data-field=statement]').fill('Casey asks again.');
        const token = await h.preview(k5);
        await h.approve(token);
        await h.refresh();
        check('The appeal preview on Casey’s PA is approved', await h.state(k5) === 'active');
        await grantCasey('gr-w4', 'view');
        await h.fail(p => p.name === L('plan.get'));
        await h.refreshFailing();
        await t.release();
        check('After the downgrade no cached approval of that preview is shown anywhere, untracked or not', await $('[data-orphans]').count() === 0 && await $('[data-token]').count() === 0 && !(await $('#app').innerText()).includes(token));
        check('When the member list shows act access reduced to view, the appeal form, its preview and Confirm close at once although the refresh failed', await h.form(k5).count() === 0 && await h.flow(k5).count() === 0 && await $('[data-pa=pa-5]').count() === 1 && (await h.text('[data-notice]')).includes('Casey Hale’s records changed'));
      } },
    { title: 'An unanswered request about records later hidden', action: 'Refresh; then Infra sets gr-w4 back to act and submits pa-w3 for Casey; Ask for expedited review with the reply dropped; Infra revokes gr-w4; Refresh', expected: 'The banner no longer names Casey or the service and offers no Retry', focus: '[data-unknown=hidden]',
      run: async () => {
        await h.refresh();
        await grantCasey('gr-w4', 'act');
        await t.event('pa.submitted', { pa_id: 'pa-w3', member_id: 'm-2', provider_id: 'pv-2', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-12-10', valid_until: '2027-01-31' });
        await h.refresh();
        await h.pick('pa', 'pa-w3');
        const lost = await t.dropAfterCommit(p => p.name === L('pa.request_expedite'));
        await $('[data-action=expedite]').click();
        await h.alert('connection_lost');
        await t.release();
        const named = await $('[aria-label="Waiting for Larkfield"]').innerText();
        check('The unanswered request is described while Casey’s records are visible', lost.forwarded?.status === 'committed' && named.includes('Knee arthroscopy') && await $('[data-action=retry-unknown]').count() === 1);
        await revokeCasey('gr-w4');
        await h.refresh();
        const banner = await $('[aria-label="Waiting for Larkfield"]').innerText();
        check('Notices about Casey are removed when access ends; none names her', !(await $('[data-notice]').allInnerTexts()).join(' ').includes('Casey'));
        check('After the revocation the banner names neither Casey nor the service, and offers no Retry', await $('[data-unknown=hidden]').count() === 1 && !/Casey|arthroscopy|pa-w3/i.test(banner) && await $('[data-action=retry-unknown]').count() === 0 && await h.status() === CANNOT_CONFIRM);
      } },
    { title: 'A refused Retry about records later hidden', action: 'Dismiss “Waiting for Larkfield”; dismiss the notice; then Infra gives gr-w6 (act) and submits pa-x1 for Casey; Ask for expedited review with the request lost before it is sent; Infra revokes gr-w6; Retry with no Refresh before it and the refresh after it failing; then Refresh', expected: 'The answer to the Retry never names Casey’s record, even before any refresh succeeds', focus: '[role=alert][data-code=not_applied]',
      run: async () => {
        await h.dismiss('dismiss-unknown');
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w6');
        await t.event('pa.submitted', { pa_id: 'pa-x1', member_id: 'm-2', provider_id: 'pv-2', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-12-10', valid_until: '2027-01-31' });
        await h.refresh();
        await h.pick('pa', 'pa-x1');
        const lost = await t.dropBeforeSend(p => p.name === L('pa.request_expedite'));
        await $('[data-action=expedite]').click();
        await h.alert('connection_lost');
        await t.release();
        await revokeCasey('gr-w6');
        await t.failNextDiscovery();
        await $('[data-action=retry-unknown]').click();
        await h.alert('not_applied');
        await t.release();
        const first = await h.text('[role=alert][data-code=not_applied]');
        await h.refresh();
        const later = (await $('[role=alert][data-code=not_applied]').allInnerTexts()).join(' ');
        check('The refused Retry’s answer names neither Casey nor her service once her records are gone, also after a further Refresh', lost.dropped && !/Casey|arthroscopy/i.test(first) && !/Casey|arthroscopy/i.test(later) && await $('[data-pa-id=pa-x1]').count() === 0 && !(await h.find('pas', 'pa_id', 'pa-x1')).expedite);
      } },
    { title: 'A committed Retry about records later hidden', action: 'Dismiss the message; dismiss the notice; then Infra gives gr-w7 (act) and submits pa-x2 for Casey; Ask for expedited review with the reply dropped after the commit; Infra revokes gr-w7; Retry with the refresh after it failing', expected: 'The page says an earlier request was confirmed without naming the record', focus: '[data-flash]',
      run: async () => {
        await h.dismiss('dismiss-error');
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w7');
        await t.event('pa.submitted', { pa_id: 'pa-x2', member_id: 'm-2', provider_id: 'pv-2', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-12-12', valid_until: '2027-01-31' });
        await h.refresh();
        await h.pick('pa', 'pa-x2');
        const lost = await t.dropAfterCommit(p => p.name === L('pa.request_expedite'));
        await $('[data-action=expedite]').click();
        await h.alert('connection_lost');
        await t.release();
        await revokeCasey('gr-w7');
        await t.failNextDiscovery();
        await $('[data-action=retry-unknown]').click();
        await $('[data-flash]').waitFor();
        await t.settled();
        await t.release();
        const flash = await h.text('[data-flash]');
        check('The stored receipt of a Retry about records now hidden is reported without naming them, even though the refresh after it failed', lost.forwarded?.status === 'committed' && flash.startsWith('Larkfield confirmed an earlier request about records this account can no longer see') && !/Casey|arthroscopy/i.test(flash) && (await h.find('pas', 'pa_id', 'pa-x2')).expedite?.status === 'open');
      } },
    { title: 'New data that keeps Casey’s act right', action: 'Refresh; dismiss the notice; then Infra gr-w13 (act); appeal preview on pa-5 → Infra approves → Refresh; pa-x7 for Casey, Ask for expedited review with the reply dropped; Infra loads new data identical to the current records (without approvals); Refresh with one plan read failing; Refresh', expected: 'Casey keeps her act right; no access-changed notice; the unanswered request is reported in its reset form', focus: '[data-unknown=reset]',
      run: async () => {
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w13');
        await t.event('pa.submitted', { pa_id: 'pa-x7', member_id: 'm-2', provider_id: 'pv-2', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-12-14', valid_until: '2027-01-31' });
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-5');
        await h.form('file:pa:pa-5').locator('[data-field=statement]').fill('Casey, before new data.');
        await h.approve(await h.preview('file:pa:pa-5'));
        await h.refresh();
        await h.pick('pa', 'pa-x7');
        const lost = await t.dropAfterCommit(p => p.name === L('pa.request_expedite'));
        await $('[data-action=expedite]').click();
        await h.alert('connection_lost');
        await t.release();
        const snap = await t.snapshot();
        const data = { ...snap.data, seed_id: snap.data.seed_id + '-same', approvals: [] };
        await t.loadSeed({ data, virtual_now: snap.virtual_now, request_id: 'web-seed-same' });
        await h.dismiss('dismiss-notice');
        await h.fail(p => p.name === L('plan.get'));
        await h.refreshFailing();
        await t.release();
        await h.pick('pa', 'pa-5');
        const afterFailed = { form: await h.form('file:pa:pa-5').count(), notice: (await $('[data-notice]').allInnerTexts()).join(' '), banner: await $('[data-unknown]').getAttribute('data-unknown') };
        await h.refresh();
        await h.pick('pa', 'pa-5');
        check('After new data that keeps her act grant, a refresh with a failing read, then a successful one, still let Jordan act on Casey’s records, with no access-changed notice and the unanswered request shown in its reset form', lost.forwarded?.status === 'committed' && afterFailed.form === 1 && !/access to/i.test(afterFailed.notice) && afterFailed.banner === 'reset' && await h.form('file:pa:pa-5').count() === 1 && await $('[data-unknown=reset]').count() === 1 && !/access to/i.test((await $('[data-notice]').allInnerTexts()).join(' ')));
      } },
    { title: 'New data that ends access, with a read failing', action: 'Dismiss “Waiting for Larkfield”; Infra revokes gr-w13; Refresh; dismiss the notice; then Infra gr-w14 (act); Refresh; open pa-5; Infra loads the fixture, where Casey is not visible; Refresh with the PA list read failing', expected: 'Casey’s records leave the page at once, although the refresh failed', focus: '[data-list=pas]',
      run: async () => {
        await h.dismiss('dismiss-unknown');
        await revokeCasey('gr-w13');
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w14');
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-5');
        await seed(FIXTURE);
        await h.fail(p => p.name === L('pa.list'));
        await h.refreshFailing();
        await t.release();
        const text = await $('#app').innerText();
        check('After new data without Casey’s grant, a refresh whose PA list read failed already removed her PA row, its detail, her filter entry and every mention of her', await $('[data-pa-id=pa-5]').count() === 0 && await $('[data-pa=pa-5]').count() === 0 && await $('[data-field=member-filter] option[value=m-2]').count() === 0 && !/Casey|arthroscopy/i.test(text));
      } },
    { title: 'New data that ends access, with only the shell’s member read succeeding', action: 'Refresh; dismiss the notice; then Infra gr-w15 (act); Refresh; open pa-5; Infra loads the fixture again; Refresh with the page’s own member read failing', expected: 'The shell’s member read alone removes Casey’s records', focus: '[data-list=pas]',
      run: async () => {
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w15');
        await h.refresh();
        await h.pick('pa', 'pa-5');
        await seed(FIXTURE);
        let rosters = 0;
        await h.fail(p => p.name === L('members.list') && ++rosters === 2);
        await h.refreshFailing();
        await t.release();
        const text = await $('#app').innerText();
        check('With only the shell’s member read of the new data succeeding, Casey’s PA row, detail, filter entry and every mention of her are gone', rosters >= 2 && await $('[data-pa-id=pa-5]').count() === 0 && await $('[data-pa=pa-5]').count() === 0 && await $('[data-field=member-filter] option[value=m-2]').count() === 0 && !/Casey|arthroscopy/i.test(text));
      } },
    { title: 'A reduction, then a reset, with a read failing', action: 'Refresh; dismiss the notice; then Infra gr-w16 (act) and pa-x9 for Casey; open it and type an expedite reason; Infra reduces gr-w16 to view; Refresh (a notice names Casey); Infra env.reset; Refresh with a plan read failing', expected: 'Casey’s member entry, her PA and the notice naming her leave the page at once', focus: '[data-list=pas]',
      run: async () => {
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w16');
        await t.event('pa.submitted', { pa_id: 'pa-x9', member_id: 'm-2', provider_id: 'pv-2', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-12-15', valid_until: '2027-01-31' });
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-x9');
        await h.form('expedite:pa-x9').locator('[data-field=reason]').fill('Casey needs it soon.');
        await grantCasey('gr-w16', 'view');
        await h.refresh();
        const named = (await $('[data-notice]').allInnerTexts()).join(' ');
        await reset();
        await h.fail(p => p.name === L('plan.get'));
        await h.refreshFailing();
        await t.release();
        const text = await $('#app').innerText();
        check('After a reduction notice and a reset that ends access, a refresh with a failing read removes Casey’s member entry, her PA and the notice naming her', named.includes('Casey Hale') && await $('[data-field=member-filter] option[value=m-2]').count() === 0 && await $('[data-pa-id=pa-x9]').count() === 0 && !/Casey|arthroscopy/i.test(text));
      } },
    { title: 'A reduction, then a reset, then a successful refresh', action: 'Refresh; dismiss the notice; then Infra gr-w17 (act) and pa-x10 for Casey; type an expedite reason; Infra reduces gr-w17 to view; Refresh; Infra env.reset; Household → Refresh', expected: 'No notice names Casey after the refresh', focus: '[data-view=household]',
      run: async () => {
        await h.refresh();
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w17');
        await t.event('pa.submitted', { pa_id: 'pa-x10', member_id: 'm-2', provider_id: 'pv-2', service_id: 'svc-arthroscopy', units: 1, valid_from: '2026-12-16', valid_until: '2027-01-31' });
        await h.nav('Prior authorizations');
        await h.refresh();
        await h.pick('pa', 'pa-x10');
        await h.form('expedite:pa-x10').locator('[data-field=reason]').fill('Casey needs it soon.');
        await grantCasey('gr-w17', 'view');
        await h.refresh();
        const named = (await $('[data-notice]').allInnerTexts()).join(' ');
        await reset();
        await h.nav('Household');
        await h.refresh();
        check('After a reduction notice and a reset that ends access, a successful refresh leaves no notice naming Casey and no record of her', named.includes('Casey Hale') && !/Casey|arthroscopy/i.test(await $('#app').innerText()) && await $('[data-member-row=m-2]').count() === 0);
      } }
  ] };

  const w6 = { id: 'w6-resets', title: 'Resets and new data', summary: 'Previews, drafts, retries and receipts stay bound to the run state they were made in.', steps: [
    { title: 'New data between two revision-0 reads', action: 'Dismiss the notice; then Infra loads the fixture; Refresh; preview a withdrawal of ap-3; open cl-17; Infra loads data without cl-17 between two reads of a Refresh', expected: 'The page rereads; cl-17 and the old preview are gone; the reset is announced', focus: '[data-notice]',
      run: async () => {
        await h.dismiss('dismiss-notice');
        await seed(FIXTURE);
        await h.refresh();
        await h.nav('Appeals');
        await h.pick('appeal', 'ap-3');
        await $('[data-action=preview][data-key="withdraw:ap-3"]').click();
        await h.flow('withdraw:ap-3').waitFor();
        await h.nav('Claims');
        await h.pick('claim', 'cl-17');
        const epochA = (await t.version()).epoch;
        await h.before(p => p.name === L('claims.list'), () => seed(WITHOUT_CL17));
        const mark = h.calls.length;
        await h.refresh();
        await t.release();
        const v = await t.version();
        check('New data loaded between two revision-0 reads of one refresh: the page rereads, the removed claim leaves the list and the detail, and the reset is announced', v.revision === 0 && v.epoch === epochA + 1 && h.calls.slice(mark).filter(c => c.name === L('members.list')).length === 3 && await $('[data-claim-id=cl-17]').count() === 0 && await $('[data-claim=cl-17]').count() === 0 && (await h.text('[data-notice]')).includes('reset or loaded with new data'));
        await h.nav('Appeals');
        await h.pick('appeal', 'ap-3');
        check('The withdrawal preview made before it is gone, with its approval controls', await h.flow('withdraw:ap-3').count() === 0 && await $('[data-action=preview][data-key="withdraw:ap-3"]').count() === 1);
      } },
    { title: 'The selected claim missing, with the refresh failing', action: 'Infra loads the fixture; Refresh; open cl-17; new data without it before the next Refresh, whose plan read fails', expected: 'The old claim leaves the page', focus: '[data-notice]',
      run: async () => {
        await seed(FIXTURE);
        await h.nav('Claims');
        await h.refresh();
        await h.pick('claim', 'cl-17');
        await h.before(p => p.name === L('members.list'), () => seed(WITHOUT_CL17));
        await h.fail(p => p.name === L('plan.get'));
        await h.refreshFailing();
        await t.release();
        check('The selected claim missing from new data, its detail read not_found and the refresh failing: the old claim leaves the page', await $('[data-claim-id=cl-17]').count() === 0 && await $('[data-claim=cl-17]').count() === 0 && await $('[data-notice] [data-ref=cl-17]').count() === 1);
      } },
    { title: 'A preview whose run was reset before Larkfield answered it', action: 'Refresh; then Infra loads the fixture; Refresh; draft a statement on ap-3; Withdraw appeal… with an Infra reset just before Larkfield handles it; Refresh fails; Add statement', expected: 'No preview and no Confirm; the old draft closed; writes refused with nothing sent until Refresh', focus: '[data-notice]',
      run: async () => {
        await h.refresh();
        await seed(FIXTURE);
        await h.nav('Appeals');
        await h.refresh();
        await h.pick('appeal', 'ap-3');
        await h.dismiss('dismiss-notice');
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('Draft written before the reset.');
        await h.before(p => p.name === L('appeals.withdraw.preview'), reset);
        await $('[data-action=preview][data-key="withdraw:ap-3"]').click();
        await $('[data-notice]').filter({ hasText: 'forms and previews you had open were closed' }).waitFor();
        await t.release();
        await t.failNextDiscovery();
        await h.refreshFailing();
        await t.release();
        check('A preview answered in a newer run is not kept: no preview, no Confirm, and the older draft is closed', await h.flow('withdraw:ap-3').count() === 0 && await $('[data-action=confirm]').count() === 0 && await h.form('statement:ap-3').locator('[data-field=statement]').inputValue() === '');
        const before = h.sent('appeals.add_statement');
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('Typed on the old view.');
        await $('[data-action=add-statement]').click();
        await h.alert('reset_seen');
        check('While the page still shows the older run, writes are refused and nothing is sent', h.sent('appeals.add_statement') === before && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === AP3_STATEMENTS);
      } },
    { title: 'An approval given after a reset', action: 'Refresh; then Withdraw preview on ap-3; Infra resets; Infra approves the same code; Confirm; Refresh; Preview again; Confirm', expected: 'The old preview is not used; the fresh preview finds the approval and withdraws', focus: '[data-appeal=ap-3]',
      run: async () => {
        await h.refresh();
        await $('[data-action=preview][data-key="withdraw:ap-3"]').click();
        await h.flow('withdraw:ap-3').waitFor();
        const wt = await h.token('withdraw:ap-3');
        await reset();
        await h.approve(wt);
        const before = h.sent('appeals.withdraw.confirm');
        await h.confirm('withdraw:ap-3');
        await h.alert('reset', h.form('withdraw:ap-3'));
        check('An approval given after a reset is not used by the old preview: Confirm asks for a fresh preview and sends nothing', h.sent('appeals.withdraw.confirm') === before && (await h.find('appeals', 'appeal_id', 'ap-3')).status === 'under_review' && await h.flow('withdraw:ap-3').count() === 0);
        await h.refresh();
        await h.pick('appeal', 'ap-3');
        const wt2 = await h.preview('withdraw:ap-3');
        check('The fresh preview in the new run finds the approval', wt2 === wt && await h.state('withdraw:ap-3') === 'active');
        await h.confirm('withdraw:ap-3');
        await h.flash('Appeal withdrawn');
        check('Confirm withdraws ap-3', (await h.find('appeals', 'appeal_id', 'ap-3')).status === 'withdrawn');
      } },
    { title: 'A refusal survives a reset', action: 'Dismiss the notice; then Household: give view access to Riley’s records → Infra approves → Confirm with an Infra event just before the send (stale_version); Infra resets; Refresh', expected: 'The stale_version message stays on the page after the reset', focus: '[role=alert][data-code=stale_version]',
      run: async () => {
        await h.dismiss('dismiss-notice');
        await reset();
        await h.nav('Household');
        await h.refresh();
        await h.form(kn).locator('[data-field=member_id]').selectOption('m-3');
        await h.form(kn).locator('[data-field=grantee]').selectOption('m-2');
        await h.approve(await h.preview(kn));
        await h.refresh();
        await h.before(p => p.name === L('grants.change.confirm'), () => t.event('pa.submitted', { pa_id: 'pa-w4', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-31' }));
        await h.confirm(kn);
        await h.alert('stale_version', h.flow(kn));
        await t.release();
        check('A change between Confirm’s check and its send is refused as stale_version', !(await t.data()).grants.some(g => g.member_id === 'm-3' && g.grantee_id === 'm-2'));
        await reset();
        await h.refresh();
        check('After a reset the refusal is still shown, and the status line does not say “All changes saved”', (await h.text('[role=alert][data-code=stale_version]')).startsWith('Larkfield changed since this page last read it') && await h.status() === NOTHING_CHANGED);
      } },
    { title: 'A refusal survives a reset that also ends access', action: 'Dismiss the message; dismiss the notice; then Infra gr-w18 (Casey’s act grant); Household: give view access to Riley’s records → Infra approves → Confirm with an Infra event just before the send (stale_version); Infra env.reset, which also ends Casey’s grant; Refresh', expected: 'The stale_version message stays on the page after the reset that removed Casey', focus: '[role=alert][data-code=stale_version]',
      run: async () => {
        await h.dismiss('dismiss-error');
        await h.dismiss('dismiss-notice');
        await grantCasey('gr-w18');
        await h.nav('Household');
        await h.refresh();
        await h.form(kn).locator('[data-field=member_id]').selectOption('m-3');
        await h.form(kn).locator('[data-field=grantee]').selectOption('m-2');
        await h.approve(await h.preview(kn));
        await h.refresh();
        await h.before(p => p.name === L('grants.change.confirm'), () => t.event('pa.submitted', { pa_id: 'pa-w8', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-31' }));
        await h.confirm(kn);
        await h.alert('stale_version', h.flow(kn));
        await t.release();
        await reset();
        await h.refresh();
        check('A refusal kept through a reset stays when that reset also ends access to another member', (await h.text('[role=alert][data-code=stale_version]')).startsWith('Larkfield changed since this page last read it') && await h.status() === NOTHING_CHANGED && await $('[data-member-row=m-2]').count() === 0);
      } },
    { title: 'A lost reply followed by a reset', action: 'Dismiss the message; dismiss the notice; then Add statement with the reply dropped; Infra resets; Retry; reload', expected: '“Cannot be confirmed”; not sent again; after the reload the reset state', focus: '[data-appeal=ap-3]',
      run: async () => {
        await h.dismiss('dismiss-error');
        await h.dismiss('dismiss-notice');
        await h.nav('Appeals');
        await h.refresh();
        await h.pick('appeal', 'ap-3');
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('A statement whose reply is lost.');
        const lost = await t.dropAfterCommit(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        check('A statement whose reply is lost after the commit waits in the banner', lost.forwarded?.status === 'committed' && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === AP3_STATEMENTS + 1);
        await reset();
        const before = h.sent('appeals.add_statement');
        await $('[data-action=retry-unknown]').click();
        await h.alert('unconfirmed');
        check('Retried after a reset, it is reported as cannot be confirmed and is not sent again', await $('[data-flash]').count() === 0 && await $('[data-action=retry-unknown]').count() === 0 && h.sent('appeals.add_statement') === before && await h.status() === CANNOT_CONFIRM);
        await page.reload();
        await t.idle();
        await t.settled();
        await h.pick('appeal', 'ap-3');
        check('After a reload the page shows the committed state: the reset removed the statement', (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === AP3_STATEMENTS && await $('[data-appeal=ap-3] [data-statement-at]').count() === AP3_STATEMENTS);
      } },
    { title: 'A retry receipt from another run is not applied', action: 'Add statement with the reply dropped; Retry, its reply rewritten by the test to carry another run’s epoch', expected: '“Cannot be confirmed”; no success message and no Retry', focus: '[role=alert][data-code=unconfirmed]',
      run: async () => {
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('A statement retried against a foreign reply.');
        const lost = await t.dropAfterCommit(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('connection_lost');
        await t.release();
        let injected = null;
        await page.route('**/api/call', async route => { const p = route.request().postDataJSON(); if (!injected && p.name === L('appeals.add_statement')) { const real = await (await route.fetch()).json(); injected = { ...real, version: { ...real.version, epoch: real.version.epoch + 1 } }; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(injected) }); } else await route.fallback(); });
        await $('[data-action=retry-unknown]').click();
        await h.alert('unconfirmed');
        await t.release();
        t.report.receipts.push({ kind: 'injected_reply', tool: L('appeals.add_statement'), note: 'reply rewritten by the test to carry another run’s epoch; not a Larkfield commit', version: injected?.version || null });
        check('A retry whose reply carries another run’s epoch is reported as cannot be confirmed, with no success message', lost.forwarded?.status === 'committed' && injected !== null && await $('[data-flash]').count() === 0 && await $('[data-action=retry-unknown]').count() === 0 && await h.status() === CANNOT_CONFIRM);
      } },
    { title: 'After a reload the page reads the real run', action: 'Reload the page; open the appeal; preview a withdrawal', expected: 'The statement stored once in Larkfield; the preview opens with nothing refused as a reset, up to date', focus: '[data-flow="withdraw:ap-3"]',
      run: async () => {
        await page.reload();
        await t.idle();
        await t.settled();
        check('In Larkfield the retried statement is stored exactly once', (await h.find('appeals', 'appeal_id', 'ap-3')).statements.filter(x => x.text === 'A statement retried against a foreign reply.').length === 1);
        await h.pick('appeal', 'ap-3');
        await $('[data-action=preview][data-key="withdraw:ap-3"]').click();
        await h.flow('withdraw:ap-3').waitFor();
        await t.settled();
        check('After a reload the page reads the real run again: a preview works and nothing is refused as a reset', await $('[role=alert][data-code=reset_seen]').count() === 0 && await h.status() === 'Up to date');
      } }
  ] };

  let reqA, reqB;
  const w9 = { id: 'w9-two-questions', title: 'Two claims, two questions', summary: 'Two claims whose IDs and line IDs join to the same text each keep their own question, preview and approval; a preview belongs to the record it was made on.', steps: [
    { title: 'Two claims whose IDs could be confused', action: 'Cancel the preview; then Infra: claim cl-a (line ln-1:ln-2) and claim cl-a:ln-1 (line ln-2) for Jordan, both possibly accident-related; the plan reviews them', expected: 'Each has its own open accident question', focus: '[data-list=claims]',
      run: async () => {
        await $('[data-flow="withdraw:ap-3"] [data-action=cancel-flow]').click();
        await t.idle();
        const line = (id, service, billed) => ({ line_id: id, service_id: service, service_date: '2026-11-17', units: 1, billed_cents: billed, emergency: false, possible_accident: true });
        await t.event('claim.received', { claim_id: 'cl-a', member_id: 'm-1', provider_id: 'pv-2', lines: [line('ln-1:ln-2', 'svc-specialist-visit', 33500)] });
        await t.event('claim.received', { claim_id: 'cl-a:ln-1', member_id: 'm-1', provider_id: 'pv-2', lines: [line('ln-2', 'svc-xray', 15800)] });
        await t.event('pa.submitted', { pa_id: 'pa-w5', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-31' }, '2026-11-22T00:00:00-05:00');
        const reqs = (await t.data()).info_requests;
        reqA = reqs.find(r => r.claim_id === 'cl-a' && r.line_id === 'ln-1:ln-2');
        reqB = reqs.find(r => r.claim_id === 'cl-a:ln-1' && r.line_id === 'ln-2');
        await h.nav('Claims');
        await h.refresh();
        check('Both claims have their own open accident question', !!reqA && !!reqB && reqA.status === 'open' && reqB.status === 'open' && reqA.info_request_id !== reqB.info_request_id);
      } },
    { title: 'Selecting a claim moves focus to it', action: 'Open cl-a from the list', expected: 'Keyboard focus is on the claim’s heading', focus: '[data-claim="cl-a"]',
      run: async () => {
        await h.pick('claim', 'cl-a');
        check('After selecting a claim, keyboard focus is on the selected claim’s heading', await h.focusIn('[data-claim="cl-a"] h2'));
      } },
    { title: 'A preview stays with its question', action: 'cl-a: Not related to an accident → Preview → Infra approves → open cl-a:ln-1', expected: 'The other claim shows its own question with no preview and no Confirm', focus: '[data-claim="cl-a:ln-1"]',
      run: async () => {
        const ka = 'info:' + reqA.info_request_id, kb = 'info:' + reqB.info_request_id;
        await h.form(ka).locator('[data-field=answer][data-value=not_accident]').check();
        await h.approve(await h.preview(ka));
        await h.pick('claim', 'cl-a:ln-1');
        check('The second claim’s question has its own form with no preview or Confirm from the first', await h.form(kb).count() === 1 && await h.flow(kb).count() === 0 && await $('[data-action=confirm]').count() === 0 && await $('[data-action=preview][data-key="' + kb + '"]').count() === 1);
      } },
    { title: 'A preview whose record was left is dropped', action: 'cl-a:ln-1: An accident → Preview with the reply held; open cl-a; open cl-a:ln-1 again; release the reply', expected: 'No preview and no Confirm on return', focus: '[data-claim="cl-a:ln-1"]',
      run: async () => {
        const kb = 'info:' + reqB.info_request_id;
        await h.form(kb).locator('[data-field=answer][data-value=accident]').check();
        const held = await h.hold(p => p.name === L('claims.info.preview') && p.arguments.claim_id === 'cl-a:ln-1');
        await $('[data-action=preview][data-key="' + kb + '"]').click();
        await h.until(() => held.length === 1);
        await h.pick('claim', 'cl-a');
        await h.pick('claim', 'cl-a:ln-1');
        await held[0].route.fulfill({ response: held[0].response });
        await page.waitForTimeout(300);
        await t.settled();
        await t.release();
        check('A delayed preview made before the selection changed enables no Confirm when its claim is shown again', await h.flow(kb).count() === 0 && await $('[data-action=confirm]').count() === 0);
      } },
    { title: 'A preview made before filtering to another member is dropped', action: 'cl-a:ln-1: An accident → Preview with the reply held; filter the list to Riley; filter back to all; open cl-a:ln-1; release the reply', expected: 'No preview and no Confirm', focus: '[data-claim="cl-a:ln-1"]',
      run: async () => {
        const kb = 'info:' + reqB.info_request_id;
        await h.form(kb).locator('[data-field=answer][data-value=accident]').check();
        const held = await h.hold(p => p.name === L('claims.info.preview') && p.arguments.claim_id === 'cl-a:ln-1');
        await $('[data-action=preview][data-key="' + kb + '"]').click();
        await h.until(() => held.length === 1);
        await page.locator('[data-field=member-filter]').selectOption('m-3');
        await t.idle();
        await page.locator('[data-field=member-filter]').selectOption('');
        await t.idle();
        await h.pick('claim', 'cl-a:ln-1');
        await held[0].route.fulfill({ response: held[0].response });
        await page.waitForTimeout(300);
        await t.settled();
        await t.release();
        check('A delayed preview made before a member filter deselected its claim enables no Confirm when the claim is shown again', await h.flow(kb).count() === 0 && await $('[data-action=confirm]').count() === 0);
      } },
    { title: 'Confirm answers the question it was made for', action: 'Open cl-a → Preview again (the same, approved code) → Confirm', expected: 'cl-a’s question answered; the other still open', focus: '[data-flash]',
      run: async () => {
        const ka = 'info:' + reqA.info_request_id;
        await h.pick('claim', 'cl-a');
        await h.form(ka).locator('[data-field=answer][data-value=not_accident]').check();
        await h.preview(ka);
        check('Returning to the first claim needs a new preview, which finds the approval', await h.state(ka) === 'active');
        await h.confirm(ka);
        await h.flash('Answer recorded');
        const reqs = (await t.data()).info_requests;
        check('Confirm answers the first claim’s question and leaves the second open', reqs.find(r => r.info_request_id === reqA.info_request_id).answer === 'not_accident' && reqs.find(r => r.info_request_id === reqB.info_request_id).status === 'open');
      } }
  ] };

  const w7 = { id: 'w7-coverage', title: 'Other coverage for 2027', summary: 'Claims with 2027 services open other-coverage questions; one answer covers them.', steps: [
    { title: 'Answer the first question', action: 'Infra: two 2027 office-visit claims; the first is reviewed. Plan & costs → 2027 → No other coverage → Preview → Infra approves', expected: 'The preview lists the question and the claim it completes', focus: '[data-flow="cob:m-1:2027"]',
      run: async () => {
        const office = (id, at, date) => t.event('claim.received', { claim_id: id, member_id: 'm-1', provider_id: 'pv-1', lines: [{ line_id: 'ln-1', service_id: 'svc-office-visit', service_date: date, units: 1, billed_cents: 18000, emergency: false, possible_accident: false }] }, at);
        await office('cl-w1', '2027-01-03T10:00:00-05:00', '2027-01-02');
        await office('cl-w2', '2027-01-04T10:00:00-05:00', '2027-01-03');
        await t.event('pa.submitted', { pa_id: 'pa-w2', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 4, valid_from: '2027-01-11', valid_until: '2027-02-28' }, '2027-01-07T23:40:00-05:00');
        const open = (await t.data()).info_requests.filter(r => r.type === 'other_coverage' && r.plan_year === 2027 && r.status === 'open').map(r => r.info_request_id);
        await h.nav('Plan & costs');
        await h.refresh();
        await $('[data-plan-year="2027"]').click();
        await h.form('cob:m-1:2027').waitFor();
        await h.form('cob:m-1:2027').locator('[data-field=answer][data-value=none]').check();
        const cb = await h.preview('cob:m-1:2027');
        check('The other-coverage question opened by a 2027 claim is answered from the plan page; the preview lists the open question it answers and the claim it completes', open.length === 1 && /^tok-cob-coverage-m-1:2027-/.test(cb) && await $('[data-flow="cob:m-1:2027"] [data-resolves="' + open[0] + '"]').count() === 1 && await $('[data-flow="cob:m-1:2027"] [data-completes="cl-w1"]').count() === 1);
        await h.approve(cb);
      } },
    { title: 'A second question opened after the approval', action: 'Infra: the second claim is reviewed; Refresh; Confirm', expected: 'The new effects are shown and nothing is sent', focus: '[data-note=changed]',
      run: async () => {
        await t.event('pa.info_requested', { pa_id: 'pa-w2', request: 'The therapy plan' }, '2027-01-08T00:00:00-05:00');
        const both = (await t.data()).info_requests.filter(r => r.type === 'other_coverage' && r.plan_year === 2027 && r.status === 'open').map(r => r.info_request_id);
        await h.refresh();
        const before = h.sent('coverage.cob.confirm');
        await h.confirm('cob:m-1:2027');
        await $('[data-flow="cob:m-1:2027"] [data-note=changed]').waitFor();
        await t.settled();
        check('Confirm shows the new effects (two questions, two claims) and sends no write until a fresh click', both.length === 2 && h.sent('coverage.cob.confirm') === before && await $('[data-flow="cob:m-1:2027"] [data-resolves="' + both.join(' ') + '"]').count() === 1 && (await t.data()).coverage.find(c => c.member_id === 'm-1' && c.plan_year === 2027).status === 'unknown');
      } },
    { title: 'A change between the check and the send', action: 'Confirm, with an Infra event just before the send', expected: 'stale_version; nothing answered', focus: '[role=alert][data-code=stale_version]',
      run: async () => {
        await h.before(p => p.name === L('coverage.cob.confirm'), () => t.event('pa.info_provided', { pa_id: 'pa-w2' }));
        await h.confirm('cob:m-1:2027');
        await h.alert('stale_version', h.flow('cob:m-1:2027'));
        await t.release();
        check('A change inserted between that re-preview and the send is refused as stale_version and nothing is answered', (await t.data()).coverage.find(c => c.member_id === 'm-1' && c.plan_year === 2027).status === 'unknown' && await $('[data-flash]').count() === 0);
      } },
    { title: 'Confirm the answer', action: 'Confirm', expected: 'Coverage none for 2027; both questions answered; both claims processed', focus: '[data-flash]',
      run: async () => {
        await h.confirm('cob:m-1:2027');
        await h.flash('Other coverage for Jordan Hale, 2027');
        const data = await t.data();
        const both = data.info_requests.filter(r => r.type === 'other_coverage' && r.plan_year === 2027);
        check('Confirm records the answer for 2027, answers both questions and completes both claims', data.coverage.find(c => c.member_id === 'm-1' && c.plan_year === 2027).status === 'none' && both.length === 2 && both.every(r => r.status === 'answered') && ['cl-w1', 'cl-w2'].every(id => data.claims.find(c => c.claim_id === id).status === 'processed'));
      } },
    { title: 'Larkfield decides whether the appeal window is still open', action: 'Infra: an out-of-network ultrasound claim, denied at review; statement → Preview appeal; the clock moves past the end of its window with no newer record; Refresh; Confirm', expected: 'The page offers the appeal until Larkfield refuses it at Confirm’s check, then shows the window as closed; nothing filed', focus: '[data-window=closed]',
      run: async () => {
        await t.event('claim.received', { claim_id: 'cl-w3', member_id: 'm-1', provider_id: 'pv-5', lines: [{ line_id: 'ln-1', service_id: 'svc-ultrasound', service_date: '2027-01-07', units: 1, billed_cents: 61000, emergency: false, possible_accident: false }] }, '2027-01-08T09:00:00-05:00');
        await t.event('pa.submitted', { pa_id: 'pa-w6', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2027-02-01', valid_until: '2027-02-28' }, '2027-01-12T09:00:00-05:00');
        const w = (await t.agent('claims.get', { claim_id: 'cl-w3' })).claim.appeal_window;
        await h.nav('Claims');
        await h.refresh();
        await h.pick('claim', 'cl-w3');
        await h.form('file:claim:cl-w3').locator('[data-field=statement]').fill('Please review the out-of-network denial.');
        await h.preview('file:claim:cl-w3');
        await t.advance(new Date(Date.parse(w.ends_at) + 3600000).toISOString().replace('.000Z', 'Z'));
        await h.refresh();
        check('After the window’s end, with no newer record, the page still offers the appeal and its preview (it does not guess the time from the records)', await h.form('file:claim:cl-w3').count() === 1 && await h.flow('file:claim:cl-w3').count() === 1);
        await h.confirm('file:claim:cl-w3');
        await $('[data-claim=cl-w3] [data-window=closed]').waitFor();
        await t.settled();
        check('When Larkfield refuses because the window has ended, the page shows the window as closed and no appeal form; nothing is filed', await h.form('file:claim:cl-w3').count() === 0 && (await h.text('[data-claim=cl-w3] [data-window=closed]')).includes('can no longer be appealed') && !(await t.data()).appeals.some(a => a.target.id === 'cl-w3'));
      } },
    { title: 'Casey’s 2027 coverage answer, reduced to view during the plan reads', action: 'Infra gr-w12 (act) and a 2027 claim for Casey, reviewed; Plan & costs 2027 → No other coverage → Preview → Infra approves → Refresh; Refresh with Casey reduced to view just before the 2027 plan read and the retry failing', expected: 'The approval, the preview and Confirm leave the page', focus: '[data-plan="2027"]',
      run: async () => {
        await grantCasey('gr-w12');
        await t.event('claim.received', { claim_id: 'cl-c1', member_id: 'm-2', provider_id: 'pv-1', lines: [{ line_id: 'ln-1', service_id: 'svc-office-visit', service_date: '2027-07-10', units: 1, billed_cents: 18000, emergency: false, possible_accident: false }] });
        await t.event('pa.submitted', { pa_id: 'pa-w7', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2027-08-01', valid_until: '2027-08-31' }, '2027-07-15T10:00:00-04:00');
        const kc = 'cob:m-2:2027';
        await h.nav('Plan & costs');
        await h.refresh();
        await $('[data-plan-year="2027"]').click();
        await h.form(kc).locator('[data-field=answer][data-value=none]').check();
        const token = await h.preview(kc);
        await h.approve(token);
        await h.refresh();
        check('The answer’s approval shows on the plan page', await h.state(kc) === 'active');
        let rosters = 0;
        await h.before(p => p.name === L('plan.get') && p.arguments.plan_year === 2027, () => grantCasey('gr-w12', 'view'));
        await h.fail(p => p.name === L('members.list') && ++rosters === 3);
        await h.refreshFailing();
        await t.release();
        check('A 2027 plan read without the approval removes it, the preview and Confirm at once, although the retry failed', await h.flow(kc).count() === 0 && await $('[data-action=confirm]').count() === 0 && await $('[data-token]').count() === 0 && !(await $('#app').innerText()).includes(token));
      } },
    { title: 'A coverage preview made on a claim goes with the claim', action: 'Infra sets gr-w12 back to act; Refresh; dismiss the notice; then Casey’s 2027 claim → No other coverage → Preview; filter to Jordan and back; reopen the claim', expected: 'No preview and no Confirm', focus: '[data-claim=cl-c1]',
      run: async () => {
        await grantCasey('gr-w12', 'act');
        await h.refresh();
        await h.dismiss('dismiss-notice');
        const kc = 'cob:m-2:2027';
        await h.nav('Claims');
        await h.refresh();
        await h.pick('claim', 'cl-c1');
        await h.form(kc).locator('[data-field=answer][data-value=none]').check();
        await h.preview(kc);
        await page.locator('[data-field=member-filter]').selectOption('m-1');
        await t.idle();
        await page.locator('[data-field=member-filter]').selectOption('');
        await t.idle();
        await h.pick('claim', 'cl-c1');
        check('A coverage preview made on a claim is dropped when a member filter hides that claim', await h.flow(kc).count() === 0 && await $('[data-action=confirm]').count() === 0);
      } }
  ] };

  const w8 = { id: 'w8-platform', title: 'Platform rules', summary: 'The page cannot reach Infra; the narrow layout holds after the run.', steps: [
    { title: 'Direct Infra requests are refused', action: 'Infra revokes gr-w12; Refresh; dismiss the notice; then from the page session: env.snapshot and env.apply_event; then every section at 390 px', expected: '403 from the Host; nothing changed; the narrow layout holds', focus: '#app',
      run: async () => {
        await revokeCasey('gr-w12');
        await h.refresh();
        await h.dismiss('dismiss-notice');
        const direct = [await t.business('env.snapshot', {}), await t.business('env.apply_event', { expected_version: await t.version(), event: { event_id: 'web-direct', at: await h.now(), operation: 'pa.withdrawn', payload: { pa_id: 'pa-5' } } })];
        await t.settled();
        check('Direct Infra and management requests from the page session are refused by the Host (403)', direct.every(r => r.http === 403) && (await h.find('pas', 'pa_id', 'pa-5')).status !== 'withdrawn');
        const v = await views(t, h, false);
        check('At 390 px no section scrolls sideways after the run, targets stay 44 px tall and nothing hides in an inner scroll box', v.every(x => !x.wide && x.small.length === 0 && x.boxed.length === 0));
        const runs = path.join(appDir, '..', '..', '.artifacts', 'web', 'larkfield-health');
        const before = fs.existsSync(runs) ? fs.readdirSync(runs).sort() : [];
        const env = { ...process.env };
        delete env.PALE_WEB_REPORT_DIR;
        const refused = spawnSync(process.execPath, [path.join(appDir, 'tests', 'web.browser.cjs'), '--evidence', appDir], { encoding: 'utf8', env, timeout: 60000 });
        const after = fs.existsSync(runs) ? fs.readdirSync(runs).sort() : [];
        check('The browser test refuses a non-empty evidence folder with one plain line, before creating its run folder or starting a browser', refused.status === 1 && refused.stderr.trim().split('\n').length === 1 && /is not an empty folder/.test(refused.stderr) && JSON.stringify(after) === JSON.stringify(before) && fs.existsSync(path.join(appDir, 'tools.json')));
      } }
  ] };

  return [w0, w2, w1, w3, w4, w5, w6, w9, w7, w8];
}

function restrictedRun(t) {
  const { page, check } = t;
  const h = helpers(t);
  const { $ } = h;
  t.allowConsole(/status of 403/);
  t.allowConsole(/status of 400/);
  const dropped = [L('appeals.add_statement'), L('claims.info.confirm')];
  const policies = read('fixtures/policies.json');
  for (const p of Object.values(policies)) p.allow = p.allow.filter(n => !dropped.includes(n));
  let statements, timedOut;
  return { id: 'restricted', title: 'Policies without some tools', summary: 'A second fresh run: a policy without appeals.add_statement and claims.info.confirm, then a policy without plan.get, each loaded with new data.', steps: [
    { title: 'The accident questions can be answered under the full policy', action: 'Open the page on a second fresh run; open cl-13', expected: 'Answer choices for each open accident question', focus: '[data-form="info:ir-11"]',
      run: async () => {
        await t.open('[data-claim-id]');
        await t.settled();
        await h.pick('claim', 'cl-13');
        check('Under the full policy the accident questions on cl-13 can be answered', await h.form('info:ir-11').locator('[data-field=answer]').count() === 3);
      } },
    { title: 'A statement answered by a Host timeout', action: 'Appeals → the Fernhollow appeal → Add statement; the Host answers 400 “MCP request timed out” after the commit', expected: '“Waiting for Larkfield” with Retry', focus: '[aria-label="Waiting for Larkfield"]',
      run: async () => {
        await h.nav('Appeals');
        await h.pick('appeal', 'ap-3');
        statements = (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length;
        await h.form('statement:ap-3').locator('[data-field=statement]').fill('Sent just before the policy changed.');
        timedOut = await h.timeoutAfterCommit(p => p.name === L('appeals.add_statement'));
        await $('[data-action=add-statement]').click();
        await h.alert('request_failed');
        await t.release();
        check('A statement answered by a Host timeout after its commit waits in the banner with Retry', timedOut.forwarded?.status === 'committed' && await $('[data-action=retry-unknown]').count() === 1);
      } },
    { title: 'New data with a policy without appeals.add_statement', action: 'Infra loads the fixture with a policy without appeals.add_statement and claims.info.confirm; Refresh', expected: 'No statement form; the pending request in its reset form with no Retry; Withdraw stays', focus: '[data-unknown=reset]',
      run: async () => {
        await t.loadSeed({ data: FIXTURE, policies, virtual_now: CLOCK, request_id: 'web-restricted-policy' });
        await h.refresh();
        check('After new data with a policy without appeals.add_statement is loaded, Refresh removes the statement form; the pending request is reported as unconfirmable across that reset, with no Retry; Withdraw stays', await h.form('statement:ap-3').count() === 0 && await $('[data-action=retry-unknown]').count() === 0 && await $('[data-unknown=reset]').count() === 1 && await $('[data-action=preview][data-key="withdraw:ap-3"]').count() === 1 && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements);
      } },
    { title: 'Answering is not allowed by the policy', action: 'Dismiss “Waiting for Larkfield”; Claims → cl-13', expected: 'The accident questions say answering is not allowed, with no answer controls', focus: '[data-request=ir-11]',
      run: async () => {
        await h.dismiss('dismiss-unknown');
        await h.nav('Claims');
        await h.pick('claim', 'cl-13');
        check('Without claims.info.confirm the accident questions say that answering is not allowed, with no answer controls', await $('[data-request=ir-11] [data-field=answer]').count() === 0 && (await h.text('[data-request=ir-11]')).includes('not allowed by the current policy'));
      } },
    { title: 'Forced calls to the dropped tools', action: 'From the page session: appeals.add_statement and claims.info.confirm', expected: '403 from the Host; nothing changed', focus: '[data-request=ir-11]',
      run: async () => {
        const forced = [await t.business(L('appeals.add_statement'), { appeal_id: 'ap-3', statement: 'Forced.', expected_version: await t.version(), request_id: 'web-forced-statement' }), await t.business(L('claims.info.confirm'), { claim_id: 'cl-13', line_id: 'ln-1', answer: 'not_accident', token: 'tok-info-request-ir-11-' + '0'.repeat(32), expected_version: await t.version(), request_id: 'web-forced-info' })];
        await t.settled();
        check('Forced calls to the dropped tools are refused by the Host (403) and change nothing', forced.every(r => r.http === 403) && (await h.find('appeals', 'appeal_id', 'ap-3')).statements.length === statements && (await h.find('info_requests', 'info_request_id', 'ir-11')).status === 'open');
        await t.shot('restricted');
      } },
    { title: 'A policy without plan.get', action: 'Infra loads the fixture with a policy without plan.get; Refresh', expected: 'The portal loads and shows claims', focus: '[data-list=claims]',
      run: async () => {
        const noPlan = read('fixtures/policies.json');
        for (const p of Object.values(noPlan)) p.allow = p.allow.filter(n => n !== L('plan.get'));
        const errorsBefore = t.errors.length;
        await t.loadSeed({ data: FIXTURE, policies: noPlan, virtual_now: CLOCK, request_id: 'web-restricted-no-plan' });
        await h.refresh();
        check('With a valid policy that omits plan.get, the portal still loads and shows claims', await $('[data-claim-id]').count() > 10 && await $('#status[data-error=true]').count() === 0 && t.errors.length === errorsBefore);
      } },
    { title: 'The plan section without plan.get', action: 'Plan & costs', expected: 'Reading the plan is not allowed by the current policy', focus: '#records',
      run: async () => {
        await h.nav('Plan & costs');
        check('… and the plan section says reading the plan is not allowed', (await h.text('#records')).includes('Reading the plan is not allowed by the current policy'));
      } }
  ] };
}

async function restricted(t) {
  for (const s of restrictedRun(t).steps) await s.run();
}

module.exports = { workflows, restricted, restrictedRun };

if (require.main === module) runWebAcceptance({ app: 'larkfield-health', appDir, workflows, restricted, timezoneId: 'Asia/Tokyo', strictChecks: true, evidence: process.argv.includes('--evidence') ? { dir: path.resolve(process.argv[process.argv.indexOf('--evidence') + 1] || ''), title: 'Larkfield', account: 'account `larkfield-m-1`, Jordan Hale (m-1); fixture clock 2026-11-18 12:00 New York' } : null });
