'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const app = require('../app.json').app_id;
const tools = require('../tools.json');
const schemaDir = path.resolve(__dirname, '../schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemaDir);
const eventValid = compile(require('../schemas/events.schema.json'), schemaDir);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, path.resolve(__dirname, '..'))]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, path.resolve(__dirname, '..'))]));

function fixture({ logging = true } = {}) {
  let data = structuredClone(require('../fixtures/minimal.json'));
  const blobs = {};
  const logs = [];
  const ctx = {
    app_id: app,
    role: 'agent',
    virtual_now: require('../fixtures/clock.json').initial_time,
    binding: structuredClone(require('../fixtures/binding.json'))
  };
  if (logging) ctx.log = (step, details = {}) => logs.push({ step, details: structuredClone(details) });
  ctx.assets = {
    read(id) { if (!blobs[id]) throw Object.assign(Error('Missing asset'), { code: 'not_available' }); return structuredClone(blobs[id]); },
    add({ object_id, files }) {
      return files.map(file => {
        const bytes = Buffer.from(file.base64, 'base64');
        if (bytes.toString('base64') !== file.base64 || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
          throw Object.assign(Error('Invalid bytes/hash'), { code: 'invalid_attachment' });
        }
        const id = 'test-' + crypto.createHash('sha256').update(object_id + JSON.stringify(file)).digest('hex').slice(0, 32);
        blobs[id] = structuredClone(file);
        return id;
      });
    }
  };
  function validate(value) { assert.ok(seedValid(value), 'Seed schema'); plugin.validateSeed(ctx, value); }
  validate(data);
  let seq = 0;
  return {
    ctx,
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    call(name, args = {}) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool, 'Known tool');
      const full = tool.read_only ? args : { expected_version: { epoch: 1, revision: seq }, request_id: 'local-' + (++seq), ...args };
      assert.ok(input.get(name)(full), 'Input schema: ' + name);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before);
      const envelope = { ...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: { epoch: 1, revision: seq } };
      assert.ok(output.get(name)(envelope), 'Output schema: ' + name + ' ' + JSON.stringify(out.result));
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      const previous = ctx.virtual_now;
      if (Date.parse(event.at) < Date.parse(previous)) {
        const error = new Error('Event is before the run clock.');
        error.code = 'invalid_event';
        throw error;
      }
      ctx.virtual_now = event.at;
      try {
        const out = plugin.applyEvent({ ...ctx, role: 'infra' }, structuredClone(data), structuredClone(event));
        validate(out);
        data = out;
        return structuredClone(data);
      } catch (error) {
        ctx.virtual_now = previous;
        throw error;
      }
    },
    advance(at) {
      if (Date.parse(at) < Date.parse(ctx.virtual_now)) {
        const error = new Error('Clock cannot move backwards.');
        error.code = 'invalid_event';
        throw error;
      }
      ctx.virtual_now = at;
    },
    mutate(fn) {
      const next = structuredClone(data);
      fn(next);
      validate(next);
      data = next;
    }
  };
}

module.exports = { fixture };
