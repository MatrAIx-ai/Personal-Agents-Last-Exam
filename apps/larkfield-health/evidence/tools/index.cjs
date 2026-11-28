'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { runtimeDigest, hostRevision } = require('./digest.cjs');

const appDir = path.resolve(__dirname, '..', '..');
const root = path.resolve(appDir, '..', '..');
const EV = path.join(appDir, 'evidence');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const CONTRACT = 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/6933c430942c64f94874083815829e4a4b20920a/docs/submission-evidence.md';
const GUI_REQUEST = 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/111#issuecomment-7123353250';
const stepLink = (s, st) => '[' + s.id.slice(0, 2) + '.' + st.step + ' ' + cell(st.title) + '](gui/' + st.screenshot + ')';
const vstr = v => v.epoch + '.' + v.revision;
function supplied(seqs) {
  const injected = [], relayed = [], altered = [];
  for (const s of seqs) for (const st of s.steps) for (const c of st.mcp_calls) {
    const what = stepLink(s, st) + ', `' + c.tool.replace(/^larkfield-health\./, '') + '`';
    if (c.injected) injected.push(what + ': the page was shown ' + (c.result && c.result.status ? '`' + c.result.status + '`' : 'a reply') + (c.result && c.result.version ? ' at version ' + vstr(c.result.version) : '') + ', while the App, which never received the call, ended the step at ' + st.version);
    if (c.relayed) relayed.push(what);
    if (c.altered) altered.push(what);
  }
  const parts = ['**Replies supplied by the test.** ' + (injected.length ? 'Injected (built by the test with Playwright `route.fulfill`; the call never reached the Web Host, so nothing in the reply was committed, and the step does not count as submitting): ' + injected.join('; ') + '.' : 'No reply was injected.')];
  if (relayed.length) parts.push('Relayed (the Web Host\'s own reply, fetched by the test and passed on unchanged): ' + relayed.join('; ') + '.');
  if (altered.length) parts.push('Altered (the Web Host\'s reply, changed by the test): ' + altered.join('; ') + '.');
  return parts.join(' ') + ' Each is labelled in [gui/sequences.json](gui/sequences.json) (`injected`, `relayed`, `altered`) and in [gui/README.md](gui/README.md).';
}
const PROPOSAL_REV = 'c0f566a3c5be418cd0c971d58e4144cb8085d25a';
const PROPOSAL = 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/' + PROPOSAL_REV + '/proposals/environment/larkfield-health.md';
const cell = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const n = x => x.toLocaleString('en-US');

const ROWS = [
  { workflow: 'Household and grants', scope: 'Approved workflow W1', reference: 'Household and grants', seqs: ['w1-grants', 'w5-visibility'], tests: 'T15–T17 (business tests); MCP checks', dependency: 'Notices go only to people who may see the member; checked in the Mail integration run' },
  { workflow: 'Claims with lines', scope: 'Approved workflow W2', reference: 'Claims with lines', seqs: ['claims-lines'], partial: [{ seq: 'w0-page', what: 'every section and its explanations', titles: ['Open the page', 'What a first-time user needs explained'] }], tests: 'T01, T02, T05, T21 (business tests); MCP checks', dependency: 'Explanation-of-benefits and claim-denied notices delivered to Mail' },
  { workflow: 'Information requests and EOB versions', scope: 'Approved workflows W2 and W4', reference: 'Information requests and EOB versions', seqs: ['w2-claims-info', 'w9-two-questions', 'eob-versions'], tests: 'T03, T04, T09, T17 (business tests); MCP checks', dependency: 'Information-requested and explanation-of-benefits notices delivered to Mail' },
  { workflow: 'Attestations (other coverage, accident)', scope: 'Approved workflow W2', reference: 'Attestations (other coverage, accident)', seqs: ['w7-coverage'], partial: [{ seq: 'w2-claims-info', what: 'accident answers', titles: ['Preview an answer', 'Approve one of two questions', 'Confirm the approved answer'] }], tests: 'T03, T04, T17 (business tests); MCP checks', dependency: 'Information-requested notices delivered to Mail' },
  { workflow: 'Prior authorizations with expedite', scope: 'Approved workflow W3', reference: 'Prior authorizations with expedite', seqs: ['w3-pa'], tests: 'T05–T08 (business tests); MCP checks', dependency: 'PA-decision and decision-overdue notices delivered to Mail' },
  { workflow: 'Appeals with statement and withdraw', scope: 'Approved workflow W4', reference: 'Appeals with statement and withdraw', seqs: ['w4-appeals'], tests: 'T09–T14, T17 (business tests); MCP checks', dependency: 'Appeal-received, appeal-information, appeal-decision and window-closing notices delivered to Mail' },
  { workflow: 'Plan accumulators', scope: 'Approved workflow W2', reference: 'Plan accumulators', seqs: ['plan-accumulators'], tests: 'T02, T21 (business tests); MCP checks', dependency: 'None' }
];

