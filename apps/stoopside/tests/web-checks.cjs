#!/usr/bin/env node
'use strict';
// Browser checks for the Stoopside pages on the shared business Web Host.
// Needs the repository's Playwright: from the root, `npm ci` and
// `npx playwright install chromium`; then
//   node apps/stoopside/tests/web-checks.cjs              checks only
//   node apps/stoopside/tests/web-checks.cjs --evidence   checks, and writes the
//       curated screenshots and their manifest to apps/stoopside/evidence/screens/
// It starts runtime/web/server.cjs with apps/stoopside/web.registry.json (the
// Maple St clock) and loads the Maple St fixture through env.load_seed, opens all eight pages in Chromium, compares what each page
// shows with the tool results over MCP, drives every write through the page,
// including the error, cancel and stale paths, checks the committed state with
// an Infra snapshot, reloads, applies an independent MCP write and an Infra
// event, and checks a read-only (scenario) profile. A report and working
// screenshots go to .artifacts/web/stoopside/.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const app = path.resolve(__dirname, '..');
const root = path.resolve(app, '../..');
const {chromium} = require(require.resolve('playwright', {paths: [root]}));
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
// Core starts each run from the manifest seed (Hillcrest); the main and
// read-only runs switch to Maple St at its clock through env.load_seed.
const {loadFixture} = require('../scripts/load-fixture.cjs');

