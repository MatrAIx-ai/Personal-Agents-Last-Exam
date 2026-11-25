'use strict';
// Rebuilds committed schemas, tool declarations, household fixtures and reviewer images.
// Run from the package directory: node scripts/materialize.cjs

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {canvas, png, jpeg} = require('./raster.cjs');
const time = require('../src/time.cjs');
const {project} = require('../src/house.cjs');

const root = path.resolve(__dirname, '..');
const OFFSET = '-06:00';
const ID = '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$';
const CLOCK = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function id() { return {type: 'string', pattern: ID}; }
function dt() { return {type: 'string', format: 'date-time'}; }
function nil(schema) { return {anyOf: [schema, {type: 'null'}]}; }
function obj(properties, required = Object.keys(properties)) {
  return {type: 'object', properties, required, additionalProperties: false};
}
function arr(items) { return {type: 'array', items}; }
function enumOf(values) { return {enum: values}; }

const version = obj({
  epoch: {type: 'integer', minimum: 1},
  revision: {type: 'integer', minimum: 0}
});

const commandArgs = obj({
  brightness: {type: 'integer'},
  color_temperature: {type: 'integer'},
  position: {type: 'integer'},
  mode: {type: 'string'},
  setpoint: {type: 'number'},
  privacy: {type: 'string'},
  volume: {type: 'integer'},
  text: {type: 'string'}
}, []);

const action = obj({
  kind: enumOf(['device', 'set_mode']),
  device_id: id(),
  command: {type: 'string', minLength: 1, maxLength: 80},
  args: commandArgs,
  mode: enumOf(['home', 'away', 'night'])
}, ['kind']);

const trigger = obj({
  kind: enumOf(['clock', 'sunrise', 'sunset', 'sensor', 'device_state', 'member_arrives', 'member_leaves', 'manual']),
  time: {type: 'string', pattern: CLOCK},
  device_id: id(),
  state: {type: 'string'},
  person_id: id(),
  equals: {type: 'object'}
}, ['kind']);

const condition = obj({
  kind: enumOf(['time_window', 'home_mode', 'device_state']),
  start: {type: 'string', pattern: CLOCK},
  end: {type: 'string', pattern: CLOCK},
  mode: enumOf(['home', 'away', 'night']),
  device_id: id(),
  equals: {type: 'object'}
}, ['kind']);

