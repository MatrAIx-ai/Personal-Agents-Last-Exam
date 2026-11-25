'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');

const registry = path.resolve(__dirname, '../../../apps.registry.json');
const clock = '2026-11-17T12:00:00-06:00';

function start() {
  const model = createRuntime({registryFile: registry});
  let state = model.create('brightwire-home', 'bw-runtime', 'sandbox');
  const loaded = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'seed-clock',
    virtual_now: clock,
    data: state.data,
    binding: state.binding,
    policies: state.policies,
    bundle: state.resources.bundle
  });
  assert.equal(loaded.result.status, 'ready');
  state = loaded.state;
  return {model, state};
}

function write(model, state, name, args, requestId) {
  return model.execute(state, 'agent', name, {
    ...args,
    expected_version: model.version(state),
    request_id: requestId
  });
}

test('advance_time does not fire routines, and the next write can', () => {
  const {model, state} = start();
  const moved = model.execute(state, 'infra', 'env.advance_time', {
    expected_version: model.version(state),
    request_id: 'clock-1',
    virtual_now: '2026-11-17T19:10:00-06:00'
  });
  assert.equal(moved.result.status, 'committed');
  assert.deepEqual(moved.state.data, state.data);
  const before = moved.state.data.devices.find(device => device.device_id === 'light-living').power;
  assert.equal(before, 'on');
  const fired = write(model, moved.state, 'brightwire-home.devices.command', {
    device_id: 'speaker-kitchen', command: 'set_volume', args: {volume: 4}
  }, 'after-clock');
  assert.equal(fired.result.status, 'committed');
  assert.equal(fired.state.data.firings.some(item => item.routine_id === 'rt-lamps-1900' && item.outcome === 'fired'), true);
});

test('a replay returns the first receipt and a stale version changes nothing', () => {
  const {model, state} = start();
  const args = {
    device_id: 'light-living',
    command: 'turn_off',
    expected_version: model.version(state),
    request_id: 'req-light'
  };
  const first = model.execute(state, 'agent', 'brightwire-home.devices.command', args);
  assert.equal(first.result.status, 'committed');
  assert.equal(first.state.data.devices.find(device => device.device_id === 'light-living').power, 'off');
  const replay = model.execute(first.state, 'agent', 'brightwire-home.devices.command', args);
  assert.equal(replay.result.duplicate, true);
  assert.equal(replay.result.status, 'committed');
  assert.deepEqual(replay.state.data, first.state.data);
  const stale = model.execute(first.state, 'agent', 'brightwire-home.devices.command', {
    ...args, request_id: 'req-other', expected_version: model.version(state)
  });
  assert.equal(stale.result.status, 'stale_version');
  assert.deepEqual(stale.state.data, first.state.data);
  const conflict = model.execute(first.state, 'agent', 'brightwire-home.devices.command', {
    ...args, command: 'turn_on'
  });
  assert.equal(conflict.result.status, 'idempotency_conflict');
  assert.deepEqual(conflict.state.data, first.state.data);
});

test('reset restores the loaded business data and the baseline clock', () => {
  const {model, state} = start();
  const changed = write(model, state, 'brightwire-home.devices.command', {
    device_id: 'light-living', command: 'turn_off'
  }, 'before-reset');
  const reset = model.execute(changed.state, 'infra', 'env.reset', {expected_version: model.version(changed.state)});
  assert.equal(reset.result.status, 'ready');
  assert.deepEqual(reset.state.data, state.data);
  assert.equal(reset.state.virtual_now, clock);
  assert.equal(reset.state.audit.length, 1);
  assert.equal(reset.state.audit[0].tool, 'env.reset');
  const changedAgain = write(model, reset.state, 'brightwire-home.devices.command', {
    device_id: 'light-hallway', command: 'turn_off'
  }, 'before-second-reset');
  const resetAgain = model.execute(changedAgain.state, 'infra', 'env.reset', {expected_version: model.version(changedAgain.state)});
  assert.equal(JSON.stringify(resetAgain.state.data), JSON.stringify(reset.state.data));
  assert.equal(resetAgain.state.virtual_now, reset.state.virtual_now);
  const denied = model.execute(reset.state, 'agent', 'env.snapshot', {});
  assert.equal(denied.result.status, 'permission_denied');
  assert.deepEqual(denied.state.data, reset.state.data);
});

