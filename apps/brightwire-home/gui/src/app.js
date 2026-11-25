import {el} from '/shared/client.js';

export const config = {
  id: 'brightwire-home',
  title: 'Brightwire Home',
  list: 'brightwire-home.devices.list',
  get: 'brightwire-home.devices.get',
  tools: [
    'brightwire-home.devices.command',
    'brightwire-home.scenes.run',
    'brightwire-home.routines.run_now',
    'brightwire-home.routines.enable',
    'brightwire-home.routines.disable',
    'brightwire-home.modes.set',
    'brightwire-home.confirmations.cancel',
    'brightwire-home.access_codes.create',
    'brightwire-home.camera.share.start',
    'brightwire-home.camera.share.stop'
  ]
};

const root = document.querySelector('#app');
const writes = new Map();
let csrf = '';
let version = null;
let devices = [];
let scenes = [];
let routines = [];
let confirmations = [];
let selected = null;
let section = 'rooms';
let busy = false;
let receipt = null;

function observedText(device) {
  const observed = device.observed || {};
  const parts = [device.type, device.room_id];
  if (observed.power) parts.push(observed.power);
  if (observed.brightness != null) parts.push('brightness ' + observed.brightness);
  if (observed.lock) parts.push(observed.lock);
  if (observed.garage) parts.push(observed.garage);
  if (observed.position != null) parts.push('position ' + observed.position);
  if (observed.setpoint != null) parts.push('setpoint ' + observed.setpoint);
  if (observed.thermo_mode) parts.push(observed.thermo_mode);
  if (observed.privacy) parts.push(observed.privacy);
  if (observed.sensor) parts.push(observed.sensor);
  if (!device.online) parts.push('offline');
  return parts.join(' · ');
}

function showStatus(message, error) {
  const status = document.querySelector('#status');
  if (!status) return;
  status.textContent = message;
  if (error) status.dataset.error = 'true';
  else delete status.dataset.error;
  status.dataset.outcome = message;
}

function actionRows(result) {
  if (!Array.isArray(result.results)) return [];
  return result.results.map(item => {
    const bad = Boolean(item.outcome && item.outcome !== 'applied');
    const text = [item.device_id || item.mode || 'action', item.command, item.outcome, item.confirmation_id].filter(Boolean).join(' ');
    return {text, outcome: item.outcome || '', bad, device_id: item.device_id || ''};
  });
}

function describe(result) {
  const rows = actionRows(result);
  if (rows.length) return [result.outcome || 'Saved'].concat(rows.map(row => row.text)).join('\n');
  if (result.outcome === 'confirmation_required') {
    const id = result.confirmation_id ? ' ' + result.confirmation_id : '';
    const digits = result.digits ? '. Digits ' + result.digits : '';
    return 'confirmation_required' + id + digits;
  }
  if (result.digits) return 'Code created. Digits ' + result.digits;
  return result.outcome || 'Saved';
}

function receiptError(result) {
  if (Array.isArray(result.results) && result.results.some(item => item.outcome && item.outcome !== 'applied')) return true;
  return Boolean(result.outcome && result.outcome !== 'applied' && result.outcome !== 'partial');
}

function showReceipt() {
  if (!receipt) return;
  showStatus(receipt.message, receipt.error);
  const box = document.querySelector('#results');
  if (!box) return;
  box.replaceChildren(...receipt.rows.map(row => el('p', {
    'data-result': row.device_id || 'action',
    'data-outcome': row.outcome,
    ...(row.bad ? {'data-error': 'true', class: 'form-error'} : {})
  }, row.text)));
}

async function request(url, method, value) {
  const response = await fetch(url, {
    method,
    headers: method === 'POST' ? {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf} : {},
    ...(method === 'POST' ? {body: JSON.stringify(value)} : {})
  });
  const out = await response.json();
  if (!response.ok) throw Object.assign(Error(out.error || 'Request failed'), {status: response.status});
  return out;
}

async function call(name, args) {
  const result = await request('/api/call', 'POST', {name, arguments: args});
  if (!['ok', 'committed', 'ready'].includes(result.status)) {
    throw Object.assign(Error(result.message || result.status), {code: result.status});
  }
  return result;
}

function writeKey(name, args) {
  return name + '\n' + JSON.stringify(args);
}

