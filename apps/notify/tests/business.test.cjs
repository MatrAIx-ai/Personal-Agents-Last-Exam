'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {due, fireEvent, fireEventId} = require('../src/due.cjs');
const {quietAt} = require('../src/attention.cjs');

const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }
const fire = (id, at, eventId = 'fire-' + id + '-' + at) => ({event_id:eventId, at, operation:'notify.reminder.fire', payload:{reminder_id:id}});
const reminder = (f, id) => f.call('notify.reminder.get', {id}).item;
const feed = (f, id) => f.data.feed.find(x => x.id === id);
function push(f, {id = 'ship-2', account = 'order-maya', app = 'order-notifier', title = 'Out for delivery', time = '2026-11-18T09:58:00-08:00'} = {}) {
  return {specversion:'1.0', id, source:'urn:pale:app:' + app + ':account:' + account, type:'org.pale.notify.push.v1',
    ...(time ? {time} : {}), datacontenttype:'application/json', dataschema:'urn:pale:push-payload:1',
    data:{channel:'channel.push', recipient:{kind:'app_account_ref', app_id:'notify', id:'notify-maya'},
      source_object:{app_id:app, account_id:account, object_type:'order', object_id:'order-1'},
      content:{title, body:'Driver is 3 stops away.', actionable:false, deep_link:null}, extensions:[]}};
}
const receive = (eventId, at, message) => ({event_id:eventId, at, operation:'notify.receive', payload:{recipient_account_id:'notify-maya', message}});

test('generated schemas and tools.json match their single source', () => {
  if (!fs.existsSync(path.resolve(__dirname, '../../../runtime/contracts/schemas/cloudevent.schema.json'))) return;
  require('../build/schemas.cjs').build({check:true});
});

test('reads are side-effect free and filter by status and time window', () => {
  const f = fixture(), before = f.data;
  assert.deepEqual(f.call('notify.reminder.list', {status:'scheduled'}).items.map(r => r.id), ['reminder-pantry', 'reminder-plants']);
  assert.deepEqual(f.call('notify.reminder.list', {from:'2026-11-18T18:00:00-08:00', to:'2026-11-19T00:00:00-08:00'}).items.map(r => r.id), ['reminder-plants']);
  assert.deepEqual(f.call('notify.feed.list', {}).items.map(x => x.id), ['push-order-1', 'push-bank-2', 'feed-review', 'push-bank-1', 'feed-rx']); // newest first, dismissed left out
  assert.deepEqual(f.call('notify.feed.list', {unread_only:true}).items.map(x => x.id), ['push-order-1', 'push-bank-1']);
  assert.equal(f.call('notify.focus.get', {}).quiet_now, false);
  assert.deepEqual(f.data, before);
  assert.throws(() => f.call('notify.reminder.get', {id:'missing'}), code('not_found'));
});

test('create schedules a future reminder; past times and ambiguous inputs are rejected', () => {
  const f = fixture();
  const out = f.call('notify.reminder.create', {title:'Leave for the airport', fire_at:'2026-11-18T15:10:00-08:00', actionable:true});
  const r = reminder(f, out.id);
  assert.deepEqual([r.status, r.fire_at, r.actionable, r.fired_at, r.feed_item_id], ['scheduled', '2026-11-18T15:10:00-08:00', true, null, null]);
  unchanged(f, () => f.call('notify.reminder.create', {title:'Too late', fire_at:'2026-11-18T08:59:00-08:00'}), code('invalid_time'));
  unchanged(f, () => f.call('notify.reminder.create', {title:'Now is too late', fire_at:f.ctx.virtual_now}), code('invalid_time'));
  unchanged(f, () => f.call('notify.reminder.create', {title:'No time'}), code('invalid_arguments'));
  const anchor = {calendar_account_id:'calendar-maya', calendar_event_id:'evt-lunch', event_start:'2026-11-18T13:00:00-08:00', minutes_before:30};
  unchanged(f, () => f.call('notify.reminder.create', {title:'Both', fire_at:'2026-11-18T12:00:00-08:00', ...anchor}), code('invalid_arguments'));
  unchanged(f, () => f.call('notify.reminder.create', {title:'Partial', calendar_event_id:'evt-lunch', minutes_before:5}), code('invalid_arguments'));
});