const schedule = {
  oneOf: [
    obj({kind: {const: 'always'}}),
    obj({kind: {const: 'window'}, start: dt(), end: dt()}),
    obj({
      kind: {const: 'recurring'},
      days: arr(enumOf(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'])),
      start_time: {type: 'string', pattern: CLOCK},
      end_time: {type: 'string', pattern: CLOCK}
    })
  ]
};

const automationHistory = obj({
  kind: enumOf(['routine', 'scene']),
  id: id(),
  name: {type: 'string'},
  enabled: {type: 'boolean'},
  deleted: {type: 'boolean'},
  run_as: enumOf(['assistant', 'owner']),
  created_by: {type: 'string'},
  created_by_person_id: nil(id()),
  last_edited_by: {type: 'string'},
  actions: arr(action),
  trigger,
  conditions: arr(condition),
  catch_up_minutes: {type: 'integer', minimum: 0, maximum: 180}
}, ['kind', 'id', 'name', 'enabled', 'deleted', 'run_as', 'created_by', 'created_by_person_id', 'last_edited_by']);

const projection = obj({
  type: {type: 'string'},
  power: nil(enumOf(['on', 'off'])),
  brightness: nil({type: 'integer'}),
  color_temperature: nil({type: 'integer'}),
  position: nil({type: 'integer'}),
  thermo_mode: nil(enumOf(['heat', 'cool', 'off'])),
  setpoint: nil({type: 'number'}),
  lock: nil(enumOf(['locked', 'unlocked', 'jammed'])),
  garage: nil(enumOf(['closed', 'open', 'obstructed'])),
  privacy: nil(enumOf(['privacy_on', 'privacy_off'])),
  volume: nil({type: 'integer'}),
  sensor: nil({type: 'string'}),
  sensor_value: nil({type: 'number'}),
  fault: nil(enumOf(['jammed', 'obstructed', 'offline'])),
  online: {type: 'boolean'}
});

const activity = obj({
  activity_id: id(),
  at: dt(),
  actor_kind: enumOf(['assistant', 'member', 'routine', 'manual', 'guest_code']),
  actor_id: {type: 'string', minLength: 1, maxLength: 120},
  caller_role: nil(enumOf(['agent', 'infra'])),
  cause: enumOf(['direct_command', 'routine', 'event', 'confirmation', 'scene', 'guest_code', 'seed']),
  request_id: nil({type: 'string'}),
  event_id: nil(id()),
  device_id: nil(id()),
  command: nil({type: 'string'}),
  summary: {type: 'string', minLength: 1, maxLength: 400},
  before: nil({anyOf: [projection, obj({home_mode: enumOf(['home', 'away', 'night']), assistant_carried_modes: arr(enumOf(['home', 'away', 'night']))}), automationHistory]}),
  after: nil({anyOf: [projection, obj({home_mode: enumOf(['home', 'away', 'night']), assistant_carried_modes: arr(enumOf(['home', 'away', 'night']))}), automationHistory]})
});

const device = obj({
  device_id: id(),
  room_id: id(),
  type: enumOf(['light', 'blind', 'thermostat', 'switch', 'lock', 'garage', 'camera', 'speaker', 'contact', 'motion', 'temperature', 'leak', 'smoke']),
  name: {type: 'string', minLength: 1, maxLength: 120},
  online: {type: 'boolean'},
  fault: nil(enumOf(['jammed', 'obstructed', 'offline'])),
  state_before_fault: nil(obj({
    lock: nil(enumOf(['locked', 'unlocked', 'jammed'])),
    garage: nil(enumOf(['closed', 'open', 'obstructed'])),
    online: {type: 'boolean'},
    fault: nil(enumOf(['jammed', 'obstructed', 'offline']))
  })),
  power: nil(enumOf(['on', 'off'])),
  brightness: nil({type: 'integer', minimum: 1, maximum: 100}),
  color_temperature: nil({type: 'integer', minimum: 2200, maximum: 6500}),
  position: nil({type: 'integer', minimum: 0, maximum: 100}),
  thermo_mode: nil(enumOf(['heat', 'cool', 'off'])),
  setpoint: nil({type: 'number'}),
  current_temperature: nil({type: 'number'}),
  owner_min: nil({type: 'number'}),
  owner_max: nil({type: 'number'}),
  rated_watts: nil({type: 'number', minimum: 0}),
  high_load: {type: 'boolean'},
  lock: nil(enumOf(['locked', 'unlocked', 'jammed'])),
  unlocked_at: nil(dt()),
  auto_relock_minutes: nil({type: 'integer', minimum: 1, maximum: 240}),
  garage: nil(enumOf(['closed', 'open', 'obstructed'])),
  privacy: nil(enumOf(['privacy_on', 'privacy_off'])),
  volume: nil({type: 'integer', minimum: 0, maximum: 100}),
  sensor: nil({type: 'string'}),
  sensor_value: nil({type: 'number'}),
  opened_at: nil(dt()),
  hearth_appliance_id: nil(id()),
  snapshot_asset_id: nil(id()),
  energy: arr(obj({from: dt(), to: nil(dt())})),
  energy_kwh_closed: {type: 'number', minimum: 0}
});

const scope = enumOf(['operate', 'confirm', 'view', 'none']);
const classes = ['light', 'blind', 'thermostat', 'switch', 'lock', 'garage', 'camera', 'speaker', 'automations', 'modes', 'access_codes'];
const scopeProps = {};
for (const name of classes) scopeProps[name] = scope;

const seedSchema = obj({
  account_id: id(),
  household_name: {type: 'string', minLength: 1, maxLength: 160},
  owner_person_id: id(),
  timezone: {type: 'string', minLength: 1, maxLength: 80},
  utc_offset: {type: 'string', pattern: '^[+-][0-9]{2}:[0-9]{2}$'},
  home_mode: enumOf(['home', 'away', 'night']),
  assistant_carried_modes: arr(enumOf(['home', 'away', 'night'])),
  approver_person_ids: arr(id()),
  committed_through: dt(),
  door_open_alert_minutes: {type: 'integer', minimum: 1, maximum: 240},
  quiet_hours: obj({start: {type: 'string', pattern: CLOCK}, end: {type: 'string', pattern: CLOCK}}),
  max_active_codes: {type: 'integer', minimum: 1, maximum: 50},
  max_code_window_hours: {type: 'number', minimum: 1},
  allow_overlapping_codes: {type: 'boolean'},
  scopes: obj(scopeProps),
  mode_rules: arr(obj({mode: enumOf(['home', 'away', 'night']), class: enumOf(classes), scope})),
  members: arr(obj({
    person_id: id(),
    name: {type: 'string', minLength: 1, maxLength: 120},
    role: enumOf(['owner', 'adult', 'child', 'guest', 'assistant']),
    presence: enumOf(['home', 'away']),
    quiet_hours: nil(obj({start: {type: 'string', pattern: CLOCK}, end: {type: 'string', pattern: CLOCK}}))
  })),
  rooms: arr(obj({room_id: id(), name: {type: 'string', minLength: 1}, floor: {type: 'string', minLength: 1}})),
  devices: arr(device),
  scenes: arr(obj({
    scene_id: id(),
    name: {type: 'string', minLength: 1, maxLength: 160},
    created_by: enumOf(['assistant', 'member', 'owner']),
    created_by_person_id: nil(id()),
    last_edited_by: enumOf(['assistant', 'member', 'owner']),
    run_as: enumOf(['assistant', 'owner']),
    deleted: {type: 'boolean'},
    actions: arr(action)
  })),
  routines: arr(obj({
    routine_id: id(),
    name: {type: 'string', minLength: 1, maxLength: 160},
    enabled: {type: 'boolean'},
    deleted: {type: 'boolean'},
    created_by: enumOf(['assistant', 'member', 'owner']),
    created_by_person_id: nil(id()),
    last_edited_by: enumOf(['assistant', 'member', 'owner']),
    run_as: enumOf(['assistant', 'owner']),
    trigger,
    conditions: arr(condition),
    actions: arr(action),
    catch_up_minutes: {type: 'integer', minimum: 0, maximum: 180}
  })),
  access_codes: arr(obj({
    code_id: id(),
    name: {type: 'string', minLength: 1, maxLength: 160},
    holder_name: {type: 'string', minLength: 1, maxLength: 160},
    holder_person_id: nil(id()),
    digits: {type: 'string', pattern: '^\\d{6}$'},
    schedule,
    locks: arr(id()),
    revoked: {type: 'boolean'},
    approval: enumOf(['approved', 'pending']),
    pending_confirmation_id: nil(id()),
    created_at: dt()
  })),
  confirmations: arr(obj({
    confirmation_id: id(),
    created_at: dt(),
    status: enumOf(['pending', 'approved', 'denied', 'cancelled']),
    target: obj({kind: {type: 'string'}, id: {type: 'string'}}),
    stored: {type: 'object'},
    summary: {type: 'string'},
    resolved_at: nil(dt()),
    decision: nil({type: 'string'}),
    by_person_id: nil(id())
  })),
  alerts: arr(obj({
    alert_id: id(),
    kind: {type: 'string'},
    device_id: nil(id()),
    created_at: dt(),
    source_key: nil({type: 'string'}),
    acknowledged_at: nil(dt()),
    snooze_until: nil(dt()),
    summary: {type: 'string'}
  })),
  notices: arr(obj({
    notice_id: id(),
    kind: {type: 'string'},
    created_at: dt(),
    recipient_person_id: id(),
    object_type: {type: 'string'},
    object_id: id(),
    title: {type: 'string'},
    body: {type: 'string'},
    delivery_status: enumOf(['pending_delivery', 'committed', 'rejected', 'unknown']),
    publish_request_id: nil({type: 'string'}),
    messaging_event_id: nil({type: 'string'})
  })),
  sessions: arr(obj({
    session_id: id(),
    device_id: id(),
    recipient: {type: 'string'},
    started_at: dt(),
    duration_minutes: {type: 'integer'},
    stopped_at: nil(dt())
  })),
  announcements: arr(obj({at: dt(), device_id: id(), text: {type: 'string'}})),
  activity: arr(activity),
  firings: arr(obj({
    firing_id: id(),
    routine_id: id(),
    scheduled_for: dt(),
    fired_at: nil(dt()),
    outcome: enumOf(['fired', 'missed', 'conditions_unmet']),
    reason: nil({type: 'string'}),
    results: arr({type: 'object'}),
    count: {type: 'integer', minimum: 1},
    range_end: nil(dt())
  })),
  code_uses: arr(obj({
    use_id: id(),
    at: dt(),
    lock_device_id: id(),
    code_id: nil(id()),
    holder_name: nil({type: 'string'}),
    outcome: enumOf(['unlocked', 'denied']),
    reason: nil({type: 'string'})
  })),
  sun_table: arr(obj({
    date: {type: 'string', pattern: DATE},
    sunrise: nil({type: 'string', pattern: CLOCK}),
    sunset: nil({type: 'string', pattern: CLOCK})
  })),
  counters: obj({
    activity: {type: 'integer', minimum: 1},
    confirmation: {type: 'integer', minimum: 1},
    code: {type: 'integer', minimum: 1},
    session: {type: 'integer', minimum: 1},
    alert: {type: 'integer', minimum: 1},
    notice: {type: 'integer', minimum: 1},
    scene: {type: 'integer', minimum: 1},
    routine: {type: 'integer', minimum: 1},
    firing: {type: 'integer', minimum: 1},
    code_use: {type: 'integer', minimum: 1}
  }),
  available_snapshots: arr(id())
});
seedSchema.required = seedSchema.required.filter(name => name !== 'approver_person_ids');

function event(operation, payload, required) {
  return obj({
    event_id: id(),
    at: dt(),
    operation: {const: operation},
    payload: obj(payload, required)
  });
}

const eventsSchema = {
  oneOf: [
    event('sensor.change', {device_id: id(), state: {anyOf: [{type: 'string'}, {type: 'number'}]}}, ['device_id', 'state']),
    event('device.manual_change', {device_id: id(), command: {type: 'string'}, args: commandArgs, by_person_id: id()}, ['device_id', 'command', 'by_person_id']),
    event('member.presence', {person_id: id(), presence: enumOf(['arrived', 'left'])}, ['person_id', 'presence']),
    event('mode.changed', {by_person_id: id(), mode: enumOf(['home', 'away', 'night'])}, ['by_person_id', 'mode']),
    event('lock.code_used', {
      lock_device_id: id(),
      code_id: id(),
      holder_person_id: id(),
      holder_name: {type: 'string'},
      digits: {type: 'string'}
    }, ['lock_device_id']),
    event('confirmation.resolved', {
      confirmation_id: id(),
      device_id: id(),
      routine_id: id(),
      scene_id: id(),
      mode: {type: 'string'},
      decision: enumOf(['approved', 'denied']),
      by_person_id: id()
    }, ['decision', 'by_person_id']),
    event('fault.inject', {device_id: id(), fault: enumOf(['jammed', 'obstructed', 'offline'])}, ['device_id', 'fault']),
    event('fault.clear', {device_id: id()}, ['device_id']),
    event('schedule.process_due', {}, []),
    event('notice.delivery_result', {
      notice_id: id(),
      status: enumOf(['committed', 'rejected', 'unknown']),
      publish_request_id: {type: 'string'},
      messaging_event_id: nil({type: 'string'})
    }, ['notice_id', 'status', 'publish_request_id'])
  ]
};

function stamp(year, month, day, hour, minute) {
  return time.formatInstant(OFFSET, time.instant(OFFSET, year, month, day, hour, minute));
}

function shift(year, month, day, days) {
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return {year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate()};
}

function sunTable(start, days) {
  const rows = [];
  let cursor = start;
  for (let index = 0; index < days; index += 1) {
    const rise = 6 * 60 + 30 + (cursor.day % 7);
    const set = 17 * 60 + (cursor.day % 5);
    rows.push({
      date: time.dateText(cursor),
      sunrise: String(Math.floor(rise / 60)).padStart(2, '0') + ':' + String(rise % 60).padStart(2, '0'),
      sunset: String(Math.floor(set / 60)).padStart(2, '0') + ':' + String(set % 60).padStart(2, '0')
    });
    cursor = shift(cursor.year, cursor.month, cursor.day, 1);
  }
  return rows;
}

function freshCounters() {
  return {activity: 1, confirmation: 1, code: 1, session: 1, alert: 1, notice: 1, scene: 1, routine: 1, firing: 1, code_use: 1};
}

function shell() {
  return {
    home_mode: 'home',
    assistant_carried_modes: [],
    approver_person_ids: [],
    door_open_alert_minutes: 30,
    quiet_hours: {start: '22:00', end: '07:00'},
    max_active_codes: 8,
    max_code_window_hours: 72,
    allow_overlapping_codes: false,
    mode_rules: [],
    scenes: [],
    routines: [],
    access_codes: [],
    confirmations: [],
    alerts: [],
    notices: [],
    sessions: [],
    announcements: [],
    activity: [],
    firings: [],
    code_uses: [],
    sun_table: sunTable({year: 2025, month: 1, day: 1}, 731),
    counters: freshCounters(),
    available_snapshots: ['snap-nursery', 'snap-living', 'snap-hallway', 'snap-kitchen', 'snap-garage', 'snap-entry']
  };
}

function blank(fields) {
  return {
    online: true,
    fault: null,
    state_before_fault: null,
    power: null,
    brightness: null,
    color_temperature: null,
    position: null,
    thermo_mode: null,
    setpoint: null,
    current_temperature: null,
    owner_min: null,
    owner_max: null,
    rated_watts: null,
    high_load: false,
    lock: null,
    unlocked_at: null,
    auto_relock_minutes: null,
    garage: null,
    privacy: null,
    volume: null,
    sensor: null,
    sensor_value: null,
    opened_at: null,
    hearth_appliance_id: null,
    snapshot_asset_id: null,
    energy: [],
    energy_kwh_closed: 0,
    ...fields
  };
}

function record(data, device, mutate, at, meta) {
  const before = project(device);
  mutate();
  data.activity.push({
    activity_id: 'act-' + data.counters.activity,
    at,
    actor_kind: meta.actor_kind,
    actor_id: meta.actor_id,
    caller_role: null,
    cause: meta.cause || 'seed',
    request_id: null,
    event_id: null,
    device_id: device.device_id,
    command: meta.command,
    summary: meta.summary,
    before,
    after: project(device)
  });
  data.counters.activity += 1;
}

function closedKwh(device) {
  let wattHours = 0;
  for (const interval of device.energy) {
    if (!interval.to) continue;
    wattHours += device.rated_watts * ((Date.parse(interval.to) - Date.parse(interval.from)) / 3600000);
  }
  device.energy_kwh_closed = Math.round((wattHours / 1000) * 1000) / 1000;
}

function beforeDay(day, until) {
  if (day.year !== until.year) return day.year < until.year;
  if (day.month !== until.month) return day.month < until.month;
  return day.day < until.day;
}

function fortnight(data, device, start, until, person) {
  device.power = 'off';
  let cursor = start;
  while (beforeDay(cursor, until)) {
    record(data, device, () => { device.power = 'on'; }, stamp(cursor.year, cursor.month, cursor.day, 18, 0), {
      actor_kind: 'manual', actor_id: person, command: 'turn_on', summary: device.name + ' on'
    });
    record(data, device, () => { device.power = 'off'; }, stamp(cursor.year, cursor.month, cursor.day, 23, 0), {
      actor_kind: 'manual', actor_id: person, command: 'turn_off', summary: device.name + ' off'
    });
    cursor = shift(cursor.year, cursor.month, cursor.day, 14);
  }
}

function switchFortnight(data, device, start, until, person) {
  device.power = 'off';
  let cursor = start;
  while (beforeDay(cursor, until)) {
    const from = stamp(cursor.year, cursor.month, cursor.day, 8, 0);
    const to = stamp(cursor.year, cursor.month, cursor.day, 16, 0);
    record(data, device, () => {
      device.power = 'on';
      device.energy.push({from, to: null});
    }, from, {actor_kind: 'manual', actor_id: person, command: 'turn_on', summary: device.name + ' on'});
    record(data, device, () => {
      device.power = 'off';
      device.energy[device.energy.length - 1].to = to;
    }, to, {actor_kind: 'manual', actor_id: person, command: 'turn_off', summary: device.name + ' off'});
    cursor = shift(cursor.year, cursor.month, cursor.day, 14);
  }
  closedKwh(device);
}

const HISTORY_START = {year: 2025, month: 1, day: 1};

function dailyLight(data, device, start, days, endPower, person, finalAt) {
  device.power = 'off';
  for (let index = 0; index < days; index += 1) {
    const day = shift(start.year, start.month, start.day, index);
    record(data, device, () => { device.power = 'on'; }, stamp(day.year, day.month, day.day, 18, 0), {
      actor_kind: 'manual', actor_id: person, command: 'turn_on', summary: device.name + ' on'
    });
    record(data, device, () => { device.power = 'off'; }, stamp(day.year, day.month, day.day, 23, 0), {
      actor_kind: 'manual', actor_id: person, command: 'turn_off', summary: device.name + ' off'
    });
  }
  if (endPower === 'on') {
    record(data, device, () => { device.power = 'on'; }, finalAt, {
      actor_kind: 'manual', actor_id: person, command: 'turn_on', summary: device.name + ' on'
    });
  }
}

function heaterWeek(data, device) {
  device.power = 'off';
  for (let index = 0; index < 7; index += 1) {
    const day = shift(2026, 11, 10, index);
    const next = shift(day.year, day.month, day.day, 1);
    const from = stamp(day.year, day.month, day.day, 6, 0);
    const to = stamp(next.year, next.month, next.day, 0, 0);
    record(data, device, () => {
      device.power = 'on';
      device.energy.push({from, to: null});
    }, from, {actor_kind: 'manual', actor_id: 'person-hana', command: 'turn_on', summary: 'Water heater on'});
    record(data, device, () => {
      device.power = 'off';
      device.energy[device.energy.length - 1].to = to;
    }, to, {actor_kind: 'manual', actor_id: 'person-hana', command: 'turn_off', summary: 'Water heater off'});
  }
  closedKwh(device);
}

function scopes(level, overrides = {}) {
  const value = {};
  for (const name of classes) value[name] = level;
  return {...value, ...overrides};
}

function member(personId, name, role, presence = 'home') {
  return {person_id: personId, name, role, presence, quiet_hours: null};
}

function binding(accountId, ownerId, people, objectIds) {
  return {
    people: people.map(person => ({person_id: person.person_id, name: person.name})),
    accounts: [{app_id: 'brightwire-home', account_id: accountId, owner_person_id: ownerId}],
    objects: {'brightwire-home': objectIds}
  };
}

function morales(options) {
  const data = {
    ...shell(),
    account_id: 'bw-household-morales',
    household_name: 'Morales',
    owner_person_id: 'person-hana',
    timezone: 'America/Chicago',
    utc_offset: OFFSET,
    committed_through: options.committed_through,
    scopes: options.scopes,
    mode_rules: [
      {mode: 'night', class: 'lock', scope: 'none'},
      {mode: 'night', class: 'garage', scope: 'none'}
    ],
    members: [
      member('person-hana', 'Hana Morales', 'owner'),
      member('person-luis', 'Luis Morales', 'adult'),
      member('person-mateo', 'Mateo Morales', 'child'),
      member('assistant', 'Household assistant', 'assistant')
    ],
    rooms: [
      {room_id: 'living', name: 'Living room', floor: 'main'},
      {room_id: 'hallway', name: 'Hallway', floor: 'main'},
      {room_id: 'nursery', name: 'Nursery', floor: 'upper'},
      {room_id: 'kitchen', name: 'Kitchen', floor: 'main'},
      {room_id: 'primary', name: 'Primary bedroom', floor: 'upper'},
      {room_id: 'garage', name: 'Garage', floor: 'main'}
    ]
  };
  const living = blank({device_id: 'light-living', room_id: 'living', type: 'light', name: 'Living lamp', brightness: 100, color_temperature: 2700});
  const hallway = blank({device_id: 'light-hallway', room_id: 'hallway', type: 'light', name: 'Hallway light', brightness: 100, color_temperature: 3000});
  const primary = blank({device_id: 'light-primary', room_id: 'primary', type: 'light', name: 'Primary lamp', brightness: 40, color_temperature: 2700});
  const nurseryBlind = blank({device_id: 'blind-nursery', room_id: 'nursery', type: 'blind', name: 'Nursery blind', position: 100});
  const livingBlind = blank({device_id: 'blind-living', room_id: 'living', type: 'blind', name: 'Living blind', position: 80});
  const thermo = blank({device_id: 'thermo-main', room_id: 'living', type: 'thermostat', name: 'Main thermostat', thermo_mode: 'heat', setpoint: 68, current_temperature: 69, owner_min: 66, owner_max: 72});
  const nurseryThermo = blank({device_id: 'thermo-nursery', room_id: 'nursery', type: 'thermostat', name: 'Nursery thermostat', thermo_mode: 'heat', setpoint: 70, current_temperature: 70, owner_min: 68, owner_max: 72});
  const heater = blank({device_id: 'switch-water-heater', room_id: 'garage', type: 'switch', name: 'Water heater', rated_watts: 4500, high_load: true, hearth_appliance_id: 'hearth-water-heater'});
  const lock = blank({device_id: 'lock-front', room_id: 'hallway', type: 'lock', name: 'Front door', lock: 'locked', auto_relock_minutes: 5});
  const garage = blank({device_id: 'garage-main', room_id: 'garage', type: 'garage', name: 'Garage door', garage: 'closed'});
  const camera = blank({device_id: 'camera-nursery', room_id: 'nursery', type: 'camera', name: 'nursery camera', privacy: 'privacy_on', snapshot_asset_id: 'snap-nursery'});
  const speaker = blank({device_id: 'speaker-kitchen', room_id: 'kitchen', type: 'speaker', name: 'Kitchen speaker', volume: 15});
  const contact = blank({device_id: 'contact-front', room_id: 'hallway', type: 'contact', name: 'Front door sensor', sensor: 'closed'});
  data.devices = [living, hallway, primary, nurseryBlind, livingBlind, thermo, nurseryThermo, heater, lock, garage, camera, speaker, contact];
  const start = {year: 2026, month: 10, day: 18};
  const lightsOn = options.evening ? stamp(2026, 11, 17, 18, 0) : stamp(2026, 11, 17, 8, 30);
  fortnight(data, living, HISTORY_START, start, 'person-hana');
  fortnight(data, hallway, HISTORY_START, start, 'person-luis');
  fortnight(data, primary, HISTORY_START, start, 'person-hana');
  dailyLight(data, living, start, 30, 'on', 'person-hana', lightsOn);
  dailyLight(data, hallway, start, 30, 'on', 'person-luis', lightsOn);
  dailyLight(data, primary, start, 30, 'off', 'person-hana', lightsOn);
  record(data, nurseryBlind, () => { nurseryBlind.position = 0; }, stamp(2026, 11, 17, 8, 0), {
    actor_kind: 'manual', actor_id: 'person-hana', command: 'set_position', summary: 'Nursery blind closed for the day'
  });
  record(data, livingBlind, () => { livingBlind.position = 30; }, stamp(2026, 11, 17, 9, 0), {
    actor_kind: 'manual', actor_id: 'person-hana', command: 'set_position', summary: 'Living blind set'
  });
  record(data, thermo, () => { thermo.setpoint = 70; }, stamp(2026, 11, 1, 7, 0), {
    actor_kind: 'manual', actor_id: 'person-hana', command: 'set_setpoint', summary: 'Main thermostat setpoint'
  });
  heaterWeek(data, heater);
  for (const day of [{y: 2026, m: 10, d: 20}, {y: 2026, m: 11, d: 3}]) {
    record(data, lock, () => { lock.lock = 'unlocked'; lock.unlocked_at = stamp(day.y, day.m, day.d, 8, 0); }, stamp(day.y, day.m, day.d, 8, 0), {
      actor_kind: 'manual', actor_id: 'person-hana', command: 'unlock', summary: 'Front door unlocked'
    });
    record(data, lock, () => { lock.lock = 'locked'; lock.unlocked_at = null; }, stamp(day.y, day.m, day.d, 8, 10), {
      actor_kind: 'manual', actor_id: 'person-hana', command: 'lock', summary: 'Front door locked'
    });
  }
  record(data, lock, () => { lock.lock = 'unlocked'; lock.unlocked_at = stamp(2026, 11, 17, 7, 0); }, stamp(2026, 11, 17, 7, 0), {
    actor_kind: 'routine', actor_id: 'rt-front-0700', cause: 'routine', command: 'unlock', summary: 'Morning unlock'
  });
  record(data, lock, () => { lock.lock = 'locked'; lock.unlocked_at = null; }, stamp(2026, 11, 17, 7, 5), {
    actor_kind: 'routine', actor_id: 'auto-relock', cause: 'routine', command: 'lock', summary: 'Front door auto-relock'
  });
  record(data, contact, () => { contact.sensor = 'open'; contact.opened_at = stamp(2026, 11, 16, 18, 2); }, stamp(2026, 11, 16, 18, 2), {
    actor_kind: 'manual', actor_id: 'sensor', command: 'sensor_change', summary: 'Front door sensor open'
  });
  record(data, contact, () => { contact.sensor = 'closed'; contact.opened_at = null; }, stamp(2026, 11, 16, 18, 4), {
    actor_kind: 'manual', actor_id: 'sensor', command: 'sensor_change', summary: 'Front door sensor closed'
  });
  record(data, garage, () => { garage.garage = 'open'; }, stamp(2026, 11, 12, 17, 30), {
    actor_kind: 'manual', actor_id: 'person-luis', command: 'open', summary: 'Garage opened'
  });
  record(data, garage, () => { garage.garage = 'closed'; }, stamp(2026, 11, 12, 17, 41), {
    actor_kind: 'manual', actor_id: 'person-luis', command: 'close', summary: 'Garage closed'
  });
  data.firings.push({
    firing_id: 'fr-' + data.counters.firing,
    routine_id: 'rt-front-0700',
    scheduled_for: stamp(2026, 11, 17, 7, 0),
    fired_at: stamp(2026, 11, 17, 7, 0),
    outcome: 'fired',
    reason: null,
    count: 1,
    range_end: null,
    results: [{device_id: 'lock-front', command: 'unlock', outcome: 'applied'}]
  });
  data.counters.firing += 1;
  data.scenes = [{
    scene_id: 'sc-goodnight',
    name: 'Goodnight',
    created_by: 'owner',
    created_by_person_id: 'person-hana',
    last_edited_by: 'owner',
    run_as: 'owner',
    deleted: false,
    actions: [
      {kind: 'device', device_id: 'light-living', command: 'turn_off', args: {}},
      {kind: 'device', device_id: 'light-hallway', command: 'turn_off', args: {}},
      {kind: 'device', device_id: 'blind-nursery', command: 'close', args: {}}
    ]
  }];
  data.routines = [
    {
      routine_id: 'rt-front-0700',
      name: 'Front door at 07:00',
      enabled: true,
      deleted: false,
      created_by: 'owner',
      created_by_person_id: 'person-hana',
      last_edited_by: 'owner',
      run_as: 'owner',
      trigger: {kind: 'clock', time: '07:00'},
      conditions: [],
      actions: [{kind: 'device', device_id: 'lock-front', command: 'unlock', args: {}}],
      catch_up_minutes: 15
    },
    {
      routine_id: 'rt-lamps-1900',
      name: 'Lamps at 19:00',
      enabled: true,
      deleted: false,
      created_by: 'owner',
      created_by_person_id: 'person-hana',
      last_edited_by: 'owner',
      run_as: 'owner',
      trigger: {kind: 'clock', time: '19:00'},
      conditions: [],
      actions: [
        {kind: 'device', device_id: 'light-living', command: 'turn_on', args: {}},
        {kind: 'device', device_id: 'light-hallway', command: 'turn_on', args: {}}
      ],
      catch_up_minutes: 15
    },
    {
      routine_id: 'rt-nursery-blinds',
      name: 'Nursery blinds at 19:00',
      enabled: true,
      deleted: false,
      created_by: 'owner',
      created_by_person_id: 'person-hana',
      last_edited_by: 'owner',
      run_as: 'owner',
      trigger: {kind: 'clock', time: '19:00'},
      conditions: [],
      actions: [{kind: 'device', device_id: 'blind-nursery', command: 'close', args: {}}],
      catch_up_minutes: 15
    },
    {
      routine_id: 'rt-hana-home',
      name: 'Hana arrives',
      enabled: true,
      deleted: false,
      created_by: 'owner',
      created_by_person_id: 'person-hana',
      last_edited_by: 'owner',
      run_as: 'owner',
      trigger: {kind: 'member_arrives', person_id: 'person-hana'},
      conditions: [],
      actions: [{kind: 'device', device_id: 'light-living', command: 'turn_on', args: {}}],
      catch_up_minutes: 0
    }
  ];
  data.access_codes.push({
    code_id: 'code-guest',
    name: 'Handyman window',
    holder_name: 'Dev Patel',
    holder_person_id: 'person-dev-patel',
    digits: '104729',
    schedule: {kind: 'window', start: stamp(2026, 11, 18, 13, 0), end: stamp(2026, 11, 18, 16, 0)},
    locks: ['lock-front'],
    revoked: false,
    approval: 'approved',
    pending_confirmation_id: null,
    created_at: stamp(2026, 11, 10, 9, 0)
  });
  if (options.evening) {
    record(data, nurseryBlind, () => { nurseryBlind.position = 0; }, stamp(2026, 11, 17, 19, 0), {
      actor_kind: 'routine', actor_id: 'rt-nursery-blinds', cause: 'routine', command: 'close', summary: 'Nursery blinds closed'
    });
    data.firings.push({
      firing_id: 'fr-' + data.counters.firing,
      routine_id: 'rt-nursery-blinds',
      scheduled_for: stamp(2026, 11, 17, 19, 0),
      fired_at: stamp(2026, 11, 17, 19, 0),
      outcome: 'fired',
      reason: null,
      count: 1,
      range_end: null,
      results: [{device_id: 'blind-nursery', command: 'close', outcome: 'applied'}]
    });
    data.counters.firing += 1;
    data.firings.push({
      firing_id: 'fr-' + data.counters.firing,
      routine_id: 'rt-lamps-1900',
      scheduled_for: stamp(2026, 11, 17, 19, 0),
      fired_at: stamp(2026, 11, 17, 19, 0),
      outcome: 'fired',
      reason: null,
      count: 1,
      range_end: null,
      results: [
        {device_id: 'light-living', command: 'turn_on', outcome: 'applied'},
        {device_id: 'light-hallway', command: 'turn_on', outcome: 'applied'}
      ]
    });
    data.counters.firing += 1;
    const morning = data.routines.find(item => item.routine_id === 'rt-front-0700');
    morning.enabled = false;
  }
  data.activity.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.activity_id.localeCompare(right.activity_id));
  return data;
}

function ruth() {
  const data = {
    ...shell(),
    account_id: 'bw-household-ruth',
    household_name: 'Ruth Adler',
    owner_person_id: 'person-ruth',
    timezone: 'America/Chicago',
    utc_offset: OFFSET,
    committed_through: stamp(2026, 11, 17, 12, 0),
    scopes: scopes('operate', {lock: 'confirm', camera: 'none', automations: 'confirm'}),
    members: [
      member('person-ruth', 'Ruth Adler', 'owner'),
      member('person-ada', 'Ada Adler', 'adult', 'away'),
      member('person-ben', 'Ben Adler', 'adult', 'away'),
      member('assistant', 'Household assistant', 'assistant')
    ],
    rooms: [
      {room_id: 'living', name: 'Living room', floor: 'main'},
      {room_id: 'hallway', name: 'Hallway', floor: 'main'},
      {room_id: 'kitchen', name: 'Kitchen', floor: 'main'}
    ],
    quiet_hours: {start: '21:00', end: '07:00'}
  };
  const light = blank({device_id: 'light-mom-living', room_id: 'living', type: 'light', name: 'Living lamp', brightness: 60, color_temperature: 2700});
  const hall = blank({device_id: 'light-mom-hall', room_id: 'hallway', type: 'light', name: 'Hall light', brightness: 40, color_temperature: 3000, power: 'off'});
  const thermo = blank({device_id: 'thermo-mom', room_id: 'living', type: 'thermostat', name: 'Thermostat', thermo_mode: 'heat', setpoint: 68, current_temperature: 68, owner_min: 66, owner_max: 74});
  const lock = blank({device_id: 'lock-mom-front', room_id: 'hallway', type: 'lock', name: 'Front door', lock: 'locked', auto_relock_minutes: 5});
  const contact = blank({device_id: 'contact-mom-front', room_id: 'hallway', type: 'contact', name: 'Front door sensor', sensor: 'closed'});
  const motion = blank({device_id: 'motion-mom-hall', room_id: 'hallway', type: 'motion', name: 'Hall motion', sensor: 'clear'});
  const leak = blank({device_id: 'leak-mom-kitchen', room_id: 'kitchen', type: 'leak', name: 'Kitchen leak sensor', sensor: 'dry'});
  const smoke = blank({device_id: 'smoke-mom-hall', room_id: 'hallway', type: 'smoke', name: 'Hall smoke sensor', sensor: 'clear'});
  const temperature = blank({device_id: 'temp-mom-living', room_id: 'living', type: 'temperature', name: 'Living temperature', sensor: 'reading', sensor_value: 21});
  data.devices = [light, hall, thermo, lock, contact, motion, leak, smoke, temperature];
  data.available_snapshots = ['snap-nursery', 'snap-living', 'snap-hallway', 'snap-kitchen', 'snap-garage', 'snap-entry'];
  fortnight(data, light, HISTORY_START, {year: 2026, month: 9, day: 18}, 'person-ruth');
  dailyLight(data, light, {year: 2026, month: 9, day: 18}, 60, 'off', 'person-ruth', stamp(2026, 11, 17, 8, 0));
  data.routines = [{
    routine_id: 'rt-ruth-lights',
    name: 'Evening lamp',
    enabled: true,
    deleted: false,
    created_by: 'owner',
    created_by_person_id: 'person-ruth',
    last_edited_by: 'owner',
    run_as: 'owner',
    trigger: {kind: 'clock', time: '18:30'},
    conditions: [],
    actions: [{kind: 'device', device_id: 'light-mom-living', command: 'turn_on', args: {}}],
    catch_up_minutes: 15
  }];
  return data;
}

function chen() {
  const data = {
    ...shell(),
    account_id: 'bw-household-chen',
    household_name: 'Chen',
    owner_person_id: 'person-c1',
    timezone: 'America/Chicago',
    utc_offset: OFFSET,
    committed_through: stamp(2026, 11, 17, 12, 0),
    scopes: scopes('operate'),
    members: [
      member('person-c1', 'Ava Chen', 'owner'),
      member('person-c2', 'Noah Chen', 'adult'),
      member('person-c3', 'Mia Chen', 'adult'),
      member('person-c4', 'Leo Chen', 'adult'),
      member('assistant', 'Household assistant', 'assistant')
    ],
    rooms: ['kitchen', 'living', 'hall', 'bed-1', 'bed-2', 'office', 'garage'].map(room => ({
      room_id: room, name: room, floor: room.startsWith('bed') ? 'upper' : 'main'
    }))
  };
  const plan = [
    ['light', 'c-light-kitchen', 'kitchen'], ['light', 'c-light-living', 'living'], ['light', 'c-light-hall', 'hall'],
    ['light', 'c-light-bed-1', 'bed-1'], ['light', 'c-light-bed-2', 'bed-2'], ['light', 'c-light-office', 'office'],
    ['blind', 'c-blind-living', 'living'], ['blind', 'c-blind-bed-1', 'bed-1'],
    ['thermostat', 'c-thermo-main', 'living'], ['thermostat', 'c-thermo-bed', 'bed-1'],
    ['switch', 'c-switch-porch', 'garage'], ['switch', 'c-switch-pump', 'garage'],
    ['lock', 'c-lock-front', 'hall'], ['lock', 'c-lock-office', 'office'],
    ['garage', 'c-garage', 'garage'],
    ['camera', 'c-camera-porch', 'garage'], ['camera', 'c-camera-hall', 'hall'],
    ['speaker', 'c-speaker', 'kitchen'],
    ['contact', 'c-contact-front', 'hall'], ['motion', 'c-motion-hall', 'hall'],
    ['leak', 'c-leak-kitchen', 'kitchen'], ['smoke', 'c-smoke-hall', 'hall']
  ];
  data.devices = plan.map(([type, deviceId, roomId]) => {
    const item = blank({device_id: deviceId, room_id: roomId, type, name: deviceId});
    if (type === 'light') { item.power = 'off'; item.brightness = 50; item.color_temperature = 3000; }
    if (type === 'blind') item.position = 40;
    if (type === 'thermostat') { item.thermo_mode = 'heat'; item.setpoint = 70; item.current_temperature = 70; item.owner_min = 65; item.owner_max = 75; }
    if (type === 'switch') { item.power = 'off'; item.rated_watts = type === 'switch' && deviceId.endsWith('porch') ? 60 : 800; }
    if (type === 'lock') { item.lock = 'locked'; item.auto_relock_minutes = 10; }
    if (type === 'garage') item.garage = 'closed';
    if (type === 'camera') { item.privacy = 'privacy_off'; item.snapshot_asset_id = deviceId.endsWith('porch') ? 'snap-garage' : 'snap-hallway'; }
    if (type === 'speaker') item.volume = 10;
    if (type === 'contact') item.sensor = 'closed';
    if (type === 'motion') item.sensor = 'clear';
    if (type === 'leak') item.sensor = 'dry';
    if (type === 'smoke') item.sensor = 'clear';
    return item;
  });
  const porch = data.devices.find(item => item.device_id === 'c-switch-porch');
  switchFortnight(data, porch, HISTORY_START, {year: 2026, month: 10, day: 18}, 'person-c1');
  const from = stamp(2026, 11, 1, 8, 0);
  record(data, porch, () => {
    porch.power = 'on';
    porch.energy.push({from, to: null});
  }, from, {actor_kind: 'manual', actor_id: 'person-c1', command: 'turn_on', summary: 'Porch switch left on'});
  const living = data.devices.find(item => item.device_id === 'c-light-living');
  fortnight(data, living, HISTORY_START, {year: 2026, month: 11, day: 2}, 'person-c1');
  dailyLight(data, living, {year: 2026, month: 11, day: 2}, 14, 'off', 'person-c1', stamp(2026, 11, 16, 8, 0));
  const front = data.devices.find(item => item.device_id === 'c-lock-front');
  data.access_codes.push({
    code_id: 'code-weekday',
    name: 'Weekday cleaner',
    holder_name: 'Weekday cleaner',
    holder_person_id: null,
    digits: '220418',
    schedule: {kind: 'recurring', days: ['MO', 'TU', 'WE', 'TH', 'FR'], start_time: '09:00', end_time: '17:00'},
    locks: ['c-lock-front'],
    revoked: false,
    approval: 'approved',
    pending_confirmation_id: null,
    created_at: stamp(2025, 1, 6, 8, 0)
  });
  let monday = {year: 2025, month: 1, day: 6};
  while (beforeDay(monday, {year: 2026, month: 11, day: 3})) {
    const at = stamp(monday.year, monday.month, monday.day, 9, 30);
    const locked = stamp(monday.year, monday.month, monday.day, 9, 40);
    data.code_uses.push({
      use_id: 'use-' + data.counters.code_use,
      at,
      lock_device_id: 'c-lock-front',
      code_id: 'code-weekday',
      holder_name: 'Weekday cleaner',
      outcome: 'unlocked',
      reason: null
    });
    data.counters.code_use += 1;
    record(data, front, () => { front.lock = 'unlocked'; front.unlocked_at = at; }, at, {
      actor_kind: 'guest_code', actor_id: 'code-weekday', cause: 'guest_code', command: 'unlock', summary: 'Weekday cleaner unlocked the front door'
    });
    record(data, front, () => { front.lock = 'locked'; front.unlocked_at = null; }, locked, {
      actor_kind: 'manual', actor_id: 'person-c1', command: 'lock', summary: 'Front door locked after the cleaner'
    });
    const next = shift(monday.year, monday.month, monday.day, 28);
    monday = next;
  }
  data.available_snapshots = ['snap-nursery', 'snap-living', 'snap-hallway', 'snap-kitchen', 'snap-garage', 'snap-entry'];
  return data;
}

function tool(name, description, readOnly, inputProperties, inputRequired, outputProperties) {
  const properties = {...inputProperties};
  const required = [...inputRequired];
  if (!readOnly) {
    properties.expected_version = version;
    properties.request_id = {type: 'string', minLength: 1, maxLength: 120};
    required.push('expected_version', 'request_id');
  }
  return {
    name: 'brightwire-home.' + name,
    description,
    read_only: readOnly,
    scope: 'brightwire-home.' + name,
    resource_target: 'current account',
    inputSchema: obj(properties, required),
    outputSchema: {
      type: 'object',
      properties: {
        status: enumOf(['ok', 'committed']),
        app_id: {const: 'brightwire-home'},
        version,
        ...outputProperties
      },
      required: ['status', 'app_id', 'version'],
      additionalProperties: true
    }
  };
}

const loose = {type: 'object'};
const looseList = arr(loose);
const tools = [
  tool('rooms.list', 'List rooms in the household.', true, {}, [], {rooms: looseList}),
  tool('devices.list', 'List devices, including observed lock state.', true, {}, [], {devices: looseList}),
  tool('devices.get', 'Read one device. A snapshot id that is not in available_snapshots is reported as asset_missing.', true, {device_id: id()}, ['device_id'], {device: loose}),
  tool('devices.history', 'Activity rows for one device, oldest first.', true, {device_id: id()}, ['device_id'], {entries: looseList}),
  tool('scenes.list', 'List scenes, including deleted ones.', true, {}, [], {scenes: looseList}),
  tool('routines.list', 'List routines and any scheduled occurrences between the cursor and the current virtual time.', true, {}, [], {routines: looseList}),
  tool('routines.get', 'Read one routine, including a deleted routine.', true, {routine_id: id()}, ['routine_id'], {routine: loose}),
  tool('members.list', 'List members and the current home mode.', true, {}, [], {members: looseList, home_mode: {type: 'string'}}),
  tool('modes.get', 'Read the home mode, carried mode and mode rules.', true, {}, [], {home_mode: {type: 'string'}, mode_rules: looseList}),
  tool('access_codes.list', 'List access codes with digits masked.', true, {}, [], {codes: looseList}),
  tool('permissions.get', 'Read base scopes and the scopes in effect for the assistant right now.', true, {}, [], {scopes: loose, effective: loose}),
  tool('confirmations.list', 'List confirmations. Pending ones read as expired once ten minutes have passed.', true, {}, [], {confirmations: looseList}),
  tool('activity.list', 'List the household activity log.', true, {}, [], {entries: looseList}),
  tool('alerts.list', 'List alerts. Snooze and acknowledgement are reflected in status.', true, {}, [], {alerts: looseList}),
  tool('energy.summary', 'Sum switch energy in a half-open time range. A range that ends at or before the first history row returns no_data.', true, {start: dt(), end: dt(), device_id: id()}, ['start', 'end'], {outcome: {type: 'string'}, total_kwh: {type: 'number'}, devices: looseList}),
  tool('devices.command', 'Command one controllable device. confirm scope stores a confirmation and leaves the device unchanged.', false, {device_id: id(), command: {type: 'string'}, args: commandArgs}, ['device_id', 'command'], {outcome: {type: 'string'}}),
  tool('camera.share.start', 'Start a camera share. Refused while privacy is on.', false, {device_id: id(), recipient: {type: 'string'}, duration_minutes: {type: 'integer'}}, ['device_id', 'recipient', 'duration_minutes'], {outcome: {type: 'string'}}),
  tool('camera.share.stop', 'Stop a camera share.', false, {session_id: id()}, ['session_id'], {outcome: {type: 'string'}}),
  tool('scenes.run', 'Run a scene now. Each action has its own outcome, and a device fault does not undo the others.', false, {scene_id: id()}, ['scene_id'], {outcome: {type: 'string'}, results: looseList}),
  tool('scenes.create', 'Create a scene. Every action must be one the assistant can operate.', false, {name: {type: 'string', minLength: 1}, actions: arr(action)}, ['name', 'actions'], {outcome: {type: 'string'}}),
  tool('scenes.update', 'Replace a scene name and actions.', false, {scene_id: id(), name: {type: 'string'}, actions: arr(action)}, ['scene_id', 'name', 'actions'], {outcome: {type: 'string'}}),
  tool('scenes.delete', 'Delete a scene. The id can still be read.', false, {scene_id: id()}, ['scene_id'], {outcome: {type: 'string'}}),
  tool('routines.create', 'Create a routine. Unattended actions must be operate scope.', false, {name: {type: 'string'}, trigger, conditions: arr(condition), actions: arr(action), catch_up_minutes: {type: 'integer'}}, ['name', 'trigger', 'actions'], {outcome: {type: 'string'}}),
  tool('routines.update', 'Edit a routine. Another person\'s routine follows the automations scope.', false, {routine_id: id(), name: {type: 'string'}, trigger, conditions: arr(condition), actions: arr(action), catch_up_minutes: {type: 'integer'}}, ['routine_id'], {outcome: {type: 'string'}}),
  tool('routines.enable', 'Enable a routine.', false, {routine_id: id()}, ['routine_id'], {outcome: {type: 'string'}}),
  tool('routines.disable', 'Disable a routine. Disabled routines do not fire.', false, {routine_id: id()}, ['routine_id'], {outcome: {type: 'string'}}),
  tool('routines.delete', 'Delete a routine and disable it.', false, {routine_id: id()}, ['routine_id'], {outcome: {type: 'string'}}),
  tool('routines.run_now', 'Run an enabled routine immediately, using the assistant scopes rather than run_as.', false, {routine_id: id()}, ['routine_id'], {outcome: {type: 'string'}, results: looseList}),
  tool('modes.set', 'Set the home mode. Every mode the assistant leaves keeps applying until a member or an owner routine clears them.', false, {mode: enumOf(['home', 'away', 'night'])}, ['mode'], {outcome: {type: 'string'}}),
  tool('access_codes.create', 'Create an access code. Digits are returned on this receipt only.', false, {name: {type: 'string'}, holder_name: {type: 'string'}, holder_person_id: id(), locks: arr(id()), schedule}, ['name', 'holder_name', 'locks', 'schedule'], {outcome: {type: 'string'}, digits: {type: 'string'}}),
  tool('access_codes.update', 'Replace an access code schedule.', false, {code_id: id(), schedule}, ['code_id', 'schedule'], {outcome: {type: 'string'}}),
  tool('access_codes.revoke', 'Revoke an access code.', false, {code_id: id()}, ['code_id'], {outcome: {type: 'string'}}),
  tool('confirmations.cancel', 'Cancel a pending confirmation. A pending code is revoked.', false, {confirmation_id: id()}, ['confirmation_id'], {outcome: {type: 'string'}}),
  tool('alerts.acknowledge', 'Acknowledge an alert.', false, {alert_id: id()}, ['alert_id'], {outcome: {type: 'string'}}),
  tool('alerts.snooze', 'Snooze an alert until a later virtual time.', false, {alert_id: id(), until: dt()}, ['alert_id', 'until'], {outcome: {type: 'string'}})
];

function iconImage(label, color) {
  const image = canvas(64, 64, 0xF4F1EA);
  image.fillRect(6, 6, 52, 52, color);
  image.text(label, 10, 22, 0xffffff, 2);
  return png(image);
}

function planImage(label) {
  const image = canvas(480, 280, 0xF7F4EE);
  image.fillRect(20, 20, 200, 112, 0xD9E2EC);
  image.fillRect(240, 20, 208, 112, 0xE7D8C9);
  image.fillRect(20, 152, 432, 104, 0xD5E0D2);
  image.text(label, 32, 176, 0x243038, 3);
  return png(image);
}

function snapshotImage(label, color, salt) {
  const image = canvas(320, 176, color);
  image.fillRect(0, 32, 320, 112, 0x243038);
  image.text(label, 16, 32, 0xffffff, 16);
  if (salt) image.fillRect(0, 0, 16, 16, salt);
  return jpeg(image);
}

function images() {
  const icons = [
    ['living', 'Liv', 0x4A6FA5], ['hallway', 'Hall', 0x5C6B73], ['nursery', 'Nurs', 0xC47B7B],
    ['kitchen', 'Kit', 0xC4893A], ['primary', 'Prim', 0x6B5B95], ['garage', 'Gar', 0x6E7B5A],
    ['bedroom', 'Bed', 0x3E6B6B], ['bath', 'Bath', 0x4F7C8A], ['entry', 'Door', 0x8A5A44]
  ];
  const made = [];
  for (const [name, label, color] of icons) {
    const file = path.join(root, 'assets/icons', name + '.png');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, iconImage(label, color));
    made.push({asset_id: 'icon-' + name, role: 'ui.icon', file, mime: 'image/png', width: 64, height: 64, alt: name + ' room icon'});
  }
  const plans = [
    ['main', 'Main floor'],
    ['upper', 'Upper floor'],
    ['all', 'Whole house']
  ];
  for (const [name, label] of plans) {
    const file = path.join(root, 'assets/plans', name + '.png');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, planImage(label));
    made.push({asset_id: 'plan-' + name, role: 'ui.floor_plan', file, mime: 'image/png', width: 480, height: 280, alt: label + ' plan'});
  }
  const shots = [
    ['nursery', 'NUR', 'Nursery', 0xE7C7C7], ['living', 'LIV', 'Living', 0xC9D4E4], ['hallway', 'HAL', 'Hallway', 0xD5D8DC],
    ['kitchen', 'KIT', 'Kitchen', 0xE6D3B3], ['garage', 'GAR', 'Garage', 0xD5DCCB], ['entry', 'ENT', 'Entry', 0xE4D0C4]
  ];
  for (const [name, label, title, color] of shots) {
    const file = path.join(root, 'assets/snapshots', name + '.jpg');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, snapshotImage(label, color));
    made.push({
      asset_id: 'snap-' + name,
      role: 'ui.snapshot',
      file,
      mime: 'image/jpeg',
      width: 320,
      height: 176,
      alt: title + ' camera snapshot',
      subjects: [{app_id: 'brightwire-home', account_id: 'bw-household-morales', object_type: 'household', object_id: 'bw-household-morales'}]
    });
  }
  return made;
}

