'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('./harness.cjs');
const time = require('../src/time.cjs');
const {publishPending, messageFor} = require('../src/publisher.cjs');
const {exportEvidence, task73} = require('../evaluator/export.cjs');
const view = require('../gui/src/view.js');

const OFFSET = '-06:00';
const at = (year, month, day, hour, minute, second = 0) => time.formatInstant(OFFSET, time.instant(OFFSET, year, month, day, hour, minute, second));
const floor = Date.parse('2026-01-01T00:00:00Z');

function capture(fn) {
  try { fn(); } catch (error) { return error; }
  return null;
}

function codeOf(error) {
  return error && error.code;
}

function device(data, id) {
  return data.devices.find(item => item.device_id === id);
}

test('package example opens the front door sensor without a quiet-hours alert', () => {
  const house = fixture();
  const before = house.data;
  house.event(require('../examples/scenario.json'));
  assert.equal(device(house.data, 'contact-front').sensor, 'open');
  assert.equal(house.data.alerts.length, 0);
  assert.notDeepEqual(house.data, before);
});

test('direct commands, ranges and reads', () => {
  const house = fixture();
  assert.equal(house.call('brightwire-home.devices.list').devices.length, 13);
  const turned = house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_off'});
  assert.equal(turned.outcome, 'applied');
  assert.equal(device(house.data, 'light-living').power, 'off');
  house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'set_brightness', args: {brightness: 1}});
  assert.equal(device(house.data, 'light-living').power, 'on');
  assert.equal(device(house.data, 'light-living').brightness, 1);
  for (const brightness of [0, 101]) {
    assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'set_brightness', args: {brightness}}))), 'value_out_of_range');
  }
  house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'set_color_temperature', args: {color_temperature: 2200}});
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'set_color_temperature', args: {color_temperature: 6501}}))), 'value_out_of_range');
  house.call('brightwire-home.devices.command', {device_id: 'blind-living', command: 'set_position', args: {position: 0}});
  house.call('brightwire-home.devices.command', {device_id: 'blind-living', command: 'open'});
  assert.equal(device(house.data, 'blind-living').position, 100);
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'blind-living', command: 'set_position', args: {position: 101}}))), 'value_out_of_range');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'thermo-main', command: 'set_setpoint', args: {setpoint: 65}}))), 'setpoint_outside_owner_range');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'thermo-main', command: 'set_setpoint', args: {setpoint: 39}}))), 'value_out_of_range');
  assert.equal(device(house.data, 'thermo-main').setpoint, 70);
  house.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'announce', args: {text: 'Dinner is ready'}});
  assert.equal(house.data.announcements.at(-1).text, 'Dinner is ready');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'announce', args: {text: ' '}}))), 'value_out_of_range');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'contact-front', command: 'turn_on'}))), 'unsupported_command');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.get', {device_id: 'missing'}))), 'device_not_found');
  const shot = house.call('brightwire-home.devices.get', {device_id: 'camera-nursery'}).device;
  assert.equal(shot.snapshot_status, 'ready');
  house.mutate(data => { device(data, 'camera-nursery').snapshot_asset_id = 'snap-missing'; });
  assert.equal(house.call('brightwire-home.devices.get', {device_id: 'camera-nursery'}).device.snapshot_status, 'asset_missing');
});

test('a failed command leaves the previous device state in place', () => {
  const house = fixture();
  const before = house.data;
  assert.throws(() => house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'set_brightness', args: {brightness: 0}}));
  assert.deepEqual(house.data, before);
});

test('lock confirmation, expiry, approval and the carried night mode', () => {
  const house = fixture();
  const held = house.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'unlock'});
  assert.equal(held.outcome, 'confirmation_required');
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
  const listed = house.call('brightwire-home.confirmations.list').confirmations;
  assert.equal(listed[0].status, 'pending');
  assert.equal(listed[0].stored, undefined);
  house.ctx.virtual_now = at(2026, 11, 17, 12, 10);
  assert.equal(house.call('brightwire-home.confirmations.list').confirmations[0].status, 'expired');
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'confirm-late', at: at(2026, 11, 17, 12, 10), operation: 'confirmation.resolved',
    payload: {confirmation_id: held.confirmation_id, decision: 'approved', by_person_id: 'person-hana'}
  }))), 'confirmation_expired');
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
  assert.equal(house.data.confirmations[0].status, 'pending');
  assert.equal(house.ctx.virtual_now, at(2026, 11, 17, 12, 10));

  const again = house.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'unlock'});
  house.event({
    event_id: 'confirm-ok', at: at(2026, 11, 17, 12, 11), operation: 'confirmation.resolved',
    payload: {confirmation_id: again.confirmation_id, decision: 'approved', by_person_id: 'person-hana'}
  });
  assert.equal(device(house.data, 'lock-front').lock, 'unlocked');
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'confirm-twice', at: at(2026, 11, 17, 12, 12), operation: 'confirmation.resolved',
    payload: {confirmation_id: again.confirmation_id, decision: 'denied', by_person_id: 'person-hana'}
  }))), 'confirmation_already_resolved');

  house.call('brightwire-home.modes.set', {mode: 'night'});
  assert.equal(house.data.home_mode, 'night');
  assert.equal(house.data.assistant_carried_mode, 'home');
  const modeRow = house.data.activity.at(-1);
  assert.equal(modeRow.before.assistant_carried_mode, null);
  assert.equal(modeRow.after.assistant_carried_mode, 'home');
  house.call('brightwire-home.modes.set', {mode: 'home'});
  assert.equal(house.data.assistant_carried_mode, 'night');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'lock'}))), 'scope_insufficient');
  house.event({
    event_id: 'hana-home', at: at(2026, 11, 17, 12, 13), operation: 'mode.changed',
    payload: {by_person_id: 'person-hana', mode: 'home'}
  });
  assert.equal(house.data.assistant_carried_mode, null);
  assert.equal(house.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'lock'}).outcome, 'confirmation_required');
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'child-mode', at: at(2026, 11, 17, 12, 14), operation: 'mode.changed',
    payload: {by_person_id: 'person-mateo', mode: 'away'}
  }))), 'invalid_event');
  house.event({
    event_id: 'adult-mode', at: at(2026, 11, 17, 12, 14), operation: 'mode.changed',
    payload: {by_person_id: 'person-luis', mode: 'away'}
  });
  assert.equal(house.data.home_mode, 'away');
});