test('a Calendar anchor computes the fire time from the event start and keeps its UTC offset', () => {
  const f = fixture();
  const out = f.call('notify.reminder.create', {title:'Late call', ...{calendar_account_id:'calendar-maya', calendar_event_id:'evt-lunch', event_start:'2026-11-19T00:10:00-08:00', minutes_before:30}});
  assert.equal(out.fire_at, '2026-11-18T23:40:00-08:00');
  assert.deepEqual(reminder(f, out.id).anchor, {calendar_event_ref:{app_id:'calendar', account_id:'calendar-maya', event_id:'evt-lunch'},
    event_start:'2026-11-19T00:10:00-08:00', minutes_before:30});
  assert.deepEqual(plugin.references(f.data).at(-1), {app_id:'calendar', account_id:'calendar-maya', object_id:'evt-lunch'});
  // A tampered anchor cannot disagree with its fire time.
  const bad = f.data; bad.reminders.at(-1).fire_at = '2026-11-18T23:00:00-08:00';
  assert.throws(() => plugin.validateSeed(f.ctx, bad), /minutes_before/);
});

test('a Calendar anchor keeps the fractional seconds of the event start', () => {
  const f = fixture();
  const anchor = {calendar_account_id:'calendar-maya', calendar_event_id:'evt-lunch', event_start:'2026-11-18T13:00:00.500-08:00', minutes_before:15};
  const out = f.call('notify.reminder.create', {title:'Lunch', ...anchor});
  assert.equal(out.fire_at, '2026-11-18T12:45:00.500-08:00');
  assert.equal(f.call('notify.reminder.update', {id:out.id, patch:{...anchor, minutes_before:20}}).fire_at, '2026-11-18T12:40:00.500-08:00');
});

test('update and cancel work only before the reminder fires; absolute time detaches an anchor', () => {
  const f = fixture();
  const id = f.call('notify.reminder.create', {title:'Lunch', ...{calendar_account_id:'calendar-maya', calendar_event_id:'evt-lunch', event_start:'2026-11-18T13:00:00-08:00', minutes_before:10}}).id;
  assert.equal(f.call('notify.reminder.update', {id, patch:{...{calendar_account_id:'calendar-maya', calendar_event_id:'evt-lunch', event_start:'2026-11-18T13:00:00-08:00', minutes_before:20}}}).fire_at, '2026-11-18T12:40:00-08:00');
  assert.equal(reminder(f, id).anchor.minutes_before, 20);
  assert.equal(f.call('notify.reminder.update', {id, patch:{fire_at:'2026-11-18T12:30:00-08:00'}}).fire_at, '2026-11-18T12:30:00-08:00');
  assert.equal(reminder(f, id).anchor, null);
  unchanged(f, () => f.call('notify.reminder.update', {id, patch:{}}), code('invalid_arguments'));
  unchanged(f, () => f.call('notify.reminder.update', {id, patch:{fire_at:'2026-11-18T08:00:00-08:00'}}), code('invalid_time'));
  f.call('notify.reminder.cancel', {id});
  assert.equal(reminder(f, id).status, 'cancelled');
  unchanged(f, () => f.call('notify.reminder.cancel', {id}), code('invalid_state'));
  unchanged(f, () => f.call('notify.reminder.update', {id:'reminder-review', patch:{title:'Rewrite history'}}), code('invalid_state'));
  assert.deepEqual(reminder(f, id).history.map(h => h.action), ['scheduled', 'updated', 'updated', 'cancelled']);
});

test('fire delivers at its time, refuses early or repeated fires, and records a cancelled fire as a no-op', () => {
  const f = fixture();
  unchanged(f, () => f.event(fire('reminder-pantry', '2026-11-18T17:29:00-08:00')), code('not_due'));
  f.event(fire('reminder-pantry', '2026-11-18T17:30:00-08:00'));
  const r = reminder(f, 'reminder-pantry'), item = feed(f, r.feed_item_id);
  assert.deepEqual([r.status, r.fired_at], ['delivered', '2026-11-18T17:30:00-08:00']);
  assert.deepEqual([item.delivery, item.arrived_at, item.actionable, item.read_at, item.source], ['delivered', r.fired_at, true, null, {kind:'reminder', reminder_id:r.id}]);
  unchanged(f, () => f.event(fire('reminder-pantry', '2026-11-18T17:31:00-08:00', 'second-fire')), code('already_fired'));
  unchanged(f, () => f.call('notify.reminder.cancel', {id:'reminder-pantry'}), code('invalid_state'));
  const before = f.data.feed.length;
  f.event(fire('reminder-call', '2026-11-18T17:32:00-08:00'));
  assert.equal(f.data.feed.length, before);
  assert.equal(reminder(f, 'reminder-call').history.at(-1).action, 'fire_skipped_cancelled');
  unchanged(f, () => f.event(fire('missing', '2026-11-18T17:33:00-08:00')), code('not_found'));
});

