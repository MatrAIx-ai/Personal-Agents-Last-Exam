'use strict';
// Connected example over real MCP processes: Infra applies a statement_ready event to the portal, the host-run
// publisher sends the notice to the real Mail 1.3.0 App through Messaging, the agent moves the statement bytes into
// Files and onto a Mail draft (one SHA-256 end to end), a delivery without a grant is rejected and leaves Mail and
// the portal unchanged, and a replay of the same request deduplicates. Writes a trace when given an output path:
//   node apps/northlake-portal/examples/mail-notice.cjs [trace.json]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const publisher = require('../src/publisher.cjs');
const APP = 'northlake-portal', T = APP + '.', ACCOUNT = 'acct-rosa', PERSON = 'person-rosa';
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')), copy = x => structuredClone(x);
const sha = b64 => crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');

function bundle(datasetPath, appId, id, records) {
  const dataset = read(datasetPath);
  dataset.dataset_id = id; dataset.description = 'Northlake connected example: one empty ' + appId + ' account for Rosa'; dataset.expected_counts = {records, assets:0};
  return {dataset, catalog:{schema_version:'pale.asset-catalog.v1', catalog_id:id + '-assets', app_id:appId, dataset_ref:'dataset.json', assets:[], extensions:[]}, blobs:{}};
}
const binding = (appId, accountId) => ({people:[{person_id:PERSON, name:'Rosa Delgado'}], accounts:[{app_id:appId, account_id:accountId, owner_person_id:PERSON}], objects:{}});
const policy = allow => ({scenario:{allow, constraints:{}}, sandbox:{allow, constraints:{}}});