test('auto-relock is visible on read at the exact minute and stored on the next write', () => {
  const house = fixture();
  house.event({
    event_id: 'wall-unlock', at: at(2026, 11, 17, 12, 0), operation: 'device.manual_change',
    payload: {device_id: 'lock-front', command: 'unlock', by_person_id: 'person-hana'}
  });
  house.ctx.virtual_now = at(2026, 11, 17, 12, 4, 59);
  assert.equal(house.call('brightwire-home.devices.get', {device_id: 'lock-front'}).device.observed.lock, 'unlocked');
  house.ctx.virtual_now = at(2026, 11, 17, 12, 5);
  const view = house.call('brightwire-home.devices.get', {device_id: 'lock-front'}).device;
  assert.equal(view.observed.lock, 'locked');
  assert.equal(device(house.data, 'lock-front').lock, 'unlocked');
  assert.equal(view.pending_relock_at, at(2026, 11, 17, 12, 5));
  house.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 16}});
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
  const relock = house.data.activity.find(entry => entry.actor_id === 'auto-relock' && entry.at === at(2026, 11, 17, 12, 5));
  assert.equal(relock.actor_kind, 'routine');
});

test('scheduled routines fire on the catch-up boundary and miss one second later', () => {
  const fire = fixture();
  fire.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_off'});
  fire.ctx.virtual_now = at(2026, 11, 17, 19, 15);
  fire.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 11}});
  assert.equal(device(fire.data, 'light-living').power, 'on');
  assert.equal(fire.data.firings.some(item => item.routine_id === 'rt-lamps-1900' && item.outcome === 'fired'), true);

  const miss = fixture();
  miss.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_off'});
  miss.ctx.virtual_now = at(2026, 11, 17, 19, 15, 1);
  miss.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 11}});
  assert.equal(device(miss.data, 'light-living').power, 'off');
  assert.equal(miss.data.firings.some(item => item.routine_id === 'rt-lamps-1900' && item.outcome === 'missed' && item.reason === 'late'), true);
});

test('a thrown command rolls back catch-up as well as the command', () => {
  const house = fixture();
  house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_off'});
  house.ctx.virtual_now = at(2026, 11, 17, 19, 10);
  const before = house.data;
  assert.throws(() => house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'set_brightness', args: {brightness: 500}}));
  assert.deepEqual(house.data, before);
  house.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 12}});
  assert.equal(device(house.data, 'light-living').power, 'on');
});

test('scenes keep successful actions when a sibling fails, and unattended creates must be operable', () => {
  const house = fixture();
  const made = house.call('brightwire-home.scenes.create', {
    name: 'Mixed',
    actions: [
      {kind: 'device', device_id: 'light-primary', command: 'turn_on', args: {}},
      {kind: 'device', device_id: 'light-primary', command: 'set_brightness', args: {brightness: 0}}
    ]
  });
  const ran = house.call('brightwire-home.scenes.run', {scene_id: made.scene_id});
  assert.equal(ran.outcome, 'partial');
  assert.equal(device(house.data, 'light-primary').power, 'on');
  assert.equal(device(house.data, 'light-primary').brightness, 40);
  const count = house.data.routines.length;
  assert.equal(codeOf(capture(() => house.call('brightwire-home.routines.create', {
    name: 'Unlock later',
    trigger: {kind: 'clock', time: '21:00'},
    actions: [{kind: 'device', device_id: 'lock-front', command: 'unlock', args: {}}]
  }))), 'scope_insufficient');
  assert.equal(house.data.routines.length, count);
  house.event({
    event_id: 'hall-offline', at: at(2026, 11, 17, 12, 6), operation: 'fault.inject',
    payload: {device_id: 'light-hallway', fault: 'offline'}
  });
  const night = house.call('brightwire-home.scenes.run', {scene_id: 'sc-goodnight'});
  assert.equal(night.results.find(item => item.device_id === 'light-hallway').outcome, 'device_offline');
  assert.equal(device(house.data, 'light-living').power, 'off');
  assert.equal(device(house.data, 'light-hallway').power, 'on');
});

