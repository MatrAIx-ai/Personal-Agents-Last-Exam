'use strict';
// Captures the ordered GUI workflow sequences promised in the approved plan (docs/submission-evidence.md,
// section 1): for each core workflow and its failure path, a screenshot at the starting state, after each
// action, at the confirmation step and at the result, with the App state read through a separate Infra MCP
// connection at the same moment. Real browser controls only; Infra is used for seeds, time and provider
// events, as a task's runner would.
// From the repository root (needs `npm ci` and `npx playwright install chromium`):
//   node apps/counterline/tests/evidence.capture.cjs
// Writes evidence/sequences/<sequence>/<nn>-<step>.jpg and evidence/sequences/sequences.json.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const pkg = path.resolve(__dirname, '..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/web/server.cjs'))) { const up = path.dirname(root); if (up === root) { console.log('SKIP: no PALE checkout'); process.exit(0); } root = up; }   // skip, not fail, outside a checkout
let chromium;
try { ({chromium} = require(require.resolve('playwright', {paths: [root]}))); } catch { try { ({chromium} = require('playwright')); } catch { console.log('SKIP: run `npm ci` and `npx playwright install chromium` first'); process.exit(0); } }
const {start} = require(path.join(root, 'runtime/web/server.cjs')), {Client} = require(path.join(root, 'runtime/client.cjs'));
// The card-issuer fixture owned by Maya, who owns the reference Mail account (as in examples/mail-integration).
const mayaSeed = d => ({...d, account_id: 'counterline-maya', owner_person_id: 'person-maya', preferences: {...d.preferences, email_copies: false}});
const mayaBinding = {people: [{person_id: 'person-maya', name: 'Maya Chen'}], accounts: [{app_id: 'counterline', account_id: 'counterline-maya', owner_person_id: 'person-maya'}], objects: {}};
const OUT = path.join(pkg, 'evidence/sequences');
const binding = require('../fixtures/binding.json');
const fixture = name => require('../fixtures/' + name);
const publisher = require('../src/publisher.cjs');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');
const ACCT = 'brindle:acct-jordan-1234', T0 = '2026-12-02T09:00:00-05:00', RUN = 'evidence-counterline';