async function run({output = null} = {}) {
  const run_id = 'northlake-notice-' + crypto.randomUUID().slice(0, 12), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-northlake-notice-')), clients = [];
  const make = async (app, role, name, registry, extra = {}) => {const c = new Client(app, role, run_id, dir, name, {registry:path.join(root, registry), ...extra}); clients.push(c); await c.initialize(); return c;};
  const checks = [];
  const check = (label, passed, detail = null) => {checks.push(detail === null ? {label, passed} : {label, passed, detail}); if (!passed) console.error('FAILED: ' + label + (detail ? ' ' + JSON.stringify(detail) : ''));};
  try {
    // 1. Three App instances in one run: the portal from its own fixture, Mail and Files from empty seeds bound to the same person.
    const portalInfra = await make(APP, 'infra', 'northlake-example-infra', 'apps/northlake-portal/registry.json');
    const portalAgent = await make(APP, 'agent', 'northlake-example-agent', 'apps/northlake-portal/registry.json');
    const mailInfra = await make('mail', 'infra', 'northlake-example-mail-infra', 'examples/registry.mail.json');
    const mailAgent = await make('mail', 'agent', 'northlake-example-mail-agent', 'examples/registry.mail.json');
    const filesInfra = await make('files', 'infra', 'northlake-example-files-infra', 'apps.registry.json');
    const filesAgent = await make('files', 'agent', 'northlake-example-files-agent', 'apps.registry.json');
    const snap = async c => c.call('env.snapshot');
    const mailBefore = await snap(mailInfra);
    const mailLoaded = await mailInfra.call('env.load_seed', {expected_version:mailBefore.version, request_id:'seed-mail', data:{account_id:'mail-rosa', owner_person_id:PERSON, address:'rosa.delgado@example.com', messages:[]},
      binding:binding('mail', 'mail-rosa'), policies:policy(['mail.search', 'mail.get', 'mail.draft.create', 'mail.attachment.add', 'mail.attachment.get']), bundle:bundle('examples/apps/mail/contribution/dataset.json', 'mail', 'northlake-example-mail', 0)});
    check('Mail account for Rosa loads', mailLoaded.status === 'ready', mailLoaded.status === 'ready' ? null : mailLoaded);
    const filesBefore = await snap(filesInfra);
    const filesLoaded = await filesInfra.call('env.load_seed', {expected_version:filesBefore.version, request_id:'seed-files', data:{account_id:'files-rosa', owner_person_id:PERSON, files:[]},
      binding:binding('files', 'files-rosa'), policies:policy(['files.list', 'files.get', 'files.put', 'files.read']), bundle:bundle('apps/files/contribution/dataset.json', 'files', 'northlake-example-files', 0)});
    check('Files account for Rosa loads', filesLoaded.status === 'ready', filesLoaded.status === 'ready' ? null : filesLoaded);
    const portalBefore = await snap(portalInfra);
    check('Portal starts from its fixture', portalBefore.snapshot.data.account_id === ACCOUNT && portalBefore.snapshot.data.statements.length === 11);

    // 2. The billing office's statement run is an event Infra applies; the portal commits the statement record.
    const event = {event_id:'evt-example-stmt-2026-11', at:'2026-12-01T06:00:00-08:00', operation:'portal.billing.statement_ready', payload:{statement_id:'stmt-2026-11', period_start:'2026-11-01', period_end:'2026-11-30', past_due_note:true}};
    const applied = await portalInfra.call('env.apply_event', {expected_version:portalBefore.version, event});
    check('statement_ready event commits', applied.status === 'committed', applied.status === 'committed' ? null : applied);
    const afterEvent = await snap(portalInfra);
    // Infra synchronizes the other Apps' clocks to the session time before deliveries and agent writes happen there.
    for (const [infra, label] of [[mailInfra, 'Mail'], [filesInfra, 'Files']]) {
      const before = await snap(infra), advanced = await infra.call('env.advance_time', {expected_version:before.version, request_id:'clock-' + label.toLowerCase() + '-2026-12-01', virtual_now:event.at});
      check(label + ' clock advances to the session time', advanced.status === 'committed' && advanced.virtual_now === event.at && advanced.advanced === true, advanced);
    }
    const statement = afterEvent.snapshot.data.statements.find(s => s.statement_id === 'stmt-2026-11');
    check('Statement record exists with the period and balance', !!statement && statement.period_start === '2026-11-01' && statement.balance_due_cents > 0);

    // 3. The host-run publisher reads the committed record through the Agent connection and publishes through Messaging.
    const configFile = path.join(dir, 'router.json');
    fs.writeFileSync(configFile, JSON.stringify(read('apps/northlake-portal/examples/router.json')));
    const router = new Client(null, null, null, null, 'northlake-publisher', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'), '--config', configFile, '--publisher', APP, '--run', run_id, '--state-dir', dir]});
    clients.push(router); await router.initialize();
    const routerTools = (await router.request('tools/list')).result.tools.map(t => t.name), agentTools = (await portalAgent.request('tools/list')).result.tools.map(t => t.name);
    check('Publishing and Agent connections expose no Infra tools', !routerTools.some(n => n.startsWith('env.')) && !agentTools.some(n => n.startsWith('env.')) && routerTools.includes('router.publish'));
    const published = await publisher.publish({agent:portalAgent, router, kind:'statement_ready', ref:{statement_id:'stmt-2026-11'}, requestId:'northlake-stmt-2026-11', account:ACCOUNT, person:PERSON});
    check('Messaging commits the delivery and returns a receipt', published.stage === 'delivered' && published.result.status === 'committed', published.stage === 'delivered' ? null : published.result);
    const afterPublish = await snap(portalInfra);
    check('Publishing changes nothing in the portal (no notice status is stored)', JSON.stringify(afterPublish.snapshot.data) === JSON.stringify(afterEvent.snapshot.data) && JSON.stringify(afterPublish.version) === JSON.stringify(afterEvent.version));
    const mailRecord = published.result.event_id ? await mailAgent.call('mail.get', {id:published.result.event_id}) : {status:'skipped'};
    check('The real Mail App holds one unread notice with the published title and text', mailRecord.status === 'ok' && mailRecord.message.subject === published.message.data.content.title && mailRecord.message.body === published.message.data.content.body.text && mailRecord.message.read === false && mailRecord.message.folder === 'inbox', mailRecord.status === 'ok' ? null : mailRecord);
    const mailCount = async () => (await snap(mailInfra)).snapshot.data.messages.length;
    check('Mail has exactly one message', (await mailCount()) === 1);

    // 4. The agent's own flow: statement bytes into Files, then onto a Mail draft. Same SHA-256 in three Apps.
    const stmt = await portalAgent.call(T + 'billing.statement', {id:'stmt-2026-11'});
    check('billing.statement returns a PDF with a SHA-256 that matches its bytes', stmt.status === 'ok' && stmt.file.mime_type === 'application/pdf' && sha(stmt.file.base64) === stmt.file.sha256);
    const filesVersion = (await snap(filesInfra)).version;
    const put = await filesAgent.call('files.put', {file:{filename:stmt.file.filename, mime_type:stmt.file.mime_type, base64:stmt.file.base64, sha256:stmt.file.sha256}, source:'northlake-portal billing.statement stmt-2026-11', expected_version:filesVersion, request_id:'files-put-stmt-2026-11'});
    check('files.put stores the statement as an immutable version', put.status === 'committed' && !!put.id, put.status === 'committed' ? null : put);
    const fileItem = put.id ? await filesAgent.call('files.get', {id:put.id}) : {status:'skipped'};
    const fileBytes = put.id ? await filesAgent.call('files.read', {id:put.id, number:1}) : {status:'skipped'};
    check('Files returns the same bytes and SHA-256', fileBytes.status === 'ok' && fileBytes.file.sha256 === stmt.file.sha256 && fileBytes.file.base64 === stmt.file.base64 && fileItem.item.versions.length === 1);
    const mailVersion1 = (await snap(mailInfra)).version;
    const draft = await mailAgent.call('mail.draft.create', {to:['billing@northlake-health.example'], subject:'Question about my November 2026 statement', body:'Hello, the attached statement still lists the two physical therapy visits that were reprocessed on November 12 as past due. Could you confirm the corrected balance?', expected_version:mailVersion1, request_id:'mail-draft-stmt-2026-11'});
    check('mail.draft.create stores a draft', draft.status === 'committed' && !!draft.id, draft.status === 'committed' ? null : draft);
    const mailVersion2 = (await snap(mailInfra)).version;
    const attached = draft.id ? await mailAgent.call('mail.attachment.add', {id:draft.id, files:[{filename:stmt.file.filename, mime_type:stmt.file.mime_type, base64:stmt.file.base64, sha256:stmt.file.sha256}], expected_version:mailVersion2, request_id:'mail-attach-stmt-2026-11'}) : {status:'skipped'};
    check('mail.attachment.add accepts the PDF', attached.status === 'committed', attached.status === 'committed' ? null : attached);
    const draftRecord = draft.id ? await mailAgent.call('mail.get', {id:draft.id}) : {status:'skipped'};
    const mailFile = draftRecord.status === 'ok' && draftRecord.message.attachments.length ? await mailAgent.call('mail.attachment.get', {id:draft.id, asset_id:draftRecord.message.attachments[0]}) : {status:'skipped'};
    check('The Mail attachment carries the same SHA-256 as the portal response and the Files version', mailFile.status === 'ok' && mailFile.file.sha256 === stmt.file.sha256 && draftRecord.message.folder === 'drafts');

    // 5. Without a recipient grant, Messaging refuses and nothing changes on either side.
    const denied = copy(read('apps/northlake-portal/examples/router.json')); denied.publishers[0].allowed_recipients = [];
    const deniedFile = path.join(dir, 'router-denied.json'); fs.writeFileSync(deniedFile, JSON.stringify(denied));
    const deniedRouter = new Client(null, null, null, null, 'northlake-publisher-denied', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'), '--config', deniedFile, '--publisher', APP, '--run', run_id, '--state-dir', dir]});
    clients.push(deniedRouter); await deniedRouter.initialize();
    const mailBeforeDenied = await snap(mailInfra), portalBeforeDenied = await snap(portalInfra);
    const rejected = await publisher.publish({agent:portalAgent, router:deniedRouter, kind:'new_message', ref:{thread_id:'thr-billing-0928', message_id:'msg-0009'}, requestId:'northlake-denied-notice', account:ACCOUNT, person:PERSON});
    const rejectedCode = rejected.result.code || rejected.result.status;
    check('A delivery without a grant is rejected as recipient_not_authorized', rejected.stage === 'router_rejected' && rejectedCode === 'recipient_not_authorized', {stage:rejected.stage, code:rejectedCode});
    const mailAfterDenied = await snap(mailInfra), portalAfterDenied = await snap(portalInfra);
    check('The rejected delivery leaves Mail and the portal unchanged', JSON.stringify(mailAfterDenied.snapshot.data) === JSON.stringify(mailBeforeDenied.snapshot.data) && JSON.stringify(portalAfterDenied.snapshot.data) === JSON.stringify(portalBeforeDenied.snapshot.data));

    // 6. A replay of the same request deduplicates on the receipt; a repeated notice with a new request ID deduplicates on (source, id).
    const mailBeforeReplay = await mailCount();
    const replay = await router.call('router.publish', {request_id:'northlake-stmt-2026-11', message:published.message});
    const again = await router.call('router.publish', {request_id:'northlake-stmt-2026-11-again', message:published.message});
    check('Replaying the request returns the first receipt and sends nothing', replay.duplicate === true && replay.event_id === published.result.event_id && again.duplicate === true && (await mailCount()) === mailBeforeReplay, {replay:{duplicate:replay.duplicate, event_id:replay.event_id}, again:{duplicate:again.duplicate, event_id:again.event_id}});

    const passed = checks.every(c => c.passed);
    const trace = {schema:'pale.northlake-portal.mail-notice-trace.v1', checked_at:new Date().toISOString(), run_id, passed, checks,
      versions:{node:process.version, runtime:read('runtime/package.json').version, mail:read('examples/apps/mail/app.json').version, files:read('apps/files/app.json').version, 'northlake-portal':read('apps/northlake-portal/app.json').version},
      event, notice:published.message, receipt:published.result,
      mail_record:mailRecord.status === 'ok' ? {id:mailRecord.message.id, folder:mailRecord.message.folder, from:mailRecord.message.from, subject:mailRecord.message.subject, read:mailRecord.message.read, received_at:mailRecord.message.received_at} : mailRecord,
      sha256:{portal_statement:stmt.file && stmt.file.sha256, files_version:fileBytes.file && fileBytes.file.sha256, mail_attachment:mailFile.file && mailFile.file.sha256, files_id:put.id, mail_draft_id:draft.id},
      rejected:{stage:rejected.stage, code:rejectedCode, kind:rejected.kind}, replay:{duplicate:replay.duplicate, event_id:replay.event_id, new_request_duplicate:again.duplicate}};
    if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(trace, null, 2) + '\n');
    return trace;
  } finally {await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive:true, force:true});}
}
module.exports = {run};
if (require.main === module) run({output:process.argv[2] || null}).then(trace => {
  console.log(JSON.stringify({passed:trace.passed, checks:trace.checks.map(c => (c.passed ? 'PASS ' : 'FAIL ') + c.label), receipt:trace.receipt && trace.receipt.event_id, sha256:trace.sha256}, null, 2));
  if (!trace.passed) {process.exitCode = 1; return;}
  console.log('PASS: ' + trace.checks.length + ' Northlake -> Mail / Files real MCP checks.');
}).catch(e => {console.error(e); process.exitCode = 1;});