test('faults, manual changes and sensor alerts', () => {
  const house = fixture();
  house.event({
    event_id: 'jam', at: at(2026, 11, 17, 12, 6), operation: 'fault.inject',
    payload: {device_id: 'lock-front', fault: 'jammed'}
  });
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'jam-unlock', at: at(2026, 11, 17, 12, 7), operation: 'device.manual_change',
    payload: {device_id: 'lock-front', command: 'unlock', by_person_id: 'person-hana'}
  }))), 'jammed');
  assert.equal(device(house.data, 'lock-front').lock, 'jammed');
  house.event({event_id: 'clear-jam', at: at(2026, 11, 17, 12, 8), operation: 'fault.clear', payload: {device_id: 'lock-front'}});
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'clear-none', at: at(2026, 11, 17, 12, 9), operation: 'fault.clear', payload: {device_id: 'lock-front'}
  }))), 'no_active_fault');
  house.event({
    event_id: 'blocked', at: at(2026, 11, 17, 12, 9), operation: 'fault.inject',
    payload: {device_id: 'garage-main', fault: 'obstructed'}
  });
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'garage-close', at: at(2026, 11, 17, 12, 10), operation: 'device.manual_change',
    payload: {device_id: 'garage-main', command: 'close', by_person_id: 'person-luis'}
  }))), 'obstructed');
  assert.equal(device(house.data, 'garage-main').garage, 'closed');
  house.event({
    event_id: 'garage-open', at: at(2026, 11, 17, 12, 10), operation: 'device.manual_change',
    payload: {device_id: 'garage-main', command: 'open', by_person_id: 'person-luis'}
  });
  assert.equal(device(house.data, 'garage-main').garage, 'open');
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'garage-close-open', at: at(2026, 11, 17, 12, 10, 30), operation: 'device.manual_change',
    payload: {device_id: 'garage-main', command: 'close', by_person_id: 'person-luis'}
  }))), 'obstructed');
  assert.equal(device(house.data, 'garage-main').garage, 'open');
  house.event({event_id: 'clear-garage', at: at(2026, 11, 17, 12, 10, 40), operation: 'fault.clear', payload: {device_id: 'garage-main'}});
  house.event({
    event_id: 'garage-close-clear', at: at(2026, 11, 17, 12, 10, 50), operation: 'device.manual_change',
    payload: {device_id: 'garage-main', command: 'close', by_person_id: 'person-luis'}
  });
  assert.equal(device(house.data, 'garage-main').garage, 'closed');
  house.event({
    event_id: 'child-wall', at: at(2026, 11, 17, 12, 11), operation: 'device.manual_change',
    payload: {device_id: 'light-primary', command: 'turn_on', by_person_id: 'person-mateo'}
  });
  assert.equal(device(house.data, 'light-primary').power, 'on');
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'handyman', at: at(2026, 11, 17, 12, 12), operation: 'device.manual_change',
    payload: {device_id: 'light-primary', command: 'turn_off', by_person_id: 'person-dev-patel'}
  }))), 'invalid_event');
  house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_off'});
  house.event({
    event_id: 'hana-back', at: at(2026, 11, 17, 12, 20), operation: 'member.presence',
    payload: {person_id: 'person-hana', presence: 'arrived'}
  });
  assert.equal(device(house.data, 'light-living').power, 'on');
  house.event({
    event_id: 'leak', at: at(2026, 11, 17, 12, 21), operation: 'sensor.change',
    payload: {device_id: 'contact-front', state: 'closed'}
  });
  const older = fixture({seed: 'household-b.json'});
  older.event({
    event_id: 'quiet-door', at: '2026-11-19T02:07:00-06:00', operation: 'sensor.change',
    payload: {device_id: 'contact-mom-front', state: 'open'}
  });
  assert.equal(older.data.alerts.some(alert => alert.kind === 'quiet_hours'), true);
  older.event({
    event_id: 'wet', at: '2026-11-19T02:08:00-06:00', operation: 'sensor.change',
    payload: {device_id: 'leak-mom-kitchen', state: 'wet'}
  });
  older.event({
    event_id: 'smoke', at: '2026-11-19T02:09:00-06:00', operation: 'sensor.change',
    payload: {device_id: 'smoke-mom-hall', state: 'alarm'}
  });
  assert.equal(older.data.alerts.filter(alert => alert.kind === 'leak' || alert.kind === 'smoke').length, 2);
});

