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
  state.resources.bundle.catalog.assets = state.resources.bundle.catalog.assets.filter(asset => asset.asset_id !== 'snap-nursery');
  const view = model.execute(state, 'agent', 'brightwire-home.devices.get', {device_id: 'camera-nursery'});
  assert.equal(view.result.status, 'ok');
  assert.equal(view.result.device.snapshot_status, 'asset_missing');
  const plugin = require('../plugin.cjs');
  const changed = plugin.handleTool({
    app_id: 'brightwire-home',
    virtual_now: state.virtual_now,
    binding: state.binding,
    asset_ids: state.resources.bundle.catalog.assets.map(asset => asset.asset_id),
    request_id: 'privacy-without-snapshot'
  }, structuredClone(state.data), 'brightwire-home.devices.command', {
    device_id: 'camera-nursery', command: 'set_privacy', args: {privacy: 'privacy_off'}
  });
  assert.equal(changed.result.outcome, 'applied');
  assert.equal(changed.data.devices.find(device => device.device_id === 'camera-nursery').privacy, 'privacy_off');
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
