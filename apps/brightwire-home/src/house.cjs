'use strict';
// Brightwire household transitions.
// Reads compute time-derived status and write nothing.
// The next write or event commits relocks and scheduled routines that fell due,
// then performs its own change. A thrown error discards both, because Core
// keeps the previous copy.

const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const time = require('./time.cjs');

const APP = 'brightwire-home';
const PREFIX = APP + '.';
const DEVICE_CLASSES = ['light', 'blind', 'thermostat', 'switch', 'lock', 'garage', 'camera', 'speaker'];
const SENSOR_TYPES = ['contact', 'motion', 'temperature', 'leak', 'smoke'];
const SCOPE_RANK = {none: 0, view: 1, confirm: 2, operate: 3};
const CONFIRM_MS = 10 * 60 * 1000;
const PROJECT_KEYS = ['power', 'brightness', 'color_temperature', 'position', 'thermo_mode', 'setpoint', 'lock', 'garage', 'privacy', 'volume', 'sensor', 'sensor_value', 'fault', 'online'];

function tighter(left, right) {
  return SCOPE_RANK[left] <= SCOPE_RANK[right] ? left : right;
}

function findDevice(data, deviceId) {
  return data.devices.find(device => device.device_id === deviceId) || null;
}

function requireDevice(data, deviceId) {
  const device = findDevice(data, deviceId);
  if (!device) fail('device_not_found', 'No device with that id is in this household.');
  return device;
}

function findRoutine(data, routineId) {
  return data.routines.find(routine => routine.routine_id === routineId) || null;
}

function requireRoutine(data, routineId) {
  const routine = findRoutine(data, routineId);
  if (!routine || routine.deleted) fail('routine_not_found', 'That routine does not exist.');
  return routine;
}

function findScene(data, sceneId) {
  return data.scenes.find(scene => scene.scene_id === sceneId) || null;
}

function requireScene(data, sceneId) {
  const scene = findScene(data, sceneId);
  if (!scene || scene.deleted) fail('scene_not_found', 'That scene does not exist.');
  return scene;
}

function project(device) {
  const view = {type: device.type};
  for (const key of PROJECT_KEYS) view[key] = device[key];
  return view;
}

function sameProject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nextId(data, key, prefix) {
  const value = data.counters[key];
  data.counters[key] = value + 1;
  return prefix + '-' + value;
}

function stamp(ctx) {
  return ctx.virtual_now;
}

function activity(ctx, data, fields) {
  const entry = {
    activity_id: nextId(data, 'activity', 'act'),
    at: fields.at || stamp(ctx),
    actor_kind: fields.actor_kind,
    actor_id: fields.actor_id,
    caller_role: ctx.role === 'agent' || ctx.role === 'infra' ? ctx.role : null,
    cause: fields.cause,
    request_id: fields.request_id || null,
    event_id: fields.event_id || null,
    device_id: fields.device_id || null,
    command: fields.command || null,
    summary: fields.summary,
    before: fields.before || null,
    after: fields.after || null
  };
  data.activity.push(entry);
  log(ctx, 'brightwire-home.activity', {activity_id: entry.activity_id, device_id: entry.device_id, command: entry.command});
  return entry;
}

function carriedModes(data) {
  return Array.isArray(data.assistant_carried_modes) ? data.assistant_carried_modes.slice() : [];
}

function effectiveScope(data, className) {
  let scope = data.scopes[className] || 'none';
  const modes = [data.home_mode, ...carriedModes(data)];
  for (const mode of modes) {
    const rule = data.mode_rules.find(item => item.mode === mode && item.class === className);
    if (rule) scope = tighter(scope, rule.scope);
  }
  return scope;
}

function deviceClass(device) {
  return DEVICE_CLASSES.includes(device.type) ? device.type : null;
}

function ownedByAssistant(record) {
  return record.created_by === 'assistant';
}

function assertOperateActions(data, actions) {
  for (const action of actions) {
    if (action.kind === 'set_mode') {
      if (effectiveScope(data, 'modes') !== 'operate') fail('scope_insufficient', 'An unattended mode change needs operate scope.');
      continue;
    }
    const device = requireDevice(data, action.device_id);
    const className = deviceClass(device);
    if (!className) fail('unknown_device_in_action', 'A sensor cannot be an action target.');
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, className) || !COMMANDS[className][action.command]) {
      fail('unknown_device_in_action', 'The action command is not valid for that device.');
    }
    if (effectiveScope(data, className) !== 'operate') fail('scope_insufficient', 'Unattended actions must be on a class the assistant can operate.');
  }
}

function checkTrigger(data, trigger) {
  const kinds = ['clock', 'sunrise', 'sunset', 'sensor', 'device_state', 'member_arrives', 'member_leaves', 'manual'];
  if (!trigger || !kinds.includes(trigger.kind)) fail('invalid_trigger', 'The trigger kind is not supported.');
  if (trigger.kind === 'clock' && time.clockMinutes(trigger.time) === null) fail('invalid_trigger', 'A clock trigger needs a HH:MM time.');
  if (trigger.kind === 'sensor' || trigger.kind === 'device_state') {
    const device = requireDevice(data, trigger.device_id);
    if (trigger.kind === 'sensor' && !SENSOR_TYPES.includes(device.type)) fail('invalid_trigger', 'That device is not a sensor.');
  }
  if ((trigger.kind === 'member_arrives' || trigger.kind === 'member_leaves') && trigger.person_id) {
    if (!data.members.some(member => member.person_id === trigger.person_id)) fail('invalid_trigger', 'The trigger names a person who is not a member.');
  }
}

function checkConditions(data, conditions) {
  for (const condition of conditions || []) {
    if (!['time_window', 'home_mode', 'device_state'].includes(condition.kind)) fail('invalid_trigger', 'The condition kind is not supported.');
    if (condition.kind === 'time_window' && (time.clockMinutes(condition.start) === null || time.clockMinutes(condition.end) === null)) {
      fail('invalid_trigger', 'A time window needs HH:MM bounds.');
    }
    if (condition.kind === 'home_mode' && !['home', 'away', 'night'].includes(condition.mode)) fail('invalid_trigger', 'The mode condition is not a home mode.');
    if (condition.kind === 'device_state') requireDevice(data, condition.device_id);
  }
}

function conditionsMet(data, routine, atMs) {
  for (const condition of routine.conditions) {
    if (condition.kind === 'time_window') {
      const local = time.parts(data.utc_offset, atMs);
      if (!time.inSpan(local.hour * 60 + local.minute, condition.start, condition.end)) return false;
    } else if (condition.kind === 'home_mode') {
      if (data.home_mode !== condition.mode) return false;
    } else if (condition.kind === 'device_state') {
      const device = findDevice(data, condition.device_id);
      if (!device || !matchesState(device, condition.equals || {})) return false;
    }
  }
  return true;
}

function matchesState(device, equals) {
  const view = project(device);
  return Object.entries(equals).every(([key, value]) => view[key] === value);
}

function operable(device, command) {
  if (SENSOR_TYPES.includes(device.type)) fail('unsupported_command', 'Sensors change through events.');
  if (!device.online || device.fault === 'offline') fail('device_offline', 'The device is offline.');
  if (device.fault === 'jammed') fail('jammed', 'The lock is jammed.');
  if (device.type === 'garage' && device.fault === 'obstructed' && command === 'close') fail('obstructed', 'The garage door is obstructed.');
}

function openEnergy(device, at) {
  if (device.energy.some(interval => interval.to === null)) return;
  device.energy.push({from: at, to: null});
}

function closeEnergy(device, at) {
  const index = device.energy.findIndex(interval => interval.to === null);
  if (index < 0) return;
  const open = device.energy[index];
  if (Date.parse(open.from) >= Date.parse(at)) device.energy.splice(index, 1);
  else open.to = at;
}

const COMMANDS = {
  light: {
    turn_on(device) { device.power = 'on'; },
    turn_off(device) { device.power = 'off'; },
    set_brightness(device, args) {
      const value = args.brightness;
      if (!Number.isInteger(value) || value < 1 || value > 100) fail('value_out_of_range', 'Brightness must be an integer from 1 to 100.');
      device.brightness = value;
      device.power = 'on';
    },
    set_color_temperature(device, args) {
      const value = args.color_temperature;
      if (!Number.isInteger(value) || value < 2200 || value > 6500) fail('value_out_of_range', 'Colour temperature must be an integer from 2200 to 6500.');
      device.color_temperature = value;
    }
  },
  blind: {
    set_position(device, args) {
      const value = args.position;
      if (!Number.isInteger(value) || value < 0 || value > 100) fail('value_out_of_range', 'Blind position must be an integer from 0 to 100.');
      device.position = value;
    },
    open(device) { device.position = 100; },
    close(device) { device.position = 0; }
  },
  thermostat: {
    set_mode(device, args) {
      if (!['heat', 'cool', 'off'].includes(args.mode)) fail('unsupported_command', 'Thermostat mode must be heat, cool or off.');
      device.thermo_mode = args.mode;
    },
    set_setpoint(device, args) {
      const value = args.setpoint;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 40 || value > 95) fail('value_out_of_range', 'Setpoint must be a number from 40 to 95.');
      if (value < device.owner_min || value > device.owner_max) fail('setpoint_outside_owner_range', 'The setpoint is outside the range the owner set for this room.');
      device.setpoint = value;
    }
  },
  switch: {
    turn_on(device, args, at) { device.power = 'on'; openEnergy(device, at); },
    turn_off(device, args, at) { device.power = 'off'; closeEnergy(device, at); }
  },
  lock: {
    lock(device) { device.lock = 'locked'; device.unlocked_at = null; },
    unlock(device, args, at) { device.lock = 'unlocked'; device.unlocked_at = at; }
  },
  garage: {
    open(device) { device.garage = 'open'; },
    close(device) { device.garage = 'closed'; }
  },
  camera: {
    set_privacy(device, args) {
      if (!['privacy_on', 'privacy_off'].includes(args.privacy)) fail('unsupported_command', 'Privacy must be privacy_on or privacy_off.');
      device.privacy = args.privacy;
    }
  },
  speaker: {
    set_volume(device, args) {
      const value = args.volume;
      if (!Number.isInteger(value) || value < 0 || value > 100) fail('value_out_of_range', 'Volume must be an integer from 0 to 100.');
      device.volume = value;
    },
    announce(device, args, at, data) {
      const text = args.text;
      if (typeof text !== 'string' || !text.trim() || text.length > 240) fail('value_out_of_range', 'An announcement needs text of 1 to 240 characters.');
      data.announcements.push({at, device_id: device.device_id, text});
    }
  }
};

