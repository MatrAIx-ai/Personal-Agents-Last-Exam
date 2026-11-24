'use strict';
// App-only transaction simulator. Real permissions, persistence and MCP are
// checked by the public verifier and tests/platform-checks.cjs.
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

function fixture({logging = true, seed = require('../fixtures/minimal.json'), now = require('../fixtures/clock.json').initial_time} = {}) {
  let data = structuredClone(seed);
  const logs = [];
  const ctx = {app_id: app, role: 'agent', virtual_now: now, binding: structuredClone(require('../fixtures/binding.json'))};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  function validate(value) {
    assert.ok(seedValid(value), 'Seed schema');
    plugin.validateSeed(ctx, value);
  }
  validate(data);
  let seq = 0;
  // Agent-side call trace, standing in for the supplied execution records.
  const trace = [];
  return {
    ctx,
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    get trace() { return structuredClone(trace); },
    // State as an evaluator sees it now: stored data with due time effects applied.
    view() { return require('../src/settle.cjs').settle({...ctx, log: undefined}, structuredClone(data)); },
    // The visibility record of the settled state.
    record() { return require('../src/visibility.cjs').record(this.view()); },
    // Moves the clock forward, as Core's env.advance_time does; no handler runs.
    at(time) {
      assert.ok(Date.parse(time) >= Date.parse(ctx.virtual_now), 'Clock moves forward only');
      ctx.virtual_now = time;
    },
    call(name, args = {}) {
      const tool = tools.find(t => t.name === 'stoopside.' + name);
      assert.ok(tool, 'Known tool ' + name);
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (++seq), ...args};
      assert.ok(input.get(tool.name)(full), 'Input schema: ' + name);
      const before = JSON.stringify(data);
      let out;
      try {
        out = plugin.handleTool(ctx, structuredClone(data), tool.name, structuredClone(full));
      } catch (e) {
        trace.push({at: ctx.virtual_now, name, args: structuredClone(args), error: e.code || 'error'});
        throw e;
      }
      trace.push({at: ctx.virtual_now, name, args: structuredClone(args), error: null});
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'Reads do not change data');
      assert.ok(output.get(tool.name)({...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision: seq}}), 'Output schema: ' + name);
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      const previous = ctx.virtual_now;
      assert.ok(Date.parse(event.at) >= Date.parse(previous), 'Events cannot move the clock backwards');
      ctx.virtual_now = event.at;
      try {
        const out = plugin.applyEvent({...ctx, role: 'infra'}, structuredClone(data), structuredClone(event));
        validate(out);
        data = out;
      } catch (e) {
        ctx.virtual_now = previous;
        throw e;
      }
      return structuredClone(data);
    },
  };
}
module.exports = {fixture};