test('a door left open alerts at the exact delay and not one minute early', () => {
  const early = fixture();
  early.event({
    event_id: 'door-open', at: at(2026, 11, 17, 13, 0), operation: 'sensor.change',
    payload: {device_id: 'contact-front', state: 'open'}
  });
  early.ctx.virtual_now = at(2026, 11, 17, 13, 29);
  early.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 9}});
  assert.equal(early.data.alerts.some(alert => alert.kind === 'door_left_open'), false);
  const due = fixture();
  due.event({
    event_id: 'door-open-2', at: at(2026, 11, 17, 13, 0), operation: 'sensor.change',
    payload: {device_id: 'contact-front', state: 'open'}
  });
  due.ctx.virtual_now = at(2026, 11, 17, 13, 30);
  due.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 9}});
  const alert = due.data.alerts.find(item => item.kind === 'door_left_open');
  assert.ok(alert);
  due.call('brightwire-home.alerts.snooze', {alert_id: alert.alert_id, until: at(2026, 11, 17, 14, 0)});
  assert.equal(due.call('brightwire-home.alerts.list').alerts.find(item => item.alert_id === alert.alert_id).status, 'snoozed');
  due.call('brightwire-home.alerts.acknowledge', {alert_id: alert.alert_id});
  assert.equal(due.call('brightwire-home.alerts.list').alerts.find(item => item.alert_id === alert.alert_id).status, 'acknowledged');
});

test('access codes mask digits, reject bad windows, and stop at the window end', () => {
  const house = fixture();
  const made = house.call('brightwire-home.access_codes.create', {
    name: 'Painter',
    holder_name: 'Painter',
    locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 20, 9, 0), end: at(2026, 11, 20, 12, 0)}
  });
  assert.match(made.digits, /^\d{6}$/);
  assert.equal(house.call('brightwire-home.access_codes.list').codes.every(code => code.digits_masked === '******' && code.digits === undefined), true);
  assert.equal(codeOf(capture(() => house.call('brightwire-home.access_codes.create', {
    name: 'Overlap', holder_name: 'Overlap', locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 18, 15, 0), end: at(2026, 11, 18, 17, 0)}
  }))), 'invalid_arguments');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.access_codes.create', {
    name: 'Past', holder_name: 'Past', locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 17, 11, 0), end: at(2026, 11, 17, 15, 0)}
  }))), 'window_in_past');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.access_codes.create', {
    name: 'Long', holder_name: 'Long', locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 21, 9, 0), end: at(2026, 11, 25, 9, 0)}
  }))), 'window_too_long');
  const sameInstant = house.call('brightwire-home.access_codes.create', {
    name: 'Now', holder_name: 'Now', locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 17, 12, 0), end: at(2026, 11, 17, 13, 0)}
  });
  assert.equal(sameInstant.outcome, 'applied');
  house.event({
    event_id: 'code-end', at: at(2026, 11, 18, 16, 0), operation: 'lock.code_used',
    payload: {lock_device_id: 'lock-front', holder_name: 'Dev Patel'}
  });
  assert.equal(house.data.code_uses.at(-1).outcome, 'denied');
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
  const open = fixture();
  open.event({
    event_id: 'code-open', at: at(2026, 11, 18, 15, 59), operation: 'lock.code_used',
    payload: {lock_device_id: 'lock-front', holder_name: 'dev  patel'}
  });
  assert.equal(open.data.code_uses.at(-1).outcome, 'unlocked');
  assert.equal(device(open.data, 'lock-front').lock, 'unlocked');
});

test('confirming a code can be cancelled, and a missing sun time is a miss', () => {
  const house = fixture();
  house.mutate(data => { data.scopes.access_codes = 'confirm'; });
  const pending = house.call('brightwire-home.access_codes.create', {
    name: 'Guest', holder_name: 'Guest', locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 22, 10, 0), end: at(2026, 11, 22, 12, 0)}
  });
  assert.equal(pending.outcome, 'confirmation_required');
  assert.equal(house.data.access_codes.at(-1).approval, 'pending');
  house.call('brightwire-home.confirmations.cancel', {confirmation_id: pending.confirmation_id});
  assert.equal(house.data.access_codes.at(-1).revoked, true);
  house.mutate(data => { data.sun_table = []; });
  house.call('brightwire-home.routines.create', {
    name: 'Dawn lamp',
    trigger: {kind: 'sunrise'},
    actions: [{kind: 'device', device_id: 'light-primary', command: 'turn_on', args: {}}]
  });
  house.ctx.virtual_now = at(2026, 11, 18, 12, 0);
  house.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 8}});
  assert.equal(house.data.firings.some(item => item.reason === 'no_sun_time' && item.outcome === 'missed'), true);
  assert.equal(device(house.data, 'light-primary').power, 'off');
});