function refreshClosedEnergy(device) {
  if (device.type !== 'switch') return;
  let wattHours = 0;
  for (const interval of device.energy) {
    if (!interval.to) continue;
    wattHours += device.rated_watts * ((Date.parse(interval.to) - Date.parse(interval.from)) / 3600000);
  }
  device.energy_kwh_closed = Math.round((wattHours / 1000) * 1000) / 1000;
}

function applyCommand(data, device, command, args, at) {
  const table = COMMANDS[device.type];
  if (!table || !table[command]) fail('unsupported_command', 'That command is not valid for this device.');
  operable(device, command);
  const before = project(device);
  table[command](device, args || {}, at, data);
  refreshClosedEnergy(device);
  return {before, after: project(device)};
}

function observedLock(device, nowMs) {
  if (device.type !== 'lock') return device.lock;
  if (device.fault === 'jammed' || device.lock === 'jammed') return device.lock;
  if (device.lock === 'unlocked' && device.unlocked_at && device.auto_relock_minutes) {
    const due = Date.parse(device.unlocked_at) + device.auto_relock_minutes * 60000;
    if (nowMs >= due) return 'locked';
  }
  return device.lock;
}

function confirmationStatus(item, nowMs) {
  if (item.status !== 'pending') return item.status;
  if (nowMs >= Date.parse(item.created_at) + CONFIRM_MS) return 'expired';
  return 'pending';
}

function recurringWeekday(offset, nowMs, schedule) {
  const local = time.parts(offset, nowMs);
  const minute = local.hour * 60 + local.minute;
  const start = time.clockMinutes(schedule.start_time);
  const end = time.clockMinutes(schedule.end_time);
  const when = start > end && minute < end ? nowMs - 24 * 60 * 60000 : nowMs;
  return time.weekday(offset, when);
}

function codeStatus(code, nowMs, offset, data) {
  if (code.revoked) return 'revoked';
  if (code.approval === 'pending') {
    if (data && pendingCodeClosed(data, code, nowMs)) return 'expired';
    return 'scheduled';
  }
  const schedule = code.schedule;
  if (schedule.kind === 'always') return 'active';
  if (schedule.kind === 'window') {
    const start = Date.parse(schedule.start);
    const end = Date.parse(schedule.end);
    if (nowMs < start) return 'scheduled';
    if (nowMs >= end) return 'expired';
    return 'active';
  }
  const local = time.parts(offset, nowMs);
  const minute = local.hour * 60 + local.minute;
  const day = recurringWeekday(offset, nowMs, schedule);
  if (schedule.days.includes(day) && time.inSpan(minute, schedule.start_time, schedule.end_time)) return 'active';
  return 'scheduled';
}

function shareStatus(session, nowMs) {
  if (session.stopped_at) return 'ended';
  const end = Date.parse(session.started_at) + session.duration_minutes * 60000;
  return nowMs >= end ? 'ended' : 'active';
}

function shareEnd(session, nowMs, offset) {
  if (session.stopped_at) return session.stopped_at;
  const endMs = Date.parse(session.started_at) + session.duration_minutes * 60000;
  if (nowMs >= endMs) return time.formatInstant(offset, endMs);
  return null;
}

function alertStatus(alert, nowMs) {
  if (alert.acknowledged_at) return 'acknowledged';
  if (alert.snooze_until && nowMs < Date.parse(alert.snooze_until)) return 'snoozed';
  return 'open';
}

function presentDevice(data, device, nowMs) {
  const observed = project(device);
  if (device.type === 'lock') observed.lock = observedLock(device, nowMs);
  const relock = device.type === 'lock' && device.lock === 'unlocked' && device.unlocked_at && device.auto_relock_minutes
    ? time.formatInstant(data.utc_offset, Date.parse(device.unlocked_at) + device.auto_relock_minutes * 60000)
    : null;
  const view = {
    device_id: device.device_id,
    room_id: device.room_id,
    type: device.type,
    name: device.name,
    online: device.online && device.fault !== 'offline',
    fault: device.fault,
    observed,
    pending_relock_at: observed.lock === 'locked' && device.lock === 'unlocked' ? relock : null,
    snapshot_asset_id: device.snapshot_asset_id,
    hearth_appliance_id: device.hearth_appliance_id
  };
  if (device.type === 'thermostat') {
    view.current_temperature = device.current_temperature;
    view.owner_min = device.owner_min;
    view.owner_max = device.owner_max;
  }
  if (device.type === 'switch') {
    view.rated_watts = device.rated_watts;
    view.high_load = !!device.high_load;
  }
  if (device.type === 'camera') {
    view.sessions = data.sessions.filter(session => session.device_id === device.device_id).map(session => ({
      session_id: session.session_id,
      started_at: session.started_at,
      duration_minutes: session.duration_minutes,
      status: shareStatus(session, nowMs)
    }));
  }
  if (device.type === 'speaker') {
    view.announcements = data.announcements.filter(item => item.device_id === device.device_id).map(item => ({at: item.at, text: item.text}));
  }
  if (device.sensor_value != null) view.sensor_value = device.sensor_value;
  return view;
}

function presentRoutine(data, routine, nowMs) {
  const due = scheduledOccurrences(data, routine, Date.parse(data.committed_through), nowMs).map(item => ({
    scheduled_for: time.formatInstant(data.utc_offset, item.at),
    disposition: item.disposition,
    late_minutes: Math.floor((nowMs - item.at) / 60000)
  }));
  return {
    routine_id: routine.routine_id,
    name: routine.name,
    enabled: routine.enabled,
    deleted: routine.deleted,
    created_by: routine.created_by,
    created_by_person_id: routine.created_by_person_id || null,
    last_edited_by: routine.last_edited_by,
    run_as: routine.run_as,
    trigger: copy(routine.trigger),
    conditions: copy(routine.conditions),
    actions: copy(routine.actions),
    catch_up_minutes: routine.catch_up_minutes,
    due_since: routine.enabled && !routine.deleted ? due : []
  };
}

function maskCode(code, nowMs, offset, data) {
  return {
    code_id: code.code_id,
    name: code.name,
    holder_name: code.holder_name,
    holder_person_id: code.holder_person_id,
    digits_masked: '******',
    schedule: copy(code.schedule),
    locks: copy(code.locks),
    status: codeStatus(code, nowMs, offset, data),
    approval: code.approval
  };
}

function quietAt(data, atMs) {
  const local = time.parts(data.utc_offset, atMs);
  const minute = local.hour * 60 + local.minute;
  if (data.quiet_hours && time.inSpan(minute, data.quiet_hours.start, data.quiet_hours.end)) return true;
  return data.members.some(member => member.quiet_hours && time.inSpan(minute, member.quiet_hours.start, member.quiet_hours.end));
}

function raiseAlert(ctx, data, fields) {
  const alert = {
    alert_id: nextId(data, 'alert', 'al'),
    kind: fields.kind,
    device_id: fields.device_id || null,
    created_at: fields.at || stamp(ctx),
    source_key: fields.source_key || null,
    acknowledged_at: null,
    snooze_until: null,
    summary: fields.summary
  };
  data.alerts.push(alert);
  queueNotice(ctx, data, {
    kind: fields.kind,
    at: alert.created_at,
    object_type: 'alert',
    object_id: alert.alert_id,
    title: fields.title,
    body: fields.summary
  });
  return alert;
}

function queueNotice(ctx, data, fields) {
  const notice = {
    notice_id: nextId(data, 'notice', 'nt'),
    kind: fields.kind,
    created_at: fields.at || stamp(ctx),
    recipient_person_id: data.owner_person_id,
    object_type: fields.object_type,
    object_id: fields.object_id,
    title: fields.title,
    body: fields.body,
    delivery_status: 'pending_delivery',
    publish_request_id: null,
    messaging_event_id: null
  };
  data.notices.push(notice);
  return notice;
}

function recordChange(ctx, data, device, change, meta) {
  activity(ctx, data, {
    at: meta.at || stamp(ctx),
    actor_kind: meta.actor_kind,
    actor_id: meta.actor_id,
    cause: meta.cause,
    request_id: meta.request_id || null,
    event_id: meta.event_id || null,
    device_id: device.device_id,
    command: meta.command,
    summary: meta.summary || (meta.command || 'change') + ' ' + device.name,
    before: change.before,
    after: change.after
  });
}

function applyDirect(ctx, data, device, command, args, meta) {
  const change = applyCommand(data, device, command, args, meta.at || stamp(ctx));
  recordChange(ctx, data, device, change, {...meta, command});
  considerDeviceTriggers(ctx, data, device, meta, meta.depth || 0);
  return change;
}

function considerDeviceTriggers(ctx, data, device, meta, depth = 0) {
  if (depth >= 8) return;
  for (const routine of data.routines) {
    if (!routine.enabled || routine.deleted || routine.trigger.kind !== 'device_state') continue;
    if (routine.trigger.device_id !== device.device_id) continue;
    if (!matchesState(device, routine.trigger.equals || {})) continue;
    const key = routine.routine_id + '@' + (meta.at || stamp(ctx));
    data.runtime_seen = data.runtime_seen || [];
    if (data.runtime_seen.includes(key)) continue;
    data.runtime_seen.push(key);
    runRoutine(ctx, data, routine, Date.parse(meta.at || stamp(ctx)), {...meta, cause: 'routine', depth: depth + 1, chained: true});
  }
}

function runRoutine(ctx, data, routine, atMs, meta) {
  const at = time.formatInstant(data.utc_offset, atMs);
  const firing = {
    firing_id: nextId(data, 'firing', 'fr'),
    routine_id: routine.routine_id,
    scheduled_for: meta.scheduled_for || at,
    fired_at: stamp(ctx),
    outcome: 'fired',
    reason: null,
    results: [],
    count: 1,
    range_end: null
  };
  if (!conditionsMet(data, routine, atMs)) {
    firing.outcome = 'conditions_unmet';
    data.firings.push(firing);
    return firing;
  }
  const runAs = routine.run_as === 'assistant' ? 'assistant' : 'owner';
  for (const action of routine.actions) {
    firing.results.push(runAction(ctx, data, action, {
      at,
      actor_kind: 'routine',
      actor_id: routine.routine_id,
      cause: 'routine',
      run_as: runAs,
      interactive: false,
      event_id: meta.event_id || null,
      request_id: meta.request_id || null,
      depth: meta.depth || 0
    }));
  }
  data.firings.push(firing);
  activity(ctx, data, {
    at: firing.fired_at,
    actor_kind: 'routine',
    actor_id: routine.routine_id,
    cause: 'routine',
    event_id: meta.event_id || null,
    request_id: meta.request_id || null,
    command: 'routine_fire',
    summary: routine.name + ' fired'
  });
  return firing;
}

