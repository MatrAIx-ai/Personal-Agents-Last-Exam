'use strict';
const {references, fail} = require('./domain-utils.cjs');
const {project, codeStatus} = require('./house.cjs');

const CLASSES = ['light', 'blind', 'thermostat', 'switch', 'lock', 'garage', 'camera', 'speaker', 'automations', 'modes', 'access_codes'];
const SENSORS = ['contact', 'motion', 'temperature', 'leak', 'smoke'];
const CONTROLS = ['light', 'blind', 'thermostat', 'switch', 'lock', 'garage', 'camera', 'speaker'];
const RANK = {none: 0, view: 1, confirm: 2, operate: 3};

function validateSeed(ctx, data) {
  references(ctx, data);
  const account = (ctx.binding.accounts || []).find(item => item.account_id === data.account_id);
  if (!account || account.owner_person_id !== data.owner_person_id) {
    fail('invalid_seed', 'The household owner does not match the account binding.');
  }
  const rooms = new Set(data.rooms.map(room => room.room_id));
  if (rooms.size !== data.rooms.length) fail('invalid_seed', 'Room ids must be unique.');
  const devices = new Map();
  for (const device of data.devices) {
    if (devices.has(device.device_id)) fail('invalid_seed', 'Device ids must be unique.');
    devices.set(device.device_id, device);
    if (!rooms.has(device.room_id)) fail('invalid_seed', 'Every device belongs to a room.');
    checkDevice(device);
  }
  if (!data.members.some(member => member.person_id === data.owner_person_id && member.role === 'owner')) {
    fail('invalid_seed', 'The owner must be a household member.');
  }
  if (!data.members.some(member => member.role === 'assistant')) fail('invalid_seed', 'The household needs an assistant member.');
  const people = new Set(ctx.binding.people.map(person => person.person_id));
  for (const member of data.members) {
    if (member.role !== 'assistant' && !people.has(member.person_id)) fail('invalid_seed', 'A member is missing from the binding.');
  }
  for (const className of CLASSES) {
    if (!['operate', 'confirm', 'view', 'none'].includes(data.scopes[className])) fail('invalid_seed', 'Every scope class needs a scope.');
  }
  for (const rule of data.mode_rules) {
    if (RANK[rule.scope] > RANK[data.scopes[rule.class]]) fail('invalid_seed', 'A mode rule can only restrict a scope.');
  }
  for (const routine of data.routines) {
    for (const action of routine.actions) {
      if (action.kind === 'set_mode') continue;
      if (!devices.has(action.device_id)) fail('invalid_seed', 'A routine action names an unknown device.');
    }
  }
  for (const scene of data.scenes) {
    for (const action of scene.actions) {
      if (action.kind === 'set_mode') continue;
      if (!devices.has(action.device_id)) fail('invalid_seed', 'A scene action names an unknown device.');
    }
  }
  const nowMs = Date.parse(ctx.virtual_now || data.committed_through);
  const windows = data.access_codes.filter(code => {
    if (code.schedule.kind !== 'window') return false;
    const status = codeStatus(code, nowMs, data.utc_offset, data);
    return status !== 'revoked' && status !== 'expired';
  });
  checkSnapshots(ctx, data);
  if (!data.allow_overlapping_codes) {
    for (let index = 0; index < windows.length; index += 1) {
      for (let other = index + 1; other < windows.length; other += 1) {
        const left = windows[index];
        const right = windows[other];
        const shared = left.locks.some(lock => right.locks.includes(lock));
        const overlap = Date.parse(left.schedule.start) < Date.parse(right.schedule.end) && Date.parse(right.schedule.start) < Date.parse(left.schedule.end);
        if (shared && overlap) fail('invalid_seed', 'Code windows on the same lock overlap.');
      }
    }
  }
  for (const device of data.devices) {
    const rows = data.activity.filter(entry => entry.device_id === device.device_id && entry.before && entry.after);
    for (let index = 1; index < rows.length; index += 1) {
      if (JSON.stringify(rows[index].before) !== JSON.stringify(rows[index - 1].after)) {
        fail('invalid_seed', 'Activity for ' + device.device_id + ' does not replay.');
      }
    }
    if (rows.length && JSON.stringify(rows[rows.length - 1].after) !== JSON.stringify(project(device))) {
      fail('invalid_seed', 'Activity for ' + device.device_id + ' does not end at the seeded state.');
    }
    if (device.type === 'switch') {
      checkEnergy(device);
      checkEnergyHistory(device, data.activity);
    } else if (device.energy.length) fail('invalid_seed', 'Only switches carry energy intervals.');
  }
}

