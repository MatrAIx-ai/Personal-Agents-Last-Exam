'use strict';
// App-only transaction simulator. Real permissions, persistence and MCP are tested separately.
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
const refuse = (code, message) => { throw Object.assign(new Error(message), {code}); };
// `seed` and `now` replace the package fixture and its clock, as a task does with `env.load_seed`.
function fixture({logging = true, seed = require('../fixtures/minimal.json'), now = require('../fixtures/clock.json').initial_time} = {}) {
  let data = structuredClone(seed), seq = 0;
  const logs = [];
  const ctx = {app_id: app, role: 'agent', virtual_now: now, binding: structuredClone(require('../fixtures/binding.json'))};
  if (logging) ctx.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
  const frozen = extra => Object.freeze({...ctx, ...extra});
  function validate(value, at = ctx.virtual_now) { assert.ok(seedValid(value), 'Seed schema'); plugin.validateSeed(frozen({virtual_now: at}), value); }
  validate(data);
  return {ctx, get data() { return structuredClone(data); }, get logs() { return structuredClone(logs); },
    // Short tool names are accepted: `account.get` means `brindle.account.get`.
    call(short, args = {}) {
      const name = short.startsWith(app + '.') ? short : app + '.' + short, tool = tools.find(t => t.name === name);
      assert.ok(tool, 'Known tool');
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision: seq}, request_id: 'local-' + (seq + 1), ...args};
      assert.ok(input.get(name)(full), 'Input schema: ' + name);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(frozen(), structuredClone(data), name, structuredClone(full));
      validate(out.data);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before);
      else seq++;
      assert.ok(output.get(name)({...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app, version: {epoch: 1, revision: seq}}), 'Output schema: ' + name);
      data = out.data;
      return structuredClone(out.result);
    },
    // Like Core: an event is handled at its own time, and it cannot be dated before the current time.
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      if (Date.parse(event.at) < Date.parse(ctx.virtual_now)) refuse('invalid_event', 'The App virtual clock cannot move backwards.');
      const out = plugin.applyEvent(frozen({role: 'infra', virtual_now: event.at}), structuredClone(data), structuredClone(event));
      validate(out, event.at);
      data = out; ctx.virtual_now = event.at; seq++;
      return structuredClone(data);
    },
    // Like Core's `env.advance_time`: the clock moves and no App code runs.
    advance(time) {
      if (Date.parse(time) < Date.parse(ctx.virtual_now)) refuse('invalid_time', 'The App virtual clock cannot move backwards.');
      ctx.virtual_now = time;
    }
  };
}
module.exports = {fixture};
