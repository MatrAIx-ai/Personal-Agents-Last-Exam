'use strict';
// Connected example over real MCP processes: Infra applies a studio cancellation to Cadence, the host-run publisher sends
// the notice to the real Mail 1.3.0 App through Messaging, the agent cancels the Calendar entry with calendar.cancel, books
// a replacement with reservations.confirm and creates its Calendar entry with calendar.create; a delivery without a grant
// is rejected and leaves Mail and Cadence unchanged; a replay of the same request deduplicates. Writes a trace when given a path:
//   node apps/cadence/examples/mail-notice.cjs [trace.json]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const publisher = require('../src/publisher.cjs');
const APP = 'cadence', T = APP + '.', ACCOUNT = 'acct-amara', PERSON = 'person-amara';
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')), copy = x => structuredClone(x);

function bundle(datasetPath, appId, id, records) {
  const dataset = read(datasetPath);
  dataset.dataset_id = id; dataset.description = 'Cadence connected example: one ' + appId + ' account for Amara'; dataset.expected_counts = {records, assets:0};
  return {dataset, catalog:{schema_version:'pale.asset-catalog.v1', catalog_id:id + '-assets', app_id:appId, dataset_ref:'dataset.json', assets:[], extensions:[]}, blobs:{}};
}
const binding = (appId, accountId) => ({people:[{person_id:PERSON, name:'Amara Bello'}], accounts:[{app_id:appId, account_id:accountId, owner_person_id:PERSON}], objects:{}});
const policy = allow => ({scenario:{allow, constraints:{}}, sandbox:{allow, constraints:{}}});

