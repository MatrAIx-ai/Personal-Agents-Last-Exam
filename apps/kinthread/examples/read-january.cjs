'use strict';
const path = require('node:path');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');
const {exportEvidence} = require('../evaluator/export.cjs');

const root = path.resolve(__dirname, '../../..');
const appRoot = path.resolve(__dirname, '..');
const runtime = createRuntime({registryFile: path.join(root, 'apps.registry.json')});

function read(file) {
  return require(path.join(appRoot, file));
}
function version(state) {
  return {epoch: state.epoch, revision: state.revision};
}

function main() {
  const dir = 'fixtures/a-family-care/later';
  const state = runtime.create('kinthread', 'january-read', 'sandbox');
  const loaded = runtime.execute(state, 'infra', 'env.load_seed', {
    expected_version: version(state),
    request_id: 'later-family',
    data: read(dir + '/seed.json'),
    binding: read(dir + '/binding.json'),
    policies: read(dir + '/policies.json'),
    bundle: read('fixtures/a-family-care/bundle.json'),
    virtual_now: read(dir + '/clock.json').initial_time
  });
  if (loaded.result.status !== 'ready') throw new Error('Later family seed did not load.');
  const members = runtime.execute(loaded.state, 'agent', 'kinthread.members.list', {group_id: 'grp-osei-care'});
  const daniel = members.result.members.find(item => item.person_id === 'person-daniel');
  const evidence = exportEvidence({kinthread: loaded.state.data, messages: read(dir + '/messages-seed.json')});
  const message = evidence.messages.find(item => String(item.sent_at).startsWith('2025-01') && item.author_person_id === 'person-daniel');
  const report = {
    joined_at: daniel.joined_at,
    display_name: daniel.display_name,
    message_id: message.message_id,
    sent_at: message.sent_at,
    role: message.role
  };
  console.log(JSON.stringify(report));
  if (!String(daniel.joined_at).startsWith('2025-01-01') || !message) process.exitCode = 1;
}
main();