test('a late fire is delivered at the late time, and a reminder never fires before it is due', () => {
  const f = fixture();
  f.event(fire('reminder-pantry', '2026-11-18T19:00:00-08:00'));
  assert.equal(reminder(f, 'reminder-pantry').fired_at, '2026-11-18T19:00:00-08:00');
  const bad = f.data; const r = bad.reminders.find(x => x.id === 'reminder-plants');
  r.status = 'delivered'; r.fired_at = '2026-11-18T22:00:00-08:00';
  assert.throws(() => plugin.validateSeed(f.ctx, bad), /fire before|feed item/);
});

test('focus windows silence deliveries, including windows that run past midnight', () => {
  const f = fixture();
  // Sleep runs 22:30-07:00 every day; reminder-plants fires at 23:00.
  f.event(fire('reminder-plants', '2026-11-18T23:00:00-08:00'));
  const r = reminder(f, 'reminder-plants');
  assert.equal(r.status, 'silenced');
  assert.equal(feed(f, r.feed_item_id).delivery, 'silenced');
  const device = f.data.device;
  assert.equal(quietAt(device, '2026-11-19T06:59:00-08:00').focus_id, 'focus-sleep');
  assert.equal(quietAt(device, '2026-11-19T07:00:00-08:00').quiet, false);
  assert.equal(quietAt(device, '2026-11-18T14:00:00-08:00').focus_id, 'focus-work'); // Wednesday
  assert.equal(quietAt(device, '2026-11-21T14:00:00-08:00').quiet, false); // Saturday: work focus is weekdays only
});

test('focus follows the device zone across a daylight-saving change', () => {
  const device = {timezone:'America/Chicago', focus:[{id:'f', label:'Gym', days:['sun'], start:'08:00', end:'09:00'}], silence_until:null};
  // 2026-11-01 is the US fall-back Sunday: 08:30 local is 13:30Z before and 14:30Z after the change.
  assert.equal(quietAt(device, '2026-11-01T08:30:00-06:00').quiet, true);
  assert.equal(quietAt(device, '2026-11-01T13:30:00Z').quiet, false);
  assert.equal(quietAt(device, '2026-11-01T14:30:00Z').quiet, true);
});

test('silence and focus changes are user events; the Agent can only read them', () => {
  const f = fixture();
  f.event({event_id:'silence', at:'2026-11-18T10:00:00-08:00', operation:'notify.device.silence', payload:{until:'2026-11-18T18:00:00-08:00'}});
  f.ctx.virtual_now = '2026-11-18T10:05:00-08:00';
  const state = f.call('notify.focus.get', {});
  assert.deepEqual([state.quiet_now, state.quiet_reason], [true, 'silence']);
  f.event(fire('reminder-pantry', '2026-11-18T17:30:00-08:00'));
  assert.equal(reminder(f, 'reminder-pantry').status, 'silenced');
  unchanged(f, () => f.event({event_id:'bad-silence', at:'2026-11-18T17:40:00-08:00', operation:'notify.device.silence', payload:{until:'2026-11-18T17:00:00-08:00'}}), code('invalid_event'));
  f.event({event_id:'clear', at:'2026-11-18T17:45:00-08:00', operation:'notify.device.silence', payload:{until:null}});
  f.event({event_id:'focus', at:'2026-11-18T17:50:00-08:00', operation:'notify.focus.set', payload:{focus:[]}});
  f.event(fire('reminder-plants', '2026-11-18T23:00:00-08:00'));
  assert.equal(reminder(f, 'reminder-plants').status, 'delivered');
  assert.deepEqual(f.data.device.history.map(h => h.action), ['seeded', 'silenced', 'silence_cleared', 'focus_set']);
  const duplicate = [{id:'a', label:'A', days:['mon'], start:'01:00', end:'02:00'}, {id:'a', label:'B', days:['tue'], start:'01:00', end:'02:00'}];
  unchanged(f, () => f.event({event_id:'dup-focus', at:'2026-11-18T23:10:00-08:00', operation:'notify.focus.set', payload:{focus:duplicate}}), /Duplicate focus/);
  const tools = require('../tools.json').map(t => t.name);
  for (const userOnly of ['notify.focus.set', 'notify.device.silence', 'notify.feed.dismiss', 'notify.reminder.fire']) assert.ok(!tools.includes(userOnly));
});