const EVIDENCE = process.argv.includes('--evidence');
const VIEWPORT = {width: 1280, height: 800};
const RUN = 'web-checks';
const git = (...args) => { try { return execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim(); } catch { return null; } };
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const out = path.join(root, '.artifacts/web/stoopside');
  const screens = path.join(app, 'evidence/screens');
  fs.mkdirSync(out, {recursive: true});
  if (EVIDENCE) { fs.rmSync(screens, {recursive: true, force: true}); fs.mkdirSync(screens, {recursive: true}); }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoopside-web-'));
  const roDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoopside-web-ro-'));
  const hcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoopside-web-hc-'));
  const checks = [], errors = [], shots = [];
  const ok = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  let host, roHost, hcHost, infra, browser;
  try {
    host = await start({app: 'stoopside', registry: path.join(app, 'web.registry.json'), stateDir, run: RUN, profile: 'sandbox'});
    infra = new Client('stoopside', 'infra', host.run, stateDir, 'stoopside-web-inspector', {registry: host.registry});
    await infra.initialize();
    await loadFixture(infra, 'maple-street');
    const tool = (name, args = {}) => host.client.call('stoopside.' + name, args);
    const snapshot = async () => (await infra.call('env.snapshot'));
    const data = async () => (await snapshot()).snapshot.data;
    const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: VIEWPORT});
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForFunction(h => location.hash === h, hash); await idle(); await page.waitForTimeout(50); await idle(); };
    const text = async sel => (await page.locator(sel).innerText());
    const flash = async pattern => { const l = page.locator('[data-flash]'); await (pattern ? l.filter({hasText: pattern}) : l).first().waitFor(); return text('[data-flash]'); };
    // "code: page text" for the error next to a form (the code is an attribute, not shown).
    const formError = async () => {
      const l = page.locator('[data-form-error] [data-error-code]').first();
      await l.waitFor();
      return `${await l.getAttribute('data-error-code')}: ${await text('[data-form-error]:not(:empty)')}`;
    };
    // Evidence: one viewport screenshot per step, scrolled to the element the step is about.
    const shot = async (file, step, focus) => {
      await page.screenshot({path: path.join(out, file)});
      if (!EVIDENCE) return;
      if (focus) { await page.locator(focus).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(80); } else await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({path: path.join(screens, file)});
      shots.push({file, step, hash: await page.evaluate(() => location.hash), after_check: checks.at(-1) || null});
    };
    // Share of visible App text below 12px (checklist section 4: App-owned text at least 12px).
    const smallText = () => page.evaluate(() => {
      let total = 0, small = 0;
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const t = n.textContent.trim(), e = n.parentElement;
        if (!t || !e.getBoundingClientRect().width || getComputedStyle(e).visibility === 'hidden') continue;
        total += t.length;
        if (parseFloat(getComputedStyle(e).fontSize) < 12) small += t.length;
      }
      return {total, small};
    });
    const rawIso = /\d{4}-\d\d-\d\dT\d\d:\d\d/;

    await page.goto(host.accessUrl);
    await idle();
    await page.locator('#records [data-record-id]').first().waitFor();
    ok('the Host serves the Stoopside page and the session opens', (await page.title()).includes('Stoopside'));
    const controller = fs.readFileSync(path.join(app, 'gui/src/app.js'), 'utf8');
    ok('the controller names every declared tool', JSON.parse(fs.readFileSync(path.join(app, 'tools.json'))).every(t => controller.includes(`'${t.name}'`)));

    // 1. Group discovery and group home.
    const groups = (await tool('groups.list')).groups;
    ok('group discovery shows a card for exactly the groups groups.list returns', JSON.stringify(await page.locator('#records [data-record-id]').evaluateAll(n => n.map(x => x.dataset.recordId))) === JSON.stringify(groups.map(g => g.id)));
    ok('group cards show the member count and the user\'s membership from the tool', (await text('#records [data-record-id=g-block]')).includes(`${groups.find(g => g.id === 'g-block').member_count} members`) &&
      (await text('#records [data-record-id=g-runclub]')).includes('Request pending'));
    const waitingSwaps = (await tool('signups.get', {sheet_id: 's-0022'})).swaps.filter(w => w.state === 'proposed' && w.to.member_id === 'm-001');
    ok('the groups page lists what waits for the user, here the swap Theo proposed, linked to its sheet (follow-up review, minor)',
      waitingSwaps.length === 1 && await page.locator('[data-waiting=swap]').count() === 1 && /Theo B\. offers you snacks for your coffee urn and cups/.test(await text('[data-waiting=swap]')) &&
      await page.locator('[data-waiting=swap]').getAttribute('href') === '#/sheet/s-0022');
    await shot('01-groups-discovery.png', 'Group discovery: start state, what waits for the user (a pending swap), one card per group with member count and membership');
    await go('#/group/g-block');
    const block = await tool('groups.get', {group_id: 'g-block'}), posts = (await tool('posts.list', {group_id: 'g-block'})).posts;
    ok('group home shows the hosts and the post count the tools return',
      (await Promise.all(block.hosts.map(async h => (await text('[data-section=hosts]')).includes(h.display_name)))).every(Boolean) &&
      (await text('#page')).includes(`Posts (${posts.length})`));
    const e130 = block.upcoming_events.find(e => e.id === 'e-0130');
    ok('upcoming events are cards with a readable date, the venue and the places left the tool returns',
      (await text('[data-event-id=e-0130]')).includes('Wed, Mar 10, 2027, 7:00 PM to 8:30 PM EST') && (await text('[data-event-id=e-0130]')).includes(`${e130.places_free} of ${e130.capacity} places left`));
    ok('no raw ISO time appears on the group home', !rawIso.test(await text('#page')));
    const editable = await page.locator('[data-edit]').evaluateAll(n => n.map(x => x.dataset.edit));
    ok('Edit appears on no other member\'s post (the user\'s only post here is a locked announcement)', editable.every(id => posts.find(p => p.id === id).author.member_id === 'm-001'));
    await shot('02-group-home.png', 'Group home: header, hosts, upcoming event cards (date, venue, places left) and actions');
    // The selector lists members already on the page (hosts and post authors); take Wren if listed, else the first.
    const listed = await page.locator('[data-section=view-as] select option').evaluateAll(n => n.map(x => x.value).filter(Boolean));
    const viewer = listed.includes('m-027') ? 'm-027' : listed[0];
    const viewerName = (await tool('groups.get', {group_id: 'g-block'})).hosts.concat(posts.map(p => p.author)).find(m => m.member_id === viewer).display_name;
    await page.locator('[data-section=view-as] select').selectOption(viewer);
    await page.locator('[data-view-as-result][data-visible]').waitFor();
    const groupView = await tool('visibility.view_as', {member_id: viewer, object_type: 'group', object_id: 'g-block'});
    ok('view-as on the group home shows the tool answer in the group\'s zone', await page.locator('[data-view-as-result]').getAttribute('data-visible') === String(groupView.visible) &&
      (await text('[data-view-as-result]')).includes('As of Mon, Mar 1, 2027, 9:00 AM EST'));
    await shot('03-view-as-group.png', `View-as on the group home: ${viewerName} (${viewer}) sees the group now; as-of time in EST`, '[data-section=view-as]');
    // Dana is a plain member of the parents group and has a post there.
    await go('#/group/g-parents');
    const parentPosts = (await tool('posts.list', {group_id: 'g-parents'})).posts;
    const deletable = await page.locator('[data-delete]').evaluateAll(n => n.map(x => x.dataset.delete));
    const parentEdits = await page.locator('[data-edit]').evaluateAll(n => n.map(x => x.dataset.edit));
    ok('in a group where the user is a plain member, Edit and Delete appear only on their own posts', deletable.length > 0 && JSON.stringify(parentEdits) === JSON.stringify(deletable) &&
      deletable.every(id => parentPosts.find(p => p.id === id).author.member_id === 'm-001'));
    await go('#/group/g-garden');
    ok('the garden hides its member list from members, so the page offers no directory link', await page.locator('[data-link=members]').count() === 0);

    // 2. Member directory.
    await go('#/members/g-block');
    await page.locator('[data-members] [data-member-id]').first().waitFor();
    const members = (await tool('members.search', {group_id: 'g-block', query: ''})).members;
    ok('the directory shows a card for each member members.search returns', await page.locator('[data-members] [data-member-id]').count() === members.length);
    await page.locator('[data-field=member_query]').fill('Birdie');
    await page.locator('[data-action=search]').click();
    await page.locator('[data-members] p').filter({hasText: '0 members match'}).waitFor();
    ok('a search by the everyday name finds nobody, as the tool does', (await tool('members.search', {group_id: 'g-block', query: 'Birdie'})).members.length === 0);
    await shot('04-members-search-everyday-name.png', 'Member search by the everyday name "Birdie": 0 matches (search covers display names and bios only)', '[data-members]');
    await page.locator('[data-field=member_query]').fill('Wren');
    await page.locator('[data-action=search]').click();
    await page.locator('[data-members] [data-member-id=m-027]').waitFor();
    ok('a search by the display name finds the member', (await tool('members.search', {group_id: 'g-block', query: 'Wren'})).members.some(m => m.member_id === 'm-027'));
    await page.locator('[data-action=export]').click();
    await page.locator('[data-export] [data-export-row]').first().waitFor();
    ok('the export shows every member email the tool returns', await page.locator('[data-export] [data-export-row]').count() === (await tool('members.export', {group_id: 'g-block'})).members.length &&
      (await text('[data-export]')).includes('birdie.adeyemi@example.net'));
    await shot('05-members-export.png', 'Member export (co-organizer): the only place emails appear; Wren Adeyemi\'s email links her to "Birdie"', '[data-export] [data-export-row=m-027]');

    // 3. RSVP: the pre-fill error path, the preview with pre-filled counts, cancel, and a confirm with explicit counts.
    await go('#/event/e-0125');
    let before = digest(await data());
    await page.locator('[data-action=preview-rsvp]').click();
    const limitError = await formError();
    ok('guest_limit_exceeded from a pre-filled count is shown next to the RSVP form and says where the guest came from (review item 6)',
      /^guest_limit_exceeded: /.test(limitError) && /pre-filled from your latest RSVP in this group for Pi Day bake sale, answered Sat, Mar 7, 2026, 8:15 PM EST/.test(limitError));
    ok('the page words the error without tool arguments, RSVP IDs or raw dates (follow-up review item 5)', !/Pass guests|r-\d{4}|\d{4}-\d{2}-\d{2}|\(guest_limit_exceeded\)/.test(limitError.replace(/^[a-z_]+: /, '')));
    ok('the failed preview wrote nothing', digest(await data()) === before);
    await shot('06-rsvp-error-guest-limit.png', 'RSVP error path: Book fair volunteers allows 0 guests; empty counts pre-filled 1 guest from the Pi Day bake sale RSVP, so the preview fails with guest_limit_exceeded and says where the guest came from', '[data-form-error]:not(:empty)');
    await go('#/event/e-0121');
    const e121 = (await tool('events.get', {event_id: 'e-0121'})).event;
    ok('the event page shows the date in the group\'s zone and the places the tool returns', (await text('#page')).includes('Sat, Mar 20, 2027, 4:00 PM to 7:00 PM EST') &&
      (await text('#page')).includes(`${e121.places_taken} of ${e121.capacity} taken`) && !rawIso.test(await text('#page')));
    await shot('07-rsvp-start.png', 'RSVP start: Spring fling family dance, no RSVP yet; guests and children left empty');
    before = digest(await data());
    for (const bad of ['-1', '1.5']) {
      await page.locator('[data-field=guests]').fill(bad);
      await page.locator('[data-action=preview-rsvp]').click();
      const badCount = await formError();
      ok(`a guest count of ${bad} is refused on the page in page wording and writes nothing (follow-up review, minor)`,
        /^invalid_input: Enter the number of guests as a whole number, 0 or more\.$/.test(badCount) && digest(await data()) === before);
    }
    await page.locator('[data-field=guests]').fill('');
    await page.locator('[data-action=preview-rsvp]').click();
    await page.locator('[data-prefilled]').waitFor();
    ok('an RSVP preview with empty counts shows where the pre-filled counts came from', /guests 1, children 2/.test(await text('[data-prefilled]')) && /Pi Day bake sale/.test(await text('[data-prefilled]')));
    ok('the preview is sentences, not key/value dumps', !/fields \{|group id|prefilled from|resulting answer/.test(await text('[data-preview]')));
    await shot('08-rsvp-preview-prefilled.png', 'RSVP preview: party of 4 pre-filled from the year-old Pi Day bake sale RSVP (guests 1, children 2), with Confirm and Cancel', '[data-preview]');
    await page.locator('[data-cancel-preview]').click();
    await page.locator('[data-preview-cancelled]').waitFor();
    ok('Cancel on a preview discards it and writes no RSVP', !(await data()).rsvps.some(r => r.event_id === 'e-0121' && r.member_id === 'm-001'));
    await page.locator('[data-form=rsvp] [data-field=guests]').fill('0');
    await page.locator('[data-form=rsvp] [data-field=children]').fill('0');
    await page.locator('[data-action=preview-rsvp]').click();
    await page.locator('[data-preview]').waitFor();
    ok('explicit counts leave no pre-fill note', await page.locator('[data-prefilled]').count() === 0);
    await page.locator('[data-confirm]').click();
    const rsvpReceipt = await flash();
    let d = await data();
    const mine = d.rsvps.find(r => r.event_id === 'e-0121' && r.member_id === 'm-001');
    ok('confirming the RSVP commits yes with 0 guests and 0 children', mine && mine.answer === 'yes' && mine.guests === 0 && mine.children === 0);
    ok('the RSVP receipt stays on the page after the re-render and names the RSVP and its notice', rsvpReceipt.includes(`RSVP ${mine.id}`) && rsvpReceipt.includes(d.notices.at(-1).id) &&
      (await text('[data-my-rsvp]')).includes('You are going: just you (1 place)'));
    await shot('09-rsvp-receipt.png', `RSVP result: receipt kept on the page (RSVP ${mine.id}, notice ${d.notices.at(-1).id}); Your RSVP reads going, 1 place`);
    // A new action starts clean: the RSVP receipt must not sit next to a new error.
    await page.locator('[data-form=rsvp] [data-field=guests]').fill('9');
    await page.locator('[data-action=preview-rsvp]').click();
    const bigError = await formError();
    ok('a new action clears the earlier receipt: previewing 9 guests after the RSVP shows only the new error (follow-up review item 4)',
      /^guest_limit_exceeded: /.test(bigError) && await page.locator('[data-flash]').count() === 0);
    await page.reload();
    await idle();
    await page.locator('[data-my-rsvp=yes]').waitFor();
    ok('after a reload the event page still shows the committed RSVP', (await tool('events.get', {event_id: 'e-0121'})).event.my_rsvp.answer === 'yes');
    await go('#/event/e-0130');
    await page.locator('[data-section=view-as] select').selectOption('m-016');
    await page.locator('[data-view-as-result][data-visible]').waitFor();
    ok('view-as on the event page shows the tool answer', await page.locator('[data-view-as-result]').getAttribute('data-visible') ===
      String((await tool('visibility.view_as', {member_id: 'm-016', object_type: 'event', object_id: 'e-0130'})).visible));

    // 4. Event change: notify_required, preview with recipients, confirm, and a stale confirm.
    await go('#/change/edit/e-0140');
    await page.locator('[data-form=change] [data-field=venue]').fill('Linden Park pavilion');
    before = digest(await data());
    await page.locator('[data-action=preview-change]').click();
    const notifyError = await formError();
    ok('moving the venue with no notify choice shows notify_required next to the form, in page wording', /^notify_required: /.test(notifyError) &&
      /tell the guests or the whole group/.test(notifyError) && !/notify:/.test(notifyError) && digest(await data()) === before);
    await shot('10-change-notify-required.png', 'Event change error path: venue moved with "Nobody" selected; notify_required shown next to the form, nothing written', '[data-form-error]:not(:empty)');
    await page.locator('[data-form=change] [data-field=notify]').selectOption('guests');
    await page.locator('[data-action=preview-change]').click();
    await page.locator('[data-preview] [data-recipients]').waitFor();
    const shownRecipients = Number(await page.locator('[data-preview] [data-recipients]').getAttribute('data-recipients'));
    ok('the change preview names the old and new venue as a sentence', (await text('[data-preview]')).includes('Venue: Linden Park pavilion (was Elm Ave lot)'));
    await shot('11-change-preview-recipients.png', 'Event change preview: venue Elm Ave lot to Linden Park pavilion, every open RSVP notified, 11 yes RSVPs must reconfirm, 10 named recipients', '[data-preview]');
    await page.locator('[data-confirm]').click();
    await page.waitForFunction(() => location.hash === '#/event/e-0140');
    const changeReceipt = await flash();
    d = await data();
    const changed = d.deliveries.filter(x => x.object_id === 'e-0140' && x.reason === 'event_changed').length;
    ok('the change preview lists the recipients that were then notified', shownRecipients === changed && shownRecipients === 10 && d.events.find(x => x.id === 'e-0140').venue === 'Linden Park pavilion');
    ok('the change receipt and the notified count stay visible after the hashchange re-render', changeReceipt.includes('10 members notified by email'));
    await page.locator('[data-action=refresh]').click();
    await idle();
    ok('the receipt is still visible after Refresh on the same page', (await flash()).includes('10 members notified'));
    await shot('12-change-receipt.png', 'Event change result: the event page with the kept receipt (10 members notified) and the Changes list in EST');
    // Stale: preview a change, then an independent MCP write changes the event first.
    await go('#/change/edit/e-0130');
    await page.locator('[data-form=change] [data-field=description]').fill('Planning for the June social. Bring ideas for the menu.');
    await page.locator('[data-action=preview-change]').click();
    await page.locator('[data-preview]').waitFor();
    let s = await snapshot();
    const mcpPreview = await tool('events.preview_change', {expected_version: s.version, request_id: 'independent-preview', change: 'edit', event_id: 'e-0130', fields: {title: 'June social: planning meeting (moved indoors)'}});
    const mcpConfirm = await tool('events.confirm_change', {expected_version: mcpPreview.version, request_id: 'independent-confirm', preview_id: mcpPreview.preview.id});
    assert.equal(mcpConfirm.status, 'committed');
    before = digest(await data());
    await page.locator('[data-confirm]').click();
    const staleError = await formError();
    ok('confirming after an independent MCP edit shows stale_version next to the preview and keeps the MCP value', /stale_version/.test(staleError) &&
      digest(await data()) === before && (await data()).events.find(x => x.id === 'e-0130').title === 'June social: planning meeting (moved indoors)');
    await shot('13-change-stale.png', 'Event change stale path: an independent MCP edit renamed the event after this preview; Confirm fails with stale_version, the MCP value stays', '[data-preview]');

    // 5. Post composer: audience_required, then a post to an event's guests.
    await go('#/compose/g-block');
    before = digest(await data());
    await page.locator('[data-action=preview-post]').click();
    ok('an empty post is refused on the page in page wording and writes nothing', /^invalid_input: Write the post before you preview it\.$/.test(await formError()) && digest(await data()) === before);
    await page.locator('[data-form=compose] [data-field=text]').fill('Send-off plans: potluck on the porch, May 8. Keep it quiet.');
    await page.locator('[data-action=preview-post]').click();
    const audienceError = await formError();
    ok('a post with no audience shows audience_required next to the composer, in page wording, and writes nothing', /^audience_required: /.test(audienceError) &&
      /Choose who sees this post/.test(audienceError) && !/event_guests|hosts_only/.test(audienceError) && digest(await data()) === before);
    await shot('14-post-audience-required.png', 'Post error path: no audience chosen; audience_required shown next to the composer, nothing written', '[data-form-error]:not(:empty)');
    await go('#/compose/g-block/event/e-0130');
    await page.locator('[data-form=compose] [data-field=text]').fill('Send-off plans: potluck on the porch, May 8. Keep it quiet.');
    await page.locator('[data-action=preview-post]').click();
    await page.locator('[data-preview] [data-recipients]').waitFor();
    const postRecipients = Number(await page.locator('[data-preview] [data-recipients]').getAttribute('data-recipients'));
    ok('the post preview states the audience as a sentence', (await text('[data-preview]')).includes('A post to the guests of June social: planning meeting (moved indoors) (RSVP yes) and its hosts.'));
    await shot('15-post-preview-recipients.png', 'Post preview: audience is the planning meeting\'s guests and hosts; every notified member is listed', '[data-preview]');
    await page.locator('[data-confirm]').click();
    await page.waitForFunction(() => location.hash === '#/group/g-block');
    const postReceipt = await flash();
    d = await data();
    const post = d.posts.find(p => p.text.startsWith('Send-off plans: potluck on the porch'));
    ok('the composer publishes to the chosen audience and notifies the previewed members', post && post.audience === 'event_guests' &&
      d.deliveries.filter(x => x.object_id === post.id).length === postRecipients && !d.deliveries.some(x => x.object_id === post.id && x.recipient_member_id === 'm-027'));
    ok('the publish receipt stays on the group page after navigation', postReceipt.includes(`${postRecipients} members notified`) && postReceipt.includes(post.id));
    await shot('16-post-receipt.png', `Post result: the group page keeps the receipt (${postRecipients} members notified, post ${post.id}); Wren Adeyemi is not among them`);
    // Delete asks first; Keep it writes nothing.
    await page.locator(`[data-delete="${post.id}"]`).click();
    await page.locator('[data-confirm-box]').waitFor();
    await shot('17-post-delete-confirm.png', 'Delete asks for confirmation inline: the post is hidden from now on, nothing delivered is recalled', '[data-confirm-box]');
    await page.locator('[data-confirm-no]').click();
    ok('Keep it leaves the post published', (await data()).posts.find(p => p.id === post.id).state === 'published');
    await page.locator(`[data-delete="${post.id}"]`).click();
    await page.locator('[data-confirm-yes]').click();
    ok('confirming the delete hides the post and keeps its deliveries', /Post deleted/.test(await flash(/Post deleted/)) && (await data()).posts.find(p => p.id === post.id).state === 'deleted' &&
      (await data()).deliveries.filter(x => x.object_id === post.id).length === postRecipients);

    // 6. Sheet: controls that cannot work are not offered; release and accept a swap.
    await go('#/sheet/s-0022');
    const sheet = (await tool('signups.get', {sheet_id: 's-0022'})).sheet;
    const claimable = await page.locator('[data-claim]').evaluateAll(n => n.map(x => x.dataset.claim));
    ok('Claim is offered only on slots with a free place that the user does not hold', JSON.stringify(claimable) === JSON.stringify(sheet.slots.filter(x => x.open > 0 && !sheet.my_slots.includes(x.id)).map(x => x.id)));
    const wants = await page.locator('[data-form=swap] [data-field=want_slot] option').evaluateAll(n => n.map(x => x.value));
    ok('the swap form never offers one of the user\'s own slots as Want', wants.length > 0 && wants.every(w => !sheet.my_slots.includes(w)));
    ok('only the swap\'s recipient can accept or decline; no Withdraw is offered on a swap the user did not propose', await page.locator('[data-swap-answer="sw-0005:withdraw"]').count() === 0);
    await shot('18-sheet-start.png', 'Sheet start: full slots show Full and no Claim; the user\'s slots offer Release; Theo\'s pending swap offers Accept and Decline');
    await page.locator('[data-release=carpool-1]').click();
    ok('the release receipt is kept on the page', /Released Carpool seat block/.test(await flash(/Released Carpool seat block/)));
    await shot('19-sheet-release-receipt.png', 'Sheet result: carpool seat released, receipt kept on the page');
    await page.locator('[data-swap-answer="sw-0005:accept"]').click();
    ok('the swap answer receipt is kept on the page', /Swap sw-0005: accepted/.test(await flash(/Swap sw-0005: accepted/)));
    d = await data();
    const s22 = d.sheets.find(x => x.id === 's-0022');
    ok('sheet actions commit the release and the accepted swap', JSON.stringify(s22.slots.filter(x => x.claims.includes('m-001')).map(x => x.id)) === '["snacks"]' &&
      d.swaps.find(w => w.id === 'sw-0005').state === 'accepted');
    await shot('20-sheet-swap-accepted.png', 'Sheet result: swap sw-0005 accepted; the user now holds Snacks and Theo holds the coffee urn');
    await page.locator('[data-section=view-as] select').selectOption('m-013');
    await page.locator('[data-view-as-result][data-visible]').waitFor();
    ok('view-as on the sheet page shows the member\'s slots from the tool', (await text('[data-view-as-result]')).includes(
      (await tool('visibility.view_as', {member_id: 'm-013', object_type: 'sheet', object_id: 's-0022'})).view.my_slots.join(', ')));
    await shot('21-view-as-sheet.png', 'View-as on the sheet: Theo B. (m-013) sees the sheet now, with his slots after the swap', '[data-section=view-as]');

    // 7. Profile and 8. Help.
    await go('#/profile');
    const shownName = await page.locator('[data-form=profile] [data-field=display_name]').inputValue();
    await page.locator('[data-form=profile] [data-field=display_name]').fill('  ');
    before = digest(await data());
    await page.locator('[data-action=save-profile]').click();
    ok('an empty display name is refused on the page in page wording and writes nothing', /^invalid_input: Enter a display name\./.test(await formError()) && digest(await data()) === before);
    await page.locator('[data-form=profile] [data-field=display_name]').fill(shownName);
    await page.locator('[data-form=profile] [data-field=bio]').fill('Two kids at Maple St School. I host the block cleanups and the coffee urn.');
    await page.locator('[data-action=save-profile]').click();
    ok('the profile page saves through profile.update and keeps the receipt', /Profile saved/.test(await flash(/Profile saved/)) && (await data()).members.find(m => m.id === 'm-001').bio.endsWith('the coffee urn.'));
    await go('#/help');
    const help = (await tool('help.get')).topics;
    ok('the help page shows every rule help.get returns', await page.locator('[data-rule]').count() === help.reduce((n, t) => n + t.rules.length, 0));

    // A scenario event applied by Infra appears after a refresh; the offer is claimed through the page.
    s = await snapshot();
    const applied = await infra.call('env.apply_event', {expected_version: s.version, event: require('../examples/maple-street-event.json')});
    assert.equal(applied.status, 'committed');
    await go('#/event/e-0117');
    ok('a refresh shows the waitlist offer an Infra event created, with the claim deadline in EST', (await text('[data-my-rsvp]')).includes('A place was offered to you for you and 1 guest (2 places). Claim by Sat, Mar 6, 2027, 6:20 PM EST.'));
    await shot('22-waitlist-offer.png', 'Waitlist offer: after an Infra scenario event (a guest dropped out), the event shows the offer and its claim deadline', '[data-section=your-rsvp]');
    await page.locator('[data-form=rsvp] [data-field=guests]').fill('1');
    await page.locator('[data-form=rsvp] [data-field=children]').fill('0');
    await page.locator('[data-action=preview-rsvp]').click();
    await page.locator('[data-preview] [data-outcome=claim]').waitFor();
    await shot('23-waitlist-claim-preview.png', 'Waitlist claim preview: claims the offered place for 2 before the deadline', '[data-preview]');
    await page.locator('[data-confirm]').click();
    await flash(/RSVP saved/);
    d = await data();
    ok('claiming the offer from the page commits yes for 2 places', d.rsvps.find(r => r.id === 'r-0451').answer === 'yes' && (await text('[data-my-rsvp]')).includes('You are going: you and 1 guest (2 places)'));
    await shot('24-waitlist-claim-receipt.png', 'Waitlist claim result: RSVP r-0451 is yes for 2 places; receipt kept on the page');

    // Create an event and cancel it.
    await go('#/change/new/g-block');
    const fill = async (k, v) => page.locator(`[data-form=change] [data-field=${k}]`).fill(v);
    await fill('title', 'Stoop sale');
    await fill('description', 'Bring what you no longer need. Unsold items go to the library sale.');
    await fill('start', '2027-04-10T09:00');
    await fill('end', '2027-04-10T13:00');
    await fill('venue', 'Maple St sidewalks');
    await fill('capacity', '30');
    await fill('guest_limit', '1');
    await fill('rsvp_open', '2027-03-05T10:00');
    await fill('rsvp_close', '2027-04-09T12:00');
    await page.locator('[data-action=preview-change]').click();
    await page.locator('[data-preview]').waitFor();
    await page.locator('[data-confirm]').click();
    await page.waitForFunction(() => /^#\/event\/e-/.test(location.hash));
    const created = (await data()).events.find(e => e.title === 'Stoop sale');
    ok('creating an event from the page stores the times in the group\'s offset', created && created.start === '2027-04-10T09:00:00-05:00' && /Event created: Stoop sale/.test(await flash(/Event created: Stoop sale/)));
    await go(`#/change/cancel/${created.id}`);
    await page.locator('[data-action=preview-change]').click();
    await page.locator('[data-preview]').waitFor();
    const cancelText = await text('[data-preview]');
    ok('the cancel preview of an event nobody answered says no email goes out, and nothing says otherwise (follow-up review, minor)',
      /Nobody has an open RSVP, so no email goes out\./.test(cancelText) && !/is notified by email/.test(cancelText));
    await shot('25-cancel-preview.png', 'Event cancel preview: says it cannot be undone and sheets lock; nobody has an open RSVP, so no email goes out', '[data-preview]');
    await page.locator('[data-confirm]').click();
    await page.waitForFunction(id => location.hash === '#/event/' + id, created.id);
    ok('cancelling from the page commits the cancellation and keeps the receipt', (await data()).events.find(e => e.id === created.id).state === 'cancelled' && /Stoop sale is cancelled/.test(await flash(/Stoop sale is cancelled/)));
    await shot('26-cancel-receipt.png', 'Event cancel result: the event shows Cancelled and the receipt is kept on the page');

    // Leave asks first; then join again.
    await go('#/group/g-garden');
    await page.locator('[data-action=leave]').click();
    await page.locator('[data-confirm-box]').waitFor();
    ok('Leave group asks for confirmation and writes nothing until confirmed', (await data()).memberships.find(m => m.group_id === 'g-garden' && m.member_id === 'm-001').state === 'member');
    await shot('27-leave-confirm.png', 'Leave group asks first and says what happens to RSVPs and sign-up slots', '[data-confirm-box]');
    await page.locator('[data-confirm-yes]').click();
    ok('confirming leave commits it and keeps the receipt', /You left Elm Ave Community Garden/.test(await flash(/You left Elm Ave Community Garden/)) && (await data()).memberships.find(m => m.group_id === 'g-garden' && m.member_id === 'm-001').state === 'left');
    await page.locator('[data-action=join]').click();
    ok('joining again from the page commits membership', /You joined/.test(await flash(/You joined/)) && (await data()).memberships.find(m => m.group_id === 'g-garden' && m.member_id === 'm-001').state === 'member');
    await shot('28-join-receipt.png', 'Join result: the user is a member again; receipt kept on the page');

    // not_found changes the page title.
    await go('#/event/e-9999');
    ok('a not_found page says so in its title and the document title', (await text('#page-title')) === 'Not found' && (await page.title()).startsWith('Not found') && await page.locator('[data-page-error=not_found]').count() === 1);
    await shot('29-not-found.png', 'not_found: an unknown event ID; the page title changes to Not found');

    const denied = await page.evaluate(async () => {
      const {csrf} = await (await fetch('/session')).json();
      return (await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name: 'env.snapshot', arguments: {}})})).status;
    });
    ok('a management request from the page is refused', denied === 403);

    for (const hash of ['#/groups', '#/group/g-block', '#/event/e-0117', '#/members/g-block', '#/sheet/s-0022', '#/change/edit/e-0140', '#/compose/g-block', '#/profile', '#/help']) {
      await go(hash);
      const t = await smallText();
      ok(`no visible text below 12px on ${hash}`, t.total > 0 && t.small === 0);
    }
    // Muted text contrast (WCAG 2.1 AA, 4.5:1 for small text) against the white page.
    await go('#/event/e-0117');
    const contrast = await page.evaluate(() => {
      const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = c => 1.05 / (lum(c) + 0.05);
      return Math.min(...[...document.querySelectorAll('.st-muted, .st-id, .kicker, #status, .toolbar button')].filter(e => e.getBoundingClientRect().width).map(e => ratio(getComputedStyle(e).color)));
    });
    ok(`muted text has a contrast of at least 4.5:1 (lowest ${contrast.toFixed(2)})`, contrast >= 4.5);
    await page.setViewportSize({width: 390, height: 844});
    for (const hash of ['#/group/g-block', '#/event/e-0140', '#/sheet/s-0022', '#/compose/g-block']) {
      await go(hash);
      ok(`narrow viewport has no horizontal overflow on ${hash}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await go('#/event/e-0140');
    await shot('30-narrow-event.png', 'Narrow viewport (390 px): the event page has no horizontal overflow');
    await page.setViewportSize(VIEWPORT);

    // Read-only profile: a second run with the scenario profile shows no write controls.
    roHost = await start({app: 'stoopside', registry: path.join(app, 'web.registry.json'), stateDir: roDir, run: RUN + '-ro', profile: 'scenario'});
    const roInfra = new Client('stoopside', 'infra', roHost.run, roDir, 'stoopside-web-ro-loader', {registry: roHost.registry});
    try { await roInfra.initialize(); await loadFixture(roInfra, 'maple-street', {requestId: 'load-ro'}); } finally { await roInfra.close(); }
    const ro = await context.newPage();
    ro.on('pageerror', e => errors.push(e.message));
    await ro.goto(roHost.accessUrl);
    await ro.locator('#app[aria-busy=false]').waitFor();
    const roGo = async hash => { await ro.evaluate(h => { location.hash = h; }, hash); await ro.waitForFunction(h => location.hash === h, hash); await ro.locator('#app[aria-busy=false]').waitFor(); await ro.waitForTimeout(50); };
    const writeControls = '[data-action=join],[data-action=leave],[data-link=compose],[data-link=new-event],[data-delete],[data-edit],[data-comment],[data-action=preview-rsvp],[data-link=edit-event],[data-link=cancel-event],[data-claim],[data-release],[data-swap-answer],[data-action=propose-swap],[data-action=save-profile]';
    for (const hash of ['#/group/g-block', '#/event/e-0140', '#/sheet/s-0022', '#/profile']) {
      await roGo(hash);
      ok(`the read-only scenario profile shows no write control on ${hash}`, await ro.locator(writeControls).count() === 0);
    }
    await roGo('#/event/e-0140');
    ok('the read-only event page says RSVPs cannot be changed here', /read-only/.test(await ro.locator('[data-section=your-rsvp]').innerText()));
    if (EVIDENCE) { await ro.screenshot({path: path.join(screens, '31-read-only-profile.png')}); shots.push({file: '31-read-only-profile.png', step: 'Read-only scenario profile: no RSVP form, edit, cancel or post controls; the page says why', hash: '#/event/e-0140', after_check: checks.at(-1)}); }
    await ro.close();

    // A run whose clock lies inside the 2025-2026 coverage window: Hillcrest at its own clock (review item 10).
    const {startFixture} = require('../scripts/web-fixture.cjs');
    ({host: hcHost} = await startFixture({key: 'hillcrest', stateDir: hcDir, run: RUN + '-hillcrest'}));
    const hc = await context.newPage();
    hc.on('pageerror', e => errors.push(e.message));
    await hc.goto(hcHost.accessUrl);
    await hc.locator('#app[aria-busy=false]').waitFor();
    await hc.evaluate(() => { location.hash = '#/group/g-library'; });
    await hc.waitForFunction(() => location.hash === '#/group/g-library');
    await hc.locator('#app[aria-busy=false]').waitFor();
    await hc.locator('[data-event-id=e-0304]').waitFor();
    const hcGroups = (await hcHost.client.call('stoopside.groups.list', {})).groups;
    ok('the Hillcrest run (clock 2026-11-18 09:00 PST, inside the coverage window) shows its own groups and times in PST',
      hcGroups.some(g => g.id === 'g-library') && (await hc.locator('[data-event-id=e-0304]').innerText()).includes('Sat, Dec 5, 2026, 9:00 AM') && (await hc.locator('[data-event-id=e-0304]').innerText()).includes('PST'));
    if (EVIDENCE) { await hc.screenshot({path: path.join(screens, '32-hillcrest-in-window.png')}); shots.push({file: '32-hillcrest-in-window.png', step: 'Hillcrest run at its clock (2026-11-18 09:00 PST, inside 2025-2026): Friends of Hillcrest Library with December 2026 events in PST', hash: '#/group/g-library', after_check: checks.at(-1)}); }
    await hc.close();

    ok('no JavaScript errors', errors.length === 0);
    const report = {app: 'stoopside', passed: true, checks};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (EVIDENCE) {
      const manifest = {
        about: 'Curated screenshots written by node apps/stoopside/tests/web-checks.cjs --evidence. Each step follows the check named in after_check.',
        app_commit: git('rev-parse', 'HEAD'),
        app_tree_dirty: Boolean(git('status', '--porcelain', '--', 'apps/stoopside/gui', 'apps/stoopside/src', 'apps/stoopside/tools.json', 'apps/stoopside/fixtures')),
        gui_app_js_sha256: sha256(path.join(app, 'gui/src/app.js')),
        host: {file: 'runtime/web/server.cjs', last_commit: git('log', '-1', '--format=%H', '--', 'runtime/web'), sha256: sha256(path.join(root, 'runtime/web/server.cjs')), stylesheet_sha256: sha256(path.join(root, 'runtime/web/style.css'))},
        browser: `Chromium ${browser.version()} (Playwright, headless)`,
        node: process.version,
        viewport: VIEWPORT,
        run: {run_id: RUN, read_only_run_id: RUN + '-ro', hillcrest_run_id: RUN + '-hillcrest', hillcrest_registry: 'apps/stoopside/web.hillcrest.registry.json', profile: 'sandbox', read_only_profile: 'scenario', registry: 'apps/stoopside/web.registry.json',
          clock: JSON.parse(fs.readFileSync(path.join(app, 'web.registry.json'))).initial_time, seed: 'apps/stoopside/fixtures/minimal.json (loaded with env.load_seed)', seed_sha256: sha256(path.join(app, 'fixtures/minimal.json')),
          account: 'st-dana (Dana O., member m-001)'},
        checks: checks.length,
        screens: shots,
      };
      fs.writeFileSync(path.join(screens, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await infra?.close();
    await host?.close();
    await roHost?.close();
    await hcHost?.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
    fs.rmSync(hcDir, {recursive: true, force: true});
    fs.rmSync(roDir, {recursive: true, force: true});
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
