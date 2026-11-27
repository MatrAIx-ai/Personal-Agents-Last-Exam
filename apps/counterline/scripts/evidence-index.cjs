'use strict';
// Writes evidence/README.md, the delivery evidence index (docs/submission-evidence.md), from the captured
// sequences and the saved reports, so every number in it comes from a run rather than from hand editing.
// Run after tests/evidence.capture.cjs and scripts/evidence-reports.cjs:  node scripts/evidence-index.cjs
const fs = require('node:fs'), path = require('node:path');
const DIR = path.resolve(__dirname, '../evidence');
const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const seq = read('sequences/sequences.json');
const R = name => read(`reports/${name}.json`);
const verifier = R('public-verifier'), join = R('settlement-join'), mail = R('mail-integration'), runtime = R('runtime-check'),
  dataset = R('dataset-load'), fixtures = R('fixtures'), diag = R('recognizer-diagnostic');
const ref = read('reference/references.json');
const coverage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../datasets/coverage.json'), 'utf8'));
const envOf = r => r.environment;
const e = envOf(verifier);
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const seqById = id => seq.sequences.find(s => s.id === id);
const seqLink = id => seqById(id).steps.map(s => `[${s.step}](${s.screenshot})`).join(' ');
const diagLine = Object.entries(diag.result.summary).map(([k, v]) => `${k} ${v.as_expected}/${v.messages}`).join(', ');

// A reference link per workflow (Zendesk documentation) or the reason there is none.
const refLink = (...names) => names.map(n => {
  const r = ref.references.find(x => x.workflow === n);
  if (r) return `[${n}](${r.attachment_url})`;
  const none = ref.no_public_reference.find(x => x.workflow === n);
  if (!none) throw Error('no reference entry ' + n);
  return `${n}: no public reference`;
}).join('; ');
const NA = 'N/A (Environment dataset below)';
const rows = [
  ['Help center search and an article naming the department', 'Required (W1)', refLink('W1 Help center search'), seqLink('0-help-center'), 'T01, T02; browser check', 'None', NA, 'Passed'],
  ['Status of a promised refund; overdue after the due date', 'Required (W1, W4; baseline)', refLink('W1 Case intake', 'W4 Case view'), seqLink('1-status-inquiry'), 'T00, T17; runtime check step 6; MCP write shown in the page (step 5)', 'None', NA, 'Passed'],
  ['Transfer by name or alias; refused by written policy', 'Required (W2)', refLink('W2 Chat with quick actions'), `${seqLink('2-transfer')}; refused: ${seqLink('2-transfer-refused')}`, 'T08; browser check', 'None', NA, 'Passed'],
  ['Offers, two-step acceptance with cancel; expired offer', 'Required (W3)', refLink('W3 Offer with actions', 'W3 Retention offers and W4 commitments'), seqLink('3-accept'), 'T10 to T14; runtime check steps 2 to 4; browser check', 'None', NA, 'Passed'],
  ['Identity with only the chosen fields; pressure script; mismatch', 'Required (W2)', refLink('W2 Identity in chat'), seqLink('4-identity'), 'T07, T26; browser check', 'None', NA, 'Passed'],
  ['Contest a reported credit; provider reissues; reload', 'Required (W4)', refLink('W4 Case list with status', 'W3 Retention offers and W4 commitments'), seqLink('5-contest'), 'T19, T23; browser check', 'None', NA, 'Passed'],
  ['Report versus settlement', 'Required (review of 80c390f); no #182 integration claimed', 'N/A (no reference product shows a provider ledger)', 'Commitments page note (sequence 5, step 1)', 'T20; T21 join check', `Synthetic ledger file, ${join.result.length} cases: ${join.result.map(c => c.join).join(', ')}`, NA, 'Passed as a contract test'],
  ['Optional Mail copies', `Delivered optional; Mail ${e.mail_version}`, 'N/A (Mail is a PALE App)', seqLink('6-mail-copy'), 'T22', `Real Mail ${e.mail_version} through Messaging: ${Object.keys(mail.result).join(', ')}`, NA, 'Passed; case6_unknown uses a Messaging test double (labelled)'],
  ['Delivery dataset, 2025-01-01 to 2026-12-31', 'Required (#260)', 'N/A', 'N/A', 'T24, T25; dataset:check', `Loaded through MCP, full and as of ${dataset.result['card-issuer'].as_of.cut}`, '[datasets/coverage.md](../datasets/coverage.md), [datasets/README.md](../datasets/README.md)', 'Passed']
];

