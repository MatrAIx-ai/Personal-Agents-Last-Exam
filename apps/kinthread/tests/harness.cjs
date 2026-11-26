'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fixture(options = {}) {
  const root = path.resolve(__dirname, '..');
  const dir = options.dir ? path.join(root, options.dir) : path.join(root, 'fixtures');
  const seedFile = options.dir ? path.join(dir, 'seed.json') : path.join(dir, 'minimal.json');
  const bindingFile = path.join(dir, 'binding.json');
  const clockFile = path.join(dir, 'clock.json');
  let data = structuredClone(readJson(seedFile));
  const ctx = {
    app_id: app,
    role: 'agent',
    virtual_now: options.clock || readJson(clockFile).initial_time,
    binding: structuredClone(readJson(bindingFile))
  };
  function validate(value) {
    assert.equal(seedValid(value), true, 'Seed schema');
    plugin.validateSeed(ctx, value);
  }
  validate(data);
  let seq = 0;
  return {
    ctx,
    get data() { return structuredClone(data); },
    call(name, args = {}) {
      const tool = tools.find(item => item.name === name);
      assert.ok(tool, 'Known tool ' + name);
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (++seq), ...args};
      assert.equal(input.get(name)(full), true, 'Input schema: ' + name);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, name + ' wrote business data');
      const envelope = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision: seq}};
      assert.equal(output.get(name)(envelope), true, 'Output schema: ' + name);
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.equal(eventValid(event), true, 'Event schema ' + event.operation);
      const previous = ctx.virtual_now;
      if (Date.parse(event.at) < Date.parse(previous)) {
        const error = new Error('Event time precedes the clock.');
        error.code = 'invalid_event';
        throw error;
      }
      ctx.virtual_now = event.at;
      try {
        const out = plugin.applyEvent({...ctx, role: 'infra'}, structuredClone(data), structuredClone(event));
        validate(out);
        data = out;
        return structuredClone(data);
      } catch (error) {
        ctx.virtual_now = previous;
        throw error;
      }
    },
    setTime(instant) {
      if (Date.parse(instant) < Date.parse(ctx.virtual_now)) {
        const error = new Error('The clock cannot move backwards.');
        error.code = 'invalid_time';
        throw error;
      }
      ctx.virtual_now = instant;
    },
    mutate(fn) {
      const next = structuredClone(data);
      fn(next);
      validate(next);
      data = next;
    }
  };
}

module.exports = {fixture, input, output, tools};