function catalog(made) {
  return {
    schema_version: 'pale.asset-catalog.v1',
    catalog_id: 'brightwire-home-assets',
    app_id: 'brightwire-home',
    dataset_ref: 'dataset.json',
    assets: made.map(item => {
      const bytes = fs.readFileSync(item.file);
      return {
        schema_version: 'pale.asset-descriptor.v1',
        asset_id: item.asset_id,
        scope: {level: 'package', app_id: 'brightwire-home'},
        roles: [item.role],
        subjects: item.subjects || (item.account_id ? [{app_id: 'brightwire-home', account_id: item.account_id, object_type: 'household', object_id: item.account_id}] : []),
        mime_type: item.mime,
        availability: {status: 'ready'},
        storage: {adapter: 'storage.file', path: path.relative(root, item.file).split(path.sep).join('/'), packaging: 'bundled'},
        integrity: {bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')},
        provenance: {dataset_id: 'brightwire-home-fixtures', source_ids: ['authored']},
        publication: 'public',
        access: item.access || {audience: ['reviewer'], rule: 'app_surface'},
        presentation: {alt_text: item.alt, caption: item.alt},
        media: {image: {width: item.width, height: item.height, animated: false}},
        extensions: []
      };
    }),
    extensions: []
  };
}

function main() {
  writeJson(path.join(root, 'schemas/seed.schema.json'), seedSchema);
  writeJson(path.join(root, 'schemas/events.schema.json'), eventsSchema);
  writeJson(path.join(root, 'tools.json'), tools);
  const minimal = morales({
    committed_through: stamp(2026, 11, 17, 12, 0),
    scopes: scopes('operate', {lock: 'confirm', camera: 'none', automations: 'confirm'})
  });
  const task = morales({
    committed_through: stamp(2026, 11, 17, 19, 42),
    scopes: scopes('operate'),
    evening: true
  });
  const older = ruth();
  const larger = chen();
  const seeds = {minimal, 'task-73': task, 'household-b': older, 'household-c': larger};
  const made = images();
  writeJson(path.join(root, 'contribution/assets.catalog.json'), catalog(made));
  const {compile} = require('../tests/schema-validator.cjs');
  const valid = compile(seedSchema, path.join(root, 'schemas'));
  const plugin = require('../plugin.cjs');
  for (const [name, data] of Object.entries(seeds)) {
    data.activity.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.activity_id.localeCompare(right.activity_id));
    if (!valid(data)) throw new Error('Seed schema rejected ' + name);
    const people = data.members.filter(item => item.role !== 'assistant').map(item => ({person_id: item.person_id, name: item.name}));
    if (name === 'minimal' || name === 'task-73') people.push({person_id: 'person-dev-patel', name: 'Dev Patel'});
    const ctx = {app_id: 'brightwire-home', binding: binding(data.account_id, data.owner_person_id, people, [data.account_id])};
    plugin.validateSeed(ctx, data);
    writeJson(path.join(root, 'fixtures', name + '.json'), data);
    writeJson(path.join(root, 'fixtures', 'binding-' + name + '.json'), ctx.binding);
  }
  fs.copyFileSync(path.join(root, 'fixtures/binding-minimal.json'), path.join(root, 'fixtures/binding.json'));
  writeJson(path.join(root, 'fixtures/clock.json'), {initial_time: stamp(2026, 11, 17, 12, 0)});
  writeJson(path.join(root, 'fixtures/policies.json'), {
    scenario: {allow: tools.filter(item => item.read_only).map(item => item.name), constraints: {}},
    sandbox: {allow: tools.map(item => item.name), constraints: {}}
  });
  console.log('Materialized ' + tools.length + ' tools and ' + made.length + ' images.');
}

if (require.main === module) main();
module.exports = {iconImage, planImage, snapshotImage, images};