function runAction(ctx, data, action, meta) {
  if (action.kind === 'set_mode') {
    if (meta.interactive) {
      const scope = effectiveScope(data, 'modes');
      if (scope === 'none' || scope === 'view') return {kind: 'set_mode', outcome: 'scope_insufficient', mode: action.mode};
      if (scope === 'confirm') {
        const confirmation = openConfirmation(ctx, data, {
          target: {kind: 'mode', id: action.mode},
          stored: {kind: 'set_mode', mode: action.mode, clear_carry: false},
          summary: 'Set mode to ' + action.mode
        });
        return {kind: 'set_mode', outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id, mode: action.mode};
      }
    } else if (meta.run_as === 'assistant' && effectiveScope(data, 'modes') !== 'operate') {
      return {kind: 'set_mode', outcome: 'scope_insufficient', mode: action.mode};
    }
    setMode(ctx, data, action.mode, meta.run_as !== 'assistant', meta);
    return {kind: 'set_mode', outcome: 'applied', mode: action.mode};
  }
  const device = findDevice(data, action.device_id);
  if (!device) return {device_id: action.device_id, command: action.command, outcome: 'device_not_found'};
  const className = deviceClass(device);
  if (meta.interactive) {
    const scope = className ? effectiveScope(data, className) : 'none';
    if (scope === 'none' || scope === 'view') return {device_id: device.device_id, command: action.command, outcome: 'scope_insufficient'};
    if (scope === 'confirm') {
      try {
        assertApplicable(device, action.command, action.args || {}, meta.at || stamp(ctx));
      } catch (error) {
        if (!error.code) throw error;
        return {device_id: device.device_id, command: action.command, outcome: error.code};
      }
      const confirmation = openConfirmation(ctx, data, {
        target: {kind: 'device', id: device.device_id},
        stored: {kind: 'device_command', device_id: device.device_id, command: action.command, args: action.args || {}},
        summary: action.command + ' ' + device.name
      });
      return {device_id: device.device_id, command: action.command, outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id};
    }
  } else if (meta.run_as === 'assistant' && className && effectiveScope(data, className) !== 'operate') {
    return {device_id: device.device_id, command: action.command, outcome: 'scope_insufficient'};
  }
  try {
    applyDirect(ctx, data, device, action.command, action.args || {}, meta);
    return {device_id: device.device_id, command: action.command, outcome: 'applied'};
  } catch (error) {
    if (!error.code) throw error;
    return {device_id: device.device_id, command: action.command, outcome: error.code};
  }
}

function setMode(ctx, data, mode, clearCarry, meta) {
  const previous = data.home_mode;
  const previousCarry = carriedModes(data);
  data.home_mode = mode;
  if (clearCarry) data.assistant_carried_modes = [];
  else if (previous !== mode && !previousCarry.includes(previous)) data.assistant_carried_modes = previousCarry.concat(previous);
  else data.assistant_carried_modes = previousCarry;
  const fromRoutine = meta && meta.actor_kind === 'routine';
  activity(ctx, data, {
    at: meta && meta.at,
    actor_kind: fromRoutine ? 'routine' : (clearCarry ? 'member' : 'assistant'),
    actor_id: fromRoutine ? meta.actor_id : (clearCarry ? (ctx.actor_id || data.owner_person_id) : 'assistant'),
    cause: fromRoutine ? (meta.cause || 'routine') : (ctx.cause || 'direct_command'),
    event_id: (meta && meta.event_id) || ctx.event_id || null,
    request_id: (meta && meta.request_id) || ctx.request_id || null,
    command: 'set_mode',
    summary: 'Mode ' + previous + ' to ' + mode,
    before: {home_mode: previous, assistant_carried_modes: previousCarry},
    after: {home_mode: data.home_mode, assistant_carried_modes: carriedModes(data)}
  });
}

function openConfirmation(ctx, data, fields) {
  const confirmation = {
    confirmation_id: nextId(data, 'confirmation', 'cf'),
    created_at: stamp(ctx),
    status: 'pending',
    target: fields.target,
    stored: fields.stored,
    summary: fields.summary,
    resolved_at: null,
    decision: null,
    by_person_id: null
  };
  data.confirmations.push(confirmation);
  queueNotice(ctx, data, {
    kind: 'confirmation_requested',
    object_type: 'confirmation',
    object_id: confirmation.confirmation_id,
    title: 'Brightwire: confirmation needed',
    body: fields.summary
  });
  activity(ctx, data, {
    actor_kind: 'assistant',
    actor_id: 'assistant',
    cause: 'confirmation',
    request_id: ctx.request_id || null,
    event_id: ctx.event_id || null,
    command: 'confirmation_required',
    summary: fields.summary
  });
  return confirmation;
}

function dayCount(offset, fromAt, toAt) {
  return time.dayNumber(time.parts(offset, toAt)) - time.dayNumber(time.parts(offset, fromAt)) + 1;
}

function clockOn(offset, day, minute) {
  return time.instant(offset, day.year, day.month, day.day, Math.floor(minute / 60), minute % 60);
}

function clockSpan(offset, fromMs, nowMs, minute) {
  const start = time.parts(offset, fromMs);
  let firstDay = {year: start.year, month: start.month, day: start.day};
  let first = clockOn(offset, firstDay, minute);
  if (first <= fromMs) {
    firstDay = time.addDays(firstDay, 1);
    first = clockOn(offset, firstDay, minute);
  }
  const end = time.parts(offset, nowMs);
  let lastDay = {year: end.year, month: end.month, day: end.day};
  let last = clockOn(offset, lastDay, minute);
  if (last > nowMs) {
    lastDay = time.addDays(lastDay, -1);
    last = clockOn(offset, lastDay, minute);
  }
  return {first, last};
}

function occurrenceOnOrAfter(offset, atMs, minute) {
  const part = time.parts(offset, atMs);
  let day = {year: part.year, month: part.month, day: part.day};
  let at = clockOn(offset, day, minute);
  if (at < atMs) {
    day = time.addDays(day, 1);
    at = clockOn(offset, day, minute);
  }
  return at;
}

function sunPlaceholder(offset, day, fromMs, nowMs) {
  const placeholder = time.instant(offset, day.year, day.month, day.day, 12, 0);
  if (placeholder > fromMs && placeholder <= nowMs) return placeholder;
  const now = time.parts(offset, nowMs);
  const sameDay = now.year === day.year && now.month === day.month && now.day === day.day;
  const dayStart = time.instant(offset, day.year, day.month, day.day, 0, 0);
  if (sameDay && fromMs <= placeholder && nowMs > placeholder && fromMs >= dayStart) return placeholder;
  return null;
}

function scheduledOccurrences(data, routine, fromMs, nowMs) {
  if (!routine.enabled || routine.deleted) return [];
  const kind = routine.trigger.kind;
  if (!['clock', 'sunrise', 'sunset'].includes(kind)) return [];
  const offset = data.utc_offset;
  const allowance = routine.catch_up_minutes * 60000;
  const found = [];
  if (kind === 'clock') {
    const minute = time.clockMinutes(routine.trigger.time);
    if (minute === null) return [];
    const span = clockSpan(offset, fromMs, nowMs, minute);
    if (!(span.last > fromMs) || span.last < span.first) return [];
    const earliestFire = nowMs - allowance;
    if (span.first < earliestFire) {
      const probe = occurrenceOnOrAfter(offset, span.first, minute);
      let missTo = probe;
      const boundary = occurrenceOnOrAfter(offset, earliestFire, minute);
      if (boundary >= earliestFire) {
        const part = time.parts(offset, boundary);
        const previous = time.addDays({year: part.year, month: part.month, day: part.day}, -1);
        missTo = clockOn(offset, previous, minute);
      }
      if (missTo >= span.first && missTo < earliestFire && missTo <= span.last) {
        found.push({
          at: span.first,
          disposition: 'miss',
          reason: 'late',
          count: dayCount(offset, span.first, missTo),
          from: span.first,
          to: missTo
        });
      }
    }
    const fireAt = span.first >= earliestFire ? span.first : occurrenceOnOrAfter(offset, earliestFire, minute);
    if (fireAt >= earliestFire && fireAt <= span.last && fireAt > fromMs && fireAt <= nowMs) {
      found.push({at: fireAt, disposition: 'fire', reason: null});
    }
    return found;
  }
  for (const day of time.datesTouched(offset, fromMs, nowMs)) {
    const row = data.sun_table.find(item => item.date === time.dateText(day));
    const text = row && row[kind];
    if (!row || !text) {
      const placeholder = sunPlaceholder(offset, day, fromMs, nowMs);
      if (placeholder !== null) {
        found.push({at: placeholder, disposition: 'miss', reason: 'no_sun_time', date: time.dateText(day)});
      }
      continue;
    }
    const minute = time.clockMinutes(text);
    if (minute === null) continue;
    const at = clockOn(offset, day, minute);
    if (at <= fromMs || at > nowMs) continue;
    const late = nowMs - at;
    found.push({at, disposition: late <= allowance ? 'fire' : 'miss', reason: late <= allowance ? null : 'late'});
  }
  return found;
}

function collectDue(data, fromMs, nowMs) {
  const effects = [];
  for (const device of data.devices) {
    if (device.type === 'lock' && device.lock === 'unlocked' && device.unlocked_at && device.auto_relock_minutes && device.fault !== 'jammed') {
      const at = Date.parse(device.unlocked_at) + device.auto_relock_minutes * 60000;
      if (at > fromMs && at <= nowMs) effects.push({at, kind: 'relock', id: device.device_id, unlocked_at: device.unlocked_at});
    }
    if (device.type === 'contact' && device.sensor === 'open' && device.opened_at && data.door_open_alert_minutes) {
      const at = Date.parse(device.opened_at) + data.door_open_alert_minutes * 60000;
      const key = device.device_id + '@' + device.opened_at;
      const already = data.alerts.some(alert => alert.source_key === key);
      if (!already && at > fromMs && at <= nowMs) effects.push({at, kind: 'door_open', id: device.device_id, source_key: key});
    }
  }
  for (const routine of data.routines) {
    for (const item of scheduledOccurrences(data, routine, fromMs, nowMs)) {
      effects.push({
        at: item.at,
        kind: item.disposition === 'fire' ? 'fire' : 'miss',
        id: routine.routine_id,
        reason: item.reason,
        count: item.count || 1,
        from: item.from || item.at,
        to: item.to || item.at,
        date: item.date || null
      });
    }
  }
  effects.sort((left, right) => left.at - right.at || String(left.id).localeCompare(String(right.id)) || left.kind.localeCompare(right.kind));
  return effects;
}

