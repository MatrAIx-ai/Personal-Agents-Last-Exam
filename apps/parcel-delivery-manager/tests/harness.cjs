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
// `code` is a business error code (or a pattern for harness schema failures); `message`
// optionally pins the specific rule so a rejection for another reason does not pass.
function rejects(f, fn, code, message) {
  const before = f.data;
  assert.throws(fn, error => {
    const matched = code instanceof RegExp ? code.test(error.message) : error.code === code;
    assert.ok(matched, 'Expected ' + code + ', got ' + (error.code || '') + ': ' + error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
  assert.deepEqual(f.data, before, 'Rejected operation changed data');
}

// Build a trusted event with a unique ID.
let eventSeq = 0;
const ev = (operation, at, payload) => ({event_id: 'evt-' + (++eventSeq), at, operation: 'carrier.' + operation, payload});
// Preview then submit, as an Agent must. Returns the new change ID.
function submit(f, id, change) {
  const preview = f.call('change.preview', {id, ...change}).preview;
  assert.equal(preview.allowed, true, 'Preview should allow: ' + preview.reason);
  return f.call('change.submit', {id, ...change, confirmation: preview.confirmation}).change_id;
}
const decide = (f, at, shipment_id, change_id, base_plan_revision, decision = 'applied', reason = null) =>
  f.event(ev('change_resolved', at, {shipment_id, change_id, base_plan_revision, decision, reason}));

// Preview then create a collection authorization. Returns {grant_id, pass_id}.
function authorize(f, id, fields) {
  const preview = f.call('grant.preview', {id, ...fields}).preview;
  assert.equal(preview.allowed, true, 'Preview should allow: ' + preview.reason);
  return f.call('grant.create', {id, ...fields, confirmation: preview.confirmation});
}
// A separate seeded run for another acting person over the same ledger and clock, as Infra
// would load it. Owner, delegate and unauthorized checks never share one session.
function actAs(f, person) {
  const account = require('../fixtures/binding.json').accounts.find(a => a.owner_person_id === person).account_id;
  // Records carry no account: the same ledger is loaded with another acting account.
  return fixture({seed: {...f.data, account_id: account, owner_person_id: person}, virtual_now: f.ctx.virtual_now});
}

module.exports = {fixture, rejects, ev, submit, decide, authorize, actAs, T, app};
