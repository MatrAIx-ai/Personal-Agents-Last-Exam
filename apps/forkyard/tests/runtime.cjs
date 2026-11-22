'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');

const registry = path.resolve(__dirname, '../../../apps.registry.json');
const model = createRuntime({registryFile: registry});

function call(state, name, args) {
  return model.execute(state, 'agent', name, {expected_version: model.version(state), ...args});
}

const first = model.create('forkyard', 'fy-runtime', 'sandbox');
const stale = model.execute(first, 'agent', 'forkyard.profile.update_self', {
  expected_version: {epoch: 1, revision: 9}, request_id: 'stale-profile', expected_revision: 1, bio: 'no'
});
assert.equal(stale.result.status, 'stale_version');
assert.deepEqual(stale.state.data, first.data);

const denied = call(first, 'forkyard.pulls.reopen', {request_id: 'reopen-same', repo: 'tidewater/tidewater', number: 2288});
assert.equal(denied.result.status, 'reopen_not_allowed');
assert.deepEqual(denied.state.data, first.data);
const deniedAgain = call(denied.state, 'forkyard.pulls.reopen', {request_id: 'reopen-same', repo: 'tidewater/tidewater', number: 2288});
assert.equal(deniedAgain.result.status, 'reopen_not_allowed');
assert.equal(deniedAgain.state.audit.filter(row => row.tool === 'forkyard.pulls.reopen' && row.decision === 'deny').length, 2);
const deniedNew = call(deniedAgain.state, 'forkyard.pulls.reopen', {request_id: 'reopen-new', repo: 'tidewater/tidewater', number: 2288});
assert.equal(deniedNew.state.audit.filter(row => row.tool === 'forkyard.pulls.reopen' && row.decision === 'deny').length, 3);

const profileArgs = {expected_version: model.version(deniedNew.state), request_id: 'profile-1', expected_revision: 1, bio: 'Runtime bio'};
const written = model.execute(deniedNew.state, 'agent', 'forkyard.profile.update_self', profileArgs);
assert.equal(written.result.status, 'committed');
assert.equal(written.result.revision, 2);
const replay = model.execute(written.state, 'agent', 'forkyard.profile.update_self', profileArgs);
assert.equal(replay.result.duplicate, true);
assert.equal(replay.result.revision, 2);
assert.equal(replay.state.revision, written.state.revision);
const conflict = call(written.state, 'forkyard.profile.update_self', {request_id: 'profile-1', expected_revision: 1, bio: 'Different bio'});
assert.equal(conflict.result.status, 'idempotency_conflict');
assert.equal(conflict.state.data.accounts.find(item => item.account_id === 'fy-tomasreyes').bio, 'Runtime bio');

const read = model.execute(written.state, 'agent', 'forkyard.repos.get', {repo: 'tidewater/tidewater'});
assert.equal(read.result.status, 'ok');
assert.equal(read.state.revision, written.state.revision);

function reset(state) {
  return model.execute(state, 'infra', 'env.reset', {expected_version: model.version(state)});
}
const once = reset(written.state);
const twice = reset(once.state);
assert.equal(once.result.status, 'ready');
assert.deepEqual(twice.state.data, once.state.data);
assert.equal(twice.state.virtual_now, once.state.virtual_now);
assert.deepEqual(twice.state.data, first.data);
assert.equal(twice.state.virtual_now, first.virtual_now);
assert.notEqual(twice.state.epoch, once.state.epoch);
assert.notEqual(JSON.stringify(twice.state.audit), JSON.stringify(once.state.audit));
console.log(JSON.stringify({
  passed: true,
  app: 'forkyard',
  stale: stale.result.status,
  denied_rows: 3,
  replay: replay.result.duplicate,
  reset_epochs: [once.state.epoch, twice.state.epoch],
  virtual_now: twice.state.virtual_now
}, null, 2));