test('a rejected command rolls the catch-up back with the command', () => {
  const {model, state} = start();
  const moved = model.execute(state, 'infra', 'env.advance_time', {
    expected_version: model.version(state), request_id: 'clock-2', virtual_now: '2026-11-17T19:10:00-06:00'
  });
  const failed = model.execute(moved.state, 'agent', 'brightwire-home.devices.command', {
    device_id: 'light-living', command: 'set_brightness', args: {brightness: 0},
    expected_version: model.version(moved.state), request_id: 'bad-brightness'
  });
  assert.equal(failed.result.status, 'value_out_of_range');
  assert.deepEqual(failed.state.data, moved.state.data);
  assert.equal(failed.state.data.committed_through, clock);
});

test('task 73 loads with its bundle, and a missing snapshot stays controllable', () => {
  const model = createRuntime({registryFile: registry});
  let state = model.create('brightwire-home', 'task-73-load', 'sandbox');
  const loaded = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'task-73-seed',
    virtual_now: '2026-11-17T19:42:00-06:00',
    data: require('../fixtures/task-73.json'),
    binding: require('../fixtures/binding-task-73.json'),
    policies: state.policies,
    bundle: state.resources.bundle
  });
  assert.equal(loaded.result.status, 'ready', JSON.stringify(loaded.result));
  state = loaded.state;
  state.data.available_snapshots = state.data.available_snapshots.filter(id => id !== 'snap-nursery');
  state.resources.bundle.catalog.assets = state.resources.bundle.catalog.assets.filter(asset => asset.asset_id !== 'snap-nursery');
  delete state.resources.bundle.blobs['snap-nursery'];
  const view = model.execute(state, 'agent', 'brightwire-home.devices.get', {device_id: 'camera-nursery'});
  assert.equal(view.result.status, 'ok');
  assert.equal(view.result.device.snapshot_status, 'asset_missing');
  const changed = model.execute(view.state, 'agent', 'brightwire-home.devices.command', {
    expected_version: model.version(view.state),
    request_id: 'privacy-without-snapshot',
    device_id: 'camera-nursery',
    command: 'set_privacy',
    args: {privacy: 'privacy_off'}
  });
  assert.equal(changed.result.status, 'committed', JSON.stringify(changed.result));
  assert.equal(changed.state.data.devices.find(device => device.device_id === 'camera-nursery').privacy, 'privacy_off');
});

test('load_seed rejects a snapshot id that is not in the catalog', () => {
  const model = createRuntime({registryFile: registry});
  const state = model.create('brightwire-home', 'snap-check', 'sandbox');
  const data = structuredClone(require('../fixtures/minimal.json'));
  data.available_snapshots = data.available_snapshots.concat(['snap-made-up']);
  const loaded = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'snap-made-up',
    virtual_now: data.committed_through,
    data,
    binding: state.binding,
    policies: state.policies,
    bundle: state.resources.bundle
  });
  assert.equal(loaded.result.status, 'invalid_seed', JSON.stringify(loaded.result));
  assert.equal(loaded.state.data.available_snapshots.includes('snap-made-up'), false);
  const iconData = structuredClone(require('../fixtures/minimal.json'));
  iconData.available_snapshots = iconData.available_snapshots.concat(['icon-living']);
  const iconLoad = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'snap-icon',
    virtual_now: iconData.committed_through,
    data: iconData,
    binding: state.binding,
    policies: state.policies,
    bundle: state.resources.bundle
  });
  assert.equal(iconLoad.result.status, 'invalid_seed', JSON.stringify(iconLoad.result));
  const dropped = structuredClone(state.resources.bundle);
  dropped.catalog.assets = dropped.catalog.assets.filter(asset => asset.asset_id !== 'snap-nursery');
  delete dropped.blobs['snap-nursery'];
  dropped.dataset.expected_counts.assets -= 1;
  const event = model.execute(state, 'infra', 'env.apply_event', {
    expected_version: model.version(state),
    event: {
      event_id: 'drop-snapshot',
      at: '2026-11-18T09:01:00-08:00',
      operation: 'sensor.change',
      payload: {device_id: 'contact-front', state: 'open'}
    },
    bundle: dropped
  });
  assert.equal(event.result.status, 'invalid_bundle', JSON.stringify(event.result));
  assert.equal(event.state.resources.bundle.catalog.assets.some(asset => asset.asset_id === 'snap-nursery'), true);
});