function collapseLateMisses(effects) {
  const grouped = new Map();
  const rest = [];
  for (const effect of effects) {
    if (effect.kind !== 'miss' || effect.reason !== 'late') {
      rest.push(effect);
      continue;
    }
    const current = grouped.get(effect.id) || {at: effect.at, kind: 'miss', id: effect.id, reason: 'late', count: 0, from: effect.from || effect.at, to: effect.to || effect.at};
    current.count += effect.count || 1;
    current.from = Math.min(current.from, effect.from || effect.at);
    current.to = Math.max(current.to, effect.to || effect.at);
    current.at = current.from;
    grouped.set(effect.id, current);
  }
  return rest.concat([...grouped.values()]);
}

function dueRank(effect, nowMs) {
  return effect.kind === 'relock' && effect.at <= nowMs ? 0 : 1;
}

function commitDue(ctx, data) {
  const nowMs = Date.parse(ctx.virtual_now);
  const fromMs = Date.parse(data.committed_through);
  if (!Number.isFinite(nowMs) || !Number.isFinite(fromMs) || nowMs <= fromMs) return;
  const pending = collapseLateMisses(collectDue(data, fromMs, nowMs));
  const seen = new Set();
  let guard = 0;
  let recordedMs = fromMs;
  while (pending.length && guard < 4000) {
    guard += 1;
    pending.sort((left, right) => dueRank(left, nowMs) - dueRank(right, nowMs) || left.at - right.at || String(left.id).localeCompare(String(right.id)) || left.kind.localeCompare(right.kind));
    const effect = pending.shift();
    const key = effect.kind + ':' + effect.id + ':' + effect.at + ':' + (effect.date || '') + ':' + (effect.unlocked_at || '');
    if (seen.has(key)) continue;
    seen.add(key);
    applyDue(ctx, data, effect, nowMs, pending, fromMs);
    const covered = Math.max(effect.at || 0, effect.to || 0);
    if (covered > recordedMs) recordedMs = covered;
  }
  data.committed_through = pending.length ? time.formatInstant(data.utc_offset, recordedMs) : ctx.virtual_now;
  data.runtime_seen = [];
}

function applyDue(ctx, data, effect, nowMs, pending, fromMs) {
  const at = time.formatInstant(data.utc_offset, effect.at);
  if (effect.kind === 'relock') {
    const device = findDevice(data, effect.id);
    if (!device || device.lock !== 'unlocked' || !device.unlocked_at || !device.auto_relock_minutes) return;
    if (effect.unlocked_at && device.unlocked_at !== effect.unlocked_at) return;
    if (Date.parse(device.unlocked_at) + device.auto_relock_minutes * 60000 !== effect.at) return;
    const before = project(device);
    device.lock = 'locked';
    device.unlocked_at = null;
    recordChange(ctx, data, device, {before, after: project(device)}, {
      at,
      actor_kind: 'routine',
      actor_id: 'auto-relock',
      cause: 'routine',
      command: 'lock',
      summary: device.name + ' auto-relock',
      request_id: ctx.request_id || null,
      event_id: ctx.event_id || null
    });
    considerDeviceTriggers(ctx, data, device, {
      at,
      request_id: ctx.request_id || null,
      event_id: ctx.event_id || null,
      actor_kind: 'routine',
      actor_id: 'auto-relock'
    }, 0);
    return;
  }
  if (effect.kind === 'door_open') {
    const device = findDevice(data, effect.id);
    if (!device || device.sensor !== 'open') return;
    raiseAlert(ctx, data, {
      kind: 'door_left_open',
      device_id: device.device_id,
      at,
      source_key: effect.source_key,
      title: 'Brightwire: a door is still open',
      summary: device.name + ' has stayed open.'
    });
    return;
  }
  const routine = findRoutine(data, effect.id);
  if (!routine || !routine.enabled || routine.deleted) return;
  if (effect.kind === 'miss') {
    const date = effect.date || at.slice(0, 10);
    if (effect.reason === 'no_sun_time' && data.firings.some(item => item.routine_id === routine.routine_id && item.reason === 'no_sun_time' && String(item.scheduled_for).slice(0, 10) === date)) return;
    data.firings.push({
      firing_id: nextId(data, 'firing', 'fr'),
      routine_id: routine.routine_id,
      scheduled_for: effect.reason === 'no_sun_time' ? at : time.formatInstant(data.utc_offset, effect.from || effect.at),
      fired_at: null,
      outcome: 'missed',
      reason: effect.reason || 'late',
      results: [],
      count: effect.count || 1,
      range_end: effect.count > 1 ? time.formatInstant(data.utc_offset, effect.to) : null
    });
    return;
  }
  const beforeLocks = data.devices.filter(device => device.type === 'lock' && device.lock === 'unlocked').map(device => device.device_id);
  runRoutine(ctx, data, routine, nowMs, {scheduled_for: at, event_id: ctx.event_id || null, request_id: ctx.request_id || null});
  for (const device of data.devices) {
    if (device.type !== 'lock' || device.lock !== 'unlocked' || !device.unlocked_at || !device.auto_relock_minutes) continue;
    if (beforeLocks.includes(device.device_id)) continue;
    const relockAt = Date.parse(device.unlocked_at) + device.auto_relock_minutes * 60000;
    if (relockAt > fromMs && relockAt <= nowMs) pending.push({at: relockAt, kind: 'relock', id: device.device_id, unlocked_at: device.unlocked_at});
  }
}

function assertActionArguments(device, command, args) {
  const table = COMMANDS[device.type];
  const trial = structuredClone(device);
  table[command](trial, args || {}, '2026-01-01T12:00:00-06:00', {announcements: []});
}

function assertApplicable(device, command, args, at) {
  const trial = structuredClone(device);
  applyCommand({announcements: []}, trial, command, args || {}, at);
}

function emailAddress(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 200 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  return domain.includes('.') && domain[0] !== '.' && !domain.endsWith('.');
}

function assertShare(device, recipient, duration) {
  if (device.type !== 'camera') fail('unsupported_command', 'Only a camera can be shared.');
  operable(device, 'share');
  if (device.privacy !== 'privacy_off') fail('unsupported_command', 'The camera is in privacy mode.');
  if (!emailAddress(recipient)) fail('invalid_arguments', 'The recipient must be an address.');
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) fail('value_out_of_range', 'Share duration must be 1 to 1440 minutes.');
}

function scopeOrConfirm(ctx, data, className, stored, target, summary, validate) {
  const scope = effectiveScope(data, className);
  if (scope === 'none' || scope === 'view') fail('scope_insufficient', 'The assistant scope for ' + className + ' does not allow this.');
  if (scope === 'confirm') {
    if (validate) validate();
    const confirmation = openConfirmation(ctx, data, {target, stored, summary});
    return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id};
  }
  return null;
}

function requireAutomation(data, record) {
  if (ownedByAssistant(record)) return 'own';
  const scope = effectiveScope(data, 'automations');
  if (scope === 'none' || scope === 'view') fail('scope_insufficient', 'Changing a routine or scene created by someone else needs the automations scope.');
  return scope;
}

function normalizedActions(data, actions) {
  if (!Array.isArray(actions) || !actions.length) fail('invalid_trigger', 'A routine or scene needs at least one action.');
  return actions.map(action => {
    if (action.kind === 'set_mode') {
      if (!['home', 'away', 'night'].includes(action.mode)) fail('invalid_trigger', 'The mode action is not a home mode.');
      return {kind: 'set_mode', mode: action.mode};
    }
    const device = requireDevice(data, action.device_id);
    if (!COMMANDS[device.type] || !COMMANDS[device.type][action.command]) fail('unknown_device_in_action', 'The action does not match the device.');
    const args = copy(action.args || {});
    assertActionArguments(device, action.command, args);
    return {kind: 'device', device_id: action.device_id, command: action.command, args};
  });
}

function energyKwh(data, device, startMs, endMs, nowMs) {
  let wattHours = 0;
  for (const interval of device.energy) {
    const from = Date.parse(interval.from);
    const to = interval.to ? Date.parse(interval.to) : Math.min(nowMs, endMs);
    const left = Math.max(from, startMs);
    const right = Math.min(to, endMs);
    if (right > left) wattHours += device.rated_watts * ((right - left) / 3600000);
  }
  return wattHours / 1000;
}

function earliestHistory(data) {
  const stamps = [];
  for (const entry of data.activity) stamps.push(Date.parse(entry.at));
  for (const device of data.devices) for (const interval of device.energy) stamps.push(Date.parse(interval.from));
  for (const alert of data.alerts) stamps.push(Date.parse(alert.created_at));
  const finite = stamps.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : Date.parse(data.committed_through);
}

function foldName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function makeDigits(serial) {
  return String(100000 + ((serial * 7919 + 104729) % 900000));
}

function pendingCodeClosed(data, code, nowMs) {
  if (code.approval !== 'pending' || !code.pending_confirmation_id) return false;
  const item = data.confirmations.find(confirmation => confirmation.confirmation_id === code.pending_confirmation_id);
  if (!item) return false;
  if (item.status === 'denied' || item.status === 'cancelled') return true;
  return confirmationStatus(item, nowMs) === 'expired';
}

function activeCodeCount(data, nowMs) {
  return data.access_codes.filter(code => codeStatus(code, nowMs, data.utc_offset, data) !== 'revoked' && codeStatus(code, nowMs, data.utc_offset, data) !== 'expired').length;
}

function projectedCodeCount(data, nowMs, codeId, schedule) {
  return data.access_codes.filter(code => {
    if (code.revoked) return false;
    const view = code.code_id === codeId
      ? {...code, schedule, approval: 'approved', pending_confirmation_id: null}
      : code;
    const status = codeStatus(view, nowMs, data.utc_offset, data);
    return status === 'active' || status === 'scheduled';
  }).length;
}

function rangesOverlap(left, right) {
  return Date.parse(left.start) < Date.parse(right.end) && Date.parse(right.start) < Date.parse(left.end);
}

