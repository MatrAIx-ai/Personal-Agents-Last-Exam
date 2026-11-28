'use strict';
// App-only transaction simulator. Real permissions, persistence and MCP are tested separately (tests/mcp.integration.cjs).
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const app = require('../app.json').app_id;
const tools = require('../tools.json');
const schemaDir = path.resolve(__dirname, '../schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemaDir);
const eventValid = compile(require('../schemas/events.schema.json'), schemaDir);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, path.resolve(__dirname, '..'))]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, path.resolve(__dirname, '..'))]));
function fixture({seed, binding, at, logging = false} = {}) {
  let data = structuredClone(seed || require('../fixtures/minimal.json'));
  const logs = [];
  const ctx = {app_id: app, role: 'agent', virtual_now: at || require('../fixtures/clock.json').initial_time, binding: structuredClone(binding || require('../fixtures/binding.json'))};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  function validate(value) { assert.ok(seedValid(value), 'Seed schema'); plugin.validateSeed(ctx, value); }
  validate(data);
  let seq = 0;
  const full = name => name.startsWith(app + '.') ? name : app + '.' + name;
  return {ctx, get data() { return structuredClone(data); }, get logs() { return structuredClone(logs); },
    // Infra's clock: no handler runs and nothing is rewritten.
    advance(to) { assert.ok(Date.parse(to) >= Date.parse(ctx.virtual_now), 'The clock cannot move backwards'); ctx.virtual_now = to; },
    call(name, args = {}) {
      const tool = tools.find(t => t.name === full(name));
      assert.ok(tool, 'Known tool: ' + name);
      const sent = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (seq + 1), ...args};
      assert.ok(input.get(tool.name)(sent), 'Input schema: ' + tool.name);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), tool.name, structuredClone(sent));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'A read left business data unchanged');
      else seq += 1;
      assert.ok(output.get(tool.name)({...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision: seq}}), 'Output schema: ' + tool.name + ' ' + JSON.stringify(out.result).slice(0, 300));
      data = out.data; return structuredClone(out.result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      assert.ok(Date.parse(event.at) >= Date.parse(ctx.virtual_now), 'An event cannot be dated before the current time');
      const previous = ctx.virtual_now; ctx.virtual_now = event.at;
      try { const out = plugin.applyEvent({...ctx, role: 'infra'}, structuredClone(data), structuredClone(event)); validate(out); data = out; }
      catch (e) { ctx.virtual_now = previous; throw e; }
      return structuredClone(data);
    }
  };
}
module.exports = {fixture};
