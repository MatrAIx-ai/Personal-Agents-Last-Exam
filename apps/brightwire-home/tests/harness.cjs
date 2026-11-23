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

function fixture({seed = 'minimal.json', binding = null, now = null} = {}) {
  let data = structuredClone(require(path.join(__dirname, '../fixtures', seed)));
  const bindingFile = binding || (seed === 'minimal.json' ? 'binding.json' : 'binding-' + seed.replace(/\.json$/, '') + '.json');
  const ctx = {
    app_id: app,
    role: 'agent',
    virtual_now: now || data.committed_through || require('../fixtures/clock.json').initial_time,
    binding: structuredClone(require(path.join(__dirname, '../fixtures', bindingFile)))
  };
  function validate(value) {
    assert.ok(seedValid(value), 'Seed schema');
    plugin.validateSeed(ctx, value);
  }
  validate(data);
  let seq = 0;
  return {
    ctx,
    get data() { return structuredClone(data); },
    mutate(fn) {
      const next = structuredClone(data);
      fn(next);
      validate(next);
      data = next;
    },
    call(name, args = {}) {
      const tool = tools.find(item => item.name === name);
      assert.ok(tool, 'Known tool');
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (seq + 1), ...args};
      assert.ok(input.get(name)(full), 'Input schema: ' + name + ' ' + JSON.stringify(full));
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before);
      const envelope = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision: tool.read_only ? seq : seq + 1}};
      assert.ok(output.get(name)(envelope), 'Output schema: ' + name);
      if (!tool.read_only) seq += 1;
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema ' + JSON.stringify(event));
      const previous = ctx.virtual_now;
      if (Date.parse(event.at) < Date.parse(previous)) {
        const error = new Error('The App virtual clock cannot move backwards.');
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
    }
  };
}

module.exports = {fixture};
