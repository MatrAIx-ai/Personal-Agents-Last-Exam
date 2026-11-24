'use strict';
// App-only test context: real Bellnote hooks, the package's own schemas and the vendored public
// schema validator. It applies inputs the way the host does (schema check, ctx.virtual_now, a
// working copy, validateSeed after every change) but it is not a second Core: idempotency,
// stale versions, policies, persistence and the Agent/Infra split are tested against the real
// runtime in scripts/real-mcp.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const pkg = path.resolve(__dirname, '..'), schemas = path.join(pkg, 'schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemas);
const eventValid = compile(require('../schemas/events.schema.json'), schemas);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, pkg)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, pkg)]));
const eventTypes = require('../app.json').event_types;
const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

function fixture({seed = require('../fixtures/minimal.json'), now = require('../fixtures/clock.json').initial_time, mutate, logging = true} = {}) {
  let data = structuredClone(seed);
  if (mutate) mutate(data);
  const logs = [], audit = [];
  let virtualNow = now, revision = 0, seq = 0;
  const binding = structuredClone(require('../fixtures/binding.json'));
  const ctx = role => {
    const c = {app_id: 'bellnote', run_id: 'test', role, binding: structuredClone(binding), virtual_now: virtualNow};
    if (logging) c.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
    return deepFreeze(c);
  };
  function validate(value) {
    assert.ok(seedValid(value), 'Seed schema');
    plugin.validateSeed(ctx('agent'), value);
  }
  validate(data);
  const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
  function call(name, args = {}) {
    const tool = tools.find(t => t.name === name);
    if (!tool) fail('permission_denied', 'Unknown tool');
    const full = tool.read_only ? args : {expected_version: {epoch: 1, revision}, request_id: 'local-' + (++seq), ...args};
    if (!input.get(name)(full)) fail('invalid_arguments', 'Input schema: ' + name);
    const before = JSON.stringify(data);
    const out = plugin.handleTool(ctx('agent'), structuredClone(data), name, structuredClone(full));
    if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'A read must not change business data: ' + name);
    validate(out.data);
    if (!tool.read_only) revision++;
    const result = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: 'bellnote', version: {epoch: 1, revision}};
    assert.ok(output.get(name)(result), 'Output schema: ' + name + ' ' + JSON.stringify(out.result).slice(0, 300));
    data = out.data;
    return structuredClone(result);
  }
  function event(e) {
    if (!eventValid(e)) fail('invalid_arguments', 'Event schema');
    if (!eventTypes.includes(e.operation)) fail('invalid_event', 'Undeclared event');
    if (Date.parse(e.at) < Date.parse(virtualNow)) fail('invalid_event', 'The App virtual clock cannot move backwards.');
    const previous = virtualNow;
    virtualNow = e.at;
    try {
      const out = plugin.applyEvent(ctx('infra'), structuredClone(data), structuredClone(e));
      validate(out);
      data = out; revision++;
      return structuredClone(data);
    } catch (err) { virtualNow = previous; throw err; }
  }
  // Records the outcome the way Core does: a refusal leaves data untouched and adds a denial row.
  function attempt(fn) {
    const before = JSON.stringify(data);
    try { const r = fn(); audit.push({decision: 'allow'}); return r; } catch (e) {
      assert.equal(JSON.stringify(data), before, 'A refused call must leave business data unchanged');
      audit.push({decision: 'deny', reason: e.code || 'internal_error'});
      return {status: e.code || 'internal_error', message: e.message};
    }
  }
  return {
    get data() { return structuredClone(data); }, get logs() { return structuredClone(logs); }, get audit() { return structuredClone(audit); },
    get now() { return virtualNow; }, get revision() { return revision; },
    call, event,
    try: (name, args) => attempt(() => call(name, args)),
    tryEvent: e => attempt(() => event(e)),
    // Infra's env.advance_time: moves the clock forward; runs no App code.
    advance(iso) { assert.ok(Date.parse(iso) >= Date.parse(virtualNow), 'Clock cannot move backwards'); virtualNow = iso; revision++; }
  };
}
// Business data excluding the activity log and notifications, for "nothing else changed" checks.
const business = data => { const {activity, notifications, ...rest} = data; return rest; };
let eventSeq = 0;
const ev = (operation, at, payload, event_id = 'ev-test-' + (++eventSeq)) => ({event_id, at, operation: 'bellnote.' + operation, payload});
module.exports = {fixture, business, ev};