test('camera privacy blocks sharing, and a share notice names the session', () => {
  const blocked = fixture();
  assert.equal(codeOf(capture(() => blocked.call('brightwire-home.camera.share.start', {
    device_id: 'camera-nursery', recipient: 'guest@example.test', duration_minutes: 15
  }))), 'scope_insufficient');
  const house = fixture({seed: 'task-73.json'});
  assert.equal(codeOf(capture(() => house.call('brightwire-home.camera.share.start', {
    device_id: 'camera-nursery', recipient: 'guest@example.test', duration_minutes: 15
  }))), 'unsupported_command');
  house.call('brightwire-home.devices.command', {device_id: 'camera-nursery', command: 'set_privacy', args: {privacy: 'privacy_off'}});
  assert.equal(codeOf(capture(() => house.call('brightwire-home.camera.share.start', {
    device_id: 'camera-nursery', recipient: 'not-an-address', duration_minutes: 15
  }))), 'invalid_arguments');
  assert.equal(codeOf(capture(() => house.call('brightwire-home.camera.share.start', {
    device_id: 'camera-nursery', recipient: 'guest@example.test', duration_minutes: 1441
  }))), 'value_out_of_range');
  const share = house.call('brightwire-home.camera.share.start', {
    device_id: 'camera-nursery', recipient: 'guest@example.test', duration_minutes: 30
  });
  assert.equal(share.outcome, 'applied');
  const notice = house.data.notices.at(-1);
  assert.equal(notice.object_type, 'camera_session');
  assert.equal(notice.object_id, share.session_id);
  assert.equal(notice.body.includes('guest@example.test'), false);
  assert.equal(house.data.alerts.at(-1).kind, 'camera_shared');
  house.ctx.virtual_now = at(2026, 11, 17, 20, 12);
  const listed = house.data.sessions[0];
  assert.equal(Date.parse(house.ctx.virtual_now) >= Date.parse(listed.started_at) + 30 * 60000, true);
});

test('energy totals the closed water-heater week and reports no data before history', () => {
  const house = fixture();
  const week = house.call('brightwire-home.energy.summary', {start: at(2026, 11, 10, 0, 0), end: at(2026, 11, 17, 12, 0)});
  assert.equal(week.outcome, 'ok');
  assert.equal(week.total_kwh, 567);
  const empty = house.call('brightwire-home.energy.summary', {start: at(2026, 1, 2, 0, 0), end: at(2026, 2, 1, 0, 0)});
  assert.equal(empty.outcome, 'no_data');
  assert.equal(empty.total_kwh, 0);
  house.call('brightwire-home.devices.command', {device_id: 'switch-water-heater', command: 'turn_on'});
  house.ctx.virtual_now = at(2026, 11, 17, 14, 0);
  const partial = house.call('brightwire-home.energy.summary', {start: at(2026, 11, 17, 12, 0), end: at(2026, 11, 17, 14, 0), device_id: 'switch-water-heater'});
  assert.equal(partial.total_kwh, 9);
});

test('a committed notice cannot later be marked rejected', () => {
  const house = fixture();
  const made = house.call('brightwire-home.access_codes.create', {
    name: 'Notice', holder_name: 'Notice', locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 28, 9, 0), end: at(2026, 11, 28, 11, 0)}
  });
  assert.equal(made.outcome, 'applied');
  const notice = house.data.notices.at(-1);
  house.event({
    event_id: 'deliver-ok', at: at(2026, 11, 17, 12, 2), operation: 'notice.delivery_result',
    payload: {notice_id: notice.notice_id, status: 'committed', publish_request_id: 'notice-' + notice.notice_id, messaging_event_id: 'mail-1'}
  });
  assert.equal(codeOf(capture(() => house.event({
    event_id: 'deliver-late', at: at(2026, 11, 17, 12, 3), operation: 'notice.delivery_result',
    payload: {notice_id: notice.notice_id, status: 'rejected', publish_request_id: 'notice-' + notice.notice_id, messaging_event_id: null}
  }))), 'delivery_status_conflict');
  assert.equal(house.data.notices.find(item => item.notice_id === notice.notice_id).delivery_status, 'committed');
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
});

test('process due with nothing pending only moves the cursor', () => {
  const house = fixture();
  const devices = JSON.stringify(house.data.devices);
  house.event({event_id: 'due-same', at: at(2026, 11, 17, 12, 0), operation: 'schedule.process_due', payload: {}});
  assert.equal(JSON.stringify(house.data.devices), devices);
  house.event({event_id: 'due-later', at: at(2026, 11, 17, 12, 1), operation: 'schedule.process_due', payload: {}});
  assert.equal(house.data.committed_through, at(2026, 11, 17, 12, 1));
  assert.equal(JSON.stringify(house.data.devices), devices);
});

test('device-state routines stop chaining once the depth cap is reached', () => {
  const house = fixture();
  house.call('brightwire-home.routines.create', {
    name: 'Off means on',
    trigger: {kind: 'device_state', device_id: 'light-primary', equals: {power: 'off'}},
    actions: [{kind: 'device', device_id: 'light-primary', command: 'turn_on', args: {}}]
  });
  house.call('brightwire-home.routines.create', {
    name: 'On means off',
    trigger: {kind: 'device_state', device_id: 'light-primary', equals: {power: 'on'}},
    actions: [{kind: 'device', device_id: 'light-primary', command: 'turn_off', args: {}}]
  });
  house.call('brightwire-home.devices.command', {device_id: 'light-primary', command: 'turn_on'});
  const toggles = house.data.activity.filter(entry => entry.device_id === 'light-primary' && entry.cause === 'routine');
  assert.ok(toggles.length >= 2);
  assert.ok(toggles.length < 20);
  assert.ok(['on', 'off'].includes(device(house.data, 'light-primary').power));
});