async function run({output = null} = {}) {
  const run_id = 'cadence-notice-' + crypto.randomUUID().slice(0, 12), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-cadence-notice-')), clients = [];
  const make = async (app, role, name, registry, extra = {}) => {const c = new Client(app, role, run_id, dir, name, {registry:path.join(root, registry), ...extra}); clients.push(c); await c.initialize(); return c;};
  const checks = [];
  const check = (label, passed, detail = null) => {checks.push(detail === null ? {label, passed} : {label, passed, detail}); if (!passed) console.error('FAILED: ' + label + (detail ? ' ' + JSON.stringify(detail).slice(0, 600) : ''));};
  try {
    const cadenceInfra = await make(APP, 'infra', 'cadence-example-infra', 'apps/cadence/registry.json');
    const cadenceAgent = await make(APP, 'agent', 'cadence-example-agent', 'apps/cadence/registry.json');
    const mailInfra = await make('mail', 'infra', 'cadence-example-mail-infra', 'examples/registry.mail.json');
    const mailAgent = await make('mail', 'agent', 'cadence-example-mail-agent', 'examples/registry.mail.json');
    const calInfra = await make('calendar', 'infra', 'cadence-example-calendar-infra', 'examples/registry.calendar.json');
    const calAgent = await make('calendar', 'agent', 'cadence-example-calendar-agent', 'examples/registry.calendar.json');
    const snap = async c => c.call('env.snapshot');
    const mailBefore = await snap(mailInfra);
    const mailLoaded = await mailInfra.call('env.load_seed', {expected_version:mailBefore.version, request_id:'seed-mail', data:{account_id:'mail-amara', owner_person_id:PERSON, address:'amara.bello@example.com', messages:[]},
      binding:binding('mail', 'mail-amara'), policies:policy(['mail.search', 'mail.get']), bundle:bundle('examples/apps/mail/contribution/dataset.json', 'mail', 'cadence-example-mail', 0)});
    check('Mail account for Amara loads', mailLoaded.status === 'ready', mailLoaded.status === 'ready' ? null : mailLoaded);
    // Her calendar already holds the Thursday class the agent copied there earlier.
    const thursday = {id:'cal-strength60', uid:'cadence-rsv-2041@pale.example', account_id:'calendar-amara', calendar_id:'cal-personal', title:'Strength 60 at Granite Barbell', start:'2026-12-10T17:30:00-05:00', end:'2026-12-10T18:30:00-05:00', timezone:'America/New_York',
      organizer_person_id:PERSON, attendees:[PERSON], location:'Granite Barbell, 9 Quarry Lane', status:'confirmed', sequence:0, attachments:[]};
    const calBefore = await snap(calInfra);
    const calLoaded = await calInfra.call('env.load_seed', {expected_version:calBefore.version, request_id:'seed-calendar', data:{account_id:'calendar-amara', owner_person_id:PERSON, calendar_id:'cal-personal', timezone:'America/New_York', events:[thursday]},
      binding:binding('calendar', 'calendar-amara'), policies:policy(['calendar.list', 'calendar.get', 'calendar.freebusy', 'calendar.create', 'calendar.update', 'calendar.cancel']), bundle:bundle('examples/apps/calendar/contribution/dataset.json', 'calendar', 'cadence-example-calendar', 1)});
    check('Calendar for Amara loads with the Thursday entry', calLoaded.status === 'ready', calLoaded.status === 'ready' ? null : calLoaded);
    const cadenceBefore = await snap(cadenceInfra);
    check('Cadence starts from its fixture', cadenceBefore.snapshot.data.account_id === ACCOUNT && cadenceBefore.snapshot.data.reservations.some(r => r.reservation_id === 'rsv-2041' && r.status === 'booked'));

    // 1. The studio cancels Thursday's Strength 60 (Infra event); Mail and Calendar clocks move to the session time first.
    const event = {event_id:'evt-example-1001', at:'2026-12-08T11:05:00-05:00', operation:'classes.cancelled_by_studio', payload:{class_instance_id:'ci-7731', reason:'instructor_unavailable'}};
    for (const [infra, label] of [[mailInfra, 'Mail'], [calInfra, 'Calendar']]) {
      const before = await snap(infra), advanced = await infra.call('env.advance_time', {expected_version:before.version, request_id:'clock-' + label.toLowerCase() + '-2026-12-08', virtual_now:event.at});
      check(label + ' clock advances to the session time', advanced.status === 'committed' && advanced.virtual_now === event.at, advanced);
    }
    const applied = await cadenceInfra.call('env.apply_event', {expected_version:cadenceBefore.version, event});
    check('classes.cancelled_by_studio commits', applied.status === 'committed', applied.status === 'committed' ? null : applied);
    const afterEvent = await snap(cadenceInfra);
    check('rsv-2041 is cancelled by the studio with nothing charged', afterEvent.snapshot.data.reservations.some(r => r.reservation_id === 'rsv-2041' && r.status === 'cancelled_by_studio' && r.credits_charged === 0));

    // 2. The host-run publisher reads the committed reservation over the Agent connection and publishes through Messaging.
    const configFile = path.join(dir, 'router.json'); fs.writeFileSync(configFile, JSON.stringify(read('apps/cadence/examples/router.json')));
    const router = new Client(null, null, null, null, 'cadence-publisher', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'), '--config', configFile, '--publisher', APP, '--run', run_id, '--state-dir', dir]});
    clients.push(router); await router.initialize();
    const routerTools = (await router.request('tools/list')).result.tools.map(t => t.name), agentTools = (await cadenceAgent.request('tools/list')).result.tools.map(t => t.name);
    check('Publishing and Agent connections expose no Infra tools', !routerTools.some(n => n.startsWith('env.')) && !agentTools.some(n => n.startsWith('env.')) && routerTools.includes('router.publish'));
    const published = await publisher.publish({agent:cadenceAgent, router, kind:'cancelled_by_studio', ref:{reservation_id:'rsv-2041'}, requestId:'cadence-rsv-2041-cancelled', account:ACCOUNT, person:PERSON});
    check('Messaging commits the delivery and returns a receipt', published.stage === 'delivered' && published.result.status === 'committed', published.stage === 'delivered' ? null : published.result);
    const afterPublish = await snap(cadenceInfra);
    check('Publishing changes nothing in Cadence (no notice status is stored)', JSON.stringify(afterPublish.snapshot.data) === JSON.stringify(afterEvent.snapshot.data) && JSON.stringify(afterPublish.version) === JSON.stringify(afterEvent.version));
    const mailRecord = published.result.event_id ? await mailAgent.call('mail.get', {id:published.result.event_id}) : {status:'skipped'};
    check('The real Mail App holds the cancellation notice unread with the published title and text', mailRecord.status === 'ok' && mailRecord.message.subject === published.message.data.content.title && mailRecord.message.body === published.message.data.content.body.text && mailRecord.message.read === false, mailRecord.status === 'ok' ? null : mailRecord);
    check('The notice matches the proposal\'s example (title, reservation, included)', published.message.id === 'cadence-notice-cancelled-by-studio-rsv-2041' && published.message.data.content.title.startsWith('Cancelled by the studio: Strength 60 at Granite Barbell') && published.message.data.content.body.text.includes('included in your plan'));
    const mailCount = async () => (await snap(mailInfra)).snapshot.data.messages.length;

    // 3. The agent's own flow: cancel the Calendar entry, book a replacement, copy it to Calendar.
    const listed = await calAgent.call('calendar.list', {start:'2026-12-10T00:00:00-05:00', end:'2026-12-11T00:00:00-05:00'});
    const calVersion = (await snap(calInfra)).version;
    const cancelled = await calAgent.call('calendar.cancel', {id:'cal-strength60', expected_version:calVersion, request_id:'calendar-cancel-strength60'});
    check('calendar.cancel removes the Thursday entry', listed.status === 'ok' && cancelled.status === 'committed', cancelled.status === 'committed' ? null : cancelled);
    const search = await cadenceAgent.call(T + 'classes.search', {date:'2026-12-11', time_of_day:'evening', included_only:true});
    const pick = search.classes.find(x => x.id === 'ci-7752') || search.classes[0];
    const preview = await cadenceAgent.call(T + 'reservations.preview', {class_instance_id:pick.id, expected_version:afterPublish.version, request_id:'cadence-preview-replacement'});
    check('reservations.preview prepares an included replacement', preview.status === 'committed' && preview.price.kind === 'included', preview.status === 'committed' ? null : preview);
    const booked = preview.id ? await cadenceAgent.call(T + 'reservations.confirm', {id:preview.id, expected_version:preview.version, request_id:'cadence-confirm-replacement'}) : {status:'skipped'};
    check('reservations.confirm books the replacement at no cost', booked.status === 'committed' && booked.outcome === 'booked' && booked.credits_charged === 0, booked.status === 'committed' ? null : booked);
    const detail = booked.id ? await cadenceAgent.call(T + 'reservations.get', {id:booked.id}) : {status:'skipped'};
    const calVersion2 = (await snap(calInfra)).version;
    const created = detail.status === 'ok' ? await calAgent.call('calendar.create', {title:detail.reservation.class.title + ' at ' + detail.reservation.class.studio_name, start:detail.reservation.class.start, end:detail.reservation.class.end, timezone:'America/New_York', location:detail.reservation.class.studio_name, expected_version:calVersion2, request_id:'calendar-create-replacement'}) : {status:'skipped'};
    check('calendar.create records the replacement with the reservation\'s own times', created.status === 'committed' && !!created.id, created.status === 'committed' ? null : created);
    const calAfter = (await snap(calInfra)).snapshot.data.events;
    check('Calendar state: Thursday cancelled, replacement confirmed', calAfter.some(e => e.id === 'cal-strength60' && e.status === 'cancelled') && calAfter.some(e => e.title.startsWith(detail.reservation.class.title) && e.status === 'confirmed'));

    // 4. Without a recipient grant, Messaging refuses the booking confirmation and nothing changes on either side.
    const denied = copy(read('apps/cadence/examples/router.json')); denied.publishers[0].allowed_recipients = [];
    const deniedFile = path.join(dir, 'router-denied.json'); fs.writeFileSync(deniedFile, JSON.stringify(denied));
    const deniedRouter = new Client(null, null, null, null, 'cadence-publisher-denied', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'), '--config', deniedFile, '--publisher', APP, '--run', run_id, '--state-dir', dir]});
    clients.push(deniedRouter); await deniedRouter.initialize();
    const mailBeforeDenied = await snap(mailInfra), cadenceBeforeDenied = await snap(cadenceInfra);
    const rejected = await publisher.publish({agent:cadenceAgent, router:deniedRouter, kind:'booking_confirmed', ref:{reservation_id:booked.id}, requestId:'cadence-denied-notice', account:ACCOUNT, person:PERSON});
    const rejectedCode = rejected.result.code || rejected.result.status;
    check('A delivery without a grant is rejected as recipient_not_authorized', rejected.stage === 'router_rejected' && rejectedCode === 'recipient_not_authorized', {stage:rejected.stage, code:rejectedCode});
    const mailAfterDenied = await snap(mailInfra), cadenceAfterDenied = await snap(cadenceInfra);
    check('The rejected delivery leaves Mail and Cadence unchanged', JSON.stringify(mailAfterDenied.snapshot.data) === JSON.stringify(mailBeforeDenied.snapshot.data) && JSON.stringify(cadenceAfterDenied.snapshot.data) === JSON.stringify(cadenceBeforeDenied.snapshot.data));

    // 5. Replays deduplicate on the receipt and on the CloudEvents (source, id).
    const mailBeforeReplay = await mailCount();
    const replay = await router.call('router.publish', {request_id:'cadence-rsv-2041-cancelled', message:published.message});
    const again = await router.call('router.publish', {request_id:'cadence-rsv-2041-cancelled-again', message:published.message});
    check('Replaying the request returns the first receipt and sends nothing', replay.duplicate === true && replay.event_id === published.result.event_id && again.duplicate === true && (await mailCount()) === mailBeforeReplay, {replay:{duplicate:replay.duplicate, event_id:replay.event_id}, again:{duplicate:again.duplicate}});

    const passed = checks.every(c => c.passed);
    const trace = {schema:'pale.cadence.mail-notice-trace.v1', checked_at:new Date().toISOString(), run_id, passed, checks,
      versions:{node:process.version, runtime:read('runtime/package.json').version, mail:read('examples/apps/mail/app.json').version, calendar:read('examples/apps/calendar/app.json').version, cadence:read('apps/cadence/app.json').version},
      event, notice:published.message, receipt:published.result,
      mail_record:mailRecord.status === 'ok' ? {id:mailRecord.message.id, folder:mailRecord.message.folder, from:mailRecord.message.from, subject:mailRecord.message.subject, read:mailRecord.message.read, received_at:mailRecord.message.received_at} : mailRecord,
      agent_flow:{calendar_cancelled:'cal-strength60', replacement:booked.id ? {reservation_id:booked.id, class_instance_id:booked.class_instance_id, price:booked.price} : null, calendar_created:created.id || null},
      rejected:{stage:rejected.stage, code:rejectedCode, kind:rejected.kind}, replay:{duplicate:replay.duplicate, event_id:replay.event_id, new_request_duplicate:again.duplicate}};
    if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(trace, null, 2) + '\n');
    return trace;
  } finally {await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive:true, force:true});}
}
module.exports = {run};
if (require.main === module) run({output:process.argv[2] || null}).then(trace => {
  console.log(JSON.stringify({passed:trace.passed, checks:trace.checks.map(c => (c.passed ? 'PASS ' : 'FAIL ') + c.label), receipt:trace.receipt && trace.receipt.event_id, agent_flow:trace.agent_flow}, null, 2));
  if (!trace.passed) {process.exitCode = 1; return;}
  console.log('PASS: ' + trace.checks.length + ' Cadence -> Mail / Calendar real MCP checks.');
}).catch(e => {console.error(e); process.exitCode = 1;});
