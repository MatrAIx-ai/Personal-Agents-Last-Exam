'use strict';
// Loads one fixture from fixtures/index.json into a run through Infra's
// env.load_seed, with its binding, the shared policies, a dataset bundle whose
// record source is that fixture, and the fixture's own clock. Core starts every
// run from the manifest seed (Hillcrest) at the registry's initial_time, so the
// checks and the Web Host helper use this to switch a run to Maple St or
// Riverside.
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(app, file), 'utf8'));

function entryOf(key) {
  const entry = read('fixtures/index.json').fixtures.find(f => f.key === key);
  if (!entry) throw new Error('Unknown fixture ' + key);
  return entry;
}

// The env.load_seed arguments for a fixture (or for data and a clock built from
// it, such as a cut-off).
function loadArgs(key, {data, binding, clock, requestId} = {}) {
  const entry = entryOf(key);
  data = data || read(entry.seed);
  const dataset = read('contribution/dataset.json');
  dataset.record_source_ids = [key];
  dataset.expected_counts = {records: data.events.length, assets: 0};
  return {request_id: requestId || 'load-' + key, data, binding: binding || read(entry.binding), policies: read('fixtures/policies.json'),
    bundle: {dataset, catalog: read('contribution/assets.catalog.json'), blobs: {}}, virtual_now: clock || entry.clock};
}

async function loadFixture(infra, key, options) {
  const s = await infra.call('env.snapshot');
  const loaded = await infra.call('env.load_seed', {expected_version: s.version, ...loadArgs(key, options)});
  if (loaded.status !== 'ready') throw new Error('env.load_seed ' + key + ': ' + JSON.stringify(loaded));
  return loaded;
}

module.exports = {entryOf, loadArgs, loadFixture};