const packageCatalog = require('../contribution/assets.catalog.json');

function checkSnapshots(ctx, data) {
  const assets = packageCatalog.assets || [];
  for (const id of data.available_snapshots || []) {
    const asset = assets.find(item => item.asset_id === id);
    const snapshot = asset && Array.isArray(asset.roles) && asset.roles.includes('ui.snapshot');
    if (!asset || !snapshot || !asset.availability || asset.availability.status !== 'ready') {
      fail('invalid_seed', 'available_snapshots lists ' + id + ' without a ready snapshot in the package catalog.');
    }
  }
}

function checkDevice(device) {
  const type = device.type;
  if (type === 'light') {
    if (!['on', 'off'].includes(device.power)) fail('invalid_seed', 'A light needs power on or off.');
    if (!Number.isInteger(device.brightness) || device.brightness < 1 || device.brightness > 100) fail('invalid_seed', 'Light brightness is out of range.');
  }
  if (type === 'blind' && (!Number.isInteger(device.position) || device.position < 0 || device.position > 100)) fail('invalid_seed', 'Blind position is out of range.');
  if (type === 'thermostat') {
    if (!['heat', 'cool', 'off'].includes(device.thermo_mode)) fail('invalid_seed', 'Thermostat mode is invalid.');
    if (!(device.owner_min <= device.setpoint && device.setpoint <= device.owner_max)) fail('invalid_seed', 'The seeded setpoint is outside the owner range.');
  }
  if (type === 'switch' && !['on', 'off'].includes(device.power)) fail('invalid_seed', 'A switch needs power on or off.');
  if (type === 'lock' && !['locked', 'unlocked', 'jammed'].includes(device.lock)) fail('invalid_seed', 'Lock state is invalid.');
  if (type === 'garage' && !['closed', 'open', 'obstructed'].includes(device.garage)) fail('invalid_seed', 'Garage state is invalid.');
  if (type === 'camera' && !['privacy_on', 'privacy_off'].includes(device.privacy)) fail('invalid_seed', 'Camera privacy is invalid.');
  if (type === 'speaker' && (!Number.isInteger(device.volume) || device.volume < 0 || device.volume > 100)) fail('invalid_seed', 'Speaker volume is out of range.');
  if (SENSORS.includes(type) && typeof device.sensor !== 'string') fail('invalid_seed', 'A sensor needs a state.');
  if (!CONTROLS.includes(type) && !SENSORS.includes(type)) fail('invalid_seed', 'Unknown device type.');
}

function intervalsFromActivity(device, activity) {
  const rows = activity.filter(entry => entry.device_id === device.device_id && entry.before && entry.after && entry.before.power !== entry.after.power);
  const intervals = [];
  let open = null;
  for (const row of rows) {
    if (row.after.power === 'on' && row.before.power !== 'on') {
      if (!open) open = row.at;
    } else if (row.after.power === 'off' && row.before.power === 'on' && open) {
      if (Date.parse(row.at) > Date.parse(open)) intervals.push({from: open, to: row.at});
      open = null;
    }
  }
  if (open) intervals.push({from: open, to: null});
  return intervals;
}

function checkEnergyHistory(device, activity) {
  const expected = intervalsFromActivity(device, activity);
  const actual = device.energy.map(interval => ({from: interval.from, to: interval.to}));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    fail('invalid_seed', 'Energy intervals for ' + device.device_id + ' do not match the activity history.');
  }
}