const DIFFERENCES = {
  'Household and grants': 'The reference product handles access by a released-information form or a power of attorney filed by the member. Larkfield gives, changes and removes view or act access to a member\'s records from Household, each change previewed and confirmed by the grantor through an approval Infra applies; access granted to the account holder arrives as an Infra event.',
  'Claims with lines': 'The sample statement prints one line per service with billed, allowed, paid and owed amounts. Larkfield shows the same per-line outcome on the claim from the current explanation of benefits, with plain-word reasons for amounts not allowed.',
  'Information requests and EOB versions': 'The reference articles describe further review and letters asking for documentation; no public page shows a request or a revised statement. Larkfield shows each open question on its claim line with an answer form, and lists every explanation-of-benefits version, the older ones marked as replaced.',
  'Attestations (other coverage, accident)': 'The reference claim form asks about other insurance and accidents on paper. Larkfield asks the same two questions on the claim or the plan year, answered through a preview and an approval; one other-coverage answer covers the member\'s open questions for that year.',
  'Prior authorizations with expedite': 'The reference article says the doctor sends the request and a provider may ask for a faster review. Larkfield shows each PA with its status and decision due date, and lets the account holder ask once for expedited review while the plan has not decided.',
  'Appeals with statement and withdraw': 'The reference products take appeals on a form within 180 days. Larkfield files an appeal on a denied claim or PA from the page through a preview and an approval, adds statements while it is open and withdraws it with a confirmation; nothing on the public pages covers withdrawal.',
  'Plan accumulators': 'The sample statement shows deductible and out-of-pocket progress for the plan year. Larkfield\'s Plan & costs shows each visible member\'s deductible and out-of-pocket amounts per plan year, and family totals only when every enrolled member is visible.'
};

const HELD = { no_mail_account: 'for a recipient without a Mail account (Riley, a minor)', access_changed: 'whose recipient lost access to the member before the sender ran' };
function heldText(held) {
  const by = {};
  for (const h of held) (by[h.reason] = by[h.reason] || []).push(h);
  return Object.entries(by).map(([reason, list]) => list.length + ' ' + (list.length === 1 ? 'entry' : 'entries') + ' ' + (HELD[reason] || 'held') + ', held in Larkfield\'s log as `' + reason + '` (' + [...new Set(list.map(h => h.recipient_id))].join(', ') + ')').join(' and ');
}

function readingNote(seqs) {
  const all = seqs.flatMap(s => s.steps.map(st => ({ s, st }))), with_ = all.filter(x => x.st.observed.summary);
  if (with_.length === all.length) return ' together with the step\'s own reading of the App';
  if (with_.length && with_.every(x => x.s.evidence_only)) return ' (the ' + with_.length + ' steps of the evidence-only sequences also record their own reading of the App)';
  return with_.length ? ' (' + with_.length + ' of the ' + all.length + ' steps also record their own reading of the App)' : '';
}

function stepLinks(seq) {
  return seq.steps.map(s => '[' + s.step + ' ' + cell(s.title) + '](gui/' + s.screenshot + ')').join(' → ');
}

