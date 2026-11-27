#!/usr/bin/env node
'use strict';
// Writes this package's generated contract files from dev/contracts.cjs:
//   schemas/seed.schema.json, schemas/events.schema.json, tools.json
// and refreshes the fields of contribution/contribution.json that are derived
// from tools.json and app.json. It only ever touches files inside this package.
//
//   node dev/generate-contracts.cjs          write
//   node dev/generate-contracts.cjs --check  compare only; exit 1 on drift
const fs = require('node:fs');
const path = require('node:path');
const contracts = require('./contracts.cjs');

const root = path.resolve(__dirname, '..');
// The portable Core API 1.2 lifecycle baseline, in the order the shared
// declaration check expects. The host-provided clock operation is discovered
// on the Infra connection and is deliberately not declared by Apps.
const ADMIN = ['env.reset', 'env.load_seed', 'env.apply_event', 'env.snapshot', 'env.event_status', 'env.validate_bundle'];
const json = value => JSON.stringify(value, null, 2) + '\n';

function contribution(tools) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const file = path.join(root, manifest.contribution);
  const declaration = JSON.parse(fs.readFileSync(file, 'utf8'));
  declaration.dependencies.core_api = manifest.core_api_version;
  declaration.dependencies.required_apps = manifest.dependencies.map(d => d.app_id);
  for (const surface of declaration.interfaces) {
    if (surface.status !== 'implemented' || surface.audience.length !== 1) continue;
    if (surface.audience[0] === 'agent') {
      surface.operations = tools.map(t => ({name: t.name, effect: t.read_only ? 'read' : 'write', caller: 'agent'}));
    }
    if (surface.audience[0] === 'infra') {
      surface.operations = ADMIN.map(name => ({name, effect: 'admin', caller: 'infra'}));
    }
  }
  declaration.events.accepts = manifest.event_types.map(type =>
    ({type, schema_ref: manifest.schemas.events, status: 'implemented'}));
  return {file: manifest.contribution, text: json(declaration)};
}

function outputs() {
  const tools = contracts.tools();
  const derived = contribution(tools);
  return [
    {file: 'schemas/seed.schema.json', text: json(contracts.seedSchema())},
    {file: 'schemas/events.schema.json', text: json(contracts.eventsSchema())},
    {file: 'tools.json', text: json(tools)},
    derived
  ];
}

function drift() {
  return outputs().filter(o => {
    const file = path.join(root, o.file);
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== o.text;
  }).map(o => o.file);
}

module.exports = {outputs, drift};

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const changed = drift();
    if (changed.length) {
      console.error('Generated contract drift: ' + changed.join(', ') + '. Run: node dev/generate-contracts.cjs');
      process.exitCode = 1;
    } else console.log('Generated contracts match dev/contracts.cjs.');
  } else {
    for (const o of outputs()) fs.writeFileSync(path.join(root, o.file), o.text);
    console.log('Wrote ' + outputs().map(o => o.file).join(', '));
  }
}
