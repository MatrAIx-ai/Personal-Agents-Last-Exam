#!/usr/bin/env node
'use strict';
// Browser checks for the Stoopside pages on the shared business Web Host.
// Needs the repository's Playwright: from the root, `npm ci` and
// `npx playwright install chromium`; then
//   node apps/stoopside/tests/web-checks.cjs
// It starts runtime/web/server.cjs with apps/stoopside/web.registry.json (the
// fixture clock), opens all eight pages in Chromium, compares what each page
// shows with the tool results over MCP, drives every write through the page
// (RSVP, event change, post, sign-up release and swap, profile) and checks the
// committed state with an Infra snapshot. Screenshots and a report go to
// .artifacts/web/stoopside/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const root = path.resolve(app, '../..');
const {chromium} = require(require.resolve('playwright', {paths: [root]}));
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));

async function main() {
  const out = path.join(root, '.artifacts/web/stoopside');
  fs.mkdirSync(out, {recursive: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoopside-web-'));
  const checks = [], errors = [];
  const ok = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  let host, infra, browser;
  try {
    host = await start({app: 'stoopside', registry: path.join(app, 'web.registry.json'), stateDir, run: 'web-checks', profile: 'sandbox'});
    infra = new Client('stoopside', 'infra', host.run, stateDir, 'stoopside-web-inspector', {registry: host.registry});
    await infra.initialize();
    const tool = (name, args = {}) => host.client.call('stoopside.' + name, args);
    const data = async () => (await infra.call('env.snapshot')).snapshot.data;
    browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForFunction(h => location.hash === h, hash); await idle(); await page.waitForTimeout(50); await idle(); };
    const text = async sel => (await page.locator(sel).innerText());

    await page.goto(host.accessUrl);
    await idle();
    await page.locator('#records [data-record-id]').first().waitFor();
    ok('the Host serves the Stoopside page and the session opens', (await page.title()).startsWith('Stoopside'));
    const controller = fs.readFileSync(path.join(app, 'gui/src/app.js'), 'utf8');
    ok('the controller names every declared tool', JSON.parse(fs.readFileSync(path.join(app, 'tools.json'))).every(t => controller.includes(`'${t.name}'`)));

    // 1. Group home with discovery.
    const groups = (await tool('groups.list')).groups;
    ok('group discovery lists exactly the groups groups.list returns', JSON.stringify(await page.locator('#records [data-record-id]').evaluateAll(n => n.map(x => x.dataset.recordId))) === JSON.stringify(groups.map(g => g.id)));
    await go('#/group/g-block');
    const block = await tool('groups.get', {group_id: 'g-block'}), posts = (await tool('posts.list', {group_id: 'g-block'})).posts;
    ok('group home shows the hosts and the post count the tools return',
      (await Promise.all(block.hosts.map(async h => (await text('[data-section=hosts]')).includes(h.display_name)))).every(Boolean) &&
      (await text('#page')).includes(`Posts (${posts.length})`));
    await page.locator('[data-section=view-as] select').selectOption('m-027');
    await page.locator('[data-view-as-result][data-visible]').waitFor();
    const groupView = await tool('visibility.view_as', {member_id: 'm-027', object_type: 'group', object_id: 'g-block'});
    ok('view-as on the group home shows the tool answer', await page.locator('[data-view-as-result]').getAttribute('data-visible') === String(groupView.visible));

    // 2. Member directory.
    await go('#/members/g-block');
    await page.locator('[data-members] .metadata-line').first().waitFor();
    const members = (await tool('members.search', {group_id: 'g-block', query: ''})).members;
    ok('the directory lists what members.search returns', await page.locator('[data-members] .metadata-line').count() === members.length);
    await page.locator('[data-field=member_query]').fill('Birdie');
    await page.locator('[data-action=search]').click();
    await page.locator('[data-members] p').filter({hasText: '0 members match'}).waitFor();
    ok('a search by the everyday name finds nobody, as the tool does', (await tool('members.search', {group_id: 'g-block', query: 'Birdie'})).members.length === 0);
    await page.locator('[data-action=export]').click();
    await page.locator('[data-export] .metadata-line').first().waitFor();
    ok('the export shows every member email the tool returns', await page.locator('[data-export] .metadata-line').count() === (await tool('members.export', {group_id: 'g-block'})).members.length &&
      (await text('[data-export]')).includes('birdie.adeyemi@example.net'));

    // 3. Event page, RSVP preview with pre-filled counts, then a confirm with explicit counts.
    await go('#/event/e-0121');
    const e121 = (await tool('events.get', {event_id: 'e-0121'})).event;
    ok('the event page shows the places taken the tool returns', (await text('#page')).includes(`${e121.places_taken}/${e121.capacity} places taken`));
    await page.locator('[data-action=preview-rsvp]').click();
    await page.locator('[data-prefilled]').waitFor();
    ok('an RSVP preview with empty counts shows where the pre-filled counts came from', /guests 1, children 2/.test(await text('[data-prefilled]')));
    await page.locator('[data-form=rsvp] [data-field=guests]').fill('0');
    await page.locator('[data-form=rsvp] [data-field=children]').fill('0');
    await page.locator('[data-action=preview-rsvp]').click();
    await page.waitForFunction(() => !document.querySelector('[data-prefilled]'));
    await page.locator('[data-confirm]').click();
    await page.locator('#status').filter({hasText: 'RSVP r-'}).waitFor();
    await idle();
    let d = await data();
    const mine = d.rsvps.find(r => r.event_id === 'e-0121' && r.member_id === 'm-001');
    ok('confirming the RSVP commits yes with 0 guests and 0 children', mine && mine.answer === 'yes' && mine.guests === 0 && mine.children === 0);
    await go('#/event/e-0130');
    await page.locator('[data-section=view-as] select').selectOption('m-016');
    await page.locator('[data-view-as-result][data-visible]').waitFor();
    ok('view-as on the event page shows the tool answer', await page.locator('[data-view-as-result]').getAttribute('data-visible') ===
      String((await tool('visibility.view_as', {member_id: 'm-016', object_type: 'event', object_id: 'e-0130'})).visible));

    // 4. Change preview: move the cleanup and notify the guests only.
    await go('#/change/edit/e-0140');
    await page.locator('[data-form=change] [data-field=venue]').fill('Linden Park pavilion');
    await page.locator('[data-form=change] [data-field=notify]').selectOption('guests');
    await page.locator('[data-action=preview-change]').click();
    await page.locator('[data-recipients]').waitFor();
    const shownRecipients = Number(await page.locator('[data-recipients]').getAttribute('data-recipients'));
    await page.locator('[data-confirm]').click();
    await page.waitForFunction(() => location.hash === '#/event/e-0140');
    await idle();
    d = await data();
    const changed = d.deliveries.filter(x => x.object_id === 'e-0140' && x.reason === 'event_changed').length;
    ok('the change preview lists the recipients that were then notified', shownRecipients === changed && shownRecipients === 10 && d.events.find(x => x.id === 'e-0140').venue === 'Linden Park pavilion');

    // 5. Post composer: a post to the planning meeting's guests.
    await go('#/compose/g-block/event/e-0130');
    await page.locator('[data-form=compose] [data-field=text]').fill('Send-off plans: potluck on the porch, May 8. Keep it quiet.');
    await page.locator('[data-action=preview-post]').click();
    await page.locator('[data-recipients]').waitFor();
    const postRecipients = Number(await page.locator('[data-recipients]').getAttribute('data-recipients'));
    await page.locator('[data-confirm]').click();
    await page.waitForFunction(() => location.hash === '#/group/g-block');
    await idle();
    d = await data();
    const post = d.posts.find(p => p.text.startsWith('Send-off plans: potluck on the porch'));
    ok('the composer publishes to the chosen audience and notifies the previewed members', post && post.audience === 'event_guests' &&
      d.deliveries.filter(x => x.object_id === post.id).length === postRecipients && !d.deliveries.some(x => x.object_id === post.id && x.recipient_member_id === 'm-027'));

    // 6. Sheet: release the carpool slot and accept the pending swap.
    await go('#/sheet/s-0022');
    await page.locator('[data-release=carpool-1]').click();
    await page.locator('#status').filter({hasText: 'Released'}).waitFor();
    await idle();
    await page.locator('[data-swap-answer="sw-0005:accept"]').click();
    await page.locator('#status').filter({hasText: 'Swap sw-0005: accept'}).waitFor();
    await idle();
    d = await data();
    const s22 = d.sheets.find(s => s.id === 's-0022');
    ok('sheet actions commit the release and the accepted swap', JSON.stringify(s22.slots.filter(x => x.claims.includes('m-001')).map(x => x.id)) === '["snacks"]' &&
      d.swaps.find(w => w.id === 'sw-0005').state === 'accepted');
    await page.locator('[data-section=view-as] select').selectOption('m-013');
    await page.locator('[data-view-as-result][data-visible]').waitFor();
    ok('view-as on the sheet page shows the member\'s slots from the tool', (await text('[data-view-as-result]')).includes(
      (await tool('visibility.view_as', {member_id: 'm-013', object_type: 'sheet', object_id: 's-0022'})).view.my_slots.join(', ')));

    // 7. Profile and 8. Help.
    await go('#/profile');
    await page.locator('[data-form=profile] [data-field=bio]').fill('Two kids at Maple St School. I host the block cleanups and the coffee urn.');
    await page.locator('[data-action=save-profile]').click();
    await page.locator('#status').filter({hasText: 'Profile saved'}).waitFor();
    await idle();
    ok('the profile page saves through profile.update', (await data()).members.find(m => m.id === 'm-001').bio.endsWith('the coffee urn.'));
    await go('#/help');
    const help = (await tool('help.get')).topics;
    ok('the help page shows every rule help.get returns', await page.locator('[data-rule]').count() === help.reduce((n, t) => n + t.rules.length, 0));

    // A scenario event applied by Infra appears after a refresh.
    const snap = await infra.call('env.snapshot');
    const applied = await infra.call('env.apply_event', {expected_version: snap.version, event: require('../examples/scenario.json')});
    assert.equal(applied.status, 'committed');
    await go('#/event/e-0117');
    ok('a refresh shows the waitlist offer an Infra event created', /offered/.test(await text('#page')) && /claim by 2027-03-06 18:20/.test(await text('#page')));

    const denied = await page.evaluate(async () => {
      const {csrf} = await (await fetch('/session')).json();
      return (await fetch('/api/call', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf}, body: JSON.stringify({name: 'env.snapshot', arguments: {}})})).status;
    });
    ok('a management request from the page is refused', denied === 403);
    await page.screenshot({path: path.join(out, 'event.png'), fullPage: true});
    await go('#/group/g-block');
    await page.screenshot({path: path.join(out, 'group.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    for (const hash of ['#/group/g-block', '#/event/e-0140', '#/sheet/s-0022']) {
      await go(hash);
      ok(`narrow viewport has no horizontal overflow on ${hash}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.screenshot({path: path.join(out, 'narrow.png'), fullPage: true});
    ok('no JavaScript errors', errors.length === 0);
    const report = {app: 'stoopside', passed: true, checks};
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await infra?.close();
    await host?.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