function main() {
  const run = read(path.join(EV, 'gui/run.json'));
  const seqs = read(path.join(EV, 'gui/sequences.json')).sequences;
  const mail = read(path.join(EV, 'mail/demo.json'));
  const refs = read(path.join(EV, 'reference/references.json'));
  const cov = read(path.join(appDir, 'dataset/COVERAGE.json'));
  const app = read(path.join(appDir, 'app.json'));
  const digest = runtimeDigest(appDir), host = hostRevision(root);
  const byId = id => seqs.find(s => s.id.replace(/^\d+-/, '') === id);
  const checksOf = list => list.reduce((a, s) => a + s.steps.reduce((b, st) => b + st.acceptance_checks.length, 0), 0);
  const refFiles = name => { const w = refs.workflows.find(x => x.workflow === name); return w ? w.files.map(f => '[' + f.slice(0, 2) + '](reference/' + f + ')').join(' ') : 'N/A'; };
  const refOf = name => refs.workflows.find(x => x.workflow === name) || { status: 'N/A', gap: '' };
  const steps = seqs.reduce((a, s) => a + s.steps.length, 0);
  const kinds = [...new Set(mail.gui.stages.local_commit.notices.map(x => x.kind))].sort();
  const load = cov.loading && cov.loading.instants ? cov.loading.instants : [];
  const stated = (cov.gaps || []).filter(g => g.status && /stated gap/.test(g.status));
  const L = [];
  L.push('# Larkfield delivery evidence', '',
    'Delivery evidence index for Larkfield Health Plan ' + app.version + ' in the format of the submission evidence contract, [`docs/submission-evidence.md` at `6933c43`](' + CONTRACT + '). It is delivery work added to the approved scope of the environment proposal ([`proposals/environment/larkfield-health.md` at `' + PROPOSAL_REV.slice(0, 7) + '`](' + PROPOSAL + '), PR #64); the scope itself is unchanged. The approved proposal planned no GUI; the business GUI on the shared Web Host is an addition made at the platform reviewer\'s request to every Environment ([comment on PR #111](' + GUI_REQUEST + ')), and its business behaviour is the approved one. Every screenshot, sequence and receipt below was produced by the scripts in [tools/](tools/) from a fresh run; nothing is edited by hand.', '',
    '## Scope and versions', '', '| Item | Value |', '| --- | --- |',
    '| App | `apps/larkfield-health` ' + app.version + ', Core API ' + run.core_api_version + '. **App load digest** `' + digest.sha256 + '`: the verifier\'s tree digest (SHA-256 over each file\'s package-relative path, a NUL byte and its bytes, in path order) applied to the ' + digest.files + ' files Core and the Host load: ' + digest.includes.map(x => '`' + x + '`').join(', ') + '. It leaves out ' + digest.excludes.map(x => '`' + x.name + '` (' + x.why + ')').join(', ') + ', so it does not change when this evidence is regenerated |',
    '| Host | public runtime ' + host.runtime_version + ' in this repository, runtime tree digest `' + host.runtime_tree_sha256 + '` (same algorithm over `runtime/`); business GUI on the shared Web Host `runtime/web/server.cjs` with `apps.registry.json`; SHA-256 of the Host, client, stylesheet, Router and registry files in [gui/run.json](gui/run.json) |',
    '| Browser | ' + run.browser + ' through the repository\'s pinned Playwright ' + run.playwright + '; viewports ' + run.viewport.desktop.replace('x', ' × ') + ' and 390 × 844; locale ' + run.browser_locale + '; software rasterization on one thread. Time zone of each capture: the GUI sequences run with the browser in ' + run.browser_timezone + ' while the account\'s zone is America/New_York, so the page must show the account\'s times; the Mail demonstration (' + mail.gui.browser + ') runs in ' + mail.gui.browser_timezone + '; the reference screenshots were taken with locale ' + refs.locale + ' in America/New_York |',
    '| Runs and account | runs ' + run.runs.map(r => '`' + r + '`').join(' and ') + ' (GUI sequences), `' + mail.gui.run + '` and `' + mail.refusal.run + '` (Mail), profile `sandbox`, synthetic account `' + run.account.app_account + '` held by the synthetic person `' + run.account.owner_person + '` (Jordan Hale), seed `' + run.account.seed_id + '`, starting Wednesday 18 November 2026, 12:00 in New York |',
    '| Dependency | Mail ' + mail.participants.mail.version + ' (`examples/apps/mail`), optional receiver of Larkfield\'s notices through the Messaging Router; package SHA-256 `' + mail.participants.mail.package_sha256 + '` |',
    '| Node | ' + run.node + ' for the captures; the validation report lists the Node versions of the package\'s tests |',
    '| Captured | GUI ' + run.captured_on + ', Mail ' + mail.captured_on + ', references ' + [...new Set(refs.references.map(e => e.captured_at.slice(0, 10)))].join(', ') + '. These are capture dates: `gui.cjs` and `mail.cjs` record the date they ran, or the date given with `--captured-on YYYY-MM-DD`, so a regeneration on another day can reproduce these files byte for byte; `reference.cjs` keeps an entry\'s `captured_at` while its bytes are unchanged |', '',
    '## Delivery evidence index', '',
    'Business tests are `tests/business.test.cjs` (App-only); `npm test` runs them with the fixture checks (`tests/t31-fixture-checks.test.cjs`) and the delivery dataset tests (`tests/t32-dataset.test.cjs`); MCP is `tests/mcp.integration.cjs` (`npm run mcp`); Mail is `tests/mail.integration.cjs` (`npm run mail`); the browser acceptance is `tests/web.browser.cjs`. GUI sequences: [gui/README.md](gui/README.md), with the expected and observed state, the MCP calls of each step with their arguments and results (all writes, previews, Agent, Infra and forced calls and every refused or failed read; reads answered with status `ok` are owned but not listed, and replies the test supplied are labelled), the version, the virtual time and the checks of `tests/web.browser.cjs` each step passed. Reference screenshots: [reference/](reference/) with [reference/references.json](reference/references.json) (source URL, the page it is linked from, capture time, region, redactions, size read from the saved PNG, SHA-256, and the pinned pdf.js files). Every reference is a public page or document of the reference product opened without signing in; the member portal itself is behind sign-in, so the comparison status of each workflow says how close the public reference comes, and reviewer agreement is pending for all of them.', '',
    '| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of ROWS) {
    const list = r.seqs.map(byId).filter(Boolean);
    const parts = (r.partial || []).map(x => { const q = byId(x.seq); const st = x.titles.map(t => q.steps.find(y => y.title === t)); assert.ok(st.every(Boolean), 'A step named in the index is missing from ' + x.seq); return { ...q, what: x.what, steps: st }; });
    const stepsHere = list.concat(parts).reduce((a, s) => a + s.steps.length, 0);
    const ref = refOf(r.reference);
    L.push('| ' + r.workflow + ' | ' + r.scope + '; GUI added at the platform reviewer\'s request | ' + refFiles(r.reference) + ' | ' + list.map(s => '**' + s.title + '**' + (s.evidence_only ? ' (evidence script only)' : '') + ': ' + stepLinks(s)).concat(parts.map(s => '**' + s.title + '** (' + s.what + '): ' + stepLinks(s))).join('<br>') + ' | ' + r.tests + '; browser checks in these sequences: ' + checksOf(list.concat(parts)) + ' | ' + r.dependency + ' | N/A (no Task history) | Implementation passed (' + stepsHere + (stepsHere === 1 ? ' step' : ' steps') + '). **Reference: ' + cell(ref.status) + '.** ' + cell(ref.gap) + ' |');
  }
  const reloads = [], independent = [], infra = [];
  for (const s of seqs) for (const st of s.steps) {
    const link = stepLink(s, st);
    if (/reload/i.test(st.action + st.title)) reloads.push(link);
    if (st.mcp_calls.some(c => /Host/.test(c.client) && c.kind === 'write' && c.result && c.result.status === 'committed')) independent.push(link);
    if (st.mcp_calls.some(c => c.kind === 'event' || c.kind === 'clock')) infra.push(link);
  }
  const platform = byId('w8-platform'), restricted = byId('restricted'), resets = byId('w6-resets'), page = byId('w0-page');
  L.push('| Shared state, reload and independent updates | Required (GUI) | N/A | Each step reads the persisted state and version through a separate Infra MCP client ([gui/sequences.json](gui/sequences.json)). Reloads: ' + (reloads.join(', ') || 'none') + '. Committed writes made outside the page between page reads (sent by the test through the Web Host\'s own business client, the page\'s MCP session called in-process, standing in for a change made elsewhere; not a second session): ' + (independent.join(', ') || 'none') + '. Infra events, confirmations and clock moves followed by Refresh: ' + infra.length + ' steps, for example ' + infra.slice(0, 4).join(', ') + '. **' + resets.title + '**: ' + stepLinks(resets) + ' | MCP checks; browser checks | None | N/A | Passed |');
  L.push('| Business-only access and layout | Required (GUI) | N/A | **' + page.title + '**: ' + stepLinks(page) + '<br>**' + platform.title + '**: ' + stepLinks(platform) + '<br>**' + restricted.title + '** (second fresh run): ' + stepLinks(restricted) + ' | browser checks: ' + checksOf([page, platform, restricted]) + ' (403 for management and dropped tools from the page session, policies without `appeals.add_statement`, `claims.info.confirm` and `plan.get`, 390 px) | None | N/A | Passed |');
  const g = mail.gui, f = mail.refusal;
  L.push('| Optional Mail notifications | Delivered optional connection; Larkfield ' + app.version + ' → Mail ' + mail.participants.mail.version + ' through the Messaging Router (runtime ' + mail.participants.runtime.version + '), one Router session per recipient Mail account | N/A (Mail is a PALE App) | ' + g.steps.map(s => '[' + s.step + ' ' + cell(s.app) + '](mail/' + s.screenshot + ')').join(' → ') + ' | `tests/mail.integration.cjs` (' + mail.integration.checks.length + ' checks) | [mail/README.md](mail/README.md): all ' + kinds.length + ' notice kinds (' + kinds.map(k => k.replace('notice.', '')).join(', ') + ') as ' + g.stages.receiver_commit.receipts.length + ' deliveries with request IDs, Router receipts, Mail record IDs, Mail\'s own event receipts and the text read back; ' + heldText(g.stages.receiver_commit.held) + '; duplicate retry; a refusal before dispatch (`' + f.refused.map(x => x.code).join(', ') + '`) with both Apps\' state compared before and after; local commit, receiver commit and business confirmation (not claimed) kept apart | N/A | Passed; business confirmation not claimed |');
  L.push('| Environment dataset coverage | Required: delivery dataset `' + cov.dataset_id + '`, window ' + cov.window.from + ' to ' + cov.window.to + ' inclusive, counted in ' + cov.time_zone + ' | N/A | ' + (load.length ? 'Loading and query: as-of selections at ' + load.length + ' instants loaded through real Core over MCP (' + load.map(i => i.as_of).join(', ') + ')' : 'See the coverage report') + ' | `tests/t32-dataset.test.cjs` (in `npm test`); from `apps/larkfield-health`: `node dataset/generate.cjs --check`, `node dataset/coverage.cjs --check --runtime ../../runtime` | Sources `dataset/base.json`, `dataset/replay.json`, `dataset/full.json`; provenance in `contribution/dataset.json`; hashes in [COVERAGE.md](../dataset/COVERAGE.md) | [dataset/COVERAGE.md](../dataset/COVERAGE.md): ' + n(cov.totals.counted) + ' dated entries on **' + cov.distinct_dates.coverage + '** distinct dates | ' + (stated.length ? 'Passed except ' + stated.map(x => x.kind === 'real_data_anchor' ? 'the real-data anchor (N/A, ' + x.status.replace(/^stated gap, /, '') + ')' : x.kind === 'mail_history' ? 'Mail history for the notices (not included, Mail being optional; ' + x.status + ')' : x.kind === 'unused_authorizations' ? 'authorizations approved and never used (' + (x.pa_ids || []).join(', ') + '; ' + x.status + ')' : x.kind.replace(/_/g, ' ') + ' (' + x.status + ')').reduce((a, t, i, l) => a + (i === 0 ? '' : i === l.length - 1 ? ' and ' : ', ') + t, '') : 'Passed') + ' |');
  const tools = read(path.join(appDir, 'tools.json')).map(x => x.name);
  const textStep = seqs.flatMap(s => s.steps.filter(st => st.acceptance_checks.some(c => /shown as text, never run/.test(c))).map(st => ({ s, st })));
  assert.ok(textStep.length, 'No step checks that untrusted text is shown as text');
  L.push('| Files and content | Where supported (GUI checklist) | N/A | Files: **N/A**, Larkfield stores and serves no files: none of its ' + tools.length + ' tools takes or returns file bytes, and the approved proposal has no uploads, downloads or attachments. Untrusted text: ' + textStep.map(x => stepLink(x.s, x.st)).join(', ') + ', where an expedite reason holding an HTML image tag with an `onerror` handler is committed and, after Refresh, shown as text and never run | browser check “' + textStep[0].st.acceptance_checks.find(c => /shown as text, never run/.test(c)) + '” | None | N/A | Files N/A (not in the approved scope); untrusted text passed |');
  L.push('| Task history depth | Not applicable to an Environment App | N/A | N/A | N/A | N/A | N/A | N/A: Tasks report their own selected history |', '');

  L.push('## Reference comparison', '',
    'The reference product\'s member portal is behind sign-in, so every reference is a public page or document of the reference product: member resource pages, health insurance articles, two consumer news articles, the start pages of its member forms and the member PDFs those pages link to, opened without signing in on ' + refs.references[0].captured_at.slice(0, 10) + '. References 04 and 05 are labelled "' + Object.keys(refs.labels)[0] + '". PDF pages are rendered with ' + refs.pdf_renderer.library + ', whose two files are checked against pinned SHA-256 values before use (' + refs.pdf_renderer.files.map(x => '`' + x.file + '` `' + x.sha256 + '`').join(', ') + '). Placeholders on the sample statement are covered by grey boxes; the regions show no real member data. The screenshots are review evidence only: the App copies no branding, text or images from them.', '',
    '| Workflow | Reference (public page or document) | Implemented | Comparison status | Intentional differences |', '| --- | --- | --- | --- | --- |');
  for (const w of refs.workflows) {
    const r = ROWS.find(x => x.reference === w.workflow);
    const anchor = s => '[' + s.title + '](gui/README.md#' + s.title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-') + ')';
    const impl = r ? r.seqs.map(byId).filter(Boolean).map(anchor).concat((r.partial || []).map(x => { const q = byId(x.seq); return anchor(q) + ' (' + x.what + ': ' + x.titles.map(t => { const st = q.steps.find(y => y.title === t); return '[step ' + st.step + '](gui/' + st.screenshot + ')'; }).join(', ') + ')'; })).join(', ') : 'N/A';
    L.push('| ' + w.workflow + ' | ' + w.files.map(file => { const e = refs.references.find(x => x.file === file); return '[' + file.slice(0, 2) + ' ' + cell(e.article_title) + '](reference/' + file + ') ([source](' + e.source_url + ')' + (e.label ? ', ' + e.label : '') + ')'; }).join('; ') + ' | ' + impl + ' | ' + cell(w.status) + '. ' + cell(w.gap) + ' | ' + cell(DIFFERENCES[w.workflow] || '') + ' |');
  }
  L.push('', '## Workflow sequences, state and tests', '',
    '[gui/README.md](gui/README.md) lists ' + seqs.length + ' sequences, ' + steps + ' steps, on two runs (the second loads policies that drop tools). The steps are those of `tests/web.browser.cjs`, run unchanged inside the recorder ([tools/recorder.cjs](tools/recorder.cjs)), plus ' + seqs.filter(s => s.evidence_only).length + ' evidence-only sequences for the read-only claim, explanation-of-benefits and plan views; ' + run.checks_passed + ' checks passed (' + (run.checks_passed - run.evidence_only_checks) + ' of them the browser acceptance\'s own): ' + (run.checks_passed - run.run_level_checks.length) + ' are listed with their steps and ' + run.run_level_checks.length + ' are run-level checks of `tests/web/harness.cjs` over each whole run, listed in [gui/README.md](gui/README.md#run-level-checks) and `run.json` (`run_level_checks`). For every step the table records the action, the expected result, the element the step checks (outlined in orange in the screenshot), every record that changed since the previous step, read through a separate Infra MCP client from the frozen state' + readingNote(seqs) + ', the MCP calls the recorder lists for the step, the version, the virtual time and the checks passed. The recorder rules: every call, in every tab of the browser context, is owned by the step open when it is sent; a step is frozen before anything is taken from it and stops the script if the version moved between its check and its freeze; each call has exactly one terminal outcome; a failure stops the script unless the test induced it (a drop the step declared beforehand, or a request a route of the test aborted, listed with its cause and `reached_host`); a forced call carries a token bound to its exact tool and arguments; and recorder errors are append-only. Before capturing, `gui.cjs` runs the ' + run.recorder_probes.length + ' recorder probes in [tools/probes.cjs](tools/probes.cjs), each on a fresh page.', '',
    supplied(seqs), '',
    'The browser acceptance `tests/web.browser.cjs` remains the full GUI test; App-only business tests and real MCP tests are separate. Browser automation demonstrates controls and state; it is not a model-agent evaluation.', '',
    '## Not covered', '',
    '- No public reference shows the signed-in member portal; every comparison awaits reviewer agreement.',
    '- Provider, plan reviewer and claims-office screens are not part of the approved scope; their actions are Infra events.',
    '- Business confirmation of a Mail notice is not claimed.', '',
    '## Regenerate', '', 'From the repository root, after `npm ci` and `npx playwright install chromium`:', '', '```sh',
    'node apps/larkfield-health/evidence/tools/regenerate.cjs   # gui/, mail/ and this index, then the App load digest; add --captured-on YYYY-MM-DD to keep a recorded capture date',
    'node apps/larkfield-health/evidence/tools/reference.cjs    # reference/ (needs the reference product\'s public pages and cdnjs)',
    '```', '',
    '`regenerate.cjs` runs `tools/gui.cjs` (which first runs the recorder probes), `tools/mail.cjs` (which also runs `tests/mail.integration.cjs`), `tools/index.cjs` and `tools/digest.cjs` in that order and stops at the first failure. `gui.cjs`, `mail.cjs` and `reference.cjs` write their captures to a temporary folder and replace the committed files only after the whole run has passed. The capture tools launch Chromium with software rasterization on one thread (`--disable-gpu --num-raster-threads=1 --disable-partial-raster`), take screenshots with animations disabled and replace the page\'s random request IDs with a counter, so two consecutive runs of `gui.cjs` and of `mail.cjs` on the same machine gave byte-identical files; on another machine or Chromium build, anti-aliased edges can differ by a few pixels. The reference screenshots depend on the reference product\'s pages and documents still answering as they did: `reference.cjs` refuses a capture whose rendering mode, scale or size differs from the committed manifest and replaces nothing unless run with `--update`, keeps an entry\'s `captured_at` while its bytes are unchanged, and `node apps/larkfield-health/evidence/tools/reference.cjs --self-check` exercises these rules offline with stubbed captures of the committed files.', '');
  fs.writeFileSync(path.join(EV, 'README.md'), L.join('\n'));
  console.log('index: ' + ROWS.length + ' workflow rows, ' + seqs.length + ' sequences, ' + steps + ' steps');
}

main();