async function write(name, args) {
  if (busy) throw Error('An operation is already in progress.');
  busy = true;
  document.body.dataset.busy = 'true';
  const key = writeKey(name, args);
  let pending = writes.get(key);
  try {
    if (pending && pending.done) {
      receipt = pending.receipt;
      try {
        await refresh(selected && selected.device_id);
      } catch (error) {
        showStatus(pending.receipt.message + ' The list could not be refreshed.', pending.receipt.error);
        throw error;
      }
      showReceipt();
      writes.delete(key);
      return pending.result;
    }
    if (!pending) {
      pending = {
        request_id: 'web-' + crypto.randomUUID(),
        version: structuredClone(version),
        done: false
      };
      writes.set(key, pending);
    }
    const result = await call(name, {...args, expected_version: pending.version, request_id: pending.request_id});
    version = result.version || version;
    pending.done = true;
    pending.result = result;
    pending.message = describe(result);
    pending.error = receiptError(result);
    pending.receipt = {message: pending.message, error: pending.error, rows: actionRows(result)};
    receipt = pending.receipt;
    showReceipt();
    try {
      await refresh(selected && selected.device_id);
    } catch (error) {
      showStatus(pending.message + ' The list could not be refreshed.', pending.error);
      throw error;
    }
    showReceipt();
    writes.delete(key);
    return result;
  } catch (error) {
    if (pending && !pending.done && error && error.code) writes.delete(key);
    if (!pending || !pending.done) showStatus(error && error.code ? error.code : error.message, true);
    throw error;
  } finally {
    busy = false;
    delete document.body.dataset.busy;
  }
}

function button(label, action, attrs = {}) {
  return el('button', {type: 'button', ...attrs, onclick: () => action().catch(() => {})}, label);
}

function deviceButtons(device) {
  const id = device.device_id;
  const type = device.type;
  const row = [];
  if (type === 'light' || type === 'switch') {
    row.push(button('Turn on', () => write('brightwire-home.devices.command', {device_id: id, command: 'turn_on', args: {}}), {'data-action': 'turn-on'}));
    row.push(button('Turn off', () => write('brightwire-home.devices.command', {device_id: id, command: 'turn_off', args: {}}), {'data-action': 'turn-off'}));
  }
  if (type === 'light') {
    const brightness = el('input', {type: 'number', min: '1', max: '100', value: String(device.observed.brightness || 40), 'data-field': 'brightness', 'aria-label': 'Brightness'});
    row.push(brightness);
    row.push(button('Set brightness', () => write('brightwire-home.devices.command', {
      device_id: id, command: 'set_brightness', args: {brightness: Number(brightness.value)}
    }), {'data-action': 'set-brightness', class: 'primary'}));
  }
  if (type === 'lock') {
    row.push(button('Lock', () => write('brightwire-home.devices.command', {device_id: id, command: 'lock', args: {}}), {'data-action': 'lock'}));
    row.push(button('Unlock', () => write('brightwire-home.devices.command', {device_id: id, command: 'unlock', args: {}}), {'data-action': 'unlock'}));
  }
  if (type === 'thermostat') {
    const setpoint = el('input', {type: 'number', min: '40', max: '95', value: String(device.observed.setpoint || 70), 'data-field': 'setpoint', 'aria-label': 'Setpoint'});
    row.push(setpoint);
    row.push(button('Set temperature', () => write('brightwire-home.devices.command', {
      device_id: id, command: 'set_setpoint', args: {setpoint: Number(setpoint.value)}
    }), {'data-action': 'set-setpoint'}));
  }
  if (type === 'blind') {
    row.push(button('Open blind', () => write('brightwire-home.devices.command', {device_id: id, command: 'open', args: {}}), {'data-action': 'open-blind'}));
    row.push(button('Close blind', () => write('brightwire-home.devices.command', {device_id: id, command: 'close', args: {}}), {'data-action': 'close-blind'}));
  }
  if (type === 'garage') {
    row.push(button('Open garage', () => write('brightwire-home.devices.command', {device_id: id, command: 'open', args: {}}), {'data-action': 'open-garage'}));
    row.push(button('Close garage', () => write('brightwire-home.devices.command', {device_id: id, command: 'close', args: {}}), {'data-action': 'close-garage'}));
  }
  if (type === 'camera') {
    const recipient = el('input', {type: 'text', value: 'guest@example.test', 'data-field': 'recipient', 'aria-label': 'Share recipient'});
    const minutes = el('input', {type: 'number', min: '1', max: '1440', value: '15', 'data-field': 'duration', 'aria-label': 'Share minutes'});
    row.push(recipient, minutes);
    row.push(button('Share camera', () => write('brightwire-home.camera.share.start', {
      device_id: id, recipient: recipient.value, duration_minutes: Number(minutes.value)
    }), {'data-action': 'share-camera'}));
    for (const session of (device.sessions || []).filter(item => item.status === 'active')) {
      row.push(button('Stop share', () => write('brightwire-home.camera.share.stop', {session_id: session.session_id}), {
        'data-action': 'stop-share',
        'data-session-id': session.session_id
      }));
    }
  }
  return row;
}

