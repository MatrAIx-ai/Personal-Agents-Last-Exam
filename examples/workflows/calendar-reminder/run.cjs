'use strict';
// Calendar → Notify reminders and a travel publisher → Notify pushes, over real MCP processes.
// The runner part (find due reminders in a snapshot, fire each at its time) is the hook a
// task runner uses to decide when an actionable alert should start a user session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('../../../runtime/client.cjs');
const {due, fireEvent} = require('../../../apps/notify/src/due.cjs');
const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'registry.notify.json');
const copy = value => structuredClone(value);
const OPAQUE_ID = 'Team sync #7 / Room B (Thu 19 Nov) – équipe';

async function run() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-calendar-reminder-'));
  const clients = [], checks = [];
  let sequence = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks.push(label); };
  const ok = (label, condition) => { assert.ok(condition, label); checks.push(label); };
  async function open(app, role, run = 'reminders') {
    const client = new Client(app, role, run, state, 'calendar-reminder-workflow', {registry});
    clients.push(client); await client.initialize(); return client;
  }
  async function write(agent, infra, name, args) {
    const result = await agent.call(name, {...args, expected_version:(await infra.call('env.snapshot')).version, request_id:'write-' + (++sequence)});
    assert.equal(result.status, 'committed', JSON.stringify({name, result})); return result;
  }
  async function sandbox(infra) {
    const s = await infra.call('env.snapshot');
    assert.equal((await infra.call('env.reset', {expected_version:s.version, profile:'sandbox'})).status, 'ready');
  }
  // Trusted run setup: bind the travel publisher's account to the device owner.
  async function bind(infra, accounts) {
    const s = await infra.call('env.snapshot');
    const binding = copy(s.snapshot.binding); binding.accounts.push(...accounts);
    const result = await infra.call('env.load_seed', {expected_version:s.version, request_id:'bind-' + (++sequence),
      data:copy(s.snapshot.data), binding, policies:copy(s.snapshot.policies), bundle:copy(s.snapshot.resources.bundle)});
    assert.equal(result.status, 'ready', JSON.stringify(result));
  }
  async function router(run) {
    const client = new Client(null, null, null, null, 'calendar-reminder-router', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(__dirname, 'push-config.json'), '--publisher', 'trip-alerts', '--run', run, '--state-dir', state]});
    clients.push(client); await client.initialize(); return client;
  }
  // The runner: everything due up to `until`, fired in time order at each reminder's own time.
  async function fireDue(infra, until) {
    const s = await infra.call('env.snapshot'), fired = [];
    for (const reminder of due(s.snapshot.data, s.snapshot.virtual_now, until)) {
      const v = (await infra.call('env.snapshot')).version;
      const receipt = await infra.call('env.apply_event', {expected_version:v, event:fireEvent(reminder)});
      assert.equal(receipt.status, 'committed', JSON.stringify(receipt)); fired.push(reminder.reminder_id);
    }
    return fired;
  }
  const tripsBinding = {app_id:'trip-alerts', account_id:'trips-maya', owner_person_id:'person-maya'};
  const push = (id, title, recipient = 'notify-maya') => ({specversion:'1.0', id, source:'urn:pale:app:trip-alerts:account:trips-maya',
    type:'org.pale.notify.push.v1', time:'2026-11-18T17:00:00-08:00', datacontenttype:'application/json', dataschema:'urn:pale:push-payload:1',
    data:{channel:'channel.push', recipient:{kind:'app_account_ref', app_id:'notify', id:recipient},
      source_object:{app_id:'trip-alerts', account_id:'trips-maya', object_type:'flight', object_id:'UA-1542'},
      content:{title, body:'New departure 19:05. Your seat is unchanged.', actionable:true, deep_link:'pale://trip-alerts/flights/UA-1542'}, extensions:[]}});

  try {
    const calendar = await open('calendar', 'agent'), calendarInfra = await open('calendar', 'infra');
    const notify = await open('notify', 'agent'), notifyInfra = await open('notify', 'infra');

    // Permissions: device and delivery operations are not Agent tools.
    const tools = (await notify.request('tools/list')).result.tools.map(t => t.name);
    ok('Agent sees no Infra or user-only operations', tools.every(n => !n.startsWith('env.')) &&
      !['notify.focus.set', 'notify.device.silence', 'notify.feed.dismiss', 'notify.reminder.fire'].some(n => tools.includes(n)));
    const initial = await notifyInfra.call('env.snapshot');
    equal('Agent cannot fire a reminder', (await notify.call('env.apply_event', {expected_version:initial.version,
      event:fireEvent({reminder_id:'reminder-pantry', fire_at:'2026-11-18T17:30:00-08:00'})})).status, 'permission_denied');
    equal('Scenario profile is read-only', (await notify.call('notify.reminder.create', {title:'x', fire_at:'2026-11-19T09:00:00-08:00',
      expected_version:initial.version, request_id:'denied'})).status, 'permission_denied');

    await bind(notifyInfra, [tripsBinding]);
    await sandbox(notifyInfra); await sandbox(calendarInfra);
    // Calendar IDs are opaque (any nonempty string up to 100 characters). Give Calendar an event whose ID
    // Notify's own ID rule would refuse, to check that Notify keeps it exactly as calendar.get returns it.
    {
      const s = await calendarInfra.call('env.snapshot'), data = copy(s.snapshot.data);
      data.events.push({...copy(data.events[0]), id:OPAQUE_ID, uid:'team-sync-7@pale.example', title:'Team sync',
        start:'2026-11-19T09:00:00-08:00', end:'2026-11-19T09:30:00-08:00', attachments:[]});
      const bundle = copy(s.snapshot.resources.bundle); bundle.dataset.expected_counts.records++;
      const seeded = await calendarInfra.call('env.load_seed', {expected_version:s.version, request_id:'opaque-calendar-id', data,
        binding:copy(s.snapshot.binding), policies:copy(s.snapshot.policies), bundle});
      assert.equal(seeded.status, 'ready', JSON.stringify(seeded));
    }

    // 1. The Agent puts a flight on the calendar and asks for an alert 15 minutes before it.
    const event = await write(calendar, calendarInfra, 'calendar.create', {title:'Flight to Denver', start:'2026-11-18T16:00:00-08:00',
      end:'2026-11-18T18:30:00-08:00', timezone:'America/Los_Angeles', location:'SFO Terminal 3'});
    const start = (await calendar.call('calendar.get', {id:event.id})).event.start;
    const calendarAfterCreate = (await calendarInfra.call('env.snapshot')).snapshot.data;
    const reminder = await write(notify, notifyInfra, 'notify.reminder.create', {title:'Leave for SFO now', body:'Flight to Denver at 16:00.',
      actionable:true, calendar_account_id:calendarAfterCreate.account_id, calendar_event_id:event.id, event_start:start, minutes_before:15});
    equal('Anchored reminder fires 15 minutes before the Calendar event', reminder.fire_at, '2026-11-18T15:45:00-08:00');

    // 2. Advance the idle App clock, then fire what is due. 15:45 on a Wednesday is outside both focus windows.
    const before = await notifyInfra.call('env.snapshot');
    equal('Clock advances without firing anything', (await notifyInfra.call('env.advance_time', {expected_version:before.version,
      virtual_now:'2026-11-18T15:40:00-08:00', request_id:'clock-1'})).advanced, true);
    equal('Advancing time alone delivers nothing', (await notify.call('notify.reminder.get', {id:reminder.id})).item.status, 'scheduled');
    equal('Runner fires the due reminders in order', await fireDue(notifyInfra, '2026-11-18T18:00:00-08:00'), [reminder.id, 'reminder-pantry']);
    const delivered = (await notify.call('notify.reminder.get', {id:reminder.id})).item;
    equal('Reminder delivered at its time', [delivered.status, delivered.fired_at], ['delivered', '2026-11-18T15:45:00-08:00']);
    const unread = (await notify.call('notify.feed.list', {unread_only:true})).items;
    ok('Delivered alert is on the lock screen, actionable and unread', unread.some(f => f.id === delivered.feed_item_id && f.actionable && f.read_at === null));
    await write(notify, notifyInfra, 'notify.feed.mark_read', {id:delivered.feed_item_id});
    const retry = await notifyInfra.call('env.apply_event', {expected_version:(await notifyInfra.call('env.snapshot')).version,
      event:fireEvent({reminder_id:reminder.id, fire_at:reminder.fire_at})});
    ok('Retrying the same fire returns the original receipt', retry.duplicate === true);

    // 3. A travel App pushes a delay through Messaging; Notify owns the receive contract.
    equal('Publisher copy matches the receiver-owned wire schema', require('./publisher/schemas/router-message.schema.json'),
      require('../../../apps/notify/schemas/router-message.schema.json'));
    const bridge = await router('reminders');
    const message = push('ua1542-delay', 'UA 1542 delayed to 19:05');
    const receipt = await bridge.call('router.publish', {request_id:'delay-1', message});
    equal('Publisher → Notify push commits', receipt.status, 'committed');
    const item = (await notify.call('notify.feed.list', {})).items.find(f => f.id === receipt.event_id);
    equal('Receiver stores provenance, producer time and arrival time', [item.source.app_id, item.source.message_id, item.sent_at, item.arrived_at, item.delivery],
      ['trip-alerts', 'ua1542-delay', message.time, '2026-11-18T17:30:00-08:00', 'delivered']);
    ok('Repeated push deduplicates', (await bridge.call('router.publish', {request_id:'delay-retry', message})).duplicate === true);
    equal('Unknown recipient account is rejected by the router', (await bridge.call('router.publish',
      {request_id:'nobody', message:push('ua1542-nobody', 'Lost', 'notify-alex')})).code, 'recipient_unavailable');

    // 4. Inside the Sleep focus window the same kinds of alert arrive silently.
    equal('Runner fires the late reminder', await fireDue(notifyInfra, '2026-11-19T00:00:00-08:00'), ['reminder-plants']);
    equal('A reminder inside focus is silenced', (await notify.call('notify.reminder.get', {id:'reminder-plants'})).item.status, 'silenced');
    const night = await bridge.call('router.publish', {request_id:'gate-1', message:push('ua1542-gate', 'Gate changed to F12')});
    equal('A push inside focus is stored as silenced', (await notify.call('notify.feed.list', {})).items.find(f => f.id === night.event_id).delivery, 'silenced');
    equal('Agent can read why the phone is quiet', (await notify.call('notify.focus.get', {})).focus_id, 'focus-sleep');

    // 5. A Calendar event ID outside Notify's ID rule is stored and read back exactly, and its reminder fires.
    const opaque = (await calendar.call('calendar.get', {id:OPAQUE_ID})).event;
    const anchored = await write(notify, notifyInfra, 'notify.reminder.create', {title:'Team sync in 15 minutes', body:'',
      calendar_account_id:opaque.account_id, calendar_event_id:opaque.id, event_start:opaque.start, minutes_before:15});
    equal('An opaque Calendar event ID survives storage and readback', (await notify.call('notify.reminder.get', {id:anchored.id})).item.anchor.calendar_event_ref,
      {app_id:'calendar', account_id:opaque.account_id, event_id:OPAQUE_ID});
    equal('The reminder for that event fires at its time', await fireDue(notifyInfra, '2026-11-19T09:00:00-08:00'), [anchored.id]);
    equal('It is delivered (08:45 Thursday is outside both focus windows)', (await notify.call('notify.reminder.get', {id:anchored.id})).item.status, 'delivered');

    // 6. Notify never wrote to Calendar; a moved event does not move an existing reminder.
    equal('Calendar state is untouched by Notify', (await calendarInfra.call('env.snapshot')).snapshot.data, calendarAfterCreate);
    await write(calendar, calendarInfra, 'calendar.update', {id:event.id, patch:{start:'2026-11-18T19:05:00-08:00', end:'2026-11-18T21:30:00-08:00'}});
    equal('Reminder keeps the time computed when it was set', (await notify.call('notify.reminder.get', {id:reminder.id})).item.fire_at, reminder.fire_at);

    // 7. A sender that is not bound to the device owner is refused by the receiver, with no partial record.
    const strangerInfra = await open('notify', 'infra', 'unbound-sender');
    const strangerBefore = (await strangerInfra.call('env.snapshot')).snapshot.data;
    const strangerBridge = await router('unbound-sender');
    const refused = await strangerBridge.call('router.publish', {request_id:'stranger', message:push('ua1542-stranger', 'Unbound sender')});
    ok('Receiver rejects a push from an unbound sender and asks for inspection', refused.code === 'receiver_rejected' && refused.reason === 'permission_denied' && refused.stop_run);
    equal('Rejected push leaves the feed unchanged', (await strangerInfra.call('env.snapshot')).snapshot.data, strangerBefore);

    const final = (await notifyInfra.call('env.snapshot')).snapshot;
    return {passed:true, checks, push_receipt:receipt, feed:final.data.feed.map(f => ({id:f.id, source:f.source.kind, delivery:f.delivery, arrived_at:f.arrived_at, read_at:f.read_at}))};
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(state, {recursive:true, force:true});
  }
}
module.exports = {run};
if (require.main === module) run().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
