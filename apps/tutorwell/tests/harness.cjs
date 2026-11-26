'use strict';
// App-only transaction simulator. Real MCP, permissions, persistence, receipts and replay are checked by the
// public runtime (tests/runtime.test.cjs and `npm run app:verify`); this harness exercises the business code.
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const APP = require('../app.json').app_id;

const root = path.resolve(__dirname, '..'), schemas = path.join(root, 'schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemas);
const eventValid = compile(require('../schemas/events.schema.json'), schemas);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, root)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, root)]));
const MINIMAL = require('../fixtures/minimal.json');
const CLOCK = require('../fixtures/clock.json').initial_time;

function fixture({seed = MINIMAL, now = CLOCK, logging = true, binding = require('../fixtures/binding.json')} = {}) {
  let data = structuredClone(seed), revision = 0, requests = 0;
  const logs = [];
  const ctx = {app_id: APP, run_id: 'test', role: 'agent', virtual_now: now, binding: structuredClone(binding)};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  const validate = value => { assert.ok(seedValid(value), 'Seed schema'); plugin.validateSeed(ctx, value); };
  validate(data);
  return {
    ctx,
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    get now() { return ctx.virtual_now; },
    snapshot() { return {data: structuredClone(data), virtual_now: ctx.virtual_now}; },
    // Like env.advance_time: the clock only moves forward and no business handler runs.
    advance(at) { assert.ok(Date.parse(at) >= Date.parse(ctx.virtual_now), 'Clock cannot move backwards'); ctx.virtual_now = at; },
    call(name, args = {}) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool, 'Known tool ' + name);
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision}, request_id: 'local-' + (++requests), ...args};
      assert.ok(input.get(name)(full), 'Input schema: ' + name);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'Read changed data: ' + name);
      else revision++;
      const result = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: APP, version: {epoch: 1, revision}};
      assert.ok(output.get(name)(result), 'Output schema: ' + name);
      data = out.data;
      return structuredClone(out.result);
    },
    // Like env.apply_event: the handler sees event.at as virtual now; a refusal changes neither data nor clock.
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      assert.ok(Date.parse(event.at) >= Date.parse(ctx.virtual_now), 'Event time cannot precede the clock');
      const previous = ctx.virtual_now;
      ctx.virtual_now = event.at;
      try {
        const out = plugin.applyEvent({...ctx, role: 'infra'}, structuredClone(data), structuredClone(event));
        validate(out);
        data = out; revision++;
      } catch (e) { ctx.virtual_now = previous; throw e; }
      return structuredClone(data);
    }
  };
}

// Assert that fn throws `code` and leaves data and clock unchanged.
function refused(f, fn, code) {
  const before = JSON.stringify(f.data), clock = f.now;
  assert.throws(fn, e => e.code === code || assert.fail('Expected ' + code + ', got ' + (e.code || e.message)));
  assert.equal(JSON.stringify(f.data), before, 'A refused call changed data');
  assert.equal(f.now, clock, 'A refused call moved the clock');
}

module.exports = {fixture, refused, MINIMAL, CLOCK};