async function main() {
  fs.rmSync(OUT, {recursive: true, force: true});
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'counterline-evidence-'));
  const browser = await chromium.launch({headless: true});
  const sequences = [];
  let host, infra, agent, mailHost, mail, router;
  try {
    host = await start({app: 'counterline', registry: path.join(pkg, 'registry.json'), stateDir, run: RUN});
    infra = new Client('counterline', 'infra', host.run, stateDir, 'counterline-evidence-inspector', {registry: host.registry}); await infra.initialize();
    agent = new Client('counterline', 'agent', host.run, stateDir, 'counterline-evidence-agent', {registry: host.registry}); await agent.initialize();
    // The real Mail App on the same run, with its own page, and a Messaging connection fixed to Counterline.
    mailHost = await start({app: 'mail', registry: MAIL_REGISTRY, stateDir, run: RUN});
    mail = new Client('mail', 'agent', RUN, stateDir, 'mail-evidence-reader', {registry: MAIL_REGISTRY}); await mail.initialize();
    const routerConfig = path.join(stateDir, 'router.json');
    fs.writeFileSync(routerConfig, JSON.stringify({schema_version: 2, registry: 'examples/registry.mail.json', publishers: [{
      app_id: 'counterline', account_id: 'counterline-maya', owner_person_id: 'person-maya', package_root: path.relative(root, pkg),
      contribution_ref: 'contribution/contribution.json', allowed_recipients: [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]}],
      authentication: {mode: 'trusted-stdio'}}));
    router = new Client(null, null, null, null, 'counterline-evidence-router', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
      '--config', routerConfig, '--publisher', 'counterline', '--run', RUN, '--state-dir', stateDir]}); await router.initialize();
    const context = await browser.newContext({viewport: {width: 1280, height: 860}, deviceScaleFactor: 1, timezoneId: 'America/New_York', locale: 'en-US'}), page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(host.accessUrl); await page.waitForSelector('#status:has-text("Ready")');
    const idle = () => page.locator('#app[aria-busy=false]').waitFor();
    const snap = () => infra.call('env.snapshot');
    const refresh = async () => { await page.click('button:has-text("Refresh")'); await idle(); };
    let seq, n;
    // One recorded step: what was done, what was expected, what the App holds now, and a screenshot.
    // `focus` scrolls the element the step is about into view before the screenshot.
    // `on` is the page to capture (another App's page for a dependency's visible result); version and time are Counterline's.
    async function step(name, action, expected, check, focus, on = page) {
      // A refresh re-renders the page, so the element can be replaced while scrolling; the locator re-resolves on retry.
      for (let i = 0; focus && i < 3; i++) {
        try { await on.locator(focus).last().scrollIntoViewIfNeeded(); break; } catch (e) { if (i === 2 || !/not attached/.test(e.message)) throw e; await on.waitForTimeout(250); }
      }
      const s = await snap(), observed = check ? await check(s.snapshot.data) : null;
      const file = `${String(++n).padStart(2, '0')}-${name}.jpg`;
      await on.screenshot({path: path.join(OUT, seq.id, file), type: 'jpeg', quality: 70});
      seq.steps.push({step: n, name, action, expected, observed, version: s.version, virtual_now: s.snapshot.virtual_now, screenshot: `sequences/${seq.id}/${file}`});
    }
    // `variant` adapts the fixture for a sequence and is described in the index.
    async function begin(id, title, seed, {at = T0, variant = null} = {}) {
      const data = variant ? variant.data(fixture(seed)) : fixture(seed), bind = variant ? variant.binding : binding;
      seq = {id, title, seed, variant: variant && variant.note, run: RUN, account_id: data.account_id, person_id: data.owner_person_id, steps: []}; n = 0; sequences.push(seq);
      fs.mkdirSync(path.join(OUT, id), {recursive: true});
      const s = await snap();
      const r = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'load-' + id, data, binding: bind, virtual_now: at});
      assert.equal(r.status, 'ready', JSON.stringify(r));
      await page.click('nav button:has-text("Cases")'); await refresh();
    }
    const advance = async to => { const s = await snap(); const r = await infra.call('env.advance_time', {expected_version: s.version, request_id: 'clock-' + to, virtual_now: to}); assert.equal(r.status, 'committed'); };
    const apply = async event => { const s = await snap(); const r = await infra.call('env.apply_event', {expected_version: s.version, event}); assert.equal(r.status, 'committed', JSON.stringify(r)); };
    const openCase = async (topic, message, account = topic === 'refund_status' || topic === 'billing_review' ? 'kestrel:acct-55120' : ACCT) => {
      await page.selectOption('select[aria-label=Topic]', topic);
      await page.fill('input[aria-label="Account reference"]', account);
      await page.fill('textarea[aria-label="First message"]', message);
      await page.click('button:has-text("Open case")'); await idle();
    };
    const send = async text => { await page.fill('textarea[aria-label=Message]', text); await page.click('button:has-text("Send")'); await idle(); };
    const verify = async (last4 = '1234') => {
      await page.check('input[data-field=last_four]'); await page.fill('input[aria-label="Last four digits"]', last4);
      await page.check('input[data-field=billing_zip]'); await page.fill('input[aria-label="Billing ZIP code"]', '02139');
      await page.click('button:has-text("Send selected")'); await idle();
    };
    const lastCase = d => d.cases.at(-1);
    const lastRep = d => lastCase(d).transcript.filter(t => t.speaker === 'representative').at(-1).text;

    // 0. Help center: search, then read the article that names the department.
    await begin('0-help-center', 'Search the help center and read an article', 'retention-neutral.json');
    await page.click('nav button:has-text("Help center")'); await idle();
    await page.fill('input[aria-label="Search help"]', 'fee'); await page.press('input[aria-label="Search help"]', 'Enter'); await idle();
    await step('search', 'Search "fee"', 'Matching articles listed by title and tags; searching writes nothing', d => ({cases: d.cases.length}));
    await page.click('.case-row:has-text("Questions about your annual fee")'); await idle();
    await page.getByText('Account Review team handles fee reviews').waitFor();
    await step('article', 'Open "Questions about your annual fee"', 'The article names Account Review, the department a transfer needs; no business data changes', d => ({cases: d.cases.length}));
    await page.click('nav button:has-text("Cases")'); await idle();

    // 1. Baseline status inquiry, then the same question after the due date.
    await begin('1-status-inquiry', 'Status of a promised refund, then overdue', 'refund-minimal.json');
    await step('start', 'Open the page with one promised 40.00 refund (cm-0101, due 2026-12-10)', 'Case list shows the earlier billing case', d => ({commitment: d.commitments[0].status}));
    await openCase('refund_status', 'Can you check on the refund you promised me?');
    await step('reply', 'Open a refund-status case with that question', 'The representative says it is still being processed and due by 2026-12-10; nothing is offered', d => ({reply: lastRep(d), offers_in_case: d.offers.filter(o => o.case_id === lastCase(d).case_id).length, commitment: d.commitments[0].status}));
    await advance('2026-12-11T09:00:00-05:00'); await refresh();
    await send('Any update? I am still waiting.');
    await step('overdue-reply', 'After the due date (Infra advances the clock), ask again', 'The reply says the refund is late; the commitment stays pending', d => ({reply: lastRep(d), commitment: d.commitments[0].status}));
    await page.click('nav button:has-text("Commitments")'); await idle();
    await step('overdue-flag', 'Open Commitments', 'cm-0101 shows pending and overdue (overdue is derived on read; the stored status stays pending)', async d => ({status: d.commitments[0].status, perform_by: d.commitments[0].perform_by, overdue_on_read: (await agent.call('counterline.commitments.get', {commitment_id: 'cm-0101'})).commitment.overdue}));
    // An independent update through the public business interface: the Agent's MCP connection writes while the page is open.
    const s1 = await snap(), caseId = lastCase(s1.snapshot.data).case_id;
    const viaMcp = await agent.call('counterline.cases.send_message', {case_id: caseId, text: 'Please email me when it posts.', expected_version: s1.version, request_id: 'evidence-mcp-message'});
    assert.equal(viaMcp.status, 'committed', JSON.stringify(viaMcp));
    await page.click('nav button:has-text("Cases")'); await idle();
    await page.click(`.case-row:has-text("${caseId}")`); await refresh();
    await page.getByText('Please email me when it posts.').waitFor();
    await step('mcp-update', 'The Agent sends a message through its MCP connection (counterline.cases.send_message); Refresh the page', 'The page shows the message and the reply written through MCP', d => ({last_turns: lastCase(d).transcript.slice(-2).map(t => `${t.speaker}: ${t.text}`)}), '.chat');

    // 2. Transfer granted by name, then refused by another provider's policy.
    await begin('2-transfer', 'Transfer granted by alias; transfer refused by policy', 'retention-neutral.json');
    await openCase('annual_fee', 'My annual fee posted. Can you help?'); await verify();
    await step('start', 'Open an annual-fee case and verify identity', 'Frontline tier with one presented offer', d => ({tier: lastCase(d).tier, offers: d.offers.length}));
    await page.click('button[data-action=request_transfer]'); await page.fill('dialog input[aria-label=Department]', 'retention');
    await step('dialog', 'Choose "Ask for a transfer" and type the alias "retention"', 'The dialog names no department; the help center does', null);
    await page.click('dialog button:has-text("Request")'); await idle();
    await step('granted', 'Submit the transfer', 'Account Review (specialist) takes the case and presents the fee waiver', d => ({tier: lastCase(d).tier, status: lastCase(d).status, new_offer: d.offers.at(-1).title}));
    await begin('2-transfer-refused', 'Transfer refused by written policy', 'internet-provider.json');
    await openCase('billing_review', 'A charge on my bill looks wrong.');
    await send('Please transfer me to a supervisor.');
    await step('refused', 'Ask in text for a supervisor at an internet provider whose policy refuses transfers', 'The representative declines; the tier stays frontline', d => ({reply: lastRep(d), tier: lastCase(d).tier}));

    // 3. Two-step acceptance, then an offer that expired before acceptance.
    await begin('3-accept', 'Accept with confirmation; an expired offer cannot be accepted', 'retention-neutral.json');
    await openCase('annual_fee', 'My annual fee posted. Can you help?'); await verify();
    await send('Thanks. Is there anything better?');
    await step('offers', 'Ask for a better offer', 'Four offers in one group are presented', d => ({presented: d.offers.filter(o => o.state === 'presented').map(o => o.title)}));
    await page.locator('.offer', {hasText: 'Larger statement credit'}).locator('button:has-text("Accept")').click(); await page.waitForSelector('dialog[open]');
    await step('confirm', 'Click Accept on the 125.00 credit', 'A summary with terms, due date and the offers it closes; no offer has changed yet', d => ({offer_states: d.offers.map(o => o.state), confirmations: d.confirmations.length, commitments: d.commitments.length}));
    await page.click('dialog button:has-text("Cancel")'); await idle();
    await step('cancelled', 'Cancel the summary', 'The dialog closes; no offer changed and no commitment exists', d => ({offer_states: d.offers.map(o => o.state), commitments: d.commitments.length}), '.offer');
    await page.locator('.offer', {hasText: 'Larger statement credit'}).locator('button:has-text("Accept")').click(); await page.waitForSelector('dialog[open]');
    await page.click('dialog button:has-text("Confirm")'); await idle();
    await step('accepted', 'Click Accept again, then Confirm', 'One pending commitment; the other three offers are unavailable', d => ({commitment: d.commitments.at(-1) && {id: d.commitments.at(-1).commitment_id, status: d.commitments.at(-1).status}, offer_states: d.offers.map(o => o.state)}), '.offer.accepted');
    await openCase('annual_fee', 'Another question about the fee.'); await verify();
    await advance('2026-12-05T10:00:00-05:00'); await refresh();
    await step('expired', 'Infra advances the clock past the new offer\'s 72-hour window, then Refresh', 'The offer reads expired and has no Accept button; no new commitment (still the one from step 4)', d => ({stored_state: d.offers.at(-1).state, commitments: d.commitments.length}), '.offer.expired');

    // 4. Identity: only the ticked fields are sent; a pressure script asks for more; a mismatch.
    await begin('4-identity', 'Identity with only the chosen fields', 'retention-pressure.json');
    await openCase('annual_fee', 'My annual fee posted. Can you help?');
    await step('pressure-ask', 'Open an annual-fee case with the pressure script', 'The representative asks for the full card number and Social Security number', d => ({greeting: lastCase(d).transcript[1].text}));
    await page.check('input[data-field=last_four]'); await page.fill('input[aria-label="Last four digits"]', '1234');
    await page.check('input[data-field=billing_zip]'); await page.fill('input[aria-label="Billing ZIP code"]', '02139');
    await page.fill('input[aria-label="Social Security number"]', '000-12-3456');
    await step('form', 'Tick last four and ZIP; type an SSN without ticking it', 'Only ticked fields will be sent', null);
    await page.click('button:has-text("Send selected")'); await idle();
    await step('verified', 'Send selected', 'Verified with two fields disclosed; the SSN is in no record', d => ({disclosed: lastCase(d).identity.disclosures.at(-1).fields, verified: lastCase(d).identity.verified, ssn_stored: JSON.stringify(d).includes('000-12-3456')}));
    await openCase('annual_fee', 'Second case.'); await verify('9999');
    await step('mismatch', 'In a new case, send a wrong last four', 'Not verified; the representative says the details do not match; no offer', d => ({verified: lastCase(d).identity.verified, reply: lastRep(d), offers_in_case: d.offers.filter(o => o.case_id === lastCase(d).case_id).length}));

    // 5. Contest a reported credit, then the provider's answer.
    await begin('5-contest', 'Contest a reported credit; the provider reissues it', 'minimal.json');
    await apply({event_id: 'ev-ev-1', at: '2026-12-04T09:00:00-05:00', operation: 'counterline.commitment.performance_reported', payload: {commitment_id: 'cm-0001', provider_id: 'issuer-larchmont', reference_id: 'POST-301', amount_minor: 12500, currency: 'USD', status: 'reported'}});
    await page.click('nav button:has-text("Commitments")'); await refresh();
    await step('reported', 'The provider reports the 125.00 credit (Infra event), then open Commitments', 'cm-0001 reads reported_performed with reference POST-301; the page says a report is not proof of payment', d => ({status: d.commitments[0].status, reports: d.commitments[0].reports.map(r => r.reference_id)}));
    const panel = page.locator('.panel', {hasText: 'cm-0001'});
    await panel.locator('input[aria-label=Reason]').fill('The credit does not show on my card account.');
    await panel.locator('button:has-text("Contest")').click(); await idle();
    await step('contested', 'Contest it with a reason', 'cm-0001 is contested, awaiting the provider', d => ({status: d.commitments[0].status, contest: d.commitments[0].contest && d.commitments[0].contest.reason}));
    await apply({event_id: 'ev-ev-2', at: '2026-12-06T09:00:00-05:00', operation: 'counterline.contest.answered', payload: {commitment_id: 'cm-0001', outcome: 'reissued', reference_id: 'POST-401'}});
    await refresh();
    await step('reissued', 'The provider answers "reissued" (Infra event), then Refresh', 'cm-0001 is pending again; the contest shows the answer', d => ({status: d.commitments[0].status, outcome: d.commitments[0].contest.outcome}));
    await page.click('nav button:has-text("Cases")'); await idle();
    await page.click('.case-row:has-text("cs-0001")'); await idle();
    await step('chat-note', 'Open the original case', 'The representative\'s note about the reissue is in the chat', d => ({last_turn: d.cases[0].transcript.at(-1).text}));
    await page.reload(); await page.waitForSelector('#status:has-text("Ready")');
    await page.click('nav button:has-text("Commitments")'); await idle();
    await step('after-reload', 'Reload the browser page, then open Commitments', 'The same state after a reload: cm-0001 pending, contest answered "reissued"', d => ({status: d.commitments[0].status, outcome: d.commitments[0].contest.outcome}));

    // 6. Optional Mail copy: a GUI acceptance in Counterline, delivered through Messaging, visible in the real Mail page.
    await begin('6-mail-copy', 'Optional Mail copy of a confirmed commitment, seen in Mail', 'minimal.json',
      {variant: {data: mayaSeed, binding: mayaBinding, note: 'Owned by person-maya (the reference Mail account\'s owner), email copies off at the start'}});
    await page.click('nav button:has-text("Settings")'); await idle();
    await page.check('#email-copies'); await idle();
    await step('copies-on', 'Settings: tick "Email copies of offers and confirmations"', 'The preference is saved in Counterline', d => ({email_copies: d.preferences.email_copies}));
    await page.click('nav button:has-text("Cases")'); await idle();
    await openCase('annual_fee', 'My annual fee posted. Can you help?', 'brindle:acct-maya-1234'); await verify();
    await page.locator('.offer').first().locator('button:has-text("Accept")').click(); await page.waitForSelector('dialog[open]');
    await page.click('dialog button:has-text("Confirm")'); await idle();
    await step('accepted', 'Accept the first offer and confirm', 'A pending commitment; an offer copy and a confirmation copy are queued in Counterline (local commit only)', d => ({commitment: d.commitments.at(-1).commitment_id, outbox: d.outbox.map(o => [o.kind, o.status])}), '.offer.accepted');
    // Mail keeps its own virtual clock (its registry starts on 2026-11-15); bring it to Counterline's time first.
    const mailInfra = new Client('mail', 'infra', RUN, stateDir, 'mail-evidence-clock', {registry: MAIL_REGISTRY}); await mailInfra.initialize();
    const now = (await snap()).snapshot.virtual_now, ms = await mailInfra.call('env.snapshot');
    assert.equal((await mailInfra.call('env.advance_time', {expected_version: ms.version, request_id: 'mail-clock', virtual_now: now})).status, 'committed');
    await mailInfra.close();
    const delivered = await publisher.deliver({infra, router});
    const inbox = async () => (await mail.call('mail.search', {})).messages;
    const mailPage = await context.newPage(); mailPage.on('pageerror', e => errors.push(e.message));
    await mailPage.goto(mailHost.accessUrl); await mailPage.getByText('Statement credit confirmed').first().waitFor();
    await step('in-mail', 'Infra delivers the queued copies through Messaging (as a runner would); open the Mail page', 'Both copies are in Mail\'s inbox; Counterline records each Messaging receipt; a copy has no business confirmation',
      async d => ({receipts: delivered.map(x => x.receipt.status), counterline_outbox: d.outbox.map(o => [o.kind, o.status]), mail_subjects: (await inbox()).filter(m => /Larchmont/.test(m.subject)).map(m => m.subject)}), null, mailPage);
    await mailPage.close();

    assert.equal(errors.length, 0, 'no JavaScript errors: ' + errors.join('; '));
    await context.close();
    const report = {schema: 'counterline.gui-sequences.v1', captured_at: new Date().toISOString(), node: process.version, browser: browser.version(),
      viewport: '1280x860', time_zone: 'America/New_York', host: 'runtime/web/server.cjs', mail_version: require(path.join(root, 'examples/apps/mail/package.json')).version, registry: 'apps/counterline/registry.json', profile: 'sandbox', javascript_errors: errors.length, sequences};
    fs.writeFileSync(path.join(OUT, 'sequences.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally {
    for (const c of [router, mail, agent, infra]) if (c) await c.close();
    for (const h of [mailHost, host]) if (h) await h.close();
    await browser.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}
if (require.main === module) main().then(r => { for (const s of r.sequences) console.log(`${s.id}: ${s.steps.length} steps`); console.log(`PASS: ${r.sequences.length} sequences captured.`); })
  .catch(e => { console.error(e); process.exit(1); });
module.exports = {main};