test('a camera read reports a snapshot the bundle marks missing', () => {
  const model = createRuntime({registryFile: registry});
  const state = model.create('brightwire-home', 'snap-missing', 'sandbox');
  const bundle = structuredClone(state.resources.bundle);
  const asset = bundle.catalog.assets.find(item => item.asset_id === 'snap-nursery');
  asset.availability = {status: 'missing', reason: 'The replacement bundle has no bytes for this snapshot.'};
  delete asset.integrity;
  delete bundle.blobs['snap-nursery'];
  const event = model.execute(state, 'infra', 'env.apply_event', {
    expected_version: model.version(state),
    event: {
      event_id: 'mark-snapshot-missing',
      at: '2026-11-18T09:01:00-08:00',
      operation: 'sensor.change',
      payload: {device_id: 'contact-front', state: 'open'}
    },
    bundle
  });
  assert.equal(event.result.status, 'committed', JSON.stringify(event.result));
  const view = model.execute(event.state, 'agent', 'brightwire-home.devices.get', {device_id: 'camera-nursery'});
  assert.equal(view.result.status, 'ok');
  assert.equal(view.result.device.snapshot_status, 'asset_missing');
  assert.equal(view.state.data.available_snapshots.includes('snap-nursery'), true);
});

test('agent resource discovery lists no images on the default household', () => {
  const model = createRuntime({registryFile: registry});
  const state = model.create('brightwire-home', 'resource-list', 'sandbox');
  assert.equal(state.data.scopes.camera, 'none');
  const images = state.resources.bundle.catalog.assets.filter(asset => String(asset.mime_type).startsWith('image/'));
  const visible = images.filter(asset => model.resource(state, asset.asset_id).status !== 'not_available');
  assert.equal(images.length > 0, true);
  assert.equal(visible.length, 0);
  assert.equal(model.resource(state, 'snap-nursery').status, 'not_available');
});

test('household C reads a missing porch snapshot as not ready', () => {
  const model = createRuntime({registryFile: registry});
  const state = model.create('brightwire-home', 'snap-chen', 'sandbox');
  const data = structuredClone(require('../fixtures/household-c.json'));
  const loaded = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'seed-chen-snap',
    virtual_now: data.committed_through,
    data,
    binding: require('../fixtures/binding-household-c.json'),
    policies: state.policies,
    bundle: state.resources.bundle
  });
  assert.equal(loaded.result.status, 'ready', JSON.stringify(loaded.result));
  const bundle = structuredClone(loaded.state.resources.bundle);
  const asset = bundle.catalog.assets.find(item => item.asset_id === 'snap-garage');
  asset.availability = {status: 'missing', reason: 'The replacement bundle has no bytes for this snapshot.'};
  delete asset.integrity;
  delete bundle.blobs['snap-garage'];
  const event = model.execute(loaded.state, 'infra', 'env.apply_event', {
    expected_version: model.version(loaded.state),
    event: {
      event_id: 'chen-snapshot-missing',
      at: '2026-11-17T12:01:00-06:00',
      operation: 'sensor.change',
      payload: {device_id: 'c-contact-front', state: 'open'}
    },
    bundle
  });
  assert.equal(event.result.status, 'committed', JSON.stringify(event.result));
  const view = model.execute(event.state, 'agent', 'brightwire-home.devices.get', {device_id: 'c-camera-porch'});
  assert.equal(view.result.status, 'ok');
  assert.equal(view.result.device.snapshot_status, 'asset_missing');
});

test('a snapshot relabelled as an icon reads as not ready', () => {
  const model = createRuntime({registryFile: registry});
  const state = model.create('brightwire-home', 'snap-icon-role', 'sandbox');
  const bundle = structuredClone(state.resources.bundle);
  const asset = bundle.catalog.assets.find(item => item.asset_id === 'snap-nursery');
  asset.roles = ['ui.icon'];
  const event = model.execute(state, 'infra', 'env.apply_event', {
    expected_version: model.version(state),
    event: {
      event_id: 'nursery-snapshot-icon',
      at: '2026-11-18T09:01:00-08:00',
      operation: 'sensor.change',
      payload: {device_id: 'contact-front', state: 'open'}
    },
    bundle
  });
  assert.equal(event.result.status, 'committed', JSON.stringify(event.result));
  const view = model.execute(event.state, 'agent', 'brightwire-home.devices.get', {device_id: 'camera-nursery'});
  assert.equal(view.result.status, 'ok');
  assert.equal(view.result.device.snapshot_status, 'asset_missing');
  assert.equal(view.state.data.available_snapshots.includes('snap-nursery'), true);
});