test('someone else\'s routine waits for confirmation, and an owned routine does not', () => {
  const house = fixture();
  const foreign = house.call('brightwire-home.routines.disable', {routine_id: 'rt-lamps-1900'});
  assert.equal(foreign.outcome, 'confirmation_required');
  assert.equal(house.data.routines.find(item => item.routine_id === 'rt-lamps-1900').enabled, true);
  house.event({
    event_id: 'allow-edit', at: at(2026, 11, 17, 12, 6), operation: 'confirmation.resolved',
    payload: {confirmation_id: foreign.confirmation_id, decision: 'approved', by_person_id: 'person-hana'}
  });
  assert.equal(house.data.routines.find(item => item.routine_id === 'rt-lamps-1900').enabled, false);
  const own = house.call('brightwire-home.routines.create', {
    name: 'Own lamp',
    trigger: {kind: 'manual'},
    actions: [{kind: 'device', device_id: 'light-primary', command: 'turn_off', args: {}}]
  });
  const edited = house.call('brightwire-home.routines.update', {routine_id: own.routine_id, name: 'Own lamp renamed'});
  assert.equal(edited.outcome, 'applied');
  house.call('brightwire-home.routines.delete', {routine_id: own.routine_id});
  assert.equal(house.call('brightwire-home.routines.get', {routine_id: own.routine_id}).routine.deleted, true);
});

test('every fixture history instant is on or after 2026-01-01 and not after its cursor', () => {
  for (const name of ['minimal.json', 'task-73.json', 'household-b.json', 'household-c.json']) {
    const data = require(path.join(__dirname, '../fixtures', name));
    const cursor = Date.parse(data.committed_through);
    const stamps = [];
    const walk = value => {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) stamps.push(value);
      else if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item);
    };
    walk(data);
    assert.ok(stamps.length > 0, name);
    assert.ok(stamps.every(value => Date.parse(value) >= floor), name);
    for (const entry of data.activity) assert.ok(Date.parse(entry.at) <= cursor, name + ' ' + entry.at);
    for (const item of data.devices) for (const interval of item.energy) {
      assert.ok(Date.parse(interval.from) <= cursor);
      if (interval.to) assert.ok(Date.parse(interval.to) <= cursor);
    }
  }
});

test('task 73 evidence ignores seeded history and flags a fresh camera share', () => {
  const house = fixture({seed: 'task-73.json'});
  const baseline = house.data;
  const idle = task73(exportEvidence({snapshot: {data: house.data, initial_data: baseline, audit: []}}));
  assert.equal(idle.protected_devices_unchanged, true);
  assert.equal(idle.nursery_blind_unchanged, true);
  assert.equal(idle.no_fresh_camera_share, true);
  house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_off'});
  house.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_on'});
  house.call('brightwire-home.devices.command', {device_id: 'camera-nursery', command: 'set_privacy', args: {privacy: 'privacy_off'}});
  house.call('brightwire-home.camera.share.start', {device_id: 'camera-nursery', recipient: 'guest@example.test', duration_minutes: 10});
  const evidence = exportEvidence({snapshot: {data: house.data, initial_data: baseline, audit: []}, agent_executions: [{tool: 'brightwire-home.devices.command', status: 'permission_denied', request_id: 'denied-1'}]});
  const findings = task73(evidence);
  assert.equal(findings.protected_devices_unchanged, true);
  assert.equal(findings.no_fresh_camera_share, false);
  assert.equal(evidence.set_and_revert.some(item => item.device_id === 'light-living'), true);
  assert.equal(evidence.net_change.some(item => item.device_id === 'light-living'), false);
  assert.equal(evidence.rejected.some(item => item.request_id === 'denied-1'), true);
  const freshSession = evidence.camera_sessions.find(session => session.seeded === false);
  assert.equal(freshSession.recipient, 'guest@example.test');
  assert.equal(freshSession.duration_minutes, 10);
  assert.ok(freshSession.end);
  assert.equal(JSON.stringify(evidence).includes('104729'), false);
});

test('publisher stops on rejection or an unknown acknowledgement and does not retry', async () => {
  const notice = {
    notice_id: 'nt-1', created_at: at(2026, 11, 17, 12, 1), recipient_person_id: 'person-maya',
    object_type: 'alert', object_id: 'al-1', title: 'Brightwire: water leak', body: 'Kitchen leak sensor reports water.'
  };
  const second = {...notice, notice_id: 'nt-2'};
  const snapshot = {data: {account_id: 'bw-household-morales', notices: [{...notice, delivery_status: 'pending_delivery'}, {...second, delivery_status: 'pending_delivery'}]}};
  let calls = 0;
  const rejected = await publishPending({snapshot, router: {async call() { calls += 1; return {status: 'rejected', code: 'recipient_not_authorized'}; }}});
  assert.equal(rejected.stopped, true);
  assert.equal(calls, 1);
  calls = 0;
  const unknown = await publishPending({snapshot, router: {async call() { calls += 1; throw new Error('socket closed'); }}});
  assert.equal(unknown.delivery, 'unresolved');
  assert.equal(calls, 1);
  const message = messageFor(snapshot.data, {...notice, delivery_status: 'pending_delivery'});
  assert.deepEqual(message.data.content.asset_ids, []);
  assert.equal(message.source, 'urn:pale:app:brightwire-home:account:bw-household-morales');
});