function assertCodeSchedule(data, schedule, nowMs, ignoreId) {
  if (!schedule || !['always', 'window', 'recurring'].includes(schedule.kind)) fail('invalid_arguments', 'The schedule kind is not supported.');
  if (schedule.kind === 'window') {
    const start = Date.parse(schedule.start);
    const end = Date.parse(schedule.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('invalid_arguments', 'The window needs a start before its end.');
    if (start < nowMs) fail('window_in_past', 'The code window starts in the past.');
    if (end - start > data.max_code_window_hours * 3600000) fail('window_too_long', 'The code window is longer than the owner allows.');
  }
  if (schedule.kind === 'recurring') {
    if (!Array.isArray(schedule.days) || !schedule.days.length || schedule.days.some(day => !time.WEEKDAYS.includes(day))) {
      fail('invalid_arguments', 'Recurring days must use SU, MO, TU, WE, TH, FR, SA.');
    }
    if (time.clockMinutes(schedule.start_time) === null || time.clockMinutes(schedule.end_time) === null) fail('invalid_arguments', 'Recurring times must be HH:MM.');
  }
  if (data.allow_overlapping_codes || schedule.kind !== 'window') return;
  for (const code of data.access_codes) {
    if (code.code_id === ignoreId || code.revoked || code.schedule.kind !== 'window') continue;
    if (codeStatus(code, nowMs, data.utc_offset, data) === 'expired') continue;
    if (!code.locks.some(lock => (schedule.locks || []).includes(lock))) continue;
    if (rangesOverlap(code.schedule, schedule)) fail('invalid_arguments', 'That window overlaps another code on the same lock.');
  }
}

function createCode(ctx, data, fields) {
  const nowMs = Date.parse(ctx.virtual_now);
  if (activeCodeCount(data, nowMs) >= data.max_active_codes) fail('code_limit_reached', 'The household is at its access code limit.');
  const locks = fields.locks || [];
  if (!locks.length || locks.some(lock => !findDevice(data, lock) || findDevice(data, lock).type !== 'lock')) {
    fail('unknown_device_in_action', 'Codes apply only to locks in this household.');
  }
  const schedule = copy(fields.schedule);
  assertCodeSchedule(data, {...schedule, locks}, nowMs, null);
  const serial = data.counters.code;
  const code = {
    code_id: nextId(data, 'code', 'code'),
    name: fields.name,
    holder_name: fields.holder_name,
    holder_person_id: fields.holder_person_id || null,
    digits: makeDigits(serial),
    schedule,
    locks: copy(locks),
    revoked: false,
    approval: fields.approval || 'approved',
    pending_confirmation_id: null,
    created_at: stamp(ctx)
  };
  data.access_codes.push(code);
  queueNotice(ctx, data, {
    kind: 'code_created',
    object_type: 'access_code',
    object_id: code.code_id,
    title: 'Brightwire: an access code was created',
    body: code.approval === 'pending'
      ? 'A code for ' + code.holder_name + ' is waiting for the owner. The digits are not included in this notice.'
      : 'A code for ' + code.holder_name + ' was created. The digits are not included in this notice.'
  });
  activity(ctx, data, {
    actor_kind: 'assistant',
    actor_id: 'assistant',
    cause: 'direct_command',
    request_id: ctx.request_id || null,
    command: 'access_code_create',
    summary: 'Code for ' + code.holder_name
  });
  return code;
}

function executeStored(ctx, data, confirmation) {
  try {
    applyStored(ctx, data, confirmation);
  } catch (error) {
    if (!error.code) throw error;
    activity(ctx, data, {
      actor_kind: 'assistant',
      actor_id: 'assistant',
      cause: 'confirmation',
      event_id: ctx.event_id || null,
      request_id: ctx.request_id || null,
      device_id: confirmation.stored && confirmation.stored.device_id || null,
      command: 'confirmation_failed',
      summary: error.code
    });
  }
}

function applyStored(ctx, data, confirmation) {
  const stored = confirmation.stored;
  ctx.cause = 'confirmation';
  ctx.request_id = ctx.request_id || null;
  if (stored.kind === 'device_command') {
    const device = requireDevice(data, stored.device_id);
    applyDirect(ctx, data, device, stored.command, stored.args || {}, {
      at: stamp(ctx), actor_kind: 'assistant', actor_id: 'assistant', cause: 'confirmation', event_id: ctx.event_id || null
    });
  } else if (stored.kind === 'set_mode') {
    setMode(ctx, data, stored.mode, false);
  } else if (stored.kind === 'routine_update') {
    const routine = requireRoutine(data, stored.routine_id);
    if (stored.patch && stored.patch.actions) {
      for (const action of stored.patch.actions) {
        if (action.kind !== 'device') continue;
        assertActionArguments(requireDevice(data, action.device_id), action.command, action.args || {});
      }
    }
    const before = automationSnap(routine, 'routine');
    Object.assign(routine, stored.patch);
    routine.last_edited_by = 'assistant';
    recordAutomation(ctx, data, 'routine_update', before, automationSnap(routine, 'routine'), 'Updated routine ' + routine.name);
  } else if (stored.kind === 'routine_enable') {
    const routine = requireRoutine(data, stored.routine_id);
    const before = automationSnap(routine, 'routine');
    routine.enabled = true;
    recordAutomation(ctx, data, 'routine_enable', before, automationSnap(routine, 'routine'), 'enable ' + routine.name);
  } else if (stored.kind === 'routine_disable') {
    const routine = requireRoutine(data, stored.routine_id);
    const before = automationSnap(routine, 'routine');
    routine.enabled = false;
    recordAutomation(ctx, data, 'routine_disable', before, automationSnap(routine, 'routine'), 'disable ' + routine.name);
  } else if (stored.kind === 'routine_delete') {
    const routine = requireRoutine(data, stored.routine_id);
    const before = automationSnap(routine, 'routine');
    routine.deleted = true;
    routine.enabled = false;
    recordAutomation(ctx, data, 'routine_delete', before, automationSnap(routine, 'routine'), 'delete ' + routine.name);
  } else if (stored.kind === 'scene_update') {
    const scene = requireScene(data, stored.scene_id);
    if (stored.patch && stored.patch.actions) {
      for (const action of stored.patch.actions) {
        if (action.kind !== 'device') continue;
        assertActionArguments(requireDevice(data, action.device_id), action.command, action.args || {});
      }
    }
    const before = automationSnap(scene, 'scene');
    Object.assign(scene, stored.patch);
    recordAutomation(ctx, data, 'scene_update', before, automationSnap(scene, 'scene'), 'Updated scene ' + scene.name);
  } else if (stored.kind === 'scene_delete') {
    const scene = requireScene(data, stored.scene_id);
    const before = automationSnap(scene, 'scene');
    scene.deleted = true;
    recordAutomation(ctx, data, 'scene_delete', before, automationSnap(scene, 'scene'), 'Deleted scene ' + scene.name);
  } else if (stored.kind === 'camera_share') {
    startShare(ctx, data, requireDevice(data, stored.device_id), stored.recipient, stored.duration_minutes);
  } else if (stored.kind === 'camera_share_stop') {
    stopShare(ctx, data, stored.session_id);
  } else if (stored.kind === 'code_create') {
    createCode(ctx, data, stored.fields);
  } else if (stored.kind === 'code_update') {
    const code = data.access_codes.find(item => item.code_id === stored.code_id);
    if (!code || code.revoked) fail('invalid_arguments', 'That code cannot be updated.');
    const nowMs = Date.parse(ctx.virtual_now);
    assertCodeSchedule(data, {...stored.schedule, locks: code.locks}, nowMs, code.code_id);
    if (projectedCodeCount(data, nowMs, code.code_id, stored.schedule) > data.max_active_codes) fail('code_limit_reached', 'The household is at its access code limit.');
    code.schedule = stored.schedule;
  } else if (stored.kind === 'code_revoke') {
    const code = data.access_codes.find(item => item.code_id === stored.code_id);
    if (!code) fail('invalid_arguments', 'That code does not exist.');
    code.revoked = true;
  } else if (stored.kind === 'code_activate') {
    const code = data.access_codes.find(item => item.code_id === stored.code_id);
    if (!code) fail('invalid_arguments', 'That code does not exist.');
    code.approval = 'approved';
  }
}

function startShare(ctx, data, device, recipient, duration) {
  assertShare(device, recipient, duration);
  const session = {
    session_id: nextId(data, 'session', 'cs'),
    device_id: device.device_id,
    recipient,
    started_at: stamp(ctx),
    duration_minutes: duration,
    stopped_at: null
  };
  data.sessions.push(session);
  raiseAlert(ctx, data, {
    kind: 'camera_shared',
    device_id: device.device_id,
    title: 'Brightwire: the ' + device.name + ' is being shared',
    summary: 'A camera share to an outside address started at ' + session.started_at.slice(11, 16) + '.'
  });
  const notice = data.notices[data.notices.length - 1];
  notice.object_type = 'camera_session';
  notice.object_id = session.session_id;
  activity(ctx, data, {
    actor_kind: 'assistant',
    actor_id: 'assistant',
    cause: ctx.cause || 'direct_command',
    request_id: ctx.request_id || null,
    event_id: ctx.event_id || null,
    device_id: device.device_id,
    command: 'camera_share_start',
    summary: 'Share started'
  });
  return session;
}

function stopShare(ctx, data, sessionId) {
  const session = data.sessions.find(item => item.session_id === sessionId);
  if (!session) fail('device_not_found', 'That camera session does not exist.');
  if (shareStatus(session, Date.parse(ctx.virtual_now)) === 'ended') return session;
  session.stopped_at = stamp(ctx);
  activity(ctx, data, {
    actor_kind: 'assistant',
    actor_id: 'assistant',
    cause: 'direct_command',
    request_id: ctx.request_id || null,
    device_id: session.device_id,
    command: 'camera_share_stop',
    summary: 'Share stopped'
  });
  return session;
}

function findConfirmation(data, payload, nowMs) {
  if (payload.confirmation_id) {
    const item = data.confirmations.find(confirmation => confirmation.confirmation_id === payload.confirmation_id);
    if (!item) fail('no_pending_confirmation', 'No confirmation has that id.');
    return item;
  }
  const matches = data.confirmations.filter(confirmation => {
    const target = confirmation.target;
    if (payload.device_id && target.kind === 'device' && target.id === payload.device_id) return true;
    if (payload.routine_id && target.kind === 'routine' && target.id === payload.routine_id) return true;
    if (payload.scene_id && target.kind === 'scene' && target.id === payload.scene_id) return true;
    if (payload.mode && target.kind === 'mode' && target.id === payload.mode) return true;
    return false;
  }).sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || confirmationOrder(left.confirmation_id) - confirmationOrder(right.confirmation_id) || left.confirmation_id.localeCompare(right.confirmation_id));
  if (!matches.length) fail('no_pending_confirmation', 'No confirmation is pending for that target.');
  const waiting = matches.filter(item => item.status === 'pending');
  const open = waiting.filter(item => confirmationStatus(item, nowMs) === 'pending');
  if (open.length) return open[0];
  if (waiting.length) return waiting[0];
  return matches[0];
}

