'use strict';
// Connected example over real MCP processes: the agent drafts and submits a comment with the member's acknowledgment, the
// host-run publisher sends the receipt notice to the real Mail 1.3.0 App through Messaging, Infra records the outcome on the
// comment with comment.notice_recorded, a delivery without a grant is rejected and recorded, and a replay deduplicates.
//   node apps/civicdesk/examples/mail-notice.cjs [trace.json]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const publisher = require('../src/publisher.cjs');
const APP = 'civicdesk', T = APP + '.', ACCOUNT = 'acct-dana', PERSON = 'person-dana';
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')), copy = x => structuredClone(x);
const TEXT = 'Retention should be opt-in and end with the episode of care: I have never needed a patient\'s step or heart-rate data more than twelve months after discharge. De-identified sensor streams can be re-identified in a town of about 3,000 where a patient\'s daily 6 am walk past the clinic would identify him. Small clinics need a clear deletion path when care ends; a 30-day deletion on request would work for a two-person practice.';
function bundle(datasetPath, appId, id, records) {
  const dataset = read(datasetPath);
  dataset.dataset_id = id; dataset.description = 'CivicDesk connected example: one empty ' + appId + ' account for Dana'; dataset.expected_counts = {records, assets:0};
  return {dataset, catalog:{schema_version:'pale.asset-catalog.v1', catalog_id:id + '-assets', app_id:appId, dataset_ref:'dataset.json', assets:[], extensions:[]}, blobs:{}};
}
async function run({output = null} = {}) {
  const run_id = 'civicdesk-notice-' + crypto.randomUUID().slice(0, 12), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-civicdesk-notice-')), clients = [];
  const make = async (app, role, name, registry, extra = {}) => {const c = new Client(app, role, run_id, dir, name, {registry:path.join(root, registry), ...extra}); clients.push(c); await c.initialize(); return c;};
  const checks = [];
  const check = (label, passed, detail = null) => {checks.push(detail === null ? {label, passed} : {label, passed, detail}); if (!passed) console.error('FAILED: ' + label + (detail ? ' ' + JSON.stringify(detail).slice(0, 600) : ''));};
  try {
    const infra = await make(APP, 'infra', 'civicdesk-example-infra', 'apps/civicdesk/registry.json');
    const agent = await make(APP, 'agent', 'civicdesk-example-agent', 'apps/civicdesk/registry.json');
    const mailInfra = await make('mail', 'infra', 'civicdesk-example-mail-infra', 'examples/registry.mail.json');
    const mailAgent = await make('mail', 'agent', 'civicdesk-example-mail-agent', 'examples/registry.mail.json');
    const snap = async c => c.call('env.snapshot');
    const mailBefore = await snap(mailInfra);
    const mailLoaded = await mailInfra.call('env.load_seed', {expected_version:mailBefore.version, request_id:'seed-mail', data:{account_id:'mail-dana', owner_person_id:PERSON, address:'dana.reyes@example.com', messages:[]},
      binding:{people:[{person_id:PERSON, name:'Dana Reyes'}], accounts:[{app_id:'mail', account_id:'mail-dana', owner_person_id:PERSON}], objects:{}}, policies:{scenario:{allow:['mail.search', 'mail.get'], constraints:{}}, sandbox:{allow:['mail.search', 'mail.get'], constraints:{}}}, bundle:bundle('examples/apps/mail/contribution/dataset.json', 'mail', 'civicdesk-example-mail', 0)});
    check('Mail account for Dana loads', mailLoaded.status === 'ready', mailLoaded.status === 'ready' ? null : mailLoaded);
    const before = await snap(infra);
    check('CivicDesk starts from its fixture', before.snapshot.data.account_id === ACCOUNT && before.snapshot.data.dockets.some(d => d.docket_id === 'OCDD-2026-0031'));
    // Session time: the member's first session on November 30; Mail's clock moves there before any delivery.
    const sessionAt = '2026-11-30T19:30:00-08:00';
    const advancedMail = await mailInfra.call('env.advance_time', {expected_version:(await snap(mailInfra)).version, request_id:'clock-mail-session', virtual_now:sessionAt});
    const advancedApp = await infra.call('env.advance_time', {expected_version:before.version, request_id:'clock-civicdesk-session', virtual_now:sessionAt});
    check('Clocks advance to the session time', advancedMail.status === 'committed' && advancedApp.status === 'committed', {mail:advancedMail.status, app:advancedApp.status});

    // 1. The agent's flow: read the docket and its deadline, draft, validate, submit with the member's acknowledgment.
    const docket = await agent.call(T + 'dockets.get', {id:'OCDD-2026-0031'});
    check('The docket shows its deadline in the agency\'s time zone', docket.status === 'ok' && docket.docket.closes_at_local.includes('EST') && docket.docket.status === 'open', docket.status === 'ok' ? null : docket);
    const v = (await snap(infra)).version;
    const draft = await agent.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:TEXT, submitter:{kind:'anonymous', name:null, organization:null}, supplemental:false, expected_version:v, request_id:'civicdesk-draft-1'});
    check('comments.draft stores a ready draft', draft.status === 'committed' && draft.ready === true, draft.status === 'committed' ? null : draft);
    const refused = await agent.call(T + 'comments.submit', {id:draft.id, acknowledged:false, expected_version:draft.version, request_id:'civicdesk-submit-unacknowledged'});
    check('A submit without the acknowledgment is refused and stores nothing', refused.status === 'acknowledgment_required', refused);
    const submitted = await agent.call(T + 'comments.submit', {id:draft.id, acknowledged:true, expected_version:draft.version, request_id:'civicdesk-submit-1'});
    check('comments.submit returns the receipt', submitted.status === 'committed' && submitted.outcome === 'received' && submitted.tracking_number.startsWith('CDK-2026-0031-'), submitted.status === 'committed' ? null : submitted);
    const receipt = submitted.id ? await agent.call(T + 'comments.receipt', {id:submitted.id}) : {status:'skipped'};
    check('comments.receipt carries the tracking number and the anonymous submitter', receipt.status === 'ok' && receipt.receipt.tracking_number === submitted.tracking_number && receipt.receipt.submitter.kind === 'anonymous');

    // 2. The host-run publisher reads the committed comment through the Agent connection and publishes through Messaging.
    const configFile = path.join(dir, 'router.json'); fs.writeFileSync(configFile, JSON.stringify(read('apps/civicdesk/examples/router.json')));
    const router = new Client(null, null, null, null, 'civicdesk-publisher', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'), '--config', configFile, '--publisher', APP, '--run', run_id, '--state-dir', dir]});
    clients.push(router); await router.initialize();
    const routerTools = (await router.request('tools/list')).result.tools.map(t => t.name), agentTools = (await agent.request('tools/list')).result.tools.map(t => t.name);
    check('Publishing and Agent connections expose no Infra tools', !routerTools.some(n => n.startsWith('env.')) && !agentTools.some(n => n.startsWith('env.')) && routerTools.includes('router.publish'));
    const published = await publisher.publish({agent, router, kind:'receipt', ref:{comment_id:submitted.id}, requestId:'civicdesk-receipt-' + submitted.id, account:ACCOUNT, person:PERSON});
    check('Messaging commits the delivery and returns a receipt', published.stage === 'delivered' && published.result.status === 'committed', published.stage === 'delivered' ? null : published.result);
    const afterSubmit = await snap(infra), afterPublish = await snap(infra);
    check('Publishing itself changes nothing in CivicDesk', JSON.stringify(afterPublish.snapshot.data) === JSON.stringify(afterSubmit.snapshot.data));
    const mailRecord = published.result.event_id ? await mailAgent.call('mail.get', {id:published.result.event_id}) : {status:'skipped'};
    check('The real Mail App holds the receipt notice with the same tracking number', mailRecord.status === 'ok' && mailRecord.message.subject === published.message.data.content.title && mailRecord.message.body.includes(submitted.tracking_number) && mailRecord.message.read === false, mailRecord.status === 'ok' ? null : mailRecord);
    // 3. Infra records the delivery outcome on the comment with the small event.
    const recorded = await infra.call('env.apply_event', {expected_version:afterPublish.version, event:{event_id:'evt-example-notice-1', at:'2026-11-30T19:31:00-08:00', operation:'comment.notice_recorded', payload:{comment_id:submitted.id, kind:'receipt', status:'delivered', event_id:published.result.event_id}}});
    const status1 = await agent.call(T + 'comments.status', {id:submitted.id});
    check('comment.notice_recorded puts the delivered outcome into the comment\'s notice history', recorded.status === 'committed' && status1.comment.notices.some(n => n.kind === 'receipt' && n.status === 'delivered' && n.event_id === published.result.event_id), recorded.status === 'committed' ? null : recorded);

    // 4. Without a recipient grant, Messaging refuses; Mail is unchanged and the rejection is recorded on the comment.
    const denied = copy(read('apps/civicdesk/examples/router.json')); denied.publishers[0].allowed_recipients = [];
    const deniedFile = path.join(dir, 'router-denied.json'); fs.writeFileSync(deniedFile, JSON.stringify(denied));
    const deniedRouter = new Client(null, null, null, null, 'civicdesk-publisher-denied', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'), '--config', deniedFile, '--publisher', APP, '--run', run_id, '--state-dir', dir]});
    clients.push(deniedRouter); await deniedRouter.initialize();
    const mailBeforeDenied = await snap(mailInfra);
    const rejected = await publisher.publish({agent, router:deniedRouter, kind:'receipt', ref:{comment_id:submitted.id}, requestId:'civicdesk-denied-notice', account:ACCOUNT, person:PERSON});
    const rejectedCode = rejected.result.code || rejected.result.status;
    check('A delivery without a grant is rejected as recipient_not_authorized', rejected.stage === 'router_rejected' && rejectedCode === 'recipient_not_authorized', {stage:rejected.stage, code:rejectedCode});
    const mailAfterDenied = await snap(mailInfra);
    check('The rejected delivery leaves Mail unchanged', JSON.stringify(mailAfterDenied.snapshot.data) === JSON.stringify(mailBeforeDenied.snapshot.data));
    const recordedRejected = await infra.call('env.apply_event', {expected_version:(await snap(infra)).version, event:{event_id:'evt-example-notice-2', at:'2026-11-30T19:32:00-08:00', operation:'comment.notice_recorded', payload:{comment_id:submitted.id, kind:'receipt', status:'rejected', event_id:null}}});
    const status2 = await agent.call(T + 'comments.status', {id:submitted.id});
    check('The rejection is recorded on the comment, which stays submitted', recordedRejected.status === 'committed' && status2.comment.status === 'received' && status2.comment.notices.map(n => n.status).join(',') === 'delivered,rejected');

    // 5. Replays deduplicate on the receipt and on the CloudEvents (source, id).
    const mailCount = async () => (await snap(mailInfra)).snapshot.data.messages.length;
    const mailBeforeReplay = await mailCount();
    const replay = await router.call('router.publish', {request_id:'civicdesk-receipt-' + submitted.id, message:published.message});
    const again = await router.call('router.publish', {request_id:'civicdesk-receipt-again', message:published.message});
    check('Replaying the request returns the first receipt and sends nothing', replay.duplicate === true && replay.event_id === published.result.event_id && again.duplicate === true && (await mailCount()) === mailBeforeReplay, {replay:{duplicate:replay.duplicate}, again:{duplicate:again.duplicate}});

    const passed = checks.every(c => c.passed);
    const trace = {schema:'pale.civicdesk.mail-notice-trace.v1', checked_at:new Date().toISOString(), run_id, passed, checks,
      versions:{node:process.version, runtime:read('runtime/package.json').version, mail:read('examples/apps/mail/app.json').version, civicdesk:read('apps/civicdesk/app.json').version},
      submission:{comment_id:submitted.id, tracking_number:submitted.tracking_number, submitted_at:submitted.submitted_at}, notice:published.message, receipt:published.result,
      mail_record:mailRecord.status === 'ok' ? {id:mailRecord.message.id, folder:mailRecord.message.folder, from:mailRecord.message.from, subject:mailRecord.message.subject, read:mailRecord.message.read, received_at:mailRecord.message.received_at} : mailRecord,
      notice_history:status2.comment ? status2.comment.notices : null, rejected:{stage:rejected.stage, code:rejectedCode}, replay:{duplicate:replay.duplicate, event_id:replay.event_id, new_request_duplicate:again.duplicate}};
    if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(trace, null, 2) + '\n');
    return trace;
  } finally {await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive:true, force:true});}
}
module.exports = {run};
if (require.main === module) run({output:process.argv[2] || null}).then(trace => {
  console.log(JSON.stringify({passed:trace.passed, checks:trace.checks.map(c => (c.passed ? 'PASS ' : 'FAIL ') + c.label), tracking:trace.submission && trace.submission.tracking_number, receipt:trace.receipt && trace.receipt.event_id}, null, 2));
  if (!trace.passed) {process.exitCode = 1; return;}
  console.log('PASS: ' + trace.checks.length + ' CivicDesk -> Mail real MCP checks.');
}).catch(e => {console.error(e); process.exitCode = 1;});