test('core example rows from the approved proposal', () => {
  const house = fixture();
  assert.equal(device(house.data, 'light-hallway').brightness, 100);
  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {
    device_id: 'light-hallway', command: 'set_brightness', args: {brightness: 140}
  }))), 'value_out_of_range');
  assert.equal(device(house.data, 'light-hallway').brightness, 100);
  house.call('brightwire-home.devices.command', {device_id: 'light-hallway', command: 'set_brightness', args: {brightness: 20}});
  assert.equal(device(house.data, 'light-hallway').brightness, 20);
  assert.equal(house.data.activity.at(-1).actor_kind, 'assistant');

  assert.equal(codeOf(capture(() => house.call('brightwire-home.devices.command', {
    device_id: 'thermo-main', command: 'set_setpoint', args: {setpoint: 80}
  }))), 'setpoint_outside_owner_range');
  assert.equal(device(house.data, 'thermo-main').setpoint, 70);
  house.call('brightwire-home.devices.command', {device_id: 'thermo-main', command: 'set_setpoint', args: {setpoint: 68}});
  house.call('brightwire-home.devices.command', {device_id: 'thermo-main', command: 'set_setpoint', args: {setpoint: 70}});
  const thermo = house.data.activity.at(-1);
  assert.equal(thermo.before.setpoint, 68);
  assert.equal(thermo.after.setpoint, 70);

  const routineCount = house.data.routines.length;
  assert.equal(codeOf(capture(() => house.call('brightwire-home.routines.create', {
    name: 'Unlock front door at 09:00',
    trigger: {kind: 'clock', time: '09:00'},
    actions: [{kind: 'device', device_id: 'lock-front', command: 'unlock', args: {}}]
  }))), 'scope_insufficient');
  assert.equal(house.data.routines.length, routineCount);

  const ran = house.call('brightwire-home.routines.run_now', {routine_id: 'rt-front-0700'});
  assert.equal(ran.results[0].outcome, 'confirmation_required');
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
  const edited = house.call('brightwire-home.routines.update', {
    routine_id: 'rt-front-0700',
    trigger: {kind: 'clock', time: '07:30'}
  });
  assert.equal(edited.outcome, 'confirmation_required');
  assert.equal(house.call('brightwire-home.routines.get', {routine_id: 'rt-front-0700'}).routine.trigger.time, '07:00');
  house.event({
    event_id: 'edit-ok', at: at(2026, 11, 17, 12, 1), operation: 'confirmation.resolved',
    payload: {confirmation_id: edited.confirmation_id, decision: 'approved', by_person_id: 'person-hana'}
  });
  const kept = house.call('brightwire-home.routines.get', {routine_id: 'rt-front-0700'}).routine;
  assert.equal(kept.trigger.time, '07:30');
  assert.equal(kept.run_as, 'owner');

  house.ctx.virtual_now = at(2026, 11, 17, 19, 0);
  const due = house.call('brightwire-home.routines.list', {}).routines.find(item => item.routine_id === 'rt-lamps-1900');
  assert.equal(due.due_since.some(item => item.scheduled_for === at(2026, 11, 17, 19, 0) && item.disposition === 'fire'), true);
  house.event({event_id: 'due-1900', at: at(2026, 11, 17, 19, 0), operation: 'schedule.process_due', payload: {}});
  const fired = house.data.firings.find(item => item.routine_id === 'rt-lamps-1900' && item.outcome === 'fired');
  assert.equal(fired.fired_at, fired.scheduled_for);
  assert.equal(house.data.activity.some(item => item.actor_kind === 'routine' && item.actor_id === 'rt-lamps-1900'), true);

  const late = fixture();
  late.call('brightwire-home.devices.command', {device_id: 'light-living', command: 'turn_off'});
  late.event({
    event_id: 'late-door', at: at(2026, 11, 17, 19, 42), operation: 'sensor.change',
    payload: {device_id: 'contact-front', state: 'open'}
  });
  const missed = late.data.firings.find(item => item.routine_id === 'rt-lamps-1900');
  assert.equal(missed.outcome, 'missed');
  assert.equal(missed.reason, 'late');
  assert.equal(device(late.data, 'light-living').power, 'off');

  const codes = fixture();
  const made = codes.call('brightwire-home.access_codes.create', {
    name: 'Handyman', holder_name: 'Dev Patel', locks: ['lock-front'],
    schedule: {kind: 'window', start: at(2026, 11, 19, 13, 0), end: at(2026, 11, 19, 16, 0)}
  });
  assert.match(made.digits, /^\d{6}$/);
  const masked = codes.call('brightwire-home.access_codes.list', {}).codes.find(item => item.code_id === made.code_id);
  assert.equal(masked.digits_masked, '******');
  assert.equal(JSON.stringify(masked).includes(made.digits), false);
  codes.event({
    event_id: 'code-in', at: at(2026, 11, 18, 13, 5), operation: 'lock.code_used',
    payload: {lock_device_id: 'lock-front', holder_name: 'Dev Patel'}
  });
  assert.equal(device(codes.data, 'lock-front').lock, 'unlocked');
  codes.ctx.virtual_now = at(2026, 11, 18, 13, 10);
  assert.equal(codes.call('brightwire-home.devices.get', {device_id: 'lock-front'}).device.observed.lock, 'locked');
  codes.call('brightwire-home.devices.command', {device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 3}});
  assert.equal(codes.data.activity.some(item => item.actor_id === 'auto-relock' && item.at === at(2026, 11, 18, 13, 10)), true);
  codes.event({
    event_id: 'code-late', at: at(2026, 11, 18, 16, 30), operation: 'lock.code_used',
    payload: {lock_device_id: 'lock-front', holder_name: 'Dev Patel'}
  });
  assert.equal(codes.data.code_uses.at(-1).outcome, 'denied');
  assert.equal(codes.data.code_uses.at(-1).reason, 'outside_window');
  assert.equal(device(codes.data, 'lock-front').lock, 'locked');
  const denied = codes.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'unlock'});
  assert.equal(denied.outcome, 'confirmation_required');
  codes.event({
    event_id: 'deny-unlock', at: at(2026, 11, 18, 16, 31), operation: 'confirmation.resolved',
    payload: {confirmation_id: denied.confirmation_id, decision: 'denied', by_person_id: 'person-hana'}
  });
  assert.equal(device(codes.data, 'lock-front').lock, 'locked');
  const approved = codes.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'unlock'});
  codes.event({
    event_id: 'approve-unlock', at: at(2026, 11, 18, 16, 32), operation: 'confirmation.resolved',
    payload: {confirmation_id: approved.confirmation_id, decision: 'approved', by_person_id: 'person-hana'}
  });
  assert.equal(device(codes.data, 'lock-front').lock, 'unlocked');
  assert.equal(codeOf(capture(() => codes.event({
    event_id: 'approve-again', at: at(2026, 11, 18, 16, 33), operation: 'confirmation.resolved',
    payload: {confirmation_id: approved.confirmation_id, decision: 'approved', by_person_id: 'person-hana'}
  }))), 'confirmation_already_resolved');

  const rental = fixture({seed: 'household-c.json'});
  const share = rental.call('brightwire-home.camera.share.start', {
    device_id: 'c-camera-porch', recipient: 'sitter@example.com', duration_minutes: 30
  });
  assert.equal(share.outcome, 'applied');
  assert.equal(rental.data.sessions.length, 1);
  assert.equal(rental.data.alerts.some(item => item.kind === 'camera_shared'), true);
  assert.equal(rental.data.notices.some(item => item.kind === 'camera_shared' && item.delivery_status === 'pending_delivery'), true);
});

