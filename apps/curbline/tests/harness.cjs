'use strict';
// App-only transaction simulator. Real permissions, persistence and MCP are tested by app:verify.
// It mirrors Core: schema checks on input and output, version/request_id on writes, read-only reads,
// seed validation after every change, and ctx.virtual_now = event.at during events.
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const app = require('../app.json').app_id;
const dir = path.resolve(__dirname, '..'), schemaDir = path.join(dir, 'schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemaDir);
const eventValid = compile(require('../schemas/events.schema.json'), schemaDir);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, dir)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, dir)]));

function fixture({seed = require('../fixtures/minimal.json'), now = require('../fixtures/clock.json').initial_time,
  binding = require('../fixtures/binding.json'), logging = true} = {}) {
  let data = structuredClone(seed);
  const logs = [];
  const ctx = {app_id: app, role: 'agent', virtual_now: now, binding: structuredClone(binding)};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  const validate = value => { assert.ok(seedValid(value), 'Seed schema'); plugin.validateSeed(ctx, value); };
  validate(data);
  let revision = 0;
  return {
    ctx,
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    get now() { return ctx.virtual_now; },
    call(name, args = {}) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool, 'Known tool ' + name);
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision}, request_id: 'local-' + (revision + 1), ...args};
      assert.ok(input.get(name)(full), 'Input schema: ' + name + ' ' + JSON.stringify(full));
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'Read changed data: ' + name);
      else revision++;
      const result = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision}};
      assert.ok(output.get(name)(result), 'Output schema: ' + name + ' ' + JSON.stringify(result).slice(0, 2000));
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema: ' + JSON.stringify(event));
      assert.ok(Date.parse(event.at) >= Date.parse(ctx.virtual_now), 'Core rejects backwards time');
      const previous = ctx.virtual_now;
      ctx.virtual_now = event.at;
      try {
        const out = plugin.applyEvent({...ctx, role: 'infra'}, structuredClone(data), structuredClone(event));
        validate(out);
        data = out; revision++;
        return structuredClone(data);
      } catch (e) { ctx.virtual_now = previous; throw e; }
    },
    // Infra's env.advance_time: moves the clock and runs no App code.
    advance(to) { assert.ok(Date.parse(to) > Date.parse(ctx.virtual_now)); ctx.virtual_now = to; revision++; }
  };
}

module.exports = {fixture};
