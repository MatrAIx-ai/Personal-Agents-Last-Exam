'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const app = require('../app.json').app_id;
const tools = require('../tools.json');
const schemaDir = path.resolve(__dirname, '../schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemaDir);
const eventValid = compile(require('../schemas/events.schema.json'), schemaDir);
const input = new Map(tools.map(tool => [tool.name, compile(tool.inputSchema, path.resolve(__dirname, '..'))]));
const output = new Map(tools.map(tool => [tool.name, compile(tool.outputSchema, path.resolve(__dirname, '..'))]));

function fixture(options = {}) {
  const logging = options.logging !== false;
  let data = structuredClone(options.data || require('../fixtures/minimal.json'));
  const binding = structuredClone(options.binding || require('../fixtures/binding.json'));
  const virtual = options.virtual_now || data.seed_clock || require('../fixtures/clock.json').initial_time;
  const logs = [];
  const ctx = {app_id: app, role: 'agent', virtual_now: virtual, binding};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  function validate(value) {
    assert.equal(seedValid(value), true, 'Seed schema');
    plugin.validateSeed(ctx, value);
  }
  validate(data);
  let seq = 0;
  return {
    ctx,
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    setTime(value) { ctx.virtual_now = value; },
    update(fn) {
      const next = structuredClone(data);
      fn(next);
      validate(next);
      data = next;
    },
    call(name, args = {}) {
      const tool = tools.find(item => item.name === name);
      assert.ok(tool, 'Known tool');
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (++seq), ...args};
      assert.equal(input.get(name)(full), true, 'Input schema: ' + name);
      const before = JSON.stringify(data);
      let out;
      try {
        out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
      } catch (error) {
        assert.equal(JSON.stringify(data), before);
        throw error;
      }
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before);
      const body = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision: seq}};
      assert.equal(output.get(name)(body), true, 'Output schema: ' + name + ' ' + JSON.stringify(out.result));
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.equal(eventValid(event), true, 'Event schema');
      const before = JSON.stringify(data);
      let out;
      try {
        out = plugin.applyEvent({...ctx, role: 'infra'}, structuredClone(data), structuredClone(event));
      } catch (error) {
        assert.equal(JSON.stringify(data), before);
        throw error;
      }
      const previous = ctx.virtual_now;
      ctx.virtual_now = event.at;
      try { validate(out); } catch (error) { ctx.virtual_now = previous; throw error; }
      data = out;
      return structuredClone(data);
    }
  };
}
module.exports = {fixture};
