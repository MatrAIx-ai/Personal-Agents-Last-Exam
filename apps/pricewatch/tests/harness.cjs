'use strict';
// App-only schema and transaction harness. Core identity, transport receipts,
// global-version conflicts and management permissions are verified via the real
// public runtime separately; this helper does not claim to simulate them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
const clone = value => structuredClone(value);

function fixture(options = {}) {
  const manifest = read('app.json');
  const plugin = require('../plugin.cjs');
  const tools = read(manifest.tools);
  const schemaDir = path.resolve(root, 'schemas');
  const validSeed = compile(read(manifest.schemas.seed), schemaDir);
  const validEvent = compile(read(manifest.schemas.events), schemaDir);
  const inputs = new Map(tools.map(tool => [tool.name, compile(tool.inputSchema, root)]));
  const outputs = new Map(tools.map(tool => [tool.name, compile(tool.outputSchema, root)]));
  let data = clone(options.seed || read(manifest.fixtures.seed));
  let seq = 0;
  const logs = [];
  const clock = fs.existsSync(path.resolve(root, 'fixtures/clock.json'))
    ? read('fixtures/clock.json').initial_time : '2026-01-01T00:00:00Z';
  const policies = read(manifest.fixtures.policies);
  const ctx = {
    app_id: manifest.app_id,
    run_id: 'pricewatch-business-test',
    role: 'agent',
    virtual_now: options.now || clock,
    binding: clone(options.binding || read(manifest.fixtures.binding)),
    policy: clone(policies[options.profile || 'sandbox'] || policies[Object.keys(policies)[0]])
  };
  if (options.logging !== false) ctx.log = (step, details = {}) => {
    logs.push({step, details: clone(details)});
  };
  function validate(value, context = ctx) {
    assert.ok(validSeed(value), 'Seed schema');
    plugin.validateSeed(context, value);
  }
  validate(data);
  return {
    ctx,
    plugin,
    get data() { return clone(data); },
    get logs() { return clone(logs); },
    validate,
    call(name, args = {}) {
      const tool = tools.find(item => item.name === name);
      assert.ok(tool, 'Known business tool: ' + name);
      const full = tool.read_only ? clone(args) : {
        expected_version: {epoch: 1, revision: seq},
        request_id: 'business-' + (seq + 1),
        ...clone(args)
      };
      assert.ok(inputs.get(name)(full), 'Input schema: ' + name);
      const before = clone(data);
      const out = plugin.handleTool(ctx, clone(data), name, full);
      validate(out.data);
      if (tool.read_only) assert.deepEqual(out.data, before, 'Read does not mutate App data');
      const wrapped = {
        ...out.result,
        status: tool.read_only ? 'ok' : 'committed',
        app_id: manifest.app_id,
        version: {epoch: 1, revision: seq + (tool.read_only ? 0 : 1)}
      };
      assert.ok(outputs.get(name)(wrapped), 'Output schema: ' + name);
      data = out.data;
      if (!tool.read_only) seq++;
      return clone(out.result);
    },
    event(event) {
      assert.ok(validEvent(event), 'Event schema');
      const eventContext = {...ctx, role: 'infra', virtual_now: event.at};
      // Core passes event.at to the handler. Only commit local time/data after
      // handler and schema validation succeed, so rejected events roll back.
      const out = plugin.applyEvent(eventContext, clone(data), clone(event));
      validate(out, eventContext);
      data = out;
      ctx.virtual_now = event.at;
      return clone(data);
    },
    advanceTime(instant) {
      assert.ok(Number.isFinite(Date.parse(instant)), 'Finite clock target');
      assert.ok(Date.parse(instant) >= Date.parse(ctx.virtual_now), 'Monotone test clock');
      // Deliberately no handler: actual Core env.advance_time works this way.
      ctx.virtual_now = instant;
    }
  };
}

function unchanged(f, action, pattern) {
  const before = f.data;
  const time = f.ctx.virtual_now;
  assert.throws(action, pattern);
  assert.deepEqual(f.data, before, 'Rejected action has no partial business mutation');
  assert.equal(f.ctx.virtual_now, time, 'Rejected action does not advance local clock');
}

module.exports = {fixture, unchanged};
