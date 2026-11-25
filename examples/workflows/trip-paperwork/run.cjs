'use strict';
// Trip paperwork over real MCP processes and Messaging: Passage signs the I-20 for travel, ConfDesk
// registers the author and issues an invitation letter with the misspelled surname on file, a
// correction is requested and the corrected letter reaches Mail, the visa file is registered on the
// VisaSlot appointment and the appointment is held as complete. ConfDesk and Passage have no
// outbound tool: Infra reads each notice's stored CloudEvent from env.snapshot and publishes it.
// Every delivery is read back from Mail as the receiver.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('../../../runtime/client.cjs');
const {documents, held, sources} = require('./visa-file.cjs');
const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'registry.paperwork.json');
const copy = value => structuredClone(value);
const T = require('./timeline.json');

async function run() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-trip-paperwork-'));
  const clients = [], checks = [], delivered = [];
  let sequence = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks.push(label); };
  const ok = (label, condition) => { assert.ok(condition, label); checks.push(label); };
  async function open(app, role, run = 'paperwork') {
    const client = new Client(app, role, run, state, 'trip-paperwork-workflow', {registry});
    clients.push(client); await client.initialize(); return client;
  }
  async function version(infra) { return (await infra.call('env.snapshot')).version; }
  async function write(agent, infra, name, args) {
    const result = await agent.call(name, {...args, expected_version:await version(infra), request_id:'write-' + (++sequence)});
    assert.equal(result.status, 'committed', JSON.stringify({name, result})); return result;
  }
  async function attempt(agent, infra, name, args) {
    const result = await agent.call(name, {...args, expected_version:await version(infra), request_id:'attempt-' + (++sequence)});
    return result.code || result.status;
  }
  async function event(infra, e) {
    const receipt = await infra.call('env.apply_event', {expected_version:await version(infra), event:e});
    assert.equal(receipt.status, 'committed', JSON.stringify({event:e.event_id, receipt})); return receipt;
  }
  async function sandbox(infra) {
    assert.equal((await infra.call('env.reset', {expected_version:await version(infra), profile:'sandbox'})).status, 'ready');
  }
  // Replace an App's seed; the dataset record count follows the App's own `records` hook.
  const plugins = {confdesk:'apps/confdesk', visaslot:'apps/visaslot', passage:'apps/passage', mail:'examples/apps/mail'};
  async function load(infra, transform, bindingTransform = b => b, {dropAssets = false} = {}) {
    const s = await infra.call('env.snapshot'), data = transform(copy(s.snapshot.data)), bundle = copy(s.snapshot.resources.bundle);
    // Mingyu's mailbox starts empty, so the reference Mail fixture's media goes with Maya's messages.
    if (dropAssets) { bundle.catalog.assets = []; bundle.blobs = {}; bundle.dataset.expected_counts.assets = 0; }
    bundle.dataset.expected_counts.records = require(path.join(root, plugins[s.snapshot.app_id], 'plugin.cjs')).records(data).length;
    const result = await infra.call('env.load_seed', {expected_version:s.version, request_id:'load-' + (++sequence),
      data, binding:bindingTransform(copy(s.snapshot.binding)), policies:copy(s.snapshot.policies), bundle});
    assert.equal(result.status, 'ready', JSON.stringify(result));
    return data;
  }
  async function clock(infras, iso) {
    for (const infra of infras) {
      const result = await infra.call('env.advance_time', {expected_version:await version(infra), virtual_now:iso, request_id:'clock-' + (++sequence)});
      assert.ok(result.status === 'committed' || result.status === 'ok', JSON.stringify(result));
    }
  }
  async function router(config, publisher, run = 'paperwork') {
    const client = new Client(null, null, null, null, 'trip-paperwork-router', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(__dirname, config), '--publisher', publisher, '--run', run, '--state-dir', state]});
    clients.push(client); await client.initialize(); return client;
  }
  const mailSeed = () => ({account_id:'mail-mingyu', owner_person_id:'person-mingyu', address:'mingyu.zhao@example.edu', messages:[]});
  const mailBinding = () => ({people:[{person_id:'person-mingyu', name:'Mingyu Zhao'}],
    accounts:[{app_id:'mail', account_id:'mail-mingyu', owner_person_id:'person-mingyu'}], objects:{}});
  // Passage history before Mingyu asks: the fixture without the pending req-0142 and its notice.
  const passageSeed = data => ({...data, requests:data.requests.filter(r => r.id !== 'req-0142'), notices:data.notices.filter(n => n.id !== 'notice-3')});
  const passageBinding = b => ({...b, objects:{passage:b.objects.passage.filter(id => !['req-0142', 'notice-3'].includes(id))}});

  try {
    const confdesk = await open('confdesk', 'agent'), confdeskInfra = await open('confdesk', 'infra');
    const visaslot = await open('visaslot', 'agent'), visaslotInfra = await open('visaslot', 'infra');
    const passage = await open('passage', 'agent'), passageInfra = await open('passage', 'infra');
    const mail = await open('mail', 'agent'), mailInfra = await open('mail', 'infra');
    const all = [confdeskInfra, visaslotInfra, passageInfra, mailInfra];
    const fixturePassage = (await passageInfra.call('env.snapshot')).snapshot.data;

    // Permissions: the Agent has business tools only. It cannot fire Infra events, move the clock or
    // deliver mail, and no portal gives it an outbound tool.
    const agents = {confdesk, visaslot, passage, mail};
    const names = {};
    for (const [app, agent] of Object.entries(agents)) names[app] = (await agent.request('tools/list')).result.tools.map(t => t.name);
    ok('Agent sees no env.* operation and no publish or outbound tool on any App',
      Object.values(names).flat().every(n => !n.startsWith('env.') && !/outbound|publish/.test(n)));
    const denied = [
      await confdesk.call('env.apply_event', {expected_version:await version(confdeskInfra), event:{event_id:'x', at:T.letter_issued, operation:'confdesk.letter.issue', payload:T.letter}}),
      await visaslot.call('env.apply_event', {expected_version:await version(visaslotInfra), event:held(T)}),
      await passage.call('env.apply_event', {expected_version:await version(passageInfra), event:{event_id:'x', at:T.signature_processed, operation:'passage.request.processed', payload:T.signature}}),
      await mail.call('env.apply_event', {expected_version:await version(mailInfra), event:{event_id:'x', at:T.start, operation:'mail.receive_notification', payload:{}}}),
      await confdesk.call('env.advance_time', {expected_version:await version(confdeskInfra), virtual_now:T.appointment, request_id:'agent-clock'})];
    equal('Agent cannot issue a letter, hold an appointment, process a signature, deliver mail or advance time',
      denied.map(r => r.status), Array(5).fill('permission_denied'));
    equal('Scenario profile cannot confirm a registration', await attempt(confdesk, confdeskInfra, 'confdesk.register.confirm',
      {preview_id:'pv-x', payment_label:T.payment_label}), 'permission_denied');
    equal('Before the window opens a preview is refused', (await confdesk.call('confdesk.register.preview', {paper_id:'paper-214'})).status, 'registration_not_open');

    // History loading and reset: Passage starts before Mingyu asks; Mail starts with an empty mailbox.
    const loaded = await load(passageInfra, passageSeed, passageBinding);
    const mailBefore = await load(mailInfra, mailSeed, mailBinding, {dropAssets:true});
    for (const infra of [confdeskInfra, visaslotInfra, passageInfra]) await sandbox(infra);
    equal('Reset restores the loaded Passage history, not the fixture', (await passageInfra.call('env.snapshot')).snapshot.data, loaded);
    const confdeskBridge = await router('confdesk-mail-config.json', 'confdesk');
    const passageBridge = await router('passage-mail-config.json', 'passage');

    // Infra's delivery step: the notice's CloudEvent is read from the App's own state and published.
    async function notify(app, infra, bridge, kind, objectId) {
      const notice = (await infra.call('env.snapshot')).snapshot.data.notices.find(n => n.kind === kind && n.ref.object_id === objectId);
      const receipt = await bridge.call('router.publish', {request_id:app + '-' + notice.id, message:notice.message});
      delivered.push({app, notice:notice.id, kind, message_id:notice.message.id, event_id:receipt.event_id});
      return {notice, message:notice.message, receipt};
    }
    // Receiver-side evidence: Mail's record under the delivery event ID and Mail's own event receipt.
    async function inMail(label, {message, receipt}) {
      const record = (await mail.call('mail.get', {id:receipt.event_id})).message;
      const mailReceipt = (await mailInfra.call('env.event_status', {event_id:receipt.event_id})).receipt;
      equal(label, [receipt.status, receipt.target, receipt.applied_at, record.thread_id, record.from, record.subject, record.body, record.received_at,
        mailReceipt.status, mailReceipt.trace.cloud_event],
      ['committed', {app_id:'mail', account_id:'mail-mingyu'}, message.time, message.id, message.data.source_object.app_id + '@pale.example',
        message.data.content.title, message.data.content.body.text, message.time, 'committed', {source:message.source, id:message.id, type:message.type, time:message.time}]);
      return record;
    }

    // 1. Book the visa appointment at the competent consulate.
    const trip = {stays:T.trip.map(({country, check_in, check_out}) => ({country, check_in, check_out}))};
    const competence = await visaslot.call('visaslot.competence', {trip});
    equal('Germany is the main destination (6 nights against 5)', [competence.main_country, competence.rule], ['DE', 'most_nights']);
    const french = (await visaslot.call('visaslot.appointments', {id:'appt-0324'})).item;
    await write(visaslot, visaslotInfra, 'visaslot.cancel', {appointment_id:french.id, appointment_version:french.version});
    const [slot] = (await visaslot.call('visaslot.slots', {consulate_id:'de-chicago', from:'2027-03-19', to:'2027-04-30'})).slots;
    const appointment = (await write(visaslot, visaslotInfra, 'visaslot.book', {consulate_id:'de-chicago', slot_at:slot.slot_at, slot_version:slot.version})).appointment;
    equal('The French booking is cancelled and the first German slot after the qual is booked',
      [(await visaslot.call('visaslot.appointments', {id:'appt-0324'})).item.status, appointment.id, appointment.slot_at], ['cancelled', 'appt-0331', T.appointment]);

    // 2. Travel signature: the current one lapses before the trip; Passage signs a new one in 5 business days.
    const before = (await passage.call('passage.documents.status', {})).documents[0];
    equal('The current travel signature lapses on 2027-03-09, before the trip', [before.current_signature.id, before.current_signature.valid_until], ['sig-0141', '2027-03-09']);
    const asked = await write(passage, passageInfra, 'passage.travel_signature.request', {});
    equal('The request is due on the 5th business day', [asked.request.id, asked.request.due_on], ['req-0142', T.signature.due_on]);
    const afterRequest = (await passageInfra.call('env.snapshot')).snapshot.data;
    equal('The request and its notice are exactly the fixture\'s req-0142 and notice-3 (stable message ID)',
      [afterRequest.requests.find(r => r.id === 'req-0142'), afterRequest.notices.find(n => n.id === 'notice-3')],
      [fixturePassage.requests.find(r => r.id === 'req-0142'), fixturePassage.notices.find(n => n.id === 'notice-3')]);
    await inMail('Passage request notice reaches Mail (receipt, record, Mail event receipt)', await notify('passage', passageInfra, passageBridge, 'request_received', 'req-0142'));
    const early = await passageInfra.call('env.apply_event', {expected_version:await version(passageInfra),
      event:{event_id:'processed-req-0142-early', at:'2027-02-12T16:00:00-06:00', operation:'passage.request.processed', payload:T.signature}});
    equal('Processing before the due date is refused', early.status, 'not_due');
    await event(passageInfra, {event_id:'processed-req-0142', at:T.signature_processed, operation:'passage.request.processed', payload:T.signature});
    await clock(all, T.signature_processed); // clock barrier: every App moves to the event's time
    const signature = (await passage.call('passage.documents.status', {})).documents[0].current_signature;
    equal('Passage signs the I-20 on the due date, valid until 2028-02-15', [signature.id, signature.signed_on, signature.valid_until, signature.status],
      ['sig-0142', '2027-02-15', '2028-02-15', 'valid']);
    const signed = await inMail('Passage signature notice reaches Mail', await notify('passage', passageInfra, passageBridge, 'signature_issued', 'sig-0142'));
    ok('The signature notice in Mail gives the new lapse date', signed.body.includes('2028-02-15'));

    // 3. Registration: preview, then confirm with a payment label. An expired preview records nothing.
    await event(confdeskInfra, {event_id:'scda27-registration-open', at:T.registration_opens, operation:'confdesk.registration.open', payload:{}});
    await clock(all, T.registration_opens);
    const stalePreview = await confdesk.call('confdesk.register.preview', {paper_id:'paper-214'});
    equal('Preview shows the author rate and what it covers and changes nothing',
      [stalePreview.rate, stalePreview.covers.length, stalePreview.expires_at, (await confdesk.call('confdesk.registration.get', {})).registration], [{amount_cents:72000, currency:'USD'}, 4, '2027-02-22T09:30:00-06:00', null]);
    await clock(all, T.preview_too_late);
    equal('A preview past its 30 minutes cannot be confirmed', await attempt(confdesk, confdeskInfra, 'confdesk.register.confirm',
      {preview_id:stalePreview.preview_id, payment_label:T.payment_label}), 'preview_expired');
    equal('Nothing is recorded by the refused confirmation', (await confdesk.call('confdesk.registration.get', {})).payments, []);
    const preview = await confdesk.call('confdesk.register.preview', {paper_id:'paper-214'});
    const confirmed = await write(confdesk, confdeskInfra, 'confdesk.register.confirm', {preview_id:preview.preview_id, payment_label:T.payment_label});
    equal('Confirmation registers the author, records one payment and expects the letter in 10 business days',
      [confirmed.registration.id, confirmed.payment.amount_cents, confirmed.payment.label, confirmed.letter_expected_on, (await confdesk.call('confdesk.paper.status', {})).paper.status],
      ['SCDA27-R-0388', 72000, T.payment_label, T.letter.due_on, 'in_program']);
    equal('A used preview cannot be confirmed again', await attempt(confdesk, confdeskInfra, 'confdesk.register.confirm',
      {preview_id:preview.preview_id, payment_label:T.payment_label}), 'preview_used');
    await inMail('ConfDesk registration notice reaches Mail', await notify('confdesk', confdeskInfra, confdeskBridge, 'registration_confirmed', 'SCDA27-R-0388'));

    // 4. The letter is issued with the misspelled surname on file; the Agent sees it in Mail.
    await event(confdeskInfra, {event_id:'scda27-letter-0388', at:T.letter_issued, operation:'confdesk.letter.issue', payload:T.letter});
    await clock(all, T.letter_issued);
    const original = (await confdesk.call('confdesk.letter.get', {})).current;
    equal('The letter prints the name on file, ZHOU Mingyu', [original.id, original.name_on_letter], ['letter-0388', 'ZHOU Mingyu']);
    const firstLetter = await inMail('ConfDesk letter notice reaches Mail', await notify('confdesk', confdeskInfra, confdeskBridge, 'letter_issued', 'letter-0388'));
    ok('Mail shows the misspelled name in the letter', firstLetter.body.includes('ZHOU Mingyu'));
    await clock(all, T.first_file);
    const firstFile = await write(visaslot, visaslotInfra, 'visaslot.file.submit', {appointment_id:appointment.id, documents:documents(T, original, signature)});
    equal('Registered with this letter, the file would fail the name rule if held now', firstFile.missing_if_held_now,
      [{item:'invitation_letter', rule:'name_matches_passport', expected:'ZHAO Mingyu', found:'ZHOU Mingyu'}]);

    // 5. Correction: 12 business days from the request; the deadline keeps the registered paper.
    await clock(all, T.correction_requested);
    const correction = (await write(confdesk, confdeskInfra, 'confdesk.letter.request_correction', {fields:{surname:'ZHAO'}})).correction;
    equal('The correction is expected on the 12th business day', [correction.id, correction.expected_on], ['correction-0388-1', T.correction.due_on]);
    const notices = (await confdeskInfra.call('env.snapshot')).snapshot.data.notices.length;
    await event(confdeskInfra, {event_id:'scda27-deadline', at:T.deadline_passed, operation:'confdesk.deadline.passed', payload:{}});
    await clock(all, T.deadline_passed);
    equal('The deadline keeps the registered paper and sends nothing', [(await confdesk.call('confdesk.paper.status', {})).paper.status,
      (await confdeskInfra.call('env.snapshot')).snapshot.data.notices.length], ['in_program', notices]);
    await event(confdeskInfra, {event_id:'scda27-letter-0388-c1', at:T.correction_issued, operation:'confdesk.correction.issue', payload:T.correction});
    await clock(all, T.correction_issued);
    const corrected = (await confdesk.call('confdesk.letter.get', {})).current;
    equal('The corrected letter supersedes the original', [corrected.id, corrected.name_on_letter, corrected.issued_at], ['letter-0388-c1', 'ZHAO Mingyu', T.correction_issued]);
    const correctedDelivery = await notify('confdesk', confdeskInfra, confdeskBridge, 'correction_issued', 'letter-0388-c1');
    const correctedMail = await inMail('ConfDesk corrected-letter notice reaches Mail', correctedDelivery);
    const inbox = (await mail.call('mail.search', {folder:'inbox'})).messages;
    ok('The Agent finds the corrected letter in the inbox under the delivery event ID', inbox.some(m => m.id === correctedDelivery.receipt.event_id && m.body.includes('ZHAO Mingyu')));

    // Delivery guarantees: a repeat returns the original receipt; unbound or ungranted recipients are refused.
    const mailVersion = await version(mailInfra);
    const again = await confdeskBridge.call('router.publish', {request_id:'confdesk-retry', message:correctedDelivery.message});
    ok('A repeated publish returns the original receipt', again.duplicate === true && again.event_id === correctedDelivery.receipt.event_id);
    const stray = copy(correctedDelivery.message);
    stray.id = 'confdesk-notice-unbound-mail-elise'; stray.data.recipient.id = 'mail-elise';
    equal('Messaging refuses a recipient with no Mail account bound in the run',
      (await confdeskBridge.call('router.publish', {request_id:'confdesk-stray', message:stray})).code, 'recipient_unavailable');
    const ungranted = await router('ungranted-config.json', 'confdesk');
    equal('Messaging refuses a bound recipient the publisher is not granted',
      (await ungranted.call('router.publish', {request_id:'ungranted', message:correctedDelivery.message})).code, 'recipient_not_authorized');
    equal('Mail is unchanged by the repeat and the refusals', await version(mailInfra), mailVersion);

    // 6. Replace the visa file with the corrected letter, then the appointment is held as complete.
    await clock(all, T.file_replaced);
    const file = documents(T, corrected, signature);
    const replaced = await write(visaslot, visaslotInfra, 'visaslot.file.submit', {appointment_id:appointment.id, documents:file});
    equal('The replacement file has nothing missing', [replaced.file.version, replaced.replaced_version, replaced.missing_if_held_now], [2, 1, []]);
    equal('Its sources are the ConfDesk letter, the Passage signature and the hotel reservations', sources(replaced.file),
      ['confdesk:invitation_letter:letter-0388-c1', 'passage:travel_signature:sig-0142', 'task-hotel:reservation:H-5521', 'task-hotel:reservation:H-5530']);
    const holdReceipt = await event(visaslotInfra, held(T));
    await clock(all, T.appointment);
    const result = await visaslot.call('visaslot.file.get', {appointment_id:appointment.id});
    equal('visaslot.appointment.held: the appointment is complete', result.check,
      {appointment_id:'appt-0331', held_at:T.appointment, result:'complete', missing:[]});
    equal('The file is locked and the appointment held', [!!result.file.locked_at, (await visaslot.call('visaslot.appointments', {id:appointment.id})).item.status], [true, 'held']);
    const replay = await visaslotInfra.call('env.apply_event', {expected_version:await version(visaslotInfra), event:held(T)});
    ok('Replaying the hold returns the original receipt', replay.duplicate === true && replay.event_id === holdReceipt.event_id);
    equal('The file cannot be replaced after the hold', await attempt(visaslot, visaslotInfra, 'visaslot.file.submit',
      {appointment_id:appointment.id, documents:file}), 'invalid_state');

    // 7. A second run registers the uncorrected letter and is refused.
    const refused = await require('./refused-run.cjs').run({open, sandbox, write, event, clock, equal, ok, T,
      letter:(await confdesk.call('confdesk.letter.get', {})).letters.find(l => l.id === 'letter-0388'), signature});

    // State consistency across the run.
    const final = {};
    for (const [app, infra] of Object.entries({confdesk:confdeskInfra, visaslot:visaslotInfra, passage:passageInfra, mail:mailInfra}))
      final[app] = (await infra.call('env.snapshot')).snapshot;
    equal('Every App clock ends at the appointment time', Object.values(final).map(s => s.virtual_now), Array(4).fill(T.appointment));
    const c = final.confdesk.data;
    equal('ConfDesk: one registration, one payment, the original letter and its correction', [c.registration.status, c.payments.length,
      c.letters.map(l => l.name_on_letter), c.correction_requests.map(x => x.fields)], ['completed', 1, ['ZHOU Mingyu', 'ZHAO Mingyu'], [{surname:'ZHAO'}]]);
    equal('Mail holds exactly the delivered notices and is otherwise untouched', final.mail.data,
      {...mailBefore, messages:await Promise.all(delivered.map(async d => (await mail.call('mail.get', {id:d.event_id})).message))});
    ok('Since its seed was loaded, only Infra deliveries and clock moves changed Mail', final.mail.audit.filter(a => a.state_changed).every(a => a.actor === 'infra'
      && ['env.load_seed', 'env.apply_event', 'env.advance_time'].includes(a.tool)) && final.mail.audit.filter(a => a.state_changed && a.tool === 'env.apply_event').length === delivered.length);

    return {passed:true, checks,
      deliveries:delivered,
      registration:{id:confirmed.registration.id, completed_at:confirmed.registration.completed_at, payment_label:confirmed.payment.label},
      letters:c.letters.map(l => ({id:l.id, name_on_letter:l.name_on_letter, issued_at:l.issued_at})),
      signature:{id:signature.id, signed_on:signature.signed_on, valid_until:signature.valid_until},
      appointment:{id:appointment.id, file_version:result.file.version, check:result.check},
      refused};
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(state, {recursive:true, force:true});
  }
}
module.exports = {run};
if (require.main === module) run().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