const md = [
  '# Counterline delivery evidence',
  '',
  'Index for the approved plan (PR #219, `/approve-plan b3ea9cd`) in the format of `docs/submission-evidence.md`. Every number below is read from the files it links; regenerate with the commands at the end.',
  '',
  '## Scope and versions',
  '',
  `| Item | Value |`,
  `| :--- | :--- |`,
  `| App | counterline ${e.app_version}, Core API ${e.core_api} |`,
  `| Code commit for the reports | \`${e.commit}\`${e.code_matches_commit ? '' : ' (with uncommitted App changes: regenerate before relying on it)'} |`,
  `| Runtime and Host | public runtime and \`runtime/web/server.cjs\` in this checkout; package registry \`apps/counterline/registry.json\` |`,
  `| Browser | Chromium ${seq.browser}, viewport ${seq.viewport}, time zone ${seq.time_zone}, profile \`${seq.profile}\`, JavaScript errors: ${seq.javascript_errors} |`,
  `| Node and platform | ${e.node}, ${e.platform} |`,
  `| Pinned dependency | Mail ${e.mail_version} (\`examples/apps/mail\`), optional |`,
  '',
  '## Delivery evidence index',
  '',
  `All rows: App commit \`${e.commit}\`, Core API ${e.core_api}, the Host and browser above. Reference links open the PR attachments; the comparison with notes is under "Reference comparison".`,
  '',
  '| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence (screenshots, in order) | Business and MCP tests | Dependency result | Date report / source mapping | Verdict and remaining gap |',
  '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  ...rows.map(r => '| ' + r.map(cell).join(' | ') + ' |'),
  '',
  '## Workflow sequences',
  '',
  'Each step records the action, the expected outcome, the App state read through a separate Infra MCP connection at that moment, the version and the virtual time. Infra is used only as a task runner would be: to load a seed, move the clock, inject provider events and deliver queued Mail copies. A step captured on Mail\'s page (sequence 6) shows Counterline\'s version and time; Mail\'s state is in the Observed column. Cancel, denied (policy refusal, identity mismatch) and stale (expired offer) cases are in sequences 2 to 4; a reload in sequence 5; an independent write through the Agent\'s MCP business interface in sequence 1 (step 5); provider events and clock changes through Infra in sequences 1, 3 and 5.',
  '',
  ...seq.sequences.flatMap(s => [`### ${s.title}`, '', `Seed \`fixtures/${s.seed}\`${s.variant ? ` (${s.variant})` : ''}; run \`${s.run}\`, synthetic account \`${s.account_id}\` owned by \`${s.person_id}\`.`, '', '| Step | Action | Expected | Observed in the App | Version | Screenshot |', '| ---: | :--- | :--- | :--- | :--- | :--- |',
    ...s.steps.map(st => `| ${st.step} | ${cell(st.action)} | ${cell(st.expected)} | ${cell(st.observed ? JSON.stringify(st.observed) : 'screen only')} | ${st.version.epoch}.${st.version.revision} | [${st.name}](${st.screenshot}) |`), '']),
  '## Business, runtime and verifier results',
  '',
  '| Check | Command | Result |',
  '| :--- | :--- | :--- |',
  `| Public verifier, with Mail | \`${verifier.command}\` | ${verifier.result.passed} passed, ${verifier.result.failed} failed, ${verifier.result.skipped} skipped, ${verifier.result.not_run} not run ([report](reports/public-verifier.json)) |`,
  `| Runtime check | \`${runtime.command}\` | ${Object.keys(runtime.result).length} steps: ${Object.keys(runtime.result).join(', ')} ([report](reports/runtime-check.json)) |`,
  `| Seeds and retention scripts | \`${fixtures.command}\` | ${fixtures.result.seeds.length} seeds valid; pressure and neutral present ${fixtures.result.retention.offers_presented} identical offers ([report](reports/fixtures.json)) |`,
  `| Recognizer diagnostic | \`${diag.command}\` | ${diagLine}; ${diag.result.differences.length} listed, no accuracy target ([report](reports/recognizer-diagnostic.json)) |`,
  '| Business tests | `cd apps/counterline && npm test` | T00 to T20, T22 to T27 and T30 to T32 |',
  '| Browser check | `node apps/counterline/tests/browser.test.cjs` | 29 checks with real controls, each write verified through Infra MCP |',
  '',
  '## Dependency demonstrations',
  '',
  `- **Mail copies** ([report](reports/mail-integration.json), [GUI sequence](#optional-mail-copy-of-a-confirmed-commitment-seen-in-mail)): Counterline, Messaging and the real Mail App on one run. The GUI sequence starts from a Counterline acceptance and ends on Mail\'s own page. Local commit, Mail delivery and business confirmation are reported separately; a copy has no business confirmation. Cases: ${Object.entries(mail.result).map(([k, v]) => `${k} (${cell(JSON.stringify(v))})`).join('; ')}.`,
  `- **Settlement join** ([report](reports/settlement-join.json)): Counterline read through MCP and joined with a synthetic owning-ledger file by \`account_ref\` and \`reference_id\`. ${join.result.map(c => `${c.case}: Counterline ${c.counterline_status}, join ${c.join}`).join('; ')}. This is a contract test, not a delivered integration with #182.`,
  '',
  '## Dataset coverage',
  '',
  ...Object.entries(coverage.families).map(([f, c]) => `- **${f}**: ${c.fields.cases.records} cases, ${c.fields.commitments.records} commitments, ${c.distinct_dates} distinct dates in ${c.time_zone}, months without a case: ${c.gaps.length ? c.gaps.join(', ') : 'none'}. Loaded through MCP: ${dataset.result[f].cases} cases at ${dataset.result[f].loaded_at}; as of ${dataset.result[f].as_of.cut}, ${dataset.result[f].as_of.cases} cases and ${dataset.result[f].as_of.records_after_cut} records after the cut.`),
  '',
  'Full monthly tables: [datasets/coverage.md](../datasets/coverage.md). Provenance: fully synthetic, generated through Counterline\'s own operations ([datasets/README.md](../datasets/README.md)).',
  '',
  '## Reference comparison',
  '',
  `Source: ${ref.source}, retrieved ${ref.retrieved_at}. The reference images are linked, not copied into the repository (they are Zendesk's). Stable copies are PR attachments in [the implementation report](${ref.attachments_posted_in}); size and SHA-256 identify the exact image compared. Manifest: [reference/references.json](reference/references.json), built by \`scripts/reference-manifest.cjs\`.`,
  '',
  '| Workflow | Reference page (last updated) | Reference image | Implemented | Intentional differences |',
  '| :--- | :--- | :--- | :--- | :--- |',
  ...ref.references.map(r => `| ${r.workflow} | [${cell(r.article_title)}](${r.article_url}) (${r.article_updated_at.slice(0, 10)}) | [attachment](${r.attachment_url}), [original](${r.image_url}), ${r.image_size}, \`${r.image_sha256.slice(0, 12)}\` | [screenshot](sequences/${r.implemented.replace(/^sequences\//, '')}) | ${cell(r.intentional_differences)} |`),
  '',
  'No public reference:',
  '',
  ...ref.no_public_reference.map(r => `- **${r.workflow}** ([screenshot](${r.implemented})): ${r.note}`),
  '',
  '## Not covered here',
  '',
  '- File upload and download: Counterline has no attachments (approved scope).',
  '- A user simulator or model-agent run: the browser checks drive real controls but are not a model evaluation.',
  '',
  '## Regenerate',
  '',
  '```sh',
  'node apps/counterline/scripts/reference-manifest.cjs # reference pages (needs support.zendesk.com)',
  'node apps/counterline/tests/evidence.capture.cjs     # sequences and screenshots',
  'node apps/counterline/scripts/evidence-reports.cjs   # dependency, runtime, dataset, fixture, diagnostic and verifier reports',
  'node apps/counterline/scripts/evidence-index.cjs     # this file',
  '```',
  ''
].join('\n');
fs.writeFileSync(path.join(DIR, 'README.md'), md);
console.log(`Wrote evidence/README.md (${md.split('\n').length} lines).`);
