'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runWebAcceptance } = require('./web/harness.cjs');

const appDir = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(appDir, file), 'utf8'));
const tools = read('tools.json').map(t => t.name);
const controller = fs.readFileSync(path.join(appDir, 'gui/src/app.js'), 'utf8');
const P = 'mendwell-pharmacy.';
const ACTIVE = ['requested', 'waiting_stock', 'claim_rejected', 'pending_plan_decision', 'ready'];
const UNSAFE = '<img src=x onerror=window.injected=1>';
const MARKUP = 'Interaction flag: <mark data-probe="1">confirm</mark> with the prescriber ' + UNSAFE;

function workflows(t) {
  const { page, check } = t;
  const $ = selector => page.locator(selector);
  const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click(); await t.idle(); };
  const alert = async code => { await $('[role=alert][data-code=' + code + ']').first().waitFor(); await t.settled(); };
  const flash = async text => { await $('[data-flash]').filter({ hasText: text }).waitFor(); await t.settled(); };
  const click = async selector => { await $(selector).first().click(); };
  const openFill = async id => { await nav('Fills'); const row = $('[data-list=fills] [data-fill-id="' + id + '"]'); if (!(await row.isVisible())) await $('[data-list=fills] details summary').click(); await row.click(); await $('article[data-fill="' + id + '"]').waitFor(); await t.settled(); };
  const openRx = async id => { await nav('Prescriptions'); await $('[data-rx-id="' + id + '"]').click(); await $('article[data-rx="' + id + '"]').waitFor(); await t.settled(); };
  const data = () => t.data();
  const fill = async id => (await data()).fills.find(f => f.fill_id === id);
  const grant = async id => (await data()).grants.find(g => g.grant_id === id);
  const approval = async token => (await data()).approvals.filter(a => a.token === token);
  const token = async () => (await $('[data-token]').innerText()).trim();
  const confirmClick = async () => { await click('[data-action=confirm-flow]'); await t.settled(); };
  const waiting = async () => { await confirmClick(); await $('[data-waiting]').waitFor(); };
  const lastAudit = async tool => (await t.snapshot()).audit.filter(a => a.tool === tool).at(-1);
  const brief = f => f.fill_id + ' ' + f.state + (f.amount_due_cents != null ? ' due ' + f.amount_due_cents : '') + (f.claim_id ? ' claim ' + f.claim_id : '');
  const grantOf = (patient, grantee, scope) => data().then(d => d.grants.filter(g => g.patient_id === patient && g.grantee_id === grantee && g.scope === scope));
  const grantForm = async (grantee, scope, date) => {
    await click('[data-action=open-grant]');
    await $('[data-field=grantee]').selectOption(grantee);
    await $('[data-scope=' + scope + ']').check();
    await $('[data-field=grant-date]').fill(date || '');
    await $('[data-field=grant-time]').fill('00:00');
    await click('[data-action=preview-grant]');
    await $('[data-flow=grant]').waitFor();
    await t.settled();
  };
  let token1, token2, token3, revokeToken, prepayDeclined, prepayToken;

  const w1 = { id: 'w1-grants', title: 'W1 Household grants', summary: 'Alex (account holder) gives Sam access to Alex’s own records. Grant changes need a user confirmation that the page cannot issue: the preview shows the code, the confirmer and the 30-minute rule, Confirm waits until Infra applies `user.confirmed` (here with `dev/confirm.cjs`), Refresh shows it, and Confirm re-previews before it sends.', steps: [
    { title: 'Household lists who Alex acts for', action: 'Open Household', expected: 'Sam (spouse; Alex holds his view, refill and pickup grants), Alex (you) and Mia (child; Alex is a guardian)', focus: '[data-list=people]',
      run: async () => {
        await t.open('[data-fill-id]');
        await t.settled();
        const served = await page.evaluate(async () => (await fetch('/app.js')).text());
        check('The shared Host serves the App-owned Mendwell page: its title, app id and controller, and the first refresh completes', await page.title() === 'Mendwell Pharmacy · PALE' && await page.evaluate(() => document.body.dataset.app) === 'mendwell-pharmacy' && served === controller && (await $('#status').innerText()).trim() === 'All changes saved' && await $('nav button').count() === 5);
        check('The controller names all ' + tools.length + ' business tools', tools.length === 25 && tools.every(n => controller.includes("'" + n + "'")));
        const discovered = (await t.host.client.request('tools/list')).result.tools.map(x => x.name);
        check('Business discovery lists the 25 tools and no management operation', discovered.length === 25 && discovered.every(n => n.startsWith(P)));
        await nav('Household');
        await $('[data-person-id=p-2]').waitFor();
        const people = (await t.agent('household.list')).people, d = await data();
        check('Household shows exactly the people household.list returns', JSON.stringify(await $('[data-list=people] [data-person-id]').evaluateAll(n => n.map(e => e.dataset.personId))) === JSON.stringify(people.map(p => p.person_id)));
        const held = d.grants.filter(g => g.grantee_id === 'p-2' && g.status === 'active' && g.patient_id === 'p-1').map(g => g.scope).sort();
        check('The snapshot backs the list: Alex is the bound holder, a guardian of Mia, and holds Sam’s refill and pickup grants', d.owner_person_id === 'p-2' && d.people.find(p => p.person_id === 'p-3').guardian_ids.includes('p-2') && JSON.stringify(held) === '["pickup","refill"]' && people.every(p => d.people.some(x => x.person_id === p.person_id && x.name === p.name)));
        return 'household.list: ' + people.map(p => p.name + ' [' + p.powers.join(', ') + ']').join('; ') + '; snapshot grants to p-2 from p-1: ' + held.join(', ');
      } },
    { title: 'Preview a pickup grant for Sam', action: 'Give access → Person: Sam Rivera, Access: Pickup, no end date → Preview change', expected: 'Before: no grant; after: pickup access to all of Alex’s records; the confirmation code, Alex as the confirmer and the 30-minute rule; nothing stored', focus: '[data-flow=grant]',
      run: async () => {
        const before = await t.version();
        await grantForm('p-1', 'pickup');
        token1 = await token();
        const own = await t.agent('grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: null });
        const text = await $('[data-flow=grant]').innerText();
        check('The grant preview shows the App’s token, the required confirmer and the 30-minute rule, and stores nothing', token1 === own.preview.token && /You \(Alex Rivera\) confirm this change outside this app/.test(text) && text.includes('press Refresh') && text.includes('30 minutes') && (await $('[data-confirm-help]').innerText()).includes('works once') && JSON.stringify(before) === JSON.stringify(await t.version()));
        return 'grants.change.preview (Agent MCP) returns the same token ' + token1 + '; snapshot version ' + JSON.stringify(before) + ' unchanged';
      } },
    { title: 'Confirm before the confirmation arrives', action: 'Confirm access change', expected: 'A waiting state, not an error: “Waiting for Alex Rivera to confirm”; nothing written', focus: '[data-waiting]',
      run: async () => {
        await waiting();
        const audit = await lastAudit(P + 'grants.change.confirm');
        check('Confirm without a confirmation shows the waiting state and writes nothing', (await grantOf('p-2', 'p-1', 'pickup')).length === 0 && await $('[data-flow=grant] [role=alert]').count() === 0 && audit && audit.decision === 'deny' && audit.reason === 'confirmation_required');
        return 'snapshot: no grant on p-2; audit row for grants.change.confirm: ' + audit.decision + ' (' + audit.reason + ')';
      } },
    { title: 'Infra applies the confirmation and Refresh shows it', action: '`node apps/mendwell-pharmacy/dev/confirm.cjs <run> <token>`, then Refresh', expected: 'Confirmation “Confirmed at 12:00 PM EST, valid until 12:30 PM EST”', focus: '[data-approval-state]',
      run: async () => {
        t.confirm(token1);
        await t.refresh();
        await $('[data-approval-state=active]').waitFor();
        const a = await approval(token1);
        check('After Refresh the page shows the confirmation applied through dev/confirm.cjs, valid until 12:30 PM EST', (await $('[data-approval-state=active]').innerText()).includes('valid until 12:30 PM EST') && a.length === 1 && a[0].confirmed_by === 'p-2' && a[0].used_at === null);
        return 'snapshot approvals: ' + a.map(x => x.approval_id + ' by ' + x.confirmed_by + ' at ' + x.confirmed_at + ', unused').join('; ');
      } },
    { title: 'Confirm commits the grant', action: 'Confirm access change', expected: 'Grant g-3: Sam has pickup access to Alex’s records; the confirmation is used', focus: '[data-grant=g-3]',
      run: async () => {
        await confirmClick();
        await flash('Gave Sam Rivera pickup access. Reference g-3.');
        const g = await grant('g-3'), a = await approval(token1);
        check('Confirm commits g-3 and uses the confirmation', g && g.patient_id === 'p-2' && g.grantee_id === 'p-1' && g.scope === 'pickup' && g.status === 'active' && a[0].used_at !== null && await $('[data-grant=g-3][data-state=active]').count() === 1);
        check('The used confirmation is listed as used', (await $('[data-approval-token="' + token1 + '"][data-state=used]').innerText()).includes('Used'));
        return 'g-3 ' + g.scope + ' ' + g.patient_id + '→' + g.grantee_id + ' ' + g.status + ', version ' + g.grant_version + '; approval used at ' + a[0].used_at;
      } },
    { title: 'Preview a view grant with an end date and wait', action: 'Give access → Sam, View, ends 2026-12-31 00:00 → Preview change → Confirm access change', expected: 'The end shows as Thu, Dec 31, 2026, 12:00 AM EST; Confirm waits for the confirmation', focus: '[data-flow=grant]',
      run: async () => {
        await grantForm('p-1', 'view', '2026-12-31');
        token2 = await token();
        check('The end of access is entered and shown in Eastern Time', (await $('[data-after]').innerText()).includes('Thu, Dec 31, 2026, 12:00 AM EST'));
        await waiting();
        const audit = await lastAudit(P + 'grants.change.confirm');
        check('Confirm waits for the confirmation and stores no view grant', (await grantOf('p-2', 'p-1', 'view')).length === 0 && audit.reason === 'confirmation_required' && (await approval(token2)).length === 0);
        return 'token ' + token2 + '; no view grant on p-2 in the snapshot; audit ' + audit.decision + ' (' + audit.reason + ')';
      } },
    { title: 'An expired confirmation is refused', action: 'dev/confirm.cjs at 12:00; Infra moves the clock to 12:31 (env.advance_time); Refresh; Confirm access change', expected: 'The confirmation shows as expired; Confirm shows confirmation_invalid with no success message; nothing written', focus: '[data-flow=grant]',
      run: async () => {
        t.confirm(token2);
        await t.advance('2026-11-18T12:31:00-05:00');
        await t.refresh();
        await $('[data-approval-state=expired]').waitFor();
        await confirmClick();
        await alert('confirmation_invalid');
        const a = await approval(token2);
        check('An expired confirmation is refused as confirmation_invalid with no success message and no grant', await $('[data-flash]').count() === 0 && (await grantOf('p-2', 'p-1', 'view')).length === 0 && a.length === 1 && a[0].used_at === null);
        check('Once refused, the preview shows the expired confirmation and no longer says it is waiting', await $('[data-waiting]').count() === 0 && await $('[data-approval-state=expired]').count() === 1);
        return 'snapshot: no view grant; approval ' + a[0].approval_id + ' confirmed ' + a[0].confirmed_at + ' unused (expired at 12:30)';
      } },
    { title: 'Discard the preview', action: 'Discard', expected: 'The preview closes; nothing written', focus: '[data-action=open-grant]',
      run: async () => {
        const n = (await data()).grants.length;
        await click('[data-action=discard-flow]');
        await $('[data-flow]').waitFor({ state: 'detached' });
        check('Discard closes the preview and writes nothing', (await data()).grants.length === n);
        return 'grants in the snapshot: ' + n + ' (unchanged)';
      } },
    { title: 'A confirmation from someone else is refused', action: 'Give access → Sam, View, no end date → Preview change → Confirm (waits) → dev/confirm.cjs --by p-1 (Sam confirms instead of Alex) → Refresh → Confirm access change', expected: 'confirmation_invalid with no success message and no waiting note; no grant written; the stored confirmation names Sam and stays unused', focus: '[data-flow=grant]',
      run: async () => {
        await grantForm('p-1', 'view');
        const other = await token();
        await waiting();
        t.confirm(other, 'p-1');
        await t.refresh();
        await confirmClick();
        await alert('confirmation_invalid');
        const a = await approval(other);
        check('A confirmation given by the wrong person is refused as confirmation_invalid and writes nothing', await $('[data-flash]').count() === 0 && await $('[data-waiting]').count() === 0 && (await grantOf('p-2', 'p-1', 'view')).length === 0 && a.length === 1 && a[0].confirmed_by === 'p-1' && a[0].used_at === null);
        return 'approval ' + a[0].approval_id + ' by ' + a[0].confirmed_by + ', unused; no view grant on p-2';
      } },
    { title: 'A mistyped run gets no confirmation', action: 'Discard the refused change; `dev/confirm.cjs` with a run name that does not exist', expected: 'The helper refuses before opening Infra; no run is created', focus: '[data-list=people]',
      run: async () => {
        await click('[data-action=discard-flow]');
        await $('[data-flow]').waitFor({ state: 'detached' });
        const typo = t.run + '-typo', out = spawnSync(process.execPath, [path.join(appDir, 'dev/confirm.cjs'), typo, 'tok-grant-patient-p-2-00000000000000000000000000000000', '--state-dir', t.stateDir, '--registry', t.host.registry], { encoding: 'utf8' });
        check('dev/confirm.cjs refuses a run that has no state and creates nothing', out.status !== 0 && /No Mendwell run/.test(out.stderr) && !fs.existsSync(path.join(t.stateDir, typo)));
        const approvals = (await data()).approvals.length, helper = extra => spawnSync(process.execPath, [path.join(appDir, 'dev/confirm.cjs'), t.run, 'tok-grant-patient-p-2-00000000000000000000000000000000', '--state-dir', t.stateDir, '--registry', t.host.registry, ...extra], { encoding: 'utf8' });
        const noValue = helper(['--by']), unknown = helper(['--bye', 'p-1']);
        check('dev/confirm.cjs refuses an option without its value and an unknown option before issuing any event', noValue.status !== 0 && /--by needs a value/.test(noValue.stderr) && unknown.status !== 0 && /Unknown option --bye/.test(unknown.stderr) && (await data()).approvals.length === approvals);
        return 'exit ' + out.status + ': ' + out.stderr.trim() + ' | --by without a value: ' + noValue.stderr.split('\n')[0] + ' | --bye: ' + unknown.stderr.split('\n')[0];
      } },
    { title: 'An unknown person ID is named as such', action: 'Give access → Someone else (enter their ID) → p-99 → Preview change', expected: '“No person with that ID”; nothing is previewed', focus: '[role=alert][data-code=not_found]',
      run: async () => {
        await click('[data-action=open-grant]');
        await $('[data-field=grantee]').selectOption('other');
        await $('[data-field=grantee-other]').fill('p-99');
        await click('[data-action=preview-grant]');
        await alert('not_found');
        check('An unknown typed person ID is answered with “No person with that ID”, and no preview is shown', (await $('[role=alert][data-code=not_found]').innerText()).startsWith('No person with that ID') && await $('[data-flow]').count() === 0);
        return 'grants.change.preview refused as not_found; shown as an unknown person ID';
      } },
    { title: 'An access change Mendwell cannot make is explained', action: 'Person: Sam Rivera, Access: Pickup, no end date (he already has exactly this access) → Preview change; then Access: View, ends 17 November 2026 (already passed) → Preview change', expected: '“already has exactly this access”, then “That end time has already passed”; nothing is previewed', focus: '[role=alert][data-code=invalid_state]',
      run: async () => {
        const refused = async () => {
          const answered = page.waitForResponse(r => r.url().endsWith('/api/call') && r.request().postDataJSON()?.name === P + 'grants.change.preview');
          await click('[data-action=preview-grant]');
          await answered;
          await $('[role=alert][data-code=invalid_state]').waitFor();
          await t.settled();
          return $('[role=alert][data-code=invalid_state]').innerText();
        };
        await $('[data-field=grantee]').selectOption('p-1');
        await $('[data-scope=pickup]').check();
        await $('[data-field=grant-date]').fill('');
        await $('[data-field=grant-time]').fill('');
        const same = await refused(), held = (await grantOf('p-2', 'p-1', 'pickup')).filter(g => g.status === 'active');
        await $('[data-scope=view]').check();
        await $('[data-field=grant-date]').fill('2026-11-17');
        await $('[data-field=grant-time]').fill('00:00');
        const past = await refused();
        check('A grant preview Mendwell refuses as invalid_state is explained for grants: the same access already held, and an end time that has passed, with no App wording, ID or time', held.length === 1 && held[0].expires_at === null && same.startsWith('This person already has exactly this access') && past.startsWith('That end time has already passed') && ![same, past].some(x => /Grant g-|expiry|2026-11|not after/.test(x)) && await $('[data-flow]').count() === 0);
        return 'grants.change.preview refused twice as invalid_state (Sam already holds ' + held[0].grant_id + ', pickup, no end; an end of 2026-11-17 00:00 has passed)';
      } },
    { title: 'After a reload, the same preview again', action: 'Close the form; Give access → Sam, Refill → Preview change → Confirm (waits) → dev/confirm.cjs → reload the page → Give access → Sam, Refill → Preview change', expected: 'The panel says that after a reload the same change is previewed again; after the reload the preview is gone (the page keeps no business state in the browser) and “Your confirmations” lists the active confirmation; previewing the same change again gives the same code, already confirmed', focus: '[data-flow=grant]',
      run: async () => {
        await $('[data-form=grant]').getByRole('button', { name: 'Close', exact: true }).click();
        await grantForm('p-1', 'refill');
        token3 = await token();
        check('The preview panel says how the confirmation is given in this local preview without naming a command, and what to do after a reload', (await $('[data-local-preview]').innerText()).includes('local preview') && (await $('[data-reload-help]').innerText()).includes('preview the same change again') && !/confirm\.cjs|node /.test(await $('[data-flow]').innerText()));
        await waiting();
        t.confirm(token3);
        await page.reload();
        await t.idle();
        await t.settled();
        await nav('Household');
        await $('[data-approval-token="' + token3 + '"][data-state=active]').waitFor();
        const gone = await $('[data-flow]').count() === 0;
        const stored = await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage).filter(k => k !== 'mendwell-pharmacy-section')]);
        await grantForm('p-1', 'refill');
        const a = await approval(token3);
        check('After a reload no preview is kept in the browser, the confirmation stays listed, and the same preview gets the same code, already confirmed', gone && JSON.stringify(stored) === '[[],[]]' && await token() === token3 && await $('[data-approval-state=active]').count() === 1 && a.length === 1 && a[0].used_at === null && a[0].confirmed_by === 'p-2');
        return 'approval ' + a[0].approval_id + ' for ' + token3 + ' in the snapshot, confirmed ' + a[0].confirmed_at + ', unused; browser storage holds no business state';
      } },
    { title: 'Confirm the same preview', action: 'Confirm access change', expected: 'Confirm commits g-4', focus: '[data-grant=g-4]',
      run: async () => {
        await confirmClick();
        await flash('Gave Sam Rivera refill access. Reference g-4.');
        const g = await grant('g-4');
        check('Confirm commits the refill grant g-4', g && g.scope === 'refill' && g.status === 'active');
        return 'g-4 refill p-2→p-1 active, version ' + g.grant_version;
      } },
    { title: 'A preview made stale by another change sends nothing', action: 'Revoke g-4 → Confirm (waits) → dev/confirm.cjs → Infra grant.changed gives g-4 an end date → Confirm revocation (no Refresh)', expected: 'Confirm re-previews, finds a new code and changed details, shows the updated preview and sends no write; g-4 stays active', focus: '[data-flow=revoke]',
      run: async () => {
        await click('[data-action=revoke][data-grant-id=g-4]');
        await $('[data-flow=revoke]').waitFor();
        await t.settled();
        revokeToken = await token();
        await waiting();
        t.confirm(revokeToken);
        await t.event('grant.changed', { grant_id: 'g-4', patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-1', scope: 'refill', fill_id: null, expires_at: '2027-01-31T00:00:00-05:00', status: 'active' });
        const audits = (await t.snapshot()).audit.filter(a => a.tool === P + 'grants.change.confirm').length;
        await confirmClick();
        await alert('preview_changed');
        const g = await grant('g-4');
        check('A preview changed by another write is caught before sending: new code shown, no confirm sent, g-4 still active', await $('[data-changed]').count() === 1 && await token() !== revokeToken && g.status === 'active' && g.expires_at === '2027-01-31T00:00:00-05:00' && (await t.snapshot()).audit.filter(a => a.tool === P + 'grants.change.confirm').length === audits);
        return 'g-4 active, ends ' + g.expires_at + ', version ' + g.grant_version + '; no grants.change.confirm audit row after the event';
      } },
    { title: 'Discard the updated preview', action: 'Discard', expected: 'g-4 stays active with the end date from the other change', focus: '[data-grant=g-4]',
      run: async () => {
        await click('[data-action=discard-flow]');
        await $('[data-flow]').waitFor({ state: 'detached' });
        const g = await grant('g-4');
        check('The grant list shows the end date set by the other change', (await $('[data-grant=g-4]').innerText()).includes('Sun, Jan 31, 2027, 12:00 AM EST') && g.status === 'active' && g.expires_at === '2027-01-31T00:00:00-05:00');
        return 'g-4 ' + g.status + ', ends ' + g.expires_at;
      } }
  ] };

  const w2 = { id: 'w2-prescriptions', title: 'W2 Prescriptions, fills and renewals', summary: 'Alex’s levothyroxine has no fills left and a pending renewal. The page shows the App’s refusal, withdraws and re-sends the renewal, sees a late reply ignored, is refused a write based on an outdated view, and requests a fill on the renewed prescription with the reply lost and retried.', steps: [
    { title: 'A prescription with no fills left offers no fill request', action: 'Prescriptions → levothyroxine (Alex)', expected: 'No “Request a fill”; the page says no fills are left and to ask for a renewal. The App itself refuses such a request (no_fills_remaining), checked here with a direct Agent call', focus: '[data-no-fills]',
      run: async () => {
        await openRx('rx-5');
        const n = (await data()).fills.filter(f => f.rx_id === 'rx-5').length;
        const own = await t.agent('fills.request', { rx_id: 'rx-5', store_id: 'st-1', quantity: 90, expected_version: await t.version(), request_id: 'agent-no-fills' });
        check('A prescription with no fills left offers no fill request and says why; the App refuses one and creates nothing', await $('[data-action=open-request]').count() === 0 && (await $('[data-no-fills]').innerText()).includes('renewal') && own.status === 'no_fills_remaining' && (await data()).fills.filter(f => f.rx_id === 'rx-5').length === n);
        const audit = await lastAudit(P + 'fills.request');
        return 'Agent fills.request → ' + own.status + '; fills on rx-5 in the snapshot: ' + n + ' (unchanged); audit: ' + audit.decision + ' (' + audit.reason + ')';
      } },
    { title: 'Withdraw the pending renewal', action: 'Withdraw renewal request → the page asks first → Withdraw renewal request', expected: 'rn-2 withdrawn', focus: '[data-renewal=rn-2]',
      run: async () => {
        await click('[data-action=withdraw-renewal]');
        await $('[data-ask]').waitFor();
        check('Withdrawing asks for confirmation first and sends nothing yet', (await $('[data-ask]').innerText()).includes('ignored') && (await data()).renewals.find(r => r.renewal_id === 'rn-2').state === 'pending');
        await click('[data-action=ask-yes]');
        await flash('Withdrew the renewal request; a later reply will be ignored. Reference rn-2.');
        const rn = (await data()).renewals.find(r => r.renewal_id === 'rn-2');
        check('Withdraw renewal request withdraws rn-2', rn.state === 'withdrawn' && await $('[data-renewal=rn-2][data-state=withdrawn]').count() === 1);
        return 'rn-2 ' + rn.state;
      } },
    { title: 'Ask for a new renewal', action: 'Ask for a renewal → note “Last refill used; please renew.” → Send renewal request', expected: 'rn-3 pending with the note', focus: '[data-renewal=rn-3]',
      run: async () => {
        await click('[data-action=open-renewal]');
        await $('[data-field=renewal-note]').fill('Last refill used; please renew.');
        await page.evaluate(() => { window.staleSeen = 0; window.statusSeen = []; new MutationObserver(() => { if (document.querySelector('[data-stale]')) window.staleSeen++; window.statusSeen.push(document.getElementById('status').textContent); }).observe(document.querySelector('#app'), { childList: true, subtree: true, characterData: true }); });
        await click('[data-action=send-renewal]');
        await flash('to renew levothyroxine sodium. The reply will arrive later. Reference rn-3.');
        const rn = (await data()).renewals.find(r => r.renewal_id === 'rn-3');
        check('A renewal request is created with its note', rn && rn.state === 'pending' && rn.note === 'Last refill used; please renew.');
        const seen = await page.evaluate(() => ({ stale: window.staleSeen, status: [...new Set(window.statusSeen)] }));
        check('A successful save never shows the “could not load” warning; the status goes from working to refreshing to saved', seen.stale === 0 && !seen.status.some(x => /could not load/.test(x)) && seen.status.includes('Saved. Loading the latest state…') && (await $('#status').innerText()).trim() === 'All changes saved');
        return 'rn-3 ' + rn.state + ' on ' + rn.rx_id + ', note “' + rn.note + '”';
      } },
    { title: 'A reply to the withdrawn renewal changes nothing', action: 'Infra renewal.replied rn-2 approved (new Rx rx-20); Refresh', expected: 'Committed as a no-op: no new prescription; rn-2 stays withdrawn', focus: '[data-renewal=rn-2]',
      run: async () => {
        await t.event('renewal.replied', { renewal_id: 'rn-2', decision: 'approved', rx: { rx_id: 'rx-20', quantity: 90, fills_authorized: 3, written_on: '2026-11-18' } });
        await t.refresh();
        const d = await data();
        check('A reply after the withdrawal adds no prescription', !d.prescriptions.some(r => r.rx_id === 'rx-20') && d.renewals.find(r => r.renewal_id === 'rn-2').state === 'withdrawn' && await $('[data-rx-id=rx-20]').count() === 0);
        return 'event committed; no rx-20 in the snapshot; rn-2 withdrawn';
      } },
    { title: 'A write based on an outdated view is refused', action: 'Infra renewal.replied approves rn-3 with rx-10 (the page is not refreshed); Withdraw renewal request', expected: 'stale_version, shown apart from other refusals; nothing withdrawn; the page refreshes', focus: '[role=alert][data-code=stale_version]',
      run: async () => {
        await t.event('renewal.replied', { renewal_id: 'rn-3', decision: 'approved', rx: { rx_id: 'rx-10', quantity: 90, fills_authorized: 5, written_on: '2026-11-18' } });
        await click('[data-action=withdraw-renewal]');
        await click('[data-action=ask-yes]');
        await alert('stale_version');
        const d = await data();
        check('A write after a change the page has not read is refused as stale_version', d.renewals.find(r => r.renewal_id === 'rn-3').state === 'approved' && d.prescriptions.find(r => r.rx_id === 'rx-5').state === 'superseded');
        return 'rn-3 approved → rx-10; rx-5 superseded by ' + d.prescriptions.find(r => r.rx_id === 'rx-5').superseded_by;
      } },
    { title: 'The renewed prescription', action: 'Open levothyroxine rx-10', expected: 'rx-5 shows as replaced; rx-10 has 5 of 5 fills left', focus: 'article[data-rx=rx-10]',
      run: async () => {
        check('The old prescription shows it was replaced', await $('article[data-rx=rx-5] [data-rx-state=superseded]').count() === 1);
        await openRx('rx-10');
        const d = await data(), stored = d.prescriptions.find(x => x.rx_id === 'rx-10'), old = d.prescriptions.find(x => x.rx_id === 'rx-5');
        check('The new prescription has 5 of 5 fills left', await $('[data-fills-left="5"]').count() === 1 && stored.fills_remaining === 5 && stored.fills_authorized === 5 && old.superseded_by === 'rx-10');
        const r = (await t.agent('rx.get', { rx_id: 'rx-10' })).prescription;
        return 'snapshot rx-10: ' + stored.fills_remaining + ' of ' + stored.fills_authorized + ' left, rx-5 superseded by ' + old.superseded_by + '; rx.get rx-10: ' + r.state + ', expires ' + r.expires_at;
      } },
    { title: 'A request whose reply is lost', action: 'Request a fill → Maple Avenue, 90 → Request fill; the reply is dropped after the commit', expected: '“Waiting for Mendwell” with Retry and no success message; the App already holds the fill', focus: '[aria-label="Waiting for Mendwell"]',
      run: async () => {
        await click('[data-action=open-request]');
        await $('[data-field=request-store]').selectOption('st-1');
        t.allowConsole(/net::ERR_FAILED/);
        const lost = await t.dropAfterCommit(p => p.name === P + 'fills.request');
        await click('[data-action=request-fill]');
        await alert('connection_lost');
        await t.release();
        const made = (await data()).fills.filter(f => f.rx_id === 'rx-10');
        check('After the refresh settles, the status says the outcome cannot be confirmed, not that nothing changed', (await $('#status').innerText()).includes('cannot be confirmed') && !(await $('#status').innerText()).includes('Nothing was changed'));
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await t.settled();
        check('A manual Refresh while the request is unanswered never says “All changes saved”', (await $('#status').innerText()).includes('cannot be confirmed') && await $('[data-action=retry-unknown]').count() === 1);
        check('A request whose reply is dropped after the commit offers Retry, not success', lost.forwarded?.status === 'committed' && made.length === 1 && await $('[data-flash]').count() === 0 && await $('[data-action=retry-unknown]').count() === 1);
        return 'dropped reply was ' + lost.forwarded.status + ' (' + lost.forwarded.fill.fill_id + '); fills on rx-10 in the snapshot: ' + made.length;
      } },
    { title: 'A new change waits while that request is unanswered', action: 'The levothyroxine form closes (the App now shows a fill under review); Prescriptions → lisinopril → Request a fill → Maple Avenue → Request fill', expected: 'Refused on the page (unanswered); nothing sent', focus: '[role=alert][data-code=unanswered]',
      run: async () => {
        const closed = await $('[data-form=request]').count() === 0;
        await openRx('rx-6');
        await click('[data-action=open-request]');
        await $('[data-field=request-store]').selectOption('st-1');
        const audits = (await t.snapshot()).audit.length;
        await click('[data-action=request-fill]');
        await alert('unanswered');
        const d = await t.snapshot();
        check('While the first request is unanswered, another change is refused on the page and nothing is sent', closed && d.data.fills.filter(f => f.rx_id === 'rx-10').length === 1 && !d.data.fills.some(f => f.rx_id === 'rx-6' && ACTIVE.includes(f.state)) && d.audit.length === audits);
        return 'fills on rx-10: 1; no new fill on rx-6; no audit row added';
      } },
    { title: 'Retry returns the stored receipt', action: 'Close the form; Retry', expected: 'The page says the request had already gone through; still one fill, now selected', focus: '[data-flash]',
      run: async () => {
        await $('[data-form=request]').getByRole('button', { name: 'Close', exact: true }).click();
        await $('[data-form=request]').waitFor({ state: 'detached' });
        const [reply] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/call') && r.request().postDataJSON().name === P + 'fills.request'), click('[data-action=retry-unknown]')]);
        const body = await reply.json();
        await flash('had already gone through');
        const made = (await data()).fills.filter(f => f.rx_id === 'rx-10');
        check('Retry replays the stored receipt (duplicate) and the fill exists once', body.duplicate === true && made.length === 1 && await $('article[data-fill="' + made[0].fill_id + '"]').count() === 1);
        t.report.receipts.push({ kind: 'gui_retry', tool: P + 'fills.request', fill_id: made[0].fill_id, retry: body.status, duplicate: body.duplicate });
        t.lev = made[0].fill_id;
        return 'retry answer: ' + body.status + ', duplicate ' + body.duplicate + '; ' + brief(made[0]) + ', review due ' + made[0].review_due_at;
      } },
    { title: 'A request lost before it reached Mendwell is not applied', action: 'Prescriptions → lisinopril → Request a fill → Maple Avenue, the request dropped before it is sent; Infra moves the clock one minute; Retry', expected: '“Waiting for Mendwell” with Retry; the retry is refused as stale_version and the page says the request was not applied; nothing created', focus: '[role=alert][data-code=not_applied]',
      run: async () => {
        await openRx('rx-6');
        if (await $('[data-form=request]').count() === 0) await click('[data-action=open-request]');
        await $('[data-field=request-store]').selectOption('st-1');
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'fills.request');
        await click('[data-action=request-fill]');
        await alert('connection_lost');
        await t.release();
        await t.advance('2026-11-18T12:32:00-05:00');
        await click('[data-action=retry-unknown]');
        await alert('not_applied');
        const d = await data();
        check('A request that never reached Mendwell, retried after another change, is reported as not applied and nothing is created', cut.dropped && !d.fills.some(f => f.rx_id === 'rx-6' && ACTIVE.includes(f.state)) && await $('[data-action=retry-unknown]').count() === 0);
        return 'retry refused (stale_version); no new fill on rx-6';
      } },
    { title: 'An untouched form follows a change made elsewhere', action: 'Close the form; Fills → the new levothyroxine fill → Change quantity (shows 90); a change made outside the page sets the quantity to 30; Refresh', expected: 'The form now shows 30 and says the fill changed; the page wrote nothing', focus: '[data-form=quantity]',
      run: async () => {
        await $('[data-form=request]').getByRole('button', { name: 'Close', exact: true }).click();
        await openFill(t.lev);
        await click('[data-action=open-quantity]');
        const opened = await $('[data-field=new-quantity]').inputValue();
        const rows = async () => (await t.snapshot()).audit.filter(a => a.tool === P + 'fills.change_quantity' && a.decision === 'allow').length, before = await rows();
        const other = await t.agent('fills.change_quantity', { fill_id: t.lev, quantity: 30, expected_version: await t.version(), request_id: 'other-client-quantity' });
        await t.refresh();
        await $('[data-form=quantity] [data-refreshed]').waitFor();
        const after = await rows();
        check('A form opened before a change made outside the page shows the current quantity after Refresh, says so, and sends nothing', opened === '90' && other.status === 'committed' && await $('[data-field=new-quantity]').inputValue() === '30' && (await fill(t.lev)).quantity === 30 && after === before + 1);
        return 'snapshot ' + t.lev + ' quantity ' + (await fill(t.lev)).quantity + '; committed change_quantity calls: ' + before + ' before, ' + after + ' after (only the change made outside the page)';
      } },
    { title: 'An edited form asks for review after a change made elsewhere', action: 'Close the form; Change store → Harbor Street (not sent); a change made outside the page moves the fill to Station Road; Refresh', expected: 'The form keeps Harbor Street, says the fill changed, and offers “Save anyway” instead of saving silently; nothing written by the page', focus: '[data-form=store]',
      run: async () => {
        await $('[data-form=quantity]').getByRole('button', { name: 'Close', exact: true }).click();
        await click('[data-action=open-store]');
        await $('[data-field=new-store]').selectOption('st-2');
        const rows = async () => (await t.snapshot()).audit.filter(a => a.tool === P + 'fills.change_store' && a.decision === 'allow').length, before = await rows();
        const other = await t.agent('fills.change_store', { fill_id: t.lev, store_id: 'st-3', expected_version: await t.version(), request_id: 'other-client-store' });
        await t.refresh();
        await $('[data-form=store] [data-conflict]').waitFor();
        const after = await rows();
        check('An edited form is kept after a change made outside the page, marked as changed and saved only through “Save anyway”', other.status === 'committed' && await $('[data-field=new-store]').inputValue() === 'st-2' && (await $('[data-action=save-store]').innerText()).trim() === 'Save anyway' && (await fill(t.lev)).store_id === 'st-3' && after === before + 1);
        return 'snapshot ' + t.lev + ' at ' + (await fill(t.lev)).store_id + '; committed change_store calls: ' + before + ' before, ' + after + ' after (only the change made outside the page)';
      } },
    { title: 'Move the fill to another store, then reload', action: 'Close the form; Change store → Maple Avenue → Move fill; reload the page; Fills → the levothyroxine fill', expected: 'Mendwell records the fill at Maple Avenue; after the reload the page shows the same fill at Maple Avenue', focus: 'article[data-fill]',
      run: async () => {
        await $('[data-form=store]').getByRole('button', { name: 'Close', exact: true }).click();
        await click('[data-action=open-store]');
        await $('[data-field=new-store]').selectOption('st-1');
        await click('[data-action=save-store]');
        await flash('Moved to Mendwell Maple Avenue');
        const moved = await fill(t.lev);
        await page.reload();
        await t.idle();
        await t.settled();
        await openFill(t.lev);
        const text = await $('article[data-fill="' + t.lev + '"]').innerText();
        check('A store change made in the browser is recorded by Mendwell (read through MCP) and the same fill shows the new store after a reload', moved.store_id === 'st-1' && text.includes('Mendwell Maple Avenue — 120 Maple Avenue') && (await fill(t.lev)).store_id === 'st-1');
        return 'snapshot ' + t.lev + ' at ' + moved.store_id + '; after the reload the page shows Mendwell Maple Avenue';
      } }
  ] };

  const w3 = { id: 'w3-claims', title: 'W3 Plan claims and recovery', summary: 'A claim rejected as too soon, with a plan request sent and withdrawn, a scheduled resubmission and a switch to the cash price; a plan approval arriving; and, once Elena shares her records, a quantity change after a quantity limit and a prior authorization denied and paid in cash.', steps: [
    { title: 'The plan rejects a refill as too soon', action: 'Infra env.advance_time past the 12:40 PM review; Refresh; Fills → sertraline (Sam)', expected: '“Rejected: too soon to refill · eligible on Wed, Jan 20, 2027”; Wait, Ask the plan, Pay the cash price, Change store and Cancel offered; times in Eastern Time while the browser runs in Asia/Tokyo', focus: 'article[data-fill=f-20]',
      run: async () => {
        await t.advance('2026-11-18T12:45:00-05:00');
        await t.refresh();
        await openFill('f-20');
        const f = (await t.agent('fills.get', { fill_id: 'f-20' })).fill, stored = await fill('f-20');
        const text = await $('article[data-fill=f-20]').innerText();
        check('A too-soon rejection shows the reason, the eligible date and the recovery actions', f.state === 'claim_rejected' && f.claim.reason === 'refill_too_soon' && text.includes('eligible on') && (await Promise.all(['wait', 'open-plan', 'preview-cash', 'open-store', 'preview-cancel'].map(a => $('[data-action=' + a + ']').count()))).every(n => n === 1));
        check('Times are shown in America/New_York, not the browser zone (' + t.report.browser_timezone + ')', text.includes('Wed, Nov 18, 2026, 10:40 AM EST') && text.includes('Wed, Nov 18, 2026, 12:40 PM EST'));
        check('The snapshot holds the review due at 12:40 PM with the clock at 12:45 PM, so the read applies the due review', stored.state === 'requested' && stored.review_due_at === '2026-11-18T12:40:00-05:00' && (await t.snapshot()).virtual_now === '2026-11-18T12:45:00-05:00');
        return 'fills.get f-20: ' + f.state + ' ' + f.claim.reason + ', eligible ' + f.claim.eligible_on + '; the snapshot still stores ' + stored.state + ' until the next write commits the review';
      } },
    { title: 'Ask the plan for an early refill', action: 'Ask the plan (opened with the keyboard) → note → Send plan request', expected: 'The note field takes the focus; then waiting for the plan’s decision with the plan request pending', focus: '[data-plan-request=pending]',
      run: async () => {
        await $('[data-action=open-plan]').focus();
        await page.keyboard.press('Enter');
        await $('[data-form=plan]').waitFor();
        check('Opening a form with the keyboard moves the focus to its first field', await page.evaluate(() => document.activeElement?.dataset.field) === 'plan-note');
        await $('[data-field=plan-note]').fill(UNSAFE);
        await click('[data-action=send-plan-request]');
        await flash('now waits for the plan');
        const f = await fill('f-20'), pr = (await data()).plan_requests.find(x => x.plan_request_id === f.plan_request_id);
        check('Ask the plan creates a pending early-refill request with the note stored as entered', f.state === 'pending_plan_decision' && pr.state === 'pending' && pr.reason === 'refill_too_soon' && pr.note === UNSAFE);
        return brief(f) + '; ' + pr.plan_request_id + ' ' + pr.state + ' (' + pr.reason + ')';
      } },
    { title: 'Withdraw the plan request', action: 'While pending, the page explains why there is no cash option; Withdraw plan request → the page asks first → Withdraw request', expected: 'Rejected by the drug plan again; the request is withdrawn; the timeline says the request was withdrawn, not rejected', focus: '[data-plan-request=withdrawn]',
      run: async () => {
        check('While the plan request is pending, the page explains that the cash price needs the request withdrawn first', await $('[data-action=preview-cash]').count() === 0 && (await $('[data-cash-hint]').innerText()).includes('withdraw the plan request first'));
        await click('[data-action=withdraw-plan]');
        await $('[data-ask]').waitFor();
        check('Withdrawing a plan request asks first and sends nothing yet', (await fill('f-20')).state === 'pending_plan_decision');
        await click('[data-action=ask-yes]');
        await flash('a later decision will be ignored');
        const f = await fill('f-20'), pr = (await data()).plan_requests.find(x => x.plan_request_id === f.plan_request_id);
        check('Withdraw plan request returns the fill to claim_rejected', f.state === 'claim_rejected' && pr.state === 'withdrawn');
        check('The timeline labels the step as the user’s withdrawal, in order', (await $('[data-timeline] li').last().innerText()).includes('Plan request withdrawn') && await $('ol[data-timeline]').count() === 1);
        return brief(f) + '; ' + pr.plan_request_id + ' ' + pr.state;
      } },
    { title: 'Ask again and withdraw again', action: 'Ask the plan → Send plan request; Withdraw plan request → Withdraw request', expected: 'The latest withdrawal is labelled as such; the earlier request, whose outcome Mendwell no longer returns, says so instead of a guess', focus: 'ol[data-timeline]',
      run: async () => {
        await click('[data-action=open-plan]');
        await click('[data-action=send-plan-request]');
        await flash('now waits for the plan');
        const between = await $('[data-timeline] li').allInnerTexts();
        await click('[data-action=withdraw-plan]');
        await click('[data-action=ask-yes]');
        await flash('a later decision will be ignored');
        const labels = await $('[data-timeline] li').allInnerTexts(), withdrawn = labels.filter(x => x.includes('Plan request withdrawn')).length;
        const f = await fill('f-20');
        const unknownEnd = x => x.includes('does not report how this earlier request ended');
        check('Timeline labels come only from the current read: once a new request is sent, the earlier one says Mendwell does not report how it ended; the latest withdrawal is labelled as such', between.filter(x => x.includes('Plan request withdrawn')).length === 0 && between.filter(unknownEnd).length === 1 && withdrawn === 1 && labels.filter(unknownEnd).length === 1 && labels.at(-1).includes('Plan request withdrawn') && f.state === 'claim_rejected');
        return 'timeline: ' + labels.map(x => x.split('\n').pop()).join(' → ');
      } },
    { title: 'Resubmit on the eligible date; the refresh after it fails', action: 'Resubmit to the plan on Wed, Jan 20, 2027 → the page explains and asks → Schedule resubmission, with the page’s next tool discovery failing; then Ask the plan → Send plan request; then Refresh', expected: 'The resubmission is stored at 12:00 AM on the eligible date; the page says the change was saved and asks for Refresh; until a Refresh succeeds, the next write is refused with refresh_needed and nothing is sent', focus: '[data-time=resubmission_due_at]',
      run: async () => {
        check('The wait action is labelled by what it does', (await $('[data-action=wait]').innerText()).trim() === 'Resubmit to the plan on Wed, Jan 20, 2027');
        await click('[data-action=wait]');
        await $('[data-ask]').waitFor();
        t.allowConsole(/net::ERR_FAILED/);
        await t.failNextDiscovery();
        await click('[data-action=ask-yes]');
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        const f = await fill('f-20'), audits = (await t.snapshot()).audit.length;
        check('Scheduling stores one resubmission at midnight on the eligible date, even though the refresh after it failed, and the page asks for Refresh', typeof f.resubmission_due_at === 'string' && f.resubmission_due_at.slice(11, 16) === '00:00' && f.state === 'claim_rejected' && (await $('#status').innerText()).includes('Press Refresh') && await $('[data-stale]').count() === 1);
        await click('[data-action=open-plan]');
        await click('[data-action=send-plan-request]');
        await alert('refresh_needed');
        check('After the failed refresh a second write is refused until Refresh succeeds, and nothing is sent', (await t.snapshot()).audit.length === audits && (await fill('f-20')).plan_request_id === f.plan_request_id);
        await $('[data-form=plan]').getByRole('button', { name: 'Close', exact: true }).click();
        await t.refresh();
        check('Refresh succeeds and shows the scheduled resubmission', await $('[data-time=resubmission_due_at]').count() === 1 && (await $('#status').innerText()).trim() === 'All changes saved');
        return 'f-20 resubmission_due_at ' + f.resubmission_due_at + '; no audit row while locked';
      } },
    { title: 'The cash preview lists what changes', action: 'Pay the cash price', expected: 'Cash price $54.00 at Maple Avenue; the fill becomes Ready for pickup; the scheduled resubmission is cleared; nothing stored', focus: '[data-flow=cash]',
      run: async () => {
        const before = await t.version();
        await click('[data-action=preview-cash]');
        await $('[data-flow=cash]').waitFor();
        await t.settled();
        const own = (await t.agent('fills.choose_cash.preview', { fill_id: 'f-20' })).preview;
        check('The cash preview shows the App’s price, store, resulting state and cleared resubmission, and stores nothing', Number(await $('[data-price]').getAttribute('data-price')) === own.changes.price_cents && await $('[data-result]').getAttribute('data-result') === own.changes.resulting_state && await $('[data-cleared]').getAttribute('data-cleared') === own.changes.cleared_resubmission.due_at && JSON.stringify(before) === JSON.stringify(await t.version()));
        return 'choose_cash.preview: ' + JSON.stringify(own.changes);
      } },
    { title: 'Confirm the cash price', action: 'Confirm cash price', expected: 'Ready for pickup with $54.00 due; resubmission cleared', focus: 'article[data-fill=f-20]',
      run: async () => {
        await confirmClick();
        await flash('Switched to the cash price; ready for pickup.');
        const f = await fill('f-20');
        check('Confirm switches the fill to cash: ready, $54.00 due, no resubmission', f.state === 'ready' && f.cash.price_cents === 5400 && f.amount_due_cents === 5400 && f.resubmission_due_at === null);
        return brief(f) + ', cash ' + f.cash.price_cents + ', resubmission ' + f.resubmission_due_at;
      } },
    { title: 'A plan approval arrives', action: 'Infra plan.decided pr-12 approved; Refresh; Fills → metformin (Alex)', expected: 'Ready for pickup with nothing due (the plan’s copay is $0.00); no Prepay offered', focus: 'article[data-fill=f-16]',
      run: async () => {
        await t.event('plan.decided', { plan_request_id: 'pr-12', decision: 'approved' });
        await t.refresh();
        await openFill('f-16');
        const f = await fill('f-16');
        check('The timeline names the approval from the plan request the App returns', (await $('article[data-fill=f-16] [data-timeline] li').last().innerText()).includes('The plan approved the request; ready for pickup'));
        check('An approved plan request resubmits the claim and the fill is ready with nothing due', f.state === 'ready' && f.amount_due_cents === 0 && await $('[data-action=open-prepay]').count() === 0 && (await $('article[data-fill=f-16] [data-due]').innerText()).includes('Nothing'));
        return brief(f) + '; pr-12 ' + (await data()).plan_requests.find(x => x.plan_request_id === 'pr-12').state;
      } },
    { title: 'Elena shares her records', action: 'Infra grant.changed: Elena gives Alex refill access (g-20); Refresh; Household', expected: 'Elena Ortiz is listed with refill access; her warfarin fill appears, rejected for the quantity limit', focus: '[data-person-id=p-4]',
      run: async () => {
        await t.event('grant.changed', { grant_id: 'g-20', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'active' });
        await t.refresh();
        await nav('Household');
        await $('[data-person-id=p-4]').waitFor();
        const visible = (await t.agent('fills.list', { patient_id: 'p-4' })).fills, g = await grant('g-20');
        check('After the grant and Refresh, Elena and her fills are visible', (await $('[data-person-id=p-4]').innerText()).includes('Elena Ortiz') && visible.some(f => f.fill_id === 'f-18' && f.state === 'claim_rejected') && g.status === 'active' && g.scope === 'refill' && g.grantee_id === 'p-2');
        return 'g-20 refill p-4→p-2 active; fills.list(p-4): ' + visible.filter(f => ['f-15', 'f-18'].includes(f.fill_id)).map(f => f.fill_id + ' ' + f.state).join(', ');
      } },
    { title: 'Change to a quantity the plan allows', action: 'Fills → warfarin (Elena) → Change quantity → 30 → Save quantity', expected: 'The claim is resubmitted: the plan accepts 30 but rejects the refill as too soon (eligible Tue, Nov 24, 2026), so Wait is offered', focus: 'article[data-fill=f-18]',
      run: async () => {
        await openFill('f-18');
        await click('[data-action=open-quantity]');
        await $('[data-field=new-quantity]').fill('45');
        await click('[data-action=save-quantity]');
        await alert('quantity_not_allowed');
        check('A quantity the medicine does not come in is refused with the quantities it does come in', (await $('[role=alert][data-code=quantity_not_allowed]').innerText()).includes('it comes in 30 or 90') && (await fill('f-18')).quantity === 90);
        await $('[data-field=new-quantity]').fill('30');
        await click('[data-action=save-quantity]');
        await flash('Quantity changed to 30');
        const f = (await t.agent('fills.get', { fill_id: 'f-18' })).fill, stored = await fill('f-18'), cl = (await data()).claims.find(c => c.claim_id === stored.claim_id);
        check('Changing the quantity resubmits the claim with the new quantity', f.quantity === 30 && f.claim.attempt === 2 && f.claim.reason === 'refill_too_soon' && f.claim.eligible_on === '2026-11-24' && await $('[data-action=wait]').count() === 1 && stored.quantity === 30 && cl.attempt === 2 && cl.reason === 'refill_too_soon');
        return 'f-18 quantity ' + f.quantity + ', claim attempt ' + f.claim.attempt + ' ' + f.claim.result + ' ' + f.claim.reason + ' (eligible ' + f.claim.eligible_on + ')';
      } },
    { title: 'Request a new prescription that needs prior authorization', action: 'Infra rx.received donepezil rx-9 for Elena; Refresh; Prescriptions → donepezil → Request a fill → Station Road, 30 → Request fill', expected: 'Fill requested; the pharmacist review is due 2 hours later', focus: 'article[data-state=requested]',
      run: async () => {
        await t.event('rx.received', { rx_id: 'rx-9', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-donepezil-5', quantity: 30, fills_authorized: 3, written_on: '2026-11-18' });
        await t.refresh();
        await openRx('rx-9');
        await click('[data-action=open-request]');
        await $('[data-field=request-store]').selectOption('st-3');
        await click('[data-action=request-fill]');
        await flash('Requested donepezil');
        const f = (await data()).fills.find(x => x.rx_id === 'rx-9');
        check('The fill on the new prescription is requested with a review due two hours later', f && f.state === 'requested' && f.review_due_at === '2026-11-18T14:45:00-05:00' && await $('article[data-fill="' + f.fill_id + '"]').count() === 1);
        t.pa = f.fill_id;
        return brief(f) + ', review due ' + f.review_due_at;
      } },
    { title: 'The review needs prior authorization; ask the plan', action: 'Infra env.advance_time to 3:00 PM; Refresh; Ask the plan → Send plan request', expected: '“Rejected: prior authorization required” → waiting for the plan’s decision', focus: '[data-plan-request=pending]',
      run: async () => {
        await t.advance('2026-11-18T15:00:00-05:00');
        await t.refresh();
        await openFill(t.pa);
        check('After the review the claim needs prior authorization', (await $('[data-claim]').getAttribute('data-claim')) === 'rejected:prior_auth_required');
        await click('[data-action=open-plan]');
        await click('[data-action=send-plan-request]');
        await flash('now waits for the plan');
        const f = await fill(t.pa), pr = (await data()).plan_requests.find(x => x.plan_request_id === f.plan_request_id);
        check('The prior-authorization request is pending', f.state === 'pending_plan_decision' && pr.reason === 'prior_auth_required' && pr.state === 'pending');
        t.paRequest = pr.plan_request_id;
        return brief(f) + '; ' + pr.plan_request_id + ' ' + pr.state + ' (' + pr.reason + ')';
      } },
    { title: 'Plan requests lists pending first', action: 'Fills → omeprazole (Sam, no plan request); Plan requests; select metformin (pr-12), then the pending prior authorization', expected: 'No fill is shown until a plan request is chosen; the pending request is listed first, then the decided and withdrawn ones; each selection opens its own fill', focus: '[data-list=plan]',
      run: async () => {
        await openFill('f-16');
        await nav('Plan requests');
        check('Plan requests keeps its own selection: coming from metformin, whose fill has a plan request, it still shows no fill and no fill action until one is chosen', await $('[data-plan-empty]').count() === 1 && await $('article[data-fill]').count() === 0 && await $('[data-action=preview-cancel]').count() === 0);
        await $('[data-list=plan] [data-plan-id=pr-12]').click();
        await $('article[data-fill=f-16] [data-plan-request=approved]').waitFor();
        await t.settled();
        check('Selecting pr-12 opens metformin (f-16)', await $('[data-list=plan] [data-plan-id=pr-12][aria-pressed=true]').count() === 1);
        const shown = await $('[data-list=plan] [data-plan-id]').evaluateAll(n => n.map(e => e.dataset.planId));
        const d = await data(), byId = Object.fromEntries(d.plan_requests.map(x => [x.plan_request_id, x]));
        const expected = d.fills.filter(f => f.plan_request_id).map(f => f.plan_request_id);
        const firstDecided = shown.findIndex(id => byId[id].state !== 'pending');
        check('Plan requests lists the current request of every fill, pending ones first, as stored', shown.length === expected.length && expected.every(id => shown.includes(id)) && shown[0] === t.paRequest && byId[t.paRequest].state === 'pending' && shown.slice(firstDecided).every(id => byId[id].state !== 'pending') && byId['pr-12'].state === 'approved' && shown.includes('pr-12'));
        await $('[data-list=plan] [data-plan-id="' + t.paRequest + '"]').click();
        await $('article[data-fill="' + t.pa + '"] [data-plan-request=pending]').waitFor();
        await t.settled();
        check('Selecting another plan request replaces the fill with its own', await $('article[data-fill="' + t.pa + '"]').count() === 1 && await $('article[data-fill=f-16]').count() === 0);
        return 'listed ' + shown.length + ' plan requests; pending: ' + shown.filter(id => byId[id].state === 'pending').join(', ') + '; then ' + [...new Set(shown.slice(firstDecided).map(id => byId[id].state))].join(', ');
      } },
    { title: 'The plan denies prior authorization', action: 'Withdraw plan request (the page asks first; left open); Infra plan.decided denied and a change made outside the page sends a new plan request; Refresh; Infra denies that one too; Refresh', expected: 'Rejected by the drug plan; the request shows as denied; the open “Withdraw the plan request?” prompt is closed because the request is no longer pending; Pay the cash price offered', focus: '[data-plan-request=denied]',
      run: async () => {
        await click('[data-action=withdraw-plan]');
        await $('[data-ask]').waitFor();
        await t.settled();
        await t.event('plan.decided', { plan_request_id: t.paRequest, decision: 'denied' });
        const newer = await t.agent('plan_requests.create', { fill_id: t.pa, expected_version: await t.version(), request_id: 'other-client-plan-request' });
        await t.refresh();
        await $('[data-plan-request=pending]').waitFor();
        await t.settled();
        check('A withdraw prompt belongs to the request it was opened for: when a change made outside the page replaced that request with a new pending one, Refresh closes the prompt', newer.status === 'committed' && await $('[data-ask]').count() === 0 && await $('[data-action=withdraw-plan]').count() === 1);
        await t.event('plan.decided', { plan_request_id: newer.plan_request.plan_request_id, decision: 'denied' });
        await t.refresh();
        await $('[data-plan-request=denied]').waitFor();
        const f = await fill(t.pa);
        check('A confirmation prompt whose action is no longer offered after Refresh is closed, so nothing stale can be sent', await $('[data-ask]').count() === 0 && await $('[data-action=ask-yes]').count() === 0 && (await t.snapshot()).audit.every(a => !(a.tool === P + 'plan_requests.withdraw' && a.reason === 'request_not_pending')));
        check('A denial returns the fill to claim_rejected with the cash option', f.state === 'claim_rejected' && await $('[data-action=preview-cash]').count() === 1);
        return brief(f) + '; ' + t.paRequest + ' ' + (await data()).plan_requests.find(x => x.plan_request_id === t.paRequest).state;
      } },
    { title: 'Pay the cash price after the denial', action: 'Pay the cash price → Confirm cash price', expected: 'Ready for pickup at Station Road with the $32.00 cash price due', focus: 'article[data-fill][data-state=ready]',
      run: async () => {
        await click('[data-action=preview-cash]');
        await $('[data-flow=cash]').waitFor();
        await t.settled();
        await confirmClick();
        await flash('Switched to the cash price');
        const f = await fill(t.pa);
        check('Cash after a denied prior authorization makes the fill ready at the cash price', f.state === 'ready' && f.amount_due_cents === 3200 && f.store_id === 'st-3');
        return brief(f) + ' at ' + f.store_id;
      } }
  ] };

  const elena = { patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2' };
  const share = async (id, scope = 'refill', fill_id = null) => t.event('grant.changed', { grant_id: id, ...elena, scope, fill_id, expires_at: null, status: 'active' });
  const unshare = async (id, scope = 'refill', fill_id = null) => t.event('grant.changed', { grant_id: id, ...elena, scope, fill_id, expires_at: null, status: 'revoked' });
  const nothingOfElena = async () => { const text = await $('.workspace').innerText(); return !/Elena|warfarin|donepezil|amlodipine|atorvastatin/i.test(text) && await $('[data-fill-id=f-18], [data-fill=f-18]').count() === 0; };
  const visibility = { id: 'w1-lost-visibility', title: 'W1 control: access changes while the page is open', summary: 'Elena revokes Alex’s refill access between two refreshes, then while the page is reading (once with the retry succeeding, once with it failing), and once while a request about her records is unanswered. Her records, the selected fill, an unsent change and the identifying text of the unanswered request disappear, and nothing of hers comes back with a later grant. A fill-limited pickup grant shows only the pickup details; a change made while the page is reading makes it read again; and when Sam reduces Alex to pickup access, Sam’s fill drops to the pickup view and its open form closes.', steps: [
    { title: 'Access ends: Refresh removes Elena’s records, the selection and a draft', action: 'Fills → warfarin (Elena) → Change store → Maple Avenue (not sent); Infra grant.changed revokes g-20; Refresh', expected: 'The page says the fill is no longer visible and removed the other records of the person who shared it; no name, drug or fill of Elena’s on screen; the store change was never sent', focus: '[data-lost]',
      run: async () => {
        await openFill('f-18');
        await click('[data-action=open-store]');
        await $('[data-field=new-store]').selectOption('st-1');
        await unshare('g-20');
        await t.refresh();
        await $('[data-lost]').waitFor();
        const f = await fill('f-18'), g = await grant('g-20');
        check('After a revocation and Refresh, Elena’s records, the selected fill and the unsent store change are gone, and nothing was written', g.status === 'revoked' && f.store_id === 'st-3' && await nothingOfElena() && await $('[data-form=store]').count() === 0);
        return 'g-20 ' + g.status + ' at ' + g.revoked_at + '; f-18 still at ' + f.store_id;
      } },
    { title: 'Access shared again: the old draft is not restored', action: 'Infra grant.changed: Elena gives Alex refill access again (g-21); Refresh; Fills → warfarin → Change store (keyboard) → Close', expected: 'Elena’s fill is back; the store form opens empty, without the earlier unsent choice, with the focus in it; Close returns the focus to Change store', focus: '[data-action=open-store]',
      run: async () => {
        await share('g-21');
        await t.refresh();
        await openFill('f-18');
        const closed = await $('[data-form=store]').count() === 0;
        await $('[data-action=open-store]').focus();
        await page.keyboard.press('Enter');
        await $('[data-form=store]').waitFor();
        const focused = await page.evaluate(() => document.activeElement?.dataset.field);
        const g = await grant('g-21');
        check('When Elena shares her records again, the earlier unsent store change is not restored', closed && await $('[data-field=new-store]').inputValue() === '' && g.status === 'active' && g.scope === 'refill');
        await $('[data-form=store]').getByRole('button', { name: 'Close', exact: true }).click();
        await $('[data-form=store]').waitFor({ state: 'detached' });
        check('The form takes the focus when opened and gives it back to its button when closed', focused === 'new-store' && await page.evaluate(() => document.activeElement?.dataset.action) === 'open-store');
        return 'g-21 ' + g.status + ' (' + g.scope + '); f-18 store ' + (await fill('f-18')).store_id;
      } },
    { title: 'Revocation between the list read and the detail read', action: 'Refresh with warfarin (Elena) selected; Infra revokes g-21 just before the page reads the fill', expected: 'The denied read discards that whole refresh: the page reads again and shows no name, drug or fill of Elena’s, with the refresh completed', focus: '[data-lost]',
      run: async () => {
        const seen = await t.beforeForward(p => p.name === P + 'fills.get' && p.arguments.fill_id === 'f-18', () => unshare('g-21'));
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('[data-lost]').waitFor();
        await t.settled();
        await t.release();
        const g = await grant('g-21');
        check('A detail read denied after the list was read discards that refresh and the reread shows nothing of Elena’s', seen.hit && g.status === 'revoked' && await nothingOfElena() && (await $('#status').innerText()).trim() === 'All changes saved');
        return 'g-21 ' + g.status + ' at ' + g.revoked_at + '; the page reread and settled with nothing of Elena’s';
      } },
    { title: 'The same revocation with the reread failing', action: 'Infra grant.changed g-22 (refill again); Refresh; Fills → warfarin; Refresh with Infra revoking g-22 just before the fill read and the reread’s first call (household.list) failing', expected: 'Nothing of Elena’s stays on screen although the reread failed; the status shows the error', focus: '[data-lost]',
      run: async () => {
        await share('g-22');
        await t.refresh();
        await openFill('f-18');
        t.allowConsole(/net::ERR_FAILED/);
        const seen = await t.beforeForward(p => p.name === P + 'fills.get' && p.arguments.fill_id === 'f-18', () => unshare('g-22'), p => p.name === P + 'household.list');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('[data-lost]').waitFor();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        const g = await grant('g-22');
        check('A denied detail read clears that person’s records at once, even when the reread fails at its first read', seen.hit && seen.failedCall === P + 'household.list' && g.status === 'revoked' && await nothingOfElena());
        return 'g-22 ' + g.status + ' at ' + g.revoked_at + '; failed call ' + seen.failedCall;
      } },
    { title: 'A successful Refresh shows nothing of Elena’s', action: 'Refresh; Household', expected: 'Only Sam, Alex and Mia; no fill of Elena’s', focus: '[data-list=people]',
      run: async () => {
        await t.refresh();
        await nav('Household');
        const ids = await $('[data-list=people] [data-person-id]').evaluateAll(n => n.map(e => e.dataset.personId));
        const live = (await data()).grants.filter(g => g.patient_id === 'p-4' && g.grantee_id === 'p-2' && g.status === 'active');
        check('After a successful Refresh only Sam, Alex and Mia are listed', JSON.stringify(ids) === JSON.stringify(['p-1', 'p-2', 'p-3']) && await nothingOfElena() && live.length === 0);
        return 'household.list: ' + (await t.agent('household.list')).people.map(p => p.person_id).join(', ') + '; fills.get f-18: ' + (await t.agent('fills.get', { fill_id: 'f-18' })).status + '; active grants from p-4 to p-2 in the snapshot: 0';
      } },
    { title: 'Names follow what is visible now', action: 'Infra grant.changed g-28 (Elena gives Alex view access); Refresh; Household → Alex → Give access → Elena, Pickup → Preview change → Confirm with the request dropped before it is sent; Infra revokes g-28; Refresh', expected: 'While Elena is visible the preview and the “Waiting for Mendwell” banner name her; after her access ends both describe her without her name', focus: '[aria-label="Waiting for Mendwell"]',
      run: async () => {
        await t.event('grant.changed', { grant_id: 'g-28', ...elena, scope: 'view', fill_id: null, expires_at: null, status: 'active' });
        await t.refresh();
        await nav('Household');
        await $('[data-list=people] [data-person-id=p-2]').click();
        await $('article[data-person=p-2]').waitFor();
        await t.settled();
        await grantForm('p-4', 'pickup');
        const before = (await $('[data-flow=grant] h3').first().innerText()).includes('Elena Ortiz');
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'grants.change.confirm');
        await click('[data-action=confirm-flow]');
        await alert('connection_lost');
        await t.release();
        const named = (await $('[aria-label="Waiting for Mendwell"]').innerText()).includes('Elena Ortiz');
        await t.event('grant.changed', { grant_id: 'g-28', ...elena, scope: 'view', fill_id: null, expires_at: null, status: 'revoked' });
        await t.refresh();
        check('Names are recomputed on every refresh: once Elena is no longer visible, the open preview and the unanswered request describe her without her name', before && named && cut.dropped && !(await $('.workspace').innerText()).includes('Elena') && (await $('[data-flow=grant] h3').first().innerText()).includes('a family member you do not have access to') && (await $('[aria-label="Waiting for Mendwell"]').innerText()).includes('a family member you do not have access to'));
        return 'g-28 ' + (await grant('g-28')).status + '; preview and banner redescribed';
      } },
    { title: 'Choosing a record whose access just ended', action: 'Dismiss the banner and discard the preview; Infra grant.changed g-26 (refill); Refresh; Fills lists warfarin (Elena); Infra revokes g-26; select warfarin, with the page’s fallback refresh failing', expected: 'The denied read removes Elena’s records from the list at once, before any refresh; the failed refresh leaves nothing of hers on screen', focus: '[data-list=fills]',
      run: async () => {
        await click('[data-action=dismiss-unknown]');
        await click('[data-action=discard-flow]');
        await $('[data-flow]').waitFor({ state: 'detached' });
        await share('g-26');
        await t.refresh();
        await nav('Fills');
        await $('[data-list=fills] [data-fill-id=f-18]').waitFor();
        await t.settled();
        await unshare('g-26');
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'household.list');
        await $('[data-list=fills] [data-fill-id=f-18]').click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        check('A selection read denied after a revocation purges that person’s records at once, even when the refresh after it fails', cut.dropped && await nothingOfElena() && (await grant('g-26')).status === 'revoked');
        return 'g-26 revoked; the fallback refresh failed and nothing of Elena’s stayed on screen';
      } },
    { title: 'A finished “not applied” message is cleared when its record becomes hidden', action: 'Refresh; Infra grant.changed g-27 (refill); Refresh; Prescriptions → amlodipine (Elena) → Request a fill → Station Road, dropped before it is sent; Infra gives g-27 an end date (another change); Retry (not applied); Infra revokes g-27; Refresh', expected: 'The not-applied message names the request while Elena’s records are visible; after the revocation it is gone and nothing of hers is on screen', focus: '.workspace',
      run: async () => {
        await t.refresh();
        await share('g-27');
        await t.refresh();
        await openRx('rx-4');
        await click('[data-action=open-request]');
        await $('[data-field=request-store]').selectOption('st-3');
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'fills.request');
        await click('[data-action=request-fill]');
        await alert('connection_lost');
        await t.release();
        const until = '2027-01-31T00:00:00-05:00';
        await t.event('grant.changed', { grant_id: 'g-27', ...elena, scope: 'refill', fill_id: null, expires_at: until, status: 'active' });
        await click('[data-action=retry-unknown]');
        await alert('not_applied');
        const named = (await $('[role=alert][data-code=not_applied]').innerText()).includes('Elena');
        await t.event('grant.changed', { grant_id: 'g-27', ...elena, scope: 'refill', fill_id: null, expires_at: until, status: 'revoked' });
        await t.refresh();
        check('A finished message about a record that is no longer visible is removed on Refresh', cut.dropped && named && await $('[role=alert][data-code=not_applied]').count() === 0 && await nothingOfElena());
        return 'not-applied message shown, then removed after g-27 was revoked';
      } },
    { title: 'An unanswered request about records that become hidden', action: 'Infra grant.changed g-23 (refill); Refresh; Prescriptions → amlodipine (Elena) → Request a fill → Station Road, the reply dropped after the commit; Infra revokes g-23; Refresh', expected: 'Before: “Waiting for Mendwell” names the request with Retry. After: the banner no longer names Elena or the drug and offers no Retry, only Dismiss', focus: '[data-unknown=hidden]',
      run: async () => {
        await share('g-23');
        await t.refresh();
        await openRx('rx-4');
        await click('[data-action=open-request]');
        await $('[data-field=request-store]').selectOption('st-3');
        t.allowConsole(/net::ERR_FAILED/);
        const lost = await t.dropAfterCommit(p => p.name === P + 'fills.request');
        await click('[data-action=request-fill]');
        await alert('connection_lost');
        await t.release();
        const named = (await $('[aria-label="Waiting for Mendwell"]').innerText()).includes('Elena') && await $('[data-action=retry-unknown]').count() === 1;
        await unshare('g-23');
        await t.refresh();
        await $('[data-unknown=hidden]').waitFor();
        const made = (await data()).fills.filter(f => f.rx_id === 'rx-4' && f.state === 'requested');
        check('Once the target is no longer visible, the unanswered request is shown without identifying text and cannot be replayed', named && lost.forwarded?.status === 'committed' && made.length === 1 && await nothingOfElena() && await $('[data-action=retry-unknown]').count() === 0 && await $('[data-action=dismiss-unknown]').count() === 1);
        return 'dropped reply was ' + lost.forwarded.status + ' (' + lost.forwarded.fill.fill_id + '); g-23 ' + (await grant('g-23')).status + '; banner redacted';
      } },
    { title: 'Pickup-only access shows the logistics view', action: 'Dismiss the banner; Infra grant.changed: Elena gives Alex pickup access limited to her atorvastatin fill f-15 (g-24); Refresh; Household; Fills → the pickup', expected: 'Household lists the pickup access from Person p-4 (no read returns her name); the fill shows store, status and amount due only: no drug, claim or actions', focus: 'article[data-view=logistics]',
      run: async () => {
        await click('[data-action=dismiss-unknown]');
        await $('[aria-label="Waiting for Mendwell"]').waitFor({ state: 'detached' });
        await share('g-24', 'pickup', 'f-15');
        await t.refresh();
        await nav('Household');
        await $('[data-list=people] [data-grant-id=g-24]').waitFor();
        const row = await $('[data-list=people] [data-grant-id=g-24]').innerText();
        check('A person the App does not name is described in plain words, with the ID only as a secondary reference', row.startsWith('A family member you do not have access to') && row.includes('Reference p-4.') && !/\(ID |Person p-4/.test(await $('.workspace').innerText()));
        await openFill('f-15');
        const text = await $('article[data-fill=f-15]').innerText(), own = (await t.agent('fills.get', { fill_id: 'f-15' })).fill, g = await grant('g-24'), stored = await fill('f-15');
        check('A fill-limited pickup grant shows the logistics view: store, status and amount due, no drug, claim or action', own.view === 'logistics' && await $('article[data-fill=f-15][data-view=logistics][data-state=waiting_stock]').count() === 1 && text.includes('Mendwell Harbor Street') && !/atorvastatin|claim|plan/i.test(text) && await $('article[data-fill=f-15] button').count() === 0 && g.status === 'active' && g.fill_id === 'f-15' && stored.state === 'waiting_stock');
        return 'fills.get f-15 view ' + own.view + ': ' + Object.keys(own).join(', ') + '; snapshot ' + brief(stored) + ' at ' + stored.store_id;
      } },
    { title: 'A change during a refresh makes the page read again', action: 'Refresh; Infra store.restocked (atorvastatin at Harbor Street) lands while the page reads the fills', expected: 'The reads of that refresh disagree on the version, so the page reads everything again and shows one consistent state: the restocked pickup is ready, with the amount due and the return date', focus: 'article[data-fill=f-15]',
      run: async () => {
        let lists = 0;
        const count = r => { if (r.url().endsWith('/api/call') && r.postDataJSON()?.name === P + 'fills.list') lists++; };
        page.on('request', count);
        const seen = await t.beforeForward(p => p.name === P + 'fills.list', () => t.event('store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' }));
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('article[data-fill=f-15]:not([data-state=waiting_stock])').waitFor();
        await t.settled();
        await t.release();
        page.off('request', count);
        const stored = await fill('f-15'), shown = await $('article[data-fill=f-15]').getAttribute('data-state');
        check('A version change between the reads of one refresh makes the page read again and show one consistent state', seen.hit && lists === 2 && shown === stored.state && stored.state === 'ready' && Number(await $('article[data-fill=f-15] [data-due]').getAttribute('data-due')) === stored.amount_due_cents && await $('#status[data-error=true]').count() === 0);
        return 'fills.list read ' + lists + ' times in that refresh; snapshot ' + brief(stored) + ', ready at ' + stored.ready_at + ', return due ' + stored.return_due_at;
      } },
    { title: 'Refill access reduced to pickup: the full view and its form go', action: 'Fills → sertraline (Sam, ready) → Who will collect → Mia (not sent); Infra revokes Sam’s refill grant g-h1 (his pickup grant g-h2 stays); Refresh', expected: 'Sam’s fill drops to the pickup view: no drug, claim, cash price or collector form, Prepay still offered; the unsent choice is gone; Sam is no longer listed in Household', focus: 'article[data-fill=f-20]',
      run: async () => {
        await openFill('f-20');
        await click('[data-action=open-collector]');
        await $('[data-field=collector]').selectOption('p-3');
        await t.event('grant.changed', { grant_id: 'g-h1', patient_id: 'p-1', grantor_id: 'p-1', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'revoked' });
        await t.refresh();
        await $('article[data-fill=f-20][data-view=logistics]').waitFor();
        const text = await $('article[data-fill=f-20]').innerText(), own = (await t.agent('fills.get', { fill_id: 'f-20' })).fill;
        await openFill('f-17');
        const held = await $('article[data-fill=f-17]').innerText();
        check('The pickup view of a held fill reports its state without promising collection, since the pickup read carries no hold', await $('article[data-fill=f-17][data-view=logistics] [data-collectable=unknown]').count() === 1 && !/Can be collected|Yes, at/.test(held) && held.includes('as the pharmacy reports it'));
        await openFill('f-20');
        check('When refill access drops to pickup, the fill shows only the pickup view, its open form and draft are gone, and the page has no error', own.view === 'logistics' && !/sertraline|claim|cash|Interaction/i.test(text) && await $('[data-form]').count() === 0 && await $('[data-action=open-prepay]').count() === 1 && (await $('#status').innerText()).trim() === 'All changes saved' && (await grant('g-h1')).status === 'revoked');
        return 'g-h1 revoked, f-20 seen as ' + own.view;
      } },
    { title: 'Refill access given again', action: 'Infra grant.changed g-25 (Sam gives Alex refill access again); Refresh', expected: 'Sam’s fill shows the full view again, without the earlier collector form', focus: 'article[data-fill=f-20]',
      run: async () => {
        await t.event('grant.changed', { grant_id: 'g-25', patient_id: 'p-1', grantor_id: 'p-1', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'active' });
        await t.refresh();
        await $('article[data-fill=f-20]:not([data-view=logistics])').waitFor();
        await t.settled();
        check('With refill access given again (g-25), the full view returns without the earlier collector form', await $('[data-form=collector]').count() === 0 && (await $('article[data-fill=f-20]').innerText()).includes('sertraline'));
        return 'g-25 refill active; collector ' + JSON.stringify((await fill('f-20')).collector);
      } },
    { title: 'An unanswered prepayment after access drops to pickup', action: 'Fills → sertraline (Sam) → Prepay → Household card → Preview → Confirm (waits) → dev/confirm.cjs → Refresh → Confirm, with the request dropped before it is sent; Infra revokes Sam’s refill access g-25 (his pickup access stays); Refresh', expected: 'Before: “Waiting for Mendwell” names the sertraline fill. After: the fill shows the pickup view and the banner speaks of “a pickup” only; Retry stays, since prepaying is still allowed with pickup access', focus: '[aria-label="Waiting for Mendwell"]',
      run: async () => {
        await openFill('f-20');
        await click('[data-action=open-prepay]');
        await $('[data-field=prepay-card]').selectOption('card-3');
        await click('[data-action=preview-prepay]');
        await $('[data-flow=prepay]').waitFor();
        await t.settled();
        const code = await token();
        await waiting();
        t.confirm(code);
        await t.refresh();
        await $('[data-approval-state=active]').waitFor();
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'fills.prepay.confirm');
        await click('[data-action=confirm-flow]');
        await alert('connection_lost');
        await t.release();
        const named = (await $('[aria-label="Waiting for Mendwell"]').innerText()).includes('sertraline');
        await t.event('grant.changed', { grant_id: 'g-25', patient_id: 'p-1', grantor_id: 'p-1', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'revoked' });
        await t.refresh();
        await $('article[data-fill=f-20][data-view=logistics]').waitFor();
        await t.settled();
        const banner = await $('[aria-label="Waiting for Mendwell"]').innerText();
        check('An unanswered prepayment is described from the fill as the account may now see it: generic pickup wording after access drops to pickup, with Retry only because prepaying is still allowed', named && cut.dropped && banner.includes('prepay a pickup') && !/sertraline|claim/i.test(banner) && await $('[data-action=retry-unknown]').count() === 1 && (await fill('f-20')).authorization_id === null);
        return 'banner after the downgrade: ' + banner.split('\n').slice(1).join(' ').slice(0, 160);
      } },
    { title: 'Access ends while a later read of the refresh fails', action: 'Dismiss; Infra gives Sam’s refill access back (g-29) and Elena refill access (g-30); Refresh; Prescriptions → amlodipine (Elena); Infra revokes g-30; Refresh with the cards read failing', expected: 'The household list already shows that Elena’s access ended, so her prescription and name leave the screen at once although the refresh failed part-way', focus: '.workspace',
      run: async () => {
        await click('[data-action=dismiss-unknown]');
        await t.event('grant.changed', { grant_id: 'g-29', patient_id: 'p-1', grantor_id: 'p-1', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'active' });
        await share('g-30');
        await t.refresh();
        await openRx('rx-4');
        const seen = (await $('article[data-rx=rx-4]').textContent()).includes('Elena Ortiz');
        await unshare('g-30');
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'cards.list');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        check('When the household list of a refresh shows lost access, that person’s records, prompts and messages are removed at once, also when a later read of the same refresh fails', seen && cut.dropped && await nothingOfElena() && await $('article[data-rx=rx-4]').count() === 0);
        return 'g-30 ' + (await grant('g-30')).status + '; the cards read failed; nothing of Elena’s on screen';
      } },
    { title: 'Refresh after the failed read', action: 'Refresh; Household', expected: 'Sam (full access again through g-29), Alex and Mia; nothing of Elena’s', focus: '[data-list=people]',
      run: async () => {
        await t.refresh();
        await nav('Household');
        const ids = await $('[data-list=people] [data-person-id]').evaluateAll(n => n.map(e => e.dataset.personId));
        check('The next Refresh completes with Sam’s full access back and nothing of Elena’s', JSON.stringify(ids) === JSON.stringify(['p-1', 'p-2', 'p-3']) && await nothingOfElena() && (await $('#status').innerText()).trim() === 'All changes saved');
        return 'household.list: ' + ids.join(', ');
      } },
    { title: 'Access ends and the page’s own household read fails', action: 'Infra gives Alex refill access again (g-31); Refresh; Prescriptions → amlodipine (Elena); Infra revokes g-31; Refresh, with the first household read answering and the second one failing', expected: 'The first household read of that refresh already shows that Elena’s access ended, so her prescription and name leave the screen before any further read, although the refresh failed', focus: '.workspace',
      run: async () => {
        await share('g-31');
        await t.refresh();
        await openRx('rx-4');
        const seen = (await $('article[data-rx=rx-4]').textContent()).includes('Elena Ortiz');
        await unshare('g-31');
        t.allowConsole(/net::ERR_FAILED/);
        let rosters = 0;
        const cut = await t.dropBeforeSend(p => p.name === P + 'household.list' && ++rosters === 2);
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        check('Any household read that shows lost access removes that person’s records at once, also when the next read of the same refresh fails', seen && cut.dropped && rosters === 2 && await nothingOfElena() && await $('article[data-rx=rx-4]').count() === 0);
        return 'g-31 ' + (await grant('g-31')).status + '; the second household read failed; nothing of Elena’s on screen';
      } },
    { title: 'A pickup grant ends while a later read of the refresh fails', action: 'Refresh; Fills → the pickup (f-15, Elena’s pickup grant g-24); Infra revokes g-24; Refresh, with the cards read failing', expected: 'The grants read of that refresh shows g-24 ended, so the pickup with its store and amount leaves the screen at once although the refresh failed', focus: '.workspace',
      run: async () => {
        await t.refresh();
        await openFill('f-15');
        const before = await $('article[data-fill=f-15][data-view=logistics]').innerText();
        await unshare('g-24', 'pickup', 'f-15');
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'cards.list');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        const after = await $('.workspace').innerText();
        check('When the grants read shows a pickup grant ended, the pickups it covered leave the screen at once, also when a later read of the same refresh fails', before.includes('Harbor Street') && before.includes('$12') && cut.dropped && await $('[data-fill-id=f-15], [data-fill=f-15]').count() === 0 && !after.includes(before.split('\n').find(l => l.includes('Harbor Street'))));
        return 'g-24 ' + (await grant('g-24')).status + '; the cards read failed; f-15 is no longer on screen';
      } },
    { title: 'Refresh after the pickup grant ended', action: 'Refresh', expected: 'The refresh completes; the pickup stays gone', focus: '[data-list=fills]',
      run: async () => {
        await t.refresh();
        const own = await t.agent('fills.list', {});
        check('The next Refresh completes and still shows no pickup for f-15, matching what Mendwell lets this account see', !own.fills.some(f => f.fill_id === 'f-15') && await $('[data-fill-id=f-15], [data-fill=f-15]').count() === 0 && (await $('#status').innerText()).trim() === 'All changes saved');
        return 'fills.list as the account: ' + own.fills.length + ' fills, none of them f-15';
      } }
  ] };

  const w4 = { id: 'w4-holds', title: 'W4 Pharmacist holds', summary: 'Mia’s montelukast is held during review: changes are refused, the release resumes the review with its remaining time, and a collection attempted while another fill is held is refused and not replayed.', steps: [
    { title: 'A held fill offers no change the pharmacy refuses', action: 'Fills → montelukast (Mia, on hold)', expected: 'The pharmacist’s note and why changes wait; no Change store or Change quantity. The App refuses a store change on a held fill (on_hold), checked with a direct Agent call; nothing moves', focus: '[data-hold-hint]',
      run: async () => {
        await openFill('f-19');
        check('The hold and the pharmacist’s note are shown', (await $('[data-hold-note]').innerText()).includes('Pharmacist confirming the dose'));
        const own = await t.agent('fills.change_store', { fill_id: 'f-19', store_id: 'st-2', expected_version: await t.version(), request_id: 'agent-held-store' });
        const f = await fill('f-19');
        check('A held fill offers no store or quantity change and says why; the App refuses a store change as on_hold and nothing moves', await $('[data-action=open-store]').count() === 0 && await $('[data-action=open-quantity]').count() === 0 && (await $('[data-hold-hint]').innerText()).includes('until the pharmacist releases it') && own.status === 'on_hold' && f.store_id === 'st-1' && f.hold !== null);
        return brief(f) + ', store ' + f.store_id + ', hold “' + f.hold.note + '”';
      } },
    { title: 'The pharmacist releases the hold', action: 'Infra fill.hold_released; Refresh', expected: 'The hold is gone; the review resumes with its remaining 80 minutes (due 4:20 PM EST)', focus: '[data-time=review_due_at]',
      run: async () => {
        await t.event('fill.hold_released', { fill_id: 'f-19', note: 'Prescriber confirmed the dose' });
        await t.refresh();
        await $('[data-time=review_due_at]').waitFor();
        const f = await fill('f-19');
        check('After the release the review resumes with its remaining time', f.hold === null && f.review_due_at === '2026-11-18T16:20:00-05:00' && (await $('[data-time=review_due_at]').innerText()).includes('4:20 PM EST'));
        return brief(f) + ', review_due_at ' + f.review_due_at;
      } },
    { title: 'The review completes', action: 'Infra env.advance_time to 4:30 PM; Refresh', expected: 'Ready for pickup with the $10.00 copay due', focus: 'article[data-fill=f-19]',
      run: async () => {
        await t.advance('2026-11-18T16:30:00-05:00');
        await t.refresh();
        await $('article[data-fill=f-19][data-state=ready]').waitFor();
        const f = (await t.agent('fills.get', { fill_id: 'f-19' })).fill, stored = await fill('f-19');
        check('After the review the fill is ready with $10.00 due', f.state === 'ready' && f.amount_due_cents === 1000 && await $('[data-due="1000"]').count() === 1);
        check('The snapshot holds the review due at 4:20 PM with the clock at 4:30 PM, which the read applies', stored.review_due_at === '2026-11-18T16:20:00-05:00' && stored.hold === null && (await t.snapshot()).virtual_now === '2026-11-18T16:30:00-05:00');
        return 'fills.get f-19: ' + brief(f) + ', claim ' + f.claim.result + '; snapshot review_due_at ' + stored.review_due_at;
      } },
    { title: 'A collection while held is refused', action: 'Infra fill.hold_placed on sertraline (Sam) with a note that contains markup, then fill.collection_attempted by Sam; Refresh; Fills → sertraline', expected: 'The hold note shown character for character as text, no element made from it; a counter refusal “the fill was on hold”; still ready, nothing charged', focus: '[data-hold-note]',
      run: async () => {
        await t.event('fill.hold_placed', { fill_id: 'f-20', note: MARKUP });
        await t.event('fill.collection_attempted', { fill_id: 'f-20', collector_id: 'p-1' });
        await t.refresh();
        await openFill('f-20');
        const f = await fill('f-20');
        check('A collection attempted during a hold is refused on_hold and changes nothing', f.state === 'ready' && f.refusals.length === 1 && f.refusals[0].reason === 'on_hold' && f.charge_id === null && await $('[data-refusal=on_hold]').count() === 1);
        check('A pharmacist note with markup is displayed as its literal text and creates no element', f.hold.note === MARKUP && (await $('[data-hold-note] p').innerText()) === MARKUP && await $('#app [data-probe], #app mark, #app img').count() === 0 && !(await page.evaluate(() => window.injected)));
        return brief(f) + ', refusals ' + JSON.stringify(f.refusals.map(r => r.reason)) + ', charge ' + f.charge_id;
      } }
  ] };

  const w5 = { id: 'w5-collection', title: 'W5 Prepayment, cancellation, collector and collection', summary: 'Prepay needs the card owner’s confirmation (Alex): a declined card is refused, the household card is authorized; a prepaid fill’s cancellation preview is kept and then confirmed; a collector named under Sam’s pickup grant is cleared when Alex revokes the grant; the counter captures the prepayment.', steps: [
    { title: 'Prepay preview', action: 'Fills → montelukast (Mia) → Prepay → Travel card → Preview prepayment', expected: '$10.00 on the Travel card, Alex as the confirmer, the code and the 30-minute rule; nothing stored', focus: '[data-flow=prepay]',
      run: async () => {
        await openFill('f-19');
        await click('[data-action=open-prepay]');
        await $('[data-field=prepay-card]').selectOption('card-2');
        await click('[data-action=preview-prepay]');
        await $('[data-flow=prepay]').waitFor();
        await t.settled();
        prepayDeclined = await token();
        const own = (await t.agent('fills.prepay.preview', { fill_id: 'f-19', card_id: 'card-2' })).preview;
        check('The prepay preview shows the App’s token, amount and confirmer', prepayDeclined === own.token && Number(await $('[data-amount]').getAttribute('data-amount')) === 1000 && (await $('[data-flow=prepay] [data-confirm-help]').innerText()).includes('confirm this prepayment outside this app'));
        return 'prepay.preview: amount ' + own.changes.amount_cents + ', confirmer ' + own.required_confirmer + ', token ' + own.token;
      } },
    { title: 'Confirm waits; the confirmation arrives', action: 'Confirm prepayment (waits) → dev/confirm.cjs → Refresh', expected: 'Waiting state, then “Confirmed at 4:30 PM EST, valid until 5:00 PM EST”', focus: '[data-approval-state=active]',
      run: async () => {
        await waiting();
        t.confirm(prepayDeclined);
        await t.refresh();
        await $('[data-approval-state=active]').waitFor();
        const a = await approval(prepayDeclined);
        check('The prepay confirmation is shown after Refresh', (await $('[data-approval-state=active]').innerText()).includes('valid until 5:00 PM EST') && a.length === 1 && a[0].confirmed_by === 'p-2' && a[0].used_at === null && (await fill('f-19')).authorization_id === null);
        return 'approval for the prepay token in the snapshot: ' + (await approval(prepayDeclined)).map(a => a.confirmed_by + ' ' + a.confirmed_at).join('; ');
      } },
    { title: 'A declined card is refused', action: 'Confirm prepayment', expected: 'payment_failed shown; no prepayment stored; the confirmation stays unused', focus: '[role=alert][data-code=payment_failed]',
      run: async () => {
        await confirmClick();
        await alert('payment_failed');
        const f = await fill('f-19'), a = await approval(prepayDeclined);
        check('A declined card is refused as payment_failed and stores nothing', f.authorization_id === null && a[0].used_at === null && await $('[data-flash]').count() === 0);
        return 'f-19 authorization ' + f.authorization_id + '; approval used_at ' + a[0].used_at;
      } },
    { title: 'Prepay with the household card', action: 'Prepay → Household card → Preview prepayment → Confirm (waits) → dev/confirm.cjs → Refresh → Confirm prepayment', expected: 'A live $10.00 prepayment on •••• 4417', focus: '[data-authorization=live]',
      run: async () => {
        await click('[data-action=open-prepay]');
        await $('[data-field=prepay-card]').selectOption('card-3');
        await click('[data-action=preview-prepay]');
        await $('[data-flow=prepay]').waitFor();
        await t.settled();
        prepayToken = await token();
        await waiting();
        t.confirm(prepayToken);
        await t.refresh();
        await $('[data-approval-state=active]').waitFor();
        await confirmClick();
        await flash('Prepaid $10.00 with Household card •••• 4417');
        const f = await fill('f-19'), au = (await data()).authorizations.find(a => a.authorization_id === f.authorization_id);
        check('Prepay authorizes exactly the amount due on the household card', au && au.card_id === 'card-3' && au.amount_cents === 1000 && au.state === 'live' && await $('[data-authorization=live]').count() === 1);
        return 'f-19 ' + au.authorization_id + ' ' + au.state + ' ' + au.amount_cents + ' on ' + au.card_id;
      } },
    { title: 'A guardian can be named to collect', action: 'Who will collect → Sam Rivera (Mia’s other guardian) → Save', expected: 'Sam is offered and recorded as the person collecting, as a guardian (no grant needed)', focus: '[data-collector=p-1]',
      run: async () => {
        await click('[data-action=open-collector]');
        const offered = await $('[data-field=collector] option').evaluateAll(n => n.map(o => o.value));
        await $('[data-field=collector]').selectOption('p-1');
        await click('[data-action=save-collector]');
        await flash('Sam Rivera is recorded as the person collecting');
        const f = await fill('f-19');
        check('The collector choice offers every household member and an ID field, and the App accepts Sam as Mia’s guardian', ['p-1', 'p-2', 'p-3', 'other'].every(v => offered.includes(v)) && f.collector?.person_id === 'p-1' && f.collector.via_grant_id === null);
        return 'offered ' + offered.filter(Boolean).join(', ') + '; f-19 collector ' + JSON.stringify(f.collector);
      } },
    { title: 'A selection whose read fails pauses changes', action: 'Fills → omeprazole (Sam); select sertraline with its first read failing', expected: 'No fill and no action is shown and the status shows the error', focus: '[data-selection-failed]',
      run: async () => {
        await openFill('f-17');
        t.selectionAudits = (await t.snapshot()).audit.length;
        t.allowConsole(/net::ERR_FAILED/);
        const cut = await t.dropBeforeSend(p => p.name === P + 'fills.get' && p.arguments.fill_id === 'f-20');
        await $('[data-list=fills] [data-fill-id=f-20]').click();
        await $('[data-selection-failed]').waitFor();
        await t.settled();
        await t.release();
        check('When the read for a new selection fails, the page shows neither the old nor the new fill and offers no action', cut.dropped && await $('article[data-fill]').count() === 0 && await $('.detail button[data-action]').count() === 0 && await $('#status[data-error=true]').count() === 1);
        return 'the selection read of f-20 was dropped; no fill and no action shown';
      } },
    { title: 'A cancel preview stays with its fill', action: 'Refresh; Cancel fill on sertraline; back to omeprazole; back to sertraline', expected: 'After Refresh sertraline opens; its cancel preview is shown only on sertraline, also after going to omeprazole and back; nothing is written', focus: '[data-flow=cancel]',
      run: async () => {
        await t.refresh();
        await $('article[data-fill=f-20]').waitFor();
        await click('[data-action=preview-cancel]');
        await $('article[data-fill=f-20] [data-flow=cancel]').waitFor();
        await t.settled();
        await openFill('f-17');
        const elsewhere = await $('[data-flow]').count() === 0 && await $('article[data-fill=f-17] [data-action=preview-cancel]').count() === 1;
        await openFill('f-20');
        const back = await $('article[data-fill=f-20] [data-flow=cancel]').count() === 1;
        const d = await data(), f17 = d.fills.find(f => f.fill_id === 'f-17'), f20 = d.fills.find(f => f.fill_id === 'f-20');
        check('A preview stays bound to the fill it was made for and nothing is written', elsewhere && back && f17.state === 'ready' && f20.state === 'ready' && (await t.snapshot()).audit.filter(a => a.tool.endsWith('cancel.confirm')).length === 0 && (await t.snapshot()).audit.length >= t.selectionAudits);
        return 'f-17 ' + brief(f17) + '; f-20 ' + brief(f20) + '; no cancel.confirm in the audit';
      } },
    { title: 'Cancellation preview of a prepaid fill', action: 'Keep fill on sertraline; Fills → omeprazole (Sam, prepaid, on hold) → Cancel fill', expected: 'The $65.00 prepayment is voided; the paused pickup reminder and return are stopped; fills left unchanged; nothing stored', focus: '[data-flow=cancel]',
      run: async () => {
        await click('[data-action=discard-flow]');
        await $('[data-flow]').waitFor({ state: 'detached' });
        await openFill('f-17');
        check('A prepaid fill on hold says plainly that it cannot be collected yet and that nothing more is owed', (await $('[data-collectable=false]').innerText()).includes('Not yet: on hold') && (await $('article[data-fill=f-17] [data-due]').innerText()).includes('Nothing more: $65.00 is prepaid') && !(await $('article[data-fill=f-17]').innerText()).includes(' live'));
        await click('[data-action=preview-cancel]');
        await $('[data-flow=cancel]').waitFor();
        await t.settled();
        const own = (await t.agent('fills.cancel.preview', { fill_id: 'f-17' })).preview.changes;
        check('The cancel preview lists the App’s void and stopped timers', Number(await $('[data-void]').getAttribute('data-void')) === own.authorization_void.amount_cents && Number(await $('[data-timers]').getAttribute('data-timers')) === own.cancelled_timers.length && (await $('[data-timers]').innerText()).includes('paused'));
        check('The cancel preview says in plain words what stops', /You will not get a pickup reminder for it\./.test(await $('[data-timers]').innerText()) && !/planned|timer|warning/i.test(await $('[data-timers]').innerText()));
        return 'cancel.preview: ' + JSON.stringify(own);
      } },
    { title: 'Keep the fill', action: 'Keep fill', expected: 'The preview closes; the fill stays ready and prepaid', focus: 'article[data-fill=f-17]',
      run: async () => {
        await click('[data-action=discard-flow]');
        await $('[data-flow]').waitFor({ state: 'detached' });
        const f = await fill('f-17'), au = (await data()).authorizations.find(a => a.authorization_id === f.authorization_id);
        check('Keep fill changes nothing', f.state === 'ready' && au.state === 'live');
        return brief(f) + ', ' + au.authorization_id + ' ' + au.state;
      } },
    { title: 'Confirm the cancellation', action: 'Cancel fill → Confirm cancellation', expected: 'Cancelled at your request; the $65.00 prepayment voided', focus: '[data-cancellation=agent]',
      run: async () => {
        await click('[data-action=preview-cancel]');
        await $('[data-flow=cancel]').waitFor();
        await t.settled();
        await confirmClick();
        await flash('Fill cancelled.');
        const f = await fill('f-17'), au = (await data()).authorizations.find(a => a.authorization_id === f.authorization_id);
        check('A cancelled fill shows nothing outstanding and its original price on a separate line', (await $('article[data-fill=f-17] [data-due]').innerText()).includes('Nothing (the fill is cancelled)') && (await $('article[data-fill=f-17] [data-original-price="6500"]').innerText()).includes('$65.00') && !(await $('article[data-fill=f-17]').innerText()).includes('Amount due'));
        check('Confirm cancels the fill and voids its prepayment', f.state === 'cancelled' && f.cancellation.reason === 'agent' && au.state === 'voided' && await $('[data-authorization=voided]').count() === 1);
        return brief(f) + ', ' + au.authorization_id + ' ' + au.state;
      } },
    { title: 'Name who will collect', action: 'Fills → metformin (Alex, ready) → Who will collect → Sam Rivera → Save', expected: 'Sam recorded as the person collecting (under his pickup grant g-3)', focus: '[data-collector=p-1]',
      run: async () => {
        await openFill('f-16');
        await click('[data-action=open-collector]');
        check('The collector form says that anyone else needs pickup access first and links to Household', (await $('[data-collector-hint]').innerText()).includes('pickup access first') && await $('[data-action=goto-household]').count() === 1 && (await $('[data-field=collector] option[value=p-1]').innerText()).includes('has pickup access'));
        await $('[data-field=collector]').selectOption('p-3');
        await click('[data-action=save-collector]');
        await alert('not_authorized');
        const refusal = await $('[role=alert][data-code=not_authorized]').innerText();
        check('An App refusal is explained in plain words without internal IDs, and the status does not say “All changes saved”', refusal.includes('Mia Rivera cannot collect this fill') && !/p-3|f-16/.test(refusal) && (await $('#status').innerText()).trim() !== 'All changes saved' && (await fill('f-16')).collector === null);
        await click('[data-action=goto-household]');
        await $('[data-form=grant]').waitFor();
        await t.settled();
        check('“Give pickup access in Household” opens the Give access form for that person and fill', await $('article[data-person=p-2]').count() === 1 && await $('[data-field=grantee]').inputValue() === 'p-3' && await $('[data-scope=pickup]').isChecked() && await $('[data-field=grant-fill]').inputValue() === 'f-16');
        await $('[data-form=grant]').getByRole('button', { name: 'Close', exact: true }).click();
        await openFill('f-16');
        if (await $('[data-form=collector]').count() === 0) await click('[data-action=open-collector]');
        await $('[data-field=collector]').selectOption('other');
        await $('[data-field=collector-other]').fill('p-99');
        await click('[data-action=save-collector]');
        await alert('not_found');
        check('An unknown typed collector ID is answered with “No person with that ID”', (await $('[role=alert][data-code=not_found]').innerText()).startsWith('No person with that ID') && (await fill('f-16')).collector === null);
        await $('[data-field=collector]').selectOption('p-1');
        await click('[data-action=save-collector]');
        await flash('Sam Rivera is recorded as the person collecting');
        const f = await fill('f-16');
        check('The collector is recorded through Sam’s pickup grant', f.collector && f.collector.person_id === 'p-1' && f.collector.via_grant_id === 'g-3');
        return 'f-16 collector ' + JSON.stringify(f.collector);
      } },
    { title: 'Revoking the pickup grant clears the collector', action: 'Household → Revoke Sam’s pickup access → Confirm (waits) → dev/confirm.cjs → Refresh → Confirm revocation', expected: 'g-3 revoked; metformin has nobody named to collect', focus: '[data-grant=g-3]',
      run: async () => {
        await nav('Household');
        await click('[data-action=revoke][data-grant-id=g-3]');
        await $('[data-flow=revoke]').waitFor();
        await t.settled();
        const tk = await token();
        await waiting();
        t.confirm(tk);
        await t.refresh();
        await $('[data-approval-state=active]').waitFor();
        await confirmClick();
        await flash('Revoked pickup access for Sam Rivera. Reference g-3.');
        const g = await grant('g-3'), f = await fill('f-16');
        check('Revoking g-3 commits and clears the collector it backed', g.status === 'revoked' && f.collector === null && await $('[data-grant=g-3][data-state=revoked]').count() === 1);
        return 'g-3 ' + g.status + ' at ' + g.revoked_at + '; f-16 collector ' + f.collector;
      } },
    { title: 'Collection at the counter captures the prepayment', action: 'Fills → montelukast; Infra fill.collection_attempted by Alex; Refresh', expected: 'Picked up; $10.00 charged by capturing the prepayment', focus: '[data-charge]',
      run: async () => {
        await openFill('f-19');
        await t.event('fill.collection_attempted', { fill_id: 'f-19', collector_id: 'p-2' });
        await t.refresh();
        await $('article[data-fill=f-19][data-state=collected]').waitFor();
        const f = await fill('f-19'), ch = (await data()).charges.find(c => c.charge_id === f.charge_id);
        check('The counter collection captures the live prepayment once', ch.method === 'capture' && ch.amount_cents === 1000 && (await $('[data-charge]').innerText()).includes('prepayment captured'));
        return brief(f) + '; ' + ch.charge_id + ' ' + ch.method + ' ' + ch.amount_cents + ' by ' + ch.payer_id;
      } }
  ] };

  const platform = { id: 'platform', title: 'Business-only access and layout', summary: 'The page session cannot reach management operations, and every section fits a 390 px screen.', steps: [
    { title: 'Management requests from the page session are refused', action: 'From the authenticated page session, POST /api/call env.snapshot and env.apply_event (a user.confirmed)', expected: '403 for both; no confirmation stored', focus: '.toolbar',
      run: async () => {
        t.allowConsole(/status of 403/);
        const n = (await data()).approvals.length;
        const snap = await t.business('env.snapshot', {});
        const apply = await t.business('env.apply_event', { expected_version: await t.version(), event: { event_id: 'page-forged', at: '2026-11-18T16:30:00-05:00', operation: 'user.confirmed', payload: { token: 'tok-grant-patient-p-2-0000', confirmed_by: 'p-2' } } });
        check('Direct management requests from the business session are refused (403) and store nothing', snap.http === 403 && apply.http === 403 && (await data()).approvals.length === n);
        const version = await t.version();
        const own = await t.agent('fills.wait', { fill_id: 'f-16', expected_version: version, request_id: 'agent-wait-check' });
        const seen = await page.evaluate(async ({ version }) => {
          const { csrf } = await (await fetch('/session')).json();
          const post = async (name, args) => { const r = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name, arguments: args }) }); return { status: r.status, statusText: r.statusText, cache: r.headers.get('cache-control'), body: await r.json() }; };
          return { read: await post('mendwell-pharmacy.fills.get', { fill_id: 'f-999' }), write: await post('mendwell-pharmacy.fills.wait', { fill_id: 'f-16', expected_version: version, request_id: 'page-wait-check' }) };
        }, { version });
        check('The page rewrites only refused reads, in read wording, and keeps the HTTP status, status text and no-store header; a refused write passes through unchanged', seen.read.body.status === 'not_found' && seen.read.body.message === 'This record is not visible to this account.' && seen.read.status === 200 && seen.read.statusText === 'OK' && seen.read.cache === 'no-store' && seen.write.body.status === own.status && seen.write.body.message === own.message && seen.write.cache === 'no-store');
        return 'env.snapshot → ' + snap.http + ', env.apply_event → ' + apply.http + '; approvals in the snapshot: ' + n;
      } },
    { title: 'A Mendwell that keeps changing gives a clear error', action: 'Refresh while Infra moves the clock one minute before each of the next three fill-list reads; then Refresh again', expected: 'After three reads that disagree the page stops and asks for Refresh; the next Refresh shows one consistent state', focus: '#status',
      run: async () => {
        let moved = 0;
        const start = Date.parse((await t.snapshot()).virtual_now);
        await page.route('**/api/call', async route => {
          if (moved < 3 && route.request().postDataJSON()?.name === P + 'fills.list') { moved++; await t.advance(new Date(start + moved * 60000).toISOString()); }
          await route.continue();
        });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        const message = (await $('#status').innerText()).trim();
        await t.refresh();
        check('Three refresh attempts that each see a different version end in a clear error, and the next Refresh succeeds', moved === 3 && message.includes('kept changing') && (await $('#status').innerText()).trim() === 'All changes saved');
        return 'clock moved 3 times during the reads; status: “' + message + '”';
      } },
    { title: 'Search, sign-in and label links', action: 'Search “zzz” with a fill open, then clear it; Prescriptions → metformin (Alex)', expected: 'The open fill is replaced by “Not in the search results” while it does not match; the sidebar names the signed-in holder; label sources are links', focus: '[data-fact]',
      run: async () => {
        await nav('Fills');
        await t.settled();
        await page.evaluate(() => { window.busyFlips = 0; new MutationObserver(() => { if (document.querySelector('#app').getAttribute('aria-busy') === 'true') window.busyFlips++; }).observe(document.querySelector('#app'), { attributes: true, attributeFilter: ['aria-busy'] }); });
        const calls = [], log = r => { if (r.url().endsWith('/api/call') || r.url().endsWith('/api/tools')) calls.push(r.url().endsWith('/api/tools') ? 'tools' : r.postDataJSON().name + ' ' + JSON.stringify(r.postDataJSON().arguments)); };
        page.on('request', log);
        await $('[data-list=fills] [data-fill-id=f-16]').click();
        await $('article[data-fill=f-16]').waitFor();
        await t.settled();
        page.off('request', log);
        const calm = await page.evaluate(() => window.busyFlips) === 0 && JSON.stringify(calls) === JSON.stringify([P + 'fills.get {"fill_id":"f-16"}']);
        await $('.toolbar input[type=search]').fill('zzz');
        await $('[data-search-empty]').waitFor();
        await t.settled();
        const hidden = await $('article[data-fill]').count() === 0;
        await $('.toolbar input[type=search]').fill('');
        await $('article[data-fill=f-16]').waitFor();
        await t.settled();
        await openRx('rx-7');
        const link = $('[data-fact] a').first();
        check('Choosing a fill in the list makes exactly one request (fills.get for that fill) and does not grey out the page', calm);
        check('A search that excludes the open fill clears the detail; the holder is shown as signed in; label sources open as links', hidden && (await $('.sidebar-foot strong').innerText()).trim() === 'Alex Rivera' && /^https:\/\/dailymed\.nlm\.nih\.gov\//.test(await link.getAttribute('href')) && await link.getAttribute('rel') === 'noopener noreferrer');
        return 'search cleared the detail; signed in as Alex Rivera; ' + (await $('[data-fact] a').count()) + ' label links';
      } },
    { title: 'Every section fits a phone screen', action: 'Screenshots of each section at 1280 px; then viewport 390 × 844 and each section again', expected: 'No horizontal overflow; every navigation tab visible', focus: 'nav',
      run: async () => {
        const views = [];
        await openFill('f-16');
        for (const name of ['Fills', 'Prescriptions', 'Plan requests', 'Household', 'Account']) {
          await nav(name);
          await t.settled();
          await t.shot('wide-' + name.toLowerCase().replace(/\s+/g, '-'));
        }
        await t.overflow(390);
        for (const name of ['Fills', 'Prescriptions', 'Plan requests', 'Household', 'Account']) {
          await nav(name);
          views.push([name, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)]);
          views.push([name + ' tap targets', await page.evaluate(() => [...document.querySelectorAll('#app button, #app summary')].filter(b => b.offsetParent).every(b => b.getBoundingClientRect().height >= 44))]);
          await t.shot('narrow-' + name.toLowerCase().replace(/\s+/g, '-'));
        }
        await openFill('f-16');
        views.push(['fill detail', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)]);
        const tab = await page.locator('nav').getByRole('button', { name: /Account/ }).boundingBox();
        views.push(['navigation', !!tab && tab.x >= 0 && tab.x + tab.width <= 390]);
        check('At 390 px every section and a fill detail fit without horizontal overflow, every tab is visible, and every button is at least 44 px tall', views.every(([, fits]) => fits));
        return views.map(([n, ok]) => n + (ok ? ' fits' : ' overflows')).join('; ');
      } }
  ] };

  return [w1, w2, w3, visibility, w4, w5, platform];
}

