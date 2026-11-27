'use strict';
// App-only transaction simulator, not a second Core. It applies the checks
// Core makes around every call (input/output/seed/event schemas, validateSeed,
// the read-only guard, rollback on failure and the record checks) so business
// rules can be tested from this package alone, with no runtime import.
// Real permissions, persistence, versions, retries and MCP are tested
// separately against the public runtime.
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const manifest = require('../app.json');
const tools = require('../tools.json');

const APP = manifest.app_id;
const root = path.resolve(__dirname, '..'), schemaDir = path.join(root, 'schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemaDir);
const eventValid = compile(require('../schemas/events.schema.json'), schemaDir);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, root)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, root)]));
const clone = value => structuredClone(value);
const freeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
};

// Core requires records and objects to agree and rejects two records whose
// bodies are identical once the id is removed.
function recordChecks(data) {
  const records = plugin.records(data), objects = plugin.objects(data);
  assert.equal(records.length, objects.length, 'records and objects must enumerate the same rows');
  assert.equal(new Set(objects).size, objects.length, 'object IDs must be unique');
  const canonical = x => Array.isArray(x) ? x.map(canonical)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  const bodies = records.map(r => JSON.stringify(canonical(Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'uid'].includes(k))))));
  assert.equal(new Set(bodies).size, bodies.length, 'record bodies must differ apart from their id');
}

function fixture({data, now, binding} = {}) {
  let state = clone(data || require('../fixtures/minimal.json'));
  let virtualNow = now || require('../fixtures/clock.json').initial_time;
  const identity = clone(binding || require('../fixtures/binding.json'));
  let revision = 0, requests = 0;
  const context = (role, at = virtualNow) => freeze({app_id: APP, role, binding: clone(identity), virtual_now: at});
  function validate(value, ctx) {
    assert.ok(seedValid(value), 'Seed schema');
    plugin.validateSeed(ctx, value);
    recordChecks(value);
  }
  validate(state, context('agent'));
  return {
    get data() { return clone(state); },
    get now() { return virtualNow; },
    get version() { return {epoch: 1, revision}; },
    get context() { return context('agent'); },
    // Infra's clock advance: later time bumps the revision, nothing else runs.
    advance(to) {
      assert.ok(Date.parse(to) >= Date.parse(virtualNow), 'The virtual clock cannot move backwards');
      if (Date.parse(to) > Date.parse(virtualNow)) { virtualNow = to; revision++; }
    },
    call(name, args = {}) {
      const full = name.startsWith(APP + '.') ? name : APP + '.' + name;
      const tool = tools.find(t => t.name === full);
      assert.ok(tool, 'Known tool: ' + full);
      const complete = tool.read_only ? args : {expected_version: {epoch: 1, revision}, request_id: 'local-' + (++requests), ...args};
      assert.ok(input.get(full)(complete), 'Input schema: ' + full);
      const ctx = context('agent'), before = JSON.stringify(state);
      const out = plugin.handleTool(ctx, clone(state), full, clone(complete));
      validate(out.data, ctx);
      if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'Read tool must not change data');
      const result = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: APP,
        version: {epoch: 1, revision: tool.read_only ? revision : revision + 1}};
      assert.ok(output.get(full)(result), 'Output schema: ' + full);
      if (!tool.read_only) revision++;
      state = out.data;
      return clone(result);
    },
    event(event) {
      assert.ok(eventValid(event), 'Event schema');
      assert.ok(manifest.event_types.includes(event.operation), 'Undeclared event type');
      assert.ok(Date.parse(event.at) >= Date.parse(virtualNow), 'The virtual clock cannot move backwards');
      const ctx = context('infra', event.at);
      const out = plugin.applyEvent(ctx, clone(state), clone(event));
      validate(out, ctx);
      state = out; virtualNow = event.at; revision++;
      return clone(state);
    }
  };
}

module.exports = {APP, fixture, seedValid, eventValid, recordChecks};
