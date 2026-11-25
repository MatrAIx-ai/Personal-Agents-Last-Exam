'use strict';
// App-only test context: the real Platewright hooks with the package's own schemas and the vendored
// public schema validator. It is not a second Core: idempotency, stale versions, policies,
// persistence and the Agent/Infra split are exercised on the real runtime by scripts/real-mcp.cjs.
//
// Commit/discard follows runtime/core/runtime.cjs: a hook gets a working copy; on success the copy
// is validated (seed schema, validateSeed, output schema) and becomes the data; on a throw it is
// discarded. Because the discard alone would make "a refusal leaves data unchanged" true by
// construction, the harness checks a stronger property for every refused Agent write and event:
// the hook decided the refusal before it changed anything in its working copy.
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const app = require('../app.json');
const pkg = path.resolve(__dirname, '..'), schemas = path.join(pkg, 'schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemas);
const eventValid = compile(require('../schemas/events.schema.json'), schemas);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, pkg)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, pkg)]));
const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const raise = (code, message) => { throw Object.assign(new Error(message), {code}); };

function fixture({seed = require('../fixtures/minimal.json'), now = require('../fixtures/clock.json').initial_time, mutate, logging = true} = {}) {
  let data = structuredClone(seed);
  if (mutate) mutate(data);
  const logs = [];
  let virtualNow = now, revision = 0, seq = 0;
  const binding = structuredClone(require('../fixtures/binding.json'));
  const ctx = role => {
    const c = {app_id: app.app_id, run_id: 'test', role, binding: structuredClone(binding), virtual_now: virtualNow};
    if (logging) c.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
    return deepFreeze(c);
  };
  function validate(value) {
    assert.ok(seedValid(value), 'Seed schema');
    plugin.validateSeed(ctx('agent'), value);
  }
  validate(data);
  // Runs a hook on a working copy; a refusal must leave the working copy untouched.
  function run(fn, read) {
    const before = JSON.stringify(data), work = structuredClone(data);
    let out;
    try { out = fn(work); } catch (e) {
      if (!read) assert.equal(JSON.stringify(work), before, `A refusal must be decided before any change (${e.code}: ${e.message})`);
      throw e;
    }
    return out;
  }
  function call(name, args = {}) {
    const tool = tools.find(t => t.name === name);
    if (!tool) raise('permission_denied', 'Unknown tool ' + name);
    const full = tool.read_only ? args : {expected_version: {epoch: 1, revision}, request_id: 'local-' + (++seq), ...args};
    if (!input.get(name)(full)) raise('invalid_arguments', 'Input schema: ' + name);
    const before = JSON.stringify(data);
    const out = run(work => plugin.handleTool(ctx('agent'), work, name, structuredClone(full)), tool.read_only);
    if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'A read must not change business data: ' + name);
    validate(out.data);
    if (!tool.read_only) revision++;
    const result = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: app.app_id, version: {epoch: 1, revision}};
    assert.ok(output.get(name)(result), 'Output schema: ' + name + ' ' + JSON.stringify(out.result).slice(0, 400));
    data = out.data;
    return structuredClone(result);
  }
  function event(e) {
    if (!eventValid(e)) raise('invalid_arguments', 'Event schema');
    if (!app.event_types.includes(e.operation)) raise('invalid_event', 'Undeclared event');
    if (Date.parse(e.at) < Date.parse(virtualNow)) raise('invalid_event', 'The App virtual clock cannot move backwards.');
    const previous = virtualNow;
    virtualNow = e.at;
    try {
      const out = run(work => plugin.applyEvent(ctx('infra'), work, structuredClone(e)), false);
      validate(out);
      data = out; revision++;
      return structuredClone(data);
    } catch (err) { virtualNow = previous; throw err; }
  }
  // Core's answer to a refused call: the error code; the data stays as it was.
  function attempt(fn) {
    const before = JSON.stringify(data);
    try { fn(); } catch (e) {
      assert.equal(JSON.stringify(data), before);
      return e.code || 'internal_error';
    }
    return 'committed';
  }
  return {
    get data() { return structuredClone(data); }, get logs() { return structuredClone(logs); },
    get now() { return virtualNow; }, get revision() { return revision; },
    call, event,
    refuse: (name, args) => attempt(() => call(name, args)),
    refuseEvent: e => attempt(() => event(e)),
    // The message that comes with a refusal, as the web interface shows it.
    message(name, args) { try { call(name, args); } catch (e) { return e.message; } return null; },
    // Infra's env.advance_time: moves the clock; runs no App code.
    advance(iso) { assert.ok(Date.parse(iso) >= Date.parse(virtualNow), 'Clock cannot move backwards'); virtualNow = iso; revision++; }
  };
}
// Business data without the activity log and notifications, for "nothing else changed" checks.
const business = data => { const {activity, notifications, ...rest} = data; return rest; };
let eventSeq = 0;
const ev = (operation, at, payload, event_id = 'ev-test-' + (++eventSeq)) => ({event_id, at, operation: 'platewright.' + operation, payload});
module.exports = {fixture, business, ev};