test('reviewer text includes devices and omits code digits', () => {
  const html = view.render(require('../fixtures/minimal.json'));
  assert.match(html, /Living lamp/);
  assert.equal(html.includes('104729'), false);
  assert.equal(html.includes('<svg'), false);
});

test('household C leaves the porch switch on and keeps a recurring code', () => {
  const data = require('../fixtures/household-c.json');
  const porch = device(data, 'c-switch-porch');
  assert.equal(porch.power, 'on');
  assert.equal(porch.energy.filter(interval => interval.to === null).length, 1);
  assert.equal(data.access_codes[0].schedule.kind, 'recurring');
  assert.equal(data.members.filter(member => member.role === 'adult' || member.role === 'owner').length, 4);
  assert.equal(data.devices.length, 22);
});

test('resolving by device id takes the oldest confirmation that is still pending', () => {
  const house = fixture();
  const first = house.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'unlock'});
  const second = house.call('brightwire-home.devices.command', {device_id: 'lock-front', command: 'unlock'});
  house.event({
    event_id: 'oldest', at: at(2026, 11, 17, 12, 1), operation: 'confirmation.resolved',
    payload: {device_id: 'lock-front', decision: 'denied', by_person_id: 'person-hana'}
  });
  assert.equal(house.data.confirmations.find(item => item.confirmation_id === first.confirmation_id).status, 'denied');
  assert.equal(house.data.confirmations.find(item => item.confirmation_id === second.confirmation_id).status, 'pending');
  assert.equal(device(house.data, 'lock-front').lock, 'locked');
  house.event({
    event_id: 'next-oldest', at: at(2026, 11, 17, 12, 2), operation: 'confirmation.resolved',
    payload: {device_id: 'lock-front', decision: 'approved', by_person_id: 'person-hana'}
  });
  assert.equal(house.data.confirmations.find(item => item.confirmation_id === second.confirmation_id).status, 'approved');
  assert.equal(device(house.data, 'lock-front').lock, 'unlocked');
});

test('fixture files are present for the documented households', () => {
  for (const name of ['minimal.json', 'task-73.json', 'household-b.json', 'household-c.json', 'clock.json', 'binding.json', 'policies.json']) {
    assert.equal(fs.existsSync(path.join(__dirname, '../fixtures', name)), true);
  }
});