test('evidence joins the later allow row and keeps each client name', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const {Client} = require('../../../runtime/client.cjs');
  const {exportEvidence} = require('../evaluator/export.cjs');
  const dir = fs.mkdtempSync(require('node:path').join(os.tmpdir(), 'bw-join-'));
  const clients = [];
  try {
    const infra = new Client('brightwire-home', 'infra', 'bw-join', dir, 'infra-loader', {registry, initialProfile: 'sandbox'});
    const left = new Client('brightwire-home', 'agent', 'bw-join', dir, 'grader-a', {registry});
    const right = new Client('brightwire-home', 'agent', 'bw-join', dir, 'grader-b', {registry});
    clients.push(infra, left, right);
    await infra.initialize();
    await left.initialize();
    await right.initialize();
    const snap = await infra.call('env.snapshot');
    const version = snap.version;
    const denied = await left.call('brightwire-home.devices.command', {
      expected_version: version, request_id: 'same-light', device_id: 'light-living', command: 'set_brightness', args: {brightness: 500}
    });
    assert.equal(denied.status, 'value_out_of_range');
    const committed = await left.call('brightwire-home.devices.command', {
      expected_version: version, request_id: 'same-light', device_id: 'light-living', command: 'turn_off'
    });
    assert.equal(committed.status, 'committed');
    const other = await right.call('brightwire-home.devices.command', {
      expected_version: committed.version, request_id: 'other-light', device_id: 'light-hallway', command: 'turn_off'
    });
    assert.equal(other.status, 'committed');
    const after = await infra.call('env.snapshot');
    const evidence = exportEvidence({
      snapshot: after,
      agent_executions: [{tool: 'brightwire-home.devices.command', status: 'value_out_of_range', request_id: 'same-light'}]
    });
    const row = evidence.history.find(entry => entry.request_id === 'same-light' && entry.device_id === 'light-living');
    assert.equal(row.audit_decision, 'allow');
    assert.equal(row.client_name, 'grader-a');
    assert.ok(row.connection_id);
    assert.equal(row.caller_role, 'agent');
    assert.equal(row.tool, 'brightwire-home.devices.command');
    const second = evidence.history.find(entry => entry.request_id === 'other-light');
    assert.equal(second.client_name, 'grader-b');
    assert.notEqual(second.connection_id, row.connection_id);
    assert.equal(evidence.rejected.filter(item => item.request_id === 'same-light').length, 1);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('the task 73 reference path exports hallway brightness from the snapshot receipt', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const {Client} = require('../../../runtime/client.cjs');
  const {exportEvidence} = require('../evaluator/export.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-hallway-'));
  const clients = [];
  try {
    const infra = new Client('brightwire-home', 'infra', 'task-73-ref', dir, 'task-infra', {registry, initialProfile: 'sandbox'});
    const agent = new Client('brightwire-home', 'agent', 'task-73-ref', dir, 'task-agent', {registry});
    clients.push(infra, agent);
    await infra.initialize();
    await agent.initialize();
    const opened = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: opened.version,
      request_id: 'task-73-ref-seed',
      virtual_now: '2026-11-17T19:42:00-06:00',
      data: require('../fixtures/task-73.json'),
      binding: require('../fixtures/binding-task-73.json'),
      policies: opened.snapshot.policies,
      bundle: opened.snapshot.resources.bundle
    });
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    const wrote = await agent.call('brightwire-home.devices.command', {
      expected_version: loaded.version,
      request_id: 'hallway-20',
      device_id: 'light-hallway',
      command: 'set_brightness',
      args: {brightness: 20}
    });
    assert.equal(wrote.status, 'committed', JSON.stringify(wrote));
    const after = await infra.call('env.snapshot');
    assert.equal(after.snapshot.data.devices.find(device => device.device_id === 'light-hallway').brightness, 20);
    const evidence = exportEvidence({snapshot: after});
    const call = evidence.calls.find(item => item.request_id === 'hallway-20');
    assert.equal(call.target, 'light-hallway');
    assert.equal(call.command, 'set_brightness');
    assert.deepEqual(call.arguments, {brightness: 20});
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('a clock advance that reuses a request id stays a clock advance', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const {Client} = require('../../../runtime/client.cjs');
  const {exportEvidence} = require('../evaluator/export.cjs');
  const {task73} = require('../examples/task-73-grade.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-shared-id-'));
  const clients = [];
  try {
    const infra = new Client('brightwire-home', 'infra', 'task-73-shared', dir, 'task-infra', {registry, initialProfile: 'sandbox'});
    const agent = new Client('brightwire-home', 'agent', 'task-73-shared', dir, 'task-agent', {registry});
    clients.push(infra, agent);
    await infra.initialize();
    await agent.initialize();
    const opened = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: opened.version,
      request_id: 'task-73-shared-seed',
      virtual_now: '2026-11-17T19:42:00-06:00',
      data: require('../fixtures/task-73.json'),
      binding: require('../fixtures/binding-task-73.json'),
      policies: opened.snapshot.policies,
      bundle: opened.snapshot.resources.bundle
    });
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    const off = await agent.call('brightwire-home.devices.command', {
      expected_version: loaded.version,
      request_id: 'living-off',
      device_id: 'light-living',
      command: 'turn_off'
    });
    assert.equal(off.status, 'committed', JSON.stringify(off));
    const moved = await infra.call('env.advance_time', {
      expected_version: off.version,
      request_id: 'living-off',
      virtual_now: '2026-11-17T19:43:00-06:00'
    });
    assert.equal(moved.status, 'committed', JSON.stringify(moved));
    const later = await infra.call('env.advance_time', {
      expected_version: moved.version,
      request_id: 'clock-1944',
      virtual_now: '2026-11-17T19:44:00-06:00'
    });
    assert.equal(later.status, 'committed', JSON.stringify(later));
    const wrote = await agent.call('brightwire-home.devices.command', {
      expected_version: later.version,
      request_id: 'hallway-20',
      device_id: 'light-hallway',
      command: 'set_brightness',
      args: {brightness: 20}
    });
    assert.equal(wrote.status, 'committed', JSON.stringify(wrote));
    const after = await infra.call('env.snapshot');
    const evidence = exportEvidence({snapshot: after});
    const advance = evidence.calls.find(call => call.seq === 3);
    assert.equal(advance.tool, 'env.advance_time');
    assert.equal(advance.actor, 'infra');
    assert.equal(advance.request_id, 'living-off');
    const commands = evidence.calls.filter(call => call.tool === 'brightwire-home.devices.command');
    assert.equal(commands.length, 2);
    assert.deepEqual(commands.map(call => ({target: call.target, command: call.command, arguments: call.arguments})), [
      {target: 'light-living', command: 'turn_off', arguments: {}},
      {target: 'light-hallway', command: 'set_brightness', arguments: {brightness: 20}}
    ]);
    assert.equal(task73(evidence).fresh_device_commands.length, 2);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('an approved confirmation joins the infra event and keeps the assistant actor', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const {Client} = require('../../../runtime/client.cjs');
  const {exportEvidence} = require('../evaluator/export.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-approve-'));
  const clients = [];
  try {
    const infra = new Client('brightwire-home', 'infra', 'bw-approve', dir, 'owner-desk', {registry, initialProfile: 'sandbox'});
    const agent = new Client('brightwire-home', 'agent', 'bw-approve', dir, 'grader-agent', {registry});
    clients.push(infra, agent);
    await infra.initialize();
    await agent.initialize();
    const opened = await infra.call('env.snapshot');
    const asked = await agent.call('brightwire-home.devices.command', {
      expected_version: opened.version,
      request_id: 'ask-unlock',
      device_id: 'lock-front',
      command: 'unlock'
    });
    assert.equal(asked.status, 'committed', JSON.stringify(asked));
    assert.equal(asked.outcome, 'confirmation_required');
    const resolved = await infra.call('env.apply_event', {
      expected_version: asked.version,
      event: {
        event_id: 'approve-unlock',
        at: opened.snapshot.virtual_now,
        operation: 'confirmation.resolved',
        payload: {confirmation_id: asked.confirmation_id, decision: 'approved', by_person_id: 'person-hana'}
      }
    });
    assert.equal(resolved.status, 'committed', JSON.stringify(resolved));
    const after = await infra.call('env.snapshot');
    const evidence = exportEvidence({snapshot: after});
    const unlock = evidence.history.find(entry => entry.event_id === 'approve-unlock' && entry.command === 'unlock');
    assert.equal(unlock.actor_kind, 'assistant');
    assert.equal(unlock.device_id, 'lock-front');
    assert.equal(unlock.caller_role, 'infra');
    assert.equal(unlock.tool, 'env.apply_event');
    assert.equal(unlock.client_name, 'owner-desk');
    assert.ok(unlock.connection_id);
    const approval = evidence.history.find(entry => entry.event_id === 'approve-unlock' && entry.command === 'confirmation_approved');
    assert.equal(approval.caller_role, 'infra');
    assert.equal(approval.tool, 'env.apply_event');
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
