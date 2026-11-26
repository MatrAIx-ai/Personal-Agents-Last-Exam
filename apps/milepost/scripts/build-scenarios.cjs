#!/usr/bin/env node
'use strict';
// Builds the reference scenario bundles examples/scenarios/<id>/{base,twin}/ from each scenario.json and its full
// fixture (fixtures/students/<student>/): the scenario's `changes` apply to both members, the twin's `changes`
// to the twin only. Each bundle has seed.json, binding.json, dataset.json and catalog.json and must pass the seed
// schema and validateSeed at the scenario's `load_at`. Run `node scripts/build-scenarios.cjs`; `--check` reports
// drift and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const model = require('../src/model.cjs');
const {ms} = require('../src/time.cjs');
const {compile} = require('../tests/schema-validator.cjs');

const schema = name => compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8')), path.join(root, 'schemas'));
const seedValid = schema('seed.schema.json'), datasetValid = schema('dataset.schema.json'), eventValid = schema('events.schema.json');
const DIR = path.join(root, 'examples/scenarios');
const FILES = ['seed.json', 'binding.json', 'dataset.json', 'catalog.json'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = message => { throw new Error(message); };

function scenarios() {
  return fs.readdirSync(DIR).filter(d => fs.existsSync(path.join(DIR, d, 'scenario.json'))).sort().map(d => read(path.join(DIR, d, 'scenario.json')));
}

function apply(seed, changes = {}, where) {
  for (const [collection, byId] of Object.entries(changes.update || {})) {
    for (const [id, set] of Object.entries(byId)) {
      const record = seed[collection].find(r => r.id === id) || fail(`${where}: no ${collection} record ${id} to update`);
      Object.assign(record, set);
    }
  }
  for (const [collection, records] of Object.entries(changes.add || {})) seed[collection].push(...structuredClone(records));
}
const byTime = key => (a, b) => ms(a[key]) - ms(b[key]) || (a.id < b.id ? -1 : 1);

function build(spec, variant) {
  const where = `${spec.id}/${variant}`, fixture = path.join(root, 'fixtures/students', spec.student);
  const seed = read(path.join(fixture, 'seed.json')), dataset = read(path.join(fixture, 'dataset.json'));
  apply(seed, spec.changes, where);
  if (variant === 'twin') apply(seed, spec.twin.changes, where);
  seed.practice.sort(byTime('ended_at'));
  seed.plan.sort(byTime('start'));
  const binding = read(path.join(fixture, 'binding.json'));
  binding.objects = {milepost: model.objects(seed)};
  if (!seedValid(seed)) fail(`${where}: seed does not match the seed schema`);
  model.validateSeed({app_id: 'milepost', binding, virtual_now: spec.load_at}, seed);
  for (const step of spec.setup) if (step.event && !eventValid(step.event)) fail(`${where}: setup event ${step.event.event_id} does not match the event schema`);

  dataset.dataset_id = `milepost-${spec.id}-${variant}`;
  dataset.description = `Reference scenario ${spec.id} (${variant}) on the synthetic student of fixtures/students/${spec.student}: "${spec.title}". ` +
    `Load with env.load_seed at virtual_now ${spec.load_at} with this binding.json and the package's fixtures/policies.json, then apply the setup in ../scenario.json.`;
  dataset.record_source_ids = [...dataset.record_source_ids, 'scenario'];
  dataset.sources.push({source_id: 'scenario', kind: 'synthetic',
    description: `Records written by hand for the scenario (examples/scenarios/${spec.id}/scenario.json). Both members: ${spec.changes.describe}` +
      (variant === 'twin' ? ` Twin only: ${spec.twin.describe}` : ''),
    uri: null, license: 'MIT', usage: 'permitted', collection: null,
    generation: {method: 'manual', tool: 'apps/milepost/scripts/build-scenarios.cjs', tool_version: dataset.version, seed: null, parameters: {scenario: spec.id, variant}}});
  dataset.transformations = [...dataset.transformations, `Scenario changes applied to the full fixture ${spec.student}${variant === 'twin' ? ', then the twin changes' : ''}; sessions sorted by end time and blocks by start.`];
  dataset.expected_counts = {records: model.records(seed).length, assets: 0};
  if (!datasetValid(dataset)) fail(`${where}: dataset.json does not match the dataset schema`);
  const catalog = {schema_version: 'pale.asset-catalog.v1', catalog_id: `milepost-${spec.id}-${variant}-assets`, app_id: 'milepost', dataset_ref: 'dataset.json', assets: [], extensions: []};
  return {'seed.json': seed, 'binding.json': binding, 'dataset.json': dataset, 'catalog.json': catalog};
}

function run({check = false} = {}) {
  const drift = [];
  for (const spec of scenarios()) {
    for (const variant of ['base', 'twin']) {
      const files = build(spec, variant), dir = path.join(DIR, spec.id, variant);
      if (!check) fs.mkdirSync(dir, {recursive: true});
      for (const name of FILES) {
        const target = path.join(dir, name), text = JSON.stringify(files[name], null, 2) + '\n';
        if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(`examples/scenarios/${spec.id}/${variant}/${name}`); }
        else fs.writeFileSync(target, text);
      }
      if (check && fs.existsSync(dir)) for (const extra of fs.readdirSync(dir).filter(f => !FILES.includes(f))) drift.push(`examples/scenarios/${spec.id}/${variant}/${extra} (not generated)`);
    }
  }
  return drift;
}

module.exports = {build, run, scenarios, FILES};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = run({check});
  if (drift.length) { console.error('Generated scenario drift: ' + drift.join(', ')); process.exit(1); }
  console.log(check ? 'Scenario bundles match their scenario.json and fixtures.' : 'Wrote examples/scenarios/<id>/{base,twin}/.');
}