test('pushes from a bound sender land in the feed with provenance; read and dismiss are recorded', () => {
  const f = fixture();
  f.event(receive('router-1', '2026-11-18T10:00:00-08:00', push(f)));
  const item = feed(f, 'router-1');
  assert.deepEqual(item.source, {kind:'push', app_id:'order-notifier', account_id:'order-maya', object_type:'order', object_id:'order-1', message_id:'ship-2'});
  assert.deepEqual([item.delivery, item.sent_at, item.arrived_at, item.read_at], ['delivered', '2026-11-18T09:58:00-08:00', '2026-11-18T10:00:00-08:00', null]);
  f.ctx.virtual_now = '2026-11-18T10:02:00-08:00';
  f.call('notify.feed.mark_read', {id:'router-1'});
  assert.equal(feed(f, 'router-1').read_at, '2026-11-18T10:02:00-08:00');
  f.event({event_id:'dismiss', at:'2026-11-18T10:03:00-08:00', operation:'notify.feed.dismiss', payload:{feed_item_id:'router-1'}});
  assert.ok(!f.call('notify.feed.list', {}).items.some(x => x.id === 'router-1'));
  assert.ok(f.call('notify.feed.list', {include_dismissed:true}).items.some(x => x.id === 'router-1'));
  unchanged(f, () => f.event({event_id:'dismiss-2', at:'2026-11-18T10:04:00-08:00', operation:'notify.feed.dismiss', payload:{feed_item_id:'router-1'}}), code('invalid_state'));
  // Missing producer time is not invented; a push inside a focus window arrives silently.
  f.event(receive('router-2', '2026-11-18T13:30:00-08:00', push(f, {id:'ship-3', time:null})));
  assert.deepEqual([feed(f, 'router-2').sent_at, feed(f, 'router-2').delivery], [null, 'silenced']);
});

test('pushes from unbound senders, other owners or to another account are rejected without a trace', () => {
  const f = fixture();
  unchanged(f, () => f.event(receive('spoof', '2026-11-18T10:00:00-08:00', push(f, {app:'airline', account:'airline-maya'}))), code('permission_denied'));
  f.ctx.binding.accounts.push({app_id:'airline', account_id:'airline-alex', owner_person_id:'person-alex'});
  unchanged(f, () => f.event(receive('other-owner', '2026-11-18T10:00:00-08:00', push(f, {app:'airline', account:'airline-alex'}))), code('permission_denied'));
  const wrong = receive('wrong', '2026-11-18T10:00:00-08:00', push(f)); wrong.payload.recipient_account_id = 'notify-alex';
  unchanged(f, () => f.event(wrong), code('invalid_event'));
  unchanged(f, () => f.event(receive('reminder-pantry', '2026-11-18T10:00:00-08:00', push(f))), code('already_exists'));
});

test('the runner helper lists due reminders in order and builds stable fire events', () => {
  const f = fixture();
  f.call('notify.reminder.create', {title:'Earlier', fire_at:'2026-11-18T12:00:00-08:00'});
  const list = due(f.data, '2026-11-18T09:00:00-08:00', '2026-11-18T23:00:00-08:00');
  assert.deepEqual(list.map(r => r.reminder_id), ['reminder-1', 'reminder-pantry']); // [from, to) excludes 23:00
  assert.deepEqual(fireEvent(list[1]), require('../examples/scenario.json'));
  f.event(fireEvent(list[0]));
  assert.deepEqual(due(f.data, '2026-11-18T09:00:00-08:00', '2026-11-19T00:00:00-08:00').map(r => r.reminder_id), ['reminder-pantry', 'reminder-plants']);
});

test('fire events stay within the event ID limit for the longest reminder IDs', () => {
  const f = fixture();
  const data = f.data, long = 'r' + 'x'.repeat(99), sibling = 'r' + 'x'.repeat(98) + 'y';
  const pantry = data.reminders.find(r => r.id === 'reminder-pantry');
  data.reminders.push({...structuredClone(pantry), id:long}, {...structuredClone(pantry), id:sibling, fire_at:'2026-11-18T17:31:00-08:00'});
  f.load(data);
  const events = due(f.data, '2026-11-18T17:00:00-08:00', '2026-11-18T18:00:00-08:00').map(fireEvent);
  assert.deepEqual(events.map(e => e.payload.reminder_id), ['reminder-pantry', long, sibling]);
  assert.equal(new Set(events.map(e => e.event_id)).size, 3);
  for (const e of events) assert.ok(e.event_id.length <= 100);
  assert.equal(events[0].event_id, 'fire-reminder-pantry');
  assert.deepEqual(fireEvent({reminder_id:long, fire_at:pantry.fire_at}), events[1]);
  for (const e of events) f.event(e); // the harness checks each event against events.schema.json
  assert.equal(reminder(f, long).status, 'delivered');
});

