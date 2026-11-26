#!/usr/bin/env node
'use strict';
// Builds the reference scenario bundles examples/scenarios/<id>/{base,twin}/ from each scenario.json and its full
// fixture (fixtures/students/<student>/). The scenario's `changes` apply to both members and the twin's `changes` to
// the twin only: `update` merges fields into records found by ID, `add` appends records and `set` replaces a
// top-level field. A twin may also replace the setup (`twin.setup`). Each bundle must pass the seed schema and
// validateSeed at the scenario's `load_at`, and every setup event the event schema. Run
// `node scripts/build-scenarios.cjs`; `--check` reports drift and writes nothing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const model = require('../src/model.cjs');
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
const setupOf = (spec, variant) => (variant === 'twin' && spec.twin.setup) || spec.setup;

function apply(seed, changes = {}, where) {
  for (const [collection, byId] of Object.entries(changes.update || {})) {
    for (const [id, set] of Object.entries(byId)) {
      const record = (seed[collection] || []).find(x => x.id === id) || fail(`${where}: no ${collection} record ${id} to update`);
      Object.assign(record, structuredClone(set));
    }
  }
  for (const [collection, records] of Object.entries(changes.add || {})) (seed[collection] || fail(`${where}: no list ${collection}`)).push(...structuredClone(records));
  for (const [key, value] of Object.entries(changes.set || {})) {
    if (!(key in seed)) fail(`${where}: no field ${key} to set`);
    seed[key] = structuredClone(value);
  }
}

function build(spec, variant) {
  const where = `${spec.id}/${variant}`, fixture = path.join(root, 'fixtures/students', spec.student);
  const seed = read(path.join(fixture, 'seed.json')), dataset = read(path.join(fixture, 'dataset.json'));
  apply(seed, spec.changes, where);
  if (variant === 'twin') apply(seed, spec.twin.changes, where);
  const binding = read(path.join(fixture, 'binding.json'));
  binding.objects = {tutorwell: model.objects(seed)};
  if (!seedValid(seed)) fail(`${where}: seed does not match the seed schema`);
  model.validateSeed({app_id: 'tutorwell', binding, virtual_now: spec.load_at}, seed);
  for (const step of setupOf(spec, variant)) if (step.event && !eventValid(step.event)) fail(`${where}: setup event ${step.event.event_id} does not match the event schema`);
  const last = setupOf(spec, variant).at(-1);
  if (!last || last.advance_to !== spec.ask_at) fail(`${where}: the setup must end by moving the clock to ask_at`);

  dataset.dataset_id = `tutorwell-${spec.id}-${variant}`;
  dataset.description = `Reference scenario ${spec.id} (${variant}) on the synthetic student of fixtures/students/${spec.student}: ${spec.title}. ` +
    `Load with env.load_seed at virtual_now ${spec.load_at} with this binding.json, then apply the ${variant} setup in ../scenario.json.`;
  dataset.record_source_ids = [...dataset.record_source_ids, 'scenario'];
  dataset.sources.push({source_id: 'scenario', kind: 'synthetic',
    description: `Records written by hand for the scenario (examples/scenarios/${spec.id}/scenario.json). Both members: ${spec.changes.describe}` +
      (variant === 'twin' ? ` Twin only: ${spec.twin.describe}` : ''),
    uri: null, license: 'MIT', usage: 'permitted', collection: null,
    generation: {method: 'manual', tool: 'apps/tutorwell/scripts/build-scenarios.cjs', tool_version: dataset.version, seed: null, parameters: {scenario: spec.id, variant}}});
  dataset.transformations = [...dataset.transformations, `Scenario changes applied to the full fixture ${spec.student}${variant === 'twin' ? ', then the twin changes' : ''}.`];
  dataset.expected_counts = {records: model.records(seed).length, assets: 0};
  if (!datasetValid(dataset)) fail(`${where}: dataset.json does not match the dataset schema`);
  const catalog = {schema_version: 'pale.asset-catalog.v1', catalog_id: `tutorwell-${spec.id}-${variant}-assets`, app_id: 'tutorwell', dataset_ref: 'dataset.json', assets: [], extensions: []};
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

module.exports = {build, run, scenarios, setupOf, FILES};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = run({check});
  if (drift.length) { console.error('Generated scenario drift: ' + drift.join(', ')); process.exit(1); }
  console.log(check ? 'Scenario bundles match their scenario.json and fixtures.' : 'Wrote examples/scenarios/<id>/{base,twin}/.');
}