function confirmationOrder(id) {
  const match = String(id).match(/(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function approverAllowed(data, personId) {
  const member = memberById(data, personId);
  if (!member || member.role === 'assistant' || member.role === 'child' || member.role === 'guest') return false;
  if (personId === data.owner_person_id) return true;
  const listed = Array.isArray(data.approver_person_ids) ? data.approver_person_ids : [];
  return listed.includes(personId);
}

function resolveConfirmation(ctx, data, payload) {
  const nowMs = Date.parse(ctx.virtual_now);
  const item = findConfirmation(data, payload, nowMs);
  const status = confirmationStatus(item, nowMs);
  if (status === 'expired') fail('confirmation_expired', 'The confirmation window has passed.');
  if (item.status !== 'pending') fail('confirmation_already_resolved', 'That confirmation is already resolved.');
  if (!['approved', 'denied'].includes(payload.decision)) fail('invalid_event', 'The decision must be approved or denied.');
  if (!approverAllowed(data, payload.by_person_id)) fail('invalid_event', 'That person cannot resolve a confirmation.');
  item.status = payload.decision;
  item.decision = payload.decision;
  item.resolved_at = stamp(ctx);
  item.by_person_id = payload.by_person_id;
  if (payload.decision === 'denied' && item.stored && item.stored.kind === 'code_activate') {
    const code = data.access_codes.find(entry => entry.code_id === item.stored.code_id);
    if (code) code.revoked = true;
  }
  if (payload.decision === 'approved') executeStored(ctx, data, item);
  activity(ctx, data, {
    actor_kind: 'member',
    actor_id: payload.by_person_id,
    cause: 'confirmation',
    event_id: ctx.event_id,
    command: 'confirmation_' + payload.decision,
    summary: item.summary
  });
}

function useCode(ctx, data, payload) {
  const lock = requireDevice(data, payload.lock_device_id);
  if (lock.type !== 'lock') fail('invalid_event', 'Codes are used on a lock.');
  const nowMs = Date.parse(ctx.virtual_now);
  let pool = data.access_codes.filter(code => code.locks.includes(lock.device_id));
  if (payload.code_id) pool = pool.filter(code => code.code_id === payload.code_id);
  else if (payload.holder_person_id) pool = pool.filter(code => code.holder_person_id === payload.holder_person_id);
  else if (payload.holder_name) {
    const folded = foldName(payload.holder_name);
    pool = pool.filter(code => foldName(code.holder_name) === folded);
  } else if (payload.digits) pool = pool.filter(code => code.digits === payload.digits);
  else fail('invalid_event', 'A code use needs a holder, a code id or digits.');
  pool.sort((left, right) => left.code_id.localeCompare(right.code_id));
  const active = pool.filter(code => codeStatus(code, nowMs, data.utc_offset, data) === 'active');
  const chosen = active[0] || pool[0] || null;
  let reason = null;
  if (!chosen) reason = 'no_matching_code';
  else if (chosen.revoked) reason = 'revoked';
  else if (codeStatus(chosen, nowMs, data.utc_offset, data) === 'expired') reason = 'outside_window';
  else if (codeStatus(chosen, nowMs, data.utc_offset, data) !== 'active') reason = 'outside_window';
  const use = {
    use_id: nextId(data, 'code_use', 'use'),
    at: stamp(ctx),
    lock_device_id: lock.device_id,
    code_id: chosen ? chosen.code_id : null,
    holder_name: chosen ? chosen.holder_name : (payload.holder_name || null),
    outcome: reason ? 'denied' : 'unlocked',
    reason
  };
  data.code_uses.push(use);
  if (!reason) {
    applyDirect(ctx, data, lock, 'unlock', {}, {
      at: stamp(ctx), actor_kind: 'guest_code', actor_id: chosen.code_id, cause: 'guest_code', event_id: ctx.event_id, command: 'unlock',
      summary: 'Code for ' + chosen.holder_name + ' unlocked ' + lock.name
    });
  } else {
    activity(ctx, data, {
      actor_kind: 'guest_code',
      actor_id: chosen ? chosen.code_id : 'unknown',
      cause: 'guest_code',
      event_id: ctx.event_id,
      device_id: lock.device_id,
      command: 'code_denied',
      summary: 'Code use denied (' + reason + ')',
      before: project(lock),
      after: project(lock)
    });
  }
  if (chosen) {
    queueNotice(ctx, data, {
      kind: 'code_used',
      object_type: 'access_code',
      object_id: chosen.code_id,
      title: 'Brightwire: an access code was used',
      body: 'A code for ' + chosen.holder_name + ' was ' + (reason ? 'denied' : 'used') + ' at ' + lock.name + '.'
    });
  }
  return use;
}

function memberById(data, personId) {
  return data.members.find(member => member.person_id === personId) || null;
}

function applySensor(ctx, data, payload) {
  const device = requireDevice(data, payload.device_id);
  if (!SENSOR_TYPES.includes(device.type)) fail('invalid_event', 'sensor.change applies only to a sensor.');
  const before = project(device);
  if (device.type === 'temperature') {
    const value = Number(payload.state);
    if (!Number.isFinite(value)) fail('invalid_event', 'A temperature sensor state must be a number.');
    device.sensor = 'reading';
    device.sensor_value = value;
  } else {
    const allowed = {
      contact: ['open', 'closed'],
      motion: ['detected', 'clear'],
      leak: ['wet', 'dry'],
      smoke: ['alarm', 'clear']
    }[device.type];
    if (!allowed.includes(payload.state)) fail('invalid_event', 'That state is not valid for this sensor.');
    device.sensor = payload.state;
    if (device.type === 'contact') device.opened_at = payload.state === 'open' ? stamp(ctx) : null;
  }
  recordChange(ctx, data, device, {before, after: project(device)}, {
    actor_kind: 'manual', actor_id: 'sensor', cause: 'event', event_id: ctx.event_id, command: 'sensor_change', summary: device.name + ' ' + device.sensor
  });
  if (device.type === 'leak' && device.sensor === 'wet') {
    raiseAlert(ctx, data, {kind: 'leak', device_id: device.device_id, title: 'Brightwire: water leak', summary: device.name + ' reports water.'});
  }
  if (device.type === 'smoke' && device.sensor === 'alarm') {
    raiseAlert(ctx, data, {kind: 'smoke', device_id: device.device_id, title: 'Brightwire: smoke', summary: device.name + ' reports smoke.'});
  }
  if (device.type === 'contact' && device.sensor === 'open' && quietAt(data, Date.parse(ctx.virtual_now))) {
    raiseAlert(ctx, data, {kind: 'quiet_hours', device_id: device.device_id, title: 'Brightwire: door opened during quiet hours', summary: device.name + ' opened during quiet hours.'});
  }
  for (const routine of data.routines) {
    if (!routine.enabled || routine.deleted || routine.trigger.kind !== 'sensor') continue;
    if (routine.trigger.device_id !== device.device_id) continue;
    if (routine.trigger.state && routine.trigger.state !== device.sensor) continue;
    runRoutine(ctx, data, routine, Date.parse(ctx.virtual_now), {event_id: ctx.event_id, scheduled_for: stamp(ctx)});
  }
  considerDeviceTriggers(ctx, data, device, {at: stamp(ctx), event_id: ctx.event_id, actor_kind: 'manual', actor_id: 'sensor'}, 0);
}

function snapshotReady(data, assetId) {
  if (!assetId) return null;
  const listed = Array.isArray(data.available_snapshots) ? data.available_snapshots : [];
  if (!listed.includes(assetId)) return 'asset_missing';
  const model = require('./model.cjs');
  if (!model.committedSnapshotReady(data, assetId)) return 'asset_missing';
  return 'ready';
}

function automationSnap(record, kind) {
  const snap = {
    kind,
    id: record.routine_id || record.scene_id,
    name: record.name,
    enabled: record.enabled !== false,
    deleted: Boolean(record.deleted),
    run_as: record.run_as,
    created_by: record.created_by,
    created_by_person_id: record.created_by_person_id || null,
    last_edited_by: record.last_edited_by,
    actions: copy(record.actions || [])
  };
  if (record.routine_id) {
    snap.trigger = copy(record.trigger);
    snap.conditions = copy(record.conditions || []);
    snap.catch_up_minutes = record.catch_up_minutes;
  }
  return snap;
}

function recordAutomation(ctx, data, kind, before, after, summary) {
  activity(ctx, data, {
    actor_kind: 'assistant',
    actor_id: 'assistant',
    cause: ctx.cause || 'direct_command',
    request_id: ctx.request_id || null,
    event_id: ctx.event_id || null,
    command: kind,
    summary,
    before,
    after
  });
}

function reads(ctx, data, name, args) {
  const nowMs = Date.parse(ctx.virtual_now);
  if (name === 'rooms.list') return {rooms: copy(data.rooms)};
  if (name === 'devices.list') return {devices: data.devices.map(device => presentDevice(data, device, nowMs))};
  if (name === 'devices.get') {
    const device = requireDevice(data, args.device_id);
    const view = presentDevice(data, device, nowMs);
    view.snapshot_status = snapshotReady(data, device.snapshot_asset_id);
    return {device: view};
  }
  if (name === 'devices.history') {
    requireDevice(data, args.device_id);
    return {entries: data.activity.filter(entry => entry.device_id === args.device_id).map(entry => copy(entry))};
  }
  if (name === 'scenes.list') return {scenes: data.scenes.map(scene => copy(scene))};
  if (name === 'routines.list') return {routines: data.routines.map(routine => presentRoutine(data, routine, nowMs))};
  if (name === 'routines.get') {
    const routine = findRoutine(data, args.routine_id);
    if (!routine) fail('routine_not_found', 'That routine does not exist.');
    return {routine: presentRoutine(data, routine, nowMs)};
  }
  if (name === 'members.list') return {members: copy(data.members), home_mode: data.home_mode};
  if (name === 'modes.get') {
    return {home_mode: data.home_mode, assistant_carried_modes: carriedModes(data), mode_rules: copy(data.mode_rules)};
  }
  if (name === 'access_codes.list') return {codes: data.access_codes.map(code => maskCode(code, nowMs, data.utc_offset, data))};
  if (name === 'permissions.get') {
    const effective = {};
    for (const className of Object.keys(data.scopes)) effective[className] = effectiveScope(data, className);
    return {scopes: copy(data.scopes), mode_rules: copy(data.mode_rules), effective, assistant_carried_modes: carriedModes(data)};
  }
  if (name === 'confirmations.list') {
    return {confirmations: data.confirmations.map(item => ({
      confirmation_id: item.confirmation_id,
      created_at: item.created_at,
      status: confirmationStatus(item, nowMs),
      target: copy(item.target),
      summary: item.summary,
      resolved_at: item.resolved_at,
      decision: item.decision,
      by_person_id: item.by_person_id
    }))};
  }
  if (name === 'activity.list') return {entries: copy(data.activity)};
  if (name === 'alerts.list') {
    return {alerts: data.alerts.map(alert => ({...copy(alert), status: alertStatus(alert, nowMs)}))};
  }
  if (name === 'energy.summary') {
    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) fail('invalid_arguments', 'The energy range needs a start before its end.');
    if (endMs <= earliestHistory(data)) return {outcome: 'no_data', total_kwh: 0, devices: []};
    const devices = data.devices.filter(device => device.type === 'switch' && (!args.device_id || device.device_id === args.device_id));
    if (args.device_id && !devices.length) fail('device_not_found', 'No switch has that id.');
    const rows = devices.map(device => ({device_id: device.device_id, kwh: Math.round(energyKwh(data, device, startMs, endMs, nowMs) * 1000) / 1000}));
    const total = Math.round(rows.reduce((sum, row) => sum + row.kwh, 0) * 1000) / 1000;
    return {outcome: 'ok', total_kwh: total, devices: rows};
  }
  return null;
}

function writes(ctx, data, name, args) {
  ctx.request_id = args.request_id;
  if (name === 'devices.command') {
    const device = requireDevice(data, args.device_id);
    const className = deviceClass(device);
    if (!className) fail('unsupported_command', 'Sensors change through events.');
    const held = scopeOrConfirm(ctx, data, className, {
      kind: 'device_command', device_id: device.device_id, command: args.command, args: args.args || {}
    }, {kind: 'device', id: device.device_id}, args.command + ' ' + device.name, () => assertApplicable(device, args.command, args.args || {}, stamp(ctx)));
    if (held) return held;
    const change = applyDirect(ctx, data, device, args.command, args.args || {}, {
      actor_kind: 'assistant', actor_id: 'assistant', cause: 'direct_command', request_id: args.request_id, summary: args.command + ' ' + device.name
    });
    return {outcome: 'applied', device_id: device.device_id, before: change.before, after: change.after};
  }
  if (name === 'camera.share.start') {
    const device = requireDevice(data, args.device_id);
    const held = scopeOrConfirm(ctx, data, 'camera', {
      kind: 'camera_share', device_id: device.device_id, recipient: args.recipient, duration_minutes: args.duration_minutes
    }, {kind: 'device', id: device.device_id}, 'Share ' + device.name, () => assertShare(device, args.recipient, args.duration_minutes));
    if (held) return held;
    const session = startShare(ctx, data, device, args.recipient, args.duration_minutes);
    return {outcome: 'applied', session_id: session.session_id, device_id: device.device_id};
  }
  if (name === 'camera.share.stop') {
    const session = data.sessions.find(item => item.session_id === args.session_id);
    if (!session) fail('device_not_found', 'That camera session does not exist.');
    const held = scopeOrConfirm(ctx, data, 'camera', {kind: 'camera_share_stop', session_id: session.session_id}, {kind: 'device', id: session.device_id}, 'Stop camera share');
    if (held) return held;
    stopShare(ctx, data, session.session_id);
    return {outcome: 'applied', session_id: session.session_id};
  }
  if (name === 'scenes.run') {
    const scene = requireScene(data, args.scene_id);
    const results = scene.actions.map(action => runAction(ctx, data, action, {
      at: stamp(ctx), actor_kind: 'assistant', actor_id: 'assistant', cause: 'scene', interactive: true, run_as: 'assistant', request_id: args.request_id
    }));
    return {outcome: results.every(item => item.outcome === 'applied') ? 'applied' : 'partial', scene_id: scene.scene_id, results};
  }
  if (name === 'scenes.create' || name === 'scenes.update') {
    const actions = normalizedActions(data, args.actions);
    if (name === 'scenes.create') {
      assertOperateActions(data, actions);
      const scene = {
        scene_id: nextId(data, 'scene', 'sc'),
        name: args.name,
        created_by: 'assistant',
        created_by_person_id: null,
        last_edited_by: 'assistant',
        run_as: 'assistant',
        deleted: false,
        actions
      };
      data.scenes.push(scene);
      recordAutomation(ctx, data, 'scene_create', null, automationSnap(scene, 'scene'), 'Created scene ' + scene.name);
      return {outcome: 'applied', scene_id: scene.scene_id};
    }
    const scene = requireScene(data, args.scene_id);
    const beforeScene = automationSnap(scene, 'scene');
    const gate = requireAutomation(data, scene);
    if (gate === 'confirm') {
      const confirmation = openConfirmation(ctx, data, {
        target: {kind: 'scene', id: scene.scene_id},
        stored: {kind: 'scene_update', scene_id: scene.scene_id, patch: {name: args.name, actions, last_edited_by: 'assistant'}},
        summary: 'Edit scene ' + scene.name
      });
      return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id, scene_id: scene.scene_id};
    }
    if (gate === 'operate') {
      assertOperateActions(data, actions);
      scene.run_as = 'assistant';
    } else if (gate === 'own') assertOperateActions(data, actions);
    scene.name = args.name;
    scene.actions = actions;
    scene.last_edited_by = 'assistant';
    recordAutomation(ctx, data, 'scene_update', beforeScene, automationSnap(scene, 'scene'), 'Updated scene ' + scene.name);
    return {outcome: 'applied', scene_id: scene.scene_id, run_as: scene.run_as};
  }
  if (name === 'scenes.delete') {
    const scene = requireScene(data, args.scene_id);
    const gate = requireAutomation(data, scene);
    if (gate === 'confirm') {
      const confirmation = openConfirmation(ctx, data, {
        target: {kind: 'scene', id: scene.scene_id},
        stored: {kind: 'scene_delete', scene_id: scene.scene_id},
        summary: 'Delete scene ' + scene.name
      });
      return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id};
    }
    const beforeDelete = automationSnap(scene, 'scene');
    scene.deleted = true;
    recordAutomation(ctx, data, 'scene_delete', beforeDelete, automationSnap(scene, 'scene'), 'Deleted scene ' + scene.name);
    return {outcome: 'applied', scene_id: scene.scene_id};
  }
  if (name === 'routines.create') {
    checkTrigger(data, args.trigger);
    checkConditions(data, args.conditions || []);
    const actions = normalizedActions(data, args.actions);
    assertOperateActions(data, actions);
    const routine = {
      routine_id: nextId(data, 'routine', 'rt'),
      name: args.name,
      enabled: true,
      deleted: false,
      created_by: 'assistant',
      created_by_person_id: null,
      last_edited_by: 'assistant',
      run_as: 'assistant',
      trigger: copy(args.trigger),
      conditions: copy(args.conditions || []),
      actions,
      catch_up_minutes: args.catch_up_minutes == null ? 15 : args.catch_up_minutes
    };
    if (!Number.isInteger(routine.catch_up_minutes) || routine.catch_up_minutes < 0 || routine.catch_up_minutes > 180) {
      fail('invalid_trigger', 'catch_up_minutes must be an integer from 0 to 180.');
    }
    data.routines.push(routine);
    recordAutomation(ctx, data, 'routine_create', null, automationSnap(routine, 'routine'), 'Created routine ' + routine.name);
    return {outcome: 'applied', routine_id: routine.routine_id};
  }
  if (name === 'routines.update' || name === 'routines.enable' || name === 'routines.disable' || name === 'routines.delete') {
    const routine = requireRoutine(data, args.routine_id);
    const beforeRoutine = automationSnap(routine, 'routine');
    const gate = requireAutomation(data, routine);
    if (name === 'routines.update') {
      if (args.trigger) checkTrigger(data, args.trigger);
      if (args.conditions) checkConditions(data, args.conditions);
      const actions = args.actions ? normalizedActions(data, args.actions) : null;
      const patch = {last_edited_by: 'assistant'};
      if (args.name) patch.name = args.name;
      if (args.trigger) patch.trigger = copy(args.trigger);
      if (args.conditions) patch.conditions = copy(args.conditions);
      if (actions) patch.actions = actions;
      if (args.catch_up_minutes != null) patch.catch_up_minutes = args.catch_up_minutes;
      if (gate === 'confirm') {
        const confirmation = openConfirmation(ctx, data, {
          target: {kind: 'routine', id: routine.routine_id},
          stored: {kind: 'routine_update', routine_id: routine.routine_id, patch},
          summary: 'Edit routine ' + routine.name
        });
        return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id, routine_id: routine.routine_id};
      }
      if (gate === 'operate') {
        assertOperateActions(data, actions || routine.actions);
        patch.run_as = 'assistant';
      } else if (gate === 'own' && actions) assertOperateActions(data, actions);
      Object.assign(routine, patch);
      recordAutomation(ctx, data, 'routine_update', beforeRoutine, automationSnap(routine, 'routine'), 'Updated routine ' + routine.name);
      return {outcome: 'applied', routine_id: routine.routine_id, run_as: routine.run_as};
    }
    const storedKind = name === 'routines.enable' ? 'routine_enable' : name === 'routines.disable' ? 'routine_disable' : 'routine_delete';
    if (gate === 'confirm') {
      const confirmation = openConfirmation(ctx, data, {
        target: {kind: 'routine', id: routine.routine_id},
        stored: {kind: storedKind, routine_id: routine.routine_id},
        summary: name.slice('routines.'.length) + ' ' + routine.name
      });
      return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id, routine_id: routine.routine_id};
    }
    if (name === 'routines.enable') {
      if (gate === 'operate') assertOperateActions(data, routine.actions);
      routine.enabled = true;
      if (gate === 'operate') routine.run_as = 'assistant';
    } else if (name === 'routines.disable') routine.enabled = false;
    else { routine.deleted = true; routine.enabled = false; }
    recordAutomation(ctx, data, storedKind, beforeRoutine, automationSnap(routine, 'routine'), name.slice('routines.'.length) + ' ' + routine.name);
    return {outcome: 'applied', routine_id: routine.routine_id, run_as: routine.run_as};
  }
  if (name === 'routines.run_now') {
    const routine = requireRoutine(data, args.routine_id);
    if (!routine.enabled) fail('invalid_trigger', 'Enable the routine before running it.');
    if (!conditionsMet(data, routine, Date.parse(ctx.virtual_now))) return {outcome: 'conditions_not_met', routine_id: routine.routine_id, results: []};
    const results = routine.actions.map(action => runAction(ctx, data, action, {
      at: stamp(ctx), actor_kind: 'assistant', actor_id: 'assistant', cause: 'direct_command', interactive: true, run_as: 'assistant', request_id: args.request_id
    }));
    return {outcome: results.every(item => item.outcome === 'applied') ? 'applied' : 'partial', routine_id: routine.routine_id, results};
  }
  if (name === 'modes.set') {
    if (!['home', 'away', 'night'].includes(args.mode)) fail('invalid_arguments', 'Mode must be home, away or night.');
    const held = scopeOrConfirm(ctx, data, 'modes', {kind: 'set_mode', mode: args.mode}, {kind: 'mode', id: args.mode}, 'Set mode to ' + args.mode);
    if (held) return held;
    const previous = data.home_mode;
    if (previous !== args.mode) setMode(ctx, data, args.mode, false);
    return {outcome: 'applied', home_mode: data.home_mode, assistant_carried_modes: carriedModes(data)};
  }
  if (name === 'access_codes.create') {
    const scope = effectiveScope(data, 'access_codes');
    if (scope === 'none' || scope === 'view') fail('scope_insufficient', 'The assistant cannot create access codes.');
    if (!args.holder_name || typeof args.holder_name !== 'string') fail('invalid_arguments', 'A code needs a holder name.');
    if (args.holder_person_id && ctx.binding && !ctx.binding.people.some(person => person.person_id === args.holder_person_id)) {
      fail('invalid_arguments', 'holder_person_id is not in the task binding.');
    }
    if (scope === 'confirm') {
      const code = createCode(ctx, data, {...args, approval: 'pending'});
      const confirmation = openConfirmation(ctx, data, {
        target: {kind: 'device', id: args.locks[0]},
        stored: {kind: 'code_activate', code_id: code.code_id},
        summary: 'Approve code for ' + args.holder_name
      });
      code.pending_confirmation_id = confirmation.confirmation_id;
      return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id, code_id: code.code_id, digits: code.digits};
    }
    const code = createCode(ctx, data, args);
    return {outcome: 'applied', code_id: code.code_id, digits: code.digits};
  }
  if (name === 'access_codes.update' || name === 'access_codes.revoke') {
    const code = data.access_codes.find(item => item.code_id === args.code_id);
    if (!code || code.revoked) fail('invalid_arguments', 'That code is not active.');
    const scope = effectiveScope(data, 'access_codes');
    if (scope === 'none' || scope === 'view') fail('scope_insufficient', 'The assistant cannot change access codes.');
    if (name === 'access_codes.update') {
      const schedule = copy(args.schedule);
      const nowMs = Date.parse(ctx.virtual_now);
      assertCodeSchedule(data, {...schedule, locks: code.locks}, nowMs, code.code_id);
      if (projectedCodeCount(data, nowMs, code.code_id, schedule) > data.max_active_codes) fail('code_limit_reached', 'The household is at its access code limit.');
      if (scope === 'confirm') {
        const confirmation = openConfirmation(ctx, data, {
          target: {kind: 'device', id: code.locks[0]},
          stored: {kind: 'code_update', code_id: code.code_id, schedule},
          summary: 'Update code ' + code.name
        });
        return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id};
      }
      code.schedule = schedule;
      return {outcome: 'applied', code_id: code.code_id};
    }
    if (scope === 'confirm') {
      const confirmation = openConfirmation(ctx, data, {
        target: {kind: 'device', id: code.locks[0]},
        stored: {kind: 'code_revoke', code_id: code.code_id},
        summary: 'Revoke code ' + code.name
      });
      return {outcome: 'confirmation_required', confirmation_id: confirmation.confirmation_id};
    }
    code.revoked = true;
    return {outcome: 'applied', code_id: code.code_id};
  }
  if (name === 'confirmations.cancel') {
    const item = data.confirmations.find(confirmation => confirmation.confirmation_id === args.confirmation_id);
    if (!item) fail('no_pending_confirmation', 'No confirmation has that id.');
    const status = confirmationStatus(item, Date.parse(ctx.virtual_now));
    if (status === 'expired') fail('confirmation_expired', 'The confirmation window has passed.');
    if (item.status !== 'pending') fail('confirmation_already_resolved', 'That confirmation is already resolved.');
    item.status = 'cancelled';
    item.decision = 'cancelled';
    item.resolved_at = stamp(ctx);
    if (item.stored.kind === 'code_activate') {
      const code = data.access_codes.find(codeItem => codeItem.code_id === item.stored.code_id);
      if (code) code.revoked = true;
    }
    return {outcome: 'applied', confirmation_id: item.confirmation_id};
  }
  if (name === 'alerts.acknowledge' || name === 'alerts.snooze') {
    const alert = data.alerts.find(item => item.alert_id === args.alert_id);
    if (!alert) fail('alert_not_found', 'No alert has that id.');
    if (name === 'alerts.acknowledge') {
      alert.acknowledged_at = stamp(ctx);
      alert.snooze_until = null;
      return {outcome: 'applied', alert_id: alert.alert_id, status: 'acknowledged'};
    }
    if (Date.parse(args.until) <= Date.parse(ctx.virtual_now)) fail('value_out_of_range', 'Snooze until must be after the current virtual time.');
    alert.snooze_until = args.until;
    alert.acknowledged_at = null;
    return {outcome: 'applied', alert_id: alert.alert_id, status: 'snoozed'};
  }
  fail('unknown_tool', 'Unknown Brightwire operation.');
}