test('a shortened fire-event ID never equals the literal ID of another reminder', () => {
  const f = fixture();
  const data = f.data, long = 'r' + 'x'.repeat(99);
  // A literal ID shaped like a shortened one: prefix of the long ID, '-', its 24-character hash.
  const hash = require('node:crypto').createHash('sha256').update(long).digest('hex').slice(0, 24);
  const lookalike = long.slice(0, 100 - 'fire-'.length - hash.length - 1) + '-' + hash;
  assert.ok(('fire-' + lookalike).length <= 100);
  const pantry = data.reminders.find(r => r.id === 'reminder-pantry');
  data.reminders.push({...structuredClone(pantry), id:long}, {...structuredClone(pantry), id:lookalike, fire_at:'2026-11-18T17:31:00-08:00'});
  f.load(data);
  const events = due(f.data, '2026-11-18T17:00:00-08:00', '2026-11-18T18:00:00-08:00').map(fireEvent);
  assert.deepEqual(events.map(e => e.payload.reminder_id), ['reminder-pantry', long, lookalike]);
  assert.equal(new Set(events.map(e => e.event_id)).size, 3);
  for (const e of events) f.event(e);
  assert.equal(reminder(f, long).status, 'delivered');
  assert.equal(reminder(f, lookalike).status, 'delivered');
});

test('the Edit form leaves the fire time out so a text-only edit keeps it', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../gui/src/app.js'), 'utf8')
    .replace(/^import .*$/m, 'const el=()=>null,time=String,tag=()=>null,textBlock=()=>null,metadata=()=>null,mount=()=>{};')
    .replace('export const config', 'const config');
  const config = new Function(source + '\nreturn config;')();
  const edit = config.actions.find(a => a.tool === 'notify.reminder.update');
  const r = {title:'Pantry', body:'', fire_at:'2026-11-18T12:45:30.500-08:00', actionable:true};
  assert.deepEqual(edit.prefill(r), {patch:{title:'Pantry', body:'', actionable:true}});
  assert.match(config.field('patch.fire_at').help, /keep the current time/);
});

test('seed validation rejects unbound accounts, bad zones, broken links and reversed history', () => {
  const f = fixture();
  const mutate = fn => { const d = f.data; fn(d); return d; };
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.account_id = 'unbound'; })), /binding/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.device.timezone = 'Mars/Olympus'; })), /time zone/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.feed.find(x => x.id === 'feed-review').source.reminder_id = 'reminder-pantry'; })), /did not produce|feed item/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.reminders.find(r => r.id === 'reminder-review').feed_item_id = null; })), /feed item/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.feed.find(x => x.id === 'push-order-1').source.account_id = 'stranger'; })), /bound to the device owner/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.reminders.find(r => r.id === 'reminder-call').history[0].at = '2099-01-01T00:00:00Z'; })), /history/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.feed.push({...d.feed[1], account_id:d.account_id}); })), /Duplicate/);
});

test('optional diagnostics cannot change business results', () => {
  const on = fixture(), off = fixture({logging:false}), scenario = require('../examples/scenario.json');
  on.event(scenario); off.event(scenario);
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => !JSON.stringify(l).includes('pantry before')), 'logs carry IDs, not reminder text');
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  broken.event(scenario); assert.deepEqual(broken.data, off.data);
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', body:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});

test('the example seed matches the approved plan: 5 reminders, 6 past feed items from 3 sources', () => {
  const d = fixture().data;
  const sources = new Set(d.feed.map(x => x.source.kind === 'reminder' ? 'reminder' : x.source.app_id));
  assert.deepEqual([d.reminders.length, d.feed.length, [...sources].sort()], [5, 6, ['bank-alerts', 'order-notifier', 'reminder']]);
  assert.ok(d.reminders.some(r => r.anchor) && d.reminders.some(r => r.status === 'silenced') && d.feed.some(x => x.dismissed_at));
});