function checkEnergy(device) {
  let previous = 0;
  let open = 0;
  for (const interval of device.energy) {
    const from = Date.parse(interval.from);
    const to = interval.to == null ? null : Date.parse(interval.to);
    if (!Number.isFinite(from) || from < previous) fail('invalid_seed', 'Energy intervals are out of order.');
    if (to == null) open += 1;
    else if (!(to > from)) fail('invalid_seed', 'An energy interval ends before it starts.');
    previous = to || from;
  }
  if (device.power === 'on' && open !== 1) fail('invalid_seed', 'A switch that is on needs one open energy interval.');
  if (device.power === 'off' && open !== 0) fail('invalid_seed', 'A switch that is off cannot have an open energy interval.');
  const rated = device.rated_watts;
  let wattHours = 0;
  for (const interval of device.energy) {
    if (!interval.to) continue;
    wattHours += rated * ((Date.parse(interval.to) - Date.parse(interval.from)) / 3600000);
  }
  if (Math.abs(wattHours / 1000 - device.energy_kwh_closed) > 0.001) {
    fail('invalid_seed', 'Closed energy for ' + device.device_id + ' does not match rated watts.');
  }
}

function records(data) {
  return [{id: data.account_id, account_id: data.account_id, name: data.household_name}];
}

function objects(data) {
  return [
    data.account_id,
    ...data.rooms.map(room => room.room_id),
    ...data.devices.map(device => device.device_id),
    ...data.scenes.map(scene => scene.scene_id),
    ...data.routines.map(routine => routine.routine_id)
  ];
}

function assetReferences(data) {
  const owned = new Set();
  for (const asset of packageCatalog.assets || []) {
    const subject = Array.isArray(asset.subjects) ? asset.subjects[0] : null;
    if (subject && subject.object_type === 'household' && subject.account_id === data.account_id && subject.object_id === data.account_id) {
      owned.add(asset.asset_id);
    }
  }
  return (data.available_snapshots || []).filter(asset_id => owned.has(asset_id)).map(asset_id => ({
    asset_id,
    object_type: 'household',
    object_id: data.account_id
  }));
}

const committedSnapshots = new Map();

function rememberCatalog(accountId, bundle) {
  if (!accountId || !bundle || !bundle.catalog || !Array.isArray(bundle.catalog.assets)) return;
  const index = new Map();
  for (const asset of bundle.catalog.assets) {
    index.set(asset.asset_id, {
      snapshot: Array.isArray(asset.roles) && asset.roles.includes('ui.snapshot'),
      ready: Boolean(asset.availability && asset.availability.status === 'ready')
    });
  }
  committedSnapshots.set(accountId, index);
}

function committedSnapshotReady(data, assetId) {
  const index = committedSnapshots.get(data && data.account_id);
  if (!index) return true;
  const row = index.get(assetId);
  if (!row) return false;
  return row.snapshot && row.ready;
}

function loadedAssets() {
  const marker = require('path').join('runtime', 'core', 'assets.cjs');
  for (const key of Object.keys(require.cache)) {
    if (key.endsWith(marker)) return require.cache[key].exports;
  }
  return null;
}

function installSnapshotWatch() {
  const assetsApi = loadedAssets();
  if (!assetsApi || assetsApi.check.__brightwireSnapshots) return;
  const originalCheck = assetsApi.check;
  function check(pkg, data, bundle, options) {
    const result = originalCheck.apply(this, arguments);
    if (pkg && pkg.manifest && pkg.manifest.app_id === 'brightwire-home' && data && result && result.bundle) {
      rememberCatalog(data.account_id, result.bundle);
    }
    return result;
  }
  check.__brightwireSnapshots = true;
  assetsApi.check = check;
}

installSnapshotWatch();

module.exports = {validateSeed, records, objects, references: () => [], assetReferences, committedSnapshotReady};
