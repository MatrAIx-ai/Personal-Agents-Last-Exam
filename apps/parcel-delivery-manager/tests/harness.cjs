'use strict';
// App-only transaction simulator. Real permissions, persistence, versions and MCP are
// exercised by the public runtime verifier; this harness checks App behavior in isolation.
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const app = require('../app.json').app_id;
const tools = require('../tools.json');
const root = path.resolve(__dirname, '..');
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
const eventValid = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, root)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, root)]));
const T = name => app + '.' + name;

function fixture({seed = require('../fixtures/minimal.json'), binding = require('../fixtures/binding.json'), logging = true, virtual_now} = {}) {
  let data = structuredClone(seed);
  const logs = [];
  const ctx = {app_id: app, role: 'agent', virtual_now: virtual_now || require('../fixtures/clock.json').initial_time, binding: structuredClone(binding)};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  function validate(value) {
    assert.ok(seedValid(value), 'Seed schema');
    plugin.validateSeed(ctx, value);
  }
  validate(data);
  let seq = 0;
  return {
    ctx,
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    // Mirrors Infra env.advance_time: only the clock moves; no handler runs.
    advance(at) { assert.ok(Date.parse(at) >= Date.parse(ctx.virtual_now), 'Clock cannot move backwards'); ctx.virtual_now = at; },
    call(name, args = {}) {
      const full = name.startsWith(app + '.') ? name : T(name), tool = tools.find(t => t.name === full);
      assert.ok(tool, 'Known tool: ' + full);
      const request = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (seq + 1), ...args};
      assert.ok(input.get(full)(request), 'Input schema: ' + full);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(Object.freeze({...ctx}), structuredClone(data), full, structuredClone(request));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'Read tool changed data: ' + full);
      else seq++;
      const result = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision: seq}};
      assert.ok(output.get(full)(result), 'Output schema: ' + full);
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      assert.ok(Date.parse(event.at) >= Date.parse(ctx.virtual_now), 'Event time cannot move the clock backwards');
      const eventCtx = Object.freeze({...ctx, role: 'infra', virtual_now: event.at});
      const out = plugin.applyEvent(eventCtx, structuredClone(data), structuredClone(event));
      validate(out);
      data = out;
      ctx.virtual_now = event.at;
      return structuredClone(data);
    }
  };
}

// Assert that a failing call or event leaves business data untouched.
function rejects(f, fn, code) {
  const before = f.data;
  assert.throws(fn, error => error.code === code || (code instanceof RegExp && code.test(error.message)), 'Expected ' + code);
  assert.deepEqual(f.data, before, 'Rejected operation changed data');
}

module.exports = {fixture, rejects, T, app};