function detail(device) {
  const panel = el('article', {'data-device-id': device.device_id});
  panel.append(
    el('p', {class: 'kicker'}, device.room_id + ' · ' + device.type),
    el('h2', {}, device.name),
    el('p', {'data-device-state': device.device_id}, observedText(device)),
    el('div', {class: 'actions'}, ...deviceButtons(device))
  );
  return panel;
}

function deviceRecord(device) {
  return el('button', {
    type: 'button',
    class: 'record',
    'data-device-id': device.device_id,
    'aria-pressed': selected && selected.device_id === device.device_id,
    onclick: () => { selected = device; render(); }
  }, el('span', {class: 'record-title'}, device.name), el('span', {class: 'record-subtitle'}, observedText(device)));
}

function groupedDevices(key) {
  const list = el('div', {class: 'records', id: 'records'});
  const names = [...new Set(devices.map(device => device[key]))].sort();
  for (const name of names) {
    list.append(el('h3', {class: 'section-title'}, name));
    for (const device of devices.filter(device => device[key] === name)) list.append(deviceRecord(device));
  }
  return list;
}

function sideList() {
  if (section === 'rooms') return groupedDevices('room_id');
  if (section === 'types') return groupedDevices('type');
  const list = el('div', {class: 'records', id: 'records'});
  if (section === 'scenes') {
    for (const scene of scenes.filter(item => !item.deleted)) {
      list.append(el('div', {class: 'record'}, el('strong', {class: 'record-title'}, scene.name), button('Run scene', () => write('brightwire-home.scenes.run', {scene_id: scene.scene_id}), {'data-scene-id': scene.scene_id})));
    }
    return list;
  }
  if (section === 'routines') {
    for (const routine of routines.filter(item => !item.deleted)) {
      list.append(el('div', {class: 'record'},
        el('strong', {class: 'record-title'}, routine.name),
        el('span', {class: 'record-subtitle'}, routine.enabled ? 'Enabled' : 'Disabled'),
        button(routine.enabled ? 'Disable' : 'Enable', () => write(routine.enabled ? 'brightwire-home.routines.disable' : 'brightwire-home.routines.enable', {routine_id: routine.routine_id}), {'data-routine-id': routine.routine_id}),
        button('Run now', () => write('brightwire-home.routines.run_now', {routine_id: routine.routine_id}), {'data-run-routine': routine.routine_id})
      ));
    }
    return list;
  }
  if (section === 'confirmations') {
    const pending = confirmations.filter(item => item.status === 'pending');
    if (!pending.length) list.append(el('div', {class: 'empty'}, el('p', {}, 'No confirmation is waiting.')));
    for (const item of pending) {
      list.append(el('div', {class: 'record', 'data-confirmation-id': item.confirmation_id},
        el('strong', {class: 'record-title'}, item.summary || item.confirmation_id),
        button('Cancel confirmation', () => write('brightwire-home.confirmations.cancel', {confirmation_id: item.confirmation_id}))
      ));
    }
    return list;
  }
  return list;
}

