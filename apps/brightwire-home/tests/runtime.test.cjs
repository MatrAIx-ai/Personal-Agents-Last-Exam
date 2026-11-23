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