function restrictedRun(t) {
  const { page, check } = t;
  const policies = read('fixtures/policies.json');
  const $ = selector => page.locator(selector);
  const seed = request_id => t.loadSeed({ data: read('fixtures/minimal.json'), virtual_now: '2026-11-18T12:00:00-05:00', request_id });
  const pick = async id => { await $('[data-list=fills] [data-fill-id=' + id + ']').click(); await $('article[data-fill=' + id + ']').waitFor(); await t.settled(); };
  const sam = (grant_id, status) => t.event('grant.changed', { grant_id, patient_id: 'p-1', grantor_id: 'p-1', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status });
  const callName = route => route.request().postDataJSON()?.name;
  let lostCancel, bannerText, after, between, again, kept, lostPlan, named, race, epoch, reloaded, lost, forced, d, forcedOk, noList, dup, shown;
  return { id: 'restricted', title: 'Resets, reloads and a policy without plan_requests.create', summary: 'A second fresh run: cancellations and edits across resets and reloads, answers stamped for another epoch, previews repeated or answered across a reset, answers lost before a reload, a policy that drops plan_requests.create, and refusals and a refused read explained in plain words; nothing from an older epoch is sent or taken as success.', steps: [
    { title: 'The restricted run opens the page', action: 'Open the page on a second fresh run', expected: 'The Mendwell page, all changes saved', focus: '#status',
      run: async () => {
        await t.open('[data-fill-id]');
        await t.settled();
        check('The restricted run opens the Mendwell page', await page.title() === 'Mendwell Pharmacy · PALE' && (await $('#status').innerText()).trim() === 'All changes saved');
        return '';
      } },
    { title: 'A pickup access limited to one fill, not yet previewed', action: 'Household → Give access (to Alex’s own records) → Person: Sam Rivera, Access: Pickup, Pickup covers: metformin f-16; not previewed', expected: 'The form holds the fill limit; nothing is sent', focus: '[data-form=grant]',
      run: async () => {
        await page.locator('nav').getByRole('button', { name: /Household/ }).click();
        await $('article[data-person=p-2]').waitFor();
        await t.settled();
        await $('[data-action=open-grant]').click();
        await $('[data-field=grantee]').selectOption('p-1');
        await $('[data-scope=pickup]').check();
        await $('[data-field=grant-fill]').selectOption('f-16');
        await t.settled();
        check('The Give access form can limit a pickup grant to one open fill, and nothing is previewed yet', await $('[data-field=grant-fill]').inputValue() === 'f-16' && await $('[data-flow]').count() === 0);
        return '';
      } },
    { title: 'Cancelling a fill with a pending plan request', action: 'Fills → f-16 (early-refill request pending), press Cancel fill and Confirm', expected: '“Fill cancelled.”; the last timeline step says the pending plan request was withdrawn with it', focus: 'article[data-fill=f-16] [data-timeline]',
      run: async () => {
        await page.locator('nav').getByRole('button', { name: /Fills/ }).click();
        await t.idle();
        await pick('f-16');
        await $('[data-action=preview-cancel]').click();
        await $('[data-flow=cancel]').waitFor();
        await t.settled();
        await $('[data-action=confirm-flow]').click();
        await $('[data-flash]').filter({ hasText: 'Fill cancelled.' }).waitFor();
        await t.settled();
        check('Cancelling a fill with a pending plan request names both outcomes in its last timeline step', (await $('article[data-fill=f-16] [data-timeline] li').last().innerText()).includes('Cancelled; its pending plan request was withdrawn with it') && (await t.data()).fills.find(f => f.fill_id === 'f-16').state === 'cancelled');
        return '';
      } },
    { title: 'Give access after its fill was cancelled', action: 'Household → Give access (the form kept from before, not previewed)', expected: 'The form says the fill it was limited to is no longer open and the limit was cleared; Pickup covers asks to choose again; Preview change is disabled', focus: '[data-form=grant]',
      run: async () => {
        await page.locator('nav').getByRole('button', { name: /Household/ }).click();
        await $('article[data-person=p-2]').waitFor();
        await t.settled();
        if (!(await $('[data-form=grant]').isVisible())) await $('[data-action=open-grant]').click();
        await $('[data-form=grant]').waitFor();
        await t.settled();
        const shown = await $('[data-field=grant-fill]').inputValue(), note = await $('[data-fill-gone]').count() ? await $('[data-fill-gone]').innerText() : '', f = (await t.data()).fills.find(x => x.fill_id === 'f-16');
        check('A fill limit that is no longer among the open fills is cleared without choosing all fills in its place: the form says so, asks to choose again and keeps Preview disabled', f.state === 'cancelled' && shown === 'unchosen' && note.includes('no longer open') && note.includes('before previewing') && await $('[data-action=preview-grant]').getAttribute('aria-disabled') === 'true' && await $('[data-flow]').count() === 0);
        return 'f-16 ' + f.state + '; Pickup covers: choose again; Preview change disabled';
      } },
    { title: 'Preview only after the fills are chosen again', action: 'Press Preview change (nothing is sent); Pickup covers → All of Alex Rivera’s fills (chosen explicitly) → Preview change', expected: 'The first press sends nothing and asks which fills the access covers; once all fills are chosen, the preview is for pickup access to all of Alex’s records', focus: '[data-flow=grant]',
      run: async () => {
        const sent = [];
        const spy = r => { if (r.url().endsWith('/api/call') && r.postDataJSON()?.name === P + 'grants.change.preview') sent.push(r.postDataJSON().arguments); };
        page.on('request', spy);
        await $('[data-action=preview-grant]').click({ force: true });
        await t.settled();
        const asked = await $('[data-form=grant]').innerText(), before = sent.length;
        check('While the fill choice is open, Preview sends nothing and asks which fills the access covers', before === 0 && asked.includes('Choose which fills the pickup access covers first.') && await $('[data-flow]').count() === 0);
        await $('[data-field=grant-fill]').selectOption('');
        const enabled = await $('[data-action=preview-grant]').getAttribute('aria-disabled') === 'false' && await $('[data-fill-gone]').count() === 0;
        await $('[data-action=preview-grant]').click();
        await $('[data-flow=grant], [data-form=grant] [role=alert][data-code]:not(:empty)').first().waitFor();
        await t.settled();
        page.off('request', spy);
        const own = await t.agent('grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: null });
        const code = await $('[data-flow=grant] [data-token]').count() ? (await $('[data-flow=grant] [data-token]').innerText()).trim() : null;
        check('Choosing all of Alex’s fills explicitly enables Preview, and only then a request for all fills is sent', enabled && sent.length === 1 && sent[0].fill_id === null && sent[0].scope === 'pickup' && code === own.preview.token);
        return 'first press: no request; after choosing all fills: grants.change.preview with fill_id ' + JSON.stringify(sent[0] && sent[0].fill_id) + ', the same token as the Agent preview';
      } },
    { title: 'An unconfirmed cancellation is described in words', action: 'Discard the access preview; Fills → f-20 and type a quantity without saving; open f-17, press Cancel fill and Confirm, with the answer dropped after Mendwell committed it', expected: 'The waiting banner names the cancellation in words, with the fill ID only as a reference', focus: '[aria-label="Waiting for Mendwell"]',
      run: async () => {
        await $('[data-action=discard-flow]').click();
        await t.settled();
        await page.locator('nav').getByRole('button', { name: /Fills/ }).click();
        await t.idle();
        await pick('f-20');
        await $('[data-action=open-quantity]').click();
        await $('[data-field=new-quantity]').fill('30');
        await pick('f-17');
        await $('[data-action=preview-cancel]').click();
        await $('[data-flow=cancel]').waitFor();
        await t.settled();
        t.allowConsole(/net::ERR_FAILED/);
        lostCancel = await t.dropAfterCommit(p => p.name === P + 'fills.cancel.confirm');
        await $('[data-action=confirm-flow]').click();
        await $('[role=alert][data-code=connection_lost]').first().waitFor();
        await t.settled();
        await t.release();
        bannerText = await $('[aria-label="Waiting for Mendwell"]').innerText();
        check('An unconfirmed request is described in words, with its ID only as a reference', bannerText.includes('cancel the omeprazole 20 mg fill') && bannerText.includes('Reference f-17.') && !bannerText.includes('fill f-17'));
        return '';
      } },
    { title: 'A Retry answer stamped for another epoch is not taken as success', action: 'Press Retry; Infra reloads the fixture before the retry is answered, and the answer comes back stamped with the new epoch', expected: 'No “Fill cancelled”; the status says the outcome cannot be confirmed; f-17 is still ready in the new run', focus: '#status',
      run: async () => {
        await page.route('**/api/call', async route => {
          if (callName(route) !== P + 'fills.cancel.confirm') return route.continue();
          await seed('web-restricted-foreign-receipt');
          const now = (await t.version()).epoch;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...lostCancel.forwarded, version: { ...lostCancel.forwarded.version, epoch: now } }) });
        });
        await $('[data-action=retry-unknown]').click();
        await $('[role=alert][data-code=unconfirmed]').first().waitFor();
        await t.settled();
        await page.unroute('**/api/call');
        after = await t.data();
        check('A Retry answer stamped for another epoch is not taken as success: no “Fill cancelled”, the outcome cannot be confirmed, and the fill is still ready in the new run', await $('[data-flash]').count() === 0 && (await $('#status').innerText()).includes('cannot be confirmed') && after.fills.find(f => f.fill_id === 'f-17').state === 'ready' && after.authorizations.find(a => a.fill_id === 'f-17').state === 'live');
        return '';
      } },
    { title: 'An edited form from the older epoch is gone', action: 'Open f-20 and Change quantity again', expected: 'The form shows the new run’s quantity, 90, with no conflict note, so nothing old can be saved', focus: '[data-form=quantity]',
      run: async () => {
        await pick('f-20');
        await $('[data-action=open-quantity]').click();
        check('An edited form from the older epoch is gone once a newer epoch is seen in any answer: the form shows the new run’s quantity, so nothing old can be saved', await $('[data-field=new-quantity]').inputValue() === '90' && await $('[data-form=quantity] [data-conflict]').count() === 0);
        return '';
      } },
    { title: 'A reset between the re-preview and the write', action: 'Close the form; open f-17, press Cancel fill and Confirm while Infra reloads the fixture before the confirmation reaches Mendwell', expected: 'stale_version stays on screen after the page settles; the status says nothing was changed; nothing is cancelled', focus: '[role=alert][data-code=stale_version]',
      run: async () => {
        await $('[data-form=quantity]').getByRole('button', { name: 'Close', exact: true }).click();
        await pick('f-17');
        await $('[data-action=preview-cancel]').click();
        await $('[data-flow=cancel]').waitFor();
        await t.settled();
        between = await t.beforeForward(p => p.name === P + 'fills.cancel.confirm', () => seed('web-restricted-between'));
        await $('[data-action=confirm-flow]').click();
        await $('[role=alert][data-code=stale_version]').first().waitFor();
        await t.settled();
        await t.release();
        after = await t.data();
        check('A reset between the re-preview and the write leaves the refusal on screen after the page settles, and nothing is cancelled', between.hit && await $('[role=alert][data-code=stale_version]').count() === 1 && (await $('#status').innerText()).includes('Nothing was changed') && after.fills.find(f => f.fill_id === 'f-17').state === 'ready');
        return '';
      } },
    { title: 'A reset right after a real commit keeps its success message', action: 'Open f-20, change the quantity to 30 and Save; Infra reloads the fixture right after Mendwell committed the change', expected: '“Quantity changed to 30” stays after the refresh; the reloaded run holds quantity 90', focus: '[data-flash]',
      run: async () => {
        await pick('f-20');
        await $('[data-action=open-quantity]').click();
        await $('[data-field=new-quantity]').fill('30');
        await page.route('**/api/call', async route => {
          if (callName(route) !== P + 'fills.change_quantity') return route.continue();
          const response = await route.fetch();
          await seed('web-restricted-after-commit');
          await route.fulfill({ response });
        });
        await $('[data-action=save-quantity]').click();
        await $('[data-flash]').filter({ hasText: 'Quantity changed to 30' }).waitFor();
        await t.settled();
        await page.unroute('**/api/call');
        check('A reset right after a real commit keeps that change’s success message after the refresh', await $('[data-flash]').filter({ hasText: 'Quantity changed to 30' }).count() === 1 && (await t.data()).fills.find(f => f.fill_id === 'f-20').quantity === 90);
        return '';
      } },
    { title: 'Repeating an open preview across a reset', action: 'Household → Mia Rivera → Revoke g-2 (preview); press Revoke again while Infra reloads the fixture, and the refresh after it fails', expected: 'No preview that can be confirmed; the reset is named', focus: '[role=alert][data-code=reset]',
      run: async () => {
        await page.locator('nav').getByRole('button', { name: /Household/ }).click();
        await $('[data-list=people] [data-person-id=p-3]').click();
        await $('article[data-person=p-3]').waitFor();
        await t.settled();
        await $('[data-action=revoke][data-grant-id=g-2]').click();
        await $('[data-flow=revoke]').waitFor();
        await t.settled();
        again = await t.beforeForward(p => p.name === P + 'grants.change.preview', () => seed('web-restricted-revoke-again'), p => p.name === P + 'household.list');
        await $('[data-action=revoke][data-grant-id=g-2]').click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        check('Repeating an open preview across a reset, with the refresh failing, leaves no preview that can be confirmed', again.hit && again.failed && await $('[data-action=confirm-flow]').count() === 0 && await $('[role=alert][data-code=reset]').count() === 1);
        return '';
      } },
    { title: 'A preview from before a reset is not kept', action: 'Refresh; Fills; open f-17 and its cancellation preview; Infra reloads the fixture; reload the page', expected: 'No preview after the reload; f-17 stays ready with its live authorization; nothing from before is sent', focus: '[data-list=fills]',
      run: async () => {
        await t.refresh();
        await page.locator('nav').getByRole('button', { name: /Fills/ }).click();
        await t.settled();
        await pick('f-17');
        await $('[data-action=preview-cancel]').click();
        await $('[data-flow=cancel]').waitFor();
        await t.settled();
        await seed('web-restricted-reset-1');
        await page.reload();
        await t.idle();
        await t.settled();
        kept = await t.data();
        check('A preview open before Mendwell was reset is not kept after a reload, and nothing from before is sent', await $('[data-flow]').count() === 0 && kept.fills.find(f => f.fill_id === 'f-17').state === 'ready' && kept.authorizations.find(a => a.fill_id === 'f-17').state === 'live');
        return '';
      } },
    { title: 'An edited form from before a reset is closed', action: 'Open f-20, Change quantity, type 30; Infra reloads the fixture; Refresh', expected: 'The form is closed, the page says nothing from before was sent; f-20 keeps quantity 90', focus: '[data-lost]',
      run: async () => {
        await pick('f-20');
        await $('[data-action=open-quantity]').click();
        await $('[data-field=new-quantity]').fill('30');
        await seed('web-restricted-reset-2');
        await t.refresh();
        check('An edited form from before a reset is closed on the next Refresh, the page says so, and nothing is sent', await $('[data-form=quantity]').count() === 0 && (await $('[data-lost]').innerText()).includes('Nothing from before was sent') && (await t.data()).fills.find(f => f.fill_id === 'f-20').quantity === 90 && (await t.snapshot()).audit.every(x => !x.tool.endsWith('change_quantity')));
        return '';
      } },
    { title: 'A dialog for an action the new access no longer allows closes', action: 'Infra moves the clock to 12:45; Refresh; open f-20, press Wait for the eligible date; while the dialog is open Infra revokes Sam’s refill grant g-h1; Refresh', expected: 'The dialog closes and the fill shows only its pickup details', focus: 'article[data-fill=f-20]',
      run: async () => {
        await t.advance('2026-11-18T12:45:00-05:00');
        await t.refresh();
        await pick('f-20');
        await $('[data-action=wait]').click();
        await $('[data-ask]').waitFor();
        await sam('g-h1', 'revoked');
        await t.refresh();
        await $('article[data-fill=f-20][data-view=logistics]').waitFor();
        await t.settled();
        check('An open confirmation dialog for an action that the new access no longer allows closes on Refresh and leaves no detail behind', await $('[data-ask]').count() === 0 && !/Jan 20|Resubmit/.test(await $('.workspace').innerText()));
        return '';
      } },
    { title: 'An unanswered request about a fill that became pickup-only', action: 'Infra grants refill access again (g-30); Refresh; open f-20, Ask the plan, Send with the answer dropped after Mendwell committed it; Infra revokes g-30; Refresh', expected: 'The waiting request first names the early-refill request and offers Retry; afterwards it no longer names what it asked and cannot be retried', focus: '[data-unknown=hidden]',
      run: async () => {
        await sam('g-30', 'active');
        await t.refresh();
        await pick('f-20');
        await $('[data-action=open-plan]').click();
        t.allowConsole(/net::ERR_FAILED/);
        lostPlan = await t.dropAfterCommit(p => p.name === P + 'plan_requests.create');
        await $('[data-action=send-plan-request]').click();
        await $('[role=alert][data-code=connection_lost]').first().waitFor();
        await t.settled();
        await t.release();
        named = (await $('[aria-label="Waiting for Mendwell"]').innerText()).includes('early-refill') && await $('[data-action=retry-unknown]').count() === 1;
        await sam('g-30', 'revoked');
        await t.refresh();
        await $('[data-unknown=hidden]').waitFor();
        await t.settled();
        check('An unanswered request about a fill that is now pickup-only no longer names what it asked and cannot be retried', named && lostPlan.forwarded?.status === 'committed' && await $('[data-action=retry-unknown]').count() === 0 && !/early-refill|sertraline/.test(await $('.workspace').innerText()));
        return '';
      } },
    { title: 'A preview answered after a reset is not kept', action: 'Dismiss; Infra reloads the fixture at 12:45; Refresh; open f-20 and press Pay the cash price while Infra reloads the fixture before the preview reaches Mendwell, and the refresh after it fails', expected: 'Confirm is never offered; the page says Mendwell was reset or reloaded while the preview was being prepared', focus: '[role=alert][data-code=reset]',
      run: async () => {
        await $('[data-action=dismiss-unknown]').click();
        await t.loadSeed({ data: read('fixtures/minimal.json'), virtual_now: '2026-11-18T12:45:00-05:00', request_id: 'web-restricted-clean' });
        await t.refresh();
        await $('[data-list=fills] [data-fill-id=f-20]').click();
        await page.locator('article[data-fill=f-20][data-state=claim_rejected]').waitFor();
        await t.settled();
        race = await t.beforeForward(p => p.name === P + 'fills.choose_cash.preview', () => t.loadSeed({ data: read('fixtures/minimal.json'), virtual_now: '2026-11-18T12:45:00-05:00', request_id: 'web-restricted-race' }), p => p.name === P + 'household.list');
        await $('[data-action=preview-cash]').click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        await t.release();
        check('A preview answered after a reset that happened after the click is not kept: Confirm is never offered, and the reason stays although the refresh after it failed', race.hit && race.failed && await $('[data-flow]').count() === 0 && await $('[data-action=confirm-flow]').count() === 0 && (await $('[role=alert][data-code=reset]').innerText()).includes('was reset or reloaded while this preview was being prepared'));
        return '';
      } },
    { title: 'A preview from before a reload is refused on Confirm', action: 'Refresh; on f-20 press Pay the cash price (preview); Infra reloads the fixture (new epoch); Confirm', expected: 'Confirm is refused as a reset, the reason stays on screen, nothing is written', focus: '[role=alert][data-code=reset]',
      run: async () => {
        await t.refresh();
        await page.locator('article[data-fill=f-20][data-state=claim_rejected]').waitFor();
        await t.settled();
        await page.locator('[data-action=preview-cash]').click();
        await page.locator('[data-flow=cash]').waitFor();
        await t.settled();
        epoch = (await t.version()).epoch;
        await t.loadSeed({ data: read('fixtures/minimal.json'), virtual_now: '2026-11-18T12:45:00-05:00', request_id: 'web-restricted-reload' });
        await page.locator('[data-action=confirm-flow]').click();
        await page.locator('[role=alert][data-code=reset]').waitFor();
        await t.settled();
        reloaded = await t.data();
        check('A preview made before Mendwell was reloaded (new epoch) is refused on Confirm, the reason stays on screen, and nothing is written', (await t.version()).epoch === epoch + 1 && await page.locator('[data-flow]').count() === 0 && await page.locator('[role=alert][data-code=reset]').count() === 1 && reloaded.fills.find(f => f.fill_id === 'f-20').cash === null && (await t.snapshot()).audit.every(a => !a.tool.endsWith('choose_cash.confirm')));
        return '';
      } },
    { title: 'A lost answer retried after a reload cannot be confirmed', action: 'Refresh; on f-20 press Wait for the eligible date and Yes, with the answer dropped after Mendwell committed it; Infra reloads the fixture; Retry', expected: 'The retry is reported as cannot be confirmed, in the message and the status; nothing is resubmitted', focus: '[role=alert][data-code=unconfirmed]',
      run: async () => {
        await t.refresh();
        await page.locator('article[data-fill=f-20][data-state=claim_rejected]').waitFor();
        await t.settled();
        t.allowConsole(/net::ERR_FAILED/);
        lost = await t.dropAfterCommit(p => p.name === P + 'fills.wait');
        await page.locator('[data-action=wait]').click();
        await page.locator('[data-action=ask-yes]').click();
        await page.locator('[role=alert][data-code=connection_lost]').first().waitFor();
        await t.settled();
        await t.release();
        await t.loadSeed({ data: read('fixtures/minimal.json'), virtual_now: '2026-11-18T12:45:00-05:00', request_id: 'web-restricted-reload-2' });
        await page.locator('[data-action=retry-unknown]').click();
        await page.locator('[role=alert][data-code=unconfirmed]').first().waitFor();
        await t.settled();
        check('A request whose answer was lost, retried after Mendwell was reloaded, is reported as cannot be confirmed, and after the page settles the message and the status still say so', lost.forwarded?.status === 'committed' && await page.locator('[data-action=retry-unknown]').count() === 0 && await page.locator('[role=alert][data-code=unconfirmed]').count() === 1 && (await page.locator('#status').innerText()).includes('cannot be confirmed') && (await t.data()).fills.find(f => f.fill_id === 'f-20').resubmission_due_at === null);
        return '';
      } },
    { title: 'Ask the plan opens under the full policy', action: 'Refresh; on f-20 press Ask the plan and type a note', expected: 'The plan-request form is open', focus: '[data-form=plan]',
      run: async () => {
        await t.refresh();
        await page.locator('article[data-fill=f-20][data-state=claim_rejected]').waitFor();
        await t.settled();
        await page.locator('[data-action=open-plan]').click();
        await page.locator('[data-field=plan-note]').fill('Please approve the early refill.');
        await t.settled();
        check('Under the full policy the rejected fill offers Ask the plan and its form opens', await page.locator('[data-form=plan]').count() === 1);
        return '';
      } },
    { title: 'Sending through a control the new policy no longer allows', action: 'Infra reloads the fixture with a policy that omits plan_requests.create; press Send on the open form', expected: 'A plain refusal by the Host (not_permitted): no waiting state, no retry, nothing created', focus: '[role=alert][data-code=not_permitted]',
      run: async () => {
        for (const p of Object.values(policies)) p.allow = p.allow.filter(n => n !== P + 'plan_requests.create');
        await t.loadSeed({ data: read('fixtures/minimal.json'), policies, virtual_now: '2026-11-18T12:45:00-05:00', request_id: 'web-restricted-policy' });
        t.allowConsole(/status of 403/);
        await page.locator('[data-action=send-plan-request]').click();
        await page.locator('[role=alert][data-code=not_permitted]').first().waitFor();
        await t.settled();
        check('Sending through a control that the new policy no longer allows is a plain refusal by the Host: no “Waiting for Mendwell”, no retry, nothing created', await page.locator('[aria-label="Waiting for Mendwell"]').count() === 0 && await page.locator('[data-action=retry-unknown]').count() === 0 && !(await t.data()).plan_requests.some(x => x.fill_id === 'f-20'));
        return '';
      } },
    { title: 'Refresh removes the control the policy dropped', action: 'Refresh', expected: 'The open form and Ask the plan are gone; Pay the cash price and Wait stay', focus: 'article[data-fill=f-20]',
      run: async () => {
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.locator('[data-form=plan]').waitFor({ state: 'detached' });
        await page.locator('article[data-fill=f-20][data-state=claim_rejected]').waitFor();
        await t.settled();
        check('After the policy drops plan_requests.create, Refresh removes the open plan-request form and the Ask the plan control while the other recovery actions stay', await page.locator('[data-action=open-plan]').count() === 0 && await page.locator('[data-action=preview-cash]').count() === 1 && await page.locator('[data-action=wait]').count() === 1);
        return '';
      } },
    { title: 'A forced plan request is refused', action: 'Send plan_requests.create for f-20 directly from the page’s business session', expected: 'HTTP 403; nothing created', focus: 'article[data-fill=f-20]',
      run: async () => {
        t.allowConsole(/status of 403/);
        forced = await t.business(P + 'plan_requests.create', { fill_id: 'f-20', expected_version: await t.version(), request_id: 'web-forced-plan-request' });
        await t.settled();
        d = await t.data();
        forcedOk = forced.http === 403;
        check('A forced plan_requests.create call is refused (403) and nothing is created', forced.http === 403 && !d.plan_requests.some(x => x.fill_id === 'f-20') && d.fills.find(f => f.fill_id === 'f-20').plan_request_id === null);
        return '';
      } },
    { title: 'A refusal is explained for what it means here', action: 'Infra reloads the fixture with a policy that omits fills.list; Refresh; Prescriptions → sertraline (rx-8) → Request a fill at Maple Avenue', expected: 'duplicate_request explained in plain words without internal IDs; the status does not say all changes are saved', focus: '[role=alert][data-code=duplicate_request]',
      run: async () => {
        await t.shot('restricted');
        noList = read('fixtures/policies.json');
        for (const p of Object.values(noList)) p.allow = p.allow.filter(n => n !== P + 'fills.list');
        await t.loadSeed({ data: read('fixtures/minimal.json'), policies: noList, virtual_now: '2026-11-18T12:45:00-05:00', request_id: 'web-restricted-nolist' });
        await t.refresh();
        await page.locator('nav').getByRole('button', { name: /Prescriptions/ }).click();
        await $('[data-rx-id=rx-8]').click();
        await $('article[data-rx=rx-8]').waitFor();
        await t.settled();
        await $('[data-action=open-request]').click();
        await $('[data-field=request-store]').selectOption('st-1');
        await $('[data-action=request-fill]').click();
        await $('[role=alert][data-code=duplicate_request]').first().waitFor();
        await t.settled();
        dup = await $('[role=alert][data-code=duplicate_request]').innerText();
        check('A refusal is explained for what it means here, without internal IDs, and the status does not say “All changes saved”', forcedOk && dup.includes('already has a fill in progress') && !/f-20|rx-8|already done/.test(dup) && (await $('#status').innerText()).trim() !== 'All changes saved');
        return '';
      } },
    { title: 'A refused read is shown in plain words', action: 'Infra moves the clock to 1 January 2201, past the App’s supported range; Refresh', expected: 'The status says Mendwell refused to show its current state, without the App’s raw message', focus: '#status',
      run: async () => {
        await t.advance('2201-01-01T12:00:00-05:00');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await $('#status[data-error=true]').waitFor();
        await t.settled();
        shown = await $('#status').innerText();
        check('A read that Mendwell refuses is shown in plain words, never as the App’s raw message', shown.includes('Mendwell refused to show its current state') && !/supported range|2201|clock/i.test(shown));
        return '';
      } }
  ] };
}

async function restricted(t) {
  for (const s of restrictedRun(t).steps) await s.run();
}

module.exports = { workflows, restrictedRun };

if (require.main === module) runWebAcceptance({ app: 'mendwell-pharmacy', appDir, workflows, restricted, timezoneId: 'Asia/Tokyo', strictChecks: true });