function extraPanel() {
  const holder = el('input', {type: 'text', value: 'Guest', 'data-field': 'holder', 'aria-label': 'Code holder'});
  const start = el('input', {type: 'text', value: '2026-11-20T08:00:00-06:00', 'data-field': 'window-start', 'aria-label': 'Window start'});
  const end = el('input', {type: 'text', value: '2026-11-20T18:00:00-06:00', 'data-field': 'window-end', 'aria-label': 'Window end'});
  const locks = devices.filter(device => device.type === 'lock');
  const lock = el('select', {'data-field': 'lock', 'aria-label': 'Lock'});
  for (const item of locks) lock.append(el('option', {value: item.device_id}, item.name));
  return el('section', {'data-panel': 'home'},
    el('h3', {}, 'Home mode'),
    el('div', {class: 'actions'},
      button('Home', () => write('brightwire-home.modes.set', {mode: 'home'}), {'data-mode': 'home'}),
      button('Away', () => write('brightwire-home.modes.set', {mode: 'away'}), {'data-mode': 'away'}),
      button('Night', () => write('brightwire-home.modes.set', {mode: 'night'}), {'data-mode': 'night'})
    ),
    el('h3', {}, 'Guest code'),
    el('div', {class: 'fields'},
      el('label', {class: 'field'}, 'Holder', holder),
      el('label', {class: 'field'}, 'Lock', lock),
      el('label', {class: 'field'}, 'Starts', start),
      el('label', {class: 'field'}, 'Ends', end),
      button('Create guest code', () => write('brightwire-home.access_codes.create', {
        name: holder.value,
        holder_name: holder.value,
        locks: [lock.value],
        schedule: {kind: 'window', start: start.value, end: end.value}
      }), {'data-action': 'create-code', class: 'primary'})
    )
  );
}

function render() {
  const nav = el('nav', {'aria-label': 'Brightwire'});
  const sections = [
    ['rooms', 'Rooms'],
    ['types', 'Types'],
    ['scenes', 'Scenes'],
    ['routines', 'Routines'],
    ['confirmations', 'Confirmations'],
    ['home', 'Home']
  ];
  for (const [id, label] of sections) {
    nav.append(el('button', {type: 'button', 'aria-current': section === id ? 'page' : false, 'data-section': id, onclick: () => { section = id; render(); }}, label));
  }
  const detailPane = el('section', {class: 'detail', 'aria-label': 'Selected device'});
  if (section === 'home') detailPane.append(extraPanel());
  else if (selected && section !== 'scenes' && section !== 'routines' && section !== 'confirmations') detailPane.append(detail(selected));
  else detailPane.append(el('div', {class: 'empty'}, el('p', {}, 'Choose a device, scene, or routine.')));
  root.replaceChildren(el('div', {class: 'app-shell'},
    el('aside', {class: 'sidebar'},
      el('div', {class: 'brand'}, el('span', {class: 'brand-mark', 'aria-hidden': 'true'}, 'B'), el('h1', {}, 'Brightwire')),
      nav
    ),
    el('main', {class: 'app-main'},
      el('header', {class: 'toolbar'}, el('h2', {class: 'section-title'}, 'Household'), button('Refresh', () => refresh(selected && selected.device_id), {'data-action': 'refresh'})),
      el('p', {role: 'status', 'aria-live': 'polite', id: 'status'}, 'Ready'),
      el('div', {id: 'results'}),
      el('div', {class: 'workspace'}, el('section', {class: 'collection'}, sideList()), detailPane)
    )
  ));
  document.body.dataset.app = config.id;
  showReceipt();
}

async function refresh(preferredId) {
  const listed = await call(config.list, {});
  version = listed.version;
  devices = listed.devices || [];
  const sceneList = await call('brightwire-home.scenes.list', {});
  const routineList = await call('brightwire-home.routines.list', {});
  const pending = await call('brightwire-home.confirmations.list', {});
  scenes = sceneList.scenes || [];
  routines = routineList.routines || [];
  confirmations = pending.confirmations || [];
  selected = devices.find(device => device.device_id === preferredId) || devices.find(device => device.device_id === 'light-living') || devices[0] || null;
  render();
}

async function start() {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('access');
    if (token) {
      history.replaceState(null, '', location.pathname);
      ({csrf} = await request('/session', 'POST', {token}));
    } else {
      ({csrf} = await request('/session'));
    }
    await refresh();
    showStatus('Ready');
  } catch (error) {
    root.replaceChildren(el('p', {id: 'status', 'data-error': 'true'}, error.message));
  }
}

start();
