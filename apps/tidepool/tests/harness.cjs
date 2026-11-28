'use strict';
// App-only transaction simulator adapted from the shared personal-App harness. Real permissions,
// policy constraints, persistence, versions and MCP are exercised by the public runtime
// (see examples/mcp-walkthrough.cjs).
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

function fixture({logging = true, seed = require('../fixtures/minimal.json'), binding = require('../fixtures/binding.json'),
  virtual_now = require('../fixtures/clock.json').initial_time} = {}) {
  let data = structuredClone(seed);
  const logs = [];
  const ctx = {app_id: app, role: 'agent', virtual_now, binding: structuredClone(binding)};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  function validate(value) {assert.ok(seedValid(value), 'Seed schema'); plugin.validateSeed(ctx, value);}
  validate(data);
  let seq = 0;
  return {
    ctx, get data() {return structuredClone(data);}, get logs() {return structuredClone(logs);},
    call(name, args = {}) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool, 'Known tool');
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (++seq), ...args};
      assert.ok(input.get(name)(full), 'Input schema: ' + name);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'Read tools must not change data');
      assert.ok(output.get(name)({...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app,
        version: {epoch: 1, revision: seq}}), 'Output schema: ' + name);
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      assert.ok(Date.parse(event.at) >= Date.parse(ctx.virtual_now), 'Events cannot move the clock backwards');
      // Like Core, handlers and validation observe the event time; a failure rolls the clock back.
      const previous = ctx.virtual_now;
      ctx.virtual_now = event.at;
      try {
        const out = plugin.applyEvent({...ctx, role: 'infra'}, structuredClone(data), structuredClone(event));
        validate(out);
        data = out;
      } catch (error) {ctx.virtual_now = previous; throw error;}
      return structuredClone(data);
    },
    // Like env.advance_time: the clock moves forward; no handler runs and business data is untouched.
    advance(to) {
      assert.ok(Date.parse(to) >= Date.parse(ctx.virtual_now), 'The clock cannot move backwards');
      ctx.virtual_now = to;
    },
  };
}
module.exports = {fixture};
