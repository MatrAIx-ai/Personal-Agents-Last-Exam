'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { compile } = require('./schema-validator.cjs');

const root = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function createHarness() {
  const seed = readJson('fixtures/minimal.json');
  const binding = readJson('fixtures/binding.json');
  const clock = readJson('fixtures/clock.json');
  const catalog = readJson('contribution/assets.catalog.json');
  const seedValidator = compile(readJson('schemas/seed.schema.json'), path.join(root, 'schemas'));
  const eventValidator = compile(readJson('schemas/events.schema.json'), path.join(root, 'schemas'));
  const tools = new Map(readJson('tools.json').map(t => [t.name, t]));
  const inValidators = new Map([...tools.entries()].map(([k, t]) => [k, compile(t.inputSchema, root)]));
  const outValidators = new Map([...tools.entries()].map(([k, t]) => [k, compile(t.outputSchema, root)]));

  const assetMap = new Map(catalog.assets.map(a => [a.asset_id, a]));
  let data = structuredClone(seed);
  let virtual_now = clock.initial_time;
  let epoch = 1, revision = 0, seq = 1;

  const ctx = {
    run_id: 'test-run',
    app_id: 'questshelf',
    get virtual_now() { return virtual_now; },
    binding,
    nextId: () => seq++,
    log: () => {},
    assets: {
      read(asset_id) {
        const desc = assetMap.get(asset_id);
        if (!desc) { const e = new Error('Unknown asset'); e.code = 'not_found'; throw e; }
        const bytes = fs.readFileSync(path.join(root, desc.storage.path));
        return {
          asset_id,
          mime_type: desc.mime_type,
          encoding: 'base64',
          bytes: bytes.length,
          sha256: desc.integrity.sha256,
          data_base64: bytes.toString('base64'),
        };
      },
    },
  };

  if (!seedValidator(data)) throw new Error('Seed schema validation failed');
  plugin.validateSeed(ctx, data);

  return {
    version: () => ({ epoch, revision }),
    advanceTime(iso) {
      if (Date.parse(iso) < Date.parse(virtual_now)) throw new Error('Virtual clock cannot move backwards');
      virtual_now = iso;
    },
    getData: () => structuredClone(data),
    call(name, args = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error('Unknown tool ' + name);
      const fullArgs = tool.read_only
        ? args
        : { expected_version: { epoch, revision }, request_id: 'req_' + seq++, ...args };
      if (!inValidators.get(name)(fullArgs)) throw new Error('Invalid input for ' + name);
      const snapshot = structuredClone(data);
      const out = plugin.handleTool(ctx, snapshot, name, fullArgs);
      if (!tool.read_only) {
        if (!seedValidator(out.data)) throw new Error('Post-write state invalid');
        plugin.validateSeed(ctx, out.data);
        data = out.data;
        revision += 1;
      }
      const env = { status: tool.read_only ? 'ok' : 'committed', app_id: 'questshelf', version: { epoch, revision }, ...out.result };
      if (!outValidators.get(name)(env)) throw new Error('Invalid output for ' + name);
      return env;
    },
    applyEvent(event) {
      if (!eventValidator(event)) throw new Error('Invalid event envelope');
      const snapshot = structuredClone(data);
      const nextData = plugin.applyEvent(ctx, snapshot, event);
      if (!seedValidator(nextData)) throw new Error('Post-event state invalid');
      plugin.validateSeed(ctx, nextData);
      data = nextData;
      virtual_now = event.at;
      revision += 1;
      return { status: 'committed', version: { epoch, revision } };
    },
  };
}

module.exports = { createHarness };