function handleTool(ctx, data, name, args) {
  ctx = {...ctx};
  if (!name.startsWith(PREFIX)) fail('unknown_tool', 'Unknown Brightwire operation.');
  const local = name.slice(PREFIX.length);
  const read = reads(ctx, data, local, args);
  if (read) return {data, result: read};
  ctx.request_id = args.request_id || ctx.request_id || null;
  commitDue(ctx, data);
  const result = writes(ctx, data, local, args);
  delete data.runtime_seen;
  return {data, result};
}

function applyEvent(ctx, data, event) {
  ctx = {...ctx, event_id: event.event_id};
  commitDue(ctx, data);
  const payload = event.payload || {};
  if (event.operation === 'sensor.change') applySensor(ctx, data, payload);
  else if (event.operation === 'device.manual_change') {
    const member = memberById(data, payload.by_person_id);
    if (!member || !['owner', 'adult', 'child'].includes(member.role)) fail('invalid_event', 'That person cannot change a device at the wall.');
    const device = requireDevice(data, payload.device_id);
    applyDirect(ctx, data, device, payload.command, payload.args || {}, {
      at: stamp(ctx), actor_kind: 'manual', actor_id: member.person_id, cause: 'event', event_id: event.event_id, summary: member.name + ' ' + payload.command
    });
  } else if (event.operation === 'member.presence') {
    const member = memberById(data, payload.person_id);
    if (!member) fail('invalid_event', 'That person is not a household member.');
    if (!['arrived', 'left'].includes(payload.presence)) fail('invalid_event', 'Presence must be arrived or left.');
    member.presence = payload.presence === 'arrived' ? 'home' : 'away';
    activity(ctx, data, {actor_kind: 'member', actor_id: member.person_id, cause: 'event', event_id: event.event_id, command: 'presence', summary: member.name + ' ' + payload.presence});
    const kind = payload.presence === 'arrived' ? 'member_arrives' : 'member_leaves';
    for (const routine of data.routines) {
      if (!routine.enabled || routine.deleted || routine.trigger.kind !== kind) continue;
      if (routine.trigger.person_id && routine.trigger.person_id !== member.person_id) continue;
      runRoutine(ctx, data, routine, Date.parse(ctx.virtual_now), {event_id: event.event_id, scheduled_for: stamp(ctx)});
    }
  } else if (event.operation === 'mode.changed') {
    const member = memberById(data, payload.by_person_id);
    if (!member || member.role === 'guest' || member.role === 'assistant' || member.role === 'child') fail('invalid_event', 'That person cannot change the home mode.');
    if (!['home', 'away', 'night'].includes(payload.mode)) fail('invalid_event', 'The mode is not supported.');
    ctx.actor_id = member.person_id;
    ctx.cause = 'event';
    ctx.event_id = event.event_id;
    setMode(ctx, data, payload.mode, true);
  } else if (event.operation === 'lock.code_used') useCode(ctx, data, payload);
  else if (event.operation === 'confirmation.resolved') resolveConfirmation(ctx, data, payload);
  else if (event.operation === 'fault.inject') {
    const device = requireDevice(data, payload.device_id);
    const fault = payload.fault;
    if (fault === 'jammed' && device.type !== 'lock') fail('invalid_event', 'jammed applies only to a lock.');
    if (fault === 'obstructed' && device.type !== 'garage') fail('invalid_event', 'obstructed applies only to a garage door.');
    if (!['jammed', 'obstructed', 'offline'].includes(fault)) fail('invalid_event', 'The fault is not supported.');
    if (device.fault) fail('invalid_event', 'That device already has an active fault.');
    const before = project(device);
    device.state_before_fault = {lock: device.lock, garage: device.garage, online: device.online, fault: device.fault};
    device.fault = fault;
    if (fault === 'jammed') device.lock = 'jammed';
    if (fault === 'offline') device.online = false;
    activity(ctx, data, {actor_kind: 'manual', actor_id: 'fault', cause: 'event', event_id: event.event_id, device_id: device.device_id, command: 'fault_inject', summary: fault, before, after: project(device)});
    considerDeviceTriggers(ctx, data, device, {at: stamp(ctx), event_id: event.event_id, actor_kind: 'manual', actor_id: 'fault'}, 0);
  } else if (event.operation === 'fault.clear') {
    const device = requireDevice(data, payload.device_id);
    if (!device.fault) fail('no_active_fault', 'That device has no active fault.');
    const before = project(device);
    const saved = device.state_before_fault || {online: true, fault: null};
    device.lock = saved.lock == null ? device.lock : saved.lock;
    device.garage = saved.garage == null ? device.garage : saved.garage;
    device.online = saved.online !== false;
    device.fault = null;
    device.state_before_fault = null;
    activity(ctx, data, {actor_kind: 'manual', actor_id: 'fault', cause: 'event', event_id: event.event_id, device_id: device.device_id, command: 'fault_clear', summary: 'Fault cleared', before, after: project(device)});
    considerDeviceTriggers(ctx, data, device, {at: stamp(ctx), event_id: event.event_id, actor_kind: 'manual', actor_id: 'fault'}, 0);
  }   else if (event.operation === 'schedule.process_due') {
    // Due relocks and routines were committed above. Nothing else changes.
  } else if (event.operation === 'notice.delivery_result') {
    const notice = data.notices.find(item => item.notice_id === payload.notice_id);
    if (!notice) fail('invalid_event', 'No notice has that id.');
    if (!['committed', 'rejected', 'unknown'].includes(payload.status)) fail('invalid_event', 'Delivery status is not supported.');
    if (notice.delivery_status === 'committed') {
      if (payload.status !== 'committed') fail('delivery_status_conflict', 'A committed delivery stays committed.');
    } else {
      notice.delivery_status = payload.status;
      notice.publish_request_id = payload.publish_request_id;
      notice.messaging_event_id = payload.messaging_event_id || null;
    }
  } else fail('invalid_event', 'Unsupported event.');
  delete data.runtime_seen;
  return data;
}

module.exports = {
  APP, PREFIX, DEVICE_CLASSES, SENSOR_TYPES, COMMANDS, PROJECT_KEYS,
  project, presentDevice, effectiveScope, codeStatus, confirmationStatus, shareStatus, shareEnd,
  handleTool, applyEvent, commitDue, energyKwh, earliestHistory, maskCode, findDevice
};
